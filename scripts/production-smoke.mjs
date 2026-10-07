import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function productionSmoke(base, expectedVersion) {
  const url = new URL(base);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Use an HTTP(S) origin without embedded credentials.');
  const get = (path) => fetch(new URL(path, url), { redirect: 'error', signal: AbortSignal.timeout(5000) });
  const health = await get('/health');
  const data = await health.json();
  if (!health.ok || data.ok !== true || data.environment !== 'production' || data.debugEnabled !== false || data.version !== expectedVersion) throw new Error('Health/version/production-mode check failed.');
  if ((await get('/api/inspect')).status !== 403) throw new Error('Production inspector is not closed.');
  for (const path of ['/', '/app.js', '/photo-studio.js', '/collection.css', '/sfx.js']) {
    const response = await get(path);
    if (!response.ok || !(await response.text()).length) throw new Error(`Runtime resource unavailable: ${path}`);
  }
  return { version: data.version, mode: data.mode };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (!process.argv[2]) throw new Error('Usage: production-smoke.mjs <origin> [expected-version]');
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    const result = await productionSmoke(process.argv[2], process.argv[3] || pkg.version);
    console.log(`Production smoke passed: ${result.version}; ${result.mode}. Read-only requests; no game or wallet was changed.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
