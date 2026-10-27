// The boat quest's host-authoritative `boat` sync domain (PLAN Step 68a; rules in game/boatLogic.js). Skipper Marlo's wrecked outrigger at Emberleaf's cove: this module owns the state, the save, the
// unlock on the first Emberleaf feast and the requests; world/cove.js (the dressing), world/marlo.js (the otter) and world/hopCourses.js (the courses) read it.
//
//   const boat = createBoat({ sync, hud, sfx, clock, params })
//   boat.state                       the live state (see boatLogic.js); never mutate it from outside
//   boat.unlocked / boat.has(part)   shortcuts
//   boat.setGoals({ planks: {x, z, top} })  host checks every taker at goal top and within 2.2 u (remote pose slack 0.15 u)
//   boat.take(player, part)          ask the host to take a part (host: the answer now, replica: a Promise of it): { ok, reason? }
//   boat.on(fn)                      fn({ kind: 'unlock' | 'take' | 'set', live, part?, actor? }) on every screen after the state changed; live = a real event (not a load / snapshot / debug set)
//   boat.onFeastEnd({ n, fireId }) / boat.bannerNode(n) / boat.bannerHold(n)    the feast scene's reveal api: feast.addReveal('ember', boat). Host only, idempotent per feast number, never for free feasts
//   boat.request(kind, data, player) sight {post} | voyage | repair | nail {plank,hits:[{t,pos} x4]} | tar | seal {seam} | float | plug {leak}
//   boat.update() / setPartySize(fn) host expiry / exact float result; party size is sampled when a test starts
//   boat.setLookouts(posts) / setVoyageHandler(fn) / completeVoyage()  68d runtime wiring; only the host completes a voyage
//   boat.state.at / .discovered / boat.completeSail(to)  Step 71: which dock the boat is moored at ('ember' | 'duskcrown'), whether Duskcrown has been reached; host-only completeSail saves + emits event 'sailed' -> fire({ kind: 'sail', to, first })
//   boat.layout                     cove repair interaction positions and the deck course
//   boat.debug                       summary/unlock/take/reset/finishRepair/nail/seal/float/endFloat (main adds goto)
//
// Unlock: the FIRST feast held at the Emberleaf garden hearth sets `unlocked` (banner line "A foghorn echoes from the far shore..."). Old saves that already feasted there cannot be told apart exactly, so a save
// with ANY unlocked garland (emberleaf.v1.garlands) counts as unlocked. `?testboat` = unlocked without saving; `?bridges=open` does NOT unlock it.
// Repair state includes saved repair/nails and session-only tar/float (all times in host seconds).
// Save: the `boat` key of infinite-island.emberleaf.v1 (game/emberSave.js), host only; a replica starts fresh and waits for the snapshot.
import { BOAT, BOAT_REPAIR as R } from '../config.js';
import { emberSave } from '../game/emberSave.js';
import { freshBoat, normaliseBoat, boatHashView, unlockedFromGarlands, unlockOnFeast, validateTake, applyTake, PARTS, atBoatGoal } from '../game/boatLogic.js';

import { applyArrival } from '../game/boatSailLogic.js';
import { validateSight } from '../game/boatSightLogic.js';
import { coveLayout } from './islands/emberCove.js';
import { actorKey } from '../net/worldSync.js';
import { validateRepair, repairSave, leakSchedule, bilgeAt, floatResult, beatAt, tarHeat, repairReady, patched } from '../game/boatRepairLogic.js';

export function createBoat({ sync, hud = null, sfx = null, clock = null, params = new URLSearchParams() }) {
  const testboat = (params.has('testboat') || params.has('testruby'));
  const saveOn = !testboat && sync.isHost;
  let state = freshBoat();
  if (sync.isHost) {
    const file = emberSave.read();
    state = file.boat !== undefined ? normaliseBoat(file.boat) : freshBoat();
    if (file.boat === undefined && unlockedFromGarlands(file.garlands)) state.unlocked = true;      // the old-save migration (see the header)
    state.float = null; state.tar = {}; // session activity never resumes from disk
    if (testboat) state.unlocked = true;
  }
  const listeners = [];
  const goals = {};
  let posts = [];
  let evaluatedFeast = 0;
  let reveal = null;                                // { n } the latest unlock (a banner built after it still fills)
  const bannerNodes = new Map();                    // feast n -> [DOM nodes waiting for the result]
  const layout = coveLayout().repair;
  const consumed = new Map(); // actor -> last accepted beat: evidence cannot be replayed at another mark
  let partySize = () => 1;
  let voyageHandler = () => ({ reject: 'unavailable' });
  const now = () => sync.hostNow() / 1000;
  const save = () => { if (saveOn) emberSave.set('boat', repairSave(state)); };
  const fire = (info) => { for (const fn of listeners) { try { fn(info); } catch (e) { console.error(e); } } };
  const actorInfo = (a) => (a ? { screen: a.screen, index: a.index } : null);

  // ---- applying (every screen)
  function applyUnlock(n, live) {
    const changed = !state.unlocked;
    state.unlocked = true;
    if (live) {
      reveal = { n };
      for (const node of bannerNodes.get(n) || []) fillNode(node);
      if (sfx) sfx.play('foghorn', { vol: 0.8 });
      if (hud && changed) hud.toast(BOAT.unlockText, { icon: 'sparkle', duration: 4200 });
    }
    if (changed) fire({ kind: 'unlock', live });
  }
  function applyTaken(part, actor, live) {
    if (!applyTake(state, part)) return;
    fire({ kind: 'take', part, actor, live });
  }
  function replace(next, live = false) {
    state = normaliseBoat(next);
    consumed.clear();
    fire({ kind: 'set', live });
  }

  // ---- requests (host)
  function handleTake(d, actor, debug = false) {
    const part = d && d.part;
    if (!actor && !debug) return { reject: 'bad-request' };
    const goal = goals[part];
    const remote = !!actor && actor.screen !== 'host';
    const dist = !debug && actor?.pos && goal ? Math.hypot(actor.pos.x - goal.x, actor.pos.z - goal.z) : null;
    const v = validateTake(state, { part, dist, range: BOAT.reach, debug });
    if (!v.ok) return { reject: v.reason };
    if (!debug && !atBoatGoal(actor?.pos, goal, remote ? 0.15 : 0)) return { reject: 'far' };
    applyTaken(part, actorInfo(actor), true);
    save();
    sync.emit('boat', 'take', { part, actor: actorInfo(actor) });
    return { result: { part } };
  }
  function handleUnlock() {
    if (state.unlocked) return true;
    applyUnlock(0, true);
    save();
    sync.emit('boat', 'unlock', { n: 0 });
    return true;
  }
  function handleReset() {
    replace(freshBoat());
    save();
    sync.emit('boat', 'set', { state: JSON.parse(JSON.stringify(state)) });
    return true;
  }

  function publishRepair(kind, actor = null, detail = {}) {
    fire({ kind, actor: actorInfo(actor), live: true, ...detail });
    sync.emit('boat', 'repairState', { kind, state: JSON.parse(JSON.stringify(state)), actor: actorInfo(actor), ...detail });
  }
  function endFloat(pass) {
    if (!state.float?.running) return { reject: 'not-running' };
    state.float.bilge = bilgeAt(state.float, now());
    state.float.running = false;
    state.floated = !!pass;
    save(); publishRepair('endFloat', null, { pass: !!pass });
    return true;
  }
  function update() {
    if (!sync.isHost) return;
    const t = now();
    for (const [key, pot] of Object.entries(state.tar)) if (!tarHeat(pot, t)) {
      delete state.tar[key]; publishRepair('cool', null, { key });
    }
    if (state.float?.running) {
      state.float.bilge = bilgeAt(state.float, t);
      const result = floatResult(state.float, t);
      if (result !== null) endFloat(result);
    }
  }
  function handleRepair(kind, d, actor, debug = false) {
    if (!actor) return { reject: 'bad-request' };
    update(); // an expired pot / overflowing test cannot win between ticks
    const key = actorKey(actor), t = now();
    if (debug && (!repairReady(state) || !state.repair || (kind === 'float' && !patched(state)))) return { reject: 'wrong-order' };
    if (!debug) {
      const reason = validateRepair(state, kind, d, { pos: actor.pos, layout, now: t, key, lastBeat: consumed.get(key) });
      if (reason) return { reject: reason };
    }
    if (kind === 'repair') state.repair = true;
    else if (kind === 'nail') {
      if (!Number.isInteger(d.plank) || d.plank < 0 || d.plank > 3) return { reject: 'bad-request' };
      if (state.nails[d.plank] >= 2) return { reject: 'nailed' };
      state.nails[d.plank]++; state.planks++;
      if (!debug) consumed.set(key, beatAt(d.hits.at(-1).t));
    } else if (kind === 'tar') state.tar[key] = { at: t };
    else if (kind === 'seal') {
      if (!Number.isInteger(d.seam) || d.seam < 0 || d.seam > 2) return { reject: 'bad-request' };
      if (state.seams[d.seam]) return { reject: 'sealed' };
      state.seams[d.seam] = true; delete state.tar[key];
    } else if (kind === 'float') {
      if (state.float?.running) return { reject: 'running' };
      const party = Math.max(1, Math.min(4, Math.floor(partySize()) || 1));
      state.float = { running: true, t0: t, seed: R.float.seed, party, leaks: leakSchedule(R.float.seed, party), bilge: 0 };
    } else if (kind === 'plug') {
      const leak = state.float.leaks.find(l => l.id === d.leak);
      leak.pluggedAt = t; state.float.bilge = bilgeAt(state.float, t);
    }
    if (kind !== 'tar' && kind !== 'plug' && kind !== 'float') save();
    publishRepair(kind, actor, { plank: d.plank, seam: d.seam, leak: d.leak });
    return { result: { kind } };
  }
  sync.register('boat', {
    snapshot: () => JSON.parse(JSON.stringify(state)),
    hashView: () => boatHashView(state),
    applySnapshot(snap) { replace(snap, false); },
    applyEvent(kind, d) {
      if (kind === 'unlock') applyUnlock(d && Number.isInteger(d.n) ? d.n : 0, true);
      else if (kind === 'take' && d) applyTaken(d.part, d.actor || null, true);
      else if (kind === 'sight' && Number.isInteger(d?.post) && d.post >= 0 && d.post < 3) { state.sights[d.post] = true; fire({ kind: 'sight', post: d.post, live: true }); }
      else if (kind === 'launched') { state.launched = true; fire({ kind: 'launched', live: true }); }
      else if (kind === 'sailed' && (d?.to === 'ember' || d?.to === 'duskcrown')) { const r = applyArrival(state, d.to); fire({ kind: 'sail', to: d.to, first: r.first, live: true }); }
      else if (kind === 'set') replace(d && d.state, false);
      else if (kind === 'repairState') {
        state = normaliseBoat(d.state);
        fire({ kind: d.kind, actor: d.actor, live: true, key: d.key, pass: d.pass, plank: d.plank, seam: d.seam });
      }
    },
    screenLeft(screen) {
      let changed = false;
      for (const key of Object.keys(state.tar)) if (key.startsWith(`${screen}:`)) { delete state.tar[key]; changed = true; }
      for (const key of consumed.keys()) if (key.startsWith(`${screen}:`)) consumed.delete(key);
      if (changed) publishRepair('cool');
    },
    handleRequest(kind, d, actor) {
      if (kind === 'voyage') return voyageHandler(actor);
      if (kind === 'debugSight' && actor?.screen !== 'host') return { reject: 'bad-request' };
      if (kind === 'sight' || kind === 'debugSight') {
        const debug = kind === 'debugSight' && actor?.screen === 'host';
        const post = d?.post;
        const reason = validateSight(state, { post, hour: debug ? 22 : clock?.hour, pos: debug ? { ...posts[post], y: posts[post]?.top } : actor?.pos, posts, slack: actor?.screen === 'host' ? 0 : 0.15 });
        if (reason) return { reject: reason };
        state.sights[post] = true; save(); fire({ kind: 'sight', post, live: true }); sync.emit('boat', 'sight', { post });
        return true;
      }
      if (kind === 'take') return handleTake(d, actor);
      if (['repair', 'nail', 'tar', 'seal', 'float', 'plug'].includes(kind)) return handleRepair(kind, d || {}, actor);
      if (!actor || actor.screen !== 'host') return { reject: 'bad-request' };      // the debug requests are host only
      if (kind === 'debugFinishRepair') {
        state.unlocked = true; for (const p of PARTS) state.parts[p] = true;
        state.repair = true; state.planks = 8; state.nails.fill(2); state.seams.fill(true);
        state.floated = false; state.float = null; state.tar = {}; consumed.clear();
        save(); publishRepair('finishRepair'); return true;
      }
      if (kind === 'debugLaunch') {                                              // Step 71 debug: a finished, floated, charted, launched boat (so Set sail can be tested at once)
        state.unlocked = true; for (const p of PARTS) state.parts[p] = true;
        state.repair = true; state.planks = 8; state.nails.fill(2); state.seams.fill(true);
        state.floated = true; state.float = null; state.tar = {}; state.sights.fill(true); state.launched = true; consumed.clear();
        save(); publishRepair('finishRepair'); return true;
      }
      if (kind === 'debugEndFloat') return endFloat(d?.pass);
      if (kind === 'debugNail') return handleRepair('nail', d, actor, true);
      if (kind === 'debugSeal') return handleRepair('seal', d, actor, true);
      if (kind === 'debugFloat') return handleRepair('float', {}, actor, true);
      if (kind === 'debugTake') return handleTake(d, actor, true);
      if (kind === 'debugUnlock') return handleUnlock();
      if (kind === 'debugReset') return handleReset();
      return { reject: 'unknown-kind' };
    },
  });

  // ---- the feast reveal (feast.addReveal('ember', boat))
  function onFeastEnd({ n, fireId } = {}) {
    if (!sync.isHost || fireId !== 'ember' || !Number.isInteger(n) || n <= evaluatedFeast) return false;
    const r = unlockOnFeast(state, { n, free: false, last: evaluatedFeast });
    evaluatedFeast = n;
    if (!r.changed) return false;
    state.unlocked = false;                          // (applyUnlock flips it and fires, so the listeners see a change)
    applyUnlock(n, true);
    save();
    sync.emit('boat', 'unlock', { n });
    return true;
  }
  function fillNode(node) {
    node.innerHTML = '';
    const chip = document.createElement('div');
    chip.className = 'fb-hat fb-boat-line';
    chip.innerHTML = `<span>${BOAT.unlockText}</span>`;
    node.appendChild(chip);
    node.style.display = '';
  }
  const bannerHold = (n) => (reveal && reveal.n === n ? 1.0 : 0);
  function bannerNode(n) {
    const node = document.createElement('div');
    node.className = 'fb-boat';
    node.style.display = 'none';
    if (reveal && reveal.n === n) fillNode(node);
    else { const l = bannerNodes.get(n) || []; l.push(node); bannerNodes.set(n, l); if (bannerNodes.size > 4) bannerNodes.delete(bannerNodes.keys().next().value); }
    return node;
  }

  const hostActor = () => (sync.isHost ? { screen: 'host', index: 0, pos: { x: 0, y: 0, z: 0 } } : null);
  const summary = () => ({ repair: state.repair, nails: [...state.nails], tar: JSON.parse(JSON.stringify(state.tar)), float: state.float ? JSON.parse(JSON.stringify(state.float)) : null, unlocked: state.unlocked, parts: { ...state.parts }, planks: state.planks, seams: [...state.seams], sights: [...state.sights], floated: state.floated, launched: state.launched, at: state.at, discovered: state.discovered, testboat, evaluatedFeast });

  return {
    get state() { return state; },
    get unlocked() { return state.unlocked; },
    has: (part) => !!state.parts[part],
    setGoals(g) { Object.assign(goals, g); },
    setLookouts(p) { posts = p; },
    setVoyageHandler(fn) { voyageHandler = fn; },
    // Step 71: the host moves the boat (and its crew) to the other dock once the crossing is over; saved, synced as event 'sailed'
    completeSail(to) { if (!sync.isHost || !state.launched || state.at === to || (to !== 'ember' && to !== 'duskcrown')) return null; const r = applyArrival(state, to); save(); fire({ kind: 'sail', to, first: r.first, live: true }); sync.emit('boat', 'sailed', { to }); return r; },
    completeVoyage() { if (!sync.isHost || state.launched) return false; state.launched = true; save(); fire({ kind: 'launched', live: true }); sync.emit('boat', 'launched', {}); return true; },
    take(player, part) {
      const r = sync.request('boat', 'take', { part }, player ? sync.actorFor(player) : null);
      const arm = (res) => { if (res?.ok && part === 'sail' && player) {
        player._sailGlideArmed = true;
        if (player._cb) player._cb.glide = true;
      } return res; };
      return r?.then ? r.then(arm) : arm(r);
    },
    on(fn) { listeners.push(fn); },
    onFeastEnd, bannerNode, bannerHold,
    summary, update,
    layout,
    setPartySize(fn) { partySize = fn; },
    request(kind, data = {}, player) { return sync.request('boat', kind, data, player ? sync.actorFor(player) : null); },
    debug: {
      summary,
      sight: post => sync.request('boat', 'debugSight', { post }, hostActor()),
      sightAll: () => [0,1,2].map(post => sync.request('boat', 'debugSight', { post }, hostActor())),
      launch: () => sync.request('boat', 'debugLaunch', {}, hostActor()),
      finishRepair: () => sync.request('boat', 'debugFinishRepair', {}, hostActor()),
      nail: plank => sync.request('boat', 'debugNail', { plank }, hostActor()),
      seal: seam => sync.request('boat', 'debugSeal', { seam }, hostActor()),
      float: () => sync.request('boat', 'debugFloat', {}, hostActor()),
      endFloat: pass => sync.request('boat', 'debugEndFloat', { pass }, hostActor()),
      unlock: () => sync.request('boat', 'debugUnlock', {}, hostActor()),
      take: (part) => sync.request('boat', 'debugTake', { part }, hostActor()),
      reset: () => sync.request('boat', 'debugReset', {}, hostActor()),
      parts: PARTS,
    },
  };
}
