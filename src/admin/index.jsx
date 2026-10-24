// Admin controls edit the existing game renderer through the bridge; there is no second game canvas.
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import './admin.css';
import { ComparisonPreview } from './ComparisonPreview.jsx';
import { AdminHelp } from './AdminHelp.jsx';
import { RELEASES, RELEASE_SEEN_KEY, publishedReleaseHistory } from './releases.js';

function ReleaseNotes({ open, onClose, source, onExplore, history, historyStatus }) {
  const dialog = useRef(null);
  const [view, setView] = useState('changes');
  const [page, setPage] = useState(0);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const media = matchMedia('(max-width: 1099px), (max-height: 700px)');
    const update = () => { setCompact(media.matches); setPage(0); };
    update(); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const pageSize = compact ? 3 : 12;
  const latest = RELEASES[0];
  const pages = Math.ceil(latest.changes.length / pageSize);
  const selectView = (next) => { setView(next); setPage(0); };
  useEffect(() => {
    if (open && !dialog.current.open) dialog.current.showModal();
    else if (!open && dialog.current.open) dialog.current.close();
  }, [open]);
  return <dialog ref={dialog} className="island-release-notes" aria-labelledby="island-release-title"
    onCancel={(event) => { event.preventDefault(); onClose(); }} onKeyDown={(event) => event.stopPropagation()}
    onKeyUp={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
    <header><h2 id="island-release-title">What’s new</h2><button type="button" aria-label="Close release notes" onClick={onClose}>×</button></header>
    <nav className="island-release-tabs" aria-label="Release information">
      <button aria-pressed={view === 'changes'} onClick={() => selectView('changes')}>Latest changes</button>
      <button aria-pressed={view === 'build'} onClick={() => selectView('build')}>Running build</button>
      <button aria-pressed={view === 'history'} onClick={() => selectView('history')}>Release history</button>
    </nav>
    {view === 'build' && <section className="island-release-source" aria-label="Running build">
      <strong>{source?.fork || 'Infinite Island'}{source?.branch ? ` (${source.branch})` : ''}</strong>
      <p>{source?.buildDate ? new Date(source.buildDate).toLocaleDateString() : 'Local development'} · {source?.source === 'live-local' ? 'Live local status' : 'Build snapshot'}</p>
      {source?.commitFull && /^[a-f0-9]{40,64}$/.test(source.commitFull) && <a href={`https://github.com/${/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(source.fork || '') ? source.fork : 'alan2quick/InfiniteIsland'}/commit/${source.commitFull}`} target="_blank" rel="noopener noreferrer">View this build’s GitHub commit</a>}
      {source?.dirtyCount > 0 && <p className="island-release-warning">{source.dirtyCount} local file changes are not committed. The GitHub link does not include them.</p>}
      {source?.ahead > 0 && <p className="island-release-warning">{source.ahead} committed change{source.ahead === 1 ? '' : 's'} not pushed.</p>}
      {source?.integrationState === 'unmerged' && <p>Branch changes are not in the last checked fork main branch.</p>}
      {source?.source === 'build-snapshot' && <small>Recorded at build time; later work on your computer is not visible here.</small>}
    </section>}
    {view === 'changes' && [latest].map((release) => <article key={release.version}>
      <span className="island-editor-eyebrow">v{release.version}{source?.branch ? ` (${source.branch})` : ''}</span><h3>{release.title}</h3>
      <ul className="island-release-changes">{release.changes.slice(page * pageSize, (page + 1) * pageSize).map((change) => <li key={change}>{change}</li>)}</ul>
      {release.features?.length > 0 && <div className="island-editor-buttonrow">{release.features.map((feature) => <button type="button" key={feature.key} onClick={() => onExplore(feature.key)}>Find {feature.label}</button>)}</div>}
      {release.note && <p className="island-editor-hint">{release.note}</p>}
    </article>)}
    {view === 'history' && <section aria-label="Published release history">
      <h3>Published release history</h3>
      <p className="island-editor-hint">The notes above describe this running build. Published history is read from the shared database when available.</p>
      {historyStatus === 'loading' && <p role="status">Loading published history…</p>}
      {historyStatus === 'unavailable' && <p>Published history is unavailable. This build’s bundled notes remain available offline.</p>}
      {historyStatus === 'unconfigured' && <p>Connect the database to see published history.</p>}
      {historyStatus === 'ready' && history.length === 0 && <p>No published history for this version or earlier yet.</p>}
      {history.slice(page, page + 1).map((release, index) => <article key={`${release.version}:${index}`}>
        <strong>v{release.version} · {release.title}</strong>
        {release.date && <p><time dateTime={release.date}>{new Date(release.date).toLocaleDateString()}</time></p>}
        <ul>{release.changes.map((change, i) => <li key={i}>{change}</li>)}</ul>
        {release.note && <p>{release.note}</p>}
        {release.github && <p><a href={release.github} target="_blank" rel="noopener noreferrer">GitHub release / commit</a></p>}
        {release.deployment && <p><a href={release.deployment} target="_blank" rel="noopener noreferrer">Published deployment</a></p>}
      </article>)}
    </section>}
    <footer className="island-release-footer">
      {(view === 'changes' ? pages > 1 : view === 'history' && history.length > 1) && <nav aria-label="Release pages">
        <button disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
        <span aria-live="polite">{page + 1} / {view === 'changes' ? pages : history.length}</span>
        <button disabled={page + 1 >= (view === 'changes' ? pages : history.length)} onClick={() => setPage(page + 1)}>Next</button>
      </nav>}
      <button type="button" onClick={onClose}>Got it</button>
    </footer>
  </dialog>;
}

const SECTIONS = [
  { title: 'Light & atmosphere', controls: [
    ['hour', 'Time of day', 0, 24, 0.25], ['dayCycle', 'Let the day change', 'toggle'],
    ['brightness', 'Brightness', 0.5, 1.5, 0.05], ['haze', 'Haze', 0, 1, 0.05],
  ] },
  { title: 'Movement & life', controls: [
    ['breeze', 'Breeze', 0, 1, 0.05], ['water', 'Water movement', 0, 1, 0.05],
    ['butterflies', 'Butterfly activity', 0, 1, 0.05],
  ] },
  { title: 'Sound', controls: [
    ['musicTempo', 'Music tempo', 0.5, 1.5, 0.05], ['musicVolume', 'Music volume', 0, 1, 0.05],
    ['natureVolume', 'Nature volume', 0, 1, 0.05],
  ] },
  { title: 'Camera', controls: [
    ['cameraMode', 'View', 'select', [['original', 'Original view'], ['follow', 'Behind character']]],
    ['cameraAngle', 'Camera angle', 15, 70, 1], ['cameraDistance', 'Camera distance', 5, 24, 0.5],
    ['cameraSmoothness', 'Follow smoothness', 0, 1, 0.05], ['intro', 'Island fly-in on arrival', 'toggle'],
  ] },
];

function formatValue(key, value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  if (key === 'hour') {
    const minutes = Math.round(number * 60) % (24 * 60);
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  }
  if (key === 'cameraAngle') return `${number}°`;
  if (key === 'cameraDistance') return number.toFixed(1);
  return `${Math.round(number * 100)}%`;
}

function Control({ definition, draft, onChange, isNew }) {
  const [key, label, kind, fourth, step] = definition;
  const id = `world-control-${key}`;
  if (kind === 'toggle') return <label className="island-editor-toggle" htmlFor={id}>
    <span>{label} {isNew && <small className="island-feature-new">New</small>}</span><input id={id} type="checkbox" checked={Boolean(draft[key])} onChange={(e) => onChange({ [key]: e.target.checked })} />
  </label>;
  if (kind === 'select') return <div className="island-editor-control">
    <label htmlFor={id}>{label} {isNew && <small className="island-feature-new">New</small>}</label><select id={id} value={draft[key] ?? fourth[0][0]} onChange={(e) => onChange({ [key]: e.target.value })}>
      {fourth.map(([value, text]) => <option value={value} key={value}>{text}</option>)}
    </select>
  </div>;
  return <div className="island-editor-control">
    <label htmlFor={id}><span>{label} {isNew && <small className="island-feature-new">New</small>}</span><output htmlFor={id}>{formatValue(key, draft[key])}</output></label>
    <input id={id} type="range" min={kind} max={fourth} step={step} value={Number.isFinite(Number(draft[key])) ? draft[key] : kind}
      onChange={(e) => onChange({ [key]: Number(e.target.value) })} />
  </div>;
}

export function AdminPanel({ bridge, settingsStore, cloud, adminTools }) {
  const snapshot = useSyncExternalStore(
    (fn) => settingsStore.subscribe(fn), () => settingsStore.getSnapshot(), () => settingsStore.getSnapshot(),
  );
  const [open, setOpen] = useState(true);
  const [notesOpen, setNotesOpen] = useState(false);
  const [releaseSource, setReleaseSource] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyStatus, setHistoryStatus] = useState('unconfigured');
  const historyRequest = useRef(null);
  useEffect(() => {
    if (!open || !cloud?.readPublishedReleases) return;
    let stopped = false;
    setHistoryStatus('loading');
    historyRequest.current ||= Promise.resolve().then(() => cloud.readPublishedReleases())
      .then((rows) => ({ rows: publishedReleaseHistory(rows), status: 'ready' }))
      .catch(() => ({ rows: [], status: 'unavailable' }));
    historyRequest.current.then((result) => { if (!stopped) { setHistory(result.rows); setHistoryStatus(result.status); } });
    return () => { stopped = true; };
  }, [open, cloud]);
  const [seenFeatures, setSeenFeatures] = useState(() => {
    try { return JSON.parse(localStorage.getItem('infiniteIsland.adminFeaturesSeen.v1') || '{}') || {}; } catch { return {}; }
  });
  function markFeatureSeen(key) {
    setSeenFeatures((previous) => {
      const next = { ...previous, [`${RELEASES[0].version}:${key}`]: true };
      try { localStorage.setItem('infiniteIsland.adminFeaturesSeen.v1', JSON.stringify(next)); } catch { /* Session only. */ }
      return next;
    });
  }
  function exploreFeature(key) {
    dismissNotes(); markFeatureSeen(key);
    requestAnimationFrame(() => {
      const input = document.getElementById(`world-control-${key}`);
      const category = input?.closest('details.island-editor-section');
      if (category) category.open = true;
      input?.scrollIntoView({ block: 'center', behavior: 'instant' }); input?.focus({ preventScroll: true });
    });
  }
  useEffect(() => {
    if (!open) return;
    let stopped = false;
    async function refreshSource() {
      for (const url of ['/api/release-status', '/generated/release-status.json']) {
        try {
          const response = await fetch(url, { cache: 'no-store' });
          if (!response.ok) continue;
          const data = await response.json();
          if (data.format !== 'infinite-island-release-v1') continue;
          if (!stopped) setReleaseSource(data);
          return;
        } catch { /* Static deployments use the build snapshot fallback. */ }
      }
    }
    refreshSource();
    const timer = setInterval(refreshSource, 30000);
    return () => { stopped = true; clearInterval(timer); };
  }, [open]);
  const seenThisSession = useRef(false);
  useEffect(() => {
    if (!open || seenThisSession.current) return;
    seenThisSession.current = true;
    const latest = RELEASES.find((release) => release.noteworthy);
    if (!latest) return;
    let seen = null;
    try { seen = localStorage.getItem(RELEASE_SEEN_KEY); } catch { /* Session-only when storage is blocked. */ }
    if (seen !== latest.version) setNotesOpen(true);
  }, [open]);
  function dismissNotes() {
    setNotesOpen(false);
    try { localStorage.setItem(RELEASE_SEEN_KEY, RELEASES.find((release) => release.noteworthy)?.version || ''); } catch { /* Session-only. */ }
  }
  const [viewport, setViewport] = useState('desktop');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const fileInput = useRef(null), launchButton = useRef(null), closeButton = useRef(null);
  const draft = snapshot.draft || {};
  const capabilities = bridge.getCapabilities?.() || {};

  useEffect(() => {
    bridge.setEditorOpen?.(open);
    if (open) { settingsStore.restoreDraft?.(); closeButton.current?.focus(); }
    return () => { bridge.setEditorOpen?.(false); };
  }, [open, bridge]);
  useEffect(() => () => { bridge.setViewport?.('desktop'); }, [bridge]);
  useEffect(() => {
    bridge.setComparisonOpen?.(open && viewport === 'all');
    return () => bridge.setComparisonOpen?.(false);
  }, [open, viewport, bridge]);

  async function run(action, success) {
    if (pending || !action) return;
    setPending(true); setMessage('');
    try { const result = await action(); if (result?.error) throw result.error; if (success) setMessage(success); }
    catch (error) { setMessage(error?.message || 'That change could not be saved. Please try again.'); }
    finally { setPending(false); }
  }
  function close() { setPassword(''); setOpen(false); requestAnimationFrame(() => launchButton.current?.focus()); }
  function changeViewport(value) { setViewport(value); bridge.setViewport?.(value === 'all' ? 'desktop' : value); }
  function exportSettings() {
    run(async () => {
      const data = await settingsStore.exportSettings?.();
      if (data == null) return;
      const blob = data instanceof Blob ? data : new Blob([typeof data === 'string' ? data : JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = 'infinite-island-world.json'; document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'Settings exported.');
  }

  return <div className={`island-editor-root${viewport === 'all' ? ' island-editor-comparing' : ''}`}>
    {open && viewport === 'all' && <ComparisonPreview settings={draft} />}
    {!open && <button ref={launchButton} className="island-editor-launch" type="button" aria-expanded={false} aria-controls="island-world-editor" onClick={() => setOpen(true)}><span aria-hidden="true">‹</span><span>World editor<small>Admin tools</small></span></button>}
    {open && <aside id="island-world-editor" className="island-editor" aria-label="World editor" aria-busy={pending}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); close(); } }} onKeyUp={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      <header className="island-editor-header"><div><span className="island-editor-eyebrow">Admin tools · Infinite Island</span><h1>World editor</h1><span className="island-editor-live">Live preview</span></div>
        <button ref={closeButton} className="island-editor-close" type="button" onClick={close} title="Collapse world editor" aria-label="Collapse world editor" aria-expanded={true} aria-controls="island-world-editor">›</button>
      </header>
      <div className="island-editor-scroll">
        <button type="button" className="island-release-link" onClick={() => setNotesOpen(true)}>What’s new · v{RELEASES[0].version}{releaseSource?.branch ? ` (${releaseSource.branch})` : ''}</button>
        {(releaseSource?.dirtyCount > 0 || releaseSource?.ahead > 0) && <p className="island-release-warning">Local changes haven’t all reached GitHub. Open What’s new for details.</p>}
        <p className="island-editor-hint">Try changes live. Your preview stays on this screen until you publish.</p>
        <fieldset className="island-editor-viewport"><legend>Preview screen</legend>
          { [['desktop', 'Desktop'], ['mobile-portrait', 'Mobile'], ['mobile-landscape', 'Mobile wide'], ['all', 'All views']].map(([value, text]) =>
            <button key={value} type="button" aria-pressed={viewport === value} onClick={() => changeViewport(value)}>{text}</button>) }
        </fieldset>
        {SECTIONS.map((section) => ({ ...section, controls: section.controls.filter(([key]) => capabilities[key] !== false) })).filter((section) => section.controls.length).map((section) => <details className="island-editor-section" key={section.title}>
          <summary>{section.title}</summary>{section.controls.map((definition) => <Control key={definition[0]} definition={definition} draft={draft}
            isNew={RELEASES[0].features?.some((feature) => feature.key === definition[0]) && !seenFeatures[`${RELEASES[0].version}:${definition[0]}`]}
            onChange={(patch) => { setMessage(''); markFeatureSeen(definition[0]); settingsStore.preview?.(patch); }} />)}
        </details>)}
        <AdminHelp tools={adminTools} comparing={viewport === 'all'} />
        <details className="island-editor-section">
          <summary>Save & share</summary>
          <p className="island-editor-hint">{snapshot.configured ? (snapshot.isAdmin ? 'You can publish these settings for everyone.' : 'An admin account is needed to publish. You can still preview and export.') : 'Local preview is ready. Connect the world database to publish shared settings.'}</p>
          <div className="island-editor-buttonrow"><button type="button" onClick={exportSettings} disabled={pending}>Export</button>
            <button type="button" onClick={() => fileInput.current?.click()} disabled={pending}>Import</button></div>
          <input className="island-editor-file" ref={fileInput} type="file" accept="application/json,.json" aria-label="Import world settings" onChange={(e) => {
            const file = e.target.files?.[0]; e.target.value = '';
            if (file) run(() => settingsStore.importSettings?.(file), 'Settings imported into your preview.');
          }} />
          {snapshot.configured && (snapshot.user ? <div className="island-editor-account"><p>Signed in{snapshot.isAdmin ? ' as an admin' : ''}.</p>
            <button type="button" disabled={pending} onClick={() => run(() => cloud?.signOut?.(), 'Signed out.')}>Sign out</button></div>
            : <details className="island-editor-login"><summary>Admin sign-in</summary><form onSubmit={(e) => { e.preventDefault(); run(async () => { const result = await cloud?.signIn?.(email.trim(), password); if (result?.error) throw result.error; setPassword(''); }, 'Signed in.'); }}>
              <label htmlFor="world-editor-email">Email</label><input id="world-editor-email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
              <label htmlFor="world-editor-password">Password</label><input id="world-editor-password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
              <button type="submit" disabled={pending || !cloud?.signIn}>Sign in</button>
            </form></details>)}
          <button type="button" className="island-editor-restore" disabled={pending} onClick={() => {
            if (window.confirm('Reset settings to this version’s defaults in your private preview? This will not publish anything.')) run(() => settingsStore.reset?.(), 'Settings reset to defaults in your private preview.');
          }}>Reset settings to defaults</button>
        </details>
      </div>
      <footer className="island-editor-footer">
        <div className="island-editor-status" role="status" aria-live="polite">{message || (snapshot.error ? String(snapshot.error.message || snapshot.error) : '') || (pending ? 'Working…' : snapshot.dirty ? 'Unpublished preview' : snapshot.status || 'No unpublished changes')}</div>
        <small>{adminTools?.isSandbox ? 'Temporary sandbox · Changes discarded · Publishing disabled' : snapshot.configured ? (snapshot.isAdmin ? 'Database connected · Admin publishing enabled' : 'Database connected · Admin sign-in needed to publish') : 'Local preview · Database not connected'}</small>
        {snapshot.revision != null && <small>Saved revision {snapshot.revision}</small>}
        <div className="island-editor-buttonrow"><button type="button" disabled={pending || !snapshot.dirty} onClick={() => run(() => settingsStore.discard?.(), 'Preview discarded.')}>Discard</button>
          <button type="button" disabled={pending} onClick={() => run(() => settingsStore.undo?.(), 'Previous settings restored in preview.')}>Undo</button>
          <button type="button" className="island-editor-publish" disabled={pending || !snapshot.isAdmin || !snapshot.dirty}
            title={snapshot.isAdmin ? 'Save these settings for everyone' : 'Sign in as an admin to publish'} onClick={() => run(async () => { await settingsStore.publish?.(); const result = settingsStore.getSnapshot(); if (result.error) throw new Error(result.error); }, 'Published for everyone.')}>Publish</button>
        </div>
      </footer>
    </aside>}
    <ReleaseNotes open={open && notesOpen} onClose={dismissNotes} source={releaseSource} onExplore={exploreFeature} history={history} historyStatus={historyStatus} />
  </div>;
}

/** Root decides when this editor is offered (admin query or an authenticated admin). */
export function mountAdmin({ bridge = {}, settingsStore, cloud = null, adminTools = null, container = null }) {
  if (!settingsStore?.getSnapshot || !settingsStore?.subscribe) throw new Error('The world settings service is unavailable.');
  const host = container || document.createElement('div');
  if (!container) document.body.appendChild(host);
  const root = createRoot(host);
  root.render(<AdminPanel bridge={bridge} settingsStore={settingsStore} cloud={cloud} adminTools={adminTools} />);
  return { unmount() { root.unmount(); if (!container) host.remove(); } };
}
