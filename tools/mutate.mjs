#!/usr/bin/env node
// Mutation check: do the tests notice when the code is wrong?
//
//   node tools/mutate.mjs public/js/game/toolRackLogic.js            up to 40 mutants of one module
//   node tools/mutate.mjs public/js/game/iceLogic.js --max=100       more mutants
//   node tools/mutate.mjs public/js/game/x.js --tests=test/x.test.js choose the test files yourself
//   node tools/mutate.mjs --changed                                  every public/js file changed since HEAD
//
// How it works: it copies public/ and test/ to a temp folder, makes ONE small edit there (a "mutant": `<` becomes
// `<=`, `&&` becomes `||`, `+` becomes `-`, `true` becomes `false` ...), and runs the test files that import the
// module. If a test fails, the mutant is "killed": the tests would have caught that bug. If everything still
// passes, the mutant "survived": that line can be wrong without any test noticing. Your working tree is never
// touched.
//
// Why: when the same model writes the code and its tests, a green run cannot tell you whether the tests check the
// behaviour or just execute it. This check has no model in it, so it cannot be flattered. Read the survivors:
// some are harmless (an equivalent edit, a cosmetic value), the rest are the tests to write next.
// No dependencies; works the same on Windows, macOS and Linux.
import { spawn, execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import os, { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const posix = (p) => p.split(sep).join('/');
const argv = process.argv.slice(2);
const flag = (name) => { const a = argv.find((x) => x === `--${name}` || x.startsWith(`--${name}=`)); return a === undefined ? null : a.includes('=') ? a.slice(a.indexOf('=') + 1) : true; };
const MAX = +flag('max') || 40, SEED = +flag('seed') || 1;
const JOBS = Math.max(1, +flag('jobs') || Math.min(4, (os.availableParallelism?.() ?? os.cpus().length) - 1));

let targets = argv.filter((a) => !a.startsWith('--')).map((f) => posix(relative(ROOT, resolve(f))));
if (flag('changed')) {
  const git = (...a) => execFileSync('git', ['-c', 'core.quotePath=false', ...a], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  targets = [...new Set([...git('diff', '--name-only', 'HEAD'), ...git('ls-files', '--others', '--exclude-standard')])].map(posix).filter((f) => f.startsWith('public/js/') && f.endsWith('.js'));
}
// Only the game's own modules: never a file outside public/js (a path into node_modules would be edited for real through the junction).
const outside = targets.filter((t) => !t.startsWith('public/js/') || !t.endsWith('.js'));
if (outside.length) { console.log(`not a module under public/js: ${outside.join(', ')}`); process.exit(2); }
if (!targets.length) { console.log('usage: node tools/mutate.mjs <public/js/...file.js> [--max=40] [--tests=a,b] [--seed=1] [--jobs=N] | --changed'); process.exit(flag('changed') ? 0 : 2); }

// ---- which tests exercise a module: the test files that import it (directly first, else through other modules) ------
const SPEC = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|new URL\(\s*)(['"])(\.{1,2}\/[^'"]+)\1/g;
const depsCache = new Map();
function depsOf(file) {
  if (depsCache.has(file)) return depsCache.get(file);
  const out = new Set(); depsCache.set(file, out);
  let src; try { src = readFileSync(join(ROOT, file), 'utf8'); } catch { return out; }
  for (const m of src.matchAll(SPEC)) { const t = posix(relative(ROOT, resolve(ROOT, dirname(file), m[2].replace(/[?#].*$/, '')))); if (!t.startsWith('..') && existsSync(join(ROOT, t))) out.add(t); }
  return out;
}
function closure(file) { const seen = new Set([file]), stack = [file]; while (stack.length) for (const d of depsOf(stack.pop())) if (!seen.has(d)) { seen.add(d); stack.push(d); } return seen; }
const allTests = readdirSync(join(ROOT, 'test')).filter((f) => f.endsWith('.test.js')).sort().map((f) => `test/${f}`);
function testsFor(target) {
  if (typeof flag('tests') === 'string') {   // always relative to the repo, so the copy in the sandbox runs (an absolute path would test the unmutated original)
    const list = flag('tests').split(',').map((t) => posix(relative(ROOT, resolve(ROOT, t.trim()))));
    const bad = list.filter((t) => !t.startsWith('test/') || !existsSync(join(ROOT, t)));
    if (bad.length) { console.log(`--tests: not a file under test/: ${bad.join(', ')}`); process.exit(2); }
    return list;
  }
  const direct = allTests.filter((t) => depsOf(t).has(target));
  return direct.length ? direct : allTests.filter((t) => closure(t).has(target));
}

// ---- finding places to mutate -------------------------------------------------------------------------------------
// mask[i] is true where source[i] is code: not inside a string, a template literal, a comment or a regex literal.
function codeMask(s) {
  const mask = new Uint8Array(s.length); let i = 0, lastSig = '';
  const regexMayFollow = () => lastSig === '' || /[(,=:[!&|?{};+\-*%<>~^]/.test(lastSig) || /\b(return|typeof|case|in|of|do|else|void|throw|new|delete|await|yield)$/.test(s.slice(Math.max(0, i - 12), i).trimEnd());
  while (i < s.length) {
    const c = s[i], d = s[i + 1];
    if (c === '/' && d === '/') { while (i < s.length && s[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { i = s.indexOf('*/', i + 2); i = i < 0 ? s.length : i + 2; continue; }
    if (c === '"' || c === "'" || c === '`') { i++; while (i < s.length && s[i] !== c) { if (s[i] === '\\') i++; i++; } i++; lastSig = '"'; continue; }
    if (c === '/' && regexMayFollow()) { i++; let cls = false; while (i < s.length && (s[i] !== '/' || cls) && s[i] !== '\n') { if (s[i] === '\\') i++; else if (s[i] === '[') cls = true; else if (s[i] === ']') cls = false; i++; } i++; while (/[a-z]/i.test(s[i] || '')) i++; lastSig = '"'; continue; }
    mask[i] = 1; if (!/\s/.test(c)) lastSig = c; i++;
  }
  return mask;
}
const RULES = [
  [/===/g, '!=='], [/!==/g, '==='],
  [/<=/g, '<'], [/>=/g, '>'], [/(?<![<=])<(?![<=])/g, '<='], [/(?<![=>-])>(?![>=])/g, '>='],
  [/&&(?!=)/g, '||'], [/\|\|(?!=)/g, '&&'],
  [/(?<![+eE])\+(?![+=])/g, '-', 'binary'], [/(?<![-eE])-(?![-=>])/g, '+', 'binary'], [/(?<!\*)\*(?![*=])/g, '/', 'binary'],
  [/\btrue\b/g, 'false'], [/\bfalse\b/g, 'true'],
  [/\bMath\.min\b/g, 'Math.max'], [/\bMath\.max\b/g, 'Math.min'],
];
function findMutants(src) {
  const mask = codeMask(src), found = [];
  const lineStart = (i) => src.lastIndexOf('\n', i - 1) + 1;
  for (const [re, to, kind] of RULES) for (const m of src.matchAll(re)) {
    const i = m.index;
    if (![...m[0]].every((_, k) => mask[i + k])) continue;
    const ls = lineStart(i), le = src.indexOf('\n', i), line = src.slice(ls, le < 0 ? src.length : le);
    if (/^\s*(import|export\s+\*|export\s*\{)/.test(line)) continue;
    if (kind === 'binary') {   // only a real two-sided arithmetic operator: a value on the left, and not string glue
      let p = i - 1; while (p >= 0 && /\s/.test(src[p])) p--;
      if (p < 0 || !/[\w)\]$]/.test(src[p]) || !mask[p]) continue;
      if (/\b(return|typeof|case|in|of|yield|await|void|throw|new|delete)$/.test(src.slice(Math.max(0, p - 8), p + 1))) continue;
      let n = i + m[0].length; while (n < src.length && /\s/.test(src[n])) n++;
      if (!mask[n]) continue;
    }
    found.push({ i, from: m[0], to, line: src.slice(0, i).split('\n').length, text: line.trim() });
  }
  return found.sort((a, b) => a.i - b.i);
}
function sample(list, n, seed) {   // seeded, spread across the file
  if (list.length <= n) return list;
  let x = seed >>> 0 || 1; const rnd = () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const picked = []; const bucket = list.length / n;
  for (let k = 0; k < n; k++) picked.push(list[Math.min(list.length - 1, Math.floor(k * bucket + rnd() * bucket))]);
  return [...new Set(picked)];   // two draws can land on the same mutant; count it once
}

// ---- running ------------------------------------------------------------------------------------------------------
function fillSandbox(dir) {
  for (const d of ['public', 'test']) cpSync(join(ROOT, d), join(dir, d), { recursive: true });
  for (const f of ['package.json', 'package-lock.json']) if (existsSync(join(ROOT, f))) cpSync(join(ROOT, f), join(dir, f));
  if (existsSync(join(ROOT, 'node_modules'))) symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'), 'junction');   // 'junction' needs no admin rights on Windows
}
// On Windows child.kill() stops only `node --test`, not the test process it started; taskkill /T takes the whole tree.
const killTree = (child) => { if (child.exitCode !== null) return; if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }).on('error', () => child.kill()); else child.kill(); };
const parses = (file) => { try { execFileSync(process.execPath, ['--check', file], { stdio: 'ignore' }); return true; } catch { return false; } };
// Runs the test files; resolves 'pass' | 'fail' | 'timeout'. Stops at the first failing test to save time.
function runTests(cwd, tests, timeoutMs) {
  return new Promise((done) => {
    const child = spawn(process.execPath, ['--test', '--test-reporter=tap', ...tests], { cwd, stdio: ['ignore', 'pipe', 'ignore'] });
    let result = null, tail = '';
    const finish = (r) => { if (!result) { result = r; clearTimeout(timer); killTree(child); done(r); } };
    const timer = setTimeout(() => finish('timeout'), timeoutMs);
    child.stdout.on('data', (d) => { tail = (tail + d).slice(-4000); if (/^\s*not ok \d+(?!.* # (TODO|SKIP)\b)/m.test(tail)) finish('fail'); });
    child.on('error', () => finish('fail'));
    child.on('close', (code) => finish(code === 0 ? 'pass' : 'fail'));
  });
}

let exit = 0;
const sandboxes = [];
const cleanup = () => { for (const dir of sandboxes) try { try { unlinkSync(join(dir, 'node_modules')); } catch { /* already gone */ } rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); } catch { /* a leftover temp folder is harmless */ } };
process.on('SIGINT', () => { cleanup(); process.exit(130); });
try {
  for (let k = 0; k < JOBS; k++) { const dir = mkdtempSync(join(tmpdir(), 'mutate-')); sandboxes.push(dir); fillSandbox(dir); }
  for (const target of targets) {
    if (!existsSync(join(ROOT, target))) { console.log(`${target}: no such file`); exit = 2; continue; }
    const tests = testsFor(target);
    if (!tests.length) { console.log(`${target}: NO test file imports this module (directly or indirectly), so every bug in it would go unnoticed by npm test`); exit = exit || 1; continue; }
    const src = readFileSync(join(ROOT, target), 'utf8');
    const all = findMutants(src), mutants = sample(all, MAX, SEED);
    const t0 = Date.now();
    const base = await runTests(sandboxes[0], tests, 300000);
    const baseMs = Date.now() - t0;
    if (base !== 'pass') { console.log(`${target}: its tests do not pass before any mutation (${tests.join(', ')}); fix that first`); exit = 1; continue; }
    const timeoutMs = Math.max(20000, baseMs * 4);
    let next = 0; const results = [];
    await Promise.all(sandboxes.map(async (dir) => {
      while (next < mutants.length) {
        const m = mutants[next++];
        writeFileSync(join(dir, target), src.slice(0, m.i) + m.to + src.slice(m.i + m.from.length));
        if (!parses(join(dir, target))) { writeFileSync(join(dir, target), src); continue; }   // a mutant that is not valid JavaScript proves nothing; skip it
        results.push({ ...m, result: await runTests(dir, tests, timeoutMs) });
        writeFileSync(join(dir, target), src);
      }
    }));
    const survived = results.filter((r) => r.result === 'pass').sort((a, b) => a.i - b.i);
    const killed = results.length - survived.length;
    console.log(`${target}: ${killed}/${results.length} mutants killed (${results.length ? Math.round(100 * killed / results.length) : 0}%) · ${all.length} possible, ${results.length} tried · tests: ${tests.map((t) => t.replace('test/', '')).join(', ')} · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    for (const s of survived) console.log(`  survived  line ${String(s.line).padEnd(4)} ${s.from} -> ${s.to}   ${s.text.length > 110 ? s.text.slice(0, 107) + '...' : s.text}`);
    if (typeof flag('json') === 'string') writeFileSync(flag('json'), JSON.stringify({ target, tests, possible: all.length, tried: results.length, killed, survived: survived.map(({ line, from, to, text }) => ({ line, from, to, text })) }, null, 2));
  }
} finally {
  cleanup();
}
process.exit(exit);
