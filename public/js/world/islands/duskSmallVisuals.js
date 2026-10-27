// Rebuildable 69d ambient layers, full detail only. buildDuskSmallVisuals(island, plan) -> { group, summary(), dispose() }.
// Cached assets/materials survive rebuilds; owned instance buffers and merged falls/mist/reflections are disposed.
// Small flora reuses BOTH 69c programs; falls and foot mist share one new shader, driven by water time and dusk glow.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DUSK_SMALL, DUSK_WATER, WATER_LEVEL } from '../../config.js';
import { groupIntoChunks } from '../propChunks.js';
import { duskCrumbRuntime, planDuskCrumbs } from './duskCrumbs.js';
import { buildRibbonGeometry, waterUniforms } from '../water.js';
import { duskUniforms } from './duskAtmosphere.js';
import { materials } from './duskVisuals.js';
import { getSmallAsset } from './duskSmallAssets.js';
import { getIslandModule } from './registry.js';
import { rimPrefix } from './crownWater.js';

let fallMat;
export function duskFallMaterial() {
  if (!fallMat) fallMat = new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsLib.fog, uTime: waterUniforms.uTime, uGlow: duskUniforms.uGlow,
      uColor: { value: new THREE.Color(DUSK_WATER.glint) }, uMist: { value: new THREE.Color(DUSK_WATER.mist) } },
    vertexShader: `#include <common>
      #include <fog_pars_vertex>
      attribute float aFall; varying vec2 vUv; varying float vMist;
      void main() { vUv = uv; vMist = aFall; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
      }`,
    fragmentShader: `#include <common>
      #include <fog_pars_fragment>
      uniform float uTime; uniform float uGlow; uniform vec3 uColor; uniform vec3 uMist; varying vec2 vUv; varying float vMist;
      void main() {
        float edge = 1.0 - smoothstep(0.45, 1.0, abs(vUv.x * 2.0 - 1.0));
        float streak = pow(0.5 + 0.5 * sin(vUv.y * 1.9 - uTime * 3.0 + vUv.x * 13.0), 5.0);
        float radial = max(0.0, 1.0 - length(vUv * 2.0 - 1.0));
        float mist = radial * radial * (0.32 + 0.07 * sin(uTime * 0.6 + vUv.x * 4.0));
        gl_FragColor = vec4(mix(uColor * (0.75 + 0.35 * streak), uMist, vMist) * uGlow, mix(edge * (0.35 + 0.28 * streak), mist, vMist));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
  });
  return fallMat;
}

function instanceGeometry(base, inst) {
  const geo = new THREE.BufferGeometry();
  for (const [k, a] of Object.entries(base.attributes)) geo.setAttribute(k, a);
  if (base.index) geo.setIndex(base.index);
  geo.setAttribute('iInst', inst); return geo;
}
// An upward fan with the 69c radial pool UVs. Used for faint orange reflections on the STILL water.
function reflections(lilies) {
  const positions = [], colors = [], uv = [], idx = [], c = new THREE.Color(DUSK_SMALL.colors.orange);
  for (const it of lilies) {
    const start = positions.length / 3, r = DUSK_WATER.reflectionRadius * it.s;
    positions.push(it.x, WATER_LEVEL + 0.028, it.z); uv.push(0, 0); colors.push(c.r, c.g, c.b);
    for (let k = 0; k <= 12; k++) { const a = k * Math.PI / 6, x = Math.cos(a), z = Math.sin(a); positions.push(it.x + x * r, WATER_LEVEL + 0.028, it.z + z * r); uv.push(x, z); colors.push(c.r, c.g, c.b); if (k > 0) idx.push(start, start + k + 1, start + k); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('aRole', new THREE.Float32BufferAttribute(new Float32Array(positions.length / 3).fill(6), 1));
  geo.setAttribute('iInst', new THREE.InstancedBufferAttribute(new Float32Array(2), 2)); geo.setIndex(idx); geo.computeVertexNormals();
  return geo;
}

export function buildDuskSmallVisuals(island, plan) {
  const group = new THREE.Group(); group.name = 'dusk-small-flora';
  const { solidMat, outlineMat, poolMat } = materials(), origin = { x: island.x - 200, z: island.z - 140 };
  const meshes = [], geos = [], layers = {}, slots = new Map();         // slots: flora item -> { mesh, i } (Step 72b: a picked glowcap clump is hidden / regrown by scaling its instance)
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), scale = new THREE.Vector3();
  // Step 72b playtest fix: the pickable glowcap clumps get their own golden 'crumb' layer (same flora items, so picking / regrowing still finds their instance slot); everything else is unchanged
  let crumbSet = null;
  try { crumbSet = new Set(planDuskCrumbs(island).clumps); } catch { crumbSet = null; }
  const layerList = Object.entries(plan.layers).flatMap(([kind, items]) => (kind === 'mushroom' && crumbSet && crumbSet.size
    ? [[kind, items.filter((it) => !crumbSet.has(it))], ['crumb', items.filter((it) => crumbSet.has(it))]] : [[kind, items]]));
  for (const [kind, items] of layerList) {
    const a = getSmallAsset(kind); layers[kind] = { instances: items.length, chunks: 0, drawCalls: 0, triangles: 0 };
    for (const [key, list] of groupIntoChunks(items, origin, kind === 'crumb' ? 4096 : DUSK_SMALL.chunk)) {     // (the 16 crumb clumps all sit near the hearth: one chunk)
      const inst = new THREE.InstancedBufferAttribute(new Float32Array(list.length * 2), 2);
      for (let i = 0; i < list.length; i++) inst.setXY(i, 0, 0.5);
      const geo = instanceGeometry(a.geo, inst), mesh = new THREE.InstancedMesh(geo, solidMat, list.length);
      list.forEach((it, i) => { q.setFromAxisAngle(up, it.rot); mesh.setMatrixAt(i, m.compose(p.set(it.x, it.y, it.z), q, scale.setScalar(it.s))); slots.set(it, { mesh, i }); });
      mesh.instanceMatrix.needsUpdate = true; mesh.name = `dusk-small-${kind}-${key}`; mesh.castShadow = false; mesh.receiveShadow = true; mesh.computeBoundingSphere();
      group.add(mesh); meshes.push(mesh); geos.push(geo);
      layers[kind].chunks++; layers[kind].drawCalls++; layers[kind].triangles += (geo.index ? geo.index.count : geo.attributes.position.count) / 3 * list.length;
      if (a.outlineGeo) {
        const hullGeo = instanceGeometry(a.outlineGeo, inst), hull = new THREE.InstancedMesh(hullGeo, outlineMat, list.length);
        hull.name = `${mesh.name}-outline`; hull.instanceMatrix = mesh.instanceMatrix; hull.renderOrder = -1; hull.computeBoundingSphere(); group.add(hull); meshes.push(hull); geos.push(hullGeo);
        layers[kind].drawCalls++; layers[kind].triangles += hullGeo.index.count / 3 * list.length;
      }
    }
  }
  const reflectionGeo = reflections(plan.layers.lily), reflectionMat = poolMat.clone();
  // Same shader and parameters as the 69c pools; only the shared-program opacity uniform differs.
  reflectionMat.onBeforeCompile = (shader) => { poolMat.onBeforeCompile(shader); shader.uniforms.uPool.value = DUSK_WATER.reflectionOpacity; };
  reflectionMat.customProgramCacheKey = poolMat.customProgramCacheKey;
  const reflection = new THREE.InstancedMesh(reflectionGeo, reflectionMat, 1); reflection.setMatrixAt(0, m.identity()); reflection.name = 'dusk-lily-reflections'; reflection.renderOrder = 3;
  group.add(reflection); meshes.push(reflection); geos.push(reflectionGeo);
  const ribbons = [];
  const crownMod = getIslandModule(island.id);
  for (const fall of plan.falls) {
    // Step 85c: the plateau river above this fall extends the SAME mesh upward to the river's lip (its width tapers into the fall's); the marsh fall's own points are untouched
    const rim = crownMod?.crown ? rimPrefix(island, crownMod, fall.id) : null, path = rim ? [...rim.prefix, ...fall.path] : fall.path, lead = rim ? rim.prefix.length : 0;
    const geo = buildRibbonGeometry(path, rim ? (i) => (i < lead ? rim.hw[i] : DUSK_WATER.fallWidth) : DUSK_WATER.fallWidth, { fall: () => 0 });
    // The helper's distance is horizontal; falling ribbons need vertical distance for moving glints.
    const uv = geo.attributes.uv; let distance = 0;
    path.forEach((pt, i) => { if (i) { const prev = path[i - 1]; distance += Math.hypot(pt.x - prev.x, pt.y - prev.y, pt.z - prev.z); } uv.setY(i * 2, distance); uv.setY(i * 2 + 1, distance); });
    ribbons.push(geo);
    for (const [radius, height] of [[2.6, 0.18], [1.7, 0.55], [1.0, 0.9]]) {
      const mist = new THREE.PlaneGeometry(radius * 2, radius * 2); mist.rotateX(-Math.PI / 2); mist.translate(fall.foot.x, fall.foot.y + height, fall.foot.z);
      mist.setAttribute('aFall', new THREE.Float32BufferAttribute(new Float32Array(4).fill(1), 1)); ribbons.push(mist);
    }
  }
  const fallsGeo = mergeGeometries(ribbons.map((g) => { g.deleteAttribute('normal'); return g; }), false); for (const g of ribbons) g.dispose();
  const falls = new THREE.Mesh(fallsGeo, duskFallMaterial()); falls.name = 'dusk-falls-and-mist'; group.add(falls); geos.push(fallsGeo);
  const setItem = (it, on, k = 1) => {                  // hide (on = false) or scale (0..1) one instance; the outline hull shares the instance matrix
    const sl = slots.get(it);
    if (!sl) return;
    q.setFromAxisAngle(up, it.rot);
    sl.mesh.setMatrixAt(sl.i, m.compose(p.set(it.x, it.y, it.z), q, scale.setScalar(on ? Math.max(0.0001, it.s * k) : 0.0001)));
    sl.mesh.instanceMatrix.needsUpdate = true;
  };
  const api = { group, setItem, summary: () => ({ layers, meshes: meshes.length + 1, drawCalls: meshes.length + 1,
    triangles: Object.values(layers).reduce((n, l) => n + l.triangles, 0) + reflectionGeo.index.count / 3 + fallsGeo.index.count / 3 }),
    dispose() { duskCrumbRuntime.detach(api); for (const mesh of meshes) mesh.dispose(); for (const geo of geos) geo.dispose(); reflectionMat.dispose(); group.removeFromParent(); } };
  duskCrumbRuntime.attach(api);                           // (gathering re-hides whichever clumps are picked right now)
  return api;
}
