import { contrast, deltaE2000, validateThemePackage } from './theme-contract.js';
const RANK_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13'];
const RANK_LABELS = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };
const SAFE_STYLES = new Set(['classic', 'diner', 'cyber', 'ink']);
const CARD_SHAPES = new Set(['classic', 'soft', 'ticket', 'gothic', 'shield', 'arch', 'ink', 'diner']);
const STANDARD_SUITS = { S: '♠', H: '♥', D: '♦', C: '♣' };

const defaultShapeForStyle = style => ({ classic: 'classic', diner: 'diner', cyber: 'gothic', ink: 'ink' }[style] || 'classic');
const inferShapeForTheme = theme => {
  const text = `${theme?.title || ''} ${theme?.intent?.prompt || ''} ${theme?.spec?.motifs?.material || ''}`;
  if (/古堡|城堡|魔法|学院|哥特|gothic/i.test(text)) return 'gothic';
  if (/蟠龙|四象|龙纹|骑士|盾|shield/i.test(text)) return 'shield';
  if (/云浪|海洋|彩虹|卡通|柔和|soft/i.test(text)) return 'soft';
  if (/票券|邮票|车票|ticket/i.test(text)) return 'ticket';
  if (/拱顶|教堂|宫殿|arch/i.test(text)) return 'arch';
  if (/餐厅|汽水|冰爽|diner/i.test(text)) return 'diner';
  if (/水墨|江南|山水|宣纸|ink/i.test(text)) return 'ink';
  return '';
};

export function makeCardDesign(style = 'classic', shape = '') {
  const safeStyle = SAFE_STYLES.has(style) ? style : 'classic';
  const safeShape = CARD_SHAPES.has(shape) ? shape : defaultShapeForStyle(safeStyle);
  const rankGlyphs = Object.fromEntries(RANK_KEYS.map(key => [key, RANK_LABELS[key] || key]));
  const faceCards = Object.fromEntries(['S', 'H', 'D', 'C'].flatMap(suit => [11, 12, 13].map(rank => [`${suit}${rank}`, { style: safeStyle, portrait: rank === 11 ? 'jack' : rank === 12 ? 'queen' : 'king' }])));
  return { rankFont: safeStyle, suitFont: safeStyle, shape: safeShape, rankGlyphs, suitSymbols: { ...STANDARD_SUITS }, faceCards };
}

export function normalizeCardDesign(design, fallbackStyle = 'classic') {
  const fallback = makeCardDesign(fallbackStyle);
  const style = SAFE_STYLES.has(design?.rankFont) ? design.rankFont : fallback.rankFont;
  const suitFont = SAFE_STYLES.has(design?.suitFont) ? design.suitFont : style;
  const shape = CARD_SHAPES.has(design?.shape || design?.cardShape) ? (design.shape || design.cardShape) : fallback.shape;
  const rankGlyphs = Object.fromEntries(RANK_KEYS.map(key => [key, String(design?.rankGlyphs?.[key] || fallback.rankGlyphs[key]).slice(0, 3)]));
  const suitSymbols = Object.fromEntries(Object.keys(STANDARD_SUITS).map(key => [key, String(design?.suitSymbols?.[key] || STANDARD_SUITS[key]).slice(0, 3)]));
  const faceCards = Object.fromEntries(Object.entries(fallback.faceCards).map(([cardId, face]) => {
    const candidate = design?.faceCards?.[cardId] || {};
    return [cardId, { style: SAFE_STYLES.has(candidate.style) ? candidate.style : style, portrait: ['jack', 'queen', 'king'].includes(candidate.portrait) ? candidate.portrait : face.portrait }];
  }));
  return { rankFont: style, suitFont, shape, cardShape: shape, rankGlyphs, suitSymbols, faceCards };
}

export function upgradeCardDesign(theme) {
  const upgraded = structuredClone(theme);
  upgraded.assets ??= {};
  upgraded.assets.required = [...new Set([...(upgraded.assets.required || []), 'background', 'cardBack', 'suitMotifs', 'cardFaces', 'ui'])];
  upgraded.spec ??= {};
  const fallbackStyle = upgraded.themeId === 'red-diner' ? 'diner' : /cyber|neon|midnight|slate/i.test(upgraded.themeId || '') ? 'cyber' : /ink|lavender|plum/i.test(upgraded.themeId || '') ? 'ink' : 'classic';
  const hadShape = Boolean(upgraded.spec.cardDesign?.shape || upgraded.spec.cardDesign?.cardShape);
  upgraded.spec.cardDesign = normalizeCardDesign(upgraded.spec.cardDesign, fallbackStyle);
  const inferredShape = inferShapeForTheme(upgraded);
  if (inferredShape && !hadShape) upgraded.spec.cardDesign.shape = inferredShape;
  upgraded.spec.cardDesign.cardShape = upgraded.spec.cardDesign.shape;
  upgraded.quality = validateThemePackage(upgraded);
  return upgraded;
}

const base = { schemaVersion: '1.0', revision: 1, source: 'manual', assets: { manifestVersion: '1.0', required: ['background', 'cardBack', 'suitMotifs', 'cardFaces', 'ui'] }, compose: { layers: ['L1 Base', 'L2 Material', 'L3 Border', 'L4 Content', 'L5 Gloss', 'L6 Outline', 'L7 Shadow'] }, quality: { pass: true, degraded: false, checks: ['contrast', 'manifest', 'rank-and-suit-readable', 'card-design-readable'] } };
export const themes = {
  classic: { ...base, themeId: 'classic', revision: 5, title: '翡翠牌室', intent: { themeType: 'style', prompt: '经典翡翠绿绒纸牌室' }, assets: { ...base.assets, items: [{ id: 'background', kind: 'background', mime: 'image/png', url: '/app/assets/classic-table-bg.png', bytes: 2523044, contentHash: 'd14a929dfbfe44e52222d2afc28b57a9f9f58a5662b095a186a2a89d85210dbb', provider: 'codex-imagegen', model: 'built-in-imagegen', reviewStatus: 'approved-stage2-sample' }, { id: 'cardBack', kind: 'cardBack', mime: 'image/png', url: '/app/assets/classic-card-back.png', bytes: 2815773, contentHash: '6db531fc3f43856139f5f769df05db747340570b418886794e6b91d0391e0320', provider: 'codex-imagegen', model: 'built-in-imagegen', reviewStatus: 'approved-stage2-sample' }] }, sizeBytes: 5338817, spec: { palette: { bg: '#062f25', surface: '#0a4637', card: '#fffdf7', accent: '#d6ae62', redSuit: '#c72f3d', blackSuit: '#18242a', text: '#f5f1e8' }, cardDesign: makeCardDesign('classic'), motifs: { material: 'emerald-felt', logo: 'FREECELL ATELIER' }, complianceNotes: '阶段二代表性真实资源样本；背景与牌背由 Codex ImageGen 生成并完成人工可读性复核。' } },
  dragon: { ...base, themeId: 'dragon', revision: 1, title: '鎏金四象蟠龙图腾', intent: { themeType: 'style', prompt: '工程既有的鎏金四象蟠龙图腾主题' }, assets: { ...base.assets, items: [{ id: 'background', kind: 'background', mime: 'image/jpeg', url: '/app/assets/dragon-table-bg.jpg', bytes: 1499616, contentHash: '0c7faa2f269702a28a66d691b33522a0b6d5fec225d5a023f448d7e08c114cb9', provider: 'aihub', model: 'jimeng', reviewStatus: 'approved-stage3-promoted' }, { id: 'cardBack', kind: 'cardBack', mime: 'image/jpeg', url: '/app/assets/dragon-card-back.jpg', bytes: 1192501, contentHash: '35446a35424988aabae8a156703010c2467047c0cadc388d544647fdf27c3104', provider: 'aihub', model: 'jimeng', reviewStatus: 'approved-stage3-promoted' }] }, sizeBytes: 2692117, spec: { palette: { bg: '#1a201b', surface: '#303a26', card: '#fffdf4', accent: '#d6ad52', redSuit: '#b72e31', blackSuit: '#17231d', text: '#f6e6bd' }, cardDesign: makeCardDesign('ink', 'shield'), motifs: { material: 'gilded-dragon-brocade', logo: '蟠龙牌室' }, complianceNotes: '复用工程内已验收的鎏金四象蟠龙图腾背景与牌背；规则点数、花色和命中区域由程序固定。' } },
  mouse: { ...base, themeId: 'mouse', revision: 1, title: '复古圆耳小鼠派对', intent: { themeType: 'internal-style', prompt: '工程既有的复古圆耳小鼠卡通主题，仅内部使用' }, assets: { ...base.assets, items: [{ id: 'background', kind: 'background', mime: 'image/jpeg', url: '/app/assets/mouse-table-bg.jpg', bytes: 358713, contentHash: '7d03be230d2267d6aac7d41ed25f6a0a115c35561ea6b0eb61e64f0a5d81fb5b', provider: 'aihub', model: 'jimeng', reviewStatus: 'approved-stage3-promoted' }, { id: 'cardBack', kind: 'cardBack', mime: 'image/jpeg', url: '/app/assets/mouse-card-back.jpg', bytes: 450178, contentHash: 'c065a4b2de3e8815d93f1e27c707049bbb4f542cba7fc27bbdc5bf94a1fd6a05', provider: 'aihub', model: 'jimeng', reviewStatus: 'approved-stage3-promoted' }] }, sizeBytes: 808891, spec: { palette: { bg: '#242331', surface: '#39374b', card: '#fffdf7', accent: '#f0bd3f', redSuit: '#c72f3d', blackSuit: '#18242a', text: '#fff6df' }, cardDesign: makeCardDesign('diner'), motifs: { material: 'retro-cartoon-party', logo: '圆耳小鼠牌室' }, complianceNotes: '仅限内部使用的工程既有主题资源；牌局规则、点数、花色与可读性保持程序化保护。' } },
  redDiner: { ...base, themeId: 'red-diner', revision: 2, source: 'builtin', title: '冰爽红白餐厅', intent: { themeType: 'brand-inspired', prompt: '原创红白汽水、冰爽气泡、白色波浪飘带与复古美式餐厅氛围' }, assets: { ...base.assets, items: [{ id: 'background', kind: 'background', mime: 'image/jpeg', url: '/app/assets/red-diner-table-bg.jpg', bytes: 641129, contentHash: '1c327269b8a3bb3503a7060a5095b2bcec20248f076a3f947bdf6241c98358c7', provider: 'aihub', model: 'jimeng', runId: 'AAABoICKorzElQ', attempt: 1, reviewStatus: 'approved-stage3-promoted' }, { id: 'cardBack', kind: 'cardBack', mime: 'image/jpeg', url: '/app/assets/red-diner-card-back.jpg', bytes: 798912, contentHash: '6d6ec254c132cc99974ed1eb5744f69d71a4a3eec9aa98bcca40181e1b100a23', provider: 'aihub', model: 'jimeng', runId: 'AAABoICKoFXitA', attempt: 1, reviewStatus: 'approved-stage3-promoted' }] }, sizeBytes: 1440041, spec: { palette: { bg: '#b5121b', surface: '#f7f1e8', card: '#fffdf7', accent: '#d9b46e', redSuit: '#c72f3d', blackSuit: '#18242a', text: '#2b1f1a' }, cardDesign: makeCardDesign('diner'), motifs: { material: 'glossy-soda-diner', logo: 'FIZZ FREECELL' }, complianceNotes: '由真实流水线生成后晋升为内置主题；采用原创红白汽水、冰爽气泡与复古餐厅氛围，不含品牌名、标识、包装、文字或水印。' }, generation: { provider: 'aihub-gateway', promptHash: '58a5d075c42e469bbd99adf539630e48f949743fbc399b404b804787d65fef2b', models: { text: 'gpt-5.5-2026-04-24', image: 'jimeng' }, responseId: 'chatcmpl-ELnGB79OxOSg230KCf5wfoRiC8e68', runs: { background: ['AAABoICKorzElQ'], cardBack: ['AAABoICKoFXitA'] }, createdAt: '2026-09-08T10:24:15.617Z' } },
  cyber: { ...base, themeId: 'cyber', revision: 4, title: '霓虹夜城', intent: { themeType: 'style', prompt: '赛博朋克夜城' }, spec: { palette: { bg: '#110b2d', surface: '#22134d', card: '#f7f4ff', accent: '#4df5e1', redSuit: '#e64288', blackSuit: '#18203a', text: '#f2efff' }, cardDesign: makeCardDesign('cyber'), motifs: { material: 'grid', logo: 'NEON FREECELL' }, complianceNotes: '原创霓虹风格，不包含品牌或 IP 标识' } },
  ink: { ...base, themeId: 'ink', revision: 4, title: '水墨山水', intent: { themeType: 'style', prompt: '中国水墨山水主题' }, spec: { palette: { bg: '#5a655c', surface: '#7c8b80', card: '#fffef9', accent: '#ab6c32', redSuit: '#d93644', blackSuit: '#1d2730', text: '#1d2730' }, cardDesign: makeCardDesign('ink'), motifs: { material: 'paper', logo: '墨韵空当接龙' }, complianceNotes: '原创水墨意象，不使用受保护画作；色板经红黑色差与背景分离校正。' } }
};
const variants = [
  ['midnight', '午夜蓝绒', '#10223b', '#142e4d', '#7dd3fc', 'MIDNIGHT FREECELL'],
  ['autumn', '秋日枫木', '#5a2c21', '#733d2d', '#f3b34c', 'AUTUMN FREECELL'],
  ['lavender', '薰衣草暮色', '#35244d', '#4b3567', '#c4a7ff', 'LAVENDER FREECELL'],
  ['jade', '青玉庭院', '#0d4e4b', '#12635d', '#9ee6c3', 'JADE FREECELL'],
  ['sunset', '落日珊瑚', '#713344', '#8f4351', '#ffd08a', 'SUNSET FREECELL'],
  ['slate', '石墨书桌', '#26313b', '#344552', '#b6d6e8', 'SLATE FREECELL'],
  ['plum', '梅影深紫', '#3a173c', '#57235a', '#f0a6d7', 'PLUM FREECELL'],
];
for (const [themeId, title, bg, surface, accent, logo] of variants) themes[themeId] = { ...structuredClone(themes.classic), themeId, title, revision: 1, assets: structuredClone(base.assets), sizeBytes: undefined, spec: { ...structuredClone(themes.classic.spec), cardDesign: makeCardDesign(themeId === 'lavender' || themeId === 'plum' ? 'ink' : themeId === 'midnight' || themeId === 'slate' ? 'cyber' : 'classic', ({ midnight: 'gothic', autumn: 'ticket', lavender: 'arch', jade: 'soft', sunset: 'shield', slate: 'gothic', plum: 'ink' })[themeId] || 'classic'), palette: { ...themes.classic.spec.palette, bg, surface, accent }, motifs: { material: 'linen', logo }, complianceNotes: '原创配色主题，使用固定可读牌面与主题化头牌插画。' } };
export function ensurePlayablePalette(theme) {
  const next = structuredClone(theme);
  const palette = next?.spec?.palette;
  if (!palette) return next;
  // Theme prompts and generated images remain untouched. These tokens are the
  // program-drawn rule layer, so normalizing them prevents a theme from hiding
  // rank/suit information or blending cards into the table.
  if (contrast(palette.card, palette.bg) < 1.4) palette.bg = '#0b4f6c';
  if (contrast(palette.card, palette.blackSuit) < 4.5) palette.blackSuit = '#18242a';
  if (contrast(palette.card, palette.redSuit) < 3) palette.redSuit = '#c72f3d';
  if (deltaE2000(palette.redSuit, palette.blackSuit) < 40) palette.redSuit = '#c72f3d';
  if (deltaE2000(palette.redSuit, palette.blackSuit) < 40) palette.blackSuit = '#18242a';
  return next;
}
export function validateTheme(theme) { const report = validateThemePackage(theme); return { ...report, checks: report.checks.map(item => `${item.pass ? '✓' : '×'} ${item.detail}`) }; }
export function packageFromPrompt(prompt) {
  const text = prompt.trim(); if (!text || text.length > 200) return { error: text ? '主题描述不能超过 200 个字符。' : '请输入一句主题描述。' };
  const forbidden = /logo|商标|官方原画|复刻|复制/i.test(text); const choice = /水墨|山水|ink/i.test(text) ? 'ink' : /赛博|霓虹|cyber/i.test(text) ? 'cyber' : 'classic'; const shape = /哥特|城堡|魔法|gothic/i.test(text) ? 'gothic' : /票券|邮票|ticket/i.test(text) ? 'ticket' : /拱顶|教堂|arch/i.test(text) ? 'arch' : /盾|骑士|shield/i.test(text) ? 'shield' : /柔和|圆润|soft/i.test(text) ? 'soft' : /餐厅|汽水|diner/i.test(text) ? 'diner' : undefined;
  const theme = structuredClone(themes[choice]); theme.themeId = `generated-${Date.now()}`; theme.title = `${choice === 'classic' ? '定制经典' : themes[choice].title}主题`; theme.source = 'generated'; theme.intent = { themeType: forbidden ? 'brand-inspired' : 'generic', prompt: text }; theme.revision = 1; theme.spec.cardDesign = makeCardDesign(choice, shape); theme.spec.complianceNotes = forbidden ? '检测到品牌或官方素材请求；已改为原创风格演绎，未复制标识或原画。' : 'Mock Provider 生成：使用可读性优先的安全资产 fixture。'; theme.quality = validateTheme(theme); return { theme, fallbackUsed: forbidden };
}
