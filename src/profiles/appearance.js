// Strict original-character palette metadata; no game assets or shared progress.
export function normaliseAppearance(value) {
  const appearance = {};
  for (const key of ['shirt', 'pants', 'hat', 'cuff']) {
    const color = value?.[key];
    if (typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)) appearance[key] = color;
  }
  return appearance;
}
