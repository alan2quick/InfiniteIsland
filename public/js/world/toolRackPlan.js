// Deterministic, read-only rack placement. toolRackPlan({fires?, height?, ground?, walkable?, overlaps?, interactables?}) -> spots keyed by fire.
// finalRackObstacles() -> {circles, segments}; saplingReserve(carlePlan.collider) -> the reserved circle for Carle's sapling; rackObstacleDistance(x,z,segment) -> surface distance.
// Call once after gathering / garden plots and static world props, including Carle and cosmetics; never changes seeded island sampling.
import { DEFS } from '../items/spawns.js';
import { campStageLayout } from './islands/frostCampStages.js';
import { gardenStageLayout } from './islands/emberGardenStages.js';
import { FIRES, TOOL_RACK, ISLANDS, HAT_RACK, CARLE } from '../config.js';
import { duskHearthLayout } from './islands/duskHearth.js';
import { campReserved } from './islands/frostCamp.js';
import { gardenReserved } from './islands/emberGarden.js';
import { getIslandModule } from './islands/registry.js';
import { pathsOf, pathDist } from './paths.js';
import { getHeight, getGroundType, isWalkable, getSlope } from './terrain.js';
import { overlapsAny } from './colliders.js';
import { getInteractables } from './interactables.js';
// Full-build footprints, including pieces without colliders (roof spans, channels, beds and decor).
// Exported so tests can check an empty camp against every future stage without unlocking or saving anything.
export function finalRackObstacles() {
  const frostIsland = ISLANDS.find((i) => i.id === 'frost'), emberIsland = ISLANDS.find((i) => i.id === 'ember');
  const frost = campStageLayout(frostIsland), garden = gardenStageLayout(emberIsland, getIslandModule('ember')), dusk = duskHearthLayout();
  const shelter = frost.stage3.shelter;
  const circles = [ ...Object.values(frost.footprints).flat(), ...Object.values(garden.colliders).flat(),
    { x: shelter.x, z: shelter.z, r: Math.hypot(shelter.hw + 0.3, shelter.hl + 0.3) },
    ...frost.stage3.pines.map((p) => ({ ...p, r: p.s * 1.2 })),
    ...garden.reserved.plots, garden.reserved.garland, garden.reserved.mossback, ...garden.reserved.stages,
    { ...garden.pavilion, r: 5.1 }, ...garden.stepping.map((p) => ({ ...p, r: 0.45 })),
    dusk.stable, ...dusk.seats.map((p) => ({ ...p, r: 0.85 })), ...dusk.rods.map((p) => ({ ...p, r: 0.55 })),
  ];
  const segments = [];
  const line = (points, r) => { for (let i = 1; i < points.length; i++) segments.push({ a: points[i - 1], b: points[i], r }); };
  line(garden.pipe, 0.2);
  for (const points of garden.channels) line(points, 0.12);
  for (const t of garden.trellises) line(t.posts, 0.25);
  line(garden.arbour.posts, 0.15);
  for (const span of frost.stage2.bunting) line([frost.stage2.posts[span.a], frost.stage2.posts[span.b]], 0.12);
  return { circles, segments };
}
/** Carle's sapling (world/islands/homeCarle.js) pops in live once a pet is unlocked: reserve its whole room plus the rack's interact clearance, whether or not it stands yet, so the home rack never moves with the quest state. */
export const saplingReserve = (collider) => collider && { x: collider.x, z: collider.z, r: CARLE.sapling.room + TOOL_RACK.interactClearance - TOOL_RACK.room };
export function rackObstacleDistance(x, z, { a, b, r }) {
  const dx = b.x - a.x, dz = b.z - a.z, length2 = dx * dx + dz * dz;
  const t = length2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / length2)) : 0;
  return Math.hypot(x - a.x - t * dx, z - a.z - t * dz) - r;
}
export function toolRackPlan({ fires = FIRES, height = getHeight, ground = getGroundType, walkable = isWalkable,
  reserved = [], slope = getSlope, overlaps = overlapsAny, interactables = getInteractables } = {}) {
  const S = TOOL_RACK, items = interactables().filter((it) => !['item', 'critter', 'tdoong'].includes(it.type)), result = {};
  const islandOf = (id) => ISLANDS.find((i) => i.id === id);
  // Reserve furniture even before its unlock; a late snapshot must not move a rack into a future prop.
  const frost = campReserved(islandOf('frost')), garden = gardenReserved(islandOf('ember'), getIslandModule('ember'));
  const keep = [ { x: HAT_RACK.x, z: HAT_RACK.z, r: HAT_RACK.radius },
    frost.tailStump, ...frost.dens, ...Object.values(frost.build).flat(), garden.garland, garden.mossback, ...garden.plots, ...garden.stages,
    duskHearthLayout().stable, ...reserved ].filter(Boolean);
  const final = finalRackObstacles(); keep.push(...final.circles);
  keep.push(...[frost.tailStump, garden.garland, garden.mossback, ...garden.plots, duskHearthLayout().stable].map((p) => ({ ...p, r: Math.max(p.r || 0, S.interactClearance - S.room) })));
  const angles = [0];
  for (let a = S.angleStep; a <= 180; a += S.angleStep) angles.push(a, -a);
  for (const fire of fires) {
    result[fire.id] = null;
    // Search the whole close fan before expanding: mature camp furniture takes priority over proximity.
    search: for (const radii of [S.radii, ...S.fallbackRadii.map((r) => [r])]) for (const off of angles) candidate: for (const r of radii) {
      if (r < Math.min(fire.clear, S.nearClear) + S.radius) continue;
      const a = Math.PI / 2 + off * Math.PI / 180, x = fire.x + Math.cos(a) * r, z = fire.z + Math.sin(a) * r, y = height(x, z);
      if (keep.some((p) => Math.hypot(p.x - x, p.z - z) < (p.r || 0.85) + S.room) || overlaps(x, z, S.room)) continue;
      if (final.segments.some((line) => rackObstacleDistance(x, z, line) < S.room)) continue;
      if (DEFS.some((d) => Math.hypot(d.at[0] - x, d.at[1] - z) < S.interactClearance)) continue;
      const island = ISLANDS.find((i) => i.id === fire.island);
      if (island && pathsOf(island.id).some((p) => pathDist(island, p, x, z) < p.width / 2 + S.room)) continue;
      if (items.some((it) => it.position && Math.hypot(it.position.x - x, it.position.z - z) < Math.max(S.interactClearance, S.room + (it.radius || 0)))) continue;
      for (let i = 0; i < 9; i++) {
        const px = x + (i ? Math.cos(i * Math.PI / 4) * S.room : 0), pz = z + (i ? Math.sin(i * Math.PI / 4) * S.room : 0);
        const g = ground(px, pz);
        if (!walkable(px, pz) || height(px, pz) < S.dryHeight || Math.abs(height(px, pz) - y) > S.maxRise || slope(px, pz) > S.maxSlope || /water|wet|path|trail/.test(g)) continue candidate;
      }
      result[fire.id] = { x, y, z, dist: r, angle: off }; break search;
    }
  }
  return result;
}
