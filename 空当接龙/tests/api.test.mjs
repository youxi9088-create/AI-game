import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../api/server.mjs';
import { AIHubThemeProvider, MockThemeProvider, OpenAIThemeProvider, buildCardAssetPlan } from '../api/provider.mjs';
import { validateThemePackage } from '../app/core/theme-contract.js';

async function waitForJob(app, jobId) { let job; for (let tries = 0; tries < 80; tries++) { await new Promise(resolve => setTimeout(resolve, 10)); job = (await app.inject(`/v1/theme-jobs/${jobId}`)).json(); if (job.status === 'completed' || job.status === 'failed') return job; } return job; }

test('主题任务 API 会排队、完成并返回校验后的主题', async () => {
  const app = createServer({ provider: new MockThemeProvider(), allowMock: true });
  try {
    const created = await app.inject({ method: 'POST', url: '/v1/theme-jobs', payload: { prompt: '水墨山水牌桌' } }); assert.equal(created.statusCode, 202); const { jobId } = created.json();
    const job = await waitForJob(app, jobId);
    assert.equal(job.status, 'completed'); assert.equal(job.result.theme.quality.pass, true);
    assert.equal(job.progress, 100); assert.ok(job.trace.some(item => item.stage === 'assets'));
    const theme = await app.inject(`/v1/themes/${job.result.theme.themeId}`); assert.equal(theme.statusCode, 200);
    const list = await app.inject('/v1/themes'); assert.ok(list.json().some(item => item.themeId === job.result.theme.themeId));
    const inspected = await app.inject(`/v1/inspect/themes/${job.result.theme.themeId}`); assert.equal(inspected.json().quality.pass, true);
    const analytics = await app.inject({ method: 'POST', url: '/v1/analytics', payload: { events: [{ id: crypto.randomUUID(), eventName: 'game_start', props: { dealNumber: 7 } }] } }); assert.equal(analytics.statusCode, 202);
  } finally { await app.close(); }
});

test('未配置真实 Provider 时健康检查明确阻断伪生成', async () => {
  const app = createServer({ provider: new MockThemeProvider(), allowMock: false });
  try {
    const health = (await app.inject('/health')).json();
    assert.equal(health.providerConfigured, false);
    assert.equal(health.providerMode, 'mock');
    const response = await app.inject({ method: 'POST', url: '/v1/theme-jobs', payload: { prompt: '不能伪装成真实生成' } });
    assert.equal(response.statusCode, 503);
    assert.match(response.json().error, /真实主题流水线未连接/);
  } finally { await app.close(); }
});

test('主题 API 不向浏览器暴露上游临时签名地址', async () => {
  const mock = new MockThemeProvider();
  const provider = { async createTheme(prompt, options) { const output = await mock.createTheme(prompt, options); output.theme.assets.items[0].sourceUrl = 'https://assets.example/private.png?X-Signature=temporary'; return output; } };
  const app = createServer({ provider });
  try {
    const created = await app.inject({ method: 'POST', url: '/v1/theme-jobs', payload: { prompt: '签名地址脱敏回归' } });
    const job = await waitForJob(app, created.json().jobId);
    assert.equal(job.status, 'completed'); assert.ok(!JSON.stringify(job).includes('sourceUrl')); assert.ok(!JSON.stringify(job).includes('X-Signature'));
    const theme = await app.inject(`/v1/themes/${job.result.theme.themeId}`); assert.ok(!theme.body.includes('sourceUrl')); assert.ok(!theme.body.includes('X-Signature'));
  } finally { await app.close(); }
});

test('OpenAI adapter 使用结构化文本和图片端点并生成可追踪资产', async () => {
  const calls = []; const image = Buffer.from('fake-png').toString('base64');
  const fetchImpl = async (url, options) => { calls.push({ url, body: JSON.parse(options.body), authorization: options.headers.authorization }); if (url.endsWith('/responses')) return new Response(JSON.stringify({ id: 'resp_test', output_text: JSON.stringify({ title: '真实测试主题', palette: { bg: '#0b5a3f', surface: '#073f2c', card: '#fffdf7', accent: '#f7c55c', redSuit: '#d93644', blackSuit: '#1d2730', text: '#edf7f0' }, material: 'linen', logo: 'TEST FREECELL', complianceNotes: '原创测试主题' }) }), { status: 200 }); return new Response(JSON.stringify({ data: [{ b64_json: image }] }), { status: 200 }); };
  const provider = new OpenAIThemeProvider({ apiKey: 'test-key', textModel: 'test-text', imageModel: 'gpt-image-2', fetchImpl });
  const output = await provider.createTheme('原创森林主题');
  assert.equal(output.provider, 'openai'); assert.equal(output.theme.assets.items.length, 31); assert.equal(validateThemePackage(output.theme).pass, true); assert.equal(calls.filter(call => call.url.endsWith('/images/generations')).length, 31); assert.ok(calls.every(call => call.authorization === 'Bearer test-key')); assert.ok(output.theme.generation.promptHash); assert.ok(!JSON.stringify(output.theme).includes('test-key'));
  assert.equal(output.theme.assets.items.filter(item => item.kind === 'rankGlyph').length, 13); assert.equal(output.theme.assets.items.filter(item => item.kind === 'suitMotif').length, 4); assert.equal(output.theme.assets.items.filter(item => item.kind === 'faceCard').length, 12);
  assert.ok(output.theme.assets.items.some(item => item.kind === 'faceCard' && item.cardId === 'S13')); assert.ok(output.theme.assets.items.some(item => item.kind === 'suitMotif' && item.suit === 'S')); assert.ok(output.theme.assets.items.some(item => item.kind === 'rankGlyph' && item.rank === 13));
});

test('AIHub adapter 使用文本网关并保留图片工作流 runId', async () => {
  const calls = []; let sequence = 0; const workflowInputs = [];
  const workflowLauncher = async ({ alias, inputs, token, skillDir }) => { assert.equal(alias, 'jimeng'); assert.ok(inputs.aspect_ratio); assert.equal(token, 'test-aihub-token'); assert.equal(skillDir, 'test-skill-dir'); workflowInputs.push(inputs); sequence++; return { runId: `run-${sequence}`, status: 'queued' }; };
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, authorization: options.headers?.authorization });
    if (url.endsWith('/chat/completions')) return new Response(JSON.stringify({ id: 'gateway-response', choices: [{ message: { content: JSON.stringify({ title: 'AIHub 真主题', palette: { bg: '#0b5a3f', surface: '#073f2c', card: '#fffdf7', accent: '#f7c55c', redSuit: '#d93644', blackSuit: '#1d2730', text: '#edf7f0' }, material: 'linen', logo: 'AIHUB FREECELL', complianceNotes: '原创测试主题' }) } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.endsWith('/outputs')) return new Response(JSON.stringify({ image_url: `https://assets.example/${url.includes('run-1') ? 'background' : 'card-back'}.png` }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.startsWith('https://assets.example/')) return new Response(Buffer.from(`fake-${url}`), { status: 200, headers: { 'content-type': 'image/png' } });
    return new Response(JSON.stringify({ status: 'succeeded' }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const provider = new AIHubThemeProvider({ gatewayApiKey: 'test-gateway-key', gatewayModel: 'test-model', aihubToken: 'test-aihub-token', skillDir: 'test-skill-dir', fetchImpl, workflowLauncher, pollIntervalMs: 1, timeoutMs: 100 });
  const output = await provider.createTheme('可口可乐红白汽水主题，但不要文字和水印');
  assert.equal(output.provider, 'aihub-gateway'); assert.equal(output.fallbackUsed, true); assert.equal(output.theme.intent.themeType, 'brand-inspired'); assert.equal(output.theme.spec.palette.redSuit, '#c72f3d'); assert.equal(output.theme.assets.items.length, 31); assert.equal(validateThemePackage(output.theme).pass, true);
  assert.deepEqual(output.theme.generation.runs.background, ['run-1']); assert.deepEqual(output.theme.generation.runs.cardBack, ['run-2']); assert.equal(Object.keys(output.theme.generation.runs).length, 31);
  assert.equal(output.theme.assets.items.filter(item => item.kind === 'rankGlyph').length, 13); assert.equal(output.theme.assets.items.filter(item => item.kind === 'suitMotif').length, 4); assert.equal(output.theme.assets.items.filter(item => item.kind === 'faceCard').length, 12);
  assert.ok(output.theme.assets.items.some(item => item.kind === 'faceCard' && item.cardId === 'S13' && item.runId)); assert.ok(output.theme.assets.items.some(item => item.kind === 'suitMotif' && item.suit === 'S')); assert.ok(output.theme.assets.items.some(item => item.kind === 'rankGlyph' && item.rank === 13));
  assert.ok(output.theme.assets.items.every(asset => !('sourceUrl' in asset))); assert.ok(calls.some(call => call.url.endsWith('/chat/completions'))); assert.ok(!JSON.stringify(output.theme).includes('test-aihub-token')); assert.ok(!JSON.stringify(output.theme).includes('assets.example'));
  // IP 改写必须是“剔除式”：发给文本网关和图像工作流的 prompt 中不得再出现黑名单原词；
  // 背景任务的 prompt 必须带“禁角色/贴纸”硬约束（防止把背景画成角色贴纸插画）。
  const gatewayUserMessage = calls.find(call => call.url.endsWith('/chat/completions'))?.body?.messages?.find(message => message.role === 'user')?.content || '';
  assert.ok(!gatewayUserMessage.includes('可口可乐'), '网关 prompt 不应包含黑名单原词');
  assert.ok(workflowInputs.length > 0 && !workflowInputs[0].prompt.includes('可口可乐'), '图像 prompt 不应包含黑名单原词');
  assert.ok(buildCardAssetPlan('测试主题').every(item => item.kind === 'background' || item.prompt.includes('带 alpha 通道的 PNG 透明背景')), '牌面资产必须统一要求透明 PNG，禁止白底');
  assert.ok(output.theme.assets.items.filter(item => ['rankGlyph', 'suitMotif', 'faceCard'].includes(item.kind)).every(asset => asset.backgroundMode === 'opaque' && asset.renderPolicy === 'programmatic-fallback'), '不透明牌面输出必须标记为程序化回退');
  assert.ok(workflowInputs[0].prompt.includes('绝对不要出现任何角色'), '背景 prompt 必须禁止角色与贴纸');
  // 背景与牌背是环境类资产：prompt 必须由 spec.material 派生，不得携带主题主体词（如“红白汽水”）。
  assert.ok(workflowInputs.length >= 2, '背景与牌背两个任务都已提交');
  assert.ok(workflowInputs.slice(0, 2).every(inputs => inputs.prompt.includes('linen')), '背景/牌背 prompt 应使用 spec.material 材质描述');
  assert.ok(workflowInputs.slice(0, 2).every(inputs => !inputs.prompt.includes('红白汽水')), '背景/牌背 prompt 不应包含主题主体词');
});

test('真实 Provider 失败时任务完成为可解释的降级主题', async () => {
  const provider = { async createTheme(_prompt, { onStage }) { await onStage({ stage: 'provider', progress: 30, message: '调用失败' }); throw new Error('synthetic provider timeout'); } };
  const app = createServer({ provider, allowGenerationFallback: true });
  try { const created = await app.inject({ method: 'POST', url: '/v1/theme-jobs', payload: { prompt: '海盗航海主题' } }); const job = await waitForJob(app, created.json().jobId); assert.equal(job.status, 'completed'); assert.equal(job.result.fallbackUsed, true); assert.equal(job.result.theme.source, 'degraded'); assert.ok(job.result.errors[0].includes('timeout')); assert.equal(job.result.theme.quality.pass, true); } finally { await app.close(); }
});

test('真实 Provider 默认失败而不是伪装成本地降级成功', async () => {
  const provider = { async createTheme() { throw new Error('synthetic real pipeline failure'); } };
  const app = createServer({ provider });
  try { const created = await app.inject({ method: 'POST', url: '/v1/theme-jobs', payload: { prompt: '不能偷偷降级' } }); const job = await waitForJob(app, created.json().jobId); assert.equal(job.status, 'failed'); assert.equal(job.result, null); assert.match(job.error, /synthetic real pipeline failure/); } finally { await app.close(); }
});
