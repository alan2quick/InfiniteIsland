import { appendFileSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { hostname, cpus } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
export const historyDir = fileURLToPath(new URL('../test-results/', import.meta.url));
const clean = value => String(value ?? '—').replaceAll('|', '\\|').replaceAll('\n', ' ');
export function renderHistory(rows) {
  const previous = new Map();
  const lines = rows.map(r => {
    const key = JSON.stringify([r.scope, r.machine, r.runtime, r.platform, r.arch]);
    const prior = previous.get(key);
    const delta = prior && r.durationMs != null ? r.durationMs - prior.durationMs : null;
    const time = delta == null ? '⚪ First comparable run' : `${delta > 0 ? '🟠 +' : '🟢 '}${(delta/1000).toFixed(2)}s (${prior.durationMs ? (delta/prior.durationMs*100).toFixed(1) : '—'}%)`;
    const countDelta = prior ? r.tests - prior.tests : null;
    if (r.failed === 0 && r.cancelled === 0 && r.durationMs != null) previous.set(key, r);
    return `| ${[r.finishedAt, r.batch, r.commit?.slice(0,7)+(r.dirty ? '*' : ''), r.tests, countDelta == null ? '—' : `${countDelta >= 0 ? '+' : ''}${countDelta}`, r.failed, r.skipped, r.cancelled, (r.durationMs/1000).toFixed(2)+'s', time, r.runtime, r.platform+'/'+r.arch].map(clean).join(' | ')} |`;
  });
  return '# Test run history\n\nNewest first. Times are UTC. * = working-tree changes. Deltas compare the previous successful run with the same batch/file selection, machine, Node version and platform. Test counts may change; timing differences are observations, not proof of a performance regression. Background load affects results. Raw records include file lists and slow tests.\n\n| Finished (UTC) | Batch | Commit | Tests | Δ tests | Failed | Skipped | Cancelled | Test time | Δ time | Node | Platform |\n|---|---|---|---:|---:|---:|---:|---:|---:|---|---|---|\n'+lines.reverse().join('\n')+'\n';
}
export function recordRun(summary, tests, { directory = historyDir, context = {} } = {}) {
  mkdirSync(directory, { recursive:true });
  const git = args => { try { return execFileSync('git', args, {encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim(); } catch { return ''; } };
  const row = { id:randomUUID(), startedAt:context.startedAt || null, finishedAt:new Date().toISOString(),
    batch:context.batch || 'direct reporter', scope:context.scope || 'direct reporter', files:context.files || [],
    commit:context.commit || git(['rev-parse','HEAD']), dirty:context.dirty ?? !!git(['status','--porcelain']),
    machine:hostname(), cpu:cpus()[0]?.model, runtime:process.version, platform:process.platform, arch:process.arch,
    tests:summary.counts.tests, passed:summary.counts.passed, failed:summary.counts.failed,
    skipped:summary.counts.skipped || 0, cancelled:summary.counts.cancelled || 0, durationMs:summary.duration_ms,
    slowest:tests.slice(0,15) };
  appendFileSync(resolve(directory,'runs.jsonl'), JSON.stringify(row)+'\n');
  refreshHistory(directory);
  return row;
}
export function refreshHistory(directory = historyDir) {
  mkdirSync(directory,{recursive:true});
  let rows=[];
  try { rows=readFileSync(resolve(directory,'runs.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse); }
  catch(error) { if(error.code !== 'ENOENT') throw error; }
  const tmp=resolve(directory, `history-${randomUUID()}.tmp`);
  writeFileSync(tmp,renderHistory(rows)); renameSync(tmp,resolve(directory,'history.md'));
  return resolve(directory,'history.md');
}
if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(refreshHistory());
