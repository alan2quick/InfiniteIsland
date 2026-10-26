// Borrow island caches, preserve their baked colours, and merge party scenery by material.
// All returned geometries are owned by the caller. Shared materials have explicit leases.
import * as THREE from 'three';
import { G, combine, VERTEX_TOON } from '../../render/geo.js';
import { getHomeAsset } from '../props.js';
import { getAsset as frost } from '../islands/frostAssets.js';
import { getAsset as ember } from '../islands/emberAssets.js';
import { getMushroom } from '../islands/duskAssets.js';
import { swayClone, wobbleGroup } from '../wind.js';
import { buildRibbonGeometry, makeRibbonMaterial, waterUniforms } from '../water.js';
import { mulberry32 } from '../../utils/rng.js';
import { lowDecorAsset } from './decorLow.js';
import { dressingAsset, STILL_DRESSING } from './stageDressing.js';

let shared = null, leases = 0;
export function acquirePartyMaterials() {
  if (!shared) {
    const sway = swayClone(VERTEX_TOON, { amp: 0.035, speed: 0.65 });
    const apply = sway.onBeforeCompile;
    sway.onBeforeCompile = shader => {
      apply(shader);
      // Merged pieces need phase from each vertex rather than a shared object origin.
      shader.vertexShader = shader.vertexShader
        .replace('vec3 wIP = vec3(0.0);', 'vec3 wIP = vec3(position.x, 0.0, position.z);')
        // Short meadow blades need visible tip motion; elevated cloth must not acquire
        // the enormous displacement of a six-unit plant. Tree crowns also have CPU tilt.
        .replace('float wH = max(position.y, 0.0) * wSc;', 'float wH = min(max(position.y, 0.0) * wSc, 1.2);')
        .replace('mvPosition.xyz +=', 'wo *= 1.0 + 3.0 * (1.0 - smoothstep(0.4, 1.2, wH));\n          mvPosition.xyz +=');
    };
    sway.customProgramCacheKey = () => 'party-sway-v1';
    const water = makeRibbonMaterial(waterUniforms);
    water.uniforms.uShallow.value.set('#6ba7ac');
    water.uniforms.uDeep.value.set('#487f96');
    // Own the foam colour: never recolour the island's shared uniform.
    water.uniforms.uFoam = { value: new THREE.Color('#d7e1d1') };
    water.fragmentShader = water.fragmentShader
      .replace('float flow =', `vec3 movingNormal = normalize(vec3(
        0.22 * cos(vUv.y * 3.0 - uTime * 1.4), 1.0,
        0.18 * sin(vUv.x * 17.0 + uTime * 0.9)));
      float glint = pow(max(0.0, dot(movingNormal, normalize(vec3(0.2, 1.0, 0.3)))), 90.0);
      col += vec3(0.16) * glint * (1.0 - uNight * 0.6);
      float flow =`)
      .replace('step(0.82, e)', 'smoothstep(0.76, 1.0, e)')
      .replace('0.55 * (1.0 - uNight', '0.18 * (1.0 - uNight');
    shared = { sway, water };
  }
  leases++;
  let released = false;
  return { ...shared, release() {
    if (released) return; released = true;
    if (--leases === 0) { shared.sway.dispose(); shared.water.dispose(); shared = null; }
  } };
}

/** Cached geometries remain in their original owners; even custom attributes are left intact. */
export function decorAsset(kind) {
  if (['oak', 'bush', 'grass', 'flowerPink', 'flowerWhite', 'flowerYellow', 'flowerPurple'].includes(kind)) return getHomeAsset(kind);
  if (['pine', 'spruce', 'birch', 'reed', 'tuft', 'edelweiss', 'gentian'].includes(kind)) return frost(kind).geo;
  if (['banana', 'coconut', 'jungle', 'breadfruit', 'bamboo', 'fern', 'hibiscus', 'plumeria'].includes(kind)) return ember(kind).geo;
  if (['giant-a', 'giant-b', 'titan'].includes(kind)) return getMushroom(kind).geo;
  if (kind === 'pebble') return G.ico1;
  if (kind === 'leaf') return G.sphereLo;
  throw new Error(`Unknown party decor: ${kind}`);
}

// Upper bound for applySway's two sine sums, gust <= 1; crowns also have CPU tilt.
export const swayPadding = (height, crown = false) =>
  (height <= 0.4 ? 0.035 * Math.pow(Math.max(0, height), 1.5) * 1.44 * 4 + 0.01 : 0.11) + (crown ? 0.25 : 0);

/** Soft colour edge instead of a hard disc: four irregular concentric rings blend back
 * into the meadow colour, with seeded low-frequency vertex-colour variation. Also used
 * for worn paths (stretch sz, chain several small blobs; keep them clear of colliders). */
export function groundPatch({ seed = 1, radius = 1, color = '#a5ca70', edge = '#8fe36b', sx = 1, sz = 1, segments = 16, rings = 4, compact = false } = {}) {
  const rng = mulberry32(seed), positions = [], colors = [], indices = [], n = segments;
  const inner = new THREE.Color(color), outer = new THREE.Color(edge);
  const radii = Array.from({ length: n }, () => radius * (0.8 + rng() * 0.2));
  for (let ring = 0; ring <= rings; ring++) for (let j = 0; j < n; j++) {
    const a = j / n * Math.PI * 2, r = radii[j] * ring / rings;
    positions.push(Math.cos(a) * r * sx, 0, Math.sin(a) * r * sz);
    const c = inner.clone().lerp(outer, ring === rings ? 1 : Math.max(0, (ring - 1) / Math.max(1, rings - 1)));
    if (ring < rings) c.multiplyScalar(0.96 + rng() * 0.08);
    colors.push(c.r, c.g, c.b);
    if (ring) {
      const k = ring * n + j, l = ring * n + (j + 1) % n;
      indices.push(k - n, l, k);
      if (!compact || ring > 1) indices.push(k - n, l - n, l);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(positions.length / 3 * 2), 2));
  g.setIndex(indices); g.computeVertexNormals(); return g;
}

function baked(kind, p) {
  const small = p.lowCover && (kind === 'grass' || kind === 'pebble' || kind === 'leaf' || kind.startsWith('flower'));
  const far = ['oak', 'birch', 'pine', 'spruce', 'bush', 'coconut', 'banana', 'jungle', 'breadfruit'].includes(kind) &&
    (p.zone === 'treeline' || p.zone === 'sides' || Math.hypot(p.x, p.z) > 18);
  const asset = dressingAsset(kind) || (small || far ? lowDecorAsset(kind) : decorAsset(kind));
  const g = asset.index ? asset.toNonIndexed() : asset.clone();
  g.userData.partyDetail = small ? 'small' : far ? 'far' : 'island';
  // Merge only standard attributes. The source's role attributes still belong to its biome.
  for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(name)) g.deleteAttribute(name);
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  if (!g.attributes.color) g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(0.55), 3));
  if (p.tint) {
    const c = new THREE.Color(p.tint), colors = g.attributes.color;
    for (let i = 0; i < colors.count; i++) colors.setXYZ(i, c.r, c.g, c.b);
  }
  if (p.softColor) {
    const soft = new THREE.Color(p.softColor), colors = g.attributes.color;
    for (let i = 0; i < colors.count; i++) { const c = new THREE.Color(colors.getX(i), colors.getY(i), colors.getZ(i)).lerp(soft, 0.22); colors.setXYZ(i, c.r, c.g, c.b); }
  }
  const scale = p.scale ?? 1;
  g.scale(scale * (kind === 'leaf' ? 0.25 : kind === 'pebble' ? 0.3 : 1), scale * (kind === 'leaf' ? 0.025 : kind === 'pebble' ? 0.16 : 1), scale * (kind === 'leaf' ? 0.1 : kind === 'pebble' ? 0.22 : 1));
  g.rotateY(p.yaw || 0); g.rotateZ(p.lean || 0);
  if (p.lowCover) {
    g.computeBoundingBox();
    const bottom = g.boundingBox.min.y, height = g.boundingBox.max.y - bottom;
    g.translate(0, -bottom, 0); g.scale(1, Math.min(1, 0.36 / height), 1);
  }
  g.translate(p.x, p.y ?? (p.lowCover ? 0.025 : 0), p.z);
  return g;
}

/** placements [{kind,x,z,scale,yaw,lean,layer}]. acceptSphere may reject unsafe camera
 * silhouettes after the actual asset bounds are known. bounds includes motion padding. */
export function createDecor({ root, placements, materials, acceptSphere = () => true, unlitParts = null }) {
  const foliage = [], still = [], bounds = [], crowns = [];
  let offset = 0;
  for (const p of placements) {
    let g = p.kind === 'patch' || p.kind === 'path'
      ? groundPatch({ seed: p.id, radius: p.scale, color: p.color || (p.kind === 'path' ? '#d5c18b' : '#a5ca70'), ...(p.edge ? { edge: p.edge } : {}),
        ...(p.lowCover ? { segments: 10, rings: 2, compact: true } : {}) }) : baked(p.kind, p);
    if (g.index) { const indexed = g; g = indexed.toNonIndexed(); indexed.dispose(); }
    if (p.kind === 'patch' || p.kind === 'path') g.translate(p.x, 0.025, p.z);
    g.computeBoundingSphere(); g.computeBoundingBox();
    const staticPiece = ['pebble', 'leaf', 'patch', 'path'].includes(p.kind) || STILL_DRESSING.has(p.kind);
    const crown = p.crownSway !== false && ['oak', 'birch', 'pine', 'spruce'].includes(p.kind);
    const sphere = g.boundingSphere.clone();
    sphere.radius += staticPiece ? 0.02 : swayPadding(g.boundingBox.max.y, crown);
    const boundsEntry = { kind: p.kind, layer: p.layer, sphere, lowCover: !!p.lowCover,
      y0: p.y ?? 0, // (a piece standing on a raised surface: its cover height is top - y0)
      top: g.boundingBox.max.y, // shader wind is horizontal; only crowns tilt vertically
      x: p.x, z: p.z, footprint: p.scale, parent: p.parent, zone: p.zone || 'meadow',
      triangles: g.attributes.position.count / 3, detail: g.userData.partyDetail || 'patch' };
    if (!acceptSphere(sphere, boundsEntry)) { g.dispose(); continue; }
    bounds.push(boundsEntry);
    if (p.unlit && unlitParts) { unlitParts.push(g); continue; }
    if (staticPiece) still.push(g);
    else {
      if (crown) crowns.push({ start: offset, count: g.attributes.position.count, x: p.x, z: p.z, phase: p.yaw, pivot: (p.scale ?? 1) * 1.8 });
      offset += g.attributes.position.count; foliage.push(g);
    }
  }
  const meshes = [];
  for (const [parts, mat] of [[foliage, materials.sway], [still, VERTEX_TOON]]) if (parts.length) {
    const m = new THREE.Mesh(combine(parts), mat); m.name = 'party-decor'; root.add(m); meshes.push(m);
  }
  const crownMesh = foliage.length ? meshes[0] : null;
  const base = crownMesh?.geometry.attributes.position.array.slice();
  const tilt = new THREE.Group(), v = new THREE.Vector3();
  let disposed = false;
  return { bounds, meshes,
    update(t) {
      if (!crownMesh) return;
      const pos = crownMesh.geometry.attributes.position;
      for (const c of crowns) {
        wobbleGroup(tilt, t * 0.45, 0.014, c.phase); tilt.updateMatrix();
        for (let i = c.start; i < c.start + c.count; i++) {
          const j = i * 3, y = base[j + 1];
          if (y <= c.pivot) continue;
          v.set(base[j] - c.x, y - c.pivot, base[j + 2] - c.z).applyMatrix4(tilt.matrix);
          pos.setXYZ(i, v.x + c.x, v.y + c.pivot, v.z + c.z);
        }
      }
      pos.needsUpdate = true;
    },
    dispose() { if (disposed) return; disposed = true; for (const m of meshes) { m.geometry.dispose(); m.removeFromParent(); } },
  };
}

export function createStageWater({ root, path, width, materials }) {
  const mesh = new THREE.Mesh(buildRibbonGeometry(path, width), materials.water);
  mesh.name = 'party-water'; root.add(mesh);
  mesh.geometry.computeBoundingSphere();
  return { mesh, dispose() { mesh.geometry.dispose(); mesh.removeFromParent(); } };
}
