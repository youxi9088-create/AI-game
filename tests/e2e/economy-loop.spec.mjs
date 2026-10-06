import { test as base, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A real, independent API process keeps this win out of the other specs' gallery.
const test = base.extend({
  baseURL: async ({}, use) => {
    const dir = await mkdtemp(join(tmpdir(), 'dressbattle-collection-'));
    const child = spawn(process.execPath, ['--input-type=module', '-e',
      "import { server } from './apps/api/server.mjs'; server.listen(0, '127.0.0.1', () => console.log('TEST_PORT=' + server.address().port));"
    ], { cwd: process.cwd(), env: { ...process.env, NODE_ENV: 'test',
      GALLERY_STATE_PATH: join(dir, 'gallery.json'), TOKEN_STATE_PATH: join(dir, 'wallet.json'),
      CONFIRMED_PALS_PATH: join(dir, 'pals.json'), PAL_RESOURCE_STATE_PATH: join(dir, 'tasks.json')
    }, stdio: ['ignore', 'pipe', 'pipe'] });
    const exited = new Promise((resolve) => child.once('exit', resolve));
    let output = '';
    child.stderr.on('data', (data) => { output += data; });
    try {
      const port = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`API startup timed out: ${output}`)), 10_000);
        const finish = (error, port) => { clearTimeout(timer); error ? reject(error) : resolve(port); };
        child.once('error', (error) => finish(error));
        child.once('exit', (code) => finish(new Error(`API exited ${code}: ${output}`)));
        child.stdout.on('data', (data) => {
          output += data;
          const match = /TEST_PORT=(\d+)/.exec(output);
          if (match) finish(null, match[1]);
        });
      });
      await use(`http://127.0.0.1:${port}`);
    } finally {
      child.kill('SIGKILL');
      await exited;
      await rm(dir, { recursive: true, force: true });
    }
  }
});
test('real games fund a card purchase and upgrade; retries never spend twice', async ({ page, request }) => {
  test.setTimeout(90000);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const post = async (path, data) => { const r = await request.post(path, { data }); expect(r.ok(), await r.text()).toBeTruthy(); return r.json(); };
  const finishGame = async () => {
    let game = await post('/api/game/new', { seed: 2 });
    for (let i = 0; i < 600 && game.phase !== 'SETTLED'; i++) {
      const data = { gameId: game.id, commandId: `economy-${i}` };
      if (game.phase === 'BIDDING') game = game.turn !== 'player'
        ? await post('/api/game/advance-bid', data)
        : game.bidding.stage === 'GRAB' ? await post('/api/game/grab', { ...data, accept: true }) : await post('/api/game/bid', { ...data, score: 3 });
      else if (game.turn !== 'player') game = await post('/api/game/advance-turn', data);
      else { const hint = await (await request.get(`/api/game/hint?gameId=${game.id}`)).json(); game = await post(hint.cards.length ? '/api/game/play' : '/api/game/pass', { ...data, cards: hint.cards }); }
    }
    expect(game.settlement.winnerId).toBe('player');
    return game;
  };
  const first = await finishGame();
  expect(first.tokenBalance).toBe(32);
  await page.goto('/#/gallery');
  await expect(page.locator('.economy-panel')).toContainText('32');
  const payload = await (await request.get('/api/gallery')).json();
  const target = payload.economy.catalog.find(q => q.action === 'unlock' && q.canPurchase);
  const button = page.locator(`[data-purchase-card="${target.cardId}"]`);
  const responsePromise = page.waitForResponse(r => r.url().endsWith('/api/gallery/purchase') && r.request().method() === 'POST');
  await button.click();
  const response = await responsePromise; expect(response.ok()).toBeTruthy();
  const purchaseRequest = response.request().postDataJSON();
  await expect(page.locator('#tokenBalance')).toContainText('8 Token');
  expect(await button.textContent()).toContain('升级 Lv.2'); expect(await button.isDisabled()).toBeTruthy();
  const retry = await post('/api/gallery/purchase', purchaseRequest); expect(retry.account.balance).toBe(8); expect(retry.cards).toHaveLength(2);
  const second = await finishGame(); expect(second.settlement.freeCardReward).toBe(false); expect(second.tokenBalance).toBe(16);
  await page.reload(); await expect(button).toBeEnabled(); await button.click();
  await expect(page.locator('#tokenBalance')).toContainText('4 Token');
  await expect(button).toContainText('升级 Lv.3');
  await page.reload(); await expect(page.locator('#tokenBalance')).toContainText('4 Token');
  await expect(button).toBeDisabled();
  await page.screenshot({ path: 'test-results/economy-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
  await page.screenshot({ path: 'test-results/economy-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});
