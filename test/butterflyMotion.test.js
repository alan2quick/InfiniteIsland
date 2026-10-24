import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { butterflyWingAngle } from '../public/js/fx/butterflyMotion.js';
import { createAmbient } from '../public/js/fx/ambient.js';

test('each butterfly makes one smooth, brief flap every three to five seconds', () => {
  const firstPeaks = [];
  for (const offset of [0, 0.7, 1.9, 3.3, 5.8]) {
    const peaks = [], widths = [];
    let start = null, peakTime = 0, peakAngle = 0, gliding = 0;
    for (let i = 0; i <= 9000; i++) {
      const time = i / 100;
      const angle = butterflyWingAngle(time, time * 100, offset, 1);
      assert.ok(angle >= 0.055 && angle < 0.32, 'wings stay near horizontal without flipping');
      if (angle > 0.055 + 1e-8) {
        if (start === null) { start = time; peakAngle = 0; }
        if (angle > peakAngle) { peakAngle = angle; peakTime = time; }
      } else {
        gliding++;
        if (start !== null) {
          if (start > 0) { peaks.push(peakTime); widths.push(time - start); }
          start = null;
        }
      }
      assert.equal(angle, butterflyWingAngle(time, -time * 999, offset, 1), 'legacy fast phase cannot add extra flaps');
    }
    assert.ok(gliding / 9001 > 0.79, 'at least four fifths of flight is a quiet glide');
    assert.ok(peaks.length >= 17);
    for (const width of widths) assert.ok(width >= 0.58 && width <= 0.61);
    for (let i = 1; i < peaks.length; i++) {
      assert.ok(peaks[i] - peaks[i - 1] >= 2.99 && peaks[i] - peaks[i - 1] <= 5.01);
    }
    firstPeaks.push(peaks[0]);
  }
  assert.equal(new Set(firstPeaks).size, firstPeaks.length, 'butterflies do not flap in synchrony');
});

test('wing timing uses elapsed seconds while travel speed and paused frames remain independent', () => {
  const scene = new THREE.Scene();
  const ambient = createAmbient({ scene, props: { handles: { flowers: { list: [{ x: 0, z: 0 }] }, trees: [] } }, getHeight: () => 1, butterflies: 1, petals: 0, fireflies: 0, glints: 0 });
  try {
    ambient.setButterflyMotion(0);
    ambient.update(2, 9000, null, null, 0);
    assert.equal(ambient.butterflies.wingTime, 2);
    assert.equal(ambient.butterflies.time, 0.9);
    ambient.setButterflyMotion(1);
    ambient.update(0, 10000, null, null, 0);
    assert.equal(ambient.butterflies.wingTime, 2);
    ambient.update(1, 10001, null, null, 0);
    assert.equal(ambient.butterflies.wingTime, 3);
    assert.equal(ambient.butterflies.time, 1.9);
  } finally {
    scene.traverse((obj) => { obj.geometry?.dispose(); obj.material?.dispose(); });
  }
});
