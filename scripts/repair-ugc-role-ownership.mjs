import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataRoot = join(repo, 'apps/api/data');

const sweetId = 'pal-user-5441-v105';
const dainaId = 'pal-user-daina-v104';
const sweetRoot = '/assets/pals/ugc/甜美卷发小甜甜';
const dainaRoot = '/assets/pals/ugc/代娜';
const oldStem = `${sweetRoot}/4580b022-69a7-406a-8513-21781466b452-`;
const sweetPortrait = `${sweetRoot}/xiaotiantian-portrait.png`;

const ownershipMoves = new Map([
  [`${oldStem}master-portrait.png`, `${dainaRoot}/daina-alt-master-portrait.png`],
  [`${oldStem}avatar.jpg`, `${dainaRoot}/daina-alt-avatar.jpg`],
  [`${oldStem}lounge-standee.png`, `${dainaRoot}/daina-alt-lounge-standee.png`],
  [`${oldStem}table-standee.png`, `${dainaRoot}/daina-alt-table-standee.png`],
  [`${oldStem}entry-film.mp4`, `${dainaRoot}/daina-alt-entry-film.mp4`],
  [`${oldStem}first-outfit.jpg`, `${dainaRoot}/daina-alt-first-outfit.jpg`],
  [`${oldStem}outfit-film.mp4`, `${dainaRoot}/daina-alt-outfit-film.mp4`],
  [`${oldStem}outfit-fx.png`, `${dainaRoot}/daina-alt-outfit-fx.png`],
  [`${oldStem}outfit-poster.jpg`, `${dainaRoot}/daina-alt-outfit-poster.jpg`],
  [`${oldStem}outfit-poster.png`, `${dainaRoot}/daina-alt-outfit-poster.png`],
  ...Array.from({ length: 5 }, (_, index) => {
    const key = `A0${index + 1}`;
    return [`${oldStem}action-image-${key}.png`, `${dainaRoot}/daina-alt-action-image-${key}.png`];
  })
]);

function replaceOwnershipRefs(value) {
  if (typeof value === 'string') return ownershipMoves.get(value) || value;
  if (Array.isArray(value)) return value.map(replaceOwnershipRefs);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceOwnershipRefs(item)]));
}

function actionPack({ imageStem, videoStem = null }) {
  const actions = ['idle', 'play', 'pass', 'win', 'lose'];
  return Object.fromEntries(actions.map((action, index) => {
    const key = `A0${index + 1}`;
    return [key, {
      action,
      sheetRef: null,
      frame: [index % 3, Math.floor(index / 3)],
      videoRef: videoStem ? `${videoStem}${String(index + 1).padStart(2, '0')}.webm` : null,
      imageRef: imageStem === sweetPortrait ? sweetPortrait : `${imageStem}${key}.png`
    }];
  }));
}

const confirmedPath = join(dataRoot, 'confirmed-pals.json');
const confirmed = replaceOwnershipRefs(JSON.parse(await readFile(confirmedPath, 'utf8')));
const sweet = confirmed.pals.find((pal) => pal.palId === sweetId);
if (!sweet) throw new Error(`Missing confirmed pal ${sweetId}`);

sweet.appearance = {
  ...sweet.appearance,
  portraitRef: sweetPortrait,
  referenceCardRef: null,
  avatarRef: sweetPortrait,
  standeeRef: sweetPortrait,
  tableStandeeRef: sweetPortrait,
  loungeStandeeRef: sweetPortrait,
  actionSheetRef: null,
  entryVideoRef: null,
  danceVideoRef: null,
  dancePosterRef: sweetPortrait,
  layers: { base: sweetPortrait, outfit: sweetPortrait, effect: null },
  outfitLibrary: []
};
sweet.actionPack = actionPack({ imageStem: sweetPortrait, videoStem: `${sweetRoot}/4580b022-69a7-406a-8513-21781466b452-action-a` });
sweet.performance = { ...sweet.performance, mainTrack: null, fallbackTrack: 'preset://production/dance-skeletal' };
sweet.fallback = { actionLevel: 'L2', reason: '仅启用已核验属于甜美卷发小甜甜的透明五态动作；错属代娜的静态与演出资源已撤销。' };

const daina = {
  ...structuredClone(sweet),
  palId: dainaId,
  version: 104,
  auditRecordId: 'audit-ownership-correction-daina-v104',
  profileCard: {
    ...structuredClone(sweet.profileCard),
    character: {
      name: '代娜',
      brief: '成年虚构牌友，深色轻奢礼服与猫耳发饰，沉稳而自信。',
      adultAppearance: true,
      fictional: true
    },
    clothing: { id: 'dark-evening-dress', label: '深色轻奢礼服', prompt: 'dark elegant evening dress with restrained gold details' },
    accessory: { id: 'cat-ears', label: '猫耳朵发饰', prompt: 'tasteful cat-ear headband integrated into the hairstyle' }
  },
  identity: { name: '代娜', fictional: true, adultAppearance: true, aiLabel: 'AI 虚构角色（真实图像产物）' },
  appearance: {
    ...structuredClone(sweet.appearance),
    outfit: '深色轻奢礼服 · 猫耳朵发饰',
    portraitRef: `${dainaRoot}/daina-alt-master-portrait.png`,
    referenceCardRef: `${dainaRoot}/daina-alt-master-portrait.png`,
    avatarRef: `${dainaRoot}/daina-alt-avatar.jpg`,
    standeeRef: `${dainaRoot}/daina-alt-lounge-standee.png`,
    tableStandeeRef: `${dainaRoot}/daina-alt-table-standee.png`,
    loungeStandeeRef: `${dainaRoot}/daina-alt-lounge-standee.png`,
    entryVideoRef: `${dainaRoot}/daina-alt-entry-film.mp4`,
    danceVideoRef: `${dainaRoot}/daina-alt-outfit-film.mp4`,
    dancePosterRef: `${dainaRoot}/daina-alt-outfit-poster.jpg`,
    layers: {
      base: `${dainaRoot}/daina-alt-master-portrait.png`,
      outfit: `${dainaRoot}/daina-alt-first-outfit.jpg`,
      effect: `${dainaRoot}/daina-alt-outfit-fx.png`
    },
    outfitLibrary: [{
      outfitId: 'starter-look',
      name: '深色轻奢礼服 · 猫耳朵发饰',
      dance: '预设节拍',
      auditRecordId: 'audit-ownership-correction-daina-v104',
      layerSnapshot: {
        base: `${dainaRoot}/daina-alt-master-portrait.png`,
        outfit: `${dainaRoot}/daina-alt-first-outfit.jpg`,
        effect: `${dainaRoot}/daina-alt-outfit-fx.png`,
        cardVideo: `${dainaRoot}/daina-alt-outfit-film.mp4`,
        cardPoster: `${dainaRoot}/daina-alt-outfit-poster.jpg`
      }
    }]
  },
  actionPack: actionPack({ imageStem: `${dainaRoot}/daina-alt-action-image-` }),
  performance: { mainTrack: `${dainaRoot}/daina-alt-outfit-film.mp4`, fallbackTrack: 'preset://production/dance-skeletal' },
  fallback: { actionLevel: 'L1', reason: '静态五态图可用；透明动作 WebM 尚未归入本角色。' }
};
confirmed.pals = confirmed.pals.filter((pal) => pal.palId !== dainaId);
confirmed.pals.push(daina);
await writeFile(confirmedPath, `${JSON.stringify(confirmed, null, 2)}\n`, 'utf8');

const galleryPath = join(dataRoot, 'gallery.json');
const gallery = replaceOwnershipRefs(JSON.parse(await readFile(galleryPath, 'utf8')));
gallery.player = (gallery.player || []).filter((card) => card.palId !== sweetId && card.palId !== dainaId);
gallery.player.push({
  cardId: `${dainaId}:starter-look`,
  palId: dainaId,
  outfitId: 'starter-look',
  outfitName: '深色轻奢礼服 · 猫耳朵发饰',
  dance: '预设节拍',
  layerSnapshot: structuredClone(daina.appearance.outfitLibrary[0].layerSnapshot),
  serialNo: Math.max(0, ...gallery.player.map((card) => Number(card.serialNo) || 0)) + 1,
  rarity: 'first',
  upgradeLevel: 1,
  seen: false,
  unlockedAt: new Date().toISOString(),
  auditRecordId: daina.auditRecordId,
  gameStats: { multiplier: 1, rounds: 0, lastCombo: '' }
});
await writeFile(galleryPath, `${JSON.stringify(gallery, null, 2)}\n`, 'utf8');

const taskPath = join(dataRoot, 'pal-resource-tasks.json');
const taskState = replaceOwnershipRefs(JSON.parse(await readFile(taskPath, 'utf8')));
for (const task of taskState.tasks || []) {
  const urls = [task.publicUrl, task.alphaPreviewUrl].filter(Boolean);
  if (!urls.some((url) => String(url).startsWith(`${dainaRoot}/daina-alt-`))) continue;
  task.assetOwner = '代娜';
  task.ownershipCorrection = '资源人工核验属于代娜；已从甜美卷发小甜甜目录迁出。';
}
await writeFile(taskPath, `${JSON.stringify(taskState, null, 2)}\n`, 'utf8');

const officialPath = join(dataRoot, 'official-assets.json');
const official = JSON.parse(await readFile(officialPath, 'utf8'));
official.assets = (official.assets || []).filter((asset) => asset.id !== 'ugc-xiaotiantian-video-frame-portrait');
official.assets.push({
  id: 'ugc-xiaotiantian-video-frame-portrait',
  palId: sweetId,
  outfitId: null,
  slot: 'portrait',
  action: 'idle',
  kind: 'image',
  publicUrl: sweetPortrait,
  file: 'assets/pals/ugc/甜美卷发小甜甜/xiaotiantian-portrait.png',
  source: {
    kind: 'derived-from-approved-video',
    detail: '从已核验属于甜美卷发小甜甜的 A01 透明 WebM 首帧确定性抽取，替代撤销的错属代娜静态图。'
  },
  acceptance: {
    status: 'APPROVED',
    note: '角色身份与 A01 动作一致；透明通道保留，供头像、牌桌和大厅展示降级共用。',
    reviewedAt: '2026-09-23'
  }
});
await writeFile(officialPath, `${JSON.stringify(official, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({
  status: 'repaired',
  sweetPal: sweetId,
  dainaPal: dainaId,
  movedOwnershipRefs: ownershipMoves.size,
  galleryCards: gallery.player.length
}, null, 2));
