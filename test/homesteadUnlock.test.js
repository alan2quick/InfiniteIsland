// Step 86b: the Homesteading unlock (Im Nabong's dialog -> the host unlocks, the watering can reaches the HOME rack only) and the per-player mode flag.
// Pins every pre-existing tool-rack id, checks the 4 appended watering-can ids, the home-only cycle, the host/guest gate, and Nabong's script data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
const storage = new Map();
globalThis.localStorage = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) };
const ctx = new Proxy({}, { get: (t, k) => (k === 'measureText' ? () => ({ width: 10 }) : /Gradient/.test(k) ? () => ({ addColorStop() {} }) : () => {}) });
globalThis.document = { createElement: () => ({ getContext: () => ctx, style: {} }) };
const { homeSave } = await import('../public/js/game/homeSave.js');
import { FIRES, TOOL_RACK, VERSION } from '../public/js/config.js';
import { WorldSync } from '../public/js/net/worldSync.js';
import { rackId, rackInfo, rackKinds, RACK_COUNT, RACK_TOTAL, RACK_EXTRA_KIND } from '../public/js/game/toolRackLogic.js';
import { createHomestead } from '../public/js/game/homestead.js';
import { SCRIPT, HOMESTEAD_TALK } from '../public/js/game/tdoongzScript.js';
import { ICONS, HOMESTEAD_SVG } from '../public/js/ui/icons.js';
import { createToolRacks } from '../public/js/world/toolRacks.js';
import { createItems } from '../public/js/world/items.js';
import { toolRackPlan } from '../public/js/world/toolRackPlan.js';
import { rememberedTool } from '../public/js/game/playerMemory.js';
import { getHeight } from '../public/js/world/terrain.js';
import { clearColliders } from '../public/js/world/colliders.js';
import { clearInteractables } from '../public/js/world/interactables.js';

const reject = (r) => (r && r.ok === false ? r.reason : r && r.reject);

test('tool rack ids: every existing (fire, slot, kind) id is unchanged; 4 watering-can ids are appended after them', () => {
  assert.deepEqual(TOOL_RACK.kinds, ['axe', 'hammer', 'sword', 'shovel', 'rod']);
  assert.equal(RACK_COUNT, 80);
  assert.equal(RACK_TOTAL, 84);
  assert.equal(FIRES.length, 4);
  for (let f = 0; f < FIRES.length; f++) for (let slot = 0; slot < 4; slot++) for (let k = 0; k < 5; k++) {
    const id = rackId(100, FIRES[f].id, slot, TOOL_RACK.kinds[k]);
    assert.equal(id, 100 + f * 20 + slot * 5 + k, `${FIRES[f].id} slot ${slot} ${TOOL_RACK.kinds[k]}`);
    assert.deepEqual(rackInfo(100, id), { fire: FIRES[f].id, owner: slot, kind: TOOL_RACK.kinds[k] });
  }
  for (let slot = 0; slot < 4; slot++) {
    assert.equal(rackId(100, 'home', slot, RACK_EXTRA_KIND), 180 + slot);
    assert.deepEqual(rackInfo(100, 180 + slot), { fire: 'home', owner: slot, kind: 'watering-can' });
  }
  assert.equal(rackInfo(100, 184), null);
  assert.equal(rackInfo(100, 179).kind, 'rod');
  for (const f of FIRES.filter((x) => x.id !== 'home')) assert.equal(rackId(100, f.id, 0, RACK_EXTRA_KIND), null, 'no can on other racks');
  assert.equal(rackId(100, 'home', 4, RACK_EXTRA_KIND), null);
});

test('rack kinds: the watering can joins the HOME cycle at the end, only once Homesteading is unlocked', () => {
  assert.deepEqual(rackKinds(false), ['axe', 'hammer', 'sword', 'shovel']);
  assert.deepEqual(rackKinds(true), TOOL_RACK.kinds);
  assert.deepEqual(rackKinds(false, 'home', false), ['axe', 'hammer', 'sword', 'shovel']);
  assert.deepEqual(rackKinds(false, 'home', true), ['axe', 'hammer', 'sword', 'shovel', 'watering-can'], 'after the shovel when the rod is not discovered');
  assert.deepEqual(rackKinds(true, 'home', true), [...TOOL_RACK.kinds, 'watering-can'], 'after the rod');
  for (const f of FIRES.filter((x) => x.id !== 'home')) assert.deepEqual(rackKinds(true, f.id, true), TOOL_RACK.kinds);
});

// ---- the real items domain + racks
function fixture(homestead) {
  clearColliders(); clearInteractables();
  const sync = new WorldSync({ role: 'host' }), scene = new THREE.Scene();
  const root = new THREE.Group(), handSocket = new THREE.Group(), armR = new THREE.Group(); armR.userData.restZ = 0; root.add(armR, handSocket); scene.add(root);
  const p = { index: 0, root, position: root.position, parts: { armR, handSocket }, colors: { name: 'P1', ui: '#fff' }, hop() {}, teleport(x, z) { root.position.set(x, getHeight(x, z), z); } };
  const list = [p], players = { list, players: list, p1: p, multi: false, get: (i) => list.find((q) => q.index === i), labelOf: () => 'P1', on() {} };
  const items = createItems({ scene, players, sync, particles: { burst() {} }, hud: { toast() {} } });
  const plan = toolRackPlan({ overlaps: () => false, interactables: () => [] });
  const racks = createToolRacks({ scene, players, items, quests: { slots: {}, on() {} }, sync, boat: { state: { discovered: false } }, homestead, plan, particles: { burst() {} }, params: new URLSearchParams('racks') });
  const step = () => { for (let i = 0; i < 16; i++) items.update(0.1); racks.update(0); };
  const at = (f = 'home') => { const s = plan[f]; p.teleport(s.x, s.z + 1.5); };
  at(); return { p, items, racks, step, at, scene };
}

test('the home rack cycles axe, hammer, sword, shovel, then the watering can once unlocked; other racks never offer it', () => {
  const h = { unlocked: false };
  const w = fixture(h);
  assert.equal(w.items.list.filter((r) => r.rack).length, 84);
  const cycle = (fire = 'home') => { w.racks.cycle(w.p, fire); w.step(); return w.items.held?.kind ?? null; };
  assert.deepEqual([cycle(), cycle(), cycle(), cycle(), cycle()], ['axe', 'hammer', 'sword', 'shovel', 'axe'], 'locked: the old 4-tool loop, exactly as before');
  h.unlocked = true; w.step();
  assert.deepEqual([cycle(), cycle()], ['hammer', 'sword']);
  assert.equal(cycle(), 'shovel'); assert.equal(cycle(), 'watering-can'); assert.equal(cycle(), 'axe', 'and back around');
  assert.equal(w.racks.stock(w.p, 'home')['watering-can'], 'rack', 'returned');
  // hold the can, then use the Frost rack: the can is dropped (it is not that rack's tool) and a Frost axe is taken
  for (let i = 0; i < 4; i++) cycle();
  assert.equal(w.items.held.kind, 'watering-can');
  const held = w.items.held;
  assert.equal(held.rack.kind, 'watering-can'); assert.equal(held.rack.fire, 'home');
  assert.equal(rememberedTool(held), null, 'a rack copy is never remembered or saved');
  w.at('frost'); const frostLoop = []; for (let i = 0; i < 5; i++) frostLoop.push(cycle('frost'));
  assert.ok(!frostLoop.includes('watering-can'), 'Frost never offers the can');
  assert.equal(w.racks.stock(w.p, 'frost')['watering-can'], null);
  assert.ok(w.racks.summary().find((s) => s.fire === 'frost').kinds.every((k) => k !== 'watering-can'));
  assert.ok(w.racks.summary().find((s) => s.fire === 'home').kinds.includes('watering-can'));
});

test('the can peg shows on the home rack only when unlocked, and is simply there on load', () => {
  const w = fixture({ unlocked: true });
  const s = w.racks.summary();
  assert.equal(s.find((x) => x.fire === 'home').can, true);
  assert.equal(s.find((x) => x.fire === 'frost').can, false);
  const off = fixture({ unlocked: false });
  assert.equal(off.racks.summary().find((x) => x.fire === 'home').can, false);
});

// ---- the homestead domain: the unlock gate
function pair({ album = { complete: false }, params } = {}) {
  storage.clear(); homeSave.reset();
  const q = [], replicas = new Map();
  const hSync = new WorldSync({ role: 'host' }), rSync = new WorldSync({ role: 'replica' });
  replicas.set(1, rSync);
  hSync.attachHost({ sendTo: (tid, m) => q.push([replicas.get(tid), m]), broadcast: (m) => { for (const r of replicas.values()) q.push([r, m]); } });
  rSync.attachReplica({ send: (m) => { q.push([hSync, m, 1]); return true; } });
  const flush = () => { while (q.length) { const [to, m, tid] = q.shift(); if (to === hSync) hSync.screenMessage(tid, m); else to.receive(m); } };
  const host = createHomestead({ sync: hSync, albumComplete: () => album.complete, params });
  const replica = createHomestead({ sync: rSync, albumComplete: () => album.complete });
  host.setNatives([]); replica.setNatives([]);
  rSync.linkUp(); hSync.screenConnected(1, { clientId: 'friend' }); flush();
  return { hSync, rSync, host, replica, flush, album, equal: () => assert.equal(hSync.hash(), rSync.hash(), 'hashes equal') };
}
const hostActor = { screen: 'host', index: 1, pos: { x: 0, y: 0, z: 0 } };
const guest = { screen: 's1', index: 0, pos: { x: 0, y: 0, z: 0 } };

test('unlock gate: album incomplete -> rejected and no row; complete -> unlocks for every screen; guests rejected; no double unlock', () => {
  const t = pair();
  const events = [], rEvents = [];
  t.host.on((k, d) => events.push([k, d])); t.replica.on((k, d) => rEvents.push([k, d]));
  assert.equal(t.host.canTalk(), false, 'no row while the album is incomplete');
  assert.equal(reject(t.hSync.request('homestead', 'unlock', { nabong: true }, hostActor)), 'album');
  assert.equal(t.host.unlocked, false);
  t.album.complete = true;
  assert.equal(t.host.canTalk(), true);
  assert.equal(t.replica.canTalk(), false, 'a guest screen never sees the unlock row');
  assert.equal(reject(t.hSync.request('homestead', 'unlock', { nabong: true }, guest)), 'not-host', 'an online guest cannot trigger the unlock');
  assert.equal(reject(t.hSync.request('homestead', 'unlock', { nabong: true, debug: true }, guest)), 'not-host', 'nor can it fake the debug flag');
  assert.equal(t.host.unlocked, false);
  assert.equal(t.hSync.request('homestead', 'unlock', { nabong: true }, hostActor).ok, true); t.flush();
  assert.equal(t.host.unlocked, true); assert.equal(t.replica.unlocked, true); t.equal();
  assert.equal(t.host.canTalk(), false, 'the row is gone once unlocked');
  assert.deepEqual(events.find((e) => e[0] === 'unlocked')[1].actor, { screen: 'host', index: 1 }, 'the event names who gets the can');
  assert.deepEqual(rEvents.find((e) => e[0] === 'unlocked')[1].actor, { screen: 'host', index: 1 }, 'and the guest screen sees the same pose target');
  assert.equal(reject(t.hSync.request('homestead', 'unlock', { nabong: true }, hostActor)), 'already');
  assert.equal(JSON.parse(storage.get('infinite-island.home.v1')).homestead.unlocked, true, 'saved by the host');
  assert.equal(reject(t.hSync.request('homestead', 'unlock', {}, hostActor)), 'not-host', 'a plain request still cannot unlock');
});

test('debug unlock scene skips the album check and replays; ?homestead unlocks the session without the Nabong row', () => {
  const t = pair();
  assert.equal(t.host.debug.unlockScene({ index: 2 }).ok, true); t.flush();
  assert.equal(t.host.unlocked, true); assert.equal(t.replica.unlocked, true);
  assert.equal(t.host.debug.unlockScene({ index: 0 }).ok, true, 'replayable');
  const f = pair({ params: new URLSearchParams('homestead'), album: { complete: true } });
  assert.equal(f.host.unlocked, true); assert.equal(f.host.canTalk(), false);
});

test('the Homesteading mode flag: per player, host screen only, only once unlocked; not synced or saved', () => {
  const t = pair();
  const a = { index: 0 }, b = { index: 1 }, seen = [];
  t.host.on((k, d) => { if (k === 'mode') seen.push([d.player.index, d.on]); });
  assert.equal(t.host.setMode(a, true), false, 'locked');
  assert.equal(t.host.inMode(a), false);
  t.host.unlock(); t.flush();
  assert.equal(t.host.setMode(a, true), true);
  assert.equal(t.host.inMode(a), true); assert.equal(t.host.inMode(b), false, 'the other player keeps playing normally');
  assert.equal(t.host.setMode(a, true), true); assert.deepEqual(seen, [[0, true]], 'no event when nothing changed');
  assert.equal(t.host.setMode(a, false), true); assert.equal(t.host.inMode(a), false); assert.deepEqual(seen, [[0, true], [0, false]]);
  t.host.setMode(b, true); assert.deepEqual(t.host.modes(), [b]);
  assert.equal(t.replica.setMode(a, true), false, 'a guest screen cannot Homestead');
  assert.equal(t.replica.inMode(a), false);
  t.equal();
  assert.ok(!JSON.stringify(JSON.parse(storage.get('infinite-island.home.v1')).homestead).includes('mode'));
});

test("Nabong's Homesteading script: unlock row (3-5 pages, mentions Homesteading and the can), tip row, icons, no emoji", () => {
  assert.equal(HOMESTEAD_TALK.friend, 'imnabong'); assert.ok(SCRIPT.imnabong);
  const { unlock, tip } = HOMESTEAD_TALK;
  assert.ok(unlock.pages.length >= 3 && unlock.pages.length <= 5);
  const text = unlock.pages.join(' ');
  assert.match(text, /watering can/i); assert.match(text, /Homesteading/); assert.match(text, /campfire/i); assert.match(text, /cosier/i);
  assert.ok(tip.pages.length >= 1); assert.match(tip.pages.join(' '), /watering can/i);
  assert.ok(!/[^\x00-\x7f]/.test(JSON.stringify(HOMESTEAD_TALK)), 'plain text only');
  for (const r of [unlock, tip]) assert.ok(r.label && r.id && r.icon);
  assert.ok(ICONS.homestead === HOMESTEAD_SVG && HOMESTEAD_SVG.startsWith('<svg'));
  assert.ok(HOMESTEAD_TALK.gaveCan && HOMESTEAD_TALK.canWaits);
});

test('version is in sync across config, package.json and package-lock.json', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')), lock = JSON.parse(fs.readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
  assert.equal(pkg.version, VERSION); assert.equal(lock.version, VERSION); assert.equal(lock.packages[''].version, VERSION);
});
