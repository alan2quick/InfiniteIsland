// One test/build at a time. Changes during a run queue one fresh run.
import { readdirSync, statSync, existsSync } from 'node:fs';
import { selectTests, run, root } from './test-batches.mjs';
const names = process.argv.slice(2);
selectTests(names); // Fail early for misspelled or outdated batch definitions.
let running = false, pending = false, timer;

async function check() {
  if (running) { pending = true; return; }
  running = true; pending = false;
  console.log(`\n[dev:check ${new Date().toLocaleTimeString()}] Tests: ${names.join(', ') || 'all'}\n`);
  try {
    const { files } = selectTests(names);
    process.env.TEST_BATCH_LABEL = !names.length || names.includes('all') ? 'all' : [...new Set(names)].sort().join('+');
    const failed = await run(process.execPath, ['scripts/test-timings.mjs', ...files]);
    if (pending) console.log('[dev:check] Source changed during tests; checking again before building.');
    else if (failed) console.log('[dev:check] Tests failed. Build skipped; waiting for edits.');
    else {
      const buildFailed = existsSync(`${root}/scripts/build.mjs`) ? await run(process.execPath, ['scripts/build.mjs', '--local']) : 0;
      console.log(buildFailed ? '[dev:check] Build failed; waiting for edits.' : '[dev:check] Checks passed (build runs when scripts/build.mjs exists). Refresh localhost to see changes.');
    }
  } catch (error) { console.error('[dev:check]', error.message); }
  finally { running = false; if (pending) { clearTimeout(timer); timer = setTimeout(check, 500); } }
}
function changed(file = '') {
  const name = String(file).replaceAll('\\', '/');
  if (name.startsWith('generated/') || /(?:~|\.sw[op]|\.tmp)$/.test(name)) return;
  if (running) pending = true;
  clearTimeout(timer); timer = setTimeout(check, 500);
}
// Poll metadata instead of consuming hundreds of OS file watchers on macOS.
function snapshot() {
  const entries = [];
  function scan(path) {
    for (const item of readdirSync(`${root}/${path}`, { withFileTypes: true })) {
      const name = `${path}/${item.name}`;
      if (name === 'public/generated' || item.isSymbolicLink()) continue;
      if (item.isDirectory()) scan(name);
      else if (!/(?:~|\.sw[op]|\.tmp)$/.test(name)) {
        const stat = statSync(`${root}/${name}`); entries.push(`${name}:${stat.mtimeMs}:${stat.size}`);
      }
    }
  }
  for (const dir of ['public','src','test','scripts']) if (existsSync(`${root}/${dir}`)) scan(dir);
  for (const file of ['package.json','package-lock.json']) {
    const stat = statSync(`${root}/${file}`); entries.push(`${file}:${stat.mtimeMs}:${stat.size}`);
  }
  return entries.sort().join('\n');
}
let previous = snapshot();
setInterval(() => {
  try { const next = snapshot(); if (next !== previous) { previous = next; changed(); } }
  catch (error) { console.error('[dev:check] Scan failed; will retry:', error.message); }
}, 1000);
console.log('[dev:check] Watching source and tests. Ctrl+C stops. No automatic commits or deploys.');
await check();
