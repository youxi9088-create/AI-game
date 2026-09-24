import { test, expect } from '@playwright/test';
test('first player path exposes real sequential NPC turns instead of an immediate scripted reset', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#tokenBalance')).toContainText('Token'); await page.keyboard.press('Tab'); await expect(page.getByRole('link', { name: '跳到主要内容' })).toBeFocused();
  await page.screenshot({ path: 'test-results/stage-two-home.png', fullPage: true });
  await page.getByRole('button', { name: /进入今晚牌局/ }).click();
  await expect(page.locator('.entry-cinematic video')).toHaveCount(2);
  await page.getByRole('button', { name: '跳过入场' }).click();
  await expect(page.getByText('叫分决定地主')).toBeVisible(); await page.getByRole('button', { name: '叫 3 分' }).click();
  /* 两位入座牌友都接了五态动作视频：叫完分进入 PLAYING，两个座位立即进入 A01 待机轨。 */
  await expect(page.locator('video.action-video')).toHaveCount(2);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.screenshot({ path: 'test-results/first-loop-table.png', fullPage: true });
  await expect.poll(() => page.locator('.hand').evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
  await expect(page.locator('.pal-avatar')).toHaveCount(2);
  await expect(page.locator('.pal-standee.cutout .layer-base')).toHaveCount(2);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: '提示' }).click(); await page.getByRole('button', { name: '出牌' }).click();
  await expect(page.getByText('林星的回合')).toBeVisible(); await expect(page.getByText('林星正在思考…')).toBeVisible();
  await expect(page.getByText('米娅的回合')).toBeVisible({ timeout: 2500 });
  await expect(page.getByText('你的回合', { exact: true })).toBeVisible({ timeout: 2500 });
  await expect(page.locator('.event-feed')).toContainText('林星');
  await expect(page.locator('.event-feed')).toContainText('米娅');
  await expect(page.locator('video.action-video')).toHaveCount(2);
  /* 提示是异步的：点完立刻查 .card.selected 会读到上一次渲染的状态，于是「没选中」
     和「不出按钮不存在」会同时成立，测试随机失败。等 toast 说出结论再动——
     与 tests/e2e/ui-hardening.spec.mjs 里主循环用例的写法保持一致。 */
  await page.locator('#toast').evaluate((node) => { node.textContent = ''; });
  await page.getByRole('button', { name: '提示' }).click();
  await expect(page.locator('#toast')).toContainText(/已标出|建议不出/);
  if (await page.locator('.card.selected').count()) await page.getByRole('button', { name: '出牌' }).click();
  else await page.getByRole('button', { name: '不出' }).click();
  await expect(page.getByText('林星的回合')).toBeVisible({ timeout: 1200 });
});

test('browser main loop reaches live dress-up settlement and a collected photo card', async ({ page }) => {
  // This covers a complete round plus the real-time settlement video; 30s is too tight on CI.
  test.setTimeout(90_000);
  // 种子 2：见 tests/gameplay.test.mjs 中「E2E 依赖的种子必须是可胜牌局」。
  await page.addInitScript(() => { window.__DRESSBATTLE_NPC_DELAY = 20; window.__DRESSBATTLE_SEED = 2; });
  await page.goto('/'); await page.getByRole('button', { name: /进入今晚牌局/ }).click();
  await page.getByRole('button', { name: '跳过入场' }).click();
  await page.getByRole('button', { name: '叫 3 分' }).click();
  for (let step = 0; step < 160; step += 1) {
    if (await page.getByRole('button', { name: /将为你跳舞/ }).isVisible()) break;
    if (await page.getByRole('button', { name: '提示' }).isVisible()) {
      await page.locator('#toast').evaluate((node) => { node.textContent = ''; });
      await page.getByRole('button', { name: '提示' }).click();
      await expect(page.locator('#toast')).toContainText(/已标出|建议不出/);
      if ((await page.locator('#toast').innerText()).includes('已标出')) {
        await expect(page.locator('.card.selected').first()).toBeVisible();
        await page.getByRole('button', { name: '出牌' }).click();
      } else {
        await page.getByRole('button', { name: '不出' }).click();
      }
    }
    await page.waitForTimeout(35);
  }
  /* 结算页：牌局结束先看到 RESULT 结算画面——胜负、倍率与 Token 都在这一页交代清楚；
     侧栏同步保留一份摘要（浮层推进后仍能回看）。 */
  await expect(page.getByRole('button', { name: /将为你跳舞/ })).toBeVisible();
  await expect(page.getByText('本局已结算')).toBeVisible();
  await expect(page.locator('.settlement.show')).toBeVisible();
  await expect(page.locator('.settlement')).toContainText('你赢下了这一局');
  await expect(page.locator('.settlement')).toContainText(/×\d+/);
  await expect(page.locator('.settlement')).toContainText(/[+−]\d+ Token/);
  await page.screenshot({ path: 'test-results/settlement-result-page.png', fullPage: true });
  await expect(page.locator('.table-side p')).toContainText(/×\d+/);
  await expect(page.locator('.table-side p')).toContainText(/[+\u2212]\d+ Token/);
  /* 赢局后点「林星将为你跳舞」→ 全屏舞台演出页。结算和舞台是两个页面：
     .settlement 浮层不再出现，整屏只放那支舞（玩家点击触发，带声音与控制条）。 */
  await page.getByRole('button', { name: /将为你跳舞/ }).click();
  const danceStage = page.locator('.dance-stage');
  await expect(danceStage).toBeVisible();
  await expect(page.locator('.settlement')).toHaveCount(0);
  /* 全屏跳舞优先放这张写真卡自己的整段竖屏写真（套装级 cardVideo），动作包只是备轨。
     林星首套有了 linxing-dance-v1.mp4，所以这里不再是 A05-lose.webm。 */
  const perfVideo = danceStage.locator('video.vframe-main');
  await expect(perfVideo).toBeVisible();
  await expect(perfVideo.locator('source')).toHaveAttribute('src', /linxing-dance-v1\.mp4$/);
  /* 光断言 <video> 存在不够：<source type> 写错时浏览器会**静默跳过**该源，
     画面全黑且控制台没有任何报错。必须验到真的解出帧为止。静音后再 play()：
     本环境的 headless Chrome 不触发自动播放（见 playwright.config.mjs），显式 play 只为验解码。 */
  await perfVideo.evaluate((v) => { v.muted = true; return v.play(); });
  await expect.poll(() => perfVideo.evaluate((v) => v.readyState)).toBeGreaterThanOrEqual(2);
  await expect.poll(() => perfVideo.evaluate((v) => v.videoWidth)).toBeGreaterThan(0);
  /* 信箱式：4:7 竖屏塞进全屏，主体 contain 不裁切，两侧由同帧模糊底填充。 */
  const geometry = await perfVideo.evaluate((v) => {
    const box = v.getBoundingClientRect();
    const scale = Math.min(box.width / v.videoWidth, box.height / v.videoHeight);
    return { shown: (v.videoWidth * scale) / (v.videoHeight * scale), natural: v.videoWidth / v.videoHeight };
  });
  expect(geometry.shown, '全屏舞台必须保持源片比例，不裁切').toBeCloseTo(geometry.natural, 2);
  await page.screenshot({ path: 'test-results/settlement-video-performance.png', fullPage: true });
  await page.getByRole('button', { name: '揭晓写真卡' }).click();
  const reveal = page.locator('.photo-card-reveal');
  await expect(reveal).toBeVisible();
  await expect(reveal.locator('.pcard-art')).toBeVisible();
  await expect(reveal.locator('.pcard-serial')).toContainText('No.001');
  await page.screenshot({ path: 'test-results/settlement-photo-reveal.png', fullPage: true });
  await page.getByRole('button', { name: '前往写真馆' }).click();
  await page.getByRole('button', { name: '打开写真馆' }).click();
  await expect(page).toHaveURL(/#\/gallery$/);
  /* 林星 4 套 + 米娅 1 套 + 银岚 1 套 = 6 张；每张均有独立回放视频。 */
  await expect(page.locator('.collection-progress b')).toContainText('1 / 6');
  await expect(page.locator('.pcard')).toHaveCount(6);
  await expect(page.locator('.pcard.locked')).toHaveCount(5);
  await expect(page.locator('.pcard:not(.locked)')).toHaveCount(1);
  /* 未解锁卡保留色彩与光影诱因，但必须模糊到看不清角色、服装或动作。
     不能再用播放 / 宝石锚点提示具体内容类型，统一为未知片段与锁定标记。 */
  await expect(page.locator('.pcard.locked .locked-preview-media')).toHaveCount(5);
  await expect(page.locator('.pcard.locked .locked-preview-fog')).toHaveCount(5);
  await expect(page.locator('.pcard.locked .locked-preview-lock')).toHaveCount(5);
  await expect(page.locator('.pcard.locked .locked-preview-kind')).toHaveText(Array(5).fill('未知片段'));
  await expect(page.locator('.pcard.locked .pcard-copy h2').first()).toHaveText('未解锁写真');
  await expect.poll(() => page.locator('.pcard.locked .locked-preview-media').first().evaluate((node) => getComputedStyle(node).filter)).toContain('blur(9px)');
  await page.screenshot({ path: 'test-results/gallery-first-card.png', fullPage: true });
  await page.locator('.pcard:not(.locked)').click();
  await expect(page.locator('.card-detail')).toBeVisible();
  await expect(page.locator('.detail-info')).toContainText('舞台实录');
  await expect(page.locator('.detail-info')).toContainText('月光步');
  await page.screenshot({ path: 'test-results/gallery-card-detail.png', fullPage: true });
  await page.getByRole('button', { name: '回看跳舞' }).click();
  const replayVideo = page.locator('.replay-vframe video[data-replay-video]');
  await expect(replayVideo).toBeVisible();
  await expect(replayVideo.locator('source')).toHaveAttribute('src', /linxing-dance-v1\.mp4$/);
  await expect.poll(() => replayVideo.evaluate((video) => video.readyState)).toBeGreaterThanOrEqual(2);
  await expect.poll(() => replayVideo.evaluate((video) => video.videoWidth)).toBeGreaterThan(0);
  await page.screenshot({ path: 'test-results/gallery-video-replay.png', fullPage: true });
});

test('production workshop exposes resource-pack plan, provider state and policy gates', async ({ page }) => {
  await page.goto('/'); await page.getByRole('link', { name: '牌友工坊' }).click();
  await expect(page).toHaveURL(/#\/workshop$/);
  await expect(page.locator('.workshop-intro')).toContainText('牌友工坊');
  await expect(page.locator('.workshop-intro > p:not(.eyebrow)')).toHaveCount(0);
  await page.getByLabel('描述你的成年虚构牌友').fill('一位复古优雅的成年虚构舞台魔术师，喜欢蓝紫色灯光');
  await page.getByRole('button', { name: '建立完整资产计划' }).click();
  await expect(page.locator('.resource-plan').getByRole('heading', { name: '完整首发包' })).toBeVisible();
  await page.getByRole('button', { name: '查看详情' }).first().click();
  await expect(page.getByText('A05 失败 WebM')).toBeVisible();
  await expect(page.getByText('首套换装 / 写真演出视频')).toBeVisible();
  await page.getByRole('button', { name: '只生成角色资料卡' }).click();
  await expect(page.locator('#toast')).toContainText('PL-PROVIDER');
  await expect(page.locator('.resource-row.locked')).not.toHaveCount(0);
  await expect(page.locator('.resource-row').filter({ hasText: 'AIHub 跳舞视频工作流' }).first()).toBeVisible();
  await page.locator('.resource-plan-modal-close').click();
  await page.getByRole('button', { name: /提交完整包生产/ }).click();
  await expect(page.locator('#toast')).toContainText('PL-PROVIDER'); await expect(page.locator('#prompt-error')).toContainText('PL-PROVIDER');
  await page.screenshot({ path: 'test-results/stage-two-workshop.png', fullPage: true });
  await page.getByLabel('描述你的成年虚构牌友').fill('名人同款舞台造型'); await page.getByRole('button', { name: /提交完整包生产/ }).click();
  await expect(page.locator('#toast')).toContainText('PL-7'); await expect(page.locator('#prompt-error')).toContainText('PL-7'); await expect(page.getByLabel('描述你的成年虚构牌友')).toBeFocused();
});

test('a direct table reload restores the authoritative game snapshot', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: /进入今晚牌局/ }).click();
  await page.getByRole('button', { name: '跳过入场' }).click();
  await expect(page.getByText('叫分决定地主')).toBeVisible(); await page.reload();
  await expect(page.getByText('叫分决定地主')).toBeVisible(); await expect(page.getByText('牌桌还没开局')).toHaveCount(0);
});
