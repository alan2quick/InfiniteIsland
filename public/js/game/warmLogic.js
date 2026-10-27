// Generic pure warming. warmth(value,dt,{pos,fire,fuel,carried},gift=0) -> 0..1.
// Fuel must be positive and object put down inside WARM.radius; gifts are additive warmth.
// No day/night input, decay, timers, persistence or mutation.
import { WARM } from '../config.js';
export function warmth(value, dt, { pos, fire, fuel, carried = false }, gift = 0) {
  const lit = fuel > 0 && !carried && pos && fire && Math.hypot(pos.x - fire.x, pos.z - fire.z) <= WARM.radius && Math.abs(pos.y - fire.y) < 2;
  return Math.max(0, Math.min(1, (Number(value) || 0) + (lit ? Math.max(0, dt) * WARM.rate + Math.max(0, gift) : 0)));
}
