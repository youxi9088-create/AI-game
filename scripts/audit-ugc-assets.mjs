import { access, readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const webRoot = join(repo, 'apps/web');
const ugcRoot = join(webRoot, 'assets/pals/ugc');
const dataRoot = join(repo, 'apps/api/data');
const problems = [];

async function exists(path) { try { await access(path); return true; } catch { return false; } }
function diskPath(ref) { return join(webRoot, ...decodeURIComponent(ref).split('/').filter(Boolean)); }
function collectRefs(value, refs = []) {
  if (typeof value === 'string') {
    if (value.startsWith('/assets/pals/ugc/')) refs.push(value);
    return refs;
  }
  if (Array.isArray(value)) for (const item of value) collectRefs(item, refs);
  else if (value && typeof value === 'object') for (const item of Object.values(value)) collectRefs(item, refs);
  return refs;
}

const topEntries = await readdir(ugcRoot, { withFileTypes: true });
for (const entry of topEntries) if (entry.isFile()) problems.push(`UGC 根目录不允许散落文件：${entry.name}`);
for (const entry of topEntries) {
  if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
  const nested = (await readdir(join(ugcRoot, entry.name), { withFileTypes: true })).filter((item) => item.isDirectory());
  for (const item of nested) problems.push(`角色目录不允许嵌套归属目录：${entry.name}/${item.name}`);
}

const jsonNames = (await readdir(dataRoot)).filter((name) => name.endsWith('.json'));
for (const name of jsonNames) {
  const value = JSON.parse(await readFile(join(dataRoot, name), 'utf8'));
  for (const ref of new Set(collectRefs(value))) if (!(await exists(diskPath(ref)))) problems.push(`${name} 引用不存在：${ref}`);
}

const confirmed = JSON.parse(await readFile(join(dataRoot, 'confirmed-pals.json'), 'utf8'));
for (const pal of confirmed.pals || []) {
  const folder = String(pal?.identity?.name || '');
  for (const ref of collectRefs(pal)) {
    const relativeRef = decodeURIComponent(ref).slice('/assets/pals/ugc/'.length);
    if (!relativeRef.startsWith(`${folder}/`)) problems.push(`${pal.palId} 的资源未归入角色目录「${folder}」：${ref}`);
  }
}

const dainaDir = join(ugcRoot, '代娜');
if (await exists(dainaDir)) {
  for (const name of await readdir(dainaDir)) if (/f479d45a-0a48-415f-94cf-740b35bef45b/i.test(name)) problems.push(`代娜目录仍含旧计划编号：${name}`);
}

const inventory = [];
for (const entry of topEntries.filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))) {
  const dir = join(ugcRoot, entry.name);
  const stack = [dir];
  let files = 0;
  let bytes = 0;
  while (stack.length) {
    const current = stack.pop();
    for (const item of await readdir(current, { withFileTypes: true })) {
      const path = join(current, item.name);
      if (item.isDirectory()) stack.push(path);
      else if (item.isFile()) { files += 1; bytes += (await stat(path)).size; }
    }
  }
  inventory.push({ folder: entry.name, files, bytes });
}

if (problems.length) {
  console.error(JSON.stringify({ status: 'failed', problems, inventory }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ status: 'passed', rootFiles: 0, missingReferences: 0, roleFolderMismatches: 0, inventory }, null, 2));
}
