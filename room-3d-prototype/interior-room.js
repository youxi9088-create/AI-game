import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { architecturalEntry } from './architecture-editing.js'

export const upperFloorY = 3.78225346
export const interiorFloorTint = '#789c8f' // Muted, light ink green over the original pale floor palette.
export const interiorShell = [
  ...[-1.9,1.9].flatMap(x=>[-1.9,1.9].map(z=>({file:'floor_017.glb',at:[x,.014,z],scale:.95,floor:true}))),
  ...[.014,upperFloorY].flatMap(y=>[-1.9,1.9].map(x=>({file:'Walls_006.glb',at:[x,y,-3.8],scale:.95}))),
  ...[-2.85,-.95,.95].flatMap(x=>[-2.85,-.95].map(z=>({file:'floor_017.glb',at:[x,upperFloorY,z],scale:.475,floor:true}))),
  {file:'floor_017.glb',at:[2.85,upperFloorY,-2.85],scale:.475,floor:true},
  {file:'Stairs_001.glb',at:[2.85,.014,.65],scale:1},
  ...[-2.85,-.95,.95].map(x=>({file:'Partitions_004.glb',at:[x,upperFloorY,0],scale:.475})),
  {file:'Partitions_004.glb',at:[1.9,upperFloorY,-.95],scale:.475,turn:Math.PI/2},
  {file:'Walls_006.glb',at:[-3.8,upperFloorY,-1.9],scale:.95,turn:Math.PI/2},
  {file:'Partitions_004.glb',at:[3.8,upperFloorY,-2.85],scale:.475,turn:Math.PI/2},
  ...[-1,1].flatMap(side=>[
    {file:'Walls_006.glb',at:[side*3.8,.014,-1.9],scale:.95,turn:-side*Math.PI/2},
    {file:'Partitions_004.glb',at:[side*3.8,.014,1.9],scale:.95,turn:-side*Math.PI/2},
  ]),
  {file:'window_003.glb',at:[-1.8,1.25,-3.5],scale:1},
  {file:'window_003.glb',at:[-.5,upperFloorY+1.3,-3.5],scale:1},
  {file:'door_002.glb',at:[3.6,.014,-3],scale:1.1,turn:-Math.PI/2},
]
export const interiorLayout = [
  {id:'sofa',file:'sofa_002.glb',name:'Interior 三人沙发',at:[-.7,.016,-2.25],scale:1.1,mode:'floor'},
  {id:'rug',file:'carpet_002.glb',name:'Interior 客厅地毯',at:[-.6,.018,.3],scale:1.15,mode:'floor'},
  {id:'table',file:'coffee_table_004.glb',name:'Interior 茶几',at:[-.6,.02,.3],scale:1.5,mode:'floor',support:true},
  {id:'armchair',file:'armchair_001.glb',name:'Interior 扶手椅',at:[1,.016,1.8],scale:1.1,turn:-.5,mode:'floor'},
  {id:'side-table',file:'coffee_table_001.glb',name:'Interior 边桌',at:[-3,.016,-1],scale:1.5,mode:'floor',support:true},
  {id:'plant',file:'flower_002.glb',name:'Interior 高绿植',at:[-3,.016,2.6],scale:1,mode:'floor'},
  {id:'small-plant',file:'flower_003.glb',name:'Interior 桌面盆栽',at:[-.6,0,.3],scale:.7,mode:'surface',on:'table'},
  {id:'lamp',file:'lamp_001.glb',name:'Interior 台灯',at:[-3,0,-1],scale:1,mode:'surface',on:'side-table'},
  {id:'picture',file:'picture_001.glb',name:'Interior 挂画',at:[1.2,2.4,-3.64],scale:1.1,mode:'wall'},
  {id:'bed',file:'bed_003.glb',name:'Interior 二层单人床',at:[-2.6,upperFloorY+.005,-2.1],scale:1.1,mode:'floor'},
  {id:'desk',file:'office_table_001.glb',name:'Interior 二层阅读桌',at:[.2,upperFloorY+.005,-3.15],scale:1,mode:'floor',support:true},
  {id:'reading-chair',file:'armchair_001.glb',name:'Interior 阅读椅',at:[.2,upperFloorY+.005,-1.8],scale:.85,turn:Math.PI,mode:'floor'},
  {id:'reading-lamp',file:'lamp_001.glb',name:'Interior 阅读灯',at:[.65,0,-3.15],scale:.8,mode:'surface',on:'desk'},
]

export async function furnishInteriorRoom(home, placementSurfaces, load=url=>new GLTFLoader().loadAsync(url)) {
  const files=[...new Set([...interiorShell,...interiorLayout].map(d=>d.file))]
  const results=await Promise.allSettled(files.map(file=>load(`/content/interior-1/${file}`)))
  const failed=results.find(r=>r.status==='rejected')
  if(failed) throw new Error(`Interior 房间加载失败，请刷新重试：${failed.reason?.message || failed.reason}`)
  const templates=new Map(files.map((file,i)=>[file,results[i].value.scene]))
  const stage=new THREE.Group(), shell=new THREE.Group(), newSurfaces=[], entries=[], byId=new Map()
  const floorMaterials=new Map()
  function floorMaterial(source) {
    if(!floorMaterials.has(source)) {
      const material=source.clone()
      material.color.set(interiorFloorTint)
      floorMaterials.set(source,material)
    }
    return floorMaterials.get(source)
  }
  shell.name='Interior 1 原装建筑'; shell.userData.licensedAsset=true
  function modelFor(def) {
    const model=new THREE.Group(), visual=templates.get(def.file).clone(true)
    visual.scale.multiplyScalar(def.scale); visual.rotation.y=def.turn || 0
    model.add(visual); model.position.set(...def.at); model.userData.licensedAsset=true
    visual.traverse(n=>{if(n.isMesh){
      n.castShadow=!def.floor;n.receiveShadow=true
      if(def.floor) {
        n.material=Array.isArray(n.material)?n.material.map(floorMaterial):floorMaterial(n.material)
        n.userData.interiorFloor=true
      }
    }})
    return model
  }
  const architecture=[]
  for(const [index,def] of interiorShell.entries()) {
    const model=modelFor(def); shell.add(model)
    const editable=architecturalEntry(home,model,def,index,'interior-1',placementSurfaces)
    if(editable)architecture.push(editable)
    if(def.floor) {
      // Authored plank seams are real gaps; use an exact tile-sized, non-rendered
      // picking plane so dropping a chair onto a seam does not fail.
      const collider=new THREE.Mesh(new THREE.PlaneGeometry(4*def.scale,4*def.scale),new THREE.MeshBasicMaterial({visible:false}))
      collider.rotation.x=-Math.PI/2; collider.position.set(...def.at); collider.position.y+=.001
      collider.userData.placementFloor=true; shell.add(collider); newSurfaces.push(collider)
    }
  }
  shell.updateWorldMatrix(true,true)
  for(const def of interiorLayout) {
    const model=modelFor(def); stage.add(model); model.name=def.name
    if(def.on) {
      const support=byId.get(def.on)
      model.position.y=support.position.y+support.userData.top+.005
    }
    model.updateWorldMatrix(true,true)
    if(def.support) {
      model.userData.top=new THREE.Box3().setFromObject(model).max.y-model.position.y
      model.traverse(n=>{if(n.isMesh)newSurfaces.push(n)})
    }
    byId.set(def.id,model)
    entries.push({id:`interior:duplex-${def.id}`,name:def.name,model,homeId:'interior',mode:def.mode,assetPack:'interior-1',home,placementSurfaces})
  }
  home.root.add(shell)
  for(const entry of entries)home.root.add(entry.model)
  home.surfaces.push(...newSurfaces); placementSurfaces.push(...newSurfaces)
  home.root.updateWorldMatrix(true,true)
  home.editableArchitecture=architecture
  return entries
}
