import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GameService } from './game-engine.mjs';
import { PalProductionService } from './pal-production.mjs';
import { PalResourcePipeline } from './pal-resource-pipeline.mjs';
import { AssetRegistry } from './asset-registry.mjs';
import { ConfirmedPalStore } from './pal-roster-store.mjs';
import { PartnerPlatformClient } from './partner-platform.mjs';
import { PartnerSessionStore } from './partner-session-store.mjs';
import { createOfficialPal } from '../../packages/pal-asset-contract/index.mjs';
import { DEFAULT_SEATS } from '../../packages/contracts/index.mjs';

const root = fileURLToPath(new URL('../web/', import.meta.url));
const projectRoot = join(root, '../..');

/* 生产部署支持从项目根目录的 .env.production.local 读取密钥。
   已注入的进程环境优先，避免配置文件意外覆盖平台注入值；配置文件只在服务端读取，
   不会被静态资源路由暴露。开发环境仍可使用 .env.local 做本地配置。 */
async function loadLocalEnv() {
  const candidates = [
    process.env.ENV_FILE,
    /* 文件名本身就是生产配置的显式选择；这样配置文件内的 NODE_ENV=production
       能在服务启动前被读到，而不要求用户再做一次 PowerShell 注入。 */
    join(projectRoot, '.env.production.local'),
    join(projectRoot, '.env.local')
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const text = await readFile(candidate, 'utf8');
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
        if (!match || process.env[match[1]] !== undefined) continue;
        let value = match[2].trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
        process.env[match[1]] = value;
      }
      break;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}

await loadLocalEnv();
if (process.env.NODE_ENV === 'production') {
  const secret = process.env.TOKEN_RECEIPT_SECRET || '';
  if (secret.length < 32 || secret === 'development-only-change-before-production' || secret.includes('<')) {
    throw new Error('Production requires a non-placeholder TOKEN_RECEIPT_SECRET of at least 32 characters.');
  }
  if (process.env.ALLOW_DEBUG_ROUTES === '1') throw new Error('Production cannot enable ALLOW_DEBUG_ROUTES.');
}
const { version: appVersion } = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webm': 'video/webm', '.mp4': 'video/mp4' };
const linxingOutfits = [
  /* 写真馆只收录有独立回放视频的套装。静态服装图可作为牌桌表现资源，但不能冒充
     写真回放卡；这样每张解锁卡都能播放自己的演出。舞台实录排在首位，作为林星首局奖品。
     三个引用分工明确（都由 scripts/make-dance-assets.mjs 从同一帧产出）：
       outfit     3:4 信箱式静帧，给 .dressup-figure（cover）与静态卡面用——4:7 直接当 outfit 会被裁掉脚
       cardPoster 原始 4:7 整帧，给 <video poster> 与模糊填充底——跟着 contain 走才和播放画面严格对齐
     base 指回 linxing-v1.png 是为了让「换装完成 → 定格」两步之间的画面不跳。
     2026-09-20 去重：经逐帧核对，linxing03（原「午夜酒馆」）与 linxing_兔子 是同一段兔耳旗袍表演，
     linxing04（原「黑缎夜曲」）与 linxing_泳衣 是同一段海滩比基尼表演——那两段早在 9-15/9-17
     被当新套系交付过。按用户决策下架这两套重名卡，保留名实相符的「月兔礼赞」「汐岸泳装」，
     重复文件留档（official-assets.json 标 DUPLICATE_OF）。 */
  { outfitId: 'stage-film', name: '舞台实录', dance: '月光步', layerSnapshot: { base: '/assets/pals/linxing-v1.png', outfit: '/assets/pals/outfits/linxing-stage-film-frame.jpg', cardVideo: '/assets/pals/video/linxing-dance-v1.mp4', cardPoster: '/assets/pals/outfits/linxing-stage-film.jpg' } },
  /* 用户提供 linxing-dance-V2（2026-09-18）：女仆装独立套系，卡面/封面/剪影均由同一段视频取帧，
     与舞台实录等既有套系互不复用。 */
  { outfitId: 'moon-maid', name: '月光女仆', dance: '侍月步', layerSnapshot: { base: '/assets/pals/linxing-v1.png', outfit: '/assets/pals/outfits/linxing-moon-maid-frame.jpg', cardVideo: '/assets/pals/video/linxing-moon-maid-v1.mp4', cardPoster: '/assets/pals/outfits/linxing-moon-maid.jpg' } },
  /* 用户提供 linxing_兔子.mp4 / linxing_泳衣.mp4（2026-09-17 交付，2026-09-19 接入）：
     两套都与月光女仆同一取帧流程；源片左上角带「AI生成」水印，如实保留。 */
  { outfitId: 'moon-bunny', name: '月兔礼赞', dance: '兔跃步', layerSnapshot: { base: '/assets/pals/linxing-v1.png', outfit: '/assets/pals/outfits/linxing-moon-bunny-frame.jpg', cardVideo: '/assets/pals/video/linxing-moon-bunny-v1.mp4', cardPoster: '/assets/pals/outfits/linxing-moon-bunny.jpg' } },
  { outfitId: 'sunset-swim', name: '汐岸泳装', dance: '踏浪步', layerSnapshot: { base: '/assets/pals/linxing-v1.png', outfit: '/assets/pals/outfits/linxing-sunset-swim-frame.jpg', cardVideo: '/assets/pals/video/linxing-sunset-swim-v1.mp4', cardPoster: '/assets/pals/outfits/linxing-sunset-swim.jpg' } }
];
/* 银岚（源自 linxing_dance02 的银发少女）。她只有一套写真：源片就是整段黄昏球场舞蹈，
   所以卡面直接走录像卡面；layers.outfit 是同一帧的 3:4 信箱式静帧，不是另画的一张图——
   两者同源，卡面、换装定格、剪影三个画面不会出现「换了个人」。 */
const yinlanOutfits = [
  /* 2026-09-20 用户决策：银岚只保留已解锁的「暮色球场」；
     「金发球场」（xx_dance02）下架留档（official-assets.json 标 SOURCE_ONLY）。 */
  { outfitId: 'court-dusk', name: '暮色球场', dance: '新月节拍', layerSnapshot: { base: '/assets/pals/yinlan-v1.png', outfit: '/assets/pals/outfits/yinlan-court-dusk-frame.jpg', cardVideo: '/assets/pals/video/nova-dance-v1.mp4', cardPoster: '/assets/pals/outfits/yinlan-court-dusk.jpg' } }
];
const miaOutfits = [
  /* 米娅的三段生成舞片各自锁定一套服装：卡面、结算舞台与影片不得退回角色默认片。
     poster 是同源 4:7 收尾帧；frame 是 3:4 信箱式定格，避免被 L2 cover 裁掉脚。
     2026-09-20 用户决策：只保留已解锁的「粉兔女仆」；薄荷晚宴、黑金总裁、暗夜运动
     三套下架留档（official-assets.json 标 SOURCE_ONLY）。
     源片于 2026-09-17 被替换为粉色兔女仆舞台片（用户确认认领这套）；卡面/封面/剪影
     已于 2026-09-19 从现视频重取同源帧。outfitId 保持不变：已解锁卡 pal-mia:sporty-sweetheart
     的编号与升级记录都锚在它上面。原薄荷运动装卡面留档为 mint-legacy。 */
  { outfitId: 'sporty-sweetheart', name: '粉兔女仆', dance: '甜兔节拍', layerSnapshot: { base: '/assets/pals/mia-v1.png', outfit: '/assets/pals/outfits/mia-sporty-sweetheart-frame.jpg', cardVideo: '/assets/pals/video/mia-sporty-sweetheart-v1.mp4', cardPoster: '/assets/pals/outfits/mia-sporty-sweetheart.jpg' } }
];
const officialPals = [
  createOfficialPal({ palId: 'pal-linxing', name: '林星', accent: '#ff7aa8', outfit: '舞台实录', dance: '月光步', portraitRef: '/assets/pals/linxing-v1.png', actionSheetRef: '/assets/pals/linxing-actions-v1.png', entryVideoRef: '/assets/pals/video/linxing-entry-v2.mp4', danceVideoRef: '/assets/pals/video/linxing-dance-v1.mp4', dancePosterRef: '/assets/pals/outfits/linxing-stage-film.jpg', actionVideoRefs: { A01: '/assets/pals/video/linxing-A01-idle-v1.webm', A02: '/assets/pals/video/linxing-A02-play-v1.webm', A03: '/assets/pals/video/linxing-A03-pass-v1.webm', A04: '/assets/pals/video/linxing-A04-win-v1.webm', A05: '/assets/pals/video/linxing-A05-lose-v1.webm' }, outfits: linxingOutfits, standeeRef: '/assets/pals/linxing-standee.png', entryPosterRef: '/assets/pals/video/linxing-entry-v2-poster.jpg', actionImageRefs: { A01: '/assets/pals/actions/linxing-A01.png', A02: '/assets/pals/actions/linxing-A02.png', A03: '/assets/pals/actions/linxing-A03.png', A04: '/assets/pals/actions/linxing-A04.png', A05: '/assets/pals/actions/linxing-A05.png' } }),
  createOfficialPal({ palId: 'pal-mia', name: '米娅', accent: '#7dd3fc', outfit: '粉兔女仆', dance: '甜兔节拍', portraitRef: '/assets/pals/mia-v1.png', actionSheetRef: '/assets/pals/mia-actions-v1.png', entryVideoRef: '/assets/pals/video/mia-entry-v1.mp4', actionVideoRefs: { A01: '/assets/pals/video/mia-A01-idle-v1.webm', A02: '/assets/pals/video/mia-A02-play-v1.mp4', A03: '/assets/pals/video/mia-A03-pass-v1.mp4', A04: '/assets/pals/video/mia-A04-win-v1.mp4', A05: '/assets/pals/video/mia-A05-lose-v1.mp4' }, outfits: miaOutfits, standeeRef: '/assets/pals/mia-standee.png', entryPosterRef: '/assets/pals/video/mia-entry-v1-poster.jpg', actionImageRefs: { A01: '/assets/pals/actions/mia-A01.png', A02: '/assets/pals/actions/mia-A02.png', A03: '/assets/pals/actions/mia-A03.png', A04: '/assets/pals/actions/mia-A04.png', A05: '/assets/pals/actions/mia-A05.png' } }),
  /* 银岚刻意排在名册末位：官方默认座位（DEFAULT_SEATS = 林星 + 米娅）不受影响，
     她是「可换上场」的第三位，而不是把现有牌局的默认阵容换掉。
     actionSheetRef 保持 preset:// 缺省值——她没有五态动作表，写一个不存在的路径比
     写 preset 更不诚实（前端有 standeeRef 时走抠像分支，永远不会去取这张图）。 */
  /* 银岚的横版入场片与竖屏写真片严格分离：entry-v1 只用于开局入席，
     nova-dance-v1 保留给「暮色球场」写真卡，防止入场重复剧透她的收藏演出。
     L1 首页采用专门的半身主视觉。L2 牌桌：2026-09-19 以 yinlan-v1.png 为参考经 AIHub 即梦
     重产的专用半身透明立绘（scripts/produce-official-gaps.mjs，验收通过）——此前手工替换的
     水手服图（yinlan-seat.png）已按 REJECTED_MANUAL 撤下留档，期间曾以全身立绘回退。 */
  createOfficialPal({ palId: 'pal-yinlan', name: '银岚', accent: '#aab8e8', outfit: '暮色球场', dance: '新月节拍', portraitRef: '/assets/pals/yinlan-v1.png', entryVideoRef: '/assets/pals/video/yinlan-entry-v1.mp4', entryPosterRef: '/assets/pals/video/yinlan-entry-v1-poster.jpg', danceVideoRef: '/assets/pals/video/nova-dance-v1.mp4', dancePosterRef: '/assets/pals/outfits/yinlan-court-dusk.jpg', outfits: yinlanOutfits, standeeRef: '/assets/pals/yinlan-standee.png', loungeStandeeRef: '/assets/pals/yinlan-lounge.png', tableStandeeRef: '/assets/pals/yinlan-table-standee.png' })
];
let latestGameId = null;
const confirmedPalStore = new ConfirmedPalStore(process.env.CONFIRMED_PALS_PATH || join(root, '../api/data/confirmed-pals.json'));
let workshop = { versions: [], versionSeq: 0, plans: [] };
function confirmedAssets() { return confirmedPalStore.list(); }
/* 可上桌名册 = 官方牌友 + 已确认建档的自定义牌友（同一 palId 只保留最新版本）。
   “已生成”只是候选，不是上桌资格；注册表仍须在开局当刻读取。 */
function palRoster() {
  const roster = new Map(officialPals.map((pal) => [pal.palId, pal]));
  for (const asset of confirmedAssets()) {
    const current = roster.get(asset.palId);
    if (!current || (asset.version || 0) >= (current.version || 0)) roster.set(asset.palId, asset);
  }
  return roster;
}
const game = new GameService({
  receiptSecret: process.env.TOKEN_RECEIPT_SECRET,
  galleryPath: process.env.GALLERY_STATE_PATH || join(root, '../api/data/gallery.json'),
  walletPath: process.env.TOKEN_STATE_PATH || join(root, '../api/data/player-wallet.json'),
  initialTokenBalance: Number(process.env.INITIAL_TOKEN_BALANCE || 100),
  palDialogue: Object.fromEntries(officialPals.map((pal) => [pal.palId, pal.dialoguePack])),
  palOutfits: { 'pal-linxing': linxingOutfits, 'pal-mia': miaOutfits, 'pal-yinlan': yinlanOutfits },
  palRegistry: palRoster
});
const palProduction = new PalProductionService({
  assetDir: join(root, 'assets/pals/ugc'),
  onReady: (candidate) => { workshop.versions.push(candidate); }
});
/* 工坊的正式资源生产采用“任务先于异步调用”模型。legacy PalProductionService
   仅保留给兼容性测试；新资料包统一走完整首发包的 PalResourcePipeline。 */
const palResources = new PalResourcePipeline({
  assetDir: join(root, 'assets/pals/ugc'),
  statePath: process.env.PAL_RESOURCE_STATE_PATH || join(root, '../api/data/pal-resource-tasks.json'),
  onReady: (candidate) => {
    const index = workshop.versions.findIndex((entry) => entry.asset?.palId === candidate.asset?.palId);
    if (index >= 0) workshop.versions[index] = candidate; else workshop.versions.push(candidate);
  }
});
/* 资产注册表：官方登记 + UGC 管线任务 + 源素材包的统一账目（六字段：角色/服装/用途/动作/来源/验收状态）。 */
const assetRegistry = new AssetRegistry({
  webRoot: root,
  projectRoot,
  officialPath: process.env.OFFICIAL_ASSETS_PATH || join(root, '../api/data/official-assets.json'),
  pipeline: palResources
});
/* 第三方模板接入：平台签名客户端 + 创作会话存储（app_secret 只在本后端使用）。 */
const partnerClient = new PartnerPlatformClient();
const partnerSessions = new PartnerSessionStore(process.env.PARTNER_SESSIONS_PATH || join(root, '../api/data/partner-sessions.json'));
/* 存量五态源图补拆（一次性迁移；产物保持 AWAITING_REVIEW，在工坊逐张验收后才绑定上桌）。 */
palResources.backfillActionSheets().catch((error) => console.warn(`action-sheet backfill failed: ${error.message}`));

async function restoreWorkshopPlans() {
  await palResources.ready;
  for (const recovered of palResources.plans()) {
    if (!workshop.plans.some((plan) => plan.planId === recovered.planId)) workshop.plans.push(recovered);
    workshop.versionSeq = Math.max(workshop.versionSeq, Number(recovered.identity?.version || 0));
  }
}

async function workshopPayload() {
  await restoreWorkshopPlans();
  /* 工作流查询包含多个外部 HTTP 请求，不得阻塞工坊首屏。
     页面立即读取最近一次已持久化状态；后台刷新收敛后，下一次轮询
     自然展示新状态。这也避免长视频任务让整个页面白屏。 */
  void palResources.refresh()
    .then(async () => { for (const plan of workshop.plans) await palResources.tryPromote(plan); })
    .catch((error) => console.warn(`pal resource refresh failed: ${error.message}`));
  return {
  ...workshop,
    confirmed: confirmedAssets(),
    plans: workshop.plans.map((plan) => palResources.enrichPlan(plan)),
    jobs: [...palProduction.listJobs(), ...palResources.list()],
    generation: { legacy: palProduction.capability(), routes: palResources.capability() }
  };
}

/* A5 调试入口收口：种子局与运行检查器只在非生产环境开放。
   生产部署时 NODE_ENV=production 会让这两条入口直接返回 403，而不是静默忽略。 */
const debugEnabled = process.env.NODE_ENV !== 'production' || process.env.ALLOW_DEBUG_ROUTES === '1';
function guarded(res) { return !debugEnabled; }

function send(res, status, data) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); }
async function body(req) { let raw = ''; for await (const chunk of req) raw += chunk; try { return raw ? JSON.parse(raw) : {}; } catch { throw new Error('请求 JSON 无法解析。'); } }
function error(res, message, status = 400) { send(res, status, { error: message }); }
async function api(req, res, pathname) {
  if (req.method === 'POST' && pathname === '/api/game/new') {
    const data = await body(req);
    const wantsSeed = Number.isInteger(data.seed);
    if (wantsSeed && guarded(res)) return error(res, '调试入口已关闭：生产环境不接受指定牌局种子。', 403);
    const options = wantsSeed ? { seed: data.seed } : {};
    /* 座位由前端指定；服务端会用名册逐个校验，未建档的 palId 直接拒绝开局。 */
    if (Array.isArray(data.seats)) options.seats = data.seats;
    latestGameId = game.newGame(options).id;
    return send(res, 201, game.snapshot(game.get(latestGameId)));
  }
  if (req.method === 'GET' && pathname === '/api/game') return latestGameId ? send(res, 200, game.snapshot(game.get(latestGameId))) : send(res, 200, { game: null });
  if (req.method === 'GET' && pathname === '/api/game/wallet') return send(res, 200, game.getAccount());
  if (req.method === 'POST' && pathname === '/api/game/bid') { const data = await body(req); return send(res, 200, game.bid(data.gameId, data.score, data.commandId)); }
  if (req.method === 'POST' && pathname === '/api/game/grab') { const data = await body(req); return send(res, 200, game.grab(data.gameId, data.accept, data.commandId)); }
  if (req.method === 'POST' && pathname === '/api/game/advance-bid') { const data = await body(req); return send(res, 200, game.advanceBid(data.gameId, data.commandId)); }
  if (req.method === 'GET' && pathname === '/api/game/hint') { const id = new URL(req.url, 'http://local').searchParams.get('gameId'); return send(res, 200, game.hint(id)); }
  if (req.method === 'POST' && pathname === '/api/game/play') { const data = await body(req); return send(res, 200, game.play(data.gameId, data.cards, data.commandId)); }
  if (req.method === 'POST' && pathname === '/api/game/pass') { const data = await body(req); return send(res, 200, game.pass(data.gameId, data.commandId)); }
  if (req.method === 'POST' && pathname === '/api/game/advance-turn') { const data = await body(req); return send(res, 200, game.advanceTurn(data.gameId, data.commandId)); }
  if (req.method === 'POST' && pathname === '/api/game/settlement/advance') { const data = await body(req); return send(res, 200, game.advanceSettlement(data.gameId)); }
  if (req.method === 'GET' && pathname === '/api/pals') return send(res, 200, { official: officialPals, pals: [...palRoster().values()], defaultSeats: DEFAULT_SEATS, workshop: await workshopPayload() });
  if (req.method === 'GET' && pathname === '/api/assets/registry') return send(res, 200, await assetRegistry.build());
  /* ---- 第三方平台接入（ticket 会话与作品回传；app_secret 仅服务端使用） ---- */
  if (req.method === 'GET' && pathname === '/api/partner/status') {
    const sessionId = new URL(req.url, 'http://local').searchParams.get('sessionId');
    const session = sessionId ? partnerSessions.get(sessionId) : null;
    return send(res, 200, { configured: partnerClient.capability().configured, capability: partnerClient.capability(), session });
  }
  if (req.method === 'POST' && pathname === '/api/partner/session') {
    const data = await body(req);
    const ticket = String(data.ticket || '').trim();
    if (!ticket) return error(res, '缺少 ticket。');
    const exchanged = await partnerClient.ticketExchange({ ticket, partnerSessionId: 'dressbattle-partner' });
    const session = partnerSessions.create({
      userRef: exchanged.user_ref || null,
      draftId: exchanged.draft_id || null,
      templateId: exchanged.template_id || data.template_id || null,
      returnUrl: String(data.return_url || ''),
      expireAt: exchanged.expire_at || null,
      submitDeadline: exchanged.submit_deadline || null,
      externalWorkId: `dressbattle-${exchanged.draft_id || randomUUID()}`
    });
    return send(res, 200, { sessionId: session.sessionId, user_ref: session.userRef, draft_id: session.draftId, template_id: session.templateId, expire_at: session.expireAt });
  }
  if (req.method === 'POST' && pathname === '/api/partner/progress') {
    const data = await body(req);
    const session = partnerSessions.get(String(data.sessionId || ''));
    if (!session) return error(res, '平台会话不存在或已过期，请从平台重新发起。', 404);
    return send(res, 200, await partnerClient.workProgress({ draftId: session.draftId, percent: Number(data.percent || 0), stage: String(data.stage || 'playing'), message: String(data.message || '') }));
  }
  if (req.method === 'POST' && pathname === '/api/partner/submit') {
    const data = await body(req);
    const session = partnerSessions.get(String(data.sessionId || ''));
    if (!session) return error(res, '平台会话不存在或已过期，请从平台重新发起。', 404);
    if (session.status === 'submitted' && session.workId) return send(res, 200, { work_id: session.workId, work_url: session.workUrl, idempotent: true });
    const result = await partnerClient.workSubmit({
      draftId: session.draftId,
      externalWorkId: session.externalWorkId,
      title: String(data.title || '换装斗地主'),
      description: String(data.description || '与 AI 牌友的月夜牌局：观察动作与台词出牌，赢下现场换装演出并收藏写真卡。')
    });
    partnerSessions.update(session.sessionId, { status: 'submitted', workId: result.work_id || null, workUrl: result.work_url || null, submittedAt: new Date().toISOString() });
    return send(res, 200, result);
  }
  if (req.method === 'POST' && pathname === '/api/pals/plan') {
    const data = await body(req);
    const plan = palProduction.createPlan({ prompt: data.prompt, name: data.name || '', version: workshop.versionSeq + 1, packageTier: data.packageTier || 'launch', videoReferenceUrl: data.videoReferenceUrl || '', clothingStyle: data.clothingStyle || 'described', accessory: data.accessory || 'none' });
    if (plan.status === 'PLANNED') {
      workshop.plans.push(plan);
      /* 版本号在计划建立时即被占用，不能等到后续资源提交才递增；
         否则用户连续建立两个计划会得到相同的 v版本，任务和文件难以追溯。 */
      workshop.versionSeq = Math.max(workshop.versionSeq, Number(plan.identity?.version || 0));
    }
    return send(res, plan.status === 'PLANNED' ? 201 : 200, plan);
  }
  if (req.method === 'POST' && pathname === '/api/pals/generate') {
    const data = await body(req);
    const result = palProduction.createJob({ prompt: data.prompt, name: data.name || '', version: workshop.versionSeq + 1, packageTier: 'launch', clothingStyle: data.clothingStyle || 'described', accessory: data.accessory || 'none' });
    if (result.status === 'QUEUED') workshop.versionSeq += 1;
    return send(res, result.status === 'QUEUED' ? 202 : 200, result);
  }
  if (req.method === 'POST' && pathname === '/api/pals/resources/submit') {
    const data = await body(req);
    await restoreWorkshopPlans();
    const plan = workshop.plans.find((entry) => entry.planId === data.planId);
    if (!plan) return error(res, '资源计划不存在；请先在牌友工坊建立计划。', 404);
    const result = await palResources.submit({ plan, resourceIds: data.resourceIds });
    if (result.status === 'SUBMITTED') workshop.versionSeq = Math.max(workshop.versionSeq, Number(plan.identity?.version || 0));
    return send(res, result.status === 'SUBMITTED' ? 202 : 200, result);
  }
  if (req.method === 'POST' && pathname === '/api/pals/resources/portrait/confirm') {
    const data = await body(req);
    await restoreWorkshopPlans();
    const plan = workshop.plans.find((entry) => entry.planId === data.planId);
    if (!plan) return error(res, '资源计划不存在；请先在牌友工坊建立计划。', 404);
    const approval = await palResources.confirmPortrait(plan);
    /* Confirmation is a hard user gate. It must not implicitly submit the
       remaining package; the following explicit "继续生产" action owns that
       side effect and receives the locked profile-card URL. */
    return send(res, 200, { ...approval, portraitGate: palResources.portraitGate(plan), production: { status: 'AWAITING_CONTINUE', planId: plan.planId } });
  }
  if (req.method === 'POST' && pathname === '/api/pals/resources/review') {
    const data = await body(req);
    const task = await palResources.confirmResource(data.taskId);
    return send(res, 200, { task });
  }
  if (req.method === 'POST' && pathname === '/api/pals/resources/reject') {
    const data = await body(req);
    const result = await palResources.rejectResource(data.taskId, { reason: data.reason || '', reproduce: Boolean(data.reproduce), promptPatch: data.promptPatch || '', scope: data.scope || 'RESOURCE_ONLY' });
    return send(res, 200, result);
  }
  /* 原地重启：失败/卡住的任务同一 taskId 重跑；已提交未取回的先按当前 run 取回现成产物。 */
  if (req.method === 'POST' && pathname === '/api/pals/resources/restart') {
    const data = await body(req);
    const task = await palResources.restartResource(data.taskId, { promptPatch: data.promptPatch || '', reason: data.reason || '' });
    return send(res, 200, { task });
  }
  if (req.method === 'POST' && pathname === '/api/pals/resources/refine-alpha') {
    const data = await body(req);
    const task = await palResources.refineLocalAlpha(data.taskId, { removeLargeWhiteIslands: data.removeLargeWhiteIslands === true });
    return send(res, 200, { task });
  }
  if (req.method === 'POST' && pathname === '/api/pals/resources/action-from-image') {
    const data = await body(req);
    await restoreWorkshopPlans();
    const plan = workshop.plans.find((entry) => entry.planId === data.planId);
    if (!plan) return error(res, '资源计划不存在；请先在牌友工坊建立计划。', 404);
    const task = await palResources.createActionVideoFromApprovedImage(plan, data.resourceId, { reason: data.reason || '' });
    return send(res, 200, { task });
  }
  if (req.method === 'POST' && pathname === '/api/pals/resources/source') {
    const data = await body(req);
    await restoreWorkshopPlans();
    const plan = workshop.plans.find((entry) => entry.planId === data.planId);
    if (!plan) return error(res, '资源计划不存在；请先在牌友工坊建立计划。', 404);
    const result = data.purpose === 'action-video-first-frame'
      ? await palResources.attachActionVideoSource(plan, data.resourceId, data.sourceUrl)
      : await palResources.attachSourceUrl(plan, data.resourceId || 'master-portrait', data.sourceUrl);
    return send(res, 200, result);
  }
  if (req.method === 'POST' && pathname === '/api/pals/resources/refresh') {
    await palResources.refresh();
    for (const plan of workshop.plans) await palResources.tryPromote(plan);
    return send(res, 200, { tasks: palResources.list() });
  }
  if (req.method === 'POST' && pathname === '/api/pals/plans/delete') {
    const data = await body(req);
    await restoreWorkshopPlans();
    const planId = String(data.planId || '').trim();
    const plan = workshop.plans.find((entry) => entry.planId === planId);
    if (!plan) return error(res, '资源计划不存在或已经删除。', 404);
    const result = await palResources.deletePlan(planId);
    workshop.plans = workshop.plans.filter((entry) => entry.planId !== planId);
    return send(res, 200, result);
  }
  if (req.method === 'POST' && pathname === '/api/pals/tasks/delete') {
    const data = await body(req);
    if (data.taskId) return send(res, 200, await palResources.deleteTask(data.taskId));
    if (data.jobId) return send(res, 200, palProduction.deleteJob(data.jobId));
    return error(res, '缺少生产任务 ID。');
  }
  if (req.method === 'POST' && pathname === '/api/pals/tasks/prune-superseded') {
    return send(res, 200, await palResources.pruneSupersededTasks());
  }
  if (req.method === 'GET' && pathname.startsWith('/api/pals/jobs/')) {
    const job = palProduction.getJob(pathname.slice('/api/pals/jobs/'.length));
    return job ? send(res, 200, job) : error(res, '生成任务不存在。', 404);
  }
  if (req.method === 'POST' && pathname === '/api/pals/confirm') { const data = await body(req); await restoreWorkshopPlans(); for (const plan of workshop.plans) await palResources.tryPromote(plan); const candidate = workshop.versions.find((item) => item.asset?.palId === data.palId); if (!candidate) throw new Error('没有可确认的已完成牌友。'); if (candidate.package?.state === 'ASSET_PENDING') throw new Error('完整首发包尚缺动作或演出资源，未达到上桌门槛。'); const confirmed = confirmedPalStore.confirm(candidate.asset); return send(res, 200, { confirmed, roster: [...palRoster().values()] }); }
  if (req.method === 'POST' && pathname === '/api/pals/discard') { const data = await body(req); const index = workshop.versions.findIndex((item) => item.asset?.palId === data.palId); if (index < 0) throw new Error('没有这个候选牌友。'); workshop.versions.splice(index, 1); confirmedPalStore.remove(data.palId); return send(res, 200, { workshop }); }
  if (req.method === 'POST' && pathname === '/api/pals/confirmed/delete') {
    const data = await body(req);
    const palId = String(data.palId || '').trim();
    if (!palId) return error(res, '缺少牌友 ID。');
    const removed = confirmedPalStore.remove(palId);
    return send(res, 200, { status: removed ? 'DELETED' : 'NOT_FOUND', palId });
  }
  if (req.method === 'GET' && pathname === '/api/gallery') return send(res, 200, { cards: game.getGallery(), officialPals, collection: game.getCollection() });
  if (req.method === 'POST' && pathname === '/api/gallery/compose') { const data = await body(req); return send(res, 200, { creation: game.savePhoto(data) }); }
  if (req.method === 'POST' && pathname === '/api/gallery/seen') { const data = await body(req); return send(res, 200, { cards: game.markCardSeen(data.cardId) }); }
  if (req.method === 'GET' && pathname === '/api/inspect') {
    if (guarded(res)) return error(res, '调试入口已关闭：生产环境不开放运行检查器。', 403);
    const assetSummary = await assetRegistry.summary();
    return send(res, 200, { assets: assetSummary, generatorMode: palResources.capability().configured ? 'route-locked-production' : 'provider-unavailable', moderationMode: 'local-policy-gates', game: latestGameId ? game.snapshot(game.get(latestGameId)) : null, ledger: game.getLedger(), workshop: await workshopPayload(), officialPals, providerNote: '角色资料卡、上桌/大厅立绘、五态动作图和服装特效使用 AIHub GPT Image 2 透明输出；首套服装写真与海报等非透明图片使用 AIHub 即梦；入场与五态动作视频使用 AIHub Seedance；只有首套跳舞视频使用指定 AIHub 跳舞工作流。所有任务都通过 run/status/outputs 回读，未配置或失败项不会晋升为可上桌资产。' }); }
  if (req.method === 'GET' && pathname === '/health') return send(res, 200, { ok: true, version: appVersion, environment: process.env.NODE_ENV || 'development', debugEnabled, mode: palResources.capability().configured ? 'production-routes' : 'provider-unavailable', ruleRuntime: 'local authoritative adapter' });
  return false;
}
export const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(req.url.split('?')[0]);
    if (pathname.startsWith('/api/') || pathname === '/health') { const handled = await api(req, res, pathname); if (handled !== false) return; return error(res, 'API route not found', 404); }
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^[/\\]+/, '');
    const path = normalize(join(root, relative));
    if (!path.startsWith(normalize(root))) return error(res, 'Forbidden', 403);
    const info = await stat(path); if (!info.isFile()) throw new Error('not a file');
    const type = mime[extname(path)] || 'application/octet-stream';
    const etag = `W/"${info.size}-${Math.floor(info.mtimeMs)}"`;
    const headers = {
      'Content-Type': type,
      'Cache-Control': relative.startsWith('assets/') ? 'public, max-age=86400' : 'no-cache',
      ETag: etag,
      'Accept-Ranges': 'bytes'
    };
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (range && (range[1] || range[2])) {
      let start = range[1] ? parseInt(range[1], 10) : 0;
      let end = range[2] ? parseInt(range[2], 10) : info.size - 1;
      if (!range[1]) { start = Math.max(0, info.size - parseInt(range[2], 10)); end = info.size - 1; }
      if (start >= info.size || end >= info.size || start > end) {
        res.writeHead(416, { ...headers, 'Content-Range': `bytes */${info.size}` });
        return res.end();
      }
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${info.size}`, 'Content-Length': end - start + 1 });
      return createReadStream(path, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...headers, 'Content-Length': info.size });
    createReadStream(path).pipe(res);
  } catch (err) { error(res, err.message || 'Unexpected server error', 400); }
});
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4173);
  const host = process.env.HOST || '127.0.0.1';
  server.listen(port, host, () => console.log(`换装斗地主 MVP: http://${host}:${server.address().port}`));
}
