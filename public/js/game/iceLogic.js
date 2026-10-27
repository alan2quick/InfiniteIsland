// Pure floe footing shared by player physics and future ground surfaces (lake ice remains opt-out).
// slideVelocity(v,target,dt,grip), rideFloe(point,before,after), tiltLoad(occupants,pad).
import { ICE } from '../config.js';
export function slideVelocity(v, target, dt, grip = ICE.grip) {
  const k = 1 - Math.exp(-Math.max(0, grip) * Math.max(0, dt));
  return { x: v.x + (target.x - v.x) * k, z: v.z + (target.z - v.z) * k };
}
export function rideFloe(p, before, after) {
  const a = (after.rot || 0) - (before.rot || 0), c = Math.cos(a), s = Math.sin(a), x = p.x - before.x, z = p.z - before.z;
  return { x: after.x + c * x - s * z, z: after.z + s * x + c * z };
}
export function tiltLoad(occupants, pad) {
  const r = pad.r || Math.min(pad.w, pad.d) / 2;
  return { x: Math.max(-1, Math.min(1, occupants.reduce((s, p) => s + (p.x - pad.x) / r, 0))) * ICE.tilt,
    z: Math.max(-1, Math.min(1, occupants.reduce((s, p) => s + (p.z - pad.z) / r, 0))) * ICE.tilt,
    sink: Math.min(ICE.sink, Math.max(0, occupants.length - 1) * ICE.sink / 2) };
}
