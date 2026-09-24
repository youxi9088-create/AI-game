import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from '../app/core/freecell.js';
import { runFcSolve, toFcSolveBoard } from '../app/core/oracle.js';

test('fc-solve 输入采用标准 Foundation/Freecells/8 cascade 格式', () => { const board = toFcSolveBoard(newGame(1).tableau); assert.match(board, /^Foundations: H-0 C-0 D-0 S-0\nFreecells: - - - -\n: /); assert.equal(board.split('\n').filter(line => line.startsWith(': ')).length, 8); });
test('未安装 fc-solve 时 oracle 明确报告不可用', () => { const result = runFcSolve('', { binary: 'fc-solve-not-installed-for-test' }); assert.deepEqual(result, { available: false, solved: null, reason: '未找到 fc-solve：fc-solve-not-installed-for-test' }); });
