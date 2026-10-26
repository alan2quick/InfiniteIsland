// Step 85a: the Crownlands' layout and terrain. The pure plan (islands/crownLayout.js), the plateau branch of the Duskcrown height module (ground types, walkability, paint masks) and the
// proof that nothing off the plateau moved: the marsh and the wall digests below were captured on the commit BEFORE Step 85 (HEAD 3f1e7c5) with the old flat 46 u top.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ISLANDS, WATER_LEVEL } from '../public/js/config.js';
import { getIslandModule } from '../public/js/world/islands/registry.js';
import { createDuskLayout, PLATEAU_TOP, CLIFF_W } from '../public/js/world/islands/duskLayout.js';
import { createDuskIsland } from '../public/js/world/islands/duskcrown.js';
import { createCrownLayout, getCrownLayout, CROWN } from '../public/js/world/islands/crownLayout.js';
import { meshExtent } from '../public/js/world/islands/extent.js';
import { getHeight, isWalkable } from '../public/js/world/terrain.js';
import { buildDuskPlacement } from '../public/js/world/islands/duskPlacement.js';
import { buildDuskFlora } from '../public/js/world/islands/duskFlora.js';
import { buildIslandTerrain } from '../public/js/world/terrainMesh.js';

const island = ISLANDS.find((i) => i.id === 'duskcrown');
const mod = getIslandModule('duskcrown');
const L = mod.layout, C = mod.crown;
const ix = island.x, iz = island.z;
const { halfX, halfZ } = meshExtent(island);

// ---- plan ---------------------------------------------------------------------------------------------------------------------------------------------------------------
test('the crown plan is deterministic and hash-pinned; another seed makes another plan', () => {
  const a = createCrownLayout(island, createDuskLayout(island)), b = createCrownLayout(island, createDuskLayout(island));
  assert.equal(a.hash(), b.hash());
  assert.equal(a.hash(), C.hash());
  assert.equal(getCrownLayout(island, L), C, 'cached per island');
  assert.equal(createCrownLayout({ ...island, seed: island.seed + 1 }, createDuskLayout({ ...island, seed: island.seed + 1 })).hash() === a.hash(), false);
  assert.equal(C.hash(), '5e575684');                                 // pinned: the plan of 85a, re-pinned in 85c when the pools were given their own bank (poolGroundD keeps a lower neighbour's apron from dragging a pool's bank under its water; update on purpose when the plateau is redesigned)
  assert.equal(L.hash(), '732b82e4');                                       // the marsh layout is untouched
  for (const [x, z] of [[880, 300], [850, 320], [900, 330], [760, 380]]) assert.equal(createDuskIsland(island).height(x, z), mod.height(x, z));
  const s = C.summary();
  assert.equal(s.hash, C.hash());
  assert.ok(s.relief.min === PLATEAU_TOP && s.relief.max >= 52 && s.relief.max <= 55.5, `relief ${s.relief.min} .. ${s.relief.max}`);
});

test('kopjes: 6-9 of 6-14 u across and 5-12 u tall, Crown Rock the biggest, one or two with a boulder-step ramp', () => {
  const K = C.kopjes;
  assert.ok(K.length >= 6 && K.length <= 9, `${K.length} kopjes`);
  for (const k of K) {
    assert.ok(2 * k.r >= 6 && 2 * k.r <= 14 && k.H >= 5 && k.H <= 12, k.id);
    assert.ok(C.edgeD(k.x, k.z) > 18, `${k.id} stands well inside the plateau`);
  }
  assert.equal(C.crownRock, K[0]);
  assert.equal(K.every((k) => k.r <= C.crownRock.r && k.H <= C.crownRock.H), true);
  const nearMiddle = Math.hypot(C.crownRock.x - (-10), C.crownRock.z - (-50));
  assert.ok(nearMiddle < 15, 'Crown Rock is near the middle of the north plain');
  const ramps = K.filter((k) => k.ramp);
  assert.ok(ramps.length >= 1 && ramps.length <= 2 && ramps.includes(C.crownRock));
  // the faces are sheer (unwalkable), the ramp is gentle, the tops are flat
  for (const k of K) {
    let blocked = 0, rays = 0;
    for (let a = 0; a < 24; a++) {
      const ca = Math.cos(a * Math.PI / 12), sa = Math.sin(a * Math.PI / 12);
      if (k.ramp && Math.hypot(ca - k.ramp.dir[0], sa - k.ramp.dir[1]) < 0.9) continue;                    // (the ramp side)
      rays++;
      let wall = false;
      for (let d = k.r * 0.3; d <= k.r * 1.35 + 1; d += 0.25) if (!isWalkable(ix + k.x + ca * d, iz + k.z + sa * d)) wall = true;
      if (wall) blocked++;
    }
    assert.equal(blocked, rays, `${k.id}: every way up the face is blocked (${blocked}/${rays})`);
    assert.equal(mod.groundType(ix + k.x, iz + k.z), 'kopje');
    assert.ok(Math.abs(getHeight(ix + k.x, iz + k.z) - k.topY) < 0.2, `${k.id} top ${getHeight(ix + k.x, iz + k.z)} vs ${k.topY}`);
  }
});

test('plunge pools, rivers and streams: pools sit under spill points, every water surface runs downhill, outlets are the marsh falls or the sea cliffs', () => {
  assert.ok(C.pools.length >= 6);
  const rivers = C.rivers.filter((r) => r.kind === 'river'), streams = C.rivers.filter((r) => r.kind === 'stream'), spills = C.rivers.filter((r) => r.kind === 'spill');
  assert.ok(rivers.length >= 3 && rivers.length <= 4, `${rivers.length} rivers`);
  assert.ok(streams.length >= 2 && spills.length >= 3 && spills.length <= 4);
  for (const r of C.rivers) {
    for (let i = 1; i < r.surf.length; i++) assert.ok(r.surf[i] <= r.surf[i - 1] + 1e-9, `${r.id} surface rises at point ${i}`);
    assert.ok(r.surf[0] > r.surf[r.surf.length - 1] - 1e-9);
    const pool = C.pools.find((p) => p.id === r.pool);
    assert.ok(pool && Math.hypot(r.pts[0][0] - pool.x, r.pts[0][1] - pool.z) < 0.01, `${r.id} starts at its pool`);
    assert.ok(r.surf[0] <= pool.surf + 1e-9, `${r.id} does not start above its pool`);
    for (const w of r.hw) assert.ok(2 * w >= 2.5 && 2 * w <= 4.0, `${r.id} width ${2 * w}`);
    r.pts.forEach(([x, z]) => assert.ok(L.cliffC(x, z) > -1 && L.coastT(x, z) > 0.5, `${r.id} stays on the plateau`));
    if (r.kind !== 'stream') assert.ok(r.surf[r.surf.length - 1] >= PLATEAU_TOP - 0.06 && r.surf[r.surf.length - 1] <= PLATEAU_TOP, 'the outlet water sits just under the rim');
  }
  // the three marsh falls each get a river; each outlet is at the fall's x +- 1 u
  for (const f of L.falls) {
    const r = rivers.find((q) => q.outlet.fall === f.id);
    assert.ok(r, `a river for ${f.id}`);
    assert.ok(Math.abs(r.outlet.x - f.x) <= 1 && Math.abs(r.pts[r.pts.length - 1][0] - f.x) <= 1, `${r.id} ends at x ${f.x}`);
    assert.ok(Math.abs(r.pts[r.pts.length - 1][1] - f.z) <= 1, `${r.id} ends on the cliff line`);
  }
  for (const r of spills) {                                                    // a short spill over the sea cliffs, north or east
    assert.equal(r.outlet.type, 'sea');
    assert.ok(L.coastT(r.outlet.x, r.outlet.z) <= 2.6 && L.coastT(r.outlet.x, r.outlet.z) > 1);
    assert.ok(r.length >= 8 && r.length <= 40);
  }
  assert.ok(spills.filter((r) => r.outlet.z < -50).length >= 2, 'two or three spills on the north coast');
  assert.ok(spills.some((r) => r.outlet.x > 120), 'one on the east arm');
  for (const s of streams) {                                                   // a stream ends on the surface of the river it joins
    const main = C.rivers.find((r) => r.key === s.outlet.river);
    let best = Infinity, surf = 0;
    for (let i = 0; i < main.pts.length - 1; i++) {
      const [ax, az] = main.pts[i], [bx, bz] = main.pts[i + 1], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz, u = Math.max(0, Math.min(1, ((s.outlet.x - ax) * dx + (s.outlet.z - az) * dz) / l2));
      const d = Math.hypot(ax + dx * u - s.outlet.x, az + dz * u - s.outlet.z);
      if (d < best) { best = d; surf = main.surf[i] + (main.surf[i + 1] - main.surf[i]) * u; }
    }
    assert.ok(best < 0.2 && Math.abs(surf - s.surf[s.surf.length - 1]) < 0.12, `${s.id} joins ${main.id} at the same water level (${surf} vs ${s.surf[s.surf.length - 1]})`);
  }
  // the wading channel: the floor sits 0.6 u under the surface (walkable), a pool's deep middle is not
  let checked = 0;
  for (const r of C.rivers) for (let i = 1; i < r.pts.length - 1; i++) {
    if (r.out[i] < 14) continue;
    if (C.rivers.some((q) => q !== r && q.pts.some((pt) => Math.hypot(pt[0] - r.pts[i][0], pt[1] - r.pts[i][1]) < 9))) continue;           // (a confluence has two beds)
    const [x, z] = r.pts[i];
    if (C.pools.some((p) => Math.hypot(x - p.x, z - p.z) < p.r * 1.3 + 3)) continue;
    const h = getHeight(ix + x, iz + z);
    assert.ok(Math.abs((r.surf[i] - h) - CROWN.wade) < 0.2, `${r.id}[${i}] floor ${(r.surf[i] - h).toFixed(2)} under the water`);
    assert.equal(isWalkable(ix + x, iz + z), true, `${r.id}[${i}] is wadeable`);
    assert.equal(mod.groundType(ix + x, iz + z), 'water');
    checked++;
  }
  assert.ok(checked > 25, `${checked} river nodes checked`);
  for (const p of C.pools) {
    const h = getHeight(ix + p.x, iz + p.z);
    assert.ok(p.surf - h > CROWN.deepBlock + 0.5, `${p.id} has a deep middle`);
    assert.equal(isWalkable(ix + p.x, iz + p.z), false, `${p.id} middle`);
    assert.equal(mod.groundType(ix + p.x, iz + p.z), 'water');
    let rim = 0;
    for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; if (isWalkable(ix + p.x + Math.cos(a) * p.r * 1.3, iz + p.z + Math.sin(a) * p.r * 1.3)) rim++; }
    assert.ok(rim >= 6, `${p.id} has a walkable rim (${rim}/8)`);
  }
});

test('floating islands (data only): 5-7 big ones 45-90 u up with spills right above plunge pools, 8-14 small rocks, a jump chain reachable from a kopje top', () => {
  const S = C.skyIslands;
  assert.ok(S.length >= 5 && S.length <= 7, `${S.length} islands`);
  assert.equal(new Set(S.map((s) => s.id)).size, S.length);
  const used = new Set();
  for (const s of S) {
    assert.ok(s.radius >= 9 && s.radius <= 22 && s.above >= 45 && s.above <= 90, s.id);
    assert.ok(s.spills.length >= 1 && s.spills.length <= 3 && s.pools.length >= 1 && s.pools.length <= 2, s.id);
    // the highest ground under the island is at least 40 u below its underside (the camera never sees it)
    let ground = -Infinity;
    for (let a = -s.radius; a <= s.radius; a += 2) for (let b = -s.radius; b <= s.radius; b += 2) if (a * a + b * b <= s.radius * s.radius) ground = Math.max(ground, getHeight(ix + s.x + a, iz + s.z + b));
    assert.ok(s.underside - ground >= CROWN.skyClear, `${s.id} underside ${s.underside} only ${(s.underside - ground).toFixed(1)} over ${ground.toFixed(1)}`);
    assert.ok(s.top - s.groundMax >= 45 - 1e-6 && s.top - s.groundMax <= 90 + 1e-6);
    assert.ok(s.depth > 5 && s.depth <= s.radius);
    for (const sp of s.spills) {
      const pool = C.pools.find((p) => p.id === sp.pool);
      assert.ok(pool && Math.hypot(sp.x - pool.x, sp.z - pool.z) < 0.01, `${sp.id} is directly above ${sp.pool}`);
      assert.ok(Math.hypot(sp.x - s.x, sp.z - s.z) <= s.edgeR(Math.atan2(sp.z - s.z, sp.x - s.x)) - 0.5, `${sp.id} is over the island's rim`);
      assert.ok(sp.y - pool.surf >= 40, `${sp.id} falls ${(sp.y - pool.surf).toFixed(0)} u`);
      assert.equal(used.has(sp.pool), false, 'one spill per pool'); used.add(sp.pool);
    }
    for (const q of s.pools) assert.ok(Math.hypot(q.x - s.x, q.z - s.z) + q.r < s.radius, `${s.id} summit pool inside the top`);
    // its top as a small pure height function, for the later travel step
    assert.ok(Math.abs(s.topHeight(s.x + s.radius * 0.1, s.z + s.radius * 0.1) - s.top) < 0.8);
    assert.equal(s.topHeight(s.x + s.radius * 1.4, s.z), null);
    let dry = 0;
    for (let k = 0; k < 8; k++) if (s.walkable(s.x + Math.cos(k * Math.PI / 4) * s.radius * 0.3, s.z + Math.sin(k * Math.PI / 4) * s.radius * 0.3)) dry++;
    assert.ok(dry >= 4, `${s.id} has dry ground on its top (${dry}/8)`);
    for (const q of s.pools) assert.equal(s.walkable(q.x, q.z), false, 'a summit pool is not walkable');
    assert.equal(s.walkable(s.x + s.radius * 1.1, s.z), false);
  }
  assert.equal(used.size, C.pools.length, 'every pool is under a spill');
  for (let a = 0; a < S.length; a++) for (let b = a + 1; b < S.length; b++) {
    const A = S[a], B = S[b];
    assert.ok(Math.hypot(A.x - B.x, A.z - B.z) >= A.radius + B.radius - 2 || Math.abs(A.top - B.top) >= 14, `${A.id} / ${B.id} overlap in plan and in height`);
  }
  const R = C.skyRocks;
  assert.ok(R.length >= 8 && R.length <= 14, `${R.length} rocks`);
  for (const r of R) assert.ok(2 * r.r >= 3 && 2 * r.r <= 8, r.id);
  assert.ok(C.chains.length >= 1);
  const ch = C.chains[0], from = C.kopjes.find((k) => k.id === ch.from.kopje);
  assert.equal(from, C.crownRock, 'the first chain climbs from Crown Rock');
  let px = from.x, pz = from.z, py = from.topY, pr = from.tiers[2].r;
  for (const id of ch.rocks) {
    const r = R.find((q) => q.id === id);
    const gap = Math.hypot(r.x - px, r.z - pz) - pr - r.r;
    assert.ok(gap <= CROWN.jumpGap && r.y - py <= CROWN.jumpRise && r.y > py, `${id}: gap ${gap.toFixed(1)} rise ${(r.y - py).toFixed(1)}`);
    px = r.x; pz = r.z; py = r.y; pr = r.r;
  }
  assert.ok(ch.rocks.length >= 4 && S.some((s) => s.id === ch.to));
});

// ---- terrain ------------------------------------------------------------------------------------------------------------------------------------------------------------
const inChannel = (x, z) => C.rivers.some((r) => {
  for (let i = 0; i < r.pts.length - 1; i++) {
    const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz, u = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
    if (Math.hypot(ax + dx * u - x, az + dz * u - z) < r.hw[i] + 1.2) return true;
  }
  return false;
});

test('the rim band is exactly the old flat 46 u, except the lip notches where a river spills over', () => {
  let rim = 0, notch = 0;
  for (let z = -halfZ; z <= halfZ; z += 1) for (let x = -halfX; x <= halfX; x += 1) {
    const c = L.cliffC(x, z), t = L.coastT(x, z);
    if (c < CLIFF_W + 1.6 || t < 4.6 + 1.6) continue;                               // (on the wall: its own shape; the noisy wall edge is within 1.5 u)
    if (C.edgeD(x, z) > 8) continue;
    const h = getHeight(ix + x, iz + z);
    if (inChannel(x, z)) { if (h < PLATEAU_TOP - 0.2) notch++; continue; }
    assert.equal(h, PLATEAU_TOP, `rim cell ${x},${z} (d ${C.edgeD(x, z).toFixed(1)}) is ${h}`);
    rim++;
  }
  assert.ok(rim > 3000 && notch > 20, `${rim} rim cells, ${notch} notch cells`);
  // the notch at each marsh fall: about 3 u wide, 0.6 u or more under the rim a little way back, and the lip itself is a shallow sill
  for (const r of C.rivers.filter((q) => q.kind === 'river')) {
    const at = (out) => { let i = 0; while (i < r.out.length - 1 && r.out[i + 1] >= out) i++; return r.pts[i]; };      // the last point still at least `out` from the outlet
    const back = at(13), o = r.outlet;
    const hBack = getHeight(ix + back[0], iz + back[1]);
    assert.ok(PLATEAU_TOP - hBack >= 0.45 && PLATEAU_TOP - hBack <= 0.9, `${r.id}: notch ${PLATEAU_TOP - hBack}`);
    // walking down the river towards the fall, the first point that is up on the plateau is the lip: a shallow sill (the water leaves over it), not a deep cut
    const [ex, ez] = r.pts[r.pts.length - 1], [px, pz] = r.pts[r.pts.length - 2], len = Math.hypot(ex - px, ez - pz);
    let lipH = -Infinity;
    for (let t = 0; t <= 6; t += 0.25) lipH = Math.max(lipH, getHeight(ix + ex + ((px - ex) / len) * t, iz + ez + ((pz - ez) / len) * t));
    assert.ok(lipH >= PLATEAU_TOP - 0.2 && lipH <= PLATEAU_TOP, `${r.id}: the sill at the lip is ${lipH}`);
    assert.ok(Math.abs(getHeight(ix + back[0] + 4.6, iz + back[1]) - PLATEAU_TOP) < 0.01, 'the rim beside the notch is untouched');
    assert.ok(Math.abs(o.x - back[0]) < 20);
  }
});

test('the plateau is a gentle savanna: swells up to a northern upland of about 52-54, plains walkable, kopje faces and pool middles not', () => {
  let lo = Infinity, hi = -Infinity, plains = 0, bad = 0, upland = 0;
  for (let z = -105; z <= 70; z += 1) for (let x = -160; x <= 160; x += 1) {
    if (C.edgeD(x, z) < 12) continue;
    const wx = ix + x, wz = iz + z, h = getHeight(wx, wz), g = mod.groundType(wx, wz);
    if (g === 'kopje' || g === 'water' || C.kopjeAt(x, z) > -Infinity) continue;                     // (a kopje's foot and a ramp's edges are meant to be steep)
    lo = Math.min(lo, h); hi = Math.max(hi, h); plains++;
    if (!isWalkable(wx, wz)) bad++;
    if (h >= 50) upland++;
  }
  assert.ok(bad <= 30, `${bad} plain cells are too steep (a few single steep spots beside the pool aprons are tolerated: under 0.25 %)`);
  assert.ok(bad / 13000 < 0.0025);
  assert.ok(lo >= PLATEAU_TOP - 0.6 && hi >= 51.5 && hi <= 55.4, `plains ${lo.toFixed(2)} .. ${hi.toFixed(2)}`);
  assert.ok(upland > 1000 && plains > 12000, `${upland} upland cells of ${plains}`);
  const types = new Set();
  for (let z = -105; z <= 70; z += 2) for (let x = -160; x <= 160; x += 2) if (C.edgeD(x, z) > 3) types.add(mod.groundType(ix + x, iz + z));
  for (const t of ['savanna', 'riverbank', 'kopje', 'water']) assert.ok(types.has(t), t);
  assert.equal(types.has('rock'), false, 'the plateau top is not placeholder rock any more');
  // paint masks exist on the plateau top only
  const top = mod.paintInfo(ix + 20, iz - 60, getHeight(ix + 20, iz - 60)).crown;
  assert.ok(top && top.up > 0.3 && top.kop === 0);
  assert.equal(mod.paintInfo(ix - 20, iz + 60, getHeight(ix - 20, iz + 60)).crown, null);
  assert.equal(mod.paintInfo(ix + 50, iz - 5, getHeight(ix + 50, iz - 5)).crown, null, 'the wall');
  const rock = mod.paintInfo(ix + C.crownRock.x, iz + C.crownRock.z, C.crownRock.topY).crown;
  assert.equal(rock.kop, 1);
  const lav = [];
  for (let z = -100; z < 40; z += 3) for (let x = -140; x < 150; x += 3) if (C.edgeD(x, z) > 14) { const p = mod.paintInfo(ix + x, iz + z, getHeight(ix + x, iz + z)).crown; if (p && p.lav > 0.2) lav.push(1); }
  assert.ok(lav.length > 100, 'lavender patches exist');
});

// ---- the marsh and the wall did not move --------------------------------------------------------------------------------------------------------------------------------------
test('nothing off the plateau moved: marsh heights + ground types, the wall, and the 69c / 69d placement hashes are bit-identical to the commit before Step 85', () => {
  const outlets = C.rivers.filter((r) => r.outlet.type !== 'join').map((r) => [r.outlet.x, r.outlet.z]);
  const digest = (pred, types) => {
    const h = createHash('sha1'), f = new Float64Array(1);
    let n = 0;
    for (let z = -halfZ; z <= halfZ; z += 2) for (let x = -halfX; x <= halfX; x += 2) {
      if (!pred(x, z)) continue;
      n++; f[0] = mod.height(ix + x, iz + z); h.update(Buffer.from(f.buffer));
      if (types) h.update(mod.groundType(ix + x, iz + z));
    }
    return [h.digest('hex').slice(0, 12), n];
  };
  const marsh = (x, z) => L.cliffC(x, z) < -0.5;
  const wall = (x, z) => ((L.cliffC(x, z) >= -0.5 && L.cliffC(x, z) < 3.6) || (L.cliffC(x, z) > 0 && L.coastT(x, z) > -3 && L.coastT(x, z) < 5)) && !outlets.some((o) => Math.hypot(x - o[0], z - o[1]) < 10);
  assert.deepEqual(digest(marsh, true), ['063465362df8', 10303]);
  assert.deepEqual(digest(wall, false), ['e670d6643649', 1187]);
  const P = buildDuskPlacement(island, mod), F = buildDuskFlora(island, mod);
  assert.deepEqual([P.hash(), F.hash()], ['a3374631', 'dc5f974e']);
});

// ---- walking ------------------------------------------------------------------------------------------------------------------------------------------------------------
function components() {
  const W = 2 * halfX + 1, H = 2 * halfZ + 1, walk = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) walk[j * W + i] = isWalkable(ix - halfX + i, iz - halfZ + j) ? 1 : 0;
  const comp = new Int32Array(W * H).fill(-1);
  let n = 0;
  for (let s = 0; s < W * H; s++) {
    if (!walk[s] || comp[s] >= 0) continue;
    const q = [s]; comp[s] = n;
    while (q.length) {
      const c = q.pop(), x = c % W, y = (c / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const k = ny * W + nx;
        if (walk[k] && comp[k] < 0) { comp[k] = n; q.push(k); }
      }
    }
    n++;
  }
  return { W, H, walk, comp, at: (lx, lz) => comp[Math.round(lz + halfZ) * W + Math.round(lx + halfX)] };
}

test('a walk from the crown spawn reaches the plains, the pool rims and the ramp kopje tops; never the marsh, a pool middle, a sheer kopje face or an unramped top; the landing still never reaches the plateau', () => {
  const g = components();
  const crown = g.at(C.spawn.x, C.spawn.z), landing = g.at(L.landing.x, L.landing.z);
  assert.ok(crown >= 0 && landing >= 0 && crown !== landing, 'the plateau and the marsh are separate pieces');
  assert.equal(isWalkable(ix + C.spawn.x, iz + C.spawn.z), true);
  assert.ok(Math.abs(getHeight(ix + C.spawn.x, iz + C.spawn.z) - PLATEAU_TOP) < 1e-9 && C.edgeD(C.spawn.x, C.spawn.z) < CROWN.riseFrom, 'the spawn is on the flat rim, at the top of the reserved notch');
  let reached = 0, marshCells = 0, deep = 0, faces = 0, strayTop = 0, plateauOfLanding = 0;
  const rampTops = C.kopjes.filter((k) => k.ramp);
  for (let j = 0; j < g.H; j++) for (let i = 0; i < g.W; i++) {
    const k = j * g.W + i;
    if (!g.walk[k]) continue;
    const lx = i - halfX, lz = j - halfZ, wx = ix + lx, wz = iz + lz, h = getHeight(wx, wz);
    if (g.comp[k] === landing && h > 6) plateauOfLanding++;
    if (g.comp[k] !== crown) continue;
    reached++;
    if (L.cliffC(lx, lz) < 0) marshCells++;
    if (C.waterDepth(lx, lz, h) > CROWN.deepBlock) deep++;
    if (mod.slopeAt(wx, wz, 0.4) >= 0.8) faces++;
    if (mod.groundType(wx, wz) === 'kopje' && !rampTops.some((r) => Math.hypot(lx - r.x, lz - r.z) < r.reach)) strayTop++;
  }
  assert.ok(reached > 20000, `${reached} cells`);
  assert.equal(marshCells, 0); assert.equal(deep, 0); assert.equal(faces, 0); assert.equal(strayTop, 0); assert.equal(plateauOfLanding, 0, '69a: the landing never reaches the plateau');
  for (const k of rampTops) assert.equal(g.at(k.x, k.z), crown, `${k.id}'s top is reachable by its ramp`);
  for (const k of C.kopjes.filter((q) => !q.ramp)) assert.notEqual(g.at(k.x, k.z), crown, `${k.id}'s top is a separate piece`);
  for (const p of C.pools) {
    let ring = 0;
    for (let k = 0; k < 8; k++) if (g.at(p.x + Math.cos(k * Math.PI / 4) * p.r * 1.3, p.z + Math.sin(k * Math.PI / 4) * p.r * 1.3) === crown) ring++;
    assert.ok(ring >= 6, `${p.id} rim (${ring}/8)`);
  }
  // the river wading channels are part of the walkable plain: every river's midpoint is reached
  for (const r of C.rivers) {
    const nodes = r.pts.filter(([x, z], i) => r.out[i] >= 6 && !C.pools.some((p) => Math.hypot(x - p.x, z - p.z) < p.r * 1.4));      // (not the pool's deep bowl, not the last stretch at the lip)
    const inside = nodes.filter(([x, z]) => g.at(x, z) === crown).length;
    assert.ok(nodes.length >= 1 && inside >= nodes.length * 0.8, `${r.id}: ${inside}/${nodes.length} of its nodes are on the walkable plain`);
  }
  for (const [name, s] of Object.entries(mod.spots())) {
    if (!/crown|Crown/.test(name)) continue;
    assert.ok(s, name);
    assert.equal(g.at(s.x - ix, s.z - iz), crown, `${name} is walkable and on the plateau`);
  }
  // the lanes and the reserved spots are walkable plain
  for (const lane of C.lanes) for (const [x, z] of lane) assert.equal(g.at(x, z), crown, 'lane point');
});

test('keep-clear: rim, water, kopjes, Crown Rock (14 u), the notch top, the spawn, the fall feet and the four lanes', () => {
  const reasons = new Set();
  for (let z = -105; z <= 70; z += 2) for (let x = -160; x <= 160; x += 2) { const r = C.keepClear(x, z, 1); if (r) reasons.add(r); }
  for (const r of ['offPlateau', 'rim', 'water', 'kopje', 'crownRock', 'ramp', 'fallFoot', 'notch', 'spawn', 'lane']) assert.ok(reasons.has(r), r);
  assert.equal(C.lanes.length, 4);
  const cr = C.crownRock;
  for (let a = 0; a < 16; a++) assert.ok(C.keepClear(cr.x + Math.cos(a * Math.PI / 8) * 13.5, cr.z + Math.sin(a * Math.PI / 8) * 13.5) !== null || C.edgeD(cr.x, cr.z) < 0, 'Crown Rock keeps 14 u clear');
  assert.ok(['spawn', 'notch'].includes(C.keepClear(C.spawn.x, C.spawn.z)));
  assert.ok(['spawn', 'notch', 'rim'].includes(C.keepClear(C.notchTop.x, C.notchTop.z)));
  let free = 0;
  for (let z = -100; z <= 40; z += 4) for (let x = -150; x <= 150; x += 4) if (!C.keepClear(x, z, 3)) free++;
  assert.ok(free > 200, `${free} free tree spots`);
  // the rim: 6 u band is never free
  for (let x = -140; x <= 150; x += 5) for (let z = -105; z <= 70; z += 5) if (C.edgeD(x, z) >= 0 && C.edgeD(x, z) < 6) assert.ok(C.keepClear(x, z), 'inside the 6 u rim');
  assert.equal(C.notchTop.x, -56.88);
});

test('the lid envelope is an upper bound of the plateau, and the 8 u lattice has no gaps off it', () => {
  let n = 0;
  for (let z = -110; z <= 90; z += 3) for (let x = -170; x <= 175; x += 3) {
    if (L.cliffC(x, z) <= 0 || L.coastT(x, z) <= 2) continue;
    assert.ok(C.lidTop(x, z) >= C.topAt(x, z) - 1e-6, `lid bound at ${x},${z}`);
    n++;
  }
  assert.ok(n > 3000);
  assert.equal(C.lidTop(-170, 80) < 40, true);
});

test('the terrain mesh keeps its ~1 u cells: a river is at least two cells wide, and the plateau fits the mesh', () => {
  const near = buildIslandTerrain(island);
  try {
    const box = near.group.children.reduce((b, m) => b.union(m.geometry.boundingBox), near.group.children[0].geometry.boundingBox.clone());
    const cell = (2 * halfX) / (near.group.children[0].geometry.attributes.position.count > 0 ? 8 * Math.sqrt(near.group.children[0].geometry.attributes.position.count) : 1);
    assert.ok(box.max.y > 58 && box.max.y < 64, `top ${box.max.y}`);
    assert.ok(box.min.y > -3.01 && cell > 0);
    for (const r of C.rivers) assert.ok(2 * Math.min(...r.hw) >= 2.5, 'rivers are 2.5 u wide at least: 2-3 mesh cells');
    assert.ok(WATER_LEVEL === 0);
  } finally { near.dispose(); }
});
