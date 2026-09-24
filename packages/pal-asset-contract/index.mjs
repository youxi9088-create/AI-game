import { CONTRACT_VERSION, validatePalAsset, validateOutfitEntry } from '../contracts/index.mjs';

export const PAL_ASSET_CONTRACT_VERSION = CONTRACT_VERSION;

const actionFrames = (sheetRef, actionVideoRefs = {}, actionImageRefs = {}) => ({
  A01: { action: 'idle', sheetRef, frame: [0, 0], videoRef: actionVideoRefs.A01 || null, imageRef: actionImageRefs.A01 || null },
  A02: { action: 'play', sheetRef, frame: [1, 0], videoRef: actionVideoRefs.A02 || null, imageRef: actionImageRefs.A02 || null },
  A03: { action: 'pass', sheetRef, frame: [2, 0], videoRef: actionVideoRefs.A03 || null, imageRef: actionImageRefs.A03 || null },
  A04: { action: 'win', sheetRef, frame: [0, 1], videoRef: actionVideoRefs.A04 || null, imageRef: actionImageRefs.A04 || null },
  A05: { action: 'lose', sheetRef, frame: [1, 1], videoRef: actionVideoRefs.A05 || null, imageRef: actionImageRefs.A05 || null }
});

/* 五态台词。官方牌友各有自己的口吻；工坊生成的自定义牌友拿不到专属台词，
   统一落到「通用」这一档——不给她编一套并不存在的性格。 */
const DIALOGUES = {
  林星: { idle: ['月色正好，慢慢来。'], play: ['这张牌，交给夜色。'], pass: ['这轮我先观察。'], win: ['漂亮的收束。'], lose: ['下一局我会换个节奏。'] },
  银岚: { idle: ['球场的灯还亮着，别急。'], play: ['这一手，我起跳。'], pass: ['先收一步，找找节拍。'], win: ['收尾的姿态要漂亮。'], lose: ['换个数拍，下一局再来。'] }
};
const GENERIC_DIALOGUE = { idle: ['牌局刚开始，别急。'], play: ['这手牌我来接。'], pass: ['我先留一张底牌。'], win: ['节奏在我这里。'], lose: ['这一局，记住你的节奏。'] };
const dialogueFor = (name) => DIALOGUES[name] || GENERIC_DIALOGUE;

export function createOutfit({ outfitId, name, dance, layerSnapshot }) {
  return validateOutfitEntry({ outfitId, name, dance, layerSnapshot });
}

export function createOfficialPal({ palId, name, accent, outfit, dance, portraitRef = `preset://${palId}/portrait-v1`, avatarRef = null, actionSheetRef = `preset://${palId}/actions-v1`, actionVideoRefs = {}, actionImageRefs = {}, entryVideoRef = null, entryPosterRef = null, outfits = [], live2dRef = null, vrmRef = null, standeeRef = null, tableStandeeRef = null, loungeStandeeRef = null, danceVideoRef = null, dancePosterRef = null }) {
  const outfitLibrary = outfits.map(createOutfit);
  const defaultLayers = outfitLibrary[0]?.layerSnapshot || { base: portraitRef, outfit: portraitRef };
  return validatePalAsset({
    contractVersion: CONTRACT_VERSION,
    palId,
    version: 1,
    readiness: 'READY',
    auditRecordId: `audit-official-${palId}-v1`,
    identity: { name, fictional: true, adultAppearance: true, aiLabel: 'AI 虚构角色' },
    appearance: { accent, outfit, dance, portraitRef, avatarRef, actionSheetRef, entryVideoRef, entryPosterRef, live2dRef, vrmRef, standeeRef, tableStandeeRef, loungeStandeeRef, danceVideoRef, dancePosterRef, layers: defaultLayers, ...(outfitLibrary.length ? { outfitLibrary } : {}) },
    actionPack: actionFrames(actionSheetRef, actionVideoRefs, actionImageRefs),
    dialoguePack: dialogueFor(name),
    performance: { mainTrack: actionVideoRefs.A04 || actionSheetRef, fallbackTrack: `preset://${palId}/dance-skeletal-v1` },
    fallback: { actionLevel: 'L2', reason: '主动作资源缺失时使用审核过的 L2 备轨。' }
  });
}

export function selectPresentation(asset, requestedAction) {
  validatePalAsset(asset);
  return asset.actionPack[requestedAction] ? { level: 'L1', ref: asset.actionPack[requestedAction] } : { level: asset.fallback.actionLevel, ref: 'static-pose' };
}

export function selectAppearancePresentation(asset) {
  validatePalAsset(asset);
  const { live2dRef, vrmRef, layers, portraitRef } = asset.appearance;
  if (live2dRef) return { level: 'L1', kind: 'live2d', ref: live2dRef };
  if (vrmRef) return { level: 'L1', kind: 'vrm', ref: vrmRef };
  if (layers?.base && layers?.outfit) return { level: 'L2', kind: 'layered', ref: layers };
  return { level: 'L3', kind: 'static', ref: portraitRef };
}
