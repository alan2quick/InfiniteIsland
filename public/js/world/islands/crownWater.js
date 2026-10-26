// The Crownlands' elevated water and falls (Step 85c): the pure, deterministic PLAN. No three.js. Everything is in WORLD coordinates (island.x / island.z added), y in metres above the sea.
// The plateau water sits up at 46-54 u, far above the sea plane, so it has surfaces of its own: a flat disc per plunge pool, a ribbon per river / stream / spill that follows the 85a surface
// heights (crownLayout rivers: non-increasing), and falls: sky falls (floating-island spill -> plunge pool), rim falls (river lip -> the existing marsh fall) and sea-cliff falls.
//
//   const W = buildCrownWater(island, mod)      cached per terrain module; mod = getIslandModule('duskcrown')
//   W.pools     [{ id, pool, x, z, y, r, ring: [[x, z]...] }]       a polygon traced to the shore: its rim vertices sit just under the bank
//   W.rivers    [{ id, kind, river, riffles, start, end, samples: [{ x, z, y, hwL, hwR, foam }], lip? }]    ~0.9 u apart; y = the planned surface (steps at the drops); foam 0..1 = the white riffle ribbon
//   W.skyFalls  [{ id, island, pool, x, z, yTop, yBottom, width, yaw, foot }]      straight down from the island's spill point to its plunge pool's surface
//   W.rimFalls  [{ id, fall, river, top: { x, y, z }, prefix: [{ x, y, z }...], hw: [..], joins: { x, y, z } }]     prefix = the points BEFORE the marsh fall's own first point `joins`
//   W.seaFalls  [{ id, river, path: [{ x, y, z, tail }], width, yaw, foot }]     down the sea cliff from the river lip to the sea (yaw = the strip's horizontal direction: along the wall)
//   W.summit    [{ island, id, x, z, y, r, ring }]     the floating islands' summit pools      W.skyStreams [{ island, pts: [{ x, y, z }], hw }]   the short streams to the spill points
//   W.hash() / W.summary()
//   rimPrefix(island, mod, fallId) -> { prefix, hw } | null     what duskSmallVisuals prepends to a marsh fall's path (rim falls extend the existing mesh upward, they never replace it)
import { WATER_LEVEL, DUSK_WATER, CROWN_WATER } from '../../config.js';
import { buildDuskFlora } from './duskFlora.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const r3 = (v) => +v.toFixed(3);
const STEP = 0.9, RING_N = 28, RING_CAP = 1.45;
const cache = new WeakMap();

/** Rim falls hand the marsh fall meshes this much extra (the river's full width tapers to the fall's width). */
export function rimPrefix(island, mod, fallId) {
  const f = buildCrownWater(island, mod).rimFalls.find((q) => q.fall === fallId);
  return f ? { prefix: f.prefix, hw: f.hw } : null;
}

export function buildCrownWater(island, mod) {
  if (cache.has(mod)) return cache.get(mod);
  const crown = mod.crown, L = mod.layout, ix = island.x, iz = island.z;
  const topAt = (lx, lz) => crown.topAt(lx, lz);
  const flora = buildDuskFlora(island, mod);

  // ---- a polygon traced outward from a centre until the ground rises just above the water (its edge hides under the bank); `leave` ends a ray early where the ground falls away (an outflow channel)
  function ring(cx, cz, rMax, hAt, level, { n = RING_N, cap = RING_CAP, leave = 0.2 } = {}) {
    const out = [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a), rEnd = rMax * cap;
      let found = rEnd;
      for (let r = rMax * 0.4; r <= rEnd; r += 0.15) {
        const h = hAt(cx + ca * r, cz + sa * r);
        if (h >= level + 0.03 || (r > rMax * 1.21 && h < level - leave)) { found = r; break; }
      }
      out.push([r3(cx + ca * found), r3(cz + sa * found), r3(found)]);
    }
    return out;
  }
  const ringRadiusAt = (rg, cx, cz, x, z) => { const k = Math.round((Math.atan2(z - cz, x - cx) / (Math.PI * 2) + 1) * rg.length) % rg.length; return rg[k][2]; };

  // ---- plunge pools: flat discs at the pool's water level
  const pools = crown.pools.map((p) => ({ id: `crown-water-${p.id.slice(-2)}`, pool: p.id, x: ix + p.x, z: iz + p.z, y: p.surf, r: p.r, ring: ring(p.x, p.z, p.r, topAt, p.surf).map(([x, z, r]) => [r3(ix + x), r3(iz + z), r]) }));
  const poolRing = {};                                                          // pool id -> the local ring (radius lookup by angle)
  for (const p of pools) poolRing[p.pool] = p.ring.map(([x, z, r]) => [x - ix, z - iz, r]);

  // ---- rivers, streams and spills: dense ribbons that follow the planned surface
  const byKey = new Map(crown.rivers.map((r) => [r.key, r]));
  const rivers = [];
  function polyDist(pts, x, z) { let best = Infinity; for (let i = 0; i < pts.length - 1; i++) { const [ax, az] = pts[i], [bx, bz] = pts[i + 1], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz, u = l2 ? clamp01(((x - ax) * dx + (z - az) * dz) / l2) : 0; best = Math.min(best, Math.hypot(ax + dx * u - x, az + dz * u - z)); } return best; }
  for (const r of crown.rivers) {
    const pl = crown.pools.find((p) => p.id === r.pool), pc = pools.find((p) => p.pool === r.pool);
    const dense = [];
    for (let k = 0; k < r.pts.length - 1; k++) {
      const [ax, az] = r.pts[k], [bx, bz] = r.pts[k + 1], len = Math.hypot(bx - ax, bz - az), m = Math.max(1, Math.ceil(len / STEP)), drop = r.surf[k] - r.surf[k + 1];
      for (let j = 0; j < m; j++) {
        const u = j / m, sh = drop > 0.25 ? sstep(0.15, 0.85, u) : u;           // a drop of more than a hand's width steps down in the middle of its segment (a riffle), a small one slopes
        dense.push({ x: lerp(ax, bx, u), z: lerp(az, bz, u), y: r.surf[k] - drop * sh, hw: lerp(r.hw[k], r.hw[k + 1], u) });
      }
    }
    const last = r.pts.length - 1;
    dense.push({ x: r.pts[last][0], z: r.pts[last][1], y: r.surf[last], hw: r.hw[last] });
    // where the ribbon starts (just outside its pool's disc) and ends (the lip over the cliff / sea, or the river it joins)
    const rg = poolRing[r.pool];
    let i0 = 0;
    while (i0 < dense.length - 2 && Math.hypot(dense[i0].x - pl.x, dense[i0].z - pl.z) < ringRadiusAt(rg, pl.x, pl.z, dense[i0].x, dense[i0].z) - 0.3) i0++;
    let i1 = dense.length - 1, lip = false;
    if (r.outlet.type === 'join') {
      const main = byKey.get(r.outlet.river);
      while (i1 > i0 + 1 && polyDist(main.pts, dense[i1].x, dense[i1].z) < main.hw[main.hw.length >> 1] - 0.1) i1--;
    } else {
      for (let i = i0; i < dense.length; i++) if (mod.height(ix + dense[i].x, iz + dense[i].z) < dense[i].y - 2.5) { i1 = Math.max(i0 + 1, i - 1); lip = true; break; }
    }
    const s = dense.slice(i0, i1 + 1);
    for (let i = 0; i < s.length; i++) {                                          // the white ribbon: how steep the water falls here
      const a = s[Math.max(0, i - 1)], b = s[Math.min(s.length - 1, i + 1)], ds = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      s[i].foam = sstep(0.07, 0.2, (a.y - b.y) / ds);
    }
    if (pl && pc && s[0].y < pl.surf - 0.1) for (let i = 0; i < s.length && Math.hypot(s[i].x - s[0].x, s[i].z - s[0].z) < 1.6; i++) s[i].foam = 1;      // the stream spills out of a higher pool
    // the shore on both sides (the ground that meets the water), smoothed along the river
    const sides = s.map((q, i) => {
      const a = s[Math.max(0, i - 1)], b = s[Math.min(s.length - 1, i + 1)];
      let tx = b.x - a.x, tz = b.z - a.z; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      const nx = -tz, nz = tx, out = [];
      for (const side of [1, -1]) {
        let found = q.hw + CROWN_WATER.shoreSlack;
        for (let d = q.hw * 0.7; d <= q.hw + CROWN_WATER.shoreSlack; d += 0.12) if (topAt(q.x + nx * side * d, q.z + nz * side * d) >= q.y + 0.03) { found = d; break; }
        out.push(Math.max(found, q.hw * 0.8));
      }
      return { nx, nz, L: out[0], R: out[1] };
    });
    const smooth = (key) => sides.map((_, i) => (sides[Math.max(0, i - 1)][key] + 2 * sides[i][key] + sides[Math.min(sides.length - 1, i + 1)][key]) / 4);
    const sl = smooth('L'), sr = smooth('R');
    const samples = s.map((q, i) => ({ x: r3(ix + q.x), z: r3(iz + q.z), y: r3(q.y), hwL: r3(sl[i]), hwR: r3(sr[i]), foam: r3(q.foam), nx: r3(sides[i].nx), nz: r3(sides[i].nz) }));
    let riffles = 0, inRiffle = false;
    for (const q of samples) { if (q.foam > 0.5 && !inRiffle) { riffles++; inRiffle = true; } else if (q.foam < 0.2) inRiffle = false; }
    rivers.push({ id: `crown-ribbon-${r.key}`, kind: r.kind, river: r.id, outlet: r.outlet, riffles, lip, samples });
  }

  // ---- falls
  const sea = WATER_LEVEL;
  const skyFalls = [];
  crown.skyIslands.forEach((s, i) => s.spills.forEach((sp, n) => {
    const pool = crown.pools.find((p) => p.id === sp.pool), w = n === 0 ? (pool.r >= 7 ? CROWN_WATER.fall.width[1] : lerp(CROWN_WATER.fall.width[0], CROWN_WATER.fall.width[1], 0.55)) : CROWN_WATER.fall.width[0] + 0.1;
    skyFalls.push({ id: `${s.id}-fall-${n + 1}`, island: s.id, pool: pool.id, x: r3(ix + sp.x), z: r3(iz + sp.z), yTop: sp.y, yBottom: pool.surf, width: r3(w), yaw: r3(0.55 + 0.9 * i + 0.4 * n), foot: { x: r3(ix + pool.x), y: pool.surf, z: r3(iz + pool.z) } });
  }));

  // rim falls: the river's lip joins the marsh fall's first point; the points between are prepended to the marsh mesh
  const rimFalls = [];
  for (const f of flora.falls) {
    const rv = rivers.find((q) => q.outlet.type === 'fall' && q.outlet.fall === f.id);
    if (!rv) continue;
    const lipS = rv.samples[rv.samples.length - 1], p0 = f.path[0], hwLip = (lipS.hwL + lipS.hwR) / 2, fw = DUSK_WATER.fallWidth;
    const dx = p0.x - lipS.x, dz = p0.z - lipS.z, mid = { x: r3(lipS.x + dx * 0.55), z: r3(lipS.z + dz * 0.55), y: r3(lerp(lipS.y, p0.y, 0.7)) };
    rimFalls.push({
      id: `rim-${f.id}`, fall: f.id, river: rv.id, top: { x: lipS.x, y: lipS.y, z: lipS.z },
      prefix: [{ x: lipS.x, y: lipS.y, z: lipS.z }, mid], hw: [r3(Math.min(hwLip, 1.6)), r3(lerp(Math.min(hwLip, 1.6), fw, 0.65))], joins: { x: r3(p0.x), y: p0.y, z: r3(p0.z) },
    });
  }

  // sea-cliff falls: down the sea cliff from the river lip, the same wall projection as the marsh falls (along the coast distance field)
  const seaFalls = [];
  for (const rv of rivers.filter((q) => q.outlet.type === 'sea')) {
    const lipS = rv.samples[rv.samples.length - 1], x0 = lipS.x - ix, z0 = lipS.z - iz, e = 0.5;
    const gx = L.coastT(x0 + e, z0) - L.coastT(x0 - e, z0), gz = L.coastT(x0, z0 + e) - L.coastT(x0, z0 - e), gl = Math.hypot(gx, gz) || 1, nx = gx / gl, nz = gz / gl;
    const at = (y) => { let lo = -9, hi = 9; for (let k = 0; k < 24; k++) { const t = (lo + hi) / 2; if (mod.height(lipS.x + nx * t, lipS.z + nz * t) < y) lo = t; else hi = t; } return { x: lipS.x + nx * lo - nx * 0.22, z: lipS.z + nz * lo - nz * 0.22 }; };
    const path = [{ x: lipS.x, y: lipS.y, z: lipS.z }];
    for (let y = lipS.y - 1.65; y > sea + 0.04; y -= 1.5) { const q = at(y); path.push({ x: r3(q.x), y: r3(y), z: r3(q.z) }); }
    const q = at(sea + 0.04); path.push({ x: r3(q.x), y: sea + 0.04, z: r3(q.z) });
    for (const p of path) p.tail = r3(clamp01(1 - (p.y - sea) / CROWN_WATER.fall.tail));
    seaFalls.push({ id: `sea-${rv.river.replace('river-', '')}`, river: rv.id, path, width: CROWN_WATER.fall.sea, yaw: r3(Math.atan2(nz, nx) + Math.PI / 2), foot: path[path.length - 1] });
  }

  // ---- the floating islands' own water: the summit pools and the short streams that run to the spill points
  const summit = [], skyStreams = [];
  for (const s of crown.skyIslands) {
    s.pools.forEach((q, n) => {
      if (s.pools.slice(0, n).some((o) => Math.hypot(o.x - q.x, o.z - q.z) < 0.5)) return;       // (an island with one spill draws its two summit pools on the same spot: keep the bigger)
      const level = s.topHeight(q.x, q.z) + 0.22;
      summit.push({ island: s.id, id: `${s.id}-pool-${n + 1}`, x: ix + q.x, z: iz + q.z, y: r3(level), r: q.r, ring: ring(q.x, q.z, q.r, (x, z) => s.topHeight(x, z) ?? 1e9, level, { n: 18, cap: 1.5 }).map(([x, z, rr]) => [r3(ix + x), r3(iz + z), rr]) });
    });
    s.spills.forEach((sp, n) => {
      const q = s.pools[Math.min(n, s.pools.length - 1)], pts = [];
      for (let k = 0; k <= 8; k++) { const x = lerp(q.x, sp.x, k / 8), z = lerp(q.z, sp.z, k / 8); pts.push({ x: r3(ix + x), y: r3((s.topHeight(x, z) ?? s.top) + 0.07), z: r3(iz + z) }); }
      skyStreams.push({ island: s.id, pts, hw: 0.55 });
    });
  }

  function hash() {
    let h = 2166136261 >>> 0;
    const mix = (v) => { const n = Math.round(v * 100); h = Math.imul(h ^ (n & 0xffff), 16777619) >>> 0; h = Math.imul(h ^ (n >> 16), 16777619) >>> 0; };
    for (const p of pools) { mix(p.x); mix(p.z); mix(p.y); for (const q of p.ring) mix(q[2]); }
    for (const r of rivers) for (const q of r.samples) { mix(q.x); mix(q.z); mix(q.y); mix(q.hwL); mix(q.hwR); mix(q.foam); }
    for (const f of skyFalls) { mix(f.x); mix(f.z); mix(f.yTop); mix(f.yBottom); mix(f.width); }
    for (const f of rimFalls) { mix(f.top.x); mix(f.top.y); mix(f.top.z); for (const p of f.prefix) { mix(p.x); mix(p.y); mix(p.z); } }
    for (const f of seaFalls) for (const p of f.path) { mix(p.x); mix(p.y); mix(p.z); }
    for (const p of summit) { mix(p.x); mix(p.z); mix(p.y); }
    return h.toString(16).padStart(8, '0');
  }
  const plan = {
    pools, rivers, skyFalls, rimFalls, seaFalls, summit, skyStreams, hash,
    summary: () => ({ pools: pools.length, ribbons: rivers.length, rivers: rivers.filter((r) => r.kind === 'river').length, streams: rivers.filter((r) => r.kind === 'stream').length, spills: rivers.filter((r) => r.kind === 'spill').length,
      samples: rivers.reduce((n, r) => n + r.samples.length, 0), riffles: rivers.reduce((n, r) => n + r.riffles, 0), skyFalls: skyFalls.length, rimFalls: rimFalls.length, seaFalls: seaFalls.length, summitPools: summit.length, hash: hash() }),
  };
  cache.set(mod, plan);
  return plan;
}
