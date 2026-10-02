import { studioMarkup, collectionMarkup, exportPhoto } from './photo-studio.js';
import { npcDelay, prefs, SPEED_LABEL, cycleSpeed, setPref } from './runtime.js';
import { sfx, primeAudio, playCardAudio, updateAudioScene, syncAudio } from './sfx.js';
import { RESOURCE_SLOTS, displayAsset } from './asset-slots.js';

const validRoutes = new Set(['home', 'table', 'workshop', 'gallery', 'inspector']);
const routeFromHash = () => validRoutes.has(location.hash.replace(/^#\//, '')) ? location.hash.replace(/^#\//, '') : 'home';
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const state = {
  route: routeFromHash(), game: null, selected: new Set(), workshop: null, workshopError: '', workshopPrompt: '', workshopName: '', workshopVideoReferenceUrl: '', workshopClothing: 'described', workshopAccessory: 'none', workshopTier: 'launch', workshopBusy: false, workshopJob: null, workshopPoller: null, workshopTaskPlanFilter: '',
  replay: null, entry: false, npcTimer: null,
  pals: [], palIndex: {}, defaultSeats: null, seats: null, walletBalance: 100, galleryCards: [], galleryTab: 'all', galleryQuick: null,
  detail: null, detailReturnCard: null, imagePreview: null, resourcePlanDetail: null, flownFor: null, sfxFiredFor: null,
  collection: null, studioGame: null, photoDraft: null,
  closeup: null, closeupKey: null, closeupTimer: null
};
const WORKSHOP_CLOTHING_OPTIONS = [
  ['described', '按文字描述'], ['maid', '优雅女仆装'], ['flight-attendant', '空姐制服风'], ['cheongsam', '现代改良旗袍'], ['racing', '摩登赛车夹克'], ['evening', '黑曜石晚宴礼服']
];
const WORKSHOP_ACCESSORY_OPTIONS = [
  ['none', '无'], ['bunny-ears', '兔耳朵发饰'], ['cat-ears', '猫耳朵发饰'], ['pearl', '珍珠耳饰'], ['ribbon', '丝带发饰']
];
try { state.seats = JSON.parse(localStorage.getItem('dressbattle.preferred-seats') || 'null'); } catch { state.seats = null; }
const app = document.querySelector('#app');
const toast = document.querySelector('#toast');
const api = async (path, options = {}) => {
  const response = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || '请求失败');
  return payload;
};
const commandId = () => crypto.randomUUID();
function notice(message, bad = false) { toast.textContent = message; toast.className = `toast show${bad ? ' bad' : ''}`; clearTimeout(notice.timer); notice.timer = setTimeout(() => { toast.className = 'toast'; }, 3200); }
function escape(text = '') { return String(text).replace(/[&<>"']/g, (s) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[s])); }
/* 视频源必须声明与真实容器一致的 mime：<source type> 对不上时浏览器会**静默跳过**这一源，
   表现是「视频不播、控制台也不报错」。现在 webm（alpha 主轨）与 mp4（竖屏写真）混用，
   所以类型必须从扩展名推导，不能再写死。 */
const videoMime = (ref = '') => (/\.webm(\?|#|$)/i.test(ref) ? 'video/webm' : 'video/mp4');
const videoSource = (ref) => `<source src="${escape(ref)}" type="${videoMime(ref)}" />`;
/* 竖屏写真视频是 4:7，而卡面与结算舞台的规范是 3:4。硬套 cover 会把全身舞动的头脚切掉，
   所以主体一律 contain 完整放进框里，两侧空出来的部分用**同一帧**的放大虚化版铺满。
   虚化层用 poster 静帧而不是第二路视频：blur(26px) 之后动与不动肉眼分不出来，
   但省掉一路解码。缺 poster 时退回纯色底，不阻塞。 */
function letterboxVideo({ src, poster = null, label, className = '', autoplay = true, preload = 'metadata', settle = false, controls = false, replay = false, sound = false }) {
  /* 当前米娅三段为生成舞蹈片：源片右下有生成来源角标。运行时只覆盖该非叙事角落，
     角色、舞蹈与舞台主体完全保留；poster 的同区域也在 make-dance-assets 阶段同步收光。 */
  const generatedFilm = /\/mia-(sporty-sweetheart|mint-soiree|executive-beat)-v1\.mp4(?:\?|#|$)/.test(src);
  const backdrop = poster
    ? `<img class="vframe-blur" src="${escape(poster)}" alt="" aria-hidden="true" />`
    : '<span class="vframe-blur plain" aria-hidden="true"></span>';
  const still = poster ? ` poster="${escape(poster)}"` : '';
  const play = autoplay && !reducedMotion() ? ' autoplay' : '';
  const controlBar = controls ? ' controls' : '';
  const replayData = replay ? ' data-replay-video' : '';
  /* 全屏跳舞页由玩家点击触发，允许有声播放（sound:true）；其余场景维持静音自动播放。 */
  const mute = sound ? '' : ' muted';
  /* settle 标记只加在演出舞台上：那段视频播完/出错要换成 L2 分层图，卡面则不需要。 */
  const flag = settle ? ' data-settlement-video' : '';
  return `<div class="vframe ${className}${generatedFilm ? ' generated-film' : ''}">${backdrop}<video class="vframe-main"${flag}${replayData}${play}${controlBar}${mute} playsinline preload="${preload}"${still} aria-label="${escape(label)}">${videoSource(src)}</video></div>`;
}
/* 降级：视频不可用（缺资源或玩家要求减弱动态）时，同一个信箱式框里放 poster 静帧，
   画面构图与视频一致，所以降级不会被玩家看出是「坏了」。 */
function letterboxStill({ poster, label, className = '' }) {
  return `<div class="vframe ${className}"><img class="vframe-blur" src="${escape(poster)}" alt="" aria-hidden="true" /><img class="vframe-main" src="${escape(poster)}" alt="${escape(label)}" /></div>`;
}
function updateToken() { document.querySelector('#tokenBalance').textContent = `◇ ${state.game?.tokenBalance ?? state.walletBalance ?? 100} Token`; }
function applyPrefs() {
  const current = prefs();
  const speedLabel = document.querySelector('#speedLabel');
  if (speedLabel) speedLabel.textContent = SPEED_LABEL[current.speed] || '标准';
  const sfxButton = document.querySelector('[data-action="toggle-sfx"]');
  if (sfxButton) {
    sfxButton.setAttribute('aria-pressed', String(current.sfx));
    sfxButton.classList.toggle('off', !current.sfx);
  }
  const sfxLabel = document.querySelector('#sfxLabel');
  if (sfxLabel) sfxLabel.textContent = current.sfx ? '音效开' : '音效关';
  document.documentElement.dataset.speed = current.speed;
}
function rank(card) { return card.replace(/[♣♦♥♠]/g, ''); }
function suit(card) { return card.match(/[♣♦♥♠]/)?.[0] || ''; }
function card(card, selected = false, disabled = false) { const red = /[♦♥]/.test(card); return `<button class="card ${red ? 'red' : ''} ${selected ? 'selected' : ''}" data-card="${card}" aria-pressed="${selected}"${disabled ? ' disabled aria-disabled="true"' : ''}><b>${rank(card)}</b><small>${suit(card)}</small></button>`; }
function tableCard(value) { const red = /[♦♥]/.test(value); return `<div class="table-card ${red ? 'red' : ''}" role="img" aria-label="桌面牌 ${value}"><b>${rank(value)}</b><small>${suit(value)}</small></div>`; }

/* ---------- pal assets & layered appearance ---------- */
const palName = (palId) => state.palIndex[palId]?.identity?.name || ({ player: '你' })[palId] || palId;
/* 座位由服务端下发，前端不再假设上桌的一定是林星和米娅。缺省值只在快照异常时兜底，
   正常路径永远走 game.seats。 */
const seatIdsOf = (game) => (Array.isArray(game.seats) && game.seats.length === 2 ? game.seats : state.defaultSeats || ['pal-linxing', 'pal-mia']);
/* 出牌锚点按「座位位置」而非 palId 命名：牌桌只有一套坐标系，
   为每一个自定义牌友单独写一套 top/left 既不可能维护，也会立刻互相冲突。 */
const seatKeyOf = (game, playerId) => {
  if (playerId === 'player') return 'player';
  const seats = seatIdsOf(game);
  if (seats[0] === playerId) return 'top';
  if (seats[1] === playerId) return 'right';
  return 'player';
};
function latestOutfitFor(palId) {
  const pal = state.palIndex[palId];
  const library = pal?.appearance?.outfitLibrary || [];
  const unlocked = state.galleryCards.filter((entry) => entry.palId === palId);
  const latest = unlocked[unlocked.length - 1];
  return library.find((entry) => entry.outfitId === latest?.outfitId) || library[0] || null;
}
function palStandee(palId, variant = '', action = null) {
  const pal = state.palIndex[palId];
  if (!pal) return '';
  const name = pal.identity.name;
  const alt = `${name}，成年虚构 AI 牌友，${pal.appearance.outfit}`;
  const outfit = latestOutfitFor(palId);
  const layers = outfit?.layerSnapshot || pal.appearance.layers;
  /* L2 牌桌是半身镜头：若资产专门给了 tableStandeeRef，优先用它；大厅仍保留
     standeeRef 的完整身。不能只靠 CSS scale，把全身强行放大只会让头脚被牌桌裁掉。 */
  /* L1 首页主视觉、L2 牌桌半身与默认全身立绘是三种不同镜头：
     有专用资源时按镜头读取，缺省始终自然回退完整 standee。 */
  const isTable = variant.includes('table-seat');
  const standeeRef = displayAsset(pal, isTable ? 'table' : 'lounge');
  const actionKey = action || 'A01';
  const actionAsset = isTable ? pal.actionPack?.[actionKey] : null;
  const label = ({ A01: '待机', A02: '出牌', A03: '过牌', A04: '胜利', A05: '失败' })[actionKey];
  /* 已被目检打回的透明动作绝不能继续覆盖牌桌立绘。此前只要 WebM
     带 ALPHA_MODE=1 就播放，导致灰白底板和不合格动作仍被玩家看到。
     打回后回退到已验收的牌桌立绘；不能退到同样未验收的白底动作图。 */
  const actionRejected = actionAsset?.alphaVisualApproved === false;
  const videoRef = !actionRejected ? actionAsset?.videoRef || null : null;
  const videoMotion = videoRef ? `<video class="action-video" autoplay muted playsinline preload="metadata" aria-label="${alt}，${label}动作">${videoSource(videoRef)}</video>` : '';
  const actionImage = !actionRejected ? actionAsset?.imageRef : null;
  /* 五态拼图只作源文件：运行时只加载拆出的单张动作图（或动作视频），不再用整张拼图的 CSS sprite。 */
  const actionStill = !videoRef && actionImage ? `<img class="layer layer-action" src="${escape(actionImage)}" alt="${escape(name)}，${label}动作" />` : '';
  if (standeeRef) {
    return `<div class="pal-avatar pal-standee cutout ${palId} ${variant} ${videoRef ? 'with-video' : ''}" data-pal="${palId}">
    <img class="layer layer-base" src="${standeeRef}" width="600" height="750" alt="${alt}" />
    ${videoMotion || actionStill}<div class="pal-caption"><strong>${name}</strong><i>AI 虚构成年</i></div></div>`;
  }
  if (palId.startsWith('pal-user-')) return `<div class="pal-avatar pal-standee ${variant}" data-pal="${escape(palId)}"><p role="status">${escape(name)} · ${isTable ? '牌桌' : '大厅'}立绘待验收</p></div>`;
  return `<div class="pal-avatar pal-standee ${palId} ${variant} ${videoRef ? 'with-video' : ''}" data-pal="${palId}">
    <img class="layer layer-base" src="${layers.base}" width="600" height="800" alt="${alt}" aria-hidden="false" />
    ${layers.outfit && layers.outfit !== layers.base ? `<img class="layer layer-outfit" src="${layers.outfit}" width="600" height="800" alt="" aria-hidden="true" />` : ''}
    ${videoMotion || actionStill}<div class="pal-caption"><strong>${name}</strong><i>AI 虚构成年</i></div></div>`;
}
function eventText(event) {
  const name = palName(event.playerId) || '牌局';
  if (event.type === 'PLAY_ACCEPTED') return `${name}出牌：${(event.cards || []).join(' ')}。${event.dialogue || ''}`;
  if (event.type === 'PAL_ACTION' && event.decision === 'PLAY') return `${name}压制：${(event.cards || []).join(' ')}。${event.dialogue || ''}`;
  if (event.type === 'PAL_ACTION' && event.decision === 'PASS') return `${name}不出。${event.dialogue || ''}`;
  if (event.type === 'PLAYER_PASS') return '你选择不出。';
  if (event.type === 'BID_CALL') return `${palName(event.playerId)}${event.score === 0 ? '不叫' : `叫 ${event.score} 分`}。`;
  if (event.type === 'BID_GRAB') return `${palName(event.playerId)}${event.accepted ? '抢地主' : '不抢'}。`;
  if (event.type === 'BID_REDEAL') return event.message;
  if (event.type === 'BID_RESOLVED') return event.dialogue;
  return event.dialogue || event.message || event.type;
}
/* 入场段必须从**本局实际 seats**推导。此前这里写死「林星 → 米娅」两支视频：换银岚
   上桌后，字幕虽然会显示新名字，画面却仍是米娅，属于表现层把服务端座位事实丢掉。
   优先 entryVideoRef；银岚现有独立横版入场片，不再占用她的竖屏写真舞片。 */
function entrySegments() {
  return seatIdsOf(state.game).map((palId) => {
    const pal = state.palIndex[palId];
    const ref = pal?.appearance?.entryVideoRef || null;
    if (!pal || !ref) return null;
    /* 入场是牌局开场的全屏横版演出。竖版写真/跳舞片只能用于写真馆，不得占用
       entryVideoRef；生产线会在落盘时拒绝非 16:9 的入场成片。 */
    return {
      palId,
      name: pal.identity.name,
      dance: pal.appearance.dance,
      ref,
      poster: pal.appearance.entryPosterRef || null
    };
  }).filter(Boolean);
}
function entryCinematic() {
  const segments = entrySegments();
  if (!segments.length) return '';
  const first = segments[0];
  const videoHtml = segments.map((segment, index) => {
    const backdrop = segment.poster ? `<img class="entry-backdrop" src="${escape(segment.poster)}" alt="" aria-hidden="true" />` : '';
    return `<div class="entry-segment${index === 0 ? ' show' : ''}" data-entry-seg data-pal="${escape(segment.palId)}" data-entry-name="${escape(segment.name)}" data-entry-dance="${escape(segment.dance)}">${backdrop}<video${index === 0 ? ' autoplay' : ''} muted playsinline preload="${index === 0 ? 'auto' : 'metadata'}" aria-hidden="true">${videoSource(segment.ref)}</video></div>`;
  }).join('');
  return `<section class="entry-cinematic" role="dialog" aria-modal="true" aria-labelledby="entry-title">${videoHtml}<p class="entry-kicker">今夜入席</p><div class="entry-caption" data-entry-caption><b>${escape(first.name)}</b><span>${escape(first.dance)} · 已就位</span></div><h2 id="entry-title" class="sr-only">本局牌友依次入场</h2><button class="entry-skip" data-action="close-entry">跳过入场 ⏎</button></section>`;
}

/* ---------- seat picker: who sits down tonight ---------- */
/* 选定座位，缺省用服务端给的官方组合；名册里找不到（比如牌友被移除）就退回缺省。 */
const chosenSeats = () => {
  const fallback = state.defaultSeats || ['pal-linxing', 'pal-mia'];
  const seats = Array.isArray(state.seats) && state.seats.length === 2 ? state.seats : null;
  return seats && seats.every((id) => state.palIndex[id]) ? seats : fallback;
};
function cycleSeat(index) {
  const ids = state.pals.map((pal) => pal.palId);
  if (ids.length < 2) return;
  const seats = [...chosenSeats()];
  const other = seats[1 - index];
  const at = ids.indexOf(seats[index]);
  /* 两个座位不能是同一个人：同一副手牌被两个人持有会直接破坏牌面守恒。 */
  for (let step = 1; step <= ids.length; step += 1) {
    const candidate = ids[(at + step + ids.length) % ids.length];
    if (candidate !== other) { seats[index] = candidate; savePreferredSeats(seats); return; }
  }
}
function savePreferredSeats(seats) {
  state.seats = [...seats];
  try { localStorage.setItem('dressbattle.preferred-seats', JSON.stringify(state.seats)); } catch { /* selection still applies for this page session */ }
}
function seatCard(palId, index) {
  const pal = state.palIndex[palId];
  const name = pal?.identity?.name || palId;
  /* 选人卡是“今晚谁入席”的名册入口：头像要与首页主视觉同层级，文案只说来源。
     五态动作包属于牌局中的表现能力，不能把它折算成选人卡上的“静态肖像”标签；
     否则银岚明明有入场和舞台视频，却在玩家最先看到的位置被错误降级。 */
  const faceRef = displayAsset(pal, 'avatar') || '';
  const fromWorkshop = /^pal-user-/.test(palId) || /^audit-(production|mock)-/.test(pal?.auditRecordId || '');
  const origin = fromWorkshop ? '自定义牌友' : '官方牌友';
  const face = faceRef.startsWith('/assets/')
    ? `<img class="seat-face" src="${faceRef}" alt="${escape(name)}的肖像" />`
    : `<span class="seat-face preset missing" style="background:${pal?.appearance?.accent || '#7f77dd'}" role="img" aria-label="${escape(name)}的头像待生产" title="头像待生产"><i>待生产</i></span>`;
  return `<button class="seat-slot" data-action="cycle-seat" data-index="${index}" aria-label="更换${escape(name)}">
    ${face}<b>${escape(name)}</b><span>${origin}</span></button>`;
}
function seatPicker() {
  if (state.pals.length < 3) return '';
  const seats = chosenSeats();
  return `<div class="seat-picker"><p class="seat-picker-label">今晚入席 · 点击可换人</p><div class="seat-slots">${seatCard(seats[0], 0)}${seatCard(seats[1], 1)}</div></div>`;
}

/* ---------- L3 回合特写 ---------- */
/* 特写不是常驻 UI，是一次「切镜」：服务端在事件上带了 closeup（哪些瞬间值得切镜由
   packages/performance-core 的纯函数判定），前端只负责把它演出来并按 durationMs 收镜。
   前端不自己判断「什么算大牌」——那会让两份规则各说各话。 */
function syncCloseup(game) {
  const latest = (game.events || []).filter((event) => event.closeup).pop() || null;
  if (!latest) { state.closeup = null; state.closeupKey = null; return; }
  const key = `${game.id}:${latest.seq}`;
  if (key === state.closeupKey) return;
  state.closeupKey = key;
  state.closeup = latest.closeup;
  clearTimeout(state.closeupTimer);
  state.closeupTimer = setTimeout(() => { state.closeup = null; render(); }, latest.closeup.durationMs || 1800);
}
function closeupMarkup(closeup) {
  const pal = state.palIndex[closeup.palId];
  if (!pal) return '';
  const name = pal.identity.name;
  /* 回合特写走头像槽（单人头肩像），资料卡/参考总图绝不上牌桌；缺槽时显式占位，不静默用整图。 */
  const avatar = displayAsset(pal, 'avatar') || '';
  const face = avatar.startsWith('/assets/')
    ? `<img src="${avatar}" alt="${escape(name)}的特写" />`
    : `<span class="closeup-initial" style="background:${pal.appearance?.accent || '#7f77dd'}" role="img" aria-label="${escape(name)}的头像待生产">✦</span>`;
  return `<aside class="closeup tone-${closeup.tone}" role="status" aria-live="polite" data-closeup>
    <span class="closeup-portrait">${face}</span>
    <span class="closeup-copy"><b>${escape(name)}</b><i>${escape(closeup.label)}</i><span>${escape(closeup.dialogue)}</span></span>
  </aside>`;
}

/* ---------- home ---------- */
function renderHome() {
  app.innerHTML = `<section class="lounge-home">
    <div class="lounge-scrim" aria-hidden="true"></div><p class="lounge-kicker">DRESSBATTLE CLUB · SOLO TABLE</p>
    <div class="lounge-character left">${palStandee(chosenSeats()[0], 'lounge-pal')}</div><div class="lounge-character right">${palStandee(chosenSeats()[1], 'lounge-pal')}</div>
    <div class="lounge-copy"><p class="eyebrow">今晚的牌局 · 两位 AI 牌友已入席</p><h1>月光落桌，<br/><span>以牌会友。</span></h1><p>赢一局，解锁或升级写真。看完演出，亲手搭配、命名并定格，收藏属于你的作品。</p>${seatPicker()}<div class="hero-actions"><button class="primary lounge-cta" data-action="start">进入今晚牌局 <span>→</span></button><button class="secondary lounge-secondary" data-route="workshop">创建虚构牌友</button></div><p class="guard">当前 ${state.walletBalance ?? 100} Token · 开局消耗 1 Token，结算按倍率增加或扣减（余额不足扣至 0）· 不可购买、转赠或提现，无现金价值</p></div>
    <div class="lounge-brief"><div><b>01</b><span>服务端权威判定</span></div><div><b>02</b><span>逐位 AI 回合</span></div><div><b>03</b><span>现场换装与写真收集</span></div></div>
  </section>`;
}

/* ---------- A2 叫分 / 抢地主 ---------- */
/* 叫分只能往上盖：按钮集合由当前最高分推导，不给出会被服务端拒绝的选项。 */
function bidControls(game) {
  if (game.turn !== 'player') return `<span class="turn-wait" aria-live="polite">${Object.fromEntries(game.players.map((p) => [p.id, p]))[game.turn].name}正在叫分…</span>`;
  const high = game.bidding.highScore;
  if (game.bidding.stage === 'GRAB') {
    return `<button class="primary compact" data-action="grab" data-accept="1">抢地主（底分 ×${high * 2}）</button><button class="secondary compact" data-action="grab" data-accept="0">不抢</button>`;
  }
  const calls = [high + 1, high + 2, high + 3].filter((score) => score <= 3)
    .map((score) => `<button class="${score === 3 ? 'primary' : 'secondary'} compact" data-action="bid" data-score="${score}">叫 ${score} 分</button>`).join('');
  return `<button class="secondary compact" data-action="bid" data-score="0">不叫</button>${calls}`;
}
function biddingCopy(game) {
  const high = game.bidding.highScore;
  if (game.bidding.stage === 'GRAB') return `有人叫到 ${high} 分。你可以抢地主，底分翻倍到 ${high * 2} 分；不抢则由他当地主。`;
  return high ? `当前最高 ${high} 分。你可以叫更高的分抢下地主，或选择不叫。` : '三家依次叫分（1–3 分），分数最高者当地主；叫 3 分立即定地主，三家都不叫则重新发牌。';
}

/* ---------- table ---------- */
/* 牌桌主题由本局两名牌友的无序组合决定：默认林星+米娅保留月夜酒馆，
   其余两组各有明确主题。座位左右互换不会改变主题，避免同一组合开局时闪变。 */
function tableTheme(seats) {
  const key = [...seats].sort().join('|');
  return ({
    'pal-linxing|pal-mia': { id: 'moonlit-club', label: 'MOONLIT TABLE', name: '月夜酒馆' },
    'pal-linxing|pal-yinlan': { id: 'silver-court', label: 'SILVER COURT', name: '银月球场' },
    'pal-mia|pal-yinlan': { id: 'mint-neon', label: 'MINT NEON STAGE', name: '霓虹薄荷舞台' }
  })[key] || { id: 'moonlit-club', label: 'MOONLIT TABLE', name: '月夜酒馆' };
}
function renderTable() {
  const game = state.game;
  if (!game?.phase) { app.innerHTML = `<section class="empty"><h1>牌桌还没开局</h1><p>先在大厅创建一局引导牌，体验完整的首次收藏路径。</p><button class="primary" data-action="start">创建牌局</button></section>`; return; }
  const bidding = game.phase === 'BIDDING';
  const settled = game.phase === 'SETTLED';
  const players = Object.fromEntries(game.players.map((p) => [p.id, p]));
  const activePlayer = players[game.turn];
  const statusTitle = bidding ? '叫分决定地主' : settled ? '本局已结算' : game.turn === 'player' ? '你的回合' : `${activePlayer.name}的回合`;
  /* 结算结果要双写：RESULT 阶段的结算页浮层可见（胜负/倍率/Token 明细在那里），
     侧栏同步保留一份摘要，浮层关闭推进后仍能在这里回看。 */
  const statusCopy = bidding ? biddingCopy(game) : settled
    ? (game.settlement ? `${palName(game.settlement.winnerId)}获胜。${multiplierLine(game.settlement)}。${tokenLine(game.settlement)}。` : '胜负已由服务端写入结算轨迹。')
    : game.turn === 'player' ? (game.currentCombo && game.lastPlayerId !== 'player' ? '桌面有待压制的牌型；可以出更大的同类牌，或选择“不出”。' : '现在由你领出一手牌；“提示”会标出可出的合法牌型。') : `${activePlayer.name}正在根据桌面牌型思考，完成后才轮到下一位。`;
  const latestAction = (palId) => game.events.slice().reverse().find((event) => event.type === 'PAL_ACTION' && event.playerId === palId)?.action || 'A01';
  /* 五态绑定牌桌事件：待机/出牌/不出走 PAL_ACTION 事件流；胜利/失败由结算阶段直接驱动——
     事件流从不发 A04/A05，不接这一层，牌桌上永远看不到胜利与失败态。 */
  const seatAction = (palId) => {
    if (settled && game.settlement?.winnerId) return game.settlement.winnerId === palId ? 'A04' : 'A05';
    return latestAction(palId);
  };
  const palBubble = (palId) => { const event = game.events.slice().reverse().find((item) => item.type === 'PAL_ACTION' && item.playerId === palId); return event ? `<p class="pal-bubble">${escape(event.dialogue || '')}</p>` : ''; };
  const [topSeat, rightSeat] = seatIdsOf(game);
  const theme = tableTheme([topSeat, rightSeat]);
  /* 特写先于 innerHTML 计算：syncCloseup 会写入 state.closeup 并起收镜定时器。 */
  syncCloseup(game);
  app.innerHTML = `<section class="table-page">
    <aside class="table-side"><div class="round-tag">引导牌局 · 第 1 局</div><h1>${statusTitle}</h1><p>${statusCopy}</p></aside>
    <section class="table-board">
      <div class="table-felt theme-${theme.id}" data-table-theme="${theme.id}"><div class="match-hud"><span>第 1 局 / BO3</span><b>${bidding ? '叫分中' : `地主 ×${game.multiplier}`}</b><span>${settled ? '本局结算' : game.turn === 'player' ? '轮到你' : `${activePlayer.name}回合`}</span></div><div class="felt-label">DRESSBATTLE <small>${theme.label}</small><em>${theme.name}</em></div>
        <div class="opponent top">${palStandee(topSeat, 'table-seat', seatAction(topSeat))}<div><b>${players[topSeat].role || '等待叫分'}</b><span>${players[topSeat].count} 张</span></div><div class="back-cards">▣ ▣ ▣</div>${palBubble(topSeat)}</div>
        <div class="opponent right">${palStandee(rightSeat, 'table-seat', seatAction(rightSeat))}<div><b>${players[rightSeat].role || '等待叫分'}</b><span>${players[rightSeat].count} 张</span></div><div class="back-cards">▣ ▣ ▣</div>${palBubble(rightSeat)}</div>
        <div class="play-stage" role="status" aria-live="polite">${game.currentCombo ? `<div class="played-stack from-${game.lastPlayerId} seat-${seatKeyOf(game, game.lastPlayerId)}"><p>桌面牌型 · ${game.currentCombo.label}</p><div class="table-card-fan">${(game.currentCards || []).map(tableCard).join('')}</div><b>${players[game.lastPlayerId]?.name || '未知'}已出</b></div>` : `<div class="lead-marker">${game.turn === 'player' ? '等待你领出第一手牌' : `${activePlayer.name}等待领出`}</div>`}<div class="turn-dock ${game.turn === 'player' ? 'active' : ''}">${settled ? '结算中' : game.turn === 'player' ? (game.currentCombo && game.lastPlayerId !== 'player' ? '轮到你 · 选择压制或不出' : '轮到你领出') : `${activePlayer.name}思考中…`}</div></div>
        <div class="self-seat"><span>${players.player.role || '你'} · ${players.player.count} 张</span></div>
        ${state.closeup ? closeupMarkup(state.closeup) : ''}
      </div>
      <div class="hand-wrap"><div class="hand-header"><span>你的手牌 <b>${game.playerHand.length}</b></span><div>${bidding ? bidControls(game) : settled ? '<span class="settlement-progress">结算演出进行中</span>' : game.turn !== 'player' ? `<span class="turn-wait" aria-live="polite">${activePlayer.name}正在思考…</span>` : `<button class="secondary compact" data-action="hint">提示</button>${game.currentCombo && game.lastPlayerId !== 'player' ? '<button class="secondary compact" data-action="pass">不出</button>' : ''}<button class="primary compact" data-action="play">出牌</button>`}</div></div><div class="hand" aria-label="你的手牌">${game.playerHand.map((item) => card(item, state.selected.has(item), bidding || settled || game.turn !== 'player')).join('')}</div></div>
    </section>
    <aside class="event-feed"><h2>牌局记录</h2>${game.events.slice().reverse().slice(0, 4).map((event) => `<div class="event"><p>${escape(eventText(event))}</p></div>`).join('')}</aside>
  </section>${state.entry ? entryCinematic() : ''}${settled ? settlementOverlay(game) : ''}`;
}

/* ---------- settlement: live dress-up performance ---------- */
/* RESULT 阶段的主按钮文案按胜负内联在 settlementOverlay 里（赢：「xxx将为你跳舞」/ 输：「继续」），
   这里的映射只覆盖 RESULT 之后的阶段；RESULT 兜底落到「继续」。 */
function settlementLabel(stage) { return ({ PERFORMANCE: '揭晓写真卡', PHOTO_REVEAL: '完成收藏', DESTINATION: '再开一局' })[stage] || '继续'; }
/* A4 倍数必须可解释：把「这个 ×N 是怎么来的」摊开写，封顶也要如实标注。 */
function multiplierLine(s) {
  const b = s.breakdown;
  if (!b) return `倍率 ×${s.multiplier}`;
  const cap = b.capped ? `（已达上限，原始 ×${b.raw}）` : '';
  // 只有一个因子时「叫分底分 ×3 = ×3」是自说自话，直接给结论；有多个因子才摊开算给玩家看。
  if (b.factors.length <= 1) return `倍率 ×${s.multiplier}${cap}`;
  const parts = b.factors.map((factor) => `${factor.label} ${factor.value}`).join(' · ');
  return `${parts} = ×${s.multiplier}${cap}`;
}
function tokenLine(s) {
  const delta = s.tokenEffectiveDelta ?? s.tokenDelta ?? 0;
  const stake = Math.abs(delta);
  return `${delta >= 0 ? '+' : '−'}${stake} Token${s.playerIsLandlord ? '（地主同时对两家结算）' : ''}`;
}
function dressupFigure(cardRecord, { autoplay = true } = {}) {
  cardRecord = repairGalleryCard(cardRecord);
  const layers = cardRecord.layerSnapshot;
  const bands = [1, 2, 3].map((band) => `<img class="layer layer-outfit band band-${band}" src="${layers.outfit}" width="600" height="800" alt="" aria-hidden="true" style="--band:${band}" />`).join('');
  return `<figure class="dressup-figure ${autoplay && !reducedMotion() ? 'autoplay' : 'assembled'}">
    <img class="layer layer-base" src="${layers.base}" width="600" height="800" alt="${escape(cardRecord.outfitName)}着装前的角色" />
    ${bands}
    ${layers.effect ? `<img class="layer layer-fx" src="${layers.effect}" width="600" height="800" alt="" aria-hidden="true" />` : ''}
  </figure>`;
}
/* 登台演出与全屏跳舞共用的选片优先级：
   ① 本张写真卡的 cardVideo/cardPoster——视频是**套装级**资产，林星/银岚各有多段写真，
      不能所有卡都偷偷播角色默认舞片；
   ② 牌友默认 danceVideoRef/dancePosterRef——只有首套基础写真相配，后续套装必须绑定
      自己的 cardVideo，否则同一角色的每张卡会错误地播放同一支视频。 */
function danceFilmOf(cardRecord) {
  cardRecord = repairGalleryCard(cardRecord);
  const pal = state.palIndex[cardRecord.palId];
  const outfit = (pal?.appearance?.outfitLibrary || []).find((entry) => entry.outfitId === cardRecord.outfitId);
  const ownFilm = cardRecord.layerSnapshot?.cardVideo || outfit?.layerSnapshot?.cardVideo || null;
  const isFirstOutfit = outfit && outfit.outfitId === pal?.appearance?.outfitLibrary?.[0]?.outfitId;
  const videoRef = ownFilm || (isFirstOutfit ? pal?.appearance?.danceVideoRef || null : null);
  const poster = cardRecord.layerSnapshot?.cardPoster || outfit?.layerSnapshot?.cardPoster || (isFirstOutfit ? pal?.appearance?.dancePosterRef || null : null);
  return { videoRef, poster, pal };
}
/* 玩家胜利后的套装演出舞台：视频挂在 data-settlement-video 上，播完或出错换成 L2 分层静态图。
   选片先走 danceFilmOf，再退动作包 A05/A04/A01 横版分层轨，最后才是 L2 分层静态图。 */
function settlementPerformanceBody(cardRecord) {
  cardRecord = repairGalleryCard(cardRecord);
  const { videoRef, poster, pal } = danceFilmOf(cardRecord);
  if (videoRef) {
    const label = `${palName(cardRecord.palId)} · ${cardRecord.outfitName}换装演出`;
    if (reducedMotion() && poster) return letterboxStill({ poster, label, className: 'stage-vframe' });
    return letterboxVideo({ src: videoRef, poster, label, className: 'stage-vframe', settle: true });
  }
  const pack = pal?.actionPack || {};
  const action = ['A05', 'A04', 'A01'].find((a) => pack[a]?.videoRef);
  const actionRef = action ? pack[action].videoRef : null;
  if (!actionRef || reducedMotion()) return dressupFigure(cardRecord);
  return `<video class="settlement-action-video" data-settlement-video autoplay muted playsinline preload="auto" aria-label="${escape(palName(cardRecord.palId))}换装演出">${videoSource(actionRef)}</video>`;
}
/* 赢局的舞台演出是**独立的全屏页面**：结算页点「xxx将为你跳舞」推进到 PERFORMANCE 后
   整屏只放那支舞，不内含在结算浮层里——结算和舞台是两个页面。视频由玩家点击触发，
   带声音与控制条；不挂 data-settlement-video，播完保留末帧可重播，不自动换静态图。 */
function danceStagePage(cardRecord) {
  cardRecord = repairGalleryCard(cardRecord);
  const { videoRef, poster, pal } = danceFilmOf(cardRecord);
  const label = `${palName(cardRecord.palId)}为你跳舞`;
  let body;
  if (videoRef) {
    body = letterboxVideo({ src: videoRef, poster, label, className: 'dance-vframe', autoplay: true, preload: 'auto', controls: true, sound: true });
  } else {
    const pack = pal?.actionPack || {};
    const action = ['A05', 'A04', 'A01'].find((a) => pack[a]?.videoRef);
    const actionRef = action ? pack[action].videoRef : null;
    body = actionRef && !reducedMotion()
      ? `<video class="dance-stage-video" controls autoplay playsinline preload="auto" aria-label="${escape(label)}">${videoSource(actionRef)}</video>`
      : dressupFigure(cardRecord);
  }
  return `<section class="dance-stage" role="dialog" aria-modal="true" aria-labelledby="dance-stage-title"><div class="dance-stage-spotlight" aria-hidden="true"></div>${body}<div class="dance-stage-head"><p class="eyebrow">舞台演出</p><h2 id="dance-stage-title">${escape(label)}</h2></div><div class="dance-stage-actions"><button class="secondary compact" data-action="skip-settlement">跳过演出 →</button><button class="primary" data-action="advance">${settlementLabel('PERFORMANCE')}</button></div></section>`;
}
function settlementOverlay(game) {
  const s = game.settlement; const stage = game.settlementStage;
  const playerWon = s.winnerId === 'player';
  const cardRecord = repairGalleryCard(s.card);
  if (stage === 'PERFORMANCE' && playerWon && cardRecord) return danceStagePage(cardRecord);
  const eyebrow = ({ RESULT: '胜负已分', PERFORMANCE: '舞台演出', PHOTO_REVEAL: '写真卡', DESTINATION: '散场' })[stage] || stage;
  if (!cardRecord) {
    const winnerPal = state.palIndex[s.winnerId];
    const winnerName = winnerPal ? winnerPal.identity.name : '牌友';
    const title = stage === 'RESULT' ? (playerWon ? '你赢下了这一局' : '这一局惜败') : '下一局等你开场';
    const winDance = winnerPal?.appearance?.danceVideoRef || null;
    const winVideo = winDance || (winnerPal?.actionPack?.A04?.videoRef || winnerPal?.actionPack?.A01?.videoRef || null);
    const showWin = stage === 'PERFORMANCE' && playerWon && s.outcome?.danceEligible && !reducedMotion();
    const stageClass = showWin && winVideo ? 'dressup-stage' : 'dressup-stage plain';
    const stageBody = !showWin ? '' : winDance
      ? letterboxVideo({ src: winDance, poster: winnerPal?.appearance?.dancePosterRef || null, label: `${winnerName}守住舞台`, className: 'stage-vframe' })
      : `<video class="settlement-action-video" autoplay muted playsinline preload="auto" aria-label="${escape(winnerName)}守住舞台">${videoSource(winVideo)}</video>`;
    const summary = stage === 'RESULT'
      ? (playerWon ? `${multiplierLine(s)}。${tokenLine(s)}。` : `${multiplierLine(s)}。${tokenLine(s)}。${winnerName}守住了舞台，本局不触发演出。`)
      : (s.outcome?.danceEligible ? `${multiplierLine(s)}。${tokenLine(s)}。「${winnerName}」保住了自己的服装。` : `${multiplierLine(s)}。${tokenLine(s)}。本局没有演出，重开一局再挑战。`);
    const actions = stage === 'RESULT'
      ? '<button class="secondary compact" data-action="skip-settlement">跳过演出 →</button><button class="primary" data-action="advance">继续</button>'
      : '<button class="secondary compact" data-action="skip-settlement">跳过演出 →</button><button class="primary" data-action="restart">再开一局</button><button class="secondary" data-route="gallery">打开写真馆</button>';
    return `<section class="settlement show" role="dialog" aria-modal="true" aria-labelledby="settlement-title"><div class="settlement-card dressup-modal"><div class="${stageClass}"><div class="dressup-spotlight" aria-hidden="true"></div>${stageBody}<div class="settlement-stage-head"><p class="eyebrow">${eyebrow}</p><h2 id="settlement-title">${title}</h2></div><div class="settlement-video-footer"><p class="settlement-video-description">${summary}</p><div class="modal-actions">${actions}</div></div></div></div></section>`;
  }
  const name = palName(cardRecord.palId);
  const isUpgrade = !s.isFirstUnlock;
  /* 只有玩家胜利才会有 cardRecord 并进入这条套装演出分支；玩家输局在 RESULT 后直接散场。 */
  const title = stage === 'RESULT' ? (playerWon ? '你赢下了这一局' : '这一局惜败')
    : stage === 'PERFORMANCE' ? `${name}现场换上「${cardRecord.outfitName}」`
    : stage === 'PHOTO_REVEAL' ? (isUpgrade ? `写真卡升级 · Lv.${cardRecord.upgradeLevel}` : '首次收藏已解锁')
    : '下一局等你开场';
  const summary = stage === 'RESULT' ? `${multiplierLine(s)}。${tokenLine(s)}。${playerWon ? `牌友「${name}」将为你跳一支舞，作为胜方奖励；演出的定格写真卡也会收入写真馆。` : '本局没有演出，结算结果已记录。'}`
    : stage === 'PERFORMANCE' ? `${multiplierLine(s)}。${tokenLine(s)}。「${cardRecord.outfitName} × ${cardRecord.dance}」正在登台。`
    : stage === 'PHOTO_REVEAL' ? (isUpgrade ? `「${cardRecord.outfitName}」再次解锁，卡面升至 Lv.${cardRecord.upgradeLevel}。` : `「${cardRecord.outfitName} × ${cardRecord.dance}」已写入写真馆 No.${String(cardRecord.serialNo).padStart(3, '0')}。`)
    : '重开引导局，或查看已收集的写真。';
  const stageBody = stage === 'PHOTO_REVEAL' || stage === 'DESTINATION'
    ? `<div class="photo-card-reveal" data-card="${cardRecord.cardId}">${photoCardArt(cardRecord, { large: true })}</div>`
    : stage === 'PERFORMANCE' ? settlementPerformanceBody(cardRecord)
    : dressupFigure(cardRecord);
  const primary = stage === 'RESULT' ? (playerWon ? `${name}将为你跳舞` : '继续') : settlementLabel(stage);
  return `<section class="settlement show" role="dialog" aria-modal="true" aria-labelledby="settlement-title"><div class="settlement-card dressup-modal"><div class="dressup-stage"><div class="dressup-spotlight" aria-hidden="true"></div>${stageBody}<div class="settlement-stage-head"><p class="eyebrow">${eyebrow}</p><h2 id="settlement-title">${title}</h2></div><div class="settlement-video-footer"><p class="settlement-video-description">${summary}</p><div class="modal-actions">${stage !== 'DESTINATION' ? '<button class="secondary compact" data-action="skip-settlement">跳过演出 →</button>' : ''}<button class="primary" data-action="advance">${primary}</button>${stage === 'DESTINATION' ? '<button class="secondary" data-route="gallery">打开写真馆</button><button class="secondary" data-action="open-studio">搭配我的写真</button>' : ''}${stage === 'DESTINATION' && state.partner && !state.partner.submitted ? '<button class="primary" data-action="partner-return">创作完成 · 返回平台</button>' : ''}</div></div></div></div></section>`;
}

/* ---------- photo cards ---------- */
/* 卡面始终与「导出卡面 PNG」一致：layers.outfit 分层静态图（有 effect 就叠加），
   边框、编号与 Lv 角标同构——不用视频定帧（cardPoster）当卡面。
   跳舞视频只属于两个场景：结算揭晓（motion:true）的动态卡面，与点「回看跳舞」后的回放浮层。
   等级表达沿用既有体系：lv2+ 的 .layer-outfit 缩放、描边配色与 Lv 角标。 */
function photoCardArt(cardRecord, { large = false, motion = true } = {}) {
  cardRecord = repairGalleryCard(cardRecord);
  const layers = cardRecord.layerSnapshot;
  const lv = Math.min(cardRecord.upgradeLevel || 1, 5);
  const tier = [null, '初见', '流光', '绮影', '华彩', '典藏'][lv];
  const frameClass = `pcard-art lv${lv} ${cardRecord.rarity === 'first' ? 'first' : ''}`;
  const serial = `<span class="pcard-serial">No.${String(cardRecord.serialNo).padStart(3, '0')}</span>`;
  const levelMarks = Array.from({ length: 5 }, (_, index) => `<i class="${index < lv ? 'on' : ''}"></i>`).join('');
  const lvBadge = `<span class="pcard-tier" aria-label="卡面等级 ${lv} 级，${tier}"><b>Lv.${lv}</b><em>${tier}</em><span class="pcard-level-marks" aria-hidden="true">${levelMarks}</span></span>`;
  const firstBadge = cardRecord.rarity === 'first' ? '<span class="pcard-first-badge">首发</span>' : '';
  /* 动态录像卡面只保留给结算揭晓；写真馆栅格与详情页始终走下面的分层静态图。 */
  if (layers.cardVideo && motion && !reducedMotion()) {
    const label = `${escape(cardRecord.outfitName)}写真卡面，动态写真`;
    const body = letterboxVideo({ src: layers.cardVideo, poster: layers.cardPoster || null, label, className: 'card-vframe', autoplay: true, preload: large ? 'auto' : 'metadata' });
    return `<div class="${frameClass} video" data-lv="${lv}" data-tier="${tier}">${body}<span class="pcard-frame" aria-hidden="true"></span>${serial}${firstBadge}${lvBadge}</div>`;
  }
  return `<div class="${frameClass}" data-lv="${lv}" data-tier="${tier}">
    <img class="layer layer-outfit" src="${layers.outfit}" width="600" height="800" alt="${escape(cardRecord.outfitName)}写真卡面" ${large ? '' : 'loading="lazy"'} />
    ${layers.effect ? `<img class="layer layer-fx" src="${layers.effect}" width="600" height="800" alt="" aria-hidden="true" />` : ''}
    <span class="pcard-frame" aria-hidden="true"></span>
    ${serial}${firstBadge}${lvBadge}
  </div>`;
}
const totalOutfits = () => state.pals.reduce((sum, pal) => sum + (pal.appearance?.outfitLibrary?.length || 0), 0);
const collectionPoints = () => state.galleryCards.reduce((sum, entry) => sum + (entry.upgradeLevel || 1), 0);
/* 早期结算曾在某个牌友未接入 outfitLibrary 时，把 `preset://` 内部占位引用写进写真卡。
   这类地址不是浏览器资源，不能把它交给 <img> 或 <video>。读取旧存档时按同一 pal 的
   已审核首套真实资源原地迁移；保留 sourceCardId 供「已读」回写旧记录，刷新也不会再次破图。 */
const isBrowserAsset = (ref) => typeof ref === 'string' && ref.startsWith('/assets/');
function repairGalleryCard(record) {
  if (isBrowserAsset(record?.layerSnapshot?.outfit) || record?.layerSnapshot?.cardVideo) return record;
  const outfits = state.palIndex[record?.palId]?.appearance?.outfitLibrary || [];
  const replacement = outfits.find((outfit) => outfit.outfitId === record.outfitId) || outfits[0];
  if (!replacement || !isBrowserAsset(replacement.layerSnapshot?.outfit)) return record;
  return {
    ...record,
    sourceCardId: record.cardId,
    cardId: `${record.palId}:${replacement.outfitId}`,
    outfitId: replacement.outfitId,
    outfitName: replacement.name,
    dance: replacement.dance,
    layerSnapshot: replacement.layerSnapshot,
    auditRecordId: replacement.auditRecordId || record.auditRecordId
  };
}
function gallerySlots() {
  const slots = [];
  for (const pal of state.pals) {
    for (const outfit of pal.appearance?.outfitLibrary || []) {
      const cardId = `${pal.palId}:${outfit.outfitId}`;
      const record = state.galleryCards.find((entry) => entry.cardId === cardId);
      slots.push({ pal, outfit, cardId, record });
    }
  }
  return slots;
}
function filteredSlots() {
  return gallerySlots().filter(({ pal, record }) => {
    const isCustom = /^pal-user-/.test(pal.palId) || /^audit-(production|mock)-/.test(pal.auditRecordId || '');
    if (state.galleryTab === 'custom' && !isCustom) return false;
    if (state.galleryTab !== 'all' && state.galleryTab !== 'custom' && pal.palId !== state.galleryTab) return false;
    if (state.galleryQuick === 'new') return record && !record.seen;
    if (state.galleryQuick === 'first') return record?.rarity === 'first';
    if (state.galleryQuick === 'missing') return !record;
    return true;
  });
}
function renderGallery() {
  const unlocked = state.galleryCards.length;
  const total = totalOutfits();
  const points = collectionPoints();
  const tab = (id, label) => `<button class="chip ${state.galleryTab === id ? 'active' : ''}" data-action="gallery-tab" data-tab="${id}" aria-pressed="${state.galleryTab === id}">${label}</button>`;
  const quick = (id, label) => `<button class="chip ${state.galleryQuick === id ? 'active' : ''}" data-action="gallery-quick" data-quick="${id}" aria-pressed="${state.galleryQuick === id}">${label}</button>`;
  const slots = filteredSlots();
  app.innerHTML = `<section class="gallery">
    <div class="gallery-head"><div><p class="eyebrow">COLLECTION · LIVE DRESS-UP</p><h1>写真馆</h1><p>每张卡都是一场现场换装演出的定格。重复解锁同一服装会让卡面升级，纯视觉、无数值。</p></div>
      <div class="collection-progress" role="status"><b>${unlocked} / ${total}</b><span>已解锁写真卡</span><div class="progress-track"><i style="width:${total ? Math.round(unlocked / total * 100) : 0}%"></i></div><span class="points">收藏点 ◆ ${points}</span></div></div>
    ${collectionMarkup(state.collection, palName)}<div class="gallery-filters">${tab('all', '全部')}${tab('pal-linxing', '林星')}${tab('pal-mia', '米娅')}${tab('pal-yinlan', '银岚')}${state.pals.some((pal) => /^pal-user-/.test(pal.palId)) ? tab('custom', '自定义牌友') : ''}<span class="filter-gap"></span>${quick('new', '新！')}${quick('first', '金框')}${quick('missing', '缺失')}<span class="gallery-result-count" role="status" aria-live="polite">显示 ${slots.filter((slot) => slot.record).length} / ${slots.length} 张</span></div>
    <div class="card-level-legend" aria-label="写真卡等级图例"><span>重复解锁升级</span>${['初见','流光','绮影','华彩','典藏'].map((name, index) => `<b class="lv${index + 1}"><i>Lv.${index + 1}</i>${name}</b>`).join('')}</div>
    <!-- 筛选只改变卡池，不改变卡型：写真馆始终使用同一套 3:4 竖卡栅格，避免少卡时突然切成横向大卡造成视觉跳变。 -->
    <div class="gallery-grid" id="galleryGrid">${slots.length ? slots.map(gallerySlot).join('') : '<div class="empty-line">当前筛选下没有写真卡。</div>'}</div>
  </section>${state.detail ? detailOverlay() : ''}${state.replay ? replayOverlay(state.replay) : ''}`;
}
/* 未解锁卡要有光影和色彩线索，但不该让玩家在卡册里直接看清角色、服装或舞台动作。
   预告仍复用已审核的 poster / outfit，不增加新内容；通过放大、虚焦、雾幕把它降成
   "可感知气氛、不可辨识细节" 的窥视层，真正画面只在赢下该牌友后揭晓。 */
function lockedCardArt(pal, outfit) {
  const layers = outfit.layerSnapshot || {};
  const videoPreview = Boolean(layers.cardVideo && layers.cardPoster);
  const previewRef = videoPreview ? layers.cardPoster : layers.outfit;
  return `<div class="pcard-art locked-art ${videoPreview ? 'preview-video' : 'preview-static'}" data-preview-kind="${videoPreview ? 'video' : 'static'}">
    <img class="locked-preview-media" src="${previewRef}" width="600" height="800" alt="" aria-hidden="true" loading="lazy" />
    <span class="locked-preview-scrim" aria-hidden="true"></span>
    <span class="locked-preview-fog" aria-hidden="true"></span>
    <span class="locked-preview-kind">未知片段</span><span class="locked-preview-lock" aria-hidden="true">⌁</span>
    <span class="locked-preview-unlock">胜局解锁</span>
    <span class="pcard-frame" aria-hidden="true"></span><span class="pcard-serial">No.???</span>
  </div>`;
}
function gallerySlot({ pal, outfit, cardId, record }) {
  const name = pal.identity.name;
  if (!record) {
    return `<article class="pcard locked" data-card="${cardId}" tabindex="0" role="button" aria-label="未解锁写真预告，赢下${name}解锁">
      ${lockedCardArt(pal, outfit)}
      <div class="pcard-copy"><h2>未解锁写真</h2><p>${escape(name)} · 胜局解锁</p></div></article>`;
  }
  return `<article class="pcard ${record.seen ? '' : 'is-new'}" data-card="${cardId}" tabindex="0" role="button" aria-label="写真卡：${escape(record.outfitName)} × ${escape(record.dance)}，${record.rarity === 'first' ? '初回限定' : '常规'}，等级 ${record.upgradeLevel}">
    ${photoCardArt(record, { motion: false })}${record.seen ? '' : '<span class="pcard-new" aria-hidden="true">新！</span>'}
    <div class="pcard-copy"><h2>${escape(record.outfitName)}</h2><p>${escape(name)} · ${escape(record.dance)}</p></div></article>`;
}

/* ---------- card detail ---------- */
function unlockedCardsInView() { return filteredSlots().filter((slot) => slot.record).map((slot) => slot.record); }
function detailOverlay() {
  const cards = unlockedCardsInView();
  const index = cards.findIndex((entry) => entry.cardId === state.detail);
  const record = cards[index] || state.galleryCards.find((entry) => entry.cardId === state.detail);
  if (!record) return '';
  const name = palName(record.palId);
  const stats = record.gameStats || {};
  const unlockedAt = record.unlockedAt && !record.unlockedAt.startsWith('1970') ? new Date(record.unlockedAt).toLocaleString('zh-CN') : '引导局首胜';
  return `<section class="card-detail" role="dialog" aria-modal="true" aria-labelledby="detail-title">
    <button class="detail-nav prev" data-action="detail-prev" aria-label="上一张" ${cards.length > 1 ? '' : 'disabled'}>‹</button>
    <div class="detail-card">${photoCardArt(record, { large: true, motion: false })}</div>
    <div class="detail-info"><p class="eyebrow">${record.rarity === 'first' ? '✦ 初回限定' : '写真卡'} · Lv.${record.upgradeLevel}</p><h2 id="detail-title">${escape(record.outfitName)} × ${escape(record.dance)}</h2>
      <dl><div><dt>牌友</dt><dd>${escape(name)}</dd></div><div><dt>编号</dt><dd>No.${String(record.serialNo).padStart(3, '0')}</dd></div><div><dt>获得</dt><dd>${escape(unlockedAt)}</dd></div><div><dt>那一局</dt><dd>倍率 ×${stats.multiplier ?? '—'} · ${stats.rounds ?? '—'} 轮 · 终手 ${escape(stats.lastCombo || '—')}</dd></div><div><dt>审核</dt><dd>${escape(record.auditRecordId)}</dd></div></dl>
      <div class="detail-actions"><button class="primary compact" data-action="replay-card" data-card="${record.cardId}">回看跳舞</button><button class="secondary compact" data-action="export-card" data-card="${record.cardId}">导出卡面 PNG</button><button class="secondary compact" data-action="close-detail">关闭</button></div>
      <p class="detail-hint">← → 切换相邻写真卡 · Esc 关闭</p></div>
    <button class="detail-nav next" data-action="detail-next" aria-label="下一张" ${cards.length > 1 ? '' : 'disabled'}>›</button>
  </section>`;
}
function stepDetail(direction) {
  const cards = unlockedCardsInView();
  if (cards.length < 2) return;
  const index = cards.findIndex((entry) => entry.cardId === state.detail);
  const next = cards[(index + direction + cards.length) % cards.length];
  state.detail = next.cardId;
}

/* ---------- replay & export ---------- */
function replayOverlay(replay) {
  const pal = state.palIndex[replay.palId];
  const outfit = (pal?.appearance?.outfitLibrary || []).find((entry) => entry.outfitId === replay.outfitId);
  const ownFilm = replay.layerSnapshot?.cardVideo || outfit?.layerSnapshot?.cardVideo || null;
  const isFirstOutfit = outfit && outfit.outfitId === pal?.appearance?.outfitLibrary?.[0]?.outfitId;
  const poster = replay.layerSnapshot?.cardPoster || outfit?.layerSnapshot?.cardPoster || (isFirstOutfit ? pal?.appearance?.dancePosterRef || null : null);
  const videoRef = ownFilm || (isFirstOutfit ? pal?.appearance?.danceVideoRef || null : null);
  const stage = videoRef
    ? letterboxVideo({ src: videoRef, poster, label: `${replay.name} · ${replay.outfitName}视频回放`, className: 'replay-vframe', autoplay: true, preload: 'auto', controls: true, replay: true })
    : dressupFigure(replay);
  return `<section class="replay-overlay" role="dialog" aria-modal="true" aria-labelledby="replay-title"><div class="replay-card dressup-replay"><div class="dressup-stage inline">${stage}</div><div class="replay-head"><p class="eyebrow">${videoRef ? '写真视频 · 回放' : '换装演出 · 回放'}</p><h2 id="replay-title">${escape(replay.name)} · ${escape(replay.outfitName)}</h2></div><div class="replay-footer"><p>${videoRef ? '视频可暂停、拖动进度或重新播放；回放不会影响已收藏的写真卡。' : '该套装暂无专属视频，当前展示静态换装效果；可在牌友工坊完成视频生产后回放。'}</p></div><button class="secondary replay-close" data-action="close-replay">关闭回放</button></div></section>`;
}
const loadImage = (src) => new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = src; });
async function exportCardPng(record) {
  const canvas = document.createElement('canvas');
  canvas.width = 600; canvas.height = 800;
  const ctx = canvas.getContext('2d');
  const layers = record.layerSnapshot;
  const outfit = await loadImage(layers.outfit);
  ctx.drawImage(outfit, 0, 0, 600, 800);
  if (layers.effect) ctx.drawImage(await loadImage(layers.effect), 0, 0, 600, 800);
  ctx.strokeStyle = record.rarity === 'first' ? '#f5d78c' : '#c9b8df';
  ctx.lineWidth = 10; ctx.strokeRect(5, 5, 590, 790);
  ctx.fillStyle = 'rgba(5,8,15,.72)'; ctx.fillRect(0, 690, 600, 110);
  ctx.fillStyle = '#fff8e9'; ctx.font = '700 30px sans-serif'; ctx.fillText(`${record.outfitName} × ${record.dance}`, 24, 736);
  ctx.font = '600 20px sans-serif'; ctx.fillStyle = '#eed49b';
  ctx.fillText(`No.${String(record.serialNo).padStart(3, '0')} · Lv.${record.upgradeLevel} · ${palName(record.palId)}`, 24, 770);
  const link = document.createElement('a');
  link.download = `${record.cardId.replace(':', '-')}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

/* ---------- workshop & inspector (unchanged scope) ---------- */
function workshopCandidate(entry, confirmedIds) {
  const asset = entry.asset;
  const isConfirmed = confirmedIds.has(asset.palId);
  const isSeated = chosenSeats().includes(asset.palId);
  const accent = asset.appearance?.accent || '#8e69ff';
  /* 可确认资产是名册入口，必须使用独立生成的 1:1 头像；角色资料卡与主立绘不在此槽位复用。 */
  const avatarRef = asset.appearance?.avatarRef || asset.appearance?.portraitRef;
  const image = avatarRef?.startsWith('/assets/') ? `<button class="image-preview-trigger candidate-image-trigger" type="button" data-action="preview-pal-image" data-image="${escape(avatarRef)}" data-name="${escape(asset.identity.name)}头像" aria-label="查看${escape(asset.identity.name)}头像大图"><img class="candidate-image" src="${escape(avatarRef)}" alt="${escape(asset.identity.name)}的 1:1 头像" /></button>` : `<div class="candidate-portrait" aria-hidden="true" style="background:linear-gradient(135deg, ${accent}, #141024)">✦</div>`;
  const packageState = entry.package?.state || 'ASSET_PENDING';
  /* 资源齐备不等于自动上桌：候选资产仍须由玩家确认后才进入下一局。 */
  const packageLabel = packageState === 'RICH_ASSETS_READY' ? '完整首发包已完成，待你确认' : '完整首发包资源待齐';
  return `<article class="candidate${isConfirmed ? ' confirmed' : ''}">
    ${image}<div><b>${escape(asset.identity.name)}</b><p>${escape(entry.intent.style)} · ${escape(packageLabel)} · v${asset.version}</p><small>${escape(entry.provider?.name || 'legacy mock')} · ${escape(asset.auditRecordId)} · ${escape(asset.fallback.reason)}</small></div>
    <div class="candidate-actions">${isConfirmed ? '<span class="candidate-badge">已建档</span>' : ''}<button class="secondary compact" data-action="discard" data-pal="${asset.palId}">移除</button><button class="secondary compact${isSeated ? ' is-seated' : ''}" data-action="apply-pal" data-pal="${asset.palId}"${isSeated ? ' disabled aria-disabled="true"' : ''}>${isSeated ? '已排入牌局' : isConfirmed ? '排入下一局' : '确认并排入下一局'}</button></div>
  </article>`;
}
function workshopJob(job) {
  const status = job.stage || job.status || 'UNKNOWN';
  const label = ({ QUEUED: '排队中', WAITING_REFERENCE: '等待参考素材', WAITING_PORTRAIT_CONFIRMATION: '等待确认角色资料卡', RETRY_WAITING: '等待重试', BLOCKED_REFERENCE: '缺少参考素材', SUBMITTING: '正在提交', RUNNING: '生产中', GENERATING: '正在生成角色资料卡', AUDITING: '正在审核并写入资产', SUCCEEDED: '生产完成', READY: '完整首发包可上桌', ASSET_PENDING: '完整首发包待动作与演出资产', FAILED: '生成失败' })[status] || status;
  const tier = '完整首发包';
  const tone = job.active ? 'active' : ['FAILED', 'BLOCKED_REFERENCE'].includes(status) ? 'failed' : ['ASSET_PENDING', 'WAITING_PORTRAIT_CONFIRMATION', 'WAITING_REFERENCE', 'RETRY_WAITING'].includes(status) ? 'pending' : 'ready';
  const deletable = !job.active;
  const taskId = job.taskId || '';
  const jobId = job.jobId || '';
  /* 逐资源验收只覆盖 pipeline 任务（带 resourceId 且落在 RESOURCE_SLOTS 展示槽）；
     legacy job 没有 resourceId 天然排除。早期落盘的任务记录缺 mapping 冗余字段，按 resourceId 现查补齐。 */
  const slotMapping = job.mapping || (job.resourceId ? RESOURCE_SLOTS[job.resourceId] : null);
  const reviewable = Boolean(taskId && job.resourceId && slotMapping);
  const approved = job.reviewStatus === 'APPROVED';
  const rejected = job.reviewStatus === 'REJECTED';
  /* 打回重产后：同资源若已有更新的生产尝试，旧卡片确认验收置灰、打回入口收起，
     状态跟随新尝试显示为「重新生产中」；新尝试完成后由它自己开放验收。 */
  const siblings = taskId && job.planId && job.resourceId
    ? (state.workshop?.jobs || []).filter((other) => other.taskId && other.planId === job.planId && other.resourceId === job.resourceId)
    : [job];
  const latestSibling = siblings.slice().sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0] || job;
  const superseded = latestSibling.taskId && latestSibling.taskId !== job.taskId;
  const replacementActive = rejected && superseded && ['QUEUED', 'WAITING_REFERENCE', 'RETRY_WAITING', 'RUNNING', 'SUBMITTING', 'WAITING_PORTRAIT_CONFIRMATION'].includes(latestSibling.status);
  const replacementLabel = ({ QUEUED: '排队中', WAITING_REFERENCE: '等待参考中', RETRY_WAITING: '等待重试中', RUNNING: '生产中', SUBMITTING: '提交中', WAITING_PORTRAIT_CONFIRMATION: '等待确认资料卡' })[latestSibling.status] || '生产中';
  const displayLabel = replacementActive ? `已打回 · 重新${replacementLabel}` : label;
  const displayTone = replacementActive ? 'active' : tone;
  const reviewBadge = reviewable && status === 'SUCCEEDED'
    ? `<i class="review-badge ${approved ? 'approved' : rejected ? 'rejected' : 'pending'}">${approved ? '已验收' : rejected ? '已打回' : '待验收'}</i>`
    : '';
  const jobTitle = job.label || job.resourceId || '生产资源';
  const reviewThumb = reviewable && job.kind === 'image' && job.publicUrl
    ? `<button class="image-preview-trigger job-review-thumb" type="button" data-action="preview-pal-image" data-image="${escape(job.publicUrl)}" data-name="${escape(jobTitle)}" aria-label="查看${escape(jobTitle)}大图"><img src="${escape(job.publicUrl)}" alt="${escape(jobTitle)}缩略图" loading="lazy" /></button>`
    : '';
  const reviewVideoNote = reviewable && job.kind === 'video' && status === 'SUCCEEDED'
    ? '<span class="job-review-kind">视频资源已取回；列表内不播放，可按下方地址核对后验收。</span>'
    : '';
  const derivedEntries = reviewable && job.derivedImages ? Object.entries(job.derivedImages) : [];
  const derivedRow = derivedEntries.length
    ? `<div class="job-derived" role="list" aria-label="五态动作拆分图">${derivedEntries.map(([code, entry]) => {
        const derivedApproved = entry?.reviewStatus === 'APPROVED';
        const derivedUrl = entry?.publicUrl || '';
        return `<span class="job-derived-item" role="listitem"><button class="image-preview-trigger job-derived-thumb" type="button" data-action="preview-pal-image" data-image="${escape(derivedUrl)}" data-name="${escape(`${jobTitle} · ${code}`)}" aria-label="查看${escape(jobTitle)}${escape(code)}拆分图大图"><img src="${escape(derivedUrl)}" alt="${escape(jobTitle)}${escape(code)}拆分图" loading="lazy" /></button><i class="review-badge ${derivedApproved ? 'approved' : 'pending'}">${derivedApproved ? '已验收' : '待验收'}</i></span>`;
      }).join('')}</div>`
    : '';
  const reviewBlock = reviewThumb || reviewVideoNote || derivedRow ? `<div class="job-review">${reviewThumb}${reviewVideoNote}${derivedRow}</div>` : '';
  const reviewButton = reviewable && status === 'SUCCEEDED' && !approved
    ? `<button class="secondary compact" data-action="review-resource" data-task="${escape(taskId)}"${job.active || rejected ? ' disabled' : ''}>确认验收</button>`
    : '';
  /* 打回重产：不满意（无论是否已验收）都可以打回；面板内可选原因与是否立即重产。 */
  const reworkButton = reviewable && status === 'SUCCEEDED' && !rejected
    ? `<button class="secondary compact danger-lite" data-action="rework-open" data-task="${escape(taskId)}"${job.active ? ' disabled' : ''}>打回重产</button>`
    : '';
  /* 失败任务（含参考阻塞、重试锁定）允许显式重新提交；管线按修复后的凭据/比例/契约
     决定真实重跑还是给出锁定原因，不会在原因未修时盲烧额度。 */
  const failed = ['FAILED', 'BLOCKED_REFERENCE'].includes(status);
  const reproduceButton = taskId && failed
    ? `<button class="secondary compact" data-action="reproduce-task" data-task="${escape(taskId)}" data-plan="${escape(job.planId || '')}" data-resource="${escape(job.resourceId || '')}">重新生产</button>`
    : '';
  const reworkPanel = reviewable && state.reworkTask === taskId
    ? `<div class="rework-panel"><p class="rework-title">打回「${escape(jobTitle)}」：标记为不通过，从展示与上桌资格中排除，任务记录保留可追溯。</p><label for="rework-reason">不满意的原因（可选，写入资产账目）</label><textarea id="rework-reason" rows="2" placeholder="例如：构图裁坏、人物身份不符、边缘噪点、风格不对…"></textarea><label for="rework-prompt-patch">给本次重产追加的提示词修改（可选）</label><textarea id="rework-prompt-patch" rows="2" placeholder="例如：保持林星同款半写实 CG 画风，但换成薄荷绿空姐制服…"></textarea><label class="rework-reproduce" for="rework-reproduce"><input id="rework-reproduce" type="checkbox" /> 同时触发该槽位重新生产（消耗 AIHub 额度，需有效令牌）</label><div class="rework-actions"><button class="primary compact" data-action="rework-submit" data-task="${escape(taskId)}"${state.workshopBusy ? ' disabled' : ''}>确认打回</button><button class="secondary compact" data-action="rework-cancel">取消</button></div></div>`
    : '';
  const details = [
    (taskId || jobId) && `任务 ID：${taskId || jobId}`,
    job.planId && `资源计划：${job.planKey || `PLAN-${String(job.planId).slice(0, 8).toUpperCase()}`} · ${job.planName || '未命名牌友'}${job.planVersion != null ? ` · v${job.planVersion}` : ''}${job.planDeleted ? ' · 计划已删除' : ''}`,
    job.planId && `资源计划 ID：${job.planId}`,
    job.resourceId && `资源：${job.resourceId}`,
    job.kind && `类型：${job.kind}`,
    job.route?.label && `生产路由：${job.route.label}`,
    job.provider && `Provider：${typeof job.provider === 'string' ? job.provider : job.provider.name || job.provider}`,
    job.providerRequestId && `Provider 请求：${job.providerRequestId}`,
    job.runId && `AIHub runId：${job.runId}`,
    job.attempt != null && `尝试次数：${job.attempt}`,
    job.bytes != null && `文件大小：${Number(job.bytes).toLocaleString()} bytes`,
    job.sha256 && `SHA-256：${job.sha256}`,
    job.publicUrl && `本地资源：${job.publicUrl}`,
    job.profileReferenceUrl && `角色资料卡参考：${job.profileReferenceUrl}`,
    job.provider?.model && `模型：${job.provider.model}`
  ].filter(Boolean);
  const trace = Array.isArray(job.trace) ? job.trace.at(-1) : '';
  const version = job.version ?? job.planSnapshot?.identity?.version ?? '—';
  const planKey = job.planKey || (job.planId ? `PLAN-${String(job.planId).slice(0, 8).toUpperCase()}` : '未关联计划');
  const planSummary = job.planId ? `${planKey} · ${job.planName || '未命名牌友'}${job.planVersion != null ? ` · v${job.planVersion}` : ''}` : '未关联资源计划';
  const summary = `<summary><span class="job-dot" aria-hidden="true"></span><span class="job-summary-copy"><b>${escape(job.label || label)}</b><small>${escape(job.promptSummary || job.resourceId || '牌友生产任务')} · ${tier} · v${escape(version)} · 资源计划：${escape(planSummary)}</small></span><i class="job-state">${escape(displayLabel)}</i>${reviewBadge}<span class="job-chevron" aria-hidden="true">⌄</span></summary>`;
  const content = `<div class="job-detail">${reviewBlock}${job.promptSummary ? `<p><b>任务描述</b><span>${escape(job.promptSummary)}</span></p>` : ''}${job.error ? `<p class="job-detail-error"><b>失败原因</b><span>${escape(job.error)}</span></p>` : trace ? `<p><b>最近记录</b><span>${escape(trace)}</span></p>` : ''}${details.map((line) => `<p><b>${escape(line.slice(0, line.indexOf('：')))}</b><span>${escape(line.slice(line.indexOf('：') + 1))}</span></p>`).join('')}${reworkPanel}<div class="job-detail-actions">${reviewButton}${reproduceButton}${reworkButton}${taskId ? `<button class="secondary compact" data-action="delete-production-task" data-task-id="${escape(taskId)}"${deletable ? '' : ' disabled'}>${deletable ? '删除任务记录' : '任务运行中，暂不可删除'}</button>` : jobId ? `<button class="secondary compact" data-action="delete-production-task" data-job-id="${escape(jobId)}"${deletable ? '' : ' disabled'}>${deletable ? '删除任务记录' : '任务运行中，暂不可删除'}</button>` : ''}<small>删除只移除任务记录，不删除已生成的文件或候选牌友。</small></div></div>`;
  return `<article class="production-job ${displayTone}"><details class="production-job-details" data-production-task="${escape(taskId || jobId)}">${summary}${content}</details></article>`;
}
function imagePreviewModal() {
  if (!state.imagePreview) return '';
  const { src, alt, name } = state.imagePreview;
  return `<div class="image-preview-modal" role="dialog" aria-modal="true" aria-label="查看${escape(name || '角色图片')}大图"><button class="image-preview-backdrop" type="button" data-action="close-image-preview" aria-label="关闭大图"></button><div class="image-preview-dialog"><button class="image-preview-close" type="button" data-action="close-image-preview" aria-label="关闭大图">×</button><img src="${escape(src)}" alt="${escape(alt || name || '角色图片')}" /><p>点击遮罩或右上角关闭</p></div></div>`;
}
function resourcePlanDetailMarkup(plan) {
  const planName = plan.identity?.name || 'AI 牌友';
  const portraitLabel = plan.identity?.name ? `${planName}角色资料卡` : '待确认的 AI 牌友角色资料卡';
  const portraitActionLabel = plan.identity?.name ? `查看${planName}角色资料卡大图` : '查看待确认角色资料卡大图';
  const gate = plan.portraitGate || { status: 'NOT_STARTED' };
  const gateApproved = gate.status === 'CONFIRMED';
  const taskLabel = (task) => {
    const outfitFilm = task?.resourceId === 'outfit-film';
    return ({ QUEUED: '已排队', WAITING_REFERENCE: '等待角色资料卡公网引用', WAITING_PORTRAIT_CONFIRMATION: '等待确认角色资料卡', RETRY_WAITING: '同路由准备重试', BLOCKED_REFERENCE: '缺少可访问角色资料卡', SUBMITTING: '正在提交', RUNNING: '生产中', SUCCEEDED: '已取回并校验', FAILED: '生产失败' })[task?.status] || '待提交';
  };
  const rows = (plan.resources || []).map((resource) => {
    const task = resource.task;
    const locked = resource.id !== 'master-portrait' && !gateApproved && !task;
    const status = task?.status || 'PLANNED';
    return `<li class="resource-row${locked ? ' locked' : ''}"><span class="resource-kind">${escape(resource.kind)}</span><span><b>${escape(resource.label)}</b><small>${escape(resource.route?.label || resource.production)} · ${escape(resource.production)} · ${escape(resource.acceptance)}</small>${task?.error ? `<small class="resource-error">${escape(task.error)}</small>` : ''}</span><em class="${resource.requiredForSeat ? 'seat-required' : ''}">${resource.requiredForSeat ? '上桌必需' : '增强表现'}</em><i class="resource-status ${locked ? 'locked' : escape(status.toLowerCase())}">${locked ? '确认角色资料卡后解锁' : escape(taskLabel(task))}</i></li>`;
  }).join('');
  const complete = plan.deliveryState === 'RICH_ASSETS_READY' || (plan.resources || []).every((resource) => !resource.requiredForSeat || (resource.task?.status === 'SUCCEEDED' && resource.task?.reviewStatus !== 'REJECTED'));
  const stepState = complete ? 'complete' : gate.status === 'CONFIRMED' ? 'production' : gate.status === 'AWAITING_CONFIRMATION' ? 'review' : 'portrait';
  const pipelineSteps = `<ol class="portrait-pipeline-steps" aria-label="资源生产步骤"><li class="${stepState === 'portrait' ? 'current' : 'done'}"><b>01</b><span>生成角色资料卡</span></li><li class="${stepState === 'review' ? 'current' : ['production', 'complete'].includes(stepState) ? 'done' : ''}"><b>02</b><span>你来确认资料卡</span></li><li class="${stepState === 'complete' ? 'done' : stepState === 'production' ? 'current' : ''}"><b>03</b><span>${stepState === 'complete' ? '生产完成' : '生产其余资源'}</span></li></ol>`;
  const portraitReview = gate.status === 'AWAITING_CONFIRMATION' && gate.publicUrl
    ? `<section class="portrait-review awaiting" aria-labelledby="portrait-review-title"><button class="image-preview-trigger portrait-review-image" type="button" data-action="preview-pal-image" data-image="${escape(gate.publicUrl)}" data-name="${escape(planName)}" aria-label="${escape(portraitActionLabel)}"><img src="${escape(gate.publicUrl)}" alt="${escape(portraitLabel)}" /></button><div class="portrait-review-copy"><p class="eyebrow">人工确认节点 · 02 / 03</p><h4 id="portrait-review-title">先确认这张角色资料卡</h4><p>资料卡已完成并写入候选资产，包含角色身份、动作、服装与配饰基准。请检查这些要素及视觉风格；确认后再点击“继续生产”，才会提交其余资源。</p><small>本次资料卡 SHA-256：${escape(String(gate.sha256 || '').slice(0, 12))}… · 公网参考 URL 已就绪</small><button class="primary compact" data-action="confirm-portrait" data-plan="${escape(plan.planId)}"${state.workshopBusy ? ' disabled' : ''}>确认这张资料卡</button></div></section>`
    : gate.status === 'CONFIRMED'
      ? `<section class="portrait-review confirmed" aria-label="已确认的角色资料卡"><button class="image-preview-trigger portrait-review-image" type="button" data-action="preview-pal-image" data-image="${escape(gate.publicUrl || '')}" data-name="${escape(planName)}" aria-label="查看${escape(planName)}角色资料卡大图"><img src="${escape(gate.publicUrl || '')}" alt="${escape(planName)}角色资料卡" /></button><div class="portrait-review-copy"><p class="eyebrow">人工确认节点 · 已通过</p><h4>角色资料卡已由你确认</h4><small>角色、动作、服装和配饰基准已锁定。确认记录已保存${gate.confirmedAt ? ` · ${escape(gate.confirmedAt)}` : ''}；点击下方“继续生产”后，所有下游节点都会注入这张资料卡的公网 URL。</small></div></section>`
      : gate.status === 'WAITING_REFERENCE'
        ? `<div class="portrait-gate-note pending" role="status"><b>角色资料卡已生成，正在等待公网 URL</b><span>资料卡必须先绑定可由 AIHub 工作流服务访问的 HTTPS 地址，绑定完成后才会开放人工确认。</span></div>`
      : gate.status === 'GENERATING'
        ? `<div class="portrait-gate-note generating" role="status"><b>角色资料卡生产中</b><span>其余 ${Math.max(0, (plan.resources || []).length - 1)} 项保持锁定，不会提前提交。</span></div>`
        : gate.status === 'FAILED'
          ? `<div class="portrait-gate-note failed" role="alert"><b>角色资料卡未能完成</b><span>${escape(gate.error || '检查任务状态后可按原路由重试；其他资源仍未提交。')}</span></div>`
          : `<div class="portrait-gate-note" role="status"><b>下一步只生成角色资料卡</b><span>完成后先由你预览确认，确认之前不会提交其余 ${Math.max(0, (plan.resources || []).length - 1)} 项资源。</span></div>`;
  const nextLine = gate.status === 'CONFIRMED'
    ? complete ? '必需资源已生产完成，已进入“可确认资产”；确认后才会应用到下一局。' : '节点 03 已解锁；各项生产状态在下方资源清单中逐项更新。'
    : gate.status === 'AWAITING_CONFIRMATION' ? '当前停在人工确认门禁：不确认就不会生产下一批资源。'
      : gate.status === 'GENERATING' ? '正在生产唯一首批资源：角色资料卡。'
        : gate.status === 'FAILED' ? '角色资料卡失败；请先完成资料卡重试或移除这份计划。'
        : '生产顺序已锁定：角色资料卡 → 公网 URL → 用户确认 → 其他资源。';
  const actionLabel = gate.status === 'CONFIRMED' ? (complete ? '已进入可确认资产' : '继续生产未完成资源') : gate.status === 'GENERATING' ? '角色资料卡生产中…' : gate.status === 'WAITING_REFERENCE' ? '等待资料卡公网 URL' : gate.status === 'AWAITING_CONFIRMATION' ? '等待你确认角色资料卡' : gate.status === 'FAILED' ? '重试角色资料卡' : '只生成角色资料卡';
  const actionDisabled = state.workshopBusy || complete || gate.status === 'GENERATING' || gate.status === 'WAITING_REFERENCE' || gate.status === 'AWAITING_CONFIRMATION';
  const profile = plan.profileCard || {};
  const profileNote = `<p class="profile-card-note"><b>角色资料卡</b>：${escape(profile.character?.name || planName)} · ${escape(profile.clothing?.label || plan.intent?.clothingLabel || '按文字描述')} · ${escape(profile.accessory?.label || plan.intent?.accessoryLabel || '无')} · 动作基准：待机 / 出牌 / 过牌 / 胜利 / 失利</p>`;
  return `${pipelineSteps}<p class="plan-next">${escape(nextLine)}</p>${portraitReview}${profileNote}<p class="style-lock-note"><b>视觉风格锁定</b>：与当前林星保持同一套画面制作语言——半写实电影级游戏 CG、深午夜蓝紫调、香槟金轮廓光、真实材质与景深；只变化新牌友的身份与服装，不复刻林星本人。</p><div class="resource-actions${complete ? ' complete' : ''}"><button class="primary compact${complete ? ' production-complete' : ''}" data-action="submit-resource-plan" data-plan="${escape(plan.planId)}"${actionDisabled ? ' disabled' : ''}>${escape(actionLabel)}</button><small>角色资料卡 → AIHub gpt-image2；其他图片 → AIHub jimeng；入场/五态动作视频 → AIHub Seedance；只有首套跳舞视频 → 指定跳舞工作流。</small></div><ul class="resource-grid">${rows}</ul>`;
}
function resourcePlan(plan) {
  const counts = plan.counts || {};
  const planName = plan.identity?.name || 'AI 牌友';
  const gate = plan.portraitGate || { status: 'NOT_STARTED' };
  const countLine = [counts.image && `${counts.image} 图`, counts.video && `${counts.video} 视频`, counts.text && `${counts.text} 台词`, counts.record && `${counts.record} 审核`].filter(Boolean).join(' · ');
  const complete = plan.deliveryState === 'RICH_ASSETS_READY' || (plan.resources || []).every((resource) => !resource.requiredForSeat || (resource.task?.status === 'SUCCEEDED' && resource.task?.reviewStatus !== 'REJECTED'));
  /* 完整包的必需资源已齐备且没有被打回，即为该资源计划的终态。
     「确认并上桌」属于候选牌友的后续操作，不能再把计划标为待验收。 */
  const gateLabel = complete ? '已完成' : plan.deliveryState === 'ASSET_REWORK_REQUIRED' ? `需重产 · ${plan.deliverySummary?.failed || 0} 项不合格` : plan.deliveryState === 'ASSET_PRODUCING' ? `生产中 · ${plan.deliverySummary?.active || 0} 项` : ({ CONFIRMED: '已确认 · 可继续生产', AWAITING_CONFIRMATION: '等待确认角色资料卡', WAITING_REFERENCE: '等待资料卡公网 URL', GENERATING: '角色资料卡生产中', FAILED: '角色资料卡失败', NOT_STARTED: '待生成角色资料卡' })[gate.status] || gate.status;
  const planKey = `PLAN-${String(plan.planId || '').slice(0, 8).toUpperCase()}`;
  return `<article class="resource-plan" data-plan-id="${escape(plan.planId)}"><div class="resource-plan-list-row"><div class="resource-plan-list-copy"><p class="eyebrow">${escape(planKey)} · ${escape(plan.seatGate || 'RESOURCE_PLAN')}</p><h3>${escape(plan.packageLabel || '资源计划')}</h3><p>${escape(planName)}${plan.identity?.version != null ? ` · v${escape(plan.identity.version)}` : ''} · ${escape(plan.packageSummary || '')}</p></div><div class="resource-plan-list-meta"><b>${escape(countLine || '待规划')}</b><span>${escape(gateLabel)}</span></div><button class="secondary compact resource-plan-detail-button" type="button" data-action="view-resource-plan" data-plan="${escape(plan.planId)}">查看详情</button></div></article>`;
}
function resourcePlanModal(plan) {
  const planName = plan?.identity?.name || 'AI 牌友';
  if (!plan) return '';
  const planKey = `PLAN-${String(plan.planId || '').slice(0, 8).toUpperCase()}`;
  const hasActiveTask = (plan.resources || []).some((resource) => resource.task?.active);
  const deleteLabel = hasActiveTask ? '生产中不可删除' : '删除资源计划';
  return `<div class="resource-plan-modal" role="dialog" aria-modal="true" aria-labelledby="resource-plan-modal-title"><button class="resource-plan-modal-backdrop" type="button" data-action="close-resource-plan" aria-label="关闭资源计划详情"></button><div class="resource-plan-modal-dialog"><div class="resource-plan-modal-head"><div><p class="eyebrow">${escape(planKey)} · RESOURCE PLAN · PRODUCTION DETAIL</p><h2 id="resource-plan-modal-title">${escape(planName)} · ${escape(plan.packageLabel || '资源计划')}</h2><p class="resource-plan-modal-id">计划 ID：${escape(plan.planId)}${plan.identity?.version != null ? ` · 版本 v${escape(plan.identity.version)}` : ''}</p></div><div class="resource-plan-modal-head-actions"><button class="secondary compact resource-plan-delete-button" type="button" data-action="delete-resource-plan" data-plan="${escape(plan.planId)}"${hasActiveTask ? ' disabled aria-disabled="true"' : ''}>${deleteLabel}</button><button class="resource-plan-modal-close" type="button" data-action="close-resource-plan" aria-label="关闭资源计划详情">×</button></div></div><div class="resource-plan-modal-body">${resourcePlanDetailMarkup(plan)}</div></div></div>`;
}
function renderWorkshop() {
  /* 生产轮询会周期性重绘工坊。详情浮窗的滚动容器必须跨重绘保留
     scrollTop，否则用户向下查看长资源计划时会被每次状态刷新弹回顶部。 */
  const resourceModalBody = app.querySelector('.resource-plan-modal-body');
  const resourceModalScrollTop = resourceModalBody?.scrollTop || 0;
  const openResourcePlans = new Set([...app.querySelectorAll('.resource-plan-fold[open]')].map((node) => node.closest('.resource-plan')?.dataset.planId).filter(Boolean));
  const taskListExpanded = app.querySelector('.production-task-list')?.open === true;
  const openProductionTasks = new Set([...app.querySelectorAll('.production-job-details[open]')].map((node) => node.dataset.productionTask).filter(Boolean));
  /* 候选资源原先只存在服务进程内存；服务重启后已建档的牌友仍在
     confirmed-pals.json，却从工坊列表消失。把持久化名册补入同一列表，
     让“已建档 / 已排入牌局”的状态始终可见，而不是把它误报成丢失。 */
  const transientCandidates = state.workshop?.versions || [];
  const jobs = state.workshop?.jobs || [];
  const plans = state.workshop?.plans || [];
  const detailPlan = plans.find((plan) => plan.planId === state.resourcePlanDetail);
  const capability = state.workshop?.generation || { routes: { image: { configured: false }, video: { configured: false } } };
  const routes = capability.routes || capability;
  const confirmedRecords = Array.isArray(state.workshop?.confirmed) ? state.workshop.confirmed : state.workshop?.confirmed ? [state.workshop.confirmed] : [];
  const confirmedIds = new Set(confirmedRecords.map((asset) => asset?.palId).filter(Boolean));
  const transientIds = new Set(transientCandidates.map((entry) => entry?.asset?.palId).filter(Boolean));
  const restoredConfirmedCandidates = confirmedRecords
    .filter((asset) => asset?.palId && !transientIds.has(asset.palId))
    .map((asset) => ({
      asset,
      intent: { style: asset.identity?.style || asset.appearance?.outfit || '已建档牌友' },
      package: { state: 'RICH_ASSETS_READY' },
      provider: { name: '已建档资源包（持久化恢复）' }
    }));
  const history = [...transientCandidates, ...restoredConfirmedCandidates];
  /* 模板仍沿用旧变量名，值改为多牌友的 Set。 */
  const confirmedId = confirmedIds;
  const draftLen = [...state.workshopPrompt.trim()].length;
  const counterShort = draftLen > 0 && draftLen < 6;
  const videoReferenceUrl = state.workshopVideoReferenceUrl || routes.video?.defaultReferenceUrl || '';
  const active = jobs.some((job) => job.active);
  const runningJobs = jobs.filter((job) => job.active).length;
  const failedJobs = jobs.filter((job) => ['FAILED', 'BLOCKED_REFERENCE'].includes(job.stage || job.status)).length;
  /* 生产任务属于具体资源计划。合并计划列表和任务元数据，计划删除后保留的
     历史任务也可被筛选、查看和删除。 */
  const taskPlanOptions = new Map();
  for (const plan of plans) taskPlanOptions.set(plan.planId, { planId: plan.planId, name: plan.identity?.name || '未命名牌友', version: plan.identity?.version, deleted: false });
  for (const job of jobs) if (job.planId && !taskPlanOptions.has(job.planId)) taskPlanOptions.set(job.planId, { planId: job.planId, name: job.planName || '已删除计划', version: job.planVersion, deleted: true });
  if (state.workshopTaskPlanFilter && !taskPlanOptions.has(state.workshopTaskPlanFilter)) state.workshopTaskPlanFilter = '';
  const filteredJobs = state.workshopTaskPlanFilter ? jobs.filter((job) => job.planId === state.workshopTaskPlanFilter) : jobs;
  const filteredRunningJobs = filteredJobs.filter((job) => job.active).length;
  const filteredFailedJobs = filteredJobs.filter((job) => ['FAILED', 'BLOCKED_REFERENCE'].includes(job.stage || job.status)).length;
  const taskPlanSelectOptions = [...taskPlanOptions.values()].sort((a, b) => Number(b.version || 0) - Number(a.version || 0)).map((plan) => {
    const key = `PLAN-${String(plan.planId).slice(0, 8).toUpperCase()}`;
    const label = `${key} · ${plan.name}${plan.version != null ? ` · v${plan.version}` : ''}${plan.deleted ? ' · 计划已删除' : ''}`;
    return `<option value="${escape(plan.planId)}"${state.workshopTaskPlanFilter === plan.planId ? ' selected' : ''}>${escape(label)}</option>`;
  }).join('');
  const taskPlanFilter = jobs.length ? `<label class="production-task-filter" for="productionTaskPlanFilter"><span>查看资源计划</span><select id="productionTaskPlanFilter" name="productionTaskPlanFilter"><option value=""${state.workshopTaskPlanFilter ? '' : ' selected'}>全部资源计划（${jobs.length} 项任务）</option>${taskPlanSelectOptions}</select></label>` : '';
  const jobSummary = jobs.length ? `<details class="production-task-list"><summary><span>${state.workshopTaskPlanFilter ? '展开当前计划任务' : '展开任务列表'}</span><span class="task-list-meta">${filteredJobs.length} 项 · ${filteredRunningJobs} 处理中 · ${filteredFailedJobs} 失败${state.workshopTaskPlanFilter ? ` · 共 ${jobs.length} 项` : ''}</span><span class="job-chevron" aria-hidden="true">⌄</span></summary><div class="production-task-items">${filteredJobs.map(workshopJob).join('') || '<div class="empty-line">该资源计划暂时没有生产任务。</div>'}</div></details>` : '<div class="empty-line">尚未提交生产任务。</div>';
  const submitLabel = '提交完整包生产';
  const clothingOptions = WORKSHOP_CLOTHING_OPTIONS.map(([value, label]) => `<option value="${value}"${state.workshopClothing === value ? ' selected' : ''}>${label}</option>`).join('');
  const accessoryOptions = WORKSHOP_ACCESSORY_OPTIONS.map(([value, label]) => `<option value="${value}"${state.workshopAccessory === value ? ' selected' : ''}>${label}</option>`).join('');
  app.innerHTML = `<section class="workshop"><div class="workshop-intro"><p class="eyebrow">RESOURCE-PACK PIPELINE · POLICY GATES ON</p><h1>牌友工坊</h1></div><form class="generator" id="generator" novalidate><label for="palName">牌友名字（可编辑）</label><input id="palName" name="palName" type="text" autocomplete="off" maxlength="16" aria-describedby="pal-name-note" value="${escape(state.workshopName)}" placeholder="例如：墨鸢"><p class="form-note" id="pal-name-note">用于牌桌、写真馆和牌友名册；留空将自动生成自然中文名。</p><label for="prompt">描述你的成年虚构牌友</label><textarea id="prompt" name="pal-prompt" autocomplete="off" aria-required="true" aria-describedby="prompt-note charCounter prompt-error" aria-invalid="${Boolean(state.workshopError)}" placeholder="例如：一位复古优雅的成年虚构魔术师，喜欢舞台灯光与蓝紫配色…">${escape(state.workshopPrompt)}</textarea><p class="char-counter${counterShort ? ' short' : ''}" id="charCounter">已输入 ${draftLen} 字 · 至少 6 字</p><label for="videoReferenceUrl">参考舞蹈视频 URL（可选）</label><input id="videoReferenceUrl" name="videoReferenceUrl" type="url" autocomplete="url" aria-describedby="dance-reference-note" value="${escape(videoReferenceUrl)}" placeholder="留空使用默认 CS 参考视频"><p class="form-note dance-reference-note" id="dance-reference-note">有输入就使用你的链接；留空使用默认 CS 视频。请输入 AIHub 可公网读取的 HTTPS 视频地址。</p><p class="form-note" id="prompt-note">交付范围固定为完整首发包：角色资料卡确认后，才会继续生产牌桌立绘、卡面、五态动作、入场与换装演出等全部资源。先建立计划不调用 Provider；生产只在真实 Provider 已配置时发起。</p><p class="field-error" id="prompt-error" role="alert">${escape(state.workshopError)}</p><div class="generator-actions"><button class="secondary" type="button" data-action="plan-package"${state.workshopBusy ? ' disabled' : ''}>建立完整资产计划</button><button class="primary" type="submit"${state.workshopBusy || active ? ' disabled' : ''}>${active ? '生产处理中…' : state.workshopBusy ? '正在提交…' : submitLabel} <span aria-hidden="true">→</span></button></div></form><section class="version-chain"><div class="resource-plans"><h2>资源计划${plans.length ? ` · ${plans.length}` : ''}</h2>${plans.length ? plans.slice().reverse().map(resourcePlan).join('') : '<div class="empty-line">先填写描述并建立资源计划；计划本身不会伪造已生产的图片或视频。</div>'}</div><div class="production-tasks"><h2 class="asset-chain-title">生产任务${jobs.length ? ` · ${jobs.length}` : ''}</h2>${taskPlanFilter}${jobSummary}</div><div class="confirmed-assets"><h2 class="asset-chain-title">可确认资产</h2>${history.length ? history.slice().reverse().map((entry) => workshopCandidate(entry, confirmedId)).join('') : '<div class="empty-line">只有完整首发包资源齐全后，才会出现在这里供确认建档。</div>'}</div></section>${imagePreviewModal()}${resourcePlanModal(detailPlan)}</section>`;
  if (state.resourcePlanDetail && resourceModalScrollTop > 0) {
    const restoreResourceModalScroll = () => {
      const body = app.querySelector('.resource-plan-modal-body');
      if (!body) return;
      body.scrollTop = Math.min(resourceModalScrollTop, Math.max(0, body.scrollHeight - body.clientHeight));
    };
    restoreResourceModalScroll();
    requestAnimationFrame(restoreResourceModalScroll);
  }
  const resourcePlans = app.querySelector('.resource-plans');
  if (resourcePlans) { resourcePlans.tabIndex = 0; resourcePlans.setAttribute('role', 'region'); resourcePlans.setAttribute('aria-label', '资源计划详情'); }
  /* 结构化服装/配饰选择器放在自由描述后，避免把可选项混进用户提示词；值会随计划快照保存。 */
  const promptNode = app.querySelector('#prompt');
  if (promptNode && !app.querySelector('#clothingStyle')) {
    const picker = document.createElement('div');
    picker.className = 'customization-picker';
    picker.innerHTML = `<div><label for="clothingStyle">服装选择</label><select id="clothingStyle" name="clothingStyle">${clothingOptions}</select><p class="form-note">选择会写入角色资料卡，并同步到所有图片与视频。</p></div><div><label for="accessory">配饰选择</label><select id="accessory" name="accessory">${accessoryOptions}</select><p class="form-note">配饰会锁定在资料卡和生视频参考图中。</p></div>`;
    promptNode.insertAdjacentElement('afterend', picker);
  }
  for (const fold of app.querySelectorAll('.resource-plan-fold')) if (openResourcePlans.has(fold.closest('.resource-plan')?.dataset.planId)) fold.open = true;
  const taskList = app.querySelector('.production-task-list');
  if (taskList && taskListExpanded) taskList.open = true;
  for (const fold of app.querySelectorAll('.production-job-details')) if (openProductionTasks.has(fold.dataset.productionTask)) fold.open = true;
  if (state.workshopError) requestAnimationFrame(() => { const box = document.querySelector('#prompt'); box?.focus(); try { box.setSelectionRange(box.value.length, box.value.length); } catch { /* setSelectionRange 不可用时仅聚焦 */ } });
}
function renderInspector() {
  app.innerHTML = `<section class="inspector"><div><p class="eyebrow">INTERNAL QA · READ ONLY</p><h1>运行检查器</h1><p>用于核对 Contract、降级、Token 账本和审核链路；不是面向玩家的功能。</p></div><pre id="inspectOutput">正在读取本地运行时…</pre></section>`;
  api('/api/inspect').then((data) => { document.querySelector('#inspectOutput').textContent = JSON.stringify(data, null, 2); }).catch((err) => notice(err.message, true));
}
function resourceSubmitFeedback(result) {
  if (result.status === 'PROVIDER_UNAVAILABLE') return { error: true, text: `${result.gate}：${result.reason}` };
  if (result.status === 'PORTRAIT_SUBMITTED') return { text: '已提交角色资料卡生产。其他资源保持锁定，等你预览并确认资料卡后才会继续。' };
  if (result.status === 'AWAITING_PORTRAIT_CONFIRMATION') return { text: '角色资料卡已经生成，请先在资源计划中预览并确认；其余资源尚未提交。' };
  if (result.status === 'PORTRAIT_GENERATING') return { text: '角色资料卡正在生产中；不会提前提交其他资源。' };
  if (result.status === 'PORTRAIT_REQUIRED') return { error: true, text: '生产被门禁拦截：必须先生成角色资料卡并由用户确认。' };
  if (result.status === 'PROFILE_REFERENCE_REQUIRED') return { error: true, text: result.reason || '角色资料卡缺少可访问公网 URL，未提交下游资源。' };
  if (result.status === 'AWAITING_CONTINUE') return { text: '角色资料卡确认已保存；请点击“继续生产未完成资源”提交下游。' };
  if (result.status === 'SUBMITTED') return { text: `角色资料卡已确认，已提交 ${result.tasks.length} 项下游资源；入场/五态动作视频走 Seedance，首套跳舞视频走指定跳舞工作流。` };
  return { error: true, text: '生产服务返回了未识别状态。' };
}

/* ---------- flow control ---------- */
/* 牌友回合：出牌与叫分共用这条调度，但走不同的服务端命令——
   叫分阶段的决定会改变阵营归属，不能混进出牌回合里。 */
function scheduleNpcTurn() {
  const bidding = state.game?.phase === 'BIDDING';
  const needsNpcTurn = state.route === 'table' && (bidding || state.game?.phase === 'PLAYING') && state.game.turn !== 'player';
  if (!needsNpcTurn) { clearTimeout(state.npcTimer); state.npcTimer = null; return; }
  if (state.npcTimer) return;
  state.npcTimer = window.setTimeout(async () => {
    state.npcTimer = null;
    try {
      const path = bidding ? '/api/game/advance-bid' : '/api/game/advance-turn';
      state.game = await api(path, { method: 'POST', body: JSON.stringify({ gameId: state.game.id, commandId: commandId() }) });
      const last = state.game.events.slice().reverse().find((item) => item.type === 'PAL_ACTION');
      if (last) { if (last.decision === 'PLAY') playCardAudio(last.combo, { ai: true }); else sfx('pass', { volume: .65 }); }
      else sfx('select');
      render();
    }
    catch (err) { notice(`${bidding ? '牌友叫分' : '牌友回合'}未完成：${err.message}`, true); }
  }, npcDelay());
}
function render() {
  const activePhotoOption = document.activeElement?.dataset?.photoOption;
  updateToken();
  applyPrefs();
  document.querySelectorAll('nav a').forEach((link) => { const active = link.dataset.route === state.route; link.classList.toggle('active', active); if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); });
  ({ home: renderHome, table: renderTable, workshop: renderWorkshop, gallery: renderGallery, inspector: renderInspector }[state.route] || renderHome)();
  document.querySelector('.photo-studio')?.remove();
  document.body.classList.toggle('studio-open', Boolean(state.studioGame));
  app.inert = Boolean(state.studioGame);
  document.querySelector('.topbar').inert = Boolean(state.studioGame);
  if (state.studioGame && state.photoDraft) {
    const cards = state.galleryCards.filter((c) => c.palId === state.photoDraft.palId);
    document.body.insertAdjacentHTML('beforeend', studioMarkup({ gameId: state.studioGame, draft: state.photoDraft, cards, name: palName(state.photoDraft.palId) }));
  }
  syncVideoAudio();
  updateAudioScene(state.game, state.route, Boolean(document.querySelector('.dance-stage video')));
  scheduleNpcTurn();
  updateGalleryBadge();
  if (state.game?.phase === 'SETTLED' && state.game?.settlement && state.sfxFiredFor !== state.game.id) {
    state.sfxFiredFor = state.game.id;
    sfx(state.game.settlement.winnerId === 'player' ? 'win' : 'lose');
  }
  if (state.game?.phase === 'SETTLED' && state.game.settlementStage === 'PHOTO_REVEAL' && state.game.settlement?.card) flyCardOnce(state.game);
  if (state.studioGame) requestAnimationFrame(() => {
    const target = activePhotoOption ? document.querySelector(`[data-photo-option="${activePhotoOption}"]`) : document.querySelector('#studio-title');
    target?.focus({ preventScroll: true });
  });
  else if (state.entry) requestAnimationFrame(() => {
    document.querySelector('[data-action="close-entry"]')?.focus();
    const segs = Array.from(document.querySelectorAll('[data-entry-seg]'));
    const caption = document.querySelector('[data-entry-caption]');
    const closeEntry = () => { state.entry = false; render(); };
    const showNext = (index) => {
      const next = segs[index + 1];
      if (!next) { closeEntry(); return; }
      next.classList.add('show');
      if (caption) caption.innerHTML = `<b>${escape(next.dataset.entryName || '')}</b><span>${escape(next.dataset.entryDance || '')} · 已就位</span>`;
      next.querySelector('video')?.play().catch(closeEntry);
    };
    segs.forEach((segment, index) => {
      const video = segment.querySelector('video');
      /* 首帧真正可绘制前保留同源 poster，不能让网络/解码的短暂空窗变成黑屏。
         尤其是刚替换的横版入场片，玩家先看到角色封面，再无缝切进动态。 */
      const revealVideo = () => segment.classList.add('ready');
      video?.addEventListener('loadeddata', revealVideo, { once: true });
      video?.addEventListener('playing', revealVideo, { once: true });
      video?.addEventListener('ended', () => showNext(index), { once: true });
      video?.addEventListener('error', () => showNext(index), { once: true });
    });
    /* 自动播放在某些浏览器/机器上会被策略拦截，但「跳过入场」仍必须留在屏幕上给用户，
       不能因为播放承诺失败就把 overlay 自己销毁——那会和刚点下去的 skip 发生 DOM 脱离竞态。 */
    segs[0]?.querySelector('video')?.play().catch(() => {});
  });
  else if (state.imagePreview) requestAnimationFrame(() => document.querySelector('[data-action="close-image-preview"]')?.focus());
  else if (state.resourcePlanDetail) requestAnimationFrame(() => document.querySelector('[data-action="close-resource-plan"]')?.focus());
  else if (state.detail) requestAnimationFrame(() => document.querySelector('[data-action="close-detail"]')?.focus());
  else if (state.replay) requestAnimationFrame(() => {
    document.querySelector('[data-action="close-replay"]')?.focus();
    const video = document.querySelector('[data-replay-video]');
    if (video) {
      video.play().catch(() => {});
      video.addEventListener('error', () => {
        const host = video.closest('.vframe');
        if (host && !host.querySelector('.replay-video-error')) host.insertAdjacentHTML('beforeend', '<div class="replay-video-error" role="alert"><span>视频暂时无法加载，请检查资源后重试，或跳过回放查看静态卡面。</span><div class="replay-video-error-actions"><button class="secondary compact" data-action="replay-video-retry">重新加载</button><button class="secondary compact" data-action="close-replay">跳过回放</button></div></div>');
      }, { once: true });
    }
  });
  else if (state.game?.phase === 'SETTLED' && state.game.settlementStage) requestAnimationFrame(() => document.querySelector('.dance-stage .primary, .settlement .primary')?.focus());
  if (state.game?.settlementStage === 'PERFORMANCE') requestAnimationFrame(() => {
    const settleVideo = document.querySelector('[data-settlement-video]');
    if (!settleVideo) return;
    const cardRecord = repairGalleryCard(state.game.settlement?.card);
    /* 视频可能被包在信箱式容器里，换图要换掉整个容器——只摘掉 <video> 会留下一个空框。 */
    const host = settleVideo.closest('.vframe') || settleVideo;
    const swapToDressup = () => {
      if (!cardRecord || !host.isConnected) return;
      host.insertAdjacentHTML('afterend', dressupFigure(cardRecord));
      host.remove();
    };
    settleVideo.addEventListener('ended', swapToDressup, { once: true });
    settleVideo.addEventListener('error', swapToDressup, { once: true });
  });
}
function updateGalleryBadge() {
  const link = document.querySelector('nav a[data-route="gallery"]');
  if (!link) return;
  const unseen = state.galleryCards.filter((entry) => !entry.seen).length;
  link.classList.toggle('has-badge', unseen > 0);
  link.dataset.badge = unseen || '';
}
function flyCardOnce(game) {
  const key = `${game.id}:${game.settlement.card.cardId}:${game.settlement.card.upgradeLevel}`;
  if (state.flownFor === key || reducedMotion()) { state.flownFor = key; return; }
  state.flownFor = key;
  requestAnimationFrame(() => {
    const source = document.querySelector('.photo-card-reveal .pcard-art');
    const target = document.querySelector('nav a[data-route="gallery"]');
    if (!source || !target) return;
    const from = source.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    const ghost = source.cloneNode(true);
    ghost.className = `${source.className} fly-ghost`;
    Object.assign(ghost.style, { position: 'fixed', left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px`, margin: 0, zIndex: 90, pointerEvents: 'none' });
    document.body.appendChild(ghost);
    const dx = to.left + to.width / 2 - (from.left + from.width / 2);
    const dy = to.top + to.height / 2 - (from.top + from.height / 2);
    ghost.animate([
      { transform: 'translate(0,0) scale(1)', opacity: 1 },
      { transform: `translate(${dx * 0.5}px,${dy * 0.6}px) scale(.42) rotate(-6deg)`, opacity: .95, offset: .55 },
      { transform: `translate(${dx}px,${dy}px) scale(.08)`, opacity: .2 }
    ], { duration: 1100, easing: 'cubic-bezier(.3,.7,.3,1)' }).onfinish = () => { ghost.remove(); target.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.25)' }, { transform: 'scale(1)' }], { duration: 420 }); };
  });
}
async function refreshGallery() { const payload = await api('/api/gallery'); state.galleryCards = (payload.cards || []).map(repairGalleryCard); state.collection = payload.collection || null; }
async function refreshWallet() { const wallet = await api('/api/game/wallet'); state.walletBalance = wallet.tokenBalance ?? wallet.balance; }
async function markSeen(cardId) {
  const record = state.galleryCards.find((entry) => entry.cardId === cardId);
  if (!record || record.seen) return;
  record.seen = true;
  try { await api('/api/gallery/seen', { method: 'POST', body: JSON.stringify({ cardId: record.sourceCardId || cardId }) }); } catch { record.seen = false; }
  updateGalleryBadge();
}
async function start() {
  const seed = Number(window.__DRESSBATTLE_SEED);
  const payload = {};
  if (Number.isInteger(seed) && seed > 0) payload.seed = seed;
  /* 座位由前端选定、服务端校验：服务端会拿名册逐个核对，未建档的 palId 直接拒绝开局。 */
  if (chosenSeats().length === 2) payload.seats = chosenSeats();
  state.game = await api('/api/game/new', { method: 'POST', body: JSON.stringify(payload) });
  state.walletBalance = state.game.tokenBalance;
  state.selected.clear(); state.entry = !window.__DRESSBATTLE_SKIP_ENTRY && entrySegments().length > 0; state.flownFor = null; state.route = 'table';
  if (location.hash !== '#/table') location.hash = '/table';
  if (state.partner?.sessionId) api('/api/partner/progress', { method: 'POST', body: JSON.stringify({ sessionId: state.partner.sessionId, percent: 30, stage: 'playing', message: '牌局开始' }) }).catch(() => {});
  render(); notice(`牌局已创建：已消耗 1 Token。轮到你叫分，叫 3 分可直接定地主。`);
}
/* 平台跳转入口：ticket 一次性，立即交后端兑换并从地址栏清除（协议 5.1 节）。 */
async function handlePartnerEntry() {
  const query = new URLSearchParams(location.search);
  const hashQuery = new URLSearchParams((location.hash.split('?')[1]) || '');
  const ticket = query.get('ticket') || hashQuery.get('ticket');
  if (!ticket) return;
  const templateId = query.get('template_id') || hashQuery.get('template_id') || '';
  const returnUrl = query.get('return_url') || hashQuery.get('return_url') || '';
  history.replaceState(null, '', `${location.pathname}${location.hash.split('?')[0] || '#/home'}`);
  try {
    const session = await api('/api/partner/session', { method: 'POST', body: JSON.stringify({ ticket, template_id: templateId, return_url: returnUrl }) });
    state.partner = { sessionId: session.sessionId, draftId: session.draft_id, templateId: session.template_id, returnUrl, submitted: false };
    notice('已进入平台创作会话。');
  } catch (err) {
    notice(`平台会话接入失败：${err.message}`, true);
  }
}
async function refreshWorkshop() { const payload = await api('/api/pals'); state.pals = payload.pals || payload.official || []; state.palIndex = Object.fromEntries(state.pals.map((pal) => [pal.palId, pal])); state.defaultSeats = payload.defaultSeats || null; state.workshop = payload.workshop; }
function isWorkshopEditorActive() {
  const activeElement = document.activeElement;
  return state.route === 'workshop'
    && activeElement instanceof HTMLElement
    && Boolean(activeElement.closest('.workshop'))
    && activeElement.matches('input, textarea, select, [contenteditable="true"]');
}
function pollWorkshopJobs() {
  clearTimeout(state.workshopPoller);
  const active = state.workshop?.jobs?.some((job) => job.active);
  if (state.route !== 'workshop' || !active) return;
  state.workshopPoller = window.setTimeout(async () => {
    try {
      await refreshWorkshop();
      /* 轮询重绘会销毁原生 select 弹层，也会重建任务详情的重产文字输入框。
         轮询照常更新状态；用户正在编辑工坊任意表单控件时，保留现有 DOM 与光标。 */
      if (!isWorkshopEditorActive()) render();
      pollWorkshopJobs();
    } catch (err) { notice(`生产状态读取失败：${err.message}`, true); }
  }, 900);
}
async function navigate(route, { updateHash = true } = {}) { 
  state.route = route;
  if (route !== 'gallery') { state.detail = null; state.replay = null; }
  if (route !== 'workshop') state.imagePreview = null;
  /* 离开牌桌就收镜：特写是牌桌上的一次切镜，不该跟着玩家跑到别的页面。 */
  if (route !== 'table') { state.closeup = null; state.closeupKey = null; clearTimeout(state.closeupTimer); }
  if (updateHash && location.hash !== `#/${route}`) location.hash = `/${route}`;
  /* /api/game 在「无牌局」时返回 { game: null }：不能把包装对象塞进 state.game，
     否则 renderTable 会在 game.players 上读到 undefined。 */
  if (route === 'table' && !state.game) { const payload = await api('/api/game'); state.game = payload?.game ?? (payload?.phase ? payload : null); }
  if (route === 'workshop') await refreshWorkshop();
  if (route === 'gallery') await refreshGallery();
  render();
  pollWorkshopJobs();
}

/* ---------- events ---------- */
document.addEventListener('click', async (event) => {
  primeAudio();
  const route = event.target.closest('[data-route]')?.dataset.route; if (route) { event.preventDefault(); return navigate(route); }
  const actionNode = event.target.closest('[data-action]');
  if (!actionNode) {
    const cardNode = event.target.closest('[data-card]');
    if (cardNode && state.game?.phase === 'PLAYING' && state.route === 'table') { const value = cardNode.dataset.card; state.selected.has(value) ? state.selected.delete(value) : state.selected.add(value); sfx('select'); return render(); }
    if (state.route === 'table' && state.selected.size && event.target.closest('.table-felt')) { state.selected.clear(); sfx('pass'); return render(); }
    return;
  }
  try {
    const action = actionNode.dataset.action;
    if (action === 'select-package') { state.workshopTier = 'launch'; state.workshopError = ''; render(); return; }
    if (action === 'view-resource-plan') { state.resourcePlanDetail = actionNode.dataset.plan || null; render(); return; }
    if (action === 'close-resource-plan') { state.resourcePlanDetail = null; render(); return; }
    if (action === 'replay-video-retry') { state.replay = state.replay ? { ...state.replay } : null; render(); return; }
    if (action === 'delete-resource-plan') {
      const planId = actionNode.dataset.plan;
      if (!planId || !window.confirm('删除这份资源计划记录？已生成文件与生产任务记录会保留，但计划将从资源计划列表移除。')) return;
      actionNode.disabled = true;
      const result = await api('/api/pals/plans/delete', { method: 'POST', body: JSON.stringify({ planId }) });
      state.resourcePlanDetail = null;
      await refreshWorkshop();
      render();
      pollWorkshopJobs();
      notice(result.filePreserved ? '资源计划已删除；已生成文件与生产任务记录仍保留。' : '资源计划已删除；生产任务记录仍保留。');
      return;
    }
    if (action === 'plan-package') {
      const trimmed = state.workshopPrompt.trim();
      if (trimmed.length < 6) { state.workshopError = 'PL-1：描述至少需要 6 个字符。'; notice(state.workshopError, true); render(); return; }
      state.workshopName = document.querySelector('#palName')?.value.trim() || '';
      state.workshopVideoReferenceUrl = document.querySelector('#videoReferenceUrl')?.value.trim() || '';
      state.workshopClothing = document.querySelector('#clothingStyle')?.value || 'described';
      state.workshopAccessory = document.querySelector('#accessory')?.value || 'none';
      state.workshopBusy = true; render();
      const planPayload = { prompt: trimmed, packageTier: 'launch', videoReferenceUrl: state.workshopVideoReferenceUrl, clothingStyle: state.workshopClothing, accessory: state.workshopAccessory };
      if (state.workshopName) planPayload.name = state.workshopName;
      const result = await api('/api/pals/plan', { method: 'POST', body: JSON.stringify(planPayload) });
      state.workshopBusy = false;
      if (result.status === 'BLOCKED') { state.workshopError = `${result.gate}：${result.reason}`; notice(state.workshopError, true); }
      else { state.workshopError = ''; state.workshopVideoReferenceUrl = result.danceReferenceVideoUrl || state.workshopVideoReferenceUrl; notice(`${result.packageLabel}已建立：${result.resources.length} 项资源待生产与验收。`); await refreshWorkshop(); }
      render();
      return;
    }
    if (action === 'submit-resource-plan') {
      state.workshopBusy = true; render();
      try {
        const result = await api('/api/pals/resources/submit', { method: 'POST', body: JSON.stringify({ planId: actionNode.dataset.plan }) });
        const feedback = resourceSubmitFeedback(result);
        state.workshopError = feedback.error ? feedback.text : '';
        notice(feedback.text, Boolean(feedback.error));
      } finally {
        state.workshopBusy = false;
        await refreshWorkshop(); render(); pollWorkshopJobs();
      }
      return;
    }
    if (action === 'delete-production-task') {
      const taskId = actionNode.dataset.taskId;
      const jobId = actionNode.dataset.jobId;
      if (!window.confirm('删除这条生产任务记录？已生成文件和候选牌友会保留；运行中的外部任务不能删除。')) return;
      actionNode.disabled = true;
      const result = await api('/api/pals/tasks/delete', { method: 'POST', body: JSON.stringify(taskId ? { taskId } : { jobId }) });
      await refreshWorkshop();
      render();
      pollWorkshopJobs();
      notice(result.filePreserved ? '任务记录已删除；已生成文件仍保留。' : '任务记录已删除。');
      return;
    }
    if (action === 'confirm-portrait') {
      state.workshopBusy = true; render();
      try {
        const result = await api('/api/pals/resources/portrait/confirm', { method: 'POST', body: JSON.stringify({ planId: actionNode.dataset.plan }) });
        const production = result.production || {};
        if (production.status === 'PROVIDER_UNAVAILABLE') {
          state.workshopError = '';
          notice(`角色资料卡确认已保存；其余资源暂未提交：${production.reason}`, true);
        } else {
          const feedback = resourceSubmitFeedback(production);
          state.workshopError = feedback.error ? feedback.text : '';
          notice(feedback.text, Boolean(feedback.error));
        }
      } finally {
        state.workshopBusy = false;
        await refreshWorkshop(); render(); pollWorkshopJobs();
      }
      return;
    }
    if (action === 'review-resource') {
      actionNode.disabled = true;
      try {
        const result = await api('/api/pals/resources/review', { method: 'POST', body: JSON.stringify({ taskId: actionNode.dataset.task }) });
        notice(`已验收：${result.task?.label || result.task?.resourceId || actionNode.dataset.task}`);
      } finally {
        await refreshWorkshop(); render(); pollWorkshopJobs();
      }
      return;
    }
    if (action === 'rework-open') { state.reworkTask = actionNode.dataset.task; render(); return; }
    if (action === 'reproduce-task') {
      actionNode.disabled = true;
      try {
        const result = await api('/api/pals/resources/restart', { method: 'POST', body: JSON.stringify({ taskId: actionNode.dataset.task }) });
        const status = result.task?.status;
        notice(['QUEUED', 'WAITING_REFERENCE', 'RETRY_WAITING', 'RUNNING', 'SUBMITTING'].includes(status) ? `已原地重启：${result.task?.label || result.task?.resourceId}（${status === 'RUNNING' ? '生产中' : status === 'QUEUED' ? '排队中' : '等待参考'}）。` : `已取回：${result.task?.label || result.task?.resourceId}（${status}）。`);
      } finally {
        await refreshWorkshop(); render(); pollWorkshopJobs();
      }
      return;
    }
    if (action === 'rework-cancel') { state.reworkTask = null; render(); return; }
    if (action === 'rework-submit') {
      const taskId = actionNode.dataset.task;
      const reason = document.getElementById('rework-reason')?.value || '';
      const promptPatch = document.getElementById('rework-prompt-patch')?.value || '';
      const reproduce = Boolean(document.getElementById('rework-reproduce')?.checked);
      actionNode.disabled = true;
      try {
        const result = await api('/api/pals/resources/reject', { method: 'POST', body: JSON.stringify({ taskId, reason, promptPatch, reproduce, scope: 'RESOURCE_ONLY' }) });
        state.reworkTask = null;
        notice(reproduce ? `已打回并提交重产：${result.task?.label || result.task?.resourceId || taskId}` : `已打回：${result.task?.label || result.task?.resourceId || taskId} 标记为不通过。`);
      } finally {
        await refreshWorkshop(); render(); pollWorkshopJobs();
      }
      return;
    }
    if (action === 'open-studio') { await openStudio(state.game.id, state.game.settlement.card); return; }
    if (action === 'close-studio') { state.studioGame = null; state.photoDraft = null; render(); return; }
    if (action === 'compose-pending') { const reward = state.collection.pending.find((r) => r.gameId === actionNode.dataset.game); const card = state.galleryCards.find((c) => c.cardId === reward?.cardId) || state.galleryCards.find((c) => c.palId === reward?.palId); if (reward && card) await openStudio(reward.gameId, card); return; }
    if (action === 'edit-creation') { const c = state.collection.creations.find((c) => c.gameId === actionNode.dataset.game); if (c) await openStudio(c.gameId, c); return; }
    if (action === 'export-creation') { const c = state.collection.creations.find((c) => c.creationId === actionNode.dataset.creation); if (c) await exportPhoto(c); return; }
    if (action === 'audio-settings') { document.querySelector('#audio-settings').hidden = !document.querySelector('#audio-settings').hidden; return; }
    if (action === 'toggle-speed') { cycleSpeed(); applyPrefs(); const label = SPEED_LABEL[prefs().speed]; notice(`牌友思考速度：${label}`); return; }
    if (action === 'toggle-sfx') { setPref('sfx', !prefs().sfx); applyPrefs(); primeAudio(); syncVideoAudio(); sfx('select'); notice(prefs().sfx ? '音效已开启。' : '音效已关闭。'); return; }
    if (action === 'start' || action === 'restart') return start();
    if (action === 'partner-return') {
      if (!state.partner?.sessionId) return;
      actionNode.disabled = true;
      const result = await api('/api/partner/submit', { method: 'POST', body: JSON.stringify({ sessionId: state.partner.sessionId }) });
      state.partner.submitted = true;
      /* 回跳平台 return_url，可附 work_id 与 result=ok（导航参数仅用于跳转，平台会重新核对作品状态）。 */
      const target = new URL(state.partner.returnUrl || result.work_url || location.origin);
      if (result.work_id) target.searchParams.set('work_id', result.work_id);
      target.searchParams.set('result', 'ok');
      location.href = target.toString();
      return;
    }
    if (action === 'cycle-seat') { cycleSeat(Number(actionNode.dataset.index)); sfx('select'); render(); return; }
    if (action === 'bid') sfx('deal');
    if (action === 'bid') state.game = await api('/api/game/bid', { method: 'POST', body: JSON.stringify({ gameId: state.game.id, score: Number(actionNode.dataset.score), commandId: commandId() }) });
    if (action === 'grab') state.game = await api('/api/game/grab', { method: 'POST', body: JSON.stringify({ gameId: state.game.id, accept: actionNode.dataset.accept === '1', commandId: commandId() }) });
    if (action === 'hint') { const hint = await api(`/api/game/hint?gameId=${state.game.id}`); state.selected = new Set(hint.cards); notice(hint.message); }
    if (action === 'play') { state.game = await api('/api/game/play', { method: 'POST', body: JSON.stringify({ gameId: state.game.id, cards: [...state.selected], commandId: commandId() }) }); state.selected.clear(); const combo = state.game.currentCombo; playCardAudio(combo); }
    if (action === 'pass') { state.game = await api('/api/game/pass', { method: 'POST', body: JSON.stringify({ gameId: state.game.id, commandId: commandId() }) }); state.selected.clear(); sfx('pass'); }
    if (action === 'advance') {
      if (state.game.settlementStage === 'DESTINATION') return start();
      state.game = await api('/api/game/settlement/advance', { method: 'POST', body: JSON.stringify({ gameId: state.game.id }) });
      state.walletBalance = state.game.tokenBalance;
      if (state.partner?.sessionId && state.game.settlementStage === 'RESULT') api('/api/partner/progress', { method: 'POST', body: JSON.stringify({ sessionId: state.partner.sessionId, percent: 80, stage: 'settlement', message: '进入结算演出' }) }).catch(() => {});
      if (['PHOTO_REVEAL', 'DESTINATION'].includes(state.game.settlementStage)) await refreshGallery();
      if (state.game.settlementStage === 'PHOTO_REVEAL' && state.game.settlement?.card) { sfx('unlock'); await openStudio(state.game.id, state.game.settlement.card); return; }
    }
    if (action === 'skip-settlement') {
      for (let step = 0; step < 5 && state.game.settlementStage !== 'DESTINATION'; step += 1) {
        state.game = await api('/api/game/settlement/advance', { method: 'POST', body: JSON.stringify({ gameId: state.game.id }) });
      }
      state.walletBalance = state.game.tokenBalance;
      await refreshGallery();
      notice('已跳过演出。写真卡已收入写真馆。');
    }
    if (action === 'apply-pal') {
      const palId = actionNode.dataset.pal;
      let pal = state.palIndex[palId];
      if (!pal) {
        const result = await api('/api/pals/confirm', { method: 'POST', body: JSON.stringify({ palId }) });
        pal = result.confirmed;
      }
      const seats = chosenSeats();
      const other = seats[1] !== palId ? seats[1] : seats[0];
      savePreferredSeats([palId, other]);
      await refreshWorkshop();
      notice(`${pal?.identity?.name || '新牌友'} 已加入名册并排入下一局座位；大厅选座已保存。`);
    }
    if (action === 'preview-pal-image') {
      state.imagePreview = { src: actionNode.dataset.image || '', alt: `${actionNode.dataset.name || '角色'}大图`, name: actionNode.dataset.name || '角色图片' };
      render();
      return;
    }
    if (action === 'close-image-preview') { state.imagePreview = null; render(); return; }
    if (action === 'discard') { await api('/api/pals/discard', { method: 'POST', body: JSON.stringify({ palId: actionNode.dataset.pal }) }); await refreshWorkshop(); notice('资产记录已从版本链移除。'); }
    if (action === 'gallery-tab') state.galleryTab = actionNode.dataset.tab;
    if (action === 'gallery-quick') state.galleryQuick = state.galleryQuick === actionNode.dataset.quick ? null : actionNode.dataset.quick;
    if (action === 'close-detail') {
      const restoreCard = state.detailReturnCard || state.detail;
      state.detail = null;
      state.detailReturnCard = null;
      render();
      requestAnimationFrame(() => [...document.querySelectorAll('.pcard[data-card]')].find((node) => node.dataset.card === restoreCard)?.focus());
      return;
    }
    if (action === 'detail-prev') stepDetail(-1);
    if (action === 'detail-next') stepDetail(1);
    if (action === 'replay-card') { const record = state.galleryCards.find((entry) => entry.cardId === actionNode.dataset.card); if (record) state.replay = { ...record, name: palName(record.palId) }; }
    if (action === 'export-card') { const record = state.galleryCards.find((entry) => entry.cardId === actionNode.dataset.card); if (record) { await exportCardPng(record); notice('卡面 PNG 已导出。'); } }
    if (action === 'close-replay') state.replay = null;
    if (action === 'close-entry') state.entry = false;
    render();
  } catch (err) { notice(err.message, true); }
});
document.addEventListener('click', (event) => {
  const slot = event.target.closest('.pcard[data-card]');
  if (!slot || state.route !== 'gallery' || state.detail) return;
  const record = state.galleryCards.find((entry) => entry.cardId === slot.dataset.card);
  if (record) { state.detailReturnCard = record.cardId; state.detail = record.cardId; markSeen(record.cardId); render(); }
  else { slot.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }], { duration: 260 }); notice('还未解锁：赢下对应牌友，把这场换装演出带回写真馆。'); }
});
document.addEventListener('mouseover', (event) => {
  const slot = event.target.closest('.pcard.is-new[data-card]');
  if (!slot || state.route !== 'gallery') return;
  slot.classList.remove('is-new');
  slot.querySelector('.pcard-new')?.remove();
  markSeen(slot.dataset.card);
});
/* Broken CDN URLs must never leave a native broken-image glyph in the game UI. */
document.addEventListener('error', (event) => {
  const image = event.target;
  if (!(image instanceof HTMLImageElement) || image.dataset.loadFailed) return;
  image.dataset.loadFailed = 'true';
  image.hidden = true;
  image.parentElement?.classList.add('image-load-failed');
}, true);
document.addEventListener('keydown', (event) => {
  if (state.studioGame) {
    if (event.key === 'Escape') { state.studioGame = null; state.photoDraft = null; render(); }
    if (event.key === 'Tab') { const nodes = [...document.querySelectorAll('.photo-studio input,.photo-studio select,.photo-studio button')]; const first = nodes[0], last = nodes.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } }
    return;
  }
  if ((event.key === 'Enter' || event.key === ' ') && event.target.matches?.('.pcard[data-card]')) { event.preventDefault(); event.target.click(); }
  if (state.imagePreview && event.key === 'Escape') { state.imagePreview = null; render(); }
  else if (state.detail) {
    if (event.key === 'ArrowLeft') { stepDetail(-1); render(); }
    if (event.key === 'ArrowRight') { stepDetail(1); render(); }
    if (event.key === 'Escape') { const restoreCard = state.detailReturnCard || state.detail; state.detail = null; state.detailReturnCard = null; render(); requestAnimationFrame(() => [...document.querySelectorAll('.pcard[data-card]')].find((node) => node.dataset.card === restoreCard)?.focus()); }
  } else if (event.key === 'Escape' && state.replay) { state.replay = null; render(); }
  else if (event.key === 'Escape' && state.resourcePlanDetail) { state.resourcePlanDetail = null; render(); }
  else if (state.route === 'table' && state.game?.phase === 'PLAYING' && state.game.turn === 'player') {
    const onControl = event.target.matches?.('button, a, textarea, input, select');
    if (event.key === 'Enter' && !onControl && state.selected.size) {
      event.preventDefault();
      document.querySelector('[data-action="play"]')?.click();
    }
    if (event.key === ' ' && !onControl) {
      event.preventDefault();
      document.querySelector('[data-action="hint"]')?.click();
    }
    if (event.key === 'Escape' && state.selected.size) { state.selected.clear(); sfx('pass'); render(); }
  }
});
document.addEventListener('submit', async (event) => {
  if (event.target.id !== 'generator') return;
  event.preventDefault();
  if (state.workshopBusy) return;
  const promptBox = document.querySelector('#prompt');
  const submitBtn = event.target.querySelector('button[type="submit"]');
  state.workshopPrompt = promptBox.value;
  state.workshopName = document.querySelector('#palName')?.value.trim() || '';
  const videoReferenceUrl = document.querySelector('#videoReferenceUrl')?.value.trim() || '';
  state.workshopClothing = document.querySelector('#clothingStyle')?.value || 'described';
  state.workshopAccessory = document.querySelector('#accessory')?.value || 'none';
  state.workshopVideoReferenceUrl = videoReferenceUrl;
  const resolvedVideoReferenceUrl = videoReferenceUrl || state.workshop?.generation?.routes?.video?.defaultReferenceUrl || '';
  const trimmed = state.workshopPrompt.trim();
  if (trimmed.length < 6) {
    state.workshopError = 'PL-1：描述至少需要 6 个字符。';
    notice(state.workshopError, true);
    render();
    return;
  }
  state.workshopBusy = true;
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '生成中…'; }
  try {
    let plan = (state.workshop?.plans || []).slice().reverse().find((item) => item.intent?.sourceText === trimmed && item.packageTier === 'launch' && item.danceReferenceVideoUrl === resolvedVideoReferenceUrl && item.intent?.clothingStyle === state.workshopClothing && item.intent?.accessory === state.workshopAccessory && (!state.workshopName || item.identity?.name === state.workshopName));
    if (!plan) {
      const planPayload = { prompt: trimmed, packageTier: 'launch', videoReferenceUrl, clothingStyle: state.workshopClothing, accessory: state.workshopAccessory };
      if (state.workshopName) planPayload.name = state.workshopName;
      const created = await api('/api/pals/plan', { method: 'POST', body: JSON.stringify(planPayload) });
      if (created.status === 'BLOCKED') throw new Error(`${created.gate}：${created.reason}`);
      plan = created; state.workshopVideoReferenceUrl = created.danceReferenceVideoUrl || videoReferenceUrl; await refreshWorkshop();
    }
    const result = await api('/api/pals/resources/submit', { method: 'POST', body: JSON.stringify({ planId: plan.planId }) });
    const feedback = resourceSubmitFeedback(result);
    state.workshopError = feedback.error ? feedback.text : '';
    notice(feedback.text, Boolean(feedback.error));
    await refreshWorkshop();
  } catch (err) { state.workshopError = err.message; notice(err.message, true); }
  state.workshopBusy = false;
  render();
  pollWorkshopJobs();
});
document.addEventListener('input', (event) => {
  if (state.route !== 'workshop') return;
  if (event.target.id === 'palName') { state.workshopName = event.target.value; return; }
  if (event.target.id === 'videoReferenceUrl') { state.workshopVideoReferenceUrl = event.target.value; return; }
  if (event.target.id === 'clothingStyle') { state.workshopClothing = event.target.value; return; }
  if (event.target.id === 'accessory') { state.workshopAccessory = event.target.value; return; }
  if (event.target.id !== 'prompt') return;
  state.workshopPrompt = event.target.value;
  const counter = document.querySelector('#charCounter');
  if (!counter) return;
  const len = [...state.workshopPrompt.trim()].length;
  counter.textContent = `已输入 ${len} 字 · 至少 6 字`;
  counter.classList.toggle('short', len > 0 && len < 6);
});
document.addEventListener('change', (event) => {
  if (state.route !== 'workshop' || event.target.id !== 'productionTaskPlanFilter') return;
  state.workshopTaskPlanFilter = event.target.value;
  render();
});
window.addEventListener('hashchange', () => navigate(routeFromHash(), { updateHash: false }));

/* ---------- boot ---------- */
async function boot() {
  applyPrefs();
  await handlePartnerEntry();
  try { await refreshWallet(); } catch { /* backend may be an older local build; keep the visible 100-point default */ }
  try {
    const payload = await api('/api/pals');
    /* pals 是「可上桌名册」= 官方牌友 + 工坊已确认建档的自定义牌友。候选资产不提前入席。 */
    state.pals = payload.pals || payload.official || [];
    state.palIndex = Object.fromEntries(state.pals.map((pal) => [pal.palId, pal]));
    state.defaultSeats = payload.defaultSeats || null;
    state.workshop = payload.workshop;
    await refreshGallery();
  } catch (err) { notice(`资产合同加载失败：${err.message}`, true); }
  await navigate(state.route, { updateHash: false });
}
boot().catch((err) => { notice(err.message, true); render(); });

async function openStudio(gameId, source) {
  if (!source) return;
  await refreshGallery();
  const existing = state.collection?.creations.find((c) => c.gameId === gameId);
  const value = existing || source;
  state.studioGame = gameId;
  state.photoDraft = { palId: value.palId, cardId: value.cardId, name: value.name || '', background: value.background || 'midnight', filter: value.filter || 'natural', framing: value.framing || 'full' };
  render();
  document.querySelector('#studio-title')?.focus({ preventScroll: true });
}
document.addEventListener('change', (event) => {
  const key = event.target.dataset.photoOption;
  if (!key || !state.photoDraft) return;
  state.photoDraft[key] = event.target.value;
  sfx('cloth'); render();
  document.querySelector(`[data-photo-option="${key}"]`)?.focus();
});
document.addEventListener('input', (event) => {
  if (event.target.id === 'photo-name' && state.photoDraft) { state.photoDraft.name = event.target.value; const title = document.querySelector('.studio-preview .my-photo-caption strong'); if (title) title.textContent = event.target.value || '我的定格'; }
});
document.addEventListener('submit', async (event) => {
  if (event.target.id !== 'photo-studio-form') return;
  event.preventDefault();
  const button = event.target.querySelector('[type="submit"]'); button.disabled = true;
  try {
    await api('/api/gallery/compose', { method: 'POST', body: JSON.stringify({ ...state.photoDraft, gameId: state.studioGame }) });
    sfx('shutter'); state.studioGame = null; state.photoDraft = null;
    await navigate('gallery'); notice('专属写真已收藏，可在“我的定格”导出分享图。');
  } catch (error) { button.disabled = false; notice(error.message, true); }
});

document.addEventListener('input', (event) => { const key = event.target.dataset.audioVolume; if (key) { setPref(key, Number(event.target.value)); syncAudio(); syncVideoAudio(); } });
for (const input of document.querySelectorAll('[data-audio-volume]')) input.value = prefs()[input.dataset.audioVolume];

function syncVideoAudio() { document.querySelectorAll('.dance-stage video').forEach((v) => { v.volume = prefs().masterVolume; v.muted = !prefs().sfx || document.hidden; }); }
document.addEventListener('visibilitychange', () => { syncVideoAudio(); if (document.hidden) document.querySelectorAll('.dance-stage video').forEach((v) => v.pause()); });
