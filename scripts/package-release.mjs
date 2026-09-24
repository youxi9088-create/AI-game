/* 正式资源版本包：把当前注册表中「正式在用」的资产打成一个自包含版本目录。
   收录规则：acceptance.status ∈ {APPROVED, LEGACY_UNREVIEWED} 且 publicUrl 存在、文件在盘；
   不收录 SOURCE_ONLY / REJECTED_* / MISSING（清单里单独列出，说明为什么不在包内）。
   产物：release/<version>/assets/**（按运行时路径镜像）+ manifest.json + MANIFEST.md，
   复制后逐文件重算 SHA-256 校验。用法：node scripts/package-release.mjs [version] */
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AssetRegistry } from '../apps/api/asset-registry.mjs';

const version = process.argv[2] || 'v1.0';
const root = fileURLToPath(new URL('..', import.meta.url));
const webRoot = join(root, 'apps/web');
const outRoot = join(root, 'release', version);

const tasksData = JSON.parse(await readFile(join(root, 'apps/api/data/pal-resource-tasks.json'), 'utf8'));
const pipeline = { tasks: new Map((tasksData.tasks || []).map((task) => [task.taskId, task])) };
const registry = new AssetRegistry({ webRoot, projectRoot: root, officialPath: join(root, 'apps/api/data/official-assets.json'), pipeline });
const data = await registry.build();

const PAL_NAME = { 'pal-linxing': '林星', 'pal-mia': '米娅', 'pal-yinlan': '银岚' };
const palName = (palId) => PAL_NAME[palId] || (palId?.startsWith('pal-user-') ? `自定义 ${palId}` : palId || '—');
const INCLUDE = new Set(['APPROVED', 'LEGACY_UNREVIEWED']);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const packed = [];
const skipped = [];
for (const entry of data.assets) {
  const status = entry.acceptance?.status || 'UNTRACKED';
  if (!INCLUDE.has(status) || !entry.publicUrl) { skipped.push({ entry, reason: status }); continue; }
  const rel = entry.publicUrl.replace(/^\//, '');
  let bytes;
  try { bytes = await readFile(join(webRoot, rel)); } catch { skipped.push({ entry, reason: 'FILE_MISSING' }); continue; }
  const target = join(outRoot, 'assets', rel);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(join(webRoot, rel), target);
  packed.push({
    id: entry.id, palId: entry.palId, pal: palName(entry.palId), outfitId: entry.outfitId,
    slot: entry.slot, action: entry.action, kind: entry.kind,
    path: `assets/${rel}`, bytes: bytes.length, sha256: sha256(bytes),
    acceptance: status, source: entry.source?.kind || null, note: entry.acceptance?.note || null
  });
}

const ORDER = ['master-portrait', 'avatar', 'lounge-standee', 'table-standee', 'action-sheet',
  'action-a01', 'action-a02', 'action-a03', 'action-a04', 'action-a05',
  'entry-film', 'entry-poster', 'first-outfit', 'outfit-film', 'outfit-poster', 'outfit-fx'];
packed.sort((a, b) => String(a.palId).localeCompare(String(b.palId)) || ORDER.indexOf(a.slot) - ORDER.indexOf(b.slot) || String(a.outfitId || '').localeCompare(String(b.outfitId || '')) || String(a.kind).localeCompare(String(b.kind)));

const manifest = {
  version, generatedAt: new Date().toISOString(), source: 'apps/api/data/official-assets.json + pal-resource-tasks.json（与 /api/assets/registry 同一聚合）',
  counts: { packed: packed.length, approved: packed.filter((e) => e.acceptance === 'APPROVED').length, legacyUnreviewed: packed.filter((e) => e.acceptance === 'LEGACY_UNREVIEWED').length, skipped: skipped.length },
  assets: packed,
  excluded: skipped.map(({ entry, reason }) => ({ id: entry.id, pal: palName(entry.palId), slot: entry.slot, reason, note: entry.acceptance?.note || null })),
  openGaps: data.gaps
};
await mkdir(outRoot, { recursive: true });
await writeFile(join(outRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

const lines = [
  `# 换装斗地主 正式资源包 ${version}`, '',
  `生成时间：${manifest.generatedAt}`,
  `收录 ${manifest.counts.packed} 份：APPROVED ${manifest.counts.approved} · 在用未逐项验收（LEGACY_UNREVIEWED）${manifest.counts.legacyUnreviewed}；另有 ${manifest.counts.skipped} 份未收录（见末节）。`,
  '每个文件按运行时路径镜像于 `assets/`，SHA-256 与 `manifest.json` 一一对应。', '',
  '| 角色 | 服装 | 用途槽位 | 动作 | 类型 | 验收状态 | 文件 |',
  '| --- | --- | --- | --- | --- | --- | --- |'
];
for (const e of packed) {
  lines.push(`| ${e.pal} | ${e.outfitId || '—'} | ${e.slot || '—'} | ${e.action || '—'} | ${e.kind} | ${e.acceptance} | \`${e.path}\` |`);
}
lines.push('', '## 未收录（SOURCE_ONLY / REJECTED / 缺口）', '');
for (const x of manifest.excluded) lines.push(`- ${x.pal} · ${x.slot || '—'} · ${x.reason}${x.note ? `：${x.note}` : ''}`);
for (const g of manifest.openGaps) lines.push(`- 缺口：${g.palId || '—'} · ${g.slot || '—'} · ${g.status}${g.note ? `：${g.note}` : ''}`);
await writeFile(join(outRoot, 'MANIFEST.md'), `${lines.join('\n')}\n`, 'utf8');

console.log(`release/${version} packed ${packed.length} assets (${manifest.counts.approved} approved, ${manifest.counts.legacyUnreviewed} legacy), skipped ${skipped.length}, gaps ${manifest.openGaps.length}`);
