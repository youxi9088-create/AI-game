import * as THREE from 'three'
export function createSelectionFeedback(root,onEdit) {
  // A wire bounding frame stays outside imported meshes/materials and exports.
  const box=new THREE.Box3(),helper=new THREE.Box3Helper(box,0x65bfaa)
  helper.material.depthTest=false;helper.material.transparent=true;helper.material.opacity=.9;helper.renderOrder=999
  root.parent.add(helper);helper.visible=false
  const panel=document.createElement('section');panel.className='object-selection';panel.hidden=true
  panel.setAttribute('aria-label','当前选中物件')
  const name=document.createElement('strong'),status=document.createElement('span'),edit=document.createElement('button'),cancel=document.createElement('button')
  edit.textContent='编辑 / 替换 / 移除';cancel.textContent='取消选择';edit.type=cancel.type='button'
  panel.append(name,status,edit,cancel);document.body.append(panel)
  let selected=null,frame
  function clear(){selected=null;helper.visible=false;panel.hidden=true}
  edit.onclick=()=>{if(selected)onEdit(selected.id,selected.passengers)};cancel.onclick=clear
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!document.querySelector('dialog[open]'))clear()})
  function tick(){
    if(selected){
      let visible=true;for(let n=selected.model;n;n=n.parent)if(!n.visible)visible=false
      if(!visible){clear()}else{box.setFromObject(selected.model);helper.visible=true}
    }
    frame=requestAnimationFrame(tick)
  }
  frame=requestAnimationFrame(tick)
  return {clear,select(id,model,label,passengers=[]){selected={id,model,passengers};name.textContent=`已选中：${label}`;status.textContent='拖动移动 · 点击编辑';panel.hidden=false;box.setFromObject(model);helper.visible=true;helper.material.color.setHex(0x65bfaa)},valid(ok){helper.material.color.setHex(ok?0x65bfaa:0xd95d52);status.textContent=ok?'可放置，松手确认':'不可放置，松手回原位'},dispose(){cancelAnimationFrame(frame);helper.removeFromParent();helper.geometry.dispose();helper.material.dispose();panel.remove()}}
}
