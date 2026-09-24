# Asset licenses and provenance

## 官方牌友肖像样本（阶段二）

| 资源 | 用途 | 来源与版本 | 约束 |
| --- | --- | --- | --- |
| `apps/web/assets/pals/linxing-v1.png` | 林星：大厅、牌桌、结算、写真卡 | 2026-09-08，Codex 内建 ImageGen，项目专用生成 | 成年虚构角色；全身着安全服装；无文字、无真人参考、无外部品牌。 |
| `apps/web/assets/pals/mia-v1.png` | 米娅：大厅、牌桌 | 2026-09-08，Codex 内建 ImageGen，项目专用生成 | 成年虚构角色；全身着安全服装；无文字、无真人参考、无外部品牌。 |
| `apps/web/assets/pals/linxing-actions-v1.png` | 林星 A01-A05：待机、出牌、过牌、胜利、失败 | 2026-09-08，Codex 内建 ImageGen，以项目内林星形象为参考生成 | 六格动作表；成年虚构角色；无文字、无真人参考、无外部品牌。 |
| `apps/web/assets/pals/mia-actions-v1.png` | 米娅 A01-A05：待机、出牌、过牌、胜利、失败 | 2026-09-08，Codex 内建 ImageGen，原创成年虚构职业舞台角色 | 六格动作表；深色舞台底；无文字、无真人参考、无外部品牌。 |
| `apps/web/assets/club-night-v2.png` | 大厅与牌桌的月夜会所场景底图 | 2026-09-08，Codex 内建 ImageGen，项目专用生成并二次移除筹码、硬币、扑克牌与饮品元素 | 无人物、无文字、无品牌；仅承载虚构的非交易型桌游会所氛围。 |
| `apps/web/assets/pals/video/linxing-*.webm` | 林星 A01–A05：待机、出牌、过牌、胜利、失败 | 用户提供：`角色五态包/linxing`，2026-09-08 直接拷贝接入 | 原始 VP9 WebM；MVP 按用户指示直接使用，不作抠像或转码。 |
| `apps/web/assets/pals/video/mia-A01-idle-v1.webm` | 米娅 A01 待机 | 用户提供：`角色五态包/mia`，2026-09-08 直接拷贝接入 | 原始 VP9 WebM；A02–A05 暂保留动作表回退。 |
| `apps/web/assets/pals/video/*-entry-v1.mp4` | 林星、米娅入局出场演出 | 用户提供：`角色五态包/*/*出场.mp4`，2026-09-08 直接拷贝接入 | 原始 H.264 MP4；仅在“进入今晚牌局”后播放，可跳过。 |

## 写真视频与第三位官方牌友「银岚」（阶段二·续）

| 资源 | 用途 | 来源与版本 | 约束 |
| --- | --- | --- | --- |
| `apps/web/assets/pals/yinlan-standee.png` | 银岚：大厅全身透明抠像立绘 | 2026-09-14，ImageGen 图生图，以 `linxing_dance02.mp4` 收尾帧为参考生成，再经 `scripts/prepare-pal-assets.mjs` 品红底色键 + 取最大连通域抠像 | 成年虚构角色；透明底；无文字、无真人参考、无外部品牌。抠像同时丢弃 5632 像素杂点与生成水印。 |
| `apps/web/assets/pals/yinlan-seat.png` | 银岚：牌桌 L2 半身透明抠像 | 同源，由 `prepare-pal-assets.mjs` 从全身抠像顶部取 4:5 构图 | 牌桌座位与林星/米娅同为半身镜头；不得用 CSS 放大全身图替代。 |
| `apps/web/assets/pals/yinlan-lounge.png` | 银岚：首页 L1 半身透明主视觉 | 2026-09-15，ImageGen 以银岚基础立绘与林星首页半身构图为参考生成；从无水印上半身品红底裁片经 `prepare-pal-assets.mjs` 色键抠像 | 成年虚构角色；仅首页 L1 主视觉使用，不替换 L2 牌桌半身或完整身立绘。水印所在的原始下半身未进入此裁片。 |
| `apps/web/assets/pals/yinlan-v1.png` | 银岚：座位肖像、回合特写、分层底图 | 同上，由抠像结果裁边后按 3:4 派生 | 同上。 |
| `apps/web/assets/pals/generated/yinlan-court-dusk.png` | 银岚立绘的**生成源**（品红底，未抠像） | 同上，原始生成产物，仅供复现与追溯，不参与运行时 | 含生成水印与品红背景，因此**不得**进入可见 Runtime。 |
| `apps/web/assets/pals/video/linxing-dance-v1.mp4` | 林星登台演出的整段竖屏舞蹈 | 用户提供：`~/Downloads/linxing_dance01.mp4`，2026-09-14 直接拷贝接入 | 原始 H.264 MP4，768×1344（4:7）；与林星基础形象（暗蓝花旗袍）一致。 |
| `apps/web/assets/pals/video/nova-dance-v1.mp4` | 银岚登台演出的整段竖屏舞蹈 | 用户提供：`~/Downloads/linxing_dance02.mp4`，2026-09-14 直接拷贝接入 | 原始 H.264 MP4，768×1344（4:7）；片中人物即银岚的立绘基准。 |
| `apps/web/assets/pals/outfits/{linxing-stage-film,yinlan-court-dusk}.jpg` | 对应录像的原始 4:7 整帧：`<video poster>` + 信箱式模糊填充底 | 由上述两个 MP4 经 `scripts/make-dance-assets.mjs` 取收尾帧（t≈10.01s）产出 | 画面全部来自视频本身，未生成任何新画面。 |
| `apps/web/assets/pals/outfits/{linxing-stage-film,yinlan-court-dusk}-frame.jpg` | 同一帧的 3:4 信箱式静帧：`layerSnapshot.outfit`（分层静帧与静态卡面） | 同上 | 与录像同构图；4:7 直接当 `outfit` 会被 `cover` 裁掉脚，故单独出一份 3:4。 |
| `apps/web/assets/pals/outfits/{linxing-stage-film,yinlan-court-dusk}-silhouette.jpg` | 未解锁卡面的剪影 | 同上，再经去色压暗 | 与其它牌友剪影同一套处理。 |
| `apps/web/assets/pals/video/linxing-cabaret-v1.mp4` | 林星「午夜酒馆」整段竖屏舞蹈 | 用户提供：`~/Downloads/linxing03.mp4`，2026-09-15 直接拷贝接入 | 原始 H.264 MP4，768×1344（4:7）；角色为林星，作为独立套系视频卡面与登台片。 |
| `apps/web/assets/pals/video/linxing-nocturne-v1.mp4` | 林星「黑缎夜曲」整段竖屏舞蹈 | 用户提供：`~/Downloads/linxing04.mp4`，2026-09-15 直接拷贝接入 | 原始 H.264 MP4，768×1344（4:7）；角色为林星，作为独立套系视频卡面与登台片。 |
| `apps/web/assets/pals/video/yinlan-golden-court-v1.mp4` | 银岚「金发球场」第二段竖屏舞蹈 | 用户提供：`~/Downloads/xx_dance02.mp4`，2026-09-15 按用户指定归入银岚第二套写真 | 原始 H.264 MP4，768×1344（4:7）；金发运动造型与原银发套系不同，运行时如实标作第二套「金发球场」。 |
| `apps/web/assets/pals/video/yinlan-entry-v1.mp4` | 银岚开局横版入场演出 | 2026-09-15，基于银岚月卡会所镜头生成 | 成年虚构角色；约 5 秒、16:9、静音；仅供开局入席，绝不替代或复用写真卡的 `nova-dance-v1.mp4`。 |
| `apps/web/assets/pals/outfits/{linxing-midnight-cabaret,linxing-velvet-nocturne,yinlan-golden-court}.jpg` | 三段新增录像的原始 4:7 整帧：`<video poster>` + 信箱式模糊填充底 | 由对应 MP4 经 `scripts/make-dance-assets.mjs` 取收尾帧（t≈10.01s）产出 | 画面全部来自视频本身，未生成任何新画面。 |
| `apps/web/assets/pals/outfits/{linxing-midnight-cabaret,linxing-velvet-nocturne,yinlan-golden-court}-frame.jpg` | 同一帧的 3:4 信箱式静帧：新增套系 `layerSnapshot.outfit` | 同上 | 与录像同构图；给静态卡面 / L2 分层定格使用。 |
| `apps/web/assets/pals/outfits/{linxing-midnight-cabaret,linxing-velvet-nocturne,yinlan-golden-court}-silhouette.jpg` | 三张新增未解锁卡面的剪影 | 同上，再经去色压暗 | 与其它牌友剪影同一套处理。 |
| `apps/web/assets/pals/{mia-sporty-standee,mia-mint-stage-standee,mia-executive-standee}.png` | 米娅三套舞片的服装参考透明立绘 | 2026-09-15，ImageGen 以项目内 `mia-standee.png` 为角色参考分别生成，再经 `prepare-pal-assets.mjs` 对品红背景色键抠像 | 成年虚构角色；仅作为生成舞片的首帧参考与资产追溯，不替换米娅首页/牌桌常规立绘。 |
| `apps/web/assets/pals/video/{mia-sporty-sweetheart,mia-mint-soiree,mia-executive-beat}-v1.mp4` | 米娅三段独立竖屏舞蹈：运动甜心、薄荷晚宴、黑金总裁 | 2026-09-15，基于上列同套服装参考图生成 | 成年虚构角色；每段约 5 秒，逐套绑定卡面及结算舞台，不回退到角色默认片。来源角标位于非叙事右下角，运行时与派生静帧均以舞台收光区遮蔽。 |
| `apps/web/assets/pals/outfits/{mia-sporty-sweetheart,mia-mint-soiree,mia-executive-beat}.jpg` | 米娅三段舞片的 4:7 poster：视频首帧与信箱式模糊底 | 由对应 MP4 经 `scripts/make-dance-assets.mjs --mask-footer` 取收尾帧 | 同源画面；`--mask-footer` 只遮右下非叙事来源角标，人物、服装、舞蹈主体不变。 |
| `apps/web/assets/pals/outfits/{mia-sporty-sweetheart,mia-mint-soiree,mia-executive-beat}-{frame,silhouette}.jpg` | 米娅三套舞片的 3:4 定格和未解锁剪影 | 同上 | `frame` 用于换装定格，`silhouette` 用于锁卡；均遵守 3:4 卡框与 4:7 原片分离。 |

所有资源均明确标识为 AI 虚构内容；正式牌友在可见运行时使用稳定文件路径和 `audit-official-*-v1` 记录。林星的五态 WebM 通过 A01–A05 运行时合同接入牌桌、结算与写真馆回放；米娅仅提供 A01 WebM，其余状态保留动作表回退。银岚是第三位官方牌友（名册末位，不改动 `DEFAULT_SEATS`），她没有五态动作表——座位标签如实写「官方牌友 · 静态肖像」，这不是「自定义牌友」，两者是互相独立的两件事。

在接入真实 Provider 或商业素材前，必须记录：素材 ID、来源、许可、审核记录、角色版本、地区限制和回退资源。未记录的资产不得进入可见 Runtime。

## 资产映射与验收状态机器化（2026-09-18）

| 资源 | 用途 | 来源与版本 | 约束 |
| --- | --- | --- | --- |
| `apps/api/data/official-assets.json` + `GET /api/assets/registry` | 全部运行时资产的六字段账目（角色、服装、用途、动作、来源、验收状态） | 2026-09-18 建立；官方资产从本文件翻译为机器可读，UGC 资产从生产管线任务派生 | 验收状态枚举：APPROVED / AWAITING_REVIEW / LEGACY_UNREVIEWED / REJECTED_MANUAL / MISSING / SOURCE_ONLY；未记录资产不得进入可见 Runtime，缺项在 `gaps` 显式列出 |
| `apps/web/assets/pals/actions/{linxing,mia}-A01..A05.png` | 五态拆分的单张动作图，经 `actionPack[].imageRef` 绑定牌桌事件 | 2026-09-18 `scripts/split-action-sheet.py` 按 3×2 固定网格（512px/格）从 `linxing-actions-v1.png`、`mia-actions-v1.png` 拆出，`sourceRect` 记录于登记表 | 逐张预览验收通过；米娅 A05 左下角轻微网格渗边已附注。五态拼图此后仅作源文件，运行时不再加载整张拼图；第 6 格未绑定合同坐标不导出 |
| `apps/web/assets/pals/video/{linxing-entry-v2,mia-entry-v1,yinlan-entry-v1}-poster.jpg` | 入场视频播放前/失败时的封面（`appearance.entryPosterRef`） | 2026-09-18 ffmpeg 从对应入场视频取帧（林星/银岚 t=0.5s；米娅 t=3.5s，0.5s 帧为过渡特写弃用） | 画面全部来自视频本身；林星/银岚封面含源片自带 AI 水印 |
| `apps/web/assets/pals/yinlan-seat.png`、`yinlan-table-standee-v2.png` | ~~银岚牌桌半身立绘~~（已撤下） | 2026-09-15 手工替换图，两文件 md5 相同（9af6d078…） | **验收不通过（REJECTED_MANUAL）**：手工临时图且人物服装（水手服）与银岚身份不符。2026-09-18 从 `tableStandeeRef` 撤下，文件保留不删；牌桌槽回退 `yinlan-standee.png`，专用半身缺口登记 MISSING，待以 `yinlan-v1.png` 为参考单独生产 |
| 官方三人头像槽 | 首页选座与角色列表头像 | 2026-09-18 决策：场景肖像图（`linxing-v1.png` / `mia-v1.png` / `yinlan-v1.png`）正式登记为头像槽资产 | 如实登记为转正；后续若生产独立 1:1 头肩像，按槽替换并更新登记表 |
| 角色资料卡合同 | 工坊预览、用户确认、后续生产参考 | 2026-09-18 统一为「多素材参考总图」：`promptFor(master-portrait)` 与 `createProductionPlan.imagePrompt` 一致，矛盾死代码已清理 | 资料卡整图绝不进入运行时展示槽；存量「单人版」资料卡（pal-user-2632-v100）仅登记为历史版本，不触发连锁重生产 |

详细映射审计与缺口清单见 `docs/ASSET_MAP.md`。
