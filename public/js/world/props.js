// Natural features: trees, cherry-blossom trees, palms, boulders, bushes, flowers, grass, mushrooms,
// pond lily pads + reeds, a fallen log and the signpost. Everything is placed with a seeded RNG using
// rejection sampling against the terrain helpers, then registered with the collider + interactable registries.
//
// Rendering strategy
//   * Each tree / palm / rock / bush is ONE mesh (trunk + canopy etc. merged with vertex colours) inside its own
//     Group, so Step 5 can shake / rustle the group. Geometry is shared between instances of the same variant, and
//     "colour variation per tree" comes from a handful of shared tint materials (tint * vertex colour).
//   * Outlines are inverted hulls built from a *smoothed* copy of the geometry so faceted rocks and merged
//     shapes still get a closed, even outline.
//   * Flowers (4 colours) and grass tufts are InstancedMeshes without outlines.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { PALETTE, WORLD_SEED, WATER_LEVEL, OUTLINE_THICKNESS, nearAnyFire, HAT_RACK, SIGNPOST } from '../config.js';
import { mulberry32, range, rangeInt, pick } from '../utils/rng.js';
import { toonMat, addOutline } from '../render/toon.js';
import {
  getHeight, getGroundType, getSlope, inlandDistance, streamDistance,
  SPAWN, POND, PLATEAU, RAMP_ANGLES, STREAM_HALF_WIDTH,
} from './terrain.js';
import { addCollider, overlapsAny } from './colliders.js';
import { addInteractable } from './interactables.js';
import { swayClone, wobbleGroup, windTime } from './wind.js';
import { grassShapeAt } from './grassVariation.js';
import { softenRockGeometry } from '../render/softRock.js';
import { autumnTreeMaterial } from '../render/autumnTrees.js';
import { ritualReserved } from './islands/ritual.js';
import { rootgateReserved } from './islands/rootgate.js';

// ---------------------------------------------------------------------------------------------
// Small geometry toolkit
// ---------------------------------------------------------------------------------------------
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();

/** Clone `geo`, bake a transform and a flat vertex colour into it, and make it merge-compatible. */
export function part(geo, color, t = {}) {
  const { p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1] } = t;
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) {
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  }
  _e.set(r[0], r[1], r[2]);
  _q.setFromEuler(_e);
  _m.compose(_v.set(p[0], p[1], p[2]), _q, _s.set(s[0], s[1], s[2]));
  g.applyMatrix4(_m);
  if (color === null) return g;   // keep the geometry's own vertex colours
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

/** Same as part() but with a caller supplied per-vertex colour function (position, normal) -> Color. */
function partFn(geo, colorFn, t = {}) {
  const g = part(geo, '#ffffff', t);
  const pos = g.attributes.position, nor = g.attributes.normal, col = g.attributes.color;
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    colorFn(tmp, pos.getX(i), pos.getY(i), pos.getZ(i), nor.getX(i), nor.getY(i), nor.getZ(i));
    col.setXYZ(i, tmp.r, tmp.g, tmp.b);
  }
  return g;
}

export function combine(parts) {
  const g = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return g;
}

/** Position-only, vertex-welded, smooth-normal copy used to extrude even outlines. */
export function smoothOutlineGeo(geo) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', geo.attributes.position.clone());
  const m = mergeVertices(g, 1e-3);
  m.computeVertexNormals();
  return m;
}

/** Attach an inverted-hull outline built from `outlineGeo` (defaults to a smoothed copy of the mesh geometry). */
function outline(mesh, outlineGeo, thickness = OUTLINE_THICKNESS) {
  const tmp = new THREE.Mesh(outlineGeo);
  const o = addOutline(tmp, thickness);
  tmp.remove(o);
  mesh.add(o);
  return o;
}

const HALF_PI = Math.PI / 2;

// Shared unit primitives (cloned + transformed by part())
const G = {
  ico2: new THREE.IcosahedronGeometry(1, 2),
  ico1: new THREE.IcosahedronGeometry(1, 1),
  sphere: new THREE.SphereGeometry(1, 10, 8),
  sphereLo: new THREE.SphereGeometry(1, 7, 5),
  sphereXs: new THREE.SphereGeometry(1, 6, 4),   // flower petals: tiny on screen, so keep them cheap
  cyl8: new THREE.CylinderGeometry(1, 1, 1, 8, 1),
  cyl6: new THREE.CylinderGeometry(1, 1, 1, 6, 1),
};

// ---------------------------------------------------------------------------------------------
// Terrain-aware placement helpers
// ---------------------------------------------------------------------------------------------
const SPAWN_CLEAR = 3.2;   // nothing (not even a flower) closer than this to SPAWN

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

/** True inside the walkway of either plateau ramp (kept clear of anything solid). */
function nearRamp(x, z, pad = 0) {
  const dx = x - PLATEAU.x, dz = z - PLATEAU.z;
  for (const ra of RAMP_ANGLES) {
    const ux = Math.cos(ra), uz = Math.sin(ra);
    const along = dx * ux + dz * uz;
    const lat = Math.abs(-dx * uz + dz * ux);
    if (along > PLATEAU.radius - 10 && along < PLATEAU.radius + 13 && lat < 4.6 + pad) return true;
  }
  return false;
}

function groundY(x, z, r) {
  let y = getHeight(x, z);
  if (r > 0.3) {
    y = Math.min(y, getHeight(x + r, z), getHeight(x - r, z), getHeight(x, z + r), getHeight(x, z - r));
  }
  return y;
}

const RING = [0, 1, 2, 3, 4, 5].map((i) => [Math.cos(i * Math.PI / 3), Math.sin(i * Math.PI / 3)]);

/**
 * Terrain suitability test. Cheap rejections first because rejection sampling calls this thousands of times.
 * opts: types (allowed ground types), r (footprint), slope, minH (lowest ground allowed under the footprint),
 *       inland [min,max], ramp (keep ramps clear), spawnPad.
 */
function terrainOK(x, z, o) {
  const r = o.r ?? 0.5;
  if (Math.hypot(x - SPAWN.x, z - SPAWN.z) < SPAWN_CLEAR + r * (o.spawnPad ?? 0.5)) return false;
  if (nearAnyFire(x, z, r * 0.5)) return false;   // a campfire plaza (config FIRES, world/campfire.js)
  if (ritualReserved(x, z, r)) return false;
  if (rootgateReserved(x, z, r)) return false;                    // Step 56: the Rootgate (a clearing of the old placement, so nothing moves)
  if (Math.hypot(x - HAT_RACK.x, z - HAT_RACK.z) < HAT_RACK.radius + r + 0.7) return false;
  if (Math.hypot(x - SIGNPOST.x, z - SIGNPOST.z) < r + 1.1) return false;
  if (o.ramp !== false && nearRamp(x, z, r * 0.5)) return false;
  const pondPad = 1.4 + r;
  const px = (x - POND.x) / (POND.rx + pondPad), pz = (z - POND.z) / (POND.rz + pondPad);
  if (px * px + pz * pz < 1) return false;
  if (streamDistance(x, z) < STREAM_HALF_WIDTH + 0.7 + r) return false;
  const minH = o.minH ?? 0.15;
  if (getHeight(x, z) < minH) return false;
  if (o.inland) {
    const t = inlandDistance(x, z);
    if (t < o.inland[0] || t > o.inland[1]) return false;
  }
  if (!o.types.includes(getGroundType(x, z))) return false;
  if (getSlope(x, z) > (o.slope ?? 0.35)) return false;
  if (r > 0.3) {
    for (const [cx, cz] of RING) if (getHeight(x + cx * (r + 0.2), z + cz * (r + 0.2)) < minH - 0.1) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------------------------
// Tint materials: shared, near-white multipliers on top of the baked vertex colours
// ---------------------------------------------------------------------------------------------
const tint = (hex) => toonMat(hex, { vertexColors: true });
const GREEN_TINTS = ['#ffffff', '#eaffd0', '#d9ffe6', '#fff6c9', '#f2ffee'].map(tint);
const PINK_TINTS = ['#ffffff', '#ffe8f2', '#fff2f8', '#f4e8ff', '#ffeede'].map(tint);
const ROCK_TINTS = ['#ffffff', '#f0ecff', '#e2dff2', '#fff5ec'].map(tint);
const PLAIN = tint('#ffffff');
// Wind-swaying variants (clones, so the shared PLAIN material keeps its plain shader)
const FLOWER_MAT = swayClone(PLAIN, { amp: 0.17, speed: 1.0 });
const GRASS_MAT = swayClone(PLAIN, { amp: 0.16, speed: 1.15, variation: true });

// ---------------------------------------------------------------------------------------------
// Prop geometry builders
// ---------------------------------------------------------------------------------------------
const TRUNK = new THREE.Color(PALETTE.trunk);

function buildTreeVariant(kind, rng) {
  const cherry = kind === 'cherry';
  const base = new THREE.Color(cherry ? PALETTE.blossom : PALETTE.canopy);
  const light = base.clone().lerp(new THREE.Color('#ffffff'), cherry ? 0.32 : 0.22);
  const dark = base.clone().lerp(new THREE.Color(cherry ? '#e8508f' : '#1f8f55'), 0.3);
  const trunkCol = cherry ? '#8a5a4a' : PALETTE.trunk;

  const parts = [];
  // chunky, slightly flared trunk
  parts.push(part(G.cyl8, trunkCol, { p: [0, 1.25, 0], s: [0.34, 2.5, 0.34] }));
  parts.push(part(new THREE.CylinderGeometry(0.34, 0.62, 0.55, 8), trunkCol, { p: [0, 0.2, 0] }));
  // bumpy branch stub or two
  const bs = rangeInt(rng, 1, 2);
  for (let i = 0; i < bs; i++) {
    const a = rng() * Math.PI * 2;
    parts.push(part(G.cyl6, trunkCol, {
      p: [Math.cos(a) * 0.3, 2.1, Math.sin(a) * 0.3], r: [Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9], s: [0.12, 0.9, 0.12],
    }));
  }

  // clustered squashed-sphere canopy
  const R = cherry ? 1.95 : 1.75;
  const sy = cherry ? 0.72 : 0.84;
  const cy = cherry ? 3.05 : 3.15;
  parts.push(part(G.ico2, base, { p: [0, cy, 0], s: [R, R * sy, R] }));
  const extras = rangeInt(rng, 2, 3);
  const a0 = rng() * Math.PI * 2;
  for (let i = 0; i < extras; i++) {
    const a = a0 + (i / extras) * Math.PI * 2 + range(rng, -0.4, 0.4);
    const d = range(rng, 1.0, 1.35) * (cherry ? 1.1 : 1);
    const r = range(rng, 1.05, 1.4) * (cherry ? 1.05 : 1);
    parts.push(part(G.ico2, i % 2 ? base : dark, {
      p: [Math.cos(a) * d, cy - range(rng, 0.15, 0.75), Math.sin(a) * d], s: [r, r * sy, r],
    }));
  }
  if (!cherry || rng() < 0.6) {
    const r = range(rng, 0.9, 1.2);
    parts.push(part(G.ico2, light, { p: [range(rng, -0.4, 0.4), cy + R * sy * 0.78, range(rng, -0.4, 0.4)], s: [r, r * sy, r] }));
  }
  const geo = combine(parts);
  return { geo, outlineGeo: smoothOutlineGeo(geo) };
}

function buildPalmVariant(rng) {
  const H = range(rng, 4.0, 5.0);
  const lean = range(rng, 1.3, 2.3);
  const P0 = new THREE.Vector3(0, -0.15, 0);
  const P1 = new THREE.Vector3(lean * 0.12, H * 0.62, 0);
  const P2 = new THREE.Vector3(lean, H, 0);
  const curve = new THREE.QuadraticBezierCurve3(P0, P1, P2);
  const parts = [];
  const N = 8;
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < N; i++) {
    const t0 = i / N, t1 = (i + 1) / N;
    const a = curve.getPoint(t0), b = curve.getPoint(t1);
    const dir = b.clone().sub(a);
    const len = dir.length();
    dir.normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(up, dir);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const r0 = 0.44 - 0.2 * t0, r1 = 0.44 - 0.2 * t1;
    const seg = new THREE.CylinderGeometry(r1 * 0.94, r0 * 1.06, len * 1.08, 8, 1);
    const eul = new THREE.Euler().setFromQuaternion(q);
    parts.push(part(seg, i % 2 ? '#a9744b' : '#8f5f3e', { p: [mid.x, mid.y, mid.z], r: [eul.x, eul.y, eul.z] }));
  }
  const top = curve.getPoint(1);
  parts.push(part(G.ico1, '#7a5233', { p: [top.x, top.y + 0.05, top.z], s: [0.32, 0.28, 0.32] }));
  // coconuts
  const nCoco = rangeInt(rng, 2, 4);
  for (let i = 0; i < nCoco; i++) {
    const a = (i / nCoco) * Math.PI * 2 + rng();
    parts.push(part(G.ico1, '#6b4426', { p: [top.x + Math.cos(a) * 0.32, top.y - 0.3, top.z + Math.sin(a) * 0.32], s: [0.21, 0.21, 0.21] }));
  }
  // drooping fronds
  const frondN = rangeInt(rng, 7, 9);
  const fa0 = rng() * Math.PI * 2;
  for (let i = 0; i < frondN; i++) {
    const a = fa0 + (i / frondN) * Math.PI * 2 + range(rng, -0.15, 0.15);
    const len = range(rng, 2.6, 3.3);
    const geo = buildFrondGeo(len, range(rng, 0.62, 0.8), range(rng, 1.3, 1.9), range(rng, 2.0, 2.7), rng);
    parts.push(part(geo, null, { p: [top.x, top.y + 0.12, top.z], r: [0, a, range(rng, -0.05, 0.3)] }));
    geo.dispose();
  }
  // two short upright fronds in the middle
  for (let i = 0; i < 2; i++) {
    const geo = buildFrondGeo(1.7, 0.5, 2.2, 1.2, rng);
    parts.push(part(geo, null, { p: [top.x, top.y + 0.15, top.z], r: [0, fa0 + i * 3.2 + 1, 0.75] }));
    geo.dispose();
  }
  const g = combine(parts);
  return { geo: g, outlineGeo: smoothOutlineGeo(g), lean, H, top: top.clone() };
}

/** A chunky, closed, folded palm leaf running along +X (arching up, then drooping). Has its own vertex colours. */
function buildFrondGeo(len, width, upAmt, drop, rng) {
  const N = 8;
  const pos = [], col = [], idx = [];
  const cTop = new THREE.Color('#5fd66d'), cTop2 = new THREE.Color('#3fb45a'), cBot = new THREE.Color('#2f9a52');
  const tmp = new THREE.Color();
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const x = len * t;
    const y = upAmt * t - drop * t * t;
    const w = width * Math.sin(Math.PI * Math.pow(t, 0.72));
    const fold = w * 0.5;
    const th = 0.05 * (1 - t * 0.5);
    // ring: 0=left edge, 1=top ridge, 2=right edge, 3=bottom ridge
    pos.push(x, y - fold, -w);
    pos.push(x, y + th, 0);
    pos.push(x, y - fold, w);
    pos.push(x, y - th * 1.4 - fold * 0.25, 0);
    tmp.copy(cTop).lerp(cTop2, t);
    col.push(tmp.r, tmp.g, tmp.b, tmp.r, tmp.g, tmp.b, tmp.r, tmp.g, tmp.b, cBot.r, cBot.g, cBot.b);
  }
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < 4; j++) {
      const a = i * 4 + j, b = i * 4 + ((j + 1) % 4), c = (i + 1) * 4 + j, d = (i + 1) * 4 + ((j + 1) % 4);
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // make sure faces point outwards (top ridge of the widest ring must face up)
  const n = g.attributes.normal;
  if (n.getY(4 * 3 + 1) < 0) {
    for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
    g.setIndex(idx);
    g.computeVertexNormals();
  }
  return g;
}

// ---- Rocks
function buildRockVariant(rng, useIco) {
  const base = useIco ? new THREE.IcosahedronGeometry(1, 0) : new THREE.DodecahedronGeometry(1, 0);
  const g = base.index ? base.toNonIndexed() : base.clone();
  const jitter = new Map();
  const pos = g.attributes.position;
  const rock = new THREE.Color(PALETTE.rock);
  for (let i = 0; i < pos.count; i++) {
    const k = pos.getX(i).toFixed(3) + ',' + pos.getY(i).toFixed(3) + ',' + pos.getZ(i).toFixed(3);
    let j = jitter.get(k);
    if (!j) { j = [range(rng, -1, 1), range(rng, -1, 1), range(rng, -1, 1), range(rng, 0.9, 1.12)]; jitter.set(k, j); }
    const amp = 0.22;
    pos.setXYZ(i, (pos.getX(i) * j[3] + j[0] * amp) * 1.05, (pos.getY(i) * j[3] + j[1] * amp) * 0.78, (pos.getZ(i) * j[3] + j[2] * amp) * 1.0);
  }
  g.computeVertexNormals();
  const n = pos.count;
  const nrm = g.attributes.normal;
  const arr = new Float32Array(n * 3);
  const light = rock.clone().lerp(new THREE.Color('#ffffff'), 0.28);
  const dark = rock.clone().lerp(new THREE.Color('#6f6a94'), 0.35);
  const tmp = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const ny = nrm.getY(i);
    tmp.copy(rock).lerp(ny > 0 ? light : dark, Math.min(1, Math.abs(ny) * 0.9));
    arr[i * 3] = tmp.r; arr[i * 3 + 1] = tmp.g; arr[i * 3 + 2] = tmp.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  g.deleteAttribute('uv');
  softenRockGeometry(g);
  return { geo: g, outlineGeo: smoothOutlineGeo(g) };
}

// ---- Bushes
function buildBushVariant(rng, deco) {
  const base = new THREE.Color('#4fbf5f');
  const light = base.clone().lerp(new THREE.Color('#9dff7a'), 0.25);
  const dark = base.clone().lerp(new THREE.Color('#1f8f55'), 0.3);
  const blobs = [
    { p: [0, 0.6, 0], r: 0.95, c: base },
  ];
  const n = rangeInt(rng, 2, 3);
  const a0 = rng() * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * Math.PI * 2 + range(rng, -0.3, 0.3);
    const d = range(rng, 0.62, 0.85);
    const r = range(rng, 0.6, 0.78);
    blobs.push({ p: [Math.cos(a) * d, r * 0.55, Math.sin(a) * d], r, c: i % 2 ? dark : light });
  }
  const parts = blobs.map((b) => part(G.ico2, b.c, { p: b.p, s: [b.r, b.r * 0.82, b.r] }));
  const berryParts = [];     // berry bushes keep their berries in a separate mesh so gathering.js can hide them while the bush is empty
  if (deco) {
    const count = deco === 'berry' ? rangeInt(rng, 9, 12) : rangeInt(rng, 7, 10);
    const cols = deco === 'berry' ? ['#ff4d6d', '#ff4d6d', '#ff7a8f'] : deco === 'pink' ? ['#ffb3d1', '#ff8fbe', '#fff0f6'] : ['#fff7c2', '#ffffff', '#ffe27a'];
    for (let i = 0; i < count; i++) {
      const b = blobs[Math.min(blobs.length - 1, Math.floor(rng() * blobs.length))];
      const th = range(rng, 0.15, 1.25), ph = rng() * Math.PI * 2;
      const dx = Math.sin(th) * Math.cos(ph), dy = Math.cos(th), dz = Math.sin(th) * Math.sin(ph);
      const rr = 0.15;
      (deco === 'berry' ? berryParts : parts).push(part(G.sphereLo, pick(rng, cols), {
        p: [b.p[0] + dx * b.r * 1.0, b.p[1] + dy * b.r * 0.82 * 1.0, b.p[2] + dz * b.r * 1.0],
        s: [rr, rr, rr],
      }));
    }
  }
  const g = combine(parts);
  return { geo: g, outlineGeo: smoothOutlineGeo(g), berryGeo: berryParts.length ? combine(berryParts) : null };
}

// ---- Flowers (5 petals + yellow centre + stem + leaf), baked per colour for the instanced meshes
function buildFlowerGeo(petalHex) {
  const parts = [];
  parts.push(part(G.cyl6, '#4fb85a', { p: [0, 0.2, 0], s: [0.028, 0.4, 0.028] }));
  parts.push(part(G.sphereXs, '#63cf6a', { p: [0.09, 0.13, 0], r: [0, 0, 0.5], s: [0.12, 0.04, 0.06] }));
  parts.push(part(G.sphereXs, '#63cf6a', { p: [-0.09, 0.2, 0.02], r: [0, 0, -0.5], s: [0.1, 0.035, 0.055] }));
  const y = 0.44;
  const petalCol = new THREE.Color(petalHex);
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    parts.push(part(G.sphereXs, petalCol, {
      p: [Math.cos(a) * 0.15, y, -Math.sin(a) * 0.15], r: [0, a, 0.0], s: [0.15, 0.06, 0.11],
    }));
  }
  parts.push(part(G.sphereXs, '#ffd93b', { p: [0, y + 0.03, 0], s: [0.1, 0.075, 0.1] }));
  return combine(parts);
}
const FLOWER_COLORS = ['#ff6f91', '#fff6ee', '#b494ff', '#7fc4ff'];

// ---- Grass tuft: three tapered blades leaning outwards
function buildGrassTuftGeo() {
  const parts = [];
  const cone = new THREE.ConeGeometry(0.13, 1, 5, 1, true);   // open-ended, one segment: 5 tris per blade
  const cBase = new THREE.Color('#3f9f4e'), cTip = new THREE.Color('#7ad86c');
  const blades = [
    { a: 0.0, lean: 0.32, h: 0.75 }, { a: 2.1, lean: 0.36, h: 0.6 }, { a: 4.2, lean: 0.3, h: 0.85 }, { a: 1.0, lean: 0.05, h: 0.5 },
  ];
  for (const b of blades) {
    parts.push(partFn(cone, (c, x, y) => {
      c.copy(cBase).lerp(cTip, Math.min(1, Math.max(0, (y - 0.0) / (b.h))));
    }, {
      p: [Math.cos(b.a) * 0.06, b.h * 0.5 - 0.02, Math.sin(b.a) * 0.06],
      r: [Math.sin(b.a) * b.lean, 0, -Math.cos(b.a) * b.lean],
      s: [1, b.h, 1],
    }));
  }
  return combine(parts);
}

// ---- Herb plant: a small basil / mint style clump of round leaves on a short stem (instanced; picked in gathering.js)
function buildHerbGeo() {
  const parts = [];
  parts.push(part(G.cyl6, '#2a9e7a', { p: [0, 0.2, 0], s: [0.03, 0.4, 0.03] }));
  const tiers = [[6, 0.13, 0.13, 0.45, '#2fc99a'], [5, 0.25, 0.1, 0.7, '#4fdcae'], [4, 0.36, 0.07, 0.95, '#79edc4'], [2, 0.45, 0.025, 1.25, '#b2fbe0']];
  tiers.forEach(([n, y, rad, tilt, col], ti) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + ti * 0.55;
      parts.push(part(G.sphereLo, col, {
        p: [Math.cos(a) * rad, y, Math.sin(a) * rad], r: [0, -a, tilt], s: [0.15, 0.036, 0.1],
      }));
    }
  });
  return combine(parts);
}
const HERB_MAT = swayClone(PLAIN, { amp: 0.12, speed: 1.1 });

// ---- Mushroom cluster (returns merged geo plus a stem+cap-only outline geo)
function buildMushroomCluster(items) {
  const parts = [], outlineParts = [];
  const capGeo = new THREE.SphereGeometry(1, 12, 8, 0, Math.PI * 2, 0, HALF_PI);
  const under = new THREE.CircleGeometry(1, 12);
  under.rotateX(HALF_PI);
  for (const it of items) {
    const s = it.s;
    const [x, y, z] = it.p;
    const stem = part(G.cyl8, '#fff1d6', { p: [x, y + 0.17 * s, z], s: [0.13 * s, 0.34 * s, 0.13 * s] });
    const capT = { p: [x, y + 0.3 * s, z], s: [0.4 * s, 0.32 * s, 0.4 * s] };
    const cap = part(capGeo, '#ff5560', capT);
    const cap2 = part(under, '#ffe2b8', { p: [x, y + 0.3 * s, z], s: [0.4 * s, 1, 0.4 * s] });
    parts.push(stem, cap, cap2);
    outlineParts.push(part(G.cyl8, '#fff', { p: [x, y + 0.17 * s, z], s: [0.13 * s, 0.34 * s, 0.13 * s] }), part(capGeo, '#fff', capT));
    // spots
    const nSpots = 5;
    for (let i = 0; i < nSpots; i++) {
      const th = 0.45 + (i % 2) * 0.45 + (i === 4 ? -0.4 : 0), ph = (i / nSpots) * Math.PI * 2 + it.rot;
      const sx = Math.sin(th) * Math.cos(ph), sy = Math.cos(th), sz = Math.sin(th) * Math.sin(ph);
      parts.push(part(G.sphereLo, '#ffffff', {
        p: [x + sx * 0.4 * s, y + 0.3 * s + sy * 0.32 * s, z + sz * 0.4 * s], s: [0.075 * s, 0.05 * s, 0.075 * s],
        r: [0, 0, 0],
      }));
    }
  }
  const geo = combine(parts);
  const oGeo = smoothOutlineGeo(combine(outlineParts));
  capGeo.dispose(); under.dispose();
  return { geo, outlineGeo: oGeo };
}

// ---------------------------------------------------------------------------------------------
// Signpost (canvas text on the board)
// ---------------------------------------------------------------------------------------------
function makeSignTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 176;
  const g = c.getContext('2d');
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '800 96px "Baloo 2", "Fredoka", "Trebuchet MS", system-ui, sans-serif';
  g.fillStyle = '#7a4a2a';
  g.fillText('Welcome!', 256, 92);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function buildSign() {
  const wood = '#b57a4e', board = '#f0c58a', dark = '#7c4f30';
  const parts = [];
  parts.push(part(G.cyl8, wood, { p: [0, 0.9, 0], s: [0.15, 1.9, 0.15] }));
  parts.push(part(G.ico1, dark, { p: [0, 1.93, 0], s: [0.2, 0.16, 0.2] }));
  // main board with a pointed end
  const shape = new THREE.Shape();
  shape.moveTo(-0.95, -0.34); shape.lineTo(0.72, -0.34); shape.lineTo(1.12, 0); shape.lineTo(0.72, 0.34); shape.lineTo(-0.95, 0.34); shape.closePath();
  const bg = new THREE.ExtrudeGeometry(shape, { depth: 0.1, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.05, bevelSegments: 2, curveSegments: 4 });
  bg.translate(0, 0, -0.05);
  parts.push(part(bg, board, { p: [0.12, 1.5, 0.13] }));
  // little second board pointing the other way
  const shape2 = new THREE.Shape();
  shape2.moveTo(0.6, -0.2); shape2.lineTo(-0.35, -0.2); shape2.lineTo(-0.7, 0); shape2.lineTo(-0.35, 0.2); shape2.lineTo(0.6, 0.2); shape2.closePath();
  const bg2 = new THREE.ExtrudeGeometry(shape2, { depth: 0.08, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.04, bevelSegments: 2, curveSegments: 4 });
  bg2.translate(0, 0, -0.04);
  parts.push(part(bg2, '#e3a86a', { p: [-0.15, 0.95, 0.13], r: [0, 0, -0.06] }));
  // nails
  for (const [x, y] of [[-0.75, 1.68], [-0.75, 1.32], [0.72, 1.5]]) parts.push(part(G.sphereLo, dark, { p: [x, y, 0.24], s: [0.05, 0.05, 0.05] }));
  const geo = combine(parts);
  bg.dispose(); bg2.dispose();
  return { geo, outlineGeo: smoothOutlineGeo(geo) };
}

// ---------------------------------------------------------------------------------------------
// createProps
// ---------------------------------------------------------------------------------------------
export function createProps(scene) {
  const group = new THREE.Group();
  group.name = 'props';
  const stats = {};
  const handles = { trees: [], palms: [], rocks: [], bushes: [], mushrooms: [], herbs: null, flowers: null, sign: null, log: null };

  // ---- occupancy for spacing (footprint circles) and hard obstacles (for small stuff)
  const occ = [];    // { x, z, r }  spacing footprint
  const solid = [];  // { x, z, r }  real obstacles (trunks, rocks, bushes...)
  const freeAt = (x, z, r, gap = 0.4) => {
    for (let i = 0; i < occ.length; i++) {
      const o = occ[i];
      const dx = x - o.x, dz = z - o.z, m = r + o.r + gap;
      if (dx * dx + dz * dz < m * m) return false;
    }
    return true;
  };
  const clearOfSolid = (x, z, r, pad = 0.35) => {
    for (let i = 0; i < solid.length; i++) {
      const o = solid[i];
      const dx = x - o.x, dz = z - o.z, m = r + o.r + pad;
      if (dx * dx + dz * dz < m * m) return false;
    }
    return true;
  };
  const claim = (x, z, footprint, hard) => {
    occ.push({ x, z, r: footprint });
    solid.push({ x, z, r: hard ?? footprint });
  };
  const LAND_R = 52;
  const sampleLand = (rng) => {
    const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * LAND_R;
    return [Math.cos(a) * r, Math.sin(a) * r];
  };
  const gauss = (rng) => (rng() + rng() + rng() - 1.5) * 2 / 1.5 * 1.2;

  // =========================================================================================
  // Signpost (first, so nothing else lands on it)
  // =========================================================================================
  {
    const sx = SIGNPOST.x, sz = SIGNPOST.z;
    const sy = getHeight(sx, sz);
    const s = buildSign();
    const mesh = new THREE.Mesh(s.geo, PLAIN);
    mesh.castShadow = true; mesh.receiveShadow = true;
    outline(mesh, s.outlineGeo, 0.045);
    const text = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.55), new THREE.MeshToonMaterial({ map: makeSignTexture(), transparent: true, gradientMap: PLAIN.gradientMap }));
    text.position.set(0.02, 1.5, 0.245);
    const sign = new THREE.Group();
    sign.name = 'signpost';
    sign.add(mesh, text);
    sign.scale.setScalar(1.25);
    sign.position.set(sx, sy - 0.08, sz);
    sign.rotation.y = Math.atan2(SPAWN.x - sx, SPAWN.z - sz) - 0.12;   // board faces the spawn point
    group.add(sign);
    claim(sx, sz, 1.4, 0.45);
    addCollider({ x: sx, z: sz, r: 0.38, owner: sign });
    const item = addInteractable({ type: 'sign', object: sign, position: new THREE.Vector3(sx, sy, sz), radius: 0.4, prompt: 'Read' });
    sign.userData.interactable = item;
    handles.sign = sign;
  }

  // =========================================================================================
  // Boulders
  // =========================================================================================
  {
    const rng = mulberry32(WORLD_SEED + 31);
    const variants = [];
    for (let i = 0; i < 6; i++) variants.push(buildRockVariant(rng, i % 3 === 2));
    const place = (x, z, s) => {
      const v = pick(rng, variants);
      const mesh = new THREE.Mesh(v.geo, pick(rng, ROCK_TINTS));
      mesh.castShadow = true; mesh.receiveShadow = true;
      outline(mesh, v.outlineGeo, 0.05);
      const g = new THREE.Group();
      g.name = 'rock';
      g.add(mesh);
      g.rotation.y = rng() * Math.PI * 2;
      g.scale.set(s * range(rng, 0.92, 1.15), s * range(rng, 0.85, 1.15), s * range(rng, 0.92, 1.15));
      const y = groundY(x, z, 0.75 * s);
      g.position.set(x, y + 0.62 * g.scale.y, z);   // mesh half-height is ~0.78; sink the base a little
      group.add(g);
      const r = 0.82 * s;
      claim(x, z, r, r);
      addCollider({ x, z, r, owner: g });
      const item = addInteractable({ type: 'rock', object: g, position: new THREE.Vector3(x, y, z), radius: r, prompt: 'Inspect' });
      g.userData.interactable = item;
      handles.rocks.push(g);
    };
    const tryPlace = (count, sizeRange, sampler, opts) => {
      let placed = 0;
      for (let tries = 0; tries < 4000 && placed < count; tries++) {
        const [x, z] = sampler();
        const s = range(rng, sizeRange[0], sizeRange[1]);
        const r = 0.85 * s;
        if (!freeAt(x, z, r, 0.6)) continue;
        if (!terrainOK(x, z, { r, slope: 0.5, types: ['grass', 'sand'], ...opts })) continue;
        place(x, z, s);
        placed++;
      }
      return placed;
    };
    // big ones on the plateau, big ones along the shore, then mixed on the meadow
    let n = 0;
    n += tryPlace(4, [1.7, 2.5], () => {
      const a = rng() * Math.PI * 2, rr = Math.sqrt(rng()) * (PLATEAU.radius - 6);
      return [PLATEAU.x + Math.cos(a) * rr, PLATEAU.z + Math.sin(a) * rr];
    }, { minH: 3.0, types: ['grass'], slope: 0.35 });
    n += tryPlace(4, [1.5, 2.3], () => sampleLand(rng), { inland: [1.5, 5.5], types: ['sand'], minH: -0.25, slope: 0.5 });
    n += tryPlace(12, [0.55, 1.5], () => sampleLand(rng), { inland: [4, 60], slope: 0.45 });
    stats.rocks = n;
  }

  // =========================================================================================
  // Trees (green + cherry blossom), grouped in groves
  // =========================================================================================
  {
    const rng = mulberry32(WORLD_SEED + 41);
    const greenV = [], cherryV = [];
    for (let i = 0; i < 5; i++) greenV.push(buildTreeVariant('green', rng));
    for (let i = 0; i < 4; i++) cherryV.push(buildTreeVariant('cherry', rng));

    const groveSpecs = [
      { c: [-16, 12], bias: 0.15 },   // west of the spawn (visible from the start)
      { c: [16, 24], bias: 0.8 },     // south-east: cherry grove
      { c: [30, -8], bias: 0.15 },
      { c: [-30, 2], bias: 0.7 },
      { c: [12, -30], bias: 0.5 },
      { c: [-14, -30], bias: 0.5 },   // plateau top
    ];
    const groves = [];
    for (const g of groveSpecs) {
      // nudge the grove centre onto valid ground if the hint lands somewhere bad
      let c = g.c;
      for (let i = 0; i < 400; i++) {
        if (terrainOK(c[0], c[1], { r: 1.5, types: ['grass'] })) break;
        const a = rng() * Math.PI * 2, d = 2 + rng() * 10;
        c = [g.c[0] + Math.cos(a) * d, g.c[1] + Math.sin(a) * d];
      }
      groves.push({ c, bias: g.bias });
    }

    const placeTree = (x, z, cherry) => {
      const v = pick(rng, cherry ? cherryV : greenV);
      // Keep the original seeded tint draw: removing it would reshuffle all subsequent tree placements.
      pick(rng, cherry ? PINK_TINTS : GREEN_TINTS);
      const mesh = new THREE.Mesh(v.geo, autumnTreeMaterial(x, z));
      mesh.castShadow = true; mesh.receiveShadow = false;
      // Overlapping toon foliage already has baked shade colors; suppress noisy self-shadow acne.
      // It still casts the same moving silhouette onto the terrain.
      outline(mesh, v.outlineGeo, 0.06);
      const g = new THREE.Group();
      g.name = cherry ? 'cherry-tree' : 'tree';
      g.add(mesh);
      const s = range(rng, 0.85, 1.25);
      g.scale.set(s, s * range(rng, 0.95, 1.1), s);
      g.rotation.y = rng() * Math.PI * 2;
      const y = groundY(x, z, 0.5 * s) - 0.05;
      g.position.set(x, y, z);
      group.add(g);
      const tr = 0.5 * s;
      claim(x, z, 1.55 * s, tr);
      addCollider({ x, z, r: tr, owner: g });
      const item = addInteractable({ type: 'tree', object: g, position: new THREE.Vector3(x, y, z), radius: tr, prompt: 'Shake' });
      g.userData.interactable = item;
      g.userData.cherry = cherry;
      g.userData.canopy = mesh;
      handles.trees.push(g);
    };

    let placed = 0;
    const total = 35;
    for (let tries = 0; tries < 6000 && placed < total; tries++) {
      let x, z, cherry;
      if (placed < 27) {
        const gr = groves[placed % groves.length];
        x = gr.c[0] + gauss(rng) * 6.5; z = gr.c[1] + gauss(rng) * 6.5;
        cherry = rng() < gr.bias;
      } else {
        [x, z] = sampleLand(rng);
        cherry = rng() < 0.35;
      }
      const s = 1.4;
      // keep the spawn plaza (and the patch of ground the fixed camera looks through) free of tall canopies
      if (Math.hypot(x - SPAWN.x, z - SPAWN.z) < 9) continue;
      if (z > SPAWN.z - 3 && z < SPAWN.z + 22 && Math.abs(x - SPAWN.x) < 6.5) continue;
      if (!freeAt(x, z, s, 0.9)) continue;
      if (!terrainOK(x, z, { r: s, types: ['grass'], slope: 0.3, inland: [11.5, 80] })) continue;
      placeTree(x, z, cherry);
      placed++;
    }
    stats.trees = placed;
  }

  // =========================================================================================
  // Palms on the beach
  // =========================================================================================
  {
    const rng = mulberry32(WORLD_SEED + 51);
    const variants = [];
    for (let i = 0; i < 3; i++) variants.push(buildPalmVariant(rng));
    let placed = 0;
    for (let k = 0; k < 8; k++) {
      const a0 = (k / 8) * Math.PI * 2 + range(rng, -0.2, 0.2);
      for (let tries = 0; tries < 900; tries++) {
        const a = a0 + range(rng, -0.4, 0.4), rr = range(rng, 28, 56);
        const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
        if (!freeAt(x, z, 1.6, 2.0)) continue;
        if (!terrainOK(x, z, { r: 1.0, types: ['sand'], slope: 0.3, inland: [2.2, 8.5], minH: 0.2 })) continue;
        // lean out towards the sea (downhill of the inland-distance field)
        const e = 1;
        const gx = inlandDistance(x + e, z) - inlandDistance(x - e, z), gz = inlandDistance(x, z + e) - inlandDistance(x, z - e);
        let lx = -gx, lz = -gz;
        const ll = Math.hypot(lx, lz) || 1;
        lx /= ll; lz /= ll;
        const v = pick(rng, variants);
        const mesh = new THREE.Mesh(v.geo, PLAIN);
        mesh.castShadow = true; mesh.receiveShadow = false;
      // Overlapping toon foliage already has baked shade colors; suppress noisy self-shadow acne.
      // It still casts the same moving silhouette onto the terrain.
        outline(mesh, v.outlineGeo, 0.055);
        const g = new THREE.Group();
        g.name = 'palm';
        g.add(mesh);
        const s = range(rng, 1.05, 1.35);
        g.scale.setScalar(s);
        g.rotation.y = Math.atan2(-lz, lx) + range(rng, -0.35, 0.35);
        const y = groundY(x, z, 0.4);
        g.position.set(x, y, z);
        group.add(g);
        claim(x, z, 1.6, 0.5);
        addCollider({ x, z, r: 0.42 * s, owner: g });
        const item = addInteractable({ type: 'palm', object: g, position: new THREE.Vector3(x, y, z), radius: 0.42 * s, prompt: 'Shake' });
        g.userData.interactable = item;
        g.userData.canopy = mesh;
        g.userData.topLocal = v.top;   // crown position in the group's local space (coconuts / fronds)
        handles.palms.push(g);
        placed++;
        break;
      }
    }
    stats.palms = placed;
  }

  // =========================================================================================
  // Bushes
  // =========================================================================================
  {
    const rng = mulberry32(WORLD_SEED + 61);
    // 7 of the first 18 bushes are berry bushes (deterministic, spread through the placement order): gathering.js makes them harvestable
    const berryV = [buildBushVariant(rng, 'berry'), buildBushVariant(rng, 'berry'), buildBushVariant(rng, 'berry')];
    const otherV = [null, null, null, 'pink', 'yellow', null].map((k) => buildBushVariant(rng, k));
    const berryIdx = new Set([1, 3, 6, 9, 12, 14, 17]);
    let placed = 0;
    const treePos = handles.trees.map((t) => t.position);
    for (let tries = 0; tries < 6000 && placed < 25; tries++) {
      let x, z;
      if (rng() < 0.5 && treePos.length) {
        const t = pick(rng, treePos);
        const a = rng() * Math.PI * 2, d = range(rng, 2.4, 4.2);
        x = t.x + Math.cos(a) * d; z = t.z + Math.sin(a) * d;
      } else [x, z] = sampleLand(rng);
      const s = range(rng, 0.8, 1.25);
      const r = 1.0 * s;
      if (!freeAt(x, z, r, 0.5)) continue;
      if (!terrainOK(x, z, { r: r * 0.9, types: ['grass'], slope: 0.35, inland: [10.8, 80] })) continue;
      const berry = berryIdx.has(placed);
      const v = pick(rng, berry ? berryV : otherV);
      const mesh = new THREE.Mesh(v.geo, pick(rng, GREEN_TINTS));
      mesh.castShadow = true; mesh.receiveShadow = false;
      // Overlapping toon foliage already has baked shade colors; suppress noisy self-shadow acne.
      // It still casts the same moving silhouette onto the terrain.
      outline(mesh, v.outlineGeo, 0.05);
      const g = new THREE.Group();
      g.name = berry ? 'berry-bush' : 'bush';
      if (v.berryGeo) {
        const bm = new THREE.Mesh(v.berryGeo, PLAIN);      // child of the bush mesh, so rustling shakes the berries too
        bm.name = 'berries';
        bm.castShadow = false; bm.receiveShadow = false;
        mesh.add(bm);
        g.userData.berries = bm;
      }
      g.add(mesh);
      g.scale.set(s, s * range(rng, 0.92, 1.1), s);
      g.rotation.y = rng() * Math.PI * 2;
      const y = groundY(x, z, 0.7 * s) - 0.04;
      g.position.set(x, y, z);
      group.add(g);
      const cr = 0.82 * s;
      claim(x, z, r, cr);
      addCollider({ x, z, r: cr, owner: g });
      const item = addInteractable({ type: 'bush', object: g, position: new THREE.Vector3(x, y, z), radius: cr, prompt: 'Rustle' });
      g.userData.interactable = item;
      handles.bushes.push(g);
      placed++;
    }
    stats.bushes = placed;
    stats.berryBushes = handles.bushes.filter((b) => b.userData.berries).length;
  }

  // =========================================================================================
  // Fallen log (near a tree, three-ish colliders along its length)
  // =========================================================================================
  {
    const rng = mulberry32(WORLD_SEED + 71);
    const parts = [];
    const bark = '#8b5a3c', ring = '#e9c48f', ring2 = '#c98d5a';
    const L = 3.3, R = 0.46;
    parts.push(part(new THREE.CylinderGeometry(R, R * 1.04, L, 10, 1, true), bark, { r: [0, 0, HALF_PI] }));
    for (const sgn of [-1, 1]) {
      parts.push(part(new THREE.CircleGeometry(R * 0.98, 12), ring, { p: [sgn * (L / 2 + 0.005), 0, 0], r: [0, sgn * HALF_PI, 0] }));
      parts.push(part(new THREE.RingGeometry(R * 0.28, R * 0.52, 12), ring2, { p: [sgn * (L / 2 + 0.02), 0, 0], r: [0, sgn * HALF_PI, 0] }));
    }
    parts.push(part(G.ico1, bark, { p: [-0.5, 0.3, 0.42], r: [0.6, 0, 0], s: [0.2, 0.34, 0.2] }));
    parts.push(part(G.ico2, '#6fd06e', { p: [0.35, R * 0.75, 0.05], s: [0.62, 0.17, 0.3] }));
    parts.push(part(G.ico2, '#8fe36b', { p: [0.7, R * 0.78, -0.08], s: [0.32, 0.12, 0.2] }));
    const geo = combine(parts);
    const mesh = new THREE.Mesh(geo, PLAIN);
    mesh.castShadow = true; mesh.receiveShadow = true;
    outline(mesh, smoothOutlineGeo(geo), 0.045);
    const g = new THREE.Group();
    g.name = 'fallen-log';
    g.add(mesh);
    const anchors = handles.trees.length ? handles.trees : [];
    for (let tries = 0; tries < 3000; tries++) {
      let x, z;
      if (anchors.length && tries < 2000) {
        const t = pick(rng, anchors).position;
        const a = rng() * Math.PI * 2, d = range(rng, 3.2, 5);
        x = t.x + Math.cos(a) * d; z = t.z + Math.sin(a) * d;
      } else [x, z] = sampleLand(rng);
      const ang = rng() * Math.PI;
      const dx = Math.cos(ang), dz = Math.sin(ang);
      if (!freeAt(x, z, 1.9, 0.3)) continue;
      const okAll = [-1.5, -0.5, 0.5, 1.5].every((o) => terrainOK(x + dx * o, z + dz * o, { r: 0.6, types: ['grass'], slope: 0.3, inland: [11, 80] }));
      if (!okAll) continue;
      const y = Math.max(getHeight(x - dx * 1.5, z - dz * 1.5), getHeight(x + dx * 1.5, z + dz * 1.5), getHeight(x, z)) + R * 0.72;
      g.position.set(x, y, z);
      g.rotation.y = -ang;
      group.add(g);
      claim(x, z, 1.9, 0.3);
      for (const o of [-1.25, -0.4, 0.45, 1.3]) addCollider({ x: x + dx * o, z: z + dz * o, r: 0.55, owner: g });
      solid.push({ x: x + dx * 1.3, z: z + dz * 1.3, r: 0.55 }, { x: x - dx * 1.3, z: z - dz * 1.3, r: 0.55 });
      handles.log = g;
      break;
    }
    stats.log = !!handles.log;
  }

  // =========================================================================================
  // Mushrooms (a few small clusters near tree bases)
  // =========================================================================================
  {
    const rng = mulberry32(WORLD_SEED + 81);
    let clusters = 0;
    const trees = handles.trees.slice().sort(() => rng() - 0.5);
    for (const t of trees) {
      if (clusters >= 3) break;
      for (let tries = 0; tries < 40; tries++) {
        const a = rng() * Math.PI * 2, d = range(rng, 3.0, 4.2);   // just outside the canopy so they're visible
        const cx = t.position.x + Math.cos(a) * d, cz = t.position.z + Math.sin(a) * d;
        if (!clearOfSolid(cx, cz, 0.6, 0.15)) continue;
        if (!terrainOK(cx, cz, { r: 0.5, types: ['grass'], slope: 0.35, inland: [11, 80] })) continue;
        const cy = getHeight(cx, cz);
        const items = [];
        const n = rangeInt(rng, 2, 4);
        for (let i = 0; i < n; i++) {
          const aa = rng() * Math.PI * 2, dd = i === 0 ? 0 : range(rng, 0.28, 0.6);
          const px = Math.cos(aa) * dd, pz = Math.sin(aa) * dd;
          items.push({ p: [px, getHeight(cx + px, cz + pz) - cy - 0.03, pz], s: i === 0 ? range(rng, 1.1, 1.5) : range(rng, 0.7, 1.05), rot: rng() * 6 });
        }
        const mc = buildMushroomCluster(items);
        const glowMat = PLAIN.clone();
        glowMat.emissive = new THREE.Color('#94d8b0');
        glowMat.emissiveIntensity = 0;
        const mesh = new THREE.Mesh(mc.geo, glowMat);
        mesh.castShadow = false; mesh.receiveShadow = true;   // tiny: not worth a shadow-pass draw call
        outline(mesh, mc.outlineGeo, 0.03);
        mesh.position.set(cx, cy, cz);
        mesh.name = 'mushrooms';
        group.add(mesh);
        occ.push({ x: cx, z: cz, r: 0.7 });
        solid.push({ x: cx, z: cz, r: 0.6 });
        handles.mushrooms.push(mesh);
        clusters++;
        break;
      }
    }
    stats.mushroomClusters = clusters;
  }

  // =========================================================================================
  // Herbs (~12 instanced leafy clumps on the meadow; picked + regrown by gathering.js)
  // =========================================================================================
  {
    const rng = mulberry32(WORLD_SEED + 121);
    const HERBS = 12;
    const list = [];
    const okHerb = (x, z) => {
      if (!freeAt(x, z, 0.5, 0.35)) return false;
      if (!clearOfSolid(x, z, 0.45, 0.5)) return false;
      for (const h of list) { const dx = x - h.x, dz = z - h.z; if (dx * dx + dz * dz < 36) return false; }     // spread out (>= 6u apart)
      return terrainOK(x, z, { r: 0.5, types: ['grass'], slope: 0.32, inland: [11, 80] });
    };
    for (let tries = 0; tries < 6000 && list.length < HERBS; tries++) {
      let x, z;
      if (list.length < 4) {                     // a few near the spawn so the first minutes show what they are
        const a = rng() * Math.PI * 2, d = range(rng, 7, 20);
        x = SPAWN.x + Math.cos(a) * d; z = SPAWN.z + Math.sin(a) * d;
      } else [x, z] = sampleLand(rng);
      if (!okHerb(x, z)) continue;
      list.push({ x, z, y: getHeight(x, z) - 0.03, rot: rng() * Math.PI * 2, s: range(rng, 1.4, 1.75) });
      occ.push({ x, z, r: 0.6 });
      solid.push({ x, z, r: 0.45 });
    }
    const mesh = new THREE.InstancedMesh(buildHerbGeo(), HERB_MAT, Math.max(1, list.length));
    mesh.name = 'herbs';
    mesh.count = list.length;
    mesh.castShadow = false; mesh.receiveShadow = true;
    const dummy = new THREE.Object3D();
    list.forEach((h, i) => {
      h.index = i;
      dummy.position.set(h.x, h.y, h.z);
      dummy.rotation.set(0, h.rot, 0);
      dummy.scale.setScalar(h.s);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
    handles.herbs = { mesh, list };
    stats.herbs = list.length;
  }

  // =========================================================================================
  // Flowers: instanced, clustered in patches
  // =========================================================================================
  {
    const rng = mulberry32(WORLD_SEED + 91);
    const flowers = [];   // { x, y, z, c, s, rot, tiltX, tiltZ }
    const okFlower = (x, z) => {
      if (Math.hypot(x - SPAWN.x, z - SPAWN.z) < SPAWN_CLEAR) return false;
      if (!clearOfSolid(x, z, 0.2, 0.55)) return false;
      for (const f of flowers) { const dx = x - f.x, dz = z - f.z; if (dx * dx + dz * dz < 0.36) return false; }
      return terrainOK(x, z, { r: 0.1, types: ['grass'], slope: 0.45, ramp: false, spawnPad: 0 });
    };
    const addFlower = (x, z, c) => {
      flowers.push({ x, z, y: getHeight(x, z) - 0.02, c, s: range(rng, 0.95, 1.45), rot: rng() * Math.PI * 2, tx: range(rng, -0.15, 0.15), tz: range(rng, -0.15, 0.15) });
    };
    let patches = 0;
    for (let tries = 0; tries < 4000 && patches < 13; tries++) {
      const [cx, cz] = sampleLand(rng);
      if (!terrainOK(cx, cz, { r: 1.2, types: ['grass'], slope: 0.3, ramp: false })) continue;
      if (!clearOfSolid(cx, cz, 1.0, 0)) continue;
      const main = Math.floor(rng() * 4);
      const n = rangeInt(rng, 8, 13);
      const rad = range(rng, 1.4, 2.4);
      let got = 0;
      for (let k = 0; k < n * 4 && got < n; k++) {
        const a = rng() * Math.PI * 2, d = Math.sqrt(rng()) * rad;
        const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
        if (!okFlower(x, z)) continue;
        addFlower(x, z, rng() < 0.75 ? main : Math.floor(rng() * 4));
        got++;
      }
      if (got >= 4) patches++;
    }
    for (let tries = 0; tries < 2000 && flowers.length < 150; tries++) {
      const [x, z] = sampleLand(rng);
      if (okFlower(x, z)) addFlower(x, z, Math.floor(rng() * 4));
    }

    const meshes = [];
    const dummy = new THREE.Object3D();
    const byColor = FLOWER_COLORS.map(() => []);
    flowers.forEach((f) => byColor[f.c].push(f));
    FLOWER_COLORS.forEach((hex, ci) => {
      const list = byColor[ci];
      const mesh = new THREE.InstancedMesh(buildFlowerGeo(hex), FLOWER_MAT, Math.max(1, list.length));
      mesh.name = 'flowers-' + ci;
      mesh.count = list.length;
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      list.forEach((f, i) => {
        dummy.position.set(f.x, f.y, f.z);
        dummy.rotation.set(f.tx, f.rot, f.tz);
        dummy.scale.setScalar(f.s);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        f.mesh = mesh; f.index = i;
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
      meshes.push(mesh);
    });
    handles.flowers = { meshes, list: flowers };

    // ~20 interactable flowers, spread out
    let ni = 0;
    const picked = [];
    for (let tries = 0; tries < 800 && ni < 20; tries++) {
      const f = pick(rng, flowers);
      if (!f || picked.some((p) => (p.x - f.x) ** 2 + (p.z - f.z) ** 2 < 9)) continue;
      picked.push(f);
      const item = addInteractable({
        type: 'flower', object: null,
        instance: { mesh: f.mesh, index: f.index, position: new THREE.Vector3(f.x, f.y, f.z), scale: f.s, rotY: f.rot, tiltX: f.tx, tiltZ: f.tz },
        position: new THREE.Vector3(f.x, f.y, f.z), radius: 0.2, prompt: 'Smell',
      });
      f.interactable = item;
      ni++;
    }
    stats.flowers = flowers.length;
    stats.flowerInteractables = ni;
  }

  // =========================================================================================
  // Grass tufts (instanced)
  // =========================================================================================
  {
    const rng = mulberry32(WORLD_SEED + 101);
    const geo = buildGrassTuftGeo();
    const N = 300;
    const mesh = new THREE.InstancedMesh(geo, GRASS_MAT, N);
    mesh.name = 'grass-tufts';
    mesh.receiveShadow = true;
    const dummy = new THREE.Object3D();
    const bigProps = solid.filter((o) => o.r > 0.4);
    let count = 0;
    for (let tries = 0; tries < 6000 && count < N; tries++) {
      let x, z;
      if (rng() < 0.4 && bigProps.length) {
        const o = pick(rng, bigProps);
        const a = rng() * Math.PI * 2, d = o.r + range(rng, 0.1, 0.9);
        x = o.x + Math.cos(a) * d; z = o.z + Math.sin(a) * d;
      } else [x, z] = sampleLand(rng);
      if (!clearOfSolid(x, z, 0.15, 0.05)) continue;
      if (!terrainOK(x, z, { r: 0.1, types: ['grass'], slope: 0.5, ramp: false, spawnPad: 0 })) continue;
      const s = range(rng, 0.85, 1.6);
      dummy.position.set(x, getHeight(x, z) - 0.03, z);
      dummy.rotation.set(0, rng() * Math.PI * 2, 0);
      // Keep the exact seeded draw count/order; proportions use an independent position hash.
      const height = range(rng, 0.85, 1.2), shape = grassShapeAt(x, z);
      dummy.scale.set(s * shape.width, s * height * shape.height, s * shape.depth);
      dummy.updateMatrix();
      mesh.setMatrixAt(count++, dummy.matrix);
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
    stats.grassTufts = count;
  }

  // =========================================================================================
  // Pond: lily pads (+ a few lotus blossoms) and reeds around the rim
  // =========================================================================================
  {
    const rng = mulberry32(WORLD_SEED + 111);
    const parts = [];
    const pad = new THREE.CircleGeometry(1, 16, 0.4, Math.PI * 2 - 0.55);
    pad.rotateX(-HALF_PI);
    const padPos = [];
    for (let tries = 0; tries < 800 && padPos.length < 9; tries++) {
      const a = rng() * Math.PI * 2, d = Math.sqrt(rng());
      const x = POND.x + Math.cos(a) * d * (POND.rx + 1.5), z = POND.z + Math.sin(a) * d * (POND.rz + 1.2);
      const s = range(rng, 0.5, 0.8);
      if (getHeight(x, z) > -0.3 || getHeight(x + s, z) > -0.15 || getHeight(x - s, z) > -0.15 || getHeight(x, z + s) > -0.15 || getHeight(x, z - s) > -0.15) continue;
      if (streamDistance(x, z) < 2.2) continue;
      if (padPos.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < (p.s + s + 0.15) ** 2)) continue;
      padPos.push({ x, z, s });
    }
    const y0 = WATER_LEVEL + 0.13;
    padPos.forEach((p, i) => {
      parts.push(part(pad, i % 3 === 0 ? '#5fd07a' : '#43b866', { p: [p.x, y0, p.z], r: [0, rng() * Math.PI * 2, 0], s: [p.s, 1, p.s] }));
      parts.push(part(pad, '#2f9a55', { p: [p.x, y0 - 0.02, p.z], r: [0, 0, 0], s: [p.s * 1.04, 1, p.s * 1.04] }));
      if (i % 3 === 1) {
        // little lotus blossom
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2;
          parts.push(part(G.sphereLo, '#ffb3d1', { p: [p.x + Math.cos(a) * 0.14, y0 + 0.1, p.z - Math.sin(a) * 0.14], r: [0, a, -0.5], s: [0.17, 0.08, 0.09] }));
        }
        parts.push(part(G.sphereLo, '#ffe066', { p: [p.x, y0 + 0.09, p.z], s: [0.1, 0.08, 0.1] }));
      }
    });
    if (parts.length) {
      const mesh = new THREE.Mesh(combine(parts), PLAIN);
      mesh.name = 'lily-pads';
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    pad.dispose();
    stats.lilyPads = padPos.length;

    // reeds
    const rparts = [];
    const cone = new THREE.ConeGeometry(0.075, 1, 5, 1);
    let clusters = 0;
    for (let tries = 0; tries < 3000 && clusters < 9; tries++) {
      const a = rng() * Math.PI * 2, d = range(rng, 3.5, 9);
      const cx = POND.x + Math.cos(a) * d * 1.2, cz = POND.z + Math.sin(a) * d;
      const h = getHeight(cx, cz);
      if (h < -0.3 || h > 0.45) continue;
      if (Math.hypot(cx - SPAWN.x, cz - SPAWN.z) < SPAWN_CLEAR) continue;
      if (!clearOfSolid(cx, cz, 0.5, 0.2)) continue;
      if (!freeAt(cx, cz, 0.8, 0.0)) continue;
      const n = rangeInt(rng, 4, 7);
      for (let i = 0; i < n; i++) {
        const px = cx + range(rng, -0.55, 0.55), pz = cz + range(rng, -0.55, 0.55);
        const hh = range(rng, 1.1, 1.9);
        const lx = range(rng, -0.18, 0.18), lz = range(rng, -0.18, 0.18);
        const py = Math.max(getHeight(px, pz), -0.25) - 0.1;
        const c1 = new THREE.Color('#4fb85a'), c2 = new THREE.Color('#9be27a');
        rparts.push(partFn(cone, (c, x, y) => { c.copy(c1).lerp(c2, Math.min(1, Math.max(0, y / hh))); }, {
          p: [px, py + hh * 0.5, pz], r: [lz, 0, -lx], s: [1, hh, 1],
        }));
        if (rng() < 0.4) {
          rparts.push(part(G.sphereLo, '#8a5a3a', { p: [px - lx * hh * 0.5 * 0.9, py + hh * 0.86, pz + lz * hh * 0.5 * 0.9], s: [0.075, 0.24, 0.075] }));
        }
      }
      occ.push({ x: cx, z: cz, r: 0.8 });
      clusters++;
    }
    if (rparts.length) {
      const mesh = new THREE.Mesh(combine(rparts), PLAIN);
      mesh.name = 'reeds';
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      group.add(mesh);
    }
    cone.dispose();
    stats.reedClusters = clusters;
  }

  group.traverse((o) => { if (o.isMesh) o.matrixAutoUpdate = true; });
  // Ambient wind: trees / palms tilt a hair about their base. Interaction shakes rotate the child mesh, so the two compose.
  const wobblers = [
    ...handles.trees.map((g) => ({ g, amp: 0.02, ph: g.position.x * 0.21 + g.position.z * 0.17 })),
    ...handles.palms.map((g) => ({ g, amp: 0.032, ph: g.position.x * 0.19 + g.position.z * 0.23 })),
  ];

  const wobbleOff = new Set();   // groups whose rotation is driven by something else (felled / falling trees)

  return {
    group,
    handles,
    stats,
    /** Enable / disable the ambient wind tilt of a tree or palm group (harvest.js takes over its rotation while felling). */
    setWobble(g, on) { if (on) wobbleOff.delete(g); else wobbleOff.add(g); },
    /**
     * Is (x, z) a good place for a small ground feature of footprint r (dig spot ...)? Meadow grass, not steep, clear of water, the spawn
     * plaza, the plateau ramps, every prop / collider (incl. stumps) and the flowers. Used at runtime by gathering.js.
     */
    spotOk(x, z, r = 0.6) {
      if (!terrainOK(x, z, { r, types: ['grass'], slope: 0.3, inland: [11, 80] })) return false;
      if (!freeAt(x, z, r, 0.25) || !clearOfSolid(x, z, r, 0.4) || overlapsAny(x, z, r + 0.4)) return false;
      const fl = handles.flowers && handles.flowers.list;
      if (fl) for (const f of fl) { const dx = x - f.x, dz = z - f.z; if (dx * dx + dz * dz < (r + 0.35) * (r + 0.35)) return false; }
      return true;
    },
    update(t) {
      windTime.value = t;
      for (let i = 0; i < wobblers.length; i++) {
        if (wobbleOff.size && wobbleOff.has(wobblers[i].g)) continue;
        wobbleGroup(wobblers[i].g, t, wobblers[i].amp, wobblers[i].ph);
      }
    },
  };
}

// Shared, lazily built home pieces for pocket scenery. Borrowed geometries: callers clone,
// never dispose these caches. No island placement or material is changed.
const partyHomeCache = new Map();
export function getHomeAsset(kind) {
  if (!partyHomeCache.has(kind)) {
    const rng = mulberry32(8200);
    const geo = kind === 'oak' ? buildTreeVariant('oak', rng).geo
      : kind === 'bush' ? buildBushVariant(rng, null).geo
      : kind === 'grass' ? buildGrassTuftGeo()
      : buildFlowerGeo(({ flowerPink: '#ff8fbe', flowerYellow: '#ffda57', flowerPurple: '#b59bff' })[kind] || '#fff6ee');
    partyHomeCache.set(kind, geo);
  }
  return partyHomeCache.get(kind);
}
