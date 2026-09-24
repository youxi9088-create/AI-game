import { createPartnerFlow } from './core/partner-flow.js';
import { SUITS, SUIT_META, rankName, cardLabel, newGame, cloneState, getStack, describeRef, canMove, applyMove, findAutoFoundationMove, findHint } from './core/freecell.js';
import { themes, validateTheme, normalizeCardDesign, upgradeCardDesign, ensurePlayablePalette } from './core/themes.js';
import { themeCache } from './core/theme-cache.js';
import { track, flushAnalytics } from './core/analytics.js';

const root = document.querySelector('#app');
const workId = new URLSearchParams(location.search).get('work');
const saveKey = workId ? `theme-freecell-work-${workId}` : 'theme-freecell-mvp';
const saved = JSON.parse(localStorage.getItem(saveKey) || 'null');
const pendingJobId = workId ? null : localStorage.getItem('theme-freecell-pending-job');
const validViews = new Set(['home', 'game', 'studio', 'library', 'settings']);
const hashView = location.hash.slice(1);
const launchParams = new URLSearchParams(location.search);
const partnerLaunch = launchParams.get('ticket') ? { ticket: launchParams.get('ticket'), templateId: launchParams.get('template_id') || '', returnUrl: launchParams.get('return_url') || '', proto: launchParams.get('proto') || 'v0.1' } : null;
const libraryVersion = 3;
// FN production only exposes the two approved, reusable theme packages.
// Experimental/internal packages remain out of the player-facing library.
const builtinThemes = [themes.classic, themes.ink];
// Remove only the two IDs that this build incorrectly auto-restored; never infer or delete other player-created themes.
const incorrectAutoRecoveryIds = new Set(['generated-1788853019030']);
// Generated themes are server-owned records.  Do not resurrect an arbitrary
// browser cache: its files may have expired or belong to another deployment.
const savedGeneratedThemes = [];
const pendingServerThemeId = saved?.theme?.source === 'generated' ? saved.theme.themeId : null;
const restoredThemeCandidate = saved?.theme ? upgradeCardDesign(builtinThemes.find(item => item.themeId === saved.theme?.themeId) || themes.classic) : themes.classic;
const restoredTheme = incorrectAutoRecoveryIds.has(restoredThemeCandidate.themeId) ? themes.classic : restoredThemeCandidate;
const restoredLibrary = [...builtinThemes, ...savedGeneratedThemes.filter(item => !builtinThemes.some(builtin => builtin.themeId === item.themeId))];
const model = { view: workId ? 'game' : partnerLaunch || sessionStorage.getItem('freecell-partner-session') ? 'studio' : pendingJobId ? 'studio' : validViews.has(hashView) ? hashView : location.hash ? 'home' : saved?.game ? 'game' : 'home', game: saved?.game || newGame(617), theme: restoredTheme, library: restoredLibrary, selected: null, message: partnerLaunch ? '已接收平台创作请求，正在建立安全草稿。' : saved?.game ? '已恢复上次保存的牌局。' : '准备开始一局可保存、可换肤的空当接龙。', messageKind: 'info', hint: null, autoCollect: Boolean(saved?.autoCollect), soundEnabled: saved?.soundEnabled !== false, startedAt: Date.now(), history: saved?.history || [], future: saved?.future || [], pipeline: { loaded: false, configured: false, mockAllowed: false, mode: 'checking', provider: '', missing: [], error: '' }, studio: { prompt: '', stage: pendingJobId ? 'queued' : '', progress: 0, statusMessage: pendingJobId ? '正在恢复未完成的主题任务' : '', result: null, busy: Boolean(pendingJobId), jobId: pendingJobId }, partner: { launch: partnerLaunch, sessionId: '', draftId: '', returnUrl: '', submitted: false, error: '' }, s6: false };
if (location.hash && !validViews.has(hashView)) history.replaceState({ view: model.view }, '', `#${model.view}`);
const apiPort = new URLSearchParams(location.search).get('apiPort') || '4174';
const fnAppPath = location.pathname.match(/^\/(?:a|d)\/[^/]+\//)?.[0]?.replace(/\/$/, '');
const API_BASE = globalThis.__THEME_API_BASE__ || (fnAppPath ? `${location.origin}${fnAppPath}/api/v1` : `${location.protocol}//${location.hostname}:${apiPort}/v1`);
if (partnerLaunch) { const cleanUrl = new URL(location.href); ['ticket', 'template_id', 'return_url', 'proto'].forEach(key => cleanUrl.searchParams.delete(key)); history.replaceState({ view: 'studio' }, '', cleanUrl); }
const partnerFlow = createPartnerFlow({ api: API_BASE, request: requestJson });
model.workLoading = Boolean(workId);
const HEALTH_URL = `${API_BASE.replace(/\/v1\/?$/, '')}/health`;
const stages = [{ id: 'policy', label: '解析主题意图' }, { id: 'spec', label: '生成主题规范' }, { id: 'assets', label: '生成主题部件' }, { id: 'review', label: '程序化精致化与审核' }, { id: 'validate', label: '合成与质量校验' }];
const stagePosition = stage => ({ queued: -1, policy: 0, spec: 1, provider: 1, assets: 2, review: 3, validate: 4, package: 4, fallback: 4, completed: 5 }[stage] ?? -1);

const esc = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const icons = {
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v10h13V10M9 20v-6h6v6"/>',
  play: '<path d="m9 7 8 5-8 5Z"/>',
  wand: '<path d="m15 4 5 5M13 6l5 5M4 20l11-11"/><path d="M5 4v3M3.5 5.5h3M19 15v4M17 17h4"/>',
  cards: '<rect x="5" y="4" width="13" height="16" rx="2"/><path d="M9 8h5M9 12h5M9 16h3"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19 13.5v-3l-2-.6-.7-1.6 1-1.9-2.1-2.1-1.9 1-1.6-.7L10.5 2h-3l-.6 2-1.6.7-1.9-1-2.1 2.1 1 1.9-.7 1.6-2 .6v3l2 .6.7 1.6-1 1.9 2.1 2.1 1.9-1 1.6.7.6 2h3l.6-2 1.6-.7 1.9 1 2.1-2.1-1-1.9.7-1.6Z" transform="scale(.82) translate(2.6 2.6)"/>',
  undo: '<path d="M9 8 5 12l4 4"/><path d="M6 12h7a5 5 0 0 1 5 5"/>',
  redo: '<path d="m15 8 4 4-4 4"/><path d="M18 12h-7a5 5 0 0 0-5 5"/>',
  hint: '<path d="M9 18h6M10 21h4"/><path d="M8.5 14.5A6 6 0 1 1 15.5 14.5C14.5 15.2 14 16 14 17h-4c0-1-.5-1.8-1.5-2.5Z"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  error: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
};
const icon = name => `<svg class="ui-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${icons[name]}</svg>`;
const refKey = ref => `${ref.zone}:${ref.index ?? ref.suit ?? ''}`;
const assetSource = item => item?.dataUrl || (item?.url ? new URL(item.url, item.url.startsWith('/v1/') ? API_BASE : location.origin).href : '');
// 只有生产链路确认带 alpha 的牌面资产才直接叠加；历史/不透明输出走程序化牌面，避免白底破坏规则可读性。
const rasterCardAssetSafe = item => item?.backgroundMode === 'transparent' || (!item?.backgroundMode && Boolean(item?.dataUrl));
const fontStacks = { classic: "Georgia, 'Times New Roman', serif", diner: "Impact, Haettenschweiler, 'Arial Narrow Bold', sans-serif", cyber: "ui-monospace, 'Cascadia Code', Consolas, monospace", ink: "STKaiti, KaiTi, 'Microsoft YaHei', serif" };
const designFor = theme => normalizeCardDesign(theme?.spec?.cardDesign, theme?.themeId === 'red-diner' ? 'diner' : 'classic');
function css(theme) { const p = theme.spec.palette; const design = designFor(theme); const shape = { classic: ['11px', '10px', 'none', 'solid'], soft: ['22px', '14px', 'none', 'solid'], ticket: ['8px', '10px', 'polygon(0 0,100% 0,100% calc(100% - 10px),calc(100% - 10px) 100%,10px 100%,0 calc(100% - 10px))', 'dashed'], gothic: ['6px', '7px', 'polygon(0 0,calc(100% - 10px) 0,100% 10px,100% calc(100% - 10px),calc(100% - 10px) 100%,10px 100%,0 calc(100% - 10px))', 'double'], shield: ['24px 24px 9px 9px', '15px', 'none', 'solid'], arch: ['34px 34px 8px 8px', '16px', 'none', 'solid'], ink: ['30px 5px 30px 5px', '14px', 'none', 'double'], diner: ['42px', '16px', 'none', 'solid'] }[design.shape] || ['11px', '10px', 'none', 'solid'];
  const boardTexture = { diner: ['radial-gradient(color-mix(in srgb,var(--accent) 12%,transparent) 2.5px,transparent 2.5px)', '24px 24px'], cyber: ['repeating-linear-gradient(0deg,transparent 0 23px,color-mix(in srgb,var(--accent) 8%,transparent) 23px 24px),repeating-linear-gradient(90deg,transparent 0 23px,color-mix(in srgb,var(--accent) 8%,transparent) 23px 24px)', 'auto'], ink: ['radial-gradient(ellipse at 28% 18%,color-mix(in srgb,var(--accent) 7%,transparent),transparent 58%)', 'auto'] }[design.rankFont] || ['none', 'auto']; const background = assetSource(theme.assets?.items?.find(item => item.kind === 'background')); const cardBack = assetSource(theme.assets?.items?.find(item => item.kind === 'cardBack')); const safeUrl = value => value.replaceAll("'", '%27'); const rgb = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(p.surface)?.slice(1).map(value => Number.parseInt(value, 16)) || [0, 0, 0]; const scheme = rgb.reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0) > 160 ? 'light' : 'dark'; const accentRgb = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(p.accent)?.slice(1).map(value => Number.parseInt(value, 16)) || [255, 255, 255]; const onAccent = accentRgb.reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0) > 150 ? '#10231d' : '#f6f1df'; const bgRgb = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(p.bg)?.slice(1).map(value => Number.parseInt(value, 16)) || [0, 0, 0]; const onBg = bgRgb.reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0) > 140 ? '#2b1f1a' : '#f6f1df'; const boardSurface = background ? `color-mix(in srgb,${p.surface} 42%,transparent)` : `color-mix(in srgb,${p.surface} 82%,transparent)`; return `color-scheme:${scheme};--bg:${p.bg};--surface:${p.surface};--card:${p.card};--card-face:${p.card};--accent:${p.accent};--on-accent:${onAccent};--on-bg:${onBg};--red:${p.redSuit};--black:${p.blackSuit};--text:${p.text};--rank-font:${fontStacks[design.rankFont]};--suit-font:${fontStacks[design.suitFont]};--face-style:${design.rankFont};--card-radius:${shape[0]};--card-clip:${shape[2]};--ui-radius:${shape[1]};--board-texture:${boardTexture[0]};--board-texture-size:${boardTexture[1]};--board-surface:${boardSurface};--theme-background:${background ? `url('${safeUrl(background)}')` : `radial-gradient(circle at 65% 35%,color-mix(in srgb,${p.accent} 20%,transparent),transparent 42%)`};--theme-overlay:${background ? `linear-gradient(color-mix(in srgb,${p.bg} 8%,transparent),color-mix(in srgb,${p.bg} 22%,transparent))` : 'none'};--theme-card-back:${cardBack ? `url('${safeUrl(cardBack)}')` : `repeating-linear-gradient(45deg,${p.surface} 0 9px,${p.accent} 9px 11px)`};`; }
function persist() { localStorage.setItem(saveKey, JSON.stringify({ libraryVersion, game: model.game, theme: model.theme, library: model.library, autoCollect: model.autoCollect, soundEnabled: model.soundEnabled, history: model.history, future: model.future })); }
function elapsed() { return Math.max(0, model.game.elapsedMs + (Date.now() - model.startedAt)); }
function duration(ms) { const sec = Math.floor(ms / 1000); return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`; }
function setView(view, { replace = false } = {}) { model.view = view; model.selected = null; model.hint = null; if (location.hash !== `#${view}`) history[replace ? 'replaceState' : 'pushState']({ view }, '', `#${view}`); render(); }
function playTone(kind = 'move') { if (!model.soundEnabled || !globalThis.AudioContext) return; const context = new AudioContext(); const oscillator = context.createOscillator(); const gain = context.createGain(); const notes = { move: 420, success: 620, error: 170, win: 784 }; oscillator.frequency.value = notes[kind] || notes.move; oscillator.type = kind === 'error' ? 'sawtooth' : 'sine'; gain.gain.setValueAtTime(.035, context.currentTime); gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + (kind === 'win' ? .32 : .12)); oscillator.connect(gain).connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + (kind === 'win' ? .32 : .12)); oscillator.addEventListener('ended', () => context.close()); }
function saveSnapshot() { model.history.push(cloneState(model.game)); if (model.history.length > 200) model.history.shift(); model.future = []; }
function setGame(game) { model.game = game; model.startedAt = Date.now(); persist(); }
function beginDeal(number, message) { model.history = []; model.future = []; setGame(newGame(number)); model.selected = null; model.message = message; model.messageKind = 'success'; playTone('success'); track('game_start', { dealNumber: number, themeId: model.theme.themeId }); render(); }
function newDeal() { let number; do { number = Math.floor(Math.random() * 999999) + 1; } while (number === model.game.dealNumber); beginDeal(number, `已发编号 ${number} 的新局。`); }
function resetDeal() { const input = document.querySelector('#deal-number'); const number = Number(input?.value); if (!Number.isInteger(number) || number < 1 || number > 1_000_000) return notify('请输入 1 到 1,000,000 之间的整数牌局编号。', 'error'); beginDeal(number, `已重置编号 ${number} 的牌局。`); }
function undo() { if (!model.history.length) return notify('还没有可撤销的操作。'); const depth = model.history.length; model.future.push(cloneState(model.game)); setGame(model.history.pop()); track('undo_used', { depth }); model.message = '已撤销一步。'; model.messageKind = 'info'; playTone('move'); render(); }
function redo() { if (!model.future.length) return notify('还没有可重做的操作。'); model.history.push(cloneState(model.game)); setGame(model.future.pop()); track('redo_used', { depth: model.future.length }); model.message = '已重做一步。'; model.messageKind = 'success'; playTone('move'); render(); }
function notify(message, kind = 'info') { model.message = message; model.messageKind = kind; if (kind === 'error') playTone('error'); render(); }
function destinationFromElement(el) { if (!el) return null; const node = el.closest('[data-ref]'); return node ? JSON.parse(node.dataset.ref) : null; }
function selectCard(ref, start) { const stack = getStack(model.game, ref); if (!stack.length) return; const first = Number(start ?? stack.length - 1); const cards = stack.slice(first); model.selected = { from: ref, start: first }; model.hint = null; model.messageKind = 'selected'; model.message = cards.length > 1 ? `已拿起 ${cardLabel(cards[0])} 起始的 ${cards.length} 张连续牌，请选择异色大一号目标或空列。` : `已拿起 ${cardLabel(cards[0])}，请选择目标位置。`; playTone('move'); render(); }
function attemptMove(to) {
  if (!model.selected || !to) return; const move = { ...model.selected, to }; const verdict = canMove(model.game, move);
  if (!verdict.ok) { track('move_attempt', { valid: false, reason: verdict.reason }); model.message = verdict.reason; model.messageKind = 'error'; model.selected = null; playTone('error'); return render(); }
  saveSnapshot(); setGame(applyMove(model.game, move).state); const cards = getStack(model.game, to); track('move_attempt', { valid: true, cards: cards.length }); model.message = `已移动 ${cards.length ? cardLabel(cards.at(-1)) : '牌'} 到${describeRef(to)}。`; model.messageKind = 'success'; model.selected = null; model.hint = null; playTone(model.game.status === 'won' ? 'win' : 'success'); if (model.autoCollect) autoCollect(); if (model.game.status === 'won') track('game_complete', { elapsed: elapsed(), moves: model.game.moveCount, dealNumber: model.game.dealNumber }); render();
}
function autoCollect() { let move; let moved = 0; while ((move = findAutoFoundationMove(model.game))) { saveSnapshot(); setGame(applyMove(model.game, move).state); moved++; } if (moved) { model.message = `已安全自动收牌 ${moved} 张。`; model.messageKind = 'success'; } }
function automaticMove(ref, start) { const stack = getStack(model.game, ref); const card = stack[Number(start ?? stack.length - 1)]; if (!card) return; const foundation = { zone: 'foundation', suit: card.suit }; const test = canMove(model.game, { from: ref, start: Number(start ?? stack.length - 1), to: foundation }); if (test.ok) { selectCard(ref, start); attemptMove(foundation); return; }
  for (let index = 0; index < model.game.tableau.length; index++) { const target = { zone: 'tableau', index }; if (ref.zone === 'tableau' && ref.index === index) continue; const verdict = canMove(model.game, { from: ref, start: Number(start ?? stack.length - 1), to: target }); if (verdict.ok) { selectCard(ref, start); attemptMove(target); return; } }
  const cell = model.game.freecells.findIndex(x => !x); if (cell >= 0) { selectCard(ref, start); attemptMove({ zone: 'freecell', index: cell }); return; }
  notify('这张牌目前没有自动可达位置。请先释放自由单元或整理牌列。', 'error');
}
function showHint() { const hint = findHint(model.game); track('hint_used', { solverMode: 'local-heuristic', available: Boolean(hint) }); if (!hint) return notify('暂时没有局部合法提示；可尝试释放自由单元。', 'error'); model.hint = hint; model.messageKind = 'hint'; model.message = `提示：将 ${describeRef(hint.from)} 的顶牌移到 ${describeRef(hint.to)}。`; playTone('move'); render(); }
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function requestJson(url, options = {}) { const response = await fetch(url, { ...options, signal: AbortSignal.timeout(95_000) }); const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.error || `请求失败：HTTP ${response.status}`); return body; }
async function bootstrapPartnerSession() {
  if (workId) return;
  try {
    const session = await partnerFlow.connect(partnerLaunch);
    model.partner.launch = null;
    if (!session) return;
    model.partner.sessionId = session.session_id;
    model.partner.draftId = session.draft_id;
    model.partner.submitted = partnerFlow.state.submitted;
    model.message = '平台草稿已连接，生成进度会自动保存。'; model.messageKind = 'success';
    if (session.jobId && !partnerFlow.state.submitted) {
      model.studio.busy = true; model.studio.jobId = session.jobId;
      await pollThemeJob(session.jobId);
    }
  } catch (error) { model.partner.error = error.message; model.studio.busy = false; }
  render();
}
async function submitPartnerWork() {
  try {
    const pending = partnerFlow.submit(); render(); await pending;
    model.partner.submitted = true;
    model.message = '作品已保存到平台“我的游戏”，发布由你在平台完成。'; model.messageKind = 'success';
  } catch (error) { model.message = `提交暂未确认：${error.message}。可重试，不会新建第二件作品。`; model.messageKind = 'error'; }
  render();
}
function partnerControls() {
  if (!partnerLaunch && !partnerFlow.state.session && !partnerFlow.state.error) return '';
  const p = partnerFlow.state;
  const label = p.error || model.partner.error || (p.submitted ? '已保存到我的游戏；可返回平台管理与发布。' : p.connecting || !p.session ? '正在连接平台草稿，请稍候。' : '草稿已保存，刷新后可继续。');
  return `<section class="pipeline-connection ${p.error ? 'disconnected' : 'connected'}" role="status"><span><b>平台创作</b><small>${esc(label)}</small></span>${p.session && !p.submitted && !model.studio.busy && (model.studio.result || p.error) ? `<button id="partner-retry" ${p.submitting ? 'disabled' : ''}>${p.submitting ? '正在确认提交…' : '重试提交'}</button>` : ''}${p.submitted ? '<button class="primary" id="partner-return">返回我的游戏</button>' : ''}</section>`;
}
async function loadPublishedWork() {
  try {
    const work = await requestJson(`${API_BASE}/partner/works/${encodeURIComponent(workId)}`);
    await preloadTheme(work.theme);
    model.theme = ensurePlayablePalette(upgradeCardDesign(work.theme));
    if (!saved?.game) model.game = newGame(work.deal_number);
    model.message = `正在游玩：${work.title}`; model.workLoading = false; persist(); render();
  } catch (error) { model.workLoading = false; model.workError = error.message; render(); }
}
async function loadPipelineStatus() { try { const health = await requestJson(HEALTH_URL); model.pipeline = { loaded: true, configured: Boolean(health.providerConfigured), mockAllowed: Boolean(health.mockAllowed), mode: health.providerMode || 'unknown', provider: health.provider || '', missing: health.missing || [], error: '' }; } catch (error) { model.pipeline = { loaded: true, configured: false, mockAllowed: false, mode: 'unavailable', provider: '', missing: [], error: error.message }; } if (model.view === 'studio') render(); }
async function pollThemeJob(jobId) {
  for (let tries = 0; tries < 600; tries++) {
    const job = partnerFlow.state.session ? await partnerFlow.job() : await requestJson(`${API_BASE}/theme-jobs/${encodeURIComponent(jobId)}`);
    if (model.studio.stage !== job.stage) track('theme_generation_stage', { stage: job.stage, progress: job.progress || 0 }); model.studio.stage = job.stage; model.studio.progress = job.progress || 0; model.studio.statusMessage = job.message || ''; render();
    if (job.status === 'completed') {
      localStorage.removeItem('theme-freecell-pending-job'); model.studio.busy = false; model.studio.jobId = null; model.studio.result = job.result;
      track('theme_generation_success', { providerMode: job.result.provider, fallbackUsed: Boolean(job.result.fallbackUsed), qualityScore: job.result.theme.quality?.pass ? 1 : 0 }); track('theme_preview', { themeId: job.result.theme.themeId });
      if (partnerFlow.state.session && !partnerFlow.state.submitted) await submitPartnerWork();
      playTone('success'); render(); return;
    }
    if (job.status === 'failed') {
      localStorage.removeItem('theme-freecell-pending-job'); model.studio.jobId = null;
      const failure = job.error || '主题任务失败。';
      model.studio.busy = false;
      if (partnerFlow.state.session && !partnerFlow.state.submitted) await submitPartnerWork();
      throw new Error(failure);
    }
    await wait(2_000);
  }
  throw new Error('主题图片任务超过 20 分钟仍未完成；任务号已保留，可刷新页面继续查询。');
}
async function generateTheme() {
  if ((partnerLaunch || partnerFlow.state.session || partnerFlow.state.error) && (!partnerFlow.state.session || partnerFlow.state.connecting || partnerFlow.state.submitted || model.partner.error)) return;
  if (!model.pipeline.configured && !model.pipeline.mockAllowed) { model.studio.result = { error: `真实主题流水线尚未连接${model.pipeline.missing.length ? `：缺少 ${model.pipeline.missing.join('、')}` : ''}。请先完成服务端配置。` }; return render(); }
  const prompt = (document.querySelector('#prompt')?.value ?? model.studio.prompt).trim(); model.studio.prompt = prompt;
  if (!prompt || prompt.length > 200) { model.studio.result = { error: prompt ? '主题描述不能超过 200 个字符，请缩短后重试。' : '请输入一句主题描述后再生成。' }; return render(); }
  model.studio.busy = true; model.studio.result = null; model.studio.stage = 'queued'; model.studio.progress = 0; model.studio.statusMessage = '正在创建主题任务'; track('theme_generation_start', { promptLength: prompt.length }); render();
  try {
    const created = partnerFlow.state.session ? await partnerFlow.create(prompt) : await requestJson(`${API_BASE}/theme-jobs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt }) });
    model.studio.jobId = created.jobId; if (!partnerFlow.state.session) localStorage.setItem('theme-freecell-pending-job', created.jobId); await pollThemeJob(created.jobId);
  } catch (error) { if (!model.studio.jobId) localStorage.removeItem('theme-freecell-pending-job'); model.studio.busy = false; model.studio.result = { error: `主题服务暂不可用：${error.message}。当前牌局和主题未改变。` }; track('theme_quality_fail', { gate: 'pipeline', reason: error.message }); render(); }
}
async function preloadTheme(theme) {
  // Only the table background and card back block application. Decorative card
  // art is allowed to arrive later, so the rules remain immediately playable.
  const started = performance.now(); const assets = (theme.assets?.items || []).filter(item => item.kind === 'background' || item.kind === 'cardBack');
  await Promise.all(assets.filter(item => item.mime?.startsWith('image/') && assetSource(item)).map(item => new Promise((resolve, reject) => { const image = new Image(); image.onload = async () => { try { await image.decode?.(); resolve(); } catch (error) { reject(error); } }; image.onerror = () => reject(new Error(`资源 ${item.id} 解码失败`)); image.src = assetSource(item); })));
  return { assetCount: assets.length, preloadMs: Math.round(performance.now() - started) };
}
// 字形视觉归一化：AI 生成的 13 张点数字形图各自墨迹占比存在随机偏差（实测 78%~88%），
// 统一按 85% 墨迹高度基线计算每张的缩放系数并缓存到资产上（glyphScale），渲染时放大/缩小到一致视觉大小。
const GLYPH_TARGET_INK = 0.75;
async function normalizeGlyphScales(theme) {
  const items = (theme?.assets?.items || []).filter(item => item.kind === 'rankGlyph' && (item.glyphScale === undefined || item.glyphScaleVersion !== 3) && assetSource(item));
  if (!items.length) return false;
  await Promise.all(items.map(async item => {
    try {
      const image = new Image(); if (!item.dataUrl) image.crossOrigin = 'anonymous';
      await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('字形图加载失败')); image.src = assetSource(item); });
      const size = 512; const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 0, 0, size, size);
      const pixels = ctx.getImageData(0, 0, size, size).data; let minY = size, maxY = -1;
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { const index = (y * size + x) * 4; const lum = 0.299 * pixels[index] + 0.587 * pixels[index + 1] + 0.114 * pixels[index + 2]; if (lum < 245) { if (y < minY) minY = y; if (y > maxY) maxY = y; } }
      if (maxY < minY) { item.glyphScale = 1; item.glyphScaleVersion = 3; return; }
      const inkRatio = (maxY - minY + 1) / size; const scale = Math.min(1.3, Math.max(0.8, GLYPH_TARGET_INK / inkRatio));
      item.glyphScale = Math.round(scale * 100) / 100; item.glyphVerified = true; item.glyphScaleVersion = 3;
    } catch { item.glyphScale = 1; item.glyphVerified = false; item.glyphScaleVersion = 3; }
  }));
  return items.some(item => item.glyphScale !== 1);
}
// 花色颜色约定（扑克牌基本规则）：黑桃/梅花=黑、红桃/方块=红，不随主题变化。
// 生成图片可能被主题氛围染色，这里用 canvas 把符号重染为主题 palette 的 redSuit/blackSuit，并输出透明背景 PNG。
const SUIT_TINT_KEYS = { S: 'blackSuit', C: 'blackSuit', H: 'redSuit', D: 'redSuit' };
async function tintSuitMotifs(theme) {
  const items = (theme?.assets?.items || []).filter(item => item.kind === 'suitMotif' && item.suitTintVersion !== 2 && assetSource(item));
  if (!items.length) return false;
  const palette = theme?.spec?.palette || {};
  await Promise.all(items.map(async item => {
    try {
      const image = new Image(); if (!item.dataUrl) image.crossOrigin = 'anonymous';
      await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('花色符号图加载失败')); image.src = assetSource(item); });
      const size = 192; const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 0, 0, size, size);
      const imageData = ctx.getImageData(0, 0, size, size); const pixels = imageData.data;
      const hex = palette[SUIT_TINT_KEYS[item.suit]] || (SUIT_TINT_KEYS[item.suit] === 'redSuit' ? '#c72f3d' : '#1d2730');
      const tr = parseInt(hex.slice(1, 3), 16), tg = parseInt(hex.slice(3, 5), 16), tb = parseInt(hex.slice(5, 7), 16);
      let inkCount = 0;
      const lums = new Float32Array(pixels.length / 4);
      for (let i = 0, p = 0; i < pixels.length; i += 4, p++) {
        const lum = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
        lums[p] = lum;
        if (lum < 245) inkCount++;
      }
      // 干净剪影的墨迹占比约 20%~45%；占比过高说明生成图画了大色块/泼墨背景，重染会变成污渍，直接弃用回退文字符号。
      if (inkCount / lums.length > 0.5) { item.suitTint = ''; item.suitTintRejected = true; item.suitTintVersion = 2; return; }
      // 对比度拉伸：上端锚定纯白（背景/亮部 → 白，multiply 隐形），下端取符号区最暗 2% 分位——
      // 无论原图深浅，符号核心稳定映射到饱和红/黑，边缘保留渐变质感。
      const sorted = Array.from(lums).filter(l => l < 245).sort((a, b) => a - b);
      const darkP = sorted[Math.floor(sorted.length * 0.02)];
      const span = Math.max(60, 250 - darkP);
      for (let i = 0, p = 0; i < pixels.length; i += 4, p++) {
        const shade = Math.min(1, Math.max(0, (250 - lums[p]) / span));
        pixels[i] = Math.round(255 - shade * (255 - tr)); pixels[i + 1] = Math.round(255 - shade * (255 - tg)); pixels[i + 2] = Math.round(255 - shade * (255 - tb));
      }
      ctx.putImageData(imageData, 0, 0);
      item.suitTint = canvas.toDataURL('image/png'); item.suitTintRejected = false;
    } catch { item.suitTint = ''; }
    item.suitTintVersion = 2;
  }));
  return items.some(item => item.suitTint);
}
function applyTheme(theme) {
  theme = ensurePlayablePalette(upgradeCardDesign(theme)); const quality = validateTheme(theme); if (!quality.pass) return notify('主题缺少必要的牌面资源，已保留当前主题。', 'error');
  const snapshot = cloneState(model.game); model.s6 = true; render();
  window.setTimeout(async () => { try { const preload = { assetCount: (theme.assets?.items || []).length, preloadMs: 0 }; const candidate = structuredClone(theme); candidate.quality = quality; if (candidate.assets?.items) candidate.assets.items = candidate.assets.items.map(item => ({ ...item, url: item.url ? assetSource(item) : item.url })); model.theme = candidate; if (!model.library.some(item => item.themeId === theme.themeId)) model.library.push(candidate); setGame(snapshot); track('theme_apply', { themeId: theme.themeId, source: theme.source, ...preload }); model.s6 = false; model.message = `已应用“${theme.title}”，并保留当前牌局、步数和用时。`; model.messageKind = 'success'; model.view = 'game'; history.pushState({ view: 'game' }, '', '#game'); playTone('success'); render(); Promise.all([normalizeGlyphScales(candidate), tintSuitMotifs(candidate)]).then(results => { if (results.some(Boolean)) { persist(); render(); } }).catch(() => {}); themeCache.put(candidate).catch(() => {}); } catch (error) { setGame(snapshot); model.s6 = false; model.message = `主题应用失败，已回滚并保留当前主题：${error.message}`; model.messageKind = 'error'; track('theme_quality_fail', { gate: 's6-apply', reason: error.message }); model.view = 'game'; history.pushState({ view: 'game' }, '', '#game'); playTone('error'); render(); } }, 120);
}
function faceArtHtml(theme, card, symbol, pipContent = esc(symbol)) {
  const design = designFor(theme); const face = design.faceCards[card.id];
  if (!face) return `<span class="pip" aria-hidden="true">${pipContent}</span>`;
  const asset = theme.assets?.items?.find(item => item.kind === 'faceCard' && item.cardId === card.id);
  const portrait = face.portrait === 'king' ? '♛' : face.portrait === 'queen' ? '♕' : '♞';
  const ornament = face.portrait === 'king' ? '◆' : face.portrait === 'queen' ? '✦' : '●';
  const fallback = `<svg viewBox="0 0 100 112" focusable="false"><path class="face-frame" d="M15 18 50 6l35 12v76l-35 12-35-12Z"/><text class="face-mark" x="50" y="57" text-anchor="middle">${portrait}</text><text class="face-suit" x="50" y="84" text-anchor="middle">${esc(symbol)}</text><text class="face-ornament" x="50" y="27" text-anchor="middle">${ornament}</text></svg>`;
  if (asset && rasterCardAssetSafe(asset) && assetSource(asset)) return `<span class="face-art face-art-image face-art-${esc(face.style)}" aria-hidden="true"><img src="${esc(assetSource(asset))}" alt=""></span>`;
  return `<span class="face-art face-art-${esc(face.style)}" aria-hidden="true">${fallback}</span>`;
}
function cardHtml(card, ref, start, isTop = true, theme = model.theme, interactive = true) {
  const selected = model.selected?.from && refKey(model.selected.from) === refKey(ref) && Number(start) >= model.selected.start; const hinted = model.hint && refKey(model.hint.from) === refKey(ref) && Number(start) === getStack(model.game, ref).length - 1;
  const design = designFor(theme); const color = SUIT_META[card.suit].color; const rank = esc(design.rankGlyphs[String(card.rank)] || rankName(card.rank)); const symbol = design.suitSymbols[card.suit] || SUIT_META[card.suit].symbol; const face = card.rank >= 11 ? 'face-card' : '';
  const assets = theme.assets?.items || []; const rankAsset = assets.find(item => item.kind === 'rankGlyph' && Number(item.rank) === card.rank && item.glyphVerified && rasterCardAssetSafe(item) && assetSource(item)); const suitAsset = assets.find(item => item.kind === 'suitMotif' && item.suit === card.suit && rasterCardAssetSafe(item) && assetSource(item));
  const glyphStyle = rankAsset?.glyphScale && rankAsset.glyphScale !== 1 ? ` style="width:calc(26px*${rankAsset.glyphScale});height:calc(24px*${rankAsset.glyphScale})"` : '';
  const rankContent = rankAsset ? `<img class="rank-glyph"${glyphStyle} src="${esc(assetSource(rankAsset))}" alt="${rank}">` : rank; const suitAssetOk = suitAsset && !suitAsset.suitTintRejected && suitAsset.suitTint; const suitContent = suitAssetOk ? `<img class="suit-motif" src="${esc(suitAsset.suitTint)}" alt="${esc(symbol)}">` : esc(symbol);
  return `<div class="card ${isTop ? 'top-card' : 'covered-card'} ${face} ${color} ${selected ? 'selected' : ''} ${hinted ? 'hinted' : ''}" style="--offset:${start}"><span class="corner"><b>${rankContent}</b><small>${suitContent}</small></span>${faceArtHtml(theme, card, symbol, suitContent)}<span class="corner mirror"><b>${rankContent}</b><small>${suitContent}</small></span>${interactive ? `<button class="card-hit" data-card-ref='${JSON.stringify(ref)}' data-start="${start}" draggable="true" aria-label="${rankName(card.rank)}${SUIT_META[card.suit].name}"></button>` : ''}</div>`;
}
function slotHtml(ref, card = null, label = '') { const data = esc(JSON.stringify(ref)); return `<div class="slot ${card ? 'occupied' : ''}" data-ref="${data}" role="button" tabindex="0" aria-label="${label || describeRef(ref)}">${card ? cardHtml(card, ref, 0) : `<span>${label}</span>`}</div>`; }
async function restoreServerThemes({ quiet = false } = {}) {
  const button = document.querySelector('#restore-server-themes');
  let restoredCount = 0;
  if (button) { button.disabled = true; button.textContent = '正在读取服务端主题…'; }
  try {
    const response = await fetch(`${API_BASE}/themes`);
    if (!response.ok) throw new Error(`服务端返回 ${response.status}`);
    const serverThemes = await response.json();
    const restorable = (Array.isArray(serverThemes) ? serverThemes : []).filter(item => item?.source === 'generated' && item?.generation?.provider && item.generation.provider !== 'mock' && !builtinThemes.some(builtin => builtin.themeId === item.themeId) && !incorrectAutoRecoveryIds.has(item.themeId));
    const existing = new Set(model.library.map(item => item.themeId));
    const fresh = restorable.filter(item => !existing.has(item.themeId)).map(item => ensurePlayablePalette(upgradeCardDesign(item)));
    if (!fresh.length) {
      if (!quiet) { model.serverRestoreStatus = '没有新的服务端生成主题需要恢复。'; model.message = model.serverRestoreStatus; model.messageKind = 'info'; }
    } else {
      model.library.push(...fresh);
      restoredCount = fresh.length;
      const savedTheme = pendingServerThemeId && model.library.find(item => item.themeId === pendingServerThemeId);
      if (savedTheme) model.theme = savedTheme;
      persist(); model.serverRestoreStatus = `已从服务端恢复 ${fresh.length} 个生成主题到主题库。`;
      if (!quiet) { model.message = model.serverRestoreStatus; model.messageKind = 'success'; playTone('success'); track('server_themes_restored', { count: fresh.length }); }
    }
  } catch (error) {
    if (!quiet) { model.serverRestoreStatus = `恢复服务端主题失败：${error.message}`; model.message = model.serverRestoreStatus; model.messageKind = 'error'; playTone('error'); }
  }
  if (!quiet || restoredCount) render();
}
async function deleteTheme(themeId) {
  const theme = model.library.find(item => item.themeId === themeId);
  if (!theme || builtinThemes.some(builtin => builtin.themeId === themeId) || theme.themeId === model.theme.themeId) return;
  if (!window.confirm(`删除主题“${theme.title}”？将同时从本地主题库与服务端存档中移除，无法撤销。`)) return;
  model.library = model.library.filter(item => item.themeId !== themeId);
  persist();
  try {
    const response = await fetch(`${API_BASE}/themes/${encodeURIComponent(themeId)}`, { method: 'DELETE' });
    if (!response.ok && response.status !== 404) throw new Error(`服务端返回 ${response.status}`);
    model.serverRestoreStatus = `已删除主题“${theme.title}”。`;
  } catch (error) { model.serverRestoreStatus = `已从本地主题库移除“${theme.title}”，但服务端删除失败：${error.message}`; }
  render();
}
function tableauHtml(column, index) { const ref = { zone: 'tableau', index }; const height = 154 + Math.max(0, column.length - 1) * 48; return `<div class="column ${!column.length ? 'empty' : ''}" style="--column-height:${height}px" data-ref='${JSON.stringify(ref)}' role="button" tabindex="0" aria-label="牌列 ${index + 1}">${column.length ? column.map((card, start) => cardHtml(card, ref, start, start === column.length - 1)).join('') : '<span>空列</span>'}</div>`; }
const navLink = (view, label, iconName, active = false) => `<a href="#${view}" data-nav="${view}" ${active ? 'aria-current="page"' : ''}>${icon(iconName)}<span>${label}</span></a>`;
function gameView() { const g = model.game; return `<main id="main-content" class="game-shell" style="${css(model.theme)}"><header class="toolbar"><a class="brand brand-lockup" href="#home" data-nav="home"><span class="brand-mark" aria-hidden="true">♠</span><span><b>${esc(model.theme.spec.motifs.logo)}</b><small>${esc(model.theme.title)}</small></span></a><nav aria-label="主导航">${navLink('game', '牌桌', 'play', true)}${navLink('studio', '主题工坊', 'wand')}${navLink('library', '主题库', 'cards')}${navLink('settings', '设置', 'settings')}</nav><div class="toolbar-actions"><button id="undo" class="icon-action" title="Ctrl+Z">${icon('undo')}<span>撤销</span></button><button id="redo" class="icon-action" title="Ctrl+Y">${icon('redo')}<span>重做</span></button><button id="hint" class="icon-action accent-action" title="H">${icon('hint')}<span>提示</span></button></div></header><section class="play-area"><div class="game-meta"><div class="run-stats"><div class="stat"><small>牌局</small><strong>${g.dealNumber}</strong></div><div class="stat"><small>步数</small><strong>${g.moveCount}</strong></div><div class="stat"><small>用时</small><strong>${duration(elapsed())}</strong></div></div><div class="deal-controls"><label class="switch"><input id="auto-collect" type="checkbox" ${model.autoCollect ? 'checked' : ''}><span class="switch-track" aria-hidden="true"></span><span>自动收牌</span></label><label class="deal-field"><span>牌局编号</span><input id="deal-number" name="dealNumber" type="number" min="1" max="1000000" inputmode="numeric" autocomplete="off" value="${g.dealNumber}" aria-label="重置牌局编号"></label><button id="reset-deal">重置本局 <kbd>R</kbd></button><button id="new-deal" class="primary">新局 <kbd>N</kbd></button></div></div><div class="multi-move-tip">${icon('info')}<span><b>连续牌组可整体移动</b>　选择牌组最上方的一张，再选择异色大一号目标或空列；连续张数不限。</span></div>${g.status === 'stuck' ? `<div class="stuck-banner" role="status">${icon('error')}<span><b>当前没有合法移动</b>　可以撤销、重置本局或开启新局。</span></div>` : ''}<div class="board-scroll" tabindex="0" aria-label="牌桌，可横向滚动"><div class="board"><div class="top-row"><section class="zone-group"><p>自由单元 <span>临时存放单张牌</span></p><div class="freecells">${g.freecells.map((card, index) => slotHtml({ zone: 'freecell', index }, card, `自由 ${index + 1}`)).join('')}</div></section><section class="zone-group foundation-group"><p>回收区 <span>同花色 A → K</span></p><div class="foundations">${SUITS.map(suit => slotHtml({ zone: 'foundation', suit }, g.foundations[suit].at(-1), `${SUIT_META[suit].symbol} A-K`)).join('')}</div></section></div><div class="tableau">${g.tableau.map(tableauHtml).join('')}</div></div></div><div class="status" data-kind="${model.messageKind}" aria-live="polite">${icon(model.messageKind === 'error' ? 'error' : model.messageKind === 'success' ? 'check' : 'info')}<span>${esc(model.message)}</span></div></section>${g.status === 'won' ? `<section class="victory" role="dialog" aria-modal="true" aria-labelledby="victory-title"><div><span class="victory-suit" aria-hidden="true">♠</span><p>牌局 ${g.dealNumber} 已完成</p><h1 id="victory-title">恭喜通关！</h1><p>${g.moveCount} 步 · ${duration(elapsed())}</p><div class="victory-actions"><button class="primary" id="victory-new">再来一局</button><a href="#studio" data-nav="studio">换个主题</a></div></div></section>` : ''}${s6Overlay()}</main>`; }
function homeView() { return `<main id="main-content" class="home" style="${css(model.theme)}"><header class="landing-nav"><a class="brand brand-lockup" href="#home" data-nav="home"><span class="brand-mark" aria-hidden="true">♠</span><span><b>FREECELL ATELIER</b><small>主题定制空当接龙</small></span></a><nav aria-label="首页导航">${navLink('studio', '主题工坊', 'wand')}${navLink('library', '主题库', 'cards')}${navLink('settings', '设置', 'settings')}</nav></header><section class="hero"><div class="hero-copy"><p class="eyebrow">CLASSIC RULES · PERSONAL TABLE</p><h1>把每一局，<br>铺成自己的牌桌。</h1><p>完整空当接龙玩法，搭配可校验、可回退的主题系统。牌面始终清晰，风格只改变氛围，不改变判断。</p><div class="hero-actions"><a class="primary hero-primary" href="#game" data-nav="game">${icon('play')}<span>开始游戏</span></a><a href="#studio" data-nav="studio">${icon('wand')}<span>定制主题</span></a></div><p class="resume-note">${saved?.game ? `已保存牌局 ${model.game.dealNumber} · ${model.game.moveCount} 步，进入后可继续。` : '无需登录 · 自动保存 · 支持键盘与拖拽'}</p></div><div class="hero-showcase" aria-label="翡翠牌室主题预览"><div class="showcase-glow"></div><div class="showcase-card back" aria-hidden="true"></div><div class="showcase-card face black" aria-hidden="true"><span>A<small>♠</small></span><b>♠</b></div><div class="showcase-card face red" aria-hidden="true"><span>Q<small>♥</small></span><b>♥</b></div><div class="showcase-badge"><small>当前主题</small><strong>${esc(model.theme.title)}</strong><span>真实资源样本 · 可回退</span></div></div></section><section class="principles" aria-label="体验保障"><article><span class="principle-number">01</span><div><b>规则优先</b><span>点数、花色与可移动关系始终由程序绘制。</span></div></article><article><span class="principle-number">02</span><div><b>主题可控</b><span>资源先预载校验，再原子应用到当前牌局。</span></div></article><article><span class="principle-number">03</span><div><b>进度不丢</b><span>换肤失败会回滚，局面、步数和用时完整保留。</span></div></article></section></main>`; }
function studioView() { const r = model.studio.result; const currentStage = stagePosition(model.studio.stage); const pipelineReady = (model.pipeline.configured || model.pipeline.mockAllowed) && (!(partnerLaunch || partnerFlow.state.session) || Boolean(partnerFlow.state.session && !partnerFlow.state.connecting && !partnerFlow.state.submitted && !model.partner.error)); const connectionLabel = !model.pipeline.loaded ? '正在检查流水线连接' : model.pipeline.configured ? `真实流水线已连接 · ${model.pipeline.provider}` : model.pipeline.mockAllowed ? '测试环境 · Mock 通道' : '真实流水线未连接'; const partnerActive = model.partner.launch || model.partner.sessionId; const partnerBanner = partnerActive ? `<div class="pipeline-connection ${model.partner.sessionId ? 'connected' : model.partner.error ? 'disconnected' : 'mock'}" role="status">${icon(model.partner.sessionId ? 'check' : model.partner.error ? 'error' : 'info')}<span><b>${model.partner.sessionId ? '已连接平台创作草稿' : '正在连接平台创作草稿'}</b><small>${esc(model.partner.error || (model.partner.sessionId ? '生成完成后将自动提交并返回平台。' : '请稍候。'))}</small></span></div>` : ''; return `<main id="main-content" class="studio page" style="${css(model.theme)}">${miniNav('主题工坊', '用一句话生成可校验的牌桌主题')}${partnerControls()}<div class="pipeline-connection ${model.pipeline.configured ? 'connected' : pipelineReady ? 'mock' : 'disconnected'}" role="status">${icon(model.pipeline.configured ? 'check' : pipelineReady ? 'info' : 'error')}<span><b>${esc(connectionLabel)}</b>${!pipelineReady && model.pipeline.loaded ? `<small>${esc(model.pipeline.error || `缺少 ${model.pipeline.missing.join('、')}`)}</small>` : '<small>输入会经过结构化规范、图片生成、质量门和应用回退。</small>'}</span></div><section class="studio-grid"><div class="studio-form"><p class="eyebrow">THEME ORCHESTRATOR</p><h1>描述你想进入的牌室</h1><p class="lede">主题可替换桌面、牌背、A-K 字形、花色符号与 12 张 J/Q/K 插画；牌的规则身份和交互区域由程序锁定，确保主题不会破坏玩法。</p><label for="prompt">主题描述</label><textarea id="prompt" name="themePrompt" autocomplete="off" maxlength="200" placeholder="例如：雨夜里的东方书房，深色木桌与温暖灯光…">${esc(model.studio.prompt)}</textarea><div class="prompt-foot"><span>${model.studio.prompt.length}/200</span><button class="primary" id="generate" ${model.studio.busy || !pipelineReady ? 'disabled' : ''}>${model.studio.busy ? `正在生成 ${model.studio.progress}%` : pipelineReady ? '生成主题预览' : '等待真实流水线'}</button></div>${model.studio.busy ? `<div class="pipeline-wrap" role="status"><div class="progress-track"><span style="width:${model.studio.progress}%"></span></div><p>${esc(model.studio.statusMessage)}</p><ol class="pipeline">${stages.map((stage, index) => `<li class="${currentStage === index ? 'running' : currentStage > index ? 'done' : ''}"><span>${currentStage > index ? icon('check') : index + 1}</span>${stage.label}</li>`).join('')}</ol></div>` : ''}</div><aside class="preview-panel" aria-label="主题预览">${r?.error ? `<div class="error">${icon('error')}<span>${esc(r.error)}</span></div>` : r?.theme ? themePreview(r.theme, r.fallbackUsed, r.provider, r.errors) : `<div class="empty-preview"><div class="preview-card-back" aria-hidden="true"></div><p><b>预览会出现在这里</b><span>将同时检查牌面可读性、资源来源、包体与失败回退。</span></p></div>`}</aside></section></main>`; }
const previewCard = (theme, suit, rank) => cardHtml({ id: `${suit}${rank}`, suit, rank }, { zone: 'preview', index: rank }, 0, true, theme, false);
function themePreview(theme, fallbackUsed = false, provider = theme.generation?.provider || theme.source, errors = []) { const playable = ensurePlayablePalette(upgradeCardDesign(theme)); const quality = validateTheme(playable); return `<div class="theme-preview" style="${css(playable)}"><div class="preview-heading"><div><p class="eyebrow">PREVIEW · ${esc(String(provider).toUpperCase())}</p><h2>${esc(playable.title)}</h2></div><span class="quality-badge ${quality.pass ? 'pass' : 'warn'}">${quality.pass ? `${icon('check')} 资源可用` : `${icon('wand')} 自动修正中`}</span></div><div class="preview-stage"><div class="preview-card-back" aria-hidden="true"></div><div class="mini-cards">${previewCard(playable, 'H', 1)}${previewCard(playable, 'S', 13)}${previewCard(playable, 'D', 12)}</div></div><details class="quality"><summary>查看 ${quality.checks.length} 项资源与玩法检查</summary>${quality.checks.map(x => `<span>${esc(x)}</span>`).join('')}</details>${errors.length ? `<p class="notice">资源处理说明：${esc(errors.join('；'))}</p>` : ''}<button class="primary apply-generated" data-apply="${esc(playable.themeId)}">应用到当前牌局</button></div>`; }
function libraryView() { return `<main id="main-content" class="page library" style="${css(model.theme)}">${miniNav('主题库', '选择一种氛围，玩法规则保持不变')}<div class="theme-grid">${model.library.map(theme => `<article class="theme-tile" style="${css(theme)}"><div class="tile-visual"><div class="tile-card-back" aria-hidden="true"></div><div class="tile-swatch">${previewCard(theme, 'S', 13)}${previewCard(theme, 'H', 12)}${previewCard(theme, 'D', 11)}</div></div><div class="tile-copy"><p>${theme.themeId === model.theme.themeId ? '当前使用' : `${esc(theme.source)} · r${theme.revision}`}</p><h2>${esc(theme.title)}</h2><div class="tile-actions"><button class="${theme.themeId === model.theme.themeId ? '' : 'primary'}" data-apply="${esc(theme.themeId)}" ${theme.themeId === model.theme.themeId ? 'disabled' : ''}>${theme.themeId === model.theme.themeId ? '已应用' : '应用主题'}</button>${builtinThemes.some(builtin => builtin.themeId === theme.themeId) ? '' : `<button class="tile-delete" data-delete="${esc(theme.themeId)}" ${theme.themeId === model.theme.themeId ? 'disabled title="正在使用的主题不能删除"' : ''}>删除</button>`}</div></div></article>`).join('')}</div><details class="server-history"><summary>${icon('wand')} 从服务端恢复历史生成主题</summary><div class="server-history-body"><p>主题工坊生成并通过质量门的主题会在服务端留档；换浏览器或换端口后本地主题库不会自动带过来。点击按钮把真实流水线生成的主题重新加入主题库（已存在的不重复添加）。</p><button id="restore-server-themes" class="primary">${icon('undo')}<span>恢复服务端生成主题</span></button>${model.serverRestoreStatus ? `<p class="server-history-status" role="status">${esc(model.serverRestoreStatus)}</p>` : ''}</div></details></main>`; }
function settingsView() { return `<main id="main-content" class="page settings" style="${css(model.theme)}">${miniNav('设置', '调整辅助功能与本地数据')}<section><h2>游戏辅助</h2><label class="setting-row"><span><b>安全自动收牌</b><small>只回收不会明显锁住后续操作的牌。</small></span><input id="setting-auto" type="checkbox" ${model.autoCollect ? 'checked' : ''}></label><label class="setting-row"><span><b>操作音效</b><small>移动、错误与通关使用轻量合成音，不加载外部音频。</small></span><input id="setting-sound" type="checkbox" ${model.soundEnabled ? 'checked' : ''}></label><h2>键盘操作</h2><div class="shortcut-grid"><span><kbd>N</kbd> 新局</span><span><kbd>R</kbd> 重置本局</span><span><kbd>H</kbd> 提示</span><span><kbd>Ctrl</kbd> + <kbd>Z</kbd> 撤销</span></div><h2>本地数据</h2><p>牌局和主题保存在当前浏览器。清除后无法恢复。</p><button class="danger-action" id="clear-save">清除保存并重开</button></section></main>`; }
function miniNav(title, subtitle) { return `<header class="page-nav"><a class="brand brand-lockup" href="#home" data-nav="home"><span class="brand-mark" aria-hidden="true">♠</span><span><b>FREECELL ATELIER</b><small>主题定制空当接龙</small></span></a><div class="page-title"><p>首页 / ${esc(title)}</p><h1>${esc(title)}</h1><span>${esc(subtitle)}</span></div><a class="back-game" href="#game" data-nav="game">${icon('play')}<span>返回牌桌</span></a></header>`; }
function s6Overlay() { return model.s6 ? '<div class="s6-overlay"><div><span> S6 </span><b>正在预载并原子应用主题</b><small>当前牌局已快照保护</small></div></div>' : ''; }
function render() {
  if (model.workLoading || model.workError) { root.innerHTML = `<main class="page"><h1>${model.workError ? '作品暂不可用' : '正在加载作品…'}</h1><p role="status">${esc(model.workError || '正在确认作品状态与主题资源。')}</p>${model.workError ? '<button onclick="location.reload()">重新加载</button>' : ''}</main>`; return; }
  root.innerHTML = model.view === 'home' ? homeView() : model.view === 'game' ? gameView() : model.view === 'studio' ? studioView() : model.view === 'library' ? libraryView() : settingsView(); bind(); }
function bind() {
  document.querySelector('#partner-retry')?.addEventListener('click', submitPartnerWork);
  document.querySelector('#partner-return')?.addEventListener('click', () => partnerFlow.returnToPlatform());
  document.querySelectorAll('[data-nav]').forEach(el => el.addEventListener('click', event => { event.preventDefault(); setView(el.dataset.nav); }));
  document.querySelectorAll('[data-apply]').forEach(el => el.addEventListener('click', () => { const found = (model.studio.result?.theme?.themeId === el.dataset.apply ? model.studio.result.theme : model.library.find(theme => theme.themeId === el.dataset.apply)); if (found) applyTheme(found); }));
  document.querySelector('#restore-server-themes')?.addEventListener('click', restoreServerThemes);
  document.querySelectorAll('[data-delete]').forEach(el => el.addEventListener('click', () => deleteTheme(el.dataset.delete)));
  document.querySelector('#new-deal')?.addEventListener('click', newDeal); document.querySelector('#reset-deal')?.addEventListener('click', resetDeal); document.querySelector('#victory-new')?.addEventListener('click', newDeal); document.querySelector('#undo')?.addEventListener('click', undo); document.querySelector('#redo')?.addEventListener('click', redo); document.querySelector('#hint')?.addEventListener('click', showHint);
  document.querySelector('#auto-collect')?.addEventListener('change', event => { model.autoCollect = event.target.checked; persist(); }); document.querySelector('#setting-auto')?.addEventListener('change', event => { model.autoCollect = event.target.checked; persist(); }); document.querySelector('#setting-sound')?.addEventListener('change', event => { model.soundEnabled = event.target.checked; persist(); }); document.querySelector('#clear-save')?.addEventListener('click', () => { if (window.confirm('清除当前牌局、主题库和设置？此操作无法撤销。')) { localStorage.removeItem(saveKey); location.reload(); } });
  document.querySelector('#prompt')?.addEventListener('input', event => { model.studio.prompt = event.target.value; }); document.querySelector('#generate')?.addEventListener('click', generateTheme);
  document.querySelectorAll('[data-card-ref]').forEach(card => { const interact = event => { event.stopPropagation(); const ref = JSON.parse(card.dataset.cardRef); if (model.selected) attemptMove(ref); else selectCard(ref, card.dataset.start); }; card.addEventListener('click', interact); card.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); interact(event); } }); card.addEventListener('dblclick', event => { event.stopPropagation(); automaticMove(JSON.parse(card.dataset.cardRef), card.dataset.start); }); card.addEventListener('dragstart', event => { selectCard(JSON.parse(card.dataset.cardRef), card.dataset.start); event.dataTransfer.effectAllowed = 'move'; requestAnimationFrame(() => document.body.classList.add('is-dragging')); }); card.addEventListener('dragend', () => document.body.classList.remove('is-dragging')); });
  document.querySelectorAll('[data-ref]').forEach(target => { target.addEventListener('click', event => { if (event.target.closest('[data-card-ref]')) return; if (model.selected) attemptMove(JSON.parse(target.dataset.ref)); }); target.addEventListener('dragover', event => event.preventDefault()); target.addEventListener('drop', event => { event.preventDefault(); attemptMove(JSON.parse(target.dataset.ref)); }); target.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); const ref = JSON.parse(target.dataset.ref); if (model.selected) attemptMove(ref); else { const stack = getStack(model.game, ref); if (stack.length) selectCard(ref, stack.length - 1); } } }); });
}
document.addEventListener('keydown', event => { if (model.workLoading || model.workError) return; if (event.target.matches('input, textarea')) return; if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) { const slots = [...document.querySelectorAll('[data-ref]')]; const current = event.target.closest?.('[data-ref]'); const index = slots.indexOf(current); if (index >= 0) { const offset = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' ? -8 : 8; slots[(index + offset + slots.length) % slots.length]?.focus(); event.preventDefault(); return; } } if (event.key.toLowerCase() === 'n') newDeal(); if (event.key.toLowerCase() === 'r') resetDeal(); if (event.key.toLowerCase() === 'h') showHint(); if (event.ctrlKey && event.key.toLowerCase() === 'z') { event.preventDefault(); undo(); } if (event.ctrlKey && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); } });
window.setInterval(() => { if (model.view === 'game' && !model.s6 && !model.workLoading && !model.workError) { model.game.elapsedMs = elapsed(); model.startedAt = Date.now(); persist(); const timer = document.querySelector('.run-stats .stat:nth-child(3) strong'); if (timer) timer.textContent = duration(model.game.elapsedMs); } }, 1000);
function syncViewFromLocation() { const next = location.hash.slice(1); model.view = validViews.has(next) ? next : 'home'; model.selected = null; model.hint = null; if (!validViews.has(next)) history.replaceState({ view: model.view }, '', '#home'); render(); }
window.addEventListener('popstate', syncViewFromLocation);
window.addEventListener('hashchange', syncViewFromLocation);
window.addEventListener('pagehide', () => { flushAnalytics(`${API_BASE}/analytics`); });
render();
loadPipelineStatus();
bootstrapPartnerSession();
if (!workId && !partnerLaunch && !sessionStorage.getItem('freecell-partner-session')) restoreServerThemes({ quiet: true });
if (workId) loadPublishedWork();
Promise.all([normalizeGlyphScales(model.theme), tintSuitMotifs(model.theme)]).then(results => { if (results.some(Boolean)) { persist(); render(); } }).catch(() => {});
if (pendingJobId && !partnerLaunch && !sessionStorage.getItem('freecell-partner-session')) pollThemeJob(pendingJobId).catch(error => { localStorage.removeItem('theme-freecell-pending-job'); model.studio.busy = false; model.studio.result = { error: `无法恢复主题任务：${error.message}` }; render(); });
