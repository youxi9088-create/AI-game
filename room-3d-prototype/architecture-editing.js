import * as THREE from 'three'

export function architectureKind(file) {
  // Interior's lowercase wall_* files are horizontal decorative slabs, not
  // upright wall modules; Walls_* and Goodies Wall_* are the actual walls.
  if(/^wall_/.test(file))return null
  if(/window/i.test(file))return 'window'
  if(/^floor[_\W]/i.test(file))return 'floor'
  if(/^walls?[_\W]/i.test(file))return 'wall'
  return null
}
export function architecturalEntry(home,model,def,index,pack,placementSurfaces) {
  const kind=architectureKind(def.file)
  if(!kind)return null
  const local=model.clone(true);local.position.set(0,0,0);local.rotation.set(0,0,0);local.scale.set(1,1,1)
  const box=new THREE.Box3().setFromObject(local)
  return {id:`${home.id}:architecture-${index}`,name:`${{floor:'地板',wall:'墙壁',window:'窗户'}[kind]} ${index+1}`,model,homeId:home.id,mode:'fixed',fixed:true,kind,assetPack:pack,home,placementSurfaces,
    fitBounds:{min:box.min.toArray(),max:box.max.toArray()},fixedTurn:def.turn||0,sourceFile:def.file}
}
export function applyObjectColor(model,color) {
  if(color!==null && !/^#[0-9a-f]{6}$/i.test(color))throw Error('颜色格式无效')
  model.traverse(n=>{
    if(!n.isMesh)return
    if(!n.userData.originalPaintMaterials)n.userData.originalPaintMaterials=n.material
    else if(n.material!==n.userData.originalPaintMaterials)for(const m of [n.material].flat())m.dispose()
    const originals=n.userData.originalPaintMaterials
    if(color===null){n.material=originals;return}
    const paint=source=>{const m=source.clone();m.color.set(color);m.map=null;m.needsUpdate=true;return m}
    n.material=Array.isArray(originals)?originals.map(paint):paint(originals)
  })
  model.userData.paintColor=color
}
