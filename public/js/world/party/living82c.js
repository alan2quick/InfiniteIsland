// Step 82c: the living pass for Sizzle Seed, Egg Scramble, Feast-Go-Round and Puffball Bumpers. livingStage.js builds the shared pieces
// (ground, tree line, groves, ground cover, life, depth-aware camera admission); this module only describes WHAT is special about
// each of the four stages: keep-out shapes and gameplay points (everything judged), composed clusters at the frame bands, and a few
// animated extras (campfire glow, peeking critters, falling feathers, flowing flume water, marsh water). Nothing here is judged:
// every piece is cosmetic, deterministic from the stage seed and stays outside the play areas. Stage-local coordinates throughout.
import * as THREE from 'three';
import { PARTY } from '../../config.js';
import { stageCentre } from '../../game/party/partyArea.js';
import { part, G, combine, VERTEX_TOON } from '../../render/geo.js';
import { buildRibbonGeometry, waterUniforms } from '../water.js';
import { groundPatch } from './decor.js';
import { mulberry32 } from '../../utils/rng.js';
import { scatter, distanceToShape } from './scatter.js';
import { dressingAsset } from './stageDressing.js';

export const circle = (x, z, r) => ({ type: 'circle', x, z, r });
export const rect = (x0, x1, z0, z1) => ({ type: 'rect', x0, x1, z0, z1 });
export const TAU = Math.PI * 2;
const FOOT = { bamboo: 1.0, fern: 1.3, hibiscus: 0.5, plumeria: 0.5, reed: 0.4, 'giant-a': 3.2, 'giant-b': 3.8, farMushroom: 1.3, bush: 1.4 };
const footprintOf = kind => kind === 'patch' ? 1 : Math.max(0.65, (dressingAsset(kind)?.userData.footprint ?? FOOT[kind] ?? 1) + 0.05);

/** [x, z, heights] gameplay sample rows for a disc, on a grid. */
export function gridDisc(cx, cz, r, step, heights) {
  const out = [];
  for (let x = -r; x <= r + 1e-6; x += step) for (let z = -r; z <= r + 1e-6; z += step) if (Math.hypot(x, z) <= r) out.push([cx + x, cz + z, heights]);
  return out;
}
export function gridRect(x0, x1, z0, z1, step, heights) {
  const out = [];
  for (let x = x0; x <= x1 + 1e-6; x += step) for (let z = z0; z <= z1 + 1e-6; z += step) out.push([x, z, heights]);
  return out;
}

/** Ground points where NDC anchors [x, y, role] meet the floor, per camera, deduplicated. */
export function frameGroups(cameras, origin, anchors, gap = 5) {
  const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -origin.y), groups = [];
  for (const camera of cameras) for (const [nx, ny, role] of anchors) {
    ray.setFromCamera(new THREE.Vector2(nx, ny), camera);
    const p = ray.ray.intersectPlane(plane, new THREE.Vector3())?.sub(origin);
    if (!p || Math.hypot(p.x, p.z) > 80) continue;
    if (groups.some(q => Math.hypot(q.x - p.x, q.z - p.z) < gap)) continue;
    groups.push({ x: p.x, z: p.z, role });
  }
  return groups;
}

export function makePut(keepOut, base) {
  const out = [];
  const put = (kind, x, z, scale = 1, yaw = 0, extra = {}) => {
    const footprint = kind === 'patch' ? scale : footprintOf(kind) * scale;
    if (!extra.free && keepOut.some(s => distanceToShape(s, x, z) < footprint)) return false;
    out.push({ id: base + out.length, kind, x, z, scale, yaw, lowCover: true, zone: 'front', layer: 'foreground', ...extra });
    return true;
  };
  /** Like put, but when the spot is taken (a keep-out, a bench) walks outwards in rings until the piece fits, so every frame band still gets its group. */
  const putNear = (kind, x, z, scale = 1, yaw = 0, extra = {}) => {
    for (const r of [0, 1.2, 2.4, 3.6, 4.8]) for (let k = 0; k < (r ? 8 : 1); k++) {
      const a = k / 8 * TAU + (extra.cluster || 0) * 0.7;
      if (put(kind, x + Math.cos(a) * r, z + Math.sin(a) * r, scale, yaw, extra)) return true;
    }
    return false;
  };
  return { put, putNear, out };
}

// ------------------------------------------------------------------------------------------------ Sizzle Seed
const S = PARTY.sizzle, E = PARTY.eggs, F = PARTY.feastround, B = PARTY.bumpers;
const DUB = { x: 0, z: -11.2 }, BASKET = { x: -9.6, z: -6.2 };

function sizzleCompose({ cameras, origin, keepOut, rng }) {
  const { put, putNear, out } = makePut(keepOut, 96000);
  const groups = frameGroups(cameras, origin, [[-0.8, 0.1, 'side'], [0.8, 0.1, 'side'], [-0.74, -0.72, 'front'], [0.74, -0.72, 'front'], [0, -0.94, 'front'], [-0.5, 0.55, 'side'], [0.55, 0.5, 'side']]);
  groups.forEach((g, gi) => {
    const s = 1.35 + rng() * 0.45, kinds = g.role === 'front' ? ['meadowFlowers', 'meadowGrass', 'meadowFlowers'] : ['meadowGrass', 'meadowFlowers', gi % 2 ? 'softFern' : 'meadowGrass'];
    [[-1.4, 0.1], [1.2, 0.5], [0, -1.35]].forEach(([dx, dz], i) => putNear(kinds[i], g.x + dx, g.z + dz, s, rng() * 0.5 - 0.25, { cluster: gi, zone: g.role === 'front' ? 'front' : 'sides' }));
  });
  // A tree line behind Dub and the benches (oaks, birches and pines in loose groups of different heights), so the middle of the frame is framed too.
  const back = scatter({ seed: 8285 + 4, shape: rect(-26, 26, -30, -14.6), keepOut: [circle(DUB.x, DUB.z, 3)], count: 46, minDistance: 2.4, radius: 2.2, size: [0.8, 1.4], clusterRadius: 3.6 });
  back.forEach((p, i) => out.push({ id: 96500 + i, kind: ['oak', 'pine', 'birch', 'oak', 'bush', 'pine'][i % 6], x: p.x, z: p.z, scale: p.scale, yaw: p.yaw, lowCover: false, zone: 'sides', layer: 'mid' }));
  // Groves of mixed trees at the left and right bands of the frame (one big oak or birch, a pine and a bush as companions), so both sides are framed alike.
  frameGroups(cameras, origin, [[-0.9, 0.3, 'g'], [0.9, 0.3, 'g'], [-0.88, -0.15, 'g'], [0.88, -0.15, 'g'], [-0.45, 0.82, 'g'], [0.45, 0.82, 'g'], [0, 0.9, 'g']], 6).forEach((g, gi) => {
    const s = 1.0 + rng() * 0.45;
    [['oak', 0, 0, 1], ['pine', 1.9, 0.9, 0.75], ['birch', -1.8, 0.6, 0.85], ['bush', 0.4, -1.8, 0.9]].forEach(([kind, dx, dz, k], i) => putNear(i % 2 ? kind : gi % 2 ? 'birch' : kind, g.x + dx, g.z + dz, s * k, rng() * 6.28, { lowCover: false, zone: 'sides', layer: 'mid', cluster: 50 + gi }));
  });
  // One bush with companions at each lower corner frames the camp without standing in front of the benches.
  for (const camera of cameras) for (const side of [-1, 1]) {
    const p = frameGroups([camera], origin, [[side * 1.04, -0.78, 'frame']], 0)[0];
    if (p) { put('meadowBush', p.x, p.z, 1.9, side * 0.3, { lowCover: false, zone: 'frame' }); put('meadowFlowers', p.x + side * 1.6, p.z - 1.5, 1.5, 0.2, { zone: 'frame' }); }
  }
  put('woodpile', 12.6, -6.6, 1.15, -0.25, { lowCover: false, zone: 'sides' });
  put('stumpGroup', 14.2, 4.8, 1.1, 0.2, { zone: 'sides' });
  put('mossLog', -13.8, 5.2, 1, 0.12, { lowCover: false, zone: 'sides' });
  put('softFern', -12.6, 3.4, 1.6, 0, { zone: 'sides' });
  return out;
}

// ------------------------------------------------------------------------------------------------ Egg Scramble
const FOX_DEN = { x: -15.2, z: -5.2 }, RABBIT_DEN = { x: 15.4, z: -5.8 };
function eggsCompose({ cameras, origin, keepOut, rng }) {
  const { put, putNear, out } = makePut(keepOut, 97000);
  const groups = frameGroups(cameras, origin, [[-0.8, 0.1, 'side'], [0.8, 0.1, 'side'], [-0.73, -0.75, 'front'], [0.73, -0.75, 'front'], [0, -0.93, 'front'], [-0.55, 0.5, 'side'], [0.5, 0.55, 'side']]);
  groups.forEach((g, gi) => {
    const s = 1.3 + rng() * 0.4, kinds = Math.abs(g.x) < 5 && g.z < 15 ? ['meadowGrass', 'cosySnowBush', 'meadowGrass'] : ['cosySnowBush', 'meadowGrass', 'cosySnowBush'];
    [[-1.4, 0.1], [1.2, 0.5], [0, -1.35]].forEach(([dx, dz], i) => putNear(kinds[i], g.x + dx, g.z + dz, kinds[i] === 'meadowGrass' ? 0.9 : s, rng() * 0.5 - 0.25,
      { cluster: gi, lowCover: kinds[i] === 'meadowGrass', zone: g.role === 'side' ? 'sides' : 'front', ...(kinds[i] === 'meadowGrass' ? { tint: '#d0dfe0' } : {}) }));
  });
  for (const camera of cameras) for (const side of [-1, 1]) {
    const p = frameGroups([camera], origin, [[side * 1.04, -0.8, 'frame']], 0)[0];
    if (p) put('cosyPine', p.x, p.z, 0.9, side * 0.25, { lowCover: false, zone: 'frame' });
  }
  // A loose wood behind the perch (pines, spruces and snowy bushes of different heights in groups): behind everything, so never in front of a lane.
  const wood = scatter({ seed: 8286 + 4, shape: rect(-32, 32, -26, -5.5), keepOut: [circle(FOX_DEN.x, FOX_DEN.z, 2.6), circle(RABBIT_DEN.x, RABBIT_DEN.z, 2.6)], count: 40, minDistance: 2.3, radius: 2.0, size: [0.8, 1.3], clusterRadius: 3.2 });
  wood.forEach((p, i) => out.push({ id: 97500 + i, kind: ['pine', 'snowPine', 'spruce', 'cosySnowBush', 'pine', 'snowPine'][i % 6], x: p.x, z: p.z, scale: p.scale * (i % 6 === 3 ? 1.1 : 1), yaw: p.yaw, lowCover: false, zone: 'sides', layer: 'mid' }));
  for (const [x, z] of [[-17.5, 8], [17.8, 10.5]]) put('cosySnowRock', x, z, 1.2, 0.1, { lowCover: false });
  put('frozenPond', -15, 13, 1.05, 0.15); put('tracks', -9, 17, 1.15, 0.25); put('tracks', 8, 21, 1.1, -0.2);
  // Two shallow snowy dens (the props below) each get a few companions, so they read as part of the wood.
  for (const d of [FOX_DEN, RABBIT_DEN]) { put('cosySnowBush', d.x + (d.x < 0 ? -2.6 : 2.6), d.z + 1.2, 1.1, 0.3, { lowCover: false }); put('cosyPine', d.x + (d.x < 0 ? 1.8 : -1.8), d.z - 3.4, 0.8, 0.1, { lowCover: false, zone: 'sides' }); }
  return out;
}

/** A snowy den mound with a dark hole facing the camera. Returns parts, plus the hole's centre for the peeker. */
function denParts(x, z, tilt) {
  const p = [];
  p.push(part(G.sphere, '#f2f7fb', { p: [x, 0.35, z], s: [1.55, 0.95, 1.2] }), part(G.sphere, '#dfeaf3', { p: [x + 0.9 * tilt, 0.25, z + 0.35], s: [0.8, 0.5, 0.7] }),
    part(G.sphere, '#e8f1f8', { p: [x - 0.85 * tilt, 0.28, z - 0.2], s: [0.7, 0.45, 0.6] }));
  p.push(part(G.sphere, '#3b3040', { p: [x, 0.42, z + 0.86], s: [0.62, 0.52, 0.2] }));
  for (const [dx, dz, r] of [[-1.5, 0.7, 0.34], [1.45, 0.9, 0.28], [1.1, -0.9, 0.4]]) p.push(part(G.ico1, '#8d9aa3', { p: [x + dx, r * 0.4, z + dz], s: [r, r * 0.7, r * 0.8] }));
  return p;
}

function peekerGeo(kind) {
  const fox = kind === 'fox', body = fox ? '#f27d2a' : '#fbfaf6', inner = fox ? '#fff6ea' : '#f6b4c6', parts = [];
  parts.push(part(G.sphere, body, { p: [0, 0, 0], s: [0.36, 0.3, 0.3] }), part(G.sphere, body, { p: [0, -0.28, -0.08], s: [0.3, 0.3, 0.24] }));
  for (const s of [-1, 1]) {
    if (fox) { parts.push(part(G.cone6, body, { p: [0.2 * s, 0.34, 0], r: [0, 0, -0.18 * s], s: [0.12, 0.34, 0.07] }), part(G.cone6, '#3a2b30', { p: [0.225 * s, 0.5, 0], r: [0, 0, -0.18 * s], s: [0.06, 0.14, 0.05] }), part(G.sphere, inner, { p: [0.19 * s, -0.08, 0.14], s: [0.15, 0.1, 0.1] })); }
    else parts.push(part(G.sphere, body, { p: [0.12 * s, 0.52, -0.02], r: [0, 0, -0.12 * s], s: [0.075, 0.34, 0.06] }), part(G.sphere, inner, { p: [0.12 * s, 0.5, 0.02], r: [0, 0, -0.12 * s], s: [0.04, 0.24, 0.03] }));
    parts.push(part(G.sphereLo, '#241a33', { p: [0.13 * s, 0.05, 0.25], s: [0.05, 0.065, 0.03] }));
  }
  parts.push(part(G.sphereLo, fox ? '#241a2a' : '#f08aa6', { p: [0, -0.04, 0.3], s: [0.06, 0.045, 0.045] }));
  return combine(parts);
}

function featherGeo() {
  return combine([part(G.sphereLo, '#fbfaf3', { s: [0.045, 0.01, 0.17] }), part(G.sphereLo, '#d9d6cb', { p: [0, 0.006, 0], s: [0.012, 0.012, 0.15] })]);
}

function eggsExtras({ group, rng }) {
  const geos = [], dummy = new THREE.Object3D();
  // ---- peeking critters, one hole each: hidden most of the time, up, a look left and right, down.
  const peekers = [[FOX_DEN, 'fox', 0.8, 9.5, 2.5], [RABBIT_DEN, 'rabbit', -0.7, 11.5, 6.2]].map(([den, kind, face, period, offset]) => {
    const geo = peekerGeo(kind); geos.push(geo);
    const mesh = new THREE.Mesh(geo, VERTEX_TOON); mesh.name = `eggs-peeker-${kind}`; mesh.castShadow = false;
    mesh.position.set(den.x, -0.6, den.z + 0.78); mesh.scale.setScalar(1.15); group.add(mesh);
    return { mesh, den, face, period, offset };
  });
  // ---- feathers: a pool of 14 slow slivers (grouse laying, an egg caught); fixed InstancedMesh, no per-spawn allocation.
  const fg = featherGeo(); geos.push(fg);
  const fm = new THREE.InstancedMesh(fg, VERTEX_TOON, 14); fm.name = 'eggs-feathers'; fm.castShadow = false; fm.frustumCulled = false;
  fm.instanceMatrix.setUsage(THREE.DynamicDrawUsage); group.add(fm);
  const slots = Array.from({ length: 14 }, () => ({ age: 9, life: 1, x: 0, y: 0, z: 0, vx: 0, vz: 0, phase: 0, floor: 0 }));
  let next = 0;
  const feathers = {
    /** A few feathers drift down from (x, y, z); `floor` is the lowest y they reach before they fade out. */
    spawn(x, y, z, n = 2, floor = y - 1.4, life = 1.9) {
      for (let i = 0; i < n; i++) {
        const s = slots[next++ % slots.length];
        Object.assign(s, { age: 0, life: life * (0.8 + rng() * 0.4), x, y, z, vx: (rng() - 0.5) * 0.9, vz: (rng() - 0.3) * 0.5, phase: rng() * TAU, floor });
      }
    },
    get active() { return slots.filter(s => s.age < s.life).length; },
  };
  const hide = new THREE.Matrix4().compose(new THREE.Vector3(0, -50, 0), new THREE.Quaternion(), new THREE.Vector3(1e-4, 1e-4, 1e-4));
  return {
    api: { feathers }, ownedGeometries: geos,
    update(dt, t) {
      for (const p of peekers) {
        const k = ((t + p.offset) % p.period) / p.period;                        // 0..1 over one cycle
        const up = Math.min(1, Math.max(0, (k - 0.55) / 0.08)) * Math.min(1, Math.max(0, (0.93 - k) / 0.08));
        p.mesh.position.y = -0.62 + up * 0.78;
        p.mesh.rotation.y = p.face * (0.35 + Math.sin(k * 38) * 0.5) * up;
        p.mesh.visible = up > 0.001;
      }
      slots.forEach((s, i) => {
        s.age += dt;
        if (s.age >= s.life) { fm.setMatrixAt(i, hide); return; }
        const u = s.age / s.life, y = Math.max(s.floor, s.y - s.age * 0.75);
        const fade = Math.min(1, u * 6) * (y <= s.floor + 0.05 ? 0 : Math.min(1, (y - s.floor) * 3));
        dummy.position.set(s.x + s.vx * s.age + Math.sin(s.age * 3.2 + s.phase) * 0.25, y, s.z + s.vz * s.age);
        dummy.rotation.set(Math.sin(s.age * 2.4 + s.phase) * 0.7, s.phase + s.age * 1.1, Math.sin(s.age * 3 + s.phase) * 0.8);
        dummy.scale.setScalar(Math.max(0.0001, fade)); dummy.updateMatrix(); fm.setMatrixAt(i, dummy.matrix);
      });
      fm.instanceMatrix.needsUpdate = true;
    },
    dispose() { for (const g of geos) g.dispose(); fm.dispose(); for (const p of peekers) p.mesh.removeFromParent(); fm.removeFromParent(); },
  };
}

// ------------------------------------------------------------------------------------------------ Feast-Go-Round
const SPRING = { x: 10, z: -2 };
const FLUME_Y = 0.7;
const FLUME_R = 5.8;
function feastCompose({ cameras, origin, keepOut, rng }) {
  const { put, putNear, out } = makePut(keepOut, 98000);
  const groups = frameGroups(cameras, origin, [[-0.8, 0.1, 'side'], [0.8, 0.1, 'side'], [-0.74, -0.72, 'front'], [0.74, -0.72, 'front'], [0, -0.94, 'front'], [-0.45, 0.55, 'side'], [0.5, 0.5, 'side']]);
  groups.forEach((g, gi) => {
    const s = 1.2 + rng() * 0.4, kinds = g.role === 'front' ? ['fern', 'hibiscus', 'fernClump'] : [gi % 2 ? 'hibiscus' : 'plumeria', 'fern', 'fernClump'];
    [[-1.4, 0.1], [1.2, 0.5], [0, -1.35]].forEach(([dx, dz], i) => putNear(kinds[i], g.x + dx, g.z + dz, kinds[i] === 'hibiscus' || kinds[i] === 'plumeria' ? s * 1.5 : s, rng() * 0.5 - 0.25, { cluster: gi, lowCover: kinds[i] === 'fernClump', zone: g.role === 'front' ? 'front' : 'sides' }));
  });
  // A narrow border of flowers and ferns between the flume and the cheering row.
  [[-4.8, 'meadowFlowers'], [0.2, 'fernClump'], [4.9, 'meadowFlowers']].forEach(([x, kind], i) => put(kind, x, 9.0, 0.9, i, { cluster: 40 + i }));
  // Bamboo clumps of different heights behind and beside the counter, in loose groups (scatter parents + companions).
  const clumps = scatter({ seed: 8287 + 5, shape: rect(-19, 19, -19, -9.8), keepOut: [circle(0, -8.6, 2.2), circle(10, -2, 4)], count: 22, minDistance: 1.05, radius: 1.0, size: [0.9, 1.6], clusterRadius: 1.9 });
  clumps.forEach((p, i) => out.push({ id: 98500 + i, kind: 'bamboo', x: p.x, z: p.z, scale: p.scale, yaw: p.yaw, lowCover: false, zone: 'sides', layer: 'mid' }));
  const sides = scatter({ seed: 8287 + 6, shape: rect(-21, -13, -10, 8), keepOut: [circle(10, -2, 4), ...keepOut], count: 8, minDistance: 1.3, radius: 1.0, size: [0.8, 1.4], clusterRadius: 1.8 });
  sides.forEach((p, i) => out.push({ id: 98600 + i, kind: 'bamboo', x: p.x, z: p.z, scale: p.scale, yaw: p.yaw, lowCover: false, zone: 'sides', layer: 'mid' }));
  // The hot spring's irregular rocky rim: uneven spacing and size, with gaps where the steam leaves.
  let a = 0.3;
  for (let i = 0; i < 14 && a < TAU - 0.2; i++) {
    const r = 2.75 + rng() * 0.55, sc = 0.55 + rng() * 0.75;
    out.push({ id: 98700 + i, kind: 'rock', x: SPRING.x + Math.cos(a) * r * 1.08, z: SPRING.z + Math.sin(a) * r * 0.93, scale: sc, yaw: rng() * TAU, lowCover: false, zone: 'spring', layer: 'mid' });
    a += 0.28 + rng() * 0.62 + (i % 5 === 4 ? 0.55 : 0);
  }
  for (const [dx, dz, k, s] of [[3.3, 1.4, 'fernClump', 1.2], [3.4, -1.9, 'fern', 1.2], [0.4, 3.6, 'fernClump', 1.3], [-1.0, -3.4, 'meadowFlowers', 1.3]]) out.push({ id: 98800 + out.length, kind: k, x: SPRING.x + dx, z: SPRING.z + dz, scale: s, yaw: rng() * TAU, lowCover: true, zone: 'spring', layer: 'mid' });
  return out;
}

/** Water filling an irregular basin: UV.x runs from one bank to the other, so the banks foam like the islands' ponds. */
export function basinGeometry(cx, cz, rx, rz, y, wobble, seed) {
  const r2 = mulberry32(seed), p1 = r2() * TAU, p2 = r2() * TAU, n = 72;
  const path = Array.from({ length: n + 1 }, (_, i) => ({ x: cx - rx + 2 * rx * i / n, y, z: cz }));
  return buildRibbonGeometry(path, (i, p) => {
    const u = (p.x - cx) / rx; if (Math.abs(u) >= 1) return 0.004;
    return Math.max(0.004, rz * Math.sqrt(1 - u * u) * (1 + wobble * Math.sin(p.x * 0.31 + p1) + wobble * 0.7 * Math.sin(p.x * 0.83 + p2)));
  });
}
function basinPolygon(cx, cz, rx, rz, wobble, seed, n = 48) {
  const r2 = mulberry32(seed), p1 = r2() * TAU, p2 = r2() * TAU, half = x => { const u = (x - cx) / rx; return Math.abs(u) >= 1 ? 0 : rz * Math.sqrt(1 - u * u) * (1 + wobble * Math.sin(x * 0.31 + p1) + wobble * 0.7 * Math.sin(x * 0.83 + p2)); };
  const xs = Array.from({ length: n + 1 }, (_, i) => cx - rx + 2 * rx * i / n), up = xs.map(x => ({ x, z: cz + half(x) })), down = xs.map(x => ({ x, z: cz - half(x) })).reverse();
  return { type: 'polygon', points: [...up, ...down] };
}

export function ownWater(materials, shallow, deep, ownClock, foam = null) {
  const m = materials.water.clone();
  if (foam) m.uniforms.uFoam.value.set(foam);
  m.uniforms.uTime = ownClock ? { value: 0 } : waterUniforms.uTime;
  m.uniforms.uShallow.value.set(shallow); m.uniforms.uDeep.value.set(deep);
  for (const k of ['uShallowTint', 'uDeepTint', 'uFoamTint']) m.uniforms[k].value.set('#ffffff');
  m.uniforms.uNight.value = 0;
  return m;
}

function feastExtras({ group, materials, rng }) {
  const geos = [], mats = [];
  // The flume: a ring ribbon between the gold rims, on its OWN clock that runs forward and backward with the current.
  const flumeMat = ownWater(materials, '#7fe0d0', '#3fa9b6', true); mats.push(flumeMat);
  const path = Array.from({ length: 97 }, (_, i) => ({ x: Math.cos(i / 96 * TAU) * FLUME_R, y: FLUME_Y, z: Math.sin(i / 96 * TAU) * FLUME_R }));
  const flumeGeo = buildRibbonGeometry(path, 0.6); geos.push(flumeGeo);
  const flume = new THREE.Mesh(flumeGeo, flumeMat); flume.name = 'party-flume-water'; flume.frustumCulled = false; group.add(flume);
  // Foam flecks carried round at the dishes' angular speed (so the current is obvious), one instanced draw.
  const fleckGeo = combine([part(G.sphereLo, '#f4fbf8', { s: [0.2, 0.025, 0.1] })]); geos.push(fleckGeo);
  const flecks = new THREE.InstancedMesh(fleckGeo, VERTEX_TOON, 16); flecks.name = 'party-flume-flecks'; flecks.castShadow = false; flecks.frustumCulled = false;
  flecks.instanceMatrix.setUsage(THREE.DynamicDrawUsage); group.add(flecks);
  const fl = Array.from({ length: 16 }, (_, i) => ({ a: i / 16 * TAU + rng() * 0.3, r: FLUME_R + (rng() - 0.5) * 0.7, s: 0.8 + rng() * 0.7 }));
  // The hot spring: steaming turquoise in a rocky basin, a gentle ripple of its own.
  const springMat = ownWater(materials, '#8ae8da', '#4fc7c4', false); mats.push(springMat);
  const springGeo = basinGeometry(SPRING.x, SPRING.z, 2.5, 2.3, 0.1, 0.07, 4471); geos.push(springGeo);
  const spring = new THREE.Mesh(springGeo, springMat); spring.name = 'party-stage-water'; spring.frustumCulled = false; group.add(spring);
  const dummy = new THREE.Object3D();
  let phase = 0;
  return {
    api: { get flumePhase() { return phase; }, flume }, ownedGeometries: geos, ownedMaterials: mats,
    update(dt, t, players, info) {
      const dir = info?.v?.direction ?? 1;
      flumeMat.uniforms.uTime.value += dt * dir * 1.71;                           // 1.71 uTime/s moves the foam streaks at the dishes' 2.78 u/s
      phase += dt * dir * F.speed;
      fl.forEach((f, i) => {
        const a = f.a + phase;
        dummy.position.set(Math.cos(a) * f.r, FLUME_Y + 0.025, Math.sin(a) * f.r); dummy.rotation.set(0, -a + Math.PI / 2 + Math.sin(t * 1.3 + i) * 0.2, 0);
        dummy.scale.setScalar(f.s * (0.85 + 0.15 * Math.sin(t * 2 + i * 1.7))); dummy.updateMatrix(); flecks.setMatrixAt(i, dummy.matrix);
      });
      flecks.instanceMatrix.needsUpdate = true;
    },
    dispose() { for (const g of geos) g.dispose(); for (const m of mats) m.dispose(); flecks.dispose(); flume.removeFromParent(); flecks.removeFromParent(); spring.removeFromParent(); },
  };
}

// ------------------------------------------------------------------------------------------------ Puffball Bumpers
export const MARSH = Object.freeze({ cx: 0, cz: -1, rx: 28, rz: 20, wobble: 0.09, seed: 6113, waterY: 0.012 });
const MARSH_FLOOR = -8.3;
const marshPoly = () => basinPolygon(MARSH.cx, MARSH.cz, MARSH.rx, MARSH.rz, MARSH.wobble, MARSH.seed);
const ISLETS = [[-14, -9, 2.2], [15.5, -11, 2.5], [-19, 3, 1.9], [20, 4, 2.1], [-7, -16.5, 2.3], [8.5, -17, 2.0], [-21, -6.5, 1.7], [22, -5, 1.9]];

function bumpersCompose({ cameras, origin, keepOut, rng }) {
  const out = [];
  const water = keepOut.find(s => s.type === 'polygon');
  const solidKeep = keepOut.filter(s => s !== water);
  // Lily pads lie on the water; cap shrink reveals the middle, so only the stem and the walking patch stay clear.
  const pads = scatter({ seed: 6114, shape: water, keepOut: [circle(0, 0, 3.2), circle(0, 8, 5.2)], count: 44, minDistance: 3.4, radius: 0.9, size: [0.85, 1.5], cluster: true, clusterRadius: 2.4,
    layer: () => 'mid', accept: p => Math.hypot(p.x, p.z) < 26 });
  pads.forEach((p, i) => out.push({ id: 99000 + i, kind: 'lilyPads', x: p.x, z: p.z, scale: p.scale, yaw: p.yaw, lowCover: true, y: 0.03, zone: 'front', layer: 'foreground' }));
  // Islets in the marsh: a mud patch, a mushroom or two, glowing clumps and reeds.
  ISLETS.forEach(([x, z, r], i) => {
    out.push({ id: 99100 + i * 10, kind: 'patch', x, z, scale: r, color: '#5d5f86', edge: '#4a4a72', yaw: 0, lowCover: true, y: 0.03, zone: 'front', layer: 'foreground' });
    out.push({ id: 99101 + i * 10, kind: i % 3 === 1 ? 'giant-b' : 'giant-a', x: x + 0.3, z: z - 0.2, scale: 0.5 + rng() * 0.25, yaw: rng() * TAU, lowCover: false, zone: 'islet', layer: 'mid' });
    out.push({ id: 99102 + i * 10, kind: 'mushroomClump', x: x - r * 0.45, z: z + r * 0.4, scale: 0.9, yaw: rng() * TAU, lowCover: true, unlit: true, zone: 'islet', layer: 'foreground' });
    for (let k = 0; k < 2; k++) out.push({ id: 99103 + i * 10 + k, kind: 'reed', x: x + Math.cos(k * 2.3 + i) * r * 0.62, z: z + Math.sin(k * 2.3 + i) * r * 0.5, scale: 0.9 + rng() * 0.6, yaw: rng() * TAU, lowCover: false, zone: 'islet', layer: 'mid' });
  });
  // Reeds along the shore, in clumps of three, and groves of giants (mixed with the small far silhouettes) on the banks.
  const bank = scatter({ seed: 6115, shape: circle(0, 0, 42), keepOut: [water, ...solidKeep], count: 58, minDistance: 2.9, radius: 2.4, size: [0.7, 1.15], clusterRadius: 3.4,
    accept: p => Math.hypot(p.x, p.z) > 20, layer: () => 'mid' });
  bank.forEach((p, i) => out.push({ id: 99300 + i, kind: i % 3 === 0 ? 'giant-a' : i % 11 === 4 ? 'giant-b' : 'farMushroom', x: p.x, z: p.z, scale: i % 3 === 0 || i % 11 === 4 ? p.scale : 1.4 + p.scale, yaw: p.yaw, lowCover: false, zone: 'sides', layer: 'mid' }));
  const shore = scatter({ seed: 6116, shape: circle(0, 0, 40), keepOut: [water, ...solidKeep], count: 40, minDistance: 0.55, radius: 0.4, size: [0.9, 1.5], clusterRadius: 1.0, accept: p => distanceToShape(water, p.x, p.z) < 2.6, layer: () => 'mid' });
  shore.forEach((p, i) => out.push({ id: 99500 + i, kind: i % 6 === 5 ? 'mushroomClump' : 'reed', x: p.x, z: p.z, scale: p.scale, yaw: p.yaw, lowCover: false, unlit: i % 6 === 5, zone: 'shore', layer: 'mid' }));
  return out;
}

function bumpersExtras({ group, materials }) {
  const geos = [], mats = [];
  const waterMat = ownWater(materials, '#46589e', '#2a3470', false, '#8896c8'); mats.push(waterMat);
  const geo = basinGeometry(MARSH.cx, MARSH.cz, MARSH.rx, MARSH.rz, MARSH.waterY, MARSH.wobble, MARSH.seed); geos.push(geo);
  const mesh = new THREE.Mesh(geo, waterMat); mesh.name = 'party-stage-water'; mesh.frustumCulled = false; group.add(mesh);
  // The walking patch is a low sandbank: a pale foam-coloured ring where the water meets it.
  return { api: { water: mesh }, ownedGeometries: geos, ownedMaterials: mats, update() {},
    dispose() { for (const g of geos) g.dispose(); for (const m of mats) m.dispose(); mesh.removeFromParent(); } };
}

// ------------------------------------------------------------------------------------------------ Sizzle extras
function sizzleExtras({ group }) {
  // A warm pool of light on the dirt round the fire: vertex colours fade to black at the rim, drawn additively, so it only tints the
  // ground (an emissive decal, no light). Its rim is irregular (groundPatch radii) and it flickers by scale and brightness.
  const geo = groundPatch({ seed: 8290, radius: 3.9, color: '#4d2608', edge: '#000000', segments: 28, rings: 5 }).toNonIndexed();
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const mesh = new THREE.Mesh(geo, mat); mesh.name = 'sizzle-fire-glow'; mesh.position.y = 0.118; mesh.renderOrder = 1; mesh.castShadow = false; group.add(mesh);
  return { api: { glow: mesh }, ownedGeometries: [geo], ownedMaterials: [mat],
    update(dt, t) {
      const f = 1 + Math.sin(t * 11) * 0.045 + Math.sin(t * 17.3 + 1) * 0.03;
      mesh.scale.set(f, 1, f); mesh.rotation.y = Math.sin(t * 0.6) * 0.3;
      mat.color.setScalar(0.78 + 0.22 * Math.sin(t * 9.3) * Math.sin(t * 4.1 + 0.5));
    },
    dispose() { geo.dispose(); mat.dispose(); mesh.removeFromParent(); } };
}

// ------------------------------------------------------------------------------------------------ the registry
const sizzlePts = () => [...gridDisc(0, 0, S.arenaR, 1.2, [0, 1.3, 2.6, 3.6]),
  ...[-4.5, -1.5, 1.5, 4.5].flatMap(x => gridDisc(x, S.spectatorZ, 1.2, 0.8, [0, 1.3, 2.6])),
  ...gridDisc(DUB.x, DUB.z, 1.2, 0.8, [0, 1.2, 2.4, 3.4]), ...gridDisc(BASKET.x, BASKET.z, 1.4, 0.9, [0, 0.8, 1.8])];
const eggsPts = () => [...gridRect(-12.2, 12.2, E.laneZ - 0.8, E.laneZ + 0.8, 1.2, [0, 1.3, 2.6, 3.9, 5.2, 6.5, 7.6, 8.6]),
  ...E.lanes.flatMap(x => [[x, E.laneZ + 3.2, [0, 1, 2]], [x, E.spectatorZ, [0, 1.3, 2.6]]]), ...gridDisc(-14.4, E.laneZ, 1.1, 0.8, [0, 1.2, 2.4, 3.4])];
const feastPts = () => [...gridDisc(0, 0, 6.8, 1.1, [0, 1.3, 2.6]), ...gridDisc(0, -8.6, 1.4, 0.8, [0, 1.2, 2.4, 3.6]), ...gridRect(-5.4, 5.4, 11.2, 12.8, 1.2, [0, 1.3, 2.6])];
const bumpersPts = () => [...gridDisc(0, 0, 9.8, 1.4, [0, 1.3, 2.6, 3.6]), ...gridDisc(B.spectator.x, B.spectator.z, B.spectator.r, 1.1, [B.spectator.y, B.spectator.y + 1.3, B.spectator.y + 2.6])];

export const SPECS = {
  sizzle: {
    biome: { seed: 8285, ground: '#79b85a', light: '#8ccd66', trees: ['oak', 'birch', 'pine', 'bush'], life: { butterfly: 5, bird: 1, cinder: 10, campSmoke: 4 } },
    look: 'warm', patchR: 16.5, smallKinds: ['grass', 'flowerWhite', 'grass', 'flowerYellow', 'grass', 'pebble', 'flowerPink', 'leaf'], low: 420, groves: 125, softColor: '#b7c6aa',
    keepOut: () => [circle(0, 0, S.arenaR + 0.9), rect(-6.9, 6.9, S.spectatorZ - 1.9, S.spectatorZ + 1.9), circle(DUB.x, DUB.z, 2.3), circle(BASKET.x, BASKET.z, 2.2)],
    points: sizzlePts, compose: sizzleCompose, extras: sizzleExtras,
    groundParts: () => [groundPatch({ seed: 8291, radius: 13.2, color: '#d3b07a', edge: '#79b85a', segments: 56, rings: 5 }).translate(0, 0.03, 0).toNonIndexed()],
    habitats: { cinder: [{ x: -0.2, y: 1.5, z: 0.05 }, { x: 0.25, y: 1.7, z: -0.1 }], campSmoke: [{ x: 0.1, y: 2.1, z: -0.3 }], butterfly: [{ x: -14.5, y: 0.1, z: 3.5 }, { x: 14.2, y: 0.1, z: -3.5 }, { x: -16, y: 0.1, z: -10 }] },
  },
  eggs: {
    biome: { seed: 8286, ground: '#eaf2f7', light: '#f2f7fb', trees: ['pine', 'spruce', 'pine', 'bush'], life: { snow: 24, bird: 1 } },
    look: 'snowGrove', patchR: 16.5, groundTint: '#c7d9eb', smallKinds: ['grass'], low: 260, groves: 125, softColor: '#b7c6aa', tint: i => i % 3 ? '#cbd9d4' : '#f4f8fb', grove: 'snowPine',
    keepOut: () => [rect(-12.7, 12.7, E.laneZ - 1.9, 6.9), rect(-11.2, 11.2, 7.1, 9.8), circle(-13.2, 1.9, 1.0), circle(13.2, 1.9, 1.0), circle(-14.4, E.laneZ, 1.9), circle(FOX_DEN.x, FOX_DEN.z, 2.4), circle(RABBIT_DEN.x, RABBIT_DEN.z, 2.4)],
    points: eggsPts, compose: eggsCompose, extras: eggsExtras,
    groundParts: () => [groundPatch({ seed: 8292, radius: 12.6, color: '#d9e6f1', edge: '#eaf2f7', segments: 56, rings: 5, sx: 1.75, sz: 0.62 }).translate(0, 0.028, 3.8).toNonIndexed()],
    props: () => [{ kind: 'den', geo: combine(denParts(FOX_DEN.x, FOX_DEN.z, 1)) }, { kind: 'den', geo: combine(denParts(RABBIT_DEN.x, RABBIT_DEN.z, -1)) }],
    habitats: { bird: [{ x: -20, y: 0, z: -21 }, { x: 20, y: 0, z: -22 }] },
  },
  feastround: {
    biome: { seed: 8287, ground: '#acd470', light: '#bde07f', trees: ['coconut', 'banana', 'jungle', 'bush'], life: { butterfly: 4, dragonfly: 3, hotSteam: 7, petal: 8 } },
    look: 'warm', patchR: 15, smallKinds: ['grass', 'flowerYellow', 'grass', 'flowerPink', 'leaf', 'flowerWhite'], low: 300, groves: 110, softColor: '#bdd49b',
    keepOut: () => [circle(0, 0, 7.5), circle(SPRING.x, SPRING.z, 2.6), circle(0, -8.6, 2.0), rect(-6.9, 6.9, 10.4, 13.6)],
    points: feastPts, compose: feastCompose, extras: feastExtras,
    groundParts: () => [groundPatch({ seed: 8293, radius: 3.8, color: '#8c897a', edge: '#acd470', segments: 40, rings: 5 }).translate(SPRING.x, 0.04, SPRING.z).toNonIndexed()],
    habitats: { hotSteam: [{ x: SPRING.x - 0.5, y: 0.3, z: SPRING.z + 0.2 }, { x: SPRING.x + 0.7, y: 0.3, z: SPRING.z - 0.5 }], dragonfly: [{ x: SPRING.x + 3.6, y: 0.5, z: SPRING.z + 3.2 }, { x: -13.5, y: 0.5, z: 5 }], butterfly: [{ x: -15, y: 0.2, z: 3 }, { x: 14.5, y: 0.2, z: 8 }, { x: -13, y: 0.2, z: -6 }] },
  },
  bumpers: {
    biome: { seed: 8288, ground: '#4b4e78', light: '#585b86', trees: ['giant-a', 'giant-b', 'giant-a', 'bush'], life: { firefly: 12, spore: 14, fish: 2, mist: 9 } },
    look: 'dusk', floorY: MARSH_FLOOR, patchR: 0, smallKinds: ['grass', 'pebble', 'grass', 'flowerPurple'], low: 200, groves: 0, softColor: '#8f8fb8', farRing: 'farMushroom',
    keepOut: () => [marshPoly(), circle(0, 0, 2.4), circle(B.spectator.x, B.spectator.z, 4.6)],
    points: bumpersPts, compose: bumpersCompose, extras: bumpersExtras,
    habitats: { mist: [{ x: -16, y: 1.0, z: -6 }, { x: 15, y: 1.8, z: -4 }, { x: -8, y: 2.6, z: -15 }, { x: 9, y: 1.3, z: -16 }, { x: -18, y: 2.2, z: 7 }, { x: 19, y: 0.9, z: 9 }],
      firefly: [{ x: -21, y: 0.6, z: -10 }, { x: 22, y: 0.8, z: -8 }, { x: -22, y: 0.7, z: 6 }, { x: 23, y: 0.6, z: 3 }],
      spore: [{ x: -24, y: 0.3, z: -4 }, { x: 25, y: 0.3, z: -2 }], fish: [{ x: -13, y: 0.03, z: -3 }, { x: 13, y: 0.03, z: -9 }] },
  },
};
export const isSpec82c = id => id in SPECS; // (82d registers its four specs into SPECS from living82d.js)
export const specKeepOut = id => SPECS[id].keepOut();
export function specGameplayPoints(id) {
  const o = PARTY.origin, c = stageCentre(id), out = [];
  for (const [x, z, heights] of SPECS[id].points()) for (const y of heights) out.push(new THREE.Vector3(c.x + x, o.y + y, c.z + z));
  return out;
}
