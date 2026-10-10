import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { furnishGoodiesRoom, goodiesLayout, goodiesShell } from '../goodies-room.js'
import { initCreator } from '../creator.js'
globalThis.ProgressEvent = class { constructor(type, data) { Object.assign(this, data); this.type = type } }
export async function geometryLoader(url) {
  const bytes = await fs.readFile(`public${url}`)
  const n = bytes.readUInt32LE(12), json = JSON.parse(bytes.subarray(20,20+n))
  for (const image of json.images || []) await fs.access(`public${url.slice(0,url.lastIndexOf('/'))}/${image.uri}`)
  delete json.images; delete json.textures; delete json.samplers
  for (const m of json.materials || []) {
    delete m.normalTexture; delete m.emissiveTexture; delete m.occlusionTexture
    delete m.pbrMetallicRoughness.baseColorTexture; delete m.pbrMetallicRoughness.metallicRoughnessTexture
  }
  json.buffers[0].uri = `data:application/octet-stream;base64,${bytes.subarray(28+n).toString('base64')}`
  return new GLTFLoader().parseAsync(JSON.stringify(json), '')
}
const root = new THREE.Group(); root.position.set(21,0,-1.2)
const home = { id:'goodies', root, surfaces:[] }, surfaces=[]
const items = await furnishGoodiesRoom(home, surfaces, geometryLoader)
assert.equal(items.length,11)
const shell=root.children.find(node=>node.name==='Goodies 原装墙体、木地板与窗户')
assert(shell)
assert.equal(shell.children.length,goodiesShell.length)
assert.equal(goodiesShell.filter(module=>module.floor).length,30)
for (const at of [[21,2,-.9],[17.5,2,1.6],[24.5,2,1.6]]) {
  const ray=new THREE.Raycaster(new THREE.Vector3(...at),new THREE.Vector3(0,-1,0))
  const floors=surfaces.filter(node=>{for(let p=node;p;p=p.parent)if(p===shell)return true;return false})
  const hit=ray.intersectObjects(floors,false)[0]
  assert(hit,'Missing Goodies floor hit')
  assert(hit.point.y>-.05 && hit.point.y<.05,`Unexpected authored plank height: ${hit.point.y}`)
}
assert.equal(new Set(items.map(item=>item.id)).size,11)
for (const item of items) {
  const bounds=new THREE.Box3().setFromObject(item.model)
  assert(bounds.min.x > 16.6 && bounds.max.x <25.4, `${item.id}: outside width`)
  assert(bounds.min.z > -5 && bounds.max.z < 2.7, `${item.id}: outside depth`)
  assert(bounds.min.y >= -.05, `${item.id}: below authored plank surface`)
  const def=goodiesLayout.find(def=>item.id===`goodies:${def.id}`)
  if(def.mode==='floor') {
    const position=item.model.getWorldPosition(new THREE.Vector3())
    const ray=new THREE.Raycaster(new THREE.Vector3(position.x,2,position.z),new THREE.Vector3(0,-1,0))
    const floorMeshes=[]; shell.traverse(node=>{if(node.isMesh)floorMeshes.push(node)})
    const hit=ray.intersectObjects(floorMeshes,false)[0]
    assert(Math.abs(bounds.min.y-(hit.point.y+def.at[1]-.014))<.001,`${item.id}: not grounded on original planks`)
  }
}
for (const def of goodiesLayout.filter(item=>item.on)) {
  const item=items.find(item=>item.id===`goodies:${def.id}`)
  const position=item.model.getWorldPosition(new THREE.Vector3())
  const ray=new THREE.Raycaster(position.clone().add(new THREE.Vector3(0,.08,0)),new THREE.Vector3(0,-1,0),0,.15)
  assert(ray.intersectObjects(surfaces,false).length,`${item.id}: not resting on support`)
}
// Storage/registration regression, not a browser or visual test.
const storage=new Map([['hidden-object-cozy-furniture-v1',JSON.stringify({'forest:chair':[1,0,1],'goodies:plant':[3,.02,2]})]])
globalThis.localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)}
const element={addEventListener(){},textContent:'',style:{}}
globalThis.document={querySelector:()=>({...element}),addEventListener(){}}
const old={id:'forest:chair',name:'existing',homeId:'forest',mode:'floor',model:new THREE.Group()}
const movable=[old]
const sync=initCreator({renderer:{domElement:element},camera:new THREE.PerspectiveCamera(),controls:{},exportRoot:new THREE.Group(),movableItems:movable,defaultHome:{id:'forest'},getPlacementContext:()=>({home,surfaces}),say:()=>{}})
assert.deepEqual(JSON.parse(storage.get('hidden-object-cozy-furniture-v1'))['goodies:plant'],[3,.02,2], 'async startup erased saved furniture')
movable.push(...items); sync.registerItems(items)
assert.deepEqual(items.find(item=>item.id==='goodies:plant').model.position.toArray(),[3,.02,2])
assert.deepEqual(old.model.position.toArray(),[1,0,1])
assert.equal(old.model.visible,false)
assert(items.every(item=>item.model.visible))
const failedHome={root:new THREE.Group(),surfaces:[]}
await assert.rejects(furnishGoodiesRoom(failedHome,[],async()=>{throw Error('offline')}))
assert.equal(failedHome.root.children.length,0)
console.log(`PASS: ${goodiesShell.length} Goodies architectural modules, 30 original floor tiles and placement raycasts; 11 furnishings/textures, room bounds, 3 tabletop contacts, stable IDs, old/new saved positions, visibility, atomic loading failure. Visual/drag UI verification NOT performed.`)
