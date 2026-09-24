const textEncoder = new TextEncoder();

export const PARTNER_PATHS = {
  exchange: '/v0.1/apecv/minigame/partner/open/ticket/exchange',
  progress: '/v0.1/apecv/minigame/partner/open/work/progress',
  submit: '/v0.1/apecv/minigame/partner/open/work/submit',
  query: '/v0.1/apecv/minigame/partner/open/work/query',
};

const hex = bytes => [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');

export async function sha256Hex(value) {
  const bytes = typeof value === 'string' ? textEncoder.encode(value) : value;
  return hex(await crypto.subtle.digest('SHA-256', bytes));
}

export async function hmacSha256Hex(secret, value) {
  const key = await crypto.subtle.importKey('raw', textEncoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, textEncoder.encode(value)));
}

export async function buildPartnerHeaders({ appId, appSecret, method, path, body = '', timestamp = Math.floor(Date.now() / 1000), nonce = crypto.randomUUID().replaceAll('-', '') }) {
  if (!appId || !appSecret) throw new Error('第三方平台凭证未配置。');
  const upperMethod = String(method).toUpperCase();
  const bodyHash = await sha256Hex(body);
  const signing = [appId, String(timestamp), nonce, upperMethod, path, bodyHash].join('\n');
  const signature = await hmacSha256Hex(appSecret, signing);
  return {
    'content-type': 'application/json',
    'x-partner-app-id': appId,
    'x-partner-timestamp': String(timestamp),
    'x-partner-nonce': nonce,
    'x-partner-signature': signature,
  };
}

export function normalizeReturnUrl(value, { allowHttp = false } = {}) {
  const url = new URL(String(value || ''));
  if (!allowHttp && url.protocol !== 'https:') throw new Error('return_url 必须使用 HTTPS。');
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('return_url 协议不受支持。');
  return url.href;
}

export function validateExternalPlayUrl(value, configuredBase, { allowHttp = false } = {}) {
  const url = new URL(String(value || ''));
  if (!allowHttp && url.protocol !== 'https:') throw new Error('play_url 必须使用 HTTPS。');
  if (!configuredBase) throw new Error('PARTNER_PUBLIC_BASE_URL 未配置。');
  const expectedOrigin = new URL(configuredBase).origin;
  if (url.origin !== expectedOrigin) throw new Error('play_url 不在已配置的外部托管域名内。');
  return url.href;
}

export function validateTemplateId(value, allowed = []) {
  const templateId = String(value || '').trim();
  if (!templateId || !/^[A-Za-z0-9._:-]{1,100}$/.test(templateId)) throw new Error('template_id 无效。');
  if (allowed.length && !allowed.includes(templateId)) throw new Error('template_id 未登记。');
  return templateId;
}

export function validateProto(value) {
  const proto = String(value || 'v0.1').trim();
  if (proto !== 'v0.1') throw new Error('不支持的 partner 协议版本。');
  return proto;
}

export function makeExternalWorkId(draftId, supplied) {
  const candidate = String(supplied || `freecell-${draftId}`).trim();
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(candidate)) throw new Error('external_work_id 无效。');
  return candidate;
}

export function redactPartnerError(error) {
  return String(error?.message || error || '第三方平台请求失败').replace(/Bearer\s+\S+/gi, 'Bearer [已隐藏]').slice(0, 500);
}

export function partnerErrorStatus(error) {
  return /平台接口|fetch failed|timeout|timed out|AbortError|网络/i.test(String(error?.message || error || '')) ? 502 : 400;
}
