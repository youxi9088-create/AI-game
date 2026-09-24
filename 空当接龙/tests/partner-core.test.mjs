import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPartnerHeaders, makeExternalWorkId, normalizeReturnUrl, PARTNER_PATHS, validateExternalPlayUrl, validateProto, validateTemplateId } from '../api/partner-core.mjs';

test('partner signature headers use the documented canonical fields', async () => {
  const headers = await buildPartnerHeaders({ appId: 'freecell-studio', appSecret: 'secret', method: 'POST', path: PARTNER_PATHS.exchange, body: '{"ticket":"t"}', timestamp: 1700000000, nonce: 'nonce-1234567890' });
  assert.equal(headers['x-partner-app-id'], 'freecell-studio');
  assert.equal(headers['x-partner-timestamp'], '1700000000');
  assert.equal(headers['x-partner-nonce'], 'nonce-1234567890');
  assert.equal(headers['x-partner-signature'], '34fcdb6bbc17941e975f963e97ad6673687703f88b19f855f30278f5558b18d4');
});

test('partner launch validation rejects insecure return URLs and unknown templates', () => {
  assert.equal(normalizeReturnUrl('https://example.com/back'), 'https://example.com/back');
  assert.throws(() => normalizeReturnUrl('http://example.com/back'), /HTTPS/);
  assert.equal(validateTemplateId('freecell', ['freecell']), 'freecell');
  assert.throws(() => validateTemplateId('other', ['freecell']), /未登记/);
  assert.equal(validateProto('v0.1'), 'v0.1');
  assert.throws(() => validateProto('v0.2'), /协议版本/);
  assert.equal(validateExternalPlayUrl('https://play.example.test/a/game', 'https://play.example.test'), 'https://play.example.test/a/game');
  assert.throws(() => validateExternalPlayUrl('https://attacker.example.test/a/game', 'https://play.example.test'), /托管域名/);
});

test('external work IDs are stable and constrained', () => {
  assert.equal(makeExternalWorkId('draft-1'), 'freecell-draft-1');
  assert.equal(makeExternalWorkId('draft-1', 'partner-work-42'), 'partner-work-42');
  assert.throws(() => makeExternalWorkId('draft-1', 'bad id'), /external_work_id/);
});
