// Pure cosmetic ground follower (Step 76a), no Three.js or world registries.
// groundFollowStep(state, heel, dt, {heightAt, walkable, blocked, cfg}) mutates x/y/z,
// vx/vz/yaw and stuck progress; returns {poof, reason, speed, catching, target}.
// blocked(x,z,r) is a spatial circle query; walkable/heightAt include bridge decks.
// nearestGroundSpot searches concentric rings near the heel, or returns null (hide).
// Each candidate sweeps short samples so thin walls and cliff edges cannot be skipped.
import { PET } from '../config.js';
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export function nearestGroundSpot(heel, { heightAt = () => 0, walkable = () => true, blocked = () => false, cfg = PET.ground } = {}) {
  const valid = (x, z) => walkable(x, z) && Number.isFinite(heightAt(x, z)) && !blocked(x, z, cfg.radius);
  if (valid(heel.x, heel.z)) return { ...heel, y: heightAt(heel.x, heel.z) };
  for (let r = cfg.searchStep; r <= cfg.searchRadius; r += cfg.searchStep) {
    for (let i = 0; i < cfg.searchAngles; i++) {
      const a = i * Math.PI * 2 / cfg.searchAngles, x = heel.x + Math.sin(a) * r, z = heel.z + Math.cos(a) * r;
      if (valid(x, z)) return { x, y: heightAt(x, z), z };
    }
  }
  return null;
}
export function groundFollowStep(s, heel, dt, env = {}) {
  const { heightAt = () => 0, walkable = () => true, blocked = () => false, cfg = PET.ground } = env;
  dt = Math.max(0, Math.min(dt, 0.1));
  const target = nearestGroundSpot(heel, env);
  const old = { x: s.x, z: s.z };
  const rawDist = distance(s, heel), dist = target ? distance(s, target) : Infinity;
  const far = dist > cfg.stuckFar;
  // Remove target motion from the progress baseline: a steadily running owner is not a stuck pet.
  if (target && s.lastTarget && s.bestDist !== undefined) s.bestDist += dist - distance(s, s.lastTarget);
  s.lastTarget = target ? { x: target.x, z: target.z } : null;
  // Distance progress is measured over a window, rather than testing one small frame's motion.
  if (!far || s.bestDist === undefined || dist < s.bestDist - cfg.progress) { s.bestDist = dist; s.stuckFor = 0; }
  else s.stuckFor = (s.stuckFor || 0) + dt;
  const invalid = !walkable(s.x, s.z) || !Number.isFinite(heightAt(s.x, s.z));
  const badHeel = !walkable(heel.x, heel.z) && dist > cfg.stop;
  const reason = !target ? 'unwalkable' : rawDist > PET.lost ? 'lost' : invalid || badHeel ? 'unwalkable' : s.stuckFor >= cfg.stuckAfter ? 'stuck' : null;
  if (reason) {
    s.vx = s.vz = s.vy = 0; s.stuckFor = 0; s.bestDist = undefined;
    if (target) { s.x = target.x; s.y = target.y; s.z = target.z; }
    return { poof: true, reason, speed: 0, catching: false, target };
  }
  const catching = dist > cfg.runAfter, speed = Math.min(catching ? cfg.runSpeed : cfg.walkSpeed, Math.max(0, dist - cfg.stop) / Math.max(dt, 1e-6));
  const heading = Math.atan2(target.x - s.x, target.z - s.z), step = speed * dt;
  const clear = (x, z) => {
    const d = Math.hypot(x - s.x, z - s.z), count = Math.max(1, Math.ceil(d / cfg.sampleStep));
    let y = heightAt(s.x, s.z);
    for (let i = 1; i <= count; i++) {
      const px = s.x + (x - s.x) * i / count, pz = s.z + (z - s.z) * i / count, py = heightAt(px, pz);
      if (!walkable(px, pz) || !Number.isFinite(py) || Math.abs(py - y) > cfg.maxStep || blocked(px, pz, cfg.radius)) return false;
      y = py;
    }
    return true;
  };
  let best = null, score = Infinity;
  if (step > 0) for (const turn of cfg.headings) {
    const a = heading + turn, dx = Math.sin(a), dz = Math.cos(a);
    const x = s.x + dx * step, z = s.z + dz * step;
    if (!clear(x, z)) continue;
    // Look ahead around round props; retain a short wall-slide candidate when the probe is blocked.
    const probe = Math.max(step, cfg.probe), px = s.x + dx * probe, pz = s.z + dz * probe;
    const v = distance({ x: px, z: pz }, target) + Math.abs(turn) * 0.025 + (clear(px, pz) ? 0 : cfg.probe);
    if (v < score) { score = v; best = { x, z }; }
  }
  if (best) { s.x = best.x; s.z = best.z; }
  s.y = heightAt(s.x, s.z); s.vy = 0;
  s.vx = dt ? (s.x - old.x) / dt : 0; s.vz = dt ? (s.z - old.z) / dt : 0;
  const actual = Math.hypot(s.vx, s.vz);
  if (actual > 0.01) {
    const want = Math.atan2(s.vx, s.vz), d = Math.atan2(Math.sin(want - (s.yaw || 0)), Math.cos(want - (s.yaw || 0)));
    s.yaw = (s.yaw || 0) + d * (1 - Math.exp(-cfg.turnRate * dt));
  }
  return { poof: false, reason: null, speed: actual, catching, target };
}

// Ruby's per-pet idle table. Terrain-dependent choices are excluded before the random draw.
export function stepRubyIdle(idle, dt, { ownerStill, canIdle, sand = false, water = false, angle = 0, rng = Math.random } = {}) {
  if (!ownerStill || !canIdle) { idle.kind = null; idle.stillFor = 0; idle.cooldown = PET.idleGap[0]; return null; }
  idle.stillFor += dt;
  if (idle.kind) {
    idle.t += dt;
    if (idle.t < idle.dur && (idle.kind !== 'dig' || sand) && (idle.kind !== 'bubbles' || water)) return idle.kind;
    idle.kind = null; idle.cooldown = PET.idleGap[0] + rng() * (PET.idleGap[1] - PET.idleGap[0]);
  }
  idle.cooldown -= dt;
  if (idle.stillFor < PET.idleAfter || idle.cooldown > 0) return null;
  const kinds = ['hide', 'wave', 'shuffle', ...(sand ? ['dig'] : []), ...(water ? ['bubbles'] : [])];
  idle.kind = kinds[Math.min(kinds.length - 1, Math.floor(rng() * kinds.length))];
  idle.t = 0; idle.ang0 = angle; idle.dur = PET.ruby.idleLen[idle.kind]; idle.side = rng() < 0.5 ? -1 : 1;
  return idle.kind;
}
