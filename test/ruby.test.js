// Step 76b: action-only rules, real terrain/registries, course validator, host/replica and screen runtime.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RUBY, ISLANDS, FIRES } from '../public/js/config.js';
import { freshState, normaliseState, debugState, savedView, shellOf, sizeOf, requestSpot, validateRequest, applyRequest } from '../public/js/game/rubyLogic.js';
import { createRuby } from '../public/js/game/ruby.js';
import { rubyPlan } from '../public/js/world/islands/emberRuby.js';
import { createRubyWorld } from '../public/js/world/rubyWorld.js';
import { registerEmberGameplay } from '../public/js/world/islands/emberWorld.js';
import { getHeight, isWalkable } from '../public/js/world/terrain.js';
import { getColliders, overlapsAny } from '../public/js/world/colliders.js';
import { getInteractables } from '../public/js/world/interactables.js';
import { validateCourse, courseAt, registerCourse, unregisterCourse } from '../public/js/game/hopLogic.js';
import { coveLayout } from '../public/js/world/islands/emberCove.js';
import { WorldSync } from '../public/js/net/worldSync.js';
import { getToolAction, actionForKind } from '../public/js/items/tools.js';
import { createPetsDomain } from '../public/js/game/petsDomain.js';
import { emberSave, STORAGE_KEY } from '../public/js/game/emberSave.js';
import { getItem } from '../public/js/game/catalog.js';
import { DayNight } from '../public/js/world/dayNight.js';
const storage = new Map();
globalThis.localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) };
const island = ISLANDS.find(i => i.id === 'ember');
const real = registerEmberGameplay(island);
const plan = rubyPlan();
const validation = (s, kind, extra = {}) => validateRequest({ state: s, kind, open: true, dist: 0, have: () => 99, ...extra });

test('Ruby normalisation clamps stages and work and removes out-of-stage quest items', () => {
  assert.deepEqual(normaliseState(null), freshState());
  for (const raw of [undefined, 'junk', {}, { stage: 'bad' }]) assert.deepEqual(normaliseState(raw), freshState());
  assert.equal(normaliseState({ stage: 100 }).stage, 6); assert.equal(normaliseState({ stage: -3 }).stage, 0);
  assert.equal(normaliseState({ stage: 2, shell: 'conch', coconut: true, coconutHits: 99, crustHits: 99 }).shell, null);
  assert.equal(normaliseState({ stage: 3, coconut: true, coconutHits: 99 }).coconutHits, 2);
  assert.equal(normaliseState({ stage: 4, crustHits: 99 }).crustHits, 12);
  for (let stage = 0; stage <= 6; stage++) assert.deepEqual(savedView(debugState(stage)), debugState(stage));
  assert.deepEqual(normaliseState({ ...debugState(6), homeReady: true, shell: 'whelk', coconut: true }), debugState(6));
});
test('Ruby shells and size grow in order with no inventory catalogue entries for quest shells', () => {
  assert.deepEqual(Array.from({ length: 7 }, (_, stage) => shellOf({ stage })), ['cap', 'cap', 'whelk', 'turban', 'coconut', 'conch', 'home']);
  for (let stage = 2; stage <= 6; stage++) assert.ok(sizeOf({ stage }) > sizeOf({ stage: stage - 1 }));
  for (const id of ['whelk', 'turban', 'conch']) assert.equal(getItem(id), null);
  for (const id of Object.keys(RUBY.gifts)) assert.ok(getItem(id));
});
for (const [kind, stage] of Object.entries({ sight: 0, dig: 1, hop: 2, coconut: 3, hit: 3, crust: 4, hearth: 5, offer: 1 })) {
  test(`Ruby ${kind}: rejects locked, wrong-stage, busy and out-of-reach requests`, () => {
    const s = { ...debugState(stage), shell: stage === 1 ? 'whelk' : null, coconut: true };
    assert.equal(validation(s, kind, { open: false }), 'locked');
    assert.equal(validation(debugState(6), kind), 'stage');
    assert.equal(validation(s, kind, { busy: true }), 'busy');
    assert.equal(validation(s, kind, { dist: 100 }), 'far');
  });
}
test('Ruby remote reach adds slack, but never permits missing actor positions', () => {
  const s = debugState(1);
  assert.equal(validation(s, 'dig', { tool: 'shovel', dist: RUBY.reach + 1 }), 'far');
  assert.equal(validation(s, 'dig', { tool: 'shovel', dist: RUBY.reach + 1, remote: true }), null);
  assert.equal(validation(s, 'dig', { tool: 'shovel', dist: Infinity, remote: true }), 'far');
});
test('Ruby tools: shovel only, coconut axe/hammer only, crust hammer/axe/sword only', () => {
  for (const tool of ['shovel', 'axe', 'hammer', 'sword', 'lightsaber', 'rod', null]) {
    assert.equal(validation(debugState(1), 'dig', { tool }), tool === 'shovel' ? null : 'tool');
    assert.equal(validation({ ...debugState(3), coconut: true }, 'hit', { tool }), ['axe', 'hammer'].includes(tool) ? null : 'tool');
    assert.equal(validation(debugState(4), 'crust', { tool }), ['axe', 'hammer', 'sword'].includes(tool) ? null : 'tool');
    for (const type of ['rubydig', 'rubycoconut', 'rubycrust']) assert.equal(getToolAction({ state: 'held', kind: tool }, { type }), actionForKind(tool, { type }));
  }
  assert.equal(getToolAction({ state: 'held', kind: 'hammer' }, { type: 'rubycoconut' }), 'break');
  assert.equal(getToolAction({ state: 'ground', kind: 'axe' }, { type: 'rubycoconut' }), null);
});
test('Ruby collecting shells is idempotent, offering needs its own shell, bag gifts cannot be reused', () => {
  for (const [stage, kind, shell] of [[1, 'dig', 'whelk'], [2, 'hop', 'turban'], [4, 'crust', 'conch']]) {
    const s = { ...debugState(stage), shell };
    assert.equal(validation(s, kind, { tool: stage === 1 ? 'shovel' : 'hammer' }), 'taken');
    assert.equal(validation(s, 'offer'), null); assert.equal(applyRequest(s, 'offer').stage, stage + 1);
    assert.equal(validation(debugState(stage), 'offer'), 'shell');
  }
  assert.equal(validation(debugState(3), 'coconut', { have: () => 0 }), 'items');
  assert.equal(validation(debugState(3), 'hit', { tool: 'axe' }), 'coconut');
  assert.equal(validation({ ...debugState(3), coconut: true }, 'coconut'), 'taken');
  for (const id of Object.keys(RUBY.gifts)) assert.equal(validation(debugState(5), 'hearth', { have: item => item === id ? 0 : 99 }), 'items');
});
test('Ruby coconut takes exactly three hits; crust takes four hammer or six other hits, including mixed tools', () => {
  let s = applyRequest(debugState(3), 'coconut');
  for (let i = 0; i < 3; i++) { s = applyRequest(s, 'hit', 'axe'); assert.equal(s.stage, i < 2 ? 3 : 4); }
  for (const [tool, count] of Object.entries(RUBY.crustHits)) {
    s = debugState(4);
    for (let i = 0; i < count; i++) { s = applyRequest(s, 'crust', tool); assert.equal(s.shell, i < count - 1 ? null : 'conch'); }
  }
  s = debugState(4); for (const tool of ['hammer', 'axe', 'sword', 'hammer']) s = applyRequest(s, 'crust', tool);
  assert.equal(s.crustHits, 10); assert.equal(s.shell, null);
  assert.equal(applyRequest(s, 'crust', 'axe').shell, 'conch');
});
test('Ruby places are deterministic and clear of the real Emberleaf props, garden and cove', () => {
  assert.deepEqual(plan.summary(), rubyPlan().summary());
  for (const spot of plan.spots) {
    assert.ok(isWalkable(spot.x, spot.z)); assert.equal(spot.y, getHeight(spot.x, spot.z)); assert.equal(overlapsAny(spot.x, spot.z, 0.9), false);
    for (const it of getInteractables()) assert.ok(Math.hypot(it.position.x - spot.x, it.position.z - spot.z) >= 0.9 + it.radius);
    const L = coveLayout();
    for (const c of [...L.wreck.colliders, { ...L.leanTo }, ...L.rocks]) assert.ok(Math.hypot(c.x - spot.x, c.z - spot.z) > c.r + 0.4);
    for (const p of real.placement.garden.plots) assert.ok(Math.hypot(p.x - spot.x, p.z - spot.z) >= 1.1);
  }
  assert.ok(getColliders().length > 50);
  const fire = FIRES.find(f => f.id === 'ember'); assert.ok(Math.hypot(plan.hearth.x - fire.x, plan.hearth.z - fire.z) < 7);
});
test('Ruby seven still stones pass the real hop validator and never steal tutorial/deck pads', () => {
  const c = plan.course, L = coveLayout(), result = validateCourse(c, { height: getHeight });
  assert.equal(result.ok, true, result.errors.join('\n')); assert.equal(c.pads.length, 7); assert.ok(c.pads.every(p => !p.motion));
  for (const course of [L.course, L.repair.course, c]) registerCourse(course);
  for (const pad of c.pads) assert.equal(courseAt(pad.x, pad.z), c);
  for (const pad of L.course.pads) assert.equal(courseAt(pad.x, pad.z), L.course);
  for (const course of [L.course, L.repair.course, c]) unregisterCourse(course);
});
function pair() {
  let now = 1000; const queue = [], bag = {}, held = new Map();
  const hostSync = new WorldSync({ wallNow: () => now }), replicaSync = new WorldSync({ role: 'replica', wallNow: () => now });
  const inventory = { count: id => bag[id] || 0, add: (id, n) => { bag[id] = (bag[id] || 0) + n; }, removeAll(need) { if (!Object.entries(need).every(([id, n]) => this.count(id) >= n)) return false; for (const [id, n] of Object.entries(need)) bag[id] -= n; return true; } };
  const petsH = createPetsDomain({ sync: hostSync, params: new URLSearchParams('testruby') }), petsR = createPetsDomain({ sync: replicaSync });
  const cin = { busy: false }, params = new URLSearchParams('testruby');
  const host = createRuby({ sync: hostSync, plan, inventory, pets: petsH, heldKind: key => held.get(key), cinematic: cin, params });
  const replica = createRuby({ sync: replicaSync, plan, pets: petsR });
  hostSync.attachHost({ sendTo: (_, m) => queue.push([replicaSync, m]), broadcast: m => queue.push([replicaSync, m]) });
  replicaSync.attachReplica({ send: m => { queue.push([hostSync, m]); return true; } });
  function flush() { while (queue.length) { const [to, m] = queue.shift(); if (to === hostSync) to.screenMessage(1, m); else to.receive(m); } }
  replicaSync.linkUp(); hostSync.screenConnected(1, { clientId: 'ruby-friend' }); flush();
  const p = { index: 0, position: new THREE.Vector3() };
  const move = (spot) => p.position.set(plan[spot].x, plan[spot].y, plan[spot].z);
  const ask = async kind => { const r = replica.request(kind, p); flush(); return await r; };
  const equal = () => assert.equal(hostSync.hash(), replicaSync.hash());
  return { host, replica, hostSync, replicaSync, petsH, petsR, inventory, bag, held, cin, p, move, ask, flush, equal,
    tool(kind) { held.set(`${replicaSync.screenId}:0`, kind); },
    step(dt) { host.update(dt); flush(); }, wall(seconds) { now += seconds * 1000; host.update(); flush(); } };
}
test('Ruby host + replica play the whole ladder: gifts spent once, replica hits, shared skip, equal hashes', async () => {
  const t = pair(); t.move('thief'); assert.equal((await t.ask('sight')).ok, true); t.equal();
  t.move('dig'); t.tool('shovel'); assert.equal((await t.ask('dig')).ok, true);
  t.move('pool'); assert.equal((await t.ask('offer')).ok, true); t.step(0); t.equal();
  let skip = t.replica.skip(); t.flush(); assert.equal((await skip).ok, true); assert.equal(t.host.stage, 2); t.equal();
  t.move('goal'); assert.equal((await t.ask('hop')).ok, true); t.move('pool'); assert.equal((await t.ask('offer')).ok, true); t.step(0); t.step(3); t.equal();
  assert.equal((await t.ask('coconut')).reason, 'items'); t.inventory.add('coconut', 1);
  assert.equal((await t.ask('coconut')).ok, true); assert.equal(t.bag.coconut, 0); assert.equal((await t.ask('coconut')).reason, 'taken');
  t.tool('hammer'); for (let i = 0; i < 3; i++) assert.equal((await t.ask('hit')).ok, true);
  t.step(0); t.wall(3); assert.equal(t.host.stage, 4); t.equal();
  t.move('crust'); for (let i = 0; i < 4; i++) assert.equal((await t.ask('crust')).ok, true);
  t.move('pool'); assert.equal((await t.ask('offer')).ok, true); t.step(0); t.step(3); assert.equal(t.host.stage, 5);
  t.move('fire'); for (const [id, n] of Object.entries(RUBY.gifts)) t.inventory.add(id, n);
  assert.equal((await t.ask('hearth')).ok, true); assert.ok(Object.values(t.bag).every(n => n === 0));
  assert.equal((await t.ask('hearth')).reason, 'busy'); t.step(0); t.step(2); t.equal();
  skip = t.replica.skip(); t.flush(); assert.equal((await skip).ok, true); t.equal();
  assert.equal(t.host.stage, 6); assert.equal(t.petsH.has('ruby'), true); assert.equal(t.petsR.has('ruby'), true);
});
test('Ruby queued scenes wait for the cinematic owner, then finish under fast stepping without wall time', () => {
  const t = pair(); t.cin.busy = true; t.host.debug.befriend(); t.flush(); t.step(100);
  assert.equal(t.host.scene.startAt, null); assert.equal(t.host.stage, 5);
  t.cin.busy = false; t.step(0.1); assert.notEqual(t.host.scene.startAt, null);
  for (let i = 0; i < 61; i++) t.step(0.1);
  assert.equal(t.host.stage, 6); assert.equal(t.host.scene, null); t.equal();
});
test('Ruby replica cannot debug and cannot retrieve a shell from far away or beneath its stone', async () => {
  const t = pair(); const debug = t.replica.debug.stage(6); t.flush(); assert.equal((await debug).ok, false);
  t.host.debug.stage(2); t.flush(); t.move('goal'); t.p.position.y = -3;
  assert.equal((await t.ask('hop')).reason, 'far'); t.p.position.y = plan.goal.y; t.p.position.x += 50;
  assert.equal((await t.ask('hop')).reason, 'far'); t.equal();
});
test('Ruby stage gate ignores day/night changes and offline catch-up', () => {
  const t = pair(), clock = new DayNight({ persist: false, params: new URLSearchParams() });
  for (let stage = 0; stage <= 5; stage++) {
    t.host.debug.stage(stage); const before = JSON.stringify(t.host.state);
    for (const hour of [5, 12, 19, 0]) clock.set(hour);
    clock.update(1000); clock.flushCatchUp(); t.step(100000);
    assert.equal(JSON.stringify(t.host.state), before);
  }
});
test('Ruby paid hearth survives reload, preserving neighbouring Emberleaf save keys', () => {
  emberSave.set('ruby', { ...debugState(5), homeReady: true }); emberSave.set('rubyNeighbourTest', { keep: 76 });
  const sync = new WorldSync(), pets = { questlinesOpen: true, has: () => false, unlock() {} };
  const r = createRuby({ sync, plan, pets }); r.update(0); assert.equal(r.scene.kind, 'befriend');
  r.update(6); assert.equal(r.stage, 6);
  const file = JSON.parse(storage.get(STORAGE_KEY)); assert.deepEqual(file.rubyNeighbourTest, { keep: 76 }); assert.equal(file.ruby.stage, 6);
  const testing = pair(); testing.host.debug.stage(3); testing.step(10); assert.equal(JSON.parse(storage.get(STORAGE_KEY)).ruby.stage, 6);
});
test('Ruby screen runtime registers once, drives swaps, shows three adopted crabs, asks each local player', () => {
  const t = pair(), scene = new THREE.Scene(), players = { list: [t.p] }, dialog = { isOpen: false, open(d) { this.current = d; this.isOpen = true; }, close() { this.isOpen = false; } };
  t.p.colors = { ui: '#fff' }; const courses = [], picked = [];
  const cin = { busy: false, startPos: new THREE.Vector3(), begin() { this.busy = true; return true; }, freezeAll() {}, releaseAll() {}, end() { this.busy = false; }, pollSkip() { return false; }, showBanner() {}, look() {} };
  const w = createRubyWorld({ scene, ruby: t.host, plan, players, inventory: t.inventory, items: { swing: () => true }, pets: { set: (_, id) => picked.push(id) }, domain: t.petsH, dialog, cinematic: cin, hop: { add: c => courses.push(c) } });
  const registered = getInteractables().length;
  t.move('pool'); t.host.debug.stage(3); w.update(0.1); assert.equal(w.model.state.shell, 'turban');
  t.host.debug.crack(); t.step(0); w.update(0.1); assert.equal(w.model.state.anim, 'swap'); assert.equal(w.model.meshes[1].visible, false);
  t.step(2); w.update(0.1); assert.equal(w.model.state.shell, 'coconut');
  t.step(1); w.update(0.1); assert.equal(cin.busy, false);
  t.host.debug.befriend(); t.step(0); w.update(0.1); assert.equal(w.adopted.length, 3);
  t.step(4); w.update(0.1); assert.equal(w.adopted.filter(m => m.root.visible).length, 3);
  t.step(2); w.update(0.1); assert.equal(dialog.current.text, 'Bring Ruby along?'); dialog.current.choices[0].onSelect(); assert.deepEqual(picked, ['ruby']);
  assert.equal(w.summary().drawCalls, 13); assert.equal(getInteractables().length, registered); assert.equal(courses.length, 1);
  for (let i = 0; i < 5; i++) w.update(0.1); assert.equal(dialog.isOpen, false);
});
