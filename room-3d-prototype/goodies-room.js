import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { architecturalEntry } from './architecture-editing.js'

// All positions are home-local. Keep old homes and their persisted IDs untouched.
// Scale uniformly, never stretch source furniture to fit.
export const goodiesLayout = [
  { id: 'sofa', file: 'Couch_C_3_Seater.glb', name: 'Goodies 三人沙发', at: [-.8,.015,-2.1], scale: 1.45, mode: 'floor' },
  { id: 'rug', file: 'Rug6.glb', name: 'Goodies 客厅地毯', at: [-.55,.014,.1], scale: 1.25, mode: 'floor' },
  { id: 'coffee-table', file: 'Coffee_Table_Circular_1.glb', name: 'Goodies 圆茶几', at: [-.6,.075,.2], scale: 1.25, mode: 'floor', support: true },
  { id: 'armchair', file: 'Couch_C_1_Seater.glb', name: 'Goodies 阅读单椅', at: [2.4,.015,.65], scale: 1.35, turn: -.65, mode: 'floor' },
  { id: 'bookcase', file: 'Bookshelf_Wide.glb', name: 'Goodies 木书柜', at: [2.7,.015,-2.9], scale: 1.25, mode: 'floor' },
  { id: 'floor-lamp', file: 'Lamp.glb', name: 'Goodies 落地灯', at: [-3.45,.015,-2.1], scale: 1.2, mode: 'floor' },
  { id: 'plant', file: 'SnakePlant1.glb', name: 'Goodies 落地绿植', at: [3.35,.015,2.25], scale: 1.3, mode: 'floor' },
  { id: 'side-table', file: 'Side_Table2.glb', name: 'Goodies 木边桌', at: [-3,.015,.3], scale: 1.4, mode: 'floor', support: true },
  { id: 'table-lamp', file: 'Lamp_3.glb', name: 'Goodies 陶瓷台灯', at: [-3,0,.3], scale: .8, mode: 'surface', on: 'side-table' },
  { id: 'photo', file: 'Frame_Standing_1.glb', name: 'Goodies 桌面相框', at: [-.95,0,.14], scale: 1, mode: 'surface', on: 'coffee-table' },
  { id: 'tablet', file: 'Tablet.glb', name: 'Goodies 阅读平板', at: [-.28,0,.33], scale: 1, mode: 'surface', on: 'coffee-table' },
]

export const goodiesShell = []
const moduleScale = 1.4
// Six by five original plank modules. Their real top is aligned with y=.014.
for (let x = 0; x < 6; x++) for (let z = 0; z < 5; z++) goodiesShell.push({
  file: 'Floor_Wood_1.glb', at: [-3.5+x*1.4, .014-.135530974715948*moduleScale, -2.8+z*1.4], floor: true,
})
// A genuine Goodies window bay and four matching interior wall modules.
goodiesShell.push({ file:'Window_Cutout__variant2.glb', at:[-2.8,.014,-3.5] })
for (const x of [-.7,.7,2.1,3.5]) {
  goodiesShell.push({ file:'Wall_Interior.glb', at:[x,.014,-3.5] })
  goodiesShell.push({ file:'Wall_Exterior9.glb', at:[x,.014,-3.595] })
}
for (const side of [-1,1]) {
  for (const z of [-2.8,-1.4]) {
    goodiesShell.push({ file:'Wall_Interior.glb', at:[side*4.2,.014,z], turn:-side*Math.PI/2 })
    goodiesShell.push({ file:'Wall_Exterior9.glb', at:[side*4.295,.014,z], turn:-side*Math.PI/2 })
  }
  // Authored sloped cutaway panels keep the interior visible, without recolouring.
  for (const [z,variant] of [[0,3],[1.4,2],[2.8,1]]) {
    goodiesShell.push({ file:`Wall_Interior_Angled_${variant}.glb`, at:[side*4.2,.014,z], turn:-side*Math.PI/2 })
    goodiesShell.push({ file:`Wall_Exterior_Angled_${variant}.glb`, at:[side*4.295,.014,z], turn:-side*Math.PI/2 })
  }
}

export async function furnishGoodiesRoom(home, placementSurfaces, load = url => new GLTFLoader().loadAsync(url)) {
  const filenames = [...new Set([...goodiesLayout,...goodiesShell].map(item=>item.file))]
  const settled = await Promise.allSettled(filenames.map(file => load(`/content/goodies-cozy/${file}`)))
  const failure = settled.find(result => result.status === 'rejected')
  if (failure) throw new Error(`Goodies 家具加载失败，请刷新重试：${failure.reason?.message || failure.reason}`)
  const templates = new Map(filenames.map((file,i)=>[file,settled[i].value.scene]))
  const entries = [], byId = new Map()
  // Build off-scene, then commit together; no half-loaded furniture arrangement.
  const stage = new THREE.Group()
  const shell = new THREE.Group(); shell.name = 'Goodies 原装墙体、木地板与窗户'
  shell.userData.licensedAsset = true
  const newSurfaces = []
  const architecture=[]
  for (const [index,def] of goodiesShell.entries()) {
    const module = new THREE.Group(), visual=templates.get(def.file).clone(true)
    visual.scale.multiplyScalar(moduleScale); visual.rotation.y = def.turn || 0
    module.add(visual)
    module.position.set(...def.at); shell.add(module)
    const editable=architecturalEntry(home,module,def,index,'goodies-cozy',placementSurfaces)
    if(editable)architecture.push(editable)
    module.traverse(node=>{ if(node.isMesh) {
      node.castShadow=!def.floor; node.receiveShadow=true
      if(def.floor) newSurfaces.push(node)
    } })
  }
  shell.updateWorldMatrix(true,true)
  const floorMeshes = [...newSurfaces]
  for (let i = 0; i < goodiesLayout.length; i++) {
    const def = goodiesLayout[i], visual = templates.get(def.file).clone(true)
    const model = new THREE.Group(); model.name = def.name
    model.userData.licensedAsset = true
    visual.scale.multiplyScalar(def.scale); visual.rotation.y = def.turn || 0
    model.add(visual); stage.add(model)
    model.position.set(...def.at)
    if (def.mode === 'floor') {
      // Original plank geometry has shallow joints; use its actual surface,
      // not the bounding-box maximum, as the furniture's ground height.
      const ray = new THREE.Raycaster(new THREE.Vector3(def.at[0],2,def.at[2]),new THREE.Vector3(0,-1,0))
      const floorHit = ray.intersectObjects(floorMeshes,false)[0]
      if (!floorHit) throw new Error(`家具下方缺少地板：${def.name}`)
      model.position.y = floorHit.point.y + def.at[1] - .014
    }
    visual.traverse(node => { if (node.isMesh) { node.castShadow = true; node.receiveShadow = true } })
    if (def.on) {
      const support = byId.get(def.on)
      model.position.y = support.position.y + support.userData.top + .006
    }
    if (def.support) {
      visual.updateWorldMatrix(true, true)
      const bounds = new THREE.Box3().setFromObject(visual)
      const top = bounds.max.y - model.position.y
      model.userData.top = top
      // Raycast the original mesh triangles: no oversized invisible placement box.
      visual.traverse(node => { if (node.isMesh) newSurfaces.push(node) })
    }
    byId.set(def.id, model)
    entries.push({ id: `goodies:${def.id}`, name: def.name, model, homeId: 'goodies', mode: def.mode, assetPack:'goodies-cozy',home,placementSurfaces })
  }
  home.root.add(shell)
  home.surfaces.push(...newSurfaces); placementSurfaces.push(...newSurfaces)
  for (const item of entries) home.root.add(item.model)
  home.root.updateWorldMatrix(true, true)
  home.editableArchitecture=architecture
  return entries
}
