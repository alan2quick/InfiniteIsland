// Step 68b's pure course layouts: real-hop flights, timed sink rows and seeded clearing probes.
// Node tests intentionally use the real Emberleaf terrain, not a conveniently empty substitute.
import { assertPlacementGolden } from './helpers/placementGolden.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import * as THREE from 'three';
import { Player } from '../public/js/player/player.js';
import { ISLANDS, PLAYER_RADIUS, BOAT_COURSES, HOP_COURSE, CAMERA_OFFSET, CAMERA_MAX_ZOOM } from '../public/js/config.js';
import { partCourses, partLayouts, PART_SITES } from '../public/js/world/islands/emberParts.js';
import { getIslandModule } from '../public/js/world/islands/registry.js';
import { validateCourse, simulateLink, padPos, stepHop, setHopClock, blocks, hopTime, registerCourse, clearCourses, catchFall, hopEvents, backDownY } from '../public/js/game/hopLogic.js';
import { segmentHitsCylinder } from '../public/js/world/islands/duskFade.js';
import { buildEmberPlacement } from '../public/js/world/islands/emberPlacement.js';
import { planEmberGathering, planEmberTools } from '../public/js/world/islands/emberGathering.js';
import { planEmberSeeds } from '../public/js/world/islands/emberSeeds.js';
import { gardenZone, waterfallForbidden } from '../public/js/world/islands/emberGarden.js';
import { coveReserved } from '../public/js/world/islands/emberCove.js';
import { lavaMouthReserved } from '../public/js/world/islands/lavaMouth.js';
import { polyDist } from '../public/js/world/islands/scatter.js';
const island = ISLANDS.find((i) => i.id === 'ember'), terrain = getIslandModule('ember');
const layouts = partLayouts(island, terrain);

for (const part of ['sail', 'rudder', 'compass']) {
  test(`${part}: validator flies all links on real terrain, moving extremes and wet stopping`, () => {
    const c = layouts[part].course, result = validateCourse(c, terrain);
    assert.ok(result.ok, result.errors.join('; '));
    assert.equal(c.pads.filter((p) => p.cp).length, part === 'rudder' ? 3 : 4, 'sail / compass: start, every 4th pad and the pad before the goal');
    assert.ok(c.pads.find((p) => p.id === c.start).cp);
    assert.ok(c.pads.find((p) => p.id === c.route[c.route.length - 2]).cp);
    for (const p of c.pads) assert.ok(Math.hypot(p.x - c.zone.x, p.z - c.zone.z) + p.r + (p.motion?.amp || 0) <= c.zone.r);
    if (part !== 'rudder') for (const p of c.pads) {
      const at = padPos(p, 0);
      assert.ok(!blocks(c, at.x, at.z, at.top, 0), `${p.id}: overhead tier blocks standing feet`);
    }
    assert.equal(c.backDown.label, 'Slide back down');
    assert.ok(c.backDown.to.y < c.backDown.from.y);
  });
  test(`${part}: scripted real-hop route reaches the goal through all three checkpoints`, () => {
    const c = layouts[part].course, visited = new Set([c.start]);
    let time = 3.2;
    for (let n = 1; n < c.route.length; n++) {
      const a = c.pads.find((p) => p.id === c.route[n - 1]), b = c.pads.find((p) => p.id === c.route[n]);
      const link = c.links.find((l) => l.a === a.id && l.b === b.id);
      let result;
      // Waiting is player input too: a still rock safely holds the departure while the clock advances.
      for (let w = 0; w <= 240; w++) {
        const at = time + w / 20;
        if (link.wait && (padPos(a, at).top < a.top - 0.01 || padPos(b, at + 0.45).top < b.top - 0.01)) continue;
        result = simulateLink(c, a, b, at, terrain);
        if (result.ok) { time = at + result.flight + 0.25; break; }
        if (!link.wait) break;
      }
      assert.ok(result?.ok, `${a.id} -> ${b.id}: ${result?.why}`);
      visited.add(b.id);
    }
    assert.ok(visited.has(c.goal));
    assert.ok(c.pads.filter((p) => p.cp).every((p) => visited.has(p.id)));
  });
  test(`${part}: validator rejects a too-wide hop and a broken checkpoint pad`, () => {
    const c = structuredClone(layouts[part].course);
    c.pads.find((p) => p.id === c.route[1]).x += 12;
    assert.equal(validateCourse(c, terrain).ok, false);
    const tall = structuredClone(layouts[part].course);
    tall.pads.find((p) => p.id === tall.route[1]).top = tall.pads[0].top + 0.8;
    assert.ok(validateCourse(tall, terrain).errors.some((e) => /rise/.test(e)));
    const small = structuredClone(layouts[part].course);
    small.pads.find((p) => p.cp).r = 0.5;
    assert.ok(validateCourse(small, terrain).errors.some((e) => /too small/.test(e)));
  });
}

test('rudder: every cooling row has an up plate at every clock phase and a still resting rock', () => {
  const c = layouts.rudder.course;
  for (let t = 0; t < 20; t += 0.025) {
    for (const row of c.rows) assert.ok(row.some((id) => !padPos(c.pads.find((p) => p.id === id), t).sunk), `${row} at ${t}`);
  }
  assert.ok(c.pads.filter((p) => p.kind === 'rock').every((p) => !p.motion));
  const b = { x: c.hazard.x + 7.9, z: c.hazard.z, y: c.hazard.y + 1, vy: 0, grounded: false, pad: null };
  let splash = false;
  for (let n = 0; n < 180; n++) if (stepHop(b, {}, c, n / 60, 1 / 60, terrain).splash) { splash = true; break; }
  assert.ok(splash, 'falling through the masked lava terrain splashes without damage');
});

test('part courses occupy clearings of the existing props, lanes, gathering, tools and seeds', () => {
  const p = buildEmberPlacement(island, terrain), g = planEmberGathering(island, terrain);
  const items = [...p.trees, ...p.boulders, ...p.ferns, ...p.flowers, ...p.decor, ...p.garden.plots,
    ...g.herbs, ...g.digs, ...planEmberTools(island, terrain), ...Object.values(planEmberSeeds(island, terrain, p))];
  for (const [part, site] of Object.entries(PART_SITES)) {
    const { anchor: a } = layouts[part];
    assert.ok(terrain.walkable(a.x, a.z));
    assert.ok(!gardenZone(island, a.x, a.z, site.keepClear));
    assert.ok(!waterfallForbidden(island, a.x, a.z, site.keepClear));
    assert.ok(!coveReserved(a.x, a.z, site.keepClear, island));
    assert.ok(!lavaMouthReserved(a.x, a.z, site.keepClear));
    for (const q of items) assert.ok(Math.hypot(q.x - a.x, q.z - a.z) - (q.r || 0.3) > site.keepClear, `${part}: ${q.id || q.layer} intrudes`);
    for (const lane of p.lanes) assert.ok(polyDist(lane, a.x, a.z) > site.keepClear + 2, `${part}: a walking lane intrudes`);
  }
});

test('Emberleaf placement remains at the Step 60 pinned hashes; layouts are cached and do not claim solids', () => {
  const hash = (o) => crypto.createHash('md5').update(JSON.stringify(o)).digest('hex').slice(0, 10);
  const p = buildEmberPlacement(island, terrain);
  assertPlacementGolden(p.flowers, 'emberFlowers', '834b877a48');
  assert.deepEqual({ trees: hash(p.trees), boulders: hash(p.boulders), ferns: hash(p.ferns), decor: hash(p.decor), lanes: hash(p.lanes) },
    { trees: '2014801176', boulders: '98cd3aa689', ferns: '356ed6e089', decor: 'abf0410989', lanes: '54052443b5' });
  assert.equal(p.solids.length, 189);
  assert.equal(partLayouts(island, terrain), layouts);
  assert.deepEqual(partCourses(island, terrain), Object.values(layouts).map((l) => l.course));
});

// Drive the actual Player vertical/checkpoint/respawn integration continuously. Horizontal input
// is prescribed through real Player._step collision; this does not measure keyboard feel.
function drivenPlayer(c, at, checkpoint = at.id) {
  const p = Object.create(Player.prototype);
  Object.assign(p, { position: new THREE.Vector3(at.x, at.top, at.z), velocity: { x: 0, z: 0 },
    _course: c, _courseJump: false, _glideHeld: false, _sq: 0, _sqVel: 0,
    _cb: { x: at.x, z: at.z, y: at.top, vy: 0, grounded: true, pad: at.id, checkpoint, splash: null },
    radius: PLAYER_RADIUS, moveGuard: null, _noGuard: false, dustBurst() {} });
  p._courseWalk = (x, z) => !blocks(c, x, z, p._cb.y, hopTime());
  return p;
}
for (const part of ['sail', 'rudder', 'compass']) test(`${part}: continuous Player vertical run preserves all checkpoints, then descends Back down`, (t) => {
  const c = layouts[part].course, p = drivenPlayer(c, c.pads[0]);
  let now = 0;
  setHopClock(() => now);
  const tick = (dx = 0, dz = 0) => { p._step(dx, dz); now += 1 / 60; p._courseVertical(1 / 60); };
  const walk = (x, z, target = null) => {
    for (let n = 0; n < 180; n++) {
      if (target) { const q = target(); x=q.x; z=q.z; }
      const dx = x - p.position.x, dz = z - p.position.z, d = Math.hypot(dx, dz);
      if (d < 0.025) break;
      const k = Math.min(1, 3 / 60 / d); tick(dx * k, dz * k);
      assert.ok(p._cb.grounded && !p._splashing, `repositioning remains on ${p._cb.pad} toward ${x},${z} at ${now}`);
    }
  };
  const visited = new Set([p._cb.checkpoint]);
  for (let n = 1; n < c.route.length; n++) {
    const a = c.pads.find((q) => q.id === c.route[n - 1]), b = c.pads.find((q) => q.id === c.route[n]);
    const link = c.links.find((q) => q.a === a.id && q.b === b.id);
    // For crust entries reserve enough up time for the entry, a short reposition and the exit.
    if (link.wait && b.motion) {
      for (let w = 0; w < 900 && [0.45, 1.1, 1.6].some((dt) => padPos(b, now + dt).top < b.top - 0.01); w++) tick();
    }
    let A = { ...padPos(a, now) }, B = { ...padPos(b, now + 0.4) };
    let dx = B.x - A.x, dz = B.z - A.z, d = Math.hypot(dx, dz); dx /= d; dz /= d;
    walk(0, 0, () => {
      const at={...padPos(a,now)}, to={...padPos(b,now+0.4)}, d=Math.hypot(to.x-at.x,to.z-at.z);
      return {x:at.x+(to.x-at.x)/d*(a.r-0.35),z:at.z+(to.z-at.z)/d*(a.r-0.35)};
    });
    A = { ...padPos(a, now) }; B = { ...padPos(b, now + 0.4) };
    dx = B.x - A.x; dz = B.z - A.z; d = Math.hypot(dx, dz); dx /= d; dz /= d;
    const result = simulateLink(c, a, b, now, terrain);
    assert.ok(result.ok, `${part} timed departure ${a.id}: ${result.why}`);
    p._courseJump = true;
    // Like simulateLink, the first physics frame is at takeoff; horizontal increments follow it.
    tick();
    for (let f = 0; f < 180 && !p._cb.grounded && !p._splashing; f++) tick(dx * result.speed / 60, dz * result.speed / 60);
    assert.equal(p._cb.pad, b.id, `${a.id} -> ${b.id}`);
    visited.add(p._cb.checkpoint);
  }
  assert.equal(p._cb.pad, c.goal);
  t.diagnostic(`scripted route: ${now.toFixed(1)} s (prescribed horizontal movement)`);
  assert.ok(c.pads.filter((q) => q.cp).every((q) => visited.has(q.id)));
  // The return surface is continuous and steeper than a walk-up step; falling follows it downward.
  const back = c.backDown;
  walk(back.from.x, back.from.z);
  for (let f = 1; f <= 240; f++) {
    const u = f / 240, x = back.from.x + (back.to.x - back.from.x) * u, z = back.from.z + (back.to.z - back.from.z) * u;
    tick(x - p.position.x, z - p.position.z);
  }
  assert.ok(!p._splashing && Math.abs(p.position.y - back.to.y) < 0.4, `returned at ${p.position.y}, target ${back.to.y}`);
  setHopClock(() => 0);
});

test('rudder: actual Player falls into lava and respawns at the last midpoint checkpoint', () => {
  const c = layouts.rudder.course, mid = c.pads.find((q) => q.cp && q.id !== c.start), p = drivenPlayer(c, mid);
  let now = 0; setHopClock(() => now);
  p.position.x = c.hazard.x + 7.9; p.position.z = c.hazard.z;
  let sawSplash = false;
  for (let n = 0; n < 240; n++) { now += 1 / 60; p._courseVertical(1 / 60); sawSplash ||= !!p._splashing; if (sawSplash && !p._splashing) break; }
  assert.ok(sawSplash && !p._splashing);
  assert.equal(p._cb.pad, mid.id);
  assert.equal(p._cb.checkpoint, mid.id);
  assert.equal(p.position.x, mid.x); assert.equal(p.position.z, mid.z);
  setHopClock(() => 0);
});

for (const part of ['sail', 'compass']) test(`${part}: entering the start at ground height cannot skip to a higher spiral tier`, () => {
  const c = layouts[part].course, start = c.pads[0], p = drivenPlayer(c, start);
  p._course = null; p._cb = null;
  p.position.y = terrain.height(start.x, start.z);
  p._switchCourse(c);
  p._courseVertical(1 / 60);
  assert.ok(p.position.y < start.top + 0.4, `entry stands at ${p.position.y}`);
  assert.notEqual(p._cb.pad, c.goal);
});

test('compass: an actual Player sea fall respawns at the shell-bell checkpoint', () => {
  const c = layouts.compass.course, bell = c.pads.find((q) => q.id === c.route[c.route.length - 2]), p = drivenPlayer(c, bell);
  let now = 0; setHopClock(() => now);
  p.position.x = c.zone.x + 9; p.position.z = c.zone.z;
  assert.ok(terrain.height(p.position.x, p.position.z) < c.gapY, 'seaward fall is over ocean');
  let sawSplash = false;
  for (let n = 0; n < 300; n++) { now += 1 / 60; p._courseVertical(1 / 60); sawSplash ||= !!p._splashing; if (sawSplash && !p._splashing) break; }
  assert.ok(sawSplash && !p._splashing);
  assert.equal(p._cb.pad, bell.id); assert.equal(p._cb.checkpoint, bell.id);
  setHopClock(() => 0);
});

const goalOf = (c) => c.pads.find((q) => q.id === c.goal), preGoalOf = (c) => c.pads.find((q) => q.id === c.route[c.route.length - 2]);
function runFrames(p, frames, now0 = 0, move = null) {
  let now = now0; setHopClock(() => now);
  for (let n = 0; n < frames; n++) { now += 1 / 60; if (move) p._step(move.x / 60, move.z / 60); p._courseVertical(1 / 60); }
  return now;
}
test('sail: an actual Player canopy descent (glide armed) lands safely on jungle ground; without the glide the fall is caught', () => {
  const c = layouts.sail.course, goal = goalOf(c), pre = preGoalOf(c);
  const glider = drivenPlayer(c, goal, pre.id); glider._cb.glide = true;
  glider.position.x = c.zone.x + 8; glider.position.z = c.zone.z;
  for (let n = 0; n < 300; n++) { glider._courseVertical(1 / 60); if (glider._cb.grounded && glider._cb.pad === null) break; }
  assert.ok(glider._cb.grounded && !glider._splashing);
  assert.equal(glider._cb.pad, null);
  assert.equal(glider.position.y, terrain.height(glider.position.x, glider.position.z));
  const faller = drivenPlayer(c, goal, pre.id);
  faller.position.x = c.zone.x + 8; faller.position.z = c.zone.z;
  let caught = 0; hopEvents.onCatch = () => caught++;
  runFrames(faller, 120);
  hopEvents.onCatch = null; setHopClock(() => 0);
  assert.equal(caught, 1); assert.equal(faller._cb.pad, pre.id); assert.equal(faller.position.x, pre.x); assert.equal(faller.position.y, pre.top);
});

for (const part of ['sail', 'compass']) test(part + ': catch rule (real Player): a fall off a high pad pops back onto its checkpoint with no splash; the start pad never catches', () => {
  const c = layouts[part].course, hi = c.pads.find((q) => q.id === part + '-9'), cp = c.pads.find((q) => q.id === part + '-8');
  const spot = { x: c.zone.x - 5.1, z: c.zone.z + 3.1 };                    // west of the second run: dry ground on both courses
  assert.ok(terrain.height(spot.x, spot.z) > c.gapY, 'a dry landing spot');
  let caught = 0, splash = 0; hopEvents.onCatch = () => caught++; hopEvents.onSplash = () => splash++;
  const p = drivenPlayer(c, hi, cp.id);
  p.position.x = spot.x - 2.5; p.position.z = spot.z;
  runFrames(p, 120);
  assert.equal(caught, 1); assert.equal(splash, 0); assert.equal(p._cb.pad, cp.id); assert.equal(p._splashing, false);
  assert.equal(p.position.x, cp.x); assert.equal(p.position.y, cp.top);
  // The start pad: walking off it onto the ground is free (its checkpoint is a step above the ground).
  const start = c.pads[0], q = drivenPlayer(c, start);
  q.position.x = start.x - 2.6; q.position.z = start.z - 1.4;
  runFrames(q, 90);
  hopEvents.onCatch = null; hopEvents.onSplash = null; setHopClock(() => 0);
  assert.equal(caught, 1, 'no catch from the start'); assert.ok(q._cb.grounded && q._cb.pad === null);
});

for (const part of ['sail', 'rudder', 'compass']) test(part + ': riding the slide / stairs down never triggers the catch, and the ground after it is walkable', () => {
  const c = layouts[part].course, goal = goalOf(c), pre = preGoalOf(c), b = c.backDown;
  let caught = 0; hopEvents.onCatch = () => caught++;
  const p = drivenPlayer(c, goal, pre.id);
  let now = 0; setHopClock(() => now);
  const tick = (dx, dz) => { p._step(dx, dz); now += 1 / 60; p._courseVertical(1 / 60); };
  for (let f = 1; f <= 240; f++) {
    const u = f / 240, x = b.from.x + (b.to.x - b.from.x) * u, z = b.from.z + (b.to.z - b.from.z) * u;
    tick(x - p.position.x, z - p.position.z);
  }
  const dx = b.to.x - b.from.x, dz = b.to.z - b.from.z, d = Math.hypot(dx, dz);
  for (let f = 0; f < 90; f++) tick(dx / d * 0.05, dz / d * 0.05);          // keep walking on the ground at the foot (still inside the zone)
  hopEvents.onCatch = null; setHopClock(() => 0);
  assert.equal(caught, 0); assert.equal(p._cb.checkpoint, c.start, 'the slide ends the catch');
  assert.ok(p.position.y < goal.top - 1, 'came down the slide');
});

test('catchFall is a pure rule: depth, glide, slide, zone and the start checkpoint', () => {
  const c = layouts.sail.course, cb = { checkpoint: 'sail-8' }, top = c.pads.find((q) => q.id === 'sail-8').top, spot = { x: c.zone.x, z: c.zone.z + 8.3 };
  assert.equal(catchFall(c, cb, spot.x, spot.z, top - HOP_COURSE.catchDepth - 0.05), 'sail-8');
  assert.equal(catchFall(c, cb, spot.x, spot.z, top - HOP_COURSE.catchDepth + 0.05), null, 'a shallow drop is just a drop');
  assert.equal(catchFall(c, cb, spot.x, spot.z, top - 2.5, true), null, 'a glide is the way down');
  assert.equal(catchFall(c, { checkpoint: c.start }, spot.x, spot.z, top - 2.5), null, 'the start never catches');
  assert.equal(catchFall(c, cb, c.zone.x + c.zone.r + 1, c.zone.z, top - 2.5), null, 'outside the zone it is over');
  const mid = { x: (c.backDown.from.x + c.backDown.to.x) / 2, z: (c.backDown.from.z + c.backDown.to.z) / 2 };
  assert.equal(catchFall(c, cb, mid.x, mid.z, backDownY(c, mid.x, mid.z)), null, 'the slide has its own floor');
  assert.equal(catchFall(c, { checkpoint: 'nope' }, spot.x, spot.z, 0), null);
  assert.equal(catchFall(null, cb, 0, 0, 0), null);
});

for (const part of ['sail', 'rudder', 'compass']) test(`${part}: Back down crosses no pad side walls`, () => {
  const c = layouts[part].course, b = c.backDown;
  for (let n = 0; n <= 100; n++) {
    const u = n / 100, x = b.from.x + (b.to.x - b.from.x) * u, z = b.from.z + (b.to.z - b.from.z) * u;
    const y = b.from.y + (b.to.y - b.from.y) * u;
    assert.ok(!blocks(c, x, z, y, 0), `${part}: pad wall at return fraction ${u}`);
  }
});


test('rudder raised basin clears the unchanged slope and its approach joins ground to the start', () => {
  const c = layouts.rudder.course, h = c.hazard;
  for (let x = -8; x <= 8; x += 0.5) for (let z = -8; z <= 8; z += 0.5) {
    if (Math.hypot(x, z) < h.r) assert.ok(terrain.height(h.x + x, h.z + z) < h.y, 'no buried lava or rock tops');
  }
  const ramp = c.approach, start = c.pads[0];
  assert.equal(ramp.from.y, terrain.height(ramp.from.x, ramp.from.z));
  assert.equal(ramp.to.y, start.top);
  const p = drivenPlayer(c, { ...ramp.from, top: ramp.from.y, id: null });
  p._cb.checkpoint = c.start;
  for (let n = 1; n <= 240; n++) {
    const u = n / 240, x = ramp.from.x + (ramp.to.x - ramp.from.x) * u, z = ramp.from.z + (ramp.to.z - ramp.from.z) * u;
    assert.equal(blocks(c, x, z, p.position.y, 0), false);
    p.position.x = x; p.position.z = z; p._courseVertical(1 / 60);
  }
  assert.equal(p._cb.pad, c.start); assert.ok(p._cb.grounded);
});

for (const glide of [false, true]) test('real Player update walks out of the sail zone without a vertical snap, glide=' + glide + (glide ? '' : ' (caught back onto the checkpoint)'), () => {
  clearCourses(); const c = layouts.sail.course; registerCourse(c);
  const west = c.pads.find((q) => q.id === 'sail-7'), cp = c.pads.find((q) => q.id === 'sail-8'), p = drivenPlayer(c, west, cp.id);   // the second run's west end: dry ground lies beyond it
  Object.assign(p, { root: new THREE.Group(), _t: 0, speedScale: 1, _turnRate: 0, facing: 0, _faceTo: null,
    _animatePose() {}, _updateDust() {}, _sailGlideArmed: glide });
  p._cb.glide = glide;
  let caught = 0; hopEvents.onCatch = () => caught++;
  // Outward from the lattice (west): the dry ground is where the glide lands or the catch happens.
  let now = 0; setHopClock(() => now);
  let landed = false, outside = false;
  for (let i = 0; i < 900; i++) {
    const prev = p.position.y, vy = p._cb?.vy || 0; now += 1 / 60;
    p.update(1 / 60, { move: { x: -1, z: 0 }, jumpHeld: glide });
    if (caught) break;
    outside ||= Math.hypot(p.position.x - c.zone.x, p.position.z - c.zone.z) > c.zone.r;
    assert.ok(prev - p.position.y <= Math.max(0, -vy / 60) + 24 / 3600 + 0.001, 'drop exceeds gravity step');
    assert.ok(!p._splashing, 'walkable ground has no splash');
    if (outside && p._cb?.grounded) { landed = true; break; }
  }
  hopEvents.onCatch = null;
  if (glide) { assert.ok(outside && landed); assert.equal(p._cb.glide, false); assert.equal(p._sailGlideArmed, false); assert.equal(caught, 0); }
  else { assert.equal(caught, 1); assert.equal(p._cb.pad, cp.id); }
  clearCourses(); setHopClock(() => 0);
});

// 68e: the layouts themselves
for (const part of ['sail', 'compass']) test(part + ': a camera-facing switchback of 12 big, low, forgiving pads', () => {
  const L = layouts[part], c = L.course, q = BOAT_COURSES[part], route = c.route.map((id) => c.pads.find((p) => p.id === id));
  assert.equal(route.length, q.steps + 1); assert.ok(route.length >= 12 && route.length <= 14);
  for (const p of route) {
    assert.ok(p.z >= L.anchor.z - 0.5 - 1e-9, p.id + ' stays on the camera side of the anchor');
    assert.ok(p.r >= 1.5 - 1e-9 && p.r <= 1.8, p.id + ' radius');
    assert.ok(!p.motion, 'the required route is still');
  }
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1], b = route[i], gap = Math.hypot(a.x - b.x, a.z - b.z) - a.r - b.r;
    assert.ok(Math.abs(b.top - a.top - 0.3) < 1e-9, 'rise 0.3');
    assert.ok(gap <= 1.6 + 1e-9, a.id + ' -> ' + b.id + ' gap ' + gap.toFixed(2));
  }
  assert.deepEqual(c.pads.filter((p) => p.cp).map((p) => p.id), [0, 4, 8, 10].map((n) => part + '-' + n));
  assert.ok(c.pads.filter((p) => p.cp).every((p) => p.flag), 'every checkpoint carries a flag');
  // no overlapping pads (stones that sway included at their extremes)
  for (let i = 0; i < c.pads.length; i++) for (let j = i + 1; j < c.pads.length; j++) {
    const a = c.pads[i], b = c.pads[j], d = Math.hypot(a.x - b.x, a.z - b.z) - a.r - b.r - (a.motion?.amp || 0) - (b.motion?.amp || 0);
    assert.ok(d >= 0, a.id + ' / ' + b.id + ' overlap');
  }
  // the first pad is a walk-on from the ground
  const s0 = route[0];
  assert.ok(s0.top - terrain.height(s0.x, s0.z) <= HOP_COURSE.step + 1e-9, 'the start is a step above the ground');
  const goal = route[route.length - 1], tr = L.tree || L.headland;
  assert.ok(Math.hypot(goal.x - tr.x, goal.z - tr.z) < goal.r + tr.r + 1.2, 'the goal stands beside the trunk / headland');
  for (const p of c.pads) assert.ok(Math.hypot(p.x - tr.x, p.z - tr.z) >= p.r + tr.r + (p.motion?.amp || 0), p.id + ' clear of the trunk');
});

test('sail: the swaying stones are optional bypasses of the still route; compass: every third step is wet, the dry ones wear moss', () => {
  const sail = layouts.sail.course, sway = sail.pads.filter((p) => p.motion);
  assert.equal(sway.length, 2); assert.ok(sway.every((p) => p.motion.kind === 'sway'));
  assert.ok(sail.links.filter((l) => sway.some((p) => p.id === l.a || p.id === l.b)).every((l) => l.optional));
  assert.ok(!sail.route.some((id) => sway.some((p) => p.id === id)));
  const compass = layouts.compass.course, wet = compass.pads.filter((p) => p.kind === 'wet');
  assert.deepEqual(wet.map((p) => p.id), ['compass-2', 'compass-5', 'compass-8']);
  assert.ok(compass.pads.filter((p) => p.kind !== 'wet').every((p) => p.moss));
  assert.equal(compass.pads.find((p) => p.id === compass.goal).kind, 'rock');
  const r = BOAT_COURSES.rudder; assert.equal(r.period, 14); assert.equal(r.warn, 2);
});

// The follow camera looks toward -Z from CAMERA_OFFSET (zoomed out up to CAMERA_MAX_ZOOM): no required pad may sit behind the trunk, canopy or headland.
for (const part of ['sail', 'compass']) test(part + ': from the default follow camera no route pad is hidden behind the trunk / canopy / headland', () => {
  const L = layouts[part];
  for (const zoom of [1, 1.6, CAMERA_MAX_ZOOM]) for (const id of L.course.route) {
    const pad = L.course.pads.find((p) => p.id === id);
    const cam = { x: pad.x + CAMERA_OFFSET.x * zoom, y: pad.top + CAMERA_OFFSET.y * zoom, z: pad.z + CAMERA_OFFSET.z * zoom };
    for (const target of [{ x: pad.x, y: pad.top, z: pad.z }, { x: pad.x, y: pad.top + 1.2, z: pad.z }])
      for (const o of L.occluders) assert.ok(!segmentHitsCylinder(cam, target, o.x, o.z, o.r, o.y0, o.y1), id + ' at zoom ' + zoom + ' is behind an occluder');
  }
  assert.ok(L.occluders.length >= 1);
});
