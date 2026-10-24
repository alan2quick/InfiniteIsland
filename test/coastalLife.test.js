import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ISLANDS } from '../public/js/config.js';
import { COASTAL_CAPS, beachDressingPlan, seaLifePlan, safeWaterOrbit } from '../public/js/world/coastalPlan.js';
import { createCoastalLife } from '../public/js/fx/coastalLife.js';
import { getTerrainHeight, getGroundType } from '../public/js/world/terrain.js';
import { getColliders } from '../public/js/world/colliders.js';
import { getInteractables } from '../public/js/world/interactables.js';
import { VERTEX_TOON } from '../public/js/render/geo.js';

const triangles = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;
test('coastal plans are seeded, bounded, dry sand decorations and safe water orbits', () => {
  for (const island of ISLANDS) {
    const beach = beachDressingPlan(island);
    assert.deepEqual(beach, beachDressingPlan(island)); assert.ok(beach.length <= COASTAL_CAPS.beachPerIsland);
    for (const p of beach) { assert.equal(getGroundType(p.x, p.z), 'sand'); assert.ok(getTerrainHeight(p.x, p.z) > 0.08); }
  }
  const sea = seaLifePlan(); assert.deepEqual(sea, seaLifePlan());
  for (const kind of ['fish', 'octopus', 'dolphin', 'whale']) assert.ok(sea.some((a) => a.kind === kind), kind);
  for (const a of sea) assert.ok(safeWaterOrbit(a.x, a.z, a.radius, ({ fish: 0.35, octopus: 0.2, dolphin: 1.5, whale: 2.7 })[a.kind]));
  assert.equal(safeWaterOrbit(0, 0, 1, 1, () => 2), false);
});

test('coastal life adds no gameplay registrations, lights or shadows and stays inside geometry/draw caps', () => {
  const colliders = getColliders().slice(), interactions = getInteractables().slice(), scene = new THREE.Scene();
  const active = new Set(ISLANDS.map((i) => i.id)), world = { root: { visible: true }, regions: { isFull: (id) => active.has(id) } };
  const life = createCoastalLife({ scene, world });
  life.update(1 / 60, 0, { x: 0, z: 0 });
  let total = 0, meshes = 0;
  life.group.traverse((node) => {
    assert.ok(!node.isLight);
    if (!node.isMesh) return;
    meshes++; assert.equal(node.castShadow, false); assert.equal(node.receiveShadow, false); assert.equal(node.material, VERTEX_TOON);
    total += triangles(node.geometry) * (node.isInstancedMesh ? COASTAL_CAPS[node.name.replace('coastal-', '')] : 1);
  });
  assert.ok(meshes <= ISLANDS.length + 4); assert.ok(total < 30000, `full-capacity geometry budget: ${total}`);
  assert.deepEqual(getColliders(), colliders); assert.deepEqual(getInteractables(), interactions);
  for (let t = 0; t < 180; t += 0.5) {
    life.update(0.5, t, { x: 0, z: 0 });
    for (const [kind, mesh] of Object.entries(life.batches)) assert.ok(mesh.count <= COASTAL_CAPS[kind]);
    assert.ok(life.summary().draws <= 9);
  }
  console.log(JSON.stringify({ coastalFullCapacityTriangles: total, maximumDraws: meshes }));
  life.dispose(); assert.equal(scene.children.length, 0);
});

test('distance, hidden scenes and full/far changes suppress life, dispose beach geometry and rebuild safely', () => {
  const island = ISLANDS[0], active = new Set(['home']), scene = new THREE.Scene();
  const world = { root: { visible: true }, regions: { isFull: (id) => active.has(id) } };
  const plan = ['fish', 'dolphin', 'whale', 'octopus'].map((kind) => ({ kind, island: 'home', x: 0, z: 0, radius: 1, period: 40, phase: 0.5, scale: 1 }));
  const life = createCoastalLife({ scene, world, islands: [island], plan });
  life.update(0, 0, { x: 0, z: 0 }); assert.ok(life.group.getObjectByName('beach-dressing-home'));
  for (const mesh of Object.values(life.batches)) assert.equal(mesh.count, 1);
  let disposed = 0; life.group.getObjectByName('beach-dressing-home').geometry.addEventListener('dispose', () => disposed++);
  active.clear(); life.update(0, 1, { x: 0, z: 0 }); assert.equal(disposed, 1);
  for (const mesh of Object.values(life.batches)) assert.equal(mesh.count, 0);
  active.add('home'); life.update(0, 2, { x: 1000, z: 1000 });
  for (const mesh of Object.values(life.batches)) assert.equal(mesh.count, 0);
  life.update(0, 3, { x: 0, z: 0 }, { hidden: true }); assert.equal(life.group.visible, false);
  world.root.visible = false; life.update(0, 4, { x: 0, z: 0 }); assert.equal(life.group.visible, false);
  world.root.visible = true; life.update(0, 5, { x: 0, z: 0 }); assert.equal(life.group.visible, true);
  life.dispose(); life.dispose(); assert.equal(scene.children.length, 0);
});
