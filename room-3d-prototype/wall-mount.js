import * as THREE from 'three'
import { wallAsset } from './wall-assets.js'
export function makeWallMount(parent,asset,scene,id,position) {
  if(asset.pack!==parent.assetPack || !wallAsset(asset)?.eligible)throw Error('不是同资源包的可上墙物件')
  const model=new THREE.Group(),visual=scene.clone(true)
  const original=new THREE.Box3().setFromObject(visual),size=original.getSize(new THREE.Vector3())
  visual.scale.multiplyScalar(Math.min(1,2.2/Math.max(size.x,size.y)))
  const bounds=new THREE.Box3().setFromObject(visual),center=bounds.getCenter(new THREE.Vector3())
  visual.position.set(-center.x,-bounds.min.y,-bounds.min.z)
  const facing=new THREE.Group();facing.rotation.y=parent.fixedTurn||0;facing.add(visual);model.add(facing)
  visual.traverse(n=>{if(n.isMesh){n.castShadow=true;n.receiveShadow=true}})
  if(position)model.position.fromArray(position)
  else{
    const world=new THREE.Box3().setFromObject(parent.model),point=world.getCenter(new THREE.Vector3())
    const normal=new THREE.Vector3(Math.sin(parent.fixedTurn||0),0,Math.cos(parent.fixedTurn||0))
    const extent=world.getSize(new THREE.Vector3())
    point.addScaledVector(normal,(Math.abs(normal.x)*extent.x+Math.abs(normal.z)*extent.z)/2+.03)
    point.y=world.max.y-.15-bounds.getSize(new THREE.Vector3()).y
    model.position.copy(parent.home.root.worldToLocal(point))
  }
  return {id,name:asset.name,model,home:parent.home,homeId:parent.homeId,assetPack:parent.assetPack,placementSurfaces:parent.placementSurfaces,mode:'wall',fixedTurn:parent.fixedTurn||0,mountParent:parent.id,sourceFile:asset.file}
}
