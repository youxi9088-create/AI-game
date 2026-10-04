import { createToneBackend } from './audio-tone.js';
// Semantic event boundary; the existing synthesis remains an explicit preview fallback.
import { prefs } from './runtime.js';
import { synthEvent, primeSynth, syncMix } from './audio-synth.js';
export const EVENTS = {
  menu:'event:/UI/Menu_Open', token:'event:/UI/Token_Change', shuffle:'event:/SFX/Deal/Shuffle', think:'event:/SFX/AI/Think',
  select: 'event:/UI/Button_Click', pass: 'event:/SFX/Card/Pass',
  play: 'event:/SFX/Card/Play_Single', pair: 'event:/SFX/Card/Play_Pair', trio: 'event:/SFX/Card/Play_Trio',
  straight: 'event:/SFX/Card/Play_Straight', bomb: 'event:/SFX/Card/Play_Bomb', rocket: 'event:/SFX/Card/Play_Rocket',
  win: 'event:/SFX/Result/Win', lose: 'event:/SFX/Result/Lose', unlock: 'event:/SFX/Album/Card_Collect',
  cloth: 'event:/SFX/Dress/Cloth_Rustle', shutter: 'event:/SFX/Dress/Reveal_Sting', deal: 'event:/SFX/Deal/Deal_Card'
};
let backend = null;
let target = 0, tension = 0, reveal = 0, bombUntil = 0;
let audioError = null;
let sceneParameters = {Zone:'Lobby', VideoPlaying:0};
export function installAudioBackend(value) {
  if (!value || !['play', 'parameters', 'mix', 'resume', 'pause', 'dispose'].every((key) => typeof value[key] === 'function')) throw new Error('音频后端接口不完整');
  backend?.dispose(); backend = value; audioError = null; syncAudio(); backend.parameters(sceneParameters);
}
export function audioStatus() { return { mode: backend?.name || (backend ? 'fmod' : 'synth-preview'), error: audioError, tension, reveal, diagnostics: backend?.diagnostics?.() }; }
function run(fn) { try { const result=fn();result?.catch?.(error=>{audioError=String(error.message);}); } catch (error) { audioError = String(error.message); try { backend?.dispose(); } catch {} backend = null; } }
export function syncAudio() {
  syncMix();
  run(() => backend?.mix({ master: prefs().sfx && !document.hidden ? prefs().masterVolume : 0, sfx: prefs().sfxVolume, ui: prefs().uiVolume, music:prefs().musicVolume, vo:prefs().voVolume, ambience:prefs().ambienceVolume }));
}
export function primeAudio() {
  if (!prefs().sfx) { syncAudio(); return; }
  if(!backend && window.Tone) run(()=>installAudioBackend(createToneBackend()));
  if (backend) run(() => backend.resume()); else primeSynth();
  syncAudio();
}
export function sfx(name, options = {}) {
  if (!EVENTS[name] || !prefs().sfx || document.hidden) return;
  if (backend) run(() => backend.play(EVENTS[name], options));
  else synthEvent(name, { ...options, bus: name === 'select' ? 'ui' : 'sfx' });
}
export function playCardAudio(combo, { ai = false } = {}) {
  const type = combo?.type || '';
  const name = type === 'ROCKET' ? 'rocket' : type === 'BOMB' ? 'bomb' : type === 'PAIR' ? 'pair' : /TRIPLE|AIRPLANE|FOUR_TWO/.test(type) ? 'trio' : /STRAIGHT/.test(type) ? 'straight' : 'play';
  if (name === 'bomb' || name === 'rocket') bombUntil = Date.now() + 1800;
  sfx(name, { volume: ai ? .65 : 1, ai });
}
export function updateAudioScene(game, route, videoPlaying = false) {
  const counts = game?.players?.map((p) => p.count).filter((n) => n > 0) || [];
  const remaining = counts.length ? Math.min(...counts) : 20;
  target = route === 'table' && game?.phase === 'PLAYING' ? (remaining <= 2 ? .8 : remaining <= 5 ? .6 : .3) : 0;
  const stage = game?.settlementStage;
  reveal = route === 'table' && game?.settlement?.winnerId === 'player' && ['PERFORMANCE', 'PHOTO_REVEAL'].includes(stage) ? 1 : 0;
  sceneParameters={TableTension:tension, PerformanceReveal:reveal, VideoPlaying:videoPlaying?1:0, Zone:document.querySelector('.photo-studio')?'Album':reveal?'Stage':route==='gallery'?'Album':route==='table'?'Table':'Lobby'};
  run(()=>backend?.parameters(sceneParameters));
}
const smoothingTimer = setInterval(() => {
  if (document.hidden || !prefs().sfx) return;
  tension += ((Date.now() < bombUntil ? 1 : target) - tension) * .3;
  run(() => backend?.parameters({ TableTension: tension, PerformanceReveal: reveal }));
}, 500);
smoothingTimer.unref?.();
document.addEventListener('visibilitychange', () => { syncAudio(); if (document.hidden) run(() => backend?.pause()); else if(prefs().sfx)run(()=>backend?.resume()); });
