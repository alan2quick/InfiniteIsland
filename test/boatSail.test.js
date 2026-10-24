// Step 71: Set sail. Pure rules (sail gate, boat.at / discovered normalisation, berths, arrival spots, the crossing path / beats / camera), the Duskcrown dock layout against the real terrain and the 69c / 69d
// placement, travelAllowed / playerMemory for Duskcrown, and a real host + replica `boat` + `boatSail` domain pair (replica-requested sail, rejects, shared skip, saves, hashes, late joiner).
import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldSync } from '../public/js/net/worldSync.js';
import { ISLANDS, SAIL, WATER_LEVEL } from '../public/js/config.js';
import { freshBoat, normaliseBoat, boatHashView } from '../public/js/game/boatLogic.js';
import { sailRule, applyArrival, otherIsland, sailBerths, sailArrivals, makeRoute, sailU, sailBeat, sailPose, sailCamera, camParams, sailHint, sailRegion, crewWorld } from '../public/js/game/boatSailLogic.js';
import { travelAllowed, clearTravelSpots } from '../public/js/game/travelLogic.js';
import { createBoatSail } from '../public/js/game/boatSail.js';
import { coveLayout } from '../public/js/world/islands/emberCove.js';
import { lookoutLayout } from '../public/js/world/islands/emberLookouts.js';
import { duskDockLayout } from '../public/js/world/islands/duskDock.js';
import { getIslandModule } from '../public/js/world/islands/registry.js';
import { buildDuskPlacement } from '../public/js/world/islands/duskPlacement.js';
import { buildDuskFlora } from '../public/js/world/islands/duskFlora.js';
import { getTerrainHeight, isWalkable, regionOf } from '../public/js/world/terrain.js';
const storage = new Map();
globalThis.localStorage = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) };
const { createBoat } = await import('../public/js/world/boat.js');
const { createPlayerMemory } = await import('../public/js/game/playerMemory.js');
const { emberSave } = await import('../public/js/game/emberSave.js');

const island = ISLANDS.find((i) => i.id === 'duskcrown'), mod = getIslandModule('duskcrown');
const cove = coveLayout(), dusk = duskDockLayout();
const launched = () => ({ ...freshBoat(), unlocked: true, repair: true, parts: { planks: true, sail: true, rudder: true, compass: true }, nails: [2, 2, 2, 2], planks: 8, seams: [true, true, true], floated: true, sights: [true, true, true], launched: true });
const at = (p, y = 0.3) => ({ x: p.x, y, z: p.z });

test('boat state: at / discovered default, normalise and stay consistent with the voyage', () => {
  const f = freshBoat();
  assert.equal(f.at, 'ember'); assert.equal(f.discovered, false);
  assert.deepEqual(normaliseBoat(launched()).at, 'ember');
  const old = launched(); delete old.at; delete old.discovered;
  assert.deepEqual([normaliseBoat(old).at, normaliseBoat(old).discovered], ['ember', false], 'old saves load at Emberleaf');
  const dusk1 = normaliseBoat({ ...launched(), at: 'duskcrown' });
  assert.deepEqual([dusk1.at, dusk1.discovered], ['duskcrown', true], 'being at Duskcrown means it was reached');
  assert.deepEqual([normaliseBoat({ ...launched(), discovered: true }).at, normaliseBoat({ ...launched(), discovered: true }).discovered], ['ember', true]);
  for (const junk of ['moon', 5, null, {}, 'DUSKCROWN']) assert.equal(normaliseBoat({ ...launched(), at: junk }).at, 'ember');
  const unlaunched = normaliseBoat({ ...launched(), launched: false, at: 'duskcrown', discovered: true });
  assert.deepEqual([unlaunched.launched, unlaunched.at, unlaunched.discovered], [false, 'ember', false], 'a boat that never launched cannot be anywhere else');
  const n = normaliseBoat({ ...launched(), at: 'duskcrown' });
  assert.deepEqual(normaliseBoat(JSON.parse(JSON.stringify(n))), n, 'idempotent');
  assert.deepEqual(boatHashView(n), JSON.parse(JSON.stringify(n)), 'at and discovered are in the sync hash');
});

test('sailRule: launched boat, the other dock, near the dock where the boat is, nobody busy', () => {
  const s = launched(), dock = lookoutLayout().dock, near = at(dock, 0.65);
  assert.equal(sailRule(s, { to: 'duskcrown', pos: near, dock }), null);
  assert.equal(sailRule(s, { to: 'ember', pos: near, dock }), 'there');
  assert.equal(sailRule(s, { to: 'mars', pos: near, dock }), 'bad-request');
  assert.equal(sailRule(s, { to: undefined, pos: near, dock }), 'bad-request');
  assert.equal(sailRule({ ...s, launched: false }, { to: 'duskcrown', pos: near, dock }), 'locked');
  assert.equal(sailRule({ ...s, unlocked: false }, { to: 'duskcrown', pos: near, dock }), 'locked');
  assert.equal(sailRule(s, { to: 'duskcrown', pos: near, dock, busy: true }), 'busy');
  assert.equal(sailRule(s, { to: 'duskcrown', pos: { x: dock.x + SAIL.dock + 1, z: dock.z }, dock }), 'far');
  assert.equal(sailRule(s, { to: 'duskcrown', pos: null, dock }), 'far');
  assert.equal(sailRule(s, { to: 'duskcrown', pos: null, dock, debug: true }), null);
  const home = { ...s, at: 'duskcrown' };
  assert.equal(sailRule(home, { to: 'ember', pos: at(dusk.prompt), dock: dusk.prompt }), null);
  assert.equal(sailRule(home, { to: 'duskcrown', pos: at(dusk.prompt), dock: dusk.prompt }), 'there');
  assert.equal(otherIsland('ember'), 'duskcrown'); assert.equal(otherIsland('duskcrown'), 'ember');
});

test('applyArrival: boat.at transitions, discovered only flips on the first Duskcrown arrival', () => {
  const s = launched();
  assert.deepEqual(applyArrival(s, 'duskcrown'), { first: true }); assert.deepEqual([s.at, s.discovered], ['duskcrown', true]);
  assert.deepEqual(applyArrival(s, 'ember'), { first: false }); assert.deepEqual([s.at, s.discovered], ['ember', true]);
  assert.deepEqual(applyArrival(s, 'duskcrown'), { first: false });
});

test('the Duskcrown dock: deterministic, on the real shore, clear of the 69c / 69d placement and the ponds', () => {
  const again = duskDockLayout();
  assert.equal(again, dusk, 'cached');
  const wet = (p) => mod.height(p.x, p.z) < WATER_LEVEL - 0.35;
  assert.ok(mod.walkable(dusk.base.x, dusk.base.z - 1), 'the beach at the pier head is walkable');
  assert.ok(wet({ x: dusk.deck.x, z: dusk.deck.z1 }), 'the pier ends over deep water');
  assert.ok(wet(dusk.berth), 'the hull lies on open water'); assert.ok(mod.height(dusk.berth.x, dusk.berth.z) < -1);
  assert.ok(mod.walkable(dusk.marlo.x, dusk.marlo.z), 'Marlo stands on the beach'); assert.ok(mod.walkable(dusk.prompt.x, dusk.prompt.z));
  assert.ok(Math.hypot(dusk.prompt.x - (island.x + mod.layout.landing.x), dusk.prompt.z - (island.z + mod.layout.landing.z)) > 8, 'not on top of the debug landing');
  // nothing of the 69c giants / titans or the 69d small flora stands in the dock's zone
  const z = dusk.zone, P = buildDuskPlacement(island, mod), F = buildDuskFlora(island, mod);
  for (const m of P.items) assert.ok(Math.hypot(m.x - z.x, m.z - z.z) > z.r + (m.baseR || 1), `mushroom ${m.id}`);
  for (const [layer, items] of Object.entries(F.layers)) for (const it of items) assert.ok(Math.hypot(it.x - z.x, it.z - z.z) > 3 || layer === 'lily', `${layer} too near the dock`);
  for (const p of mod.ponds) assert.ok(Math.hypot((island.x + p.x) - z.x, (island.z + p.z) - z.z) > p.r + z.r * 0.5, `pond ${p.id}`);
  // the lanes run along the beach: the pier itself (not the beach head) stays clear of them
  for (const lane of P.lanes) for (const [x, zz] of lane) assert.ok(Math.hypot(x - dusk.deck.x, zz - (dusk.deck.z0 + dusk.deck.z1) / 2) > 4, 'a lane runs through the deck');
});

test('arrival spots: one per slot, walkable, apart, off the colliders, on the right island', () => {
  const A = sailArrivals(cove, dusk);
  for (const to of ['ember', 'duskcrown']) assert.equal(A[to].length, 4);
  for (const a of A.duskcrown) {
    assert.ok(isWalkable(a.x, a.z), 'walkable'); assert.equal(regionOf(a.x, a.z), 'duskcrown');
    for (const c of dusk.colliders) assert.ok(Math.hypot(a.x - c.x, a.z - c.z) >= c.r + 0.65);
    assert.ok(Math.hypot(a.x - dusk.marlo.x, a.z - dusk.marlo.z) >= 1.4);
  }
  for (const list of Object.values(A)) for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) assert.ok(Math.hypot(list[i].x - list[j].x, list[i].z - list[j].z) >= 1.15, 'apart');
  for (const a of A.ember) { assert.equal(regionOf(a.x, a.z), 'ember'); assert.equal(a.y, 0.65); }
  // and the generic travel search finds the same kind of spots around the Duskcrown dock
  const spots = clearTravelSpots(dusk.prompt, 4, { walkable: isWalkable, regionAt: regionOf, colliders: [], island: 'duskcrown' });
  assert.equal(spots.length, 4);
});

test('the crossing route stays on open water, joins both berths and the beats cover 20 s', () => {
  const B = sailBerths(cove, dusk);
  assert.deepEqual([B.ember.x, B.ember.z], [cove.frame.to(4.4, -1.8).x, cove.frame.to(4.4, -1.8).z]);
  assert.deepEqual([B.duskcrown.x, B.duskcrown.z, B.duskcrown.yaw], [dusk.berth.x, dusk.berth.z, dusk.berth.yaw]);
  for (const [from, to] of [['ember', 'duskcrown'], ['duskcrown', 'ember']]) {
    const route = makeRoute(B[from], B[to]);
    assert.ok(route.length > 500 && route.length < 1000, `length ${route.length}`);
    const a = route.at(0), b = route.at(1);
    assert.ok(Math.hypot(a.x - B[from].x, a.z - B[from].z) < 1e-6); assert.ok(Math.hypot(b.x - B[to].x, b.z - B[to].z) < 1e-6);
    for (let i = 0; i <= 600; i++) {
      const u = i / 600, p = route.at(u);
      assert.ok(Number.isFinite(p.x + p.z + p.tx + p.tz));
      if (u > 0.02 && u < 0.985) assert.ok(getTerrainHeight(p.x, p.z) < -0.25, `land under the boat at u ${u} (${p.x.toFixed(0)}, ${p.z.toFixed(0)}) ${getTerrainHeight(p.x, p.z)}`);
    }
    // the pose: berth to berth, finite, never backwards, ends furled
    let lastU = -1;
    for (let t = -1; t <= SAIL.end + 1; t += 0.05) {
      const pose = sailPose(t, route);
      for (const v of Object.values(pose)) assert.ok(Number.isFinite(v));
      assert.ok(pose.u >= lastU - 1e-9, 'monotone'); lastU = pose.u;
      const cam = sailCamera(t, pose);
      for (const v of [...cam.pos, ...cam.look]) assert.ok(Number.isFinite(v));
      assert.ok(cam.pos[1] >= 4, 'the camera stays above the water');
    }
    const p0 = sailPose(0, route), p1 = sailPose(SAIL.end, route);
    assert.equal(p0.sail, 0); assert.equal(p1.sail, 0); assert.ok(sailPose(10, route).sail > 0.99);
    assert.ok(Math.hypot(p0.x - B[from].x, p0.z - B[from].z) < 1e-6); assert.ok(Math.hypot(p1.x - B[to].x, p1.z - B[to].z) < 1e-6);
    assert.ok(Math.abs(Math.atan2(Math.sin(p1.yaw - B[to].yaw), Math.cos(p1.yaw - B[to].yaw))) < 1e-6, 'moors on the berth heading');
    // the view hint runs ahead of the boat, and ends on the destination
    const h = sailHint(10, route), pose = sailPose(10, route);
    assert.ok(Math.hypot(h.x - B[to].x, h.z - B[to].z) < Math.hypot(pose.x - B[to].x, pose.z - B[to].z));
  }
});

test('beat table, time to distance and region hand-over', () => {
  const names = [[0, 'board'], [2.99, 'board'], [3, 'leave'], [8.99, 'leave'], [9, 'sea'], [11.99, 'sea'], [12, 'rise'], [16.99, 'rise'], [17, 'arrive'], [19.99, 'arrive'], [25, 'arrive']];
  for (const [t, name] of names) assert.equal(sailBeat(t).name, name, `t ${t}`);
  assert.equal(sailU(-5), 0); assert.equal(sailU(0), 0); assert.equal(sailU(2.4), 0); assert.equal(sailU(SAIL.end), 1); assert.equal(sailU(99), 1);
  assert.ok(Math.abs(sailU(SAIL.leave) - 0.3) < 1e-9 && Math.abs(sailU(SAIL.sea) - 0.56) < 1e-9 && Math.abs(sailU(SAIL.rise) - 0.94) < 1e-9);
  let prev = 0; for (let t = 0; t <= 20; t += 0.01) { const u = sailU(t); assert.ok(u >= prev - 1e-12 && u <= 1 + 1e-12); prev = u; }
  assert.equal(sailRegion(11.9, 'ember', 'duskcrown'), null); assert.equal(sailRegion(12, 'ember', 'duskcrown'), 'duskcrown'); assert.equal(sailRegion(15, 'duskcrown', 'ember'), 'ember');
  const k = camParams(0), e = camParams(20); assert.ok(k.back > 0 && e.back > 0);
  const slots = [0, 1, 2, 3].map((s) => crewWorld({ x: 0, z: 0, yaw: 0 }, s));
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) assert.ok(Math.hypot(slots[i].x - slots[j].x, slots[i].z - slots[j].z) > 0.5, 'crew stands apart on the deck');
});

test('travel: Duskcrown joins friends only once discovered; never a bridge island; playerMemory knows the zone', () => {
  const built = () => true;
  assert.equal(travelAllowed('duskcrown', built), false); assert.equal(travelAllowed('duskcrown', built, false), false); assert.equal(travelAllowed('duskcrown', built, true), true);
  assert.equal(travelAllowed('home', () => false), true); assert.equal(travelAllowed('ember', () => false, true), false);
  assert.equal(ISLANDS.find((i) => i.id === 'duskcrown').biome, 'fungal');
  storage.clear();
  const m = createPlayerMemory(); m.remember(0, 'duskcrown', null);
  assert.deepEqual(createPlayerMemory().get(0), { zone: 'duskcrown', tool: null });
});

// ---- a real host + replica pair ------------------------------------------------------------------------------------------------------------------------------------------------
function pair(initial = launched()) {
  storage.clear(); const file = emberSave.read(); for (const k of Object.keys(file)) delete file[k]; emberSave.set('boat', initial);
  let time = 80000; const q = [], replicas = new Map();
  const hSync = new WorldSync({ role: 'host', wallNow: () => time }), rSync = new WorldSync({ role: 'replica', wallNow: () => time });
  replicas.set(1, rSync);
  hSync.attachHost({ sendTo: (tid, m) => q.push([replicas.get(tid), m]), broadcast: (m) => { for (const r of replicas.values()) q.push([r, m]); } });
  rSync.attachReplica({ send: (m) => { q.push([hSync, m, 1]); return true; } });
  const flush = () => { while (q.length) { const [to, m, tid] = q.shift(); if (to === hSync) hSync.screenMessage(tid, m); else to.receive(m); } };
  const hostBoat = createBoat({ sync: hSync }), replicaBoat = createBoat({ sync: rSync });
  let busyFlag = false; const cinematic = { busy: false };
  const docks = { ember: lookoutLayout().dock, duskcrown: dusk.prompt };
  const host = createBoatSail({ sync: hSync, boat: hostBoat, cinematic, busy: () => busyFlag, docks });
  const replica = createBoatSail({ sync: rSync, boat: replicaBoat, cinematic: { busy: false }, docks });
  const log = { host: [], replica: [] };
  host.on((kind, _s, d) => log.host.push([kind, d.to, d.first])); replica.on((kind, _s, d) => log.replica.push([kind, d.to, d.first]));
  const equal = () => assert.equal(hSync.hash(), rSync.hash());
  rSync.linkUp(); hSync.screenConnected(1, { clientId: 'sailor' }); flush(); equal();
  const player = (p, y = 0.65) => ({ index: 0, position: { x: p.x, y, z: p.z } });
  const request = async (to, where) => { const pending = replica.request(to, player(where)); flush(); const r = await pending; equal(); return r; };
  const tick = (t) => { time = t; host.update(); flush(); equal(); };
  const late = () => {
    const sync = new WorldSync({ role: 'replica', wallNow: () => time }); replicas.set(2, sync);
    sync.attachReplica({ send: (m) => { q.push([hSync, m, 2]); return true; } });
    const boat = createBoat({ sync }), sail = createBoatSail({ sync, boat, cinematic: { busy: false }, docks });
    sync.linkUp(); hSync.screenConnected(2, { clientId: 'latecomer' }); flush(); assert.equal(hSync.hash(), sync.hash());
    return { sync, boat, sail };
  };
  return { host, replica, hostBoat, replicaBoat, hSync, rSync, cinematic, setBusy: (v) => { busyFlag = v; }, flush, equal, request, tick, late, log, now: () => time, player };
}

test('replica-requested sail: rejects first, then a shared crossing that moves the boat, saves it and keeps hashes equal', async () => {
  const w = pair(), dock = lookoutLayout().dock;
  assert.equal((await w.request('duskcrown', { x: dock.x + 40, z: dock.z })).reason, 'far', 'too far from the dock');
  assert.equal((await w.request('ember', dock)).reason, 'there', 'the boat is already at Emberleaf');
  assert.equal((await w.request('mars', dock)).reason, 'bad-request');
  w.setBusy(true); assert.equal((await w.request('duskcrown', dock)).reason, 'busy', 'combat / storybook / feast'); w.setBusy(false);
  w.cinematic.busy = true; assert.equal((await w.request('duskcrown', dock)).reason, 'busy', 'another cinematic'); w.cinematic.busy = false;
  assert.equal(w.host.state.startAt, null);
  const r = await w.request('duskcrown', dock);
  assert.equal(r.ok, true);
  const startAt = w.now() + SAIL.preStart;
  for (const s of [w.host.state, w.replica.state]) assert.deepEqual(s, { startAt, to: 'duskcrown', from: 'ember', first: true });
  assert.equal((await w.request('duskcrown', dock)).reason, 'busy', 'one crossing at a time');
  assert.equal(w.hostBoat.state.at, 'ember', 'still moored until the crossing is over');
  w.tick(startAt + SAIL.end * 1000 - 1); assert.equal(w.hostBoat.state.at, 'ember');
  w.tick(startAt + SAIL.end * 1000 + 1);
  for (const b of [w.hostBoat, w.replicaBoat]) assert.deepEqual([b.state.at, b.state.discovered], ['duskcrown', true]);
  for (const s of [w.host.state, w.replica.state]) assert.equal(s.startAt, null);
  assert.deepEqual(w.log.host.map((x) => x[0]), ['start', 'finish']); assert.deepEqual(w.log.replica.map((x) => x[0]).filter((k) => k !== 'snapshot'), ['start', 'finish']);
  assert.deepEqual(w.log.replica.at(-1), ['finish', 'duskcrown', true], 'the finish carries the destination and the first-arrival flag');
  // the host saved it, a fresh host loads it
  const saved = emberSave.read().boat; assert.deepEqual([saved.at, saved.discovered], ['duskcrown', true]);
  const reload = createBoat({ sync: new WorldSync({ role: 'host' }) }); assert.deepEqual([reload.state.at, reload.state.discovered], ['duskcrown', true]);
  // the way home from the Duskcrown dock, no banner this time
  assert.equal((await w.request('ember', { x: dock.x, z: dock.z })).reason, 'far', 'the Emberleaf dock is the wrong one now');
  assert.equal((await w.request('ember', dusk.prompt)).ok, true);
  const start2 = w.host.state.startAt; assert.equal(w.host.state.first, false);
  w.tick(start2 + SAIL.end * 1000 + 5);
  for (const b of [w.hostBoat, w.replicaBoat]) assert.deepEqual([b.state.at, b.state.discovered], ['ember', true]);
  assert.deepEqual(w.log.replica.at(-1), ['finish', 'ember', false]);
});

test('shared skip from the replica finishes the crossing everywhere; a late joiner gets the running crossing or the finished boat', async () => {
  const w = pair(), dock = lookoutLayout().dock;
  assert.equal((await w.request('duskcrown', dock)).ok, true);
  const mid = w.late();
  assert.deepEqual(mid.sail.state, w.host.state, 'a late joiner mid-crossing sees the same crossing');
  w.tick(w.now() + 8000);
  const pending = w.replica.skip(); w.flush(); assert.equal((await pending).ok, true); w.equal();
  assert.equal(w.hostBoat.state.at, 'duskcrown'); assert.equal(w.replicaBoat.state.at, 'duskcrown'); assert.equal(mid.boat.state.at, 'duskcrown');
  assert.deepEqual(w.log.host.map((x) => x[0]), ['start', 'skip']); assert.equal(mid.sail.state.startAt, null);
  const pending2 = w.replica.skip(); w.flush(); assert.equal((await pending2).reason, 'idle', 'nothing to skip');
  const after = w.late(); assert.equal(after.boat.state.at, 'duskcrown'); assert.equal(after.boat.state.discovered, true); assert.equal(after.sail.state.startAt, null);
});

test('debug sail ignores distance but not another cinematic; a boat reset cancels a running crossing; an unlaunched boat cannot sail', async () => {
  const w = pair(), dock = lookoutLayout().dock;
  assert.equal(w.host.debug('duskcrown').ok, true); assert.equal(w.host.debug('duskcrown').reason, 'busy');
  w.hostBoat.debug.reset(); w.flush();
  assert.equal(w.host.state.startAt, null); assert.deepEqual(w.log.host.at(-1).slice(0, 1), ['cancel']);
  assert.equal(w.hostBoat.state.launched, false);
  assert.equal(w.host.debug('duskcrown').reason, 'locked');
  assert.equal((await w.request('duskcrown', dock)).reason, 'locked');
  // a replica cannot use the debug request
  const sneaky = w.rSync.request('boatSail', 'debugSail', { to: 'duskcrown' }, null); w.flush(); assert.equal((await sneaky).ok, false);
});
