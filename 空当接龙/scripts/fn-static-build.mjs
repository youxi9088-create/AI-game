import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const source = relative => fileURLToPath(new URL(`../${relative}`, import.meta.url));
await rm(source('dist'), { recursive: true, force: true });
await mkdir(source('dist'), { recursive: true });
await cp(source('index.html'), source('dist/index.html'));
await cp(source('app'), source('dist/app'), { recursive: true });
// These are retained in the local project for internal review only.  They are
// deliberately omitted from the public FN artifact; production exposes only
// the Jade and Ink theme packages.
await Promise.all([
  'dragon-table-bg.jpg',
  'dragon-card-back.jpg',
  'mouse-table-bg.jpg',
  'mouse-card-back.jpg'
].map(name => rm(source(`dist/app/assets/${name}`), { force: true })));
console.log('FN static frontend assembled in dist/.');
