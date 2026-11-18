#!/usr/bin/env node
// Quiet test runner: the same tests as `node --test test/*.test.js`, but it prints only failures and a one-line total.
//
//   node tools/test.mjs                 full suite
//   node tools/test.mjs --changed       only test files that import (directly or indirectly) a file you changed since HEAD
//   node tools/test.mjs --changed=main  ...since another ref (committed + uncommitted changes)
//   node tools/test.mjs boat fishing    test files whose name contains "boat" or "fishing"
//   node tools/test.mjs --slow          also list the 10 slowest files
//   node tools/test.mjs --repeat=5 x    run the selection 5 times and report files that pass only sometimes (flaky)
//   node tools/test.mjs --list ...      print the selected files and exit
//
// Why: the stock reporter prints one line per test (1,670 lines, ~480 KB). An agent that runs it pays for every
// line, and the failures sit somewhere in the middle. This prints ~1 line when green and ~4 lines per failure.
// Each test file still runs in its own process (the same isolation as `node --test`), so results are identical.
// No dependencies; works the same on Windows, macOS and Linux.
import { spawn, execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

if (+process.versions.node.split('.')[0] < 20) { console.log(`tools/test.mjs needs Node 20 or newer (this is ${process.version})`); process.exit(2); }
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const posix = (p) => p.split(sep).join('/');
const argv = process.argv.slice(2);
const flag = (name) => { const a = argv.find((x) => x === `--${name}` || x.startsWith(`--${name}=`)); return a === undefined ? null : a.includes('=') ? a.slice(a.indexOf('=') + 1) : true; };
const filters = argv.filter((a) => !a.startsWith('--')).map((a) => a.replace(/\\/g, '/'));   // accept Windows paths such as test\\boat.test.js
const jobs = Math.max(1, +flag('jobs') || (os.availableParallelism?.() ?? os.cpus().length) - 1);
const timeoutMs = (+flag('timeout') || 180) * 1000;
const repeat = Math.max(1, +flag('repeat') || 1);

const allTests = readdirSync(join(ROOT, 'test')).filter((f) => f.endsWith('.test.js')).sort().map((f) => `test/${f}`);

// ---- selection ----------------------------------------------------------------------------------------------------
// The files a module pulls in: static imports, dynamic import('...') and new URL('...', import.meta.url) reads.
const SPEC = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|new URL\(\s*)(['"])(\.{1,2}\/[^'"]+)\1/g;
const depsCache = new Map();
function depsOf(file) {
  if (depsCache.has(file)) return depsCache.get(file);
  const out = new Set(); depsCache.set(file, out);
  let src; try { src = readFileSync(join(ROOT, file), 'utf8'); } catch { return out; }
  if (!/\.(m?js)$/.test(file)) return out;
  for (const m of src.matchAll(SPEC)) {
    const target = posix(relative(ROOT, resolve(ROOT, dirname(file), m[2].replace(/[?#].*$/, ''))));   // './save.js?fresh' is still save.js
    if (!target.startsWith('..')) out.add(target);   // keep targets that no longer exist: a deleted module must select its tests
  }
  return out;
}
function closure(file) {
  const seen = new Set([file]), stack = [file];
  while (stack.length) for (const d of depsOf(stack.pop())) if (!seen.has(d)) { seen.add(d); stack.push(d); }
  return seen;
}
function changedFiles(base) {
  const git = (...a) => execFileSync('git', ['-c', 'core.quotePath=false', ...a], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter(Boolean);
  const set = new Set([...git('diff', '--name-only', 'HEAD'), ...git('ls-files', '--others', '--exclude-standard')]);
  if (typeof base === 'string') for (const f of git('diff', '--name-only', `${base}...HEAD`)) set.add(f);
  return [...set].map(posix);
}

let selected = allTests, note = '';
const changed = flag('changed');
if (changed) {
  let files = null; try { files = changedFiles(changed); } catch { /* not a git checkout, or an unknown ref */ }
  const relevant = (files || []).filter((f) => f.startsWith('public/') || f.startsWith('test/'));
  // When in doubt, run everything. Only docs and agent files are known to be harmless to the tests.
  const harmless = (f) => f.startsWith('public/') || f.startsWith('test/') || /\.md$/i.test(f) || /^(plan|docs|scratchpad|node_modules|\.claude|\.github)(\/|$)/.test(f) || f === '.gitignore' || f === '.gitattributes';
  const why = !files ? 'git could not list the changes' : files.find((f) => !harmless(f));
  selected = why ? allTests : allTests.filter((t) => { const c = closure(t); return relevant.some((f) => c.has(f)); });
  note = `changed: ${relevant.length} file(s) under public/ or test/ -> ${selected.length} of ${allTests.length} test files` + (why ? ` (running all: ${why})` : '');
}
if (filters.length) selected = selected.filter((t) => filters.some((f) => t.toLowerCase().includes(f.toLowerCase())));
if (note) console.log(note);
if (flag('list')) { console.log(selected.join('\n')); process.exit(0); }
if (!selected.length) {
  // Zero tests is a pass only for `--changed` with no name filter. A typo or an empty test folder must not look green.
  const fine = changed && !filters.length && allTests.length > 0;
  console.log(fine ? 'no test file depends on the changed files; nothing to run' : `no test file matches${filters.length ? ': ' + filters.join(' ') : ''} (0 tests ran)`);
  process.exit(fine ? 0 : 1);
}

// On Windows child.kill() stops only `node --test`, not the test process it started; taskkill /T takes the whole tree.
const killTree = (child) => { if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }).on('error', () => child.kill()); else child.kill(); };
// ---- running ------------------------------------------------------------------------------------------------------
function runFile(file) {
  return new Promise((done) => {
    const t0 = Date.now();
    const child = spawn(process.execPath, ['--test', '--test-reporter=tap', file], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '', timedOut = false;
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => { timedOut = true; killTree(child); }, timeoutMs);
    child.on('error', (e) => { clearTimeout(timer); done({ file, ms: Date.now() - t0, pass: 0, fail: 1, failures: [{ name: `could not start node: ${e.message}`, lines: [] }] }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      const num = (k) => +(out.match(new RegExp(`^# ${k} (\\d+)`, 'm'))?.[1] ?? 0);
      const r = { file, ms: Date.now() - t0, pass: num('pass'), fail: num('fail') + num('cancelled'), failures: parseFailures(out, file) };
      if (timedOut) { r.fail = Math.max(r.fail, 1); r.failures.push({ name: `timed out after ${timeoutMs / 1000}s`, lines: [] }); }
      else if (code !== 0 && !r.failures.length) { r.fail = Math.max(r.fail, 1); r.failures.push({ name: 'the file crashed before reporting', lines: err.trim().split('\n').slice(0, 6) }); }
      done(r);
    });
  });
}
// Pull each "not ok" block out of the TAP stream: its name, where it failed, and the first lines of the message.
function parseFailures(tap, file) {
  const L = tap.split('\n'), found = [];
  for (let i = 0; i < L.length; i++) {
    const m = L[i].match(/^(\s*)not ok \d+ - (.*)$/);
    if (!m) continue;
    if (/ # (TODO|SKIP)\b/i.test(m[2])) continue;   // a failing todo test is not a failure (node exits 0 for it)
    let j = i + 1; const block = [];
    while (j < L.length && !/^\s*\.\.\.\s*$/.test(L[j]) && !/^\s*(not )?ok \d+/.test(L[j])) block.push(L[j++]);
    const text = block.join('\n');
    if (/failureType: 'subtestsFailed'/.test(text) || /^\s*type: 'suite'/m.test(text)) continue;   // the parent of a failing subtest / the file wrapper
    const base = file.split('/').pop().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const at = text.match(new RegExp(`${base}:(\\d+):\\d+\\)?\\s*$`, 'm'))?.[1] ?? text.match(/location: '.*?:(\d+):\d+'/)?.[1];
    const e = text.indexOf('error: ');
    let lines = [];
    if (e >= 0) {
      const body = text.slice(e + 7).split('\n');
      const first = body[0].replace(/^\|-?\s*$/, '').replace(/^'|'$/g, '');
      const rest = []; for (const l of body.slice(1)) { if (/^\s{0,2}\S/.test(l) && /^\s*(code|name|stack|expected|actual|operator|diff|generatedMessage):/.test(l)) break; rest.push(l.trim()); }
      lines = [first, ...rest].filter(Boolean).slice(0, 5).map((l) => (l.length > 220 ? l.slice(0, 217) + '...' : l));
    }
    found.push({ name: m[2].length > 140 ? m[2].slice(0, 137) + '...' : m[2], at, lines });
  }
  return found;
}
async function pool(files) {
  const results = []; let next = 0;
  await Promise.all(Array.from({ length: Math.min(jobs, files.length) }, async () => { while (next < files.length) results.push(await runFile(files[next++])); }));
  return results.sort((a, b) => a.file.localeCompare(b.file));
}

const t0 = Date.now();
const runs = []; for (let i = 0; i < repeat; i++) runs.push(await pool(selected));
const last = runs[runs.length - 1];
const failedFiles = new Set();
for (const r of last) for (const f of r.failures) {
  failedFiles.add(r.file);
  console.log(`FAIL ${r.file}${f.at ? ':' + f.at : ''}  ${f.name}`);
  for (const l of f.lines) console.log(`     ${l}`);
}
if (repeat > 1) {
  const flaky = selected.filter((f) => { const n = runs.filter((run) => run.find((r) => r.file === f).fail > 0).length; return n > 0 && n < repeat; });
  const always = selected.filter((f) => runs.every((run) => run.find((r) => r.file === f).fail > 0));
  console.log(`repeat x${repeat}: ${flaky.length} flaky file(s)${flaky.length ? ': ' + flaky.map((f) => `${f} (${runs.filter((run) => run.find((r) => r.file === f).fail > 0).length}/${repeat} runs failed)`).join(', ') : ''}; ${always.length} always failing`);
  for (const f of flaky) failedFiles.add(f);
}
if (flag('slow')) for (const r of [...last].sort((a, b) => b.ms - a.ms).slice(0, 10)) console.log(`${(r.ms / 1000).toFixed(1).padStart(6)}s  ${r.file}`);
const pass = last.reduce((s, r) => s + r.pass, 0), fail = last.reduce((s, r) => s + r.fail, 0);
console.log(`tests: ${pass} pass, ${fail} fail · ${selected.length} files · ${((Date.now() - t0) / 1000).toFixed(1)}s (${jobs} at a time)`);
if (failedFiles.size) console.log(`rerun: node tools/test.mjs ${[...failedFiles].map((f) => f.split('/').pop().replace('.test.js', '')).join(' ')}`);
process.exit(failedFiles.size || fail ? 1 : 0);
