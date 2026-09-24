import { test, expect } from '@playwright/test';

/* 银岚接入验收：名册第三位是否真的能上桌、卡池是否为 6、她的剪影/立绘是否落到位。
   只采集，不断言几何——几何断言归 tests/shots/lens-measure.mjs。 */
test('yinlan sits, collects and stands', async ({ page }) => {
  await page.addInitScript(() => { window.__DRESSBATTLE_SKIP_ENTRY = true; });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  /* 名册到 3 位后选人器才出现（无可换时不显示）——这是它第一次真正露面。 */
  await expect(page.locator('.seat-picker')).toBeVisible();
  await page.screenshot({ path: 'test-results/yinlan-01-home.png', fullPage: true });

  /* 把右座换成银岚：cycleSeat 会跳过已在另一个座位上的人，点一次可能落在米娅上。 */
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await page.locator('.seat-slot[data-index="1"]').click();
    if ((await page.locator('.seat-slot[data-index="1"]').innerText()).includes('银岚')) break;
  }
  await expect(page.locator('.seat-slot[data-index="1"]')).toContainText('银岚');
  await page.screenshot({ path: 'test-results/yinlan-02-seat.png', fullPage: true });

  await page.getByRole('button', { name: /进入今晚牌局/ }).click();
  /* 开局先叫分——不叫完地主定不下来，牌桌不进 PLAYING，永远等不到「你的回合」。 */
  await expect(page.getByText('叫分决定地主')).toBeVisible();
  await page.screenshot({ path: 'test-results/yinlan-03-bid.png', fullPage: true });
  await page.getByRole('button', { name: '叫 3 分' }).click();
  await expect(page.getByText('你的回合', { exact: true })).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'test-results/yinlan-04-table.png', fullPage: true });

  await page.getByRole('link', { name: '写真馆' }).click();
  await expect(page.locator('.pcard')).toHaveCount(6);
  await page.locator('.pcard').last().scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'test-results/yinlan-05-gallery.png', fullPage: true });

  const report = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.pcard')].map((node) => ({
      name: node.querySelector('.pcard-copy h2')?.textContent || '',
      locked: node.classList.contains('locked'),
      video: Boolean(node.querySelector('video.vframe-main'))
    }));
    const seats = [...document.querySelectorAll('.seat-slot b')].map((n) => n.textContent);
    const faces = [...document.querySelectorAll('.seat-face')].map((n) => n.tagName === 'IMG' ? n.getAttribute('src') : `span:${n.style.background}`);
    return { cards, seats, faces };
  });
  console.log('REPORT ' + JSON.stringify(report, null, 1));
});
