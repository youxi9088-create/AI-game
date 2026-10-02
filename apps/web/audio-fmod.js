// The host must supply a licensed, initialized HTML5 Studio System and loaded banks.
// Official JS API uses output objects: getEvent -> EventDescription.createInstance.
export function createFmodBackend(studio, { resume = () => {}, stopMode = 1, ok = 0 } = {}) {
  const active = new Set();
  const check = (result) => { if (result !== ok) throw new Error(`FMOD result ${result}`); };
  const instance = (path) => { const d = {}, i = {}; check(studio.getEvent(path, d)); check(d.val.createInstance(i)); return i.val; };
  const bus = (path) => { const out = {}; check(studio.getBus(path, out)); return out.val; };
  const master = bus('bus:/');
  const sfx = bus('bus:/SFX'), ui = bus('bus:/UI');
  const timer = setInterval(() => { const result = studio.update(); if (result !== ok) { clearInterval(timer); master.setPaused(true); } }, 20);
  return {
    play(path, { volume = 1 } = {}) { const i = instance(path); try { check(i.setVolume(volume)); check(i.start()); } finally { check(i.release()); } },
    parameters(values) { for (const [name, value] of Object.entries(values)) check(studio.setParameterByName(name, value, false)); },
    mix(values) { check(master.setVolume(values.master)); check(sfx.setVolume(values.sfx)); check(ui.setVolume(values.ui)); },
    resume() { resume(); check(master.setPaused(false)); },
    pause() { check(master.setPaused(true)); },
    startMusic(path = 'event:/Music/Table/Lounge') { const i = instance(path); active.add(i); check(i.start()); },
    dispose() { clearInterval(timer); master.stopAllEvents(stopMode); for (const i of active) { i.stop(stopMode); i.release(); } active.clear(); }
  };
}
