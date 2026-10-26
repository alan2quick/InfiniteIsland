// Duskcrown Isle (Step 69a): the fungal island far to the south-east. Pure, deterministic height + ground-type functions over WORLD coordinates (the layout in
// duskLayout.js is island-local). The registry interface every island module has: { id, height, groundType, walkable, inland, paintInfo }.
//
//   * the GLOWCAP MARSH (south half): soft hummocks 0.6 .. 2.5 u above the sea, ground types 'marsh' (walkable) and 'mud' (the shelf round ponds / streams / the lagoon, walkable);
//   * PONDS (duskLayout.ponds, stable ids): a basin carved below the sea so the ocean plane fills it, a gently sloping walkable rim (the wading band, s 0.62 .. 1.25 of the radius)
//     and a deep unwalkable middle; the mud shelf round it is lowered to RIM_H (0.42) so the water surface sits a little below the rim;
//   * STREAMS (waterfall to pond chains): shallow wading channels (floor -0.2, WALKABLE, 2.6 u wide) with a mud shelf; they are cosmetic water for now;
//   * the LAGOON: the same profile at lagoon scale (floor -0.95): a walkable shallow rim, then deep unwalkable water; nothing closes it (a later quest opens it, PLAN Step 69);
//   * the CROWNLANDS (north half + the east arm): a plateau PLATEAU_TOP (46 u) above the sea, behind a sheer wall (CLIFF_W = 3.4 u in plan: unwalkable) and sea cliffs all
//     round. Since Step 85a its top comes from crownLayout.js: an untouched 46 u rim band, a gentle rise to a northern upland (52-54), kopjes, plunge pools and wading rivers;
//   * the LANDING: a sandy beach on the middle of the south coast.
// Ground types: 'water' 'wetsand' 'sand' 'mud' 'marsh' 'rock' ('rock' = the cliff) and, on the plateau top (85a), 'savanna' 'riverbank' 'kopje' (+ 'water' in rivers and pools). Unknown strings are ordinary dry ground to every consumer.
import { createNoise2D, fbm } from '../../utils/noise.js';
import { WATER_LEVEL, DEEP_WATER_BLOCK } from '../../config.js';
import { sstep, lerp, beachHeight, BEACH_T0 } from './util.js';
import { createDuskLayout, PLATEAU_TOP, CLIFF_W, RIM_H, WADE_H } from './duskLayout.js';
import { getCrownLayout, CROWN } from './crownLayout.js';

const MAX_WALK_SLOPE = 0.8;
const FLAT = 8;                     // how far (u) beyond a pond's mud shelf the marsh blends down to RIM_H

export function createDuskIsland(island) {
  const cx = island.x, cz = island.z, seed = island.seed;
  const L = createDuskLayout(island);
  const { halfX, halfZ } = L.bounds;
  const nHum = createNoise2D(seed + 31), nWarp = createNoise2D(seed + 37), nCliff = createNoise2D(seed + 53), nLag = createNoise2D(seed + 59), nTone = createNoise2D(seed + 61);
  const lagoon = L.lagoon;
  const crown = getCrownLayout(island, L);                     // Step 85a: the plateau top (relief, rivers, pools, kopjes) and the floating-island data

  /** The shared pond / lagoon bed profile along s = distance / radius: mud shelf (RIM_H) -> wading slope to WADE_H (s 1.25 -> 0.62) -> the deep bowl to -depth (s 0.62 -> 0.28). */
  const bed = (s, depth) => {
    if (s >= 1.25) return 9;
    const wade = lerp(RIM_H, WADE_H, sstep(1.25, 0.62, s));
    return lerp(wade, -depth, sstep(0.62, 0.28, s));
  };

  function hummock(lx, lz) {
    const f = fbm(lx * 0.035, lz * 0.035, 3, 2, 0.5, nHum);
    return 0.6 + 1.9 * Math.min(1, Math.max(0, 0.5 + 0.8 * f));      // 0.6 .. 2.5
  }

  /** Distance inland, capped so the sea floor is exactly SEA_FLOOR on the mesh rectangle's edge (no seam to anything beside it). */
  function inlandLocal(lx, lz) {
    const t = L.coastT(lx, lz);
    const edge = Math.min(halfX - Math.abs(lx), halfZ - Math.abs(lz));
    const cap = edge + BEACH_T0;
    return t < cap ? t : cap;
  }
  const inland = (x, z) => inlandLocal(x - cx, z - cz);

  function heightLocal(lx, lz) {
    const t = inlandLocal(lx, lz);
    const b = beachHeight(t);
    if (t < BEACH_T0 + 0.01) return b;                                   // open sea: the sea floor, nothing else to compute
    let h = b + (hummock(lx, lz) - 0.3) * sstep(6, 14, t);               // the marsh: the beach shelf (0.3) rising into the hummocks

    // ---- ponds
    const near = L.pondsNear(lx, lz);
    for (let i = 0; i < near.length; i++) {
      const p = near[i];
      const dx = lx - p.x, dz = lz - p.z;
      let d = Math.hypot(dx, dz);
      if (d > p.r * 1.3 + FLAT) continue;
      d /= 1 + 0.1 * nWarp(lx * 0.2 + p.x * 1.3, lz * 0.2 + p.z * 1.7);    // an irregular outline
      h = Math.min(h, lerp(h, RIM_H, 1 - sstep(p.r * 1.3, p.r * 1.3 + FLAT, d)));
      const s = d / p.r;
      if (s < 1.25) h = Math.min(h, bed(s, p.depth));
    }
    // ---- streams: a wading channel with a mud shelf
    const segs = L.segsNear(lx, lz);
    if (segs.length) {
      let d2 = Infinity;
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i], sx = s[2] - s[0], sz = s[3] - s[1], l2 = sx * sx + sz * sz;
        const u = l2 > 0 ? Math.min(1, Math.max(0, ((lx - s[0]) * sx + (lz - s[1]) * sz) / l2)) : 0;
        const qx = s[0] + sx * u - lx, qz = s[1] + sz * u - lz, q = qx * qx + qz * qz;
        if (q < d2) d2 = q;
      }
      const d = Math.sqrt(d2);
      if (d < 9) {
        h = Math.min(h, lerp(h, RIM_H, 1 - sstep(2.6, 9.0, d)));
        if (d < 2.8) h = Math.min(h, lerp(-0.2, RIM_H, sstep(1.0, 2.8, d)));
      }
    }
    // ---- the lagoon
    {
      const ls = L.lagoonS(lx, lz);
      if (ls < 1.25 + FLAT / Math.min(lagoon.rx, lagoon.rz) + 0.2) {
        const s = ls / (1 + 0.09 * nLag(lx * 0.05 + 4, lz * 0.05 - 3));
        h = Math.min(h, lerp(h, RIM_H, 1 - sstep(1.3, 1.3 + FLAT / lagoon.rx, s)));
        if (s < 1.25) h = Math.min(h, bed(s, lagoon.depth));
      }
    }
    // ---- the Crownlands: a sheer wall (CLIFF_W in plan) up to the flat top; the sea cliffs of the plateau rise straight out of the water
    const c = L.cliffC(lx, lz) + 1.5 * nCliff(lx * 0.11, lz * 0.11);
    if (c > 0) {
      const P = sstep(0, CLIFF_W, c) * sstep(2.0, 4.6, t);
      if (P > 0) h += (crown.topAt(lx, lz) - h) * P;
    }
    return h;
  }
  const height = (x, z) => heightLocal(x - cx, z - cz);

  function slopeAt(x, z, e) {
    const gx = (height(x + e, z) - height(x - e, z)) / (2 * e);
    const gz = (height(x, z + e) - height(x, z - e)) / (2 * e);
    return Math.hypot(gx, gz);
  }

  /** 0..1 weight of the sandy landing beach (a soft disc round L.landing, only on the beach / low shelf). */
  function sandAt(lx, lz, t) {
    const d = Math.hypot(lx - L.landing.x, lz - L.landing.z);
    return (1 - sstep(16, 34, d)) * (1 - sstep(8, 11, t));
  }

  /** 0..1 mud mask: the shelf round ponds, streams and the lagoon (also drives the painter). */
  function mudAt(lx, lz) {
    let m = 0;
    const near = L.pondsNear(lx, lz);
    for (let i = 0; i < near.length; i++) {
      const p = near[i], d = Math.hypot(lx - p.x, lz - p.z);
      m = Math.max(m, 1 - sstep(p.r * 1.0, p.r * 1.0 + 3.5, d));
    }
    const segs = L.segsNear(lx, lz);
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i], sx = s[2] - s[0], sz = s[3] - s[1], l2 = sx * sx + sz * sz;
      const u = l2 > 0 ? Math.min(1, Math.max(0, ((lx - s[0]) * sx + (lz - s[1]) * sz) / l2)) : 0;
      const d = Math.hypot(s[0] + sx * u - lx, s[1] + sz * u - lz);
      m = Math.max(m, 1 - sstep(2.0, 4.6, d));
    }
    const ls = L.lagoonS(lx, lz);
    m = Math.max(m, 1 - sstep(1.0, 1.0 + 3.5 / lagoon.rx, ls));
    return m;
  }

  /** True on the plateau's top proper (past the wall and the sea cliff), where the crown layout owns the ground. */
  function plateauCore(lx, lz) {
    const c = L.cliffC(lx, lz) + 1.5 * nCliff(lx * 0.11, lz * 0.11);
    return c > CLIFF_W - 0.05 && inlandLocal(lx, lz) > 4.55;
  }

  function groundType(x, z) {
    const lx = x - cx, lz = z - cz;
    const h = heightLocal(lx, lz);
    if (h < WATER_LEVEL - 0.03) return 'water';
    if (h > 30) { const cg = plateauCore(lx, lz) ? crown.groundType(lx, lz, h) : null; if (cg) return cg; }
    if (h > 3.4 || (h > 1.2 && slopeAt(x, z, 0.5) > 1.0)) return 'rock';
    const t = inlandLocal(lx, lz);
    if (sandAt(lx, lz, t) > 0.5) return h < WATER_LEVEL + 0.2 ? 'wetsand' : 'sand';
    if (h < WATER_LEVEL + 0.2 || mudAt(lx, lz) > 0.5) return 'mud';
    return 'marsh';
  }

  function walkable(x, z) {
    const h = height(x, z);
    if (h < WATER_LEVEL - DEEP_WATER_BLOCK) return false;
    if (h > 30 && crown.waterDepth(x - cx, z - cz, h) > CROWN.deepBlock) return false;      // the deep middle of a plunge pool (the plateau's water sits up at 46-54)
    return slopeAt(x, z, 0.4) < MAX_WALK_SLOPE;
  }

  /** Masks the mesh painter uses (kept here so the colours and the gameplay agree). */
  function paintInfo(x, z, h) {
    const lx = x - cx, lz = z - cz, t = inlandLocal(lx, lz);
    const c = L.cliffC(lx, lz) + 1.5 * nCliff(lx * 0.11, lz * 0.11);
    const hv = (hummock(lx, lz) - 0.6) / 1.9;
    return {
      t, hum: hv, tone: nTone(lx * 0.07, lz * 0.07),
      sand: sandAt(lx, lz, t), mud: mudAt(lx, lz),
      plateau: c > 0 ? sstep(0, CLIFF_W, c) * sstep(2.0, 4.6, t) : 0,
      top: sstep(PLATEAU_TOP - 2.5, PLATEAU_TOP - 0.2, h),
      crown: h > 30 && plateauCore(lx, lz) ? crown.paint(lx, lz, h) : null,       // Step 85a: the savanna masks (only on the plateau top)
    };
  }

  /** Walkable spot nearest to a world point (a ring search), or null. */
  function nearestWalkable(x, z) {
    if (walkable(x, z)) return { x, z };
    for (let r = 1; r < 40; r += 1) for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (walkable(px, pz)) return { x: +px.toFixed(2), z: +pz.toFixed(2) };
    }
    return null;
  }

  /** The debug stand points of __game.world.goto (world coordinates): the landing beach, the lagoon's west shore, the cliff foot below the middle of the north wall, the far west lobe. */
  let spotCache = null;
  function spots() {
    if (spotCache) return spotCache;
    const at = (lx, lz) => nearestWalkable(cx + lx, cz + lz);
    spotCache = {
      duskLanding: at(L.landing.x, L.landing.z),
      duskLagoon: at(lagoon.x - lagoon.rx * 1.35, lagoon.z),
      duskCliff: at(-30, L.cliffZAt(-30) + 11),
      duskWest: at(-140, 42),
      duskCrown: at(crown.spawn.x, crown.spawn.z),                                 // Step 85a: the crown landing, at the top of the reserved way up
      crownRock: at(crown.crownRock.x, crown.crownRock.z + crown.crownRock.r * 1.15 + 5),   // on the plain just south of Crown Rock's face (the camera side), looking up at it
      crownFalls: at(crown.pools[2].x, crown.pools[2].z + crown.pools[2].r * 1.6),   // the south shore of the plunge pool under the biggest island's fall
    };
    return spotCache;
  }

  /** Measured size of the island: the extent of land (coast distance > 0) over the mesh rectangle, in u. */
  let measured = null;
  function measure() {
    if (measured) return measured;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let lz = -halfZ + 1; lz < halfZ; lz += 1) for (let lx = -halfX + 1; lx < halfX; lx += 1) {
      if (L.coastT(lx, lz) > 0) { if (lx < x0) x0 = lx; if (lx > x1) x1 = lx; if (lz < z0) z0 = lz; if (lz > z1) z1 = lz; }
    }
    measured = { coast: { x0, x1, z0, z1 }, width: x1 - x0, depth: z1 - z0, mesh: { x0: cx - halfX, x1: cx + halfX, z0: cz - halfZ, z1: cz + halfZ } };
    return measured;
  }

  return { id: island.id, height, groundType, walkable, inland, paintInfo, layout: L, ponds: L.ponds, lagoon, plateauTop: PLATEAU_TOP, crown, slopeAt, spots, measure, nearestWalkable };
}
