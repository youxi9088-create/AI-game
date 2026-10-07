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
test('settlement layout and reward actions work on desktop and phone', async ({ page, request }) => {
  test.setTimeout(90000);
  const errors=[]; page.on('pageerror', e=>errors.push(e.message));
  const post=async(path,data)=>{const r=await request.post(path,{data});expect(r.ok(),await r.text()).toBeTruthy();return r.json();};
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
  const first=await finishGame();
  await page.goto('/#/table');
  await expect(page.locator('#settlement-title')).toBeVisible();
  await expect(page.locator('.result-gain')).toContainText('+12');
  await expect(page.locator('.result-balance')).toContainText('32');
  await page.locator('.result-breakdown summary').click();
  await expect(page.locator('.result-breakdown')).toContainText('不放大 Token');
  await page.locator('.result-breakdown summary').click();
  await page.screenshot({path:'test-results/settlement-desktop.png',fullPage:false});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'test-results/settlement-mobile.png',fullPage:false});
  expect(await page.locator('.result-panel').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&el.scrollWidth<=el.clientWidth+1;})).toBeTruthy();
  const choice=page.locator('.reward-outfit').nth(1);
  await choice.click(); await expect(choice).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.result-gain')).toContainText('+12');
  const after=await (await request.get('/api/gallery')).json();expect(after.cards).toHaveLength(1);expect(after.economy.balance).toBe(32);
  await page.locator('.result-actions [data-action="advance"]').click();
  await expect(page.locator('.dance-stage')).toBeVisible();
  await page.locator('[data-action="skip-settlement"]').click();
  await page.setViewportSize({width:1440,height:900});
  const second=await finishGame();expect(second.settlement.freeCardReward).toBe(false);
  await page.goto('/#/table');await page.reload();
  await expect(page.locator('.result-gain')).toContainText('+8');
  await expect(page.locator('.reward-outfit')).toHaveCount(0);
  await page.emulateMedia({reducedMotion:'reduce'});await page.reload();
  expect(await page.locator('.result-card').evaluate(el=>getComputedStyle(el).animationName)).toBe('none');
  // Presentation-only loss fixture exercises the branch without changing account state.
  await page.route('**/api/game',async route=>{const response=await route.fetch();const g=await response.json();g.settlement={...g.settlement,card:null,winnerId:'pal-linxing',finisherId:'pal-linxing',freeCardReward:false,milestoneReward:0,tokenDelta:2,tokenEffectiveDelta:2,outcome:{playerWon:false,danceEligible:false}};g.settlementStage='RESULT';await route.fulfill({response,json:g});});
  await page.reload();await expect(page.locator('.result-loss')).toBeVisible();await expect(page.locator('.result-gain')).toContainText('+2');
  await page.screenshot({path:'test-results/settlement-loss.png',fullPage:false});
  await page.locator('.result-actions [data-action="restart"]').click();await expect(page.locator('.result-screen')).toHaveCount(0);
  expect(errors).toEqual([]);
});
