import { test, expect } from '@playwright/test';

/* 矮视口（720 高）首屏：选人器是这里最容易翻车的一块——既不能被挤出视口，
   也不能为了省高度把自己压扁到认不出人。留图不是为了做几何断言（那是
   home-overflow 的活），是为了肉眼确认「省下来的是间距，不是人物的脸」。 */
for (const size of [{ width: 1024, height: 720 }, { width: 1280, height: 720 }]) {
  test(`home at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.seat-picker')).toBeVisible();
    await page.screenshot({ path: `test-results/home-short-${size.width}.png` });
  });
}
