import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  const requestPath = decodeURIComponent(req.url.split('?')[0]);
  const relativePath = requestPath === '/' ? 'index.html' : requestPath.replace(/^[/\\]+/, '');
  const path = normalize(join(root, relativePath));
  if (!path.startsWith(normalize(root))) return res.writeHead(403).end('Forbidden');
  try {
    const info = await stat(path);
    if (!info.isFile()) throw new Error('not file');
    res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(await readFile(path));
  } catch { res.writeHead(404).end('Not found'); }
});
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || '127.0.0.1';
server.listen({ port, host }, () => console.log(`FreeCell MVP: http://${host}:${port}`));
