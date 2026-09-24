import { spawnSync } from 'node:child_process';

const notation = card => `${({ 1: 'A', 10: 'T', 11: 'J', 12: 'Q', 13: 'K' }[card.rank] || card.rank)}${card.suit}`;
export const toFcSolveBoard = tableau => `Foundations: H-0 C-0 D-0 S-0\nFreecells: - - - -\n${tableau.map(column => `: ${column.map(notation).join(' ')}`).join('\n')}`;

// CI can set FC_SOLVE_BIN to a real fc-solve executable.  The adapter never
// claims a solve result when the executable is absent or emits an error.
export function runFcSolve(layout, { binary = process.env.FC_SOLVE_BIN || 'fc-solve', timeoutMs = 30_000 } = {}) {
  const result = spawnSync(binary, [], { input: layout, encoding: 'utf8', timeout: timeoutMs, windowsHide: true });
  if (result.error?.code === 'ENOENT') return { available: false, solved: null, reason: `未找到 fc-solve：${binary}` };
  if (result.error) return { available: true, solved: null, reason: result.error.message };
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  return { available: true, solved: /This game is solveable/i.test(output), reason: output.slice(-1000), status: result.status };
}
