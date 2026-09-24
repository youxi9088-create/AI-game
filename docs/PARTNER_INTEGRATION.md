# 第三方游戏模板接入：实现说明与联调清单

按《第三方游戏模板接入操作文档》（项目根 `第三方游戏模板接入操作文档.md`）实现「换装斗地主」作为第三方生成模板接入 AI 游戏平台（`https://ai-game.new.ndhy.com`）。本文记录已实现部分与上线前双方要完成的事项。

## 官方接入 Skill（已安装）

`partner-template-client.rar` 已解压并安装到项目级技能目录：`.agents/skills/partner-template-client/`（含 `SKILL.md` 阶段 1–8 操作手册、`scripts/partner_api.py` 标准库联调客户端、`assets/submit-*.example.json` 回传模板）。用途：

- **核对密钥**：`python .agents/skills/partner-template-client/scripts/partner_api.py selftest`（须输出 `SELFTEST: PASS`）与 `... partner_api.py fingerprint`（与平台管理页 12 位指纹比对，不一致即停联调）。
- **联调调用**：`exchange / progress / submit / query` 子命令，凭据只从环境变量读取。
- 服务端生产实现仍在 `apps/api/partner-platform.mjs`（Node 版，签名实现与该 Python 参考逐项一致，测试向量已验证）。

## 已实现（代码侧）

### 创作页（前端，`apps/web/app.js`）

- 平台跳转入参：boot 时从 `location.search` 与 hash 查询中读取 `ticket` / `template_id` / `return_url` / `proto`。
- `ticket` 立即 POST 给本后端 `/api/partner/session` 兑换，随后 `history.replaceState` 从地址栏清除；不记录、不复用。
- 进度上报：开局 → 30%（playing）；进入结算 → 80%（settlement）。
- 结算散场（DESTINATION）阶段出现「创作完成 · 返回平台」按钮：调本后端 `/api/partner/submit` 后回跳 `return_url`（附 `work_id`、`result=ok`）。

### 后端（`apps/api/`）

- `partner-platform.mjs`：HMAC-SHA256 签名客户端。签名原文严格按文档：`app_id \n timestamp \n nonce \n METHOD \n signed_path \n sha256(raw_body)`；POST 不含查询串，GET 仅允许 `external_work_id` 单参数（规范化编码、`path?query` 签名、空 body 摘要）。`app_secret` 只存服务端，接口、日志、前端均不出现；`capability()` 只暴露指纹（SHA-256 前 12 位）用于双方核对。
- `partner-session-store.mjs`：创作会话持久化（`apps/api/data/partner-sessions.json`）。每个会话固定 `externalWorkId = dressbattle-<draft_id>`——网络重试、重复点击、服务重启都不会产生第二件作品。
- `server.mjs` 新接口：
  - `GET /api/partner/status`：配置状态（含指纹）+ 会话查询。
  - `POST /api/partner/session`：ticket 兑换 → `user_ref + draft_id`（调平台 `ticket/exchange`）。
  - `POST /api/partner/progress`：进度回传（`work/progress`）。
  - `POST /api/partner/submit`：作品回传（`work/submit`，幂等：已提交直接返回原 `work_id`）。

### 配置（`.env.production.local`，模板已更新 `.env.example` / `.env.production.example`）

```
PARTNER_PLATFORM_BASE=https://ai-game.new.ndhy.com
PARTNER_APP_ID=<平台发放的接入方标识>
PARTNER_APP_SECRET=<平台生成的 64 位十六进制密钥，仅存于此文件>
PARTNER_HOSTING=external            # 或 package（平台托管 ZIP）
PARTNER_PLAY_URL=<作品可公开 HTTPS 游玩地址，须在平台白名单内>
PARTNER_COVER_URL=<封面图 HTTPS 地址>
PARTNER_ORIENTATION=landscape
PARTNER_EMBEDDABLE=true
```

未配置 `PARTNER_APP_ID/SECRET` 时，所有平台调用在发起网络请求前如实报错（`平台接入未配置`），前端静默降级为普通单机模式。

### 测试（`tests/partner-platform.test.mjs`，7 项）

- 签名串与文档逐字节一致（含 GET 的 `path?query` + 空 body 摘要）。
- 指纹 = `SHA-256(app_secret)` 前 12 位。
- 兑换请求头签名 = 实际发送字节的重算值；请求头不含 `app_secret`。
- external 回传载荷字段（hosting/play_url/cover/orientation）与平台业务错误码透传。
- 会话存储跨重启保持 `externalWorkId` 稳定（幂等）。
- 未配置时零网络调用、如实报错。

`npm run verify`：100 项测试全绿。

## 上线前：双方还要完成的事

### 我们要交给平台管理员（文档第二节）

| 项 | 内容 |
|---|---|
| 主体 | 团队名称与说明 |
| 联系人 | 商务 / 技术 / 内容合规 / 7×24 应急 |
| 模板卡片 | 名称「换装斗地主」、简介、封面、横屏（landscape）、建议稳定模板 ID（如 `dressbattle-doudizhu`） |
| 创作入口 | 测试与生产 HTTPS 创作页 URL（当前应用部署后的公网地址） |
| 域名白名单 | 创作页域名 + 作品/封面/CDN 全部精确主机名 |
| 托管模式 | `external` 外部托管（默认；若选 `package` 则用 `release/v1.0` 资源出 ZIP ≤100 MiB、根目录含 index.html） |
| 内嵌能力 | 是否允许平台 iframe 内嵌（`PARTNER_EMBEDDABLE`） |
| 容量预估 | 日创作量、峰值 QPS、单用户作品数建议 |
| 合规信息 | 审核机制、投诉与下架时限、数据保留与删除方案 |

### 要向平台索取（文档第三节）

- 测试/生产 `PLATFORM_BASE`、`app_id`、`app_secret`（只展示一次，收到即计算指纹核对）、密钥指纹与版本、`template_id` 列表、登记结果（托管/白名单/限流/配额/内嵌）、测试账号与模板入口、平台技术与应急联系人。

### 联调验收顺序（文档第九节，逐条过）

1. 正常链路：模板 → 签票 → 兑换 → 进度 → 回传 → 我的游戏 → 发布 → 匿名分享。
2. 身份隔离：不同用户互不可见作品；同一用户跨 app 不同 `user_ref`。
3. 鉴权负例：缺签名 / 错密钥 / 时间偏差 >300s / nonce 重放 → 均被拒。
4. 票据负例：不存在 / 过期 / 重复兑换 / 跨 app 兑换 → 均被拒。
5. 回传负例：越权 draft_id / 白名单外 URL / 托管形态不符 / 超配额 → 均被拒。
6. 幂等恢复：响应丢失重试不产生第二件作品（已由固定 `externalWorkId` 保证，需平台侧复测）。
7. 形态 A：外部地址 4xx/5xx、内网重定向、不可内嵌的提示。
8. 生命周期：回传不公开；发布后按通道可见；下架/删除后公开入口不可访问。

### 部署注意

- 创作页必须是 **HTTPS 公网可达**（当前 4173 是内网开发端口）；部署后把 `PARTNER_PLAY_URL` 指向同一地址并在平台白名单登记精确主机名。
- 服务器时间需校准（NTP），签名时间戳允许误差 ±300 秒。
- `app_secret` 轮换：平台交付新密钥后更新 `.env.production.local` 并重启；旧密钥 24 小时过渡期。
