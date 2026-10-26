// Marlo Says (Step 80b, party game 3; "Shy Guy Says" lives only in the plan): four players stand on tide-pool posts in front of Skipper Marlo's wreck. Marlo raises the RED or the GREEN signal flag (red on the left,
// green on the right of the screen) and shouts; copy him before the flag comes down: red = Cancel (B), green = Interact (A): the GameCube pad's own colours and sides. The stick never raises a flag (kids wander
// about on their posts while they wait), and Jump does nothing here.
// A wrong flag, or no flag in time, is a splash into the tide pool; the splashed player cheers from the beach. The beats get shorter and shorter. From `lieFrom` seconds Biscuit the gull sometimes squawks the WRONG
// colour while Marlo raises the other flag: the RAISED FLAG is what counts (the stage says so out loud). The last one dry wins; everybody still dry at `cap` seconds wins together.
// PURE rules, deterministic from the host's seed and clock (Node-tested in test/partyMarloSays.test.js); the look is world/party/marlosays.js.
//
// The calls (`buildCalls(seed)`) are the same for every player: { i, at, dur, color, who: 'marlo' | 'biscuit', says, lie } (the flag goes up at `at` and comes down at `at + dur`; `says` is what the shout calls, a lie
// when it differs from `color`). A press is judged from the PRESSER's stamp (clamped into the host's recent past with `slack`, like Timber Trim): the right colour inside [at, at + dur] = safe for that call, the wrong
// colour inside it = out at once, a call that ends (plus `lag`) without a right press = out ("slow"). A press before the flag is up (or between flags) does nothing.
// Game module contract: see vineskipLogic.js. recs: { k: 'ok', slot, i, rt (ms) } | { k: 'out', slot, i, why: 'wrong' | 'slow', t } | { k: 'res', i } (call i is settled) | { k: 'end', t, why }
import { PARTY } from '../../config.js';
import { mulberry32 } from '../../utils/rng.js';

const M = PARTY.marlosays;
export const ID = 'marlosays';
export const COLORS = ['red', 'green'];
const r2 = (v) => Math.round(v * 100) / 100;

const callCache = new Map();
/** The whole call list of a game (the same for every player): [{ i, at, dur, gap, color, who, says, lie }]. */
export function buildCalls(seed) {
  const key = seed >>> 0;
  const hit = callCache.get(key);
  if (hit) return hit;
  const rng = mulberry32(key ^ 0x3a51f9);
  const calls = [];
  let t = M.first, streak = 0, prev = null;
  for (let i = 0; ; i++) {
    const dur = Math.max(M.durMin, M.dur0 * Math.pow(M.durDecay, i)), gap = Math.max(M.gapMin, M.gap0 * Math.pow(M.gapDecay, i));
    if (t + dur + M.lag > M.cap - 0.2) break;
    let c = rng() < 0.5 ? 0 : 1;
    if (c === prev && streak >= 3) c = 1 - c;                                    // never more than three of a colour in a row
    streak = c === prev ? streak + 1 : 1; prev = c;
    const color = COLORS[c];
    const rb = rng(), rl = rng();                                                // (always drawn, so the schedule never depends on the lie rule)
    let who = 'marlo', says = color;
    if (t >= M.lieFrom && rb < M.biscuitShare) { who = 'biscuit'; if (rl < M.biscuitLie) says = COLORS[1 - c]; }
    calls.push({ i, at: r2(t), dur: r2(dur), gap: r2(gap), color, who, says, lie: says !== color });
    t += dur + gap;
  }
  callCache.set(key, calls);
  return calls;
}

/** The call whose window is open at game time t (a flag is up), or null. */
export const callAt = (calls, t) => calls.find((c) => t >= c.at && t <= c.at + c.dur) || null;

/** Which flag a frame of input asks for: Cancel (B, red, on the left) = 'red', Interact (A, green, on the right) = 'green', else null. `a` = { cancelPressed, interactPressed }. */
export function flagFromInput(a) {
  if (a && a.cancelPressed) return 'red';
  if (a && a.interactPressed) return 'green';
  return null;
}

// ---------------------------------------------------------------------------------------------------------------- the game
export function init(seed, roster) {
  const slots = roster.map((p) => p.slot), alive = {}, ok = {};
  for (const s of slots) { alive[s] = true; ok[s] = -1; }
  return { seed: seed >>> 0, slots, alive, ok, outCall: {}, outAt: {}, fast: {}, resolved: 0, done: false, endAt: null };
}

const aliveSlots = (g) => g.slots.filter((s) => g.alive[s]);

export function step(g, ctx, dt, t) {
  if (g.done) return [];
  const recs = [], calls = buildCalls(g.seed), grace = ctx.lag ?? M.lag;
  const call = calls[g.resolved];                                               // (one call settles per beat, so a rec is never emitted twice before it is applied)
  let dead = 0;
  if (call && t > call.at + call.dur + grace) {
    for (const s of aliveSlots(g)) if (g.ok[s] !== call.i) { recs.push({ k: 'out', slot: s, i: call.i, why: 'slow', t: r2(call.at + call.dur) }); dead++; }
    recs.push({ k: 'res', i: call.i });
  }
  const left = aliveSlots(g).length - dead;
  if (call && recs.length && (g.slots.length > 1 ? left <= 1 : left === 0)) recs.push({ k: 'end', t: r2(t), why: 'last' });
  else if (t >= M.cap) recs.push({ k: 'end', t: r2(t), why: 'cap' });
  return recs;
}

export function request(g, slot, req, ctx) {
  if (g.done) return { ignore: true };
  if (!g.alive[slot]) return { reject: 'out' };
  const flag = req && req.flag;
  if (!COLORS.includes(flag)) return { reject: 'bad-request' };
  const slack = ctx.slack ?? PARTY.slack, want = Number.isFinite(req.t) ? req.t : ctx.t;
  const tt = r2(Math.min(ctx.t, Math.max(ctx.t - slack, want)));
  const call = callAt(buildCalls(g.seed), tt);
  if (!call || call.i < g.resolved || g.ok[slot] === call.i) return { ignore: true };      // no flag up, an old call, or already safe for this one (mashing is harmless)
  if (flag === call.color) return { rec: { k: 'ok', slot, i: call.i, rt: Math.round((tt - call.at) * 1000) } };
  return { rec: { k: 'out', slot, i: call.i, why: 'wrong', t: tt } };
}

export function apply(g, rec) {
  if (!rec) return g;
  if (rec.k === 'ok') {
    if (g.alive[rec.slot]) {
      g.ok[rec.slot] = rec.i;
      if (Number.isFinite(rec.rt)) { g.fast ||= {}; g.fast[rec.slot] = g.fast[rec.slot] === undefined ? rec.rt : Math.min(g.fast[rec.slot], rec.rt); }      // (Step 80e's bonus feat, "Quickest flag")
    }
  }
  else if (rec.k === 'out') { if (g.alive[rec.slot]) { g.alive[rec.slot] = false; g.outCall[rec.slot] = rec.i; g.outAt[rec.slot] = rec.t; } }
  else if (rec.k === 'res') g.resolved = Math.max(g.resolved, rec.i + 1);
  else if (rec.k === 'end') { g.done = true; g.endAt = rec.t; }
  return g;
}

/** Ranks: the dry players first (they share the win); the splashed ones by the call they fell in (later = better; the same call is a tie). */
export function placing(g) {
  const rows = g.slots.map((slot) => ({ slot, out: !g.alive[slot], at: g.alive[slot] ? Infinity : g.outCall[slot] }));
  rows.sort((a, b) => (b.at === a.at ? a.slot - b.slot : b.at - a.at));
  let place = 1;
  return rows.map((r, i) => {
    if (i > 0 && r.at !== rows[i - 1].at) place = i + 1;
    return { slot: r.slot, place, score: r.out ? r.at : (g.resolved ?? 0), out: r.out };
  });
}

export function view(g, t = 0) {
  const calls = buildCalls(g.seed), cur = callAt(calls, t);
  const next = calls.find((c) => c.at > t) || null, last = calls[calls.length - 1];
  const prog = Math.min(1, Math.max(0, (cur || next || last).i / Math.max(1, calls.length - 1)));
  return {
    t, seed: g.seed, calls, current: cur, next, slots: g.slots, alive: g.alive, ok: g.ok, outCall: g.outCall, resolved: g.resolved, done: g.done,
    flag: cur ? cur.color : null, left: cur ? r2(cur.at + cur.dur - t) : 0, lieOn: t >= M.lieFrom,
    tempo: r2(1 + (M.tempoTo - 1) * prog), total: calls.length,
  };
}

/**
 * What a bot does (it sees what a player sees: the raised flag AND the shout, which may lie once the lies are on). me = { slot, mem }; returns { x, y, interact, cancel } for this frame. It reacts after skill.react
 * (+ noise) seconds, sometimes forgets, sometimes grabs the wrong flag, and with chance skill.fool takes a lying squawk for the truth.
 */
export function bot(v, me, skill, rng) {
  const mem = me.mem, out = { x: 0, y: 0, interact: false, cancel: false };
  if (!v.alive[me.slot]) return out;
  const c = v.current;
  if (!c) return out;
  const key = `${v.seed}:${c.i}`;
  if (mem.mcall !== key) {
    const gauss = (rng() + rng() + rng() - 1.5) * 1.15;
    mem.mcall = key; mem.sent = false;
    mem.mat = c.at + Math.max(0.12, skill.react * (0.85 + rng() * 0.3) + gauss * skill.noise);
    const fooled = c.lie && rng() < (skill.fool ?? 0);
    mem.pick = fooled ? c.says : c.color;
    mem.forget = rng() < skill.miss * M.botMiss;
    if (!mem.forget && !fooled && rng() < skill.miss * M.botMiss) mem.pick = c.color === 'red' ? 'green' : 'red';
  }
  if (!mem.sent && !mem.forget && v.t >= mem.mat) {
    mem.sent = true;
    if (mem.pick === 'red') out.cancel = true; else out.interact = true;
  }
  return out;
}

/** Debug: everybody but `slot` is splashed at once. */
export function debugWin(g, slot, t) { return g.slots.filter((s) => s !== slot && g.alive[s]).map((s) => ({ k: 'out', slot: s, i: g.resolved, why: 'debug', t: r2(t) })); }

export const GAME = {
  id: ID, name: 'Marlo Says', host: 'Skipper Marlo + Biscuit', stage: 'marlosays', track: 'marlosays', players: [1, 4], kind: 'elim', duration: M.cap + M.tail,
  howto: {
    pitch: 'Copy the flag Marlo raises, fast! Red B on the left, green A on the right. Wrong or slow and splash! Biscuit fibs sometimes: trust the flag.',
    buttons: ['cancel', 'interact'], verbs: { cancel: 'Red', interact: 'Green' },
  },
  press: ['cancel', 'interact'],
  init, step, request, apply, view, placing, bot, debugWin, tail: M.tail, lag: M.lag,
};
