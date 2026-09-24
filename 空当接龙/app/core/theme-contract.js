const REQUIRED_PALETTE = ['bg', 'surface', 'card', 'accent', 'redSuit', 'blackSuit', 'text'];
const LAYERS = ['L1 Base', 'L2 Material', 'L3 Border', 'L4 Content', 'L5 Gloss', 'L6 Outline', 'L7 Shadow'];
const RANK_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13'];
const SUIT_KEYS = ['S', 'H', 'D', 'C'];
const FACE_IDS = SUIT_KEYS.flatMap(suit => [11, 12, 13].map(rank => `${suit}${rank}`));
const CARD_STYLES = new Set(['classic', 'diner', 'cyber', 'ink']);
const CARD_SHAPES = new Set(['classic', 'soft', 'ticket', 'gothic', 'shield', 'arch', 'ink', 'diner']);
const hex = value => /^#[0-9a-f]{6}$/i.test(value || '');
const rgb = value => [1, 3, 5].map(offset => Number.parseInt(value.slice(offset, offset + 2), 16) / 255);
const channel = value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
const luminance = value => rgb(value).map(channel).reduce((total, current, index) => total + current * [0.2126, 0.7152, 0.0722][index], 0);
export const contrast = (one, two) => { if (!hex(one) || !hex(two)) return 0; const [a, b] = [luminance(one), luminance(two)].sort((x, y) => y - x); return (a + .05) / (b + .05); };
const lab = value => {
  const [r, g, b] = rgb(value).map(channel); const x = (r * .4124 + g * .3576 + b * .1805) / .95047; const y = (r * .2126 + g * .7152 + b * .0722); const z = (r * .0193 + g * .1192 + b * .9505) / 1.08883;
  const f = item => item > .008856 ? Math.cbrt(item) : 7.787 * item + 16 / 116; const [fx, fy, fz] = [x, y, z].map(f);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
};
export const deltaE2000 = (one, two) => {
  if (!hex(one) || !hex(two)) return 0; const [l1, a1, b1] = lab(one); const [l2, a2, b2] = lab(two); const c1 = Math.hypot(a1, b1); const c2 = Math.hypot(a2, b2); const avgC = (c1 + c2) / 2;
  const g = .5 * (1 - Math.sqrt((avgC ** 7) / (avgC ** 7 + 25 ** 7))); const ap1 = (1 + g) * a1; const ap2 = (1 + g) * a2; const cp1 = Math.hypot(ap1, b1); const cp2 = Math.hypot(ap2, b2); const hp = (a, b) => (Math.atan2(b, a) * 180 / Math.PI + 360) % 360; const hp1 = hp(ap1, b1); const hp2 = hp(ap2, b2);
  const dl = l2 - l1; const dc = cp2 - cp1; let dh = hp2 - hp1; if (cp1 * cp2 === 0) dh = 0; else if (dh > 180) dh -= 360; else if (dh < -180) dh += 360; const dH = 2 * Math.sqrt(cp1 * cp2) * Math.sin(dh * Math.PI / 360);
  const avgL = (l1 + l2) / 2; const avgCp = (cp1 + cp2) / 2; let avgH = hp1 + hp2; if (cp1 * cp2 === 0) avgH = hp1 + hp2; else if (Math.abs(hp1 - hp2) <= 180) avgH /= 2; else avgH = (avgH + (avgH < 360 ? 360 : -360)) / 2;
  const rad = degrees => degrees * Math.PI / 180; const t = 1 - .17 * Math.cos(rad(avgH - 30)) + .24 * Math.cos(rad(2 * avgH)) + .32 * Math.cos(rad(3 * avgH + 6)) - .2 * Math.cos(rad(4 * avgH - 63)); const sl = 1 + .015 * (avgL - 50) ** 2 / Math.sqrt(20 + (avgL - 50) ** 2); const sc = 1 + .045 * avgCp; const sh = 1 + .015 * avgCp * t; const rt = -2 * Math.sqrt((avgCp ** 7) / (avgCp ** 7 + 25 ** 7)) * Math.sin(rad(60 * Math.exp(-1 * (((avgH - 275) / 25) ** 2))));
  return Math.sqrt((dl / sl) ** 2 + (dc / sc) ** 2 + (dH / sh) ** 2 + rt * (dc / sc) * (dH / sh));
};

export function validateThemePackage(theme) {
  const palette = theme?.spec?.palette || {};
  const cardDesign = theme?.spec?.cardDesign || {};
  const checks = [];
  checks.push({ id: 'schema', pass: theme?.schemaVersion === '1.0' && /^[-a-z0-9]+$/i.test(theme?.themeId || ''), detail: 'schemaVersion 与 themeId 合法' });
  checks.push({ id: 'palette', pass: REQUIRED_PALETTE.every(key => hex(palette[key])), detail: '七项色彩令牌完整' });
  checks.push({ id: 'layers', pass: JSON.stringify(theme?.compose?.layers) === JSON.stringify(LAYERS), detail: '七层牌面模板固定' });
  checks.push({ id: 'assets', pass: Array.isArray(theme?.assets?.required) && ['background', 'cardBack', 'suitMotifs', 'cardFaces', 'ui'].every(key => theme.assets.required.includes(key)), detail: '主题资源清单完整' });
  const cardDesignPass = CARD_STYLES.has(cardDesign.rankFont)
    && CARD_STYLES.has(cardDesign.suitFont)
    && CARD_SHAPES.has(cardDesign.shape || cardDesign.cardShape || 'classic')
    && RANK_KEYS.every(key => typeof cardDesign.rankGlyphs?.[key] === 'string' && cardDesign.rankGlyphs[key].trim().length > 0 && cardDesign.rankGlyphs[key].length <= 3)
    && SUIT_KEYS.every(key => typeof cardDesign.suitSymbols?.[key] === 'string' && cardDesign.suitSymbols[key].trim().length > 0 && cardDesign.suitSymbols[key].length <= 3)
    && FACE_IDS.every(cardId => CARD_STYLES.has(cardDesign.faceCards?.[cardId]?.style) && ['jack', 'queen', 'king'].includes(cardDesign.faceCards?.[cardId]?.portrait));
  checks.push({ id: 'card-design', pass: cardDesignPass, detail: 'A-K 字形、四花色符号、12 张头牌插画与多形状牌面规格完整' });
  checks.push({ id: 'readability', pass: contrast(palette.card, palette.blackSuit) >= 4.5 && contrast(palette.card, palette.redSuit) >= 3, detail: '黑色与红色牌面可读性达标' });
  checks.push({ id: 'red-black-delta', pass: deltaE2000(palette.redSuit, palette.blackSuit) >= 40, detail: '红黑花色 CIEDE2000 色差达到 40' });
  checks.push({ id: 'background-separation', pass: contrast(palette.card, palette.bg) >= 1.4, detail: '牌面与桌面背景保持视觉分离' });
  const sizeBytes = Number(theme?.sizeBytes || new TextEncoder().encode(JSON.stringify(theme || {})).byteLength);
  checks.push({ id: 'package-size', pass: sizeBytes <= 20 * 1024 * 1024, detail: 'ThemePackage 不超过 20MB' });
  const items = theme?.assets?.items || [];
  checks.push({ id: 'asset-trace', pass: items.every(item => item.id && item.kind && item.mime && item.contentHash && (item.url || item.dataUrl)), detail: '外部生成资产均有来源、格式、hash 与地址' });
  const faceAssets = items.filter(item => item.kind === 'faceCard');
  checks.push({ id: 'face-asset-map', pass: faceAssets.every(item => FACE_IDS.includes(item.cardId) && typeof item.contentHash === 'string' && (item.url || item.dataUrl)), detail: '可选头牌图片资产均映射到合法 J/Q/K 牌位' });
  const suitAssets = items.filter(item => item.kind === 'suitMotif');
  checks.push({ id: 'suit-asset-map', pass: suitAssets.every(item => SUIT_KEYS.includes(item.suit) && typeof item.contentHash === 'string' && (item.url || item.dataUrl)), detail: '可选花色符号资产均映射到合法花色' });
  const rankAssets = items.filter(item => item.kind === 'rankGlyph');
  checks.push({ id: 'rank-asset-map', pass: rankAssets.every(item => RANK_KEYS.includes(String(item.rank)) && typeof item.contentHash === 'string' && (item.url || item.dataUrl)), detail: '可选 A-K 字形资产均映射到合法点数' });
  const cardFaceAssets = items.filter(item => ['rankGlyph', 'suitMotif', 'faceCard'].includes(item.kind));
  checks.push({ id: 'asset-background-policy', pass: cardFaceAssets.every(item => !item.backgroundMode || item.backgroundMode === 'transparent' || item.renderPolicy === 'programmatic-fallback'), detail: '牌面资产必须透明，旧的不透明输出只能走程序化回退' });
  const pass = checks.every(check => check.pass);
  return { pass, degraded: !pass, checks, checkedAt: new Date().toISOString() };
}

export const normalizeThemePackage = theme => ({ ...structuredClone(theme), quality: validateThemePackage(theme) });
