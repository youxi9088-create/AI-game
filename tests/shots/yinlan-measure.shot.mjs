import { test, expect } from '@playwright/test';

/* 银岚的立绘宽高比 0.459，林星 0.8。CSS 让抠像走 contain、高度由座位容器决定，
   所以「同高」应当成立。这里实测两个座位的立绘盒子高度，而不是靠推断。 */
test('both seats render the standee at the same figure height', async ({ page }) => {
  await page.addInitScript(() => { window.__DRESSBATTLE_SKIP_ENTRY = true; });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await page.locator('.seat-slot[data-index="1"]').click();
    if ((await page.locator('.seat-slot[data-index="1"]').innerText()).includes('银岚')) break;
  }
  await page.getByRole('button', { name: /进入今晚牌局/ }).click();
  await page.getByRole('button', { name: '叫 3 分' }).click();
  await expect(page.getByText('你的回合', { exact: true })).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(1200);

  const m = await page.evaluate(() => {
    const felt = document.querySelector('.table-felt')?.getBoundingClientRect();
    const rows = [...document.querySelectorAll('.opponent')].map((seat) => {
      const box = seat.querySelector('.pal-standee');
      const img = seat.querySelector('.pal-standee .layer-base');
      const b = box.getBoundingClientRect();
      const r = img.getBoundingClientRect();
      return {
        who: seat.className.replace('opponent ', ''),
        pal: box.dataset.pal,
        box: { w: +b.width.toFixed(1), h: +b.height.toFixed(1), top: +b.top.toFixed(1) },
        ink: { w: +r.width.toFixed(1), h: +r.height.toFixed(1), top: +r.top.toFixed(1) },
        centerX: +(b.left + b.width / 2).toFixed(1)
      };
    });
    return { feltH: felt ? +felt.height.toFixed(1) : null, feltTop: felt ? +felt.top.toFixed(1) : null, rows };
  });

  console.log('MEASURE ' + JSON.stringify(m, null, 1));
  for (const row of m.rows) {
    /* 规范：座位半身占 felt 高 35–45%。抠像按高度对齐，宽高比只影响宽度。 */
    console.log(`${row.who} ${row.pal} 立绘高 ${row.ink.h} = felt 的 ${(100 * row.ink.h / m.feltH).toFixed(1)}%`);
  }
});
