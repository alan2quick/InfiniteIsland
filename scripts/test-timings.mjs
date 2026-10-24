// Run the same full suite as npm test, or selected files, with actionable timings.
import { spawn, execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
let report;
const index = args.indexOf('--json');
if (index >= 0) {
  report = args[index + 1];
  if (!report || report.startsWith('--')) throw new Error('--json requires an output file path');
  args.splice(index, 2);
}
const files = args.length ? args : readdirSync(new URL('../test/', import.meta.url))
  .filter(name => name.endsWith('.test.js')).sort().map(name => `test/${name}`);
const git = args => { try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore','pipe','ignore'] }).trim(); } catch { return ''; } };
const context = { startedAt: new Date().toISOString(), batch: process.env.TEST_BATCH_LABEL || (args.length ? 'selected files' : 'all'), scope: process.env.TEST_BATCH_LABEL || (args.length ? [...files].sort().join(',') : 'all'), files, commit: git(['rev-parse','HEAD']), dirty: !!git(['status','--porcelain']) };
const child = spawn(process.execPath, ['--test', '--test-reporter=./scripts/test-timing-reporter.mjs', ...files], {
  cwd: root, stdio: 'inherit', env: { ...process.env, TEST_RUN_CONTEXT: JSON.stringify(context), ...(report ? { TEST_TIMING_REPORT: report } : {}) },
});
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
