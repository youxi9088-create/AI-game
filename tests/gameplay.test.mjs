import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CONTRACT_VERSION } from '../packages/contracts/index.mjs';
import { classify, fullDeck, sortCards } from '../packages/ddz-rules/index.mjs';
import { chooseMove, personalityOf, personalityFor, derivePersonality, handStrength, bidScore, shouldGrab } from '../packages/ddz-ai/index.mjs';
import { buildMultiplier } from '../packages/performance-core/index.mjs';
import { GameService } from '../apps/api/game-engine.mjs';
import { createProductionCandidate, createProductionPlan } from '../packages/pal-generation-core/index.mjs';

const SEATS = ['player', 'pal-linxing', 'pal-mia'];

/* 直接摆牌：把 54 张牌重新分到四个池子里，保证「不重不漏」仍然成立，
   这样叫分测试才能用已知强度的手牌驱动，而不是碰运气等一个种子。 */
function stageHands(service, gameId, { linxing, mia }) {
  const game = service.get(gameId);
  const taken = new Set([...linxing, ...mia]);
  if (taken.size !== linxing.length + mia.length) throw new Error('摆牌失败：两副手牌里有重复的牌。');
  const rest = fullDeck().filter((card) => !taken.has(card));
  game.playerHand = sortCards(rest.slice(0, 17));
  game.npcHands = { 'pal-linxing': sortCards(linxing), 'pal-mia': sortCards(mia) };
  game.bottomCards = sortCards(rest.slice(17));
  game.players.forEach((player) => { player.count = player.id === 'player' ? 17 : player.id === 'pal-linxing' ? linxing.length : mia.length; });
  return game;
}
/* 弱牌：没有 2、没有三张、没有炸弹，强度 0。 */
const WEAK_HAND = ['3♣', '4♦', '5♥', '6♠', '7♣', '8♦', '10♠', 'J♣', 'Q♦', 'K♥', 'A♠', '3♦', '4♥', '5♠', '6♣', '7♦', '10♣'];
/* 中等强度：一对 2（4）+ 一个炸弹（6）= 10，加上性格偏移会叫到 2 分而不是 3 分。 */
const MEDIUM_HAND = ['2♣', '2♦', '9♣', '9♦', '9♥', '9♠', '3♠', '4♠', '5♣', '6♦', '7♥', '8♠', '10♥', 'J♠', 'Q♠', 'K♠', 'A♥'];

/* 把一局推到结算。玩家用提示策略自动出牌，牌友由服务端裁决。 */
function autoPlay(service, gameId, { playerBid = 3 } = {}) {
  let snapshot = service.snapshot(service.get(gameId));
  const observed = { teammateBeats: 0, npcPlays: 0, passes: 0 };
  let steps = 0;
  while (snapshot.phase !== 'SETTLED' && steps < 600) {
    steps += 1;
    if (snapshot.phase === 'BIDDING') {
      const game = service.get(gameId);
      const stage = game.bidding.stage;
      if (game.turn !== 'player') snapshot = service.advanceBid(gameId, `bid-turn-${steps}`);
      else if (stage === 'GRAB') snapshot = service.grab(gameId, playerBid === 3, `grab-${steps}`);
      else snapshot = service.bid(gameId, playerBid, `bid-${steps}`);
      continue;
    }
    const game = service.get(gameId);
    if (game.turn === 'player') {
      const hint = service.hint(gameId);
      snapshot = hint.cards.length ? service.play(gameId, hint.cards, `auto-play-${steps}`) : service.pass(gameId, `auto-pass-${steps}`);
      if (!hint.cards.length) observed.passes += 1;
      continue;
    }
    const landlord = game.landlordId;
    const isTeammate = (a, b) => a !== b && !(a === landlord || b === landlord);
    const before = { pal: game.turn, lastPlayerId: game.lastPlayerId };
    snapshot = service.advanceTurn(gameId, `auto-turn-${steps}`);
    const action = snapshot.events.at(-1);
    if (action?.type === 'PAL_ACTION' && action.decision === 'PLAY') {
      observed.npcPlays += 1;
      if (before.lastPlayerId && isTeammate(before.pal, before.lastPlayerId)) observed.teammateBeats += 1;
    } else if (action?.type === 'PAL_ACTION') observed.passes += 1;
  }
  return { snapshot, steps, observed };
}

test('photo gallery survives a service restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dressbattle-gallery-'));
  const galleryPath = join(dir, 'gallery.json');
  try {
    const first = new GameService({ galleryPath });
    const gameId = first.newGame({ seed: 2 }).id;
    autoPlay(first, gameId);
    const unlocked = first.getGallery();
    assert.equal(unlocked.length, 1);
    assert.ok((await readFile(galleryPath, 'utf8')).includes(unlocked[0].cardId));

    const afterRestart = new GameService({ galleryPath });
    assert.deepEqual(afterRestart.getGallery(), unlocked);
    afterRestart.markCardSeen(unlocked[0].cardId);
    const afterSeenRestart = new GameService({ galleryPath });
    assert.equal(afterSeenRestart.getGallery()[0].seen, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

/* ---------- A2 叫分 / 抢地主 ---------- */
test('bidding 3 immediately makes the caller the landlord with the bottom cards', () => {
  const service = new GameService();
  const created = service.newGame({ seed: 31 });
  assert.equal(created.bidding.stage, 'CALL');
  assert.equal(created.landlordId, null);
  const after = service.bid(created.id, 3, 'bid-3');
  assert.equal(after.phase, 'PLAYING');
  assert.equal(after.landlordId, 'player');
  assert.equal(after.bidding.stage, 'DONE');
  assert.equal(after.playerHand.length, 20);
  assert.equal(after.multiplier, 3);
  assert.equal(after.turn, 'player', '地主先出');
  assert.equal(after.events.at(-1).bottomCards.length, 3);
});

test('a bid that does not beat the current high score is rejected', () => {
  const service = new GameService();
  const created = service.newGame({ seed: 31 });
  assert.throws(() => service.bid(created.id, 4, 'bid-4'), /0 到 3/);
  service.bid(created.id, 2, 'bid-2');
  assert.equal(service.get(created.id).bidding.highScore, 2);
  assert.equal(service.get(created.id).turn, 'pal-linxing', '叫完分轮到下一位');
  assert.throws(() => service.bid(created.id, 1, 'bid-late'), /还没轮到你/);

  /* 一轮里玩家只会叫一次，靠流程走不到「分数不够高」这个分支，
     所以这里显式摆出「最高分 2、玩家还没叫」的状态去验证闸门。 */
  const game = service.get(created.id);
  game.turn = 'player';
  game.bidding.calls = [{ playerId: 'pal-linxing', score: 2 }];
  assert.throws(() => service.bid(created.id, 1, 'bid-low'), /至少要叫/);
  game.bidding.calls = [{ playerId: 'player', score: 1 }, { playerId: 'pal-linxing', score: 2 }];
  assert.throws(() => service.bid(created.id, 3, 'bid-twice'), /已经叫过/);
});

test('grabbing the landlord doubles the base score and hands the lead to the grabber', () => {
  const service = new GameService();
  const created = service.newGame({ seed: 5 });
  stageHands(service, created.id, { linxing: WEAK_HAND, mia: MEDIUM_HAND });
  service.bid(created.id, 1, 'call-1');
  service.advanceBid(created.id, 'lx-call');
  service.advanceBid(created.id, 'mia-call');
  const game = service.get(created.id);
  assert.equal(game.bidding.highScore, 2, '米娅盖过玩家的 1 分');
  assert.equal(game.bidding.highBidderId, 'pal-mia');
  assert.equal(game.bidding.stage, 'GRAB', '最高分不是 3 分时进入抢地主');
  assert.equal(game.turn, 'player', '从最高分者的下家开始抢');
  const grabbed = service.grab(created.id, true, 'grab-yes');
  assert.equal(grabbed.landlordId, 'player');
  assert.equal(grabbed.multiplier, 4, '抢到后底分翻倍：2 × 2');
  assert.equal(grabbed.turn, 'player', '地主先出');
  assert.equal(grabbed.playerHand.length, 20);
});

test('declining to grab leaves the highest bidder as the landlord at the original score', () => {
  const service = new GameService();
  const created = service.newGame({ seed: 5 });
  stageHands(service, created.id, { linxing: WEAK_HAND, mia: MEDIUM_HAND });
  service.bid(created.id, 1, 'call-1');
  service.advanceBid(created.id, 'lx-call');
  service.advanceBid(created.id, 'mia-call');
  service.grab(created.id, false, 'grab-no');
  service.advanceBid(created.id, 'lx-grab');
  const after = service.snapshot(service.get(created.id));
  assert.equal(after.landlordId, 'pal-mia', '没人抢就由最高分者当地主');
  assert.equal(after.multiplier, 2, '底分不翻倍');
  assert.equal(after.turn, 'pal-mia');
});

test('three passes redeal the deck and keep 54 cards intact', () => {
  const service = new GameService();
  const created = service.newGame({ seed: 88 });
  const before = service.get(created.id).playerHand.join(',');
  // 强制三家都不叫：先让玩家 pass，再让两位牌友各叫一次。
  service.bid(created.id, 0, 'pass-0');
  service.advanceBid(created.id, 'lx-0');
  service.advanceBid(created.id, 'mia-0');
  const game = service.get(created.id);
  if (game.bidding.stage === 'CALL') {
    assert.equal(game.redeals, 1, '三家都不叫必须流局重发');
    assert.notEqual(game.playerHand.join(','), before, '重发后手牌必须变化');
    assert.equal(game.playerHand.length, 17);
    assert.equal(game.turn, game.firstBidder);
    const all = [...game.playerHand, ...Object.values(game.npcHands).flat(), ...game.bottomCards];
    assert.equal(all.length, 54);
    assert.equal(new Set(all).size, 54);
  }
  assert.ok(service.snapshot(game).bidding.stage);
});

/* ---------- A3 阵营协作与策略 ---------- */
test('a pal never beats her own teammate, unless the move wins the game outright', () => {
  const held = chooseMove({
    hand: ['9♣', '9♦', 'K♠'], currentCombo: classify(['5♣']), lastPlayerId: 'pal-mia',
    personality: personalityOf('pal-linxing'),
    ctx: { isLandlord: false, landlordId: 'player', teammateId: 'pal-mia', teammateCount: 4, opponentCounts: { player: 6 } }
  });
  assert.equal(held.move, null);
  assert.equal(held.holdingBack, true);
  assert.match(held.reason, /队友/);

  const finisher = chooseMove({
    hand: ['9♣'], currentCombo: classify(['5♣']), lastPlayerId: 'pal-mia',
    personality: personalityOf('pal-linxing'),
    ctx: { isLandlord: false, landlordId: 'player', teammateId: 'pal-mia', teammateCount: 4, opponentCounts: { player: 6 } }
  });
  assert.equal(finisher.move?.cards.length, 1, '能直接走完时不该让给队友');
});

test('a controlled pal keeps her bomb and answers with the cheap card instead', () => {
  const hand = ['7♣', '7♦', '7♥', '7♠', '9♠'];
  const decision = chooseMove({
    hand, currentCombo: classify(['8♣']), lastPlayerId: 'player',
    personality: personalityOf('pal-linxing'),
    ctx: { isLandlord: true, landlordId: 'pal-linxing', teammateId: null, opponentCounts: { player: 15, 'pal-mia': 15 } }
  });
  assert.ok(decision.move, '有牌可压时不该直接放弃');
  assert.notEqual(decision.move.combo.type, 'BOMB', '对手还早，不该动炸弹');
  assert.deepEqual(decision.move.cards, ['9♠']);
});

test('the same bomb is played when an opponent is one card from winning', () => {
  const hand = ['7♣', '7♦', '7♥', '7♠', '9♠'];
  const decision = chooseMove({
    hand, currentCombo: classify(['3♣']), lastPlayerId: 'player',
    personality: personalityOf('pal-linxing'),
    ctx: { isLandlord: true, landlordId: 'pal-linxing', teammateId: null, opponentCounts: { player: 1, 'pal-mia': 12 } }
  });
  assert.equal(decision.move?.combo.type, 'BOMB');
});

test('a pal can take the landlord seat and still play a legal, terminating game', () => {
  let npcLandlordGames = 0;
  for (let seed = 1; seed <= 20; seed += 1) {
    const service = new GameService();
    const created = service.newGame({ seed });
    const { snapshot, observed } = autoPlay(service, created.id, { playerBid: 0 });
    assert.equal(snapshot.phase, 'SETTLED', `seed ${seed} 应分出胜负`);
    assert.equal(observed.teammateBeats, 0, `seed ${seed} 有牌友压了自己队友`);
    const game = service.get(created.id);
    if (game.landlordId !== 'player') npcLandlordGames += 1;
    const all = [...game.playerHand, ...Object.values(game.npcHands).flat(), ...game.discarded];
    assert.equal(all.length, 54);
    assert.ok(snapshot.settlement, '结算必须存在');
    assert.ok(snapshot.multiplier >= 1);
  }
  assert.ok(npcLandlordGames > 0, '玩家不叫分时应该出现牌友当地主的对局');
});

test('hand strength and personality drive bidding, deterministically', () => {
  const strong = ['BJ', 'SJ', '2♣', '2♦', 'A♣', 'A♦', 'A♥', 'A♠'];
  const weak = ['3♣', '4♦', '5♥', '6♠', '7♣', '8♦', '9♥', '10♠'];
  assert.ok(handStrength(strong) > handStrength(weak));
  assert.equal(bidScore(strong, 'pal-linxing'), bidScore(strong, 'pal-linxing'), '叫分必须可复现');
  assert.ok(bidScore(strong, 'pal-mia') >= bidScore(strong, 'pal-linxing'), '米娅至少和林星一样敢叫');
  assert.equal(bidScore(weak), 0);
  assert.equal(shouldGrab(weak, 'pal-mia', 1), false);
});

test('auto-played games never let a pal beat her teammate and always settle', () => {
  for (let seed = 1; seed <= 20; seed += 1) {
    const service = new GameService();
    const created = service.newGame({ seed });
    const { snapshot, observed } = autoPlay(service, created.id);
    assert.equal(snapshot.phase, 'SETTLED', `seed ${seed} 应在有限步内分出胜负`);
    assert.equal(observed.teammateBeats, 0, `seed ${seed} 有牌友压了自己队友`);
    const game = service.get(created.id);
    const all = [...game.playerHand, ...Object.values(game.npcHands).flat(), ...game.discarded];
    assert.equal(all.length, 54, `seed ${seed} 结束时应为 54 张`);
    assert.equal(new Set(all).size, 54);
    assert.equal(snapshot.contractVersion, CONTRACT_VERSION);
  }
});

/* E2E 走完整收藏路径依赖「玩家用提示策略能赢下这一局」，否则拿不到写真卡。
   牌友 AI 一旦调参，这个前提可能悄悄失效，所以用一条单测把它钉死。 */
test('the seed the browser E2E depends on stays a winnable deal', () => {
  const E2E_SEED = 2;
  const service = new GameService();
  const created = service.newGame({ seed: E2E_SEED });
  const { snapshot } = autoPlay(service, created.id);
  assert.equal(snapshot.settlement.winnerId, 'player', `种子 ${E2E_SEED} 必须是玩家胜局，否则 E2E 收不到写真卡`);
  assert.ok(snapshot.settlement.card, '玩家赢下时必须有写真卡');
});

/* ---------- A4 倍数与 Token 双向记账 ---------- */
function settleWith(service, gameId, { landlordId, winnerId, bombs = 0, rocket = false, playCounts = {} }) {
  const game = service.get(gameId);
  game.landlordId = landlordId;
  game.baseBid = 2;
  game.players.forEach((player) => { player.role = player.id === landlordId ? '地主' : '农民'; });
  game.bombPlayed = bombs;
  game.rocketPlayed = rocket;
  game.playCounts = { player: 0, 'pal-linxing': 0, 'pal-mia': 0, ...playCounts };
  service.settle(game, winnerId);
  return game;
}

test('multiplier stacks bombs, rocket and spring, and says how it got there', () => {
  const breakdown = buildMultiplier({ base: 2, bombs: 1, rocket: true, spring: true });
  assert.equal(breakdown.total, 2 * 2 * 2 * 2);
  assert.deepEqual(breakdown.factors.map((f) => f.label), ['叫分底分', '炸弹 ×2', '春天']);
  const capped = buildMultiplier({ base: 3, bombs: 9 });
  assert.equal(capped.total, 64);
  assert.equal(capped.capped, true, '封顶必须如实标注');
});

test('landlord win with untouched farmers is a spring and pays out to the player', () => {
  const service = new GameService();
  const created = service.newGame({ seed: 12 });
  const game = settleWith(service, created.id, { landlordId: 'player', winnerId: 'player', bombs: 1, playCounts: { player: 3, 'pal-linxing': 0, 'pal-mia': 0 } });
  assert.equal(game.settlement.breakdown.spring, true);
  assert.equal(game.multiplier, 2 * 2 * 2);
  assert.equal(game.settlement.tokenDelta, 8, '倍率与身份不放大 Token 收益');
  assert.equal(game.tokenBalance, 28);
  assert.equal(service.getLedger().at(-1).delta, 8);
  assert.equal(service.getLedger().length, 1);
});

test('a completed loss earns consolation tokens even at zero balance', () => {
  const service = new GameService({ initialTokenBalance: 0 });
  const created = service.newGame({ seed: 13 });
  const game = settleWith(service, created.id, { landlordId: 'pal-linxing', winnerId: 'pal-linxing', bombs: 4, playCounts: { player: 5, 'pal-linxing': 4, 'pal-mia': 5 } });
  assert.equal(game.settlement.tokenDelta, 2);
  assert.equal(game.settlement.tokenEffectiveDelta, 2);
  assert.equal(game.settlement.tokenBalanceAfter, 2);
  assert.equal(game.tokenBalance, 2);
});

test('结算先展示结果：玩家赢才进入演出，玩家输直接散场', () => {
  const winService = new GameService({ initialTokenBalance: 20 });
  const winCreated = winService.newGame({ seed: 61 });
  const winGame = settleWith(winService, winCreated.id, { landlordId: 'player', winnerId: 'player' });
  assert.equal(winGame.settlementStage, 'RESULT');
  assert.equal(winGame.settlement.outcome.danceEligible, true);
  assert.equal(winService.advanceSettlement(winGame.id).settlementStage, 'PERFORMANCE');
  assert.equal(winService.advanceSettlement(winGame.id).settlementStage, 'PHOTO_REVEAL');
  assert.equal(winService.advanceSettlement(winGame.id).settlementStage, 'DESTINATION');

  const loseService = new GameService({ initialTokenBalance: 20 });
  const loseCreated = loseService.newGame({ seed: 62 });
  const loseGame = settleWith(loseService, loseCreated.id, { landlordId: 'player', winnerId: 'pal-linxing' });
  assert.equal(loseGame.settlementStage, 'RESULT');
  assert.equal(loseGame.settlement.outcome.danceEligible, false);
  assert.equal(loseGame.settlement.card, null);
  assert.equal(loseService.advanceSettlement(loseGame.id).settlementStage, 'DESTINATION');
});

test('the Token wallet persists across rounds and service restarts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dressbattle-wallet-'));
  const walletPath = join(dir, 'wallet.json');
  try {
    const firstService = new GameService({ walletPath });
    const first = firstService.newGame({ seed: 51 });
    assert.equal(first.tokenBalance, 20);
    settleWith(firstService, first.id, { landlordId: 'pal-linxing', winnerId: 'player' });
    assert.equal(firstService.getAccount().balance, 28, '结算收益应计入 Token');

    const restartedService = new GameService({ walletPath });
    assert.equal(restartedService.getAccount().balance, 28);
    const next = restartedService.newGame({ seed: 52 });
    assert.equal(next.tokenBalance, 28);
    settleWith(restartedService, next.id, { landlordId: 'pal-linxing', winnerId: 'pal-linxing' });
    assert.equal(restartedService.getAccount().balance, 30, '完整负局增加 2 Token');

    const afterLossRestart = new GameService({ walletPath });
    assert.equal(afterLossRestart.getAccount().balance, 30);
    assert.equal(afterLossRestart.getLedger().length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('starting and abandoning a game costs nothing and grants no income', () => {
  const service = new GameService({ initialTokenBalance: 0 });
  for (let seed = 1; seed < 4; seed++) assert.equal(service.newGame({ seed }).tokenBalance, 0);
  assert.equal(service.getLedger().length, 0);
});

test('只有玩家胜利才选择败方牌友演出，玩家输局不掉卡不演出', () => {
  const service = new GameService();
  const a = service.newGame({ seed: 21 });
  const landlordWin = settleWith(service, a.id, { landlordId: 'player', winnerId: 'player' });
  assert.deepEqual(landlordWin.settlement.loserPalIds, ['pal-linxing', 'pal-mia'], '地主赢时两个农民都败');

  const b = service.newGame({ seed: 22 });
  const playerFarmerWin = settleWith(service, b.id, { landlordId: 'pal-linxing', winnerId: 'player' });
  assert.deepEqual(playerFarmerWin.settlement.loserPalIds, ['pal-linxing'], '农民赢时地主败');

  const c = service.newGame({ seed: 23 });
  const npcLandlordWin = settleWith(service, c.id, { landlordId: 'pal-linxing', winnerId: 'pal-linxing' });
  assert.deepEqual(npcLandlordWin.settlement.loserPalIds, ['pal-mia'], 'NPC 地主赢时，另一位农民仍是败方，但不触发玩家奖励演出');
  assert.equal(npcLandlordWin.settlement.outcome.danceEligible, false);
  assert.equal(npcLandlordWin.settlement.card, null);

  const d = service.newGame({ seed: 24 });
  const playerLandlordLost = settleWith(service, d.id, { landlordId: 'player', winnerId: 'pal-mia' });
  assert.deepEqual(playerLandlordLost.settlement.loserPalIds, [], '玩家当地主输掉时没有牌友败方');
  assert.equal(playerLandlordLost.settlement.card, null);
});

/* ---------- A5 幂等与契约 ---------- */
test('a command id cannot be reused for a different command', () => {
  const service = new GameService();
  const created = service.newGame({ seed: 41 });
  service.bid(created.id, 3, 'bid-3');
  const card = service.hint(created.id).cards[0];
  service.play(created.id, [card], 'shared-key');
  assert.throws(() => service.pass(created.id, 'shared-key'), /已被另一条命令占用/);
  assert.throws(() => service.play(created.id, [card, service.get(created.id).playerHand[0]], 'shared-key'), /已被另一条命令占用/);
  const replay = service.play(created.id, [card], 'shared-key');
  assert.equal(replay.seq, service.get(created.id).seq, '同一条命令重放返回同一份结果');
});

test('bidding rejects a reused command id that carries a different score', () => {
  const service = new GameService();
  const created = service.newGame({ seed: 42 });
  service.bid(created.id, 1, 'my-bid');
  assert.throws(() => service.bid(created.id, 3, 'my-bid'), /已被另一条命令占用/);
});

test('every seat is identified and the snapshot carries the bidding state', () => {
  const service = new GameService();
  const created = service.newGame({ seed: 43 });
  assert.deepEqual(created.players.map((p) => p.id), SEATS);
  assert.equal(created.contractVersion, CONTRACT_VERSION);
  assert.equal(created.bidding.stage, 'CALL');
  assert.equal(created.multiplier, 1);
});

/* ---------- P1a 自定义牌友上桌 ---------- */
/* 名册：服务端拿到它就会校验上桌资格，前端不能凭空指定一个座位。 */
const rosterWith = (...assets) => Object.fromEntries(assets.map((asset) => [asset.palId, asset]));
const fakeAsset = (palId, readiness = 'READY', name = `牌友-${palId}`) => ({ palId, readiness, identity: { name } });

function playToSettlement(service, gameId, budget = 400) {
  let snap = service.bid(gameId, 3, 'seat-bid');
  let steps = 0;
  while (snap.phase === 'PLAYING' && steps < budget) {
    steps += 1;
    const game = service.get(gameId);
    if (game.turn === 'player') {
      const hint = service.hint(gameId);
      snap = hint.cards.length ? service.play(gameId, hint.cards, `p${steps}`) : service.pass(gameId, `q${steps}`);
    } else snap = service.advanceTurn(gameId, `t${steps}`);
  }
  return { snap, steps };
}

test('a custom pal takes a seat, is dealt 17 cards and plays a whole game', () => {
  const service = new GameService();
  const created = service.newGame({ seed: 7, seats: ['pal-user-ab12', 'pal-mia'] });
  assert.deepEqual(created.seats, ['pal-user-ab12', 'pal-mia']);
  assert.deepEqual(created.players.map((p) => p.id), ['player', 'pal-user-ab12', 'pal-mia']);
  const game = service.get(created.id);
  assert.equal(game.npcHands['pal-user-ab12'].length, 17);
  assert.equal(game.npcHands['pal-mia'].length, 17);
  assert.equal(game.npcHands['pal-linxing'], undefined, '没上桌的牌友不持有手牌');
  const { snap, steps } = playToSettlement(service, created.id);
  assert.equal(snap.phase, 'SETTLED', `${steps} 步内必须打完`);
  assert.ok(['player', 'pal-user-ab12', 'pal-mia'].includes(snap.settlement.winnerId));
});

test('a confirmed custom pal keeps her own dialogue and starter outfit through table and settlement', () => {
  const plan = createProductionPlan({ prompt: '一位复古优雅的成年虚构舞台魔术师，喜欢蓝紫色灯光', version: 1 });
  const candidate = createProductionCandidate({ plan, imageRef: '/assets/pals/ugc/confirmed-pal.png' });
  assert.equal(candidate.asset.appearance.entryVideoFit, 'landscape', '入场片只能是横版 16:9，竖版素材不可绑定到牌局入场');
  const mia = { palId: 'pal-mia', readiness: 'READY', identity: { name: '米娅' } };
  const service = new GameService({ palRegistry: new Map([[candidate.asset.palId, candidate.asset], ['pal-mia', mia]]) });
  const created = service.newGame({ seed: 7, seats: [candidate.asset.palId, 'pal-mia'] });
  assert.deepEqual(created.seats, [candidate.asset.palId, 'pal-mia']);
  assert.equal(service.dialogueFor(candidate.asset.palId).play[0], candidate.asset.dialoguePack.play[0]);
  const game = service.get(created.id);
  game.landlordId = 'player';
  game.players.forEach((player) => { player.role = player.id === 'player' ? '地主' : '农民'; });
  service.settle(game, 'player');
  assert.equal(game.settlement.card.palId, candidate.asset.palId);
  assert.equal(game.settlement.card.outfitId, 'starter-look');
  assert.equal(game.settlement.card.layerSnapshot.base, '/assets/pals/ugc/confirmed-pal.png');
});

test('custom pal entry-film carries the fixed landscape presentation contract', () => {
  const plan = createProductionPlan({ prompt: '一位成年虚构舞台表演者，蓝紫色都市夜景', version: 1 });
  const candidate = createProductionCandidate({ plan, imageRef: '/assets/pals/ugc/landscape-entry-pal.png' });
  assert.equal(candidate.asset.appearance.entryVideoFit, 'landscape');
});

test('a pal that is not on the roster cannot be seated', () => {
  const service = new GameService({ palRegistry: rosterWith(fakeAsset('pal-user-ab12'), fakeAsset('pal-mia')) });
  assert.throws(() => service.newGame({ seats: ['pal-ghost', 'pal-mia'] }), /还没有上桌资格/);
  /* 名册里存在但资产未就绪：同样拒绝，而不是让她带着占位图上桌。 */
  const pending = new GameService({ palRegistry: rosterWith(fakeAsset('pal-user-cd34', 'GENERATING'), fakeAsset('pal-mia')) });
  assert.throws(() => pending.newGame({ seats: ['pal-user-cd34', 'pal-mia'] }), /尚未就绪/);
  const ok = new GameService({ palRegistry: rosterWith(fakeAsset('pal-user-ab12'), fakeAsset('pal-mia')) });
  assert.deepEqual(ok.newGame({ seats: ['pal-user-ab12', 'pal-mia'] }).seats, ['pal-user-ab12', 'pal-mia']);
});

test('seat order drives the turn order, not the other way round', () => {
  const service = new GameService();
  const created = service.newGame({ seed: 11, seats: ['pal-mia', 'pal-linxing'] });
  const game = service.get(created.id);
  assert.deepEqual(game.turnOrder, ['player', 'pal-mia', 'pal-linxing']);
  const after = service.bid(created.id, 1, 'order-bid');
  assert.equal(after.turn, 'pal-mia', '玩家叫完由第一位上的牌友接着叫');
});

test('a custom pal gets a deterministic personality that differs from her neighbour', () => {
  const a = derivePersonality('pal-user-ab12');
  const again = derivePersonality('pal-user-ab12');
  const b = derivePersonality('pal-user-zz99');
  assert.deepEqual(a, again, '同一位牌友每次上桌必须是同一个人');
  assert.notDeepEqual(a, b, '不同牌友不能长得一模一样');
  for (const key of ['aggression', 'control', 'structure', 'tempo']) {
    assert.ok(a[key] >= 0 && a[key] <= 1, `${key} 必须留在 0–1 之间`);
    assert.ok(Math.abs(a[key] - 0.5) <= 0.2, `${key} 的派生偏移不应把她推成另一个极端`);
  }
  assert.equal(personalityFor('pal-linxing').label, personalityOf('pal-linxing').label, '官方牌友仍走预设表');
  assert.equal(personalityFor('pal-user-ab12').label, '自定义');
});

test('a custom pal plays a legal pressure card instead of defaulting to pass', () => {
  const hand = ['Q♦', '3♣', 'J♣', '7♦', '9♥', 'J♠', 'K♣', '2♣', '3♥', '7♣', '8♦', 'SJ', 'A♠', '2♠', '4♣', 'BJ', 'K♥', '5♣', '8♥', '3♠'];
  const currentCombo = classify(['2♣', '2♠']);
  const decision = chooseMove({
    hand,
    currentCombo,
    lastPlayerId: 'pal-mia',
    personality: personalityFor('pal-user-ab12'),
    ctx: { isLandlord: true, opponentCounts: { player: 3, 'pal-mia': 10 }, myCount: hand.length }
  });
  assert.ok(decision.move, '自定义牌友有合法压制牌时不能默认不出');
  assert.deepEqual(decision.move.cards, ['SJ', 'BJ'], '应使用手中唯一合法的王炸压制对子 2');
});

/* ---------- L3 回合特写：由服务端盖在事件上 ---------- */
/* 前端拿不到 packages（静态根只有 apps/web），所以「什么算值得切镜」不能由浏览器自己
   再判断一遍——那份规则会和服务器的不一致。这里钉住：closeup 由服务端写在事件上。 */
test('the server stamps the closeup onto the event, so the browser never re-derives it', () => {
  const service = new GameService();
  const id = service.newGame({ seed: 5 }).id;
  service.bid(id, 3, 'seat-bid');
  let snap = service.snapshot(service.get(id));
  let steps = 0;
  while (snap.phase === 'PLAYING' && steps < 400) {
    steps += 1;
    const game = service.get(id);
    if (game.turn === 'player') {
      const hint = service.hint(id);
      snap = hint.cards.length ? service.play(id, hint.cards, `p${steps}`) : service.pass(id, `q${steps}`);
    } else snap = service.advanceTurn(id, `t${steps}`);
  }
  const log = service.get(id).eventLog;
  const closeups = log.filter((event) => event.closeup);
  for (const event of closeups) {
    assert.ok(['bomb', 'power', 'combo', 'alarm', 'finish', 'call', 'grab'].includes(event.closeup.tone), `未预期镜别：${event.closeup.tone}`);
    assert.notEqual(event.closeup.palId, 'player', '镜头是给对手的，玩家自己不进特写');
    assert.ok(event.closeup.durationMs > 0);
    assert.ok(event.closeup.label.length > 0);
  }
  // 一局里切镜次数必须是「点缀」量级，而不是每次出牌都切。
  assert.ok(closeups.length <= 12, `切镜过于频繁：一局 ${closeups.length} 次`);
  // 事件进入快照后 closeup 仍在（前端只读快照）。
  assert.ok((snap.events || []).every((event) => !event.closeup || event.closeup.palId !== 'player'));
});
