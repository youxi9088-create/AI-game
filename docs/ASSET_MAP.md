# 资产映射审计：资料卡 → 独立资源 → 页面位置

2026-09-18 建立。机器可读账目：`apps/api/data/official-assets.json`（官方登记）+ `GET /api/assets/registry`（官方 + UGC 管线 + 缺口实时汇总）。每份资源记录六字段：**角色、服装、用途、动作、来源、验收状态**；页面按用途取资源，缺项显式可见。

本文档的表格区**不是手写的**：由 `npm run assets:map`（`scripts/render-asset-map.mjs`）从注册表同一份聚合数据渲染，`npm run verify` 会检查生成区是否过期。手写结论只保留在「处理规则落实情况」「备注」「验证证据」三节。

<!-- ASSET-MAP:GENERATED:START -->
## 映射总表（生成）

| 生产资源 | 用途与处理要求 | 林星 | 米娅 | 银岚 | 墨鸢 | 星恒 | 甜美卷发小甜甜 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 角色资料卡 | 工坊预览、用户确认、后续生产参考；保留完整资料，不直接用于主页或牌桌 | — | — | — | ⚠️单人版历史卡＋⛔1项不通过 | ⚠️存量未逐项验收 | ✅ |
| 独立头像 | 首页选座、角色列表；单人头肩像，单独文件 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 大厅立绘 | 主页左右角色展示；单人半身、透明背景 | ✅ | ✅ | ✅ | ⚠️生产失败 | ⚠️生产失败 | ✅ |
| 牌桌立绘 | 牌桌角色默认形象；单人半身、透明背景，统一位置与尺寸 | ✅ | ✅ | ✅＋⛔2项不通过 | ⚠️生产失败＋⛔1项不通过 | ✅ | ⚠️生产失败 |
| 五态源拼图 | 仅作源文件；运行时加载拆出的单张，不显示整张拼图 | ✅ | ✅ | — | ✅ | ✅ | ✅ |
| 五态动作图 | 牌桌待机/出牌/不出/胜利/失败；拆成五张独立图片，分别绑定事件 | ✅ | ✅ | — | ✅ | ✅ | ✅ |
| 五态动作视频 | 对应五种牌桌事件；一种状态对应一个视频，静态图作为回退 | ✅ | ✅ | — | ⚠️缺A01–A05视频 | ⚠️缺A01–A05视频 | ⚠️缺A01–A05视频 |
| 入场视频 | 角色进入牌局时；播完回到牌桌立绘 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 服装写真卡面 | 解锁卡牌、写真馆、PNG 导出；单人完整卡面，按服装编号绑定 | ✅ | ✅＋⛔1项不通过 | ✅ | ✅ | ✅＋⛔1项不通过 | ✅ |
| 跳舞／换装视频 | 结算演出、对应卡牌回放；与同一服装卡面一一对应 | ✅ | ✅ | ✅ | 手工图不通过＋⛔1项不通过 | 手工图不通过＋⛔1项不通过 | 手工图不通过＋⛔1项不通过 |
| 视频封面 | 播放前、加载或播放失败时；从对应视频取帧 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 服装特效层 | 指定服装演出叠加；只含特效，不能拿人物图替代 | — | — | — | ⚠️生产失败 | 误产总图＋⛔1项不通过 | ✅ |

## 自定义牌友（UGC）资源账（生成）

管线产物均有任务记录与 sha256；上一轮手工改到未登记变体的运行时引用已于 2026-09-18 回正（`scripts/reconcile-confirmed-pals.mjs`，幂等可重跑）。

| 槽位 | 墨鸢（pal-user-2632-v100） | 星恒（pal-user-5079-v103） | 甜美卷发小甜甜（pal-user-5441-v105） |
| --- | --- | --- | --- |
| 角色资料卡 | ⚠️单人版历史卡＋⛔1项不通过 | ⚠️存量未逐项验收 | ✅ |
| 独立头像 | ✅ | ✅ | ✅ |
| 大厅立绘 | ⚠️生产失败 | ⚠️生产失败 | ✅ |
| 牌桌立绘 | ⚠️生产失败＋⛔1项不通过 | ✅ | ⚠️生产失败 |
| 五态源拼图 | ✅ | ✅ | ✅ |
| 五态动作图 | ✅ | ✅ | ✅ |
| 五态动作视频 | ⚠️缺A01–A05视频 | ⚠️缺A01–A05视频 | ⚠️缺A01–A05视频 |
| 入场视频 | ✅ | ✅ | ✅ |
| 服装写真卡面 | ✅ | ✅＋⛔1项不通过 | ✅ |
| 跳舞／换装视频 | 手工图不通过＋⛔1项不通过 | 手工图不通过＋⛔1项不通过 | 手工图不通过＋⛔1项不通过 |
| 服装特效层 | ⚠️生产失败 | 误产总图＋⛔1项不通过 | ✅ |

## 当前缺口清单（生成）

| 角色 | 槽位 | 类型 | 状态 | 说明 |
| --- | --- | --- | --- | --- |
| pal-user-8296-v104 | action-a01 | video | FAILED | UGC 计划「小甜甜」资源「ACTION-A01 待机透明 WebM（3:4）」未完成（FAILED）：ACTION-A01 待机透明 WebM（3:4） 视频契约不合格：pix_fmt=yuv420p（没有真实 alpha） |
| pal-user-8296-v104 | action-a02 | video | FAILED | UGC 计划「小甜甜」资源「ACTION-A02 出牌透明 WebM（3:4）」未完成（FAILED）：ACTION-A02 出牌透明 WebM（3:4） 无法转为透明动作 WebM：上游必须提供单人、纯绿幕、无场景的动作源视频。Command failed: python C:/Users/986916/.agents/skills/repair-webm-alpha/scripts/run_delivery.py C:\Users\986916\AppData\Local\Temp\dressbattle-action-alpha-qKIGAI\seedance-source.mp4 --delivery-dir C:\Users\986916\AppData\Local\Temp\dressbattle-action-alpha-qKIGAI\delivery --canvas 1248x1664 --screen-colour green
BLOCKED: technical acceptance 1920x1080 failed: Traceback (most recent call last):
  File "C:\Users\986916\.agents\skills\repair-webm-alpha\scripts\validate_webm_alpha.py", line 181, in <module>
    sys.exit(main())
             ~~~~^^
  File "C:\Users\986916\.agents\skills\repair-webm-alpha\scripts\validate_webm_alpha.py", line 169, in main
    raise RuntimeError(f"edge screen-colour spill region exceeds limit: max {edge_spill_region_max} pixels, limit {args.max_edge_spill_region}")
RuntimeError: edge screen-colour spill region exceeds limit: max 1617 pixels, limit 64
 |
| pal-user-8296-v104 | action-a03 | video | FAILED | UGC 计划「小甜甜」资源「ACTION-A03 不出透明 WebM（3:4）」未完成（FAILED）：ACTION-A03 不出透明 WebM（3:4） 无法转为透明动作 WebM：上游必须提供单人、纯绿幕、无场景的动作源视频。Command failed: python C:/Users/986916/.agents/skills/repair-webm-alpha/scripts/run_delivery.py C:\Users\986916\AppData\Local\Temp\dressbattle-action-alpha-xMg6e4\seedance-source.mp4 --delivery-dir C:\Users\986916\AppData\Local\Temp\dressbattle-action-alpha-xMg6e4\delivery --canvas 1248x1664 --screen-colour green
BLOCKED: technical acceptance 1920x1080 failed: Traceback (most recent call last):
  File "C:\Users\986916\.agents\skills\repair-webm-alpha\scripts\validate_webm_alpha.py", line 181, in <module>
    sys.exit(main())
             ~~~~^^
  File "C:\Users\986916\.agents\skills\repair-webm-alpha\scripts\validate_webm_alpha.py", line 169, in main
    raise RuntimeError(f"edge screen-colour spill region exceeds limit: max {edge_spill_region_max} pixels, limit {args.max_edge_spill_region}")
RuntimeError: edge screen-colour spill region exceeds limit: max 271 pixels, limit 64
 |
| pal-user-8296-v104 | action-a04 | video | FAILED | UGC 计划「小甜甜」资源「ACTION-A04 胜利透明 WebM（3:4）」未完成（FAILED）：ACTION-A04 胜利透明 WebM（3:4） 无法转为透明动作 WebM：上游必须提供单人、纯绿幕、无场景的动作源视频。Command failed: python C:/Users/986916/.agents/skills/repair-webm-alpha/scripts/run_delivery.py C:\Users\986916\AppData\Local\Temp\dressbattle-action-alpha-PTUqN6\seedance-source.mp4 --delivery-dir C:\Users\986916\AppData\Local\Temp\dressbattle-action-alpha-PTUqN6\delivery --canvas 1248x1664 --screen-colour green
BLOCKED: technical acceptance 1920x1080 failed: Traceback (most recent call last):
  File "C:\Users\986916\.agents\skills\repair-webm-alpha\scripts\validate_webm_alpha.py", line 181, in <module>
    sys.exit(main())
             ~~~~^^
  File "C:\Users\986916\.agents\skills\repair-webm-alpha\scripts\validate_webm_alpha.py", line 169, in main
    raise RuntimeError(f"edge screen-colour spill region exceeds limit: max {edge_spill_region_max} pixels, limit {args.max_edge_spill_region}")
RuntimeError: edge screen-colour spill region exceeds limit: max 149 pixels, limit 64
 |
| pal-user-8296-v104 | action-a05 | video | FAILED | UGC 计划「小甜甜」资源「ACTION-A05 失败透明 WebM（3:4）」未完成（FAILED）：ACTION-A05 失败透明 WebM（3:4） 无法转为透明动作 WebM：上游必须提供单人、纯绿幕、无场景的动作源视频。Command failed: python C:/Users/986916/.agents/skills/repair-webm-alpha/scripts/run_delivery.py C:\Users\986916\AppData\Local\Temp\dressbattle-action-alpha-4h5zkH\seedance-source.mp4 --delivery-dir C:\Users\986916\AppData\Local\Temp\dressbattle-action-alpha-4h5zkH\delivery --canvas 1248x1664 --screen-colour green
BLOCKED: technical acceptance 1920x1080 failed: Traceback (most recent call last):
  File "C:\Users\986916\.agents\skills\repair-webm-alpha\scripts\validate_webm_alpha.py", line 181, in <module>
    sys.exit(main())
             ~~~~^^
  File "C:\Users\986916\.agents\skills\repair-webm-alpha\scripts\validate_webm_alpha.py", line 169, in main
    raise RuntimeError(f"edge screen-colour spill region exceeds limit: max {edge_spill_region_max} pixels, limit {args.max_edge_spill_region}")
RuntimeError: edge screen-colour spill region exceeds limit: max 125 pixels, limit 64
 |
| pal-user-8296-v104 | outfit-film | video | FAILED | UGC 计划「小甜甜」资源「首套换装 / 写真演出视频」未完成（FAILED）：[object Object] |
| 墨鸢 | action-a01 | video | FAILED | UGC 计划「5fe85ced」资源「A01 待机 WebM」未完成（FAILED）：历史动作视频是带场景的 MP4，不符合透明 VP9 WebM 合同；请按当前纯绿幕提示词重产，系统会自动抠像并生成预览。 |
| 墨鸢 | action-a02 | video | FAILED | UGC 计划「5fe85ced」资源「A02 出牌 WebM」未完成（FAILED）：历史动作视频是带场景的 MP4，不符合透明 VP9 WebM 合同；请按当前纯绿幕提示词重产，系统会自动抠像并生成预览。 |
| 墨鸢 | action-a03 | video | FAILED | UGC 计划「5fe85ced」资源「A03 不出 WebM」未完成（FAILED）：历史动作视频是带场景的 MP4，不符合透明 VP9 WebM 合同；请按当前纯绿幕提示词重产，系统会自动抠像并生成预览。 |
| 墨鸢 | action-a04 | video | FAILED | UGC 计划「5fe85ced」资源「A04 胜利 WebM」未完成（FAILED）：历史动作视频是带场景的 MP4，不符合透明 VP9 WebM 合同；请按当前纯绿幕提示词重产，系统会自动抠像并生成预览。 |
| 墨鸢 | action-a05 | video | FAILED | UGC 计划「5fe85ced」资源「A05 失败 WebM」未完成（FAILED）：历史动作视频是带场景的 MP4，不符合透明 VP9 WebM 合同；请按当前纯绿幕提示词重产，系统会自动抠像并生成预览。 |
| 墨鸢 | lounge-standee | image | FAILED | UGC 计划「5fe85ced」资源「大厅主视觉立绘」未完成（FAILED）：历史透明图片带有场景、桌面、白底或不合格透明边缘；已从运行时撤回，请按当前透明画布合同重产。 |
| 墨鸢 | master-portrait | image | LEGACY_SINGLE_PORTRAIT | 资料卡为「单人版」历史产物（实际 1024px 宽，参考总图合同 ≥1920px）；按 2026-09-18 决策仅登记为历史版本，不触发重生产。 |
| 墨鸢 | outfit-fx | image | FAILED | UGC 计划「5fe85ced」资源「服装特效层（透明 PNG）」未完成（FAILED）：历史透明图片带有场景、桌面、白底或不合格透明边缘；已从运行时撤回，请按当前透明画布合同重产。 |
| 墨鸢 | table-standee | image | FAILED | UGC 计划「5fe85ced」资源「牌桌半身立绘（4:5 透明）」未完成（FAILED）：历史透明图片带有场景、桌面、白底或不合格透明边缘；已从运行时撤回，请按当前透明画布合同重产。 |
| 星恒 | action-a01 | video | FAILED | UGC 计划「星恒」资源「A01 待机 WebM」未完成（FAILED）：历史动作视频是带场景的 MP4，不符合透明 VP9 WebM 合同；请按当前纯绿幕提示词重产，系统会自动抠像并生成预览。 |
| 星恒 | action-a02 | video | FAILED | UGC 计划「星恒」资源「A02 出牌 WebM」未完成（FAILED）：历史动作视频是带场景的 MP4，不符合透明 VP9 WebM 合同；请按当前纯绿幕提示词重产，系统会自动抠像并生成预览。 |
| 星恒 | action-a03 | video | FAILED | UGC 计划「星恒」资源「A03 不出 WebM」未完成（FAILED）：历史动作视频是带场景的 MP4，不符合透明 VP9 WebM 合同；请按当前纯绿幕提示词重产，系统会自动抠像并生成预览。 |
| 星恒 | action-a04 | video | FAILED | UGC 计划「星恒」资源「A04 胜利 WebM」未完成（FAILED）：历史动作视频是带场景的 MP4，不符合透明 VP9 WebM 合同；请按当前纯绿幕提示词重产，系统会自动抠像并生成预览。 |
| 星恒 | action-a05 | video | FAILED | UGC 计划「星恒」资源「A05 失败 WebM」未完成（FAILED）：历史动作视频是带场景的 MP4，不符合透明 VP9 WebM 合同；请按当前纯绿幕提示词重产，系统会自动抠像并生成预览。 |
| 星恒 | lounge-standee | image | FAILED | UGC 计划「星恒」资源「大厅主视觉立绘」未完成（FAILED）：历史透明图片带有场景、桌面、白底或不合格透明边缘；已从运行时撤回，请按当前透明画布合同重产。 |
| 甜美卷发小甜甜 | action-a01 | video | FAILED | UGC 计划「甜美卷发小甜甜」资源「A01 待机 WebM」未完成（FAILED）：历史动作视频是带场景的 MP4，不符合透明 VP9 WebM 合同；请按当前纯绿幕提示词重产，系统会自动抠像并生成预览。 |
| 甜美卷发小甜甜 | action-a02 | video | FAILED | UGC 计划「甜美卷发小甜甜」资源「A02 出牌 WebM」未完成（FAILED）：历史动作视频是带场景的 MP4，不符合透明 VP9 WebM 合同；请按当前纯绿幕提示词重产，系统会自动抠像并生成预览。 |
| 甜美卷发小甜甜 | action-a03 | video | FAILED | UGC 计划「甜美卷发小甜甜」资源「A03 不出 WebM」未完成（FAILED）：历史动作视频是带场景的 MP4，不符合透明 VP9 WebM 合同；请按当前纯绿幕提示词重产，系统会自动抠像并生成预览。 |
| 甜美卷发小甜甜 | action-a04 | video | FAILED | UGC 计划「甜美卷发小甜甜」资源「A04 胜利 WebM」未完成（FAILED）：历史动作视频是带场景的 MP4，不符合透明 VP9 WebM 合同；请按当前纯绿幕提示词重产，系统会自动抠像并生成预览。 |
| 甜美卷发小甜甜 | action-a05 | video | FAILED | UGC 计划「甜美卷发小甜甜」资源「A05 失败 WebM」未完成（FAILED）：历史动作视频是带场景的 MP4，不符合透明 VP9 WebM 合同；请按当前纯绿幕提示词重产，系统会自动抠像并生成预览。 |
| 甜美卷发小甜甜 | table-standee | image | FAILED | UGC 计划「甜美卷发小甜甜」资源「牌桌半身立绘（4:5 透明）」未完成（FAILED）：历史透明图片带有场景、桌面、白底或不合格透明边缘；已从运行时撤回，请按当前透明画布合同重产。 |

> 资产共 158 份：APPROVED 105 · REJECTED_MANUAL 7 · SOURCE_ONLY 28 · REJECTED_COMPOSITION 3 · LEGACY_UNREVIEWED 9 · AWAITING_REVIEW 6。实时数据：`GET /api/assets/registry`；本区由 `npm run assets:map` 生成，请勿手改。
<!-- ASSET-MAP:GENERATED:END -->

## 资料卡元素处理规则落实情况（手写）

1. **固定布局、边界清晰的素材 → 按记录区域拆分，逐张预览验收**：官方五态图（3×2 固定网格，512px/格）已拆分，`official-assets.json` 记录每格 `sourceRect` 与验收结论；第 6 格未绑定合同动作坐标，不导出。
2. **重叠、被裁切、尺寸不足的素材 → 以资料卡作参考单独生成**：银岚牌桌半身、米娅 A02–A05 视频、星恒单人立绘按此处理——登记缺口待生产，不用手工裁剪顶替；`_asset_delivery/yinlan-table-cutout` 身份一致但白底全身带桌，不合槽位规格，仅作生产参考。
3. **五态拼图只作源文件**：运行时只加载拆出的单张（`actionPack[].imageRef` / UGC `derivedImages`），整张拼图的 CSS sprite 回退已移除。
4. **六字段账目 + 缺项显式**：`GET /api/assets/registry` 实时返回 `assets`（含验收状态）与 `gaps`；UGC 存量任务无 `reviewStatus` 的一律标 `LEGACY_UNREVIEWED`，不冒充已验收。
5. **运行时引用必须可溯源**：上一轮手工改到未登记变体的名册引用已回正（`scripts/reconcile-confirmed-pals.mjs`）；`tests/asset-registry.test.mjs` 校验已确认牌友的每个引用都落在盘上且可溯源到管线任务或注册表登记。

## 备注（手写）

- 计划 `dfce95b1`（星恒 v104）是半成品——master-portrait、table-standee、outfit-poster 成功，first-outfit、action-sheet、lounge-standee、outfit-fx 因「无效的令牌」FAILED，全部视频 BLOCKED_REFERENCE；未确认上桌，由用户在工坊决定重试或删除。
- `ugc/0c5995fe-…png` 为 68 字节空壳残留（疑似旧版生成服务失败写入），建议删除。
- 星恒首套写真的服装一致化（2026-09-19 已解决）：演出视频与封面本就是蓝西装，唯一不一致的是早期固定模板产出的黑裙静态卡面；已改为从演出视频安全尾帧取同源蓝西装卡面（`first-outfit-v2.jpg`），黑裙卡面标记 REJECTED_COMPOSITION。后续计划已由资料卡门禁统一注入，不再出现。
- 星恒五态源图为不规则拼版（非标准 3×2 网格）：初始网格拆分仅 A01–A03 恰好对应完整姿势，A04/A05 拆坏；已按连通域实测区域重拆（sourceRect 记录于任务）并清除邻域侵染。两人共 10 张拆分图于 2026-09-18 全部验收通过（APPROVED）。
- 星恒两张胸像与两人头像（ad-hoc 640²）于 2026-09-18 用户验收转正，规格偏差（尺寸/黑底/噪点）已在登记表如实保留。
- 官方三人的「独立头像」为 2026-09-18 决策的场景肖像图转正登记；后续若生产 1:1 头肩像，按槽替换并更新登记表。

## 端到端验证证据（2026-09-18，手写）

- `docs/ui-shots/asset-map-table-settled.png`：结算牌桌——林星 A04 胜利视频、米娅 A05 拆分静态图；资料卡未上桌。
- `docs/ui-shots/asset-map-home.png`：大厅左右立绘 + 选座头像（转正肖像）。
- `docs/ui-shots/asset-map-entry.png`：入场画面（封面 poster 已接线）。
- `docs/ui-shots/asset-map-table-playing.png` / `asset-map-gallery.png` / `asset-map-workshop.png`：对局、写真馆、工坊；全页面零破图（Playwright 校验 `naturalWidth`）。
- `docs/ui-shots/asset-map-table-ugc.png`：墨鸢、星恒同桌——两人五态视频均正常播放（墨鸢视频为 2026-09-18 新接线）。
- 测试：`tests/asset-registry.test.mjs` 8 项；`npm run verify` 全绿（lint + typecheck + 91 项单测 + build + fixtures + 生成区过期检查）。
