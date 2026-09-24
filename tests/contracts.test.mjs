import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTRACT_VERSION, MULTIPLIER_CAP, validateGameSnapshot, validatePalAsset, validatePhotoCard, validateLayeredAppearance } from '../packages/contracts/index.mjs';

test('game snapshot requires a versioned three-player server contract', () => {
  const valid = {
    contractVersion: CONTRACT_VERSION, phase: 'PLAYING', seq: 3, playerHand: [], tokenBalance: 0,
    seats: ['pal-linxing', 'pal-mia'],
    players: [{ id: 'player', role: '地主' }, { id: 'pal-linxing', role: '农民' }, { id: 'pal-mia', role: null }],
    turn: 'player', landlordId: 'player', multiplier: 3,
    bidding: { stage: 'DONE', highScore: 3, highBidderId: 'player', calls: [], grabQueue: [] }
  };
  assert.equal(validateGameSnapshot(valid), valid);
  assert.throws(() => validateGameSnapshot({ ...valid, contractVersion: '0' }), /contractVersion/);
  assert.throws(() => validateGameSnapshot({ ...valid, players: [] }), /three players/);
  assert.throws(() => validateGameSnapshot({ ...valid, players: [{ id: 'player', role: '裁判' }, {}, {}] }), /role/);
  assert.throws(() => validateGameSnapshot({ ...valid, landlordId: 'someone-else' }), /landlord identity/);
  assert.throws(() => validateGameSnapshot({ ...valid, multiplier: MULTIPLIER_CAP + 1 }), /multiplier within cap/);
  assert.throws(() => validateGameSnapshot({ ...valid, bidding: { ...valid.bidding, stage: 'CALLING' } }), /bidding stage/);
  assert.throws(() => validateGameSnapshot({ ...valid, bidding: null }), /bidding state/);
});

test('seats are carried by the snapshot, so a custom pal can take a seat', () => {
  const valid = {
    contractVersion: CONTRACT_VERSION, phase: 'BIDDING', seq: 0, playerHand: [], tokenBalance: 12,
    seats: ['pal-user-ab12', 'pal-mia'],
    players: [{ id: 'player', role: null }, { id: 'pal-user-ab12', role: null }, { id: 'pal-mia', role: null }],
    turn: 'player', landlordId: null, multiplier: 1,
    bidding: { stage: 'CALL', highScore: 0, highBidderId: null, calls: [], grabQueue: [] }
  };
  assert.equal(validateGameSnapshot(valid), valid, '自定义牌友的 palId 同样是合法座位');
  assert.throws(() => validateGameSnapshot({ ...valid, seats: ['pal-mia'] }), /two opponent seats/);
  assert.throws(() => validateGameSnapshot({ ...valid, seats: ['pal-mia', 'pal-mia'] }), /distinct/);
  assert.throws(() => validateGameSnapshot({ ...valid, seats: ['player', 'pal-mia'] }), /human seat/);
  assert.throws(() => validateGameSnapshot({ ...valid, seats: ['../etc/passwd', 'pal-mia'] }), /seat id shape/);
  /* 座位换了，参与者集合随之改变：旧座位的人不能再出现在牌局里。 */
  assert.throws(
    () => validateGameSnapshot({ ...valid, players: [{ id: 'player', role: null }, { id: 'pal-linxing', role: null }, { id: 'pal-mia', role: null }] }),
    /seated players match the seats/
  );
  assert.throws(() => validateGameSnapshot({ ...valid, turn: 'pal-linxing' }), /turn owner/);
});

test('visible pal asset cannot omit audit, adult fictional identity or a complete runtime pack', () => {
  const actions = Object.fromEntries(['A01', 'A02', 'A03', 'A04', 'A05'].map((key) => [key, { action: key }]));
  const dialogue = Object.fromEntries(['idle', 'play', 'pass', 'win', 'lose'].map((key) => [key, [key]]));
  const asset = { contractVersion: CONTRACT_VERSION, palId: 'p', readiness: 'READY', auditRecordId: 'audit-1', identity: { adultAppearance: true, fictional: true }, appearance: { portraitRef: 'asset://portrait' }, actionPack: actions, dialoguePack: dialogue, fallback: { actionLevel: 'L2' } };
  assert.equal(validatePalAsset(asset), asset);
  assert.throws(() => validatePalAsset({ ...asset, auditRecordId: '' }), /audited/);
  assert.throws(() => validatePalAsset({ ...asset, identity: { adultAppearance: false, fictional: true } }), /adult fictional/);
  assert.throws(() => validatePalAsset({ ...asset, actionPack: {} }), /five-state action pack/);
});

test('layered appearance requires base and outfit layers; model refs are optional slots', () => {
  assert.equal(validateLayeredAppearance({ base: 'b', outfit: 'o' }).base, 'b');
  assert.throws(() => validateLayeredAppearance({ base: '', outfit: 'o' }), /base layer/);
  assert.throws(() => validateLayeredAppearance({ base: 'b' }), /outfit layer/);
  const actions = Object.fromEntries(['A01', 'A02', 'A03', 'A04', 'A05'].map((key) => [key, { action: key }]));
  const dialogue = Object.fromEntries(['idle', 'play', 'pass', 'win', 'lose'].map((key) => [key, [key]]));
  const asset = { contractVersion: CONTRACT_VERSION, palId: 'p', readiness: 'READY', auditRecordId: 'audit-1', identity: { adultAppearance: true, fictional: true }, appearance: { portraitRef: 'asset://portrait', live2dRef: 'asset://model.model3.json', layers: { base: 'b', outfit: 'o' }, outfitLibrary: [{ outfitId: 'x', name: 'x', dance: 'x', layerSnapshot: { base: 'b', outfit: 'o' } }] }, actionPack: actions, dialoguePack: dialogue, fallback: { actionLevel: 'L2' } };
  assert.equal(validatePalAsset(asset), asset);
  assert.throws(() => validatePalAsset({ ...asset, appearance: { ...asset.appearance, layers: { base: 'b' } } }), /outfit layer/);
});

/* 1.4.0 起引入视频表现层：跳舞视频（结算舞台）与视频卡面（写真卡）。
   1.5.0 增加 tableStandeeRef：L2 可有一张专门裁过的半身抠像，缺省时前端退回全身 standeeRef。
   两者都遵守同一条依赖规则——可以有视频没封面，但不能有封面没视频，
   否则前端会渲染一个永远停在 poster 上的"假视频"。 */
test('video performance layers are optional, but a poster never outlives its video', () => {
  const actions = Object.fromEntries(['A01', 'A02', 'A03', 'A04', 'A05'].map((key) => [key, { action: key }]));
  const dialogue = Object.fromEntries(['idle', 'play', 'pass', 'win', 'lose'].map((key) => [key, [key]]));
  const base = { contractVersion: CONTRACT_VERSION, palId: 'p', readiness: 'READY', auditRecordId: 'audit-1', identity: { adultAppearance: true, fictional: true }, appearance: { portraitRef: 'asset://portrait' }, actionPack: actions, dialoguePack: dialogue, fallback: { actionLevel: 'L2' } };

  /* 只有跳舞视频、没有封面：合法。前端退化为纯色模糊底 + 视频首帧。 */
  const videoOnly = { ...base, appearance: { ...base.appearance, danceVideoRef: '/assets/pals/video/x.mp4' } };
  assert.equal(validatePalAsset(videoOnly).appearance.danceVideoRef, '/assets/pals/video/x.mp4');
  /* 视频 + 封面：合法，这是林星当前的配置。 */
  const withPoster = { ...videoOnly, appearance: { ...videoOnly.appearance, dancePosterRef: '/assets/pals/outfits/x.jpg', tableStandeeRef: '/assets/pals/table-p.png' } };
  assert.equal(validatePalAsset(withPoster), withPoster);
  assert.equal(validatePalAsset(withPoster).appearance.tableStandeeRef, '/assets/pals/table-p.png');
  assert.throws(() => validatePalAsset({ ...base, appearance: { ...base.appearance, tableStandeeRef: '' } }), /table standee reference/);
  /* 只有封面、没有视频：必须拒绝。 */
  assert.throws(
    () => validatePalAsset({ ...base, appearance: { ...base.appearance, dancePosterRef: '/assets/pals/outfits/x.jpg' } }),
    /dance poster requires a dance video/
  );
  assert.throws(() => validatePalAsset({ ...base, appearance: { ...base.appearance, danceVideoRef: '' } }), /dance video reference/);

  /* 卡面同理：video 可选，poster 依附于 video。 */
  assert.equal(validateLayeredAppearance({ base: 'b', outfit: 'o', cardVideo: '/v.mp4' }).cardVideo, '/v.mp4');
  assert.equal(validateLayeredAppearance({ base: 'b', outfit: 'o', cardVideo: '/v.mp4', cardPoster: '/p.jpg' }).cardPoster, '/p.jpg');
  assert.throws(() => validateLayeredAppearance({ base: 'b', outfit: 'o', cardPoster: '/p.jpg' }), /card poster requires a card video/);
  assert.throws(() => validateLayeredAppearance({ base: 'b', outfit: 'o', cardVideo: '' }), /card video/);
});

test('photo card contract locks serial, rarity, upgrade level and audit', () => {
  const card = { cardId: 'pal-linxing:starry-gown', palId: 'pal-linxing', outfitId: 'starry-gown', outfitName: '星夜礼服', dance: '月光步', layerSnapshot: { base: 'b', outfit: 'o' }, serialNo: 1, rarity: 'first', upgradeLevel: 1, seen: false, unlockedAt: '2026-09-12T00:00:00.000Z', auditRecordId: 'audit-1' };
  assert.equal(validatePhotoCard(card), card);
  assert.throws(() => validatePhotoCard({ ...card, serialNo: 0 }), /serial number/);
  assert.throws(() => validatePhotoCard({ ...card, rarity: 'legendary' }), /rarity/);
  assert.throws(() => validatePhotoCard({ ...card, upgradeLevel: 6 }), /upgrade level/);
  assert.throws(() => validatePhotoCard({ ...card, auditRecordId: '' }), /audit record/);
});
