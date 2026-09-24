import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, cardLabel, canMove, maxMovableSequence, applyMove, findHint, findAutoFoundationMove, hasAnyLegalMove, validSequence, undo } from '../app/core/freecell.js';

test('编号发牌固定且完整', () => { const a = newGame(617), b = newGame(617); assert.deepEqual(a.tableau, b.tableau); assert.deepEqual(a.tableau.map(x => x.length), [7, 7, 7, 7, 6, 6, 6, 6]); assert.equal(new Set(a.tableau.flat().map(x => x.id)).size, 52); });
test('编号 1 使用 Microsoft 抽取剩余牌的基线顺序', () => { assert.deepEqual(newGame(1).tableau[0].map(cardLabel), ['3♠', 'J♠', '8♣', 'K♣', 'Q♣', '9♦', 'J♦']); });
test('自定义规则不限制连续牌组的搬运张数', () => { const s = newGame(1); s.freecells = [{ id: 'S1', suit: 'S', rank: 1 }, { id: 'H1', suit: 'H', rank: 1 }, { id: 'D1', suit: 'D', rank: 1 }, { id: 'C1', suit: 'C', rank: 1 }]; assert.equal(maxMovableSequence(s), Infinity); });
test('连续的多张牌可作为同一组移动到目标牌列', () => {
  const s = newGame(7); const move = { from: { zone: 'tableau', index: 2 }, start: 5, to: { zone: 'tableau', index: 7 } };
  assert.equal(canMove(s, move).ok, true);
  const moved = applyMove(s, move).state;
  assert.deepEqual(moved.tableau[2].map(card => cardLabel(card)), ['3♦', '8♠', 'A♠', '4♠', '3♠']);
  assert.deepEqual(moved.tableau[7].slice(-2).map(card => cardLabel(card)), ['Q♣', 'J♦']);
  assert.equal(moved.moveCount, 1);
});
test('100 个编号牌局各有完整唯一的 Microsoft 兼容发牌', () => { for (let deal = 1; deal <= 100; deal++) { const state = newGame(deal); assert.deepEqual(state.tableau.map(column => column.length), [7, 7, 7, 7, 6, 6, 6, 6]); assert.equal(new Set(state.tableau.flat().map(card => card.id)).size, 52, `deal ${deal}`); } });
test('连续牌即使没有空自由单元或空列，也能整体移动', () => {
  const state = newGame(1); state.tableau = [[{ id: 'S8', suit: 'S', rank: 8 }, { id: 'H7', suit: 'H', rank: 7 }, { id: 'S6', suit: 'S', rank: 6 }], [{ id: 'H9', suit: 'H', rank: 9 }], [{ id: 'C2', suit: 'C', rank: 2 }], [{ id: 'D2', suit: 'D', rank: 2 }], [{ id: 'C3', suit: 'C', rank: 3 }], [{ id: 'D3', suit: 'D', rank: 3 }], [{ id: 'C4', suit: 'C', rank: 4 }], [{ id: 'D4', suit: 'D', rank: 4 }]]; state.freecells = [{ id: 'C1', suit: 'C', rank: 1 }, { id: 'D1', suit: 'D', rank: 1 }, { id: 'C5', suit: 'C', rank: 5 }, { id: 'D5', suit: 'D', rank: 5 }];
  const move = { from: { zone: 'tableau', index: 0 }, start: 0, to: { zone: 'tableau', index: 1 } }; assert.equal(validSequence(state.tableau[0]), true); assert.equal(canMove(state, move).ok, true); assert.deepEqual(applyMove(state, move).state.tableau[1].slice(-3).map(card => card.rank), [8, 7, 6]);
});
test('50 次合法移动可完整撤销回原始牌局', () => {
  let state = newGame(11); const initial = structuredClone(state.tableau);
  const legalMoves = current => { const targets = [...Array.from({ length: 8 }, (_, index) => ({ zone: 'tableau', index })), ...current.freecells.map((card, index) => !card ? ({ zone: 'freecell', index }) : null).filter(Boolean)]; const moves = []; for (let index = 0; index < 8; index++) for (let start = 0; start < current.tableau[index].length; start++) if (validSequence(current.tableau[index].slice(start))) for (const to of targets) { const move = { from: { zone: 'tableau', index }, start, to }; if (canMove(current, move).ok) moves.push(move); } return moves; };
  for (let turn = 0; turn < 50; turn++) { const moves = legalMoves(state); assert.ok(moves.length, `turn ${turn} still has a legal move`); state = applyMove(state, moves[(turn * 7 + 11) % moves.length]).state; assert.equal(new Set([...state.tableau.flat(), ...state.freecells.filter(Boolean), ...Object.values(state.foundations).flat()].map(card => card.id)).size, 52); }
  for (let turn = 0; turn < 50; turn++) state = undo(state);
  assert.deepEqual(state.tableau, initial); assert.equal(state.moveCount, 0);
});
test('回收堆只接受同花色下一个点数', () => { const s = newGame(1); s.tableau = [[{ id: 'SA', suit: 'S', rank: 1 }], [], [], [], [], [], [], []]; const move = { from: { zone: 'tableau', index: 0 }, to: { zone: 'foundation', suit: 'S' } }; assert.equal(canMove(s, move).ok, true); assert.equal(applyMove(s, move).state.foundations.S[0].rank, 1); });
test('非法移动边界不会改变牌局', () => {
  const state = newGame(1); state.tableau = [[{ id: 'H8', suit: 'H', rank: 8 }, { id: 'D7', suit: 'D', rank: 7 }], [{ id: 'H9', suit: 'H', rank: 9 }], [{ id: 'S6', suit: 'S', rank: 6 }], [], [], [], [], []]; state.freecells = [{ id: 'C5', suit: 'C', rank: 5 }, null, null, null]; state.foundations = { S: [], H: [], D: [], C: [] };
  const cases = [
    { from: { zone: 'tableau', index: 0 }, start: 0, to: { zone: 'tableau', index: 3 } },
    { from: { zone: 'tableau', index: 2 }, to: { zone: 'tableau', index: 1 } },
    { from: { zone: 'tableau', index: 2 }, to: { zone: 'freecell', index: 0 } },
    { from: { zone: 'freecell', index: 0 }, to: { zone: 'foundation', suit: 'S' } },
    { from: { zone: 'foundation', suit: 'H' }, to: { zone: 'tableau', index: 3 } },
  ];
  for (const move of cases) { const before = structuredClone(state); const result = applyMove(state, move); assert.equal(result.result.ok, false); assert.deepEqual(result.state, before); }
});
test('自由单元移出的牌不会残留或复制', () => {
  const s = newGame(1); s.tableau = [[{ id: 'H5', suit: 'H', rank: 5 }], [], [], [], [], [], [], []]; s.freecells = [{ id: 'S4', suit: 'S', rank: 4 }, null, null, null];
  const moved = applyMove(s, { from: { zone: 'freecell', index: 0 }, to: { zone: 'tableau', index: 0 } }).state;
  assert.equal(moved.freecells[0], null);
  assert.deepEqual(moved.tableau[0].map(card => card.id), ['H5', 'S4']);
  assert.equal(new Set([...moved.tableau.flat(), ...moved.freecells.filter(Boolean)].map(card => card.id)).size, 2);
});
test('自动收牌不会提前锁住高点数', () => {
  const s = newGame(1); s.tableau = [[], [], [], [], [], [], [], []]; s.freecells = [{ id: 'H3', suit: 'H', rank: 3 }, null, null, null]; s.foundations = { S: [], H: [{ id: 'H1', suit: 'H', rank: 1 }, { id: 'H2', suit: 'H', rank: 2 }], D: [], C: [] };
  assert.equal(findAutoFoundationMove(s), null);
  s.foundations.S = [{ id: 'S1', suit: 'S', rank: 1 }, { id: 'S2', suit: 'S', rank: 2 }]; s.foundations.C = [{ id: 'C1', suit: 'C', rank: 1 }, { id: 'C2', suit: 'C', rank: 2 }];
  assert.deepEqual(findAutoFoundationMove(s), { from: { zone: 'freecell', index: 0 }, to: { zone: 'foundation', suit: 'H' } });
});
test('无合法移动时会被检测为死局', () => {
  const s = newGame(1); s.tableau = [[{ id: 'H3', suit: 'H', rank: 3 }], [{ id: 'D4', suit: 'D', rank: 4 }], [{ id: 'H5', suit: 'H', rank: 5 }], [{ id: 'D6', suit: 'D', rank: 6 }], [{ id: 'H7', suit: 'H', rank: 7 }], [{ id: 'D8', suit: 'D', rank: 8 }], [{ id: 'H9', suit: 'H', rank: 9 }], [{ id: 'D10', suit: 'D', rank: 10 }]]; s.freecells = [{ id: 'S13', suit: 'S', rank: 13 }, { id: 'C13', suit: 'C', rank: 13 }, { id: 'S12', suit: 'S', rank: 12 }, { id: 'C12', suit: 'C', rank: 12 }]; s.foundations = { S: [], H: [], D: [], C: [] };
  assert.equal(hasAnyLegalMove(s), false);
});
test('四个回收堆完成后进入胜利状态', () => {
  let s = newGame(1); const suits = ['S', 'H', 'D', 'C'];
  s.tableau = Array.from({ length: 8 }, () => []);
  s.freecells = suits.map(suit => ({ id: `${suit}13`, suit, rank: 13 }));
  s.foundations = Object.fromEntries(suits.map(suit => [suit, Array.from({ length: 12 }, (_, index) => ({ id: `${suit}${index + 1}`, suit, rank: index + 1 }))]));
  for (let index = 0; index < 4; index++) s = applyMove(s, { from: { zone: 'freecell', index }, to: { zone: 'foundation', suit: suits[index] } }).state;
  assert.equal(s.status, 'won');
  assert.deepEqual(Object.values(s.foundations).map(stack => stack.length), [13, 13, 13, 13]);
});
test('提示只能返回可执行走法', () => { const s = newGame(1); const hint = findHint(s); assert.ok(hint); assert.equal(canMove(s, hint).ok, true, `${cardLabel(s.tableau[0].at(-1))} should have valid hint`); });
