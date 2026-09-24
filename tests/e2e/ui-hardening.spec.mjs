import { test, expect } from '@playwright/test';

/** Walks the guided first loop until the table is in PLAYING state with the player on turn. */
async function openTable(page) {
  // 种子 2（不是 1）：牌友接入阵营协作与策略分层后，种子 1 已经变成一个靠提示策略打不赢的
  // 牌局，而这条路径要求玩家赢下首局才能拿到写真卡。这个种子的胜负由
  // tests/gameplay.test.mjs 里「E2E 依赖的种子必须是可胜牌局」一用例钉住。
  await page.addInitScript(() => { window.__DRESSBATTLE_NPC_DELAY = 20; window.__DRESSBATTLE_SEED = 2; });
  await page.goto('/');
  await page.getByRole('button', { name: /进入今晚牌局/ }).click();
  await page.getByRole('button', { name: '跳过入场' }).click();
  await page.getByRole('button', { name: '叫 3 分' }).click();
  await expect(page.locator('.table-page')).toBeVisible();
}

test('bidding is a real round: the NPCs answer a 1-point call and the player can grab the landlord', async ({ page }) => {
  /* 种子 1：玩家叫 1 分之后米娅会叫到 2 分，于是玩家进入抢地主阶段——这一条路径同时覆盖
     「三家轮转叫分」和「抢地主把底分翻倍」。序列本身由 tests/gameplay.test.mjs 里的
     服务端用例钉住，这里只负责证明前端没有绕过服务端自己决定地主。 */
  await page.addInitScript(() => { window.__DRESSBATTLE_NPC_DELAY = 20; window.__DRESSBATTLE_SEED = 1; });
  await page.goto('/');
  await page.getByRole('button', { name: /进入今晚牌局/ }).click();
  await page.getByRole('button', { name: '跳过入场' }).click();

  // 开局最高分是 0，所以面板必须给出全部四个合法选择：不叫 + 叫 1/2/3 分。
  await expect(page.locator('.match-hud b')).toHaveText('叫分中');
  await expect(page.locator('[data-action="bid"]')).toHaveCount(4);

  await page.getByRole('button', { name: '叫 1 分' }).click();
  // 两位牌友经由服务端叫分，所以轮次会先离开玩家再回来。等到「抢地主」按钮出现，
  // 就是在证明这一轮叫分不是前端本地的捷径。
  const grab = page.locator('[data-action="grab"][data-accept="1"]');
  await expect(grab).toBeVisible({ timeout: 15_000 });

  await grab.click();
  // 抢地主把 2 分底分翻倍到 4：HUD 显示的是服务端快照里的倍率。
  await expect(page.locator('.match-hud b')).toHaveText('地主 ×4');
  await expect(page.locator('.hand .card').first()).toBeEnabled();
});

test('table layout fits the viewport without vertical overflow', async ({ page }) => {
  await openTable(page);
  // 760px is the documented floor: below it the felt keeps its 360px minimum and the page
  // scrolls deliberately instead of crushing the table.
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1440, height: 800 }, { width: 1366, height: 768 }, { width: 1920, height: 1080 }]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(150);
    const overflow = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
    expect(overflow, `viewport ${viewport.width}×${viewport.height} should not scroll vertically`).toBeLessThanOrEqual(1);
  }
});

test('the felt never collapses below its readable minimum on short viewports', async ({ page }) => {
  await openTable(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(150);
  const felt = await page.locator('.table-felt').evaluate((node) => Math.round(node.getBoundingClientRect().height));
  // 300px is the short-viewport floor: the seats shrink via @media (max-height:780px), so the
  // felt may be shorter there than the 360px used on tall screens.
  expect(felt).toBeGreaterThanOrEqual(300);
  // 1280×720 is the smallest supported size and must still be scroll-free.
  const overflow = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('the hand scrolls as one reachable row and every card can be clicked', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await openTable(page);
  await expect.poll(() => page.locator('.hand .card').count()).toBe(20);
  // The row scrolls rather than clipping: with justify-content:flex-start nothing is stolen
  // off the left edge the way an overflowing centred flex row would do.
  await expect.poll(() => page.locator('.hand').evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
  const hand = await page.locator('.hand').evaluate((node) => {
    const cards = [...node.querySelectorAll('.card')];
    return { count: cards.length, scrollLeft: node.scrollLeft, firstLeft: cards[0].getBoundingClientRect().left };
  });
  // 17 dealt + 3 bottom cards, because bidding 3 makes the player the landlord.
  expect(hand.count).toBe(20);
  expect(hand.scrollLeft).toBe(0);
  // Each card answers its own click — a negative-margin fan must not let a neighbour swallow it.
  for (const index of [0, 1, 10, hand.count - 1]) {
    await page.locator('.hand').evaluate((node) => { node.scrollLeft = 0; });
    const target = page.locator('.hand .card').nth(index);
    await target.scrollIntoViewIfNeeded();
    await target.click();
    await expect(target).toHaveAttribute('aria-pressed', 'true');
    await target.click();
    await expect(target).toHaveAttribute('aria-pressed', 'false');
  }
});

test('player can change NPC pacing and it survives a reload', async ({ page }) => {
  await openTable(page);
  await expect(page.locator('#speedLabel')).toHaveText('标准');
  await page.locator('[data-action="toggle-speed"]').click();
  await expect(page.locator('#speedLabel')).toHaveText('慢速');
  await page.locator('[data-action="toggle-speed"]').click();
  await expect(page.locator('#speedLabel')).toHaveText('快速');
  await page.reload();
  await expect(page.locator('#speedLabel')).toHaveText('快速');
});

test('audio toggle reports its state and is exposed to assistive tech', async ({ page }) => {
  await openTable(page);
  const toggle = page.locator('[data-action="toggle-sfx"]');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#sfxLabel')).toHaveText('音效关');
});

test('settlement performance can be skipped straight to the photo reveal', async ({ page }) => {
  // 这里要真的打完一整局才进结算：NPC 支持三带/连对/飞机等牌型后压制更频繁，回合数上升，30s 默认预算不够。
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openTable(page);
  for (let step = 0; step < 160; step += 1) {
    if (await page.getByRole('button', { name: /将为你跳舞/ }).isVisible()) break;
    if (await page.getByRole('button', { name: '提示' }).isVisible()) {
      await page.locator('#toast').evaluate((node) => { node.textContent = ''; });
      await page.getByRole('button', { name: '提示' }).click();
      await expect(page.locator('#toast')).toContainText(/已标出|建议不出/);
      if ((await page.locator('#toast').innerText()).includes('已标出')) await page.getByRole('button', { name: '出牌' }).click();
      else await page.getByRole('button', { name: '不出' }).click();
    }
    await page.waitForTimeout(35);
  }
  /* 赢局流程：RESULT 结算页 → 点「xxx将为你跳舞」→ 全屏舞台演出页（独立页面，不内含在结算浮层里）。 */
  await page.getByRole('button', { name: /将为你跳舞/ }).click();
  await expect(page.locator('.dance-stage')).toBeVisible();
  await expect(page.locator('.settlement')).toHaveCount(0);
  /* 等视频拿到元数据再量：videoWidth 为 0 时下面的信箱式断言会读到 0，误报成裁切。 */
  await page.waitForFunction(() => {
    const v = document.querySelector('.dance-stage .vframe-main');
    return !v || v.videoWidth > 0;
  }, null, { timeout: 15000 });
  const stage = await page.evaluate(() => {
    /* 演出画面三条通道：① 信箱式录像（.vframe-main）② 动作包视频（.dance-stage-video）
       ③ 分层定格（.dressup-figure）。全屏页里前两条的展示盒就是整个视口。 */
    const fig = document.querySelector('.dance-stage .vframe-main')
      || document.querySelector('.dance-stage .dance-stage-video')
      || document.querySelector('.dance-stage .dressup-figure');
    const r = fig?.getBoundingClientRect();
    return r ? { w: Math.round(r.width), h: Math.round(r.height), vh: window.innerHeight, vw: window.innerWidth } : null;
  });
  expect(stage, '全屏舞台必须有一个可见的演出画面').not.toBeNull();
  // 全屏页：画面铺满视口（信箱式 contain 下展示盒 = 视口，视频画面按比例居中不裁切）。
  expect(stage.w / stage.vw, `全屏舞台宽度占屏 ${Math.round(stage.w / stage.vw * 100)}%`).toBeGreaterThanOrEqual(0.98);
  expect(stage.h / stage.vh, `全屏舞台高度占屏 ${Math.round(stage.h / stage.vh * 100)}%`).toBeGreaterThanOrEqual(0.98);
  /* 信箱式那一路单独验一次真裁切：contain 之下画面必等于素材原生比例。 */
  const letterbox = await page.evaluate(() => {
    const v = document.querySelector('.dance-stage .vframe-main');
    if (!v || !v.videoWidth) return null;
    const box = v.getBoundingClientRect();
    const scale = Math.min(box.width / v.videoWidth, box.height / v.videoHeight);
    return { shown: (v.videoWidth * scale) / (v.videoHeight * scale), natural: v.videoWidth / v.videoHeight };
  });
  if (letterbox) expect(letterbox.shown, '信箱式必须保持源片比例，不裁切').toBeCloseTo(letterbox.natural, 2);
  await page.getByRole('button', { name: '跳过演出 →' }).click();
  // Skipping must land on the terminal stage without walking every intermediate one.
  await expect(page.getByRole('button', { name: '再开一局' })).toBeVisible();
  await expect(page.getByRole('button', { name: '跳过演出 →' })).toHaveCount(0);
  // Read the unlocked total from the gallery itself: the server is shared across specs.
  await page.getByRole('button', { name: '打开写真馆' }).click();
  await expect(page.locator('.collection-progress b')).toContainText(/(?:[1-6]) \/ 6/);
  await expect(page.locator('.pcard:not(.locked)').first()).toBeVisible();
});

test('a filtered gallery keeps the same card scale as the full collection', async ({ page }) => {
  await page.addInitScript(() => { window.__DRESSBATTLE_NPC_DELAY = 20; window.__DRESSBATTLE_SEED = 1; });
  await page.goto('/');
  await page.getByRole('link', { name: '写真馆' }).click();
  const grid = page.locator('.gallery-grid');
  await expect(grid.locator('.pcard')).toHaveCount(6);
  /* 按身份定位同一张银岚卡，而不是默认取全量第一张：服务器在同进程 E2E 中会保留
     已解锁状态，首卡可能因新卡标识或加载节奏变成 0 宽，造成把测试仪器问题误报为 UI 放大。 */
  const yinlanSelector = '.pcard[data-card="pal-yinlan:court-dusk"] .pcard-art';
  /* 卡池首次 hydration 会整体重绘 DOM。不要持有某一帧的
     ElementHandle / locator 再滚动——重绘会使它 detached。每次都从当前 document 取节点。 */
  const measureYinlan = () => page.evaluate((selector) => {
    const el = document.querySelector(selector);
    if (!el) return { width: 0, height: 0, ratio: 0 };
    el.scrollIntoView({ block: 'center' });
    const box = el.getBoundingClientRect();
    return { width: box.width, height: box.height, ratio: box.height ? box.width / box.height : 0 };
  }, yinlanSelector);
  await expect.poll(async () => (await measureYinlan()).width, { message: '全量卡池中的目标卡必须有可测宽度' }).toBeGreaterThan(0);
  const fullCard = await measureYinlan();
  // 筛选只收窄卡池；不能再把同一张 3:4 卡切成横向“精选卡”。
  await page.getByRole('button', { name: '银岚', exact: true }).click();
  await expect(grid.locator('.pcard')).toHaveCount(1);
  await expect.poll(async () => (await measureYinlan()).width, { message: '筛选后的目标卡必须有可测宽度' }).toBeGreaterThan(0);
  const filteredCard = await measureYinlan();
  expect(filteredCard.width, '筛选不应放大卡面').toBeCloseTo(fullCard.width, 1);
  expect(filteredCard.height, '筛选不应改写卡高').toBeCloseTo(fullCard.height, 1);
  expect(filteredCard.ratio, '写真卡固定 3:4').toBeCloseTo(0.75, 2);
});

// Kept last on purpose: this test plays a card, which mutates the in-memory game the server
// shares across specs in the same file. Running it earlier shortened the hand for the
// hit-target test above and made that assertion order-dependent.
test('a played hand lands between its owner and the table centre, clear of both seats', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openTable(page);
  // Lead with one card so a played stack exists, then wait for the NPC replies to resolve.
  // Measuring the instant the stack first appears caught it mid-transition and produced a
  // spurious overlap; waiting for mia's reply pins the final owner class and felt height.
  await page.locator('.hand .card').first().click();
  await page.getByRole('button', { name: '出牌' }).click();
  // Wait for the pal replies to resolve before measuring: the owner class flips between seats
  // while they act. They are on the same side now, so mia will not cover linxing — which means
  // waiting for a specific owner is no longer deterministic. Wait for the dock to stop
  // showing "thinking" instead, then measure whoever owns the stack.
  await page.waitForFunction(() => !document.querySelector('.turn-dock')?.textContent.includes('思考中'), null, { timeout: 20_000 });
  await page.waitForTimeout(250);
  // If both passed, the trick reset and the player leads again: play one more so a stack exists.
  if (!(await page.locator('.played-stack').count())) {
    await page.locator('.hand .card').first().click();
    await page.getByRole('button', { name: '出牌' }).click();
    await page.waitForTimeout(300);
  }
  await expect(page.locator('.played-stack')).toHaveCount(1);

  const geo = await page.evaluate(() => {
    const felt = document.querySelector('.table-felt').getBoundingClientRect();
    const box = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left - felt.left, right: r.right - felt.left, y: r.top - felt.top, bottom: r.bottom - felt.top, w: r.width };
    };
    return {
      feltW: Math.round(felt.width),
      stack: box('.played-stack'),
      linxing: box('.opponent.top .pal-standee'),
      mia: box('.opponent.right .pal-standee'),
      // label / owner row must sit inside the stack box, not float away from it
      label: box('.played-stack > p'),
      owner: box('.played-stack > b')
    };
  });

  // The stack must not overlap either character. This is the regression guard for the bug
  // where mia's cards were anchored at a fixed 63% of the felt and landed on linxing.
  const overlaps = (a, b) => a && b && a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom;
  expect(overlaps(geo.stack, geo.linxing), 'played stack must not overlap linxing').toBe(false);
  expect(overlaps(geo.stack, geo.mia), 'played stack must not overlap mia').toBe(false);

  // Both label rows must stay within the stack's own box so the three parts read as one unit.
  expect(geo.label.y, 'type label must sit inside the stack').toBeGreaterThanOrEqual(geo.stack.y - 2);
  expect(geo.label.bottom, 'type label must sit inside the stack').toBeLessThanOrEqual(geo.stack.bottom + 2);
  expect(geo.owner.bottom, 'owner row must sit inside the stack').toBeLessThanOrEqual(geo.stack.bottom + 2);
});

/* P1a：前端能让玩家换掉今晚入席的牌友，但「谁有资格上桌」仍由服务端名册决定。
   这里注入的自定义牌友只在前端名册里存在（服务端名册没有她），所以最后一条断言
   正是要证明：前端指定座位不等于能上桌。 */
test('the seat picker offers custom pals, but the server still decides who may sit', async ({ page }) => {
  await page.route('**/api/pals', async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    const custom = JSON.parse(JSON.stringify(payload.official[1]));
    custom.palId = 'pal-user-e2e01';
    custom.identity = { ...custom.identity, name: '测试牌友' };
    custom.appearance = { ...custom.appearance, portraitRef: '/assets/pals/mia-v1.png' };
    payload.pals = [...(payload.pals || payload.official), custom];
    await route.fulfill({ response, json: payload });
  });
  await page.goto('/#/home');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('.seat-picker')).toBeVisible();
  await expect(page.locator('.seat-slot[data-index="0"]')).toContainText('林星');
  /* 名册里现在不止两位官方牌友，点一次不一定正好落到注入的工坊牌友上——
     cycleSeat 会一圈圈往下轮，所以循环点到它出现为止，上限取名册长度即可。
     这样断言的是「工坊牌友可选」，而不是「它恰好排在第二位」。 */
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await page.locator('.seat-slot[data-index="0"]').click();
    if ((await page.locator('.seat-slot[data-index="0"]').innerText()).includes('测试牌友')) break;
  }
  await expect(page.locator('.seat-slot[data-index="0"]')).toContainText('测试牌友');
  const refused = await page.request.post('/api/game/new', { data: { seats: ['pal-user-e2e01', 'pal-mia'] } });
  expect(refused.status()).toBe(400);
  expect((await refused.json()).error).toMatch(/上桌资格/);
});

test('two seats can never hold the same pal', async ({ page }) => {
  await page.goto('/#/home');
  await page.waitForLoadState('networkidle');
  const snapshot = await page.evaluate(async () => {
    const payload = await (await fetch('/api/pals')).json();
    return (payload.pals || payload.official || []).map((pal) => pal.palId);
  });
  /* 名册只有两位时选人器不出现（无可换）；这是当前 Provider 未配置下的真实状态，
     断言它「要么能换人、要么不显示选人器」，两种情况都不该是坏掉的半个 UI。 */
  const picker = page.locator('.seat-picker');
  if (snapshot.length > 2) await expect(picker).toBeVisible();
  else await expect(picker).toHaveCount(0);
  const rejected = await page.request.post('/api/game/new', { data: { seats: ['pal-mia', 'pal-mia'] } });
  expect(rejected.status()).toBe(400);
});

test('a turn closeup is a camera cut: it shows, yields no input, covers nothing, and leaves', async ({ page }) => {
  await page.addInitScript(() => { window.__DRESSBATTLE_SKIP_ENTRY = true; });
  /* 特写由服务端盖在事件上（判定规则在 packages/performance-core），所以这里只拦截一次
     响应、把一个真实的 closeup 结构塞进最后一条事件，验证前端的演出与占位——不是伪造
     牌局结果。 */
  await page.route('**/api/game/bid', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    const events = body.events || [];
    if (events.length) {
      events[events.length - 1].closeup = { palId: 'pal-linxing', action: 'A02', dialogue: '这一手，我来接。', tone: 'bomb', label: '炸弹', durationMs: 1500 };
    }
    await route.fulfill({ response, json: body });
  });
  /* 1440×900 是规范区间（24–32%）应当成立的地方；1024×720 的牌桌只有 942×311，
     特写会被「玩家出牌堆的左缘」卡到 21% 左右——那是净空不够，不是没做，
     所以这里断言的是「不小于净空允许值」，并把 24% 的区间留给宽牌桌。 */
  for (const vp of [{ width: 1440, height: 900, minShare: 0.23 }, { width: 1024, height: 720, minShare: 0.19 }]) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto('/');
    await page.getByRole('button', { name: /进入今晚牌局/ }).click();
    await page.getByRole('button', { name: '叫 3 分' }).click();

    const closeup = page.locator('.closeup');
    await expect(closeup).toBeVisible();
    await expect(closeup).toContainText('炸弹');
    await expect(closeup).toContainText('这一手，我来接。');
    // 切镜不能夺走操作：它只是挡一下眼睛。
    await expect(closeup).toHaveCSS('pointer-events', 'none');

    const geometry = await page.evaluate(() => {
      const box = (sel) => { const n = document.querySelector(sel); return n ? n.getBoundingClientRect() : null; };
      const hits = (a, b) => Boolean(a && b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom);
      const felt = box('.table-felt');
      const cu = box('.closeup');
      const others = { top: box('.opponent.top'), right: box('.opponent.right'), stack: box('.played-stack'), marker: box('.lead-marker'), dock: box('.turn-dock'), self: box('.self-seat'), hud: box('.match-hud') };
      return {
        felt: felt && { w: Math.round(felt.width), h: Math.round(felt.height) },
        closeup: cu && { w: Math.round(cu.width), h: Math.round(cu.height) },
        overlaps: Object.fromEntries(Object.entries(others).map(([key, rect]) => [key, hits(cu, rect)]))
      };
    });
    // 叫分阶段还没有出牌堆，缺失的元素按「不重叠」计。
    expect(Object.values(geometry.overlaps).every((hit) => hit === false)).toBe(true);
    const share = geometry.closeup.w / geometry.felt.w;
    expect(share, `${vp.width}x${vp.height} 特写宽度占牌桌 ${Math.round(share * 100)}%`).toBeGreaterThan(vp.minShare);
    expect(share).toBeLessThan(0.33);
    // 会自己收镜，不是常驻面板。
    await expect(closeup).toHaveCount(0, { timeout: 6000 });
  }
});
