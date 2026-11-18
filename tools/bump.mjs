#!/usr/bin/env node
// One-command version bump.
//
//   node tools/bump.mjs 0.86.1     set the version everywhere it is written
//   node tools/bump.mjs --check    exit 1 if the places disagree (used by CI)
//
// The version is written in four places that must agree: VERSION in public/js/config.js (the source of truth),
// "version" in package.json, and two "version" fields in package-lock.json. Editing them by hand costs an agent
// four file reads and edits per bump; this does it in one call and cannot leave them out of sync.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const CONFIG_RE = /(export const VERSION = ')([^']+)(';)/;
const arg = process.argv[2];

function current() {
  const lock = JSON.parse(read('package-lock.json'));
  return {
    'public/js/config.js': read('public/js/config.js').match(CONFIG_RE)?.[2],
    'package.json': JSON.parse(read('package.json')).version,
    'package-lock.json (top)': lock.version,
    'package-lock.json (packages[""])': lock.packages?.['']?.version,
  };
}

if (arg === '--check' || arg === undefined) {
  const c = current(), values = new Set(Object.values(c));
  if (values.size === 1) { console.log(`version ${[...values][0]} (4 places agree)`); process.exit(0); }
  console.log('version mismatch:'); for (const [k, v] of Object.entries(c)) console.log(`  ${v}  ${k}`);
  process.exit(1);
}
if (!/^\d+\.\d+\.\d+$/.test(arg)) { console.log('usage: node tools/bump.mjs <major.minor.patch> | --check'); process.exit(2); }

// Text replacement (not JSON.stringify) so each file keeps its formatting and line endings; only the version changes.
const before = current();
const setJsonVersion = (text, nth) => { let n = 0; return text.replace(/("version":\s*")([^"]+)(")/g, (m, a, _old, z) => (n++ < nth ? a + arg + z : m)); };
const config = read('public/js/config.js');
if (!CONFIG_RE.test(config)) { console.log("could not find `export const VERSION = '...';` in public/js/config.js"); process.exit(1); }
// Build all three new texts first and prove that nothing but the project's own version changed. Only then write.
const sameExceptVersion = (oldText, newText, isLock) => { const o = JSON.parse(oldText), n = JSON.parse(newText); o.version = arg; if (isLock && o.packages?.['']) o.packages[''].version = arg; return JSON.stringify(o) === JSON.stringify(n) && n.version === arg && (!isLock || n.packages?.['']?.version === arg); };
const pkgOld = read('package.json'), pkgNew = setJsonVersion(pkgOld, 1);
const lockOld = read('package-lock.json'), lockNew = setJsonVersion(lockOld, 2);   // the first two "version" fields are the project's own
if (!sameExceptVersion(pkgOld, pkgNew, false) || !sameExceptVersion(lockOld, lockNew, true)) { console.log('bump stopped, nothing was written: the first "version" fields in package.json / package-lock.json are not the project\'s own. Run `npm install --package-lock-only` and try again.'); process.exit(1); }
writeFileSync(join(ROOT, 'public/js/config.js'), config.replace(CONFIG_RE, `$1${arg}$3`));
writeFileSync(join(ROOT, 'package.json'), pkgNew);
writeFileSync(join(ROOT, 'package-lock.json'), lockNew);
const after = current();
if (new Set(Object.values(after)).size !== 1 || after['package.json'] !== arg) { console.log('bump failed, files disagree:', after); process.exit(1); }
console.log(`version ${before['public/js/config.js']} -> ${arg} (config.js, package.json, package-lock.json x2)`);
