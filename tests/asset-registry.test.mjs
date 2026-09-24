import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { AssetRegistry } from '../apps/api/asset-registry.mjs';
import { PalResourcePipeline } from '../apps/api/pal-resource-pipeline.mjs';
import { createOfficialPal } from '../packages/pal-asset-contract/index.mjs';
import { displayAsset } from '../apps/web/asset-slots.js';

const execFileAsync = promisify(execFile);
const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const webRoot = join(projectRoot, 'apps/web');
const officialPath = join(projectRoot, 'apps/api/data/official-assets.json');

function registryWith(tasks = []) {
  return new AssetRegistry({ webRoot, projectRoot, officialPath, pipeline: { tasks: new Map(tasks.map((task) => [task.taskId, task])) } });
}

function succeededTask(overrides = {}) {
  return {
    taskId: 'task-1', planId: 'plan-1', resourceId: 'avatar', kind: 'image', status: 'SUCCEEDED',
    publicUrl: '/assets/pals/ugc/plan-1-avatar.png', updatedAt: '2026-09-18T00:00:00.000Z',
    planSnapshot: { planId: 'plan-1', identity: { suffix: 2632, version: 100, name: '测试牌友' }, resources: [] },
    ...overrides
  };
}

test('registry entries carry the six required fields and no registered file is missing', async () => {
  const registry = registryWith();
  const { assets, summary } = await registry.build();
  assert.ok(assets.length > 50, 'official registry should be populated');
  for (const entry of assets) {
    for (const field of ['palId', 'outfitId', 'slot', 'action', 'source', 'acceptance']) assert.ok(field in entry, `${entry.id} missing field ${field}`);
    assert.ok(entry.source?.kind, `${entry.id} missing source kind`);
    assert.ok(entry.acceptance?.status, `${entry.id} missing acceptance status`);
  }
  assert.equal(summary.byStatus.MISSING_FILE || 0, 0, `registered files must exist: ${JSON.stringify(assets.filter((a) => a.acceptance?.status === 'MISSING_FILE').map((a) => a.file))}`);
});

test('mia action videos and yinlan table standee are produced and approved; manual crop is rejected', async () => {
  const { gaps, assets } = await registryWith().build();
  /* 2026-09-19 排产完成：米娅 A02–A05 与银岚牌桌立绘均已 APPROVED，缺口关闭。 */
  for (const slot of ['action-a02', 'action-a03', 'action-a04', 'action-a05']) {
    assert.ok(!gaps.some((gap) => gap.palId === 'pal-mia' && gap.slot === slot), `mia ${slot} gap must be closed`);
    assert.ok(assets.some((entry) => entry.palId === 'pal-mia' && entry.slot === slot && entry.kind === 'video' && entry.acceptance?.status === 'APPROVED'), `mia ${slot} video must be approved`);
  }
  assert.ok(!gaps.some((gap) => gap.palId === 'pal-yinlan' && gap.slot === 'table-standee'), 'yinlan table standee gap must be closed');
  assert.ok(assets.some((entry) => entry.palId === 'pal-yinlan' && entry.slot === 'table-standee' && entry.acceptance?.status === 'APPROVED'), 'yinlan dedicated table standee must be approved');
  const manual = assets.filter((entry) => entry.acceptance?.status === 'REJECTED_MANUAL').map((entry) => entry.file);
  assert.deepEqual(manual.sort(), [
    'assets/pals/ugc/墨鸢/5fe85ced-2ef0-48ec-af65-90cdf3e0fc82-master-portrait-cutout.png',
    'assets/pals/ugc/墨鸢/5fe85ced-2ef0-48ec-af65-90cdf3e0fc82-table-standee-cutout.png',
    'assets/pals/yinlan-seat.png',
    'assets/pals/yinlan-table-standee-v2.png'
  ]);
  /* 回退物不能掩盖缺口：银岚全身立绘标了 role=fallback，专用半身缺口仍然成立。 */
  const fallback = assets.find((entry) => entry.id === 'yinlan-standee-full');
  assert.equal(fallback.role, 'fallback');
});

test('pipeline tasks derive entries with honest acceptance status', async () => {
  const tasks = [
    succeededTask(),
    succeededTask({ taskId: 'task-2', resourceId: 'table-standee', reviewStatus: 'APPROVED', reviewedAt: '2026-09-18T01:00:00.000Z' }),
    succeededTask({ taskId: 'task-3', resourceId: 'action-sheet', publicUrl: '/assets/pals/ugc/plan-1-action-sheet.png' }),
    { ...succeededTask({ taskId: 'task-4', resourceId: 'first-outfit' }), status: 'FAILED', error: 'safety system rejected' },
    succeededTask({
      taskId: 'task-5', resourceId: 'action-a01', kind: 'video', publicUrl: '/assets/pals/ugc/plan-1-action-a01.mp4',
      derivedImages: undefined
    })
  ];
  const { assets, gaps } = await registryWith(tasks).build();
  const legacy = assets.find((entry) => entry.id === 'ugc-plan-1-avatar');
  assert.equal(legacy.palId, 'pal-user-2632-v100');
  assert.equal(legacy.acceptance.status, 'LEGACY_UNREVIEWED', 'tasks without reviewStatus must not pretend to be accepted');
  assert.equal(assets.find((entry) => entry.id === 'ugc-plan-1-table-standee').acceptance.status, 'APPROVED');
  assert.ok(gaps.some((gap) => gap.slot === 'first-outfit' && gap.status === 'FAILED'), 'failed task surfaces as a gap');
  assert.ok(gaps.some((gap) => gap.slot === 'action-sheet' && gap.status === 'SPLIT_PENDING'), 'unsplit action sheet is a gap');
});

test('legacy single-panel master portrait is detected by real image width, board is not flagged', async () => {
  const single = succeededTask({
    taskId: 'task-single', planId: '5fe85ced-2ef0-48ec-af65-90cdf3e0fc82', resourceId: 'master-portrait',
    publicUrl: '/assets/pals/ugc/墨鸢/5fe85ced-2ef0-48ec-af65-90cdf3e0fc82-master-portrait.png'
  });
  const board = succeededTask({
    taskId: 'task-board', planId: 'd508cede-74ee-446a-9eac-feb2a581d7d0', resourceId: 'master-portrait',
    publicUrl: '/assets/pals/ugc/星恒/d508cede-74ee-446a-9eac-feb2a581d7d0-master-portrait.png'
  });
  const { gaps } = await registryWith([single, board]).build();
  const legacy = gaps.filter((gap) => gap.status === 'LEGACY_SINGLE_PORTRAIT');
  assert.equal(legacy.length, 1);
  assert.equal(legacy[0].planId, '5fe85ced-2ef0-48ec-af65-90cdf3e0fc82', 'the 1024px single-panel card is legacy; the 1920px board is not flagged');
});

test('displayAsset never serves the reference board in a display slot', () => {
  const ugc = {
    palId: 'pal-user-1-v1',
    appearance: { portraitRef: '/assets/pals/ugc/p-master.png', referenceCardRef: '/assets/pals/ugc/p-master.png', avatarRef: '/assets/pals/ugc/p-avatar.png', tableStandeeRef: '/assets/pals/ugc/p-master.png' }
  };
  assert.equal(displayAsset(ugc, 'avatar'), '/assets/pals/ugc/p-avatar.png');
  assert.equal(displayAsset(ugc, 'table'), null, 'a display slot pointing at the reference board reads as missing');
  assert.equal(displayAsset({ palId: 'pal-user-1-v1', appearance: { portraitRef: '/assets/pals/ugc/p-master.png', referenceCardRef: '/assets/pals/ugc/p-master.png' } }, 'avatar'), null, 'UGC missing avatar stays missing instead of falling back to the board');
  const official = createOfficialPal({ palId: 'pal-demo', name: '演示', accent: '#fff', outfit: '套装', dance: '节拍', standeeRef: '/assets/pals/demo-standee.png' });
  assert.equal(displayAsset(official, 'avatar'), official.appearance.portraitRef, 'official avatar slot is the registered portrait');
  assert.equal(displayAsset(official, 'table'), '/assets/pals/demo-standee.png', 'official table slot falls back to the standee');
});

test('official action pack binds split single images per action', () => {
  const pal = createOfficialPal({
    palId: 'pal-demo', name: '演示', accent: '#fff', outfit: '套装', dance: '节拍',
    actionImageRefs: { A01: '/assets/pals/actions/demo-A01.png', A04: '/assets/pals/actions/demo-A04.png' }
  });
  assert.equal(pal.actionPack.A01.imageRef, '/assets/pals/actions/demo-A01.png');
  assert.equal(pal.actionPack.A04.imageRef, '/assets/pals/actions/demo-A04.png');
  assert.equal(pal.actionPack.A02.imageRef, null, 'unsplit actions stay explicit');
});

test('confirmed pals runtime refs exist on disk and are traceable', async () => {
  const confirmedPath = join(projectRoot, 'apps/api/data/confirmed-pals.json');
  const tasksPath = join(projectRoot, 'apps/api/data/pal-resource-tasks.json');
  const confirmed = JSON.parse(await readFile(confirmedPath, 'utf8'));
  const tasksData = JSON.parse(await readFile(tasksPath, 'utf8'));
  const tracked = new Set();
  for (const task of tasksData.tasks || []) {
    if (task.publicUrl) tracked.add(task.publicUrl);
    for (const derived of Object.values(task.derivedImages || {})) if (derived.publicUrl) tracked.add(derived.publicUrl);
  }
  const { assets } = await registryWith().build();
  const registered = new Set(assets.filter((entry) => entry.publicUrl).map((entry) => entry.publicUrl));
  const collectRefs = (value, acc = []) => {
    if (typeof value === 'string') { if (value.startsWith('/assets/')) acc.push(value); return acc; }
    if (Array.isArray(value)) { for (const item of value) collectRefs(item, acc); return acc; }
    if (value && typeof value === 'object') { for (const item of Object.values(value)) collectRefs(item, acc); }
    return acc;
  };
  assert.ok(confirmed.pals.length >= 2, 'expected the two confirmed workshop pals');
  for (const pal of confirmed.pals) {
    for (const ref of collectRefs(pal)) {
      assert.ok(existsSync(join(webRoot, ref.replace(/^\//, ''))), `${pal.palId} ref missing on disk: ${ref}`);
      assert.ok(tracked.has(ref) || registered.has(ref), `${pal.palId} ref is not traceable to a pipeline task or a registry entry: ${ref}`);
    }
  }
});

test('rejected pipeline task maps to REJECTED_MANUAL with the user reason', async () => {
  const tasks = [succeededTask({ reviewStatus: 'REJECTED', reviewNote: '构图裁坏，左缘缺一块' })];
  const { assets } = await registryWith(tasks).build();
  const entry = assets.find((item) => item.id === 'ugc-plan-1-avatar');
  assert.equal(entry.acceptance.status, 'REJECTED_MANUAL');
  assert.match(entry.acceptance.note, /构图裁坏，左缘缺一块/);
  assert.ok(entry.acceptance.reviewedAt === null || typeof entry.acceptance.reviewedAt === 'string');
});

test('backfillActionSheets splits legacy sheets into five reviewable singles', async () => {
  try {
    await execFileAsync('python', ['--version']);
  } catch {
    return; // python unavailable on this host: split is exercised in production wiring instead
  }
  const dir = await mkdtemp(join(tmpdir(), 'asset-backfill-'));
  try {
    const assetDir = join(dir, 'assets');
    await mkdir(assetDir, { recursive: true });
    await copyFile(join(webRoot, 'assets/pals/linxing-actions-v1.png'), join(assetDir, 'plan-9-action-sheet.png'));
    const statePath = join(dir, 'state.json');
    await writeFile(statePath, JSON.stringify({ version: 3, tasks: [
      { taskId: 'sheet-1', planId: 'plan-9', resourceId: 'action-sheet', kind: 'image', status: 'SUCCEEDED', publicUrl: '/assets/pals/ugc/plan-9-action-sheet.png', updatedAt: '2026-09-18T00:00:00.000Z', planSnapshot: { planId: 'plan-9', identity: { suffix: 1, version: 1 }, resources: [] } }
    ] }), 'utf8');
    const pipeline = new PalResourcePipeline({ assetDir, statePath, env: {} });
    await pipeline.backfillActionSheets();
    const task = pipeline.list('plan-9').find((item) => item.taskId === 'sheet-1');
    assert.deepEqual(Object.keys(task.derivedImages).sort(), ['A01', 'A02', 'A03', 'A04', 'A05']);
    assert.equal(task.derivedImages.A03.reviewStatus, 'AWAITING_REVIEW', 'backfilled splits join the per-image acceptance flow');
    assert.equal(task.derivedImages.A01.publicUrl, '/assets/pals/ugc/plan-9-action-sheet-A01.png');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
