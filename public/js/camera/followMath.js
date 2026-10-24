// Pure helpers for the optional chase camera. World facing 0 points along +Z.
export const FOLLOW_DEFAULTS = Object.freeze({ mode: 'original', angle: 28, distance: 12, smoothness: 0.6, intro: true });
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const finite = (n, fallback) => Number.isFinite(n) ? n : fallback;

export function cameraSettings(settings = {}, previous = FOLLOW_DEFAULTS) {
  return {
    mode: settings.mode === 'follow' ? 'follow' : settings.mode === 'original' ? 'original' : previous.mode,
    angle: clamp(finite(settings.angle, previous.angle), 15, 70),
    distance: clamp(finite(settings.distance, previous.distance), 5, 24),
    smoothness: clamp(finite(settings.smoothness, previous.smoothness), 0, 1),
    intro: typeof settings.intro === 'boolean' ? settings.intro : previous.intro,
  };
}
export function shortestAngle(from, to) { return Math.atan2(Math.sin(to - from), Math.cos(to - from)); }
export function easeYaw(from, to, dt, rate) { return from + shortestAngle(from, to) * (1 - Math.exp(-rate * Math.max(0, dt))); }
// Rotation has its own catch-up time, separate from positional follow. An analytic
// critically damped spring starts with continuous velocity, takes the short way
// around +/-pi, and eventually reaches directly behind the subject (no deadzone).
// At default smoothness a stationary heading change settles 95% in ~2.37s.
export function advanceChaseYaw(state, target, dt, smoothness = FOLLOW_DEFAULTS.smoothness) {
  if (!Number.isFinite(target) || !Number.isFinite(dt) || dt <= 0) return state;
  const smoothTime = 0.4 + clamp(finite(smoothness, FOLLOW_DEFAULTS.smoothness), 0, 1);
  const omega = 2 / smoothTime;
  const error = shortestAngle(state.yaw, target);
  const relative = -error, destination = state.yaw + error;
  const decay = Math.exp(-omega * dt);
  const term = (state.velocity + omega * relative) * dt;
  const nextRelative = (relative + term) * decay;
  // A quick reversal may leave momentum towards the old heading. Stop at the
  // new target if crossed, rather than carrying the camera past the player's back.
  if (relative * nextRelative < 0) {
    state.yaw = destination; state.velocity = 0;
  } else {
    state.yaw = destination + nextRelative;
    state.velocity = (state.velocity - omega * term) * decay;
  }
  return state;
}
export function chasePositionRate(smoothness) {
  return 12 - clamp(finite(smoothness, FOLLOW_DEFAULTS.smoothness), 0, 1) * 9;
}
export function chaseOffset(yaw, settings, out = {}) {
  const pitch = settings.angle * Math.PI / 180;
  const horizontal = Math.cos(pitch) * settings.distance;
  out.x = -Math.sin(yaw) * horizontal;
  out.y = Math.sin(pitch) * settings.distance;
  out.z = -Math.cos(yaw) * horizontal;
  return out;
}
// Rotate screen-relative X/Z into the world. yaw describes the direction of camera forward.
export function cameraRelativeMove(move, yaw, out = move) {
  const x = move.x, z = move.z, c = Math.cos(yaw), s = Math.sin(yaw);
  out.x = -x * c - z * s;
  out.z = x * s - z * c;
  return out;
}
export function introEase(t) { const p = clamp(t, 0, 1); return p * p * (3 - 2 * p); }

// Terrain-only line-of-sight adapter. Mesh walls/trees require a separately supplied raycast adapter.
// Missing terrain is ignored; samples are fixed and bounded, independent of world size.
export function createTerrainOcclusion(heightAt, { clearance = 0.35, samples = 24 } = {}) {
  const steps = Number.isFinite(samples) ? Math.max(4, Math.min(64, Math.round(samples))) : 24;
  const margin = Number.isFinite(clearance) ? Math.max(0.05, Math.min(1, clearance)) : 0.35;
  return (focus, desired, out) => {
    const dx = desired.x - focus.x, dy = desired.y - focus.y, dz = desired.z - focus.z;
    let fraction = 1;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const ground = heightAt(focus.x + dx * t, focus.z + dz * t);
      if (Number.isFinite(ground) && focus.y + dy * t < ground + margin) {
        fraction = Math.max(0.04, (i - 1) / steps); break;
      }
    }
    out.x = focus.x + dx * fraction;
    out.y = focus.y + dy * fraction;
    out.z = focus.z + dz * fraction;
    return out;
  };
}

// Conservative upright cylinders for the static collider registry, without traversing rendered meshes.
// Existing collider data has no vertical size: cameraHeight may be supplied on the collider/owner,
// otherwise a 2.5-unit cylinder is used. This deliberately excludes remote player meshes.
export function createWorldOcclusion(heightAt, colliders, options = {}) {
  const terrain = createTerrainOcclusion(heightAt, options);
  return (focus, desired, out) => {
    terrain(focus, desired, out);
    const dx = out.x - focus.x, dy = out.y - focus.y, dz = out.z - focus.z;
    const a = dx * dx + dz * dz;
    if (a < 1e-8) return out;
    let fraction = 1;
    const list = typeof colliders === 'function' ? colliders() : colliders;
    for (const c of list || []) {
      if (![c.x, c.z, c.r].every(Number.isFinite) || c.r <= 0 || c.cameraIgnore || c.owner?.userData?.cameraIgnore) continue;
      const r = c.r + 0.25, x = focus.x - c.x, z = focus.z - c.z;
      // Ignore a collider containing the focus (e.g. a bench touched by the player), avoiding a zero-distance camera.
      if (x * x + z * z <= r * r) continue;
      const b = x * dx + z * dz, disc = b * b - a * (x * x + z * z - r * r);
      if (disc < 0) continue;
      const t = (-b - Math.sqrt(disc)) / a;
      if (t <= 0 || t >= fraction) continue;
      const base = heightAt(c.x, c.z);
      const height = finite(c.cameraHeight, finite(c.owner?.userData?.cameraHeight, 2.5));
      const y = focus.y + dy * t;
      if (Number.isFinite(base) && (y < base - 0.25 || y > base + Math.max(0.1, height) + 0.25)) continue;
      fraction = Math.max(0.04, t - 0.03);
    }
    out.x = focus.x + dx * fraction; out.y = focus.y + dy * fraction; out.z = focus.z + dz * fraction;
    return out;
  };
}
