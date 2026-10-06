import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_UPGRADE_LEVEL } from '../packages/contracts/index.mjs';
import { planSettlement, nextSettlementStage, planCloseup } from '../packages/performance-core/index.mjs';

const library = {
  'pal-linxing': [
    { outfitId: 'starry-gown', name: '星夜礼服', dance: '月光步', layerSnapshot: { base: 'b', outfit: 'o1', effect: 'f1' } },
    { outfitId: 'rose-waltz', name: '蔷薇圆舞', dance: '蔷薇旋转', layerSnapshot: { base: 'b', outfit: 'o2', effect: 'f2' } },
    { outfitId: 'dawn-silk', name: '晨曦纱裙', dance: '晨辉步', layerSnapshot: { base: 'b', outfit: 'o3', effect: 'f3' } }
  ]
};
const win = (gameId, alreadyUnlocked = []) => ({ gameId, winnerId: 'player', loserPalIds: ['pal-linxing'], multiplier: 3, alreadyUnlocked, outfitLibrary: library });

test('settlement is deterministic and first unlock follows the outfit library order', () => {
  const first = planSettlement(win('g1'));
  const second = planSettlement(win('g1'));
  assert.deepEqual(first, second);
  assert.equal(first.isFirstUnlock, true);
  assert.equal(first.card.outfitId, 'starry-gown');
  assert.equal(first.card.rarity, 'first');
  assert.equal(first.card.upgradeLevel, 1);
  assert.equal(first.card.serialNo, 1);
  assert.equal(nextSettlementStage('PERFORMANCE'), 'PHOTO_REVEAL');
});

test('each win unlocks the next outfit, then repeats upgrade the same card', () => {
  const one = planSettlement(win('g1'));
  const two = planSettlement(win('g2', [one.card]));
  assert.equal(two.card.outfitId, 'rose-waltz');
  assert.equal(two.card.serialNo, 2);
  const three = planSettlement(win('g3', [one.card, two.card]));
  assert.equal(three.card.outfitId, 'dawn-silk');
  const fourth = planSettlement(win('g4', [one.card, two.card, three.card]));
  assert.equal(fourth.isFirstUnlock, false);
  assert.equal(fourth.card.rarity, 'normal');
  assert.equal(fourth.card.upgradeLevel, 2);
  assert.equal(fourth.card.serialNo, 1, 'upgrade keeps the original serial number');
  const fifth = planSettlement(win('g5', [one.card, two.card, three.card, fourth.card]));
  assert.equal(fifth.card.outfitId, 'rose-waltz');
  assert.equal(fifth.card.upgradeLevel, 2);
});

test('losing player gets no photo card and earns a fixed completion reward', () => {
  const lost = planSettlement({ gameId: 'g6', winnerId: 'pal-linxing', loserPalIds: [], multiplier: 3, outfitLibrary: library });
  assert.equal(lost.card, null);
  assert.equal(lost.cardId, null);
  assert.equal(lost.tokenDelta, 2);
  assert.equal(lost.outcome.playerWon, false);
  assert.equal(lost.outcome.danceEligible, false);
});

test('斗地主四种阵营组合明确决定演出资格与演出牌友', () => {
  const landlordWin = planSettlement({ gameId: 'combo-1', winnerId: 'player', playerIsLandlord: true, loserPalIds: ['pal-linxing', 'pal-mia'], multiplier: 1, outfitLibrary: library });
  assert.equal(landlordWin.outcome.playerSide, 'landlord');
  assert.equal(landlordWin.outcome.winnerSide, 'landlord');
  assert.equal(landlordWin.outcome.danceEligible, true);
  assert.equal(landlordWin.outcome.dancePalId, 'pal-linxing');

  const farmerWin = planSettlement({ gameId: 'combo-2', winnerId: 'player', playerIsLandlord: false, loserPalIds: ['pal-linxing'], multiplier: 1, outfitLibrary: library });
  assert.equal(farmerWin.outcome.playerSide, 'farmers');
  assert.equal(farmerWin.outcome.winnerSide, 'farmers');
  assert.equal(farmerWin.outcome.danceEligible, true);
  assert.equal(farmerWin.outcome.dancePalId, 'pal-linxing');

  const landlordLoss = planSettlement({ gameId: 'combo-3', winnerId: 'pal-linxing', playerIsLandlord: true, loserPalIds: ['pal-mia'], multiplier: 1, outfitLibrary: library });
  assert.equal(landlordLoss.outcome.playerSide, 'landlord');
  assert.equal(landlordLoss.outcome.winnerSide, 'farmers');
  assert.equal(landlordLoss.outcome.danceEligible, false);
  assert.equal(landlordLoss.card, null);

  const farmerLoss = planSettlement({ gameId: 'combo-4', winnerId: 'pal-linxing', playerIsLandlord: false, loserPalIds: ['pal-linxing'], multiplier: 1, outfitLibrary: library });
  assert.equal(farmerLoss.outcome.playerSide, 'farmers');
  assert.equal(farmerLoss.outcome.winnerSide, 'landlord');
  assert.equal(farmerLoss.outcome.danceEligible, false);
  assert.equal(farmerLoss.card, null);
});

test('photo card carries audited identity, layer snapshot and game stats', () => {
  const result = planSettlement({ ...win('g7'), gameStats: { rounds: 4, lastCombo: '顺子' }, unlockedAt: '2026-09-12T06:00:00.000Z' });
  assert.match(result.card.auditRecordId, /^audit-/);
  assert.equal(result.card.layerSnapshot.outfit, 'o1');
  assert.equal(result.card.gameStats.rounds, 4);
  assert.equal(result.card.gameStats.lastCombo, '顺子');
  assert.equal(result.card.unlockedAt, '2026-09-12T06:00:00.000Z');
  assert.equal(result.card.seen, false);
});

/* ---------- L3 回合特写 ---------- */
/* 特写是「切镜」不是「提示条」，所以判定必须收窄：普通出牌不切镜，否则一局要切十几次，
   镜头本身就没有意义了。下面把「切」与「不切」的边界都钉住。 */
test('a closeup fires only on moments worth cutting to', () => {
  // 普通单张 / 对子：不切镜。
  assert.equal(planCloseup({ event: { type: 'PAL_ACTION', playerId: 'pal-mia', decision: 'PLAY', cards: ['3♠'] }, comboType: 'SINGLE', comboLabel: '单张', remaining: 12 }), null);
  assert.equal(planCloseup({ event: { type: 'PAL_ACTION', playerId: 'pal-mia', decision: 'PLAY', cards: ['3♠', '3♥'] }, comboType: 'PAIR', comboLabel: '对子', remaining: 11 }), null);
  // 过牌：不切镜——「不出」没有画面可看。
  assert.equal(planCloseup({ event: { type: 'PAL_ACTION', playerId: 'pal-mia', decision: 'PASS' }, remaining: 5 }), null);
  // 玩家自己：镜头是给对手的。
  assert.equal(planCloseup({ event: { type: 'PAL_ACTION', playerId: 'player', decision: 'PLAY', cards: ['3♠', '3♥', '3♦', '3♣'] }, comboType: 'BOMB', comboLabel: '炸弹', remaining: 1 }), null);
  // 无事件 / 无玩家。
  assert.equal(planCloseup({}), null);
  assert.equal(planCloseup(), null);

  const bomb = planCloseup({ event: { type: 'PAL_ACTION', playerId: 'pal-linxing', action: 'A02', decision: 'PLAY', dialogue: '这手归我。', cards: ['3♠', '3♥', '3♦', '3♣'] }, comboType: 'BOMB', comboLabel: '炸弹', remaining: 6 });
  assert.equal(bomb.tone, 'bomb');
  assert.equal(bomb.label, '炸弹');
  assert.equal(bomb.palId, 'pal-linxing');
  assert.equal(bomb.dialogue, '这手归我。');
  assert.ok(bomb.durationMs >= 2000, '炸弹的镜头该比普通切镜停留得久一点');

  assert.equal(planCloseup({ event: { type: 'PAL_ACTION', playerId: 'pal-mia', decision: 'PLAY', cards: new Array(5) }, comboType: 'STRAIGHT', comboLabel: '5张顺子', remaining: 8 }).tone, 'combo');
  assert.equal(planCloseup({ event: { type: 'PAL_ACTION', playerId: 'pal-mia', decision: 'PLAY', cards: new Array(4) }, comboType: 'TRIPLE_ONE', comboLabel: '三带一', remaining: 8 }).tone, 'power');
  assert.equal(planCloseup({ event: { type: 'PAL_ACTION', playerId: 'pal-mia', decision: 'PLAY', cards: new Array(1) }, comboType: 'SINGLE', comboLabel: '单张', remaining: 1 }).tone, 'alarm');
  assert.match(planCloseup({ event: { type: 'PAL_ACTION', playerId: 'pal-mia', decision: 'PLAY', cards: new Array(1) }, comboType: 'SINGLE', comboLabel: '单张', remaining: 0 }).label, /收官/);
  assert.equal(planCloseup({ event: { type: 'BID_CALL', playerId: 'pal-mia', score: 2 } }).tone, 'call');
  assert.equal(planCloseup({ event: { type: 'BID_CALL', playerId: 'pal-mia', score: 1 } }), null);
  assert.equal(planCloseup({ event: { type: 'BID_GRAB', playerId: 'pal-mia', accepted: true } }).tone, 'grab');
  assert.equal(planCloseup({ event: { type: 'BID_GRAB', playerId: 'pal-mia', accepted: false } }), null);
});


test('a persisted unique-card gallery upgrades every outfit evenly and respects the cap', () => {
  const cards = new Map();
  for (let i = 0; i < 3 * (MAX_UPGRADE_LEVEL + 1); i++) {
    const result = planSettlement(win(`persisted-${i}`, [...cards.values()]));
    cards.set(result.cardId, result.card);
    if (i < 3 * MAX_UPGRADE_LEVEL) {
      assert.equal(result.card.outfitId, library['pal-linxing'][i % 3].outfitId);
      assert.equal(result.card.upgradeLevel, Math.floor(i / 3) + 1);
    }
    assert.equal(result.card.serialNo, library['pal-linxing'].findIndex((o) => o.outfitId === result.card.outfitId) + 1);
    assert.ok(result.card.upgradeLevel <= MAX_UPGRADE_LEVEL);
  }
  assert.deepEqual([...cards.values()].map((c) => c.upgradeLevel), [5, 5, 5]);
});
