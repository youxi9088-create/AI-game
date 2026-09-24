/* 已确认牌友名册回正（2026-09-18）。
   上一轮手工把 confirmed-pals.json 的多个引用改到未登记、未验收的 -single/-cutout 变体。
   本脚本把可溯源的管线产物（任务记录含 sha256）接回运行时：
   - 墨鸢：立绘/资料卡/海报全部回正到管线透明底产物，并补上五态 videoRef/imageRef 接线；
   - 星恒：资料卡回正到管线总图；牌桌/大厅立绘与头像暂保留 ad-hoc 干净版
     （管线对应槽误产了总图，已在注册表 taskOverrides 标 REJECTED_COMPOSITION）；
   - 两人的五态静态图都来自启动时补拆的 derivedImages（AWAITING_REVIEW）。
   幂等：已一致的字段不再改写。 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const path = join(root, 'apps/api/data/confirmed-pals.json');
const data = JSON.parse(await readFile(path, 'utf8'));

const MOYAN = '5fe85ced-2ef0-48ec-af65-90cdf3e0fc82';
const XINGHENG = 'd508cede-74ee-446a-9eac-feb2a581d7d0';
const ref = (planId, name) => `/assets/pals/ugc/${planId}-${name}`;
const ACTIONS = ['A01', 'A02', 'A03', 'A04', 'A05'];
const changes = [];
function set(owner, obj, key, value) {
  if (!obj) return;
  if (obj[key] !== value) { changes.push(`${owner} ${key}: ${obj[key] ?? '(null)'} -> ${value}`); obj[key] = value; }
}

for (const pal of data.pals) {
  const a = pal.appearance || {};
  if (pal.palId === 'pal-user-2632-v100') {
    const owner = '墨鸢';
    set(owner, a, 'portraitRef', ref(MOYAN, 'master-portrait.png'));
    set(owner, a, 'referenceCardRef', ref(MOYAN, 'master-portrait.png'));
    set(owner, a, 'standeeRef', ref(MOYAN, 'lounge-standee.png'));
    set(owner, a, 'tableStandeeRef', ref(MOYAN, 'table-standee.png'));
    set(owner, a, 'loungeStandeeRef', ref(MOYAN, 'lounge-standee.png'));
    set(owner, a, 'dancePosterRef', ref(MOYAN, 'outfit-poster.png'));
    if (a.layers) set(owner, a.layers, 'base', ref(MOYAN, 'master-portrait.png'));
    const snap = a.outfitLibrary?.[0]?.layerSnapshot;
    if (snap) {
      set(owner, snap, 'base', ref(MOYAN, 'master-portrait.png'));
      set(owner, snap, 'cardPoster', ref(MOYAN, 'outfit-poster.png'));
    }
    for (const action of ACTIONS) {
      const pack = pal.actionPack?.[action];
      if (!pack) continue;
      set(owner, pack, 'videoRef', ref(MOYAN, `action-${action.toLowerCase()}.mp4`));
      set(owner, pack, 'imageRef', ref(MOYAN, `action-sheet-${action}.png`));
    }
  }
  if (pal.palId === 'pal-user-5079-v103') {
    const owner = '星恒';
    set(owner, a, 'portraitRef', ref(XINGHENG, 'master-portrait.png'));
    set(owner, a, 'referenceCardRef', ref(XINGHENG, 'master-portrait.png'));
    /* 2026-09-18 用户交付横版入场片（星恒-开场.mp4），替换管线旧版入场视频；
       旧版保留在任务记录中（SOURCE_ONLY）。 */
    set(owner, a, 'entryVideoRef', ref(XINGHENG, 'entry-film-v2.mp4'));
    set(owner, a, 'entryPosterRef', ref(XINGHENG, 'entry-poster-v2.jpg'));
    /* 2026-09-19 管线重产成功：大厅/牌桌专用单人透明立绘（此前管线误产总图、
       ad-hoc 胸像临时挂账）。立绘与换装背板统一接线到重产任务文件。 */
    set(owner, a, 'standeeRef', ref(XINGHENG, 'lounge-standee.png'));
    set(owner, a, 'tableStandeeRef', ref(XINGHENG, 'table-standee.png'));
    set(owner, a, 'loungeStandeeRef', ref(XINGHENG, 'lounge-standee.png'));
    if (a.layers) set(owner, a.layers, 'base', ref(XINGHENG, 'table-standee.png'));
    const snap = a.outfitLibrary?.[0]?.layerSnapshot;
    if (snap) set(owner, snap, 'base', ref(XINGHENG, 'table-standee.png'));
    /* 首套写真卡面：早期 first-outfit 固定模板产出的是黑裙，与资料卡蓝西装不一致；
       2026-09-19 改为从她自己的演出视频（蓝西装）安全尾帧取同源卡面。 */
    if (a.layers) set(owner, a.layers, 'outfit', ref(XINGHENG, 'first-outfit-v2.jpg'));
    if (snap) set(owner, snap, 'outfit', ref(XINGHENG, 'first-outfit-v2.jpg'));
    /* 管线 outfit-fx 误产为五姿势人物拼版（不是特效层，污染导出与换装定格）；
       2026-09-20 从 layers.effect 撤下，槽位如实标记 REJECTED_COMPOSITION。 */
    if (a.layers) set(owner, a.layers, 'effect', null);
    if (snap) set(owner, snap, 'effect', null);
    for (const action of ACTIONS) {
      const pack = pal.actionPack?.[action];
      if (!pack) continue;
      set(owner, pack, 'videoRef', ref(XINGHENG, `action-${action.toLowerCase()}.mp4`));
      set(owner, pack, 'imageRef', ref(XINGHENG, `action-sheet-${action}.png`));
    }
  }
}

if (changes.length) {
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  console.log(`reconciled ${changes.length} refs:`);
  for (const line of changes) console.log(' ', line);
} else {
  console.log('already reconciled');
}
