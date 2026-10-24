// Opening view of the current island's complete coast frame, before easing down to the player.
import { frameExtent, islandGap } from '../world/islands/extent.js';

export function islandIntroOptions(islands, target, camera) {
  const island = islands.reduce((nearest, candidate) => !nearest || islandGap(candidate, target.x, target.z) < islandGap(nearest, target.x, target.z) ? candidate : nearest, null);
  if (!island) return { center: { x: target.x, y: target.y, z: target.z }, height: 65, duration: 3 };
  const extent = frameExtent(island);
  const vertical = Math.tan(camera.fov * Math.PI / 360);
  const horizontal = vertical * camera.aspect;
  // Padding covers terrain elevation and the slight southward offset of the opening camera.
  const required = Math.max(extent.halfX / Math.max(0.1, horizontal), extent.halfZ / Math.max(0.1, vertical)) * 1.15 + 24;
  const maximum = Number.isFinite(camera.far) ? camera.far * 0.8 : 600;
  return { center: { x: island.x, y: target.y, z: island.z }, height: Math.max(65, Math.min(maximum, required)), duration: 3 };
}
