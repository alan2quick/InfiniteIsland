// Duskcrown gameplay data (69c/d, 72a), registered ONCE per island at load on every screen: mushroom stems and ambient stump / log / rock colliders, and (72a) one 'pond' interactable per fishable water body.
// Step 85d: registerCrownTreeGameplay(island) does the same for the Crownlands' acacia and baobab trunks (crownPlacement.js): one circle collider per tree, registered once, canopies never block.
// Visuals (duskVisuals.js) may be rebuilt as often as they like; nothing here is ever registered twice. Players walk round the stems; caps are never obstacles.
//
//   const d = registerDuskGameplay(island) -> { placement, colliders (stems), flora, floraColliders, ponds, pondTargets, summary() }     (cached; calling it again returns the same object)
//   ponds = islands/duskHearth.js duskFishPonds(); pondTargets = their interactables (type 'pond', `.pond` = the pond record, radius = the pond's radius so findNearest measures from the bank; the prompt
//   'Cast' only matters with a Glowline Rod: main.js lists a pond as a target only for a holder of a fishing tool, items/tools.js getToolAction = 'fish').
import * as THREE from 'three';
import { addCollider } from '../colliders.js';
import { addInteractable } from '../interactables.js';
import { getIslandModule } from './registry.js';
import { buildDuskPlacement } from './duskPlacement.js';
import { buildCrownPlacement } from './crownPlacement.js';
import { buildDuskFlora } from './duskFlora.js';
import { duskFishPonds } from './duskHearth.js';

const COLLIDER_FIT = 0.92;                 // collider radius = the stem's flared base x this (the player hugs the stem without catching on the flare)
const _data = new Map();

export function registerDuskGameplay(island) {
  if (_data.has(island.id)) return _data.get(island.id);
  const placement = buildDuskPlacement(island, getIslandModule(island.id));
  const colliders = placement.items.map((it) => addCollider({ x: it.x, z: it.z, r: +(it.baseR * COLLIDER_FIT).toFixed(2), owner: it.id }));
  const flora = buildDuskFlora(island, getIslandModule(island.id));
  // Logs use three circles along their axis, matching home's fallen log. Small plants never block players.
  const floraColliders = flora.solids.flatMap((it) => {
    if (it.kind !== 'log') return [addCollider({ x: it.x, z: it.z, r: (it.kind === 'stump' ? 0.62 : 0.92) * it.s, owner: it.id })];
    return [-1, 0, 1].map((d) => addCollider({ x: it.x + Math.cos(it.rot) * d * it.s, z: it.z - Math.sin(it.rot) * d * it.s, r: 0.43 * it.s, owner: it.id }));
  });
  const ponds = duskFishPonds(island, getIslandModule(island.id));
  const pondTargets = ponds.map((pond) => {
    const it = addInteractable({ type: 'pond', object: null, position: new THREE.Vector3(pond.x, 0, pond.z), radius: pond.lagoon ? Math.sqrt(pond.rx * pond.rz) : pond.rx, prompt: 'Cast', onInteract: null });
    it.pond = pond;
    return it;
  });
  const data = { placement, colliders, flora, floraColliders, ponds, pondTargets, summary: () => ({ colliders: colliders.length, floraColliders: floraColliders.length, totalColliders: colliders.length + floraColliders.length, ponds: pondTargets.length, ...placement.summary() }) };
  _data.set(island.id, data);
  return data;
}

const _trees = new Map();
/** Step 85d: the Crownlands' trunk colliders (acacia 0.5 u thin trunks, baobab bellies), registered ONCE per island on every screen. A visual rebuild (world.rebuild) never calls this again. */
export function registerCrownTreeGameplay(island) {
  if (_trees.has(island.id)) return _trees.get(island.id);
  const placement = buildCrownPlacement(island, getIslandModule(island.id));
  const colliders = placement.items.map((it) => addCollider({ x: it.x, z: it.z, r: it.trunkR, owner: it.id }));
  const data = { placement, colliders, summary: () => ({ colliders: colliders.length, ...placement.summary() }) };
  _trees.set(island.id, data);
  return data;
}
