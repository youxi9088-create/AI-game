import { CONTRACT_VERSION, validatePalAsset } from '../contracts/index.mjs';
import { RESOURCE_SLOTS } from '../../apps/web/asset-slots.js';

const blocked = [/\b(?:celebrity|star|actor)\b/i, /明星|名人|真人|照片|未成年|学生制服|裸露|色情|情色/];
const accents = ['#8e69ff', '#ff7aa8', '#7dd3fc', '#f5c26b', '#7ce0a5', '#ff9f6e', '#c9a2ff', '#5fd4d0'];
const naturalNames = ['墨鸢', '霁月', '绛雪', '澜音', '青黛', '雾绫', '星岚', '绮夜'];
/* 全局视觉基准：锁定林星的画面制作语言，不复制林星的人物身份、脸型或服装。 */
export const LINXING_STYLE_LOCK = 'Match the current Linxing visual direction, not her identity: high-end semi-realistic cinematic game CG with natural skin, hair and fabric materials; premium adult fashion-editorial finish; low-key midnight casino lighting; deep midnight navy and violet color grade with restrained champagne-gold practical lights and rim light; shallow depth of field and soft bokeh; clean readable silhouette; consistent camera language, facial rendering and body proportions across every asset; no cel shading, no thick anime outlines, no chibi proportions, no flat posterized colors.';
export const PAL_IDENTITY_SEPARATION_LOCK = 'Create a clearly original person who cannot be mistaken for Linxing, Yinlan, or any existing roster character. Reference Linxing for rendering, materials, lighting and camera language only; never reuse an existing pal face, hairstyle, hair color, eye design, signature pose, prop, outfit silhouette or costume identity. The new character brief is the only source for identity and costume.';
export const DEFAULT_DANCE_REFERENCE_VIDEO_URL = 'https://gcdncs.cn.ndhy.com/v0.1/download?dentryId=b536385d-9707-4001-b700-cca86ea21791&attachment=true';
const dialogueSets = {
  '复古优雅': { idle: ['旧时光不催人。', '慢一点，牌面会说话。', '今晚的节奏刚刚好。'], play: ['这一手，像旧唱片的回旋。', '请看这一张。', '优雅落牌，轮到你了。'], pass: ['我留一个休止符。', '这一轮先听牌声。', '暂且不抢节拍。'], win: ['优雅地落幕。', '漂亮的一局。', '今晚的掌声属于牌桌。'], lose: ['下一支舞再赢回来。', '失手也是节奏的一部分。', '下一轮我会更稳。'] },
  '运动明快': { idle: ['热身完毕。', '状态在线，马上开打。', '来吧，节奏拉满。'], play: ['快攻，接住！', '这一手加速。', '出牌，别眨眼！'], pass: ['喘口气，先跳过。', '这一轮让你先跑。', '暂时收住攻势。'], win: ['漂亮，全场沸腾！', '拿下！', '这波配合太顺了。'], lose: ['擦擦汗，再来一局。', '没关系，继续追分。', '下一把打回来。'] },
  '暗夜摩登': { idle: ['夜色是我的底牌。', '灯影落下，牌局才刚开始。', '保持安静，观察先行。'], play: ['霓虹一闪，牌已落定。', '这一张，送到桌心。', '让夜色替我出牌。'], pass: ['这轮让给灯光。', '先按兵不动。', '留一点悬念。'], win: ['今夜属于我。', '漂亮，灯光都亮了。', '牌面已经给出答案。'], lose: ['夜还长，不急。', '这一局先记下。', '下一轮见真章。'] },
  '舞台轻奢': { idle: ['聚光灯已就位。', '先听一拍，再落牌。', '舞台准备好了。'], play: ['这一手交给我。', '跟上节拍。', '牌落桌心，演出继续。'], pass: ['先观察一下。', '这次把舞台让给你。', '留到下一拍。'], win: ['节奏不错。', '谢幕，掌声收好。', '这一局演得漂亮。'], lose: ['下一轮继续。', '别急，演出还没结束。', '下一拍我会追回来。'] }
};

/* 工坊的可选元素是结构化意图的一部分；提示词只引用这里的白名单，避免
   前端显示一个选项、但图片/视频生产忘记带上的漂移。 */
export const PAL_CLOTHING_OPTIONS = Object.freeze([
  { id: 'described', label: '按文字描述', prompt: 'Use the clothing described in the user brief.' },
  { id: 'maid', label: '优雅女仆装', prompt: 'an elegant adult maid-inspired dress with crisp white trim, tasteful apron details and refined tailoring' },
  { id: 'flight-attendant', label: '空姐制服风', prompt: 'a polished adult flight-attendant uniform-inspired outfit with a fitted jacket, neck scarf and premium fabric' },
  { id: 'cheongsam', label: '现代改良旗袍', prompt: 'a modern tailored cheongsam-inspired evening outfit with clean lines and opaque premium fabric' },
  { id: 'racing', label: '摩登赛车夹克', prompt: 'a premium adult racing-jacket look with sleek paneling, gloves and a controlled accent color' },
  { id: 'evening', label: '黑曜石晚宴礼服', prompt: 'a black high-collar tailored evening jacket-dress with a deep burgundy shawl and elegant clean tailoring' }
]);
export const PAL_ACCESSORY_OPTIONS = Object.freeze([
  { id: 'none', label: '无', prompt: 'no headwear or novelty accessory' },
  { id: 'bunny-ears', label: '兔耳朵发饰', prompt: 'a tasteful rabbit-ear headband accessory, integrated into the hairstyle' },
  { id: 'cat-ears', label: '猫耳朵发饰', prompt: 'a tasteful cat-ear headband accessory, integrated into the hairstyle' },
  { id: 'pearl', label: '珍珠耳饰', prompt: 'small pearl earrings and no other novelty accessory' },
  { id: 'ribbon', label: '丝带发饰', prompt: 'a refined satin ribbon hair accessory matching the outfit palette' }
]);
const optionById = (options, id) => options.find((item) => item.id === id) || null;

export const PAL_PACKAGE_TIERS = {
  launch: { id: 'launch', label: '完整首发包', seatGate: 'RICH_ASSETS_READY', summary: '角色级五态动作、入场与首套换装演出齐全后才允许上桌。' }
};

export function validateIntent(prompt) {
  const text = String(prompt || '').trim();
  if (text.length < 6) return { ok: false, gate: 'PL-1', reason: '描述至少需要 6 个字符。' };
  if (blocked.some((rule) => rule.test(text))) return { ok: false, gate: 'PL-7', reason: '仅支持成年外观的纯虚构角色，且不接受真人、名人或越界描述。' };
  return { ok: true, value: { sourceText: text, adultAppearance: true, fictional: true, style: pickStyle(text) } };
}

function pickStyle(text) {
  if (/复古|优雅/.test(text)) return '复古优雅';
  if (/运动|活力/.test(text)) return '运动明快';
  if (/摩登|夜|酷|摇滚/.test(text)) return '暗夜摩登';
  return '舞台轻奢';
}

function hashText(text) { let h = 5381; for (const ch of text) h = ((h * 33) ^ ch.codePointAt(0)) >>> 0; return h; }
export function normalizePalName(name) {
  const text = String(name || '').trim();
  if (!text) return '';
  if (text.length > 16 || !/^[\u4e00-\u9fffA-Za-z0-9·_-]+$/.test(text)) return null;
  return text;
}
function derivePalName(sourceText, suffix) {
  const text = String(sourceText || '');
  const explicit = text.match(/牌友\s*([\u4e00-\u9fff·]{2,8})(?=[，,。；;：:0-9]|$)/)?.[1]
    || text.match(/(?:名称|名字|名为|叫作?|称为)\s*[:：是为]?\s*([\u4e00-\u9fffA-Za-z0-9·_-]{2,16})/)?.[1];
  return explicit || naturalNames[Math.abs(Number(suffix) || 0) % naturalNames.length];
}
function assetIdentity(intent, version, requestedName = '') {
  const hash = hashText(intent.sourceText);
  const suffix = hash % 9999;
  return { suffix, accent: accents[hash % accents.length], style: intent.style, version, name: requestedName || derivePalName(intent.sourceText, suffix) };
}
function actionPack(sheetRef, actionVideoRefs = {}, actionMeta = {}) {
  const alphaApproval = (key) => actionMeta[key]?.alphaVisualApproved;
  return {
    A01: { action: 'idle', sheetRef, frame: [0, 0], videoRef: actionVideoRefs.A01 || null, alphaVisualApproved: alphaApproval('A01') },
    A02: { action: 'play', sheetRef, frame: [1, 0], videoRef: actionVideoRefs.A02 || null, alphaVisualApproved: alphaApproval('A02') },
    A03: { action: 'pass', sheetRef, frame: [2, 0], videoRef: actionVideoRefs.A03 || null, alphaVisualApproved: alphaApproval('A03') },
    A04: { action: 'win', sheetRef, frame: [0, 1], videoRef: actionVideoRefs.A04 || null, alphaVisualApproved: alphaApproval('A04') },
    A05: { action: 'lose', sheetRef, frame: [1, 1], videoRef: actionVideoRefs.A05 || null, alphaVisualApproved: alphaApproval('A05') }
  };
}

export function createProductionPlan({ prompt, version = 1, name = '', clothingStyle = 'described', accessory = 'none' }) {
  const checked = validateIntent(prompt);
  if (!checked.ok) return { status: 'BLOCKED', ...checked };
  const normalizedName = normalizePalName(name);
  if (normalizedName === null) return { status: 'BLOCKED', gate: 'PL-NAME', reason: '牌友名字只能包含中文、字母、数字、中点、下划线或短横线，且不超过 16 个字符。' };
  const clothing = optionById(PAL_CLOTHING_OPTIONS, clothingStyle);
  const accessoryChoice = optionById(PAL_ACCESSORY_OPTIONS, accessory);
  if (!clothing || !accessoryChoice) return { status: 'BLOCKED', gate: 'PL-OPTIONS', reason: '服装或配饰选项无效，请从工坊提供的选项中选择。' };
  const identity = assetIdentity(checked.value, version, normalizedName);
  const styleBrief = {
    '复古优雅': 'vintage elegant tailoring with restrained champagne-gold detail',
    '运动明快': 'polished sporty tailoring with a controlled cyan accent',
    '暗夜摩登': 'modern dark couture with a subtle violet highlight',
    '舞台轻奢': 'premium stagewear with a controlled champagne-gold detail'
  }[identity.style];
  const intent = { ...checked.value, clothingStyle: clothing.id, clothingLabel: clothing.label, accessory: accessoryChoice.id, accessoryLabel: accessoryChoice.label };
  const profileCard = {
    version: 'role-profile-card-v1', character: { name: identity.name, brief: intent.sourceText, adultAppearance: true, fictional: true },
    visualStyle: intent.style, clothing: { id: clothing.id, label: clothing.label, prompt: clothing.prompt },
    accessory: { id: accessoryChoice.id, label: accessoryChoice.label, prompt: accessoryChoice.prompt },
    actions: { idle: '待机呼吸与自然眨眼', play: '向牌桌出牌', pass: '克制地示意过牌', win: '克制胜利庆祝', lose: '失利后保持从容' }
  };
  const wardrobeManifest = {
    version: 'wardrobe-manifest-v1',
    outfitId: `outfit-${String(identity.version).padStart(3, '0')}`,
    label: `${clothing.label}${accessoryChoice.id === 'none' ? '' : ` · ${accessoryChoice.label}`}`,
    palette: [identity.style, clothing.id, accessoryChoice.id],
    layers: [
      { id: 'L04', name: accessoryChoice.label, removable: accessoryChoice.id !== 'none' },
      { id: 'L03', name: '外层装饰', removable: true },
      { id: 'L02', name: clothing.label, removable: true },
      { id: 'L01', name: '内搭层', removable: true },
      { id: 'L00', name: '完整遮蔽的基础服装', removable: false }
    ],
    finalBaseLayer: 'L00'
  };
  return {
    status: 'PLANNED',
    intent,
    identity,
    profileCard,
    wardrobeManifest,
    styleLock: LINXING_STYLE_LOCK,
    imagePrompt: `Create one original character reference board for a Chinese card-game companion. Adult fictional person only, clearly age 25+, ${styleBrief}. Character: ${intent.sourceText}. Clothing selection: ${clothing.prompt}. Accessory selection: ${accessoryChoice.prompt}. The board combines multiple clearly separated panels for one consistent character: a full-body identity hero, a head-and-shoulders headshot, clothing and accessory detail panels, and five action references (idle, play card, pass, win, lose). It is produced for human confirmation and downstream production reference only — never a runtime standee, avatar or display asset; every runtime slot is produced as its own separate file. Keep panels separate with clean gutters and one consistent identity across every panel. ${LINXING_STYLE_LOCK} ${PAL_IDENTITY_SEPARATION_LOCK} Fully clothed and tasteful; no real person, no celebrity likeness, no child or teen appearance, no school uniform, no nudity or revealing clothing, no readable text, no watermark, no logo.`
  };
}

const AIHUB_GPT_IMAGE2_ROUTE = { id: 'aihub-gpt-image2', label: 'AIHub · GPT Image 2（角色资料卡）', api: 'AIHub Workflow Agent run/status/outputs', tokenEnv: 'AIHUB_AGENT_TOKEN', appIdSource: 'aihub-asset-production:gpt-image2', alias: 'gpt-image2', model: 'gpt-image2' };
const AIHUB_JIMENG_ROUTE = { id: 'aihub-jimeng', label: 'AIHub · 即梦 5.0（其他图片）', api: 'AIHub Workflow Agent run/status/outputs', tokenEnv: 'AIHUB_AGENT_TOKEN', appIdSource: 'aihub-asset-production:jimeng', alias: 'jimeng', model: 'jimeng' };
const AIHUB_SEEDANCE_ROUTE = { id: 'aihub-seedance', label: 'AIHub · Seedance 2.0（其他视频）', api: 'AIHub Workflow Agent run/status/outputs', tokenEnv: 'AIHUB_AGENT_TOKEN', appIdSource: 'aihub-asset-production:seedance', alias: 'seedance', model: 'seedance' };
/* 用户指定的跳舞视频工作流在生产侧以受控 alias 配置，不把工作流 UUID 写入游戏任务、
   浏览器或日志；该 alias 应在 AIHub 素材生产中心的 appId 注册表中解析。 */
const AIHUB_DANCE_ROUTE = { id: 'aihub-dance', label: 'AIHub 跳舞视频工作流', alias: 'dressbattle-dance', tokenEnv: 'AIHUB_AGENT_TOKEN' };
const task = (id, group, label, kind, requiredForSeat, production, acceptance, route) => ({ id, group, label, kind, requiredForSeat, production, acceptance, route, mapping: RESOURCE_SLOTS[id] || null, status: 'PLANNED' });

/* 存量计划迁移：在新版独立五态图上线前创建的计划，不能继续把 3×2 Sprite
   当作运行时资源。迁移只扩展缺失槽位、降低旧汇总图为预览，并保留原 planId、身份
   和已完成任务；新槽位会在用户点击继续生产时按当前提示词和引用关系提交。 */
export function upgradePalResourcePlan(plan) {
  if (!plan || !Array.isArray(plan.resources)) return plan;
  const resources = plan.resources.map((resource) => ({ ...resource }));
  let changed = false;
  const contractUpdates = {
    'table-standee': { label: '牌桌半身立绘（3:4 透明）', acceptance: '独立透明 PNG；不带桌面、房间、底板或背景，右/上座不遮挡牌与叫分信息' },
    'lounge-standee': { label: '大厅主视觉半身立绘（透明）', acceptance: '独立透明 PNG；半身、无桌面/房间/底板，首页构图与牌桌身份一致' },
    'entry-film': { label: '入场视频（16:9）', acceptance: '单人连续入席，浏览器可解码；不是头像、立绘或动作条' },
    'outfit-film': { label: '首套跳舞换装演出视频', acceptance: '8 秒连续跳舞中自然脱去外层；全程角色、服装与资料卡一致，人工目检后才可应用' }
  };
  for (const resource of resources) {
    const update = contractUpdates[resource.id];
    if (update && (resource.label !== update.label || resource.acceptance !== update.acceptance)) { Object.assign(resource, update); changed = true; }
    if (/^action-a0[1-5]$/.test(resource.id)) {
      const label = `${resource.id.toUpperCase()} ${resource.id === 'action-a01' ? '待机' : resource.id === 'action-a02' ? '出牌' : resource.id === 'action-a03' ? '不出' : resource.id === 'action-a04' ? '胜利' : '失败'}透明 WebM（3:4）`;
      const acceptance = '纯绿幕源经确定性抠像为 VP9 alpha WebM；通过黑、白、洋红背景预览后再应用';
      if (resource.label !== label || resource.acceptance !== acceptance) { resource.label = label; resource.acceptance = acceptance; changed = true; }
    }
  }
  const legacySheet = resources.find((resource) => resource.id === 'action-sheet');
  if (legacySheet && legacySheet.requiredForSeat !== false) {
    legacySheet.requiredForSeat = false;
    legacySheet.label = '五态动作 Sprite 图（旧版汇总预览）';
    legacySheet.acceptance = '仅用于工坊预览，不进入运行时槽位';
    changed = true;
  }
  const actionDefinitions = [
    ['A01', '待机', 'one single idle action pose, half-body, true-alpha transparent background, fixed 4:5 anchor, no collage'],
    ['A02', '出牌', 'one single play-card action pose, half-body, true-alpha transparent background, fixed 4:5 anchor, no collage'],
    ['A03', '不出', 'one single pass action pose, half-body, true-alpha transparent background, fixed 4:5 anchor, no collage'],
    ['A04', '胜利', 'one single restrained victory action pose, half-body, true-alpha transparent background, fixed 4:5 anchor, no collage'],
    ['A05', '失败', 'one single composed defeat action pose, half-body, true-alpha transparent background, fixed 4:5 anchor, no collage']
  ];
  for (const [key, label] of actionDefinitions) {
    const id = `action-image-${key}`;
    if (resources.some((resource) => resource.id === id)) continue;
    resources.push(task(id, '角色表现', `A${key.slice(-2)} ${label}动作图（透明）`, 'image', true, 'aihub:jimeng', '单人、透明、动作锚点统一', AIHUB_JIMENG_ROUTE));
    changed = true;
  }
  const poster = resources.find((resource) => resource.id === 'outfit-poster');
  if (poster && poster.production !== 'deterministic:video-poster') {
    poster.production = 'deterministic:video-poster';
    poster.label = '写真视频首帧 Poster（视频抽帧）';
    poster.acceptance = '从已验收换装演出视频抽帧，3:4/4:7 构图正确';
    poster.route = { id: 'deterministic-video-poster', label: '确定性抽帧 · 换装演出视频首帧' };
    changed = true;
  }
  if (!changed) return plan;
  const counts = resources.reduce((sum, resource) => ({ ...sum, [resource.kind]: (sum[resource.kind] || 0) + 1 }), {});
  return { ...plan, packageTier: 'launch', packageLabel: PAL_PACKAGE_TIERS.launch.label, resources, counts, nextStep: '审核角色资料卡后提交首张资料卡；确认前不会生产下游图片和视频。' };
}

/* 资源计划与 Provider 调用分开：计划可以先被查看、审核和追踪；真正的图像/视频任务只在
   对应 Provider 已配置、且有稳定消费槽时才提交。角色级动作不随 outfit 复制，套装级只增加
   卡面、特效和舞台演出。 */
export function createPalResourcePlan({ prompt, version = 1, packageTier = 'launch', name = '', clothingStyle = 'described', accessory = 'none' }) {
  const base = createProductionPlan({ prompt, version, name, clothingStyle, accessory });
  if (base.status !== 'PLANNED') return base;
  // 资料包统一按完整首发包生产；保留 packageTier 入参只是为了兼容旧客户端/存量任务。
  // 新建计划不再允许 MVP 静态包绕过动作、入场和换装演出资源。
  const tier = PAL_PACKAGE_TIERS.launch;
  const resources = [
    task('master-portrait', '角色形象', '角色资料卡（生产参考总图）', 'image', true, 'aihub:gpt-image2', '确认角色、服装、配饰和动作；整图不进入玩家展示槽位', AIHUB_GPT_IMAGE2_ROUTE),
    task('avatar', '角色形象', '头像 / 头肩像（1:1）', 'image', true, 'aihub:jimeng', '单人头肩构图，适合首页与选座头像', AIHUB_JIMENG_ROUTE),
    task('table-standee', '角色形象', '牌桌半身立绘（3:4 透明）', 'image', true, 'aihub:jimeng', '独立透明 PNG；不带桌面、房间、底板或背景，右/上座不遮挡牌与叫分信息', AIHUB_JIMENG_ROUTE),
    task('first-outfit', '首套服装', '首套服装写真卡面（3:4）', 'image', true, 'aihub:jimeng', '可用于 outfit layer 与写真卡', AIHUB_JIMENG_ROUTE),
    task('action-sheet', '角色表现', '五态动作 Sprite 图（旧版汇总预览）', 'image', false, 'aihub:jimeng', '仅用于工坊预览，不进入运行时槽位', AIHUB_JIMENG_ROUTE),
    task('action-image-A01', '角色表现', 'A01 待机动作图（透明）', 'image', true, 'aihub:jimeng', '单人、透明、动作锚点统一', AIHUB_JIMENG_ROUTE),
    task('action-image-A02', '角色表现', 'A02 出牌动作图（透明）', 'image', true, 'aihub:jimeng', '单人、透明、动作锚点统一', AIHUB_JIMENG_ROUTE),
    task('action-image-A03', '角色表现', 'A03 不出动作图（透明）', 'image', true, 'aihub:jimeng', '单人、透明、动作锚点统一', AIHUB_JIMENG_ROUTE),
    task('action-image-A04', '角色表现', 'A04 胜利动作图（透明）', 'image', true, 'aihub:jimeng', '单人、透明、动作锚点统一', AIHUB_JIMENG_ROUTE),
    task('action-image-A05', '角色表现', 'A05 失败动作图（透明）', 'image', true, 'aihub:jimeng', '单人、透明、动作锚点统一', AIHUB_JIMENG_ROUTE),
    task('dialogue-pack', '角色表现', '五态台词包（idle/play/pass/win/lose）', 'text', true, 'rule-plus-llm', '五态各至少 3 条，口吻与角色一致', { id: 'dialogue-policy', label: '角色台词策略器' }),
    task('audit-record', '审核与合同', '身份、来源、hash 与 PalAsset Contract', 'record', true, 'deterministic', 'audit、成年虚构与所有引用通过校验', { id: 'contract-audit', label: '本地合同审核' })
  ];
  if (tier.id === 'launch') resources.push(
    task('lounge-standee', '角色形象', '大厅主视觉半身立绘（透明）', 'image', true, 'aihub:jimeng', '独立透明 PNG；半身、无桌面/房间/底板，首页构图与牌桌身份一致', AIHUB_JIMENG_ROUTE),
    task('outfit-fx', '首套服装', '服装特效层（透明 PNG）', 'image', false, 'aihub:jimeng', '不遮挡脸、牌或文字', AIHUB_JIMENG_ROUTE),
    task('entry-film', '角色表现', '入场视频（16:9）', 'video', true, 'aihub:seedance', '单人连续入席，浏览器可解码；不是头像、立绘或动作条', AIHUB_SEEDANCE_ROUTE),
    task('action-a01', '角色表现', 'A01 待机透明 WebM（3:4）', 'video', true, 'aihub:seedance', '纯绿幕源经确定性抠像为 VP9 alpha WebM；待机事件绑定', AIHUB_SEEDANCE_ROUTE),
    task('action-a02', '角色表现', 'A02 出牌透明 WebM（3:4）', 'video', true, 'aihub:seedance', '纯绿幕源经确定性抠像为 VP9 alpha WebM；出牌事件绑定', AIHUB_SEEDANCE_ROUTE),
    task('action-a03', '角色表现', 'A03 不出透明 WebM（3:4）', 'video', true, 'aihub:seedance', '纯绿幕源经确定性抠像为 VP9 alpha WebM；过牌事件绑定', AIHUB_SEEDANCE_ROUTE),
    task('action-a04', '角色表现', 'A04 胜利透明 WebM（3:4）', 'video', true, 'aihub:seedance', '纯绿幕源经确定性抠像为 VP9 alpha WebM；胜利事件绑定', AIHUB_SEEDANCE_ROUTE),
    task('action-a05', '角色表现', 'A05 失败透明 WebM（3:4）', 'video', true, 'aihub:seedance', '纯绿幕源经确定性抠像为 VP9 alpha WebM；失败事件绑定', AIHUB_SEEDANCE_ROUTE),
    task('outfit-film', '首套服装', '首套跳舞换装演出视频', 'video', true, 'aihub:dressbattle-dance', '8 秒连续跳舞中自然脱去外层；全程角色、服装与资料卡一致，人工目检后才可应用', AIHUB_DANCE_ROUTE),
    task('outfit-poster', '首套服装', '写真视频首帧 Poster（视频抽帧）', 'image', true, 'deterministic:video-poster', '从已验收换装演出视频抽帧，3:4/4:7 构图正确', { id: 'deterministic-video-poster', label: '确定性抽帧 · 换装演出视频首帧' })
  );
  const counts = resources.reduce((sum, resource) => ({ ...sum, [resource.kind]: (sum[resource.kind] || 0) + 1 }), {});
  return {
    ...base,
    packageTier: tier.id,
    packageLabel: tier.label,
    seatGate: tier.seatGate,
    packageSummary: tier.summary,
    resources,
    productionRoutes: [AIHUB_GPT_IMAGE2_ROUTE, AIHUB_JIMENG_ROUTE, AIHUB_SEEDANCE_ROUTE, AIHUB_DANCE_ROUTE],
    counts,
    nextStep: '审核角色资料卡后提交首张资料卡；确认前不会生产下游图片和视频。'
  };
}

export function createProductionCandidate({ plan, imageRef = null, resourceRefs = {}, resourceMeta = {}, providerRecord = {} }) {
  if (!plan || plan.status !== 'PLANNED') throw new Error('Production candidate requires an approved production plan.');
  const ref = (id) => resourceRefs[id] || null;
  const masterRef = resourceRefs['master-portrait'] || imageRef;
  if (typeof masterRef !== 'string' || !masterRef.startsWith('/assets/pals/ugc/')) throw new Error('Production candidate requires a managed master portrait reference.');
  const requiredAssetIds = (plan.resources || []).filter((resource) => resource.requiredForSeat && ['image', 'video'].includes(resource.kind)).map((resource) => resource.id);
  const isRich = requiredAssetIds.every((id) => Boolean(resourceRefs[id]));
  const outfitFilm = ref('outfit-film');
  const outfitPoster = outfitFilm ? ref('outfit-poster') : null;
  const actionVideoRefs = Object.fromEntries(['A01', 'A02', 'A03', 'A04', 'A05'].map((key) => [key, ref(`action-a0${Number(key.slice(-1))}`)]));
  const actionMeta = Object.fromEntries(['A01', 'A02', 'A03', 'A04', 'A05'].map((key) => [key, resourceMeta[`action-a0${Number(key.slice(-1))}`] || {}]));
  const runtimeActions = actionPack(null, actionVideoRefs, actionMeta);
  for (const key of Object.keys(runtimeActions)) runtimeActions[key].imageRef = ref(`action-image-${key}`);
  const { suffix, accent, style, version } = plan.identity;
  const selectedClothing = plan.profileCard?.clothing?.label || `${style}套装`;
  const selectedAccessory = plan.profileCard?.accessory?.label || '无';
  const outfitLabel = selectedAccessory === '无' ? selectedClothing : `${selectedClothing} · ${selectedAccessory}`;
  const palId = `pal-user-${suffix}-v${version}`;
  const auditRecordId = `audit-production-${suffix}-v${version}`;
  const asset = validatePalAsset({
    contractVersion: CONTRACT_VERSION,
    palId,
    version,
    readiness: isRich ? 'READY' : 'DEGRADED_READY',
    auditRecordId,
    profileCard: plan.profileCard || null,
    identity: { name: plan.identity.name || derivePalName(plan.intent?.sourceText, suffix), fictional: true, adultAppearance: true, aiLabel: 'AI 虚构角色（真实图像产物）' },
    appearance: {
      accent, outfit: outfitLabel, dance: '预设节拍', portraitRef: masterRef, referenceCardRef: masterRef,
      avatarRef: ref('avatar'), standeeRef: ref('lounge-standee'), tableStandeeRef: ref('table-standee'), loungeStandeeRef: ref('lounge-standee'),
      actionSheetRef: ref('action-sheet'), entryVideoRef: ref('entry-film'),
      /* 入场片是产品规定的横版 16:9。资源管线在落盘时已拒绝其他比例，因此
         运行时始终使用横屏镜头，不得把竖版写真片伪装成入场。 */
      entryVideoFit: 'landscape',
      danceVideoRef: outfitFilm, dancePosterRef: outfitPoster,
      layers: { base: masterRef, outfit: ref('first-outfit') || masterRef, effect: ref('outfit-fx') },
      outfitLibrary: [{ outfitId: 'starter-look', name: outfitLabel, dance: '预设节拍', auditRecordId, layerSnapshot: { base: masterRef, outfit: ref('first-outfit') || masterRef, effect: ref('outfit-fx'), cardVideo: outfitFilm, cardPoster: outfitPoster } }]
    },
    actionPack: runtimeActions,
    dialoguePack: dialogueSets[style],
    performance: { mainTrack: isRich ? ref('outfit-film') : null, fallbackTrack: 'preset://production/dance-skeletal' },
    fallback: { actionLevel: 'L2', reason: isRich ? '完整资源包已通过落盘规格门禁，牌桌使用角色五态视频与套装演出。' : '角色资料卡已生成；完整首发包仍在等待专用头像、牌桌/大厅立绘、动作、入场与换装演出资源。' }
  });
  return {
    status: 'READY', intent: plan.intent, profileCard: plan.profileCard || null, asset,
    package: { tier: 'launch', seatGate: 'RICH_ASSETS_READY', state: isRich ? 'RICH_ASSETS_READY' : 'ASSET_PENDING', resources: plan.resources || [] },
    provider: { name: providerRecord.name || 'configured image provider', model: providerRecord.model || 'unknown', requestId: providerRecord.requestId || null },
    trace: ['PalIntent', 'route-locked production tasks', 'binary asset write', 'policy audit', isRich ? 'rich asset package promoted' : 'L2 action fallback']
  };
}

// Retained only for legacy fixtures. Production API paths never call this function.
export function createMockCandidate({ prompt, version = 1 }) {
  const plan = createProductionPlan({ prompt, version });
  if (plan.status === 'BLOCKED') return plan;
  const { suffix, accent, style } = plan.identity;
  const asset = validatePalAsset({
    contractVersion: CONTRACT_VERSION, palId: `pal-user-${suffix}-v${version}`, version, readiness: 'DEGRADED_READY',
    auditRecordId: `audit-mock-${suffix}-v${version}`,
    identity: { name: plan.identity.name || derivePalName(plan.intent?.sourceText, suffix), fictional: true, adultAppearance: true, aiLabel: 'AI 虚构角色（Mock 预设）' },
    appearance: { accent, outfit: `${style}套装`, dance: '预设节拍', portraitRef: 'preset://mock/portrait', actionSheetRef: 'preset://mock/actions' },
    actionPack: actionPack('preset://mock/actions'), dialoguePack: dialogueSets[style],
    performance: { mainTrack: null, fallbackTrack: 'preset://mock/dance-skeletal' }, fallback: { actionLevel: 'L2', reason: '真实 Provider 未配置，已应用已审预设资产。' }
  });
  return { status: 'DEGRADED_READY', intent: plan.intent, asset, trace: ['PalIntent', 'mock portrait', 'policy audit', 'preset action pack', 'fallback performance'] };
}
