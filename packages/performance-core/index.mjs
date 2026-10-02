import { SETTLEMENT_STAGES, MAX_UPGRADE_LEVEL, MULTIPLIER_CAP, validatePhotoCard } from '../contracts/index.mjs';

export const PERFORMANCE_CONTRACT_VERSION = '1.2.0';

const DETERMINISTIC_TIME = '1970-01-01T00:00:00.000Z';

const defaultOutfit = (palId) => ({
  outfitId: 'default-stage',
  name: palId === 'pal-linxing' ? '星夜礼服' : '薄荷舞台装',
  dance: palId === 'pal-linxing' ? '月光步' : '彩带律动',
  layerSnapshot: { base: `preset://${palId}/portrait-v1`, outfit: `preset://${palId}/portrait-v1` }
});

// 同一卡的历史记录以最后一次为准，与存档按 cardId 更新的行为一致。
const normalizeRecords = (alreadyUnlocked) => [...new Map((alreadyUnlocked || []).map((entry) => {
  const record = typeof entry === 'string' ? { cardId: entry } : entry;
  return [record.cardId, record];
})).values()];

/* 败方可能同时有两位牌友（地主赢时两个农民都败）。挑收藏数最少的那位，
   让两条收藏线保持均衡；收藏数相同则按传入顺序取第一位，保证可复现。 */
function pickLosingPal(loserPalIds, records) {
  const owned = (palId) => records.filter((record) => record.palId === palId).length;
  return [...loserPalIds].sort((a, b) => owned(a) - owned(b))[0] || null;
}

/* 倍数明细：结算面板要能说清「这个数字是怎么来的」，而不是只丢一个结果。
   底分来自叫分（抢地主再翻倍），炸弹每次翻倍，春天/反春天再翻一倍，最后封顶。 */
export function buildMultiplier({ base = 1, bombs = 0, rocket = false, spring = false, landlordStake = 1 }) {
  const bombFactor = 2 ** (bombs + (rocket ? 1 : 0));
  const raw = base * bombFactor * (spring ? 2 : 1) * landlordStake;
  const capped = Math.min(Math.round(raw), MULTIPLIER_CAP);
  return {
    base, bombs, rocket, spring, landlordStake,
    bombFactor,
    total: capped,
    raw: Math.round(raw),
    capped: capped !== Math.round(raw),
    factors: [
      { label: '叫分底分', value: `×${base}` },
      ...(bombs + (rocket ? 1 : 0) ? [{ label: `炸弹 ×${bombs + (rocket ? 1 : 0)}`, value: `×${bombFactor}` }] : []),
      ...(spring ? [{ label: '春天', value: '×2' }] : []),
      ...(landlordStake !== 1 ? [{ label: '地主双家结算', value: `×${landlordStake}` }] : [])
    ]
  };
}

export function planSettlement({ gameId, winnerId, loserPalIds = [], multiplier = 1, breakdown = null, playerIsLandlord = false, alreadyUnlocked = [], outfitLibrary = {}, gameStats = {}, unlockedAt = DETERMINISTIC_TIME }) {
  const records = normalizeRecords(alreadyUnlocked);
  /* 演出是玩家胜利奖励，不是输局惩罚：只有玩家赢时才从败方 AI 中选择一名牌友登台，
     并为这名牌友选择/升级一张与演出视频绑定的写真卡。玩家输局不生成演出卡，也不播放舞蹈。 */
  const losingPal = winnerId === 'player' ? pickLosingPal(loserPalIds, records) : null;
  /* Token 双向记账：赢要真的加、输要真的减，否则玩家的余额只会单向归零。
     地主同时对两家结算，所以地主方的输赢是农民方的两倍。 */
  const stake = Math.max(1, multiplier) * (playerIsLandlord ? 2 : 1);
  const tokenDelta = winnerId === 'player' ? stake : -stake;
  let card = null;
  let cardId = null;
  let isFirstUnlock = false;
  let upgradeLevel = 0;
  let outfitName = null;
  let danceName = null;

  if (losingPal) {
    const outfits = (outfitLibrary[losingPal]?.length ? outfitLibrary[losingPal] : [defaultOutfit(losingPal)]);
    const palRecords = records.filter((record) => record.palId === losingPal);
    const unlockedOutfitIds = new Set(palRecords.map((record) => record.outfitId));
    const fresh = outfits.find((entry) => !unlockedOutfitIds.has(entry.outfitId));
    // 集齐后优先升级等级最低的服装；同级按目录顺序，避免卡册长度固定后永远升级第一张。
    const level = (outfit) => palRecords.find((record) => record.outfitId === outfit.outfitId)?.upgradeLevel || 1;
    const chosen = fresh || outfits.reduce((lowest, outfit) => level(outfit) < level(lowest) ? outfit : lowest);
    isFirstUnlock = Boolean(fresh);
    cardId = `${losingPal}:${chosen.outfitId}`;
    const existing = records.find((record) => record.cardId === cardId);
    upgradeLevel = isFirstUnlock ? 1 : Math.min((existing?.upgradeLevel || 1) + 1, MAX_UPGRADE_LEVEL);
    outfitName = chosen.name;
    danceName = chosen.dance;
    card = validatePhotoCard({
      cardId,
      palId: losingPal,
      outfitId: chosen.outfitId,
      outfitName: chosen.name,
      dance: chosen.dance,
      layerSnapshot: chosen.layerSnapshot,
      serialNo: existing?.serialNo || records.length + 1,
      rarity: isFirstUnlock ? 'first' : 'normal',
      upgradeLevel,
      seen: false,
      unlockedAt,
      auditRecordId: chosen.auditRecordId || `audit-official-${losingPal}-v1`,
      gameStats: {
        multiplier,
        rounds: gameStats.rounds ?? null,
        lastCombo: gameStats.lastCombo ?? null
      }
    });
  }

  return {
    contractVersion: PERFORMANCE_CONTRACT_VERSION,
    traceId: `perf-${gameId}`,
    idempotencyKey: `settle-${gameId}`,
    winnerId,
    outcome: {
      playerSide: playerIsLandlord ? 'landlord' : 'farmers',
      winnerSide: winnerId === 'player' ? (playerIsLandlord ? 'landlord' : 'farmers') : (playerIsLandlord ? 'farmers' : 'landlord'),
      playerWon: winnerId === 'player',
      danceEligible: winnerId === 'player' && Boolean(losingPal),
      dancePalId: losingPal
    },
    multiplier,
    breakdown,
    playerIsLandlord,
    tokenDelta,
    loserPalId: losingPal,
    loserPalIds,
    outfit: outfitName,
    dance: danceName,
    cardId,
    isFirstUnlock,
    upgradeLevel,
    card,
    performanceRef: losingPal ? `preset://${losingPal}/dance-skeletal-v1` : null,
    stages: SETTLEMENT_STAGES
  };
}

export function nextSettlementStage(stage) {
  const index = SETTLEMENT_STAGES.indexOf(stage);
  return SETTLEMENT_STAGES[Math.min(index + 1, SETTLEMENT_STAGES.length - 1)];
}

/* ===== L3 回合特写 =====
   特写是「镜头」而不是「提示条」，所以它只在真正值得切镜的瞬间出现：
   叫满 3 分、抢地主、打出炸弹/王炸、打出 5 张以上的长牌型、以及走完最后一手。
   每一次普通出牌都切镜会把牌局切碎，也会让特写本身失去意义——这是取舍，不是遗漏。
   玩家自己不进特写：镜头是给对手的。
   纯函数、零状态，因此可以单测；前端只负责把它渲染出来。 */
const BOMB_TYPES = new Set(['BOMB', 'ROCKET']);
/* 三带/飞机/四带：手牌结构被主动拆开换牌权，是值得看一眼的决策。 */
const POWER_TYPES = new Set(['TRIPLE_ONE', 'TRIPLE_PAIR', 'TRIPLE_STRAIGHT', 'AIRPLANE_ONE', 'AIRPLANE_PAIR', 'FOUR_TWO', 'FOUR_TWO_PAIR']);
const TONE_DURATION = { call: 1800, grab: 1800, combo: 1800, power: 2000, bomb: 2400, alarm: 2000, finish: 2600 };

export function planCloseup({ event = null, comboType = '', comboLabel = '', remaining = null } = {}) {
  if (!event || !event.playerId || event.playerId === 'player') return null;
  const cards = Array.isArray(event.cards) ? event.cards : [];
  const base = { palId: event.playerId, action: event.action || 'A02', dialogue: event.dialogue || '', tone: null, label: '' };
  let moment = null;
  if (event.type === 'BID_CALL' && event.score >= 2) moment = { tone: 'call', label: `叫 ${event.score} 分` };
  else if (event.type === 'BID_GRAB' && event.accepted) moment = { tone: 'grab', label: '抢地主' };
  else if (event.type === 'PAL_ACTION' && event.decision === 'PLAY') {
    if (remaining === 0) moment = { tone: 'finish', label: comboLabel ? `${comboLabel} · 收官` : '收官' };
    else if (BOMB_TYPES.has(comboType)) moment = { tone: 'bomb', label: comboLabel || '炸弹' };
    else if (remaining === 1) moment = { tone: 'alarm', label: comboLabel ? `${comboLabel} · 只剩 1 张` : '只剩 1 张' };
    else if (POWER_TYPES.has(comboType)) moment = { tone: 'power', label: comboLabel || '结构牌' };
    else if (cards.length >= 5) moment = { tone: 'combo', label: comboLabel || `${cards.length} 张连招` };
  }
  if (!moment) return null;
  return { ...base, ...moment, durationMs: TONE_DURATION[moment.tone] || 1800 };
}
