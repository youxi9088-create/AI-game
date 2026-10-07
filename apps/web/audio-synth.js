import { prefs } from './runtime.js';

let ctx = null;
let unlocked = false;
let mutedForSession = false;
let master = null;
const voices = new Set();
let mix = 1;
let group = 'sfx';
const buses = {};

const audible = () => prefs().sfx && !mutedForSession;
const variation = (value, spread = .05) => value * (1 + (Math.random() * 2 - 1) * spread);
function track(node, extras = []) {
  if (voices.size >= 24) { const oldest = voices.values().next().value; try { oldest.stop(); } catch {} voices.delete(oldest); }
  voices.add(node); node.onended = () => { voices.delete(node); node.disconnect(); extras.forEach((n) => n.disconnect()); };
}
export function syncMix() { if (master && ctx) { master.gain.setTargetAtTime(prefs().sfx && !document.hidden ? (prefs().masterVolume ?? .8) : 0, ctx.currentTime, .02); for (const [key, bus] of Object.entries(buses)) bus.gain.setTargetAtTime(prefs()[`${key}Volume`] ?? .8, ctx.currentTime, .02); } }

function audio() {
  if (!ctx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) { mutedForSession = true; return null; }
    try { ctx = new Ctor(); master = ctx.createGain(); const limiter = ctx.createDynamicsCompressor(); limiter.threshold.value = -6; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = .003; limiter.release.value = .15; master.connect(limiter).connect(ctx.destination); for (const key of ['sfx', 'ui']) { buses[key] = ctx.createGain(); buses[key].connect(master); } syncMix(); } catch { mutedForSession = true; return null; }
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

/** One shaped tone. `to` different from `from` glides the pitch. */
function tone({ wave = 'sine', from, to = from, dur = 0.12, gain = 0.06, delay = 0 }) {
  const ac = audio();
  if (!ac) return;
  from = variation(from); to = variation(to); gain = variation(gain, .08) * mix;
  const start = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const amp = ac.createGain();
  osc.type = wave;
  osc.frequency.setValueAtTime(from, start);
  if (to !== from) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), start + dur);
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(gain, start + Math.min(0.02, dur / 3));
  amp.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(amp).connect(buses[group] || master);
  track(osc, [amp]);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

/** Short filtered noise burst — gives the bomb some body. */
function noise({ dur = 0.6, gain = 0.09 }) {
  const ac = audio();
  if (!ac) return;
  gain = variation(gain, .08) * mix;
  const start = ac.currentTime;
  const frames = Math.floor(ac.sampleRate * dur);
  const buffer = ac.createBuffer(1, frames, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / frames) ** 2;
  const src = ac.createBufferSource();
  src.buffer = buffer;
  const filter = ac.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(900, start);
  filter.frequency.exponentialRampToValueAtTime(180, start + dur);
  const amp = ac.createGain();
  amp.gain.setValueAtTime(gain, start);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  src.connect(filter).connect(amp).connect(buses[group] || master);
  track(src, [filter, amp]);
  src.start(start);
}

const RECIPES = {
  select: () => tone({ wave: 'triangle', from: 880, dur: 0.06, gain: 0.035 }),
  play: () => tone({ wave: 'triangle', from: 440, to: 660, dur: 0.12, gain: 0.055 }),
  pair: () => [0, .025].forEach((delay) => tone({ from: 480, dur: .1, delay })),
  trio: () => [0, .025, .05].forEach((delay) => tone({ from: 520, dur: .1, delay })),
  straight: () => [440, 554, 659, 880].forEach((from, i) => tone({ from, dur: .12, delay: i * .035 })),
  rocket: () => { noise({ dur: .45, gain: .08 }); [110, 660, 990].forEach((from) => tone({ from, dur: .35, gain: .04 })); },
  deal: () => noise({ dur: .07, gain: .025 }),
  cloth: () => noise({ dur: .18, gain: .018 }),
  shutter: () => { noise({ dur: .06, gain: .025 }); tone({ from: 990, dur: .18, gain: .04 }); },
  pass: () => tone({ wave: 'sine', from: 300, to: 210, dur: 0.14, gain: 0.05 }),
  bomb: () => { noise({ dur: 0.6, gain: 0.09 }); tone({ wave: 'sawtooth', from: 120, to: 60, dur: 0.5, gain: 0.07 }); },
  win: () => [523.25, 659.25, 783.99].forEach((freq, index) => tone({ wave: 'triangle', from: freq, dur: 0.22, gain: 0.06, delay: index * 0.11 })),
  lose: () => [392, 329.63, 261.63].forEach((freq, index) => tone({ wave: 'sine', from: freq, dur: 0.26, gain: 0.055, delay: index * 0.13 })),
  unlock: () => [659.25, 987.77].forEach((freq, index) => tone({ wave: 'triangle', from: freq, dur: 0.3, gain: 0.06, delay: index * 0.12 }))
};

/** Fire a named sound. Silent no-op when muted or unsupported. */
export function synthEvent(name, { volume = 1, bus = 'sfx' } = {}) {
  if (!unlocked || !audible() || document.hidden) return;
  mix = Math.max(.1, Math.min(1, volume)); group = bus;
  try { RECIPES[name]?.(); } catch { mutedForSession = true; }
}

/** Called from the settings toggle so the AudioContext is created inside a user gesture. */
export function primeSynth() {
  unlocked = true;
  if (!audible()) return;
  audio();
}

document.addEventListener('visibilitychange', () => { syncMix(); if (document.hidden) ctx?.suspend().catch(() => {}); });
