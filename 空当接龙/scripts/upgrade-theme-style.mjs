import { DatabaseSync } from 'node:sqlite';
import { makeCardDesign } from '../app/core/themes.js';
import { validateThemePackage } from '../app/core/theme-contract.js';

const [themeId, style] = process.argv.slice(2);
if (!themeId || !['classic', 'diner', 'cyber', 'ink'].includes(style)) { console.error('usage: node scripts/upgrade-theme-style.mjs <themeId> <classic|diner|cyber|ink>'); process.exit(1); }

const db = new DatabaseSync('.data/theme-freecell.sqlite');
const row = db.prepare('SELECT package FROM themes WHERE id = ?').get(themeId);
if (!row) { console.error(`theme not found: ${themeId}`); process.exit(1); }

const theme = JSON.parse(row.package);
theme.spec.cardDesign = makeCardDesign(style);
const quality = validateThemePackage(theme);
if (!quality.pass) { console.error(`quality gate failed: ${quality.checks.filter(c => !c.pass).map(c => c.id).join(', ')}`); process.exit(1); }
theme.quality = quality;
theme.revision = Number(theme.revision || 1) + 1;
db.prepare('UPDATE themes SET package = ? WHERE id = ?').run(JSON.stringify(theme), themeId);
console.log(`upgraded ${themeId} ("${theme.title}") to ${style}, revision r${theme.revision}, quality pass`);
