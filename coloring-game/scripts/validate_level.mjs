import { access, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const [levelPath] = process.argv.slice(2)
if (!levelPath) throw new Error('Usage: node scripts/validate_level.mjs <level.json>')
const file = resolve(levelPath)
const level = JSON.parse(await readFile(file, 'utf8'))
const errors = []
if (!level.id || !Array.isArray(level.palette) || !Array.isArray(level.regions)) errors.push('Missing required level fields')
const ids = new Set()
for (const region of level.regions ?? []) {
  if (!region.id || ids.has(region.id)) errors.push(`Duplicate or empty region id: ${region.id}`)
  ids.add(region.id)
  if (!Number.isInteger(region.color) || region.color < 0 || region.color >= level.palette.length) errors.push(`Invalid color index: ${region.id}`)
  if (region.shape?.kind !== 'path' || !region.shape.d?.trim()) errors.push(`Invalid path: ${region.id}`)
}
for (const asset of [level.preview, level.outline]) {
  try { await access(resolve('public', asset.replace(/^\//, ''))) } catch { errors.push(`Missing asset: ${asset}`) }
}
const result = { id: level.id, regions: level.regions?.length ?? 0, colors: level.palette?.length ?? 0, errors }
console.log(JSON.stringify(result, null, 2))
if (errors.length) process.exit(1)
