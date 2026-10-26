// Carle's place on the home island (PLAN Step 74b): a small sapling of its own, 5.5-7 u from the home campfire on the camera side, with a big leaf for the caterpillar to sit on and a short branch for the cocoon.
// Pure data (no three.js), world coordinates, a deterministic function of the terrain and the registries at the time it is called (call it after the home props exist): it changes nothing. The sapling is NOT part of
// the seeded home placement (props.js), so nothing seeded elsewhere moves.
//
//   const plan = homeCarlePlan({ fire?, height?, ground?, walkable?, overlaps?, interactables? })
//     fire = config FIRES[0]    height / ground / walkable = terrain.js getHeight / getGroundType / isWalkable    overlaps(x, z, r) = colliders.js overlapsAny    interactables() = interactables.js getInteractables
//   plan.sapling   { x, y, z, dist, angle } | null   the trunk's foot (y = ground) and its distance to the fire. Chosen from a short candidate list: angles fanning out from +Z (the follow camera looks north from the
//                  south, so the caterpillar faces it) in CARLE.sapling.step degrees, CARLE.sapling.radii at each; the first spot that is 5.5-7 u from the fire, outside its clear radius, on walkable GRASS (so not a
//                  trail, the stream, sand or a slope: the whole room circle), with no collider and no other interactable inside CARLE.sapling.room
//   plan.perch     { x, y, z, yaw, kind: 'sapling' }  the top of the biggest leaf, where the caterpillar's feet go (leafY up, leafOut toward +Z); yaw = faces +X (side-on to the camera)
//   plan.hang      { x, y, z }                         where the cocoon's thread hangs from: the tip of the short branch (hangY up, hangOut toward +X)
//   plan.collider  { x, z, r }                         the one small trunk collider (registered once by world/carleWorld.js)
//   plan.spots     [perch]                             the places a remote actor's reach is measured to          plan.hash()  short digest (determinism pin)          plan.summary()
import { FIRES, CARLE } from '../../config.js';
import { getHeight, getGroundType, isWalkable } from '../terrain.js';
import { overlapsAny } from '../colliders.js';
import { getInteractables } from '../interactables.js';

const LEAF_TOP = 0.05;                     // the leaf's thickness above its centre line: the caterpillar's feet rest on it
const D = Math.PI / 180;

export function homeCarlePlan({
  fire = FIRES[0], height = getHeight, ground = getGroundType, walkable = isWalkable, overlaps = overlapsAny, interactables = () => getInteractables(),
} = {}) {
  const S = CARLE.sapling, fx = fire.x, fz = fire.z, items = interactables();
  const lo = Math.max(S.min, fire.clear + 1), hi = S.max;
  const okSpot = (x, z, y) => {
    const dist = Math.hypot(x - fx, z - fz);
    if (dist < lo || dist > hi) return false;
    for (let k = 0; k < 9; k++) {                                   // the centre and eight points round the room circle: walkable grass, no steep slope
      const a = k * Math.PI / 4, px = k === 0 ? x : x + Math.cos(a) * S.room * 0.7, pz = k === 0 ? z : z + Math.sin(a) * S.room * 0.7;
      if (!walkable(px, pz) || ground(px, pz) !== 'grass' || Math.abs(height(px, pz) - y) > 0.3) return false;
    }
    if (overlaps(x, z, S.room)) return false;
    for (const it of items) if (it.position && Math.hypot(it.position.x - x, it.position.z - z) < S.room + (it.radius || 0)) return false;
    return true;
  };
  let sapling = null;
  const offsets = [0];
  for (let o = S.step; o <= 180 && offsets.length < 40; o += S.step) offsets.push(o, -o);
  search: for (const off of offsets) {
    for (const r of S.radii) {
      const a = Math.PI / 2 + off * D;                              // +Z is the camera side: angle pi/2 in (cos, sin) -> (x, z)
      const x = fx + Math.cos(a) * r, z = fz + Math.sin(a) * r, y = height(x, z);
      if (okSpot(x, z, y)) { sapling = { x, y, z, dist: Math.hypot(x - fx, z - fz), angle: off }; break search; }
    }
  }
  const perch = sapling && { x: sapling.x, y: sapling.y + S.leafY + LEAF_TOP, z: sapling.z + S.leafOut, yaw: Math.PI / 2, kind: 'sapling' };
  const hang = sapling && { x: sapling.x + S.hangOut, y: sapling.y + S.hangY, z: sapling.z };
  const r2 = (v) => Math.round(v * 100) / 100;
  return {
    fire: { x: fx, z: fz, clear: fire.clear }, sapling, perch, hang,
    collider: sapling && { x: sapling.x, z: sapling.z, r: S.trunkR },
    spots: perch ? [perch] : [],
    hash() {
      const s = JSON.stringify(sapling && [r2(sapling.x), r2(sapling.y), r2(sapling.z)]);
      let h = 2166136261;
      for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
      return (h >>> 0).toString(16).padStart(8, '0');
    },
    summary() { return { sapling: sapling && { x: r2(sapling.x), y: r2(sapling.y), z: r2(sapling.z), dist: r2(sapling.dist), angle: sapling.angle }, perch: perch && { x: r2(perch.x), y: r2(perch.y), z: r2(perch.z) } }; },
  };
}
