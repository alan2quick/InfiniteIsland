// The Crownlands' floating islands as meshes (Step 85c): the pure, deterministic geometry arrays. No three.js; crownVisuals.js wraps them in BufferGeometry. All in WORLD coordinates.
// Chunky low-poly upside-down cones: a flat grassy top (the height function is the layout's own `topHeight`, so a later travel step walks the same surface), a mossy overhang, a rust-to-lavender
// ragged underside that tapers to a tip, and a few dangling vine strands. The same builder makes the small flying rocks at a smaller scale. No colliders, nothing walkable in this pass.
//
//   const S = buildSkyMeshes(island, crown)   cached per terrain layout
//   S.full  { positions, colors, triangles, hullPositions, hullIndices }   everything (islands + rocks): flat-shaded triangle soup, plus an indexed, welded hull of the rock bodies for the outline
//   S.far   { positions, colors, triangles }   a simplified version for the far view (8 sectors, no vines, no hull)
//   S.hash() / S.summary()
import { mulberry32 } from '../../utils/rng.js';
import { CROWN_WATER } from '../../config.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;
const hex = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const mixC = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const COL = { grass: hex('#79dc5e'), grassHi: hex('#a2e86a'), lip: hex('#4fb454'), lav: hex('#b9a3e8'), moss: hex('#5fbf56'), rust: hex('#c4663a'), rock: hex('#b0684a'), mauve: hex('#a07aa6'), lilac: hex('#9b8ad0'), vine: hex('#4fae5a'), vineHi: hex('#86e07c') };

/** A triangle soup builder: `vert` pools a vertex (the hull shares them), `face` emits a coloured triangle oriented away from `hint`. */
function soupBuilder() {
  const verts = [], pos = [], col = [], hull = [];
  const api = {
    verts, pos, col, hull,
    vert(x, y, z) { verts.push(x, y, z); return verts.length / 3 - 1; },
    face(a, b, c, color, hint, inHull = true) {
      const p = (i) => [verts[i * 3], verts[i * 3 + 1], verts[i * 3 + 2]];
      let pa = p(a), pb = p(b), pc = p(c);
      const n = [(pb[1] - pa[1]) * (pc[2] - pa[2]) - (pb[2] - pa[2]) * (pc[1] - pa[1]), (pb[2] - pa[2]) * (pc[0] - pa[0]) - (pb[0] - pa[0]) * (pc[2] - pa[2]), (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0])];
      if (n[0] * hint[0] + n[1] * hint[1] + n[2] * hint[2] < 0) { [b, c] = [c, b]; [pb, pc] = [pc, pb]; }
      for (const q of [pa, pb, pc]) { pos.push(q[0], q[1], q[2]); col.push(color[0], color[1], color[2]); }
      if (inHull) hull.push(a, b, c);
    },
  };
  return api;
}

/** One floating island (or rock): `er(th)` the top's edge radius, `topY(x, z)` its top height, depth, sectors; returns nothing, it appends to the builder. */
function island(sb, rng, { cx, cz, er, topY, depth, n, topRings, underT, amp, vines, tint }) {
  const th = (k) => (k / n) * Math.PI * 2;
  // the top: a centre fan, then rings out to the edge
  const topV = [];
  const centre = sb.vert(cx, topY(cx, cz), cz);
  for (let j = 0; j < topRings.length; j++) {
    const ring = [];
    for (let k = 0; k < n; k++) {
      const a = th(k), d = topRings[j] * er(a) * (j === topRings.length - 1 ? 0.998 : 1), jit = j === 0 || j === topRings.length - 1 ? 0 : 1 + (rng() - 0.5) * 0.06;
      const x = cx + Math.cos(a) * d * jit, z = cz + Math.sin(a) * d * jit;
      ring.push(sb.vert(x, topY(x, z) ?? topY(cx, cz), z));
    }
    topV.push(ring);
  }
  const up = [0, 1, 0];
  const grassAt = () => { let c = mixC(COL.grass, COL.grassHi, rng() * 0.8); if (tint && rng() < 0.12) c = mixC(c, COL.lav, 0.55); return c; };
  for (let k = 0; k < n; k++) sb.face(centre, topV[0][k], topV[0][(k + 1) % n], grassAt(), up);
  for (let j = 0; j + 1 < topV.length; j++) for (let k = 0; k < n; k++) {
    const k2 = (k + 1) % n, edge = j + 2 === topV.length, c = edge ? mixC(COL.lip, COL.grass, rng() * 0.4) : grassAt();
    sb.face(topV[j][k], topV[j + 1][k], topV[j + 1][k2], c, up);
    sb.face(topV[j][k], topV[j + 1][k2], topV[j][k2], edge ? mixC(COL.lip, COL.grass, rng() * 0.4) : grassAt(), up);
  }
  // the underside: ragged rings that shrink to a tip
  const rimRing = topV[topV.length - 1], ph = [rng() * 6.28, rng() * 6.28, rng() * 6.28, rng() * 6.28, rng() * 6.28];
  const rings = [rimRing];
  const topBase = topY(cx, cz);
  for (let j = 1; j < underT.length - 1; j++) {
    const T = underT[j], ring = [];
    for (let k = 0; k < n; k++) {
      const a = th(k), lobe = 0.6 * Math.sin(3 * a + ph[j]) + 0.4 * Math.sin(7 * a + ph[(j + 2) % 5]);
      const d = er(a) * Math.pow(1 - T, 0.9) * (1 + amp[j] * lobe) * (1 + (rng() - 0.5) * 0.06);
      const y = topBase - 0.4 - (depth - 0.4) * Math.pow(T, 1.12) + (rng() - 0.5) * 0.7 * Math.min(1, depth / 8);
      ring.push(sb.vert(cx + Math.cos(a) * d, y, cz + Math.sin(a) * d));
    }
    rings.push(ring);
  }
  const tip = sb.vert(cx + (rng() - 0.5) * 0.8, topBase - depth, cz + (rng() - 0.5) * 0.8);
  const bandColor = (t) => {
    const c = t < 0.1 ? mixC(COL.moss, COL.rust, t / 0.1) : t < 0.45 ? mixC(COL.rust, COL.rock, (t - 0.1) / 0.35) : t < 0.75 ? mixC(COL.rock, COL.mauve, (t - 0.45) / 0.3) : mixC(COL.mauve, COL.lilac, (t - 0.75) / 0.25);
    const g = 0.93 + rng() * 0.14;
    return [clamp01(c[0] * g), clamp01(c[1] * g), clamp01(c[2] * g)];
  };
  for (let j = 0; j + 1 < rings.length; j++) for (let k = 0; k < n; k++) {
    const k2 = (k + 1) % n, t = (underT[j] + underT[j + 1]) / 2, hint = [Math.cos(th(k) + Math.PI / n), -0.4, Math.sin(th(k) + Math.PI / n)];
    sb.face(rings[j][k], rings[j + 1][k], rings[j + 1][k2], bandColor(t), hint);
    sb.face(rings[j][k], rings[j + 1][k2], rings[j][k2], bandColor(t), hint);
  }
  const last = rings[rings.length - 1];
  for (let k = 0; k < n; k++) sb.face(last[k], tip, last[(k + 1) % n], bandColor(0.95), [Math.cos(th(k)), -1, Math.sin(th(k))]);
  // vine strands (body only: a hull would swallow them)
  for (let v = 0; v < vines; v++) {
    const a = rng() * Math.PI * 2, T = 0.12 + rng() * 0.22, d = er(a) * (1 - T) * 0.9, len = 4 + rng() * 7, segs = 4;
    let x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d, y = topBase - 0.4 - (depth - 0.4) * Math.pow(T, 1.12) + 0.2;
    const sway = (rng() - 0.5) * 0.9, prev = [];
    for (let s = 0; s <= segs; s++) {
      const f = s / segs, w = lerp(0.16, 0.03, f), cxv = x + sway * f * f * 2, czv = z + sway * 0.6 * f * f * 2, cyv = y - len * f;
      prev.push([sb.vert(cxv + w, cyv, czv), sb.vert(cxv - w * 0.5, cyv, czv + w * 0.87), sb.vert(cxv - w * 0.5, cyv, czv - w * 0.87)]);
    }
    for (let s = 0; s < segs; s++) for (let q = 0; q < 3; q++) {
      const q2 = (q + 1) % 3, c = mixC(COL.vine, COL.vineHi, (s + 1) / segs * 0.8), out = [Math.cos(a + q * 2.09), 0, Math.sin(a + q * 2.09)];
      sb.face(prev[s][q], prev[s + 1][q], prev[s + 1][q2], c, out, false);
      sb.face(prev[s][q], prev[s + 1][q2], prev[s][q2], c, out, false);
    }
  }
}

const cache = new WeakMap();
export function buildSkyMeshes(isl, crown) {
  if (cache.has(crown)) return cache.get(crown);
  const ix = isl.x, iz = isl.z, cfg = CROWN_WATER.sky;
  function build(lod) {
    const sb = soupBuilder(), far = lod === 'far';
    crown.skyIslands.forEach((s, i) => {
      const rng = mulberry32(isl.seed + 8500 + i);
      const topY = (x, z) => { const y = s.topHeight(x, z); return y === null ? null : y; };
      const shifted = (fn) => (x, z) => { const y = fn(x - ix, z - iz); return y; };
      // (the layout is island-local; the builder works in world coordinates, so the functions are shifted)
      island(sb, rng, {
        cx: ix + s.x, cz: iz + s.z, er: (a) => s.edgeR(a), depth: s.depth, n: far ? cfg.farSectors : cfg.sectors,
        topY: shifted((x, z) => topY(x, z) ?? topY(s.x, s.z)), topRings: far ? [0.5, 1] : [0.32, 0.62, 0.86, 1],
        underT: far ? [0, 0.5, 1] : [0, 0.12, 0.34, 0.6, 0.82, 1], amp: [0, 0.14, 0.2, 0.2, 0.15, 0], vines: far ? 0 : cfg.vines, tint: true,
      });
    });
    crown.skyRocks.forEach((r, i) => {
      const rng = mulberry32(isl.seed + 8600 + i), rr = r.r;
      island(sb, rng, {
        cx: ix + r.x, cz: iz + r.z, er: (a) => rr * (1 + 0.1 * Math.sin(3 * a + i)), depth: rr * 1.3, n: far ? 6 : cfg.rockSectors,
        topY: () => r.y, topRings: far ? [1] : [0.55, 1], underT: far ? [0, 1] : [0, 0.3, 0.65, 1], amp: [0, 0.18, 0.2, 0.2, 0.15, 0], vines: far ? 0 : (rr > 2.4 ? 1 : 0), tint: false,
      });
    });
    return sb;
  }
  const f = build('full'), g = build('far');
  const out = {
    full: { positions: new Float32Array(f.pos), colors: new Float32Array(f.col), triangles: f.pos.length / 9, hullPositions: new Float32Array(f.verts), hullIndices: new Uint32Array(f.hull) },
    far: { positions: new Float32Array(g.pos), colors: new Float32Array(g.col), triangles: g.pos.length / 9 },
    hash() {
      let h = 2166136261 >>> 0;
      const p = f.pos; for (let i = 0; i < p.length; i++) { h = Math.imul(h ^ (Math.round(p[i] * 100) & 0xffff), 16777619) >>> 0; }
      return h.toString(16).padStart(8, '0');
    },
    summary: () => ({ islands: crown.skyIslands.length, rocks: crown.skyRocks.length, triangles: f.pos.length / 9, hullTriangles: f.hull.length / 3, farTriangles: g.pos.length / 9, hash: out.hash() }),
  };
  cache.set(crown, out);
  return out;
}
