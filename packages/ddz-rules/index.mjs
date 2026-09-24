/* 斗地主规则唯一真源：纯函数、零状态。
   game-engine 只负责状态机与流程；NPC 决策、玩家提示、服务端校验都复用本包，
   避免出现「提示说能出、提交却被拒」的不一致。 */
import { randomBytes } from 'node:crypto';

export const RANKS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2', 'SJ', 'BJ'];
export const VALUE = Object.fromEntries(RANKS.map((rank, index) => [rank, index + 3]));
export const SUITS = ['♣', '♦', '♥', '♠'];
/* 顺子 / 连对 / 飞机主体最高到 A：2 与双王不参与连续牌型。 */
const CHAIN_BLOCKED = new Set(['2', 'SJ', 'BJ']);

export function rankOf(card) { return card.replace(/[♣♦♥♠]/g, ''); }
export function cardValue(card) { return VALUE[rankOf(card)]; }
export function sortCards(cards) { return [...cards].sort((a, b) => cardValue(a) - cardValue(b)); }

function combo(type, value, length, label) { return { type, value, length, label }; }
function isChain(ranks) {
  if (ranks.some((rank) => CHAIN_BLOCKED.has(rank))) return false;
  return ranks.every((rank, index) => index === 0 || VALUE[rank] === VALUE[ranks[index - 1]] + 1);
}
function countByRank(cards) {
  const counts = new Map();
  for (const card of cards) counts.set(rankOf(card), (counts.get(rankOf(card)) || 0) + 1);
  return counts;
}

/* 从手牌中取走指定 rank 各 3 张后剩下的牌（用作飞机翅膀的判定输入）。 */
function withoutTriples(cards, chainRanks) {
  const need = new Set(chainRanks);
  const used = new Map();
  const rest = [];
  for (const card of sortCards(cards)) {
    const rank = rankOf(card);
    if (need.has(rank) && (used.get(rank) || 0) < 3) { used.set(rank, (used.get(rank) || 0) + 1); continue; }
    rest.push(card);
  }
  return rest;
}
function isAllPairs(cards, pairs) {
  if (cards.length !== pairs * 2) return false;
  const counts = countByRank(cards);
  return counts.size === pairs && [...counts.values()].every((count) => count === 2);
}

function classifyAirplane(cards, byCount, total) {
  /* 4 张相同既可作三张主体，也可让第 4 张充当翅膀，因此都进候选池。 */
  const pool = [...byCount[3], ...byCount[4]].sort((a, b) => VALUE[a] - VALUE[b]);
  const chainRanks = pool.filter((rank) => !CHAIN_BLOCKED.has(rank));
  for (let size = chainRanks.length; size >= 2; size -= 1) {
    for (let start = 0; start + size <= chainRanks.length; start += 1) {
      const window = chainRanks.slice(start, start + size);
      if (!isChain(window)) continue;
      const wings = total - size * 3;
      const rest = withoutTriples(cards, window);
      const top = VALUE[window[window.length - 1]];
      if (wings === 0 && rest.length === 0) return combo('TRIPLE_STRAIGHT', top, total, `${size}连飞机`);
      if (wings === size && rest.length === size && new Set(rest.map(rankOf)).size === size) return combo('AIRPLANE_ONE', top, total, `${size}连飞机带单`);
      if (wings === size * 2 && isAllPairs(rest, size)) return combo('AIRPLANE_PAIR', top, total, `${size}连飞机带对`);
    }
  }
  return null;
}

/* 重复同一张牌（如 [3♣, 3♣]）直接判非法——这是防作弊的第一道闸。 */
export function classify(cards) {
  if (!Array.isArray(cards) || !cards.length) return null;
  if (cards.some((card) => typeof card !== 'string')) return null;
  if (new Set(cards).size !== cards.length) return null;
  const total = cards.length;
  const counts = countByRank(cards);
  const byCount = { 1: [], 2: [], 3: [], 4: [] };
  for (const [rank, count] of counts) {
    if (!VALUE[rank] || !byCount[count]) return null;
    byCount[count].push(rank);
  }
  for (const bucket of Object.values(byCount)) bucket.sort((a, b) => VALUE[a] - VALUE[b]);
  const top = (list) => VALUE[list[list.length - 1]];

  if (total === 2 && counts.has('SJ') && counts.has('BJ')) return combo('ROCKET', 99, 2, '王炸');
  if (total === 4 && byCount[4].length === 1) return combo('BOMB', VALUE[byCount[4][0]], 4, '炸弹');
  if (total === 1) return combo('SINGLE', VALUE[byCount[1][0]], 1, '单张');
  if (total === 2 && byCount[2].length === 1) return combo('PAIR', VALUE[byCount[2][0]], 2, '对子');
  if (total === 3 && byCount[3].length === 1) return combo('TRIPLE', VALUE[byCount[3][0]], 3, '三张');
  if (total === 4 && byCount[3].length === 1 && byCount[1].length === 1) return combo('TRIPLE_ONE', VALUE[byCount[3][0]], 4, '三带一');
  if (total === 5 && byCount[3].length === 1 && byCount[2].length === 1) return combo('TRIPLE_PAIR', VALUE[byCount[3][0]], 5, '三带二');
  if (total >= 5 && byCount[1].length === total && isChain(byCount[1])) return combo('STRAIGHT', top(byCount[1]), total, `${total}张顺子`);
  const pairs = total / 2;
  if (total >= 6 && total % 2 === 0 && byCount[2].length === pairs && pairs >= 3 && isChain(byCount[2])) return combo('DOUBLE_STRAIGHT', top(byCount[2]), total, `${pairs}连对`);
  if (total === 6 && byCount[4].length === 1 && byCount[1].length === 2) return combo('FOUR_TWO', VALUE[byCount[4][0]], 6, '四带二');
  if (total === 8 && byCount[4].length === 1 && byCount[2].length === 2) return combo('FOUR_TWO_PAIR', VALUE[byCount[4][0]], 8, '四带两对');
  return classifyAirplane(cards, byCount, total);
}

export function canBeat(candidate, current) {
  if (!candidate) return false;
  if (!current) return true;
  if (candidate.type === 'ROCKET') return true;
  if (current.type === 'ROCKET') return false;
  /* 四带二不是炸弹：只能被更大的四带二、炸弹或王炸压。 */
  if (candidate.type === 'BOMB' && current.type !== 'BOMB') return true;
  if (current.type === 'BOMB' && candidate.type !== 'BOMB') return false;
  return candidate.type === current.type && candidate.length === current.length && candidate.value > current.value;
}

/* 多重集校验：手牌必须逐张包含要出的牌，重复提交同一张牌会被拒绝。
   过去的 every(includes) 校验允许 [3♣, 3♣] 冒充对子。 */
export function hasAllCards(hand, cards) {
  const pool = new Map();
  for (const card of hand) pool.set(card, (pool.get(card) || 0) + 1);
  for (const card of cards) {
    const left = pool.get(card) || 0;
    if (left === 0) return false;
    pool.set(card, left - 1);
  }
  return true;
}
export function removeCards(hand, cards) {
  if (!hasAllCards(hand, cards)) throw new Error('手牌不包含要移除的牌。');
  const pool = new Map();
  for (const card of hand) pool.set(card, (pool.get(card) || 0) + 1);
  for (const card of cards) pool.set(card, pool.get(card) - 1);
  const rest = [];
  for (const card of hand) {
    if ((pool.get(card) || 0) > 0) { rest.push(card); pool.set(card, pool.get(card) - 1); }
  }
  return rest;
}

function groupByRank(hand) {
  const byRank = new Map();
  for (const card of sortCards(hand)) {
    const rank = rankOf(card);
    if (!byRank.has(rank)) byRank.set(rank, []);
    byRank.get(rank).push(card);
  }
  return byRank;
}
/* 挑最小的翅膀：优先不拆牌（单牌 → 对子 → 三张 → 炸弹），避免为了带牌拆掉炸弹。 */
function pickWings(byRank, exclude, groups, size) {
  const tiers = size === 1 ? [1, 2, 3, 4] : [2, 3, 4];
  const picked = [];
  for (const tier of tiers) {
    const candidates = [...byRank.entries()]
      .filter(([rank, cards]) => cards.length === tier && !exclude.has(rank) && !picked.some((entry) => entry[0] === rank))
      .sort((a, b) => VALUE[a[0]] - VALUE[b[0]]);
    for (const entry of candidates) {
      if (picked.length >= groups) break;
      picked.push(entry);
    }
    if (picked.length >= groups) break;
  }
  if (picked.length < groups) return null;
  return picked.flatMap(([rank]) => byRank.get(rank).slice(0, size));
}

/* 实用枚举而非穷举：带牌类只配最小的一组翅膀，兼顾决策质量与性能。 */
export function enumerateMoves(hand) {
  const byRank = groupByRank(hand);
  const ranks = [...byRank.keys()].sort((a, b) => VALUE[a] - VALUE[b]);
  const at = (rank, count) => byRank.get(rank).slice(0, count);
  const moves = [];
  const push = (cards) => { const combo = classify(cards); if (combo) moves.push({ cards, combo }); };

  for (const rank of ranks) {
    push(at(rank, 1));
    if (byRank.get(rank).length >= 2) push(at(rank, 2));
    if (byRank.get(rank).length >= 3) push(at(rank, 3));
    if (byRank.get(rank).length >= 4) push(at(rank, 4));
  }
  if (byRank.has('SJ') && byRank.has('BJ')) push([...at('SJ', 1), ...at('BJ', 1)]);

  for (const rank of ranks) {
    if (byRank.get(rank).length < 3) continue;
    const exclude = new Set([rank]);
    const single = pickWings(byRank, exclude, 1, 1);
    if (single) push([...at(rank, 3), ...single]);
    const pair = pickWings(byRank, exclude, 1, 2);
    if (pair) push([...at(rank, 3), ...pair]);
  }
  for (const rank of ranks) {
    if (byRank.get(rank).length < 4) continue;
    const two = pickWings(byRank, new Set([rank]), 2, 1);
    if (two && new Set(two.map(rankOf)).size === 2) push([...at(rank, 4), ...two]);
    const twoPairs = pickWings(byRank, new Set([rank]), 2, 2);
    if (twoPairs) push([...at(rank, 4), ...twoPairs]);
  }

  const chainOf = (minCount, minLength) => {
    const usable = ranks.filter((rank) => !CHAIN_BLOCKED.has(rank) && byRank.get(rank).length >= minCount);
    for (let start = 0; start < usable.length; start += 1) {
      for (let end = start + minLength; end <= usable.length; end += 1) {
        const window = usable.slice(start, end);
        if (!isChain(window)) break;
        push(window.flatMap((rank) => at(rank, minCount)));
      }
    }
  };
  chainOf(1, 5);
  chainOf(2, 3);

  const tripleRanks = ranks.filter((rank) => !CHAIN_BLOCKED.has(rank) && byRank.get(rank).length >= 3);
  for (let start = 0; start < tripleRanks.length; start += 1) {
    for (let end = start + 2; end <= tripleRanks.length; end += 1) {
      const window = tripleRanks.slice(start, end);
      if (!isChain(window)) break;
      const body = window.flatMap((rank) => at(rank, 3));
      push(body);
      const singles = pickWings(byRank, new Set(window), window.length, 1);
      if (singles) push([...body, ...singles]);
      const pairs = pickWings(byRank, new Set(window), window.length, 2);
      if (pairs) push([...body, ...pairs]);
    }
  }
  return moves;
}

export function fullDeck() {
  return RANKS.flatMap((rank) => (rank === 'SJ' || rank === 'BJ' ? [rank] : SUITS.map((suit) => `${rank}${suit}`)));
}
function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}
export function shuffledDeck(seed = randomBytes(4).readUInt32BE(0)) {
  const deck = fullDeck();
  const next = seededRandom(seed);
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const swapAt = Math.floor(next() * (index + 1));
    [deck[index], deck[swapAt]] = [deck[swapAt], deck[index]];
  }
  return deck;
}
