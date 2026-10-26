// Puffball Bumpers (Step 80d): PURE host-simulated circle physics. init / step / request / apply / view / placing / bot follow the party registry contract.
// The host integrates held stick inputs in <= 1/120 s slices, resolves elastic impulses by mass, then broadcasts one `motion` record; replicas ONLY apply records.
// capRadius(t) is both the drawn cap's radius and the centre-off boundary. ballPose(g, slot, t) is the ONE avatar-foot pose used by the runtime and stage (the ball centre is one ballR lower).
// Jump is a little presentation hop: circles keep colliding on the cap, so hopping cannot hide an invisible collision rule. Every Jump restarts the hop immediately.
import { PARTY } from '../../config.js';
import { bumpersLanding } from './partyArea.js';
import { mulberry32 } from '../../utils/rng.js';

const S = PARTY.bumpers;
export const ID = 'bumpers';
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
// Start gently at 30 s, then tighten faster so the earlier warning still leaves about 45-60 s of play.
export const capRadius = (t) => S.radius - (S.radius - S.minRadius) * Math.pow(clamp((t - S.shrinkAt) / (S.duration - S.shrinkAt), 0, 1), S.shrinkPower);
export const offCap = (b, t) => Math.hypot(b.x, b.z) > capRadius(t);

export function init(seed, roster) {
  const rng = mulberry32(seed >>> 0), angle = rng() * Math.PI * 2, slots = roster.map((p) => p.slot), balls = {}, alive = {}, inputs = {};
  slots.forEach((s, i) => {
    const a = angle + i * Math.PI * 2 / slots.length, r = slots.length === 1 ? 0 : S.spawnR;
    balls[s] = { x: Math.cos(a) * r, z: Math.sin(a) * r, vx: 0, vz: 0, mass: S.mass, hopAt: -9, outAt: null, facing: Math.atan2(-Math.cos(a), -Math.sin(a)), gait: 0, bumpX: 0, bumpZ: 0, roll: [0, 0, 0, 1] };
    alive[s] = true; inputs[s] = { x: 0, z: 0 };
  });
  return { seed: seed >>> 0, slots, balls, alive, inputs, outAt: {}, simT: 0, bumps: 0, hits: {}, done: false, endAt: null };
}

/** Roll around the world axis perpendicular to actual centre travel. Left multiplication preserves direction changes; no rendered-frame clock is involved. */
export function rollQuaternion(q, dx, dz, radius = S.ballR) {
  const d = Math.hypot(dx, dz); if (d < 1e-12) return q.slice();
  const half = d / radius / 2, sn = Math.sin(half), ax = dz / d * sn, az = -dx / d * sn, aw = Math.cos(half);
  const [x, y, z, w] = q, next = [aw * x - az * y + ax * w, aw * y + az * x - ax * z, aw * z + ax * y + az * w, aw * w - ax * x - az * z];
  const n = Math.hypot(...next); return next.map((v) => v / n);
}
const angleDelta = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));
/** Facing follows the synced stick even when momentum goes the other way; release the stick and look along the drift. */
export function riderFacing(b, input, dt) {
  const stick = Math.hypot(input.x, input.z), speed = Math.hypot(b.vx, b.vz);
  const target = stick > 0.05 ? Math.atan2(input.x, input.z) : speed > 0.12 ? Math.atan2(b.vx, b.vz) : b.facing;
  return b.facing + angleDelta(b.facing, target) * (1 - Math.exp(-10 * dt));
}

/** In-place elastic collision. Return true only for an approaching pair; correction separates even resting overlaps without adding momentum. */
export function collide(a, b, radius = S.ballR) {
  let dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
  if (d > radius * 2) return false;
  if (d < 1e-10) { dx = 1; dz = 0; d = 0; }
  const nx = d ? dx / d : 1, nz = d ? dz / d : 0, ia = 1 / a.mass, ib = 1 / b.mass;
  const overlap = radius * 2 - d;
  a.x -= nx * overlap * ia / (ia + ib); a.z -= nz * overlap * ia / (ia + ib);
  b.x += nx * overlap * ib / (ia + ib); b.z += nz * overlap * ib / (ia + ib);
  const speed = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
  if (speed >= 0) return false;
  const impulse = -2 * speed / (ia + ib);
  a.vx -= impulse * nx * ia; a.vz -= impulse * nz * ia;
  b.vx += impulse * nx * ib; b.vz += impulse * nz * ib;
  return true;
}

export function request(g, slot, req, ctx) {
  if (g.done || !g.alive[slot]) return { ignore: true };
  if (!req || !Number.isFinite(req.x) || !Number.isFinite(req.z)) return { reject: 'input' };
  let x = clamp(req.x, -1, 1), z = clamp(req.z, -1, 1);
  const n = Math.hypot(x, z); if (n > 1) { x /= n; z /= n; }
  return { rec: { k: 'input', slot, x, z, jump: !!req.jump, t: ctx.t } };
}

export function step(g, ctx, dt, t) {
  if (g.done || t <= g.simT) return [];
  const balls = Object.fromEntries(g.slots.map((s) => [s, { ...g.balls[s] }])), alive = { ...g.alive }, outAt = { ...g.outAt };
  // A slice displaces the fastest approaching pair by <= .15 u, far less than the 2 u diameter: no tunnelling at maximum speed.
  const end = Math.min(t, S.duration), slices = Math.max(1, Math.ceil((end - g.simT) * 120)), h = (end - g.simT) / slices;
  let bumps = g.bumps;
  const hits = { ...(g.hits || {}) };
  for (let k = 0; k < slices; k++) {
    const at = g.simT + (k + 1) * h, previous = {};
    for (const s of g.slots) {
      if (!alive[s]) continue;
      const b = balls[s], input = g.inputs[s];
      previous[s] = { x: b.x, z: b.z };
      b.bumpX *= Math.exp(-8 * h); b.bumpZ *= Math.exp(-8 * h);
      b.vx = (b.vx + input.x * S.accel * h) * Math.exp(-S.drag * h);
      b.vz = (b.vz + input.z * S.accel * h) * Math.exp(-S.drag * h);
      const speed = Math.hypot(b.vx, b.vz);
      if (speed > S.maxSpeed) { b.vx *= S.maxSpeed / speed; b.vz *= S.maxSpeed / speed; }
      b.x += b.vx * h; b.z += b.vz * h;
      b.facing = riderFacing(b, input, h);
      b.gait += (b.vx * Math.sin(b.facing) + b.vz * Math.cos(b.facing)) * h * 2.05;
    }
    for (let i = 0; i < g.slots.length; i++) for (let j = i + 1; j < g.slots.length; j++) {
      const a = g.slots[i], b = g.slots[j];
      if (alive[a] && alive[b]) {
        const va = { x: balls[a].vx, z: balls[a].vz }, vb = { x: balls[b].vx, z: balls[b].vz };
        if (collide(balls[a], balls[b])) {
          bumps++; hits[a] = (hits[a] || 0) + 1; hits[b] = (hits[b] || 0) + 1;
          balls[a].bumpX = clamp(balls[a].bumpX + (balls[a].vx - va.x) * 0.045, -0.32, 0.32);
          balls[a].bumpZ = clamp(balls[a].bumpZ + (balls[a].vz - va.z) * 0.045, -0.32, 0.32);
          balls[b].bumpX = clamp(balls[b].bumpX + (balls[b].vx - vb.x) * 0.045, -0.32, 0.32);
          balls[b].bumpZ = clamp(balls[b].bumpZ + (balls[b].vz - vb.z) * 0.045, -0.32, 0.32);
        }
      }
    }
    for (const s of g.slots) if (previous[s]) {
      const b = balls[s]; b.roll = rollQuaternion(b.roll, b.x - previous[s].x, b.z - previous[s].z);
    }
    for (const s of g.slots) if (alive[s] && offCap(balls[s], at)) { alive[s] = false; outAt[s] = at; balls[s].outAt = at; }
  }
  const done = (g.slots.length > 1 && g.slots.filter((s) => alive[s]).length <= 1) || end >= S.duration;
  return [{ k: 'motion', balls, alive, outAt, bumps, hits, t: end, done }];
}

export function apply(g, rec) {
  if (rec.k === 'input' && g.inputs[rec.slot]) {
    g.inputs[rec.slot] = { x: rec.x, z: rec.z };
    if (rec.jump) g.balls[rec.slot].hopAt = rec.t;
  } else if (rec.k === 'motion') {
    g.balls = rec.balls; g.alive = rec.alive; g.outAt = rec.outAt; g.bumps = rec.bumps; g.simT = rec.t; if (rec.hits) g.hits = rec.hits;      // (hits: Step 80e's bonus feat, "Most bumps")
    g.done = rec.done; if (rec.done) g.endAt = rec.t;
  } else if (rec.k === 'end') { g.done = true; g.endAt = rec.t;
  } else if (rec.k === 'out' && g.alive[rec.slot]) {
    g.alive[rec.slot] = false; g.outAt[rec.slot] = rec.t; g.balls[rec.slot].outAt = rec.t;
  }
  return g;
}

/** Whether the presentation-only drift has finished; spectator movement never enters physics state. */
export const landed = (g, slot, t) => g.balls[slot]?.outAt != null && t >= g.balls[slot].outAt + S.spectator.drift;

/** Avatar feet sit on top of the puffball. A fallen rider gently drifts to their clear marsh landing; after landing the runtime releases ordinary own-body movement. */
export function ballPose(g, slot, t = g.simT) {
  const b = g.balls[slot]; if (!b) return null;
  if (b.outAt !== null) {
    const age = Math.max(0, t - b.outAt), u = clamp(age / S.spectator.drift, 0, 1), k = u * u * (3 - 2 * u), spot = bumpersLanding(slot);
    const drift = (1 - Math.exp(-age * 1.5)) / 1.5 * (1 - k);
    return { x: b.x * (1-k) + spot.x * k + b.vx * drift, z: b.z * (1-k) + spot.z * k + b.vz * drift,
      y: 2 * S.ballR + (spot.y - 2 * S.ballR) * k, out: true, landed: u >= 1 };
  }
  const u = clamp((t - b.hopAt) / S.hop, 0, 1);
  return { x: b.x, z: b.z, y: 2 * S.ballR + Math.sin(Math.PI * u) * 0.55, out: false };
}

export function placing(g) {
  const scores = g.slots.map((slot) => ({ slot, score: g.alive[slot] ? S.duration + 1 : g.outAt[slot], out: !g.alive[slot] }));
  return scores.map((r) => ({ ...r, place: 1 + scores.filter((p) => p.score > r.score + 1e-8).length })).sort((a, b) => a.place - b.place || a.slot - b.slot);
}
export const view = (g, t = g.simT) => ({ ...g, t });

/** The bot reads visible circles and velocity, with a reaction interval and noisy steering. Easy riders oversteer and forget to brake; hard riders countersteer early and approach from the safer centre. */
export function bot(v, me, skill, rng) {
  const out = { x: 0, y: 0 }, b = v.balls[me.slot], m = me.mem;
  if (m.bumperSeed !== v.seed || v.t < (m.bumperT ?? -1)) { m.next = -1; m.intent = out; m.bumperSeed = v.seed; }
  m.bumperT = v.t;
  if (!b || !v.alive[me.slot] || v.done) return out;
  if (v.t < (m.next ?? -1)) return m.intent || out;
  m.next = v.t + skill.react;
  const easy = skill.walk < 0.65, hard = skill.walk > 0.9;
  const r = capRadius(v.t), d = Math.hypot(b.x, b.z), others = v.slots.filter((s) => s !== me.slot && v.alive[s]).map((s) => v.balls[s]);
  const target = others.sort((a, c) => Math.hypot(a.x - b.x, a.z - b.z) - Math.hypot(c.x - b.x, c.z - b.z))[0];
  let x = -b.x * (hard ? 0.9 : 0.45) - b.vx * (hard ? 1.7 : 0.65), z = -b.z * (hard ? 0.9 : 0.45) - b.vz * (hard ? 1.7 : 0.65);
  if (target && (easy || d < r * 0.55)) {
    const tx = target.x - b.x, tz = target.z - b.z, td = Math.hypot(tx, tz) || 1;
    x += tx / td * (hard ? 6 : 4); z += tz / td * (hard ? 6 : 4);
  }
  if (easy && rng() < skill.miss) { x = b.vx * 2 + (rng() - 0.5) * 8; z = b.vz * 2 + (rng() - 0.5) * 8; }
  x += (rng() - 0.5) * skill.noise * 12; z += (rng() - 0.5) * skill.noise * 12;
  const n = Math.max(1, Math.hypot(x, z));
  m.intent = { x: x / n * skill.walk, y: -z / n * skill.walk };
  return m.intent;
}
export const debugWin = (g, slot, t) => g.slots.filter((s) => s !== slot && g.alive[s]).map((s) => ({ k: 'out', slot: s, t }));
export const GAME = {
  id: ID, name: 'Puffball Bumpers', host: 'Capray', stage: ID, track: ID, players: [1, 4], kind: 'elim', duration: S.duration, tail: S.tail,
  howto: { pitch: 'Roll your glowing puffball and gently bump your friends! Stay on the big mushroom. Jump for a little hop. Fall off? Land below and walk around to cheer. Last one on wins!', buttons: ['stick', 'jump'], verbs: { stick: 'Roll', jump: 'Little hop' } },
  press: ['jump'], init, step, request, apply, view, placing, bot, debugWin, lag: 0,
};
