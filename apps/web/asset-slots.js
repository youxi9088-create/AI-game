// One contract shared by the production plan and the runtime. Reference boards
// never act as a fallback for a display slot.
export const RESOURCE_SLOTS = Object.freeze({
  'master-portrait': { slot: 'reference', usage: '角色资料卡：工坊预览、用户确认与后续生产参考；保留完整资料，不直接用于主页或牌桌', layout: 'reference-board' },
  avatar: { slot: 'avatar', usage: '首页选座与角色列表头像：单人头肩像，单独文件', layout: 'single-headshot' },
  'lounge-standee': { slot: 'lounge', usage: '主页左右角色展示立绘：单人半身、透明背景', layout: 'single-half-body' },
  'table-standee': { slot: 'table', usage: '牌桌角色默认形象：单人半身、透明背景，统一位置与尺寸', layout: 'single-half-body' },
  'action-sheet': { slot: 'action-source', usage: '五态动作源拼图：仅作源文件；运行时加载拆出的五张独立单图，分别绑定牌桌事件，不显示整张拼图', layout: 'grid-3x2' },
  ...Object.fromEntries(['待机', '出牌', '不出', '胜利', '失败'].map((label, i) => [`action-image-A0${i + 1}`, { slot: `A0${i + 1}-fallback`, usage: `牌桌${label}事件的视频加载失败或降级时使用的独立透明静态图：单人、透明背景，不显示汇总拼图`, layout: 'single-half-body' }])),
  'entry-film': { slot: 'entry', usage: '角色进入牌局时的入场视频：播完回到牌桌立绘', layout: 'single-character-video' },
  'entry-poster': { slot: 'entry-poster', usage: '入场视频播放前、加载或播放失败时的封面：从对应视频取帧', layout: 'video-frame' },
  'first-outfit': { slot: 'outfit-card', usage: '服装写真卡面：解锁卡牌、写真馆与 PNG 导出；单人完整卡面，按服装编号绑定', layout: 'single-card' },
  'outfit-film': { slot: 'outfit-video', usage: '结算演出与对应卡牌回放视频：与同一服装卡面一一对应', layout: 'single-character-video' },
  'outfit-poster': { slot: 'outfit-poster', usage: '演出视频播放前、加载或播放失败时的封面：从对应视频取帧', layout: 'video-frame' },
  'outfit-fx': { slot: 'outfit-effect', usage: '指定服装演出叠加特效层：只含特效，不能拿人物图替代', layout: 'effect-only' },
  ...Object.fromEntries(['待机', '出牌', '不出', '胜利', '失败'].map((label, i) => [`action-a0${i + 1}`, { slot: `A0${i + 1}`, usage: `牌桌${label}事件：一种状态对应一个视频，拆分静态图作为回退`, layout: 'single-character-video' }]))
});

export function displayAsset(pal, slot) {
  const appearance = pal?.appearance || {};
  const field = { avatar: 'avatarRef', lounge: 'loungeStandeeRef', table: 'tableStandeeRef', entry: 'entryVideoRef' }[slot];
  const ref = appearance[field];
  if (ref && ref !== appearance.referenceCardRef && ref !== appearance.actionSheetRef) return ref;
  // Official legacy portraits are explicitly authored single-character assets.
  if (!pal?.palId?.startsWith('pal-user-')) return slot === 'avatar' ? appearance.portraitRef : appearance.standeeRef;
  return null;
}
