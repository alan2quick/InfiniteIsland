// Glowcap Shuffle (Step 81a, party game 9; "Mushroom Mix-Up" lives only in the plan): eight big glowing mushroom caps float on the dark Duskcrown lagoon, packed so they touch (they overlap a little, so a walker crosses
// from one to the next). Each cap has its own colour AND symbol on top (colour-blind kids can play). Every round Tzukumi's heart antler lights up in one cap's colour and symbol (the stage and the HUD show it big) while
// a three-count (3, 2, 1) ticks; then every OTHER cap sinks into the lagoon for about two seconds and rises again. Whoever is not on the called cap at that moment splashes, drifts to the shore and watches from the
// spectator patch. The beats speed up round by round, and from round 4 some caps stay sunk for good, so there is less and less room. The last one dry wins; everybody still dry after round 10 wins together.
// PURE rules, deterministic from the host's seed and clock (Node-tested in test/partyGlowcap.test.js); the look is world/party/glowcap.js.
//
// WHAT YOU SEE IS WHAT IS JUDGED: at the sink time the HOST reads every dry player's REAL position (`ctx.pos(slot)`, the Sizzle Seed pattern) and compares it with the DRAWN called cap: a body is dry when its centre is
// within `capR` of the called cap's centre (the same circle the stage draws as the cap's rim; a body standing on two overlapping caps counts as on the called one if its centre is). The round schedule (`buildPlan`) is a
// pure function of the seed: which cap is called, when it sinks, which caps stay down. Nothing about the players changes the plan, only who is left.
//
// Game module contract: see vineskipLogic.js. recs: { k: 'sink', r, t, out: [slots] } (round r's sink moment: these players were not on the called cap) | { k: 'zap', slot, t } (debug) | { k: 'end', t, why }.  There are no presses.
// State: alive[slot], outR[slot] (the round a player fell in), round (rounds already sunk), done, endAt.
import { PARTY } from '../../config.js';
import { mulberry32 } from '../../utils/rng.js';
import { stageCentre, glowcapLayout, glowcapSpacing } from './partyArea.js';

const G = PARTY.glowcap;
export const ID = 'glowcap';
const r2 = (v) => Math.round(v * 100) / 100;
const lerp = (a, b, u) => a + (b - a) * u;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = (u) => { const k = clamp(u, 0, 1); return k * k * (3 - 2 * k); };

/** The eight caps' faces: colour + symbol + a name for the HUD. Index = the cap's place in the layout (glowcapLayout). */
export const CAPS = [
  { id: 'star', symbol: 'star', color: '#ffd23a', name: 'Yellow star' },
  { id: 'heart', symbol: 'heart', color: '#ff4f6f', name: 'Red heart' },
  { id: 'moon', symbol: 'moon', color: '#7c6cff', name: 'Violet moon' },
  { id: 'drop', symbol: 'drop', color: '#34c8ff', name: 'Blue drop' },
  { id: 'leaf', symbol: 'leaf', color: '#4fd06f', name: 'Green leaf' },
  { id: 'flower', symbol: 'flower', color: '#ff8a2a', name: 'Orange flower' },
  { id: 'shell', symbol: 'shell', color: '#ff9ccf', name: 'Pink shell' },
  { id: 'spiral', symbol: 'spiral', color: '#f2f6ff', name: 'White spiral' },
];

/** Symbol outlines as unit polygons ([x, y] within -1..1, y up, counter-clockwise, simple): the stage extrudes them, the HUD draws them as SVG. */
function poly(n, f) { const out = []; for (let k = 0; k < n; k++) out.push(f(k / n * Math.PI * 2, k)); return out; }
export const SYMBOLS = (() => {
  const star = poly(10, (a, k) => { const r = k % 2 ? 0.42 : 1; return [Math.cos(a + Math.PI / 2) * r, Math.sin(a + Math.PI / 2) * r]; });
  const heart = poly(28, (a) => [0.94 * Math.pow(Math.sin(a), 3), (13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a)) / 16 + 0.05]);
  const moon = []; {
    const ix = 0.61, iy = Math.sqrt(1 - ix * ix), a0 = Math.atan2(iy, ix);
    for (let k = 0; k <= 16; k++) { const a = a0 + (k / 16) * (2 * Math.PI - 2 * a0); moon.push([Math.cos(a), Math.sin(a)]); }
    const b0 = Math.atan2(-iy, ix - 0.5);                                            // the inner circle (centre 0.5, radius 0.8): from the lower intersection round its left side back to the upper one
    for (let k = 1; k < 16; k++) { const a = b0 - (k / 16) * (2 * Math.PI - 2 * (Math.atan2(iy, ix - 0.5))) ; moon.push([0.5 + 0.8 * Math.cos(a), 0.8 * Math.sin(a)]); }
  }
  const drop = poly(24, (th) => [0.7 * Math.sin(th) * Math.sin(th / 2), Math.cos(th)]);                       // a teardrop: the tip up, the belly round
  const leaf = []; for (let k = 0; k <= 10; k++) { const u = k / 10; leaf.push([0.55 * Math.sin(u * Math.PI) * 0.95 + 0.0, -1 + 2 * u]); } for (let k = 9; k >= 1; k--) { const u = k / 10; leaf.push([-0.55 * Math.sin(u * Math.PI) * 0.95, -1 + 2 * u]); }
  const flower = poly(40, (a) => { const r = 0.62 + 0.38 * Math.cos(5 * a); return [Math.cos(a) * r * 1.04, Math.sin(a) * r * 1.04]; });
  const shell = []; { for (let k = 0; k <= 20; k++) { const a = Math.PI * (k / 20); const r = 0.82 + 0.18 * Math.cos(a * 7); shell.push([Math.cos(a) * r * 1.0 * -1, Math.sin(a) * r * 0.95 - 0.1]); } shell.push([0.34, -0.55], [0.16, -0.9], [-0.16, -0.9], [-0.34, -0.55]); }
  const spiral = []; { const N = 36; for (let k = 0; k <= N; k++) { const u = k / N, a = u * Math.PI * 4.2, r = 0.2 + 0.78 * u; spiral.push([Math.cos(a) * r, Math.sin(a) * r]); } for (let k = N; k >= 0; k--) { const u = k / N, a = u * Math.PI * 4.2, r = 0.2 + 0.78 * u - 0.26 - 0.0; spiral.push([Math.cos(a) * Math.max(0.02, r + 0.02), Math.sin(a) * Math.max(0.02, r + 0.02)]); } }
  return { star, heart, moon, drop, leaf, flower, shell, spiral };
})();

/** A symbol as an inline SVG string (for the HUD's call badge): dark on the cap's colour, y flipped because the polygons have y up. */
export function symbolSvg(id, fill = '#2a1f55') {
  const pts = (SYMBOLS[id] || []).map(([x, y]) => `${x.toFixed(3)},${y.toFixed(3)}`).join(' ');
  return `<svg viewBox="-1.15 -1.15 2.3 2.3" aria-hidden="true" focusable="false"><g transform="scale(1,-1)"><polygon points="${pts}" fill="${fill}"/></g></svg>`;
}

export const CAP_LOCAL = glowcapLayout();                                           // [{ i, x, z, r }] stage-local
export const capCentre = (i) => { const c = stageCentre(ID), p = CAP_LOCAL[i]; return { x: c.x + p.x, z: c.z + p.z }; };
const D = glowcapSpacing();
const ADJ = CAP_LOCAL.map((a) => CAP_LOCAL.filter((b) => b.i !== a.i && Math.hypot(a.x - b.x, a.z - b.z) <= D + 0.05).map((b) => b.i));
export const neighbours = (i) => ADJ[i];
/** The cap whose circle holds the world point (the nearest centre when two overlap), or -1. */
export function capAt(x, z) {
  const c = stageCentre(ID);
  let best = -1, bd = Infinity;
  for (const cap of CAP_LOCAL) { const d = Math.hypot(x - c.x - cap.x, z - c.z - cap.z); if (d <= cap.r && d < bd) { best = cap.i; bd = d; } }
  return best;
}
/** Is the world point on cap i (its centre within the cap's drawn radius)? */
export function onCap(i, x, z) { const p = capCentre(i); return Math.hypot(x - p.x, z - p.z) <= G.capR; }

function connected(ups) {
  if (ups.length <= 1) return true;
  const seen = new Set([ups[0]]), q = [ups[0]];
  while (q.length) { const a = q.shift(); for (const b of ADJ[a]) if (ups.includes(b) && !seen.has(b)) { seen.add(b); q.push(b); } }
  return seen.size === ups.length;
}

/** Hop counts over the caps in `allowed` from cap `from` (BFS through touching caps). */
function hopsFrom(from, allowed) {
  const dist = new Map([[from, 0]]), q = [from];
  while (q.length) { const a = q.shift(); for (const b of ADJ[a]) if (allowed.includes(b) && !dist.has(b)) { dist.set(b, dist.get(a) + 1); q.push(b); } }
  return dist;
}

const planCache = new Map();
/**
 * The whole schedule of a game, the same on every screen: rounds[r] = { r, start (the call lights up), beat, sinkAt (= start + 3 beats), sinkDur, riseAt, call (cap index), dead [caps down for good this round], newDead [dropped by the
 * previous round's sink] }, plus end (when the last cap has risen) and deadAt[cap] (the sink moment after which it never rises).
 */
export function buildPlan(seed) {
  const key = seed >>> 0, hit = planCache.get(key);
  if (hit) return hit;
  const rng = mulberry32(key ^ 0x6f1d3a);
  const rounds = [], deadAt = {};
  let t = G.first, dead = [], prevCall = -1;
  for (let r = 0; r < G.rounds; r++) {
    const u = r / (G.rounds - 1), ub = Math.min(1, r / G.ramp), beat = r2(lerp(G.beat[0], G.beat[1], ub)), gap = lerp(G.gap[0], G.gap[1], ub), sinkDur = r2(lerp(G.sink[0], G.sink[1], u));
    const newDead = [];
    const want = G.dead[Math.min(r, G.dead.length - 1)];
    while (dead.length < want) {                                                  // some caps stay sunk: never the one called last round (a dry player stands on it), and the ones left stay connected
      const ups = CAP_LOCAL.map((c) => c.i).filter((i) => !dead.includes(i));
      const cand = ups.filter((i) => i !== prevCall).map((i) => [rng(), i]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
      const pick = cand.find((i) => connected(ups.filter((j) => j !== i)) && ups.length - 1 >= 4) ?? -1;
      if (pick < 0) break;
      dead = dead.concat(pick); newDead.push(pick); deadAt[pick] = rounds[r - 1].sinkAt;
    }
    const upAll = CAP_LOCAL.map((c) => c.i).filter((i) => !dead.includes(i));
    let ups = upAll.filter((i) => i !== prevCall);
    if (prevCall >= 0) { const near = hopsFrom(prevCall, upAll); const close = ups.filter((i) => near.get(i) <= (Array.isArray(G.hops) ? G.hops[Math.min(r, G.hops.length - 1)] : G.hops)); if (close.length) ups = close; }       // (the next call is never more than `hops[r]` caps away from the last one: the dry players all stand on that one)
    const call = ups[Math.floor(rng() * ups.length)];
    const start = r2(t), sinkAt = r2(start + 3 * beat), riseAt = r2(sinkAt + sinkDur);
    rounds.push({ r, start, beat, sinkAt, sinkDur, riseAt, call, dead: dead.slice(), newDead });
    prevCall = call; t = riseAt + G.riseT + gap;
  }
  const plan = { seed: key, rounds, deadAt, end: r2(rounds[rounds.length - 1].riseAt + G.riseT) };
  planCache.set(key, plan);
  return plan;
}

/** How far cap i is sunk at time t: 0 = up, 1 = under the water (smooth). */
export function capDepth(plan, i, t) {
  let d = 0;
  for (const R of plan.rounds) {
    if (R.sinkAt > t + 1) break;
    if (R.call === i) continue;
    if (t >= R.sinkAt && t < R.sinkAt + G.sinkT) d = Math.max(d, ease((t - R.sinkAt) / G.sinkT));
    else if (t >= R.sinkAt + G.sinkT && t < R.riseAt) d = 1;
    else if (t >= R.riseAt && t < R.riseAt + G.riseT) d = Math.max(d, 1 - ease((t - R.riseAt) / G.riseT));
  }
  const da = plan.deadAt[i];
  if (da !== undefined && t >= da) d = Math.max(d, ease((t - da) / G.sinkT));
  return d;
}
/** The round the clock is in at time t (before the first call it is round 0; after the last it stays there). */
export function roundAt(plan, t) {
  for (const R of plan.rounds) if (t < R.riseAt + G.riseT) return R;
  return plan.rounds[plan.rounds.length - 1];
}

// ---------------------------------------------------------------------------------------------------------------- the game
export function init(seed, roster) {
  const slots = roster.map((p) => p.slot), alive = {}, outR = {};
  for (const s of slots) alive[s] = true;
  return { seed: seed >>> 0, slots, alive, outR, ctr: {}, ctn: {}, round: 0, done: false, endAt: null };
}
const aliveSlots = (g) => g.slots.filter((s) => g.alive[s]);

export function step(g, ctx, dt, t) {
  if (g.done) return [];
  const recs = [], plan = buildPlan(g.seed), R = plan.rounds[g.round];
  if (!R || t < R.sinkAt) return recs;
  const out = [], d = {}, c = capCentre(R.call);
  for (const s of aliveSlots(g)) {
    const p = ctx.pos ? ctx.pos(s) : null;
    if (p && Math.hypot(p.x - c.x, p.z - c.z) > G.capR) out.push(s);              // (a body whose position is unknown is never splashed)
    else if (p) d[s] = r2(Math.hypot(p.x - c.x, p.z - c.z));                      // (Step 80e: how close to the cap's heart a dry body stood, for the "Bullseye feet" bonus)
  }
  recs.push({ k: 'sink', r: R.r, t: R.sinkAt, out, d });
  const left = aliveSlots(g).length - out.length;
  if (R.r >= plan.rounds.length - 1) recs.push({ k: 'end', t: r2(t), why: 'rounds' });
  else if (g.slots.length > 1 ? left <= 1 : left === 0) recs.push({ k: 'end', t: r2(t), why: 'last' });
  return recs;
}

export function request() { return { ignore: true }; }      // (no presses: the stick walks you)

export function apply(g, rec) {
  if (!rec) return g;
  if (rec.k === 'sink') {
    for (const s of rec.out) if (g.alive[s]) { g.alive[s] = false; g.outR[s] = rec.r; }
    g.round = Math.max(g.round, rec.r + 1);
    if (rec.d) { g.ctr ||= {}; g.ctn ||= {}; for (const s in rec.d) { g.ctr[s] = (g.ctr[s] || 0) + rec.d[s]; g.ctn[s] = (g.ctn[s] || 0) + 1; } }
  } else if (rec.k === 'zap') { if (g.alive[rec.slot]) { g.alive[rec.slot] = false; g.outR[rec.slot] = g.round; } }      // (debug only)
  else if (rec.k === 'end') { g.done = true; g.endAt = rec.t; }
  return g;
}

/** Ranks: the dry players first (they share the win); the splashed ones by the round they fell in (later = better; the same round is a tie). */
export function placing(g) {
  const rows = g.slots.map((slot) => ({ slot, out: !g.alive[slot], at: g.alive[slot] ? Infinity : g.outR[slot] }));
  rows.sort((a, b) => (b.at === a.at ? a.slot - b.slot : b.at - a.at));
  let place = 1;
  return rows.map((r, i) => {
    if (i > 0 && r.at !== rows[i - 1].at) place = i + 1;
    return { slot: r.slot, place, score: r.out ? r.at : g.round, out: r.out };
  });
}

export function view(g, t = 0) {
  const plan = buildPlan(g.seed), R = roundAt(plan, t), started = t >= R.start && t < R.riseAt;
  const call = started ? { cap: R.call, ...CAPS[R.call] } : null;
  return {
    t, seed: g.seed, plan, slots: g.slots, alive: g.alive, outR: g.outR, round: g.round, done: g.done, cur: R,
    call, count: started ? clamp(Math.floor((t - R.start) / R.beat) + 1, 1, 3) : 0, sinking: t >= R.sinkAt && t < R.riseAt,
    depth: CAP_LOCAL.map((c) => capDepth(plan, c.i, t)), left: aliveSlots(g).length,
  };
}

// ---------------------------------------------------------------------------------------------------------------- the bots
const speedOf = (skill) => G.pace + (1 - G.pace) * skill.walk;
/** The route over caps that are up: BFS from the cap holding (x, z) (or the nearest) to cap `to`, as cap indices. */
export function route(from, to, depth) {
  if (from === to) return [from];
  const prev = new Map([[from, -1]]), q = [from];
  while (q.length) { const a = q.shift(); if (a === to) break; for (const b of ADJ[a]) if (!prev.has(b) && depth[b] < 0.5) { prev.set(b, a); q.push(b); } }
  if (!prev.has(to)) return [from, to];
  const path = []; for (let a = to; a !== -1; a = prev.get(a)) path.unshift(a);
  return path;
}
/**
 * A bot reads the call like a player: it notices the lit antler after skill.react s (+ noise), then walks over the caps that are up towards the called one. On easy it sometimes heads for a neighbour of the right
 * cap (colours and symbols confused), and then stands on the wrong one. Returns { x, y } (the stick).
 */
export function bot(v, me, skill, rng) {
  const out = { x: 0, y: 0 }, m = me.mem;
  if (!v.alive[me.slot] || v.done) return out;
  const R = v.cur;
  if (!v.call) return out;
  if (m.round !== R.r || m.seed !== v.seed) {
    const gauss = (rng() + rng() + rng() - 1.5) * 1.15;
    m.round = R.r; m.seed = v.seed;
    m.at = R.start + Math.max(0.1, skill.react * (0.85 + rng() * 0.3) + gauss * skill.noise);
    let target = R.call;
    if (rng() < skill.miss * G.botMiss) { const alt = neighbours(R.call).filter((j) => v.depth[j] < 0.5); if (alt.length) target = alt[Math.floor(rng() * alt.length)]; }
    m.target = target;
    m.off = { a: rng() * Math.PI * 2, r: rng() * (G.capR - 0.9) };                  // where on the cap it stops (not always the centre)
  }
  if (v.t < m.at) return out;
  const c = stageCentre(ID);
  const tp = CAP_LOCAL[m.target], goal = { x: c.x + tp.x + Math.cos(m.off.a) * m.off.r, z: c.z + tp.z + Math.sin(m.off.a) * m.off.r };
  if (Math.hypot(goal.x - me.x, goal.z - me.z) < 0.35) return out;
  let near = -1, nd = Infinity;
  for (const cap of CAP_LOCAL) { const d = Math.hypot(me.x - c.x - cap.x, me.z - c.z - cap.z); if (d < nd) { nd = d; near = cap.i; } }
  const path = route(near, m.target, v.depth);
  let wp = goal;
  if (path.length > 1) { const nx = CAP_LOCAL[path[1]]; const cc = { x: c.x + nx.x, z: c.z + nx.z }; if (Math.hypot(cc.x - me.x, cc.z - me.z) > 0.3) wp = cc; }
  const dx = wp.x - me.x, dz = wp.z - me.z, d = Math.hypot(dx, dz) || 1, mag = speedOf(skill);
  out.x = (dx / d) * mag; out.y = -(dz / d) * mag;
  return out;
}

/** Debug: everybody but `slot` falls in. */
export function debugWin(g, slot, t) { return g.slots.filter((s) => s !== slot && g.alive[s]).map((s) => ({ k: 'zap', slot: s, t: r2(t) })); }

export const GAME = {
  id: ID, name: 'Glowcap Shuffle', host: 'Tzukumi', stage: 'glowcap', track: 'glowcap', players: [1, 4], kind: 'elim', duration: buildPlan(0).end + G.tail, tail: G.tail,
  howto: { pitch: 'Tzukumi lights her antler in one cap\'s colour and shape. Run onto that cap before the bells finish: all the others sink! Last one dry wins.', buttons: ['stick'], verbs: { stick: 'Run to the glowing cap' } },
  press: [],
  init, step, request, apply, view, placing, bot, debugWin, lag: 0,
};
