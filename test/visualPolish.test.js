// Rendering settings must remain cosmetic: no world geometry changes or party music timing drift.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ISLANDS } from '../public/js/config.js';
import { buildFarTerrain, setGroundBlend, terrainUniforms } from '../public/js/world/terrainMesh.js';
import { createAmbient } from '../public/js/fx/ambient.js';
import { butterflyWingAngle } from '../public/js/fx/butterflyMotion.js';
import { SPAWN } from '../public/js/world/terrain.js';
import { createWater, waterUniforms } from '../public/js/world/water.js';
import { Music } from '../public/js/audio/music.js';
import { GraphContext } from './fixtures/audioGraph80d.js';

test('ground smoothing is live and leaves terrain vertices and colors unchanged', () => {
  const original = buildFarTerrain(ISLANDS[0], 16);
  try {
    const positions = original.mesh.geometry.attributes.position.array.slice();
    const colors = original.mesh.geometry.attributes.color.array.slice();
    const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <begin_vertex>', fragmentShader: '#include <common>\n#include <color_fragment>' };
    original.mesh.material.onBeforeCompile(shader);
    assert.equal(shader.uniforms.uGroundBlend.value, 1);
    setGroundBlend(0);
    assert.equal(shader.uniforms.uGroundBlend.value, 0);
    const rebuilt = buildFarTerrain(ISLANDS[0], 16);
    try {
      assert.equal(rebuilt.mesh.material, original.mesh.material);
      assert.deepEqual(rebuilt.mesh.geometry.attributes.position.array, positions);
      assert.deepEqual(rebuilt.mesh.geometry.attributes.color.array, colors);
    } finally { rebuilt.dispose(); }
    setGroundBlend(99); assert.equal(terrainUniforms.uGroundBlend.value, 1);
    setGroundBlend(NaN); assert.equal(terrainUniforms.uGroundBlend.value, 1);
  } finally { setGroundBlend(1); original.dispose(); }
});

test('butterflies glide most of the time, keep moderate wing angles and avoid negative instance scales', () => {
  let gliding = 0;
  for (let i = 0; i < 3600; i++) {
    const angle = butterflyWingAngle(i / 60, i / 60 * Math.PI * 6, 0, 0.3);
    assert.ok(angle > 0 && angle < 0.45);
    if (angle < 0.1) gliding++;
  }
  assert.ok(gliding / 3600 > 0.65, 'at least two thirds of the time wings remain near their glide pose');
  const scene = new THREE.Scene();
  const ambient = createAmbient({ scene, props: { handles: { flowers: { list: [{ x: 0, z: 0 }] }, trees: [] } }, getHeight: () => 1, butterflies: 1, petals: 0, fireflies: 0, glints: 0 });
  const matrix = new THREE.Matrix4();
  try {
    for (let i = 0; i < 240; i++) {
      ambient.update(1 / 60, i / 60, null, null, 0);
      for (let w = 0; w < ambient.butterflies.n * 2; w++) {
        ambient.butterflies.wings.getMatrixAt(w, matrix);
        assert.ok(matrix.determinant() > 0, 'InstancedMesh wings must not have reflected transforms');
      }
    }
    const previous = ambient.butterflies.time;
    ambient.setButterflyMotion(1);
    ambient.update(0, 9000, null, null, 0);
    assert.equal(ambient.butterflies.time, previous, 'changing motion must not jump visual time');
  } finally {
    scene.traverse((obj) => { obj.geometry?.dispose(); obj.material?.dispose(); });
  }
});

test('five small butterflies spread across local flower homes, at distinct gently changing heights', () => {
  const scene = new THREE.Scene();
  const flowers = [{ x: SPAWN.x, z: SPAWN.z }];
  for (let i = 0; i < 16; i++) {
    const angle = i * Math.PI / 8;
    flowers.push({ x: SPAWN.x + Math.cos(angle) * 45, z: SPAWN.z + Math.sin(angle) * 45 });
  }
  const originalFlowers = structuredClone(flowers);
  const ambient = createAmbient({ scene, props: { handles: { flowers: { list: flowers }, trees: [] } }, getHeight: () => 1, petals: 0, fireflies: 0, glints: 0 });
  try {
    const bf = ambient.butterflies;
    assert.equal(bf.n, 5);
    assert.equal(bf.wings.count, 10); assert.equal(bf.bodies.count, 5);
    assert.deepEqual(flowers, originalFlowers, 'world flower positions are read-only');
    assert.equal(new Set(bf.state.map((s) => s.altitude)).size, 5);
    for (let i = 0; i < bf.n; i++) {
      const s = bf.state[i];
      assert.ok(s.size >= 0.95 * 0.65 && s.size <= 1.25 * 0.65);
      assert.ok(Math.hypot(s.a.x - SPAWN.x, s.a.z - SPAWN.z) >= 14);
      assert.ok(Math.hypot(s.a.x - s.b.x, s.a.z - s.b.z) <= 8, 'no cross-island commute through the camp');
      for (let j = 0; j < i; j++) assert.ok(Math.hypot(s.a.x - bf.state[j].a.x, s.a.z - bf.state[j].a.z) >= 14);
    }
    bf.update(0, 0);
    const minY = bf.state.map((s) => s.y), maxY = [...minY], previous = [...minY];
    for (let frame = 0; frame < 2400; frame++) {
      bf.update(1 / 60, frame / 60);
      for (let i = 0; i < bf.n; i++) {
        const s = bf.state[i];
        assert.ok(Math.abs(s.y - previous[i]) < 0.003, 'slow, continuous rise/dip');
        assert.ok(Math.abs(s.y - (1 + s.altitude)) <= 0.28 + 1e-9);
        minY[i] = Math.min(minY[i], s.y); maxY[i] = Math.max(maxY[i], s.y); previous[i] = s.y;
      }
    }
    for (let i = 0; i < bf.n; i++) assert.ok(maxY[i] - minY[i] > 0.12, 'each butterfly changes altitude over time');
  } finally { scene.traverse((obj) => { obj.geometry?.dispose(); obj.material?.dispose(); }); }
});

test('water motion changes preserve phase, shared ribbon uniforms, and the day/night palette', () => {
  const water = createWater();
  water.update(10);
  assert.equal(waterUniforms.uTime.value, 10);
  const tint = waterUniforms.uShallowTint.value.clone();
  water.setMotion(0);
  water.update(10); assert.equal(waterUniforms.uTime.value, 10);
  water.update(15); assert.equal(waterUniforms.uTime.value, 11);
  water.setMotion(1); water.update(16); assert.equal(waterUniforms.uTime.value, 12);
  water.update(NaN); assert.equal(waterUniforms.uTime.value, 12);
  assert.ok(waterUniforms.uShallowTint.value.equals(tint));
  const geos = new Set(), mats = new Set();
  water.group.traverse((obj) => { if (obj.geometry) geos.add(obj.geometry); if (obj.material) mats.add(obj.material); });
  geos.forEach((g) => g.dispose()); mats.forEach((m) => m.dispose());
  Object.values(water.heightTextures).forEach((t) => t.dispose());
});

function withMusic(fn) {
  const previous = globalThis.document;
  globalThis.document = { addEventListener() {} };
  try {
    const music = new Music({ onChange() {} });
    music.ctx = new GraphContext(2, 1, 8000); music.ctx.currentTime = 10;
    music.bus = music.ctx.destination; music.assets = {}; music._booted = true;
    music._retire = () => {}; // No live audio voices in this graph test.
    fn(music);
  } finally { globalThis.document = previous; }
}

test('exploration tempo survives tracks and party dynamic tempos stay independent', () => withMusic((music) => {
  music._running = true;
  music._beginTrack(0); assert.equal(music._seq.k, 0.8);
  music.setBaseTempo(0.7); assert.equal(music._seq.k, 0.7);
  music._beginTrack(2); assert.equal(music._seq.k, 0.7);
  music.party('vineskip'); music._beginTrack(19); assert.equal(music._seq.k, 1);
  music.setTempo(1.4); assert.equal(music._seq.k, 1.4);
  music.setBaseTempo(0.6); assert.equal(music._seq.k, 1.4);
  music._beginTrack(19); assert.equal(music._seq.k, 1.4);
  music.party(null); music._beginTrack(0); assert.equal(music._seq.k, 0.6);
  music.setBaseTempo(Infinity); assert.equal(music.baseTempo, 0.6);
}));

test('changing exploration tempo while paused preserves the musical resume point', () => withMusic((music) => {
  music._beginTrack(0);
  music._pos = 20;
  const musicalPosition = music._pos * music._seq.k;
  music.setBaseTempo(0.5);
  assert.equal(music._pos * music._seq.k, musicalPosition);
}));
