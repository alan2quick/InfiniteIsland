// Ruby placement, independent of visuals. Searches only existing clearings; seeded props never move.
import { FIRES } from '../../config.js';
import { coveFrame } from './emberCove.js';
import { LAVA_MOUTH } from './lavaMouth.js';
import { getHeight, isWalkable } from '../terrain.js';
import { overlapsAny } from '../colliders.js';
import { getInteractables } from '../interactables.js';
export function rubyPlan({ height = getHeight, walkable = isWalkable, overlaps = overlapsAny, interactables = getInteractables } = {}) {
  const f = coveFrame(), fire = FIRES.find(f => f.id === 'ember'), used = [];
  function find(seed, room = 1) {
    for (let ring = 0; ring <= 12; ring++) for (let k = 0; k < (ring ? 24 : 1); k++) {
      const a = k * Math.PI / 12, x = seed.x + Math.cos(a) * ring * 0.4, z = seed.z + Math.sin(a) * ring * 0.4, y = height(x, z);
      if (!walkable(x, z) || y < 0.1 || overlaps(x, z, room)) continue;
      if (used.some(p => Math.hypot(p.x - x, p.z - z) < room + 1)) continue;
      if (interactables().some(i => Math.hypot(i.position.x - x, i.position.z - z) < room + (i.radius || 0))) continue;
      if (![0, 1, 2, 3].every(q => { const px = x + Math.cos(q * Math.PI / 2) * room, pz = z + Math.sin(q * Math.PI / 2) * room; return walkable(px, pz) && Math.abs(height(px, pz) - y) < 0.3; })) continue;
      const p = { x, y, z }; used.push(p); return p;
    }
    throw new Error('Ruby needs a clear walkable placement near ' + JSON.stringify(seed));
  }
  const thief = find(f.to(-5, -1)), pool = find(f.to(-0.5, -3)), dig = find(f.to(-4, 3));
  const hearth = find({ x: fire.x + 3.8, z: fire.z + 1.8 });
  const crust = find({ x: LAVA_MOUTH.front.x + 3, z: LAVA_MOUTH.front.z + 3 }, 0.9);
  // Parallel to the original tutorial, on its opposite (north) side. Its circular zone never
  // overlaps the old tutorial/deck zones; the first pad meets the beach north of the reserved cove.
  const pads = Array.from({ length: 7 }, (_, i) => ({ id: `ruby-${i}`, kind: 'wet', ...f.to(-8 + i * 3, -28), r: 1.2, top: 0.4 + (i % 2) * 0.05, ...(i === 0 || i === 3 || i === 6 ? { cp: true } : {}) }));
  const center = f.to(1, -28);
  const course = { id: 'ruby-pools', name: "Ruby's tide pools", zone: { ...center, r: 11 }, gapY: -0.05, pads,
    links: pads.slice(1).map((p, i) => ({ a: pads[i].id, b: p.id })), start: pads[0].id, goal: pads[6].id, route: pads.map(p => p.id) };
  const goal = { ...pads[6], y: pads[6].top };
  return { thief, pool, dig, hearth, crust, goal, course, fire: { x: fire.x, y: height(fire.x, fire.z), z: fire.z }, spots: used,
    summary() { return { thief, pool, dig, hearth, crust, goal, course: course.id }; } };
}
