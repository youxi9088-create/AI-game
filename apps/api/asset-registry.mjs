import { open, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { RESOURCE_SLOTS } from '../web/asset-slots.js';

/* 资产注册表：把「资料卡 → 独立资源 → 页面位置」落成机器可读账目。
   每条资产记录六字段——角色 palId、服装 outfitId、用途 slot、动作 action、来源 source、
   验收状态 acceptance。来源聚合三路：官方登记数据（official-assets.json）、UGC 生产管线
   任务（PalResourcePipeline）、仅源素材包（SOURCE_ONLY，不进入运行时）。
   页面按用途取资源；缺项在这里是显式记录（gaps），不是静默破图。 */

export const ACCEPTANCE_STATUSES = Object.freeze([
  'APPROVED',
  'AWAITING_REVIEW',
  'LEGACY_UNREVIEWED',
  'REJECTED_MANUAL',
  'REJECTED_COMPOSITION',
  'MISSING',
  'MISSING_FILE',
  'SOURCE_ONLY'
]);

const TASK_ACCEPTANCE = Object.freeze({
  APPROVED: 'APPROVED',
  AWAITING_REVIEW: 'AWAITING_REVIEW',
  REJECTED: 'REJECTED_MANUAL'
});

async function fileExists(path) {
  try {
    const info = await stat(path);
    return info.isFile();
  } catch {
    return false;
  }
}

/* 资料卡是「多素材参考总图」（生产合同尺寸 ≥1920 宽）还是上一轮的「单人版」（1024×1536），
   以落盘 PNG 的实际宽度判定；任务记录里的 promptRevision 经过重试链路已不能反映版面。 */
async function pngWidth(path) {
  let handle;
  try {
    handle = await open(path, 'r');
    const header = Buffer.alloc(24);
    await handle.read(header, 0, 24, 0);
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    if (!header.subarray(0, 8).equals(signature)) return null;
    return header.readUInt32BE(16);
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
}

function palIdFromPlan(planSnapshot) {
  const identity = planSnapshot?.identity || {};
  if (identity.suffix === undefined || identity.version === undefined) return null;
  return `pal-user-${identity.suffix}-v${identity.version}`;
}

function latestTasksByResource(tasks) {
  const latest = new Map();
  for (const task of tasks) {
    if (!task?.planId || !task?.resourceId || task?.planDeleted) continue;
    const key = `${task.planId}:${task.resourceId}`;
    const current = latest.get(key);
    if (!current || current.updatedAt < task.updatedAt) latest.set(key, task);
  }
  return latest;
}

export class AssetRegistry {
  constructor({ webRoot, projectRoot, officialPath, pipeline }) {
    if (!webRoot || !projectRoot || !officialPath) throw new Error('AssetRegistry requires webRoot, projectRoot and officialPath.');
    this.webRoot = webRoot;
    this.projectRoot = projectRoot;
    this.officialPath = officialPath;
    this.pipeline = pipeline || null;
  }

  async loadOfficial() {
    const parsed = JSON.parse(await readFile(this.officialPath, 'utf8'));
    const sourcePackages = Array.isArray(parsed?.sourcePackages) ? parsed.sourcePackages : [];
    /* Ownership-correction imports may arrive as a compact package manifest.
       Entries that already carry the complete runtime-asset contract belong
       in the same verified registry as ordinary assets; the remaining rows
       stay source-only.  This keeps manually organized UGC traceable without
       inventing synthetic pipeline tasks. */
    const packagedAssets = sourcePackages.filter((entry) => entry?.publicUrl && entry?.file && entry?.acceptance?.status);
    return {
      assets: [...(Array.isArray(parsed?.assets) ? parsed.assets : []), ...packagedAssets],
      expectations: Array.isArray(parsed?.expectations) ? parsed.expectations : [],
      sourcePackages: sourcePackages.filter((entry) => !packagedAssets.includes(entry)),
      taskOverrides: Array.isArray(parsed?.taskOverrides) ? parsed.taskOverrides : []
    };
  }

  async verifyOfficialAssets(entries) {
    const verified = [];
    for (const entry of entries) {
      if (!entry.file) { verified.push(entry); continue; }
      const base = entry.base === 'project' ? this.projectRoot : this.webRoot;
      const exists = await fileExists(join(base, entry.file));
      if (exists) { verified.push(entry); continue; }
      verified.push({
        ...entry,
        acceptance: {
          ...(entry.acceptance || {}),
          status: 'MISSING_FILE',
          note: `登记文件不存在：${entry.file}。原状态 ${entry.acceptance?.status || '未登记'}；${entry.acceptance?.note || ''}`.trim()
        }
      });
    }
    return verified;
  }

  /* UGC 任务派生条目。验收状态如实映射：走过 confirmResource 的才是 APPROVED；
     存量任务没有 reviewStatus，标 LEGACY_UNREVIEWED，不假装已验收。
     taskOverrides 记录人工复核结论（如「管线误产总图」），按 planId+resourceId 覆盖。 */
  derivePipelineAssets(tasks, overrides = []) {
    const overrideFor = (task) => overrides.find((item) => item.planId === task.planId && item.resourceId === task.resourceId) || null;
    const assets = [];
    const gaps = [];
    const latest = latestTasksByResource(tasks);
    for (const task of latest.values()) {
      const palId = palIdFromPlan(task.planSnapshot);
      const label = task.label || task.resourceId;
      const planName = task.planSnapshot?.identity?.name || task.planId?.slice(0, 8);
      if (task.status !== 'SUCCEEDED') {
        if (!['QUEUED', 'WAITING_REFERENCE', 'RETRY_WAITING', 'RUNNING', 'SUBMITTING', 'WAITING_PORTRAIT_CONFIRMATION'].includes(task.status)) {
          gaps.push({
            palId,
            planId: task.planId,
            slot: task.resourceId,
            kind: task.kind,
            status: task.status,
            note: `UGC 计划「${planName}」资源「${label}」未完成（${task.status}）：${task.error || '无错误信息'}`,
            taskId: task.taskId
          });
        }
        continue;
      }
      const override = overrideFor(task);
      const acceptance = override?.acceptance?.status || TASK_ACCEPTANCE[task.reviewStatus] || 'LEGACY_UNREVIEWED';
      assets.push({
        id: `ugc-${task.planId}-${task.resourceId}`,
        palId,
        planId: task.planId,
        outfitId: null,
        slot: task.resourceId,
        action: /^action-a0[1-5]$/.test(task.resourceId) ? { 'action-a01': 'idle', 'action-a02': 'play', 'action-a03': 'pass', 'action-a04': 'win', 'action-a05': 'lose' }[task.resourceId] : null,
        kind: task.kind,
        publicUrl: task.publicUrl || null,
        file: task.publicUrl ? task.publicUrl.replace(/^\//, '') : null,
        source: { kind: 'pipeline-task', taskId: task.taskId, route: task.route || null, model: task.model || null, promptRevision: task.promptRevision || null },
        acceptance: {
          status: acceptance,
          note: override?.acceptance?.note || (acceptance === 'LEGACY_UNREVIEWED' ? '存量任务，验收功能上线前产物，未逐项验收。' : acceptance === 'REJECTED_MANUAL' && task.reviewStatus === 'REJECTED' ? `用户打回${task.reviewNote ? `：${task.reviewNote}` : '（未填原因）'}。` : '管线验收通过。'),
          reviewedAt: override?.acceptance?.reviewedAt || task.reviewedAt || null
        }
      });
      if (task.resourceId === 'action-sheet' && !task.derivedImages) {
        gaps.push({ palId, planId: task.planId, slot: 'action-sheet', kind: 'image', status: 'SPLIT_PENDING', note: '五态源图尚未拆分；运行时不得直接显示整张拼图。', taskId: task.taskId });
      }
      for (const [key, entry] of Object.entries(task.derivedImages || {})) {
        assets.push({
          id: `ugc-${task.planId}-action-image-${key}`,
          palId,
          planId: task.planId,
          outfitId: null,
          slot: `action-${key.toLowerCase()}`,
          action: { A01: 'idle', A02: 'play', A03: 'pass', A04: 'win', A05: 'lose' }[key] || null,
          kind: 'image',
          publicUrl: entry.publicUrl || null,
          file: entry.publicUrl ? entry.publicUrl.replace(/^\//, '') : null,
          source: { kind: 'script-split', taskId: task.taskId, derivedFrom: task.publicUrl || null, sourceRect: entry.sourceRect || null },
          acceptance: { status: TASK_ACCEPTANCE[entry.reviewStatus] || 'AWAITING_REVIEW', note: '五态源图按 3×2 固定网格拆出的单张动作图。', reviewedAt: entry.reviewedAt || null }
        });
      }
    }
    return { assets, gaps };
  }

  /* 存量「单人版」资料卡：只登记为历史版本，不触发连锁重生产（2026-09-18 决策）。 */
  async deriveLegacyPortraitGaps(assets) {
    const gaps = [];
    for (const entry of assets) {
      if (entry.slot !== 'master-portrait' || entry.source?.kind !== 'pipeline-task' || !entry.file) continue;
      const width = await pngWidth(join(this.webRoot, entry.file));
      if (width && width <= 1280) {
        gaps.push({ palId: entry.palId, planId: entry.planId, slot: 'master-portrait', kind: 'image', status: 'LEGACY_SINGLE_PORTRAIT', note: `资料卡为「单人版」历史产物（实际 ${width}px 宽，参考总图合同 ≥1920px）；按 2026-09-18 决策仅登记为历史版本，不触发重生产。`, taskId: entry.source.taskId });
      }
    }
    return gaps;
  }

  /* 缺口推导：expectations 里声明的「应有项」找不到有效资产（排除 REJECTED 与回退物）即为 MISSING。 */
  deriveExpectationGaps(expectations, assets) {
    const satisfied = new Set(
      assets
        .filter((entry) => ['APPROVED', 'AWAITING_REVIEW', 'LEGACY_UNREVIEWED'].includes(entry.acceptance?.status) && entry.role !== 'fallback')
        .map((entry) => `${entry.palId}:${entry.slot}:${entry.kind}`)
    );
    return expectations
      .filter((expectation) => !satisfied.has(`${expectation.palId}:${expectation.slot}:${expectation.kind}`))
      .map((expectation) => ({ ...expectation, status: 'MISSING' }));
  }

  async summary() {
    const { generatedAt, summary, gaps } = await this.build();
    return { generatedAt, summary, gaps };
  }

  async build() {
    const official = await this.loadOfficial();
    const officialAssets = await this.verifyOfficialAssets(official.assets);
    const pipelineTasks = this.pipeline ? [...this.pipeline.tasks.values()] : [];
    const derived = this.derivePipelineAssets(pipelineTasks, official.taskOverrides);
    const assets = [...officialAssets, ...derived.assets];
    const gaps = [
      ...this.deriveExpectationGaps(official.expectations, assets),
      ...derived.gaps,
      ...await this.deriveLegacyPortraitGaps(derived.assets)
    ];
    const summary = {};
    for (const entry of assets) {
      const status = entry.acceptance?.status || 'UNTRACKED';
      summary[status] = (summary[status] || 0) + 1;
    }
    return {
      generatedAt: new Date().toISOString(),
      slots: RESOURCE_SLOTS,
      acceptanceStatuses: ACCEPTANCE_STATUSES,
      assets,
      sourcePackages: official.sourcePackages,
      gaps,
      summary: { total: assets.length, byStatus: summary, gapCount: gaps.length }
    };
  }
}
