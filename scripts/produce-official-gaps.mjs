/* 官方牌友缺口排产（2026-09-19）：米娅 A02–A05 五态视频（seedance）+ 银岚牌桌透明立绘（jimeng）。
   复用 PalResourcePipeline 的全部合同（提示词、alpha 校验、落盘校验、重试），
   但写入独立的 gapfill 状态文件，不污染工坊任务流。参考图为已上传 CS 的官方资料卡。 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PalResourcePipeline } from '../apps/api/pal-resource-pipeline.mjs';
import { LINXING_STYLE_LOCK, PAL_IDENTITY_SEPARATION_LOCK } from '../packages/pal-generation-core/index.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
for (const line of (await readFile(join(root, '.env.production.local'), 'utf8')).split(/\r?\n/)) {
  const m = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const MIA_CS = 'https://gcdncs.cn.ndhy.com/v0.1/download?attachment=true&dentryId=42d337fe-c827-477b-a7fc-52ecd61f2fb4';
const YINLAN_CS = 'https://gcdncs.cn.ndhy.com/v0.1/download?attachment=true&dentryId=7e389c07-4030-4176-ab4a-cb1e05bfe2b0';

const ACTIONS = { idle: '待机呼吸与自然眨眼', play: '向牌桌出牌', pass: '克制地示意过牌', win: '克制胜利庆祝', lose: '失利后保持从容' };
function makePlan({ planId, name, sourceText, clothingLabel, clothingPrompt, resources }) {
  return {
    planId,
    identity: { suffix: 9000, version: 1, name },
    intent: { sourceText, style: '舞台轻奢', clothingLabel, accessoryLabel: '无' },
    profileCard: {
      character: { name }, clothing: { label: clothingLabel, prompt: clothingPrompt },
      accessory: { label: '无', prompt: 'no headwear or novelty accessory' }, actions: ACTIONS
    },
    styleLock: LINXING_STYLE_LOCK,
    productionRoutes: [],
    resources: resources.map((id) => ({
      id, group: '角色表现', label: id, kind: id === 'table-standee' ? 'image' : 'video',
      requiredForSeat: false, production: id === 'table-standee' ? 'aihub:jimeng' : 'aihub:seedance', acceptance: ''
    }))
  };
}

const miaPlan = makePlan({
  planId: 'official-mia-gapfill',
  name: '米娅',
  sourceText: '米娅：官方牌友，成年虚构职业舞台女性，棕色短发，薄荷绿短夹克配白色百褶短裙与运动鞋，气质明快',
  clothingLabel: '薄荷运动装',
  clothingPrompt: 'a mint-green cropped stage jacket with a white pleated mini skirt and matching sneakers',
  resources: ['action-a02', 'action-a03', 'action-a04', 'action-a05']
});
const yinlanPlan = makePlan({
  planId: 'official-yinlan-gapfill',
  name: '银岚',
  sourceText: '银岚：官方牌友，成年虚构运动系女性，及腰纯银白色长发（全头银白，绝无黑色、深灰或棕色发丝）、蓝色眼睛、X 形发夹，蓝白运动夹克配深色短裤与白色运动鞋',
  clothingLabel: '蓝白运动装',
  clothingPrompt: 'a navy-and-white sporty track jacket over a dark top, dark shorts and white sneakers; her waist-length hair is uniformly pure silver-white, never black or dark',
  resources: ['table-standee']
});

const pipeline = new PalResourcePipeline({
  assetDir: join(root, 'apps/web/assets/pals/ugc'),
  statePath: join(root, 'apps/api/data/gapfill-resource-tasks.json'),
  env: process.env
});
await pipeline.ready;

const now = () => new Date().toISOString();
for (const [plan, csUrl] of [[miaPlan, MIA_CS], [yinlanPlan, YINLAN_CS]]) {
  const master = {
    taskId: `${plan.planId}-master`, planId: plan.planId, resourceId: 'master-portrait', label: '角色资料卡（官方上传）', kind: 'image',
    planSnapshot: plan, route: 'official-upload', provider: 'official-upload', status: 'SUCCEEDED',
    attempt: 1, createdAt: now(), updatedAt: now(), runId: null, providerRequestId: null,
    publicUrl: plan.planId === 'official-mia-gapfill' ? '/assets/pals/mia-v1.png' : '/assets/pals/yinlan-v1.png',
    sourceUrl: csUrl, sha256: plan.planId, bytes: null, width: null, height: null, error: null, retryLocked: false
  };
  pipeline.tasks.set(master.taskId, master);
  pipeline.portraitApprovals.set(plan.planId, { planId: plan.planId, taskId: master.taskId, sha256: plan.planId, confirmedAt: now() });
}
await pipeline.persist();

console.log('submitting mia videos (seedance ×4)…');
console.log(JSON.stringify(await pipeline.submit({ plan: miaPlan, resourceIds: miaPlan.resources.map((r) => r.id) }), null, 1).slice(0, 400));
console.log('submitting yinlan table standee (jimeng)…');
console.log(JSON.stringify(await pipeline.submit({ plan: yinlanPlan, resourceIds: ['table-standee'] }), null, 1).slice(0, 400));

const wanted = [...miaPlan.resources.map((r) => r.id), 'table-standee'];
const deadline = Date.now() + 20 * 60 * 1000;
let done = false;
while (Date.now() < deadline && !done) {
  await pipeline.refresh();
  const latest = new Map();
  for (const task of pipeline.tasks.values()) {
    if (task.planId !== miaPlan.planId && task.planId !== yinlanPlan.planId) continue;
    const cur = latest.get(task.resourceId);
    if (!cur || cur.updatedAt < task.updatedAt) latest.set(task.resourceId, task);
  }
  const line = wanted.map((id) => `${id}:${latest.get(id)?.status || '-'}`).join(' ');
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${line}`);
  done = wanted.every((id) => ['SUCCEEDED', 'FAILED', 'BLOCKED_REFERENCE'].includes(latest.get(id)?.status));
  if (!done) await new Promise((r) => setTimeout(r, 10_000));
}
console.log('FINAL:');
for (const task of pipeline.tasks.values()) {
  if (task.resourceId === 'master-portrait') continue;
  if (!wanted.includes(task.resourceId)) continue;
  console.log(`${task.resourceId} ${task.status} ${task.publicUrl || ''} ${task.error || ''}`);
}
