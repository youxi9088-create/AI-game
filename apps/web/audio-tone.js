import {AUDIO_EVENTS,renderSample,REVERB_ZONES} from './audio-events.js';
export function createToneBackend(Tone=window.Tone){
 const context=new Tone.Context({sampleRate:44100,latencyHint:'interactive'});Tone.setContext(context);
 const limiter=new Tone.Limiter(-1).toDestination(),master=new Tone.Gain(.8).connect(limiter);
 const buses=Object.fromEntries(['music','sfx','ui','vo','ambience'].map(n=>[n,new Tone.Gain(1)]));
 const reverb=new Tone.Reverb({...REVERB_ZONES.Lobby}).connect(master);
 for(const [n,b] of Object.entries(buses))b.connect(n==='ui'?master:reverb);
 const buffers=new Map();let sampleBytes=0;
 for(const [path,event] of Object.entries(AUDIO_EVENTS))buffers.set(path,Array.from({length:event.variants},(_,i)=>{const a=renderSample(event.recipe,i);sampleBytes+=a.byteLength;return new Tone.ToneAudioBuffer().fromArray(a);}));
 const keys=new Tone.PolySynth({voice:Tone.FMSynth,maxPolyphony:6,volume:-24,options:{harmonicity:2,modulationIndex:1.1,envelope:{attack:.01,decay:.4,sustain:.08,release:.8},modulationEnvelope:{attack:.005,decay:.15,sustain:0,release:.3}}}).connect(buses.music);
 const bass=new Tone.Synth({volume:-29,oscillator:{type:'sine'},envelope:{attack:.02,decay:.2,sustain:.1,release:.3}}).connect(buses.music);
 const pad=new Tone.PolySynth({voice:Tone.Synth,maxPolyphony:4,volume:-34,options:{oscillator:{type:'triangle'},envelope:{attack:.4,decay:.3,sustain:.3,release:.7}}}).connect(buses.music);
 const brush=new Tone.NoiseSynth({volume:-39,noise:{type:'pink'},envelope:{attack:.001,decay:.055,sustain:0}}).connect(buses.music);
 const ambience=new Tone.Noise({type:'brown',volume:-55}).connect(buses.ambience);
 const transport=Tone.getTransport();transport.bpm.value=84;
 let params={TableTension:0,PerformanceReveal:0,VideoPlaying:0,Zone:'Lobby'},appliedReveal=0,appliedTension=0,beat=0,unlocked=false,disposed=false,resuming=null,dropped=0,maxSfxVoices=0,currentMix={};
 const active=[],lastVariant=new Map(),chords=[['D4','F4','A4','C5'],['G3','B3','D4','F4'],['C4','E4','G4','B4'],['A3','C4','E4','G4']],roots=['D2','G2','C2','A2'];
 const loop=new Tone.Loop(time=>{const step=beat%16,bar=Math.floor(beat/16)%4;
  if(step===0){appliedReveal=params.PerformanceReveal;appliedTension=params.TableTension;keys.triggerAttackRelease(chords[bar].slice(0,3),'2n',time,appliedReveal?.75:.5);if(appliedTension>=.6||appliedReveal)pad.triggerAttackRelease(chords[bar].slice(0,3),'2n',time,.35);}
  if((appliedTension>=.3||appliedReveal)&&step%4===0)bass.triggerAttackRelease(roots[bar],'8n',time,.45);
  if((appliedTension>=.3||appliedReveal)&&step%4===2)brush.triggerAttackRelease('32n',time,.3);
  if((appliedTension>=.6||appliedReveal)&&step%4===1)keys.triggerAttackRelease(chords[bar][step%4],'16n',time,.2);
  if(appliedTension>=.9&&step%2===0)brush.triggerAttackRelease('32n',time,.4);beat++;
 },'16n').start(0);
 function remove(v){const i=active.indexOf(v);if(i<0)return;active.splice(i,1);v.player.onstop=()=>{};v.player.dispose();v.pan.dispose();}
 function stop(v){v.player.onstop=()=>{};try{v.player.stop();}catch{}remove(v);}
 function play(path,options={}){
  if(!unlocked||disposed||context.state!=='running')return;const spec=AUDIO_EVENTS[path];if(!spec)return;
  const priority=options.ai?2:spec.priority,same=active.filter(v=>v.path===path);
  if(same.length>=spec.limit&&spec.steal==='never'){dropped++;return;}
  // 11 transient samples + at most 13 music/ambience voices. This is a ceiling, not a DSP profiler.
  if(active.length>=11||same.length>=spec.limit){const candidates=(same.length>=spec.limit?same:active).filter(v=>v.priority>=priority&&v.steal!=='never');if(!candidates.length){dropped++;return;}candidates.sort((a,b)=>spec.steal==='quietest'?a.volume-b.volume:spec.steal==='farthest'?b.distance-a.distance:a.started-b.started);stop(candidates[0]);}
  const samples=buffers.get(path);let index=Math.floor(Math.random()*samples.length);if(index===lastVariant.get(path))index=(index+1)%samples.length;lastVariant.set(path,index);
  const volume=Math.max(.001,Math.min(1,options.volume??1))*(1+(Math.random()*2-1)*spec.volume);
  const pan=new Tone.Panner(options.pan??(options.ai?.2:0)).connect(buses[spec.bus]);
  const player=new Tone.Player({url:samples[index],playbackRate:1+(Math.random()*2-1)*spec.pitch,volume:Tone.gainToDb(volume)}).connect(pan);
  const voice={player,pan,path,priority,steal:spec.steal,volume,distance:options.ai?1:0,started:Tone.now()};active.push(voice);player.onstop=()=>remove(voice);player.start();maxSfxVoices=Math.max(maxSfxVoices,active.length);
 }
 function parameters(values){const old=params.Zone;params={...params,...values};if(old!==params.Zone&&REVERB_ZONES[params.Zone]){const z=REVERB_ZONES[params.Zone];reverb.wet.rampTo(z.wet,.3);reverb.decay=z.decay;reverb.preDelay=z.preDelay;reverb.generate().catch(()=>{reverb.wet.value=0;});}buses.music.gain.rampTo((currentMix.music??.45)*(params.VideoPlaying?.12:1),.25);}
 function mix(values){currentMix=values;master.gain.rampTo(values.master??.8,.03);for(const name of Object.keys(buses))buses[name].gain.rampTo((values[name]??.8)*(name==='music'&&params.VideoPlaying?.12:1),.08);}
 return {name:'tone-sampled',play,parameters,mix,
  resume(){if(disposed)return;resuming ||= (async()=>{await Tone.start();await reverb.ready;if(disposed)return;if(!unlocked){unlocked=true;ambience.start();}if(transport.state!=='started')transport.start();})().finally(()=>{resuming=null;});return resuming;},
  pause(){transport.pause();return context.rawContext.suspend();},
  diagnostics(){return{backend:'tone-sampled',sampleBytes,sampleCount:[...buffers.values()].reduce((n,b)=>n+b.length,0),activeSfxVoices:active.length,maxSfxVoices,voiceCeiling:24,dropped,appliedReveal,appliedTension,zone:params.Zone,transport:transport.state};},
  dispose(){if(disposed)return;disposed=true;loop.dispose();transport.stop();active.slice().forEach(stop);for(const v of [ambience,keys,bass,pad,brush,...Object.values(buses),reverb,master,limiter])v.dispose();buffers.forEach(b=>b.forEach(v=>v.dispose()));context.dispose();}
 };
}
