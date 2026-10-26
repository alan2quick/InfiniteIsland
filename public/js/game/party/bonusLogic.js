// Bonus stars (Step 80e): every game has ONE feat besides winning, and whoever did it best earns a bonus star on top of the winner's star. PURE: the host evaluates the finished game state at the results
// (game/party/partyDomain.js) and puts the answer in `results.bonus`, so every screen shows the same card and the stars stay in the hashed state.
//
//   FEATS[id](g) -> spec | null     spec = { label, scores: { slot: n }, low?: true (smaller is better), min?: 1 (a score below it does not count), text(best) -> string }
//   pickBonus(spec, slots) -> { label, text, slots: [slot], value } | null
//       ties share the star; a feat that EVERY player (of two or more) shares equally is no feat at all (null), and so is one nobody reached (all scores under `min`).
//   bonusFor(gameId, g) -> the same, or null (an unknown game, a state without the counters, a throw: a missing bonus must never stop the results)
// The feats read only the game's own JSON state (the same on every screen), most from counters the games already keep; a few games gained one small counter in their apply():
//   vineskip hopN (hops), marlosays fast (fastest right flag, ms), sizzle gave (passes), feastround eaten (dishes), bumpers hits (bumps), bonk close (the narrowest escape from a slam, u), glowcap ctr / ctn (distance from the cap's heart), tilty boards[i].e (tiles at 10 s).
import { buildItems as eggItems } from './eggsLogic.js';
import { buildItems as castItems, ptsOf } from './castLogic.js';

const EPS = 1e-6;
const num = (v) => (Number.isFinite(v) ? v : null);

export function pickBonus(spec, slots) {
  if (!spec || !Array.isArray(slots) || !slots.length) return null;
  const min = spec.min ?? 1, rows = [];
  for (const s of slots) { const v = num(spec.scores && spec.scores[s]); if (v !== null && (spec.low ? true : v >= min)) rows.push({ slot: s, v }); }
  if (!rows.length) return null;
  const best = rows.reduce((b, r) => (spec.low ? Math.min(b, r.v) : Math.max(b, r.v)), rows[0].v);
  const won = rows.filter((r) => Math.abs(r.v - best) <= EPS).map((r) => r.slot);
  if (slots.length > 1 && won.length === slots.length) return null;                       // everybody did it equally: nobody stood out
  return { label: spec.label, text: spec.text(best), slots: won.sort((a, b) => a - b), value: best };
}

const countOf = (m) => m || {};
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const FEATS = {
  vineskip: (g) => ({ label: 'Most hops', scores: countOf(g.hopN), text: (n) => plural(n, 'hop') }),
  timber: (g) => {                                                              // the cut closest to dead on (ms either side of the red line)
    const scores = {};
    for (const s of g.slots) { const ds = ((g.cuts && g.cuts[s]) || []).filter((c) => c.d !== null && c.d !== undefined).map((c) => Math.abs(c.d)); if (ds.length) scores[s] = Math.min(...ds); }
    return { label: 'Best cut', scores, low: true, text: (ms) => (ms === 0 ? 'dead on' : `${ms} ms from dead on`) };
  },
  marlosays: (g) => ({ label: 'Quickest flag', scores: countOf(g.fast), low: true, text: (ms) => `${ms} ms` }),
  huddle: (g) => ({ label: 'Most dodges', scores: countOf(g.safe), text: (n) => plural(n, 'safe curl') }),
  sizzle: (g) => ({ label: 'Most passes', scores: countOf(g.gave), text: (n) => plural(n, 'pass', 'passes') }),
  eggs: (g) => {
    const items = eggItems(g.seed), scores = {};
    for (const s of g.slots) scores[s] = Object.entries((g.res && g.res[s]) || {}).filter(([i, r]) => r === 'c' && items[i] && items[i].kind === 'gold').length;
    return { label: 'Golden eggs', scores, text: (n) => plural(n, 'golden egg') };
  },
  feastround: (g) => ({ label: 'Most dishes', scores: countOf(g.eaten), text: (n) => plural(n, 'dish', 'dishes') }),
  bumpers: (g) => ({ label: 'Most bumps', scores: countOf(g.hits), text: (n) => plural(n, 'bump') }),
  glowcap: (g) => {
    const scores = {};
    for (const s of g.slots) if (g.ctn && g.ctn[s] >= 2) scores[s] = Math.round((g.ctr[s] / g.ctn[s]) * 100) / 100;
    return { label: 'Bullseye feet', scores, low: true, text: (d) => `${d.toFixed(1)} u from the glow` };
  },
  cast: (g) => {
    const items = castItems(g.seed), scores = {};
    for (const s of g.slots) scores[s] = Math.max(0, ...Object.entries((g.res && g.res[s]) || {}).filter(([, r]) => r === 'd').map(([i]) => (items[i] ? ptsOf(items[i].kind) : 0)));
    return { label: 'Biggest find', scores, min: 1, text: (n) => `a ${n}-point find` };
  },
  tilty: (g) => {
    const scores = {};
    g.slots.forEach((s, i) => { if (g.boards && g.boards[i] && g.boards[i].e !== undefined) scores[s] = g.boards[i].e; });
    return { label: 'Fast starter', scores, min: 3, text: (n) => `${n} tiles by 10 s` };
  },
  bonk: (g) => ({ label: 'Closest call', scores: countOf(g.close), low: true, text: (m) => (m <= 0 ? 'saved by a hop!' : `${m.toFixed(1)} u to spare`) }),
};

export function bonusFor(id, g) {
  try {
    const f = FEATS[id];
    return f && g ? pickBonus(f(g), g.slots) : null;
  } catch (_) { return null; }
}
