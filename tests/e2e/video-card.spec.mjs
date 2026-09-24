import { test, expect } from '@playwright/test';

/* 本环境的 headless Chrome 不触发自动播放（原因与边界见 playwright.config.mjs 的注释），
   所以这里不验「浏览器会自动播」，只验「卡面接线正确 + 源真的解得出画面」。 */

/* 录像写真卡：套装绑定竖屏舞片（cardVideo/cardPoster），但**卡面与导出 PNG 一致**——
   栅格与详情只渲染 layers.outfit 分层静态图，跳舞视频在点「回看跳舞」后的回放浮层里才播。
   为什么用请求拦截：集齐全部 6 套写真要连赢多局且局局命中对应牌友，e2e 付不起
   这个成本，也不该靠随机数去撞。这里拦截 /api/gallery 把六套已解锁的录像卡一次注入，
   渲染走的是真实的 photoCardArt 路径，没有为测试开任何生产旁路。 */
const VIDEO_CARDS = [
  ['pal-linxing', 'stage-film', '舞台实录', '月光步', 'linxing-dance-v1.mp4', 'linxing-stage-film', 4, 'first'],
  ['pal-linxing', 'moon-maid', '月光女仆', '侍月步', 'linxing-moon-maid-v1.mp4', 'linxing-moon-maid', 5, 'normal'],
  ['pal-linxing', 'moon-bunny', '月兔礼赞', '兔跃步', 'linxing-moon-bunny-v1.mp4', 'linxing-moon-bunny', 6, 'normal'],
  ['pal-linxing', 'sunset-swim', '汐岸泳装', '踏浪步', 'linxing-sunset-swim-v1.mp4', 'linxing-sunset-swim', 7, 'normal'],
  ['pal-mia', 'sporty-sweetheart', '粉兔女仆', '甜兔节拍', 'mia-sporty-sweetheart-v1.mp4', 'mia-sporty-sweetheart', 12, 'normal'],
  ['pal-yinlan', 'court-dusk', '暮色球场', '新月节拍', 'nova-dance-v1.mp4', 'yinlan-court-dusk', 8, 'first']
].map(([palId, outfitId, outfitName, dance, file, asset, serialNo, rarity]) => ({
  cardId: `${palId}:${outfitId}`,
  palId, outfitId, outfitName, dance,
  layerSnapshot: { base: `/assets/pals/${palId.replace('pal-', '')}-v1.png`, outfit: `/assets/pals/outfits/${asset}-frame.jpg`, cardVideo: `/assets/pals/video/${file}`, cardPoster: `/assets/pals/outfits/${asset}.jpg` },
  serialNo, rarity, upgradeLevel: 1, seen: true, unlockedAt: '2026-09-15T00:00:00.000Z', auditRecordId: `audit-official-${palId}-v1`
}));

test('every video outfit stays bound to its own film instead of a pal default', async ({ page }) => {
  const response = await page.request.get('/api/pals');
  const payload = await response.json();
  const roster = Object.fromEntries((payload.pals || []).map((pal) => [pal.palId, pal]));
  const expectFilm = (palId, outfitId, file) => {
    const outfit = roster[palId]?.appearance?.outfitLibrary?.find((item) => item.outfitId === outfitId);
    expect(outfit, `${palId}:${outfitId} 必须在名册中`).toBeTruthy();
    expect(outfit.layerSnapshot.cardVideo).toMatch(new RegExp(`${file}$`));
    expect(outfit.layerSnapshot.cardPoster).toMatch(/\.jpg$/);
  };
  expectFilm('pal-linxing', 'stage-film', 'linxing-dance-v1\\.mp4');
  expectFilm('pal-linxing', 'moon-maid', 'linxing-moon-maid-v1\\.mp4');
  expectFilm('pal-linxing', 'moon-bunny', 'linxing-moon-bunny-v1\\.mp4');
  expectFilm('pal-linxing', 'sunset-swim', 'linxing-sunset-swim-v1\\.mp4');
  expectFilm('pal-mia', 'sporty-sweetheart', 'mia-sporty-sweetheart-v1\\.mp4');
  expectFilm('pal-yinlan', 'court-dusk', 'nova-dance-v1\\.mp4');
  /* 2026-09-20 名册瘦身（重名/未认领套系下架留档）后：林星 4 套、米娅 1 套、银岚 1 套。 */
  expect(roster['pal-linxing'].appearance.outfitLibrary).toHaveLength(4);
  expect(roster['pal-mia'].appearance.outfitLibrary).toHaveLength(1);
  expect(roster['pal-yinlan'].appearance.outfitLibrary).toHaveLength(1);
  for (const palId of ['pal-linxing', 'pal-mia', 'pal-yinlan']) {
    for (const outfit of roster[palId].appearance.outfitLibrary) {
      expect(outfit.layerSnapshot.cardVideo, `${palId}:${outfit.outfitId} 必须有独立回放视频`).toMatch(/^\/assets\/pals\/.+\.(mp4|webm)$/);
      expect(outfit.layerSnapshot.cardPoster, `${palId}:${outfit.outfitId} 必须有回放封面`).toMatch(/^\/assets\/pals\/.+\.(jpg|png)$/);
    }
  }
});

test('a video photo card keeps the export-style layered face and dances only in replay', async ({ page }) => {
  await page.route('**/api/gallery', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.cards = [...(body.cards || []), ...VIDEO_CARDS];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });

  await page.goto('/');
  await page.getByRole('link', { name: '写真馆' }).click();
  /* 写真馆渲染的是**整个卡池**（已解锁 + 未解锁剪影），注入不会只剩注入的那几张：
     林星 4 套 + 米娅 1 套 + 银岚 1 套 = 6 张；每张都一对一绑定回放视频。这里仍只按
     套装静帧文件名定位注入的录像卡，避免套装表继续增长时断言依赖顺序。 */
  await expect(page.locator('.pcard')).toHaveCount(6);

  /* 卡面与「导出卡面 PNG」一致：layers.outfit 分层静态图，不用视频定帧（cardPoster）。 */
  await expect(page.locator('.pcard-art video')).toHaveCount(0);
  await expect(page.locator('.pcard-art .vframe')).toHaveCount(0);
  const arts = page.locator('.pcard-art').filter({ has: page.locator('img.layer-outfit') });
  await expect(arts).toHaveCount(VIDEO_CARDS.length);

  for (const card of VIDEO_CARDS) {
    const outfitFile = card.layerSnapshot.outfit.split('/').pop();
    /* 按套装静帧文件定位卡面，不按顺序——卡池顺序由套系表决定，改一次套系表就会漂。 */
    const art = page.locator('.pcard-art').filter({ has: page.locator(`img.layer-outfit[src$="${outfitFile}"]`) });
    await expect(art, `${card.outfitName} 的静态卡面`).toHaveCount(1);

    const img = art.locator('img.layer-outfit');
    await img.scrollIntoViewIfNeeded();
    /* 静帧必须真的解出画面：路径或格式写错时 naturalWidth 是 0，画面空白且控制台无报错。 */
    await expect.poll(() => img.evaluate((node) => node.naturalWidth)).toBeGreaterThan(0);

    const geometry = await art.evaluate((node) => {
      const fb = node.getBoundingClientRect();
      const imgNode = node.querySelector('.layer-outfit');
      return { frame: +(fb.width / fb.height).toFixed(3), fit: getComputedStyle(imgNode).objectFit };
    });
    // L5 写真卡固定 3:4；分层图 cover 占满卡框，与导出 PNG 的 600×800 构图一致。
    expect(geometry.frame, `卡面画框 ${geometry.frame}`).toBeCloseTo(0.75, 2);
    expect(geometry.fit, '卡面静帧必须按 cover 占满卡框').toBe('cover');
  }

  /* 跳舞只在「回看跳舞」里：点开卡片 → 详情仍是静态 → 点「回看跳舞」→ 回放浮层放视频。
     本环境的 headless Chrome 不触发自动播放（见 playwright.config.mjs），显式 play() 再验解码。 */
  await page.locator('.pcard[data-card="pal-linxing:stage-film"]').click();
  await expect(page.locator('.card-detail')).toBeVisible();
  await expect(page.locator('.card-detail video')).toHaveCount(0);
  await page.getByRole('button', { name: '回看跳舞' }).click();
  const replayVideo = page.locator('.replay-vframe video[data-replay-video]');
  await expect(replayVideo).toBeVisible();
  await expect(replayVideo.locator('source')).toHaveAttribute('src', /linxing-dance-v1\.mp4$/);
  await replayVideo.evaluate((v) => v.play());
  await expect.poll(() => replayVideo.evaluate((v) => v.readyState)).toBeGreaterThanOrEqual(2);
  await expect.poll(() => replayVideo.evaluate((v) => v.videoWidth)).toBeGreaterThan(0);
});
