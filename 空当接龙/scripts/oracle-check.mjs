import { dealCards, cardLabel } from '../app/core/freecell.js';
import { runFcSolve, toFcSolveBoard } from '../app/core/oracle.js';
const seed = Number(process.argv[2] || 1);
const layout = toFcSolveBoard(dealCards(seed));
const result = runFcSolve(layout);
console.log(JSON.stringify({ seed, ...result }, null, 2));
process.exitCode = result.available && result.solved === false ? 1 : 0;
