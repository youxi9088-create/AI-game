import { resolve } from 'node:path';

process.env.THEME_DB_PATH = resolve('.data/e2e-theme-freecell.sqlite');
process.env.THEME_ASSET_DIR = resolve('.data/e2e-theme-assets');
process.env.WEB_ORIGIN = 'http://127.0.0.1:4273';
process.env.THEME_GENERATOR_MODE = 'mock';
const { createServer } = await import('../api/server.mjs');
const app = createServer({ allowMock: true });
await app.listen({ port: 4274, host: '127.0.0.1' });
