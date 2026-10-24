// Shared, testable publication checks. This module has no credentials and performs no work on import.
import { releaseRepository } from './repository.mjs';
export const RELEASE_REPOSITORY = releaseRepository();
const plain = (text, max) => typeof text === 'string' && text.trim().length > 0 && text.length <= max && !/[\u0000-\u001f\u007f<>]/.test(text);
export function publicationInput({ release, commit, deploymentUrl }) {
  if (!release || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[a-zA-Z0-9.-]+)?$/.test(release.version) || release.version.length > 60) throw new Error('Release version is invalid.');
  if (!plain(release.title, 120) || !Array.isArray(release.changes) || release.changes.length < 1 || release.changes.length > 20 || release.changes.some((line) => !plain(line, 500))) throw new Error('Release notes must contain short, plain product descriptions.');
  if (typeof release.note !== 'string' || release.note.length > 1024 || /[\u0000-\u001f\u007f<>]/.test(release.note)) throw new Error('Release note is invalid.');
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('A full Git commit is required.');
  let url; try { url = new URL(deploymentUrl); } catch { throw new Error('A verified HTTPS deployment URL is required.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/' || url.hostname.length > 200) throw new Error('Use the public HTTPS deployment origin without credentials or query parameters.');
  const tag = `v${release.version}`, github_url = `https://github.com/${RELEASE_REPOSITORY}/releases/tag/${tag}`;
  return { version: release.version, title: release.title.trim(), changes: release.changes.map((s) => s.trim()), note: release.note.trim(), noteworthy: release.noteworthy === true,
    commit_sha: commit, deployment_url: url.origin, github_url, tag };
}
export function verifyDeployedBuild(status, input) {
  if (status?.format !== 'infinite-island-release-v1' || status.source !== 'build-snapshot' || status.fork !== RELEASE_REPOSITORY || status.commitFull !== input.commit_sha || status.buildVersion !== input.version || status.dirtyCount !== 0) {
    throw new Error('Deployment metadata does not prove this exact clean commit and version. Nothing was published.');
  }
  return true;
}
export function releaseBody(input) {
  return `${input.changes.map((line) => `- ${line}`).join('\n')}\n\n${input.note ? `${input.note}\n\n` : ''}Verified deployment: ${input.deployment_url}\n\nSource commit: ${input.commit_sha}\n`;
}
export function samePublication(row, input) {
  return ['version', 'title', 'note', 'noteworthy', 'commit_sha', 'deployment_url', 'github_url'].every((key) => row?.[key] === input[key]) && JSON.stringify(row?.changes) === JSON.stringify(input.changes);
}
// GitHub and Postgres are separate systems: GitHub completes first; database failure is safely retried with identical inputs.
export async function publishVerifiedRelease({ input, status, github, database, now = () => new Date() }) {
  verifyDeployedBuild(status, input);
  const existing = await database.find(input.version);
  if (existing && !samePublication(existing, input)) throw new Error('This version already identifies different release content. Publish a new version.');
  const body = releaseBody(input);
  const prior = await github.find(input.tag);
  if (prior) {
    if (prior.commit !== input.commit_sha || prior.body !== body || prior.title !== input.title || prior.draft) throw new Error('The GitHub tag or release content conflicts with this commit/version. Nothing was overwritten.');
  } else await github.create(input, body);
  if (!existing) {
    const { tag: _tag, ...row } = input;
    try { await database.insert({ ...row, deployed_at: now().toISOString() }); }
    catch {
      // A concurrent identical insert is successful; any different content remains an error.
      const raced = await database.find(input.version).catch(() => null);
      if (!samePublication(raced, input)) throw new Error('GitHub release exists, but database publication failed. Retry the same verified commit/version to finish; do not delete the release.');
    }
  }
  return { githubUrl: input.github_url, database: 'published', reused: !!existing && !!prior };
}
