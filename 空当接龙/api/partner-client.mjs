import { PARTNER_PATHS, buildPartnerHeaders, redactPartnerError } from './partner-core.mjs';

export function createPartnerClient({ fetchImpl = globalThis.fetch, baseUrl = process.env.PARTNER_PLATFORM_BASE || 'https://ai-game.new.ndhy.com', appId = process.env.PARTNER_APP_ID, appSecret = process.env.PARTNER_APP_SECRET } = {}) {
  const base = String(baseUrl).replace(/\/$/, '');
  async function call(method, path, payload, query = '') {
    const body = payload === undefined ? '' : JSON.stringify(payload);
    const signedPath = `${path}${query}`;
    const headers = await buildPartnerHeaders({ appId, appSecret, method, path: signedPath, body });
    let response;
    try { response = await fetchImpl(`${base}${signedPath}`, { method, headers, body: body || undefined, signal: AbortSignal.timeout(15_000), redirect: 'error' }); }
    catch (error) { throw Object.assign(new Error('平台请求未确认，请查询或重试当前作品。'), { status: /timeout/i.test(error.name) ? 504 : 502 }); }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(`平台接口返回 HTTP ${response.status}：${redactPartnerError(data.error || data.message || response.statusText)}`), { status: response.status === 429 ? 429 : response.status >= 500 ? 502 : response.status });
    return data;
  }
  return {
    exchange: payload => call('POST', PARTNER_PATHS.exchange, payload),
    progress: payload => call('POST', PARTNER_PATHS.progress, payload),
    submit: payload => call('POST', PARTNER_PATHS.submit, payload),
    query: externalWorkId => call('GET', PARTNER_PATHS.query, undefined, `?external_work_id=${encodeURIComponent(externalWorkId)}`),
  };
}
