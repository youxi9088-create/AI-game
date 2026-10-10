import fs from 'node:fs/promises'
import path from 'node:path'
for (const pack of ['interior-1', 'low-poly-rooms', 'goodies-cozy']) {
  const source = path.resolve('.asset-work/converted', pack)
  const target = path.resolve('public/content', pack)
  const catalog = JSON.parse(await fs.readFile(path.join(source, 'catalog.json'), 'utf8'))
  await fs.mkdir(target, { recursive: true })
  for (const filename of [...catalog.assets.map(a => a.file), ...(catalog.textures || [catalog.texture]), 'catalog.json']) {
    if (path.basename(filename) !== filename) throw new Error('Unexpected asset path')
    await fs.copyFile(path.join(source, filename), path.join(target, filename))
  }
  console.log(`${pack}: ${catalog.assets.length} models synced locally`)
}
