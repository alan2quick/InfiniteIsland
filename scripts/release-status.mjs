// Read-only Git observations. Never expose paths, remote URLs, diffs or raw errors.
// Remote-tracking refs are local snapshots; this does not query GitHub/PR status.
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { releaseRepository } from './repository.mjs';
const DEFAULT_ROOT = fileURLToPath(new URL('../', import.meta.url));

function git(args, { cwd }) {
  return new Promise(resolve => {
    execFile('git', ['-c', 'core.fsmonitor=false', ...args], {
      cwd, timeout: 1500, maxBuffer: 128 * 1024, windowsHide: true,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
    }, (error, stdout) => resolve({ code: error ? (Number.isInteger(error.code) ? error.code : null) : 0, stdout: error ? '' : stdout }));
  });
}
const cleanRef = value => typeof value === 'string' && value.trim().length <= 160 && /^[\w./@+-]+$/.test(value.trim()) ? value.trim() : null;
function countChanges(text) {
  if (typeof text !== 'string') return null;
  const entries = text.split('\0'); let count = 0;
  for (let i = 0; i < entries.length; i++) {
    if (!entries[i]) continue;
    if (!/^[ MADRCU?!]{2} /.test(entries[i])) return null;
    count++;
    // Porcelain -z writes an additional original path for renames/copies.
    if (/[RC]/.test(entries[i].slice(0, 2))) i++;
  }
  return count;
}

export async function collectReleaseStatus({ cwd = DEFAULT_ROOT, source = 'live-local', buildDate = null, buildVersion = null, environment = process.env, now = () => new Date(), runGit = git } = {}) {
  const call = async args => { try { return await runGit(args, { cwd }); } catch { return { code: null, stdout: '' }; } };
  const [branch, commit, changes, tracking, main] = await Promise.all([
    call(['symbolic-ref', '--quiet', '--short', 'HEAD']),
    call(['rev-parse', '--verify', 'HEAD']),
    call(['status', '--porcelain=v1', '-z', '--untracked-files=all']),
    call(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']),
    call(['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/main']),
  ]);
  const fullCommit = commit.code === 0 && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit.stdout.trim()) ? commit.stdout.trim() : null;
  const result = {
    format: 'infinite-island-release-v1', source: source === 'build-snapshot' ? source : 'live-local',
    buildDate: typeof buildDate === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(buildDate) ? buildDate : null, observedAt: now().toISOString(),
    fork: releaseRepository(environment), upstream: 'alan2quick/InfiniteIsland',
    buildVersion: typeof buildVersion === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(buildVersion) ? buildVersion : null,
    gitAvailable: changes.code === 0 || commit.code === 0,
    branch: branch.code === 0 ? cleanRef(branch.stdout) : null,
    branchSource: branch.code === 0 && cleanRef(branch.stdout) ? 'git' : null,
    commit: fullCommit?.slice(0, 10) || null, commitFull: fullCommit, commitSource: fullCommit ? 'git' : null,
    dirtyCount: changes.code === 0 ? countChanges(changes.stdout) : null,
    trackingBranch: tracking.code === 0 ? cleanRef(tracking.stdout) : null,
    ahead: null, behind: null, integrationState: 'unknown', integrationBase: null,
  };
  // Vercel can omit .git; identify a build from its documented provider metadata
  // without pretending that a missing worktree was independently observed clean.
  const providerCommit = environment.VERCEL_GIT_COMMIT_SHA;
  const matchingProvider = result.source === 'build-snapshot'
      && String(environment.VERCEL_GIT_REPO_OWNER).toLowerCase() === result.fork.split('/')[0].toLowerCase()
      && String(environment.VERCEL_GIT_REPO_SLUG).toLowerCase() === result.fork.split('/')[1].toLowerCase()
      && typeof providerCommit === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(providerCommit);
  if (!result.commitFull && matchingProvider) {
    result.commitFull = providerCommit; result.commit = providerCommit.slice(0, 10); result.commitSource = 'vercel-build-env';
  }
  // Provider build checkouts can use a synthetic branch (e.g. master). The
  // documented ref describes the deployed source branch, only when its exact
  // commit agrees with the Git observation for this fork. Preserve provenance.
  const providerBranch = cleanRef(environment.VERCEL_GIT_COMMIT_REF);
  if (matchingProvider && fullCommit === providerCommit && providerBranch) {
    result.checkoutBranch = result.branch;
    result.branch = providerBranch;
    result.branchSource = 'vercel-build-env';
  }
  if (result.trackingBranch) {
    const counts = await call(['rev-list', '--left-right', '--count', 'HEAD...@{upstream}']);
    const match = counts.code === 0 && /^(\d+)\s+(\d+)\s*$/.exec(counts.stdout);
    if (match && match.slice(1).every(n => Number.isSafeInteger(Number(n)))) { result.ahead = Number(match[1]); result.behind = Number(match[2]); }
  }
  if (commit.code === 0 && main.code === 0) {
    const included = await call(['merge-base', '--is-ancestor', 'HEAD', 'refs/remotes/origin/main']);
    if (included.code === 0 || included.code === 1) {
      result.integrationState = included.code === 0 ? 'merged' : 'unmerged';
      result.integrationBase = 'origin/main (local ref snapshot)';
    }
  }
  return result;
}
