// Pure rules for the pets (PLAN Step 73a). No three.js, so Node can test them (test/pets.test.js). The runtime is world/pets.js, the model npc/pets.js, the unlock domain game/petsDomain.js.
//
// IDS AND THE WIRE
//   PET_IDS                      ['capray', 'carle'] in registry order (npc/pets.js PETS has the same order; a test pins it). A pet's pose-packet id is 1 + its index, 0 = none (field 16, older packets decode as none)
//   encodePetId(index) / decodePetId(id)   pose id <-> index in PET_IDS (-1 = none)
//   petIndexOf(id) / petIdAt(i)            string id <-> index (-1 / null when unknown)
//   normaliseUnlocked(raw)       a saved / received list made safe: known ids only, unique, in registry order
//   mergeUnlocked(a, b)          a NEW normalised list; clampPet(id, unlocked) the id when it is unlocked, else null (the per-screen choice falls back to none)
//   parsePetPrefs(json)          the per-screen { slotIndex: petId } choices, sanitised ('infiniteIsland.pets')
//
// MOTION (all lengths in units, times in seconds; the numbers are PET in config.js). A pet FLIES, so none of this knows about colliders or paths.
//   glideTarget({ ground, t, phase, sleepy, settle })   the hover height: above max(ground, WATER_LEVEL), eased by a slow bob; lower over water, when sleepy and when settled
//   heelPoint(owner, slot, { settle })                  where the pet wants to be: behind the owner and to the owner's LEFT, mirrored for odd slots so two pets never stack
//   followStep(s, target, tv, dt, { catching })         one damped-spring step of the pet state s = { x, y, z, vx, vy, vz } toward target moving at tv (velocity feed-forward: no lag at a steady run)
//   catchState(dist) / shouldPoof(dist)                 the swoop (past PET.catchUp) and the poof (past PET.lost: regroup, travel, boat arrival, teleport)
//   poseStep(pose, vel, lookYaw, dt)                    heading, roll (banking into turns) and pitch from the velocity; pose = { yaw, roll, pitch }
//   petMood({ nightness, duskWeight })                  'sleepy' at night away from Duskcrown, else 'awake'
// IDLES while the owner stands still: roll (a barrel roll), loop (a loop around the owner), nuzzle, head (rests its tail cap on the owner's head), hide (Duskcrown only: under the nearest giant cap).
//   createIdle(seed) -> idle state;  stepIdle(idle, dt, ctx) advances it and returns the kind that is running (or null);  idleDrive(kind, u, ctx) -> { target, w, roll, stiff, yaw }
import { PET, WATER_LEVEL } from '../config.js';

export const PET_IDS = ['capray', 'carle'];
export const NO_PET = -1;
export const IDLE_KINDS = ['roll', 'loop', 'nuzzle', 'head', 'hide'];

export const petIndexOf = (id) => PET_IDS.indexOf(id);
export const petIdAt = (i) => (Number.isInteger(i) && i >= 0 && i < PET_IDS.length ? PET_IDS[i] : null);
export const encodePetId = (i) => (Number.isInteger(i) && i >= 0 && i < PET_IDS.length ? 1 + i : 0);
export function decodePetId(id) {
  const n = Number(id) | 0;
  return n >= 1 && n <= PET_IDS.length ? n - 1 : NO_PET;
}

export const normaliseUnlocked = (raw) => (Array.isArray(raw) ? PET_IDS.filter((id) => raw.includes(id)) : []);
export const mergeUnlocked = (a, b) => normaliseUnlocked([...(a || []), ...(b || [])]);
export const clampPet = (id, unlocked) => (typeof id === 'string' && PET_IDS.includes(id) && (unlocked || []).includes(id) ? id : null);

export function parsePetPrefs(text) {
  let d = null;
  try { d = typeof text === 'string' ? JSON.parse(text) : text; } catch { d = null; }
  const out = {};
  if (d && typeof d === 'object' && !Array.isArray(d)) {
    for (const [k, v] of Object.entries(d)) if (/^[0-3]$/.test(k) && typeof v === 'string' && PET_IDS.includes(v)) out[k] = v;
  }
  return out;
}

// ---- motion ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
const lerp = (a, b, k) => a + (b - a) * k;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const smooth = (u) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };

/** Hover height (absolute y). `ground` is the terrain height under the pet; below WATER_LEVEL it skims the water instead. */
export function glideTarget({ ground, t = 0, phase = 0, sleepy = false, settle = false, cfg = PET }) {
  const water = ground < WATER_LEVEL - 0.05;
  const surface = Math.max(ground, WATER_LEVEL);
  let h = water ? cfg.waterGlide : lerp(cfg.glideMin, cfg.glideMax, 0.5 + 0.5 * Math.sin(t * 0.9 + phase));
  if (settle) h *= 0.78;
  if (sleepy) h *= cfg.sleepyScale;
  return surface + h;
}

/** The owner's forward and left unit vectors on the ground (the character faces +Z at facing 0; its left is +X). */
export const forwardOf = (facing) => ({ x: Math.sin(facing), z: Math.cos(facing) });
export const leftOf = (facing) => ({ x: Math.cos(facing), z: -Math.sin(facing) });

/** The heel point (x, z): behind the owner and to its left; odd slots mirror to the right so two neighbours' pets do not stack. */
export function heelPoint(owner, slot = 0, { settle = false, cfg = PET } = {}) {
  const f = forwardOf(owner.facing || 0), l = leftOf(owner.facing || 0);
  const back = settle ? cfg.settleBack : cfg.heelBack, side = (settle ? cfg.settleSide : cfg.heelSide) * ((slot | 0) % 2 === 0 ? 1 : -1);
  return { x: owner.x - f.x * back + l.x * side, z: owner.z - f.z * back + l.z * side };
}

export const catchState = (dist, cfg = PET) => dist > cfg.catchUp;
export const shouldPoof = (dist, cfg = PET) => dist > cfg.lost;

/** One damped-spring step. Horizontal uses `k`, the vertical axis is softer so the glide stays graceful. Speed is capped (cruise or swoop). Mutates s. */
export function followStep(s, target, tv, dt, { catching = false, slow = 1, cfg = PET } = {}) {
  dt = Math.min(dt, 1 / 20);
  const k = cfg.spring * (catching ? 2.4 : 1), c = 2 * cfg.damping * Math.sqrt(k);
  const ky = k * 0.7, cy = 2 * cfg.damping * Math.sqrt(ky);
  const ax = k * (target.x - s.x) + c * ((tv.x || 0) - s.vx);
  const az = k * (target.z - s.z) + c * ((tv.z || 0) - s.vz);
  const ay = ky * (target.y - s.y) + cy * ((tv.y || 0) - s.vy);
  s.vx += ax * dt; s.vy += ay * dt; s.vz += az * dt;
  const limit = (catching ? cfg.catchSpeed : cfg.maxSpeed) * slow;
  const h = Math.hypot(s.vx, s.vz);
  if (h > limit) { s.vx *= limit / h; s.vz *= limit / h; }
  s.vy = clamp(s.vy, -limit, limit);
  s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
  return s;
}

/** Heading follows the velocity while moving (else lookYaw, if given); roll banks into the turn, pitch follows the climb. Mutates pose { yaw, roll, pitch, yawRate }. */
export function poseStep(pose, vel, lookYaw, dt, cfg = PET) {
  const speed = Math.hypot(vel.vx, vel.vz);
  let want = pose.yaw;
  if (speed > 0.9) want = Math.atan2(vel.vx, vel.vz); else if (lookYaw !== null && lookYaw !== undefined) want = lookYaw;
  const d = wrap(want - pose.yaw), k = 1 - Math.exp(-cfg.turnRate * dt);
  const step = d * k;
  pose.yaw = wrap(pose.yaw + step);
  const rate = dt > 0 ? step / dt : 0;
  pose.yawRate = lerp(pose.yawRate || 0, rate, 1 - Math.exp(-10 * dt));
  const rollWant = clamp(-pose.yawRate * cfg.bankGain, -cfg.bankMax, cfg.bankMax);
  pose.roll = lerp(pose.roll || 0, rollWant, 1 - Math.exp(-8 * dt));
  const pitchWant = clamp(-vel.vy * cfg.pitchGain, -cfg.pitchMax, cfg.pitchMax);
  pose.pitch = lerp(pose.pitch || 0, pitchWant, 1 - Math.exp(-8 * dt));
  return pose;
}

export const petMood = ({ nightness = 0, duskWeight = 0 } = {}, cfg = PET) => (nightness > cfg.sleepyNight && duskWeight < 0.5 ? 'sleepy' : 'awake');

/** Scale-in after a poof: a squash-and-stretch overshoot, 0 at t = 0 and 1 from t >= PET.appear on. */
export function appearScale(t, cfg = PET) {
  if (t <= 0) return 0;
  if (t >= cfg.appear) return 1;
  const u = t / cfg.appear;
  return 1 + (smooth(u) - 1) * 0.9 + Math.sin(u * Math.PI) * 0.18 - (1 - smooth(u)) * 0.1;
}

// ---- idles ----------------------------------------------------------------------------------------------------------------------------------------------------------------------
export function createIdle(rng = Math.random, cfg = PET) {
  return { kind: null, t: 0, dur: 0, stillFor: 0, cooldown: cfg.idleGap[0] * 0.5 + rng() * 2, ang0: 0, side: 1 };
}

const WEIGHTS = { roll: 3, loop: 3, nuzzle: 2, head: 1.5, hide: 4 };
/** Pick an idle: hide only when a giant cap is near (Duskcrown); a sleepy pet only does the quiet ones. */
export function pickIdle(rng, { hide = false, sleepy = false } = {}) {
  const kinds = IDLE_KINDS.filter((k) => (k !== 'hide' || hide) && (!sleepy || k === 'nuzzle' || k === 'head' || k === 'hide'));
  let total = 0;
  for (const k of kinds) total += WEIGHTS[k];
  let r = rng() * total;
  for (const k of kinds) { r -= WEIGHTS[k]; if (r <= 0) return k; }
  return kinds[kinds.length - 1];
}

/**
 * Advance an idle state. ctx = { ownerStill, canIdle, hide (bool), sleepy, angle (the pet's angle around the owner, atan2(dx, dz)), rng, cfg }.
 * Returns the running kind (or null). Walking away cancels everything except a started barrel roll (it is short).
 */
export function stepIdle(idle, dt, ctx) {
  const cfg = ctx.cfg || PET, rng = ctx.rng || Math.random;
  if (ctx.ownerStill && ctx.canIdle) idle.stillFor += dt; else idle.stillFor = 0;
  if (idle.kind) {
    if (!ctx.canIdle || (!ctx.ownerStill && idle.kind !== 'roll')) { idle.kind = null; idle.cooldown = cfg.idleGap[0] * 0.4; return null; }
    idle.t += dt;
    if (idle.t >= idle.dur) { idle.kind = null; idle.cooldown = cfg.idleGap[0] + rng() * (cfg.idleGap[1] - cfg.idleGap[0]); return null; }
    return idle.kind;
  }
  idle.cooldown -= dt;
  if (ctx.canIdle && idle.stillFor >= cfg.idleAfter && idle.cooldown <= 0) {
    idle.kind = pickIdle(rng, { hide: !!ctx.hide, sleepy: !!ctx.sleepy });
    idle.t = 0; idle.dur = cfg.idleLen[idle.kind];
    idle.ang0 = ctx.angle || 0;
    idle.side = rng() < 0.5 ? -1 : 1;
    return idle.kind;
  }
  return null;
}

const bump = (u, a = 0.22, b = 0.2) => (u < a ? smooth(u / a) : u > 1 - b ? smooth((1 - u) / b) : 1);   // ease in, hold, ease out

/**
 * What an idle asks for at progress u (0..1). ctx = { owner { x, y, z, facing }, heel { x, z }, hideSpot { x, y, z } | null, idle, cfg }.
 * Returns { target: {x,y,z} | null (null = keep following the heel), w: 0..1 blend toward the target, roll, stiff: spring multiplier, yaw: heading override or null }.
 */
export function idleDrive(kind, u, ctx) {
  const cfg = ctx.cfg || PET, o = ctx.owner, idle = ctx.idle || { ang0: 0, side: 1 };
  const f = forwardOf(o.facing || 0), l = leftOf(o.facing || 0);
  switch (kind) {
    case 'roll': return { target: null, w: 0, roll: idle.side * Math.PI * 2 * smooth(u), stiff: 1, yaw: null };
    case 'loop': {
      const a = idle.ang0 + idle.side * Math.PI * 2 * smooth(u), r = cfg.loopRadius * bump(u, 0.18, 0.18) + (ctx.heelDist || 1.4) * (1 - bump(u, 0.18, 0.18));
      return { target: { x: o.x + Math.sin(a) * r, y: o.y + 1.4 + 0.25 * Math.sin(u * Math.PI * 2), z: o.z + Math.cos(a) * r }, w: bump(u, 0.12, 0.12), roll: 0, stiff: 1.8, yaw: null };
    }
    case 'nuzzle': {
      const e = Math.sin(clamp(u, 0, 1) * Math.PI);
      const wob = 0.05 * Math.sin(u * Math.PI * 8) * e;
      return { target: { x: o.x + l.x * 0.38 + f.x * 0.3, y: o.y + 1.25 + wob, z: o.z + l.z * 0.38 + f.z * 0.3 }, w: smooth(e * 1.4), roll: 0.25 * Math.sin(u * Math.PI * 6) * e, stiff: 1.3, yaw: Math.atan2(-l.x, -l.z) };
    }
    case 'head': {
      // the pet floats just in front of the owner's head, facing the same way, so its tail (which trails behind it) lies with its cap on top of the head
      const wob = 0.03 * Math.sin(u * Math.PI * 10);
      return { target: { x: o.x + f.x * 0.9, y: o.y + 2.0 + wob, z: o.z + f.z * 0.9 }, w: bump(u, 0.22, 0.18), roll: 0, stiff: 1.2, yaw: o.facing || 0 };
    }
    case 'hide': {
      const s = ctx.hideSpot;
      if (!s) return { target: null, w: 0, roll: 0, stiff: 1, yaw: null };
      return { target: { x: s.x, y: s.y + 0.06 * Math.sin(u * Math.PI * 6), z: s.z }, w: bump(u, 0.3, 0.25), roll: 0, stiff: 1.4, yaw: null };
    }
    default: return { target: null, w: 0, roll: 0, stiff: 1, yaw: null };
  }
}

/** Where to tuck in under a giant mushroom cap (item = a duskPlacement record: x, z, y = ground, capUnder, capR, baseR). The spot lies toward `toward`, under the rim. */
export function hideSpotOf(item, toward) {
  if (!item) return null;
  const dx = toward.x - item.x, dz = toward.z - item.z, d = Math.hypot(dx, dz) || 1;
  const r = Math.max(item.baseR + 0.5, item.capR * 0.55);
  return { x: item.x + (dx / d) * r, z: item.z + (dz / d) * r, y: Math.max(item.y + 1.1, Math.min(item.capUnder - 1.0, item.y + 2.6)) };
}

/** The nearest giant (not titan) mushroom within `range` of (x, z), or null. `items` = duskPlacement items. */
export function nearestGiant(items, x, z, range = PET.hideRange) {
  let best = null, bd = range;
  for (const it of items || []) {
    if (it.kind === 'titan') continue;
    const d = Math.hypot(it.x - x, it.z - z);
    if (d < bd) { bd = d; best = it; }
  }
  return best;
}
