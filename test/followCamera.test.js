import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FollowCamera } from '../public/js/camera/followCamera.js';
import { cameraSettings, chaseOffset, cameraRelativeMove, easeYaw, shortestAngle, advanceChaseYaw, createTerrainOcclusion, createWorldOcclusion } from '../public/js/camera/followMath.js';
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
function make() { const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 1000); return { camera, fc: new FollowCamera(camera) }; }

test('chase view sits behind all four headings; controls preserve magnitude and map forward to facing', () => {
  const settings = cameraSettings({ mode: 'follow' });
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const off = chaseOffset(yaw, settings);
    assert.ok(off.x * Math.sin(yaw) + off.z * Math.cos(yaw) < 0);
    const move = cameraRelativeMove({ x: 0, z: -1 }, yaw);
    near(move.x, Math.sin(yaw)); near(move.z, Math.cos(yaw));
    const diagonal = cameraRelativeMove({ x: 0.3, z: -0.6 }, yaw);
    near(Math.hypot(diagonal.x, diagonal.z), Math.hypot(0.3, 0.6));
  }
});

test('yaw eases across wrap by shortest turn and is independent of frame rate', () => {
  const from = Math.PI - 0.05, to = -Math.PI + 0.05;
  assert.ok(easeYaw(from, to, 0.1, 4) > from);
  let small = from;
  for (let i = 0; i < 60; i++) small = easeYaw(small, to, 1 / 60, 4);
  near(shortestAngle(small, easeYaw(from, to, 1, 4)), 0);
});

test('invalid settings retain safe defaults and bounded values', () => {
  const s = cameraSettings({ mode: 'oops', angle: Infinity, distance: -100, smoothness: 20 });
  assert.equal(s.mode, 'original'); assert.equal(s.angle, 28); assert.equal(s.distance, 5); assert.equal(s.smoothness, 1);
});

test('original view remains default and shared screens / special contexts restore exact original framing', () => {
  const { fc, camera } = make(), original = make();
  const p = { facing: 1 }, target = { x: 2, y: 0, z: 5 };
  fc.setSubject(p); assert.equal(fc.followActive, false);
  fc.setSettings({ mode: 'follow' }); fc.setSubject(p); fc.update(0, target);
  assert.equal(fc.followActive, true);
  assert.ok(camera.position.x < target.x);
  for (const options of [{ count: 2 }, { allowed: false }]) {
    fc.setSubject(p, options); fc.update(0, target); original.fc.update(0, target);
    assert.equal(fc.followActive, false);
    assert.deepEqual(camera.position.toArray(), original.camera.position.toArray());
  }
});

test('held movement uses a stable basis despite chase yaw changes; release resets it', () => {
  const { fc } = make(), p = { facing: 0 };
  fc.setSettings({ mode: 'follow' }); fc.setSubject(p); fc.update(0, { x: 0, y: 0, z: 0 });
  const first = fc.transformMovement({ x: 1, z: 0 });
  p.facing = Math.PI / 2; fc.update(1, { x: 0, y: 0, z: 0 });
  assert.deepEqual(fc.transformMovement({ x: 1, z: 0 }), first);
  fc.transformMovement({ x: 0, z: 0 });
  near(fc.transformMovement({ x: 0, z: -1 }).x, Math.sin(fc._yaw));
});

test('90 and 180 degree chase turns start gently, turn monotonically and settle behind without a deadzone', () => {
  for (const target of [Math.PI / 2, Math.PI, -Math.PI]) {
    const state = { yaw: 0, velocity: 0 };
    advanceChaseYaw(state, target, 1 / 60, 0.6);
    assert.ok(Math.abs(state.yaw) < 0.002, 'first frame rotates less than 0.12 degrees');
    let previous = Math.abs(state.yaw), maxSpeed = 0;
    for (let i = 1; i < 600; i++) {
      advanceChaseYaw(state, target, 1 / 60, 0.6);
      const angle = Math.abs(state.yaw);
      assert.ok(angle >= previous - 1e-12 && angle <= Math.abs(target) + 1e-12);
      maxSpeed = Math.max(maxSpeed, Math.abs(state.velocity)); previous = angle;
    }
    assert.ok(Math.abs(shortestAngle(state.yaw, target)) < 1e-6);
    assert.ok(maxSpeed < 2.32, '180 degree turn peaks below 133 degrees/sec at default');
  }
});

test('chase spring is frame independent at 30/60/144Hz, irregular steps and across angle wrap', () => {
  for (const [from, to] of [[0, Math.PI / 2], [0, Math.PI], [Math.PI - 0.1, -Math.PI + 0.1]]) {
    const reference = { yaw: from, velocity: 0 };
    advanceChaseYaw(reference, to, 1, 0.6);
    for (const steps of [Array(30).fill(1 / 30), Array(60).fill(1 / 60), Array(144).fill(1 / 144), [0.01, 0.19, 0.3, 0.02, 0.48]]) {
      const state = { yaw: from, velocity: 0 };
      for (const dt of steps) advanceChaseYaw(state, to, dt, 0.6);
      near(shortestAngle(state.yaw, reference.yaw), 0); near(state.velocity, reference.velocity);
    }
  }
});

test('Smoothness increases turn catch-up time; reversal preserves velocity then stops without overshoot', () => {
  const quick = { yaw: 0, velocity: 0 }, gentle = { yaw: 0, velocity: 0 };
  advanceChaseYaw(quick, Math.PI, 0.5, 0);
  advanceChaseYaw(gentle, Math.PI, 0.5, 1);
  assert.ok(quick.yaw > gentle.yaw * 3);
  const previousVelocity = gentle.velocity, destination = gentle.yaw - 0.05;
  advanceChaseYaw(gentle, destination, 1e-6, 1);
  assert.ok(Math.abs(gentle.velocity - previousVelocity) < 1e-4);
  for (let i = 0; i < 1200; i++) advanceChaseYaw(gentle, destination, 1 / 60, 1);
  near(gentle.yaw, destination); near(gentle.velocity, 0);
});

test('camera applies slower turn damping separately from follow position and clears momentum on context changes', () => {
  const { fc } = make(), p = { facing: 0 }, target = { x: 0, y: 0, z: 0 };
  fc.setSettings({ mode: 'follow' }); fc.setSubject(p); fc.update(0, target);
  p.facing = Math.PI;
  for (let i = 0; i < 30; i++) fc.update(1 / 60, target);
  assert.ok(fc._yaw > 0.7 && fc._yaw < 0.9, 'default half-second turn is about 48 degrees');
  assert.ok(fc._yawMotion.velocity > 0);
  fc.setSubject(p, { count: 2 }); fc.setSubject(p);
  near(fc._yaw, p.facing); near(fc._yawMotion.velocity, 0);
  fc.update(1 / 60, target); near(fc._yaw, p.facing);
});

test('intro advances to normal camera, can be skipped and stops for special contexts', () => {
  const { fc, camera } = make(), target = { x: 10, y: 0, z: 20 };
  fc.update(0, target); const normal = camera.position.clone();
  assert.equal(fc.startIntro({ center: { x: 0, y: 0, z: 0 }, duration: 2 }), true);
  fc.update(0, target); near(camera.position.y, 65);
  fc.update(2, target); assert.equal(fc.introActive, false);
  near(camera.position.distanceTo(normal), 0);
  fc.startIntro(); fc.skipIntro(); assert.equal(fc.introActive, false);
  fc.startIntro(); fc.setSubject(null, { allowed: false }); assert.equal(fc.introActive, false);
  fc.setSettings({ intro: false }); assert.equal(fc.startIntro(), false);
});

test('occlusion adapter can pull the follow camera inward without changing simulation focus', () => {
  const { fc, camera } = make(); const target = { x: 0, y: 0, z: 0 };
  fc.setSettings({ mode: 'follow' }); fc.setSubject({ facing: 0 });
  fc.setOcclusionResolver((focus, desired, out) => out.copy(focus).lerp(desired, 0.5));
  fc.update(0, target);
  near(camera.position.distanceTo(fc.focus), 6);
  assert.deepEqual(target, { x: 0, y: 0, z: 0 });
});


test('terrain occlusion pulls in before a ridge and leaves open ground unchanged', () => {
  const focus = { x: 0, y: 1, z: 0 }, desired = { x: 0, y: 5, z: -12 }, out = {};
  createTerrainOcclusion(() => 0)(focus, desired, out);
  assert.deepEqual(out, desired);
  createTerrainOcclusion((x, z) => z < -5 ? 10 : 0)(focus, desired, out);
  assert.ok(out.z >= -5 && out.z < 0);
});


test('static collider occlusion respects height, exclusions and ignores focus-containing props', () => {
  const focus = { x: 0, y: 1, z: 0 }, desired = { x: 0, y: 2, z: -12 }, out = {};
  const collider = { x: 0, z: -6, r: 1 };
  const resolve = createWorldOcclusion(() => 0, () => [collider]);
  resolve(focus, desired, out); assert.ok(out.z > -5 && out.z < 0);
  collider.cameraHeight = 0.2; resolve(focus, desired, out); assert.deepEqual(out, desired);
  collider.cameraHeight = 5; collider.cameraIgnore = true; resolve(focus, desired, out); assert.deepEqual(out, desired);
  collider.cameraIgnore = false; collider.z = 0; resolve(focus, desired, out); assert.deepEqual(out, desired);
});
