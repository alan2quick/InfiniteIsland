// Carle's cosmetic idle policy. stepCarleIdle(idle, dt, ctx) returns head / loop / flower / shoulder or null;
// carleIdleDrive(kind, u, ctx) returns the same target contract as petLogic.idleDrive. No Capray idles change.
import { PET } from '../config.js';
import { idleDrive, leftOf } from './petLogic.js';

export function nearestFlower(flowers, owner, range = PET.carle.flowerRange) {
  let best = null, distance = range;
  for (const f of flowers || []) {
    const p = f.position || f;
    const d = Math.hypot(p.x - owner.x, p.z - owner.z);
    if (d < distance) { best = p; distance = d; }
  }
  return best;
}
export function stepCarleIdle(idle, dt, ctx) {
  if (!ctx.canIdle || !ctx.ownerStill) { idle.kind = null; idle.stillFor = 0; return null; }
  idle.stillFor += dt;
  if (idle.kind) {
    idle.t += dt;
    // A sleeping butterfly stays perched through the night rather than taking off between naps.
    if (ctx.sleepy && idle.kind === 'shoulder') { idle.t = Math.min(idle.t, idle.dur * 0.7); return idle.kind; }
    if ((ctx.sleepy && idle.kind !== 'shoulder') || (!ctx.sleepy && idle.kind === 'shoulder') || (idle.kind === 'flower' && !ctx.flower) || idle.t >= idle.dur) {
      idle.kind = null; idle.cooldown = PET.idleGap[0];
    } else return idle.kind;
  }
  idle.cooldown -= dt;
  if (idle.stillFor < PET.idleAfter || (!ctx.sleepy && idle.cooldown > 0)) return null;
  const kinds = ctx.flower ? ['head', 'loop', 'flower'] : ['head', 'loop'];
  idle.kind = ctx.sleepy ? 'shoulder' : kinds[Math.min(kinds.length - 1, Math.floor(ctx.rng() * kinds.length))];
  idle.t = 0; idle.dur = PET.carle.idleLen[idle.kind]; idle.ang0 = ctx.angle; idle.side = ctx.rng() < 0.5 ? -1 : 1;
  return idle.kind;
}
export function carleIdleDrive(kind, u, ctx) {
  if (kind === 'loop') return idleDrive(kind, u, ctx);
  const o = ctx.owner, l = leftOf(o.facing || 0);
  const target = kind === 'flower' ? ctx.flower && { x: ctx.flower.x, y: ctx.flower.y + 0.25, z: ctx.flower.z }
    : kind === 'shoulder' ? { x: o.x + l.x * 0.34, y: o.y + PET.carle.shoulderY, z: o.z + l.z * 0.34 }
    : { x: o.x, y: o.y + PET.carle.headY, z: o.z };
  const w = Math.min(1, u / 0.2, (1 - u) / 0.18);
  return { target, w: Math.max(0, w), roll: 0, stiff: 2, yaw: o.facing || 0 };
}
