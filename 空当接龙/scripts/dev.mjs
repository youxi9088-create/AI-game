import { spawn } from 'node:child_process';

const webPort = process.env.WEB_PORT || '4173';
const apiPort = process.env.API_PORT || '4174';
const webOrigin = process.env.WEB_ORIGIN || `http://localhost:${webPort},http://127.0.0.1:${webPort}`;
const children = [
  spawn(process.execPath, ['scripts/serve.mjs'], { stdio: 'inherit', env: { ...process.env, PORT: webPort } }),
  spawn(process.execPath, ['api/server.mjs'], { stdio: 'inherit', env: { ...process.env, PORT: apiPort, WEB_ORIGIN: webOrigin } }),
];
const stop = () => { for (const child of children) if (!child.killed) child.kill(); };
process.on('SIGINT', () => { stop(); process.exit(0); }); process.on('SIGTERM', () => { stop(); process.exit(0); });
for (const child of children) child.on('exit', code => { if (code && code !== 0) { stop(); process.exitCode = code; } });
