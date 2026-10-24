import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { createProps } from '../public/js/world/props.js';
import { grassShapeAt } from '../public/js/world/grassVariation.js';
import { applySway } from '../public/js/world/wind.js';
import { getColliders, clearColliders } from '../public/js/world/colliders.js';
import { getInteractables, clearInteractables } from '../public/js/world/interactables.js';
import { installDom } from './fixtures/domStub.js';
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const round = (n) => Math.round(n * 1e5) / 1e5;

test('cosmetic grass changes preserve every original tuft position and gameplay registration/RNG sequence', () => {
  installDom(); clearColliders(); clearInteractables();
  const props = createProps(new THREE.Scene()), grass = props.group.getObjectByName('grass-tufts'), matrix = new THREE.Matrix4(), positions = [], proportions = new Set();
  for (let i = 0; i < grass.count; i++) {
    grass.getMatrixAt(i, matrix); positions.push(matrix.elements.slice(12, 15).map(round));
    const x = new THREE.Vector3().setFromMatrixColumn(matrix, 0).length(), z = new THREE.Vector3().setFromMatrixColumn(matrix, 2).length();
    proportions.add((x / z).toFixed(3));
  }
  const physics = { colliders: getColliders().map((c) => [round(c.x), round(c.z), round(c.r)]), interactions: getInteractables().map((c) => [c.id, c.type, c.position?.x, c.position?.y, c.position?.z]) };
  // Captured before this cosmetic change. These protect placement/state, not a picture or incidental triangle ordering.
  assert.equal(grass.count, 300); assert.equal(hash(positions), '5decdc7299c105d80f3cdf038040fa0c2a32c40cef724c09403b946497dab577');
  assert.equal(hash(physics), 'f99bc1577d19302f85edd0f6d3958071b42cbddef6feddb693ca9b47f2b034a7');
  assert.ok(proportions.size > 100, 'tufts now have visibly different width/depth proportions in one instanced draw');
  assert.equal(grass.isInstancedMesh, true); assert.equal(grass.geometry.attributes.position.count, 60);
  clearColliders(); clearInteractables();
});

test('grass proportions are repeatable, bounded and distinct without sampling the placement RNG', () => {
  for (let i = 0; i < 100; i++) {
    const x = i * 0.37, z = -i * 0.71, value = grassShapeAt(x, z);
    assert.deepEqual(value, grassShapeAt(x, z));
    assert.ok(value.width >= 0.82 && value.width <= 1.18); assert.ok(value.depth >= 0.82 && value.depth <= 1.18);
    assert.ok(value.height >= 0.9 && value.height <= 1.12);
  }
  assert.notDeepEqual(grassShapeAt(1, 2), grassShapeAt(2, 1));
});

test('grass-only wind varies per-instance phase/amplitude/frequency without extra geometry attributes', () => {
  const plain = applySway(new THREE.MeshBasicMaterial()), grass = applySway(new THREE.MeshBasicMaterial(), { variation: true });
  const source = () => ({ uniforms: {}, vertexShader: '#include <common>\n#include <project_vertex>' });
  const base = source(), varied = source(); plain.onBeforeCompile(base); grass.onBeforeCompile(varied);
  assert.equal(base.vertexShader.includes('wSeed'), false, 'flowers and herbs retain their original motion');
  assert.ok(varied.vertexShader.includes('mix(0.72, 1.24, wSeed.y)'));
  assert.ok(varied.vertexShader.includes('mix(0.6, 1.15, wSeed.z)'));
  assert.ok(varied.vertexShader.includes('wPh += wSeed.x'));
  assert.equal(varied.vertexShader.includes('attribute '), false);
  assert.notEqual(plain.customProgramCacheKey(), grass.customProgramCacheKey());
  assert.ok(varied.vertexShader.includes('wH * wH'), 'curvature remains anchored at zero height');
  plain.dispose(); grass.dispose();
});
