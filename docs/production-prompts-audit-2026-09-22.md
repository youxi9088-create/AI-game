# 当前生产提示词提取与审查

提取日期：2026-09-22。来源：当前工作区源码，不代表历史任务当时发送的完整请求。未触发生产，未修改生产逻辑。

## 主要问题

1. 公共风格包含 casino lighting、shallow depth of field、soft bokeh，会把场景背景带入透明立绘和动作视频。应保留人物材质与色调，按节点分开背景约束。
2. 下游重复追加 Create a clearly original person / never reuse an existing pal face，与 preserve exact identity 冲突。原创身份约束只用于首次建角色，下游锁定已确认身份。
3. 头像、立绘、特效等全部注入 Role profile actions 五种动作，扩大了无关输出范围。仅动作图节点注入完整动作集合。
4. 五态视频输入仍为完整资料卡，缺少固定镜头、半身取景、纯色背景、动作起止姿态、主体安全边距与循环约束；当前没有逐帧去背景与透明 WebM 编码节点。
5. 资料卡仍进入强制 alpha 检测和抠图，与参考总图用途不符。
6. 五态源图声明 3×2，但未明确每格相同镜头、位置、比例与不得跨格。下游平均切分不能保证内容完整。
7. outfit-fx 同时要求 effect only 和全局角色身份/服装/五态动作，可能产生人物。应仅给特效语义和透明构图。
8. 当前源码已经把 `outfit-poster` 改为从视频抽帧的确定性节点；本审计中保留该条作为回归门禁，不能再退回独立生图。
9. first-outfit 已修正为读用户服装与配饰，没有继续写死酒红披肩；此处保留。
10. 计划层 imagePrompt 和请求层 promptFor 是两份资料卡模板，应统一，避免预览与实发不一致。
11. `promptPatch` 目前只写入任务字段，没有在 `promptFor`、`danceInputs`、`seedanceInputs` 中统一追加到最终请求；人工修改因此可能“看起来保存了但没有真正生效”。
12. 下游任务仍复用 `PAL_IDENTITY_SEPARATION_LOCK` 中的“创建全新人物/不能复用已有脸”，与资料卡确认后的身份锁定相冲突。
13. `danceInputs` 的 `outfit-film` 当前只写“short fashion dance and turn”，没有要求“持续跳舞并自然逐件脱去外层服装”，也没有按服装层数量计算时长。
14. `master-portrait` 仍出现在 `ALPHA_IMAGE_RESOURCES`，会被当作透明资源校验；资料卡应从 alpha/抠图门禁中排除。
15. `seedanceInputs` 当前把所有动作视频都以角色资料卡作为参考；重构后应使用对应动作单图，入场视频使用独立入场参考。

## 引用关系

除 outfit-film/outfit-poster 引用 first-outfit 外，其余下游图像和视频引用 master-portrait。抠图引用各生成节点输出原图。台词是本地预设数组，审核为确定性逻辑，无模型提示词。

## 实际请求模板（原样提取）

变量由角色计划、选择的服装/配饰和任务版本在发送时展开。promptFor 内 first-outfit 分支提前返回，其 role 字典中的同名条目不会执行。

```javascript
function promptFor(plan, resource, task = null) {
  const brief = task?.promptRevision === 'safety-safe-v2'
    ? 'a clearly 25+ professional fictional game companion with fully covered elegant wardrobe'
    : plan.intent.sourceText;
  if (resource.id === 'master-portrait') return `Create a character reference board for one original adult fictional game companion. Character: ${brief}. Clothing: ${plan.profileCard?.clothing?.prompt || ''}. Accessories: ${plan.profileCard?.accessory?.prompt || ''}. Include a full-body identity reference, headshot, clothing and accessory details, and clearly separated action references for idle, play, pass, win and lose. This board is for human confirmation and downstream production, never a runtime standee. Keep panels separate and identity consistent. ${plan.styleLock || LINXING_STYLE_LOCK} ${PAL_IDENTITY_SEPARATION_LOCK}`;
  if (resource.id === 'first-outfit') {
    /* 服装必须来自计划（profileCard 的服装与配饰选择），与角色资料卡一致；
       不再使用历史上写死的「黑色高领晚装夹克裙+酒红披肩」通用模板。 */
    const outfitProfile = plan.profileCard || {};
    const outfitClothing = outfitProfile.clothing?.prompt || plan.intent?.clothingLabel || 'the clothing described in the brief';
    const outfitAccessory = outfitProfile.accessory?.prompt || plan.intent?.accessoryLabel || 'no novelty accessory';
    return `Create an original 3:4 vertical fashion portrait for the fictional Chinese card-game companion described here: ${brief}. Show a fully clothed full figure with comfortable space above her head and below the garment hem. Wardrobe: ${outfitClothing}. Accessories: ${outfitAccessory}. The outfit must match the character's confirmed role profile card exactly — same garments, colors, materials and accessories; opaque quality fabrics and elegant clean tailoring. Use a calm, self-possessed catalogue pose; focus on her face, silhouette, garment construction and textile detail. Match this game's established art direction: ${plan.styleLock || LINXING_STYLE_LOCK} ${PAL_IDENTITY_SEPARATION_LOCK} Keep one consistent fictional character identity. Original illustration only; never draw a checkerboard, white matte, gray matte or placeholder grid. No lettering, brand marks or watermark.`;
  }
  const role = {
    avatar: '1:1 head-and-shoulders character avatar, exactly one person, face readable at small size, no collage or multiple poses, no checkerboard or matte',
    'table-standee': '3:4 true-alpha transparent-background half-body seated card-table standee, exactly one character, leave hands and card area unobstructed, never draw a checkerboard or matte',
    'lounge-standee': 'one single half-body vertical lobby hero standee, clean silhouette and breathing space for title copy, true alpha transparency, never draw a checkerboard or matte; do not make a sprite sheet, collage, contact sheet, action strip, full-body lineup, or multiple poses',
    'first-outfit': '3:4 original first-outfit photo-card illustration, full figure, clear costume layers, no checkerboard or white matte background',
    'action-sheet': '3 by 2 game sprite sheet with exactly five readable poses: idle, play card, pass, win, lose; true-alpha transparent background, no checkerboard',
    'outfit-fx': 'true-alpha transparent PNG costume effect layer only, no face, no text, no cards, no checkerboard',
    'outfit-poster': 'portrait video-poster still for a card game photo collection, 3:4 composition, no text'
  }[resource.id] || resource.label;
  const profile = plan.profileCard || {};
  const clothing = profile.clothing?.prompt || plan.intent?.clothingLabel || 'the clothing described in the brief';
  const accessory = profile.accessory?.prompt || plan.intent?.accessoryLabel || 'no novelty accessory';
  const actions = profile.actions ? Object.values(profile.actions).join('; ') : 'idle, play card, pass, win and lose';
  const alphaContract = ALPHA_IMAGE_RESOURCES.has(resource.id)
    ? 'ALPHA OUTPUT CONTRACT: return a PNG with decoded per-pixel alpha (RGBA or grayscale+alpha), with genuinely transparent pixels around the subject and visible subject pixels; never fake transparency with a white, gray, black or checkerboard matte; do not return JPEG or an opaque RGB PNG.'
    : '';
  const compositionLock = resource.id === 'lounge-standee'
    ? 'LOBBY COMPOSITION LOCK: output exactly one character only, cropped from mid-torso upward, centered with empty negative space around the silhouette for the lobby title. Do not reproduce the reference profile-card layout or its five-action strip.'
    : resource.id === 'action-sheet'
      ? 'SPRITE COMPOSITION LOCK: output one 3-column by 2-row sheet, exactly five distinct poses in fixed cells (idle, play, pass, win, lose) and one empty cell; no captions, no borders, no extra character.'
      : resource.id === 'avatar'
        ? 'AVATAR COMPOSITION LOCK: exactly one head-and-shoulders portrait, centered, face and hair fully inside the frame, no full-body figure, no action strip and no extra person.'
        : resource.id === 'table-standee'
          ? 'TABLE COMPOSITION LOCK: exactly one half-body seated character, centered, no poster typography, no extra poses, no collage and no scene lineup.'
      : '';
  return `Original game asset for a clearly 25+ professional fictional Chinese 斗地主 game companion. ${role}. Character brief: ${brief}. Outfit/personality variation: ${plan.intent.style}. Selected clothing: ${clothing}. Selected accessory: ${accessory}. Role profile actions: ${actions}. ${compositionLock} ${alphaContract} ${plan.styleLock || LINXING_STYLE_LOCK} ${PAL_IDENTITY_SEPARATION_LOCK} Preserve one consistent new character identity across this package, fully clothed and tasteful, no real person, no celebrity likeness, no school-age appearance, no logo, no watermark, no readable text.`;
}
function danceInputs(plan, resource, env, referenceUrl) {
  const templateText = String(env.PAL_DANCE_INPUTS_JSON || '{}').trim();
  let template;
  try { template = JSON.parse(templateText); } catch { throw new Error('PAL_DANCE_INPUTS_JSON 必须是 JSON 对象。'); }
  if (!template || Array.isArray(template) || typeof template !== 'object') throw new Error('PAL_DANCE_INPUTS_JSON 必须是 JSON 对象。');
  const promptField = String(env.PAL_DANCE_PROMPT_FIELD || 'prompt').trim();
  const referenceField = String(env.PAL_DANCE_REFERENCE_FIELD || 'image_url').trim();
  const videoReferenceField = String(env.PAL_DANCE_VIDEO_FIELD || 'video_url').trim();
  const referenceLabel = resource.id === 'outfit-film' ? '首套服装写真卡面' : '角色资料卡';
  if (!isUrl(referenceUrl)) throw new Error(`跳舞视频缺少可由 AIHub 访问的${referenceLabel} image_url。`);
  const videoReferenceUrl = String(plan.danceReferenceVideoUrl || DEFAULT_DANCE_REFERENCE_VIDEO_URL).trim();
  if (!isUrl(videoReferenceUrl)) throw new Error('跳舞视频参考 video_url 必须是 HTTPS 公网地址。');
  const action = { 'entry-film': 'gentle entrance and greeting at the card table', 'action-a01': 'idle breathing loop', 'action-a02': 'play one card towards table', 'action-a03': 'graceful pass gesture', 'action-a04': 'restrained victory celebration', 'action-a05': 'disappointed but composed defeat reaction', 'outfit-film': 'short fashion dance and turn for the unlocked outfit' }[resource.id] || resource.label;
  const consistencyLock = resource.id === 'outfit-film'
    ? 'CHARACTER AND OUTFIT CONSISTENCY LOCK: image_url is the approved first-outfit card. Preserve the exact same fictional character identity, face, hairstyle, body proportions, costume silhouette, colors, materials and accessories from that image throughout the video; do not redesign, replace or omit any outfit element.'
    : 'CHARACTER CONSISTENCY LOCK: Preserve the exact same fictional character identity, face, hairstyle, body proportions and visual treatment from image_url throughout the video.';
  const videoReferenceLock = 'VIDEO REFERENCE LOCK: video_url controls only dance rhythm, camera language and movement texture. It must not replace the character, outfit, art direction or setting defined by image_url.';
  const profile = plan.profileCard || {};
  const profileDetails = `ROLE PROFILE CARD: character=${profile.character?.name || plan.identity?.name || 'new companion'}; clothing=${profile.clothing?.label || plan.intent?.clothingLabel || 'brief-defined'}; accessory=${profile.accessory?.label || plan.intent?.accessoryLabel || 'none'}; action set=${profile.actions ? Object.values(profile.actions).join(', ') : 'idle/play/pass/win/lose'}.`;
  return {
    ...template,
    duration: String(env.PAL_DANCE_DURATION || '5'),
    [promptField]: `Adult fictional Chinese game companion. ${action}. Character brief: ${plan.intent.sourceText}. ${plan.intent.style} outfit/personality variation. ${profileDetails} ${consistencyLock} ${videoReferenceLock} ${plan.styleLock || LINXING_STYLE_LOCK} ${PAL_IDENTITY_SEPARATION_LOCK} One person only, non-sexualized elegant styling, no real-person likeness, no watermark, no text.`,
    [referenceField]: referenceUrl,
    [videoReferenceField]: videoReferenceUrl
  };
}
function seedanceInputs(plan, resource, referenceUrl) {
  if (!isUrl(referenceUrl)) throw new Error('Seedance 视频缺少可由 AIHub 访问的角色资料卡 image_url。');
  const action = {
    'entry-film': 'gentle entrance and greeting at the card table',
    'action-a01': 'a subtle idle breathing loop with natural blinking',
    'action-a02': 'a clear card-playing gesture toward the table',
    'action-a03': 'a restrained pass gesture with a calm expression',
    'action-a04': 'a controlled victory reaction after winning the round',
    'action-a05': 'a composed defeat reaction after losing the round'
  }[resource.id] || resource.label;
  const profile = plan.profileCard || {};
  const profileDetails = `ROLE PROFILE CARD: character=${profile.character?.name || plan.identity?.name || 'new companion'}; clothing=${profile.clothing?.label || plan.intent?.clothingLabel || 'brief-defined'}; accessory=${profile.accessory?.label || plan.intent?.accessoryLabel || 'none'}; action set=${profile.actions ? Object.values(profile.actions).join(', ') : 'idle/play/pass/win/lose'}.`;
  const prompt = `Adult fictional Chinese card-game companion. ${action}. Character brief: ${plan.intent.sourceText}. ${plan.intent.style} visual direction. ${profileDetails} IMAGE REFERENCE LOCK: preserve the exact same fictional character identity, face, hairstyle, body proportions, clothing silhouette, colors, materials and accessories from image_url_list; do not redesign the character. ${plan.styleLock || LINXING_STYLE_LOCK} ${PAL_IDENTITY_SEPARATION_LOCK} One person only, fully clothed, non-sexualized, no real-person likeness, no watermark, no text.`;
  /* 入场视频是横版 16:9（开局入席演出，与正式入场片格式一致）；
     五态动作才是竖屏 3:4（牌桌半身镜头）。 */
  const portraitVideo = new Set(['action-a01', 'action-a02', 'action-a03', 'action-a04', 'action-a05']).has(resource.id);
  const videoSpec = portraitVideo ? '竖屏 3:4' : resource.id === 'entry-film' ? '横屏 16:9' : '自动 adaptive';
  return {
    prompt,
    Production_method: '全能参考',
    Video_specifications: videoSpec,
    duration: '4',
    resolution: '1080p',
    is_3d_digital_human: '否',
    image_url_list: referenceUrl,
    video_url_list: '',
    audio_url_list: ''
  };
}

```

## 公共风格、身份约束、服装、配饰及台词

```javascript
export const LINXING_STYLE_LOCK = 'Match the current Linxing visual direction, not her identity: high-end semi-realistic cinematic game CG with natural skin, hair and fabric materials; premium adult fashion-editorial finish; low-key midnight casino lighting; deep midnight navy and violet color grade with restrained champagne-gold practical lights and rim light; shallow depth of field and soft bokeh; clean readable silhouette; consistent camera language, facial rendering and body proportions across every asset; no cel shading, no thick anime outlines, no chibi proportions, no flat posterized colors.';
export const PAL_IDENTITY_SEPARATION_LOCK = 'Create a clearly original person who cannot be mistaken for Linxing, Yinlan, or any existing roster character. Reference Linxing for rendering, materials, lighting and camera language only; never reuse an existing pal face, hairstyle, hair color, eye design, signature pose, prop, outfit silhouette or costume identity. The new character brief is the only source for identity and costume.';
export const DEFAULT_DANCE_REFERENCE_VIDEO_URL = 'https://gcdncs.cn.ndhy.com/v0.1/download?dentryId=b536385d-9707-4001-b700-cca86ea21791&attachment=true';
const dialogueSets = {
  '复古优雅': { idle: ['旧时光不催人。'], play: ['这一手，像旧唱片的回旋。'], pass: ['我留一个休止符。'], win: ['优雅地落幕。'], lose: ['下一支舞再赢回来。'] },
  '运动明快': { idle: ['热身完毕。'], play: ['快攻，接住！'], pass: ['喘口气，先跳过。'], win: ['漂亮，全场沸腾！'], lose: ['擦擦汗，再来一局。'] },
  '暗夜摩登': { idle: ['夜色是我的底牌。'], play: ['霓虹一闪，牌已落定。'], pass: ['这轮让给灯光。'], win: ['今夜属于我。'], lose: ['夜还长，不急。'] },
  '舞台轻奢': { idle: ['聚光灯已就位。'], play: ['这一手交给我。'], pass: ['先观察一下。'], win: ['节奏不错。'], lose: ['下一轮继续。'] }
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

```

## 计划层资料卡模板（不等于资源流水线实际发送模板）

```javascript
    imagePrompt: `Create one original character reference board for a Chinese card-game companion. Adult fictional person only, clearly age 25+, ${styleBrief}. Character: ${intent.sourceText}. Clothing selection: ${clothing.prompt}. Accessory selection: ${accessoryChoice.prompt}. The board combines multiple clearly separated panels for one consistent character: a full-body identity hero, a head-and-shoulders headshot, clothing and accessory detail panels, and five action references (idle, play card, pass, win, lose). It is produced for human confirmation and downstream production reference only — never a runtime standee, avatar or display asset; every runtime slot is produced as its own separate file. Keep panels separate with clean gutters and one consistent identity across every panel. ${LINXING_STYLE_LOCK} ${PAL_IDENTITY_SEPARATION_LOCK} Fully clothed and tasteful; no real person, no celebrity likeness, no child or teen appearance, no school uniform, no nudity or revealing clothing, no readable text, no watermark, no logo.`
```
