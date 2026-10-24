import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicationInput, verifyDeployedBuild, publishVerifiedRelease, releaseBody } from '../scripts/release-publication.mjs';
const release = { version: '0.83.0', title: 'Campfire & World Editor', changes: ['Choose your look at the campfire.'], note: 'Shared settings need an admin account.', noteworthy: true };
const input = () => publicationInput({ release, commit: 'a'.repeat(40), deploymentUrl: 'https://infinite-island.example/' });
const status = () => ({ format: 'infinite-island-release-v1', source: 'build-snapshot', fork: 'alan2quick/InfiniteIsland', commitFull: 'a'.repeat(40), buildVersion: '0.83.0', dirtyCount: 0 });
function services() {
  let row = null, githubRow = null;
  const calls = [];
  return { calls,
    database: { async find() { calls.push('database-find'); return row; }, async insert(value) { calls.push('database-insert'); row = value; } },
    github: { async find() { calls.push('github-find'); return githubRow; }, async create(value, body) { calls.push('github-create'); githubRow = { commit: value.commit_sha, title: value.title, body, draft: false }; } },
    row: () => row,
  };
}

test('only short plain product notes and credential-free HTTPS origins become public metadata', () => {
  const value = input(); assert.equal(value.deployment_url, 'https://infinite-island.example');
  assert.equal(value.github_url, 'https://github.com/alan2quick/InfiniteIsland/releases/tag/v0.83.0');
  for (const url of ['http://example.com', 'https://name:password@example.com', 'https://example.com/?token=secret', 'https://example.com/private']) assert.throws(() => publicationInput({ release, commit: value.commit_sha, deploymentUrl: url }));
  assert.throws(() => publicationInput({ release: { ...release, changes: ['<script>'] }, commit: value.commit_sha, deploymentUrl: value.deployment_url }));
  assert.ok(releaseBody(value).includes(value.commit_sha));
});

test('mismatched, dirty or unknown deployments stop before any GitHub/database calls', async () => {
  for (const patch of [{ source: 'live-local' }, { commitFull: 'b'.repeat(40) }, { buildVersion: '0.82.3' }, { dirtyCount: 1 }, { dirtyCount: null }, { fork: 'someone-else/InfiniteIsland' }]) {
    const service = services();
    await assert.rejects(() => publishVerifiedRelease({ input: input(), status: { ...status(), ...patch }, ...service }), /Nothing was published/);
    assert.deepEqual(service.calls, []);
  }
  assert.equal(verifyDeployedBuild(status(), input()), true);
});

test('verified release publishes identical GitHub/database notes exactly once and repeat is idempotent', async () => {
  const service = services(), publication = input();
  const first = await publishVerifiedRelease({ input: publication, status: status(), ...service });
  assert.equal(first.database, 'published');
  assert.ok(service.calls.indexOf('github-create') < service.calls.indexOf('database-insert'));
  assert.equal(service.row().commit_sha, publication.commit_sha); assert.equal(service.row().tag, undefined);
  const again = await publishVerifiedRelease({ input: publication, status: status(), ...service });
  assert.equal(again.reused, true);
  assert.equal(service.calls.filter((c) => c === 'github-create').length, 1);
  assert.equal(service.calls.filter((c) => c === 'database-insert').length, 1);
});

test('partial database failure is explicitly resumable; existing version conflicts are never overwritten', async () => {
  const service = services(), originalInsert = service.database.insert;
  service.database.insert = async () => { throw new Error('offline'); };
  await assert.rejects(() => publishVerifiedRelease({ input: input(), status: status(), ...service }), /GitHub release exists, but database publication failed/);
  service.database.insert = originalInsert;
  const result = await publishVerifiedRelease({ input: input(), status: status(), ...service }); assert.equal(result.database, 'published');
  assert.equal(service.calls.filter((c) => c === 'github-create').length, 1);
  await assert.rejects(() => publishVerifiedRelease({ input: { ...input(), title: 'Changed' }, status: status(), ...service }), /different release content/);
});
