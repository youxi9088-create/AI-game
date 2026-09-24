import { mongodb } from '@fn/mongodb';
import { upload } from '@fn/cs/server';
import { ensurePlayablePalette, makeCardDesign, upgradeCardDesign, themes } from '../app/core/themes.js';
import { createPartnerClient } from './partner-client.mjs';
import { createPartnerService, partnerConfig } from './partner-service.mjs';
import { mongoPartnerStore } from './partner-store.mjs';

const AIHUB_BASE = 'https://bv.new.ndhy.com/api/agent/aihub';
const jobs = mongodb.collection('themeGenerationJobs');
const themeRecords = mongodb.collection('generatedThemes');
const partnerState = mongodb.collection('partnerStateV2');
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
const safeError = error => String(error?.message || error || '未知错误').replace(/Bearer\s+\S+/gi, 'Bearer [已隐藏]').replace(/bvk_[A-Za-z0-9_-]+/g, '[令牌已隐藏]').slice(0, 500);
const configured = () => ['AI_GATEWAY_API_KEY', 'AI_GATEWAY_MODEL', 'AIHUB_AGENT_TOKEN', 'AIHUB_JIMENG_APP_ID'].filter(key => !process.env[key]);
const now = () => new Date().toISOString();
const runUrl = runId => `${AIHUB_BASE}/workflows/runs/${encodeURIComponent(runId)}`;
const normalizeStatus = value => ['succeeded', 'success', 'completed', 'done'].includes(String(value || '').toLowerCase()) ? 'succeeded' : ['failed', 'error', 'cancelled', 'canceled'].includes(String(value || '').toLowerCase()) ? 'failed' : 'running';
const TRANSPARENT_ASSET_RULE = '必须输出带 alpha 通道的 PNG 透明背景，主体以外完全透明；禁止纯白背景、白色画布、白色边框或白色贴纸底。';
const config = partnerConfig();
const partnerConfigured = () => Boolean(config.appId && config.secret && config.templates.length && config.publicBase);
const partner = createPartnerService({ store: mongoPartnerStore(partnerState), client: createPartnerClient(), config,
  startJob: (prompt, id) => startThemeJob(prompt, id, true),
  readJob: async id => { const job = await jobs.findOne({ jobId: id }); return job ? publicJob(await refreshJob(job)) : null; },
});

async function sha256(bytes) { const result = await crypto.subtle.digest('SHA-256', bytes); return [...new Uint8Array(result)].map(byte => byte.toString(16).padStart(2, '0')).join(''); }
function alphaChannelPresent(bytes, mime) { const data = new Uint8Array(bytes); return mime === 'image/png' && data.length > 25 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47 && [4, 6].includes(data[25]); }
const assetPresentation = (bytes, mime) => ({ backgroundMode: alphaChannelPresent(bytes, mime) ? 'transparent' : 'opaque', alphaVerified: alphaChannelPresent(bytes, mime), whiteBackgroundRisk: !alphaChannelPresent(bytes, mime), renderPolicy: alphaChannelPresent(bytes, mime) ? 'raster' : 'programmatic-fallback' });
function findUrl(value) {
  if (typeof value === 'string') return /^https:\/\/[^\s]+$/i.test(value) ? value : '';
  if (Array.isArray(value)) return value.map(findUrl).find(Boolean) || '';
  if (!value || typeof value !== 'object') return '';
  for (const key of ['image_url', 'imageUrl', 'image_url_list', 'imageUrls', 'url', 'downloadUrl', 'output']) { const found = findUrl(value[key]); if (found) return found; }
  return Object.values(value).map(findUrl).find(Boolean) || '';
}
function assetPlan(promptText, material) {
  const entries = [
    { id: 'background', kind: 'background', aspect: '4096x2304', prompt: `纸牌游戏桌面横向环境背景，材质与氛围：${material}。中央安静空旷，纯环境与材质纹理，无文字、无数字、无Logo、无水印、没有人物或动物。` },
    { id: 'cardBack', kind: 'cardBack', aspect: '2048x2048', prompt: `正方形可平铺纸牌背面纹样，材质与氛围：${material}。中心对称、纯纹样、无文字、无数字、无Logo、无水印。` },
  ];
  for (const suit of ['S', 'H', 'D', 'C']) entries.push({ id: `suit-${suit}`, kind: 'suitMotif', suit, aspect: '2048x2048', prompt: `单个纸牌花色符号 ${({ S: '黑桃', H: '红桃', D: '方块', C: '梅花' })[suit]}，居中，占满画面80%，${suit === 'H' || suit === 'D' ? '深绯红' : '深炭黑'}纯色填充。${TRANSPARENT_ASSET_RULE}无文字、无数字、无其他元素。` });
  for (let rank = 1; rank <= 13; rank++) { const glyph = ({ 1: 'A', 11: 'J', 12: 'Q', 13: 'K' })[rank] || String(rank); entries.push({ id: `rank-${rank}`, kind: 'rankGlyph', rank, aspect: '2048x2048', prompt: `纸牌点数字形“${glyph}”，只有一个完整粗体字符，深炭黑、居中、占满画面85%、清晰完整。${TRANSPARENT_ASSET_RULE}无其他元素、无水印。` }); }
  for (const suit of ['S', 'H', 'D', 'C']) for (const rank of [11, 12, 13]) entries.push({ id: `face-${suit}${rank}`, kind: 'faceCard', cardId: `${suit}${rank}`, aspect: '2048x2048', prompt: `纸牌头牌插画，主题：${promptText}。装饰性构图，适用于 ${rank === 11 ? 'J' : rank === 12 ? 'Q' : 'K'}。${TRANSPARENT_ASSET_RULE}无文字、无数字、无水印。` });
  return entries;
}
async function gatewaySpec(prompt) {
  const base = String(process.env.AI_GATEWAY_BASE_URL || 'https://ai-gateway.aiae.ndhy.com/v1').replace(/\/$/, '');
  const response = await globalThis.fetch(`${base.endsWith('/v1') ? base : `${base}/v1`}/chat/completions`, { method: 'POST', headers: { authorization: `Bearer ${process.env.AI_GATEWAY_API_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: process.env.AI_GATEWAY_MODEL, response_format: { type: 'json_object' }, messages: [{ role: 'developer', content: '只返回 JSON：title、material、logo、cardStyle、cardShape、palette、generationNotes。palette 含 bg,surface,card,accent,redSuit,blackSuit,text，均六位色值。cardStyle 只能 classic,diner,cyber,ink；cardShape 只能 classic,soft,ticket,gothic,shield,arch,ink,diner。牌面默认使用原来的近白色（建议 #fffdf7），不要把牌桌 surface 或 accent 混入牌面；只有主题确实需要时才让 palette.card 使用其他颜色。' }, { role: 'user', content: prompt }]}), signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`AI 网关文本请求失败：HTTP ${response.status}`);
  const text = (await response.json()).choices?.[0]?.message?.content; if (!text) throw new Error('AI 网关未返回 ThemeSpec。');
  const spec = JSON.parse(String(text).replace(/^\u0060\u0060\u0060json\s*/i, '').replace(/\u0060\u0060\u0060$/,''));
  if (!spec.title || !spec.material) throw new Error('AI 网关 ThemeSpec 不完整。'); return spec;
}
async function startImage(item) {
  const response = await globalThis.fetch(`${AIHUB_BASE}/workflows/run`, { method: 'POST', headers: { authorization: `Bearer ${process.env.AIHUB_AGENT_TOKEN}`, 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify({ appId: process.env.AIHUB_JIMENG_APP_ID, inputs: { prompt: item.prompt, aspect_ratio: item.aspect, version: '即梦5.0', is_expert: '否', count: 1 }, meta: { label: `freecell-${item.id}` } }), signal: AbortSignal.timeout(45_000) });
  if (!response.ok) throw new Error(`AIHub 创建图片任务失败：HTTP ${response.status}`);
  const body = await response.json(); if (!body.runId) throw new Error('AIHub 创建任务未返回 runId。'); return body.runId;
}
async function saveAsset(item) {
  const outputResponse = await globalThis.fetch(`${runUrl(item.runId)}/outputs`, { headers: { authorization: `Bearer ${process.env.AIHUB_AGENT_TOKEN}` }, signal: AbortSignal.timeout(45_000) });
  if (!outputResponse.ok) throw new Error(`AIHub 读取图片输出失败：HTTP ${outputResponse.status}`);
  const source = findUrl(await outputResponse.json()); if (!source) throw new Error('AIHub 输出缺少可访问图片 URL。');
  const image = await globalThis.fetch(source, { signal: AbortSignal.timeout(90_000) }); if (!image.ok) throw new Error(`AIHub 图片下载失败：HTTP ${image.status}`);
  const mime = String(image.headers.get('content-type') || '').split(';')[0].toLowerCase(); if (!['image/png', 'image/jpeg', 'image/webp'].includes(mime)) throw new Error(`AIHub 输出格式无效：${mime || 'unknown'}`);
  const bytes = await image.arrayBuffer(); if (!bytes.byteLength || bytes.byteLength > 20 * 1024 * 1024) throw new Error('图片为空或超过 20MB。');
  const hash = await sha256(bytes); const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'; const stored = await upload(new Uint8Array(bytes), { name: `${hash}.${ext}`, path: 'theme-freecell/generated' });
  return { ...item, status: 'succeeded', mime, bytes: bytes.byteLength, contentHash: hash, ...assetPresentation(bytes, mime), url: stored.url, storage: { objectPath: stored.objectPath, bucket: stored.bucket }, updatedAt: now() };
}
function makeTheme(job) {
  const theme = structuredClone(themes.classic); const palette = job.spec.palette || {};
  theme.themeId = `generated-${job.jobId}`; theme.revision = 1; theme.source = 'generated'; theme.title = String(job.spec.title).slice(0, 40); theme.intent = { themeType: 'user-directed', prompt: job.prompt };
  theme.spec = { ...theme.spec, palette: { ...theme.spec.palette, ...Object.fromEntries(Object.entries(palette).filter(([, value]) => /^#[0-9a-f]{6}$/i.test(value))) }, cardDesign: makeCardDesign(['classic', 'diner', 'cyber', 'ink'].includes(job.spec.cardStyle) ? job.spec.cardStyle : 'classic', job.spec.cardShape), motifs: { material: String(job.spec.material).slice(0, 40), logo: String(job.spec.logo || '定制牌室').slice(0, 40) }, generationNotes: String(job.spec.generationNotes || '用户原始提示已保留；资源已完成格式、体积与持久化检查。').slice(0, 160) };
  theme.assets = { manifestVersion: '1.0', required: ['background', 'cardBack', 'suitMotifs', 'cardFaces', 'ui'], items: job.assets.map(({ storage, status, attempts, updatedAt, ...asset }) => ({ ...asset, provider: 'aihub', model: 'jimeng', reviewStatus: 'stored-fn-cs' })) };
  theme.sizeBytes = theme.assets.items.reduce((sum, item) => sum + Number(item.bytes || 0), 0); theme.generation = { provider: 'aihub-gateway', models: { text: process.env.AI_GATEWAY_MODEL, image: 'jimeng' }, runs: Object.fromEntries(job.assets.map(item => [item.id, [item.runId]])), createdAt: now(), storage: 'fn-mongodb+cs' }; return ensurePlayablePalette(theme);
}
async function refreshJob(job) {
  if (job.status === 'completed' || job.status === 'failed' || job.stage === 'spec') return job;
  const checked = await Promise.all(job.assets.map(async item => {
    if (item.status === 'succeeded') return item;
    const statusResponse = await globalThis.fetch(runUrl(item.runId), { headers: { authorization: `Bearer ${process.env.AIHUB_AGENT_TOKEN}` }, signal: AbortSignal.timeout(30_000) });
    if (!statusResponse.ok) return { ...item, status: 'failed', error: `AIHub 状态查询失败：HTTP ${statusResponse.status}` };
    const state = await statusResponse.json(); const status = normalizeStatus(state.status);
    if (status === 'succeeded') return saveAsset(item);
    if (status === 'failed') return { ...item, status: 'failed', error: safeError(state.error || state.message || 'AIHub 图片任务失败') };
    return { ...item, status: 'running' };
  }));
  const failed = checked.filter(item => item.status === 'failed'); const done = checked.filter(item => item.status === 'succeeded').length;
  const next = { ...job, assets: checked, updatedAt: now(), progress: 20 + Math.round(70 * done / checked.length), stage: failed.length ? 'failed' : done === checked.length ? 'review' : 'assets', message: failed.length ? `${failed[0].id} 生成失败：${failed[0].error}` : done === checked.length ? '正在写入持久化主题库' : `生成并持久化主题资产 ${done}/${checked.length}`, status: failed.length ? 'failed' : job.status };
  if (done === checked.length) { const theme = makeTheme(next); await themeRecords.updateOne({ themeId: theme.themeId }, { $set: { ...theme, partnerPrivate: Boolean(job.partnerPrivate), updatedAt: now() } }, { upsert: true }); next.status = 'completed'; next.progress = 100; next.stage = 'complete'; next.message = '主题、图片资产与生成记录已持久化。'; next.result = { theme, provider: 'aihub-gateway', fallbackUsed: false, errors: [] }; }
  await jobs.updateOne({ jobId: job.jobId }, { $set: next }); return next;
}
async function startThemeJob(prompt, jobId = crypto.randomUUID(), partnerPrivate = false) {
  const missing = configured(); if (missing.length) throw new Error('真实主题流水线未连接。');
  if (!prompt || prompt.length > 200) throw new Error('prompt 必须为 1-200 个字符。');
  const job = { jobId, partnerPrivate, status: 'running', stage: 'spec', progress: 0, prompt, assets: [], createdAt: now(), updatedAt: now() };
  await jobs.insertOne(job);
  try {
    job.spec = await gatewaySpec(prompt);
    const plan = assetPlan(prompt, job.spec.material);
    // Concurrent provider calls, serialized snapshots: do not let an older write erase run IDs.
    let writes = Promise.resolve();
    const results = await Promise.allSettled(plan.map(async item => {
      const asset = { ...item, runId: await startImage(item), status: 'queued', attempts: 1, updatedAt: now() };
      job.assets.push(asset);
      const snapshot = structuredClone(job.assets);
      writes = writes.then(() => jobs.updateOne({ jobId }, { $set: { assets: snapshot, spec: job.spec, updatedAt: now() } }));
      await writes;
    }));
    const failure = results.find(result => result.status === 'rejected');
    if (failure) throw failure.reason;
    job.stage = 'assets'; job.progress = 20; job.message = '图片任务已建立，正在生成。';
  } catch (error) { job.status = 'failed'; job.stage = 'failed'; job.error = safeError(error); }
  await jobs.updateOne({ jobId }, { $set: job });
  return { jobId };
}
function publicJob(job) { const { _id, ...value } = job; return value; }

export async function fetch(request) {
  const url = new URL(request.url); const path = url.pathname.replace(/^\/api(?=\/|$)/, '') || '/'; const method = request.method.toUpperCase();
  try {
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: { allow: 'GET, POST, DELETE, OPTIONS' } });
    if (method === 'GET' && path === '/health') { const missing = configured(); return json({ ok: true, storage: 'fn-mongodb+cs', provider: 'AIHubThemeProvider', providerMode: 'aihub', providerConfigured: !missing.length, mockAllowed: false, generationFallbackAllowed: false, missing, partnerConfigured: partnerConfigured(), partnerHosting: 'external' }); }
    if (path.startsWith('/v1/partner/')) {
      const body = method === 'GET' ? Object.fromEntries(url.searchParams) : await request.json().catch(() => ({}));
      const sessionId = String(request.headers.get('authorization') || '').replace(/^Bearer /, '');
      const result = await partner.handle(method, path, body, sessionId);
      const response = json(result.body, result.status); response.headers.set('cache-control', 'no-store'); return response;
    }
    if (method === 'POST' && path === '/v1/analytics') return json({ accepted: 0, storage: 'fn-mongodb' }, 202);
    if (method === 'GET' && path === '/v1/themes') return json((await themeRecords.find({ source: 'generated', partnerPrivate: { $ne: true } }).sort({ updatedAt: -1 }).limit(30).toArray()).map(theme => publicJob(ensurePlayablePalette(upgradeCardDesign(theme)))));
    if (method === 'GET' && /^\/v1\/themes\/[^/]+$/.test(path)) { const theme = await themeRecords.findOne({ themeId: decodeURIComponent(path.split('/').at(-1)), partnerPrivate: { $ne: true } }); return theme ? json(publicJob(ensurePlayablePalette(upgradeCardDesign(theme)))) : json({ error: '主题不存在。' }, 404); }
    if (method === 'DELETE' && /^\/v1\/themes\/[^/]+$/.test(path)) { await themeRecords.deleteOne({ themeId: decodeURIComponent(path.split('/').at(-1)), partnerPrivate: { $ne: true } }); return new Response(null, { status: 204 }); }
    if (method === 'POST' && path === '/v1/theme-jobs') {
      const body = await request.json().catch(() => ({}));
      return json(await startThemeJob(String(body.prompt || '').trim()), 202);
    }
    if (method === 'GET' && /^\/v1\/theme-jobs\/[^/]+$/.test(path)) { const jobId = decodeURIComponent(path.split('/').at(-1)); if (await partner.isPrivateJob(jobId)) return json({ error: '任务不存在。' }, 404); const job = await jobs.findOne({ jobId }); if (!job) return json({ error: '主题任务不存在或已过期。' }, 404); return json(publicJob(await refreshJob(job))); }
    return json({ error: 'Route not found' }, 404);
  } catch (error) { return json({ error: safeError(error) }, 502); }
}
export default { fetch };
