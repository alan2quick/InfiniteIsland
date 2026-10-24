import { readdirSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
export const root = fileURLToPath(new URL('../', import.meta.url));
export function selectTests(names = []) {
  const groups = JSON.parse(readFileSync(new URL('./test-batches.json', import.meta.url)));
  const actual = readdirSync(`${root}/test`).filter(f => f.endsWith('.test.js')).map(f => `test/${f}`).sort();
  const listed = Object.values(groups).flatMap(g => g.files);
  const missing = actual.filter(f => !listed.includes(f));
  const stale = listed.filter(f => !actual.includes(f));
  if (missing.length || stale.length || new Set(listed).size !== listed.length) throw Error(`Update scripts/test-batches.json: uncategorized=${missing}; missing=${stale}; duplicate=${listed.length-new Set(listed).size}`);
  for (const name of names) if (name !== 'all' && (!groups[name] || !groups[name].files.length)) throw Error(`Unknown batch: ${name}. Use --list.`);
  return { groups, files: !names.length || names.includes('all') ? actual : [...new Set(names.flatMap(n => groups[n].files))].sort() };
}
export function run(command, args) {
  return new Promise(resolve => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit' });
    child.once('error', error => { console.error(error.message); resolve(1); });
    child.once('exit', code => resolve(code ?? 1));
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2), list = args.includes('--list'), dry = args.includes('--dry-run');
    const { groups, files } = selectTests(args.filter(a => !['--list','--dry-run'].includes(a)));
    if (list) for (const [name,g] of Object.entries(groups)) console.log(`${name.padEnd(15)} ${String(g.files.length).padStart(3)} files  ${g.description}`);
    else if (dry) console.log(files.join('\n'));
    else { process.env.TEST_BATCH_LABEL = !args.length || args.includes('all') ? 'all' : [...new Set(args)].sort().join('+'); process.exitCode = await run(process.execPath, ['scripts/test-timings.mjs', ...files]); }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
