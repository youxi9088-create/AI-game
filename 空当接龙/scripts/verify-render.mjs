import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';

const out = `${process.cwd()}\\verify-render-result.txt`;
const { appendFileSync, writeFileSync } = await import('node:fs');
writeFileSync(out, '');
const write = text => appendFileSync(out, text + '\n');

const fallbackExe = 'C:\\Users\\986916\\AppData\\Local\\ms-playwright\\chromium-1200\\chrome-win64\\chrome.exe';
const browser = await chromium.launch(existsSync(fallbackExe) ? { executablePath: fallbackExe } : {});
const page = await browser.newPage();
page.on('console', msg => { if (msg.type() === 'error') write('[console.error] ' + msg.text().slice(0, 200)); });
page.on('pageerror', err => write('[pageerror] ' + String(err).slice(0, 300)));

try {
  await page.goto('http://127.0.0.1:4173/#library', { waitUntil: 'networkidle' });
  const tileCount0 = await page.locator('.theme-tile').count();
  write(`初始主题数: ${tileCount0}`);

  await page.locator('.server-history summary').click();
  await page.getByRole('button', { name: '恢复服务端生成主题' }).click();
  await page.waitForTimeout(1500);
  const status = await page.locator('.server-history-status').textContent().catch(() => '(无状态文本)');
  write(`恢复状态: ${(status || '').trim()}`);

  const tileCount = await page.locator('.theme-tile').count();
  write(`恢复后主题数: ${tileCount}`);

  const target = page.locator('.theme-tile', { hasText: '水手鸭' }).first();
  if (await target.count() === 0) { write('未找到目标主题 tile，中止'); await browser.close(); process.exit(1); }
  await target.getByRole('button', { name: '应用' }).click();
  await page.waitForTimeout(800);

  await page.getByRole('link', { name: '开始牌局' }).click().catch(() => {});
  await page.goto('http://127.0.0.1:4173/#game', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  const stats = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('.card img.rank-glyph, .card img.suit-motif, .face-art-image img')];
    const byClass = { rankGlyph: 0, suitMotif: 0, faceArt: 0, loaded: 0, broken: 0, notStarted: 0 };
    for (const img of imgs) {
      if (img.classList.contains('rank-glyph')) byClass.rankGlyph++;
      else if (img.classList.contains('suit-motif')) byClass.suitMotif++;
      else byClass.faceArt++;
      if (img.complete && img.naturalWidth > 0) byClass.loaded++;
      else if (img.complete) byClass.broken++;
      else byClass.notStarted++;
    }
    const glyphByRank = {};
    const glyphDebug = {};
    for (const img of document.querySelectorAll('.card .corner b img.rank-glyph')) {
      const rank = img.alt;
      glyphDebug[rank] = glyphDebug[rank] || { style: img.getAttribute('style') || '(none)', cssW: getComputedStyle(img).width };
      const rect = img.getBoundingClientRect();
      glyphByRank[rank] = glyphByRank[rank] || [];
      glyphByRank[rank].push(Math.round(rect.height * 10) / 10);
    }
    return { total: imgs.length, ...byClass, cardCount: document.querySelectorAll('.card').length, cornerText: [...document.querySelectorAll('.corner b')].filter(b => b.textContent.trim()).length, glyphByRank, glyphDebug };
  });
  write(`牌面统计: ${JSON.stringify({ total: stats.total, rankGlyph: stats.rankGlyph, suitMotif: stats.suitMotif, faceArt: stats.faceArt, loaded: stats.loaded, broken: stats.broken, notStarted: stats.notStarted, cardCount: stats.cardCount })}`);
  write('各点数渲染高度(px):');
  const heights = {};
  for (const [rank, list] of Object.entries(stats.glyphByRank)) { heights[rank] = list[0]; write(`  ${rank}: ${list[0]}px  [style: ${stats.glyphDebug[rank].style} / cssW: ${stats.glyphDebug[rank].cssW}]`); }
  const vals = Object.values(heights);
  if (vals.length > 1) write(`视觉高度极差: ${(Math.max(...vals) - Math.min(...vals)).toFixed(1)}px (min ${Math.min(...vals)} / max ${Math.max(...vals)})`);

  // 花色颜色约定检查：红牌（方块/红桃）的花色符号必须是红，黑牌（黑桃/梅花）必须是黑。
  const suitTintCheck = await page.evaluate(async () => {
    const check = async selector => {
      const img = document.querySelector(selector);
      if (!img || !img.complete || !img.naturalWidth) return null;
      const canvas = document.createElement('canvas'); const size = 32; canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, size, size);
      const px = ctx.getImageData(0, 0, size, size).data;
      const samples = [];
      for (let i = 0; i < px.length; i += 4) { if (px[i + 3] > 128) samples.push([px[i], px[i + 1], px[i + 2]]); }
      if (!samples.length) return null;
      samples.sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]));
      const core = samples.slice(0, Math.max(1, Math.floor(samples.length / 4)));
      const avg = core.reduce((acc, s) => [acc[0] + s[0], acc[1] + s[1], acc[2] + s[2]], [0, 0, 0]).map(v => Math.round(v / core.length));
      const darkest = samples[0];
      return { r: avg[0], g: avg[1], b: avg[2], darkest: `rgb(${darkest.join(',')})` };
    };
    return { red: await check('.card.red img.suit-motif'), black: await check('.card.black img.suit-motif') };
  });
  const isReddish = c => c && c.r > c.g + 30 && c.r > c.b + 30;
  const isBlackish = c => c && c.r < 90 && c.g < 90 && c.b < 90;
  write(`花色颜色检查: 红牌符号 RGB=${JSON.stringify(suitTintCheck.red)} (${isReddish(suitTintCheck.red) ? 'PASS 红' : 'FAIL 不是红'}) / 黑牌符号 RGB=${JSON.stringify(suitTintCheck.black)} (${isBlackish(suitTintCheck.black) ? 'PASS 黑' : 'FAIL 不是黑'})`);

  // 中央 pip 可见性检查
  const pipCheck = await page.evaluate(() => {
    const img = document.querySelector('.pip img.suit-motif');
    if (!img) return { found: false };
    const rect = img.getBoundingClientRect();
    return { found: true, complete: img.complete, naturalWidth: img.naturalWidth, rectW: Math.round(rect.width), rectH: Math.round(rect.height), isTint: (img.src || '').startsWith('data:') };
  });
  write(`中央 pip: ${JSON.stringify(pipCheck)}`);

  // 单列特写截图（第一列牌叠）
  const column = page.locator('.column').first();
  if (await column.count()) await column.screenshot({ path: `${process.cwd()}\\column-closeup.png` });

  if (stats.total > 0 && stats.broken === 0 && stats.notStarted === 0) write('RESULT: 牌面图片资产全部正常加载');
  else if (stats.total === 0) write('RESULT: 牌面上没有任何图片资产（纯文字字形）');
  else write('RESULT: 存在加载失败或未完成的图片');

  await page.screenshot({ path: `${process.cwd()}\\verify-render-shot.png`, fullPage: false });
  write('截图已保存');
} finally {
  await browser.close();
}
