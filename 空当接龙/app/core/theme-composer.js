import { makeDeck, cardLabel } from './freecell.js';
import { validateThemePackage } from './theme-contract.js';
import { normalizeCardDesign } from './themes.js';

export const CARD_LAYERS = ['L1 Base', 'L2 Material', 'L3 Border', 'L4 Content', 'L5 Gloss', 'L6 Outline', 'L7 Shadow'];
export function composeCard(theme, card) {
  const design = normalizeCardDesign(theme.spec?.cardDesign, theme.themeId === 'red-diner' ? 'diner' : 'classic');
  const face = design.faceCards[card.id];
  return { cardId: card.id, label: cardLabel(card), themeId: theme.themeId, visual: { rankGlyph: design.rankGlyphs[String(card.rank)], suitSymbol: design.suitSymbols[card.suit], rankFont: design.rankFont, suitFont: design.suitFont, faceCard: face || null }, layers: CARD_LAYERS.map((name, index) => ({ name, source: index === 3 ? face ? 'theme-face-illustration' : 'theme-rank-and-suit-glyphs' : index === 1 ? 'theme-material' : 'programmatic' })) };
}
export function composeThemePreview(theme) {
  const quality = validateThemePackage(theme);
  return { themeId: theme.themeId, quality, cards: makeDeck().map(card => composeCard(theme, card)), previews: ['table', 'card-wall', 'card-back-background', 'ui-logo', 'quality-report'] };
}
export function makeDegradedTheme(theme) {
  const fallback = structuredClone(theme); fallback.themeId = `${theme.themeId}-degraded`; fallback.revision = Number(theme.revision || 0) + 1; fallback.source = 'degraded'; fallback.spec.palette = { ...fallback.spec.palette, card: '#fffdf7', redSuit: '#d93644', blackSuit: '#1d2730' }; fallback.spec.complianceNotes = '质量或 Provider 失败后使用的可玩降级主题。'; fallback.quality = validateThemePackage(fallback); return fallback;
}
