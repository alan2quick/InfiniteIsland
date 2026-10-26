// Step 82d: the living pass for Glowcap Shuffle, Driftwood Cast, Tilty Tiles and Bonk Burrows (the last four stages). Same pattern as 82c: livingStage.js builds the shared pieces (ground, tree line,
// ground cover, life, depth-aware camera admission); this module only describes WHAT is special about each stage: keep-out shapes and gameplay points (everything judged), composed clusters at the
// frame bands, props, and a few animated extras. It registers its four specs into living82c's SPECS. Nothing here is judged: every piece is cosmetic, deterministic from the stage seed and stays
// outside the play areas. Stage-local coordinates throughout (a group lowered by `floorY` adds that offset to every y).
//
// Readability rules that shape every piece below (the earlier browser reviews):
//   Glowcap  caps are judged and never move: no glowing colour discs / symbol shapes except the existing halos; sunk caps stay water (a dim translucent layer is kept over them); the call plate has a clear backdrop.
//   Cast     rings, finds, bobbers and the hook stay the clearest things on the water: the sun path / waves / foam / gulls / boat all stay out of the lanes (z beyond the farthest lane) and below find height.
//   Tilty    scenery stands OUTSIDE the frames (a frame is a tipping Group whose surface IS the judged plane; nothing is parented to it); tiles / picture / coconut stay the brightest things.
//   Bonk     the growing mallet shadows and red core rings are the warning: NOTHING lies on the meadow (no ground patches, dark blobs, rings, scenery shadows); molehills / islets stay as they are.
import * as THREE from 'three';
import { PARTY } from '../../config.js';
import { stageCentre } from '../../game/party/partyArea.js';
import { CAP_LOCAL } from '../../game/party/glowcapLogic.js';
import { part, G, combine, VERTEX_TOON } from '../../render/geo.js';
import { groundPatch } from './decor.js';
import { glow, bunting } from './kit.js';
import { mulberry32 } from '../../utils/rng.js';
import { scatter } from './scatter.js';
import { SPECS, circle, rect, TAU, gridDisc, gridRect, makePut, frameGroups, ownWater } from './living82c.js';

const GC = PARTY.glowcap, C = PARTY.cast, TY = PARTY.tilty, BK = PARTY.bonk;
const smooth01 = (t) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
const col = (h) => new THREE.Color(h);
const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
/** Low-frequency 0..1 noise for ground colour variation (never harsh). */
const lowNoise = (x, z, s = 0) => 0.5 + 0.25 * Math.sin(x * 0.21 + s) * Math.cos(z * 0.17 - s * 0.7) + 0.25 * Math.sin((x + z) * 0.11 + s * 1.9);
const tone = (c, x, z, amt, s = 2) => c.clone().multiplyScalar(1 + (lowNoise(x, z, s) - 0.5) * amt);

// ------------------------------------------------------------------------------------------------ geometry helpers
/** A non-indexed, up-facing surface from vertices { x, y, z, c, u, v } and triangles (winding is fixed so every face points up). Has position / normal / uv / color, like part(). */
export function surfaceGeo(verts, tris) {
  const n = tris.length * 3, pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2), cl = new Float32Array(n * 3);
  tris.forEach(([a, b, c], t) => {
    let A = verts[a], B = verts[b], C = verts[c];
    if ((B.z - A.z) * (C.x - A.x) - (B.x - A.x) * (C.z - A.z) < 0) [B, C] = [C, B];
    const ux = B.x - A.x, uy = B.y - A.y, uz = B.z - A.z, vx = C.x - A.x, vy = C.y - A.y, vz = C.z - A.z;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const len = Math.hypot(nx, ny, nz) || 1; nx /= len; ny /= len; nz /= len;
    [A, B, C].forEach((V, k) => {
      const i = t * 3 + k, color = V.c || WHITE;
      pos.set([V.x, V.y, V.z], i * 3); nor.set([nx, ny, nz], i * 3); uv.set([V.u || 0, V.v || 0], i * 2); cl.set([color.r, color.g, color.b], i * 3);
    });
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.BufferAttribute(cl, 3));
  return g;
}
const WHITE = col('#ffffff');
/** A rectangular grid; vertex(x, z, i, j) -> { y, c?, u?, v? }. */
export function gridMesh(x0, x1, z0, z1, nx, nz, vertex) {
  const verts = [], tris = [], W = nx + 1;
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) { const x = x0 + (x1 - x0) * i / nx, z = z0 + (z1 - z0) * j / nz; verts.push({ x, z, ...vertex(x, z, i, j) }); }
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const a = j * W + i; tris.push([a, a + W, a + 1], [a + 1, a + W, a + W + 1]); }
  return surfaceGeo(verts, tris);
}
/** Rings around the origin: rows [{ r(a), y(a), c(a, x, z), uv?(a, t) }], n + 1 columns so a seam can carry its own uv. */
export function polarMesh(n, rows) {
  const verts = [], tris = [], W = n + 1;
  rows.forEach((row) => { for (let i = 0; i <= n; i++) { const a = i / n * TAU, r = row.r(a), x = Math.cos(a) * r, z = Math.sin(a) * r, uv = row.uv ? row.uv(a, i / n) : [0, 0]; verts.push({ x, z, y: row.y(a), c: row.c(a, x, z), u: uv[0], v: uv[1] }); } });
  for (let j = 0; j < rows.length - 1; j++) for (let i = 0; i < n; i++) { const a = j * W + i, c = a + W; tris.push([a, c, a + 1], [a + 1, c, c + 1]); }
  return surfaceGeo(verts, tris);
}
/** A little owner of everything an extras object adds: meshes, geometries, private materials and instanced meshes are all freed once on dispose. */
function kit(group) {
  const geos = new Set(), mats = new Set(), insts = [], objs = [];
  return {
    mesh(geo, mat, name, o = {}) { const m = new THREE.Mesh(geo, mat); m.name = name; m.castShadow = false; m.frustumCulled = o.cull === true; if (o.order) m.renderOrder = o.order; geos.add(geo); group.add(m); objs.push(m); return m; },
    inst(geo, mat, cap, name, o = {}) {
      const m = new THREE.InstancedMesh(geo, mat, cap); m.name = name; m.castShadow = false; m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if (o.order) m.renderOrder = o.order; geos.add(geo); if (o.ownMat) mats.add(mat); group.add(m); insts.push(m); objs.push(m); return m;
    },
    own(mat) { mats.add(mat); return mat; },
    dispose() { for (const m of insts) m.dispose(); for (const g of geos) g.dispose(); for (const m of mats) m.dispose(); for (const o of objs) o.removeFromParent(); },
  };
}
const HIDE = new THREE.Matrix4().compose(new THREE.Vector3(0, -80, 0), new THREE.Quaternion(), new THREE.Vector3(1e-4, 1e-4, 1e-4));
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler(), _c = new THREE.Color();
const put = (mesh, i, x, y, z, sx = 1, sy = sx, sz = sx, ry = 0) => { _q.setFromEuler(_e.set(0, ry, 0)); mesh.setMatrixAt(i, _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz))); };

/** Wrap makePut so every piece also gets the stage's ground height (a lowered group stands its scenery on the real surface, not on the floor). */
function groundedPut(keepOut, base, y0) {
  const { put: raw, putNear: rawNear, out } = makePut(keepOut, base);
  const lift = (extra = {}, low = true) => ({ ...extra, y: y0 + (extra.dy || 0) + ((extra.lowCover ?? low) ? 0.025 : 0) });
  return { put: (kind, x, z, s = 1, yaw = 0, extra = {}) => raw(kind, x, z, s, yaw, lift(extra)), putNear: (kind, x, z, s = 1, yaw = 0, extra = {}) => rawNear(kind, x, z, s, yaw, lift(extra)), out };
}

// ================================================================================================ GLOWCAP SHUFFLE
const GFLOOR = -2.32;                                        // the lagoon bed: the living floor (the caps sink under the water layer, so nothing may lie at y 0)
const WREL = GC.waterY - GFLOOR;                             // the water surface in group coordinates (2.2)
const SHORE_REL = 0 - GFLOOR;                                // the spectators' shore top (the stage floor, y 0)
const ISLET_TOP = WREL + 0.14;
const GLOW_ISLETS = [[-13.5, -6.8, 2.0], [13.8, -7.6, 2.3], [-16.6, 4.4, 1.9], [16.8, 3.9, 2.0], [-7.9, -13.9, 2.2], [8.5, -14.4, 2.0], [-5.6, 16.6, 2.0], [6.9, 17.9, 2.2], [-14.2, 13.6, 1.8], [14.6, 12.9, 1.9], [-1.5, -21.5, 2.4], [15, -17.5, 1.8], [-16, -15.5, 1.9]];
const TZ = { x: -10.2, z: -2.4 };

function glowcapPts() {
  const caps = CAP_LOCAL.flatMap(c => gridDisc(c.x, c.z, GC.capR, 1.1, [0, 1.3, 2.6]));
  return [...caps, ...gridDisc(0, -8.6, 1.7, 0.8, [0.4, 1.2, 2.0, 2.8]), ...gridDisc(TZ.x, TZ.z, 1.2, 0.8, [1, 2, 3, 3.8]), ...gridRect(-GC.shore.x, GC.shore.x, GC.shore.z0, GC.shore.z1, 1.2, [0, 1.3, 2.6])];
}

function glowcapCompose({ cameras, origin, keepOut, rng }) {
  const out = [];
  // Islets in the lagoon: a giant glowing mushroom, a low glowing clump and reeds on each (their mounds are the props below).
  GLOW_ISLETS.forEach(([x, z, r], i) => {
    out.push({ id: 100100 + i * 10, kind: i % 3 === 1 ? 'giant-b' : 'giant-a', x: x + 0.2, z: z - 0.2, scale: 0.5 + rng() * 0.28, yaw: rng() * TAU, y: ISLET_TOP, lowCover: false, zone: 'islet', layer: 'mid' });
    out.push({ id: 100101 + i * 10, kind: 'mushroomClump', x: x - r * 0.42, z: z + r * 0.36, scale: 0.9, yaw: rng() * TAU, y: ISLET_TOP + 0.02, lowCover: true, unlit: true, zone: 'islet', layer: 'foreground' });
    for (let k = 0; k < 2; k++) out.push({ id: 100102 + i * 10 + k, kind: 'reed', x: x + Math.cos(k * 2.3 + i) * r * 0.6, z: z + Math.sin(k * 2.3 + i) * r * 0.5, scale: 0.9 + rng() * 0.6, yaw: rng() * TAU, y: ISLET_TOP, lowCover: false, zone: 'islet', layer: 'mid' });
  });
  // A backdrop of giants standing in the water far behind the caps (clustered, mixed sizes), clear of the call plate's backdrop.
  const isletKeep = GLOW_ISLETS.map(([x, z, r]) => circle(x, z, r + 1.6));
  const back = scatter({ seed: 100200, shape: rect(-30, 30, -32, -15), keepOut: [...keepOut, ...isletKeep], count: 26, minDistance: 2.7, radius: 2.0, size: [0.9, 1.5], clusterRadius: 3.6 });
  back.forEach((p, i) => out.push({ id: 100300 + i, kind: i % 5 === 2 ? 'giant-b' : i % 5 === 4 ? 'farMushroom' : 'giant-a', x: p.x, z: p.z, scale: i % 5 === 4 ? 1.7 + p.scale : p.scale, yaw: p.yaw, lowCover: false, zone: 'sides', layer: 'mid' }));
  // Side groves in the water along the left / right bands of the frame.
  const { putNear } = makePut([...keepOut, ...isletKeep], 100400);
  frameGroups(cameras, origin, [[-0.92, 0.25, 'g'], [0.92, 0.25, 'g'], [-0.9, -0.35, 'g'], [0.9, -0.35, 'g'], [-0.55, 0.85, 'g'], [0.55, 0.85, 'g']], 6).forEach((g, gi) => {
    [['giant-a', 0, 0, 1.0], ['giant-b', 2.0, 0.9, 0.7], ['farMushroom', -1.8, 0.6, 1.9]].forEach(([kind, dx, dz, k], i) => putNear(kind, g.x + dx, g.z + dz, k * (0.85 + rng() * 0.3), rng() * TAU, { lowCover: false, dy: -0.025, y: 0, zone: 'sides', layer: 'mid', cluster: 50 + gi }));
  });
  // Floating lily pads in the open water, never among the caps; glowing clumps at the shore's two ends.
  const lp = groundedPut(keepOut, 100500, WREL);
  for (const [x, z, s] of [[-12, 8.4, 1.1], [12.6, 7.4, 1.0], [-11.5, -10, 1.2], [11.5, -11.4, 1.1], [-17, -2, 1.2], [18, -1, 1.1], [-3.4, 14.5, 1.0], [3.6, 13.6, 1.1]]) lp.put('lilyPads', x, z, s, rng() * TAU, { zone: 'front', layer: 'foreground', free: false });
  out.push(...lp.out);
  for (const [x, z] of [[-9.4, 10.2], [9.5, 10.9], [-9.2, 12.5], [9.3, 12.3]]) out.push({ id: 100600 + out.length, kind: 'mushroomClump', x, z, scale: 1.0, yaw: rng() * TAU, y: SHORE_REL + 0.03, lowCover: true, unlit: true, zone: 'shore', layer: 'foreground' });
  return out;
}

/** Mossy mounds for the islets (the water hides their foot), plus a mossy stump top. Merged into the shared props mesh. */
function isletGeo(x, z, r) {
  const h = ISLET_TOP;
  return combine([part(new THREE.CylinderGeometry(0.82, 1.28, 1, 10, 1), '#3a7466', { p: [x, h / 2, z], s: [r, h, r] }), part(new THREE.CylinderGeometry(1, 1, 1, 10), '#5fae88', { p: [x, h - 0.04, z], s: [r * 0.84, 0.1, r * 0.84] }),
    part(G.ico1, '#7c8aa6', { p: [x + r * 0.55, h + 0.05, z - r * 0.2], s: [0.32, 0.22, 0.26] }), part(G.ico1, '#6a7894', { p: [x - r * 0.6, h + 0.04, z + r * 0.1], s: [0.24, 0.16, 0.2] })]);
}

function glowcapExtras({ group, materials }) {
  const k = kit(group);
  // The lagoon: an ADDITIVE moving layer (calm foam bands + glints, dark so the sums stay deep blue) above the dim translucent water that keeps sunk caps readable.
  const lm = k.own(ownWater(materials, '#030f20', '#020a16', false, '#081f3c')); lm.blending = THREE.AdditiveBlending; lm.depthWrite = false;
  const lagoon = k.mesh(gridMesh(-130, 130, -130, 130, 26, 26, (x, z) => ({ y: WREL + 0.03, u: 0.5 + 0.12 * Math.sin(x * 0.11 + z * 0.03), v: z * 0.9 + 2.2 * Math.sin(x * 0.07) })), lm, 'party-stage-water', { order: 1 });
  // Soft ripples where caps sink and rise: a pool of expanding pale rings, born at a cap's edge, gone in 0.9 s.
  const rg = new THREE.RingGeometry(0.86, 1, 36); rg.rotateX(-Math.PI / 2);
  const rm = new THREE.MeshBasicMaterial({ color: '#a8d8ff', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const rings = k.inst(rg, rm, 12, 'glowcap-ripples', { order: 4, ownMat: true });
  for (let i = 0; i < 12; i++) { rings.setMatrixAt(i, HIDE); rings.setColorAt(i, _c.setScalar(0)); }
  const slots = Array.from({ length: 12 }, () => ({ age: 9, x: 0, z: 0 })), prev = [];
  let next = 0;
  return {
    api: { lagoon, rings, ripples: () => slots.filter(s => s.age < 0.9).length },
    update(dt, t, players, info) {
      const depth = info?.depth;
      if (depth) depth.forEach((d, i) => {
        const p = prev[i];
        if (p !== undefined && ((p < 0.04 && d >= 0.04) || (p > 0.96 && d <= 0.96))) { const s = slots[next++ % slots.length], c = CAP_LOCAL[i]; Object.assign(s, { age: 0, x: c.x, z: c.z }); }
        prev[i] = d;
      }); else prev.length = 0;
      slots.forEach((s, i) => {
        s.age += dt;
        if (s.age >= 0.9) { rings.setMatrixAt(i, HIDE); return; }
        const u = s.age / 0.9, r = GC.capR * (1.02 + 0.75 * u);
        put(rings, i, s.x, WREL + 0.06, s.z, r, 1, r); rings.setColorAt(i, _c.setScalar(0.5 * Math.pow(1 - u, 1.6)));
      });
      rings.instanceMatrix.needsUpdate = true; rings.instanceColor.needsUpdate = true;
    },
    dispose() { k.dispose(); },
  };
}

SPECS.glowcap = {
  biome: { seed: 8289, ground: '#050a1c', light: '#050a1c', trees: ['giant-a', 'giant-b', 'giant-a', 'bush'], life: { firefly: 10, spore: 12, mist: 4 } },
  look: 'lagoon', floorY: GFLOOR, patchR: 0, smallKinds: ['grass'], low: 0, groves: 0, farRing: 'farMushroom', groundTint: '#0a1632',
  keepOut: () => [rect(-7.4, 7.4, -6.9, 6.9), rect(-4.8, 4.8, -17.5, -7.0), circle(TZ.x, TZ.z, 2.6), rect(-8.2, 8.2, 8.2, 12.9)],
  points: glowcapPts, compose: glowcapCompose, extras: glowcapExtras,
  props: () => GLOW_ISLETS.map(([x, z, r]) => ({ kind: 'islet', geo: isletGeo(x, z, r) })),
  groundParts: () => [-1, 1].map((s) => groundPatch({ seed: 8296 + s, radius: 2.2, color: '#5f9a86', edge: '#173f78', segments: 24, rings: 4, sx: 1.3, sz: 0.9 }).translate(s * 8.9, SHORE_REL + 0.02, 11.4).toNonIndexed()),
  habitats: {
    firefly: [{ x: -15.8, y: WREL + 0.7, z: -9 }, { x: 16, y: WREL + 0.8, z: -10 }, { x: -18.5, y: WREL + 0.6, z: 8 }, { x: 18.6, y: WREL + 0.7, z: 7 }, { x: 0, y: WREL + 0.9, z: 19.5 }],
    spore: [{ x: -16, y: WREL, z: -1 }, { x: 16.5, y: WREL, z: 0 }, { x: -9, y: WREL, z: -17 }, { x: 10, y: WREL, z: -17.5 }],
    mist: [{ x: -17, y: WREL + 0.32, z: -3 }, { x: 17.5, y: WREL + 0.3, z: -2 }, { x: -9, y: WREL + 0.34, z: 18 }, { x: 9, y: WREL + 0.3, z: 19 }],
  },
};

// ================================================================================================ DRIFTWOOD CAST
const CFLOOR = -0.62, SEA_REL = -0.5 - CFLOOR, SAND_REL = -0.03 - CFLOOR;
/** The shoreline: where the sand begins behind the jetty, wrapping up the two sides as headlands (stage-local z for an x). */
export const castShoreZ = (x) => { const a = Math.abs(x); return 7.2 - 8.5 * smooth01((a - 12.5) / 7) - Math.max(0, a - 19.5) * 0.25; };
const SAND_COLS = [col('#c99f70'), col('#e9c991'), col('#f1d5a2')];
function castSeaPolygon() {
  const pts = [];
  for (let x = -70; x <= 70; x += 2.5) pts.push({ x, z: castShoreZ(x) });
  return { type: 'polygon', points: [{ x: 70, z: -120 }, { x: -70, z: -120 }, ...pts] };
}
function castSeaColor(x, z) {
  const near = col('#4f93b2'), mid = col('#8f86ad'), far = col('#f2a672'), sun = col('#ffd8a0');
  const c = near.clone().lerp(mid, smooth01((3 - z) / 12)).lerp(far, smooth01((-9 - z) / 22));
  return c.lerp(sun, Math.exp(-(x * x) / 162) * smooth01((-6 - z) / 20) * 0.45);
}

function castCompose({ cameras, origin, keepOut, rng }) {
  const { put: gp, putNear, out } = groundedPut(keepOut, 101000, SAND_REL);
  // Palms in groups of different heights on the two headlands (a big one and smaller companions, with hibiscus and beach grass at their feet).
  [[-18.3, 6.4, -1], [18.6, 6.0, 1]].forEach(([cx, cz, s], gi) => {
    [[0, 0, 1.15], [-s * 2.1, -1.5, 0.9], [s * 1.6, -2.7, 0.75], [-s * 1.1, 2.3, 0.62]].forEach(([dx, dz, k], i) => gp('coconut', cx + dx, cz + dz, k, rng() * TAU, { lowCover: false, zone: 'sides', layer: 'mid', cluster: gi }));
    gp('hibiscus', cx + s * 0.9, cz + 1.4, 1.5, rng() * TAU, { lowCover: false, zone: 'sides' }); gp('beachGrass', cx - s * 1.2, cz + 0.2, 1.3, rng() * TAU, { zone: 'sides' });
  });
  // More palms behind the bench in loose groups: a soft backdrop for the portrait view's lower half.
  const back = scatter({ seed: 101100, shape: rect(-34, 34, 13, 40), keepOut: [...keepOut, rect(-13, 13, 8, 12)], count: 34, minDistance: 2.6, radius: 2, size: [0.8, 1.45], clusterRadius: 3.4 });
  back.forEach((p, i) => gp(['coconut', 'banana', 'coconut', 'breadfruit', 'bush'][i % 5], p.x, p.z, p.scale, p.yaw, { lowCover: false, zone: 'sides', layer: 'mid', cluster: 20 + (p.parent ?? i) }));
  // Camera-band clumps: shells, grass, rocks and driftwood on the sand in every frame band, kept out of the sea and every judged piece.
  const groups = frameGroups(cameras, origin, [[-0.8, 0.0, 'side'], [0.8, 0.0, 'side'], [-0.74, -0.72, 'front'], [0.74, -0.72, 'front'], [0, -0.94, 'front'], [-0.42, -0.9, 'front'], [0.45, -0.88, 'front'], [-0.9, -0.4, 'side'], [0.9, -0.4, 'side']], 4);
  groups.forEach((g, gi) => {
    const kinds = ['coastShells', 'beachGrass', gi % 3 ? 'starfishGroup' : 'beachRocks'], s = 1.25 + rng() * 0.4;
    [[-1.4, 0.1], [1.2, 0.5], [0, -1.35]].forEach(([dx, dz], i) => putNear(kinds[i], g.x + dx, g.z + dz, s, rng() * 0.5 - 0.25, { cluster: gi, zone: g.role === 'front' ? 'front' : 'sides' }));
  });
  for (const [x, z, k] of [[-15.2, 9.2, 'driftwood'], [15.6, 10.4, 'driftwood'], [-6.6, 14.2, 'beachRocks'], [7.4, 15.4, 'coastShells'], [0.6, 17.2, 'starfishGroup']]) gp(k, x, z, 1.2, rng() * TAU, { zone: 'front' });
  return out;
}

function sandGeo() {
  const rowsZ = [-0.9, 0.5, 2.0], X = []; for (let x = -70; x <= 70; x += 2.5) X.push(x);
  const verts = [], tris = [], W = X.length;
  rowsZ.forEach((dz, j) => X.forEach((x) => {
    const y = [SEA_REL - 0.06, SAND_REL - 0.1, SAND_REL][j], c = SAND_COLS[j].clone().multiplyScalar(0.94 + lowNoise(x, 0, 3) * 0.1);
    verts.push({ x, z: castShoreZ(x) + dz, y, c });
  }));
  X.forEach((x) => verts.push({ x, z: 60, y: SAND_REL, c: SAND_COLS[2].clone().multiplyScalar(0.96 + lowNoise(x, 5, 3) * 0.08) }));
  for (let j = 0; j < 3; j++) for (let i = 0; i < W - 1; i++) { const a = j * W + i; tris.push([a, a + W, a + 1], [a + 1, a + W, a + W + 1]); }
  return surfaceGeo(verts, tris);
}
function gullGeo() {
  const w = '#fbf8f0';
  return combine([...[-1, 1].map(s => part(G.sphereLo, w, { p: [s * 0.2, 0, 0.02], r: [0, 0, s * 0.22], s: [0.24, 0.025, 0.1] })), part(G.sphereLo, w, { s: [0.045, 0.045, 0.2] }), part(G.sphereLo, '#e8a03c', { p: [0, 0, -0.22], s: [0.02, 0.02, 0.06] }),
    ...[-1, 1].map(s => part(G.sphereLo, '#8a94a4', { p: [s * 0.42, 0.04, 0.02], s: [0.07, 0.02, 0.09] }))]);
}
function boatGeo() {
  const sail = (z, w, h, c) => part(G.cone6, c, { p: [0, 0.35 + h / 2 + 0.08, z], s: [w, h, 0.03] });
  return combine([part(G.sphere, '#7a4e2e', { p: [0, 0.1, 0], s: [0.38, 0.16, 1.0] }), part(G.cyl6, '#5a3a24', { p: [0, 0.95, 0.05], s: [0.03, 1.8, 0.03] }), sail(0.0, 0.62, 1.5, '#fff4e4'), sail(-0.55, 0.34, 0.9, '#ffd9b0'), part(G.sphereLo, '#e85a4a', { p: [0, 1.85, 0.05], s: [0.1, 0.06, 0.02] })]);
}

function castExtras({ group }) {
  const k = kit(group), BIN = 'party-stage-water';
  // The sea: an unlit gradient (teal near the jetty, lavender, then the sunset gold behind the volcano) with a warm column where the sun path lies. It carries the lanes' tints and rings.
  const sea = k.mesh(combine([gridMesh(-110, 110, -130, 8, 44, 28, (x, z) => ({ y: SEA_REL, c: castSeaColor(x, z) }))]), new THREE.MeshBasicMaterial({ vertexColors: true }), BIN, { order: 0 });
  k.own(sea.material);
  // Sun path: thin shimmering slabs far behind the lanes (z <= -9.5); they flicker, they never reach a lane.
  const slab = new THREE.PlaneGeometry(1, 1); slab.rotateX(-Math.PI / 2);
  const pathM = new THREE.MeshBasicMaterial({ color: '#fff0c0', transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
  const path = k.inst(slab, pathM, 34, 'cast-sunpath', { order: 2, ownMat: true });
  // Waves: faint pale dashes drifting toward the jetty over the far sea; they fade out before the lanes (z > -9).
  const dash = new THREE.PlaneGeometry(1, 1); dash.rotateX(-Math.PI / 2);
  const waveM = new THREE.MeshBasicMaterial({ color: '#ffe9c8', transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending });
  const waves = k.inst(dash, waveM, 36, 'cast-waves', { order: 2, ownMat: true });
  for (let i = 0; i < 36; i++) waves.setColorAt(i, _c.setScalar(1));
  // Foam lapping the jetty's front posts: a small pulsing ring on the water at each post (it never reaches the hook's reach).
  const fg = new THREE.RingGeometry(0.62, 1, 20); fg.rotateX(-Math.PI / 2);
  const foamM = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.7, depthWrite: false });
  const foamX = []; for (let i = -6; i <= 6; i++) foamX.push(i * 2.2);
  const foam = k.inst(fg, foamM, foamX.length, 'cast-post-foam', { order: 2, ownMat: true });
  for (let i = 0; i < foamX.length; i++) foam.setColorAt(i, _c.setScalar(1));
  // Gulls wheel high over the far sea (above find height, far behind the lanes); a sail boat drifts along the far water.
  const gulls = k.inst(gullGeo(), VERTEX_TOON, 3, 'cast-gulls');
  const boat = k.mesh(boatGeo(), VERTEX_TOON, 'cast-boat'); boat.rotation.order = 'YXZ';
  const cheer = { until: -1 };
  return {
    api: { sea, gulls, boat, path, waves, foam, cheer: (t) => { cheer.until = t + 1.1; }, cheerUntil: () => cheer.until },
    update(dt, t) {
      for (let i = 0; i < 34; i++) {
        const row = i % 17, side = i < 17 ? 0 : 1, z = -9.6 - row * 1.0 - side * 0.5, w = 0.9 + row * 0.2, x = Math.sin(i * 2.3) * w * 0.55 + Math.sin(t * 0.4 + i) * 0.2;
        const tw = 0.55 + 0.45 * Math.sin(t * (1.3 + (i % 4) * 0.45) + i * 1.7);
        put(path, i, x, SEA_REL + 0.02, z, 0.5 + tw * w * 0.7, 1, 0.08 + 0.05 * tw);
      }
      for (let i = 0; i < 36; i++) {
        const u = hash(i) , x = ((u * 120 + t * (0.12 + (i % 3) * 0.05) + i * 7) % 120) - 60, run = (hash(i + 40) * 30 + t * 0.55) % 30, z = -38 + run;
        const fade = smooth01((z + 38) / 6) * smooth01((-9.5 - z) / 5);
        if (fade < 0.02) waves.setMatrixAt(i, HIDE); else { put(waves, i, x, SEA_REL + 0.015, z, 1.4 + hash(i + 7) * 2.2, 1, 0.07); waves.setColorAt(i, _c.setScalar(0.5 * fade)); }
      }
      for (let i = 0; i < foamX.length; i++) {
        const ph = ((t * 0.45 + i * 0.37) % 1), r = 0.45 + ph * 0.5;
        put(foam, i, foamX[i], SEA_REL + 0.03, 4.1, r, 1, r * 0.8); foam.setColorAt(i, _c.setScalar(Math.pow(1 - ph, 1.4) * 0.8));
      }
      for (let i = 0; i < 3; i++) {
        const a = t * (0.34 + i * 0.07) + i * 2.1, flap = 0.6 + Math.abs(Math.sin(t * (3 + i * 0.4) + i)) * 1.5;
        put(gulls, i, Math.cos(a) * (12 + i * 2) , 8.8 + i * 0.7 + Math.sin(a * 2) * 0.5, -17.5 + Math.sin(a) * (3.5 + i * 0.6), 1.5, flap, 1.5, -a - Math.PI / 2);
      }
      for (const m of [path, waves, foam, gulls]) m.instanceMatrix.needsUpdate = true;
      waves.instanceColor.needsUpdate = true; foam.instanceColor.needsUpdate = true;
      const bx = ((t * 0.55 + 28) % 90) - 45;
      boat.position.set(bx, SEA_REL + 0.02 + Math.sin(t * 1.1) * 0.05, -16.5 + Math.sin(t * 0.07) * 0.6); boat.rotation.set(0, Math.PI / 2, Math.sin(t * 0.9) * 0.05);
    },
    dispose() { k.dispose(); },
  };
}

SPECS.cast = {
  biome: { seed: 8295, ground: '#c4607a', light: '#c4607a', trees: ['coconut', 'banana', 'breadfruit', 'bush'], life: { butterfly: 3 } },
  look: 'sunset', floorY: CFLOOR, patchR: 0, smallKinds: ['grass'], low: 0, groves: 0, ring: false, groundTint: '#b4607e',
  keepOut: () => [rect(-11.9, 11.9, -6.7, 3.9), rect(-13.2, 13.2, 3.9, 7.0), ...C.lanes.map(x => circle(x, C.benchZ, 2.0)), circle(-14.2, 3.6, 2.4), { ...castSeaPolygon(), sceneryOnly: true }],
  points: () => [...gridRect(-11.9, 11.9, -6.7, 3.9, 1.3, [0, 0.5, 1.2, 2.4]), ...gridRect(-12.8, 12.8, 4.1, 6.7, 1.2, [0, 1.3, 2.6, 3.4]), ...C.lanes.flatMap(x => gridDisc(x, C.benchZ, 1.4, 0.8, [0, 1.3, 2.6])), ...gridDisc(-14.2, 3.6, 1.4, 0.8, [0.7, 1.7, 2.7, 3.5])],
  compose: castCompose, extras: castExtras,
  groundParts: () => [sandGeo()],
  props: () => [[-24, -12.5, 3.2], [25.5, -15, 2.7]].map(([x, z, r]) => ({ kind: 'sandbar', geo: combine([part(G.sphere, '#e9c991', { p: [x, SEA_REL - 0.15, z], s: [r, 0.42, r * 0.8] }), part(G.sphere, '#f1d5a2', { p: [x + r * 0.2, SEA_REL + 0.08, z], s: [r * 0.6, 0.16, r * 0.5] })]) })),
  habitats: { butterfly: [{ x: -18, y: SAND_REL, z: 8 }, { x: 18.5, y: SAND_REL, z: 7.5 }, { x: 0, y: SAND_REL, z: 17 }] },
};

// ================================================================================================ TILTY TILES
const FR_X = TY.hx + Math.abs(TY.frames[0].x), FR_Z = TY.hz + Math.abs(TY.frames[0].z);       // the four frames' outer extents (11.8 x 9.6)
const BUNT = { a: [-16.6, 3.8, -9.0], b: [-16.9, 3.8, 0.3] };
const TREE_A = { x: BUNT.a[0], z: BUNT.a[2] }, TREE_B = { x: BUNT.b[0], z: BUNT.b[2] };
const PICNIC = [{ x: -15.2, z: 5.6, rot: 0.35 }, { x: 8.6, z: 16.8, rot: -0.25 }];
const CUBE = new THREE.BoxGeometry(1, 1, 1);

function tiltyCompose({ cameras, origin, keepOut, rng }) {
  const { put, putNear, out } = makePut(keepOut, 102000);
  // Wildflower / grass clumps in the open lawn at every frame band (never under a frame: the frames' rectangle is a keep-out).
  frameGroups(cameras, origin, [[-0.8, 0.1, 'side'], [0.8, 0.1, 'side'], [-0.74, -0.72, 'front'], [0.74, -0.72, 'front'], [0, -0.94, 'front'], [-0.5, -0.9, 'front'], [0.5, -0.9, 'front'], [-0.55, 0.55, 'side'], [0.5, 0.6, 'side']], 4.5).forEach((g, gi) => {
    const s = 1.3 + rng() * 0.45, kinds = ['meadowFlowers', 'meadowGrass', gi % 2 ? 'meadowFlowers' : 'softFern'];
    [[-1.4, 0.1], [1.2, 0.5], [0, -1.35]].forEach(([dx, dz], i) => putNear(kinds[i], g.x + dx, g.z + dz, s, rng() * 0.5 - 0.25, { cluster: gi, zone: g.role === 'front' ? 'front' : 'sides' }));
  });
  // The two oaks the bunting hangs between, then loose groves (one big oak or birch, a pine and a bush as companions) at the side bands.
  for (const t of [TREE_A, TREE_B]) put('oak', t.x, t.z, 1.15, rng() * TAU, { lowCover: false, zone: 'sides', layer: 'mid', free: true });
  frameGroups(cameras, origin, [[-0.9, 0.3, 'g'], [0.9, 0.3, 'g'], [-0.88, -0.2, 'g'], [0.88, -0.2, 'g'], [-0.45, 0.82, 'g'], [0.45, 0.82, 'g'], [0, 0.9, 'g']], 6).forEach((g, gi) => {
    const s = 0.95 + rng() * 0.45;
    [['oak', 0, 0, 1], ['pine', 1.9, 0.9, 0.75], ['birch', -1.8, 0.6, 0.85], ['bush', 0.4, -1.8, 0.9]].forEach(([kind, dx, dz, k], i) => putNear(i % 2 ? kind : gi % 2 ? 'birch' : kind, g.x + dx, g.z + dz, s * k, rng() * TAU, { lowCover: false, zone: 'sides', layer: 'mid', cluster: 50 + gi }));
  });
  // A layered wood far behind the back frames (several depths, mixed species and heights): the back of the portrait view and the top of every landscape one.
  const wood = scatter({ seed: 102100, shape: rect(-32, 32, -38, -12.4), keepOut: [circle(TREE_A.x, TREE_A.z, 2.6), circle(TREE_B.x, TREE_B.z, 2.6)], count: 46, minDistance: 2.4, radius: 2.1, size: [0.8, 1.5], clusterRadius: 3.6 });
  wood.forEach((p, i) => out.push({ id: 102500 + i, kind: ['oak', 'pine', 'birch', 'oak', 'bush', 'birch', 'pine'][i % 7], x: p.x, z: p.z, scale: p.scale, yaw: p.yaw, lowCover: false, zone: 'sides', layer: p.z < -26 ? 'back' : 'mid' }));
  for (const side of [-1, 1]) for (const camera of cameras) {
    const p = frameGroups([camera], origin, [[side * 1.04, -0.8, 'frame']], 0)[0];
    if (p) { put('meadowBush', p.x, p.z, 1.8, side * 0.3, { lowCover: false, zone: 'frame' }); put('meadowFlowers', p.x + side * 1.6, p.z - 1.4, 1.5, 0.2, { zone: 'frame' }); }
  }
  return out;
}

function blanketGeo({ x, z, rot }) {
  const parts = [], W = 3.4, D = 2.5, nx = 4, nz = 3;
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) parts.push(part(CUBE, (i + j) % 2 ? '#ff8fa8' : '#fff1e6', { p: [(i - (nx - 1) / 2) * W / nx, 0.03, (j - (nz - 1) / 2) * D / nz], s: [W / nx - 0.02, 0.04, D / nz - 0.02] }));
  parts.push(part(G.cyl8, '#c58a52', { p: [0.5, 0.33, 0.1], s: [0.46, 0.5, 0.46] }), part(G.cyl8, '#a8703e', { p: [0.5, 0.6, 0.1], s: [0.5, 0.06, 0.5] }));
  for (const [dx, dz, c] of [[0.35, 0.05, '#ff5a4a'], [0.62, 0.2, '#ffd23a'], [0.5, -0.06, '#7bd24a']]) parts.push(part(G.sphereLo, c, { p: [dx, 0.7, dz], s: [0.15, 0.15, 0.15] }));
  parts.push(part(G.sphereLo, '#fff8e8', { p: [-0.9, 0.12, -0.3], s: [0.34, 0.12, 0.28] }), part(G.cyl8, '#fff8e8', { p: [-0.9, 0.15, 0.5], s: [0.18, 0.3, 0.18] }));
  return combine(parts).rotateY(rot).translate(x, 0.015, z);
}

function tiltyExtras({ group, materials }) {
  const k = kit(group);
  // Bunting strung between the two oaks on the left, fluttering in the shared sway (it hangs beside the frames, never above one).
  const flags = k.mesh(combine(bunting(BUNT.a, BUNT.b, 0.9, 16, ['#ff6b8a', '#ffd23a', '#6bd0ff', '#8be07a', '#c79bff'])), materials.sway, 'tilty-bunting');
  return { api: { flags }, update() {}, dispose() { k.dispose(); } };
}

SPECS.tilty = {
  biome: { seed: 8297, ground: '#8fe36b', light: '#a8f07c', trees: ['oak', 'birch', 'pine', 'bush'], life: { butterfly: 5, petal: 12 } },
  look: 'day', patchR: 22, smallKinds: ['grass', 'flowerWhite', 'grass', 'flowerYellow', 'flowerPink', 'grass'], low: 340, groves: 0, softColor: '#bcd8a0',
  keepOut: () => [rect(-12.7, 12.7, -10.5, 10.5), rect(-6.6, 6.6, 9.8, 12.9), circle(0, 0, 1.6)],
  points: () => [...gridRect(-FR_X, FR_X, -FR_Z, FR_Z, 1.4, [0.4, 1.3, 2.2, 3.1, 4.0, 5.2]), ...gridDisc(0, 0, 1.4, 0.7, [0.7, 1.7, 2.7, 3.6]), ...gridRect(-6.2, 6.2, 10.8, 12.2, 1.2, [0, 1.3, 2.6])],
  compose: tiltyCompose, extras: tiltyExtras,
  props: () => PICNIC.map(p => ({ kind: 'picnic', geo: blanketGeo(p) })),
  habitats: {
    butterfly: [{ x: -17.5, y: 0.1, z: 2.5 }, { x: 17.6, y: 0.1, z: 3 }, { x: -16, y: 0.1, z: -12.5 }, { x: 15.5, y: 0.1, z: -13 }, { x: 0, y: 0.1, z: 16.5 }],
    petal: [{ x: -17.2, y: 0.6, z: -6 }, { x: 17.2, y: 0.6, z: -7 }, { x: -9, y: 0.6, z: -15 }, { x: 8, y: 0.6, z: -15.5 }],
  },
};

// ================================================================================================ BONK BURROWS
const BN = (a, s) => Math.sin(a * 3 + s) * 0.5 + Math.sin(a * 5 + s * 2.1) * 0.3 + Math.sin(a * 9 + s * 0.7) * 0.2;      // -1..1 and periodic, so every ring closes
/** The meadow's irregular edge: never inside the walkable disc (meadowR - 0.3); the drawn bank follows it. */
export const bonkMeadowEdge = (a) => BK.meadowR + 0.3 + 0.28 * (1 + BN(a, 1.3));
const bonkIn = (a) => bonkMeadowEdge(a) + 0.5;
const ISLETS_B = BK.patches, ISL_BANK = BK.patchR + 0.7;
/** The stream's outer bank: wobbly, and wide enough round the two islets that they sit in the water. */
export function bonkRiverOut(a) {
  let r = 13.7 + 0.9 * BN(a, 4.1); const ux = Math.cos(a), uz = Math.sin(a);
  for (const c of ISLETS_B) { const d = c.x * ux + c.z * uz, h2 = ISL_BANK * ISL_BANK - (c.x * c.x + c.z * c.z - d * d); if (h2 > 0) r = Math.max(r, d + Math.sqrt(h2) + 0.4); }
  return r;
}
export const BONK_BRIDGE = rect(-2.7, 2.7, -17.4, -9.0), BONK_SIGN = { x: -3.9, z: -15.4 };
const riverPoly = () => ({ type: 'polygon', points: Array.from({ length: 96 }, (_, i) => { const a = i / 96 * TAU, r = bonkRiverOut(a) + 0.2; return { x: Math.cos(a) * r, z: Math.sin(a) * r }; }) });
const MEADOW_C = col('#8fe063'), MEADOW_IN = col('#9ced70'), SANDY = col('#e8d6a8'), WET = col('#cdb084'), LAND_C = col('#74c650'), LAND_FAR = col('#6bbd4c');
const LOOP = 62.83;                                                 // the stream's uv length: both sine periods in the water shader close exactly (1.6 L = 16 pi, 0.7 L = 14 pi)

function bonkGround() {
  const Y = 0.022, n = 96, soft = (c, x, z) => tone(c, x, z, 0.04);
  const meadow = polarMesh(n, [
    { r: () => 0.001, y: () => Y, c: (a, x, z) => soft(MEADOW_IN, x, z) },
    { r: a => bonkMeadowEdge(a) * 0.62, y: () => Y, c: (a, x, z) => soft(MEADOW_IN, x, z) },
    { r: bonkMeadowEdge, y: () => Y, c: (a, x, z) => soft(MEADOW_C, x, z) },
    { r: a => bonkMeadowEdge(a) + 0.2, y: () => Y - 0.004, c: () => SANDY },
    { r: bonkIn, y: () => Y - 0.008, c: () => WET },
  ]);
  const outer = polarMesh(n, [
    { r: a => bonkRiverOut(a) - 0.1, y: () => Y - 0.008, c: () => WET },
    { r: a => bonkRiverOut(a) + 0.5, y: () => Y - 0.004, c: () => SANDY },
    { r: a => bonkRiverOut(a) + 1.5, y: () => 0.012, c: (a, x, z) => soft(LAND_C, x, z) },
    { r: a => bonkRiverOut(a) + 6, y: () => 0.008, c: (a, x, z) => tone(LAND_C, x, z, 0.12, 5) },
    { r: () => 70, y: () => 0.004, c: (a, x, z) => tone(LAND_FAR, x, z, 0.1, 6) },
  ]);
  return [meadow, outer];
}

function bonkCompose({ cameras, origin, keepOut, rng }) {
  const { put, putNear, out } = makePut(keepOut, 103000);
  // Bank reeds in clumps of three along the stream's outer bank (they sway); never at the bridge or the sign.
  for (let i = 0; i < 38; i++) {
    const a = (i + rng() * 0.6) / 38 * TAU, r = bonkRiverOut(a) + 1.0 + rng() * 0.8, s = 0.9 + rng() * 0.5;
    [[0, 0], [0.55, 0.3], [-0.4, 0.5]].forEach(([dx, dz], k) => put('reed', Math.cos(a) * r + dx, Math.sin(a) * r + dz, s * (1 - k * 0.12), rng() * TAU, { lowCover: false, zone: 'shore', layer: 'mid', cluster: i }));
  }
  // Clover / daisy clumps and grass tufts in every frame band, plus clustered trees at the side bands and a loose wood behind the bridge.
  frameGroups(cameras, origin, [[-0.85, 0.1, 'side'], [0.85, 0.1, 'side'], [-0.74, -0.72, 'front'], [0.74, -0.72, 'front'], [0, -0.94, 'front'], [-0.5, -0.9, 'front'], [0.5, -0.9, 'front'], [-0.55, 0.62, 'side'], [0.5, 0.65, 'side']], 4.5).forEach((g, gi) => {
    const s = 1.3 + rng() * 0.45, kinds = ['meadowFlowers', 'meadowGrass', gi % 2 ? 'meadowFlowers' : 'softFern'];
    [[-1.4, 0.1], [1.2, 0.5], [0, -1.35]].forEach(([dx, dz], i) => putNear(kinds[i], g.x + dx, g.z + dz, s, rng() * 0.5 - 0.25, { cluster: gi, zone: g.role === 'front' ? 'front' : 'sides' }));
  });
  frameGroups(cameras, origin, [[-0.92, 0.3, 'g'], [0.92, 0.3, 'g'], [-0.9, -0.3, 'g'], [0.9, -0.3, 'g'], [-0.45, 0.85, 'g'], [0.5, 0.85, 'g'], [0, 0.92, 'g']], 6).forEach((g, gi) => {
    const s = 1.0 + rng() * 0.45;
    [['oak', 0, 0, 1], ['birch', 1.9, 0.9, 0.8], ['pine', -1.8, 0.6, 0.8], ['bush', 0.4, -1.8, 0.9]].forEach(([kind, dx, dz, k], i) => putNear(i % 2 ? kind : gi % 2 ? 'birch' : kind, g.x + dx, g.z + dz, s * k, rng() * TAU, { lowCover: false, zone: 'sides', layer: 'mid', cluster: 50 + gi }));
  });
  const wood = scatter({ seed: 103100, shape: rect(-32, 32, -38, -16.4), keepOut: [BONK_BRIDGE, rect(-5.5, 5.5, -40, -9)], count: 44, minDistance: 2.4, radius: 2.1, size: [0.8, 1.5], clusterRadius: 3.6 });
  wood.forEach((p, i) => out.push({ id: 103500 + i, kind: ['oak', 'birch', 'pine', 'oak', 'bush', 'birch'][i % 6], x: p.x, z: p.z, scale: p.scale, yaw: p.yaw, lowCover: false, zone: 'sides', layer: p.z < -26 ? 'back' : 'mid' }));
  return out;
}

/** Stepping stones across the stream at the front: a wobbly path (uneven spacing, sizes and heights), plus two strays on the bank. Decor only: nobody can use them. */
function stonesGeo() {
  const parts = [], a0 = Math.PI / 2 + 0.06, y = 0.03;
  for (let k = 0; k < 6; k++) {
    const t = (k + 0.5 + (hash(k) - 0.5) * 0.5) / 6, a = a0 + 0.035 * Math.sin(k * 2.1) + 0.02 * k, r = bonkIn(a) + 0.2 + t * (bonkRiverOut(a) - bonkIn(a) - 0.5), sz = 0.36 + hash(k + 3) * 0.2;
    parts.push(part(G.cyl8, '#9ca3aa', { p: [Math.cos(a) * r + (hash(k + 9) - 0.5) * 0.3, y + 0.08, Math.sin(a) * r], s: [sz, 0.16, sz * (0.85 + hash(k + 5) * 0.3)] }), part(G.cyl8, '#bcc3c9', { p: [Math.cos(a) * r, y + 0.165, Math.sin(a) * r], s: [sz * 0.8, 0.02, sz * 0.7] }));
  }
  for (const [a, dr] of [[1.13, 0.9], [2.0, 0.7]]) { const r = bonkRiverOut(a) + dr; parts.push(part(G.ico1, '#9ca3aa', { p: [Math.cos(a) * r, 0.1, Math.sin(a) * r], s: [0.42, 0.26, 0.34] })); }
  return combine(parts);
}
function moleGeo() {
  return combine([part(G.sphere, '#6e5d6c', { s: [0.28, 0.3, 0.27] }), part(G.sphere, '#f0a4b4', { p: [0, -0.04, 0.26], s: [0.1, 0.08, 0.1] }), part(G.sphereLo, '#241a2a', { p: [-0.1, 0.07, 0.22], s: [0.04, 0.05, 0.03] }), part(G.sphereLo, '#241a2a', { p: [0.1, 0.07, 0.22], s: [0.04, 0.05, 0.03] }),
    part(G.sphereLo, '#f0a4b4', { p: [-0.2, -0.22, 0.12], s: [0.09, 0.05, 0.06] }), part(G.sphereLo, '#f0a4b4', { p: [0.2, -0.22, 0.12], s: [0.09, 0.05, 0.06] })]);
}
const MOLE_HILLS = [0, 2];

function bonkExtras({ group, materials }) {
  const k = kit(group), r = mulberry32(8301);
  const wm = k.own(ownWater(materials, '#58b4d8', '#3f93c4', false, '#e6f4ef')); wm.polygonOffset = false;
  // The stream: one ribbon round the meadow whose pattern runs ALONG it (a gentle current that circles the meadow), with soft foam at both banks and the party water's glints.
  const water = k.mesh(polarMesh(96, [{ r: bonkIn, y: () => 0.03, c: () => WHITE, uv: (a, t) => [0, t * LOOP] }, { r: bonkRiverOut, y: () => 0.03, c: () => WHITE, uv: (a, t) => [1, t * LOOP] }]), wm, 'party-stage-water', { order: 1 });
  // Moles peek from two molehills between slams (they stay ON the hills, which are colliders: never on a judged spot); soil crumbs hop off a hill when a mallet lands near it.
  const moles = k.inst(moleGeo(), VERTEX_TOON, MOLE_HILLS.length, 'bonk-moles');
  const crumbG = new THREE.SphereGeometry(0.1, 6, 4), crumbM = new THREE.MeshBasicMaterial({ color: '#b98a52' });
  const crumbs = k.inst(crumbG, crumbM, 16, 'bonk-crumbs', { ownMat: true });
  const bits = Array.from({ length: 16 }, () => ({ age: 9, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }));
  let nextBit = 0;
  const phases = MOLE_HILLS.map((h, i) => ({ h: BK.hills[h], period: 13 + i * 4.5, offset: 3 + i * 6.2, up: 0 }));
  for (let i = 0; i < 16; i++) crumbs.setMatrixAt(i, HIDE);
  for (let i = 0; i < MOLE_HILLS.length; i++) moles.setMatrixAt(i, HIDE);
  return {
    api: { water, moles, crumbs,
      /** A mallet landed at (x, z): hills within its reach shed a few crumbs (airborne, small, brown: never a ground mark). */
      crumble(x, z) {
        for (const h of BK.hills) {
          if (Math.hypot(h.x - x, h.z - z) > BK.hitR + 1.4) continue;
          for (let n = 0; n < 4; n++) { const b = bits[nextBit++ % bits.length], a = Math.atan2(h.z - z, h.x - x) + (r() - 0.5) * 1.6, sp = 0.8 + r() * 1.2; Object.assign(b, { age: 0, x: h.x, y: h.r * 0.5, z: h.z, vx: Math.cos(a) * sp, vy: 2.2 + r() * 1.4, vz: Math.sin(a) * sp }); }
        }
      },
      molesUp: () => phases.map(p => p.up) },
    update(dt, t, players, info) {
      const busy = !!info?.busy;
      phases.forEach((p, i) => {
        const u = ((t + p.offset) % p.period) / p.period, want = busy ? 0 : Math.min(1, Math.max(0, (u - 0.62) / 0.06)) * Math.min(1, Math.max(0, (0.92 - u) / 0.06));
        p.up += (want - p.up) * (1 - Math.exp(-9 * dt));
        const h = p.h;
        if (p.up < 0.02) moles.setMatrixAt(i, HIDE); else put(moles, i, h.x + h.r * 0.1, h.r * 0.5 - 0.3 + p.up * 0.42, h.z + h.r * 0.22, 0.9, 0.9, 0.9, Math.sin(t * 1.3 + i) * 0.5 + 0.4);
      });
      moles.instanceMatrix.needsUpdate = true;
      bits.forEach((b, i) => {
        b.age += dt;
        if (b.age > 0.55) { crumbs.setMatrixAt(i, HIDE); return; }
        b.vy -= 9 * dt; b.x += b.vx * dt; b.y = Math.max(0.05, b.y + b.vy * dt); b.z += b.vz * dt;
        put(crumbs, i, b.x, b.y, b.z, 1 - b.age / 0.55 * 0.5);
      });
      crumbs.instanceMatrix.needsUpdate = true;
    },
    dispose() { k.dispose(); },
  };
}

SPECS.bonk = {
  biome: { seed: 8299, ground: '#74c650', light: '#74c650', trees: ['oak', 'birch', 'pine', 'bush'], life: { butterfly: 4, dragonfly: 3 } },
  look: 'day', patchR: 0, smallKinds: ['grass', 'flowerWhite', 'grass', 'flowerYellow', 'grass', 'flowerPink'], low: 260, groves: 0, softColor: '#bcd8a0', groundTint: '#6bbd4c',
  keepOut: () => [riverPoly(), BONK_BRIDGE, circle(BONK_SIGN.x, BONK_SIGN.z, 1.3)],
  points: () => [...gridDisc(0, 0, 9.8, 1.5, [0, 1.3, 2.6]), ...BK.patches.flatMap(p => gridDisc(p.x, p.z, 2.0, 1.0, [0, 1.3, 2.6])), ...gridDisc(0, -12.6, 1.4, 0.8, [0.2, 1.2, 2.4, 3.4])],
  compose: bonkCompose, extras: bonkExtras,
  groundParts: bonkGround,
  props: () => [{ kind: 'stones', geo: stonesGeo() }],
  habitats: {
    butterfly: [{ x: -17.6, y: 0.1, z: 1 }, { x: 17.4, y: 0.1, z: -1 }, { x: -12, y: 0.1, z: -16.5 }, { x: 12.5, y: 0.1, z: -17 }],
    dragonfly: [{ x: -13.6, y: 0.7, z: -6.5 }, { x: 13.8, y: 0.7, z: -7 }, { x: 0, y: 0.7, z: 14.4 }],
  },
};
