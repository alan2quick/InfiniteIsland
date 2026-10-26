// The Emberleaf terrace garden's state, its 16 plot interactables and the `garden` sync domain (PLAN Step 37b; Step 38b adds planting, tending, the night growth and cuttings; the garden jobs / stages
// of Step 39 build on it). This module holds the state, the host's rules and the sync; what a plot's interact DOES on a screen (menus, hints, sparkles) is world/planting.js, the visuals are
// world/islands/emberPlotVisuals.js.
//
//   const garden = createGarden({ world, sync, hud, clock, inventory })     once at load, on every screen (after createWorld; the plot spots come from world.ember.placement.garden.plots)
//   garden.state / garden.stage / garden.seeds             { stage, plots: [{ flower, stage, cut? }] x 16, seeds, sown, cuttings, phase } / the garden stage 0..3 / the seeds found (key items, not the bag; Step 38a)
//   garden.plots / garden.get(i)                           the 16 plot records ({ flower: string | null, stage: 'empty' | 'seed' | 'sprout' | 'bud' | 'bloom', cut?: true }) / one of them
//   garden.options()                                       what can be planted now: [{ flower, kind: 'seed' | 'cutting', n }] (game/gardenLogic.js plantOptions)
//   garden.bloomSpots()                                    the world positions of the plots in bloom (THREE.Vector3[])
//   garden.usable(i)                                       can plot i be planted at the current garden stage? (4 at stage 0, 8 at 1, 16 at 2+; game/gardenLogic.js)
//   garden.spring                                          { x, z, r } the hot spring ("Fill a coconut", world/planting.js)
//   garden.setPlot(i, { flower, stage })                   HOST only (a replica returns false): replace one plot, save, emit (debug / tests)
//   garden.setStage(n)                                     HOST only: the garden stage (Step 39's jobs); opens plots
//   garden.setSeeds(list)                                  HOST only: the seeds found (silent: no event fx; debug / tests)
//   garden.findSeed(id, actor, { debug })                  HOST only: the gameplay find (Step 38a): checks the id, 'already found' and the validator (below; skipped with debug), adds the seed, saves, emits `seed`.
//                                                          returns true | { reject }. A screen asks for it with sync.request('garden', 'findSeed', { id }, actor) (world/seeds.js does)
//   garden.setSeedValidator(fn)                            fn(id, actor) -> true | 'reason' (world/seeds.js: the right time of day, the shovel, the actor within reach)
//   garden.request(kind, data, player)                     ask the host for plant {plot, flower, kind} | tend {plot} | cutting {plot} | fill {} on behalf of a local player: { ok, reason } (a Promise on a replica)
//   garden.on('seed', fn)                                  fn({ id, actor, n }) on EVERY screen when a seed was found (an event; not for snapshots, so a late joiner gets no toast)
//   garden.on('fx', fn)                                    fn({ kind: 'plant' | 'tend' | 'cut', i, plot, actor }) on EVERY screen when a player planted / tended / took a cutting (events only)
//   garden.on('grow', fn)                                  fn({ plots: [{ i, plot }], phase }) on EVERY screen when the night clock grew plants (dusk: sprouts -> buds; dawn: buds -> blooms)
//   garden.on('change', fn)                                fn(state) on every screen after any change (an event, a snapshot, a debug set)
//   garden.setPlotHandler(fn)                              fn(i, kind, player): what interacting with plot i does ('Plant' | 'Tend' | 'Take cutting' | 'Look'); world/planting.js sets it
//   garden.items                                           the 16 interactables ({ type: 'plot', prompt: live, plotIndex })
//   garden.summary()                                       debug snapshot;  garden.debug.{ setPlot, setStage, reset, findSeed, plant, tend, cutting, grow, bloomAll } (any screen: they ask the host)
//
// Domain 'garden' (host-authoritative). State { stage, plots[16], seeds, sown, cuttings, phase }. Saved by the host as the `garden` key of 'infinite-island.emberleaf.v1' (game/emberSave.js: one shared file so the
// later steps add their keys without clobbering). ?newgame wipes it; replicas never save.
//   Event plot {i, plot, sown, cuttings, fx?, actor?}   one plot changed (a plant / tend / cutting, or a debug set): every screen applies it, the visuals follow, `fx` replays the cosmetics.
//   Event grow {plots: [{i, plot}], phase}              the clock entered `phase` (dusk | dawn) and grew these plots.        Event set {state}   debug / a stage change: replace everything silently.
//   Event seed {id, actor, n}   a seed was found (n = how many of the eight now): every screen adds it, the visuals follow and world/seeds.js plays the find's fx + toast.
//   Requests: findSeed {id} (a player's find; the host validates the rules, so a race on one seed has exactly one winner), plant {plot, flower, kind} (a seed still unplanted, or a cutting; the plot must be
//   usable and empty: a race on one plot has exactly one winner), tend {plot} (takes the flower's tending item from the shared bag), cutting {plot}, fill {} (a coconut -> a coconut of spring water at the hot spring),
//   debugFindSeed / debugSetPlot / debugSet / debugPlant / debugTend / debugCutting / debugGrow / debugBloomAll (ignore the rules).
//   Snapshot = the state (a late joiner sees every plot right away);  hashView = the save form of the state WITHOUT the host's private `phase`.
//
// GROWTH (host only; rules in game/gardenLogic.js). The host listens to the day clock's `phase` event and counts each boundary FORWARD from `state.phase` (the last phase it counted, saved on every boundary):
// entering dusk grows sprouts into buds, entering dawn grows buds into blooms. A reload mid-night (the saved clock may replay a boundary) and a replica joining mid-night (it never counts, it gets the
// snapshot) can therefore never double-count or skip a night; nothing grows while the clock is stopped (?daylock), the host's tab is hidden, or the page is closed (no offline catch-up).
//
// The plot interactables and the visuals are registered ONCE (the interactables here, at load; the visuals live in the Emberleaf island visuals and re-apply the current state whenever they are built, so
// `world.rebuild('ember')` changes nothing).
import * as THREE from 'three';
import { GARDEN, GARDEN_JOBS, ISLANDS } from '../config.js';
import { gardenJob, gardenNeeds, gardenProgress, jobsOpen, validateGardenGive, applyGardenGive } from '../game/gardenJobs.js';
import { addInteractable } from './interactables.js';
import { gardenView } from './islands/emberPlotVisuals.js';
import { EMBER_FEATURES } from './islands/ember.js';
import { emberSave } from '../game/emberSave.js';
import { isFlower } from '../game/flowers.js';
import { addSeed, seedCount } from '../game/seedLogic.js';
import {
  PLOT_COUNT, STAGES, freshState, normaliseState, normalisePlot, withPlot, isUsable, usableCount, plotPrompt, buildSave, readSave, hashView, clampStage,
  plantOptions, checkPlant, doPlant, checkTend, doTend, checkCut, doCut, growPhases, growNights, reconcilePhase,
} from '../game/gardenLogic.js';

const SAVE_KEY = 'garden';

export function createGarden({ world, sync, hud = null, clock = null, inventory = null, slots = null }) {
  let state = readSave(emberSave.read()[SAVE_KEY]);
  state.phase = reconcilePhase(state.phase, clock && clock.phase);          // the growth counter (see the header): keep the saved phase, or adopt the clock's
  const handlers = { change: new Set(), seed: new Set(), fx: new Set(), grow: new Set(), gift: new Set() };
  let plotHandler = null, seedValidator = null;
  let shownStage = state.stage, giving = false;
  const stageHandlers = new Set();
  function stageChanged(live = false) {
    if (shownStage === state.stage) return;
    shownStage = state.stage;
    for (const fn of stageHandlers) { try { fn(state.stage, { live }); } catch (e) { console.error(e); } }
  }
  const save = () => emberSave.set(SAVE_KEY, buildSave(state));
  const emberIsland = ISLANDS.find((i) => i.id === 'ember');
  const spring = { x: emberIsland.x + EMBER_FEATURES.spring.x, z: emberIsland.z + EMBER_FEATURES.spring.z, r: EMBER_FEATURES.spring.r };

  // ---------------------------------------------------------------- the 16 plot interactables (stable ids: registered once)
  const spots = (world && world.ember && world.ember.placement.garden.plots) || [];
  const items = spots.map((q) => {
    const item = addInteractable({
      type: 'plot', object: null, position: new THREE.Vector3(q.x, q.y, q.z), radius: GARDEN.plotRadius, prompt: plotPrompt(state, q.i),
      onInteract: (it, by) => interact(q.i, by),
    });
    item.plotIndex = q.i;
    return item;
  });

  function interact(i, by) {
    const kind = plotPrompt(state, i);
    if (plotHandler) plotHandler(i, kind, by);
    else if (hud) hud.toast(kind === 'Plant' ? 'You will need a seed first.' : 'Not yet.', { icon: 'sparkle', duration: 2400 });
  }

  /** Bring everything that shows the state up to date (prompts, plot visuals) and tell the listeners. */
  function refresh() {
    items.forEach((it, i) => { it.prompt = plotPrompt(state, i); });
    gardenView.refresh();
    for (const fn of [...handlers.change]) { try { fn(state); } catch (e) { console.error(e); } }
  }
  gardenView.setSource(() => state);
  const fire = (type, d) => { for (const fn of [...handlers[type]]) { try { fn(d); } catch (e) { console.error(e); } } };
  const whoIs = (actor) => (actor ? { screen: actor.screen, index: actor.index } : null);

  // ---------------------------------------------------------------- host-side changes
  function applyPlot(i, plot, d = null) {
    state = withPlot(state, i, plot);
    if (d && (Array.isArray(d.sown) || Array.isArray(d.cuttings))) state = normaliseState({ ...state, ...(Array.isArray(d.sown) ? { sown: d.sown } : {}), ...(Array.isArray(d.cuttings) ? { cuttings: d.cuttings } : {}) });
    refresh();
  }
  function hostSetPlot(i, plot) {
    if (!Number.isInteger(i) || i < 0 || i >= PLOT_COUNT) return false;
    applyPlot(i, plot);
    save();
    sync.emit('garden', 'plot', { i, plot: state.plots[i], sown: state.sown, cuttings: state.cuttings });
    return true;
  }
  /** HOST: commit a gameplay change of plot `i` (the new whole state): save, tell everybody, replay the cosmetics here. */
  function commit(next, i, fx, actor) {
    state = next;
    refresh();
    save();
    const who = whoIs(actor);
    sync.emit('garden', 'plot', { i, plot: state.plots[i], sown: state.sown, cuttings: state.cuttings, fx, actor: who });
    fire('fx', { kind: fx, i, plot: state.plots[i], actor: who });
  }
  function hostSet(next) {
    state = normaliseState(next);
    stageChanged();
    refresh();
    save();
    sync.emit('garden', 'set', { state: JSON.parse(JSON.stringify(state)) });
    return true;
  }

  /** HOST: the clock entered `phase` (or a debug grow): grow the plots, save, tell everybody. */
  function hostGrown(r, phase) {
    state = { ...r.state, phase: phase === undefined ? state.phase : phase };
    save();
    if (!r.changed.length) return false;
    refresh();
    const plots = r.changed.map((i) => ({ i, plot: state.plots[i] }));
    sync.emit('garden', 'grow', { plots, phase: phase || null });
    fire('grow', { plots, phase: phase || null });
    return true;
  }
  if (clock && typeof clock.on === 'function') {
    clock.on('phase', (p) => { if (sync.isHost) hostGrown(growPhases(state, state.phase, p), p); });
  }
  // Step 74b: a hidden-tab catch-up jumps the clock WITHOUT phase events; the garden keeps no offline growth, so it just adopts the new phase (counting nothing). (The load catch-up is covered by reconcilePhase above.)
  if (clock && typeof clock.onCatchUp === 'function') clock.onCatchUp((d) => { if (d && d.live && sync.isHost) hostGrown({ state, changed: [] }, clock.phase); });

  function hostFindSeed(id, actor, debug = false) {
    if (!isFlower(id)) return { reject: 'unknown' };
    if (state.seeds.includes(id)) return { reject: 'found' };
    if (!debug) {
      const v = seedValidator ? seedValidator(id, actor) : 'unavailable';
      if (v !== true) return { reject: String(v) };
    }
    state = { ...state, seeds: addSeed(state.seeds, id) };
    refresh();
    save();
    const who = whoIs(actor), n = seedCount(state.seeds);
    sync.emit('garden', 'seed', { id, actor: who, n });
    fire('seed', { id, actor: who, n });
    return true;
  }

  // ---------------------------------------------------------------- the gameplay requests (Step 38b)
  const near = (actor, x, z, r, reach) => !actor || actor.screen === 'host' || !actor.pos || Math.hypot(actor.pos.x - x, actor.pos.z - z) - r <= reach;
  const plotNear = (actor, i) => !items[i] || near(actor, items[i].position.x, items[i].position.z, GARDEN.plotRadius, GARDEN.reach);
  const asIndex = (v) => (Number.isInteger(Number(v)) && v !== null && v !== '' ? Number(v) : -1);
  const bad = { reject: 'bad-request' };

  function hostPlant(d, actor, debug = false) {
    if (!d) return bad;
    const i = asIndex(d.plot ?? d.i), flower = String(d.flower), kind = d.kind === 'cutting' ? 'cutting' : 'seed';
    const st = debug && kind === 'seed' && isFlower(flower) ? { ...state, seeds: addSeed(state.seeds, flower), sown: state.sown.filter((f) => f !== flower) } : state;   // debug: the seed is found and not yet planted
    const c = checkPlant(st, i, flower, kind);
    if (!c.ok) return { reject: c.reason };
    if (!debug && !plotNear(actor, i)) return { reject: 'far' };
    commit(doPlant(st, i, flower, kind), i, 'plant', actor);
    return true;
  }
  function hostTend(d, actor, debug = false) {
    if (!d) return bad;
    const i = asIndex(d.plot ?? d.i), c = checkTend(state, i);
    if (!c.ok) return { reject: c.reason };
    if (!debug) {
      if (!plotNear(actor, i)) return { reject: 'far' };
      if (!c.item || !inventory || !inventory.has(c.item)) return { reject: 'no-item' };
      inventory.remove(c.item, 1);
    }
    commit(doTend(state, i), i, 'tend', actor);
    return { result: { item: c.item } };
  }
  function hostCutting(d, actor, debug = false) {
    if (!d) return bad;
    const i = asIndex(d.plot ?? d.i), c = checkCut(state, i);
    if (!c.ok) return { reject: c.reason };
    if (!debug && !plotNear(actor, i)) return { reject: 'far' };
    commit(doCut(state, i), i, 'cut', actor);
    return true;
  }
  function hostFill(actor) {
    if (!near(actor, spring.x, spring.z, spring.r, GARDEN.springReach)) return { reject: 'far' };
    if (!inventory || !inventory.has('coconut')) return { reject: 'no-coconut' };
    inventory.remove('coconut', 1);
    inventory.add('spring-water', 1);
    return true;
  }
  function bloomAll() {
    return hostSet({ ...state, plots: state.plots.map((p) => (p.stage === 'empty' ? p : { ...p, stage: 'bloom' })) });
  }

  function applyGift(d) {
    state = normaliseState(d.state);
    stageChanged(!!d.completed);
    refresh();
    fire('gift', d);
  }
  function hostGive(d, actor, debug = false) {
    if (!d || giving) return { reject: 'bad-request' };
    if (!debug) {
      const pos = actor?.pos, entry = slots?.get(actor?.index);
      if (!actor || (slots && (!entry || entry.screen !== actor.screen || entry.away))) return { reject: 'not-your-player' };
      const spot = world?.ember?.placement.garden.mossback;
      if (!spot || !pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.z) || Math.hypot(pos.x - spot.x, pos.z - spot.z) > 6) return { reject: 'far' };
      if (d.job !== state.stage) return { reject: 'stale-job' };
    }
    const input = debug ? { ...state, sown: ['debug'] } : state;
    const v = validateGardenGive(input, d.item, d.n, debug ? 999 : inventory?.count(d.item) || 0);
    if (!v.ok) return { reject: v.reason };
    const r = applyGardenGive(state, d.item, v.n);
    giving = true;
    try {
      if (!debug && !inventory.remove(d.item, v.n)) return { reject: 'none' };
      const data = { item: d.item, n: v.n, state: r.state, completed: r.completed, actor: whoIs(actor) };
      applyGift(data); save(); sync.emit('garden', 'gift', data);
      return { result: { n: v.n, completed: r.completed, stage: state.stage } };
    } finally { giving = false; }
  }

  sync.register('garden', {
    snapshot: () => JSON.parse(JSON.stringify(state)),
    hashView: () => hashView(state),
    applySnapshot(s) { state = normaliseState(s); stageChanged(); refresh(); },
    applyEvent(kind, d) {
      if (kind === 'plot' && d) {
        applyPlot(d.i, d.plot, d);
        if (d.fx) fire('fx', { kind: d.fx, i: d.i, plot: state.plots[d.i], actor: d.actor || null });
      } else if (kind === 'grow' && d && Array.isArray(d.plots)) {
        for (const p of d.plots) state = withPlot(state, p.i, p.plot);
        refresh();
        fire('grow', { plots: d.plots.map((p) => ({ i: p.i, plot: state.plots[p.i] })), phase: d.phase || null });
      } else if (kind === 'set' && d) { state = normaliseState(d.state); stageChanged(); refresh(); }
      else if (kind === 'gift' && d) applyGift(d);
      else if (kind === 'seed' && d && isFlower(d.id)) {
        if (!state.seeds.includes(d.id)) { state = { ...state, seeds: addSeed(state.seeds, d.id) }; refresh(); }
        fire('seed', { id: d.id, actor: d.actor || null, n: Number(d.n) || seedCount(state.seeds) });
      }
    },
    handleRequest(kind, d, actor) {
      if (kind === 'give') return hostGive(d, actor);
      if (kind === 'debugGive') return hostGive(d, actor, true);
      if (kind === 'findSeed') return d ? hostFindSeed(String(d.id), actor) : { reject: 'bad-request' };
      if (kind === 'plant') return hostPlant(d, actor);
      if (kind === 'tend') return hostTend(d, actor);
      if (kind === 'cutting') return hostCutting(d, actor);
      if (kind === 'fill') return hostFill(actor);
      if (kind === 'debugFindSeed') return d ? hostFindSeed(String(d.id), actor, true) : { reject: 'bad-request' };
      if (kind === 'debugSetPlot') return d && hostSetPlot(d.i, d.plot) ? { result: true } : { reject: 'bad-request' };
      if (kind === 'debugSet') return hostSet(d && d.state) ? { result: true } : { reject: 'bad-request' };
      if (kind === 'debugPlant') return hostPlant(d, actor, true);
      if (kind === 'debugTend') return hostTend(d, actor, true);
      if (kind === 'debugCutting') return hostCutting(d, actor, true);
      if (kind === 'debugGrow') { hostGrown(growNights(state, d && d.n), undefined); return { result: true }; }
      if (kind === 'debugBloomAll') { bloomAll(); return { result: true }; }
      return { reject: 'unknown-kind' };
    },
  });

  const set = (patch) => hostSet({ ...state, ...patch });
  const ask = (kind, d, player) => sync.request('garden', kind, d, player ? sync.actorFor(player) : null);
  const summary = () => ({
    given: { ...state.given }, jobId: gardenJob(state)?.id || null, needs: gardenNeeds(state), progress: gardenProgress(state),
    stage: state.stage, usable: usableCount(state.stage), seeds: [...state.seeds], sown: [...state.sown], cuttings: [...state.cuttings], phase: state.phase,
    plots: state.plots.map((p, i) => ({ i, ...p, usable: isUsable(state.stage, i), prompt: items[i] ? items[i].prompt : null })),
    items: items.length,
  });

  return {
    get state() { return state; },
    get stage() { return state.stage; },
    get seeds() { return state.seeds; },
    get job() { return gardenJob(state); },
    get open() { return jobsOpen(state); },
    jobs: GARDEN_JOBS,
    needs: () => gardenNeeds(state), progress: () => gardenProgress(state),
    give: (player, item, n, job = state.stage) => ask('give', { item, n, job }, player),
    onStage(fn, { replay = true } = {}) { stageHandlers.add(fn); if (replay) fn(state.stage, { live: false }); return () => stageHandlers.delete(fn); },
    get plots() { return state.plots; },
    get: (i) => state.plots[i] || null,
    options: () => plantOptions(state),
    bloomSpots: () => state.plots.map((pl, i) => (pl.stage === 'bloom' && items[i] ? items[i].position : null)).filter(Boolean),     // where blooms are (fireflies gather there at night: fx/ambient.js)
    usable: (i) => isUsable(state.stage, i),
    spring,
    setPlot(i, plot) { return sync.isHost ? hostSetPlot(i, plot) : false; },
    setStage(n) { return sync.isHost ? set({ stage: clampStage(n), given: {} }) : false; },
    findSeed(id, actor = null, { debug = false } = {}) { return sync.isHost ? hostFindSeed(String(id), actor, debug) : { reject: 'not-host' }; },
    setSeedValidator(fn) { seedValidator = fn; },
    setSeeds(list) { return sync.isHost ? set({ seeds: Array.isArray(list) ? list : [] }) : false; },
    request: ask,
    on(type, fn) { (handlers[type] ||= new Set()).add(fn); return () => handlers[type].delete(fn); },
    setPlotHandler(fn) { plotHandler = fn; },
    items,
    summary,
    debug: {
      give: (item, n = 1) => sync.request('garden', 'debugGive', { item, n }, null),
      /** Show a plot at a growth stage (empty | seed | sprout | bud | bloom) with a flower id; asks the host, so it works from any screen and syncs. */
      setPlot: (i, stage = 'bloom', flower = 'preview') => sync.request('garden', 'debugSetPlot', { i, plot: normalisePlot({ flower, stage }) }, null),
      setStage: (n) => sync.request('garden', 'debugSet', { state: { ...state, stage: clampStage(n), given: {} } }, null),
      reset: () => sync.request('garden', 'debugSet', { state: { ...freshState(), phase: state.phase } }, null),
      /** Find a seed through the host, ignoring the time of day, the tool and the distance (any screen: it asks the host). */
      findSeed: (id) => sync.request('garden', 'debugFindSeed', { id }, null),
      /** Plant `flower` (its seed is found + unused for you) in plot i; tend it without using the bag; take a cutting; grow n whole nights; open every planted plot's bloom. All ask the host. */
      plant: (i, flower, kind = 'seed') => sync.request('garden', 'debugPlant', { i, flower, kind }, null),
      tend: (i) => sync.request('garden', 'debugTend', { i }, null),
      cutting: (i) => sync.request('garden', 'debugCutting', { i }, null),
      grow: (nights = 1) => sync.request('garden', 'debugGrow', { n: nights }, null),
      bloomAll: () => sync.request('garden', 'debugBloomAll', {}, null),
      stages: STAGES,
    },
  };
}
