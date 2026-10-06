// Cosmetic progression only. All prices and gates are calculated on the server.
export const ECONOMY = Object.freeze({ version: 1, initialBalance: 20, entryCost: 0, winReward: 8, lossReward: 2 });
export const MILESTONES = Object.freeze([{ count: 1, reward: 4 }, { count: 3, reward: 8 }, { count: 6, reward: 12 }]);
export function quoteCard({ index, level = 0, wins, balance }) {
  const requiredWins = level ? 0 : index < 2 ? 1 : index < 5 ? 3 : 6;
  const cost = level ? [0, 12, 24, 40, 60][level] ?? null : index < 2 ? 24 : index < 5 ? 40 : 64;
  const reason = cost === null ? '已达典藏 Lv.5' : wins < requiredWins ? `累计 ${requiredWins} 胜开放（当前 ${wins} 胜）` : balance < cost ? `还差 ${cost - balance} Token` : null;
  return { action: level ? 'upgrade' : 'unlock', level, nextLevel: Math.min(level + 1, 5), cost, requiredWins, canPurchase: !reason, reason };
}
