import { access } from 'node:fs/promises';
const expected = ['apps/web/index.html', 'apps/web/app.js', 'apps/web/styles.css', 'apps/api/server.mjs', 'packages/contracts/index.mjs', 'packages/ddz-rules/index.mjs', 'packages/ddz-ai/index.mjs', 'packages/performance-core/index.mjs'];
await Promise.all(expected.map((file) => access(file)));
console.log(`Build boundary check passed: ${expected.length} runtime artifacts are present.`);
