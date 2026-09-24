import { test, expect } from '@playwright/test';

/* 名册是运行时数据：银岚上桌后，首页 L1 主视觉、入场段的媒体、名字、牌桌 L2 立绘
   都必须一起换掉。此前入场写死林星 + 米娅，换人只改了牌桌而没改演出，正是这个用例要防的。 */
test('selecting Yinlan drives her own L1 key art, entry film and L2 seat crop', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  /* 默认右座是米娅；名册顺序为 林星 → 米娅 → 银岚，点一次刚好换到银岚。 */
  await page.locator('.seat-slot[data-index="1"]').click();
  const yinlanSeatSlot = page.locator('.seat-slot[data-index="1"]');
  await expect(yinlanSeatSlot).toContainText('银岚');
  await expect(yinlanSeatSlot).toContainText('官方牌友');
  await expect(yinlanSeatSlot).not.toContainText('静态肖像');
  /* 选人卡应使用与 L1 一致的近景资源，不能再把整身 yinlan-v1 缩进圆头像。 */
  await expect(yinlanSeatSlot.locator('.seat-face')).toHaveAttribute('src', /yinlan-lounge\.png$/);
  const loungeStandee = page.locator('.lounge-character.right .pal-standee .layer-base');
  await expect(loungeStandee).toHaveAttribute('src', /yinlan-lounge\.png$/);
  await expect.poll(() => loungeStandee.evaluate((img) => img.naturalWidth / img.naturalHeight)).toBeCloseTo(1048 / 1360, 3);
  await page.screenshot({ path: 'test-results/yinlan-lounge-keyart.png' });
  await page.getByRole('button', { name: /进入今晚牌局/ }).click();

  const yinlanSegment = page.locator('.entry-segment[data-pal="pal-yinlan"]');
  await expect(page.locator('.entry-segment')).toHaveCount(2);
  /* 银岚已有独立横版入场片：不能再把「暮色球场」卡牌竖屏舞片挪来入场。 */
  await expect(yinlanSegment).not.toHaveClass(/portrait/);
  await expect(yinlanSegment.locator('source')).toHaveAttribute('src', /yinlan-entry-v1\.mp4$/);

  /* 让第一段结束，验标题和第二段一起切换；不依赖本机自动播放策略。 */
  await page.locator('.entry-segment').first().locator('video').dispatchEvent('ended');
  await expect(page.locator('[data-entry-caption]')).toContainText('银岚');
  await expect(yinlanSegment).toHaveClass(/show/);
  /* 不能只截 poster/黑帧：headless 不会可靠自动播放，显式 play 后等真正解码一帧。 */
  const yinlanVideo = yinlanSegment.locator('video');
  await yinlanVideo.evaluate((video) => video.play());
  await expect.poll(() => yinlanVideo.evaluate((video) => video.readyState)).toBeGreaterThanOrEqual(2);
  await expect.poll(() => yinlanVideo.evaluate((video) => video.videoWidth)).toBeGreaterThan(0);
  await page.screenshot({ path: 'test-results/yinlan-entry-film.png' });
  await page.getByRole('button', { name: '跳过入场' }).click();

  /* L2 的尺寸契约仍然取同一张 felt 高度份额；银岚用上半身裁切，不能把全身缩进 4:5 盒子。 */
  const yinlanStandee = page.locator('.opponent.right .pal-standee');
  const yinlanImage = yinlanStandee.locator('.layer-base');
  await expect(yinlanImage).toHaveAttribute('src', /yinlan-seat\.png$/);
  await expect(page.locator('.table-felt')).toHaveAttribute('data-table-theme', 'silver-court');
  await expect.poll(() => yinlanImage.evaluate((img) => img.naturalWidth / img.naturalHeight)).toBeCloseTo(0.8, 3);
  await expect.poll(() => page.locator('.table-felt').evaluate((felt) => {
    const figure = document.querySelector('.opponent.right .pal-standee');
    return +(figure.getBoundingClientRect().height / felt.getBoundingClientRect().height).toFixed(3);
  })).toBeGreaterThanOrEqual(0.35);
  await page.screenshot({ path: 'test-results/yinlan-table-seat.png', fullPage: true });
});
