// Original procedural multisamples; no third-party recordings or commercial bank files.
const event=(bus,priority,limit,steal,variants,pitch,volume,recipe)=>({bus,priority,limit,steal,variants,pitch,volume,recipe});
export const AUDIO_EVENTS={
 'event:/UI/Button_Click':event('ui',0,8,'never',3,.03,.05,'click'),
 'event:/UI/Menu_Open':event('ui',0,8,'never',3,.03,.05,'menu'),
 'event:/UI/Token_Change':event('ui',0,8,'never',3,.03,.05,'token'),
 'event:/SFX/Deal/Deal_Card':event('sfx',2,16,'farthest',4,.05,.08,'deal'),
 'event:/SFX/Deal/Shuffle':event('sfx',2,16,'farthest',4,.05,.08,'shuffle'),
 'event:/SFX/Card/Pass':event('sfx',2,16,'farthest',4,.05,.08,'pass'),
 'event:/SFX/Card/Play_Single':event('sfx',1,12,'quietest',4,.05,.08,'single'),
 'event:/SFX/Card/Play_Pair':event('sfx',1,12,'quietest',4,.05,.08,'pair'),
 'event:/SFX/Card/Play_Trio':event('sfx',1,12,'quietest',4,.05,.08,'trio'),
 'event:/SFX/Card/Play_Straight':event('sfx',1,12,'quietest',4,.05,.08,'straight'),
 'event:/SFX/Card/Play_Bomb':event('sfx',1,12,'quietest',4,.05,.08,'bomb'),
 'event:/SFX/Card/Play_Rocket':event('sfx',0,4,'never',4,.05,.08,'rocket'),
 'event:/SFX/AI/Think':event('sfx',2,4,'oldest',4,.05,.08,'think'),
 'event:/SFX/Result/Win':event('sfx',1,4,'quietest',4,.05,.08,'win'),
 'event:/SFX/Result/Lose':event('sfx',1,4,'quietest',4,.05,.08,'lose'),
 'event:/SFX/Album/Card_Collect':event('sfx',1,8,'quietest',4,.05,.08,'collect'),
 'event:/SFX/Dress/Cloth_Rustle':event('sfx',3,8,'oldest',5,.08,.1,'cloth'),
 'event:/SFX/Dress/Reveal_Sting':event('sfx',1,4,'quietest',4,.05,.08,'shutter')
};
export const REVERB_ZONES={Table:{preDelay:.015,decay:.8,wet:.12},Stage:{preDelay:.035,decay:2.2,wet:.4},Album:{preDelay:.02,decay:1,wet:.18},Lobby:{preDelay:.025,decay:1.2,wet:.2}};
export function renderSample(recipe,variant,rate=44100){
 const duration=['win','lose','collect'].includes(recipe)?.72:['bomb','rocket'].includes(recipe)?.48:['cloth','shuffle'].includes(recipe)?.28:.2;
 const data=new Float32Array(Math.ceil(rate*duration));let seed=(variant+1)*71237+[...recipe].reduce((n,c)=>n+c.charCodeAt(0),0);
 const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296*2-1;};
 const count=recipe==='pair'?2:recipe==='trio'?3:recipe==='straight'?5:1,notes=recipe==='lose'?[392,329.63,261.63]:[523.25,659.25,783.99];
 for(let i=0;i<data.length;i++){const t=i/rate;let v=0;
  if(['bomb','rocket'].includes(recipe))v=.28*Math.sin(2*Math.PI*(105*t-48*t*t))*Math.exp(-9*t)+.14*random()*Math.exp(-22*t)+(recipe==='rocket'?.06*Math.sin(2*Math.PI*990*t)*Math.exp(-6*t):0);
  else if(['win','lose','collect'].includes(recipe))notes.forEach((f,n)=>{const u=t-n*.09;if(u>=0)v+=.075*(Math.sin(2*Math.PI*f*u)+.2*Math.sin(2*Math.PI*2*f*u))*Math.exp(-8*u)*Math.min(1,u*250);});
  else if(['cloth','shuffle','deal','shutter'].includes(recipe))v=random()*.12*Math.sin(Math.PI*t/duration)**2*Math.exp(-t*(recipe==='cloth'?4:18));
  else for(let n=0;n<count;n++){const u=t-n*(recipe==='straight'?.026:.02);if(u>=0){const f=(recipe==='click'?1600:recipe==='think'?330:recipe==='pass'?260:580)*(1+variant*.025)*2**(n/12);v+=(.13*Math.sin(2*Math.PI*f*u)*Math.exp(-60*u)+.055*random()*Math.exp(-140*u))*Math.min(1,u*1600);}}
  data[i]=Math.max(-.85,Math.min(.85,v));
 }return data;
}
