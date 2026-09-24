// 本地 AIHub 模式 API 启动器：固化本机必需的环境变量，避免每次拼命令行。
// 用法：node scripts/dev-api-local.mjs
// 注意：hidden-object-web/.env 里的 PORT=3001 属于其他项目，这里必须显式覆盖为 4174。
// 用 spawn 而非 import：api/server.mjs 仅在被直接执行（argv[1] 匹配）时才监听端口。
import { spawn } from 'node:child_process';

const env = {
  ...process.env,
  PORT: '4174',
  WEB_ORIGIN: 'http://localhost:4173,http://127.0.0.1:4173',
  THEME_GENERATOR_MODE: 'aihub',
  ALLOW_GENERATION_FALLBACK: '0',
  // 本机无 PowerShell 7（pwsh.exe），AIHub 工作流启动脚本须用 Windows PowerShell 5.1。
  AIHUB_POWERSHELL_PATH: `${process.env.SystemRoot || 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`,
};
const child = spawn(process.execPath, ['api/server.mjs'], { stdio: 'inherit', env });
const stop = () => { if (!child.killed) child.kill(); };
process.on('SIGINT', () => { stop(); process.exit(0); });
process.on('SIGTERM', () => { stop(); process.exit(0); });
child.on('exit', code => { process.exitCode = code || 0; });
