// Only the home seating moves onto the drier southern grass; the fire stays put.
export const HOME_SEATING_OFFSET = Object.freeze({ x: 0, z: 1.1 });
export function campBenchSpot(fire, index) {
  const a = fire.bench.angles[index % fire.bench.angles.length];
  const offset = fire.id === 'home' ? HOME_SEATING_OFFSET : { x: 0, z: 0 };
  const x = Math.cos(a) * fire.bench.ring + offset.x, z = Math.sin(a) * fire.bench.ring + offset.z;
  return { x, z, tangentX: -Math.sin(a), tangentZ: Math.cos(a), facing: Math.atan2(-x, -z) };
}
