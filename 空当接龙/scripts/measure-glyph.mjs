import { chromium } from '@playwright/test';
import { existsSync, writeFileSync, appendFileSync } from 'node:fs';

const out = `${process.cwd()}\\glyph-measure-result.txt`;
writeFileSync(out, '');
const write = text => appendFileSync(out, text + '\n');

const fallbackExe = 'C:\\Users\\986916\\AppData\\Local\\ms-playwright\\chromium-1200\\chrome-win64\\chrome.exe';
const browser = await chromium.launch(existsSync(fallbackExe) ? { executablePath: fallbackExe } : {});
const page = await browser.newPage();
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });

const data = await page.evaluate(async () => {
  const api = 'http://127.0.0.1:4174/v1';
  const themes = await (await fetch(`${api}/themes`)).json();
  const latest = themes.filter(t => t.source === 'generated').sort((a, b) => b.themeId.localeCompare(a.themeId))[0];
  const glyphs = (latest.assets?.items || []).filter(i => i.kind === 'rankGlyph');
  const results = [];
  for (const g of glyphs) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = api + g.url.slice(3); });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const { data: pixels } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let minX = canvas.width, minY = canvas.height, maxX = -1, maxY = -1;
    for (let y = 0; y < canvas.height; y += 2) for (let x = 0; x < canvas.width; x += 2) {
      const i = (y * canvas.width + x) * 4;
      const lum = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
      if (lum < 245) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
    results.push({ rank: g.rank, hPct: Math.round(100 * (maxY - minY) / canvas.height), wPct: Math.round(100 * (maxX - minX) / canvas.width) });
  }
  return results;
});
write('rank | 字符高度占画布% | 字符宽度占画布%');
for (const r of data.sort((a, b) => a.rank - b.rank)) write(`${String(r.rank).padStart(2)}  | ${String(r.hPct).padStart(3)}% | ${String(r.wPct).padStart(3)}%`);
const hs = data.map(r => r.hPct);
write(`高度范围: ${Math.min(...hs)}% ~ ${Math.max(...hs)}%（极差 ${Math.max(...hs) - Math.min(...hs)} 个百分点）`);
await browser.close();
