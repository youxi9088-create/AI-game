import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const expected = PNG.sync.read(readFileSync('tests/e2e/game.spec.mjs-snapshots/red-diner-face-cards-win32.png'));
const actual = PNG.sync.read(readFileSync('test-results/game-主题库只展示两套已验收主题，红白主题可应用并跨刷新保留/red-diner-face-cards-actual.png'));
if (expected.width !== actual.width || expected.height !== actual.height) { console.log(`size differs: ${expected.width}x${expected.height} vs ${actual.width}x${actual.height}`); process.exit(0); }
let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1, count = 0;
for (let y = 0; y < expected.height; y++) {
  for (let x = 0; x < expected.width; x++) {
    const i = (y * expected.width + x) * 4;
    const dr = Math.abs(expected.data[i] - actual.data[i]);
    const dg = Math.abs(expected.data[i + 1] - actual.data[i + 1]);
    const db = Math.abs(expected.data[i + 2] - actual.data[i + 2]);
    if (dr + dg + db > 30) { count++; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
}
console.log(`diff pixels: ${count}`);
console.log(`bbox: x ${minX}-${maxX}, y ${minY}-${maxY}`);
