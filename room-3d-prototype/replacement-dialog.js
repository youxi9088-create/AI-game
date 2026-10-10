import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { categories, filterAssets } from './asset-catalog.js'
import { loadReplacementCatalog,loadReplacement,packLabels } from './furniture-replacement.js'
import { architectureKind } from './architecture-editing.js'

export async function openReplacementDialog(item,onApply,onColor,onAngle,onRemove) {
  const dialog=document.createElement('dialog')
  dialog.className='replacement-dialog'
  dialog.setAttribute('aria-labelledby','replacement-title')
  dialog.innerHTML=`<header><div><h2 id="replacement-title">替换家具</h2><p class="replacement-source"></p></div><button type="button" data-close aria-label="关闭替换面板">关闭</button></header>
    <div class="replacement-filters"><label>搜索<input type="search" placeholder="名称或类别，如：沙发" /></label><label>类别<select><option value="">全部类别</option></select></label></div>
    <div class="replacement-body"><div><p data-count></p><select class="replacement-list" size="10" aria-label="同资源包物件列表"></select></div><div class="replacement-preview" aria-label="模型预览"></div></div>
    <p data-status role="status" aria-live="polite">正在读取资源库…</p><p class="replacement-note">保留原位置与朝向，等比适配原物件尺寸。拖动预览可旋转；确认前不会修改房间。</p>
    <footer><button type="button" data-retry>重试加载</button><button type="button" data-cancel>取消</button><button type="button" data-apply disabled>确认替换</button></footer>`
  document.body.append(dialog)
  if(onRemove && !item.fixed){
    const remove=document.createElement('button');remove.type='button';remove.textContent='从房间移除';remove.className='remove-object-button'
    let confirmed=false
    remove.onclick=async()=>{
      if(!confirmed){confirmed=true;remove.textContent='确认移除（生成物件退回物品栏）';return}
      remove.disabled=true
      try{await onRemove();dialog.close()}catch(error){dialog.querySelector('[data-status]').textContent=error.message;remove.disabled=false;confirmed=false;remove.textContent='从房间移除'}
    }
    dialog.querySelector('footer').prepend(remove)
  }
  if(!item.assetPack){
    dialog.querySelector('h2').textContent='管理物件'
    dialog.querySelector('.replacement-source').textContent=item.name
    for(const selector of ['.replacement-filters','.replacement-body','[data-retry]','[data-apply]'])dialog.querySelector(selector).remove()
    dialog.querySelector('[data-status]').textContent='可以收起不需要的物件。'
    dialog.querySelector('.replacement-note').textContent='生成物件将回到物品栏，可再次摆放；预置家具移除后刷新也不会重新出现。'
    dialog.querySelector('[data-close]').onclick=()=>dialog.close();dialog.querySelector('[data-cancel]').onclick=()=>dialog.close()
    dialog.showModal()
    await new Promise(resolve=>dialog.addEventListener('close',()=>{dialog.remove();resolve()},{once:true}))
    return
  }
  if(onAngle && item.kind!=='wall' && item.kind!=='floor' && !/Window_Cutout/i.test(item.sourceFile||'')){
    const angles=document.createElement('div');angles.className='replacement-colors'
    angles.innerHTML='<label>角度 <input type="number" min="-180" max="180" step="5" aria-label="物件角度" /> °</label><button type="button" data-minus>−15°</button><button type="button" data-plus>+15°</button><button type="button" data-angle>保存角度</button>'
    const input=angles.querySelector('input');input.value=item.model.userData.editAngle||0
    input.setAttribute('title',item.mode==='wall'||item.kind==='window'?'沿墙面倾斜角度':'绕竖直轴旋转朝向')
    const explanation=document.createElement('small');explanation.textContent=item.mode==='wall'||item.kind==='window'?'贴墙倾斜（0° 恢复端正）':'家具朝向（0° 恢复默认）';angles.append(explanation)
    angles.querySelector('[data-minus]').onclick=()=>{input.value=Math.max(-180,Number(input.value)-15)}
    angles.querySelector('[data-plus]').onclick=()=>{input.value=Math.min(180,Number(input.value)+15)}
    angles.querySelector('[data-angle]').onclick=async()=>{try{await onAngle(Number(input.value));dialog.close()}catch(error){dialog.querySelector('[data-status]').textContent=error.message}}
    dialog.querySelector('header').after(angles)
  }
  if(item.fixed){
    dialog.querySelector('h2').textContent='编辑建筑部件'
    dialog.querySelector('.replacement-note').textContent='仅显示同包同类部件；替换适配当前安装槽。颜色为纯色涂装，保留模型细节；只作用于点击的这一块。'
    const colors=document.createElement('div');colors.className='replacement-colors'
    colors.innerHTML='<label>部件颜色 <input type="color" aria-label="部件颜色" /></label><button type="button" data-color>应用颜色</button><button type="button" data-original>恢复原材质</button>'
    dialog.querySelector('header').after(colors)
    colors.querySelector('input').value=item.model.userData.paintColor || '#789c8f'
    const setColor=async color=>{try{await onColor(color);dialog.close()}catch(error){dialog.querySelector('[data-status]').textContent=`颜色未保存：${error.message}`}}
    colors.querySelector('[data-color]').onclick=()=>setColor(colors.querySelector('input').value)
    colors.querySelector('[data-original]').onclick=()=>setColor(null)
  }
  const search=dialog.querySelector('input[type="search"]'),category=dialog.querySelector('.replacement-filters select'),list=dialog.querySelector('.replacement-list')
  const status=dialog.querySelector('[data-status]'),apply=dialog.querySelector('[data-apply]'),preview=dialog.querySelector('.replacement-preview')
  dialog.querySelector('.replacement-source').textContent=`${item.name} · 仅 ${packLabels[item.assetPack]}`
  for(const [name] of categories){const option=document.createElement('option');option.value=name;option.textContent=name;category.append(option)}
  let assets=[],selected=null,version=0,closed=false,current=null,busy=false,renderer=null,controls=null,observer=null
  let attach=false
  if(item.kind==='wall'||item.kind==='window'){
    const toggle=document.createElement('button');toggle.type='button';toggle.textContent='添加墙面物件（窗帘 / 挂画等）'
    dialog.querySelector('header').after(toggle)
    toggle.onclick=()=>{attach=!attach;version++;clearPreview();toggle.textContent=attach?'返回建筑替换':'添加墙面物件（窗帘 / 挂画等）';apply.textContent=attach?'添加到墙面':'确认替换';search.value='';category.value='';init()}
  }
  let resolveClosed
  const whenClosed=new Promise(resolve=>{resolveClosed=resolve})
  const scene=new THREE.Scene();scene.background=new THREE.Color('#e5e6dd')
  scene.add(new THREE.HemisphereLight(0xffffff,0x8c9685,2.5))
  const sun=new THREE.DirectionalLight(0xfff5e5,2);sun.position.set(3,6,5);scene.add(sun)
  const camera=new THREE.PerspectiveCamera(38,1,.01,1000)
  function dispose(model){
    const resources=new Set()
    model?.traverse(n=>{if(n.isMesh){resources.add(n.geometry);for(const m of [n.material].flat()){resources.add(m);for(const value of Object.values(m))if(value?.isTexture)resources.add(value)}}})
    resources.forEach(r=>r.dispose())
  }
  function clearPreview(){if(current){scene.remove(current);dispose(current);current=null}selected=null;apply.disabled=true}
  function close(){if(!busy)dialog.close()}
  dialog.querySelector('[data-close]').onclick=close;dialog.querySelector('[data-cancel]').onclick=close
  dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault()})
  dialog.addEventListener('close',()=>{closed=true;version++;clearPreview();observer?.disconnect();controls?.dispose();renderer?.setAnimationLoop(null);renderer?.dispose();dialog.remove();resolveClosed()},{once:true})
  dialog.showModal();search.focus()
  try{
    renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace
    preview.append(renderer.domElement);controls=new OrbitControls(camera,renderer.domElement)
    observer=new ResizeObserver(()=>{const w=preview.clientWidth,h=preview.clientHeight;renderer.setSize(w,h);camera.aspect=w/Math.max(h,1);camera.updateProjectionMatrix()});observer.observe(preview)
    renderer.setAnimationLoop(()=>{controls.update();renderer.render(scene,camera)})
  }catch(error){status.textContent=`预览无法启动：${error.message}`;await whenClosed;return}
  async function show(){
    const token=++version;clearPreview()
    const asset=assets.find(a=>a.file===list.value)
    if(!asset){status.textContent='没有匹配物件，请修改筛选。';return}
    status.textContent='正在加载预览…'
    try{
      const result=await loadReplacement(attach?{...item,kind:null}:item,asset)
      result.attach=attach
      if(closed || token!==version){dispose(result.scene);return}
      current=result.scene;scene.add(current);selected=result
      const box=new THREE.Box3().setFromObject(current),center=box.getCenter(new THREE.Vector3()),radius=Math.max(...box.getSize(new THREE.Vector3()).toArray(),.1)
      controls.target.copy(center);camera.position.copy(center).add(new THREE.Vector3(radius*1.3,radius*.9,radius*1.6));controls.update()
      status.textContent=`预览：${asset.name} · ${asset.category}`;apply.disabled=false
    }catch(error){if(!closed && token===version)status.textContent=`未替换：${error.message}。可重试或选择其他物件。`}
  }
  function filter(){
    const filtered=filterAssets(assets,item.assetPack,category.value,search.value)
    list.replaceChildren()
    for(const asset of filtered){const option=document.createElement('option');option.value=asset.file;option.textContent=`${asset.name} · ${attach?asset.wall.category:asset.category}`;list.append(option)}
    list.selectedIndex=filtered.length?0:-1
    dialog.querySelector('[data-count]').textContent=`${filtered.length} / ${assets.length} 个同库资源`
    show()
  }
  async function init(){try{assets=(await loadReplacementCatalog(item.assetPack)).filter(a=>(attach||item.mode==='wall')?a.wall?.eligible:(!item.kind || architectureKind(a.file)===item.kind));if(!closed)filter()}catch(error){if(!closed)status.textContent=error.message}}
  search.oninput=filter;category.onchange=filter;list.onchange=show
  dialog.querySelector('[data-retry]').onclick=()=>assets.length?show():init()
  apply.onclick=async()=>{
    if(!selected || busy)return
    busy=true;apply.disabled=true
    try{await onApply(selected);current=null;dialog.close()}catch(error){status.textContent=`未替换：${error.message}`;apply.disabled=false}finally{busy=false}
  }
  await init()
  await whenClosed
}
