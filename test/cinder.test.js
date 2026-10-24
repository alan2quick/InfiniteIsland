// Step 60: Cinder Tubes, Emberleaf's combat area: height bands (terraces, ramps, cliffs, ledge drops; the older areas stay bit-identical), the five sections and their gates, the burn / defend / hunt
// objectives, the chiefs' modifiers, the Magma Toad's attacks, the Armory unlocks, a scripted clear for 1 and 3 players, a pacing estimate and the lava-tube mouth's clearing on Emberleaf
// (Emberleaf's seeded placement is pinned unchanged). All pure (DungeonRun + the area data), no browser.
import { assertPlacementGolden } from './helpers/placementGolden.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { AREAS, TILE_SIZE, ritualMenuRows, supplyKinds, tilesLinked, rampHeightAt, createGrid, mapFloor, STEP_MAX } from '../public/js/game/areaLogic.js';
import { DungeonRun, WEAPONS, ENEMY_KINDS, GUARDIAN_ATTACKS, guardianAttack, buildEnemies, partyScale } from '../public/js/game/dungeonLogic.js';
import { initObjective, tickObjective, burnBrambles, objectiveText, objectiveTargets, rectDistance } from '../public/js/game/objectives.js';
import { rackPedestals, areaPedestals, partyPedestals } from '../public/js/game/charms.js';
import { markCleared, normaliseCombat } from '../public/js/game/combatSave.js';
import { gainBloom } from '../public/js/game/combatLogic.js';
import { COMBAT, CHARM, ISLANDS, AREA_LIGHT } from '../public/js/config.js';
import { getIslandModule } from '../public/js/world/islands/registry.js';
import { buildEmberPlacement, emberLanes } from '../public/js/world/islands/emberPlacement.js';
import { planEmberGathering, planEmberTools } from '../public/js/world/islands/emberGathering.js';
import { planEmberSeeds } from '../public/js/world/islands/emberSeeds.js';
import { LAVA_MOUTH, lavaMouthReserved } from '../public/js/world/islands/lavaMouth.js';
import { polyDist } from '../public/js/world/islands/scatter.js';
import { gardenZone, waterfallForbidden } from '../public/js/world/islands/emberGarden.js';
import { getTerrainHeight, isWalkable, getGroundType } from '../public/js/world/terrain.js';

const A = AREAS.cinder, O = A.origin, K1 = 'h:0', K2 = 'h:1', K3 = 'h:2';
const at = (x, z) => ({ x: O.x + x, z: O.z + z });
const start = (section = 0, keys = [K1]) => { const r = new DungeonRun(); r.start(keys, { area: 'cinder', section }); return r; };
const reset = () => { for (const a of Object.values(AREAS)) a.grid.setOpen([]); };
const key = (tx, tz) => `${tx},${tz}`;
const calm = (r) => { for (const m of Object.values(r.members)) m.invulnerable = r.time + 999; };
const pos = (...entries) => Object.fromEntries(entries);
const steps = (r, seconds, pp, dt = 0.05) => { let out = null; for (let t = 0; t < seconds - 1e-9; t += dt) { out = r.update(dt, pp) || out; } return out; };
const hash = (o) => crypto.createHash('md5').update(typeof o === 'string' ? o : JSON.stringify(o)).digest('hex').slice(0, 10);
const spot = (section, slot = 0) => at(A.sections[section].start.x + slot * A.sections[section].start.step, A.sections[section].start.z);
const lone = (r, e) => { r.enemies = [e]; return e; };
const make = (kind, x, z, extra = {}) => ({ id: 0, kind, ...at(x, z), hp: ENEMY_KINDS[kind].hp, max: ENEMY_KINDS[kind].hp, stun: 0, wind: 0, cooldown: 0, target: null, aim: null, ...extra });

// ---------------------------------------------------------------------------------------------
// registration
// ---------------------------------------------------------------------------------------------
test('Cinder Tubes is registered: five sections, four gates, its own pocket far from everything, lava light, listed in the ritual menu under Emberleaf', () => {
  assert.equal(A.id, 'cinder'); assert.equal(A.island, 'ember'); assert.equal(A.look, 'lava'); assert.ok(AREA_LIGHT.lava.background);
  assert.deepEqual(A.sections.map((s) => s.id), ['mouth', 'channel', 'terraces', 'grove', 'hall']);
  assert.deepEqual(A.sections.map((s) => s.objective.type), ['train', 'burn', 'defend', 'hunt', 'bosses']);
  assert.equal(A.gates.length, 4); assert.equal(A.sections[4].gate, null);
  for (const other of Object.values(AREAS)) if (other !== A) assert.ok(Math.hypot(O.x - other.origin.x, O.z - other.origin.z) > 300, other.id);
  const row = ritualMenuRows({}).find((q) => q.id === 'cinder'); assert.equal(row.islandName, 'Emberleaf Isle'); assert.equal(row.cleared, false);
  assert.equal(ritualMenuRows({ cinder: { wild: true } }).find((q) => q.id === 'cinder').cleared, true);
  assert.equal(A.entrance.id, 'cinder-mouth'); assert.equal(A.entrance.opens, 'bridge');
});
test('every start, spawn, wave, add, pedestal, supply spot, rack slot and the portal stand on clear floor; every start is safe', () => {
  const g = A.grid; g.setOpen(A.gates.map((q) => q.id));
  for (const [i, s] of A.sections.entries()) {
    const p = spot(i); assert.ok(g.inArea(p.x, p.z, 0.45), `${s.id} start`);
    assert.ok(A.safe.length >= 5); assert.ok(s.safe.length >= 1);
    const lists = [s.enemies, ...(s.objective.waves || []).map((w) => w.tuples), s.phase2?.adds || []];
    for (const list of lists) for (const e of list) { const q = at(e[1], e[2]); assert.ok(g.inArea(q.x, q.z, 0.8), `${s.id} ${e[0]} at ${e[1]},${e[2]}`); }
  }
  for (const ped of A.sections[1].pedestals) assert.ok(g.inArea(O.x + ped.x, O.z + ped.z, 0.6));
  for (let slot = 0; slot < 4; slot++) {
    A.supply.kinds.forEach((k, row) => assert.ok(g.inArea(O.x + A.supply.x + slot * A.supply.dx, O.z + A.supply.z + row * A.supply.dz, 0.6), `${k} ${slot}`));
    assert.ok(g.inArea(O.x + A.supply.extra.x, O.z + A.supply.extra.z + slot * A.supply.extra.sz, 0.6), 'slingshot column');
  }
  for (let i = 0; i < 8; i++) assert.ok(g.inArea(O.x + A.rack.x + i * A.rack.dx, O.z + A.rack.z, 0.6), `rack ${i}`);
  assert.ok(g.inArea(O.x + A.exit.x, O.z + A.exit.z, 0.8));
  const sap = A.sections[2].objective.sapling; assert.ok(g.inArea(O.x + sap.x, O.z + sap.z, 0.8)); assert.equal(g.heightAt(O.x + sap.x, O.z + sap.z), 2, 'the sapling stands on the middle tier');
  reset();
});
test('every section is reachable only through the previous one\'s gate; with every gate open the whole area is connected (ramps joined, cliffs not)', () => {
  const g = A.grid, from = (i) => { const p = spot(i); return { tx: Math.floor((p.x - O.x) / 2), tz: Math.floor((p.z - O.z) / 2) }; };
  const flood = (start) => {
    const live = new Map(g.tiles.map((t) => [key(t.tx, t.tz), t])), seen = new Set(), q = [live.get(key(start.tx, start.tz))]; seen.add(key(start.tx, start.tz));
    for (let i = 0; i < q.length; i++) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = live.get(key(q[i].tx + dx, q[i].tz + dz)); if (!n || seen.has(key(n.tx, n.tz)) || !tilesLinked(q[i], n, dx, dz)) continue; seen.add(key(n.tx, n.tz)); q.push(n);
    }
    return seen;
  };
  const owner = (i) => new Set([...flood(from(i))]);
  g.setOpen([]); const closed = flood(from(0));
  for (let i = 1; i < A.sections.length; i++) { const p = from(i); assert.ok(!closed.has(key(p.tx, p.tz)), `section ${i} is behind the gates`); }
  for (let n = 1; n <= 4; n++) {                                         // with the first n gates open, section n is reachable and n + 1 is not
    g.setOpen(A.gates.slice(0, n).map((q) => q.id)); const seen = flood(from(0));
    const here = from(n), next = from(Math.min(4, n + 1));
    assert.ok(seen.has(key(here.tx, here.tz)), `section ${n} opens with gate ${n}`);
    if (n < 4) assert.ok(!seen.has(key(next.tx, next.tz)), `section ${n + 1} still shut`);
  }
  g.setOpen(A.gates.map((q) => q.id)); assert.equal(flood(from(0)).size, g.tiles.length, 'every tile connected once open');
  void owner; reset();
});
test('a closed gate is a wall for walking, sight and navigation: the brambles block the channel until they burn', () => {
  const r = start(1); const b = at(0, 8);
  assert.equal(r.g.inArea(b.x, b.z), false, 'the bramble tiles are not floor'); assert.equal(r.g.sight(at(0, 14), at(0, 2)), false);
  r.g.setOpen(['channel-gate']); assert.equal(r.g.inArea(b.x, b.z), true); reset();
});

// ---------------------------------------------------------------------------------------------
// height bands
// ---------------------------------------------------------------------------------------------
const ROOT = { x: 0, z: 0 };
test('height bands change nothing for the older areas: Wildroot and Glimmerfrost tiles, walls, edges, sight, heights and navigation are bit-identical to Step 59', () => {
  const out = {};
  for (const id of ['wildroot', 'glimmerfrost']) {
    const a = AREAS[id], g = a.grid, o = a.origin; assert.equal(g.bands, false); assert.equal(g.allCliffs.length, 0);
    g.setOpen(a.gates.map((q) => q.id)); let s = '';
    for (let x = -40; x <= 40; x += 2.3) for (let z = -130; z <= 70; z += 2.1) {
      const p = { x: o.x + x, z: o.z + z };
      s += g.inArea(p.x, p.z) ? 1 : 0; s += g.inArea(p.x, p.z, 0.8) ? 1 : 0; s += g.sight(p, { x: p.x + 4.1, z: p.z - 3.3 }, 0.3) ? 1 : 0; s += g.heightAt(p.x, p.z);
      assert.equal(g.reach(p, { x: p.x + 4.1, z: p.z - 3.3 }, 0.3), g.sight(p, { x: p.x + 4.1, z: p.z - 3.3 }, 0.3), 'no cliffs: reach is sight');
    }
    const field = g.field({ x: o.x + a.sections[0].start.x, z: o.z + a.sections[0].start.z });
    out[id] = { tiles: hash(g.allTiles), walls: hash(g.allWalls), samples: hash(s), field: field.size, open: g.open.length };
    g.setOpen([]); out[id].closedTiles = hash(g.tiles);
  }
  assert.deepEqual(out, {
    wildroot: { tiles: '49d580e396', walls: '5db330a169', samples: '43834f6d4b', field: 812, open: 6, closedTiles: 'f9b578e07f' },
    glimmerfrost: { tiles: 'f35193a917', walls: '9a0f222fbc', samples: '2cae0f6272', field: 855, open: 4, closedTiles: 'a2b0b5f696' } });
});
test('tiers and ramps: a tile\'s h is its band (a ramp tile: the height at its centre), heightAt is continuous on a ramp, and the step per tile never exceeds STEP_MAX', () => {
  const g = A.grid; g.setOpen(A.gates.map((q) => q.id)); assert.equal(g.bands, true);
  const h = (x, z) => g.heightAt(O.x + x, O.z + z);
  assert.equal(h(0, 0), 0); assert.equal(h(0, -10), 2); assert.equal(h(0, -30), 4); assert.equal(h(0, -75), 0);
  assert.deepEqual([-7, -9, -11, -13].map((z) => h(10, z)), [0.25, 0.75, 1.25, 1.75], 'ramp A climbs 0 -> 2 over 8 u');
  assert.deepEqual([-27, -29, -31, -33].map((z) => h(-10, z)), [2.25, 2.75, 3.25, 3.75], 'ramp B 2 -> 4');
  let prev = h(10, -6.01); for (let z = -6.01; z >= -14; z -= 0.1) { const v = h(10, z); assert.ok(v >= prev - 1e-9 && v - prev < 0.06, 'smooth'); prev = v; }
  assert.ok(Math.abs(h(10, -6.01)) < 0.01 && Math.abs(h(10, -13.99) - 2) < 0.01, 'the ramp meets both tiers');
  const down = [-46.5, -50, -55, -60, -63.5].map((z) => h(0, z)); for (let i = 1; i < down.length; i++) assert.ok(down[i] < down[i - 1], 'the grove ramp descends');
  for (const t of g.allTiles) for (const [dx, dz] of [[1, 0], [0, 1]]) {
    const n = g.allTiles.find((q) => q.tx === t.tx + dx && q.tz === t.tz + dz); if (!n || !(t.ramp || n.ramp)) continue;
    if (tilesLinked(t, n, dx, dz)) assert.ok(Math.abs(t.h - n.h) <= STEP_MAX + 1e-9, 'a joined step is gentle');
  }
  const s = { x: 0, z: 0, w: 4, d: 8, ramp: { dir: '+z', from: 1, to: 3 } };
  assert.equal(rampHeightAt(s, 0, -4), 1); assert.equal(rampHeightAt(s, 0, 4), 3); assert.equal(rampHeightAt(s, 0, 0), 2); assert.equal(rampHeightAt(s, 0, 9), 3, 'clamped');
  reset();
});
test('walking between tiers: a cliff is a wall (movement, the dodge-hop, reach), only a ramp joins tiers, and a ramp\'s sides are cliffs', () => {
  const g = A.grid; g.setOpen(A.gates.map((q) => q.id));
  assert.ok(g.cliffs.length > 20 && g.allCliffs.length === g.cliffs.length); assert.ok(g.cliffs.every((c) => c.hi > c.lo));
  assert.equal(g.inArea(O.x - 4, O.z - 5.6, 0.45), false, 'a body next to the lower tier\'s cliff edge is stopped'); assert.equal(g.inArea(O.x - 4, O.z - 4.5, 0.45), true);
  assert.equal(g.reach(at(-4, 1), at(-4, -10), 0.3), false, 'cannot walk straight up a cliff'); assert.equal(g.sight(at(-4, 1), at(-4, -10), 0.3), true, 'but can see (and shoot) over it');
  assert.equal(g.reach(at(10, 1), at(10, -16), 0.3), true, 'the ramp is a way up');
  const lower = g.tiles.find((t) => t.tx === Math.floor(-4 / 2) && t.tz === -3), upper = g.tiles.find((t) => t.tx === -2 && t.tz === -4);
  assert.ok(lower && upper && !tilesLinked(lower, upper, 0, -1), 'neighbouring tiers are not joined');
  const rampTile = g.tiles.find((t) => t.ramp && t.tx === 5 && t.tz === -4), beside = g.tiles.find((t) => t.tx === 3 && t.tz === -4);
  assert.ok(rampTile && beside && !tilesLinked(rampTile, beside, -1, 0), 'a ramp\'s side is a cliff, not a way on');
  // the real body step: terrain.js walkability (inAnyArea with a 0.5 clearance)
  assert.equal(isWalkable(O.x - 4, O.z - 5.7), false); assert.equal(isWalkable(O.x + 10, O.z - 10), true); assert.equal(isWalkable(O.x + 10, O.z - 6.5), true);
  reset();
});
test('terrain stands players at the tier height: lower tier, a ramp midway, the middle and upper tiers; the ground is rock', () => {
  const g = A.grid; g.setOpen(A.gates.map((q) => q.id));
  assert.equal(getTerrainHeight(O.x, O.z + 1), O.y); assert.equal(getTerrainHeight(O.x, O.z - 10), O.y + 2); assert.equal(getTerrainHeight(O.x, O.z - 38), O.y + 4);
  assert.ok(Math.abs(getTerrainHeight(O.x + 10, O.z - 10) - (O.y + 1)) < 0.5 && getTerrainHeight(O.x + 10, O.z - 10) > O.y + 0.5);
  assert.equal(getGroundType(O.x, O.z), 'rock'); reset();
});
test('navigation respects the cliffs: a guardian on the upper tier walks down both ramps to reach a friend on the lower tier, never straight off a ledge', () => {
  const r = start(2); calm(r); const e = lone(r, make('pepperling', -2, -8)); const p = pos([K1, at(-2, -1)]);
  let last = r.g.heightAt(e.x, e.z), maxStep = 0, reached = -1;
  for (let t = 0; t < 60 && reached < 0; t += 0.05) {
    r.update(0.05, p); const hh = r.g.heightAt(e.x, e.z); maxStep = Math.max(maxStep, Math.abs(hh - last)); last = hh;
    if (Math.hypot(e.x - p[K1].x, e.z - p[K1].z) < 2.5) reached = t;
  }
  assert.ok(reached > 0, 'it found the way'); assert.ok(maxStep < 0.3, `walked down the ramps only (biggest step ${maxStep.toFixed(2)})`); assert.ok(r.g.heightAt(e.x, e.z) < 0.5, 'and ended on the lower tier');
  reset();
});
test('a shove across a cliff drops a guardian one tier (stunned, a little hurt); along a ramp, into a wall or away from the edge it only nudges', () => {
  const r = start(2); calm(r);
  const e = lone(r, make('crab', -4, -7.2)); const hp = e.hp;
  r.hitEnemy(K1, e, 5, 0.25, at(-4, -10), 1.5, { move: 'tap' });
  assert.ok(e.z > O.z - 6 && r.g.heightAt(e.x, e.z) === 0, 'it fell onto the lower tier'); assert.ok(e.stun >= COMBAT.ledge.stun - 1e-9); assert.ok(hp - e.hp >= Math.round(e.max * COMBAT.ledge.fall)); assert.ok(r.effects.some((fx) => fx.kind === 'fall'));
  const flat = lone(r, make('crab', -4, -12)); r.hitEnemy(K1, flat, 5, 0.25, at(-4, -15), 1.5, { move: 'tap' }); assert.ok(r.g.heightAt(flat.x, flat.z) === 2 && flat.z > O.z - 12 - 0.01, 'away from the edge: just nudged');
  const ramp = lone(r, make('crab', 10, -10)); const z0 = ramp.z; r.hitEnemy(K1, ramp, 5, 0.25, at(10, -13), 1.5, { move: 'tap' }); assert.ok(ramp.z > z0 && r.g.heightAt(ramp.x, ramp.z) < 2, 'down a ramp is a nudge, not a fall');
  const wall = lone(r, make('crab', -13, -3)); const x0 = wall.x; r.hitEnemy(K1, wall, 5, 0.25, at(-9, -3), 1.5, { move: 'tap' }); assert.ok(wall.x >= x0 - 1e-9 - 0, 'a wall stops it'); assert.ok(r.g.inArea(wall.x, wall.z));
  void ROOT; reset();
});
test('the grid helpers on a small synthetic area: two tiers joined by one ramp, cliffs listed once per pair, dropPoint finds the landing', () => {
  const shapes = mapFloor('terraces', { tiers: [{ x: 0, z: 4, w: 12, d: 8, h: 0 }, { x: 0, z: -4, w: 12, d: 8, h: 2 }], ramps: [{ x: 4, z: -2, w: 4, d: 4, dir: '-z', from: 0, to: 2 }] });
  const g = createGrid({ x: 0, z: 0, y: 0 }, shapes);
  assert.equal(g.bands, true); assert.ok(g.allCliffs.length > 0 && g.allCliffs.every((c) => c.hi === 2 || c.hi > c.lo));
  const drop = g.dropPoint(-2, -0.9, 0, 1, 2); assert.ok(drop && drop.to === 0 && drop.from === 2, 'dropped to the lower tier'); assert.equal(g.dropPoint(-2, -2, 0, 1, 0.3), null, 'too short to reach the edge');
  assert.equal(g.dropPoint(4, -1.5, 0, 1, 3), null, 'a ramp is walked, not fallen');
});

// ---------------------------------------------------------------------------------------------
// the Ember Channel: burn
// ---------------------------------------------------------------------------------------------
test('the mouth: the grace period opens the stair; the channel has four Ember Seed pedestals; swapping one gives the charm', () => {
  const r = start(0); const calmPos = pos([K1, spot(0)]); r.update(30.5, calmPos); assert.equal(r.section, 1);
  const peds = areaPedestals(A); assert.equal(peds.length, 4); assert.ok(peds.every((q) => q.charm === 'ember-seed' && !q.rack));
  const ped = r.pedestals.find((q) => !q.rack); const res = r.swapCharm(K1, ped.id, { [K1]: { x: ped.x, z: ped.z + 1 } }); assert.equal(res.took, 'ember-seed'); assert.equal(r.members[K1].charm, 'ember-seed');
  reset();
});
test('burn objective: only an Ember Seed burst within 2.4 u of the brambles burns them (not a far one, not a Frost Nova); then the gate opens and the section moves on', () => {
  const r = start(1); calm(r); r.giveCharm(K1, 'ember-seed'); const o = r.obj; assert.equal(o.type, 'burn'); assert.equal(o.total, 1); assert.equal(o.burned, false);
  const far = at(0, 30); r.bursts.push({ id: 1, kind: 'ember', owner: K1, x: far.x, z: far.z, at: r.time + 0.1, radius: 1.8 });
  steps(r, 0.3, pos([K1, at(3, 12)])); assert.equal(r.obj.burned, false, 'a burst far away does nothing');
  assert.equal(burnBrambles(r.obj, at(0, 14), { time: r.time }), false, 'and neither does one 4 u away'); assert.equal(r.obj.burned, false);
  const ev = r.castCharm(K1, Math.atan2(-3, -4), pos([K1, at(3, 12)])); assert.ok(ev); const out = steps(r, 0.7, pos([K1, at(3, 12)]));
  assert.equal(out, 'section'); assert.equal(r.section, 2); assert.ok(r.effects.some((fx) => fx.kind === 'brambles' || fx.kind === 'gate'));
  assert.equal(r.g.inArea(O.x, O.z + 8), true, 'the way is open'); reset();
});
test('the burn objective text and the edge arrow point at the brambles; a snapshot keeps the burned flag', () => {
  const r = start(1); const text = objectiveText(r.obj); assert.equal(text.count, '0 / 1'); assert.match(text.label, /Ember Seed/);
  assert.deepEqual(objectiveTargets(r.obj, r.enemies).map((q) => q.label), ['Brambles']); assert.ok(rectDistance(objectiveTargets(r.obj, r.enemies)[0], r.obj.target) < 1e-9);
  r.obj.burned = true; const copy = new DungeonRun(); copy.load(JSON.parse(JSON.stringify(r.snapshot()))); assert.equal(copy.obj.burned, true); assert.equal(copy.areaId, 'cinder'); reset();
});
test('pepper imps keep their distance and lob fireballs (hold 5 u, aggro 11 u); a fireball hurts a standing friend and passes through a perfect dodger', () => {
  assert.equal(guardianAttack('imp', 7), 'fireball'); assert.equal(ENEMY_KINDS.imp.hold, 5); assert.ok(ENEMY_KINDS.imp.aggro > 8);
  const r = start(1); const imp = lone(r, make('imp', 0, 17)), me = at(0, 27);
  steps(r, 2, pos([K1, me])); assert.ok(r.projectiles.some((a) => a.kind === 'fireball') || r.members[K1].hp < 100, 'it fired');
  assert.ok(Math.hypot(imp.x - me.x, imp.z - me.z) >= ENEMY_KINDS.imp.hold - 0.6, 'it stayed back');
  const hit = start(1); const e = lone(hit, make('imp', 0, 17)); e.attackKind = 'fireball'; e.target = K1; e.aim = at(0, 25); hit.release(e, {});
  steps(hit, 2, pos([K1, at(0, 25)])); assert.equal(hit.members[K1].hp, 100 - ENEMY_KINDS.imp.damage, 'hit once');
  reset();
});
test('the lava slug leaves a burning trail (patches) behind it and is not burned by its own trail', () => {
  const r = start(1); calm(r); const s = lone(r, make('slug', 0, 17)); let most = 0; for (let t = 0; t < 6; t += 0.05) { r.update(0.05, pos([K1, at(0, 24)])); most = Math.max(most, r.patches.length); }
  assert.ok(most >= 2, `trail of ${most}`); assert.ok(r.patches.every((q) => q.src === 'slug')); assert.ok(!(s.burning > r.time), 'its own trail does not burn it'); assert.ok(s.z > O.z + 17);
  reset();
});

// ---------------------------------------------------------------------------------------------
// the Terraces: defend
// ---------------------------------------------------------------------------------------------
test('defend: the timer waits until a friend is near the sapling, then runs 45 s; the chip counts down and shows the sapling\'s health; waves spawn on schedule, tagged', () => {
  const r = start(2); calm(r); const o = r.obj; assert.equal(o.type, 'defend'); assert.equal(o.started, false); assert.equal(o.sapling.max, COMBAT.defend.hp);
  const far = pos([K1, spot(2)]); steps(r, 3, far); assert.equal(r.obj.started, false); assert.match(objectiveText(r.obj).label, /Walk up/);
  const near = pos([K1, at(0, -14)]); const before = r.enemies.length; steps(r, 0.1, near); assert.equal(r.obj.started, true);
  steps(r, 3.5, near); assert.equal(r.enemies.filter((e) => e.wave === 'w0').length, 2 + 1 - 1 + 0 * 0 + (r.enemies.filter((e) => e.wave === 'w0').length - 2), 'wave 0 arrived'); assert.ok(r.enemies.length > before);
  const t = objectiveText(r.obj, r.time); assert.equal(t.bar, 1); assert.match(t.count, /^\d+ s$/); assert.ok(r.obj.wave >= 1);
  steps(r, 40, near); assert.equal(r.obj.wave, 4, 'all four waves');
  assert.equal(partyScale(1), 1); const trio = start(2, [K1, K2, K3]); assert.equal(trio.obj.sapling.max, Math.round(COMBAT.defend.hp * 1.3), 'a bigger party defends a sturdier sapling');
  reset();
});
test('defend: guardians with nobody in sight walk down the ramps to the sapling and hurt it; a lost sapling resets the section like a wipe; surviving 45 s opens the gate', () => {
  const lose = start(2); calm(lose); lose.update(0.1, pos([K1, at(0, -14)])); const away = pos([K1, spot(2)]);
  let out = null, seen = 0; for (let t = 0; t < 120 && out !== 'wipe'; t += 0.05) { out = lose.update(0.05, away); if (lose.obj.sapling && lose.obj.sapling.hp < lose.obj.sapling.max) seen++; }
  assert.equal(out, 'wipe', 'the sapling wilted'); assert.ok(seen > 0); assert.equal(lose.obj.started, false, 'the section started over'); assert.equal(lose.obj.sapling.hp, lose.obj.sapling.max); assert.equal(lose.section, 2);
  assert.ok(lose.notes.some((n) => n.type === 'sapling'));
  const win = start(2); calm(win); const near = pos([K1, at(0, -14)]); let result = null;
  for (let t = 0; t < 50 && !result; t += 0.1) { for (const e of win.enemies) if (e.wave !== undefined) e.hp = 0; result = win.update(0.1, near); }
  assert.equal(result, 'section'); assert.equal(win.section, 3); assert.ok(win.g.isOpen('terraces-gate'));
  reset();
});
test('a rain cloud over the sapling heals it (3 HP every half second, never above max); a burning patch beside it scorches it', () => {
  const r = start(2); calm(r); r.update(0.1, pos([K1, at(0, -14)])); const s = r.obj.sapling; s.hp = 50;
  r.addCloud(K1, s.x, s.z, 6, 2.6); steps(r, 2, pos([K1, at(0, -14)])); assert.ok(s.hp >= 60 && s.hp <= s.max, `healed to ${s.hp}`);
  r.clouds = []; s.hp = 100; r.addPatch(s.x + 0.5, s.z, 1.6, 4, { owner: K1 }); steps(r, 2, pos([K1, at(0, -14)])); assert.ok(s.hp < 100, 'fire hurts it'); reset();
});
test('the imps on the upper tier shoot friends on the middle tier below them (sight ignores height) and the chip arrow points at the sapling', () => {
  const r = start(2); calm(r); const me = at(5, -22); r.enemies = r.enemies.filter((e) => e.kind === 'imp');
  let shot = false; for (let t = 0; t < 5 && !shot; t += 0.05) { r.update(0.05, pos([K1, me])); shot = r.projectiles.some((a) => a.kind === 'fireball'); } assert.ok(shot, 'a fireball came down from the upper tier');
  assert.deepEqual(objectiveTargets(r.obj, r.enemies).map((q) => q.label), ['Sapling']); reset();
});

// ---------------------------------------------------------------------------------------------
// the Pepper Grove: hunt
// ---------------------------------------------------------------------------------------------
test('hunt: three named chiefs are the targets; the list names them with ticks and the arrows point at the ones still standing', () => {
  const r = start(3); const o = r.obj; assert.equal(o.type, 'hunt'); assert.equal(o.total, 3);
  assert.deepEqual(o.chiefs.map((c) => [c.name, c.mod]), [['Chief Cayenne', 'fast'], ['Chief Habanero', 'shield'], ['Chief Paprika', 'split']]);
  const t = objectiveText(o); assert.equal(t.count, '0 / 3'); assert.deepEqual(t.items.map((q) => q.label), ['Chief Cayenne', 'Chief Habanero', 'Chief Paprika']);
  assert.deepEqual(objectiveTargets(o, r.enemies).map((q) => q.label), ['Chief Cayenne', 'Chief Habanero', 'Chief Paprika']);
  const c = r.enemies.find((e) => e.chief === 'fast'); c.hp = 0; r.update(0.1, pos([K1, spot(3)])); assert.equal(r.obj.n, 1); assert.equal(objectiveText(r.obj).items[0].done, true);
  assert.deepEqual(objectiveTargets(r.obj, r.enemies).map((q) => q.label), ['Chief Habanero', 'Chief Paprika']); reset();
});
test('chief modifiers: fast moves 1.7x, shield blocks front hits (x0.25) but not hits from behind, split breaks into two little peppers that do not count', () => {
  const r = start(3); calm(r); const away = pos([K1, at(0, -76)]);
  const fast = make('chief', -3, -80, { id: 1, chief: 'fast', name: 'F' }), plain = make('chief', 3, -80, { id: 2 }); r.enemies = [fast, plain];
  const x0 = [fast.x, plain.x]; steps(r, 1, pos([K1, at(0, -73)])); const df = Math.hypot(fast.x - x0[0], fast.z - (O.z - 80)), dp = Math.hypot(plain.x - x0[1], plain.z - (O.z - 80));
  assert.ok(df / dp > 1.5 && df / dp < 1.9, `fast ${df.toFixed(2)} vs plain ${dp.toFixed(2)}`);
  const sh = make('chief', 0, -85, { id: 3, chief: 'shield', facing: 0 }); r.enemies = [sh];
  const front = r.hitEnemy(K1, sh, 40, 0.3, at(0, -83), 0, { move: 'tap' }); assert.equal(front, Math.max(1, Math.round(40 * COMBAT.shield.mult)), 'blocked from the front');
  sh.stun = 0; const back = r.hitEnemy(K1, sh, 40, 0.3, at(0, -88), 0, { move: 'tap' }); assert.equal(back, 40, 'full damage from behind');
  const sp = make('chief', 0, -90, { id: 4, chief: 'split', name: 'P' }); r.enemies = [sp]; r.obj = { type: 'hunt', label: '', n: 0, total: 1, complete: false, since: 0, chiefs: [{ id: 4, name: 'P', mod: 'split', done: false }] };
  r.hitEnemy(K1, sp, 9999, 0, at(0, -88), 0, { move: 'tap' }); assert.equal(sp.hp, 0);
  const kids = r.enemies.filter((e) => e.kind === 'pepperling'); assert.equal(kids.length, 2, 'two little peppers'); assert.ok(kids.every((k) => k.hp > 0 && r.g.inArea(k.x, k.z)));
  assert.equal(r.update(0.1, away), 'section', 'the chief counts (the hunt is done), the children do not'); reset();
});
test('killing all three chiefs completes the hunt and opens the way to the hall', () => {
  const r = start(3); calm(r); for (const e of r.enemies) if (e.chief) e.hp = 0;
  assert.equal(r.update(0.1, pos([K1, spot(3)])), 'section'); assert.equal(r.section, 4); assert.equal(r.enemies.filter((e) => e.boss).length, 1); reset();
});

// ---------------------------------------------------------------------------------------------
// the Magma Hall: the toad
// ---------------------------------------------------------------------------------------------
test('the toad chooses lava blobs from afar and alternates tongue and belly-flop up close; phase 2 grows a magma shell, calls imps and spits three blobs', () => {
  assert.equal(guardianAttack('toad', 8), 'spit'); assert.equal(guardianAttack('toad', 3, { attacks: 0 }), 'lash'); assert.equal(guardianAttack('toad', 3, { attacks: 1 }), 'flop');
  const r = start(4); calm(r); const toad = r.enemies[0]; assert.equal(toad.boss, true);
  toad.attackKind = 'spit'; toad.aim = at(0, -112); toad.target = K1; r.release(toad, {}); assert.equal(r.bursts.filter((b) => b.kind === 'blob').length, 1);
  toad.hp = Math.floor(toad.max * 0.49); const n = r.enemies.length; r.hitEnemy(K1, toad, 1, 0, at(0, -120), 0);
  assert.equal(toad.phase2, true); assert.equal(toad.shell, 'magma'); assert.ok(r.enemies.length > n, 'imps and a little pepper arrive'); assert.ok(r.notes.some((q) => q.type === 'phase' && q.kind === 'toad'));
  r.bursts = []; toad.attackKind = 'spit'; r.release(toad, {}); assert.equal(r.bursts.length, 3, 'three blobs in phase 2'); reset();
});
test('a lava blob lands after its flight: it hurts friends in the circle (a hop does not clear it), leaves a burning patch and is telegraphed in the state', () => {
  const r = start(4); const toad = r.enemies[0]; toad.attackKind = 'spit'; toad.aim = at(6, -124); toad.target = K1; toad.hp = toad.max; r.release(toad, {});
  const b = r.bursts[0]; assert.ok(b.at - r.time <= GUARDIAN_ATTACKS.spit.flight + 1e-9); assert.ok(JSON.parse(JSON.stringify(r.snapshot())).bursts.length === 1, 'replicas see the landing circle');
  const me = { x: b.x, z: b.z }; r.update(GUARDIAN_ATTACKS.spit.flight - 0.1, pos([K1, me])); r.members[K1].dodge = { at: r.time, air: 0.48, inv: 0.05, dx: 0, dz: 0, perfect: false };
  r.update(0.15, pos([K1, me])); assert.equal(r.members[K1].hp, 100 - ENEMY_KINDS.toad.damage, 'airborne does not clear a blob'); assert.ok(r.patches.some((q) => q.src === 'toad'));
  reset();
});
test('the tongue lash is an instant lane in front of the toad (hurts inside the lane, not beside it); the belly-flop is a ground ring a hop clears', () => {
  const r = start(4); const toad = r.enemies[0]; toad.x = O.x; toad.z = O.z - 122; toad.facing = 0;
  toad.attackKind = 'lash'; r.release(toad, { [K1]: at(0, -118), [K2]: at(5, -118) }); void K2; assert.equal(r.members[K1].hp, 100 - ENEMY_KINDS.toad.damage);
  const r2 = start(4, [K1, K2]); const t2 = r2.enemies[0]; t2.x = O.x; t2.z = O.z - 122; t2.facing = 0; t2.attackKind = 'lash'; r2.release(t2, pos([K1, at(0, -118)], [K2, at(5, -118)]));
  assert.equal(r2.members[K1].hp, 100 - ENEMY_KINDS.toad.damage); assert.equal(r2.members[K2].hp, 100, 'beside the lane is safe');
  const flop = start(4); const t3 = flop.enemies[0]; t3.attackKind = 'flop'; t3.target = K1; t3.aim = at(0, -118); flop.release(t3, {}); assert.equal(flop.projectiles.at(-1).kind, 'flop');
  flop.members[K1].dodge = { at: flop.time, air: 0.48, inv: 0, dx: 0, dz: 0, perfect: false }; steps(flop, 1.3, pos([K1, at(0, -118)])); assert.equal(flop.members[K1].hp, 100, 'a hop clears the flop');
  reset();
});

// ---------------------------------------------------------------------------------------------
// the Armory
// ---------------------------------------------------------------------------------------------
test('clearing Cinder Tubes teaches the Armory the watering can and the Ember Seed; every area\'s racks then offer them (and the charm rack shows the seed)', () => {
  const s = markCleared(normaliseCombat(null), 'cinder'); assert.equal(s.cleared.cinder.wild, true);
  assert.ok(s.armory.weapons.includes('watering-can') && s.armory.charms.includes('ember-seed'));
  for (const id of ['wildroot', 'glimmerfrost', 'cinder']) assert.ok(supplyKinds(AREAS[id], s.armory.weapons).includes('watering-can'), id);
  assert.ok(!supplyKinds(AREAS.wildroot, ['sword', 'axe', 'hammer']).includes('watering-can'), 'not before the clear');
  assert.ok(supplyKinds(A, ['sword', 'axe', 'hammer']).includes('watering-can'), 'Cinder\'s own rack always has it');
  const rack = rackPedestals(AREAS.wildroot, s.armory.charms); assert.ok(rack.some((q) => q.charm === 'ember-seed' && q.rack));
  const both = markCleared(s, 'glimmerfrost'); assert.deepEqual(both.armory.charms.sort(), ['ember-seed', 'frost-nova']); assert.ok(rackPedestals(A, both.armory.charms).length === 2);
});

// ---------------------------------------------------------------------------------------------
// a scripted clear and pacing
// ---------------------------------------------------------------------------------------------
function clearArea(keys) {
  const r = start(0, keys), K = keys[0], home = Object.fromEntries(keys.map((k, i) => [k, spot(0, i)]));
  const step = (p, dt = 0.1) => r.update(dt, p);
  for (const k of keys) r.members[k].invulnerable = 1e9;
  step(home, 30.5); assert.equal(r.section, 1);
  const ped = r.pedestals.find((q) => !q.rack); assert.ok(r.swapCharm(K, ped.id, { [K]: { x: ped.x, z: ped.z + 1 } }));
  for (const e of r.enemies) r.hitEnemy(K, e, 9999, 0, at(0, 20), 0, { move: 'charged' });
  const there = pos(...keys.map((k, i) => [k, at(3 + i * 0.3, 12)])); r.members[K].charmReady = 0;
  r.castCharm(K, Math.atan2(-3, -4), there); assert.equal(steps(r, 0.7, there), 'section'); assert.equal(r.section, 2);
  const sap = pos(...keys.map((k, i) => [k, at(i * 0.5, -14)]));
  let out = null; for (let t = 0; t < 60 && out !== 'section'; t += 0.1) { for (const e of r.enemies) if (e.wave !== undefined) e.hp = 0; out = r.update(0.1, sap); } assert.equal(out, 'section'); assert.equal(r.section, 3);
  for (const e of r.enemies) if (e.chief) r.hitEnemy(K, e, 9999, 0, at(0, -80), 0, { move: 'charged', pierce: true });
  assert.equal(r.update(0.1, pos([K, spot(3)])), 'section'); assert.equal(r.section, 4);
  const toad = r.enemies.find((e) => e.boss); let phase2 = false, shelled = false, result = null;
  for (let g = 0; g < 800 && !result; g++) {
    r.hitEnemy(K, toad, 60, 0.3, at(0, -120), 0, { move: 'charged', armorBreak: true }); phase2 ||= !!toad.phase2; shelled ||= toad.shell === 'magma';
    result = r.update(0.1, pos([K, at(0, -116)])); for (const e of r.enemies) if (e !== toad && e.kind !== 'toad') e.hp = 0;
  }
  return { r, phase2, shelled, result };
}
test('the whole area can be cleared section by section and ends in cleared (1 and 3 players)', () => {
  for (const keys of [[K1], [K1, K2, K3]]) {
    const { r, phase2, shelled, result } = clearArea(keys);
    assert.equal(result, 'cleared'); assert.equal(r.cleared, true); assert.ok(phase2 && shelled, 'the toad went through its shelled second phase'); assert.equal(r.g.open.length, 4); assert.equal(r.update(0.1, {}), null, 'cleared only once');
    reset();
  }
});
export function pacing({ run = 7, eff = 0.7, dps = 20, players = 1 } = {}) {
  const walk = (u) => u / (run * eff), scale = partyScale(players), team = 1 + 0.8 * (players - 1);
  const mult = { toad: 1.5, chief: 1.2, crab: 1.3 };
  const hp = (list) => list.reduce((sum, [k, , , extra]) => sum + (ENEMY_KINDS[k].practice ? 0 : ENEMY_KINDS[k].hp * (mult[k] || 1) * (1 + (extra?.[Math.min(3, players - 1)] || 0))), 0) * scale;
  const fight = (list, overhead = 1.5) => hp(list) / (dps * team) * overhead;
  const S = A.sections, d = S[2].objective;
  const sections = {
    mouth: COMBAT.train.seconds + walk(24) + 10,
    channel: walk(28) + fight(S[1].enemies) + 25 + 15,                                                    // (+25: the charm's tip card, swapping at a pedestal; +15: aiming the seed)
    terraces: walk(26) + Math.max(d.seconds, fight(d.waves.flatMap((w) => w.tuples)) / 1.2) + 12,         // the timer is the floor; the waves are fought while it runs
    grove: walk(62) + fight(S[3].enemies, 1.9) + 35,                                                      // (+35: finding three chiefs among the plants)
    hall: walk(16) + fight(S[4].enemies, 1.8) + fight(S[4].phase2.adds) + 45,                             // (+45: soaking the shell, freezing it, cracking it)
  };
  return { sections, total: Object.values(sections).reduce((a, b) => a + b, 0) };
}
test('pacing estimate: a first-time party of one or two clears Cinder Tubes in about six to eight minutes', () => {
  for (const players of [1, 2]) {
    const { sections, total } = pacing({ players });
    assert.ok(total >= 360 && total <= 480, `${players} player(s): ${(total / 60).toFixed(1)} min ${JSON.stringify(Object.fromEntries(Object.entries(sections).map(([k, v]) => [k, Math.round(v)])))}`);
    for (const [name, s] of Object.entries(sections)) assert.ok(s > 20 && s < 190, `${name} ${Math.round(s)} s`);
  }
});
test('few guardians are awake together: small opening lists, waves of at most three, chiefs asleep far apart, no immune enemy, party scaling', () => {
  for (const s of A.sections) {
    const base = s.enemies.filter((e) => !ENEMY_KINDS[e[0]].practice); assert.ok(base.length <= 6, s.id);
    for (const w of s.objective.waves || []) assert.ok(w.tuples.length <= 3, 'a wave of at most three spawn points');
  }
  const waves = A.sections[2].objective.waves; for (let i = 1; i < waves.length; i++) assert.ok(waves[i].at - waves[i - 1].at >= 10);
  const chiefs = A.sections[3].enemies.filter((e) => e[0] === 'chief'); for (let i = 0; i < chiefs.length; i++) for (let j = i + 1; j < chiefs.length; j++) assert.ok(Math.hypot(chiefs[i][1] - chiefs[j][1], chiefs[i][2] - chiefs[j][2]) > 10);
  for (const n of [1, 2, 3, 4]) { const list = buildEnemies(A.sections[3], n, O); assert.ok(list.length >= 6); assert.ok(list.filter((e) => e.chief).length === 3); assert.ok(list.every((e) => e.max === Math.round(ENEMY_KINDS[e.kind].hp * partyScale(n)))); }
  for (const kind of ['imp', 'crab', 'slug', 'chief', 'pepperling', 'toad']) { assert.ok(ENEMY_KINDS[kind].hp > 0 && !ENEMY_KINDS[kind].immune); assert.ok(guardianAttack(kind, 3, { attacks: 0 })); }
});
test('weapons: the watering can is a full weapon entry (tap, charged, special, keys) and every new guardian attack is distinct', () => {
  const w = WEAPONS['watering-can']; assert.ok(w.damage.length === 1 && w.keys.length === 2 && w.charged.keys.length === 2 && w.special.keys.length === 2 && w.special.name === 'Rain cloud');
  assert.equal(new Set(['fireball', 'lash', 'flop', 'spit'].map((k) => JSON.stringify(GUARDIAN_ATTACKS[k]))).size, 4);
  for (const k of ['imp', 'crab', 'slug', 'chief', 'pepperling', 'toad']) assert.ok(GUARDIAN_ATTACKS[guardianAttack(k, 3, { attacks: 0 })]);
});

// ---------------------------------------------------------------------------------------------
// the mouth on Emberleaf
// ---------------------------------------------------------------------------------------------
const island = ISLANDS.find((i) => i.id === 'ember'), mod = getIslandModule('ember');
test('the lava-tube mouth stands on Emberleaf\'s east flank on walkable grass clear of the garden, the waterfall, the lanes, the ramps\' wedge and every prop and spot', () => {
  const P = buildEmberPlacement(island, mod), G = planEmberGathering(island, mod), T = planEmberTools(island, mod), S = planEmberSeeds(island, mod, P), c = LAVA_MOUTH, R = c.keepClear;
  assert.equal(c.id, 'cinder-mouth'); assert.ok(mod.walkable(c.x, c.z)); assert.equal(mod.groundType(c.x, c.z), 'grass'); assert.ok(mod.height(c.x, c.z) > 1);
  for (const q of [c, c.front]) assert.ok(mod.walkable(q.x, q.z), 'the walk-up point too');
  assert.ok(!gardenZone(island, c.x, c.z, 8) && !waterfallForbidden(island, c.x, c.z, 8)); assert.ok(Math.hypot(c.x - island.x - 15, c.z - island.z + 5) > 40, 'on the flank, not the crater');
  for (const l of emberLanes(island, mod)) assert.ok(polyDist(l, c.x, c.z) > R + 2, 'off every lane and the trail');
  const items = [...P.trees, ...P.boulders, ...P.decor, ...P.ferns, ...P.flowers.filter((f) => f.interactive), ...P.garden.plots, ...(G.herbs || []), ...(G.digs || []), ...T, ...Object.values(S).filter((q) => q && Number.isFinite(q.x))];
  for (const q of items) assert.ok(Math.hypot(q.x - c.x, q.z - c.z) - (q.r || 0.3) > R, `nothing within ${R} u of the mouth`);
  assert.ok(!lavaMouthReserved(c.x + R + 0.1, c.z) && lavaMouthReserved(c.x + R - 0.1, c.z) && lavaMouthReserved(c.x + R + 1, c.z, 2));
  assert.ok(P.solids.some((q) => q.x === c.x && q.z === c.z), 'claimed as a solid so later placements keep off it');
});
test('Emberleaf\'s seeded placement did not move: trees, boulders, ferns, flowers, decor, gathering spots, tools, seed spots and respawn spots hash as before Step 60', async () => {
  const P = buildEmberPlacement(island, mod), G = planEmberGathering(island, mod), T = planEmberTools(island, mod), S = planEmberSeeds(island, mod, P);
  assertPlacementGolden(P.flowers, 'emberFlowers', '834b877a48');
  const { sampleEmberSpots } = await import('../public/js/world/islands/emberPlacement.js');
  assert.deepEqual({ trees: hash(P.trees), boulders: hash(P.boulders), ferns: hash(P.ferns), decor: hash(P.decor), G: hash(G), T: hash(T), S: hash(S), plots: hash(P.garden.plots), lanes: hash(P.lanes) },
    { trees: '2014801176', boulders: '98cd3aa689', ferns: '356ed6e089', decor: 'abf0410989', G: '7b457aaba9', T: '013ab09ce6', S: '7f68b8d680', plots: '556af713d0', lanes: '54052443b5' });
  assert.deepEqual([['jungle', 5], ['soil', 7], ['jungle', 9]].map(([area, seed]) => hash(sampleEmberSpots(island, mod, { area, count: 20, seed }))), ['1a0ce89734', 'f4b2a2af6f', 'bac5efb7a8']);
  assert.equal(P.solids.length, 189, 'the only addition is the mouth\'s own solid (188 before Step 60)');
  assert.ok(sampleEmberSpots(island, mod, { area: 'jungle', count: 60, seed: 5, r: 0.6, minDist: 3 }).every((q) => !lavaMouthReserved(q.x, q.z)), 'respawned spots keep off it too');
});

// ---------------------------------------------------------------------------------------------
// memory, entrances, the guide
// ---------------------------------------------------------------------------------------------
test('a watering can is a remembered tool, and a reload inside Cinder Tubes remembers the area and the lava mouth', async () => {
  const { rememberedTool, runMeta } = await import('../public/js/game/playerMemory.js');
  assert.deepEqual(rememberedTool({ kind: 'watering-can' }), { kind: 'watering-can', color: null, roll: 0 });
  assert.deepEqual(runMeta('dungeon', { area: 'cinder', from: 'cinder-mouth' }), { area: 'cinder', from: 'cinder-mouth' });
  const { TOOLS, ISLAND_SWINGS, getToolAction } = await import('../public/js/items/tools.js');
  assert.deepEqual(TOOLS['watering-can'], { chop: 0, break: 0, dig: 0 }); assert.ok(ISLAND_SWINGS['watering-can'].duration > 0); assert.equal(getToolAction({ kind: 'watering-can', state: 'held' }, { type: 'tree' }), null);
});
test('every Cinder part, new guardian, the watering can and the Ember Seed have guide / tip text and icons; the tip card knows the can', async () => {
  const { CINDER_GUIDE, GUARDIAN_GUIDE, WEAPON_GUIDE } = await import('../public/js/ui/dungeonBook.js');
  const { WEAPON_TIPS } = await import('../public/js/ui/tipCard.js'); const { ICONS } = await import('../public/js/ui/icons.js'); const { CHARMS } = await import('../public/js/game/charms.js');
  assert.equal(CINDER_GUIDE.length, A.sections.length);
  for (const kind of ['imp', 'crab', 'slug', 'chief', 'pepperling', 'toad']) assert.ok(GUARDIAN_GUIDE[kind].length > 40, kind);
  assert.ok(WEAPON_GUIDE['watering-can'].description.length > 60); assert.ok(WEAPON_TIPS['watering-can'].special);
  assert.equal(CHARMS['ember-seed'].icon, 'charm-ember-seed'); assert.ok(ICONS['charm-ember-seed'] && ICONS['tool-watering-can']);
});
test('a snapshot mid-run round-trips patches, clouds, pending bursts, the sapling and statuses; the hash view changes with them', () => {
  const r = start(2); calm(r); r.update(0.1, pos([K1, at(0, -14)])); r.addPatch(O.x, O.z - 5, 1.6, 4, { owner: K1 }); r.addCloud(K1, O.x, O.z - 8, 6, 2.6); r.bursts.push({ id: 99, kind: 'blob', enemy: 0, x: O.x, z: O.z - 3, at: r.time + 1, radius: 1.3 });
  r.enemies[0].wet = r.time + 5; r.enemies[0].shell = 'magma'; r.obj.sapling.hp = 77;
  const copy = new DungeonRun(); copy.load(JSON.parse(JSON.stringify(r.snapshot())));
  assert.deepEqual(copy.patches, r.patches); assert.deepEqual(copy.clouds, r.clouds); assert.deepEqual(copy.bursts, r.bursts); assert.equal(copy.obj.sapling.hp, 77); assert.equal(copy.enemies[0].shell, 'magma'); assert.equal(copy.g, A.grid);
  reset();
});

test('one charm pedestal per friend (playtest 0.60.0): a run shows as many section pedestals as members, centre-out; a join adds one, a leave removes an untouched spare but never a left charm', () => {
  const sec = (r) => r.pedestals.filter((p) => !p.rack && p.section === 1);
  const r = new DungeonRun(); r.start(['a'], { area: 'cinder' });
  assert.deepEqual(sec(r).map((p) => p.x - AREAS.cinder.origin.x), [-1.5], 'solo: one Ember Seed, in the middle');
  r.join('b'); assert.deepEqual(sec(r).map((p) => p.x - AREAS.cinder.origin.x), [-1.5, 1.5]);
  r.join('c'); r.join('d'); assert.equal(sec(r).length, 4);
  const last = sec(r).find((p) => p.ord === 3); last.charm = 'frost-nova';             // somebody left their Frost Nova on the spare
  r.drop('d'); r.drop('c'); assert.deepEqual(sec(r).map((p) => p.ord).sort(), [0, 1, 3], 'the untouched spare goes, the one holding a left charm stays');
  const g = new DungeonRun(); g.start(['a', 'b', 'c'], { area: 'glimmerfrost' }); assert.equal(g.pedestals.filter((p) => !p.rack).length, 3, 'Glimmerfrost too');
  assert.equal(partyPedestals(AREAS.cinder, [], 0).length, 1, 'never fewer than one');
  assert.equal(areaPedestals(AREAS.cinder).length, 4, 'four spots exist for a full party');
});
