// Persistent environment settings must never overwrite saves or leak a private
// editor draft into a public scene. Deferred requests exercise real race ordering.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSettingsStore, validateSettings, DEFAULT_WORLD_SETTINGS as defaults, SETTING_RULES } from '../public/js/settings/worldSettings.js';

const CACHE = 'infiniteIsland.worldSettings.v1', DRAFT = 'infiniteIsland.adminDraft.v1';
const settings = patch => ({ ...defaults, ...patch });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function memory(entries = []) {
  const data = new Map(entries), touched = [];
  return { data, touched, getItem: key => data.get(key) ?? null,
    setItem(key, value) { touched.push(key); data.set(key, value); },
    removeItem(key) { touched.push(key); data.delete(key); },
    clear() { assert.fail('World settings must never clear browser storage'); } };
}
async function rig({ storage = memory(), load = async () => ({ settings: settings(), revision: 0 }) } = {}) {
  let receive, auth;
  const applied = [], publishes = [];
  const cloud = { configured: true, load, onAuth(fn) { auth = fn; }, onSettings(fn) { receive = fn; },
    async isAdmin(id) { return id === 'admin'; },
    async publish(value, revision) { publishes.push({ value, revision }); return { settings: value, revision: revision + 1 }; },
    async previous() { return { settings: settings(), revision: 0 }; } };
  const store = createSettingsStore({ cloud, storage, apply(value, metadata) { applied.push({ value, metadata }); } });
  await store.start();
  return { store, cloud, storage, applied, publishes, emit: row => receive(row), auth: user => auth(user) };
}

test('settings validator requires the exact schema and numeric boundaries without coercion', () => {
  assert.deepEqual(validateSettings(defaults), defaults);
  for (const [key, [low, high]] of Object.entries(SETTING_RULES)) {
    for (const value of [low, high]) assert.equal(validateSettings(settings({ [key]: value }))[key], value);
    for (const value of [low - 0.01, high + 0.01, NaN, Infinity, -Infinity, String(low), null, true]) {
      assert.throws(() => validateSettings(settings({ [key]: value })), /Invalid setting/);
    }
  }
  for (const key of Object.keys(defaults)) { const value = settings(); delete value[key]; assert.throws(() => validateSettings(value), /incomplete/); }
  for (const value of [null, [], 'text', 1]) assert.throws(() => validateSettings(value));
  assert.throws(() => validateSettings(settings({ surprise: true })), /Unknown setting/);
  assert.throws(() => validateSettings(settings({ cameraMode: 'free' })), /camera mode/);
  assert.throws(() => validateSettings(settings({ dayCycle: 1 })), /Invalid setting/);
  assert.deepEqual(validateSettings({ hour: 10 }, { partial: true }), { hour: 10 });
});

test('public startup uses cached publication, never a saved private draft or player progress', async () => {
  const storage = memory([[CACHE, JSON.stringify(settings({ brightness: 0.8 }))], [DRAFT, JSON.stringify(settings({ brightness: 1.4 }))], ['island.playerProgress', 'precious-save']]);
  const r = await rig({ storage });
  assert.equal(r.applied[0].value.brightness, 0.8);
  assert.deepEqual(r.applied[0].metadata, { preview: false });
  assert.deepEqual(r.applied[1].metadata, { preview: false, revision: 0 });
  assert.equal(r.store.restoreDraft(), false);
  assert.equal(storage.data.get('island.playerProgress'), 'precious-save');
  assert.ok(storage.data.has(DRAFT), 'loading the published row preserves a saved draft');
  await r.auth({ id: 'admin' });
  assert.equal(r.store.getSnapshot().draft.brightness, 1, 'sign-in alone never restores a draft');
  assert.equal(r.store.restoreDraft(), true);
  assert.equal(r.applied.at(-1).value.brightness, 1.4);
  assert.equal(r.applied.at(-1).metadata.preview, true);
  r.store.discard();
  assert.equal(storage.data.get('island.playerProgress'), 'precious-save');
  assert.equal(storage.data.has(DRAFT), false);
  assert.ok(storage.touched.every(key => [CACHE, DRAFT].includes(key)));
});

test('a private preview survives newer public realtime; discard applies latest revision metadata', async () => {
  const r = await rig();
  r.store.preview({ hour: 18 });
  const previousApplies = r.applied.length;
  r.emit({ settings: settings({ hour: 10 }), revision: 1 });
  assert.equal(r.store.getSnapshot().published.hour, 10);
  assert.equal(r.store.getSnapshot().draft.hour, 18);
  assert.equal(r.applied.length, previousApplies, 'private view is not overwritten');
  assert.equal(JSON.parse(r.storage.data.get(CACHE)).hour, 10);
  r.store.discard();
  assert.equal(r.applied.at(-1).value.hour, 10);
  assert.deepEqual(r.applied.at(-1).metadata, { preview: false, revision: 1 });
});

test('out-of-order and duplicate events cannot regress configuration or restart its clock', async () => {
  const r = await rig();
  r.emit({ settings: settings({ hour: 15 }), revision: '3' });
  const appliedCount = r.applied.length;
  r.emit({ settings: settings({ hour: 8 }), revision: 2 });
  r.emit({ settings: settings({ hour: 9 }), revision: 3 });
  assert.equal(r.applied.length, appliedCount);
  assert.equal(r.store.getSnapshot().published.hour, 15);
  assert.equal(r.store.getSnapshot().revision, 3);
  r.emit({ settings: settings(), revision: NaN });
  assert.match(r.store.getSnapshot().error, /revision/);
  assert.equal(r.store.getSnapshot().revision, 3);
});

test('late initial fetch cannot overwrite a newer realtime publication', async () => {
  const response = deferred(); let receive;
  const applied = [];
  const store = createSettingsStore({ storage: memory(), cloud: { configured: true, onAuth() {}, onSettings(fn) { receive = fn; }, load: () => response.promise }, apply: value => applied.push(value) });
  const started = store.start();
  receive({ settings: settings({ haze: 0.8 }), revision: 2 });
  response.resolve({ settings: settings({ haze: 0.1 }), revision: 0 });
  await started;
  assert.equal(store.getSnapshot().draft.haze, 0.8);
  assert.equal(applied.at(-1).haze, 0.8);
});

test('publishing preserves edits made during the request and submits the captured expected revision', async () => {
  const r = await rig(); await r.auth({ id: 'admin' });
  const response = deferred(), calls = [];
  r.cloud.publish = (value, revision) => { calls.push({ value, revision }); return response.promise; };
  r.store.preview({ brightness: 1.2 });
  const pending = r.store.publish();
  await r.store.publish();
  assert.equal(calls.length, 1, 'duplicate clicks do not duplicate requests');
  r.store.preview({ brightness: 1.4 });
  response.resolve({ settings: settings({ brightness: 1.2 }), revision: 1 });
  await pending;
  assert.equal(calls[0].revision, 0);
  assert.equal(calls[0].value.brightness, 1.2);
  assert.equal(r.store.getSnapshot().published.brightness, 1.2);
  assert.equal(r.store.getSnapshot().draft.brightness, 1.4);
  assert.equal(r.store.getSnapshot().dirty, true);
  assert.equal(r.applied.at(-1).value.brightness, 1.4);
  assert.equal(JSON.parse(r.storage.data.get(DRAFT)).brightness, 1.4);
});

test('realtime confirmation before the RPC reply does not lose a subsequent edit or roll back a newer revision', async () => {
  const r = await rig(); await r.auth({ id: 'admin' });
  const response = deferred(); r.cloud.publish = () => response.promise;
  r.store.preview({ haze: 0.5 }); const pending = r.store.publish();
  r.emit({ settings: settings({ haze: 0.5 }), revision: 1 });
  assert.equal(r.store.getSnapshot().dirty, false);
  r.store.preview({ haze: 0.7 });
  r.emit({ settings: settings({ haze: 0.9 }), revision: 2 });
  response.resolve({ settings: settings({ haze: 0.5 }), revision: 1 }); await pending;
  assert.equal(r.store.getSnapshot().published.haze, 0.9);
  assert.equal(r.store.getSnapshot().draft.haze, 0.7);
  assert.equal(r.store.getSnapshot().revision, 2);
});

test('successful publish clears only its own draft and applies server revision once', async () => {
  const r = await rig(); await r.auth({ id: 'admin' });
  r.store.preview({ hour: 9 }); await r.store.publish();
  assert.equal(r.store.getSnapshot().dirty, false);
  assert.equal(r.storage.data.has(DRAFT), false);
  assert.deepEqual(r.applied.at(-1).metadata, { preview: false, revision: 1 });
  const appliedCount = r.applied.length;
  r.emit({ settings: settings({ hour: 9 }), revision: 1 });
  assert.equal(r.applied.length, appliedCount);
});

test('nonadmins cannot publish; a delayed membership lookup cannot restore access after sign-out', async () => {
  const r = await rig(); r.store.preview({ hour: 11 }); await r.store.publish();
  assert.equal(r.publishes.length, 0);
  assert.match(r.store.getSnapshot().error, /admin/);
  const permission = deferred(); r.cloud.isAdmin = () => permission.promise;
  const signingIn = r.auth({ id: 'admin' });
  await r.auth(null); permission.resolve(true); await signingIn;
  assert.equal(r.store.getSnapshot().isAdmin, false);
  assert.equal(r.store.getSnapshot().user, null);
  await r.store.publish(); assert.equal(r.publishes.length, 0);
});

test('signing in to publish preserves a preview deliberately made before login', async () => {
  const r = await rig(); r.store.preview({ hour: 21 });
  await r.auth({ id: 'admin' });
  assert.equal(r.store.getSnapshot().draft.hour, 21);
  assert.equal(r.store.getSnapshot().dirty, true);
  await r.store.publish();
  assert.equal(r.publishes[0].value.hour, 21);
});

test('signing out hides a private preview while preserving it for intentional later restoration', async () => {
  const r = await rig(); await r.auth({ id: 'admin' }); r.store.preview({ hour: 22 });
  await r.auth(null);
  assert.equal(r.applied.at(-1).value.hour, defaults.hour);
  assert.equal(r.store.getSnapshot().dirty, false);
  assert.equal(JSON.parse(r.storage.data.get(DRAFT)).hour, 22);
  assert.equal(r.store.restoreDraft(), false);
});

test('offline reads and publish conflicts preserve the usable scene and private work', async () => {
  const storage = memory([[CACHE, JSON.stringify(settings({ water: 0.8 }))]]);
  const r = await rig({ storage, load: async () => { throw new Error('Offline'); } });
  assert.equal(r.applied.at(-1).value.water, 0.8);
  assert.match(r.store.getSnapshot().error, /Offline/);
  await r.auth({ id: 'admin' }); r.store.preview({ water: 0.9 });
  r.cloud.publish = async () => { throw new Error('World settings changed; reload before publishing'); };
  await r.store.publish();
  assert.equal(r.store.getSnapshot().draft.water, 0.9);
  assert.equal(r.store.getSnapshot().dirty, true);
  assert.match(r.store.getSnapshot().error, /reload/);
});

test('blocked storage and malformed caches fall back safely without touching gameplay saves', async () => {
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  const store = createSettingsStore({ storage: blocked });
  await store.start(); store.preview({ hour: 12 }); store.discard();
  assert.equal(store.getSnapshot().draft.hour, defaults.hour);
  const bad = await rig({ storage: memory([[CACHE, '{bad json']]) });
  assert.equal(bad.store.getSnapshot().published.hour, defaults.hour);
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('denied'); } });
  try { assert.doesNotThrow(() => createSettingsStore()); }
  finally { if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor); else delete globalThis.localStorage; }
});

test('import enforces actual byte caps, format and full schema before applying; export round-trips', async () => {
  const r = await rig(); r.store.preview({ musicTempo: 0.6 });
  const exported = r.store.exportSettings();
  r.store.discard();
  await r.store.importSettings({ size: exported.length, text: async () => exported });
  assert.equal(r.store.getSnapshot().draft.musicTempo, 0.6);
  const appliedCount = r.applied.length;
  for (const file of [
    { size: 16385, text: async () => exported },
    { size: 1, text: async () => ' '.repeat(16385) },
    { size: 1, text: async () => 'é'.repeat(9000) },
    { size: 1, text: async () => JSON.stringify({ format: 'other', settings: settings() }) },
    { size: 1, text: async () => '{broken' },
    { size: 1, text: async () => JSON.stringify({ hour: 8 }) },
  ]) await assert.rejects(r.store.importSettings(file));
  assert.equal(r.applied.length, appliedCount);
  assert.equal(r.store.getSnapshot().draft.musicTempo, 0.6);
});

test('start is idempotent and undo republishes history against the current revision', async () => {
  const r = await rig(); const appliedCount = r.applied.length;
  await r.store.start(); assert.equal(r.applied.length, appliedCount);
  await r.auth({ id: 'admin' });
  r.emit({ settings: settings({ hour: 20 }), revision: 4 });
  await r.store.undo();
  assert.equal(r.publishes[0].revision, 4);
  assert.deepEqual(r.publishes[0].value, defaults);
  assert.equal(r.store.getSnapshot().revision, 5);
});
