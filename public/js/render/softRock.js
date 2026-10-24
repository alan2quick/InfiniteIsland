// Share shading across coincident rock vertices while preserving the low-poly silhouette, topology and collision footprint.
// No random samples: seeded placement remains identical. Keep a little faceting rather than making glossy spheres.
export function softenRockGeometry(geometry, amount = 0.7) {
  const position = geometry.attributes.position, normal = geometry.attributes.normal, color = geometry.attributes.color;
  if (!position || !normal) return geometry;
  const groups = new Map();
  for (let i = 0; i < position.count; i++) {
    const key = `${position.getX(i).toFixed(5)},${position.getY(i).toFixed(5)},${position.getZ(i).toFixed(5)}`;
    let value = groups.get(key);
    if (!value) { value = { indices: [], n: [0, 0, 0], c: [0, 0, 0] }; groups.set(key, value); }
    value.indices.push(i);
    for (let k = 0; k < 3; k++) { value.n[k] += normal.array[i * 3 + k]; if (color) value.c[k] += color.array[i * 3 + k]; }
  }
  const mix = Math.max(0, Math.min(1, amount));
  for (const value of groups.values()) {
    const length = Math.hypot(...value.n) || 1;
    for (const i of value.indices) {
      let nx = normal.getX(i) * (1 - mix) + value.n[0] / length * mix;
      let ny = normal.getY(i) * (1 - mix) + value.n[1] / length * mix;
      let nz = normal.getZ(i) * (1 - mix) + value.n[2] / length * mix;
      const size = Math.hypot(nx, ny, nz) || 1;
      normal.setXYZ(i, nx / size, ny / size, nz / size);
      if (color) for (let k = 0; k < 3; k++) color.array[i * 3 + k] = color.array[i * 3 + k] * (1 - mix) + value.c[k] / value.indices.length * mix;
    }
  }
  normal.needsUpdate = true; if (color) color.needsUpdate = true;
  return geometry;
}
