// Editor release notes are independent of the optional game-presentation changes.
export const RELEASES = [{ version: '0.82.3', title: 'World editor preview', noteworthy: false,
  features: [], changes: ['Preview supported world settings without changing shared progress.', 'Compare desktop, portrait and landscape views in isolated muted renderers.', 'Publish validated settings through administrator-only database access.', 'Export private settings and review revision history.'],
  note: 'Only controls supported by this game build are shown. Optional camera, audio and wildlife adapters can be added independently.' }];
export const RELEASE_SEEN_KEY = 'infiniteIsland.editorReleaseSeen.v1';

export function publishedReleaseHistory(rows, currentVersion = RELEASES[0].version) {
  const versionParts = (value) => typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value) ? value.split('.').map(Number) : null;
  const current = versionParts(currentVersion);
  const safeLink = (value) => {
    try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; }
  };
  return (Array.isArray(rows) ? rows : []).slice(0, 20).flatMap((row) => {
    const version = versionParts(row?.version);
    if (!current || !version) return [];
    let compare = 0;
    for (let i = 0; i < 3; i++) if (version[i] !== current[i]) { compare = version[i] - current[i]; break; }
    if (compare > 0) return []; // A different deployment must not announce features in this running build.
    const text = (value, length) => typeof value === 'string' ? value.slice(0, length) : '';
    const date = row.deployed_at || row.published_at;
    return [{ version: row.version, title: text(row.title, 160),
      changes: (Array.isArray(row.changes) ? row.changes : []).filter((v) => typeof v === 'string').slice(0, 30).map((v) => v.slice(0, 1000)),
      note: text(row.note, 1500), date: typeof date === 'string' && Number.isFinite(Date.parse(date)) ? new Date(date).toISOString() : null,
      github: safeLink(row.github_url) || (/^[a-f0-9]{40,64}$/.test(row.commit_sha || '') ? null : null),
      deployment: safeLink(row.deployment_url),
    }];
  });
}
