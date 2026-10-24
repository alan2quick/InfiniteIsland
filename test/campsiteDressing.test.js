import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { installDom } from './fixtures/domStub.js';
import { CAMPFIRE } from '../public/js/config.js';
import { campsiteLayout, createCampsiteDressing } from '../public/js/world/campsiteDressing.js';
import { createProps } from '../public/js/world/props.js';
import { getColliders, clearColliders } from '../public/js/world/colliders.js';
import { getInteractables, clearInteractables } from '../public/js/world/interactables.js';
import { getTerrainHeight, SPAWN } from '../public/js/world/terrain.js';
import { VERTEX_TOON } from '../public/js/render/geo.js';

installDom();
test('campsite placements stay outside fire seating, routes, obstacles and preserve the actual home scene', () => {
  clearColliders(); clearInteractables();
  const scene = new THREE.Scene(); createProps(scene);
  const colliders = getColliders().slice(), interactables = getInteractables().slice(), first = campsiteLayout();
  assert.deepEqual(first, campsiteLayout()); assert.equal(first.length, 2);
  assert.deepEqual(first.map((s) => s.kind), ['tent', 'picnic']);
  for (const site of first) {
    assert.ok(Math.hypot(site.x - CAMPFIRE.x, site.z - CAMPFIRE.z) > CAMPFIRE.clear + site.radius);
    for (const c of colliders) assert.ok(Math.hypot(site.x - c.x, site.z - c.z) > site.radius + c.r);
    assert.ok(Math.hypot(site.x - SPAWN.x, site.z - SPAWN.z) > site.radius + 1.4);
  }
  const heights = first.map((s) => getTerrainHeight(s.x, s.z));
  const dressing = createCampsiteDressing({ scene });
  assert.deepEqual(dressing.layout, first);
  assert.deepEqual(first.map((s) => getTerrainHeight(s.x, s.z)), heights);
  assert.deepEqual(getColliders(), colliders); assert.deepEqual(getInteractables(), interactables);
  assert.ok(dressing.group.getObjectByName('camp-picnic-table')); assert.ok(dressing.group.getObjectByName('camp-large-tent'));
  dressing.dispose();
});

test('campsite geometry uses two merged meshes and no extra lighting/shadows, with full/far visibility and clean disposal', () => {
  const scene = new THREE.Scene(), world = { root: { visible: true }, regions: { isFull: () => true } };
  const layout = [{ kind: 'tent', x: -1, y: 1, z: 1, radius: 3.3, angle: 0 }, { kind: 'picnic', x: 12, y: 1, z: 17, radius: 2.3, angle: 0 }];
  const dressing = createCampsiteDressing({ scene, world, layout });
  let disposals = 0, lights = 0;
  dressing.group.traverse((node) => {
    if (node.isLight) lights++;
    if (!node.isMesh) return;
    assert.equal(node.castShadow, false); assert.equal(node.receiveShadow, false); assert.equal(node.material, VERTEX_TOON);
    node.geometry.addEventListener('dispose', () => disposals++);
    node.geometry.computeBoundingBox(); assert.ok(node.geometry.boundingBox.max.y > 1.5);
  });
  assert.equal(lights, 0); assert.equal(dressing.summary().draws, 2); assert.ok(dressing.summary().triangles < 1800);
  console.log(JSON.stringify({ campsiteTriangles: dressing.summary().triangles, campsiteDraws: dressing.summary().draws }));
  dressing.update(0, null, { hidden: true }); assert.equal(dressing.group.visible, false);
  dressing.update(0, null); assert.equal(dressing.group.visible, true);
  world.regions.isFull = () => false; dressing.update(0, null); assert.equal(dressing.group.visible, false);
  dressing.dispose(); dressing.dispose(); assert.equal(disposals, 2); assert.equal(scene.children.length, 0);
});

test('a fully occupied campsite omits new props rather than moving existing gameplay objects', () => {
  const obstacles = [{ x: CAMPFIRE.x, z: CAMPFIRE.z, r: 100 }];
  const snapshot = JSON.stringify(obstacles);
  assert.deepEqual(campsiteLayout({ obstacles, interactables: [], heightAt: () => 1, groundAt: () => 'grass', walkable: () => true }), []);
  assert.equal(JSON.stringify(obstacles), snapshot);
});
