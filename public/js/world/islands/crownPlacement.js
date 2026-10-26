// The Crownlands' alien acacias and baobabs (Step 85d): the pure, seeded PLACEMENT. No three.js. Gameplay (duskWorld.js: trunk colliders), the visuals (crownTreeVisuals.js), the geometry
// (crownTreeAssets.js) and the tests share it. It reads the terrain and the crown layout, it never changes them (their hash pins are untouched).
//
//   const p = buildCrownPlacement(island, mod)        cached per height module
//   p.items      every tree { id, type: 'acacia' | 'baobab', variant, family, fam, bark, zone, elder, x, z, y, rot, s, trunkR, canopyR, height, capUnder, capTop } (world coordinates, y = the ground
//                under the trunk; trunkR = the collider radius, canopyR = the canopy (or tuft ring) radius, capUnder / capTop = the canopy volume the fade tests); acacias first, then baobabs
//   p.acacias / p.baobabs / p.elders                  the same records split by class
//   p.hash()     short digest (determinism pin);  p.summary()  counts by type / variant / family / zone for the debug panel;  p.spots  safe stand points (world) per zone, or null
//   TREE         the shape table shared with crownTreeAssets.js (base size at scale 1) and the scale range of each variant;  FAMILY_NAMES
//   fadeRecord(item)  -> { id, x, z, r, y0, y1 }  the canopy volume the fade tests (duskFade.js)
//
// Savanna, not forest: PLAINS trees on wide Poisson spacing (18-30 u) with an occasional pair or trio; RIVERINE trees in denser groups 8-14 u apart along the rivers (more teal and violet);
// BAOBABS mostly on the upland swells and at kopje feet; one or two ELDER baobabs (12-14 u) only at Crown Rock's foot and near the edges, where the camera never passes under them.
// Kept clear (crownLayout keepClear + more): water and river banks, kopje faces and ramps, the rim band (the CANOPY must not overhang the cliff seen from the marsh), fall feet (sky-fall
// columns), the reserved lanes and spots, Crown Rock (14 u), ground steeper than walkable.
import { createNoise2D } from '../../utils/noise.js';
import { mulberry32 } from '../../utils/rng.js';
import { CROWN_TREES } from '../../config.js';
import { meshExtent } from './extent.js';
import { polyDist } from './scatter.js';

export const FAMILY_NAMES = CROWN_TREES.families.map((f) => f.name);

/** Base shapes at scale 1 (units). H = overall height, canopyR = the canopy plates' (or tuft ring's) radius, trunkR = trunk radius at the base (acacia) / belly (baobab), capUnder = the canopy's underside. */
export const TREE = {
  'acacia-flat': { type: 'acacia', H: 7.0, canopyR: 4.3, trunkR: 0.5, capUnder: 5.5, scale: [0.85, 1.25] },
  'acacia-tiered': { type: 'acacia', H: 7.6, canopyR: 4.0, trunkR: 0.55, capUnder: 4.5, scale: [0.85, 1.15] },
  'acacia-bushy': { type: 'acacia', H: 5.4, canopyR: 3.3, trunkR: 0.5, capUnder: 2.7, scale: [0.95, 1.3] },
  baobab: { type: 'baobab', H: 8.5, canopyR: 3.6, trunkR: 2.1, capUnder: 5.6, scale: [0.85, 1.18] },
  'baobab-elder': { type: 'baobab', H: 12.8, canopyR: 5.4, trunkR: 3.0, capUnder: 8.4, scale: [0.95, 1.1] },
};
export const COUNTS = { plains: 70, riverine: 70, kopjeBaobabs: 4, swellBaobabs: 4, elders: 2 };

const cache = new WeakMap();

export function buildCrownPlacement(island, mod) {
  if (cache.has(mod)) return cache.get(mod);
  const C = mod.crown, cx = island.x, cz = island.z, ext = meshExtent(island);
  const rng = mulberry32((island.seed + 8501) >>> 0);
  const nGroup = createNoise2D(island.seed + 8503);
  const trees = [];
  const lanesNear = (lx, lz) => { let d = Infinity; for (const ln of C.lanes) d = Math.min(d, polyDist(ln, lx, lz)); return d; };
  const pickFamily = (mix) => { let t = rng(), i = 0; for (; i < mix.length - 1; i++) { if (t < mix[i]) break; t -= mix[i]; } return i; };

  /** The shared keep-clear test (island-local x / z). fp = trunk footprint, cr = canopy radius. */
  function okSpot(lx, lz, fp, cr) {
    if (Math.abs(lx) > ext.halfX - 4 || Math.abs(lz) > ext.halfZ - 4) return false;
    if (C.keepClear(lx, lz, fp) !== null) return false;
    if (C.edgeD(lx, lz) < cr + 0.8) return false;                                      // the canopy must not overhang the rim band / the sea cliff
    for (const k of C.kopjes) if (Math.hypot(lx - k.x, lz - k.z) < k.r * 1.2 + 1.5 + cr * 0.5) return false;       // (a canopy is 5-7 u up: it may overhang a rock's skirt a little, not its face)
    const wx = cx + lx, wz = cz + lz;
    if (mod.groundType(wx, wz) !== 'savanna' || !mod.walkable(wx, wz)) return false;
    const h = mod.height(wx, wz);
    for (let i = 0; i < 8; i++) {                                                    // a ring of dry, level-ish ground round the trunk
      const a = i * Math.PI / 4, px = wx + Math.cos(a) * (fp + 0.8), pz = wz + Math.sin(a) * (fp + 0.8), t = mod.groundType(px, pz);
      if (t !== 'savanna' || !mod.walkable(px, pz) || Math.abs(mod.height(px, pz) - h) > 0.85) return false;
    }
    return true;
  }
  /** Trunks keep a walkable gap; canopies may touch. `gap` is a minimum centre distance that overrides when larger. */
  function apart(lx, lz, variant, gap = 0) {
    const m = TREE[variant], wx = cx + lx, wz = cz + lz;
    return trees.every((o) => {
      const d = Math.hypot(wx - o.x, wz - o.z);
      return d > Math.max(gap, 0.4 * (m.canopyR + o.canopyR) + 1.2, (m.trunkR + o.trunkR) * 1.3 + 2.2);
    });
  }
  const sizeOf = (variant, rngv) => { const m = TREE[variant]; return m.scale[0] + (m.scale[1] - m.scale[0]) * rngv; };
  function add(variant, lx, lz, extra) {
    const m = TREE[variant], s = sizeOf(variant, rng()), wx = cx + lx, wz = cz + lz, y = mod.height(wx, wz);
    const t = {
      type: m.type, variant, zone: extra.zone, elder: variant === 'baobab-elder', fam: extra.fam, family: FAMILY_NAMES[extra.fam], bark: extra.bark,
      x: +wx.toFixed(2), z: +wz.toFixed(2), y: +y.toFixed(3), rot: +(rng() * Math.PI * 2).toFixed(3), s: +s.toFixed(3),
      trunkR: +(m.trunkR * s * (m.type === 'baobab' ? 0.92 : 1.0)).toFixed(2), canopyR: +(m.canopyR * s).toFixed(2), height: +(m.H * s).toFixed(2),
      capUnder: +(y + m.capUnder * s).toFixed(2), capTop: +(y + m.H * s).toFixed(2),
    };
    trees.push(t);
    return t;
  }
  const baobabColors = () => ({ fam: rng() < 0.5 ? 1 : 2, bark: rng() < 0.5 ? 4 : 5 });
  const candidate = (box) => ({ lx: box.x0 + (box.x1 - box.x0) * rng(), lz: box.z0 + (box.z1 - box.z0) * rng() });
  const WHOLE = { x0: -ext.halfX, x1: ext.halfX, z0: -ext.halfZ, z1: ext.halfZ };
  const cr = C.crownRock;

  // ---- elder baobabs: one at Crown Rock's foot (its far, north side is off the lanes), one near an edge
  const elderM = TREE['baobab-elder'], elderFp = elderM.trunkR * 1.1, elderCr = elderM.canopyR * 1.1;
  const elders = [];
  for (let tries = 0; tries < 6000 && elders.length < 1; tries++) {
    const a = rng() * Math.PI * 2, d = 17.5 + rng() * 9, lx = cr.x + Math.cos(a) * d, lz = cr.z + Math.sin(a) * d;
    if (lanesNear(lx, lz) < elderCr + 0.5 || !okSpot(lx, lz, elderFp, elderCr) || !apart(lx, lz, 'baobab-elder')) continue;
    elders.push(add('baobab-elder', lx, lz, { zone: 'elder-rock', ...baobabColors() }));
  }
  for (let tries = 0; tries < 20000 && elders.length < COUNTS.elders; tries++) {
    const { lx, lz } = candidate(WHOLE), e = C.edgeD(lx, lz);
    if (e < elderCr + 3 || e > 18) continue;                                         // close to the edge, canopy still clear of the rim band
    if (lanesNear(lx, lz) < elderCr + 8 || Math.hypot(lx - C.spawn.x, lz - C.spawn.z) < 40 || Math.hypot(lx - cr.x, lz - cr.z) < 50) continue;
    if (!okSpot(lx, lz, elderFp, elderCr) || !apart(lx, lz, 'baobab-elder', 30)) continue;
    elders.push(add('baobab-elder', lx, lz, { zone: 'elder-edge', ...baobabColors() }));
  }

  // ---- baobabs: kopje feet, then the upland swells
  const bM = TREE.baobab, bFp = bM.trunkR * 1.18 * 1.0, bCr = bM.canopyR * 1.18;
  let kopjeN = 0;
  for (const k of C.kopjes.slice(1)) {
    if (kopjeN >= COUNTS.kopjeBaobabs) break;
    for (let tries = 0; tries < 400; tries++) {
      const a = rng() * Math.PI * 2, d = k.r * 1.2 + 2 + bFp + 0.8 + rng() * 6, lx = k.x + Math.cos(a) * d, lz = k.z + Math.sin(a) * d;
      if (!okSpot(lx, lz, bFp, bCr) || lanesNear(lx, lz) < bCr * 0.6 || !apart(lx, lz, 'baobab', 20)) continue;
      add('baobab', lx, lz, { zone: 'kopje', ...baobabColors() }); kopjeN++; break;
    }
  }
  let swellN = 0;
  for (let tries = 0; tries < 30000 && swellN < COUNTS.swellBaobabs; tries++) {
    const { lx, lz } = candidate(WHOLE);
    if (C.reliefAt(lx, lz) < 49.8 || lanesNear(lx, lz) < bCr * 0.6) continue;         // the crest of a swell
    if (!okSpot(lx, lz, bFp, bCr) || !apart(lx, lz, 'baobab', 22)) continue;
    add('baobab', lx, lz, { zone: 'swell', ...baobabColors() }); swellN++;
  }

  // ---- acacias on the plains: Poisson spacing 18-30 u, an occasional pair or trio
  const variantFor = (young) => { const t = rng(); return young ? (t < 0.5 ? 'acacia-bushy' : t < 0.8 ? 'acacia-flat' : 'acacia-tiered') : (t < 0.2 ? 'acacia-bushy' : t < 0.7 ? 'acacia-flat' : 'acacia-tiered'); };
  let plains = 0;
  const target = COUNTS.plains;
  for (let tries = 0; tries < 60000 && plains < target; tries++) {
    const { lx, lz } = candidate(WHOLE);
    const w = C.waterNear(lx, lz);
    if (w && w.edge < 13) continue;                                                  // (the riverine groups own the strips along the water)
    if (nGroup(lx * 0.012 + 2.1, lz * 0.012 - 4.3) < -0.55) continue;                // a few open stretches with none
    const variant = variantFor(false), m = TREE[variant], gap = 12 + 8 * rng();
    if (!okSpot(lx, lz, m.trunkR * 1.4, m.canopyR * 1.25) || !apart(lx, lz, variant, gap)) continue;
    const fam = pickFamily(CROWN_TREES.plainsMix);
    add(variant, lx, lz, { zone: 'plains', fam, bark: fam }); plains++;
    const mates = rng() < 0.3 ? (rng() < 0.4 ? 2 : 1) : 0;                          // a pair or a trio: the companions are a little smaller, of the same family
    for (let n = 0; n < mates; n++) {
      for (let k = 0; k < 24; k++) {
        const a = rng() * Math.PI * 2, d = 7 + rng() * 4, qx = lx + Math.cos(a) * d, qz = lz + Math.sin(a) * d, v2 = variantFor(true), m2 = TREE[v2];
        if (!okSpot(qx, qz, m2.trunkR * 1.4, m2.canopyR * 1.25) || !apart(qx, qz, v2, 6)) continue;
        add(v2, qx, qz, { zone: 'plains-group', fam, bark: fam }); plains++; break;
      }
    }
  }

  // ---- acacias along the rivers: denser groups 8-14 u apart, more teal and violet
  let river = 0;
  for (let tries = 0; tries < 80000 && river < COUNTS.riverine; tries++) {
    const { lx, lz } = candidate(WHOLE);
    const w = C.waterNear(lx, lz);
    if (!w || w.edge > 13 || w.edge < 4.4) continue;
    const variant = variantFor(rng() < 0.35), m = TREE[variant];
    if (!okSpot(lx, lz, m.trunkR * 1.4, m.canopyR * 1.25) || !apart(lx, lz, variant, 7 + 5 * rng())) continue;
    const fam = pickFamily(CROWN_TREES.riverMix);
    add(variant, lx, lz, { zone: 'riverine', fam, bark: fam }); river++;
  }

  // ---- ids (acacias first, then baobabs), final lists
  const acacias = trees.filter((t) => t.type === 'acacia'), baobabs = trees.filter((t) => t.type === 'baobab');
  acacias.forEach((t, i) => { t.id = `crown-acacia-${String(i + 1).padStart(3, '0')}`; });
  baobabs.forEach((t, i) => { t.id = `crown-baobab-${String(i + 1).padStart(2, '0')}`; });
  const items = [...acacias, ...baobabs];

  // ---- safe stand points (world) a few units south of a tree of each kind: debug goto / screenshots
  const standSouth = (t) => {
    for (let r = t.trunkR + 3; r < t.trunkR + 12; r += 1) for (const a of [Math.PI / 2, Math.PI / 2 + 0.5, Math.PI / 2 - 0.5, 0, Math.PI]) {
      const px = t.x + Math.cos(a) * r, pz = t.z + Math.sin(a) * r;
      if (mod.groundType(px, pz) === 'savanna' && mod.walkable(px, pz) && items.every((o) => Math.hypot(px - o.x, pz - o.z) > o.trunkR + 1.4)) return { x: +px.toFixed(2), z: +pz.toFixed(2) };
    }
    return null;
  };
  const first = (f) => { const t = items.find(f); return t ? standSouth(t) : null; };
  const spots = { plains: first((t) => t.zone === 'plains'), riverine: first((t) => t.zone === 'riverine'), baobab: first((t) => t.variant === 'baobab'), elder: first((t) => t.zone === 'elder-rock') };

  function hash() {
    let h = 2166136261 >>> 0;
    const mix = (v) => { const n = Math.round(v * 100); h = Math.imul(h ^ (n & 0xffff), 16777619) >>> 0; h = Math.imul(h ^ (n >> 16), 16777619) >>> 0; };
    for (const o of items) { mix(Object.keys(TREE).indexOf(o.variant) + 1); mix(o.fam); mix(o.bark); mix(o.x); mix(o.z); mix(o.s); mix(o.rot); }
    return h.toString(16).padStart(8, '0');
  }
  const countBy = (key) => items.reduce((a, o) => { a[o[key]] = (a[o[key]] || 0) + 1; return a; }, {});
  const range = (list, f) => (list.length ? [Math.min(...list.map(f)), Math.max(...list.map(f))].map((v) => +v.toFixed(2)) : null);
  const out = {
    items, acacias, baobabs, elders: baobabs.filter((t) => t.elder), spots, hash,
    summary: () => ({
      acacias: acacias.length, baobabs: baobabs.length, elders: baobabs.filter((t) => t.elder).length, variants: countBy('variant'), zones: countBy('zone'),
      acaciaFamilies: acacias.reduce((a, o) => { a[o.family] = (a[o.family] || 0) + 1; return a; }, {}), baobabFamilies: baobabs.reduce((a, o) => { a[o.family] = (a[o.family] || 0) + 1; return a; }, {}),
      acaciaHeight: range(acacias, (o) => o.height), acaciaWidth: range(acacias, (o) => o.canopyR * 2), baobabHeight: range(baobabs.filter((o) => !o.elder), (o) => o.height), elderHeight: range(baobabs.filter((o) => o.elder), (o) => o.height),
      baobabTrunkR: range(baobabs.filter((o) => !o.elder), (o) => o.trunkR), hash: hash(), spots,
    }),
  };
  cache.set(mod, out);
  return out;
}

/** The canopy volume the fade tests: a vertical cylinder (radius r, from the canopy's underside y0 to its top y1). */
export function fadeRecord(item) {
  return { id: item.id, x: item.x, z: item.z, r: item.canopyR * 0.92, y0: item.capUnder - 0.3, y1: item.capTop };
}
