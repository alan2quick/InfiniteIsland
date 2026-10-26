// Vine Skip (Step 80a, party game 1; "Hot Rope Jump" lives only in the plan): Im Nabong and Mokuring stand on two basalt posts and swing a long glowing Night-Bloom vine round a terrace at ankle height; the players
// stand on the terrace (they may walk a little) and Jump over it. PURE rules, deterministic from the host's seed and clock (Node-tested in test/partyVineSkip.test.js); the look is world/party/vineskip.js.
//
// The vine is a LINE through the terrace's centre (it is held at both ends). Its angle is a pure function of the game clock (`ropeAngle(sched, t)`), built once from the seed: a slow warm-up, then a faster speed every
// PARTY.vineskip.step seconds, and from 30 s Mokuring's surprises (a pause-and-go, a reverse), telegraphed `warn` s ahead. A player at polar angle phi and radius r is touched when the vine passes over that angle
// (|angle difference| * r <= reach) while their feet are on the ground. AIRBORNE is judged from the jump time window [at + airFrom, at + airTo], never from a raw y (the host does not know y). Last one standing wins;
// everybody still up at `cap` seconds wins together.
//
// Game module contract (game/party/registry.js): init(seed, roster) -> g | step(g, ctx, dt, t) -> recs | request(g, slot, req, ctx) -> rec | { reject } | { ignore } | apply(g, rec) | view(g) | placing(g) -> ranks | bot(view, me, skill, rng) -> intent
//   ctx = { t (host game seconds), pos(slot) -> { x, z } | null (WORLD x / z), slack, lag }.  State g is JSON; it only changes through apply(), so a replica that applies the same recs holds the same state.
//   recs: { k: 'jump', slot, at } | { k: 'out', slot, t } | { k: 'end', t }
import { PARTY } from '../../config.js';
import { mulberry32 } from '../../utils/rng.js';
import { stageCentre } from './partyArea.js';

const V = PARTY.vineskip;
export const ID = 'vineskip';
export const HIT_FROM = 1.0;                                  // the vine cannot touch anybody before this (the warm-up)
export const TIE = 0.021;                                     // two outs this close (s) are one tie
const SUB = 1 / 120;                                          // the host judges contact in steps this fine (the vine moves ~0.08 u per step at full speed)
const r2 = (v) => Math.round(v * 100) / 100;
const TAU = Math.PI;                                          // the vine is a LINE: angles repeat every pi

/** Angle folded into (-pi/2, pi/2]. */
export function wrapHalf(a) {
  a = a % TAU;
  if (a > TAU / 2) a -= TAU; else if (a <= -TAU / 2) a += TAU;
  return a;
}

const schedCache = new Map();
/** The vine's whole story from a seed: segments [{ t0, t1, w, th0 }] (constant angular speed w, signed), and the surprises [{ at, kind, warnAt }]. */
export function buildSchedule(seed) {
  const key = seed >>> 0;
  const cached = schedCache.get(key);
  if (cached) return cached;
  const rng = mulberry32(key ^ 0x51ed27);
  const end = V.cap + 12, steps = [];
  const warm = { w: 0.9, until: 2.0 };        // (a slow warm-up: the vine is seen, and cannot touch anybody before HIT_FROM)
  const first = Math.floor(rng() * 2);
  const surprises = V.surprises.map((at, i) => ({ at: r2(at + (rng() - 0.5) * 3), kind: (i + first) % 2 === 0 ? 'pause' : 'reverse' }));
  surprises.sort((a, b) => a.at - b.at);
  for (const s of surprises) s.warnAt = r2(s.at - V.warn);
  const cuts = new Set([0, warm.until, end]);
  for (let k = 1; k * V.step < end; k++) cuts.add(k * V.step);
  for (const s of surprises) { cuts.add(s.at); if (s.kind === 'pause') cuts.add(r2(s.at + V.pause)); }
  const times = [...cuts].sort((a, b) => a - b);
  const segs = [];
  let th = 0;
  const base = (t) => (t < warm.until ? warm.w : V.speeds[Math.min(V.speeds.length - 1, Math.floor(t / V.step))]);
  for (let i = 0; i < times.length - 1; i++) {
    const t0 = times[i], t1 = times[i + 1], mid = (t0 + t1) / 2;
    let dir = 1;
    for (const s of surprises) if (s.kind === 'reverse' && mid >= s.at) dir *= -1;
    const paused = surprises.some((s) => s.kind === 'pause' && mid >= s.at && mid < s.at + V.pause);
    segs.push({ t0, t1, w: paused ? 0 : base(mid) * dir, th0: 0 });
  }
  // the vine must be at angle ~0 when contact starts, so no spawn spot (pi/4 or 3pi/4 mod pi) is touched at once
  let acc = 0;
  for (const s of segs) { s.th0 = acc; acc += s.w * (s.t1 - s.t0); }
  const at = (t) => { for (const s of segs) if (t < s.t1) return s.th0 + s.w * (t - s.t0); return acc; };
  const shift = -at(HIT_FROM) + (rng() - 0.5) * 0.2;
  for (const s of segs) s.th0 += shift;
  const out = { seed: key, segs, surprises, end };
  schedCache.set(key, out);
  return out;
}

/** The vine's angle (radians, any multiple of pi is the same line) at game time t. */
export function ropeAngle(sched, t) {
  const segs = sched.segs;
  if (t <= 0) return segs[0].th0;
  for (let i = 0; i < segs.length; i++) { const s = segs[i]; if (t < s.t1) return s.th0 + s.w * (t - s.t0); }
  const l = segs[segs.length - 1];
  return l.th0 + l.w * (l.t1 - l.t0);
}
export function ropeSpeed(sched, t) {
  for (const s of sched.segs) if (t < s.t1) return s.w;
  return sched.segs[sched.segs.length - 1].w;
}

/** Stage-local polar coordinates of a world point. */
export function polar(x, z) {
  const c = stageCentre(ID), dx = x - c.x, dz = z - c.z;
  return { r: Math.hypot(dx, dz), phi: Math.atan2(dz, dx) };
}

export function airborne(g, slot, t) {
  const j = g.jumps[slot];
  return j !== undefined && t >= j + V.airFrom && t <= j + V.airTo;
}

/** Is the vine on top of a player at (r, phi) at time t (feet on the ground assumed)? */
export function touching(sched, r, phi, t) {
  const rr = Math.max(r, V.rMin * 0.9);
  return Math.abs(wrapHalf(phi - ropeAngle(sched, t))) * rr <= V.reach;
}

/** The next time (> from, <= to) the vine centre crosses angle phi, or null; sampled finely (the bot's eyes: it only looks a short way ahead). */
export function nextPass(sched, phi, from, to) {
  let prev = wrapHalf(phi - ropeAngle(sched, from));
  for (let t = from + SUB * 2; t <= to; t += SUB * 2) {
    const d = wrapHalf(phi - ropeAngle(sched, t));
    if ((prev > 0) !== (d > 0) && Math.abs(prev - d) < 1.5) return r2((t - SUB));
    if (Math.abs(d) < 1e-9) return r2(t);
    prev = d;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------- the game
export function init(seed, roster) {
  const slots = roster.map((p) => p.slot);
  const alive = {};
  for (const s of slots) alive[s] = true;
  return { seed: seed >>> 0, slots, alive, outAt: {}, jumps: {}, hopN: {}, done: false, endAt: null, hits: 0 };
}

const aliveSlots = (g) => g.slots.filter((s) => g.alive[s]);

export function step(g, ctx, dt, t) {
  if (g.done) return [];
  const recs = [];
  const sched = buildSchedule(g.seed), lag = ctx.lag ?? V.lag;
  const hit = new Set();
  const from = Math.max(HIT_FROM, t - dt - lag), to = t - lag;
  if (to > from) {
    for (let tt = from; tt <= to + 1e-9; tt += SUB) {
      for (const s of aliveSlots(g)) {
        if (hit.has(s)) continue;
        const p = ctx.pos ? ctx.pos(s) : null;
        if (!p) continue;
        const { r, phi } = polar(p.x, p.z);
        if (r > V.rMax + 0.8 || r < V.rMin - 0.8) continue;                      // on the rim (cheering) or off the terrace: never touched
        if (airborne(g, s, tt)) continue;
        if (touching(sched, r, phi, tt)) { hit.add(s); recs.push({ k: 'out', slot: s, t: r2(tt) }); }
      }
    }
  }
  // the end: one (or none, when the last ones fell together) left of several, or the clock ran out
  const left = aliveSlots(g).filter((s) => !hit.has(s)).length;
  if (g.slots.length > 1 ? left <= 1 : left === 0) recs.push({ k: 'end', t: r2(t), why: 'last' });
  else if (t >= V.cap) recs.push({ k: 'end', t: r2(t), why: 'cap' });
  return recs;
}

export function clampStamp(req, ctx) {
  const slack = ctx.slack ?? PARTY.slack;
  const t = Number.isFinite(req && req.t) ? req.t : ctx.t;
  return r2(Math.min(ctx.t, Math.max(ctx.t - slack, t)));
}

export function request(g, slot, req, ctx) {
  if (g.done) return { ignore: true };
  if (!g.alive[slot]) return { reject: 'out' };
  const at = clampStamp(req, ctx), last = g.jumps[slot];
  if (last !== undefined && at < last + V.cool) return { reject: 'cool' };
  return { rec: { k: 'jump', slot, at } };
}

export function apply(g, rec) {
  if (!rec) return g;
  if (rec.k === 'jump') { g.jumps[rec.slot] = rec.at; g.hopN ||= {}; g.hopN[rec.slot] = (g.hopN[rec.slot] || 0) + 1; }      // (hopN: Step 80e's bonus feat, "Most hops")
  else if (rec.k === 'out') { if (g.alive[rec.slot]) { g.alive[rec.slot] = false; g.outAt[rec.slot] = rec.t; g.hits++; } }
  else if (rec.k === 'end') { g.done = true; g.endAt = rec.t; }
  return g;
}

/** Ranks: last one standing first; outs closer than TIE share a place; everybody who is still up at the end shares first. */
export function placing(g) {
  const rows = g.slots.map((slot) => ({ slot, out: !g.alive[slot], at: g.alive[slot] ? Infinity : g.outAt[slot] }));
  rows.sort((a, b) => (b.at === a.at ? a.slot - b.slot : b.at - a.at));
  let place = 1;
  const out = [];
  rows.forEach((r, i) => {
    if (i > 0 && !(r.at === rows[i - 1].at || (Number.isFinite(r.at) && Number.isFinite(rows[i - 1].at) && Math.abs(r.at - rows[i - 1].at) <= TIE))) place = i + 1;
    out.push({ slot: r.slot, place, score: r.out ? r.at : (g.endAt ?? 0), out: r.out });
  });
  return out;
}

export function view(g, t = 0) {
  const sched = buildSchedule(g.seed);
  const next = sched.surprises.find((s) => s.at + (s.kind === 'pause' ? V.pause : 0.3) > t);
  return {
    t, sched, angle: ropeAngle(sched, t), speed: ropeSpeed(sched, t), alive: g.alive, outAt: g.outAt, jumps: g.jumps, slots: g.slots, done: g.done,
    warn: next && t >= next.warnAt && t < next.at ? { kind: next.kind, in: r2(next.at - t) } : null,
    surprise: next && t >= next.at && t < next.at + (next.kind === 'pause' ? V.pause : 0.6) ? next.kind : null,
    level: Math.min(V.speeds.length - 1, Math.floor(t / V.step)),
    centre: stageCentre(ID),
  };
}

/** What a bot does (it sees the same vine a player sees: a short way ahead, and a surprise only once it is telegraphed). me = { slot, x, z, mem }; returns { x, y, jump } (stick + a jump press). */
export function bot(v, me, skill, rng) {
  const mem = me.mem;
  const out = { x: 0, y: 0, jump: false };
  if (!v.alive[me.slot]) return out;
  const { r, phi } = polar(me.x, me.z), t = v.t;
  const horizon = 1.15;
  const nxt = nextPass(v.sched, phi, t, t + horizon);
  if (nxt === null) return out;
  const key = Math.round(nxt * 10);
  if (mem.pass !== key && Math.abs((mem.passT ?? -9) - nxt) > 0.12) {
    const lead = (V.airFrom + V.airTo) / 2, gauss = (rng() + rng() + rng() - 1.5) * 1.15;      // ~N(0, 1)
    mem.pass = key; mem.passT = nxt; mem.done = false;
    mem.plan = nxt - lead + gauss * skill.noise;
    mem.react = t + skill.react * (0.85 + rng() * 0.3);
    mem.miss = rng() < skill.miss;
    mem.r = r;
  }
  if (!mem.done && !mem.miss && t >= Math.max(mem.plan, mem.react)) { mem.done = true; out.jump = true; }
  return out;
}

/** Debug: everybody but `slot` falls out at once. */
export function debugWin(g, slot, t) { return g.slots.filter((s) => s !== slot && g.alive[s]).map((s) => ({ k: 'out', slot: s, t: r2(t) })); }

export const GAME = {
  id: ID, name: 'Vine Skip', host: 'Im Nabong + Mokuring', stage: 'vineskip', track: 'vineskip', players: [1, 4], kind: 'elim', duration: V.cap + V.tail,
  howto: { pitch: "Hop over the glowing vine, friends! Don't let it touch your toes!", buttons: ['jump', 'interact'], verbs: { jump: 'Hop!', interact: 'or hop with this' } },
  press: ['jump', 'interact', 'cancel'],               // every button hops: nobody is ever stuck on the wrong one
  init, step, request, apply, view, placing, bot, debugWin, tail: V.tail, lag: V.lag,
};
