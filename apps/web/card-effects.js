import {prefs} from './runtime.js';
const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches||prefs().effects==='off';
let lastKey='',frame=0,canvas=null;
function burst(x,y,strong){
 if(reduced())return;if(!canvas){canvas=document.createElement('canvas');canvas.className='card-particles';canvas.setAttribute('aria-hidden','true');document.body.append(canvas);}
 const dpr=Math.min(devicePixelRatio||1,2);canvas.width=innerWidth*dpr;canvas.height=innerHeight*dpr;canvas.style.width=innerWidth+'px';canvas.style.height=innerHeight+'px';const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);cancelAnimationFrame(frame);const start=performance.now(),count=prefs().effects==='soft'?8:strong?44:16;
 const particles=Array.from({length:count},(_,i)=>{const a=i/count*Math.PI*2;return{vx:Math.cos(a)*(strong?125:65)*(1+Math.random()),vy:Math.sin(a)*90-35,size:1+Math.random()*2,color:i%3?'#edcc87':'#a8cfff'};});
 function draw(now){const t=(now-start)/1000;ctx.clearRect(0,0,innerWidth,innerHeight);if(t>.8||document.hidden){canvas.remove();canvas=null;return;}ctx.globalAlpha=(1-t/.8)*.8;for(const p of particles){ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(x+p.vx*t,y+p.vy*t+55*t*t,p.size*(1-t/1.5),0,Math.PI*2);ctx.fill();}frame=requestAnimationFrame(draw);}frame=requestAnimationFrame(draw);
}
export function syncCardEffects(game){
 const event=game?.events?.slice().reverse().find(e=>e.type==='PLAY_ACCEPTED'||(e.type==='PAL_ACTION'&&e.decision==='PLAY'));if(!event)return;
 const key=`${game.id}:${event.seq}`;if(key===lastKey)return;lastKey=key;if(reduced())return;
 const stack=document.querySelector('.played-stack');if(!stack)return;const type=event.combo?.type||'',strong=/BOMB|ROCKET/.test(type);
 stack.querySelectorAll('.table-card').forEach((card,i)=>card.animate([{opacity:.2,transform:'translateY(-24px) rotate(-7deg)'},{opacity:1,transform:'translateY(0) rotate(0)'}],{duration:210,delay:i*18,easing:'cubic-bezier(.2,.8,.2,1)'}));
 const b=stack.getBoundingClientRect();burst(b.left+b.width/2,b.top+20,strong);
 if(strong||/STRAIGHT|AIRPLANE/.test(type)){const label=document.createElement('div');label.className='card-effect-label';label.textContent=event.combo.label;label.style.left=Math.max(80,Math.min(innerWidth-160,b.left+b.width/2))+'px';label.style.top=Math.max(80,b.top-45)+'px';document.body.append(label);setTimeout(()=>label.remove(),1000);}
}
let tiltFrame=0;
document.addEventListener('pointermove',e=>{if(reduced()||prefs().effects==='soft'||e.pointerType==='touch')return;const card=e.target.closest('.pcard:not(.locked) .pcard-art,.my-photo');if(!card)return;cancelAnimationFrame(tiltFrame);tiltFrame=requestAnimationFrame(()=>{if(!card.isConnected)return;const b=card.getBoundingClientRect(),x=(e.clientX-b.left)/b.width-.5,y=(e.clientY-b.top)/b.height-.5;card.style.setProperty('--tilt-x',`${-y*5}deg`);card.style.setProperty('--tilt-y',`${x*7}deg`);card.style.setProperty('--shine-x',`${(x+.5)*100}%`);});});
document.addEventListener('pointerout',e=>{const card=e.target.closest('.pcard-art,.my-photo');if(card&&!card.contains(e.relatedTarget)){card.style.setProperty('--tilt-x','0deg');card.style.setProperty('--tilt-y','0deg');}});
export function installHandBrush(apply,redraw){
 let drag=null,suppress=false;
 document.addEventListener('pointerdown',e=>{suppress=false;const card=e.target.closest('.hand .card:not(:disabled)');if(!card||e.button!==0)return;const hand=card.closest('.hand'),cards=[...hand.querySelectorAll('.card')];drag={hand,cards,start:cards.indexOf(card),end:cards.indexOf(card),x:e.clientX,y:e.clientY,select:card.getAttribute('aria-pressed')!=='true',moved:false};});
 document.addEventListener('keydown',()=>{suppress=false;});
 document.addEventListener('pointermove',e=>{if(!drag||Math.abs(e.clientX-drag.x)+Math.abs(e.clientY-drag.y)<8)return;const card=document.elementFromPoint(e.clientX,e.clientY)?.closest('.hand .card:not(:disabled)'),index=drag.cards.indexOf(card);if(index<0)return;if(!drag.moved)drag.hand.setPointerCapture?.(e.pointerId);drag.end=index;drag.moved=true;drag.cards.forEach((c,i)=>c.classList.toggle('brush-preview',i>=Math.min(index,drag.start)&&i<=Math.max(index,drag.start)));});
 document.addEventListener('pointerup',()=>{if(!drag)return;const d=drag;drag=null;if(d.moved){suppress=true;apply(d.cards.slice(Math.min(d.start,d.end),Math.max(d.start,d.end)+1).map(c=>c.dataset.card),d.select);setTimeout(()=>{suppress=false;},250);}else d.cards.forEach(c=>c.classList.remove('brush-preview'));});
 document.addEventListener('pointercancel',()=>{if(drag){drag=null;redraw();}});
 document.addEventListener('click',e=>{if(suppress){suppress=false;e.preventDefault();e.stopImmediatePropagation();}},true);
}
