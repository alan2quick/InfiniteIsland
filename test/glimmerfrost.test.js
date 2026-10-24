// Step 59: Glimmerfrost Caves, Frostpine's combat area: the five sections and their gates, the Frozen Ford (Frost Nova freezes the water into an ice bridge), the `rescue` objective, Frost
// Nova itself (freeze, bosses chill, cooldown), shatter, the slingshot, flyers (the icicle bat is never immune), falling icicles, the Snow Golem's ice armor, the Armory unlocks, a scripted
// clear for 1 and 3 players, a pacing estimate and the cave mouth's clearing on Frostpine. All pure (DungeonRun + the area data), no browser.
import { assertPlacementGolden } from './helpers/placementGolden.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { AREAS, floorTiles, TILE_SIZE, ritualMenuRows, supplyKinds } from '../public/js/game/areaLogic.js';
import { DungeonRun, WEAPONS, ENEMY_KINDS, GUARDIAN_ATTACKS, guardianAttack, buildEnemies, partyScale } from '../public/js/game/dungeonLogic.js';
import { GROUND_ATTACKS, avoidance, gainBloom } from '../public/js/game/combatLogic.js';
import { initObjective, tickObjective, rectDistance, objectiveText, objectiveTargets } from '../public/js/game/objectives.js';
import { CHARMS, rackPedestals, areaPedestals } from '../public/js/game/charms.js';
import { markCleared, normaliseCombat, mergeArmory } from '../public/js/game/combatSave.js';
import { COMBAT, CHARM, ISLANDS } from '../public/js/config.js';
import { CRITTERS } from '../public/js/config.js';
import { getIslandModule } from '../public/js/world/islands/registry.js';
import { buildFrostPlacement, frostLanes, sampleFrostSpots, LAKE_CLEAR } from '../public/js/world/islands/frostPlacement.js';
import { planFrostGathering } from '../public/js/world/islands/frostGathering.js';
import { planCritters } from '../public/js/world/islands/critterPlan.js';
import { CAVE_MOUTH, caveMouthReserved } from '../public/js/world/islands/caveMouth.js';
import { polyDist } from '../public/js/world/islands/scatter.js';
import { campDist } from '../public/js/world/islands/frostCamp.js';

const A = AREAS.glimmerfrost, O = A.origin, K1 = 'h:0', K2 = 'h:1', K3 = 'h:2';
const at = (x, z) => ({ x: O.x + x, z: O.z + z });
const tile = (p) => ({ tx: Math.floor((p.x - O.x) / TILE_SIZE), tz: Math.floor((p.z - O.z) / TILE_SIZE) });
const key = (tx, tz) => `${tx},${tz}`;
function flood(grid, from) {
  const live = new Set(grid.tiles.map((t) => key(t.tx, t.tz))), seen = new Set(), queue = [from];
  if (!live.has(key(from.tx, from.tz))) return seen;
  seen.add(key(from.tx, from.tz));
  for (let i = 0; i < queue.length; i++) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const next = { tx: queue[i].tx + dx, tz: queue[i].tz + dz }, k = key(next.tx, next.tz);
    if (live.has(k) && !seen.has(k)) { seen.add(k); queue.push(next); }
  }
  return seen;
}
const start = (section = 0, keys = [K1]) => { const r = new DungeonRun(); r.start(keys, { area: 'glimmerfrost', section }); return r; };
const spot = (section, slot = 0) => at(A.sections[section].start.x + slot * A.sections[section].start.step, A.sections[section].start.z);
const invulnerable = (r) => { for (const m of Object.values(r.members)) m.invulnerable = r.time + 999; };
const make = (kind, x, z, extra = {}) => ({ id: 0, kind, x: O.x + x, z: O.z + z, hp: ENEMY_KINDS[kind].hp, max: ENEMY_KINDS[kind].hp, stun: 0, wind: 0, cooldown: 0, target: null, aim: null, ...extra });
const lone = (r, e) => { r.enemies = [e]; return e; };
const facing = (from, to) => Math.atan2(to.x - from.x, to.z - from.z);
/** Swing `weapon` at `e` from `p` (a one-off: wait out the swing, then let the impact land). */
function swing(r, id, weapon, e, p, { charged = false, wait = 1.2 } = {}) {
  const pos = { [id]: p }; r.members[id].ready = 0;
  const hit = r.attack(id, weapon, facing(p, e), pos, charged);
  r.update(wait, pos); return hit;
}
const reset = () => { for (const a of Object.values(AREAS)) a.grid.setOpen([]); };

// ---------------------------------------------------------------------------------------------
// layout
// ---------------------------------------------------------------------------------------------
test('Glimmerfrost is registered: five sections, four gates, its own pocket far from everything, listed in the ritual menu', () => {
  assert.ok(AREAS.glimmerfrost); assert.deepEqual(A.sections.map((s) => s.id), ['mouth', 'ford', 'snowfield', 'gauntlet', 'glacier']);
  assert.deepEqual(A.grid.gates, ['mouth-gate', 'ford-gate', 'snowfield-gate', 'gauntlet-gate']);
  assert.equal(A.island, 'frost'); assert.equal(A.entrance.id, 'glimmerfrost-mouth'); assert.equal(A.entrance.island, 'frost');
  assert.deepEqual(A.sections.map((s) => s.objective.type), ['train', 'freeze', 'rescue', 'clear', 'bosses']);
  const W = AREAS.wildroot, b = A.bounds, wb = W.bounds;
  assert.ok(b.maxX < wb.minX || b.minX > wb.maxX || b.maxZ < wb.minZ || b.minZ > wb.maxZ, 'the two pockets do not overlap');
  assert.ok(Math.hypot(O.x, O.z) > 1000 && b.minX > O.x - 40 && b.maxX < O.x + 40, 'a tidy pocket far from every island');
  const row = ritualMenuRows({}).find((r) => r.id === 'glimmerfrost'); assert.ok(row); assert.equal(row.islandName, 'Frostpine Isle'); assert.equal(row.cleared, false);
  assert.equal(ritualMenuRows({ glimmerfrost: { wild: true } }).find((r) => r.id === 'glimmerfrost').cleared, true);
});
test('every section is reachable only through the previous section\'s gate, and the whole cave is connected once every gate is open', () => {
  const floors = A.sections.map((s) => new Set(floorTiles(s.floor).keys()));
  for (let k = 0; k < 5; k++) {
    A.grid.setOpen(A.sections.slice(0, k).map((s) => s.gate.id));
    const from = tile(spot(k)), seen = flood(A.grid, from);
    assert.ok(seen.size > 8, `section ${k} start is on floor`);
    for (let j = k + 1; j < 5; j++) for (const t of floors[j]) if (!floors[k].has(t)) assert.ok(!seen.has(t), `section ${j} is sealed while gate ${k} is shut (tile ${t})`);
    if (k < 4) { A.grid.setOpen(A.sections.slice(0, k + 1).map((s) => s.gate.id)); assert.ok(flood(A.grid, from).has(key(...Object.values(tile(spot(k + 1))))), `gate ${k} opens the way to section ${k + 1}`); }
  }
  A.grid.setOpen(A.grid.gates);
  assert.equal(flood(A.grid, tile(spot(0))).size, A.grid.allTiles.length, 'every tile is reachable once every gate is open');
  reset();
});
test('edges are tile aligned; every start, shrine, spawn, pedestal, supply spot and the portal stand on clear floor; every start is safe', () => {
  for (const s of A.sections) {
    if (s.gate) for (const shape of s.gate.shapes) for (const v of [shape.x - shape.w / 2, shape.z - shape.d / 2, shape.w, shape.d]) assert.equal(Math.abs(v % 2), 0, `${s.id} gate edge ${v}`);
    for (const f of s.floor) if (!f.shape || f.shape === 'rect') for (const v of [f.x - f.w / 2, f.z - f.d / 2, f.w, f.d]) assert.equal(Math.abs(v % 2), 0, `${s.id} floor edge ${v}`);
  }
  A.grid.setOpen(A.grid.gates);
  for (const [i, s] of A.sections.entries()) {
    for (let slot = 0; slot < 4; slot++) {
      const p = spot(i, slot); assert.equal(A.grid.inArea(p.x, p.z, 0.8), true, `${s.id} start slot ${slot}`);
    }
    const p0 = spot(i, 0), run = new DungeonRun(); run.setArea('glimmerfrost');
    assert.equal(run.isSafe(p0.x, p0.z), true, `${s.id} start is safe`); assert.equal(run.isSafe(spot(i, 3).x, spot(i, 3).z), true, `${s.id} slot 3 start is safe`);
    for (const [kind, x, z] of s.enemies) assert.equal(A.grid.inArea(O.x + x, O.z + z, 0.8), true, `${s.id} ${kind} spawns on clear floor`);
    for (const p of s.pedestals || []) assert.equal(A.grid.inArea(O.x + p.x, O.z + p.z, 0.8), true, `${s.id} pedestal`);
  }
  for (const p of [A.exit, { x: A.rack.x, z: A.rack.z }, { x: A.supply.x, z: A.supply.z }, { x: A.supply.x + 3 * A.supply.dx, z: A.supply.z + 3 * A.supply.dz }, { x: A.rack.x + 7 * A.rack.dx, z: A.rack.z }]) assert.equal(A.grid.inArea(O.x + p.x, O.z + p.z, 0.8), true, JSON.stringify(p));
  assert.ok(A.sections[0].safe.some((z) => z.w && Math.abs(A.exit.x - z.x) <= z.w / 2 && Math.abs(A.exit.z - z.z) <= z.d / 2), 'the homeward portal stands in the safe Ice Mouth');
  reset();
});
test('Frostpine is the cave\'s island, the friends are not the camp critters, and the rewards are real catalog items', async () => {
  assert.equal(A.island, 'frost');
  const camp = new Set(Object.keys(CRITTERS.food || {}).concat(['fox', 'squirrel', 'rabbit', 'grouse']));
  for (const kind of ['hareblock', 'chickblock']) { assert.ok(ENEMY_KINDS[kind].block); assert.ok(!camp.has(ENEMY_KINDS[kind].friend), `${ENEMY_KINDS[kind].friend} is not a camp critter`); }
  const { getItem } = await import('../public/js/game/catalog.js');
  for (const id of Object.keys(A.rewards)) assert.ok(getItem(id), id);
  assert.deepEqual(A.armory, { weapons: ['slingshot'], charms: ['frost-nova'] });
});

// ---------------------------------------------------------------------------------------------
// the Frozen Ford + Frost Nova
// ---------------------------------------------------------------------------------------------
test('the ford\'s water blocks until a Frost Nova is cast next to it; a cast elsewhere does nothing', () => {
  const ford = A.sections[1].gate.shapes[0];
  const r = start(1); r.giveCharm(K1, 'frost-nova');
  assert.equal(r.g.isOpen('ford-gate'), false);
  const seen = flood(r.g, tile(spot(1)));
  assert.ok(!seen.has(key(...Object.values(tile(at(0, 0))))), 'the snowfield is on the far side of the water');
  assert.ok(!seen.has(key(...Object.values(tile(at(0, 11))))), 'the ford itself is water (a wall)');
  const far = { [K1]: at(0, 31) };
  const e1 = r.castCharm(K1, 0, far); assert.ok(e1); assert.equal(e1.ford, false); assert.equal(r.update(0.1, far), null); assert.equal(r.section, 1); assert.equal(r.obj.n, 0);
  r.members[K1].charmReady = 0;
  const edge = { [K1]: at(0, 15 + 1) };       // 2 u from the water's near edge (z 14)
  assert.ok(rectDistance(edge[K1], { x: O.x + ford.x, z: O.z + ford.z, w: ford.w, d: ford.d }) <= CHARM.frostNova.water);
  const e2 = r.castCharm(K1, 0, edge); assert.equal(e2.ford, true);
  assert.equal(r.update(0.1, edge), 'section'); assert.equal(r.section, 2); assert.equal(r.g.isOpen('ford-gate'), true);
  assert.ok(flood(r.g, tile(spot(1))).has(key(...Object.values(tile(at(0, 0))))), 'the ice bridge joins the banks');
  assert.ok(r.effects.some((fx) => fx.kind === 'ford'), 'the bridge announces itself');
  assert.equal(r.update(0.1, edge), null, 'and it stays: nothing re-closes it');
  reset();
});
test('freezing from too far away misses the water (3.4 u from its edge is the limit); the objective text and the edge arrow point at it', () => {
  const r = start(1); r.giveCharm(K1, 'frost-nova');
  const ford = r.obj.target;
  const justOut = { x: ford.x, z: ford.z + ford.d / 2 + CHARM.frostNova.water + 0.3 }, justIn = { x: ford.x, z: ford.z + ford.d / 2 + CHARM.frostNova.water - 0.3 };
  assert.equal(r.freezeWater(justOut), false); assert.equal(r.obj.frozen, false);
  assert.equal(r.freezeWater(justIn), true);
  const fresh = start(1); const t = objectiveTargets(fresh.obj, fresh.enemies); assert.deepEqual(t.map((q) => q.label), ['Water']);
  assert.equal(objectiveText(fresh.obj).count, '0 / 1'); assert.equal(objectiveText(fresh.obj).label, 'Freeze the water with Frost Nova');
  reset();
});
test('Frost Nova: a 3.2 u ring that damages a little, freezes for 2.2 s, chills bosses, has a 9 s cooldown and needs line of sight', () => {
  const r = start(2, [K1]); r.giveCharm(K1, 'frost-nova');
  const p = at(0, 2); const near = make('puff', 0, 0, { id: 1 }), far = make('puff', 0, -3, { id: 2 }), boss = make('golem', 2, 2, { id: 3, boss: true }), cap = make('frostcap', -2, 2, { id: 4 });
  r.enemies = [near, far, boss, cap];
  near.wind = 0.5; invulnerable(r);
  const ev = r.castCharm(K1, 0, { [K1]: p });
  assert.equal(ev.charm, 'frost-nova'); assert.equal(ev.radius, CHARM.frostNova.radius);
  assert.deepEqual(ev.frozen.sort(), [1, 3, 4]); assert.ok(!ev.hits.includes(2), 'outside the ring');
  assert.equal(near.hp, ENEMY_KINDS.puff.hp - CHARM.frostNova.damage);
  assert.ok(Math.abs(near.frozen - (r.time + CHARM.frostNova.freeze)) < 1e-9); assert.equal(near.wind, 0, 'a freeze interrupts the wind-up');
  assert.ok(Math.abs(boss.frozen - (r.time + CHARM.frostNova.bossFreeze)) < 1e-9, 'bosses freeze for less'); assert.ok(boss.chilled > r.time, 'and are chilled'); assert.ok(cap.chilled > r.time, 'mini-bosses too');
  assert.equal(far.frozen, undefined);
  assert.equal(r.castCharm(K1, 0, { [K1]: p }), null, 'on cooldown'); r.update(CHARM.frostNova.cooldown - 0.5, { [K1]: p }); assert.equal(r.castCharm(K1, 0, { [K1]: p }), null);
  r.update(0.6, { [K1]: p }); assert.ok(r.castCharm(K1, 0, { [K1]: p }), 'ready again after 9 s');
  assert.equal(CHARMS['frost-nova'].cooldown, CHARM.frostNova.cooldown); assert.equal(CHARMS['frost-nova'].icon, 'charm-frost-nova');
  reset();
});
test('a frozen guardian cannot move or attack until the freeze ends; a chilled one is slower', () => {
  const r = start(2), p = at(0, -4), pos = { [K1]: p }; invulnerable(r);
  const e = lone(r, make('puff', 0, -10, { id: 1 })); r.giveCharm(K1, 'frost-nova'); r.members[K1].charmReady = 0;
  e.frozen = r.time + 2; const x0 = e.x, z0 = e.z;
  r.update(1.9, pos); assert.equal(e.x, x0); assert.equal(e.z, z0); assert.equal(e.wind, 0);
  r.update(2, pos); assert.ok(Math.hypot(e.x - x0, e.z - z0) > 0.5 || e.wind > 0, 'it wakes up and acts');
  const slow = make('puff', -2, -11.5, { id: 2, chilled: r.time + 9 }), fast = make('puff', 2, -11.5, { id: 3 }), s0 = { x: slow.x, z: slow.z }, f0 = { x: fast.x, z: fast.z };
  r.enemies = [slow, fast]; r.update(1, pos); const moved = (e, o) => Math.hypot(e.x - o.x, e.z - o.z);
  assert.ok(moved(fast, f0) > 0.5 && moved(slow, s0) < moved(fast, f0) * 0.7, 'chilled moves less');
  reset();
});
test('a Frost Nova on ice blocks and practice dummies is harmless; blocks are never frozen', () => {
  const r = start(2); r.giveCharm(K1, 'frost-nova'); invulnerable(r);
  const block = make('hareblock', 0, 0, { id: 1, block: true }); r.enemies = [block];
  const ev = r.castCharm(K1, 0, { [K1]: at(0, 1) }); assert.deepEqual(ev.frozen, []); assert.equal(block.hp, ENEMY_KINDS.hareblock.hp - 1, 'but it is a hit: the nova cracks it');
  reset();
});

// ---------------------------------------------------------------------------------------------
// shatter
// ---------------------------------------------------------------------------------------------
test('shatter: a charged hit or a special on a frozen guardian does x1.8 and ends the freeze; a tap does not', () => {
  const r = start(2), p = at(0, 2); r.members[K1].bloom = 3;
  const hit = (move, extra = {}) => { const e = make('puff', 0, 0, { id: 1, frozen: r.time + 2 }); r.enemies = [e]; const dealt = r.hitEnemy(K1, e, 20, 0.2, p, 0.6, { move, ...extra }); return { e, dealt }; };
  const tap = hit('tap'); assert.equal(tap.dealt, 20); assert.ok(tap.e.frozen > r.time, 'a tap leaves the ice on');
  for (const move of ['charged', 'special']) {
    const s = hit(move); assert.equal(s.dealt, Math.round(20 * COMBAT.frost.shatter)); assert.equal(s.e.frozen, 0, `${move} breaks the freeze`);
    assert.ok(r.effects.some((fx) => fx.kind === 'freeze' && fx.type === 'shatter')); assert.ok(r.effects.some((fx) => fx.kind === 'practice' && fx.text === 'Shatter!'));
  }
  const plain = make('puff', 0, 0, { id: 2 }); r.enemies = [plain]; assert.equal(r.hitEnemy(K1, plain, 20, 0.2, p, 0.6, { move: 'charged' }), 20, 'no freeze, no bonus');
  const charm = hit('charm'); assert.equal(charm.dealt, 20, 'a charm is not a shatter');
  reset();
});
test('shatter with real weapons: the sword\'s spin and the dash-stab shatter a frozen puff, a tap does not', () => {
  const r = start(2), p = at(0, 2); invulnerable(r);
  const e = lone(r, make('puff', 0, 0, { id: 1, hp: 400, max: 400, frozen: r.time + 50 }));
  swing(r, K1, 'sword', e, p); assert.ok(e.frozen > r.time, 'a tap');
  r.members[K1].ready = 0; const hp0 = e.hp; swing(r, K1, 'sword', e, p, { charged: true, wait: 1 });
  assert.equal(e.frozen, 0, 'the spin shatters'); assert.ok(hp0 - e.hp >= Math.round(26 * COMBAT.frost.shatter));
  e.frozen = r.time + 50; r.members[K1].ready = 0; r.members[K1].bloom = 1;
  const pos = { [K1]: p }; r.special(K1, 'sword', facing(p, e), pos); assert.equal(e.frozen, 0, 'so does the dash-stab');
  reset();
});
test('the frostcap\'s cap is armor: shattered (or hammered) it cracks and the cap breaks off; other hits are reduced but still win', () => {
  const r = start(3), p = at(0, -80), cap = () => { const e = make('frostcap', 0, -82, { id: 1 }); r.enemies = [e]; return e; };
  let e = cap(); assert.equal(r.hitEnemy(K1, e, 20, 0.5, p, 0.6, { move: 'tap' }), Math.max(1, Math.round(20 * ENEMY_KINDS.frostcap.armor))); assert.ok(!e.cracked);
  e = cap(); e.frozen = r.time + 2; r.hitEnemy(K1, e, 20, 0.5, p, 0.6, { move: 'charged' }); assert.equal(e.cracked, true, 'shatter cracks it'); assert.equal(e.frozen, 0);
  e = cap(); r.hitEnemy(K1, e, 20, 0.5, p, 0.6, { move: 'charged', armorBreak: true }); assert.equal(e.cracked, true, 'the hammer / axe chop cracks it too');
  e = cap(); for (let i = 0; i < 40 && e.hp > 0; i++) r.hitEnemy(K1, e, 17, 0.1, p, 0.6, { move: 'tap' }); assert.ok(e.hp <= 0, 'a sword alone wins slowly');
  reset();
});

// ---------------------------------------------------------------------------------------------
// the slingshot
// ---------------------------------------------------------------------------------------------
const shoot = (r, p, target, { charged = false, big = false, special = false, seconds = 1.5 } = {}) => {
  const pos = { [K1]: p }; r.members[K1].ready = 0; const f = facing(p, target);
  if (special) r.special(K1, 'slingshot', f, pos, big); else r.attack(K1, 'slingshot', f, pos, charged);
  r.update(seconds, pos);
};
test('slingshot: a tap fires one pebble that hits the first guardian for light damage', () => {
  assert.ok(WEAPONS.slingshot.ranged && WEAPONS.slingshot.damage[0] < WEAPONS.sword.damage[0]);
  const r = start(2), p = at(0, 2); invulnerable(r);
  const a = make('puff', 0, -3, { id: 1 }), b = make('puff', 0, -6, { id: 2 }); r.enemies = [a, b];
  shoot(r, p, a); assert.equal(a.hp, ENEMY_KINDS.puff.hp - WEAPONS.slingshot.damage[0]); assert.equal(b.hp, ENEMY_KINDS.puff.hp, 'the pebble stopped at the first');
  assert.equal(r.pprojectiles.length, 0);
  reset();
});
test('slingshot: the pebble flies about 9 u, no further; the piercing shot reaches 11 u; walls stop both', () => {
  const r = start(2), p = at(0, 2); invulnerable(r);
  const inReach = make('puff', 0, -6, { id: 1 }), tooFar = make('puff', 0, -8.5, { id: 2, x: p.x, z: p.z - 12.5 });   // 8 u / 12.5 u from the shooter
  r.enemies = [inReach]; shoot(r, p, { x: p.x, z: p.z - 8 }); assert.ok(inReach.hp < inReach.max, '8 u is in range');
  r.enemies = [tooFar]; shoot(r, p, { x: p.x, z: p.z - 12.5 }); assert.equal(tooFar.hp, tooFar.max, '12.5 u is out of range');
  const mid = make('puff', 0, 0, { id: 3, x: p.x, z: p.z - 10.6 }); r.enemies = [mid]; shoot(r, p, mid); assert.equal(mid.hp, mid.max, 'a tap\'s 9 u does not reach 10 u');
  shoot(r, p, mid, { charged: true }); assert.ok(mid.hp < mid.max, 'the charged shot does');
  // a wall: the mouth's stair gate is shut in section 0, so a target behind it cannot be hit
  const w = start(0), q = at(0, 44.5); invulnerable(w);
  const behind = make('puff', 0, 38.6, { id: 4 }); w.enemies = [behind]; shoot(w, q, behind); assert.equal(behind.hp, behind.max, 'the shut gate is a wall for pebbles');
  assert.equal(w.pprojectiles.length, 0, 'and the pebble is gone');
  reset();
});
test('slingshot: the charged shot pierces a whole line; the special is a 5 pellet fan (7 with a full meter) that needs Bloom', () => {
  const r = start(2), p = at(0, 2); invulnerable(r);
  const line = [-2, -4, -6].map((z, i) => make('puff', 0, z, { id: i + 1, hp: 200, max: 200 })); r.enemies = line;
  shoot(r, p, line[0], { charged: true }); for (const e of line) assert.equal(e.hp, 200 - WEAPONS.slingshot.charged.damage, 'every guardian in the line is hit');
  assert.equal(r.special(K1, 'slingshot', 0, { [K1]: p }), null, 'no Bloom, no special');
  r.members[K1].bloom = 1; r.members[K1].ready = 0; const ev = r.special(K1, 'slingshot', 0, { [K1]: p });
  assert.equal(ev.pellets, 5); assert.equal(r.pprojectiles.length, 5); assert.equal(r.members[K1].bloom, 0);
  const yaws = r.pprojectiles.map((b) => Math.atan2(b.dx, b.dz)); assert.ok(Math.max(...yaws) - Math.min(...yaws) > 0.8, 'a fan'); r.pprojectiles = [];
  r.members[K1].bloom = 3; r.members[K1].ready = 0; assert.equal(r.special(K1, 'slingshot', 0, { [K1]: p }, true).pellets, 7);
  reset();
});
test('slingshot pebbles crack ice blocks, hit hovering bats and pop thrown snowballs', () => {
  const r = start(2), p = at(0, 2); invulnerable(r);
  const block = make('chickblock', 0, -4, { id: 1, block: true }), bat = make('bat', 2, -5, { id: 2 }); r.enemies = [block];
  shoot(r, p, block); assert.equal(block.hp, ENEMY_KINDS.chickblock.hp - 1);
  r.enemies = [bat]; shoot(r, p, bat); assert.ok(bat.hp < bat.max, 'a hovering bat is hit by a pebble');
  r.enemies = []; r.projectiles.push({ id: 99, kind: 'snowball', enemy: 1, x: p.x, z: p.z - 4, vx: 0, vz: 0, age: 0, radius: 0, hitKeys: [], damage: 20, bounces: 0 });
  shoot(r, p, { x: p.x, z: p.z - 5 }, { seconds: 0.5 }); assert.equal(r.projectiles.length, 0, 'popped');
  reset();
});
test('the Armory and the racks: the slingshot is in Glimmerfrost\'s own supply and Wildroot\'s once learned', () => {
  assert.deepEqual(supplyKinds(AREAS.wildroot, ['sword', 'axe', 'hammer']), ['sword', 'axe', 'hammer']);
  assert.deepEqual(supplyKinds(AREAS.wildroot, ['sword', 'axe', 'hammer', 'slingshot']), ['sword', 'axe', 'hammer', 'slingshot']);
  assert.ok(supplyKinds(A, ['sword', 'axe', 'hammer']).includes('slingshot'), 'always in Glimmerfrost');
  assert.deepEqual(A.supply.kinds, ['sword', 'axe', 'hammer', 'slingshot']);
});

// ---------------------------------------------------------------------------------------------
// flyers
// ---------------------------------------------------------------------------------------------
test('a hovering icicle bat is out of melee reach, but a dive, a stun, a freeze or the low moment after a dive expose it', () => {
  const r = start(2), p = at(0, 2); invulnerable(r);
  const bat = lone(r, make('bat', 0, 0.5, { id: 1, hp: 500, max: 500 }));
  assert.equal(r.exposed(bat), false);
  swing(r, K1, 'sword', bat, p); assert.equal(bat.hp, 500, 'a sword tap passes under a hovering bat'); assert.ok(r.effects.some((fx) => fx.kind === 'practice' && fx.text === 'Too high!'));
  swing(r, K1, 'axe', bat, p, { charged: true }); assert.equal(bat.hp, 500, 'so does a charged chop');
  bat.wind = 0.5; assert.equal(r.exposed(bat), true, 'winding up for a dive'); bat.wind = 0;
  bat.low = r.time + 1; assert.equal(r.exposed(bat), true, 'low after the dive'); assert.ok(r.hitEnemy(K1, bat, 10, 0.2, p) > 0); bat.low = 0;
  bat.frozen = r.time + 1; assert.equal(r.exposed(bat), true, 'a frozen bat falls'); bat.frozen = 0;
  bat.stun = 0.5; assert.equal(r.exposed(bat), true, 'a stunned bat'); bat.stun = 0;
  reset();
});
test('no guardian is immune to any weapon: ranged things hit a hovering bat, melee hits it while exposed', () => {
  const p = at(0, 2);
  const fresh = () => { const r = start(2); invulnerable(r); r.members[K1].bloom = 3; r.members[K1].charm = null; const bat = lone(r, make('bat', 0, 0, { id: 1, hp: 900, max: 900 })); return { r, bat }; };
  // ranged: the slingshot (tap, charged, special), the hammer's shockwave, the axe's boomerang, both charms
  { const { r, bat } = fresh(); shoot(r, p, bat); assert.ok(bat.hp < 900, 'slingshot tap'); }
  { const { r, bat } = fresh(); shoot(r, p, bat, { charged: true }); assert.ok(bat.hp < 900, 'slingshot charged'); }
  { const { r, bat } = fresh(); shoot(r, p, bat, { special: true }); assert.ok(bat.hp < 900, 'seed scatter'); }
  { const { r, bat } = fresh(); r.special(K1, 'hammer', facing(p, bat), { [K1]: p }); assert.ok(bat.hp < 900, 'hammer shockwave'); }
  { const { r, bat } = fresh(); r.special(K1, 'axe', facing(p, bat), { [K1]: p }); r.update(1, { [K1]: p }); assert.ok(bat.hp < 900, 'axe boomerang'); }
  for (const charm of ['spark', 'frost-nova']) { const { r, bat } = fresh(); r.giveCharm(K1, charm); r.castCharm(K1, 0, { [K1]: p }); assert.ok(bat.hp < 900, charm); if (charm === 'frost-nova') assert.ok(r.isFrozen(bat)); }
  // melee while it dives: the sword's tap / spin / dash-stab, the axe, the hammer
  for (const [weapon, charged] of [['sword', false], ['sword', true], ['axe', false], ['axe', true], ['hammer', false], ['hammer', true]]) {
    const { r, bat } = fresh(); bat.low = r.time + 9; swing(r, K1, weapon, bat, p, { charged }); assert.ok(bat.hp < 900, `${weapon}${charged ? ' charged' : ''} while it dives`);
  }
  { const { r, bat } = fresh(); bat.low = r.time + 9; r.special(K1, 'sword', facing(p, bat), { [K1]: p }); assert.ok(bat.hp < 900, 'dash-stab while it dives'); }
});
test('the bat winds up, dives like a rider and is low afterwards; it hovers at a distance instead of closing in', () => {
  const r = start(2), p = at(0, -4), pos = { [K1]: p };
  const bat = lone(r, make('bat', 0, -9, { id: 1 })); assert.equal(guardianAttack('bat', 4), 'dive'); assert.equal(GUARDIAN_ATTACKS.dive.range, 6.5);
  let dove = false;
  for (let i = 0; i < 80 && !dove; i++) { r.update(0.1, pos); if (r.projectiles.some((a) => a.kind === 'dive')) dove = true; invulnerable(r); }
  assert.ok(dove, 'it dove'); assert.ok(bat.low > r.time - 1, 'and is low afterwards'); assert.equal(GROUND_ATTACKS.has('dive'), false, 'a dive is not a ground attack: a hop does not clear it');
  const m = r.members[K1]; m.invulnerable = 0; m.dodge = { at: r.time, air: COMBAT.dodge.air, inv: COMBAT.dodge.inv, perfect: false };
  assert.equal(avoidance(m, 'dive', r.time + 0.3), null, 'airborne after the i-frames: still hit');
  reset();
});

// ---------------------------------------------------------------------------------------------
// the rescue objective
// ---------------------------------------------------------------------------------------------
test('rescue: a block cracks on every hit from any weapon or charm and breaks after four; the freed friend counts', () => {
  const r = start(2), p = at(0, 2); invulnerable(r);
  const blocks = r.enemies.filter((e) => e.block); assert.equal(blocks.length, 4); assert.equal(r.obj.type, 'rescue'); assert.equal(r.obj.total, 4);
  for (const b of blocks) { assert.equal(b.hp, COMBAT.rescue.hits); assert.equal(b.max, COMBAT.rescue.hits, 'never party-scaled'); }
  const [b1, b2, b3, b4] = blocks;
  // one hit of each kind of source on the first block
  r.members[K1].bloom = 3; r.giveCharm(K1, 'spark');
  b1.x = p.x; b1.z = p.z - 1.5;
  swing(r, K1, 'sword', b1, p); assert.equal(b1.hp, 3, 'a sword tap');
  swing(r, K1, 'hammer', b1, p); assert.equal(b1.hp, 2, 'a hammer slam');
  shoot(r, p, b1); assert.equal(b1.hp, 1, 'a pebble');
  r.castCharm(K1, 0, { [K1]: p }); assert.equal(b1.hp, 0, 'a charm');
  r.update(0.1, { [K1]: p }); assert.equal(r.obj.n, 1); assert.equal(r.obj.freed.length, 1); assert.equal(r.obj.freed[0].friend, ENEMY_KINDS[b1.kind].friend);
  assert.equal(objectiveText(r.obj).count, '1 / 4'); assert.ok(r.effects.some((fx) => fx.kind === 'friend'));
  // a tap does one crack no matter how hard the weapon hits (an axe chop = 1, not 58)
  b2.x = p.x; b2.z = p.z - 1.5; swing(r, K1, 'axe', b2, p, { charged: true }); assert.equal(b2.hp, 3, 'a charged chop is one crack, not a smash');
  assert.deepEqual(objectiveTargets(r.obj, r.enemies).map((q) => q.label), ['Ice block', 'Ice block', 'Ice block']);
  for (const b of [b2, b3, b4]) while (b.hp > 0) r.hitEnemy(K1, b, 99, 0, p);
  r.update(0.1, { [K1]: p }); assert.equal(r.obj.n, 4); assert.equal(r.obj.complete, false, 'the last friend is still hopping to the exit');
  assert.equal(r.update(COMBAT.rescue.hop + 0.1, { [K1]: p }), 'section'); assert.equal(r.section, 3);
  reset();
});
test('rescue: a wipe resets the current section\'s blocks; a snapshot round-trips the freed friends', () => {
  const r = start(2, [K1, K2]), p = at(0, 2), pos = { [K1]: p, [K2]: at(1.8, 2) };
  const b = r.enemies.find((e) => e.block); while (b.hp > 0) r.hitEnemy(K1, b, 9, 0, p); r.update(0.1, pos);
  assert.equal(r.obj.freed.length, 1);
  const copy = new DungeonRun(); copy.load(JSON.parse(JSON.stringify(r.snapshot()))); assert.deepEqual(copy.obj, r.obj); assert.equal(copy.enemies.filter((e) => e.block && e.hp <= 0).length, 1);
  for (const m of Object.values(r.members)) m.downed = true; assert.equal(r.checkWipe(), true);
  assert.equal(r.section, 2, 'a wipe stays in the section'); assert.equal(r.obj.freed.length, 0); assert.equal(r.obj.n, 0);
  assert.ok(r.enemies.filter((e) => e.block).every((e) => e.hp === COMBAT.rescue.hits), 'every block is whole again');
  reset();
});
test('rescue: blocks do not count as combat, do not attack and are not on the clear list', () => {
  const r = start(2), p = at(0, 2);
  assert.equal(r.inCombat(K1, { [K1]: at(-10, -8.5) }), true, 'the puffs and bats are near the first block');
  const only = start(2); only.enemies = only.enemies.filter((e) => e.block); only.members[K1].combatUntil = 0;
  assert.equal(only.inCombat(K1, { [K1]: at(-10, -6) }), false, 'ice blocks alone are not combat');
  const before = only.enemies.map((e) => [e.x, e.z]); only.update(2, { [K1]: at(-10, -6) }); assert.deepEqual(only.enemies.map((e) => [e.x, e.z]), before, 'they sit still'); assert.equal(only.members[K1].hp, 100);
  reset();
});

// ---------------------------------------------------------------------------------------------
// falling icicles
// ---------------------------------------------------------------------------------------------
test('icicles are telegraphed, fall from above (a hop does not clear them, the i-frames do) and only hit what stays inside the circle', () => {
  const r = start(3), room = at(0, -46), pos = { [K1]: room }; r.enemies = []; r.obj.complete = true;           // (an empty clear list would finish the section at once)
  assert.equal(GROUND_ATTACKS.has('icicle'), false);
  r.update(3.1, pos); r.update(0.1, pos);
  assert.equal(r.hazards.length, 1, 'one is falling'); const h = r.hazards[0];
  assert.ok(h.at - r.time > 0.5 && h.at - r.time <= COMBAT.icicle.delay, 'with a visible countdown'); assert.equal(h.radius, COMBAT.icicle.radius);
  // staying put: hit
  const m = r.members[K1]; m.invulnerable = 0; r.update(COMBAT.icicle.delay + 0.2, { [K1]: { x: h.x, z: h.z } });
  assert.equal(m.hp, 100 - COMBAT.icicle.damage, 'standing in the circle hurts');
  // a dodge-hop (airborne, no i-frames left) is still hit
  const m2 = r.members[K1]; m2.hp = 100; m2.invulnerable = 0; m2.dodge = { at: r.time - 0.25, air: COMBAT.dodge.air, inv: COMBAT.dodge.inv, perfect: true };
  assert.equal(avoidance(m2, 'icicle', r.time), null, 'airborne is not enough'); m2.dodge.at = r.time - 0.05; assert.equal(avoidance(m2, 'icicle', r.time).why, 'dodge', 'the i-frames are');
  // stepping out: safe
  r.hazards = [{ id: 77, x: room.x, z: room.z, at: r.time + 0.5, radius: COMBAT.icicle.radius }]; r.hazardNext = r.time + 99; m2.dodge = null; m2.hp = 100;
  r.update(0.8, { [K1]: { x: room.x + 4, z: room.z } }); assert.equal(m2.hp, 100, 'out of the circle'); assert.equal(r.hazards.length, 0);
  reset();
});
test('icicles only fall in the gauntlet\'s rooms, never on a safe shrine, are capped and reset with the section', () => {
  const r = start(3), shrine = at(0, -39); r.enemies = []; r.obj.complete = true;
  r.update(5, { [K1]: shrine }); assert.equal(r.hazards.length, 0, 'the checkpoint shrine is safe');
  const roomA = at(0, -46); let most = 0; for (let i = 0; i < 80; i++) { invulnerable(r); r.update(0.25, { [K1]: roomA }); most = Math.max(most, r.hazards.length); }
  assert.ok(most >= 1 && most <= COMBAT.icicle.max, `at most ${COMBAT.icicle.max} at once (${most})`);
  const corridor = start(3); corridor.enemies = []; corridor.obj.complete = true; corridor.update(8, { [K1]: at(0, -53) }); assert.equal(corridor.hazards.length, 0, 'corridors are not in a zone');
  for (const m of Object.values(r.members)) m.downed = true; r.checkWipe(); assert.equal(r.hazards.length, 0, 'a wipe clears them');
  assert.equal(start(2).hazards.length, 0);
  reset();
});

// ---------------------------------------------------------------------------------------------
// the Snow Golem
// ---------------------------------------------------------------------------------------------
test('the Snow Golem: snowballs from afar, a ground quake up close, phase 2 at half health calls puffs and grows ice armor', () => {
  assert.equal(guardianAttack('golem', 8), 'snowball'); assert.equal(guardianAttack('golem', 3), 'quake');
  assert.equal(guardianAttack('golem', 3, { phase2: true, attacks: 1 }), 'snowball', 'phase 2 alternates'); assert.equal(guardianAttack('golem', 3, { phase2: true, attacks: 2 }), 'quake');
  assert.equal(GROUND_ATTACKS.has('quake'), true, 'the quake is a ground ring a hop clears'); assert.equal(GROUND_ATTACKS.has('snowball'), false);
  const r = start(4), boss = r.enemies[0], p = at(0, -98); invulnerable(r);
  assert.ok(boss.boss && boss.hp === Math.round(ENEMY_KINDS.golem.hp)); assert.ok(!boss.iceArmor);
  boss.hp = Math.floor(boss.max * 0.5); r.hitEnemy(K1, boss, 1, 0.1, p);
  assert.equal(boss.phase2, true); assert.equal(boss.iceArmor, true); assert.equal(r.enemies.filter((e) => e.kind === 'puff').length, 2, 'two puffs join');
  assert.ok(r.notes.some((n) => n.type === 'phase' && n.kind === 'golem'));
  const hp0 = boss.hp; const dealt = r.hitEnemy(K1, boss, 40, 0.3, p, 0.6, { move: 'tap' });
  assert.equal(dealt, Math.round(40 * COMBAT.frost.iceArmor), 'ice armor takes a third'); assert.ok(dealt > 0 && boss.hp === hp0 - dealt, 'but ordinary hits still count');
  reset();
});
test('ice armor cracks to a shatter (frozen + charged / special) or the hammer, and then takes full damage', () => {
  const crack = (how) => {
    const r = start(4), boss = r.enemies[0], p = at(0, -98); boss.hp = Math.floor(boss.max * 0.49); r.hitEnemy(K1, boss, 0, 0, p); assert.equal(boss.iceArmor, true);
    how(r, boss, p); return { r, boss };
  };
  { const { boss } = crack((r, b, p) => { r.giveCharm(K1, 'frost-nova'); r.castCharm(K1, 0, { [K1]: { x: b.x, z: b.z + 2 } }); assert.ok(r.isFrozen(b)); r.hitEnemy(K1, b, 30, 0.3, p, 0.6, { move: 'charged' }); }); assert.equal(boss.iceArmor, false, 'shattered'); assert.equal(boss.cracked, true); }
  { const { boss } = crack((r, b, p) => { r.hitEnemy(K1, b, 64, 1, p, 0.6, { move: 'charged', armorBreak: true }); }); assert.equal(boss.iceArmor, false, 'the hammer pound'); }
  { const { r, boss } = crack(() => {}); const hp = boss.hp; r.hitEnemy(K1, boss, 30, 0.3, at(0, -98), 0.6, { move: 'tap' }); assert.equal(hp - boss.hp, Math.round(30 * COMBAT.frost.iceArmor), 'a tap alone stays slow'); }
  { const { r, boss } = crack((r2, b, p) => { r2.hitEnemy(K1, b, 64, 1, p, 0.6, { move: 'charged', armorBreak: true }); }); const hp = boss.hp; r.hitEnemy(K1, boss, 30, 0.3, at(0, -98), 0.6, { move: 'tap' }); assert.equal(hp - boss.hp, 30, 'after the crack, full damage'); }
  reset();
});
test('a thrown snowball is a seed-like missile that hits a standing player and passes through a perfect dodger; the quake is a ring', () => {
  const r = start(4), boss = r.enemies[0], p = at(0, -104), pos = { [K1]: p }; boss.x = p.x; boss.z = p.z - 7.5; boss.facing = Math.PI;
  boss.attackKind = 'snowball'; boss.aim = { x: p.x, z: p.z }; boss.wind = 0.01; r.members[K1].invulnerable = 0; r.update(0.05, pos);
  assert.ok(r.projectiles.some((a) => a.kind === 'snowball'), 'thrown');
  let hurt = false; for (let i = 0; i < 40 && !hurt; i++) { r.update(0.05, pos); hurt = r.members[K1].hp < 100; boss.cooldown = 99; boss.wind = 0; }
  assert.ok(hurt, 'it hit');
  reset();
});

// ---------------------------------------------------------------------------------------------
// the Armory and a full clear
// ---------------------------------------------------------------------------------------------
test('clearing Glimmerfrost teaches the Armory the slingshot and Frost Nova; Wildroot\'s racks then offer them', () => {
  const fresh = normaliseCombat(null); assert.deepEqual(fresh.armory, { weapons: ['sword', 'axe', 'hammer'], charms: [] });
  const done = markCleared(fresh, 'glimmerfrost'); assert.equal(done.cleared.glimmerfrost.wild, true);
  assert.deepEqual(done.armory.weapons, ['sword', 'axe', 'hammer', 'slingshot']); assert.deepEqual(done.armory.charms, ['frost-nova']);
  assert.deepEqual(fresh.armory.charms, [], 'the old state is untouched');
  assert.deepEqual(rackPedestals(AREAS.wildroot, fresh.armory.charms), []);
  const rack = rackPedestals(AREAS.wildroot, done.armory.charms); assert.equal(rack.length, 1); assert.equal(rack[0].charm, 'frost-nova'); assert.equal(rack[0].rack, true);
  assert.ok(supplyKinds(AREAS.wildroot, done.armory.weapons).includes('slingshot') && !supplyKinds(AREAS.wildroot, fresh.armory.weapons).includes('slingshot'));
  const glim = rackPedestals(A, done.armory.charms); assert.equal(glim.length, 1, 'and Glimmerfrost\'s own rack');
  assert.deepEqual(mergeArmory(done.armory, AREAS.wildroot.armory), done.armory, 'merging again changes nothing');
  assert.equal(areaPedestals(A).length, 4, 'four Frost Nova pedestals before the ford: one for each friend'); assert.ok(areaPedestals(A).every((q) => q.charm === 'frost-nova' && q.section === 1));
  const r = start(1); const ped = r.pedestals.find((q) => !q.rack);
  assert.ok(r.swapCharm(K1, ped.id, { [K1]: { x: ped.x, z: ped.z + 1 } })); assert.equal(r.members[K1].charm, 'frost-nova');
});

function defeat(r, id, e, log) {
  for (let guard = 0; guard < 900 && e.hp > 0; guard++) {
    const f = Number.isFinite(e.facing) ? e.facing : 0;
    let p = null;                                       // (a spot 2 u from it, behind it if possible, that is on clear floor in its sight)
    for (let k = 0; k < 8 && !p; k++) { const a = f + Math.PI + k * Math.PI / 4, c = { x: e.x + Math.sin(a) * 2, z: e.z + Math.cos(a) * 2 }; if (r.g.inArea(c.x, c.z, 0.45) && r.g.sight(c, e)) p = c; }
    const pos = { ...Object.fromEntries(Object.keys(r.members).map((k) => [k, r.members[k].home || p])), [id]: p };
    invulnerable(r); r.members[id].ready = Math.min(r.members[id].ready, r.time);
    const big = ENEMY_KINDS[e.kind].boss || ENEMY_KINDS[e.kind].mini || ENEMY_KINDS[e.kind].armor;
    r.attack(id, big ? 'hammer' : 'slingshot', facing(p, e), pos, true); r.update(0.7, pos); r.update(0.7, pos);
    log.swings++;
  }
  assert.ok(e.hp <= 0, `${e.kind} defeated at ${(e.x - O.x).toFixed(1)},${(e.z - O.z).toFixed(1)} hp ${e.hp} (in area ${r.g.inArea(e.x, e.z)})`);
}
function clearArea(keys) {
  const r = start(0, keys), K = keys[0], log = { swings: 0, sections: [] }, rest = Object.fromEntries(keys.map((k, i) => [k, spot(0, i)]));
  const step = (pos, dt = 0.1) => { const out = r.update(dt, pos); if (out) log.sections.push([r.section, out]); return out; };
  for (const k of keys) r.members[k].home = null;
  // 0 the Ice Mouth: the grace period opens it
  step(rest, 30.5); assert.equal(r.section, 1);
  // 1 the Frozen Ford: pick up a Frost Nova, kill the puffs, freeze the water
  const ped = r.pedestals.find((q) => !q.rack); assert.ok(r.swapCharm(K, ped.id, { [K]: { x: ped.x, z: ped.z + 1 } }));
  for (const e of [...r.enemies]) defeat(r, K, e, log);
  const edge = at(0, 16); invulnerable(r); const ev = r.castCharm(K, 0, { [K]: edge }); assert.equal(ev.ford, true); step({ [K]: edge }); assert.equal(r.section, 2);
  // 2 the Snowfield: crack the four blocks (the guardians may be ignored), wait for the friends to arrive
  for (const b of r.enemies.filter((e) => e.block)) { invulnerable(r); while (b.hp > 0) r.hitEnemy(K, b, 9, 0, spot(2)); }
  step({ [K]: spot(2) }, 0.1); assert.equal(r.obj.n, 4); step({ [K]: spot(2) }, COMBAT.rescue.hop + 0.2); assert.equal(r.section, 3);
  // 3 the Icicle Gauntlet: everything, the frostcap with the hammer
  for (const e of [...r.enemies]) defeat(r, K, e, log);
  step({ [K]: spot(3) }, 0.1); assert.equal(r.section, 4);
  const boss = r.enemies.find((e) => e.boss); let phase2 = false, result = null, armored = false;
  for (let guard = 0; guard < 500 && !result; guard++) {
    const f = Number.isFinite(boss.facing) ? boss.facing : 0, p = { x: boss.x - Math.sin(f) * 2.4, z: boss.z - Math.cos(f) * 2.4 };
    invulnerable(r); r.members[K].ready = r.time; r.attack(K, 'hammer', facing(p, boss), { [K]: p }, true);
    result = step({ [K]: p }, 0.7); phase2 ||= !!boss.phase2; armored ||= !!boss.iceArmor; log.swings++;
    for (const e of r.enemies.filter((e) => e.kind === 'puff' && e.hp > 0)) e.hp = 0;     // (the phase-2 puffs are not the point of this script)
  }
  return { r, log, phase2, armored, result };
}
test('the whole cave can be cleared section by section and ends in cleared (1 and 3 players)', () => {
  for (const keys of [[K1], [K1, K2, K3]]) {
    const { r, phase2, armored, result } = clearArea(keys);
    assert.equal(result, 'cleared'); assert.equal(r.cleared, true); assert.ok(phase2, 'the golem went through its second phase'); assert.ok(armored, 'and wore ice armor');
    assert.equal(r.update(0.1, {}), null, 'cleared only once'); assert.equal(r.g.open.length, 4, 'every gate ended up open');
    reset();
  }
});
test('a snapshot mid-run round-trips (the section, the ford\'s gate, the objective, hazards, statuses)', () => {
  const r = start(3, [K1, K2]), pos = { [K1]: at(0, -46), [K2]: at(1.8, -46) }; r.enemies = [make('puff', 3, -48, { id: 1, frozen: 8.5 }), make('bat', 0, -44, { id: 2, low: 5 })];
  r.update(4.5, pos); assert.ok(r.hazards.length >= 1);
  const snap = JSON.parse(JSON.stringify(r.snapshot())), copy = new DungeonRun(); copy.load(snap);
  assert.equal(copy.areaId, 'glimmerfrost'); assert.equal(copy.section, 3); assert.equal(copy.g.open.length, 3); assert.equal(copy.hazards.length, r.hazards.length); assert.equal(copy.enemies[0].frozen, 8.5);
  assert.deepEqual(copy.snapshot(), snap);
  const f = start(1); f.giveCharm(K1, 'frost-nova'); f.castCharm(K1, 0, { [K1]: at(0, 16) }); f.update(0.1, { [K1]: at(0, 16) });
  const f2 = new DungeonRun(); f2.load(JSON.parse(JSON.stringify(f.snapshot()))); assert.equal(f2.section, 2); assert.equal(f2.g.isOpen('ford-gate'), true);
  reset();
});

// ---------------------------------------------------------------------------------------------
// pacing and awake counts
// ---------------------------------------------------------------------------------------------
/**
 * Seconds per section for a first-time party (the Wildroot test's model): walking at `run` u/s x `eff`, enemies at `dps` effective damage per second (a new player's misses, dodges and
 * stuns included) with the armor / hover multipliers, plus the objectives' own timers (the grace period, the ford, four blocks and their hop, the golem's phases).
 */
export function pacing({ run = 7, eff = 0.7, dps = 20, players = 1 } = {}) {
  const walk = (u) => u / (run * eff), scale = partyScale(players), team = 1 + 0.8 * (players - 1);
  const mult = { frostcap: 1 / 0.6, bat: 2.4, golem: 1.35, puff: 1 };            // (a hovering bat costs extra seconds for a sword user; the armored cap / phase-2 armor slow a sword)
  const hp = (list) => list.reduce((sum, [k]) => sum + (ENEMY_KINDS[k].practice || ENEMY_KINDS[k].block ? 0 : ENEMY_KINDS[k].hp * (mult[k] || 1)), 0) * scale;
  const fight = (list, overhead = 1.5) => hp(list) / (dps * team) * overhead;
  const S = A.sections, blocks = S[2].enemies.filter(([k]) => ENEMY_KINDS[k].block).length;
  const sections = {
    mouth: COMBAT.train.seconds + walk(24) + 10,                                         // (+10: choosing a weapon, reading its tip card)
    ford: walk(28) + fight(S[1].enemies) + 14 + 25,                                      // (+25: the charm's tip card, swapping at a pedestal, finding the right spot by the water)
    snowfield: walk(54) + fight(S[2].enemies) + blocks * (COMBAT.rescue.hits * 1.4 + 3) / Math.min(team, 2) + COMBAT.rescue.hop + 15,
    gauntlet: walk(62) + fight(S[3].enemies, 1.9) + 30 + 3 * 10,
    glacier: walk(14) + fight(S[4].enemies, 2.1) + fight(S[4].phase2.adds) + 25,
  };
  return { sections, total: Object.values(sections).reduce((a, b) => a + b, 0) };
}
test('pacing estimate: a first-time party of one or two clears Glimmerfrost in about six to eight minutes', () => {
  for (const players of [1, 2]) {
    const { sections, total } = pacing({ players });
    assert.ok(total >= 360 && total <= 480, `${players} player(s): ${(total / 60).toFixed(1)} min ${JSON.stringify(Object.fromEntries(Object.entries(sections).map(([k, v]) => [k, Math.round(v)])))}`);
    for (const [name, s] of Object.entries(sections)) assert.ok(s > 20 && s < 170, `${name} ${Math.round(s)} s`);
  }
});
test('at most four guardians are awake together in any spot (Wild mode); the opening lists are small and ice blocks are not guardians', () => {
  for (const [i, s] of A.sections.entries()) {
    const real = buildEnemies(s, 1, O).filter((e) => !ENEMY_KINDS[e.kind].practice && !ENEMY_KINDS[e.kind].block);
    for (const a of real) assert.ok(real.filter((b) => Math.hypot(a.x - b.x, a.z - b.z) < 14).length <= (i === 2 ? 5 : 4), `${s.id} near ${a.kind}`);
  }
  assert.ok(buildEnemies(A.sections[2], 1, O).filter((e) => !ENEMY_KINDS[e.kind].block).length <= 5, 'the snowfield\'s four guardians (+ at most one more for a big party)');
  const four = buildEnemies(A.sections[2], 4, O); assert.ok(four.filter((e) => e.block).length === 4, 'extra guardians never add blocks');
  assert.ok(A.sections[4].phase2.adds.length === 2);
});
test('party scaling: guardians scale with the roster, ice blocks never do', () => {
  const one = buildEnemies(A.sections[2], 1, O), three = buildEnemies(A.sections[2], 3, O);
  assert.equal(three.find((e) => e.kind === 'puff').max, Math.round(ENEMY_KINDS.puff.hp * partyScale(3)));
  assert.ok(three.filter((e) => e.block).every((e) => e.max === COMBAT.rescue.hits)); assert.ok(three.length >= one.length);
  const r = start(2, [K1]); r.join(K2); r.join(K3); assert.ok(r.enemies.filter((e) => e.block).every((e) => e.max === COMBAT.rescue.hits && e.hp === COMBAT.rescue.hits));
});
test('weapons: the slingshot is a full weapon entry (tap, charged, special, keys) and every enemy has a unique attack or is passive', () => {
  const w = WEAPONS.slingshot; assert.ok(w.charged.pierce); assert.ok(w.special.pellets > 3); for (const style of [w, w.charged, w.special]) { assert.equal(style.keys.length, 2); assert.ok(style.duration > 0); }
  for (const kind of ['puff', 'bat', 'frostcap', 'golem']) assert.ok(GUARDIAN_ATTACKS[guardianAttack(kind, 3)] || kind === 'golem', kind);
  assert.equal(guardianAttack('frostcap', 3), 'frostcone'); assert.equal(guardianAttack('puff', 3), 'tackle');
});

// ---------------------------------------------------------------------------------------------
// the cave mouth on Frostpine
// ---------------------------------------------------------------------------------------------
const island = ISLANDS.find((i) => i.id === 'frost'), mod = getIslandModule('frost');
test('the cave mouth stands on Frostpine\'s west lake bank, on gentle walkable ground clear of the camp, lanes, lake, landing, trees and every spot', () => {
  const P = buildFrostPlacement(island, mod), G = planFrostGathering(island, mod), C = planCritters(island, mod), c = CAVE_MOUTH, R = c.keepClear;
  assert.equal(c.id, 'glimmerfrost-mouth'); assert.ok(mod.walkable(c.x, c.z)); assert.ok(['grass', 'snow'].includes(mod.groundType(c.x, c.z)));
  assert.ok(mod.lakeDist(c.x, c.z) > LAKE_CLEAR + 5, 'on the bank, off the ice'); assert.ok(campDist(island, c.x, c.z) > 20, 'well away from the camp clearing');
  for (const [px, pz] of [[c.x, c.z], [c.front.x, c.front.z]]) assert.ok(Math.hypot(mod.height(px + 0.8, pz) - mod.height(px, pz), mod.height(px, pz + 0.8) - mod.height(px, pz)) / 0.8 < 0.5, 'flat enough');
  for (const l of frostLanes(island)) assert.ok(polyDist(l, c.x, c.z) > R + 2, 'off every lane and the trail');
  for (const t of [...P.trees, ...P.boulders, ...P.logs.map((l) => ({ ...l, r: 2 })), ...P.snowmen, ...P.spires, ...P.flowers.filter((f) => f.interactive).map((f) => ({ ...f, r: 0.3 }))]) assert.ok(Math.hypot(t.x - c.x, t.z - c.z) - (t.r || 0.5) > R, `nothing within ${R} u of the mouth`);
  for (const q of [...G.bushes, ...G.herbs, ...G.mushrooms, ...G.digs]) assert.ok(!caveMouthReserved(q.x, q.z), q.id);
  for (const cr of C) for (const q of [cr.spawn, ...cr.wander]) assert.ok(Math.hypot(q.x - c.x, q.z - c.z) > R + 1, `${cr.id} stays away`);
  assert.ok(!caveMouthReserved(c.x + R + 0.1, c.z) && caveMouthReserved(c.x + R - 0.1, c.z) && caveMouthReserved(c.x + R + 1, c.z, 2));
  assert.ok(P.solids.some((s) => s.x === c.x && s.z === c.z), 'claimed as a solid so later placements keep off it');
  assert.ok(sampleFrostSpots(island, mod, { area: 'anyGround', count: 60, seed: 5, r: 0.6, minDist: 3 }).every((q) => !caveMouthReserved(q.x, q.z)), 'respawned dig spots keep off it too');
});
test('Frostpine\'s seeded placement did not move: trees, boulders, flowers, tufts, logs, spires, reeds, snowmen, gathering spots and critters hash as before Step 59', () => {
  const P = buildFrostPlacement(island, mod), G = planFrostGathering(island, mod), C = planCritters(island, mod);
  const h = (o) => crypto.createHash('md5').update(JSON.stringify(o)).digest('hex').slice(0, 10);
  assert.deepEqual({ trees: h(P.trees), boulders: h(P.boulders), flowers: h(P.flowers), logs: h(P.logs), spires: h(P.spires), reeds: h(P.reeds), snowmen: h(P.snowmen), G: h(G), C: h(C) },
    { trees: '10920ae081', boulders: '74e4276595', flowers: '21e5f95445', logs: 'dbcd16f17c', spires: '46030bc993', reeds: 'dc25717e03', snowmen: 'eb93e4e3ba', G: '061f069356', C: '3054e7bf80' });
  assertPlacementGolden(P.tufts, 'frostTufts', '2c942fd39a');
  assert.equal(P.solids.length, 220, 'the only addition is the cave mouth\'s own solid (219 before Step 59)');
});

// ---------------------------------------------------------------------------------------------
// remembered tools, entrances, the guide
// ---------------------------------------------------------------------------------------------
test('a slingshot is a remembered / ethereal tool, and a reload inside Glimmerfrost remembers the area and the cave mouth', async () => {
  const { rememberedTool, runMeta } = await import('../public/js/game/playerMemory.js');
  assert.deepEqual(rememberedTool({ kind: 'slingshot' }), { kind: 'slingshot', color: null, roll: 0 });
  assert.equal(rememberedTool({ kind: 'blowgun' }), null);
  assert.deepEqual(runMeta('dungeon', { area: 'glimmerfrost', from: 'glimmerfrost-mouth' }), { area: 'glimmerfrost', from: 'glimmerfrost-mouth' });
  assert.deepEqual(runMeta('dungeon', { area: 'glimmerfrost', from: 'rootgate' }), { area: 'glimmerfrost', from: 'rootgate' });
  assert.deepEqual(runMeta('dungeon', { area: 'glimmerfrost', from: 'elsewhere' }), { area: 'glimmerfrost' });
  const { TOOLS, ISLAND_SWINGS, getToolAction } = await import('../public/js/items/tools.js');
  assert.deepEqual(TOOLS.slingshot, { chop: 0, break: 0, dig: 0 }); assert.ok(ISLAND_SWINGS.slingshot.duration > 0);
  assert.equal(getToolAction({ kind: 'slingshot', state: 'held' }, { type: 'tree' }), null, 'it does no island work');
});
test('every Glimmerfrost part and every new enemy has guide text, and the new icons exist', async () => {
  const { GLIMMERFROST_GUIDE, GUARDIAN_GUIDE, WEAPON_GUIDE } = await import('../public/js/ui/dungeonBook.js');
  const { ICONS } = await import('../public/js/ui/icons.js');
  assert.equal(GLIMMERFROST_GUIDE.length, A.sections.length);
  for (const kind of ['puff', 'bat', 'frostcap', 'golem', 'hareblock', 'chickblock']) assert.ok(GUARDIAN_GUIDE[kind].length > 40, kind);
  assert.ok(WEAPON_GUIDE.slingshot.description.length > 40);
  for (const id of ['charm-frost-nova', 'tool-slingshot']) assert.ok(ICONS[id] && ICONS[id].startsWith('<svg'), id);
  assert.equal(CHARMS['frost-nova'].icon, 'charm-frost-nova');
});
