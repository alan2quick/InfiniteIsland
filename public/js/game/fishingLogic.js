// Pure fishing rules (PLAN Step 72a): where the fish spots are and how long they last, where a cast lands, the bite schedule the host rolls, and how a list of Interact presses is judged.
// No three.js, no DOM, no network: Node-tested in test/fishing.test.js. Times are seconds; positions are WORLD coordinates; a pond is
// { id, x, z, rx, rz, depth, deep, lagoon } (world/islands/duskHearth.js duskFishPonds: the `dusk-pond-NN` circles and the lagoon's ellipse).
//
//   Spots (host):    createSpotSim(rng, ponds, cfg?) -> sim           tickSpots(sim, dt, rng, ponds, cfg?) -> changed (spots live life[0]..life[1] s, then move to another pond after gap[0]..gap[1] s;
//                    cfg.minChance > 0 (Capray waits for a Lanternkoi): new spots go to deep ponds as orange 'chance' spots until there are that many, a common one moves on early to make room;
//                    spotList(sim) -> [{ id, pond, x, z, kind, by, ph }]   a claimed spot never expires while somebody is fishing it)        claimSpot(sim, id, key) / releaseSpot(sim, id, { move })
//                    pondS(p, x, z) (0 centre .. 1 edge)  pickSpotPond(rng, ponds, used, cfg?)  spotKindFor(rng, pond, cfg?)  spotPoint(rng, pond, kind, cfg?)
//   Casting:         aimCast(pond, from, facing, dist, cfg?) -> { x, z }      nearestSpot(spots, x, z, snap) -> spot | null      bobberFor(ponds, pos, facing, cfg?) -> { x, z, pond } | null (avatars)
//   Schedule (host): rollSchedule(rng, species, cfg?) -> { species, nibbles: [t], bites: [{ at, win }] }     scheduleView(s) -> what the caster gets (the same without the species)
//                    rollSpecies(rng, spotKind, cfg?) -> 'glimmerfin' | 'lanternkoi'
//   Judging:         judgePresses(view, presses, slack) -> { result: 'catch' | 'miss' | 'fled', reason?, stage }       (the angler's screen and the host run the SAME function)
//                    anglerStatus(view, presses, t, slack) -> { status, stage, ... } what the angler's bobber should be doing at `t` seconds after the cast
//   Host checks:     nearPond(p, pos, reach)   validateCast(...)   validateReel(...)   castEnd(view, cfg?) (when the host gives up on a cast)
import { FISHING } from '../config.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const between = (rng, [a, b]) => a + (b - a) * rng();
const r2 = (v) => Math.round(v * 100) / 100;

// ---------------------------------------------------------------------------------------------- ponds / spots
/** 0 at the pond's centre, 1 on its edge (ellipse for the lagoon). */
export const pondS = (p, x, z) => Math.hypot((x - p.x) / p.rx, (z - p.z) / p.rz);
/** Roughly how many units outside the edge the point is (negative inside). */
export const edgeDistance = (p, x, z) => (pondS(p, x, z) - 1) * Math.min(p.rx, p.rz);
export const nearPond = (p, pos, reach = FISHING.reach) => !!p && !!pos && Number.isFinite(pos.x) && Number.isFinite(pos.z) && edgeDistance(p, pos.x, pos.z) <= reach;

/** A spot's kind at a pond: only deep ponds (and the lagoon) can hold an orange 'chance' spot. */
export const spotKindFor = (rng, pond, cfg = FISHING) => (pond.deep && rng() < cfg.chanceOdds ? 'chance' : 'common');
/** A point inside the pond, uniformly by area within the kind's radius fraction of the pond. */
export function spotPoint(rng, pond, kind, cfg = FISHING) {
  const a = rng() * TAU, f = (kind === 'chance' ? cfg.chanceS : cfg.commonS) * Math.sqrt(0.08 + 0.92 * rng());
  return { x: r2(pond.x + Math.cos(a) * pond.rx * f), z: r2(pond.z + Math.sin(a) * pond.rz * f) };
}
/** A pond without a spot yet (uniform); every pond is used once the list runs out. */
export function pickSpotPond(rng, ponds, used, cfg = FISHING) {
  const free = ponds.filter((p) => !used.has(p.id));
  const list = free.length ? free : ponds;
  return list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
}

/** Host state of the spot schedule: `slots` = the active spots plus the clock of their next appearance. */
export function createSpotSim(rng, ponds, cfg = FISHING) {
  const sim = { clock: 0, serial: 0, slots: [] };
  for (let i = 0; i < cfg.spots; i++) {
    sim.slots.push({ spot: null, appearAt: 0 });
    appear(sim, sim.slots[i], rng, ponds, cfg);
    sim.slots[i].spot.until = sim.clock + between(rng, [cfg.life[0] * 0.25, cfg.life[1]]);     // staggered, so the whole set does not move at once
  }
  return sim;
}
const chanceCount = (sim) => sim.slots.filter((s) => s.spot && s.spot.kind === 'chance').length;
function appear(sim, slot, rng, ponds, cfg) {
  const used = new Set(sim.slots.filter((s) => s.spot).map((s) => s.spot.pond));
  const short = cfg.minChance > 0 && chanceCount(sim) < cfg.minChance, deep = short ? ponds.filter((p) => p.deep) : null;    // too few orange spots: this one goes to deep water
  const pond = pickSpotPond(rng, deep && deep.length ? deep : ponds, used, cfg), kind = short && pond.deep ? 'chance' : spotKindFor(rng, pond, cfg), pt = spotPoint(rng, pond, kind, cfg);
  slot.spot = { id: `fish-${++sim.serial}`, pond: pond.id, x: pt.x, z: pt.z, kind, by: null, ph: r2(rng() * TAU), until: sim.clock + between(rng, cfg.life) };
}
/** Advance the schedule by `dt`; returns true when the visible list changed (a spot left or appeared). */
export function tickSpots(sim, dt, rng, ponds, cfg = FISHING) {
  sim.clock += dt;
  let changed = false;
  if (cfg.minChance > 0 && chanceCount(sim) + sim.slots.filter((s) => !s.spot).length < cfg.minChance) {      // `minChance` (a quest wants a Lanternkoi): move one common spot on early to make room
    const free = sim.slots.filter((s) => s.spot && !s.spot.by && s.spot.kind === 'common').sort((a, b) => a.spot.until - b.spot.until)[0];
    if (free) free.spot.until = Math.min(free.spot.until, sim.clock);
  }
  for (const slot of sim.slots) {
    if (slot.spot) {
      if (slot.spot.by) continue;                                 // somebody is fishing it: it stays
      if (sim.clock >= slot.spot.until) { slot.spot = null; slot.appearAt = sim.clock + between(rng, cfg.gap); changed = true; }
    } else if (sim.clock >= slot.appearAt) { appear(sim, slot, rng, ponds, cfg); changed = true; }
  }
  return changed;
}
export const spotList = (sim) => sim.slots.filter((s) => s.spot).map((s) => ({ id: s.spot.id, pond: s.spot.pond, x: s.spot.x, z: s.spot.z, kind: s.spot.kind, by: s.spot.by, ph: s.spot.ph }));
export const findSpot = (sim, id) => sim.slots.find((s) => s.spot && s.spot.id === id)?.spot || null;
/** First cast claims a spot; a claimed spot is just an empty cast for everyone else. */
export function claimSpot(sim, id, key) {
  const spot = findSpot(sim, id);
  if (!spot || spot.by) return null;
  spot.by = key;
  return spot;
}
/** The fish was caught / fled / the cast ended: the spot is released (`move` = it goes away now, to appear elsewhere after the gap). */
export function releaseSpot(sim, id, rng, { move = true, cfg = FISHING } = {}) {
  const slot = sim.slots.find((s) => s.spot && s.spot.id === id);
  if (!slot) return false;
  if (move) { slot.spot = null; slot.appearAt = sim.clock + between(rng, cfg.gap); } else slot.spot.by = null;
  return true;
}

// ---------------------------------------------------------------------------------------------- casting
const inside = (p, x, z, cfg) => pondS(p, x, z) <= cfg.inside;
/**
 * Where the bobber lands: `dist` u along `facing` (yaw, 0 = +Z) from `from`, shortened until it is inside the pond's water; if the facing never meets the pond (the angler turned away) it flies
 * towards the pond's middle instead. Always a point inside the pond.
 */
export function aimCast(pond, from, facing, dist, cfg = FISHING) {
  const sx = Math.sin(facing), sz = Math.cos(facing);
  for (let d = dist; d >= 0.75; d -= 0.25) {
    const x = from.x + sx * d, z = from.z + sz * d;
    if (inside(pond, x, z, cfg)) return { x: r2(x), z: r2(z) };
  }
  const dx = pond.x - from.x, dz = pond.z - from.z, len = Math.hypot(dx, dz) || 1;
  for (let d = Math.min(dist, len); d >= 0; d -= 0.25) {
    const x = from.x + dx / len * d, z = from.z + dz / len * d;
    if (inside(pond, x, z, cfg)) return { x: r2(x), z: r2(z) };
  }
  const s = Math.max(pondS(pond, from.x, from.z), 1e-3), k = cfg.inside * 0.85 / s;                 // the angler stands far from the pond: the point nearest it, inside the water
  return { x: r2(pond.x + (from.x - pond.x) * Math.min(1, k)), z: r2(pond.z + (from.z - pond.z) * Math.min(1, k)) };
}
/** Clamp a point (a request's x / z) into the pond's water. */
export function clampInside(pond, x, z, cfg = FISHING) {
  const s = pondS(pond, x, z);
  if (s <= cfg.inside) return { x: r2(x), z: r2(z) };
  const k = cfg.inside / s;
  return { x: r2(pond.x + (x - pond.x) * k), z: r2(pond.z + (z - pond.z) * k) };
}
/** The spot nearest (x, z) within `snap` u (a cast "at the ring" lands on it), or null. */
export function nearestSpot(spots, x, z, snap = FISHING.snap) {
  let best = null, bd = snap;
  for (const s of spots) { const d = Math.hypot(s.x - x, s.z - z); if (d <= bd) { bd = d; best = s; } }
  return best;
}
/** An avatar's bobber (cosmetic, from its pose alone): the cast point of its facing at the middle of the cast range, in the nearest pond within reach. */
export function bobberFor(ponds, pos, facing, cfg = FISHING) {
  let best = null, bd = Infinity;
  for (const p of ponds) { const d = edgeDistance(p, pos.x, pos.z); if (d < bd) { bd = d; best = p; } }
  if (!best || bd > cfg.reach + 2) return null;
  const at = aimCast(best, pos, facing, (cfg.castMin + cfg.castMax) / 2, cfg);
  return { x: at.x, z: at.z, pond: best.id };
}

// ---------------------------------------------------------------------------------------------- the bite schedule
export function rollSpecies(rng, spotKind, cfg = FISHING) {
  return spotKind === 'chance' && rng() < cfg.rareChance ? 'lanternkoi' : 'glimmerfin';
}
/**
 * The host rolls the whole wait at cast time: 0..3 nibbles, the first bite 2..8 s after the cast, and (Lanternkoi) two more shorter bites. Times are seconds after the cast; each bite has a press
 * window `win`. The caster gets `scheduleView` (everything except the species name; a Lanternkoi's extra bites are visible in the list, which is the honest cost of judging on the angler's own clock).
 */
export function rollSchedule(rng, species, cfg = FISHING) {
  const wins = cfg.windows[species] || cfg.windows.glimmerfin;
  const at0 = r2(between(rng, cfg.bite)), nibbles = [];
  let n = Math.floor(rng() * (cfg.nibbles[1] - cfg.nibbles[0] + 1)) + cfg.nibbles[0], t = cfg.nibbleFrom;
  while (n-- > 0) {
    t += between(rng, cfg.nibbleGap);
    if (t > at0 - cfg.biteGap) break;                             // no room before the bite: fewer nibbles
    nibbles.push(r2(t));
  }
  const bites = [{ at: at0, win: wins[0] }];
  for (let i = 1; i < wins.length; i++) bites.push({ at: r2(bites[i - 1].at + bites[i - 1].win + between(rng, cfg.fightGap)), win: wins[i] });
  return { species, nibbles, bites };
}
export const scheduleView = (s) => ({ nibbles: s.nibbles.slice(), bites: s.bites.map((b) => ({ at: b.at, win: b.win })) });
/** When the host gives up on a cast that never gets its reel (the last window + FISHING.timeout). */
export const castEnd = (view, cfg = FISHING) => { const b = view.bites.at(-1); return b.at + b.win + cfg.timeout; };

// ---------------------------------------------------------------------------------------------- judging
/**
 * Judge the presses (seconds after the cast, any order) against the bites. A press has to land in [bite.at - slack, bite.at + win + slack] of the NEXT bite: earlier than that it scared the fish (a
 * nibble, or mashing), later than that was too slow, and a bite nobody pressed for is a miss. After the last bite is hit the fish is caught; presses after that are ignored.
 */
export function judgePresses(view, presses, slack = FISHING.slack) {
  const ps = (Array.isArray(presses) ? presses : []).filter(Number.isFinite).sort((a, b) => a - b);
  let i = 0;
  for (const t of ps) {
    if (i >= view.bites.length) break;
    const b = view.bites[i];
    if (t < b.at - slack) return { result: 'fled', reason: 'early', stage: i };
    if (t > b.at + b.win + slack) return { result: 'miss', reason: 'late', stage: i };
    i++;
  }
  if (i >= view.bites.length) return { result: 'catch', stage: i };
  return { result: 'miss', reason: 'late', stage: i };
}
/**
 * What the angler's screen shows `t` s after the cast, with the presses so far: 'wait' (before the first nibble), 'nibble' (a twitch happened; `nibbleIdx` counts them), 'bite' (the window of bite
 * `stage` is open: press now), 'hooked' (a bite was hit, waiting for the next), 'caught', 'fled' (pressed too early), 'missed' (a window ran out). Final statuses are the last three.
 */
export function anglerStatus(view, presses, t, slack = FISHING.slack) {
  const ps = presses.slice().sort((a, b) => a - b);
  let stage = 0;
  for (const p of ps) {
    if (stage >= view.bites.length) break;
    const b = view.bites[stage];
    if (p < b.at - slack) return { status: 'fled', stage };
    if (p > b.at + b.win + slack) return { status: 'missed', stage };
    stage++;
  }
  const nibbleIdx = view.nibbles.filter((n) => n <= t).length;
  if (stage >= view.bites.length) return { status: 'caught', stage, nibbleIdx };
  const b = view.bites[stage];
  if (t > b.at + b.win + slack) return { status: 'missed', stage, nibbleIdx };
  if (t >= b.at) return { status: 'bite', stage, nibbleIdx, left: b.at + b.win - t };
  return { status: stage > 0 ? 'hooked' : nibbleIdx > 0 ? 'nibble' : 'wait', stage, nibbleIdx };
}

// ---------------------------------------------------------------------------------------------- host validation
/** The cast request: the pond exists and the actor stands at its bank (a remote actor within FISHING.reach of the edge). */
export function validateCast(d, { pond, pos, cfg = FISHING } = {}) {
  if (!d || typeof d.pond !== 'string' || !Number.isFinite(d.x) || !Number.isFinite(d.z)) return 'bad-request';
  if (!pond) return 'no-pond';
  if (!nearPond(pond, pos, cfg.reach)) return 'far';
  if (Math.hypot(d.x - pos.x, d.z - pos.z) > cfg.castMax + cfg.reach + 2) return 'far';          // the bobber cannot be thrown across the pond
  return null;
}
/** The reel request: a known cast of THIS actor, a sane list of presses (none later than the cast has been running on the host), at most one per bite plus a couple. */
export function validateReel(d, cast, { key, elapsed, cfg = FISHING } = {}) {
  if (!d || typeof d.cast !== 'string') return 'bad-request';
  if (!cast) return 'unknown-cast';
  if (cast.key !== key) return 'not-yours';
  if (d.cancel === true) return null;
  if (!Array.isArray(d.presses) || d.presses.length > cast.view.bites.length + 4 || !d.presses.every((v) => Number.isFinite(v) && v >= 0 && v < 120)) return 'bad-request';
  if (d.presses.length && Math.max(...d.presses) > elapsed + cfg.slack + 0.25) return 'from-the-future';
  return null;
}
