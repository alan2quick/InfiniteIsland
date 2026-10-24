import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { fireflyGathering } from '../public/js/fx/fireflyGathering.js';
import { createAmbient } from '../public/js/fx/ambient.js';

test('rare gatherings fade gently for twenty seconds with long dark gaps and three to six guests', () => {
  assert.equal(fireflyGathering(24).glow, 0);
  for (let event = 0; event < 8; event++) {
    const start = 25 + event * 135;
    assert.equal(fireflyGathering(start).glow, 0);
    assert.equal(fireflyGathering(start + 4).glow, 1);
    assert.equal(fireflyGathering(start + 16).glow, 1);
    assert.equal(fireflyGathering(start + 20).glow, 0);
    assert.equal(fireflyGathering(start + 134).glow, 0);
    assert.equal(fireflyGathering(start + 10).count, 3 + event % 4);
    let last = 0;
    for (let i = 0; i <= 2000; i++) {
      const value = fireflyGathering(start + i / 100).glow;
      assert.ok(Math.abs(value - last) < 0.004, 'there are no abrupt flashes');
      last = value;
    }
  }
});

test('night groups stay small and dim, honor campsite anchors, and disappear during quiet/day/calm periods', () => {
  const scene = new THREE.Scene(), clock = { nightness: 1, look: { warmth: 0 } }, focus = { x: 10000, z: 10000 };
  const ambient = createAmbient({ scene, props: { handles: { flowers: { list: [] }, trees: [], bushes: [] } }, getHeight: () => 1, clock, butterflies: 0, petals: 0, glints: 0, fireflies: 4000 });
  const ff = ambient.fireflies;
  const update = (dt) => ambient.update(dt, 999999, focus, null, 720);
  const active = () => Array.from({ length: ff.n }, (_, i) => ff.aPar.getY(i)).filter((v) => v > 0.001);
  try {
    ambient.setFireflyAnchors([focus]);
    assert.equal(ff.n, 6, 'a large requested density cannot increase allocation or draw count');
    assert.equal(ff.geo.attributes.position.count, 6);
    assert.equal(scene.getObjectsByProperty('name', 'fireflies').length, 1);
    update(24); assert.equal(ff.points.visible, false);
    update(6); assert.equal(active().length, 3);
    assert.ok(active().every((v) => v <= 0.181));
    for (let i = 0; i < 3; i++) {
      assert.ok(Math.hypot(ff.aPos.getX(i) - focus.x, ff.aPos.getZ(i) - focus.z) < 3);
      assert.ok(ff.aPar.getX(i) < 0.24);
    }
    const time = ff.time; update(0); assert.equal(ff.time, time);
    clock.nightness = 0; update(4); assert.equal(ff.points.visible, false);
    clock.nightness = 1; update(4); assert.equal(ff.points.visible, true);
    ambient.calm = true; update(4); assert.equal(ff.points.visible, false);
    ambient.calm = false; update(12); assert.equal(ff.points.visible, false);
    update(120); assert.equal(active().length, 4);
  } finally {
    scene.traverse((obj) => { obj.geometry?.dispose(); obj.material?.dispose(); });
  }
});
