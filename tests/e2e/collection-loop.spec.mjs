import { test, expect } from '@playwright/test';
test('a real win opens the photo studio, persists composition and exports a PNG', async ({ page, request }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const post = async (path, data) => { const r = await request.post(path, { data }); expect(r.ok(), await r.text()).toBeTruthy(); return r.json(); };
  let game = await post('/api/game/new', { seed: 2 });
  for (let i = 0; i < 600 && game.phase !== 'SETTLED'; i++) {
    const data = { gameId: game.id, commandId: `collection-${i}` };
    if (game.phase === 'BIDDING') game = game.turn !== 'player'
      ? await post('/api/game/advance-bid', data)
      : game.bidding.stage === 'GRAB' ? await post('/api/game/grab', { ...data, accept: true }) : await post('/api/game/bid', { ...data, score: 3 });
    else if (game.turn !== 'player') game = await post('/api/game/advance-turn', data);
    else { const hint = await (await request.get(`/api/game/hint?gameId=${game.id}`)).json(); game = await post(hint.cards.length ? '/api/game/play' : '/api/game/pass', { ...data, cards: hint.cards }); }
  }
  expect(game.settlement.winnerId).toBe('player');
  await page.goto('/#/table');
  await page.locator('.settlement [data-action="advance"]').click();
  await page.locator('.dance-stage [data-action="advance"]').click();
  await expect(page.locator('.photo-studio')).toBeVisible();
  await page.locator('[data-photo-option="filter"]').selectOption('warm');
  await page.locator('[data-photo-option="background"]').selectOption('plum');
  await page.locator('[data-photo-option="framing"]').selectOption('close');
  await page.locator('#photo-name').fill('月光里的第一场胜利');
  await page.screenshot({ path: 'test-results/collection-studio-desktop.png', fullPage: true });
  await page.getByRole('button', { name: '定格并收藏', exact: true }).click();
  await expect(page.locator('.my-creations')).toContainText('月光里的第一场胜利');
  await page.reload(); await expect(page.locator('.my-creations')).toContainText('月光里的第一场胜利');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '导出分享图', exact: true }).last().click()]);
  expect(download.suggestedFilename()).toMatch(/^photo-.*\.png$/); expect(await download.failure()).toBeNull();
  await page.getByRole('button', { name: '重新搭配', exact: true }).last().click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.photo-studio')).toBeVisible();
  expect(await page.locator('.photo-studio').evaluate((n) => Math.abs(n.getBoundingClientRect().top) < 1)).toBeTruthy();
  expect(await page.locator('.photo-studio').evaluate((n) => n.scrollWidth <= n.clientWidth + 1)).toBeTruthy();
  await page.screenshot({ path: 'test-results/collection-studio-mobile.png', fullPage: false });
  await page.getByRole('button', { name: '稍后再搭配', exact: true }).click();
  await page.getByRole('button', { name: '音量', exact: true }).click();
  await page.locator('[data-audio-volume="masterVolume"]').fill('0.4');
  await page.reload();
  expect(await page.locator('[data-audio-volume="masterVolume"]').inputValue()).toBe('0.4');
  expect(errors).toEqual([]);
});
