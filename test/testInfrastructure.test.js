// Guard the test optimizations themselves: portability must not mask world changes,
// and acceleration must retain exact mesh intersections, including transforms.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { assertPlacementGolden } from './helpers/placementGolden.js';
import { spatialRaycastMesh } from './helpers/spatialRaycast.js';

test('placement golden allows last-bit heights but rejects moved, added and changed records', () => {
  const original = JSON.parse(readFileSync(new URL('./fixtures/emberFlowers.json', import.meta.url), 'utf8'));
  const check = records => assertPlacementGolden(records, 'emberFlowers', '834b877a48');
  check(original);
  const tiny = structuredClone(original); tiny[0].y += 1e-14; check(tiny);
  for (const [field, amount] of [['y', 1e-6], ['x', 1e-9], ['z', 1e-9]]) {
    const moved = structuredClone(original); moved[0][field] += amount;
    assert.throws(() => check(moved), assert.AssertionError, `${field} movement must fail`);
  }
  const changed = structuredClone(original); changed[0].interactive = !changed[0].interactive;
  assert.throws(() => check(changed), assert.AssertionError);
  assert.throws(() => check(original.slice(1)), assert.AssertionError);
});

test('spatial ray helper agrees with original indexed and nonindexed meshes in world space', () => {
  for (const indexed of [true, false]) {
    let geometry = new THREE.PlaneGeometry(20, 20, 8, 8);
    if (!indexed) { const old = geometry; geometry = geometry.toNonIndexed(); old.dispose(); }
    const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    const source = new THREE.Mesh(geometry, material);
    source.rotation.set(-Math.PI / 2, 0, 0.3); source.position.set(4, 2, 8);
    source.updateMatrixWorld(true);
    const accelerated = spatialRaycastMesh(source, 3);
    const ray = new THREE.Raycaster(), dir = new THREE.Vector3(0, -1, 0);
    let hits = 0, misses = 0;
    for (let z = -6; z < 23; z += 2) for (let x = -10; x < 19; x += 2) {
      ray.set(new THREE.Vector3(x + 0.13, 30, z + 0.17), dir);
      const expected = ray.intersectObject(source)[0], actual = ray.intersectObject(accelerated.mesh)[0];
      assert.equal(Boolean(actual), Boolean(expected));
      if (expected) { hits++; assert.ok(Math.abs(actual.distance - expected.distance) < 1e-12); }
      else misses++;
    }
    assert.ok(hits > 40 && misses > 40);
    assert.equal(accelerated.mesh.children.reduce((sum, m) => sum + m.geometry.getAttribute('position').count, 0), 8 * 8 * 6);
    accelerated.dispose(); geometry.dispose(); material.dispose();
  }
});
