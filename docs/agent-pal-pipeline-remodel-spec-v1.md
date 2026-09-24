# 换装斗地主：AI 牌友生产线改造任务书 v1

> 用途：本文件是交给开发 Agent 直接执行的工程任务书，不是概念建议。
>
> 当前事实基线：线上林星与米娅是两个独立角色；角色资料卡只作为人工确认和下游生成参考，不能直接进入头像、大厅、牌桌或写真展示槽位。

## 0. 改造目标与完成定义

把当前“生成若干文件后尽量绑定”的流程，改造成一条有严格依赖、稳定格式、可人工修订、可局部重试、可审计和可在游戏中正确消费的生产线。

只有同时满足下列条件，才允许标记一个新牌友为 `READY`：

1. 角色资料卡已由用户确认，确认的是具体 `sha256`，不是可变 URL。
2. 每个运行时槽位都有自己独立、合格的资源，资料卡和 Sprite 总图没有被直接当成立绘使用。
3. 所有必需图片、视频都经过自动规格检查、人工预览和真实运行时检查。
4. 所有五态动作与牌局事件正确绑定；视频不可用时只回退到同角色、同状态的静态图。
5. 换装演出是一条完整的“边跳舞、边逐件脱去外层服装”视频；人物身份、舞蹈和服装变化连续，任一时刻都不存在身体缺失。
6. 刷新页面、重启服务后，计划、任务、外部 Run、人工修改、审核结论与下一步操作均可恢复。

## 1. 先改任务图：禁止无依赖地一次性并发全部资源

### 1.1 新的阶段顺序

```text
P0 创建计划并持久化
  ↓
P1 生成角色资料卡 master-portrait
  ↓
G1 用户确认资料卡（锁定 profileRevision + sha256）
  ↓
P2 生成身份基准图
   ├─ avatar
   ├─ lounge-standee
   └─ table-standee
  ↓
G2 身份与构图验收（任一失败只重产失败槽位）
  ↓
P3 生成游戏动作源图
   ├─ action-image-A01 idle
   ├─ action-image-A02 play
   ├─ action-image-A03 pass
   ├─ action-image-A04 win
   └─ action-image-A05 lose
  ↓
G3 单图身份、锚点、透明度验收
  ↓
P4 由对应动作单图分别生成五态视频
   ├─ action-video-A01
   ├─ action-video-A02
   ├─ action-video-A03
   ├─ action-video-A04
   └─ action-video-A05
  ↓
P5 视频后处理与透明通道门禁
  ↓
G4 牌桌真实播放验收
  ↓
P6 生成首套服装演出包
   ├─ outfit-manifest
   ├─ outfit-card
   ├─ outfit-performance-video
   └─ outfit-poster（从已验收视频取帧）
  ↓
G5 换装连续性与写真馆回放验收
  ↓
P7 入场视频、台词包、审计合同
  ↓
G6 原子晋升 → READY → 排入下一局
```

### 1.2 关键改动

- `master-portrait` 从透明资源集合中移除。资料卡允许有设计底板，但不能进入任何运行时图片槽。
- 不再先生成 3×2 `action-sheet` 再依赖不可靠裁切作为主要路径。主要路径改为五张独立动作图；如保留总图，只用于工坊汇总预览，不参与运行时映射。
- 五态视频分别使用同状态的 `action-image-A0x` URL，而不是整张角色资料卡 URL。
- `outfit-poster` 必须由已验收的换装视频抽帧生成，不能再独立文生图，否则会出现卡面、视频人物和服装不一致。
- 入场视频使用 `lounge-standee` 或专门的 `entry-keyframe` 作为参考；不能使用多格资料卡。
- 下游任务必须记录 `dependsOn[]`、`inputAssetIds[]`、`inputSha256[]`。上游 revision 改变后，受影响下游进入 `STALE`，不得继续显示为已完成。

## 2. 统一资源合同、格式、尺寸、存放与命名

### 2.1 文件目录

```text
assets/pals/ugc/{palId}/v{palVersion}/
  profile/
  portraits/
  actions/images/
  actions/videos/
  outfits/{outfitId}/states/
  outfits/{outfitId}/video/
  entry/
  dialogue/
  audit/
```

发布产物使用不可变 revision 路径；禁止后一次重产覆盖旧文件。数据库或 JSON 记录指向最新“已批准 revision”。

### 2.2 命名格式

```text
{palId}__v{palVersion}__{resourceId}__r{revision}.{ext}
{palId}__v{palVersion}__{outfitId}__S{nn}__r{revision}.png
{palId}__v{palVersion}__{actionId}__r{revision}.webm
```

示例：

```text
pal-user-2632__v104__avatar__r2.webp
pal-user-2632__v104__action-A02__r3.png
pal-user-2632__v104__action-A02__r3.webm
pal-user-2632__v104__outfit-001__S02__r1.png
```

### 2.3 资源规格表

| 资源 ID | 格式与尺寸 | 透明 | 运行时用途 | 必要门禁 |
| --- | --- | --- | --- | --- |
| `master-portrait` | PNG/JPEG/WebP，2160×3840，竖版 | 否 | 工坊确认与下游参考 | 单一角色身份；含全身、头肩、服装/配饰细节与五态参考；不得直接展示 |
| `avatar` | WebP/PNG，2048×2048，1:1 | 否 | 选人卡、列表、牌桌头像 | 单人头肩；脸、发型完整；小尺寸可辨识 |
| `lounge-standee` | PNG，1920×2560，3:4 | 是 | 首页大厅左右主视觉 | 单人半身或 3/4 身；适配当前线上林星/米娅构图；边缘无底色 |
| `table-standee` | PNG，1600×2000，4:5 | 是 | 牌桌静态兜底 | 单人半身；手部及出牌区不遮挡；统一脚点锚点 |
| `action-image-A01..A05` | PNG，1600×2000，4:5 | 是 | 五态视频首帧与静态回退 | 一图一动作；人物位置、比例、锚点一致 |
| `action-video-A01..A05` | VP9 WebM，1080×1350，4:5，25/30fps，2–4s | 是 | 牌桌五态动作 | 真 alpha；可循环项首尾连续；无镜头移动；头、手不出画 |
| `entry-film` | H.264 MP4，1920×1080，16:9，4–8s | 否 | 开局入场演出 | 可保留场景；支持跳过；首帧不能黑屏 |
| `outfit-card` | WebP/PNG，1920×2560，3:4 | 否 | 写真卡面 | 与换装视频最终/目标套装一致；无文字水印 |
| `outfit-performance-video` | H.264 MP4，1080×1440，3:4，8–15s | 否 | 结算演出、写真馆回放 | 持续跳舞并自然逐件脱去外层；全程有头、完整身体、无黑帧 |
| `outfit-poster` | WebP，1080×1440，3:4 | 否 | 回放加载前海报 | 从已验收视频 10%–30% 位置抽帧，不单独生成 |
| `outfit-fx` | PNG，2048×2048 | 是 | 可选前景特效层 | 仅特效，无人物、无文字；不可遮挡脸和牌 |
| `dialogue-pack` | UTF-8 JSON | 不适用 | 五态台词 | 五态各至少 3 条；口吻与资料卡一致 |
| `audit-record` | UTF-8 JSON | 不适用 | 审计、恢复、发布 | Provider、模型、Prompt、输入/输出 hash、审核记录完整 |

图片最大 20MB、视频最大 250MB可以继续保留，但只是传输上限，不是质量标准。

### 2.4 每个资产必须保存的元数据

```json
{
  "assetId": "stable-id",
  "palId": "pal-user-xxxx",
  "palVersion": 104,
  "outfitId": "outfit-001",
  "resourceId": "action-video-A02",
  "revision": 3,
  "status": "APPROVED",
  "provider": "aihub-seedance",
  "modelOrWorkflow": "seedance",
  "runId": "...",
  "attempt": 2,
  "promptTemplateVersion": "action-video-v3",
  "promptPatch": "用户本次人工补充",
  "inputAssetIds": ["..."],
  "inputSha256": ["..."],
  "mime": "video/webm",
  "width": 1080,
  "height": 1350,
  "durationMs": 3000,
  "fps": 30,
  "codec": "vp9",
  "hasAlpha": true,
  "bytes": 123,
  "sha256": "...",
  "createdAt": "...",
  "reviewedAt": "...",
  "reviewNote": "..."
}
```

## 3. 提示词体系重构

### 3.1 禁止继续使用一个通用 Prompt 覆盖所有节点

拆为以下结构化块，并为每次调用保存渲染后的完整 Prompt：

```text
identity_lock
style_lock
wardrobe_manifest
accessory_lock
composition_contract
action_contract
background_contract
negative_contract
user_prompt_patch
```

优先级固定为：

```text
用途/安全硬合同
> 用户确认后的身份与服装 manifest
> 节点构图和动作合同
> 产品视觉风格
> 用户本次人工补充
> 初始自由描述
```

用户补充不能覆盖“同一人物、成年人、运行时尺寸、透明背景、禁止文字水印”等硬合同。

### 3.2 身份与产品风格锁定

- 资料卡阶段允许“创建一个原创新角色”。
- 资料卡确认后，所有节点必须改为“严格复现已确认角色”，不得继续注入 `create a new character` 或会改变身份的分离指令。
- `identity_lock` 至少固化：脸型、五官、肤色、发型、发色、体型、成年特征和标志性配饰。
- `style_lock` 只描述当前产品的制作语言：半写实电影级游戏 CG、真实材质、精致但不过度锐化、暗夜蓝紫与香槟金为环境语言。
- 对透明立绘和动作图，禁止注入赌场背景、景深、散景、环境光斑等场景词；允许使用轮廓光，但背景必须透明或便于确定性去除的纯色。
- 禁止提示词出现“复刻林星本人”。目标是同产品画风，不是同一人物、同一脸或同一服装。

### 3.3 服装去重与服装 manifest

建立结构化 `wardrobeManifest`，不能只保存一句服装描述：

```json
{
  "outfitId": "outfit-001",
  "theme": "空姐风正式制服",
  "palette": ["ivory", "navy", "champagne-gold"],
  "silhouette": "fitted jacket + knee-length skirt",
  "layers": [
    { "id": "L04", "name": "手套", "removable": true },
    { "id": "L03", "name": "丝巾", "removable": true },
    { "id": "L02", "name": "短外套", "removable": true },
    { "id": "L01", "name": "马甲", "removable": true },
    { "id": "L00", "name": "完整遮蔽的基础连衣裙", "removable": false }
  ],
  "accessories": ["耳饰"],
  "forbiddenSimilarity": ["existing outfit hashes", "same palette+silhouette combination"]
}
```

生成新套装前，与该角色既有套装以及林星、米娅的已上线套装做结构化去重：主题、主色、轮廓和层级四项中至少三项不同。相似度过高时，在调用 Provider 前重写服装方案，不浪费生成额度。

### 3.4 各节点 Prompt 必须不同

- `avatar`：只允许头肩、一人、正面/微侧、脸和头发完整；不传五态动作列表。
- `lounge-standee`：首页主视觉构图，一人，半身或 3/4 身，保留标题负空间；不传牌桌动作。
- `table-standee`：牌桌半身、一人、固定锚点、手和牌区清楚；不传大厅构图。
- `action-image-A0x`：只传对应一个动作，不传其余四态。
- `outfit-card`：严格读取 `wardrobeManifest`，不允许模型自行增加或替换主服装层。
- `outfit-fx`：只生成特效，不得注入人物身份、服装动作列表。
- `outfit-poster`：不调用生图模型，改为视频抽帧。
- 所有 Prompt 加入版本号；任何人工修改形成新 `promptRevision`，旧版不可覆盖。

### 3.5 提示词专项审计（当前遗漏必须修复）

每次真正调用 Provider 前，服务端必须保存并审计最终渲染后的 Prompt，而不是只保存模板名。审计结果至少包含：`resourceId`、`promptRevision`、完整 Prompt、参考图 URL/assetId/hash、服装 manifest、人工 `promptPatch`、Provider 路由和模型。

逐节点检查以下项目：

| 检查项 | 资料卡 | 头像/大厅/牌桌 | 五态动作图/视频 | 换装演出视频 | 写真卡/Poster |
| --- | --- | --- | --- | --- | --- |
| 新建身份语句 | 允许 | 禁止 | 禁止 | 禁止 | 禁止 |
| 已确认身份锁定 | 参考 | 必须 | 必须 | 必须 | 必须 |
| 林星视觉风格 | 必须 | 必须但去场景背景 | 必须但去场景背景 | 必须 | 必须 |
| 服装/配饰 manifest | 参考 | 必须继承 | 必须继承 | 必须继承并描述逐件外层变化 | 必须 |
| 五态动作集合 | 可包含 | 禁止 | 只允许当前动作 | 禁止 | 禁止 |
| 透明背景合同 | 资料卡不要求 | 立绘/动作图要求 | 动作视频另做 alpha 后处理 | 不要求 | 不要求 |
| 舞蹈参考视频 | 禁止 | 禁止 | 禁止 | 必须 | 禁止 |

当前代码专项修复项：

1. `promptPatch` 目前虽写入任务记录，但必须显式追加到 `promptFor`、`danceInputs`、`seedanceInputs` 的最终 Prompt；如果人工修改的是硬约束冲突内容，要提示冲突并保留硬约束。
2. `PAL_IDENTITY_SEPARATION_LOCK` 只允许在 `master-portrait` 使用。下游统一替换为 `APPROVED_IDENTITY_LOCK`，内容是“严格保持已确认角色”，不能再写“创建新人物/不可复用已有脸”。
3. `danceInputs` 的 `outfit-film` 专用动作必须改为：持续跳舞，同时按服装 manifest 自然、依次脱去可移除的外层服装/配饰；不瞬移、不闪切、不换人、不让已脱服装闪回；始终保留完整基础服装。
4. 跳舞视频时长不得继续默认为 5 秒。由服装层数量计算目标时长，默认 8–12 秒；Provider 受限时减少可移除外层数量并在 Prompt 中同步，不能生成一条无法完成变化的短片。
5. `seedanceInputs` 的五态动作必须只读当前 `action-image-A0x`；入场视频只读大厅/入场参考，不得默认把整张资料卡作为视频首帧。
6. `master-portrait` 不得进入 alpha 输出和抠图验证；头像、大厅、牌桌、动作图的透明要求按各自节点执行。
7. `outfit-poster` 不再发送生图 Prompt；只能从已验收的换装演出视频抽帧，记录 `sourceVideoAssetId` 和时间码。
8. 计划层 `imagePrompt` 与实际请求模板必须由同一个模板函数渲染；前端显示的预览 Prompt 必须标注版本，并与服务端最终 Prompt hash 一致。

Provider 提交前若任一硬约束缺失，任务进入 `PROMPT_INVALID`，不扣额度、不创建外部任务；工坊显示缺少的具体字段和可编辑入口。

## 4. 任务列表、错误恢复、打回与人工修改

### 4.1 状态机统一

```text
PLANNED
→ BLOCKED_DEPENDENCY
→ QUEUED
→ SUBMITTING
→ RUNNING
→ MATERIALIZING
→ VALIDATING
→ AWAITING_REVIEW
→ APPROVED
→ PROMOTED
```

失败分支：

```text
SUBMIT_FAILED        请求未被 Provider 接受，无外部任务号
PROVIDER_FAILED      Provider 已返回终态失败
DOWNLOAD_FAILED      Provider 成功但文件未取回
VALIDATION_FAILED    文件存在但格式/用途不合格
REJECTED             人工验收打回
STALE                上游确认资源或 Prompt 版本已经变化
CANCELLED            人工取消
```

禁止继续用单一 `SUCCEEDED` 同时表示“Provider 成功、文件已下载、格式合格、人工通过”。

### 4.2 自动重试策略

- 网络超时且已有 `runId`：继续轮询同一个 Run，不新建任务、不重复扣费。
- 请求未提交成功且没有 `runId`：修正请求后可重试提交。
- Provider 终态失败：保留诊断，只允许用户显式局部重试。
- 文件下载失败：只重试取回，不重新生成。
- 格式/透明度/尺寸失败：先尝试确定性后处理；后处理失败才允许重生产。
- 内容、身份、构图不合格：必须重生产，不能靠裁切/抠图把多人物资料卡伪装成立绘。
- 权限、Token、配额错误：停止自动重试，显示可行动原因。
- 自动重试需指数退避和上限；用户手动重试不受旧的 `attempt >= 2` 一刀切限制，但每次必须生成新 attempt 记录。

### 4.3 “重试”和“打回重产”必须是两种操作

**重试当前尝试**：输入、Prompt、Provider、模型不变；适合网络、轮询、下载问题。

**打回并创建新 revision**：用于内容质量问题，必须让用户填写：

- 不合格类别：身份、画风、服装、配饰、构图、透明、动作、视频连续性、其他；
- 打回原因；
- Prompt 补充/替换片段；
- 是否沿用原参考资产；
- 重产范围：本资源、同组资源、全部下游资源。

后端接口接受：

```json
{
  "taskId": "...",
  "reasonCode": "STYLE_MISMATCH",
  "reason": "面部过于写实，与产品 CG 风格不同",
  "promptPatch": "降低真人摄影感，保持半写实游戏 CG",
  "referenceMode": "KEEP_APPROVED_PROFILE",
  "scope": "RESOURCE_AND_DEPENDENTS"
}
```

打回后旧任务变为不可变审计记录；必须新建 `taskId` 与 `revision`，通过 `previousTaskId` 连接。禁止原地覆盖旧文件、旧 Prompt 和旧审核结论。

### 4.4 任务列表 UI 要显示

- 资源计划编号、角色名、资源 ID、revision、当前阶段；
- 依赖谁、被谁阻塞；
- 实际使用的参考图缩略图和 hash；
- Prompt 模板版本、人工 Prompt Patch；
- Provider、模型/工作流、runId、attempt；
- 失败类型、原始错误、建议操作；
- “继续轮询 / 重试下载 / 同输入重试 / 编辑提示词并重产 / 打回 / 验收”对应按钮。

任务列表的后台刷新不得重置用户正在输入的打回原因或 Prompt Patch，也不得把滚动位置弹回顶部。

## 5. 核心：边跳舞边逐件脱的完整视频生产

### 5.1 产品定义

“一件件脱”不是静态状态切换，也不是拆成多段人工控制。产品要的是一条连续演出：角色从头到尾持续跳舞，在舞蹈动作中依次脱去外层服装或配饰，服装变化与舞蹈自然结合。用户不需要控制脱哪一件、何时脱或分段播放。

### 5.2 单次完整视频输入

视频节点只需要以下输入：

1. 已批准服装卡面 URL：作为工作流唯一 `image_url`，同时锁定人物身份和开场完整服装；该卡面自身必须由已确认角色资料卡生成并通过身份验收。
2. 用户提供的舞蹈参考视频 URL；未提供时使用产品默认舞蹈参考视频，作为 `video_url`。
3. `wardrobeManifest.layers[]`：只用于告诉模型有哪些外层可以在舞蹈中依次脱去，以及最终必须保留的基础服装。
4. 一条专用视频 Prompt：强调持续舞蹈、自然脱衣节奏、身份与镜头连续。

服装状态图不再作为必需资源，也不生成多段转场后拼接。Provider 一次生成完整视频；失败时整条视频重产，成功后只保留原始视频、通过验收的视频和 poster。

### 5.3 视频 Prompt 合同

Prompt 必须表达以下内容：

- 同一个成年虚构角色从头到尾持续跳舞，不停下来摆静态展示姿势；
- 在连续舞蹈过程中自然、依次脱去可移除的外层服装和配饰；
- 脱衣动作与舞蹈动作结合，例如转身时脱外套、抬手时取下手套或丝巾；
- 不瞬间变装、不闪切成另一套服装、不让已经脱掉的衣物重新出现；
- 保持同一张脸、发型、体型、肤色、机位、灯光和画风；
- 最终保留 `wardrobeManifest` 指定的完整基础服装；
- 一人、全身或 3/4 身始终在画面内，头部和手部不被裁掉；
- 无多余人物、无文字、无水印、无镜头黑场。

舞蹈参考视频只控制舞蹈节奏、动作和镜头语言，不能把参考视频中的人物、服装和背景带入结果。角色和开场服装只以 `image_url` 的已批准服装卡面为准。完整演出建议 8–12 秒；若工作流时长受限，则减少可脱外层数量，不拆片、不拼片。

### 5.4 视频硬门禁

完整视频自动检查：

- MIME、真实字节、分辨率、比例、fps、codec、时长；
- 首、中、尾帧非黑、非空、头部存在、人体主体完整；
- 人脸身份相似度在阈值内；
- 抽取多个时间点检查舞蹈在持续进行，不是静态立绘的轻微晃动；
- 至少发生两次可辨识的外层服装/配饰移除，且已经脱掉的服装不闪回；
- 开场服装与 `outfit-card` 一致，结束时仍保留完整基础服装；
- 没有多余人物、重复肢体、服装闪回、场景突变、文字水印；
- 视频可在 Chromium 实际解码并播放至结束。

五态动作视频另加透明门禁：不能只看 `alpha_mode=1` 标签，必须解码抽帧，在深色与浅色棋盘测试背景上检查真实透明像素、边缘残留和人物被挖空情况。

### 5.5 演出绑定

- 每张写真卡绑定唯一 `outfitId + performanceRevision`。
- 不同服装卡不得默认复用同一视频。
- 卡面、视频、poster 必须来自同一 `wardrobeManifest`。
- 结算演出与写真馆回放复用同一已批准视频 URL；回放失败时显示明确错误，不显示永久黑框。

## 6. 代码改造落点

1. `packages/pal-generation-core/index.mjs`
   - 重写资源图与依赖关系；新增 `wardrobeManifest` 和完整换装演出视频合同；废除 action-sheet 作为运行时主路径。
2. `apps/api/pal-resource-pipeline.mjs`
   - 拆分节点 Prompt；移除资料卡 alpha 要求；实现依赖调度、revision、`STALE`、错误分类、局部重试和新 revision 重产。
3. `packages/pal-asset-contract/index.mjs` 与合同校验
   - 明确 avatar/lounge/table/action/outfit 的独立引用；晋升时禁止资料卡和 Sprite 总图落入这些槽。
4. `apps/web/asset-slots.js`
   - 固定“角色 ID × 用途 × 动作/服装 ID”映射；回退只能在同角色同用途内发生。
5. `apps/web/app.js`
   - 增加人工 Prompt Patch、打回范围、错误类型、依赖和 revision 展示；保护轮询期间的表单与滚动状态。
6. `scripts/`
   - 增加视频探测、抽帧、黑帧/主体/透明度检查和 poster 抽帧脚本；保留原始 Provider 文件。
7. `tests/`
   - 增加任务图、状态迁移、幂等、打回重产、上游变更导致下游 STALE、资源槽防错配、视频规格与浏览器播放测试。

## 7. Agent 执行顺序与提交边界

### 批次 A：合同和状态机

- 先写资源 schema、依赖图、状态枚举、错误分类和迁移兼容。
- 为存量任务提供只读迁移：不删除、不覆盖旧记录。
- 验收：单元测试证明顺序门禁和局部重试成立。

### 批次 B：图片生产与 Prompt

- 修正资料卡、头像、大厅、牌桌、五态单图、卡面与特效 Prompt。
- 实现每节点的尺寸/透明/单人物检查。
- 验收：用一个测试角色真实生成到 G3；Agent 打开原图和运行页面截图检查。

### 批次 C：五态动作视频

- 五态分别用对应单图生成；增加 WebM alpha 后处理和真实解码门禁。
- 验收：牌桌完整打一局，检查待机、出牌、不出、胜/负的实际触发与回退。

### 批次 D：逐件换装视频

- 实现 `已批准 outfit-card 的 image_url + 舞蹈参考 video_url + wardrobeManifest → 单条完整演出视频 → poster` 的链路。
- 验收：至少一套含 2–3 个可移除外层 + 1 个不可移除基础层；角色在完整视频中持续跳舞并逐件脱去外层，成片在结算与写真馆成功播放。

### 批次 E：工坊恢复与 UI 验收

- 完成人工 Prompt Patch、打回范围、任务依赖与 revision 界面。
- 验收：刷新、服务重启、Provider 失败、下载失败、人工打回四条路径均可继续；Agent 真实操作并截图检查。

## 8. 最终验收清单

- [ ] 新建计划时不调用 Provider，计划先持久化。
- [ ] 只先生成资料卡，确认前下游为 `BLOCKED_DEPENDENCY`。
- [ ] 资料卡不要求透明，且无法进入任何运行时展示槽。
- [ ] 林星、米娅和新角色保持各自独立身份与服装，不发生素材串用。
- [ ] 新套装不会与已上线套装在主题、主色、轮廓和层级上高度重复。
- [ ] 五态是五张独立图、五条独立视频，分别绑定牌局事件。
- [ ] 五态 WebM 在深浅背景中确有透明效果，不只是存在 alpha 标签。
- [ ] 换装视频中角色持续跳舞并自然逐件脱去外层，末尾仍为完整基础服装。
- [ ] 卡面、poster、视频属于同一 outfit revision，不同卡不共用错误视频。
- [ ] Provider 成功、文件取回、规格合格、人工通过、已晋升是五个不同状态。
- [ ] 有 runId 的超时只继续轮询，不重复创建外部任务。
- [ ] 人工能编辑 Prompt Patch，并选择局部或级联重产。
- [ ] 打回不会覆盖旧任务、旧文件、旧 Prompt 或旧审核记录。
- [ ] 页面刷新和服务重启后仍能恢复计划、任务、修改内容和下一步动作。
- [ ] Agent 已在真实工坊、首页、牌桌、结算演出与写真馆完成操作、截图并打开检查。

## 9. 不允许的捷径

- 不允许拿资料卡、Sprite 总图或动作拼图直接充当头像、立绘或卡面。
- 不允许因 Provider 返回成功就把资源标记为可用。
- 不允许不同角色、不同服装卡默认复用同一张图或同一条视频。
- 不允许通过重命名 MP4 为 WebM 冒充透明视频。
- 不允许失败时静默切换 Provider、模型或 Mock。
- 不允许在用户修改 Prompt 时丢失已成功且仍有效的兄弟节点资源。
- 不允许仅用测试日志或接口 200 宣告完成；必须有真实界面操作与截图证据。
