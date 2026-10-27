// Reusable carry rules, no rendering. createCarryState(defs), validatePick(state,key,id,pos),
// applyPick(state,key,id), applyDrop(state,key,spot), putDown(pos,yaw,safe), waterDrop(checkpoint).
// State is JSON {objects:{id:{carryable,x,y,z,carrier:null|string}}}; changes return copies.
import { CARRY } from '../config.js';
export const createCarryState = defs => ({ objects: Object.fromEntries(defs.map(d => [d.id, { ...d, carrier: null }])) });
export const carriedBy = (s, key) => Object.entries(s.objects).find(([, o]) => o.carrier === key)?.[0] || null;
export function validatePick(s, key, id, pos) {
  const o = s.objects[id];
  if (!key || !o?.carryable) return 'object';
  if (o.carrier || carriedBy(s, key)) return 'occupied';
  if (!pos || Math.hypot(pos.x - o.x, pos.z - o.z) > CARRY.reach || Math.abs(pos.y - o.y) > 2) return 'far';
  return null;
}
export function applyPick(s, key, id) { return { objects: { ...s.objects, [id]: { ...s.objects[id], carrier: key } } }; }
export function applyDrop(s, key, spot) {
  const id = carriedBy(s, key);
  return id && spot ? { objects: { ...s.objects, [id]: { ...s.objects[id], ...spot, carrier: null } } } : s;
}
export function putDown(pos, yaw, safe) {
  if (!pos || !Number.isFinite(yaw)) return null;
  for (const angle of [0, .5, -.5, 1, -1, Math.PI]) {
    const x = pos.x + Math.sin(yaw + angle) * CARRY.dropDistance, z = pos.z + Math.cos(yaw + angle) * CARRY.dropDistance;
    const y = safe(x, z, pos.y);
    if (Number.isFinite(y)) return { x, y, z };
  }
  return null;
}
export const waterDrop = checkpoint => checkpoint && [checkpoint.x, checkpoint.y, checkpoint.z].every(Number.isFinite) ? { x: checkpoint.x, y: checkpoint.y, z: checkpoint.z } : null;
