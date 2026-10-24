// Partition the emitted triangles for exhaustive CPU ray tests. Every triangle
// is retained exactly once; Three's normal raycaster still performs intersections.
// Small bounding volumes skip unrelated triangles without thinning sample rays.
import * as THREE from 'three';

export function spatialRaycastMesh(source, cellSize = 24) {
  const geometry = source.geometry, pos = geometry.getAttribute('position'), index = geometry.index;
  const bins = new Map(), count = index ? index.count : pos.count;
  for (let i = 0; i < count; i += 3) {
    const ids = [0, 1, 2].map(k => index ? index.getX(i + k) : i + k);
    const x = ids.reduce((n, id) => n + pos.getX(id), 0) / 3;
    const z = ids.reduce((n, id) => n + pos.getZ(id), 0) / 3;
    const key = `${Math.floor(x / cellSize)},${Math.floor(z / cellSize)}`;
    if (!bins.has(key)) bins.set(key, []);
    const vertices = bins.get(key);
    for (const id of ids) vertices.push(pos.getX(id), pos.getY(id), pos.getZ(id));
  }
  const group = new THREE.Group();
  // Source is already updated by the caller. Preserve its actual world transform.
  group.matrixAutoUpdate = false;
  group.matrix.copy(source.matrixWorld);
  for (const vertices of bins.values()) {
    const chunk = new THREE.BufferGeometry();
    // Avoid another Float32 rounding pass if the source uses Float64.
    chunk.setAttribute('position', new THREE.BufferAttribute(new pos.array.constructor(vertices), 3));
    chunk.computeBoundingBox(); chunk.computeBoundingSphere();
    group.add(new THREE.Mesh(chunk, source.material));
  }
  group.updateMatrixWorld(true);
  return { mesh: group, dispose() { for (const chunk of group.children) chunk.geometry.dispose(); } };
}
