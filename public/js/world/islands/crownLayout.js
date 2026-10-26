// The Crownlands' plan (Step 85a): the pure, deterministic layout of the plateau on top of Duskcrown Isle. No three.js. Everything is island-LOCAL (x east, z south), like duskLayout.js,
// which this builds on: the marsh layout, the cliff and the three marsh falls stay exactly as they were, the plateau top (a flat 46 u placeholder in Step 69) now comes from here.
//
//   const C = createCrownLayout(island, duskLayout)          (cached per island seed; use getCrownLayout)
//   C.topAt(lx, lz)       plateau top height (m above the sea): the relief + river beds + plunge pools + kopjes. The height module blends it into the wall with the wall's own weight.
//   C.reliefAt(lx, lz)    just the swells (46 in the rim band, rising to a low northern upland of about 52-54)
//   C.carvedAt / C.kopjeAt   the two layers topAt is made of (kopjeAt = -Infinity off the rocks)
//   C.waterDepth(lx, lz, h) how far a point at height h sits below the plateau water (0 on dry ground); C.waterNear(lx, lz) -> { surf, edge } of the nearest river / pool or null
//   C.groundType(lx, lz, h)  'water' | 'kopje' | 'riverbank' | 'savanna' (plateau interior only)       C.paint(lx, lz, h) -> masks for the ground painter (up, bank, lav, kop, band, wet, deep)
//   C.pools [{ id, x, z, r, depth, surf }]       C.rivers [{ id, kind: 'river' | 'stream' | 'spill', pool, pts: [[x, z]], surf: [y], hw: [u], outlet: { x, z, type: 'fall' | 'sea' | 'join', ... }, length }]
//   C.kopjes [{ id, x, z, r, H, baseY, topY, ramp: null | { a, b, dir, length, steps, hw } }]        C.crownRock (= the biggest kopje)
//   C.skyIslands [{ id, x, z, radius, top, above, depth, underside, groundMax, pools: [{ x, z, r }], spills: [{ id, x, z, y, pool }], topHeight(lx, lz), walkable(lx, lz) }]
//   C.skyRocks [{ id, x, z, y, r }]       C.chains [{ id, from: { kopje }, rocks: [ids], to: islandId, maxGap, maxRise }]   (planned jumping chains; nothing is playable in 85)
//   C.notchTop { x, z }   the plateau side of the reserved way up      C.spawn { x, z }   the crown landing / spawn spot      C.lanes [[x, z]...]   four reserved 4 u walking lanes
//   C.topWeight(lx, lz, y) 0..1: on the plateau top (above ~40 u and on the plateau side of the cliff); the crown weight / lid rule of Step 85b read it
//   C.keepClear(lx, lz, r = 0) -> null | reason       what a later tree / flora step must stay out of
//   C.lidTop(lx, lz)      an upper bound of the plateau (the envelope the cloud lid has to clear: an 8 u lattice of the highest ground within 8 u, bilinear; 0 where there is none)
//   C.hash() / C.summary()   a digest of the whole plan (determinism pins) / the plan's headline numbers
import { createNoise2D, fbm } from '../../utils/noise.js';
import { PLATEAU_TOP, CLIFF_W, smoothLine } from './duskLayout.js';
import { meshExtent } from './extent.js';

export const CROWN = {
  riseFrom: 10, riseTo: 58, rise: 7.8, swell: 2.2,    // the rim band (d < riseFrom) is exactly PLATEAU_TOP; the upland tops out at about 52-54
  bank: 0.05, wade: 0.6, deepBlock: 0.75,             // bank above the water, wading floor below it, deeper than this is not walkable
  skyClear: 40, jumpGap: 5.5, jumpRise: 2.2,          // a floating island's underside is at least this far above the ground below it; the planned jump chain spacing
};
const SEA_LIP = 4.6;                                  // the sea cliff reaches its top at coastT = 4.6 (duskcrown.js sstep(2.0, 4.6, t))

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const r2 = (v) => +v.toFixed(2);

/** Plunge pools: each sits under one floating-island spill point. `r` radius, letters are only for the tables below. */
const POOLS = [
  { k: 'b', x: -72, z: -48, r: 5.5 }, { k: 'c', x: -48, z: -58, r: 5.5 }, { k: 'd', x: -26, z: -56, r: 7.0 },
  { k: 'e', x: 20, z: -52, r: 6.0 }, { k: 'f', x: 52, z: -42, r: 6.0 },
  { k: 'g', x: -40, z: -76, r: 5.5 }, { k: 'h', x: 34, z: -78, r: 5.5 }, { k: 'i', x: 125, z: 14, r: 6.0 },
];
/** Big floating islands: centre, top radius, height of the top above the highest plateau ground under the disc, and the spills (pool letters) they feed. */
const SKY = [
  { id: 'sky-01', x: -72, z: -62, R: 15, above: 78, spills: ['b'], summit: [1] },
  { id: 'sky-02', x: -47, z: -69, R: 13, above: 58, spills: ['c', 'g'], summit: [0.2, 0.16] },
  { id: 'sky-03', x: -22, z: -70, R: 17, above: 84, spills: ['d'], summit: [1, 0.2] },
  { id: 'sky-04', x: 27, z: -66, R: 17, above: 66, spills: ['e', 'h'], summit: [0.2, 0.16] },
  { id: 'sky-05', x: 62, z: -52, R: 16, above: 72, spills: ['f'], summit: [1] },
  { id: 'sky-06', x: 133, z: 3, R: 15, above: 80, spills: ['i'], summit: [1] },
];
/** Kopjes: centre, base radius, height above the grass, ramp bearing (radians, 0 = east, pi/2 = south) or null. The first is Crown Rock. */
const KOPJES = [
  { x: -6, z: -48, R: 7.0, H: 10, ramp: Math.PI * 5 / 3 },     // Crown Rock
  { x: -64, z: -20, R: 4.5, H: 6.5, ramp: null },
  { x: -114, z: -36, R: 4.0, H: 8, ramp: null },
  { x: -60, z: -40, R: 4.0, H: 7, ramp: null },
  { x: 70, z: -52, R: 5.5, H: 8, ramp: Math.PI * 0.3 },       // the second ramp rock
  { x: 102, z: -38, R: 4.5, H: 5.5, ramp: null },
  { x: 116, z: -16, R: 4.0, H: 7, ramp: null },
  { x: 118, z: 36, R: 5.0, H: 9, ramp: null },
];
/** River sources, in the order they are built: rivers to the marsh falls first, then the streams that join them, then the short spills to the sea cliffs. */
const RIVERS = [
  { id: 'west', kind: 'river', pool: 'b', via: [[-82, -41], [-92, -35]], fall: 'fall-west', hw: [1.45, 2.0] },
  { id: 'mid', kind: 'river', pool: 'd', via: [[-28, -48], [-29, -40]], fall: 'fall-mid', hw: [1.45, 2.0] },
  { id: 'east', kind: 'river', pool: 'e', via: [[16, -44], [12, -36]], fall: 'fall-east', hw: [1.4, 1.9] },
  { id: 'mid-c', kind: 'stream', pool: 'c', via: [[-47, -46], [-40, -37]], join: 'mid', near: [-33, -32], hw: [1.25, 1.4] },
  { id: 'east-f', kind: 'stream', pool: 'f', via: [[42, -36], [30, -30], [20, -26]], join: 'east', near: [6, -26], hw: [1.25, 1.4] },
  { id: 'spill-g', kind: 'spill', pool: 'g', hw: [1.3, 1.5] },
  { id: 'spill-h', kind: 'spill', pool: 'h', hw: [1.3, 1.5] },
  { id: 'spill-i', kind: 'spill', pool: 'i', hw: [1.3, 1.5] },
];
/** The reserved lanes (four 4 u walking lanes, kept clear like the marsh's): notch to Crown Rock, Crown Rock east to the arm, notch west, Crown Rock north. */
const LANE_CTRL = [
  [[-58, -4], [-40, -22], [-18, -38], [-12, -42]],
  [[2, -48], [-2, -34], [4, -22], [26, -22], [48, -24], [66, -30], [90, -24], [108, -8], [126, 0]],
  [[-62, -6], [-84, -16], [-108, -24], [-128, -30]],
  [[-6, -57], [-10, -70], [-14, -82]],
];
const TREAD = 1.6, TRANS = 1.4, STEP_UP = 0.6, RAMP_HW = 1.9;    // boulder-step ramp: tread length, riser transition length, the largest riser, half width

const cache = new Map();
export function getCrownLayout(island, L) {
  const key = `${island.id}:${island.seed}`;
  let c = cache.get(key);
  if (!c) { c = createCrownLayout(island, L); cache.set(key, c); }
  return c;
}

export function createCrownLayout(island, L) {
  const nSwell = createNoise2D(island.seed + 701), nWarp = createNoise2D(island.seed + 703), nLav = createNoise2D(island.seed + 709), nRock = createNoise2D(island.seed + 719);
  const ext = meshExtent(island);

  const edgeD = (lx, lz) => Math.min(L.cliffC(lx, lz) - CLIFF_W, L.coastT(lx, lz) - SEA_LIP);   // distance inside the plateau's top edge (negative on the wall / sea cliff)

  /** Step 85b: 1 when a point (island-local x, z; y = its height or a player's feet) is on the plateau top, 0 off it: above ~40 u AND on the plateau side of the cliff / sea cliff, eased over the wall edge. */
  const topWeight = (lx, lz, y) => sstep(40, 45, y) * sstep(-1.5, 1.5, edgeD(lx, lz));

  // ---- the relief ----------------------------------------------------------------------------------------------------------------------------------------------------
  function swell01(lx, lz) { return 0.5 + 0.5 * Math.max(-1, Math.min(1, 1.4 * fbm(lx * 0.02 + 7, lz * 0.02 - 3, 3, 2, 0.5, nSwell))); }
  function reliefAtD(lx, lz, d) {
    if (d <= CROWN.riseFrom) return PLATEAU_TOP;                           // the rim band is untouched
    return PLATEAU_TOP + CROWN.rise * sstep(CROWN.riseFrom, CROWN.riseTo, d) + CROWN.swell * swell01(lx, lz) * sstep(CROWN.riseFrom, 30, d);
  }
  const reliefAt = (lx, lz) => reliefAtD(lx, lz, edgeD(lx, lz));

  // ---- plunge pools --------------------------------------------------------------------------------------------------------------------------------------------------
  const pools = POOLS.map((p, i) => {
    let lowest = Infinity;                                                  // the water sits a little below the lowest bank all round, so it never leaks downhill
    for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2; lowest = Math.min(lowest, reliefAt(p.x + Math.cos(a) * p.r * 1.35, p.z + Math.sin(a) * p.r * 1.35)); }
    lowest = Math.min(lowest, reliefAt(p.x, p.z));
    return { id: `crown-pool-${String(i + 1).padStart(2, '0')}`, k: p.k, x: p.x, z: p.z, r: p.r, depth: r2(1.7 + 0.1 * p.r), surf: r2(Math.max(PLATEAU_TOP - CROWN.bank, lowest - 0.3)) };   // (never below the rim's water line: the rim band stays 46)
  });
  const poolByK = Object.fromEntries(pools.map((p) => [p.k, p]));
  const poolBed = (s, surf, depth) => (s >= 1.25 ? 99 : lerp(lerp(surf + CROWN.bank, surf - CROWN.wade, sstep(1.25, 0.62, s)), surf - depth, sstep(0.62, 0.28, s)));
  const poolS = (p, lx, lz) => Math.hypot(lx - p.x, lz - p.z) / (1 + 0.08 * nWarp(lx * 0.2 + p.x * 1.3, lz * 0.2 + p.z * 1.7)) / p.r;

  // ---- rivers: every one designed backward from its outlet ------------------------------------------------------------------------------------------------------------
  const gradDir = (f, x, z) => { const e = 1, gx = f(x + e, z) - f(x - e, z), gz = f(x, z + e) - f(x, z - e), l = Math.hypot(gx, gz) || 1; return [gx / l, gz / l]; };
  const rivers = [];
  const noNoise = () => 0;
  function polyline(ctrl) { return smoothLine(ctrl, noNoise, 3, 0, 14); }
  function nearestOn(pts, x, z) {                                            // nearest point on a polyline: { x, z, i, u }
    let best = null;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz, u = l2 ? clamp01(((x - ax) * dx + (z - az) * dz) / l2) : 0;
      const qx = ax + dx * u, qz = az + dz * u, d = Math.hypot(qx - x, qz - z);
      if (!best || d < best.d) best = { x: qx, z: qz, i, u, d };
    }
    return best;
  }
  for (const spec of RIVERS) {
    const pool = poolByK[spec.pool];
    let ctrl, outlet;
    if (spec.kind === 'river') {
      const f = L.falls.find((q) => q.id === spec.fall), n = gradDir(L.cliffC, f.x, f.z);
      outlet = { type: 'fall', fall: f.id, x: f.x, z: f.z };
      ctrl = [[pool.x, pool.z], ...spec.via, [f.x + n[0] * 26, f.z + n[1] * 26], [f.x + n[0] * 13, f.z + n[1] * 13], [f.x, f.z]];
    } else if (spec.kind === 'spill') {                                      // walk straight down the coast distance field to the sea cliff
      let x = pool.x, z = pool.z;
      ctrl = [[x, z]];
      for (let i = 0; i < 160 && L.coastT(x, z) > 2.0; i++) {
        const g = gradDir(L.coastT, x, z);
        x -= g[0]; z -= g[1];
        if (i % 12 === 11) ctrl.push([x, z]);
      }
      ctrl.push([x, z]);
      outlet = { type: 'sea', x: r2(x), z: r2(z) };
    } else {
      ctrl = [[pool.x, pool.z], ...spec.via, spec.near];
      outlet = { type: 'join', river: spec.join };
    }
    let pts = polyline(ctrl);
    let sJoin = -Infinity;
    if (spec.kind === 'stream') {
      const main = rivers.find((r) => r.key === spec.join), q = nearestOn(main.pts, pts[pts.length - 1][0], pts[pts.length - 1][1]);
      sJoin = lerp(main.surf[q.i], main.surf[q.i + 1], q.u);
      pts = pts.filter((p) => Math.hypot(p[0] - q.x, p[1] - q.z) > 4); pts.push([q.x, q.z]);
      outlet.x = r2(q.x); outlet.z = r2(q.z);
    }
    // the water surface: flush with the ground (minus the bank) and never rising downstream
    const surf = []; let run = pool.surf;
    for (let i = 0; i < pts.length; i++) { run = Math.min(run, poolGroundD(pts[i][0], pts[i][1], edgeD(pts[i][0], pts[i][1]), false) - CROWN.bank); surf.push(run); }
    const arc = [0]; for (let i = 1; i < pts.length; i++) arc.push(arc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const length = arc[arc.length - 1];
    if (sJoin > -Infinity) for (let i = 0; i < surf.length; i++) surf[i] = Math.max(sJoin, Math.min(surf[i], sJoin + 0.12 * (length - arc[i])));    // a stream steps down into the river it joins
    rivers.push({
      id: `river-${spec.id}`, key: spec.id, kind: spec.kind, pool: pool.id, outlet, length: r2(length),
      pts: pts.map((p) => [r2(p[0]), r2(p[1])]), surf: surf.map(r2),
      hw: arc.map((a) => r2(lerp(spec.hw[0], spec.hw[1], a / length))),
      out: arc.map((a) => (spec.kind === 'stream' ? 999 : r2(length - a))),             // distance to the outlet (the lip notch deepens from a sill)
    });
  }
  // spatial buckets (16 u) over the mesh rectangle
  const BC = 16, BW = Math.ceil((2 * ext.halfX) / BC) + 1, BH = Math.ceil((2 * ext.halfZ) / BC) + 1;
  const bx = (x) => Math.max(0, Math.min(BW - 1, Math.floor((x + ext.halfX) / BC)));
  const bz = (z) => Math.max(0, Math.min(BH - 1, Math.floor((z + ext.halfZ) / BC)));
  const segBuckets = Array.from({ length: BW * BH }, () => []);
  const REACH = 13.5;
  for (const r of rivers) {
    for (let k = 0; k < r.pts.length - 1; k++) {
      const s = { ax: r.pts[k][0], az: r.pts[k][1], bx: r.pts[k + 1][0], bz: r.pts[k + 1][1], sa: r.surf[k], sb: r.surf[k + 1], wa: r.hw[k], wb: r.hw[k + 1], oa: r.out[k], ob: r.out[k + 1], ri: rivers.indexOf(r) };
      for (let j = bz(Math.min(s.az, s.bz) - REACH); j <= bz(Math.max(s.az, s.bz) + REACH); j++) for (let i = bx(Math.min(s.ax, s.bx) - REACH); i <= bx(Math.max(s.ax, s.bx) + REACH); i++) segBuckets[j * BW + i].push(s);
    }
  }
  const EMPTY = [];
  const segsNear = (lx, lz) => (Math.abs(lx) <= ext.halfX && Math.abs(lz) <= ext.halfZ ? segBuckets[bz(lz) * BW + bx(lx)] : EMPTY);

  /** The ground a river leaves at (lx, lz): a channel (floor 0.6 under the water, a sill at the outlet), a flat bank, then the relief blends back in. */
  function riverGround(lx, lz, relief, seg, d, u) {
    const hw = lerp(seg.wa, seg.wb, u);
    if (d > hw + 12) return Infinity;
    const s = lerp(seg.sa, seg.sb, u), so = lerp(seg.oa, seg.ob, u);
    const depth = CROWN.bank + (CROWN.wade - CROWN.bank) * sstep(3.5, 10, so);
    if (d >= hw + 0.9 && s + CROWN.bank >= relief - 1e-6 && relief <= PLATEAU_TOP) return Infinity;      // the bank IS the rim here: leave the rim band exactly flat
    const bed = lerp(s - depth, s + CROWN.bank, sstep(hw * 0.5, hw + 0.9, d));
    return lerp(bed, relief, sstep(hw + 0.9, hw + 12, d));
  }

  const scan = { surf: NaN, edge: Infinity };                                // the nearest water body at the last waterNear() call
  function waterNear(lx, lz) {
    let best = Infinity, surf = NaN;
    const segs = segsNear(lx, lz);
    for (let i = 0; i < segs.length; i++) {
      const sg = segs[i], dx = sg.bx - sg.ax, dz = sg.bz - sg.az, l2 = dx * dx + dz * dz, u = l2 ? clamp01(((lx - sg.ax) * dx + (lz - sg.az) * dz) / l2) : 0;
      const e = Math.hypot(sg.ax + dx * u - lx, sg.az + dz * u - lz) - lerp(sg.wa, sg.wb, u);
      if (e < best) { best = e; surf = lerp(sg.sa, sg.sb, u); }
    }
    for (let i = 0; i < pools.length; i++) {
      const p = pools[i];
      if (Math.abs(lx - p.x) > p.r * 1.7 || Math.abs(lz - p.z) > p.r * 1.7) continue;
      const ps = poolS(p, lx, lz), e = (ps - 1.0) * p.r;
      if (ps < 1.3 && e < best) { best = e; surf = p.surf; }                    // (a pool's water ends at its bowl; beyond that the ground may drop away below the pool's level)
    }
    if (best === Infinity) return null;
    scan.surf = surf; scan.edge = best;
    return scan;
  }
  function waterDepth(lx, lz, h) {
    const w = waterNear(lx, lz);
    return w && w.edge < 2 && h < w.surf ? w.surf - h : 0;
  }

  // ---- the ground without the rocks: the relief with the river beds and the plunge pools cut in -------------------------------------------------------------------------
  /** The relief with the plunge pools' aprons and bowls cut in (before any river, which the rivers' own surfaces are measured against). */
  function poolGroundD(lx, lz, d, bowls = true) {
    const relief = reliefAtD(lx, lz, d);
    let h = relief;
    for (let i = 0; i < pools.length; i++) {
      const p = pools[i], reach = p.r * 1.3 + 25;
      if (Math.abs(lx - p.x) > reach * 1.1 || Math.abs(lz - p.z) > reach * 1.1) continue;
      const dd = Math.hypot(lx - p.x, lz - p.z) / (1 + 0.08 * nWarp(lx * 0.2 + p.x * 1.3, lz * 0.2 + p.z * 1.7));
      const shelf = p.surf + CROWN.bank;
      h = Math.min(h, lerp(relief, shelf, 1 - sstep(p.r * 1.3, p.r * 1.3 + 24, dd)));      // (each apron is measured against the bare relief: overlapping aprons never stack)      // (a wide apron: the bowl is cut into a slope without a steep terrace)
      const s = dd / p.r;
      if (bowls && s < 1.25) h = Math.min(h, poolBed(s, p.surf, p.depth));
    }
    return h;
  }
  const nearD = new Float64Array(rivers.length).fill(Infinity), nearU = new Float64Array(rivers.length), nearList = new Int32Array(rivers.length), nearSeg = new Array(rivers.length);
  function carvedAtD(lx, lz, d) {
    const base = poolGroundD(lx, lz, d);
    let h = base;
    const segs = segsNear(lx, lz);
    if (segs.length === 0) return h;
    let touched = 0;                                                           // the NEAREST segment of each river decides its own ground (a bed never cuts below its own water)
    for (let i = 0; i < segs.length; i++) {
      const sg = segs[i], dx = sg.bx - sg.ax, dz = sg.bz - sg.az, l2 = dx * dx + dz * dz, u = l2 ? clamp01(((lx - sg.ax) * dx + (lz - sg.az) * dz) / l2) : 0;
      const d = Math.hypot(sg.ax + dx * u - lx, sg.az + dz * u - lz), ri = sg.ri;
      if (d < nearD[ri]) { if (nearD[ri] === Infinity) nearList[touched++] = ri; nearD[ri] = d; nearSeg[ri] = sg; nearU[ri] = u; }
    }
    for (let t = 0; t < touched; t++) {
      const ri = nearList[t], g = riverGround(lx, lz, base, nearSeg[ri], nearD[ri], nearU[ri]);
      if (g < h) h = g;
      nearD[ri] = Infinity;
    }
    return h;
  }
  const carvedAt = (lx, lz) => carvedAtD(lx, lz, edgeD(lx, lz));

  // ---- kopjes ---------------------------------------------------------------------------------------------------------------------------------------------------------
  const rngK = (i, j) => { const v = Math.sin((i + 1) * 127.1 + (j + 1) * 311.7) * 43758.5453; return v - Math.floor(v); };
  const kopjes = KOPJES.map((k, i) => {
    // the rock stands on the HIGHEST ground round it (so its tiers always rise above every adjacent bit of grass) and its skirt goes down to the lowest (no gap on the low side)
    let hiY = carvedAt(k.x, k.z), loY = hiY;
    for (let a = 0; a < 16; a++) for (const rr of [k.R * 0.8, k.R * 1.3 + 1]) { const g = carvedAt(k.x + Math.cos(a * Math.PI / 8) * rr, k.z + Math.sin(a * Math.PI / 8) * rr); hiY = Math.max(hiY, g); loY = Math.min(loY, g); }
    const baseY = hiY, floorY = loY - 1.0, phi = rngK(i, 0) * 6.283;
    const tiers = [
      { ox: 0, oz: 0, r: k.R, h: 0.42 * k.H },
      { ox: (rngK(i, 1) - 0.5) * 0.5 * k.R, oz: (rngK(i, 2) - 0.5) * 0.5 * k.R, r: 0.72 * k.R, h: 0.72 * k.H },
      { ox: (rngK(i, 3) - 0.5) * 0.3 * k.R, oz: (rngK(i, 4) - 0.5) * 0.3 * k.R, r: 0.46 * k.R, h: k.H },
    ];
    let ramp = null;
    if (k.ramp !== null) {
      const dir = [Math.cos(k.ramp), Math.sin(k.ramp)], t2 = tiers[2];
      const bx_ = k.x + t2.ox + dir[0] * t2.r * 0.55, bz_ = k.z + t2.oz + dir[1] * t2.r * 0.55;      // the ramp ends on the top block, a little inside its edge
      let rise = baseY + k.H - baseY, steps = 0, length = 0, base = baseY;
      for (let it = 0; it < 3; it++) {                                        // the foot starts flush with the ground where it lands, so its length depends on where that is
        steps = Math.ceil(rise / STEP_UP); length = steps * TREAD;
        base = carvedAt(bx_ + dir[0] * length, bz_ + dir[1] * length);
        rise = baseY + k.H - base;
      }
      ramp = { a: [r2(bx_ + dir[0] * length), r2(bz_ + dir[1] * length)], b: [r2(bx_), r2(bz_)], dir: dir.map(r2), length: r2(length), steps, riser: r2(rise / steps), base: r2(base), rise: r2(rise), hw: RAMP_HW };
    }
    return { id: `kopje-${i}`, name: i === 0 ? 'Crown Rock' : `kopje-${i}`, x: k.x, z: k.z, r: k.R, H: k.H, baseY: r2(baseY), floorY: r2(floorY), topY: r2(baseY + k.H), tiers, phi, ramp, reach: k.R * 1.15 + 1 + (ramp ? ramp.length + 3 : 0) };
  });
  const crownRock = kopjes[0];
  function kopjeAt(lx, lz) {
    let best = -Infinity;
    for (let i = 0; i < kopjes.length; i++) {
      const k = kopjes[i], dx = lx - k.x, dz = lz - k.z;
      if (Math.abs(dx) > k.reach || Math.abs(dz) > k.reach || dx * dx + dz * dz > k.reach * k.reach) continue;
      const th = Math.atan2(dz, dx), wob = 1 + 0.10 * Math.sin(3 * th + k.phi) + 0.05 * Math.sin(5 * th + 1.7 * k.phi);
      for (let t = 0; t < 3; t++) {
        const tier = k.tiers[t], d = Math.hypot(dx - tier.ox, dz - tier.oz) * wob;
        if (d > tier.r + 1) continue;
        const y = k.floorY + (k.baseY + tier.h - k.floorY) * (1 - sstep(tier.r - 0.45, tier.r + 0.55, d));
        if (y > best) best = y;
      }
      if (k.ramp) {
        const rp = k.ramp, ax = lx - rp.b[0], az = lz - rp.b[1], s = ax * rp.dir[0] + az * rp.dir[1], perp = Math.abs(-ax * rp.dir[1] + az * rp.dir[0]);
        if (s > -0.5 && s < rp.length + 1 && perp < rp.hw + 1) {
          const a = Math.max(0, rp.length - s), kk = Math.floor(a / TREAD), fr = a / TREAD - kk;
          const h = Math.min(rp.rise, rp.riser * (kk + sstep(1 - TRANS / TREAD, 1, fr)));
          const m = (1 - sstep(rp.hw, rp.hw + 0.8, perp)) * sstep(-0.5, 0.1, s);
          const y = rp.base - 1.5 + (h + 1.5) * m;
          if (y > best) best = y;
        }
      }
    }
    return best;
  }
  const kopjeRel = (k, y) => clamp01((y - k.floorY) / (k.topY - k.floorY));

  // ---- the height -----------------------------------------------------------------------------------------------------------------------------------------------------
  function topAt(lx, lz) {
    const h = carvedAtD(lx, lz, edgeD(lx, lz)), k = kopjeAt(lx, lz);
    return k > h ? k : h;
  }

  function groundType(lx, lz, h) {
    const w = waterNear(lx, lz);
    if (w && w.edge < 2 && h < w.surf - 0.03) return 'water';
    if (kopjeAt(lx, lz) > carvedAt(lx, lz) + 0.3) return 'kopje';
    if (w && w.edge < 3.2) return 'riverbank';
    return 'savanna';
  }
  /** Masks for the ground painter (all 0..1): up = the golden upland, bank = the teal river fringe, lav = lavender patches, kop = kopje rock, band = its dark lower band, wet = under water, deep = the deep pool middles. */
  function paint(lx, lz, h) {
    const d = edgeD(lx, lz), u = sstep(CROWN.riseFrom + 4, CROWN.riseTo - 8, d);
    const out = { up: u * (0.55 + 0.45 * sstep(0.3, 0.7, swell01(lx, lz))), bank: 0, lav: 0, kop: 0, band: 0, wet: 0, deep: 0 };
    const w = waterNear(lx, lz);
    if (w) {
      out.bank = 1 - sstep(0.6, 4.2, w.edge);
      if (w.edge < 2 && h < w.surf) { out.wet = clamp01((w.surf - h) / 0.5); out.deep = sstep(0.45, 1.6, w.surf - h); }
    }
    out.lav = sstep(0.28, 0.6, nLav(lx * 0.045 + 3, lz * 0.045 - 8)) * 0.6 * (1 - out.bank);
    const k = kopjeAt(lx, lz);
    if (k > -Infinity && k > carvedAt(lx, lz) + 0.15) {
      out.kop = 1;
      let kk = kopjes[0], bd = Infinity;
      for (const q of kopjes) { const dd = Math.hypot(lx - q.x, lz - q.z); if (dd < bd) { bd = dd; kk = q; } }
      const rel = kopjeRel(kk, k);
      out.band = (1 - sstep(0.1, 0.5, rel)) * 0.85 + 0.15 * sstep(0.2, 0.8, nRock(lx * 0.5, lz * 0.5 + h * 1.5));
    }
    return out;
  }

  // ---- the cloud lid's envelope: an upper bound of the whole plateau, so the lid can rise to cover it ---------------------------------------------------------------------
  // A lattice (8 u, anchored at the mesh corner) of the plateau's highest point within 8 u, bilinear in between: any triangulation of the lid then agrees along block edges (no cracks),
  // and every point is at or under the surface the lid draws over it. -Infinity (no plateau near) is stored as 0 so the interpolation stays finite.
  const LAT = 8;
  let lattice = null;
  function buildLattice() {
    const CELL = 2, W = Math.ceil((2 * ext.halfX) / CELL) + 1, H = Math.ceil((2 * ext.halfZ) / CELL) + 1;
    const g = new Float32Array(W * H).fill(-Infinity);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const x = -ext.halfX + i * CELL, z = -ext.halfZ + j * CELL;
      if (L.cliffC(x, z) > 0 && L.coastT(x, z) > 2) g[j * W + i] = topAt(x, z);
    }
    const LW = Math.ceil((2 * ext.halfX) / LAT) + 1, LH = Math.ceil((2 * ext.halfZ) / LAT) + 1, nodes = new Float32Array(LW * LH);
    for (let lj = 0; lj < LH; lj++) for (let li = 0; li < LW; li++) {
      let m = -Infinity;
      const ci = Math.round((li * LAT) / CELL), cj = Math.round((lj * LAT) / CELL);
      for (let dj = -4; dj <= 4; dj++) for (let di = -4; di <= 4; di++) {            // +-8 u in 2 u cells: a point of a block is within 8 u of all four of its corners
        const ii = ci + di, jj = cj + dj;
        if (ii < 0 || jj < 0 || ii >= W || jj >= H) continue;
        const v = g[jj * W + ii]; if (v > m) m = v;
      }
      nodes[lj * LW + li] = m === -Infinity ? 0 : m + 0.7 * sstep(PLATEAU_TOP, PLATEAU_TOP + 1, m);      // (+0.7 over raised ground: the 2 u sampling can miss a narrow crest; none over the flat rim, which keeps the old lid at 48)
    }
    lattice = { LW, LH, nodes };
  }
  function lidTop(lx, lz) {
    if (!lattice) buildLattice();
    const { LW, LH, nodes } = lattice;
    const fx = Math.max(0, Math.min(LW - 1.0001, (lx + ext.halfX) / LAT)), fz = Math.max(0, Math.min(LH - 1.0001, (lz + ext.halfZ) / LAT));
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, o = j * LW + i;
    return (nodes[o] * (1 - u) + nodes[o + 1] * u) * (1 - v) + (nodes[o + LW] * (1 - u) + nodes[o + LW + 1] * u) * v;
  }

  // ---- reserved spots -------------------------------------------------------------------------------------------------------------------------------------------------
  const notchN = gradDir(L.cliffC, L.notch.x, L.notch.z);
  const walkOut = (from, dist) => { let x = from.x, z = from.z; for (let i = 0; i < 80 && edgeD(x, z) < dist; i++) { x += notchN[0] * 0.5; z += notchN[1] * 0.5; } return { x: r2(x), z: r2(z) }; };
  const notchTop = walkOut(L.notch, 5);
  const spawn = walkOut(L.notch, 9);
  const lanes = LANE_CTRL.map((c) => smoothLine(c, noNoise, 4, 0, 14).map((p) => [r2(p[0]), r2(p[1])]));
  const laneDist = (lx, lz) => { let best = Infinity; for (const ln of lanes) for (let i = 0; i < ln.length - 1; i++) { const [ax, az] = ln[i], [bx_, bz_] = ln[i + 1], dx = bx_ - ax, dz = bz_ - az, l2 = dx * dx + dz * dz, u = l2 ? clamp01(((lx - ax) * dx + (lz - az) * dz) / l2) : 0; best = Math.min(best, Math.hypot(ax + dx * u - lx, az + dz * u - lz)); } return best; };

  /** What a tree (or any later flora) has to keep out of: null = fine. r is the footprint radius. */
  function keepClear(lx, lz, r = 0) {
    const d = edgeD(lx, lz);
    if (d < 0 || L.cliffC(lx, lz) <= 0) return 'offPlateau';
    if (d < 6 + r) return 'rim';
    const w = waterNear(lx, lz);
    if (w && w.edge < 3.2 + r) return 'water';
    for (const p of pools) if (Math.hypot(lx - p.x, lz - p.z) < p.r + 6 + r) return 'fallFoot';        // where a sky fall lands
    for (const k of kopjes) if (Math.hypot(lx - k.x, lz - k.z) < k.r * 1.2 + 2 + r) return 'kopje';
    if (Math.hypot(lx - crownRock.x, lz - crownRock.z) < 14 + r) return 'crownRock';
    for (const k of kopjes) if (k.ramp && Math.hypot(lx - (k.ramp.a[0] + k.ramp.b[0]) / 2, lz - (k.ramp.a[1] + k.ramp.b[1]) / 2) < k.ramp.length / 2 + 4 + r) return 'ramp';
    if (Math.hypot(lx - notchTop.x, lz - notchTop.z) < 8 + r) return 'notch';
    if (Math.hypot(lx - spawn.x, lz - spawn.z) < 6 + r) return 'spawn';
    if (laneDist(lx, lz) < 2 + r) return 'lane';
    return null;
  }

  // ---- floating islands (data only: the heightfield cannot stack them over the plateau) ---------------------------------------------------------------------------------
  const skyIslands = SKY.map((s, i) => {
    let groundMax = -Infinity;
    for (let a = -s.R - 2; a <= s.R + 2; a += 3) for (let b = -s.R - 2; b <= s.R + 2; b += 3) if (a * a + b * b <= (s.R + 2) * (s.R + 2)) groundMax = Math.max(groundMax, topAt(s.x + a, s.z + b));
    const top = r2(groundMax + s.above), depth = r2(Math.min(0.85 * s.R, s.above - 42)), phi = rngK(i, 9) * 6.283;
    const edgeR = (th) => s.R * (1 + 0.07 * Math.sin(3 * th + phi) + 0.04 * Math.sin(5 * th + 2 * phi));
    const spills = s.spills.map((k, n) => { const p = poolByK[k]; return { id: `${s.id}-spill-${n + 1}`, x: p.x, z: p.z, y: r2(top - 0.4), pool: p.id }; });
    const sumPools = s.summit.map((f, n) => {
      const sp = spills[Math.min(n, spills.length - 1)], dx = s.x - sp.x, dz = s.z - sp.z, l = Math.hypot(dx, dz) || 1, rr = r2(s.R * (f >= 1 ? 0.24 : f));
      return { x: r2(sp.x + (dx / l) * s.R * 0.4), z: r2(sp.z + (dz / l) * s.R * 0.4), r: rr };
    });
    const inPool = (lx, lz) => sumPools.some((q) => Math.hypot(lx - q.x, lz - q.z) < q.r * 0.8);
    const topHeight = (lx, lz) => {
      const dx = lx - s.x, dz = lz - s.z, d = Math.hypot(dx, dz), er = edgeR(Math.atan2(dz, dx));
      if (d > er) return null;
      let y = top + 0.3 * (1 - (d / er) * (d / er)) - 0.35 * sstep(er - 1.5, er, d);
      for (const q of sumPools) y -= 0.5 * (1 - sstep(q.r * 0.7, q.r * 1.2, Math.hypot(lx - q.x, lz - q.z)));
      return y;
    };
    const walkable = (lx, lz) => { const dx = lx - s.x, dz = lz - s.z; return Math.hypot(dx, dz) < edgeR(Math.atan2(dz, dx)) - 0.8 && !inPool(lx, lz); };
    return { id: s.id, x: s.x, z: s.z, radius: s.R, top, above: s.above, depth, underside: r2(top - depth), groundMax: r2(groundMax), phi, pools: sumPools, spills, edgeR, topHeight, walkable };
  });

  // small flying rocks and the planned jump chains
  const skyRocks = [], chains = [];
  const addChain = (id, kopje, to, dir, n, rise0) => {
    const k = kopje, ids = [];
    let x = k.x, z = k.z, y = k.topY;
    for (let i = 0; i < n; i++) {
      x += dir[0] * 7.2 + (rngK(skyRocks.length, 5) - 0.5) * 1.2; z += dir[1] * 7.2 + (rngK(skyRocks.length, 6) - 0.5) * 1.2; y += rise0 * (0.8 + 0.2 * rngK(skyRocks.length, 7));
      const rock = { id: `sky-rock-${String(skyRocks.length + 1).padStart(2, '0')}`, x: r2(x), z: r2(z), y: r2(y), r: r2(1.6 + 1.8 * rngK(skyRocks.length, 8)) };
      skyRocks.push(rock); ids.push(rock.id);
    }
    chains.push({ id, from: { kopje: k.id }, rocks: ids, to, maxGap: CROWN.jumpGap, maxRise: CROWN.jumpRise });
  };
  addChain('chain-crown', crownRock, 'sky-03', [0.06, -1], 6, 2.0);                // Crown Rock's top, climbing north toward the biggest island (reachable later, from the kopje)
  addChain('chain-seat', kopjes[4], 'sky-05', [0.5, -0.87], 4, 1.9);                // the second ramp rock, toward the east island
  for (const [x, z, y, r] of [[-30, -100, 98, 2.6], [96, -78, 108, 3.2]]) skyRocks.push({ id: `sky-rock-${String(skyRocks.length + 1).padStart(2, '0')}`, x, z, y, r });    // drifters

  // ---- digest + summary -----------------------------------------------------------------------------------------------------------------------------------------------
  function hash() {
    let h = 2166136261 >>> 0;
    const mix = (v) => { const n = Math.round(v * 100); h = Math.imul(h ^ (n & 0xffff), 16777619) >>> 0; h = Math.imul(h ^ (n >> 16), 16777619) >>> 0; };
    for (const p of pools) { mix(p.x); mix(p.z); mix(p.r); mix(p.depth); mix(p.surf); }
    for (const r of rivers) { for (let i = 0; i < r.pts.length; i++) { mix(r.pts[i][0]); mix(r.pts[i][1]); mix(r.surf[i]); mix(r.hw[i]); } }
    for (const k of kopjes) { mix(k.x); mix(k.z); mix(k.r); mix(k.H); mix(k.baseY); if (k.ramp) { mix(k.ramp.a[0]); mix(k.ramp.a[1]); mix(k.ramp.length); } }
    for (const s of skyIslands) { mix(s.x); mix(s.z); mix(s.radius); mix(s.top); mix(s.depth); for (const q of s.pools) { mix(q.x); mix(q.z); mix(q.r); } for (const q of s.spills) { mix(q.x); mix(q.z); mix(q.y); } }
    for (const q of skyRocks) { mix(q.x); mix(q.z); mix(q.y); mix(q.r); }
    for (const ln of lanes) for (const p of ln) { mix(p[0]); mix(p[1]); }
    mix(notchTop.x); mix(notchTop.z); mix(spawn.x); mix(spawn.z);
    return h.toString(16).padStart(8, '0');
  }
  function summary() {
    let lo = Infinity, hi = -Infinity;
    for (let z = -110; z <= 90; z += 4) for (let x = -170; x <= 175; x += 4) { if (L.cliffC(x, z) > CLIFF_W && L.coastT(x, z) > SEA_LIP) { const h = reliefAt(x, z); if (h < lo) lo = h; if (h > hi) hi = h; } }
    return {
      relief: { min: r2(lo), max: r2(hi) }, pools: pools.length, rivers: rivers.filter((r) => r.kind === 'river').length, streams: rivers.filter((r) => r.kind === 'stream').length, spills: rivers.filter((r) => r.kind === 'spill').length,
      riverLengths: Object.fromEntries(rivers.map((r) => [r.id, r.length])), kopjes: kopjes.map((k) => ({ id: k.id, r: k.r, H: k.H, top: k.topY, ramp: !!k.ramp })),
      skyIslands: skyIslands.map((s) => ({ id: s.id, radius: s.radius, top: s.top, above: s.above, underside: s.underside, spills: s.spills.length })), skyRocks: skyRocks.length, chains: chains.length,
      spawn, notchTop, hash: hash(),
    };
  }

  return {
    island, edgeD, topWeight, reliefAt, poolGround: (lx, lz) => poolGroundD(lx, lz, edgeD(lx, lz)), carvedAt, kopjeAt, topAt, waterNear, waterDepth, groundType, paint, lidTop, pools, rivers, kopjes, crownRock, skyIslands, skyRocks, chains,
    notchTop, spawn, lanes, keepClear, hash, summary, CROWN,
  };
}
