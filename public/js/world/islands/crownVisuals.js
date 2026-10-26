// The Crownlands' water, falls and floating islands as meshes (Step 85c). Rebuildable visuals only: no colliders, no registrations (nothing here is gameplay).
//
//   const v = buildCrownVisuals(island, mod) -> { group, fixed, far, farFixed, setLayers(on), summary(), dispose() }
//     group    the plateau's secret layers: chunked elevated water (pool discs + river / stream / spill ribbons, ONE shared program), the sky falls (floating-island spill -> plunge pool) and the
//              floating islands + rocks (one merged body mesh + one merged outline hull) + their own summit water         -> NOT drawn while the cloud lid is drawn (crownLayers.js)
//     fixed    the sea-cliff falls with their foot mist: part of the cliff, always drawn (the boat and the coast see them)
//     far      the same secret layers for the far view (simplified islands, the sky falls)       farFixed   the sea-cliff falls again (a second mesh on the same geometry)
//   The RIM falls are not built here: they extend the existing marsh fall mesh upward inside duskSmallVisuals (crownWater.rimPrefix), so the marsh gains no draw call.
//
// Programs: ONE new water program (crownWaterMaterial: discs and ribbons, the 69d still look made brighter and clearer: #4fd8e8 shallow, #2a8fd0 deep) and ONE new fall program (crownFallMaterial:
// thin bright streaks that fade into foot mist). The islands share the vertex toon program and the shared outline program. Nothing casts or receives a shadow, no lights.
import * as THREE from 'three';
import { CROWN_WATER } from '../../config.js';
import { waterUniforms } from '../water.js';
import { VERTEX_TOON, makeOutline } from '../../render/geo.js';
import { buildCrownWater } from './crownWater.js';
import { buildSkyMeshes } from './crownSky.js';
import { crownLayers } from './crownLayers.js';

// ---- materials -----------------------------------------------------------------------------------------------------------------------------------------------------------------
let waterMat = null, fallMat = null;
export function crownWaterMaterial() {
  if (!waterMat) waterMat = new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uTime: waterUniforms.uTime, uFoam: waterUniforms.uFoam, uShallowTint: waterUniforms.uShallowTint, uDeepTint: waterUniforms.uDeepTint, uFoamTint: waterUniforms.uFoamTint, uNight: waterUniforms.uNight,
      uShallow: { value: new THREE.Color(CROWN_WATER.shallow) }, uDeep: { value: new THREE.Color(CROWN_WATER.deep) }, uGlint: { value: new THREE.Color(CROWN_WATER.glint) },
    },
    vertexShader: `#include <common>
      #include <fog_pars_vertex>
      attribute float aShape; attribute float aFoam; varying vec2 vUv; varying vec2 vXZ; varying float vShape; varying float vFoam;
      void main() { vUv = uv; vXZ = position.xz; vShape = aShape; vFoam = aFoam; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
      }`,
    fragmentShader: `#include <common>
      #include <fog_pars_fragment>
      uniform float uTime; uniform vec3 uShallow; uniform vec3 uDeep; uniform vec3 uGlint; uniform vec3 uFoam; uniform vec3 uShallowTint; uniform vec3 uDeepTint; uniform vec3 uFoamTint; uniform float uNight;
      varying vec2 vUv; varying vec2 vXZ; varying float vShape; varying float vFoam;
      void main() {
        float disc = vShape;                                                    // 1 = a pool disc (uv = the unit disc), 0 = a ribbon (uv.x across, 0.5 = the centre line)
        float e = mix(abs(vUv.x - 0.5) * 2.0, length(vUv), disc);
        float deepT = mix(0.22 * (1.0 - e) + 0.05, (1.0 - smoothstep(0.1, 0.95, e)) * 0.95, disc);
        vec3 foam = uFoam * uFoamTint;
        vec3 col = mix(uShallow * uShallowTint, uDeep * uDeepTint, deepT);
        float r1 = sin(vXZ.x * 0.9 + vXZ.y * 0.55 + uTime * 0.9 + 1.8 * sin(vXZ.y * 0.33 + uTime * 0.27));
        float r2 = sin(vXZ.x * -0.6 + vXZ.y * 1.05 - uTime * 0.7 + 1.5 * sin(vXZ.x * 0.29 - uTime * 0.21));
        float ripple = smoothstep(0.82, 0.97, r1) * 0.6 + smoothstep(0.86, 0.98, r2) * 0.4;
        float glint = pow(max(0.0, sin(vXZ.x * 1.3 + vXZ.y * 0.7 + uTime * 0.6) * sin(vXZ.x * 0.8 - vXZ.y * 1.1 - uTime * 0.45)), 10.0);
        col += uGlint * (ripple * 0.10 + glint * 0.20) * (1.0 - uNight * 0.6);
        float flow = step(0.84, sin(vUv.y * 1.6 - uTime * 2.4 + sin(vUv.x * 6.2832 + vUv.y * 0.7) * 1.3));
        col = mix(col, foam, (1.0 - disc) * flow * 0.35 * (1.0 - e * 0.5));          // drifting streaks on a ribbon
        col = mix(col, foam, smoothstep(0.86, 0.98, e) * 0.5);                      // a thin foam line along the bank / the disc rim
        float churn = step(0.5, 0.5 + 0.5 * sin(vUv.y * 5.3 - uTime * 6.0 + vUv.x * 9.0));
        col = mix(col, foam, vFoam * (0.5 + 0.45 * churn));                         // the white riffle ribbon where the water steps down
        gl_FragColor = vec4(col, max(0.94, vFoam));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    transparent: true, side: THREE.DoubleSide, fog: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  return waterMat;
}

export function crownFallMaterial() {
  if (!fallMat) fallMat = new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uTime: waterUniforms.uTime, uFoam: waterUniforms.uFoam, uFoamTint: waterUniforms.uFoamTint, uNight: waterUniforms.uNight,
      uColor: { value: new THREE.Color(CROWN_WATER.fall.color) }, uMist: { value: new THREE.Color(CROWN_WATER.fall.mist) },
    },
    vertexShader: `#include <common>
      #include <fog_pars_vertex>
      attribute float aFall; attribute float aTail; varying vec2 vUv; varying float vMist; varying float vTail;
      void main() { vUv = uv; vMist = aFall; vTail = aTail; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
      }`,
    fragmentShader: `#include <common>
      #include <fog_pars_fragment>
      uniform float uTime; uniform vec3 uFoam; uniform vec3 uFoamTint; uniform float uNight; uniform vec3 uColor; uniform vec3 uMist;
      varying vec2 vUv; varying float vMist; varying float vTail;
      void main() {
        float edge = 1.0 - smoothstep(0.3, 1.0, abs(vUv.x * 2.0 - 1.0));
        float streak = pow(0.5 + 0.5 * sin(vUv.y * 0.55 - uTime * 1.1 + vUv.x * 21.0 + sin(vUv.y * 0.13) * 2.0), 3.0);      // slow, long, down-scrolling streaks
        float fine = pow(0.5 + 0.5 * sin(vUv.y * 1.7 - uTime * 2.3 - vUv.x * 9.0), 6.0);
        vec3 tint = uFoam * uFoamTint * (1.0 - 0.35 * uNight);
        vec3 body = uColor * tint * (0.92 + 0.22 * streak + 0.18 * fine);
        float aBody = edge * (0.62 + 0.3 * streak) * (1.0 - 0.8 * vTail);                              // thin and bright, softer towards the foot
        float radial = max(0.0, 1.0 - length(vUv * 2.0 - 1.0));
        float mist = radial * radial * (0.46 + 0.08 * sin(uTime * 0.6 + vUv.x * 4.0));
        gl_FragColor = vec4(mix(body, uMist * tint, vMist), mix(aBody, mist, vMist));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
  });
  return fallMat;
}

// ---- geometry builders ---------------------------------------------------------------------------------------------------------------------------------------------------------
/** Pool discs + ribbons into plain arrays (aShape 1 / 0, aFoam). `add*` take WORLD points. */
function waterBuilder() {
  const pos = [], uv = [], shape = [], foam = [], idx = [];
  return {
    disc(ring, cx, cz, y) {
      const c = pos.length / 3;
      pos.push(cx, y, cz); uv.push(0, 0); shape.push(1); foam.push(0);
      for (const [x, z] of ring) { pos.push(x, y, z); uv.push((x - cx) / Math.hypot(x - cx, z - cz || 1e-6), (z - cz) / Math.hypot(x - cx, z - cz || 1e-6)); shape.push(1); foam.push(0); }
      const n = ring.length;
      for (let k = 0; k < n; k++) idx.push(c, c + 1 + k, c + 1 + ((k + 1) % n));
    },
    ribbon(samples, lift) {
      let dist = 0, prev = null, count = 0;
      for (const q of samples) {
        if (prev) dist += Math.hypot(q.x - prev.x, q.z - prev.z);
        prev = q;
        const y = q.y + lift;
        pos.push(q.x + q.nx * q.hwL, y, q.z + q.nz * q.hwL, q.x, y, q.z, q.x - q.nx * q.hwR, y, q.z - q.nz * q.hwR);
        uv.push(0, dist, 0.5, dist, 1, dist); shape.push(0, 0, 0); foam.push(q.foam, q.foam, q.foam);
        if (count > 0) { const k = (pos.length / 3) - 6; idx.push(k, k + 1, k + 3, k + 1, k + 4, k + 3, k + 1, k + 2, k + 4, k + 2, k + 5, k + 4); }
        count++;
      }
    },
    build() {
      if (!idx.length) return null;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setAttribute('aShape', new THREE.Float32BufferAttribute(shape, 1)); g.setAttribute('aFoam', new THREE.Float32BufferAttribute(foam, 1));
      g.setIndex(idx); g.computeBoundingSphere();
      return g;
    },
  };
}

/** The shared fall ribbon builder (sky falls and sea-cliff falls): vertical strips with a fade `tail`, plus foot mist discs. Attribute names match the 69d fall program (aFall = mist). */
function fallBuilder() {
  const pos = [], uv = [], mistA = [], tail = [], idx = [];
  return {
    /** pts [{x, y, z, tail}] top to bottom; yaw = the strip's horizontal direction; hw = half width (u). */
    strip(pts, yaw, hw) {
      const dx = Math.cos(yaw), dz = Math.sin(yaw);
      let dist = 0;
      pts.forEach((p, i) => {
        if (i) dist += Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y, p.z - pts[i - 1].z);
        pos.push(p.x - dx * hw, p.y, p.z - dz * hw, p.x + dx * hw, p.y, p.z + dz * hw);
        uv.push(0, dist, 1, dist); mistA.push(0, 0); tail.push(p.tail, p.tail);
        if (i) { const k = pos.length / 3 - 4; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
      });
    },
    mist(x, y, z, scale = 1) {
      for (const [radius, lift] of CROWN_WATER.fall.mist3) {
        const r = radius * scale, k = pos.length / 3;
        pos.push(x - r, y + lift, z - r, x + r, y + lift, z - r, x - r, y + lift, z + r, x + r, y + lift, z + r);
        uv.push(0, 0, 1, 0, 0, 1, 1, 1); mistA.push(1, 1, 1, 1); tail.push(0, 0, 0, 0);
        idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
      }
    },
    build() {
      if (!idx.length) return null;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setAttribute('aFall', new THREE.Float32BufferAttribute(mistA, 1)); g.setAttribute('aTail', new THREE.Float32BufferAttribute(tail, 1));
      g.setIndex(idx); g.computeBoundingSphere();
      return g;
    },
  };
}
const triCount = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;

export function buildCrownVisuals(island, mod) {
  const W = buildCrownWater(island, mod), S = buildSkyMeshes(island, mod.crown);
  const group = new THREE.Group(), fixed = new THREE.Group(), far = new THREE.Group(), farFixed = new THREE.Group();
  group.name = 'crown-layers'; fixed.name = 'crown-cliff-falls'; far.name = 'crown-far-layers'; farFixed.name = 'crown-far-cliff-falls';
  const geos = [], meshes = [], info = [];
  const wm = crownWaterMaterial(), fm = crownFallMaterial();
  const keep = (mesh, parent, kind) => { mesh.castShadow = false; mesh.receiveShadow = false; parent.add(mesh); meshes.push(mesh); geos.push(mesh.geometry); info.push({ name: mesh.name, kind, triangles: triCount(mesh.geometry) }); return mesh; };

  // ---- elevated water: chunked (a river can cross a chunk edge: each piece goes to the chunk of its middle sample, so a chunk's sphere only has to cover its own pieces)
  const origin = { x: island.x - 200, z: island.z - 140 }, chunkOf = (x, z) => `${Math.floor((x - origin.x) / CROWN_WATER.chunk)},${Math.floor((z - origin.z) / CROWN_WATER.chunk)}`;
  const chunks = new Map(), at = (key) => { let b = chunks.get(key); if (!b) { b = waterBuilder(); chunks.set(key, b); } return b; };
  for (const p of W.pools) at(chunkOf(p.x, p.z)).disc(p.ring, p.x, p.z, p.y);
  for (const r of W.rivers) { const m = r.samples[r.samples.length >> 1]; at(chunkOf(m.x, m.z)).ribbon(r.samples, CROWN_WATER.lift + (r.kind === 'stream' ? 0.01 : 0)); }
  for (const [key, b] of chunks) { const g = b.build(); if (g) keep(Object.assign(new THREE.Mesh(g, wm), { name: `crown-water-${key}` }), group, 'water'); }

  // ---- the floating islands' own water (up at 100+ u: its own mesh so the plateau chunks keep tight bounds)
  const skyWater = waterBuilder();
  for (const p of W.summit) skyWater.disc(p.ring, p.x, p.z, p.y);
  for (const s of W.skyStreams) {
    const samples = s.pts.map((p, i) => {
      const a = s.pts[Math.max(0, i - 1)], b = s.pts[Math.min(s.pts.length - 1, i + 1)], tl = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      return { x: p.x, z: p.z, y: p.y, nx: -(b.z - a.z) / tl, nz: (b.x - a.x) / tl, hwL: s.hw, hwR: s.hw, foam: 0 };
    });
    skyWater.ribbon(samples, 0.02);
  }
  const swg = skyWater.build();
  if (swg) keep(Object.assign(new THREE.Mesh(swg, wm), { name: 'crown-sky-water' }), group, 'skyWater');

  // ---- sky falls (straight down from the spill point to the plunge pool, two crossed strips so a thin fall reads from every side) + foot mist
  const sky = fallBuilder();
  for (const f of W.skyFalls) {
    const mid = Math.max(f.yBottom + CROWN_WATER.fall.tail + 2, f.yBottom + 14), pts = [{ x: f.x, y: f.yTop, z: f.z, tail: 0 }, { x: f.x, y: mid, z: f.z, tail: 0 }, { x: f.x, y: f.yBottom + 0.05, z: f.z, tail: 1 }];
    sky.strip(pts, f.yaw, f.width / 2); sky.strip(pts, f.yaw + Math.PI / 2, f.width / 2);
    sky.mist(f.foot.x, f.foot.y, f.foot.z, 0.7 + f.width * 0.6);
  }
  const skyGeo = sky.build();
  if (skyGeo) { keep(Object.assign(new THREE.Mesh(skyGeo, fm), { name: 'crown-sky-falls' }), group, 'skyFalls'); }

  // ---- sea-cliff falls: part of the cliff, always drawn; the far view gets a second mesh on the same geometry
  const sea = fallBuilder();
  for (const f of W.seaFalls) { sea.strip(f.path, f.yaw, f.width / 2); sea.mist(f.foot.x, f.foot.y, f.foot.z, 1.1); }
  const seaGeo = sea.build();
  if (seaGeo) {
    keep(Object.assign(new THREE.Mesh(seaGeo, fm), { name: 'crown-sea-falls' }), fixed, 'seaFalls');
    const m = Object.assign(new THREE.Mesh(seaGeo, fm), { name: 'crown-sea-falls-far' }); m.castShadow = false; m.receiveShadow = false; farFixed.add(m); meshes.push(m);
  }

  // ---- the floating islands + rocks: one merged body (flat-shaded vertex toon) + one merged hull (the shared outline program)
  const body = new THREE.BufferGeometry();
  body.setAttribute('position', new THREE.BufferAttribute(S.full.positions, 3)); body.setAttribute('color', new THREE.BufferAttribute(S.full.colors, 3));
  body.computeVertexNormals(); body.computeBoundingSphere();
  const hull = new THREE.BufferGeometry();
  hull.setAttribute('position', new THREE.BufferAttribute(S.full.hullPositions, 3)); hull.setIndex(new THREE.BufferAttribute(S.full.hullIndices, 1));
  hull.computeVertexNormals(); hull.computeBoundingSphere();
  keep(Object.assign(new THREE.Mesh(body, VERTEX_TOON), { name: 'crown-sky-islands' }), group, 'islands');
  const outline = makeOutline(body, CROWN_WATER.sky.hull, hull); outline.name = 'crown-sky-islands-outline';
  outline.castShadow = false; outline.receiveShadow = false; group.add(outline); meshes.push(outline); geos.push(hull); info.push({ name: outline.name, kind: 'islandsOutline', triangles: triCount(hull) });

  // ---- the far view: simplified islands and the same sky falls (a second mesh on the same geometry)
  const farBody = new THREE.BufferGeometry();
  farBody.setAttribute('position', new THREE.BufferAttribute(S.far.positions, 3)); farBody.setAttribute('color', new THREE.BufferAttribute(S.far.colors, 3));
  farBody.computeVertexNormals(); farBody.computeBoundingSphere();
  const farMesh = Object.assign(new THREE.Mesh(farBody, VERTEX_TOON), { name: 'far-crown-sky-islands' }); farMesh.castShadow = false; farMesh.receiveShadow = false;
  far.add(farMesh); meshes.push(farMesh); geos.push(farBody);
  if (skyGeo) { const m = Object.assign(new THREE.Mesh(skyGeo, fm), { name: 'far-crown-sky-falls' }); m.castShadow = false; m.receiveShadow = false; far.add(m); meshes.push(m); }

  const api = {
    group, fixed, far, farFixed, plan: W, sky: S,
    /** Show / hide the secret layers (the cloud lid decides: crownLayers.js). The cliff falls are untouched. */
    setLayers(on) { group.visible = !!on; far.visible = !!on; },
    summary() {
      const sum = (kinds) => info.filter((i) => kinds.includes(i.kind));
      const tri = (list) => list.reduce((n, i) => n + i.triangles, 0);
      const layers = sum(['water', 'skyWater', 'skyFalls', 'islands', 'islandsOutline']);
      return {
        visible: group.visible, farVisible: far.visible, cliffFallsVisible: fixed.visible,
        water: { meshes: sum(['water']).length, triangles: tri(sum(['water'])), pools: W.pools.length, ribbons: W.rivers.length, riffles: W.rivers.reduce((n, r) => n + r.riffles, 0), summitPools: W.summit.length },
        falls: { sky: W.skyFalls.length, rim: W.rimFalls.length, sea: W.seaFalls.length, skyTriangles: tri(sum(['skyFalls'])), seaTriangles: tri(sum(['seaFalls'])) },
        islands: { islands: crownIslandsCount(S), rocks: S.summary().rocks, triangles: tri(sum(['islands'])), hullTriangles: tri(sum(['islandsOutline'])), farTriangles: S.far.triangles },
        layers: { drawCalls: layers.length, triangles: tri(layers) }, cliff: { drawCalls: sum(['seaFalls']).length, triangles: tri(sum(['seaFalls'])) },
        meshes: info.map((i) => ({ name: i.name, triangles: i.triangles })),
      };
    },
    dispose() {
      crownLayers.detach(api);
      for (const g of new Set(geos)) g.dispose();
      farBody.dispose();
      for (const m of meshes) m.removeFromParent();
      group.removeFromParent(); fixed.removeFromParent(); far.removeFromParent(); farFixed.removeFromParent();
    },
  };
  crownLayers.attach(api);
  return api;
}
const crownIslandsCount = (S) => S.summary().islands;
