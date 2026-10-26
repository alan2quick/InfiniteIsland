// Bonk Burrows (Step 81b, party game 12; "Hammer Drop" lives only in the plan): a round molehill meadow beside the home bridge landing. Cobble the mole drops his giant striped squeaky toy mallet on the meadow: first
// one growing shadow at a time, then two or three at once, then whole rows landing one after another. A shadow grows for a clear warning time (its faint full-size ring is there from the start; the red core is where you
// are ALWAYS squashed), then the mallet lands. Inside the circle at the landing = squashed flat (a comic pancake, then you pop up on the spectator islet); a hop that is in the air at the landing saves you in the OUTER
// RING of the circle only. Dodging by walking is the main skill. Molehills block walking. The last one standing wins; everybody still up at 60 s wins together.
// PURE rules, deterministic from the host's seed and clock (Node-tested in test/partyBonk.test.js); the look is world/party/bonk.js.
//
// WHAT YOU SEE IS WHAT IS JUDGED: every slam is a circle of radius `hitR` at (x, z) that lands at time T (buildPlan(seed) is the whole schedule, the same on every screen); the stage draws the shadow's ring and the
// mallet head with exactly that radius, and the red core with radius `core` x hitR. The HOST judges at T + `lag` from each player's REAL position AT T (a short position history: a remote body's late packet cannot make
// someone who left in time look squashed) and from the hop's TIME WINDOW [at + airFrom, at + airTo], never from a raw height.
//
// Game module contract: see vineskipLogic.js. recs: { k: 'hop', slot, at } (a Jump press, the presser's clock clamped into the host's past) | { k: 'bonk', i, t, out: [slots] } (slam i landed; these players were
// squashed) | { k: 'out', slot, t } (debug) | { k: 'end', t, why }. State: alive[slot], outAt[slot], hops[slot] (the last hop's time), next (slams already judged), done, endAt.
import { PARTY } from '../../config.js';
import { mulberry32 } from '../../utils/rng.js';
import { stageCentre, bonkObstacles } from './partyArea.js';

const B = PARTY.bonk;
export const ID = 'bonk';
const r2 = (v) => Math.round(v * 100) / 100;
const lerp = (a, b, u) => a + (b - a) * u;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const ease = (u) => { const k = clamp(u, 0, 1); return k * k * (3 - 2 * k); };
export const HILLS = bonkObstacles();                                              // stage-local circles (colliders + drawn)
export const coreR = () => B.hitR * B.core;
/** The warning time of a shadow that lands at T. */
export const warnAt = (T) => r2(lerp(B.warn[0], B.warn[1], clamp(T / 48, 0, 1)));

const planCache = new Map();
/**
 * The whole schedule: slams[i] = { i, t0 (the shadow starts to grow), T (the mallet lands), x, z (stage-local), grp } sorted by T, plus end (the last landing). Patterns by time: singles, then pairs, then triples and
 * sweeping rows (five circles that land 0.3 s apart along a line). No slam is aimed at anybody: the seed alone decides.
 */
export function buildPlan(seed) {
  const key = seed >>> 0, hit = planCache.get(key);
  if (hit) return hit;
  const rng = mulberry32(key ^ 0xb04c3a), slams = [], R = B.meadowR;
  const spot = () => { const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * (R - 0.4); return { x: Math.cos(a) * r, z: Math.sin(a) * r }; };
  const far = (p, others) => others.every((o) => Math.hypot(p.x - o.x, p.z - o.z) > B.hitR * 1.7);
  let t = B.first, grp = 0, rows = 0;
  while (t < B.duration - 3) {
    const u = clamp(t / 50, 0, 1), warn = warnAt(t + 1.7), chosen = [];
    let count = t < 14 ? 1 : t < 26 ? 2 : t < 38 ? 3 : t < 48 ? 4 : 5, row = false;
    if (t >= 30 && ++rows % 3 === 0) { row = true; count = 5; }
    if (row) {
      const th = rng() * Math.PI, off = (rng() - 0.5) * 6, dx = Math.cos(th), dz = Math.sin(th), flip = rng() < 0.5 ? -1 : 1;
      for (let k = 0; k < count; k++) { const s = (k - (count - 1) / 2) * 3.4 * flip; chosen.push({ x: -dz * off + dx * s, z: dx * off + dz * s, dly: k * 0.3 }); }
    } else {
      for (let k = 0; k < count; k++) {
        let p = spot(), tries = 0;
        while (tries++ < 20 && !(far(p, chosen) && (slams.length > 0 || t > 3 || spawnFree(p)))) p = spot();
        chosen.push({ ...p, dly: k * 0.12 });
      }
    }
    for (const c of chosen) slams.push({ t0: r2(t + c.dly), T: r2(t + c.dly + warn), x: r2(c.x), z: r2(c.z), grp });
    grp++;
    t += lerp(row ? 3.0 : 1.7, 0.85, u) + (row ? 0.4 : 0);
  }
  slams.sort((a, b) => a.T - b.T || a.x - b.x);
  slams.forEach((s, i) => { s.i = i; });
  const plan = { seed: key, slams, end: slams.length ? slams[slams.length - 1].T : 0 };
  planCache.set(key, plan);
  return plan;
}
/** No seat's start spot is under the very first slam (the first shadow always lands clear of the starting ring, so no seat is favoured by luck). */
function spawnFree(p) {
  for (let k = 0; k < 4; k++) { const a = Math.PI / 4 + k * Math.PI / 2; if (Math.hypot(p.x - Math.cos(a) * B.spawnR, p.z - Math.sin(a) * B.spawnR) < B.hitR + 1.6) return false; }
  return true;
}

/** Is the player in the air (a hop) at time T? Judged from the hop's time window, never from y. */
export function airborne(g, slot, T) { const h = g.hops[slot]; return h !== undefined && T >= h + B.airFrom && T <= h + B.airTo; }
/** Squashed by slam s when at world (x, z), hopping or not? The ONE rule of the judgement (the tests compare it with the drawn circle). */
export function squashed(s, x, z, hopping) {
  const c = stageCentre(ID), d = Math.hypot(x - c.x - s.x, z - c.z - s.z);
  if (d > B.hitR) return false;
  return !(hopping && d > coreR());
}

export function init(seed, roster) {
  const slots = roster.map((p) => p.slot), alive = {};
  for (const s of slots) alive[s] = true;
  return { seed: seed >>> 0, slots, alive, outAt: {}, hops: {}, next: 0, done: false, endAt: null };
}

const memo = new WeakMap();                                         // HOST-private: the recent positions of every player (never in a record or a hash)
function nearestSample(list, T) {
  let best = null, bd = Infinity;
  for (const s of list) { const d = Math.abs(s.t - T); if (d < bd) { bd = d; best = s; } }
  return best;
}

export function step(g, ctx, dt, t) {
  if (g.done) return [];
  let mem = memo.get(g); if (!mem) memo.set(g, mem = {});
  for (const s of g.slots) {
    const p = ctx.pos ? ctx.pos(s) : null;
    if (!p || !Number.isFinite(p.x)) continue;
    const list = mem[s] ||= [];
    list.push({ t, x: p.x, z: p.z });
    while (list.length > 2 && list[0].t < t - 1.5) list.shift();
  }
  const plan = buildPlan(g.seed), recs = [], dead = new Set();
  for (let i = g.next; i < plan.slams.length; i++) {
    const s = plan.slams[i];
    if (t < s.T + B.lag) break;
    const out = [], near = {}, c = stageCentre(ID);
    for (const slot of g.slots) {
      if (!g.alive[slot] || dead.has(slot)) continue;
      const smp = mem[slot] ? nearestSample(mem[slot], s.T) : null;                // (an unknown position is never squashed)
      if (smp && squashed(s, smp.x, smp.z, airborne(g, slot, s.T))) { out.push(slot); dead.add(slot); }
      else if (smp) { const margin = r2(Math.hypot(smp.x - c.x - s.x, smp.z - c.z - s.z) - B.hitR); if (margin < 1.2) near[slot] = margin; }      // (how narrowly a survivor missed this slam; a hop that saved them is negative)
    }
    recs.push({ k: 'bonk', i, t: s.T, out, ...(Object.keys(near).length ? { near } : {}) });
  }
  const left = g.slots.filter((s) => g.alive[s] && !dead.has(s)).length;
  if (g.slots.length > 1 ? left <= 1 : left === 0) recs.push({ k: 'end', t: r2(t), why: 'last' });
  else if (t >= B.duration) recs.push({ k: 'end', t: r2(t), why: 'cap' });
  return recs;
}

function clampStamp(req, ctx) {
  const slack = ctx.slack ?? PARTY.slack, t = Number.isFinite(req && req.t) ? req.t : ctx.t;
  return r2(Math.min(ctx.t, Math.max(ctx.t - slack, t)));
}
export function request(g, slot, req, ctx) {
  if (g.done) return { ignore: true };
  if (!g.alive[slot]) return { reject: 'out' };
  const at = clampStamp(req, ctx), last = g.hops[slot];
  if (last !== undefined && at < last + B.cool) return { reject: 'cool' };
  return { rec: { k: 'hop', slot, at } };
}

export function apply(g, rec) {
  if (!rec) return g;
  if (rec.k === 'hop') g.hops[rec.slot] = rec.at;
  else if (rec.k === 'bonk') {
    for (const s of rec.out) if (g.alive[s]) { g.alive[s] = false; g.outAt[s] = rec.t; }
    g.next = Math.max(g.next, rec.i + 1);
    if (rec.near) { g.close ||= {}; for (const s in rec.near) g.close[s] = g.close[s] === undefined ? rec.near[s] : Math.min(g.close[s], rec.near[s]); }      // (Step 80e's bonus feat, "Closest call")
  } else if (rec.k === 'out') { if (g.alive[rec.slot]) { g.alive[rec.slot] = false; g.outAt[rec.slot] = rec.t; } }
  else if (rec.k === 'end') { g.done = true; g.endAt = rec.t; }
  return g;
}

/** Ranks: last one standing first (everybody still up at the end shares first); players squashed by the same landing share a place. */
export function placing(g) {
  const rows = g.slots.map((slot) => ({ slot, score: g.alive[slot] ? B.duration + 1 : g.outAt[slot], out: !g.alive[slot] }));
  return rows.map((r) => ({ ...r, place: 1 + rows.filter((o) => o.score > r.score + 1e-8).length })).sort((a, b) => a.place - b.place || a.slot - b.slot);
}

/** What the renderers and bots read: the slams that are visible now ({ ...slam, u (the shadow's growth 0..1), phase 'warn' | 'down' }). */
export function view(g, t = 0) {
  const plan = buildPlan(g.seed), slams = [];
  for (const s of plan.slams) {
    if (s.t0 > t) { if (s.T - 4 > t) break; continue; }
    if (t > s.T + B.keep) continue;
    slams.push({ ...s, u: ease((t - s.t0) / (s.T - s.t0)), phase: t < s.T ? 'warn' : 'down' });
  }
  return { t, seed: g.seed, slots: g.slots, alive: g.alive, outAt: g.outAt, hops: g.hops, next: g.next, done: g.done, slams, plan };
}

// ---------------------------------------------------------------------------------------------------------------- the bots
const speedMag = (skill) => clamp(skill.walk, 0.3, 1);
/**
 * A bot sees a shadow after skill.react s (+ noise), then walks to the nearest spot clear of every shadow it knows (and off the molehills). On easy it sometimes does not see a shadow at all (`miss`). When it cannot get
 * out in time and stands in the outer ring, a normal or hard bot hops right before the landing. Returns { x, y, jump? } (the stick + the hop).
 */
export function bot(v, me, skill, rng) {
  const out = { x: 0, y: 0 }, m = me.mem;
  if (m.seed !== v.seed) { m.seed = v.seed; m.seen = {}; m.hopped = -1; }
  if (!v.alive[me.slot] || v.done) return out;
  const c = stageCentre(ID), px = me.x - c.x, pz = me.z - c.z, known = [];
  for (const s of v.slams) {
    if (s.phase !== 'warn') continue;
    let k = m.seen[s.i];
    if (!k) {
      const gauss = (rng() + rng() + rng() - 1.5) * 1.15;
      k = m.seen[s.i] = { at: s.t0 + Math.max(0.05, skill.react * (0.85 + rng() * 0.3) + gauss * skill.noise), blind: rng() < skill.miss * B.botMiss };
    }
    if (v.t >= k.at && !k.blind) known.push(s);
  }
  const threats = known.filter((s) => Math.hypot(px - s.x, pz - s.z) <= B.hitR + 0.3);
  if (!threats.length) return wander(v, m, px, pz, known, rng, out);            // nothing over its head: stroll about the meadow instead of standing still
  const hard = skill.react < 0.3, margin = hard ? 0.55 : 0.35, speed = PARTY_SPEED(skill);
  let goal = null, bestCost = Infinity, bestClear = -Infinity, fallback = null;
  for (let a = 0; a < 24; a++) {
    const ang = a * Math.PI / 12;
    for (const r of [1, 1.8, 2.6, 3.4, 4.4, 5.6, 7]) {
      const x = px + Math.cos(ang) * r, z = pz + Math.sin(ang) * r;
      if (Math.hypot(x, z) > B.meadowR - 0.7 || HILLS.some((h) => Math.hypot(x - h.x, z - h.z) < h.r + 0.7)) continue;
      const clear = Math.min(...known.map((s) => Math.hypot(x - s.x, z - s.z) - B.hitR));
      if (clear > bestClear) { bestClear = clear; fallback = { x, z }; }
      if (clear > margin && r < bestCost) { bestCost = r; goal = { x, z, r }; }
    }
  }
  const tMin = Math.min(...threats.map((s) => s.T)) - v.t;
  if (goal) {
    const needTime = Math.max(0, goal.r - 0.2) / speed + 0.1;
    if (needTime > tMin + 0.05 && skill.react < 0.4 && threats.every((s) => Math.hypot(px - s.x, pz - s.z) > coreR() + 0.15)) hopMaybe(v, m, threats, out);
  } else goal = fallback;
  if (!goal) return out;
  const dx = goal.x - px, dz = goal.z - pz, d = Math.hypot(dx, dz) || 1, mag = speedMag(skill);
  out.x = dx / d * mag; out.y = -dz / d * mag;
  return out;
}
/**
 * An idle bot strolls the meadow: a fresh spot every few seconds (clear of the molehills and of every shadow it has seen), walked to at
 * `B.wander.pace` of a run, with a little pause at the spot. Real stick input; a shadow over the bot always wins (the dodge above).
 */
function wander(v, m, px, pz, known, rng, out) {
  const W = B.wander, t = v.t, w = m.wander;
  const ok = (x, z) => Math.hypot(x, z) <= B.meadowR - 1.6 && !HILLS.some((h) => Math.hypot(x - h.x, z - h.z) < h.r + 0.9) && known.every((s) => Math.hypot(x - s.x, z - s.z) > B.hitR + 0.8);
  const at = w && Math.hypot(w.x - px, w.z - pz) < 0.7;
  if (at && w.until === undefined) w.until = t + W.pause[0] + rng() * (W.pause[1] - W.pause[0]);
  if (!w || (at && t >= w.until) || t >= w.giveUp || !ok(w.x, w.z)) {
    for (let k = 0; k < 12; k++) {
      const a = rng() * Math.PI * 2, r = 1.5 + rng() * (B.meadowR - 3.4), x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (ok(x, z)) { m.wander = { x, z, giveUp: t + W.every[0] + rng() * (W.every[1] - W.every[0]) }; break; }
    }
    if (!m.wander || m.wander === w) return out;
  }
  const g = m.wander;
  if (Math.hypot(g.x - px, g.z - pz) < 0.7) return out;                       // resting at the spot for a moment
  const dx = g.x - px, dz = g.z - pz, d = Math.hypot(dx, dz) || 1;
  out.x = dx / d * W.pace; out.y = -dz / d * W.pace;
  return out;
}
const PARTY_SPEED = (skill) => (skill.walk <= 0.5 ? 3.5 * skill.walk / 0.5 : 3.5 + 3.5 * (skill.walk - 0.5) / 0.5);
function hopMaybe(v, m, threats, out) {
  const T = Math.min(...threats.map((s) => s.T)), lead = (B.airFrom + B.airTo) / 2 - 0.02;
  if (v.t >= T - lead && v.t < T - lead + 0.12 && m.hopped !== T) { m.hopped = T; out.jump = true; }
}

/** Debug: everybody but `slot` is squashed. */
export const debugWin = (g, slot, t) => g.slots.filter((s) => s !== slot && g.alive[s]).map((s) => ({ k: 'out', slot: s, t: r2(t) }));

export const GAME = {
  id: ID, name: 'Bonk Burrows', host: 'Cobble', stage: ID, track: ID, players: [1, 4], kind: 'elim', duration: B.duration, tail: B.tail,
  howto: { pitch: "Cobble swings his giant squeaky mallet! Run out of the growing shadows. If you can't get out, a hop saves you at the edge of the circle, but never in the red middle. Last one standing wins!", buttons: ['stick', 'jump'], verbs: { stick: 'Run', jump: 'Hop' } },
  press: ['jump'],
  init, step, request, apply, view, placing, bot, debugWin, lag: B.lag,
};
