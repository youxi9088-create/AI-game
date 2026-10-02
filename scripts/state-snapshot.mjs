import { lstat, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const files = {
  'gallery.json': 'GALLERY_STATE_PATH',
  'player-wallet.json': 'TOKEN_STATE_PATH',
  'confirmed-pals.json': 'CONFIRMED_PALS_PATH',
  'pal-resource-tasks.json': 'PAL_RESOURCE_STATE_PATH',
  'partner-sessions.json': 'PARTNER_SESSIONS_PATH',
  'official-assets.json': 'OFFICIAL_ASSETS_PATH'
};
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const required = new Set(['gallery.json', 'player-wallet.json', 'official-assets.json']);
async function readRegular(path) {
  if (!(await lstat(path)).isFile()) throw new Error(`Not a regular file: ${path}`);
  const bytes = await readFile(path);
  JSON.parse(bytes.toString('utf8'));
  return bytes;
}
async function newDirectory(path, action) {
  // Existing directories are never overwritten, even when empty.
  await mkdir(path, { mode: 0o700 });
  try { return await action(); }
  catch (error) { await rm(path, { recursive: true, force: true }); throw error; }
}
export async function createSnapshot(output, { env = process.env, stopped = false } = {}) {
  if (!stopped) throw new Error('Stop the game service and asset workers first; then pass --stopped.');
  const records = [];
  for (const [name, key] of Object.entries(files)) {
    if (!env[key] || !isAbsolute(env[key])) throw new Error(`Set ${key} to the actual absolute server path; backup never guesses repository defaults.`);
    const source = env[key];
    let bytes;
    try { bytes = await readRegular(source); }
    catch (error) {
      if (error.code !== 'ENOENT' || required.has(name)) throw error;
    }
    records.push({ name, source, bytes });
  }
  // Detect writes during collection. This is not a substitute for stopping all writers.
  for (const record of records) {
    let current;
    try { current = await readRegular(record.source); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (Boolean(current) !== Boolean(record.bytes) || (current && !current.equals(record.bytes))) {
      throw new Error('State changed during backup; stop all writers and retry.');
    }
  }
  return newDirectory(output, async () => {
    const manifest = { format: 1, createdAt: new Date().toISOString(), files: [] };
    for (const { name, bytes } of records) {
      manifest.files.push({ name, present: Boolean(bytes), ...(bytes ? { bytes: bytes.length, sha256: digest(bytes) } : {}) });
      if (bytes) await writeFile(join(output, name), bytes, { flag: 'wx', mode: 0o600 });
    }
    await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 });
    return manifest;
  });
}
export async function verifySnapshot(directory) {
  const manifest = JSON.parse((await readRegular(join(directory, 'manifest.json'))).toString('utf8'));
  if (manifest.format !== 1 || !Array.isArray(manifest.files) || manifest.files.length !== Object.keys(files).length) throw new Error('Invalid snapshot manifest.');
  const seen = new Set();
  const contents = new Map();
  for (const entry of manifest.files) {
    if (!Object.hasOwn(files, entry.name) || seen.has(entry.name) || typeof entry.present !== 'boolean') throw new Error('Invalid snapshot file entry.');
    seen.add(entry.name);
    if (!entry.present) {
      if (required.has(entry.name)) throw new Error(`Required snapshot file missing: ${entry.name}`);
      continue;
    }
    const bytes = await readRegular(join(directory, entry.name));
    if (entry.bytes !== bytes.length || entry.sha256 !== digest(bytes)) throw new Error(`Snapshot checksum mismatch: ${entry.name}`);
    contents.set(entry.name, bytes);
  }
  return { manifest, contents };
}
export async function restoreSnapshot(directory, output) {
  const { manifest, contents } = await verifySnapshot(directory);
  return newDirectory(output, async () => {
    for (const [name, bytes] of contents) await writeFile(join(output, name), bytes, { flag: 'wx', mode: 0o600 });
    return manifest;
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [action, input, output] = process.argv.slice(2);
    if (!input) throw new Error('Usage: state-snapshot.mjs create <new-dir> --stopped | verify <snapshot> | restore <snapshot> <new-dir>');
    if (action === 'create') await createSnapshot(resolve(input), { stopped: output === '--stopped' });
    else if (action === 'verify') await verifySnapshot(resolve(input));
    else if (action === 'restore' && output) await restoreSnapshot(resolve(input), resolve(output));
    else throw new Error('Invalid snapshot command.');
    console.log(`Snapshot ${action} verified. Assets and secrets must be backed up separately; no running service was changed.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
