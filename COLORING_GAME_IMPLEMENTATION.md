# ColorVerse 填色游戏实现方案

> 版本：2026-09-02
> 适用范围：当前 `E:\IP项目\填色游戏` 本地工程的**真人线框填色模式**。
> 本文描述已经存在于代码中的能力，并将“用户上传图片 → 自动生成可玩关卡”的 10 步生产线拆解为可验证的技术动作。

## 1. 目标与玩法边界

本项目不是把图片切成方格的数字填色，而是将一张用户图片变成可自由涂色的真人线框关卡：

```text
用户原图
  → Coloring Book Line Art（白底黑线）
  → Region Mask（不规则区域 ID 图）
  → 浏览器按坐标查询区域 ID
  → 玩家选色并点击填色
  → 正确：绿色边缘；错误：红色边缘；两者均可再次修改
```

关键约束：

- 画布只展示黑色线稿，不展示方格。
- `lineart.png` 只负责视觉呈现；`region_mask*.png` 才是点击和填色的唯一依据。
- 不在浏览器对线稿做 Flood Fill。这样即使草叶、发丝或文字存在细缝，颜色也不会跨区域蔓延。
- 目标是每张关卡都有一张完成效果参考图，供玩家在画布左侧对照配色。AI 线稿导入和官方示例已经满足；主上传链路的差异见第 7 节“当前待补齐项”。
- 线稿不能通过质量门时，停止在第 5 步，不产出不可玩的关卡。

## 2. 当前系统组成

| 层级 | 当前模块 | 职责 |
| --- | --- | --- |
| 前端游戏与工坊 | `app/App.tsx` | 上传、展示 10 步流水线、轮询任务、加载关卡、区域点击、存档、画廊和重命名。 |
| 浏览器参考图上传 | `api/ai-reference.ts` | 将用户参考图上传到 FN CS，返回 AIHub 服务端可访问的临时 URL。这里不接触 AIHub 密钥。 |
| 本地编排服务 | `scripts/level_service.py` | FastAPI，默认仅监听 `127.0.0.1:5399`；创建异步任务、更新步骤状态、调用线稿和关卡生成器。 |
| AIHub 网关 | `scripts/ai_gateway.py` | 读取环境变量 `AIHUB_AGENT_TOKEN`；通过已安装 `aihub-asset-production` 的 AppId 注册表调用 AIHub 即梦 5.0。 |
| 本机线稿后备 | `scripts/coloring_book_lineart.py` | 使用 `controlnet_aux.LineartDetector`、Torch 和 `lllyasviel/Annotators` 权重生成线稿。 |
| 图像预处理 | `scripts/subject_preprocess.py` | OpenCV 人脸/中心主体保护、GrabCut 前景细化、背景量化，用于高纹理真人照片。 |
| 线稿加固与质量门 | `scripts/lineart_reinforcement.py`、`scripts/lineart_quality.py` | 断线闭合、噪点清理、边缘检查和可填区域验收。 |
| 区域与关卡生成 | `scripts/generate_level_v2.py` | 原图色彩分区 + 线稿边界约束，输出 Mask、SVG 区域、调色板和完成效果。 |
| 关卡校验 | `scripts/level_validator.py` | 校验文件完整性、Mask 编解码、区域连通性、最小点击面积、色板和尺寸。 |

## 3. 两条进入生产线的入口

### A. 用户上传真实图片：主生产线

这是关卡工坊的主要路径。前端会保留两份输入：

1. 图片二进制直接发送给本机服务，作为原图预览、色板来源和区域色彩依据。
2. 同一张图先上传到 FN CS，得到公网 `reference_url`，供 AIHub 服务端执行图生图线稿重绘。

调用关系：

```text
App.tsx
  ├─ POST FN /api/ai-reference       → api/ai-reference.ts → FN CS
  └─ POST 127.0.0.1:5399/api/generate-level?reference_url=...
       └─ level_service.py → ai_gateway.py → AIHub 即梦 5.0
```

如果没有可用的 `reference_url`，本机服务仍可走 `controlnet_aux.LineartDetector` 后备路径；这条路径不依赖 AIHub，但通常比图生图更难得到简洁的真人线框效果。

## 4. 主生产线：10 步逐项说明

前端的步骤定义位于 `app/App.tsx` 的 `EMPTY_PIPELINE`，服务端同一套定义位于 `scripts/level_service.py` 的 `PIPELINE_STEPS`。任务由 `POST /api/generate-level` 创建，前端以 `GET /api/jobs/{jobId}` 轮询并逐步显示状态。

| 步骤 | 页面显示 | 实际调用与能力 | 输入 → 输出 | 成功条件 / 失败处理 |
| --- | --- | --- | --- | --- |
| 1 | 接收并校验图片 | 前端 `onUpload` 检查 JPG/PNG/WebP、大小；`App.tsx` 的 `uploadAiReference()` 调 FN `api/ai-reference.ts`；FastAPI 再校验请求体。 | 用户文件 → 原始字节 + FN CS `reference_url`。 | 前端限制 10MB，服务端上限 15MB；格式错误、空文件、上传失败立即停止。 |
| 2 | 预处理画面 | `level_service.make_level()` 统一用 Pillow 解码并保存 PNG；`analyse_source_for_lineart()` 用 OpenCV Canny 边缘密度和灰度对比度判断是否为高细节照片。若高细节且有 `reference_url`，调用 `preprocess_reference_for_lineart()`。 | 原图 → 标准 PNG；必要时生成 `reference_preprocessed.png`。 | 高纹理图进入“主体保护 + 背景归纳”策略；标准图保留原始构图。原图始终不被改写。 |
| 3 | 生成填色线稿 | 优先：`ai_gateway.generate_lineart()` 调 AIHub 即梦 5.0 图生图。通过 `aihub-asset-production` 的 AppId 注册表解析 `jimeng` 工作流，依次调用 `POST /workflows/run` → `GET /runs/{id}` 轮询 → `GET /outputs` 下载 PNG。后备：`coloring_book_lineart.create_lineart()` 调 `controlnet_aux.LineartDetector`（Torch，CPU/CUDA）。 | 参考图或原图 → `lineart.png` 白底黑线稿。 | 对“林间的幸福”同一基准原图，先命中人工验收线稿并复用，以保证回归稳定。AI 图生图若第一候选不合格，可用同一原图自动重跑一次强简化提示词。 |
| 4 | 加固线稿边界 | `lineart_reinforcement.reinforce_lineart()`：双边滤波、阈值转纯黑笔触、移除角落残线、3px 形态学闭运算补小断线、轻微膨胀统一笔触、连通域过滤碎点。AIHub 路径在 `ai_gateway.py` 内执行；本机 LineartDetector 路径在 `coloring_book_lineart.py` 内执行。 | 原始候选线稿 → 可分割的连续线稿。 | 只做保守像素处理，不凭空添加物体。若线条过密或边缘残线异常，AIHub 还会尝试更保守的阈值候选并选质量最好的一个。 |
| 5 | 验收线稿质量 | `lineart_quality.evaluate_lineart()`：OpenCV 连通域、边缘覆盖率、可填留白统计；基准图额外算线稿版式相关性。 | 加固线稿 → `lineart_quality.json` 与可解释质量报告。 | 线条覆盖率 0.45%–12%；画布边缘墨线 ≤ 5.5%；闭合可填区域 ≥ 12；碎线 ≤ 260 个/百万像素。任一失败即抛出 `LineartQualityError`，后续第 6–10 步不执行。前端展示失败原因和适合的图片建议。 |
| 6 | 划分主要区域 | `generate_level_v2.generate_level()`：Pillow 将画布缩放到工作宽度 1200；将原图转 Lab；自实现 SLIC 生成超像素；相邻超像素按 Lab 色差聚合；将第 3 步线稿二值化并膨胀为不可跨越的“墙”；按难度自适应调整合并阈值。 | 彩色原图 + 通过验收的线稿 → 连通、不跨线的区域标签图。 | 目标块数：简单 25–70，普通 45–130，困难 80–240；过小区域会合并到邻区，但受黑线明确围住的小区域会被保护。 |
| 7 | 提取专属调色板 | 在 `generate_level_v2.py` 内，对每个区域计算原图平均 RGB；按面积加权 K-Means 聚类成色板。 | 区域均值色 → `palette` 与每块的目标 `color` 索引。 | 简单 8 色、普通 14 色、困难 18 色；颜色来源是用户原图而非线稿，因此可生成真实的完成效果参考。 |
| 8 | 整理可点击区域 | `generate_level_v2.py` 先对区域做 Moore 邻域轮廓追踪，再用 Douglas–Peucker 简化成 SVG `path`；同时给每个区域稳定 `maskId`、内部标签点、面积、边界框和目标颜色。 | 区域标签图 → `regions.json` + `level.json.regions`。 | 每块都有稳定 ID、单一连通域、可点击面积；界面“显示数字”时使用区域 `label` 位置叠加编号。 |
| 9 | 打包本地关卡 | `generate_level_v2.py` 写入关卡目录；`level_service.py` 补充来源、授权和质量记录。 | 内存数据 → `public/levels/upload-<时间戳>/` 下完整关卡包。 | 产物包括 `preview.png`、`lineart.png`、`outline.png`、`region_mask.png`、`region_mask_web.png`、`regions.json`、`level.json`、`verify_fill.png`、`source.json`、`lineart_quality.json`。 |
| 10 | 校验关卡 | `level_validator.validate_level()` 读取所有产物，比较尺寸、Mask ID、RGBA 编码、区域连通性、最小面积、调色板索引和授权记录。 | 完整关卡目录 → `level_validation.json` + 任务结果。 | `region_mask_web.png` 的 R/G 通道必须能无损还原 16 位 Mask；所有登记区域都必须存在且可点。通过后前端显示线稿预览、完成参考图并允许“确认并进入填色”。 |

## 5. 第 2 步和第 3 步的 AI / CV 能力细节

### 5.1 高细节图片的预处理

当输入照片边缘密度高，系统不直接把绿植、头发、桌面纹理交给模型逐笔描摹，而是在本机先生成一张**仅供 AIHub 参考**的简化图：

1. OpenCV Haar Cascade 检测人脸；无人脸时保护中央主体区域。
2. 将保护区扩展到上半身，必要时用 GrabCut 细化前景。
3. 对背景执行 `pyrMeanShiftFiltering` 和 8 色 K-Means 量化。
4. 保护主体与量化背景混合，保存为 `reference_preprocessed.png`。
5. 原图继续作为第 6、7 步的区域色彩来源，因此不会因背景简化而丢失最终配色。

这一步当前不是 SAM/人像分割模型；它是可本机运行、可解释的 OpenCV 方案。未来接入并验收 SAM 后，可以替换主体 Mask 实现，而不改变上下游接口。

### 5.2 Coloring Book Line Art 生成约束

`scripts/ai_gateway.py` 在提示词后自动追加约束，而不是把普通“黑白图片”直接当作填色线稿：

- 纯白背景、纯黑且圆润的统一笔触。
- 主物体和意图填色区域必须闭合。
- 保留人物/宠物/姿势/构图和关键前景物。
- 高细节真人照片只保留少量背景轮廓，禁止逐一描摹叶片、发丝、键盘、线缆、阴影等。
- 禁止网格、数字、水印、灰阶、明暗、排线、颗粒、草稿笔触和画布黑边。

因此，**AIHub 即梦 5.0 是当前正式的优先线稿生成能力**；`LineartDetector` 是本地模型后备。当前运行时未接入 ComfyUI、ControlNet 扩散工作流或 SAM；不要把它们写成已部署能力。

## 6. 质量门、自动重试与面向用户的失败说明

### 6.1 质量门检查项

| 指标 | 当前阈值 | 避免的问题 |
| --- | --- | --- |
| 线条覆盖率 | 0.45%–12% | 低于下限表示轮廓太少；高于上限表示照片纹理被描成黑线。 |
| 边缘墨线覆盖率 | ≤ 5.5% | 防止边框、裁切残笔、角落黑块。 |
| 闭合可填区域数 | ≥ 12 | 防止断线造成点击后颜色泄漏。 |
| 碎线密度 | ≤ 260 个/百万像素 | 防止铅笔颗粒、虚线和噪点造成大量无效小块。 |
| 基准构图相关性 | 仅匹配基准图时 ≥ 0.90 | 防止同一输入被模型重绘成另一种构图。 |

### 6.2 自动重试边界

- 有 AIHub 参考图的用户上传：最多 2 个候选。第 2 次不更换原图、模型或玩法，只加强“保留主体、背景强简化、优先闭合区域”的提示词。
- 同一“林间的幸福”基准输入：不随机重绘，直接复用人工验收线稿。
- 本机 LineartDetector 后备：当前没有模型级自动重试；质量失败会明确返回，建议改用 AIHub 路径或更适合的源图。
- 所有候选仍使用同一个质量门，重试不会放宽阈值。

### 6.3 用户应该看到的提示

失败时前端展示 `userMessage` 与 `inputAdvice`，而不只显示“失败”。推荐输入类型是：

- 1–3 个主体，主体占画面约三分之一以上。
- 光线均匀、主体轮廓明确，画布边缘留出少量空白。
- 可使用真实照片，但应尽量减少密集树叶、草地、毛发特写、桌面杂物、强水彩纹理、复杂文字、水印和黑色边框。

## 7. 关卡产物与数据契约

一次成功任务的目录：`public/levels/upload-<时间戳>/`。

| 文件 | 用途 | 消费方 |
| --- | --- | --- |
| `preview.png` | 原图预览 | 画廊、工坊回顾。 |
| `lineart.png` | 白底黑线的 Coloring Book Line Art | 主画布视觉底图。 |
| `outline.png` | 透明底黑色线稿层 | 填色图层上方，保证未填区域保持黑线。 |
| `region_mask.png` | 16 位区域 ID Mask | 本地校验与离线工具。 |
| `region_mask_web.png` | R=低 8 位、G=高 8 位的 Web Mask | 浏览器 Canvas 坐标 → 区域 ID 查询。 |
| `regions.json` | 区域元数据：面积、边界框、中心点、默认色 | 审核、调试、后续编辑器。 |
| `level.json` | 游戏关卡数据：标题、难度、色板、区域、资源地址 | 前端加载关卡。 |
| `verify_fill.png` | 全部按目标色填完的完成效果 | 工坊审阅和玩家左侧参考图。 |
| `source.json` | 来源、参数、授权与 AI 参考地址 | 追溯与审计。 |
| `lineart_quality.json` | 线稿质量门完整报告 | 前端展示、回归排查。 |
| `level_validation.json` | 最终关卡产物校验报告 | 发布前验收。 |

其中 `lineart.png` 和 Mask 必须同尺寸；`region_mask_web.png` 必须能还原为 `region_mask.png`。这是“可以看到线稿，却无法点击填色”问题的首要排查契约。

### 当前待补齐项：主上传链路的左侧完成参考图

主上传链路的 `generate_level_v2.py` 已生成 `verify_fill.png`，它就是“所有区域按目标色填完”的完成效果；但它尚未同时写出 `reference.png` 和 `level.json.reference`。`App.tsx` 当前的读取逻辑是 `level.reference ?? level.preview`，因此这条路径在游戏左侧会退回显示原图 `preview.png`。

要让所有关卡一致满足“左侧显示完成参考图”，应作为一个小的 P0 收口改动完成：

1. 在 `generate_level_v2.py` 生成 `verify_fill.png` 时同步写出 `reference.png`（可直接使用同一张图）。
2. 在输出的 `level.json` 加入 `reference: /levels/<level-id>/reference.png`。
3. 在 `level_validator.py` 将 `reference.png` 加入真人线框主链路的必需产物，并校验尺寸一致。
4. 保持前端的 `level.reference ?? level.preview` 兼容逻辑，以便历史关卡仍能打开。

官方示例“甜点猫咪派对”已按上述契约提供 `reference.png`，可作为主上传链路补齐后的对照实现。

## 8. 前端填色运行机制

`app/App.tsx` 的 `MaskColorCanvas` 加载 `region_mask_web.png` 到离屏 Canvas，并在内存中构建：

```text
鼠标 / 手指坐标
  → 换算为 Mask 像素坐标
  → 解码 R + G × 256 得到 maskId
  → 查 level.json 中的 Region
  → 写入所选颜色
  → 重绘该 Region 的所有 Mask 像素
```

渲染规则：

- 未填色：显示 `outline.png` 的黑色线框。
- 选择颜色本身：不对线稿提供额外反馈。
- 点击区域：无论颜色是否正确都填入颜色。
- 正确颜色：该区域边缘渲染绿色。
- 错误颜色：该区域边缘渲染红色；玩家可立即换色再点击覆盖。
- 存档：进度、已填颜色、关卡名称、调色板扩展和“显示数字”偏好保存在 IndexedDB。

## 9. 难度定义

| 难度 | 目标色数 | 目标区域数 | 最小可点击面积 |
| --- | ---: | ---: | ---: |
| 简单 | 8 | 25–70 | 120px |
| 普通 | 14 | 45–130 | 80px |
| 困难 | 18 | 80–240 | 45px |

难度不是简单地把图片切得更碎：第 6 步会一起调整 SLIC 初始段数、Lab 合并阈值与最小区域比例，并受线稿边界约束。

## 10. 接口、运行方式与依赖

### 10.1 本地接口

| 接口 | 用途 |
| --- | --- |
| `POST /api/generate-level?title=&difficulty=&reference_url=` | 创建用户图片 → 真人线框关卡任务，返回 `jobId`。 |
| `GET /api/jobs/{jobId}` | 查询 10 步流水线状态、质量报告、校验报告和产物地址。 |
| `GET /api/health` | 检查本机 FastAPI 服务与 AIHub 配置状态。 |
| `GET /api/ai-gateway/status` | 检查是否已读取 AIHub Token 和 Skill 注册表。 |

### 10.2 运行命令

```powershell
Set-Location 'E:\IP项目\填色游戏'

# 首次仅需复制模板，再在 aihub.local.env 填写公司分配的 Token。
Copy-Item aihub.local.env.example aihub.local.env

# 同时启动 Vite 前端与 127.0.0.1:5399 本机关卡服务
npm run dev

# 访问健康检查
Start-Process 'http://127.0.0.1:5399/api/health'

# 构建前端
npm run build

# 对单个关卡做产物校验
npm run level:validate -- public/levels/upload-<时间戳>
```

`aihub.local.env.example` 会随 Git 提交；真实 Token 填入被 Git 忽略的 `aihub.local.env`，本机服务启动后会自动读取。生产环境应改为注入服务环境变量。 本机模型后备需要 Python 环境中的 Pillow、NumPy、OpenCV、Torch、`controlnet_aux`；首次执行可运行 `scripts/setup_ai_env.ps1`。`sk_model.pth` 与 `sk_model2.pth` 可放到 `models/lineart/`。AIHub 路径不要求安装 ComfyUI 或下载扩散模型到本机。

## 11. 已实现与下一阶段边界

### 已实现

- 用户上传图片到可见的 10 步流水线。
- AIHub 即梦图生图优先、本地 LineartDetector 后备。
- 线稿加固、质量门、同图一次自动重试、用户可理解的失败原因。
- 不规则 Region Mask、区域点击、正确/错误非阻断反馈、撤销、缩放、助力、参考图、画廊与本地存档。
- 官方示例“甜点猫咪派对”：`public/levels/cat-coloring-book-001/`，带线稿、Mask、8 色完成参考图和 70 个区域。

### 尚未实现 / 不应误认为已上线

- SAM / 人像分割模型：当前是 OpenCV 主体保护与 GrabCut，不是 SAM。
- ComfyUI / ControlNet 扩散工作流：当前没有作为运行时服务；仅使用 `controlnet_aux.LineartDetector` 本机后备和 AIHub 即梦工作流。
- 云端异步队列、长期任务持久化、跨设备任务恢复：本地 FastAPI 的 `JOBS` 是进程内内存。
- 登录、跨设备同步、分享、多人协作和线上生成 worker：不属于当前本机生产线。

## 12. 推荐验收清单

1. 上传一张主体清晰的照片，确认 UI 依次完成 10 步。
2. 在第 5 步确认质量门通过，并查看线条覆盖率、闭合区域数和重试信息。
3. 确认第 9 步目录内同时存在 `lineart.png`、两种 Mask、`verify_fill.png`、质量报告与校验报告。
4. 进入游戏后确认：左侧有完成参考图，主画布只有黑线、无方格。
5. 任选一色点击区域：颜色始终填入；正确绿边，错误红边；错误区域可再次点击改正。
6. 执行 `npm run level:validate -- <关卡目录>`，结果必须为 `passed: true`。
