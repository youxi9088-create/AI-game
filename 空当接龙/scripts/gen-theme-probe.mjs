import { appendFileSync, unlinkSync } from 'node:fs';

const out = `${process.cwd()}\\gen-theme-result.txt`;
try { unlinkSync(out); } catch {}
const write = text => { try { appendFileSync(out, `${text}\n`); } catch {} };

const API = 'http://127.0.0.1:4174/v1';
const post = async (url, body) => { const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: res.status, body: await res.json() }; };
const get = async url => { const res = await fetch(url); return { status: res.status, body: await res.json() }; };

const PROMPT = process.argv[2] || '秋日暖阳的枫叶书房，木质书桌与温暖落叶氛围';
write(`[gen] submitting theme job: ${PROMPT}`);
const start = await post(`${API}/theme-jobs`, { prompt: PROMPT });
write(`[gen] submit status=${start.status} body=${JSON.stringify(start.body)}`);
if (start.status !== 202) { write('[gen] submit failed'); process.exit(1); }

const jobId = start.body.jobId;
const t0 = Date.now();
while (Date.now() - t0 < 20 * 60_000) {
  await new Promise(r => setTimeout(r, 10_000));
  const { body: job } = await get(`${API}/theme-jobs/${jobId}`);
  const minutes = ((Date.now() - t0) / 60_000).toFixed(1);
  write(`[${minutes}m] ${job.status} / ${job.stage} / ${job.progress}% - ${job.message}`);
  if (job.status === 'completed') {
    const theme = job.result.theme;
    const items = theme.assets?.items || [];
    const counts = { rankGlyph: 0, suitMotif: 0, faceCard: 0, background: 0, cardBack: 0 };
    for (const item of items) if (counts[item.kind] !== undefined) counts[item.kind]++;
    write(`[gen] COMPLETED theme="${theme.title}" provider=${theme.generation?.provider}`);
    write(`[gen] asset counts: ${JSON.stringify(counts)}`);
    write(`[gen] rank glyph urls: ${items.filter(i => i.kind === 'rankGlyph').map(i => i.rank).sort((a, b) => a - b).join(',')}`);
    write(`[gen] generation errors: ${JSON.stringify(job.result.errors || [])}`);
    process.exit(0);
  }
  if (job.status === 'failed') { write(`[gen] FAILED: ${job.error}`); process.exit(1); }
}
write('[gen] TIMEOUT after 20 minutes');
process.exit(1);
