import { test, expect } from '@playwright/test';

// 临时审计：在浅色（冰爽红白餐厅）与深色（翡翠牌室）主题下截取关键页面，人工核对文字可读性。
test.beforeEach(async ({ page }) => { await page.goto('/?apiPort=4274'); await page.evaluate(() => localStorage.clear()); await page.reload(); });

test('浅色主题下各页面文字可读性审计', async ({ page }) => {
  await page.getByRole('link', { name: '开始游戏' }).click();
  await page.getByRole('link', { name: '主题库' }).click();
  await page.getByRole('button', { name: '应用主题' }).first().click();
  await expect(page.locator('.status')).toContainText('已应用', { timeout: 5_000 });

  await page.goto('/?apiPort=4274#home'); await expect(page.locator('.showcase-badge')).toBeVisible();
  await page.screenshot({ path: '.data/theme-contrast-light-home.png', fullPage: true });

  await page.goto('/?apiPort=4274#studio'); await expect(page.locator('.pipeline-connection')).toBeVisible();
  await page.locator('#prompt').fill('中国水墨山水主题，背景含留白感'); await page.getByRole('button', { name: '生成主题预览' }).click();
  await expect(page.locator('.theme-preview')).toBeVisible({ timeout: 8_000 });
  await page.screenshot({ path: '.data/theme-contrast-light-studio.png', fullPage: true });

  await page.goto('/?apiPort=4274#game'); await page.getByLabel('重置牌局编号').fill('9999999'); await page.getByRole('button', { name: '重置本局 R' }).click();
  await expect(page.locator('.status[data-kind="error"]')).toBeVisible();
  await page.screenshot({ path: '.data/theme-contrast-light-game-error.png', fullPage: true });

  await page.goto('/?apiPort=4274#settings');
  await page.screenshot({ path: '.data/theme-contrast-light-settings.png', fullPage: true });
});

test('深色主题下各页面文字可读性审计', async ({ page }) => {
  await page.goto('/?apiPort=4274#studio'); await expect(page.locator('.pipeline-connection')).toBeVisible();
  await page.locator('#prompt').fill('霓虹夜城'); await page.getByRole('button', { name: '生成主题预览' }).click();
  await expect(page.locator('.theme-preview')).toBeVisible({ timeout: 8_000 });
  await page.screenshot({ path: '.data/theme-contrast-dark-studio.png', fullPage: true });
});
