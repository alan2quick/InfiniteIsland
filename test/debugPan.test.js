import test from 'node:test';
import assert from 'node:assert/strict';
import { stepDebugPan, createDebugPan } from '../public/js/camera/debugPan.js';
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
function travel(hz, input = { x: 1, y: 0 }, right = { x: 1, z: 0 }) {
  let velocity = { x: 0, z: 0 }, x = 0, z = 0;
  for (let i = 0; i < hz; i++) { const step = stepDebugPan(velocity, input, right, 1 / hz); velocity = step.velocity; x += step.x; z += step.z; }
  return { x, z, velocity };
}
function events() {
  const handlers = new Map();
  return { handlers, addEventListener(type, fn) { handlers.set(type, fn); }, removeEventListener(type) { handlers.delete(type); },
    emit(type, event = {}) { let prevented = false, stopped = false; handlers.get(type)?.({ preventDefault() { prevented = true; }, stopImmediatePropagation() { stopped = true; }, ...event }); return { prevented, stopped }; } };
}
function rig() {
  const target = events(), doc = { ...events(), hidden: false, activeElement: null }, keys = new Set(['KeyW']);
  const camera = { position: { x: 0, y: 80, z: 100 }, matrixWorld: { elements: [1, 0, 0] } }, controls = { target: { x: 0, y: 0, z: 0 } };
  let blocked = false;
  const pan = createDebugPan({ camera, controls, target, doc, keyboard: { release: key => keys.delete(key) }, blocked: () => blocked });
  return { target, doc, camera, controls, pan, keys, block(value) { blocked = value; } };
}

test('pan uses smooth exact dt integration with equal travel at 30/60/120 FPS', () => {
  const slow = travel(30), normal = travel(60), fast = travel(120);
  near(slow.x, normal.x); near(normal.x, fast.x); near(slow.z, 0);
  assert.ok(normal.x > 50 && normal.x < 60);
  const first = stepDebugPan({ x: 0, z: 0 }, { x: 1, y: 0 }, { x: 1, z: 0 }, 1 / 60);
  assert.ok(first.velocity.x > 0 && first.velocity.x < 60, 'ease into motion');
  const coast = stepDebugPan(normal.velocity, { x: 0, y: 0 }, { x: 1, z: 0 }, 1 / 60);
  assert.ok(coast.velocity.x > 0 && coast.velocity.x < normal.velocity.x, 'ease out');
});

test('arrows pan along screen ground axes at any orbit yaw without faster diagonals', () => {
  const straight = travel(60), diagonal = travel(60, { x: 1, y: 1 });
  near(Math.hypot(diagonal.x, diagonal.z), straight.x);
  const north = travel(60, { x: 0, y: 1 }); assert.ok(north.z < 0); near(north.x, 0);
  const rotated = travel(60, { x: 0, y: 1 }, { x: 0, z: -1 }); assert.ok(rotated.x < 0); near(rotated.z, 0);
  const fallback = stepDebugPan({ x: 0, z: 0 }, { x: 1, y: 0 }, { x: 0, z: 0 }, 0.1);
  assert.ok(Number.isFinite(fallback.x));
  assert.equal(stepDebugPan({ x: 0, z: 0 }, { x: 1, y: 0 }, { x: 1, z: 0 }, NaN).x, 0);
});

test('debug keyboard capture moves only camera and target, preserving orbit distance and WASD', () => {
  const r = rig(); r.keys.add('ArrowRight');
  const handled = r.target.emit('keydown', { code: 'ArrowRight' });
  assert.deepEqual(handled, { prevented: true, stopped: true });
  assert.equal(r.keys.has('ArrowRight'), false); assert.equal(r.keys.has('KeyW'), true);
  const before = { ...r.camera.position };
  for (let i = 0; i < 30; i++) r.pan.update(1 / 60);
  assert.ok(r.camera.position.x > 0); near(r.camera.position.y, before.y);
  near(r.camera.position.x - r.controls.target.x, before.x);
  near(r.camera.position.z - r.controls.target.z, before.z);
  assert.deepEqual(r.target.emit('keydown', { code: 'KeyW' }), { prevented: false, stopped: false });
  r.pan.dispose(); assert.equal(r.target.handlers.size, 0); assert.equal(r.doc.handlers.size, 0);
});

test('typing/admin controls and blur stop panning without stealing text-field arrows', () => {
  const r = rig();
  const input = { tagName: 'INPUT' }; r.doc.activeElement = input;
  assert.deepEqual(r.target.emit('keydown', { code: 'ArrowUp', target: input }), { prevented: false, stopped: false });
  r.pan.update(0.1); near(r.controls.target.z, 0);
  r.doc.activeElement = null; r.block(true); r.target.emit('keydown', { code: 'ArrowUp' }); r.pan.update(0.1); near(r.controls.target.z, 0);
  r.block(false); r.target.emit('keydown', { code: 'ArrowUp' }); r.pan.update(0.1); assert.ok(r.controls.target.z < 0);
  r.target.emit('blur'); const z = r.controls.target.z; r.pan.update(0.1); near(r.controls.target.z, z);
  r.target.emit('keydown', { code: 'ArrowRight' }); r.doc.hidden = true; r.doc.emit('visibilitychange'); r.doc.hidden = false;
  const x = r.controls.target.x; r.pan.update(0.1); near(r.controls.target.x, x); r.pan.dispose();
});
