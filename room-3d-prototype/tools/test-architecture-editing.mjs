import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import * as THREE from 'three'
import {geometryLoader} from './test-goodies-room.mjs'
import {furnishInteriorRoom} from '../interior-room.js'
import {furnishGoodiesRoom} from '../goodies-room.js'
import {architectureKind,applyObjectColor} from '../architecture-editing.js'
import {prepareReplacement,commitReplacement,readReplacements,REPLACEMENTS_KEY} from '../furniture-replacement.js'

for(const [pack,furnish,x] of [['interior-1',furnishInteriorRoom,10.5],['goodies-cozy',furnishGoodiesRoom,21]]){
  const root=new THREE.Group();root.position.set(x,0,-1.2)
  const home={id:pack,root,surfaces:[]},surfaces=[]
  await furnish(home,surfaces,geometryLoader)
  const entries=home.editableArchitecture
  assert(entries.every(i=>i.fixed && i.mode==='fixed' && i.assetPack===pack))
  const assets=JSON.parse(await fs.readFile(`public/content/${pack}/catalog.json`,'utf8')).assets
  for(const kind of ['floor','wall','window']){
    const item=entries.find(i=>i.kind===kind && (kind!=='wall' || i.fixedTurn)) || entries.find(i=>i.kind===kind)
    assert(item,`${pack} missing ${kind}`)
    const other=entries.find(i=>i!==item)
    let otherMesh;other.model.traverse(n=>{if(n.isMesh)otherMesh=n})
    const otherMaterial=otherMesh.material,otherColor=otherMaterial.color.clone()
    const originalMaterials=[];item.model.traverse(n=>{if(n.isMesh)originalMaterials.push(n.material)})
    applyObjectColor(item.model,'#789c8f')
    item.model.traverse(n=>{if(n.isMesh){assert.equal(n.material.color.getHexString(),'789c8f');assert.equal(n.material.map,null);assert(!originalMaterials.includes(n.material))}})
    assert.equal(otherMesh.material,otherMaterial);assert(otherMaterial.color.equals(otherColor))
    applyObjectColor(item.model,'#bbccdd');applyObjectColor(item.model,null)
    item.model.traverse(n=>{if(n.isMesh)assert(originalMaterials.includes(n.material))})
    const before=new THREE.Box3().setFromObject(item.model),position=item.model.position.clone()
    const choice=assets.find(a=>architectureKind(a.file)===kind && a.file!==item.sourceFile)
    assert(choice)
    const scene=(await geometryLoader(`/content/${pack}/${choice.file}`)).scene
    for(let repeat=0;repeat<2;repeat++){
      commitReplacement(item,prepareReplacement(item,{...choice,pack},scene))
      const after=new THREE.Box3().setFromObject(item.model)
      assert(before.min.distanceTo(after.min)<.001,`${pack}/${kind} shifted base`)
      assert(before.max.distanceTo(after.max)<.001,`${pack}/${kind} changed slot bounds`)
      assert(item.model.position.equals(position))
      if(kind==='floor'){
        const center=after.getCenter(new THREE.Vector3())
        const meshes=[];item.model.traverse(n=>{if(n.isMesh)meshes.push(n)})
        const hit=new THREE.Raycaster(new THREE.Vector3(center.x,after.max.y+1,center.z),new THREE.Vector3(0,-1,0)).intersectObjects(meshes,false)[0]
        assert(hit,'Replacement floor not pickable');assert(Math.abs(hit.point.y-after.max.y)<.04,`${pack} ${choice.file} surface ${hit.point.y} vs ${after.max.y}`)
      }
    }
    assert.throws(()=>prepareReplacement(item,{pack,file:'sofa_002.glb'},scene),/同类型/)
    applyObjectColor(item.model,'#789c8f')
    const data={[item.id]:{pack,file:choice.file,color:'#789c8f'}}
    const storage={getItem:key=>key===REPLACEMENTS_KEY?JSON.stringify(data):null}
    assert.deepEqual(readReplacements(storage),data)
  }
}
console.log('PASS: both packs expose fixed floors/walls/windows; paint isolation/reset; same-type enforcement; repeated replacement fits slot bounds and side-wall orientation; floor hits and color metadata round-trip. Browser UI NOT verified.')
