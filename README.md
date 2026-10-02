# 换装斗地主 MVP

本项目根据《变装斗地主 MVP—Agent 实现技术设计文档 V1.1》交付一个可在本机试玩的、无外部 AI 密钥依赖的产品切片。它是 Web PC 单机 NPC 斗地主；角色均为明确的成年外观纯虚构角色，Token 没有现金、转赠、兑换或押注价值。

## 启动

```bash
cd <项目根目录>
npm install
npm run dev
```

打开 `http://127.0.0.1:4173`。进入牌局，叫分后正常出牌；胜利后查看演出 → 揭晓写真卡 → 选择已解锁服装、底色和滤镜 → 定格收藏。写真馆支持重新搭配和导出 PNG。牌局轮数由实际出牌决定。

0.9.0-rc.1 的范围和验收记录见 [迭代说明](docs/COLLECTION_AUDIO_ITERATION.md)；发布、停服备份和恢复命令见 [发布操作说明](docs/RELEASE_OPERATIONS.md)。

## 已实现的可玩路径

- 大厅 → 叫分 → 服务端校验合法出牌 → 官方牌友的静态台词/动作反馈 → 胜负结算。
- 结算四阶段：胜负 → 败方变装演出 → 首次服装×舞蹈翻卡 → 写真馆/再开一局。
- 三位官方牌友：林星、米娅、银岚。林星、米娅和银岚都有独立入场演出；林星有三段、米娅有三段、银岚有两段独立竖屏写真视频（赢局解锁，卡册以 3:4 信箱式呈现）。每张动态写真卡绑定自己的舞片，银岚的入场片不会复用其写真视频。林星与米娅均有身份、审核记录、动作包、台词包、预设备轨和 L2 降级；银岚有独立 L1/L2 镜头和录像卡面，**没有五态动作包**。
- 名册满三位时大厅出现座位选择器，可直接换掉今晚入席的两位；默认座位仍是林星 + 米娅。牌桌会随无序角色组合自动切换为「月夜酒馆」「银月球场」或「霓虹薄荷舞台」，座位互换不改变主题。
- Token 余额仅由本地权威服务更新；结算记录带 HMAC 签名的 receipt，客户端不能提交 Token、胜负或牌型。
- 牌友工坊：一句话 → PalIntent 安全门 → 异步真实图像生成任务 → 二进制资产落盘 → audit record → `READY` 可确认资产。未配置 Provider 时明确拒绝任务，不会伪装成 Mock 产物。
- 检查器：只读查看最新 GameSnapshot、事件序列、账本、工坊版本、审核和 Provider 降级状态。

## 架构边界

```text
Browser UI
  → local HTTP command boundary
  → GameService / RuleEngineAdapter boundary
  → GameSnapshot + GameEvent contract

Pal generation prompt
  → intent gate → async image Provider → binary asset write → audit + fallback
  → PalAsset contract → runtime presentation

Round settle
  → performance-core deterministic plan
  → receipt / photo unlock / L2 fallback replay
```

长期核心资产均独立于页面与路由：

- `packages/contracts`：版本化 Snapshot 和 PalAsset 合同。
- `packages/pal-asset-contract`：官方牌友资产与动作降级选择。
- `packages/performance-core`：确定性结算、演出轨迹与首次解锁。
- `packages/pal-generation-core`：输入策略门、生产提示词编排与可校验候选资产。
- `apps/api/pal-production.mjs`：异步作业、OpenAI-compatible 图像 Provider 调用、受限下载/落盘与作业状态。

## 验证

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run verify:fixtures
npm run test:e2e
```

`test:e2e` 覆盖大厅 → 牌桌 → 结算 → 备轨演出 → 翻卡 → 写真馆的真实浏览器路径。规则测试含 100 次单张比较回归、非法牌拒绝与幂等重复命令检查。

## 诚实的当前边界

- 本地 `GameService` 是可玩的服务端权威引导 Runtime；RLCard/DouZero 未安装，因此尚未完成其兼容矩阵或真实 NPC 策略接入。业务接口已隔离在 RuleEngineAdapter 边界。
- 当前使用 HTTP 命令/快照恢复而非 WebSocket、Redis/PostgreSQL 或对象存储；这些是上线演进项，不能视为已验收。
- 真实资源包 Provider 已统一收口到 AIHub 素材生产中心：角色资料卡用 skill 已注册的 `gpt-image2`，其他静态图片用已注册的 `jimeng`，入场与 A01–A05 动作视频用已注册的 `seedance` 能力，只有首套跳舞视频使用指定跳舞工作流；所有通道都经 `run → status → outputs`。这些能力的 appId 由 `aihub-asset-production` 注册表按别名解析，不需要新增图片或视频 appId 配置；服务端只需要 `AIHUB_AGENT_TOKEN`，首套跳舞视频另需要 `PAL_DANCE_WORKFLOW_APP_ID`。资源生产严格分两步：第一次只提交角色资料卡并取得公网 URL；用户确认后必须再次点击“继续生产”，才提交全部下游节点，并把该资料卡 URL 注入每个图片/视频节点。确认记录与立绘 hash 持久化。只有首套跳舞视频会读取牌友工坊的参考舞蹈视频 URL；留空使用默认 CS 视频，并映射为工作流 `video_url`。Seedance 视频显式提交 `Production_method`、`Video_specifications`、`duration`、`resolution` 和 `is_3d_digital_human`。未配置时返回 `PL-PROVIDER`，绝不生成 Mock；完整包仍需等待真实视频输出、下载校验和浏览器解码后才能上桌。
- 当前引导局是确定性牌局，目的是让首次体验稳定复现；完整 100+ 含飞机/四带二/春天的规则库回归、1000 局随机模拟、性能 P95 和公网部署仍是下一门禁。

详细的需求、结论、不回归基线和阶段证据见 [docs/MVP_EVIDENCE.md](docs/MVP_EVIDENCE.md)。
