// Step 72a: the host-authoritative, session-only `fishing` sync domain: the fish spots on Duskcrown's ponds and the cast / reel requests. Independent of rendering and of the world (Node pair tests);
// the angler's screen is world/fishingPlay.js, the spot rings are world/fishingVisuals.js. Rules: game/fishingLogic.js.
//
//   const fishing = createFishing({ sync, ponds, inventory?, collection?, seed?, rareBoost?, wantRare? })      rareBoost() = an extra Lanternkoi chance added at chance spots (Step 73b: Capray's stage-4 pity, game/capray.js); wantRare() = true keeps orange spots on the deep ponds (FISHING.wantChance); ponds = islands/duskHearth.js duskFishPonds(); collection = the Journal (game/collection.js): the HOST awards the species' entry on a catch (first catch only: the log rejects duplicates, Step 72b)
//   fishing.advance(secs)         HOST debug: run the clock forward
//   fishing.update(dt)            once per tick: the HOST advances its game clock (spots move on, casts that never got their reel are dropped); a replica does nothing. Frozen while the host is away.
//   fishing.spots                 the active spots on every screen: [{ id, pond, x, z, kind: 'common' | 'chance', by: actorKey | null, ph }]   fishing.pond(id) / fishing.ponds
//   fishing.cast(player, pond, { x, z })     ask the host to cast: host -> { ok, result }, replica -> Promise of it. result = { cast, empty, x, z, spot, pond, nibbles, bites } -- the schedule (never the species);
//                                            `empty` = no free spot near the bobber (cast = null, nothing is held)
//   fishing.reel(player, castId, presses)    the angler's own screen judged the presses against its clock; the host re-checks them with FISHING.slack: -> catch / miss. fishing.cancel(player, castId) reels in.
//   fishing.on(fn)                fn(kind, data) for 'spots' | 'catch' {actor, fish, spot, pond} | 'miss' {actor, reason, spot, pond} | 'snapshot', on every screen (host too). 72b hooks the catch moment here.
//   fishing.summary()             debug digest
// Requests: cast {pond, x, z} | reel {cast, presses, cancel?} | host-only debugSpawn {pond, kind} / debugBite (next reel is judged as a catch) / debugCatch {fish}. Events: spots {list} (every change of the list, incl. claims),
// catch, miss. Snapshot = hashView = {spots}. A catch adds the fish to the shared bag on the host (inventory.add) and awards its Journal entry (collection.award, which emits its own `found` event) BEFORE the catch event; `until` and the casts stay host-only.
import { FISHING } from '../config.js';
import { mulberry32 } from '../utils/rng.js';
import { actorKey } from '../net/worldSync.js';
import {
  createSpotSim, tickSpots, spotList, findSpot, claimSpot, releaseSpot, nearestSpot, clampInside,
  rollSpecies, rollSchedule, scheduleView, castEnd, judgePresses, validateCast, validateReel, spotPoint,
} from './fishingLogic.js';

/** "screen:index" (worldSync actorKey) -> { screen, index } | null. Screen ids may contain ':', the player index never does. */
export function parseActorKey(key) {
  const i = typeof key === 'string' ? key.lastIndexOf(':') : -1;
  const index = i > 0 ? Number(key.slice(i + 1)) : NaN;
  return Number.isInteger(index) && index >= 0 ? { screen: key.slice(0, i), index } : null;
}

export function createFishing({ sync, ponds, inventory = null, collection = null, seed = FISHING.seed, rareBoost = () => 0, wantRare = () => false }) {
  const spotCfg = () => (wantRare() ? { ...FISHING, chanceOdds: 1, minChance: FISHING.wantChance } : FISHING);      // (Capray's stage 4: orange spots on every deep pond, at least FISHING.wantChance of them)
  const byId = new Map(ponds.map((p) => [p.id, p]));
  const rng = mulberry32(seed), castRng = mulberry32(seed ^ 0x9e3779b9);
  let sim = sync.isHost ? createSpotSim(rng, ponds) : null;           // host only
  let spots = sim ? spotList(sim) : [];
  const casts = new Map();                                            // host: castId -> { id, key, spot, species, sched, view, at, end }
  const listeners = [];
  let castSerial = 0, forceCatch = false;
  const fire = (kind, data) => listeners.forEach((fn) => { try { fn(kind, data); } catch (e) { console.error(e); } });
  const apply = (kind, d) => {
    if (kind === 'spots' || kind === 'snapshot') spots = Array.isArray(d?.list || d?.spots) ? (d.list || d.spots).map((s) => ({ ...s })) : [];
    fire(kind, d);
  };
  const publish = (kind, d) => { apply(kind, d); sync.emit('fishing', kind, d); };
  const publishSpots = () => publish('spots', { list: spotList(sim) });

  function release(cast, { move = true } = {}) {
    casts.delete(cast.id);
    if (cast.spot && findSpot(sim, cast.spot)) releaseSpot(sim, cast.spot, rng, { move });
  }
  function dropCastOf(key) {
    for (const c of [...casts.values()]) if (c.key === key) { release(c, { move: false }); return true; }       // a re-cast reels the old line in (its spot stays)
    return false;
  }

  function handleCast(d, actor) {
    const key = actorKey(actor), pond = byId.get(d?.pond);
    const bad = validateCast(d, { pond, pos: actor?.pos });
    if (bad) return { reject: bad };
    const had = dropCastOf(key);
    const at = clampInside(pond, d.x, d.z);
    const near = nearestSpot(spotList(sim).filter((s) => s.pond === pond.id), at.x, at.z, FISHING.snap);
    const spot = near && !near.by ? claimSpot(sim, near.id, key) : null;      // the first cast claims a spot; a second cast at a claimed spot is just an empty cast
    let result;
    if (!spot) result = { cast: null, empty: true, x: at.x, z: at.z, spot: null, pond: pond.id, nibbles: [], bites: [] };
    else {
      const boost = rareBoost(), species = rollSpecies(castRng, spot.kind, boost > 0 ? { ...FISHING, rareChance: FISHING.rareChance + boost } : FISHING), sched = rollSchedule(castRng, species), view = scheduleView(sched);
      const cast = { id: `c${++castSerial}`, key, spot: spot.id, pond: pond.id, species, sched, view, at: sim.clock, end: sim.clock + castEnd(view) };
      casts.set(cast.id, cast);
      result = { cast: cast.id, empty: false, x: spot.x, z: spot.z, spot: spot.id, pond: pond.id, nibbles: view.nibbles, bites: view.bites };
    }
    if (spot || had) publishSpots();
    return { result };
  }

  function handleReel(d, actor) {
    const key = actorKey(actor), cast = casts.get(d?.cast);
    const bad = validateReel(d, cast, { key, elapsed: cast ? sim.clock - cast.at : 0 });
    if (bad) return { reject: bad };
    const info = { actor: key, spot: cast.spot, pond: cast.pond };
    if (d.cancel === true) { release(cast, { move: false }); publishSpots(); publish('miss', { ...info, reason: 'cancel' }); return true; }
    const verdict = forceCatch ? { result: 'catch' } : judgePresses(cast.view, d.presses);
    forceCatch = false;
    casts.delete(cast.id);                                           // replay protection: a cast is judged once
    if (verdict.result === 'catch') {
      if (inventory) inventory.add(cast.species, 1);
      collection?.award(cast.species, parseActorKey(key));
      releaseSpot(sim, cast.spot, rng, { move: true });                // the fish is gone from the water: the spot moves on
      publishSpots();
      publish('catch', { ...info, fish: cast.species });
    } else {
      releaseSpot(sim, cast.spot, rng, { move: verdict.result === 'fled' });   // a scared fish moves the spot away early; a missed bite leaves it to try again
      publishSpots();
      publish('miss', { ...info, reason: verdict.result === 'fled' ? 'fled' : verdict.reason || 'late' });
    }
    return true;
  }

  sync.register('fishing', {
    snapshot: () => ({ spots: spots.map((s) => ({ ...s })) }),
    hashView: () => ({ spots: spots.map((s) => ({ ...s })) }),
    applySnapshot: (d) => apply('snapshot', d || {}),
    applyEvent: (kind, d) => apply(kind, d || {}),
    handleRequest(kind, d, actor) {
      if (!sim) return { reject: 'not-host' };
      if (kind === 'cast') return handleCast(d, actor);
      if (kind === 'reel') return handleReel(d, actor);
      if (kind === 'debugCatch') {
        if (actor?.screen !== 'host' || (d?.fish !== 'glimmerfin' && d?.fish !== 'lanternkoi')) return { reject: 'bad-request' };
        if (inventory) inventory.add(d.fish, 1);
        collection?.award(d.fish, parseActorKey(actorKey(actor)));
        publish('catch', { actor: actorKey(actor), spot: null, pond: null, fish: d.fish });
        return true;
      }
      if (kind === 'debugSpawn' || kind === 'debugBite') {
        if (!actor || actor.screen !== 'host') return { reject: 'bad-request' };
        if (kind === 'debugBite') { forceCatch = true; return true; }
        const pond = byId.get(d?.pond);
        if (!pond) return { reject: 'no-pond' };
        const kindOf = d.kind === 'chance' ? 'chance' : 'common', pt = spotPoint(rng, pond, kindOf);
        const slot = sim.slots.find((s) => !s.spot) || sim.slots.find((s) => !s.spot?.by);       // reuse an empty slot, else the first unclaimed one
        if (!slot) return { reject: 'busy' };
        if (slot.spot) releaseSpot(sim, slot.spot.id, rng, { move: true });
        slot.spot = { id: `fish-${++sim.serial}`, pond: pond.id, x: pt.x, z: pt.z, kind: kindOf, by: null, ph: 1, until: sim.clock + 90 };
        publishSpots();
        return { result: { spot: slot.spot.id, x: pt.x, z: pt.z } };
      }
      return { reject: 'unknown-kind' };
    },
    screenLeft(screenId) {                                            // a screen stayed away past the grace period: its anglers reel in
      if (!sim) return;
      let any = false;
      for (const c of [...casts.values()]) if (c.key.startsWith(`${screenId}:`)) { release(c, { move: false }); any = true; }
      if (any) publishSpots();
    },
  });

  return {
    get spots() { return spots; },
    ponds,
    pond: (id) => byId.get(id) || null,
    on(fn) { listeners.push(fn); return () => listeners.splice(listeners.indexOf(fn), 1); },
    update(dt) {
      if (!sim) return;
      let changed = tickSpots(sim, dt, rng, ponds, spotCfg());
      for (const c of [...casts.values()]) if (sim.clock >= c.end) { release(c, { move: false }); changed = true; publish('miss', { actor: c.key, spot: c.spot, pond: c.pond, reason: 'timeout' }); }
      if (changed) publishSpots();
    },
    /** HOST debug: run the host's clock forward by `secs` (spots move on, casts time out) -- the angler's debug skip-to-bite needs the host's clock to follow */
    advance(secs) { if (sim) for (let t = 0; t < secs; t += 0.25) this.update(Math.min(0.25, secs - t)); },
    cast: (p, pond, at) => sync.request('fishing', 'cast', { pond: typeof pond === 'string' ? pond : pond.id, x: at.x, z: at.z }, sync.actorFor(p)),
    reel: (p, castId, presses) => sync.request('fishing', 'reel', { cast: castId, presses }, sync.actorFor(p)),
    cancel: (p, castId) => sync.request('fishing', 'reel', { cast: castId, presses: [], cancel: true }, sync.actorFor(p)),
    debug: {
      spawn: (pond, kind = 'common') => sync.request('fishing', 'debugSpawn', { pond, kind }, sync.isHost ? { screen: 'host', index: 0, pos: { x: 0, y: 0, z: 0 } } : null),
      catch: (p, fish = 'glimmerfin') => sync.request('fishing', 'debugCatch', { fish }, sync.actorFor(p)),
      bite: () => sync.request('fishing', 'debugBite', {}, sync.isHost ? { screen: 'host', index: 0, pos: { x: 0, y: 0, z: 0 } } : null),
      get casts() { return [...casts.values()].map((c) => ({ id: c.id, key: c.key, spot: c.spot, species: c.species, view: c.view })); },
      get clock() { return sim ? sim.clock : null; },
    },
    summary() {
      return { host: !!sim, clock: sim ? +sim.clock.toFixed(2) : null, spots: spots.map((s) => ({ id: s.id, pond: s.pond, kind: s.kind, by: s.by })), casts: sim ? casts.size : null };
    },
  };
}
