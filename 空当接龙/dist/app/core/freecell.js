export const SUITS = ['S', 'H', 'D', 'C'];
export const SUIT_META = { S: { symbol: '♠', color: 'black', name: '黑桃' }, H: { symbol: '♥', color: 'red', name: '红桃' }, D: { symbol: '♦', color: 'red', name: '方块' }, C: { symbol: '♣', color: 'black', name: '梅花' } };
export const rankName = rank => ({ 1: 'A', 11: 'J', 12: 'Q', 13: 'K' }[rank] || String(rank));
export const cardLabel = card => `${rankName(card.rank)}${SUIT_META[card.suit].symbol}`;
export const isRed = card => SUIT_META[card.suit].color === 'red';

export function makeDeck() { return SUITS.flatMap(suit => Array.from({ length: 13 }, (_, i) => ({ id: `${suit}${i + 1}`, suit, rank: i + 1 }))); }
// Microsoft FreeCell starts with ranks A..K and suits C,D,H,S, then repeatedly
// selects one of the remaining cards with the documented 31-bit LCG.  This is
// deliberately not Fisher-Yates: the resulting deal number must be portable.
const MICROSOFT_SUITS = ['C', 'D', 'H', 'S'];
const dealSeed = value => Math.max(1, Math.min(1_000_000, Math.trunc(Number(value) || 1)));
function random(seed) { return (seed * 214013 + 2531011) % 0x80000000; }
export function dealCards(dealNumber = 1) {
  const deck = MICROSOFT_SUITS.flatMap(suit => Array.from({ length: 13 }, (_, i) => ({ id: `${suit}${i + 1}`, suit, rank: i + 1 })));
  const tableau = Array.from({ length: 8 }, () => []); let seed = dealSeed(dealNumber);
  for (let remaining = deck.length, position = 0; remaining > 0; remaining--, position++) {
    seed = random(seed); const choice = ((seed >>> 16) & 0x7fff) % remaining;
    const card = deck[choice]; deck[choice] = deck[remaining - 1]; deck.pop();
    tableau[position % 8].push(card);
  }
  return tableau;
}
export function newGame(dealNumber = Math.floor(Math.random() * 1_000_000) + 1) {
  return { schemaVersion: '1.0', dealNumber: Number(dealNumber), tableau: dealCards(dealNumber), freecells: [null, null, null, null], foundations: { S: [], H: [], D: [], C: [] }, moveCount: 0, elapsedMs: 0, undoStack: [], redoStack: [], status: 'playing' };
}
export const cloneState = state => structuredClone(state);
export function validSequence(cards) { return cards.length > 0 && cards.every((card, i) => i === 0 || (cards[i - 1].rank === card.rank + 1 && isRed(cards[i - 1]) !== isRed(card))); }
// This project deliberately uses an assisted FreeCell variant: any valid
// alternating descending run can move as one unit. Free cells/empty columns
// still exist as tactical storage, but they do not cap a group move.
export const maxMovableSequence = () => Infinity;
export function getStack(state, ref) {
  if (ref.zone === 'tableau') return state.tableau[ref.index];
  if (ref.zone === 'freecell') return state.freecells[ref.index] ? [state.freecells[ref.index]] : [];
  return state.foundations[ref.suit];
}
export function describeRef(ref) { return ref.zone === 'tableau' ? `牌列 ${ref.index + 1}` : ref.zone === 'freecell' ? `自由单元 ${ref.index + 1}` : `${SUIT_META[ref.suit].name}回收堆`; }
export function canMove(state, move) {
  const source = getStack(state, move.from); const target = move.to.zone === 'foundation' ? state.foundations[move.to.suit] : getStack(state, move.to);
  if (!source.length || move.from.zone === 'foundation' || move.from.zone === move.to.zone && move.from.index === move.to.index) return { ok: false, reason: '请选择不同的有效目标。' };
  const start = move.start ?? source.length - 1; const cards = source.slice(start); const card = cards[0];
  if (!validSequence(cards)) return { ok: false, reason: '只能移动红黑交替、点数递减的连续牌组。' };
  if (move.to.zone === 'freecell') return !target.length && cards.length === 1 ? { ok: true } : { ok: false, reason: '自由单元只能放一张牌。' };
  if (move.to.zone === 'foundation') return cards.length === 1 && card.suit === move.to.suit && card.rank === target.length + 1 ? { ok: true } : { ok: false, reason: '回收堆必须按同花色 A 到 K 递增。' };
  if (!target.length || (target.at(-1).rank === card.rank + 1 && isRed(target.at(-1)) !== isRed(card))) return { ok: true };
  return { ok: false, reason: '牌列只能叠放到异色且大一号的牌上。' };
}
export function applyMove(state, move) {
  const result = canMove(state, move); if (!result.ok) return { state, result };
  const next = cloneState(state); const source = getStack(next, move.from); const start = move.start ?? source.length - 1; const cards = source.splice(start);
  // getStack returns a one-card view for freecells, so the backing slot must be
  // cleared explicitly before placing that card at its destination.
  if (move.from.zone === 'freecell') next.freecells[move.from.index] = null;
  if (move.to.zone === 'tableau') next.tableau[move.to.index].push(...cards);
  else if (move.to.zone === 'freecell') next.freecells[move.to.index] = cards[0];
  else next.foundations[move.to.suit].push(cards[0]);
  next.moveCount++; next.undoStack.push({ from: move.to, to: move.from, start: move.to.zone === 'tableau' ? next.tableau[move.to.index].length - cards.length : 0, cards }); next.redoStack = [];
  if (SUITS.every(suit => next.foundations[suit].length === 13)) next.status = 'won';
  else if (!hasAnyLegalMove(next)) next.status = 'stuck';
  return { state: next, result: { ok: true, cards } };
}
export function undo(state) {
  const move = state.undoStack.at(-1); if (!move) return state;
  const next = cloneState(state); next.undoStack.pop(); const source = getStack(next, move.from); const cards = source.splice(move.start); if (move.from.zone === 'freecell') next.freecells[move.from.index] = null;
  if (move.to.zone === 'tableau') next.tableau[move.to.index].push(...cards); else if (move.to.zone === 'freecell') next.freecells[move.to.index] = cards[0]; else next.foundations[move.to.suit].push(cards[0]);
  next.moveCount--; next.redoStack.push({ from: move.to, to: move.from, start: move.to.zone === 'tableau' ? next.tableau[move.to.index].length - cards.length : 0, cards }); return next;
}
export function isSafeAutoFoundationCard(state, card) {
  if (card.rank <= 2) return true;
  return SUITS.filter(suit => SUIT_META[suit].color !== SUIT_META[card.suit].color).every(suit => state.foundations[suit].length >= card.rank - 1);
}
export function findAutoFoundationMove(state) {
  for (let column = 0; column < 8; column++) { const card = state.tableau[column].at(-1); if (card && card.rank === state.foundations[card.suit].length + 1 && isSafeAutoFoundationCard(state, card)) return { from: { zone: 'tableau', index: column }, to: { zone: 'foundation', suit: card.suit } }; }
  for (let index = 0; index < 4; index++) { const card = state.freecells[index]; if (card && card.rank === state.foundations[card.suit].length + 1 && isSafeAutoFoundationCard(state, card)) return { from: { zone: 'freecell', index }, to: { zone: 'foundation', suit: card.suit } }; }
  return null;
}
export function hasAnyLegalMove(state) {
  const destinations = [
    ...Array.from({ length: 8 }, (_, index) => ({ zone: 'tableau', index })),
    ...state.freecells.map((card, index) => !card ? ({ zone: 'freecell', index }) : null).filter(Boolean),
  ];
  for (let index = 0; index < 8; index++) {
    const column = state.tableau[index];
    for (let start = 0; start < column.length; start++) {
      if (!validSequence(column.slice(start))) continue;
      const from = { zone: 'tableau', index };
      if (destinations.some(to => canMove(state, { from, start, to }).ok)) return true;
      const card = column[start];
      if (canMove(state, { from, start, to: { zone: 'foundation', suit: card.suit } }).ok) return true;
    }
  }
  for (let index = 0; index < 4; index++) {
    const card = state.freecells[index]; if (!card) continue;
    const from = { zone: 'freecell', index };
    if (destinations.some(to => canMove(state, { from, to }).ok)) return true;
    if (canMove(state, { from, to: { zone: 'foundation', suit: card.suit } }).ok) return true;
  }
  return false;
}
export function findHint(state) {
  const auto = findAutoFoundationMove(state); if (auto) return auto;
  for (let from = 0; from < 8; from++) { if (!state.tableau[from].length) continue; for (let to = 0; to < 8; to++) { const move = { from: { zone: 'tableau', index: from }, to: { zone: 'tableau', index: to } }; if (canMove(state, move).ok) return move; } }
  const cardColumn = state.tableau.findIndex(x => x.length); const cell = state.freecells.findIndex(x => !x); return cardColumn >= 0 && cell >= 0 ? { from: { zone: 'tableau', index: cardColumn }, to: { zone: 'freecell', index: cell } } : null;
}
