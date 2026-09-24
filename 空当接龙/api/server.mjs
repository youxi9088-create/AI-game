import Fastify from 'fastify';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateThemePackage } from '../app/core/theme-contract.js';
import { packageFromPrompt } from '../app/core/themes.js';
import { makeDegradedTheme } from '../app/core/theme-composer.js';
import { configuredProvider, providerStatus } from './provider.mjs';
import { createPartnerClient } from './partner-client.mjs';
import { createPartnerService, partnerConfig } from './partner-service.mjs';
import { sqlitePartnerStore } from './partner-store.mjs';

const dbPath = resolve(process.env.THEME_DB_PATH || '.data/theme-freecell.sqlite');
mkdirSync(dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec(`CREATE TABLE IF NOT EXISTS theme_jobs (id TEXT PRIMARY KEY, prompt TEXT NOT NULL, status TEXT NOT NULL, result TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS themes (id TEXT PRIMARY KEY, package TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS analytics_events (id TEXT PRIMARY KEY, event_name TEXT NOT NULL, props TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS partner_drafts (session_id TEXT PRIMARY KEY, ticket_hash TEXT NOT NULL, template_id TEXT NOT NULL, return_url TEXT NOT NULL, proto TEXT NOT NULL, user_ref TEXT, draft_id TEXT, state TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS partner_works (external_work_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, draft_id TEXT NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL, platform_result TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`);
const jobColumns = new Set(db.prepare('PRAGMA table_info(theme_jobs)').all().map(column => column.name));
for (const [name, definition] of [['stage', "TEXT NOT NULL DEFAULT 'queued'"], ['progress', 'INTEGER NOT NULL DEFAULT 0'], ['message', "TEXT NOT NULL DEFAULT '任务已排队'"], ['trace', "TEXT NOT NULL DEFAULT '[]'"]]) if (!jobColumns.has(name)) db.exec(`ALTER TABLE theme_jobs ADD COLUMN ${name} ${definition}`);
if (!db.prepare('PRAGMA table_info(themes)').all().some(c => c.name === 'owner_session')) db.exec('ALTER TABLE themes ADD COLUMN owner_session TEXT');
const now = () => new Date().toISOString();
const parse = value => value ? JSON.parse(value) : null;
const publicData = value => value == null ? value : JSON.parse(JSON.stringify(value, (key, item) => key === 'sourceUrl' ? undefined : item));
const row = id => db.prepare('SELECT * FROM theme_jobs WHERE id = ?').get(id);
const updateJob = (id, { status = 'running', stage, progress, message, trace }) => db.prepare('UPDATE theme_jobs SET status = ?, stage = ?, progress = ?, message = ?, trace = ?, updated_at = ? WHERE id = ?').run(status, stage, progress, message, JSON.stringify(trace), now(), id);

export function createServer({ provider = configuredProvider(), allowMock = process.env.ALLOW_MOCK_THEME_UI === '1' || process.env.NODE_ENV === 'test', allowGenerationFallback = process.env.ALLOW_GENERATION_FALLBACK === '1' } = {}) {
  const app = Fastify({ logger: true });
  const pipeline = providerStatus(provider);
  const allowedOrigins = new Set(String(process.env.WEB_ORIGIN || 'http://localhost:4173,http://127.0.0.1:4173').split(',').map(item => item.trim()).filter(Boolean));
  const config = partnerConfig();
  const partner = createPartnerService({ store: sqlitePartnerStore(db), client: createPartnerClient(), config,
    startJob: (prompt, id) => startThemeJob(prompt, id, true),
    readJob: async id => { const found = row(id); return found ? publicData({ jobId: id, status: found.status, stage: found.stage, progress: found.progress, message: found.message, result: parse(found.result), error: found.error }) : null; },
  });
  const partnerConfigured = Boolean(config.appId && config.secret && config.templates.length && config.publicBase);
  app.addHook('onSend', async (request, reply) => { const origin = request.headers.origin; if (origin && allowedOrigins.has(origin)) reply.header('access-control-allow-origin', origin); reply.header('vary', 'Origin'); reply.header('access-control-allow-methods', 'GET,POST,DELETE,OPTIONS'); reply.header('access-control-allow-headers', 'content-type,authorization'); });
  app.options('*', async (_request, reply) => reply.code(204).send());
  app.get('/health', async () => ({ ok: true, storage: 'sqlite', provider: pipeline.provider, providerMode: pipeline.mode, providerConfigured: pipeline.configured, mockAllowed: allowMock, generationFallbackAllowed: allowGenerationFallback, missing: pipeline.missing, partnerConfigured, partnerHosting: 'external' }));
  app.route({ method: ['GET', 'POST'], url: '/v1/partner/*', handler: async (request, reply) => {
    const sessionId = String(request.headers.authorization || '').replace(/^Bearer /, '');
    const result = await partner.handle(request.method, request.url.split('?')[0], request.method === 'GET' ? request.query : request.body || {}, sessionId);
    return reply.code(result.status).header('cache-control', 'no-store').send(result.body);
  } });
  app.get('/v1/assets/:file', async (request, reply) => { const file = String(request.params.file || ''); if (!/^[a-f0-9]{64}\.(png|jpg|webp)$/.test(file)) return reply.code(400).send({ error: '非法资源标识。' }); try { const bytes = await readFile(resolve(process.env.THEME_ASSET_DIR || '.data/theme-assets', file)); const extension = file.split('.').at(-1); const mime = extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : 'image/jpeg'; return reply.type(mime).header('cache-control', 'public, max-age=31536000, immutable').send(bytes); } catch { return reply.code(404).send({ error: '资源不存在。' }); } });
  function startThemeJob(prompt, id = crypto.randomUUID(), privateJob = false) {
    if (!pipeline.configured && !allowMock) throw Object.assign(new Error('真实主题流水线未连接。'), { statusCode: 503 });
    if (!prompt || prompt.length > 200) throw Object.assign(new Error('prompt 必须为 1-200 个字符。'), { statusCode: 400 });
    const timestamp = now();
    db.prepare('INSERT INTO theme_jobs (id, prompt, status, result, error, created_at, updated_at, stage, progress, message, trace) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, prompt, 'queued', null, null, timestamp, timestamp, 'queued', 0, '任务已排队', '[]');
    queueMicrotask(async () => {
      const trace = [];
      const onStage = async event => { trace.push({ ...event, at: now() }); updateJob(id, { ...event, trace }); };
      try {
        const output = await provider.createTheme(prompt, { onStage }); await onStage({ stage: 'validate', progress: 86, message: '正在执行 ThemePackage 质量门' }); const quality = validateThemePackage(output.theme);
        if (!quality.pass) throw new Error(`ThemePackage 未通过质量门：${quality.checks.filter(x => !x.pass).map(x => x.id).join(', ')}`);
        const theme = { ...output.theme, quality }; await onStage({ stage: 'package', progress: 96, message: '正在保存已校验主题包' }); const completed = now();
        db.prepare('INSERT OR REPLACE INTO themes (id, package, created_at, owner_session) VALUES (?, ?, ?, ?)').run(theme.themeId, JSON.stringify(theme), completed, privateJob ? id : null);
        db.prepare('UPDATE theme_jobs SET status = ?, stage = ?, progress = ?, message = ?, result = ?, trace = ?, updated_at = ? WHERE id = ?').run('completed', 'completed', 100, '主题包已通过质量门', JSON.stringify({ theme, provider: output.provider, fallbackUsed: Boolean(output.fallbackUsed), errors: output.errors || [] }), JSON.stringify(trace), completed, id);
      } catch (error) {
        if (!allowGenerationFallback) {
          db.prepare('UPDATE theme_jobs SET status = ?, stage = ?, message = ?, error = ?, trace = ?, updated_at = ? WHERE id = ?').run('failed', 'failed', '真实生成失败，已保留当前主题', error.message, JSON.stringify(trace), now(), id);
          return;
        }
        try {
          await onStage({ stage: 'fallback', progress: 88, message: '真实生成失败，正在构建可玩降级主题', error: error.message });
          const base = packageFromPrompt(prompt); if (base.error) throw new Error(base.error);
          const theme = makeDegradedTheme(base.theme); theme.generation = { provider: provider.constructor.name, promptHash: base.theme.generation?.promptHash, trace: trace.map(item => item.stage), errors: [error.message], createdAt: now() }; theme.sizeBytes = Buffer.byteLength(JSON.stringify(theme)); theme.quality = validateThemePackage(theme);
          if (!theme.quality.pass) throw new Error('降级主题未通过最低可玩质量门。');
          const completed = now(); db.prepare('INSERT OR REPLACE INTO themes (id, package, created_at, owner_session) VALUES (?, ?, ?, ?)').run(theme.themeId, JSON.stringify(theme), completed, privateJob ? id : null);
          db.prepare('UPDATE theme_jobs SET status = ?, stage = ?, progress = ?, message = ?, result = ?, error = ?, trace = ?, updated_at = ? WHERE id = ?').run('completed', 'completed', 100, '已生成可玩降级主题', JSON.stringify({ theme, provider: provider.constructor.name, fallbackUsed: true, errors: [error.message] }), error.message, JSON.stringify(trace), completed, id);
        } catch (fallbackError) { db.prepare('UPDATE theme_jobs SET status = ?, stage = ?, message = ?, error = ?, trace = ?, updated_at = ? WHERE id = ?').run('failed', 'failed', '主题生成失败，已保留当前主题', fallbackError.message, JSON.stringify(trace), now(), id); }
      }
    });
    return { jobId: id, status: 'queued' };
  }
  app.post('/v1/theme-jobs', async (request, reply) => {
    try { return reply.code(202).send(startThemeJob(String(request.body?.prompt || '').trim())); }
    catch (error) { return reply.code(error.statusCode || 500).send({ error: error.message }); }
  });
  app.get('/v1/theme-jobs/:id', async (request, reply) => { if (await partner.isPrivateJob(request.params.id)) return reply.code(404).send({ error: '任务不存在。' }); const found = row(request.params.id); return found ? publicData({ jobId: found.id, prompt: found.prompt, status: found.status, stage: found.stage, progress: found.progress, message: found.message, trace: parse(found.trace) || [], result: parse(found.result), error: found.error, updatedAt: found.updated_at }) : reply.code(404).send({ error: '任务不存在。' }); });
  app.get('/v1/themes', async () => publicData(db.prepare('SELECT package FROM themes WHERE owner_session IS NULL ORDER BY created_at DESC').all().map(item => parse(item.package))));
  app.get('/v1/themes/:id', async (request, reply) => { const found = db.prepare('SELECT package FROM themes WHERE id = ? AND owner_session IS NULL').get(request.params.id); return found ? publicData(parse(found.package)) : reply.code(404).send({ error: '主题不存在。' }); });
  app.post('/v1/themes/:id/rename', async (request, reply) => { const found = db.prepare('SELECT package FROM themes WHERE id = ? AND owner_session IS NULL').get(request.params.id); const title = String(request.body?.title || '').trim(); if (!found) return reply.code(404).send({ error: '主题不存在。' }); if (!title || title.length > 60) return reply.code(400).send({ error: 'title 必须为 1-60 个字符。' }); const theme = publicData(parse(found.package)); theme.title = title; theme.revision = Number(theme.revision || 0) + 1; db.prepare('UPDATE themes SET package = ?, created_at = ? WHERE id = ?').run(JSON.stringify(theme), now(), request.params.id); return theme; });
  app.delete('/v1/themes/:id', async (request, reply) => { const found = db.prepare('SELECT package FROM themes WHERE id = ? AND owner_session IS NULL').get(request.params.id); if (!found) return reply.code(404).send({ error: '主题不存在。' }); if (parse(found.package).source === 'builtin') return reply.code(409).send({ error: '经典内置主题不可删除。' }); db.prepare('DELETE FROM themes WHERE id = ?').run(request.params.id); return reply.code(204).send(); });
  app.get('/v1/inspect/themes/:id', async (request, reply) => { const found = db.prepare('SELECT package, created_at FROM themes WHERE id = ? AND owner_session IS NULL').get(request.params.id); if (!found) return reply.code(404).send({ error: '主题不存在。' }); const theme = publicData(parse(found.package)); return { theme, quality: validateThemePackage(theme), trace: { provider: theme.source, createdAt: found.created_at, assets: theme.assets?.required || [] } }; });
  app.post('/v1/analytics', async (request, reply) => { const events = Array.isArray(request.body?.events) ? request.body.events.slice(0, 200) : []; if (!events.length) return reply.code(400).send({ error: 'events 不能为空。' }); const statement = db.prepare('INSERT OR IGNORE INTO analytics_events VALUES (?, ?, ?, ?)'); for (const event of events) statement.run(String(event.id || crypto.randomUUID()), String(event.eventName || 'unknown'), JSON.stringify(event.props || {}), String(event.createdAt || now())); return reply.code(202).send({ accepted: events.length }); });
  app.post('/v1/solver/hint', async (_request, reply) => reply.code(503).send({ error: '当前未配置 fc-solve 服务；请使用本地提示。' }));
  return app;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createServer(); app.listen({ port: Number(process.env.PORT || 4174), host: process.env.HOST || '127.0.0.1' }).catch(error => { app.log.error(error); process.exit(1); });
}
