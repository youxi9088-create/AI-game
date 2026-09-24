import { createHash } from 'node:crypto';
import { access, mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ugc = join(repo, 'apps/web/assets/pals/ugc');
const apply = process.argv.includes('--apply');

const groups = [
  { match: /^4580b022-69a7-406a-8513-21781466b452-(.+)$/i, folder: '甜美卷发小甜甜' },
  { match: /^5fe85ced-2ef0-48ec-af65-90cdf3e0fc82-(.+)$/i, folder: '墨鸢' },
  { match: /^d508cede-74ee-446a-9eac-feb2a581d7d0-(.+)$/i, folder: '星恒' },
  { match: /^f479d45a-0a48-415f-94cf-740b35bef45b-(.+)$/i, folder: '代娜', rename: (suffix) => `daina-${suffix}` },
  { match: /^official-mia-gapfill-(.+)$/i, folder: '米娅', rename: (suffix) => `mia-gapfill-${suffix}` },
  { match: /^official-yinlan-gapfill-(.+)$/i, folder: '银岚', rename: (suffix) => `yinlan-gapfill-${suffix}` },
  { match: /^星恒-待机2\.mp4$/u, folder: '星恒', rename: () => 'xingheng-source-idle-v2.mp4' },
  { match: /^星恒-开场\.mp4$/u, folder: '星恒', rename: () => 'xingheng-source-entry.mp4' },
  { match: /^dfce95b1-8a03-4d18-befe-7c22517331b0-(.+)$/i, folder: '_archive/星恒-v104', rename: (suffix) => `xingheng-v104-${suffix}` },
  { match: /^0c5995fe-e451-4689-9ee4-cd7143d2624f\.png$/i, folder: '_quarantine', rename: () => 'orphan-empty-shell.png' }
];

const backupGroups = [
  { name: '4580b022-69a7-406a-8513-21781466b452-lounge-standee-provider-alpha-failed.png', folder: '_backup/甜美卷发小甜甜' },
  { name: 'd508cede-74ee-446a-9eac-feb2a581d7d0-first-outfit-v2.jpg', folder: '_backup/星恒' }
];

function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
async function exists(path) { try { await access(path); return true; } catch { return false; } }
function urlPath(path) { return path.replace(/\\/g, '/'); }

const moves = [];
for (const entry of await readdir(ugc, { withFileTypes: true })) {
  if (!entry.isFile()) continue;
  const group = groups.find((candidate) => candidate.match.test(entry.name));
  if (!group) continue;
  const match = entry.name.match(group.match);
  const suffix = match?.[1] || entry.name;
  const targetName = group.rename ? group.rename(suffix) : entry.name;
  moves.push({ source: join(ugc, entry.name), target: join(ugc, group.folder, targetName) });
}
for (const group of backupGroups) {
  const source = join(ugc, '_backup', group.name);
  if (await exists(source)) moves.push({ source, target: join(ugc, group.folder, group.name) });
}

const replacements = new Map();
for (const move of moves) {
  const oldRelative = urlPath(relative(ugc, move.source));
  const newRelative = urlPath(relative(ugc, move.target));
  replacements.set(`/assets/pals/ugc/${oldRelative}`, `/assets/pals/ugc/${newRelative}`);
  replacements.set(`apps/web/assets/pals/ugc/${oldRelative}`, `apps/web/assets/pals/ugc/${newRelative}`);
  replacements.set(`assets/pals/ugc/${oldRelative}`, `assets/pals/ugc/${newRelative}`);
}

const textRoots = [join(repo, 'apps'), join(repo, 'packages'), join(repo, 'tests'), join(repo, 'docs')];
const textExtensions = new Set(['.js', '.mjs', '.json', '.md', '.html', '.css']);
const textFiles = [];
async function collectTextFiles(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name.endsWith('.tmp')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await collectTextFiles(path);
    else if (textExtensions.has(entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase())) textFiles.push(path);
  }
}
for (const root of textRoots) if (await exists(root)) await collectTextFiles(root);

const rewrites = [];
for (const path of textFiles) {
  const original = await readFile(path, 'utf8');
  let updated = original;
  for (const [before, after] of replacements) updated = updated.split(before).join(after);
  if (updated !== original) rewrites.push({ path, original, updated });
}

for (const move of moves) {
  if (await exists(move.target)) throw new Error(`Refusing to overwrite existing asset: ${move.target}`);
}

console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', moves: moves.map(({ source, target }) => ({ from: urlPath(relative(ugc, source)), to: urlPath(relative(ugc, target)) })), rewrittenFiles: rewrites.map(({ path }) => urlPath(relative(repo, path))) }, null, 2));
if (!apply) process.exit(0);

const beforeHashes = new Map();
for (const move of moves) beforeHashes.set(move.target, sha256(await readFile(move.source)));
for (const move of moves) {
  await mkdir(dirname(move.target), { recursive: true });
  await rename(move.source, move.target);
}
for (const rewrite of rewrites) await writeFile(rewrite.path, rewrite.updated, 'utf8');

let repairedContracts = 0;
const confirmedPath = join(repo, 'apps/api/data/confirmed-pals.json');
const confirmed = JSON.parse(await readFile(confirmedPath, 'utf8'));
const sweet = confirmed.pals?.find((pal) => pal?.identity?.name === '甜美卷发小甜甜');
if (sweet) {
  sweet.appearance.actionSheetRef = null;
  for (let index = 1; index <= 5; index += 1) {
    const key = `A0${index}`;
    if (sweet.actionPack?.[key]) sweet.actionPack[key].imageRef = `/assets/pals/ugc/甜美卷发小甜甜/4580b022-69a7-406a-8513-21781466b452-action-image-${key}.png`;
  }
  repairedContracts += 1;
}
const xingheng = confirmed.pals?.find((pal) => pal?.identity?.name === '星恒');
if (xingheng) {
  xingheng.appearance.entryVideoRef = '/assets/pals/ugc/星恒/d508cede-74ee-446a-9eac-feb2a581d7d0-entry-film-V2.mp4';
  xingheng.appearance.danceVideoRef = null;
  for (let index = 1; index <= 5; index += 1) {
    const key = `A0${index}`;
    if (!xingheng.actionPack?.[key]) continue;
    xingheng.actionPack[key].videoRef = null;
    xingheng.actionPack[key].imageRef = `/assets/pals/ugc/星恒/d508cede-74ee-446a-9eac-feb2a581d7d0-action-image-${key}.png`;
  }
  for (const outfit of xingheng.appearance.outfitLibrary || []) if (outfit?.layerSnapshot) outfit.layerSnapshot.cardVideo = null;
  if (xingheng.performance) xingheng.performance.mainTrack = null;
  repairedContracts += 1;
}
await writeFile(confirmedPath, `${JSON.stringify(confirmed, null, 2)}\n`, 'utf8');

const galleryPath = join(repo, 'apps/api/data/gallery.json');
const gallery = JSON.parse(await readFile(galleryPath, 'utf8'));
for (const card of gallery.player || []) {
  if (card?.palId === 'pal-user-5079-v103' && card.layerSnapshot) {
    card.layerSnapshot.cardVideo = null;
    repairedContracts += 1;
  }
}
await writeFile(galleryPath, `${JSON.stringify(gallery, null, 2)}\n`, 'utf8');

const officialPath = join(repo, 'apps/api/data/official-assets.json');
let officialText = await readFile(officialPath, 'utf8');
officialText = officialText
  .split('/assets/pals/ugc/d508cede-74ee-446a-9eac-feb2a581d7d0-entry-film-v2.mp4').join('/assets/pals/ugc/星恒/d508cede-74ee-446a-9eac-feb2a581d7d0-entry-film-V2.mp4')
  .split('assets/pals/ugc/d508cede-74ee-446a-9eac-feb2a581d7d0-entry-film-v2.mp4').join('assets/pals/ugc/星恒/d508cede-74ee-446a-9eac-feb2a581d7d0-entry-film-V2.mp4');
const official = JSON.parse(officialText);
const xinghengLounge = official.assets?.find((asset) => asset?.id === 'ugc-xingheng-lounge-single-adhoc');
if (xinghengLounge) {
  xinghengLounge.publicUrl = '/assets/pals/ugc/星恒/d508cede-74ee-446a-9eac-feb2a581d7d0-lounge-standee.png';
  xinghengLounge.file = 'assets/pals/ugc/星恒/d508cede-74ee-446a-9eac-feb2a581d7d0-lounge-standee.png';
  xinghengLounge.source.detail = '资源目录审计确认的当前大厅立绘；管线任务记录与人工修复文件分开保留。';
  repairedContracts += 1;
}
await writeFile(officialPath, `${JSON.stringify(official, null, 2)}\n`, 'utf8');

const taskStatePath = join(repo, 'apps/api/data/pal-resource-tasks.json');
const taskState = JSON.parse(await readFile(taskStatePath, 'utf8'));
const staleXinghengUrls = new Set([
  '/assets/pals/ugc/d508cede-74ee-446a-9eac-feb2a581d7d0-entry-film.mp4',
  '/assets/pals/ugc/d508cede-74ee-446a-9eac-feb2a581d7d0-first-outfit.png',
  '/assets/pals/ugc/d508cede-74ee-446a-9eac-feb2a581d7d0-outfit-film.mp4'
]);
for (const task of taskState.tasks || []) {
  if (!staleXinghengUrls.has(task.publicUrl)) continue;
  task.status = 'FAILED';
  task.reviewStatus = 'REJECTED';
  task.retryLocked = false;
  task.publicUrl = null;
  task.error = '历史任务记录指向的本地文件已不存在；资源目录审计已撤回此产物，请按当前管线重试。';
  task.updatedAt = new Date().toISOString();
  repairedContracts += 1;
}
for (const task of taskState.tasks || []) {
  if (typeof task.publicUrl === 'string' && task.publicUrl.startsWith('/assets/pals/ugc/')) {
    const diskPath = join(repo, 'apps/web', ...decodeURIComponent(task.publicUrl).split('/').filter(Boolean));
    if (!(await exists(diskPath))) {
      task.status = 'FAILED';
      task.reviewStatus = 'REJECTED';
      task.retryLocked = false;
      task.publicUrl = null;
      task.error = '资源目录审计发现该任务的本地产物缺失；已撤回完成状态，请按当前管线重试。';
      task.updatedAt = new Date().toISOString();
      repairedContracts += 1;
    }
  }
  if (typeof task.alphaPreviewUrl === 'string' && task.alphaPreviewUrl.startsWith('/assets/pals/ugc/')) {
    const previewPath = join(repo, 'apps/web', ...decodeURIComponent(task.alphaPreviewUrl).split('/').filter(Boolean));
    if (!(await exists(previewPath))) {
      task.alphaPreviewUrl = null;
      task.alphaVisualApproved = false;
      if (task.reviewStatus === 'APPROVED') task.reviewStatus = 'REJECTED';
      repairedContracts += 1;
    }
  }
}
await writeFile(taskStatePath, `${JSON.stringify(taskState, null, 2)}\n`, 'utf8');

for (const move of moves) {
  if (await exists(move.source)) throw new Error(`Source still exists after move: ${move.source}`);
  if (!(await stat(move.target)).isFile()) throw new Error(`Target missing after move: ${move.target}`);
  const after = sha256(await readFile(move.target));
  if (after !== beforeHashes.get(move.target)) throw new Error(`Hash mismatch after move: ${move.target}`);
}
console.log(JSON.stringify({ status: 'organized', moved: moves.length, rewritten: rewrites.length, hashVerified: moves.length, repairedContracts }, null, 2));
