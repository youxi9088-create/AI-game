import { test, expect } from '@playwright/test';
import { themes } from '../../app/core/themes.js';

const card = (suit, rank) => ({ id: `${suit}${rank}`, suit, rank });
const nearWinGame = () => ({
  schemaVersion: '1.0', dealNumber: 999, moveCount: 8, elapsedMs: 12_000, undoStack: [], redoStack: [], status: 'playing',
  freecells: [null, null, null, null],
  foundations: Object.fromEntries(['S', 'H', 'D', 'C'].map(suit => [suit, Array.from({ length: 12 }, (_, index) => card(suit, index + 1))])),
  tableau: [['S'], ['H'], ['D'], ['C'], [], [], [], []].map(column => column.map(suit => card(suit, 13))),
});
const expectDeal = (page, value) => expect(page.locator('.run-stats .stat:nth-child(1) strong')).toHaveText(String(value));
const expectMoves = (page, value) => expect(page.locator('.run-stats .stat:nth-child(2) strong')).toHaveText(String(value));
const enterGame = page => page.getByRole('link', { name: '开始游戏' }).click();

test.beforeEach(async ({ page }) => { await page.goto('/?apiPort=4274'); await page.evaluate(() => localStorage.clear()); await page.reload(); });
test('编号牌局可移动、保存并刷新恢复', async ({ page }) => {
  await enterGame(page); await page.getByLabel('重置牌局编号').fill('7'); await page.getByRole('button', { name: '重置本局 R' }).click();
  await page.getByRole('button', { name: 'Q梅花' }).click(); await expect(page.locator('.status')).toContainText('2 张连续牌'); await page.getByRole('button', { name: 'K方块' }).click();
  await expectMoves(page, 1); await page.reload(); await expectDeal(page, 7); await expectMoves(page, 1);
});
test('主题工作台的 mock 生成可通过质量门并保留牌局', async ({ page }) => {
  await enterGame(page); await page.getByLabel('重置牌局编号').fill('7'); await page.getByRole('button', { name: '重置本局 R' }).click(); await page.getByRole('button', { name: 'Q梅花' }).click(); await page.getByRole('button', { name: 'K方块' }).click();
  await page.getByRole('link', { name: '主题工坊' }).click(); await page.locator('#prompt').fill('中国水墨山水主题，背景含留白感'); await page.getByRole('button', { name: '生成主题预览' }).click();
  await expect(page.locator('.theme-preview')).toBeVisible({ timeout: 8_000 }); await expect(page.getByText(/PREVIEW · MOCK/)).toBeVisible(); await page.getByRole('button', { name: '应用到当前牌局' }).click(); await expect(page.locator('.status')).toContainText('已应用', { timeout: 3_000 }); await expectDeal(page, 7); await expectMoves(page, 1);
});
test('键盘可选择牌并用 Enter 移动', async ({ page }) => { await enterGame(page); await page.getByLabel('重置牌局编号').fill('7'); await page.getByRole('button', { name: '重置本局 R' }).click(); const source = page.getByRole('button', { name: 'Q梅花' }); await source.focus(); await page.keyboard.press('Enter'); await expect(page.locator('.status')).toContainText('已拿起 Q♣'); await page.getByRole('button', { name: 'K方块' }).focus(); await page.keyboard.press('Enter'); await expectMoves(page, 1); });
test('经典牌桌视觉基线', async ({ page }) => { await enterGame(page); await page.getByLabel('重置牌局编号').fill('659363'); await page.getByRole('button', { name: '重置本局 R' }).click(); await expect(page.locator('.board')).toHaveScreenshot('deal-659363.png'); });
test('检查器入口已移除，旧地址会回到有效玩家页面', async ({ page }) => { await enterGame(page); await expect(page.getByRole('link', { name: '检查器' })).toHaveCount(0); await page.goto('/?apiPort=4274#inspector'); await expect(page).toHaveURL(/#home$/); await expect(page.getByRole('heading', { name: /把每一局/ })).toBeVisible(); });
test('双击按回收堆牌列自由单元的优先级移动连续组', async ({ page }) => { await enterGame(page); await page.getByLabel('重置牌局编号').fill('7'); await page.getByRole('button', { name: '重置本局 R' }).click(); await page.getByRole('button', { name: 'Q梅花' }).dblclick(); await expectMoves(page, 1); await expect(page.locator('.column').filter({ has: page.getByRole('button', { name: 'K方块' }) }).getByRole('button', { name: 'J方块' })).toBeVisible(); });
test('S6 资源解码失败会保留旧主题和牌局', async ({ page }) => {
  const broken = structuredClone(themes.cyber); broken.themeId = 'broken-s6'; broken.source = 'generated'; broken.assets.items = [{ id: 'background', kind: 'background', mime: 'image/png', contentHash: 'a'.repeat(64), url: '/v1/assets/not-found.png' }];
  await page.route('**/v1/theme-jobs', route => route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ jobId: 'broken-job', status: 'queued' }) }));
  await page.route('**/v1/theme-jobs/broken-job', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jobId: 'broken-job', status: 'completed', stage: 'completed', progress: 100, message: 'ready', result: { theme: broken, provider: 'test', fallbackUsed: false, errors: [] } }) }));
  await enterGame(page); await page.getByLabel('重置牌局编号').fill('7'); await page.getByRole('button', { name: '重置本局 R' }).click(); await expectDeal(page, 7); await page.getByRole('button', { name: 'Q梅花' }).click(); await page.getByRole('button', { name: 'K方块' }).click(); await expectMoves(page, 1); await page.getByRole('link', { name: '主题工坊' }).click(); await page.locator('#prompt').fill('损坏资源测试'); await page.getByRole('button', { name: '生成主题预览' }).click(); await expect(page.getByRole('heading', { name: broken.title })).toBeVisible(); await page.getByRole('button', { name: '应用到当前牌局' }).click(); await expect(page.locator('.status')).toContainText('已回滚并保留当前主题'); await expectDeal(page, 7); await expectMoves(page, 1); await expect(page.locator('.brand')).toContainText('FREECELL ATELIER');
});

test('生成的主题会在牌面渲染 A-K 字形、花色符号与 J/Q/K 插画资产', async ({ page }) => {
  const { makeCardAssetPng } = await import('./helpers/test-png.mjs');
  const pixel = makeCardAssetPng();
  const themed = structuredClone(themes.cyber); themed.themeId = 'generated-card-assets'; themed.source = 'generated';
  themed.assets.items = [
    { id: 'rank-13', kind: 'rankGlyph', rank: 13, mime: 'image/png', contentHash: 'a'.repeat(64), dataUrl: pixel },
    { id: 'suit-S', kind: 'suitMotif', suit: 'S', mime: 'image/png', contentHash: 'b'.repeat(64), dataUrl: pixel },
    { id: 'face-S13', kind: 'faceCard', cardId: 'S13', mime: 'image/png', contentHash: 'c'.repeat(64), dataUrl: pixel },
  ];
  await page.route('**/v1/theme-jobs', route => route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ jobId: 'card-assets-job', status: 'queued' }) }));
  await page.route('**/v1/theme-jobs/card-assets-job', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jobId: 'card-assets-job', status: 'completed', stage: 'completed', progress: 100, message: 'ready', result: { theme: themed, provider: 'test', fallbackUsed: false, errors: [] } }) }));
  await enterGame(page); await page.getByRole('link', { name: '主题工坊' }).click(); await page.locator('#prompt').fill('牌面资产渲染测试'); await page.getByRole('button', { name: '生成主题预览' }).click();
  await expect(page.getByRole('heading', { name: themed.title })).toBeVisible(); await expect(page.locator('.theme-preview .face-art-image img')).toBeVisible();
  await page.getByRole('button', { name: '应用到当前牌局' }).click(); await expect(page.locator('.status')).toContainText('已应用', { timeout: 3_000 });
  await expect(page.locator('.board img.rank-glyph').first()).toBeVisible(); await expect(page.locator('.board img.suit-motif').first()).toBeVisible(); await expect(page.locator('.board .face-art-image img').first()).toBeVisible();
});

test('主题工坊明确标识测试 Mock 通道', async ({ page }) => {
  await page.getByRole('link', { name: '定制主题' }).click();
  await expect(page.locator('.pipeline-connection')).toContainText('测试环境 · Mock 通道');
  await expect(page.getByRole('button', { name: '生成主题预览' })).toBeEnabled();
});

test('新局与重置本局语义和状态互不混淆', async ({ page }) => {
  await enterGame(page); await page.getByLabel('重置牌局编号').fill('7'); await page.getByRole('button', { name: '重置本局 R' }).click();
  await page.getByRole('button', { name: 'Q梅花' }).click(); await page.getByRole('button', { name: 'K方块' }).click(); await expectMoves(page, 1);
  await page.getByRole('button', { name: '重置本局 R' }).click(); await expectDeal(page, 7); await expectMoves(page, 0);
  await page.getByRole('button', { name: '新局 N' }).click(); await expectMoves(page, 0); await expect(page.locator('.run-stats .stat:nth-child(1) strong')).not.toHaveText('7');
});

test('胜利弹层可进入主题工作台并可从胜局开始新局', async ({ page }) => {
  const installNearWin = async () => { await page.evaluate(game => { localStorage.setItem('theme-freecell-mvp', JSON.stringify({ game, history: [], future: [] })); location.hash = 'game'; }, nearWinGame()); await page.reload(); };
  const finish = async () => { for (const label of ['K黑桃', 'K红桃', 'K方块', 'K梅花']) await page.getByRole('button', { name: label }).dblclick(); await expect(page.getByRole('heading', { name: '恭喜通关！' })).toBeVisible(); };
  await installNearWin(); await finish(); await page.getByRole('link', { name: '换个主题' }).click(); await expect(page.getByRole('heading', { name: '描述你想进入的牌室' })).toBeVisible();
  await installNearWin(); await finish(); await page.getByRole('button', { name: '再来一局' }).click(); await expectMoves(page, 0); await expect(page.getByRole('heading', { name: '恭喜通关！' })).toHaveCount(0); await expect(page.locator('.run-stats .stat:nth-child(1) strong')).not.toHaveText('999');
});

test('刷新工作台会恢复未完成的服务端主题任务', async ({ page }) => {
  const theme = structuredClone(themes.ink); theme.themeId = 'resumed-theme'; theme.source = 'generated';
  await page.route('**/v1/theme-jobs/resume-job', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jobId: 'resume-job', status: 'completed', stage: 'completed', progress: 100, message: 'ready', result: { theme, provider: 'mock', fallbackUsed: false, errors: [] } }) }));
  await page.evaluate(() => localStorage.setItem('theme-freecell-pending-job', 'resume-job')); await page.reload();
  await expect(page.getByRole('heading', { name: theme.title })).toBeVisible(); await expect(page.getByText(/PREVIEW · MOCK/)).toBeVisible(); await expect.poll(() => page.evaluate(() => localStorage.getItem('theme-freecell-pending-job'))).toBeNull();
});

test('S6 会预载真实二进制资源后再提交主题', async ({ page }) => {
  const generated = structuredClone(themes.cyber); generated.themeId = 'asset-s6'; generated.source = 'generated'; const hashes = ['b'.repeat(64), 'c'.repeat(64)]; generated.assets.items = hashes.map((contentHash, index) => ({ id: index ? 'cardBack' : 'background', kind: index ? 'cardBack' : 'background', mime: 'image/png', contentHash, url: `/v1/assets/${contentHash}.png`, provider: 'test', model: 'fixture' }));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  await page.route('**/v1/assets/*.png', route => route.fulfill({ status: 200, contentType: 'image/png', body: png }));
  await page.route('**/v1/theme-jobs', route => route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ jobId: 'asset-job', status: 'queued' }) }));
  await page.route('**/v1/theme-jobs/asset-job', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jobId: 'asset-job', status: 'completed', stage: 'completed', progress: 100, message: 'ready', result: { theme: generated, provider: 'test', fallbackUsed: false, errors: [] } }) }));
  await enterGame(page); await page.getByRole('link', { name: '主题工坊' }).click(); await page.locator('#prompt').fill('二进制资源预载测试'); await page.getByRole('button', { name: '生成主题预览' }).click(); await expect(page.getByRole('heading', { name: generated.title })).toBeVisible(); await page.getByRole('button', { name: '应用到当前牌局' }).click();
  await expect(page.locator('.status')).toContainText('已应用'); await expect(page.locator('.brand')).toContainText('NEON FREECELL');
});

test('连续六步操作可在刷新后恢复', async ({ page }) => {
  const moves = [
    { from: { zone: 'tableau', index: 1 }, start: 6, to: { zone: 'foundation', suit: 'C' } },
    { from: { zone: 'tableau', index: 4 }, start: 5, to: { zone: 'foundation', suit: 'D' } },
    { from: { zone: 'tableau', index: 5 }, start: 5, to: { zone: 'tableau', index: 4 } },
    { from: { zone: 'tableau', index: 5 }, start: 4, to: { zone: 'tableau', index: 1 } },
    { from: { zone: 'tableau', index: 5 }, start: 3, to: { zone: 'foundation', suit: 'C' } },
    { from: { zone: 'tableau', index: 1 }, start: 6, to: { zone: 'tableau', index: 5 } },
  ];
  await enterGame(page); await page.getByLabel('重置牌局编号').fill('7'); await page.getByRole('button', { name: '重置本局 R' }).click();
  for (const [index, move] of moves.entries()) { await page.locator(`[data-card-ref='${JSON.stringify(move.from)}'][data-start="${move.start}"]`).click(); await page.locator(`[data-ref='${JSON.stringify(move.to)}']`).evaluate(element => element.click()); await expectMoves(page, index + 1); }
  await page.reload(); await expectDeal(page, 7); await expectMoves(page, 6);
});

test('1280 与 4K 视口下所有叠牌角标可辨认且无横向溢出', async ({ page }) => {
  await enterGame(page); await page.getByLabel('重置牌局编号').fill('659363'); await page.getByRole('button', { name: '重置本局 R' }).click();
  for (const viewport of [{ width: 1280, height: 720 }, { width: 3840, height: 2160 }]) {
    await page.setViewportSize(viewport);
    const report = await page.locator('.column').evaluateAll(columns => ({ cardCount: columns.reduce((sum, column) => sum + column.querySelectorAll('.card').length, 0), clippedCorners: columns.reduce((sum, column) => { const cards = [...column.querySelectorAll('.card')]; return sum + cards.slice(0, -1).filter((card, index) => card.querySelector('.corner:not(.mirror)').getBoundingClientRect().bottom > cards[index + 1].getBoundingClientRect().top + 1).length; }, 0), horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth }));
    expect(report).toEqual({ cardCount: 52, clippedCorners: 0, horizontalOverflow: false });
  }
});

test('首页到工坊、牌桌和浏览器返回保持可定位', async ({ page }) => {
  await page.getByRole('link', { name: '定制主题' }).click();
  await expect(page).toHaveURL(/#studio$/);
  await page.getByRole('link', { name: '返回牌桌' }).click();
  await expect(page).toHaveURL(/#game$/);
  await page.goBack();
  await expect(page.getByRole('heading', { name: '描述你想进入的牌室' })).toBeVisible();
});

test('关键操作有 44px 触控目标、可见焦点且主题库真实素材可加载', async ({ page }) => {
  const start = page.getByRole('link', { name: '开始游戏' });
  const box = await start.boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(44);
  await start.focus();
  expect(await start.evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe('none');
  const urls = ['/app/assets/classic-table-bg.png', '/app/assets/classic-card-back.png'];
  const assets = await page.evaluate(async urls => Promise.all(urls.map(async url => ({ url, ok: (await fetch(url)).ok }))), urls);
  expect(assets).toEqual(urls.map(url => ({ url, ok: true })));
});

test('非法牌局编号给出恢复指引且不改变当前牌局', async ({ page }) => {
  await enterGame(page);
  const before = await page.locator('.run-stats .stat:nth-child(1) strong').textContent();
  await page.getByLabel('重置牌局编号').fill('0');
  await page.getByRole('button', { name: '重置本局 R' }).click();
  await expect(page.locator('.status')).toContainText('请输入 1 到 1,000,000');
  await expect(page.locator('.run-stats .stat:nth-child(1) strong')).toHaveText(before);
});

test('主题库只展示翡翠与水墨两套默认主题，水墨主题可应用并跨刷新保留', async ({ page }) => {
  await page.getByRole('link', { name: '主题库' }).click();
  await expect(page.locator('.theme-tile')).toHaveCount(2);
  await expect(page.getByRole('heading', { name: '翡翠牌室' })).toBeVisible();
  const inkTheme = page.locator('.theme-tile').filter({ hasText: '水墨山水' });
  await expect(inkTheme).toBeVisible();
  await expect(page.getByRole('heading', { name: '霓虹夜城' })).toHaveCount(0);
  await inkTheme.getByRole('button', { name: '应用主题' }).click();
  await expect(page.locator('.status')).toContainText('已应用“水墨山水”');
  await expect(page.locator('.card.face-card')).not.toHaveCount(0);
  await expect(page.locator('.card.face-card .face-art-ink')).not.toHaveCount(0);
  await expect(page.locator('.toolbar .brand-lockup small')).toHaveText('水墨山水');
  await page.reload();
  await expect(page.locator('.toolbar .brand-lockup small')).toHaveText('水墨山水');
  await page.getByRole('link', { name: '主题库' }).click();
  await expect(page.locator('.theme-tile')).toHaveCount(2);
});

test('旧版本本地主题库会迁移并保留用户生成主题', async ({ page }) => {
  const legacyTheme = structuredClone(themes.ink); legacyTheme.themeId = 'legacy-ink'; legacyTheme.title = '旧存档·水墨牌室'; legacyTheme.source = 'generated';
  await page.evaluate(theme => localStorage.setItem('theme-freecell-mvp', JSON.stringify({ libraryVersion: 1, theme, library: [theme] })), legacyTheme);
  await page.reload();
  await page.getByRole('link', { name: '主题库' }).click();
  await expect(page.getByRole('heading', { name: '旧存档·水墨牌室' })).toBeVisible();
  await expect(page.locator('.theme-tile')).toHaveCount(3);
});

test('主题库可从服务端恢复真实流水线生成主题', async ({ page }) => {
  const serverTheme = structuredClone(themes.ink); serverTheme.themeId = 'server-archived-ink'; serverTheme.title = '服务端存档·水墨牌室'; serverTheme.source = 'generated'; serverTheme.generation = { provider: 'aihub-gateway' };
  await page.route('**/v1/themes', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([structuredClone(themes.classic), serverTheme, structuredClone(themes.cyber)]) }));
  await page.getByRole('link', { name: '主题库' }).click();
  await expect(page.locator('.theme-tile')).toHaveCount(2);
  await page.locator('.server-history summary').click();
  await page.getByRole('button', { name: '恢复服务端生成主题' }).click();
  await expect(page.locator('.theme-tile')).toHaveCount(3);
  await expect(page.getByRole('heading', { name: '服务端存档·水墨牌室' })).toBeVisible();
  await page.reload();
  await expect(page.locator('.theme-tile')).toHaveCount(3);
  await expect(page.getByRole('heading', { name: '服务端存档·水墨牌室' })).toBeVisible();
  await page.locator('.server-history summary').click();
  await page.getByRole('button', { name: '恢复服务端生成主题' }).click();
  await expect(page.locator('.server-history-status')).toContainText('没有新的服务端生成主题需要恢复');
});

test('主题库可删除生成主题并同步服务端，内置主题不可删除', async ({ page }) => {
  const serverTheme = structuredClone(themes.ink); serverTheme.themeId = 'deletable-theme'; serverTheme.title = '待删除·水墨牌室'; serverTheme.source = 'generated'; serverTheme.generation = { provider: 'aihub-gateway' };
  let serverDeleted = false;
  await page.route('**/v1/themes', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(serverDeleted ? [] : [serverTheme]) }));
  await page.route('**/v1/themes/deletable-theme', route => { if (route.request().method() === 'DELETE') { serverDeleted = true; return route.fulfill({ status: 204, body: '' }); } return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }); });
  await page.getByRole('link', { name: '主题库' }).click();
  await expect(page.locator('.theme-tile')).toHaveCount(2);
  await expect(page.locator('.theme-tile').filter({ hasText: '翡翠牌室' }).locator('.tile-delete')).toHaveCount(0);
  await page.locator('.server-history summary').click();
  await page.getByRole('button', { name: '恢复服务端生成主题' }).click();
  await expect(page.locator('.theme-tile')).toHaveCount(3);
  page.on('dialog', dialog => dialog.accept());
  await page.locator('.theme-tile').filter({ hasText: '待删除·水墨牌室' }).getByRole('button', { name: '删除' }).click();
  await expect(page.locator('.theme-tile')).toHaveCount(2);
  await expect(page.getByRole('heading', { name: '待删除·水墨牌室' })).toHaveCount(0);
  await expect(page.locator('.server-history-status')).toContainText('已删除主题');
  await page.reload();
  await expect(page.locator('.theme-tile')).toHaveCount(2);
  await page.locator('.server-history summary').click();
  await page.getByRole('button', { name: '恢复服务端生成主题' }).click();
  await expect(page.locator('.server-history-status')).toContainText('没有新的服务端生成主题需要恢复');
});
