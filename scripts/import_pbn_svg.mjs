import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'

const [svgPath, outputDir, levelId = 'forest-001'] = process.argv.slice(2)
if (!svgPath || !outputDir) throw new Error('Usage: node scripts/import_pbn_svg.mjs <preview.svg> <output-dir> [level-id]')

const svg = await readFile(resolve(svgPath), 'utf8')
const viewBox = svg.match(/viewBox="([^"]+)"/)?.[1]
if (!viewBox) throw new Error('SVG is missing a viewBox')

const paths = [...svg.matchAll(/<path\b([^>]*)><\/path>|<path\b([^>]*)\/>/g)].map((match) => {
  const attributes = match[1] ?? match[2]
  const d = attributes.match(/\bd="([^"]+)"/)?.[1]
  const facetId = attributes.match(/data-facetId="(\d+)"/)?.[1]
  const rgb = attributes.match(/fill:\s*rgb\((\d+),(\d+),(\d+)\)/)?.slice(1).map(Number)
  if (!d || facetId === undefined || !rgb) throw new Error('SVG path is missing data-facetId, d, or fill color')
  return { d, facetId: Number(facetId), color: `#${rgb.map((value) => value.toString(16).padStart(2, '0')).join('')}` }
}).sort((left, right) => left.facetId - right.facetId)

const palette = [...new Set(paths.map((path) => path.color))]
const level = {
  id: levelId,
  title: '林间的幸福',
  subtitle: '原创图片生成的简单难度关卡。',
  difficulty: '简单',
  viewBox,
  palette,
  regions: paths.map((path, index) => ({ id: `r-${String(index + 1).padStart(4, '0')}`, color: palette.indexOf(path.color), shape: { kind: 'path', d: path.d } })),
  preview: `/levels/${levelId}/preview.svg`,
  outline: `/levels/${levelId}/outline.svg`
}

await mkdir(resolve(outputDir), { recursive: true })
await writeFile(resolve(outputDir, 'level.json'), `${JSON.stringify(level, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ level: basename(outputDir), regions: level.regions.length, colors: palette.length, viewBox }, null, 2))
