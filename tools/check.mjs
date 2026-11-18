#!/usr/bin/env node
// Fast static checks that need no browser and no test run (a few seconds). Used by CI; also handy before a commit.
//
//   node tools/check.mjs            errors fail (exit 1), warnings are listed
//   node tools/check.mjs --strict   warnings fail too
//
// Errors (things that break the deployed game or the release):
//   1. syntax    every .js file parses (`node --check`). 109 modules, including public/js/main.js, are never
//                imported by a test, so a syntax error there would otherwise ship unnoticed.
//   2. imports   every relative import in public/js points at a file that exists (a missing file is a blank page
//                on the static host).
//   3. version   VERSION in config.js, package.json and both fields in package-lock.json agree.
// Warnings (things that make the tests less trustworthy):
//   4. assertions that can never fail (`|| true` inside an assert).
//   5. tests that pin the current version number (they must be edited at every bump and check nothing).
//   6. AGENTS.md / CLAUDE.md longer than 200 lines (they are loaded into every agent session).
import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const posix = (p) => p.split(sep).join('/');
const strict = process.argv.includes('--strict');
const errors = [], warnings = [];
const walk = (dir) => (existsSync(join(ROOT, dir)) ? readdirSync(join(ROOT, dir)).flatMap((n) => { const p = `${dir}/${n}`; return statSync(join(ROOT, p)).isDirectory() ? walk(p) : [p]; }) : []);
const js = [...walk('public/js'), ...walk('test'), ...walk('tools'), 'server.js'].filter((f) => /\.m?js$/.test(f) && existsSync(join(ROOT, f)));

// 1. syntax
await (async () => {
  let next = 0;
  const one = (f) => new Promise((done) => execFile(process.execPath, ['--check', f], { cwd: ROOT }, (err, _out, stderr) => { if (err) errors.push(`syntax  ${f}: ${(stderr.split('\n').find((l) => /Error/.test(l)) || stderr.split('\n')[0] || '').trim()}`); done(); }));
  await Promise.all(Array.from({ length: Math.max(2, os.availableParallelism?.() ?? os.cpus().length) }, async () => { while (next < js.length) await one(js[next++]); }));
})();

// 2. imports
const SPEC = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"]+)\1/g;
for (const f of js.filter((x) => x.startsWith('public/js/'))) {
  const src = readFileSync(join(ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const m of src.matchAll(SPEC)) {
    const target = resolve(ROOT, dirname(f), m[2].replace(/[?#].*$/, ''));
    // Windows and macOS ignore letter case in file names; the web host does not. So compare against the real name on disk.
    if (!existsSync(target) || !statSync(target).isFile()) errors.push(`import  ${f}: '${m[2]}' does not exist (${posix(relative(ROOT, target))})`);
    else if (!readdirSync(dirname(target)).includes(basename(target))) errors.push(`import  ${f}: '${m[2]}' differs in letter case from the file on disk; it works on Windows and breaks on the web host`);
  }
}

// 3. version
try {
  const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'));
  const v = { 'public/js/config.js': readFileSync(join(ROOT, 'public/js/config.js'), 'utf8').match(/export const VERSION = '([^']+)'/)?.[1], 'package.json': JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version, 'package-lock.json': lock.version, 'package-lock.json packages[""]': lock.packages?.['']?.version };
  if (new Set(Object.values(v)).size !== 1) errors.push(`version the four places disagree: ${Object.entries(v).map(([k, x]) => `${k}=${x}`).join(', ')}`);
  // 5. version pins in tests
  const ver = v['public/js/config.js'];
  for (const f of js.filter((x) => x.startsWith('test/') && x.endsWith('.test.js'))) {
    const L = readFileSync(join(ROOT, f), 'utf8').split('\n');
    L.forEach((l, i) => {
      if (/assert\.\w+\(.*\|\|\s*true\s*[,)]/.test(l)) warnings.push(`always-true  ${f}:${i + 1}  an assert with "|| true" can never fail`);
      if (ver && l.includes(`'${ver}'`) && /VERSION/.test(l)) warnings.push(`version-pin  ${f}:${i + 1}  pins ${ver}; must be edited at every bump`);
    });
  }
} catch (e) { errors.push(`version could not read the version files: ${e.message}`); }

// 6. instruction file size
for (const f of ['AGENTS.md', 'CLAUDE.md']) if (existsSync(join(ROOT, f))) { const n = readFileSync(join(ROOT, f), 'utf8').split('\n').length; const kb = (statSync(join(ROOT, f)).size / 1024).toFixed(1); if (n > 200 || kb > 12) warnings.push(`size  ${f} is ${n} lines / ${kb} KB; it is loaded into every agent session (aim for under 200 lines and 12 KB)`); }

for (const e of errors) console.log(`ERROR ${e}`);
for (const w of warnings) console.log(`warn  ${w}`);
console.log(`check: ${js.length} files · ${errors.length} error(s), ${warnings.length} warning(s)`);
process.exit(errors.length || (strict && warnings.length) ? 1 : 0);
