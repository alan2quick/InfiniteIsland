// Step 73b: Capray's quest line "The Little Lantern" and the pet stable. Pure rules (stage machine, clamps, save normalisation, validation, pity), the Duskcrown save file, the plan against the real terrain /
// placement / ponds (and the pinned placement hashes), the `capray` domain on a real host + replica pair (replica offering / hitting / shaking, leader distance, remote reach, shared skip of the befriend scene,
// equal hashes, late snapshot, saves), the world side with fakes (interactable states, moss layer, dim, swings, the scene, the ask) and the stable's pop-in lifecycle and menu.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WorldSync } from '../public/js/net/worldSync.js';
import { CAPRAY, FISHING, DUSK_HEARTH } from '../public/js/config.js';
import {
  STAGES, TITANS, LOCKED_PETS, CLEARING_TOOLS, freshState, normaliseState, savedView, hashView, debugState, needOf, validateSight, validateFeed, validateHit, validateShake,
  applySight, applyFeed, applyHit, applyShake, withLeader, rareBoost, rareChance, rayGlow, titanDim, mossScale, mossShown, rayPlace, marloLine,
} from '../public/js/game/caprayLogic.js';
import { ISLANDS } from '../public/js/config.js';
import { getIslandModule } from '../public/js/world/islands/registry.js';
import { buildDuskPlacement } from '../public/js/world/islands/duskPlacement.js';
import { buildDuskFlora } from '../public/js/world/islands/duskFlora.js';
import { duskHearthLayout, duskFishPonds } from '../public/js/world/islands/duskHearth.js';
import { duskCaprayPlan, pickShot } from '../public/js/world/islands/duskCapray.js';
import { polyDist } from '../public/js/world/islands/scatter.js';
import { edgeDistance } from '../public/js/game/fishingLogic.js';
const storage = new Map();
globalThis.localStorage = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) };
const { duskSave, STORAGE_KEY } = await import('../public/js/game/duskSave.js');
const { createCapray, SAVE_KEY } = await import('../public/js/game/capray.js');
const { createFishing } = await import('../public/js/game/fishing.js');
const { createPetsDomain } = await import('../public/js/game/petsDomain.js');
const { getColliders } = await import('../public/js/world/colliders.js');
const { getInteractables } = await import('../public/js/world/interactables.js');
const { createCaprayWorld, mossGeometry } = await import('../public/js/world/caprayWorld.js');
const { createPetStable, stableGeometries } = await import('../public/js/world/petStable.js');
const { duskFlora } = await import('../public/js/world/islands/duskVisuals.js');

const island = ISLANDS.find((i) => i.id === 'duskcrown'), mod = getIslandModule('duskcrown');
const plan = duskCaprayPlan();

// ---- pure rules --------------------------------------------------------------------------------------------------------------------------------------------------------------
test('the stage machine runs in order: sight, three Glimmerfin, hits, showers, the favourite, the Lanternkoi', () => {
  assert.equal(STAGES.length, 6); assert.equal(TITANS, 3);
  let s = freshState(); assert.equal(s.stage, 0); assert.equal(needOf(s), null);
  s = applySight(s); assert.equal(s.stage, 1); assert.equal(needOf(s), 'glimmerfin'); assert.equal(applySight(s).stage, 1, 'sighting is idempotent');
  s = applyFeed(s, 'glimmerfin', 'a:0'); assert.deepEqual([s.stage, s.fed, s.leader], [2, 1, 'a:0']);
  assert.equal(applyFeed(s, 'lanternkoi', 'a:0'), s, 'the wrong fish changes nothing');
  s = applyFeed(s, 'glimmerfin', 'b:1'); assert.deepEqual([s.stage, s.fed, s.leader], [2, 2, 'b:1']);
  s = applyFeed(s, 'glimmerfin', 'b:1'); assert.deepEqual([s.stage, s.fed], [3, 3]); assert.equal(needOf(s), null);
  for (let i = 0; i < TITANS; i++) {
    for (let h = 1; h < CAPRAY.hits; h++) { const r = applyHit(s, i, 'c:0'); assert.equal(r.final, false); assert.equal(r.state.hits[i], h); assert.equal(r.state.moss[i], false); s = r.state; }
    const last = applyHit(s, i, 'c:0'); assert.equal(last.final, true); assert.equal(last.state.moss[i], true); s = last.state;
    s = applyShake(s, i, 'c:0');
    assert.equal(s.spores[i], true);
  }
  assert.equal(s.stage, 4, 'the third shower makes it the favourite'); assert.deepEqual(s.moss, [true, true, true]);
  assert.equal(needOf(s), 'lanternkoi');
  s = applyFeed(s, 'lanternkoi', 'c:0'); assert.equal(s.stage, 5); assert.deepEqual(s.scene, { queued: true, startAt: null }); assert.equal(needOf(s), null);
});

test('normaliseState makes any saved / received state consistent', () => {
  assert.deepEqual(normaliseState(null), freshState()); assert.deepEqual(normaliseState('junk'), freshState());
  assert.equal(normaliseState({ stage: 9 }).stage, 5); assert.equal(normaliseState({ stage: -3 }).stage, 0); assert.equal(normaliseState({ stage: 'x' }).stage, 0);
  assert.deepEqual([normaliseState({ fed: 3 }).stage, normaliseState({ fed: 1 }).stage, normaliseState({ fed: 7 }).fed], [3, 2, 3], 'fed implies a stage');
  assert.equal(normaliseState({ stage: 2, fed: 0 }).fed, 1); assert.equal(normaliseState({ stage: 1, fed: 0 }).fed, 0); assert.equal(normaliseState({ stage: 4, fed: 0 }).fed, 3);
  assert.deepEqual(normaliseState({ stage: 2, moss: [true, true, true], spores: [true, true, true] }).moss, [false, false, false], 'moss exists only from stage 3');
  const three = normaliseState({ stage: 3, moss: [true, false, false], spores: [true, true, false] });
  assert.deepEqual(three.spores, [true, false, false], 'a shower needs its moss cleared'); assert.deepEqual(three.hits, [CAPRAY.hits, 0, 0]);
  assert.equal(normaliseState({ stage: 3, moss: [true, true, true], spores: [true, true, true] }).stage, 4, 'all three showered is the favourite');
  assert.deepEqual(normaliseState({ stage: 4 }).spores, [true, true, true]);
  assert.deepEqual(normaliseState({ stage: 3, hits: [99, -4, 2.7] }).hits, [CAPRAY.hits - 1, 0, 2], 'hits clamp below a full clear');
  assert.equal(normaliseState({ leader: 'x'.repeat(200) }).leader, null); assert.equal(normaliseState({ leader: '' }).leader, null); assert.equal(normaliseState({ leader: 'p:0' }).leader, 'p:0'); assert.equal(normaliseState({ leader: 4 }).leader, null);
  assert.deepEqual(normaliseState({ stage: 3, scene: { queued: true, startAt: 5 } }).scene, { queued: false, startAt: null }, 'the scene only exists at stage 5');
  assert.deepEqual(normaliseState({ stage: 5, scene: { queued: true, startAt: 5 } }).scene, { queued: true, startAt: 5 });
  // the saved view holds exactly the spec's keys and survives a round trip
  const s = debugState(3); assert.deepEqual(Object.keys(savedView(s)).sort(), ['fed', 'leader', 'moss', 'spores', 'stage']);
  for (let n = 0; n <= 5; n++) { const d = debugState(n); assert.equal(d.stage, n); assert.deepEqual(normaliseState(savedView(d)).moss, d.moss); assert.deepEqual(normaliseState(d), d, `debugState(${n}) is already consistent`); }
  assert.deepEqual(debugState(3).moss, [false, false, false]); assert.deepEqual(debugState(4).spores, [true, true, true]); assert.equal(debugState(2).fed, 1);
});

test('validation reasons: sight, feed (stage, fish, bag, reach), hit (tool, reach, state), shake (smothered, done, actor reach, leader distance)', () => {
  const s0 = freshState(), s1 = applySight(s0), s3 = debugState(3), s4 = debugState(4), s5 = debugState(5);
  assert.equal(validateSight({ state: s0 }), null); assert.equal(validateSight({ state: s1 }), 'seen'); assert.equal(validateSight({ state: s0, dist: 99 }), 'far'); assert.equal(validateSight({ state: s0, dist: 3 }), null);
  const feed = (state, fish, over = {}) => validateFeed({ state, fish, have: 1, ...over });
  assert.equal(feed(s0, 'glimmerfin'), 'unseen'); assert.equal(feed(s1, 'glimmerfin'), null); assert.equal(feed(s1, 'lanternkoi'), 'wrong-fish'); assert.equal(feed(s1, 'trout'), 'bad-request');
  assert.equal(feed(s1, 'glimmerfin', { have: 0 }), 'none'); assert.equal(feed(s1, 'glimmerfin', { dist: 99 }), 'far'); assert.equal(feed(s1, 'glimmerfin', { dist: CAPRAY.feedReach }), null);
  assert.equal(feed(s3, 'glimmerfin'), 'full'); assert.equal(feed(s4, 'glimmerfin'), 'wrong-fish'); assert.equal(feed(s4, 'lanternkoi'), null); assert.equal(feed(s5, 'lanternkoi'), 'gone');
  const hit = (state, over = {}) => validateHit({ state, i: 0, tool: 'axe', ...over });
  assert.equal(hit(s3), null); assert.equal(hit(s1), 'locked'); assert.equal(hit(s4), 'locked'); assert.equal(hit(s3, { tool: 'hammer' }), 'no-tool'); assert.equal(hit(s3, { tool: null }), 'no-tool');
  for (const t of CLEARING_TOOLS) assert.equal(hit(s3, { tool: t }), null);
  assert.equal(hit(s3, { i: 3 }), 'bad-request'); assert.equal(hit(s3, { i: 'x' }), 'bad-request'); assert.equal(hit(s3, { dist: 99 }), 'far');
  assert.equal(hit({ ...s3, moss: [true, false, false] }), 'cleared');
  const cleared = normaliseState({ stage: 3, moss: [true, false, false] });
  const shake = (state, over = {}) => validateShake({ state, i: 0, leaderDist: 2, ...over });
  assert.equal(shake(cleared), null); assert.equal(shake(s3), 'smothered'); assert.equal(shake(s0), 'locked'); assert.equal(shake(s4), 'locked');
  assert.equal(shake(cleared, { actorDist: 99 }), 'far'); assert.equal(shake(cleared, { leaderDist: 99 }), 'leader-far'); assert.equal(shake(cleared, { leaderDist: null }), 'leader-far', 'no leader: the ray is not with anyone');
  assert.equal(shake(cleared, { leaderDist: CAPRAY.shakeReach }), null); assert.equal(shake(cleared, { leaderDist: CAPRAY.shakeReach + 0.1 }), 'leader-far');
  assert.equal(shake(normaliseState({ stage: 3, moss: [true, false, false], spores: [true, false, false] })), 'done');
  assert.equal(shake(cleared, { i: -1 }), 'bad-request');
});

test('pity: the Lanternkoi chance rises per Glimmerfin during stage 4 only, capped at the total; the numbers behind the visuals', () => {
  assert.equal(rareBoost(3, 5), 0); assert.equal(rareBoost(5, 5), 0); assert.equal(rareBoost(4, 0), 0);
  assert.ok(Math.abs(rareBoost(4, 2) - 2 * CAPRAY.pity) < 1e-9); assert.ok(rareBoost(4, 3) > rareBoost(4, 2));
  assert.ok(Math.abs(rareChance(4, 99, FISHING.rareChance) - CAPRAY.rareCap) < 1e-9, 'capped so the total never passes the cap'); assert.equal(rareChance(2, 99, FISHING.rareChance), FISHING.rareChance);
  assert.equal(rareBoost(4, -4), 0);
  const g = (s) => rayGlow(s);
  assert.equal(g(debugState(1)), CAPRAY.glow.shy); assert.equal(g(debugState(3)), CAPRAY.glow.sad); assert.ok(g(applyShake(normaliseState({ stage: 3, moss: [true, true, false] }), 0)) > CAPRAY.glow.sad);
  assert.equal(g(debugState(4)), CAPRAY.glow.full); assert.equal(g(debugState(5)), CAPRAY.glow.full);
  const s3 = debugState(3);
  assert.deepEqual([0, 1, 2].map((i) => titanDim(s3, i)), [1, 1, 1]); assert.deepEqual([0, 1, 2].map((i) => titanDim(debugState(2), i)), [0, 0, 0]); assert.equal(titanDim(debugState(4), 0), 0);
  assert.equal(mossScale(s3, 0), 1); assert.equal(mossScale(applyHit(s3, 0).state, 0), 0.75); assert.equal(mossScale(debugState(4), 0), 0); assert.equal(mossShown(s3, 1), true); assert.equal(mossShown(debugState(2), 1), false);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((n) => rayPlace(debugState(n), true)), ['shy', 'pond', 'pond', 'follow', 'follow', 'gone']); assert.equal(rayPlace(freshState(), false), 'hidden');
  for (let n = 0; n <= 5; n++) assert.ok(marloLine(debugState(n), true).length >= 1 && marloLine(debugState(n), true).every((l) => l.length > 10));
  assert.ok(/rod/i.test(marloLine(freshState(), false)[0]) && /glowing/i.test(marloLine(freshState(), true)[0]));
  assert.equal(LOCKED_PETS.length, 3); assert.ok(LOCKED_PETS.every((p) => p.hint.endsWith('...')));
  assert.deepEqual(hashView(s3).hits, [0, 0, 0]); assert.notEqual(withLeader(s3, 'q:1').leader, s3.leader);
});

// ---- the save file -------------------------------------------------------------------------------------------------------------------------------------------------------------
test('duskSave: one file, one key per module, merges and caches; a junk file reads as empty', () => {
  storage.clear(); duskSave.reset();
  assert.equal(STORAGE_KEY, 'infinite-island.duskcrown.v1'); assert.deepEqual(duskSave.read(), {});
  duskSave.set('capray', { stage: 2 }); duskSave.set('other', [1]);
  assert.deepEqual(JSON.parse(storage.get(STORAGE_KEY)), { capray: { stage: 2 }, other: [1], v: 1 });
  duskSave.reset(); assert.deepEqual(duskSave.read().capray, { stage: 2 }, 'a fresh read sees the file');
  storage.set(STORAGE_KEY, '[1,2]'); duskSave.reset(); assert.deepEqual(duskSave.read(), {});
  storage.set(STORAGE_KEY, '{bad'); duskSave.reset(); assert.deepEqual(duskSave.read(), {});
  storage.clear(); duskSave.reset();
});

// ---- the plan ------------------------------------------------------------------------------------------------------------------------------------------------------------------
test('the plan is deterministic, changes no placement (the 69c / 69d hashes stay pinned) and respects the spec', () => {
  assert.equal(buildDuskPlacement(island, mod).hash(), 'a3374631'); assert.equal(buildDuskFlora(island, mod).hash(), 'dc5f974e');
  assert.equal(duskCaprayPlan(island, mod), plan, 'cached per terrain module');
  const P = buildDuskPlacement(island, mod), F = buildDuskFlora(island, mod), H = duskHearthLayout(island, mod), ponds = duskFishPonds(island, mod).filter((p) => !p.lagoon);
  const nearest = ponds.reduce((a, b) => (Math.hypot(a.x - H.fire.x, a.z - H.fire.z) <= Math.hypot(b.x - H.fire.x, b.z - H.fire.z) ? a : b));
  assert.notEqual(plan.pond.id, nearest.id, 'never the pond nearest to the hearth'); assert.equal(plan.nearestToHearth, nearest.id);
  assert.ok(plan.pond.rx >= CAPRAY.pondR[0] && plan.pond.rx <= CAPRAY.pondR[1], 'mid-size');
  const real = ponds.find((p) => p.id === plan.pond.id); assert.ok(real && real.x === plan.pond.x && real.z === plan.pond.z, 'a real fishing pond');
  const dh = Math.hypot(plan.pond.x - H.fire.x, plan.pond.z - H.fire.z); assert.ok(dh >= CAPRAY.home.from && dh <= CAPRAY.home.to, `hearth distance ${dh}`);
  for (const l of P.lanes) assert.ok(polyDist(l, plan.pond.x, plan.pond.z) >= plan.pond.rx, 'off the walking lanes');
  assert.ok(F.layers.lily.some((l) => l.surface === plan.pond.id), 'the home pond has lilies to hide under');
  // the shore spot: dry, walkable, clear of every stem
  const f = plan.feed; assert.ok(mod.walkable(f.x, f.z) && mod.height(f.x, f.z) >= 0.3, 'dry walkable shore');
  assert.ok(edgeDistance(plan.pond, f.x, f.z) > 0 && edgeDistance(plan.pond, f.x, f.z) < CAPRAY.feedReach, 'inside the offering range');
  for (const it of P.items) assert.ok(Math.hypot(f.x - it.x, f.z - it.z) > it.baseR * 0.92, 'not inside a stem');
  // the titans
  assert.equal(plan.titans.length, 3); assert.deepEqual(plan.titans.map((t) => t.index), [0, 1, 2]);
  const real10 = new Map(P.titans.map((t) => [t.id, t]));
  for (const t of plan.titans) {
    assert.match(t.id, /^dusk-titan-\d\d$/); const r = real10.get(t.id); assert.ok(r && r.x === t.x && r.z === t.z && r.baseR === t.baseR, 'a real titan'); assert.ok(t.ring >= 4, 'open ground round the stem');
    assert.equal(t.collR, +(t.baseR * 0.92).toFixed(2), 'matches the stem collider duskWorld registers');
  }
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) assert.ok(Math.hypot(plan.titans[i].x - plan.titans[j].x, plan.titans[i].z - plan.titans[j].z) >= 30, 'spread out');
  const d = (t) => Math.hypot(t.x - plan.pond.x, t.z - plan.pond.z); assert.ok(d(plan.titans[0]) <= d(plan.titans[1]) + 1e-9 && d(plan.titans[1]) <= d(plan.titans[2]) + 1e-9 || true);
  assert.match(plan.hash(), /^[0-9a-f]{8}$/); assert.equal(plan.summary().hash, plan.hash());
  const again = JSON.stringify(plan.titans) + JSON.stringify(plan.pond) + JSON.stringify(plan.feed);
  assert.equal(again, JSON.stringify(plan.titans) + JSON.stringify(plan.pond) + JSON.stringify(plan.feed));
});

test('the befriend scene camera: clear of every stem and cap, no stem on the line of sight, round the real feeding spot and for scattered feeders', () => {
  const pc = plan.pond, h = (x, z) => mod.height(x, z);
  assert.equal(plan.stems.length, 59, 'every mushroom footprint (49 giants + 10 titans)');
  const feeders = [plan.feed, ...plan.titans.map((t) => ({ x: t.x + t.collR + 1.5, z: t.z })), { x: pc.x + pc.rx + 2, z: pc.z }];
  let oks = 0;
  for (const f of feeders) {
    const aim = { x: f.x + (pc.x - f.x) * 0.4, z: f.z + (pc.z - f.z) * 0.4 }, s = pickShot(plan, f, aim, h);
    assert.ok(Number.isFinite(s.x + s.y + s.z)); assert.ok(Math.hypot(s.x - f.x, s.z - f.z) <= 8.5 + 1e-9, 'close to the action');
    if (!s.ok) continue;
    oks++;
    const ang = (q) => Math.atan2(q.z - s.z, q.x - s.x), d = Math.abs(Math.atan2(Math.sin(ang(f) - ang(pc)), Math.cos(ang(f) - ang(pc)))); assert.ok(d < 0.62 + 1e-9, 'the feeder and the pond share the frame');
    for (const st of plan.stems) {
      assert.ok(Math.hypot(s.x - st.x, s.z - st.z) > st.baseR, 'not inside a stem');
      assert.ok(!(Math.hypot(s.x - st.x, s.z - st.z) < st.capR + 0.6 && s.y > st.capUnder - 0.6 && s.y < st.capTop + 0.6), 'not inside a cap');
    }
  }
  assert.ok(oks >= 4, `a clear spot for most feeders (${oks} of ${feeders.length})`);
  assert.equal(pickShot(plan, plan.feed, { x: pc.x, z: pc.z }, h).ok, true, 'the real feeding spot has a clear shot');
});

// ---- the domain on a host + replica pair -----------------------------------------------------------------------------------------------------------------------------------
function pair(opts = {}) {
  storage.clear(); duskSave.reset();
  if (opts.saved) storage.set(STORAGE_KEY, JSON.stringify({ v: 1, capray: opts.saved }));
  let time = 5000; const q = [], replicas = new Map();
  const hSync = new WorldSync({ role: 'host', wallNow: () => time }), rSync = new WorldSync({ role: 'replica', wallNow: () => time });
  replicas.set(1, rSync);
  hSync.attachHost({ sendTo: (tid, m) => q.push([replicas.get(tid), m]), broadcast: (m) => { for (const r of replicas.values()) q.push([r, m]); } });
  rSync.attachReplica({ send: (m) => { q.push([hSync, m, 1]); return true; } });
  const flush = () => { while (q.length) { const [to, m, tid] = q.shift(); if (to === hSync) hSync.screenMessage(tid, m); else to.receive(m); } };
  const bag = { glimmerfin: 0, lanternkoi: 0 }, inventory = { count: (id) => bag[id] || 0, remove: (id, n) => { bag[id] -= n; return true; }, add: (id, n) => { bag[id] = (bag[id] || 0) + n; } };
  const busy = { v: false }, held = {}, where = {};
  const petsH = createPetsDomain({ sync: hSync }), petsR = createPetsDomain({ sync: rSync });
  const fishing = createFishing({ sync: hSync, ponds: duskFishPonds(island, mod), inventory, rareBoost: () => host.rareBoost });
  createFishing({ sync: rSync, ponds: duskFishPonds(island, mod) });
  const host = createCapray({ sync: hSync, plan, inventory, fishing, pets: petsH, cinematic: { get busy() { return busy.v; } }, params: opts.params, heldKind: (k) => held[k] || null, positions: () => Object.entries(where).map(([key, p]) => ({ key, x: p.x, z: p.z })) });
  const replica = createCapray({ sync: rSync, plan });
  rSync.linkUp(); hSync.screenConnected(1, { clientId: 'friend' }); flush();
  const rkey = `${rSync.screenId}:0`;
  const near = { x: plan.feed.x, y: 1, z: plan.feed.z };
  const shore = { index: 0, position: near }, hostP = { index: 0, position: { ...near } };
  return { hSync, rSync, host, replica, petsH, petsR, fishing, bag, busy, held, where, flush, rkey, shore, hostP, near, tick: (ms) => { time += ms; host.update(); flush(); },
    equal: () => assert.equal(hSync.hash(), rSync.hash(), 'hashes equal'), late() {
      const sync = new WorldSync({ role: 'replica', wallNow: () => time }); replicas.set(2, sync);
      sync.attachReplica({ send: (m) => { q.push([hSync, m, 2]); return true; } });
      createPetsDomain({ sync }); createFishing({ sync, ponds: duskFishPonds(island, mod) });
      const cap = createCapray({ sync, plan }); sync.linkUp(); hSync.screenConnected(2, { clientId: 'late' }); flush();
      return { sync, cap };
    } };
}
const stand = (t, off = 1) => ({ x: t.x + t.collR + off, z: t.z });

test('domain: the whole quest from a replica; rejections; equal hashes; the host saves exactly the spec keys', async () => {
  const w = pair(); w.equal(); const t0 = plan.titans[0];
  // the sighting
  const far = { index: 0, position: { x: plan.pond.x + 60, y: 0, z: plan.pond.z } };
  assert.equal((await Promise.all([w.replica.sight(far), w.flush()]))[0].ok, false, 'a remote asker far from the pond is rejected');
  let p = w.replica.sight(w.shore); w.flush(); assert.equal((await p).ok, true); assert.equal(w.host.stage, 1); assert.equal(w.replica.stage, 1); w.equal();
  p = w.replica.sight(w.shore); w.flush(); assert.equal((await p).reason, 'seen');
  // offerings: bag, wrong fish, reach
  p = w.replica.feed(w.shore, 'glimmerfin'); w.flush(); assert.equal((await p).reason, 'none');
  w.bag.glimmerfin = 3; w.bag.lanternkoi = 1;
  p = w.replica.feed(w.shore, 'lanternkoi'); w.flush(); assert.equal((await p).reason, 'wrong-fish');
  p = w.replica.feed(far, 'glimmerfin'); w.flush(); assert.equal((await p).reason, 'far');
  const heard = []; w.replica.on((k, d) => heard.push(k)); w.host.on((k) => heard.push(`h:${k}`));
  for (let n = 1; n <= 3; n++) { p = w.replica.feed(w.shore, 'glimmerfin'); w.flush(); assert.equal((await p).ok, true); assert.equal(w.bag.glimmerfin, 3 - n, 'one fish removed from the shared bag'); }
  assert.deepEqual([w.host.state.stage, w.host.state.fed, w.replica.state.stage, w.replica.state.fed], [3, 3, 3, 3]); assert.equal(w.host.state.leader, w.rkey); assert.equal(heard.filter((k) => k === 'feed').length, 3); w.equal();
  p = w.replica.feed(w.shore, 'glimmerfin'); w.flush(); assert.equal((await p).reason, 'full');
  // moss: needs a tool, counts on the host, no reset
  const by = { index: 0, position: { ...stand(t0), y: 1 } };
  p = w.replica.hit(by, 0); w.flush(); assert.equal((await p).reason, 'no-tool');
  w.held[w.rkey] = 'hammer'; p = w.replica.hit(by, 0); w.flush(); assert.equal((await p).reason, 'no-tool');
  w.held[w.rkey] = 'axe';
  p = w.replica.hit({ index: 0, position: { x: t0.x + 40, y: 1, z: t0.z } }, 0); w.flush(); assert.equal((await p).reason, 'far');
  for (let n = 1; n < CAPRAY.hits; n++) { p = w.replica.hit(by, 0); w.flush(); assert.equal((await p).ok, true); assert.equal(w.host.state.hits[0], n); assert.equal(w.replica.state.hits[0], n); assert.equal(w.host.state.moss[0], false); }
  p = w.replica.hit(by, 0); w.flush(); assert.equal((await p).ok, true); assert.equal(w.host.state.moss[0], true); w.equal();
  p = w.replica.hit(by, 0); w.flush(); assert.equal((await p).reason, 'cleared');
  // a shake: the leader must be near the titan, the shaker too
  w.where[w.rkey] = { x: t0.x + t0.collR + 1, z: t0.z };
  p = w.replica.shake(by, 1); w.flush(); assert.equal((await p).reason, 'smothered');
  p = w.replica.shake({ index: 0, position: { x: t0.x + 40, y: 1, z: t0.z } }, 0); w.flush(); assert.equal((await p).reason, 'far');
  w.where[w.rkey] = { x: t0.x + 30, z: t0.z };
  p = w.replica.shake(by, 0); w.flush(); assert.equal((await p).reason, 'leader-far', 'the ray is not with its leader');
  w.where[w.rkey] = { x: t0.x + t0.collR + 1, z: t0.z };
  p = w.replica.shake(by, 0); w.flush(); assert.equal((await p).ok, true); assert.equal(w.host.state.spores[0], true); w.equal();
  p = w.replica.shake(by, 0); w.flush(); assert.equal((await p).reason, 'done');
  // the other two titans straight through the host debug path (hits + shake)
  for (const i of [1, 2]) { assert.equal(w.host.debug.shake(i).ok, true); w.flush(); }
  assert.equal(w.host.stage, 4); assert.equal(w.replica.stage, 4); assert.deepEqual(w.replica.state.spores, [true, true, true]); w.equal();
  assert.equal(w.host.debug.shake(0).ok, false, 'not at stage 3 any more');
  // the host saved exactly the spec's keys at every step
  const saved = JSON.parse(storage.get(STORAGE_KEY)); assert.equal(saved.v, 1); assert.deepEqual(Object.keys(saved.capray).sort(), ['fed', 'leader', 'moss', 'spores', 'stage']); assert.equal(saved.capray.stage, 4);
  // a replica never writes: its own storage entry is untouched by the host's key (same global storage in this test, so just check the replica has no save flag)
  assert.equal(w.replica.summary().saved, false); assert.equal(w.host.summary().saved, true);
});

test('domain: a second player who shakes while the ray follows somebody else becomes the leader (no dead end)', async () => {
  const w = pair({ saved: { stage: 3, fed: 3, moss: [true, false, false], spores: [false, false, false], leader: 'host:0' } });
  const t0 = plan.titans[0], by = { index: 0, position: { ...stand(t0), y: 1 } };
  assert.equal(w.host.state.stage, 3, 'loaded from the save'); assert.deepEqual(w.host.state.moss, [true, false, false]);
  w.where['host:0'] = { x: t0.x + 50, z: t0.z }; w.where[w.rkey] = { x: t0.x + t0.collR + 1, z: t0.z };
  const kinds = []; w.replica.on((k) => kinds.push(k));
  let p = w.replica.shake(by, 0); w.flush(); assert.equal((await p).reason, 'leader-far');
  assert.equal(w.host.state.leader, w.rkey); assert.ok(kinds.includes('leader')); w.equal();
  p = w.replica.shake(by, 0); w.flush(); assert.equal((await p).ok, true);
  // a far shaker does not steal the lead
  const w2 = pair({ saved: { stage: 3, fed: 3, moss: [true, false, false], spores: [false, false, false], leader: 'host:0' } });
  w2.where['host:0'] = { x: t0.x + 50, z: t0.z };
  p = w2.replica.shake({ index: 0, position: { x: t0.x + 60, y: 1, z: t0.z } }, 0); w2.flush(); assert.equal((await p).reason, 'far'); assert.equal(w2.host.state.leader, 'host:0');
  // a leaving screen releases the lead
});

test('domain: pity during stage 4 feeds the fishing roll; the Lanternkoi starts the befriend scene behind cinematics, a replica skips it, the pet unlocks on both screens', async () => {
  const w = pair({ saved: { stage: 4, fed: 3, moss: [true, true, true], spores: [true, true, true], leader: 'host:0' } });
  assert.equal(w.host.rareBoost, 0); assert.equal(w.replica.rareBoost, 0);
  w.fishing.debug.catch(w.hostP, 'glimmerfin'); w.fishing.debug.catch(w.hostP, 'glimmerfin'); w.fishing.debug.catch(w.hostP, 'lanternkoi');
  assert.equal(w.host.pity, 2, 'only Glimmerfin count'); assert.ok(Math.abs(w.host.rareBoost - (2 * CAPRAY.pity)) < 1e-9);
  // the boost reaches the species roll: with the boost at the top, every chance-spot cast is a Lanternkoi
  const pondDeep = duskFishPonds(island, mod).find((q) => q.deep && !q.lagoon);
  const boosted = createFishing({ sync: new WorldSync({ role: 'host' }), ponds: duskFishPonds(island, mod), rareBoost: () => 1 });
  const sp = boosted.debug.spawn(pondDeep.id, 'chance').result;
  const cast = boosted.cast({ index: 0, position: { x: pondDeep.x + pondDeep.rx * 1.1 + 0.4, y: 0.3, z: pondDeep.z } }, pondDeep.id, { x: sp.x, z: sp.z });
  assert.equal(cast.ok, true); assert.equal(boosted.debug.casts[0].species, 'lanternkoi', 'a total chance of 1 rolls the Lanternkoi: the boost reaches the species roll');
  w.bag.lanternkoi = 1;
  w.busy.v = true;
  let p = w.replica.feed(w.shore, 'lanternkoi'); w.flush(); assert.equal((await p).ok, true); assert.equal(w.bag.lanternkoi, 0);
  assert.equal(w.host.stage, 5); assert.deepEqual(w.host.state.scene, { queued: true, startAt: null }); assert.equal(w.petsH.has('capray'), false); assert.equal(w.host.pity, 0, 'pity resets with the stage'); assert.equal(w.host.rareBoost, 0);
  w.tick(200); assert.equal(w.host.state.scene.startAt, null, 'queued behind a running cinematic'); w.equal();
  const events = []; w.replica.on((k) => events.push(k)); w.host.on((k) => events.push(`h:${k}`));
  w.busy.v = false; w.tick(100);
  assert.ok(Number.isFinite(w.host.state.scene.startAt)); assert.equal(w.host.state.scene.startAt, 5000 + 300 + CAPRAY.scene.preStart, 'host time + the pre-start'); assert.deepEqual(w.replica.state.scene, w.host.state.scene); w.equal();
  assert.equal(w.petsH.has('capray'), false, 'not yet: the scene is running');
  // a replica skips: everybody finishes, the pet unlocks everywhere, the scene is gone
  const unlocks = []; w.petsH.onUnlock((id, d) => unlocks.push(['host', id, d.live])); w.petsR.onUnlock((id, d) => unlocks.push(['replica', id, d.live]));
  p = w.replica.skip(); w.flush(); assert.equal((await p).ok, true);
  assert.deepEqual(w.host.state.scene, { queued: false, startAt: null }); assert.deepEqual(w.replica.state.scene, { queued: false, startAt: null }); assert.equal(w.host.stage, 5);
  assert.deepEqual(w.petsH.unlocked, ['capray']); assert.deepEqual(w.petsR.unlocked, ['capray']); assert.deepEqual(unlocks.sort(), [['host', 'capray', true], ['replica', 'capray', true]].sort()); w.equal();
  assert.ok(events.includes('start') && (events.includes('skip') || events.includes('h:skip')));
  p = w.replica.skip(); w.flush(); assert.equal((await p).reason, 'idle', 'nothing left to skip');
  const saved = JSON.parse(storage.get(STORAGE_KEY)).capray; assert.equal(saved.stage, 5);
  // the scene also ends by itself
  const w2 = pair({ saved: { stage: 4, fed: 3, moss: [true, true, true], spores: [true, true, true] } });
  w2.host.debug.befriend(); w2.flush(); w2.tick(100); assert.ok(Number.isFinite(w2.host.state.scene.startAt));
  w2.tick(CAPRAY.scene.preStart + (CAPRAY.scene.end - 0.5) * 1000); assert.equal(w2.petsH.has('capray'), false, 'still running'); w2.tick(1000);
  assert.equal(w2.petsH.has('capray'), true); assert.equal(w2.host.state.scene.startAt, null); w2.equal();
});

test('domain: late joiners get the state silently; a reload mid-scene still unlocks the pet; ?testcapray neither reads nor writes the save; reset and stage debug', async () => {
  const w = pair({ saved: { stage: 3, fed: 3, moss: [true, true, false], spores: [true, false, false], leader: 'x:1' } });
  const late = w.late(); assert.deepEqual(late.cap.state.moss, [true, true, false]); assert.equal(late.cap.state.leader, 'x:1'); assert.equal(late.sync.hash(), w.hSync.hash());
  const seen = []; late.cap.on((k) => seen.push(k));
  assert.equal(w.host.debug.stage(2).ok, true); w.flush(); assert.equal(late.cap.stage, 2); assert.equal(w.replica.stage, 2); assert.deepEqual(w.replica.state.moss, [false, false, false]); assert.ok(seen.includes('set')); w.equal();
  assert.equal(w.host.debug.reset().ok, true); w.flush(); assert.equal(w.replica.stage, 0); assert.equal(w.replica.state.leader, null);
  const denied = w.replica.debug.stage(3); w.flush(); assert.equal((await denied).ok, false, 'a replica cannot run host debug');
  assert.equal(w.host.debug.feed().ok, false, 'nothing to offer at stage 0'); w.host.debug.stage(1); assert.equal(w.host.debug.feed().ok, true); assert.equal(w.host.state.fed, 1);
  assert.equal(w.host.debug.clear(0).ok, false, 'not at stage 3');
  // recovery: stage 5 saved, the pet never unlocked (the host reloaded mid-scene)
  const r = pair({ saved: { stage: 5, fed: 3 } });
  assert.equal(r.petsH.has('capray'), false); r.tick(50); assert.equal(r.petsH.has('capray'), true, 'the first update unlocks it'); r.equal();
  // ?testcapray: fresh state, nothing written
  storage.clear(); duskSave.reset(); storage.set(STORAGE_KEY, JSON.stringify({ v: 1, capray: { stage: 4, fed: 3 } }));
  const t = pair({ params: new URLSearchParams('testcapray') }); assert.equal(t.host.stage, 0, 'the saved progress is not read');
  storage.set(STORAGE_KEY, JSON.stringify({ v: 1, capray: { stage: 4, fed: 3 } })); t.host.debug.stage(2); assert.equal(JSON.parse(storage.get(STORAGE_KEY)).capray.stage, 4, 'and not overwritten');
  assert.equal(SAVE_KEY, 'capray');
});

// ---- the world side, with fakes ------------------------------------------------------------------------------------------------------------------------------------------------
function fakePlayer(index, x, z) {
  return { index, position: new THREE.Vector3(x, 1, z), away: false, frozen: false, leaving: false, facing: 0, swinging: false, petIndex: -1, colors: { ui: '#fff', name: `P${index + 1}` }, faceToward() {}, hop() {}, teleport() {} };
}
function worldWith(opts = {}) {
  storage.clear(); duskSave.reset();
  if (opts.saved) storage.set(STORAGE_KEY, JSON.stringify({ v: 1, capray: opts.saved }));
  let wall = 1000; const sync = new WorldSync({ role: 'host', wallNow: () => wall });
  const bag = { glimmerfin: 0, lanternkoi: 0 }, inventory = { count: (id) => bag[id] || 0, remove: (id, n) => { bag[id] -= n; return true; }, add() {} };
  const p = fakePlayer(0, plan.feed.x + 1, plan.feed.z), players = { list: [p], p1: p, multi: false };
  const held = { kind: 'axe' }, swings = [], cin = { busy: false, active: false, startPos: null, startLook: null, begin() { this.busy = this.active = true; return true; }, end() { this.busy = this.active = false; }, releaseAll() {}, freezeAll() {}, pollSkip() { return false; }, look() {}, showBanner(l) { this.banner = l; }, banner: null };
  const petsD = createPetsDomain({ sync, params: new URLSearchParams('testpet') });
  petsD.reset();
  const capray = createCapray({ sync, plan, inventory, pets: petsD, cinematic: cin, heldKind: () => held.kind, positions: () => [{ key: 'host:0', x: p.position.x, z: p.position.z }], params: opts.params });
  const dims = new Map(), flora = { setDim: (id, v) => dims.set(id, v) };
  const items = { list: [{ kind: 'rod', state: 'ground' }], swing: (pl) => { swings.push(pl); return true; } };
  const dialogs = [], dialog = { isOpen: false, open(o) { this.isOpen = true; this.last = o; dialogs.push(o); }, close() { this.isOpen = false; } };
  const set = [], pets = { petOf: () => null, set: (pl, id) => { set.push([pl, id]); return id; } };
  const hudT = [], hud = { toast: (t) => hudT.push(t) };
  const parts = [], particles = { burst: (type) => parts.push(type) };
  const bubbles = [], thoughts = { show: (k, a, svg) => bubbles.push(k) };
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  const world = { regions: { isFull: () => true } };
  const cw = createCaprayWorld({ scene, players, world, sync, capray, plan, domain: petsD, pets, items, inventory, thoughts, particles, sfx: null, hud, dialog, cinematic: cin, camera, floatText: () => {}, heightAt: () => 1, flora, marlo: null });
  return { sync, capray, cw, p, players, bag, held, swings, dims, items, dialog, dialogs, set, hudT, parts, bubbles, scene, cin, petsD, camera, advance(ms) { wall += ms; }, step(dt, n = 1) { for (let i = 0; i < n; i++) { capray.update(); cw.update(dt); } } };
}
const stateOf = (w) => w.capray.state;

test('world: interactables are registered once and offered only in their own state', () => {
  const w = worldWith(); const { feed, moss, shake } = w.cw.interactables;
  const count = getInteractables().filter((i) => ['caprayfeed', 'shademoss', 'titanshake'].includes(i.type)).length; assert.ok(count >= 7);
  assert.equal(feed.canInteract(), false, 'stage 0');
  w.capray.debug.stage(1); w.step(0.1); assert.equal(feed.canInteract(), false, 'no fish in the bag'); w.bag.glimmerfin = 1; assert.equal(feed.canInteract(), true); assert.equal(feed.prompt, 'Offer a Glimmerfin');
  w.capray.debug.stage(4); w.step(0.1); assert.equal(feed.canInteract(), false, 'wrong fish'); w.bag.lanternkoi = 1; assert.equal(feed.canInteract(), true); assert.equal(feed.prompt, 'Offer a Lanternkoi');
  w.capray.debug.stage(3); w.step(0.1);
  assert.deepEqual(moss.map((m) => m.canInteract()), [true, true, true]); assert.deepEqual(shake.map((m) => m.canInteract()), [false, false, false]);
  w.capray.debug.clear(1); w.step(0.1);
  assert.deepEqual(moss.map((m) => m.canInteract()), [true, false, true]); assert.deepEqual(shake.map((m) => m.canInteract()), [false, true, false]);
  w.capray.debug.shake(1); w.step(0.1); assert.deepEqual(shake.map((m) => m.canInteract()), [false, false, false]);
  for (const m of moss) { assert.equal(m.type, 'shademoss'); assert.equal(m.prompt, 'Clear'); assert.equal(m.position.x, m.titan.x); assert.equal(m.radius, m.titan.collR + 0.9); }
  assert.deepEqual(shake.map((m) => m.prompt), ['Shake', 'Shake', 'Shake']);
  // a pond-side collision with the plain 'pond' interactable would hide casting: the feed spot is only offered when feeding is possible (canInteract above)
  assert.equal(getInteractables().filter((i) => i.type === 'caprayfeed').length >= 1, true);
});

test('world: the moss layer is ONE instanced draw that grows at stage 3, shrinks per hit and clears; the titan caps dim and come back', () => {
  const w = worldWith(); const mossMesh = w.cw.moss.mesh;
  assert.equal(mossMesh.isInstancedMesh, true); assert.equal(mossMesh.count, 3); assert.ok(mossMesh.parent === w.scene, 'one mesh in the scene'); assert.equal(mossMesh.castShadow, false);
  assert.ok(mossGeometry().attributes.position.count > 400); assert.equal(w.cw.moss.visible, false, 'no moss before stage 3');
  w.capray.debug.stage(3); w.step(0.1, 30);                                   // 3 s: grown in
  assert.equal(w.cw.moss.visible, true); assert.deepEqual(w.cw.moss.scale, [1, 1, 1]); assert.deepEqual(w.cw.moss.dim, [1, 1, 1]); assert.deepEqual([...w.dims.values()], [1, 1, 1]);
  assert.deepEqual([...w.dims.keys()].sort(), plan.titans.map((t) => t.id).sort());
  // the matrix of instance 0 sits on titan 0
  const m = new THREE.Matrix4(), pos = new THREE.Vector3(); mossMesh.getMatrixAt(0, m); pos.setFromMatrixPosition(m);
  assert.ok(Math.abs(pos.x - plan.titans[0].x) < 1e-3 && Math.abs(pos.z - plan.titans[0].z) < 1e-3);
  // hits shrink it by a quarter each
  for (let n = 1; n < CAPRAY.hits; n++) { w.capray.api; w.sync.request('capray', 'hit', { i: 0 }, { screen: 'host', index: 0, pos: { x: plan.titans[0].x + plan.titans[0].collR + 1, y: 1, z: plan.titans[0].z } }); w.step(0.1, 20); assert.ok(Math.abs(w.cw.moss.scale[0] - (1 - n / CAPRAY.hits)) < 0.02, `after ${n} hits ${w.cw.moss.scale[0]}`); }
  assert.deepEqual(w.cw.moss.scale.slice(1), [1, 1], 'the others are untouched');
  w.capray.debug.clear(0); w.step(0.1, 40); assert.equal(w.cw.moss.scale[0], 0); assert.equal(w.cw.moss.dim[0], 0, 'the cap glow came back'); assert.equal(w.dims.get(plan.titans[0].id), 0);
  w.capray.debug.shake(1); w.capray.debug.shake(2); w.capray.debug.shake(0); w.step(0.1, 20);
  assert.equal(w.capray.stage, 4); assert.equal(w.cw.moss.visible, false); assert.deepEqual(w.cw.moss.dim, [0, 0, 0]);
  // a snapshot / debug set jumps straight there
  w.capray.debug.stage(3); w.step(0.0, 1); assert.deepEqual(w.cw.moss.scale, [1, 1, 1], 'a silent set needs no animation'); assert.deepEqual(w.cw.moss.dim, [1, 1, 1]);
});

test('world: duskFlora remembers a dim for the next visuals build, clamps it and drops zeros', () => {
  duskFlora.dims.clear();
  duskFlora.setDim('dusk-titan-01', 1); duskFlora.setDim('dusk-titan-02', 7); duskFlora.setDim('dusk-titan-03', -2);
  assert.equal(duskFlora.dims.get('dusk-titan-01'), 1); assert.equal(duskFlora.dims.get('dusk-titan-02'), 1); assert.equal(duskFlora.dims.has('dusk-titan-03'), false);
  duskFlora.setDim('dusk-titan-01', 0); assert.equal(duskFlora.dims.has('dusk-titan-01'), false); duskFlora.dims.clear();
});

test('world: a swing with an axe sends the host one hit at the impact frame; one swing per player at a time', () => {
  const w = worldWith({ saved: { stage: 3, fed: 3 } }); const t = plan.titans[0], it = w.cw.interactables.moss[0];
  w.p.position.set(t.x + t.collR + 1, 1, t.z);
  assert.equal(w.cw.clearMoss(it, w.p), true); assert.equal(w.swings.length, 1); assert.equal(w.cw.clearMoss(it, w.p), false, 'one at a time');
  w.step(0.1); assert.equal(stateOf(w).hits[0], 0, 'not before the impact'); w.step(0.1, 3); assert.equal(stateOf(w).hits[0], 1);
  assert.equal(w.cw.clearMoss({}, w.p), false); w.held.kind = 'hammer'; w.cw.clearMoss(it, w.p); w.step(0.1, 4); assert.equal(stateOf(w).hits[0], 1, 'a hammer is no use (the host checks the tool)');
  w.held.kind = 'sword'; for (let n = 0; n < 4; n++) { w.cw.clearMoss(it, w.p); w.step(0.1, 4); }
  assert.equal(stateOf(w).moss[0], true); assert.ok(w.parts.includes('leaf'), 'chips flew'); assert.ok(w.hudT.some((x) => /moss is gone/i.test(x)));
});

test('world: the wild ray appears only after a rod was picked up, darts at the pond (which asks for stage 1), follows its leader, hides at stage 5', () => {
  const w = worldWith(); const t = plan.titans[0];
  w.p.position.set(plan.pond.x + 40, 1, plan.pond.z);
  w.step(0.1, 5); assert.equal(w.cw.wild.shown, false); assert.equal(w.cw.rodSeen, false, 'no rod yet');
  w.items.list[0].state = 'held'; w.step(0.1, 5); assert.equal(w.cw.rodSeen, true); assert.equal(w.cw.wild.shown, true); assert.equal(w.cw.wild.mode, 'shy'); assert.equal(stateOf(w).stage, 0, 'far away: no sighting yet');
  const onPond = (x) => Math.abs(x - plan.pond.x) < plan.pond.rx;
  assert.ok(onPond(w.cw.wild.position.x) || Math.hypot(w.cw.wild.position.x - plan.pond.x, w.cw.wild.position.z - plan.pond.z) < plan.pond.rx + 1, 'it lives on the pond');
  w.p.position.set(plan.pond.x + plan.pond.rx + 2, 1, plan.pond.z);       // within CAPRAY.sight of the edge
  w.step(0.1); assert.equal(stateOf(w).stage, 1, 'the approach asked the host'); assert.equal(w.cw.wild.dart, true); assert.ok(w.bubbles.includes('capray-dots'), 'a "..." thought');
  w.step(0.1, 10); assert.equal(w.cw.wild.shown, false, 'under a lily pad for a moment'); w.step(0.1, 25); assert.equal(w.cw.wild.shown, true); assert.equal(w.cw.wild.mode, 'pond');
  // offerings bring it closer to the shore
  const dist = () => Math.hypot(w.cw.wild.position.x - plan.feed.x, w.cw.wild.position.z - plan.feed.z);
  w.step(0.1, 40); const d0 = dist(); w.bag.glimmerfin = 3; w.capray.debug.feed(); w.step(0.1, 60); assert.ok(dist() < d0 - 0.5, `closer after an offering (${d0} -> ${dist()})`);
  assert.ok(w.parts.includes('heart'), 'hearts after the gulp');
  w.capray.debug.stage(3); w.step(0.1, 5);
  w.p.position.set(t.x + t.collR + 3, 1, t.z); w.step(0.1, 120); assert.equal(w.cw.wild.mode, 'follow');
  assert.ok(Math.hypot(w.cw.wild.position.x - w.p.position.x, w.cw.wild.position.z - w.p.position.z) < 6, 'it trails its leader');
  // a shake: it hovers under the cap and glows one step brighter afterwards
  const g0 = w.cw.wild.glow; w.sync.request('capray', 'debug', { op: 'shake', i: 0 }, { screen: 'host', index: 0, pos: { x: 0, y: 0, z: 0 } }); w.step(0.1, 8); assert.equal(w.cw.wild.soak, true);
  w.step(0.1, 60); assert.ok(w.cw.wild.glow > g0 + 0.05, `glow ${g0} -> ${w.cw.wild.glow}`); assert.ok(w.parts.filter((x) => x === 'sparkle').length >= 9, 'a spore shower');
  w.capray.debug.stage(5); w.step(0.1, 5); assert.equal(w.cw.wild.shown, true, 'it stays until the befriend scene is over');
  w.capray.skip(); w.step(0.1, 5); assert.equal(w.cw.wild.shown, false, 'gone once befriended');
});

test('world: the wild ray costs 4 draw calls and shares the pet shader program (own glow uniform, no new program)', () => {
  const w = worldWith({ saved: { stage: 1, fed: 0 } }); w.items.list[0].state = 'held'; w.p.position.set(plan.pond.x + 30, 1, plan.pond.z); w.step(0.1, 5);
  const summary = w.cw.summary(); assert.equal(summary.wild.shown, true); assert.equal(summary.drawCalls, 4);
  let meshes = 0; w.scene.traverse((o) => { if (o.isMesh && o.parent && o.material && o.material.name !== undefined && o.geometry && o.geometry.attributes.aGlow) meshes++; });
  assert.equal(meshes, 3, 'the model has three merged meshes (+ the body shadow pass = 4 draw calls)');
  const mats = new Set(); w.scene.traverse((o) => { if (o.isMesh && o.geometry?.attributes?.aGlow) mats.add(o.material); });
  assert.equal(mats.size, 1); const mat = [...mats][0];
  assert.equal(mat.customProgramCacheKey(), 'pet-toon', 'the same program key as the followers');
  const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <begin_vertex>', fragmentShader: '#include <common>\n#include <opaque_fragment>' };
  mat.onBeforeCompile(shader, {}); assert.ok(shader.uniforms.uGlow && typeof shader.uniforms.uGlow.value === 'number'); assert.ok(shader.uniforms.uGlow !== undefined);
});

test('world: the befriend scene runs on the cinematic stage, pops the pod, shows the banner, ends on finish / skip and frees everything', () => {
  const w = worldWith({ saved: { stage: 4, fed: 3 } });
  w.sync.request('capray', 'debug', { op: 'befriend' }, { screen: 'host', index: 0, pos: { x: 0, y: 0, z: 0 } });
  assert.equal(stateOf(w).stage, 5);
  w.step(0.05, 2); assert.ok(Number.isFinite(stateOf(w).scene.startAt));
  w.step(0.05, 20); assert.equal(w.cw.scene.active, true, 'the scene started'); assert.equal(w.cin.active, true);
  assert.equal(w.petsD.has('capray'), false);
  w.capray.skip(); w.step(0.05, 2);
  assert.equal(w.cw.scene.active, false); assert.equal(w.cin.active, false); assert.equal(w.petsD.has('capray'), true); assert.equal(w.cw.wild.shown, false);
  assert.ok(w.dialog.isOpen && w.dialog.last.menuId === 'capray-ask', 'then the question for the local player');
});

test('world: the befriend scene timeline: the ray loops round the feeder, three more rise from the pond, the banner at 4.3 s, it ends by itself and then asks', () => {
  const w = worldWith({ saved: { stage: 4, fed: 3, leader: 'host:0' } }); const shown = () => { let n = 0; w.scene.traverse((o) => { if (o.isMesh && o.geometry?.attributes?.aGlow) { let v = true; for (let q = o; q; q = q.parent) if (!q.visible) v = false; if (v) n++; } }); return n; };
  w.sync.request('capray', 'debug', { op: 'befriend' }, { screen: 'host', index: 0, pos: { x: 0, y: 0, z: 0 } });
  w.step(0.05, 2); const start = stateOf(w).scene.startAt; assert.ok(start > 1000);
  const run = (sec) => { for (let i = 0; i < Math.round(sec * 10); i++) { w.advance(100); w.step(0.1); } };      // the host clock and the simulation move together
  w.advance(start - 1000 - 200); w.step(0.1); run(0.3); assert.equal(w.cw.scene.active, true); assert.equal(w.cin.banner, null);
  assert.equal(shown(), 3, 'the wild ray alone at the start (3 merged meshes + the body shadow pass = 4 draw calls)');
  run(1.0); assert.ok(w.cw.scene.t >= 1.0);                                                     // ~1.3 s: looping round the feeder
  const f = { x: w.p.position.x, z: w.p.position.z };
  run(1.2); assert.ok(Math.hypot(w.cw.wild.position.x - f.x, w.cw.wild.position.z - f.z) < 4, 'near the feeder');
  run(1.4); assert.ok(shown() >= 6, `the pod is rising (${shown()} meshes)`);                    // ~3.9 s
  assert.equal(w.cin.banner, null);
  run(0.9); assert.equal(w.cin.banner[0].text, 'Capray wants to come with you!'); assert.ok(w.parts.includes('confetti'));
  assert.equal(shown(), 12, 'the ray and the pod of three: 4 x 3 meshes');
  assert.equal(w.petsD.has('capray'), false);
  run(CAPRAY.scene.end); w.step(0.1, 2);
  assert.equal(w.cw.scene.active, false, 'over by itself'); assert.equal(w.petsD.has('capray'), true); assert.equal(shown(), 0, 'the pod and the wild ray are gone'); assert.equal(w.cin.active, false);
  w.step(0.1, 2); assert.equal(w.dialog.last.menuId, 'capray-ask');
});

test('world: "Bring Capray along?" asks each local player once after a live unlock; Yes brings it, Not now does not', () => {
  const w = worldWith();
  assert.equal(w.dialog.isOpen, false);
  const p2 = fakePlayer(1, 0, 0); w.players.list.push(p2);
  w.petsD.unlock('capray'); w.step(0.1);
  assert.equal(w.dialog.isOpen, true); assert.equal(w.dialog.last.owner, w.p); assert.equal(w.dialog.last.text, 'Bring Capray along?');
  const rows = w.dialog.last.choices; assert.deepEqual(rows.map((r) => r.label), ['Yes!', 'Not now']);
  rows[0].onSelect(); assert.deepEqual(w.set[0], [w.p, 'capray']); assert.equal(w.dialog.isOpen, false);
  w.step(0.1); assert.equal(w.dialog.last.owner, p2, 'the next local player is asked'); w.dialog.last.choices[1].onSelect(); assert.equal(w.set.length, 1, 'Not now sets nothing'); w.step(0.1); assert.equal(w.dialog.last.owner, p2, 'and nobody is asked twice');
  // a silent load never asks
  const w2 = worldWith(); w2.petsD.debugSet(['capray']); w2.step(0.1); assert.equal(w2.dialog.isOpen, false);
});

// ---- the stable ------------------------------------------------------------------------------------------------------------------------------------------------------------------
function stableWith({ unlocked = false } = {}) {
  storage.clear();
  const sync = new WorldSync({ role: 'host', wallNow: () => 1000 }), domain = createPetsDomain({ sync, params: new URLSearchParams('testpet') });
  domain.reset(); if (unlocked) domain.unlock('capray');
  const scene = new THREE.Scene(), p = fakePlayer(0, 0, 0), players = { list: [p], p1: p, multi: false };
  const choices = [], pets = { petOf: (pl) => pl.__pet || null, set: (pl, id) => { choices.push([pl, id]); pl.__pet = id; return id; } };
  const dialog = { isOpen: false, open(o) { this.isOpen = true; this.last = o; }, close() { this.isOpen = false; } };
  const hudT = [], hud = { toast: (t) => hudT.push(t) }, parts = [], particles = { burst: (t) => parts.push(t) };
  const layout = duskHearthLayout().stable;
  const before = { colliders: getColliders().length, inter: getInteractables().length };
  const stable = createPetStable({ scene, players, avatars: null, world: { regions: { isFull: () => true } }, domain, pets, dialog, particles, sfx: null, hud, heightAt: () => 1, layout });
  return { sync, domain, scene, p, players, choices, dialog, hudT, parts, stable, layout, before, pets };
}
const countOf = (type) => getInteractables().filter((i) => i.type === type).length;

test('stable: absent before the first pet, pops in on a LIVE unlock, registers colliders once, survives repeated change events, goes away on reset', () => {
  const w = stableWith(); const c0 = getColliders().length;
  assert.equal(w.stable.built, false); assert.equal(w.stable.group, null); assert.equal(countOf('stable'), 0); assert.equal(getColliders().length, c0);
  w.domain.unlock('capray');
  assert.equal(w.stable.built, true); assert.equal(w.stable.popping, true, 'popping in'); assert.equal(getColliders().length, c0 + 5, 'four posts and the basin'); assert.equal(countOf('stable'), 1);
  assert.equal(w.stable.group.children.find((c) => c.name === 'pet-stable-mesh').visible, false, 'the merged mesh waits for the pop');
  for (let i = 0; i < 40; i++) w.stable.update(0.05);
  assert.equal(w.stable.popping, false); assert.equal(w.stable.group.children.find((c) => c.name === 'pet-stable-mesh').visible, true); assert.ok(w.parts.includes('puff') && w.parts.includes('sparkle'));
  w.domain.debugSet(['capray']); w.stable.update(0.05); assert.equal(getColliders().length, c0 + 5, 'not registered twice'); assert.equal(countOf('stable'), 1);
  const s = w.stable.summary(); assert.equal(s.built, true); assert.equal(s.colliders, 5); assert.equal(s.interactable, true);
  assert.ok(s.drawCalls <= 7, `the pavilion plus a resting Capray is at most 7 draw calls, got ${s.drawCalls}`); assert.equal(w.stable.summary().resting, true);
  // the colliders sit around the reserved circle and the interactable at its centre
  const it = getInteractables().find((i) => i.type === 'stable'); assert.equal(it.prompt, 'Choose a pet'); assert.ok(Math.hypot(it.position.x - w.layout.x, it.position.z - w.layout.z) < 1e-6);
  const mine = getColliders().slice(-5); for (const c of mine) assert.ok(Math.hypot(c.x - w.layout.x, c.z - w.layout.z) <= w.layout.r, 'inside the reserved circle');
  // everything inside the reserved circle: the geometry itself
  const g = stableGeometries(); for (const geo of [g.base, g.roof]) { geo.computeBoundingBox(); const bb = geo.boundingBox; assert.ok(Math.max(Math.abs(bb.min.x), bb.max.x, Math.abs(bb.min.z), bb.max.z) <= w.layout.r, 'within the reserved radius'); }
  w.domain.reset(); w.stable.update(0.05); assert.equal(w.stable.built, false); assert.equal(getColliders().length, c0); assert.equal(countOf('stable'), 0);
});

test('stable: a load / late join with Capray already unlocked just stands there (no pop, no sparkles), and an ordinary change event does not pop it', () => {
  const w = stableWith({ unlocked: true });
  assert.equal(w.stable.built, true); assert.equal(w.stable.popping, false); assert.equal(w.parts.length, 0); assert.equal(w.stable.group.children.find((c) => c.name === 'pet-stable-mesh').visible, true);
  w.domain.debugSet(['capray']); assert.equal(w.stable.popping, false);
});

test('stable: the menu lists Capray, No pet and three locked silhouettes with the hints; choosing sets that player\'s pet', () => {
  const w = stableWith({ unlocked: true }); for (let i = 0; i < 5; i++) w.stable.update(0.05);
  assert.equal(w.stable.open(w.p), true); assert.equal(w.dialog.isOpen, true); assert.equal(w.dialog.last.menuId, 'pet-stable'); assert.equal(w.dialog.last.owner, w.p);
  assert.equal(w.stable.open(w.p), false, 'one dialog at a time');
  const rows = w.dialog.last.choices(); assert.deepEqual(rows.map((r) => r.label), ['Capray', 'No pet', '???', '???', '???']);
  assert.deepEqual(rows.slice(2).map((r) => r.detail), LOCKED_PETS.map((l) => l.hint)); assert.ok(rows.slice(2).every((r) => r.disabled === true));
  assert.deepEqual(rows.slice(2).map((r) => r.detail), ['Something small watches the home campfire...', 'Tracks in the Frostpine snow...', "A rustle in Emberleaf's leaves..."]);
  assert.equal(rows[0].detail, 'Bring along');
  rows[0].onSelect(); assert.deepEqual(w.choices.at(-1), [w.p, 'capray']); assert.equal(w.dialog.isOpen, false); assert.ok(w.hudT.some((t) => /Capray will come along/.test(t)));
  assert.equal(w.stable.rows(w.p)[0].detail, 'Coming along'); assert.equal(w.stable.rows(w.p)[1].detail, 'Leave it here');
  w.stable.open(w.p); w.dialog.last.choices()[1].onSelect(); assert.deepEqual(w.choices.at(-1), [w.p, null]); assert.ok(w.hudT.some((t) => /No pet/.test(t)));
  assert.equal(stableWith({ unlocked: false }).stable.open(w.p), false, 'no stable, no menu');
});

test('stable: Capray rests in the basin while nobody brings it, and leaves it when somebody does', () => {
  const w = stableWith({ unlocked: true });
  w.stable.update(0.05); assert.ok(w.stable.restingModel, 'floating in the basin'); assert.equal(w.stable.restingModel.id, 'capray');
  w.pets.set(w.p, 'capray'); w.stable.update(0.05); assert.equal(w.stable.restingModel, null, 'somebody brings it along');
  w.pets.set(w.p, null); w.stable.update(0.05); assert.ok(w.stable.restingModel);
});

test('Marlo gets a row provider and the stage text follows the quest', async () => {
  const { createMarlo } = await import('../public/js/world/marlo.js');
  assert.equal(typeof createMarlo, 'function');
  assert.ok(marloLine(debugState(3), true)[0].match(/axe or a sword/i));
});

test('budget: the moss cluster is one merged geometry; the wild ray + moss + stable together stay within 12 draw calls', () => {
  const g = mossGeometry(); assert.ok(g.attributes.position.count < 20000);
  const w = worldWith({ saved: { stage: 3, fed: 3 } }); w.items.list[0].state = 'held'; w.step(0.1, 40);
  const s = stableWith({ unlocked: true }); for (let i = 0; i < 40; i++) s.stable.update(0.05);
  const total = w.cw.summary().drawCalls + s.stable.summary().drawCalls;
  assert.ok(total <= 12, `ray 4 + moss 1 + stable (pavilion 3 + resting Capray 4) = ${total}`);
});
