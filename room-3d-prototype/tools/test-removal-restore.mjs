import assert from 'node:assert/strict'
import * as THREE from 'three'
import {initCreator} from '../creator.js'
const storage=new Map([
 ['hidden-object-furniture-replacements-v1',JSON.stringify({'goodies:removed':{removed:true,pack:'goodies-cozy'}})],
])
globalThis.localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)}
const element={addEventListener(){},textContent:'',style:{}}
globalThis.document={querySelector:()=>({...element}),addEventListener(){}}
const model=new THREE.Group(),mesh=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial());model.add(mesh)
const home={id:'goodies',surfaces:[mesh]},surfaces=[mesh]
const removed={id:'goodies:removed',homeId:'goodies',name:'removed',model,mode:'floor',home,placementSurfaces:surfaces,assetPack:'goodies-cozy'}
const kept={id:'goodies:kept',homeId:'goodies',name:'kept',model:new THREE.Group(),mode:'floor'}
const sync=initCreator({renderer:{domElement:element},camera:new THREE.PerspectiveCamera(),controls:{},exportRoot:new THREE.Group(),movableItems:[removed,kept],getPlacementContext:()=>({home,surfaces}),say(){}})
assert.equal(model.visible,false);assert.equal(kept.model.visible,true)
assert.equal(home.surfaces.length,0);assert.equal(surfaces.length,0)
sync();assert.equal(model.visible,false,'Visibility refresh must not resurrect removed furniture')
assert(JSON.parse(storage.get('hidden-object-furniture-replacements-v1'))['goodies:removed'].removed)
console.log('PASS: removed object reload stays hidden; unrelated furniture remains; both support registries cleaned; visibility sync preserves removal. UI not verified.')
