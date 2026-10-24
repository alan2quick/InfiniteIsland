import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ISLANDS, CAMERA_FAR, CAMERA_FOV } from '../public/js/config.js';
import { frameExtent } from '../public/js/world/islands/extent.js';
import { islandIntroOptions } from '../public/js/camera/islandIntro.js';
import { createIntroFog } from '../public/js/camera/introFog.js';
import { FollowCamera } from '../public/js/camera/followCamera.js';

test('opening centres on the current island rather than an off-centre saved player, and frames coast on desktop/tall touch', () => {
  for (const id of ['home', 'frost', 'duskcrown']) for (const [width, height, touch] of [[1600, 900, false], [390, 844, true]]) {
    const island = ISLANDS.find((entry) => entry.id === id), extent = frameExtent(island);
    const target = { x: island.x + 20, y: 2, z: island.z + 10 };
    const camera = new THREE.PerspectiveCamera(CAMERA_FOV, width / height, 0.1, CAMERA_FAR);
    const follow = new FollowCamera(camera); follow.touch = touch; follow.resize(width, height);
    const options = islandIntroOptions(ISLANDS, target, camera);
    assert.equal(options.center.x, island.x); assert.equal(options.center.z, island.z);
    assert.ok(options.height < camera.far);
    follow.update(0, target); follow.startIntro(options); follow.update(0, target); camera.updateMatrixWorld();
    for (const x of [-extent.halfX, extent.halfX]) for (const z of [-extent.halfZ, extent.halfZ]) {
      const projected = new THREE.Vector3(island.x + x, target.y, island.z + z).project(camera);
      assert.ok(Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1 && projected.z < 1, `${id} ${width}: coast remains within opening frame`);
    }
    follow.update(options.duration, target); assert.equal(follow.introActive, false);
  }
});


test('aerial intro remains visible through ground-view fog and restores exact fog ranges on skip', () => {
  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 16 / 9, 0.1, CAMERA_FAR);
  const follow = new FollowCamera(camera), scene = { fog: { near: 32, far: 155 } };
  const bridge = createIntroFog(scene, follow);
  follow.update(0, { x: 880, y: 2, z: 360 });
  follow.startIntro({ center: { x: 880, y: 2, z: 360 }, height: 400 });
  bridge.beforeFrame(0); bridge.afterLighting();
  assert.ok(scene.fog.far > 400, 'high island opening is not hidden behind ground-view fog');
  follow.skipIntro(); bridge.beforeFrame(0); bridge.afterLighting();
  assert.deepEqual(scene.fog, { near: 32, far: 155 });
});
