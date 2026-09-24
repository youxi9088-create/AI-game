import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PalProductionService } from '../apps/api/pal-production.mjs';
import { DEFAULT_DANCE_REFERENCE_VIDEO_URL } from '../packages/pal-generation-core/index.mjs';

const onePixelPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlJ+WUAAAAASUVORK5CYII=', 'base64');

test('production pipeline writes provider image but keeps the complete package pending', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dressbattle-pal-'));
  const ready = [];
  const service = new PalProductionService({
    assetDir: dir,
    config: { configured: false, providerName: 'test image provider', model: 'test-image-v1', size: '1024x1024' },
    generateImage: async () => ({ buffer: onePixelPng, providerRequestId: 'provider-job-1' }),
    onReady: (candidate) => ready.push(candidate)
  });
  try {
    const queued = service.createJob({ prompt: '一位复古优雅的成年虚构舞台魔术师，喜欢蓝紫色灯光', version: 1 });
    assert.equal(queued.status, 'QUEUED');
    const job = await service.awaitJob(queued.jobId);
    assert.equal(job.status, 'ASSET_PENDING');
    assert.equal(ready.length, 0);
    assert.equal(job.candidate.asset.readiness, 'DEGRADED_READY');
    assert.match(job.candidate.asset.appearance.portraitRef, /^\/assets\/pals\/ugc\/[\w-]+\.png$/);
    assert.equal(job.candidate.asset.appearance.avatarRef, null);
    assert.equal(job.candidate.asset.appearance.tableStandeeRef, null);
    assert.equal(job.candidate.asset.appearance.outfitLibrary[0].outfitId, 'starter-look');
    assert.ok(job.candidate.asset.dialoguePack.play.length >= 3);
    assert.equal(job.candidate.package.tier, 'launch');
    const fileName = job.candidate.asset.appearance.portraitRef.split('/').at(-1);
    assert.deepEqual(await readFile(join(dir, fileName)), onePixelPng);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('production pipeline rejects safe prompts when no provider is configured instead of using Mock', () => {
  const service = new PalProductionService({ assetDir: join(tmpdir(), 'unused-pal-assets') });
  const result = service.createJob({ prompt: '一位复古优雅的成年虚构舞台魔术师，喜欢蓝紫色灯光', version: 1 });
  assert.equal(result.status, 'PROVIDER_UNAVAILABLE');
  assert.equal(result.gate, 'PL-PROVIDER');
});

test('dance reference video is user-overridable and defaults to the supplied CS video', () => {
  const service = new PalProductionService({ assetDir: join(tmpdir(), 'unused-pal-reference') });
  const prompt = '一位复古优雅的成年虚构舞台魔术师，喜欢蓝紫色灯光';
  assert.equal(service.createPlan({ prompt }).danceReferenceVideoUrl, DEFAULT_DANCE_REFERENCE_VIDEO_URL);
  assert.equal(service.createPlan({ prompt, videoReferenceUrl: 'https://cdn.example.test/my-dance.mp4' }).danceReferenceVideoUrl, 'https://cdn.example.test/my-dance.mp4');
  assert.equal(service.createPlan({ prompt, videoReferenceUrl: 'http://example.test/not-secure.mp4' }).gate, 'PL-REFERENCE');
});

test('launch package writes only its completed master portrait and never promotes a partial pack', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dressbattle-pal-launch-'));
  const ready = [];
  const service = new PalProductionService({
    assetDir: dir,
    config: { configured: false, providerName: 'test image provider', model: 'test-image-v1', size: '1024x1024' },
    generateImage: async () => ({ buffer: onePixelPng }),
    onReady: (candidate) => ready.push(candidate)
  });
  try {
    const queued = service.createJob({ prompt: '一位复古优雅的成年虚构舞台魔术师，喜欢蓝紫色灯光', version: 1, packageTier: 'launch' });
    const job = await service.awaitJob(queued.jobId);
    assert.equal(job.status, 'ASSET_PENDING');
    assert.equal(job.active, false);
    assert.equal(ready.length, 0);
    assert.equal(job.candidate.package.state, 'ASSET_PENDING');
    assert.equal(job.resourcePlan.resources.filter((entry) => entry.kind === 'video').length, 7);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
