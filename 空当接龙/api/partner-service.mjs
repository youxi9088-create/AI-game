import { normalizeReturnUrl, validateTemplateId, validateProto, makeExternalWorkId, sha256Hex, partnerErrorStatus, redactPartnerError } from './partner-core.mjs';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const timestamp = () => new Date().toISOString();

// Shared by SQLite and FN: store.create is insert-if-absent, store.save is revision CAS.
export function createPartnerService({ store, client, config, startJob, readJob }) {
  const publicSession = d => ({ session_id: d.id, draft_id: d.draftId, template_id: d.templateId, return_url: d.returnUrl, submit_deadline: d.deadline, state: d.state, jobId: d.jobId || null, external_work_id: d.workId || null });
  async function draft(id) {
    const d = await store.get(`session:${id}`);
    if (!d) fail('创作会话不存在，请从平台重新进入。', 404);
    return d;
  }
  function live(d) { if (Date.parse(d.deadline) <= Date.now()) fail('创作草稿已过期，请从平台重新进入。', 410); }
  async function save(d) { if (!await store.save(d)) fail('状态正在更新，请重试当前操作。', 409); }
  async function exchange(body) {
    const templateId = validateTemplateId(body.template_id, config.templates);
    const returnUrl = normalizeReturnUrl(body.return_url);
    const proto = validateProto(body.proto);
    const ticket = String(body.ticket || '');
    if (!ticket || ticket.length > 256) fail('ticket 无效。');
    const id = crypto.randomUUID();
    const result = await client.exchange({ ticket, partner_session_id: id });
    if (!result.user_ref || !result.draft_id || result.template_id !== templateId) fail('平台兑换响应与当前模板不一致。', 502);
    const deadline = result.submit_deadline;
    if (!deadline || !Number.isFinite(Date.parse(deadline))) fail('平台未返回有效的提交期限。', 502);
    const d = { key: `session:${id}`, id, templateId, returnUrl, proto, deadline, userRef: result.user_ref, draftId: result.draft_id, ticketHash: await sha256Hex(ticket), state: 'creating', createdAt: timestamp() };
    live(d); await store.create(d); return publicSession(d);
  }
  async function generate(d, body) {
    live(d);
    const prompt = String(body.prompt || '').trim();
    if (!prompt || prompt.length > 200) fail('prompt 必须为 1-200 个字符。');
    if (d.jobId) {
      if (d.prompt !== prompt) fail('此草稿已绑定生成任务，请继续当前任务。', 409);
      return { jobId: d.jobId };
    }
    const jobId = crypto.randomUUID();
    d.jobId = jobId; d.prompt = prompt; d.state = 'generating'; await save(d);
    await store.create({ key: `job:${jobId}`, sessionId: d.id });
    try { await startJob(prompt, jobId); }
    catch (error) { const latest = await draft(d.id); latest.generationError = redactPartnerError(error); await save(latest); }
    return { jobId };
  }
  async function job(d) {
    if (!d.jobId) fail('尚未创建任务。', 404);
    if (d.generationError) return { jobId: d.jobId, status: 'failed', error: d.generationError };
    return await readJob(d.jobId) || { jobId: d.jobId, status: 'queued', progress: 0, message: '任务正在建立，请稍候。' };
  }
  async function submit(d, body) {
    const workId = makeExternalWorkId(d.draftId);
    if (body.external_work_id && body.external_work_id !== workId) fail('作品编号不属于当前草稿。', 409);
    if (body.hosting && body.hosting !== 'external') fail('当前仅支持 external 托管。');
    let work = await store.get(`work:${workId}`);
    if (work && work.sessionId !== d.id) fail('作品已绑定其他草稿。', 409);
    if (work?.confirmed) return { ...work.platform, external_work_id: workId, idempotent: true };
    live(d);
    if (!work) {
      const result = await job(d);
      if (!['completed', 'failed'].includes(result.status)) fail('生成尚未完成。', 409);
      const status = result.status === 'completed' ? 'ready' : 'failed';
      if (body.status && body.status !== status) fail('提交状态与生成结果不一致。', 409);
      const url = new URL(config.publicBase); url.search = ''; url.searchParams.set('work', workId); url.hash = 'game';
      const theme = result.result?.theme;
      if (status === 'ready' && !theme?.themeId) fail('生成结果缺少主题。', 502);
      const payload = { draft_id: d.draftId, external_work_id: workId, status, hosting: 'external' };
      if (status === 'ready') Object.assign(payload, { title: theme.title, description: '主题定制空当接龙', play_url: url.href, orientation: 'landscape', embeddable: true, meta_json: JSON.stringify({ theme_id: theme.themeId, template_id: d.templateId, deal_number: 617 }) });
      else payload.fail_reason = String(result.error || result.message || '主题生成失败').slice(0, 500);
      work = { key: `work:${workId}`, sessionId: d.id, workId, payload, theme: theme || null, confirmed: false, createdAt: timestamp() };
      // Persist immutable payload before network IO; retries cannot change the work.
      if (!await store.create(work)) work = await store.get(work.key);
    }
    const platform = await client.submit(work.payload);
    if (!platform.work_id || !platform.state) fail('平台提交响应不完整，请查询后重试。', 502);
    work = await store.get(work.key); work.platform = platform; work.confirmed = true; await save(work);
    d = await draft(d.id); d.workId = workId; d.state = platform.state; await save(d);
    return { ...platform, external_work_id: workId, idempotent: false };
  }
  async function query(d, body) {
    const workId = String(body.external_work_id || makeExternalWorkId(d.draftId));
    const work = await store.get(`work:${workId}`);
    if (!work || work.sessionId !== d.id) fail('该作品未绑定当前草稿。', 404);
    const platform = await client.query(workId);
    if (platform.external_work_id && platform.external_work_id !== workId) fail('平台作品编号不一致。', 502);
    if (!platform.work_id || !platform.state) fail('平台查询响应不完整。', 502);
    work.platform = platform; work.confirmed = true; await save(work);
    d.workId = workId; d.state = platform.state; await save(d);
    return { ...platform, external_work_id: workId };
  }
  async function publicWork(workId) {
    const work = await store.get(`work:${workId}`);
    if (!work?.confirmed || !work.theme) fail('作品不存在或尚未提交。', 404);
    const current = await client.query(workId);
    // No callback is supplied by the platform. Check every open; fail closed on outage/offline.
    if (current.state !== 'published') fail('作品尚未发布、已下架或已删除。', 410);
    return { external_work_id: workId, title: work.payload.title, theme: work.theme, deal_number: 617 };
  }
  return {
    isPrivateJob: async id => Boolean(await store.get(`job:${id}`)),
    async handle(method, path, body = {}, sessionId = '') {
      try {
        if (!config.appId || !config.secret || !config.templates.length || !config.publicBase) fail('第三方接入配置不完整。', 503);
        const base = new URL(config.publicBase); if (base.protocol !== 'https:' || base.username || base.password) fail('作品入口必须配置为 HTTPS。', 503);
        let result;
        if (method === 'GET' && path.startsWith('/v1/partner/works/')) result = await publicWork(decodeURIComponent(path.split('/').at(-1)));
        else if (method === 'POST' && path === '/v1/partner/session') result = await exchange(body);
        else {
          const d = await draft(sessionId);
          if (method === 'GET' && path === '/v1/partner/session') result = publicSession(d);
          else if (method === 'POST' && path === '/v1/partner/jobs') result = await generate(d, body);
          else if (method === 'GET' && path === '/v1/partner/job') result = await job(d);
          else if (method === 'POST' && path === '/v1/partner/submit') result = await submit(d, body);
          else if (method === 'GET' && path === '/v1/partner/query') result = await query(d, body);
          else if (method === 'POST' && path === '/v1/partner/progress') {
            live(d); const percent = Number(body.percent);
            if (!Number.isInteger(percent) || percent < 0 || percent > 100) fail('percent 必须为 0-100 的整数。');
            result = await client.progress({ draft_id: d.draftId, percent, stage: String(body.stage || 'generating').slice(0, 80), message: String(body.message || '').slice(0, 200) });
          } else fail('接口不存在。', 404);
        }
        return { status: 200, body: result };
      } catch (error) { return { status: error.status || partnerErrorStatus(error), body: { error: redactPartnerError(error) } }; }
    },
  };
}

export const partnerConfig = () => ({ appId: process.env.PARTNER_APP_ID, secret: process.env.PARTNER_APP_SECRET, publicBase: process.env.PARTNER_PUBLIC_BASE_URL, templates: String(process.env.PARTNER_TEMPLATE_IDS || '').split(',').map(x => x.trim()).filter(Boolean) });
