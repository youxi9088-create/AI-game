import { test, expect } from '@playwright/test';

/* 写真馆回归：筛选只能改变卡池，不能改变同一张卡的卡型、尺寸或标题区节奏。 */
test('gallery keeps one card system across filters', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByRole('link', { name: '写真馆' }).click();
  await expect(page.locator('.pcard')).toHaveCount(6);

  const all = await page.locator('.pcard-art').evaluateAll((nodes) => nodes.map((node) => {
    const box = node.getBoundingClientRect();
    return { width: +box.width.toFixed(2), height: +box.height.toFixed(2) };
  }));
  const width = all[0].width;
  expect(all.every((box) => Math.abs(box.width - width) <= 1), '全量卡池列宽必须一致').toBe(true);
  expect(all.every((box) => Math.abs(box.width / box.height - 0.75) <= 0.01), '全量卡池必须都是 3:4').toBe(true);
  await page.screenshot({ path: 'test-results/gallery-uniform-all.png', fullPage: true });

  await page.getByRole('button', { name: '银岚', exact: true }).click();
  await expect(page.locator('.pcard')).toHaveCount(1);
  const filtered = await page.locator('.pcard-art').evaluateAll((nodes) => nodes.map((node) => {
    const box = node.getBoundingClientRect();
    return { width: +box.width.toFixed(2), height: +box.height.toFixed(2) };
  }));
  expect(filtered.every((box) => Math.abs(box.width - width) <= 1), '筛选后不得放大或缩小卡面').toBe(true);
  expect(filtered.every((box) => Math.abs(box.width / box.height - 0.75) <= 0.01), '筛选后仍为 3:4').toBe(true);
  await page.screenshot({ path: 'test-results/gallery-uniform-yinlan.png', fullPage: true });
  console.log(`GALLERY CARD ${width}×${all[0].height}; all=${all.length}; yinlan=${filtered.length}`);
});
