# 主题定制空当接龙 MVP

这是按《主题定制空当接龙 MVP Agent 实现技术设计文档 V1.0》开发的本地可试玩 MVP。它把经典 FreeCell 运行时和主题生成/应用路径隔离：游戏只消费经过质量校验的 `ThemePackage`，主题失败不会阻止继续玩经典主题。当前成熟度是“三个阶段均已通过本地目标环境闸门”，但仍不是生产发布完成版。

## 启动

需要 Node.js 24+（API 使用内置 `node:sqlite`）：

```powershell
cd 'E:\AI改编游戏\空当接龙'
npm run dev
```

打开 `http://localhost:4173`。

## 已实现的可玩闭环

- 首页、游戏、主题工作台、主题库和设置。
- 52 张全明牌、8 列（前四列 7 张、后四列 6 张）、4 自由单元、4 同花色回收堆；编号 1–1,000,000 使用 Microsoft FreeCell 兼容的 LCG 与“抽取剩余牌”发牌过程。
- 点击/拖拽移动、双击自动移动、提示、保守自动收牌、编号发牌、新局、重置本局、撤销/重做（含刷新后时间线恢复）、浏览器本地保存恢复与胜利结算。
- 自定义多牌规则：只要牌组异色递减且目标列合法，点击或拖拽连续牌组最上方的第一张牌即可整体移动；不受空自由单元和空列数量限制。自由单元仍可用于暂存单牌。
- “新局”会生成不同的随机牌局；输入编号后点击“重置本局”，可从该编号的初始发牌重新开始。
- 无合法移动时显示停滞状态，方便玩家撤销或重开。
- 主题库默认展示已验收的“翡翠牌室”和“冰爽红白餐厅”；新主题通过一句话请求进入服务端任务编排，合格结果可继续晋升为内置主题。支持测试 Mock、OpenAI 或 AIHub Provider、质量门、品牌诉求原创改写说明和 S6 原子主题应用。
- 生成主题默认携带全套牌面资产：13 个 A-K 点数字形、4 个花色符号、12 张 J/Q/K 头牌插画，加上桌面背景与牌背共 31 项；单项失败只回退该项为程序化字形，不拖累整主题。
- 主题风格（classic/diner/cyber/ink）决定整套视觉语言：牌的形状（标准圆角 / 42px 圆胖胶囊 / 八角切角 / 不对称圆角）、空位与 HUD 的圆角、桌布纹理（波点 / 网格 / 晕染）、字体与头牌画风；工具栏和统计卡会透出主题背景纹理。
- 主题库支持从服务端恢复历史生成主题（换浏览器或换端口后一键拉回）与删除生成主题（本地和服务端存档同步移除，内置主题受保护）。
- “翡翠牌室”已接入真实生成的牌桌背景和牌背样本；点数、花色、牌面命中区继续由程序绘制，主题资源不会遮挡核心判断。
- 主题质量检查保留在主题工作台和自动化合同测试中，不再向普通玩家提供独立检查器页面。

## 主题契约边界

`app/core/theme-contract.js` 维护版本、色彩、资产、七层、包体、红黑 CIEDE2000 色差和可读性质量门；`app/core/freecell.js` 不读取 Prompt 或 Provider 数据。主题切换会先快照当前局面，预载并解码全部图片，再把 ThemePackage 元数据写入 IndexedDB、静态资源写入 Cache API（不可用时回落 localStorage），最后一次性提交。任一资源失败都会回滚，牌局、步数和用时保持不变。

## 本地主题服务与真实 AIHub / OpenAI 适配

```powershell
npm run api
```

服务监听 `http://127.0.0.1:4174`，以 Fastify + SQLite 提供 `POST /v1/theme-jobs`、`GET /v1/theme-jobs/:id`、`GET /v1/themes/:id`、不可变图片资源与 `/health`。前端创建任务并轮询真实阶段；刷新工作台后会继续查询未完成任务。真实 Provider 失败时默认将任务标记为失败，不伪装成本地降级成功；S6 失败时仍保留旧主题和当前牌局。

当前本地验收使用与 `hidden-object-web` 相同的内部文本网关与 AIHub 图片工作流。该命令只读取参考工程已有的 `.env`，不会把密钥复制进本项目：

```powershell
npm run dev:aihub
```

默认地址为 `http://127.0.0.1:4283/?apiPort=4284#studio`。文本阶段走 OpenAI-compatible 网关，图片阶段用 `jimeng` 并行生成横向桌面背景和正方形牌背；每项保存 AIHub `runId`、来源、格式、字节数和 SHA-256，下载校验后才进入 ThemePackage。

默认目标为 OpenAI 真实流水线；缺少凭证时主题工坊会明确显示“未连接”并禁用生成，不再用 Mock 冒充成功。只在服务端设置以下环境变量；文本模型不提供猜测默认值，必须填写账号实际可用的模型：

```powershell
$env:THEME_GENERATOR_MODE='openai'
$env:OPENAI_API_KEY='你的服务端密钥'
$env:OPENAI_TEXT_MODEL='你的可用文本模型'
$env:OPENAI_IMAGE_MODEL='gpt-image-2'
npm run dev
```

只有自动化测试需要 Mock 时才显式设置 `THEME_GENERATOR_MODE=mock` 和 `ALLOW_MOCK_THEME_UI=1`。正常运行不会自动降级为伪生成。

文本阶段调用 Responses API 的严格 JSON Schema 输出；图片阶段分别生成低干扰桌面背景和牌背纹样，保存为按 SHA-256 命名的不可变 PNG。密钥不会写入 ThemePackage 或浏览器存储。也仍支持 `THEME_PROVIDER_URL` + `THEME_PROVIDER_TOKEN` 的外部 ThemePackage Provider。

## Oracle

```powershell
npm run oracle -- 1
```

该命令会产生标准 fc-solve 局面并调用 `FC_SOLVE_BIN`（默认 `fc-solve`）。本机未安装该可执行文件时，会明确报告 `available: false`，不会捏造解题结论。

## 验证

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run release:preflight
```

当前工作树已验证：30 条 Node 测试（规则、非法移动不变性、100 个编号、50 次移动撤销、11 个主题合同样本/20 条提示词质量门、52 张牌合成、两套主题库真实资源的哈希与包体、SQLite 任务 API、真实 Provider 未配置阻断、上游签名地址不下发、OpenAI/AIHub 请求合同、默认禁止伪降级、显式失败降级、oracle 输入/缺失可执行文件降级），以及 24 条 Chrome Playwright 路径（六步保存恢复、真实 API 轮询、任务刷新恢复、Mock 通道显式标识、键盘与双击移动、新局/重置、胜利弹层、`659363` 视觉基线、1280/4K 牌角可读性、检查器入口与旧路由清理、二进制资源预载、失败回滚、导航历史、44px 目标、焦点、非法编号恢复、两套已验收主题的应用与持久化、牌面图片资产渲染、主题库服务端恢复与删除）。浏览器验收使用独立的 `4273/4274` 端口，防止误复用其他本地项目。

## 外网部署要点

- `docker compose up` 或 `npm run dev` 启动完整前端 + 主题 API；`.data/`（SQLite 与生成资产）不进入镜像和仓库。
- 主题生成需要配置真实 Provider（OpenAI 或内部 AIHub）环境变量，参考 `.env.example`；未配置时主题工坊明确显示“未连接”并禁用生成，经典玩法不受影响。
- AIHub 模式依赖内部网关（`ai-gateway.aiae.ndhy.com`）与 AIHub 图片工作流，仅适用于可访问该内网的部署环境；公网部署建议配置 OpenAI Provider 或外部 `THEME_PROVIDER_URL`。
- Provider 侧内置品牌/IP 黑名单（含迪士尼、任天堂等常见 IP 词），命中后自动改写为抽象氛围描述；生成资产仍建议在发布前人工复核。
- 内置主题资产来源与第三方声明见 `ASSET_LICENSES.md` 与 `THIRD_PARTY_NOTICES.md`。

## 仍依赖外部条件的生产门禁

阶段三已用真实文本网关和 AIHub 图片工作流完成一次“输入 → ThemeSpec → 两张图片 → 质量门 → 浏览器预览 → 应用牌局”验收。生产发布仍缺对象存储、配额/费用监控、任务恢复 worker、OCR/alpha 边缘检测、Firefox/WebKit、可用 `fc-solve` 与 Docker 实机验证。文档要求的 pnpm Monorepo + TypeScript + React/Phaser 也尚未迁移，是明确的架构偏差。
