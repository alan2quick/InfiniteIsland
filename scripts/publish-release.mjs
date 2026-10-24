// Run AFTER the exact public deployment passes smoke checks. Never run this inside the application build.
// Credentials come only from the trusted process environment; none are put in arguments, browser config or logs.
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { RELEASES } from '../src/admin/releases.js';
import { publicationInput, publishVerifiedRelease, RELEASE_REPOSITORY } from './release-publication.mjs';

const arg = (name) => { const at = process.argv.indexOf(name); return at < 0 ? null : process.argv[at + 1]; };
function execute(command, args, input = null) {
  return new Promise((resolve, reject) => {
    const processHandle = execFile(command, args, { timeout: 30000, maxBuffer: 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: 'true' } }, (error, stdout) => error ? reject(new Error('Release command did not complete. Check GitHub authentication and repository access.')) : resolve(stdout.trim()));
    if (input !== null) processHandle.stdin.end(input);
  });
}
async function githubApi(path, method = 'GET', data = null) {
  const args = ['api', `repos/${RELEASE_REPOSITORY}/${path}`, '--method', method, '--include'];
  if (data) args.push('--input', '-');
  // gh exits nonzero for 404; use --exit-status-free API behavior through explicit accepted HTTP response status instead.
  return new Promise((resolve, reject) => {
    const child = execFile('gh', args, { timeout: 30000, maxBuffer: 1024 * 1024, env: { ...process.env, GH_PROMPT_DISABLED: 'true' } }, (error, stdout) => {
      const split = stdout.search(/\r?\n\r?\n/), header = split < 0 ? '' : stdout.slice(0, split), body = split < 0 ? '' : stdout.slice(split).trim();
      const status = Number(/^HTTP\/[^ ]+ (\d+)/.exec(header)?.[1]);
      if (status === 404) return resolve(null);
      if (error || status < 200 || status >= 300 || !status) return reject(new Error('GitHub publication request failed. Retry the same verified commit/version.'));
      try { resolve(JSON.parse(body)); } catch { reject(new Error('GitHub returned an unreadable publication response.')); }
    });
    if (data) child.stdin.end(JSON.stringify(data));
  });
}
async function tagCommit(tag) {
  const ref = await githubApi(`git/ref/tags/${tag}`); if (!ref) return null;
  if (ref.object?.type === 'commit') return ref.object.sha;
  if (ref.object?.type === 'tag') return (await githubApi(`git/tags/${ref.object.sha}`))?.object?.sha || null;
  throw new Error('Unsupported existing GitHub tag. Nothing was overwritten.');
}
async function main() {
  const commit = arg('--commit'), version = arg('--version'), deploymentUrl = arg('--deployment');
  const release = RELEASES.find((r) => r.version === version);
  const input = publicationInput({ release, commit, deploymentUrl });
  const packageInfo = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  if (packageInfo.version !== version || await execute('git', ['rev-parse', 'HEAD']) !== commit || await execute('git', ['status', '--porcelain=v1', '--untracked-files=normal'])) throw new Error('Release from the exact clean checkout matching the current package version.');
  const response = await fetch(`${input.deployment_url}/generated/release-status.json`, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('The public deployment metadata is unavailable. Nothing was published.');
  const status = await response.json();
  // Server-only key: use the dedicated protected deployment secret, never PUBLIC_SUPABASE_*.
  const secret = process.env.RELEASE_SUPABASE_SECRET_KEY, url = process.env.RELEASE_SUPABASE_URL;
  if (!secret || !url) throw new Error('Trusted release database credentials are missing. Nothing was published.');
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url)) throw new Error('Release database URL must identify the intended hosted Supabase project.');
  if (!secret.startsWith('sb_secret_')) {
    let role; try { role = JSON.parse(Buffer.from(secret.split('.')[1], 'base64url')).role; } catch {}
    if (role !== 'service_role') throw new Error('Use a trusted server secret, never the browser publishable key.');
  }
  const client = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const checked = ({ data, error }) => { if (error) throw new Error('Release database request failed. Check the migration, project and trusted deployment credentials.'); return data; };
  const database = {
    async find(id) { return checked(await client.from('published_releases').select('*').eq('version', id).maybeSingle()); },
    async insert(row) { checked(await client.from('published_releases').insert(row)); },
  };
  const github = {
    async find(tag) {
      const existingTag = await tagCommit(tag);
      if (existingTag && existingTag !== commit) throw new Error('Existing release tag points to another commit. Nothing was overwritten.');
      const row = await githubApi(`releases/tags/${tag}`);
      return row ? { commit: existingTag, title: row.name, body: row.body, draft: row.draft } : null;
    },
    async create(releaseInput, body) {
      const remoteCommit = await githubApi(`commits/${commit}`);
      if (remoteCommit?.sha !== commit) throw new Error('The release commit is not available in this fork. Push the verified source first.');
      await githubApi('releases', 'POST', { tag_name: releaseInput.tag, target_commitish: commit, name: releaseInput.title, body, draft: false, prerelease: version.includes('-'), make_latest: version.includes('-') ? 'false' : 'true' });
      if (await tagCommit(releaseInput.tag) !== commit) throw new Error('GitHub release tag verification failed. Check the published release before retrying.');
    },
  };
  const result = await publishVerifiedRelease({ input, status, github, database });
  console.log(`Release ${version}: GitHub and database publication complete${result.reused ? ' (already matched)' : ''}.`);
}
main().catch((error) => { console.error(error.message?.startsWith('fetch') ? 'Deployment verification failed. Nothing was published.' : error.message || 'Release publication failed.'); process.exitCode = 1; });
