// Cheap decorative beach dressing and ocean wildlife. No gameplay identities, physics, lights or shadows.
// update(dt, time, focus, {hidden}) follows island full/far visibility; all instance capacities are fixed.
import * as THREE from 'three';
import { ISLANDS, WATER_LEVEL } from '../config.js';
import { G, part, combine, VERTEX_TOON } from '../render/geo.js';
import { getColliders } from '../world/colliders.js';
import { beachDressingPlan, seaLifePlan, COASTAL_CAPS } from '../world/coastalPlan.js';
import { dressingAsset } from '../world/party/stageDressing.js';

const TAU = Math.PI * 2;
function animalGeometry(kind) {
  const parts = [], add = (g, color, p, s, r = [0, 0, 0]) => parts.push(part(g, color, { p, s, r }));
  const eye = (x, y, z, size) => add(G.sphereLo, '#29283f', [x, y, z], [size, size, size]);
  if (kind === 'fish') {
    add(G.ico1, '#4b8b96', [0, 0, 0], [0.13, 0.08, 0.3]);
    add(G.cone6, '#609d9f', [0, 0, -0.32], [0.14, 0.22, 0.035], [Math.PI / 2, 0, 0]);
    add(G.ico1, '#8eb4a0', [0, 0.045, 0.06], [0.085, 0.03, 0.2]);
  } else if (kind === 'octopus') {
    add(G.ico1, '#b583b2', [0, 0.19, 0], [0.26, 0.3, 0.25]);
    add(G.ico1, '#cba4c2', [0, 0.1, 0.13], [0.21, 0.14, 0.2]);
    for (let i = 0; i < 8; i++) {
      const a = i * TAU / 8;
      for (let j = 0; j < 2; j++) {
        const radius = 0.23 + j * 0.21, bend = a + j * 0.35;
        add(G.sphereLo, j ? '#b68ab6' : '#aa78a4', [Math.cos(bend) * radius, 0.035 + j * 0.02, Math.sin(bend) * radius], [0.22 - j * 0.06, 0.05, 0.075], [0, -bend, 0]);
      }
    }
    eye(-0.105, 0.23, 0.23, 0.035); eye(0.105, 0.23, 0.23, 0.035);
  } else {
    const whale = kind === 'whale', body = whale ? '#638fa4' : '#7aaab3', belly = whale ? '#adc6c4' : '#d4e0ce';
    add(G.ico1, body, [0, 0, 0], whale ? [0.85, 0.65, 2.25] : [0.37, 0.34, 1.05]);
    add(G.ico1, belly, [0, -0.22, whale ? 0.4 : 0.1], whale ? [0.72, 0.3, 1.65] : [0.29, 0.17, 0.78]);
    if (!whale) add(G.ico1, body, [0, -0.05, 1.05], [0.16, 0.13, 0.6]);
    for (const side of [-1, 1]) {
      add(G.ico1, body, [side * (whale ? 0.8 : 0.35), -0.1, whale ? 0.4 : 0.05], whale ? [0.8, 0.1, 0.38] : [0.48, 0.07, 0.25], [0, side * 0.45, side * -0.2]);
      add(G.ico1, body, [side * (whale ? 0.55 : 0.3), 0, whale ? -2.1 : -1.05], whale ? [0.68, 0.12, 0.34] : [0.38, 0.07, 0.22], [0, side * -0.35, 0]);
      eye(side * (whale ? 0.62 : 0.28), 0.08, whale ? 1.45 : 0.66, whale ? 0.07 : 0.045);
    }
    add(G.cone6, body, [0, whale ? 0.58 : 0.4, -0.12], whale ? [0.24, 0.36, 0.45] : [0.15, 0.4, 0.24], [0, 0, -0.08]);
  }
  return combine(parts);
}

export function createCoastalLife({ scene, world, islands = ISLANDS, plan = null } = {}) {
  const group = new THREE.Group(); group.name = 'coastal-life'; scene.add(group);
  const sea = plan || seaLifePlan(islands), beachPlans = new Map(), beaches = new Map(), batches = {};
  const dummy = new THREE.Object3D();
  let disposed = false;
  // Existing biome geometries are borrowed and cloned when placed; these caches must never be disposed here.
  for (const kind of ['fish', 'dolphin', 'whale', 'octopus']) {
    const mesh = new THREE.InstancedMesh(animalGeometry(kind), VERTEX_TOON, COASTAL_CAPS[kind]);
    mesh.name = `coastal-${kind}`; mesh.count = 0; mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.castShadow = mesh.receiveShadow = false;
    batches[kind] = mesh; group.add(mesh);
  }
  function beachFor(island) {
    if (!beachPlans.has(island.id)) beachPlans.set(island.id, beachDressingPlan(island, { obstacles: getColliders() }));
    const spots = beachPlans.get(island.id);
    if (!spots.length) return null;
    const geometry = combine(spots.map((p) => dressingAsset(p.kind).clone().scale(p.scale, p.scale, p.scale).rotateY(p.angle).translate(p.x, p.y, p.z)));
    const mesh = new THREE.Mesh(geometry, VERTEX_TOON); mesh.name = `beach-dressing-${island.id}`;
    mesh.castShadow = mesh.receiveShadow = false; group.add(mesh); beaches.set(island.id, mesh); return mesh;
  }
  const full = (id) => world?.regions?.isFull ? world.regions.isFull(id) : true;
  function update(_dt, time, focus, { hidden = false } = {}) {
    if (disposed) return;
    group.visible = !hidden && world?.root?.visible !== false;
    if (!group.visible || !focus || !Number.isFinite(time)) {
      for (const mesh of Object.values(batches)) { mesh.count = 0; mesh.visible = false; }
      return;
    }
    for (const island of islands) {
      const active = full(island.id);
      const mesh = beaches.get(island.id);
      if (!active && mesh) { mesh.geometry.dispose(); mesh.removeFromParent(); beaches.delete(island.id); }
      else if (active && !mesh) beachFor(island);
    }
    for (const mesh of Object.values(batches)) mesh.count = 0;
    for (const a of sea) {
      const mesh = batches[a.kind]; if (!mesh || !full(a.island) || mesh.count >= COASTAL_CAPS[a.kind]) continue;
      const range = a.kind === 'whale' ? 140 : a.kind === 'dolphin' ? 100 : 55;
      if (Math.hypot(focus.x - a.x, focus.z - a.z) > range) continue;
      const cycle = ((time / a.period + a.phase / TAU) % 1 + 1) % 1;
      const large = a.kind === 'dolphin' || a.kind === 'whale';
      const duty = a.kind === 'whale' ? 0.18 : 0.24;
      if (large && cycle >= duty) continue; // occasional passing silhouettes, not a permanent crowd
      const speed = a.kind === 'fish' ? 0.35 : a.kind === 'octopus' ? 0.1 : 0.11;
      const angle = time * speed + a.phase;
      const x = a.x + Math.cos(angle) * a.radius, z = a.z + Math.sin(angle) * a.radius;
      let y = WATER_LEVEL + (a.kind === 'fish' ? -0.2 : 0.025), pitch = 0;
      if (large) {
        const u = cycle / duty;
        y = WATER_LEVEL + (a.kind === 'whale' ? -0.85 + Math.sin(u * Math.PI) * 1.1 : -0.55 + Math.sin(u * Math.PI) * 1.55);
        pitch = Math.cos(u * Math.PI) * (a.kind === 'whale' ? 0.08 : 0.3);
      }
      const pulse = a.kind === 'octopus' ? 1 + Math.sin(time * 1.3 + a.phase) * 0.035 : 1;
      dummy.position.set(x, y, z); dummy.rotation.set(pitch, -angle, 0);
      dummy.scale.set(a.scale * pulse, a.scale * (a.kind === 'fish' ? 0.15 : pulse), a.scale * pulse); dummy.updateMatrix();
      mesh.setMatrixAt(mesh.count++, dummy.matrix);
    }
    for (const mesh of Object.values(batches)) { mesh.visible = mesh.count > 0; if (mesh.count) mesh.instanceMatrix.needsUpdate = true; }
  }
  function dispose() {
    if (disposed) return; disposed = true;
    for (const mesh of beaches.values()) mesh.geometry.dispose();
    beaches.clear();
    for (const mesh of Object.values(batches)) { mesh.geometry.dispose(); mesh.dispose(); }
    group.removeFromParent();
  }
  return { group, update, dispose, plan: sea, beachPlans, batches,
    summary() { return { beaches: beaches.size, beachPieces: [...beachPlans.values()].reduce((sum, p) => sum + p.length, 0), animals: Object.fromEntries(Object.entries(batches).map(([k, m]) => [k, m.count])), draws: group.visible ? beaches.size + Object.values(batches).filter((m) => m.visible && m.count > 0).length : 0 }; },
  };
}
