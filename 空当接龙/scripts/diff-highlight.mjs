import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const expected = PNG.sync.read(readFileSync('tests/e2e/game.spec.mjs-snapshots/red-diner-face-cards-win32.png'));
const actual = PNG.sync.read(readFileSync('test-results/game-主题库只展示两套已验收主题，红白主题可应用并跨刷新保留/red-diner-face-cards-actual.png'));
console.log(`expected: ${expected.width}x${expected.height}, actual: ${actual.width}x${actual.height}`);
const highlight = new PNG({ width: expected.width, height: expected.height });
highlight.data.set(actual.data);
for (let y = 0; y < expected.height; y++) {
  for (let x = 0; x < expected.width; x++) {
    const i = (y * expected.width + x) * 4;
    const dr = Math.abs(expected.data[i] - actual.data[i]);
    const dg = Math.abs(expected.data[i + 1] - actual.data[i + 1]);
    const db = Math.abs(expected.data[i + 2] - actual.data[i + 2]);
    if (dr + dg + db > 30) { highlight.data[i] = 255; highlight.data[i + 1] = 0; highlight.data[i + 2] = 0; }
  }
}
writeFileSync('diff-highlight.png', PNG.sync.write(highlight));
console.log('saved diff-highlight.png');
