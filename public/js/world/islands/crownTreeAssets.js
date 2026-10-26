// Cached merged geometry for the Crownlands' alien acacias and baobabs (Step 85d). Built once per session (never disposed, like duskAssets.js); the shapes come from TREE in crownPlacement.js.
//
//   getCrownTree(variant) -> { geo, outlineGeo, info }     variant = 'acacia-flat' | 'acacia-tiered' | 'acacia-bushy' | 'baobab' | 'baobab-elder'
//     geo          ONE non-indexed geometry: position, normal, color and `aRole` (read by the tree shader in crownTreeVisuals.js, which turns them into the family colours):
//                    aRole 0  trunk, limbs, branches (bark: color.r = the shade multiplier on the instance's bark colour; never fades, never sways)
//                    aRole 1  acacia canopy plates   aRole 2  baobab tuft clusters   (color.r = the rim mix 0 = family top colour .. 1 = family rim colour, color.g = the shade multiplier;
//                                                     both fade, sway and glow at night on their light rims)
//     outlineGeo   the welded, smooth-normal inverted-hull geometry with `aRole` = 1 for hull vertices that belong to a canopy / tuft (dithers out and sways with it), else 0
//   info = { variant, triangles, hullTriangles, top }
//
// Style: acacia = a thin crooked trunk forking into 2-4 limbs under flat, domed, slightly lobed canopy plates (a lighter rim, a dark under-shadow); baobab = a fat bottle trunk with vertical bark
// grooves and a lighter crown-ward gradient, a ring of stubby branches each ending in a small lumpy tuft cluster. The elder baobab is the same shape at 1.5 x with one more branch.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../../utils/rng.js';
import { TREE } from './crownPlacement.js';

const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const withRole = (g, role) => { g.deleteAttribute('uv'); g.setAttribute('aRole', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(role), 1)); return g; };

/** A lobed, domed canopy plate: a lathe whose underside is dark, whose rim edge is the light rim colour and whose top fades from the family top colour (centre) to the rim colour (edge).
 *  R radius, t rim thickness, d dome rise above the rim, y0 the underside rim height; lobes = radial wobble (seeded phase). */
function plate(R, t, d, y0, segs, phi, ox = 0, oz = 0) {
  const u = 0.28 * t, dome = (s) => y0 + t + d * (1 - s * s);
  const prof = [
    [0, y0 + u, 0, 0.5], [0.4, y0 + 0.6 * u, 0, 0.52], [0.8, y0 + 0.12 * u, 0.1, 0.58], [0.97, y0, 0.6, 0.72], [1.0, y0 + t * 0.5, 1, 0.98], [0.96, y0 + t, 1, 1.02],
    [0.82, dome(0.82), 0.85, 1.0], [0.6, dome(0.6), 0.52, 1.0], [0.32, dome(0.32), 0.2, 1.02], [0, dome(0), 0.0, 1.04],
  ];
  const g = new THREE.LatheGeometry(prof.map(([s, y]) => new THREE.Vector2(s * R, y)), segs);
  const P = prof.length, n = g.attributes.position.count, pos = g.attributes.position, col = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) {
    const x = pos.getX(k), z = pos.getZ(k), th = Math.atan2(z, x), f = 1 + 0.1 * Math.sin(3 * th + phi) + 0.055 * Math.sin(5 * th + 2 * phi);
    pos.setXYZ(k, x * f + ox, pos.getY(k), z * f + oz);
    const j = k % P, i = Math.floor(k / P);
    col[k * 3] = prof[j][2]; col[k * 3 + 1] = prof[j][3] * (i % 2 ? 0.97 : 1.0); col[k * 3 + 2] = 1;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return withRole(g.toNonIndexed(), 1);
}

/** A tapered tube along `path` [[x, y, z], ...] with `radii` per point. Bark shade: darker at the foot, fibrous vertical streaks (alternate columns). Open ends (they sit inside trunk / canopy). */
function tube(path, radii, sides, foot = 0.72) {
  const pos = [], col = [], idx = [], T = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), rt = new THREE.Vector3(1, 0, 0);
  const m = path.length;
  for (let i = 0; i < m; i++) {
    const a = path[Math.max(0, i - 1)], b = path[Math.min(m - 1, i + 1)], p = path[i];
    T.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
    N.crossVectors(Math.abs(T.y) < 0.9 ? up : rt, T).normalize(); B.crossVectors(T, N);
    for (let k = 0; k < sides; k++) {
      const th = (k / sides) * Math.PI * 2, c = Math.cos(th), s = Math.sin(th);
      pos.push(p[0] + (N.x * c + B.x * s) * radii[i], p[1] + (N.y * c + B.y * s) * radii[i], p[2] + (N.z * c + B.z * s) * radii[i]);
      const sh = (foot + (1 - foot) * sstep(0, 0.6, i / (m - 1))) * (k % 2 ? 0.88 : 1.0);
      col.push(sh, sh, sh);
    }
  }
  for (let i = 0; i < m - 1; i++) for (let k = 0; k < sides; k++) {
    const a = i * sides + k, b = i * sides + ((k + 1) % sides), c = (i + 1) * sides + k, d = (i + 1) * sides + ((k + 1) % sides);
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return withRole(g.toNonIndexed(), 0);
}

// ---- acacias ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
/** Limbs from the fork to points under the canopy, each with a crooked kink. n limbs spread round the axis from angle a0. */
function limbs(fork, n, a0, reach, topY, r0, rng) {
  const out = [];
  for (let k = 0; k < n; k++) {
    const a = a0 + (k / n) * Math.PI * 2 + (rng() - 0.5) * 0.5, d = reach * (0.75 + 0.5 * rng()), kink = (rng() - 0.5) * 0.9;
    const mid = [fork[0] + Math.cos(a + kink) * d * 0.38, fork[1] + (topY - fork[1]) * 0.45, fork[2] + Math.sin(a + kink) * d * 0.38];
    const end = [fork[0] + Math.cos(a) * d, topY, fork[2] + Math.sin(a) * d];
    out.push(tube([fork, mid, end], [r0, r0 * 0.74, r0 * 0.5], 5, 0.8));
  }
  return out;
}
function buildAcacia(variant) {
  const m = TREE[variant], rng = mulberry32(variant === 'acacia-flat' ? 8801 : variant === 'acacia-tiered' ? 8802 : 8803), parts = [];
  const phi = () => rng() * 6.283;
  if (variant === 'acacia-flat') {
    const fork = [0.25, 3.5, 0.1];
    parts.push(tube([[0, -0.4, 0], [0.1, 1.1, 0.05], [0.3, 2.5, 0.12], fork], [0.7, 0.45, 0.36, 0.32], 7, 0.62));
    parts.push(...limbs(fork, 3, rng() * 6.28, 2.0, 5.85, 0.3, rng));
    parts.push(plate(m.canopyR / 1.1, 0.5, 1.0, m.capUnder, 12, phi()));
  } else if (variant === 'acacia-tiered') {
    const fork = [0.2, 3.0, 0.0];
    parts.push(tube([[0, -0.4, 0], [-0.1, 1.0, 0.1], [0.12, 2.2, 0.05], fork], [0.74, 0.48, 0.38, 0.34], 7, 0.62));
    parts.push(...limbs(fork, 3, rng() * 6.28, 2.1, 4.95, 0.28, rng));
    parts.push(plate(m.canopyR / 1.1, 0.45, 0.55, m.capUnder, 12, phi()));                      // the lower plate (top at 5.5)
    parts.push(tube([fork, [0.1, 4.3, 0.1], [0.35, 5.5, 0.1], [0.45, 6.4, 0.1]], [0.3, 0.27, 0.22, 0.2], 5, 0.8));      // the second, thinner stem up through the lower plate
    parts.push(plate(2.7, 0.4, 1.0, 6.2, 10, phi(), 0.4, 0.1));                            // the upper plate (top at 7.6)
  } else {                                                                                  // the small bushy young tree: a short crooked trunk under a thick, lumpy dome
    const fork = [0.1, 1.7, 0.05];
    parts.push(tube([[0, -0.4, 0], [0.05, 0.8, 0.0], fork], [0.62, 0.4, 0.34], 6, 0.66));
    parts.push(...limbs(fork, 3, rng() * 6.28, 1.4, 3.3, 0.26, rng));
    parts.push(plate(m.canopyR / 1.1, 1.1, 1.6, m.capUnder, 10, phi()));
  }
  return parts;
}

// ---- baobabs ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
/** A lumpy tuft blob (icosahedron detail 1, or 0 for the small side blobs, radial jitter by position hash): role 2, rim mix + shade by how much the facet faces up. */
function tuft(cx, cy, cz, r, sy, seed, detail = 1) {
  const g = new THREE.IcosahedronGeometry(1, detail), pos = g.attributes.position, n = pos.count, col = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) {
    const x = pos.getX(k), y = pos.getY(k), z = pos.getZ(k), h = Math.sin(Math.round(x * 53) * 12.9898 + Math.round(y * 53) * 78.233 + Math.round(z * 53) * 37.719 + seed) * 43758.5453, j = 0.88 + 0.24 * (h - Math.floor(h));
    pos.setXYZ(k, cx + x * r * j, cy + y * r * sy * j, cz + z * r * j);
    col[k * 3] = sstep(-0.15, 0.85, y) * 0.95; col[k * 3 + 1] = 0.6 + 0.4 * sstep(-0.7, 0.5, y); col[k * 3 + 2] = 1;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return withRole(g, 2);
}
function buildBaobab(variant) {
  const m = TREE[variant], elder = variant === 'baobab-elder', k = m.H / 8.5, R = m.trunkR * (elder ? 1.05 : 1.0), H = m.H, rng = mulberry32(elder ? 8811 : 8810), parts = [];
  // the bottle trunk: a flared foot, the belly at a third of the height, a tapering neck and a rounded shoulder; 8 bark grooves
  const prof = [[-0.5, 0.98, 0.7], [0, 0.97, 0.74], [0.12, 1.0, 0.8], [0.3, 1.0, 0.88], [0.5, 0.84, 0.96], [0.68, 0.67, 1.04], [0.78, 0.58, 1.1], [0.84, 0.62, 1.14], [0.875, 0.5, 1.16], [0.89, 0.0, 1.16]].map(([f, rf, sh]) => ({ y: f * H * 0.88, r: rf * R, sh }));
  prof[0].y = -0.5 * k;
  const segs = 24, g = new THREE.LatheGeometry(prof.map((p) => new THREE.Vector2(p.r, p.y)), segs), P = prof.length, n = g.attributes.position.count, pos = g.attributes.position, col = new Float32Array(n * 3);
  for (let v = 0; v < n; v++) {
    const x = pos.getX(v), z = pos.getZ(v), th = Math.atan2(z, x), groove = Math.cos(8 * th), f = 1 + 0.045 * groove + 0.02 * Math.sin(3 * th + 1.3);
    pos.setXYZ(v, x * f, pos.getY(v), z * f);
    const j = v % P, sh = prof[j].sh * (groove < -0.25 ? 0.86 : 1.0);
    col[v * 3] = sh; col[v * 3 + 1] = sh; col[v * 3 + 2] = sh;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  parts.push(withRole(g.toNonIndexed(), 0));
  // the ring of stubby branches, each ending in a tuft cluster; one more in the middle of the crown
  const nb = elder ? 7 : 6, a0 = rng() * 6.28;
  for (let b = 0; b < nb; b++) {
    const a = a0 + (b / nb) * Math.PI * 2 + (rng() - 0.5) * 0.35, ca = Math.cos(a), sa = Math.sin(a), lift = 0.9 + 0.35 * rng();
    const p0 = [ca * 0.3 * R, H * 0.72, sa * 0.3 * R], p1 = [ca * 0.85 * R, H * 0.72 + 0.06 * H * lift, sa * 0.85 * R], p2 = [ca * 1.28 * R, H * 0.72 + 0.12 * H * lift, sa * 1.28 * R];
    parts.push(tube([p0, p1, p2], [0.34 * R, 0.24 * R, 0.16 * R], 6, 0.9));
    const tr = (0.82 + 0.25 * rng()) * k;
    parts.push(tuft(p2[0], p2[1] + 0.35 * k, p2[2], tr, 0.78, b));
    parts.push(tuft(p2[0] + ca * 0.5 * k - sa * 0.55 * k, p2[1] - 0.05 * k, p2[2] + sa * 0.5 * k + ca * 0.55 * k, 0.6 * k, 0.8, b + 20, 0));
    parts.push(tuft(p2[0] + ca * 0.45 * k + sa * 0.6 * k, p2[1] - 0.15 * k, p2[2] + sa * 0.45 * k - ca * 0.6 * k, 0.55 * k, 0.8, b + 40, 0));
  }
  parts.push(tuft(0, H * 0.8, 0, 1.2 * k, 0.75, 77));
  return parts;
}

const q = (x, y, z) => `${Math.round(x * 1000)},${Math.round(y * 1000)},${Math.round(z * 1000)}`;
/** The welded inverted-hull geometry: positions merged, smooth normals; aRole 1 on vertices that belong to a canopy / tuft. */
function outlineOf(geo) {
  const pos = geo.attributes.position, role = geo.attributes.aRole, canopy = new Set(), keep = [];
  for (let i = 0; i < pos.count; i++) { if (role.getX(i) > 0.5) canopy.add(q(pos.getX(i), pos.getY(i), pos.getZ(i))); keep.push(pos.getX(i), pos.getY(i), pos.getZ(i)); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(keep, 3));
  const m = mergeVertices(g, 1e-3);
  m.computeVertexNormals();
  const out = new Float32Array(m.attributes.position.count), mp = m.attributes.position;
  for (let i = 0; i < out.length; i++) out[i] = canopy.has(q(mp.getX(i), mp.getY(i), mp.getZ(i))) ? 1 : 0;
  m.setAttribute('aRole', new THREE.BufferAttribute(out, 1));
  return m;
}

function build(variant) {
  const parts = TREE[variant].type === 'acacia' ? buildAcacia(variant) : buildBaobab(variant);
  for (const p of parts) { if (p.index) throw new Error('indexed tree part'); if (!p.attributes.aRole || !p.attributes.color || !p.attributes.normal) throw new Error('tree part without role / colour / normal'); }
  const geo = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  geo.computeBoundingBox(); geo.computeBoundingSphere();
  const outlineGeo = outlineOf(geo);
  const tri = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;
  return { geo, outlineGeo, info: { variant, triangles: tri(geo), hullTriangles: tri(outlineGeo), top: geo.boundingBox.max.y } };
}

const cache = new Map();
export function getCrownTree(variant) {
  if (!TREE[variant]) throw new Error(`unknown crown tree ${variant}`);
  if (!cache.has(variant)) cache.set(variant, build(variant));
  return cache.get(variant);
}
