import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { readReplacements, REPLACEMENTS_KEY, loadReplacement, prepareReplacement, commitReplacement } from './furniture-replacement.js'
import { openReplacementDialog } from './replacement-dialog.js'
import { applyObjectColor } from './architecture-editing.js'
import { applyObjectAngle } from './object-angle.js'
import { makeWallMount } from './wall-mount.js'
import { createSelectionFeedback } from './selection-feedback.js'
import { previewWallTransfer } from './wall-transfer.js'

const STORAGE_KEY = 'hidden-object-cartoon-room-creator-v1'
const PENDING_KEY = 'hidden-object-cartoon-room-pending-v1'
const FURNITURE_KEY = 'hidden-object-cozy-furniture-v1'
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

function makeModel(spec) {
  const root = new THREE.Group()
  root.name = spec.name
  const parts = new THREE.Group()
  root.add(parts)
  for (const part of spec.parts) {
    const geometry = {
      box: () => new RoundedBoxGeometry(1, 1, 1, 2, .06),
      sphere: () => new THREE.SphereGeometry(.5, 20, 14),
      cylinder: () => new THREE.CylinderGeometry(.5, .5, 1, 20),
      cone: () => new THREE.ConeGeometry(.5, 1, 20),
      torus: () => new THREE.TorusGeometry(.36, .12, 8, 24),
    }[part.shape]()
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: part.color, roughness: .9, metalness: 0 }))
    mesh.position.set(...part.position)
    mesh.scale.set(...part.scale)
    if (part.rotation) mesh.rotation.set(...part.rotation)
    mesh.castShadow = true
    mesh.receiveShadow = true
    parts.add(mesh)
  }
  parts.updateMatrixWorld(true)
  const bounds = new THREE.Box3().setFromObject(parts)
  const center = bounds.getCenter(new THREE.Vector3())
  const size = bounds.getSize(new THREE.Vector3())
  parts.position.set(-center.x, -bounds.min.y, -center.z)
  const maxDimension = Math.max(size.x, size.y, size.z)
  root.scale.setScalar(Math.min(1.5 / maxDimension, 1.8))
  return root
}

function thumbnail(spec) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
  renderer.setSize(96, 96)
  renderer.setPixelRatio(1)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.setClearColor(0xffffff, 0)
  const scene = new THREE.Scene()
  const model = makeModel(spec)
  scene.add(model)
  scene.add(new THREE.HemisphereLight(0xfff4dc, 0x9ea991, 2.6))
  const key = new THREE.DirectionalLight(0xffe7b6, 2)
  key.position.set(3, 5, 5)
  scene.add(key)
  const camera = new THREE.PerspectiveCamera(36, 1, .1, 50)
  camera.position.set(2.1, 1.9, 3.1)
  camera.lookAt(0, .55, 0)
  renderer.render(scene, camera)
  const image = renderer.domElement.toDataURL('image/png')
  renderer.dispose()
  model.traverse(child => { if (child.isMesh) { child.geometry.dispose(); child.material.dispose() } })
  return image
}

export function initCreator({ renderer, camera, controls, exportRoot, getPlacementContext, defaultHome, movableItems = [], say }) {
  const form = document.querySelector('#generate-form')
  const promptInput = document.querySelector('#object-prompt')
  const button = document.querySelector('#generate-button')
  const status = document.querySelector('#generation-status')
  const inventory = document.querySelector('#generated-inventory')
  status.textContent = '创作系统已就绪：输入一句话开始生成。'
  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  const records = new Map()
  const modelNodes = new Map()
  const cards = new Map()
  let drag = null
  let replacementOpen=false
  const selection=exportRoot.parent && document.createElement?createSelectionFeedback(exportRoot,(id,passengers)=>replaceFurniture(id,passengers).catch(error=>say(error.message))):null
  async function replaceFurniture(id,passengers=[]) {
    const record=records.get(id)
    const item=movableItems.find(item=>item.id===id) || {id,name:record?.spec.name,model:modelNodes.get(id)}
    if(!record || !item.model)return
    if(item.restoring){say('正在恢复这件家具，请稍候。');return}
    replacementOpen=true
    try{
      await openReplacementDialog(item,async result=>{
        if(result.attach){
          const id=`${item.homeId}:mount-${crypto.randomUUID()}`
          const added=makeWallMount(item,result.asset,result.scene,id)
          const saved=readReplacements();saved[id]={pack:item.assetPack,file:result.asset.file,mountParent:item.id,position:added.model.position.toArray()}
          localStorage.setItem(REPLACEMENTS_KEY,JSON.stringify(saved))
          item.home.root.add(added.model);movableItems.push(added);registerItems([added],false)
          save();say(`已添加 ${result.asset.wall.category}，可沿墙拖动或点击调整角度。`);return
        }
        const prepared=prepareReplacement(item,result.asset,result.scene)
        // Validate loose objects against the replacement BEFORE removing their support.
        const probe=new THREE.Group();probe.matrixAutoUpdate=false
        item.model.updateWorldMatrix(true,true);probe.matrix.copy(item.model.matrixWorld)
        probe.add(prepared.visual);probe.updateWorldMatrix(true,true)
        const moves=[]
        for(const passenger of passengers){
          const world=passenger.model.getWorldPosition(new THREE.Vector3())
          const top=new THREE.Box3().setFromObject(probe).max.y
          const hit=new THREE.Raycaster(new THREE.Vector3(world.x,top+.1,world.z),new THREE.Vector3(0,-1,0)).intersectObject(probe,true).find(h=>h.face && h.face.normal.clone().transformDirection(h.object.matrixWorld).y>.65)
          if(!hit)throw Error('新物件无法承托桌上摆件，请先移开摆件再替换')
          moves.push([passenger.model,passenger.model.parent.worldToLocal(new THREE.Vector3(world.x,hit.point.y+.005,world.z))])
        }
        const saved=readReplacements()
        saved[id]={...saved[id],pack:item.assetPack,file:result.asset.file}
        // Refuse to modify the room if persistence fails.
        localStorage.setItem(REPLACEMENTS_KEY,JSON.stringify(saved))
        commitReplacement(item,prepared)
        if(saved[id].color)applyObjectColor(item.model,saved[id].color)
        if(saved[id].angle!==undefined)applyObjectAngle(item,saved[id].angle)
        for(const [model,position] of moves)model.position.copy(position)
        for(const passenger of passengers){const record=records.get(passenger.id);if(record?.placed)Object.assign(record.placed,{x:passenger.model.position.x,y:passenger.model.position.y,z:passenger.model.position.z})}
        records.get(id).spec.name=result.asset.name;item.name=result.asset.name
        save();say(`已替换为 ${result.asset.name}，${item.fixed?'安装位置保持不变':'位置保留，可继续拖动'}。`)
      },async color=>{
        const saved=readReplacements()
        saved[id]={...saved[id],pack:item.assetPack,color}
        localStorage.setItem(REPLACEMENTS_KEY,JSON.stringify(saved))
        applyObjectColor(item.model,color)
        say(color?'部件颜色已保存。':'已恢复该模型的原材质。')
      },async angle=>{
        if(!Number.isFinite(angle)||angle< -180||angle>180)throw Error('角度需在 -180° 到 180° 之间')
        if(passengers.length)throw Error('请先移开上面的摆件，再旋转支撑家具')
        const saved=readReplacements();saved[id]={...saved[id],pack:item.assetPack,angle}
        localStorage.setItem(REPLACEMENTS_KEY,JSON.stringify(saved));applyObjectAngle(item,angle);say(`已保存角度 ${angle}°。`)
      },async()=>{
        if(item.fixed)throw Error('房屋结构不能移除')
        if(passengers.length)throw Error('请先移开上面的摆件，再移除支撑家具')
        if(!record.builtin){
          const previous=record.placed;record.placed=null
          try{save()}catch(error){record.placed=previous;throw error}
          item.model.visible=false;cards.get(id)?.classList.remove('placed')
          say('已从房间收起，物件仍在下方物品栏，可再次摆放。')
        }else{
          const saved=readReplacements()
          saved[id]={...saved[id],pack:item.assetPack,removed:true}
          localStorage.setItem(REPLACEMENTS_KEY,JSON.stringify(saved))
          record.placed=null;item.model.visible=false
          const meshes=new Set();item.model.traverse(n=>{if(n.isMesh)meshes.add(n)})
          for(const surfaces of new Set([item.home?.surfaces,item.placementSurfaces,getPlacementContext().surfaces].filter(Boolean)))for(let i=surfaces.length-1;i>=0;i--)if(meshes.has(surfaces[i]))surfaces.splice(i,1)
          say('已从房间移除，资源库文件未删除。')
        }
        syncVisibility()
      })
    }finally{replacementOpen=false}
  }
  function syncVisibility() {
    const activeId = getPlacementContext().home?.id
    for (const [id, model] of modelNodes) {
      const record = records.get(id)
      model.visible = !!record?.placed && (!activeId || record.placed.homeId === activeId)
    }
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...records.values()].filter(record => !record.builtin)))
    let previous = {}
    try { previous = JSON.parse(localStorage.getItem(FURNITURE_KEY) || '{}') } catch { /* Preserve live positions. */ }
    localStorage.setItem(FURNITURE_KEY, JSON.stringify({ ...previous, ...Object.fromEntries(
      movableItems.filter(item=>!item.fixed).map(item => [item.id, item.model.position.toArray()])) }))
  }

  function placeAtPointer(event) {
    if (!drag) return
    const underneath = document.elementFromPoint(event.clientX, event.clientY)
    if (underneath !== renderer.domElement) {
      drag.valid = false
      drag.model.visible = false
      return
    }
    pointer.set(event.clientX / innerWidth * 2 - 1, -(event.clientY / innerHeight * 2 - 1))
    raycaster.setFromCamera(pointer, camera)
    if (drag.record.mode === 'wall') {
      const item=movableItems.find(item=>item.id===drag.record.id)
      const walls=getPlacementContext().home.editableArchitecture?.filter(w=>w.kind==='wall' && !/Exterior/.test(w.sourceFile))||[]
      const hits=raycaster.intersectObjects(walls.map(w=>w.model),true)
      const target=hits.find(h=>h.face && Math.abs(h.face.normal.clone().transformDirection(h.object.matrixWorld).y)<.1)
      if(target && item){
        const wall=walls.find(w=>isInside(target.object,w.model))
        drag.valid=previewWallTransfer(item,wall,target.point);drag.model.visible=true
        if(drag.valid)drag.targetWall=wall.id
        selection?.valid(drag.valid);return
      }
      if(walls.length){drag.valid=false;drag.model.visible=true;selection?.valid(false);return}
      const point = raycaster.ray.intersectPlane(drag.wallPlane, new THREE.Vector3())
      if (!point) { drag.valid = false; return }
      point.add(drag.grabOffset)
      const local = drag.model.parent.worldToLocal(point)
      if (Math.abs(local.x) > 4.4 || Math.abs(local.z)>4.4 || local.y < .05 || local.y > (getPlacementContext().home.id==='interior'?7.3:4.7)) { drag.valid = false; return }
      drag.model.position.copy(local)
      drag.model.visible = true
      drag.valid = true
      movePassengers()
      return
    }
    const hits = raycaster.intersectObjects(getPlacementContext().surfaces, false)
      .filter(hit => isVisibleInScene(hit.object) && hit.face && hit.face.normal.clone().transformDirection(hit.object.matrixWorld).y > .65 && !isInside(hit.object, drag.model)
        && (drag.record.mode !== 'floor' || hit.object.userData.placementFloor || hit.point.y < .2))
    const hit = hits[0]
    if (!hit) {
      drag.valid = false
      drag.model.visible = false
      return
    }
    drag.model.position.copy(drag.model.parent.worldToLocal(hit.point.clone().add(new THREE.Vector3(0, .02, 0))))
    drag.model.visible = true
    drag.valid = true
    movePassengers()
  }

  function isInside(node, parent) {
    for (let current = node; current; current = current.parent) if (current === parent) return true
    return false
  }
  function isVisibleInScene(node) {
    for(let current=node;current;current=current.parent)if(!current.visible)return false
    return true
  }
  function movePassengers() {
    for (const passenger of drag.passengers || []) {
      passenger.model.position.copy(passenger.position).add(drag.model.position.clone().sub(drag.oldPosition))
    }
  }

  // Capture before OrbitControls: dragging a placed prop moves the prop;
  // dragging empty space continues to rotate the room.
  renderer.domElement.addEventListener('pointerdown', event => {
    if (event.button !== 0 || drag || replacementOpen || !getPlacementContext().home) return
    const rect = renderer.domElement.getBoundingClientRect()
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1)
    raycaster.setFromCamera(pointer, camera)
    const candidates = [...modelNodes.values()].filter(model => model.visible)
    const hit = raycaster.intersectObjects(candidates, true)[0]
    if (!hit) {selection?.clear();return}
    let model = hit.object
    while (model.parent && !candidates.includes(model)) model = model.parent
    const entry = [...modelNodes.entries()].find(([, node]) => node === model)
    if (!entry) return
    if(movableItems.find(item=>item.id===entry[0])?.restoring){say('正在恢复家具，请稍候。');return}
    const record = records.get(entry[0])
    if(record.mode!=='fixed'){
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    const card = cards.get(entry[0])
    drag = { record, model, card, source: 'scene', valid: false,
      oldPosition: model.position.clone(), pointerId: event.pointerId,
      oldRotationY:model.rotation.y,
      startX: event.clientX, startY: event.clientY, moved: false }
    const world = model.getWorldPosition(new THREE.Vector3())
    const wallTurn=movableItems.find(item=>item.id===entry[0])?.fixedTurn||0
    drag.wallPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(Math.sin(wallTurn),0,Math.cos(wallTurn)),hit.point)
    drag.grabOffset = world.clone().sub(hit.point)
    drag.passengers = []
    // Carry loose tabletop objects with their supporting furniture.
    const supportSurfaces = getPlacementContext().surfaces.filter(surface => isInside(surface, model))
    if (supportSurfaces.length) for (const [id, candidate] of modelNodes) {
      if (candidate === model || !candidate.visible || isInside(candidate, model)) continue
      const bottom = candidate.getWorldPosition(new THREE.Vector3())
      const supportRay = new THREE.Raycaster(bottom.clone().add(new THREE.Vector3(0, .12, 0)), new THREE.Vector3(0, -1, 0), 0, .35)
      if (supportRay.intersectObjects(supportSurfaces, false).length) drag.passengers.push({ id, model: candidate, position: candidate.position.clone() })
    }
    controls.enabled = record.mode==='fixed'
    selection?.select(entry[0],model,record.spec.name,drag.passengers)
    card?.classList.add('dragging')
    renderer.domElement.style.cursor = record.mode==='fixed'?'pointer':'grabbing'
    if(record.mode!=='fixed')renderer.domElement.setPointerCapture(event.pointerId)
  }, true)

  document.addEventListener('pointermove', event => {
    if (drag?.source !== 'scene' || event.pointerId !== drag.pointerId) return
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4) return
    drag.moved = true
    if(drag.record.mode==='fixed')return
    placeAtPointer(event)
    selection?.valid(drag.valid)
  })
  document.addEventListener('pointerup', event => {
    if (drag?.source !== 'scene' || event.pointerId !== drag.pointerId) return
    if (drag.moved && drag.record.mode!=='fixed') placeAtPointer(event)
    const clicked=!drag.moved, id=drag.record.id, passengers=drag.passengers
    finishDrag()
    if(clicked)selection?.select(id,modelNodes.get(id),records.get(id).spec.name,passengers)
  })
  document.addEventListener('pointercancel', event => {
    if (drag?.source !== 'scene' || event.pointerId !== drag.pointerId) return
    drag.valid = false
    finishDrag()
  })

  function finishDrag() {
    if (!drag) return
    const { record, model, card, oldPosition, valid } = drag
    if (valid) {
      record.placed = { homeId: getPlacementContext().home.id, x: model.position.x, y: model.position.y, z: model.position.z, rotationY: model.rotation.y }
      model.visible = true
      card?.classList.add('placed')
      for (const passenger of drag.passengers || []) {
        const carried = records.get(passenger.id)
        carried.placed = { ...carried.placed, x: passenger.model.position.x, y: passenger.model.position.y, z: passenger.model.position.z }
      }
      say(`${record.spec.name}已摆进${getPlacementContext().home.short}。再次拖动可调整位置。`)
      if(record.mode==='wall'){
        const saved=readReplacements(),item=movableItems.find(i=>i.id===record.id)
        saved[record.id]={...saved[record.id],pack:item?.assetPack,wallRotation:model.rotation.y,attachedWall:drag.targetWall}
        localStorage.setItem(REPLACEMENTS_KEY,JSON.stringify(saved))
      }
      save()
    } else if (oldPosition) {
      model.position.copy(oldPosition)
      if(drag.oldRotationY!==undefined)model.rotation.y=drag.oldRotationY
      model.visible = true
      for (const passenger of drag.passengers || []) passenger.model.position.copy(passenger.position)
    } else {
      exportRoot.remove(model)
      modelNodes.delete(record.id)
      say('松开的位置不是可摆放区域，物件仍在物品栏。')
    }
    card?.classList.remove('dragging')
    if (drag.source === 'scene') {
      if (renderer.domElement.hasPointerCapture(drag.pointerId)) renderer.domElement.releasePointerCapture(drag.pointerId)
      renderer.domElement.style.cursor = ''
    }
    controls.enabled = true
    drag = null
    syncVisibility()
  }

  document.addEventListener('pointermove', event => { if (drag?.source === 'pointer') placeAtPointer(event) })
  document.addEventListener('pointerup', () => { if (drag?.source === 'pointer') finishDrag() })
  document.addEventListener('pointercancel', () => { if (drag?.source === 'pointer') finishDrag() })
  document.addEventListener('dragover', event => {
    if (!drag) return
    event.preventDefault()
    placeAtPointer(event)
  })
  document.addEventListener('drop', event => {
    if (!drag) return
    event.preventDefault()
    placeAtPointer(event)
    finishDrag()
  })
  document.addEventListener('dragend', finishDrag)

  function renderCard(record) {
    const card = document.createElement('button')
    card.type = 'button'
    cards.set(record.id, card)
    card.className = 'generated-item'
    card.draggable = true
    card.setAttribute('aria-label', `拖动摆放${record.spec.name}`)
    const img = document.createElement('img')
    img.src = thumbnail(record.spec)
    img.alt = ''
    const label = document.createElement('span')
    label.textContent = record.spec.name
    card.append(img, label)
    if (record.placed) card.classList.add('placed')
    function startDrag(source) {
      if (drag) return
      if (!getPlacementContext().home) {
        say('先从上方选一间小屋，再摆放物件。')
        return
      }
      const model = modelNodes.get(record.id) || makeModel(record.spec)
      if (!model.parent) exportRoot.add(model)
      modelNodes.set(record.id, model)
      drag = {
        record, model, card, source, valid: false,
        oldPosition: record.placed ? model.position.clone() : null,
      }
      card.classList.add('dragging')
      controls.enabled = false
      say(`拖动 ${record.spec.name} 到地板、桌面或书架上。`)
    }
    card.addEventListener('dragstart', event => {
      startDrag('native')
      if (!drag) { event.preventDefault(); return }
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', record.spec.name)
    })
    card.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse') return
      event.preventDefault()
      startDrag('pointer')
      if (drag) card.setPointerCapture(event.pointerId)
    })
    card.addEventListener('click', () => {
      if (drag) return
      startDrag('click')
      if (!drag) return
      const home = getPlacementContext().home
      const count = [...records.values()].filter(item => !item.builtin && item.placed?.homeId === home.id && item.id !== record.id).length
      drag.model.position.set(home.quickSpot.x + count % 3 * .62, home.quickSpot.y, home.quickSpot.z + Math.floor(count / 3) * .54)
      drag.valid = true
      finishDrag()
    })
    inventory.append(card)
    if (record.placed) {
      const model = makeModel(record.spec)
      model.position.set(record.placed.x, record.placed.y, record.placed.z)
      model.rotation.y = record.placed.rotationY || 0
      exportRoot.add(model)
      modelNodes.set(record.id, model)
    }
  }

  async function poll(taskId, prompt) {
    for (let attempt = 0; attempt < 90; attempt++) {
      await wait(1500)
      const response = await fetch(`/api/room-object?taskId=${encodeURIComponent(taskId)}`)
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data.status === 'failed' || data.status === 'cancelled') {
        localStorage.removeItem(PENDING_KEY)
        throw new Error(data.error || '物件生成失败')
      }
      if (data.status !== 'succeeded') {
        status.textContent = `AI 正在设计「${prompt}」…你可以继续观察房间。`
        continue
      }
      if (!data.spec?.parts?.length) throw new Error('AI 未返回可用 3D 物件')
      const record = { id: crypto.randomUUID(), prompt, spec: data.spec, placed: null, taskId }
      records.set(record.id, record)
      renderCard(record)
      save()
      localStorage.removeItem(PENDING_KEY)
      status.textContent = `已生成「${record.spec.name}」；选择一家，再从物品栏摆进去。`
      say(`「${record.spec.name}」已加入物品栏！`)
      return
    }
    throw new Error('任务仍在运行；刷新页面会继续等待同一任务')
  }

  async function run(prompt, existingTaskId) {
    button.disabled = true
    status.textContent = `正在为「${prompt}」创建 AI 生成任务…`
    try {
      let taskId = existingTaskId
      if (!taskId) {
        const response = await fetch('/api/room-object', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt }) })
        const data = await response.json().catch(() => ({}))
        if (!response.ok || !data.taskId) throw new Error(data.error || 'AI 服务没有创建任务')
        taskId = data.taskId
        localStorage.setItem(PENDING_KEY, JSON.stringify({ taskId, prompt }))
      }
      await poll(taskId, prompt)
    } catch (cause) {
      const message = (cause instanceof Error ? cause.message : '生成失败').slice(0, 180)
      status.textContent = `未生成物件：${message}`
      say(`未生成：${message}`)
      if (localStorage.getItem(PENDING_KEY)) status.textContent += ' 刷新页面可继续查询同一任务。'
    } finally {
      button.disabled = false
    }
  }

  form.addEventListener('submit', event => {
    event.preventDefault()
    const prompt = promptInput.value.trim()
    if (prompt.length >= 2) run(prompt)
  })

  function registerItems(items,restore=true) {
    let furniturePositions = {}
    try { furniturePositions = JSON.parse(localStorage.getItem(FURNITURE_KEY) || '{}') } catch { /* Keep default furniture layout. */ }
    for (const item of items) {
      const position = furniturePositions?.[item.id]
      if (!item.fixed && Array.isArray(position) && position.length === 3 && position.every(Number.isFinite)) item.model.position.fromArray(position)
      records.set(item.id, { id: item.id, builtin: true, mode: item.mode,
        spec: { name: item.name }, placed: { homeId: item.homeId } })
      modelNodes.set(item.id, item.model)
      const replacement=readReplacements()[item.id]
      if(Number.isFinite(replacement?.wallRotation))item.model.rotation.y=replacement.wallRotation
      if(replacement?.removed && !item.fixed){
        records.get(item.id).placed=null
        const meshes=new Set();item.model.traverse(n=>{if(n.isMesh)meshes.add(n)})
        for(const surfaces of new Set([item.home?.surfaces,item.placementSurfaces,getPlacementContext().surfaces].filter(Boolean)))for(let i=surfaces.length-1;i>=0;i--)if(meshes.has(surfaces[i]))surfaces.splice(i,1)
        continue
      }
      if(restore && replacement && item.assetPack && replacement.file){
        item.restoring=true
        loadReplacement(item,replacement).then(result=>{
          commitReplacement(item,prepareReplacement(item,result.asset,result.scene))
          if(replacement.color)applyObjectColor(item.model,replacement.color)
          if(replacement.angle!==undefined)applyObjectAngle(item,replacement.angle)
          item.name=result.asset.name;records.get(item.id).spec.name=result.asset.name
        }).catch(error=>say(`家具替换记录暂未恢复，保留默认模型：${error.message}`)).finally(()=>{item.restoring=false})
      }else if(restore && item.assetPack){
        if(replacement?.color)applyObjectColor(item.model,replacement.color)
        if(replacement?.angle!==undefined)applyObjectAngle(item,replacement.angle)
      }
      if(restore && item.fixed)for(const [id,saved] of Object.entries(readReplacements())){
        if(saved.removed || saved.mountParent!==item.id || records.has(id))continue
        loadReplacement({...item,kind:null},saved).then(result=>{
          if(records.has(id))return
          const added=makeWallMount(item,result.asset,result.scene,id,saved.position)
          item.home.root.add(added.model);movableItems.push(added);registerItems([added],false)
          if(saved.color)applyObjectColor(added.model,saved.color)
          if(saved.angle!==undefined)applyObjectAngle(added,saved.angle)
        }).catch(error=>say(`墙面物件恢复失败：${error.message}`))
      }
    }
    syncVisibility()
  }
  syncVisibility.registerItems = items => { registerItems(items); save() }
  try {
    registerItems(movableItems)
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    if (Array.isArray(saved)) for (const record of saved.slice(0, 12)) {
      if (!record?.id || !record.spec?.parts?.length) continue
      // The retired atelier is replaced wholesale. Keep custom creations in
      // inventory instead of silently mixing them into the new Interior room.
      if (record.placed?.homeId === 'atelier') record.placed = null
      if (record.placed && !record.placed.homeId && defaultHome) {
        // Preserve previously generated items while migrating from the single-room prototype.
        record.placed = { ...record.placed, homeId: defaultHome.id,
          x: defaultHome.quickSpot.x + [...records.values()].filter(item => !item.builtin).length * .55, y: defaultHome.quickSpot.y, z: defaultHome.quickSpot.z }
      }
      records.set(record.id, record)
      renderCard(record)
    }
    save()
    const pending = JSON.parse(localStorage.getItem(PENDING_KEY) || 'null')
    if (pending?.taskId && pending?.prompt) run(pending.prompt, pending.taskId)
  } catch {
    status.textContent = '旧的本地记录无法读取；可以继续生成新物件。'
  }
  syncVisibility()
  return syncVisibility
}
