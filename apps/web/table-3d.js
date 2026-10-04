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
 const cards=new T.Group();scene.add(cards);let key='',birth=0,host=null,raf=0,frames=0,mx=0,my=0,tx=0,ty=0,last=0,skin='';
 function clearCards(){for(const m of [...cards.children]){m.geometry.dispose();for(const material of m.material){material.map?.dispose();material.dispose();}cards.remove(m);}}
 function updateCards(game){const next=JSON.stringify([game?.id,game?.currentCards,game?.lastPlayerId]);if(next===key)return;key=next;clearCards();birth=performance.now();const values=game?.currentCards||[];
  values.forEach((value,i)=>{const map=texture((c,w,h)=>{c.fillStyle='#fff4dc';c.fillRect(0,0,w,h);c.strokeStyle='#c5a775';c.lineWidth=7;c.strokeRect(8,8,w-16,h-16);const suit=value.match(/[♠♥♦♣]/)?.[0]||'★',rank=value.replace(/[♠♥♦♣]/g,'');c.fillStyle=/[♥♦]/.test(value)?'#ae334b':'#17283b';c.font='bold 64px Georgia';c.fillText(rank,22,70);c.font='58px serif';c.fillText(suit,23,131);c.textAlign='center';c.font='112px serif';c.fillText(suit,w/2,245);c.save();c.translate(w,h);c.rotate(Math.PI);c.textAlign='left';c.font='bold 44px Georgia';c.fillText(rank,18,55);c.restore();},256,360);
   const materials=Array.from({length:6},(_,side)=>side===2?new T.MeshStandardMaterial({map,roughness:.7}):mat(side===3?'#203653':'#e0c994'));
   const m=new T.Mesh(new T.BoxGeometry(.95,.028,1.35),materials);m.position.set((i-(values.length-1)/2)*Math.min(.99,7.8/Math.max(values.length,1)),1.23,-1.3);m.rotation.y=(i-(values.length-1)/2)*-.012;m.castShadow=true;m.receiveShadow=true;cards.add(m);
  });
 }
 const reduced=()=>prefs().effects==='off'||matchMedia('(prefers-reduced-motion: reduce)').matches;
 function schedule(){if(!raf&&host?.isConnected&&!document.hidden)raf=requestAnimationFrame(draw);}
 function draw(now){raf=0;if(!host?.isConnected||document.hidden)return;const dt=Math.min((now-last)/1000,.1);last=now;mx+=(tx-mx)*Math.min(1,dt*7);my+=(ty-my)*Math.min(1,dt*7);camera.position.set(mx*.12,9.4+my*.06,12);camera.lookAt(goal);
  const t=reduced()?1:Math.min(1,(now-birth)/350);for(const m of cards.children){m.position.z=(camera.right<4?-2.1:-1.3)+(1-t)**3;m.position.y=1.23+(1-t)*.4;}renderer.render(scene,camera);frames++;if(t<1||Math.abs(mx-tx)+Math.abs(my-ty)>.002)schedule();
 }
 const observer=new ResizeObserver(()=>{if(!host)return;const {width,height}=host.getBoundingClientRect();if(!width||!height)return;renderer.setSize(width,height,false);cards.scale.x=Math.min(1,(8.2*width/height-1)/(.95+Math.max(0,cards.children.length-1)*Math.min(.99,7.8/Math.max(cards.children.length,1))));camera.left=-4.1*width/height;camera.right=4.1*width/height;camera.updateProjectionMatrix();schedule();});
 function move(e){if(reduced())return;const b=host.getBoundingClientRect();tx=(e.clientX-b.left)/b.width-.5;ty=(e.clientY-b.top)/b.height-.5;schedule();}
 function detach(){cancelAnimationFrame(raf);raf=0;observer.disconnect();if(host){host.removeEventListener('pointermove',move);host.classList.remove('has-three');}host=null;canvas.remove();}
 document.addEventListener('visibilitychange',()=>{if(document.hidden){cancelAnimationFrame(raf);raf=0;}else schedule();});
 canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();failed=true;const old=host;detach();if(old)old.dataset.renderFallback='3D 已暂停，已使用标准牌桌';});
 return {detach,attach(node,game){if(host!==node){detach();host=node;node.prepend(canvas);node.classList.add('has-three');observer.observe(node);node.addEventListener('pointermove',move);}if(skin!==prefs().tableSkin){skin=prefs().tableSkin;felt.color.set(skin==='velvet'?'#4a314b':skin==='moon'?'#21495c':'#185448');}updateCards(game);schedule();},status(){return{ready:true,attached:!!host,frames,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,textures:renderer.info.memory.textures,geometries:renderer.info.memory.geometries,cards:cards.children.length,characterMode:'2d-existing-media',roomMode:'authored-art-plate'};}};
}
