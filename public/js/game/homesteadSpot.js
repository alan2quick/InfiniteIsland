// Step 86d: the pure "where may it stand?" rules of Homesteading that do not need the terrain: the keep-clear zones around the spawn and the home campfire's approach, the pond / shore tests of
// the lily pad and the reeds, and the player-facing line of every spot rejection. No three.js, no registries: Node-tested (test/homesteadPlace.test.js). world/props.js placeCheck calls these
// and adds the terrain / collider / interactable checks.
//
//   isTall(kind)                          trees, palms and bamboo (the kinds whose canopy can hide a player)
//   keepClearReason(kind, x, z)           null | 'spawn' | 'fire'   the spawn plaza + the camera strip south of it, the spawn -> campfire walkway, the strip south of the campfire (tall kinds get more room)
//   inPond(x, z, h)                       is (x, z) pond water a lily pad may float on?   (h = the ground height there; the pad needs the basin floor below -0.3)
//   onShore(x, z, h)                      is (x, z) the pond's shore (where the native reeds stand)?
//   SPOT_LINES / spotLine(reason)         the short sentence under a red ghost ("Too close to something", "Needs grass", ...)
import { HOMESTEAD, FIRES } from '../config.js';
import { SPAWN, POND } from '../world/islands/home.js';

const KC = HOMESTEAD.keepClear;
const HOME_FIRE = FIRES[0];

export const isTall = (kind) => { const m = HOMESTEAD.kinds[kind]; return !!m && (m.cls === 'tree' || m.cls === 'palm' || m.cls === 'bamboo'); };

/** Distance from (x, z) to the segment a -> b. */
function segDist(x, z, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
  const u = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
  return Math.hypot(x - (ax + dx * u), z - (az + dz * u));
}

/** Why may `kind` not stand at (x, z) because of the spawn or the campfire's approach? null = fine. */
export function keepClearReason(kind, x, z) {
  const tall = isTall(kind);
  const k = tall ? 'tall' : 'small';
  if (Math.hypot(x - SPAWN.x, z - SPAWN.z) < KC.spawn[k]) return 'spawn';
  if (tall && Math.abs(x - SPAWN.x) < KC.spawnLane.halfWidth && z > SPAWN.z - 1 && z < SPAWN.z + KC.spawnLane.length) return 'spawn';
  if (segDist(x, z, SPAWN.x, SPAWN.z, HOME_FIRE.x, HOME_FIRE.z) < KC.approach[k]) return 'fire';
  if (tall && Math.abs(x - HOME_FIRE.x) < KC.fireLane.halfWidth && z > HOME_FIRE.z - 1 && z < HOME_FIRE.z + KC.fireLane.length) return 'fire';
  return null;
}

/** Pond water a lily pad may float on: inside the pond's (widened) outline, the basin floor below -0.3, like the native pads. */
export function inPond(x, z, h) {
  const px = (x - POND.x) / (POND.rx + 1.5), pz = (z - POND.z) / (POND.rz + 1.2);
  return px * px + pz * pz < 1 && h < -0.3;
}

/** The pond's shore band (where the native reeds stand: 3.5 to 9 u out in the native placement's frame, x stretched by 1.2; ground just above the water line). */
export function onShore(x, z, h) {
  const d = Math.hypot((x - POND.x) / 1.2, z - POND.z);
  return h > -0.3 && h < 0.45 && d > 3.5 && d < 9;
}

export const SPOT_LINES = {
  water: 'Not in the water',
  cliff: 'Too steep here',
  ground: 'Needs grass',
  blocked: 'Too close to something',
  crowded: 'Too close to something',
  fire: 'Keep the campfire clear',
  spawn: 'Keep the spawn clear',
  path: 'On a path',
  reserved: 'This spot is reserved',
  pond: 'Needs pond water',
  shore: 'Needs the pond shore',
  edge: 'Too close to the edge',
};

/** The sentence under a red ghost. `meta` (the kind's table entry) refines "wrong ground" ("Needs sand or grass", "Needs grass"). */
export function spotLine(reason, meta = null) {
  if (reason === 'ground' && meta && Array.isArray(meta.ground)) {
    const g = meta.ground.filter((t) => t !== 'water');
    if (g.length === 2) return `Needs ${g[0]} or ${g[1]}`;
    if (g.length === 1) return `Needs ${g[0]}`;
  }
  return SPOT_LINES[reason] || 'Not a good place for that';
}
