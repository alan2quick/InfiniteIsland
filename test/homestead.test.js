// Step 86a: Homesteading's layout layer. The pure rules (budget model B, the last-native guard, validation, state shapes), the `homestead` domain on a host + replica pair, and the REAL home island
// (props + harvest + gathering) with tombstones and planted objects: no id shifts, removed natives never regrow, planted kinds are full citizens, a late-joining replica and a reload get the same island.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
const storage = new Map();
globalThis.localStorage = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) };
const ctx = new Proxy({}, { get: (t, k) => (k === 'measureText' ? () => ({ width: 10 }) : /Gradient/.test(k) ? () => ({ addColorStop() {} }) : () => {}) });
globalThis.document = { createElement: () => ({ getContext: () => ctx, style: {} }) };
const { homeSave, STORAGE_KEY } = await import('../public/js/game/homeSave.js');
import { HOMESTEAD, FIRES, TOOL_RACK, ISLANDS, VERSION } from '../public/js/config.js';
import { getItem } from '../public/js/game/catalog.js';
import { WorldSync, actorKey } from '../public/js/net/worldSync.js';
import {
  classifyNative, usage, validateRemove, validatePlace, freshState, normaliseState, wireView, applyRemoved, applyPlaced, applyGrew, nextStage, standingCounts, kindMeta, FLOWER_KINDS,
} from '../public/js/game/homesteadLogic.js';
import { createHomestead, rotFor, SAVE_KEY } from '../public/js/game/homestead.js';
import { rackId, RACK_COUNT } from '../public/js/game/toolRackLogic.js';
import { getColliders, clearColliders } from '../public/js/world/colliders.js';
import { getInteractables, clearInteractables, addInteractable } from '../public/js/world/interactables.js';
import { createProps } from '../public/js/world/props.js';
import { buildIslandData } from '../public/js/world/islandVisuals.js';
import { createHarvest } from '../public/js/world/harvest.js';
import { createGathering } from '../public/js/world/gathering.js';
import { createHomesteadWorld } from '../public/js/world/homesteadWorld.js';

const N = HOMESTEAD.native;
const reject = (r) => (r && r.ok === false ? r.reason : r && r.reject);
const syntheticNatives = () => {
  const out = [];
  const add = (prefix, kind, n) => { for (let i = 0; i < n; i++) out.push({ id: `${prefix}:${i}`, kind }); };
  add('tree', 'appleTree', 20); add('tree', 'cherryTree', 15); add('palm', 'palm', N.palms); add('rock', 'rock', N.rocks); add('bush', 'berryBush', N.berryBushes); add('bush2', 'plainBush', N.bushes - N.berryBushes);
  add('herb', 'herb', N.herbs); add('mush', 'mushroom', N.mushrooms); for (let i = 1; i <= N.digSpots; i++) out.push({ id: `dig:${i}`, kind: 'digSpot' }); add('flower', 'flowerPink', N.flowers);
  return out;
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------ config + pure rules
test('the config table: every cost is a real catalogue item, weights follow model B, the budget is the pinned native total', () => {
  assert.equal(HOMESTEAD.budget, 35 * 3 + 8 * 3 + 20 * 2 + 25 * 2 + 12 + 3 + 6, '240 points');
  assert.equal(HOMESTEAD.budget, 240);
  assert.equal(HOMESTEAD.decoBudget, N.flowers + 40);
  assert.deepEqual(HOMESTEAD.weights, { tree: 3, palm: 3, bamboo: 3, rock: 2, bush: 2, herb: 1, mushroom: 1, glowcap: 1, digspot: 1 });
  for (const [kind, m] of Object.entries(HOMESTEAD.kinds)) {
    for (const [id, n] of Object.entries(m.cost)) { assert.ok(getItem(id), `${kind}: ${id} is a catalogue item`); assert.ok(n > 0); }
    assert.equal(m.weight, m.budget === 'deco' ? 1 : HOMESTEAD.weights[m.cls], kind);
    assert.ok(['home', 'frost', 'ember', 'dusk', 'crown'].includes(m.island));
    if (m.budget === 'deco') assert.deepEqual(m.cost, {}, 'decorations are free');
    if (m.island !== 'home') assert.ok(m.asset || m.look, `${kind}: a foreign kind (86e) has an asset or a dig look`);
  }
  assert.deepEqual(HOMESTEAD.kinds.plainBush.cost, {}, 'plain bushes cost nothing but count 2');
  assert.equal(HOMESTEAD.kinds.plainBush.weight, 2);
  assert.equal(VERSION, '0.86.0');
});

test('usage: the native island uses exactly the budget (and the 20 flowers are the deco budget\'s native part)', () => {
  const natives = syntheticNatives();
  assert.equal(natives.length, 35 + 8 + 20 + 25 + 12 + 3 + 6 + 20);
  const u = usage({ natives, state: freshState() });
  assert.equal(u.main.used, HOMESTEAD.budget);
  assert.equal(u.main.free, 0);
  assert.equal(u.deco.used, 20);
  assert.equal(u.deco.free, 40);
  assert.equal(u.counts.cherryTree, 15);
  // removing frees the weight; a placed copy takes it again
  let s = applyRemoved(freshState(), 'rock:0');
  assert.equal(usage({ natives, state: s }).main.free, 2);
  s = applyPlaced(s, { pid: 1, kind: 'herb', x: 1, z: 1, rot: 0, stage: 'grown' });
  assert.equal(usage({ natives, state: s }).main.free, 1);
  s = applyRemoved(s, 'p1');
  assert.equal(usage({ natives, state: s }).main.free, 2);
});

test('classifyNative maps the home interactables to kinds', () => {
  assert.equal(classifyNative({ type: 'tree', cherry: true }), 'cherryTree');
  assert.equal(classifyNative({ type: 'tree', cherry: false }), 'appleTree');
  assert.equal(classifyNative({ type: 'bush', berries: true }), 'berryBush');
  assert.equal(classifyNative({ type: 'bush' }), 'plainBush');
  assert.equal(classifyNative({ type: 'flower', color: 2 }), 'flowerPurple');
  assert.equal(classifyNative({ type: 'sign' }), null);
});

test('the last-native guard counts natives AND placed copies; decorations and foreign kinds have no guard; one wandering dig spot always stays', () => {
  const natives = [{ id: 'tree:0', kind: 'cherryTree' }, { id: 'tree:1', kind: 'appleTree' }, { id: 'tree:2', kind: 'appleTree' }, { id: 'flower:0', kind: 'flowerPink' },
    { id: 'dig:1', kind: 'digSpot' }, { id: 'dig:2', kind: 'digSpot' }];
  let state = { ...freshState(), unlocked: true };
  assert.equal(validateRemove({ id: 'tree:0', natives, state }), 'last-native');
  assert.equal(validateRemove({ id: 'tree:1', natives, state }), null);
  state = applyRemoved(state, 'tree:1');
  assert.equal(validateRemove({ id: 'tree:2', natives, state }), 'last-native');
  state = applyPlaced(state, { pid: 1, kind: 'appleTree', x: 0, z: 0, rot: 0, stage: 'sprout' });
  assert.equal(validateRemove({ id: 'tree:2', natives, state }), null, 'a planted sprout counts as a standing copy');
  assert.equal(validateRemove({ id: 'p1', natives, state }), null, 'the planted one may go while a native stands');
  assert.equal(validateRemove({ id: 'flower:0', natives, state }), null, 'the last native flower may go');
  assert.equal(validateRemove({ id: 'dig:1', natives, state }), null, 'two native slots: one may go');
  state = applyRemoved(state, 'dig:1');
  assert.equal(validateRemove({ id: 'dig:2', natives, state }), 'last-native', 'the last native dig spot kind');
  const withPatch = applyPlaced(state, { pid: 2, kind: 'digSpot', x: 3, z: 3, rot: 0, stage: 'grown' });
  assert.equal(validateRemove({ id: 'dig:2', natives, state: withPatch }), 'last-dig', 'a placed patch keeps the kind alive but the wandering set never goes below 1');
  assert.equal(validateRemove({ id: 'tree:99', natives, state }), 'gone');
  assert.equal(validateRemove({ id: 'tree:2', natives, state: freshState() }), 'locked');
  assert.equal(validateRemove({ id: 'tree:2', natives, state: freshState(), debug: true }), null);
  assert.equal(validateRemove({ id: 'tree:2', natives, state, hostActor: false }), 'not-host');
});

test('validatePlace: unlock, kind, budget (both budgets), cost against the bag, spot, host-screen only, "not yet" for foreign kinds', () => {
  const natives = syntheticNatives();
  const full = { ...freshState(), unlocked: true };
  const bag = (have) => (id) => have[id] || 0;
  const rich = bag({ apple: 99, peach: 99, log: 99, coconut: 99, stone: 99, berry: 99, herb: 99, mushroom: 99, potato: 99 });
  assert.equal(validatePlace({ kind: 'appleTree', x: 1, z: 1, natives, state: full, bag: rich }), 'budget', 'the island starts exactly full');
  const roomy = applyRemoved(applyRemoved(full, 'rock:0'), 'rock:1');            // 4 free points
  assert.equal(validatePlace({ kind: 'appleTree', x: 1, z: 1, natives, state: roomy, bag: rich }), null);
  assert.equal(validatePlace({ kind: 'appleTree', x: 1, z: 1, natives, state: roomy, bag: bag({ apple: 4, log: 4 }) }), 'cost');
  assert.equal(validatePlace({ kind: 'appleTree', x: 1, z: 1, natives, state: roomy, bag: bag({}), debug: true }), null, 'debug is free');
  assert.equal(validatePlace({ kind: 'plainBush', x: 1, z: 1, natives, state: roomy, bag: bag({}) }), null, 'plain bushes cost nothing');
  assert.equal(validatePlace({ kind: 'appleTree', x: 1, z: 1, natives, state: freshState(), bag: rich }), 'locked');
  assert.equal(validatePlace({ kind: 'appleTree', x: 1, z: 1, natives, state: roomy, bag: rich, hostActor: false }), 'not-host');
  assert.equal(validatePlace({ kind: 'sprucePine', x: 1, z: 1, natives, state: roomy, bag: rich, islands: ['home'] }), 'not-yet', 'a foreign kind waits for its island');
  assert.equal(validatePlace({ kind: 'sprucePine', x: 1, z: 1, natives, state: roomy, bag: bag({ pinecone: 5, 'pine-log': 4 }), islands: ['home', 'frost'] }), null, 'Step 86e: once Frostpine is unlocked the spruce can be planted');
  assert.equal(validatePlace({ kind: 'nope', x: 1, z: 1, natives, state: roomy }), 'unknown-kind');
  assert.equal(validatePlace({ kind: 'herb', x: NaN, z: 1, natives, state: roomy, bag: rich }), 'bad-request');
  assert.equal(validatePlace({ kind: 'herb', x: 1, z: 1, natives, state: roomy, bag: rich, spot: () => 'ground' }), 'spot');
  // the decoration budget is separate: the main budget being full does not matter, 40 free
  let s = full;
  for (let i = 1; i <= 40; i++) s = applyPlaced(s, { pid: i, kind: 'flowerBlue', x: i, z: 0, rot: 0, stage: 'grown' });
  assert.equal(validatePlace({ kind: 'flowerPink', x: 1, z: 1, natives, state: s }), 'budget', 'decoration budget (60) is full');
  assert.equal(validatePlace({ kind: 'flowerPink', x: 1, z: 1, natives, state: full }), null, 'free, no guard, no main budget');
});

test('state shapes: normalise is hostile-proof, wireView is sorted, the counter never reuses a pid, growth stages', () => {
  const bad = normaliseState({ unlocked: 'yes', removed: ['a', 'a', 7, 'b'], placed: [{ pid: 3, kind: 'rock', x: 1.234, z: 2, rot: 1 }, { pid: 3, kind: 'rock', x: 5, z: 5 }, { pid: 2, kind: 'ghost', x: 1, z: 1 }, { pid: -1, kind: 'rock', x: 1, z: 1 },
    { pid: 4, kind: 'appleTree', x: 1, z: 1, stage: 'nonsense' }, { pid: 5, kind: 'rock', x: 'q', z: 1 }], nextPid: 1 });
  assert.equal(bad.unlocked, false);
  assert.deepEqual(bad.removed, ['a', 'b']);
  assert.deepEqual(bad.placed.map((p) => [p.pid, p.kind, p.stage]), [[3, 'rock', 'grown'], [4, 'appleTree', 'grown']]);
  assert.equal(bad.placed[0].x, 1.23);
  assert.equal(bad.nextPid, 5, 'above the highest pid');
  assert.deepEqual(normaliseState(null), freshState());
  const s = applyGrew(applyPlaced(freshState(), { pid: 1, kind: 'palm', x: 1, z: 1, rot: 0, stage: 'sprout' }), 1, 'sapling');
  assert.equal(s.placed[0].stage, 'sapling');
  assert.equal(nextStage('palm', 'sprout'), 'sapling');
  assert.equal(nextStage('palm', 'sapling'), 'grown');
  assert.equal(nextStage('palm', 'grown'), null);
  assert.equal(nextStage('rock', 'grown'), null);
  assert.deepEqual(wireView(normaliseState(JSON.parse(JSON.stringify(wireView(s))))), wireView(s), 'round trip');
  assert.equal(rotFor(7), rotFor(7));
  assert.notEqual(rotFor(7), rotFor(8));
});

test('ids that must never shift: the tool rack reserved ids (fire x slot x kind) are unchanged by this step', () => {
  assert.equal(RACK_COUNT, FIRES.length * 4 * TOOL_RACK.kinds.length);
  assert.equal(rackId(1000, FIRES[0].id, 0, TOOL_RACK.kinds[0]), 1000);
  assert.equal(rackId(1000, FIRES[1].id, 2, TOOL_RACK.kinds[3]), 1000 + (1 * 4 + 2) * 5 + 3);
  assert.deepEqual(TOOL_RACK.kinds, ['axe', 'hammer', 'sword', 'shovel', 'rod']);
});

// ------------------------------------------------------------------------------------------------------------------------------------------------------ the domain: host + replica (stub world)
function stubWorld(natives) {
  const log = [];
  return {
    log, natives: () => natives, applyLayout: (l, o) => log.push(['layout', l, o]), retire: (id, d) => log.push(['retire', id, d.sid]), create: (r) => log.push(['create', r.pid, r.kind, r.stage]),
    setStage: (pid, st) => log.push(['stage', pid, st]), spotCheck: (k, x, z) => (x > 1000 ? 'ground' : null), layerFull: () => false, spotInfo: (sid) => (sid === 77 ? { sid, pid: null } : sid === 78 ? { sid, pid: 5 } : null), wanderSid: () => 9,
  };
}
function pair(opts = {}) {
  storage.clear(); homeSave.reset();
  if (opts.saved) storage.set(STORAGE_KEY, JSON.stringify({ v: 1, homestead: opts.saved }));
  const q = [], replicas = new Map();
  const hSync = new WorldSync({ role: 'host' }), rSync = new WorldSync({ role: 'replica' });
  replicas.set(1, rSync);
  hSync.attachHost({ sendTo: (tid, m) => q.push([replicas.get(tid), m]), broadcast: (m) => { for (const r of replicas.values()) q.push([r, m]); } });
  rSync.attachReplica({ send: (m) => { q.push([hSync, m, 1]); return true; } });
  const flush = () => { while (q.length) { const [to, m, tid] = q.shift(); if (to === hSync) hSync.screenMessage(tid, m); else to.receive(m); } };
  const bag = {}, inventory = {
    count: (id) => bag[id] || 0,
    removeAll: (need) => { if (!Object.entries(need).every(([id, n]) => (bag[id] || 0) >= n)) return false; for (const [id, n] of Object.entries(need)) bag[id] -= n; return true; },
  };
  const natives = syntheticNatives();
  const host = createHomestead({ sync: hSync, inventory, params: opts.params });
  const replica = createHomestead({ sync: rSync });
  const hw = stubWorld(natives), rw = stubWorld(natives);
  host.attach(hw); replica.attach(rw);
  rSync.linkUp(); hSync.screenConnected(1, { clientId: 'friend' }); flush();
  return { hSync, rSync, host, replica, hw, rw, bag, flush, equal: () => assert.equal(hSync.hash(), rSync.hash(), 'hashes equal') };
}
const hostActor = { screen: 'host', index: 0, pos: { x: 0, y: 0, z: 0 } };
const guest = { screen: 's1', index: 0, pos: { x: 0, y: 0, z: 0 } };

test('the domain on a host + replica pair: debug unlock, remove (with the guard), place (cost from the bag), water, equal hashes; guests are refused', () => {
  const t = pair();
  assert.equal(t.host.unlocked, false);
  assert.equal(reject(t.hSync.request('homestead', 'remove', { id: 'rock:0' }, hostActor)), 'locked');
  assert.equal(reject(t.hSync.request('homestead', 'unlock', {}, hostActor)), 'not-host', 'a normal request cannot unlock (Nabong does, 86b)');
  assert.equal(t.host.unlock().ok, true); t.flush();
  assert.equal(t.host.unlocked, true); assert.equal(t.replica.unlocked, true); t.equal();
  assert.equal(reject(t.hSync.request('homestead', 'remove', { id: 'rock:0' }, guest)), 'not-host', 'an online guest cannot Homestead');
  assert.equal(t.hSync.request('homestead', 'remove', { id: 'rock:0' }, hostActor).ok, true); t.flush();
  assert.deepEqual(t.hw.log.filter((l) => l[0] === 'retire'), [['retire', 'rock:0', undefined]]);
  assert.deepEqual(t.rw.log.filter((l) => l[0] === 'retire'), [['retire', 'rock:0', undefined]], 'the replica retires the same native');
  t.equal();
  // 2 free points: a tree needs 3
  assert.equal(reject(t.hSync.request('homestead', 'place', { kind: 'appleTree', x: 5, z: 5 }, hostActor)), 'budget');
  assert.equal(t.hSync.request('homestead', 'remove', { id: 'rock:1' }, hostActor).ok, true);
  assert.equal(reject(t.hSync.request('homestead', 'place', { kind: 'appleTree', x: 5, z: 5 }, hostActor)), 'cost');
  Object.assign(t.bag, { apple: 6, log: 5 });
  assert.equal(reject(t.hSync.request('homestead', 'place', { kind: 'appleTree', x: 5000, z: 5 }, hostActor)), 'spot');
  const r = t.hSync.request('homestead', 'place', { kind: 'appleTree', x: 5, z: 5 }, hostActor); t.flush();
  assert.equal(r.ok, true); assert.equal(r.result.pid, 1); assert.equal(r.result.rec.stage, 'sprout', 'trees are planted as sprouts');
  assert.deepEqual([t.bag.apple, t.bag.log], [1, 1], '5 apples + 4 logs left the bag');
  assert.deepEqual(t.rw.log.filter((l) => l[0] === 'create'), [['create', 1, 'appleTree', 'sprout']]);
  assert.equal(t.rSync.hash(), t.hSync.hash());
  // watering: two waterings, no waiting; the third is refused; a far guest is refused
  assert.equal(reject(t.hSync.request('homestead', 'water', { pid: 1 }, { ...guest, pos: { x: 90, y: 0, z: 90 } })), 'far');
  assert.equal(t.hSync.request('homestead', 'water', { pid: 1 }, { ...guest, pos: { x: 6, y: 0, z: 5 } }).ok, true); t.flush();
  assert.equal(t.replica.state.placed[0].stage, 'sapling');
  assert.equal(t.hSync.request('homestead', 'water', { pid: 1 }, hostActor).ok, true); t.flush();
  assert.equal(t.replica.state.placed[0].stage, 'grown');
  assert.equal(reject(t.hSync.request('homestead', 'water', { pid: 1 }, hostActor)), 'maxed');
  assert.deepEqual(t.rw.log.filter((l) => l[0] === 'stage').map((l) => l[2]), ['sapling', 'grown']);
  t.equal();
  // removing the planted tree frees its 3 points
  assert.equal(t.host.budget().main.free, 1);
  assert.equal(t.hSync.request('homestead', 'remove', { id: 'p1' }, hostActor).ok, true); t.flush();
  assert.equal(t.host.budget().main.free, 4); assert.equal(t.replica.state.placed.length, 0);
  assert.equal(reject(t.hSync.request('homestead', 'remove', { id: 'p1' }, hostActor)), 'gone');
  // a dig spot by sid: native slot, or the placed patch
  assert.equal(t.hSync.request('homestead', 'remove', { id: 'spot:77' }, hostActor).ok, true); t.flush();
  assert.ok(t.replica.state.removed.includes('dig:1'));
  assert.deepEqual(t.rw.log.filter((l) => l[0] === 'retire').pop(), ['retire', 'dig:1', 77], 'the removal carries the concrete spot');
  assert.equal(reject(t.hSync.request('homestead', 'remove', { id: 'spot:5' }, hostActor)), 'gone');
  t.equal();
});

test('the domain: save + load, replicas never save, ?homestead unlocks without writing, a late replica gets the whole layout from the snapshot', () => {
  const t = pair();
  t.host.unlock(); t.hSync.request('homestead', 'remove', { id: 'rock:3' }, hostActor); t.hSync.request('homestead', 'remove', { id: 'rock:4' }, hostActor);
  t.host.debug.place('herb', 4, 4); t.host.debug.place('appleTree', 8, 8, { stage: 'sapling' }); t.flush();
  const saved = JSON.parse(storage.get(STORAGE_KEY))[SAVE_KEY];
  assert.equal(saved.unlocked, true); assert.deepEqual(saved.removed, ['rock:3', 'rock:4']); assert.deepEqual(saved.placed.map((p) => [p.pid, p.kind, p.stage]), [[1, 'herb', 'grown'], [2, 'appleTree', 'sapling']]); assert.equal(saved.nextPid, 3);
  const again = pair({ saved });
  assert.deepEqual(wireView(again.host.state), saved, 'a reload keeps the layout');
  assert.equal(again.hw.log.find((l) => l[0] === 'layout')[1].placed.length, 2, 'attach applies the loaded layout to the world');
  assert.equal(again.rw.log.filter((l) => l[0] === 'layout').length, 1, 'a replica applies the layout once, from the snapshot (never from a load of its own)');
  assert.equal(again.rw.log.find((l) => l[0] === 'layout')[1].placed.length, 2);
  assert.equal(again.rSync.hash(), again.hSync.hash(), 'the late replica joined with the full layout');
  const before = storage.get(STORAGE_KEY);
  again.hSync.request('homestead', 'remove', { id: 'rock:5' }, { ...guest });
  again.flush();
  assert.equal(storage.get(STORAGE_KEY), before, 'a refused guest changes nothing; replicas never save');
  const flag = pair({ params: new URLSearchParams('homestead') });
  assert.equal(flag.host.unlocked, true);
  assert.equal(flag.hSync.request('homestead', 'remove', { id: 'rock:0' }, hostActor).ok, true);
  assert.equal(JSON.parse(storage.get(STORAGE_KEY))[SAVE_KEY].unlocked, false, 'the flag is never written');
  const hostile = pair({ saved: { unlocked: 5, removed: 'x', placed: [{ pid: 'a' }], nextPid: -3 } });
  assert.deepEqual(wireView(hostile.host.state), wireView(freshState()));
});

// ------------------------------------------------------------------------------------------------------------------------------------------------------ the real home island
async function boot({ role = 'host', saved = null, keep = false } = {}) {
  if (!keep) { storage.clear(); }
  homeSave.reset();
  if (saved) storage.set(STORAGE_KEY, JSON.stringify({ v: 1, homestead: saved }));
  clearColliders(); clearInteractables();
  const scene = new THREE.Scene();
  const props = createProps(scene);
  const ids = getInteractables().map((i) => [i.id, i.type]);
  const frost = buildIslandData(ISLANDS.find((i) => i.id === 'frost')).frost, ember = buildIslandData(ISLANDS.find((i) => i.id === 'ember')).ember;
  const sync = new WorldSync({ role });
  const bag = {};
  const inventory = {
    count: (id) => bag[id] || 0, add: (id, n) => { bag[id] = (bag[id] || 0) + n; },
    removeAll: (need) => { if (!Object.entries(need).every(([id, n]) => (bag[id] || 0) >= n)) return false; for (const [id, n] of Object.entries(need)) bag[id] -= n; return true; },
  };
  const homestead = createHomestead({ sync, inventory, params: new URLSearchParams() });
  const spawned = [];
  const particles = { burst() {} }, hud = { toast() {} };
  let held = 'axe';
  const items = { heldByKey: () => ({ kind: held }), heldBy: () => ({ kind: held }), swing: () => true };
  const harvest = createHarvest({ scene, players: { list: [], get: () => null }, items, particles, hud, interactions: { stopAnim() {} }, props, pickups: { spawn: (k, p) => spawned.push(k) }, sync, extraTargets: [] });
  const gathering = createGathering({ scene, props, players: { list: [], get: () => null }, sync, items, particles, hud, inventory, pickups: { spawn: (k) => spawned.push(k) }, frost, ember });
  const world = createHomesteadWorld({ props, harvest, gathering, particles });
  homestead.attach(world);
  return { scene, props, sync, bag, inventory, homestead, harvest, gathering, world, ids, spawned, setHeld: (k) => { held = k; }, step: (dt, n = 1) => { for (let i = 0; i < n; i++) { harvest.update(dt); gathering.update(dt); world.update(dt); } } };
}
function findSpot(w, kind, from = 12) {
  for (let r = from; r < 55; r += 1.3) for (let a = 0; a < 6.283; a += 0.25) {
    const x = Math.round(Math.cos(a) * r * 100) / 100, z = Math.round(Math.sin(a) * r * 100) / 100;
    if (w.world.spotCheck(kind, x, z) === null) return { x, z };
  }
  throw new Error('no spot for ' + kind);
}

test('the real island: the native counts are pinned, the budget is exactly full, the stable ids are what they were', async () => {
  const w = await boot();
  assert.deepEqual(w.props.stats && { trees: w.props.stats.trees, palms: w.props.stats.palms, rocks: w.props.stats.rocks, bushes: w.props.stats.bushes, berry: w.props.stats.berryBushes, herbs: w.props.stats.herbs, mush: w.props.stats.mushroomClusters, flowers: w.props.stats.flowerInteractables },
    { trees: N.trees, palms: N.palms, rocks: N.rocks, bushes: N.bushes, berry: N.berryBushes, herbs: N.herbs, mush: N.mushrooms, flowers: N.flowers });
  assert.equal(w.gathering.nativeDigCount, N.digSpots);
  const nat = w.homestead.natives;
  assert.equal(nat.length, N.trees + N.palms + N.rocks + N.bushes + N.herbs + N.mushrooms + N.digSpots + N.flowers);
  assert.equal(new Set(nat.map((n) => n.id)).size, nat.length, 'unique ids');
  const b = w.homestead.budget();
  assert.equal(b.main.used, HOMESTEAD.budget); assert.equal(b.main.free, 0); assert.equal(b.deco.used, N.flowers);
  assert.equal(b.counts.cherryTree, 15); assert.equal(b.counts.appleTree, 20); assert.equal(b.counts.berryBush, 7);
  // the interactable ids of the native props are 1..N in placement order (props runs first); nothing placed or removed changes them
  assert.deepEqual(w.ids.slice(0, 3).map((x) => x[0]), [1, 2, 3]);
  assert.equal(w.ids[0][1], 'sign');
  // the hash of an untouched island has no new sections: old pins hold
  const gh = w.gathering.constants && JSON.parse(JSON.stringify(w.sync.domains.get('gathering').hashView()));
  assert.deepEqual(Object.keys(gh), ['bushes', 'herbs', 'mushrooms', 'spots']);
  assert.ok(gh.spots.every((s) => s.length === 3));
  assert.deepEqual(w.sync.domains.get('harvest').hashView(), { down: [] });
  assert.deepEqual(wireView(w.homestead.state), wireView(freshState()));
});

test('tombstones: removed natives vanish for good and never regrow, no id shifts, every kind (tree, palm, rock, bush, herb, mushroom, flower, dig spot)', async () => {
  const w = await boot();
  w.homestead.unlock();
  const probeBefore = addInteractable({ type: 'probe', position: new THREE.Vector3(900, 0, 900) });
  const present = new Set(getInteractables().map((i) => i.id));
  const idOf = (key) => { const [kind, i] = key.split(':'); return { tree: w.props.handles.trees, palm: w.props.handles.palms, rock: w.props.handles.rocks, bush: w.props.handles.bushes }[kind][+i].userData.interactable.id; };
  const colBefore = getColliders().length;
  const treeG = w.props.handles.trees[0], palmG = w.props.handles.palms[0], rockG = w.props.handles.rocks[0];
  const ids = { tree: idOf('tree:0'), palm: idOf('palm:0'), rock: idOf('rock:0') };
  // fell one tree for real first (a stump), then remove it: the stump goes too
  const bushIdx = w.props.handles.bushes.findIndex((g) => g.userData.berries);
  const plainIdx = w.props.handles.bushes.findIndex((g) => !g.userData.berries);
  for (const id of ['tree:0', 'palm:0', 'rock:0', `bush:${bushIdx}`, `bush:${plainIdx}`, 'herb:0', 'mush:0', 'flower:0']) {
    const r = w.homestead.debug.remove(id);
    assert.equal(r.ok, true, `${id}: ${JSON.stringify(r)}`);
  }
  assert.equal(w.homestead.debug.remove('tree:0').ok, false, 'already gone');
  const nowPresent = new Set(getInteractables().map((i) => i.id));
  for (const id of present) if (![ids.tree, ids.palm, ids.rock, idOf(`bush:${bushIdx}`), idOf(`bush:${plainIdx}`)].includes(id)) {
    if (!nowPresent.has(id)) assert.ok([...w.world.retired].length >= 8, 'only retired things leave the registry (herb / mushroom / flower ids checked below)');
  }
  for (const g of [treeG, palmG, rockG]) { assert.equal(g.visible, false); assert.ok(!getColliders().some((c) => c.owner === g)); assert.ok(!getInteractables().includes(g.userData.interactable)); }
  assert.ok(getColliders().length < colBefore);
  assert.equal(w.harvest._targets.get(treeG).state, 'removed');
  assert.equal(w.harvest._targets.get(rockG).state, 'removed');
  assert.equal(w.gathering.states.herbs[0].state, 'removed');
  assert.equal(w.gathering.states.mushrooms[0].state, 'removed');
  assert.equal(w.gathering.plants.bushes.find((b) => b.item.id === idOf(`bush:${bushIdx}`)).removed, true);
  // a long time passes, everything is told to regrow now: the removed stay removed
  w.harvest.regrowNow(); w.gathering.regrowNow(); w.step(0.05, 400);
  for (const g of [treeG, palmG, rockG]) assert.equal(g.visible, false, 'never regrows');
  assert.equal(w.gathering.states.herbs[0].state, 'removed'); assert.equal(w.gathering.states.mushrooms[0].state, 'removed');
  assert.ok(!getInteractables().includes(w.gathering.plants.herbs[0].item));
  assert.deepEqual(w.sync.domains.get('harvest').hashView(), { down: [] }, 'a tombstone is not a felled tree');
  assert.equal(w.sync.domains.get('harvest').snapshot().down.length, 0);
  // the counter was not touched by any of this: the next fresh interactable follows the probe
  const probeAfter = addInteractable({ type: 'probe', position: new THREE.Vector3(901, 0, 900) });
  assert.equal(probeAfter.id, probeBefore.id + 1);
  // dig spots: removal by sid takes a wandering spot away and lowers the respawn set, never below 1
  const homeSpots = () => w.gathering.digSpots.filter((s) => s.isl === 'home');
  assert.equal(homeSpots().length, N.digSpots);
  for (let k = 0; k < N.digSpots - 1; k++) assert.equal(w.homestead.debug.remove(`spot:${homeSpots()[0].sid}`).ok, true, 'slot ' + k);
  assert.equal(homeSpots().length, 1);
  assert.equal(w.homestead.debug.remove(`spot:${homeSpots()[0].sid}`).ok, false);
  const last = homeSpots()[0];
  assert.equal(w.homestead.budget().counts.digSpot, 1);
  assert.equal(w.homestead.debug.remove('flower:1').ok, true);
  assert.equal(w.homestead.budget().deco.used, N.flowers - 2);
});

test('the guard on the real island: cherry trees can go down to one, the last needs a planted copy', async () => {
  const w = await boot();
  w.homestead.unlock();
  const cherries = w.homestead.natives.filter((n) => n.kind === 'cherryTree');
  assert.equal(cherries.length, 15);
  for (const n of cherries.slice(0, 14)) assert.equal(w.homestead.debug.remove(n.id).ok, true);
  assert.equal(w.homestead.debug.remove(cherries[14].id).ok, false, 'the island\'s last cherry tree');
  const spot = findSpot(w, 'cherryTree');
  const p = w.homestead.debug.place('cherryTree', spot.x, spot.z);
  assert.equal(p.ok, true, JSON.stringify(p));
  assert.equal(w.homestead.debug.remove(cherries[14].id).ok, true, 'a planted sprout stands in for it');
  assert.equal(w.homestead.debug.remove('p' + p.result.pid).ok, false, 'and now the sprout is the last one');
});

test('planted home kinds are full citizens: chop, rustle, pick, dig, shake ids, the sprout waters into a tree, budget in points, cost from the bag', async () => {
  const w = await boot();
  const bagActor = { screen: 'host', index: 0, pos: { x: 0, y: 0, z: 0 } };
  w.homestead.unlock();
  // make room: 3 trees' worth of points + herbs
  for (const id of ['tree:0', 'tree:1', 'tree:2', 'tree:3']) w.homestead.debug.remove(id);
  assert.equal(w.homestead.budget().main.free, 12);
  // not for free in normal play
  const spot = findSpot(w, 'appleTree');
  assert.equal(reject(w.sync.request('homestead', 'place', { kind: 'appleTree', ...spot }, bagActor)), 'cost');
  Object.assign(w.bag, { apple: 5, log: 4 });
  const planted = w.sync.request('homestead', 'place', { kind: 'appleTree', ...spot }, bagActor);
  assert.equal(planted.ok, true);
  const pid = planted.result.pid;
  assert.deepEqual([w.bag.apple, w.bag.log], [0, 0]);
  assert.equal(w.homestead.budget().main.free, 9);
  const h = w.props.planted.get(pid);
  assert.equal(h.item.id, HOMESTEAD.placedIdBase + pid, 'a fixed id: the same on every screen');
  assert.equal(h.item.type, 'sprout'); assert.equal(h.item.prompt, 'Water'); assert.equal(h.collider, null);
  assert.equal(h.g.name, 'sprout', 'the shared two-leaf sprout model'); assert.ok(h.g.scale.x < 1.5);
  assert.equal(w.homestead.debug.water(pid).ok, true);
  assert.equal(w.props.planted.get(pid).item.type, 'sprout'); assert.ok(w.props.planted.get(pid).g.scale.x > 0.3 && w.props.planted.get(pid).g.scale.x < 0.7, 'sapling');
  assert.equal(w.homestead.debug.water(pid).ok, true);
  const tree = w.props.planted.get(pid);
  assert.equal(tree.item.type, 'tree'); assert.equal(tree.item.id, HOMESTEAD.placedIdBase + pid, 'same id at every stage');
  assert.ok(getColliders().some((c) => c.owner === tree.g));
  assert.equal(w.homestead.debug.water(pid).ok, false);
  // chop it down (harvest by the fixed id), the felled drops are rolled by the host
  const hit = () => w.sync.request('harvest', 'hit', { id: tree.item.id, face: 0 }, { screen: 'host', index: 0, pos: { x: spot.x - 2, y: 0, z: spot.z } });
  let n = 0; while (n++ < 12 && w.harvest.states.find((s) => s.id === tree.item.id)?.state !== 'falling') assert.equal(hit().ok, true);
  const T = w.harvest._targets.get(tree.g);
  assert.equal(T.state, 'falling'); assert.ok(!getInteractables().includes(tree.item));
  w.step(0.05, 80);
  assert.equal(T.state, 'stump'); assert.ok(w.sync.domains.get('harvest').snapshot().down.some((e) => e.id === tree.item.id));
  w.harvest.regrowNow(); w.step(0.05, 120);
  assert.equal(T.state, 'idle', 'it regrows like a native');
  assert.ok(getInteractables().includes(tree.item));
  // a rock, a palm, bushes, a herb, a mushroom cluster, a dig patch, a flower
  const kinds = ['rock', 'palm', 'berryBush', 'plainBush', 'herb', 'mushroom', 'digSpot', 'flowerPink', 'flowerWhite', 'flowerPurple', 'flowerBlue'];
  const made = {};
  for (const kind of kinds) {
    const m = kindMeta(kind);
    if (m.budget === 'main' && w.homestead.budget().main.free < m.weight) { for (const n of w.homestead.natives.filter((q) => q.kind === 'rock' && q.id !== 'rock:0').slice(0, 3)) w.homestead.debug.remove(n.id); }
    const s = findSpot(w, kind, 14);
    const r = w.homestead.debug.place(kind, s.x, s.z);
    assert.equal(r.ok, true, kind + ' ' + JSON.stringify(r));
    made[kind] = { pid: r.result.pid, ...s };
  }
  assert.equal(w.homestead.budget().deco.used, N.flowers + 4);
  const rock = w.props.planted.get(made.rock.pid);
  assert.equal(w.sync.request('harvest', 'hit', { id: rock.item.id, face: 0 }, { screen: 'host', index: 0, pos: { x: made.rock.x - 2, y: 0, z: made.rock.z } }).ok, true, 'a planted rock is a harvest target');
  // berry bush: rustle by key, berries pop out, regrow
  const key = 'p' + made.berryBush.pid;
  assert.equal(w.sync.request('gathering', 'rustle', { i: key }, bagActor).ok, true);
  w.step(0.05, 6); assert.equal(w.gathering.plants.placed.bushes.get(key).full, false); assert.ok(w.spawned.includes('berry'));
  w.gathering.regrowNow(); w.step(0.05, 40); assert.equal(w.gathering.plants.placed.bushes.get(key).full, true);
  // herb: picked into the bag, hidden, grows back
  const hk = 'p' + made.herb.pid;
  assert.equal(w.sync.request('gathering', 'pick', { k: 'herb', i: hk }, bagActor).ok, true);
  assert.equal(w.bag.herb, 1); assert.equal(w.gathering.plants.placed.herbs.get(hk).state, 'hidden');
  assert.equal(reject(w.sync.request('gathering', 'pick', { k: 'herb', i: hk }, bagActor)), 'gone');
  w.gathering.regrowNow(); w.step(0.05, 60); assert.equal(w.gathering.plants.placed.herbs.get(hk).state, 'ready');
  const mk = 'p' + made.mushroom.pid;
  assert.equal(w.sync.request('gathering', 'pick', { k: 'mushroom', i: mk }, bagActor).ok, true); assert.ok(w.bag.mushroom >= 1);
  // the dig patch: a fixed spot, dug, re-fills IN PLACE (new sid, same x/z/pid)
  const patch = w.gathering.digSpots.find((s) => s.pid === made.digSpot.pid);
  assert.ok(patch); assert.equal(patch.isl, 'home');
  w.setHeld('shovel');
  assert.equal(w.sync.request('gathering', 'dig', { sid: patch.sid }, { screen: 'host', index: 0, pos: { x: patch.x, y: 0, z: patch.z } }).ok, true);
  assert.ok(!w.gathering.digSpots.some((s) => s.pid === made.digSpot.pid));
  w.gathering.regrowNow(); w.step(0.05, 20);
  const again = w.gathering.digSpots.find((s) => s.pid === made.digSpot.pid);
  assert.ok(again && again.sid !== patch.sid && again.x === patch.x && again.z === patch.z, 're-filled where it was');
  assert.equal(w.homestead.budget().counts.digSpot, N.digSpots + 1);
  // hashes: the new sections exist only now
  assert.ok(w.sync.domains.get('gathering').hashView().placed);
  assert.ok(w.sync.domains.get('gathering').hashView().spots.some((s) => s.length === 4));
  // a flower is a boing target and counts against the deco budget only
  const fl = w.props.planted.get(made.flowerPink.pid);
  assert.equal(fl.item.type, 'flower'); assert.equal(fl.item.instance.mesh.name, 'planted-flower0');
  // removing the planted things frees the points again; nothing leaks into registries
  const before = getInteractables().length;
  assert.equal(w.homestead.debug.remove('p' + made.herb.pid).ok, true);
  assert.equal(w.homestead.debug.remove('p' + made.digSpot.pid).ok, true);
  assert.equal(getInteractables().length, before - 2);
  assert.ok(!w.gathering.digSpots.some((s) => s.pid === made.digSpot.pid));
  w.gathering.regrowNow(); w.step(0.05, 200);
  assert.ok(!w.gathering.digSpots.some((s) => s.pid === made.digSpot.pid), 'the removed patch does not re-fill');
  assert.equal(w.gathering.plants.placed.herbs.size, 0);
});

test('a late-joining replica gets the same island: tombstones, planted objects, stages and spots, in registration order (homestead before harvest / gathering)', async () => {
  const w = await boot();
  w.homestead.unlock();
  for (const id of ['tree:5', 'rock:2', 'rock:3', 'herb:3', 'mush:1', 'bush:0', 'flower:4']) w.homestead.debug.remove(id);
  w.homestead.debug.remove(`spot:${w.gathering.digSpots[0].sid}`);
  for (const [kind, st] of [['appleTree', 'sapling'], ['palm', 'grown'], ['berryBush'], ['herb'], ['mushroom'], ['digSpot'], ['flowerBlue']]) {
    const s = findSpot(w, kind, 13);
    const r = w.homestead.debug.place(kind, s.x, s.z, { stage: st });
    assert.equal(r.ok, true, kind + JSON.stringify(r));
  }
  w.sync.request('gathering', 'rustle', { i: 'p' + [...w.props.planted.values()].find((h) => h.kind === 'berryBush').pid }, hostActor);
  w.step(0.05, 6);
  const snaps = w.sync._snapshots();
  const order = Object.keys(snaps);
  assert.ok(order.indexOf('homestead') >= 0 && order.indexOf('homestead') < order.indexOf('harvest') && order.indexOf('homestead') < order.indexOf('gathering'), order.join());
  const hostHashes = { ...w.sync.hashes() };
  const hostPlanted = [...w.props.planted.values()].map((h) => [h.pid, h.kind, +h.x.toFixed(2), +h.z.toFixed(2)]);
  const hostRetired = [...w.world.retired].sort();
  const json = JSON.parse(JSON.stringify(snaps));
  const r = await boot({ role: 'replica', keep: true });
  for (const [name, snap] of Object.entries(json)) { const d = r.sync.domains.get(name); if (d && d.applySnapshot) d.applySnapshot(snap); }
  const rh = r.sync.hashes();
  for (const name of ['homestead', 'harvest', 'gathering']) assert.equal(rh[name], hostHashes[name], name + ' hash equal');
  assert.deepEqual([...r.props.planted.values()].map((h) => [h.pid, h.kind, +h.x.toFixed(2), +h.z.toFixed(2)]), hostPlanted.filter((p) => p[1] !== 'digSpot'));
  assert.deepEqual([...r.world.retired].sort(), hostRetired.filter((id) => !id.startsWith('dig:')).concat(hostRetired.filter((id) => id.startsWith('dig:'))).sort());
  assert.ok(r.gathering.digSpots.some((s) => s.pid != null), 'the placed patch came with the gathering snapshot');
  assert.equal(r.props.handles.trees[5].visible, false);
  assert.ok(!getInteractables().includes(r.props.handles.trees[5].userData.interactable));
  assert.equal(r.props.planted.get([...r.props.planted.keys()][0]).item.type, 'sprout', 'the sapling is still a young tree');
  // a replica never saves
  const stored = storage.get(STORAGE_KEY);
  r.sync.domains.get('homestead').applyEvent('removed', { id: 'rock:9' });
  assert.equal(storage.get(STORAGE_KEY), stored);
});

test('a reload keeps the layout: the host loads the saved homestead key and rebuilds tombstones, planted objects and the shorter dig-spot set', async () => {
  const w = await boot();
  w.homestead.unlock();
  const gone = ['tree:7', 'tree:8', 'rock:5', 'palm:1', 'herb:2', 'flower:7'];
  for (const id of gone) assert.equal(w.homestead.debug.remove(id).ok, true, id);
  for (let k = 0; k < 2; k++) w.homestead.debug.remove(`spot:${w.gathering.digSpots.filter((s) => s.isl === 'home')[0].sid}`);
  const made = [];
  for (const kind of ['cherryTree', 'rock', 'herb']) { const s = findSpot(w, kind, 15); const r = w.homestead.debug.place(kind, s.x, s.z, { stage: 'grown' }); assert.equal(r.ok, true, kind + JSON.stringify(r)); made.push([kind, s.x, s.z, r.result.pid]); }
  const state = JSON.parse(JSON.stringify(wireView(w.homestead.state)));
  const stored = JSON.parse(storage.get(STORAGE_KEY));
  assert.deepEqual(stored.homestead, state);
  const budget = w.homestead.budget();
  const r = await boot({ keep: true });                                    // same storage, a brand new process-like boot
  assert.deepEqual(wireView(r.homestead.state), state);
  assert.deepEqual(r.homestead.budget().main, budget.main); assert.deepEqual(r.homestead.budget().deco, budget.deco);
  assert.deepEqual([...r.world.retired].sort(), [...gone, 'dig:1', 'dig:2'].sort());
  assert.equal(r.props.handles.trees[7].visible, false); assert.equal(r.props.handles.palms[1].visible, false);
  assert.ok(!getInteractables().includes(r.props.handles.rocks[5].userData.interactable));
  assert.equal(r.harvest._targets.get(r.props.handles.trees[7]).state, 'removed');
  assert.equal(r.gathering.states.herbs[2].state, 'removed');
  assert.equal(r.gathering.digSpots.filter((s) => s.isl === 'home' && s.pid == null).length, N.digSpots - 2, 'the wandering set is two shorter');
  for (const [kind, x, z, pid] of made) {
    const h = r.props.planted.get(pid);
    assert.ok(h, kind); assert.equal(h.kind, kind); assert.equal(h.x, x); assert.equal(h.z, z); assert.equal(h.item.id, HOMESTEAD.placedIdBase + pid);
  }
  assert.equal(r.homestead.state.nextPid, state.nextPid, 'the pid counter continues');
  const nextPlace = r.homestead.debug.place('plainBush', ...Object.values(findSpot(r, 'plainBush', 16)));
  assert.equal(nextPlace.ok, true); assert.equal(nextPlace.result.pid, state.nextPid, 'no pid is reused');
});
