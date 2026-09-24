/* 从资产注册表渲染 docs/ASSET_MAP.md 的生成区（映射总表、UGC 资源账、缺口清单）。
   表格不再手写：数据唯一来源是 official-assets.json + 管线任务（与 /api/assets/registry 同一聚合）。
   用法：
     node scripts/render-asset-map.mjs          重新生成并写入文档
     node scripts/render-asset-map.mjs --check  只校验文档是否最新（verify 用），不写入 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AssetRegistry } from '../apps/api/asset-registry.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const webRoot = join(root, 'apps/web');
const dataDir = join(root, 'apps/api/data');
const docPath = join(root, 'docs/ASSET_MAP.md');
const checkOnly = process.argv.includes('--check');
const START = '<!-- ASSET-MAP:GENERATED:START -->';
const END = '<!-- ASSET-MAP:GENERATED:END -->';

const tasksData = JSON.parse(await readFile(join(dataDir, 'pal-resource-tasks.json'), 'utf8'));
const pipeline = { tasks: new Map((tasksData.tasks || []).map((task) => [task.taskId, task])) };
const registry = new AssetRegistry({ webRoot, projectRoot: root, officialPath: join(dataDir, 'official-assets.json'), pipeline });
const data = await registry.build();
const confirmed = JSON.parse(await readFile(join(dataDir, 'confirmed-pals.json'), 'utf8'));

const NAMES = { 'pal-linxing': '林星', 'pal-mia': '米娅', 'pal-yinlan': '银岚' };
for (const pal of confirmed.pals || []) NAMES[pal.palId] = pal.identity?.name || pal.palId;
const OFFICIAL_ORDER = ['pal-linxing', 'pal-mia', 'pal-yinlan'];
const UGC_ORDER = (confirmed.pals || []).map((pal) => pal.palId);
const PAL_ORDER = [...OFFICIAL_ORDER, ...UGC_ORDER];

const isActionSlot = (slot) => /^action-a0[1-5]$/.test(slot || '');
const actionKeyOf = (slot) => (isActionSlot(slot) ? slot.slice(-3).toUpperCase() : null);

/* 映射总表的行：与用户确立的映射一一对应；现状由注册表条目与缺口机械汇总。 */
const DOC_ROWS = [
  { title: '角色资料卡', slots: ['master-portrait'], req: '工坊预览、用户确认、后续生产参考；保留完整资料，不直接用于主页或牌桌' },
  { title: '独立头像', slots: ['avatar'], req: '首页选座、角色列表；单人头肩像，单独文件' },
  { title: '大厅立绘', slots: ['lounge-standee'], req: '主页左右角色展示；单人半身、透明背景' },
  { title: '牌桌立绘', slots: ['table-standee'], req: '牌桌角色默认形象；单人半身、透明背景，统一位置与尺寸' },
  { title: '五态源拼图', slots: ['action-sheet'], req: '仅作源文件；运行时加载拆出的单张，不显示整张拼图' },
  { title: '五态动作图', match: (e) => isActionSlot(e.slot) && e.kind === 'image', gapMatch: (g) => isActionSlot(g.slot) && g.kind === 'image', req: '牌桌待机/出牌/不出/胜利/失败；拆成五张独立图片，分别绑定事件' },
  { title: '五态动作视频', match: (e) => isActionSlot(e.slot) && e.kind === 'video', gapMatch: (g) => isActionSlot(g.slot) && (!g.kind || g.kind === 'video'), req: '对应五种牌桌事件；一种状态对应一个视频，静态图作为回退' },
  { title: '入场视频', slots: ['entry-film'], req: '角色进入牌局时；播完回到牌桌立绘' },
  { title: '服装写真卡面', slots: ['first-outfit'], req: '解锁卡牌、写真馆、PNG 导出；单人完整卡面，按服装编号绑定' },
  { title: '跳舞／换装视频', slots: ['outfit-film'], req: '结算演出、对应卡牌回放；与同一服装卡面一一对应' },
  { title: '视频封面', slots: ['entry-poster', 'outfit-poster'], req: '播放前、加载或播放失败时；从对应视频取帧' },
  { title: '服装特效层', slots: ['outfit-fx'], req: '指定服装演出叠加；只含特效，不能拿人物图替代' }
];

const SEVERITY = { REJECTED_MANUAL: 5, REJECTED_COMPOSITION: 5, MISSING: 4, AWAITING_REVIEW: 3, LEGACY_UNREVIEWED: 2, APPROVED: 1 };
const STATUS_LABEL = {
  APPROVED: '✅',
  LEGACY_UNREVIEWED: '⚠️存量未逐项验收',
  AWAITING_REVIEW: '⚠️待验收',
  MISSING: '缺',
  REJECTED_MANUAL: '手工图不通过',
  REJECTED_COMPOSITION: '误产总图',
  LEGACY_SINGLE_PORTRAIT: '单人版历史卡',
  SPLIT_PENDING: '五态待拆分',
  FAILED: '生产失败',
  BLOCKED_REFERENCE: '参考缺失阻塞'
};

function rowEntries(row, palId) {
  const matcher = row.match || ((entry) => row.slots.includes(entry.slot));
  return data.assets.filter((entry) => entry.palId === palId && matcher(entry) && entry.acceptance?.status !== 'SOURCE_ONLY');
}
function rowGaps(row, palId) {
  const matcher = row.gapMatch || ((gap) => (row.slots || []).includes(gap.slot));
  return data.gaps.filter((gap) => gap.palId === palId && matcher(gap));
}
function gapLabel(gaps) {
  const actionKeys = [...new Set(gaps.map((gap) => actionKeyOf(gap.slot)).filter(Boolean))].sort();
  if (actionKeys.length) {
    const kinds = [...new Set(gaps.map((gap) => gap.kind).filter(Boolean))];
    const kind = kinds.includes('video') ? '视频' : '图';
    const range = actionKeys.length > 1 && actionKeys.every((key, i) => !i || Number(key[2]) === Number(actionKeys[i - 1][2]) + 1)
      ? `${actionKeys[0]}–${actionKeys[actionKeys.length - 1]}`
      : actionKeys.join('、');
    return `缺${range}${kind}`;
  }
  return [...new Set(gaps.map((gap) => STATUS_LABEL[gap.status] || gap.status))].join('；');
}
/* 单元格语义：实际在用的最佳验收状态为主；不通过的手工/误产变体以「＋⛔N项不通过」附注，
   既不掩盖问题，也不让拒收变体冒充该槽位的现状。 */
function cellFor(row, palId) {
  const entries = rowEntries(row, palId);
  const rejectedCount = entries.filter((entry) => entry.acceptance?.status?.startsWith('REJECTED')).length;
  const suffix = rejectedCount ? `＋⛔${rejectedCount}项不通过` : '';
  const gaps = rowGaps(row, palId);
  if (gaps.length) return `⚠️${gapLabel(gaps)}${suffix}`;
  const actionable = entries.filter((entry) => SEVERITY[entry.acceptance?.status]);
  if (!actionable.length) return '—';
  const best = actionable.map((entry) => entry.acceptance.status).sort((a, b) => SEVERITY[a] - SEVERITY[b])[0];
  return `${STATUS_LABEL[best] || best}${suffix}`;
}

function renderSummaryTable() {
  const lines = [
    '| 生产资源 | 用途与处理要求 | ' + PAL_ORDER.map((palId) => NAMES[palId] || palId).join(' | ') + ' |',
    '| --- | --- | ' + PAL_ORDER.map(() => '---').join(' | ') + ' |'
  ];
  for (const row of DOC_ROWS) {
    const cells = PAL_ORDER.map((palId) => cellFor(row, palId));
    lines.push(`| ${row.title} | ${row.req} | ${cells.join(' | ')} |`);
  }
  return ['## 映射总表（生成）', '', ...lines].join('\n');
}

const UGC_ROWS = DOC_ROWS.filter((row) => !['视频封面'].includes(row.title));
function renderUgcTable() {
  const lines = [
    '| 槽位 | ' + UGC_ORDER.map((palId) => `${NAMES[palId]}（${palId}）`).join(' | ') + ' |',
    '| --- | ' + UGC_ORDER.map(() => '---').join(' | ') + ' |'
  ];
  for (const row of UGC_ROWS) {
    lines.push(`| ${row.title} | ${UGC_ORDER.map((palId) => cellFor(row, palId)).join(' | ')} |`);
  }
  return [
    '## 自定义牌友（UGC）资源账（生成）',
    '',
    '管线产物均有任务记录与 sha256；上一轮手工改到未登记变体的运行时引用已于 2026-09-18 回正（`scripts/reconcile-confirmed-pals.mjs`，幂等可重跑）。',
    '',
    ...lines
  ].join('\n');
}

function renderGapsTable() {
  const lines = ['| 角色 | 槽位 | 类型 | 状态 | 说明 |', '| --- | --- | --- | --- | --- |'];
  const gaps = [...data.gaps].sort((a, b) => (PAL_ORDER.indexOf(a.palId) - PAL_ORDER.indexOf(b.palId)) || String(a.slot).localeCompare(String(b.slot)));
  for (const gap of gaps) {
    lines.push(`| ${NAMES[gap.palId] || gap.palId || '—'} | ${gap.slot || '—'} | ${gap.kind || '—'} | ${gap.status} | ${(gap.note || '').replaceAll('|', '｜')} |`);
  }
  return ['## 当前缺口清单（生成）', '', ...lines].join('\n');
}

function render() {
  const byStatus = Object.entries(data.summary.byStatus).map(([status, count]) => `${status} ${count}`).join(' · ');
  return [
    renderSummaryTable(),
    '',
    renderUgcTable(),
    '',
    renderGapsTable(),
    '',
    `> 资产共 ${data.summary.total} 份：${byStatus}。实时数据：\`GET /api/assets/registry\`；本区由 \`npm run assets:map\` 生成，请勿手改。`
  ].join('\n');
}

const doc = await readFile(docPath, 'utf8');
const start = doc.indexOf(START);
const end = doc.indexOf(END);
if (start < 0 || end < 0 || end < start) throw new Error('docs/ASSET_MAP.md 缺少生成区标记。');
const next = `${doc.slice(0, start + START.length)}\n${render()}\n${doc.slice(end)}`;
if (checkOnly) {
  if (next !== doc) {
    console.error('docs/ASSET_MAP.md 的生成区已过期：请运行 npm run assets:map 重新生成。');
    process.exit(1);
  }
  console.log('asset map is up to date.');
} else {
  await writeFile(docPath, next, 'utf8');
  console.log('docs/ASSET_MAP.md generated region updated.');
}
