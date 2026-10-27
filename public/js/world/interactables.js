// Interactable registry. Step 3 only registers them; Step 5 fills in `onInteract` and the HUD prompt.
//
// Interactable shape:
//   { id, type: 'tree'|'palm'|'rock'|'bush'|'flower'|'sign'|'item',
//     object,        // Object3D to animate (null for flowers)
//     instance,      // flowers only: { mesh, index, position: Vector3, scale, rotY } (an InstancedMesh slot)
//     position,      // THREE.Vector3 (world) - reach is measured from here
//     radius,        // footprint radius; distance to the player is measured to the prop's surface
//     prompt,        // 'Shake' | 'Inspect' | 'Read' | 'Smell' | 'Rustle'
//     onInteract }   // null now; Step 5 sets (interactable, playerCtx) => void
//
// Lookup cost (Step 27b): findNearest() must not scale with the content of ALL islands. Static interactables (everything except ground
// items) live in a coarse spatial grid keyed by their position at add / restore time, so a query only visits the few cells around the
// player (in practice: the player's region). Ground items ('item', the tools) mutate their `position` in place when they are tossed or
// dropped, so they sit in a small always-scanned list instead. Ties on equal distance go to the most recently added / restored entry, exactly
// like the old linear scan over the registration-ordered array (`seq`). A reachable toolrack wins only in its narrow +Z front approach.

import { TOOL_RACK } from '../config.js';

const GRID_CELL = 16;                        // u; wider than every static footprint, so a query needs about 3 x 3 cells
const DYNAMIC_TYPES = new Set(['carryable', 'guide', 'item', 'critter', 'tdoong', 'caprayfeed']);     // types whose `position` may be mutated while registered ('critter': Frostpine's wandering animals, Step 34a; 'tdoong': the wandering Tdoongz, Step 64a; 'caprayfeed': the offering spot follows the wild ray round its pond, Step 73b)

const _items = [];                           // every registered interactable (public getInteractables() array, registration order)
const _grid = new Map();                     // cell key -> static interactables
const _dynamic = [];                         // always-scanned interactables
let _nextId = 1;
let _seq = 1;
let _maxR = 0;                               // largest static radius: widens the cell range a query has to visit

const cellKey = (cx, cz) => cx * 73856093 ^ cz * 19349663;

function bucket(item) {
  item.seq = _seq++;
  if (DYNAMIC_TYPES.has(item.type)) { _dynamic.push(item); return; }
  const cx = Math.floor(item.position.x / GRID_CELL), cz = Math.floor(item.position.z / GRID_CELL);
  item.cell = cellKey(cx, cz);
  let list = _grid.get(item.cell);
  if (!list) { list = []; _grid.set(item.cell, list); }
  list.push(item);
  if (item.radius > _maxR) _maxR = item.radius;
}

function unbucket(item) {
  if (DYNAMIC_TYPES.has(item.type)) {
    const j = _dynamic.indexOf(item);
    if (j >= 0) _dynamic.splice(j, 1);
    return;
  }
  const list = _grid.get(item.cell);
  if (!list) return;
  const j = list.indexOf(item);
  if (j >= 0) list.splice(j, 1);
  if (!list.length) _grid.delete(item.cell);
}

export function addInteractable({ type, object = null, instance = null, position, radius = 0.8, prompt = 'Interact', onInteract = null, canInteract = null }) {
  const item = { id: _nextId++, type, object, instance, position, radius, prompt, onInteract, canInteract, seq: 0, cell: 0 };
  _items.push(item);
  bucket(item);
  return item;
}

export function removeInteractable(item) {
  const i = _items.indexOf(item);
  if (i < 0) return false;
  _items.splice(i, 1);
  unbucket(item);
  return true;
}

/** Put a previously removed interactable back (same object, so external references stay valid). No-op if present. */
export function restoreInteractable(item) {
  if (!item || _items.includes(item)) return false;
  _items.push(item);
  bucket(item);                              // re-bucketed from its current position
  return true;
}

export function getInteractables() {
  return _items;
}

export function clearInteractables() {
  _items.length = 0;
  _grid.clear();
  _dynamic.length = 0;
  _maxR = 0;
}

/**
 * Nearest interactable to `pos` ({x,z}, y ignored) within `maxDist` of its surface
 * (centre distance minus its radius, floored at 0). Returns the interactable or null;
 * the measured distance is left on `item.lastDistance` for convenience. Optional `eligible` filters
 * targets before distance ranking (standing stones are only targets when the player holds a tool).
 */
export function findNearest(pos, maxDist = 2.2, eligible = null) {
  let best = null;
  let bestD = maxDist, bestPriority = 0;
  const consider = (it) => {
    if (it.canInteract && !it.canInteract(pos)) return;
    if (eligible && !eligible(it)) return;
    const dx = pos.x - it.position.x, dz = pos.z - it.position.z;
    const d = Math.max(0, Math.sqrt(dx * dx + dz * dz) - it.radius);
    if (d > maxDist) return;
    // Repeated presses in front of a rack cycle tools even if a pickup landed nearby.
    const priority = it.type === 'toolrack' && dz >= 0 && Math.abs(dx) <= TOOL_RACK.frontHalfWidth && Math.hypot(dx, dz) <= TOOL_RACK.frontReach ? 1 : 0;
    if (priority > bestPriority || priority === bestPriority && (d < bestD || d === bestD && (best === null || it.seq > best.seq))) {
      bestD = d; best = it; bestPriority = priority;
    }
  };
  const reach = maxDist + _maxR;
  const x0 = Math.floor((pos.x - reach) / GRID_CELL), x1 = Math.floor((pos.x + reach) / GRID_CELL);
  const z0 = Math.floor((pos.z - reach) / GRID_CELL), z1 = Math.floor((pos.z + reach) / GRID_CELL);
  for (let cx = x0; cx <= x1; cx++) {
    for (let cz = z0; cz <= z1; cz++) {
      const list = _grid.get(cellKey(cx, cz));
      if (!list) continue;
      for (let i = 0; i < list.length; i++) consider(list[i]);
    }
  }
  for (let i = 0; i < _dynamic.length; i++) consider(_dynamic[i]);
  if (best) best.lastDistance = bestD;
  return best;
}
