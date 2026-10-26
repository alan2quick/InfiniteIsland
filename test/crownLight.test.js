// Step 85b: the Crownlands' sunlit lighting. The crown weight `cw` (0 in the marsh and on every other island, 1 on the plateau top), the dusk mix cut to 0.92 * dw * (1 - cw),
// CROWN_LIGHT, the camera blend and the per-screen cloud lid, with real Three lights / fog and no GPU.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ISLANDS, DUSK_LIGHT, CROWN_LIGHT, DUSK_CAMERA, CAMERA_OFFSET } from '../public/js/config.js';
import { DayNight } from '../public/js/world/dayNight.js';
import { createSky } from '../public/js/world/sky.js';
import { createAtmosphere } from '../public/js/fx/atmosphere.js';
import { FollowCamera } from '../public/js/camera/followCamera.js';
import { setWaterLook, waterUniforms } from '../public/js/world/water.js';
import { duskUniforms } from '../public/js/world/islands/duskAtmosphere.js';
import { getIslandModule } from '../public/js/world/islands/registry.js';

const island = ISLANDS.find((i) => i.id === 'duskcrown');
const mod = getIslandModule('duskcrown'), C = mod.crown;
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const at = (lx, lz) => ({ x: island.x + lx, z: island.z + lz, y: mod.height(island.x + lx, island.z + lz) });

function rig({ flag = false } = {}) {
  const scene = new THREE.Scene(), sky = createSky(scene), camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 600);
  const clock = new DayNight({ persist: false, params: new URLSearchParams() });
  const view = { x: island.x, z: island.z + 60 }, focus = { ...at(0, 60) }, locals = [{ position: { ...focus } }];
  const atmosphere = createAtmosphere({ scene, sky, camera, clock, getHeight: mod.height, view: () => view, focus: () => focus, locals: () => locals, crownFlag: flag });
  const put = (p, snap = true) => { Object.assign(focus, p); Object.assign(view, { x: p.x, z: p.z }); locals.forEach((l) => Object.assign(l.position, p)); if (snap) atmosphere.snap(); };
  const tick = (hour, dt = 1 / 60, t = 0) => { clock.set(hour); sky.setTimeOfDay(clock); atmosphere.update(dt, t, 720); };
  return { scene, sky, camera, clock, atmosphere, put, tick, focus, locals };
}
const MARSH = at(0, 60), TOP = at(-20, -50);

test('the plateau-top weight is 0 in the marsh and on the wall, 1 well inside the plateau', () => {
  assert.ok(TOP.y > 45, `top ${TOP.y}`);
  assert.equal(C.topWeight(MARSH.x - island.x, MARSH.z - island.z, MARSH.y), 0);
  assert.equal(C.topWeight(TOP.x - island.x, TOP.z - island.z, TOP.y), 1);
  // height alone is not enough: a high point on the marsh side of the cliff is not up top, nor is low ground on the plateau side
  assert.equal(C.topWeight(-60, 120, 50), 0);
  assert.equal(C.topWeight(TOP.x - island.x, TOP.z - island.z, 20), 0);
});

test('cw: 0 in the marsh and on other islands, 1 on the plateau; eased monotonically while walking up the cliff and back', () => {
  const r = rig(); r.tick(12);
  near(r.atmosphere.crownWeight, 0); assert.equal(r.atmosphere.upTop, false);
  for (const id of ['home', 'ember', 'frost']) {
    const i = ISLANDS.find((a) => a.id === id); r.put({ x: i.x, y: 3, z: i.z }); r.tick(12);
    near(r.atmosphere.crownWeight, 0); near(r.atmosphere.summary().cw, 0);
  }
  r.put(TOP); r.tick(12); near(r.atmosphere.crownWeight, 1); assert.equal(r.atmosphere.upTop, true);
  r.put(MARSH); r.tick(12, 0.2);
  let prev = 0, rises = 0, edgeAt = null;
  for (let lz = 60; lz >= -50; lz -= 0.5) {
    const p = at(-20, lz); r.put(p, false); r.tick(12, 0.1);
    const cw = r.atmosphere.crownWeight;
    assert.ok(cw >= prev - 1e-9, `non-monotonic at ${lz}`); assert.ok(cw - prev < 0.15, `jump ${cw - prev} at ${lz}`);
    if (cw > prev) rises++;
    if (edgeAt === null && cw > 0.5) edgeAt = p.y;
    prev = cw;
  }
  assert.ok(rises > 5 && prev > 0.99, `rises ${rises}, end ${prev}`);
  assert.ok(edgeAt > 42, `cw passed 0.5 at height ${edgeAt}`);
  for (let lz = -50; lz <= 60; lz += 0.5) { r.put(at(-20, lz), false); r.tick(12, 0.1); const cw = r.atmosphere.crownWeight; assert.ok(cw <= prev + 1e-9); prev = cw; }
  assert.ok(prev < 0.05, `end ${prev}`);
  r.atmosphere.dispose();
});

test('the dusk mix is 0.92 * dw * (1 - cw): the marsh keeps its 92% dusk, up top the normal clock shows blended with CROWN_LIGHT', () => {
  const r = rig(), { sky, scene, atmosphere, clock, tick, put } = r;
  for (const hour of [0, 12]) {
    put(MARSH); tick(hour); near(atmosphere.duskWeight, 1); near(atmosphere.crownWeight, 0);
    near(sky.sun.intensity, clock.lightIntensity * 0.08 + DUSK_LIGHT.lightIntensity * 0.92);
    near(scene.fog.far, 330 * 0.08 + DUSK_LIGHT.fogFar * 0.92); near(scene.fog.near, 140 * 0.08 + DUSK_LIGHT.fogNear * 0.92);
    near(sky.stars.material.uniforms.uNight.value, 0); assert.equal(atmosphere.duskFx.spores.visible, true);
  }
  put(TOP);
  tick(12); near(atmosphere.duskWeight, 0); assert.equal(atmosphere.duskFx.spores.visible, false);
  const u = sky.dome.material.uniforms, day = 1 - clock.nightness;
  const hor = clock.look.horizon.clone().lerp(new THREE.Color(CROWN_LIGHT.horizon), CROWN_LIGHT.horizonMix * day);
  near(u.uHorizon.value.r, hor.r); near(u.uHorizon.value.g, hor.g); near(u.uHorizon.value.b, hor.b);
  const sun = clock.look.light.clone().lerp(new THREE.Color(CROWN_LIGHT.sun), CROWN_LIGHT.sunMix * day);
  near(sky.sun.color.r, sun.r); near(sky.sun.color.b, sun.b);
  near(sky.sun.intensity, clock.lightIntensity * (1 + (CROWN_LIGHT.sunBoost - 1) * day));
  near(sky.hemi.intensity, clock.look.hemiIntensity * (1 + (CROWN_LIGHT.hemiBoost - 1) * day));
  near(scene.fog.near, 140 * CROWN_LIGHT.fogNearScale); near(scene.fog.far, 330 * CROWN_LIGHT.fogFarScale);
  assert.ok(sky.sun.intensity > clock.lightIntensity && sky.sun.intensity < clock.lightIntensity * 1.1);
  near(sky.stars.material.uniforms.uNight.value, clock.nightness);
  // midnight on top: the real night with its stars, no dusk canopy; the daylight tints are gone, the fog is still farther
  tick(0); near(atmosphere.duskWeight, 0);
  near(sky.stars.material.uniforms.uNight.value, clock.nightness); assert.ok(clock.nightness > 0.9);
  near(sky.sun.intensity, clock.lightIntensity * (1 + (CROWN_LIGHT.sunBoost - 1) * (1 - clock.nightness)));
  near(scene.fog.far, 330 * CROWN_LIGHT.fogFarScale);
  // evening on top: the clock's own sunset palette
  tick(18.5); near(atmosphere.duskWeight, 0);
  near(sky.stars.material.uniforms.uNight.value, clock.nightness); near(sky.dome.material.uniforms.uWarmth.value, clock.look.warmth);
  atmosphere.dispose();
});

test('walking onto the plateau and back restores the marsh look exactly (colours, intensities, fog, water, glow)', () => {
  const r = rig(), { sky, scene, atmosphere, clock, tick, put } = r;
  const grab = () => ({ top: sky.dome.material.uniforms.uTop.value.clone(), hor: sky.dome.material.uniforms.uHorizon.value.clone(), fog: scene.fog.color.clone(), bg: scene.background.clone(),
    hemi: sky.hemi.color.clone(), sun: sky.sun.color.clone(), si: sky.sun.intensity, hi: sky.hemi.intensity, fn: scene.fog.near, ff: scene.fog.far, shadow: sky.sun.shadow.intensity, glow: duskUniforms.uGlow.value });
  put(MARSH); tick(12, 1 / 60, 3); const before = grab(); setWaterLook(clock, atmosphere.waterWeight);
  const wShallow = waterUniforms.uShallowTint.value.clone(), wNight = waterUniforms.uNight.value;
  put(TOP); tick(12, 1 / 60, 3); assert.notDeepEqual(grab().sun, before.sun); assert.ok(duskUniforms.uGlow.value < 1e-9);
  setWaterLook(clock, atmosphere.waterWeight); near(waterUniforms.uNight.value, clock.nightness);          // the water follows the clock up top
  put(MARSH); tick(12, 1 / 60, 3);
  assert.deepEqual(grab(), before);
  setWaterLook(clock, atmosphere.waterWeight); assert.deepEqual(waterUniforms.uShallowTint.value, wShallow); assert.equal(waterUniforms.uNight.value, wNight);
  put(TOP); atmosphere.light(false); tick(12); near(sky.sun.intensity, clock.lightIntensity); near(scene.fog.far, 330);   // the comparison switch removes the crown grade too
  atmosphere.dispose();
});

test('the Duskcrown camera blends out by cw: the normal camera is used on the plateau, the dusk one stays in the marsh', () => {
  const r = rig(); const cam = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 1000), fc = new FollowCamera(cam); fc.regionCamera = DUSK_CAMERA;
  r.put(MARSH); r.tick(12); fc.regionBlend = r.atmosphere.duskWeight; near(fc.regionBlend, 1);
  assert.equal(fc.effectiveOffset().y, DUSK_CAMERA.offset.y);
  r.put(TOP); r.tick(12); fc.regionBlend = r.atmosphere.duskWeight; assert.equal(fc.regionBlend, 0);
  assert.equal(fc.effectiveOffset(), fc.offset); near(fc.effectiveOffset().y, CAMERA_OFFSET.y);
  r.put(MARSH); r.tick(12); Object.assign(r.focus, TOP); r.tick(12, 0.8);
  const mid = r.atmosphere.duskWeight; assert.ok(mid > 0.2 && mid < 0.8, `mid ${mid}`);
  r.atmosphere.dispose();
});

test('the cloud lid is per screen: drawn unless a LOCAL player is on the Crownlands (or ?crown); one local player up top is enough', () => {
  const r = rig(), { atmosphere, tick, locals } = r;
  tick(12); assert.equal(atmosphere.duskFx.mesh.visible, true); assert.equal(atmosphere.lidRule(), true);
  locals.push({ position: { ...TOP } });                                       // two local players: one in the marsh, one up top
  tick(12); assert.equal(atmosphere.duskFx.mesh.visible, false); assert.equal(atmosphere.summary().lid, false);
  locals.pop(); tick(12); assert.equal(atmosphere.duskFx.mesh.visible, true);
  locals.push({ position: { x: island.x - 60, y: 50, z: island.z + 120 } }); tick(12); assert.equal(atmosphere.duskFx.mesh.visible, true); locals.pop();   // high but on the cliff side
  assert.equal(atmosphere.lidForce(false), false); tick(12); assert.equal(atmosphere.duskFx.mesh.visible, false);   // debug override and release
  atmosphere.lidForce(null); tick(12); assert.equal(atmosphere.duskFx.mesh.visible, true);
  atmosphere.dispose();
  const f = rig({ flag: true }); f.tick(12); assert.equal(f.atmosphere.duskFx.mesh.visible, false); f.atmosphere.dispose();
});

test('summary reports cw, the lid and whether the camera is up top; the marsh glow contract is untouched', () => {
  const r = rig(); r.put(MARSH); r.tick(12, 1 / 60, 0);
  let s = r.atmosphere.summary(); assert.equal(s.cw, 0); assert.equal(s.upTop, false); assert.equal(s.lid, true);
  near(duskUniforms.uGlow.value, DUSK_LIGHT.glow); near(duskUniforms.uCrownNight.value, 0);
  r.put(TOP); r.tick(0); s = r.atmosphere.summary(); assert.equal(s.cw, 1); assert.equal(s.upTop, true); assert.equal(s.lid, false); near(duskUniforms.uCrownNight.value, r.clock.nightness);
  r.put(MARSH); r.tick(12); near(duskUniforms.uCrownNight.value, 0);
  r.atmosphere.dispose();
});
