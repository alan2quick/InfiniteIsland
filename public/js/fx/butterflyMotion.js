// Visual-only butterfly motion. One gentle flap separates long, flat-wing glides.
// Angles stay well below vertical to reduce edge-on disappearance at the original gameplay view.
const clamp01 = (v) => Math.max(0, Math.min(1, v));
export function butterflySpeed(motion = 0.3) { return 0.45 + 0.55 * clamp01(motion); }
export function butterflyWingAngle(time, _phase, offset = 0, motion = 0.3) {
  // Offset is stable per butterfly. Independent period and phase keep the flock staggered.
  // Retain the legacy phase argument for callers, but never use its rapid oscillation.
  const seed = Number.isFinite(offset) ? offset : 0;
  const period = 4 + Math.sin(seed * 2.17);
  const shift = (0.5 + 0.5 * Math.sin(seed * 3.71 + 1)) * period;
  const seconds = Number.isFinite(time) ? time : 0;
  const cycle = ((seconds + shift) % period + period) % period;
  const pulse = cycle < 0.6 ? Math.sin(Math.PI * cycle / 0.6) ** 2 : 0;
  return 0.055 + pulse * (0.12 + 0.14 * clamp01(motion));
}
