// Island atmosphere (Steps 29a / 30 / 69b): everything that changes with WHERE the view is, not with the time of day. One region weight `w` (0 = elsewhere,
// 1 = well inside Frostpine) is eased over about a second from the island gap of the view centre, so crossing the bridge fades things in / out
// instead of popping:
//   * snowfall: ONE Points draw call, 800 flakes wrapped inside a box round the view centre, positions computed in the vertex shader (no CPU per
//     frame work, no particle pool). Light on the beach tier, heavier on the foothills and heaviest on the alpine plateau (by ground height).
//   * a slightly cooler look: the day clock's sky / fog / hemisphere / sun colours are multiplied towards blue by `w` AFTER sky.setTimeOfDay each
//     tick (the clock's `look` is never touched), so dawn / dusk / night keep their own palettes and only gain a cool cast.
//   * the frozen-lake sheet's night dimming + sun direction (islands/frostVisuals.js iceUniforms), and a `calm` flag the ambient fireflies obey.
//
//   const atmosphere = createAtmosphere({ scene, camera, sky, clock, getHeight, view: () => ({ x, z }) });
//   atmosphere.update(dt, simTime, viewportHeightPx)   // once per tick, right after sky.setTimeOfDay
//   atmosphere.snap()                                  // teleports: jump the weight to its target at once
//   atmosphere.weight / duskWeight / summary()          // debug
//   atmosphere.light(on) / duskFx.lid(on)                // Duskcrown comparison / plateau inspection
// Step 85b: the crown weight `cw` (eased like `w`) cuts the dusk mix to 0.92 * dw * (1 - cw) and blends CROWN_LIGHT in: up on the Crownlands the day / night clock shows. atmosphere.duskWeight is dw * (1 - cw).
// Duskcrown uses a rectangular region gap, 92% fixed canopy light, an opaque full/far lid and day-independent spores / glow.
// Called AFTER sky.setTimeOfDay: the saved clock and all other islands keep their own looks.
import * as THREE from 'three';
import { ISLANDS, DUSK_LIGHT, CROWN_LIGHT } from '../config.js';
import { EMBER_FEATURES } from '../world/islands/ember.js';
import { emberUniforms } from '../world/islands/emberVisuals.js';
import { iceUniforms } from '../world/islands/frostVisuals.js';
import { trailUniforms } from '../world/islands/frostCampVisuals.js';

import { islandGap } from '../world/islands/extent.js';
import { createDuskAtmosphere, duskUniforms } from '../world/islands/duskAtmosphere.js';
import { getIslandModule } from '../world/islands/registry.js';

const N_FLAKES = 800;
const BOX = { x: 46, y: 22, z: 38 };
const EASE = 0.8;                       // s: time constant of the region weight
const FADE_IN = -6, FADE_OUT = 44;      // island gap (u, negative = inside the coast) over which the weight goes 1 -> 0
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

const VERT = /* glsl */`
attribute vec4 aSeed;
uniform float uTime;
uniform float uScale;
uniform float uIntensity;
uniform vec3 uCenter;
uniform vec3 uBox;
varying float vA;
void main() {
  vec3 s = aSeed.xyz;
  float k = aSeed.w;
  vec3 hb = uBox * 0.5;
  vec3 o = uCenter - hb;
  float x = s.x * uBox.x + uTime * 0.55 + sin(uTime * 0.7 + s.z * 30.0) * 0.9;
  float z = s.z * uBox.z + sin(uTime * 0.5 + s.x * 20.0) * 0.6;
  float y = s.y * uBox.y - uTime * (1.2 + 1.1 * k);
  vec3 p = vec3(o.x + mod(x - o.x, uBox.x), o.y + mod(y - o.y, uBox.y), o.z + mod(z - o.z, uBox.z));
  vec3 q = abs((p - uCenter) / hb);
  float edge = 1.0 - smoothstep(0.72, 1.0, max(max(q.x, q.y), q.z));
  float vis = step(fract(k * 13.7 + s.x * 5.1), uIntensity);
  vA = vis * edge;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float size = 0.13 + 0.17 * fract(k * 7.3);
  gl_PointSize = clamp(size * uScale / max(0.1, -mv.z), 2.2, 24.0);
}`;
const FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uOpacity;
varying float vA;
void main() {
  float d = length(gl_PointCoord * 2.0 - 1.0);
  float a = (1.0 - smoothstep(0.35, 1.0, d)) * vA * uOpacity;
  if (a < 0.02) discard;
  gl_FragColor = vec4(uColor, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// Step 85b: `focus` (optional, () => {x, y, z}) is the camera target (players.focus): the crown weight reads it, since the view centre is a ground-plane hit at y = 0 and lies far
// ahead of the camera up on the plateau. `locals` (optional, () => [{ position }]) are THIS screen's players: the cloud lid is drawn unless one of them is on the Crownlands (or `crownFlag`).
export function createAtmosphere({ scene, camera, sky, clock, getHeight, view, focus = null, locals = null, crownFlag = false }) {
  const frost = ISLANDS.find((i) => i.biome === 'alpine');
  const ember = ISLANDS.find((i) => i.biome === 'volcanic');
  const dusk = ISLANDS.find((i) => i.id === 'duskcrown');
  const duskFx = createDuskAtmosphere({ scene, island: dusk });
  const duskColors = Object.fromEntries(['top', 'horizon', 'fog', 'hemiSky', 'hemiGround', 'light'].map((k) => [k, new THREE.Color(DUSK_LIGHT[k])]));
  const duskDir = new THREE.Vector3(...DUSK_LIGHT.direction).normalize().multiplyScalar(Math.hypot(48, 70, 34));
  const baseFog = { near: scene.fog.near, far: scene.fog.far };
  const baseShadow = { intensity: sky.sun.shadow.intensity, radius: sky.sun.shadow.radius };
  const duskMod = dusk ? getIslandModule('duskcrown') : null, crown = duskMod && duskMod.crown;
  const crownColors = { sun: new THREE.Color(CROWN_LIGHT.sun), horizon: new THREE.Color(CROWN_LIGHT.horizon), fog: new THREE.Color(CROWN_LIGHT.fogTint) };
  let dw = 0, cw = 0, duskLight = true, lidForce = null, lidOn = true, upTop = false;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N_FLAKES * 3), 3));   // (unused: the shader places every flake)
  const seed = new Float32Array(N_FLAKES * 4);
  let a = 12345;                                                       // tiny LCG: the same flakes every run
  const r = () => { a = (Math.imul(a, 1664525) + 1013904223) >>> 0; return a / 4294967296; };
  for (let i = 0; i < N_FLAKES * 4; i++) seed[i] = r();
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uScale: { value: 600 }, uIntensity: { value: 0 }, uCenter: { value: new THREE.Vector3() },
      uBox: { value: new THREE.Vector3(BOX.x, BOX.y, BOX.z) }, uColor: { value: new THREE.Color('#ffffff') }, uOpacity: { value: 0.92 },
    },
    vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
  });
  const points = new THREE.Points(geo, mat);
  points.name = 'snowfall';
  points.frustumCulled = false;
  points.renderOrder = 6;
  points.visible = false;
  scene.add(points);

  const moteMat = mat.clone();
  moteMat.uniforms.uColor.value.set('#ffe4a2');
  moteMat.uniforms.uOpacity.value = 0.4;
  const motes = new THREE.Points(geo, moteMat);
  motes.name = 'ember-pollen'; motes.frustumCulled = false; motes.visible = false; scene.add(motes);

  let ew = 0;
  let w = 0, groundY = 0, started = false, groundInit = false;
  const day = new THREE.Color('#ffffff'), night = new THREE.Color('#c5d4ff');

  function targetWeight(v, island = frost) {
    if (!island) return 0;
    const gap = islandGap(island, v.x, v.z);
    return 1 - sstep(FADE_IN, FADE_OUT, gap);
  }

  /** Crown weight target (Step 85b): 1 when the camera focus stands on the plateau top, 0 elsewhere (the marsh, every other island). */
  function crownTarget() {
    if (!crown) return 0;
    const f = focus && focus(), v = f || view();
    return crown.topWeight(v.x - dusk.x, v.z - dusk.z, f && f.y !== undefined ? f.y : getHeight(v.x, v.z));
  }
  /** The cloud lid is drawn unless a local player of this screen is on the Crownlands (or ?crown): each screen decides alone, nothing is synced. */
  function lidWanted() {
    if (lidForce !== null) return lidForce;
    if (crownFlag) return false;
    if (crown && locals) for (const p of locals()) { const q = p.position; if (crown.topWeight(q.x - dusk.x, q.z - dusk.z, q.y) > 0.5) return false; }
    return true;
  }

  /** Multiply a colour a little towards blue: less red, a hair less green, a touch more blue (never above 1 unless it already was). */
  function cool(c, k) {
    if (!c) return;
    c.r *= 1 - 0.075 * k;
    c.g *= 1 - 0.012 * k;
    c.b = Math.max(c.b, Math.min(1, c.b * (1 + 0.055 * k)));
  }

  function update(dt, t, viewportHeightPx) {
    const v = view();
    const target = targetWeight(v), emberTarget = targetWeight(v, ember);
    const duskTarget = targetWeight(v, dusk);
    dw = !started ? duskTarget : dw + (duskTarget - dw) * (1 - Math.exp(-dt / EASE));
    if (Math.abs(duskTarget - dw) < 0.002) dw = duskTarget;
    const cwTarget = crownTarget();
    cw = !started ? cwTarget : cw + (cwTarget - cw) * (1 - Math.exp(-dt / EASE));
    if (Math.abs(cwTarget - cw) < 0.002) cw = cwTarget;
    upTop = cwTarget > 0.5;
    const eff = duskLight ? dw * (1 - cw) : 0;                  // the marsh weight: the dusk mix is cut by (1 - cw), up top the ordinary clock shows
    const kc = duskLight ? cw : 0;                              // the Crownlands' grade
    duskFx.lid(lidOn = lidWanted());
    ew = !started ? emberTarget : ew + (emberTarget - ew) * (1 - Math.exp(-dt / EASE));
    emberUniforms.uNight.value = clock.nightness;
    // Nearby clouds catch a faint lava glow from below, even while viewed from home.
    if (ember && sky.clouds) for (const cloud of sky.clouds.children) {
      const d = Math.hypot(cloud.position.x - ember.x - EMBER_FEATURES.volcano.x, cloud.position.z - ember.z - EMBER_FEATURES.volcano.z);
      const k = Math.exp(-d * d / 4500) * clock.nightness * 0.14;
      const c = cloud.children[0]?.material?.emissive;
      if (c) { c.r += k; c.g += k * 0.25; c.b += k * 0.05; }
    }
    if (!started) { w = target; started = true; }
    else w += (target - w) * (1 - Math.exp(-dt / EASE));
    if (Math.abs(target - w) < 0.002) w = target;

    // frozen lake sheet follows the clock even while nobody is on Frostpine (cheap: two uniforms)
    iceUniforms.uNight.value = clock.nightness;
    trailUniforms.uNight.value = clock.nightness;          // the trail's lantern glow (Step 33b)
    iceUniforms.uSunDir.value.copy(clock.direction);

    // cooler look, on top of what sky.setTimeOfDay just wrote
    if (w > 0.002) {
      const u = sky.dome.material.uniforms;
      cool(u.uTop.value, w); cool(u.uHorizon.value, w);
      cool(scene.background, w); cool(scene.fog && scene.fog.color, w);
      cool(sky.hemi.color, w); cool(sky.hemi.groundColor, w);
      sky.sun.color.r *= 1 - 0.05 * w; sky.sun.color.b = Math.max(sky.sun.color.b, Math.min(1, sky.sun.color.b * (1 + 0.04 * w)));
    }

    // Humid warmth multiplies the clock's fresh palette, preserving dawn / dusk / night.
    if (ew > 0.002) {
      const warm = (c) => { if (c) { c.g *= 1 - 0.025 * ew; c.b *= 1 - 0.10 * ew; } };
      const u = sky.dome.material.uniforms;
      for (const c of [u.uTop.value, u.uHorizon.value, scene.background, scene.fog?.color, sky.hemi.color, sky.hemi.groundColor, sky.sun.color]) warm(c);
    }
    motes.visible = ew > 0.01;
    if (motes.visible) {
      const u = moteMat.uniforms;
      u.uTime.value = -t * 0.16; u.uIntensity.value = ew * 0.13;
      u.uCenter.value.set(v.x, Math.max(0, getHeight(v.x, v.z)) + 5, v.z);
      if (camera && viewportHeightPx) u.uScale.value = viewportHeightPx / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    }

    // Reset numeric properties every tick too: walking out must restore the ordinary sky.
    const k = DUSK_LIGHT.mix * eff;
    const uSky = sky.dome.material.uniforms;
    if (kc > 0) {                                               // Step 85b: CROWN_LIGHT on top of the fresh clock palette (tints scale with daylight; dawn / dusk / night keep their own)
      const day = 1 - clock.nightness, tint = kc * day;
      uSky.uHorizon.value.lerp(crownColors.horizon, CROWN_LIGHT.horizonMix * tint);
      for (const c of [scene.background, scene.fog?.color]) if (c) c.lerp(crownColors.fog, CROWN_LIGHT.fogMix * tint);
      sky.sun.color.lerp(crownColors.sun, CROWN_LIGHT.sunMix * tint);
      sky.sun.intensity *= 1 + (CROWN_LIGHT.sunBoost - 1) * tint;
      sky.hemi.intensity *= 1 + (CROWN_LIGHT.hemiBoost - 1) * tint;
    }
    for (const [c, key] of [[uSky.uTop.value, 'top'], [uSky.uHorizon.value, 'horizon'],
      [scene.background, 'fog'], [scene.fog?.color, 'fog'], [sky.hemi.color, 'hemiSky'],
      [sky.hemi.groundColor, 'hemiGround'], [sky.sun.color, 'light']]) if (c) c.lerp(duskColors[key], k);
    sky.hemi.intensity = THREE.MathUtils.lerp(sky.hemi.intensity, DUSK_LIGHT.hemiIntensity, k);
    sky.sun.intensity = THREE.MathUtils.lerp(sky.sun.intensity, DUSK_LIGHT.lightIntensity, k);
    sky.sun.shadow.intensity = THREE.MathUtils.lerp(baseShadow.intensity, DUSK_LIGHT.shadowIntensity, k);
    sky.sun.shadow.radius = THREE.MathUtils.lerp(baseShadow.radius, DUSK_LIGHT.shadowRadius, k);
    if (scene.fog) {
      scene.fog.near = THREE.MathUtils.lerp(baseFog.near * (1 + (CROWN_LIGHT.fogNearScale - 1) * kc), DUSK_LIGHT.fogNear, k);
      scene.fog.far = THREE.MathUtils.lerp(baseFog.far * (1 + (CROWN_LIGHT.fogFarScale - 1) * kc), DUSK_LIGHT.fogFar, k);
    }
    // The canopy completely hides celestial discs/stars at full weight, rather than leaving an 8% star leak.
    const canopy = eff;
    uSky.uSunVisible.value *= 1 - canopy; uSky.uMoonVisible.value *= 1 - canopy;
    uSky.uWarmth.value *= 1 - canopy;
    sky.stars.material.uniforms.uNight.value *= 1 - canopy;
    if (k > 0) sky.sun.position.sub(sky.sun.target.position).lerp(duskDir, k).add(sky.sun.target.position);
    duskUniforms.uGlow.value = (DUSK_LIGHT.glow + DUSK_LIGHT.breathe * Math.sin(t * DUSK_LIGHT.breatheRate)) * (1 - cw);
    duskUniforms.uCrownNight.value = cw * clock.nightness;     // the Crownlands' own night glow (Step 85d speckles): 0 in the marsh and by day
    duskFx.update(t, eff, v, getHeight, camera, viewportHeightPx, scene.fog?.color);

    // snowfall
    const gy = Math.max(getHeight(v.x, v.z), 0);
    groundY += (gy - groundY) * (1 - Math.exp(-dt / 0.6));
    if (!groundInit || dt === 0) { groundY = gy; groundInit = true; }
    const intensity = w * (0.5 + 0.5 * sstep(0.4, 7.8, groundY));      // beach -> meadow -> plateau
    points.visible = intensity > 0.01;
    if (points.visible) {
      const u = mat.uniforms;
      u.uTime.value = t;
      u.uIntensity.value = intensity;
      u.uCenter.value.set(v.x, groundY + 9, v.z);
      if (camera && viewportHeightPx) u.uScale.value = viewportHeightPx / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
      u.uColor.value.copy(day).lerp(night, clock.nightness);
      u.uOpacity.value = 0.92 - 0.12 * clock.nightness;
    }
  }

  return {
    update,
    snap() { const v = view(); w = targetWeight(v); ew = targetWeight(v, ember); dw = targetWeight(v, dusk); cw = crownTarget(); started = true; groundY = Math.max(getHeight(v.x, v.z), 0); groundInit = true; },
    duskFx,
    light(on = true) { duskLight = !!on; return duskLight; },
    /** The marsh look weight (0 up on the Crownlands and anywhere off the island): drives the dusk camera, the water tint, the ambient fireflies and the pets' mood. */
    get duskWeight() { return dw * (1 - cw); },
    get regionWeight() { return dw; },                      // the plain rectangular island weight (cw not applied)
    get crownWeight() { return cw; },
    get upTop() { return upTop; },
    get waterWeight() { return duskLight ? dw * (1 - cw) : 0; },
    /** Debug: force the cloud lid (true = drawn, false = hidden); null returns to the per-screen rule. */
    lidForce(on = null) { lidForce = on === null ? null : !!on; duskFx.lid(lidOn = lidWanted()); return lidOn; },
    lidRule: () => lidWanted(),
    get weight() { return w; },
    /** True while the view is well inside Frostpine (ambient fireflies stay out). */
    get calm() { return w > 0.5; },
    points,
    summary: () => ({ weight: +w.toFixed(3), emberWeight: +ew.toFixed(3), duskWeight: +(dw * (1 - cw)).toFixed(3), regionWeight: +dw.toFixed(3), cw: +cw.toFixed(3), upTop, lid: lidOn, duskLight, flakes: Math.round(N_FLAKES * Math.min(1, w * (0.5 + 0.5 * sstep(0.4, 7.8, groundY)))), groundY: +groundY.toFixed(2), visible: points.visible }),
    dispose() { duskFx.dispose(); points.removeFromParent(); motes.removeFromParent(); geo.dispose(); mat.dispose(); moteMat.dispose(); },
  };
}
