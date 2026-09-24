import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, canBeat, hasAllCards, removeCards, enumerateMoves, shuffledDeck, sortCards, rankOf } from '../packages/ddz-rules/index.mjs';

const type = (cards) => classify(cards)?.type ?? null;

test('classifier recognizes all fourteen standard card types', () => {
  const fixtures = [
    [['3♣'], 'SINGLE'],
    [['3♣', '3♦'], 'PAIR'],
    [['Q♣', 'Q♦', 'Q♥'], 'TRIPLE'],
    [['7♣', '7♦', '7♥', '7♠'], 'BOMB'],
    [['SJ', 'BJ'], 'ROCKET'],
    [['3♣', '3♦', '3♥', '5♠'], 'TRIPLE_ONE'],
    [['3♣', '3♦', '3♥', '5♠', '5♥'], 'TRIPLE_PAIR'],
    [['3♣', '4♣', '5♣', '6♣', '7♣'], 'STRAIGHT'],
    [['10♣', 'J♣', 'Q♣', 'K♣', 'A♣'], 'STRAIGHT'],
    [['3♣', '3♦', '4♣', '4♦', '5♣', '5♦'], 'DOUBLE_STRAIGHT'],
    [['3♣', '3♦', '3♥', '4♣', '4♦', '4♥'], 'TRIPLE_STRAIGHT'],
    [['3♣', '3♦', '3♥', '4♣', '4♦', '4♥', '5♠', '6♠'], 'AIRPLANE_ONE'],
    [['3♣', '3♦', '3♥', '4♣', '4♦', '4♥', '5♠', '5♥', '6♠', '6♥'], 'AIRPLANE_PAIR'],
    [['7♣', '7♦', '7♥', '7♠', '3♣', '4♦'], 'FOUR_TWO'],
    [['7♣', '7♦', '7♥', '7♠', '3♣', '3♦', '4♠', '4♥'], 'FOUR_TWO_PAIR']
  ];
  for (const [cards, expected] of fixtures) assert.equal(type(cards), expected, `${expected} 判定失败: ${cards.join(' ')}`);
  assert.ok(fixtures.length >= 14);
});

test('classifier rejects malformed, duplicate and near-miss combinations', () => {
  const rejects = [
    ['3♣', '3♣'],
    ['10♣', 'J♣', 'Q♣', 'K♣', 'A♣', '2♣'],
    ['3♣', '4♣', '5♣', '6♣'],
    ['3♣', '3♦', '4♣', '4♦'],
    ['3♣', '3♦', '3♥', '4♣', '4♦', '4♥', '5♠'],
    ['7♣', '7♦', '7♥', '7♠', '3♣', '3♦'],
    ['SJ', 'SJ'],
    ['3♣', '3♦', '3♥', '3♠', '4♣'],
    ['3♣', '3♦', '3♥', '4♣', '4♦', '4♥', '5♠', '5♥']
  ];
  for (const cards of rejects) assert.equal(type(cards), null, `本应判非法: ${cards.join(' ')}`);
  assert.equal(type([]), null);
  assert.equal(type(['ZZ']), null);
});

test('bomb and rocket precedence follows standard rules', () => {
  const bomb7 = classify(['7♣', '7♦', '7♥', '7♠']);
  const bombA = classify(['A♣', 'A♦', 'A♥', 'A♠']);
  const rocket = classify(['SJ', 'BJ']);
  const single = classify(['A♣']);
  const fourTwo = classify(['7♣', '7♦', '7♥', '7♠', '3♣', '4♦']);
  assert.equal(canBeat(bomb7, single), true);
  assert.equal(canBeat(rocket, bombA), true);
  assert.equal(canBeat(bombA, rocket), false);
  assert.equal(canBeat(bomb7, bombA), false);
  assert.equal(canBeat(bombA, bomb7), true);
  assert.equal(canBeat(fourTwo, bomb7), false, '四带二不是炸弹，不能压炸弹');
  assert.equal(canBeat(bomb7, fourTwo), true);
  assert.equal(canBeat(single, null), true);
});

test('same-type comparisons require matching length and strictly higher rank', () => {
  const straight5 = classify(['3♣', '4♣', '5♣', '6♣', '7♣']);
  const straight5High = classify(['4♣', '5♣', '6♣', '7♣', '8♣']);
  const straight6 = classify(['3♣', '4♣', '5♣', '6♣', '7♣', '8♣']);
  assert.equal(canBeat(straight5High, straight5), true);
  assert.equal(canBeat(straight5, straight5High), false);
  assert.equal(canBeat(straight6, straight5), false, '顺子长度不同不能压');
  const ranks = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2', 'SJ', 'BJ'];
  for (let index = 0; index < ranks.length - 1; index += 1) {
    assert.equal(canBeat(classify([`${ranks[index + 1]}♣`]), classify([`${ranks[index]}♣`])), true);
    assert.equal(canBeat(classify([`${ranks[index + 1]}♣`, `${ranks[index + 1]}♦`]), classify([`${ranks[index]}♣`, `${ranks[index]}♦`])), true);
  }
});

test('multiset guard blocks playing the same physical card twice', () => {
  assert.equal(hasAllCards(['3♣', '3♦'], ['3♣', '3♣']), false);
  assert.equal(hasAllCards(['3♣', '3♦'], ['3♣', '3♦']), true);
  assert.equal(hasAllCards(['3♣'], ['3♣', '3♦']), false);
  assert.equal(hasAllCards(['3♣'], []), true);
  assert.deepEqual(removeCards(['3♣', '3♦'], ['3♣']), ['3♦']);
  assert.throws(() => removeCards(['3♣'], ['3♣', '3♣']));
});

test('move enumeration covers extended types without duplicating cards', () => {
  const hand = ['3♣', '3♦', '3♥', '4♣', '4♦', '4♥', '5♣', '5♦', '6♣', '7♣', '8♣', '9♣', 'SJ', 'BJ'];
  const moves = enumerateMoves(hand);
  const types = new Set(moves.map((move) => move.combo.type));
  for (const expected of ['SINGLE', 'PAIR', 'TRIPLE', 'TRIPLE_ONE', 'TRIPLE_PAIR', 'STRAIGHT', 'DOUBLE_STRAIGHT', 'TRIPLE_STRAIGHT', 'AIRPLANE_ONE', 'ROCKET']) {
    assert.ok(types.has(expected), `枚举缺少 ${expected}`);
  }
  for (const move of moves) {
    assert.equal(new Set(move.cards).size, move.cards.length, '枚举产生了重复牌');
    assert.ok(hasAllCards(hand, move.cards), '枚举产生了手牌中不存在的牌');
    assert.equal(classify(move.cards)?.type, move.combo.type, '枚举产物的牌型自相矛盾');
  }
});

test('a full deck stays intact across deals and sorting is stable by rank', () => {
  const deck = shuffledDeck(7);
  assert.equal(deck.length, 54);
  assert.equal(new Set(deck).size, 54);
  assert.deepEqual(sortCards(['A♣', '3♦', 'SJ', '10♥']).map(rankOf), ['3', '10', 'A', 'SJ']);
});
