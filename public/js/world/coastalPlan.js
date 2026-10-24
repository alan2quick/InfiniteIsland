// Seeded decorative coastline samples only. These never register items, colliders, interactables or world state.
import { ISLANDS, WATER_LEVEL, BRIDGES } from '../config.js';
import { mulberry32 } from '../utils/rng.js';
import { getTerrainHeight, getGroundType, regionOf, inlandDistance } from './terrain.js';
import { frameExtent } from './islands/extent.js';

const TAU = Math.PI * 2;
export const COASTAL_CAPS = Object.freeze({ beachPerIsland: 28, fish: 12, dolphin: 2, whale: 1, octopus: 2 });
const bridgeClear = (x, z, margin) => BRIDGES.every((b) => Math.min(Math.hypot(x - b.ax, z - b.az), Math.hypot(x - b.bx, z - b.bz)) > margin);
export function beachDressingPlan(island, { heightAt = getTerrainHeight, groundAt = getGroundType, regionAt = regionOf, inlandAt = inlandDistance, obstacles = [] } = {}) {
  const rng = mulberry32(island.seed ^ 0x5ea511), extent = frameExtent(island), result = [];
  for (let i = 0; i < 2500 && result.length < COASTAL_CAPS.beachPerIsland; i++) {
    const a = rng() * TAU, r = 0.75 + rng() * 0.3;
    const x = island.x + Math.cos(a) * extent.halfX * r, z = island.z + Math.sin(a) * extent.halfZ * r;
    const h = heightAt(x, z), inland = inlandAt(x, z);
    if (h < WATER_LEVEL + 0.08 || h > 1.4 || groundAt(x, z) !== 'sand' || regionAt(x, z) !== island.id || inland < 0.5 || inland > 9) continue;
    if (!bridgeClear(x, z, 12) || obstacles.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + 0.7)) continue;
    if (result.some((p) => Math.hypot(x - p.x, z - p.z) < 2.6)) continue;
    const kind = result.length % 7 === 0 ? 'driftwood' : result.length % 4 === 0 ? 'starfish' : 'shellClump';
    result.push({ kind, x, y: h + 0.025, z, angle: rng() * TAU, scale: kind === 'driftwood' ? 0.45 + rng() * 0.2 : 0.45 + rng() * 0.45 });
  }
  return result;
}

export function safeWaterOrbit(x, z, radius, minDepth, heightAt = getTerrainHeight, padding = 0) {
  for (let i = 0; i < 20; i++) {
    const a = i / 20 * TAU;
    for (const r of [0, radius, radius + padding]) if (heightAt(x + Math.cos(a) * r, z + Math.sin(a) * r) > WATER_LEVEL - minDepth) return false;
  }
  return true;
}
export function seaLifePlan(islands = ISLANDS, { heightAt = getTerrainHeight } = {}) {
  const result = [];
  for (const island of islands) {
    const rng = mulberry32(island.seed ^ 0x0cea11), e = frameExtent(island);
    for (const kind of ['fish', 'octopus', 'dolphin', 'whale']) {
      const radius = ({ fish: 1.3, octopus: 0.5, dolphin: 5, whale: 8 })[kind];
      const depth = ({ fish: 0.35, octopus: 0.2, dolphin: 1.5, whale: 2.7 })[kind];
      const padding = ({ fish: 0.4, octopus: 0.65, dolphin: 2, whale: 3 })[kind];
      const count = kind === 'fish' ? 4 : 1;
      for (let n = 0; n < count; n++) for (let tries = 0; tries < 300; tries++) {
        const a = rng() * TAU, off = kind === 'whale' ? 24 + rng() * 20 : kind === 'dolphin' ? 10 + rng() * 16 : rng() * 7;
        const x = island.x + Math.cos(a) * (e.halfX + off), z = island.z + Math.sin(a) * (e.halfZ + off);
        if ((kind === 'fish' || kind === 'octopus') && heightAt(x, z) < -1.5) continue;
        if (!bridgeClear(x, z, radius + padding + 12) || !safeWaterOrbit(x, z, radius, depth, heightAt, padding)) continue;
        result.push({ kind, island: island.id, x, z, radius, phase: rng() * TAU, period: kind === 'whale' ? 55 + rng() * 25 : kind === 'dolphin' ? 28 + rng() * 20 : 12 + rng() * 12, scale: 0.85 + rng() * 0.3 });
        break;
      }
    }
  }
  return result;
}
