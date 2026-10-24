// Temporarily move ground-view fog back with the aerial introduction, then restore it.
export function createIntroFog(scene, camera) {
  let last = null;
  return {
    beforeFrame() {
      if (last && scene.fog === last.fog && scene.fog.near === last.near && scene.fog.far === last.far) {
        scene.fog.near = last.baseNear; scene.fog.far = last.baseFar;
      }
      last = null;
    },
    afterLighting() {
      const fog = scene.fog, lift = Math.max(0, (camera.introDistance || 0) - 65);
      if (!fog || !Number.isFinite(fog.near) || !Number.isFinite(fog.far) || !lift) return;
      const baseNear = fog.near, baseFar = fog.far;
      fog.near += lift; fog.far += lift;
      last = { fog, baseNear, baseFar, near: fog.near, far: fog.far };
    },
  };
}
