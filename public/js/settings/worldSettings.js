// Serializable environment settings. No player progress or credentials belong here.
export const SETTING_RULES = Object.freeze({
  hour: [0, 24, 8], brightness: [0.5, 1.5, 1], haze: [0, 1, 0.25],
  breeze: [0, 1, 0.5], water: [0, 1, 0.5], butterflies: [0, 1, 0.3],
  musicTempo: [0.5, 1.5, 0.8], musicVolume: [0, 1, 0.3], natureVolume: [0, 1, 1],
  cameraAngle: [15, 70, 45], cameraDistance: [5, 24, 16], cameraSmoothness: [0, 1, 0.65],
});
export const DEFAULT_WORLD_SETTINGS = Object.freeze({
  ...Object.fromEntries(Object.entries(SETTING_RULES).map(([key, rule]) => [key, rule[2]])),
  dayCycle: true, intro: true, cameraMode: 'original',
});
export function validateSettings(input, { partial = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Settings must be an object.');
  const output = {};
  for (const [key, value] of Object.entries(input)) {
    if (!Object.hasOwn(DEFAULT_WORLD_SETTINGS, key)) throw new Error(`Unknown setting: ${key}`);
    const rule = SETTING_RULES[key];
    if (rule) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < rule[0] || value > rule[1]) throw new Error(`Invalid setting: ${key}`);
    } else if (key === 'cameraMode') {
      if (!['original', 'follow'].includes(value)) throw new Error('Unknown camera mode.');
    } else if (typeof value !== 'boolean') throw new Error(`Invalid setting: ${key}`);
    output[key] = value;
  }
  if (!partial && Object.keys(output).length !== Object.keys(DEFAULT_WORLD_SETTINGS).length) throw new Error('Settings file is incomplete.');
  return output;
}
const same = (a, b) => Object.keys(DEFAULT_WORLD_SETTINGS).every((key) => a[key] === b[key]);
const CACHE_KEY = 'infiniteIsland.worldSettings.v1';
const DRAFT_KEY = 'infiniteIsland.adminDraft.v1';

export function createSettingsStore({ cloud = null, storage, apply = () => {} } = {}) {
  // Accessing localStorage itself can throw (privacy modes), before getItem runs.
  if (storage === undefined) { try { storage = globalThis.localStorage; } catch { storage = null; } }
  let initial = { ...DEFAULT_WORLD_SETTINGS };
  try { const saved = JSON.parse(storage?.getItem(CACHE_KEY) || 'null'); if (saved) initial = validateSettings(saved); } catch { /* Defaults survive blocked or invalid storage. */ }
  let state = { draft: initial, published: initial, revision: 0, dirty: false, configured: !!cloud?.configured, isAdmin: false, user: null, status: 'ready', error: null };
  let previewing = false, pendingPublish = false, acceptedRevision = null, authGeneration = 0, started;
  const listeners = new Set();
  const notify = (patch) => { state = { ...state, ...patch }; for (const listener of listeners) listener(); };
  const cache = (key, settings) => { try { storage?.setItem(key, JSON.stringify(settings)); } catch { /* Editor still works without local persistence. */ } };
  const clearDraft = () => { try { storage?.removeItem(DRAFT_KEY); } catch { /* Only this editor's draft is touched. */ } };
  const fail = (error) => { notify({ status: 'error', error: error?.message || 'Settings unavailable.' }); };
  const publicMeta = () => ({ preview: false, ...(acceptedRevision === null ? {} : { revision: acceptedRevision }) });
  const accept = (row) => {
    if (!row) return false;
    const rawRevision = row.revision;
    const revision = typeof rawRevision === 'number' || (typeof rawRevision === 'string' && /^\d+$/.test(rawRevision)) ? Number(rawRevision) : NaN;
    if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('Invalid world settings revision.');
    // A delayed load/response must never roll back a more recent realtime event,
    // and duplicate events must not reset the running day/night clock.
    if (acceptedRevision !== null && revision <= acceptedRevision) return false;
    const published = validateSettings(row.settings);
    const wasPreviewing = previewing;
    const keepDraft = previewing && state.dirty && !same(state.draft, published);
    previewing = keepDraft;
    acceptedRevision = revision;
    notify({ published, revision, ...(keepDraft ? { dirty: true } : { draft: published, dirty: false }), status: keepDraft ? 'World updated; your draft is still private.' : 'ready', error: null });
    cache(CACHE_KEY, published);
    // Public loads never remove a private draft left by an earlier editor session.
    if (wasPreviewing && !keepDraft) clearDraft();
    if (!keepDraft) apply(published, publicMeta());
    return true;
  };
  const store = {
    getSnapshot: () => state,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    preview(patch) {
      const draft = validateSettings({ ...state.draft, ...validateSettings(patch, { partial: true }) });
      previewing = true;
      cache(DRAFT_KEY, draft);
      notify({ draft, dirty: !same(draft, state.published), error: null });
      apply(draft, { preview: true });
    },
    // Call only when an authenticated admin intentionally opens the editor.
    // A public game load never applies saved private editor settings.
    restoreDraft() {
      if (!state.isAdmin) return false;
      try {
        const draft = JSON.parse(storage?.getItem(DRAFT_KEY) || 'null');
        if (!draft) return false;
        store.preview(validateSettings(draft));
        return true;
      } catch { return false; }
    },
    discard() { previewing = false; clearDraft(); notify({ draft: state.published, dirty: false, error: null }); apply(state.published, publicMeta()); },
    reset() { store.preview(DEFAULT_WORLD_SETTINGS); },
    async publish() {
      if (pendingPublish) return;
      if (!state.isAdmin || !cloud?.configured) { fail(new Error('Sign in with a world admin account to publish.')); return; }
      pendingPublish = true;
      const submitted = { ...state.draft }, expectedRevision = state.revision;
      notify({ status: 'publishing', error: null });
      try {
        const row = await cloud.publish(submitted, expectedRevision);
        if (!row) throw new Error('Publish returned no settings.');
        // accept compares the CURRENT draft to the server result: edits made
        // during the request stay private instead of being replaced by submitted.
        accept(row);
        if (state.status === 'publishing') notify({ status: state.dirty ? 'World updated; your draft is still private.' : 'ready', error: null });
      } catch (error) { fail(error); } finally { pendingPublish = false; }
    },
    async undo() {
      if (!state.isAdmin || !cloud?.configured) return;
      try { const previous = await cloud.previous(state.revision); if (!previous) throw new Error('No earlier revision.'); store.preview(previous.settings); await store.publish(); } catch (error) { fail(error); }
    },
    exportSettings() { return JSON.stringify({ format: 'infinite-island-world-v1', settings: state.draft }, null, 2); },
    async importSettings(file) {
      if (!file || typeof file.text !== 'function' || file.size > 16384) throw new Error('Settings file is too large or unreadable.');
      const text = await file.text();
      if (typeof text !== 'string' || new TextEncoder().encode(text).byteLength > 16384) throw new Error('Settings file is too large.');
      const value = JSON.parse(text);
      if (value && Object.hasOwn(value, 'settings')) {
        if (value.format !== undefined && value.format !== 'infinite-island-world-v1') throw new Error('Unknown settings file format.');
        store.preview(validateSettings(value.settings));
      } else store.preview(validateSettings(value));
    },
    async refresh() { if (!cloud?.configured) return; try { accept(await cloud.load()); } catch (error) { fail(error); } },
    start() {
      if (started) return started;
      started = (async () => {
        apply(initial, { preview: false });
        if (!cloud?.configured) return;
        try {
          cloud.onAuth(async (user) => {
            const generation = ++authGeneration;
            const previousUser = state.user;
            const changedIdentity = previousUser?.id !== user?.id;
            // Drop privileges immediately while a lookup is pending. A late
            // lookup for an old identity cannot re-enable admin after sign-out.
            notify({ user, isAdmin: false });
            if (previousUser && changedIdentity && previewing) {
              previewing = false;
              notify({ draft: state.published, dirty: false });
              apply(state.published, publicMeta());
            }
            let isAdmin = false;
            try { isAdmin = !!user && await cloud.isAdmin(user.id); } catch { /* Deny publishing on lookup failure. */ }
            if (generation === authGeneration) notify({ isAdmin });
          });
          cloud.onSettings((row) => { try { accept(row); } catch (error) { fail(error); } });
          await store.refresh();
        } catch (error) { fail(error); }
      })();
      return started;
    },
  };
  return store;
}
