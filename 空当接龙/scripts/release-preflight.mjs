import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const executable = process.env.FC_SOLVE_BIN || 'fc-solve';
const probe = spawnSync(executable, ['--version'], { encoding: 'utf8', windowsHide: true });
const docker = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8', windowsHide: true });
const genericProvider = Boolean(process.env.THEME_PROVIDER_URL && process.env.THEME_PROVIDER_TOKEN);
const openAIProvider = Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_TEXT_MODEL && process.env.OPENAI_IMAGE_MODEL);
const aihubProvider = Boolean(process.env.AI_GATEWAY_API_KEY && process.env.AI_GATEWAY_MODEL && process.env.AIHUB_AGENT_TOKEN && process.env.AIHUB_ASSET_SKILL_DIR);
const checks = [
  ['env example', existsSync('.env.example')], ['container compose', existsSync('docker-compose.yml')], ['docker engine', !docker.error && docker.status === 0], ['fc-solve', !probe.error], ['real provider configured', genericProvider || openAIProvider || aihubProvider],
];
for (const [name, pass] of checks) console.log(`${pass ? 'PASS' : 'BLOCKED'} ${name}`);
if (process.argv.includes('--strict') && checks.some(([, pass]) => !pass)) process.exitCode = 1;
