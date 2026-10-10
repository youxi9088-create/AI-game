import assert from 'node:assert/strict'
import * as THREE from 'three'
import {previewWallTransfer} from '../wall-transfer.js'
const root=new THREE.Group();root.position.x=10.5
const model=new THREE.Group();const picture=new THREE.Mesh(new THREE.BoxGeometry(1,1,.08),new THREE.MeshBasicMaterial());picture.position.y=.5;model.add(picture);root.add(model)
const item={model,fixedTurn:0}
const makeWall=(turn,x,z)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(4,4,.2),new THREE.MeshBasicMaterial());m.rotation.y=turn;m.position.set(x,2,z);root.add(m);root.updateMatrixWorld(true);return {model:m,fixedTurn:turn}}
const back=makeWall(0,0,-3),side=makeWall(-Math.PI/2,3,0)
assert(previewWallTransfer(item,back,new THREE.Vector3(10.5,2,-2.9)))
assert.equal(model.rotation.y,0)
assert(previewWallTransfer(item,side,new THREE.Vector3(13.4,2,0)))
assert.equal(model.rotation.y,-Math.PI/2)
const bounds=new THREE.Box3().setFromObject(model)
assert(bounds.max.x<13.4 && bounds.max.x>13.35,'Picture should remain in front of side wall')
const position=model.position.clone(),angle=model.rotation.y
assert(!previewWallTransfer(item,back,new THREE.Vector3(20,5,-2.9)))
assert(model.position.equals(position));assert.equal(model.rotation.y,angle)
assert(previewWallTransfer(item,back,new THREE.Vector3(10.5,2,-2.9)))
assert.equal(model.rotation.y,0)
console.log('PASS: back-to-side and side-to-back facing, wall offset, invalid placement rollback. Visual selection feedback and pointer interactions NOT verified.')
