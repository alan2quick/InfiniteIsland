import { campBenchSpot } from '../world/campSeating.js';
// Cosmetic campfire seating and sparse greetings. No player/world state belongs here.
export const CAMP_GREETINGS = Object.freeze(['Hi!', 'Hello!', 'Good to see you!', 'Lovely day!', 'Welcome, friend.', 'Nice to see you!']);

export function campfireCastSeats(fire, seats = []) {
  // Home has four wide log benches. Seat two friends on each of the two longer sides, one on the others.
  const plan = [[0, -0.48], [0, 0.48], [1, 0], [2, -0.48], [2, 0.48], [3, 0]];
  return plan.map(([index, offset]) => {
    const spot = campBenchSpot(fire, index);
    const seat = seats[index] || { x: fire.x + spot.x, y: 0.5, z: fire.z + spot.z, facing: spot.facing };
    const tx = seat.tangentX ?? spot.tangentX, tz = seat.tangentZ ?? spot.tangentZ;
    const dx = seat.x - fire.x, dz = seat.z - fire.z, length = Math.hypot(dx, dz) || 1;
    return { x: seat.x + tx * offset, y: seat.y - 0.3, z: seat.z + tz * offset, facing: seat.facing, outwardX: dx / length, outwardZ: dz / length };
  });
}

export function createCampGreetings(random = Math.random) {
  let wait = 8 + random() * 7, active = null, last = null;
  return {
    update(dt, ids, visible = true) {
      if (!visible || !ids.length) { active = null; return null; }
      const elapsed = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.25)) : 0;
      if (active) { active.remaining -= elapsed; if (active.remaining > 0 && ids.includes(active.id)) return { ...active }; active = null; }
      wait -= elapsed;
      if (wait > 0) return null;
      const choices = ids.filter((id) => id !== last), available = choices.length ? choices : ids;
      const pick = (values) => values[Math.min(values.length - 1, Math.floor(Math.max(0, random()) * values.length))];
      last = pick(available);
      active = { id: last, text: pick(CAMP_GREETINGS), remaining: 2.6 };
      wait = 18 + random() * 16;
      return { ...active };
    },
  };
}

// Cosmetic walk path: take a short arc around the pit when the direct line would cross it.
export function campfireWalkPoint(from, to, fire, progress, out = {}) {
  const t = Math.max(0, Math.min(1, progress)), dx = to.x - from.x, dz = to.z - from.z;
  const len2 = dx * dx + dz * dz;
  const along = len2 > 0 ? Math.max(0, Math.min(1, ((fire.x - from.x) * dx + (fire.z - from.z) * dz) / len2)) : 0;
  const nearest = Math.hypot(from.x + dx * along - fire.x, from.z + dz * along - fire.z);
  if (nearest < 1.3 && along > 0 && along < 1) {
    const r0 = Math.hypot(from.x - fire.x, from.z - fire.z), r1 = Math.hypot(to.x - fire.x, to.z - fire.z);
    const a0 = Math.atan2(from.x - fire.x, from.z - fire.z), a1 = Math.atan2(to.x - fire.x, to.z - fire.z);
    const delta = Math.atan2(Math.sin(a1 - a0), Math.cos(a1 - a0)), angle = a0 + delta * t, radius = r0 + (r1 - r0) * t;
    out.x = fire.x + Math.sin(angle) * radius; out.z = fire.z + Math.cos(angle) * radius;
  } else { out.x = from.x + dx * t; out.z = from.z + dz * t; }
  out.y = from.y + (to.y - from.y) * t;
  return out;
}


// Fixed-pixel names need less clutter when the camera pulls back. Reuse one short list per projected frame.
export function reserveCampLabel({ x, y, width, height, actorPixels }, occupied) {
  if (actorPixels < 24 || ![x, y, width, height, actorPixels].every(Number.isFinite)) return false;
  const box = { left: x - width / 2 - 3, right: x + width / 2 + 3, top: y - height - 3, bottom: y + 3 };
  if (occupied.some((other) => box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top)) return false;
  occupied.push(box); return true;
}
