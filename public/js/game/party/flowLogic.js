// The party's flow (Step 80a): the state machine, the shuffle bag, the Game Board's toggles and the saved preferences. PURE (no three.js, no DOM, no clocks of its own): the host feeds it dt and what it can see, and
// Node tests it (test/party.test.js).
//
//   lobby -> pick (a roulette of the enabled games' tiles, 3 s) -> howto (the title, the host's pitch, a button card, and 10 s of practice on the real stage) -> countdown (3, 2, 1, Go!) -> play -> results -> lobby -> ...
// The host skips howto on later picks of a game whose card was already shown in this host session.
//
// KIDS-PROOF: every phase advances by itself. Nothing waits for a menu, a button or a name: the how-to ends when every human holds Interact ("Ready!") OR its timer runs out, a game ends by its own rules or its
// cap, the results card goes away on its own. A player who stops pressing anything is still played for (they just lose).
//
//   const f = newFlow();                       { phase: 'lobby', t: 0, first: true, round: 0 }
//   flowTick(f, dt, c) -> next phase | null    c = { humans, allReady, mode, pickChosen, gameDone, doneFor, gameCap, lastRound, howtoSeen }; the caller then calls goTo(f, phase)
//   goTo(f, phase)                             enters a phase (t = 0)
//   drawGame({ bag, enabled, last, rng, forced }) -> { game, bag }     the shuffle bag: every enabled game once, never the same game twice in a row (a Random party with one game repeats it)
//   toggleGame(enabled, id, on, allIds) -> { ok, enabled, reason? }    the last enabled game cannot be switched off
//   normalisePrefs(raw, allIds) -> { enabled, mode, rounds, bots, difficulty }      the per-host-screen preferences (infiniteIsland.party)
//   awardStars(stars, ranks) -> stars          every winner (place 1) earns a star; ties share
//   awardBonus(stars, slots) -> stars          (Step 80e) the bonus feat's winners earn PARTY.bonusStars more (game/party/bonusLogic.js)
//   finalPlaces(stars, roster) -> [{ slot, place, stars }]      (Step 80e) the party's standings for the trophy ceremony: most stars first, ties share a place (1, 1, 3, ...)
//   countdownLabel(t) -> '3' | '2' | '1' for t in the 3 s countdown ('Go!' is the first 0.8 s of the play phase: goLabel(gt))
import { PARTY } from '../../config.js';

export const PHASES = ['lobby', 'pick', 'howto', 'countdown', 'play', 'results'];
const F = PARTY.flow;

export function newFlow() { return { phase: 'lobby', t: 0, first: true, round: 0 }; }

export function goTo(f, phase) {
  if (!PHASES.includes(phase)) throw new Error(`unknown party phase ${phase}`);
  if (f.phase === 'lobby' && phase !== 'lobby') f.first = false;
  f.phase = phase; f.t = 0;
  return f;
}

/** Advance the clock by dt and say which phase comes next (or null to stay). The rules are the timeouts above; `c` is what the host knows right now. */
export function flowTick(f, dt, c = {}) {
  f.t += dt;
  switch (f.phase) {
    case 'lobby': {
      if (c.ceremony) return null;                                                                              // (Step 80e: the trophy ceremony is timed by the domain, which then starts a fresh party)
      const wait = f.first ? F.lobbyFirst : F.lobby;
      if (c.mode === 'pick' && !c.pickChosen) return f.t >= Math.max(wait, F.pickWait) ? 'pick' : null;           // pick mode: the board decides, but never stalls
      return f.t >= wait ? 'pick' : null;
    }
    case 'pick': return f.t >= F.roulette ? (c.howtoSeen ? 'countdown' : 'howto') : null;
    case 'howto': {
      if (!(c.humans > 0)) return f.t >= F.howtoBots ? 'countdown' : null;                                       // only bots: no one to wait for
      if (c.allReady && f.t >= F.howtoMin) return 'countdown';
      return f.t >= F.howtoMax ? 'countdown' : null;
    }
    case 'countdown': return f.t >= F.countdown ? 'play' : null;
    case 'play': {
      if (c.gameDone && (c.doneFor ?? 0) >= (c.tail ?? 0)) return 'results';
      return f.t >= (c.gameCap ?? 90) ? 'results' : null;
    }
    case 'results': return f.t >= (c.lastRound ? F.partyOver : F.results) ? 'lobby' : null;
    default: return null;
  }
}

export function countdownLabel(t) { return t < 1 ? '3' : t < 2 ? '2' : '1'; }
export const goLabel = (gt) => (gt >= 0 && gt < 0.8 ? 'Go!' : '');

// ---------------------------------------------------------------------------------------------------------------- the shuffle bag
export function shuffle(list, rng) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/**
 * The next game. `bag` = the games not yet played in this cycle (stale ids are dropped); an empty bag is refilled with a shuffle of the ENABLED games, and if its first would repeat `last` another one
 * comes first. `forced` (a "Play this one next" from the board) is taken out of the bag and played now.
 */
export function drawGame({ bag = [], enabled, last = null, rng, forced = null }) {
  let rest = bag.filter((id) => enabled.includes(id));
  if (forced && enabled.includes(forced)) return { game: forced, bag: rest.filter((id) => id !== forced) };
  if (!rest.length) {
    rest = shuffle(enabled, rng);
    if (rest.length > 1 && rest[0] === last) { const j = 1 + Math.floor(rng() * (rest.length - 1)); [rest[0], rest[j]] = [rest[j], rest[0]]; }
  }
  const [game, ...tail] = rest;
  return { game, bag: tail };
}

// ---------------------------------------------------------------------------------------------------------------- the board
export function toggleGame(enabled, id, on, allIds) {
  if (!allIds.includes(id)) return { ok: false, enabled, reason: 'unknown' };
  const has = enabled.includes(id);
  if (on === has) return { ok: true, enabled, same: true };
  if (!on) {
    if (enabled.length <= 1) return { ok: false, enabled, reason: 'last' };
    return { ok: true, enabled: enabled.filter((g) => g !== id) };
  }
  return { ok: true, enabled: allIds.filter((g) => g === id || enabled.includes(g)) };                      // (registry order, so the board never reshuffles)
}

export function normalisePrefs(raw, allIds) {
  let d = raw;
  if (typeof d === 'string') { try { d = JSON.parse(d); } catch { d = null; } }
  if (!d || typeof d !== 'object') d = {};
  let enabled = Array.isArray(d.enabled) ? allIds.filter((id) => d.enabled.includes(id)) : allIds.slice();
  if (!enabled.length) enabled = allIds.slice();
  const bots = d.bots === 'fill' ? 'fill' : Number.isInteger(d.bots) && d.bots >= 0 && d.bots <= 3 ? d.bots : 'fill';
  return {
    enabled,
    mode: PARTY.modes.includes(d.mode) ? d.mode : PARTY.defaultMode,
    rounds: Number.isInteger(d.rounds) && d.rounds >= 1 && d.rounds <= 30 ? d.rounds : PARTY.rounds,
    bots,
    difficulty: PARTY.difficulties.includes(d.difficulty) ? d.difficulty : PARTY.defaultDifficulty,
  };
}

/** `bots` from a URL / API value ('fill', '0'..'3', a number). */
export function parseBots(v) {
  if (v === 'fill' || v === undefined || v === null || v === '') return 'fill';
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 3 ? n : 'fill';
}

export function awardStars(stars, ranks) {
  const out = { ...stars };
  for (const r of ranks) if (r.place === 1) out[r.slot] = (out[r.slot] || 0) + PARTY.stars;
  return out;
}

export function awardBonus(stars, slots) {
  const out = { ...stars };
  for (const s of slots || []) out[s] = (out[s] || 0) + PARTY.bonusStars;
  return out;
}

export function finalPlaces(stars, roster) {
  const rows = roster.map((r) => ({ slot: r.slot, stars: (stars && stars[r.slot]) || 0 })).sort((a, b) => b.stars - a.stars || a.slot - b.slot);
  let place = 1;
  return rows.map((r, i) => { if (i > 0 && r.stars !== rows[i - 1].stars) place = i + 1; return { slot: r.slot, place, stars: r.stars }; });
}

/** How many bots a roster needs: 'fill' keeps the table at 4, a number is a fixed count, never beyond the free seats. */
export function botsWanted(humans, bots) {
  const free = Math.max(0, 4 - humans);
  return bots === 'fill' ? free : Math.min(free, bots);
}
