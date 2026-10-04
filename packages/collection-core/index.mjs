// Shared content progression. No token, random draw or client supplied win count.
export const BOND_STEPS = [
  { points: 0, name: '初见', story: '今晚的牌桌，为你留了一个位置。' },
  { points: 30, name: '熟悉', story: '又见面了。上次的那手好牌，我还记得。' },
  { points: 60, name: '默契', story: '比起输赢，我开始期待和你一起定格的瞬间。' },
  { points: 100, name: '知音', story: '我们的写真册，已经写下了许多个夜晚。' }
];
export const PHOTO_OPTIONS = {
  background: ['midnight', 'plum'], filter: ['natural', 'warm', 'mono'], framing: ['full', 'close']
};
export function emptyCollection() { return { wins: 0, bonds: {}, rewards: {}, creations: [] }; }
export function bondLevel(points = 0) { return [...BOND_STEPS].reverse().find((step) => points >= step.points) || BOND_STEPS[0]; }
export function recordWin(progress, { gameId, palId, cardId = null }) {
  if (Object.hasOwn(progress.rewards, gameId)) return progress;
  return { ...progress, wins: progress.wins + 1, latestRewardGameId: gameId,
    bonds: { ...progress.bonds, [palId]: (progress.bonds[palId] || 0) + 10 },
    rewards: { ...progress.rewards, [gameId]: { palId, cardId } } };
}
export function composePhoto(progress, cards, { gameId, cardId, name = '', background = 'midnight', filter = 'natural', framing = 'full', moment = null, finish = 'classic' }) {
  const reward = Object.hasOwn(progress.rewards, gameId) && progress.rewards[gameId];
  const source = cards.find((card) => card.cardId === cardId && card.palId === reward?.palId);
  if (!reward || !source) throw new Error('只能用本次胜利牌友的已解锁服装定格。');
  for (const [key, value] of Object.entries({ background, filter, framing })) {
    if (!PHOTO_OPTIONS[key].includes(value)) throw new Error('写真选项无效。');
  }
  if (typeof name !== 'string' || [...name.trim()].length > 24 || /[\u0000-\u001f]/.test(name)) throw new Error('写真名称最多 24 字，不能包含控制字符。');
  if (moment !== null && (!Number.isFinite(moment) || moment < 0 || moment > .95 || !source.layerSnapshot?.cardVideo)) throw new Error('定格时间无效或该服装没有演出视频。');
  if (!['classic','foil','prism'].includes(finish) || (finish === 'prism' && (progress.bonds[source.palId] || 0) < 30)) throw new Error('卡面工艺尚未解锁。');
  const previous = progress.creations.find((item) => item.gameId === gameId);
  const creation = { ...source, creationId: `photo-${gameId}`, gameId,
    name: name.trim() || `${source.outfitName} · 我的定格`, background, filter, framing, moment, finish,
    createdAt: previous?.createdAt || new Date().toISOString() };
  return { ...progress, creations: [...progress.creations.filter((item) => item.gameId !== gameId), creation] };
}
export function collectionSummary(progress, cards, libraries) {
  const total = Object.values(libraries).reduce((n, outfits) => n + outfits.length, 0);
  const validIds = new Set(Object.entries(libraries).flatMap(([palId, outfits]) => outfits.map((o) => `${palId}:${o.outfitId}`)));
  const owned = new Set(cards.filter((c) => validIds.has(c.cardId)).map((c) => c.cardId)).size;
  return { wins: progress.wins, owned, total,
    milestones: [1, 3, 6].map((count, i) => ({ count, name: ['初见收藏家', '月光收藏家', '舞台收藏家'][i], unlocked: owned >= count })),
    pals: Object.entries(libraries).map(([palId, outfits]) => {
      const points = progress.bonds[palId] || 0;
      const next = outfits.find((o) => !cards.some((c) => c.palId === palId && c.outfitId === o.outfitId));
      return { palId, points, level: bondLevel(points), nextBond: BOND_STEPS.find((s) => s.points > points) || null,
        nextOutfit: next ? { outfitId: next.outfitId, name: next.name } : null };
    }) };
}
