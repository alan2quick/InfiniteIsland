// Step 86a: the host-authoritative `homestead` sync domain: the home island's LAYOUT (which native things were removed for good, which things the players planted, and whether Homesteading is unlocked).
// No rendering here: the screens' side is world/homesteadWorld.js (attached with `attach(world)`), the pure rules are game/homesteadLogic.js (budget, last-native guard, validation, state shapes).
//
//   const homestead = createHomestead({ sync, inventory?, albumComplete?, params?, save? })     create it BEFORE harvest / gathering: a joining replica applies the domain snapshots in registration order, and the placed
//                                                                               objects must exist before those two apply theirs
//   homestead.attach(world)        world = createHomesteadWorld(...): reads `world.natives()` ([{ id, kind }]) and applies the loaded layout (tombstones + placed objects) to the island
//   homestead.state / .unlocked / .budget() / .summary() / .can(kind) / .on(fn)    fn(kind, detail) on EVERY screen (host too): 'removed' | 'placed' | 'grew' | 'unlocked' | 'snapshot'
//   homestead.remove(id, player?) / place(kind, x, z, player?) / water(pid, player?) / unlock()     requests (host: the answer now, replica: a Promise); `remove`/`place` are HOST-SCREEN-ONLY (an online guest is refused)
//   homestead.debug.{ remove(id), place(kind, x, z, {stage}?), water(pid), unlock(), unlockScene(player?) }   host debug requests: skip the unlock gate and the cost (unlockScene = the Nabong unlock WITHOUT the album check, replayable)
//   homestead.unlockTalk(player)   Step 86b: Nabong's dialog ends here. Host validates: a host-screen actor, the home album complete (`albumComplete()`), not unlocked yet; then it unlocks for good and every screen plays
//                                  the "Nabong hands over the watering can" showcase for that actor (the 'unlocked' event carries { actor }). Resolves { ok, reason? } ('not-host' | 'album' | 'already').
//   homestead.canTalk(player?)     true when Nabong should offer the unlock row HERE: this screen is the host's, the album is complete and Homesteading is not unlocked yet
//   homestead.setMode(player, on) / inMode(player) / modes()   Step 86b: the per-player Homesteading MODE flag (screen-local, never synced or saved; 86c adds the behaviour). Only host-screen players, only once unlocked
//                                  (setMode returns false otherwise); fire('mode', { player, on }) on change. 86c: game/homesteadShape.js gives the mode its behaviour (Shape press, confirm, HUD, auto-leave).
//   homestead.kindOf(id) / canRemove(id)   Step 86c: the kind of a native / placed / 'spot:<sid>' id, and the LOCAL pre-check of a removal ({ ok, reason, kind, line }) from the synced state (the host re-checks)
//   homestead.remove(id, player, { shape: true, face })   a Shape removal: the host also needs the actor to HOLD the kind's tool (homesteadLogic.shapeRule; opts.heldKind(actor) from main.js) and be within reach, and
//                                  puts { shape: { dx, dz, tool, actor } } on the `removed` event, so every screen plays the normal fell / break / dig animation and the host gives the normal drops (world.retire, harvest.removeForGood, gathering.lastHarvest)
// Step 86e: the other islands' kinds. homestead.islands() = the islands whose kinds are listed ('home' + each island unlocked: the `islandsUnlocked()` provider of main.js reads the SAVED, synced flags the game already uses:
// Frostpine / Emberleaf = their bridge is built, Duskcrown = the boat has been there; none of them ever turns off, so a listed kind stays listed) plus the session override of unlockIslands() / ?homesteadall.
// homestead.kinds() = [{ kind, label, island, tab, listed, cost, weight }] (debug / the palette). The host refuses a kind whose island is not listed ('not-yet') and a different foreign kind past its budget's cap ('kind-cap', Step 86f: foreignKindCap.main / .deco).
// Requests (host validates everything; replicas apply events only, no optimistic state):
//   remove {id}           id = a native id ('tree:3', 'dig:2', see homesteadLogic.js) or a placed id ('p7'); 'spot:<sid>' = "the dig spot with that sid" (resolved to a native slot or a placed patch)
//   place {kind, x, z}    budget, cost (taken from the shared bag, atomically, unless debug), the spot (world.spotCheck) and the layer capacity are checked; trees/palms start as a 'sprout' (debug may pass stage)
//   water {pid}           the next growth stage straight away (decision 12: no waiting); any screen may water (a remote actor must be within HOMESTEAD.waterRange). The watering can itself comes with 86b.
//   unlock {}             debug only (the real unlock is Nabong's dialog, 86b)
// Step 86d: water {pid} from a real player needs the can in hand (strictWater, main.js; rejection 'no-can') and obeys the per-tree lock HOMESTEAD.waterLock (rejection 'busy', host clock `now`); debug.water skips both.
// Events: removed {id, sid?} | placed {rec} | grew {pid, stage, by?} (by = who watered: the waterer's screen nudges its camera) | unlocked {}. The rotation of a placed object is seeded by its pid (the same on every screen); nothing here uses Math.random.
// Snapshot / hashView / save = homesteadLogic.wireView: { unlocked, removed: [...], placed: [{pid, kind, x, z, rot, stage}], nextPid }. Saved by the HOST as the `homestead` key of 'infinite-island.home.v1' (game/homeSave.js);
// replicas never save. `?homestead` = unlocked for this session (the layout still saves). Rejections: not-host | album | already | locked | unknown-kind | not-yet | bad-request | budget | cost | spot | layer-full | gone | last-native | last-dig | far | maxed.
import { HOMESTEAD, WORLD_SEED } from '../config.js';
import { mulberry32 } from '../utils/rng.js';
import { homeSave } from './homeSave.js';
import {
  freshState, normaliseState, wireView, applyRemoved, applyPlaced, applyGrew, nextStage, usage, validateRemove, validatePlace, kindMeta, idOfPid, pidOfId, isDigSlot, lineFor, shapeToolOk, removeRejectLine,
} from './homesteadLogic.js';

export const SAVE_KEY = 'homestead';
const HOST_ACTOR = { screen: 'host', index: 0, pos: { x: 0, y: 0, z: 0 } };
const r2 = (v) => Math.round(v * 100) / 100;
/** The rotation of placed object `pid` (seeded: identical on every screen and after a reload). */
export const rotFor = (pid) => r2(mulberry32(WORLD_SEED + 8600 + pid)() * Math.PI * 2);

export function createHomestead({ sync, inventory = null, albumComplete = () => false, params = new URLSearchParams(), save = homeSave, heldKind = () => null, now = null, strictWater = false, islandsUnlocked = () => [] }) {
  const allIslands = params.has('homesteadall');
  const flag = params.has('homestead') || allIslands;
  const extraIslands = new Set(allIslands ? ['frost', 'ember', 'dusk'] : []);                  // the session override (unlockIslands / ?homesteadall); never saved
  const islandsNow = () => { const out = new Set(['home']); for (const i of islandsUnlocked() || []) out.add(i); for (const i of extraIslands) out.add(i); return [...out]; };
  const saveOn = sync.isHost;
  let state = freshState();
  if (sync.isHost) state = normaliseState(save.read()[SAVE_KEY]);
  let natives = [];
  let world = null;
  const inMode = new Set();                                    // LOCAL players in Homesteading mode (86c gives it behaviour); screen-local, not saved, not synced
  const listeners = [];
  const fire = (kind, detail) => listeners.forEach((fn) => { try { fn(kind, detail || {}, state); } catch (e) { console.error(e); } });
  const persist = () => { if (saveOn) save.set(SAVE_KEY, wireView(state)); };
  const eff = () => (flag && !state.unlocked ? { ...state, unlocked: true } : state);     // (the debug flag unlocks for the session only: it is never written)
  const hostActorOf = (actor) => !!actor && actor.screen === 'host';
  const bag = (id) => (inventory ? inventory.count(id) : 0);

  // ---- applying one change (host and replica share these; the host calls them from its request handler, a replica from applyEvent)
  function doRemoved(d) {
    state = applyRemoved(state, d.id);
    persist();
    if (world) world.retire(d.id, d, { animate: true });
    fire('removed', d);
  }
  function doPlaced(rec, animate = true) {
    state = applyPlaced(state, rec);
    persist();
    if (world) world.create(rec, { animate });
    fire('placed', { rec });
  }
  function doGrew(d) {
    state = applyGrew(state, d.pid, d.stage);
    persist();
    if (world) world.setStage(d.pid, d.stage, { animate: true, by: d.by });
    fire('grew', d);
  }
  function doUnlocked(d) { state = { ...state, unlocked: true }; persist(); fire('unlocked', d || {}); }

  // ---- host requests
  /** 'spot:<sid>' (a concrete dig spot) -> a placed patch's id or one native dig slot; any other id as is. { id, sid? } or { reject }. */
  function resolveId(raw) {
    let id = typeof raw === 'string' ? raw : '';
    const out = {};
    if (id.startsWith('spot:')) {                                    // a concrete dig spot: a placed patch, or one of the native wandering ones
      const info = world && world.spotInfo(Number(id.slice(5)));
      if (!info) return { reject: 'gone' };
      out.sid = info.sid;
      id = info.pid != null ? idOfPid(info.pid) : (natives.find((n) => isDigSlot(n.id) && !state.removed.includes(n.id)) || {}).id || '';
    }
    out.id = id;
    return { out };
  }
  /** The kind of a native id, a placed id ('p7') or 'spot:<sid>' (null when unknown). */
  function kindOfId(raw) {
    const r = resolveId(raw);
    if (r.reject) return null;
    const pid = pidOfId(r.out.id);
    if (pid !== null) { const rec = state.placed.find((p) => p.pid === pid); return rec ? rec.kind : null; }
    const n = natives.find((q) => q.id === r.out.id);
    return n ? n.kind : null;
  }
  const lockUntil = new Map();                                      // pid -> host clock time before which it cannot be watered again (only when a `now` clock is given)
  const SHAPE_REACH = 6.5;                                          // the host's reach check for a Shape removal (the client only offers it for the nearest target, ~2.5 u)

  function handleRemove(d, actor) {
    const hostActor = hostActorOf(actor);
    const debug = hostActor && d.debug === true;
    const res = resolveId(d.id);
    if (res.reject) return { reject: res.reject };
    const out = res.out;
    const id = out.id;
    const bad = validateRemove({ id, natives, state: eff(), hostActor, debug });
    if (bad) return { reject: bad };
    if (d.shape === true && !debug) {                                // Step 86c: Shape needs the kind's tool in hand and the target in reach; the fall / break direction is decided here
      const kind = kindOfId(id);
      if (!shapeToolOk(kind, heldKind(actor))) return { reject: 'no-tool' };
      const at = world && world.posOf ? world.posOf(id, out.sid) : null;
      let dx = 0, dz = 1;
      if (at && actor.pos) {
        const l = Math.hypot(at.x - actor.pos.x, at.z - actor.pos.z);
        if (l > SHAPE_REACH) return { reject: 'far' };
        if (l > 0.05) { dx = (at.x - actor.pos.x) / l; dz = (at.z - actor.pos.z) / l; } else { dx = Math.sin(Number(d.face) || 0); dz = Math.cos(Number(d.face) || 0); }
      }
      out.shape = { dx: r2(dx), dz: r2(dz), tool: heldKind(actor), actor: { screen: actor.screen, index: actor.index } };
    }
    if (isDigSlot(id) && out.sid == null) {                          // a live native dig removal needs a concrete spot to take away
      out.sid = world && world.wanderSid ? world.wanderSid() : null;
      if (out.sid == null && world) return { reject: 'gone' };
    }
    out.id = id;
    doRemoved(out);
    sync.emit('homestead', 'removed', out);
    return { result: out };
  }

  function handlePlace(d, actor) {
    const hostActor = hostActorOf(actor);
    const debug = hostActor && d.debug === true;
    const x = r2(Number(d.x)), z = r2(Number(d.z));
    const kind = String(d.kind);
    const meta = kindMeta(kind);
    const bad = validatePlace({
      kind, x, z, natives, state: eff(), bag, hostActor, debug,
      spot: world ? (k, px, pz) => world.spotCheck(k, px, pz) : null, layerFull: !!(world && meta && world.layerFull(kind)), islands: islandsNow(),
    });
    if (bad) return { reject: bad };
    if (!debug && inventory && Object.keys(meta.cost).length && !inventory.removeAll({ ...meta.cost })) return { reject: 'cost' };
    const pid = state.nextPid;
    const stage = meta.grows ? (debug && d.stage && ['sprout', 'sapling', 'grown'].includes(d.stage) ? d.stage : 'sprout') : 'grown';
    const rec = { pid, kind, x, z, rot: rotFor(pid), stage };
    doPlaced(rec);
    sync.emit('homestead', 'placed', { rec });
    return { result: { pid, rec } };
  }

  function handleWater(d, actor) {
    const pid = Math.floor(Number(d.pid));
    const rec = state.placed.find((p) => p.pid === pid);
    if (!rec || !actor) return { reject: 'gone' };
    if (!kindMeta(rec.kind).grows) return { reject: 'bad-request' };
    const stage = nextStage(rec.kind, rec.stage);
    if (!stage) return { reject: 'maxed' };
    if (!hostActorOf(actor) && actor.pos && Math.hypot(actor.pos.x - rec.x, actor.pos.z - rec.z) > HOMESTEAD.waterRange) return { reject: 'far' };
    const debug = hostActorOf(actor) && d.debug === true;
    if (strictWater && !debug && heldKind(actor) !== 'watering-can') return { reject: 'no-can' };      // Step 86d: the real game needs the watering can in hand (the debug calls and the 86a tests do not)
    if (now && !debug) {                                                                                  // ~1.5 s while the growth effect plays: one held press must not skip a stage
      const t = now();
      if (t < (lockUntil.get(pid) ?? -1)) return { reject: 'busy' };
      lockUntil.set(pid, t + HOMESTEAD.waterLock);
    }
    const out = { pid, stage, by: actor.index !== undefined ? { screen: actor.screen, index: actor.index } : null };
    doGrew(out);
    sync.emit('homestead', 'grew', out);
    return { result: out };
  }

  function handleRequest(kind, d, actor) {
    if (!sync.isHost) return { reject: 'not-host' };
    d = d || {};
    if (kind === 'remove') return handleRemove(d, actor);
    if (kind === 'place') return handlePlace(d, actor);
    if (kind === 'water') return handleWater(d, actor);
    if (kind === 'unlock') {
      if (!hostActorOf(actor)) return { reject: 'not-host' };
      if (d.nabong === true) {                                   // Step 86b: Nabong's dialog (host-screen players only); the debug scene skips the album check and may replay
        const debug = d.debug === true;
        if (!debug && state.unlocked) return { reject: 'already' };
        if (!debug && !albumComplete()) return { reject: 'album' };
        const who = Number.isInteger(actor.index) && actor.index >= 0 && actor.index <= 3 ? { screen: 'host', index: actor.index } : null;
        doUnlocked({ actor: who }); sync.emit('homestead', 'unlocked', { actor: who });
        return true;
      }
      if (d.debug !== true) return { reject: 'not-host' };
      if (!eff().unlocked || !state.unlocked) { doUnlocked(); sync.emit('homestead', 'unlocked', {}); }
      return true;
    }
    return { reject: 'unknown-kind' };
  }

  sync.register('homestead', {
    snapshot: () => wireView(eff()),
    hashView: () => wireView(eff()),
    applySnapshot(snap) {
      state = normaliseState(snap);
      if (world) world.applyLayout(wireView(state));
      fire('snapshot');
    },
    applyEvent(kind, d) {
      if (kind === 'removed') doRemoved(d);
      else if (kind === 'placed') doPlaced(normaliseState({ placed: [d.rec] }).placed[0] || d.rec);
      else if (kind === 'grew') doGrew(d);
      else if (kind === 'unlocked') doUnlocked(d);
    },
    handleRequest,
  });

  const ask = (kind, data, p) => sync.request('homestead', kind, data, p ? sync.actorFor(p) : null);
  const hostReq = (kind, data) => sync.request('homestead', kind, { ...data, debug: true }, sync.isHost ? HOST_ACTOR : null);

  return {
    get state() { return state; },
    get unlocked() { return eff().unlocked; },
    get natives() { return natives; },
    get testFlag() { return flag; },
    /** Step 86e: the islands whose kinds are listed now ('home' first). */
    islands: islandsNow,
    /** Debug: list every island's kinds without travelling (session only; nothing is saved). */
    unlockIslands() { for (const i of ['frost', 'ember', 'dusk']) extraIslands.add(i); fire('islands'); return islandsNow(); },
    /** Every kind with its island, whether it is listed now, and its cost / weight / budget. */
    kinds() {
      const isl = islandsNow();
      return Object.entries(HOMESTEAD.kinds).map(([kind, m]) => ({ kind, label: m.label, island: m.island, budget: m.budget, tab: m.budget === 'deco' ? 'decorations' : 'gathering', weight: m.weight, cost: { ...m.cost }, listed: !m.todo && isl.includes(m.island) }));
    },
    get hostScreen() { return sync.isHost; },
    on(fn) { listeners.push(fn); return () => listeners.splice(listeners.indexOf(fn), 1); },
    /** Connect the island: read its natives and apply the loaded layout (the host's load; a replica gets its layout from the snapshot afterwards). */
    attach(w) {
      world = w;
      natives = w.natives();
      if (sync.isHost) w.applyLayout(wireView(state), { host: true });
    },
    /** Let tests (or a headless host) supply the natives table. */
    setNatives(list) { natives = list; },
    kindOf: kindOfId,
    /** LOCAL pre-check before a confirm is even offered (the same rules the host applies): { ok, reason, kind, line }. */
    canRemove(raw) {
      const r = resolveId(raw);
      const kind = r.reject ? null : kindOfId(raw);
      const reason = r.reject || validateRemove({ id: r.out.id, natives, state: eff(), hostActor: sync.isHost });
      return { ok: !reason, reason: reason || null, kind, line: reason ? removeRejectLine(reason, kind) : null };
    },
    budget() { return usage({ natives, state: eff() }); },
    /** Quick UI check (no spot): null or a reason; `line` is the sentence to show. */
    can(kind) {
      const m = kindMeta(kind);
      const bad = validatePlace({ kind, x: 0, z: 0, natives, state: eff(), bag, hostActor: true, layerFull: !!(world && m && world.layerFull(kind)), islands: islandsNow() });
      return { reason: bad, line: bad ? lineFor(bad, m, usage({ natives, state: eff() })) : null };
    },
    remove: (id, p, o = {}) => ask('remove', o.shape ? { id, shape: true, face: Math.round((p && p.facing || 0) * 1000) / 1000 } : { id }, p),
    place: (kind, x, z, p) => ask('place', { kind, x, z }, p),
    water: (pid, p) => ask('water', { pid }, p),
    unlock: () => hostReq('unlock', {}),
    unlockTalk: (p) => ask('unlock', { nabong: true }, p),
    canTalk: () => sync.isHost && !eff().unlocked && !!albumComplete(),
    setMode(p, on = true) {
      if (!p || !sync.isHost || !eff().unlocked) return false;
      on = !!on;
      if (inMode.has(p) === on) return true;
      if (on) inMode.add(p); else inMode.delete(p);
      fire('mode', { player: p, on });
      return true;
    },
    inMode: (p) => inMode.has(p),
    modes: () => [...inMode],
    debug: {
      remove: (id) => hostReq('remove', { id }),
      place: (kind, x, z, o = {}) => hostReq('place', { kind, x, z, stage: o.stage }),
      water: (pid) => sync.request('homestead', 'water', { pid, debug: true }, sync.isHost ? HOST_ACTOR : null),
      unlock: () => hostReq('unlock', {}),
      unlockScene: (p) => sync.request('homestead', 'unlock', { nabong: true, debug: true }, sync.isHost ? { ...HOST_ACTOR, index: p?.index ?? 0 } : null),
    },
    summary() {
      const u = usage({ natives, state: eff() });
      return { ...wireView(eff()), saved: saveOn, flag, natives: natives.length, main: u.main, deco: u.deco, counts: u.counts };
    },
  };
}
