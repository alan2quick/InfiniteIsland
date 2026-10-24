import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createEnvironmentBridge } from '../public/js/settings/environmentBridge.js';
import { DEFAULT_WORLD_SETTINGS as defaults } from '../public/js/settings/worldSettings.js';
import { DayNight } from '../public/js/world/dayNight.js';
const settings = (patch) => ({ ...defaults, ...patch });

test('the original game advertises only implemented controls; optional adapters enable their controls', () => {
  const dayNight = new DayNight({ persist: false });
  const renderer = { toneMappingExposure: 1 }, scene = { fog: new THREE.Fog('#ffffff', 100, 300) };
  const bridge = createEnvironmentBridge({ dayNight, renderer, scene, water: {}, ambient: {}, music: {}, followCam: {} });
  const capabilities = bridge.getCapabilities();
  for (const key of ['hour', 'dayCycle', 'brightness', 'haze']) assert.equal(capabilities[key], true);
  for (const key of ['breeze', 'water', 'butterflies', 'musicTempo', 'musicVolume', 'natureVolume', 'cameraMode', 'cameraAngle', 'cameraDistance', 'cameraSmoothness', 'intro']) assert.equal(capabilities[key], false);
  assert.doesNotThrow(() => bridge.apply(settings({ water: 0, cameraMode: 'follow' }), { preview: true }));
  const enabled = createEnvironmentBridge({ water: { setMotion() {} }, ambient: { setButterflyMotion() {} }, music: { setBaseTempo() {}, setVolume() {} }, ambienceAudio: { setVolume() {} }, followCam: { setSettings() {}, startIntro() {} } }).getCapabilities();
  for (const key of ['water', 'butterflies', 'musicTempo', 'musicVolume', 'natureVolume', 'cameraMode', 'intro']) assert.equal(enabled[key], true);
});

test('a private clock preview does not write or broadcast the saved host clock', () => {
  const dayNight = new DayNight({ persist: false }); dayNight.set(19); dayNight.locked = true;
  let changed = 0; const original = dayNight.set.bind(dayNight); dayNight.set = (hour) => { changed++; original(hour); };
  let ambientClock; const ambient = { setClock(clock) { ambientClock = clock; } };
  const bridge = createEnvironmentBridge({ dayNight, ambient, sync: { isHost: true } });
  bridge.apply(settings({ hour: 8, dayCycle: true }), { preview: true });
  const visual = bridge.beforeFrame(1);
  assert.notEqual(visual, dayNight); assert.equal(ambientClock, visual); assert.equal(dayNight.hour, 19); assert.equal(changed, 0);
  assert.equal(bridge.applyPublishedTime(defaults, { revision: 0 }), false); assert.equal(dayNight.hour, 19);
  assert.equal(bridge.applyPublishedTime(settings({ hour: 12 }), { revision: 1 }), true); assert.equal(dayNight.hour, 12);
  assert.equal(bridge.applyPublishedTime(settings({ hour: 12 }), { revision: 2 }), false); assert.equal(changed, 1);
});

test('replicas never own published time and cosmetic lighting restores without accumulation', () => {
  const clock = new DayNight({ persist: false }); const hour = clock.hour;
  const renderer = { toneMappingExposure: 1 }, scene = { fog: new THREE.Fog('#ffffff', 100, 300) };
  const bridge = createEnvironmentBridge({ renderer, scene, dayNight: clock, sync: { isHost: false } });
  assert.equal(bridge.applyPublishedTime(settings({ hour: 12 }), { revision: 1 }), false); assert.equal(clock.hour, hour);
  bridge.apply(settings({ brightness: 1.5, haze: 0.75 }));
  bridge.afterLighting(); const fog = scene.fog.near;
  bridge.afterLighting(); assert.equal(renderer.toneMappingExposure, 1.5); assert.equal(scene.fog.near, fog);
  bridge.beforeFrame(); assert.equal(renderer.toneMappingExposure, 1); assert.equal(scene.fog.near, 100); assert.equal(scene.fog.far, 300);
});
