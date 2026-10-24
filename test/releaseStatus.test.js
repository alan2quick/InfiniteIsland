// Release badges describe evidence from local Git refs, not an assumed PR state.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, symlink, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { collectReleaseStatus } from '../scripts/release-status.mjs';
const sha = 'a'.repeat(40), stamp = '2026-10-24T17:00:00.000Z';
function fake(overrides = {}) {
  const values = {
    'symbolic-ref --quiet --short HEAD': { code: 0, stdout: 'codex/cozy-island\n' },
    'rev-parse --verify HEAD': { code: 0, stdout: sha + '\n' },
    'status --porcelain=v1 -z --untracked-files=all': { code: 0, stdout: ' M public/a.js\0?? untracked\nname.txt\0R  renamed.js\0old.js\0' },
    'rev-parse --abbrev-ref --symbolic-full-name @{upstream}': { code: 0, stdout: 'origin/codex/cozy-island\n' },
    'rev-parse --verify --quiet refs/remotes/origin/main': { code: 0, stdout: sha },
    'rev-list --left-right --count HEAD...@{upstream}': { code: 0, stdout: '2\t1\n' },
    'merge-base --is-ancestor HEAD refs/remotes/origin/main': { code: 1, stdout: '' },
    ...overrides,
  };
  return async args => values[args.join(' ')] || { code: 128, stdout: '' };
}
const collect = overrides => collectReleaseStatus({ runGit: fake(overrides), now: () => new Date(stamp) });

test('release status counts changes safely and distinguishes tracking divergence from main integration', async () => {
  const value = await collect();
  assert.equal(value.source, 'live-local'); assert.equal(value.branch, 'codex/cozy-island');
  assert.equal(value.commit, sha.slice(0, 10)); assert.equal(value.commitFull, sha);
  assert.equal(value.dirtyCount, 3, 'rename paths count once; newlines in filenames are safe');
  assert.equal(value.ahead, 2); assert.equal(value.behind, 1);
  assert.equal(value.integrationState, 'unmerged');
  assert.match(value.integrationBase, /local ref snapshot/);
  assert.equal(value.buildDate, null); assert.equal(value.observedAt, stamp);
  assert.equal(value.fork, 'alan2quick/InfiniteIsland'); assert.equal(value.upstream, 'alan2quick/InfiniteIsland');
  assert.equal(JSON.stringify(value).includes('public/a.js'), false);
});

test('a feature branch already included in local origin/main is merged; a name alone never proves unmerged', async () => {
  const merged = await collect({ 'merge-base --is-ancestor HEAD refs/remotes/origin/main': { code: 0, stdout: '' } });
  assert.equal(merged.integrationState, 'merged');
  const missing = await collect({ 'rev-parse --verify --quiet refs/remotes/origin/main': { code: 1, stdout: '' } });
  assert.equal(missing.branch, 'codex/cozy-island'); assert.equal(missing.integrationState, 'unknown');
  const unrelated = await collect({ 'merge-base --is-ancestor HEAD refs/remotes/origin/main': { code: 128, stdout: '' } });
  assert.equal(unrelated.integrationState, 'unknown');
});

test('missing Git, detached HEAD, untracked branches and bounded-output failures remain unknown rather than clean', async () => {
  const unavailable = await collectReleaseStatus({ runGit: async () => { throw new Error('secret /private/path https://token@host'); } });
  assert.equal(unavailable.gitAvailable, false); assert.equal(unavailable.dirtyCount, null);
  assert.equal(unavailable.integrationState, 'unknown');
  assert.equal(JSON.stringify(unavailable).includes('secret'), false);
  const detached = await collect({
    'symbolic-ref --quiet --short HEAD': { code: 1, stdout: '' },
    'rev-parse --abbrev-ref --symbolic-full-name @{upstream}': { code: 128, stdout: '' },
    'status --porcelain=v1 -z --untracked-files=all': { code: null, stdout: '' },
  });
  assert.equal(detached.branch, null); assert.equal(detached.trackingBranch, null);
  assert.equal(detached.ahead, null); assert.equal(detached.behind, null); assert.equal(detached.dirtyCount, null);
});

test('build snapshots identify their observation time and do not claim visibility into later local edits', async () => {
  const value = await collectReleaseStatus({ runGit: fake(), source: 'build-snapshot', buildDate: stamp, now: () => new Date(stamp) });
  assert.equal(value.source, 'build-snapshot'); assert.equal(value.buildDate, stamp);
  assert.equal(value.observedAt, stamp);
  const invalid = await collectReleaseStatus({ runGit: fake(), buildDate: '/private/secret' });
  assert.equal(invalid.buildDate, null);
});

test('actual non-repository directory fails closed without leaking its path', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'island-no-git-'));
  try {
    await writeFile(path.join(cwd, 'private.txt'), 'not a repository');
    const value = await collectReleaseStatus({ cwd });
    assert.equal(value.gitAvailable, false); assert.equal(value.dirtyCount, null);
    assert.equal(value.commit, null); assert.equal(value.integrationState, 'unknown');
    assert.equal(JSON.stringify(value).includes(cwd), false);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test('provider commit fallback is explicitly build-only and never fabricates a clean Git observation', async () => {
  const environment = { VERCEL_GIT_REPO_OWNER: 'alan2quick', VERCEL_GIT_REPO_SLUG: 'InfiniteIsland', VERCEL_GIT_COMMIT_SHA: sha };
  const unavailable = async () => ({ code: null, stdout: '' });
  const built = await collectReleaseStatus({ source: 'build-snapshot', buildVersion: '0.83.0', environment, runGit: unavailable });
  assert.equal(built.commitFull, sha); assert.equal(built.commitSource, 'vercel-build-env');
  assert.equal(built.buildVersion, '0.83.0'); assert.equal(built.dirtyCount, null); assert.equal(built.gitAvailable, false);
  assert.equal(built.integrationState, 'unknown');
  const local = await collectReleaseStatus({ source: 'live-local', environment, runGit: unavailable });
  assert.equal(local.commitFull, null);
  const wrongRepo = await collectReleaseStatus({ source: 'build-snapshot', environment: { ...environment, VERCEL_GIT_REPO_OWNER: 'other' }, runGit: unavailable });
  assert.equal(wrongRepo.commitFull, null);
});

test('malformed metadata is not returned as clean or exposed as remote credential text', async () => {
  const value = await collect({
    'symbolic-ref --quiet --short HEAD': { code: 0, stdout: 'https://secret@host/repo' },
    'status --porcelain=v1 -z --untracked-files=all': { code: 0, stdout: 'truncated or malformed output' },
    'rev-parse --abbrev-ref --symbolic-full-name @{upstream}': { code: 0, stdout: 'https://token@host/branch' },
  });
  assert.equal(value.branch, null); assert.equal(value.dirtyCount, null); assert.equal(value.trackingBranch, null);
  assert.equal(JSON.stringify(value).includes('secret'), false); assert.equal(JSON.stringify(value).includes('token'), false);
});

test('provider source branch replaces a synthetic checkout branch only for matching fork and observed commit', async () => {
  const environment = { VERCEL_GIT_REPO_OWNER: 'alan2quick', VERCEL_GIT_REPO_SLUG: 'InfiniteIsland', VERCEL_GIT_COMMIT_SHA: sha, VERCEL_GIT_COMMIT_REF: 'main' };
  const runGit = fake({ 'symbolic-ref --quiet --short HEAD': { code: 0, stdout: 'master\n' } });
  const built = await collectReleaseStatus({ source: 'build-snapshot', environment, runGit });
  assert.equal(built.branch, 'main'); assert.equal(built.branchSource, 'vercel-build-env');
  assert.equal(built.checkoutBranch, 'master'); assert.equal(built.dirtyCount, 3, 'provider identity never clears real changes');
  for (const changed of [
    { VERCEL_GIT_COMMIT_SHA: 'b'.repeat(40) }, { VERCEL_GIT_REPO_OWNER: 'other' },
    { VERCEL_GIT_REPO_SLUG: 'other' }, { VERCEL_GIT_COMMIT_REF: 'https://secret@host' },
  ]) {
    const rejected = await collectReleaseStatus({ source: 'build-snapshot', environment: { ...environment, ...changed }, runGit });
    assert.equal(rejected.branch, 'master'); assert.equal(rejected.branchSource, 'git');
  }
  const local = await collectReleaseStatus({ source: 'live-local', environment, runGit });
  assert.equal(local.branch, 'master'); assert.equal(local.branchSource, 'git');
  const missingGit = await collectReleaseStatus({ source: 'build-snapshot', environment, runGit: async () => ({ code: 128, stdout: '' }) });
  assert.equal(missingGit.branch, null, 'without observed Git commit branch cannot be independently matched');
  assert.equal(missingGit.dirtyCount, null);
});

test('provider dependency-cache symlinks are ignored while genuine source additions remain dirty', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'island-cache-link-'));
  try {
    execFileSync('git', ['init', '--quiet', cwd]);
    await mkdir(path.join(cwd, 'cache'));
    await symlink('cache', path.join(cwd, 'node_modules'), 'dir');
    const ignore = fileURLToPath(new URL('../.gitignore', import.meta.url));
    const status = () => execFileSync('git', ['-c', `core.excludesFile=${ignore}`, 'status', '--porcelain=v1'], { cwd, encoding: 'utf8' });
    assert.equal(status(), '', 'cached symlink is generated dependency data');
    await writeFile(path.join(cwd, 'source.js'), 'export const realChange = true;');
    assert.equal(status(), '?? source.js\n', 'source edits must never be suppressed');
  } finally { await rm(cwd, { recursive: true, force: true }); }
});
