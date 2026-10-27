// Step 74d rules, authority, integration, terrain, registry and rendering contracts (no browser).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CARRY, ICE, ISLANDS, GUIDE, PLAYER_RADIUS } from '../public/js/config.js';
import { createCarryState, carriedBy, validatePick, applyPick, applyDrop, putDown, waterDrop } from '../public/js/game/carryLogic.js';
import { createCarry } from '../public/js/game/carry.js';
import { warmth } from '../public/js/game/warmLogic.js';
import { createWarm } from '../public/js/game/warm.js';
import { freshGuide, startGuide, stepGuide } from '../public/js/game/guideLogic.js';
import { createGuide } from '../public/js/game/guide.js';
import { slideVelocity, rideFloe, tiltLoad } from '../public/js/game/iceLogic.js';
import { createIce } from '../public/js/game/ice.js';
import { WorldSync } from '../public/js/net/worldSync.js';
import { padPos, padTop, surfaceAt, simulateLink, validateCourse, stepHop, courses, clearCourses, hopEvents, registerCourse, unregisterCourse, setHopClock } from '../public/js/game/hopLogic.js';
import { mechlabPlan } from '../public/js/world/islands/mechlabPlan.js';
import { createMechlab } from '../public/js/world/mechlab.js';
import { createHopCourses } from '../public/js/world/hopCourses.js';
import { getHeight, isWalkable, getGroundType } from '../public/js/world/terrain.js';
import { getColliders, overlapsAny } from '../public/js/world/colliders.js';
import { getInteractables, removeInteractable } from '../public/js/world/interactables.js';
import { registerFrostGameplay } from '../public/js/world/islands/frostWorld.js';
import { campReserved } from '../public/js/world/islands/frostCamp.js';
import { campStageLayout } from '../public/js/world/islands/frostCampStages.js';
import { Player } from '../public/js/player/player.js';
const defs = [{ id: 'ball', carryable: true, x: 0, y: 1, z: 0 }];
const pos = { x: 0, y: 1, z: 0 }, sea = { height: () => -3 }, plan = mechlabPlan();
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
test('carry: one creature per carrier, one carrier per creature, reach and carryable validation', () => {
  const s = createCarryState([...defs, { id: 'other', carryable: true, ...pos }]);
  assert.equal(validatePick(s, 'host:2', 'ball', pos), null);
  const next = applyPick(s, 'host:2', 'ball');
  assert.equal(s.objects.ball.carrier, null); assert.equal(carriedBy(next, 'host:2'), 'ball');
  assert.equal(validatePick(next, 'host:1', 'ball', pos), 'occupied');
  assert.equal(validatePick(next, 'host:2', 'other', pos), 'occupied');
  assert.equal(validatePick(s, 'host:1', 'missing', pos), 'object');
  assert.equal(validatePick(s, 'host:1', 'ball', { ...pos, x: 99 }), 'far');
  assert.equal(validatePick(s, 'host:1', 'ball', { ...pos, y: 99 }), 'far');
});
test('carry: put-down searches in front and refuses unsafe water or occupied spots', () => {
  assert.deepEqual(putDown(pos, 0, () => 1), { x: 0, y: 1, z: CARRY.dropDistance });
  let tries = 0; assert.ok(putDown(pos, 0, () => ++tries === 3 ? 2 : null)); assert.equal(tries, 3);
  assert.equal(putDown(pos, 0, () => null), null);
  const s = applyPick(createCarryState(defs), 'host:3', 'ball');
  const next = applyDrop(s, 'host:3', { x: 2, y: 1, z: 1 });
  assert.equal(next.objects.ball.carrier, null); assert.equal(next.objects.ball.x, 2);
});
test('carry: water drop uses checkpoint, never water position', () => {
  const cp = { x: 5, y: .25, z: 4 }; assert.deepEqual(waterDrop(cp), cp); assert.equal(waterDrop({ x: NaN }), null);
  const next = applyDrop(applyPick(createCarryState(defs), 'host:1', 'ball'), 'host:1', waterDrop(cp));
  assert.deepEqual(next.objects.ball, { ...defs[0], ...cp, carrier: null });
});
for (const kind of ['drift', 'spin', 'tilt']) test(`floe ${kind}: deterministic shared-clock poses and closed cycle`, () => {
  const p = { x: 3, z: 4, top: .25, r: 1.4, kind: 'floe', motion: { kind, period: 12, amp: 1.2 }, load: { x: .1, z: -.1, sink: .06 } };
  const def = JSON.stringify(p);
  for (let i = 0; i < 120; i++) assert.deepEqual({ ...padPos(p, i / 7) }, { ...padPos(JSON.parse(def), i / 7) });
  const a = { ...padPos(p, 3) }, b = { ...padPos(p, 15) }; near(a.x, b.x); near(a.z, b.z); near(a.top, b.top);
  assert.equal(JSON.stringify(p), def);
});
test('floe spin carries the feet around its centre and drift carries translation', () => {
  const p = rideFloe({ x: 2, z: 0 }, { x: 0, z: 0, rot: 0 }, { x: 1, z: 3, rot: Math.PI / 2 });
  near(p.x, 1); near(p.z, 5);
  assert.deepEqual(rideFloe({ x: 2, z: 2 }, { x: 1, z: 1 }, { x: 3, z: 4 }), { x: 4, z: 5 });
});
test('floe tilt lowers the loaded edge and sinks further with two players', () => {
  const p = { x: 0, z: 0, r: 1.4, top: .25, kind: 'floe', motion: { kind: 'tilt', period: 12 } };
  p.load = tiltLoad([{ x: 1, z: 0 }], p); const one = { ...padPos(p, 5) };
  assert.ok(padTop(p, one, 1, 0) < padTop(p, one, -1, 0));
  p.load = tiltLoad([{ x: 1, z: 0 }, { x: 1, z: 0 }], p);
  assert.ok(padPos(p, 5).top < one.top); assert.ok(p.load.sink <= ICE.sink);
});
test('floe validation: five pads, all four kinds, genuine wait window, carry jump works', () => {
  const c = plan.floes;
  assert.equal(c.pads.length, 5); assert.equal(c.links.filter(l => l.wait).length, 1);
  assert.deepEqual(new Set(c.pads.map(p => p.motion?.kind || 'still')), new Set(['still', 'drift', 'spin', 'tilt']));
  for (const opts of [{}, { speedScale: CARRY.speed, jumpScale: CARRY.jump }]) {
    const back = { ...c, start: c.goal, goal: c.start, links: c.links.map(l => ({ ...l, a: l.b, b: l.a })) };
    const reverse = validateCourse(back, { height: getHeight }, opts); assert.equal(reverse.ok, true, reverse.errors.join('\n'));
    const v = validateCourse(c, { height: getHeight }, opts); assert.equal(v.ok, true, v.errors.join('\n'));
  }
  const successes = Array.from({ length: 24 }, (_, i) => simulateLink(c, c.pads[0], c.pads[1], i / 2, sea).ok);
  assert.ok(successes.some(Boolean)); assert.ok(successes.some(v => !v));
  const impossible = structuredClone(c); impossible.pads[1].z += 30;
  assert.equal(validateCourse(impossible, sea).ok, false);
});
test('floe momentum: release slides, input converges, subdivision is stable and zero time unchanged', () => {
  const v = { x: 5, z: -2 }, target = { x: 0, z: 0 };
  const next = slideVelocity(v, target, .1); assert.ok(next.x > 0 && next.x < v.x);
  const half = slideVelocity(slideVelocity(v, target, .05), target, .05); near(half.x, next.x); near(half.z, next.z);
  assert.deepEqual(slideVelocity(v, target, 0), v);
  assert.ok(slideVelocity(v, target, 10).x < .001); assert.deepEqual(v, { x: 5, z: -2 });
});
test('carrying shortens a real hop body and moving floes have no landing magnet', () => {
  const body = { x: -25, z: -91, y: .25, vy: 0, grounded: true, pad: 'ice-0' };
  stepHop(body, { jump: true }, plan.floes, 0, 1 / 60, sea, { jumpScale: CARRY.jump });
  near(body.vy, 5.6 * CARRY.jump - 24 / 60);
  const p = { ...plan.floes.pads[1], x: 0, z: 0, motion: { kind: 'spin', period: 12 } };
  const b = { x: p.r + .1, z: 0, y: p.top + .03, vy: -3, grounded: false };
  const ev = stepHop(b, {}, { ...plan.floes, pads: [p] }, 0, .02, sea); assert.equal(ev.shift, undefined);
});
test('warmth: lit ring only, additive gifts, monotone curve, clamps, no day/night input', () => {
  const context = { pos, fire: pos, fuel: 1 };
  near(warmth(0, 15, context), .5); near(warmth(0, 30, context), 1);
  assert.equal(warmth(.2, 99, { ...context, fuel: 0 }, 1), .2);
  assert.equal(warmth(.2, 99, { ...context, carried: true }, 1), .2);
  assert.equal(warmth(.2, 99, { ...context, pos: { ...pos, x: pos.x + 4.5 } }, 1), .2);
  assert.equal(warmth(0, 0, context, .25), .25); assert.equal(warmth(.9, 99, context, 1), 1);
  assert.equal(warmth(.2, -10, context, -3), .2);
  let v = 0; for (let i = 0; i < 300; i++) v = warmth(v, .1, context); near(v, 1);
});
const path = [{ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 3, hop: true }, { x: 0, y: 1, z: 6, balance: true }];
const people = [{ key: 'host:0', ...path[0] }, { key: 'host:2', ...path[0] }];
test('guide runs with nearby players, waits for the slowest, resumes when they catch up', () => {
  let s = startGuide(path, people); s = stepGuide(s, path, people, .2); assert.ok(s.z > 0); assert.equal(s.waiting, false);
  const lag = [{ ...people[0], z: s.z }, { ...people[1], z: -GUIDE.wait - 1 }];
  const held = stepGuide(s, path, lag, 1); assert.equal(held.z, s.z); assert.equal(held.waiting, true);
  assert.ok(stepGuide(held, path, people, .2).z > held.z);
  assert.equal(stepGuide(s, path, [], 1).waiting, true);
});
test('guide hop arcs, progresses checkpoints, catches fall/lost separately per player, finishes', () => {
  let s = startGuide(path, people); s = stepGuide(s, path, people, .4); assert.ok(s.y > 1);
  s = stepGuide(s, path, people, 1); assert.equal(s.index, 1);
  s = stepGuide(s, path, [{ ...people[0], z: 3 }, people[1]], .1); assert.equal(s.checkpoints['host:0'], 1); assert.equal(s.checkpoints['host:2'], 0);
  s = stepGuide(s, path, [{ ...people[0], z: 3, fall: true }, { ...people[1], z: -100 }], .1);
  assert.equal(s.catches['host:0'].z, 3); assert.equal(s.catches['host:2'].z, 0);
  s = stepGuide(s, path, people.map(p => ({ ...p, z: 3 })), 2); assert.equal(s.index, 2); assert.equal(s.running, false);
  assert.equal(stepGuide(freshGuide(path), path, people, 1).running, false);
});
function pair() {
  const h = new WorldSync(), r = new WorldSync({ role: 'replica' }), queue = [];
  const hp = { index: 2, position: { ...pos } }, rp = { index: 1, position: { ...pos } };
  const actors = () => [{ key: 'host:2', pos: hp.position, yaw: 0 }, { key: `${r.screenId}:1`, pos: rp.position, yaw: 0 }];
  const opts = sync => ({ sync, defs, safe: () => 1, actors, checkpoint: () => ({ x: 5, y: .25, z: 5 }) });
  const hc = createCarry(opts(h)), rc = createCarry(opts(r));
  const gp = () => actors().map(a => ({ key: a.key, ...a.pos }));
  const hg = createGuide({ sync: h, paths: { wolf: path }, players: gp }), rg = createGuide({ sync: r, paths: { wolf: path }, players: gp });
  const context = () => ({ pos: hc.state.objects.ball, fire: pos, fuel: 10 });
  const hw = createWarm({ sync: h, ids: ['ball'], context }), rw = createWarm({ sync: r, ids: ['ball'], context });
  h.attachHost({ sendTo: (_, m) => queue.push([r, structuredClone(m)]), broadcast: m => queue.push([r, structuredClone(m)]) });
  r.attachReplica({ send: m => { queue.push([h, structuredClone(m)]); return true; } });
  function flush() { while (queue.length) { const [to, m] = queue.shift(); to === h ? h.screenMessage(1, m) : r.receive(m); } }
  r.linkUp(); h.screenConnected(1, { clientId: 'mechanic-friend' }); flush();
  return { h, r, hp, rp, hc, rc, hg, rg, hw, rw, flush, equal: () => assert.equal(h.hash(), r.hash()) };
}
test('carry host/replica: requests never predict; races, drop, water drop, snapshots have equal hashes', async () => {
  const t = pair(); let req = t.rc.pick(t.rp, 'ball'); assert.equal(t.rc.state.objects.ball.carrier, null);
  t.flush(); assert.equal((await req).ok, true); t.equal();
  assert.equal(t.hc.pick(t.hp, 'ball').ok, false);
  req = t.rc.drop(t.rp); t.flush(); assert.equal((await req).ok, true); t.equal();
  req = t.rc.pick(t.rp, 'ball'); t.flush(); assert.equal((await req).ok, true);
  req = t.rc.fall(t.rp); t.flush(); assert.equal((await req).ok, true); t.equal();
  assert.equal(t.hc.state.objects.ball.x, 5); assert.equal(t.hc.state.objects.ball.y, .25);
});
test('carry host drops a departing local carrier', () => {
  const sync = new WorldSync(); let active = [{ key: 'host:3', pos, yaw: 0 }];
  const c = createCarry({ sync, defs, safe: () => 1, actors: () => active });
  const p = { index: 3, position: pos }; assert.equal(c.pick(p, 'ball').ok, true);
  active = []; c.update(); assert.equal(c.state.objects.ball.carrier, null);
});
test('carry host screenLeft releases a remote creature', async () => {
  const t = pair(), req = t.rc.pick(t.rp, 'ball'); t.flush(); await req;
  t.h.domains.get('carry').screenLeft(t.r.screenId); t.flush(); t.equal(); assert.equal(t.hc.state.objects.ball.carrier, null);
});
test('guide host/replica: replica start/reset cannot predict, host alone steps, catch state hashes match', async () => {
  const t = pair(); const req = t.rg.start('wolf', t.rp); assert.equal(t.rg.state.wolf.running, false);
  t.flush(); assert.equal((await req).ok, true); t.equal();
  const before = structuredClone(t.rg.state); t.rg.update(10); assert.deepEqual(t.rg.state, before);
  t.hg.update(.5); t.flush(); t.equal(); assert.ok(t.rg.state.wolf.z > 0);
  t.rp.position.z = -100; t.hg.update(.1); t.flush(); t.equal(); assert.ok(t.rg.state.wolf.catches[`${t.r.screenId}:1`]);
  const reset = t.rg.reset('wolf'); t.flush(); assert.equal((await reset).ok, false);
  assert.equal(t.hg.reset('wolf').ok, true); t.flush(); t.equal();
});
test('warming host/replica: only host time/gifts change warmth and match hashes', async () => {
  const t = pair(); t.hw.update(3); t.flush(); t.equal(); near(t.rw.state.ball, .1);
  t.rw.update(300); near(t.rw.state.ball, .1);
  const req = t.rw.give('ball', 3); t.flush(); assert.equal((await req).ok, false);
  assert.equal(t.hw.give('ball', 1).ok, true); t.flush(); t.equal(); near(t.rw.state.ball, .35);
});
test('floe loads: host counts both players; replicas mirror rather than recompute', () => {
  const sync = new WorldSync(); const p = structuredClone(plan.floes.pads[3]); let n = 1;
  const ice = createIce({ sync, pads: [p], clock: () => 0, actors: () => Array.from({ length: n }, () => ({ pos: { x: p.x + 1, y: p.top, z: p.z } })) });
  ice.update(); assert.equal(p.load.sink, 0); n = 2; ice.update(); assert.ok(p.load.sink > 0);
  assert.deepEqual(ice.summary()[p.id], p.load);
});
test('mechlab placement: real terrain, camp final stages/dens clear and guide corridor clear of seeded props', () => {
  const island = ISLANDS.find(i => i.id === 'frost'), reserved = campReserved(island), layout = campStageLayout(island);
  registerFrostGameplay(island);
  const keepouts = [...reserved.dens, ...Object.values(layout.footprints).flat()];
  for (const p of [plan.carry, ...plan.path]) {
    assert.ok(isWalkable(p.x, p.z));
    assert.ok(keepouts.every(k => Math.hypot(k.x - p.x, k.z - p.z) > k.r + .6));
  }
  for (let z = -151; z <= -124; z += .25) assert.equal(overlapsAny(-26, z, .9), false, String(z));
  assert.ok(plan.path.length >= 8 && plan.path.length <= 12); assert.ok(plan.path.some(p => p.hop)); assert.ok(plan.path.some(p => p.balance));
  assert.ok(plan.path[4].y - getHeight(-26, -140.5) < .6);
  const route = validateCourse(plan.guideCourse, { height: getHeight }); assert.equal(route.ok, true, route.errors.join('\n'));
  for (const p of plan.floes.pads.slice(1)) assert.ok(getHeight(p.x, p.z) < -.1);
});
test('normal world import creates no courses/interactables/colliders or slippery lake', () => {
  assert.equal(courses().some(c => c.id.startsWith('mechlab')), false);
  assert.equal(getInteractables().some(i => i.type === 'carryable' || i.type === 'guide'), false);
  assert.equal(getGroundType(52, -159), 'ice');
  const p = Object.create(Player.prototype); p._wet = false; p._ice = false;
  assert.equal(p.carrying, undefined); assert.equal(p._ice, false);
});
function bodyPlayer(x, z) {
  const p = Object.create(Player.prototype);
  Object.assign(p, { radius: PLAYER_RADIUS, position: new THREE.Vector3(x, getHeight(x, z), z), velocity: { x: 0, z: 0 }, facing: 0, root: { rotation: { y: 0 } }, frozen: false, paused: false, downed: false, speedScale: 1, moveGuard: null,
    _noGuard: false, _faceTo: null, speed: 0, moving: false, _t: 0, _hurtT: -1, _dash: null, pageDrive: null, _turnRate: 0, _wasInput: false, _prevSpeed: 0, _sq: 0, _sqVel: 0, _swingT: -1, _hopY: 0, _hopVel: 0,
    groundProbe: null, _course: null, _cb: null, _courseWalk: null, _courseJump: false, _splashing: false, _wet: false, _air: 0, _savedProbe: null });
  p._animatePose = p._updateDust = p.dustBurst = () => {};
  return p;
}
test('real player: carry speed is 75%, tools cannot swing, emote hop is shorter', () => {
  const p = bodyPlayer(0, 0), c = bodyPlayer(0, 0); c.carrying = true;
  for (let i = 0; i < 45; i++) { p.update(1 / 60, { move: { x: 1, z: 0 } }); c.update(1 / 60, { move: { x: 1, z: 0 } }); }
  near(c.speed / p.speed, CARRY.speed); assert.equal(c.swing(), false);
  p.hop(); c.hop(); near(c._hopVel / p._hopVel, CARRY.jump);
});
test('real player: floe release slides; frozen lake uses ordinary damping without mechlab', () => {
  let now = 0; setHopClock(() => now);
  const c = { id: 'test-ice', zone: { x: 0, z: -400, r: 15 }, gapY: -.1, pads: [{ id: 'pad', kind: 'floe', x: 0, z: -400, r: 10, top: .25, cp: true }], start: 'pad', goal: 'pad', links: [] };
  registerCourse(c);
  const icy = bodyPlayer(0, -400); icy.position.y = .25;
  const lake = bodyPlayer(52, -159);
  for (const p of [icy, lake]) { p.velocity.x = 2; p.update(1 / 60, { move: { x: 0, z: 0 } }); }
  assert.equal(icy._ice, true); assert.equal(!!lake._ice, false);
  icy.velocity.x = lake.velocity.x = 2; now += .1;
  for (const p of [icy, lake]) p.update(.05, { move: { x: 0, z: 0 } });
  assert.ok(icy.velocity.x > lake.velocity.x);
  unregisterCourse(c);
});
test('mechlab flag disables all central game-state save reads/writes/clears', async () => {
  const oldLocation = globalThis.location, oldStorage = globalThis.localStorage;
  let reads = 0, writes = 0;
  globalThis.location = { search: '?mechlab' };
  globalThis.localStorage = { getItem() { reads++; return '{}'; }, setItem() { writes++; }, removeItem() { writes++; } };
  try {
    const save = await import('../public/js/game/save.js?mechlab-test');
    assert.equal(save.saveEnabled, false); assert.equal(save.loadSave('anything'), null);
    save.writeSave('anything', {}); save.clearSave('anything'); assert.equal(reads, 0); assert.equal(writes, 0);
  } finally { globalThis.location = oldLocation; globalThis.localStorage = oldStorage; }
});
test('mechlab fresh-load runtime, keyboard/debug pickup-drop-warm-guide, visuals/rebuild budget', () => {
  const scene = new THREE.Scene(), sync = new WorldSync(), root = new THREE.Group(), rig = new THREE.Group(); root.add(rig); scene.add(root);
  const p = { index: 2, position: root.position, root, parts: { rig }, facing: 0,
    teleport(x, z) { this.position.set(x, getHeight(x, z), z); }, hop() { this.hopped = true; } };
  const players = { list: [p] }, fire = { fuel: 0, setFuel(n) { this.fuel = n; } }, world = { regions: { isFull: () => true } };
  const hop = createHopCourses({ scene, players, sync, world });
  const hooks = { ...hopEvents }, before = getInteractables().length, nc = getColliders().length;
  const held = { holder: p, pivot: new THREE.Group() };
  const lab = createMechlab({ scene, sync, players, avatars: { list: [] }, hop, items: { heldBy: () => held }, fire, world });
  assert.equal(fire.fuel, 180); assert.equal(getInteractables().length, before + 2); assert.equal(getColliders().length, nc);
  lab.goto('carry'); const target = getInteractables().find(i => i.type === 'carryable'); target.onInteract(target, p); lab.update(0);
  assert.equal(p.carrying, true); assert.equal(held.pivot.visible, false); assert.ok(scene.getObjectByName('mechlab').visible);
  assert.equal(lab.drive(p, { jumpPressed: true }), true); assert.equal(p.hopped, true);
  lab.goto('warm'); lab.drive(p, { interactPressed: true }); lab.update(1);
  assert.equal(p.carrying, false); assert.equal(held.pivot.visible, true); assert.ok(lab.warm.state.snowball > 0);
  assert.equal(lab.warm.give('snowball', 4).ok, true); near(lab.warm.state.snowball, 1);
  lab.goto('guide'); assert.equal(lab.guide.start('wolf', p).ok, true); lab.update(.2); assert.ok(lab.guide.state.wolf.z > plan.guide.z);
  lab.goto('floes'); hop.update(0); const summary = hop.summary(); assert.equal(summary.courses.find(c => c.id === 'mechlab-floes').floes.length, 5);
  const count = getInteractables().length; world.regions.isFull = () => false; hop.update(0); lab.update(0);
  world.regions.isFull = () => true; hop.update(0); lab.update(0); assert.equal(getInteractables().length, count);
  assert.ok(hop.summary().drawCalls <= 9); assert.equal(lab.summary().drawCalls, 4); assert.equal(lab.summary().lights, 0);
  for (const c of [lab.plan.floes, lab.plan.guideCourse]) hop.remove(c);
  for (const i of getInteractables().slice(before)) removeInteractable(i);
  Object.assign(hopEvents, hooks);
});
