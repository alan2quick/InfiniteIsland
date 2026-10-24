// Step 27a: multi-island terrain. The golden test pins the home island to the values captured BEFORE the archipelago refactor
// (test/fixtures/homeTerrain.json, see genHomeTerrain.mjs); the rest covers regions, the new islands and the bridge deck.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  getHeight, getTerrainHeight, getGroundType, isWalkable, regionOf, islandAt, setBridgeOpen, isBridgeOpen,
  inlandDistance, getBridge, getIslandModule,
} from '../public/js/world/terrain.js';
import { ISLANDS, BRIDGES, WATER_LEVEL, ISLAND_MESH_MARGIN } from '../public/js/config.js';
import { ritualIslandDistance, ritualPathDistance, ritualChannelDistance } from '../public/js/world/islands/ritual.js';

const golden = JSON.parse(readFileSync(new URL('./fixtures/homeTerrain.json', import.meta.url), 'utf8'));

test('home island outside the ritual annex matches the pre-refactor golden samples within floating-point precision', () => {
  let bad = 0;
  for (let i = 0; i < golden.count; i++) {
    const x = golden.xz[i * 2], z = golden.xz[i * 2 + 1];
    // Only the new annex and its slope-sampling fringe intentionally replace original terrain.
    if (ritualIslandDistance(x, z) < 12.8 || ritualPathDistance(x, z) < 5.9 || ritualChannelDistance(x, z) < 6.5) continue;
    // Node/V8 versions can differ in the last bits of trigonometric results.
    // 1e-12 world units is far below visual or collision precision.
    const height = getHeight(x, z);
    if (!Number.isFinite(height) || Math.abs(height - golden.h[i]) > 1e-12) bad++;
    else if (getGroundType(x, z) !== golden.types[golden.g[i]]) bad++;
    else if ((isWalkable(x, z) ? 1 : 0) !== golden.w[i]) bad++;
  }
  assert.equal(bad, 0);
  assert.ok(golden.count > 3000);
});

const island = (id) => ISLANDS.find((i) => i.id === id);
const half = (i) => i.radius + ISLAND_MESH_MARGIN;

test('island squares never overlap', () => {
  const boxes = ISLANDS.map((i) => { const h = i.id === 'home' ? 75 : half(i); return { id: i.id, x0: i.x - h, x1: i.x + h, z0: i.z - h, z1: i.z + h }; });
  for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
    const A = boxes[a], B = boxes[b];
    const overlap = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0) > 1e-6 && Math.min(A.z1, B.z1) - Math.max(A.z0, B.z0) > 1e-6;
    assert.equal(overlap, false, `${A.id} overlaps ${B.id}`);
  }
});

test('regionOf', () => {
  assert.equal(regionOf(0, 0), 'home');
  assert.equal(regionOf(2, 12), 'home');
  assert.equal(regionOf(10, -50), 'home');
  assert.equal(regionOf(0, -197), 'frost');
  assert.equal(regionOf(197, 47), 'ember');
  assert.equal(regionOf(10, -66), 'sea');          // the gap towards frost
  assert.equal(regionOf(66, 0), 'sea');            // the gap towards ember
  assert.equal(regionOf(-300, 300), 'sea');
  assert.equal(regionOf(1000, 1000), 'sea');
  assert.equal(islandAt(0, -197).id, 'frost');
  assert.equal(islandAt(197, 47).name, 'Emberleaf Isle');
  assert.equal(islandAt(500, 0), null);
  for (const i of ISLANDS) assert.equal(regionOf(i.x, i.z), i.id);
});

test('open sea is the sea floor and not walkable', () => {
  for (const [x, z] of [[400, 400], [-90, 90], [10, -66], [66, 0], [150, -150]]) {
    assert.equal(getHeight(x, z), -3);
    assert.equal(isWalkable(x, z), false);
    assert.equal(getGroundType(x, z), 'water');
  }
});

/** Coarse scan of an island's square: counts and the ground types seen. */
function scan(id, step = 2) {
  const i = island(id), h = half(i);
  const types = new Map();
  let land = 0, finite = true;
  for (let z = i.z - h; z <= i.z + h; z += step) for (let x = i.x - h; x <= i.x + h; x += step) {
    const y = getHeight(x, z);
    if (!Number.isFinite(y)) finite = false;
    const g = getGroundType(x, z);
    types.set(g, (types.get(g) || 0) + 1);
    if (y > WATER_LEVEL + 0.2) land++;
  }
  return { types, land, finite };
}

test('frost island: finite heights, beach ring, snow, rock, ice, tall plateau, ice is walkable', () => {
  const s = scan('frost');
  assert.ok(s.finite);
  for (const t of ['sand', 'wetsand', 'grass', 'snow', 'rock', 'ice', 'water']) assert.ok(s.types.get(t) > 20, `frost has ${t}`);
  assert.ok(s.land * 4 > 25000, 'frost is big (about 4x home area)');
  const f = island('frost');
  assert.ok(getHeight(f.x, f.z - 44) > 6, 'alpine plateau is higher than home plateau (3.5)');
  const lake = { x: f.x + 52, z: f.z + 38 };
  assert.equal(getGroundType(lake.x, lake.z), 'ice');
  assert.ok(isWalkable(lake.x, lake.z));
  assert.ok(getHeight(lake.x, lake.z) > WATER_LEVEL + 0.2, 'frozen lake is above the ocean plane');
});

test('ember island: finite heights, beaches, jungle, volcano, lava is never walkable, lagoon and hot spring', () => {
  const s = scan('ember');
  assert.ok(s.finite);
  for (const t of ['sand', 'blacksand', 'wetsand', 'grass', 'rock', 'lava', 'hotspring', 'water']) assert.ok(s.types.get(t) > 8, `ember has ${t}`);
  const e = island('ember');
  let peak = -Infinity;
  for (let k = 0; k < 16; k++) peak = Math.max(peak, getHeight(e.x + 15 + Math.cos(k * 0.3927) * 11, e.z - 5 + Math.sin(k * 0.3927) * 11));
  assert.ok(peak > 12 && peak < 17, `rim peak ${peak}`);
  let lavaCells = 0;
  for (let z = e.z - 40; z <= e.z + 30; z += 0.5) for (let x = e.x - 20; x <= e.x + 50; x += 0.5) {
    if (getGroundType(x, z) === 'lava') { lavaCells++; assert.equal(isWalkable(x, z), false); }
  }
  assert.ok(lavaCells > 50);
  assert.equal(getGroundType(e.x + 15, e.z - 5), 'lava');
  assert.ok(getHeight(e.x - 45, e.z + 52) < WATER_LEVEL - 0.35, 'lagoon is below the waterline');
  const spring = { x: e.x + 58, z: e.z - 52 };
  assert.equal(getGroundType(spring.x, spring.z), 'hotspring');
  assert.ok(isWalkable(spring.x, spring.z));
});

/** BFS over isWalkable on a 1 u grid from (sx, sz), limited to +-box; returns { n, has(x, z) } (cells are rounded to the grid). */
function flood(sx, sz, box) {
  const key = (i, j) => (i + 1000) * 4001 + (j + 1000);
  const seen = new Set([key(0, 0)]);
  const visited = new Set();
  const stack = [[0, 0]];
  while (stack.length) {
    const [i, j] = stack.pop();
    visited.add(key(i, j));
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di, b = j + dj;
      const k = key(a, b);
      if (seen.has(k) || Math.abs(a) > box || Math.abs(b) > box) continue;
      seen.add(k);
      if (isWalkable(sx + a, sz + b)) stack.push([a, b]);
    }
  }
  return { n: visited.size, has: (x, z) => visited.has(key(Math.round(x - sx), Math.round(z - sz))) };
}

// Interior spots that must be walkable on foot from the bridge landing (ramps up the plateau / volcano, lake, spring ...).
const MUST_REACH = {
  frost: [[0, -44], [0, -70], [-20, -44], [20, -44], [52, 38], [0, 0], [-80, 0], [80, 0], [0, 60]],
  ember: [[-5, -5], [35, -5], [15, -25], [15, 15], [26, -5], [15, -16], [58, -52], [-45, 30], [0, 60]],   // incl. the viewing ledge and crater rim
  story: [[2.5, 8.5], [9.5, 2.5], [-6, -3], [-27, -22], [22, -20], [-20, 20], [0, 30], [-35, 0]],        // the book stand, Quill's nook, the book, the hill top, the ink pond, the far meadow
};

for (const br of BRIDGES) {
  test(`bridge ${br.id}: both landings walkable beach, island landing connects across the island`, () => {
    const to = island(br.to), from = island(br.from);
    for (const [x, z, isl] of [[br.ax, br.az, from], [br.bx, br.bz, to]]) {
      assert.ok(isWalkable(x, z), `landing (${x}, ${z}) walkable`);
      const h = getHeight(x, z);
      assert.ok(h > 0.05 && h < 0.8, `landing on beach tier (h=${h})`);
      assert.equal(regionOf(x, z), isl.id);
      assert.ok(['sand', 'blacksand'].includes(getGroundType(x, z)), `beach ground ${getGroundType(x, z)}`);
    }
    // Everything walkable on the destination island must be reachable from its landing (deck closed), bar tiny leftovers.
    const mod = getIslandModule(br.to);
    const box = Math.round(half(to) + 2);
    const fl = flood(br.bx, br.bz, box + Math.abs(br.bx - to.x) + Math.abs(br.bz - to.z));
    const reached = fl.n;
    for (const [lx, lz] of MUST_REACH[br.id]) {
      assert.ok(isWalkable(to.x + lx, to.z + lz), `${br.id} (${lx}, ${lz}) walkable`);
      assert.ok(fl.has(to.x + lx, to.z + lz), `${br.id} (${lx}, ${lz}) reachable on foot from the landing`);
    }
    let walkable = 0;
    for (let dz = -half(to); dz <= half(to); dz++) for (let dx = -half(to); dx <= half(to); dx++) if (mod.walkable(to.x + dx, to.z + dz)) walkable++;
    assert.ok(reached / walkable > 0.93, `${br.id}: ${reached} of ${walkable} walkable cells reachable (${(100 * reached / walkable).toFixed(1)}%)`);
  });

  test(`bridge ${br.id}: deck closed -> mid-span water; open -> walkable centre line, not beyond width/2`, () => {
    const b = getBridge(br.id);
    assert.ok(b);
    const dx = br.bx - br.ax, dz = br.bz - br.az, L = Math.hypot(dx, dz);
    const ux = dx / L, uz = dz / L, nx = -uz, nz = ux;
    const mid = { x: br.ax + dx / 2, z: br.az + dz / 2 };
    assert.equal(isBridgeOpen(br.id), false);
    assert.equal(isWalkable(mid.x, mid.z), false);
    assert.equal(regionOf(mid.x, mid.z), 'sea');
    setBridgeOpen(br.id, true);
    try {
      assert.equal(isBridgeOpen(br.id), true);
      for (let s = 0.05; s <= 0.951; s += 0.05) {
        const x = br.ax + dx * s, z = br.az + dz * s;
        assert.ok(isWalkable(x, z), `centre line walkable at s=${s.toFixed(2)}`);
        assert.ok(isWalkable(x + nx * (br.width / 2 - 0.1), z + nz * (br.width / 2 - 0.1)), `deck edge walkable at s=${s.toFixed(2)}`);
      }
      assert.ok(getHeight(mid.x, mid.z) > WATER_LEVEL + 0.5, 'deck arches above the water');
      assert.equal(getGroundType(mid.x, mid.z), br.surface);
      assert.equal(getTerrainHeight(mid.x, mid.z), -3, 'terrain-only height ignores the deck');
      // beyond the deck's sides it is deep water again
      assert.equal(isWalkable(mid.x + nx * (br.width / 2 + 0.3), mid.z + nz * (br.width / 2 + 0.3)), false);
      assert.equal(isWalkable(mid.x + nx * 6, mid.z + nz * 6), false);
      // the deck is continuous: height changes gently along the span
      let prev = getHeight(br.ax, br.az);
      for (let s = 0.01; s <= 1.0001; s += 0.01) {
        const y = getHeight(br.ax + dx * s, br.az + dz * s);
        assert.ok(Math.abs(y - prev) < 0.12, `deck smooth at s=${s.toFixed(2)} (${prev.toFixed(2)} -> ${y.toFixed(2)})`);
        prev = y;
      }
    } finally {
      setBridgeOpen(br.id, false);
    }
    assert.equal(isWalkable(mid.x, mid.z), false);
  });

  test(`bridge ${br.id}: beach height from the far landing 15 u inland is smooth (no spit ridge)`, () => {
    const dx = br.bx - br.ax, dz = br.bz - br.az, L = Math.hypot(dx, dz);
    const ux = dx / L, uz = dz / L;
    let prev = getHeight(br.bx, br.bz);
    for (let d = 0.5; d <= 15; d += 0.5) {
      const x = br.bx + ux * d, z = br.bz + uz * d;
      const y = getHeight(x, z);
      if (inlandDistance(x, z) < 8) assert.ok(Math.abs(y - prev) < 0.05, `jump ${prev.toFixed(3)} -> ${y.toFixed(3)} at ${d} u inland`);
      prev = y;
    }
    // and laterally across the spit: flat 0.3 shelf, no crest
    const nx = -uz, nz = ux;
    for (let d = 0; d <= 8; d += 2) for (let l = -3; l <= 3; l += 1) {
      const x = br.bx + ux * d + nx * l, z = br.bz + uz * d + nz * l;
      if (inlandDistance(x, z) > 5 && inlandDistance(x, z) < 8) assert.ok(Math.abs(getHeight(x, z) - 0.3) < 0.02, `shelf at d=${d}, l=${l}`);
    }
  });

  test(`bridge ${br.id}: open-water span is about 18-28 u`, () => {
    const dx = br.bx - br.ax, dz = br.bz - br.az, L = Math.hypot(dx, dz);
    let first = -1, last = -1;
    for (let s = 0; s <= 1; s += 0.002) {
      if (!isWalkable(br.ax + dx * s, br.az + dz * s)) { if (first < 0) first = s; last = s; }
    }
    const span = (last - first) * L;
    const max = br.id === 'story' ? 31 : 28;   // (Storybook Cay's mesh square touches home's at x = -75, so its spit cannot reach further than that: ~29 u of open water)
    assert.ok(span > 18 && span < max, `span ${span.toFixed(1)}`);
  });
}

test('inlandDistance dispatches per island', () => {
  assert.ok(inlandDistance(0, 0) > 40);
  assert.ok(inlandDistance(0, -197) > 80);
  assert.ok(inlandDistance(197, 47) > 80);
  assert.ok(inlandDistance(500, 500) < -100);
});
