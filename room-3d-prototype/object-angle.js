import * as THREE from 'three'
export function applyObjectAngle(item,degrees) {
  if(!Number.isFinite(degrees) || degrees< -180 || degrees>180)throw Error('角度需在 -180° 到 180° 之间')
  if(item.kind==='wall' || item.kind==='floor')throw Error('承重墙和地板保持安装方向')
  const model=item.model
  let pivot=model.children.find(n=>n.userData.anglePivot)
  if(!pivot){
    const local=new THREE.Group();for(const child of model.children)local.add(child.clone(true))
    const box=new THREE.Box3().setFromObject(local),center=box.getCenter(new THREE.Vector3())
    if(!model.userData.replacementSize)model.userData.replacementSize=Math.max(...box.getSize(new THREE.Vector3()).toArray())
    model.userData.replacementTurn??=model.children[0]?.rotation.y||0
    pivot=new THREE.Group();pivot.userData.anglePivot=true;pivot.position.copy(center)
    for(const child of [...model.children]){child.position.sub(center);pivot.add(child)}
    model.add(pivot)
  }
  const wall=item.mode==='wall'||item.kind==='window'
  const axis=wall?new THREE.Vector3(Math.sin(item.fixedTurn||0),0,Math.cos(item.fixedTurn||0)):new THREE.Vector3(0,1,0)
  pivot.quaternion.setFromAxisAngle(axis,THREE.MathUtils.degToRad(degrees))
  model.userData.editAngle=degrees;model.updateWorldMatrix(true,true)
}
