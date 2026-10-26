// Step 74b: the host-authoritative `carle` sync domain: Carle's quest line "The Very Hungry Visitor" on the home island (the caterpillar's first sighting, seven feeding days from the shared bag, one feeding per
// in-game day, growth, the tummy ache and its cure). Independent of rendering and of the world (Node pair tests); the screens' side is world/carleWorld.js, the pure rules are game/carleLogic.js, the place
// world/islands/homeCarle.js. Step 74c adds the cocoon days, the hatch and Carle as a pet (TODO 74c markers).
//
//   const carle = createCarle({ sync, plan?, inventory?, pets?, clock?, params? })
//     plan = homeCarlePlan()               only `plan.spots` ([{ x, z }]: the perches) is used, to measure a REMOTE actor's reach
//     pets = the `pets` unlock domain      the quest does nothing ('locked') until pets.questlinesOpen (or ?testcarle)
//     clock = world/dayNight.js            the host counts DAWNS on it: `phase` events (playing) and `onCatchUp` (closed / hidden tab); call clock.flushCatchUp() once everything is created (main.js)
//   carle.state                            { stage, day, fedToday, cocoonDays, phase } (see carleLogic.js; `phase` is the host's private counter, null on a replica)      carle.stage / carle.open
//   carle.sight(p) / carle.feed(p, day)    ask the host: { ok } | { reject } (host: the answer now, replica: a Promise). `day` = the 1-based feeding day offered (carle.state.day + 1)
//   carle.on(fn)                           fn(kind, detail) on EVERY screen (host too): 'sight' | 'feed' {day, actor} | 'dawn' {n} | 'set' | 'reset' | 'snapshot'
//   carle.debug.{ stage(n), fedDays(k), feed(), dawn(n), reset() }     host debug requests (a replica's go through the same requests)
//
// Requests: sight {} | feed {day} | host-only debug {op, ...}. Every event carries the whole new state, so a replica can never drift. Snapshot = the state without `phase`; hashView = the same.
// DAY COUNTING (host only): `state.phase` is the last phase counted. A live `phase` event counts the dawns of the forward walk from it (a debug dayNight.set that jumps over a dawn counts it; ?daylock stops the
// clock, so nothing counts); a catch-up (clock.onCatchUp: the load one after the game was closed, or a hidden tab) counts `entered.dawn` and adopts the clock's phase. Each counted dawn only clears `fedToday`:
// the day number advances by FEEDING, so several dawns without feeding never skip a day. At load the saved phase is reconciled with the clock like the garden's (a replayed boundary counts nothing).
// A feeding removes the day's items from the shared bag in ONE step (inventory.removeAll) BEFORE the event, so two players can never spend the same items twice.
// Saved by the host as the `carle` key of 'infinite-island.home.v1' (game/homeSave.js: { stage, day, fedToday, cocoonDays, phase }); ?testcarle = the quest is open without Capray, nothing is read or written;
// ?newgame wipes the file once. Rejections: bad-request | locked | seen | unseen | done | wrong-day | full | far | none | not-host | unknown-kind.
import { CARLE } from '../config.js';
import { actorKey } from '../net/worldSync.js';
import { homeSave } from './homeSave.js';
import { reconcilePhase } from './gardenLogic.js';
import {
  freshState, normaliseState, savedView, wireView, hashView, debugState, validateSight, validateFeed, applySight, applyFeed, applyDawns, dawnsBetween, isFeeding, DAY_COUNT,
} from './carleLogic.js';

export const SAVE_KEY = 'carle';
const HOST_ACTOR = { screen: 'host', index: 0, pos: { x: 0, y: 0, z: 0 } };
const HOST_KEY = 'host:0';

export function createCarle({ sync, plan = null, inventory = null, pets = null, clock = null, params = new URLSearchParams() }) {
  const testcarle = params.has('testcarle');
  const saveOn = !testcarle && sync.isHost;
  let state = freshState();
  if (sync.isHost && !testcarle) state = normaliseState(homeSave.read()[SAVE_KEY]);
  if (sync.isHost && clock) {
    // the load catch-up already moved the clock: adopt its phase (the dawns it crossed are counted by flushCatchUp -> onCatchUp), else keep the saved one unless it is out of step (see the header)
    const away = clock.away && clock.away.seconds > 0;
    state = { ...state, phase: away ? clock.phase : reconcilePhase(state.phase, clock.phase) };
  }
  const listeners = [];
  const fire = (kind, detail) => listeners.forEach((fn) => { try { fn(kind, detail || {}, state); } catch (e) { console.error(e); } });
  const save = () => { if (saveOn) homeSave.set(SAVE_KEY, savedView(state)); };
  const isOpen = () => testcarle || !!(pets && pets.questlinesOpen);
  const keyOf = (actor) => (actor ? actorKey(actor) : null);
  const remote = (actor) => !!actor && actor.screen !== 'host' && !!actor.pos;
  const spotDist = (pos) => (plan && plan.spots && plan.spots.length ? Math.min(...plan.spots.map((s) => Math.hypot(pos.x - s.x, pos.z - s.z))) : null);

  function commit(next, kind, detail) {
    state = normaliseState(next);
    save();
    sync.emit('carle', kind, { ...detail, state: wireView(state) });
    fire(kind, detail);
  }

  // ---- the day counter (host only)
  /** `n` dawns were counted and the clock is now in `phase`. */
  function countDawns(n, phase) {
    const next = { ...state, phase: phase || state.phase };
    if (n > 0 && isFeeding(next) && next.fedToday) { commit(applyDawns(next, n), 'dawn', { n }); return; }
    state = next;
    if (state.stage > 0) save();                                   // (the private phase only matters once the quest began)
  }
  if (sync.isHost && clock && typeof clock.on === 'function') {
    clock.on('phase', (p) => { countDawns(state.phase ? dawnsBetween(state.phase, p) : 0, p); });
    if (typeof clock.onCatchUp === 'function') clock.onCatchUp((d) => { countDawns(Math.max(0, Math.floor(Number(d && d.entered && d.entered.dawn) || 0)), clock.phase); });
  }

  function handleRequest(kind, d, actor) {
    if (!sync.isHost) return { reject: 'not-host' };
    const key = keyOf(actor);
    if (kind === 'sight') {
      const bad = validateSight({ state, open: isOpen(), dist: remote(actor) ? spotDist(actor.pos) : null, range: CARLE.sight + CARLE.remoteSlack + 1.5 });
      if (bad) return { reject: bad };
      commit(applySight(state), 'sight', { actor: key });
      return true;
    }
    if (kind === 'feed') {
      const day = Number(d && d.day);
      const bad = validateFeed({ state, day, have: (id) => (inventory ? inventory.count(id) : 0), open: isOpen(), dist: remote(actor) ? spotDist(actor.pos) : null });
      if (bad) return { reject: bad };
      if (inventory && !inventory.removeAll({ ...CARLE.days[state.day].items })) return { reject: 'none' };
      commit(applyFeed(state), 'feed', { day, actor: key });
      return true;
    }
    if (kind === 'debug') return debug(d || {}, actor);
    return { reject: 'unknown-kind' };
  }

  function debug(d, actor) {
    if (!actor || actor.screen !== 'host') return { reject: 'bad-request' };
    const op = d.op;
    if (op === 'stage') { commit({ ...debugState(d.n), phase: state.phase }, 'set', {}); return true; }
    if (op === 'fedDays') { const k = Math.max(0, Math.min(DAY_COUNT, Math.floor(Number(d.k)) || 0)); commit({ ...debugState(k >= DAY_COUNT ? 3 : k >= 1 ? 2 : 1), day: k, phase: state.phase }, 'set', {}); return true; }
    if (op === 'reset') { commit({ ...freshState(), phase: state.phase }, 'reset', {}); return true; }
    if (op === 'feed') {                                          // the day's food, free; ignores the bag, the reach and "full"
      let s = state.stage === 0 ? applySight(state) : state;
      if (!isFeeding(s)) return { reject: 'done' };
      s = { ...s, fedToday: false };
      commit(applyFeed(s), 'feed', { day: s.day + 1, actor: HOST_KEY, free: true });
      return true;
    }
    if (op === 'dawn') { countDawns(Math.max(1, Math.floor(Number(d.n)) || 1), state.phase); return true; }
    return { reject: 'unknown-kind' };
  }

  sync.register('carle', {
    snapshot: () => wireView(state),
    hashView: () => hashView(state),
    applySnapshot(s) { state = normaliseState({ ...s, phase: null }); fire('snapshot'); },
    applyEvent(kind, d) { if (d && d.state) { state = normaliseState({ ...d.state, phase: null }); fire(kind, d); } },
    handleRequest,
  });

  const ask = (kind, data, p) => sync.request('carle', kind, data, p ? sync.actorFor(p) : null);
  const hostReq = (kind, data) => sync.request('carle', kind, data, sync.isHost ? { ...HOST_ACTOR } : null);

  return {
    get state() { return state; },
    get stage() { return state.stage; },
    get open() { return isOpen(); },
    get testcarle() { return testcarle; },
    on(fn) { listeners.push(fn); return () => listeners.splice(listeners.indexOf(fn), 1); },
    now: () => sync.hostNow(),
    sight: (p) => ask('sight', {}, p),
    feed: (p, day = state.day + 1) => ask('feed', { day }, p),
    debug: {
      stage: (n) => hostReq('debug', { op: 'stage', n }),
      fedDays: (k) => hostReq('debug', { op: 'fedDays', k }),
      feed: () => hostReq('debug', { op: 'feed' }),
      dawn: (n = 1) => hostReq('debug', { op: 'dawn', n }),
      reset: () => hostReq('debug', { op: 'reset' }),
    },
    summary: () => ({ ...wireView(state), phase: state.phase, saved: saveOn, testcarle, open: isOpen() }),
  };
}
