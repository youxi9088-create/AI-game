import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('E:/AI改编游戏/空当接龙/.data/theme-freecell.sqlite', { readOnly: true });
const themes = db.prepare('SELECT package FROM themes ORDER BY created_at DESC').all();
const jobs = db.prepare('SELECT id, prompt, status, created_at FROM theme_jobs ORDER BY created_at DESC LIMIT 20').all();
const out = [`themes count: ${themes.length}`];
for (const t of themes) {
  const p = JSON.parse(t.package);
  out.push(`- ${p.themeId} | "${p.title}" | source=${p.source} | provider=${p.generation?.provider || p.assets?.items?.[0]?.provider || '?'} | rev=${p.revision}`);
}
out.push(`jobs (latest ${jobs.length}):`);
for (const j of jobs) out.push(`- ${j.status} | "${j.prompt}" | ${j.created_at}`);
console.log(out.join('\n'));
