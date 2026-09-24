# Third party notices

本项目的自研游戏运行时不包含第三方图片、字体或音频素材。

- Fastify（MIT）：主题任务与分析 API 服务。
- Playwright（Apache-2.0）：发布前浏览器回归测试。
- OpenAI API（可选远程服务）：通过服务端 HTTPS 直接调用 Responses 与 Image Generation 接口；本仓库未引入 OpenAI SDK，也不包含 API Key 或生成素材。

完整版本和传递依赖以 `package-lock.json` 为准；发布构建需保留该锁文件。
