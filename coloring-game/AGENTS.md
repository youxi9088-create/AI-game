# Project Guidelines

## Project Structure
```text
.
|- .gitignore
|- AGENTS.md
|- index.html
|- package.json
|- postcss.config.cjs
|- README.md
|- tailwind.config.cjs
|- tsconfig.json
|- tsconfig.node.json
|- vite-env.d.ts
|- vite.config.ts
`- app/
	|- App.tsx
	|- index.css
	`- main.tsx
```

## 目录说明
- **.gitignore**: Git 忽略规则。
- **AGENTS.md**: 本文件，包含项目约定、模版使用说明与扩展指引。
- **index.html**: 浏览器入口 HTML，构建时会被打包为 `dist/index.html`。
- **package.json**: 项目配置与脚本入口；如果后续补后端，请按规范新增 `api/`、相关脚本并更新 README。
- **postcss.config.cjs**: PostCSS（例如 Tailwind）配置。
- **README.md**: 项目说明与开发者须知。
- **tailwind.config.cjs**: Tailwind CSS 配置（如使用 Tailwind 时）。
- **tsconfig.json**: 浏览器侧 TypeScript 配置，约束 `app/` 下的前端源码。
- **tsconfig.node.json**: Node 侧 TypeScript 配置，供 `vite.config.ts` 使用。
- **vite-env.d.ts**: Vite 注入环境变量与静态资源模块类型入口。
- **vite.config.ts**: Vite 配置，通常集成 `@fn/vite`，负责 dev 代理与构建定制。
- **app/**: 前端源码目录。
	- **app/main.tsx:** 浏览器入口，负责挂载应用。
	- **app/App.tsx:** 主应用组件。
  - **app/index.css:** 全局样式入口。

## Code Style
- 保持 TypeScript React 函数组件、单引号、2 空格缩进、无分号。
- 样式优先围绕 `app/` 维护，避免平行再造一套 `src/` 根目录。
- 保持 ESM 风格；如果你切换模块体系，前端构建和 Vite 配置也要一起调整。

## Build and Deploy
- 安装依赖：`npm install`
- 本地开发：`npm run dev`
- 构建：`npm run build`
- 预览构建产物：`npm run preview`
- 部署：`npm run deploy`
- 前端交付的稳定入口是 `dist/index.html`。如果你修改构建目录或入口文件，必须保证最终仍然产生这个文件。

## Package and Config Rules
- `package.json` 是唯一的项目配置入口，不要再添加或依赖历史 `fn.*` 字段。
- `package.json.name` 直接决定 appName，必须至少 4 个字符，且只能包含小写字母、数字和内部连字符，不能使用 scoped package name。
- `package.json.version` 项目版本号。
- 前端环境变量只把需要暴露给浏览器构建的值写成 `VITE_*`；不要把服务端 secret、私钥或长效 token 写进前端代码或前端环境变量。
- `vite.config.ts` 默认接入 `@fn/vite`。只要你保持相对 `base`，它就能继续服务当前模板的静态资源构建约定。
- 如果你显式改成非相对 `base`，后续所有资源路径和潜在 `/api` 代理都需要你自己维护。

## Frontend Conventions
- `index.html` 是浏览器入口，`app/main.tsx` 负责挂载应用，`app/App.tsx` 负责主界面组织，`app/index.css` 负责当前模板的全局样式入口。
- 保持资源路径和页面跳转对相对 `base` 友好，不要把部署态路径写死成某个固定前缀。
- 如果只是调用外部 HTTP API，可以直接在前端管理请求、鉴权和 CORS；这不会自动把项目变成 FN 全栈模板。

## Adding Backend Capability
- 如果项目开始需要同 app 的后端 API，应补齐完整后端目录，而不是在前端代码里硬编码某个临时服务地址。
- 最小补充形态是新增顶层 `api/` 目录，并提供至少一个 `api/index.js`、`api/index.ts`、`api/index.mjs`、`api/index.mts` 或 `api/index.cjs` 入口文件。
- 公开 API 只放在顶层 `api/` 中；不要依赖 `api/` 子目录自动暴露路由。
- `api/index.*` 对应 `/api`，其他顶层文件 `api/<name>.*` 对应 `/api/<name>`。
- 每个 route 优先导出显式大写 HTTP 方法：`GET`、`POST`、`PUT`、`PATCH`、`DELETE`、`HEAD`、`OPTIONS`。
- `GET` 与 `HEAD` 的输入按 query string 组织，其他方法默认接收 JSON body。
- 如果前端需要直接调用这些同 app API，执行 `fn add @fn/api`，并统一通过 `/api/*` 访问，而不是散落不同 baseUrl。
- 一旦补了后端，本地开发脚本也应升级为全栈模式：保留 `vite` 前端开发，同时新增 `fn dev --no-build` 的后端同步脚本。长期维护时，直接向 fullstack 模板的目录结构和脚本命名对齐。
- 如果你显式配置了自定义 `/api` proxy，后续就由你负责保持该代理与部署态路径一致。

## Security
- 不要把密钥、长效 token 或服务端 secret 写进浏览器代码；前端只应消费允许暴露的 `VITE_*` 配置。
- 新增后端、修改构建入口、调整 base 或部署命令后，同步更新 README 和 AGENTS，避免项目说明失效。