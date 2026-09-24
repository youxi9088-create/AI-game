/* NPC 决策与玩家提示的唯一真源：纯函数、零状态、完全确定性。
   牌型合法性只由 packages/ddz-rules 决定；本包只回答「在合法走法里选哪一个、为什么」。
   服务端裁决、NPC 回合、玩家提示三处共用同一套评分，避免「提示说能出、AI 却不出」的割裂。 */
import { canBeat, enumerateMoves, rankOf, cardValue } from '../ddz-rules/index.mjs';

export const AI_CONTRACT_VERSION = '1.0.0';

/* 性格不是随机扰动，而是四个可解释的权重：
   aggression 压制欲（越高越愿意用大牌抢回牌权）
   control    控牌欲（越高越把炸弹/王炸留到关键时刻）
   structure  结构感（越高越不愿拆顺子、对子、三张）
   tempo      残局果断度（越高越在对手逼近时冒险）
   林星是夜色牌手：算得清、忍得住。米娅是薄荷主场：抢节奏、敢出手。 */
export const PERSONALITIES = {
  'pal-linxing': { palId: 'pal-linxing', label: '控制型', aggression: 0.42, control: 0.74, structure: 0.82, tempo: 0.5, bidBias: -0.6 },
  'pal-mia': { palId: 'pal-mia', label: '节奏型', aggression: 0.78, control: 0.4, structure: 0.58, tempo: 0.8, bidBias: 0.6 },
  player: { palId: 'player', label: '玩家', aggression: 0.5, control: 0.6, structure: 0.7, tempo: 0.6, bidBias: 0 }
};
export const DEFAULT_PERSONALITY = PERSONALITIES.player;
export function personalityOf(palId) { return PERSONALITIES[palId] || DEFAULT_PERSONALITY; }

/* 自定义牌友没有手写的性格表。这里按 palId 做确定性派生：同一个牌友每次上桌都是同一个
   性格（不能每局随机，否则玩家无法建立预期），但不同牌友之间确实有差异（不能全用默认值，
   否则所有自定义牌友打起来一模一样）。偏移量限制在 ±0.10，保证她仍是一个「合理的斗地主
   玩家」，而不是被随机噪声推成另一个人。 */
const CUSTOM_BASE = { label: '自定义', aggression: 0.5, control: 0.55, structure: 0.65, tempo: 0.55, bidBias: 0 };
export function derivePersonality(palId) {
  let seed = 7;
  for (const char of String(palId)) seed = (seed * 31 + char.charCodeAt(0)) >>> 0;
  const jitter = (index) => (((seed >>> (index * 5)) % 21) - 10) / 100;
  const round = (value) => Math.min(1, Math.max(0, Number(value.toFixed(3))));
  return {
    palId,
    label: CUSTOM_BASE.label,
    aggression: round(CUSTOM_BASE.aggression + jitter(0)),
    control: round(CUSTOM_BASE.control + jitter(1)),
    structure: round(CUSTOM_BASE.structure + jitter(2)),
    tempo: round(CUSTOM_BASE.tempo + jitter(3)),
    bidBias: Number(((((seed >>> 20) % 9) - 4) / 10).toFixed(3))
  };
}
/* 上桌统一入口：官方牌友命中预设表，自定义牌友走确定性派生。 */
export function personalityFor(palId) {
  if (PERSONALITIES[palId]) return PERSONALITIES[palId];
  return derivePersonality(palId);
}

function countByRank(hand) {
  const counts = new Map();
  for (const card of hand) counts.set(rankOf(card), (counts.get(rankOf(card)) || 0) + 1);
  return counts;
}

/* 手牌强度：只数「能叫分的硬通货」，用于叫分与抢地主。 */
export function handStrength(hand) {
  const counts = countByRank(hand);
  let score = 0;
  if (counts.has('BJ')) score += 4;
  if (counts.has('SJ')) score += 3;
  for (const [rank, count] of counts) {
    if (rank === '2') score += 2 * count;
    if (count === 4) score += 6;
    else if (count === 3) score += 1.5;
  }
  return Math.round(score * 100) / 100;
}

/* 叫 0/1/2/3 分。阈值随性格偏移：米娅更敢叫，林星更保守。 */
export function bidScore(hand, palId = 'player', { minimum = 0 } = {}) {
  const strength = handStrength(hand) + personalityOf(palId).bidBias;
  let score = strength >= 11 ? 3 : strength >= 7.5 ? 2 : strength >= 4.5 ? 1 : 0;
  if (score <= minimum) score = 0;
  return score;
}

/* 抢地主：只有在手牌强度明显撑得住翻倍的风险时才抢。 */
export function shouldGrab(hand, palId, highScore) {
  const strength = handStrength(hand) + personalityOf(palId).bidBias;
  return highScore === 1 ? strength >= 8 : strength >= 11;
}

/* 拆牌代价：把「这手牌会破坏多少既定结构」量化。
   4 张里抽 1 张是最贵的（拆炸弹），3 张里抽 1 张次之，顺子里的单张最便宜。 */
function breakage(hand, cards) {
  const counts = countByRank(hand);
  const used = new Map();
  for (const card of cards) used.set(rankOf(card), (used.get(rankOf(card)) || 0) + 1);
  let cost = 0;
  for (const [rank, taken] of used) {
    const total = counts.get(rank) || 0;
    if (total === 4 && taken < 4) cost += 3 * taken;
    else if (total === 3 && taken < 3) cost += 1.6 * taken;
    else if (total === 2 && taken < 2) cost += 0.9 * taken;
    else if (total === 1) cost += 0.5 * straightDepth(hand, rank);
  }
  return cost;
}
/* 该 rank 是否处在一串长度 ≥5 的连续单牌里（顺子成型度）。 */
function straightDepth(hand, rank) {
  const singles = new Set([...countByRank(hand)].filter(([, count]) => count === 1).map(([r]) => r));
  if (!singles.has(rank)) return 0;
  const value = cardValue(`${rank}♣`);
  let depth = 1;
  for (let step = 1; step < 12; step += 1) {
    const next = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'][value - 3 + step];
    if (!next || !singles.has(next)) break;
    depth += 1;
  }
  return depth >= 5 ? 1 : 0.35;
}

const isBombLike = (combo) => combo.type === 'BOMB' || combo.type === 'ROCKET';

/* 对手（与我不同阵营的家）离胜利有多近。 */
function threatLevel(ctx) {
  const counts = ctx.opponentCounts || {};
  const values = Object.values(counts).filter((count) => typeof count === 'number');
  if (!values.length) return 0;
  const nearest = Math.min(...values);
  if (nearest <= 1) return 1;
  if (nearest <= 3) return 0.7;
  if (nearest <= 6) return 0.3;
  return 0;
}

/* 给一个候选走法打分。分越高越想出。 */
function scoreMove({ hand, move, current, personality, ctx }) {
  const { combo } = move;
  const finishes = move.cards.length === hand.length;
  if (finishes) return { score: 1000 - cardValue(move.cards[0]) * 0.01, reason: '这一手直接走完，立刻打出。' };

  const cost = breakage(hand, move.cards) * personality.structure;
  const base = current ? 0 : 4;
  const valuePenalty = combo.value * (current ? 0.6 : 0.8) * (1.4 - personality.aggression);
  const lengthBonus = current ? 0 : combo.length * 0.35;
  let score = base - valuePenalty - cost * 1.4 + lengthBonus;

  const threat = threatLevel(ctx);
  let reason = current ? '用最小的代价压过桌面。' : '领出一手低消耗的结构。';

  if (isBombLike(combo)) {
    /* 炸弹与王炸：控牌欲高的人只在对手逼近或能一击定局时才动。 */
    const willing = personality.control <= 0.5 ? 0.9 : threat >= 0.7 ? 1 : threat >= 0.3 ? 0.45 : 0.05;
    if (ctx.isLandlord && threat < 0.3) score -= 60;
    score -= (1 - willing) * 80;
    if (willing < 0.4) reason = '还不到动用炸弹的时候，先留着。';
    else reason = threat >= 0.7 ? '对手就要走完了，必须拦。' : '这一手能直接夺回牌权。';
  } else if (threat >= 0.7 && !current) {
    score += personality.tempo * 6;
    reason = '对手残局，抢先出牌压缩他的空间。';
  }

  /* 队友只剩一两张时，领出要出他能接上的形状。 */
  if (!current && ctx.teammateCount === 1 && combo.type === 'SINGLE') { score += 6; reason = '队友只差一张，递一个单张。'; }
  if (!current && ctx.teammateCount === 2 && combo.type === 'PAIR') { score += 6; reason = '队友只差一对，递一个对子。'; }

  return { score, reason };
}

/* 选一手牌。返回 null 表示选择「不出」，并给出理由。 */
export function chooseMove({ hand, currentCombo = null, lastPlayerId = null, personality = DEFAULT_PERSONALITY, ctx = {} }) {
  const candidates = enumerateMoves(hand).filter((move) => canBeat(move.combo, currentCombo));
  if (!candidates.length) return { move: null, reason: '没有能压过这一手的牌。' };

  const teammateId = ctx.teammateId || null;
  /* 新生成的牌友没有官方性格预设。她们的第一责任是让玩家看见「会打牌」：
     只要不是队友控场、手里又有合法压制牌，就不能因为结构代价高而默认放弃。
     官方牌友继续使用原有的控牌门槛，保证林星/米娅的差异不回退。 */
  const isCustomPal = String(personality?.palId || '').startsWith('pal-user-') || personality?.label === '自定义';
  const scored = candidates.map((move) => ({ move, ...scoreMove({ hand, move, current: currentCombo, personality, ctx }) }));
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];

  /* 阵营协作：上一手是队友出的，就不要压自己人——除非这一手能直接走完。 */
  if (currentCombo && lastPlayerId && teammateId && lastPlayerId === teammateId) {
    const finisher = scored.find((entry) => entry.move.cards.length === hand.length && entry.score > 900);
    if (finisher) return { move: finisher.move, reason: '队友在控场，我这一手可以直接收官。' };
    return { move: null, reason: '这一手是队友的，不能压自己人。', holdingBack: true };
  }

  /* 压牌要有理由：如果代价超过了收益，宁可不出。 */
  if (currentCombo && best.score < -30 && !isCustomPal) return { move: null, reason: '压这一手代价太高，先让出去。', holdingBack: true };
  return best;
}

/* 玩家提示：与 NPC 同一套评分，但永远给出「最省的一手」，并说明为什么。 */
export function suggestMove({ hand, currentCombo = null, lastPlayerId = null, ctx = {} }) {
  const decision = chooseMove({ hand, currentCombo, lastPlayerId, personality: DEFAULT_PERSONALITY, ctx });
  /* 无推荐时统一以「建议不出」开头：前端与 E2E 都靠这个前缀判断有没有牌可出。 */
  if (!decision.move) return { cards: [], combo: null, message: `建议不出：${decision.reason}` };
  return { cards: decision.move.cards, combo: decision.move.combo, message: `已标出可出的${decision.move.combo.label}。${decision.reason}` };
}
