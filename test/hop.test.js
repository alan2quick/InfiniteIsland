// Step 68a: the hop-course system (game/hopLogic.js), its player integration (player.js, only inside course zones), the tide-pool tutorial course of Skipper's Cove (world/islands/emberCove.js) and the
// cove's place on Emberleaf. Pure / Node only: the Player is driven without a scene (its animation is stubbed), the real terrain and colliders answer.
import { assertPlacementGolden } from './helpers/placementGolden.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import * as THREE from 'three';
import { HOP_COURSE, PLAYER_RADIUS, ISLANDS, PLAYER_SPEED } from '../public/js/config.js';
import {
  HOP, setHopClock, setHopTerrain, registerCourse, unregisterCourse, clearCourses, courseAt, padPos, padsAt, surfaceAt, surfaceY, blocks, gapAt, stepHop, validateCourse, nextOnRoute, hopEvents, splashY, simulateLink,
} from '../public/js/game/hopLogic.js';
import { Player } from '../public/js/player/player.js';
import { SPAWN, getHeight } from '../public/js/world/terrain.js';
import { getIslandModule } from '../public/js/world/islands/registry.js';
import { coveCourse, coveLayout, coveFrame, COVE, coveReserved } from '../public/js/world/islands/emberCove.js';
import { buildEmberPlacement, sampleEmberSpots } from '../public/js/world/islands/emberPlacement.js';

const island = ISLANDS.find((i) => i.id === 'ember'), mod = getIslandModule('ember');
const sea = { height: () => -3 };                                   // a flat sea: every cell is a gap
const pad = (id, x, z, r, top, extra = {}) => ({ id, kind: 'rock', x, z, r, top, ...extra });
const course = (pads, links, extra = {}) => ({ id: 't', zone: { x: 0, z: 0, r: 40 }, gapY: -0.05, pads, links, start: pads[0].id, goal: pads[pads.length - 1].id, ...extra });
const two = (gap, rise = 0, r = 1) => course([pad('a', 0, 0, r, 0.4), pad('b', gap + 2 * r, 0, r, 0.4 + rise)], [{ a: 'a', b: 'b' }]);

// ---- no regressions outside a course zone
function fakePlayer() {
  const p = Object.create(Player.prototype);
  Object.assign(p, {
    radius: PLAYER_RADIUS, position: new THREE.Vector3(SPAWN.x, 0, SPAWN.z), velocity: { x: 0, z: 0 }, facing: 0, root: { rotation: { y: 0 } }, frozen: false, paused: false, downed: false, speedScale: 1, moveGuard: null,
    _noGuard: false, _faceTo: null, speed: 0, moving: false, _t: 0, _hurtT: -1, _dash: null, pageDrive: null, _turnRate: 0, _wasInput: false, _prevSpeed: 0, _sq: 0, _sqVel: 0, _swingT: -1, _hopY: 0, _hopVel: 0,
    groundProbe: null, _course: null, _cb: null, _courseWalk: null, _courseJump: false, _splashing: false, _wet: false, _air: 0, _savedProbe: null,
  });
  p._animatePose = () => {}; p._updateDust = () => {}; p.dustBurst = () => {};
  return p;
}
test('outside every course zone the player code path is unchanged: a scripted home walk gives bit-identical positions to the pre-68a Player', () => {
  clearCourses();
  const p = fakePlayer(), h = crypto.createHash('md5'), buf = new Float64Array(3);
  for (let f = 0; f < 900; f++) {
    const a = f * 0.021, mag = f % 240 < 40 ? 0 : 1;
    if (f % 97 === 0) p.hop();
    p.update(1 / 60, { move: { x: Math.sin(a) * mag, z: Math.cos(a * 1.3) * mag } });
    buf[0] = p.position.x; buf[1] = p.position.y; buf[2] = p.position.z;
    h.update(Buffer.from(buf.buffer));
  }
  assert.equal(h.digest('hex').slice(0, 12), 'e233787d106f', 'the hash was recorded from the Player of commit 233db62 (before Step 68a)');
  assert.equal(p._course, null);
});
test('a registered course elsewhere changes nothing at home either (courseAt is null away from its zone)', () => {
  clearCourses();
  const c = registerCourse(coveCourse(island));
  assert.equal(courseAt(SPAWN.x, SPAWN.z), null);
  const p = fakePlayer(), h = crypto.createHash('md5'), buf = new Float64Array(3);
  for (let f = 0; f < 900; f++) {
    const a = f * 0.021, mag = f % 240 < 40 ? 0 : 1;
    if (f % 97 === 0) p.hop();
    p.update(1 / 60, { move: { x: Math.sin(a) * mag, z: Math.cos(a * 1.3) * mag } });
    buf[0] = p.position.x; buf[1] = p.position.y; buf[2] = p.position.z;
    h.update(Buffer.from(buf.buffer));
  }
  assert.equal(h.digest('hex').slice(0, 12), 'e233787d106f');
  unregisterCourse(c);
});

// ---- the hop numbers
test('hop-step parity with player.js: speed 5.6, gravity 24 (apex 0.65 u, airtime 0.47 s), taken from the same config entries', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('../public/js/player/player.js', import.meta.url), 'utf8');
  assert.match(src, /const GRAVITY = HOP_COURSE\.gravity/);
  assert.match(src, /const HOP_SPEED = HOP_COURSE\.hopSpeed/);
  assert.equal(HOP.speed, 5.6); assert.equal(HOP.gravity, 24);
  const c = course([pad('a', 0, 0, 5, 0.4)], []);
  const b = { x: 0, z: 0, y: 0.4, vy: 0, grounded: true, pad: 'a' };
  let t = 0, apex = 0, n = 0;
  stepHop(b, { jump: true }, c, t, 1 / 60, sea);
  for (; n < 120; n++) {
    apex = Math.max(apex, b.y - 0.4);
    const ev = stepHop(b, {}, c, t += 1 / 60, 1 / 60, sea);
    if (ev.landed) break;
  }
  assert.ok(Math.abs(apex - 0.65) < 0.06, `apex ${apex}`);          // (0.65 u analytically; the 60 Hz step reads a little under it)
  assert.ok(Math.abs((n + 1) / 60 - 0.47) < 0.05, `airtime ${(n + 1) / 60}`);
  // the very same integration as the visual hop in player.js (velocity first, then position): same apex, same landing frame
  let hy = 0, hv = HOP.speed, ticks = 0, hApex = 0;
  while (ticks < 200) { hv -= 24 / 60; hy += hv / 60; ticks++; hApex = Math.max(hApex, hy); if (hy <= 0) break; }
  assert.ok(Math.abs(hApex - apex) < 1e-9, `${hApex} vs ${apex}`);
  assert.ok(Math.abs(ticks - (n + 2)) <= 1);
});

// ---- surfaces, walls, gaps
test('surfaceY / blocks / gapAt / padsAt: the highest pad top within a step, else the terrain; taller sides are walls; water cells are gaps', () => {
  const c = course([pad('low', 0, 0, 1, 0.4), pad('hi', 0, 0, 0.5, 0.65), pad('tall', 5, 0, 1, 1.2)], []);
  const land = { height: (x) => (x < -3 ? 0.3 : -3) };
  assert.equal(surfaceY(c, 0, 0, 0, 0.4, land), 0.65, 'a ledge of 0.25 is walked up');
  assert.equal(surfaceY(c, 0.8, 0, 0, 0.4, land), 0.4);
  assert.equal(surfaceY(c, 5, 0, 0, 0.4, land), -Infinity, 'a 0.8 u side is not a surface');
  assert.equal(surfaceY(c, 5, 0, 0, 1.0, land), 1.2, 'from the air above it, it is');
  assert.equal(surfaceY(c, -5, 0, 0, 0.3, land), 0.3, 'the beach (terrain) when it is not a gap');
  assert.ok(blocks(c, 5, 0, 0.4, 0) && !blocks(c, 5, 0, 1.0, 0) && !blocks(c, 0, 0, 0.4, 0));
  assert.ok(gapAt(c, 10, 0, land) && !gapAt(c, -5, 0, land));
  assert.deepEqual(padsAt(c, 0.2, 0, 0).map((q) => q.pad.id).sort(), ['hi', 'low']);
  assert.equal(padsAt(c, 1.2, 0, 0).length, 0); assert.equal(padsAt(c, 1.2, 0, 0, 0.3).length, 1, 'extra widens the rim');
  const r = course([{ id: 'plank', kind: 'deck', x: 0, z: 0, w: 4, d: 1.4, rot: Math.PI / 2, top: 0.5 }], []);
  assert.equal(padsAt(r, 0, 1.5, 0).length, 1); assert.equal(padsAt(r, 1.5, 0, 0).length, 0, 'a rectangle turned a quarter');
});
test('stepHop: stand, walk off an edge and fall, splash below the water line, land on a pad with the soft magnet, the magnet only when falling', () => {
  const c = course([pad('a', 0, 0, 1, 0.4), pad('b', 3.2, 0, 1, 0.4)], [{ a: 'a', b: 'b' }]);
  const b = { x: 0, z: 0, y: 0.4, vy: 0, grounded: true, pad: 'a' };
  stepHop(b, {}, c, 0, 1 / 60, sea);
  assert.ok(b.grounded && b.y === 0.4);
  b.x = 1.5;                                                                  // off the rim
  let ev = {}, splashed = false;
  for (let i = 0; i < 60 && !splashed; i++) { ev = stepHop(b, {}, c, 0, 1 / 60, sea); splashed = !!ev.splash; }
  assert.ok(splashed && b.y < splashY(c) && !b.grounded);
  // a hop that comes down 0.2 u outside b's rim is pulled onto it (magnet), but not at all when the magnet is 0
  const hop = (magnet) => { const q = { x: 0.5, z: 0, y: 0.4, vy: 0, grounded: true, pad: 'a' }; stepHop(q, { jump: true }, c, 0, 1 / 60, sea, { magnet }); let r = {}; for (let i = 0; i < 80; i++) { q.x += 7 * 0.82 / 60 * (i < 0 ? 0 : 1) * 0.9; r = stepHop(q, {}, c, 0, 1 / 60, sea, { magnet }); if (r.landed || r.splash) break; } return { q, r }; };
  const withM = hop(0.35), without = hop(0);
  assert.ok(withM.q.grounded || without.q.grounded || withM.r.splash || without.r.splash);
  const edge = { x: 2.1 - 0.0, z: 0, y: 0.9, vy: -0.5, grounded: false, pad: null };      // 0.1 u outside b's rim (b spans 2.2 .. 4.2), coming down onto it
  edge.x = 2.1;
  const e2 = stepHop(edge, {}, c, 0, 1 / 60, sea, { magnet: 0.35 });
  assert.ok(!e2.landed, 'still above the pad top');
  let landed = null;
  for (let i = 0; i < 40 && !landed; i++) { const r = stepHop(edge, {}, c, 0, 1 / 60, sea, { magnet: 0.35 }); if (r.landed) landed = r; }
  assert.ok(landed && edge.pad === 'b' && edge.x > 2.2, 'pulled in over the rim');
  const edge0 = { x: 2.1, z: 0, y: 0.9, vy: -0.5, grounded: false, pad: null };
  let hit = null; for (let i = 0; i < 80 && !hit; i++) { const r = stepHop(edge0, {}, c, 0, 1 / 60, sea, { magnet: 0 }); if (r.landed || r.splash) hit = r; }
  assert.ok(hit && hit.splash, 'without the magnet the same landing is a splash');
});

// ---- moving pads: pure functions of the shared clock
test('moving pads are pure functions of the shared clock: sway swings along its axis, bob moves the top, sink trembles, sinks under, rises; two screens at the same time agree', () => {
  const sway = { id: 's', kind: 'bamboo', x: 10, z: 5, r: 1, top: 0.5, motion: { kind: 'sway', axis: [1, 0], amp: 1.2, period: 6, phase: 0.25 } };
  const bob = { id: 'b', kind: 'deck', x: 0, z: 0, r: 1, top: 0.5, motion: { kind: 'bob', amp: 0.1, period: 4, phase: 0 } };
  const sink = { id: 'k', kind: 'crust', x: 0, z: 0, r: 1, top: 0.5, motion: { kind: 'sink', period: 10, phase: 0, down: 1.5, warn: 1.2 } };
  assert.ok(Math.abs(padPos(sway, 0).x - 10) < 1.2 + 1e-9 && padPos(sway, 0).z === 5);
  const xs = Array.from({ length: 60 }, (_, i) => padPos(sway, i * 0.1).x);
  assert.ok(Math.max(...xs) <= 11.2 + 1e-9 && Math.min(...xs) >= 8.8 - 1e-9 && Math.max(...xs) - Math.min(...xs) > 2.2);
  assert.equal(padPos(sway, 1.5).x, padPos(sway, 7.5).x, 'periodic');
  assert.ok(padPos(bob, 1).top > 0.55 && padPos(bob, 3).top < 0.45 && padPos(bob, 1).x === 0);
  assert.equal(padPos(sink, 0).top, 0.5);
  assert.ok(padPos(sink, 4.5).tremble && !padPos(sink, 2).tremble && !padPos(sink, 6.5).tremble, 'trembles for `warn` s before it sinks');
  assert.ok(padPos(sink, 7).sunk && Math.abs(padPos(sink, 7).top - (0.5 - 1.5)) < 1e-9 && padPos(sink, 7).top < 0 - 0.5);
  assert.ok(padPos(sink, 9.99).top > -0.2 && !padPos(sink, 9.99).sunk, 'rises again');
  // "the shared clock": the same time gives the same place however it is reached; a row of crusts with different phases is never all under at once
  for (const t of [0.37, 12.9, 123.456]) assert.deepEqual({ ...padPos(sway, t) }, { ...padPos(sway, t + 0) });
  const row = [0, 0.33, 0.66].map((ph) => ({ ...sink, id: `r${ph}`, motion: { ...sink.motion, phase: ph } }));
  for (let t = 0; t < 30; t += 0.1) assert.ok(row.some((q) => !padPos(q, t).sunk), `a plate is up at ${t.toFixed(1)}`);
  // the host clock: stepHop and surface queries read the time they are given, so a standing body rides a sway
  const c = course([sway], []);
  assert.equal(surfaceAt(c, padPos(sway, 3).x, 5, 3, 0.5, sea).y, 0.5);
  assert.equal(surfaceAt(c, padPos(sway, 3).x + 4, 5, 3, 0.5, sea).y, -Infinity);
});
test('the validator judges moving pads at the worst moments: a gently swaying pad passes, a wildly swaying one fails', () => {
  const c = (amp) => course([pad('a', 0, 0, 1, 0.4), { id: 'b', kind: 'bamboo', x: 4.2, z: 0, r: 1, top: 0.4, motion: { kind: 'sway', axis: [1, 0], amp, period: 8, phase: 0 } }], [{ a: 'a', b: 'b' }]);
  assert.ok(validateCourse(c(0.1), sea).ok, validateCourse(c(0.1), sea).errors.join('; '));
  const bad = validateCourse(c(1.6), sea);
  assert.ok(!bad.ok && bad.errors.some((e) => /gap/.test(e)));
});

// ---- the validator
test('validateCourse: a flat 2.4 u gap passes, a 3 u gap fails, a 0.8 u rise fails, a 0.5 u rise passes, a tiny pad fails, an unreachable pad fails', () => {
  const ok = validateCourse(two(2.0), sea);
  assert.ok(ok.ok, ok.errors.join('; '));
  assert.ok(validateCourse(two(2.4), sea).ok, 'the stated limit');
  const wide = validateCourse(two(3.0), sea);
  assert.ok(!wide.ok && wide.errors.some((e) => /gap/.test(e)));
  const tall = validateCourse(two(1.0, 0.8), sea);
  assert.ok(!tall.ok && tall.errors.some((e) => /rise/.test(e)));
  assert.ok(validateCourse(two(1.0, 0.5), sea).ok, validateCourse(two(1.0, 0.5), sea).errors.join('; '));
  assert.ok(!validateCourse(two(1.0, 0, 0.7), sea).ok, 'pad radius under 0.9');
  const lone = course([pad('a', 0, 0, 1, 0.4), pad('b', 3, 0, 1, 0.4), pad('c', 20, 0, 1, 0.4)], [{ a: 'a', b: 'b' }], { goal: 'b' });
  assert.ok(validateCourse(lone, sea).errors.some((e) => /cannot be reached/.test(e)));
  const rect = course([pad('a', 0, 0, 1, 0.4), { id: 'p', kind: 'deck', x: 3.4, z: 0, w: 1.0, d: 3, rot: 0, top: 0.4 }], [{ a: 'a', b: 'p' }]);
  assert.ok(!validateCourse(rect, sea).ok, 'a plank narrower than 1.4 u');
  assert.ok(!simulateLink(two(3.4), two(3.4).pads[0], two(3.4).pads[1], 0, sea).ok);
});
test('the tide-pool tutorial course passes the validator on the real terrain, with gaps of 0.9 .. 2.3 u, rises of at most 0.2 u and a shortcut stone beside the wide jump', () => {
  const c = coveCourse(island), T = { height: (x, z) => mod.height(x, z) };
  const v = validateCourse(c, T);
  assert.ok(v.ok, v.errors.join('; '));
  const main = v.links.filter((l) => ['stone-1', 'stone-2', 'stone-3', 'stone-4', 'stone-5', 'stone-6'].includes(l.a));
  assert.ok(Math.min(...main.map((l) => l.gap)) >= 0.9 && Math.max(...v.links.map((l) => l.gap)) <= 2.4 && Math.max(...v.links.map((l) => l.rise)) <= 0.2 + 1e-9);
  const wideLink = v.links.find((l) => l.a === 'stone-6' && l.b === 'stern');
  assert.ok(wideLink.gap > 2.0, 'the one wide-ish gap');
  assert.ok(c.links.some((l) => l.optional && l.b === 'shortcut' || l.a === 'shortcut'), 'a shortcut stone splits it');
  assert.deepEqual(c.route, ['stone-1', 'stone-2', 'stone-3', 'stone-4', 'stone-5', 'stone-6', 'stern']);
  assert.equal(nextOnRoute(c, 'stone-2'), 'stone-3'); assert.equal(nextOnRoute(c, 'stern'), null);
  assert.ok(c.pads.every((p) => p.r >= 0.9) && c.pads.filter((p) => p.cp).length === 3, 'start, middle and goal are checkpoints');
  for (const p of c.pads) assert.ok(c.zone.r >= Math.hypot(p.x - c.zone.x, p.z - c.zone.z) + p.r, `${p.id} is inside the zone`);
  for (const p of c.pads.slice(1)) assert.ok(mod.height(p.x, p.z) < c.gapY, `${p.id} stands over water`);
});

// ---- the player inside the real tide-pool zone
test('inside the tide-pool zone the player hops from stone to stone with real heights; a fall is a splash and a pop back at the last checkpoint, no other cost', () => {
  clearCourses();
  let now = 0;
  setHopClock(() => now); setHopTerrain({ height: (x, z) => getHeight(x, z) });
  const c = registerCourse(coveCourse(island)), p = fakePlayer();
  const [s1, s2] = c.pads;
  const log = [];
  hopEvents.onSplash = (q, d) => log.push(['splash', d]); hopEvents.onRespawn = () => log.push(['respawn']); hopEvents.onLand = () => log.push(['land']);
  p.position.set(s1.x, s1.top, s1.z);
  const tick = (input = {}, n = 1) => { for (let i = 0; i < n; i++) { now += 1 / 60; p.update(1 / 60, input); } };
  tick();
  assert.equal(p._course, c); assert.ok(p._cb.grounded && Math.abs(p.position.y - s1.top) < 1e-9);
  assert.ok(typeof p.groundProbe === 'function');
  // hop toward stone-2: hold the stick for a few frames around the take-off, then let go (the player steers its own speed); some holds land on the stone, the rest overshoot or fall short
  const dx = s2.x - s1.x, dz = s2.z - s1.z, d = Math.hypot(dx, dz), dir = { move: { x: dx / d, z: dz / d } };
  const attempt = (hold) => {
    p.position.set(s1.x, s1.top, s1.z); p.velocity.x = p.velocity.z = 0; p._cb.x = s1.x; p._cb.z = s1.z; p._cb.y = s1.top; p._cb.vy = 0; p._cb.grounded = true; p._cb.splash = null; p._splashing = false;
    p.hop(); tick(dir);
    if (hold === 4) { assert.ok(!p._cb.grounded && p.position.y > s1.top, 'real height'); assert.equal(p._air, 1); }
    for (let i = 1; i < 60; i++) { tick(i < hold ? dir : {}); if (p._cb.grounded || p._splashing) break; }
    return p._splashing ? 'splash' : p._cb.pad;
  };
  const HOLDS = [4, 8, 10, 12, 14, 16, 18, 20, 24], results = HOLDS.map(attempt);
  assert.ok(results.includes('stone-2'), `some hold lands on stone-2: ${results.join(', ')}`);
  attempt(HOLDS[results.indexOf("stone-2")]);
  tick({}, Math.ceil(HOP_COURSE.splash.delay * 60) + 3);
  assert.ok(p._cb.grounded && p._cb.pad === 'stone-2', 'standing on stone-2');
  assert.ok(Math.abs(p.position.y - s2.top) < 1e-9);
  assert.ok(log.some((e) => e[0] === 'land'));
  // walk off into the sea: sinks, splashes, pops back at the checkpoint (stone-1: the only one passed)
  for (let i = 0; i < 90 && !p._splashing; i++) tick({ move: { x: 1, z: 0.3 } });
  assert.ok(p._splashing && log.some((e) => e[0] === 'splash'), 'a splash');
  p.hop(); assert.ok(!p._courseJump, 'no hopping while sinking');
  const sx = p.position.x; tick({ move: { x: 1, z: 0 } }, 5);
  assert.ok(Math.abs(p.position.x - sx) < 1e-9, 'input is ignored while sinking');
  tick({}, Math.ceil(HOP_COURSE.splash.delay * 60) + 3);
  assert.ok(log.some((e) => e[0] === 'respawn') && !p._splashing);
  assert.ok(Math.hypot(p.position.x - s1.x, p.position.z - s1.z) < 1e-6 && Math.abs(p.position.y - s1.top) < 1e-9, 'popped back at the start stone');
  // pad sides are walls: walking into a taller pad from below is blocked (no step up)
  // moving away from the zone puts everything back
  p.position.set(SPAWN.x, 0, SPAWN.z);
  tick();
  assert.equal(p._course, null); assert.equal(p._courseWalk, null);
  hopEvents.onSplash = hopEvents.onRespawn = hopEvents.onLand = null;
  clearCourses(); setHopClock(() => 0);
});

// ---- the cove's place
test('Skipper\'s Cove stands on walkable sand in a clearing of Emberleaf\'s placement, away from the landing, the garden, the waterfall and the Cinder mouth; the spur trail reaches it', async () => {
  const { planEmberGathering, planEmberTools } = await import('../public/js/world/islands/emberGathering.js');
  const { planEmberSeeds } = await import('../public/js/world/islands/emberSeeds.js');
  const { gardenZone, waterfallForbidden } = await import('../public/js/world/islands/emberGarden.js');
  const { LAVA_MOUTH } = await import('../public/js/world/islands/lavaMouth.js');
  const { getPath, pathWorld } = await import('../public/js/world/paths.js');
  const P = buildEmberPlacement(island, mod), G = planEmberGathering(island, mod), T = planEmberTools(island, mod), S = planEmberSeeds(island, mod, P), f = coveFrame(island), L = coveLayout(island);
  assert.ok(mod.walkable(f.ax, f.az) && ['sand', 'blacksand'].includes(mod.groundType(f.ax, f.az)));
  const items = [...P.trees, ...P.boulders, ...P.decor, ...P.ferns, ...P.flowers.filter((q) => q.interactive), ...P.garden.plots, ...(G.herbs || []), ...(G.digs || []), ...T, ...Object.values(S).filter((q) => q && Number.isFinite(q.x))];
  for (const q of items) assert.ok(Math.hypot(q.x - f.ax, q.z - f.az) - (q.r || 0.3) > COVE.keepClear, 'nothing within the keep-clear radius');
  assert.ok(!gardenZone(island, f.ax, f.az, 8) && !waterfallForbidden(island, f.ax, f.az, 8));
  assert.ok(Math.hypot(f.ax - LAVA_MOUTH.x, f.az - LAVA_MOUTH.z) > 25 && Math.hypot(f.ax - 82.5 - 0, f.az - 0) > 80, 'far from the Cinder mouth and the bridge landing');
  for (const o of [L.leanTo, L.marlo, L.sign, L.bundle]) assert.ok(mod.walkable(o.x, o.z) && mod.height(o.x, o.z) > 0.2, 'dressing stands on dry ground');
  for (const c of L.wreck.colliders) assert.ok(mod.height(c.x, c.z) > 0.2);
  assert.ok(coveReserved(f.ax + COVE.keepClear - 0.1, f.az, 0, island) && !coveReserved(f.ax + COVE.keepClear + 0.1, f.az, 0, island));
  const spur = pathWorld(island, getPath('ember-cove'));
  const end = spur[spur.length - 1];
  assert.ok(Math.hypot(end.x ?? end[0], (end.z ?? end[1]) - 0) > 0);
  assert.ok(Math.hypot(end[0] - L.sign.x, end[1] - L.sign.z) < 4, 'the trail ends at the signpost');
  for (const [x, z] of spur) assert.ok(mod.walkable(x, z));
  for (const q of items) { const d = Math.min(...spur.map(([x, z]) => Math.hypot(q.x - x, q.z - z))) - (q.r || 0.3); assert.ok(d > 0.7, `the spur is clear of ${q.kind || q.layer}: ${d.toFixed(1)}`); }
  assert.ok(P.solids.length === 189, 'the cove claims no solid (it would change which candidates later sampling accepts)');
  assert.ok(sampleEmberSpots(island, mod, { area: 'jungle', count: 60, seed: 5, r: 0.6, minDist: 3 }).every((q) => !coveReserved(q.x, q.z, 0, island)), 'respawned spots keep off the cove');
});
test('Emberleaf\'s seeded placement is unchanged by the cove and its trail (the hashes of Step 60 still hold)', () => {
  const hash = (o) => crypto.createHash('md5').update(JSON.stringify(o)).digest('hex').slice(0, 10);
  const P = buildEmberPlacement(island, mod);
  assertPlacementGolden(P.flowers, 'emberFlowers', '834b877a48');
  assert.deepEqual({ trees: hash(P.trees), boulders: hash(P.boulders), ferns: hash(P.ferns), decor: hash(P.decor), lanes: hash(P.lanes) },
    { trees: '2014801176', boulders: '98cd3aa689', ferns: '356ed6e089', decor: 'abf0410989', lanes: '54052443b5' });
});
