import { test, expect } from '@playwright/test';

/* 主题基于无序座位组合，而不是第几号座位：默认组合、林星+银岚、米娅+银岚
   都必须稳定落在各自主题，座位位置互换时也不能重置为默认背景。 */
test('default Linxing plus Mia game keeps the moonlit club table theme', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /进入今晚牌局/ }).click();
  await expect(page.locator('.table-felt')).toHaveAttribute('data-table-theme', 'moonlit-club');
});

test('Mia plus Yinlan game selects the mint neon table theme', async ({ page }) => {
  await page.goto('/');
  /* 先把右座米娅换成银岚，再把左座林星换成米娅，保持两人不重复。 */
  await page.locator('.seat-slot[data-index="1"]').click();
  await page.locator('.seat-slot[data-index="0"]').click();
  await expect(page.locator('.seat-slot[data-index="0"]')).toContainText('米娅');
  await expect(page.locator('.seat-slot[data-index="1"]')).toContainText('银岚');
  await page.getByRole('button', { name: /进入今晚牌局/ }).click();
  await expect(page.locator('.table-felt')).toHaveAttribute('data-table-theme', 'mint-neon');
});

test('a legacy preset photo card is repaired into a playable Yinlan card detail', async ({ page }) => {
  await page.route('**/api/gallery', async (route) => {
    const upstream = await route.fetch();
    const body = await upstream.json();
    body.cards = [...(body.cards || []).filter((card) => card.cardId !== 'pal-yinlan:default-stage'), {
      /* This is the exact broken record shape: a server fallback leaked a preset:// URI. */
      cardId: 'pal-yinlan:default-stage', palId: 'pal-yinlan', outfitId: 'default-stage',
      outfitName: '薄荷舞台装', dance: '彩带律动', serialNo: 1, rarity: 'first', upgradeLevel: 1,
      seen: false, unlockedAt: '2026-09-15T00:00:00.000Z', auditRecordId: 'audit-official-pal-yinlan-v1',
      layerSnapshot: {
        base: 'preset://pal-yinlan/portrait-v1', outfit: 'preset://pal-yinlan/portrait-v1'
      }
    }];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto('/#/gallery');
  const card = page.locator('.pcard[data-card="pal-yinlan:court-dusk"]');
  await expect(card).toBeVisible();
  await card.click();
  /* 详情页卡面与导出 PNG 一致：渲染 layers.outfit 分层静态图（跳舞留给「回看跳舞」回放）。 */
  await expect(page.locator('.card-detail video')).toHaveCount(0);
  const detailStill = page.locator('.card-detail .pcard-art img.layer-outfit');
  await expect(detailStill).toBeVisible();
  await expect(detailStill).toHaveAttribute('src', /yinlan-court-dusk-frame\.jpg$/);
  await expect.poll(() => detailStill.evaluate((img) => img.naturalWidth > 0)).toBe(true);
  await expect(page.locator('.detail-info')).toContainText('暮色球场');
  // 详情框为 position:fixed；全页拼图会把它贴到滚动前的文档坐标，不能代表点击后的真实可见视口。
  await page.screenshot({ path: 'test-results/repaired-yinlan-card-detail-viewport.png' });
});
