import * as THREE from 'three'
export function previewWallTransfer(item,wall,hitPoint) {
  const model=item.model,oldPosition=model.position.clone(),oldRotation=model.rotation.y
  const turn=wall.fixedTurn||0,normal=new THREE.Vector3(Math.sin(turn),0,Math.cos(turn))
  model.rotation.y=turn-(item.fixedTurn||0)
  model.updateWorldMatrix(true,true)
  let bounds=new THREE.Box3().setFromObject(model),center=bounds.getCenter(new THREE.Vector3())
  const wallBox=new THREE.Box3().setFromObject(wall.model)
  const halfDepth=(Math.abs(normal.x)*(bounds.max.x-bounds.min.x)+Math.abs(normal.z)*(bounds.max.z-bounds.min.z))/2
  const desired=hitPoint.clone().addScaledVector(normal,halfDepth+.025)
  const worldOrigin=model.getWorldPosition(new THREE.Vector3()).add(desired.sub(center))
  model.position.copy(model.parent.worldToLocal(worldOrigin));model.updateWorldMatrix(true,true)
  bounds=new THREE.Box3().setFromObject(model)
  const axis=Math.abs(normal.x)>.5?'z':'x'
  const valid=bounds.min[axis]>=wallBox.min[axis]-.02 && bounds.max[axis]<=wallBox.max[axis]+.02 && bounds.min.y>=wallBox.min.y-.02 && bounds.max.y<=wallBox.max.y+.02
  if(!valid){model.position.copy(oldPosition);model.rotation.y=oldRotation;model.updateWorldMatrix(true,true)}
  return valid
}
