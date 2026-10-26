// Blended grass shading (ported from the Stephenitis/InfiniteIsland fork) must stay cosmetic: no terrain data changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ISLANDS } from '../public/js/config.js';
import { buildFarTerrain, setGroundBlend, terrainUniforms } from '../public/js/world/terrainMesh.js';

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
