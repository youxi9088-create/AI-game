import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { themes, packageFromPrompt, upgradeCardDesign } from '../app/core/themes.js';
import { validateThemePackage } from '../app/core/theme-contract.js';
import { composeThemePreview, makeDegradedTheme } from '../app/core/theme-composer.js';

test('预置 ThemePackage 满足可读性、资源和七层契约', () => { for (const theme of Object.values(themes)) assert.equal(validateThemePackage(theme).pass, true, theme.themeId); });
test('13 个主题合同样本和 20 条主题描述均能通过质量门', () => { assert.equal(Object.keys(themes).length, 13); const prompts = ['水墨山水', '霓虹夜城', '午夜蓝绒', '秋日枫木', '薰衣草暮色', '青玉庭院', '落日珊瑚', '石墨书桌', '梅影深紫', '古典纸牌', '雨后花园', '天文观测', '海边书房', '暖金咖啡', '冰川极光', '森林苔藓', '戏剧幕布', '航海图纸', '胶片暗房', '极简黑白']; for (const prompt of prompts) assert.equal(validateThemePackage(packageFromPrompt(prompt).theme).pass, true, prompt); });
test('损坏的主题不能通过质量门', () => { const damaged = structuredClone(themes.classic); delete damaged.spec.palette.redSuit; damaged.compose.layers.pop(); const report = validateThemePackage(damaged); assert.equal(report.pass, false); assert.ok(report.checks.some(item => !item.pass)); });
test('高风险主题描述会降级为原创 ThemePackage', () => { const result = packageFromPrompt('复制官方 logo'); assert.equal(result.fallbackUsed, true); assert.equal(validateThemePackage(result.theme).pass, true); });
test('主题合同包含 A-K、四花色与 12 张 J/Q/K 插画规格', () => { const design = themes.redDiner.spec.cardDesign; assert.equal(Object.keys(design.rankGlyphs).length, 13); assert.equal(Object.keys(design.suitSymbols).length, 4); assert.equal(Object.keys(design.faceCards).length, 12); assert.equal(design.faceCards.H12.portrait, 'queen'); assert.equal(validateThemePackage(themes.redDiner).checks.find(check => check.id === 'card-design').pass, true); });
test('每套主题可组合出 52 张均含七层的牌面描述', () => { const preview = composeThemePreview(themes.classic); assert.equal(preview.cards.length, 52); assert.ok(preview.cards.every(card => card.layers.length === 7)); assert.equal(preview.previews.length, 5); });
test('主题牌面支持独立的多形状规格且不影响字形契约', () => { const shapes = new Set(Object.values(themes).map(theme => theme.spec.cardDesign.shape)); assert.ok(shapes.size >= 5); for (const theme of Object.values(themes)) assert.equal(validateThemePackage(theme).checks.find(check => check.id === 'card-design').pass, true, theme.themeId); });
test('历史主题缺少形状字段时按语义迁移为可见变体', () => { const legacy = structuredClone(themes.classic); legacy.themeId = 'generated-legacy'; legacy.title = '古堡魔法学院牌室'; delete legacy.spec.cardDesign.shape; assert.equal(upgradeCardDesign(legacy).spec.cardDesign.shape, 'gothic'); });
test('可选牌面图片资产必须映射到合法花色、点数与 J/Q/K 牌位', () => {
  const theme = structuredClone(themes.classic);
  theme.assets.items.push({ id: 'suit-X', kind: 'suitMotif', suit: 'X', mime: 'image/png', contentHash: 'a'.repeat(64), url: '/v1/assets/x.png' });
  let report = validateThemePackage(theme); assert.equal(report.checks.find(check => check.id === 'suit-asset-map').pass, false); assert.equal(report.pass, false);
  theme.assets.items = theme.assets.items.filter(item => item.kind !== 'suitMotif');
  theme.assets.items.push({ id: 'rank-99', kind: 'rankGlyph', rank: 99, mime: 'image/png', contentHash: 'b'.repeat(64), url: '/v1/assets/y.png' });
  report = validateThemePackage(theme); assert.equal(report.checks.find(check => check.id === 'rank-asset-map').pass, false); assert.equal(report.pass, false);
  theme.assets.items = theme.assets.items.filter(item => item.kind !== 'rankGlyph');
  theme.assets.items.push({ id: 'rank-13', kind: 'rankGlyph', rank: 13, mime: 'image/png', contentHash: 'b'.repeat(64), url: '/v1/assets/y.png' }, { id: 'suit-S', kind: 'suitMotif', suit: 'S', mime: 'image/png', contentHash: 'c'.repeat(64), url: '/v1/assets/z.png' }, { id: 'face-S13', kind: 'faceCard', cardId: 'S13', mime: 'image/png', contentHash: 'd'.repeat(64), url: '/v1/assets/w.png' });
  report = validateThemePackage(theme); assert.equal(report.pass, true);
});
test('质量失败时可生成仍可玩的降级主题', () => { const degraded = makeDegradedTheme(themes.classic); assert.equal(degraded.source, 'degraded'); assert.equal(validateThemePackage(degraded).pass, true); });
test('默认翡翠主题真实资源存在、哈希匹配且包体低于 20MB', () => {
  for (const theme of [themes.classic]) {
    const assets = theme.assets.items;
    assert.deepEqual(assets.map(item => item.kind), ['background', 'cardBack']);
    let total = 0;
    for (const asset of assets) {
      const path = fileURLToPath(new URL(`..${asset.url}`, import.meta.url));
      const bytes = statSync(path).size;
      const hash = createHash('sha256').update(readFileSync(path)).digest('hex');
      assert.equal(bytes, asset.bytes, `${theme.themeId}:${asset.id}`);
      assert.equal(hash, asset.contentHash, `${theme.themeId}:${asset.id}`);
      assert.match(asset.reviewStatus, /^approved-stage[23]-/, `${theme.themeId}:${asset.id}`);
      total += bytes;
    }
    assert.equal(total, theme.sizeBytes, theme.themeId);
    assert.ok(total < 20 * 1024 * 1024, theme.themeId);
  }
});
