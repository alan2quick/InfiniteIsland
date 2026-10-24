// Optional visual-only home campsite. Fixed gameplay objects stay put; safe layout omits a prop if no clear patch exists.
import * as THREE from 'three';
import { CAMPFIRE, SIGNPOST } from '../config.js';
import { SPAWN, POND, getTerrainHeight, getGroundType, isWalkable } from './terrain.js';
import { getColliders } from './colliders.js';
import { getInteractables } from './interactables.js';
import { G, part, combine, VERTEX_TOON } from '../render/geo.js';

function segmentDistance(x, z, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z, length = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / length));
  return Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
}
export function campsiteLayout({ fire = CAMPFIRE, obstacles = getColliders(), interactables = getInteractables(), heightAt = getTerrainHeight, groundAt = getGroundType, walkable = isWalkable } = {}) {
  const placed = [];
  const routes = [[SPAWN, fire], [SPAWN, SIGNPOST], [fire, SIGNPOST]];
  const specs = [{ kind: 'tent', radius: 3.3, preferred: [[-3, -8], [3, -9], [-7, -6], [-10, -3]] },
    { kind: 'picnic', radius: 2.3, preferred: [[6, 5], [-7, -4], [0, 8], [-9, 2]] }];
  for (const spec of specs) {
    const candidates = [...spec.preferred];
    for (const r of [9, 11, 13, 15, 17]) for (let i = 0; i < 24; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 12; candidates.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    for (const [dx, dz] of candidates) {
      const x = fire.x + dx, z = fire.z + dz, y = heightAt(x, z), r = spec.radius;
      if (Math.hypot(dx, dz) < fire.clear + r + 0.3 || Math.hypot((x - POND.x) / 1.2, z - POND.z) < 8.5 + r) continue;
      // A tall foreground tent must not cover the spawn or the campfire cast in the original +Z camera.
      if (spec.kind === 'tent' && [SPAWN, fire].some((p) => z > p.z - 1 && z < p.z + 15 && Math.abs(x - p.x) < r + 2.8)) continue;
      if (routes.some(([a, b]) => segmentDistance(x, z, a, b) < r + 1.4)) continue;
      if (obstacles.some((c) => Math.hypot(x - c.x, z - c.z) < r + Math.max(c.r, /tree|palm/.test(c.owner?.name || '') ? 2.4 : c.r) + 0.4)) continue;
      if (interactables.some((p) => p.position && Math.hypot(x - p.position.x, z - p.position.z) < r + (p.radius || 0.3) + 0.6)) continue;
      if (placed.some((p) => Math.hypot(x - p.x, z - p.z) < r + p.radius + 0.8)) continue;
      let clear = Number.isFinite(y);
      for (let i = 0; i < 12 && clear; i++) {
        const a = i / 12 * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        if (!walkable(px, pz) || groundAt(px, pz) !== 'grass' || Math.abs(heightAt(px, pz) - y) > 0.45) clear = false;
      }
      if (!clear || !walkable(x, z) || groundAt(x, z) !== 'grass') continue;
      placed.push({ kind: spec.kind, x, y: y + 0.02, z, radius: r, angle: spec.kind === 'tent' ? Math.atan2(fire.x - x, fire.z - z) : -0.15 });
      break;
    }
  }
  return placed;
}

function picnicGeometry() {
  const pieces = [], cube = new THREE.BoxGeometry(1, 1, 1), handle = new THREE.TorusGeometry(0.105, 0.028, 4, 8);
  const add = (g, color, p, s, r = [0, 0, 0]) => pieces.push(part(g, color, { p, s, r }));
  for (let i = 0; i < 6; i++) add(cube, i % 2 ? '#b98050' : '#c99560', [0, 1.12, (i - 2.5) * 0.25], [3.2, 0.12, 0.23]);
  for (const z of [-1.08, 1.08]) {
    add(cube, '#b98758', [0, 0.58, z], [3.4, 0.12, 0.4]);
    for (const x of [-1.15, 1.15]) add(cube, '#826146', [x, 0.29, z], [0.15, 0.58, 0.25]);
  }
  for (const x of [-1.1, 1.1]) for (const z of [-0.45, 0.45]) add(cube, '#8c6547', [x, 0.57, z], [0.17, 1.1, 0.18], [z > 0 ? -0.2 : 0.2, 0, 0]);
  add(cube, '#856247', [0, 0.4, 0], [2.6, 0.15, 0.18]);
  // A blue cloth, plates and sandwiches make this a picnic rather than another workbench.
  add(cube, '#8ab9c5', [0.2, 1.188, 0], [1.6, 0.012, 1.46]);
  for (const x of [-0.65, 0.7]) {
    add(G.cyl8, '#fff0d5', [x, 1.21, 0.29], [0.3, 0.035, 0.3]);
    add(cube, '#ce965d', [x, 1.27, 0.29], [0.33, 0.07, 0.3], [0, 0.2, 0]);
    add(cube, '#73a95b', [x, 1.315, 0.29], [0.35, 0.035, 0.3], [0, 0.2, 0]);
    add(cube, '#e7b475', [x, 1.36, 0.29], [0.33, 0.07, 0.3], [0, 0.2, 0]);
  }
  for (const [x, z, color] of [[-1.08, -0.25, '#d79591'], [0.55, -0.35, '#9ba6d2']]) {
    add(G.cyl8, color, [x, 1.35, z], [0.17, 0.28, 0.17]);
    add(G.cyl8, '#674533', [x, 1.493, z], [0.145, 0.012, 0.145]);
    add(handle, color, [x + 0.18, 1.36, z], [1, 1, 1]);
    for (let n = 0; n < 3; n++) add(cube, '#fff1d5', [x - 0.055 + n * 0.055, 1.52, z + (n % 2) * 0.025], [0.055, 0.04, 0.045]);
  }
  // Juice bottle and a small bowl of fruit.
  add(G.cyl8, '#8cb576', [1.15, 1.42, -0.3], [0.13, 0.43, 0.13]);
  add(G.cyl8, '#9fc68a', [1.15, 1.69, -0.3], [0.065, 0.15, 0.065]);
  add(G.cyl8, '#eac98b', [1.15, 1.78, -0.3], [0.075, 0.045, 0.075]);
  add(G.cyl8, '#e5ca9c', [-0.12, 1.29, -0.32], [0.24, 0.17, 0.24]);
  for (let i = 0; i < 5; i++) add(G.ico1, i % 2 ? '#db8f71' : '#d7b65a', [-0.12 + Math.cos(i * 2.4) * 0.12, 1.4 + i % 2 * 0.04, -0.32 + Math.sin(i * 2.4) * 0.1], [0.09, 0.1, 0.09]);
  const geometry = combine(pieces); cube.dispose(); handle.dispose(); return geometry;
}

function tentGeometry() {
  const parts = [], cube = new THREE.BoxGeometry(1, 1, 1);
  const face = (vertices, color) => {
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices.flat(), 3)); geometry.computeVertexNormals();
    parts.push(part(geometry, color)); geometry.dispose();
  };
  const lf = [-1.9, 0, 2.2], lb = [-1.9, 0, -2.2], rf = [1.9, 0, 2.2], rb = [1.9, 0, -2.2], topF = [0, 2.7, 2.2], topB = [0, 2.7, -2.2];
  face([lf, topF, topB, lf, topB, lb], '#83b7b0');
  face([rf, rb, topB, rf, topB, topF], '#659d99');
  face([lb, topB, rb], '#77a8a2');
  face([[-0.85, 0, 2.185], [0.85, 0, 2.185], [0, 2.7, 2.185]], '#3c4c57');
  face([lf, [-0.85, 0, 2.21], topF, topF, [0.85, 0, 2.21], rf], '#e2d1a4');
  parts.push(part(cube, '#b7a17c', { p: [0, 0.025, 0], s: [3.82, 0.05, 4.42] }));
  const ridge = new THREE.CylinderGeometry(0.045, 0.045, 4.75, 6);
  parts.push(part(ridge, '#e4c89e', { p: [0, 2.71, 0], r: [Math.PI / 2, 0, 0] }));
  for (const side of [-1, 1]) {
    parts.push(part(G.cyl6, '#b49775', { p: [side * 2.15, 0.2, 1.8], s: [0.035, 0.4, 0.035] }));
    parts.push(part(G.cyl6, '#b49775', { p: [side * 2.15, 0.2, -1.8], s: [0.035, 0.4, 0.035] }));
    parts.push(part(cube, '#d6bc8c', { p: [side * 1.9, 0.1, 0], s: [0.06, 0.13, 4.5] }));
  }
  const geometry = combine(parts); cube.dispose(); ridge.dispose(); return geometry;
}

export function createCampsiteDressing({ scene, world, fire = CAMPFIRE, layout = null } = {}) {
  const group = new THREE.Group(); group.name = 'home-campsite-dressing'; scene.add(group);
  const positions = layout || campsiteLayout({ fire }), meshes = [];
  for (const site of positions) {
    const mesh = new THREE.Mesh(site.kind === 'tent' ? tentGeometry() : picnicGeometry(), VERTEX_TOON);
    mesh.name = site.kind === 'tent' ? 'camp-large-tent' : 'camp-picnic-table';
    mesh.position.set(site.x, site.y, site.z); mesh.rotation.y = site.angle;
    mesh.castShadow = mesh.receiveShadow = false; group.add(mesh); meshes.push(mesh);
  }
  let disposed = false;
  return { group, layout: positions,
    update(_time, _focus, { hidden = false } = {}) { group.visible = !disposed && !hidden && world?.root?.visible !== false && (world?.regions?.isFull ? world.regions.isFull(fire.island) : true); },
    summary() { return { visible: group.visible, pieces: positions.map((p) => p.kind), draws: group.visible ? meshes.length : 0, triangles: meshes.reduce((sum, mesh) => sum + (mesh.geometry.index ? mesh.geometry.index.count : mesh.geometry.attributes.position.count) / 3, 0) }; },
    dispose() { if (disposed) return; disposed = true; for (const mesh of meshes) mesh.geometry.dispose(); group.removeFromParent(); },
  };
}
