#!/usr/bin/env node
// Workflow numbers from git history: how big steps are, how much of each commit is bookkeeping, how much is rework.
//
//   node tools/step-stats.mjs            per-week table for the whole history
//   node tools/step-stats.mjs --steps    one line per "Step N" commit (the 25 most recent)
//   node tools/step-stats.mjs --since=2026-10-13
//
// Why: "is the workflow getting better?" needs a number that does not depend on memory or on a model's opinion.
// These come from `git log` only, so they cost nothing to collect and can be compared before / after a change in
// how you work. Token use is not in git: record it per step from `/usage` or `npx ccusage session` (see
// docs/workflow/BENCHMARK.md).
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}`))?.split('=')[1];
const since = arg('since');
const raw = execFileSync('git', ['log', '--no-merges', '--numstat', '--date=iso-strict', '--format=%x01%h%x02%ad%x02%s%x02%b%x03', ...(since ? [`--since=${since}`] : [])], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });

// The files every step has to touch that are not the feature itself.
const BOOKKEEPING = /^(PLAN\.md|README\.md|CLAUDE\.md|AGENTS\.md|CHANGELOG\.md|HANDOFF\.md|plan\/|docs\/|package\.json|package-lock\.json)/;
const commits = raw.split('\x01').filter(Boolean).map((chunk) => {
  const [head, rest = ''] = chunk.split('\x03');
  const [hash, date, subject, body = ''] = head.split('\x02');
  const c = { hash, date: new Date(date), subject, code: 0, test: 0, book: 0, files: 0, bookFiles: 0 };
  for (const line of rest.split('\n')) {
    const m = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/); if (!m) continue;
    const n = (+m[1] || 0) + (+m[2] || 0); c.files++;
    if (BOOKKEEPING.test(m[3])) { c.book += n; c.bookFiles++; } else if (m[3].startsWith('test/')) c.test += n; else c.code += n;
  }
  c.total = c.code + c.test + c.book;
  c.model = /Co-Authored-By: Claude (\w+)/i.exec(body)?.[1] ?? 'other';
  c.kind = /^plan\b/i.test(subject) ? 'plan' : /\b(fix|fixes|playtest|tweak|tweaks|polish)\b/i.test(subject) ? 'rework' : 'feature';
  c.step = /\bSteps? (\d+[a-z]?)/i.exec(subject)?.[1] ?? null;
  return c;
});
const median = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0);
const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
const pad = (v, n) => String(v).padStart(n);

if (process.argv.includes('--steps')) {
  console.log('hash     date        step   lines  files  code  test  bookkeeping  model   subject');
  for (const c of commits.filter((x) => x.step).slice(0, 25)) console.log(`${c.hash}  ${c.date.toISOString().slice(0, 10)}  ${c.step.padEnd(5)} ${pad(c.total, 6)} ${pad(c.files, 6)} ${pad(c.code, 5)} ${pad(c.test, 5)} ${pad(c.book, 6)} (${pad(pct(c.book, c.total), 2)}%)  ${c.model.padEnd(6)}  ${c.subject.slice(0, 60)}`);
  process.exit(0);
}
const weekOf = (d) => { const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); return t.toISOString().slice(0, 10); };
const weeks = new Map();
for (const c of commits) { const k = weekOf(c.date); if (!weeks.has(k)) weeks.set(k, []); weeks.get(k).push(c); }
console.log('week of     commits  lines/commit  files/commit  bookkeeping files/commit  rework commits  by model');
for (const [k, list] of [...weeks].sort()) {
  const models = {}; for (const c of list) models[c.model] = (models[c.model] || 0) + 1;
  console.log(`${k}  ${pad(list.length, 7)}  ${pad(median(list.map((c) => c.total)), 12)}  ${pad(median(list.map((c) => c.files)), 12)}  ${pad(median(list.map((c) => c.bookFiles)), 24)}  ${pad(pct(list.filter((c) => c.kind === 'rework').length, list.length), 13)}%  ${Object.entries(models).map(([m, n]) => `${m} ${n}`).join(', ')}`);
}
const all = commits;
console.log(`total: ${all.length} commits · median ${median(all.map((c) => c.total))} changed lines and ${median(all.map((c) => c.files))} files per commit · ${pct(all.reduce((s, c) => s + c.book, 0), all.reduce((s, c) => s + c.total, 0))}% of changed lines are bookkeeping (plans, docs, versions) · ${pct(all.reduce((s, c) => s + c.test, 0), all.reduce((s, c) => s + c.total, 0))}% tests`);
