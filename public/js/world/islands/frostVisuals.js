// Frostpine Isle VISUALS (Step 29a): the chunked prop layers, the frozen-lake sheet and the far canopy blobs. Built by islandVisuals.js
// (buildIslandVisuals) from the gameplay data of frostWorld.js and freely disposed / rebuilt (`__game.world.rebuild('frost')`): nothing with identity
// lives here. The instance <-> proxy swapping of choppable trees / boulders goes through frostRuntime.attach(layers).
//
//   const v = buildFrostVisuals(island, data)  -> { group, far, update(t), dispose(), summary(), layers }
//     group  chunked layers (spruce, spruceSnow, pine, pineSnow, birch, boulder, boulderSnow, spire, log, reed, edelweiss, gentian, tuft, and the
//            gathering plants lingonBush, lingonBerries, mint, chanterelle), the
//            proxy groups of the trees / boulders, the snowmen and the ice sheet
//     far    ONE merged blob mesh, one cone / blob per tree (the far version of the island)
//   iceUniforms: { uTime, uNight, uSunDir } feed the ice sheet shader; fx/atmosphere.js sets uNight / uSunDir from the day clock.
//
// Draw-call policy: trees and boulders use 40 u chunks (frustum culling skips most of the island); small sparse decor (flowers, tufts, logs, reeds,
// spires) uses 80 u chunks so a view costs a handful of calls. Everything shares ONE vertex-coloured toon material (flowers / tufts: the
// swaying clone), per-instance tints come from the instance colour.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ISLAND_MESH_MARGIN } from '../../config.js';
import { toonMat } from '../../render/toon.js';
import { part } from '../props.js';
import { buildChunkedLayer } from '../propChunks.js';
import { swayClone } from '../wind.js';
import { getAsset, FAR_BLOB } from './frostAssets.js';
import { FROST_FEATURES } from './frost.js';
import { getIslandModule } from './registry.js';
import { frostRuntime } from './frostWorld.js';
import { buildCampVisuals } from './frostCampVisuals.js';

export const iceUniforms = {
  uTime: { value: 0 },
  uNight: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() },
};

let _mat = null, _flowerMat = null, _tuftMat = null;
const mats = () => {
  if (!_mat) {
    _mat = toonMat('#ffffff', { vertexColors: true });
    _flowerMat = swayClone(_mat, { amp: 0.17, speed: 1.0 });
    _tuftMat = swayClone(_mat, { amp: 0.16, speed: 1.15, variation: true });
  }
  return { mat: _mat, flowerMat: _flowerMat, tuftMat: _tuftMat };
};

// ---------------------------------------------------------------------------------------------
// The frozen lake sheet: a glossy pale-blue ellipse a hair above the ice, with crack lines, snow drifts at the rim and a sun sheen / sparkles
// ---------------------------------------------------------------------------------------------
const ICE_VERT = /* glsl */`
varying vec2 vP;
varying vec3 vWorld;
void main() {
  vP = position.xz;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const ICE_FRAG = /* glsl */`
uniform float uTime;
uniform float uNight;
uniform vec3 uSunDir;
uniform vec2 uRadii;
varying vec2 vP;
varying vec3 vWorld;
vec2 h22(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}
float h21(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
}
// distance to the nearest cell border (voronoi): thin lines = cracks
float cracks(vec2 p) {
  vec2 n = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 o = h22(n + g);
    float d = length(g + o - f);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return d2 - d1;
}
void main() {
  float r = length(vP / uRadii);
  vec2 q = vP;
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 col = mix(vec3(0.55, 0.80, 0.95), vec3(0.74, 0.92, 1.0), vnoise(q * 0.35));
  // glossy: a view-angle sheen + the sun's reflection streak
  float fres = pow(1.0 - clamp(V.y, 0.0, 1.0), 2.5);
  col += vec3(0.45, 0.65, 0.85) * fres * 0.35;
  vec3 R = reflect(-uSunDir, vec3(0.0, 1.0, 0.0));
  col += vec3(1.0, 0.97, 0.9) * pow(max(dot(R, V), 0.0), 28.0) * 0.55 * (1.0 - uNight * 0.7);
  // cracks: a coarse net + a finer one, pale on bright ice and a bit darker blue underneath
  float c1 = 1.0 - smoothstep(0.0, 0.05, cracks(q * 0.22 + 3.0));
  float c2 = 1.0 - smoothstep(0.0, 0.035, cracks(q * 0.55 - 7.0));
  float crack = max(c1, c2 * 0.7) * smoothstep(0.1, 0.5, vnoise(q * 0.18));
  col = mix(col, vec3(0.30, 0.55, 0.82), crack * 0.7);
  col = mix(col, vec3(0.97, 1.0, 1.0), crack * 0.55 * step(0.5, h21(floor(q * 0.9))));
  // snow drifts at the rim
  float rim = smoothstep(0.72, 0.9, r) * smoothstep(0.5, 0.53, vnoise(q * 0.45 + 11.0) + 0.5 * (r - 0.75));
  col = mix(col, vec3(0.96, 0.98, 1.0), rim * 0.9);
  // sparkles (day)
  vec2 cell = floor(q * 2.2);
  float hh = h21(cell);
  float tw = pow(max(sin(uTime * (1.2 + hh * 2.5) + hh * 40.0), 0.0), 24.0) * step(0.86, hh);
  vec2 cf = fract(q * 2.2) - 0.5;
  col += vec3(1.0) * tw * (1.0 - smoothstep(0.0, 0.22, length(cf))) * (1.0 - uNight * 0.6);
  // night: dim and cool (the sheet is unlit, so it follows the clock by hand)
  col *= mix(vec3(1.0), vec3(0.38, 0.46, 0.72), uNight);
  float alpha = (0.7 + 0.2 * fres) * (1.0 - smoothstep(0.93, 1.0, r));
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function buildIceSheet(island) {
  const F = FROST_FEATURES.lake;
  const rx = F.rx * (10.7 / 11), rz = F.rz * (10.7 / 11);       // the painted ice spans lakeDist < 10.5 "11 u" units
  const geo = new THREE.CircleGeometry(1, 56);
  geo.rotateX(-Math.PI / 2);
  geo.scale(rx, 1, rz);                                         // the shader works in metres (vP), so bake the radii into the vertices
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...iceUniforms, uRadii: { value: new THREE.Vector2(rx, rz) } },
    vertexShader: ICE_VERT, fragmentShader: ICE_FRAG,
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const mod = getIslandModule(island.id);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'ice-sheet';
  mesh.position.set(island.x + F.x, mod.lakeH + 0.045, island.z + F.z);
  mesh.renderOrder = 2;
  mesh.castShadow = false; mesh.receiveShadow = false;
  return { mesh, geo, mat };
}

// ---------------------------------------------------------------------------------------------
// Far version: one blob per tree
// ---------------------------------------------------------------------------------------------
function buildFarBlobs(placement) {
  const parts = [];
  const cache = {};
  for (const t of placement.trees) {
    const b = FAR_BLOB[t.layer];
    const src = cache[t.layer] || (cache[t.layer] = b.make());
    parts.push(part(src, b.color, { p: [t.x, t.y + b.y * t.sy, t.z], s: [b.sx * t.sx, b.sy * t.sy, b.sx * t.sx] }));
  }
  for (const k in cache) cache[k].dispose();
  if (!parts.length) return null;
  const geo = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  const mesh = new THREE.Mesh(geo, toonMat('#ffffff', { vertexColors: true }));
  mesh.name = 'far-trees-frost';
  mesh.castShadow = false; mesh.receiveShadow = false;
  return { mesh, geo, count: parts.length };
}

// ---------------------------------------------------------------------------------------------
export function buildFrostVisuals(island, data) {
  const { placement } = data;
  const { mat, flowerMat, tuftMat } = mats();
  const group = new THREE.Group(); group.name = 'frost-props';
  const far = new THREE.Group(); far.name = 'frost-far';
  const origin = { x: island.x - island.radius - ISLAND_MESH_MARGIN, z: island.z - island.radius - ISLAND_MESH_MARGIN };
  const layers = {};
  const add = (key, items, opts = {}) => {
    if (!items.length) return;
    const a = getAsset(key);
    const layer = buildChunkedLayer({
      name: key, geometry: a.geo, outlineGeometry: opts.noOutline ? null : a.outlineGeo, outlineThickness: a.thickness || 0.05,
      material: opts.material || mat, items, origin, chunkSize: opts.chunk || 40, castShadow: opts.shadow !== false, receiveShadow: true,
    });
    layers[key] = layer;
    group.add(layer.group);
  };
  for (const key of ['spruce', 'spruceSnow', 'pine', 'pineSnow', 'birch']) add(key, placement.trees.filter((t) => t.layer === key));
  for (const key of ['boulder', 'boulderSnow']) add(key, placement.boulders.filter((b) => b.layer === key));
  add('spire', placement.spires.map((s) => ({ ...s, sx: s.s, sy: s.s, sz: s.s })), { chunk: 80 });
  add('log', placement.logs, { chunk: 80 });
  add('reed', placement.reeds, { chunk: 80, noOutline: true, shadow: false });
  for (const key of ['edelweiss', 'gentian']) add(key, placement.flowers.filter((f) => f.layer === key), { chunk: 80, noOutline: true, shadow: false, material: flowerMat });
  add('tuft', placement.tufts, { chunk: 60, noOutline: true, shadow: false, material: tuftMat });
  const g = data.gather;                                      // gathering plants (Step 29b): picked ones are hidden again through frostRuntime hooks
  add('lingonBush', g.bushes, { chunk: 80, shadow: false });   // (low shrubs: no shadow-pass draw call)
  add('lingonBerries', g.berries, { chunk: 80, noOutline: true, shadow: false });
  add('mint', g.herbs, { chunk: 80, noOutline: true, shadow: false, material: flowerMat });
  add('chanterelle', g.mushrooms, { chunk: 80, noOutline: true, shadow: false });

  // the animatable stand-ins and the snowmen live in the scene graph of the full island (they are only shown when something animates)
  for (const g of data.harvestables) group.add(g);
  for (const g of data.snowmen) group.add(g);

  const ice = buildIceSheet(island);
  group.add(ice.mesh);
  const camp = buildCampVisuals(island, data);                // Step 33b: signposts + the trail's lantern posts / glow
  group.add(camp.group);

  const blobs = buildFarBlobs(placement);
  if (blobs) far.add(blobs.mesh);

  frostRuntime.attach(layers);                                // hidden instances (a felled tree) stay hidden across a rebuild
  return {
    group, far, layers,
    update(t) { iceUniforms.uTime.value = t; camp.update(t); },
    dispose() {
      frostRuntime.detach();
      for (const l of Object.values(layers)) l.dispose();
      for (const g of data.harvestables) g.removeFromParent();   // (their geometry / materials are shared and cached: never disposed)
      for (const g of data.snowmen) g.removeFromParent();
      ice.mesh.removeFromParent(); ice.geo.dispose(); ice.mat.dispose();
      camp.dispose();
      if (blobs) { blobs.mesh.removeFromParent(); blobs.geo.dispose(); }
      group.removeFromParent(); far.removeFromParent();
    },
    summary() { return { layers: Object.values(layers).map((l) => l.summary()), farBlobs: blobs ? blobs.count : 0, camp: camp.summary() }; },
  };
}
