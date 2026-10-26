import test from 'node:test';
import assert from 'node:assert/strict';
import { createWater, buildRibbon, HOME_STREAM_MOUTH, waterUniforms } from '../public/js/world/water.js';
import { STREAM_PATH, getTerrainHeight } from '../public/js/world/terrain.js';
import { getColliders } from '../public/js/world/colliders.js';
import { getInteractables } from '../public/js/world/interactables.js';

function disposeWater(water) {
  const geometries = new Set(), materials = new Set();
  water.group.traverse((m) => { if (m.geometry) geometries.add(m.geometry); if (m.material) materials.add(m.material); });
  geometries.forEach((g) => g.dispose()); materials.forEach((m) => m.dispose()); Object.values(water.heightTextures).forEach((t) => t.dispose());
}
test('home stream reaches inside the pond and fades continuously before its geometric end', () => {
  const registrations = [getColliders().slice(), getInteractables().slice()], heights = STREAM_PATH.map((p) => getTerrainHeight(p.x, p.z));
  const water = createWater();
  try {
    const stream = water.group.getObjectByName('stream'), positions = stream.geometry.attributes.position, mouth = stream.geometry.attributes.aMouth;
    assert.equal(positions.count, STREAM_PATH.length * 2, 'the strip must continue all the way into the lake');
    assert.equal(mouth.count, positions.count);
    assert.equal(mouth.getX(0), 0); assert.equal(mouth.getX(mouth.count - 1), 1);
    assert.ok(Array.from(mouth.array).some((v) => v > 0.1 && v < 0.9), 'the join needs intermediate blend weights, not a new hard edge');
    for (let i = 1; i < mouth.count; i++) assert.ok(mouth.getX(i) >= mouth.getX(i - 1));
    const last = positions.count - 2, end = STREAM_PATH.at(-1);
    assert.ok(Math.abs((positions.getX(last) + positions.getX(last + 1)) / 2 - end.x) < 1e-5);
    assert.ok(Math.abs(positions.getY(last) - 0.012) < 1e-6);
    assert.equal(stream.material.depthWrite, false, 'transparent inlet must not leave an invisible depth wall');
    assert.equal(stream.material.uniforms.uTime, waterUniforms.uTime);
    assert.match(stream.material.vertexShader, /pondWave/); assert.match(stream.material.fragmentShader, /mouthFade \* sideFade/);
    assert.deepEqual(STREAM_PATH.map((p) => getTerrainHeight(p.x, p.z)), heights);
    assert.deepEqual(getColliders(), registrations[0]); assert.deepEqual(getInteractables(), registrations[1]);
  } finally { disposeWater(water); }
});

test('pond foam opening is localized to the existing inlet and other ribbon materials keep their original contract', () => {
  const water = createWater();
  try {
    const material = water.group.getObjectByName('ocean-inner').material, segment = material.uniforms.uHomeMouthSegment.value;
    assert.deepEqual(segment.toArray(), [13, 6, 17.5, 7.6]);
    assert.equal(material.uniforms.uHomeMouthWidth.value, HOME_STREAM_MOUTH.halfWidth);
    assert.ok(HOME_STREAM_MOUTH.halfWidth < 1.7);
    assert.match(material.fragmentShader, /foam \*= 1\.0 - inletOpen/);
    const plain = buildRibbon([{ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 1 }], 0.5);
    try {
      assert.equal(plain.geometry.attributes.aMouth, undefined);
      assert.equal(plain.material.depthWrite, true);
      assert.doesNotMatch(plain.material.vertexShader, /pondWave/);
      assert.doesNotMatch(plain.material.fragmentShader, /mouthFade/);
    } finally { plain.geometry.dispose(); plain.material.dispose(); }
  } finally { disposeWater(water); }
});
