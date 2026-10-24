// A quiet clearing gets one brief gathering, followed by almost two minutes without any glow.
const smooth = (x) => { const u = Math.max(0, Math.min(1, x)); return u * u * (3 - 2 * u); };
export function fireflyGathering(seconds) {
  const elapsed = Math.max(0, Number.isFinite(seconds) ? seconds : 0) - 25;
  if (elapsed < 0) return { index: -1, count: 0, glow: 0 };
  const index = Math.floor(elapsed / 135), age = elapsed % 135;
  return { index, count: 3 + index % 4, glow: age < 20 ? smooth(age / 4) * smooth((20 - age) / 4) : 0 };
}
