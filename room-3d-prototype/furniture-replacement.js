import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { enrichAsset } from './asset-catalog.js'
import { architectureKind } from './architecture-editing.js'
import { wallAsset } from './wall-assets.js'

export const REPLACEMENTS_KEY='hidden-object-furniture-replacements-v1'
export const packLabels={'interior-1':'Interior 1','goodies-cozy':'Goodies Cozy','low-poly-rooms':'30 Rooms'}
const catalogs=new Map()
export async function loadReplacementCatalog(pack) {
  if(!packLabels[pack]) throw Error('这件家具没有可替换的资源包')
  if(!catalogs.has(pack)) catalogs.set(pack,(async()=>{
    const response=await fetch(`/content/${pack}/catalog.json`)
    if(!response.ok) throw Error('资源清单读取失败，请重试')
    const data=await response.json()
    return data.assets.map(asset=>enrichAsset(asset,pack,packLabels[pack]))
  })().catch(error=>{catalogs.delete(pack);throw error}))
  return catalogs.get(pack)
}
export function readReplacements(storage=localStorage) {
  try {const data=JSON.parse(storage.getItem(REPLACEMENTS_KEY)||'{}');return data && typeof data==='object' && !Array.isArray(data)?data:{}} catch{return {}}
}
export function prepareReplacement(item,asset,scene) {
  if(!item.assetPack || asset.pack!==item.assetPack) throw Error('只能使用同一套资源包替换')
  if(item.kind && architectureKind(asset.file)!==item.kind)throw Error('建筑部件只能替换为同类型部件')
  if(item.mode==='wall' && !wallAsset(asset)?.eligible)throw Error('请选择可上墙物件')
  const visual=scene.clone(true)
  if(item.fitBounds){
    visual.rotation.y=item.fixedTurn || 0
    const box=new THREE.Box3().setFromObject(visual),size=box.getSize(new THREE.Vector3())
    const targetBox=new THREE.Box3(new THREE.Vector3(...item.fitBounds.min),new THREE.Vector3(...item.fitBounds.max)),targetSize=targetBox.getSize(new THREE.Vector3())
    // Fit architectural modules in the slot's axes, not furniture's longest axis.
    const fitted=new THREE.Group();fitted.add(visual)
    for(const axis of ['x','y','z']){
      if(size[axis]<.0001 && targetSize[axis]>.01)throw Error('该模型方向与安装槽不兼容')
      fitted.scale[axis]=size[axis]>.0001?Math.max(targetSize[axis],.000001)/size[axis]:1
    }
    const fittedBox=new THREE.Box3().setFromObject(fitted)
    fitted.position.copy(targetBox.min).sub(fittedBox.min)
    if(item.kind==='floor')fitted.position.y+=targetBox.max.y-(fittedBox.max.y+fitted.position.y)
    fitted.traverse(n=>{if(n.isMesh){n.castShadow=item.kind!=='floor';n.receiveShadow=true}})
    return {visual:fitted,target:Math.max(...targetSize.toArray()),turn:visual.rotation.y}
  }
  const original=new THREE.Box3().setFromObject(item.model)
  const size=original.getSize(new THREE.Vector3())
  const target=item.model.userData.replacementSize ?? Math.max(size.x,size.y,size.z)
  const turn=item.model.userData.replacementTurn ?? (item.model.children[0]?.rotation.y || 0)
  visual.rotation.y=turn
  let box=new THREE.Box3().setFromObject(visual)
  const extent=Math.max(...box.getSize(new THREE.Vector3()).toArray())
  if(!Number.isFinite(extent) || extent<.000001) throw Error('模型尺寸无效，原家具保持不变')
  visual.scale.multiplyScalar(target/extent)
  box=new THREE.Box3().setFromObject(visual)
  const center=box.getCenter(new THREE.Vector3())
  visual.position.add(new THREE.Vector3(-center.x,-box.min.y,-center.z))
  visual.traverse(n=>{if(n.isMesh){n.castShadow=true;n.receiveShadow=true}})
  return {visual,target,turn}
}
export function commitReplacement(item,prepared) {
  const model=item.model,oldMeshes=new Set()
  model.traverse(n=>{if(n.isMesh)oldMeshes.add(n)})
  const arrays=[...new Set([item.home?.surfaces,item.placementSurfaces].filter(Boolean))]
  // Remove old triangles from both picking registries before installing new ones.
  for(const list of arrays) for(let i=list.length-1;i>=0;i--)if(oldMeshes.has(list[i]))list.splice(i,1)
  model.clear();model.add(prepared.visual)
  model.userData.replacementSize=prepared.target;model.userData.replacementTurn=prepared.turn
  // Any replacement can provide a real upward-facing surface, including a
  // table chosen to replace a chair. Placement still checks triangle normals.
  if(!item.fixed || item.kind==='floor')prepared.visual.traverse(n=>{if(n.isMesh){if(item.kind==='floor')n.userData.placementFloor=true;for(const list of arrays)list.push(n)}})
  model.updateWorldMatrix(true,true)
}
export async function loadReplacement(item,asset,load=url=>new GLTFLoader().loadAsync(url)) {
  if(asset.pack!==item.assetPack)throw Error('只能使用同一套资源包替换')
  if(item.kind && architectureKind(asset.file)!==item.kind)throw Error('建筑部件只能替换为同类型部件')
  const catalog=await loadReplacementCatalog(item.assetPack)
  const verified=catalog.find(entry=>entry.file===asset.file)
  if(!verified)throw Error('资源不在该家具的资源包内')
  if(item.mode==='wall' && !verified.wall?.eligible)throw Error('请选择可上墙物件')
  return {asset:verified,scene:(await load(verified.url)).scene}
}
