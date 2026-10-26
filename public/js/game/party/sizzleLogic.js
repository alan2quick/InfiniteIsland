// Sizzle Seed (Step 80c, party game 7; "Hot Bob-omb" lives only in the plan): around the home campfire (four log benches and the fire pit are obstacles) Dub Nyangee hands a sizzling Ember Seed to a random player. Whoever
// holds it runs into a friend to PASS it on (the host judges the touch from where the players stand); the seed glows brighter and its fuse sparkles faster the longer it burns, but it pops at a time only the HOST knows.
// Whoever holds the seed when it pops is sooty and loses; the others win. `PARTY.sizzle.rounds` pops are played one after the other (2 by default; a 2-player party has one): the sooty ones sit out. PURE rules, deterministic
// from the host's seed and clock, Node-tested in test/partySizzle.test.js; the look is world/party/sizzle.js.
//
// THE HIDDEN TIMER. The pop time is drawn from the host's private rng (`setSecretRng`, Math.random by default) when a seed is handed out, and kept in a WeakMap keyed by the host's `g` object: it is never part of `g`, of a
// record, of a snapshot, of the hash or of anything a replica can read before the pop (a replica never steps the game). The glow / sparkle (`view().heat`) climbs with the seed's AGE only, reaching full at `heatFull` s,
// which is before the longest fuse: it says "getting hot", never "about to pop".
// THE CARRIER is host-simulated (pattern 2): the holder is game state, not something a screen decides, so a pass is never disputed. The seed is DRAWN over the holder's head wherever that player is on any screen; there is
// no seed position of its own, so what you see (the seed above a head) is exactly what is judged (that player holds it).
// PASSING. A pass needs the holder and another live player closer than `touchR` (the nearest wins). The new holder cannot pass BACK for `lock` s, nor until the two have parted by `touchR` + 0.4 u (no ping-pong while
// two players stand together), and nobody passes again within `cool` s of any pass. The holder runs `boost` x faster (each screen applies it to its own body; `holderSpeed`).
//
// Game module contract: see vineskipLogic.js. recs: { k: 'give', slot, t } | { k: 'pass', from, to, t } | { k: 'pop', slot, t } | { k: 'end', t, why }.  There are no presses (the stick only runs).
import { PARTY } from '../../config.js';
import { mulberry32 } from '../../utils/rng.js';
import { stageCentre, sizzleObstacles } from './partyArea.js';

const S = PARTY.sizzle;
export const ID = 'sizzle';
const r2 = (v) => Math.round(v * 100) / 100;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------------------------------------------------------------------------------------------------------------- the host's private memory
const hostMem = new WeakMap();
let secretRng = Math.random;
/** Tests only: where the host's private pop times come from (default Math.random). */
export function setSecretRng(fn) { secretRng = typeof fn === 'function' ? fn : Math.random; }
function mem(g) {
  let m = hostMem.get(g);
  if (!m) { m = { popAt: null, sep: true }; hostMem.set(g, m); }
  return m;
}
/** Tests only: the host's secret for a game state (undefined on anything that never stepped). */
export const secretOf = (g) => hostMem.get(g) || null;

export const aliveSlots = (g) => g.slots.filter((s) => g.alive[s]);
/** The first / next holder: a pick from the live players that is a pure function of the seed and the round (public, so a replay is exact). */
export function pickHolder(seed, round, alive) {
  const rng = mulberry32(((seed >>> 0) ^ Math.imul(round + 1, 0x9e3779b1) ^ 0x7a31c5) >>> 0);
  return alive[Math.floor(rng() * alive.length)];
}
/** The pops this party plays: `PARTY.sizzle.rounds`, never more than players - 1 (and at least one). */
export const roundsFor = (n) => Math.max(1, Math.min(S.rounds, n - 1));

/** Stage-local -> world circles (the fire pit and the benches), for steering. */
export function worldObstacles() {
  const c = stageCentre(ID);
  return sizzleObstacles().map((o) => ({ x: c.x + o.x, z: c.z + o.z, r: o.r }));
}

// ---------------------------------------------------------------------------------------------------------------- the game
export function init(seed, roster) {
  const slots = roster.map((p) => p.slot), alive = {};
  for (const s of slots) alive[s] = true;
  return {
    seed: seed >>> 0, slots, alive, holder: null, from: null, t0: 0, passAt: -9, passes: 0, gave: {}, round: 0, rounds: roundsFor(slots.length), popped: [], outAt: {},
    resumeAt: S.first, done: false, endAt: null,
  };
}

/** How hot the seed looks at time t (0..1): the age of the seed over `heatFull`, ease-in. It does NOT know the pop time. */
export function heatAt(g, t) {
  if (g.holder === null) return 0;
  const u = clamp((t - g.t0) / S.heatFull, 0, 1);
  return r2(u * u * (3 - 2 * u));
}

function dist(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }

export function step(g, ctx, dt, t) {
  if (g.done) return [];
  const recs = [], m = mem(g), alive = aliveSlots(g);
  const popRecs = (slot) => {
    recs.push({ k: 'pop', slot, t: r2(t) });
    m.popAt = null;
    if (g.popped.length + 1 >= g.rounds || alive.length - 1 <= 1) recs.push({ k: 'end', t: r2(t), why: 'done' });
  };
  if (g.holder === null) {
    if (t >= g.resumeAt && alive.length) {
      m.popAt = t + S.fuse[0] + secretRng() * (S.fuse[1] - S.fuse[0]);
      m.sep = true;
      recs.push({ k: 'give', slot: pickHolder(g.seed, g.round, alive), t: r2(t) });
    } else if (t >= S.cap) recs.push({ k: 'end', t: r2(t), why: 'cap' });
    return recs;
  }
  if (m.popAt === null) m.popAt = t + S.fuse[0] + secretRng() * (S.fuse[1] - S.fuse[0]);      // (a state that was not stepped by this host from the give: draw a fuse now)
  if (t >= m.popAt || t >= S.cap) { popRecs(g.holder); return recs; }
  const hp = ctx.pos ? ctx.pos(g.holder) : null;
  if (!hp) return recs;
  if (g.from !== null && !m.sep) {                                                   // the old holder must walk away before they can be passed to again
    const fp = ctx.pos(g.from);
    if (!fp || dist(hp, fp) > S.touchR + 0.4) m.sep = true;
  }
  if (t < g.passAt + S.cool) return recs;
  let best = null, bd = Infinity;
  for (const s of alive) {
    if (s === g.holder) continue;
    if (s === g.from && (t < g.passAt + S.lock || !m.sep)) continue;
    const p = ctx.pos(s);
    if (!p) continue;
    const d = dist(hp, p);
    if (d <= S.touchR && d < bd) { best = s; bd = d; }
  }
  if (best !== null) { recs.push({ k: 'pass', from: g.holder, to: best, t: r2(t) }); m.sep = false; }
  return recs;
}

export function request() { return { ignore: true }; }      // (no presses: the stick runs, a touch passes)

export function apply(g, rec) {
  if (!rec) return g;
  if (rec.k === 'give') { g.holder = rec.slot; g.from = null; g.t0 = rec.t; g.passAt = rec.t; g.round += 1; }
  else if (rec.k === 'pass') { g.holder = rec.to; g.from = rec.from; g.passAt = rec.t; g.passes += 1; g.gave ||= {}; g.gave[rec.from] = (g.gave[rec.from] || 0) + 1; }      // (gave: Step 80e's bonus feat, "Most passes")
  else if (rec.k === 'pop') {
    if (g.alive[rec.slot]) { g.alive[rec.slot] = false; g.outAt[rec.slot] = rec.t; g.popped.push(rec.slot); }
    g.holder = null; g.from = null; g.resumeAt = r2(rec.t + S.pause);
  } else if (rec.k === 'end') { g.done = true; g.endAt = rec.t; }
  return g;
}

/** Ranks: everybody the seed never popped on is first (a tie); then the popped, the LATER pop the better place. */
export function placing(g) {
  const live = g.slots.filter((s) => g.alive[s]), out = live.map((slot) => ({ slot, place: 1, score: 0, out: false }));
  g.popped.slice().reverse().forEach((slot, k) => out.push({ slot, place: live.length + 1 + k, score: g.popped.indexOf(slot) + 1, out: true }));
  return out;
}

export function view(g, t = 0) {
  return {
    t, slots: g.slots, alive: g.alive, holder: g.holder, from: g.from, passAt: g.passAt, passes: g.passes, heat: heatAt(g, t), round: g.round, rounds: g.rounds, popped: g.popped,
    outAt: g.outAt, done: g.done, resumeAt: g.resumeAt, t0: g.t0, lockLeft: g.holder !== null ? Math.max(0, r2(g.passAt + S.lock - t)) : 0,
  };
}

/** How fast a body runs: the holder is a little quicker (each screen sets its own player's speedScale from the synced holder). */
export const holderSpeed = (g, slot) => (g.holder === slot ? S.boost : 1);

// ---------------------------------------------------------------------------------------------------------------- the bots
/** Push a wished direction (dx, dz unit) away from obstacles and the clearing's edge; returns a unit-ish vector. */
export function steer(px, pz, dx, dz) {
  const c = stageCentre(ID);
  let sx = dx, sz = dz;
  for (const o of worldObstacles()) {
    const ox = px - o.x, oz = pz - o.z, d = Math.hypot(ox, oz), reach = o.r + 1.5;
    if (d < reach && d > 0.001) { const k = ((reach - d) / 1.5) * 1.6; sx += (ox / d) * k; sz += (oz / d) * k; }
  }
  const cx = px - c.x, cz = pz - c.z, cd = Math.hypot(cx, cz), edge = S.arenaR - 1.4;
  if (cd > edge) { const k = clamp((cd - edge) / 1.4, 0, 1) * 2.2; sx -= (cx / cd) * k; sz -= (cz / cd) * k; }
  const n = Math.hypot(sx, sz) || 1;
  return { x: sx / n, z: sz / n };
}
const gauss = (rng) => (rng() + rng() + rng() - 1.5) * 1.15;

/**
 * A bot sees the same screen as a player: who holds the seed (the glow over a head), where everybody stands (`me.others` = [{ slot, x, z }] in world coordinates), and the benches. It looks again every
 * `retarget` s (that is its reaction time: it runs at where the target WAS), aims with noise, and now and then daydreams. The HOLDER runs at the nearest friend it may pass to; everybody else runs away from the
 * holder (round the fire, not into a corner) when it comes close. It never knows the pop time. Returns { x, y } (the stick: x right, y up = world -z).
 */
export function bot(v, me, skill, rng) {
  const m = me.mem, out = { x: 0, y: 0 };
  if (!v.alive[me.slot] || v.holder === null || v.done) return out;
  const others = (me.others || []).filter((o) => o.slot !== me.slot && v.alive[o.slot]);
  const t = v.t;
  if (t >= (m.thinkAt ?? -1)) {
    m.thinkAt = t + skill.react * 0.6 * (0.8 + rng() * 0.4);
    m.aim = null; m.flee = null;
    if (t >= (m.lapseTo ?? 0) && rng() < skill.miss * PARTY.sizzle.botMiss * 0.35) m.lapseTo = t + 0.5 + rng() * 0.5;       // a daydream
    if (v.holder === me.slot) {
      let best = null, bd = Infinity;
      for (const o of others) {
        if (o.slot === v.from && v.lockLeft > 0) continue;
        const d = Math.hypot(o.x - me.x, o.z - me.z);
        if (d < bd) { bd = d; best = o; }
      }
      if (best) m.aim = { x: best.x + gauss(rng) * skill.noise * 3, z: best.z + gauss(rng) * skill.noise * 3 };
    } else {
      const h = others.find((o) => o.slot === v.holder);
      if (h) m.flee = { x: h.x, z: h.z, side: m.side ?? (m.side = rng() < 0.5 ? -1 : 1) };
    }
  }
  if (t < (m.lapseTo ?? 0)) return out;
  let dx = 0, dz = 0, mag = S.pace + (1 - S.pace) * skill.walk;       // (a bot's stick: even the easy ones run at a fair pace; the skill is in how it looks and aims)
  if (v.holder === me.slot && m.aim) { dx = m.aim.x - me.x; dz = m.aim.z - me.z; }
  else if (m.flee) {
    const fx = me.x - m.flee.x, fz = me.z - m.flee.z, d = Math.hypot(fx, fz);
    if (d > 7.5) return out;                                                         // far from the holder: stand and watch
    const ux = fx / (d || 1), uz = fz / (d || 1);
    dx = ux + -uz * m.flee.side * 0.7; dz = uz + ux * m.flee.side * 0.7;           // away, and round the fire
  } else return out;
  const n = Math.hypot(dx, dz);
  if (n < 0.3) return out;
  const s = steer(me.x, me.z, dx / n, dz / n);
  out.x = s.x * mag; out.y = -s.z * mag;
  return out;
}

/** Debug: everybody but `slot` pops at once (the party's debugWin). */
export function debugWin(g, slot, t) { return g.slots.filter((s) => s !== slot && g.alive[s]).map((s) => ({ k: 'pop', slot: s, t: r2(t) })); }

export const GAME = {
  id: ID, name: 'Sizzle Seed', host: 'Dub Nyangee', stage: 'sizzle', track: 'sizzle', players: [1, 4], kind: 'elim', duration: S.fuse[1] * 2 + 8, tail: S.tail,
  howto: { pitch: 'Oh dear, a sizzling seed. Run into a friend to hand it on. Whoever is holding it when it pops gets a little sooty.', buttons: ['stick'], verbs: { stick: 'Run to a friend' } },
  press: [],
  init, step, request, apply, view, placing, bot, debugWin, lag: 0,
};
