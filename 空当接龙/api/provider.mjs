import { createHash } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { contrast } from '../app/core/theme-contract.js';
import { packageFromPrompt, themes, makeCardDesign, upgradeCardDesign } from '../app/core/themes.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = async (onStage, stage, progress, message, detail = {}) => { await onStage?.({ stage, progress, message, ...detail }); };
const execFile = promisify(execFileCallback);
const safeError = value => String(value || '').replace(/Bearer\s+\S+/gi, 'Bearer [已隐藏]').replace(/bvk_[A-Za-z0-9_-]+/g, '[令牌已隐藏]').slice(0, 600);
const parseJsonText = value => JSON.parse(String(value || '').trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, ''));
const workflowStatus = value => { const status = String(value || '').toLowerCase(); if (['succeeded', 'success', 'completed', 'done'].includes(status)) return 'succeeded'; if (['failed', 'error', 'cancelled', 'canceled'].includes(status)) return 'failed'; return status === 'running' ? 'running' : 'queued'; };
const findAssetUrl = value => {
  if (typeof value === 'string') return /^https:\/\/[^\s]+$/i.test(value) ? value : undefined;
  if (Array.isArray(value)) { for (const item of value) { const found = findAssetUrl(item); if (found) return found; } return undefined; }
  if (!value || typeof value !== 'object') return undefined;
  for (const key of ['image_url', 'imageUrl', 'image_url_list', 'imageUrls', 'url', 'downloadUrl', 'output']) { const found = findAssetUrl(value[key]); if (found) return found; }
  for (const nested of Object.values(value)) { const found = findAssetUrl(nested); if (found) return found; }
  return undefined;
};

// IP/品牌黑名单：命中时不再“追加免责声明”（图像模型仍能看到原文并照画），
// 而是把黑名单词从 prompt 中剔除后再追加抽象化改写要求，确保图像模型读不到原词。
const IP_PATTERN = /官方|原画|复刻|复制|logo|商标|可口可乐|coca[- ]?cola|米老鼠|米奇|米妮|唐老鸭|迪士尼|disney|mickey|minnie|漫威|marvel|皮卡丘|宝可梦|pokemon|任天堂|nintendo|马里奥|mario|hello\s*kitty/gi;
const ABSTRACT_REWRITE_NOTE = '只提炼配色、材质、氛围等抽象元素；不要出现任何品牌名、品牌标识、角色形象、人物或动物形象、贴纸、产品包装、受保护字体或官方构图。';
// 背景与牌背的图像硬约束：只允许环境/纹样，禁止角色与贴纸式居中主体。
// 注意：这两类资产的 prompt 不携带主题主体词（用 spec.material 等抽象材质描述），
// 否则“水手鸭”“小熊”等具象主题词必然导致角色入画。
const BACKGROUND_PROMPT_RULES = '必须是纯环境场景：只有桌面材质、纹理与氛围光，绝对不要出现任何角色、人物、动物、卡通形象、贴纸、白色贴纸描边、居中主体插画或孤立物件；不要绘制白色矩形、白色面板、边框或卡牌占位区块；深色、低对比、无文字、无数字、无 Logo、无纸牌，中央区域保持安静空旷，那是牌局摆放区。';
const CARDBACK_PROMPT_RULES = '必须是纯纹样图案：中心对称的几何或材质纹理，绝对不要出现任何角色、人物、动物、卡通形象、贴纸或具象插画；无文字、无数字、无 Logo、无真实品牌、边缘清晰。';
function sanitizePrompt(prompt) {
  const forbidden = prompt.match(IP_PATTERN) !== null;
  const safePrompt = forbidden ? `${prompt.replace(IP_PATTERN, ' ').replace(/\s{2,}/g, ' ').trim()}\n${ABSTRACT_REWRITE_NOTE}` : prompt;
  return { forbidden, safePrompt };
}

const SUIT_NAMES = { S: '黑桃', H: '红桃', D: '方块', C: '梅花' };
// 花色颜色约定（扑克牌基本规则，不可随主题变化）：黑桃/梅花=黑，红桃/方块=红。
const SUIT_COLOR_HINTS = { S: '纯黑色（深炭黑）', H: '纯正红色（深绯红）', D: '纯正红色（深绯红）', C: '纯黑色（深炭黑）' };
const RANK_GLYPHS = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };
const FACE_ROLES = { 11: 'Jack 侍从', 12: 'Queen 王后', 13: 'King 国王' };
const TRANSPARENT_ASSET_RULE = '必须输出带 alpha 通道的 PNG 透明背景，主体以外完全透明；禁止纯白背景、白色画布、白色边框或白色贴纸底。';
function alphaChannelPresent(bytes, mime) { const data = Buffer.from(bytes); return mime === 'image/png' && data.length > 25 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47 && [4, 6].includes(data[25]); }
const assetPresentation = (bytes, mime) => ({ backgroundMode: alphaChannelPresent(bytes, mime) ? 'transparent' : 'opaque', alphaVerified: alphaChannelPresent(bytes, mime), whiteBackgroundRisk: !alphaChannelPresent(bytes, mime), renderPolicy: alphaChannelPresent(bytes, mime) ? 'raster' : 'programmatic-fallback' });
// 主题承诺替换的牌面资产：13 个 A-K 字形、4 个花色符号、12 张 J/Q/K 插画。
export function buildCardAssetPlan(safePrompt) {
  const plan = [];
  for (const [suit, name] of Object.entries(SUIT_NAMES)) plan.push({ key: `suit-${suit}`, kind: 'suitMotif', suit, aspectRatio: '2048x2048', label: `freecell-suit-${suit}`, prompt: `生成单个纸牌花色符号：${name}。画面中只有一个巨大的${name}剪影符号，整符号必须是${SUIT_COLOR_HINTS[suit]}的纯色填充、占满画布 80% 以上、居中、边缘清晰。${TRANSPARENT_ASSET_RULE}无文字、无数字、无其他装饰元素、无 Logo、无水印。` });
  for (let rank = 1; rank <= 13; rank++) { const glyph = RANK_GLYPHS[rank] || String(rank); plan.push({ key: `rank-${rank}`, kind: 'rankGlyph', rank, aspectRatio: '2048x2048', label: `freecell-rank-${rank}`, prompt: `生成纸牌点数字形“${glyph}”。画面中只有这一个巨大的“${glyph}”字符，字符占满画布 85% 以上、居中、笔画极粗、深色（深炭黑或深棕）、清晰完整。${TRANSPARENT_ASSET_RULE}绝对不要出现任何角色、人物、动物、卡通形象、星星、气球、装饰图案或边框，除了“${glyph}”这个字符外画面必须完全透明。无文字、无 Logo、无水印。` }); }
  for (const [suit, suitName] of Object.entries(SUIT_NAMES)) for (const rank of [11, 12, 13]) plan.push({ key: `face-${suit}${rank}`, kind: 'faceCard', cardId: `${suit}${rank}`, aspectRatio: '2048x2048', label: `freecell-face-${suit}${rank}`, prompt: `生成纸牌头牌插画：${suitName} ${RANK_GLYPHS[rank]}（${FACE_ROLES[rank]}）。主题：${safePrompt}。原创半身人物、装饰性构图、主体外透明。${TRANSPARENT_ASSET_RULE}无文字、无数字、无 Logo、无水印。` });
  return plan;
}
async function mapPool(items, size, worker) { const results = new Array(items.length); let next = 0; await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => { while (next < items.length) { const index = next++; results[index] = await worker(items[index], index); } })); return results; }
function collectCardAssets(results, { provider, model }) {
  const items = []; const errors = []; const runs = {};
  for (const { item, image, error } of results) {
    if (error) { errors.push(`${item.key} 生成失败：${safeError(error?.message)}`); continue; }
    const entry = { id: item.key, kind: item.kind, provider, model, ...image };
    if (item.suit) entry.suit = item.suit; if (item.rank) entry.rank = item.rank; if (item.cardId) entry.cardId = item.cardId;
    items.push(entry); runs[item.key] = image.runIds || [image.contentHash];
  }
  return { items, errors, runs };
}

async function launchAIHubWorkflow({ alias, inputs, label, token, skillDir, powershellPath = process.env.AIHUB_POWERSHELL_PATH || 'pwsh.exe' }) {
  if (!token || !skillDir) throw new Error('AIHub 缺少 AIHUB_AGENT_TOKEN 或 AIHUB_ASSET_SKILL_DIR。');
  const requestDirectory = resolve(process.env.THEME_REQUEST_DIR || '.data/aihub-requests');
  const requestPath = resolve(requestDirectory, `${crypto.randomUUID()}.json`);
  const scriptPath = resolve('scripts/start-aihub-asset.ps1');
  try {
    await mkdir(requestDirectory, { recursive: true });
    await writeFile(requestPath, JSON.stringify({ alias, inputs, label }), 'utf8');
    const { stdout, stderr } = await execFile(powershellPath, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-InputPath', requestPath], { env: { ...process.env, AIHUB_AGENT_TOKEN: token, AIHUB_ASSET_SKILL_DIR: skillDir }, timeout: 45_000, windowsHide: true, encoding: 'utf8', maxBuffer: 1024 * 1024 });
    const result = stdout.trim().split(/\r?\n/).reverse().map(line => { try { return JSON.parse(line); } catch { return undefined; } }).find(Boolean);
    if (!result) throw new Error(safeError(stderr) || 'AIHub 未返回可解析的工作流结果。');
    if (result.error) throw new Error(safeError(result.error));
    if (!result.runId) throw new Error('AIHub 返回缺少 runId。');
    return result;
  } finally { await unlink(requestPath).catch(() => undefined); }
}

export class MockThemeProvider {
  async createTheme(prompt, { onStage } = {}) {
    await report(onStage, 'policy', 10, '正在检查主题描述与品牌/IP 风险'); await wait(20);
    await report(onStage, 'spec', 30, '正在生成结构化 ThemeSpec', { providerMode: 'mock' });
    const result = packageFromPrompt(prompt); if (result.error) throw new Error(result.error);
    await report(onStage, 'assets', 58, '正在装配稳定 fixture 资源'); await wait(20);
    result.theme.generation = { provider: 'mock', promptHash: hash(prompt), models: {}, trace: ['policy', 'spec', 'fixture-assets'], createdAt: new Date().toISOString() };
    await report(onStage, 'review', 76, '正在执行资源与内容规则审核'); await wait(20);
    return { ...result, provider: 'mock', errors: [] };
  }
}

// Generic adapter for a separately hosted provider that already returns ThemePackage.
export class HttpThemeProvider {
  constructor({ endpoint = process.env.THEME_PROVIDER_URL, token = process.env.THEME_PROVIDER_TOKEN, fetchImpl = fetch } = {}) { this.endpoint = endpoint; this.token = token; this.fetch = fetchImpl; }
  async createTheme(prompt, { onStage } = {}) {
    if (!this.endpoint || !this.token) throw new Error('真实 Provider 未配置 THEME_PROVIDER_URL/THEME_PROVIDER_TOKEN。');
    await report(onStage, 'provider', 35, '正在调用外部 ThemePackage Provider', { providerMode: 'http' });
    const response = await this.fetch(this.endpoint, { method: 'POST', headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ prompt }), signal: AbortSignal.timeout(Number(process.env.THEME_PROVIDER_TIMEOUT_MS || 90_000)) });
    if (!response.ok) throw new Error(`Provider 请求失败：HTTP ${response.status}`);
    const body = await response.json(); if (!body?.theme) throw new Error('Provider 响应缺少 theme。');
    return { theme: upgradeCardDesign(body.theme), provider: 'http', fallbackUsed: Boolean(body.fallbackUsed), errors: body.errors || [] };
  }
}

const paletteSchema = { type: 'object', additionalProperties: false, required: ['bg', 'surface', 'card', 'accent', 'redSuit', 'blackSuit', 'text'], properties: Object.fromEntries(['bg', 'surface', 'card', 'accent', 'redSuit', 'blackSuit', 'text'].map(key => [key, { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' }])) };
const themeSpecSchema = {
  type: 'object', additionalProperties: false, required: ['title', 'palette', 'material', 'logo', 'complianceNotes', 'cardStyle'],
  properties: { title: { type: 'string', minLength: 1, maxLength: 40 }, palette: paletteSchema, material: { type: 'string', minLength: 1, maxLength: 40 }, logo: { type: 'string', minLength: 1, maxLength: 40 }, complianceNotes: { type: 'string', minLength: 1, maxLength: 160 }, cardStyle: { type: 'string', enum: ['classic', 'diner', 'cyber', 'ink'] } },
};
const outputText = body => body.output_text || body.output?.flatMap(item => item.content || []).find(item => item.type === 'output_text')?.text;

export class OpenAIThemeProvider {
  constructor({ apiKey = process.env.OPENAI_API_KEY, textModel = process.env.OPENAI_TEXT_MODEL, imageModel = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2', baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1', fetchImpl = fetch } = {}) {
    this.apiKey = apiKey; this.textModel = textModel; this.imageModel = imageModel; this.baseUrl = baseUrl.replace(/\/$/, ''); this.fetch = fetchImpl;
  }
  async request(path, body, timeoutMs = 90_000) {
    if (!this.apiKey || !this.textModel || !this.imageModel) throw new Error('OpenAI Provider 缺少 OPENAI_API_KEY、OPENAI_TEXT_MODEL 或 OPENAI_IMAGE_MODEL。');
    const response = await this.fetch(`${this.baseUrl}${path}`, { method: 'POST', headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) { const detail = await response.text(); throw new Error(`OpenAI API ${path} 失败：HTTP ${response.status} ${detail.slice(0, 180)}`); }
    return response.json();
  }
  async generateImage(prompt) {
    const body = await this.request('/images/generations', { model: this.imageModel, prompt });
    const base64 = body.data?.[0]?.b64_json; if (!base64) throw new Error('OpenAI Image API 未返回 b64_json。');
    const bytes = Buffer.from(base64, 'base64'); const contentHash = hash(bytes); const assetDir = resolve(process.env.THEME_ASSET_DIR || '.data/theme-assets');
    await mkdir(assetDir, { recursive: true }); await writeFile(resolve(assetDir, `${contentHash}.png`), bytes);
    return { mime: 'image/png', bytes: bytes.byteLength, contentHash, url: `/v1/assets/${contentHash}.png`, ...assetPresentation(bytes, 'image/png') };
  }
  async createTheme(prompt, { onStage } = {}) {
    await report(onStage, 'policy', 8, '正在检查主题描述与品牌/IP 风险', { providerMode: 'openai' });
    const { forbidden, safePrompt } = sanitizePrompt(prompt);
    await report(onStage, 'spec', 24, '正在由大模型生成结构化 ThemeSpec');
    const response = await this.request('/responses', { model: this.textModel, store: false, instructions: '你是纸牌主题设计器。设计色板、材质、原创氛围，并从 classic、diner、cyber、ink 中选择 cardStyle 以驱动 A-K 字形、花色符号与 J/Q/K 插画。牌的规则身份、可读性、交互区域由程序固定；不要生成坐标、文件名、商标或受保护角色。', input: safePrompt, text: { format: { type: 'json_schema', name: 'freecell_theme_spec', strict: true, schema: themeSpecSchema } } });
    const raw = outputText(response); if (!raw) throw new Error('OpenAI Responses API 未返回结构化 ThemeSpec。');
    const spec = JSON.parse(raw); const theme = structuredClone(themes.classic);
    theme.themeId = `generated-${Date.now()}`; theme.revision = 1; theme.source = 'generated'; theme.title = spec.title;
    theme.intent = { themeType: forbidden ? 'brand-inspired' : 'generic', prompt };
    theme.spec = { ...theme.spec, palette: spec.palette, cardDesign: makeCardDesign(spec.cardStyle), motifs: { material: spec.material, logo: spec.logo }, complianceNotes: spec.complianceNotes };
    await report(onStage, 'assets', 36, '正在生成桌面背景');
    const background = await this.generateImage(`为桌面纸牌游戏生成横向环境背景。材质与氛围：${spec.material}。${BACKGROUND_PROMPT_RULES}`);
    await report(onStage, 'assets', 44, '正在生成牌背与材质样本');
    const cardBack = await this.generateImage(`生成正方形可平铺的纸牌背面纹样。材质与风格：${spec.material}。${CARDBACK_PROMPT_RULES}`);
    await report(onStage, 'assets', 50, '正在并发生成 A-K 字形、花色符号与 12 张 J/Q/K 插画');
    const cardPlan = buildCardAssetPlan(safePrompt); let cardDone = 0;
    const cardResults = await mapPool(cardPlan, 5, async item => { try { return { item, image: await this.generateImage(item.prompt) }; } catch (error) { return { item, error }; } finally { cardDone++; await report(onStage, 'assets', 50 + Math.round(24 * cardDone / cardPlan.length), `牌面资产生成中 ${cardDone}/${cardPlan.length}（A-K 字形、花色符号、J/Q/K 插画）`); } });
    const { items: cardItems, errors: cardErrors, runs: cardRuns } = collectCardAssets(cardResults, { provider: 'openai', model: this.imageModel });
    theme.assets = { manifestVersion: '1.0', required: ['background', 'cardBack', 'suitMotifs', 'cardFaces', 'ui'], items: [{ id: 'background', kind: 'background', provider: 'openai', model: this.imageModel, ...background }, { id: 'cardBack', kind: 'cardBack', provider: 'openai', model: this.imageModel, ...cardBack }, ...cardItems] };
    await report(onStage, 'review', 76, `已生成 ${theme.assets.items.length} 项资源，正在执行清单、许可和最低内容规则审核`);
    theme.generation = { provider: 'openai', promptHash: hash(prompt), models: { text: this.textModel, image: this.imageModel }, responseId: response.id, runs: cardRuns, trace: ['policy', 'responses-structured-output', 'card-design-spec', 'image-background', 'image-cardBack', 'image-card-assets', 'provider-moderation'], createdAt: new Date().toISOString() };
    theme.sizeBytes = Buffer.byteLength(JSON.stringify(theme));
    return { theme, provider: 'openai', fallbackUsed: forbidden, errors: cardErrors };
  }
}

export class AIHubThemeProvider {
  constructor({ gatewayApiKey = process.env.AI_GATEWAY_API_KEY, gatewayModel = process.env.AI_GATEWAY_MODEL, gatewayBaseUrl = process.env.AI_GATEWAY_BASE_URL || 'https://ai-gateway.aiae.ndhy.com/v1', aihubToken = process.env.AIHUB_AGENT_TOKEN, skillDir = process.env.AIHUB_ASSET_SKILL_DIR, fetchImpl = fetch, workflowLauncher = launchAIHubWorkflow, pollIntervalMs = 2_000, timeoutMs = 20 * 60_000 } = {}) {
    this.gatewayApiKey = gatewayApiKey; this.gatewayModel = gatewayModel; this.gatewayBaseUrl = gatewayBaseUrl.replace(/\/$/, '').endsWith('/v1') ? gatewayBaseUrl.replace(/\/$/, '') : `${gatewayBaseUrl.replace(/\/$/, '')}/v1`; this.aihubToken = aihubToken; this.skillDir = skillDir; this.fetch = fetchImpl; this.workflowLauncher = workflowLauncher; this.pollIntervalMs = pollIntervalMs; this.timeoutMs = timeoutMs;
  }
  async gatewayRequest(body) {
    const response = await this.fetch(`${this.gatewayBaseUrl}/chat/completions`, { method: 'POST', headers: { authorization: `Bearer ${this.gatewayApiKey}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(Number(process.env.AI_GATEWAY_TIMEOUT_MS || 60_000)) });
    if (!response.ok) throw new Error(`AI 网关文本请求失败：HTTP ${response.status} ${safeError(await response.text())}`);
    return response.json();
  }
  async waitForRun(runId) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < this.timeoutMs) {
      const statusResponse = await this.fetch(`https://bv.new.ndhy.com/api/agent/aihub/workflows/runs/${encodeURIComponent(runId)}`, { headers: { authorization: `Bearer ${this.aihubToken}` }, signal: AbortSignal.timeout(30_000) });
      if (!statusResponse.ok) throw new Error(`AIHub 状态查询失败：HTTP ${statusResponse.status}`);
      const statusBody = await statusResponse.json(); const status = workflowStatus(statusBody.status);
      if (status === 'failed') throw new Error(`AIHub 图片任务失败：${safeError(statusBody.error || statusBody.message || '未知错误')}`);
      if (status === 'succeeded') {
        const outputResponse = await this.fetch(`https://bv.new.ndhy.com/api/agent/aihub/workflows/runs/${encodeURIComponent(runId)}/outputs`, { headers: { authorization: `Bearer ${this.aihubToken}` }, signal: AbortSignal.timeout(30_000) });
        if (!outputResponse.ok) throw new Error(`AIHub 输出查询失败：HTTP ${outputResponse.status}`);
        return outputResponse.json();
      }
      await wait(this.pollIntervalMs);
    }
    throw new Error(`AIHub 图片任务运行超过 ${Math.round(this.timeoutMs / 60_000)} 分钟。`);
  }
  async materializeImage(outputs, runId) {
    const sourceUrl = findAssetUrl(outputs); if (!sourceUrl) throw new Error('AIHub 输出中没有可用图片 URL。');
    const response = await this.fetch(sourceUrl, { signal: AbortSignal.timeout(90_000) }); if (!response.ok) throw new Error(`AIHub 图片下载失败：HTTP ${response.status}`);
    const mime = String(response.headers.get('content-type') || '').split(';')[0].toLowerCase(); if (!['image/png', 'image/jpeg', 'image/webp'].includes(mime)) throw new Error(`AIHub 输出不是受支持的图片：${mime || 'unknown'}`);
    const bytes = Buffer.from(await response.arrayBuffer()); if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new Error('AIHub 图片文件为空或超过 20MB。');
    const contentHash = hash(bytes); const extension = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'; const assetDir = resolve(process.env.THEME_ASSET_DIR || '.data/theme-assets');
    await mkdir(assetDir, { recursive: true }); await writeFile(resolve(assetDir, `${contentHash}.${extension}`), bytes);
    return { mime, bytes: bytes.byteLength, contentHash, url: `/v1/assets/${contentHash}.${extension}`, runId, ...assetPresentation(bytes, mime) };
  }
  async generateImage({ prompt, aspectRatio, label }) {
    const runIds = []; let lastError;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const started = await this.workflowLauncher({ alias: 'jimeng', inputs: { prompt, aspect_ratio: aspectRatio, version: '即梦5.0', is_expert: '否', count: 1 }, label: `${label}-attempt-${attempt}`, token: this.aihubToken, skillDir: this.skillDir });
        runIds.push(started.runId); const outputs = await this.waitForRun(started.runId); return { ...(await this.materializeImage(outputs, started.runId)), runIds, attempt };
      } catch (error) { lastError = error; if (attempt < 2) await wait(1_000); }
    }
    throw new Error(`${label}在一次重试后仍失败：${safeError(lastError?.message)}`);
  }
  async createTheme(prompt, { onStage } = {}) {
    if (!this.gatewayApiKey || !this.gatewayModel || !this.aihubToken || !this.skillDir) throw new Error('AIHub Provider 配置不完整。');
    await report(onStage, 'policy', 8, '正在检查主题描述与品牌/IP 风险', { providerMode: 'aihub' });
    const { forbidden, safePrompt } = sanitizePrompt(prompt);
    await report(onStage, 'spec', 22, '正在通过 AI 网关生成结构化 ThemeSpec', { model: this.gatewayModel });
    const response = await this.gatewayRequest({ model: this.gatewayModel, response_format: { type: 'json_object' }, messages: [{ role: 'developer', content: '你是纸牌主题设计器。只返回 JSON，字段必须为 title、palette、material、logo、complianceNotes、cardStyle。cardStyle 只能为 classic、diner、cyber、ink，用于程序化渲染 A-K 字形、花色符号与 J/Q/K 插画。palette 必须含 bg、surface、card、accent、redSuit、blackSuit、text，全部是六位十六进制色值。牌面默认使用原来的近白色（建议 #fffdf7），不要把牌桌 surface 或 accent 混入牌面；只有主题确实需要时才让 palette.card 使用其他颜色。牌的规则身份、交互与可读性由程序固定，不生成坐标、文件名、商标或受保护角色。' }, { role: 'user', content: safePrompt }] });
    const raw = response.choices?.[0]?.message?.content; if (!raw) throw new Error('AI 网关未返回 ThemeSpec。'); const spec = parseJsonText(raw);
    if (!spec.title || !spec.palette || !spec.material || !spec.logo || !spec.complianceNotes) throw new Error('AI 网关 ThemeSpec 字段不完整。');
    if (!['classic', 'diner', 'cyber', 'ink'].includes(spec.cardStyle)) spec.cardStyle = /赛博|霓虹|cyber/i.test(`${spec.material} ${prompt}`) ? 'cyber' : /水墨|山水|ink/i.test(`${spec.material} ${prompt}`) ? 'ink' : /卡通|派对|复古|童话|动漫|餐厅|汽水|comic|cartoon|diner/i.test(`${spec.material} ${prompt}`) ? 'diner' : 'classic';
    await report(onStage, 'assets', 38, '已创建 AIHub 图片任务，正在并行生成桌面背景和牌背', { alias: 'jimeng' });
    const [background, cardBack] = await Promise.all([
      this.generateImage({ label: 'freecell-background', aspectRatio: '4096x2304', prompt: `为桌面纸牌游戏生成横向环境背景。材质与氛围：${spec.material}。${BACKGROUND_PROMPT_RULES}` }),
      this.generateImage({ label: 'freecell-card-back', aspectRatio: '2048x2048', prompt: `生成正方形可平铺的纸牌背面纹样。材质与风格：${spec.material}。${CARDBACK_PROMPT_RULES}` }),
    ]);
    await report(onStage, 'assets', 46, '桌面与牌背已完成，正在并发生成 A-K 字形、花色符号与 12 张 J/Q/K 插画', { alias: 'jimeng' });
    const cardPlan = buildCardAssetPlan(safePrompt); let cardDone = 0;
    const cardResults = await mapPool(cardPlan, 5, async item => { try { return { item, image: await this.generateImage({ label: item.label, aspectRatio: item.aspectRatio, prompt: item.prompt }) }; } catch (error) { return { item, error }; } finally { cardDone++; await report(onStage, 'assets', 46 + Math.round(28 * cardDone / cardPlan.length), `牌面资产生成中 ${cardDone}/${cardPlan.length}（A-K 字形、花色符号、J/Q/K 插画）`); } });
    const { items: cardItems, errors: cardErrors, runs: cardRuns } = collectCardAssets(cardResults, { provider: 'aihub', model: 'jimeng' });
    const allRuns = { background: background.runIds, cardBack: cardBack.runIds, ...cardRuns };
    await report(onStage, 'review', 78, `AIHub ${2 + cardItems.length} 项图片已下载并完成格式、体积与哈希检查`, { runs: allRuns });
    const theme = structuredClone(themes.classic); theme.themeId = `generated-${Date.now()}`; theme.revision = 1; theme.source = 'generated'; theme.title = String(spec.title).slice(0, 40); theme.intent = { themeType: forbidden ? 'brand-inspired' : 'generic', prompt };
    const basePalette = themes.classic.spec.palette; const palette = Object.fromEntries(Object.keys(basePalette).map(key => [key, /^#[0-9a-f]{6}$/i.test(spec.palette?.[key] || '') ? spec.palette[key] : basePalette[key]]));
    palette.card = basePalette.card; palette.redSuit = basePalette.redSuit; palette.blackSuit = basePalette.blackSuit; if (contrast(palette.card, palette.bg) < 1.4) palette.bg = basePalette.bg;
    theme.spec = { ...theme.spec, palette, cardDesign: makeCardDesign(spec.cardStyle), motifs: { material: String(spec.material).slice(0, 40), logo: forbidden ? 'FIZZ FREECELL' : String(spec.logo).slice(0, 40) }, complianceNotes: forbidden ? '已将品牌诉求改写为原创红白汽水、冰爽气泡与复古餐厅氛围；不含品牌名、标识、包装、文字或水印。' : String(spec.complianceNotes).slice(0, 160) };
    theme.assets = { manifestVersion: '1.0', required: ['background', 'cardBack', 'suitMotifs', 'cardFaces', 'ui'], items: [{ id: 'background', kind: 'background', provider: 'aihub', model: 'jimeng', ...background }, { id: 'cardBack', kind: 'cardBack', provider: 'aihub', model: 'jimeng', ...cardBack }, ...cardItems] };
    theme.generation = { provider: 'aihub-gateway', promptHash: hash(prompt), models: { text: this.gatewayModel, image: 'jimeng' }, responseId: response.id, runs: allRuns, trace: ['policy', 'gateway-json', 'card-design-spec', 'aihub-background', 'aihub-cardBack', 'aihub-card-assets', 'asset-validation'], createdAt: new Date().toISOString() };
    theme.sizeBytes = Buffer.byteLength(JSON.stringify(theme)); return { theme, provider: 'aihub-gateway', fallbackUsed: forbidden, errors: cardErrors };
  }
}

export const configuredProvider = () => {
  const mode = String(process.env.THEME_GENERATOR_MODE || 'openai').toLowerCase();
  if (mode === 'aihub' || (process.env.AIHUB_AGENT_TOKEN && process.env.AI_GATEWAY_API_KEY)) return new AIHubThemeProvider();
  if (mode === 'openai' || (process.env.OPENAI_API_KEY && process.env.OPENAI_TEXT_MODEL)) return new OpenAIThemeProvider();
  if (mode === 'http' || process.env.THEME_PROVIDER_URL) return new HttpThemeProvider();
  if (mode === 'mock') return new MockThemeProvider();
  return new OpenAIThemeProvider();
};

export const providerStatus = provider => {
  if (provider instanceof AIHubThemeProvider) {
    const missing = [['AI_GATEWAY_API_KEY', provider.gatewayApiKey], ['AI_GATEWAY_MODEL', provider.gatewayModel], ['AIHUB_AGENT_TOKEN', provider.aihubToken], ['AIHUB_ASSET_SKILL_DIR', provider.skillDir]].filter(([, value]) => !value).map(([name]) => name);
    return { mode: 'aihub', provider: provider.constructor.name, configured: missing.length === 0, missing };
  }
  if (provider instanceof OpenAIThemeProvider) {
    const missing = [['OPENAI_API_KEY', provider.apiKey], ['OPENAI_TEXT_MODEL', provider.textModel], ['OPENAI_IMAGE_MODEL', provider.imageModel]].filter(([, value]) => !value).map(([name]) => name);
    return { mode: 'openai', provider: provider.constructor.name, configured: missing.length === 0, missing };
  }
  if (provider instanceof HttpThemeProvider) {
    const missing = [['THEME_PROVIDER_URL', provider.endpoint], ['THEME_PROVIDER_TOKEN', provider.token]].filter(([, value]) => !value).map(([name]) => name);
    return { mode: 'http', provider: provider.constructor.name, configured: missing.length === 0, missing };
  }
  if (provider instanceof MockThemeProvider) return { mode: 'mock', provider: provider.constructor.name, configured: false, missing: ['真实 Provider 配置'] };
  return { mode: 'custom', provider: provider?.constructor?.name || 'CustomThemeProvider', configured: true, missing: [] };
};
