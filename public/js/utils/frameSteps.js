// Bound catch-up after tab suspension, but give player physics and world timers the same elapsed time.
export function forEachFrameStep(rawDt, tick) {
  if (!Number.isFinite(rawDt) || rawDt <= 0) return;
  let remaining = Math.min(rawDt, 0.1);
  while (remaining > 1e-9) { const dt = Math.min(remaining, 0.05); tick(dt); remaining -= dt; }
}
