# 0.9.0-rc.1 发布操作说明

这些工具已在本地独立进程验证，尚未用于 yyxx101.online。当前没有该站点的服务器管理连接，不能确定实际服务名、代码目录、反向代理或挂载方式；下文路径均是占位示例。现有服务依然使用单一 player 存档，不能把本次发布视为完成多用户账号隔离。

## 1. 核对并准备

保留运行中的代码版本和配置文件，确认本次代码与现网差异。先在独立目录启动预生产副本，使用复制的存档与资产，不让两个服务写同一份 JSON。

`TOKEN_RECEIPT_SECRET` 必须使用现有生产密钥且至少 32 字符；缺失、模板值、开发默认值或生产开启 `ALLOW_DEBUG_ROUTES=1` 将阻止启动。若原有密钥不合要求，应单独规划更换，因为它影响已有 receipt 的验签，不要在部署时悄悄随机替换。生成新环境密钥可用 `openssl rand -hex 32`，仅写入服务端配置。

本机默认 `HOST=127.0.0.1`；容器通过 `HOST=0.0.0.0` 监听容器网卡。只有反向代理对外提供 HTTPS，游戏端口无需直接暴露公网。

## 2. 停止写入后备份

先停止实际游戏进程及所有素材生产任务。`--stopped` 是操作者对停服的声明，脚本不会猜测进程管理方式或代为停服。两次读取检查只能发现备份期间部分写入，不能提供跨文件事务保证。

创建仅含实际绝对路径的 `/实际配置目录/state-paths.env`。六个变量全部必填，避免误备份代码仓库的示例存档：

```dotenv
GALLERY_STATE_PATH=/实际数据目录/gallery.json
TOKEN_STATE_PATH=/实际数据目录/player-wallet.json
CONFIRMED_PALS_PATH=/实际数据目录/confirmed-pals.json
PAL_RESOURCE_STATE_PATH=/实际数据目录/pal-resource-tasks.json
PARTNER_SESSIONS_PATH=/实际数据目录/partner-sessions.json
OFFICIAL_ASSETS_PATH=/实际注册表目录/official-assets.json
```

在新代码根目录使用 Node 24 执行，输出目录的父目录需已存在，输出目录本身不能存在：

```bash
node --env-file=/实际配置目录/state-paths.env scripts/state-snapshot.mjs create /实际备份目录/before-0.9.0-rc.1 --stopped
node scripts/state-snapshot.mjs verify /实际备份目录/before-0.9.0-rc.1
```

画廊、钱包、官方注册表缺失会停止备份；尚未创建的其他三种存档在清单中标记缺失。每个存在的文件验证 JSON 并记录字节数与 SHA-256；副本目录权限为 0700，文件为 0600。存档可能包含平台会话信息，应按私密备份保存。校验用于发现损坏，不是对抗同时篡改数据和清单的签名机制。

此快照不包含图片/视频、环境密钥、反向代理配置或代码。另行备份现网 `apps/web/assets`（特别是 `pals/ugc`）、服务配置和当前代码，保留文件权限。不要上传这些私有备份到 Git。

## 3. 启动与只读检查

使用现有进程管理方式切换至新代码，保持实际数据路径与资产路径；不要覆盖、清空或用仓库样例替换它们。没有确定现有服务配置前，不运行猜测的重启命令。

独立预生产的启动方式示例：

```bash
node --env-file=/实际配置目录/staging.env apps/api/server.mjs
```

配置中必须有 `NODE_ENV=production`、合规 receipt 密钥，以及指向预生产副本的全部存档路径。正式环境采用同样的配置规则。

在另一个终端运行：

```bash
node scripts/production-smoke.mjs http://127.0.0.1:4175 0.9.0-rc.1
```

检查版本、生产模式、关闭的检查器及写真/音频前端资源。只发 GET，不开局、不结算、不改变钱包；它不能替代实际牌局、视频解码、资产完整性、FMOD Bank 或公网多用户测试。正式域名发布后也可以使用同一命令检查 HTTPS 地址。

## 4. Docker 可选路径

镜像改为仅复制运行代码和官方资产，不复制 `.env*`、玩家/工坊存档及 UGC；以 node 用户运行，并提供健康检查。运行数据放入 `/data`，UGC 独立挂载。构建前执行 Git LFS 拉取和项目资产校验，LFS 指针不能当作图片视频发布。

```bash
git lfs pull
npm run build
npm run verify:assets
docker build -t dressbattle:0.9.0-rc.1 .
```

运行示例（真实目录及其权限应提前准备，node 用户需要读写数据和 UGC）：

```bash
docker run --name dressbattle-rc --env-file /实际配置目录/container.env \
  -p 127.0.0.1:4175:4173 \
  -v /实际数据目录:/data \
  -v /实际UGC目录:/app/apps/web/assets/pals/ugc \
  dressbattle:0.9.0-rc.1
```

`container.env` 使用容器内路径，保持 `PORT=4173`、`HOST=0.0.0.0` 和 `NODE_ENV=production`。如果现网修改过官方注册表及其他官方资产，应将它们作为同一资产版本显式挂载/迁移，不能由新镜像覆盖。

当前环境没有 Docker 引擎，因此未实际构建/运行镜像。镜像补齐 FFmpeg、Python、NumPy、Pillow，但基线的高级透明视频修复器仍引用未入仓的 Windows 外部脚本，完整工坊视频生产不能据此宣布容器验收通过。本次游戏流程验证不调用该外部生产器。

## 5. 回滚与恢复演练

回滚前再次停止所有写入，并把升级后 v2 存档备份为另一份快照。旧代码保存画廊会丢弃新 `collection` 字段；必须保留升级前和升级后两份备份。

只恢复到一个全新的目录：

```bash
node scripts/state-snapshot.mjs restore /实际备份目录/before-0.9.0-rc.1 /实际恢复目录/before-0.9.0-rc.1
```

脚本先验证所有清单条目与文件，再创建目标目录；校验失败或目标已存在时拒绝恢复。它不会重启服务、自动覆盖原数据或改写环境配置。随后用旧代码和原配置指向恢复副本，并恢复匹配的资产版本。升级后产生的胜场/钱包变化不会出现在升级前备份里，是否接受这段进度回退需要在真正回滚时判断。

本地验证覆盖：快照字节级恢复、现有目录保护、缺失必需文件、损坏/越界路径/软链接拒绝，以及真实生产服务的版本、只读检查与调试入口关闭。当前没有实际生产数据恢复结果。
