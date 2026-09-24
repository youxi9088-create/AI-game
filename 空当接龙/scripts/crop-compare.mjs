import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const expected = PNG.sync.read(readFileSync('tests/e2e/game.spec.mjs-snapshots/red-diner-face-cards-win32.png'));
const actual = PNG.sync.read(readFileSync('test-results/game-主题库只展示两套已验收主题，红白主题可应用并跨刷新保留/red-diner-face-cards-actual.png'));
const x0 = 540, y0 = 420, w = 160, h = 100;
console.log(`expected: ${expected.width}x${expected.height}, actual: ${actual.width}x${actual.height}`);
const crop = png => { const out = new PNG({ width: w, height: h }); PNG.bitblt(png, out, x0, y0, w, h, 0, 0); return out; };
const e = crop(expected), a = crop(actual);
const side = new PNG({ width: w * 2 + 10, height: h });
side.data.fill(255);
PNG.bitblt(e, side, 0, 0, w, h, 0, 0);
PNG.bitblt(a, side, w + 10, 0, w, h, 0, 0);
writeFileSync('crop-compare.png', PNG.sync.write(side));
console.log('saved crop-compare.png (left=expected, right=actual)');
