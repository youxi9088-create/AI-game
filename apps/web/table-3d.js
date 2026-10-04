import {drawPlayingCard} from './playing-card-art.js';
import {prefs} from './runtime.js';
let world,loading,target,lastGame,failed=false;
export function syncTable3D(game,route){
 target=route==='table'&&prefs().renderer==='3d'?document.querySelector('.table-felt'):null;lastGame=game;
 if(!target){world?.detach();return;}
 if(failed){target.dataset.renderFallback='3D 暂不可用，已使用标准牌桌';return;}
 if(world){world.attach(target,game);return;}
 loading ||= import('./vendor/three/three.module.js').then(T=>{world=createWorld(T);if(target)world.attach(target,lastGame);}).catch(error=>{failed=true;if(target)target.dataset.renderFallback='3D 暂不可用，已使用标准牌桌';console.warn('3D fallback:',error.message);});
}
export function table3DStatus(){return world?.status() || {ready:false,failed};}
function createWorld(T){
 const renderer=new T.WebGLRenderer({alpha:true,antialias:true,powerPreference:'low-power'});
 renderer.setPixelRatio(Math.min(devicePixelRatio,prefs().effects==='soft'?1:1.5));renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
 const canvas=renderer.domElement;canvas.className='table-three';canvas.setAttribute('aria-hidden','true');
 // The room is the existing authored art plate; table and played cards remain WebGL geometry.
 const scene=new T.Scene();
 const camera=new T.OrthographicCamera(-8,8,4.1,-4.1,.1,60),goal=new T.Vector3(0,2.9,0);
 scene.add(new T.HemisphereLight('#fff0d5','#142e35',1.6));
 const mat=(color,roughness=.65,metalness=0)=>new T.MeshStandardMaterial({color,roughness,metalness});
 function texture(draw,w=512,h=256){const c=document.createElement('canvas');c.width=w;c.height=h;draw(c.getContext('2d'),w,h);const tx=new T.CanvasTexture(c);tx.colorSpace=T.SRGBColorSpace;tx.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());return tx;}
 const weave=texture((c,w,h)=>{c.fillStyle='#c5c4b8';c.fillRect(0,0,w,h);let seed=91;for(let y=0;y<h;y+=2)for(let x=0;x<w;x+=2){seed=(seed*16807)%2147483647;c.fillStyle=`rgba(${seed%2?255:0},${seed%2?255:0},${seed%2?255:0},${.025+(seed%30)/400})`;c.fillRect(x,y,1,2);}},512,512);
 weave.wrapS=weave.wrapT=T.RepeatWrapping;weave.repeat.set(12,7);
 const cloth=texture((c,w,h)=>{const g=c.createRadialGradient(w*.5,h*.35,40,w*.5,h*.4,w*.6);g.addColorStop(0,'#e8e5cc');g.addColorStop(.55,'#a3b6a6');g.addColorStop(1,'#435e58');c.fillStyle=g;c.fillRect(0,0,w,h);let seed=193;for(let i=0;i<90000;i++){seed=(seed*16807)%2147483647;const x=seed%w;seed=(seed*16807)%2147483647;const y=seed%h;c.fillStyle=i%2?'#ffffff09':'#00000009';c.fillRect(x,y,1,2);}},1024,1024);
 const gold=mat('#b89b62',.33,.65),dark=mat('#17252a',.82),felt=mat('#397c69',.98),wood=mat('#251b1a',.38,.12);felt.map=cloth;felt.bumpMap=weave;felt.bumpScale=.013;
 function mesh(geometry,material,x=0,y=0,z=0){const m=new T.Mesh(geometry,material);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;scene.add(m);return m;}
 function oval(rx,rz,h,m,y){const item=mesh(new T.CylinderGeometry(1,1,h,128),m,0,y,0);item.scale.set(rx,1,rz+.8);item.position.z=.35;return item;}
 oval(8.1,3.65,.25,wood,.86);oval(8.1,3.65,.025,gold,1);oval(8.01,3.56,.14,dark,1.07);oval(7.73,3.29,.027,gold,1.145);oval(7.69,3.25,.032,felt,1.162);
 function stitch(rx,rz,color,dashed=false){const pts=[];for(let i=0;i<=192;i++){const a=i/192*Math.PI*2;pts.push(new T.Vector3(Math.cos(a)*rx,1.185,Math.sin(a)*(rz+.8)+.35));}const g=new T.BufferGeometry().setFromPoints(pts);const m=dashed?new T.LineDashedMaterial({color,dashSize:.035,gapSize:.04,transparent:true,opacity:.45}):new T.LineBasicMaterial({color,transparent:true,opacity:.35});const line=new T.Line(g,m);line.computeLineDistances();scene.add(line);}
 stitch(7.49,3.07,'#b9ae77');stitch(7.40,2.99,'#b9ae77');stitch(7.91,3.46,'#c0b298',true);
 const light=new T.DirectionalLight('#ffe8be',1.8);light.position.set(-4,9,3);light.castShadow=true;light.shadow.mapSize.set(1024,1024);Object.assign(light.shadow.camera,{left:-10,right:10,top:6,bottom:-6});light.shadow.bias=-.0003;scene.add(light);
 const fill=new T.DirectionalLight('#8facce',.8);fill.position.set(6,4,-4);scene.add(fill);
 const insignia=texture((c,w,h)=>{c.strokeStyle='#c7ae73';c.fillStyle='#c7ae73';c.lineWidth=1.5;c.beginPath();c.ellipse(w/2,h/2,225,92,0,0,Math.PI*2);c.stroke();c.beginPath();c.moveTo(45,h/2);c.lineTo(w/2,12);c.lineTo(w-45,h/2);c.lineTo(w/2,h-12);c.closePath();c.stroke();c.textAlign='center';c.font='24px Georgia';c.fillText('D R E S S B A T T L E',w/2,h/2+5);c.font='12px Georgia';c.fillText('M O O N L I T   S A L O N',w/2,h/2+32);},768,256);
 const print=mesh(new T.PlaneGeometry(4.2,1.4),new T.MeshBasicMaterial({map:insignia,transparent:true,opacity:.28,depthWrite:false}),0,1.19,-.2);print.rotation.x=-Math.PI/2;print.castShadow=false;
 const cards=new T.Group();scene.add(cards);let key='',sourceSeat='player',birth=0,host=null,raf=0,frames=0,mx=0,my=0,tx=0,ty=0,last=0,skin='';
 function clearCards(){for(const m of [...cards.children]){m.geometry.dispose();for(const material of m.material){material.map?.dispose();material.dispose();}cards.remove(m);}}
 function updateCards(game){const next=JSON.stringify([game?.id,game?.currentCards,game?.lastPlayerId]);if(next===key)return;key=next;clearCards();birth=performance.now();const values=game?.currentCards||[];
  sourceSeat=game?.lastPlayerId==='player'?'player':game?.lastPlayerId===game?.seats?.[0]?'left':'right';
  values.forEach((value,i)=>{
   const map=texture((c,w,h)=>drawPlayingCard(c,w,h,value),256,360);
   const shape=new T.Shape(),w=.95,h=1.35,r=.055,x=-w/2,y=-h/2;
   shape.moveTo(x+r,y);shape.lineTo(x+w-r,y);shape.quadraticCurveTo(x+w,y,x+w,y+r);shape.lineTo(x+w,y+h-r);shape.quadraticCurveTo(x+w,y+h,x+w-r,y+h);shape.lineTo(x+r,y+h);shape.quadraticCurveTo(x,y+h,x,y+h-r);shape.lineTo(x,y+r);shape.quadraticCurveTo(x,y,x+r,y);
   const geometry=new T.ExtrudeGeometry(shape,{depth:.025,bevelEnabled:false,curveSegments:5,UVGenerator:{generateTopUV(g,v,a,b,c){return[a,b,c].map(i=>new T.Vector2(v[i*3]/w+.5,v[i*3+1]/h+.5));},generateSideWallUV(){return[new T.Vector2(0,0),new T.Vector2(1,0),new T.Vector2(1,1),new T.Vector2(0,1)];}}});geometry.rotateX(-Math.PI/2);
   const materials=[new T.MeshStandardMaterial({map,roughness:.76}),mat('#d6c6a4',.7)];
   const m=new T.Mesh(geometry,materials);m.userData.index=i;m.castShadow=true;m.receiveShadow=true;cards.add(m);
  });

 }
 const reduced=()=>prefs().effects==='off'||matchMedia('(prefers-reduced-motion: reduce)').matches;
 function schedule(){if(!raf&&host?.isConnected&&!document.hidden)raf=requestAnimationFrame(draw);}
 function draw(now){raf=0;if(!host?.isConnected||document.hidden)return;const dt=Math.min((now-last)/1000,.1);last=now;mx+=(tx-mx)*Math.min(1,dt*7);my+=(ty-my)*Math.min(1,dt*7);camera.position.set(mx*.12,9.4+my*.06,12);camera.lookAt(goal);
  const mobile=camera.right<4,n=cards.children.length,columns=mobile?Math.min(n,7):n;
  const spacing=mobile?Math.min(.62,(camera.right*2-1.2)/Math.max(1,columns-1)):Math.min(.99,5.8/Math.max(n-1,1));
  const scale=mobile?.72:.84;let moving=false;
  camera.updateMatrixWorld();
  const facing=new T.Quaternion().copy(camera.quaternion).multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(1,0,0),Math.PI/2));
  const screenUp=new T.Vector3(0,1,0).applyQuaternion(camera.quaternion);
  const towardCamera=new T.Vector3(0,0,1).applyQuaternion(camera.quaternion);
  const hostRect=host.getBoundingClientRect(),handTop=host.parentElement.querySelector('.hand-header')?.getBoundingClientRect().top??hostRect.bottom;
  const anchor=new T.Vector3(0,1.205,-1.3).project(camera),pixelsPerUnit=hostRect.height/8.2;
  // Desktop faces remain camera-aligned: perspective belongs to the room, not the readable rank/suit.
  const lift=mobile?0:Math.max(0,(1-anchor.y)*hostRect.height/2+1.35*scale*pixelsPerUnit/2-(handTop-hostRect.top-18))/pixelsPerUnit;
  for(const m of cards.children){
   const i=m.userData.index,row=Math.floor(i/Math.max(1,columns)),inRow=Math.min(columns,n-row*columns);
   const t=reduced()?1:Math.max(0,Math.min(1,(now-birth-i*18)/420)),ease=1-(1-t)**3;moving ||= t<1;
   const x=(i%columns-(inRow-1)/2)*spacing,z=(mobile?-2.1:-1.3)+row*.65;
   const startX=sourceSeat==='player'?x:sourceSeat==='left'?-Math.min(5,camera.right):Math.min(5,camera.right);
   const startZ=sourceSeat==='player'?2.2:-3.2;
   m.scale.setScalar(scale);m.position.set(startX+(x-startX)*ease,1.205+row*.02+i*.004+Math.sin(t*Math.PI)*.45,startZ+(z-startZ)*ease);
   if(mobile)m.rotation.set(0,(i%columns-(inRow-1)/2)*-.014+(1-ease)*(sourceSeat==='left'?.22:-.22),0);
   else {m.quaternion.copy(facing);m.rotateY((i-(n-1)/2)*-.008+(1-ease)*(sourceSeat==='left'?.12:-.12));m.position.addScaledVector(screenUp,lift*ease).addScaledVector(towardCamera,1.25);}
  }
  renderer.render(scene,camera);const bounds=cardBounds();if(bounds)host.style.setProperty('--play-label-y',`${bounds.top-hostRect.top-30}px`);frames++;if(moving||Math.abs(mx-tx)+Math.abs(my-ty)>.002)schedule();

 }
 const observer=new ResizeObserver(()=>{if(!host)return;const {width,height}=host.getBoundingClientRect();if(!width||!height)return;renderer.setSize(width,height,false);camera.left=-4.1*width/height;camera.right=4.1*width/height;camera.updateProjectionMatrix();schedule();});
 function move(e){if(reduced())return;const b=host.getBoundingClientRect();tx=(e.clientX-b.left)/b.width-.5;ty=(e.clientY-b.top)/b.height-.5;schedule();}
 function detach(){cancelAnimationFrame(raf);raf=0;observer.disconnect();if(host){host.removeEventListener('pointermove',move);host.classList.remove('has-three');}host=null;canvas.remove();}
 function cardBounds(){
  if(!host||!cards.children.length)return null;
  const rect=host.getBoundingClientRect(),points=[];
  for(const m of cards.children){if(!m.geometry.boundingBox)m.geometry.computeBoundingBox();const box=m.geometry.boundingBox;
   for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){const p=new T.Vector3(x,y,z).applyMatrix4(m.matrixWorld).project(camera);points.push({x:rect.left+(p.x+1)*rect.width/2,y:rect.top+(1-p.y)*rect.height/2});}
  }
  return {left:Math.min(...points.map(p=>p.x)),right:Math.max(...points.map(p=>p.x)),top:Math.min(...points.map(p=>p.y)),bottom:Math.max(...points.map(p=>p.y))};
 }
 function cardFaceRatios(){
  if(!host)return[];
  const rect=host.getBoundingClientRect();
  return cards.children.map(m=>{const pts=[[-.475,.025,-.675],[.475,.025,-.675],[-.475,.025,.675]].map(v=>{const p=new T.Vector3(...v).applyMatrix4(m.matrixWorld).project(camera);return new T.Vector2(p.x*rect.width/2,p.y*rect.height/2);});return pts[0].distanceTo(pts[1])/pts[0].distanceTo(pts[2]);});
 }
 document.addEventListener('visibilitychange',()=>{if(document.hidden){cancelAnimationFrame(raf);raf=0;}else schedule();});
 canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();failed=true;const old=host;detach();if(old)old.dataset.renderFallback='3D 已暂停，已使用标准牌桌';});
 return {detach,attach(node,game){if(host!==node){detach();host=node;node.prepend(canvas);node.classList.add('has-three');observer.observe(node);node.addEventListener('pointermove',move);}if(skin!==prefs().tableSkin){skin=prefs().tableSkin;felt.color.set(skin==='velvet'?'#4a314b':skin==='moon'?'#21495c':'#185448');}updateCards(game);schedule();},status(){return{ready:true,attached:!!host,frames,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,textures:renderer.info.memory.textures,geometries:renderer.info.memory.geometries,cards:cards.children.length,sourceSeat,cardBounds:cardBounds(),cardFaceRatios:cardFaceRatios(),cardRows:camera.right<4?Math.ceil(cards.children.length/7):1,characterMode:'2d-existing-media',roomMode:'authored-art-plate'};}};
}
