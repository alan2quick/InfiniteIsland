// Circle collider registry (XZ plane) with a uniform spatial hash for fast lookups.
//
//   addCollider({ x, z, r, owner? })  -> collider   (owner is any handle, e.g. the prop's Object3D)
//   getColliders()                    -> array of every collider
//   resolveCircle(pos, radius)        -> pushes pos {x,z} out of every overlapping circle (mutates + returns pos)
//   removeCollider(c) / clearColliders()
//
// Static props only, so the hash is populated on add and never rebuilt (the rare mover, e.g. a wandering critter, re-files itself with moveCollider).

const CELL = 4;                       // hash cell size (units); larger than typical collider radii
const _cells = new Map();             // "cx,cz" -> collider[]
const _all = [];
let _maxR = 0;

const key = (cx, cz) => cx * 73856093 ^ cz * 19349663;

function cellRange(x, z, r) {
  return [
    Math.floor((x - r) / CELL), Math.floor((x + r) / CELL),
    Math.floor((z - r) / CELL), Math.floor((z + r) / CELL),
  ];
}

export function addCollider({ x, z, r, owner = null }) {
  const c = { x, z, r, owner };
  _all.push(c);
  _maxR = Math.max(_maxR, r);
  const [x0, x1, z0, z1] = cellRange(x, z, r);
  for (let cx = x0; cx <= x1; cx++) {
    for (let cz = z0; cz <= z1; cz++) {
      const k = key(cx, cz);
      let list = _cells.get(k);
      if (!list) { list = []; _cells.set(k, list); }
      list.push(c);
    }
  }
  return c;
}

export function removeCollider(c) {
  const i = _all.indexOf(c);
  if (i < 0) return;
  _all.splice(i, 1);
  const [x0, x1, z0, z1] = cellRange(c.x, c.z, c.r);
  for (let cx = x0; cx <= x1; cx++) {
    for (let cz = z0; cz <= z1; cz++) {
      const list = _cells.get(key(cx, cz));
      if (list) { const j = list.indexOf(c); if (j >= 0) list.splice(j, 1); }
    }
  }
}

/** Move a registered collider (Step 34a: the Frostpine critters wander): re-files it in the hash cells of its new position. */
export function moveCollider(c, x, z) {
  const i = _all.indexOf(c);
  if (i < 0) return false;
  const [a0, a1, b0, b1] = cellRange(c.x, c.z, c.r);
  for (let cx = a0; cx <= a1; cx++) {
    for (let cz = b0; cz <= b1; cz++) {
      const list = _cells.get(key(cx, cz));
      if (list) { const j = list.indexOf(c); if (j >= 0) list.splice(j, 1); }
    }
  }
  c.x = x; c.z = z;
  const [x0, x1, z0, z1] = cellRange(x, z, c.r);
  for (let cx = x0; cx <= x1; cx++) {
    for (let cz = z0; cz <= z1; cz++) {
      const k = key(cx, cz);
      let list = _cells.get(k);
      if (!list) { list = []; _cells.set(k, list); }
      list.push(c);
    }
  }
  return true;
}

export function clearColliders() {
  _cells.clear();
  _all.length = 0;
  _maxR = 0;
}

export function getColliders() {
  return _all;
}

const _seen = new Set();

/**
 * Push `pos` ({x,z}) out of any collider circle it overlaps, given the mover's `radius`.
 * Two passes so that wedging between two circles settles. Mutates and returns `pos`.
 */
export function resolveCircle(pos, radius) {
  for (let pass = 0; pass < 2; pass++) {
    let moved = false;
    _seen.clear();
    const [x0, x1, z0, z1] = cellRange(pos.x, pos.z, radius);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const list = _cells.get(key(cx, cz));
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const c = list[i];
          if (_seen.has(c)) continue;
          _seen.add(c);
          const dx = pos.x - c.x, dz = pos.z - c.z;
          const min = c.r + radius;
          const d2 = dx * dx + dz * dz;
          if (d2 >= min * min) continue;
          const d = Math.sqrt(d2);
          if (d < 1e-6) { pos.x = c.x + min; moved = true; continue; }   // dead centre: push along +x
          const push = (min - d) / d;
          pos.x += dx * push;
          pos.z += dz * push;
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
  return pos;
}

/** True if a circle at (x,z) with `radius` overlaps any collider (no mutation). */
export function overlapsAny(x, z, radius, ignore = null) {
  const [x0, x1, z0, z1] = cellRange(x, z, radius);
  for (let cx = x0; cx <= x1; cx++) {
    for (let cz = z0; cz <= z1; cz++) {
      const list = _cells.get(key(cx, cz));
      if (!list) continue;
      for (const c of list) {
        if (ignore?.(c)) continue;
        const dx = x - c.x, dz = z - c.z, min = c.r + radius;
        if (dx * dx + dz * dz < min * min) return true;
      }
    }
  }
  return false;
}
