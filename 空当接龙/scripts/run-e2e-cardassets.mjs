import { spawn } from 'node:child_process';
import { appendFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = here.replace(/\\scripts$/, '');
const outFile = `${root}\\runner-result.txt`;
try { unlinkSync(outFile); } catch {}
const write = (text) => { try { appendFileSync(outFile, typeof text === 'string' ? text : text.toString()); } catch {} };
write(`[runner] start, root=${root}\n`);

const node = process.execPath;
process.on('uncaughtException', err => { write(`[runner] uncaught: ${err.stack}\n`); process.exitCode = 1; });

let exitCode = 1;
exitCode = await new Promise(resolve => {
  const grep = process.env.E2E_GREP === 'ALL' ? '' : (process.env.E2E_GREP || '牌面渲染');
  const args = [`${root}\\node_modules\\@playwright\\test\\cli.js`, 'test', ...(grep ? ['--grep', grep] : [])];
  if (process.env.E2E_UPDATE === '1') args.push('--update-snapshots');
  const pw = spawn(node, args, {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' },
  });
  pw.on('error', e => { write(`[runner] playwright spawn err: ${e.message}\n`); resolve(1); });
  pw.stdout.on('data', write); pw.stderr.on('data', write);
  pw.on('close', code => { write(`[runner] playwright exit=${code}\n`); resolve(code ?? 1); });
});
write('[runner] done\n');
process.exitCode = exitCode;
