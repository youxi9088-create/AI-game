import fs from 'node:fs/promises'
import path from 'node:path'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
globalThis.ProgressEvent = class { constructor(type, data) { this.type = type; Object.assign(this, data) } }
const reports = []
for (const directory of process.argv.slice(2)) {
  const catalog = JSON.parse(await fs.readFile(path.join(directory, 'catalog.json'), 'utf8'))
  const errors = []; let checked = 0, reloaded = 0
  for (const entry of catalog.assets) {
    try {
      const bytes = await fs.readFile(path.join(directory, entry.file))
      if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) throw new Error('Invalid GLB header')
      const n = bytes.readUInt32LE(12), json = JSON.parse(bytes.subarray(20, 20 + n))
      const bin = bytes.subarray(28 + n)
      for (const view of json.bufferViews || []) if ((view.byteOffset || 0) + view.byteLength > bin.length) throw new Error('Invalid buffer view')
      for (const image of json.images || []) await fs.access(path.join(directory, image.uri))
      for (const a of json.accessors || []) if ([...(a.min || []), ...(a.max || [])].some(v => !Number.isFinite(v))) throw new Error('Non-finite accessor bounds')
      checked++
      // Reload representative geometries using the production Three.js loader.
      // Textures are checked as file references here, not visually certified.
      if (reloaded < 8 || entry.name === 'Room_30') {
        delete json.images; delete json.textures; delete json.samplers
        for (const m of json.materials || []) {
          delete m.pbrMetallicRoughness.baseColorTexture; delete m.pbrMetallicRoughness.metallicRoughnessTexture
          delete m.normalTexture; delete m.emissiveTexture; delete m.occlusionTexture
        }
        json.buffers[0].uri = `data:application/octet-stream;base64,${bin.toString('base64')}`
        const gltf = await new GLTFLoader().parseAsync(JSON.stringify(json), '')
        const bounds = new THREE.Box3().setFromObject(gltf.scene)
        const size = bounds.getSize(new THREE.Vector3()).toArray()
        if (size.some((value, i) => Math.abs(value - entry.size[i]) > .001)) throw new Error('Round-trip dimensions changed')
        if (Math.abs(bounds.min.y) > .001 || Math.abs((bounds.min.x + bounds.max.x) / 2) > .001 || Math.abs((bounds.min.z + bounds.max.z) / 2) > .001) throw new Error('Origin not centered and grounded')
        gltf.scene.traverse(node => { if (node.isMesh) { node.geometry.dispose(); for (const m of [].concat(node.material)) m.dispose() } })
        reloaded++
      }
    } catch (error) { errors.push({ file: entry.file, error: error.message }) }
  }
  const report = { directory, assets: catalog.assets.length, checked, reloaded, errors, visualReview: 'NOT RUN - browser access policy blocked' }
  reports.push(report)
  await fs.writeFile(path.join(directory, 'validation.json'), JSON.stringify(report, null, 2))
}
console.log(JSON.stringify(reports, null, 2))
if (reports.some(report => report.errors.length)) process.exitCode = 1
