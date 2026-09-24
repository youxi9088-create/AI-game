import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { createPalResourcePlan } from '../packages/pal-generation-core/index.mjs';
import { PalResourcePipeline } from '../apps/api/pal-resource-pipeline.mjs';

const testImageEnv = (extra = {}) => ({ AIHUB_AGENT_TOKEN: 'test-token', AIHUB_PROFILE_IMAGE_WORKFLOW_APP_ID: 'gpt-image2-test', AIHUB_STATIC_IMAGE_WORKFLOW_APP_ID: 'jimeng-test', AIHUB_VIDEO_WORKFLOW_APP_ID: 'seedance-test', AIHUB_AGENT_BASE_URL: 'https://agent.test', ...extra });

test('restart migrates only unsubmitted legacy video tasks to the current skill route', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'skill-route-migration-'));
  try {
    const statePath = join(dir, 'pipeline-state.json');
    await writeFile(statePath, JSON.stringify({ version: 2, portraitApprovals: [], tasks: [
      { taskId: 'legacy-entry', planId: 'legacy-plan', resourceId: 'entry-film', kind: 'video', status: 'WAITING_REFERENCE', provider: 'aihub-dance', route: 'aihub:dressbattle-dance', transport: 'aihub-agent', updatedAt: '2026-09-18T00:00:00.000Z' },
      { taskId: 'legacy-running', planId: 'legacy-plan', resourceId: 'action-a01', kind: 'video', status: 'RUNNING', provider: 'aihub-dance', route: 'aihub:dressbattle-dance', transport: 'aihub-agent', updatedAt: '2026-09-18T00:00:00.000Z' },
      { taskId: 'legacy-dance', planId: 'legacy-plan', resourceId: 'outfit-film', kind: 'video', status: 'WAITING_REFERENCE', provider: 'aihub-dance', route: 'aihub:dressbattle-dance', transport: 'aihub-agent', updatedAt: '2026-09-18T00:00:00.000Z' }
    ] }), 'utf8');
    const pipeline = new PalResourcePipeline({ assetDir: join(dir, 'assets'), statePath, env: testImageEnv() });
    await pipeline.ready;
    const migrated = pipeline.list('legacy-plan');
    assert.equal(migrated.find((task) => task.taskId === 'legacy-entry').provider, 'aihub-seedance');
    assert.equal(migrated.find((task) => task.taskId === 'legacy-entry').route, 'aihub:seedance');
    assert.equal(migrated.find((task) => task.taskId === 'legacy-running').provider, 'aihub-dance', 'already running work is not duplicated onto another provider');
    assert.equal(migrated.find((task) => task.taskId === 'legacy-dance').provider, 'aihub-dance', 'the dedicated dance resource stays on its workflow');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('restart prunes stale failed attempts but keeps the latest failure for retry', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dressbattle-prune-stale-failures-'));
  const statePath = join(dir, 'pipeline-state.json');
  const plan = { ...createPalResourcePlan({ prompt: '成年虚构牌友', packageTier: 'launch' }), planId: 'plan-prune-stale-failures' };
  await writeFile(statePath, JSON.stringify({ version: 4, portraitApprovals: [], tasks: [
    { taskId: 'old-failure', planId: plan.planId, resourceId: 'action-a01', kind: 'video', status: 'FAILED', attempt: 1, updatedAt: '2026-09-20T00:00:00.000Z', planSnapshot: plan, error: 'old provider response' },
    { taskId: 'latest-failure', planId: plan.planId, resourceId: 'action-a01', kind: 'video', status: 'FAILED', attempt: 2, updatedAt: '2026-09-21T00:00:00.000Z', planSnapshot: plan, error: 'latest provider response' },
    { taskId: 'old-success-failure', planId: plan.planId, resourceId: 'table-standee', kind: 'image', status: 'FAILED', attempt: 1, updatedAt: '2026-09-20T00:00:00.000Z', planSnapshot: plan, error: 'old image response' },
    { taskId: 'new-success', planId: plan.planId, resourceId: 'table-standee', kind: 'image', status: 'SUCCEEDED', attempt: 2, updatedAt: '2026-09-21T00:00:00.000Z', planSnapshot: plan, publicUrl: '/assets/pals/ugc/table-standee.png' }
  ] }), 'utf8');
  try {
    const pipeline = new PalResourcePipeline({ assetDir: join(dir, 'assets'), statePath, env: {} });
    await pipeline.ready;
    const tasks = pipeline.list(plan.planId);
    assert.equal(tasks.some((task) => task.taskId === 'old-failure'), false);
    assert.equal(tasks.some((task) => task.taskId === 'latest-failure'), true);
    assert.equal(tasks.some((task) => task.taskId === 'old-success-failure'), false);
    assert.equal(tasks.some((task) => task.taskId === 'new-success'), true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

function pngCrc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, payload) {
  const kind = Buffer.from(type, 'ascii');
  const data = Buffer.concat([kind, payload]);
  const chunk = Buffer.alloc(12 + payload.length);
  chunk.writeUInt32BE(payload.length, 0); data.copy(chunk, 4); chunk.writeUInt32BE(pngCrc32(data), 8 + payload.length);
  return chunk;
}

function pngAtSize(width, height, transparent = true) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  const scanlines = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    scanlines[y * (width * 4 + 1)] = 0;
    for (let x = 0; x < width; x += 1) {
      const pixel = y * (width * 4 + 1) + 1 + x * 4;
      scanlines[pixel] = 32; scanlines[pixel + 1] = 64; scanlines[pixel + 2] = 96;
      const transparentCanvas = transparent && width > 2 && height > 2 && (x < width * 0.2 || x >= width * 0.8 || y < height * 0.2 || y >= height * 0.8);
      scanlines[pixel + 3] = transparentCanvas ? 0 : transparent && x === 0 && y === 0 ? 128 : 255;
    }
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(scanlines)), pngChunk('IEND', Buffer.alloc(0))]);
}

/* Shared provider fixture: a small but genuine cutout canvas, not the old
   one-pixel semi-transparent PNG that could never model a usable standee. */
const onePixelPng = pngAtSize(10, 10);

test('transparent asset validation rejects an opaque RGBA matte', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dressbattle-alpha-validation-'));
  const pipeline = new PalResourcePipeline({ assetDir: join(dir, 'assets'), statePath: join(dir, 'state.json'), env: {} });
  try {
    await assert.rejects(
      () => pipeline.materializeBytes({ planId: 'alpha-check', resourceId: 'table-standee', label: '透明上桌立绘', kind: 'image' }, pngAtSize(1, 1, false), 'image/png'),
      /真实 alpha 通道/
    );
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('portrait must be generated and explicitly confirmed before any other resource task is submitted', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dressbattle-resource-gate-'));
  const originalFetch = globalThis.fetch;
  const requests = [];
  let imageCount = 0;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    requests.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
    if (url === 'https://agent.test/workflows/run') {
      imageCount += 1;
      return new Response(JSON.stringify({ data: [{ url: `https://images.test/${imageCount}.png` }] }), { status: 200, headers: { 'Content-Type': 'application/json', 'x-request-id': `image-${imageCount}` } });
    }
    if (/^https:\/\/images\.test\/\d+\.png$/.test(url)) return new Response(onePixelPng, { status: 200, headers: { 'Content-Type': 'image/png' } });
    throw new Error(`Unexpected request in test fixture: ${url}`);
  };
  const plan = { ...createPalResourcePlan({ prompt: '一位复古优雅的成年虚构舞台魔术师，喜欢蓝紫色灯光', version: 7, packageTier: 'launch' }), planId: 'plan-confirm-portrait-before-resources' };
  const pipeline = new PalResourcePipeline({
    assetDir: join(dir, 'assets'),
    statePath: join(dir, 'pipeline-state.json'),
    env: { AIHUB_AGENT_TOKEN: 'test-token', AIHUB_PROFILE_IMAGE_WORKFLOW_APP_ID: 'gpt-image2-test', AIHUB_STATIC_IMAGE_WORKFLOW_APP_ID: 'jimeng-test', AIHUB_AGENT_BASE_URL: 'https://agent.test' }
  });
  try {
    const initial = await pipeline.submit({ plan });
    assert.equal(initial.status, 'PORTRAIT_SUBMITTED');
    assert.deepEqual(initial.tasks.map((task) => task.resourceId), ['master-portrait']);
    await Promise.all([...pipeline.locks.values()]);
    assert.equal(pipeline.portraitGate(plan).status, 'AWAITING_CONFIRMATION');
    assert.equal(imageCount, 1);
    const portraitRequest = requests.find((request) => request.url === 'https://agent.test/workflows/run');
    assert.match(portraitRequest.body.inputs.prompt, /semi-realistic cinematic game CG/);
    assert.match(portraitRequest.body.inputs.prompt, /cannot be mistaken for Linxing, Yinlan/);
    assert.equal(portraitRequest.body.appId, 'gpt-image2-test');
    assert.equal(requests.filter((request) => request.url.includes('/workflows/run')).length, 1);

    const bypass = await pipeline.submit({ plan, resourceIds: ['table-standee'] });
    assert.equal(bypass.status, 'AWAITING_PORTRAIT_CONFIRMATION');
    assert.deepEqual(bypass.tasks.map((task) => task.resourceId), ['master-portrait']);
    const stillWaiting = await pipeline.submit({ plan });
    assert.equal(stillWaiting.status, 'AWAITING_PORTRAIT_CONFIRMATION');
    assert.equal(imageCount, 1, 'no second resource request may be issued before explicit approval');

    const approval = await pipeline.confirmPortrait(plan);
    assert.equal(approval.status, 'CONFIRMED');
    assert.equal(approval.portraitGate.status, 'CONFIRMED');
    assert.equal(pipeline.list(plan.planId).some((task) => task.resourceId !== 'master-portrait'), false, 'confirmation alone must not submit downstream resources');
    const next = await pipeline.submit({ plan, resourceIds: ['table-standee'] });
    assert.equal(next.status, 'SUBMITTED');
    assert.deepEqual(next.tasks.map((task) => task.resourceId), ['table-standee']);
    await Promise.all([...pipeline.locks.values()]);
    assert.equal(imageCount, 2);

    const restored = new PalResourcePipeline({ assetDir: join(dir, 'assets'), statePath: join(dir, 'pipeline-state.json'), env: {} });
    await restored.ready;
    assert.equal(restored.portraitGate(plan).status, 'CONFIRMED', 'portrait approval must survive service restart');
    assert.equal(restored.enrichPlan(plan).resources.find((resource) => resource.id === 'master-portrait').task.status, 'SUCCEEDED');
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test('portrait confirmation is rejected until a validated portrait is available', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dressbattle-resource-gate-empty-'));
  const plan = { ...createPalResourcePlan({ prompt: '一位运动明快的成年虚构牌友，喜欢蓝紫灯光', packageTier: 'mvp' }), planId: 'plan-cannot-confirm-empty' };
  const pipeline = new PalResourcePipeline({ assetDir: join(dir, 'assets'), statePath: join(dir, 'state.json'), env: {} });
  try {
    await assert.rejects(() => pipeline.confirmPortrait(plan), /只有已生成并通过落盘校验的角色资料卡可以确认/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a verified CS image URL can be attached only when its bytes match the generated portrait', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dressbattle-cs-portrait-'));
  const originalFetch = globalThis.fetch;
  const image = Buffer.from(onePixelPng);
  globalThis.fetch = async (input) => {
    if (String(input) === 'https://agent.test/workflows/run') return new Response(JSON.stringify({ data: [{ b64_json: image.toString('base64') }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (String(input) === 'https://assets.test/portrait.png') return new Response(image, { status: 200, headers: { 'Content-Type': 'image/png' } });
    if (String(input) === 'https://assets.test/mismatch.png') return new Response(Buffer.from('different image'), { status: 200, headers: { 'Content-Type': 'image/png' } });
    throw new Error(`Unexpected request in test fixture: ${String(input)}`);
  };
  const plan = { ...createPalResourcePlan({ prompt: '成年虚构角色', packageTier: 'mvp' }), planId: 'plan-cs-source-binding' };
  const pipeline = new PalResourcePipeline({
    assetDir: join(dir, 'assets'), statePath: join(dir, 'state.json'),
    env: testImageEnv({ PAL_ASSET_CDN_HOSTS: 'assets.test' })
  });
  try {
    await pipeline.submit({ plan });
    await Promise.all([...pipeline.locks.values()]);
    await assert.rejects(() => pipeline.attachSourceUrl(plan, 'master-portrait', 'https://assets.test/mismatch.png'), /字节数或 SHA-256 不一致/);
    const attached = await pipeline.attachSourceUrl(plan, 'master-portrait', 'https://assets.test/portrait.png');
    assert.equal(attached.status, 'ATTACHED');
    assert.equal(attached.bytes, image.length);
    const saved = JSON.parse(await readFile(join(dir, 'state.json'), 'utf8'));
    assert.equal(saved.tasks.find((task) => task.resourceId === 'master-portrait').sourceUrl, 'https://assets.test/portrait.png');
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test('concurrent full-package submissions serialize task-state writes without losing tasks', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dressbattle-parallel-persist-'));
  const originalFetch = globalThis.fetch;
  const image = Buffer.from(onePixelPng);
  const exactOutfit = pngAtSize(1536, 2048);
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (String(input) === 'https://agent.test/workflows/run') {
      const request = JSON.parse(init.body);
      const sourceUrl = request.appId === 'jimeng-test' ? 'https://images.test/outfit.png' : 'https://images.test/master.png';
      return new Response(JSON.stringify({ data: [{ url: sourceUrl }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url === 'https://images.test/master.png') return new Response(image, { status: 200, headers: { 'Content-Type': 'image/png' } });
    if (url === 'https://images.test/outfit.png') return new Response(exactOutfit, { status: 200, headers: { 'Content-Type': 'image/png' } });
    throw new Error(`Unexpected request in test fixture: ${String(input)}`);
  };
  const plan = { ...createPalResourcePlan({ prompt: '成年虚构角色', packageTier: 'launch' }), planId: 'plan-parallel-persist' };
  const pipeline = new PalResourcePipeline({
    assetDir: join(dir, 'assets'), statePath: join(dir, 'state.json'),
    env: testImageEnv({ PAL_DANCE_WORKFLOW_APP_ID: 'test-app' })
  });
  try {
    await pipeline.submit({ plan });
    await Promise.all([...pipeline.locks.values()]);
    await pipeline.confirmPortrait(plan);
    const result = await pipeline.submit({ plan });
    assert.equal(result.status, 'SUBMITTED');
    await Promise.all([...pipeline.locks.values()]);
    await pipeline.refresh();
    await Promise.all([...pipeline.locks.values()]);
    const tasks = pipeline.list(plan.planId);
    assert.equal(new Set(tasks.map((task) => task.resourceId)).size, plan.resources.length);
    const providerImages = plan.resources.filter((resource) => resource.kind === 'image' && resource.id !== 'outfit-poster');
    assert.equal(tasks.filter((task) => task.kind === 'image' && task.resourceId !== 'outfit-poster' && task.status === 'SUCCEEDED').length, providerImages.length, JSON.stringify(tasks.filter((task) => task.kind === 'image').map(({ resourceId, status, error, width, height }) => ({ resourceId, status, error, width, height }))));
    assert.equal(tasks.find((task) => task.resourceId === 'outfit-poster')?.status, 'WAITING_REFERENCE');
    assert.equal(tasks.some((task) => task.status === 'RETRY_WAITING' && /rename/.test(task.error || '')), false);
    const restored = new PalResourcePipeline({ assetDir: join(dir, 'assets'), statePath: join(dir, 'state.json'), env: {} });
    await restored.ready;
    assert.equal(new Set(restored.list(plan.planId).map((task) => task.resourceId)).size, plan.resources.length);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test('seat promotion uses the newest task when a prior resource attempt failed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dressbattle-promote-latest-task-'));
  const plan = { ...createPalResourcePlan({ prompt: '成年虚构牌友', packageTier: 'launch' }), planId: 'plan-promote-newest-resource-attempt' };
  const promoted = [];
  const pipeline = new PalResourcePipeline({ assetDir: join(dir, 'assets'), statePath: join(dir, 'state.json'), env: {}, onReady: (candidate) => promoted.push(candidate) });
  const earlier = '2026-09-16T10:00:00.000Z';
  const later = '2026-09-16T11:00:00.000Z';
  try {
    for (const resource of plan.resources) {
      pipeline.tasks.set(`latest-${resource.id}`, {
        taskId: `latest-${resource.id}`, planId: plan.planId, resourceId: resource.id, label: resource.label, kind: resource.kind,
        /* 文件校验已经通过但仍允许玩家逐项打回时，也应能进入整包候选验收；
           整包确认，而不是逐项 APPROVED，才是上桌前的最终人工门禁。 */
        planSnapshot: plan, status: 'SUCCEEDED', reviewStatus: resource.id === 'master-portrait' ? null : 'AWAITING_REVIEW', attempt: 1, updatedAt: resource.id === 'first-outfit' ? later : earlier,
        publicUrl: resource.kind === 'image' || resource.kind === 'video' ? `/assets/pals/ugc/${resource.id}.webm` : null,
        alphaVisualApproved: resource.id.startsWith('action-a') ? true : undefined
      });
    }
    pipeline.tasks.set('old-first-outfit-failure', {
      taskId: 'old-first-outfit-failure', planId: plan.planId, resourceId: 'first-outfit', kind: 'image',
      planSnapshot: plan, status: 'FAILED', attempt: 2, retryLocked: true, updatedAt: earlier, error: 'previous provider rejection'
    });

    const candidate = await pipeline.tryPromote(plan);

    assert.ok(candidate, 'the old failed attempt must not hide the later successful attempt');
    assert.equal(candidate.status, 'READY');
    assert.equal(candidate.package.state, 'RICH_ASSETS_READY');
    assert.equal(promoted.length, 1);
    assert.equal(promoted[0].asset.palId, candidate.asset.palId);
    const enriched = pipeline.enrichPlan(plan);
    assert.equal(enriched.deliveryState, 'RICH_ASSETS_READY');
    assert.equal(enriched.deliverySummary.complete, enriched.deliverySummary.required);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('interrupted queued and running image tasks are recovered once after service restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dressbattle-interrupted-image-'));
  const statePath = join(dir, 'state.json');
  const plan = { ...createPalResourcePlan({ prompt: '成年虚构角色', packageTier: 'mvp' }), planId: 'plan-interrupted-image' };
  const tasks = ['QUEUED', 'RUNNING', 'SUCCEEDED'].map((status, index) => ({
    taskId: `task-${index}`, planId: plan.planId, resourceId: `resource-${index}`, kind: 'image', status,
    attempt: 1, updatedAt: '2026-09-16T00:00:00.000Z', planSnapshot: plan, publicUrl: status === 'SUCCEEDED' ? '/assets/portrait.png' : null
  }));
  await writeFile(statePath, JSON.stringify({ version: 2, tasks, portraitApprovals: [] }), 'utf8');
  try {
    const pipeline = new PalResourcePipeline({ assetDir: join(dir, 'assets'), statePath, env: {} });
    await pipeline.ready;
    const recovered = pipeline.list(plan.planId);
    assert.equal(recovered.find((task) => task.taskId === 'task-0').status, 'RETRY_WAITING');
    assert.equal(recovered.find((task) => task.taskId === 'task-1').status, 'RETRY_WAITING');
    assert.equal(recovered.find((task) => task.taskId === 'task-2').status, 'SUCCEEDED');
    assert.equal(recovered.filter((task) => task.retryLocked).length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('terminal production tasks can be deleted without deleting generated files; active tasks are protected', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dressbattle-delete-task-'));
  const assetDir = join(dir, 'assets');
  const statePath = join(dir, 'state.json');
  const pipeline = new PalResourcePipeline({ assetDir, statePath, env: {} });
  const assetPath = join(assetDir, 'kept.png');
  await mkdir(assetDir, { recursive: true });
  await writeFile(assetPath, 'generated image bytes', 'utf8');
  pipeline.tasks.set('done-task', {
    taskId: 'done-task', planId: 'plan-delete', resourceId: 'portrait', kind: 'image', status: 'SUCCEEDED',
    publicUrl: '/assets/pals/ugc/kept.png', updatedAt: '2026-09-16T00:00:00.000Z'
  });
  pipeline.tasks.set('running-task', {
    taskId: 'running-task', planId: 'plan-delete', resourceId: 'video', kind: 'video', status: 'RUNNING',
    runId: 'active-run', updatedAt: '2026-09-16T00:00:00.000Z'
  });
  try {
    const deleted = await pipeline.deleteTask('done-task');
    assert.equal(deleted.status, 'DELETED');
    assert.equal(deleted.filePreserved, true);
    assert.equal(await readFile(assetPath, 'utf8'), 'generated image bytes');
    assert.equal(pipeline.list().some((task) => task.taskId === 'done-task'), false);
    await assert.rejects(() => pipeline.deleteTask('running-task'), /仍在排队、提交或运行中，不能删除/);
    assert.equal(pipeline.list().some((task) => task.taskId === 'running-task'), true);
    const saved = JSON.parse(await readFile(statePath, 'utf8'));
    assert.deepEqual(saved.tasks.map((task) => task.taskId), ['running-task']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('resource plans can be deleted as records while preserving terminal task files and blocking active plans', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dressbattle-delete-plan-'));
  const statePath = join(dir, 'state.json');
  const pipeline = new PalResourcePipeline({ assetDir: join(dir, 'assets'), statePath, env: {} });
  pipeline.tasks.set('plan-done-task', {
    taskId: 'plan-done-task', planId: 'plan-record-delete', resourceId: 'portrait', kind: 'image', status: 'SUCCEEDED',
    publicUrl: '/assets/pals/ugc/plan-record-delete-portrait.png', planSnapshot: { planId: 'plan-record-delete', identity: { name: '墨鸢', version: 4 } }, updatedAt: '2026-09-16T00:00:00.000Z'
  });
  pipeline.tasks.set('plan-running-task', {
    taskId: 'plan-running-task', planId: 'plan-active-delete', resourceId: 'video', kind: 'video', status: 'RUNNING',
    runId: 'active-run', planSnapshot: { planId: 'plan-active-delete' }, updatedAt: '2026-09-16T00:00:00.000Z'
  });
  try {
    await assert.rejects(() => pipeline.deletePlan('plan-active-delete'), /仍有生产任务在排队、提交或运行中/);
    const deleted = await pipeline.deletePlan('plan-record-delete');
    assert.equal(deleted.status, 'DELETED');
    assert.equal(deleted.filePreserved, true);
    assert.equal(pipeline.plans().some((plan) => plan.planId === 'plan-record-delete'), false);
    const task = pipeline.list('plan-record-delete')[0];
    assert.equal(task.planDeleted, true);
    assert.equal(task.planKey, 'PLAN-PLAN-REC');
    const saved = JSON.parse(await readFile(statePath, 'utf8'));
    assert.deepEqual(saved.deletedPlanIds, ['plan-record-delete']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a safety-blocked first outfit can recover with the Seedream route and exact 3:4 dimensions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dressbattle-first-outfit-retry-'));
  const originalFetch = globalThis.fetch;
  const image = pngAtSize(1536, 2048);
  const requests = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url === 'https://images.test/master.png') return new Response(onePixelPng, { status: 200, headers: { 'Content-Type': 'image/png' } });
    if (url === 'https://images.test/outfit.png') return new Response(image, { status: 200, headers: { 'Content-Type': 'image/png' } });
    if (url !== 'https://agent.test/workflows/run') throw new Error(`Unexpected request in test fixture: ${url}`);
    const payload = JSON.parse(init.body); requests.push(payload);
    const sourceUrl = payload.inputs.prompt.startsWith('Create one original full-body character portrait') ? 'https://images.test/master.png' : 'https://images.test/outfit.png';
    return new Response(JSON.stringify({ data: [{ url: sourceUrl }] }), { status: 200, headers: { 'Content-Type': 'application/json', 'x-request-id': `image-${requests.length}` } });
  };
  const plan = { ...createPalResourcePlan({ prompt: '一位暗夜摩登的成年虚构牌友墨鸢，28岁女性，穿黑曜石立领晚宴西装裙与深酒红披肩，气质冷静自信', packageTier: 'launch' }), planId: 'plan-first-outfit-revised-prompt' };
  const pipeline = new PalResourcePipeline({
    assetDir: join(dir, 'assets'), statePath: join(dir, 'state.json'),
    env: testImageEnv()
  });
  try {
    await pipeline.submit({ plan });
    await Promise.all([...pipeline.locks.values()]);
    await pipeline.confirmPortrait(plan);
    pipeline.tasks.set('old-first-outfit-failure', {
      taskId: 'old-first-outfit-failure', planId: plan.planId, resourceId: 'first-outfit', label: '首套服装写真卡面（3:4）', kind: 'image',
      planSnapshot: plan, status: 'FAILED', attempt: 2, retryLocked: true, updatedAt: '2026-09-16T00:00:00.000Z', error: 'safety_violations=[sexual]'
    });
    await pipeline.persist();
    const submission = await pipeline.submit({ plan, resourceIds: ['first-outfit'] });
    assert.equal(submission.status, 'SUBMITTED');
    await Promise.all([...pipeline.locks.values()]);

    const request = requests.at(-1);
    assert.equal(request.appId, 'jimeng-test');
    assert.equal(request.inputs.aspect_ratio, '1728x2304');
    assert.match(request.inputs.prompt, /Use the clothing described in the user brief/, 'first-outfit prompt must follow the plan wardrobe');
    assert.doesNotMatch(request.inputs.prompt, /black high-collar tailored evening jacket-dress|burgundy shawl/i, 'retired fixed wardrobe template must be gone');
    assert.doesNotMatch(request.inputs.prompt, /nudity|revealing|sexual|school uniform|minor|child/i);
    const task = pipeline.list(plan.planId).find((entry) => entry.resourceId === 'first-outfit' && entry.taskId !== 'old-first-outfit-failure');
    assert.ok(task.status === 'SUCCEEDED', task.error || 'task failed without an error');
    assert.equal(task.attempt, 1);
    assert.equal(task.promptRevision, 'plan-wardrobe-3-4-v3');
    assert.equal(task.previousTaskId, 'old-first-outfit-failure');
    assert.equal(task.width, 1536);
    assert.equal(task.height, 2048);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test('role profile cards stay on Image 2 while downstream images use Seedream directly', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dressbattle-image2-seedream-fallback-'));
  const originalFetch = globalThis.fetch;
  const requests = [];
  const outfitBytes = pngAtSize(1536, 2048);
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url === 'https://images.test/master.png') return new Response(pngAtSize(1920, 2560), { status: 200, headers: { 'Content-Type': 'image/png' } });
    if (url === 'https://images.test/outfit.png') return new Response(outfitBytes, { status: 200, headers: { 'Content-Type': 'image/png' } });
    if (url !== 'https://agent.test/workflows/run') throw new Error(`Unexpected request in test fixture: ${url}`);
    const payload = JSON.parse(init.body); requests.push(payload);
    if (payload.appId === 'gpt-image2-test' && payload.inputs.size === '1536x2048') {
      return new Response(JSON.stringify({ error: { message: 'Your request was rejected by the safety system; safety_violations=[sexual].' } }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const sourceUrl = payload.appId === 'jimeng-test' ? 'https://images.test/outfit.png' : 'https://images.test/master.png';
    return new Response(JSON.stringify({ data: [{ url: sourceUrl }] }), { status: 200, headers: { 'Content-Type': 'application/json', 'x-request-id': `image-${requests.length}` } });
  };
  const plan = { ...createPalResourcePlan({ prompt: '一位复古优雅的成年虚构牌友，喜欢蓝紫色灯光', packageTier: 'mvp' }), planId: 'plan-image2-seedream-fallback' };
  const pipeline = new PalResourcePipeline({
    assetDir: join(dir, 'assets'), statePath: join(dir, 'state.json'),
    env: testImageEnv({ PAL_DANCE_WORKFLOW_APP_ID: 'test-app' })
  });
  try {
    await pipeline.submit({ plan });
    await Promise.all([...pipeline.locks.values()]);
    assert.equal(requests[0].appId, 'gpt-image2-test', 'role profile card must always use the AIHub gpt-image2 workflow');
    await pipeline.confirmPortrait(plan);
    const submission = await pipeline.submit({ plan, resourceIds: ['first-outfit'] });
    assert.equal(submission.status, 'SUBMITTED');
    await Promise.all([...pipeline.locks.values()]);
    pipeline.lastRefreshAt = 0;
    await pipeline.refresh();
    await Promise.all([...pipeline.locks.values()]);
    const task = pipeline.list(plan.planId).find((entry) => entry.resourceId === 'first-outfit');
    assert.ok(task.status === 'SUCCEEDED', task.error || 'task failed without an error');
    assert.equal(task.model, 'jimeng');
    assert.equal(task.fallbackUsed, false);
    assert.equal(requests.map((request) => request.appId).join(','), 'gpt-image2-test,jimeng-test');
    assert.equal(requests.find((request) => request.appId === 'jimeng-test').inputs.image_urls, 'https://images.test/master.png', 'downstream image nodes must receive the confirmed role-profile URL');
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test('old low-resolution master portrait failures recover with Image 2 at the gateway pixel floor', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dressbattle-master-size-recovery-'));
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input, init = {}) => {
    if (String(input) !== 'https://agent.test/workflows/run') throw new Error(`Unexpected request in test fixture: ${String(input)}`);
    const payload = JSON.parse(init.body); requests.push(payload);
    assert.equal(payload.appId, 'gpt-image2-test');
    assert.equal(payload.inputs.size, '2160x3840');
    return new Response(JSON.stringify({ data: [{ b64_json: pngAtSize(1920, 2560).toString('base64') }] }), { status: 200, headers: { 'Content-Type': 'application/json', 'x-request-id': 'master-recovery' } });
  };
  const plan = { ...createPalResourcePlan({ prompt: '一位复古优雅的成年虚构牌友，喜欢蓝紫色灯光', packageTier: 'launch' }), planId: 'plan-master-size-recovery' };
  const pipeline = new PalResourcePipeline({
    assetDir: join(dir, 'assets'), statePath: join(dir, 'state.json'),
    env: testImageEnv()
  });
  try {
    pipeline.tasks.set('old-master-size-failure', {
      taskId: 'old-master-size-failure', planId: plan.planId, resourceId: 'master-portrait', label: '主立绘 / 基础层（3:4 透明）', kind: 'image',
      planSnapshot: plan, status: 'FAILED', attempt: 2, retryLocked: true, updatedAt: '2026-09-16T00:00:00.000Z', error: 'The parameter size specified in the request is not valid: image size must be at least 3686400 pixels.'
    });
    await pipeline.persist();
    const submission = await pipeline.submit({ plan, resourceIds: ['master-portrait'] });
    assert.equal(submission.status, 'PORTRAIT_SUBMITTED');
    await Promise.all([...pipeline.locks.values()]);
    const task = pipeline.list(plan.planId).find((entry) => entry.taskId !== 'old-master-size-failure');
    assert.equal(task.status, 'SUCCEEDED');
    assert.equal(task.strategyVersion, 'aihub-image-v2');
    assert.equal(requests.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test('confirmed downstream Seedance tasks use the role-profile image URL without the dance workflow reference video', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dressbattle-dance-reference-'));
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const method = init.method || 'GET';
    requests.push({ url, method, body: init.body ? JSON.parse(init.body) : null });
    if (url === 'https://agent.test/workflows/run' && ['gpt-image2-test', 'jimeng-test'].includes(JSON.parse(init.body || '{}').appId)) return new Response(JSON.stringify({ data: [{ url: 'https://images.test/portrait.png' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (url === 'https://images.test/portrait.png') return new Response(onePixelPng, { status: 200, headers: { 'Content-Type': 'image/png' } });
    if (url === 'https://agent.test/workflows/run' && JSON.parse(init.body || '{}').appId === 'seedance-test') return new Response(JSON.stringify({ runId: 'seedance-run-fixture', status: 'running' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (url === 'https://agent.test/workflows/run') return new Response(JSON.stringify({ runId: 'dance-run-fixture', status: 'running' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    throw new Error(`Unexpected request in test fixture: ${url} ${method}`);
  };
  const plan = { ...createPalResourcePlan({ prompt: '一位复古优雅的成年虚构舞台魔术师，喜欢蓝紫色灯光', packageTier: 'launch' }), planId: 'plan-seedance-reference-url' };
  const pipeline = new PalResourcePipeline({
    assetDir: join(dir, 'assets'), statePath: join(dir, 'pipeline-state.json'),
    env: testImageEnv()
  });
  try {
    const first = await pipeline.submit({ plan });
    assert.equal(first.status, 'PORTRAIT_SUBMITTED');
    await Promise.all([...pipeline.locks.values()]);
    assert.equal(requests.some((request) => request.url.endsWith('/workflows/run') && request.body?.appId === 'seedance-test'), false);

    await pipeline.confirmPortrait(plan);
    const videoTask = await pipeline.submit({ plan, resourceIds: ['entry-film'] });
    assert.equal(videoTask.status, 'SUBMITTED');
    assert.equal(videoTask.tasks[0].status, 'WAITING_REFERENCE');
    await pipeline.refresh();
    await Promise.all([...pipeline.locks.values()]);

    const workflowRequest = requests.find((request) => request.url === 'https://agent.test/workflows/run' && request.body?.appId === 'seedance-test');
    assert.ok(workflowRequest, 'a single AIHub task should be started after the approval gate');
    assert.equal(workflowRequest.body.inputs.image_url_list, 'https://images.test/portrait.png');
    assert.equal(workflowRequest.body.inputs.Production_method, '全能参考');
    assert.equal(workflowRequest.body.inputs.duration, '4');
    assert.equal(pipeline.list(plan.planId).find((task) => task.resourceId === 'entry-film').runId, 'seedance-run-fixture');
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test('video nodes use the correct confirmed image reference for their role', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dressbattle-outfit-film-reference-'));
  const originalFetch = globalThis.fetch;
  const requests = [];
  const referenceVideoUrl = 'https://video.test/my-reference.mp4';
  const masterUrl = 'https://images.test/master.png';
  const outfitUrl = 'https://images.test/first-outfit.png';
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    requests.push({ url, method, body });
    if (url === 'https://agent.test/workflows/run' && body?.appId !== 'test-app') {
      const sourceUrl = body.appId === 'gpt-image2-test' ? masterUrl : outfitUrl;
      return new Response(JSON.stringify({ data: [{ url: sourceUrl }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url === masterUrl) return new Response(onePixelPng, { status: 200, headers: { 'Content-Type': 'image/png' } });
    if (url === outfitUrl) return new Response(pngAtSize(1536, 2048), { status: 200, headers: { 'Content-Type': 'image/png' } });
    if (url === referenceVideoUrl && method === 'HEAD') return new Response(null, { status: 200, headers: { 'Content-Type': 'video/mp4' } });
    if (url === 'https://agent.test/workflows/run') return new Response(JSON.stringify({ runId: 'outfit-film-run-fixture', status: 'running' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    throw new Error(`Unexpected request in test fixture: ${url} ${method}`);
  };
  const plan = { ...createPalResourcePlan({ prompt: '一位暗夜摩登的成年虚构牌友墨鸢，气质冷静自信', packageTier: 'launch', clothingStyle: 'maid', accessory: 'bunny-ears' }), planId: 'plan-outfit-film-reference', danceReferenceVideoUrl: referenceVideoUrl };
  const pipeline = new PalResourcePipeline({
    assetDir: join(dir, 'assets'), statePath: join(dir, 'pipeline-state.json'),
    env: testImageEnv({ PAL_DANCE_WORKFLOW_APP_ID: 'test-app' })
  });
  try {
    await pipeline.submit({ plan });
    await Promise.all([...pipeline.locks.values()]);
    await pipeline.confirmPortrait(plan);
    await pipeline.submit({ plan, resourceIds: ['first-outfit'] });
    await Promise.all([...pipeline.locks.values()]);
    const firstOutfit = pipeline.list(plan.planId).find((task) => task.resourceId === 'first-outfit');
    assert.equal(firstOutfit.status, 'SUCCEEDED');

    await pipeline.submit({ plan, resourceIds: ['outfit-film'] });
    await pipeline.refresh();
    await Promise.all([...pipeline.locks.values()]);
    const workflowRequest = requests.find((request) => request.url === 'https://agent.test/workflows/run' && request.body?.appId === 'test-app');
    assert.ok(workflowRequest, 'the AIHub outfit-film task should start after the first outfit is complete');
    assert.equal(workflowRequest.body.inputs.image_url, outfitUrl);
    assert.notEqual(workflowRequest.body.inputs.image_url, masterUrl);
    assert.match(workflowRequest.body.inputs.prompt, /clothing=优雅女仆装/);
    assert.match(workflowRequest.body.inputs.prompt, /accessory=兔耳朵发饰/);
    assert.match(workflowRequest.body.inputs.prompt, /CHARACTER AND OUTFIT CONSISTENCY LOCK/);
    assert.match(workflowRequest.body.inputs.prompt, /VIDEO REFERENCE LOCK/);

    const blockedPlan = { ...plan, planId: 'plan-outfit-film-no-public-reference' };
    const blocked = new PalResourcePipeline({
      assetDir: join(dir, 'blocked-assets'), statePath: join(dir, 'blocked-state.json'),
      env: testImageEnv({ PAL_DANCE_WORKFLOW_APP_ID: 'test-app' })
    });
    await blocked.ready;
    const baseTask = (resourceId, sourceUrl) => ({ taskId: `${resourceId}-fixture`, planId: blockedPlan.planId, resourceId, kind: 'image', status: 'SUCCEEDED', sourceUrl, updatedAt: new Date().toISOString(), planSnapshot: blockedPlan });
    const blockedMaster = { ...baseTask('master-portrait', null), publicUrl: '/assets/pals/ugc/master.png', sha256: 'fixture-sha', bytes: 1 };
    blocked.tasks.set('master-portrait-fixture', blockedMaster);
    blocked.tasks.set('first-outfit-fixture', baseTask('first-outfit', null));
    blocked.portraitApprovals.set(blockedPlan.planId, { planId: blockedPlan.planId, taskId: blockedMaster.taskId, sha256: blockedMaster.sha256, confirmedAt: new Date().toISOString() });
    const beforeBlocked = requests.filter((request) => request.url === 'https://agent.test/workflows/run').length;
    const blockedResult = await blocked.submit({ plan: blockedPlan, resourceIds: ['outfit-film'] });
    assert.equal(blockedResult.status, 'PORTRAIT_REQUIRED');
    assert.equal(blocked.list(blockedPlan.planId).some((task) => task.resourceId === 'outfit-film'), false, 'without a profile URL the confirmation gate must prevent any video task');
    assert.equal(requests.filter((request) => request.url === 'https://agent.test/workflows/run').length, beforeBlocked, 'missing first outfit URL must not submit a fallback video task');
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test('a rejected resource is marked, loses seat gating, and rework submits a fresh attempt', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pipeline-reject-'));
  try {
    const statePath = join(dir, 'state.json');
    const planSnapshot = {
      planId: 'plan-r', identity: { suffix: 9, version: 1, name: '打回测试' },
      intent: { style: '舞台轻奢', sourceText: '一位测试用的成年虚构牌友' },
      resources: [
        { id: 'master-portrait', kind: 'image', label: '角色资料卡', requiredForSeat: true },
        { id: 'table-standee', kind: 'image', label: '牌桌立绘', requiredForSeat: true }
      ]
    };
    await writeFile(statePath, JSON.stringify({ version: 3,
      portraitApprovals: [{ planId: 'plan-r', taskId: 'master-1', sha256: 'abc123', confirmedAt: '2026-09-18T00:00:00.000Z' }],
      tasks: [
        { taskId: 'master-1', planId: 'plan-r', resourceId: 'master-portrait', kind: 'image', status: 'SUCCEEDED', publicUrl: '/assets/pals/ugc/plan-r-master.png', sourceUrl: 'https://cdn.test/master.png', sha256: 'abc123', attempt: 1, updatedAt: '2026-09-18T00:00:00.000Z', planSnapshot },
        { taskId: 'table-1', planId: 'plan-r', resourceId: 'table-standee', kind: 'image', status: 'SUCCEEDED', publicUrl: '/assets/pals/ugc/plan-r-table.png', referenceResourceId: 'master-portrait', profileReferenceUrl: 'https://cdn.test/master.png', attempt: 1, updatedAt: '2026-09-18T00:00:01.000Z', planSnapshot },
        { taskId: 'sheet-1', planId: 'plan-r', resourceId: 'action-sheet', kind: 'image', status: 'SUCCEEDED', publicUrl: '/assets/pals/ugc/plan-r-sheet.png', attempt: 1, updatedAt: '2026-09-18T00:00:02.000Z', planSnapshot, derivedImages: { A01: { publicUrl: '/assets/pals/ugc/plan-r-sheet-A01.png', reviewStatus: 'AWAITING_REVIEW' } } }
      ] }), 'utf8');
    const pipeline = new PalResourcePipeline({ assetDir: join(dir, 'assets'), statePath, env: testImageEnv() });
    await pipeline.ready;

    const { task: rejected } = await pipeline.rejectResource('table-1', { reason: '构图裁坏' });
    assert.equal(rejected.reviewStatus, 'REJECTED');
    assert.match(rejected.reviewNote, /构图裁坏/);
    const { task: rejectedSheet } = await pipeline.rejectResource('sheet-1', {});
    assert.equal(rejectedSheet.derivedImages.A01.reviewStatus, 'REJECTED', 'derived split images are rejected together');

    const plan = { ...planSnapshot };
    assert.equal(await pipeline.tryPromote(plan), null, 'a rejected required resource must block seat promotion');

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('network disabled in test'); };
    try {
      await pipeline.submit({ plan, resourceIds: ['table-standee'] });
      /* 图片任务的工作在后台锁中推进（submitResource 不等待），等它收敛后再断言。 */
      await Promise.allSettled([...pipeline.locks.values()]);
      await new Promise((resolve) => setTimeout(resolve, 150));
      const attempts = pipeline.list('plan-r').filter((task) => task.resourceId === 'table-standee');
      const fresh = attempts.find((task) => task.previousTaskId === 'table-1');
      assert.ok(fresh, 'rework must create a fresh attempt chained to the rejected task');
      assert.notEqual(fresh.taskId, 'table-1');
      assert.ok(['FAILED', 'RETRY_WAITING'].includes(fresh.status));
    } finally {
      globalThis.fetch = originalFetch;
    }
    await assert.rejects(() => pipeline.rejectResource('no-such-task', {}), /只有已完成的资源可以打回/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('restart reruns a failed task in place and fetches outputs for a stuck running task', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pipeline-restart-'));
  const originalFetch = globalThis.fetch;
  try {
    const statePath = join(dir, 'state.json');
    const planSnapshot = {
      planId: 'plan-r2', identity: { suffix: 7, version: 1, name: '重启测试' },
      intent: { style: '舞台轻奢', sourceText: '重启用测试牌友' },
      resources: [
        { id: 'master-portrait', kind: 'image', label: '角色资料卡', requiredForSeat: true },
        { id: 'first-outfit', kind: 'image', label: '首套服装写真卡面', requiredForSeat: true },
        { id: 'entry-film', kind: 'video', label: '入场视频', requiredForSeat: true }
      ]
    };
    await writeFile(statePath, JSON.stringify({ version: 3,
      portraitApprovals: [{ planId: 'plan-r2', taskId: 'm-1', sha256: 'abc123', confirmedAt: '2026-09-20T00:00:00.000Z' }],
      tasks: [
        { taskId: 'm-1', planId: 'plan-r2', resourceId: 'master-portrait', kind: 'image', status: 'SUCCEEDED', publicUrl: '/assets/pals/ugc/r2-master.png', sourceUrl: 'https://cdn.test/m.png', sha256: 'abc123', attempt: 1, updatedAt: '2026-09-20T00:00:00.000Z', planSnapshot },
        { taskId: 'fo-1', planId: 'plan-r2', resourceId: 'first-outfit', kind: 'image', status: 'FAILED', error: '无效的令牌', attempt: 2, retryLocked: true, referenceResourceId: 'master-portrait', profileReferenceUrl: 'https://cdn.test/m.png', updatedAt: '2026-09-20T00:00:01.000Z', planSnapshot },
        { taskId: 'entry-1', planId: 'plan-r2', resourceId: 'entry-film', kind: 'video', status: 'RUNNING', runId: 'run-123', providerRequestId: 'run-123', provider: 'aihub-seedance', route: 'aihub:seedance', transport: 'aihub-agent', updatedAt: '2026-09-20T00:00:02.000Z', planSnapshot }
      ] }), 'utf8');
    const pipeline = new PalResourcePipeline({ assetDir: join(dir, 'assets'), statePath, env: testImageEnv() });
    await pipeline.ready;

    /* 本用例覆盖“重启后取回已有 run”，不是 ffprobe 集成；下游 HTTP 夹具故意使用
       极小伪字节，单独的视频规格用真实媒体样本覆盖。保持恢复语义不被容器解析细节干扰。 */
    pipeline.inspectEntryVideo = async (task) => {
      task.width = 1920; task.height = 1080; task.durationMs = 4000; task.presentation = 'landscape';
    };

    /* 1) 失败任务：原地重启——同一 taskId、attempt+1、不新增任务记录，并立即真实开工 */
    globalThis.fetch = async () => { throw new Error('network disabled in test'); };
    const restarted = await pipeline.restartResource('fo-1', { promptPatch: 'remove every white matte', reason: 'visual alpha review failed' });
    assert.equal(restarted.taskId, 'fo-1');
    assert.equal(restarted.attempt, 3);
    assert.equal(restarted.retryLocked, false);
    assert.equal(restarted.promptPatch, 'remove every white matte');
    assert.match(restarted.reviewNote, /visual alpha review failed/);
    assert.equal(pipeline.tasks.size, 3, 'restart must not create new task records');
    await Promise.allSettled([...pipeline.locks.values()]);
    await new Promise((resolve) => setTimeout(resolve, 120));
    const after = pipeline.tasks.get('fo-1');
    assert.ok(['RETRY_WAITING', 'FAILED'].includes(after.status), `restart kicked real work, got ${after.status}`);
    assert.equal(after.attempt, 3, 'attempt lineage stays on the same task');

    /* 2) 卡住 RUNNING 任务：按当前 run 取回现成产物，不重新扣费、不加 attempt */
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.endsWith('/workflows/runs/run-123/outputs')) return new Response(JSON.stringify({ data: { outputs: { video_url: 'https://cdn.test/a01.mp4' } } }), { status: 200 });
      if (u.includes('/workflows/runs/run-123')) return new Response(JSON.stringify({ status: 'succeeded' }), { status: 200 });
      if (u === 'https://cdn.test/a01.mp4') return new Response(Buffer.from('fake-video-bytes'), { status: 200, headers: { 'Content-Type': 'video/mp4' } });
      throw new Error(`unexpected fetch: ${u}`);
    };
    const fetched = await pipeline.restartResource('entry-1');
    assert.equal(fetched.status, 'SUCCEEDED');
    assert.ok(fetched.publicUrl?.endsWith('.mp4'));
    assert.equal(pipeline.tasks.get('entry-1').attempt ?? 0, 0, 'fetch-now must not burn a new attempt');

    /* 3) 已成功任务不允许原地重启（那是打回重产的入口） */
    await assert.rejects(() => pipeline.restartResource('m-1'), /已成功的资源请用打回重产/);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test('continue-production is idempotent for succeeded legacy resources, but follows a truly changed reference', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pipeline-idempotent-'));
  const originalFetch = globalThis.fetch;
  try {
    const statePath = join(dir, 'state.json');
    const planSnapshot = {
      planId: 'plan-idem', identity: { suffix: 8, version: 1, name: '幂等测试' },
      intent: { style: '舞台轻奢', sourceText: '幂等用测试牌友' },
      resources: [
        { id: 'master-portrait', kind: 'image', label: '角色资料卡', requiredForSeat: true },
        { id: 'table-standee', kind: 'image', label: '牌桌立绘', requiredForSeat: true },
        { id: 'first-outfit', kind: 'image', label: '首套卡面', requiredForSeat: true }
      ]
    };
    const master = { taskId: 'm-1', planId: 'plan-idem', resourceId: 'master-portrait', kind: 'image', status: 'SUCCEEDED', publicUrl: '/assets/pals/ugc/idem-master.png', sourceUrl: 'https://cdn.test/m.png', sha256: 'abc', attempt: 1, promptRevision: 'alpha-transparent-v2', updatedAt: '2026-09-20T00:00:00.000Z', planSnapshot };
    /* 存量任务：无 referenceResourceId 记录、旧 promptRevision——绝不允许被「继续生产」重跑。 */
    const legacyStandee = { taskId: 'ts-1', planId: 'plan-idem', resourceId: 'table-standee', kind: 'image', status: 'SUCCEEDED', publicUrl: '/assets/pals/ugc/idem-standee.png', attempt: 1, promptRevision: 'single-table-standee-4-5-v2', updatedAt: '2026-09-20T00:00:01.000Z', planSnapshot };
    /* 参考真的变了的任务：记录过 profileReferenceUrl 且与当前资料卡 URL 不同——必须跟随重跑。 */
    const changedOutfit = { taskId: 'fo-1', planId: 'plan-idem', resourceId: 'first-outfit', kind: 'image', status: 'SUCCEEDED', publicUrl: '/assets/pals/ugc/idem-outfit.png', attempt: 1, referenceResourceId: 'master-portrait', profileReferenceUrl: 'https://cdn.test/OLD-master.png', promptRevision: 'fashion-positive-3-4-v2', updatedAt: '2026-09-20T00:00:02.000Z', planSnapshot };
    await writeFile(statePath, JSON.stringify({ version: 3,
      portraitApprovals: [{ planId: 'plan-idem', taskId: 'm-1', sha256: 'abc', confirmedAt: '2026-09-20T00:00:00.000Z' }],
      tasks: [master, legacyStandee, changedOutfit] }), 'utf8');
    const pipeline = new PalResourcePipeline({ assetDir: join(dir, 'assets'), statePath, env: testImageEnv() });
    await pipeline.ready;

    let fetchCalls = 0;
    globalThis.fetch = async () => { fetchCalls += 1; throw new Error('offline'); };
    const result = await pipeline.submit({ plan: planSnapshot, resourceIds: ['master-portrait', 'table-standee', 'first-outfit'] });
    const byResource = Object.fromEntries(result.tasks.map((task) => [task.resourceId, task]));
    assert.equal(byResource['master-portrait'].taskId, 'm-1', 'succeeded master must be returned as-is');
    assert.equal(byResource['table-standee'].taskId, 'ts-1', 'succeeded legacy standee must not be re-produced for a prompt revision bump');
    assert.equal(pipeline.tasks.size, 4, 'only the truly reference-changed resource may create a new attempt');
    const freshOutfit = [...pipeline.tasks.values()].find((task) => task.resourceId === 'first-outfit' && task.taskId !== 'fo-1');
    assert.ok(freshOutfit, 'a recorded, truly changed reference must trigger a fresh attempt');
    await Promise.allSettled([...pipeline.locks.values()]);
    assert.ok(fetchCalls > 0, 'the fresh attempt does real work (fails offline here)');
    globalThis.fetch = originalFetch;
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test('jimeng aspect ratios stay within the allowed size list for every image resource', () => {
  const pipeline = new PalResourcePipeline({ assetDir: join(tmpdir(), 'ratio-check'), statePath: join(tmpdir(), 'ratio-state.json'), env: {} });
  const allowed = new Set(['2048x2048', '4096x2304', '2304x4096', '2304x1728', '1728x2304', '2848x1600', '1600x2848', '2496x1664', '1664x2496', '3136x1344', '3072x3072', '3456x2592', '2592x3456', '2496x3744', '3744x2496', '4704x2016']);
  for (const id of ['avatar', 'table-standee', 'lounge-standee', 'first-outfit', 'action-sheet', 'outfit-fx', 'outfit-poster']) {
    const ratio = pipeline.jimengAspectRatio({ id });
    assert.ok(allowed.has(ratio), `${id} aspect_ratio ${ratio} must be accepted by the jimeng app`);
  }
});

test('first-outfit prompt uses the plan wardrobe instead of the retired fixed template', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pipeline-wardrobe-'));
  const originalFetch = globalThis.fetch;
  try {
    const statePath = join(dir, 'state.json');
    const plan = {
      planId: 'plan-wardrobe', identity: { suffix: 6, version: 1, name: '服装计划' },
      intent: { style: '舞台轻奢', sourceText: '一位优雅女仆装风格的成年虚构牌友', clothingLabel: '优雅女仆装', accessoryLabel: '无' },
      profileCard: { character: { name: '服装计划' }, clothing: { label: '优雅女仆装', prompt: 'an elegant adult maid-inspired dress with crisp white trim, tasteful apron details and refined tailoring' }, accessory: { label: '无', prompt: 'no headwear or novelty accessory' }, actions: { idle: '待机', play: '出牌', pass: '过牌', win: '胜利', lose: '失败' } },
      styleLock: 'style-lock',
      resources: [
        { id: 'master-portrait', kind: 'image', label: '角色资料卡', requiredForSeat: true },
        { id: 'first-outfit', kind: 'image', label: '首套服装写真卡面', requiredForSeat: true }
      ]
    };
    await writeFile(statePath, JSON.stringify({ version: 3,
      portraitApprovals: [{ planId: 'plan-wardrobe', taskId: 'm-1', sha256: 'abc', confirmedAt: '2026-09-20T00:00:00.000Z' }],
      tasks: [{ taskId: 'm-1', planId: 'plan-wardrobe', resourceId: 'master-portrait', kind: 'image', status: 'SUCCEEDED', publicUrl: '/assets/pals/ugc/w-master.png', sourceUrl: 'https://cdn.test/m.png', sha256: 'abc', attempt: 1, updatedAt: '2026-09-20T00:00:00.000Z', planSnapshot: plan }] }), 'utf8');
    const pipeline = new PalResourcePipeline({ assetDir: join(dir, 'assets'), statePath, env: testImageEnv() });
    await pipeline.ready;
    const requests = [];
    globalThis.fetch = async (url, options) => {
      const u = String(url);
      if (u.endsWith('/workflows/run')) {
        requests.push(JSON.parse(options.body));
        return new Response(JSON.stringify({ runId: 'run-w1', data: [{ b64_json: pngAtSize(3, 4).toString('base64') }] }), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${u}`);
    };
    await pipeline.submit({ plan, resourceIds: ['first-outfit'] });
    await Promise.allSettled([...pipeline.locks.values()]);
    assert.equal(requests.length, 1, 'first-outfit must submit one jimeng image request');
    const prompt = requests[0].inputs.prompt;
    assert.ok(prompt.includes('maid-inspired dress'), 'prompt must use the plan wardrobe from profileCard');
    assert.ok(!/burgundy shawl|black high-collar/i.test(prompt), 'the retired fixed wardrobe template must be gone');
    globalThis.fetch = originalFetch;
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test('outfit effect uses a person-free transparent-overlay prompt instead of the character package prompt', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pipeline-outfit-fx-'));
  const originalFetch = globalThis.fetch;
  try {
    const statePath = join(dir, 'state.json');
    const plan = {
      planId: 'plan-outfit-fx', identity: { suffix: 7, version: 1, name: '特效计划' },
      intent: { style: '舞台轻奢', sourceText: '一位成年虚构空姐牌友', clothingLabel: '空姐制服风', accessoryLabel: '猫耳朵发饰' },
      profileCard: { clothing: { prompt: 'an adult airline-uniform-inspired outfit' }, accessory: { prompt: 'cat-ear headband' }, actions: { idle: '待机', play: '出牌' } },
      styleLock: 'midnight-violet style-lock',
      resources: [{ id: 'master-portrait', kind: 'image', label: '角色资料卡', requiredForSeat: true }, { id: 'outfit-fx', kind: 'image', label: '服装特效层', requiredForSeat: false }]
    };
    await writeFile(statePath, JSON.stringify({ version: 3, portraitApprovals: [{ planId: plan.planId, taskId: 'm-1', sha256: 'abc', confirmedAt: '2026-09-22T00:00:00.000Z' }], tasks: [{ taskId: 'm-1', planId: plan.planId, resourceId: 'master-portrait', kind: 'image', status: 'SUCCEEDED', publicUrl: '/assets/pals/ugc/fx-master.png', sourceUrl: 'https://cdn.test/master.png', sha256: 'abc', attempt: 1, updatedAt: '2026-09-22T00:00:00.000Z', planSnapshot: plan }] }), 'utf8');
    const pipeline = new PalResourcePipeline({ assetDir: join(dir, 'assets'), statePath, env: testImageEnv() });
    await pipeline.ready;
    const requests = [];
    globalThis.fetch = async (url, options) => {
      if (String(url).endsWith('/workflows/run')) { requests.push(JSON.parse(options.body)); return new Response(JSON.stringify({ runId: 'run-fx' }), { status: 200 }); }
      if (String(url).includes('/workflows/runs/run-fx')) return new Response(JSON.stringify({ status: 'running' }), { status: 200 });
      throw new Error(`unexpected fetch: ${url}`);
    };
    await pipeline.submit({ plan, resourceIds: ['outfit-fx'] });
    await Promise.allSettled([...pipeline.locks.values()]);
    assert.equal(requests.length, 1);
    const prompt = requests[0].inputs.prompt;
    assert.match(prompt, /EFFECTS ONLY/);
    assert.match(prompt, /Absolutely no person, face, body/);
    assert.match(prompt, /real per-pixel alpha/);
    assert.doesNotMatch(prompt, /Character brief:|Role profile actions:|cat-ear headband/);
    assert.equal(requests[0].inputs.image_urls, undefined, 'effect-only asset must never receive the role-profile image that makes the model redraw a person');
    assert.equal(pipeline.list(plan.planId).find((task) => task.resourceId === 'outfit-fx')?.promptRevision, 'effect-only-transparent-v3');
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test('outfit effect contract revision takes priority over stale local-alpha recovery', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pipeline-outfit-fx-migration-'));
  const originalFetch = globalThis.fetch;
  try {
    const plan = { planId: 'plan-outfit-fx-migration', identity: { suffix: 8, version: 1, name: '特效迁移' }, intent: { style: '舞台轻奢', sourceText: '成年虚构牌友' }, profileCard: {}, styleLock: 'style-lock', resources: [{ id: 'master-portrait', kind: 'image', label: '资料卡', requiredForSeat: true }, { id: 'outfit-fx', kind: 'image', label: '特效层', requiredForSeat: false }] };
    const statePath = join(dir, 'state.json');
    await writeFile(statePath, JSON.stringify({ version: 3, portraitApprovals: [{ planId: plan.planId, taskId: 'master', sha256: 'abc', confirmedAt: '2026-09-22T00:00:00.000Z' }], tasks: [
      { taskId: 'master', planId: plan.planId, resourceId: 'master-portrait', kind: 'image', status: 'SUCCEEDED', publicUrl: '/assets/pals/ugc/master.png', sourceUrl: 'https://cdn.test/master.png', sha256: 'abc', updatedAt: '2026-09-22T00:00:00.000Z', planSnapshot: plan },
      { taskId: 'old-fx', planId: plan.planId, resourceId: 'outfit-fx', kind: 'image', status: 'FAILED', attempt: 2, promptRevision: 'effect-only-transparent-v2', alphaStage: 'REMOVE_BG', alphaSourceUrl: 'https://images.test/old-person-collage.jpg', updatedAt: '2026-09-22T00:00:01.000Z', planSnapshot: plan, error: '透明画布不合格' }
    ] }), 'utf8');
    const pipeline = new PalResourcePipeline({ assetDir: join(dir, 'assets'), statePath, env: testImageEnv() });
    await pipeline.ready;
    const requests = [];
    globalThis.fetch = async (url, options) => {
      if (String(url).endsWith('/workflows/run')) { requests.push(JSON.parse(options.body)); return new Response(JSON.stringify({ runId: 'run-fx-v3' }), { status: 200 }); }
      if (String(url).includes('/workflows/runs/run-fx-v3')) return new Response(JSON.stringify({ status: 'running' }), { status: 200 });
      throw new Error(`unexpected fetch: ${url}`);
    };
    await pipeline.submit({ plan, resourceIds: ['outfit-fx'] });
    await Promise.allSettled([...pipeline.locks.values()]);
    assert.equal(requests.length, 1, 'must submit a fresh Jimeng generation, not download the old source for local alpha repair');
    assert.equal(requests[0].inputs.image_urls, undefined);
    assert.equal(pipeline.list(plan.planId).find((task) => task.resourceId === 'outfit-fx')?.promptRevision, 'effect-only-transparent-v3');
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test('entry-film asks Seedance for landscape 16:9 while action videos stay portrait 3:4', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pipeline-orientation-'));
  const originalFetch = globalThis.fetch;
  try {
    const statePath = join(dir, 'state.json');
    const plan = {
      planId: 'plan-orientation', identity: { suffix: 5, version: 1, name: '方向测试' },
      intent: { style: '舞台轻奢', sourceText: '方向测试用成年虚构牌友' },
      profileCard: { character: { name: '方向测试' }, clothing: { label: '优雅女仆装', prompt: 'maid dress' }, accessory: { label: '无', prompt: 'none' }, actions: { idle: '待机', play: '出牌', pass: '过牌', win: '胜利', lose: '失败' } },
      styleLock: 'style-lock',
      resources: [
        { id: 'master-portrait', kind: 'image', label: '角色资料卡', requiredForSeat: true },
        { id: 'entry-film', kind: 'video', label: '入场视频', requiredForSeat: true },
        { id: 'action-image-A01', kind: 'image', label: 'A01 待机动作图', requiredForSeat: true },
        { id: 'action-a01', kind: 'video', label: 'A01 待机', requiredForSeat: true }
      ]
    };
    await writeFile(statePath, JSON.stringify({ version: 3,
      portraitApprovals: [{ planId: 'plan-orientation', taskId: 'm-1', sha256: 'abc', confirmedAt: '2026-09-20T00:00:00.000Z' }],
      tasks: [
        { taskId: 'm-1', planId: 'plan-orientation', resourceId: 'master-portrait', kind: 'image', status: 'SUCCEEDED', publicUrl: '/assets/pals/ugc/o-master.png', sourceUrl: 'https://cdn.test/m.png', sha256: 'abc', attempt: 1, updatedAt: '2026-09-20T00:00:00.000Z', planSnapshot: plan },
        { taskId: 'a01-image', planId: 'plan-orientation', resourceId: 'action-image-A01', kind: 'image', status: 'SUCCEEDED', publicUrl: '/assets/pals/ugc/o-a01.png', sourceUrl: 'https://cdn.test/a01.png', sha256: 'def', attempt: 1, updatedAt: '2026-09-20T00:00:01.000Z', planSnapshot: plan }
      ] }), 'utf8');
    const pipeline = new PalResourcePipeline({ assetDir: join(dir, 'assets'), statePath, env: testImageEnv() });
    await pipeline.ready;
    const requests = [];
    globalThis.fetch = async (url, options) => {
      const u = String(url);
      if (u.endsWith('/workflows/run')) { requests.push(JSON.parse(options.body)); return new Response(JSON.stringify({ runId: 'run-x' }), { status: 200 }); }
      throw new Error(`unexpected fetch: ${u}`);
    };
    await pipeline.submit({ plan, resourceIds: ['entry-film', 'action-a01'] });
    await pipeline.refresh();
    await Promise.allSettled([...pipeline.locks.values()]);
    const byResource = Object.fromEntries(requests.map((request) => [request.meta.label.split(':').pop(), request.inputs]));
    assert.equal(byResource['entry-film'].Video_specifications, '横屏 16:9', 'entry-film must be landscape');
    assert.equal(byResource['action-a01'].Video_specifications, '竖屏 3:4', 'action videos stay portrait');
    assert.equal(byResource['entry-film'].Production_method, '全能参考', 'entry film expands the profile board into a scene');
    assert.equal(byResource['action-a01'].Production_method, '全能参考', 'action video must use the current Seedance single-image route because the first/last-frame workflow rejects a populated image_url_list as an empty first frame');
    globalThis.fetch = originalFetch;
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});
