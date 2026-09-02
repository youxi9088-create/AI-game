# ColorVerse 本地填色游戏

## Linux 生产线部署

线上“输入图片 → 自动生成关卡”需要独立的 FastAPI 容器，而不是让访问者浏览器连接本机 `:5399`。服务端交接、Docker 启动和前端对接步骤见 [docs/linux-level-service.md](docs/linux-level-service.md)。

本地可运行的 React + Vite 填色游戏。浏览器端负责游玩与工坊界面；上传图片自动生成关卡时，会调用本机 FastAPI 服务或配置好的 Linux 生产线服务。

## 本地启动

```bash
npm install
npm run dev
```

浏览器打开终端输出的本地地址即可开始游玩。

项目当前保留两个独立的本地入口：

- `/`：真人线稿 / 用户上传图片生成关卡工坊。
- `/paint.html`：数字涂色画册（Paint by Number），内置关卡、独立存档和作品收藏；画面不显示数字标号。

`npm run dev` 会同时启动前端与本机关卡工坊服务（`127.0.0.1:5399`）。服务基于 FastAPI，只监听本机；只想单独排查关卡生成时，可运行：

```bash
npm run level:service
```

## AIHub 参考图图生图（可选）

真人线框关卡工坊会将用户上传图片作为参考图，通过已安装的 aihub-asset-production Skill 调用 AIHub 即梦 5.0 工作流（run → status → outputs），重绘为 Coloring Book Line Art。凭据只由本机服务读取，不会写入前端。

本地开发可在被 Git 忽略的 `aihub.local.env` 中配置 `AIHUB_AGENT_TOKEN`；线上容器则通过部署平台 Secret 注入同一个 Token。即梦工作流 App ID 已固定在服务端代码中，无需再由部署平台配置。服务会根据参考图比例选择即梦 5.0 的画布规格；可访问 http://127.0.0.1:5399/api/ai-gateway/status 检查本机配置是否已生效。

## 当前已实现

- 默认关卡「林间的幸福」位于 `public/levels/forest-001`：由用户原图生成、60 个连续的 SVG 闭合区域、无方格和无数字标号
- 每次点击一个区域都会填入所选颜色：未填保持黑色线框，正确为绿色边缘，错误为红色边缘；两种结果都不会阻断继续填色
- 点击/拖动填色、调色板、快捷键、缩放和提示
- 填色助力、进度与完成弹窗
- IndexedDB 本地存档和本地画廊
- 「关卡工坊」独立页面：上传 JPG/PNG/WebP 后，以可观察的 10 步流水线完成图片校验、Coloring Book Line Art、线稿加固、质量验收、区域蒙版、色板、关卡包和校验
- 每个步骤的状态均由本地服务返回；完成后可直接进入游戏试玩

## 线稿质量门

区域分割前会执行可解释的线稿验收，避免“流程显示完成、但线稿无法玩”的情况：

- 线条覆盖率（防止照片纹理被当成黑线）
- 画布边缘残线（防止边角黑块和裁切残笔）
- 闭合可填区域数量（防止颜色跨区域蔓延）
- 碎线/噪点密度
- 对已收录基准原图的构图一致性检查

基准样本当前为 `public/ling-ling-garden.png` 与其人工验收的
`public/ling-ling-lineart.png`。当用户再次上传同一张原图，工坊会额外比较
新线稿与这张历史线稿的版式；为保证该样本可稳定复现，系统会直接复用已验收
线稿并明确显示“命中历史验收样本”。其他图片不会使用该样本。任一检查不通过，
流水线停在“验收线稿质量”，不会生成 Mask 或关卡。每次关卡的完整报告都会写入
`lineart_quality.json`；AI 输出还会将工作流来源和质量报告写入 `source.json`。

## 真人照片转关卡

本地 AI 环境首次使用前执行：

```powershell
.\scripts\setup_ai_env.ps1
```

若本机无法自动从 Hugging Face 下载线稿模型，只需下载仓库 `lllyasviel/Annotators` 中的 `sk_model.pth` 与 `sk_model2.pth`（各约 17MB），然后放到：

```text
填色游戏/models/lineart/sk_model.pth
填色游戏/models/lineart/sk_model2.pth
```

无需下载整个 Annotators 仓库；该本地模型目录已被 Git 忽略。

生成时遵循两套数据分离：`lineart.png` 是白底黑线的 **Coloring Book Line Art**，只负责视觉展示；`region_mask.png` / `region_mask_web.png` 是区域 ID Mask，只负责点击定位与填色。前端绝不会实时扫描线稿并洪泛填充，因此不会因人物发丝、草叶或文字缝隙发生颜色蔓延。

## 关卡素材流程

正式关卡文件为 `public/levels/<level-id>/preview.svg`、`outline.svg` 和 `level.json`，索引在 `public/levels/index.json`。导入已有的生成器 SVG 后执行：

```bash
npm run pbn:import -- <preview.svg> public/levels/<level-id> <level-id>
npm run pbn:validate -- public/levels/<level-id>/level.json
```

若需要重新从图片生成 SVG，请先在项目目录外准备一个已构建的 `paintbynumbersgenerator` 检出目录，再设置 `PBN_GENERATOR_DIR`：

```powershell
$env:PBN_GENERATOR_DIR = 'D:\tools\paintbynumbersgenerator'
npm run pbn:generate -- <source-image> public/levels/<level-id> <level-id>
```

随后运行导入和校验命令。生成器仅用于本地隔离制图，未作为本项目运行时依赖。

## 本地生成结果

每次完成生成后，服务会写入 `public/levels/upload-<时间戳>/`，其中含有：

- `preview.png`：原图预览
- `lineart.png`：Coloring Book Line Art 白底黑线稿
- `outline.png`：透明背景的线稿叠层
- `region_mask.png`：16 位区域 ID Mask（本地工具使用）
- `region_mask_web.png`：RGBA 编码的区域 ID Mask（Canvas 点击查询使用）
- `regions.json`：区域 ID、面积、边界框和建议颜色
- `level.json`：可点击区域与调色板
- `verify_fill.png`：自动校验预览
- `source.json`：本次生成的参数记录

这些关卡会立即在当前浏览器中加载。若要把某一关变成固定预制关卡，再将其路径加入 `public/levels/index.json`。

## 后续可扩展

- 登录、跨设备同步与分享链接
- 图生视频完成动画
- 多副本异步队列、跨设备保存与多人协作（当前 Linux 生产线为单实例任务状态）
