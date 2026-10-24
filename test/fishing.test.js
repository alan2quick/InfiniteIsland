// Step 72a: the marsh hearth, the Glowline Rod and the fishing core. Pure rules (spot schedule, casting, the bite schedule, press judging), the hearth + rods against the real Duskcrown terrain and the
// 69c / 69d placements, the rod as a tool, the pond targets registered once, the pose flag, and the `fishing` domain on a real host + replica WorldSync pair (cast, claim races, catch, replay, hashes, late join).
import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldSync } from '../public/js/net/worldSync.js';
import { ISLANDS, FIRES, CAMPFIRE_ISLANDS, DUSK_HEARTH, FISHING, nearAnyFire, INTERACT_RADIUS } from '../public/js/config.js';
import { domainOf, menuIdOf, saveKeyOf } from '../public/js/game/fireLogic.js';
import { getIslandModule } from '../public/js/world/islands/registry.js';
import { buildDuskPlacement } from '../public/js/world/islands/duskPlacement.js';
import { buildDuskFlora } from '../public/js/world/islands/duskFlora.js';
import { duskDockLayout } from '../public/js/world/islands/duskDock.js';
import { duskHearthLayout, duskFishPonds } from '../public/js/world/islands/duskHearth.js';
import { registerDuskGameplay } from '../public/js/world/islands/duskWorld.js';
import { getInteractables } from '../public/js/world/interactables.js';
import { getToolAction, actionForKind, toolHits, TOOLS } from '../public/js/items/tools.js';
import { buildItemModel } from '../public/js/items/models.js';
import { getItem } from '../public/js/game/catalog.js';
import { encodePose, decodePose } from '../public/js/net/poseBuffer.js';
import { mulberry32 } from '../public/js/utils/rng.js';
import {
  createSpotSim, tickSpots, spotList, claimSpot, releaseSpot, findSpot, pondS, aimCast, clampInside, nearestSpot, bobberFor,
  rollSchedule, rollSpecies, scheduleView, judgePresses, anglerStatus, castEnd, validateCast, validateReel, nearPond, edgeDistance,
} from '../public/js/game/fishingLogic.js';
import { createFishing } from '../public/js/game/fishing.js';

const island = ISLANDS.find((i) => i.id === 'duskcrown'), mod = getIslandModule('duskcrown');
const ponds = duskFishPonds(), byId = new Map(ponds.map((p) => [p.id, p]));
const hearth = duskHearthLayout();
const bank = (pond, a = 0.4) => ({ x: pond.x + Math.cos(a) * (pond.rx * 1.05 + 0.4), y: 0.3, z: pond.z + Math.sin(a) * (pond.rz * 1.05 + 0.4) });

test('the marsh hearth is a FIRES entry with its own domain, menu, save key and island; the other fires are untouched', () => {
  const dusk = FIRES.find((f) => f.id === 'dusk');
  assert.ok(dusk); assert.deepEqual(FIRES.map((f) => f.id), ['home', 'frost', 'ember', 'dusk']);
  assert.equal(dusk.island, 'duskcrown'); assert.equal(dusk.bench.style, 'capstool'); assert.equal(dusk.bench.angles.length, 4); assert.equal(dusk.jobs, false); assert.ok(dusk.intro.length >= 3);
  assert.equal(domainOf('dusk'), 'campfire:dusk'); assert.equal(menuIdOf('dusk'), 'campfire:dusk'); assert.equal(saveKeyOf('dusk'), 'infinite-island.campfire.dusk.v1');
  assert.deepEqual(CAMPFIRE_ISLANDS, ['home', 'frost', 'ember', 'duskcrown']);
  assert.equal(domainOf('home'), 'campfire'); assert.equal(saveKeyOf('home'), 'infinite-island.campfire.v1'); assert.equal(saveKeyOf('ember'), 'infinite-island.campfire.ember.v1');
  assert.equal(dusk.x, island.x + DUSK_HEARTH.x); assert.equal(dusk.z, island.z + DUSK_HEARTH.z);
  // far from every home / Frostpine / Emberleaf spot: their keep-clear tests are unaffected
  for (const [x, z] of [[0, 0], [0, -197], [197, 47]]) assert.equal(nearAnyFire(x, z, 100) && FIRES.filter((f) => f.id !== 'dusk').every((f) => Math.hypot(f.x - dusk.x, f.z - dusk.z) < f.clear + 100), false);
});

test('the hearth stands on real, dry marsh near the landing, clear of the dock, lanes, ponds and both placements; their hashes are unchanged', () => {
  const P = buildDuskPlacement(island, mod), F = buildDuskFlora(island, mod), dock = duskDockLayout(), L = mod.layout;
  assert.equal(P.hash(), 'a3374631'); assert.equal(F.hash(), 'dc5f974e');
  assert.equal(duskHearthLayout(), hearth, 'cached');
  const fire = hearth.fire;
  assert.deepEqual([fire.x, fire.z], [island.x + DUSK_HEARTH.x, island.z + DUSK_HEARTH.z]);
  const toLanding = Math.hypot(DUSK_HEARTH.x - L.landing.x, DUSK_HEARTH.z - L.landing.z);
  assert.ok(toLanding > 8 && toLanding + hearth.zone.r - 8 <= 30, `inside the 30 u flora-free landing disc (${toLanding})`);   // (the zone's far edge stays in the disc)
  assert.ok(mod.walkable(fire.x, fire.z)); assert.ok(mod.height(fire.x, fire.z) >= 0.3, 'dry ground');
  for (const s of hearth.seats) { assert.ok(mod.walkable(s.x, s.z)); assert.ok(mod.height(s.x, s.z) >= 0.3); assert.ok(Math.abs(Math.hypot(s.x - fire.x, s.z - fire.z) - DUSK_HEARTH.ring) < 1e-9); }
  const z = hearth.zone;
  for (const m of P.items) assert.ok(Math.hypot(m.x - z.x, m.z - z.z) > z.r + (m.baseR || 1), `mushroom ${m.id}`);
  for (const s of F.solids) assert.ok(Math.hypot(s.x - z.x, s.z - z.z) > z.r + (s.r || 1), `solid ${s.id}`);
  for (const [layer, items] of Object.entries(F.layers)) for (const it of items) assert.ok(Math.hypot(it.x - z.x, it.z - z.z) > z.r || layer === 'lily', `${layer} inside the hearth zone`);
  for (const pnd of ponds) assert.ok(Math.hypot(pnd.x - z.x, pnd.z - z.z) - Math.max(pnd.rx, pnd.rz) > z.r * 0.7, `pond ${pnd.id} too near`);
  for (const lane of P.lanes) for (const [x, zz] of lane) assert.ok(Math.hypot(x - fire.x, zz - fire.z) > DUSK_HEARTH.clear + 2.5, 'a walking lane runs through the hearth plaza');
  assert.ok(Math.hypot(dock.zone.x - z.x, dock.zone.z - z.z) > dock.zone.r + DUSK_HEARTH.clear, 'clear of the dock');
  assert.ok(Math.hypot(fire.x - (island.x + L.landing.x), fire.z - (island.z + L.landing.z)) > 8, 'not on the arrival beach');
});

test('the stable spot (Step 73) and the four rod pickups are flat, dry, apart and outside the fire\'s keep-clear ring', () => {
  const { stable, rods, fire } = hearth;
  assert.ok(stable.r >= 4 && mod.walkable(stable.x, stable.z) && mod.height(stable.x, stable.z) >= 0.3);
  assert.ok(Math.hypot(stable.x - fire.x, stable.z - fire.z) > DUSK_HEARTH.clear + stable.r * 0.8, 'the stable does not sit on the benches');
  assert.equal(rods.length, 4);
  for (let i = 0; i < 4; i++) {
    const r = rods[i];
    assert.ok(mod.walkable(r.x, r.z) && mod.height(r.x, r.z) >= 0.3 && mod.slopeAt(r.x, r.z, 0.4) <= 0.3, `rod ${i} on flat dry ground`);
    assert.ok(Math.hypot(r.x - fire.x, r.z - fire.z) >= DUSK_HEARTH.clear + 1, `rod ${i} outside the fire's clear ring`);
    assert.ok(Math.hypot(r.x - stable.x, r.z - stable.z) >= stable.r + 1, `rod ${i} out of the stable's circle`);
    for (let j = i + 1; j < 4; j++) assert.ok(Math.hypot(r.x - rods[j].x, r.z - rods[j].z) >= 2.4);
    for (const s of hearth.seats) assert.ok(Math.hypot(r.x - s.x, r.z - s.z) > 2.5);
  }
});

test('the rod: fishes ponds, chops / breaks / digs nothing, is not a weapon, has a model; ponds are not a target for other tools', () => {
  const rod = { state: 'held', kind: 'rod' }, pond = { type: 'pond' };
  assert.equal(getToolAction(rod, pond), 'fish');
  for (const kind of ['axe', 'sword', 'hammer', 'shovel', 'slingshot', 'watering-can', 'lightsaber']) assert.equal(getToolAction({ state: 'held', kind }, pond), null, kind);
  assert.equal(getToolAction(null, pond), null); assert.equal(getToolAction({ state: 'ground', kind: 'rod' }, pond), null);
  assert.equal(actionForKind('rod', pond), 'fish'); assert.equal(actionForKind('axe', pond), null);
  assert.deepEqual(TOOLS.rod, { chop: 0, break: 0, dig: 0 });
  assert.equal(getToolAction({ state: 'held', kind: 'axe' }, { type: 'tree' }), 'chop'); assert.equal(getToolAction({ state: 'held', kind: 'shovel' }, { type: 'digspot' }), 'dig'); assert.equal(getToolAction({ state: 'held', kind: 'hammer' }, { type: 'rock' }), 'break');   // (the old verbs are untouched)
  for (const t of ['tree', 'palm', 'rock', 'digspot', 'seeddig']) assert.equal(toolHits('rod', ({ tree: 'chop', palm: 'chop', rock: 'break', digspot: 'dig', seeddig: 'dig' })[t]), 0);
  assert.equal(getToolAction(rod, { type: 'tree' }), null); assert.equal(getToolAction(rod, { type: 'digspot' }), null);
  const m = buildItemModel('rod');
  assert.equal(m.userData.kind, 'rod'); assert.equal(m.userData.name, 'Glowline Rod'); assert.ok(m.userData.length > 1 && m.userData.trailTip);
});

test('every fishable pond registers ONE interactable of type pond, once, with the pond\'s radius; the placements it sits on are unchanged', () => {
  const before = getInteractables().length;
  const d = registerDuskGameplay(island);
  const added = getInteractables().length - before;
  assert.equal(d.pondTargets.length, mod.ponds.length + 1, 'every dusk-pond-NN plus the lagoon'); assert.equal(added, d.pondTargets.length);
  assert.equal(registerDuskGameplay(island), d, 'cached: a second call registers nothing');
  assert.equal(getInteractables().length - before, added);
  for (const it of d.pondTargets) { assert.equal(it.type, 'pond'); assert.equal(it.prompt, 'Cast'); assert.ok(it.pond && it.radius > 2); assert.equal(it.position.x, it.pond.x); }
  assert.equal(new Set(d.pondTargets.map((t) => t.pond.id)).size, d.pondTargets.length);
  assert.ok(d.pondTargets.some((t) => t.pond.id === 'dusk-lagoon' && Math.abs(t.radius - Math.sqrt(24 * 30)) < 1e-9));
  assert.ok(d.summary().ponds === d.pondTargets.length);
  const hearthMush = d.placement.items.filter((m) => Math.hypot(m.x - hearth.zone.x, m.z - hearth.zone.z) < hearth.zone.r);
  assert.equal(hearthMush.length, 0);
});

test('fishable ponds: all of them plus the lagoon, with the deepest third (and the lagoon) marked deep', () => {
  assert.equal(ponds.length, mod.ponds.length + 1);
  const deep = ponds.filter((p) => p.deep);
  assert.ok(deep.length >= 1 + Math.floor(mod.ponds.length / 3) - 1 && deep.length <= 2 + Math.ceil(mod.ponds.length / 3));
  assert.ok(byId.get('dusk-lagoon').deep && byId.get('dusk-lagoon').rx === 24 && byId.get('dusk-lagoon').rz === 30);
  const minDeep = Math.min(...deep.filter((p) => !p.lagoon).map((p) => p.depth)), maxShallow = Math.max(...ponds.filter((p) => !p.deep).map((p) => p.depth));
  assert.ok(minDeep >= maxShallow, 'the deep ponds are the deepest');
  assert.deepEqual(duskFishPonds().map((p) => p.id), ponds.map((p) => p.id), 'deterministic');
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------- the spot schedule
test('spots: six at a time, each lives 60-120 s then moves to another pond after 5-15 s; chance spots only in deep ponds; deterministic by seed', () => {
  const rng = mulberry32(FISHING.seed), sim = createSpotSim(rng, ponds);
  assert.equal(spotList(sim).length, FISHING.spots);
  const first = new Map(), last = new Map(), gaps = [], emptyAt = new Map();
  const dt = 0.25, log = [];
  for (let t = 0; t < 4000; t += dt) {
    tickSpots(sim, dt, rng, ponds);
    const list = spotList(sim);
    assert.ok(list.length <= FISHING.spots);
    sim.slots.forEach((s, i) => {
      if (s.spot) { if (!first.has(s.spot.id)) { first.set(s.spot.id, sim.clock); if (emptyAt.has(i)) { gaps.push(sim.clock - emptyAt.get(i)); emptyAt.delete(i); } } last.set(s.spot.id, sim.clock); }
      else if (!emptyAt.has(i)) emptyAt.set(i, sim.clock);
    });
    if (t % 400 === 0) log.push(list.map((s) => `${s.id}:${s.pond}:${s.kind}`).join(','));
    for (const s of list) { const p = byId.get(s.pond); assert.ok(p, 'a real pond'); assert.ok(pondS(p, s.x, s.z) <= (s.kind === 'chance' ? FISHING.chanceS : FISHING.commonS) + 1e-9, 'inside the water'); if (s.kind === 'chance') assert.ok(p.deep, `chance spot at a deep pond only (${p.id})`); }
  }
  const alive = new Set(spotList(sim).map((s) => s.id)), lives = [...first].filter(([id, at]) => at > dt * 2 && !alive.has(id)).map(([id, at]) => last.get(id) - at);           // (the first six start part-way through their life)
  assert.ok(lives.length > 100);
  for (const l of lives) assert.ok(l >= FISHING.life[0] - dt && l <= FISHING.life[1] + dt, `lifetime ${l}`);
  assert.ok(gaps.length > 100); for (const g of gaps) assert.ok(g >= FISHING.gap[0] - dt && g <= FISHING.gap[1] + dt + 1e-9, `gap ${g}`);
  assert.ok([...first.keys()].length > 150 && new Set(spotList(sim).map((s) => s.pond)).size === FISHING.spots, 'six different ponds at once');
  // same seed, same story
  const rng2 = mulberry32(FISHING.seed), sim2 = createSpotSim(rng2, ponds), log2 = [];
  for (let t = 0; t < 4000; t += dt) { tickSpots(sim2, dt, rng2, ponds); if (t % 400 === 0) log2.push(spotList(sim2).map((s) => `${s.id}:${s.pond}:${s.kind}`).join(',')); }
  assert.deepEqual(log2, log);
  assert.ok(log.join().includes(':chance'), 'chance spots do appear');
});

test('a claimed spot stays while somebody is fishing it, and the second claim loses the race', () => {
  const rng = mulberry32(5), sim = createSpotSim(rng, ponds), id = spotList(sim)[0].id;
  assert.ok(claimSpot(sim, id, 'host:0')); assert.equal(claimSpot(sim, id, 'host:1'), null, 'second claim loses'); assert.equal(findSpot(sim, id).by, 'host:0');
  for (let t = 0; t < 600; t += 0.5) tickSpots(sim, 0.5, rng, ponds);
  assert.ok(findSpot(sim, id), 'a claimed spot never expires'); assert.equal(findSpot(sim, id).by, 'host:0');
  releaseSpot(sim, id, rng, { move: false }); assert.equal(findSpot(sim, id).by, null);
  releaseSpot(sim, id, rng, { move: true }); assert.equal(findSpot(sim, id), null);
  assert.equal(claimSpot(sim, 'nope', 'x'), null);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------- casting
test('aimCast: always inside the pond\'s water, along the facing when it meets the pond, towards the middle when the angler turns away; clamps; snaps to a spot', () => {
  const rng = mulberry32(11);
  for (const pond of ponds) {
    for (let k = 0; k < 12; k++) {
      const a = rng() * 6.283, from = { x: pond.x + Math.cos(a) * (pond.rx * 1.1 + 0.3), z: pond.z + Math.sin(a) * (pond.rz * 1.1 + 0.3) };
      const facing = rng() * 6.283, at = aimCast(pond, from, facing, 4);
      assert.ok(pondS(pond, at.x, at.z) <= FISHING.inside + 0.02, `${pond.id} inside`);
      const toward = Math.atan2(pond.x - from.x, pond.z - from.z), aimed = aimCast(pond, from, toward, 4);
      assert.ok(Math.hypot(aimed.x - from.x, aimed.z - from.z) <= 4.3 || pondS(pond, from.x, from.z) > 1.0, 'a cast along the facing stays in range');
      const out = clampInside(pond, pond.x + (from.x - pond.x) * 3, pond.z + (from.z - pond.z) * 3);
      assert.ok(pondS(pond, out.x, out.z) <= FISHING.inside + 0.02);
    }
  }
  const p = ponds[0], inside = { x: p.x + 0.2, z: p.z }; assert.deepEqual(clampInside(p, inside.x, inside.z), { x: +inside.x.toFixed(2), z: inside.z });
  const spots = [{ id: 'a', x: 10, z: 10 }, { id: 'b', x: 12, z: 10 }];
  assert.equal(nearestSpot(spots, 10.5, 10, 3).id, 'a'); assert.equal(nearestSpot(spots, 11.6, 10, 3).id, 'b'); assert.equal(nearestSpot(spots, 30, 10, 3), null);
  // an avatar's bobber comes from its pose alone: inside the nearest pond within reach, none far from every pond
  const pond = ponds.find((q) => q.id === 'dusk-lagoon'), pos = { x: pond.x - pond.rx * 1.08, z: pond.z };
  const bob = bobberFor(ponds, pos, Math.PI / 2); assert.equal(bob.pond, 'dusk-lagoon'); assert.ok(pondS(pond, bob.x, bob.z) <= FISHING.inside + 0.02);
  assert.equal(bobberFor(ponds, { x: island.x - 400, z: island.z }, 0), null);
});

test('rollSchedule: deterministic, 0-3 nibbles before the bite, the bite 2-8 s after the cast, a Lanternkoi fights twice more with shorter windows; the view never names the species', () => {
  for (let seed = 1; seed <= 400; seed++) {
    const a = rollSchedule(mulberry32(seed), 'glimmerfin'), b = rollSchedule(mulberry32(seed), 'glimmerfin');
    assert.deepEqual(a, b);
    assert.equal(a.bites.length, 1); assert.equal(a.bites[0].win, 0.6); assert.ok(a.bites[0].at >= 2 && a.bites[0].at <= 8);
    assert.ok(a.nibbles.length <= 3); for (let i = 0; i < a.nibbles.length; i++) { assert.ok(a.nibbles[i] >= FISHING.nibbleFrom && a.nibbles[i] <= a.bites[0].at - FISHING.biteGap + 1e-9); if (i) assert.ok(a.nibbles[i] - a.nibbles[i - 1] >= FISHING.nibbleGap[0] - 0.011); }
    const k = rollSchedule(mulberry32(seed), 'lanternkoi');
    assert.deepEqual(k.bites.map((x) => x.win), [0.4, 0.35, 0.3]); for (let i = 1; i < 3; i++) assert.ok(k.bites[i].at > k.bites[i - 1].at + k.bites[i - 1].win);
    assert.ok(!('species' in scheduleView(k))); assert.ok(castEnd(scheduleView(k)) > k.bites[2].at + k.bites[2].win);
  }
  const rng = mulberry32(3); let koi = 0; for (let i = 0; i < 4000; i++) { assert.equal(rollSpecies(rng, 'common'), 'glimmerfin'); if (rollSpecies(rng, 'chance') === 'lanternkoi') koi++; }
  assert.ok(koi / 4000 > 0.16 && koi / 4000 < 0.24, `rare chance ${koi / 4000}`);
});

test('judgePresses: the bite window with slack, scared by early presses (nibbles, mashing), late presses, missing bites, Lanternkoi\'s three', () => {
  const g = { nibbles: [1.2], bites: [{ at: 4, win: 0.6 }] }, k = { nibbles: [], bites: [{ at: 4, win: 0.4 }, { at: 5.6, win: 0.35 }, { at: 7.2, win: 0.3 }] }, s = FISHING.slack;
  assert.equal(judgePresses(g, [4.3]).result, 'catch'); assert.equal(judgePresses(g, [4]).result, 'catch'); assert.equal(judgePresses(g, [4.6]).result, 'catch');
  assert.equal(judgePresses(g, [4 - s]).result, 'catch', 'the slack forgives a hair early'); assert.equal(judgePresses(g, [4.6 + s]).result, 'catch', 'and a hair late');
  assert.deepEqual([judgePresses(g, [3.6]).result, judgePresses(g, [3.6]).reason], ['fled', 'early']);
  assert.equal(judgePresses(g, [1.2]).result, 'fled', 'a press during a nibble scares the fish');
  assert.equal(judgePresses(g, [0.5, 1.9, 2.6]).result, 'fled', 'mashing');
  assert.deepEqual([judgePresses(g, [4.6 + s + 0.05]).result, judgePresses(g, [4.9]).reason], ['miss', 'late']);
  assert.equal(judgePresses(g, []).result, 'miss', 'nobody pressed'); assert.equal(judgePresses(g, null).result, 'miss'); assert.equal(judgePresses(g, [NaN, Infinity, 'x']).result, 'miss');
  assert.equal(judgePresses(g, [4.3, 4.31, 9]).result, 'catch', 'presses after the catch are ignored');
  assert.equal(judgePresses(g, [4.3, 3.9]).result, 'catch', 'order does not matter');
  assert.equal(judgePresses(k, [4.1, 5.7, 7.3]).result, 'catch'); assert.equal(judgePresses(k, [4.1, 5.7, 7.2 + 0.3 + s]).result, 'catch');
  assert.equal(judgePresses(k, [4.1, 5.0, 7.3]).result, 'fled', 'pressing before the second bite scares it'); assert.equal(judgePresses(k, [4.1, 5.7]).result, 'miss', 'gave up before the third');
  assert.equal(judgePresses(k, [4.1, 6.5, 7.3]).result, 'miss'); assert.equal(judgePresses(k, [4.5]).result, 'miss', 'one press is not enough for a Lanternkoi');
  assert.equal(judgePresses(k, [4.1, 4.2, 4.3]).result, 'fled', 'three quick presses are not three bites');
});

test('anglerStatus drives the bobber: wait -> nibble -> bite -> hooked -> caught, and the final states', () => {
  const v = { nibbles: [1.2, 2.0], bites: [{ at: 4, win: 0.4 }, { at: 5.6, win: 0.35 }] };
  assert.equal(anglerStatus(v, [], 0.5).status, 'wait'); assert.deepEqual([anglerStatus(v, [], 1.3).status, anglerStatus(v, [], 1.3).nibbleIdx], ['nibble', 1]);
  assert.equal(anglerStatus(v, [], 2.2).nibbleIdx, 2); assert.equal(anglerStatus(v, [], 3.9).status, 'nibble');
  assert.deepEqual([anglerStatus(v, [], 4.1).status, anglerStatus(v, [], 4.1).stage], ['bite', 0]);
  assert.equal(anglerStatus(v, [4.1], 4.6).status, 'hooked'); assert.equal(anglerStatus(v, [4.1], 5.7).status, 'bite'); assert.equal(anglerStatus(v, [4.1], 5.7).stage, 1);
  assert.equal(anglerStatus(v, [4.1, 5.7], 5.8).status, 'caught');
  assert.equal(anglerStatus(v, [1.3], 1.3).status, 'fled'); assert.equal(anglerStatus(v, [], 4.7).status, 'missed'); assert.equal(anglerStatus(v, [4.1], 6.3).status, 'missed');
  // the angler's own status and the host's verdict agree for every press list
  const rng = mulberry32(8);
  for (let i = 0; i < 300; i++) {
    const presses = Array.from({ length: Math.floor(rng() * 4) }, () => Math.round(rng() * 80) / 10), st = anglerStatus(v, presses, 20), j = judgePresses(v, presses);
    assert.equal(st.status === 'caught', j.result === 'catch'); assert.equal(st.status === 'fled', j.result === 'fled');
  }
});

test('host validation: cast needs a real pond, a near actor, a throw that reaches; reel needs a known cast of the same actor and honest times', () => {
  const pond = ponds[3], pos = bank(pond), good = { pond: pond.id, x: pond.x, z: pond.z };
  assert.equal(validateCast(good, { pond, pos }), null);
  assert.equal(validateCast({ ...good, pond: 5 }, { pond, pos }), 'bad-request'); assert.equal(validateCast({ ...good, x: NaN }, { pond, pos }), 'bad-request'); assert.equal(validateCast(null, { pond, pos }), 'bad-request');
  assert.equal(validateCast(good, { pond: undefined, pos }), 'no-pond');
  assert.equal(validateCast(good, { pond, pos: { x: pond.x + pond.rx + 40, z: pond.z } }), 'far'); assert.equal(validateCast({ ...good, x: pos.x + 40 }, { pond, pos }), 'far');
  assert.ok(nearPond(pond, pos, FISHING.reach) && !nearPond(pond, { x: pond.x + 99, z: pond.z }) && !nearPond(null, pos)); assert.ok(edgeDistance(pond, pond.x, pond.z) < 0);
  const view = { nibbles: [], bites: [{ at: 3, win: 0.6 }] }, cast = { id: 'c1', key: 'host:0', view };
  assert.equal(validateReel({ cast: 'c1', presses: [3.1] }, cast, { key: 'host:0', elapsed: 3.2 }), null);
  assert.equal(validateReel({ cast: 'c1', presses: [3.1] }, cast, { key: 'host:1', elapsed: 3.2 }), 'not-yours'); assert.equal(validateReel({ cast: 'c1', presses: [] }, undefined, { key: 'host:0', elapsed: 0 }), 'unknown-cast');
  assert.equal(validateReel({ cast: 'c1', presses: [3.1] }, cast, { key: 'host:0', elapsed: 0.5 }), 'from-the-future');
  assert.equal(validateReel({ cast: 'c1', presses: [-1] }, cast, { key: 'host:0', elapsed: 9 }), 'bad-request'); assert.equal(validateReel({ cast: 'c1', presses: Array(9).fill(3) }, cast, { key: 'host:0', elapsed: 9 }), 'bad-request');
  assert.equal(validateReel({ cast: 'c1', presses: 'x' }, cast, { key: 'host:0', elapsed: 9 }), 'bad-request'); assert.equal(validateReel({ cast: 'c1', cancel: true }, cast, { key: 'host:0', elapsed: 0 }), null);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------- the domain
const hostActor = (pos, index = 0) => ({ screen: 'host', index, pos });
function solo() {
  const sync = new WorldSync({ role: 'host' }), bag = {}; const inventory = { add: (id, n) => { bag[id] = (bag[id] || 0) + n; } };
  const fishing = createFishing({ sync, ponds, inventory }), log = [];
  fishing.on((kind, d) => log.push([kind, d]));
  const run = (secs, dt = 0.25) => { for (let t = 0; t < secs; t += dt) fishing.update(dt); };
  const castAt = (spot, who = hostActor(bank(byId.get(spot.pond)))) => sync.request('fishing', 'cast', { pond: spot.pond, x: spot.x, z: spot.z }, who);
  return { sync, fishing, bag, log, run, castAt };
}

test('a cast at a ring claims the spot, rolls the schedule on the host and returns it without the species; an empty cast holds nothing', () => {
  const { sync, fishing, castAt } = solo();
  const spot = fishing.spots[0], pond = byId.get(spot.pond);
  const empty = sync.request('fishing', 'cast', { pond: pond.id, x: pond.x + pond.rx * 0.7, z: pond.z - pond.rz * 0.7 }, hostActor(bank(pond)));
  const other = fishing.spots.some((s) => s.pond === pond.id && Math.hypot(s.x - (pond.x + pond.rx * 0.7), s.z - (pond.z - pond.rz * 0.7)) < FISHING.snap);
  if (!other) { assert.equal(empty.ok, true); assert.equal(empty.result.empty, true); assert.equal(empty.result.cast, null); assert.equal(fishing.spots.filter((s) => s.by).length, 0); }
  const r = castAt(spot);
  assert.equal(r.ok, true); assert.equal(r.result.empty, false); assert.ok(r.result.cast); assert.equal(r.result.spot, spot.id); assert.deepEqual([r.result.x, r.result.z], [spot.x, spot.z], 'the bobber snaps onto the ring');
  assert.ok(r.result.bites.length === 1 || r.result.bites.length === 3); assert.ok(!('species' in r.result)); assert.equal(fishing.spots.find((s) => s.id === spot.id).by, 'host:0');
  assert.equal(fishing.debug.casts.length, 1);
  // the second angler at the same ring: just an empty cast; far actors, unknown ponds and junk are rejected
  const second = castAt(spot, hostActor(bank(pond, 2), 1)); assert.equal(second.ok, true); assert.equal(second.result.empty, true, 'a claimed spot is an empty cast for the next angler');
  assert.equal(sync.request('fishing', 'cast', { pond: pond.id, x: pond.x, z: pond.z }, hostActor({ x: pond.x + pond.rx + 50, y: 0, z: pond.z })).reason, 'far');
  assert.equal(sync.request('fishing', 'cast', { pond: 'dusk-pond-99', x: 0, z: 0 }, hostActor(bank(pond))).reason, 'no-pond'); assert.equal(sync.request('fishing', 'cast', {}, hostActor(bank(pond))).reason, 'bad-request');
  assert.equal(sync.request('fishing', 'nope', {}, hostActor(bank(pond))).reason, 'unknown-kind'); assert.equal(sync.request('fishing', 'debugSpawn', { pond: pond.id }, hostActor(bank(pond)).screen && { screen: 'other', index: 0, pos: bank(pond) }).reason, 'bad-request');
});

test('reel: a correct press list catches (bag + event, spot moves on), replay and impostors are rejected, early / late / cancelled / timed-out casts end without a catch', () => {
  const w = solo(), { sync, fishing, bag, log, run, castAt } = w;
  const fishAt = (i) => { const spot = fishing.spots.filter((s) => !s.by)[i], r = castAt(spot); return { spot, r, cast: fishing.debug.casts.at(-1), pond: byId.get(spot.pond) }; };
  // --- a catch
  let f = fishAt(0); const who = hostActor(bank(f.pond)); const view = f.cast.view;
  assert.equal(sync.request('fishing', 'reel', { cast: f.cast.id, presses: [view.bites[0].at + 0.1] }, who).reason, 'from-the-future', 'no presses from the future');
  assert.equal(sync.request('fishing', 'reel', { cast: f.cast.id, presses: [] }, hostActor(bank(f.pond), 1)).reason, 'not-yours');
  run(view.bites.at(-1).at + view.bites.at(-1).win + 0.5);
  const presses = view.bites.map((b) => +(b.at + b.win / 2).toFixed(2));
  const ok = sync.request('fishing', 'reel', { cast: f.cast.id, presses }, who);
  assert.equal(ok.ok, true);
  const caught = log.filter(([k]) => k === 'catch').at(-1)[1];
  assert.equal(caught.actor, 'host:0'); assert.equal(caught.spot, f.spot.id); assert.ok(['glimmerfin', 'lanternkoi'].includes(caught.fish)); assert.equal(bag[caught.fish], 1); assert.equal(f.cast.species, caught.fish);
  assert.equal(fishing.spots.some((s) => s.id === f.spot.id), false, 'the spot is gone from the water');
  assert.equal(sync.request('fishing', 'reel', { cast: f.cast.id, presses }, who).reason, 'unknown-cast', 'replay protection: a cast is judged once');
  assert.equal(Object.values(bag).reduce((a, b) => a + b, 0), 1);
  // --- too early: the fish flees and the spot moves away
  f = fishAt(0); run(1);
  assert.equal(sync.request('fishing', 'reel', { cast: f.cast.id, presses: [0.5] }, hostActor(bank(f.pond))).ok, true);
  let miss = log.filter(([k]) => k === 'miss').at(-1)[1]; assert.equal(miss.reason, 'fled'); assert.equal(fishing.spots.some((s) => s.id === f.spot.id), false);
  // --- too late: a missed bite lets the fish try again (the spot stays, released)
  f = fishAt(0); const b0 = f.cast.view.bites[0]; run(b0.at + b0.win + 1.5);
  assert.equal(sync.request('fishing', 'reel', { cast: f.cast.id, presses: [b0.at + b0.win + 1] }, hostActor(bank(f.pond))).ok, true);
  miss = log.filter(([k]) => k === 'miss').at(-1)[1]; assert.equal(miss.reason, 'late'); const still = fishing.spots.find((s) => s.id === f.spot.id); assert.ok(still && still.by === null, 'released, still there');
  assert.equal(Object.values(bag).reduce((a, b) => a + b, 0), 1, 'no extra fish');
  // --- cancel (Cancel / walking away) releases without moving the spot; the same ring can be cast at again
  f = fishAt(0);
  assert.equal(sync.request('fishing', 'reel', { cast: f.cast.id, presses: [], cancel: true }, hostActor(bank(f.pond))).ok, true);
  assert.equal(log.filter(([k]) => k === 'miss').at(-1)[1].reason, 'cancel'); assert.equal(fishing.spots.find((s) => s.id === f.spot.id).by, null); assert.equal(fishing.debug.casts.length, 0);
  // --- a cast nobody reels in times out
  f = fishAt(0); const end = f.cast.view.bites.at(-1); run(end.at + end.win + FISHING.timeout + 1);
  assert.equal(log.filter(([k]) => k === 'miss').at(-1)[1].reason, 'timeout'); assert.equal(fishing.debug.casts.length, 0);
  // --- a new cast by the same angler replaces the old one (and frees its spot)
  f = fishAt(0); const firstSpot = f.spot.id; const g = fishAt(1);
  assert.equal(fishing.debug.casts.length, 1, 'the same angler casting again replaces the old cast');
  assert.equal(fishing.spots.find((s) => s.id === firstSpot).by, null, 'and frees its spot'); assert.equal(fishing.spots.find((s) => s.id === g.spot.id).by, 'host:0');
});

// ---- a real host + replica pair ---------------------------------------------------------------------------------------------------------------------------------------------
function pair() {
  const q = [], replicas = new Map();
  const hSync = new WorldSync({ role: 'host' }), rSync = new WorldSync({ role: 'replica' }), bag = {};
  replicas.set(1, rSync);
  hSync.attachHost({ sendTo: (tid, m) => q.push([replicas.get(tid), m]), broadcast: (m) => { for (const r of replicas.values()) q.push([r, m]); } });
  rSync.attachReplica({ send: (m) => { q.push([hSync, m, 1]); return true; } });
  const flush = () => { while (q.length) { const [to, m, tid] = q.shift(); if (to === hSync) hSync.screenMessage(tid, m); else to.receive(m); } };
  const host = createFishing({ sync: hSync, ponds, inventory: { add: (id, n) => { bag[id] = (bag[id] || 0) + n; } } }), replica = createFishing({ sync: rSync, ponds });
  const log = { host: [], replica: [] }; host.on((k, d) => log.host.push([k, d])); replica.on((k, d) => log.replica.push([k, d]));
  rSync.linkUp(); hSync.screenConnected(1, { clientId: 'angler' }); flush();
  const equal = () => assert.equal(hSync.hash(), rSync.hash());
  const run = (secs, dt = 0.25) => { for (let t = 0; t < secs; t += dt) { host.update(dt); flush(); } equal(); };
  const late = () => {
    const sync = new WorldSync({ role: 'replica' }); replicas.set(2, sync); sync.attachReplica({ send: (m) => { q.push([hSync, m, 2]); return true; } });
    const fishing = createFishing({ sync, ponds }); sync.linkUp(); hSync.screenConnected(2, { clientId: 'latecomer' }); flush(); assert.equal(hSync.hash(), sync.hash());
    return { sync, fishing };
  };
  return { hSync, rSync, host, replica, bag, log, flush, equal, run, late, player: (pos, index = 0) => ({ index, position: pos }) };
}

test('replica-requested cast and catch: the host decides, every screen sees the same spots and the same verdict, hashes stay equal, a late joiner gets the snapshot', async () => {
  const w = pair(); w.equal();
  assert.deepEqual(w.replica.spots, w.host.spots); assert.equal(w.host.spots.length, FISHING.spots);
  const spot = w.host.spots[1], pond = byId.get(spot.pond), angler = w.player(bank(pond));
  const pending = w.replica.cast(angler, pond.id, { x: spot.x, z: spot.z }); w.flush();
  const r = await pending; w.equal();
  assert.equal(r.ok, true); assert.equal(r.result.spot, spot.id); assert.ok(r.result.bites.length >= 1);
  const key = `${w.rSync.screenId}:0`; assert.equal(w.host.spots.find((s) => s.id === spot.id).by, key); assert.equal(w.replica.spots.find((s) => s.id === spot.id).by, key, 'the claim is mirrored');
  // a second angler (the host's own player) at the same ring: an empty cast
  const host2 = w.host.cast({ index: 1, position: bank(pond, 2) }, pond.id, { x: spot.x, z: spot.z }); w.flush();
  assert.equal(host2.result.empty, true); w.equal();
  // the late joiner sees the claimed spot straight away
  const late = w.late(); assert.deepEqual(late.fishing.spots, w.host.spots);
  // press on the bite, after the host's clock caught up
  const bites = r.result.bites, end = bites.at(-1);
  w.run(end.at + end.win + 0.5);
  const reeled = w.replica.reel(angler, r.result.cast, bites.map((b) => +(b.at + b.win / 2).toFixed(2))); w.flush(); const done = await reeled; w.equal();
  assert.equal(done.ok, true);
  const hostCatch = w.log.host.filter(([k]) => k === 'catch'), repCatch = w.log.replica.filter(([k]) => k === 'catch');
  assert.equal(hostCatch.length, 1); assert.deepEqual(repCatch.map(([, d]) => d), hostCatch.map(([, d]) => d), 'the replica sees the same catch');
  assert.equal(hostCatch[0][1].actor, key); assert.equal(w.bag[hostCatch[0][1].fish], 1, 'the host put the fish into the shared bag');
  assert.equal(w.host.spots.some((s) => s.id === spot.id), false); assert.deepEqual(w.replica.spots, w.host.spots);
  const again = w.replica.reel(angler, r.result.cast, []); w.flush();
  assert.equal((await again).reason, 'unknown-cast', 'replay from the replica is rejected');
  const sp = w.replica.debug.spawn(pond.id, 'chance'); w.flush(); assert.equal((await sp).ok, false);
  w.run(300); assert.ok(w.host.spots.length <= FISHING.spots && w.host.spots.length >= FISHING.spots - 3, 'a spot or two are in their gap'); assert.deepEqual(w.replica.spots, w.host.spots); w.equal();
  assert.deepEqual(late.fishing.spots, w.host.spots, 'the late joiner stays in step');
});

test('a screen that leaves frees its anglers\' spots; debug spawn / catch are host-only and work', async () => {
  const w = pair(), spot = w.host.spots[0], pond = byId.get(spot.pond), angler = w.player(bank(pond));
  const pending = w.replica.cast(angler, pond.id, { x: spot.x, z: spot.z }); w.flush(); await pending;
  assert.ok(w.host.spots.find((s) => s.id === spot.id).by);
  w.hSync.domains.get('fishing').screenLeft(w.rSync.screenId); w.flush(); w.equal();
  assert.equal(w.host.spots.find((s) => s.id === spot.id).by, null, 'the leaver\'s claim is dropped'); assert.deepEqual(w.replica.spots, w.host.spots);
  const sp = w.host.debug.spawn('dusk-lagoon', 'chance'); assert.equal(sp.ok, true); w.flush(); w.equal();
  const made = w.host.spots.find((s) => s.id === sp.result.spot); assert.deepEqual([made.pond, made.kind], ['dusk-lagoon', 'chance']);
  assert.equal(w.host.debug.spawn('nowhere').ok, false);
  const here = { index: 0, position: { x: 0, y: 0, z: 0 } };
  assert.equal(w.host.debug.catch(here, 'lanternkoi').ok, true); w.flush();
  assert.equal(w.bag.lanternkoi, 1); assert.equal(w.log.replica.filter(([k]) => k === 'catch').at(-1)[1].fish, 'lanternkoi');
  assert.equal(w.host.debug.catch(here, 'whale').ok, false);
  const refused = w.replica.debug.catch(here, 'glimmerfin'); w.flush(); assert.equal((await refused).ok, false);
  assert.equal(w.bag.glimmerfin, undefined, 'a replica cannot hand itself fish');
});

test('the fish are in the catalog, the rod has an icon, the line flag rides the pose packet and older packets decode without it', async () => {
  for (const id of ['glimmerfin', 'lanternkoi']) { const it = getItem(id); assert.ok(it && it.kind === 'ingredient' && it.islands.includes('duskcrown') && it.icon.includes('<svg')); }
  const { ICONS } = await import('../public/js/ui/icons.js'); assert.ok(ICONS['tool-rod'] && ICONS.glimmerfin);
  const base = { index: 2, position: { x: 1, y: 0.5, z: 3 }, facing: 1, velocity: { x: 0, z: 0 }, moving: false, swinging: false, _hopY: 0, character: { hat: null }, hatIndex: -1, tailIndex: -1, garlandIndex: -1 };
  const idle = decodePose(encodePose(base)), out = decodePose(encodePose({ ...base, _lineOut: true }));
  assert.equal(idle.flags & 256, 0); assert.equal(out.flags & 256, 256);
  assert.equal(decodePose(encodePose({ ...base, _lineOut: true, moving: true, _pose: [1] })).flags, 1 | 8 | 256);
  assert.equal(decodePose(encodePose(base).slice(0, 12)).flags & 256, 0, 'a 12-field packet from an older build');
});
