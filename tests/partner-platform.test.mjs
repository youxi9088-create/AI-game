import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PartnerPlatformClient, partnerConfigFromEnv, signPartnerRequest } from '../apps/api/partner-platform.mjs';
import { PartnerSessionStore } from '../apps/api/partner-session-store.mjs';

const APP_ID = 'dressbattle-test';
const APP_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

function expectedSignature({ appId, timestamp, nonce, method, signedPath, body }) {
  const signing = [appId, timestamp, nonce, method, signedPath, createHash('sha256').update(body).digest('hex')].join('\n');
  return createHmac('sha256', appSecretOf(appId)).update(signing).digest('hex');
}
const appSecretOf = () => APP_SECRET;

test('signing string follows the platform contract exactly', () => {
  const body = Buffer.from(JSON.stringify({ ticket: 't-1' }), 'utf8');
  const { timestamp, nonce, signature } = signPartnerRequest({ appId: APP_ID, appSecret: APP_SECRET, method: 'POST', signedPath: '/v0.1/apecv/minigame/partner/open/ticket/exchange', body });
  assert.match(timestamp, /^\d{10}$/);
  assert.match(nonce, /^[0-9a-f]{32}$/);
  const expected = createHmac('sha256', APP_SECRET)
    .update([APP_ID, timestamp, nonce, 'POST', '/v0.1/apecv/minigame/partner/open/ticket/exchange', createHash('sha256').update(body).digest('hex')].join('\n'))
    .digest('hex');
  assert.equal(signature, expected, 'HMAC must match the documented signing string');
});

test('config reports fingerprint as first 12 hex chars of sha256(app_secret)', () => {
  const config = partnerConfigFromEnv({ PARTNER_APP_ID: APP_ID, PARTNER_APP_SECRET: APP_SECRET });
  assert.equal(config.secretFingerprint, createHash('sha256').update(APP_SECRET).digest('hex').slice(0, 12));
  assert.equal(config.configured, true);
  assert.equal(partnerConfigFromEnv({}).configured, false, 'unconfigured env must be reported honestly');
});

function stubFetch(captured, responder) {
  return async (url, options) => {
    captured.push({ url, options });
    const { status, payload } = responder({ url, options });
    return { ok: status < 400, status, json: async () => payload };
  };
}

test('ticket exchange posts signed JSON with partner headers and no secret leakage', async () => {
  const captured = [];
  const client = new PartnerPlatformClient(partnerConfigFromEnv({ PARTNER_APP_ID: APP_ID, PARTNER_APP_SECRET: APP_SECRET, PARTNER_PLATFORM_BASE: 'https://platform.test' }), {
    fetchImpl: stubFetch(captured, () => ({ status: 200, payload: { user_ref: 'u-1', draft_id: 'd-1', template_id: 'dressbattle', expire_at: '2026-09-20T00:00:00Z' } }))
  });
  const out = await client.ticketExchange({ ticket: 't-1', partnerSessionId: 's-1' });
  assert.equal(out.draft_id, 'd-1');
  const { url, options } = captured[0];
  assert.equal(url, 'https://platform.test/v0.1/apecv/minigame/partner/open/ticket/exchange');
  const body = options.body;
  const expected = createHmac('sha256', APP_SECRET)
    .update([APP_ID, options.headers['X-Partner-Timestamp'], options.headers['X-Partner-Nonce'], 'POST', '/v0.1/apecv/minigame/partner/open/ticket/exchange', createHash('sha256').update(body).digest('hex')].join('\n'))
    .digest('hex');
  assert.equal(options.headers['X-Partner-Signature'], expected, 'signature header must match the exact sent bytes');
  assert.ok(!JSON.stringify(options.headers).includes(APP_SECRET), 'app_secret must never appear in headers');
});

test('work submit sends external hosting payload and maps platform errors', async () => {
  const captured = [];
  const config = partnerConfigFromEnv({ PARTNER_APP_ID: APP_ID, PARTNER_APP_SECRET: APP_SECRET, PARTNER_PLATFORM_BASE: 'https://platform.test', PARTNER_PLAY_URL: 'https://play.example.com/game', PARTNER_COVER_URL: 'https://cdn.example.com/cover.png' });
  const client = new PartnerPlatformClient(config, {
    fetchImpl: stubFetch(captured, ({ url }) => url.includes('submit')
      ? { status: 200, payload: { work_id: 'w-1', work_url: 'https://platform.test/works/w-1', state: 'pending_confirm' } }
      : { status: 403, payload: { code: 'APECV/PARTNER_DOMAIN_NOT_ALLOWED', message: 'URL 不在白名单' } })
  });
  const ok = await client.workSubmit({ draftId: 'd-1', externalWorkId: 'ew-1', title: '换装斗地主', description: 'x' });
  assert.equal(ok.work_id, 'w-1');
  const submitBody = JSON.parse(captured[0].options.body.toString());
  assert.equal(submitBody.hosting, 'external');
  assert.equal(submitBody.play_url, 'https://play.example.com/game');
  assert.equal(submitBody.cover_url, 'https://cdn.example.com/cover.png');
  assert.equal(submitBody.orientation, 'landscape');
  await assert.rejects(() => client.workQuery('ew-1'), /APECV\/PARTNER_DOMAIN_NOT_ALLOWED/, 'platform business errors must surface with their code');
});

test('work query signs GET with normalized query and empty-body hash', async () => {
  const captured = [];
  const client = new PartnerPlatformClient(partnerConfigFromEnv({ PARTNER_APP_ID: APP_ID, PARTNER_APP_SECRET: APP_SECRET, PARTNER_PLATFORM_BASE: 'https://platform.test' }), {
    fetchImpl: stubFetch(captured, () => ({ status: 200, payload: { work_id: 'w-1', state: 'pending_confirm' } }))
  });
  await client.workQuery('ew 1/中文');
  const { url, options } = captured[0];
  assert.ok(url.includes(encodeURIComponent('ew 1/中文')), 'query must be URL-encoded');
  const signedPath = `/v0.1/apecv/minigame/partner/open/work/query?external_work_id=${encodeURIComponent('ew 1/中文')}`;
  const expected = createHmac('sha256', APP_SECRET)
    .update([APP_ID, options.headers['X-Partner-Timestamp'], options.headers['X-Partner-Nonce'], 'GET', signedPath, createHash('sha256').update(Buffer.alloc(0)).digest('hex')].join('\n'))
    .digest('hex');
  assert.equal(options.headers['X-Partner-Signature'], expected, 'GET signature must use path+normalized_query and empty body hash');
});

test('session store persists and returns stable external work ids across restarts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'partner-sessions-'));
  try {
    const path = join(dir, 'sessions.json');
    const store = new PartnerSessionStore(path);
    const session = store.create({ userRef: 'u-1', draftId: 'd-1', externalWorkId: 'dressbattle-d-1' });
    const reopened = new PartnerSessionStore(path);
    const found = reopened.get(session.sessionId);
    assert.equal(found.externalWorkId, 'dressbattle-d-1', 'external_work_id must stay stable for idempotent submit');
    reopened.update(session.sessionId, { status: 'submitted', workId: 'w-1' });
    assert.equal(new PartnerSessionStore(path).get(session.sessionId).status, 'submitted');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('unconfigured client fails honestly before any network call', async () => {
  const client = new PartnerPlatformClient(partnerConfigFromEnv({}), { fetchImpl: () => { throw new Error('network must not be called'); } });
  await assert.rejects(() => client.ticketExchange({ ticket: 't' }), /未配置/);
});
