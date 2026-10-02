import { emptyCollection, recordWin, composePhoto, collectionSummary } from '../../packages/collection-core/index.mjs';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { CONTRACT_VERSION, validateGameSnapshot } from '../../packages/contracts/index.mjs';
import { planSettlement, nextSettlementStage, buildMultiplier, planCloseup } from '../../packages/performance-core/index.mjs';
import { classify, canBeat, enumerateMoves, hasAllCards, removeCards, shuffledDeck, sortCards, rankOf, cardValue } from '../../packages/ddz-rules/index.mjs';
import { chooseMove, suggestMove, bidScore, shouldGrab, personalityFor } from '../../packages/ddz-ai/index.mjs';
import { DEFAULT_SEATS, validateSeats } from '../../packages/contracts/index.mjs';

const DEFAULT_TOKEN_BALANCE = 100;
/* 每次进入一局先扣入场 Token；胜负结算再按倍率加减，余额与账本均由服务端掌管。 */
export const GAME_ENTRY_TOKEN_COST = 1;

/* 牌型与压制判定由 packages/ddz-rules 独占；这里只做转发，避免既有调用点断链。 */
export { classify, canBeat, shuffledDeck, sortCards, rankOf, cardValue };

const PAL_IDS = DEFAULT_SEATS;
const DECK_SIZE = 54;

/* 座次是每局的数据，不是模块常量：谁上桌由 newGame 的 seats 决定，因此轮转、
   阵营判定、发牌全部读 game.turnOrder。把它留在模块层会让自定义牌友一上桌就错位。 */
const seatsOf = (game) => game.turnOrder.slice(1);
function nextTurn(game, id) { return game.turnOrder[(game.turnOrder.indexOf(id) + 1) % game.turnOrder.length]; }
function playerFor(game, id) { return game.players.find((player) => player.id === id); }
function moveScore(move) { return (move.combo.type === 'BOMB' ? 10_000 : move.combo.type === 'ROCKET' ? 20_000 : 0) + move.combo.value * 100 + move.combo.length; }
function dealCards(seed, seats) {
  const deck = shuffledDeck(seed);
  const npcHands = {};
  seats.forEach((palId, index) => { npcHands[palId] = sortCards(deck.slice(17 + index * 17, 34 + index * 17)); });
  return {
    playerHand: sortCards(deck.slice(0, 17)),
    npcHands,
    bottomCards: sortCards(deck.slice(51))
  };
}
/* 54 张牌守恒：每一次出牌后都必须不重不漏，任何伪造牌型都会在这里暴露。 */
function assertCardIntegrity(game, where) {
  const all = [...game.playerHand, ...Object.values(game.npcHands).flat(), ...game.bottomCards, ...game.discarded];
  if (all.length !== DECK_SIZE) throw new Error(`牌面守恒校验失败（${where}）：共 ${all.length} 张，应为 ${DECK_SIZE} 张。`);
  if (new Set(all).size !== DECK_SIZE) throw new Error(`牌面守恒校验失败（${where}）：存在重复或缺失的牌。`);
}
const freshBidding = () => ({ stage: 'CALL', highScore: 0, highBidderId: null, calls: [], grabQueue: [], grabbed: false });

export class GameService {
  constructor({ receiptSecret = 'development-only-change-before-production', palDialogue = {}, palOutfits = {}, palRegistry = null, galleryPath = null, walletPath = null, initialTokenBalance = DEFAULT_TOKEN_BALANCE, gameEntryTokenCost = GAME_ENTRY_TOKEN_COST } = {}) {
    this.receiptSecret = receiptSecret;
    this.palDialogue = palDialogue;
    this.palOutfits = palOutfits;
    /* palRegistry 为 null 时不做成员校验（单元测试可自由指定座位）；一旦提供，
       任何未建档或未就绪的 palId 都会被拒绝上桌——前端不能凭空造一个座位出来。 */
    this.palRegistry = palRegistry;
    this.galleryPath = galleryPath;
    this.walletPath = walletPath;
    this.initialTokenBalance = Math.max(0, Math.floor(Number(initialTokenBalance) || 0));
    this.gameEntryTokenCost = Math.max(0, Math.floor(Number(gameEntryTokenCost) || 0));
    this.games = new Map();
    this.gallery = new Map();
    this.collection = emptyCollection();
    this.ledger = [];
    this.walletBalance = this.initialTokenBalance;
    this.restoreWallet();
    this.restoreGallery();
  }
  restoreWallet() {
    if (!this.walletPath) return;
    try {
      const parsed = JSON.parse(readFileSync(this.walletPath, 'utf8'));
      if (parsed?.version !== 1 || !Number.isSafeInteger(parsed.balance) || parsed.balance < 0 || !Array.isArray(parsed.ledger)) {
        throw new Error('Token 存档格式无效；为避免覆盖余额，服务未启动。');
      }
      this.walletBalance = parsed.balance;
      this.ledger = parsed.ledger;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      this.persistWallet();
    }
  }
  persistWallet() {
    if (!this.walletPath) return;
    mkdirSync(dirname(this.walletPath), { recursive: true });
    const temp = `${this.walletPath}.${randomUUID()}.tmp`;
    writeFileSync(temp, JSON.stringify({ version: 1, initialBalance: this.initialTokenBalance, balance: this.walletBalance, ledger: this.ledger }, null, 2), 'utf8');
    renameSync(temp, this.walletPath);
  }
  restoreGallery() {
    if (!this.galleryPath) return;
    try {
      const parsed = JSON.parse(readFileSync(this.galleryPath, 'utf8'));
      if (!Array.isArray(parsed?.player)) throw new Error('写真馆存档格式无效。');
      this.gallery.set('player', parsed.player);
      if (parsed.collection) {
        if (!Number.isSafeInteger(parsed.collection.wins) || parsed.collection.wins < 0 || !Array.isArray(parsed.collection.creations) || !parsed.collection.bonds || !parsed.collection.rewards) throw new Error('收藏进度存档格式无效。');
        this.collection = parsed.collection;
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error; // Never overwrite an unreadable collection.
    }
  }
  persistGallery() {
    if (!this.galleryPath) return;
    mkdirSync(dirname(this.galleryPath), { recursive: true });
    const temp = `${this.galleryPath}.${randomUUID()}.tmp`;
    writeFileSync(temp, JSON.stringify({ version: 2, player: this.getGallery(), collection: this.collection }, null, 2), 'utf8');
    renameSync(temp, this.galleryPath);
  }
  /* 座位解析：形状由契约校验，资格由名册校验，两者缺一不可。 */
  resolveSeats(seats = DEFAULT_SEATS) {
    const validated = validateSeats(seats);
    /* 名册可以是函数：工坊随时会造出新牌友，注册表必须是「读的时候」的状态，
       而不是服务启动时拍下来的一份快照。 */
    const registry = typeof this.palRegistry === 'function' ? this.palRegistry() : this.palRegistry;
    const lookup = (palId) => (registry?.get?.(palId) ?? registry?.[palId] ?? null);
    return validated.map((palId) => {
      const asset = lookup(palId);
      if (registry && !asset) throw new Error(`「${palId}」还没有上桌资格：只有已建档的牌友能入局。`);
      if (asset && asset.readiness !== 'READY') throw new Error(`「${asset.identity?.name || palId}」的资产尚未就绪（${asset.readiness}），暂时不能上桌。`);
      return { id: palId, name: asset?.identity?.name || palId };
    });
  }
  registryAssets() {
    const registry = typeof this.palRegistry === 'function' ? this.palRegistry() : this.palRegistry;
    if (!registry) return [];
    return registry instanceof Map ? [...registry.values()] : Object.values(registry);
  }
  dialogueFor(palId) {
    return this.palDialogue[palId] || this.registryAssets().find((asset) => asset?.palId === palId)?.dialoguePack || {};
  }
  newGame({ seed = randomBytes(4).readUInt32BE(0), seats = DEFAULT_SEATS } = {}) {
    const id = randomUUID();
    const seated = this.resolveSeats(seats);
    const turnOrder = ['player', ...seated.map((entry) => entry.id)];
    const dealt = dealCards(seed, seated.map((entry) => entry.id));
    const playCounts = Object.fromEntries(turnOrder.map((playerId) => [playerId, 0]));
    const game = {
      id, dealSeed: seed >>> 0, redeals: 0, firstBidder: 'player', phase: 'BIDDING', seq: 0,
      seats: seated.map((entry) => entry.id), turnOrder,
      playerHand: dealt.playerHand, bottomCards: dealt.bottomCards, discarded: [],
      players: [
        { id: 'player', name: '你', role: null, count: 17 },
        ...seated.map((entry) => ({ id: entry.id, name: entry.name, role: null, count: 17 }))
      ],
      npcHands: dealt.npcHands,
      turn: 'player', landlordId: null, baseBid: 1,
      bidding: freshBidding(),
      currentCombo: null, currentCards: [], lastPlayerId: null, passCount: 0, eventLog: [], commandCache: new Map(),
      settlement: null, settlementStage: null, tokenBalance: this.walletBalance, entryTokenCost: this.gameEntryTokenCost, multiplier: 1,
      bombPlayed: 0, rocketPlayed: false, playCounts
    };
    if (this.walletBalance < this.gameEntryTokenCost) {
      throw new Error(`Token 不足：开局需要 ${this.gameEntryTokenCost} Token，当前余额 ${this.walletBalance} Token。`);
    }
    if (this.gameEntryTokenCost > 0) this.recordLedger(game, -this.gameEntryTokenCost, { type: 'GAME_ENTRY' });
    assertCardIntegrity(game, 'new game');
    this.games.set(id, game);
    this.emit(game, 'GAME_CREATED', { message: this.gameEntryTokenCost ? `牌局已创建，已消耗 ${this.gameEntryTokenCost} Token，等待叫分。` : '牌局已创建，等待叫分。', tokenCost: this.gameEntryTokenCost, tokenBalance: this.walletBalance, dealRef: `deal-${game.dealSeed.toString(16).padStart(8, '0')}` });
    return this.snapshot(game);
  }

  /* ---------- A2 叫分 / 抢地主 ---------- */
  /* 叫分：按座次各叫一次，分数必须严格高于当前最高分；叫 3 立即定地主。
     一轮结束若最高分为 1 或 2，则其余两家依次选择抢地主（抢到则底分翻倍）。
     三家都不叫 → 流局重发，由下一位先叫。 */
  bid(gameId, score, commandId) {
    const value = Number(score);
    return this.idempotent(gameId, commandId, `bid:${value}`, (game) => {
      if (game.phase !== 'BIDDING') throw new Error('当前不在叫分阶段。');
      if (game.bidding.stage !== 'CALL') throw new Error('叫分已结束，现在是抢地主阶段。');
      if (game.turn !== 'player') throw new Error('还没轮到你叫分。');
      if (!Number.isInteger(value) || value < 0 || value > 3) throw new Error('只能叫 0 到 3 分。');
      if (game.bidding.calls.some((call) => call.playerId === 'player')) throw new Error('这一轮你已经叫过分了。');
      if (value > 0 && value <= game.bidding.highScore) throw new Error(`至少要叫 ${game.bidding.highScore + 1} 分才能盖过当前最高分。`);
      this.recordCall(game, 'player', value);
      this.afterCall(game);
      return this.snapshot(game);
    });
  }
  grab(gameId, accept, commandId) {
    const wants = Boolean(accept);
    return this.idempotent(gameId, commandId, `grab:${wants}`, (game) => {
      if (game.phase !== 'BIDDING') throw new Error('当前不在叫分阶段。');
      if (game.bidding.stage !== 'GRAB') throw new Error('现在不是抢地主阶段。');
      if (game.turn !== 'player') throw new Error('还没轮到你决定是否抢地主。');
      this.recordGrab(game, 'player', wants);
      this.afterGrab(game);
      return this.snapshot(game);
    });
  }
  /* NPC 的叫分 / 抢地主回合。与出牌回合分开，避免一个命令承担两种语义。 */
  advanceBid(gameId, commandId) {
    return this.idempotent(gameId, commandId, 'advanceBid', (game) => {
      if (game.phase !== 'BIDDING') throw new Error('当前不在叫分阶段。');
      if (game.turn === 'player') throw new Error('当前是玩家的叫分回合。');
      const pal = game.turn;
      if (game.bidding.stage === 'CALL') {
        const value = bidScore(game.npcHands[pal], pal);
        const accepted = value > game.bidding.highScore ? value : 0;
        this.recordCall(game, pal, accepted);
        this.afterCall(game);
      } else {
        const wants = shouldGrab(game.npcHands[pal], pal, game.bidding.highScore);
        this.recordGrab(game, pal, wants);
        this.afterGrab(game);
      }
      return this.snapshot(game);
    });
  }
  recordCall(game, playerId, score) {
    game.bidding.calls.push({ playerId, score });
    if (score > game.bidding.highScore) { game.bidding.highScore = score; game.bidding.highBidderId = playerId; }
    const name = playerFor(game, playerId).name;
    this.emit(game, 'BID_CALL', { playerId, score, highScore: game.bidding.highScore, dialogue: score === 0 ? `${name}不叫。` : `${name}叫 ${score} 分。` });
  }
  afterCall(game) {
    const bidding = game.bidding;
    if (bidding.highScore === 3) return this.resolveBid(game, bidding.highBidderId, 3);
    if (bidding.calls.length < game.turnOrder.length) { game.turn = nextTurn(game, game.turn); return; }
    if (bidding.highScore === 0) return this.redeal(game, '三家都不叫，流局重发。');
    /* 进入抢地主：从最高分者的下家开始，其余两家依次决定。 */
    bidding.stage = 'GRAB';
    bidding.grabQueue = [nextTurn(game, bidding.highBidderId), nextTurn(game, nextTurn(game, bidding.highBidderId))];
    game.turn = bidding.grabQueue[0];
  }
  recordGrab(game, playerId, wants) {
    const name = playerFor(game, playerId).name;
    this.emit(game, 'BID_GRAB', { playerId, accepted: wants, dialogue: wants ? `${name}抢地主！` : `${name}不抢。` });
    if (!wants) return;
    game.bidding.grabbed = true;
    this.resolveBid(game, playerId, game.bidding.highScore * 2);
  }
  afterGrab(game) {
    if (game.bidding.grabbed) return;
    const queue = game.bidding.grabQueue.filter((id) => id !== game.turn);
    game.bidding.grabQueue = queue;
    if (queue.length) { game.turn = queue[0]; return; }
    this.resolveBid(game, game.bidding.highBidderId, game.bidding.highScore);
  }
  redeal(game, message) {
    game.redeals += 1;
    game.firstBidder = nextTurn(game, game.firstBidder);
    const seed = (game.dealSeed + game.redeals * 0x9e3779b1) >>> 0;
    const dealt = dealCards(seed, seatsOf(game));
    game.playerHand = dealt.playerHand;
    game.npcHands = dealt.npcHands;
    game.bottomCards = dealt.bottomCards;
    game.discarded = [];
    game.players.forEach((player) => { player.count = 17; });
    game.bidding = freshBidding();
    game.turn = game.firstBidder;
    game.landlordId = null;
    game.baseBid = 1;
    game.multiplier = 1;
    game.bombPlayed = 0;
    game.rocketPlayed = false;
    game.playCounts = Object.fromEntries(game.turnOrder.map((playerId) => [playerId, 0]));
    game.commandCache.clear();
    assertCardIntegrity(game, 'redeal');
    this.emit(game, 'BID_REDEAL', { message, dealRef: `deal-${seed.toString(16).padStart(8, '0')}` });
  }
  resolveBid(game, landlordId, base) {
    const bidding = game.bidding;
    bidding.stage = 'DONE';
    game.landlordId = landlordId;
    game.baseBid = base;
    game.multiplier = base;
    const bottom = game.bottomCards;
    game.players.forEach((player) => { player.role = player.id === landlordId ? '地主' : '农民'; });
    if (landlordId === 'player') game.playerHand = sortCards([...game.playerHand, ...bottom]);
    else game.npcHands[landlordId] = sortCards([...game.npcHands[landlordId], ...bottom]);
    playerFor(game, landlordId).count = 20;
    game.phase = 'PLAYING';
    game.turn = landlordId;
    game.bottomCards = [];
    const name = playerFor(game, landlordId).name;
    this.emit(game, 'BID_RESOLVED', {
      landlordId, score: base, bottomCards: bottom, grabbed: bidding.grabbed,
      dialogue: `${name}以 ${base} 分成为地主，领取底牌：${bottom.join(' ')}。由${name}先出。`
    });
    assertCardIntegrity(game, 'bid resolved');
  }

  /* ---------- 出牌 ---------- */
  /* NPC 决策所需的公开信息：阵营、队友、对手剩余张数。全部来自服务端状态，浏览器无法伪造。 */
  npcContext(game, forId) {
    const landlordId = game.landlordId;
    const isLandlord = landlordId === forId;
    const opponents = isLandlord ? game.turnOrder.filter((id) => id !== forId) : [landlordId].filter(Boolean);
    const teammateId = isLandlord ? null : game.turnOrder.find((id) => id !== forId && id !== landlordId) || null;
    const countOf = (id) => (id === 'player' ? game.playerHand.length : game.npcHands[id]?.length ?? 0);
    return {
      isLandlord, landlordId, teammateId,
      myCount: countOf(forId),
      teammateCount: teammateId ? countOf(teammateId) : null,
      opponentCounts: Object.fromEntries(opponents.map((id) => [id, countOf(id)])),
      personality: personalityFor(forId)
    };
  }
  hint(gameId) {
    const game = this.get(gameId);
    if (game.phase !== 'PLAYING' || game.turn !== 'player') throw new Error('请等待当前牌友完成回合。');
    return suggestMove({
      hand: game.playerHand,
      currentCombo: game.currentCombo,
      lastPlayerId: game.lastPlayerId,
      ctx: this.npcContext(game, 'player')
    });
  }
  play(gameId, cards, commandId) {
    const normalized = Array.isArray(cards) ? sortCards(cards) : cards;
    return this.idempotent(gameId, commandId, `play:${Array.isArray(normalized) ? normalized.join(',') : ''}`, (game) => {
      if (game.phase !== 'PLAYING') throw new Error('牌局尚未开始或已结算。');
      if (game.turn !== 'player') throw new Error('尚未轮到你出牌。');
      if (!Array.isArray(cards) || !cards.length) throw new Error('请选择要出的牌。');
      /* 多重集校验：同一张牌不能被重复提交来伪造对子、三张或炸弹。 */
      if (!hasAllCards(game.playerHand, cards)) throw new Error('请选择自己手中的牌，同一张牌不能重复使用。');
      const combo = classify(cards);
      if (!combo) throw new Error('这不是合法牌型。可用“提示”查看引导局推荐。');
      if (!canBeat(combo, game.currentCombo)) throw new Error('当前牌型无法压过上一手。');
      game.playerHand = removeCards(game.playerHand, cards);
      game.discarded.push(...cards);
      game.players[0].count = game.playerHand.length;
      this.registerPlay(game, 'player', combo);
      game.currentCombo = combo; game.currentCards = cards; game.lastPlayerId = 'player'; game.passCount = 0;
      this.emit(game, 'PLAY_ACCEPTED', { playerId: 'player', cards, combo, dialogue: '出得漂亮！' });
      assertCardIntegrity(game, 'player play');
      if (!game.playerHand.length) this.settle(game, 'player'); else game.turn = nextTurn(game, 'player');
      return this.snapshot(game);
    });
  }
  pass(gameId, commandId) {
    return this.idempotent(gameId, commandId, 'pass', (game) => {
      if (game.phase !== 'PLAYING' || game.turn !== 'player') throw new Error('尚未轮到你选择不出。');
      if (!game.currentCombo || game.lastPlayerId === 'player') throw new Error('本轮由你领出，需要先出一手牌。');
      this.emit(game, 'PLAYER_PASS', { playerId: 'player', dialogue: '这手不跟。' });
      this.completePass(game, 'player');
      return this.snapshot(game);
    });
  }
  advanceTurn(gameId, commandId) {
    return this.idempotent(gameId, commandId, 'advanceTurn', (game) => {
      if (game.phase !== 'PLAYING' || game.turn === 'player') throw new Error('当前不需要推进牌友回合。');
      const pal = game.turn;
      const hand = game.npcHands[pal];
      const decision = chooseMove({
        hand,
        currentCombo: game.currentCombo,
        lastPlayerId: game.lastPlayerId,
        personality: personalityFor(pal),
        ctx: this.npcContext(game, pal)
      });
      if (!decision.move) {
        const dialogue = this.dialogueFor(pal)?.pass?.[0] || '这手先观察。';
        this.emit(game, 'PAL_ACTION', { playerId: pal, action: 'A03', dialogue, presentation: 'L1', decision: 'PASS', reason: decision.reason, holdingBack: Boolean(decision.holdingBack) });
        this.completePass(game, pal);
        return this.snapshot(game);
      }
      game.npcHands[pal] = removeCards(hand, decision.move.cards);
      game.discarded.push(...decision.move.cards);
      playerFor(game, pal).count = game.npcHands[pal].length;
      this.registerPlay(game, pal, decision.move.combo);
      game.currentCombo = decision.move.combo; game.currentCards = decision.move.cards; game.lastPlayerId = pal; game.passCount = 0;
      this.emit(game, 'PAL_ACTION', { playerId: pal, action: 'A02', cards: decision.move.cards, combo: decision.move.combo, dialogue: this.dialogueFor(pal)?.play?.[0] || '这一手，我来接。', presentation: 'L1', decision: 'PLAY', reason: decision.reason });
      assertCardIntegrity(game, 'npc turn');
      if (!game.npcHands[pal].length) this.settle(game, pal); else game.turn = nextTurn(game, pal);
      return this.snapshot(game);
    });
  }
  /* 记录炸弹、王炸与出牌次数：倍率与春天的判定全部依赖这里的计数。 */
  registerPlay(game, playerId, combo) {
    if (combo.type === 'BOMB') game.bombPlayed += 1;
    if (combo.type === 'ROCKET') game.rocketPlayed = true;
    game.playCounts[playerId] = (game.playCounts[playerId] || 0) + 1;
    game.multiplier = buildMultiplier({ base: game.baseBid, bombs: game.bombPlayed, rocket: game.rocketPlayed }).total;
  }
  completePass(game, playerId) {
    const leader = game.lastPlayerId;
    game.passCount += 1;
    if (game.passCount < 2) { game.turn = nextTurn(game, playerId); return; }
    game.currentCombo = null; game.currentCards = []; game.lastPlayerId = null; game.passCount = 0; game.turn = leader;
    this.emit(game, 'ROUND_RESET', { message: `${playerFor(game, leader).name} 获得新一轮领出权。`, leaderId: leader });
  }

  /* ---------- A4 结算 ---------- */
  settle(game, winnerId) {
    if (game.phase === 'SETTLED') return;
    game.phase = 'SETTLED';
    const landlordId = game.landlordId;
    const winnerIsLandlord = winnerId === landlordId;
    const farmers = game.turnOrder.filter((id) => id !== landlordId);
    /* 斗地主阵营：地主赢则两个农民败，农民赢则地主败。只有玩家赢时，
       才从败方 AI 中选一名牌友作为演出者；玩家输局不触发舞蹈。 */
    const loserSide = winnerIsLandlord ? farmers : [landlordId];
    const loserPalIds = loserSide.filter((id) => id !== 'player');
    /* 春天：地主走完而农民一张未出；反春天：农民走完而地主只出过第一手。 */
    const spring = winnerIsLandlord
      ? farmers.every((id) => (game.playCounts[id] || 0) === 0)
      : (game.playCounts[landlordId] || 0) <= 1;
    const breakdown = buildMultiplier({ base: game.baseBid, bombs: game.bombPlayed, rocket: game.rocketPlayed, spring });
    game.multiplier = breakdown.total;
    const unlocked = this.gallery.get('player') || [];
    const rounds = game.eventLog.filter((event) => event.type === 'ROUND_RESET').length + 1;
    const dynamicOutfits = { ...this.palOutfits };
    this.registryAssets().forEach((asset) => { if (asset?.appearance?.outfitLibrary?.length) dynamicOutfits[asset.palId] = asset.appearance.outfitLibrary; });
    game.settlement = planSettlement({
      gameId: game.id, winnerId: (winnerId === 'player' || (landlordId !== 'player' && !winnerIsLandlord)) ? 'player' : winnerId, loserPalIds, multiplier: game.multiplier, breakdown,
      playerIsLandlord: landlordId === 'player',
      alreadyUnlocked: unlocked, outfitLibrary: dynamicOutfits,
      gameStats: { rounds, lastCombo: game.currentCombo?.label || null },
      unlockedAt: new Date().toISOString()
    });
    game.settlement.finisherId = winnerId;
    game.settlementStage = 'RESULT';
    if (game.settlement.tokenDelta !== 0) {
      const receipt = this.recordLedger(game, game.settlement.tokenDelta, { type: 'SETTLEMENT' });
      game.settlement = { ...game.settlement, tokenEffectiveDelta: receipt.effective, tokenBalanceAfter: receipt.balance };
    }
    if (game.settlement.card) {
      const cards = [...unlocked];
      const index = cards.findIndex((entry) => entry.cardId === game.settlement.card.cardId);
      this.collection = recordWin(this.collection, { gameId: game.id, palId: game.settlement.card.palId, cardId: game.settlement.card.cardId });
      if (index >= 0) cards[index] = { ...game.settlement.card, serialNo: cards[index].serialNo };
      else cards.push(game.settlement.card);
      this.gallery.set('player', cards);
      this.persistGallery();
    }
    assertCardIntegrity(game, 'settlement');
    this.emit(game, 'ROUND_SETTLED', { settlement: game.settlement, message: '牌局结束，进入结算演出。' });
  }
  advanceSettlement(gameId) {
    const game = this.get(gameId);
    if (!game.settlement) throw new Error('尚未进入结算。');
    /* 先展示 RESULT。只有玩家赢且确实选出了 AI 牌友，才进入 PERFORMANCE；
       玩家输局直接进入散场，避免误播胜方视频或把输局变成奖励演出。 */
    game.settlementStage = game.settlementStage === 'RESULT' && !game.settlement.outcome?.danceEligible
      ? 'DESTINATION'
      : nextSettlementStage(game.settlementStage);
    this.emit(game, 'SETTLEMENT_STAGE', { stage: game.settlementStage });
    return this.snapshot(game);
  }
  snapshot(game) {
    return validateGameSnapshot({
      contractVersion: CONTRACT_VERSION, id: game.id, phase: game.phase, seq: game.seq, playerHand: game.playerHand,
      /* seats 随快照下发：前端按它渲染座位与出牌锚点，不再假设「上桌的一定是林星和米娅」。 */
      seats: [...game.seats],
      players: game.players.map(({ id, name, role, count }) => ({ id, name, role, count })),
      turn: game.turn, lastPlayerId: game.lastPlayerId, landlordId: game.landlordId,
      bidding: { ...game.bidding, calls: game.bidding.calls.map((call) => ({ ...call })), grabQueue: [...game.bidding.grabQueue] },
      currentCombo: game.currentCombo, currentCards: game.currentCards, events: game.eventLog.slice(-14),
      settlement: game.settlement, settlementStage: game.settlementStage,
      tokenBalance: this.walletBalance, multiplier: game.multiplier
    });
  }
  /* Token 双向记账：赢要真的入账，输要真的出账。余额不足时按余额结算，账本如实记录实际变动。 */
  recordLedger(game, delta, { type = 'SETTLEMENT' } = {}) {
    const effective = -Math.min(this.walletBalance, Math.max(0, -delta)) + Math.max(0, delta);
    this.walletBalance = Math.max(0, this.walletBalance + effective);
    game.tokenBalance = this.walletBalance;
    const receipt = { id: `receipt-${type.toLowerCase()}-${game.id}-${this.ledger.length + 1}`, type, gameId: game.id, delta, effective, balance: this.walletBalance, issuedAt: new Date().toISOString() };
    receipt.signature = createHmac('sha256', this.receiptSecret).update(JSON.stringify(receipt)).digest('hex');
    this.ledger.push(receipt); this.persistWallet(); return receipt;
  }
  /* 特写（L3 镜头）由服务端在事件上就地判定：台词、动作码本来就是服务端写的叙事，
     「哪一刻值得切镜」也该由同一处决定——否则前端会自己再写一份「什么算大牌」，
     两份规则迟早不一致。判定规则本身是 packages/performance-core 里的纯函数。 */
  emit(game, type, payload) {
    game.seq += 1;
    const event = { seq: game.seq, type, at: new Date().toISOString(), ...payload };
    const closeup = planCloseup({
      event,
      comboType: payload?.combo?.type || '',
      comboLabel: payload?.combo?.label || '',
      remaining: payload?.playerId && game.npcHands?.[payload.playerId] ? game.npcHands[payload.playerId].length : null
    });
    if (closeup) event.closeup = closeup;
    game.eventLog.push(event);
  }
  get(id) { const game = this.games.get(id); if (!game) throw new Error('找不到牌局，请重新开始。'); return game; }
  /* A5 幂等：同一个 commandId 只能代表同一条命令。换了参数复用同一个键会被拒绝，
     而不是悄悄返回上一次的结果——否则「重放出牌」会变成「伪造一次已通过的裁决」。 */
  idempotent(gameId, commandId, kind, fn) {
    const game = this.get(gameId);
    if (!commandId) throw new Error('命令缺少幂等键。');
    const cached = game.commandCache.get(commandId);
    if (cached) {
      if (cached.kind !== kind) throw new Error('幂等键已被另一条命令占用，不能复用。');
      return cached.result;
    }
    const result = fn(game);
    game.commandCache.set(commandId, { kind, result });
    return result;
  }
  getCollection() {
    const libraries = { ...this.palOutfits };
    this.registryAssets().forEach((asset) => { if (asset?.appearance?.outfitLibrary?.length) libraries[asset.palId] = asset.appearance.outfitLibrary; });
    return { ...collectionSummary(this.collection, this.getGallery(), libraries), creations: this.collection.creations, pending: Object.entries(this.collection.rewards).filter(([gameId]) => !this.collection.creations.some((c) => c.gameId === gameId)).map(([gameId, reward]) => ({ gameId, ...reward })) };
  }
  savePhoto(input) {
    const before = this.collection;
    this.collection = composePhoto(before, this.getGallery(), input);
    try { this.persistGallery(); } catch (error) { this.collection = before; throw error; }
    return this.collection.creations.find((item) => item.gameId === input.gameId);
  }
  getGallery() { return this.gallery.get('player') || []; }
  markCardSeen(cardId) {
    const cards = this.getGallery().map((entry) => (entry.cardId === cardId ? { ...entry, seen: true } : entry));
    this.gallery.set('player', cards);
    this.persistGallery();
    return cards;
  }
  getLedger() { return this.ledger; }
  getAccount() { return { tokenBalance: this.walletBalance, balance: this.walletBalance, initialBalance: this.initialTokenBalance, gameEntryTokenCost: this.gameEntryTokenCost }; }
}

export { PAL_IDS, moveScore, enumerateMoves, seatsOf };
