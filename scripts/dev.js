// 一键开发启动：Vite 前端 + 本地关卡生成服务
// 用法与 `vite` 完全一致（host/port 等参数原样透传），例如：
//   npm run dev -- --port 5199 --strictPort
import { spawn, spawnSync } from 'node:child_process'
import net from 'node:net'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SERVICE_PORT = 5399
const lanMode = process.env.COLORVERSE_LAN === '1'
const children = []

function killAll(code = 0) {
  for (const child of children) {
    try { child.kill('SIGTERM') } catch { /* 忽略 */ }
  }
  process.exit(code)
}
process.on('SIGINT', () => killAll(0))
process.on('SIGTERM', () => killAll(0))

function portInUse(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' })
    socket.once('connect', () => { socket.destroy(); resolve(true) })
    socket.once('error', () => resolve(false))
  })
}

function startLevelService() {
  // 候选解释器：优先绝对路径（预览卡片等环境下 PATH 可能没有 python）
  const candidates = [
    { cmd: join(root, '.venv-ai', 'Scripts', 'python.exe'), args: [] },
    { cmd: 'C:\\Python314\\python.exe', args: [] },
    { cmd: 'C:\\Users\\986916\\AppData\\Roaming\\kimi-desktop\\daimon-share\\daimon\\runtime\\python\\.venv\\Scripts\\python.exe', args: [] },
    { cmd: 'python', args: [] },
    { cmd: 'python3', args: [] },
    { cmd: 'py', args: ['-3'] },
  ]
  // 先同步探测真人线稿服务的完整依赖；不允许悄悄退回旧的照片边缘逻辑。
  const usable = candidates.find(({ cmd, args }) => {
    const probe = spawnSync(cmd, [...args, '-c', 'import numpy, PIL, cv2, torch, controlnet_aux'], { cwd: root, stdio: 'ignore' })
    return !probe.error && probe.status === 0
  })
  if (!usable) {
    console.warn('[level-service] 未找到 Coloring Book Line Art 依赖，请先运行 scripts/setup_ai_env.ps1（前端其余功能不受影响）')
    return
  }
  console.log(`[level-service] 使用解释器: ${usable.cmd}`)
  const child = spawn(usable.cmd, [...usable.args, 'scripts/level_service.py'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, LEVEL_SERVICE_HOST: lanMode ? '0.0.0.0' : '127.0.0.1' } })
  child.stdout.on('data', (data) => process.stdout.write(`[level-service] ${data}`))
  child.stderr.on('data', (data) => process.stderr.write(`[level-service] ${data}`))
  child.once('error', (err) => console.warn(`[level-service] 启动失败: ${err.message}`))
  child.once('exit', (code) => {
    if (code !== 0 && code !== null) console.warn(`[level-service] 已退出 (code ${code})，可单独运行 npm run level:service 排查`)
  })
  children.push(child)
  console.log(`[level-service] 关卡生成服务启动中 → http://${lanMode ? '0.0.0.0' : 'localhost'}:5399`)
}

async function main() {
  if (await portInUse(SERVICE_PORT)) {
    console.log('[level-service] 检测到 5399 端口已有服务在运行，跳过重复启动')
  } else {
    startLevelService()
  }
  const viteBin = join(root, 'node_modules', 'vite', 'bin', 'vite.js')
  const viteArgs = process.argv.slice(2)
  if (lanMode && !viteArgs.includes('--host')) viteArgs.push('--host', '0.0.0.0')
  const vite = spawn(process.execPath, [viteBin, ...viteArgs], { cwd: root, stdio: 'inherit' })
  children.push(vite)
  vite.once('exit', (code) => killAll(code ?? 0))
}

main()
