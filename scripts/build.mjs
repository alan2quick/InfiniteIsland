// Preserve the legacy ES-module game; bundle new React features as lazy chunks.
import { build } from 'esbuild';
import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

// Local browser-public configuration stays outside Git. Hosted environment variables take precedence.
try { process.loadEnvFile('.env.local'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
import { collectReleaseStatus } from './release-status.mjs';

await mkdir('public/generated', { recursive: true });
await rm('public/generated', { recursive: true, force: true });
await build({
  entryPoints: { admin: 'src/admin/index.jsx', cloud: 'src/cloud/index.js', profiles: 'src/profiles/index.jsx' },
  outdir: 'public/generated', bundle: true, splitting: true, format: 'esm', platform: 'browser', target: 'es2022',
  minify: true, sourcemap: false, external: ['three', 'three/*'],
  define: { 'process.env.NODE_ENV': '"production"' },
});
// These two values are browser-public by design. Never emit a secret/service-role key.
const url = process.env.PUBLIC_SUPABASE_URL || '';
const key = process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';
if (key.startsWith('sb_secret_')) throw new Error('A Supabase secret key cannot be published.');
if (key.split('.').length === 3) {
  try { if (JSON.parse(Buffer.from(key.split('.')[1], 'base64url')).role === 'service_role') throw new Error('A service-role key cannot be published.'); } catch (error) { if (error.message.includes('service-role')) throw error; }
}
await writeFile('public/generated/config.json', JSON.stringify({ supabaseUrl: url, supabasePublishableKey: key }));
const buildDate = new Date().toISOString();
const buildVersion = JSON.parse(await readFile('package.json', 'utf8')).version;
// Private provider build logs only: identify the remaining dirty path without
// exposing file contents, environment values, remote URLs, or raw Git errors.
// This observation never filters or overrides the public dirtyCount.
if (process.env.VERCEL === '1') {
  try {
    const status = execFileSync('git', ['-c', 'core.fsmonitor=false', 'status', '--porcelain=v1', '-z', '--untracked-files=all'], {
      encoding: 'utf8', timeout: 2000, maxBuffer: 128 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
    });
    const entries = status.split('\0'), changes = [];
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (!entry) continue;
      if (!/^[ MADRCU?!]{2} /.test(entry)) throw new Error('Invalid status record');
      const change = { status: entry.slice(0, 2), path: entry.slice(3) };
      if (/[RC]/.test(change.status)) change.previousPath = entries[++i];
      changes.push(change);
    }
    // JSON escapes control characters in unusual filenames; bound log volume.
    console.log('[release-status] Vercel worktree paths:', JSON.stringify({ count: changes.length, changes: changes.slice(0, 40) }));
  } catch {
    console.log('[release-status] Vercel worktree path diagnostic unavailable.');
  }
}
await writeFile('public/generated/release-status.json', JSON.stringify(await collectReleaseStatus({ source: 'build-snapshot', buildDate, buildVersion })));
if (!process.argv.includes('--local')) {
  await rm('dist', { recursive: true, force: true });
  await cp('public', 'dist', { recursive: true });
  // Pin and self-host the graphics library for reliable production loading.
  await cp('node_modules/three', 'dist/vendor/three', { recursive: true });
  const html = await readFile('dist/index.html', 'utf8');
  await writeFile('dist/index.html', html.replace("var cdn = 'https://cdn.jsdelivr.net/npm/three@0.186.1/';", "var cdn = '/vendor/three/';"));
}
console.log('Built lazy React features and static game.');
