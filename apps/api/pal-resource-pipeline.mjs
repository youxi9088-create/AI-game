import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { createProductionCandidate, DEFAULT_DANCE_REFERENCE_VIDEO_URL, LINXING_STYLE_LOCK, PAL_IDENTITY_SEPARATION_LOCK, upgradePalResourcePlan } from '../../packages/pal-generation-core/index.mjs';
import { RESOURCE_SLOTS } from '../web/asset-slots.js';

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_VIDEO_BYTES = 250 * 1024 * 1024;
const DEFAULT_IMAGE_MODEL = 'gpt-image2';
const DEFAULT_IMAGE_FALLBACK_MODEL = 'jimeng';
const IMAGE_STRATEGY_VERSION = 'aihub-image-v2';
const MIN_GATEWAY_IMAGE_PIXELS = 3_686_400;
const AIHUB_GPT_IMAGE_SIZES = new Set(['auto', '1024x1024', '1536x1024', '1024x1536', '2048x2048', '2048x1152', '3840x2160', '2160x3840']);
const ACTIVE = new Set(['QUEUED', 'WAITING_REFERENCE', 'RETRY_WAITING', 'RUNNING', 'SUBMITTING']);
const DANCE_ROUTE = 'aihub:dressbattle-dance';
const SEEDANCE_ROUTE = 'aihub:seedance';
const DANCE_VIDEO_RESOURCES = new Set(['outfit-film']);
const ACTION_VIDEO_RESOURCES = new Set(['action-a01', 'action-a02', 'action-a03', 'action-a04', 'action-a05']);
const execFileAsync = promisify(execFile);
const ALPHA_REPAIR_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '../../scripts/repair-opaque-alpha.py');
const ACTION_ALPHA_RUNNER = 'C:/Users/986916/.agents/skills/repair-webm-alpha/scripts/run_delivery.py';
/* aihub-asset-production/examples/_appids.ps1 的现成能力注册表。
   业务方不需要新增 appId 环境变量；同名环境变量只作为本地调试覆盖。 */
const SKILL_APP_IDS = Object.freeze({
  'gpt-image2': '03b3fe9c-303c-4681-9a6f-070992187d51',
  jimeng: 'e5fd4410-b1ac-4418-a83d-b1f7989c2f4a',
  seedance: 'ffa69eff-3fe7-4910-99e8-7497dc04e2b7',
  'remove-bg': '6f14a614-1ab4-42f6-9006-471206f79f22',
  'video-matting': '4cbb641e-4f04-4737-987f-c69847f14117',
  'mov-to-webm': '75a8cc5f-c8d2-4205-85ed-132dcbab0705'
});
function skillAppId(alias, env) {
  const overrideEnv = { 'gpt-image2': 'AIHUB_PROFILE_IMAGE_WORKFLOW_APP_ID', jimeng: 'AIHUB_STATIC_IMAGE_WORKFLOW_APP_ID', seedance: 'AIHUB_VIDEO_WORKFLOW_APP_ID' }[alias];
  return String((overrideEnv && env[overrideEnv]) || SKILL_APP_IDS[alias] || '').trim();
}
const ALPHA_IMAGE_RESOURCES = new Set(['table-standee', 'lounge-standee', 'action-sheet', 'action-image-A01', 'action-image-A02', 'action-image-A03', 'action-image-A04', 'action-image-A05', 'outfit-fx']);
function currentVideoRoute(resourceId, env = process.env) {
  const agent = Boolean(String(env.AIHUB_AGENT_TOKEN || '').trim());
  return DANCE_VIDEO_RESOURCES.has(resourceId)
    ? { provider: 'aihub-dance', route: DANCE_ROUTE, transport: agent ? 'aihub-agent' : 'aihub-bot' }
    : { provider: 'aihub-seedance', route: SEEDANCE_ROUTE, transport: 'aihub-agent' };
}
function migratePendingVideoTask(task, env = process.env) {
  if (task.kind !== 'video' || !['QUEUED', 'WAITING_REFERENCE', 'RETRY_WAITING', 'WAITING_PORTRAIT_CONFIRMATION'].includes(task.status)) return false;
  const next = currentVideoRoute(task.resourceId, env);
  if (task.provider === next.provider && task.route === next.route) return false;
  task.provider = next.provider;
  task.route = next.route;
  task.transport = next.transport;
  task.updatedAt = now();
  task.error = '服务重启后，未提交的视频任务已按当前 skill 分流恢复。';
  return true;
}

function now() { return new Date().toISOString(); }
function assetFolderName(plan = {}) {
  const describedName = String(plan?.intent?.sourceText || '').match(/牌友[“”"']?([\p{L}\p{N}_·]{2,16})/u)?.[1] || '';
  const candidate = String(
    plan?.identity?.name
      || plan?.profileCard?.character?.name
      || plan?.intent?.name
      || describedName
      || `未命名牌友-${plan?.identity?.suffix || String(plan?.planId || 'unknown').slice(0, 8)}`
  ).normalize('NFKC').trim();
  const safe = candidate
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/[. ]+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 64);
  return safe || '未命名牌友';
}
function errorText(value) {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && parsed.message) return `${parsed.message}${parsed.source ? ` [${parsed.source}]` : ''}`;
    } catch { /* ordinary text */ }
    return value;
  }
  if (value instanceof Error) return value.message;
  if (value && typeof value === 'object' && value.message) return `${value.message}${value.source ? ` [${value.source}]` : ''}`;
  try { return JSON.stringify(value || '未知错误'); } catch { return String(value || '未知错误'); }
}
function safeError(error) { return errorText(error); }
function isSafetyRejection(value) {
  const text = errorText(value);
  return /safety system|safety_violations|content[_ -]?filter|安全系统|内容审核|敏感内容/i.test(text);
}
function publicTask(task) {
  const { sourceUrl, ...safe } = task;
  /* The reference itself is a public CS URL, so expose it for audit/debugging
     without exposing the private provider response fields. */
  if (task.profileReferenceUrl) safe.profileReferenceUrl = task.profileReferenceUrl;
  const plan = task.planSnapshot || {};
  safe.planId = task.planId;
  safe.planKey = task.planId ? `PLAN-${String(task.planId).slice(0, 8).toUpperCase()}` : null;
  safe.planName = plan.identity?.name || plan.profileCard?.character?.name || assetFolderName(plan);
  safe.planVersion = plan.identity?.version ?? null;
  safe.planDeleted = Boolean(task.planDeleted);
  return { ...safe, active: ACTIVE.has(task.status) };
}
function isUrl(value) { try { const url = new URL(value); return url.protocol === 'https:'; } catch { return false; } }
const FIRST_OUTFIT_PROMPT_REVISION = 'plan-wardrobe-3-4-v3';
const MASTER_PROMPT_REVISION = 'reference-board-v4';
const AVATAR_PROMPT_REVISION = 'single-headshot-1-1-v1';
const TABLE_PROMPT_REVISION = 'single-table-standee-3-4-v3';
const LOUNGE_PROMPT_REVISION = 'lounge-single-hero-v2';
const ACTION_SHEET_PROMPT_REVISION = 'action-sheet-3x2-v2';
const ACTION_IMAGE_PROMPT_REVISION = 'action-image-single-v1';
/* 特效层是合成用的非人物图层。它绝不能继承通用角色提示词，否则模型会把
   “服装特效”理解成“穿着服装的角色”，重新产出人物拼图。 */
const OUTFIT_FX_PROMPT_REVISION = 'effect-only-transparent-v3';
const ENTRY_VIDEO_PROMPT_REVISION = 'entry-film-landscape-16x9-v3';
const ACTION_VIDEO_PROMPT_REVISION = 'action-green-screen-alpha-v3-strict-source';
/* The earlier dance prompt described an intention but not a performance.
   Keep the choreography version on the task so a successful old "fashion
   posing" clip can never be confused with the dance-and-change standard. */
const OUTFIT_DANCE_PROMPT_REVISION = 'continuous-dance-change-v3';
const DEFAULT_RESOURCE_SIZES = Object.freeze({
  'master-portrait': '1920x2560',
  avatar: '2048x2048',
  'table-standee': '1728x2304',
  'lounge-standee': '1920x2560',
  'first-outfit': '1920x2560',
  'action-sheet': '2048x2048',
  'action-image-A01': '1600x2000',
  'action-image-A02': '1600x2000',
  'action-image-A03': '1600x2000',
  'action-image-A04': '1600x2000',
  'action-image-A05': '1600x2000',
  'outfit-fx': '2048x2048',
  'outfit-poster': '1920x2560'
});
const DISPLAY_ROUTE_BY_RESOURCE = Object.freeze({
  'master-portrait': { production: 'aihub:gpt-image2', route: { id: 'aihub-gpt-image2', label: 'AIHub · GPT Image 2（角色资料卡）', api: 'AIHub Workflow Agent run/status/outputs', tokenEnv: 'AIHUB_AGENT_TOKEN', appIdSource: 'aihub-asset-production:gpt-image2', alias: 'gpt-image2', model: 'gpt-image2' } },
  avatar: { production: 'aihub:jimeng', route: { id: 'aihub-jimeng', label: 'AIHub · 即梦 5.0（头像）', api: 'AIHub Workflow Agent run/status/outputs', tokenEnv: 'AIHUB_AGENT_TOKEN', appIdSource: 'aihub-asset-production:jimeng', alias: 'jimeng', model: 'jimeng' } },
  'table-standee': { production: 'aihub:jimeng', route: { id: 'aihub-jimeng-alpha', label: 'AIHub · 即梦 5.0（透明上桌立绘）', api: 'AIHub Workflow Agent run/status/outputs', tokenEnv: 'AIHUB_AGENT_TOKEN', appIdSource: 'aihub-asset-production:jimeng', alias: 'jimeng', model: 'jimeng' } },
  'first-outfit': { production: 'aihub:jimeng', route: { id: 'aihub-jimeng', label: 'AIHub · 即梦 5.0（其他图片）', api: 'AIHub Workflow Agent run/status/outputs', tokenEnv: 'AIHUB_AGENT_TOKEN', appIdSource: 'aihub-asset-production:jimeng', alias: 'jimeng', model: 'jimeng' } },
  'action-sheet': { production: 'aihub:jimeng', route: { id: 'aihub-jimeng-alpha', label: 'AIHub · 即梦 5.0（透明五态动作）', api: 'AIHub Workflow Agent run/status/outputs', tokenEnv: 'AIHUB_AGENT_TOKEN', appIdSource: 'aihub-asset-production:jimeng', alias: 'jimeng', model: 'jimeng' } },
  'action-image-A01': { production: 'aihub:jimeng', route: { id: 'aihub-jimeng-alpha', label: 'AIHub · 即梦 5.0（透明 A01 动作图）', api: 'AIHub Workflow Agent run/status/outputs', tokenEnv: 'AIHUB_AGENT_TOKEN', appIdSource: 'aihub-asset-production:jimeng', alias: 'jimeng', model: 'jimeng' } },
  'action-image-A02': { production: 'aihub:jimeng', route: { id: 'aihub-jimeng-alpha', label: 'AIHub · 即梦 5.0（透明 A02 动作图）', api: 'AIHub Workflow Agent run/status/outputs', tokenEnv: 'AIHUB_AGENT_TOKEN', appIdSource: 'aihub-asset-production:jimeng', alias: 'jimeng', model: 'jimeng' } },
  'action-image-A03': { production: 'aihub:jimeng', route: { id: 'aihub-jimeng-alpha', label: 'AIHub · 即梦 5.0（透明 A03 动作图）', api: 'AIHub Workflow Agent run/status/outputs', tokenEnv: 'AIHUB_AGENT_TOKEN', appIdSource: 'aihub-asset-production:jimeng', alias: 'jimeng', model: 'jimeng' } },
  'action-image-A04': { production: 'aihub:jimeng', route: { id: 'aihub-jimeng-alpha', label: 'AIHub · 即梦 5.0（透明 A04 动作图）', api: 'AIHub Workflow Agent run/status/outputs', tokenEnv: 'AIHUB_AGENT_TOKEN', appIdSource: 'aihub-asset-production:jimeng', alias: 'jimeng', model: 'jimeng' } },
  'action-image-A05': { production: 'aihub:jimeng', route: { id: 'aihub-jimeng-alpha', label: 'AIHub · 即梦 5.0（透明 A05 动作图）', api: 'AIHub Workflow Agent run/status/outputs', tokenEnv: 'AIHUB_AGENT_TOKEN', appIdSource: 'aihub-asset-production:jimeng', alias: 'jimeng', model: 'jimeng' } },
  'lounge-standee': { production: 'aihub:jimeng', route: { id: 'aihub-jimeng-alpha', label: 'AIHub · 即梦 5.0（透明大厅立绘）', api: 'AIHub Workflow Agent run/status/outputs', tokenEnv: 'AIHUB_AGENT_TOKEN', appIdSource: 'aihub-asset-production:jimeng', alias: 'jimeng', model: 'jimeng' } },
  'outfit-fx': { production: 'aihub:jimeng', route: { id: 'aihub-jimeng-alpha', label: 'AIHub · 即梦 5.0（透明服装特效）', api: 'AIHub Workflow Agent run/status/outputs', tokenEnv: 'AIHUB_AGENT_TOKEN', appIdSource: 'aihub-asset-production:jimeng', alias: 'jimeng', model: 'jimeng' } },
  'outfit-poster': { production: 'deterministic:video-poster', route: { id: 'deterministic-video-poster', label: '确定性抽帧 · 换装演出视频首帧', api: 'FFmpeg local frame extraction', tokenEnv: null, appIdSource: null, alias: 'deterministic', model: 'ffmpeg' } },
  'entry-film': { production: SEEDANCE_ROUTE, route: { id: 'aihub-seedance', label: 'AIHub · Seedance 2.0（其他视频）', api: 'AIHub Workflow Agent run/status/outputs', tokenEnv: 'AIHUB_AGENT_TOKEN', appIdSource: 'aihub-asset-production:seedance', alias: 'seedance', model: 'seedance' } },
  'action-a01': { production: SEEDANCE_ROUTE, route: { id: 'aihub-seedance', label: 'AIHub · Seedance 2.0（其他视频）', api: 'AIHub Workflow Agent run/status/outputs', tokenEnv: 'AIHUB_AGENT_TOKEN', appIdSource: 'aihub-asset-production:seedance', alias: 'seedance', model: 'seedance' } },
  'action-a02': { production: SEEDANCE_ROUTE, route: { id: 'aihub-seedance', label: 'AIHub · Seedance 2.0（其他视频）', api: 'AIHub Workflow Agent run/status/outputs', tokenEnv: 'AIHUB_AGENT_TOKEN', appIdSource: 'aihub-asset-production:seedance', alias: 'seedance', model: 'seedance' } },
  'action-a03': { production: SEEDANCE_ROUTE, route: { id: 'aihub-seedance', label: 'AIHub · Seedance 2.0（其他视频）', api: 'AIHub Workflow Agent run/status/outputs', tokenEnv: 'AIHUB_AGENT_TOKEN', appIdSource: 'aihub-asset-production:seedance', alias: 'seedance', model: 'seedance' } },
  'action-a04': { production: SEEDANCE_ROUTE, route: { id: 'aihub-seedance', label: 'AIHub · Seedance 2.0（其他视频）', api: 'AIHub Workflow Agent run/status/outputs', tokenEnv: 'AIHUB_AGENT_TOKEN', appIdSource: 'aihub-asset-production:seedance', alias: 'seedance', model: 'seedance' } },
  'action-a05': { production: SEEDANCE_ROUTE, route: { id: 'aihub-seedance', label: 'AIHub · Seedance 2.0（其他视频）', api: 'AIHub Workflow Agent run/status/outputs', tokenEnv: 'AIHUB_AGENT_TOKEN', appIdSource: 'aihub-asset-production:seedance', alias: 'seedance', model: 'seedance' } },
  'outfit-film': { production: DANCE_ROUTE, route: { id: 'aihub-dance', label: 'AIHub 跳舞视频工作流', api: 'AIHub Workflow Agent run/status/outputs', tokenEnv: 'AIHUB_AGENT_TOKEN', appIdEnv: 'PAL_DANCE_WORKFLOW_APP_ID', alias: 'dressbattle-dance' } }
});
function parseImageSize(value) {
  const match = String(value || '').trim().match(/^(\d+)x(\d+)$/i);
  if (!match) return null;
  const width = Number(match[1]); const height = Number(match[2]);
  return width > 0 && height > 0 ? { width, height } : null;
}
function imageSizeFor(resource, env, model) {
  const configured = parseImageSize(env.AI_GATEWAY_IMAGE_SIZE || env.AIHUB_IMAGE_SIZE);
  const fallback = DEFAULT_RESOURCE_SIZES[resource.id] || '1920x2560';
  if (/gpt-image2/i.test(model)) {
    const configuredValue = configured ? `${configured.width}x${configured.height}` : '';
    if (AIHUB_GPT_IMAGE_SIZES.has(configuredValue)) return configuredValue;
    return resource.id === 'action-sheet' || resource.id === 'outfit-fx' ? '2048x2048' : '2160x3840';
  }
  /* The current gateway rejects requests below 3,686,400 pixels. Keep a user's
     larger valid size, but repair the old 1024x1536 default per resource. */
  if (!/jimeng/i.test(model) && configured && configured.width * configured.height >= MIN_GATEWAY_IMAGE_PIXELS) return `${configured.width}x${configured.height}`;
  if (/jimeng/i.test(model)) return resource.id === 'table-standee' ? '1728x2304' : fallback;
  return fallback;
}
function imageReferenceField(env) {
  return String(env.AI_GATEWAY_IMAGE_REFERENCE_FIELD || 'image_url').trim() || 'image_url';
}
function isRepairableFailure(value) {
  return /safety system|safety_violations|content[_ -]?filter|安全系统|内容审核|敏感内容|size[^\n]{0,80}(not valid|must be one of)|aspect_ratio[^\n]{0,120}(must be one of|not valid)|background[^\n]{0,80}must be one of|must be at least|必须输出带真实 alpha|尺寸/i.test(errorText(value));
}
function isCredentialFailure(value) {
  return /invalid token|invalid_token|无效的令牌|unauthorized|未授权|\b401\b/i.test(errorText(value));
}
function isProviderPermissionFailure(value) {
  return /permission to access.*bots|没有权限.*bot|无权访问.*bot|\b403\b/i.test(errorText(value));
}
function isAlphaPostProcessFailure(value) {
  return /去背景工作流未配置|remove-bg|透明处理|无法转为透明动作 WebM|edge screen-colour spill/i.test(errorText(value));
}
function isProviderStoppedFailure(value) {
  return /服务在图片请求处理中停止|任务(?:状态)?(?:为|是)?\s*(?:stopped|停止)|图片任务(?:状态)?(?:为|是)?\s*(?:stopped|停止)/i.test(errorText(value));
}
function isDanceContractFailure(value) {
  return /duration\s+is\s+required|duration[^\n]{0,80}input form/i.test(errorText(value));
}
function isTransientProviderFailure(value) {
  return /invalid response from (?:the )?upstream|upstream server|gateway timeout|timed? ?out|temporar(?:y|ily) unavailable|service unavailable|\b5\d\d\b/i.test(errorText(value));
}
function credentialFingerprint(env = process.env) {
  const token = String(env.AIHUB_AGENT_TOKEN || '').trim();
  return token ? createHash('sha256').update(token).digest('hex').slice(0, 16) : '';
}
function isAlphaOutputFailure(value) {
  return /真实 alpha|alpha 通道|transparent|透明通道/i.test(errorText(value));
}
function imageDimensions(bytes) {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = bytes.toString('ascii', 12, 16);
    if (chunk === 'VP8X' && bytes.length >= 30) return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
    if (chunk === 'VP8 ' && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
    if (chunk === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
      const b1 = bytes[21]; const b2 = bytes[22]; const b3 = bytes[23]; const b4 = bytes[24];
      return { width: 1 + b1 + ((b2 & 0x3f) << 8), height: 1 + (b2 >> 6) + (b3 << 2) + ((b4 & 0x0f) << 10) };
    }
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 4 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1];
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
      const length = bytes.readUInt16BE(offset + 2);
      if (length < 2 || offset + 2 + length > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
      }
      offset += 2 + length;
    }
  }
  return null;
}
function hasPngAlpha(bytes) {
  /* Validate decoded pixels, not just the IHDR flag. A fully opaque RGBA PNG
     has colour type 6 too, but it is still a matte and must be rejected. We
     intentionally support only non-interlaced 8-bit RGBA/GA PNGs; indexed
     tRNS is not an acceptable substitute for a browser-visible alpha channel. */
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!Buffer.isBuffer(bytes) || bytes.length < 33 || !bytes.subarray(0, 8).equals(signature)) return false;
  let width = 0; let height = 0; let bitDepth = 0; let colourType = 0; let interlace = 0; const idat = [];
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const dataStart = offset + 8; const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) return false;
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (type === 'IHDR') {
      if (length !== 13) return false;
      width = bytes.readUInt32BE(dataStart); height = bytes.readUInt32BE(dataStart + 4);
      bitDepth = bytes[dataStart + 8]; colourType = bytes[dataStart + 9]; interlace = bytes[dataStart + 12];
    } else if (type === 'IDAT') idat.push(bytes.subarray(dataStart, dataEnd));
    else if (type === 'IEND') break;
    offset = dataEnd + 4;
  }
  if (!width || !height || bitDepth !== 8 || ![4, 6].includes(colourType) || interlace !== 0 || !idat.length) return false;
  const channels = colourType === 6 ? 4 : 2;
  const rowBytes = width * channels;
  const expected = (rowBytes + 1) * height;
  if (!Number.isSafeInteger(expected) || expected > 100_000_000) return false;
  let decoded;
  try { decoded = inflateSync(Buffer.concat(idat)); } catch { return false; }
  if (decoded.length !== expected) return false;
  const current = Buffer.alloc(rowBytes); const previous = Buffer.alloc(rowBytes);
  let hasTransparent = false; let hasVisible = false; let cursor = 0;
  const paeth = (a, b, c) => { const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  for (let y = 0; y < height; y += 1) {
    const filter = decoded[cursor++];
    for (let x = 0; x < rowBytes; x += 1) {
      const raw = decoded[cursor++]; const left = x >= channels ? current[x - channels] : 0; const up = previous[x]; const upLeft = x >= channels ? previous[x - channels] : 0;
      current[x] = filter === 0 ? raw : filter === 1 ? (raw + left) & 255 : filter === 2 ? (raw + up) & 255 : filter === 3 ? (raw + Math.floor((left + up) / 2)) & 255 : filter === 4 ? (raw + paeth(left, up, upLeft)) & 255 : 0;
      if (![0, 1, 2, 3, 4].includes(filter)) return false;
    }
    for (let x = colourType === 6 ? 3 : 1; x < rowBytes; x += channels) { const alpha = current[x]; if (alpha < 255) hasTransparent = true; if (alpha > 0) hasVisible = true; }
    current.copy(previous);
  }
  return hasTransparent && hasVisible;
}
/* A PNG can technically contain alpha while still painting a casino/table
   scene right to the canvas edge. Runtime standees require a transparent
   canvas, not merely one transparent corner. This intentionally conservative
   gate only rejects images whose outer perimeter is predominantly opaque; a
   character touching the lower edge still passes. */
function hasTransparentCanvas(bytes) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!Buffer.isBuffer(bytes) || bytes.length < 33 || !bytes.subarray(0, 8).equals(signature)) return false;
  let width = 0; let height = 0; let bitDepth = 0; let colourType = 0; let interlace = 0; const idat = [];
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset); const start = offset + 8; const end = start + length;
    if (end + 4 > bytes.length) return false;
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (type === 'IHDR' && length === 13) { width = bytes.readUInt32BE(start); height = bytes.readUInt32BE(start + 4); bitDepth = bytes[start + 8]; colourType = bytes[start + 9]; interlace = bytes[start + 12]; }
    else if (type === 'IDAT') idat.push(bytes.subarray(start, end));
    else if (type === 'IEND') break;
    offset = end + 4;
  }
  if (!width || !height || bitDepth !== 8 || ![4, 6].includes(colourType) || interlace !== 0 || !idat.length) return false;
  const channels = colourType === 6 ? 4 : 2; const rowBytes = width * channels; const expected = (rowBytes + 1) * height;
  if (!Number.isSafeInteger(expected) || expected > 100_000_000) return false;
  let decoded; try { decoded = inflateSync(Buffer.concat(idat)); } catch { return false; }
  if (decoded.length !== expected) return false;
  const current = Buffer.alloc(rowBytes); const previous = Buffer.alloc(rowBytes); let cursor = 0; let border = 0; let opaqueBorder = 0; let transparentPixels = 0;
  const paeth = (a, b, c) => { const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  for (let y = 0; y < height; y += 1) {
    const filter = decoded[cursor++]; if (![0, 1, 2, 3, 4].includes(filter)) return false;
    for (let x = 0; x < rowBytes; x += 1) { const raw = decoded[cursor++]; const left = x >= channels ? current[x - channels] : 0; const up = previous[x]; const upLeft = x >= channels ? previous[x - channels] : 0; current[x] = filter === 0 ? raw : filter === 1 ? (raw + left) & 255 : filter === 2 ? (raw + up) & 255 : filter === 3 ? (raw + Math.floor((left + up) / 2)) & 255 : (raw + paeth(left, up, upLeft)) & 255; }
    for (let px = 0; px < width; px += 1) {
      const alpha = current[px * channels + (colourType === 6 ? 3 : 1)];
      if (alpha < 16) transparentPixels += 1;
      if (y === 0 || y === height - 1 || px === 0 || px === width - 1) { border += 1; if (alpha > 245) opaqueBorder += 1; }
    }
    current.copy(previous);
  }
  /* A thin transparent frame around an otherwise opaque white rectangle is
     not a cutout. Require meaningful transparent canvas area as well as a
     clean perimeter so those false positives cannot enter runtime slots. */
  return border > 0 && opaqueBorder / border < 0.18 && transparentPixels / (width * height) >= 0.12;
}
function findUrl(value, kind) {
  if (typeof value === 'string') {
    /* AIHub 的 mov-to-webm 将结果封装在 result[0].result 的 JSON 字符串中：
       {"downloadUrl":"…webm"}。先解包再走同一 URL 校验，不能把“工作流
       已成功”误判为“没有 URL”。 */
    const text = value.trim();
    if ((text.startsWith('{') || text.startsWith('[')) && text.length < 100_000) {
      try { const nested = JSON.parse(text); const hit = findUrl(nested, kind); if (hit) return hit; } catch { /* ordinary string */ }
    }
    if (!isUrl(value)) return null;
    const pattern = kind === 'video' ? /\.(?:mp4|webm|mov)(?:\?|$)/i : /\.(?:png|jpe?g|webp)(?:\?|$)/i;
    /* 签名下载 URL 经常没有文件扩展名；最终 MIME/大小校验在 materialize() 完成。 */
    return pattern.test(value) || value.includes('?') ? value : null;
  }
  if (Array.isArray(value)) { for (const item of value) { const hit = findUrl(item, kind); if (hit) return hit; } return null; }
  if (!value || typeof value !== 'object') return null;
  const record = value;
  const keys = kind === 'video' ? ['video_url', 'videoUrl', 'url', 'download_url', 'downloadUrl', 'output'] : ['image_url', 'imageUrl', 'url', 'download_url', 'downloadUrl', 'output'];
  for (const key of keys) { const hit = findUrl(record[key], kind); if (hit) return hit; }
  for (const nested of Object.values(record)) { const hit = findUrl(nested, kind); if (hit) return hit; }
  return null;
}
function hasWebmSignature(bytes) {
  /* EBML header: avoid trusting a CDN's generic application/octet-stream. */
  return Buffer.isBuffer(bytes) && bytes.length >= 4
    && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
}
function extensionFor(contentType, kind) {
  const type = String(contentType || '').toLowerCase();
  if (kind === 'video') return type.includes('webm') ? 'webm' : type.includes('quicktime') ? 'mov' : 'mp4';
  return type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
}
function promptFor(plan, resource, task = null) {
  const brief = task?.promptRevision === 'safety-safe-v2'
    ? 'a clearly 25+ professional fictional game companion with fully covered elegant wardrobe'
    : plan.intent.sourceText;
  const userPatch = task?.promptPatch ? ` HUMAN PROMPT PATCH (apply without changing identity or safety contract): ${task.promptPatch}` : '';
  if (resource.id === 'master-portrait') return `Create a character reference board for one original adult fictional game companion. Character: ${brief}. Clothing: ${plan.profileCard?.clothing?.prompt || ''}. Accessories: ${plan.profileCard?.accessory?.prompt || ''}. Include a full-body identity reference, headshot, clothing and accessory details, and clearly separated action references for idle, play, pass, win and lose. This board is for human confirmation and downstream production, never a runtime standee. Keep panels separate and identity consistent. ${plan.styleLock || LINXING_STYLE_LOCK} ${PAL_IDENTITY_SEPARATION_LOCK}${userPatch}`;
  if (resource.id === 'first-outfit') {
    /* 服装必须来自计划（profileCard 的服装与配饰选择），与角色资料卡一致；
       不再使用历史上写死的「黑色高领晚装夹克裙+酒红披肩」通用模板。 */
    const outfitProfile = plan.profileCard || {};
    const outfitClothing = outfitProfile.clothing?.prompt || plan.intent?.clothingLabel || 'the clothing described in the brief';
    const outfitAccessory = outfitProfile.accessory?.prompt || plan.intent?.accessoryLabel || 'no novelty accessory';
    return `Create an original 3:4 vertical fashion portrait for the fictional Chinese card-game companion described here: ${brief}. Show a fully clothed full figure with comfortable space above her head and below the garment hem. Wardrobe: ${outfitClothing}. Accessories: ${outfitAccessory}. The outfit must match the character's confirmed role profile card exactly — same garments, colors, materials and accessories; opaque quality fabrics and elegant clean tailoring. Use a calm, self-possessed catalogue pose; focus on her face, silhouette, garment construction and textile detail. Match this game's established art direction: ${plan.styleLock || LINXING_STYLE_LOCK} ${PAL_IDENTITY_SEPARATION_LOCK} Keep one consistent fictional character identity. Original illustration only; never draw a checkerboard, white matte, gray matte or placeholder grid. No lettering, brand marks or watermark.${userPatch}`;
  }
  if (resource.id === 'outfit-fx') {
    /* This is an overlay, not a costume portrait. Keep the character brief,
       face, body, action vocabulary and reference-board language out of this
       node entirely so the model has no incentive to draw a person. */
    const safePatch = String(task?.promptPatch || '').trim();
    const effectPatch = safePatch.length >= 3 && !/^\d+$/.test(safePatch) ? ` HUMAN EFFECT NOTE: ${safePatch}` : '';
    return `Create one original square PNG overlay for a premium Chinese card-game outfit reveal. EFFECTS ONLY: sparse champagne-gold light ribbons, tiny blue-violet sparkle particles and a soft fabric-like glint concentrated around the lower and side edges. The centre must remain mostly empty so it can be composited over the existing costume portrait. Absolutely no person, face, body, hand, clothing, cat ears, mannequin, silhouette, portrait, pose, sprite sheet, collage, character reference board, cards, table, room, text, logo, watermark, frame, background, shadow plate, checkerboard, white/grey/black matte or opaque backdrop. Output a single RGBA PNG with real per-pixel alpha; all unused canvas pixels must be fully transparent. Match only this game's midnight navy, violet and restrained champagne-gold visual language: ${plan.styleLock || LINXING_STYLE_LOCK}${effectPatch}`;
  }
  const role = {
    avatar: '1:1 head-and-shoulders character avatar, exactly one person, face readable at small size, no collage or multiple poses, no checkerboard or matte',
    'table-standee': '3:4 true-alpha transparent-background half-body seated card-table standee, exactly one character, leave hands and card area unobstructed, never draw a checkerboard or matte',
    'lounge-standee': 'one single half-body vertical lobby hero standee, clean silhouette and breathing space for title copy, true alpha transparency, never draw a checkerboard or matte; do not make a sprite sheet, collage, contact sheet, action strip, full-body lineup, or multiple poses',
    'first-outfit': '3:4 original first-outfit photo-card illustration, full figure, clear costume layers, no checkerboard or white matte background',
    'action-sheet': '3 by 2 game sprite sheet with exactly five readable poses: idle, play card, pass, win, lose; true-alpha transparent background, no checkerboard',
    'action-image-A01': 'one single idle action pose, half-body, true-alpha transparent background, fixed 4:5 anchor, no collage',
    'action-image-A02': 'one single card-playing gesture, half-body, true-alpha transparent background, fixed 4:5 anchor, no collage; open palm or finger-flick toward the table, with no visible playing card, card face, flying card, heart symbol or foreground prop',
    'action-image-A03': 'one single pass action pose, half-body, true-alpha transparent background, fixed 4:5 anchor, no collage',
    'action-image-A04': 'one single restrained victory action pose, half-body, true-alpha transparent background, fixed 4:5 anchor, no collage',
    'action-image-A05': 'one single composed defeat action pose, half-body, true-alpha transparent background, fixed 4:5 anchor, no collage',
    'outfit-fx': 'true-alpha transparent PNG costume effect layer only, no face, no text, no cards, no checkerboard',
    'outfit-poster': 'portrait video-poster still for a card game photo collection, 3:4 composition, no text'
  }[resource.id] || resource.label;
  const profile = plan.profileCard || {};
  const clothing = profile.clothing?.prompt || plan.intent?.clothingLabel || 'the clothing described in the brief';
  const accessory = profile.accessory?.prompt || plan.intent?.accessoryLabel || 'no novelty accessory';
  const actions = profile.actions ? Object.values(profile.actions).join('; ') : 'idle, play card, pass, win and lose';
  const alphaContract = ALPHA_IMAGE_RESOURCES.has(resource.id)
    ? 'ALPHA OUTPUT CONTRACT: return a PNG with decoded per-pixel alpha (RGBA or grayscale+alpha), with genuinely transparent pixels around the subject and visible subject pixels; never fake transparency with a white, gray, black or checkerboard matte; do not return JPEG or an opaque RGB PNG.'
    : '';
  const compositionLock = resource.id === 'lounge-standee'
    ? 'LOBBY COMPOSITION LOCK: output exactly one character only, cropped from mid-torso upward, centered with empty negative space around the silhouette for the lobby title. The canvas outside the silhouette must be genuinely transparent: no room, table, chair, floor, skyline, shadow plate, vignette or background lighting. Do not reproduce the reference profile-card layout or its five-action strip.'
    : resource.id.startsWith('action-image-')
      ? 'ACTION IMAGE COMPOSITION LOCK: exactly one person and one action only; same camera, scale, foot/torso anchor and silhouette bounds as the other action images; transparent canvas only, with no room, table, chair, floor, prop, background shadow, card sheet, captions or extra pose. For A02, the gesture alone communicates playing: do not render any card or foreground object that could be mistaken for background during alpha extraction.'
    : resource.id === 'action-sheet'
      ? 'SPRITE COMPOSITION LOCK: output one 3-column by 2-row sheet, exactly five distinct poses in fixed cells (idle, play, pass, win, lose) and one empty cell; no captions, no borders, no extra character.'
      : resource.id === 'avatar'
        ? 'AVATAR COMPOSITION LOCK: exactly one head-and-shoulders portrait, centered, face and hair fully inside the frame, no full-body figure, no action strip and no extra person.'
        : resource.id === 'table-standee'
          ? 'TABLE COMPOSITION LOCK: exactly one half-body seated character, centered, no poster typography, no extra poses, no collage and no scene lineup. The canvas outside the person must be genuinely transparent: no table surface, chair, floor, room, skyline, backdrop, cast-shadow plate or decorative frame.'
      : '';
  return `Original game asset for a clearly 25+ professional fictional Chinese 斗地主 game companion. ${role}. Character brief: ${brief}. Outfit/personality variation: ${plan.intent.style}. Selected clothing: ${clothing}. Selected accessory: ${accessory}. Role profile actions: ${actions}. ${compositionLock} ${alphaContract} ${plan.styleLock || LINXING_STYLE_LOCK} ${PAL_IDENTITY_SEPARATION_LOCK} Preserve one consistent new character identity across this package, fully clothed and tasteful, no real person, no celebrity likeness, no school-age appearance, no logo, no watermark, no readable text.${userPatch}`;
}
function danceInputs(plan, resource, env, referenceUrl) {
  const templateText = String(env.PAL_DANCE_INPUTS_JSON || '{}').trim();
  let template;
  try { template = JSON.parse(templateText); } catch { throw new Error('PAL_DANCE_INPUTS_JSON 必须是 JSON 对象。'); }
  if (!template || Array.isArray(template) || typeof template !== 'object') throw new Error('PAL_DANCE_INPUTS_JSON 必须是 JSON 对象。');
  const promptField = String(env.PAL_DANCE_PROMPT_FIELD || 'prompt').trim();
  const referenceField = String(env.PAL_DANCE_REFERENCE_FIELD || 'image_url').trim();
  const videoReferenceField = String(env.PAL_DANCE_VIDEO_FIELD || 'video_url').trim();
  const referenceLabel = resource.id === 'outfit-film' ? '首套服装写真卡面' : '角色资料卡';
  if (!isUrl(referenceUrl)) throw new Error(`跳舞视频缺少可由 AIHub 访问的${referenceLabel} image_url。`);
  const videoReferenceUrl = String(plan.danceReferenceVideoUrl || DEFAULT_DANCE_REFERENCE_VIDEO_URL).trim();
  if (!isUrl(videoReferenceUrl)) throw new Error('跳舞视频参考 video_url 必须是 HTTPS 公网地址。');
  const action = { 'outfit-film': 'an uninterrupted eight-second full-body dance performance: clear rhythmic side-steps, arm choreography and a turn; never a runway walk, static fashion pose or slow model presentation' }[resource.id] || resource.label;
  const consistencyLock = resource.id === 'outfit-film'
    ? 'CHARACTER AND OUTFIT CONSISTENCY LOCK: image_url is the approved first-outfit card. Preserve the exact same fictional character identity, face, hairstyle, body proportions, costume silhouette, colors, materials and accessories from that image throughout the video; do not redesign, replace or omit any outfit element. CHOREOGRAPHY TIMELINE (mandatory): 0–2s perform visible rhythmic side-steps and arm choreography; 2–4s continue the dance with a turn and hand sequence; 4–6s continue moving on beat while naturally unfastening and removing only the outer jacket/scarf layer; 6–8s keep dancing with two further steps after the outer layer is off. DANCE-AND-UNDRESS CONTRACT: full body remains visible, movement continues in every shot, no runway walk, no static fashion pose, no frozen presentation, no close-up that hides the dance, no jump-cut into a different costume, do not restore removed layers, and keep the final base outfit fully covered.'
    : 'CHARACTER CONSISTENCY LOCK: Preserve the exact same fictional character identity, face, hairstyle, body proportions and visual treatment from image_url throughout the video.';
  const outputContract = ACTION_VIDEO_RESOURCES.has(resource.id)
    ? 'OUTPUT CONTRACT: return one short 4:5 transparent VP9 WebM, with genuine per-frame alpha, one character only, fixed camera and no background plate; do not return MP4, H.264, RGB-only video, collage or opaque matte.'
    : '';
  const videoReferenceLock = 'VIDEO REFERENCE LOCK: video_url controls only dance rhythm, camera language and movement texture. It must not replace the character, outfit, art direction or setting defined by image_url.';
  const profile = plan.profileCard || {};
  const wardrobe = plan.wardrobeManifest || {};
  const removableLayers = Array.isArray(wardrobe.layers) ? wardrobe.layers.filter((layer) => layer.removable).map((layer) => layer.name).join(' → ') : 'outer accessories and garments one by one';
  const profileDetails = `ROLE PROFILE CARD: character=${profile.character?.name || plan.identity?.name || 'new companion'}; clothing=${profile.clothing?.label || plan.intent?.clothingLabel || 'brief-defined'}; accessory=${profile.accessory?.label || plan.intent?.accessoryLabel || 'none'}; action set=${profile.actions ? Object.values(profile.actions).join(', ') : 'idle/play/pass/win/lose'}; wardrobe layers to remove in dance=${removableLayers}; final base layer=${wardrobe.finalBaseLayer || 'fully covered base outfit'}.`;
  return {
    ...template,
    duration: String(env.PAL_DANCE_DURATION || '8'),
    [promptField]: `Adult fictional Chinese game companion. ${action}. Character brief: ${plan.intent.sourceText}. ${plan.intent.style} outfit/personality variation. ${profileDetails} ${consistencyLock} ${outputContract} ${videoReferenceLock} ${plan.styleLock || LINXING_STYLE_LOCK} ${PAL_IDENTITY_SEPARATION_LOCK} One person only, continuous dance performance only, no runway presentation, no nudity, no exposed intimate areas, no real-person likeness, no watermark, no text.`,
    [referenceField]: referenceUrl,
    [videoReferenceField]: videoReferenceUrl
  };
}
function seedanceInputs(plan, resource, referenceUrl) {
  const actionReference = ACTION_VIDEO_RESOURCES.has(resource.id);
  const referenceLabel = actionReference ? `${resource.id.replace('action-', '').toUpperCase()} 动作 PNG` : '角色资料卡';
  if (!isUrl(referenceUrl)) throw new Error(`Seedance 视频缺少可由 AIHub 访问的${referenceLabel} image_url。`);
  const action = {
    'entry-film': 'STRICT HORIZONTAL 16:9 LANDSCAPE CAMERA. Start just outside frame left, enter the card-room in one continuous wide shot, walk naturally to the assigned seat, make a small greeting and settle into one clear final seated pose. Keep the complete head, hair and accessories inside the upper safe margin for the entire clip; no portrait framing, no vertical crop, no montage, no duplicate person, no pose collage',
    'action-a01': 'a subtle idle breathing loop with natural blinking',
    'action-a02': 'a clear card-playing gesture toward the table',
    'action-a03': 'a restrained pass gesture with a calm expression',
    'action-a04': 'a controlled victory reaction after winning the round',
    'action-a05': 'a composed defeat reaction after losing the round'
  }[resource.id] || resource.label;
  const profile = plan.profileCard || {};
  const profileDetails = `ROLE PROFILE CARD: character=${profile.character?.name || plan.identity?.name || 'new companion'}; clothing=${profile.clothing?.label || plan.intent?.clothingLabel || 'brief-defined'}; accessory=${profile.accessory?.label || plan.intent?.accessoryLabel || 'none'}; action set=${profile.actions ? Object.values(profile.actions).join(', ') : 'idle/play/pass/win/lose'}.`;
  const alphaActionContract = ACTION_VIDEO_RESOURCES.has(resource.id)
    ? 'ACTION ALPHA SOURCE CONTRACT — SOURCE PLATE ONLY, NOT A FINISHED SCENE: render exactly one fully clothed adult fictional character on an evenly lit, edge-to-edge, solid chroma green #00FF00 background. The green must fill every pixel outside the silhouette, including between arms, hands, legs, hair and accessories. Keep a wide continuous green margin around the full silhouette on every frame. Fixed camera; no table, chair, floor, cards, props, shadow plate, scenery, gradient, vignette, smoke, text, cutaway, extra person, collage, opaque white/grey matte or background. Hands must remain separated from the torso enough to show green between them. This source is deterministically keyed into transparent VP9 WebM after generation.'
    : '';
  const referenceLock = actionReference
    ? `ACTION PNG REFERENCE LOCK: image_url_list is the approved ${resource.id.replace('action-', '').toUpperCase()} action PNG, not a generic role card. Start from exactly that pose, framing, body scale, costume and accessory placement; animate only the natural micro-movement required by ${resource.id}. Do not substitute another pose or action.`
    : 'IMAGE REFERENCE LOCK: preserve the exact same fictional character identity, face, hairstyle, body proportions, clothing silhouette, colors, materials and accessories from image_url_list; do not redesign the character.';
  const prompt = `Adult fictional Chinese card-game companion. ${action}. ${profileDetails} ${referenceLock} Keep a tasteful fully clothed card-room outfit: structured top with sleeves plus a high-waist skirt or trousers; no lingerie, swimsuit, underwear, exposed torso, extreme cleavage or exposed upper thighs. ${alphaActionContract} ${plan.styleLock || LINXING_STYLE_LOCK} ${PAL_IDENTITY_SEPARATION_LOCK} One person only, fully clothed, non-sexualized, no real-person likeness, no watermark, no text.`;
  /* 入场视频是横版 16:9（开局入席演出，与正式入场片格式一致）；
     五态动作才是竖屏 3:4（牌桌半身镜头）。 */
  const portraitVideo = new Set(['action-a01', 'action-a02', 'action-a03', 'action-a04', 'action-a05']).has(resource.id);
  const videoSpec = portraitVideo ? '竖屏 3:4' : resource.id === 'entry-film' ? '横屏 16:9' : '自动 adaptive';
  return {
    prompt,
    /* 五态动作是“单张审核动作图→轻微动画”，但 AIHub Seedance
       当前的“首尾帧生视频”线路会将已提交的 image_url_list 误判为
       “首帧图片为空”。动作片不需要首尾帧循环，因此统一用“全能参考”
       的单图生视频路径；上面的 ACTION PNG REFERENCE LOCK 仍保证身份、
       服装和起始姿势不变。 */
    Production_method: '全能参考',
    Video_specifications: videoSpec,
    duration: '4',
    resolution: '1080p',
    is_3d_digital_human: '否',
    image_url_list: referenceUrl,
    video_url_list: '',
    audio_url_list: ''
  };
}
function danceHeaders(env) {
  const headers = { Authorization: `${String(env.AIHUB_DANCE_AUTH_SCHEME || 'Bearer').trim()} ${String(env.AIHUB_DANCE_API_KEY)}`, 'Content-Type': 'application/json' };
  const appId = String(env.PAL_DANCE_BOT_ID || '').trim(); if (appId) headers['X-App-Id'] = appId;
  const projectKey = String(env.AIHUB_DANCE_PROJECT_KEY || '').trim(); if (projectKey) headers['X-Project-Key'] = projectKey;
  const sdpAppId = String(env.AIHUB_DANCE_SDP_APP_ID || '').trim(); if (sdpAppId) headers['sdp-app-id'] = sdpAppId;
  return headers;
}

export function providerCapability(env = process.env) {
  const imageTokenReady = Boolean(String(env.AIHUB_AGENT_TOKEN || '').trim());
  const roleImageReady = imageTokenReady && Boolean(skillAppId('gpt-image2', env));
  const staticImageReady = imageTokenReady && Boolean(skillAppId('jimeng', env));
  const agentDanceReady = Boolean(String(env.AIHUB_AGENT_TOKEN || '').trim() && String(env.PAL_DANCE_WORKFLOW_APP_ID || '').trim());
  const seedanceReady = imageTokenReady && Boolean(skillAppId('seedance', env));
  const botDanceReady = Boolean(String(env.AIHUB_DANCE_API_KEY || '').trim());
  const danceReady = agentDanceReady || botDanceReady;
  return {
    configured: roleImageReady || staticImageReady || seedanceReady || danceReady,
    image: {
      configured: roleImageReady && staticImageReady,
      label: 'AIHub 素材生产中心（资料卡与透明资产 GPT Image 2，其余图片即梦 5.0）',
    model: `${DEFAULT_IMAGE_MODEL}（仅角色资料卡） + ${DEFAULT_IMAGE_FALLBACK_MODEL}（头像、立绘、动作图、服装图）`,
    roleProfile: { configured: roleImageReady, alias: 'gpt-image2', missing: roleImageReady ? [] : ['AIHUB_AGENT_TOKEN'] },
      alpha: { configured: staticImageReady, alias: 'jimeng', missing: staticImageReady ? [] : ['AIHUB_AGENT_TOKEN'] },
      static: { configured: staticImageReady, alias: 'jimeng', missing: staticImageReady ? [] : ['AIHUB_AGENT_TOKEN'] },
      missing: roleImageReady && staticImageReady ? [] : ['AIHUB_AGENT_TOKEN']
    },
    video: {
      configured: seedanceReady || danceReady,
      label: 'AIHub 视频生产中心（Seedance 2.0；仅跳舞视频走指定工作流）',
      transport: seedanceReady || agentDanceReady ? 'AIHub Agent run/status/outputs' : botDanceReady ? 'Bot API SSE' : null,
      defaultReferenceUrl: DEFAULT_DANCE_REFERENCE_VIDEO_URL,
      seedance: { configured: seedanceReady, label: 'AIHub · Seedance 2.0（其他视频）', alias: 'seedance', missing: seedanceReady ? [] : ['AIHUB_AGENT_TOKEN'] },
      dance: { configured: danceReady, label: 'AIHub 跳舞视频工作流', missing: danceReady ? [] : ['AIHUB_AGENT_TOKEN', 'PAL_DANCE_WORKFLOW_APP_ID'] },
      missing: [...new Set([
        ...(!seedanceReady ? ['AIHUB_AGENT_TOKEN'] : []),
        ...(!danceReady ? ['AIHUB_AGENT_TOKEN', 'PAL_DANCE_WORKFLOW_APP_ID'] : [])
      ])]
    },
      note: '只有角色资料卡使用 AIHub GPT Image 2；头像、上桌/大厅立绘、五态动作图、服装图和写真图统一使用 AIHub 即梦 5.0，并按资源契约检查或恢复真实 alpha；入场与五态动作视频使用 AIHub Seedance，只有首套跳舞视频使用指定 AIHub 跳舞工作流。'
  };
}

export class PalResourcePipeline {
  constructor({ assetDir, assetUrlPrefix = '/assets/pals/ugc', statePath, env = process.env, onReady = () => {} } = {}) {
    if (!assetDir || !statePath) throw new Error('PalResourcePipeline requires assetDir and statePath.');
    this.assetDir = assetDir; this.assetUrlPrefix = assetUrlPrefix.replace(/\/$/, ''); this.statePath = statePath; this.env = env; this.onReady = onReady;
    this.tasks = new Map(); this.deletedPlanIds = []; this.portraitApprovals = new Map(); this.sourceBindings = new Map(); this.referenceChecks = new Map(); this.locks = new Map(); this.lastRefreshAt = 0; this.persistTail = Promise.resolve(); this.ready = this.restore();
  }

  capability() { return providerCapability(this.env); }
  assetPath(publicUrl) {
    const clean = String(publicUrl || '').split('?')[0];
    const prefix = `${this.assetUrlPrefix}/`;
    if (!clean.startsWith(prefix)) throw new Error(`资源地址不属于受管 UGC 目录：${clean || 'empty'}`);
    const relative = decodeURIComponent(clean.slice(prefix.length));
    const segments = relative.split('/').filter(Boolean);
    if (!segments.length || segments.some((segment) => segment === '..')) throw new Error('UGC 资源地址包含非法路径。');
    return join(this.assetDir, ...segments);
  }
  assetUrl(relativePath) {
    return `${this.assetUrlPrefix}/${String(relativePath).replace(/\\/g, '/')}`;
  }
  assetFolder(plan) { return assetFolderName(plan); }
  async restore() {
    try {
      const parsed = JSON.parse(await readFile(this.statePath, 'utf8'));
      this.deletedPlanIds = Array.isArray(parsed?.deletedPlanIds) ? parsed.deletedPlanIds.map(String) : [];
      for (const task of Array.isArray(parsed?.tasks) ? parsed.tasks : []) if (task?.taskId) this.tasks.set(task.taskId, task);
    for (const approval of Array.isArray(parsed?.portraitApprovals) ? parsed.portraitApprovals : []) if (approval?.planId) this.portraitApprovals.set(approval.planId, approval);
    for (const binding of Array.isArray(parsed?.sourceBindings) ? parsed.sourceBindings : []) if (binding?.key && isUrl(binding?.sourceUrl)) this.sourceBindings.set(binding.key, binding);
    } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    let recovered = this.pruneStaleFailures();
    for (const task of this.tasks.values()) {
      if (task.error) { const normalizedError = errorText(task.error); if (normalizedError !== task.error) { task.error = normalizedError; recovered = true; } }
      const upgradedPlan = upgradePalResourcePlan(task.planSnapshot);
      if (upgradedPlan && upgradedPlan !== task.planSnapshot) { task.planSnapshot = upgradedPlan; recovered = true; }
      if (migratePendingVideoTask(task, this.env)) recovered = true;
      /* Historical Seedance clips were ordinary scene MP4s. They cannot be
         represented as table actions just because a file was downloaded: the
         current contract requires a green-screen source followed by verified
         VP9 alpha conversion. Fail these closed and retain the record so the
         workshop can restart/reproduce the exact slot. */
      if (ACTION_VIDEO_RESOURCES.has(task.resourceId) && task.status === 'SUCCEEDED' && /\.mp4(?:\?|$)/i.test(String(task.publicUrl || ''))) {
        task.status = 'FAILED'; task.reviewStatus = 'REJECTED'; task.retryLocked = false;
        task.error = '历史动作视频是带场景的 MP4，不符合透明 VP9 WebM 合同；请按当前纯绿幕提示词重产，系统会自动抠像并生成预览。';
        task.updatedAt = now(); recovered = true;
      }
      if (task.resourceId === 'outfit-film' && task.status === 'SUCCEEDED' && task.promptRevision && task.promptRevision !== OUTFIT_DANCE_PROMPT_REVISION) {
        task.reviewStatus = 'REJECTED';
        task.qualityNote = '旧版视频提示词未包含连续跳舞换装时间线，不能继续作为合格演出资产；请按新版合同重产。';
        task.error = '旧版跳舞视频提示词不足以保证“持续跳舞中自然脱去外层”；已从可应用资产中撤回，保留原文件供核对。';
        recovered = true;
      }
      if (task.kind === 'image' && task.resourceId !== 'action-sheet' && ALPHA_IMAGE_RESOURCES.has(task.resourceId) && task.status === 'SUCCEEDED' && task.publicUrl) {
        try {
          const image = await readFile(this.assetPath(task.publicUrl));
          const dimensions = imageDimensions(image);
          if (dimensions && dimensions.width >= 500 && dimensions.height >= 500 && (!hasPngAlpha(image) || !hasTransparentCanvas(image))) {
            task.status = 'FAILED'; task.reviewStatus = 'REJECTED'; task.retryLocked = false;
            task.error = '历史透明图片带有场景、桌面、白底或不合格透明边缘；已从运行时撤回，请按当前透明画布合同重产。';
            task.updatedAt = now(); recovered = true;
          }
        } catch { /* Missing historic file is handled by its regular display/retry path. */ }
      }
      if (task.kind !== 'image' || !['QUEUED', 'RUNNING'].includes(task.status) || task.publicUrl) continue;
      task.updatedAt = now();
      if (Number(task.attempt || 0) < 2) {
        task.status = 'RETRY_WAITING';
        task.error = '服务在图片请求处理中停止，结果未知；流水线将按相同输入进行唯一一次恢复重试。';
        task.retryLocked = false;
      } else {
        task.status = 'FAILED';
        task.error = '服务在图片请求处理中停止，且该任务已用完一次恢复重试。';
        task.retryLocked = true;
      }
      recovered = true;
    }
    if (recovered) await this.persist();
  }
  /*
     A slot may have several historical attempts (for example A01 attempt 1,
     attempt 2, and the current attempt 3).  Keeping every old failure makes
     the workshop task list look permanently broken and obscures the task that
     can actually be retried.  Retain the newest record for each plan/slot;
     remove only failed records that have a newer record for the same slot.
     A latest failure is deliberately kept so the user can inspect/retry it.
     Tasks belonging to a deleted plan are hidden from the list below and are
     not used as a reason to retain historical failures.
  */
  pruneStaleFailures() {
    const failed = new Set(['FAILED', 'BLOCKED_REFERENCE']);
    const groups = new Map();
    for (const task of this.tasks.values()) {
      if (!task?.taskId || !task.planId || !task.resourceId) continue;
      const key = `${task.planId}:${task.resourceId}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(task);
    }
    const stale = [];
    for (const entries of groups.values()) {
      const ordered = entries.slice().sort((a, b) => {
        const time = String(a.updatedAt || a.createdAt || '').localeCompare(String(b.updatedAt || b.createdAt || ''));
        return time || String(a.taskId).localeCompare(String(b.taskId));
      });
      const newest = ordered[ordered.length - 1];
      for (const task of ordered) {
        if (failed.has(task.status) && task !== newest) stale.push(task.taskId);
      }
    }
    for (const taskId of stale) this.tasks.delete(taskId);
    return stale.length > 0;
  }
  async persist() {
    const writeSnapshot = async () => {
      await mkdir(dirname(this.statePath), { recursive: true });
      const temp = `${this.statePath}.${randomUUID()}.tmp`;
      await writeFile(temp, JSON.stringify({ version: 4, tasks: [...this.tasks.values()], deletedPlanIds: this.deletedPlanIds, portraitApprovals: [...this.portraitApprovals.values()], sourceBindings: [...this.sourceBindings.values()] }, null, 2), 'utf8');
      await rename(temp, this.statePath);
    };
    const operation = this.persistTail.then(writeSnapshot, writeSnapshot);
    this.persistTail = operation.catch(() => {});
    await operation;
  }
  list(planId = null) { return [...this.tasks.values()].filter((task) => !planId || task.planId === planId).map(publicTask).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
  async deleteTask(taskId) {
    await this.ready;
    const task = this.tasks.get(String(taskId || ''));
    if (!task) throw new Error('生产任务不存在或已删除。');
    if (ACTIVE.has(task.status) || this.locks.has(task.taskId)) throw new Error('生产任务仍在排队、提交或运行中，不能删除；请等任务结束后再移除记录。');
    this.tasks.delete(task.taskId);
    await this.persist();
    return { status: 'DELETED', taskId: task.taskId, planId: task.planId, resourceId: task.resourceId, filePreserved: Boolean(task.publicUrl) };
  }
  async deletePlan(planId) {
    await this.ready;
    const id = String(planId || '').trim();
    if (!id) throw new Error('缺少资源计划 ID。');
    const tasks = [...this.tasks.values()].filter((task) => task.planId === id);
    const active = tasks.find((task) => ACTIVE.has(task.status) || this.locks.has(task.taskId));
    if (active) throw new Error('资源计划仍有生产任务在排队、提交或运行中，暂不能删除；请等待任务结束后再移除计划。');
    for (const task of tasks) task.planDeleted = true;
    if (!Array.isArray(this.deletedPlanIds)) this.deletedPlanIds = [];
    if (!this.deletedPlanIds.includes(id)) this.deletedPlanIds.push(id);
    this.portraitApprovals.delete(id);
    await this.persist();
    return { status: 'DELETED', planId: id, taskCount: tasks.length, filePreserved: tasks.some((task) => Boolean(task.publicUrl)) };
  }
  plans() {
    const plans = new Map();
    const deleted = new Set(this.deletedPlanIds || []);
    for (const task of this.tasks.values()) {
      const upgradedPlan = upgradePalResourcePlan(task.planSnapshot);
      if (upgradedPlan && upgradedPlan !== task.planSnapshot) task.planSnapshot = upgradedPlan;
      if (task.planSnapshot?.identity && !task.planSnapshot.identity.name) task.planSnapshot.identity.name = assetFolderName(task.planSnapshot);
      if (task.planSnapshot?.planId && !deleted.has(task.planSnapshot.planId) && !plans.has(task.planSnapshot.planId)) plans.set(task.planSnapshot.planId, task.planSnapshot);
    }
    return [...plans.values()];
  }
  async pruneSupersededTasks() {
    await this.ready;
    const groups = new Map();
    for (const task of this.tasks.values()) {
      if (!task?.planId || !task?.resourceId || task.planDeleted) continue;
      const key = `${task.planId}:${task.resourceId}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(task);
    }
    const removed = [];
    for (const entries of groups.values()) {
      const ordered = entries.slice().sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
      const newest = ordered[0];
      for (const task of ordered.slice(1)) {
        const superseded = task.reviewStatus === 'REJECTED' || ['FAILED', 'BLOCKED_REFERENCE'].includes(task.status) || task.ignoreProviderOutput;
        if (!superseded || this.locks.has(task.taskId)) continue;
        this.tasks.delete(task.taskId);
        removed.push({ taskId: task.taskId, planId: task.planId, resourceId: task.resourceId, replacedBy: newest.taskId });
      }
    }
    if (removed.length) await this.persist();
    return { status: 'PRUNED', removedCount: removed.length, removed };
  }
  latestTask(plan, resourceId) {
    return [...this.tasks.values()]
      .filter((task) => task.planId === plan.planId && task.resourceId === resourceId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] || null;
  }
  roleProfileUrl(plan) {
    const portrait = this.latestTask(plan, 'master-portrait');
    return portrait?.status === 'SUCCEEDED' && isUrl(portrait.sourceUrl) ? portrait.sourceUrl : null;
  }
  referenceResourceId(resourceId) {
    /* 首套服装是跳舞换装视频与 Poster 的唯一视觉来源。每条动作 WebM 则必须
       使用同编号的单张 Action PNG：A02 出牌视频只能读 A02 出牌图，不能再把
       角色资料卡或其他动作图作为 image_url。这既固定姿势/服装，也让某一张
       动作图失败时只阻塞同编号视频，不会污染整包。 */
    if (resourceId === 'outfit-film') return 'first-outfit';
    if (resourceId === 'outfit-poster') return 'outfit-film';
    if (ACTION_VIDEO_RESOURCES.has(resourceId)) return `action-image-${resourceId.slice('action-'.length).toUpperCase()}`;
    return 'master-portrait';
  }
  referenceUrl(plan, resourceId) {
    if (!resourceId) return null;
    const reference = this.latestTask(plan, resourceId);
    if (reference?.status === 'SUCCEEDED' && isUrl(reference.sourceUrl)) return reference.sourceUrl;
    return this.sourceBindings.get(`${plan.planId}:${resourceId}`)?.sourceUrl || null;
  }
  portraitGate(plan) {
    const portrait = this.latestTask(plan, 'master-portrait');
    const approval = this.portraitApprovals.get(plan.planId);
    const profileCardUrl = portrait?.status === 'SUCCEEDED' && isUrl(portrait.sourceUrl) ? portrait.sourceUrl : null;
    let status = 'NOT_STARTED';
    if (portrait?.reviewStatus === 'REJECTED') status = 'FAILED';
    else if (approval && profileCardUrl && portrait?.status === 'SUCCEEDED' && approval.taskId === portrait.taskId && approval.sha256 === portrait.sha256) status = 'CONFIRMED';
    else if (portrait?.status === 'SUCCEEDED' && portrait.publicUrl && portrait.sha256 && profileCardUrl) status = 'AWAITING_CONFIRMATION';
    else if (portrait?.status === 'SUCCEEDED' && portrait.publicUrl && portrait.sha256) status = 'WAITING_REFERENCE';
    else if (portrait && ACTIVE.has(portrait.status)) status = 'GENERATING';
    else if (portrait && ['FAILED', 'BLOCKED_REFERENCE'].includes(portrait.status)) status = 'FAILED';
    return {
      status,
      taskId: portrait?.taskId || null,
      publicUrl: portrait?.status === 'SUCCEEDED' ? portrait.publicUrl : null,
      profileCardUrl,
      sha256: portrait?.status === 'SUCCEEDED' ? portrait.sha256 : null,
      bytes: portrait?.status === 'SUCCEEDED' ? portrait.bytes : null,
      error: portrait?.error || null,
      confirmedAt: status === 'CONFIRMED' ? approval.confirmedAt : null
    };
  }
  enrichPlan(plan) {
    const latest = new Map();
    for (const task of this.tasks.values()) if (task.planId === plan.planId && (!latest.has(task.resourceId) || latest.get(task.resourceId).updatedAt < task.updatedAt)) latest.set(task.resourceId, task);
    const resources = plan.resources.map((resource) => ({ ...resource, mapping: RESOURCE_SLOTS[resource.id] || null, ...(DISPLAY_ROUTE_BY_RESOURCE[resource.id] || {}), task: latest.has(resource.id) ? publicTask(latest.get(resource.id)) : null }));
    const required = resources.filter((resource) => resource.requiredForSeat);
    const failed = required.filter((resource) => ['FAILED', 'BLOCKED_REFERENCE'].includes(resource.task?.status));
    const active = required.filter((resource) => resource.task?.active);
    /* 资源逐项的 AWAITING_REVIEW 是“可打回”的质量记录，不应把已通过
       文件/规格校验的完整包困在“可继续生产”。整包齐全后先进入可确认资产，
       由用户在候选卡上确认并应用到牌局；任一 REJECTED 仍会立即撤销资格。 */
    const complete = required.every((resource) => resource.task?.status === 'SUCCEEDED' && resource.task?.reviewStatus !== 'REJECTED' && (!ACTION_VIDEO_RESOURCES.has(resource.id) || resource.task?.alphaVisualApproved === true));
    const deliveryState = complete ? 'RICH_ASSETS_READY' : failed.length ? 'ASSET_REWORK_REQUIRED' : active.length ? 'ASSET_PRODUCING' : 'ASSET_PENDING';
    return { ...plan, seatGate: deliveryState, portraitGate: this.portraitGate(plan), resources, deliveryState, deliverySummary: { required: required.length, complete: required.filter((resource) => resource.task?.status === 'SUCCEEDED' && resource.task?.reviewStatus !== 'REJECTED' && (!ACTION_VIDEO_RESOURCES.has(resource.id) || resource.task?.alphaVisualApproved === true)).length, failed: failed.length, active: active.length } };
  }
  async confirmPortrait(plan) {
    await this.ready;
    const gate = this.portraitGate(plan);
    if (gate.status === 'CONFIRMED') return { status: 'CONFIRMED', portraitGate: gate };
    if (gate.status !== 'AWAITING_CONFIRMATION' || !gate.taskId || !gate.publicUrl || !gate.profileCardUrl || !gate.sha256) {
      throw new Error('只有已生成并通过落盘校验的角色资料卡可以确认；同时必须先取得公网 URL，请等待资料卡 URL 就绪。');
    }
    const approval = { planId: plan.planId, taskId: gate.taskId, sha256: gate.sha256, confirmedAt: now() };
    this.portraitApprovals.set(plan.planId, approval);
    await this.persist();
    return { status: 'CONFIRMED', portraitGate: this.portraitGate(plan) };
  }
  async confirmResource(taskId) {
    await this.ready;
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'SUCCEEDED' || !task.publicUrl) throw new Error('资源尚未完成，不能确认用途。');
    if (task.resourceId === 'action-sheet' && !task.derivedImages) throw new Error('五态源图尚未拆分，请重新生产规范的 3×2 源图。');
    if (ACTION_VIDEO_RESOURCES.has(task.resourceId) && (!task.alphaReviewRequired || !task.alphaPreviewUrl)) throw new Error('透明动作尚未生成三背景 alpha 预览，不能确认上桌。');
    task.reviewStatus = 'APPROVED';
    if (ACTION_VIDEO_RESOURCES.has(task.resourceId)) task.alphaVisualApproved = true;
    task.reviewedSha256 = task.sha256;
    task.reviewedAt = now();
    for (const entry of Object.values(task.derivedImages || {})) entry.reviewStatus = 'APPROVED';
    await this.persist();
    return publicTask(task);
  }
  /* 打回：用户验收不通过。标记 REJECTED 后，该任务不再满足上桌门禁与"已完成幂等"，
     重新提交同槽位时作为一次新的生产尝试（旧记录保留，文件在新产物落盘时被覆盖）。
     reproduce=true 立即为该槽位提交重产（消耗 Provider 额度）。 */
  async rejectResource(taskId, { reason = '', reproduce = false, promptPatch = '', scope = 'RESOURCE_ONLY' } = {}) {
    await this.ready;
    const task = this.tasks.get(String(taskId || ''));
    if (!task || task.status !== 'SUCCEEDED' || !task.publicUrl) throw new Error('只有已完成的资源可以打回。');
    task.reviewStatus = 'REJECTED';
    if (ACTION_VIDEO_RESOURCES.has(task.resourceId)) task.alphaVisualApproved = false;
    task.reviewNote = String(reason || '').slice(0, 200);
    task.reviewReasonCode = String(reason || '').match(/^[A-Z_]{3,40}/)?.[0] || 'MANUAL_REVIEW';
    task.promptPatch = String(promptPatch || '').slice(0, 1000);
    task.reworkScope = String(scope || 'RESOURCE_ONLY');
    task.reviewedAt = now();
    for (const entry of Object.values(task.derivedImages || {})) entry.reviewStatus = 'REJECTED';
    await this.persist();
    let reproduction = null;
    if (reproduce) {
      const plan = task.planSnapshot;
      if (!plan) throw new Error('任务缺少计划快照，无法触发重产。');
      reproduction = await this.submit({ plan, resourceIds: [task.resourceId], promptPatches: { [task.resourceId]: task.promptPatch } });
    }
    return { task: publicTask(task), reproduction };
  }
  async attachSourceUrl(plan, resourceId, sourceUrl) {
    await this.ready;
    const parsed = new URL(String(sourceUrl || ''));
    const allowedHosts = String(this.env.PAL_ASSET_CDN_HOSTS || 'gcdncs.cn.ndhy.com').split(',').map((host) => host.trim().toLowerCase()).filter(Boolean);
    if (parsed.protocol !== 'https:' || !allowedHosts.includes(parsed.hostname.toLowerCase())) throw new Error('资源 CDN 地址必须使用已配置的 HTTPS CS 域名。');
    const task = [...this.tasks.values()]
      .filter((candidate) => candidate.planId === plan.planId && candidate.resourceId === resourceId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (task && task.kind !== 'image') throw new Error('CS 图片地址只能绑定到图片资源。');
    if (task && task.status !== 'SUCCEEDED') throw new Error('只能为已成功生成并落盘的资源绑定 CS 地址。');
    const response = await fetch(parsed, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`CS 图片地址回读失败（HTTP ${response.status}）。`);
    let contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (!contentType.startsWith('image/')) throw new Error(`CS 地址返回类型不是图片（${contentType || 'unknown'}）。`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    let expectedBytes = task?.bytes || null;
    let expectedSha256 = task?.sha256 || null;
    /* Legacy plans may have an accepted local image but no corresponding
       pipeline task.  Verify against the immutable local artifact before
       creating the same durable CS binding. */
    if (!expectedBytes || !expectedSha256) {
      const prefix = `${plan.planId}-${resourceId}.`;
      const searchDirs = [join(this.assetDir, this.assetFolder(plan)), this.assetDir];
      const matches = [];
      for (const dir of searchDirs) {
        const names = await readdir(dir).catch(() => []);
        for (const name of names) if (name.startsWith(prefix)) matches.push(join(dir, name));
      }
      if (matches.length !== 1) throw new Error('未找到唯一的已落盘图片资源，不能安全绑定 CS 地址。');
      const localBytes = await readFile(matches[0]);
      expectedBytes = localBytes.length;
      expectedSha256 = createHash('sha256').update(localBytes).digest('hex');
    }
    if (bytes.length !== expectedBytes || sha256 !== expectedSha256) throw new Error('CS 图片与已生成资源的字节数或 SHA-256 不一致，未绑定。');
    if (ALPHA_IMAGE_RESOURCES.has(resourceId) && !hasPngAlpha(bytes)) throw new Error('CS 图片没有真实 alpha 通道；不能绑定白底、灰底或棋盘格占位图。');
    if (task) { task.sourceUrl = parsed.toString(); task.updatedAt = now(); }
    this.sourceBindings.set(`${plan.planId}:${resourceId}`, { key: `${plan.planId}:${resourceId}`, planId: plan.planId, resourceId, sourceUrl: parsed.toString(), bytes: expectedBytes, sha256: expectedSha256, updatedAt: now() });
    await this.persist();
    return { status: 'ATTACHED', planId: plan.planId, resourceId, bytes: bytes.length, sha256 };
  }
  async attachActionVideoSource(plan, resourceId, sourceUrl) {
    await this.ready;
    if (!/^action-image-A0[1-5]$/.test(String(resourceId || ''))) throw new Error('视频首帧只允许绑定到 A01–A05 动作图。');
    const parsed = new URL(String(sourceUrl || ''));
    const allowedHosts = String(this.env.PAL_ASSET_CDN_HOSTS || 'gcdncs.cn.ndhy.com').split(',').map((host) => host.trim().toLowerCase()).filter(Boolean);
    if (parsed.protocol !== 'https:' || !allowedHosts.includes(parsed.hostname.toLowerCase())) throw new Error('视频首帧必须使用已配置的 HTTPS CS 域名。');
    const task = this.latestTask(plan, resourceId);
    if (!task || task.status !== 'SUCCEEDED' || task.reviewStatus !== 'APPROVED' || !task.sha256) throw new Error('动作图必须先成功落盘并通过人工验收，才能绑定绿色首帧。');
    const response = await fetch(parsed, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`视频首帧 CS 地址回读失败（HTTP ${response.status}）。`);
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (!contentType.startsWith('image/')) throw new Error(`视频首帧返回类型不是图片（${contentType || 'unknown'}）。`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const dimensions = imageDimensions(bytes);
    if (!dimensions || Math.abs(dimensions.width / dimensions.height - 0.75) > 0.04) throw new Error('视频首帧必须是可解码的 3:4 图片。');
    const key = `${plan.planId}:${resourceId}:action-video-first-frame`;
    this.sourceBindings.set(key, { key, planId: plan.planId, resourceId, purpose: 'action-video-first-frame', sourceUrl: parsed.toString(), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), derivedFromSha256: task.sha256, updatedAt: now() });
    await this.persist();
    return { status: 'ATTACHED', planId: plan.planId, resourceId, purpose: 'action-video-first-frame', bytes: bytes.length };
  }
  async submit({ plan, resourceIds = null, promptPatches = {} }) {
    await this.ready;
    const requested = Array.isArray(resourceIds) && resourceIds.length ? plan.resources.filter((item) => resourceIds.includes(item.id)) : plan.resources;
    const portrait = plan.resources.find((item) => item.id === 'master-portrait');
    const approved = this.portraitApprovals.has(plan.planId) && this.portraitGate(plan).status === 'CONFIRMED';
    let selected = requested;
    if (!approved) {
      const gate = this.portraitGate(plan);
      if (gate.status === 'AWAITING_CONFIRMATION') return { status: 'AWAITING_PORTRAIT_CONFIRMATION', planId: plan.planId, portraitGate: gate, tasks: gate.taskId ? this.list(plan.planId).filter((task) => task.taskId === gate.taskId) : [] };
      if (gate.status === 'GENERATING') return { status: 'PORTRAIT_GENERATING', planId: plan.planId, portraitGate: gate, tasks: gate.taskId ? this.list(plan.planId).filter((task) => task.taskId === gate.taskId) : [] };
      if (!requested.some((item) => item.id === 'master-portrait')) return { status: 'PORTRAIT_REQUIRED', planId: plan.planId, portraitGate: gate, tasks: [] };
      if (!portrait) throw new Error('资源计划缺少角色资料卡节点。');
      selected = [portrait];
    } else {
      /* 兼容迁移期间被旧版本提交、但尚未获得确认的遗留视频任务；确认后才允许恢复。 */
      let resumed = false;
      for (const task of this.tasks.values()) if (task.planId === plan.planId && task.status === 'WAITING_PORTRAIT_CONFIRMATION') {
        task.status = 'WAITING_REFERENCE'; task.error = null; task.updatedAt = now(); resumed = true;
      }
      if (resumed) await this.persist();
    }
    if (approved && !this.roleProfileUrl(plan)) {
      return { status: 'PROFILE_REFERENCE_REQUIRED', planId: plan.planId, portraitGate: this.portraitGate(plan), tasks: [], reason: '角色资料卡缺少可由下游 Provider 访问的公网 image_url，未提交任何下游资源。' };
    }
    if (!selected.length) throw new Error('没有可提交的资源项。');
    const capability = this.capability();
    const missing = [];
    /* Completed items are idempotent, and an opaque alpha task with a retained
       source URL can now be recovered locally. Neither case needs a provider
       credential just to press “继续生产”. */
    const needsProviderFor = (resource) => {
      const latest = this.latestTask(plan, resource.id);
      if (latest?.status === 'SUCCEEDED' && latest?.reviewStatus !== 'REJECTED') return false;
      if (resource.kind === 'image' && ALPHA_IMAGE_RESOURCES.has(resource.id) && latest?.status === 'FAILED' && latest.alphaStage === 'REMOVE_BG' && isUrl(latest.alphaSourceUrl)) return false;
      return true;
    };
    if (selected.some((item) => item.kind === 'image' && item.id === 'master-portrait' && needsProviderFor(item)) && !capability.image.roleProfile.configured) missing.push(`角色资料卡：${capability.image.roleProfile.missing.join('、')}`);
    if (selected.some((item) => item.kind === 'image' && !['master-portrait', 'outfit-poster'].includes(item.id) && needsProviderFor(item)) && !capability.image.static.configured) missing.push(`其余图片：${capability.image.static.missing.join('、')}`);
    const selectedDanceVideo = selected.some((item) => item.kind === 'video' && DANCE_VIDEO_RESOURCES.has(item.id));
    const selectedSeedanceVideo = selected.some((item) => item.kind === 'video' && !DANCE_VIDEO_RESOURCES.has(item.id));
    if (selectedDanceVideo && !capability.video.dance.configured) missing.push(`跳舞视频：${capability.video.dance.missing.join('、')}`);
    if (selectedSeedanceVideo && !capability.video.seedance.configured) missing.push(`其他视频：${capability.video.seedance.missing.join('、')}`);
    if (missing.length) return { status: 'PROVIDER_UNAVAILABLE', gate: 'PL-PROVIDER', reason: `生产未提交：${missing.join('；')}。${capability.note}`, tasks: [] };
    const tasks = await Promise.all(selected.map((resource) => this.submitResource(plan, resource, { promptPatch: promptPatches?.[resource.id] || '' })));
    return { status: approved ? 'SUBMITTED' : 'PORTRAIT_SUBMITTED', planId: plan.planId, portraitGate: this.portraitGate(plan), tasks: tasks.map(publicTask) };
  }
  async submitResource(plan, resource, { promptPatch = '' } = {}) {
    const existing = [...this.tasks.values()].filter((task) => task.planId === plan.planId && task.resourceId === resource.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    const promptRevision = resource.id === 'master-portrait' ? MASTER_PROMPT_REVISION
      : resource.id === 'avatar' ? AVATAR_PROMPT_REVISION
        : resource.id === 'table-standee' ? TABLE_PROMPT_REVISION
          : resource.id === 'first-outfit' ? FIRST_OUTFIT_PROMPT_REVISION
            : resource.id === 'lounge-standee' ? LOUNGE_PROMPT_REVISION
              : resource.id === 'action-sheet' ? ACTION_SHEET_PROMPT_REVISION
                : resource.id.startsWith('action-image-') ? ACTION_IMAGE_PROMPT_REVISION
                : resource.id === 'outfit-fx' ? OUTFIT_FX_PROMPT_REVISION
                  : resource.id === 'outfit-film' ? OUTFIT_DANCE_PROMPT_REVISION
                  : resource.id === 'entry-film' ? ENTRY_VIDEO_PROMPT_REVISION
                    : ACTION_VIDEO_RESOURCES.has(resource.id) ? ACTION_VIDEO_PROMPT_REVISION : 'default-v1';
    const revisedCompositionPrompt = existing?.status === 'SUCCEEDED' && existing.promptRevision !== promptRevision
      && ['master-portrait', 'avatar', 'table-standee', 'lounge-standee', 'action-sheet', 'action-image-A01', 'action-image-A02', 'action-image-A03', 'action-image-A04', 'action-image-A05', 'outfit-fx', 'entry-film', 'outfit-film', 'action-a01', 'action-a02', 'action-a03', 'action-a04', 'action-a05'].includes(resource.id);
    const referenceResourceId = resource.id === 'master-portrait' ? null : this.referenceResourceId(resource.id);
    const referenceUrl = referenceResourceId ? this.referenceUrl(plan, referenceResourceId) : null;
    /* 「继续生产」必须幂等：已成功的资源不因为提示词版本升级或存量缺少参考记录而重跑。
       参考变化只认两类——老任务记录过的 referenceResourceId 真的不同，或记录过的
       profileReferenceUrl 真的换了（比如资料卡被显式重产后下游需要跟随）；
       构图/比例迁移一律由用户显式「重新生产」触发。 */
    const referenceChanged = Boolean(existing && existing.referenceResourceId && existing.referenceResourceId !== referenceResourceId)
      || Boolean(existing && referenceUrl && existing.profileReferenceUrl && existing.profileReferenceUrl !== referenceUrl);
    /* 被打回的 SUCCEEDED 任务不再视为已完成：允许同槽位作为新的一次生产提交。 */
    const rejectedRework = Boolean(existing?.status === 'SUCCEEDED' && existing?.reviewStatus === 'REJECTED');
    if (existing && ['QUEUED', 'WAITING_REFERENCE', 'RETRY_WAITING', 'RUNNING', 'SUCCEEDED'].includes(existing.status) && !rejectedRework && !referenceChanged) {
      return existing;
    }
    const revisedOutfitPrompt = resource.id === 'first-outfit' && existing?.status === 'FAILED' && (existing.promptRevision || 'legacy-v1') !== promptRevision;
    /* v3 removes the role-profile reference image from an effect-only node.
       A v2 output may be a correct prompt on paper yet still inherit a person
       from that reference, so it gets one explicit same-route recovery. */
    const revisedEffectPrompt = resource.id === 'outfit-fx' && existing?.status === 'FAILED' && (existing.promptRevision || 'legacy-v1') !== promptRevision;
    const repairRetry = existing?.status === 'FAILED' && existing.strategyVersion !== IMAGE_STRATEGY_VERSION && isRepairableFailure(existing.error);
    const providerContractRetry = existing?.status === 'FAILED' && isRepairableFailure(existing.error) && Number(existing.attempt || 0) >= 2 && Number(existing.attempt || 0) < 7;
    const alphaPostProcessRetry = existing?.status === 'FAILED' && isAlphaPostProcessFailure(existing.error) && Number(existing.attempt || 0) < 8;
    /* 去背景节点在处理中被服务端停止时，原始图片已落到 CS，
       只需重试 remove-bg，不应重新生成一次昂贵的 GPT 图片。 */
    const alphaProviderRecovery = existing?.status === 'FAILED' && existing.alphaStage === 'REMOVE_BG' && isUrl(existing.alphaSourceUrl) && isProviderStoppedFailure(existing.error) && Number(existing.attempt || 0) < 8;
    /* If the provider already returned an opaque RGB image, recover that exact
       source locally before calling remove-bg again. This is deterministic,
       preserves the original run evidence, and avoids another image charge. */
    /* 对 effect-only v3 的迁移必须先重新生成：旧图含人物时，继续对旧图
       抠像只会重复失败，不能抢占新版“无参考图”提示词的重产分支。 */
    const alphaLocalRecovery = existing?.status === 'FAILED' && existing.alphaStage === 'REMOVE_BG' && isUrl(existing.alphaSourceUrl) && Number(existing.attempt || 0) < 8 && !revisedEffectPrompt;
    const danceContractRetry = existing?.status === 'FAILED' && resource.id === 'outfit-film' && (isDanceContractFailure(existing.error) || existing.promptRevision !== OUTFIT_DANCE_PROMPT_REVISION) && Number(existing.attempt || 0) < 6;
    /* 凭据错误与提示词/尺寸错误不同：用户换 key 后需要再给一次真实请求机会，
       但最多只允许一次凭据切换恢复，避免错误凭据造成无限扣费重试。 */
    const currentCredentialFingerprint = credentialFingerprint(this.env);
    const credentialChanged = Boolean(currentCredentialFingerprint && existing?.authFingerprint && existing.authFingerprint !== currentCredentialFingerprint);
    const legacyCredentialRecovery = Boolean(currentCredentialFingerprint && existing?.status === 'FAILED' && isCredentialFailure(existing.error) && !existing.authFingerprint);
    const credentialRetry = existing?.status === 'FAILED' && isCredentialFailure(existing.error) && (Number(existing.attempt || 0) === 2 || credentialChanged || legacyCredentialRecovery);
    /* 用户补开 Bot 权限后，允许每个旧的权限失败任务再真实提交一次；
       仅针对已达到旧重试上限的权限错误，避免普通失败进入无限重试。 */
    const providerPermissionRetry = existing?.status === 'FAILED' && isProviderPermissionFailure(existing.error) && Number(existing.attempt || 0) >= 4 && Number(existing.attempt || 0) < 6;
    const canonicalRoute = DISPLAY_ROUTE_BY_RESOURCE[resource.id]?.production || resource.production;
    const routeChangedRetry = existing?.status === 'FAILED' && existing.route !== canonicalRoute && isAlphaOutputFailure(existing.error);
    const alphaRetry = existing?.status === 'FAILED' && isAlphaOutputFailure(existing.error) && (Number(existing.attempt || 0) === 2 || routeChangedRetry);
    /* Provider 5xx/invalid-upstream responses are transport failures, not
       content failures. Allow one bounded retry on the same canonical route
       and confirmed reference instead of leaving a stale failed task locked. */
    const transientProviderRetry = existing?.status === 'FAILED' && isTransientProviderFailure(existing.error) && Number(existing.attempt || 0) < 6;
    /* A contract migration deliberately invalidates historic opaque standees
       and scene MP4s. That is not a provider retry loop: it grants exactly one
       new attempt under the new immutable prompt/version. */
    const contractMigrationRetry = existing?.status === 'FAILED' && /历史透明图片|历史动作视频|旧版跳舞视频提示词不足/i.test(errorText(existing.error));
    if (existing?.attempt >= 2 && !rejectedRework && !revisedOutfitPrompt && !revisedEffectPrompt && !revisedCompositionPrompt && !referenceChanged && !repairRetry && !providerContractRetry && !alphaPostProcessRetry && !alphaProviderRecovery && !alphaLocalRecovery && !danceContractRetry && !transientProviderRetry && !credentialRetry && !alphaRetry && !providerPermissionRetry && !contractMigrationRetry) return { ...existing, retryLocked: true, error: `${errorText(existing.error)} 已达到一次重试上限。` };
    const createdAt = now();
    const safetyPromptRetry = resource.id === 'master-portrait' && isSafetyRejection(existing?.error);
    const primaryModel = resource.id === 'master-portrait' ? DEFAULT_IMAGE_MODEL : DEFAULT_IMAGE_FALLBACK_MODEL;
    const profileReferenceUrl = referenceUrl;
    const task = {
      taskId: randomUUID(), planId: plan.planId, resourceId: resource.id, label: resource.label, kind: resource.kind,
      /* 任务持有不可变计划快照，服务重启后仍能恢复资源用途与上桌门禁。 */
      planSnapshot: plan,
      route: canonicalRoute, provider: resource.id === 'outfit-poster' ? 'deterministic' : resource.kind === 'video' ? (DANCE_VIDEO_RESOURCES.has(resource.id) ? 'aihub-dance' : 'aihub-seedance') : resource.kind === 'image' ? 'aihub-image' : 'deterministic',
      transport: resource.id === 'outfit-poster' ? null : resource.kind === 'video' && String(this.env.AIHUB_AGENT_TOKEN || '').trim() ? 'aihub-agent' : resource.kind === 'video' ? 'aihub-bot' : resource.kind === 'image' ? 'aihub-agent' : null,
      status: resource.kind === 'text' || resource.kind === 'record' ? 'SUCCEEDED' : resource.kind === 'video' ? 'WAITING_REFERENCE' : 'QUEUED', attempt: repairRetry ? 1 : (existing?.attempt || 0) + 1,
      createdAt, updatedAt: createdAt, runId: null, providerRequestId: null, publicUrl: null, sha256: null, bytes: null, width: null, height: null, error: null, retryLocked: false,
      promptRevision: safetyPromptRetry ? 'safety-safe-v2' : alphaRetry ? 'alpha-transparent-v2' : alphaLocalRecovery ? 'alpha-local-cutout-v1' : alphaProviderRecovery ? 'alpha-provider-recovery-v1' : providerPermissionRetry ? 'permission-retry-v1' : danceContractRetry ? 'dance-contract-v2' : transientProviderRetry ? `${promptRevision}-transport-retry` : promptRevision, promptPatch: String(promptPatch || existing?.promptPatch || '').slice(0, 1000), strategyVersion: IMAGE_STRATEGY_VERSION, previousTaskId: existing?.taskId || null,
      profileReferenceUrl,
      referenceResourceId,
      alphaStage: alphaLocalRecovery ? 'LOCAL_CUTOUT' : alphaProviderRecovery ? 'REMOVE_BG' : undefined,
      alphaSourceUrl: alphaProviderRecovery ? existing.alphaSourceUrl : undefined,
      authFingerprint: currentCredentialFingerprint || existing?.authFingerprint || '',
      promptSummary: plan.intent.style,
      model: resource.kind === 'image' ? primaryModel : null,
      fallbackModel: null,
      fallbackUsed: safetyPromptRetry
    };
    this.tasks.set(task.taskId, task); await this.persist();
    if (task.status === 'SUCCEEDED') return task;
    /* 视频必须先等到其指定图片参考完成，不能把纯 prompt 直接送进目标工作流。 */
    if (task.kind === 'video') return task;
    const work = alphaLocalRecovery
      ? this.startLocalAlphaRecovery(task, existing.alphaSourceUrl)
      : alphaProviderRecovery
      ? this.startAIHubRemoveBg(task, existing.alphaSourceUrl)
      : this.startAIHubImage(task, plan, resource);
    this.locks.set(task.taskId, work.finally(() => this.locks.delete(task.taskId)));
    return task;
  }
  async startAIHubImage(task, plan, resource) {
    try {
      if (resource.id === 'outfit-poster') {
        await this.startPosterFromVideo(task, plan);
        return;
      }
      if (task.status === 'RETRY_WAITING') task.attempt += 1;
      if (task.referenceResourceId && !isUrl(task.profileReferenceUrl)) {
        task.status = 'WAITING_REFERENCE';
        task.error = `${task.referenceResourceId} 尚未完成；${resource.id} 不会绕过同源参考图直接生产。`;
        task.updatedAt = now();
        await this.persist();
        return;
      }
      task.status = 'RUNNING'; task.updatedAt = now(); await this.persist();
      const profile = resource.id === 'master-portrait';
      /* 透明是输出契约，不再决定模型路由：只有角色资料卡走 GPT Image 2，
         其余静态图片全部走即梦 5.0，避免透明资产被 GPT 的敏感词策略一锅拦截。 */
      const useGptImage = profile;
      const model = String(task.model || (useGptImage ? DEFAULT_IMAGE_MODEL : DEFAULT_IMAGE_FALLBACK_MODEL)).trim() || DEFAULT_IMAGE_MODEL;
      const workflowAlias = useGptImage ? 'gpt-image2' : 'jimeng';
      const appId = skillAppId(workflowAlias, this.env);
      const token = String(this.env.AIHUB_AGENT_TOKEN || '').trim();
      if (!token || !appId) throw new Error(`AIHub 图片工作流未配置：${!token ? 'AIHUB_AGENT_TOKEN' : `skill alias ${workflowAlias}`}`);
      const base = String(this.env.AIHUB_AGENT_BASE_URL || 'https://bv.new.ndhy.com/api/agent/aihub').replace(/\/$/, '');
      const prompt = promptFor(plan, resource, task);
      const size = imageSizeFor(resource, this.env, model);
      const inputs = useGptImage
        ? { prompt, count: 1, size, quality: 'auto', background: 'auto' }
        : { prompt, aspect_ratio: this.jimengAspectRatio(resource), version: '即梦5.0', is_expert: '否', count: 1 };
      /* A reference photo is required for character-bearing images, but it is
         harmful for a pure effect layer: image-to-image faithfully brings the
         person back even if the text says no person.  Effects use only the
         locked palette/lighting prompt, never the role-profile pixels. */
      if (resource.id !== 'outfit-fx' && isUrl(task.profileReferenceUrl)) inputs.image_urls = task.profileReferenceUrl;
      const configuredBackground = String(this.env.AIHUB_PROFILE_IMAGE_BACKGROUND || '').trim().toLowerCase();
      if (useGptImage && ['auto', 'opaque'].includes(configuredBackground)) inputs.background = configuredBackground;
      const response = await fetch(`${base}/workflows/run`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId, inputs, meta: { label: `${plan.planId}:${resource.id}`, workflowAlias: model } }),
        signal: AbortSignal.timeout(30_000)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const upstream = payload?.error || payload?.message;
        throw new Error(typeof upstream === 'string' ? upstream : `AIHub 图片工作流提交失败（HTTP ${response.status}）：${JSON.stringify(upstream || payload)}`);
      }
      const inlineImage = payload?.data?.[0]?.b64_json || payload?.outputs?.data?.outputs?.b64_json;
      if (typeof inlineImage === 'string' && inlineImage.length) {
        task.runId = payload?.runId || payload?.id || null;
        task.providerRequestId = task.runId;
        await this.materializeBytes(task, Buffer.from(inlineImage, 'base64'), 'image/png');
        return;
      }
      const immediateUrl = findUrl(payload, 'image');
      if (immediateUrl) {
        task.runId = payload?.runId || payload?.id || null;
        task.providerRequestId = task.runId;
        await this.materialize(task, immediateUrl, { retainSourceUrl: true });
        return;
      }
      task.runId = payload?.runId || payload?.id || null;
      task.providerRequestId = task.runId;
      if (!task.runId) throw new Error('AIHub 图片工作流未返回 runId。');
      task.status = 'RUNNING'; task.updatedAt = now(); await this.persist();
      /* 先立即读一次状态；长任务会保持 RUNNING 并由 refresh() 继续轮询，
         已完成的短任务则在同一轮直接收敛，保证 run → status → outputs 契约完整。 */
      await this.refreshAIHubImage(task);
    } catch (error) { await this.failWithRetry(task, error); }
  }
  async startPosterFromVideo(task, plan) {
    const film = this.latestTask(plan, 'outfit-film');
    if (!film || film.status !== 'SUCCEEDED' || !film.publicUrl) {
      task.status = 'WAITING_REFERENCE'; task.error = '换装演出视频尚未完成；Poster 将从验收视频抽帧。'; task.updatedAt = now(); await this.persist(); return;
    }
    const sourcePath = this.assetPath(film.publicUrl);
    const tempDir = await mkdtemp(join(tmpdir(), 'dressbattle-poster-'));
    const localSourcePath = join(tempDir, 'source.mp4');
    const outputPath = join(tempDir, 'poster.png');
    try {
      task.status = 'RUNNING'; task.error = null; task.updatedAt = now(); await this.persist();
      /* Windows FFmpeg builds can reject a valid media file when a parent folder
         contains CJK characters ("Illegal byte sequence").  Stage the already
         persisted movie under an ASCII-only temp path before deterministic
         extraction; this changes neither bytes nor the accepted source task. */
      await writeFile(localSourcePath, await readFile(sourcePath));
      await execFileAsync(String(this.env.FFMPEG || 'ffmpeg'), ['-y', '-ss', '00:00:01', '-i', localSourcePath, '-frames:v', '1', '-vf', 'scale=1080:1440:force_original_aspect_ratio=increase,crop=1080:1440', outputPath], { timeout: 120_000 });
      const bytes = await readFile(outputPath);
      await this.materializeBytes(task, bytes, 'image/png');
      task.sourceTaskId = film.taskId;
      await this.persist();
    } catch (error) {
      await this.failWithRetry(task, `换装视频 Poster 抽帧失败：${safeError(error)}`);
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
  async startAIHubRemoveBg(task, sourceUrl) {
    try {
      const token = String(this.env.AIHUB_AGENT_TOKEN || '').trim();
      const appId = skillAppId('remove-bg', this.env);
      if (!token || !appId) throw new Error(`AIHub 去背景工作流未配置：${!token ? 'AIHUB_AGENT_TOKEN' : 'skill alias remove-bg'}`);
      const base = String(this.env.AIHUB_AGENT_BASE_URL || 'https://bv.new.ndhy.com/api/agent/aihub').replace(/\/$/, '');
      const response = await fetch(`${base}/workflows/run`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId, inputs: { image_url: sourceUrl }, meta: { label: `${task.planId}:${task.resourceId}:remove-bg`, workflowAlias: 'remove-bg' } }),
        signal: AbortSignal.timeout(30_000)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || payload?.message || `AIHub 去背景工作流提交失败（HTTP ${response.status}）。`);
      task.alphaStage = 'REMOVE_BG'; task.alphaSourceUrl = sourceUrl;
      const immediateUrl = findUrl(payload, 'image');
      if (immediateUrl) { await this.materialize(task, immediateUrl, { retainSourceUrl: true }); return; }
      task.runId = payload?.runId || payload?.id || null; task.providerRequestId = task.runId;
      if (!task.runId) throw new Error('AIHub 去背景工作流未返回 runId。');
      task.status = 'RUNNING'; task.updatedAt = now(); await this.persist();
    } catch (error) { await this.failWithRetry(task, error); }
  }
  async repairOpaqueAlpha(bytes, { removeLargeWhiteIslands = false } = {}) {
    const dir = await mkdtemp(join(tmpdir(), 'dressbattle-alpha-'));
    const source = join(dir, 'source.png');
    const target = join(dir, 'cutout.png');
    try {
      await writeFile(source, bytes);
      /* Prefer an explicit chroma key when the producer followed the solid
         #00FF00 source contract.  The generic edge-colour estimator can treat
         large black garments as background on dark-fashion characters,
         creating holes through jackets and skirts.  A green-only key preserves
         those materials; when the input is not green-screen the transparency
         gate below fails and we safely fall back to the generic repair. */
      try {
        await execFileAsync(String(this.env.FFMPEG || 'ffmpeg'), ['-y', '-i', source, '-vf', 'chromakey=0x00ff00:0.30:0.04,format=rgba', '-frames:v', '1', target], { timeout: 120_000, maxBuffer: 8_000 });
        const chromaKeyed = await readFile(target);
        if (hasPngAlpha(chromaKeyed) && hasTransparentCanvas(chromaKeyed)) return chromaKeyed;
      } catch {}
      const python = String(this.env.PYTHON || 'python').trim() || 'python';
      const args = [ALPHA_REPAIR_SCRIPT, source, target];
      /* A normal automatic repair must preserve legitimate white wardrobes.
         This stricter island key is allowed only after a human has actually
         observed an internal white plate on a specific asset. */
      if (removeLargeWhiteIslands) args.push('--remove-large-white-islands');
      await execFileAsync(python, args, { timeout: 120_000, maxBuffer: 8_000 });
      return await readFile(target);
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }
  /* Re-run the deterministic edge treatment on an already generated cutout.
     This is deliberately a local post-process: it preserves the approved
     character identity and pose, while allowing a stricter matte algorithm to
     replace an earlier LOCAL_CUTOUT result that has a visible pale fringe. */
  async refineLocalAlpha(taskId, { removeLargeWhiteIslands = false } = {}) {
    await this.ready;
    const task = this.tasks.get(String(taskId || ''));
    if (!task || task.kind !== 'image' || !ALPHA_IMAGE_RESOURCES.has(task.resourceId) || task.status !== 'SUCCEEDED' || !task.publicUrl) {
      throw new Error('仅已完成的透明 PNG 立绘或动作图可以执行边缘去白处理。');
    }
    const sourcePath = this.assetPath(task.publicUrl);
    let bytes;
    try { bytes = await readFile(sourcePath); } catch { throw new Error('本地透明 PNG 不存在，无法安全执行边缘去白处理。'); }
    task.status = 'RUNNING';
    task.reviewStatus = 'AWAITING_REVIEW';
    task.reviewNote = '已按新版边缘去白规则重处理，等待暗背景目检。';
    task.error = '正在执行本地边缘去白处理。';
    task.updatedAt = now();
    await this.persist();
    try {
      const refined = await this.repairOpaqueAlpha(bytes, { removeLargeWhiteIslands });
      if (!hasPngAlpha(refined) || !hasTransparentCanvas(refined)) throw new Error('边缘去白处理没有保留合格的透明画布。');
      task.alphaStage = removeLargeWhiteIslands ? 'LOCAL_CUTOUT_WHITE_ISLAND_REPAIR_V1' : 'LOCAL_CUTOUT_DEFRINGE_V2';
      await this.materializeBytes(task, refined, 'image/png', MAX_IMAGE_BYTES, task.sourceUrl || null);
      task.alphaStage = removeLargeWhiteIslands ? 'LOCAL_CUTOUT_WHITE_ISLAND_REPAIR_V1' : 'LOCAL_CUTOUT_DEFRINGE_V2';
      task.reviewStatus = 'AWAITING_REVIEW';
      task.reviewNote = removeLargeWhiteIslands ? '已清除目检确认的大片白色内底，等待暗背景目检。' : '已按新版边缘去白规则重处理，等待暗背景目检。';
      await this.persist();
    } catch (error) {
      await this.failWithRetry(task, `本地边缘去白处理失败：${safeError(error)}`);
    }
    return publicTask(task);
  }
  async startLocalAlphaRecovery(task, sourceUrl) {
    try {
      task.status = 'RUNNING'; task.updatedAt = now(); task.error = '已复用原始图片，正在本地恢复真实 alpha 通道。'; await this.persist();
      const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(120_000) });
      if (!response.ok) throw new Error(`原始图片回读失败（HTTP ${response.status}）。`);
      const bytes = Buffer.from(await response.arrayBuffer());
      const repaired = await this.repairOpaqueAlpha(bytes);
      if (!hasPngAlpha(repaired) || !hasTransparentCanvas(repaired)) throw new Error('本地抠像未产生没有场景底板的可用真实 alpha 通道。');
      task.alphaStage = 'LOCAL_CUTOUT'; task.alphaSourceUrl = sourceUrl; task.sourceUrl = sourceUrl;
      await this.materializeBytes(task, repaired, 'image/png');
    } catch (error) { await this.failWithRetry(task, error); }
  }
  jimengAspectRatio(resource) {
    if (resource.id === 'action-sheet' || resource.id === 'outfit-fx') return '2048x2048';
    /* 新版即梦应用不接受 1024x1024 与 1920x2400；1:1 用 2048x2048，竖版用 1728x2304（3:4）。 */
    if (resource.id === 'avatar') return '2048x2048';
    if (resource.id === 'table-standee') return '1728x2304';
    return '1728x2304';
  }
  async startDance(task, plan, resource, referenceUrl) {
    try {
      if (task.status === 'RETRY_WAITING') task.attempt += 1;
      task.status = 'SUBMITTING'; task.updatedAt = now(); await this.persist();
      await this.ensureDanceReference(String(plan.danceReferenceVideoUrl || DEFAULT_DANCE_REFERENCE_VIDEO_URL));
      if (task.transport === 'aihub-agent') {
        const base = String(this.env.AIHUB_AGENT_BASE_URL || 'https://bv.new.ndhy.com/api/agent/aihub').replace(/\/$/, '');
        const response = await fetch(`${base}/workflows/run`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${String(this.env.AIHUB_AGENT_TOKEN)}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ appId: String(this.env.PAL_DANCE_WORKFLOW_APP_ID), inputs: danceInputs(plan, resource, this.env, referenceUrl), meta: { label: `${plan.planId}:${resource.id}` } }),
          signal: AbortSignal.timeout(30_000)
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload?.error || payload?.message || `AIHub 跳舞工作流提交失败（HTTP ${response.status}）。`);
        task.runId = payload?.runId || payload?.id || null;
        if (!task.runId) throw new Error('AIHub 跳舞工作流未返回 runId。');
        task.providerRequestId = task.runId; task.status = 'RUNNING'; task.updatedAt = now(); await this.persist(); return;
      }
      const base = String(this.env.AIHUB_DANCE_BASE_URL || 'https://ai-hub-api.aiae.ndhy.com').replace(/\/$/, '');
      const headers = danceHeaders(this.env);
      const response = await fetch(`${base}/v1/workflows/run`, { method: 'POST', headers, body: JSON.stringify({ inputs: danceInputs(plan, resource, this.env, referenceUrl), response_mode: 'streaming', user: String(this.env.AIHUB_DANCE_USER || 'dressbattle-local'), environment: String(this.env.AIHUB_DANCE_ENVIRONMENT || 'prod') }), signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`AIHub 跳舞工作流提交失败（HTTP ${response.status}）。`);
      const first = await this.readWorkflowStart(response);
      task.runId = first.workflow_run_id || first.data?.id || null; task.providerRequestId = first.task_id || null;
      if (!task.providerRequestId) throw new Error('AIHub 跳舞工作流未返回 task_id。');
      task.status = 'RUNNING'; task.updatedAt = now(); await this.persist();
    } catch (error) { await this.failWithRetry(task, error); }
  }

  async startSeedance(task, plan, resource, referenceUrl) {
    try {
      if (task.status === 'RETRY_WAITING') task.attempt += 1;
      task.status = 'SUBMITTING'; task.updatedAt = now(); await this.persist();
      const token = String(this.env.AIHUB_AGENT_TOKEN || '').trim();
      const appId = skillAppId('seedance', this.env);
      if (!token || !appId) throw new Error(`AIHub Seedance 视频工作流未配置：${!token ? 'AIHUB_AGENT_TOKEN' : 'skill alias seedance'}`);
      const base = String(this.env.AIHUB_AGENT_BASE_URL || 'https://bv.new.ndhy.com/api/agent/aihub').replace(/\/$/, '');
      const response = await fetch(`${base}/workflows/run`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId, inputs: seedanceInputs(plan, resource, referenceUrl), meta: { label: `${plan.planId}:${resource.id}`, workflowAlias: 'seedance' } }),
        signal: AbortSignal.timeout(30_000)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || payload?.message || `AIHub Seedance 视频工作流提交失败（HTTP ${response.status}）。`);
      task.runId = payload?.runId || payload?.id || null;
      if (!task.runId) throw new Error('AIHub Seedance 视频工作流未返回 runId。');
      task.providerRequestId = task.runId; task.status = 'RUNNING'; task.updatedAt = now(); await this.persist();
    } catch (error) { await this.failWithRetry(task, error); }
  }

  async ensureDanceReference(url) {
    if (this.referenceChecks.has(url)) return this.referenceChecks.get(url);
    const check = (async () => {
      if (!isUrl(url)) throw new Error('跳舞视频参考 video_url 必须是 HTTPS 公网地址。');
      let response;
      try { response = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(20_000) }); } catch { response = null; }
      if (!response?.ok) {
        response = await fetch(url, { headers: { Range: 'bytes=0-0' }, signal: AbortSignal.timeout(20_000) });
        await response.body?.cancel().catch(() => {});
      }
      if (!response.ok) throw new Error(`参考视频链接不可访问（HTTP ${response.status}）。请换成可公网读取的 HTTPS 视频 URL。`);
      const contentType = String(response.headers.get('content-type') || '').toLowerCase();
      if (contentType && !contentType.startsWith('video/') && !contentType.includes('octet-stream')) throw new Error(`参考视频 URL 返回类型不是视频（${contentType}）。`);
      return true;
    })();
    this.referenceChecks.set(url, check);
    try { return await check; } catch (error) { this.referenceChecks.delete(url); throw error; }
  }

  async failWithRetry(task, error) {
    task.error = safeError(error);
    if (task.attempt < 2) {
      task.status = 'RETRY_WAITING';
      task.retryLocked = false;
      task.updatedAt = now();
      await this.persist();
      return;
    }
    task.status = 'FAILED';
    task.retryLocked = true;
    task.updatedAt = now();
    await this.persist();
  }
  async readWorkflowStart(response) {
    const reader = response.body?.getReader(); if (!reader) throw new Error('AIHub 跳舞工作流没有返回 SSE 响应体。');
    let text = '';
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        text += new TextDecoder().decode(value, { stream: true });
        const records = text.split(/\n\n+/); text = records.pop() || '';
        for (const record of records) for (const line of record.split(/\r?\n/)) if (line.startsWith('data:')) {
          const event = JSON.parse(line.slice(5).trim()); if (event.task_id) return event;
        }
      }
    } finally { await reader.cancel().catch(() => {}); }
    throw new Error('AIHub 跳舞工作流流中未收到 task_id。');
  }
  async refresh() {
    await this.ready;
    if (Date.now() - this.lastRefreshAt < 4_000) return this.list();
    this.lastRefreshAt = Date.now();
    const retryImages = [...this.tasks.values()].filter((task) => task.provider === 'aihub-image' && task.status === 'RETRY_WAITING');
    for (const task of retryImages) {
      const plan = task.planSnapshot; const resource = plan?.resources?.find((item) => item.id === task.resourceId);
      if (!plan || !resource) { await this.failWithRetry(task, new Error('资源计划快照缺失，无法重试图片任务。')); continue; }
      const work = this.startAIHubImage(task, plan, resource);
      this.locks.set(task.taskId, work.finally(() => this.locks.delete(task.taskId)));
    }
    const waitingImages = [...this.tasks.values()].filter((task) => ['aihub-image', 'deterministic'].includes(task.provider) && task.status === 'WAITING_REFERENCE');
    for (const task of waitingImages) {
      const plan = task.planSnapshot;
      const resource = plan?.resources?.find((item) => item.id === task.resourceId);
      /* Poster 是本地已落盘的换装视频抽帧，不需要也不应等待 Provider 的
         sourceUrl。旧逻辑把它当作普通 image-to-image 节点，导致视频成功后
         仍永久停留在 WAITING_REFERENCE。 */
      if (resource?.id === 'outfit-poster') {
        const film = this.latestTask(plan, 'outfit-film');
        if (!film || film.status !== 'SUCCEEDED' || !film.publicUrl) continue;
        task.error = null;
        const work = this.startAIHubImage(task, plan, resource);
        this.locks.set(task.taskId, work.finally(() => this.locks.delete(task.taskId)));
        continue;
      }
      const referenceUrl = resource ? this.referenceUrl(plan, task.referenceResourceId) : null;
      if (!plan || !resource || !referenceUrl) continue;
      task.profileReferenceUrl = referenceUrl;
      task.error = null;
      const work = this.startAIHubImage(task, plan, resource);
      this.locks.set(task.taskId, work.finally(() => this.locks.delete(task.taskId)));
    }
    const activeImages = [...this.tasks.values()].filter((task) => task.provider === 'aihub-image' && task.status === 'RUNNING' && task.runId);
    await Promise.all(activeImages.map((task) => this.refreshTaskLocked(task, this.refreshAIHubImage)));
    const waiting = [...this.tasks.values()].filter((task) => ['aihub-dance', 'aihub-seedance'].includes(task.provider) && ['WAITING_REFERENCE', 'RETRY_WAITING'].includes(task.status));
    for (const task of waiting) await this.startWaitingVideo(task);
    const matting = [...this.tasks.values()].filter((task) => task.status === 'RUNNING' && task.processingStage === 'VIDEO_MATTING' && task.mattingRunId);
    await Promise.all(matting.map((task) => this.refreshTaskLocked(task, this.refreshVideoMatting)));
    const transcoding = [...this.tasks.values()].filter((task) => task.status === 'RUNNING' && task.processingStage === 'MOV_TO_WEBM' && task.transcodeRunId);
    await Promise.all(transcoding.map((task) => this.refreshTaskLocked(task, this.refreshMovToWebm)));
    const active = [...this.tasks.values()].filter((task) => task.provider === 'aihub-dance' && task.status === 'RUNNING' && task.providerRequestId);
    await Promise.all(active.map((task) => this.refreshTaskLocked(task, this.refreshDance)));
    const activeSeedance = [...this.tasks.values()].filter((task) => task.provider === 'aihub-seedance' && task.status === 'RUNNING' && task.providerRequestId && !task.processingStage);
    await Promise.all(activeSeedance.map((task) => this.refreshTaskLocked(task, this.refreshSeedance)));
    return this.list();
  }
  async refreshTaskLocked(task, refreshTask) {
    if (this.locks.has(task.taskId)) return;
    const work = refreshTask.call(this, task);
    this.locks.set(task.taskId, work.finally(() => this.locks.delete(task.taskId)));
    await work;
  }
  async startWaitingVideo(task) {
    if (!this.portraitApprovals.has(task.planId)) {
      task.status = 'WAITING_PORTRAIT_CONFIRMATION';
      task.error = '请先在牌友工坊预览并确认角色资料卡；确认前不会生产视频。';
      task.updatedAt = now();
      await this.persist();
      return;
    }
    const referenceResourceId = task.referenceResourceId || this.referenceResourceId(task.resourceId);
    const reference = referenceResourceId === 'first-outfit'
      ? { resourceId: 'first-outfit', label: '首套服装写真卡面', waitingError: '首套服装卡面仍在生成；换装视频会在同源图片公网 URL 就绪后提交。', missingError: '首套服装卡面未提供 AIHub 可访问的公网 image_url；换装视频未提交。' }
      : referenceResourceId?.startsWith('action-image-')
        ? { resourceId: referenceResourceId, label: `${referenceResourceId.replace('action-image-', '')} 动作 PNG`, waitingError: `${referenceResourceId.replace('action-image-', '')} 动作 PNG 仍在生成或待上传 CS；同编号 WebM 不会提交。`, missingError: `${referenceResourceId.replace('action-image-', '')} 动作 PNG 未通过透明验收或缺少 AIHub 可访问的 CS image_url；同编号 WebM 未提交。` }
        : { resourceId: 'master-portrait', label: '角色资料卡', waitingError: '角色资料卡仍在生成；视频会在角色资料卡公网 URL 就绪后提交。', missingError: '角色资料卡未提供 AIHub 可访问的公网 image_url；视频未提交。' };
    const referenceTask = [...this.tasks.values()]
      .filter((candidate) => candidate.planId === task.planId && candidate.resourceId === reference.resourceId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    const actionVideoBinding = ACTION_VIDEO_RESOURCES.has(task.resourceId)
      ? this.sourceBindings.get(`${task.planId}:${reference.resourceId}:action-video-first-frame`)?.sourceUrl
      : null;
    const boundReferenceUrl = actionVideoBinding || this.referenceUrl(task.planSnapshot, reference.resourceId);
    if ((!referenceTask || ['QUEUED', 'RUNNING', 'SUBMITTING', 'RETRY_WAITING'].includes(referenceTask.status)) && !boundReferenceUrl) {
      task.status = 'WAITING_REFERENCE';
      task.error = reference.waitingError;
      task.updatedAt = now();
      await this.persist();
      return;
    }
    if (referenceTask && referenceTask.status !== 'SUCCEEDED' && !boundReferenceUrl) {
      task.status = 'BLOCKED_REFERENCE';
      task.error = reference.missingError;
      task.updatedAt = now();
      await this.persist();
      return;
    }
    const resource = task.planSnapshot?.resources?.find((item) => item.id === task.resourceId);
    if (!resource) {
      task.status = 'FAILED'; task.error = '资源计划快照缺失，无法恢复视频任务。'; task.updatedAt = now(); await this.persist(); return;
    }
    // 换装演出绝不回退到主立绘：它必须拿到同一套服装的首套卡面公网图。
    /* A video restart must always resolve its upstream artifact again.  Keeping
       the URL recorded on a prior attempt can replay an expired provider URL
       even after the source image has been uploaded to CS and explicitly
       rebound through attachSourceUrl(). */
    const profileReferenceUrl = boundReferenceUrl;
    if (!isUrl(profileReferenceUrl)) {
      task.status = 'BLOCKED_REFERENCE'; task.error = reference.missingError; task.updatedAt = now(); await this.persist(); return;
    }
    task.profileReferenceUrl = profileReferenceUrl;
    task.referenceResourceId = referenceResourceId;
    const work = task.provider === 'aihub-dance'
      ? this.startDance(task, task.planSnapshot, resource, profileReferenceUrl)
      : this.startSeedance(task, task.planSnapshot, resource, profileReferenceUrl);
    this.locks.set(task.taskId, work.finally(() => this.locks.delete(task.taskId)));
  }
  async refreshAIHubImage(task) {
    try {
      const base = String(this.env.AIHUB_AGENT_BASE_URL || 'https://bv.new.ndhy.com/api/agent/aihub').replace(/\/$/, '');
      const headers = { Authorization: `Bearer ${String(this.env.AIHUB_AGENT_TOKEN || '')}` };
      const response = await fetch(`${base}/workflows/runs/${encodeURIComponent(task.runId)}`, { headers, signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`AIHub 图片任务查询失败（HTTP ${response.status}）。`);
      const payload = await response.json(); const state = String(payload?.status || '').toLowerCase();
      if (state === 'succeeded') {
        const outputResponse = await fetch(`${base}/workflows/runs/${encodeURIComponent(task.runId)}/outputs`, { headers, signal: AbortSignal.timeout(30_000) });
        if (!outputResponse.ok) throw new Error(`AIHub 图片任务输出读取失败（HTTP ${outputResponse.status}）。`);
        const outputs = await outputResponse.json(); const url = findUrl(outputs, 'image');
        if (!url) throw new Error('AIHub 图片任务成功但没有可下载的图片 URL。');
        await this.materialize(task, url, { retainSourceUrl: true });
        return;
      }
      if (state === 'failed' || state === 'stopped') { task.status = 'FAILED'; task.error = safeError(payload?.error || payload?.message || `AIHub 图片任务${state}`); task.retryLocked = task.attempt >= 2; task.updatedAt = now(); await this.persist(); }
    } catch (error) { await this.failWithRetry(task, error); }
  }
  async refreshDance(task) {
    try {
      if (task.transport === 'aihub-agent') {
        const base = String(this.env.AIHUB_AGENT_BASE_URL || 'https://bv.new.ndhy.com/api/agent/aihub').replace(/\/$/, '');
        const headers = { Authorization: `Bearer ${String(this.env.AIHUB_AGENT_TOKEN)}` };
        const response = await fetch(`${base}/workflows/runs/${encodeURIComponent(task.runId)}`, { headers, signal: AbortSignal.timeout(30_000) });
        if (!response.ok) throw new Error(`AIHub 跳舞任务查询失败（HTTP ${response.status}）。`);
        const payload = await response.json(); const state = String(payload?.status || '').toLowerCase();
        if (state === 'succeeded') {
          const outputResponse = await fetch(`${base}/workflows/runs/${encodeURIComponent(task.runId)}/outputs`, { headers, signal: AbortSignal.timeout(30_000) });
          const outputs = outputResponse.ok ? await outputResponse.json() : payload;
          const url = findUrl(outputs, 'video'); if (!url) throw new Error('AIHub 跳舞任务成功但没有可下载的视频 URL。'); await this.materialize(task, url, { retainSourceUrl: true }); return;
        }
        if (state === 'failed' || state === 'stopped') { task.status = 'FAILED'; task.error = safeError(payload?.error || `AIHub 跳舞任务${state}`); task.retryLocked = task.attempt >= 2; task.updatedAt = now(); await this.persist(); }
        return;
      }
      const base = String(this.env.AIHUB_DANCE_BASE_URL || 'https://ai-hub-api.aiae.ndhy.com').replace(/\/$/, '');
      const { 'Content-Type': unused, ...headers } = danceHeaders(this.env);
      const response = await fetch(`${base}/async_task/api/tasks/${encodeURIComponent(task.providerRequestId)}`, { headers, signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`AIHub 跳舞任务查询失败（HTTP ${response.status}）。`);
      const payload = await response.json(); const state = String(payload?.status || '').toLowerCase();
      if (state === 'succeeded') { const url = findUrl(payload?.answer, 'video'); if (!url) throw new Error('AIHub 跳舞任务成功但没有可下载的视频 URL。'); await this.materialize(task, url); return; }
      if (state === 'failed' || state === 'stopped') { task.status = 'FAILED'; task.error = safeError(payload?.error || payload?.answer?.error || `AIHub 跳舞任务${state}`); task.retryLocked = task.attempt >= 2; task.updatedAt = now(); await this.persist(); }
    } catch (error) { await this.failWithRetry(task, error); }
  }
  async refreshSeedance(task) {
    try {
      if (task.ignoreProviderOutput) return;
      const base = String(this.env.AIHUB_AGENT_BASE_URL || 'https://bv.new.ndhy.com/api/agent/aihub').replace(/\/$/, '');
      const headers = { Authorization: `Bearer ${String(this.env.AIHUB_AGENT_TOKEN || '')}` };
      const response = await fetch(`${base}/workflows/runs/${encodeURIComponent(task.runId)}`, { headers, signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`AIHub Seedance 任务查询失败（HTTP ${response.status}）。`);
      const payload = await response.json(); const state = String(payload?.status || '').toLowerCase();
      if (state === 'succeeded') {
        const outputResponse = await fetch(`${base}/workflows/runs/${encodeURIComponent(task.runId)}/outputs`, { headers, signal: AbortSignal.timeout(30_000) });
        const outputs = outputResponse.ok ? await outputResponse.json() : payload;
        const url = findUrl(outputs, 'video'); if (!url) throw new Error('AIHub Seedance 任务成功但没有可下载的视频 URL。'); await this.materialize(task, url, { retainSourceUrl: true }); return;
      }
      if (state === 'failed' || state === 'stopped') { task.status = 'FAILED'; task.error = safeError(payload?.error || payload?.message || `AIHub Seedance 任务${state}`); task.retryLocked = task.attempt >= 2; task.updatedAt = now(); await this.persist(); }
    } catch (error) { await this.failWithRetry(task, error); }
  }
  async materialize(task, sourceUrl, { retainSourceUrl = false } = {}) {
    const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`生产文件下载失败（HTTP ${response.status}）。`);
    let contentType = String(response.headers.get('content-type') || '').toLowerCase();
    const maximum = task.kind === 'video' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
    if (task.kind === 'video' ? !contentType.startsWith('video/') && !contentType.includes('octet-stream') : !contentType.startsWith('image/')) throw new Error(`生产文件 MIME 不符合 ${task.kind} 用途。`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (retainSourceUrl) task.sourceUrl = sourceUrl;
    if (task.kind === 'image' && ALPHA_IMAGE_RESOURCES.has(task.resourceId) && (!hasPngAlpha(bytes) || !hasTransparentCanvas(bytes))) {
      try {
        const repaired = await this.repairOpaqueAlpha(bytes);
        if (hasPngAlpha(repaired) && hasTransparentCanvas(repaired)) {
          task.alphaStage = 'LOCAL_CUTOUT';
          await this.materializeBytes(task, repaired, 'image/png');
          return;
        }
      } catch (repairError) {
        task.error = `本地 alpha 修复未通过：${errorText(repairError)}`;
      }
      if (task.alphaStage === 'REMOVE_BG') throw new Error(`${task.label || task.resourceId}经本地与去背景工作流后仍没有合格的透明画布；不能把带场景、白底或底板的图片上桌。`);
      await this.startAIHubRemoveBg(task, sourceUrl);
      return;
    }
    if (task.kind === 'video' && ACTION_VIDEO_RESOURCES.has(task.resourceId) && hasWebmSignature(bytes)) contentType = 'video/webm';
    await this.materializeBytes(task, bytes, contentType, maximum, sourceUrl);
  }
  async materializeBytes(task, bytes, contentType, maximum = task.kind === 'video' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES, sourceUrl = null) {
    if (!bytes.length || bytes.length > maximum) throw new Error('生产文件为空或超出资源大小上限。');
    if (task.kind === 'video' && ACTION_VIDEO_RESOURCES.has(task.resourceId)) {
      /* Seedance returns a normal MP4 source. The runtime contract is not an
         MP4 with a painted backdrop: it is a reviewed VP9-alpha WebM. Only a
         clean chroma-source is eligible for deterministic keying; scene video
         fails closed rather than silently becoming a fake transparent asset. */
      if (!/webm/i.test(contentType) && !hasWebmSignature(bytes)) {
        try {
          bytes = await this.stageActionAlphaVideo(task, bytes);
        } catch (error) {
          /* Seedance does not reliably honour a chroma-screen prompt.  A scene
             source is not accepted as transparent; hand it to the dedicated
             AIHub matting + WebM route, then validate the returned alpha. */
          if (!task.mattingRunId && isUrl(sourceUrl)) {
            await this.startVideoMatting(task, sourceUrl);
            return;
          }
          throw error;
        }
      }
      await this.validateActionVideo(bytes, task);
      contentType = 'video/webm';
    }
    if (task.kind === 'video' && task.resourceId === 'entry-film') await this.inspectEntryVideo(task, bytes);
    if (task.kind === 'image' && ALPHA_IMAGE_RESOURCES.has(task.resourceId) && (!hasPngAlpha(bytes) || !hasTransparentCanvas(bytes))) {
      throw new Error(`${task.label || task.resourceId}必须输出带真实 alpha 通道且边缘没有场景底板的 PNG；禁止白底、灰底、桌面、房间或棋盘格占位图。`);
    }
    if (task.resourceId === 'first-outfit') {
      const dimensions = imageDimensions(bytes);
      if (!dimensions || dimensions.width * 4 !== dimensions.height * 3) throw new Error(`首套服装写真卡面必须为精确 3:4 图片，实际尺寸为 ${dimensions ? `${dimensions.width}x${dimensions.height}` : '无法读取'}。`);
      task.width = dimensions.width; task.height = dimensions.height;
    }
    const fileName = `${task.planId}-${task.resourceId}.${extensionFor(contentType, task.kind)}`;
    const folder = this.assetFolder(task.planSnapshot);
    const relativeFile = `${folder}/${fileName}`;
    const targetDir = join(this.assetDir, folder);
    const targetPath = join(targetDir, fileName);
    await mkdir(targetDir, { recursive: true }); await writeFile(targetPath, bytes);
    task.mapping = RESOURCE_SLOTS[task.resourceId] || null;
    if (task.mapping && task.resourceId !== 'master-portrait') task.reviewStatus = 'AWAITING_REVIEW';
    if (task.resourceId === 'action-sheet' && imageDimensions(bytes)?.width >= 300) {
      const { stdout } = await execFileAsync(String(this.env.PYTHON || 'python'), [join(dirname(ALPHA_REPAIR_SCRIPT), 'split-action-sheet.py'), targetPath], { timeout: 60_000 });
      task.derivedImages = Object.fromEntries(Object.entries(JSON.parse(stdout)).map(([key, value]) => [key, { ...value, publicUrl: this.assetUrl(`${folder}/${value.file}`), reviewStatus: 'AWAITING_REVIEW' }]));
    }
    task.publicUrl = this.assetUrl(relativeFile); task.sha256 = createHash('sha256').update(bytes).digest('hex'); task.bytes = bytes.length; task.status = 'SUCCEEDED'; task.error = null; task.updatedAt = now(); await this.persist();
  }
  async inspectEntryVideo(task, bytes) {
    const dir = await mkdtemp(join(tmpdir(), 'dressbattle-entry-video-'));
    const source = join(dir, 'source.bin');
    try {
      await writeFile(source, bytes);
      const { stdout } = await execFileAsync(String(this.env.FFPROBE || 'ffprobe'), ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,duration', '-of', 'json', source], { timeout: 30_000 });
      const stream = JSON.parse(stdout || '{}')?.streams?.[0];
      const width = Number(stream?.width || 0); const height = Number(stream?.height || 0);
      if (!width || !height) throw new Error('未检测到可用视频尺寸');
      task.width = width; task.height = height; task.durationMs = Math.round(Number(stream.duration || 0) * 1000) || null;
      const ratio = width / height;
      if (Math.abs(ratio - (16 / 9)) > 0.03) {
        throw new Error(`入场视频必须为横屏 16:9，实际为 ${width}x${height}；竖版写真或跳舞片不可用于进入牌局。`);
      }
      task.presentation = 'landscape';
    } catch (error) {
      throw new Error(`${task.label || task.resourceId} 视频规格检测失败：${safeError(error)}`);
    } finally { await rm(dir, { recursive: true, force: true }).catch(() => {}); }
  }
  async startVideoMatting(task, sourceUrl) {
    const token = String(this.env.AIHUB_AGENT_TOKEN || '').trim();
    const appId = skillAppId('video-matting', this.env);
    if (!token || !appId) throw new Error('AIHub 视频抠图工作流未配置。');
    const base = String(this.env.AIHUB_AGENT_BASE_URL || 'https://bv.new.ndhy.com/api/agent/aihub').replace(/\/$/, '');
    task.processingStage = 'VIDEO_MATTING'; task.mattingSourceUrl = sourceUrl; task.status = 'SUBMITTING'; task.updatedAt = now(); await this.persist();
    const response = await fetch(`${base}/workflows/run`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId, inputs: { url: sourceUrl }, meta: { label: `${task.planId}:${task.resourceId}:video-matting`, workflowAlias: 'video-matting' } }), signal: AbortSignal.timeout(30_000)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error || payload?.message || `AIHub 视频抠图提交失败（HTTP ${response.status}）。`);
    task.mattingRunId = payload?.runId || payload?.id || null;
    if (!task.mattingRunId) throw new Error('AIHub 视频抠图未返回 runId。');
    task.status = 'RUNNING'; task.updatedAt = now(); await this.persist();
  }
  async refreshVideoMatting(task) {
    try {
      const base = String(this.env.AIHUB_AGENT_BASE_URL || 'https://bv.new.ndhy.com/api/agent/aihub').replace(/\/$/, '');
      const headers = { Authorization: `Bearer ${String(this.env.AIHUB_AGENT_TOKEN || '')}` };
      const response = await fetch(`${base}/workflows/runs/${encodeURIComponent(task.mattingRunId)}`, { headers, signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`AIHub 视频抠图查询失败（HTTP ${response.status}）。`);
      const payload = await response.json(); const state = String(payload?.status || '').toLowerCase();
      if (state === 'succeeded') {
        const outputResponse = await fetch(`${base}/workflows/runs/${encodeURIComponent(task.mattingRunId)}/outputs`, { headers, signal: AbortSignal.timeout(30_000) });
        const outputs = outputResponse.ok ? await outputResponse.json() : payload;
        const url = findUrl(outputs, 'video'); if (!url) throw new Error('AIHub 视频抠图成功但没有视频 URL。');
        /* AIHub 的通用 MOV→WebM 工作流会把 ProRes alpha 压成普通 WebM。
           抠像由 AIHub 完成；最终封装在本机用 VP9/yuva420p 保留该 alpha，
           并立即走同一份严格 alpha 验收。 */
        await this.materializeMattingMov(task, url); return;
      }
      if (state === 'failed' || state === 'stopped') throw new Error(safeError(payload?.error || payload?.message || `AIHub 视频抠图任务${state}`));
    } catch (error) { await this.failWithRetry(task, error); }
  }
  async startMovToWebm(task, movUrl) {
    const token = String(this.env.AIHUB_AGENT_TOKEN || '').trim();
    const appId = skillAppId('mov-to-webm', this.env);
    if (!token || !appId) throw new Error('AIHub MOV 转 WebM 工作流未配置。');
    const base = String(this.env.AIHUB_AGENT_BASE_URL || 'https://bv.new.ndhy.com/api/agent/aihub').replace(/\/$/, '');
    task.processingStage = 'MOV_TO_WEBM'; task.mattingVideoUrl = movUrl; task.status = 'SUBMITTING'; task.updatedAt = now(); await this.persist();
    const response = await fetch(`${base}/workflows/run`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId, inputs: { mov_video_url: movUrl }, meta: { label: `${task.planId}:${task.resourceId}:mov-to-webm`, workflowAlias: 'mov-to-webm' } }), signal: AbortSignal.timeout(30_000)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error || payload?.message || `AIHub MOV 转 WebM 提交失败（HTTP ${response.status}）。`);
    task.transcodeRunId = payload?.runId || payload?.id || null;
    if (!task.transcodeRunId) throw new Error('AIHub MOV 转 WebM 未返回 runId。');
    task.status = 'RUNNING'; task.updatedAt = now(); await this.persist();
  }
  async materializeMattingMov(task, movUrl) {
    const dir = await mkdtemp(join(tmpdir(), 'dressbattle-matting-alpha-'));
    const source = join(dir, 'matting.mov');
    const output = join(dir, 'matting-alpha.webm');
    const preview = join(dir, 'matting-alpha-review.png');
    try {
      task.processingStage = 'ALPHA_WEBM_ENCODE'; task.mattingVideoUrl = movUrl; task.status = 'RUNNING'; task.updatedAt = now(); await this.persist();
      const response = await fetch(movUrl, { signal: AbortSignal.timeout(120_000) });
      if (!response.ok) throw new Error(`AIHub 抠像 MOV 下载失败（HTTP ${response.status}）。`);
      const sourceBytes = Buffer.from(await response.arrayBuffer());
      if (!sourceBytes.length || sourceBytes.length > MAX_VIDEO_BYTES) throw new Error('AIHub 抠像 MOV 为空或超过视频大小上限。');
      await writeFile(source, sourceBytes);
      await execFileAsync('ffmpeg', ['-y', '-v', 'error', '-i', source, '-map', '0:v:0', '-an', '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-crf', '18', '-b:v', '0', '-auto-alt-ref', '0', '-metadata:s:v:0', 'alpha_mode=1', output], { timeout: 10 * 60_000, maxBuffer: 30_000 });
      const bytes = await readFile(output);
      await this.validateActionVideo(bytes, task);
      /* A container alpha flag is only the technical gate.  Render one decoded
         frame over black, magenta and white so reviewers can see white halos,
         missing limbs and dirty edges before the WebM is allowed on the table. */
      await execFileAsync('ffmpeg', [
        '-y', '-v', 'error', '-ss', '1', '-c:v', 'libvpx-vp9', '-i', output,
        '-filter_complex',
        '[0:v]scale=300:400:force_original_aspect_ratio=decrease,pad=300:400:(ow-iw)/2:(oh-ih)/2:color=black@0,format=rgba,split=3[fg1][fg2][fg3];' +
        'color=c=black:s=300x400:d=1[bg1];color=c=magenta:s=300x400:d=1[bg2];color=c=white:s=300x400:d=1[bg3];' +
        '[bg1][fg1]overlay=shortest=1[o1];[bg2][fg2]overlay=shortest=1[o2];[bg3][fg3]overlay=shortest=1[o3];' +
        '[o1][o2][o3]hstack=inputs=3[out]',
        '-map', '[out]', '-frames:v', '1', preview
      ], { timeout: 60_000, maxBuffer: 30_000 });
      const folder = this.assetFolder(task.planSnapshot);
      const targetDir = join(this.assetDir, folder);
      const previewName = `${task.planId}-${task.resourceId}-alpha-review.png`;
      await mkdir(targetDir, { recursive: true });
      await writeFile(join(targetDir, previewName), await readFile(preview));
      task.alphaPreviewUrl = this.assetUrl(`${folder}/${previewName}`);
      task.alphaStage = 'TECHNICAL_PASS_REQUIRES_VISUAL_REVIEW';
      task.alphaReviewRequired = true;
      await this.materializeBytes(task, bytes, 'video/webm');
    } finally { await rm(dir, { recursive: true, force: true }).catch(() => {}); }
  }
  /* Seedance's generic reference mode can return a technically valid clip
     with a different face, hairstyle or outfit.  The accepted A01-A05 PNGs
     are the identity authority.  This deterministic fallback turns the
     matching, already-reviewed PNG into a short alpha WebM with restrained
     action-specific motion, then sends it through the exact same technical
     and three-background review gates as provider video. */
  async createActionVideoFromApprovedImage(plan, resourceId, { reason = '' } = {}) {
    await this.ready;
    if (!ACTION_VIDEO_RESOURCES.has(resourceId)) throw new Error('确定性动作视频只支持 A01-A05。');
    const actionCode = resourceId.slice('action-'.length).toUpperCase();
    const imageResourceId = `action-image-${actionCode}`;
    const imageTask = this.latestTask(plan, imageResourceId);
    if (!imageTask || imageTask.status !== 'SUCCEEDED' || imageTask.reviewStatus !== 'APPROVED' || !imageTask.publicUrl) {
      throw new Error(`${actionCode} 动作图尚未成功落盘并通过人工验收，不能生成动作 WebM。`);
    }
    const previous = this.latestTask(plan, resourceId);
    if (previous) {
      previous.ignoreProviderOutput = true;
      previous.reviewStatus = 'REJECTED';
      previous.alphaVisualApproved = false;
      previous.reviewNote = String(reason || '供应商视频角色身份漂移，改用已验收同编号动作 PNG。').slice(0, 200);
      if (ACTIVE.has(previous.status)) previous.status = 'FAILED';
      previous.error = '供应商结果已被身份一致性门禁撤回；后续返回不会覆盖已验收动作图生成的 WebM。';
      previous.updatedAt = now();
    }
    const resource = plan.resources.find((item) => item.id === resourceId);
    if (!resource) throw new Error(`资源计划缺少 ${resourceId}。`);
    const createdAt = now();
    const task = {
      taskId: randomUUID(), planId: plan.planId, resourceId, label: resource.label, kind: 'video',
      planSnapshot: plan, route: 'deterministic:approved-action-png-v1', provider: 'deterministic', transport: 'local-ffmpeg',
      status: 'RUNNING', attempt: Number(previous?.attempt || 0) + 1, createdAt, updatedAt: createdAt,
      runId: null, providerRequestId: null, publicUrl: null, sha256: null, bytes: null, width: null, height: null,
      error: null, retryLocked: false, promptRevision: 'approved-action-png-motion-v1', promptPatch: '',
      previousTaskId: previous?.taskId || null, referenceResourceId: imageResourceId,
      profileReferenceUrl: imageTask.publicUrl, sourceTaskId: imageTask.taskId,
      promptSummary: `严格复用已验收 ${actionCode} 动作 PNG；禁止改脸、改发型、改服装。`
    };
    this.tasks.set(task.taskId, task);
    await this.persist();
    const dir = await mkdtemp(join(tmpdir(), 'dressbattle-action-png-video-'));
    const source = this.assetPath(imageTask.publicUrl);
    const output = join(dir, `${actionCode}.webm`);
    const preview = join(dir, `${actionCode}-review.png`);
    const scaleExpression = {
      A01: '1180*(1+0.006*sin(2*PI*n/76))',
      A02: '1180*(1+0.012*sin(PI*n/76))',
      A03: '1180*(1-0.008*sin(PI*n/76))',
      A04: '1180*(1+0.015*abs(sin(2*PI*n/76)))',
      A05: '1180*(1-0.012*abs(sin(PI*n/76)))'
    }[actionCode];
    try {
      await execFileAsync('ffmpeg', [
        '-y', '-v', 'error', '-loop', '1', '-framerate', '24', '-i', source,
        '-t', '3.2', '-vf', `scale=w='${scaleExpression}':h=-1:eval=frame,pad=1248:1664:(ow-iw)/2:(oh-ih)/2:color=0x00000000:eval=frame,format=yuva420p`,
        '-an', '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p',
        '-crf', '18', '-b:v', '0', '-auto-alt-ref', '0', '-metadata:s:v:0', 'alpha_mode=1', output
      ], { timeout: 5 * 60_000, maxBuffer: 30_000 });
      const bytes = await readFile(output);
      await this.validateActionVideo(bytes, task);
      await execFileAsync('ffmpeg', [
        '-y', '-v', 'error', '-ss', '1', '-c:v', 'libvpx-vp9', '-i', output,
        '-filter_complex',
        '[0:v]scale=300:400:force_original_aspect_ratio=decrease,pad=300:400:(ow-iw)/2:(oh-ih)/2:color=black@0,format=rgba,split=3[fg1][fg2][fg3];' +
        'color=c=black:s=300x400:d=1[bg1];color=c=magenta:s=300x400:d=1[bg2];color=c=white:s=300x400:d=1[bg3];' +
        '[bg1][fg1]overlay=shortest=1[o1];[bg2][fg2]overlay=shortest=1[o2];[bg3][fg3]overlay=shortest=1[o3];' +
        '[o1][o2][o3]hstack=inputs=3[out]',
        '-map', '[out]', '-frames:v', '1', preview
      ], { timeout: 60_000, maxBuffer: 30_000 });
      const folder = this.assetFolder(plan);
      const targetDir = join(this.assetDir, folder);
      const previewName = `${task.planId}-${task.resourceId}-alpha-review.png`;
      await mkdir(targetDir, { recursive: true });
      await writeFile(join(targetDir, previewName), await readFile(preview));
      task.alphaPreviewUrl = this.assetUrl(`${folder}/${previewName}`);
      task.alphaStage = 'TECHNICAL_PASS_REQUIRES_VISUAL_REVIEW';
      task.alphaReviewRequired = true;
      await this.materializeBytes(task, bytes, 'video/webm');
      return publicTask(task);
    } catch (error) {
      task.status = 'FAILED'; task.error = safeError(error); task.updatedAt = now(); await this.persist();
      throw error;
    } finally { await rm(dir, { recursive: true, force: true }).catch(() => {}); }
  }
  async refreshMovToWebm(task) {
    try {
      const base = String(this.env.AIHUB_AGENT_BASE_URL || 'https://bv.new.ndhy.com/api/agent/aihub').replace(/\/$/, '');
      const headers = { Authorization: `Bearer ${String(this.env.AIHUB_AGENT_TOKEN || '')}` };
      const response = await fetch(`${base}/workflows/runs/${encodeURIComponent(task.transcodeRunId)}`, { headers, signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`AIHub MOV 转 WebM 查询失败（HTTP ${response.status}）。`);
      const payload = await response.json(); const state = String(payload?.status || '').toLowerCase();
      if (state === 'succeeded') {
        const outputResponse = await fetch(`${base}/workflows/runs/${encodeURIComponent(task.transcodeRunId)}/outputs`, { headers, signal: AbortSignal.timeout(30_000) });
        const outputs = outputResponse.ok ? await outputResponse.json() : payload;
        const url = findUrl(outputs, 'video'); if (!url) throw new Error('AIHub MOV 转 WebM 成功但没有 WebM URL。');
        await this.materialize(task, url, { retainSourceUrl: true }); return;
      }
      if (state === 'failed' || state === 'stopped') throw new Error(safeError(payload?.error || payload?.message || `AIHub MOV 转 WebM 任务${state}`));
    } catch (error) { await this.failWithRetry(task, error); }
  }
  async stageActionAlphaVideo(task, sourceBytes) {
    const dir = await mkdtemp(join(tmpdir(), 'dressbattle-action-alpha-'));
    const source = join(dir, 'seedance-source.mp4');
    const delivery = join(dir, 'delivery');
    try {
      await writeFile(source, sourceBytes);
      const python = String(this.env.PYTHON || 'python').trim() || 'python';
      /* The runner detects a clean outer chroma field and rejects a normal
         casino/room background. It also verifies decoded alpha and creates
         black/magenta/white previews before anything can be approved. */
      /* Seedance's green-screen compression can leave a thin dark-green
         contour around hair and sleeves.  The repair skill's global despill
         plus enclosed-hole cleanup is safe for our fully-clothed action
         contract and removes that residual spill before the strict 64-pixel
         validator runs. */
      await execFileAsync(python, [ACTION_ALPHA_RUNNER, source, '--delivery-dir', delivery, '--canvas', '1248x1664', '--screen-colour', 'green', '--global-screen-despill', '--remove-enclosed-screen', '--lossless'], { timeout: 10 * 60_000, maxBuffer: 30_000 });
      const reviewDir = join(delivery, '_review');
      const files = await readdir(reviewDir);
      const webm = files.find((file) => /1248x1664_transparent_vp9\.webm$/i.test(file)) || files.find((file) => /transparent_vp9\.webm$/i.test(file));
      const preview = files.find((file) => /1248x1664_quality-preview\.png$/i.test(file)) || files.find((file) => /quality-preview\.png$/i.test(file));
      if (!webm) throw new Error('透明视频后处理没有产出 VP9 WebM。');
      const folder = this.assetFolder(task.planSnapshot);
      const targetDir = join(this.assetDir, folder);
      await mkdir(targetDir, { recursive: true });
      if (preview) {
        const previewName = `${task.planId}-${task.resourceId}-alpha-review.png`;
        await writeFile(join(targetDir, previewName), await readFile(join(reviewDir, preview)));
        task.alphaPreviewUrl = this.assetUrl(`${folder}/${previewName}`);
      }
      task.alphaStage = 'TECHNICAL_PASS_REQUIRES_VISUAL_REVIEW';
      task.alphaReviewRequired = true;
      return await readFile(join(reviewDir, webm));
    } catch (error) {
      throw new Error(`${task.label || task.resourceId} 无法转为透明动作 WebM：上游必须提供单人、纯绿幕、无场景的动作源视频。${safeError(error)}`);
    } finally { await rm(dir, { recursive: true, force: true }).catch(() => {}); }
  }
  async validateActionVideo(bytes, task) {
    const dir = await mkdtemp(join(tmpdir(), 'dressbattle-action-video-'));
    const source = join(dir, 'source.bin');
    try {
      await writeFile(source, bytes);
      const { stdout } = await execFileAsync(String(this.env.FFPROBE || 'ffprobe'), ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height,pix_fmt,duration:stream_tags=ALPHA_MODE', '-of', 'json', source], { timeout: 30_000 });
      const stream = JSON.parse(stdout || '{}')?.streams?.[0];
      if (!stream) throw new Error('未检测到视频流');
      const ratio = Number(stream.width || 0) / Math.max(1, Number(stream.height || 0));
      const duration = Number(stream.duration || 0);
      /* VP9 alpha is commonly reported by ffprobe as yuv420p even when the
         WebM carries a valid BlockAdditional alpha plane.  The repair skill
         already decodes every frame and verifies packets; ALPHA_MODE=1 is the
         container-level contract that must be checked here instead of pix_fmt. */
      const alphaMode = String(stream.tags?.ALPHA_MODE || '') === '1';
      const problems = [];
      if (String(stream.codec_name || '').toLowerCase() !== 'vp9') problems.push(`codec=${stream.codec_name || 'unknown'}（要求 VP9 WebM）`);
      if (!alphaMode) problems.push(`ALPHA_MODE=${stream.tags?.ALPHA_MODE || 'missing'}（没有真实 alpha）`);
      if (Math.abs(ratio - 0.75) > 0.03) problems.push(`比例=${stream.width || '?'}x${stream.height || '?'}（要求 3:4）`);
      if (duration && (duration < 2 || duration > 4.5)) problems.push(`时长=${duration.toFixed(2)}s（要求 2–4s）`);
      if (problems.length) throw new Error(`${task.label || task.resourceId} 视频契约不合格：${problems.join('；')}`);
      task.width = Number(stream.width); task.height = Number(stream.height); task.durationMs = Math.round(duration * 1000); task.codec = String(stream.codec_name); task.pixelFormat = String(stream.pix_fmt);
    } catch (error) {
      if (String(error?.message || '').includes('视频契约不合格')) throw error;
      throw new Error(`${task.label || task.resourceId} 视频规格检测失败：${safeError(error)}`);
    } finally { await rm(dir, { recursive: true, force: true }).catch(() => {}); }
  }
  /* 存量五态源图补拆：拆分功能上线前的 action-sheet 任务没有 derivedImages，
     运行时不得直接加载整张拼图。按同一 3×2 固定网格补拆，产物标 AWAITING_REVIEW，
     走 confirmResource 在工坊逐张验收后才进入候选资源。 */
  async backfillActionSheets() {
    await this.ready;
    let changed = false;
    for (const task of this.tasks.values()) {
      if (task.resourceId !== 'action-sheet' || task.status !== 'SUCCEEDED' || task.derivedImages || !task.publicUrl) continue;
      const sourcePath = this.assetPath(task.publicUrl);
      try {
        const { stdout } = await execFileAsync(String(this.env.PYTHON || 'python'), [join(dirname(ALPHA_REPAIR_SCRIPT), 'split-action-sheet.py'), sourcePath], { timeout: 60_000 });
        const sourceRelative = String(task.publicUrl).split('?')[0].slice(`${this.assetUrlPrefix}/`.length);
        const sourceFolder = sourceRelative.includes('/') ? sourceRelative.slice(0, sourceRelative.lastIndexOf('/')) : '';
        task.derivedImages = Object.fromEntries(Object.entries(JSON.parse(stdout)).map(([key, value]) => [key, { ...value, publicUrl: this.assetUrl(sourceFolder ? `${sourceFolder}/${value.file}` : value.file), reviewStatus: 'AWAITING_REVIEW' }]));
      } catch (error) {
        task.error = `存量五态源图补拆失败：${errorText(error)}`;
      }
      task.updatedAt = now();
      changed = true;
    }
    if (changed) await this.persist();
    return this.list();
  }
  /* 原地重启（用户显式触发，区别于 submitResource 的链式新尝试）：
     已提交但未取回资源的（RUNNING 且有 runId/providerRequestId）先按当前 run 取回一次现成产物，
     不重新扣费；失败/阻塞/卡住的任务则同一 taskId 原地重置为排队/等待参考并立即开工。
     状态机保持 attempt+1 的可追溯性，但不新增任务记录。 */
  async restartResource(taskId, { promptPatch = '', reason = '' } = {}) {
    await this.ready;
    const task = this.tasks.get(String(taskId || ''));
    if (!task) throw new Error('生产任务不存在或已删除。');
    if (task.status === 'RUNNING' && (task.runId || task.providerRequestId)) {
      if (task.provider === 'aihub-image') await this.refreshAIHubImage(task);
      else if (task.provider === 'aihub-dance') await this.refreshDance(task);
      else if (task.provider === 'aihub-seedance') await this.refreshSeedance(task);
      else if (task.kind === 'image') {
        /* 早期 AI Gateway 图片任务没有进入当前的 AIHub 状态轮询，留下 RUNNING
           即永远不会被 refresh() 收敛。它不是仍在真实生产，而是不可轮询的陈旧 run：
           清空旧 run 后按当前即梦图片路线重新提交。 */
        task.status = 'QUEUED';
        task.error = '旧版 AI Gateway 图片任务无法由当前 AIHub 轮询恢复，已切换为当前图片生产路线重新提交。';
        task.runId = null;
        task.providerRequestId = null;
        task.updatedAt = now();
      } else {
        throw new Error('该任务正在生产中，等当前生产结束即可，不需要重启。');
      }
      if (task.status !== 'QUEUED') return publicTask(task);
    }
    if (!['FAILED', 'BLOCKED_REFERENCE', 'RETRY_WAITING', 'QUEUED', 'WAITING_REFERENCE', 'WAITING_PORTRAIT_CONFIRMATION'].includes(task.status)) {
      throw new Error('只有失败、阻塞或卡住的任务可以重新生产；已成功的资源请用打回重产。');
    }
    /* 本地解析失败不等于供应商转码失败。保留已经 succeeded 的转码 run，修复
       解析代码后只重新读取其 outputs，绝不重复提交抠像或转码。 */
    if (task.status === 'FAILED' && task.processingStage === 'MOV_TO_WEBM' && task.transcodeRunId) {
      task.status = 'RUNNING';
      task.error = null;
      task.updatedAt = now();
      await this.persist();
      /* Historical runs already have an alpha MOV URL. Re-encode that source
         locally so the AIHub generic WebM converter cannot strip alpha again. */
      const work = task.mattingVideoUrl
        ? this.materializeMattingMov(task, task.mattingVideoUrl).catch((error) => this.failWithRetry(task, error))
        : this.refreshMovToWebm(task);
      this.locks.set(task.taskId, work.finally(() => this.locks.delete(task.taskId)));
      return publicTask(task);
    }
    const plan = task.planSnapshot;
    const resource = plan?.resources?.find((item) => item.id === task.resourceId);
    if (!plan || !resource) throw new Error('资源计划快照缺失，无法原地重启。');
    if (String(promptPatch || '').trim()) task.promptPatch = String(promptPatch).trim().slice(0, 4000);
    if (String(reason || '').trim()) task.reviewNote = `原地重产：${String(reason).trim().slice(0, 1000)}`;
    /* Seedance 偶尔会忽略绿幕约束而回传实景视频。此时不可重复提交同一段生成：
       直接复用已经落盘的源视频，交给 AIHub 抠像与 MOV→WebM 生产链处理；这样
       身份、动作和衣装仍来自已验收的角色资料卡，也避免重复扣一次视频生成。 */
    const canMatteExistingSource = task.kind === 'video'
      && ACTION_VIDEO_RESOURCES.has(task.resourceId)
      && isUrl(task.sourceUrl)
      && /绿幕|green[ -]?screen|chroma|透明动作|边缘.*背景|screen pixels/i.test(String(task.error || ''));
    if (canMatteExistingSource) {
      task.status = 'RUNNING';
      task.attempt = Number(task.attempt || 0) + 1;
      task.restartCount = Number(task.restartCount || 0) + 1;
      task.error = null;
      task.retryLocked = false;
      task.processingStage = null;
      task.mattingRunId = null;
      task.transcodeRunId = null;
      task.updatedAt = now();
      await this.persist();
      const work = this.startVideoMatting(task, task.sourceUrl);
      this.locks.set(task.taskId, work.finally(() => this.locks.delete(task.taskId)));
      return publicTask(task);
    }
    /* If image generation itself succeeded and only alpha validation failed,
       reuse the persisted provider source.  This lets a repaired deterministic
       matte be applied without paying for or drifting through another image
       generation. */
    const canRecoverExistingImage = task.kind === 'image'
      && ALPHA_IMAGE_RESOURCES.has(task.resourceId)
      && isUrl(task.sourceUrl)
      && /alpha|透明|背景|底板|抠像/i.test(String(task.error || ''));
    if (canRecoverExistingImage) {
      task.attempt = Number(task.attempt || 0) + 1;
      task.restartCount = Number(task.restartCount || 0) + 1;
      task.retryLocked = false;
      task.updatedAt = now();
      await this.persist();
      const work = this.startLocalAlphaRecovery(task, task.sourceUrl);
      this.locks.set(task.taskId, work.finally(() => this.locks.delete(task.taskId)));
      return publicTask(task);
    }
    task.status = task.kind === 'video' ? 'WAITING_REFERENCE' : 'QUEUED';
    task.attempt = Number(task.attempt || 0) + 1;
    task.restartCount = Number(task.restartCount || 0) + 1;
    task.error = null;
    task.retryLocked = false;
    task.runId = null;
    task.providerRequestId = null;
    /* 原地重产也必须迁移执行身份。仅改 status 会让旧 ai-gateway 标记避开
       aihub-image 的轮询队列，虽然已经提交到新工作流，却永远显示为生产中。 */
    if (task.kind === 'image') {
      task.provider = resource.id === 'outfit-poster' ? 'deterministic' : 'aihub-image';
      task.transport = resource.id === 'outfit-poster' ? null : 'aihub-agent';
      task.route = DISPLAY_ROUTE_BY_RESOURCE[resource.id]?.production || resource.production;
      task.model = resource.id === 'master-portrait' ? DEFAULT_IMAGE_MODEL : DEFAULT_IMAGE_FALLBACK_MODEL;
    }
    task.strategyVersion = IMAGE_STRATEGY_VERSION;
    task.updatedAt = now();
    await this.persist();
    const work = task.kind === 'video'
      ? this.startWaitingVideo(task)
      : this.startAIHubImage(task, plan, resource);
    this.locks.set(task.taskId, work.finally(() => this.locks.delete(task.taskId)));
    return publicTask(task);
  }

  async tryPromote(plan) {
    await this.ready;
    const latest = new Map();
    for (const task of this.list(plan.planId)) {
      const current = latest.get(task.resourceId);
      if (!current || task.updatedAt > current.updatedAt) latest.set(task.resourceId, task);
    }
    const required = plan.resources.filter((resource) => resource.requiredForSeat);
    /* 被打回（REJECTED）的资源不算完成：上桌门禁把它当作缺口，直到重产并验收。 */
    if (!required.every((resource) => { const item = latest.get(resource.id); return item?.status === 'SUCCEEDED' && item?.reviewStatus !== 'REJECTED' && (!ACTION_VIDEO_RESOURCES.has(resource.id) || item?.alphaVisualApproved === true); })) return null;
    const resources = Object.fromEntries([...latest.entries()].filter(([, task]) => task.publicUrl).map(([id, task]) => [id, task.publicUrl]));
    const resourceMeta = Object.fromEntries([...latest.entries()].map(([id, task]) => [id, { alphaVisualApproved: task.alphaVisualApproved === true }]));
    for (const [key, entry] of Object.entries(latest.get('action-sheet')?.derivedImages || {})) if (entry.reviewStatus === 'APPROVED') resources[`action-image-${key}`] = entry.publicUrl;
    const candidate = createProductionCandidate({ plan, resourceRefs: resources, resourceMeta, providerRecord: { name: 'AIHub 素材生产中心 + AIHub 跳舞视频工作流', model: 'route-locked', requestId: latest.get('master-portrait')?.providerRequestId || latest.get('entry-film')?.providerRequestId || null } });
    this.onReady(candidate); return candidate;
  }
}
