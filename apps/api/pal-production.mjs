import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createProductionCandidate, createPalResourcePlan, DEFAULT_DANCE_REFERENCE_VIDEO_URL } from '../../packages/pal-generation-core/index.mjs';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
/* ASSET_PENDING 是等待外部视频生产能力/人工验收的稳定停点，不是仍在跑的后台任务。
   若把它算作 active，前端会每 900ms 无止境轮询，反而掩盖真正的资源缺口。 */
const ACTIVE_STAGES = new Set(['QUEUED', 'GENERATING', 'AUDITING']);

function publicJob(job) {
  const { completion, imageBuffer, ...safe } = job;
  return { ...safe, active: ACTIVE_STAGES.has(job.stage) };
}

function providerConfigFromEnv(env = process.env) {
  const url = String(env.PAL_IMAGE_API_URL || '').trim();
  const apiKey = String(env.PAL_IMAGE_API_KEY || '').trim();
  const model = String(env.PAL_IMAGE_MODEL || '').trim();
  return {
    configured: Boolean(url && apiKey && model),
    url,
    apiKey,
    model,
    size: String(env.PAL_IMAGE_SIZE || '1024x1024').trim(),
    providerName: String(env.PAL_IMAGE_PROVIDER_NAME || 'OpenAI-compatible image API').trim()
  };
}

function imageBufferFromResponse(payload) {
  const image = payload?.data?.[0];
  if (typeof image?.b64_json === 'string' && image.b64_json.length > 0) return { buffer: Buffer.from(image.b64_json, 'base64'), source: 'b64_json' };
  if (typeof image?.url === 'string' && image.url.length > 0) return { url: image.url, source: 'url' };
  throw new Error('图像 Provider 响应缺少 data[0].b64_json 或 data[0].url。');
}

async function downloadImage(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') throw new Error('图像 Provider 返回的下载地址必须使用 HTTPS。');
  const response = await fetch(parsed, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`图像文件下载失败（HTTP ${response.status}）。`);
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > MAX_IMAGE_BYTES) throw new Error('图像文件超过 10 MB 上限。');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) throw new Error('图像文件为空或超过 10 MB 上限。');
  return buffer;
}

async function callOpenAICompatibleImageApi(config, prompt) {
  const response = await fetch(config.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({ model: config.model, prompt, size: config.size, response_format: 'b64_json' }),
    signal: AbortSignal.timeout(90_000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `图像 Provider 请求失败（HTTP ${response.status}）。`);
  const output = imageBufferFromResponse(payload);
  const buffer = output.buffer || await downloadImage(output.url);
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) throw new Error('图像产物为空或超过 10 MB 上限。');
  return { buffer, providerRequestId: response.headers.get('x-request-id') || payload?.id || null, source: output.source };
}

export class PalProductionService {
  constructor({ assetDir, assetUrlPrefix = '/assets/pals/ugc', config = providerConfigFromEnv(), generateImage = null, onReady = () => {} } = {}) {
    if (!assetDir) throw new Error('PalProductionService requires assetDir.');
    this.assetDir = assetDir;
    this.assetUrlPrefix = assetUrlPrefix.replace(/\/$/, '');
    this.config = config;
    this.generateImage = generateImage;
    this.onReady = onReady;
    this.jobs = new Map();
  }

  capability() {
    return { configured: Boolean(this.generateImage || this.config.configured), providerName: this.config.providerName, model: this.config.configured ? this.config.model : null, imageSize: this.config.size };
  }

  createPlan({ prompt, version, packageTier = 'launch', videoReferenceUrl = '', name = '', clothingStyle = 'described', accessory = 'none' }) {
    const plan = createPalResourcePlan({ prompt, version, packageTier, name, clothingStyle, accessory });
    if (plan.status !== 'PLANNED') return plan;
    const danceReferenceVideoUrl = String(videoReferenceUrl || DEFAULT_DANCE_REFERENCE_VIDEO_URL).trim();
    let parsed;
    try { parsed = new URL(danceReferenceVideoUrl); } catch { return { status: 'BLOCKED', gate: 'PL-REFERENCE', reason: '参考舞蹈视频必须是 HTTPS 公网 URL；留空会使用默认参考视频。' }; }
    if (parsed.protocol !== 'https:') return { status: 'BLOCKED', gate: 'PL-REFERENCE', reason: '参考舞蹈视频必须使用 HTTPS；留空会使用默认参考视频。' };
    return { ...plan, danceReferenceVideoUrl, planId: randomUUID(), createdAt: new Date().toISOString(), provider: this.capability() };
  }

  createJob({ prompt, version, packageTier = 'launch', name = '', clothingStyle = 'described', accessory = 'none' }) {
    const plan = this.createPlan({ prompt, version, packageTier: 'launch', name, clothingStyle, accessory });
    if (plan.status === 'BLOCKED') return plan;
    if (!this.generateImage && !this.config.configured) {
      return { status: 'PROVIDER_UNAVAILABLE', gate: 'PL-PROVIDER', reason: '未配置真实图像 Provider。设置 PAL_IMAGE_API_URL、PAL_IMAGE_API_KEY、PAL_IMAGE_MODEL 后才会发起生成；系统不会回退为 Mock。' };
    }
    const job = {
      jobId: randomUUID(),
      stage: 'QUEUED',
      status: 'QUEUED',
      version,
      submittedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      trace: ['intent-gate: passed', 'job: queued'],
      promptSummary: plan.intent.style,
      packageTier: plan.packageTier,
      resourcePlan: plan,
      candidate: null,
      error: null,
      provider: { name: this.config.providerName, model: this.config.model || 'injected-test-provider', requestId: null }
    };
    this.jobs.set(job.jobId, job);
    job.completion = Promise.resolve().then(() => this.runJob(job, plan));
    return publicJob(job);
  }

  getJob(jobId) { return this.jobs.has(jobId) ? publicJob(this.jobs.get(jobId)) : null; }
  listJobs() { return [...this.jobs.values()].map(publicJob).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)); }
  deleteJob(jobId) {
    const job = this.jobs.get(String(jobId || ''));
    if (!job) throw new Error('生产任务不存在或已删除。');
    if (ACTIVE_STAGES.has(job.stage)) throw new Error('生产任务仍在排队或运行中，不能删除；请等任务结束后再移除记录。');
    this.jobs.delete(job.jobId);
    return { status: 'DELETED', jobId: job.jobId, filePreserved: Boolean(job.candidate?.asset?.portraitRef) };
  }
  async awaitJob(jobId) { const job = this.jobs.get(jobId); if (!job) return null; await job.completion; return publicJob(job); }

  async runJob(job, plan) {
    try {
      job.stage = 'GENERATING'; job.status = 'GENERATING'; job.updatedAt = new Date().toISOString(); job.trace.push('image-generation: started');
      const result = this.generateImage
        ? await this.generateImage({ prompt: plan.imagePrompt, model: this.config.model, size: this.config.size })
        : await callOpenAICompatibleImageApi(this.config, plan.imagePrompt);
      const buffer = Buffer.isBuffer(result?.buffer) ? result.buffer : Buffer.from(result?.buffer || result);
      if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) throw new Error('图像产物为空或超过 10 MB 上限。');
      job.stage = 'AUDITING'; job.status = 'AUDITING'; job.updatedAt = new Date().toISOString(); job.trace.push('image-generation: completed', 'asset-audit: started');
      // The source prompt has passed PL-1/PL-7. The output is attached only after a successful binary write.
      await mkdir(this.assetDir, { recursive: true });
      const fileName = `${job.jobId}.png`;
      await writeFile(`${this.assetDir}/${fileName}`, buffer, { flag: 'wx' });
      const imageRef = `${this.assetUrlPrefix}/${fileName}`;
      const candidate = createProductionCandidate({ plan: job.resourcePlan, imageRef, providerRecord: { name: job.provider.name, model: job.provider.model, requestId: result?.providerRequestId || null } });
      job.provider.requestId = result?.providerRequestId || null;
      job.candidate = candidate;
      job.stage = 'ASSET_PENDING'; job.status = 'ASSET_PENDING'; job.updatedAt = new Date().toISOString();
      job.trace.push('master-portrait: ready', 'rich-assets: pending video provider and per-resource validation');
    } catch (error) {
      job.stage = 'FAILED'; job.status = 'FAILED'; job.error = error.message || '生成失败。'; job.updatedAt = new Date().toISOString(); job.trace.push(`failed: ${job.error}`);
    }
  }
}
