import { upload } from '@fn/cs/server'
import sharp from 'sharp'

export type NumberPaintingRequest = {
  jobId: string
  userId: string
  sourceUrl: string
  title: string
  difficulty: '简单' | '普通' | '困难'
  category: '动物' | '风景' | '世界名画'
}

type RawImage = { data: Buffer; width: number; height: number }

const colorCount = { '简单': 18, '普通': 32, '困难': 48 } as const
const gridSize = { '简单': [28, 38], '普通': [38, 51], '困难': [48, 64] } as const

function safePath(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80)
}

function asHex(color: number[]) {
  return `#${color.map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')).join('').toUpperCase()}`
}

function cropWhiteMargin(image: RawImage): RawImage {
  let left = image.width
  let top = image.height
  let right = -1
  let bottom = -1
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const offset = (y * image.width + x) * 3
      if (image.data[offset] >= 245 && image.data[offset + 1] >= 245 && image.data[offset + 2] >= 245) continue
      left = Math.min(left, x); right = Math.max(right, x)
      top = Math.min(top, y); bottom = Math.max(bottom, y)
    }
  }
  if (right < left || bottom < top) return image
  const padding = Math.max(4, Math.round(Math.min(image.width, image.height) * .008))
  left = Math.max(0, left - padding); top = Math.max(0, top - padding)
  right = Math.min(image.width - 1, right + padding); bottom = Math.min(image.height - 1, bottom + padding)
  const width = right - left + 1
  const height = bottom - top + 1
  const data = Buffer.alloc(width * height * 3)
  for (let row = 0; row < height; row += 1) {
    image.data.copy(data, row * width * 3, ((top + row) * image.width + left) * 3, ((top + row) * image.width + left + width) * 3)
  }
  return { data, width, height }
}

async function decodeAndResize(source: Buffer): Promise<RawImage> {
  const decoded = await sharp(source, { limitInputPixels: 24_000_000 }).rotate().flatten({ background: '#FFFFFF' }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const cropped = cropWhiteMargin({ data: decoded.data, width: decoded.info.width, height: decoded.info.height })
  const width = Math.min(cropped.width, 900)
  const height = Math.max(1, Math.round(cropped.height * width / cropped.width))
  const resized = await sharp(cropped.data, { raw: { width: cropped.width, height: cropped.height, channels: 3 } }).resize(width, height, { kernel: sharp.kernel.lanczos3 }).raw().toBuffer({ resolveWithObject: true })
  return { data: resized.data, width: resized.info.width, height: resized.info.height }
}

function nearestColor(red: number, green: number, blue: number, centers: number[][]) {
  let best = 0
  let bestDistance = Number.POSITIVE_INFINITY
  for (let index = 0; index < centers.length; index += 1) {
    const center = centers[index]
    const distance = (center[0] - red) ** 2 + (center[1] - green) ** 2 + (center[2] - blue) ** 2
    if (distance < bestDistance) { best = index; bestDistance = distance }
  }
  return best
}

function extractPalette(image: RawImage, total: number) {
  const pixelCount = image.width * image.height
  const sampleCount = Math.min(pixelCount, 48_000)
  const stride = Math.max(1, Math.floor(pixelCount / sampleCount))
  const centers = Array.from({ length: total }, (_, index) => {
    const pixel = Math.min(pixelCount - 1, Math.floor((index + .5) * sampleCount / total) * stride)
    const offset = pixel * 3
    return [image.data[offset], image.data[offset + 1], image.data[offset + 2]]
  })
  for (let iteration = 0; iteration < 22; iteration += 1) {
    const sums = Array.from({ length: total }, () => [0, 0, 0])
    const counts = new Array<number>(total).fill(0)
    for (let pixel = 0; pixel < pixelCount; pixel += stride) {
      const offset = pixel * 3
      const nearest = nearestColor(image.data[offset], image.data[offset + 1], image.data[offset + 2], centers)
      sums[nearest][0] += image.data[offset]; sums[nearest][1] += image.data[offset + 1]; sums[nearest][2] += image.data[offset + 2]
      counts[nearest] += 1
    }
    for (let index = 0; index < total; index += 1) {
      if (!counts[index]) continue
      centers[index] = sums[index].map((sum) => sum / counts[index])
    }
  }
  return centers.sort((a, b) => (a[0] * .2126 + a[1] * .7152 + a[2] * .0722) - (b[0] * .2126 + b[1] * .7152 + b[2] * .0722))
}

function pixelate(image: RawImage, centers: number[][], columns: number, rows: number) {
  const cells: number[] = []
  const preview = Buffer.alloc(image.data.length)
  for (let row = 0; row < rows; row += 1) {
    const y0 = Math.round(row * image.height / rows)
    const y1 = Math.round((row + 1) * image.height / rows)
    for (let column = 0; column < columns; column += 1) {
      const x0 = Math.round(column * image.width / columns)
      const x1 = Math.round((column + 1) * image.width / columns)
      let red = 0; let green = 0; let blue = 0; let count = 0
      for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) {
        const offset = (y * image.width + x) * 3
        red += image.data[offset]; green += image.data[offset + 1]; blue += image.data[offset + 2]; count += 1
      }
      const colorIndex = nearestColor(red / count, green / count, blue / count, centers)
      cells.push(colorIndex)
      const color = centers[colorIndex]
      for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) {
        const offset = (y * image.width + x) * 3
        preview[offset] = Math.round(color[0]); preview[offset + 1] = Math.round(color[1]); preview[offset + 2] = Math.round(color[2])
      }
    }
  }
  return { cells, preview }
}

export async function generateNumberPainting(request: NumberPaintingRequest) {
  const response = await fetch(request.sourceUrl)
  if (!response.ok) throw new Error(`无法读取上传图片（${response.status}）`)
  const image = await decodeAndResize(Buffer.from(await response.arrayBuffer()))
  const [columns, rows] = gridSize[request.difficulty]
  const centers = extractPalette(image, colorCount[request.difficulty])
  const { cells, preview } = pixelate(image, centers, columns, rows)
  const previewPng = await sharp(preview, { raw: { width: image.width, height: image.height, channels: 3 } }).png().toBuffer()
  const prefix = `coloring-game/generated/${safePath(request.userId)}/${safePath(request.jobId)}`
  const previewAsset = await upload(previewPng, { path: prefix, name: 'preview.png' })
  const verifyAsset = await upload(previewPng, { path: prefix, name: 'verify.png' })
  const level = {
    id: `number-${request.jobId}`,
    title: request.title,
    subtitle: `数字填色 · ${columns * rows} 个编号色块`,
    category: request.category,
    difficulty: request.difficulty,
    palette: centers.map(asHex),
    regions: cells.map((color, index) => ({ id: `cell-${index}`, color, fillable: true })),
    viewBox: `0 0 ${image.width} ${image.height}`,
    source: request.sourceUrl,
    preview: previewAsset.url,
    verify: verifyAsset.url,
    pixelGrid: { columns, rows, cells },
    mode: 'paint-by-number-pixels',
    custom: true,
  }
  const levelAsset = await upload(Buffer.from(JSON.stringify(level), 'utf8'), { path: prefix, name: 'level.json' })
  return { levelUrl: levelAsset.url, previewUrl: previewAsset.url, verifyUrl: verifyAsset.url, regions: cells.length, colors: centers.length }
}
