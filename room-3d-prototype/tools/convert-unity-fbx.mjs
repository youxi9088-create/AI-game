// Static meshes only: Unity scripts, shaders and Prefab behaviours are not executed.
import fs from 'node:fs/promises'
import path from 'node:path'
import * as THREE from 'three'
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'

globalThis.window = { URL, innerWidth: 1024, innerHeight: 768 }
globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(result => { this.result = result; this.onloadend?.() }) }
  readAsDataURL(blob) { blob.arrayBuffer().then(result => { this.result = `data:${blob.type};base64,${Buffer.from(result).toString('base64')}`; this.onloadend?.() }) }
}
const [source, destination, selection = '.*'] = process.argv.slice(2)
if (!source || !destination) throw new Error('Usage: node tools/convert-unity-fbx.mjs extracted-dir output-dir [name-regex]')
await fs.mkdir(destination, { recursive: true })
const manifest = JSON.parse(await fs.readFile(path.join(source, 'asset-manifest.json'), 'utf8'))
const goodies = path.basename(source) === 'goodies-cozy'
const unity = goodies ? JSON.parse(await fs.readFile(path.join(destination, 'unity-materials.json'), 'utf8')) : null
const texture = manifest.find(a => a.path.endsWith('.png'))
if (!texture) throw new Error('No palette texture; this converter requires the verified single-material packs.')
const palette = await fs.readFile(path.join(source, texture.path))
// Keep the shared original PNG once; avoid embedding a 4 MB palette in every prop.
if (!goodies) await fs.writeFile(path.join(destination, 'palette.png'), palette)
const stub = { path: '', setPath(p) { this.path = p; return this }, load() { return new THREE.Texture() } }
const loader = new FBXLoader(new THREE.LoadingManager().addHandler(/.*/, stub))
const match = new RegExp(selection, 'i')
const results = [], errors = [], skipped = [], repairs = []
function injectPalette(buffer) {
  const b = Buffer.from(buffer), n = b.readUInt32LE(12)
  const json = JSON.parse(b.subarray(20, 20 + n).toString())
  if (goodies) {
    json.images = []; json.textures = []
    json.samplers = [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }]
    json.materials = (json.materials || []).map(m => {
      const definition = unity.materials[m.name]
      if (!definition) throw new Error(`Unresolved material ${m.name}`)
      const result = structuredClone(definition.gltf)
      for (const [channel, info] of Object.entries(definition.maps)) {
        const index = json.textures.length
        json.images.push({ uri: info.file }); json.textures.push({ sampler: 0, source: index })
        const texInfo = { index, extensions: { KHR_texture_transform: info.transform } }
        if (info.scale !== undefined) texInfo.scale = info.scale
        if (channel === 'baseColorTexture' || channel === 'metallicRoughnessTexture') result.pbrMetallicRoughness[channel] = texInfo
        else result[channel] = texInfo
      }
      return result
    })
    json.extensionsUsed = [...new Set([...(json.extensionsUsed || []), 'KHR_texture_transform'])]
  } else {
  json.images = [{ uri: 'palette.png' }]
  json.samplers = [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }]
  json.textures = [{ sampler: 0, source: 0 }]
  for (const m of json.materials || []) m.pbrMetallicRoughness.baseColorTexture = { index: 0 }
  }
  const raw = Buffer.from(JSON.stringify(json)), padded = Buffer.alloc(Math.ceil(raw.length / 4) * 4, 32)
  raw.copy(padded)
  const bin = b.subarray(20 + n)
  const head = Buffer.alloc(20)
  head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4)
  head.writeUInt32LE(20 + padded.length + bin.length, 8)
  head.writeUInt32LE(padded.length, 12); head.writeUInt32LE(0x4e4f534a, 16)
  return Buffer.concat([head, padded, bin])
}
for (const entry of manifest.filter(a => a.path.toLowerCase().endsWith('.fbx'))) {
  const stem = path.basename(entry.path, '.fbx')
  const packed = stem.startsWith('SM_LowPoly')
  if (!packed && !match.test(stem)) continue
  try {
    const bytes = await fs.readFile(path.join(source, entry.path))
    const scene = loader.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')
    scene.updateMatrixWorld(true)
    const units = goodies ? 1 : (scene.userData.unitScaleFactor || 1) / 100
    const candidates = stem.includes('1000') ? scene.children.flatMap(category => category.children) : scene.children
    let parts = packed ? candidates.filter(n => match.test(n.name)) : [scene]
    if (goodies) {
      const bindings = unity.bindings[entry.guid] || []
      const unique = [...new Map(bindings.map(b => [JSON.stringify(b.nodes), b])).values()]
      if (!unique.length) throw new Error('No verified Prefab material binding')
      parts = unique.map((binding, i) => { const part = scene.clone(true); part.userData.binding = binding; part.userData.variantName = i ? `${stem}__variant${i+1}` : stem; return part })
    }
    if (packed) console.log(`${stem}: ${scene.children.length} root nodes; selected ${parts.length}`)
    for (const part of parts) {
      const name = goodies ? part.userData.variantName : packed ? part.name : stem
      const model = part.clone(true)
      model.applyMatrix4(part.parent?.matrixWorld || new THREE.Matrix4())
      // Both inspected packs declare FBX GlobalSettings UpAxis=2 (Z), sign=+1.
      // FBXLoader preserves that basis instead of converting to Three's Y-up.
      if (!goodies) model.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2))
      if (goodies) {
        const nodes = []; model.traverse(n => { if (n.isMesh) nodes.push(n) })
        const bindings = part.userData.binding.nodes
        const normalize = s => s.replace(/\s*\(\d+\)$/, '').replace(/\d+$/, '')
        for (const node of nodes) {
          const aliases = Object.entries(bindings).filter(([key]) => normalize(key) === normalize(node.name))
          const identical = aliases.length && aliases.every(([, v]) => JSON.stringify(v) === JSON.stringify(aliases[0][1]))
          node.userData.unitySlots = bindings[node.name] || (identical ? aliases[0][1] : undefined) || (nodes.length === 1 && Object.keys(bindings).length === 1 ? Object.values(bindings)[0] : undefined)
          if (!node.userData.unitySlots) { repairs.push({ name, excludedUnreferencedPrefabMesh: node.name }); node.removeFromParent() }
        }
      }
      let triangles = 0, meshes = 0
      model.traverse(node => {
        if (!node.isMesh) return
        if (node.isSkinnedMesh) throw new Error('Skinned meshes require a separate conversion route')
        meshes++
        node.geometry = node.geometry.clone()
        for (const [attributeName, attribute] of Object.entries(node.geometry.attributes)) {
          if (Array.from(attribute.array).every(Number.isFinite)) continue
          // These packs use only UV0 for their palette, no light maps. Some source
          // meshes contain NaN in unused secondary UVs; omit that invalid channel.
          if (/^uv[1-9]/.test(attributeName)) {
            node.geometry.deleteAttribute(attributeName)
            repairs.push({ name, mesh: node.name, removedUnusedAttribute: attributeName })
          } else throw new Error(`Non-finite ${attributeName} in ${node.name}`)
        }
        const uv = node.geometry.getAttribute('uv')
        if (!uv) throw new Error(`Missing UVs: ${node.name}`)
        // FBX/Unity maps use bottom-left UV origin; glTF uses top-left.
        for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i))
        triangles += (node.geometry.index?.count || node.geometry.attributes.position.count) / 3
        if (goodies) {
          const slots = node.userData.unitySlots
          if (!slots) throw new Error(`Missing node material mapping: ${node.name}`)
          const old = [].concat(node.material)
          if (slots.length !== old.length) throw new Error(`Material slot mismatch: ${node.name}: ${old.length} vs ${slots.length}`)
          const mapped = slots.map(guid => new THREE.MeshStandardMaterial({ name: guid, color: 0xffffff }))
          node.material = Array.isArray(node.material) ? mapped : mapped[0]
        } else node.material = new THREE.MeshStandardMaterial({ name: 'Unity palette', color: 0xffffff, roughness: .72, metalness: 0 })
      })
      if (!meshes) { skipped.push({ name, source: entry.path, reason: 'Empty node without mesh geometry' }); continue }
      const root = new THREE.Group()
      root.name = name; root.add(model); root.scale.setScalar(units)
      root.updateMatrixWorld(true)
      const box = new THREE.Box3().setFromObject(root), center = box.getCenter(new THREE.Vector3())
      const size = box.getSize(new THREE.Vector3())
      // Move the content, not the exported root pivot: center XZ, ground Y.
      model.position.sub(new THREE.Vector3(center.x, box.min.y, center.z).divideScalar(units))
      root.userData = { sourcePackage: path.basename(source), sourceAsset: entry.path, originalName: name, licensedAsset: true }
      const buffer = await new GLTFExporter().parseAsync(root, { binary: true })
      const output = injectPalette(buffer)
      const safeName = name.replace(/[^a-zA-Z0-9_.-]/g, '_')
      let filename = `${safeName}.glb`, suffix = 2
      while (results.some(r => r.file === filename)) filename = `${safeName}__${suffix++}.glb`
      await fs.writeFile(path.join(destination, filename), output)
      results.push({ name, file: filename, size: size.toArray(), meshes, triangles, bytes: output.length, source: entry.path })
    }
  } catch (error) { errors.push({ source: entry.path, message: error.message }); console.error(entry.path, error.message) }
}
await fs.writeFile(path.join(destination, 'catalog.json'), JSON.stringify({ assets: results, errors, skipped, repairs, textures: goodies ? unity.textures : ['palette.png'], texture: goodies ? undefined : 'palette.png', note: 'Static geometry/material conversion, not Unity scene/behaviour conversion. Keep referenced PNGs next to GLBs.' }, null, 2))
console.log(JSON.stringify({ converted: results.length, errors: errors.length, triangles: results.reduce((n, a) => n + a.triangles, 0), bytes: results.reduce((n, a) => n + a.bytes, 0) }))
if (errors.length) process.exitCode = 1
