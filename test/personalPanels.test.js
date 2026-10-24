import test from 'node:test';
import assert from 'node:assert/strict';
import { createPersonalPanels } from '../public/js/ui/personalPanels.js';

function rig(loadProfile) {
  const profile = { isOpen: false, opens: 0, open() { this.isOpen = true; this.opens++; }, close() { this.isOpen = false; } };
  const bag = { isOpen: false, activeTab: 'bag', close() { this.isOpen = false; }, openTab(tab) { this.activeTab = tab; this.isOpen = true; } };
  let blocked = false, error = null, loads = 0;
  const panels = createPersonalPanels({ bagPanel: bag, loadProfile: async () => { loads++; return loadProfile ? await loadProfile(profile) : profile; }, blockProfile: (value) => { blocked = value; }, onError: (value) => { error = value; } });
  return { panels, bag, profile, get blocked() { return blocked; }, get error() { return error; }, get loads() { return loads; } };
}
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

test('repeated Bag → Journal → Profile switching leaves exactly one panel and a repeated button closes it', async () => {
  const r = rig();
  for (let i = 0; i < 12; i++) {
    await r.panels.toggle('bag'); assert.equal(r.panels.active, 'bag'); assert.equal(r.profile.isOpen, false);
    await r.panels.toggle('journal'); assert.equal(r.panels.active, 'journal'); assert.equal(r.bag.activeTab, 'journal');
    await r.panels.toggle('profile'); assert.equal(r.panels.active, 'profile'); assert.equal(r.bag.isOpen, false); assert.equal(r.blocked, true);
    await r.panels.toggle('profile'); assert.equal(r.panels.active, null); assert.equal(r.blocked, false);
    await r.panels.toggle('journal'); await r.panels.toggle('journal'); assert.equal(r.panels.active, null);
    await r.panels.toggle('bag'); await r.panels.toggle('bag'); assert.equal(r.panels.active, null);
  }
});

test('leaving a loading Profile for Journal prevents a late profile overlay from opening', async () => {
  const d = deferred(), r = rig(async (profile) => { await d.promise; return profile; });
  const opening = r.panels.toggle('profile');
  assert.equal(r.panels.active, 'profile');
  await r.panels.toggle('journal'); assert.equal(r.panels.active, 'journal'); assert.equal(r.blocked, false);
  d.resolve(); await opening;
  assert.equal(r.profile.opens, 0); assert.equal(r.panels.active, 'journal');
});

test('clicking a pending Profile again cancels it, and rapid reopening shares one pending import', async () => {
  const d = deferred(), r = rig(async (profile) => { await d.promise; return profile; });
  const first = r.panels.toggle('profile'); await r.panels.toggle('profile');
  assert.equal(r.panels.active, null);
  const last = r.panels.toggle('profile'); d.resolve(); await Promise.all([first, last]);
  assert.equal(r.loads, 1); assert.equal(r.profile.opens, 1); assert.equal(r.panels.active, 'profile');
});

test('external close and bag tab changes are observed; profile failure releases the game and permits retry', async () => {
  const r = rig(); await r.panels.toggle('bag'); r.bag.activeTab = 'journal';
  assert.equal(r.panels.active, 'journal'); await r.panels.toggle('bag'); assert.equal(r.bag.activeTab, 'bag');
  await r.panels.toggle('profile'); r.profile.close(); assert.equal(r.panels.active, null);
  const failure = rig(async () => { throw new Error('offline'); });
  await failure.panels.toggle('profile'); assert.equal(failure.panels.active, null); assert.equal(failure.blocked, false); assert.equal(failure.error.message, 'offline');
  await failure.panels.toggle('bag'); assert.equal(failure.panels.active, 'bag');
});
