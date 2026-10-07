import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, access, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createSnapshot, verifySnapshot, restoreSnapshot } from '../scripts/state-snapshot.mjs';
const exec = promisify(execFile);
const mapping = { GALLERY_STATE_PATH: 'gallery.json', TOKEN_STATE_PATH: 'player-wallet.json', CONFIRMED_PALS_PATH: 'confirmed-pals.json', PAL_RESOURCE_STATE_PATH: 'pal-resource-tasks.json', PARTNER_SESSIONS_PATH: 'partner-sessions.json', OFFICIAL_ASSETS_PATH: 'official-assets.json' };
async function fixture(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'dress-release-'));
  const env = Object.fromEntries(Object.entries(mapping).map(([key, name]) => [key, join(dir, name)]));
  try {
    for (const path of Object.values(env)) await writeFile(path, JSON.stringify({ version: 2, collection: { creations: [{ name: '原始写真' }] } }));
    await fn(dir, env);
  } finally { await rm(dir, { recursive: true, force: true }); }
}
test('offline snapshot restores every state byte without replacing an existing target', () => fixture(async (dir, env) => {
  const snapshot = join(dir, 'backup'); const restored = join(dir, 'restored');
  await assert.rejects(createSnapshot(snapshot, { env }), /Stop the game/);
  await assert.rejects(createSnapshot(snapshot, { env: {}, stopped: true }), /actual absolute server path/);
  await createSnapshot(snapshot, { env, stopped: true });
  await verifySnapshot(snapshot);
  await restoreSnapshot(snapshot, restored);
  for (const [key, name] of Object.entries(mapping)) assert.deepEqual(await readFile(join(restored, name)), await readFile(env[key]));
  await assert.rejects(restoreSnapshot(snapshot, restored), { code: 'EEXIST' });
  await assert.rejects(createSnapshot(snapshot, { env, stopped: true }), { code: 'EEXIST' });
}));
test('corrupted, traversal and symlink snapshots are rejected before any restore directory is created', () => fixture(async (dir, env) => {
  const snapshot = join(dir, 'backup'); const restored = join(dir, 'restored');
  await createSnapshot(snapshot, { env, stopped: true });
  const gallery = join(snapshot, 'gallery.json'); const original = await readFile(gallery);
  await writeFile(gallery, '{}');
  await assert.rejects(restoreSnapshot(snapshot, restored), /checksum mismatch/);
  await assert.rejects(access(restored), { code: 'ENOENT' });
  await writeFile(gallery, original);
  const path = join(snapshot, 'manifest.json'); const manifestBytes = await readFile(path); const manifest = JSON.parse(manifestBytes);
  manifest.files[0].name = '../gallery.json'; await writeFile(path, JSON.stringify(manifest));
  await assert.rejects(verifySnapshot(snapshot), /Invalid snapshot file entry/);
  await writeFile(path, manifestBytes); await rm(gallery); await symlink(env.GALLERY_STATE_PATH, gallery);
  await assert.rejects(verifySnapshot(snapshot), /Not a regular file/);
}));
test('missing optional stores are recorded; a missing wallet blocks backup', () => fixture(async (dir, env) => {
  await rm(env.PARTNER_SESSIONS_PATH);
  const manifest = await createSnapshot(join(dir, 'optional'), { env, stopped: true });
  assert.equal(manifest.files.find((f) => f.name === 'partner-sessions.json').present, false);
  await verifySnapshot(join(dir, 'optional'));
  await rm(env.TOKEN_STATE_PATH);
  await assert.rejects(createSnapshot(join(dir, 'missing'), { env, stopped: true }), { code: 'ENOENT' });
}));
test('production startup rejects missing or template receipt secrets and debug overrides', async () => {
  for (const extra of [{ TOKEN_RECEIPT_SECRET: '' }, { TOKEN_RECEIPT_SECRET: 'development-only-change-before-production' }, { TOKEN_RECEIPT_SECRET: 'x'.repeat(48), ALLOW_DEBUG_ROUTES: '1' }]) {
    await assert.rejects(exec(process.execPath, ['--input-type=module', '-e', "await import('./apps/api/server.mjs')"], {
      env: { ...process.env, NODE_ENV: 'production', ALLOW_DEBUG_ROUTES: '0', ...extra }, timeout: 10_000
    }), (error) => /Production/.test(error.stderr));
  }
});
test('production smoke verifies version and closed debug routes without modifying persisted state', () => fixture(async (dir, env) => {
  // Fresh server stores use their native empty-state schemas, not the backup fixtures.
  for (const path of Object.values(env)) await rm(path);
  delete env.OFFICIAL_ASSETS_PATH;
  const code = `
    import assert from 'node:assert/strict';
    import { readFile } from 'node:fs/promises';
    import { productionSmoke } from './scripts/production-smoke.mjs';
    const { server } = await import('./apps/api/server.mjs');
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    try {
      const base = 'http://127.0.0.1:' + server.address().port;
      const before = await readFile(process.env.TOKEN_STATE_PATH);
      const result = await productionSmoke(base, '0.9.0-rc.1');
      assert.equal(result.version, '0.9.0-rc.1');
      await assert.rejects(productionSmoke(base, 'wrong-version'), /check failed/);
      const seeded = await fetch(base + '/api/game/new', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({seed:2}) });
      assert.equal(seeded.status, 403);
      assert.deepEqual(await readFile(process.env.TOKEN_STATE_PATH), before);
    } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); }
  `;
  await exec(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, ...env, NODE_ENV: 'production', ALLOW_DEBUG_ROUTES: '0', TOKEN_RECEIPT_SECRET: 'test-only-production-secret-'.repeat(3) }, timeout: 15_000 });
}));
