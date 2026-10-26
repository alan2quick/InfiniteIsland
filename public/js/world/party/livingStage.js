// Step 82b: seeded scenery around fixed, judged stage pieces. Local bounds include
// wind; depth-aware camera checks admit backdrops, never foreground occluders.
// One leased sway / water pair for ALL party stages, no lights or new programs.
import * as THREE from 'three';
import { PARTY } from '../../config.js';
import { stageCentre, timberPads, marlosaysPads, huddlePads } from '../../game/party/partyArea.js';
import { FollowCamera } from '../../camera/followCamera.js';
import { part, G, combine, VERTEX_TOON } from '../../render/geo.js';
import { buildRibbonGeometry } from '../water.js';
import { scatter, distanceToShape } from './scatter.js';
import { acquirePartyMaterials, createDecor, groundPatch } from './decor.js';
import { createPartyLife } from './life.js';
import { sphereCoversPoint } from './glade.js';
import { mulberry32 } from '../../utils/rng.js';
import { lowDecorAsset } from './decorLow.js';
import { glow } from './kit.js';
import { dressingAsset } from './stageDressing.js';
import { composeStage } from './stageComposition.js';
import { SPECS, isSpec82c, specKeepOut, specGameplayPoints } from './living82c.js';
import './living82d.js'; // (registers Glowcap Shuffle, Driftwood Cast, Tilty Tiles and Bonk Burrows into SPECS)

// A head-only look keeps feet, held flags and every judged piece fixed. Prefer the
// current leader; bounded neck motion still faces the camera enough to read a call.
export function hostIdle(model, t, v, players = []) {
  const ranked = players.filter(Boolean).slice().sort((a, b) => {
    const score = p => v?.totals?.[p.index] ?? v?.seats?.[p.index]?.left ?? (v?.alive?.[p.index] === false ? -1 : 0);
    return score(b) - score(a);
  });
  let yaw = Math.sin(t * 0.35) * 0.12;
  if (ranked[0]) {
    model.root.updateWorldMatrix(true, false);
    const local = model.root.worldToLocal(ranked[0].position.clone());
    yaw = Math.max(-0.22, Math.min(0.22, Math.atan2(local.x, local.z)));
  }
  if (model.headGroup) model.headGroup.rotation.y = yaw;
  if (v && model.headGroup) {
    const signature = `${Object.values(v.alive || {}).filter(Boolean).length}|${Object.values(v.totals || {}).reduce((a, b) => a + b, 0)}|${Object.values(v.seats || {}).reduce((a, b) => a + (b.safe || 0), 0)}|${!!v.done}`;
    const idle = model.root.userData.partyIdle ||= { signature, until: -1 };
    if (signature !== idle.signature) { idle.signature = signature; idle.until = t + 0.7; }
    model.headGroup.rotation.z = Math.max(0, idle.until - t) * Math.sin(t * 8) * 0.15;
  }
  if (model.torso) model.torso.scale.y = 1 + Math.sin(t * 1.8) * 0.009;
}

export const STAGE_ASPECTS = [16 / 9, 9 / 16, 19.5 / 9];
const BIOMES = {
  vineskip: { seed: 8281, ground: '#345d4c', light: '#507759', trees: ['coconut', 'banana', 'jungle', 'bush'], life: { firefly: 12, moth: 5, ember: 8, smoke: 5 } },
  timber: { seed: 8282, ground: '#79b85a', light: '#8ccd66', trees: ['oak', 'birch', 'pine', 'bush'], life: { butterfly: 6, bird: 2, leaf: 10, sawdust: 12 } },
  marlosays: { seed: 8283, ground: '#f3dca4', light: '#f8e8b8', trees: ['coconut', 'banana', 'breadfruit', 'bush'], life: { bird: 2, crab: 4 } },
  huddle: { seed: 8284, ground: '#eaf2f7', light: '#f8fafc', trees: ['pine', 'spruce', 'pine', 'bush'], life: { snow: 26, snowDust: 8, bird: 1, breath: 5 } },
};
const circle = (x, z, r) => ({ type: 'circle', x, z, r });
const rect = (x0, x1, z0, z1) => ({ type: 'rect', x0, x1, z0, z1 });

export function stageCamera(cfg, aspect) {
  const camera = new THREE.PerspectiveCamera(40, aspect, 0.1, 600);
  const follow = new FollowCamera(camera, { offset: cfg.offset });
  follow.update(0, { ...cfg.focus, y: cfg.focus.y - 0.9 }, Math.max(0.8, follow.zoomForExtent(cfg.extent.w, cfg.extent.d, 0.4, false)));
  camera.updateMatrixWorld(true); return camera;
}

/** Low cover keeps out of every pad, judged lane / sweep and access path, even
 * though pieces below .45 may otherwise lie on the stage floor. */
export function stageKeepOut(id) {
  if (isSpec82c(id)) return specKeepOut(id);
  const c = stageCentre(id), T = PARTY.timber, M = PARTY.marlosays, H = PARTY.huddle;
  if (id === 'vineskip') return [circle(0, 0, PARTY.vineskip.rimMax + 0.7)];
  const pads = ({ timber: timberPads, marlosays: marlosaysPads, huddle: huddlePads })[id]();
  const shapes = pads.map(p => circle(p.x - c.x, p.z - c.z, p.r + 0.65));
  if (id === 'timber') shapes.push(...T.lanes.map(x => rect(x - 1.85, x + 1.85, T.chuteZ - 2.5, T.endZ + 3)), rect(-14, -9, -6, 0), rect(-11, 11, -1.4, 1.4));
  if (id === 'marlosays') shapes.push(rect(-13, 13, M.postZ - 6.5, M.postZ + 5.8), rect(-5, 5, -11, -4.5), rect(8, 15, -11, -5), circle(-9.6, -4.6, 1.8), circle(9.6, -4.6, 1.8), { ...rect(-250, 250, -300, -17), sceneryOnly: true });
  if (id === 'huddle') shapes.push(rect(-9, 9, H.stumpZ - 2, H.stumpZ + 2), rect(-14.5, -9, -4, 1));
  // Keep the actual narrow approaches, rather than excluding the entire front lawn.
  const xs = id === 'timber' ? [-6, -2, 2, 6] : id === 'huddle' ? H.stumps : M.posts;
  const benchZ = id === 'timber' ? T.spectatorZ : id === 'huddle' ? H.spectatorZ : M.beachZ;
  shapes.push(...xs.map(x => rect(x - 0.45, x + 0.45, 3, benchZ)));
  return shapes;
}

export function stageGameplayPoints(id) {
  if (isSpec82c(id)) return specGameplayPoints(id);
  const out = [], c = stageCentre(id);
  const add = (x, z, heights = [0, 1.3, 2.6]) => { for (const y of heights) out.push(new THREE.Vector3(c.x + x, PARTY.origin.y + y, c.z + z)); };
  if (id === 'vineskip') {
    for (let x = -10.4; x <= 10.4; x += 0.8) for (let z = -10.4; z <= 10.4; z += 0.8) if (Math.hypot(x, z) <= 10.4) add(x, z);
  } else {
    const shapes = stageKeepOut(id);
    for (const s of shapes) {
      if (s.sceneryOnly) continue;
      if (s.type === 'circle') { add(s.x, s.z); for (let a = 0; a < 6.28; a += 0.5) add(s.x + Math.cos(a) * s.r, s.z + Math.sin(a) * s.r); }
      else for (let x = s.x0; x <= s.x1; x += 1) for (let z = s.z0; z <= s.z1; z += 1) add(x, z);
    }
  }
  if (id === 'huddle') for (const x of PARTY.huddle.stumps) for (let y = 0; y <= 11; y += 0.5) add(x, PARTY.huddle.stumpZ, [y]);
  if (id === 'marlosays') for (const x of [-9.6, 9.6]) for (let y = 0; y < 9; y += 0.5) for (let dx = -5; dx <= 5; dx += 1) add(x + dx, -4.6, [y]);
  return out;
}

export function sphereInFrame(sphere, camera) {
  const p = sphere.center.clone().applyMatrix4(camera.matrixWorldInverse), r = sphere.radius, d = -p.z;
  if (d + r <= camera.near) return false;
  const near = Math.max(camera.near, d - r), far = Math.max(camera.near, d + r);
  const kx = camera.projectionMatrix.elements[0], ky = camera.projectionMatrix.elements[5];
  const xs = [(p.x - r) * kx / near, (p.x + r) * kx / near, (p.x - r) * kx / far, (p.x + r) * kx / far];
  const ys = [(p.y - r) * ky / near, (p.y + r) * ky / near, (p.y - r) * ky / far, (p.y + r) * ky / far];
  return Math.min(...xs) < 1 && Math.max(...xs) > -1 && Math.min(...ys) < 1 && Math.max(...ys) > -1;
}

/** A real open, sloped sandy shoulder; no filled disc above the water. This replaces
 * only the decorative rim, leaving the posts and their coloured judged rings fixed. */
export function marloPoolBank() {
  const pos = [], colors = [], indices = [], n = 96;
  for (let ring = 0; ring < 2; ring++) for (let i = 0; i <= n; i++) {
    const a = i / n * Math.PI * 2;
    pos.push(Math.cos(a) * (ring ? 12.4 : 11.5), ring ? 0.022 : 0.105, PARTY.marlosays.postZ - 0.2 + Math.sin(a) * (ring ? 6 : 5.1));
    const c = new THREE.Color(ring ? '#f8e8b8' : '#b8a27a'); colors.push(c.r, c.g, c.b);
    if (ring && i) { const k = n + 1 + i; indices.push(k, k - 1, i, k - 1, i - 1, i); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3 * 2), 2));
  g.setIndex(indices); g.computeVertexNormals(); const flat = g.toNonIndexed(); g.dispose(); return flat;
}

// All water surfaces share a single batch, including Timber's four films. Width
// is HALF width; closed paths give moat / pool bank foam without a second shader.
export function stageWaterGeometry(id, { poolOnly = false, oceanOnly = false } = {}) {
  const ribbons = [], T = PARTY.timber, M = PARTY.marlosays, V = PARTY.vineskip;
  const ribbon = (path, width) => ribbons.push(buildRibbonGeometry(path, width));
  const ellipse = (rx, rz, z, y, width, n = 96) => ribbon(Array.from({ length: n + 1 }, (_, i) => {
    const a = i / n * Math.PI * 2; return { x: Math.cos(a) * rx, y, z: z + Math.sin(a) * rz };
  }), width);
  if (id === 'vineskip') ellipse((V.rMax + 0.2 + V.rimMin) / 2, (V.rMax + 0.2 + V.rimMin) / 2, 0, 0.035, (V.rimMin - V.rMax - 0.2) / 2);
  if (id === 'timber') for (const x of T.lanes) ribbon([{ x, y: 0.315, z: T.chuteZ - 0.4 }, { x, y: 0.315, z: T.endZ + 0.4 }], 1.04);
  if (id === 'marlosays') {
    // A filled ellipse, with UV.x following the distance from its sandy banks.
    const path = Array.from({ length: 65 }, (_, i) => { const x = -11.5 + 23 * i / 64; return { x, y: 0.095, z: M.postZ - 0.2 }; });
    if (!oceanOnly) ribbon(path, (i, p) => Math.max(0.005, 5.1 * Math.sqrt(Math.max(0, 1 - (p.x / 11.5) ** 2))));
    if (!poolOnly) ribbons.push(oceanGeometry());
  }
  return ribbons.length ? combine(ribbons) : null;
}

export const coastZ = x => -18.5 + Math.sin(x * 0.15) * 0.7 + Math.cos(x * 0.31) * 0.25;
// UV distance concentrates foam in the first half-unit of shore. The open sea has
// no second bank or far foam stripe, and extends past all three cameras' horizons.
function oceanGeometry() {
  const depths = [0, 0.25, 0.6, 1.2, 3, 8, 20, 60, 150, 260], p = [], uv = [], idx = [], n = 100;
  for (let row = 0; row < depths.length; row++) for (let i = 0; i <= n; i++) {
    const x = -250 + i * 5, d = depths[row]; p.push(x, 0.015, coastZ(x) - d);
    uv.push(0.5 * (1 - Math.exp(-d * 1.7)), x);
    if (row && i) { const k = row * (n + 1) + i; idx.push(k, k - 1, k - n - 1, k - 1, k - n - 2, k - n - 1); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); return g;
}

function seaBank() {
  const pos = [], cols = [], idx = [], n = 101;
  for (let ring = 0; ring < 2; ring++) for (let i = 0; i < n; i++) {
    const x = -250 + i * 5; pos.push(x, ring ? 0.001 : 0.035, coastZ(x) + ring * 0.9);
    const c = new THREE.Color(ring ? '#f3dca4' : '#d3c5a1'); cols.push(c.r, c.g, c.b);
  }
  for (let i = 1; i < n; i++) idx.push(i, i - 1, i + n, i - 1, i + n - 1, i + n);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 4), 2));
  g.setIndex(idx); g.computeVertexNormals(); const flat = g.toNonIndexed(); g.dispose(); return flat;
}

/** Every device receives the UNION of deterministic camera-band candidates. No
 * viewport-dependent scene rebuilds; broad clumps remain real world geometry. */
function frontDressing(id, cameras, origin, keepOut, rng) {
  const kinds = {
    vineskip: ['fernClump', 'flowerClump', 'grassClump', 'rock', 'mushroomClump'],
    timber: ['grassClump', 'grassClump', 'flowerClump', 'fernClump', 'stump', 'log'],
    marlosays: ['shellClump', 'grassClump', 'shellClump', 'driftwood', 'starfish', 'rock', 'patch'],
    huddle: ['snowRock', 'snowBush', 'grassClump', 'tracks', 'patch', 'snowBush'],
  }[id], out = [], ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -origin.y);
  const at = (camera, x, y) => { ray.setFromCamera(new THREE.Vector2(x, y), camera); const p = ray.ray.intersectPlane(plane, new THREE.Vector3()); return p?.sub(origin); };
  for (const camera of cameras) for (const row of [1, 2]) for (let col = 0; col < 3; col++) {
    if (row === 1 && col === 1) continue; // occupied by players / judged pieces
    let added = 0;
    for (let attempt = 0; attempt < 220 && added < 24; attempt++) {
      const p = at(camera, -1 + (col + 0.08 + rng() * 0.84) * 2 / 3, 1 - (row + 0.08 + rng() * 0.84) * 2 / 3);
      if (!p || Math.hypot(p.x, p.z) > 90) continue;
      const kind = kinds[Math.floor(rng() * kinds.length)], scale = 0.85 + rng() * 0.5;
      const footprint = kind === 'patch' ? 1.5 : Math.max(0.65, dressingAsset(kind).userData.footprint + 0.06);
      if (keepOut.some(s => distanceToShape(s, p.x, p.z) < footprint * scale) || out.some(q => Math.hypot(q.x - p.x, q.z - p.z) < 1.25)) continue;
      out.push({ id: 90000 + out.length, kind, x: p.x, z: p.z, scale, yaw: rng() * 6.28, lowCover: true, layer: 'foreground', zone: 'front',
        unlit: kind === 'mushroomClump',
        ...(kind === 'patch' ? { scale: scale * 1.5, color: id === 'huddle' ? '#aabfd3' : '#c4b292', edge: BIOMES[id].ground } : {}),
        ...(id === 'huddle' && kind === 'grassClump' ? { tint: '#91aaa9' } : {}) });
      added++;
    }
  }
  // Partly clipped large silhouettes, admitted by the same conservative spheres.
  for (const camera of cameras) for (const side of [-1, 1]) for (let j = 0; j < 4; j++) {
    const p = at(camera, side * (0.98 + j * 0.07), -0.88 + j * 0.08);
    if (p && !keepOut.some(s => distanceToShape(s, p.x, p.z) < 3)) out.push({ x: p.x, z: p.z, kind: id === 'huddle' ? j % 2 ? 'pineBranch' : 'snowRock' : id === 'timber' ? j % 2 ? 'fernClump' : 'rock' : 'fronds', scale: 1.5, yaw: rng() * 6.28, lowCover: false, layer: 'foreground', zone: 'frame' });
  }
  // Tall side groves wrap into the middle of the frame, beyond the camera corridor.
  // Three depths and mixed heights avoid another straight row / evenly sized ring.
  for (const camera of cameras) for (const side of [-1, 1]) for (let j = 0; j < 3; j++) {
    const p = at(camera, side * (1.04 + rng() * 0.07), 0.16 - j * 0.18);
    if (p && !keepOut.some(s => distanceToShape(s, p.x, p.z) < 3)) out.push({ x: p.x, z: p.z, kind: id === 'huddle' ? 'snowPine' : BIOMES[id].trees[j % 3], scale: 0.8 + rng() * 0.6, yaw: rng() * 6.28, lowCover: false, layer: 'mid', zone: 'sides' });
  }
  return out;
}

export function createStageLiving({ root, id, cam }) {
  const spec = SPECS[id], b = BIOMES[id] || spec.biome, rng = mulberry32(b.seed), materials = acquirePartyMaterials();
  const floorY = spec?.floorY || 0; // Puffball Bumpers' marsh lies 8.3 u below the cap: its group is lowered to the real floor
  const group = new THREE.Group(); group.name = `${id}-living`; group.position.y = floorY; root.add(group);
  const cameras = STAGE_ASPECTS.map(a => stageCamera(cam, a)), points = stageGameplayPoints(id);
  const keepOut = stageKeepOut(id), position = floorY ? root.position.clone().setY(root.position.y + floorY) : root.position;
  const clear = (s, entry) => {
    const world = s.clone().translate(position);
    return cameras.some(c => sphereInFrame(world, c)) && (entry.lowCover ? entry.top - (entry.y0 || 0) <= 0.45 : cameras.every(c => points.every(p => !sphereCoversPoint(world, p, c))));
  };
  const shape = circle(0, 0, 43);
  const low = scatter({ seed: b.seed, shape: spec?.lowShape || shape, keepOut, count: spec ? spec.low : id === 'vineskip' ? 2000 : id === 'marlosays' ? 260 : 400, minDistance: 0.43, radius: 0.65,
    size: [0.65, 1.2], density: (d, p) => 0.25 + 0.75 * Math.min(1, Math.hypot(p.x, p.z) / 35) ** 2 });
  const tallKeep = [...keepOut, circle(0, 0, 14.5), rect(-16, 16, -1, 44)];
  const groves = spec?.groves === 0 ? [] : scatter({ seed: b.seed + 10, shape: spec?.groveShape || shape, keepOut: tallKeep, count: spec ? spec.groves : 125, minDistance: 1.6, radius: 2.4, size: [0.75, 1.25], clusterRadius: 3.2 });
  const ringN = spec?.ring === false ? 0 : spec?.farRing ? 46 : 130;
  const trees = Array.from({ length: ringN }, (_, i) => {
    const a = (i + rng() * 0.3) / ringN * Math.PI * 2, r = 39 + rng() * 0.5;
    const scale = spec ? (spec.farRing ? 2.4 + rng() * 1.2 : 1.45 + rng() * 0.75) : 1.7 + rng() * 0.22; // (82c: varied heights; the older stages keep their exact numbers)
    return { x: Math.cos(a) * r, z: Math.sin(a) * r, scale, yaw: rng() * 6.28, kind: spec?.farRing || b.trees[i % 3], zone: 'treeline', layer: 'back', crownSway: false };
  }).filter(p => !(p.z > -1 && Math.abs(p.x) < 16) && !(id === 'marlosays' && p.z < -17) && (!spec?.ringKeep || spec.ringKeep(p)));
  const smallKinds = spec?.smallKinds || (id === 'marlosays' || id === 'huddle' ? ['grass'] : ['grass', 'flowerWhite', 'grass', 'pebble', 'leaf', 'flowerPink']);
  const placements = [...trees, ...groves.map((p, i) => ({ ...p, kind: b.trees[i % 4], zone: 'sides' })),
    ...low.map((p, i) => ({ ...p, kind: smallKinds[i % smallKinds.length], lowCover: true,
      ...(id === 'huddle' ? { tint: i % 3 ? '#cbd9d4' : '#f4f8fb' } : {}), ...(spec?.tint ? { tint: spec.tint(i) } : {}),
      ...(id === 'vineskip' ? {} : { softColor: spec?.softColor || (id === 'marlosays' ? '#ddceaa' : '#b7c6aa') }) }))];
  if (id === 'marlosays') placements.push(...scatter({ seed: b.seed + 20, shape: rect(-13, 13, -16.8, -11.3), keepOut, count: 45, minDistance: 0.8, radius: 0.65, size: [0.4, 0.65], clusterRadius: 0.8 })
    .map(p => ({ ...p, lowCover: true, kind: 'grass', softColor: '#d6cda8', zone: 'shore' })));
  if (id === 'marlosays') for (const x of [-9, -6.5, -3.5, 3.8, 6.6, 9.3]) placements.push({ x, z: -14.5 - rng(), scale: 0.6 + rng() * 0.2, yaw: rng() * 6.28, kind: 'coconut', zone: 'sides', layer: 'mid' });
  // A few cached island plants in the nearer jungle; distant foliage uses LODs.
  if (id === 'vineskip') for (const [x, z] of [[-15, -9], [15, -10], [-18, -4], [18, -4]]) placements.push({ x, z, scale: 0.7, yaw: rng() * 6.28, kind: 'fern', layer: 'mid' });
  if (id === 'vineskip') for (const side of [-1, 1]) placements.push({ kind: 'jungleGrove', x: side * 18, z: -14, scale: 0.95, yaw: side * 0.3, zone: 'sides', layer: 'mid' });
  placements.push(...(spec ? spec.compose({ cameras, origin: position, keepOut, rng }) : id === 'vineskip' ? frontDressing(id, cameras, position, keepOut, rng) : composeStage({ id, cameras, origin: position, keepOut })));
  const unlitParts = [];
  const decor = createDecor({ root: group, placements, materials, acceptSphere: clear, unlitParts });
  // The floor reaches beyond the camera footprint, not just the old 44u disc.
  const circleGeo = new THREE.PlaneGeometry(500, 500, 40, 40).rotateX(-Math.PI / 2);
  const patch = spec?.patchR === 0 ? null : groundPatch({ seed: b.seed, radius: spec?.patchR || (id === 'vineskip' ? 15.5 : 16.5), color: b.light, edge: b.ground, segments: 64, rings: 5 }).translate(0, 0.021, 0);
  const floor = part(circleGeo, b.ground);
  for (const g of [floor, patch]) {
    if (!g) continue;
    const p = g.attributes.position, c = g.attributes.color;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), noise = 0.5 + 0.5 * Math.sin(x * 0.18 + Math.cos(z * 0.12) * 2) * Math.cos(z * 0.23);
      const tint = id === 'huddle' ? new THREE.Color('#c7d9eb') : id === 'vineskip' ? new THREE.Color('#6a6f4c') : new THREE.Color(spec?.groundTint || b.ground);
      const col = new THREE.Color(c.getX(i), c.getY(i), c.getZ(i)).lerp(tint, noise * (id === 'huddle' || spec?.groundTint ? 0.14 : 0.22));
      c.setXYZ(i, col.r, col.g, col.b);
    }
  }
  const ground = new THREE.Mesh(combine([floor, ...(patch ? [patch.toNonIndexed()] : []), ...(id === 'marlosays' ? [seaBank()] : []), ...(spec?.groundParts?.() || [])]), VERTEX_TOON);
  circleGeo.dispose(); patch?.dispose();
  ground.name = 'party-living-ground'; group.add(ground);
  // The judged pool is bright shallow water over sand; the open ocean keeps its
  // quieter colour. Same shader source / program, separate uniform values only.
  const poolMaterial = id === 'marlosays' ? materials.water.clone() : null;
  if (poolMaterial) {
    poolMaterial.uniforms.uTime = materials.water.uniforms.uTime;
    poolMaterial.uniforms.uShallow.value.set('#83ddd3'); poolMaterial.uniforms.uDeep.value.set('#59c7ce');
    for (const k of ['uShallowTint', 'uDeepTint', 'uFoamTint']) poolMaterial.uniforms[k].value.set('#ffffff');
    poolMaterial.uniforms.uNight.value = 0;
  }
  const waterG = stageWaterGeometry(id, { poolOnly: !!poolMaterial }), water = waterG ? new THREE.Mesh(waterG, poolMaterial || materials.water) : null;
  if (water) { water.name = 'party-stage-water'; group.add(water); }
  const ocean = poolMaterial ? new THREE.Mesh(oceanGeometry(), materials.water) : null;
  if (ocean) { ocean.name = 'party-stage-ocean'; group.add(ocean); }
  const anchors = [{ x: -16, y: 0, z: -8 }, { x: 16, y: 0, z: -9 }, { x: -23, y: 0, z: 0 }, { x: 23, y: 0, z: 0 }];
  const habitats = {
    smoke: [{ x: 0, y: 5, z: -27 }], ember: [{ x: -13, y: 1, z: -10 }, { x: 14, y: 1, z: -10 }],
    firefly: [{ x: -13, y: 0.2, z: -10 }, { x: 14, y: 0.2, z: -10 }], moth: [{ x: -13, y: 1.1, z: -10 }, { x: 14, y: 1.1, z: -10 }],
    crab: [{ x: -15, y: 0, z: 7 }, { x: 15, y: 0, z: 7 }],
    bird: [{ x: -20, y: 0, z: -21 }, { x: 20, y: 0, z: -22 }],
    snowDust: [{ x: -17, y: 2.5, z: -8 }, { x: 17, y: 2.7, z: -9 }],
    breath: [...PARTY.huddle.stumps.map(x => ({ x: x + 0.45, y: 1.9, z: PARTY.huddle.stumpZ + 0.3 })), { x: -11, y: 3.1, z: -1.2 }],
    sawdust: PARTY.timber.lanes.map(x => ({ x: x + 1.8, y: 0, z: 3.5 })),
  };
  const life = createPartyLife({ root: group, seed: b.seed, preset: b.life, anchors, habitats: { ...habitats, ...(spec?.habitats || {}) } });
  // One existing-material prop batch: distant basalt / warm crater, clustered beach
  // shells, or a tiny hare. These silhouettes are tested like the other tall pieces.
  const props = [], glowParts = unlitParts, propBounds = [];
  const addProp = (geo, kind) => {
    geo.computeBoundingSphere();
    const entry = { kind, sphere: geo.boundingSphere.clone(), lowCover: false, top: Infinity };
    if (clear(entry.sphere, entry)) { (kind === 'crater' || kind === 'flame' ? glowParts : props).push(geo); propBounds.push(entry); } else geo.dispose();
  };
  if (id === 'vineskip') {
    // The flowers stay inside the original raised planter, below the vine arch.
    const blooms = Array.from({ length: 18 }, (_, i) => {
      const a = i * 2.4, r = 0.4 + rng() * 0.8;
      return lowDecorAsset(i % 2 ? 'flowerPink' : 'flowerYellow').clone().scale(1, 1.7, 1).translate(Math.cos(a) * r, 0.5, Math.sin(a) * r);
    });
    const flowers = new THREE.Mesh(combine(blooms), materials.sway); flowers.name = 'vineskip-planter-flowers'; group.add(flowers);
    // Ownership joins the other environment geometry below.
    flowers.userData.livingOwned = true;
    for (const [x, z] of [[-13, -10], [-14.1, -10.7], [14, -10], [15.2, -10.4], [-16, -3], [16, -4], [-11.5, -15]]) {
      addProp(part(G.cyl6, '#51445e', { p: [x, 1, z], s: [0.12, 2, 0.12] }), 'torch');
      addProp(part(G.ico1, '#efbc7b', { p: [x, 2.2, z], s: [0.22, 0.4, 0.22] }), 'flame');
    }
    addProp(part(G.cone6, '#5a475c', { p: [0, 1.6, -27], s: [4.5, 6, 3.5] }), 'volcano');
    addProp(part(G.ico1, '#e5a273', { p: [0, 4.6, -27], s: [0.7, 0.1, 0.5] }), 'crater');
  }
  if (id === 'huddle') {
    const hare = [part(G.ico1, '#f3f6ff', { p: [-16, 0.3, -7], s: [0.3, 0.3, 0.23] }),
      ...[-0.11, 0.11].map(dx => part(G.ico1, '#e5eaf3', { p: [-16 + dx, 0.7, -7], s: [0.07, 0.3, 0.07] }))];
    addProp(combine(hare), 'hare');
  }
  if (spec?.props) for (const p of spec.props({ rng })) addProp(p.geo, p.kind);
  const propMesh = props.length ? new THREE.Mesh(combine(props), VERTEX_TOON) : null;
  if (propMesh) { propMesh.name = 'party-living-props'; group.add(propMesh); }
  // Reuse kit's EXISTING unlit vertex-colour material (also on the judged vine).
  const glowMesh = glowParts.length ? glow(glowParts) : null;
  if (glowMesh) { glowMesh.name = 'party-living-glow'; group.add(glowMesh); }
  const extras = spec?.extras ? spec.extras({ group, materials, rng: mulberry32(b.seed + 77), position, id }) : null;
  let disposed = false, cutUntil = -1;
  return { root: group, decor, extras, api: extras?.api || {}, floorY, bounds: [...decor.bounds, ...propBounds], keepOut, life, habitats, materials, poolMaterial,
    cut(t) { cutUntil = t + 1.5; },
    update(dt, t, players = [], info = null) {
      decor.update(t); extras?.update(dt, t, players, info);
      const breath = life.pools.find(p => p.kind === 'breath');
      if (breath) players.slice(0, 4).forEach((p, i) => {
        if (!p) return;
        Object.assign(breath.slots[i], { x: p.position.x - root.position.x + 0.45, y: p.position.y - root.position.y + 1.9, z: p.position.z - root.position.z + 0.3 });
      });
      life.update(dt, t);
      const dust = life.pools.find(p => p.kind === 'sawdust'); if (dust) dust.mesh.visible = t < cutUntil;
    },
    dispose() {
      if (disposed) return; disposed = true; decor.dispose(); life.dispose(); extras?.dispose();
      ground.geometry.dispose(); water?.geometry.dispose(); ocean?.geometry.dispose(); poolMaterial?.dispose(); propMesh?.geometry.dispose(); glowMesh?.geometry.dispose(); materials.release(); group.removeFromParent();
      for (const o of group.children) if (o.userData.livingOwned) o.geometry.dispose();
    },
  };
}

/** Ambient resources live only while their stage is on screen. Existing gameplay
 * meshes stay lazy-cached by the framework; no new buffers survive a stage change. */
export function stageLivingLifecycle(options) {
  let living = null;
  return { get current() { return living; },
    setVisible(on) { if (on) living ||= createStageLiving(options); else { living?.dispose(); living = null; } },
    get api() { return living?.api || {}; },
    update(dt, t, players, info) { living?.update(dt, t, players, info); }, cut(t) { living?.cut(t); },
    dispose() { living?.dispose(); living = null; },
  };
}
