import { classify, canBeat } from '../apps/api/game-engine.mjs';
import { createMockCandidate } from '../packages/pal-generation-core/index.mjs';
const fixtures = [
  [['3♣'], 'SINGLE'], [['3♣', '3♦'], 'PAIR'], [['Q♣', 'Q♦', 'Q♥'], 'TRIPLE'], [['7♣', '7♦', '7♥', '7♠'], 'BOMB'], [['3♣', '4♣', '5♣', '6♣', '7♣'], 'STRAIGHT'],
  [['SJ', 'BJ'], 'ROCKET'], [['3♣', '3♦', '3♥', '5♠'], 'TRIPLE_ONE'], [['3♣', '3♦', '3♥', '5♠', '5♥'], 'TRIPLE_PAIR'],
  [['3♣', '3♦', '4♣', '4♦', '5♣', '5♦'], 'DOUBLE_STRAIGHT'], [['3♣', '3♦', '3♥', '4♣', '4♦', '4♥'], 'TRIPLE_STRAIGHT'],
  [['3♣', '3♦', '3♥', '4♣', '4♦', '4♥', '5♠', '6♠'], 'AIRPLANE_ONE'],
  [['3♣', '3♦', '3♥', '4♣', '4♦', '4♥', '5♠', '5♥', '6♠', '6♥'], 'AIRPLANE_PAIR'],
  [['7♣', '7♦', '7♥', '7♠', '3♣', '4♦'], 'FOUR_TWO'], [['7♣', '7♦', '7♥', '7♠', '3♣', '3♦', '4♠', '4♥'], 'FOUR_TWO_PAIR']
];
for (const [cards, type] of fixtures) if (classify(cards)?.type !== type) throw new Error(`Fixture failed: ${type}`);
if (!canBeat(classify(['7♣', '7♦', '7♥', '7♠']), classify(['A♣']))) throw new Error('Bomb regression failed');
if (createMockCandidate({ prompt: '模仿某位明星' }).status !== 'BLOCKED') throw new Error('Safety fixture failed');
console.log(`Fixture verification passed: ${fixtures.length} card types + safety gates.`);
