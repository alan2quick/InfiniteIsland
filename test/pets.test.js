// Step 73a: the pet framework. Pure rules (ids, wire format, prefs, glide height, heel mirroring, follow / swoop / poof, banking, idles, hide spot), the Capray model (draw calls, size, shared material,
// attributes), the `pets` sync domain on a real host + replica pair (unlock, hashes, late snapshot, saves, ?testpet), pose field 16, and the runtime (build lazily, follow, poof, hide, dispose, prefs fallback).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WorldSync } from '../public/js/net/worldSync.js';
import { PET, WATER_LEVEL, VERSION } from '../public/js/config.js';
import {
  PET_IDS, encodePetId, decodePetId, petIndexOf, petIdAt, normaliseUnlocked, mergeUnlocked, clampPet, parsePetPrefs, glideTarget, heelPoint, followStep, catchState, shouldPoof,
  poseStep, petMood, appearScale, createIdle, stepIdle, pickIdle, idleDrive, hideSpotOf, nearestGiant, IDLE_KINDS, forwardOf, leftOf,
} from '../public/js/game/petLogic.js';
import { encodePose, decodePose } from '../public/js/net/poseBuffer.js';
import { mulberry32 } from '../public/js/utils/rng.js';
import { SlotTable } from '../public/js/players/slotTable.js';
import { createPlayersDomain } from '../public/js/net/playersDomain.js';
const storage = new Map();
globalThis.localStorage = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) };
const { createPetsDomain, PETS_KEY } = await import('../public/js/game/petsDomain.js');
const { createPetModel, PETS, petMaterial, petUniforms } = await import('../public/js/npc/pets.js');
const { createPets, STORAGE_KEY } = await import('../public/js/world/pets.js');

test('the version is 0.82.3', () => { assert.equal(VERSION, '0.82.3'); });

// ---- ids and the wire ---------------------------------------------------------------------------------------------------------------------------------------------------------
test('ids: Capray first, pose ids are 1 + index, 0 / junk decode as none, the model registry has the same order', () => {
  assert.deepEqual(PET_IDS, ['capray']);
  assert.equal(petIndexOf('capray'), 0); assert.equal(petIndexOf('nope'), -1); assert.equal(petIdAt(0), 'capray'); assert.equal(petIdAt(5), null);
  assert.equal(encodePetId(-1), 0); assert.equal(encodePetId(0), 1); assert.equal(encodePetId(1), 0); assert.equal(encodePetId(undefined), 0);
  assert.equal(decodePetId(0), -1); assert.equal(decodePetId(1), 0); assert.equal(decodePetId(2), -1); assert.equal(decodePetId('x'), -1);
  assert.deepEqual(PETS.map((p) => p.id), PET_IDS);
});

test('lists and per-screen choices are sanitised; a pet that is not unlocked falls back to none', () => {
  assert.deepEqual(normaliseUnlocked(['capray', 'capray', 'ghost', 3]), ['capray']);
  assert.deepEqual(normaliseUnlocked('capray'), []); assert.deepEqual(normaliseUnlocked(null), []);
  assert.deepEqual(mergeUnlocked(['capray'], ['capray', 'x']), ['capray']);
  assert.equal(clampPet('capray', ['capray']), 'capray'); assert.equal(clampPet('capray', []), null); assert.equal(clampPet('ghost', ['ghost']), null); assert.equal(clampPet(3, ['capray']), null);
  assert.deepEqual(parsePetPrefs('{"0":"capray","1":"ghost","7":"capray","x":"capray","2":3}'), { 0: 'capray' });
  assert.deepEqual(parsePetPrefs('not json'), {}); assert.deepEqual(parsePetPrefs('[1]'), {}); assert.deepEqual(parsePetPrefs(null), {});
});

test('pose field 16 carries the pet; old 15-field packets decode as no pet and the pose still decodes', () => {
  const player = { index: 2, position: { x: 1, y: 0, z: 2 }, velocity: { x: 0, z: 0 }, facing: 0, character: { hat: null }, petIndex: 0 };
  const wire = encodePose(player, -1, 7);
  assert.equal(wire.length, 16); assert.equal(wire[15], 1);
  assert.equal(decodePose(wire).pet, 0 + 1);
  assert.equal(decodePetId(decodePose(wire).pet), 0);
  assert.equal(decodePose(wire.slice(0, 15)).pet, 0);                       // an older packet
  assert.equal(decodePetId(decodePose(wire.slice(0, 15)).pet), -1);
  const none = encodePose({ ...player, petIndex: -1 }, -1, 8); assert.equal(none[15], 0);
  const undef = encodePose({ ...player, petIndex: undefined }, -1, 9); assert.equal(undef[15], 0);
});

test('worldSync relays screen-owned pet and optional variant poses and drops an 18-field packet', () => {
  const host = new WorldSync({ role: 'host', wallNow: () => 1000 });
  const table = new SlotTable(4);
  createPlayersDomain({ sync: host, table });
  table.claim('host', 'p1'); table.claim('s1', 'local');
  const sent = [];
  host.attachHost({ sendTo: (_id, msg) => sent.push(msg), broadcast: (msg) => sent.push(msg) });
  host.screenConnected('t1', { clientId: 'first' });
  const wire = [1, 700, 0, 150, 0, 0, 0, 0, -1, 0, 3, 0, 0, 0, 0, 1];
  host.screenMessage('t1', { type: 'poses', p: [wire] });
  assert.deepEqual(host._poses.get(1), wire); assert.equal(decodePetId(decodePose(host._poses.get(1)).pet), 0);
  host.screenMessage('t1', { type: 'poses', p: [[...wire, 5]] });
  assert.equal(host._poses.get(1).length, 17);
  assert.equal(decodePose(host._poses.get(1)).variant, 'sunny');
  host.screenMessage('t1', { type: 'poses', p: [[...wire, 5, 0]] });
  assert.equal(host._poses.get(1).length, 17, 'an 18-field packet was ignored');
});

// ---- motion ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
test('glide height: 0.9-1.4 over land, lower over water, lower when sleepy / settled, always above the surface', () => {
  const hs = [];
  for (let t = 0; t < 14; t += 0.1) hs.push(glideTarget({ ground: 3, t }) - 3);
  assert.ok(Math.min(...hs) >= PET.glideMin - 1e-9 && Math.max(...hs) <= PET.glideMax + 1e-9, 'within the glide band');
  assert.ok(Math.max(...hs) - Math.min(...hs) > 0.4, 'it bobs');
  const water = glideTarget({ ground: -2, t: 1 });
  assert.ok(Math.abs(water - (WATER_LEVEL + PET.waterGlide)) < 1e-9, 'over water it skims above the surface, not the sea floor');
  assert.ok(water < glideTarget({ ground: 1, t: 1 }) - 0.2 + 1, 'and lower than over land');
  assert.ok(glideTarget({ ground: 3, t: 2, sleepy: true }) < glideTarget({ ground: 3, t: 2 }));
  assert.ok(glideTarget({ ground: 3, t: 2, settle: true }) < glideTarget({ ground: 3, t: 2 }));
});

test('heel point: behind and to the left; odd slots mirror to the right; facing rotates it; settle sits closer', () => {
  const o = { x: 10, z: 20, facing: 0 };                                     // facing +Z: behind = -Z, left = +X
  const h0 = heelPoint(o, 0), h1 = heelPoint(o, 1);
  assert.ok(Math.abs(h0.x - (10 + PET.heelSide)) < 1e-9 && Math.abs(h0.z - (20 - PET.heelBack)) < 1e-9);
  assert.ok(Math.abs(h1.x - (10 - PET.heelSide)) < 1e-9 && Math.abs(h1.z - h0.z) < 1e-9, 'slot 1 is the mirror image');
  assert.ok(Math.hypot(heelPoint(o, 2).x - h0.x, heelPoint(o, 2).z - h0.z) < 1e-9, 'slots 0 and 2 share a side (they are different owners far apart in practice)');
  const east = heelPoint({ x: 0, z: 0, facing: Math.PI / 2 }, 0);             // facing +X: behind = -X, left = -Z
  assert.ok(east.x < -PET.heelBack + 1e-6 && east.z < -PET.heelSide + 1e-6);
  const f = forwardOf(0.7), l = leftOf(0.7); assert.ok(Math.abs(f.x * l.x + f.z * l.z) < 1e-12, 'forward and left are perpendicular');
  const settle = heelPoint(o, 0, { settle: true });
  assert.ok(Math.hypot(settle.x - o.x, settle.z - o.z) < Math.hypot(h0.x - o.x, h0.z - o.z));
});

function follow(owner, seconds, s = { x: 0, y: 2, z: 0, vx: 0, vy: 0, vz: 0 }, dt = 1 / 60) {
  let max = 0;
  for (let t = 0; t < seconds; t += dt) {
    owner.step(dt);
    const heel = heelPoint(owner, 0);
    const target = { x: heel.x, y: 1.5, z: heel.z };
    const dist = Math.hypot(target.x - s.x, target.z - s.z);
    followStep(s, target, { x: owner.vx, y: 0, z: owner.vz }, dt, { catching: catchState(dist) });
    max = Math.max(max, dist);
  }
  return { s, max };
}

test('follow: the damped spring settles on the heel, keeps up with a runner without lag, never overshoots wildly', () => {
  const still = { x: 5, z: 5, facing: 0, vx: 0, vz: 0, step() {} };
  const r = follow(still, 6);
  const heel = heelPoint(still, 0);
  assert.ok(Math.hypot(r.s.x - heel.x, r.s.z - heel.z) < 0.02 && Math.abs(r.s.y - 1.5) < 0.02, 'settled');
  assert.ok(Math.hypot(r.s.vx, r.s.vz) < 0.02);
  const runner = { x: 0, z: 0, facing: Math.PI / 2, vx: 5.6, vz: 0, step(dt) { this.x += this.vx * dt; } };
  const run = follow(runner, 8);
  const hr = heelPoint(runner, 0);
  assert.ok(Math.hypot(run.s.x - hr.x, run.s.z - hr.z) < 0.35, `a steady run leaves no lag (${Math.hypot(run.s.x - hr.x, run.s.z - hr.z).toFixed(2)})`);
});

test('catch-up: past PET.catchUp the swoop is faster than the cruise limit; beyond PET.lost it poofs', () => {
  assert.equal(catchState(PET.catchUp - 0.1), false); assert.equal(catchState(PET.catchUp + 0.1), true);
  assert.equal(shouldPoof(PET.lost - 0.1), false); assert.equal(shouldPoof(PET.lost + 0.1), true);
  const cruise = { x: 0, y: 1, z: 0, vx: 0, vy: 0, vz: 0 }, swoop = { x: 0, y: 1, z: 0, vx: 0, vy: 0, vz: 0 };
  for (let i = 0; i < 90; i++) { followStep(cruise, { x: 40, y: 1, z: 0 }, {}, 1 / 60); followStep(swoop, { x: 40, y: 1, z: 0 }, {}, 1 / 60, { catching: true }); }
  assert.ok(Math.hypot(cruise.vx, cruise.vz) <= PET.maxSpeed + 1e-9);
  assert.ok(Math.hypot(swoop.vx, swoop.vz) > PET.maxSpeed && Math.hypot(swoop.vx, swoop.vz) <= PET.catchSpeed + 1e-9);
  const sleepy = { x: 0, y: 1, z: 0, vx: 0, vy: 0, vz: 0 };
  for (let i = 0; i < 90; i++) followStep(sleepy, { x: 40, y: 1, z: 0 }, {}, 1 / 60, { slow: PET.sleepyScale });
  assert.ok(Math.hypot(sleepy.vx, sleepy.vz) <= PET.maxSpeed * PET.sleepyScale + 1e-9, 'a sleepy pet is slower');
});

test('banking: a left turn rolls the left wing down (negative roll), a right turn the opposite; climbing pitches the nose up; heading follows the velocity', () => {
  const left = { yaw: 0, roll: 0, pitch: 0, yawRate: 0 }, right = { yaw: 0, roll: 0, pitch: 0, yawRate: 0 };
  let yL = 0, yR = 0;
  for (let i = 0; i < 40; i++) {
    yL += 2.4 / 60; yR -= 2.4 / 60;
    poseStep(left, { vx: Math.sin(yL) * 4, vy: 0, vz: Math.cos(yL) * 4 }, null, 1 / 60);
    poseStep(right, { vx: Math.sin(yR) * 4, vy: 0, vz: Math.cos(yR) * 4 }, null, 1 / 60);
  }
  assert.ok(left.roll < -0.02 && right.roll > 0.02, `roll ${left.roll.toFixed(3)} / ${right.roll.toFixed(3)}`);
  assert.ok(Math.abs(left.roll) <= PET.bankMax && Math.abs(right.roll) <= PET.bankMax);
  const climb = { yaw: 0, roll: 0, pitch: 0, yawRate: 0 };
  for (let i = 0; i < 60; i++) poseStep(climb, { vx: 0, vy: 3, vz: 3 }, null, 1 / 60);
  assert.ok(climb.pitch < -0.05, 'nose up is a negative rotation about +X');
  const still = { yaw: 0, roll: 0, pitch: 0, yawRate: 0 };
  for (let i = 0; i < 120; i++) poseStep(still, { vx: 0, vy: 0, vz: 0 }, 1.2, 1 / 60);
  assert.ok(Math.abs(still.yaw - 1.2) < 0.02, 'standing still it looks where it is told');
});

test('mood: sleepy at night away from Duskcrown, awake by day and on Duskcrown even at night', () => {
  assert.equal(petMood({ nightness: 0.9, duskWeight: 0 }), 'sleepy');
  assert.equal(petMood({ nightness: 0.9, duskWeight: 1 }), 'awake');
  assert.equal(petMood({ nightness: 0.2, duskWeight: 0 }), 'awake');
});

test('appear scale: 0 at the start, exactly 1 at the end, a little overshoot between', () => {
  assert.equal(appearScale(0), 0); assert.equal(appearScale(PET.appear), 1); assert.equal(appearScale(5), 1);
  let max = 0; for (let t = 0; t < PET.appear; t += 0.01) max = Math.max(max, appearScale(t));
  assert.ok(max > 1.02 && max < 1.4, `overshoot ${max}`);
});

// ---- idles -------------------------------------------------------------------------------------------------------------------------------------------------------------------------
test('idle picking: hide only near a giant mushroom, a sleepy pet only does the quiet ones, every kind can come up', () => {
  const rng = mulberry32(73);
  const seen = new Set();
  for (let i = 0; i < 300; i++) seen.add(pickIdle(rng, { hide: true }));
  assert.deepEqual([...seen].sort(), [...IDLE_KINDS].sort());
  for (let i = 0; i < 200; i++) assert.notEqual(pickIdle(rng, { hide: false }), 'hide');
  for (let i = 0; i < 200; i++) assert.ok(['nuzzle', 'head', 'hide'].includes(pickIdle(rng, { hide: true, sleepy: true })));
  for (let i = 0; i < 200; i++) assert.ok(['nuzzle', 'head'].includes(pickIdle(rng, { hide: false, sleepy: true })));
});

test('idle machine: starts only after the owner stood still PET.idleAfter, runs its length, cools down, cancels when the owner walks off (a roll finishes)', () => {
  const rng = mulberry32(5), idle = createIdle(rng);
  const ctx = { ownerStill: true, canIdle: true, hide: false, sleepy: false, angle: 0.5, rng };
  let t = 0, started = null;
  while (t < 30 && !started) { started = stepIdle(idle, 1 / 30, ctx); t += 1 / 30; }
  assert.ok(started, 'an idle started'); assert.ok(t >= PET.idleAfter - 1e-6, `not before ${PET.idleAfter}s (${t.toFixed(2)})`);
  assert.equal(idle.dur, PET.idleLen[started]); assert.equal(idle.ang0, 0.5);
  let ran = 0; while (stepIdle(idle, 1 / 30, ctx)) ran += 1 / 30;
  assert.ok(Math.abs(ran + 1 / 30 - idle.dur) < 0.1, 'ran its whole length');
  assert.equal(idle.kind, null); assert.ok(idle.cooldown >= PET.idleGap[0] - 1e-9 && idle.cooldown <= PET.idleGap[1] + 1e-9);
  // walking cancels a head rest immediately
  const idle2 = createIdle(rng); idle2.kind = 'head'; idle2.dur = 4; idle2.t = 1;
  assert.equal(stepIdle(idle2, 1 / 30, { ...ctx, ownerStill: false }), null);
  const idle3 = createIdle(rng); idle3.kind = 'roll'; idle3.dur = 1.1; idle3.t = 0.2;
  assert.equal(stepIdle(idle3, 1 / 30, { ...ctx, ownerStill: false }), 'roll', 'a barrel roll is short: it finishes');
  const idle4 = createIdle(rng); let started4 = null; for (let i = 0; i < 900 && !started4; i++) started4 = stepIdle(idle4, 1 / 30, { ...ctx, canIdle: false });
  assert.equal(started4, null, 'no idles while settled / in combat / sailing');
});

test('idle drives: roll turns a full circle, loop orbits the owner, head hovers over the head and faces along the owner, hide goes under the cap, nuzzle comes close', () => {
  const owner = { x: 4, y: 1, z: 6, facing: 0.8 }, base = { owner, heel: { x: 3, z: 4 }, idle: { ang0: 0, side: 1 }, heelDist: 1.5 };
  const r = idleDrive('roll', 1, base); assert.ok(Math.abs(Math.abs(r.roll) - Math.PI * 2) < 1e-9); assert.equal(idleDrive('roll', 0, base).roll, 0);
  const mid = idleDrive('loop', 0.5, base);
  assert.ok(Math.abs(Math.hypot(mid.target.x - owner.x, mid.target.z - owner.z) - PET.loopRadius) < 1e-6, 'orbit radius');
  const head = idleDrive('head', 0.5, base);
  assert.ok(head.target.y - owner.y >= 1.9 && head.w === 1 && Math.abs(head.yaw - owner.facing) < 1e-9);
  assert.equal(idleDrive('head', 0, base).w, 0, 'eases in from nothing');
  const nuzzle = idleDrive('nuzzle', 0.5, base);
  assert.ok(Math.hypot(nuzzle.target.x - owner.x, nuzzle.target.z - owner.z) < 0.7 && nuzzle.w > 0.9);
  const hide = idleDrive('hide', 0.5, { ...base, hideSpot: { x: 9, y: 2, z: 9 } });
  assert.deepEqual([hide.target.x, hide.target.z], [9, 9]); assert.equal(hide.w, 1);
  assert.equal(idleDrive('hide', 0.5, base).target, null, 'no cap, no hide');
  assert.equal(idleDrive('nonsense', 0.5, base).target, null);
});

test('hide spot: under the nearest giant mushroom cap, toward the owner, below the cap and above the ground; titans do not count', () => {
  const giant = { id: 'g', kind: 'giant-a', x: 10, z: 10, y: 0.5, capR: 4, baseR: 1.4, capUnder: 5 };
  const titan = { id: 't', kind: 'titan', x: 11, z: 10, y: 0.5, capR: 9, baseR: 3.6, capUnder: 16 };
  assert.equal(nearestGiant([titan, giant], 12, 10), giant);
  assert.equal(nearestGiant([titan], 12, 10), null);
  assert.equal(nearestGiant([giant], 100, 100), null, 'out of range');
  const s = hideSpotOf(giant, { x: 16, z: 10 });
  assert.ok(Math.hypot(s.x - giant.x, s.z - giant.z) <= giant.capR && s.x > giant.x, 'inside the cap radius, on the owner side');
  assert.ok(s.y < giant.capUnder && s.y > giant.y);
  assert.equal(hideSpotOf(null, { x: 0, z: 0 }), null);
});

// ---- the model -------------------------------------------------------------------------------------------------------------------------------------------------------------------
test('the Capray model: about 4 draw calls, a 1.1 u wingspan, one shared pet material (one program key), glow + wave attributes, no lights, dispose', () => {
  const m = createPetModel('capray');
  assert.equal(m.drawCalls, 4);
  const meshes = []; m.root.traverse((o) => { if (o.isMesh) meshes.push(o); });
  assert.equal(meshes.length, 3, 'body, caps, tail');
  assert.equal(meshes.filter((x) => x.castShadow).length, 1, 'only the body casts: 3 + 1 shadow = 4');
  assert.equal(new Set(meshes.map((x) => x.material)).size, 1); assert.equal(meshes[0].material, petMaterial());
  assert.equal(petMaterial().customProgramCacheKey(), 'pet-toon'); assert.ok(petMaterial().stencilWrite);
  for (const me of meshes) {
    const a = me.geometry.attributes;
    assert.ok(a.position && a.normal && a.color && a.aMark && a.aGlow && a.aWave, me.name);
    assert.equal(a.aGlow.count, a.position.count); assert.equal(a.aWave.count, a.position.count); assert.ok(me.geometry.index);
    for (let i = 0; i < a.position.count; i++) assert.ok(Number.isFinite(a.position.getX(i) + a.position.getY(i) + a.position.getZ(i) + a.normal.getX(i)));
  }
  m.root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(m.root);
  assert.ok(box.max.x - box.min.x > 1.05 && box.max.x - box.min.x < 1.25, `wingspan ${(box.max.x - box.min.x).toFixed(2)}`);
  assert.equal(m.wingspan, 1.1);
  assert.ok(box.max.z > 0.35 && box.min.z < -1.0, 'a long tail behind a short front');
  const body = meshes[0].geometry.attributes;
  let hullGlow = 0, glow = 0;
  for (let i = 0; i < body.position.count; i++) { if (body.aMark.getW(i) > 0.5) hullGlow = Math.max(hullGlow, body.aGlow.getX(i)); else glow = Math.max(glow, body.aGlow.getX(i)); }
  assert.equal(hullGlow, 0, 'the outline hull never glows'); assert.ok(glow >= 0.85, 'the underside glows');
  let wing = 0, centre = 0;
  for (let i = 0; i < body.position.count; i++) { if (Math.abs(body.position.getX(i)) > 0.5) wing = Math.max(wing, body.aWave.getX(i)); if (Math.abs(body.position.getX(i)) < 0.05) centre = Math.max(centre, body.aWave.getX(i)); }
  assert.ok(wing > 0.9 && centre < 0.05, 'wing ripple weight grows with the span and is zero at the body');
  m.update(0.016, 1.3, { sway: 1, rocking: 1 });
  assert.ok(Number.isFinite(m.tailPivot.rotation.y) && Math.abs(m.tailPivot.rotation.y) <= 0.25);
  const lights = []; m.root.traverse((o) => { if (o.isLight) lights.push(o); }); assert.equal(lights.length, 0);
  const geos = meshes.map((x) => x.geometry); let disposed = 0; for (const g of geos) g.addEventListener('dispose', () => { disposed++; });
  m.dispose(); assert.equal(disposed, 3);
  assert.throws(() => createPetModel('ghost'));
});

test('the pet material patches the shader once: glow and wave uniforms are shared, the day / night glow is a uniform (no program switch)', () => {
  const mat = petMaterial();
  const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <begin_vertex>', fragmentShader: '#include <common>\n#include <opaque_fragment>' };
  mat.onBeforeCompile(shader, {});
  assert.equal(shader.uniforms.uGlow, petUniforms.uGlow); assert.equal(shader.uniforms.uTime, petUniforms.uTime);
  assert.match(shader.vertexShader, /aWave/); assert.match(shader.vertexShader, /vFlat/, 'the shared character patch (outline flag) is still there');
  assert.match(shader.fragmentShader, /vGlow \* uGlow/);
});

// ---- the unlock domain ----------------------------------------------------------------------------------------------------------------------------------------------------
function pair(opts = {}) {
  storage.clear();
  if (opts.saved) storage.set(PETS_KEY, JSON.stringify(opts.saved));
  let time = 5000; const q = [], replicas = new Map();
  const hSync = new WorldSync({ role: 'host', wallNow: () => time }), rSync = new WorldSync({ role: 'replica', wallNow: () => time });
  replicas.set(1, rSync);
  hSync.attachHost({ sendTo: (tid, m) => q.push([replicas.get(tid), m]), broadcast: (m) => { for (const r of replicas.values()) q.push([r, m]); } });
  rSync.attachReplica({ send: (m) => { q.push([hSync, m, 1]); return true; } });
  const flush = () => { while (q.length) { const [to, m, tid] = q.shift(); if (to === hSync) hSync.screenMessage(tid, m); else to.receive(m); } };
  const host = createPetsDomain({ sync: hSync, params: opts.params || new URLSearchParams() }), replica = createPetsDomain({ sync: rSync });
  rSync.linkUp(); hSync.screenConnected(1, { clientId: 'friend' }); flush();
  return { host, replica, hSync, rSync, flush, equal: () => assert.equal(hSync.hash(), rSync.hash()), late() {
    const sync = new WorldSync({ role: 'replica', wallNow: () => time }); replicas.set(2, sync);
    sync.attachReplica({ send: (m) => { q.push([hSync, m, 2]); return true; } });
    const domain = createPetsDomain({ sync }); sync.linkUp(); hSync.screenConnected(2, { clientId: 'late' }); flush();
    return { sync, domain };
  } };
}

test('domain: starts empty, the host unlocks, every screen hears it live, hashes stay equal, a second unlock is a no-op, the save holds it', () => {
  const w = pair(); w.equal();
  assert.deepEqual(w.host.unlocked, []); assert.equal(w.host.questlinesOpen, false); assert.equal(w.replica.known, true);
  const heard = { host: [], replica: [] };
  w.host.onUnlock((id, d) => heard.host.push([id, d.live])); w.replica.onUnlock((id, d) => heard.replica.push([id, d.live]));
  let changes = 0; w.replica.onChange(() => { changes++; });
  assert.equal(w.host.unlock('ghost'), false); assert.equal(w.replica.unlock('capray'), false, 'only the host unlocks');
  assert.equal(w.host.unlock('capray'), true); w.flush();
  assert.deepEqual(w.host.unlocked, ['capray']); assert.deepEqual(w.replica.unlocked, ['capray']);
  assert.deepEqual(heard.host, [['capray', true]]); assert.deepEqual(heard.replica, [['capray', true]]); assert.ok(changes >= 1);
  assert.equal(w.host.questlinesOpen, true); assert.equal(w.replica.questlinesOpen, true); w.equal();
  assert.equal(w.host.unlock('capray'), false); w.flush(); assert.equal(heard.host.length, 1);
  assert.deepEqual(JSON.parse(storage.get(PETS_KEY)), { v: 1, unlocked: ['capray'] });
  const reload = createPetsDomain({ sync: new WorldSync({ role: 'host' }) }); assert.deepEqual(reload.unlocked, ['capray'], 'a fresh host loads the save');
});

test('domain: a late joiner gets the list silently from the snapshot, debug set / reset replace it on every screen', async () => {
  const w = pair(); w.host.unlock('capray'); w.flush();
  const heard = []; const late = w.late(); late.domain.onUnlock((id) => heard.push(id));
  assert.deepEqual(late.domain.unlocked, ['capray']); assert.deepEqual(heard, [], 'a load / late join is silent'); assert.equal(late.sync.hash(), w.hSync.hash());
  const r = w.host.reset(); w.flush(); assert.equal(r.ok, true);
  assert.deepEqual(w.host.unlocked, []); assert.deepEqual(w.replica.unlocked, []); assert.deepEqual(late.domain.unlocked, []); w.equal();
  assert.deepEqual(JSON.parse(storage.get(PETS_KEY)).unlocked, []);
  const pending = w.replica.debugSet(['capray']); w.flush(); assert.equal((await pending).reason, 'bad-request', 'a replica cannot debug-set');
  assert.deepEqual(w.host.unlocked, []);
});

test('domain: saves are normalised on load (junk, duplicates, unknown ids) and ?testpet unlocks Capray without reading or writing the save', () => {
  const w = pair({ saved: { v: 1, unlocked: ['capray', 'capray', 'dragon', 7] } });
  assert.deepEqual(w.host.unlocked, ['capray']);
  const broken = pair({ saved: 'garbage' }); assert.deepEqual(broken.host.unlocked, []);
  storage.set(PETS_KEY, '{nope'); assert.deepEqual(createPetsDomain({ sync: new WorldSync({ role: 'host' }) }).unlocked, []);
  const t = pair({ params: new URLSearchParams('testpet') });
  assert.deepEqual(t.host.unlocked, ['capray']); assert.equal(t.host.testpet, true); assert.equal(storage.has(PETS_KEY), false);
  t.host.reset(); t.flush(); assert.equal(storage.has(PETS_KEY), false, 'never saved under ?testpet');
  assert.deepEqual(t.replica.unlocked, [], 'the replica follows the host');
});

// ---- the runtime ------------------------------------------------------------------------------------------------------------------------------------------------------------------
function world(opts = {}) {
  storage.clear();
  if (opts.prefs) storage.set(STORAGE_KEY, JSON.stringify(opts.prefs));
  const sync = new WorldSync({ role: 'host' });
  const domain = createPetsDomain({ sync, params: new URLSearchParams(opts.unlocked === false ? '' : 'testpet') });
  const scene = new THREE.Scene();
  const mk = (index, x = 0, z = 0) => {
    const root = new THREE.Group(); root.position.set(x, 0, z);
    return { index, position: root.position, facing: 0, away: false, downed: false, leaving: 0, root, petIndex: -1, velocity: { x: 0, z: 0 } };
  };
  const handlers = {};
  const p0 = mk(0);
  const players = { list: [p0], p1: p0, on(type, fn) { (handlers[type] ||= []).push(fn); } };
  const avatars = { list: [] };
  const state = { page: false, busy: false, sailing: false, dungeon: false, night: 0, dusk: 0 };
  const bursts = [];
  const pets = createPets({
    scene, players, avatars, sync, domain, clock: { get nightness() { return state.night; } }, atmosphere: { get duskWeight() { return state.dusk; } },
    storybook: { contains: () => state.page }, dungeon: { contains: () => state.dungeon }, cinematic: { get busy() { return state.busy; } },
    particles: { burst: (type, at) => bursts.push([type, { ...at }]) }, sfx: null, heightAt: (x, z) => 2, duskItems: () => null, isSailing: () => state.sailing,
  });
  const run = (sec, fn) => { for (let t = 0; t < sec; t += 1 / 60) { fn?.(1 / 60); pets.update(1 / 60); } };
  return { pets, players, avatars, scene, state, bursts, mk, p0, domain, run, handlers };
}
const petMeshes = (scene) => { let n = 0; scene.traverse((o) => { if (o.isMesh) n++; }); return n; };

test('runtime: nothing is built until a player brings a pet; then it appears at the heel with a poof, 4 draw calls, no lights', () => {
  const w = world();
  w.run(0.5); assert.equal(w.pets.count, 0); assert.equal(petMeshes(w.scene), 0);
  assert.equal(w.pets.set(w.p0, 'capray', { fx: false }), 'capray'); assert.equal(w.p0.petIndex, 0);
  w.run(1);
  const s = w.pets.summary();
  assert.equal(s.pets.length, 1); assert.equal(s.pets[0].shown, true); assert.equal(s.drawCalls, 4); assert.equal(petMeshes(w.scene), 3);
  assert.ok(w.bursts.some(([t]) => t === 'puff'), 'poof on arrival');
  const heel = heelPoint({ x: 0, z: 0, facing: 0 }, 0);
  assert.ok(Math.hypot(s.pets[0].pos.x - heel.x, s.pets[0].pos.z - heel.z) < 0.1);
  assert.ok(s.pets[0].pos.y >= 2 + PET.glideMin - 0.05 && s.pets[0].pos.y <= 2 + PET.glideMax + 0.4, 'glides 0.9-1.4 u above the terrain (heightAt = 2)');
  let lights = 0; w.scene.traverse((o) => { if (o.isLight) lights++; }); assert.equal(lights, 0);
});

test('runtime: it follows a walking owner on the left behind; the choice is saved per screen; slot parity mirrors the side', () => {
  const w = world();
  w.pets.set(w.p0, 'capray', { fx: false });
  w.run(0.3, () => {});
  w.p0.facing = Math.PI / 2;                                                // walking +X at 5 u/s
  w.run(4, (dt) => { w.p0.position.x += 5 * dt; });
  const a = w.pets.actorOf(w.p0), o = w.p0.position;
  const left = leftOf(Math.PI / 2);
  const rel = { x: a.s.x - o.x, z: a.s.z - o.z };
  assert.ok(rel.x < -0.6, `behind the walker (${rel.x.toFixed(2)})`); assert.ok(rel.x * 1 + 0 > -3);
  assert.ok(rel.x * left.x + rel.z * left.z > 0.4, 'on its left');
  assert.deepEqual(JSON.parse(storage.get(STORAGE_KEY)), { 0: 'capray' });
  const w2 = world({ prefs: { 1: 'capray' } });
  const p1 = w2.mk(1, 20, 0); w2.players.list.push(p1); w2.handlers.join.forEach((f) => f());
  assert.equal(p1.petIndex, 0, 'a saved choice is restored when the player (re)joins'); assert.equal(w2.p0.petIndex, -1, 'default none');
  w2.pets.set(w2.p0, 'capray', { fx: false }); w2.run(2);
  const h0 = w2.pets.actorOf(w2.p0), h1 = w2.pets.actorOf(p1);
  assert.ok((h0.s.x - w2.p0.position.x) * (h1.s.x - p1.position.x) < 0, 'slot 0 on the left, slot 1 mirrored to the right');
});

test('runtime: a teleport (regroup / travel / boat arrival) poofs the pet to the heel; a distance past catchUp swoops without a poof', () => {
  const w = world();
  w.pets.set(w.p0, 'capray', { fx: false }); w.run(1);
  const before = w.bursts.length;
  w.p0.position.set(200, 0, 40); w.run(0.1);
  const a = w.pets.actorOf(w.p0), heel = heelPoint({ x: 200, z: 40, facing: 0 }, 0);
  assert.ok(Math.hypot(a.s.x - heel.x, a.s.z - heel.z) < 0.3, 'back at the heel at once'); assert.ok(w.bursts.length > before, 'with poofs');
  const w2 = world(); w2.pets.set(w2.p0, 'capray', { fx: false }); w2.run(1);
  w2.p0.position.x = 9; w2.run(0.05);                                       // a 9 u jump in one frame: the finite difference ignores it (not a run), the pet is past catchUp but not lost
  const a2 = w2.pets.actorOf(w2.p0);
  assert.equal(a2.shown, true); assert.ok(Math.hypot(a2.s.vx, a2.s.vz) > 3, 'it swoops');
});

test('runtime: hidden on storybook pages, while the owner is downed or away, and a culled remote owner; it comes back with a poof, dropping the pet disposes it', () => {
  const w = world();
  w.pets.set(w.p0, 'capray', { fx: false }); w.run(1);
  const a = w.pets.actorOf(w.p0);
  w.state.page = true; w.run(0.1); assert.equal(a.model.root.visible, false); assert.equal(w.pets.summary().drawCalls, 0);
  w.state.page = false; const n = w.bursts.length; w.run(0.1); assert.equal(a.model.root.visible, true); assert.ok(w.bursts.length > n);
  w.p0.downed = true; w.run(0.1); assert.equal(a.model.root.visible, false); w.p0.downed = false; w.run(0.1); assert.equal(a.model.root.visible, true);
  w.p0.away = true; w.run(0.1); assert.equal(a.model.root.visible, false); w.p0.away = false; w.run(0.1);
  const geo = a.model.meshes[0].geometry; let disposed = false; geo.addEventListener('dispose', () => { disposed = true; });
  w.pets.set(w.p0, null, { fx: false }); w.run(0.1);
  assert.equal(w.pets.count, 0); assert.equal(petMeshes(w.scene), 0); assert.ok(disposed, 'geometry freed');
  // a remote avatar that brings a pet (pose field 16 -> avatar.petIndex): built, hidden while culled, disposed when the avatar goes
  const av = w.mk(2, 8, 8); av.petIndex = 0; w.avatars.list.push(av); av.root.visible = false;
  w.run(0.2); assert.equal(w.pets.count, 1); assert.equal(w.pets.actorOf(av).model.root.visible, false);
  av.root.visible = true; w.run(0.2); assert.equal(w.pets.actorOf(av).model.root.visible, true);
  w.avatars.list.length = 0; w.run(0.1); assert.equal(w.pets.count, 0);
});

test('runtime: a pet that is not unlocked is never built and the saved choice is forgotten once the list is known; unlocking later keeps working', () => {
  const w = world({ unlocked: false, prefs: { 0: 'capray' } });
  w.run(0.5);
  assert.equal(w.p0.petIndex, -1); assert.equal(w.pets.count, 0); assert.deepEqual(JSON.parse(storage.get(STORAGE_KEY)), {}, 'stale entry forgotten');
  assert.equal(w.pets.set(w.p0, 'capray', { fx: false }), null, 'cannot bring a pet that is locked');
  w.domain.unlock('capray');
  assert.equal(w.pets.set(w.p0, 'capray', { fx: false }), 'capray'); w.run(0.3); assert.equal(w.pets.count, 1);
  w.domain.reset(); w.run(0.2);
  assert.equal(w.p0.petIndex, -1, 'a reset takes the pet away'); assert.equal(w.pets.count, 0);
});

test('runtime: it settles low during a cinematic, glides on during the crossing, idles when the owner stands still, never idles in combat; the shared glow follows the night', () => {
  const w = world();
  w.pets.set(w.p0, 'capray', { fx: false }); w.run(1);
  const a = w.pets.actorOf(w.p0);
  w.state.busy = true; w.run(3);
  const calm = a.s.y; assert.ok(calm - 2 <= PET.glideMax * 0.78 + 0.05, 'settled low'); assert.equal(a.idleKind, null);
  w.state.busy = false; w.state.sailing = true; w.run(3); assert.equal(a.idleKind, null, 'no idles on the crossing'); w.state.sailing = false;
  w.state.dungeon = true; w.run(12); assert.equal(a.idleKind, null, 'no idles in combat');
  w.state.dungeon = false;
  let seen = null; for (let i = 0; i < 60 * 40 && !seen; i++) { w.pets.update(1 / 60); seen = a.idleKind; }
  assert.ok(seen, 'an idle starts when the owner stands still');
  w.state.night = 1; w.state.dusk = 0; w.run(8); assert.equal(a.mode, 'sleepy'); assert.ok(petUniforms.uGlow.value > PET.glowDay + 0.3, `night glow ${petUniforms.uGlow.value.toFixed(2)}`);
  w.state.dusk = 1; w.run(0.1); assert.equal(a.mode, 'awake');
  w.state.night = 0; w.state.dusk = 0; w.run(10); assert.ok(petUniforms.uGlow.value < PET.glowDay + 0.1);
});

test('runtime: the boat crossing wrapper (player.visualRoot) is the place the pet follows', () => {
  const w = world();
  w.pets.set(w.p0, 'capray', { fx: false }); w.run(1);
  const visual = new THREE.Group(); w.p0.root.add(visual); w.p0.visualRoot = visual;
  w.run(2, () => { visual.position.x += 0.06; });                          // the wrapper moves, the authoritative position does not
  const a = w.pets.actorOf(w.p0);
  assert.ok(a.ownerPos.x > 1.5 && w.p0.position.x === 0);
  assert.ok(Math.abs(a.s.x - a.ownerPos.x) < 2.5, 'the pet kept up with the rendered boat crew');
});
