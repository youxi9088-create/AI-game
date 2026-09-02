import { useEffect, useMemo, useRef, useState } from 'react'

type Difficulty = '简单' | '普通' | '困难'
type Shape =
  | { kind: 'rect'; x: number; y: number; width: number; height: number; rx?: number }
  | { kind: 'circle'; cx: number; cy: number; r: number }
  | { kind: 'path'; d: string }

type Region = {
  id: string
  color: number
  shape: Shape
  label?: { x: number; y: number }
  maskId?: number
  bbox?: [number, number, number, number]
  area?: number
}
type Level = {
  id: string
  title: string
  subtitle: string
  difficulty: Difficulty
  palette: string[]
  regions: Region[]
  viewBox: string
  preview?: string
  outline?: string
  lineart?: string
  regionMask?: string
  regionMaskWeb?: string
  regionsMeta?: string
  reference?: string
  lineArt?: boolean
  custom?: boolean
  official?: boolean
}
type Progress = Record<string, string[]>
type PaintedColors = Record<string, Record<string, number>>
type LocalSnapshot = {
  progress: Progress
  paintedColors?: PaintedColors
  customLevels: Level[]
  activeId: string
  customColors?: Record<string, string[]>
  removedLevelIds?: string[]
  canvasNames?: Record<string, string>
  showRegionNumbers?: boolean
}
type PipelineStep = { id: string; title: string; description: string; status: 'queued' | 'running' | 'completed' | 'failed'; message?: string }
type QualityCheck = { id: string; title: string; passed: boolean; detail: string }
type QualityAttempt = { attempt: number; id: string; passed: boolean; summary: string }
type QualityRetry = { maxAttempts: number; attempted: number; autoRetried: boolean; exhausted: boolean; strategy?: string }
type LevelValidation = { passed: boolean; summary: string; regions?: number; colors?: number; minRegionArea?: number; warnings?: string[]; errors?: string[] }
type QualityReport = {
  passed: boolean
  summary: string
  checks: QualityCheck[]
  baseline?: { name?: string; matched?: boolean } | null
  userMessage?: string
  inputAdvice?: string[]
  retry?: QualityRetry
  attempts?: QualityAttempt[]
}
type GenerationJob = { id: string; status: 'queued' | 'running' | 'completed' | 'failed'; title: string; difficulty: Difficulty; referenceUrl?: string | null; steps: PipelineStep[]; result?: { id: string; url: string; title: string; regions: number; colors: number; lineart?: string; regionMask?: string; verify?: string; lineCoverage?: number; quality?: QualityReport; validation?: LevelValidation }; quality?: QualityReport; validation?: LevelValidation; error?: string }

const DB_NAME = 'colorverse-local'
const STORE_NAME = 'snapshots'
const SNAPSHOT_KEY = 'current'
const DIFFICULTY_SPECS: Record<Difficulty, { colors: number; regions: string }> = {
  简单: { colors: 8, regions: '25–70' },
  普通: { colors: 14, regions: '45–130' },
  困难: { colors: 18, regions: '80–240' },
}

const catLevel: Level = {
  id: 'cat-garden',
  title: '午后的小猫',
  subtitle: '在花园里，把阳光慢慢填满。',
  difficulty: '简单',
  palette: ['#F7D17C', '#EE8D65', '#8CCFD1', '#457B9D', '#76B947', '#F4A261', '#F1FAEE', '#283618'],
  viewBox: '0 0 640 480',
  regions: [
    { id: 'sky', color: 2, shape: { kind: 'rect', x: 0, y: 0, width: 640, height: 295 } },
    { id: 'lawn', color: 4, shape: { kind: 'rect', x: 0, y: 295, width: 640, height: 185 } },
    { id: 'sun', color: 0, shape: { kind: 'circle', cx: 105, cy: 95, r: 48 } },
    { id: 'cloud-a', color: 6, shape: { kind: 'path', d: 'M295 94c0-19 15-34 34-34 12 0 23 6 29 16 5-4 11-6 18-6 18 0 33 15 33 33 0 18-15 32-33 32H325c-17 0-30-14-30-31z' } },
    { id: 'cloud-b', color: 6, shape: { kind: 'path', d: 'M475 165c0-15 12-27 27-27 10 0 19 5 24 13 4-3 9-5 14-5 15 0 28 12 28 27 0 15-13 27-28 27h-38c-15 0-27-12-27-27z' } },
    { id: 'house-wall', color: 5, shape: { kind: 'rect', x: 455, y: 225, width: 128, height: 112, rx: 4 } },
    { id: 'roof', color: 3, shape: { kind: 'path', d: 'M432 229 519 161l87 68z' } },
    { id: 'door', color: 7, shape: { kind: 'rect', x: 500, y: 274, width: 37, height: 63, rx: 8 } },
    { id: 'window', color: 2, shape: { kind: 'rect', x: 550, y: 252, width: 20, height: 24, rx: 4 } },
    { id: 'cat-body', color: 1, shape: { kind: 'path', d: 'M245 359c0-57 38-102 89-102 57 0 100 47 100 105v38H245z' } },
    { id: 'cat-head', color: 1, shape: { kind: 'circle', cx: 333, cy: 255, r: 66 } },
    { id: 'cat-ear-l', color: 1, shape: { kind: 'path', d: 'm279 220 9-70 43 44z' } },
    { id: 'cat-ear-r', color: 1, shape: { kind: 'path', d: 'm373 194 43-44 8 71z' } },
    { id: 'cat-chest', color: 6, shape: { kind: 'path', d: 'M303 316c13 13 49 13 62 0l-31 55z' } },
    { id: 'eye-l', color: 7, shape: { kind: 'circle', cx: 309, cy: 245, r: 7 } },
    { id: 'eye-r', color: 7, shape: { kind: 'circle', cx: 358, cy: 245, r: 7 } },
    { id: 'nose', color: 5, shape: { kind: 'path', d: 'm328 267 11-1 5 8-10 9-10-9z' } },
    { id: 'flower-a', color: 5, shape: { kind: 'circle', cx: 115, cy: 354, r: 22 } },
    { id: 'flower-b', color: 5, shape: { kind: 'circle', cx: 166, cy: 408, r: 18 } },
    { id: 'flower-c', color: 0, shape: { kind: 'circle', cx: 538, cy: 400, r: 22 } },
    { id: 'flower-center-a', color: 0, shape: { kind: 'circle', cx: 115, cy: 354, r: 7 } },
    { id: 'flower-center-b', color: 0, shape: { kind: 'circle', cx: 166, cy: 408, r: 6 } },
    { id: 'flower-center-c', color: 5, shape: { kind: 'circle', cx: 538, cy: 400, r: 7 } },
    { id: 'path', color: 0, shape: { kind: 'path', d: 'M0 435c98-32 182-14 253 13 88 34 204 31 387-6v38H0z' } },
  ],
}

const balloonLevel: Level = {
  id: 'balloon-house',
  title: '气球小屋',
  subtitle: '给想象力留一片轻盈的天空。',
  difficulty: '普通',
  palette: ['#F8C9D1', '#F5A65B', '#F3E9D2', '#A8DADC', '#5C8D89', '#6D597A', '#E76F51', '#264653'],
  viewBox: '0 0 640 480',
  regions: [
    { id: 'sky', color: 3, shape: { kind: 'rect', x: 0, y: 0, width: 640, height: 480 } },
    { id: 'hill-left', color: 4, shape: { kind: 'path', d: 'M0 373c112-138 231-90 333 107H0z' } },
    { id: 'hill-right', color: 2, shape: { kind: 'path', d: 'M265 480c108-158 257-156 375-51v51z' } },
    { id: 'balloon-a', color: 0, shape: { kind: 'circle', cx: 184, cy: 150, r: 82 } },
    { id: 'balloon-b', color: 1, shape: { kind: 'circle', cx: 312, cy: 103, r: 66 } },
    { id: 'balloon-c', color: 6, shape: { kind: 'circle', cx: 435, cy: 153, r: 83 } },
    { id: 'rope-a', color: 7, shape: { kind: 'path', d: 'M184 232 278 352l7-3-94-117z' } },
    { id: 'rope-b', color: 7, shape: { kind: 'path', d: 'M312 169 294 350l7 1 18-182z' } },
    { id: 'rope-c', color: 7, shape: { kind: 'path', d: 'm435 236-137 114 5 5 137-114z' } },
    { id: 'house-wall', color: 2, shape: { kind: 'rect', x: 243, y: 326, width: 116, height: 99, rx: 8 } },
    { id: 'house-roof', color: 5, shape: { kind: 'path', d: 'm222 329 79-71 80 71z' } },
    { id: 'house-door', color: 7, shape: { kind: 'rect', x: 284, y: 370, width: 34, height: 55, rx: 8 } },
    { id: 'house-window', color: 3, shape: { kind: 'circle', cx: 333, cy: 355, r: 14 } },
    { id: 'flag', color: 6, shape: { kind: 'path', d: 'M300 258v-54l43 18-43 18z' } },
    { id: 'cloud-left', color: 2, shape: { kind: 'path', d: 'M42 108c0-17 14-31 31-31 12 0 22 6 28 15 5-4 11-6 18-6 17 0 31 14 31 31 0 16-14 30-31 30H73c-17 0-31-13-31-30z' } },
    { id: 'cloud-right', color: 2, shape: { kind: 'path', d: 'M502 270c0-15 12-27 27-27 10 0 19 5 24 13 4-3 9-5 15-5 15 0 27 12 27 27 0 15-12 27-27 27h-39c-15 0-27-12-27-27z' } },
  ],
}

// 官方示例由 public/levels/index.json 管理，确保画廊和进入游戏时使用同一套关卡资产。
// 旧的 SVG 关卡仅作为离线加载失败时的兜底，不进入正常画廊。
const builtInLevels: Level[] = []


function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function readSnapshot(): Promise<LocalSnapshot | null> {
  try {
    const db = await openDb()
    return await new Promise<LocalSnapshot | null>((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(SNAPSHOT_KEY)
      request.onsuccess = () => resolve((request.result as LocalSnapshot | undefined) ?? null)
      request.onerror = () => reject(request.error)
    })
  } catch { return null }
}

async function saveSnapshot(snapshot: LocalSnapshot) {
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(snapshot, SNAPSHOT_KEY)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  } catch {
    // IndexedDB 不可用时仍允许继续游玩。
  }
}

function nearestColorIndex(color: [number, number, number], palette: [number, number, number][]) {
  let closest = 0
  let distance = Number.POSITIVE_INFINITY
  palette.forEach((candidate, index) => {
    const nextDistance = candidate.reduce((sum, value, channel) => sum + (value - color[channel]) ** 2, 0)
    if (nextDistance < distance) { closest = index; distance = nextDistance }
  })
  return closest
}

const LOCAL_SERVICE = `http://${window.location.hostname}:5399`

function assetUrl(path?: string) {
  if (!path) return undefined
  if (/^https?:\/\//i.test(path)) return path
  return `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`
}

function aiReferenceApi() {
  const configured = import.meta.env.VITE_COLORVERSE_AI_REFERENCE_ORIGIN?.replace(/\/$/, '')
  if (configured) return `${configured}/api/ai-reference`
  const isLocal = /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname)
  // 本地 Vite 不托管 FN API，开发时直接使用当前已部署站点的同一路由。
  if (isLocal) return 'https://f.new.ndhy.com/a/coloring-game/api/ai-reference'
  // FN 构建的 BASE_URL 为 "./"；用 document.baseURI 解析才能保留 /a/coloring-game/ 前缀。
  return new URL('api/ai-reference', document.baseURI).toString()
}

async function uploadAiReference(file: File) {
  const form = new FormData()
  form.append('file', file, file.name)
  let response: Response
  try {
    response = await fetch(aiReferenceApi(), { method: 'POST', body: form })
  } catch {
    throw new Error('无法上传参考图到 AI 工作坊。请检查网络，或确认 FN 站点的 AI 重制接口已发布。')
  }
  const info = await response.json().catch(() => null) as { url?: string; message?: string } | null
  if (!response.ok || !info?.url) throw new Error(info?.message ?? '参考图上传失败')
  return info.url
}

async function startGenerationJob(file: File, difficulty: Difficulty) {
  const referenceUrl = await uploadAiReference(file)
  const params = new URLSearchParams({
    title: file.name.replace(/\.[^.]+$/, '') || '我的填色画',
    difficulty,
    reference_url: referenceUrl,
  })
  const serviceUrl = `${LOCAL_SERVICE}/api/generate-level?${params.toString()}`
  let response: Response
  try {
    response = await fetch(serviceUrl, { method: 'POST', body: file })
  } catch {
    throw new Error('无法连接本地关卡工坊服务。请确认 npm run dev 正在运行，或打开 http://127.0.0.1:5399/api/health 检查服务状态。')
  }
  const info = await response.json()
  if (!response.ok) throw new Error(info?.detail ?? info?.error ?? '关卡生成失败')
  return info.jobId as string
}

async function readGenerationJob(jobId: string) {
  const response = await fetch(`${LOCAL_SERVICE}/api/jobs/${jobId}`)
  const info = await response.json()
  if (!response.ok) throw new Error(info?.error ?? '无法读取关卡生成状态')
  return info as GenerationJob
}

async function loadFreeFillLevel(levelUrl: string): Promise<Level> {
  const levelResponse = await fetch(assetUrl(levelUrl) ?? levelUrl)
  if (!levelResponse.ok) throw new Error('关卡文件加载失败')
  const level = await levelResponse.json() as Level
  return {
    ...level,
    preview: assetUrl(level.preview),
    outline: assetUrl(level.outline),
    lineart: assetUrl(level.lineart),
    regionMask: assetUrl(level.regionMask),
    regionMaskWeb: assetUrl(level.regionMaskWeb),
    regionsMeta: assetUrl(level.regionsMeta),
    reference: assetUrl(level.reference),
    custom: true,
  }
}

async function loadGeneratedLevel(result: NonNullable<GenerationJob['result']>, difficulty: Difficulty, fileName: string): Promise<Level> {
  const level = await loadFreeFillLevel(result.url)
  return {
    ...level,
    title: level.title || fileName,
    subtitle: `AI 重制 · ${result.regions} 个区域`,
    difficulty,
    preview: level.preview ?? assetUrl(`/levels/${result.id}/preview.png`),
    outline: level.outline ?? assetUrl(`/levels/${result.id}/outline.png`),
    lineart: level.lineart ?? assetUrl(`/levels/${result.id}/lineart.png`),
    regionMask: level.regionMask ?? assetUrl(`/levels/${result.id}/region_mask.png`),
    regionMaskWeb: level.regionMaskWeb ?? assetUrl(`/levels/${result.id}/region_mask_web.png`),
  }
}

function requestedLevelUrl() {
  return new URLSearchParams(window.location.search).get('level')?.trim() || ''
}

async function createPhotoLevel(file: File, difficulty: Difficulty): Promise<Level> {
  const jobId = await startGenerationJob(file, difficulty)
  for (;;) {
    await new Promise((resolve) => window.setTimeout(resolve, 450))
    const job = await readGenerationJob(jobId)
    if (job.status === 'failed') throw new Error(job.error ?? '关卡生成失败')
    if (job.status === 'completed' && job.result) return loadGeneratedLevel(job.result, difficulty, file.name)
  }
}

async function loadPackagedLevels(): Promise<Level[]> {
  const base = import.meta.env.BASE_URL
  const manifest = await fetch(`${base}levels/index.json`)
  if (!manifest.ok) throw new Error('关卡清单加载失败')
  const entries = await manifest.json() as string[]
  return Promise.all(entries.map(async (entry) => {
    const response = await fetch(`${base}${entry.replace(/^\//, '')}`)
    if (!response.ok) throw new Error(`关卡加载失败：${entry}`)
    const level = await response.json() as Level
    const asset = (path?: string) => path ? `${base}${path.replace(/^\//, '')}` : undefined
    return { ...level, preview: asset(level.preview), outline: asset(level.outline), lineart: asset(level.lineart), regionMask: asset(level.regionMask), regionMaskWeb: asset(level.regionMaskWeb), regionsMeta: asset(level.regionsMeta), reference: asset(level.reference), custom: true }
  }))
}

function RegionShape({ region, filled, guide, onPaint }: { region: Region; filled: boolean; guide: boolean; onPaint: () => void }) {
  const shared = {
    className: `region ${filled ? 'region--filled' : ''} ${guide ? 'region--guide' : ''}`,
    onPointerDown: (event: React.PointerEvent<SVGElement>) => { event.stopPropagation(); onPaint() },
    onPointerEnter: (event: React.PointerEvent<SVGElement>) => { if (event.buttons === 1) onPaint() },
  }
  if (region.shape.kind === 'rect') return <rect {...shared} {...region.shape} />
  if (region.shape.kind === 'circle') return <circle {...shared} {...region.shape} />
  return <path {...shared} d={region.shape.d} />
}

function RegionFill({ region, color, guide = false }: { region: Region; color: string; guide?: boolean }) {
  const className = `region-fill ${guide ? 'region-fill--guide' : ''}`
  if (region.shape.kind === 'rect') return <rect {...region.shape} className={className} fill={color} />
  if (region.shape.kind === 'circle') return <circle {...region.shape} className={className} fill={color} />
  return <path d={region.shape.d} className={className} fill={color} />
}

function RegionGeometry({ region }: { region: Region }) {
  if (region.shape.kind === 'rect') return <rect {...region.shape} />
  if (region.shape.kind === 'circle') return <circle {...region.shape} />
  return <path d={region.shape.d} />
}

function RegionImageFill({ region, source, clipId, canvas }: { region: Region; source: string; clipId: string; canvas: { width: number; height: number } }) {
  return <image className="source-reveal" href={source} x="0" y="0" width={canvas.width} height={canvas.height} preserveAspectRatio="xMidYMid slice" clipPath={`url(#${clipId})`} />
}

function RegionResultEdge({ region, correct }: { region: Region; correct: boolean }) {
  return <g className="region-result-edge" stroke={correct ? '#4f9c69' : '#dc5f59'}><RegionGeometry region={region} /></g>
}

function getRegionLabelPoint(region: Region) {
  if (region.label) return region.label
  if (region.bbox) {
    const [x, y, width, height] = region.bbox
    return { x: x + width / 2, y: y + height / 2 }
  }
  if (region.shape.kind === 'rect') return { x: region.shape.x + region.shape.width / 2, y: region.shape.y + region.shape.height / 2 }
  if (region.shape.kind === 'circle') return { x: region.shape.cx, y: region.shape.cy }
  return null
}

function RegionNumberLabels({ level, paintedColors, selectedColor, visible }: { level: Level; paintedColors: Record<string, number>; selectedColor: number; visible: boolean }) {
  if (!visible) return null
  return <svg className="region-number-layer" viewBox={level.viewBox} aria-hidden="true">
    {level.regions.map((region) => {
      if (paintedColors[region.id] !== undefined) return null
      const point = getRegionLabelPoint(region)
      if (!point) return null
      return <text key={`label-${region.id}`} className={selectedColor === region.color ? 'region-number region-number--active' : 'region-number'} x={point.x} y={point.y} textAnchor="middle" dominantBaseline="central">{region.color + 1}</text>
    })}
  </svg>
}

type RasterArtwork = { width: number; height: number; edges: Uint8Array; source: Uint8ClampedArray; components: Map<string, { pixels: number[]; color: number }> }

function hexToRgb(color: string): [number, number, number] {
  const value = color.replace('#', '')
  return [Number.parseInt(value.slice(0, 2), 16), Number.parseInt(value.slice(2, 4), 16), Number.parseInt(value.slice(4, 6), 16)]
}

function swatchNumberColor(color: string) {
  const [red, green, blue] = hexToRgb(color)
  return red * 0.299 + green * 0.587 + blue * 0.114 > 155 ? '#3c3934' : '#ffffff'
}

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`无法加载图片：${source}`))
    image.src = source
  })
}

function LineArtCanvas({ level, palette, width, height, paintedColors, selectedColor, onPaint, onBlocked }: { level: Level; palette: string[]; width: number; height: number; paintedColors: Record<string, number>; selectedColor: number; onPaint: (region: Pick<Region, 'id' | 'color'>) => void; onBlocked: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const artworkRef = useRef<RasterArtwork | null>(null)
  const [revision, setRevision] = useState(0)
  const [fillImage, setFillImage] = useState('')

  function getComponent(artwork: RasterArtwork, start: number) {
    const existing = [...artwork.components.entries()].find(([id]) => {
      const [, x, y] = id.split('-').map(Number)
      return y * artwork.width + x === start
    })
    if (existing) return { id: existing[0], ...existing[1] }
    const seen = new Uint8Array(artwork.width * artwork.height)
    const queue = new Int32Array(artwork.width * artwork.height)
    let head = 0
    let tail = 0
    let minimum = start
    let red = 0
    let green = 0
    let blue = 0
    queue[tail++] = start
    seen[start] = 1
    while (head < tail) {
      const index = queue[head++]
      minimum = Math.min(minimum, index)
      red += artwork.source[index * 4]
      green += artwork.source[index * 4 + 1]
      blue += artwork.source[index * 4 + 2]
      const x = index % artwork.width
      const y = Math.floor(index / artwork.width)
      const neighbors = [x > 0 ? index - 1 : -1, x + 1 < artwork.width ? index + 1 : -1, y > 0 ? index - artwork.width : -1, y + 1 < artwork.height ? index + artwork.width : -1]
      for (const next of neighbors) {
        if (next >= 0 && !seen[next] && !artwork.edges[next]) { seen[next] = 1; queue[tail++] = next }
      }
    }
    const id = `raster-${minimum % artwork.width}-${Math.floor(minimum / artwork.width)}`
    const palette = level.palette.map(hexToRgb)
    const color = nearestColorIndex([Math.round(red / tail), Math.round(green / tail), Math.round(blue / tail)], palette)
    const component = { pixels: Array.from(queue.slice(0, tail)), color }
    artwork.components.set(id, component)
    return { id, ...component }
  }

  function componentFromId(artwork: RasterArtwork, id: string) {
    const cached = artwork.components.get(id)
    if (cached) return { id, ...cached }
    const [, xString, yString] = id.split('-')
    const x = Number(xString)
    const y = Number(yString)
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= artwork.width || y >= artwork.height) return null
    return getComponent(artwork, y * artwork.width + x)
  }

  function redraw(colors = paintedColors) {
    const canvas = canvasRef.current
    const artwork = artworkRef.current
    if (!canvas || !artwork) return
    const context = canvas.getContext('2d')
    if (!context) return
    const image = context.createImageData(artwork.width, artwork.height)
    const pixels = image.data
    for (const [id, paintedColor] of Object.entries(colors)) {
      if (!id.startsWith('raster-')) continue
      const component = componentFromId(artwork, id)
      if (!component) continue
      const [red, green, blue] = hexToRgb(palette[paintedColor] ?? '#000000')
      const [edgeRed, edgeGreen, edgeBlue] = paintedColor === component.color ? [79, 156, 105] : [220, 95, 89]
      for (const index of component.pixels) {
        const offset = index * 4
        pixels[offset] = red
        pixels[offset + 1] = green
        pixels[offset + 2] = blue
        pixels[offset + 3] = 255
      }
      for (const index of component.pixels) {
        const x = index % artwork.width
        const y = Math.floor(index / artwork.width)
        const nearEdge = (x > 0 && artwork.edges[index - 1]) || (x + 1 < artwork.width && artwork.edges[index + 1]) || (y > 0 && artwork.edges[index - artwork.width]) || (y + 1 < artwork.height && artwork.edges[index + artwork.width])
        if (!nearEdge) continue
        const offset = index * 4
        pixels[offset] = edgeRed
        pixels[offset + 1] = edgeGreen
        pixels[offset + 2] = edgeBlue
      }
    }
    context.putImageData(image, 0, 0)
    setFillImage(canvas.toDataURL('image/png'))
  }

  useEffect(() => {
    let active = true
    if (!level.outline || !level.reference) return
    void Promise.all([loadImage(level.outline), loadImage(level.reference)]).then(([outline, reference]) => {
      const work = document.createElement('canvas')
      work.width = width
      work.height = height
      const context = work.getContext('2d', { willReadFrequently: true })
      if (!context || !active) return
      context.drawImage(outline, 0, 0, width, height)
      const outlinePixels = context.getImageData(0, 0, width, height).data
      context.clearRect(0, 0, width, height)
      context.drawImage(reference, 0, 0, width, height)
      const source = context.getImageData(0, 0, width, height).data
      const rawEdges = new Uint8Array(width * height)
      for (let index = 0; index < rawEdges.length; index += 1) {
        const offset = index * 4
        const brightness = (outlinePixels[offset] + outlinePixels[offset + 1] + outlinePixels[offset + 2]) / 3
        rawEdges[index] = outlinePixels[offset + 3] > 30 && brightness < 220 ? 1 : 0
      }
      const edges = new Uint8Array(rawEdges.length)
      for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
        if (!rawEdges[y * width + x]) continue
        for (let offsetY = -1; offsetY <= 1; offsetY += 1) for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          const nextX = x + offsetX
          const nextY = y + offsetY
          if (nextX >= 0 && nextX < width && nextY >= 0 && nextY < height) edges[nextY * width + nextX] = 1
        }
      }
      artworkRef.current = { width, height, edges, source, components: new Map() }
      if (active) setRevision((value) => value + 1)
    }).catch(() => undefined)
    return () => { active = false }
  }, [height, level.outline, level.reference, width])

  useEffect(() => { redraw() }, [paintedColors, revision])

  function paintAt(event: React.PointerEvent<HTMLCanvasElement>) {
    const artwork = artworkRef.current
    const canvas = canvasRef.current
    if (!artwork || !canvas) return
    const bounds = canvas.getBoundingClientRect()
    const pointX = Math.max(0, Math.min(artwork.width - 1, Math.floor((event.clientX - bounds.left) / bounds.width * artwork.width)))
    const pointY = Math.max(0, Math.min(artwork.height - 1, Math.floor((event.clientY - bounds.top) / bounds.height * artwork.height)))
    let start = pointY * artwork.width + pointX
    if (artwork.edges[start]) {
      start = -1
      for (let radius = 1; radius <= 8 && start < 0; radius += 1) for (let y = pointY - radius; y <= pointY + radius && start < 0; y += 1) for (let x = pointX - radius; x <= pointX + radius; x += 1) {
        if (x >= 0 && x < artwork.width && y >= 0 && y < artwork.height && !artwork.edges[y * artwork.width + x]) start = y * artwork.width + x
      }
    }
    if (start < 0) return
    let component = getComponent(artwork, start)
    const maximumArea = artwork.width * artwork.height * .25
    if (component.pixels.length < 40) {
      for (const radius of [5, 10, 16]) {
        const candidates = [[pointX - radius, pointY], [pointX + radius, pointY], [pointX, pointY - radius], [pointX, pointY + radius], [pointX - radius, pointY - radius], [pointX + radius, pointY + radius]]
        let closest = component
        for (const [x, y] of candidates) {
          if (x < 0 || x >= artwork.width || y < 0 || y >= artwork.height) continue
          const index = y * artwork.width + x
          if (artwork.edges[index]) continue
          const candidate = getComponent(artwork, index)
          if (candidate.pixels.length >= 40 && candidate.pixels.length <= maximumArea && candidate.pixels.length > closest.pixels.length) closest = candidate
        }
        if (closest.pixels.length >= 40) { component = closest; break }
      }
    }
    if (component.pixels.length < 40 || component.pixels.length > maximumArea) { onBlocked(); return }
    if (selectedColor >= 0) redraw({ ...paintedColors, [component.id]: selectedColor })
    onPaint({ id: component.id, color: component.color })
  }

  return <>{fillImage && <img className="raster-fill-image" src={fillImage} alt="" aria-hidden="true" />}<canvas ref={canvasRef} className="raster-input-canvas" width={width} height={height} onPointerDown={paintAt} onPointerMove={(event) => { if (event.buttons === 1) paintAt(event) }} /></>
}

type MaskArtwork = { width: number; height: number; ids: Uint16Array; pixelsById: Map<number, number[]> }

function MaskColorCanvas({ level, palette, width, height, paintedColors, onPaint }: { level: Level; palette: string[]; width: number; height: number; paintedColors: Record<string, number>; onPaint: (region: Pick<Region, 'id' | 'color'>) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const artworkRef = useRef<MaskArtwork | null>(null)
  const [revision, setRevision] = useState(0)
  const [fillImage, setFillImage] = useState('')
  const regionsByMask = useMemo(() => new Map(level.regions.filter((region) => region.maskId).map((region) => [region.maskId!, region])), [level.regions])

  function redraw(colors = paintedColors) {
    const canvas = canvasRef.current
    const artwork = artworkRef.current
    if (!canvas || !artwork) return
    const context = canvas.getContext('2d')
    if (!context) return
    const image = context.createImageData(artwork.width, artwork.height)
    const pixels = image.data
    for (const [maskId, region] of regionsByMask) {
      const paintedColor = colors[region.id]
      if (paintedColor === undefined) continue
      const [red, green, blue] = hexToRgb(palette[paintedColor] ?? '#000000')
      const [edgeRed, edgeGreen, edgeBlue] = paintedColor === region.color ? [79, 156, 105] : [220, 95, 89]
      for (const index of artwork.pixelsById.get(maskId) ?? []) {
        const offset = index * 4
        pixels[offset] = red; pixels[offset + 1] = green; pixels[offset + 2] = blue; pixels[offset + 3] = 255
        const x = index % artwork.width
        const y = Math.floor(index / artwork.width)
        const ids = artwork.ids
        const boundary = (x > 0 && ids[index - 1] !== maskId) || (x + 1 < artwork.width && ids[index + 1] !== maskId) || (y > 0 && ids[index - artwork.width] !== maskId) || (y + 1 < artwork.height && ids[index + artwork.width] !== maskId)
        if (boundary) { pixels[offset] = edgeRed; pixels[offset + 1] = edgeGreen; pixels[offset + 2] = edgeBlue }
      }
    }
    context.putImageData(image, 0, 0)
    setFillImage(canvas.toDataURL('image/png'))
  }

  useEffect(() => {
    let active = true
    if (!level.regionMaskWeb) return
    void loadImage(level.regionMaskWeb).then((mask) => {
      const work = document.createElement('canvas')
      work.width = width; work.height = height
      const context = work.getContext('2d', { willReadFrequently: true })
      if (!context || !active) return
      context.drawImage(mask, 0, 0, width, height)
      const raw = context.getImageData(0, 0, width, height).data
      const ids = new Uint16Array(width * height)
      const pixelsById = new Map<number, number[]>()
      for (let index = 0; index < ids.length; index += 1) {
        const id = raw[index * 4] + raw[index * 4 + 1] * 256
        ids[index] = id
        if (!id) continue
        const pixels = pixelsById.get(id) ?? []
        pixels.push(index)
        pixelsById.set(id, pixels)
      }
      artworkRef.current = { width, height, ids, pixelsById }
      if (active) setRevision((value) => value + 1)
    }).catch(() => undefined)
    return () => { active = false }
  }, [height, level.regionMaskWeb, width])

  useEffect(() => { redraw() }, [paintedColors, revision])

  function paintAt(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current
    const artwork = artworkRef.current
    if (!canvas || !artwork) return
    const bounds = canvas.getBoundingClientRect()
    const x = Math.max(0, Math.min(artwork.width - 1, Math.floor((event.clientX - bounds.left) / bounds.width * artwork.width)))
    const y = Math.max(0, Math.min(artwork.height - 1, Math.floor((event.clientY - bounds.top) / bounds.height * artwork.height)))
    let maskId = artwork.ids[y * artwork.width + x]
    if (!maskId) for (let radius = 1; radius <= 5 && !maskId; radius += 1) for (let offsetY = -radius; offsetY <= radius && !maskId; offsetY += 1) for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
      const nextX = x + offsetX
      const nextY = y + offsetY
      if (nextX >= 0 && nextX < artwork.width && nextY >= 0 && nextY < artwork.height) maskId = artwork.ids[nextY * artwork.width + nextX]
    }
    const region = regionsByMask.get(maskId)
    if (region) onPaint(region)
  }

  return <>{fillImage && <img className="raster-fill-image" src={fillImage} alt="" aria-hidden="true" />}<canvas ref={canvasRef} className="raster-input-canvas" width={width} height={height} onPointerDown={paintAt} onPointerMove={(event) => { if (event.buttons === 1) paintAt(event) }} /></>
}

const EMPTY_PIPELINE: PipelineStep[] = [
  { id: 'prepare', title: '接收并校验图片', description: '检查格式、尺寸与图片内容', status: 'queued' },
  { id: 'preprocess', title: '预处理画面', description: '统一画布尺寸，准备颜色数据', status: 'queued' },
  { id: 'lineart', title: '生成填色线稿', description: 'AI 依据原图重绘 Coloring Book Line Art', status: 'queued' },
  { id: 'reinforce', title: '加固线稿边界', description: '清理残线、补小断线并统一轮廓笔触', status: 'queued' },
  { id: 'quality', title: '验收线稿质量', description: '检查密度、边缘残线、闭合区域；基准图额外校验构图', status: 'queued' },
  { id: 'segment', title: '划分主要区域', description: '在线稿约束下识别可填色区域', status: 'queued' },
  { id: 'palette', title: '提取专属调色板', description: '从原图归纳建议颜色', status: 'queued' },
  { id: 'vectorize', title: '整理可点击区域', description: '将区域转为游戏可识别的形状', status: 'queued' },
  { id: 'package', title: '打包本地关卡', description: '写入预览图、线稿和关卡数据', status: 'queued' },
  { id: 'verify', title: '校验关卡', description: '检查区域、色板与预览结果', status: 'queued' },
]

function LineartQualityPanel({ report }: { report: QualityReport }) {
  return <section className={`lineart-quality ${report.passed ? 'lineart-quality--passed' : 'lineart-quality--failed'}`}>
    <div><strong>{report.passed ? '线稿质量验收通过' : '线稿已被质量门拦截'}</strong><span>{report.summary}</span></div>
    {report.baseline?.matched && <small>已对照历史验收样本：{report.baseline.name ?? '林间的幸福'}</small>}
    <ul>{report.checks.map((check) => <li key={check.id} className={check.passed ? 'passed' : 'failed'}><b>{check.passed ? '✓' : '×'}</b><span>{check.title}</span><em>{check.detail}</em></li>)}</ul>
    {report.retry && <p className="quality-retry"><b>{report.retry.autoRetried ? '已自动重跑同一原图 1 次' : '本次使用第 1 个候选'}</b><span>{report.retry.attempted}/{report.retry.maxAttempts} 个候选已验收{report.retry.exhausted ? '；未通过的候选不会进入区域分割。' : '。'}</span></p>}
    {!report.passed && report.userMessage && <p className="quality-reason"><b>未通过原因</b><span>{report.userMessage}</span></p>}
    {!report.passed && report.inputAdvice?.length && <div className="quality-advice"><b>什么样的图片更容易通过？</b><ul>{report.inputAdvice.map((advice) => <li key={advice}>{advice}</li>)}</ul></div>}
  </section>
}

function LevelValidationPanel({ report }: { report: LevelValidation }) {
  return <section className={`level-validation ${report.passed ? 'level-validation--passed' : 'level-validation--failed'}`}>
    <strong>{report.passed ? '关卡产物校验通过' : '关卡产物校验失败'}</strong>
    <span>{report.summary}</span>
    {report.passed && <small>{report.regions ?? 0} 个区域 · {report.colors ?? 0} 种颜色 · 最小可点击区域 {report.minRegionArea ?? 0}px</small>}
    {!!report.errors?.length && <ul>{report.errors.map((item) => <li key={item}>× {item}</li>)}</ul>}
    {!!report.warnings?.length && <ul className="level-validation-warnings">{report.warnings.map((item) => <li key={item}>提示：{item}</li>)}</ul>}
  </section>
}

function currentWorkshopJobId() {
  return new URLSearchParams(window.location.search).get('workshopJob')?.trim() || ''
}

function setWorkshopJobId(jobId?: string) {
  const next = new URL(window.location.href)
  if (jobId) next.searchParams.set('workshopJob', jobId)
  else next.searchParams.delete('workshopJob')
  window.history.replaceState({}, '', `${next.pathname}${next.search}${next.hash}`)
}

function WorkshopPage({ onBack, onOpenLevel }: { onBack: () => void; onOpenLevel: (level: Level) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [difficulty, setDifficulty] = useState<Difficulty>('普通')
  const [job, setJob] = useState<GenerationJob | null>(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [error, setError] = useState('')
  const [loadingLevel, setLoadingLevel] = useState(false)
  const steps = job?.steps ?? EMPTY_PIPELINE
  const completeCount = steps.filter((item) => item.status === 'completed').length
  const isGenerating = job?.status === 'queued' || job?.status === 'running'
  const localAsset = (path?: string) => assetUrl(path) ?? ''

  // URL 中保留任务标识：刷新或从录屏链接重新打开后，仍可看到同一条流水线与最终产物。
  useEffect(() => {
    const jobId = currentWorkshopJobId()
    if (!jobId) return
    let cancelled = false
    void readGenerationJob(jobId).then((restored) => {
      if (cancelled) return
      setJob(restored)
      setDifficulty(restored.difficulty ?? '普通')
      if (restored.referenceUrl) setPreviewUrl(restored.referenceUrl)
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : '无法恢复本地处理任务')
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!file) { setPreviewUrl(''); return }
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  useEffect(() => {
    if (!job || !isGenerating) return
    const timer = window.setInterval(() => {
      void readGenerationJob(job.id).then(setJob).catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : '无法读取本地处理状态')
      })
    }, 500)
    return () => window.clearInterval(timer)
  }, [isGenerating, job])

  function chooseFile(next: File | undefined) {
    if (!next) return
    setError('')
    setJob(null)
    setWorkshopJobId()
    if (!next.type.startsWith('image/')) { setError('请选择 JPG、PNG 或 WebP 图片。'); return }
    if (next.size > 15 * 1024 * 1024) { setError('图片不能超过 15MB。'); return }
    setFile(next)
  }

  async function beginGeneration() {
    if (!file || isGenerating) return
    setError('')
    try {
      const jobId = await startGenerationJob(file, difficulty)
      setJob({ id: jobId, status: 'queued', title: file.name, difficulty, steps: EMPTY_PIPELINE })
      setWorkshopJobId(jobId)
      const initial = await readGenerationJob(jobId)
      setJob(initial)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '本地关卡生成没有启动')
    }
  }

  async function openGeneratedLevel() {
    if (!job?.result) return
    setLoadingLevel(true)
    try {
      onOpenLevel(await loadGeneratedLevel(job.result, difficulty, file?.name ?? job.title))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '关卡已生成，但加载失败')
    } finally { setLoadingLevel(false) }
  }

  return <div className="app-shell workshop-shell">
    <header className="topbar">
      <button className="brand" onClick={onBack} aria-label="回到首页"><span className="brand-mark">✦</span><span>coloring game</span></button>
      <nav><button onClick={onBack}>返回首页</button></nav>
    </header>
    <main className="workshop-layout">
      <section className="workshop-intro">
        <p className="eyebrow">AI 图片改编工坊</p>
        <h1>把一张图片，重制成一关填色游戏。</h1>
        <p className="muted">原图将作为 AI 图生图参考，生成干净的 Coloring Book Line Art；随后自动识别可点击区域、提取原图色板并打包成关卡。</p>
        <div className="workshop-note"><span>⌁</span><p>参考图仅临时上传到内容存储供模型读取；线稿、Mask 与关卡文件保存在 <code>public/levels</code>。</p></div>
      </section>
      <section className="workshop-grid">
        <div className="workshop-card upload-card">
          <p className="eyebrow">1 · 设置素材</p><h2>选择要改编的图片</h2>
          <button className={`workshop-dropzone ${previewUrl ? 'workshop-dropzone--ready' : ''}`} onClick={() => inputRef.current?.click()} disabled={isGenerating}>
            {previewUrl ? <img src={previewUrl} alt="待转换图片预览" /> : <><span className="upload-icon">↑</span><strong>选择一张图片</strong><small>JPG / PNG / WebP，最大 15MB</small></>}
          </button>
          {file && <div className="selected-file"><span>✓</span><div><strong>{file.name}</strong><small>{Math.round(file.size / 1024)} KB · 已准备就绪</small></div><button onClick={() => inputRef.current?.click()} disabled={isGenerating}>更换</button></div>}
          {!file && job?.referenceUrl && <div className="selected-file"><span>✓</span><div><strong>{job.title}</strong><small>已恢复本次 AI 重制任务</small></div><button onClick={() => inputRef.current?.click()} disabled={isGenerating}>更换</button></div>}
          <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(event) => chooseFile(event.target.files?.[0])} />
          <div className="workshop-difficulty"><p>关卡难度</p><div className="difficulty-picker">{(Object.keys(DIFFICULTY_SPECS) as Difficulty[]).map((item) => <button key={item} className={difficulty === item ? 'chosen' : ''} disabled={isGenerating} onClick={() => setDifficulty(item)}><strong>{item}</strong><span>目标 {DIFFICULTY_SPECS[item].colors} 色 · {DIFFICULTY_SPECS[item].regions} 块</span></button>)}</div></div>
          <button className="primary workshop-start" disabled={!file || isGenerating} onClick={beginGeneration}>{isGenerating ? 'AI 正在重制…' : '开始 AI 重制关卡'}</button>
          {error && <p className="error-message">{error}</p>}
        </div>
        <div className="workshop-card pipeline-card">
          <div className="pipeline-heading"><div><p className="eyebrow">2 · 生成流水线</p><h2>{job?.status === 'completed' ? '关卡已经准备好了' : job?.status === 'failed' ? '本次生成需要重试' : isGenerating ? '正在 AI 重制' : '等待开始'}</h2></div><strong>{completeCount}/{steps.length}</strong></div>
          <div className="pipeline-progress"><span style={{ width: `${completeCount / steps.length * 100}%` }} /></div>
          <ol className="pipeline-list">{steps.map((step, index) => <li key={step.id} className={`pipeline-step pipeline-step--${step.status}`}><span className="pipeline-marker">{step.status === 'completed' ? '✓' : step.status === 'running' ? '…' : index + 1}</span><div><strong>{step.title}</strong><small>{step.message ?? step.description}</small></div><em>{step.status === 'completed' ? '完成' : step.status === 'running' ? '处理中' : '等待'}</em></li>)}</ol>
          {(job?.quality ?? job?.result?.quality) && <LineartQualityPanel report={job.quality ?? job.result!.quality!} />}
          {(job?.validation ?? job?.result?.validation) && <LevelValidationPanel report={job.validation ?? job.result!.validation!} />}
          {job?.status === 'completed' && job.result && <><div className="pipeline-review"><div>{job.result.lineart && <img src={localAsset(job.result.lineart)} alt="Coloring Book Line Art 线稿预览" />}<small>Coloring Book Line Art</small></div><div>{job.result.verify && <img src={localAsset(job.result.verify)} alt="区域与建议配色预览" />}<small>区域与建议配色</small></div></div><div className="pipeline-result"><span>✦</span><div><strong>生成了 {job.result.regions} 个区域、{job.result.colors} 种建议颜色</strong><small>线稿覆盖率 {job.result.lineCoverage ?? 0}% · Mask 与关卡配置已保存到本地。</small></div><button className="primary" disabled={loadingLevel} onClick={openGeneratedLevel}>{loadingLevel ? '正在打开…' : '确认并进入填色'}</button></div></>}
          {job?.status === 'failed' && <p className="error-message">{job.error ?? '处理失败，请更换图片后重试。'}</p>}
        </div>
      </section>
    </main>
  </div>
}

function HomePage({ onPlay, onWorkshop, onGallery }: { onPlay: () => void; onWorkshop: () => void; onGallery: () => void }) {
  return <div className="app-shell home-shell">
    <header className="topbar">
      <button className="brand" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} aria-label="回到首页"><span className="brand-mark">✦</span><span>coloring game</span></button>
      <nav><button onClick={onWorkshop}>关卡工坊</button><button onClick={onGallery}>我的画廊</button><button className="primary small" onClick={onWorkshop}>＋ 创作新图</button></nav>
    </header>
    <main className="home-main">
      <section className="home-hero">
        <div className="home-hero-copy"><p className="eyebrow">COLORING GAME · CREATE & COLOR</p><h1>把喜欢的画面，<br />变成一关填色游戏。</h1><p>上传一张图片，自动生成干净线稿、可点击区域与建议配色；完成后会保存在你的本地画廊。</p><div className="home-actions"><button className="primary" onClick={onPlay}>开始填色</button><button className="soft-button" onClick={onWorkshop}>去关卡工坊</button></div><small>线框填色 · 本地保存 · 可随时继续</small></div>
        <div className="home-hero-art"><div className="home-art-note">✦ 今日推荐</div><img src={assetUrl('/ling-ling-garden.png')} alt="女孩与小狗的花园填色作品" /><div className="home-art-caption"><strong>林间的幸福</strong><span>从一张图片开始创作</span></div></div>
      </section>
      <section className="home-entry-grid" aria-label="coloring game 功能入口">
        <button className="home-entry home-entry--play" onClick={onPlay}><span className="home-entry-icon">✎</span><span><b>线框填色</b><small>进入当前关卡，在线稿中自由上色。</small></span><em>开始 →</em></button>
        <button className="home-entry home-entry--workshop" onClick={onWorkshop}><span className="home-entry-icon">✦</span><span><b>关卡工坊</b><small>把一张图片自动改编为可玩的填色关卡。</small></span><em>创作 →</em></button>
        <button className="home-entry home-entry--gallery" onClick={onGallery}><span className="home-entry-icon">▣</span><span><b>我的画廊</b><small>查看、继续或整理已保存的作品。</small></span><em>查看 →</em></button>
      </section>
    </main>
  </div>
}

export default function App() {
  const [page, setPage] = useState<'home' | 'game' | 'workshop'>(() => {
    if (requestedLevelUrl() || window.location.hash === '#game') return 'game'
    return window.location.hash === '#workshop' ? 'workshop' : 'home'
  })
  const [customLevels, setCustomLevels] = useState<Level[]>([])
  const [removedLevelIds, setRemovedLevelIds] = useState<string[]>([])
  const [progress, setProgress] = useState<Progress>({})
  const [paintedColors, setPaintedColors] = useState<PaintedColors>({})
  const [activeId, setActiveId] = useState(catLevel.id)
  const [selectedColor, setSelectedColor] = useState(0)
  const [difficulty, setDifficulty] = useState<Difficulty>('普通')
  const [hydrated, setHydrated] = useState(false)
  const [showCreator, setShowCreator] = useState(false)
  const [showGallery, setShowGallery] = useState(false)
  const [notice, setNotice] = useState('选择颜色后，点击或拖动填色。按 H 可获得提示。')
  const [error, setError] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [isFinished, setIsFinished] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [energy, setEnergy] = useState(0)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [customColors, setCustomColors] = useState<Record<string, string[]>>({})
  const [canvasNames, setCanvasNames] = useState<Record<string, string>>({})
  const [showRegionNumbers, setShowRegionNumbers] = useState(false)
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const panDragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null)
  const historyRef = useRef<Record<string, { regionId: string; prev: number | undefined }[]>>({})
  const colorInputRef = useRef<HTMLInputElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const levels = useMemo(() => {
    const removed = new Set(removedLevelIds)
    return [...builtInLevels, ...customLevels].filter((item) => !removed.has(item.id))
  }, [customLevels, removedLevelIds])
  const rawLevel = levels.find((item) => item.id === activeId) ?? catLevel
  const savedCanvasName = canvasNames[rawLevel.id]?.trim()
  const level = savedCanvasName ? { ...rawLevel, title: savedCanvasName } : rawLevel
  const canvas = useMemo(() => {
    const [, , width = '640', height = '480'] = level.viewBox.trim().split(/\s+/)
    return { width: Number(width), height: Number(height) }
  }, [level.viewBox])
  const paletteAll = useMemo(() => [...level.palette, ...(customColors[level.id] ?? [])], [customColors, level.id, level.palette])
  const maskMode = Boolean(level.regionMaskWeb && level.outline && level.regions.some((region) => region.maskId))
  const lineArtMode = Boolean(level.lineArt && level.outline && level.reference)
  const supportsRegionNumbers = (maskMode || !lineArtMode) && level.regions.length > 0
  const referencePreview = level.reference ?? level.preview
  const completed = progress[level.id] ?? []
  const completedSet = useMemo(() => new Set(completed), [completed])
  const manualEnergyTarget = level.difficulty === '简单' ? 12 : level.difficulty === '普通' ? 20 : 28
  const completion = Math.round((completed.length / level.regions.length) * 100)

  useEffect(() => {
    let active = true
    void (async () => {
      const snapshot = await readSnapshot()
      try {
        const packagedLevels = await loadPackagedLevels()
        if (!active) return
        const importedUrl = requestedLevelUrl()
        let importedLevel: Level | null = null
        if (importedUrl) {
          try { importedLevel = await loadFreeFillLevel(importedUrl) }
          catch { setNotice('导入的真人线框关卡读取失败，请回到 AI 线稿工坊重新打包。') }
        }
        if (!active) return
        const savedLevels = snapshot?.customLevels ?? []
        const removed = new Set(snapshot?.removedLevelIds ?? [])
        const packageIds = new Set([...packagedLevels, ...(importedLevel ? [importedLevel] : [])].map((item) => item.id))
        const nextLevels = [
          ...(importedLevel ? [importedLevel] : []),
          ...packagedLevels.filter((item) => !removed.has(item.id)),
          ...savedLevels.filter((item) => !removed.has(item.id) && !packageIds.has(item.id) && item.id !== 'ling-ling-garden' && item.id !== 'ling-ling-garden-v2'),
        ]
        setCustomLevels(nextLevels)
        setRemovedLevelIds([...removed])
        setProgress(snapshot?.progress ?? {})
        setPaintedColors(snapshot?.paintedColors ?? {})
        setCustomColors(snapshot?.customColors ?? {})
        setCanvasNames(snapshot?.canvasNames ?? {})
        setShowRegionNumbers(snapshot?.showRegionNumbers ?? false)
        setActiveId(importedLevel?.id ?? packagedLevels[0]?.id ?? catLevel.id)
        if (importedLevel) setNotice(`已导入《${importedLevel.title}》：这是真人线框自由填色关卡。`)
      } catch {
        if (!active) return
        setCustomLevels(snapshot?.customLevels ?? [])
        setRemovedLevelIds(snapshot?.removedLevelIds ?? [])
        setProgress(snapshot?.progress ?? {})
        setPaintedColors(snapshot?.paintedColors ?? {})
        setCustomColors(snapshot?.customColors ?? {})
        setCanvasNames(snapshot?.canvasNames ?? {})
        setShowRegionNumbers(snapshot?.showRegionNumbers ?? false)
        setActiveId(snapshot?.activeId ?? catLevel.id)
        setNotice('预制图片加载失败，已回退到示范关卡。')
      } finally {
        if (active) setHydrated(true)
      }
    })()
    return () => { active = false }
  }, [])

  useEffect(() => { if (hydrated) void saveSnapshot({ progress, paintedColors, customLevels, activeId, customColors, removedLevelIds, canvasNames, showRegionNumbers }) }, [activeId, canvasNames, customColors, customLevels, hydrated, paintedColors, progress, removedLevelIds, showRegionNumbers])
  useEffect(() => { if (completion === 100 && level.regions.length > 0) setIsFinished(true) }, [completion, level.regions.length])
  useEffect(() => { setSelectedColor(level.outline ? -1 : 0) }, [level.id, level.outline])
  useEffect(() => { setIsEditingTitle(false) }, [level.id])

  function undoPaint() {
    const entry = historyRef.current[level.id]?.pop()
    if (!entry) { setNotice('没有可以撤销的填色。'); return }
    const region = level.regions.find((item) => item.id === entry.regionId)
    if (!region) return
    setPaintedColors((current) => {
      const nextLevel = { ...(current[level.id] ?? {}) }
      if (entry.prev === undefined) delete nextLevel[entry.regionId]
      else nextLevel[entry.regionId] = entry.prev
      return { ...current, [level.id]: nextLevel }
    })
    setProgress((current) => {
      const next = new Set(current[level.id] ?? [])
      if (entry.prev === region.color) next.add(entry.regionId)
      else next.delete(entry.regionId)
      return { ...current, [level.id]: [...next] }
    })
    setNotice('已撤销上一步填色。')
  }

  function selectNextColor() {
    const next = level.palette.findIndex((_, colorIndex) => level.regions.some((region) => region.color === colorIndex && !completedSet.has(region.id)))
    if (next >= 0) setSelectedColor(next)
  }

  function showHint() {
    if (selectedColor < 0) { setNotice('先从右侧选一种颜色，再开始填色。'); return }
    const count = level.regions.filter((region) => region.color === selectedColor && !completedSet.has(region.id)).length
    setNotice(count ? `这个颜色还剩 ${count} 个区域，试着在线稿内找到它们。` : '这个颜色的区域已经完成，换一种颜色吧。')
  }

  function paintRegion(region: Pick<Region, 'id' | 'color'>, automated = false) {
    if (!automated && selectedColor < 0) { setNotice('先从右侧调色板选择一种颜色。'); return }
    const paintedColor = automated ? region.color : selectedColor
    const correct = paintedColor === region.color
    const stack = historyRef.current[level.id] ?? (historyRef.current[level.id] = [])
    stack.push({ regionId: region.id, prev: paintedColors[level.id]?.[region.id] })
    if (stack.length > 300) stack.shift()
    const wasCorrect = completedSet.has(region.id)
    setPaintedColors((current) => ({ ...current, [level.id]: { ...(current[level.id] ?? {}), [region.id]: paintedColor } }))
    setProgress((current) => {
      const next = new Set(current[level.id] ?? [])
      if (correct) next.add(region.id)
      else next.delete(region.id)
      return { ...current, [level.id]: [...next] }
    })
    if (!correct) { setNotice(wasCorrect ? '已重新填色：边缘变红，说明颜色不匹配；可继续点击改正。' : '已填上颜色：边缘变红，说明颜色不匹配；换个颜色后可再次点击改正。'); return }
    const nextCompleted = wasCorrect ? completed : [...completed, region.id]
    if (!automated && !wasCorrect) setEnergy((current) => Math.min(manualEnergyTarget, current + 1))
    if (!automated) setNotice(wasCorrect ? '颜色保持匹配。' : '颜色匹配，填色完成。')
    if (!automated && level.regions.every((item) => item.color !== region.color || nextCompleted.includes(item.id))) {
      setNotice('这个颜色的区域已完成，已为你切换下一种颜色。')
      window.setTimeout(selectNextColor, 0)
    }
  }

  function releaseAssist() {
    if (energy < manualEnergyTarget) { setNotice(`还差 ${manualEnergyTarget - energy} 点能量，继续手动填色吧。`); return }
    const amount = level.difficulty === '简单' ? 5 : level.difficulty === '普通' ? 10 : 16
    const targets = level.regions.filter((region) => !completedSet.has(region.id)).sort((first, second) => {
      const firstArea = first.shape.kind === 'rect' ? first.shape.width * first.shape.height : 999999
      const secondArea = second.shape.kind === 'rect' ? second.shape.width * second.shape.height : 999999
      return firstArea - secondArea
    }).slice(0, amount)
    targets.forEach((region) => paintRegion(region, true))
    setEnergy(0)
    setNotice(`小助手完成了 ${targets.length} 块最细碎的区域。`)
  }

  function startLevel(next: Level) {
    setActiveId(next.id); setSelectedColor(next.outline ? -1 : 0); setEnergy(0); setIsFinished(false); setZoom(1); setPan({ x: 0, y: 0 }); setShowGallery(false)
    const canvasName = canvasNames[next.id]?.trim() || next.title
    setNotice(`开始《${canvasName}》，选择颜色后点击或拖动上色。`)
  }

  function beginRenameCanvas() {
    setTitleDraft(level.title)
    setIsEditingTitle(true)
  }

  function saveCanvasName() {
    const nextName = titleDraft.trim().slice(0, 48)
    if (!nextName) {
      setNotice('画布名称不能为空。')
      return
    }
    setCanvasNames((current) => ({ ...current, [level.id]: nextName }))
    setIsEditingTitle(false)
    setNotice(`画布已重命名为《${nextName}》。`)
  }

  function restoreCanvasName() {
    setCanvasNames((current) => {
      const { [level.id]: _renamed, ...next } = current
      return next
    })
    setIsEditingTitle(false)
    setNotice('已恢复关卡原始名称。')
  }

  function deleteGalleryLevel(target: Level) {
    const canvasName = canvasNames[target.id]?.trim() || target.title
    const confirmed = window.confirm(`删除《${canvasName}》吗？这会同时删除本机保存的填色进度，且无法恢复。`)
    if (!confirmed) return

    setCustomLevels((current) => current.filter((item) => item.id !== target.id))
    setRemovedLevelIds((current) => current.includes(target.id) ? current : [...current, target.id])
    setProgress((current) => {
      const { [target.id]: _removed, ...next } = current
      return next
    })
    setPaintedColors((current) => {
      const { [target.id]: _removed, ...next } = current
      return next
    })
    setCustomColors((current) => {
      const { [target.id]: _removed, ...next } = current
      return next
    })
    setCanvasNames((current) => {
      const { [target.id]: _removed, ...next } = current
      return next
    })
    delete historyRef.current[target.id]
    if (activeId === target.id) {
      const fallback = levels.find((item) => item.id !== target.id) ?? catLevel
      setActiveId(fallback.id)
      setSelectedColor(fallback.outline ? -1 : 0)
      setEnergy(0)
      setIsFinished(false)
      setZoom(1)
      setPan({ x: 0, y: 0 })
    }
    setNotice(`已从本地画廊删除《${canvasName}》。`)
  }

  function resetLevel() {
    setProgress((current) => ({ ...current, [level.id]: [] }))
    setPaintedColors((current) => ({ ...current, [level.id]: {} }))
    setEnergy(0)
    setIsFinished(false)
    setSelectedColor(level.outline ? -1 : 0)
    setZoom(1)
    setPan({ x: 0, y: 0 })
    historyRef.current[level.id] = []
    setNotice('本关卡已重置，所有填色已清空。')
  }

  async function onUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setError('')
    if (!file.type.startsWith('image/')) { setError('请选择 JPG、PNG 或 WebP 图片。'); return }
    if (file.size > 10 * 1024 * 1024) { setError('图片不能超过 10MB。'); return }
    setIsGenerating(true)
    try {
      const created = await createPhotoLevel(file, difficulty)
      setCustomLevels((current) => [created, ...current])
      setRemovedLevelIds((current) => current.filter((id) => id !== created.id))
      startLevel(created)
      setShowCreator(false)
      setNotice('本地图片已转换为填色关卡。选择右侧颜色后开始填色。')
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : '图片转换失败，请换一张图片试试。')
    } finally { setIsGenerating(false); event.target.value = '' }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); undoPaint(); return }
      if (event.key === 'Tab') { event.preventDefault(); selectNextColor() }
      if (event.key.toLowerCase() === 'h') showHint()
      if (event.key.toLowerCase() === 'f') releaseAssist()
      if (event.key === '+' || event.key === '=') setZoom((value) => Math.min(2.4, value + .1))
      if (event.key === '-') setZoom((value) => Math.max(.65, value - .1))
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  useEffect(() => {
    const syncPage = () => {
      if (requestedLevelUrl() || window.location.hash === '#game') setPage('game')
      else setPage(window.location.hash === '#workshop' ? 'workshop' : 'home')
    }
    window.addEventListener('hashchange', syncPage)
    return () => window.removeEventListener('hashchange', syncPage)
  }, [])

  function navigate(next: 'home' | 'game' | 'workshop') {
    window.location.hash = next === 'workshop' ? 'workshop' : next === 'game' ? 'game' : ''
    setPage(next)
  }

  if (page === 'workshop') return <WorkshopPage onBack={() => navigate('home')} onOpenLevel={(created) => {
    setCustomLevels((current) => [created, ...current.filter((item) => item.id !== created.id)])
    setRemovedLevelIds((current) => current.filter((id) => id !== created.id))
    startLevel(created)
    navigate('game')
  }} />

  if (page === 'home') return <HomePage onPlay={() => navigate('game')} onWorkshop={() => navigate('workshop')} onGallery={() => { setShowGallery(true); navigate('game') }} />

  // #game 首次打开时，关卡清单尚在异步加载。不要先用旧 SVG 兜底关卡渲染，
  // 否则正式关卡到达后会产生错误线稿的闪帧。
  if (!hydrated) return <div className="app-shell game-boot-shell">
    <header className="topbar">
      <button className="brand" onClick={() => navigate('home')} aria-label="回到首页"><span className="brand-mark">✦</span><span>coloring game</span></button>
    </header>
    <main className="game-boot" aria-live="polite"><span className="game-boot-spinner" aria-hidden="true" /><strong>正在载入画册…</strong><small>正在准备正式线稿和填色区域</small></main>
  </div>

  return <div className="app-shell">
    <header className="topbar">
      <button className="brand" onClick={() => navigate('home')} aria-label="回到首页"><span className="brand-mark">✦</span><span>coloring game</span></button>
      <nav><button onClick={() => navigate('workshop')}>关卡工坊</button><button onClick={() => setShowGallery(true)}>我的画廊</button><button className="primary small" onClick={() => navigate('workshop')}>＋ 创作新图</button></nav>
    </header>
    <main className="game-layout">
      <aside className="side-panel level-panel">
        <p className="eyebrow">正在填色</p>
        {referencePreview && <section className="reference-card">
          <div className="reference-card-head"><strong>建议填色参考</strong><span>完成效果</span></div>
          <img src={referencePreview} alt={`${level.title} 的建议填色参考图`} />
          <small>按这张图的配色完成；主画布仍只显示线稿。</small>
        </section>}
        <div className="level-title-row">
          {isEditingTitle ? <input className="canvas-name-input" value={titleDraft} maxLength={48} autoFocus aria-label="画布名称" onChange={(event) => setTitleDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') saveCanvasName(); if (event.key === 'Escape') setIsEditingTitle(false) }} /> : <h1>{level.title}</h1>}
          {!isEditingTitle && <button className="rename-button" onClick={beginRenameCanvas}>重命名</button>}
        </div>
        {isEditingTitle && <div className="rename-actions"><button className="soft-button" onClick={saveCanvasName}>保存</button><button className="text-button" onClick={() => setIsEditingTitle(false)}>取消</button>{canvasNames[level.id] && <button className="text-button" onClick={restoreCanvasName}>恢复原名</button>}</div>}
        <p className="muted">{level.subtitle}</p>
        <p className="difficulty-target">本关：{level.palette.length} 色 · {level.regions.length} 个区域<br />{level.difficulty}目标：{DIFFICULTY_SPECS[level.difficulty].colors} 色 · {DIFFICULTY_SPECS[level.difficulty].regions} 块</p>
        <div className="progress-block"><div className="progress-label"><span>完成进度</span><strong>{completion}%</strong></div><div className="progress-track"><span style={{ width: `${completion}%` }} /></div><p>{completed.length} / {level.regions.length} 个区域</p></div>
        <div className="assist-card"><div className="assist-head"><span>✦ 填色助力</span><strong>{energy}/{manualEnergyTarget}</strong></div><div className="energy-track"><span style={{ width: `${energy / manualEnergyTarget * 100}%` }} /></div><p>手动填色充能，满格后自动清理最细碎的区域。</p><button className="soft-button" onClick={releaseAssist}>释放助力 <kbd>F</kbd></button></div>
        <div className="tip-card"><span>⌁</span><p>{notice}</p></div>
      </aside>
      <section className="canvas-section">
        <div className="canvas-toolbar"><div><span className="dot" />{level.official ? '官方示范关卡' : level.custom ? '本地图片关卡' : '官方示范关卡'} · {level.difficulty}</div><div className="zoom-controls"><button className="reset-button" onClick={undoPaint}>撤销</button>{supportsRegionNumbers && <button className="reset-button number-toggle" onClick={() => setShowRegionNumbers((current) => !current)}>{showRegionNumbers ? '隐藏数字' : '显示数字'}</button>}<button onClick={() => setZoom((value) => Math.max(.65, value - .1))}>−</button><span>{Math.round(zoom * 100)}%</span><button onClick={() => setZoom((value) => Math.min(2.4, value + .1))}>＋</button><button className="reset-button" onClick={resetLevel}>重置</button></div></div>
        <div className="canvas-viewport"
          onWheel={(event) => { event.preventDefault(); setZoom((value) => Math.min(2.4, Math.max(.65, value + (event.deltaY < 0 ? .08 : -.08)))) }}
          onPointerDown={(event) => {
            const onRegion = Boolean((event.target as Element).closest?.('.region'))
            const onMaskCanvas = Boolean((event.target as Element).closest?.('.raster-input-canvas'))
            if ((onRegion || onMaskCanvas) && event.button !== 1) return  // 左键填色，不同时触发画布平移
            if (event.button !== 0 && event.button !== 1) return
            panDragRef.current = { startX: event.clientX, startY: event.clientY, baseX: pan.x, baseY: pan.y }
            event.currentTarget.setPointerCapture(event.pointerId)
          }}
          onPointerMove={(event) => {
            const drag = panDragRef.current
            if (!drag) return
            setPan({ x: drag.baseX + event.clientX - drag.startX, y: drag.baseY + event.clientY - drag.startY })
          }}
          onPointerUp={() => { panDragRef.current = null }}
          onPointerCancel={() => { panDragRef.current = null }}>
          <div className="canvas-stack" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
            {level.outline && <img className="guide-outline" src={level.outline} alt="" aria-hidden="true" />}
            {maskMode ? <MaskColorCanvas level={level} palette={paletteAll} width={canvas.width} height={canvas.height} paintedColors={paintedColors[level.id] ?? {}} onPaint={paintRegion} /> : lineArtMode ? <LineArtCanvas level={level} palette={paletteAll} width={canvas.width} height={canvas.height} paintedColors={paintedColors[level.id] ?? {}} selectedColor={selectedColor} onPaint={paintRegion} onBlocked={() => setNotice('请点击被黑线完整围住的空白区域。')} /> : <svg className="coloring-canvas" viewBox={level.viewBox} aria-label={`${level.title} 填色画布`}>
            {level.custom && level.preview && !level.outline && <defs>{level.regions.map((region) => <clipPath key={region.id} id={`clip-${level.id}-${region.id}`}><RegionGeometry region={region} /></clipPath>)}</defs>}
            {!level.outline && <rect width={canvas.width} height={canvas.height} fill="#fffdf8" rx="18" />}
            {level.custom && level.preview && !level.outline && <image className="source-ghost" href={level.preview} x="0" y="0" width={canvas.width} height={canvas.height} preserveAspectRatio="xMidYMid slice" />}
            {level.regions.map((region) => { const filled = completedSet.has(region.id); const paintedColor = paintedColors[level.id]?.[region.id]; const isPainted = filled || paintedColor !== undefined; const clipId = `clip-${level.id}-${region.id}`; return <g key={region.id}><RegionShape region={region} filled={filled} guide={Boolean(level.outline)} onPaint={() => paintRegion(region)} />{isPainted && (level.custom && level.preview && !level.outline ? <RegionImageFill region={region} source={level.preview} clipId={clipId} canvas={canvas} /> : <RegionFill region={region} color={paletteAll[paintedColor ?? region.color] ?? '#000000'} guide={Boolean(level.outline)} />)}</g> })}
            {level.outline && level.regions.map((region) => { const paintedColor = paintedColors[level.id]?.[region.id]; const filled = completedSet.has(region.id); const isPainted = filled || paintedColor !== undefined; if (!isPainted) return null; return <RegionResultEdge key={`outline-${region.id}`} region={region} correct={(paintedColor ?? region.color) === region.color} /> })}
            </svg>}
            <RegionNumberLabels level={level} paintedColors={paintedColors[level.id] ?? {}} selectedColor={selectedColor} visible={supportsRegionNumbers && showRegionNumbers} />
          </div>
        </div>
        <p className="canvas-hint">滚轮缩放 · 空白处或中键拖动平移 · <kbd>Ctrl</kbd>+<kbd>Z</kbd> 撤销 · <kbd>H</kbd> 提示 · <kbd>F</kbd> 自动助力</p>
      </section>
      <aside className="side-panel palette-panel"><p className="eyebrow">调色板</p><h2>{selectedColor < 0 ? '先选择一种颜色' : '选择一种颜色'}</h2><div className="palette-list">
        {level.palette.map((color, index) => { const total = level.regions.filter((region) => region.color === index).length; const count = level.regions.filter((region) => region.color === index && completedSet.has(region.id)).length; if (!total) return null; return <button key={color + index} aria-label={`选择颜色 ${index + 1}`} className={`palette-item ${selectedColor === index ? 'palette-item--active' : ''} ${count === total ? 'palette-item--done' : ''}`} onClick={() => setSelectedColor(index)}><span className={`swatch ${showRegionNumbers ? 'swatch--numbered' : ''}`} style={{ background: color, color: swatchNumberColor(color) }}>{showRegionNumbers && <b>{index + 1}</b>}</span><span className="palette-meta">{count === total ? '已完成' : `${total - count} 个区域待完成`}</span>{count === total && <span className="check">✓</span>}</button> })}
        {(customColors[level.id] ?? []).map((color, offset) => { const index = level.palette.length + offset; return <button key={`custom-${color}-${offset}`} aria-label={`选择自定义颜色 ${offset + 1}`} className={`palette-item palette-item--custom ${selectedColor === index ? 'palette-item--active' : ''}`} onClick={() => setSelectedColor(index)}><span className="swatch" style={{ background: color }} /><span className="palette-meta">自定义 · 自由填色</span></button> })}
        <button className="palette-item palette-item--add" onClick={() => colorInputRef.current?.click()}><span className="swatch swatch--add">＋</span><span className="palette-meta">添加自定义颜色</span></button>
        <input ref={colorInputRef} type="color" hidden onChange={(event) => { const picked = event.target.value; if (!picked) return; const nextIndex = level.palette.length + (customColors[level.id]?.length ?? 0); setCustomColors((current) => ({ ...current, [level.id]: [...(current[level.id] ?? []), picked] })); setSelectedColor(nextIndex); setNotice('已添加自定义颜色，可自由填色（不参与对错判定）。') }} />
      </div></aside>
    </main>
    {showCreator && <div className="modal-backdrop" role="presentation" onMouseDown={() => !isGenerating && setShowCreator(false)}><section className="modal creator-modal" role="dialog" aria-modal="true" aria-label="创作一张本地填色画" onMouseDown={(event) => event.stopPropagation()}><button className="close-button" onClick={() => setShowCreator(false)} aria-label="关闭">×</button><p className="eyebrow">本地创作</p><h2>把一张照片变成填色画</h2><p className="muted">由本地关卡生成服务完成区域分割、线框与色板提取；图片不离开你的电脑。</p><div className="difficulty-picker">{(Object.keys(DIFFICULTY_SPECS) as Difficulty[]).map((item) => <button key={item} className={difficulty === item ? 'chosen' : ''} onClick={() => setDifficulty(item)}><strong>{item}</strong><span>目标 {DIFFICULTY_SPECS[item].colors} 色 · {DIFFICULTY_SPECS[item].regions} 块</span></button>)}</div><button className="upload-zone" onClick={() => inputRef.current?.click()} disabled={isGenerating}><span className="upload-icon">↑</span><strong>{isGenerating ? '正在生成本地关卡…' : '选择一张图片'}</strong><small>支持 JPG / PNG / WebP，最大 10MB</small></button>{error && <p className="error-message">{error}</p>}<input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={onUpload} /></section></div>}
    {showGallery && <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowGallery(false)}><section className="modal gallery-modal" role="dialog" aria-modal="true" aria-label="我的画廊" onMouseDown={(event) => event.stopPropagation()}><button className="close-button" onClick={() => setShowGallery(false)} aria-label="关闭">×</button><p className="eyebrow">本地画廊</p><h2>继续你的填色作品</h2><div className="gallery-grid">{levels.map((item) => { const itemProgress = progress[item.id] ?? []; const itemCompletion = Math.round(itemProgress.length / item.regions.length * 100); const itemTitle = canvasNames[item.id]?.trim() || item.title; return <article className="gallery-card" key={item.id}><button className="gallery-open" onClick={() => startLevel(item)}><div className="gallery-preview" style={item.preview ? { backgroundImage: `url(${item.preview})` } : { background: item.palette[0] }}>{!item.preview && <span>{itemTitle.slice(0, 1)}</span>}</div><div><strong>{itemTitle}</strong><small>{item.difficulty} · {itemCompletion}% 完成</small></div></button><button className="gallery-delete" onClick={() => deleteGalleryLevel(item)} aria-label={`删除${itemTitle}`}>删除</button></article> })}{levels.length === 0 && <p className="muted gallery-empty">画廊还没有作品。去创作一张新的填色图吧。</p>}</div></section></div>}
    {isFinished && <div className="modal-backdrop finish-backdrop"><section className="modal finish-modal" role="dialog" aria-modal="true" aria-label="完成作品"><span className="finish-star">✦</span><p className="eyebrow">完成作品</p><h2>这幅画被你点亮了！</h2><p className="muted">《{level.title}》已自动保存到本地画廊。</p><div className="finish-actions"><button className="soft-button" onClick={() => { setIsFinished(false); setShowGallery(true) }}>查看画廊</button><button className="primary" onClick={() => { setIsFinished(false); navigate('workshop') }}>再创作一张</button></div></section></div>}
  </div>
}
