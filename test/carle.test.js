// Step 74b: Carle's quest line "The Very Hungry Visitor" (the caterpillar's week on the home island). The config table against the catalogue, the pure rules (stage / day machine, normalising, validation, dawns, growth, texts),
// the home save file, the sapling's placement plan against the real home terrain, colliders and interactables, the `carle` domain on a real host + replica pair (replica feeding, reach, bag, one feeding per day, equal hashes,
// late snapshot, saves), dawn counting on a real day clock (live phases, daylock, debug jumps, hidden tab) and the user's acceptance example (feed day 1, close the game for 900 s, the day-2 feeding is open), and the world side
// with fakes (interactables, menu, feeding beat, ache, cocoon, pop-in vs silent load, the sapling collider, draw calls).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WorldSync } from '../public/js/net/worldSync.js';
import { CARLE, FIRES, OFFLINE } from '../public/js/config.js';
import { getItem } from '../public/js/game/catalog.js';
import {
  STAGES, DAY_COUNT, freshState, normaliseState, savedView, wireView, hashView, readSave, debugState, wantsOf, nextOf, isFull, hungry, ache, growth, needLine, hintFor, hintsFor,
  validateSight, validateFeed, validateHatch, applySight, applyFeed, applyDawns, dawnsBetween,
} from '../public/js/game/carleLogic.js';
import { homeCarlePlan } from '../public/js/world/islands/homeCarle.js';
import { getHeight, getGroundType, isWalkable } from '../public/js/world/terrain.js';
import { advanceClock } from '../public/js/game/offlineTime.js';
const storage = new Map();
globalThis.localStorage = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) };
const { homeSave, STORAGE_KEY } = await import('../public/js/game/homeSave.js');
const { createCarle, SAVE_KEY } = await import('../public/js/game/carle.js');
const { createPetsDomain } = await import('../public/js/game/petsDomain.js');
const { DayNight } = await import('../public/js/world/dayNight.js');
const { getInteractables } = await import('../public/js/world/interactables.js');
const { getColliders, overlapsAny } = await import('../public/js/world/colliders.js');
const { createCarleWorld, saplingGeometry } = await import('../public/js/world/carleWorld.js');

// ---- the real home trees (props.js needs a canvas for its sign texture: a no-op fake just for this call) -----------------------------------------------------------------
async function homeTrees() {
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : k === 'measureText' ? () => ({ width: 10 }) : (k === 'createLinearGradient' || k === 'createRadialGradient') ? () => ({ addColorStop() {} }) : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
  const had = Object.getOwnPropertyDescriptor(globalThis, 'document');
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx, style: {} }) };
  try {
    const { createProps } = await import('../public/js/world/props.js');
    const props = createProps(new THREE.Scene());
    return props.handles.trees.map((g) => ({ x: g.position.x, z: g.position.z, y: g.position.y, scale: g.scale.x, cherry: !!g.userData.cherry }));
  } finally { if (had) Object.defineProperty(globalThis, 'document', had); else delete globalThis.document; }
}
await homeTrees();                                           // (the home props register their colliders / interactables, which the plan avoids)
const plan = homeCarlePlan();

// ---- the config table ------------------------------------------------------------------------------------------------------------------------------------------------
test('the week: seven days, the counts rise one a day, every item exists in the catalogue on the island the table says', () => {
  assert.equal(CARLE.days.length, 7); assert.equal(DAY_COUNT, 7); assert.equal(CARLE.cocoonDays, 3);
  assert.deepEqual(CARLE.days.slice(0, 5).map((d) => Object.values(d.items)[0]), [1, 2, 3, 4, 5], 'one more each day');
  assert.deepEqual(Object.keys(CARLE.days[5].items), ['berry-jam', 'lingonberry-tart', 'grilled-banana'], 'the feast: a dish from each island');
  assert.deepEqual(CARLE.days[6].items, { mint: 1 });
  CARLE.days.forEach((day, k) => {
    const ids = Object.keys(day.items);
    assert.equal(day.from.length, ids.length === 1 ? 1 : 3, `day ${k + 1}`);
    ids.forEach((id, i) => {
      const def = getItem(id);
      assert.ok(def, `${id} is in the catalogue`);
      assert.equal(def.islands[0], day.from[ids.length === 1 ? 0 : i], `${id} is from ${day.from[i]}`);
      assert.ok(Number.isInteger(day.items[id]) && day.items[id] >= 1);
    });
  });
  assert.equal(getItem('berry-jam').kind, 'dish'); assert.equal(getItem('lingonberry-tart').kind, 'dish'); assert.equal(getItem('grilled-banana').kind, 'dish');
  assert.deepEqual(CARLE.growth, { from: 1, to: 1.35 });
});

// ---- pure rules ------------------------------------------------------------------------------------------------------------------------------------------------------
test('the stage / day machine: sight, seven feedings, one per day, the week ends in the cocoon then three dawns reach ready', () => {
  assert.equal(STAGES.length, 6);
  let s = freshState(); assert.deepEqual([s.stage, s.day, s.fedToday], [0, 0, false]); assert.equal(wantsOf(s), null); assert.equal(nextOf(s), null);
  s = applySight(s); assert.equal(s.stage, 1); assert.equal(applySight(s), s, 'sighting is idempotent');
  assert.equal(hungry(s), true); assert.deepEqual(wantsOf(s), { apple: 1 });
  for (let d = 1; d <= 6; d++) {
    s = applyFeed(s);
    assert.deepEqual([s.stage, s.day, s.fedToday], [2, d, true], `day ${d}`);
    assert.equal(isFull(s), true); assert.equal(wantsOf(s), null, 'full: wants nothing until the next dawn');
    assert.deepEqual(nextOf(s), CARLE.days[d].items, 'but the next day is known');
    assert.equal(applyFeed({ ...s, fedToday: true }).day, d + 1, 'the rule layer does not itself block (the validator does); the day only goes up by feeding');
    s = applyDawns(s, 1); assert.equal(s.fedToday, false); assert.equal(s.day, d); assert.deepEqual(wantsOf(s), CARLE.days[d].items);
  }
  s = applyFeed(s);                                           // the seventh: the mint
  assert.deepEqual([s.stage, s.day, s.fedToday, s.cocoonDays], [3, 7, false, 0], 'the cocoon: stage 3, nothing hungry');
  assert.equal(wantsOf(s), null); assert.equal(applyFeed(s), s, 'a finished week feeds no more'); assert.equal(applyDawns(s, 5).stage, 4, 'cocoon dawns reach ready');
});

test('several dawns without feeding never skip a day; a feeding day is only ever the next one', () => {
  let s = applyFeed(applySight(freshState()));
  s = applyDawns(applyDawns(applyDawns(s, 1), 1), 3); assert.equal(s.day, 1); assert.equal(s.fedToday, false);
  assert.equal(applyDawns(s, 2), s, 'a hungry caterpillar has nothing to clear'); assert.equal(applyDawns(s, 0), s); assert.equal(applyDawns(s, -1), s);
  assert.equal(applyDawns(freshState(), 3).stage, 0, 'an unseen caterpillar ignores dawns');
});

test('the tummy ache runs from the day-6 feast to the day-7 mint; it grows a little with every feeding', () => {
  const sixDone = debugState(2); let s = { ...sixDone, day: 6, fedToday: false };
  assert.equal(ache(s), true); assert.equal(ache(applyFeed(s)), false, 'the mint cures it'); assert.equal(ache({ ...s, day: 5 }), false); assert.equal(ache(freshState()), false);
  assert.equal(growth(freshState()), 1); near(growth({ ...s, day: 7, stage: 3 }), 1.35);
  for (let d = 0; d < 7; d++) assert.ok(growth({ ...s, day: d }) < growth({ ...s, day: d + 1 }), 'bigger every day');
});
const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} != ${b}`);

test('normaliseState makes any saved / received state consistent (and the save round-trips)', () => {
  assert.deepEqual(normaliseState(null), freshState()); assert.deepEqual(normaliseState('junk'), freshState()); assert.deepEqual(readSave(undefined), freshState());
  assert.equal(normaliseState({ stage: 9 }).stage, 5); assert.equal(normaliseState({ stage: -3 }).stage, 0); assert.equal(normaliseState({ stage: 'x' }).stage, 0);
  assert.deepEqual([normaliseState({ day: 7 }).stage, normaliseState({ day: 3 }).stage, normaliseState({ day: 99 }).day], [3, 2, 7], 'a day count implies a stage');
  assert.equal(normaliseState({ stage: 3, day: 0 }).day, 7); assert.equal(normaliseState({ stage: 2, day: 0 }).day, 1); assert.equal(normaliseState({ stage: 1, day: 4 }).stage, 2);
  assert.equal(normaliseState({ stage: 1, fedToday: true }).fedToday, false, 'fedToday needs a day done'); assert.equal(normaliseState({ stage: 2, day: 2, fedToday: true }).fedToday, true);
  assert.equal(normaliseState({ stage: 3, day: 7, fedToday: true }).fedToday, false); assert.equal(normaliseState({ stage: 2, day: 2, fedToday: 'yes' }).fedToday, false);
  assert.equal(normaliseState({ stage: 2, cocoonDays: 2 }).cocoonDays, 0, 'cocoon days only from stage 3');
  assert.deepEqual([normaliseState({ stage: 3, cocoonDays: 9 }).stage, normaliseState({ stage: 3, cocoonDays: 9 }).cocoonDays], [4, 3], 'enough cocoon days make it ready');
  assert.equal(normaliseState({ stage: 3, cocoonDays: 1 }).cocoonDays, 1); assert.equal(normaliseState({ stage: 5 }).cocoonDays, 3);
  assert.equal(normaliseState({ phase: 'dawn' }).phase, 'dawn'); assert.equal(normaliseState({ phase: 'noon' }).phase, null);
  for (let n = 0; n <= 5; n++) { const d = debugState(n); assert.equal(d.stage, n); assert.deepEqual(normaliseState(d), d, `debugState(${n}) is already consistent`); assert.deepEqual(normaliseState(JSON.parse(JSON.stringify(savedView(d)))), d); }
  assert.deepEqual(Object.keys(savedView(freshState())).sort(), ['cocoonDays', 'day', 'fedToday', 'phase', 'stage']);
  assert.deepEqual(Object.keys(wireView(freshState())).sort(), ['cocoonDays', 'day', 'fedToday', 'stage']); assert.equal(hashView, wireView);
  assert.deepEqual(debugState(2), { stage: 2, day: 1, fedToday: false, cocoonDays: 0, phase: null });
});

test('validation reasons: locked, unseen, wrong day, full, far, none, done; sight: seen, far, locked', () => {
  const have = (n) => (id) => (CARLE.days[0].items[id] ? n : 0);
  const s0 = freshState(), s1 = applySight(s0), s2 = applyFeed(s1), s2b = { ...s2, fedToday: false };
  const feed = (state, over = {}) => validateFeed({ state, day: state.day + 1, have: (id) => 99, ...over });
  assert.equal(feed(s0), 'unseen'); assert.equal(feed(s1), null); assert.equal(feed(s1, { open: false }), 'locked');
  assert.equal(feed(s1, { day: 2 }), 'wrong-day'); assert.equal(feed(s1, { day: 0 }), 'wrong-day'); assert.equal(feed(s1, { day: 1.5 }), 'bad-request'); assert.equal(feed(s1, { day: 'x' }), 'bad-request');
  assert.equal(feed(s1, { have: have(0) }), 'none'); assert.equal(validateFeed({ state: s1, day: 1, have: () => 0 }), 'none'); assert.equal(validateFeed({ state: s1, day: 1 }), 'bad-request', 'have is required');
  assert.equal(feed(s2), 'full'); assert.equal(feed(s2b, { have: () => 1 }), 'none', 'day 2 wants two lingonberries'); assert.equal(feed(s2b), null);
  assert.equal(feed(s1, { dist: 99 }), 'far'); assert.equal(feed(s1, { dist: CARLE.feedReach }), null);
  assert.equal(feed(debugState(3)), 'done'); assert.equal(validateFeed({ state: null, day: 1, have: () => 1 }), 'bad-request');
  const feast = { ...debugState(2), day: 5, fedToday: false };
  assert.equal(validateFeed({ state: feast, day: 6, have: (id) => (id === 'berry-jam' || id === 'grilled-banana' ? 1 : 0) }), 'none', 'day 6 needs ALL three dishes');
  assert.equal(validateFeed({ state: feast, day: 6, have: () => 1 }), null);
  assert.equal(validateSight({ state: s0 }), null); assert.equal(validateSight({ state: s1 }), 'seen'); assert.equal(validateSight({ state: s0, dist: 99 }), 'far'); assert.equal(validateSight({ state: s0, dist: 3 }), null); assert.equal(validateSight({ state: s0, open: false }), 'locked');
});

test('dawnsBetween counts dawns on a forward walk (reusing the garden helper)', () => {
  assert.equal(dawnsBetween('night', 'dawn'), 1); assert.equal(dawnsBetween('day', 'dawn'), 1); assert.equal(dawnsBetween('dawn', 'day'), 0); assert.equal(dawnsBetween('dawn', 'dawn'), 0); assert.equal(dawnsBetween('dawn', 'night'), 0);
  assert.equal(dawnsBetween('dawn', 'bogus'), 0); assert.equal(dawnsBetween(null, 'dawn'), 0);
});

test('menu texts: the item lines and where each item comes from', () => {
  assert.equal(needLine({ apple: 1 }), '1 Apple'); assert.equal(needLine({ lingonberry: 2 }), '2 Lingonberries'); assert.equal(needLine({ 'berry-jam': 1, 'grilled-banana': 1 }), '1 Berry Jam, 1 Grilled Banana');
  assert.match(hintFor('lingonberry'), /Frostpine/); assert.match(hintFor('banana'), /Emberleaf/); assert.match(hintFor('apple'), /home/); assert.match(hintFor('mint'), /Frostpine/);
  assert.match(hintFor('lingonberry-tart'), /Cook .*Frostpine/); assert.match(hintFor('grilled-banana'), /Cook .*Emberleaf/); assert.match(hintFor('berry-jam'), /Cook .*home/); assert.equal(hintFor('nonsense'), '');
  assert.deepEqual(hintsFor(CARLE.days[5].items, (id) => (id === 'berry-jam' ? 1 : 0)).length, 2, 'only the missing dishes get a line');
  assert.deepEqual(hintsFor({ apple: 1 }, () => 1), []);
});

// ---- the home save ---------------------------------------------------------------------------------------------------------------------------------------------------
test('the home save file keeps one key per module and round-trips; a blocked / junk file is ignored', () => {
  storage.clear(); homeSave.reset();
  assert.equal(STORAGE_KEY, 'infinite-island.home.v1'); assert.deepEqual(homeSave.read(), {});
  homeSave.set('carle', { stage: 2 }); homeSave.set('other', 5);
  assert.deepEqual(JSON.parse(storage.get(STORAGE_KEY)), { carle: { stage: 2 }, other: 5, v: 1 });
  homeSave.reset(); assert.equal(homeSave.read().carle.stage, 2);
  homeSave.reset(); storage.set(STORAGE_KEY, 'not json'); assert.deepEqual(homeSave.read(), {});
  homeSave.reset(); storage.set(STORAGE_KEY, '[1,2]'); assert.deepEqual(homeSave.read(), {});
  homeSave.reset(); storage.clear();
});

// ---- the plan --------------------------------------------------------------------------------------------------------------------------------------------------------
test('the plan: a sapling 5.5-7 u from the home campfire on the camera side, on free walkable grass, with a big leaf perch and a branch for the cocoon', () => {
  const fire = FIRES[0], sp = plan.sapling, S = CARLE.sapling;
  assert.ok(sp && plan.perch && plan.hang && plan.collider);
  assert.ok(sp.dist >= 5.5 - 1e-9 && sp.dist <= 7 + 1e-9 && sp.dist > fire.clear, `${sp.dist} u from the fire`);
  near(sp.dist, Math.hypot(sp.x - fire.x, sp.z - fire.z), 1e-9);
  assert.ok(sp.z > fire.z + 3, 'on the +Z side: the follow camera looks north from the south');
  assert.ok(isWalkable(sp.x, sp.z)); near(sp.y, getHeight(sp.x, sp.z), 1e-9);
  for (let k = 0; k < 8; k++) {                                                      // grass all round the room circle: no trail, stream, sand or cliff
    const a = k * Math.PI / 4, x = sp.x + Math.cos(a) * S.room * 0.7, z = sp.z + Math.sin(a) * S.room * 0.7;
    assert.equal(getGroundType(x, z), 'grass'); assert.ok(isWalkable(x, z)); assert.ok(Math.abs(getHeight(x, z) - sp.y) <= 0.3);
  }
  assert.equal(getGroundType(sp.x, sp.z), 'grass');
  assert.equal(overlapsAny(sp.x, sp.z, S.room), false, 'clear of every collider (trees, benches, rocks...)');
  for (const it of getInteractables()) assert.ok(Math.hypot(it.position.x - sp.x, it.position.z - sp.z) >= S.room + (it.radius || 0) - 1e-9, 'clear of every other interactable');
  const up = plan.perch.y - sp.y; assert.ok(up >= 0.6 && up <= 0.9, `the leaf seat is ${up} u up`); near(plan.perch.z - sp.z, S.leafOut, 1e-9); near(plan.perch.x, sp.x, 1e-9);
  assert.equal(plan.perch.kind, 'sapling'); near(plan.hang.y - sp.y, S.hangY, 1e-9); near(plan.hang.x - sp.x, S.hangOut, 1e-9);
  assert.deepEqual(plan.collider, { x: sp.x, z: sp.z, r: S.trunkR }); assert.deepEqual(plan.spots, [plan.perch]);
  assert.equal(homeCarlePlan().hash(), plan.hash(), 'deterministic'); assert.match(plan.hash(), /^[0-9a-f]{8}$/);
  assert.deepEqual(plan.summary().sapling.x, Math.round(sp.x * 100) / 100);
  console.log('carle sapling at', JSON.stringify(plan.summary().sapling));
});

test('the plan fans out from +Z and skips blocked spots; with nothing free there is simply no sapling (and nothing is invented)', () => {
  const fire = FIRES[0];
  const arc = homeCarlePlan({ overlaps: (x, z) => z > fire.z + 3 });                  // the whole camera side is taken
  assert.ok(arc.sapling && arc.sapling.dist >= 5.5 && arc.sapling.dist <= 7); assert.ok(Math.abs(arc.sapling.angle) > 0);
  const first = { position: { x: plan.sapling.x, z: plan.sapling.z }, radius: 0.5 };
  const moved = homeCarlePlan({ interactables: () => [first] }); assert.notDeepEqual([moved.sapling.x, moved.sapling.z], [plan.sapling.x, plan.sapling.z], 'an interactable on the best spot moves it');
  for (const none of [homeCarlePlan({ walkable: () => false }), homeCarlePlan({ ground: () => 'dirt' }), homeCarlePlan({ overlaps: () => true }), homeCarlePlan({ height: (x) => x * 5 })]) {
    assert.equal(none.sapling, null); assert.equal(none.perch, null); assert.equal(none.hang, null); assert.equal(none.collider, null); assert.deepEqual(none.spots, []); assert.equal(none.summary().sapling, null);
  }
  const free = homeCarlePlan({ overlaps: () => false, interactables: () => [] }); assert.equal(free.sapling.angle, 0, 'straight on the camera side when it is free');
});

test('the sapling geometry: one merged mesh about 1.25 u tall with oversized flat leaves, nothing above the seat leaf, a branch toward the cocoon', () => {
  const g = saplingGeometry(), S = CARLE.sapling;
  assert.ok(g.attributes.position.count > 100 && g.attributes.color && g.attributes.normal); g.computeBoundingBox();
  const b = g.boundingBox; assert.ok(b.max.y >= 1.1 && b.max.y <= 1.4, `height ${b.max.y}`); assert.ok(b.min.y >= -0.05);
  assert.ok(b.max.z >= S.leafOut + 0.3, 'the seat leaf reaches out toward the camera');
  const P = g.attributes.position; let above = 0;
  for (let i = 0; i < P.count; i++) { const x = P.getX(i), y = P.getY(i), z = P.getZ(i); if (Math.abs(x) < 0.5 && z > S.leafOut - 0.25 && y > S.leafY + 0.1) above++; }
  assert.equal(above, 0, 'no canopy above the caterpillar');
  g.dispose();
});

// ---- the domain: host + replica --------------------------------------------------------------------------------------------------------------------------------------
function pair(opts = {}) {
  storage.clear(); homeSave.reset();
  if (opts.saved) storage.set(STORAGE_KEY, JSON.stringify({ v: 1, carle: opts.saved }));
  let time = 5000; const q = [], replicas = new Map();
  const hSync = new WorldSync({ role: 'host', wallNow: () => time }), rSync = new WorldSync({ role: 'replica', wallNow: () => time });
  replicas.set(1, rSync);
  hSync.attachHost({ sendTo: (tid, m) => q.push([replicas.get(tid), m]), broadcast: (m) => { for (const r of replicas.values()) q.push([r, m]); } });
  rSync.attachReplica({ send: (m) => { q.push([hSync, m, 1]); return true; } });
  const flush = () => { while (q.length) { const [to, m, tid] = q.shift(); if (to === hSync) hSync.screenMessage(tid, m); else to.receive(m); } };
  const bag = {}, inventory = {
    count: (id) => bag[id] || 0, add: (id, n) => { bag[id] = (bag[id] || 0) + n; },
    removeAll: (need) => { if (!Object.entries(need).every(([id, n]) => (bag[id] || 0) >= n)) return false; for (const [id, n] of Object.entries(need)) bag[id] -= n; return true; },
  };
  const petsH = createPetsDomain({ sync: hSync, params: opts.testpet ? new URLSearchParams('testpet') : undefined }), petsR = createPetsDomain({ sync: rSync });
  const clock = opts.clock === false ? null : (opts.clock || new DayNight({ persist: false, params: new URLSearchParams() }));
  if (clock && opts.hour !== undefined) clock.set(opts.hour);
  const host = createCarle({ sync: hSync, plan, inventory, pets: petsH, clock, cinematic: opts.cinematic, params: opts.params });
  const replica = createCarle({ sync: rSync, plan, pets: petsR });
  rSync.linkUp(); hSync.screenConnected(1, { clientId: 'friend' }); flush();
  const at = plan.spots[0], near = { x: at.x, y: 1, z: at.z };
  const mk = (pos) => ({ index: 0, position: pos });
  return { hSync, rSync, host, replica, petsH, petsR, bag, inventory, clock, flush, hostP: mk({ ...near }), shore: mk(near), far: mk({ x: at.x + 60, y: 1, z: at.z }), near,
    advance: (seconds) => { time += seconds * 1000; host.update(); flush(); },
    equal: () => assert.equal(hSync.hash(), rSync.hash(), 'hashes equal'),
    late() {
      const sync = new WorldSync({ role: 'replica', wallNow: () => time }); replicas.set(2, sync);
      sync.attachReplica({ send: (m) => { q.push([hSync, m, 2]); return true; } });
      createPetsDomain({ sync }); const c = createCarle({ sync, plan }); sync.linkUp(); hSync.screenConnected(2, { clientId: 'late' }); flush();
      return { sync, carle: c };
    } };
}
const reject = (r) => (r && r.ok === false ? r.reason : r && r.reject);

test('the quest does nothing until a pet is unlocked (?testcarle opens it without saving)', () => {
  const t = pair({ testpet: false });
  assert.equal(t.host.open, false); assert.equal(reject(t.host.sight(t.hostP)), 'locked'); assert.equal(t.host.stage, 0);
  t.petsH.unlock('capray'); assert.equal(t.host.open, true); assert.equal(t.host.sight(t.hostP).ok, true); assert.equal(t.host.stage, 1);
  const x = pair({ params: new URLSearchParams('testcarle') });
  assert.equal(x.host.open, true); assert.equal(x.host.testcarle, true); assert.equal(x.host.sight(x.hostP).ok, true); assert.equal(storage.get(STORAGE_KEY), undefined, 'nothing saved');
  x.host.feed(x.hostP, 1); assert.equal(storage.get(STORAGE_KEY), undefined);
});

test('a host + replica pair: sight, feeding from the shared bag, the bag is charged once, one feeding per day, equal hashes', () => {
  const t = pair({ params: new URLSearchParams('testcarle') });
  t.equal();
  assert.equal(reject(t.host.feed(t.hostP, 1)), 'unseen');
  assert.equal(t.host.sight(t.hostP).ok, true); t.flush(); assert.equal(t.replica.stage, 1); t.equal();
  assert.equal(reject(t.host.sight(t.hostP)), 'seen');
  t.bag.apple = 1;
  assert.equal(reject(t.host.feed(t.hostP, 2)), 'wrong-day'); assert.equal(reject(t.host.feed(t.hostP, 'x')), 'bad-request'); assert.equal(t.bag.apple, 1, 'a refused feeding costs nothing');
  const heard = []; t.replica.on((kind, d) => heard.push([kind, d.day]));
  const r = t.replica.feed(t.shore, 1); t.flush();
  return Promise.resolve(r).then((res) => {
    assert.equal(res.ok, true); assert.equal(t.bag.apple, 0, 'the shared bag paid, once'); assert.deepEqual([t.host.state.day, t.host.state.fedToday], [1, true]);
    assert.deepEqual([t.replica.state.day, t.replica.state.fedToday, t.replica.state.stage], [1, true, 2]); assert.deepEqual(heard, [['feed', 1]]);
    t.equal();
    t.bag.lingonberry = 2;
    assert.equal(reject(t.host.feed(t.hostP, 2)), 'full', 'one feeding per day'); assert.equal(t.bag.lingonberry, 2);
    t.host.debug.dawn(1); t.flush(); assert.equal(t.replica.state.fedToday, false); t.equal();
    assert.equal(reject(t.host.feed(t.hostP, 1)), 'wrong-day', 'day 1 is done'); assert.equal(reject(t.host.feed(t.hostP, 3)), 'wrong-day');
    t.bag.lingonberry = 1; assert.equal(reject(t.host.feed(t.hostP, 2)), 'none'); assert.equal(t.bag.lingonberry, 1);
    t.bag.lingonberry = 2; assert.equal(t.host.feed(t.hostP, 2).ok, true); assert.equal(t.bag.lingonberry, 0);
  });
});

test('two players racing for one set of items: exactly one feeding, the bag never goes negative; remote reach is checked', async () => {
  const t = pair({ params: new URLSearchParams('testcarle') });
  t.host.sight(t.hostP); t.bag.apple = 1; t.flush();
  assert.equal(reject(await (async () => { const p = t.replica.feed(t.far, 1); t.flush(); return p; })()), 'far', 'a remote actor far from the perch');
  assert.equal(t.bag.apple, 1);
  const a = t.replica.feed(t.shore, 1), b = t.host.feed(t.hostP, 1); t.flush();
  const results = [await a, b];
  assert.equal(results.filter((x) => x.ok).length, 1); assert.deepEqual(results.map(reject).filter(Boolean).sort(), ['wrong-day'], 'the loser asked for a day that is already done');
  assert.equal(t.bag.apple, 0); t.equal();
  const sightFar = pair({ params: new URLSearchParams('testcarle') });
  const r = sightFar.replica.sight(sightFar.far); sightFar.flush(); assert.equal(reject(await r), 'far'); assert.equal(sightFar.host.stage, 0);
  const ok = sightFar.replica.sight(sightFar.shore); sightFar.flush(); assert.equal((await ok).ok, true); assert.equal(sightFar.host.stage, 1);
});

test('the whole week on a host + replica: seven feedings, the feast needs all three dishes, the mint ends it, hashes stay equal, a late joiner converges', async () => {
  const t = pair({ params: new URLSearchParams('testcarle') });
  t.host.sight(t.hostP); t.flush();
  for (let d = 1; d <= 7; d++) {
    for (const [id, n] of Object.entries(CARLE.days[d - 1].items)) t.bag[id] = n;
    if (d === 6) { delete t.bag['grilled-banana']; assert.equal(reject(t.host.feed(t.hostP, 6)), 'none', 'all three dishes or none'); t.bag['grilled-banana'] = 1; }
    const p = t.replica.feed(t.shore, d); t.flush();
    assert.equal((await p).ok, true, `day ${d}`);
    assert.equal(Object.values(t.bag).reduce((a, b) => a + b, 0), 0, 'exactly the day\'s items were spent');
    t.equal();
    if (d < 7) { assert.equal(t.host.state.stage, 2); t.host.debug.dawn(1); t.flush(); }
  }
  assert.equal(t.host.state.stage, 3); assert.equal(t.replica.state.stage, 3); assert.equal(t.replica.state.day, 7);
  const late = t.late(); assert.deepEqual(late.carle.state.day, 7); assert.equal(late.carle.state.stage, 3); assert.equal(t.hSync.hash(), late.sync.hash());
});

test('debug requests (host only): stage(n), fedDays(k), feed() free and ignoring "full", dawn(n), reset(); a replica cannot', async () => {
  const t = pair({ params: new URLSearchParams('testcarle') });
  t.host.debug.stage(2); assert.deepEqual([t.host.state.stage, t.host.state.day, t.host.state.fedToday], [2, 1, false]);
  t.host.debug.fedDays(5); assert.deepEqual([t.host.state.stage, t.host.state.day], [2, 5]); t.flush(); t.equal();
  assert.equal(t.host.debug.feed().ok, true); assert.equal(t.host.state.day, 6); assert.equal(t.host.state.fedToday, true);
  assert.equal(t.host.debug.feed().ok, true, 'ignores "full"'); assert.equal(t.host.state.stage, 3);
  assert.equal(reject(t.host.debug.feed()), 'done');
  t.host.debug.reset(); assert.deepEqual(wireView(t.host.state), wireView(freshState())); t.host.debug.feed(); assert.equal(t.host.state.stage, 2, 'feed() on an unseen one sights it first');
  t.host.debug.fedDays(7); assert.equal(t.host.state.stage, 3);
  t.host.debug.fedDays(0); assert.deepEqual([t.host.state.stage, t.host.state.day], [1, 0]);
  const r = t.replica.debug.stage(3); t.flush(); assert.equal(reject(await r), 'bad-request'); assert.equal(t.host.state.stage, 1);
  assert.equal(reject(t.host.sight(t.hostP)), 'seen');
});

test('the host saves the home-island key { stage, day, fedToday, cocoonDays, phase }; a reload restores it; ?newgame-style fresh files start fresh; replicas never save', () => {
  const t = pair({ params: undefined, testpet: true });
  t.host.sight(t.hostP); t.bag.apple = 1; t.host.feed(t.hostP, 1);
  const saved = JSON.parse(storage.get(STORAGE_KEY));
  assert.equal(saved.v, 1); assert.deepEqual(Object.keys(saved[SAVE_KEY]).sort(), ['cocoonDays', 'day', 'fedToday', 'phase', 'stage']);
  assert.deepEqual([saved[SAVE_KEY].stage, saved[SAVE_KEY].day, saved[SAVE_KEY].fedToday], [2, 1, true]); assert.equal(saved[SAVE_KEY].phase, t.clock.phase);
  const again = pair({ saved: saved[SAVE_KEY], testpet: true }); assert.deepEqual([again.host.state.stage, again.host.state.day, again.host.state.fedToday], [2, 1, true]);
  assert.deepEqual(wireView(again.replica.state), wireView(again.host.state), 'a joining replica gets the snapshot');
  const hostile = pair({ saved: { stage: 99, day: -4, fedToday: 'x', phase: 'moon' }, testpet: true }); assert.deepEqual(wireView(hostile.host.state), wireView(normaliseState({ stage: 99 })));
  const clean = pair({ testpet: true }); assert.equal(clean.host.stage, 0); assert.equal(storage.get(STORAGE_KEY), undefined, 'nothing is written until something changes');
  const rep = t.replica.summary(); assert.equal(rep.saved, false);
});

// ---- the day counter on a real clock ----------------------------------------------------------------------------------------------------------------------------------
function week(opts = {}) {
  const t = pair({ testpet: true, hour: 8, ...opts });
  t.host.sight(t.hostP); t.bag.apple = 5; t.host.feed(t.hostP, 1);
  return t;
}
const full = (t) => t.host.state.fedToday;

test('each dawn the clock crosses clears "full": playing through the night, a debug set over a dawn, and several dawns never skip a day', () => {
  const t = week();
  assert.equal(full(t), true);
  t.clock.update(300); assert.equal(full(t), true, 'the afternoon');
  t.clock.set(17.9); t.clock.update(10); t.clock.update(45); assert.equal(full(t), true, 'dusk, then night');
  t.clock.set(4.9); t.clock.update(20); assert.equal(t.clock.phase, 'dawn'); assert.equal(full(t), false, 'dawn: hungry again');
  assert.equal(t.host.state.day, 1);
  t.host.debug.feed(); assert.equal(t.host.state.day, 2); assert.equal(full(t), true);
  t.clock.set(5.5);                                          // a debug jump: day -> ... wait: already dawn; jump to day then over a dawn
  assert.equal(full(t), true, 'dawn -> dawn is no boundary');
  t.clock.set(8); assert.equal(full(t), true, 'dawn -> day counts nothing');
  t.clock.set(5.5); assert.equal(full(t), false, 'day -> dawn crosses one dawn');
  t.clock.set(8); t.clock.set(5.5); t.clock.set(8); t.clock.set(5.5); assert.equal(t.host.state.day, 2, 'many dawns without a feeding: the day number only moves by feeding');
});

test('?daylock stops the count (the clock never changes phase); a replica does not count; stage 0 counts nothing', () => {
  const locked = week({ clock: new DayNight({ persist: false, params: new URLSearchParams('daylock&time=18') }) });
  locked.clock.update(5000); assert.equal(full(locked), true, 'a locked clock crosses no boundary');
  const t = pair({ testpet: true, hour: 4.9 }); t.clock.update(20); assert.equal(t.host.state.stage, 0);
  const w = week(); assert.equal(w.replica.state.phase, null, 'the private phase never reaches a replica'); assert.equal(typeof w.host.state.phase, 'string');
});

test('a hidden-tab catch-up counts the dawns it crossed (and adopts the clock phase); a short one does not', () => {
  let wall = 7_000_000;
  const clock = new DayNight({ persist: false, now: () => wall, params: new URLSearchParams() });
  const t = week({ clock });
  clock.setHidden(true); wall += 540 * 1000; clock.setHidden(false);               // 8 h -> 540 s later: dusk is over, still in the night, 12 s before dawn (dawn is 552 s away)
  assert.equal(clock.phase, 'night'); assert.equal(full(t), true); assert.equal(t.host.state.phase, 'night');
  clock.setHidden(true); wall += 30 * 1000; clock.setHidden(false);               // the dawn passes while hidden
  assert.equal(full(t), false, 'the hidden dawn counted'); assert.equal(t.host.state.phase, clock.phase);
  clock.update(1); assert.equal(t.host.state.day, 1);
});

test('the user\'s acceptance example: feed day 1, the game is closed for 900 s, reopen: the day-2 feeding is open (and a short absence leaves it full)', () => {
  storage.clear(); homeSave.reset();
  let wall = 1_700_000_000_000;
  const session = (away) => {
    wall += away * 1000; homeSave.reset();
    const sync = new WorldSync({ role: 'host', wallNow: () => 0 }), bag = {};
    const inventory = { count: (id) => bag[id] || 0, removeAll: (need) => { if (!Object.entries(need).every(([id, n]) => (bag[id] || 0) >= n)) return false; for (const [id, n] of Object.entries(need)) bag[id] -= n; return true; } };
    const pets = createPetsDomain({ sync });
    const clock = new DayNight({ now: () => wall });                              // the real save path: time.v1 v2 with savedAt
    const carle = createCarle({ sync, plan, inventory, pets, clock });
    clock.flushCatchUp();
    return { sync, bag, pets, clock, carle, p: { index: 0, position: { x: plan.spots[0].x, y: 1, z: plan.spots[0].z } } };
  };
  let s = session(0); s.clock.set(8);
  s.pets.unlock('capray'); assert.equal(s.carle.sight(s.p).ok, true);
  s.bag.apple = 1; assert.equal(s.carle.feed(s.p, 1).ok, true);
  assert.equal(s.carle.state.fedToday, true); assert.equal(reject(s.carle.feed(s.p, 2)), 'full');
  s.clock.dispose();
  // closed for 100 s: no dawn
  s = session(100); assert.equal(s.clock.away.seconds, 100); assert.equal(s.carle.state.fedToday, true, 'still full after a short break'); s.clock.dispose();
  // closed for 900 s (more than one 630 s day): at least one dawn
  s = session(900);
  assert.equal(s.clock.away.seconds, 900); assert.ok(s.clock.away.entered.dawn >= 1);
  assert.deepEqual([s.carle.state.stage, s.carle.state.day, s.carle.state.fedToday], [2, 1, false], 'the dawn while away emptied its tummy');
  s.bag.lingonberry = 2; const r = s.carle.feed(s.p, 2);
  assert.equal(r.ok, true, 'the day-2 feeding is open'); assert.deepEqual([s.carle.state.day, s.carle.state.fedToday], [2, true]); assert.equal(s.bag.lingonberry, 0);
  assert.equal(JSON.parse(storage.get(STORAGE_KEY)).carle.day, 2, 'and saved');
  s.clock.dispose();
});

test('the same example through the ?away=900 debug flag (the clock was saved a moment ago): the dawns still count', () => {
  storage.clear(); homeSave.reset();
  const sync = new WorldSync({ role: 'host', wallNow: () => 0 });
  const clock = new DayNight({ persist: false, params: new URLSearchParams('away=900') });
  const pets = createPetsDomain({ sync, params: new URLSearchParams('testpet') });
  homeSave.set('carle', { stage: 2, day: 1, fedToday: true, cocoonDays: 0, phase: 'day' });
  const carle = createCarle({ sync, plan, pets, clock });
  assert.equal(carle.state.fedToday, true, 'before the catch-up reaches the listeners'); clock.flushCatchUp();
  assert.equal(carle.state.fedToday, false); assert.equal(carle.state.day, 1);
  const want = advanceClock(8, 900); assert.ok(want.entered.dawn >= 1);
});

// ---- the world side (fakes) ------------------------------------------------------------------------------------------------------------------------------------------
function worldRig(opts = {}) {
  storage.clear(); homeSave.reset();
  const scene = new THREE.Scene();
  let now = 1000;
  const sync = new WorldSync({ role: 'host', wallNow: () => now });
  const bag = {}, inventory = { count: (id) => bag[id] || 0, removeAll: (need) => { if (!Object.entries(need).every(([id, n]) => (bag[id] || 0) >= n)) return false; for (const [id, n] of Object.entries(need)) bag[id] -= n; return true; } };
  const petsD = createPetsDomain({ sync, params: opts.testpet ? new URLSearchParams('testpet') : undefined });
  const carle = createCarle({ sync, plan, inventory, pets: petsD, params: new URLSearchParams(opts.testcarle === false ? '' : 'testcarle') });
  const p = { index: 0, position: new THREE.Vector3(plan.perch.x + 2, 0, plan.perch.z), away: false, frozen: false, colors: { name: 'P1', ui: '#fff' }, faceToward() {} };
  const players = { list: [p], multi: false, p1: p };
  const dialog = { isOpen: false, last: null, open(o) { this.isOpen = true; this.last = o; }, close() { this.isOpen = false; } };
  const bubbles = [], thoughts = { show: (key, anchor, icon, o) => bubbles.push({ key, icon, o }), hide() {} };
  const toasts = [], hud = { toast: (t) => toasts.push(t) }, floats = [], bursts = [];
  const flags = { full: true };
  const world = { regions: { isFull: () => flags.full } };
  let busy = false;
  const cin = { get busy() { return busy; }, startPos: new THREE.Vector3(0, 10, 10), startLook: new THREE.Vector3(), begin() { if (busy) return false; busy = true; return true; }, end() { busy = false; }, freezeAll() {}, releaseAll() {}, pollSkip() { return false; }, look() {}, showBanner() {} };
  const sets = [], pets = { petOf: () => null, set: (p, id) => sets.push([p, id]) };
  const cw = createCarleWorld({
    scene, players, world, sync, carle, plan, domain: petsD, inventory, thoughts, particles: { burst: (...a) => bursts.push(a) }, sfx: { play() {} }, hud, dialog, cinematic: cin, camera: new THREE.PerspectiveCamera(), pets, floatText: (...a) => floats.push(a),
    heightAt: getHeight,
  });
  return { scene, sync, bag, petsD, carle, p, players, dialog, bubbles, thoughts, toasts, floats, bursts, flags, cw, inventory, sets, cin, step: (n = 1, dt = 0.05) => { for (let i = 0; i < n; i++) { now += dt * 1000; carle.update(); cw.update(dt); } } };
}

test('the world: the interactables are registered once (one per perch) and nothing is added or lost by more updates; the caterpillar appears only once the quest is open', () => {
  const before = getInteractables().length;
  const w = worldRig({ testcarle: false });
  assert.equal(getInteractables().length - before, 1, 'one interactable, at the sapling'); assert.equal(w.cw.interactables.length, 1);
  w.step(5); assert.equal(w.cw.shown, false, 'closed: nothing to see'); assert.equal(w.cw.model, null, 'and nothing built');
  w.petsD.unlock('capray'); w.step(5); assert.equal(w.cw.shown, true); assert.ok(w.cw.model.root.visible);
  w.step(40); assert.equal(getInteractables().length - before, 1);
  const x = worldRig(); x.step(2); assert.equal(x.cw.shown, true, '?testcarle opens it'); x.flags.full = false; x.step(1); assert.equal(x.cw.shown, false, 'only while the home island is drawn'); assert.equal(x.cw.model.root.visible, false);
});

test('the world: a live unlock pops it in; a load / late join shows it silently', () => {
  const live = worldRig({ testcarle: false }); live.step(2);
  live.petsD.unlock('capray'); live.step(1);
  assert.ok(live.cw.model.root.scale.x < 0.5, 'scaling in from nothing'); assert.ok(live.bursts.length > 0, 'a pop of sparkles');
  live.step(2, 0.1); live.step(10, 0.1); near(live.cw.model.root.scale.x, 1, 1e-6);
  const silent = worldRig({ testpet: true, testcarle: false }); silent.step(1); near(silent.cw.model.root.scale.x, 1, 1e-6);
  assert.ok(silent.bursts.length === 0, 'no pop particles on a load');
});

test('the world: walking up to it sights it once (the "?" beat, then the hunger bubble with today\'s food); the interactable offers a menu', () => {
  const w = worldRig(); w.p.position.set(plan.perch.x + 12, 0, plan.perch.z); w.step(3);
  assert.equal(w.carle.state.stage, 0, 'too far away');
  w.p.position.set(w.cw.where.x + 3, 0, w.cw.where.z); w.step(3);
  assert.equal(w.carle.state.stage, 1); w.step(1);
  w.step(60, 0.1);
  const keys = w.bubbles.map((b) => b.key); assert.ok(keys.includes('carle-say'), 'the beat bubbles');
  assert.ok(w.bubbles.some((b) => b.icon === getItem('apple').icon), 'the hunger bubble shows the apple');
  assert.ok(w.bubbles.some((b) => b.icon && b.icon.includes('M8 9.200')), 'the question mark');
  w.bubbles.length = 0; w.step(200, 0.1); assert.ok(w.bubbles.some((b) => b.key === 'carle-hint'), 'a hint now and then while someone is near');
});

test('the world: the menu says "Offer N x Item" when the bag has it, otherwise names where it comes from; a feeding runs the beat, spends the items and grows it', async () => {
  const w = worldRig(); w.carle.sight(w.p); w.step(2);
  const it = w.cw.interactables[0];
  assert.equal(it.prompt, 'Hungry...'); assert.equal(it.canInteract(), true);
  it.onInteract(it, w.p);
  assert.ok(w.dialog.isOpen); let rows = w.dialog.last.choices();
  assert.equal(rows[0].label, 'Offer 1 Apple'); assert.equal(rows[0].disabled, true); assert.match(rows[0].detail, /home/); assert.deepEqual(rows[0].chips, [{ icon: getItem('apple').icon, have: 0, need: 1 }]);
  assert.equal(rows[1].label, 'Not now'); rows[1].onSelect(); assert.equal(w.dialog.isOpen, false);
  w.bag.apple = 1; w.step(1); assert.equal(it.prompt, 'Offer');
  w.cw.openMenu(w.p); rows = w.dialog.last.choices(); assert.equal(rows[0].disabled, false); assert.equal(rows[0].detail, '');
  const s0 = w.cw.scale; rows[0].onSelect(); await Promise.resolve(); w.step(1);
  assert.equal(w.bag.apple, 0); assert.equal(w.carle.state.day, 1); assert.equal(w.dialog.isOpen, false);
  assert.ok(w.cw.beat.feed, 'the munching beat runs'); assert.equal(w.floats.length, 1); assert.deepEqual(w.floats[0].slice(0, 2), ['apple', -1]);
  w.step(10, 0.1); const mid = w.cw.summary(); assert.ok(mid.beat.feed, 'a piece of fruit is being eaten'); assert.ok(mid.drawCalls >= 4);
  w.step(40, 0.1); assert.equal(w.cw.beat.feed, null, 'the beat is over'); assert.ok(w.cw.scale > s0, 'it grew a little');
  assert.ok(w.bursts.some((b) => b[0] === 'heart'), 'hearts'); assert.equal(w.scene.children.filter((c) => c.isMesh && !c.isSkinnedMesh && c.userData.food).length, 0);
  // full: a "Zzz" line and no menu
  w.cw.openMenu(w.p); assert.deepEqual(w.dialog.last.pages, ['Zzz... Full! Come back tomorrow.']); w.dialog.close();
  assert.equal(it.prompt, 'Look');
  // the next dawn makes it hungry again (day 2: two lingonberries from Frostpine)
  w.carle.debug.dawn(1); w.step(1); w.cw.openMenu(w.p); rows = w.dialog.last.choices(); assert.equal(rows[0].label, 'Offer 2 Lingonberries'); assert.match(rows[0].detail, /Frostpine/);
});

test('the world: the feast day lists all three dishes; the tummy ache tints the head green and rolls until the mint, which cures it and wraps the week up in the cocoon', () => {
  const w = worldRig(); w.carle.debug.fedDays(5); w.step(2);
  w.cw.openMenu(w.p); let rows = w.dialog.last.choices(); w.dialog.close();
  assert.equal(rows[0].label, 'Offer 1 Berry Jam, 1 Lingonberry Tart, 1 Grilled Banana'); assert.equal(rows[0].chips.length, 3); assert.equal(rows[0].disabled, true);
  assert.equal(rows[0].detail.split('.').filter(Boolean).length, 3, 'a hint line per missing dish');
  assert.equal(w.cw.ache, 0);
  for (const id of ['berry-jam', 'lingonberry-tart', 'grilled-banana']) w.bag[id] = 1;
  w.cw.openMenu(w.p); w.dialog.last.choices()[0].onSelect(); w.step(60, 0.1);
  assert.equal(w.carle.state.day, 6); assert.ok(w.cw.beat.feed === null); w.step(40, 0.1);
  assert.ok(w.cw.ache > 0.95, 'a green face'); assert.ok(w.cw.model.state.ache > 0.95);
  w.carle.debug.dawn(1); w.step(1); w.cw.openMenu(w.p); assert.match(w.dialog.last.text, /tummy/); assert.equal(w.dialog.last.choices()[0].label, 'Offer 1 Mint'); w.dialog.close();
  w.bag.mint = 1; w.step(1); w.cw.openMenu(w.p); w.dialog.last.choices()[0].onSelect(); w.step(30, 0.1);
  assert.equal(w.carle.state.stage, 3); assert.equal(w.cw.summary().cocoon, false, 'the cocoon waits for the goodbye'); w.step(80, 0.1);
  assert.ok(w.cw.cocoon.root.visible && w.cw.summary().cocoon, 'the cocoon hangs at the perch'); assert.equal(w.cw.model.root.visible, false, 'the caterpillar is gone');
  assert.ok(w.cw.ache < 0.05, 'cured');
  const sw = w.cw.cocoon.shellPivot.rotation.z; w.step(20, 0.1); assert.notEqual(w.cw.cocoon.shellPivot.rotation.z, sw, 'it sways');
  w.bubbles.length = 0; w.cw.openMenu(w.p); assert.ok(w.bubbles.some((b) => b.key === 'carle-listen')); assert.equal(w.cw.interactables[0].prompt, 'Listen');
  assert.ok(w.cw.summary().drawCalls <= 8, `cheap: ${w.cw.summary().drawCalls}`);
});

test('the world: a saved stage 3 shows the cocoon silently; a set / snapshot jumps without a beat; reload keeps the caterpillar at its growth and tummy ache', () => {
  const w = worldRig(); w.carle.debug.stage(3); w.step(3);
  assert.ok(w.cw.cocoon.root.visible); assert.equal(w.cw.model.root.visible, false); assert.equal(w.cw.beat.goodbye, false);
  w.carle.debug.fedDays(6); w.step(2); near(w.cw.scale, 1 + 0.35 * 6 / 7, 0.02); assert.ok(w.cw.model.root.visible); assert.ok(w.cw.ache > 0.9, 'the ache is back at once (a set, no animation)');
  w.carle.debug.reset(); w.step(2); near(w.cw.scale, 1, 0.02); assert.ok(w.cw.ache < 0.05);
});

test('the world: the sapling is absent until the quest opens, then appears (with ONE trunk collider, registered once), and the cocoon hangs from its branch', () => {
  const cBefore = getColliders().length;
  const w = worldRig({ testcarle: false });
  w.step(5); assert.equal(w.cw.sapling, null, 'nothing built before the quest opens'); assert.equal(getColliders().length, cBefore, 'and nothing blocks the spot');
  w.petsD.unlock('capray'); w.step(3);
  assert.ok(w.cw.sapling.visible); assert.equal(getColliders().length, cBefore + 1); const col = getColliders().find((c) => c.owner === w.cw.sapling); assert.deepEqual([col.x, col.z, col.r], [plan.collider.x, plan.collider.z, plan.collider.r]);
  w.step(60, 0.1); assert.equal(getColliders().length, cBefore + 1, 'registered once'); near(w.cw.sapling.position.x, plan.sapling.x, 1e-9);
  w.flags.full = false; w.step(2); assert.equal(w.cw.sapling.visible, false); w.flags.full = true; w.step(2); assert.equal(getColliders().length, cBefore + 1, 'hiding and showing never re-registers');
  w.carle.debug.stage(3); w.step(3);
  const root = w.cw.cocoon.root; near(root.position.x, plan.hang.x, 1e-9); near(root.position.y, plan.hang.y - 0.02, 1e-9); near(root.position.z, plan.hang.z, 1e-9);
  assert.ok(plan.hang.x - 0.24 < plan.sapling.x + 0.58 && plan.hang.x + 0.32 > plan.sapling.x, 'its twig lies along the branch (the branch spans 0.58 u from the trunk toward +X)');
  assert.ok(w.cw.sapling.visible, 'the sapling stays (the cocoon hangs from it)');
  const sit = w.cw.interactables[0]; assert.equal(w.cw.interactables.length, 1); near(sit.position.x, plan.perch.x, 1e-9); near(sit.position.z, plan.perch.z, 1e-9);
});

test('the world: it stays inside the budget (a few draw calls) and builds nothing until it is needed', () => {
  const w = worldRig(); w.carle.debug.stage(1); w.step(2);
  const s = w.cw.summary(); assert.ok(s.drawCalls === 4, `idle: ${s.drawCalls} draw calls`); assert.equal(s.interactables, 1);
  assert.ok(w.cw.model.drawCalls === 2 && w.cw.model.length < 1 && w.cw.model.height < 1);
  const before = new THREE.Scene(); assert.equal(before.children.length, 0);
});

// ---- Step 74c: cocoon clock, hatch authority and screen presentation -----------------------------------
test('cocoon dawns: mint day 7, three live dawns OR three catch-up dawns reach ready; no further progress', () => {
  for (const offline of [false, true]) {
    const t = pair({ testpet: true, hour: 8 });
    t.host.debug.fedDays(6); t.host.debug.feed(); t.flush();
    assert.equal(t.host.stage, 3); assert.equal(t.host.state.cocoonDays, 0);
    if (offline) t.clock.catchUp(3 * 630);
    else for (let i = 0; i < 3; i++) { t.clock.set(8); t.clock.set(5.5); }
    t.flush(); assert.equal(t.host.stage, 4); assert.equal(t.replica.state.cocoonDays, 3); t.equal();
    t.clock.catchUp(10 * 630); t.flush(); assert.equal(t.host.stage, 4); t.equal();
  }
});

test('a 74b cocoon save resumes, a ready save loads ready, and catch-up can make a loaded cocoon ready', () => {
  const t = pair({ testpet: true, saved: { stage: 3, day: 7 }, hour: 8 });
  assert.equal(t.host.state.cocoonDays, 0);
  t.clock.catchUp(3 * 630); t.flush(); assert.equal(t.host.stage, 4); t.equal();
  const saved = JSON.parse(storage.get(STORAGE_KEY)).carle;
  assert.equal(saved.cocoonDays, 3);
  const r = pair({ testpet: true, saved }); assert.equal(r.host.stage, 4); r.equal();
});

test('hatch validation: ready only, local reach, remote slack, busy scene; no premature unlock', async () => {
  assert.equal(validateHatch({ state: debugState(3) }), 'not-ready');
  assert.equal(validateHatch({ state: debugState(4), dist: CARLE.feedReach + CARLE.remoteSlack }), null);
  assert.equal(validateHatch({ state: debugState(4), dist: CARLE.feedReach + CARLE.remoteSlack + 0.01 }), 'far');
  const cinematic = { busy: true }, t = pair({ testpet: true, cinematic });
  t.host.debug.ready(); t.flush();
  assert.equal(reject(t.host.hatch(t.hostP)), 'busy'); cinematic.busy = false;
  assert.equal(reject(t.host.hatch(t.far)), 'far');
  const far = t.replica.hatch(t.far); t.flush(); assert.equal(reject(await far), 'far');
  t.shore.position.x = t.near.x + CARLE.feedReach + CARLE.remoteSlack - 0.01;
  const good = t.replica.hatch(t.shore); t.flush(); assert.equal((await good).ok, true);
  assert.equal(t.host.stage, 4); assert.equal(t.petsH.has('carle'), false);
  t.equal();
});

test('host + replica hatch: queued behind cinematics, host clock finish OR shared skip, unlock and equal hashes', async () => {
  for (const skip of [false, true]) {
    const t = pair({ testpet: true }); t.host.debug.ready(); t.flush();
    const request = t.replica.hatch(t.shore); t.flush(); assert.equal((await request).ok, true);
    assert.equal(t.host.scene.startAt, null); t.advance(0.1); assert.ok(t.host.scene.startAt > 0); t.equal();
    const late = t.late(); assert.equal(late.sync.hash(), t.hSync.hash());
    if (skip) { const req = t.replica.skip(); t.flush(); assert.equal((await req).ok, true); }
    else t.advance(8);
    t.flush(); assert.equal(t.host.scene, null); assert.equal(t.replica.stage, 5);
    assert.equal(t.petsH.has('carle'), true); assert.equal(t.petsR.has('carle'), true); t.equal();
    assert.equal(reject(t.host.hatch(t.hostP)), 'not-ready');
  }
});

test('the cocoon scene waits for cinematic.busy and a reload of a hatch returns to ready', () => {
  const cinematic = { busy: true }, t = pair({ testpet: true, cinematic });
  t.host.debug.fedDays(6); t.host.debug.feed(); t.advance(8);
  assert.equal(t.host.scene.kind, 'cocoon'); assert.equal(t.host.scene.startAt, null);
  cinematic.busy = false; t.advance(0.1); assert.ok(t.host.scene.startAt);
  t.advance(6); assert.equal(t.host.scene, null); assert.equal(t.host.stage, 3);
  t.host.debug.hatch(); t.advance(0.1);
  const saved = JSON.parse(storage.get(STORAGE_KEY)).carle;
  assert.equal(saved.stage, 4);
  const r = pair({ testpet: true, saved }); assert.equal(r.host.stage, 4); assert.equal(r.host.scene, null);
});

test('world: Listen has one/two/three zz marks, ready toasts once off-island, glows, and Watch starts the hatch', () => {
  const w = worldRig();
  for (let n = 0; n < 3; n++) {
    w.carle.debug.cocoonDays(n); w.step(1); w.bubbles.length = 0;
    w.cw.openMenu(w.p); assert.equal(w.dialog.isOpen, false);
    assert.equal((w.bubbles.at(-1).icon.match(/zz/g) || []).length, n + 1);
    assert.ok(w.cw.cocoon.root.scale.x >= 2);
  }
  w.flags.full = false; w.carle.debug.ready(); w.step(10);
  assert.equal(w.toasts.filter((s) => s === 'The cocoon on the home island is wiggling!').length, 1);
  assert.ok(w.cw.cocoon.mesh.geometry.getAttribute('aGlow').array.some((v) => v > 0));
  w.flags.full = true; w.step(1); assert.equal(w.cw.interactables[0].prompt, 'Watch');
  w.cw.openMenu(w.p); assert.equal(w.carle.scene.kind, 'hatch');
});

test('world: host-timed climb, hatch bones and four temporary butterflies; skip disposes them and asks each local player once', () => {
  const w = worldRig(); w.carle.debug.fedDays(6); w.carle.debug.feed(); w.step(60, 0.1);
  assert.ok(w.cw.cut.active); assert.ok(w.cw.model.root.position.y >= plan.perch.y);
  w.carle.skip(); w.step(2); assert.equal(w.cw.cut.active, false);
  w.carle.debug.ready(); w.cw.openMenu(w.p); w.step(25, 0.1);
  assert.equal(w.cw.cut.extras.length, 4); assert.ok(w.cw.cocoon.state.crack > 0.9);
  const extras = [...w.cw.cut.extras]; let disposed = 0;
  for (const m of extras) m.mesh.geometry.addEventListener('dispose', () => disposed++);
  w.carle.skip(); w.step(2);
  assert.equal(w.carle.stage, 5); assert.equal(disposed, 4); assert.equal(w.cw.cut.extras.length, 0);
  assert.ok(extras.every((m) => m.root.parent === null));
  assert.equal(w.dialog.last.text, 'Bring Carle along?');
  w.dialog.last.choices[0].onSelect(); w.step(10);
  assert.deepEqual(w.sets, [[w.p, 'carle']]); assert.equal(w.dialog.isOpen, false);
  assert.equal(w.cw.interactables[0].canInteract(), false); assert.equal(w.cw.sapling.visible, true);
  assert.equal(w.cw.cocoon.root.visible, false);
});


test('closed game: a saved stage-3 cocoon counts three load catch-up dawns before any live phase', () => {
  storage.clear(); homeSave.reset(); let wall = 1_700_100_000_000;
  const firstClock = new DayNight({ now: () => wall }); firstClock.set(8);
  homeSave.set('carle', savedView({ ...debugState(3), phase: 'day' })); firstClock.dispose();
  wall += 3 * 630 * 1000; homeSave.reset();
  const clock = new DayNight({ now: () => wall });
  const sync = new WorldSync({ role: 'host' }), carle = createCarle({ sync, plan, clock });
  assert.equal(carle.stage, 3); assert.equal(clock.away.entered.dawn, 3);
  clock.flushCatchUp(); assert.equal(carle.stage, 4); assert.equal(carle.state.cocoonDays, 3);
  clock.flushCatchUp(); assert.equal(carle.state.cocoonDays, 3); clock.dispose();
});

test('two local players are invited once each, Yes affects its owner and Not now leaves the other choice alone', () => {
  const w = worldRig(), p2 = { ...w.p, index: 1, position: w.p.position.clone(), colors: { name: 'P2', ui: '#acf' } };
  w.players.list.push(p2); w.players.multi = true;
  w.carle.debug.hatch(w.p); w.step(10, 0.1); w.carle.skip(); w.step(2);
  assert.equal(w.dialog.last.owner, w.p); w.dialog.last.choices[0].onSelect(); w.step(1);
  assert.equal(w.dialog.last.owner, p2); w.dialog.last.choices[1].onSelect(); w.step(10);
  assert.deepEqual(w.sets, [[w.p, 'carle']]); assert.equal(w.dialog.isOpen, false);
});
