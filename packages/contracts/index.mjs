export const CONTRACT_VERSION = '1.5.0';

/* 官方默认座位。座位不再写死在规则里——任何 READY 的 PalAsset 都能上桌，
   这两位只是没指定时的默认值。参与者的合法集合由每局快照自带的 seats 推导。 */
export const PAL_IDS = ['pal-linxing', 'pal-mia'];
export const DEFAULT_SEATS = PAL_IDS;
export const SETTLEMENT_STAGES = ['RESULT', 'PERFORMANCE', 'PHOTO_REVEAL', 'DESTINATION'];
export const APPEARANCE_LEVELS = ['L1', 'L2', 'L3'];
export const CARD_RARITIES = ['first', 'normal'];
export const MAX_UPGRADE_LEVEL = 5;
export const PLAYER_ID = 'player';
/* 座位位置：牌桌只有两个对手位，出牌锚点按位置而非 palId 命名，
   这样自定义牌友上桌时不需要为她单独写一套坐标。 */
export const SEAT_KEYS = ['top', 'right'];
export const ROLES = ['地主', '农民'];
export const BID_STAGES = ['CALL', 'GRAB', 'DONE'];
/* 倍数上限：炸弹每次翻倍，理论上可以非常大。封顶是为了让 Token 结算可预期，
   并在结算面板里如实标注「已封顶」，而不是悄悄截断。 */
export const MULTIPLIER_CAP = 64;

export function assert(condition, message) {
  if (!condition) throw new Error(`Contract violation: ${message}`);
}

const isRole = (role) => role === undefined || role === null || ROLES.includes(role);
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/* 座位校验：牌桌固定两个对手位。palId 允许任意 READY 资产（含工坊生成的自定义牌友），
   但不能是人类位、不能重复——重复会让同一份手牌被两个人持有，直接破坏牌面守恒。 */
export function validateSeats(seats) {
  assert(Array.isArray(seats) && seats.length === 2, 'two opponent seats');
  assert(seats.every((id) => typeof id === 'string' && ID_PATTERN.test(id)), 'seat id shape');
  assert(!seats.includes(PLAYER_ID), 'the human seat is not an opponent seat');
  assert(new Set(seats).size === seats.length, 'seat ids must be distinct');
  return seats;
}

const participantsOf = (seats) => [PLAYER_ID, ...seats];

function validateBidding(bidding, participants) {
  assert(typeof bidding === 'object' && bidding !== null, 'bidding state');
  assert(BID_STAGES.includes(bidding.stage), 'bidding stage');
  assert(Number.isInteger(bidding.highScore) && bidding.highScore >= 0 && bidding.highScore <= 3, 'bidding high score');
  assert(bidding.highBidderId === null || participants.includes(bidding.highBidderId), 'bidding high bidder');
  assert(Array.isArray(bidding.calls), 'bidding call log');
  assert(Array.isArray(bidding.grabQueue), 'bidding grab queue');
  return bidding;
}

export function validateGameSnapshot(snapshot) {
  assert(snapshot?.contractVersion === CONTRACT_VERSION, 'game snapshot contractVersion');
  assert(['BIDDING', 'PLAYING', 'SETTLED'].includes(snapshot.phase), 'game phase');
  assert(Array.isArray(snapshot.playerHand), 'player hand');
  assert(Array.isArray(snapshot.players) && snapshot.players.length === 3, 'three players');
  assert(snapshot.players.every((player) => typeof player?.id === 'string' && isRole(player.role)), 'player identity and role');
  const participants = participantsOf(validateSeats(snapshot.seats));
  assert(snapshot.players.every((player) => participants.includes(player.id)), 'seated players match the seats');
  assert(Number.isInteger(snapshot.seq) && snapshot.seq >= 0, 'sequence');
  assert(typeof snapshot.tokenBalance === 'number' && snapshot.tokenBalance >= 0, 'non-negative token balance');
  assert(participants.includes(snapshot.turn), 'turn owner');
  assert(snapshot.landlordId === null || participants.includes(snapshot.landlordId), 'landlord identity');
  assert(Number.isInteger(snapshot.multiplier) && snapshot.multiplier >= 1 && snapshot.multiplier <= MULTIPLIER_CAP, 'multiplier within cap');
  validateBidding(snapshot.bidding, participants);
  return snapshot;
}

const optionalRef = (value) => value === undefined || value === null || (typeof value === 'string' && value.length > 0);

export function validateLayeredAppearance(layers) {
  assert(typeof layers?.base === 'string' && layers.base.length > 0, 'layered appearance base layer');
  assert(typeof layers?.outfit === 'string' && layers.outfit.length > 0, 'layered appearance outfit layer');
  assert(optionalRef(layers.hair), 'layered appearance hair layer');
  assert(optionalRef(layers.accessory), 'layered appearance accessory layer');
  assert(optionalRef(layers.effect), 'layered appearance effect layer');
  /* 录像卡面（可选）：写真卡在放一段竖屏舞蹈视频，而不是静态分层图。
     源片是 4:7 装进 3:4 的卡框，所以必须配一张同构图静帧 cardPoster，
     它同时充当 <video poster> 和信箱式留边的模糊填充底——少了它，视频没加载完时卡面会是空的。 */
  assert(optionalRef(layers.cardVideo), 'layered appearance card video');
  assert(optionalRef(layers.cardPoster), 'layered appearance card poster');
  assert(!layers.cardPoster || layers.cardVideo, 'card poster requires a card video');
  return layers;
}

export function validateOutfitEntry(entry) {
  assert(typeof entry?.outfitId === 'string' && entry.outfitId.length > 0, 'outfit id');
  assert(typeof entry?.name === 'string' && entry.name.length > 0, 'outfit name');
  assert(typeof entry?.dance === 'string' && entry.dance.length > 0, 'outfit dance');
  validateLayeredAppearance(entry.layerSnapshot);
  return entry;
}

export function validatePalAsset(asset) {
  assert(asset?.contractVersion === CONTRACT_VERSION, 'pal asset contractVersion');
  assert(typeof asset.palId === 'string' && asset.palId.length > 0, 'palId');
  assert(['READY', 'DEGRADED_READY', 'BLOCKED'].includes(asset.readiness), 'asset readiness');
  assert(asset.auditRecordId?.startsWith('audit-'), 'audited visible asset');
  assert(asset.identity?.adultAppearance === true && asset.identity?.fictional === true, 'adult fictional identity');
  assert(typeof asset.appearance?.portraitRef === 'string' && asset.appearance.portraitRef.length > 0, 'portrait asset reference');
  /* 头像是独立的头肩像，不与大厅主视觉或牌桌立绘共用；旧官方资产可暂缺，
     前端会按明确顺序回退到 portraitRef。 */
  assert(optionalRef(asset.appearance?.avatarRef), 'avatar reference');
  assert(optionalRef(asset.appearance?.live2dRef), 'live2d model reference');
  assert(optionalRef(asset.appearance?.vrmRef), 'vrm model reference');
  assert(optionalRef(asset.appearance?.standeeRef), 'transparent standee reference');
  /* 牌桌座位可以用专门裁过的抠像。L2 是半身镜头，而大厅/L4 可以保留全身立绘；
     若缺省，前端自然退回 standeeRef，不让此字段变成上桌的前置条件。 */
  assert(optionalRef(asset.appearance?.tableStandeeRef), 'table standee reference');
  /* 首页 L1 可以使用独立的半身主视觉：比 L2 牌桌更近景，但不替换大厅之外的全身立绘。 */
  assert(optionalRef(asset.appearance?.loungeStandeeRef), 'lounge standee reference');
  /* 登台演出用的竖屏写真视频（可选）。与 actionPack 的分层动作视频是两回事：
     前者是整段舞蹈的 L1 主轨，后者是五态短动作。缺主轨时退回 A05/A04/A01，再退回 L2 静态。 */
  assert(optionalRef(asset.appearance?.danceVideoRef), 'dance video reference');
  assert(optionalRef(asset.appearance?.dancePosterRef), 'dance poster reference');
  assert(!asset.appearance?.dancePosterRef || asset.appearance?.danceVideoRef, 'dance poster requires a dance video');
  /* 入场封面（可选）：入场视频播放前/失败时的静帧，从对应视频取帧派生。 */
  assert(optionalRef(asset.appearance?.entryPosterRef), 'entry poster reference');
  /* 产品入场为横版 16:9 全屏演出；竖版写真或跳舞片不得作为 entryVideoRef。
     旧资产未填写时允许缺省，以便平滑兼容既有横版入场片。 */
  assert(asset.appearance?.entryVideoFit === undefined || asset.appearance.entryVideoFit === 'landscape', 'entry video presentation');
  if (asset.appearance?.layers) validateLayeredAppearance(asset.appearance.layers);
  if (asset.appearance?.outfitLibrary) {
    assert(Array.isArray(asset.appearance.outfitLibrary) && asset.appearance.outfitLibrary.length > 0, 'outfit library entries');
    asset.appearance.outfitLibrary.forEach(validateOutfitEntry);
  }
  assert(typeof asset.actionPack === 'object' && ['A01', 'A02', 'A03', 'A04', 'A05'].every((key) => asset.actionPack[key]), 'five-state action pack');
  assert(typeof asset.dialoguePack === 'object' && ['idle', 'play', 'pass', 'win', 'lose'].every((key) => Array.isArray(asset.dialoguePack[key]) && asset.dialoguePack[key].length > 0), 'five-state dialogue pack');
  assert(asset.fallback?.actionLevel === 'L2' || asset.fallback?.actionLevel === 'L3', 'fallback action level');
  return asset;
}

export function validatePhotoCard(card) {
  assert(typeof card?.cardId === 'string' && card.cardId.length > 0, 'photo card id');
  assert(typeof card?.palId === 'string' && card.palId.length > 0, 'photo card palId');
  assert(typeof card?.outfitId === 'string' && card.outfitId.length > 0, 'photo card outfitId');
  assert(typeof card?.outfitName === 'string' && card.outfitName.length > 0, 'photo card outfit name');
  assert(typeof card?.dance === 'string' && card.dance.length > 0, 'photo card dance');
  validateLayeredAppearance(card.layerSnapshot);
  assert(Number.isInteger(card.serialNo) && card.serialNo >= 1, 'photo card serial number');
  assert(CARD_RARITIES.includes(card.rarity), 'photo card rarity');
  assert(Number.isInteger(card.upgradeLevel) && card.upgradeLevel >= 1 && card.upgradeLevel <= MAX_UPGRADE_LEVEL, 'photo card upgrade level');
  assert(typeof card.seen === 'boolean', 'photo card seen flag');
  assert(typeof card.unlockedAt === 'string' && card.unlockedAt.length > 0, 'photo card unlock time');
  assert(card.auditRecordId?.startsWith('audit-'), 'photo card audit record');
  return card;
}

export function canonical(value) { return JSON.stringify(value, Object.keys(value).sort()); }
