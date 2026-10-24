import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { installDom, el } from './fixtures/domStub.js';
import { createCampfire } from '../public/js/world/campfire.js';
import { createProps } from '../public/js/world/props.js';
import { softenRockGeometry } from '../public/js/render/softRock.js';
import { buildHomeSpring, createWater, waterUniforms } from '../public/js/world/water.js';
import { STREAM_PATH, getHeight } from '../public/js/world/terrain.js';
import { clearColliders } from '../public/js/world/colliders.js';
import { clearInteractables } from '../public/js/world/interactables.js';

installDom();
const makeElement = document.createElement;
document.createElement = (...args) => { const node = makeElement(...args); node.firstElementChild = el(); return node; };
function fireRig() {
  clearColliders(); clearInteractables();
  const effects = [], scene = new THREE.Scene();
  const players = { list: [{ position: new THREE.Vector3(7, 1, 9.5) }], get() {} };
  const fire = createCampfire({ scene, players, particles: { burst(...args) { effects.push(args); } }, hud: { root: el(), toast() {} },
    inventory: { count() { return 0; }, on() {} }, dialog: { isOpen: false }, sync: { isHost: true, register() {}, emit() {}, hostNow: () => 0 } });
  return { fire, effects, scene };
}
function disposeScene(scene) {
  const geometry = new Set(), materials = new Set();
  scene.traverse((node) => { if (node.geometry) geometry.add(node.geometry); if (node.material) materials.add(node.material); });
  geometry.forEach((g) => g.dispose()); materials.forEach((m) => m.dispose());
}

test('cold campfires stay quiet; burning fires show all three cores without changing fuel rates or light count', () => {
  const { fire, effects, scene } = fireRig();
  try {
    fire.setFuel(0); effects.length = 0;
    for (let i = 0; i < 180; i++) fire.update(1 / 30);
    assert.equal(fire.flames.visible, false); assert.equal(fire.fuel, 0);
    assert.equal(effects.filter(([kind]) => kind === 'smoke').length, 0, 'cold ashes must not endlessly puff smoke');
    fire.setFuel(180);
    for (let i = 0; i < 120; i++) fire.update(1 / 60);
    assert.ok(Math.abs(fire.fuel - 178) < 1e-6, 'visual changes must not alter the burn timer');
    assert.ok(fire.flames.visible); assert.equal(fire.flames.children.length, 3);
    for (const tongue of fire.flames.children) {
      assert.equal(tongue.material.depthWrite, false, 'outer shells must not occlude the shorter yellow/orange cores');
      assert.equal(tongue.material.depthTest, true, 'terrain and logs still occlude flames');
      assert.ok(tongue.scale.y > 0.9);
    }
    let lights = 0; scene.traverse((node) => { if (node.isLight) lights++; }); assert.equal(lights, 0, 'an individual fire adds no lights');
  } finally { disposeScene(scene); }
});

test('decorative home foliage retains ground shadows and avoids receiving self-shadow stripes', () => {
  clearColliders(); clearInteractables();
  const scene = new THREE.Scene(), props = createProps(scene);
  try {
    let foliage = 0;
    props.group.traverse((node) => {
      if (!['tree', 'cherry-tree', 'palm', 'bush', 'berry-bush'].includes(node.name)) return;
      const mesh = node.children.find((c) => c.isMesh);
      assert.ok(mesh); assert.equal(mesh.castShadow, true); assert.equal(mesh.receiveShadow, false); foliage++;
    });
    assert.ok(foliage > 30);
  } finally { disposeScene(scene); }
});

test('soft rock shading preserves every position, index and triangle while keeping normalized normals', () => {
  const geometry = new THREE.IcosahedronGeometry(1, 0);
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: geometry.attributes.position.count * 3 }, (_, i) => 0.3 + (i % 7) / 20), 3));
  const original = geometry.attributes.position.array.slice(), count = geometry.attributes.position.count;
  softenRockGeometry(geometry);
  assert.deepEqual(geometry.attributes.position.array, original); assert.equal(geometry.attributes.position.count, count);
  for (let i = 0; i < count; i++) assert.ok(Math.abs(Math.hypot(...geometry.attributes.normal.array.slice(i * 3, i * 3 + 3)) - 1) < 1e-6);
  geometry.dispose();
});

test('the small source cascade meets the existing stream and the stream overlaps pond water without terrain edits', () => {
  const source = STREAM_PATH[0], sampleBefore = getHeight(source.x, source.z);
  const cascade = buildHomeSpring();
  const position = cascade.geometry.attributes.position;
  const end = position.count - 2;
  assert.ok(position.getY(0) > position.getY(end) + 1, 'the existing plateau face provides a visible drop');
  assert.ok(Math.abs((position.getX(end) + position.getX(end + 1)) / 2 - source.x) < 1e-5);
  assert.ok(Math.abs(position.getY(end) - sampleBefore - 0.2) < 1e-5);
  assert.equal(cascade.material.uniforms.uTime, waterUniforms.uTime);
  assert.equal(getHeight(source.x, source.z), sampleBefore);
  cascade.geometry.dispose(); cascade.material.dispose();
  const water = createWater(), stream = water.group.getObjectByName('stream'), vertices = stream.geometry.attributes.position;
  assert.ok(vertices.getY(vertices.count - 1) <= 0.031, 'ribbon reaches the pond surface instead of stopping above the bank');
  assert.equal(water.group.getObjectByName('home-spring-cascade').geometry.index.count / 3, 18);
  disposeScene(water.group); Object.values(water.heightTextures).forEach((t) => t.dispose());
});
