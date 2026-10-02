import test from 'node:test';
import assert from 'node:assert/strict';
import { createFmodBackend } from '../apps/web/audio-fmod.js';
test('FMOD adapter resolves official output handles and releases failed one-shot instances', () => {
  let released = 0; const events = [];
  const bus = { setVolume: () => 0, setPaused: () => 0, stopAllEvents: () => 0 };
  const event = { setVolume: () => 0, start: () => 5, release: () => { released++; return 0; } };
  const studio = { update: () => 0, getBus: (_, out) => { out.val = bus; return 0; }, getEvent: (path, out) => { events.push(path); out.val = { createInstance: (i) => { i.val = event; return 0; } }; return 0; }, setParameterByName: () => 0 };
  const audio = createFmodBackend(studio);
  try { assert.throws(() => audio.play('event:/UI/Button_Click'), /FMOD result 5/); assert.equal(released, 1); assert.deepEqual(events, ['event:/UI/Button_Click']); } finally { audio.dispose(); }
});
