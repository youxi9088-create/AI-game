# ColorVerse 填色游戏：AI 实现方案

## 1. 目标与边界

将一张有合法使用权的原创图片，稳定转换为本项目可玩的填色关卡：用户选择色块后点击 SVG 区域完成填色，支持提示、进度、完成态和本地存档。

当前项目已实现 React + Vite 前端、SVG 区域点击、调色板、IndexedDB 存档、预制关卡与本地图片关卡。不要重写现有玩家端交互；本次能力的核心是补齐“图片 -> 高质量不规则区域关卡”的离线生产链路，并为未来云端生成预留安全接口。

### 非目标

- 不在运行时对整张 PNG 做 Canvas 泛洪填充。
- 不把任何模型/API Key 放进 `VITE_*` 或浏览器代码。
- 不使用无授权的影视、动漫、游戏 IP 图片作为正式关卡素材。
- 不把“UI 品牌色”误当作每张关卡的最终填色调色板。

## 2. 唯一推荐的关卡生产链路

```text
原创图片 / 用户授权上传图
  -> （可选）生成或修复线稿
  -> 图片量化、区域分割、SVG 矢量化、色板生成
  -> 校验与人工筛选
  -> level.json + preview.png + outline.png
  -> 现有 React SVG 填色组件
```

### 2.1 线稿阶段：可选，而不是替代分区

当输入是照片、构图复杂或边缘不连续时，先得到黑线、白底、主体清楚且留白较大的线稿。

推荐工具：

- [turn-any-photo-into-a-coloring-book-page](https://github.com/majiayu000/claude-skill-registry/tree/main/skills/creative/turn-any-photo-into-a-coloring-book-page)：用于“照片 -> 填色书线稿”的提示词工作流；它依赖 BetterPrompt CLI，输出仍然只是线稿。
- [OpenAI Image API](https://developers.openai.com/api/docs/guides/image-generation)：未来可在服务端根据提示词生成原创素材，或对已有图片做编辑。
- [AILabTools Photo to Coloring Page API](https://www.ailabtools.com/docs/ai-image/effects/photo-to-line-art/api)：可作为第三方“照片 -> 线稿”备选 API。

线稿验收：黑色边界尽量连续、主体不被切断、无文字/水印、无阴影/大面积灰阶、每个可填色区至少约 16 x 16 像素。失败时回到该阶段重试，不要带着断线进入区域分割。

### 2.2 区域阶段：关卡可玩性的决定环节

必须将图像转为“色板 + 不规则区域 SVG path”，而不只是导出一张线稿 PNG。每个区域必须具备稳定 ID 和正确色板索引，供前端判定对错与保存进度。

优先选用：

- [paintbynumbersgenerator](https://github.com/BenjaminSymons/paintbynumbersgenerator)：Node/TypeScript、支持本地 Web 与 CLI、输出 SVG；与当前 Vite/TypeScript 项目最贴近，优先做技术验证。

批量/精细化备选：

- [PbNgen](https://github.com/scottvr/pbngen)：Python 工具，支持颜色量化、区域切分、难度预设、标签、PNG/SVG/色板输出；适合批量生产和控制简单/普通/困难关卡。

不要同时把两个生成器都并入正式流水线。先用 `paintbynumbersgenerator` 做一张真实样图验证；若区域质量或难度控制不足，再选择 PbNgen 作为唯一生产工具。

## 3. 产物契约

每个正式关卡保存到 `public/levels/<level-id>/`，必须包含：

```text
public/levels/<level-id>/
  preview.png          # 完成态预览图
  outline.png          # 黑白线稿覆盖层
  level.json           # 前端唯一读取的关卡定义
  source.json          # 来源、作者、使用权、生成参数、审核记录
```

`level.json` 的最低结构必须与现有 `Level`/`Region` 类型兼容：

```json
{
  "id": "forest-001",
  "title": "林间的幸福",
  "subtitle": "原创图片生成的普通难度关卡",
  "difficulty": "普通",
  "viewBox": "0 0 640 480",
  "palette": ["#F6B3B6", "#82B174"],
  "regions": [
    {
      "id": "r-0001",
      "color": 0,
      "shape": { "kind": "path", "d": "M...Z" }
    }
  ],
  "preview": "/levels/forest-001/preview.png",
  "outline": "/levels/forest-001/outline.png"
}
```

硬性规则：

1. `regions[].id` 永不因重新打开关卡而变化；这是存档键。
2. `regions[].color` 必须是 `palette` 的零基索引。
3. SVG 路径不可自交；每个可见区域只能绑定一个 ID。
4. 小到难以点击的区域必须合并、删除或标记为自动填色，不能交给玩家。
5. `source.json` 必须记录输入来源和商用/授权状态，不能只保存生成后的图片。

## 4. 建议新增的离线脚本

仅在确认生成器后实现，不在玩家浏览器运行。

1. `scripts/generate_pbn_level.mjs` 或 `scripts/generate_pbn_level.py`
   - 输入：原创图片、目标难度、色数、输出目录。
   - 调用选定的 PBN 生成器。
   - 输出：中间 SVG、量化预览、色板。

2. `scripts/import_pbn_svg.mjs`
   - 解析生成器 SVG 的 path、fill 和 viewBox。
   - 规范化 path，按稳定顺序分配 `r-0001` 等 ID。
   - 生成符合第 3 节的 `level.json`。
   - 不得依赖 DOM 或浏览器 API。

3. `scripts/validate_level.mjs`
   - 检查路径数量、色板索引、重复 ID、无效路径、过小区域、文件是否存在。
   - 输出机器可读 JSON 和人可读摘要；有错误时返回非零退出码。

推荐的难度初始阈值（后续以试玩数据调整）：

| 难度 | 色数 | 区域数 | 最小区域面积 |
| --- | ---: | ---: | ---: |
| 简单 | 4–6 | 25–60 | 约 0.25% 画布面积 |
| 普通 | 6–10 | 60–150 | 约 0.10% 画布面积 |
| 困难 | 10–16 | 150–300 | 约 0.04% 画布面积 |

## 5. 前端接入方式

现有 `app/App.tsx` 已采用 SVG `path`、点击/拖动事件、按区域存档和 `paintedColors`。接入正式关卡时：

1. 新增一个关卡清单 JSON 或在启动时扫描固定的 `public/levels` 清单。
2. 将每份 `level.json` 读取为现有 `Level` 类型，不复制一套 Canvas 填色引擎。
3. 保持 `region.id` 和 `level.id` 不变，确保旧 IndexedDB 存档仍可恢复。
4. 缩放后仍以 SVG 原生命中测试点击路径；不要换为像素坐标猜测。
5. 最终完成图继续复用 `preview.png`，线稿叠层继续复用 `outline.png`。

若未来需要自由画笔、橡皮擦、多图层或高阶手势，才评估 [Konva](https://github.com/konvajs/konva)。当前的点选填色玩法无需为此引入新画布框架。

## 6. 云端生成（第二阶段，不是第一阶段）

只有确认需要“用户在线生成原创关卡”时，新增顶层 `api/` 服务端接口，例如：

```text
POST /api/generate-level
  -> 校验用户图片、文件大小与请求频率
  -> 内容安全与版权提示
  -> 调用图像/线稿 API（密钥只存在服务端）
  -> 投递 PBN 分区任务
  -> 返回 taskId

GET /api/generate-level?id=<taskId>
  -> 返回 pending / succeeded / failed 与关卡地址
```

服务端职责：保存凭据、限流、异步任务、文件存储、内容审核、生成记录。浏览器职责：上传、轮询、展示进度、读取最终 `level.json`。不可把 OpenAI、AILab 或其他供应商密钥写入前端。

## 7. 色彩类 Skill 的使用边界

- [algorithmic-color-palette](https://github.com/majiayu000/claude-skill-registry/tree/main/skills/design/algorithmic-color-palette)：用于生成 UI CSS Token（按钮、hover、完成态、焦点态、模态层、灰阶）。值得采用。
- [color-palette-generator](https://github.com/majiayu000/claude-skill-registry/tree/main/skills/other/color-palette-generator)：用于设计评审时给出可读的色板提案；不作为关卡调色板生成器，也不直接接入运行时代码。
- [color-correction](https://github.com/majiayu000/claude-skill-registry/tree/main/skills/other/color-correction)：依赖 ComfyUI 的 `analyze_color`，仅在源图明显偏色、低对比或曝光异常时由美术/内容制作流程使用；不接入游戏端。

## 8. 实施顺序与验收

### Phase A：一张真实样图验证

1. 选一张有明确授权的图片。
2. 使用 `paintbynumbersgenerator` 生成 SVG 与色板。
3. 编写最小 `import_pbn_svg`，导入为一份 `level.json`。
4. 在现有游戏中加载并完成整张关卡。

验收：能在桌面和触屏环境点击/拖动填色；所有区域可完成；刷新后进度恢复；没有不可点击的小区块；输出不含未授权素材。

### Phase B：质量与难度控制

1. 加入 `validate_level`。
2. 用 3 张不同复杂度图片测试简单/普通/困难。
3. 记录区域数、最小区域、完成时间、失败点击和用户反馈。
4. 只有在 Node 生成器无法控制质量时，再评估切换为 PbNgen。

验收：每个难度的区域数和色数落在预设范围；构图主体可辨；输出可重复生成并可追溯。

### Phase C：云端能力（可选）

仅在本地生产链路稳定后，加入后端任务接口和图像 API。上线前必须做：密钥隔离、上传限制、内容审核、任务超时、费用限额、失败可重试与授权记录。

## 9. 给编码 AI 的执行约束

1. 先完成 Phase A 的只读技术验证和一张样图，不要一次引入多个生成器或云 API。
2. 开始改动前，说明计划修改的文件、生成器选择和验收命令。
3. 所有新脚本必须可在 Windows PowerShell 执行，并以 UTF-8 读写 JSON。
4. 不修改或破坏现有 `Level`、IndexedDB 存档和预制关卡的兼容性。
5. 每次导入关卡后运行校验，并在浏览器中完成一次真实试玩再交付。
6. 引用的开源仓库在引入前必须复核其 LICENSE、依赖安全性和维护状态。
