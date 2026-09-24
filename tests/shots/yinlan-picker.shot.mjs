import { test, expect } from '@playwright/test';

/* 选人卡验收：银岚应使用同 L1 的近景头像，文案与林星同为“官方牌友”。 */
test('Yinlan picker card matches the official-pal card system', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const slot = page.locator('.seat-slot[data-index="1"]');
  await slot.click();
  await expect(slot).toContainText('银岚');
  await expect(slot).toContainText('官方牌友');
  await expect(slot).not.toContainText('静态肖像');
  await expect(slot.locator('.seat-face')).toHaveAttribute('src', /yinlan-lounge\.png$/);
  await page.locator('.seat-picker').screenshot({ path: 'test-results/yinlan-picker-uniform.png' });
});
