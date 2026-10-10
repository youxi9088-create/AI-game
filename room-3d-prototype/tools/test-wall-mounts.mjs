import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import * as THREE from 'three'
import {geometryLoader} from './test-goodies-room.mjs'
import {wallAsset} from '../wall-assets.js'
import {makeWallMount} from '../wall-mount.js'
import {applyObjectAngle} from '../object-angle.js'
import {prepareReplacement} from '../furniture-replacement.js'
const assets=JSON.parse(await fs.readFile('public/content/goodies-cozy/catalog.json','utf8')).assets
const curtain={...assets.find(a=>a.file==='Curtains.glb'),pack:'goodies-cozy'}
assert(wallAsset(curtain).eligible)
assert(!wallAsset(assets.find(a=>a.file==='Frame_Standing_1.glb')).eligible)
assert(!wallAsset(assets.find(a=>a.file==='Window_Cutout.glb')).eligible)
assert(wallAsset(assets.find(a=>a.file==='Sconce.glb')).eligible)
assert(!wallAsset(assets.find(a=>a.file==='Bookshelf_Wide.glb')).eligible)
const scene=(await geometryLoader('/content/goodies-cozy/Curtains.glb')).scene
for(const turn of [0,Math.PI/2,-Math.PI/2]){
  const root=new THREE.Group();root.position.set(21,0,-1.2)
  const wall=new THREE.Group();wall.add(new THREE.Mesh(new THREE.BoxGeometry(3,3,.15),new THREE.MeshStandardMaterial()))
  wall.rotation.y=turn;wall.position.y=1.5;root.add(wall);root.updateMatrixWorld(true)
  const home={root,id:'goodies'}
  const parent={model:wall,home,homeId:'goodies',id:'wall',assetPack:'goodies-cozy',fixedTurn:turn}
  const item=makeWallMount(parent,curtain,scene,'mount')
  root.add(item.model);root.updateMatrixWorld(true)
  const before=new THREE.Box3().setFromObject(item.model).getCenter(new THREE.Vector3())
  const position=item.model.position.clone()
  applyObjectAngle(item,30)
  const after=new THREE.Box3().setFromObject(item.model).getCenter(new THREE.Vector3())
  assert(before.distanceTo(after)<.0001,'Rotation must preserve center')
  assert(item.model.position.equals(position))
  applyObjectAngle(item,-15);applyObjectAngle(item,0)
  assert.equal(item.model.children.filter(n=>n.userData.anglePivot).length,1,'Angle changes must not nest pivots')
  assert(new THREE.Box3().setFromObject(item.model).getCenter(new THREE.Vector3()).distanceTo(before)<.0001)
  const restored=makeWallMount(parent,curtain,scene,'mount',position.toArray());root.add(restored.model);applyObjectAngle(restored,30)
  assert(restored.model.position.equals(position));assert.equal(restored.model.userData.editAngle,30)
  assert.throws(()=>makeWallMount(parent,{...curtain,pack:'interior-1'},scene,'bad'),/同资源包/)
  assert.throws(()=>prepareReplacement(item,{...curtain,file:'Couch_C_3_Seater.glb'},scene),/上墙/)
  assert.throws(()=>applyObjectAngle(item,Infinity),/角度/)
}
console.log('PASS: curtain/sconce classification, standing frame/bookshelf/structural window exclusion, back/side wall mount, stable pivot and zero reset, saved position/angle reconstruction, cross-pack and invalid-angle rejection. Browser interactions NOT verified.')
