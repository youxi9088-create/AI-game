import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createPartnerService } from '../api/partner-service.mjs';
import { sqlitePartnerStore } from '../api/partner-store.mjs';
import { createPartnerClient } from '../api/partner-client.mjs';

function fixture() {
  const db = new DatabaseSync(':memory:'); const store = sqlitePartnerStore(db);
  const jobs = new Map(); const submissions = []; let queried = 0; let state = 'pending_confirm'; let loseResponse = false; let launches = 0;
  const client = {
    exchange: async ({ ticket }) => ({ draft_id: `draft-${ticket}`, user_ref: `user-${ticket}`, template_id: 'freecell', submit_deadline: new Date(Date.now() + 86400000).toISOString() }),
    submit: async payload => { submissions.push(structuredClone(payload)); if (loseResponse) { loseResponse = false; throw Object.assign(new Error('network'), { status: 502 }); } return { work_id: 'platform-work', state }; },
    query: async id => { queried++; return { work_id: 'platform-work', external_work_id: id, state }; },
    progress: async payload => payload,
  };
  const config = { appId: 'test', secret: 'test-secret', templates: ['freecell'], publicBase: 'https://play.example/a/freecell/' };
  const create = () => createPartnerService({ store, client, config, startJob: async (prompt, id) => { launches++; jobs.set(id, { status: 'completed', result: { theme: { themeId: `theme-${id}`, title: prompt } } }); }, readJob: async id => jobs.get(id) });
  const service = create();
  const call = (method, route, body = {}, id = '') => service.handle(method, `/v1/partner/${route}`, body, id);
  const session = async ticket => (await call('POST', 'session', { ticket, template_id: 'freecell', return_url: 'https://platform.example/my-games', proto: 'v0.1' })).body;
  return { db, store, service, call, session, jobs, submissions, create, client, config, setState: v => state = v, lose: () => loseResponse = true, queried: () => queried, launches: () => launches };
}

test('draft survives service restart, binds one job, rejects changed prompt and guessed session', async () => {
  const f = fixture(); const d = await f.session('a');
  assert.equal(d.return_url, 'https://platform.example/my-games');
  assert.equal((await f.call('GET', 'session', {}, 'guessed')).status, 404);
  const first = await f.call('POST', 'jobs', { prompt: '水墨' }, d.session_id);
  assert.equal((await f.call('POST', 'jobs', { prompt: '水墨' }, d.session_id)).body.jobId, first.body.jobId);
  assert.equal((await f.call('POST', 'jobs', { prompt: '其他' }, d.session_id)).status, 409);
  const restored = await f.create().handle('GET', '/v1/partner/session', {}, d.session_id);
  assert.equal(restored.body.jobId, first.body.jobId); assert.equal(f.launches(), 1);
  f.db.close();
});

test('platform template mismatch is rejected and deadline is enforced', async () => {
  const f = fixture(); f.client.exchange = async () => ({ draft_id: 'x', user_ref: 'u', template_id: 'other', submit_deadline: new Date(Date.now()+10000).toISOString() });
  assert.equal((await f.call('POST','session',{ticket:'x',template_id:'freecell',return_url:'https://example.com',proto:'v0.1'})).status,502);
  f.db.close();
});

test('server creates dedicated work URL and immutable snapshot; cross draft submit/query never reaches upstream', async () => {
  const f = fixture(); const a = await f.session('a'), b = await f.session('b');
  await f.call('POST', 'jobs', { prompt: '水墨' }, a.session_id);
  const done = await f.call('POST', 'submit', { play_url: 'https://attacker.example' }, a.session_id);
  assert.equal(done.status, 200);
  assert.equal(new URL(f.submissions[0].play_url).origin, 'https://play.example');
  assert.equal(new URL(f.submissions[0].play_url).searchParams.get('work'), done.body.external_work_id);
  assert.equal((await f.call('POST','submit',{external_work_id:done.body.external_work_id},b.session_id)).status,409);
  assert.equal((await f.call('GET','query',{external_work_id:done.body.external_work_id},b.session_id)).status,404);
  assert.equal(f.queried(),0);
  assert.equal((await f.call('POST','submit',{},a.session_id)).body.idempotent,true);
  assert.equal(f.submissions.length,1); f.db.close();
});

test('lost submit response can be reconciled only through persisted owner binding', async () => {
  const f = fixture(); const a = await f.session('a'); await f.call('POST','jobs',{prompt:'翡翠'},a.session_id);
  f.lose(); assert.equal((await f.call('POST','submit',{},a.session_id)).status,502);
  assert.equal((await f.call('GET','query',{},a.session_id)).status,200);
  assert.equal((await f.call('POST','submit',{},a.session_id)).body.idempotent,true);
  assert.equal(f.submissions.length,1); f.db.close();
});

test('failed generation submits failed without requiring play URL or claiming ready', async () => {
  const f=fixture(); const a=await f.session('a'); const j=await f.call('POST','jobs',{prompt:'失败'},a.session_id);
  f.jobs.set(j.body.jobId,{status:'failed',error:'Provider failed'});
  assert.equal((await f.call('POST','submit',{status:'ready'},a.session_id)).status,409);
  await f.call('POST','submit',{},a.session_id);
  assert.equal(f.submissions[0].status,'failed'); assert.equal(f.submissions[0].play_url,undefined);
  f.db.close();
});

test('public work is gated by live platform publication and revoked after offline', async () => {
  const f=fixture(); const a=await f.session('a'); await f.call('POST','jobs',{prompt:'翡翠'},a.session_id);
  const w=await f.call('POST','submit',{},a.session_id); const route=`works/${w.body.external_work_id}`;
  assert.equal((await f.call('GET',route)).status,410);
  f.setState('published'); const opened=await f.call('GET',route); assert.equal(opened.status,200); assert.equal(opened.body.theme.title,'翡翠');
  f.setState('offline'); assert.equal((await f.call('GET',route)).status,410); f.db.close();
});

test('client signs exact sent bytes, rotates nonce, and classifies upstream errors', async () => {
  const calls=[]; const client=createPartnerClient({appId:'a',appSecret:'s',baseUrl:'https://platform.example',fetchImpl:async (url,options)=>{calls.push({url,options});return Response.json({error:'unavailable'},{status:503});}});
  await assert.rejects(client.submit({title:'中文'}),e=>e.status===502);
  await assert.rejects(client.submit({title:'中文'}),e=>e.status===502);
  assert.equal(calls[0].options.body,'{"title":"中文"}');
  assert.notEqual(calls[0].options.headers['x-partner-nonce'],calls[1].options.headers['x-partner-nonce']);
});
