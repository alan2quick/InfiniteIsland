// Duskcrown Isle's layout (Step 69a): the pure, deterministic PLAN of the island. No three.js, no height maths: islands/duskcrown.js turns it into terrain.
// Everything is island-LOCAL (x east, z south, origin = the centre of the 330 x 220 u coast frame); the height module adds island.x / island.z.
//
// Layout "B, horseshoe" (the user's choice, PLAN Step 69):
//   * the COAST is an ellipse (half axes FRAME.a x FRAME.b) bent by designed lobes / bays (FEATURES) and a seeded low-frequency wobble: coastT(lx, lz) is the distance
//     INLAND from the coastline (positive on land), the same quantity the other islands call `inland`;
//   * the CLIFF line runs west to east a little north of the middle, turns SOUTH at about x +80 and runs down as the east ARM to z +75: everything north of it and east of the arm is the
//     Crownlands plateau (a sheer wall, no way up; `NOTCH` only reserves the place of the future path). cliffC(lx, lz) is the signed distance to that line (positive on the plateau side);
//   * the LAGOON is a large shallow lake (about 50 x 60 u) held between the arm and the marsh; like home's pond it has a walkable rim and an unwalkable middle, nothing blocks it;
//   * three thin WATERFALLS fall from the north cliff; each starts a shallow stream (a walkable wading channel, about 2.6 u wide) that strings a chain of ponds southward;
//   * PONDS: 25-40 of them, radius 3-12 u, never overlapping, each with a stable id, a centre, a radius and a depth (fishing will use them);
//   * the LANDING is on the middle of the south coast, a sandy beach facing the sea.
//
//   const L = createDuskLayout(island)
//   L.coastT(lx, lz)      distance inland (before the mesh-edge cap, which the height module applies)
//   L.cliffC(lx, lz)      signed distance to the cliff line (> 0 plateau side), bilinear from a 2 u grid
//   L.cliffZAt(x)         z of the north cliff line at x (x < 70)
//   L.lagoon              { x, z, rx, rz, depth }                 L.ponds [{ id, x, z, r, depth, chain }]    L.streams [{ id, pts }]
//   L.pondsNear(lx, lz) / L.segsNear(lx, lz)   the buckets the height function reads (a few entries each)
//   L.landing {x, z}      the beach spot the party arrives at      L.notch {x, z}   the reserved way up (not built)      L.falls [{ id, x, z }]
//   L.frame (the coast frame half axes), L.bounds { halfX, halfZ } (the mesh rectangle), L.hash() a short digest of the plan (determinism tests)
import { createNoise2D } from '../../utils/noise.js';
import { mulberry32 } from '../../utils/rng.js';
import { meshExtent } from './extent.js';

export const FRAME = { a: 158, b: 104 };
export const PLATEAU_TOP = 46;          // the Crownlands' flat top (the marsh is 0.6 .. 2.5 above the sea)
export const CLIFF_W = 3.4;             // plan width of the sheer wall
export const RIM_H = 0.42;              // the mud shelf round every pond / stream / the lagoon
export const WADE_H = -0.28;            // the wading floor (walkable: > -0.35)

/** Designed lobes (amp > 0) and bays (amp < 0) added to the distance inland: gaussian bumps of radius r (island-local). */
const FEATURES = [
  { x: -146, z: 38, r: 44, amp: 15 },      // the far west: a low wet lobe
  { x: 124, z: 74, r: 40, amp: 14 },       // the south-east corner, south of the arm
  { x: -15, z: 114, r: 26, amp: -9 },      // the landing cove
  { x: -92, z: 88, r: 28, amp: -10 },      // south-west bay
  { x: 66, z: 104, r: 28, amp: -8 },       // south-east bay
  { x: -70, z: -106, r: 30, amp: -11 },    // north coast bays (sea cliffs)
  { x: 82, z: -96, r: 28, amp: -10 },
  { x: 164, z: 6, r: 30, amp: -11 },       // east bay, below the arm's cliffs
  { x: 156, z: -56, r: 26, amp: 8 },       // a north-east shoulder
  { x: -20, z: -112, r: 34, amp: 6 },
];

/** The cliff line: west to east along the north cliff, down the east arm, then east along the arm's south end. Smoothed and roughened by cliffPolyline(). */
const CLIFF_CTRL = [
  [-240, -2], [-186, -6], [-150, 1], [-118, -10], [-88, -2], [-58, 7], [-30, -4], [0, -9], [28, 1], [55, -7], [76, -6],
  [86, 8], [80, 24], [85, 42], [80, 58], [84, 71],
  [97, 78], [122, 72], [152, 79], [240, 76],
];
/** Where the three waterfalls fall (x on the north cliff) and the streams they start; `ponds` = how many chain ponds are strung along it. */
const FALLS = [
  { id: 'west', x: -96, pts: [[-100, 22], [-91, 42], [-99, 59], [-90, 71]], ponds: 4 },
  { id: 'mid', x: -30, pts: [[-35, 24], [-23, 44], [-31, 58], [-24, 68]], ponds: 4 },
  { id: 'east', x: 9, pts: [[8, 18], [12, 32], [22, 43]], ponds: 1 },
];
export const LAGOON = { x: 44, z: 44, rx: 24, rz: 30, depth: 0.95 };
const NOTCH = { x: -58, z: 7 };         // the reserved way up (a future notch in the north cliff; sheer today)
const LANDING_X = -15;
const POND_TARGET = 32;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

/** Catmull-Rom through the control points, resampled every ~`step` u, then roughened sideways with two octaves of noise (buttresses and alcoves). */
export function smoothLine(ctrl, noise, step, amp, wl) {
  const P = (i) => ctrl[Math.max(0, Math.min(ctrl.length - 1, i))];
  const out = [];
  for (let i = 0; i < ctrl.length - 1; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const n = Math.max(1, Math.round(len / step));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push([...ctrl[ctrl.length - 1]]);
  if (!amp) return out;
  let s = 0;
  return out.map((p, i) => {
    if (i) s += Math.hypot(p[0] - out[i - 1][0], p[1] - out[i - 1][1]);
    const a = out[Math.max(0, i - 1)], b = out[Math.min(out.length - 1, i + 1)];
    const tx = b[0] - a[0], tz = b[1] - a[1], tl = Math.hypot(tx, tz) || 1;
    const off = amp * noise(s / wl, 0.5) + amp * 0.4 * noise(s / (wl * 0.33), 7.5);
    return [p[0] - (tz / tl) * off, p[1] + (tx / tl) * off];
  });
}

function segDist2(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  const u = l2 > 0 ? clamp01(((px - ax) * dx + (pz - az) * dz) / l2) : 0;
  const qx = ax + dx * u - px, qz = az + dz * u - pz;
  return qx * qx + qz * qz;
}

function pointInPoly(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function createDuskLayout(island) {
  const seed = island.seed;
  const ext = meshExtent(island);
  const nA = createNoise2D(seed + 11), nB = createNoise2D(seed + 13), nLine = createNoise2D(seed + 41), nStream = createNoise2D(seed + 43);
  const rng = mulberry32(seed ^ 0x5eed5);

  // ---- the coast -------------------------------------------------------------------------------------------------------------------------------------------------------
  function coastT(lx, lz) {
    const a = FRAME.a, b = FRAME.b;
    const rho = Math.hypot(lx / a, lz / b);
    const g = Math.hypot(lx / (a * a), lz / (b * b));
    let t = g < 1e-9 ? b : (1 - rho) * rho / g;           // first-order distance to the ellipse
    for (let i = 0; i < FEATURES.length; i++) {
      const f = FEATURES[i], dx = lx - f.x, dz = lz - f.z, d2 = dx * dx + dz * dz, r2 = f.r * f.r;
      if (d2 < 9 * r2) t += f.amp * Math.exp(-d2 / r2);
    }
    return t + 6.5 * nA(lx * 0.011 + 3, lz * 0.011 - 2) + 3.0 * nB(lx * 0.027, lz * 0.027 + 9);
  }

  // ---- the cliff -------------------------------------------------------------------------------------------------------------------------------------------------------
  const cliff = smoothLine(CLIFF_CTRL, nLine, 5, 3.2, 26);
  const poly = cliff.concat([[240, -240], [-240, -240]]);   // the plateau side, closed far beyond the coast
  const CELL = 2;
  const gx0 = -ext.halfX - 4, gz0 = -ext.halfZ - 4;
  const GW = Math.ceil((2 * ext.halfX + 8) / CELL) + 1, GH = Math.ceil((2 * ext.halfZ + 8) / CELL) + 1;
  const grid = new Float32Array(GW * GH);
  for (let j = 0; j < GH; j++) {
    for (let i = 0; i < GW; i++) {
      const x = gx0 + i * CELL, z = gz0 + j * CELL;
      let best = Infinity;
      for (let k = 0; k < cliff.length - 1; k++) {
        const d = segDist2(x, z, cliff[k][0], cliff[k][1], cliff[k + 1][0], cliff[k + 1][1]);
        if (d < best) best = d;
      }
      const d = Math.sqrt(best);
      grid[j * GW + i] = pointInPoly(poly, x, z) ? d : -d;
    }
  }
  function cliffC(lx, lz) {
    const fx = Math.max(0, Math.min(GW - 1.001, (lx - gx0) / CELL)), fz = Math.max(0, Math.min(GH - 1.001, (lz - gz0) / CELL));
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, o = j * GW + i;
    return (grid[o] * (1 - u) + grid[o + 1] * u) * (1 - v) + (grid[o + GW] * (1 - u) + grid[o + GW + 1] * u) * v;
  }
  function cliffZAt(x) {                                     // the north cliff, single-valued for x < 70
    let best = null;
    for (let k = 0; k < cliff.length - 1; k++) {
      const [ax, az] = cliff[k], [bx, bz] = cliff[k + 1];
      if (ax > 70 && bx > 70) break;
      if ((ax <= x && x <= bx) || (bx <= x && x <= ax)) { const u = bx === ax ? 0 : (x - ax) / (bx - ax); best = az + (bz - az) * u; }
    }
    return best;
  }

  // ---- landing ---------------------------------------------------------------------------------------------------------------------------------------------------------
  let landing = { x: LANDING_X, z: 100 };
  for (let z = 40; z < 140; z += 0.25) { if (coastT(LANDING_X, z) < 7.5) { landing = { x: LANDING_X, z: +(z - 0.25).toFixed(2) }; break; } }

  // ---- the lagoon ------------------------------------------------------------------------------------------------------------------------------------------------------
  const lagoon = { ...LAGOON };

  // ---- streams and ponds -----------------------------------------------------------------------------------------------------------------------------------------------
  const streams = [], falls = [], ponds = [];
  const polyLen = (pts) => pts.reduce((s, p, i) => s + (i ? Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);
  const pointAtLen = (pts, s) => {
    for (let i = 1; i < pts.length; i++) {
      const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (s <= l || i === pts.length - 1) { const u = l ? Math.min(1, s / l) : 0; return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * u, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * u]; }
      s -= l;
    }
    return pts[pts.length - 1];
  };
  const pondRadius = () => 3 + 9 * Math.pow(rng(), 1.9);
  const addPond = (x, z, r, chain) => {
    const rr = +r.toFixed(1);
    ponds.push({ id: `dusk-pond-${String(ponds.length + 1).padStart(2, '0')}`, x: +x.toFixed(2), z: +z.toFixed(2), r: rr, depth: +(1.0 + 0.09 * rr).toFixed(2), chain });
  };
  for (const f of FALLS) {
    const z0 = cliffZAt(f.x) + 3;
    const ctrl = [[f.x, z0], ...f.pts];
    const pts = smoothLine(ctrl, nStream, 3, 1.4, 14);
    streams.push({ id: `stream-${f.id}`, pts: pts.map((p) => [+p[0].toFixed(2), +p[1].toFixed(2)]) });
    falls.push({ id: `fall-${f.id}`, x: f.x, z: +(z0 - 3).toFixed(2) });
    const total = polyLen(pts);
    let s = 0, prev = null;                                  // the chain: ponds strung along the stream, each clear of the one before
    for (let k = 0; k < f.ponds; k++) {
      const last = f.id !== 'east' && k === f.ponds - 1, r = last ? 7 + 3.5 * rng() : 4 + 5 * rng();
      s = prev ? s + prev.r + r + 7 : r + 11;
      let p = pointAtLen(pts, s);
      while (prev && s < total && Math.hypot(p[0] - prev.x, p[1] - prev.z) < prev.r + r + 6) { s += 1.5; p = pointAtLen(pts, s); }
      if (s > total + 4) break;                              // the stream is too short for another pond
      addPond(p[0], p[1], r, f.id);
      prev = ponds[ponds.length - 1];
    }
  }
  const chainCount = ponds.length;
  // scattered ponds: rejection sampling over the marsh
  const segNearStreams = (x, z, pad) => streams.some((s) => { for (let k = 0; k < s.pts.length - 1; k++) if (segDist2(x, z, s.pts[k][0], s.pts[k][1], s.pts[k + 1][0], s.pts[k + 1][1]) < pad * pad) return true; return false; });
  const lagoonS = (x, z) => Math.hypot((x - lagoon.x) / lagoon.rx, (z - lagoon.z) / lagoon.rz);
  for (let tries = 0; tries < 12000 && ponds.length < POND_TARGET; tries++) {
    const x = -178 + rng() * 356, z = 6 + rng() * 118, r = pondRadius();
    if (cliffC(x, z) > -(r + 12)) continue;                                 // clear of the cliff foot
    if (coastT(x, z) < r * 1.2 + 10) continue;                             // clear of the coast
    if (lagoonS(x, z) < 1.55 + (r * 1.3) / Math.min(lagoon.rx, lagoon.rz)) continue;
    if (Math.hypot(x - landing.x, z - landing.z) < 26 + r) continue;         // the landing stays open
    if (ponds.some((p) => Math.hypot(x - p.x, z - p.z) < p.r + r + 6)) continue;
    if (segNearStreams(x, z, r + 5)) continue;
    addPond(x, z, r, null);
  }

  // ---- spatial buckets (16 u cells over the mesh rectangle) so height() looks at a handful of ponds / stream segments --------------------------------------------------------
  const BC = 16, BW = Math.ceil((2 * ext.halfX) / BC) + 1, BH = Math.ceil((2 * ext.halfZ) / BC) + 1;
  const bx = (x) => Math.max(0, Math.min(BW - 1, Math.floor((x + ext.halfX) / BC)));
  const bz = (z) => Math.max(0, Math.min(BH - 1, Math.floor((z + ext.halfZ) / BC)));
  const pondBuckets = Array.from({ length: BW * BH }, () => []);
  const segBuckets = Array.from({ length: BW * BH }, () => []);
  const PAD_POND = 1.3 + 0.0, FLAT = 8;
  for (const p of ponds) {
    const reach = p.r * PAD_POND + FLAT + BC * 0.75;
    for (let j = bz(p.z - reach); j <= bz(p.z + reach); j++) for (let i = bx(p.x - reach); i <= bx(p.x + reach); i++) pondBuckets[j * BW + i].push(p);
  }
  const SEG_REACH = 9.0;
  for (const s of streams) {
    for (let k = 0; k < s.pts.length - 1; k++) {
      const seg = [s.pts[k][0], s.pts[k][1], s.pts[k + 1][0], s.pts[k + 1][1]];
      const x0 = Math.min(seg[0], seg[2]) - SEG_REACH, x1 = Math.max(seg[0], seg[2]) + SEG_REACH, z0 = Math.min(seg[1], seg[3]) - SEG_REACH, z1 = Math.max(seg[1], seg[3]) + SEG_REACH;
      for (let j = bz(z0); j <= bz(z1); j++) for (let i = bx(x0); i <= bx(x1); i++) segBuckets[j * BW + i].push(seg);
    }
  }
  const EMPTY = [];
  const inRect = (lx, lz) => Math.abs(lx) <= ext.halfX && Math.abs(lz) <= ext.halfZ;
  const pondsNear = (lx, lz) => (inRect(lx, lz) ? pondBuckets[bz(lz) * BW + bx(lx)] : EMPTY);
  const segsNear = (lx, lz) => (inRect(lx, lz) ? segBuckets[bz(lz) * BW + bx(lx)] : EMPTY);

  function hash() {                                           // a short digest of the whole plan, for determinism tests
    let h = 2166136261 >>> 0;
    const mix = (v) => { const n = Math.round(v * 100); h = Math.imul(h ^ (n & 0xffff), 16777619) >>> 0; h = Math.imul(h ^ (n >> 16), 16777619) >>> 0; };
    for (const p of ponds) { mix(p.x); mix(p.z); mix(p.r); mix(p.depth); }
    for (const s of streams) for (const q of s.pts) { mix(q[0]); mix(q[1]); }
    for (const q of cliff) { mix(q[0]); mix(q[1]); }
    mix(landing.x); mix(landing.z);
    return h.toString(16).padStart(8, '0');
  }

  return {
    island, seed, frame: FRAME, bounds: ext, features: FEATURES, coastT, cliff, cliffC, cliffZAt, lagoon, lagoonS, ponds, chainCount, streams, falls,
    pondsNear, segsNear, landing, notch: { ...NOTCH }, plateauTop: PLATEAU_TOP, hash,
  };
}
