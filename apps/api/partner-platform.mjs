import { createHash, createHmac, randomBytes } from 'node:crypto';

/* 第三方模板接入 AI 游戏平台：服务端签名客户端（文档《第三方游戏模板接入操作文档》第六、七节）。
   签名原文：app_id \n timestamp \n nonce \n METHOD \n signed_path \n sha256(raw_body)。
   POST 的 signed_path 不含域名与查询串；GET 只允许 external_work_id 单参数查询，
   signed_path = path + "?" + normalized_query；GET 正文按空字节串取 SHA-256。
   app_secret 只允许存在于本后端，绝不下发前端、不写日志。 */

const DEFAULT_BASE = 'https://ai-game.new.ndhy.com';
const sha256Hex = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function partnerConfigFromEnv(env = process.env) {
  const appId = String(env.PARTNER_APP_ID || '').trim();
  const appSecret = String(env.PARTNER_APP_SECRET || '').trim();
  return {
    configured: Boolean(appId && appSecret),
    base: String(env.PARTNER_PLATFORM_BASE || DEFAULT_BASE).trim().replace(/\/$/, ''),
    appId,
    appSecret,
    playUrl: String(env.PARTNER_PLAY_URL || '').trim(),
    coverUrl: String(env.PARTNER_COVER_URL || '').trim(),
    hosting: String(env.PARTNER_HOSTING || 'external').trim() === 'package' ? 'package' : 'external',
    orientation: String(env.PARTNER_ORIENTATION || 'landscape').trim(),
    embeddable: String(env.PARTNER_EMBEDDABLE || 'true').trim() !== 'false',
    secretFingerprint: appSecret ? sha256Hex(appSecret).slice(0, 12) : null
  };
}

export function signPartnerRequest({ appId, appSecret, method, signedPath, body }) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomBytes(16).toString('hex');
  const signing = [appId, timestamp, nonce, method.toUpperCase(), signedPath, sha256Hex(body)].join('\n');
  return {
    timestamp,
    nonce,
    signature: createHmac('sha256', appSecret).update(signing).digest('hex')
  };
}

function businessErrorMessage(payload, status) {
  const code = payload?.code || payload?.error_code || '';
  const message = payload?.message || payload?.error || '';
  if (code || message) return `${code ? `${code}：` : ''}${message || `HTTP ${status}`}`;
  return `平台接口返回异常（HTTP ${status}）。`;
}

export class PartnerPlatformClient {
  constructor(config = partnerConfigFromEnv(), { fetchImpl = fetch } = {}) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  capability() {
    return {
      configured: this.config.configured,
      base: this.config.base,
      appId: this.config.configured ? this.config.appId : null,
      secretFingerprint: this.config.secretFingerprint,
      hosting: this.config.hosting,
      playUrlConfigured: Boolean(this.config.playUrl)
    };
  }

  requireConfigured() {
    if (!this.config.configured) throw new Error('平台接入未配置：请在 .env.production.local 设置 PARTNER_APP_ID 与 PARTNER_APP_SECRET。');
  }

  async post(path, payload) {
    this.requireConfigured();
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    const { timestamp, nonce, signature } = signPartnerRequest({ appId: this.config.appId, appSecret: this.config.appSecret, method: 'POST', signedPath: path, body });
    const response = await this.fetchImpl(`${this.config.base}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Partner-App-Id': this.config.appId,
        'X-Partner-Timestamp': timestamp,
        'X-Partner-Nonce': nonce,
        'X-Partner-Signature': signature
      },
      body,
      signal: AbortSignal.timeout(20_000)
    });
    const payloadOut = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(businessErrorMessage(payloadOut, response.status));
    return payloadOut;
  }

  async get(path, query = {}) {
    this.requireConfigured();
    const entries = Object.entries(query).filter(([, value]) => value !== undefined && value !== null);
    if (entries.length > 1 || (entries.length === 1 && entries[0][0] !== 'external_work_id')) throw new Error('GET 查询只允许 external_work_id 单参数。');
    const normalized = entries.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`).join('&');
    const signedPath = normalized ? `${path}?${normalized}` : path;
    const { timestamp, nonce, signature } = signPartnerRequest({ appId: this.config.appId, appSecret: this.config.appSecret, method: 'GET', signedPath, body: Buffer.alloc(0) });
    const response = await this.fetchImpl(`${this.config.base}${path}${normalized ? `?${normalized}` : ''}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Partner-App-Id': this.config.appId,
        'X-Partner-Timestamp': timestamp,
        'X-Partner-Nonce': nonce,
        'X-Partner-Signature': signature
      },
      signal: AbortSignal.timeout(20_000)
    });
    const payloadOut = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(businessErrorMessage(payloadOut, response.status));
    return payloadOut;
  }

  ticketExchange({ ticket, partnerSessionId }) {
    return this.post('/v0.1/apecv/minigame/partner/open/ticket/exchange', { ticket, partner_session_id: partnerSessionId });
  }

  workProgress({ draftId, percent, stage, message }) {
    return this.post('/v0.1/apecv/minigame/partner/open/work/progress', { draft_id: draftId, percent, stage, message });
  }

  workQuery(externalWorkId) {
    return this.get('/v0.1/apecv/minigame/partner/open/work/query', { external_work_id: externalWorkId });
  }

  /* 作品回传：external 外部托管需要 play_url；package 需要 package_url + package_sha256。 */
  workSubmit({ draftId, externalWorkId, status = 'ready', title, description = '', failReason = null, packageUrl = null, packageSha256 = null, metaJson = '{}' }) {
    const payload = {
      draft_id: draftId,
      external_work_id: externalWorkId,
      status,
      hosting: this.config.hosting,
      title,
      description,
      orientation: this.config.orientation,
      meta_json: metaJson
    };
    if (status === 'failed') payload.fail_reason = String(failReason || '生成失败');
    if (this.config.hosting === 'external') {
      payload.play_url = this.config.playUrl;
      payload.cover_url = this.config.coverUrl || undefined;
      payload.embeddable = this.config.embeddable;
    } else {
      payload.package_url = packageUrl || this.config.playUrl;
      payload.package_sha256 = packageSha256;
      payload.cover_url = this.config.coverUrl || undefined;
    }
    return this.post('/v0.1/apecv/minigame/partner/open/work/submit', payload);
  }
}
