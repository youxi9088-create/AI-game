# Linux 关卡生产线交接

本目录中的前端部署在 FN；本文件说明需要独立运行的 FastAPI 容器。它接收浏览器上传的图片，调用 AIHub 的即梦图生图生成 Coloring Book Line Art，随后在容器内进行线稿加固、质量验收、区域分割、调色板提取和关卡打包。

## 容器职责

- `POST /api/generate-level`：创建异步线稿填色关卡任务。
- `GET /api/jobs/:id`：返回十步生产线状态和最终关卡地址。
- `GET /levels/...`：公开容器生成的 `level.json`、线稿、Mask、预览与参考图。
- `GET /api/health`：健康检查，同时显示 AIHub 是否完成配置。

主路径是 **AIHub 即梦图生图 + OpenCV/Pillow 后处理**，不加载 Torch/ControlNet，因此标准 Linux CPU 实例即可运行；建议 2 vCPU / 4 GB RAM 起步。GPU 只在启用“本机 LineartDetector 回退”时才需要考虑，当前生产前端会提供参考图，不走该回退。

## 服务端需要执行的步骤

1. 以分支 `feature/coloring-game-publish` 合并/检出本目录 `coloring-game/`。
2. 在 Linux 主机进入 `coloring-game/`，复制配置模板：

   ```bash
   cp .env.level-service.example .env.level-service
   ```

3. 在部署平台的 Secret/环境变量中填写以下值（不要提交回 Git）：

   - `AIHUB_AGENT_TOKEN`：AIHub 服务端凭证。
   - `LEVEL_SERVICE_PUBLIC_ORIGIN`：此服务的最终 HTTPS 地址，当前为 `https://coloring-game.new.ndhy.com`。
   - `LEVEL_SERVICE_ALLOWED_ORIGINS`：FN 前端的 Origin；当前为 `https://f.new.ndhy.com`。

4. 启动服务并确认健康检查：

   ```bash
   docker compose up -d --build
   curl -fsS https://coloring-game.new.ndhy.com/api/health
   ```

5. 为该容器绑定 HTTPS 域名，并将反向代理的上传上限调至至少 `20m`，请求超时调至至少 25 分钟。AIHub 工作流本身为异步轮询，但首次创建和状态轮询都依赖这个公网 API。

6. 将前端构建环境变量设置为服务的根地址后，再部署 FN 前端：

   ```bash
   VITE_COLORVERSE_LEVEL_SERVICE_ORIGIN=https://coloring-game.new.ndhy.com
   ```

   这个变量只写服务地址，不含 `/api`，且不会包含 Token。FN 前端部署后会直接请求该地址，不再错误访问访客浏览器自己的 `:5399`。

## 验收

```bash
# 1. AIHub 具备 Token 与工作流 ID
curl -fsS https://coloring-game.new.ndhy.com/api/health

# 2. 浏览器在 https://f.new.ndhy.com 打开关卡工坊，上传一张图片
# 3. Network 中 POST 请求应指向 https://coloring-game.new.ndhy.com/api/generate-level
# 4. 完成任务结果的 url 应为 https://coloring-game.new.ndhy.com/levels/upload-.../level.json
# 5. 点击“打开并开始填色”后，lineart、region_mask 与 preview 请求也应来自同一服务域名
```

## 运行边界

- `public/levels` 使用 Docker named volume 持久化；生产环境若改为对象存储，需保持 `result.url` 和关卡内部资源可被浏览器公开读取。
- 当前任务状态存于进程内内存，因此第一版应保持 **单副本**。容器重启后进行中的任务会丢失，已生成文件仍保留。多副本/可恢复任务需要再接 Redis + 队列 + 对象存储。
- AIHub Token 仅存在于服务端 Secret/`.env.level-service`，绝不可写入 Vite 环境变量、前端代码或 Git。即梦工作流 App ID 已作为公开能力标识固化在服务端代码中，不需要再配置。
