import { chromium } from '@playwright/test';
import { existsSync, writeFileSync, appendFileSync } from 'node:fs';

const out = `${process.cwd()}\\glyph-debug-result.txt`;
writeFileSync(out, '');
const write = text => appendFileSync(out, text + '\n');

const fallbackExe = 'C:\\Users\\986916\\AppData\\Local\\ms-playwright\\chromium-1200\\chrome-win64\\chrome.exe';
const browser = await chromium.launch(existsSync(fallbackExe) ? { executablePath: fallbackExe } : {});
const page = await browser.newPage();
await page.goto('http://127.0.0.1:4173/#library', { waitUntil: 'networkidle' });

await page.locator('.server-history summary').click();
await page.getByRole('button', { name: '恢复服务端生成主题' }).click();
await page.waitForTimeout(1500);
await page.locator('.theme-tile', { hasText: '水手鸭' }).first().getByRole('button', { name: '应用' }).click();
await page.waitForTimeout(800);
await page.goto('http://127.0.0.1:4173/#game', { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

const debug = await page.evaluate(() => {
  const saved = JSON.parse(localStorage.getItem('theme-freecell-mvp') || '{}');
  const theme = saved.theme || {};
  const glyphs = (theme.assets?.items || []).filter(i => i.kind === 'rankGlyph');
  const imgInfo = [...document.querySelectorAll('.card .corner b img.rank-glyph')].map(img => ({ alt: img.alt, inlineStyle: img.getAttribute('style') || '(none)', rectH: Math.round(img.getBoundingClientRect().height * 10) / 10 }));
  return { themeTitle: theme.title, glyphs: glyphs.map(g => ({ rank: g.rank, glyphScale: g.glyphScale, v: g.glyphScaleVersion })), imgInfo: imgInfo.filter((x, i, arr) => arr.findIndex(y => y.alt === x.alt) === i) };
});
write('主题: ' + debug.themeTitle);
write('glyphScale 表: ' + JSON.stringify(debug.glyphs));
write('DOM（每 rank 一条）:');
for (const info of debug.imgInfo) write('  ' + info.alt + ': ' + info.inlineStyle + ' => ' + info.rectH + 'px');
await page.screenshot({ path: `${process.cwd()}\\glyph-debug-shot.png` });
await browser.close();
