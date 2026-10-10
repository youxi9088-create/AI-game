import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import * as THREE from 'three'
import { geometryLoader } from './test-goodies-room.mjs'
import { furnishInteriorRoom, interiorShell, interiorLayout, upperFloorY, interiorFloorTint } from '../interior-room.js'
const root=new THREE.Group(); root.position.set(10.5,0,-1.2)
const home={id:'interior',root,surfaces:[]}, surfaces=[]
const items=await furnishInteriorRoom(home,surfaces,geometryLoader)
assert.equal(items.length,13)
const shell=root.children.find(n=>n.name==='Interior 1 原装建筑')
assert.equal(shell.children.length,interiorShell.length+11)
assert.equal(interiorShell.filter(d=>d.floor).length,11)
const floorMaterials=new Set()
shell.traverse(n=>{if(n.userData.interiorFloor){
  for(const material of [n.material].flat()) {
    assert.equal(`#${material.color.getHexString()}`,interiorFloorTint)
    floorMaterials.add(material)
  }
}})
assert(floorMaterials.size>0)
root.traverse(n=>{if(n.isMesh && !n.userData.interiorFloor)for(const material of [n.material].flat())assert(!floorMaterials.has(material),'Floor tint leaked into another object')})
const all=JSON.parse(await fs.readFile('public/content/interior-1/catalog.json','utf8')).assets
for(const def of [...interiorShell,...interiorLayout])assert(all.some(a=>a.file===def.file))
for(const x of [-2,2])for(const z of [-2,2]){
  const hit=new THREE.Raycaster(new THREE.Vector3(10.5+x,2,-1.2+z),new THREE.Vector3(0,-1,0)).intersectObjects(surfaces.filter(n=>n.userData.placementFloor),false)[0]
  assert(hit,'No floor surface'); assert(Math.abs(hit.point.y-.015)<.001)
}
for(const x of [-2.85,-.95,.95,2.85]){
  const hit=new THREE.Raycaster(new THREE.Vector3(10.5+x,upperFloorY+1,-4.05),new THREE.Vector3(0,-1,0)).intersectObjects(surfaces.filter(n=>n.userData.placementFloor),false)[0]
  assert(hit && Math.abs(hit.point.y-upperFloorY-.001)<.002,'Missing upper floor')
}
const stairModel=shell.children.find(n=>n.position.x===2.85 && n.position.z===.65)
assert(stairModel)
const stairBounds=new THREE.Box3().setFromObject(stairModel)
assert(Math.abs(stairBounds.max.y-upperFloorY)<.001,'Stairs miss upper landing height')
assert(Math.abs(stairBounds.min.z-(-1.2-1.9))<.015,'Stairs miss landing edge')
for(const item of items){
  const b=new THREE.Box3().setFromObject(item.model)
  assert(b.min.x>6.69 && b.max.x<14.31, `${item.id} outside room`)
  assert(b.min.z>-5.01 && b.max.z<2.61,`${item.id} outside room depth`)
  assert(b.min.y>=.013,`${item.id} below floor`)
}
for(const def of interiorLayout.filter(d=>d.on)){
  const model=items.find(i=>i.id===`interior:duplex-${def.id}`).model
  const p=model.getWorldPosition(new THREE.Vector3())
  assert(new THREE.Raycaster(p.clone().add(new THREE.Vector3(0,.08,0)),new THREE.Vector3(0,-1,0),0,.12).intersectObjects(surfaces,false).length,`${def.id} floating`)
}
assert.equal(items.filter(i=>i.homeId!=='interior').length,0)
const source=await fs.readFile('cozy-room.js','utf8')
assert(!source.includes("'atelier:"),'Retired furnishings still constructed')
const failed={root:new THREE.Group(),surfaces:[]}
await assert.rejects(furnishInteriorRoom(failed,[],async()=>{throw Error('offline')}))
assert.equal(failed.root.children.length,0)
console.log(`PASS: full Interior replacement (${interiorShell.length} architecture modules, ${items.length} furnishings), package-only sources, placement floors, tabletop contact, room bounds and failure atomicity. Visual review NOT performed.`)
