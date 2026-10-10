import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import * as THREE from 'three'
import {geometryLoader} from './test-goodies-room.mjs'
import {furnishInteriorRoom} from '../interior-room.js'
import {loadReplacementCatalog,loadReplacement,prepareReplacement,commitReplacement,readReplacements,REPLACEMENTS_KEY} from '../furniture-replacement.js'
const nativeFetch=globalThis.fetch
globalThis.fetch=async request=>{
  const url=typeof request==='string'?request:request.url
  if(url.startsWith('/content/'))return {ok:true,json:async()=>JSON.parse(await fs.readFile(`public${url}`,'utf8'))}
  return nativeFetch(request)
}
const root=new THREE.Group();root.position.set(10.5,0,-1.2)
const home={id:'interior',root,surfaces:[]},surfaces=[]
const items=await furnishInteriorRoom(home,surfaces,geometryLoader)
const item=items.find(i=>i.id.endsWith('-table'))
const position=item.model.position.clone(),rotation=item.model.rotation.clone()
const oldChildren=[...item.model.children],oldSurfaces=[...surfaces]
const catalog=await loadReplacementCatalog('interior-1')
assert.equal(catalog.length,1580);assert(catalog.every(a=>a.pack==='interior-1'))
const goodies=await loadReplacementCatalog('goodies-cozy')
assert.equal(goodies.length,302)
let touched=false
await assert.rejects(loadReplacement(item,goodies[0],async()=>{touched=true}),/同一套/)
assert(!touched,'Cross-pack network request should be rejected')
await assert.rejects(loadReplacement(item,{pack:'interior-1',file:'../../unknown.glb'},geometryLoader),/不在/)
const asset=catalog.find(a=>a.file==='coffee_table_001.glb')
await assert.rejects(loadReplacement(item,asset,async()=>{throw Error('offline')}),/offline/)
assert.deepEqual(item.model.children,oldChildren);assert.deepEqual(surfaces,oldSurfaces)
const result=await loadReplacement(item,asset,geometryLoader)
const before=new THREE.Box3().setFromObject(item.model).getSize(new THREE.Vector3())
const prepared=prepareReplacement(item,asset,result.scene)
assert.deepEqual(item.model.children,oldChildren,'Preview must not mutate room')
commitReplacement(item,prepared)
assert(item.model.position.equals(position));assert(item.model.rotation.equals(rotation))
const box=new THREE.Box3().setFromObject(item.model),after=box.getSize(new THREE.Vector3())
assert(Math.abs(Math.max(...before.toArray())-Math.max(...after.toArray()))<1e-5,'Uniform fit size changed')
assert(Math.abs(box.min.y-position.y)<1e-5,'Replacement must sit on original base')
const oldMeshes=new Set();oldChildren.forEach(c=>c.traverse(n=>{if(n.isMesh)oldMeshes.add(n)}))
assert(!surfaces.some(n=>oldMeshes.has(n)));assert(!home.surfaces.some(n=>oldMeshes.has(n)))
item.model.traverse(n=>{if(n.isMesh){assert(surfaces.includes(n));assert(home.surfaces.includes(n))}})
const storage=new Map();const adapter={getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)}
adapter.setItem(REPLACEMENTS_KEY,JSON.stringify({[item.id]:{pack:asset.pack,file:asset.file}}))
const stored=readReplacements(adapter)[item.id]
const restored=await loadReplacement(item,stored,geometryLoader)
assert.equal(restored.asset.file,asset.file)
const beforeSecond=prepared.target
commitReplacement(item,prepareReplacement(item,asset,restored.scene))
assert.equal(item.model.userData.replacementSize,beforeSecond,'Repeated replacement must not drift in scale')
adapter.setItem(REPLACEMENTS_KEY,'broken');assert.deepEqual(readReplacements(adapter),{})
console.log('PASS: same-pack catalog scope, cross-pack/path rejection, failure and preview isolation, position/rotation/scale preservation, replacement picking registries, stored selection reload and corrupt-storage fallback. No browser visual or drag verification.')
