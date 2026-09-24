import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfirmedPalStore } from '../apps/api/pal-roster-store.mjs';

test('confirmed custom pals survive a service restart and can be removed explicitly', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dressbattle-roster-'));
  const path = join(dir, 'confirmed-pals.json');
  const readyPal = { palId: 'pal-user-moyuan', readiness: 'READY', identity: { name: '墨鸢' }, version: 100 };
  try {
    const store = new ConfirmedPalStore(path);
    assert.throws(() => store.confirm({ ...readyPal, readiness: 'ASSET_PENDING' }), /只有资源完整/);
    store.confirm(readyPal);
    assert.deepEqual(new ConfirmedPalStore(path).list(), [readyPal]);

    const restored = new ConfirmedPalStore(path);
    restored.remove(readyPal.palId);
    assert.deepEqual(new ConfirmedPalStore(path).list(), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
