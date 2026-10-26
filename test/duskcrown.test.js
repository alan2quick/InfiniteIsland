// Step 69a: Duskcrown Isle's terrain. Pure layout + height module (islands/duskLayout.js, duskcrown.js), the rectangular mesh extents (islands/extent.js, terrainMesh.js,
// water.js) and the proof that the OLD islands are bit-identical after generalising the square-per-island assumption (the mesh hashes below were captured BEFORE the change).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ISLANDS, ISLAND_MESH_MARGIN, WATER_LEVEL, DEEP_WATER_BLOCK, WORLD_SIZE, REGION_VIEW } from '../public/js/config.js';
import { getIslandModule } from '../public/js/world/islands/registry.js';
import { createDuskLayout, PLATEAU_TOP } from '../public/js/world/islands/duskLayout.js';
import { createDuskIsland } from '../public/js/world/islands/duskcrown.js';
import { meshExtent, frameExtent, islandGap, isRectangular } from '../public/js/world/islands/extent.js';
import { regionOf, getHeight, getTerrainHeight, isWalkable, setNoclip, getNoclip, inlandDistance } from '../public/js/world/terrain.js';
import { buildIslandTerrain, buildFarTerrain } from '../public/js/world/terrainMesh.js';
import { travelAllowed } from '../public/js/game/travelLogic.js';
import { createPlayerMemory } from '../public/js/game/playerMemory.js';
import { createRegions } from '../public/js/world/regions.js';

const island = ISLANDS.find((i) => i.id === 'duskcrown');
const mod = getIslandModule('duskcrown');
const L = mod.layout;
const rects = ISLANDS.map((i) => {
  const e = i.id === 'home' ? { halfX: WORLD_SIZE / 2, halfZ: WORLD_SIZE / 2 } : meshExtent(i);
  return { id: i.id, x0: i.x - e.halfX, x1: i.x + e.halfX, z0: i.z - e.halfZ, z1: i.z + e.halfZ };
});

test('the island is a 330 x 220 u coast inside its mesh rectangle, with room to spare', () => {
  const d = mod.measure();
  assert.ok(d.depth >= 200 && d.depth <= 235, `north-south ${d.depth}`);
  assert.ok(d.width >= 305 && d.width <= 350, `east-west ${d.width}`);
  const { halfX, halfZ } = meshExtent(island);
  assert.deepEqual([halfX, halfZ], [frameExtent(island).halfX + ISLAND_MESH_MARGIN, frameExtent(island).halfZ + ISLAND_MESH_MARGIN]);
  for (const edge of [-d.coast.x0, d.coast.x1]) assert.ok(halfX - edge >= 10, 'coast clear of the mesh edge in x');
  for (const edge of [-d.coast.z0, d.coast.z1]) assert.ok(halfZ - edge >= 10, 'coast clear of the mesh edge in z');
  // the sea floor is exactly the sea floor on the mesh rectangle's edge (no seam)
  for (const t of [-0.99, 0, 0.5, 0.99]) {
    assert.equal(getTerrainHeight(island.x + halfX * 0.999, island.z + t * halfZ), -3);
    assert.equal(getTerrainHeight(island.x + t * halfX, island.z - halfZ * 0.999), -3);
  }
});

test('mesh rectangles never overlap, and Duskcrown is past the fog from every other island', () => {
  const me = rects.find((r) => r.id === 'duskcrown');
  for (const o of rects) {
    if (o === me) continue;
    const overlap = Math.min(me.x1, o.x1) - Math.max(me.x0, o.x0) > 0 && Math.min(me.z1, o.z1) - Math.max(me.z0, o.z0) > 0;
    assert.equal(overlap, false, `duskcrown overlaps ${o.id}`);
    const gapX = Math.max(o.x0 - me.x1, me.x0 - o.x1, 0), gapZ = Math.max(o.z0 - me.z1, me.z0 - o.z1, 0);
    assert.ok(Math.hypot(gapX, gapZ) >= 330, `${o.id} is only ${Math.hypot(gapX, gapZ).toFixed(0)} u from the mesh`);
  }
  for (let a = 0; a < rects.length; a++) for (let b = a + 1; b < rects.length; b++) {
    const A = rects[a], B = rects[b];
    assert.equal(Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0) > 1e-6 && Math.min(A.z1, B.z1) - Math.max(A.z0, B.z0) > 1e-6, false, `${A.id} / ${B.id}`);
  }
});

test('extents: classic islands keep radius + margin and hypot - radius exactly; a rectangular one gets its frame', () => {
  for (const i of ISLANDS.filter((i) => i.id !== 'duskcrown')) {
    assert.equal(isRectangular(i), false);
    assert.deepEqual(meshExtent(i), { halfX: i.radius + ISLAND_MESH_MARGIN, halfZ: i.radius + ISLAND_MESH_MARGIN });
    for (const [x, z] of [[0, 0], [300, -40], [-120, 90], [i.x + 3, i.z - 8]]) assert.equal(islandGap(i, x, z), Math.hypot(x - i.x, z - i.z) - i.radius);
  }
  assert.equal(isRectangular(island), true);
  assert.ok(islandGap(island, island.x, island.z) < -100);                                       // the centre is deep inside
  assert.ok(Math.abs(islandGap(island, island.x + 172 + 50, island.z) - 50) < 1e-6);            // on the long axis the gap is exact
  assert.ok(Math.abs(islandGap(island, island.x, island.z - 118 - 70) - 70) < 1e-6);
  const regions = createRegions({ islands: ISLANDS, ...REGION_VIEW });
  regions.update(0, 0, true);
  assert.ok(!regions.isFull('duskcrown'));
  regions.update(island.x, island.z + 100, true);
  assert.equal(regions.view, 'duskcrown');
  assert.deepEqual(regions.summary().full, ['duskcrown']);
});

test('ponds: 25-40 with stable ids, radius 3-12, never overlapping, wadeable rims and unwalkable deep middles', () => {
  const ponds = mod.ponds;
  assert.ok(ponds.length >= 25 && ponds.length <= 40, `${ponds.length} ponds`);
  assert.equal(new Set(ponds.map((p) => p.id)).size, ponds.length);
  ponds.forEach((p, i) => assert.equal(p.id, `dusk-pond-${String(i + 1).padStart(2, '0')}`));
  for (const p of ponds) {
    assert.ok(p.r >= 3 && p.r <= 12 && p.depth >= 1 && p.depth <= 2.3, p.id);
    const cx = island.x + p.x, cz = island.z + p.z;
    assert.ok(getHeight(cx, cz) < WATER_LEVEL - DEEP_WATER_BLOCK - 0.3, `${p.id} middle is deep`);
    assert.equal(isWalkable(cx, cz), false, `${p.id} middle`);
    assert.equal(mod.groundType(cx, cz), 'water');
    let rim = 0;
    for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; if (isWalkable(cx + Math.cos(a) * p.r * 1.15, cz + Math.sin(a) * p.r * 1.15)) rim++; }
    assert.ok(rim >= 6, `${p.id} has a walkable rim (${rim}/8)`);
  }
  for (let a = 0; a < ponds.length; a++) for (let b = a + 1; b < ponds.length; b++) {
    assert.ok(Math.hypot(ponds[a].x - ponds[b].x, ponds[a].z - ponds[b].z) >= ponds[a].r + ponds[b].r + 4, `${ponds[a].id} / ${ponds[b].id} overlap`);
  }
  // the lagoon: deep unwalkable middle past a walkable shallow rim, like home's pond
  const lg = mod.lagoon;
  assert.equal(isWalkable(island.x + lg.x, island.z + lg.z), false);
  assert.ok(getHeight(island.x + lg.x, island.z + lg.z) < -0.5);
  assert.equal(isWalkable(island.x + lg.x - lg.rx * 1.1, island.z + lg.z), true);
});

// 1 u grid over the mesh rectangle: the walkable cells, their 4-connected components, and the component of the landing
function walkComponents() {
  const { halfX, halfZ } = meshExtent(island), W = 2 * halfX + 1, H = 2 * halfZ + 1, walk = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) walk[j * W + i] = isWalkable(island.x - halfX + i, island.z - halfZ + j) ? 1 : 0;
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
  return { W, H, halfX, halfZ, walk, comp, at: (wx, wz) => comp[Math.round(wz - island.z + halfZ) * W + Math.round(wx - island.x + halfX)] };
}

test('walking from the landing reaches the whole marsh, never the Crownlands or deep water; the plateau is 40+ u above the marsh', () => {
  const g = walkComponents();
  const landing = g.at(island.x + L.landing.x, island.z + L.landing.z);
  assert.ok(landing >= 0, 'the landing is walkable');
  let marsh = 0, marshMax = -Infinity, reachedTop = 0, topCells = 0, stranded = 0, deepReached = 0;
  for (let j = 0; j < g.H; j++) for (let i = 0; i < g.W; i++) {
    const k = j * g.W + i;
    if (!g.walk[k]) continue;
    const x = island.x - g.halfX + i, z = island.z - g.halfZ + j, h = getHeight(x, z), c = L.cliffC(x - island.x, z - island.z);
    if (g.comp[k] === landing) {
      marsh++; marshMax = Math.max(marshMax, h);
      if (h > 6) reachedTop++;
      if (h < WATER_LEVEL - DEEP_WATER_BLOCK) deepReached++;
    } else if (c < -2) stranded++;                                // walkable marsh-side ground the party could not reach
    else topCells++;
  }
  assert.equal(reachedTop, 0, 'no cliff or plateau cell is reachable');
  assert.equal(deepReached, 0);
  assert.equal(stranded, 0, 'every walkable marsh cell is connected to the landing');
  assert.ok(topCells > 10000, 'the plateau top exists (and is a separate piece)');
  assert.ok(marsh > 15000);
  assert.ok(marshMax <= 2.6 && marshMax >= 2.0, `marsh hummocks reach ${marshMax.toFixed(2)}`);
  assert.ok(PLATEAU_TOP - marshMax >= 40, 'the plateau top is at least 40 u above the swamp');
  assert.equal(getHeight(island.x + 20, island.z + L.cliffZAt(20) - 9), PLATEAU_TOP);            // (the rim band is the flat 46; Step 85a lifts the rest to an upland of about 52-54)
  assert.ok(getHeight(island.x + 20, island.z - 60) > 49 && getHeight(island.x + 20, island.z - 60) < 55);
  // the cliff is unwalkable in plan view: a north-south line across the wall always meets unwalkable ground
  for (let x = -150; x <= 70; x += 10) {
    const z0 = L.cliffZAt(x);
    let blocked = false;
    for (let dz = -12; dz <= 12; dz += 0.5) if (!isWalkable(island.x + x, island.z + z0 + dz)) blocked = true;
    assert.ok(blocked, `no way across the north cliff at x ${x}`);
  }
  // the landing is a sandy beach; marsh, mud and water ground types exist
  assert.equal(mod.groundType(island.x + L.landing.x, island.z + L.landing.z), 'sand');
  const types = new Set();
  for (let x = -150; x < 60; x += 3) for (let z = 10; z < 90; z += 3) types.add(mod.groundType(island.x + x, island.z + z));
  for (const t of ['marsh', 'mud', 'water']) assert.ok(types.has(t), t);
});

test('the layout is deterministic: the same seed gives the same plan, a different one does not', () => {
  const a = createDuskLayout(island), b = createDuskLayout(island);
  assert.equal(a.hash(), b.hash());
  assert.equal(a.hash(), L.hash());
  assert.equal(createDuskLayout({ ...island, seed: island.seed + 1 }).hash() === a.hash(), false);
  assert.equal(L.hash(), '732b82e4');                                    // pinned: the plan of 69a (update on purpose when the layout is redesigned)
  const m2 = createDuskIsland(island);
  for (const [x, z] of [[865, 448], [850, 368], [900, 420], [760, 400], [1000, 300]]) assert.equal(m2.height(x, z), mod.height(x, z));
  assert.equal(L.streams.length, 3);
  assert.equal(L.falls.length, 3);
});

test('the island has a region of its own, no bridge and no travel target (the boat is the way; friends only once discovered)', () => {
  assert.equal(regionOf(island.x + L.landing.x, island.z + L.landing.z), 'duskcrown');
  assert.ok(inlandDistance(island.x + L.landing.x, island.z + L.landing.z) > 0);
  assert.equal(regionOf(island.x + 500, island.z), 'sea');
  assert.equal(travelAllowed('duskcrown', () => true), false);
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k), setItem: (k, v) => store.set(k, v) };
  try {
    const memory = createPlayerMemory();
    memory.remember(0, 'frost', null);
    memory.remember(0, 'duskcrown', null);
    assert.equal(memory.get(0).zone, 'duskcrown', 'Step 71: Duskcrown is a remembered zone (main.js only writes it while the boat is moored there, and never for ?duskcrown)');
  } finally { delete globalThis.localStorage; }
});

test('noclip (debug) makes only Duskcrown walkable, everywhere, and switches off cleanly', () => {
  const cliff = [island.x + 20, island.z + L.cliffZAt(20) - 1.7], top = [island.x + 20, island.z - 60], deep = [island.x + mod.lagoon.x, island.z + mod.lagoon.z], emberSea = [300, 260];
  assert.equal(getNoclip(), null);
  for (const p of [cliff, deep]) assert.equal(isWalkable(...p), false);
  setNoclip('duskcrown');
  try {
    for (const p of [cliff, top, deep]) assert.equal(isWalkable(...p), true);
    assert.equal(isWalkable(...emberSea), false);                       // open sea elsewhere stays closed
    assert.equal(isWalkable(0, 0), true);
  } finally { setNoclip(null); }
  for (const p of [cliff, deep]) assert.equal(isWalkable(...p), false);
});

// ---- the old islands are bit-identical after the rectangular-extents refactor ---------------------------------------------------------------------------------------------
// Hashes of the terrain meshes (positions, normals, colours, grass attribute of the first chunk, the index buffers, the chunk bounds, the far mesh), captured on the commit BEFORE Step 69a.
const MESH_BEFORE = {
  home: { near: 'f1e6ad2c05a4', idx: '463c9a577579', bs: '4d5229170cad', far: '2dbad7467207' },
  frost: { near: '4b964ebd8a1b', idx: '463c9a577579', bs: 'c5a4f82fde06', far: '6c32d080a0fe' },
  ember: { near: '27e37183e06b', idx: '463c9a577579', bs: '8902fbe50937', far: 'a4671425d3cd' },
  story: { near: '0ee3b72d283b', idx: '463c9a577579', bs: '7082f53c6988', far: '6236e117a5f2' },
};
test('home, Frostpine, Emberleaf and Storybook Cay build exactly the same terrain meshes as before', () => {
  const hashGeos = (geos) => { const h = createHash('sha1'); for (const g of geos) for (const k of ['position', 'normal', 'color', 'aGrass']) { const a = g.attributes[k]; h.update(Buffer.from(a.array.buffer, a.array.byteOffset, a.array.byteLength)); } return h.digest('hex').slice(0, 12); };
  for (const [id, want] of Object.entries(MESH_BEFORE)) {
    const isl = ISLANDS.find((i) => i.id === id);
    const near = buildIslandTerrain(isl), geos = near.group.children.map((m) => m.geometry);
    const idx = createHash('sha1');
    for (const g of geos) idx.update(Buffer.from(g.index.array.buffer, g.index.array.byteOffset, g.index.array.byteLength));
    const bs = geos.map((g) => g.boundingSphere.center.toArray().concat(g.boundingSphere.radius).map((v) => +v.toFixed(3)).join(',')).join('|');
    const far = buildFarTerrain(isl);
    assert.equal(geos.length, 64);
    assert.deepEqual({ near: hashGeos([geos[0]]), idx: idx.digest('hex').slice(0, 12), bs: createHash('sha1').update(bs).digest('hex').slice(0, 12), far: hashGeos([far.mesh.geometry]) }, want, id);
    near.dispose(); far.dispose();
  }
});

test('the rectangular island meshes: 8 x 8 chunks over a 368 x 260 u rectangle, ~1 u cells, far version in proportion', () => {
  const near = buildIslandTerrain(island), far = buildFarTerrain(island);
  try {
    assert.equal(near.group.children.length, 64);
    const box = near.group.children.reduce((b, m) => b.union(m.geometry.boundingBox), near.group.children[0].geometry.boundingBox.clone());
    const e = meshExtent(island);
    assert.ok(Math.abs((box.max.x - box.min.x) - 2 * e.halfX) < 1e-6 && Math.abs((box.max.z - box.min.z) - 2 * e.halfZ) < 1e-6);
    assert.ok(Math.abs((box.min.x + box.max.x) / 2 - island.x) < 1e-6 && Math.abs((box.min.z + box.max.z) / 2 - island.z) < 1e-6);
    assert.ok(box.max.y >= PLATEAU_TOP + 8 && box.max.y <= 66 && box.min.y >= -3.0001);
    const pos = far.mesh.geometry.attributes.position, cols = new Set();
    for (let i = 0; i < pos.count; i++) cols.add(pos.getX(i).toFixed(3));
    assert.ok(cols.size >= 90 && cols.size <= 100, `${cols.size} far columns`);
  } finally { near.dispose(); far.dispose(); }
});
