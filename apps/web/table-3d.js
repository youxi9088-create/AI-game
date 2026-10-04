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
 const renderer=new T.WebGLRenderer({antialias:true,powerPreference:'low-power'});
 renderer.setPixelRatio(Math.min(devicePixelRatio,prefs().effects==='soft'?1:1.5));renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.3;
 const canvas=renderer.domElement;canvas.className='table-three';canvas.setAttribute('aria-hidden','true');
 const scene=new T.Scene();scene.background=new T.Color('#080f1d');scene.fog=new T.Fog('#080f1d',13,28);
 const camera=new T.PerspectiveCamera(42,1,.1,60),goal=new T.Vector3(0,.8,-.25);
 scene.add(new T.HemisphereLight('#a9cfff','#3b2432',2.2));
 const mat=(color,roughness=.65,metalness=0)=>new T.MeshStandardMaterial({color,roughness,metalness});
 const gold=mat('#be9351',.25,.75),dark=mat('#131b29',.4,.3),felt=mat('#16474a',.95),wood=mat('#1a1822',.45,.1);
 function mesh(geometry,material,x=0,y=0,z=0){const m=new T.Mesh(geometry,material);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;scene.add(m);return m;}
 const box=(w,h,d,m,x,y,z)=>mesh(new T.BoxGeometry(w,h,d),m,x,y,z);
 function oval(rx,rz,h,m,y){const item=mesh(new T.CylinderGeometry(1,1,h,96),m,0,y,0);item.scale.set(rx,1,rz);return item;}
 box(28,.12,25,mat('#171c2b',.32,.25),0,-.06,0);
 oval(4.3,2.45,.38,wood,.7);oval(4.34,2.48,.055,gold,.92);oval(4.24,2.38,.13,dark,1);oval(3.94,2.1,.045,gold,1.065);oval(3.90,2.065,.042,felt,1.093);
 for(const x of [-2.8,2.8])for(const z of [-1.15,1.15])box(.17,.75,.17,gold,x,.36,z);
 box(24,8,.25,mat('#101928'),0,3.8,-5.7);
 const windows=new T.MeshBasicMaterial({color:'#142c46'}),skyline=mat('#101f33');
 for(const x of [-7,-3.5,0,3.5,7]){box(3.1,5,.1,windows,x,3,-5.5);for(const dx of [-1.57,1.57])box(.07,5.2,.12,gold,x+dx,3,-5.35);box(3.2,.045,.14,gold,x,3,-5.25);}
 for(let i=0;i<32;i++){const h=.5+((i*19)%17)/9;box(.37,h,.15,skyline,-8+i*.52,h/2+.4,-5.15);}
 mesh(new T.SphereGeometry(.58,28,20),new T.MeshBasicMaterial({color:'#a7c9db'}),5,4.25,-5).castShadow=false;
 for(const x of [-6,6]){box(.3,6,.55,dark,x,2.8,-3);box(.03,4,.58,gold,x-.18,2.5,-3);}
 const upholstery=mat('#233449',.7);
 for(const [x,z] of [[-2.6,-2.45],[2.6,-2.45]]){box(1.25,.18,1.15,upholstery,x,.62,z);box(1.3,1.6,.2,upholstery,x,1.4,z-.5);box(1.36,.045,.22,gold,x,2.19,z-.5);for(const dx of [-.46,.46])box(.065,.6,.065,gold,x+dx,.3,z);}
 const light=new T.SpotLight('#ffe1a6',90,24,Math.PI/3,.7,1.5);light.position.set(-3,8,4);light.target.position.set(0,1,0);light.castShadow=true;light.shadow.mapSize.set(1024,1024);light.shadow.bias=-.0005;scene.add(light,light.target);
 for(const [color,intensity,x,z] of [['#54c4f0',24,4,-3],['#e9a0b2',15,-5,0]]){const l=new T.PointLight(color,intensity,13,1.5);l.position.set(x,3,z);scene.add(l);}
 function texture(draw,w=512,h=256){const c=document.createElement('canvas');c.width=w;c.height=h;draw(c.getContext('2d'),w,h);const tx=new T.CanvasTexture(c);tx.colorSpace=T.SRGBColorSpace;tx.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());return tx;}
 const insignia=texture((c,w)=>{c.textAlign='center';c.fillStyle='#cda967';c.font='600 34px Georgia';c.fillText('D R E S S B A T T L E',w/2,130);c.font='15px sans-serif';c.fillStyle='#7dafa9';c.fillText('M O O N L I T   S A L O N',w/2,168);});
 const print=mesh(new T.PlaneGeometry(2.6,1.3),new T.MeshBasicMaterial({map:insignia,transparent:true,depthWrite:false}),0,1.12,-.72);print.rotation.x=-Math.PI/2;print.castShadow=false;
 const ivory=mat('#f3e6ce',.7),chip=mat('#395b7b',.4);
 for(let i=0;i<8;i++)box(.46,.035,.65,i===7?dark:ivory,-2.8,1.14+i*.035,-.1);
 for(const x of [-2.6,2.6])for(let i=0;i<4;i++)mesh(new T.CylinderGeometry(.14,.14,.045,24),i%2?gold:chip,x,1.15+i*.05,.65);
 const cards=new T.Group();scene.add(cards);let key='',birth=0,host=null,raf=0,frames=0,mx=0,my=0,tx=0,ty=0,last=0,skin='';
 function clearCards(){for(const m of [...cards.children]){m.geometry.dispose();for(const material of m.material){material.map?.dispose();material.dispose();}cards.remove(m);}}
 function updateCards(game){const next=JSON.stringify([game?.id,game?.currentCards,game?.lastPlayerId]);if(next===key)return;key=next;clearCards();birth=performance.now();const values=game?.currentCards||[];
  values.forEach((value,i)=>{const map=texture((c,w,h)=>{c.fillStyle='#fff4dc';c.fillRect(0,0,w,h);c.strokeStyle='#c5a775';c.lineWidth=7;c.strokeRect(8,8,w-16,h-16);const suit=value.match(/[♠♥♦♣]/)?.[0]||'★',rank=value.replace(/[♠♥♦♣]/g,'');c.fillStyle=/[♥♦]/.test(value)?'#ae334b':'#17283b';c.font='bold 64px Georgia';c.fillText(rank,22,70);c.font='58px serif';c.fillText(suit,23,131);c.textAlign='center';c.font='112px serif';c.fillText(suit,w/2,245);c.save();c.translate(w,h);c.rotate(Math.PI);c.textAlign='left';c.font='bold 44px Georgia';c.fillText(rank,18,55);c.restore();},256,360);
   const materials=Array.from({length:6},(_,side)=>side===2?new T.MeshStandardMaterial({map,roughness:.7}):mat(side===3?'#203653':'#e0c994'));
   const m=new T.Mesh(new T.BoxGeometry(.56,.026,.79),materials);m.position.set((i-(values.length-1)/2)*Math.min(.59,4.7/Math.max(values.length,1)),1.17,.65);m.rotation.y=(i-(values.length-1)/2)*-.012;m.castShadow=true;m.receiveShadow=true;cards.add(m);
  });
 }
 const reduced=()=>prefs().effects==='off'||matchMedia('(prefers-reduced-motion: reduce)').matches;
 function schedule(){if(!raf&&host?.isConnected&&!document.hidden)raf=requestAnimationFrame(draw);}
 function draw(now){raf=0;if(!host?.isConnected||document.hidden)return;const dt=Math.min((now-last)/1000,.1);last=now;mx+=(tx-mx)*Math.min(1,dt*7);my+=(ty-my)*Math.min(1,dt*7);camera.position.set(mx*.34,5.8+my*.12,7.9);camera.lookAt(goal);
  const t=reduced()?1:Math.min(1,(now-birth)/350);for(const m of cards.children){m.position.z=.65+(1-t)**3;m.position.y=1.17+(1-t)*.4;}renderer.render(scene,camera);frames++;if(t<1||Math.abs(mx-tx)+Math.abs(my-ty)>.002)schedule();
 }
 const observer=new ResizeObserver(()=>{if(!host)return;const {width,height}=host.getBoundingClientRect();if(!width||!height)return;renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();schedule();});
 function move(e){if(reduced())return;const b=host.getBoundingClientRect();tx=(e.clientX-b.left)/b.width-.5;ty=(e.clientY-b.top)/b.height-.5;schedule();}
 function detach(){cancelAnimationFrame(raf);raf=0;observer.disconnect();if(host){host.removeEventListener('pointermove',move);host.classList.remove('has-three');}host=null;canvas.remove();}
 document.addEventListener('visibilitychange',()=>{if(document.hidden){cancelAnimationFrame(raf);raf=0;}else schedule();});
 canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();failed=true;const old=host;detach();if(old)old.dataset.renderFallback='3D 已暂停，已使用标准牌桌';});
 return {detach,attach(node,game){if(host!==node){detach();host=node;node.prepend(canvas);node.classList.add('has-three');observer.observe(node);node.addEventListener('pointermove',move);}if(skin!==prefs().tableSkin){skin=prefs().tableSkin;felt.color.set(skin==='velvet'?'#422948':skin==='moon'?'#213e59':'#16474a');}updateCards(game);schedule();},status(){return{ready:true,attached:!!host,frames,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,textures:renderer.info.memory.textures,geometries:renderer.info.memory.geometries,cards:cards.children.length,characterMode:'2d-existing-media'};}};
}
