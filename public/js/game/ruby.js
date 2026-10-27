// Host-authoritative ruby domain. No day/night or offline-time dependency. Scene elapsed time is
// host wall time OR accumulated simulation time, whichever is later, so rapid stepping completes scenes.
import { RUBY } from '../config.js';
import { actorKey } from '../net/worldSync.js';
import { emberSave } from './emberSave.js';
import { freshState, normaliseState, debugState, requestSpot, validateRequest, applyRequest } from './rubyLogic.js';
export const SAVE_KEY = 'ruby';
export function createRuby({ sync, plan, inventory = null, pets = null, cinematic = null, heldKind = () => null, params = new URLSearchParams() }) {
  const testing = params.has('testruby'), saveOn = sync.isHost && !testing;
  let state = saveOn ? normaliseState(emberSave.read()[SAVE_KEY]) : freshState(), scene = null;
  const listeners = new Set();
  const wire = () => ({ ...state, scene: scene && { ...scene } });
  const fire = (kind, detail = {}) => { for (const fn of listeners) fn(kind, detail); };
  const open = () => testing || !!pets?.questlinesOpen;
  function commit(next, kind, detail = {}) {
    state = normaliseState(next);
    if (saveOn) emberSave.set(SAVE_KEY, state);
    sync.emit('ruby', kind, { ...detail, state: wire() }); fire(kind, detail);
  }
  function queue(kind, from) { scene = { kind, from, startAt: null, elapsed: 0 }; }
  function finish(kind) {
    if (!scene || scene.startAt === null) return false;
    const befriended = scene.kind === 'befriend'; scene = null;
    commit(befriended ? debugState(6) : state, kind);
    if (befriended) pets?.unlock('ruby');
    return true;
  }
  function debug(d, actor) {
    if (actor?.screen !== 'host') return { reject: 'not-host' };
    const op = d.op;
    if (op === 'stage' || op === 'reset') { scene = null; commit(op === 'reset' ? freshState() : debugState(d.n), 'set'); return true; }
    if (scene) return { reject: 'busy' };
    if (op === 'befriend') { commit({ ...debugState(5), homeReady: true }, 'set'); queue('befriend', 5); commit(state, 'queued'); return true; }
    if (op === 'give' && state.stage === 3) { inventory?.add('coconut', 1); commit(state, 'give'); return true; }
    if (op === 'give' && [1, 2, 4].includes(state.stage)) { commit({ ...state, shell: ({ 1: 'whelk', 2: 'turban', 4: 'conch' })[state.stage] }, 'give'); return true; }
    if (op === 'hop') { commit({ ...debugState(2), shell: 'turban' }, 'hop'); return true; }
    if (op === 'crack') { queue('swap', 3); commit(debugState(4), 'queued'); return true; }
    if (op === 'conch') { commit({ ...debugState(4), crustHits: RUBY.crustWork, shell: 'conch' }, 'crust'); return true; }
    if (op === 'hearth') { commit(debugState(5), 'set'); for (const [id, n] of Object.entries(RUBY.gifts)) inventory?.add(id, n); return true; }
    return { reject: 'stage' };
  }
  function handleRequest(kind, d, actor) {
    if (!sync.isHost) return { reject: 'not-host' };
    if (kind === 'debug') return debug(d || {}, actor);
    if (kind === 'skip') return finish('skip') || { reject: 'idle' };
    const at = plan[requestSpot(state, kind)], pos = actor?.pos;
    let dist = pos && at ? Math.hypot(pos.x - at.x, pos.z - at.z) : Infinity;
    // The final gift can also be selected from the hearth's own menu.
    if (kind === 'hearth' && pos && plan.fire) dist = Math.min(dist, Math.hypot(pos.x - plan.fire.x, pos.z - plan.fire.z));
    if (kind === 'hop' && (!pos || Math.abs(pos.y - plan.goal.y) > 0.65 || dist > plan.goal.r + (actor?.screen !== 'host' ? RUBY.remoteSlack : 0))) return { reject: 'far' };
    const tool = heldKind(actorKey(actor));
    const bad = validateRequest({ state, kind, open: open(), busy: !!scene || !!cinematic?.busy, dist, remote: actor?.screen !== 'host', tool, have: id => inventory?.count(id) || 0 });
    if (bad) return { reject: bad };
    const need = kind === 'coconut' ? { coconut: 1 } : kind === 'hearth' ? RUBY.gifts : null;
    if (need && !inventory?.removeAll({ ...need })) return { reject: 'items' };
    const next = applyRequest(state, kind, tool), from = state.stage;
    if (kind === 'hearth') queue('befriend', 5);
    else if (kind === 'offer' || (kind === 'hit' && next.stage === 4)) queue('swap', from);
    commit(next, scene ? 'queued' : kind, { actor: actorKey(actor), action: kind });
    return true;
  }
  sync.register('ruby', { snapshot: wire, hashView: wire, handleRequest,
    applySnapshot(s) { state = normaliseState(s); scene = s?.scene || null; fire('snapshot'); },
    applyEvent(kind, d) { if (d?.state) { state = normaliseState(d.state); scene = d.state.scene || null; fire(kind, d); } },
  });
  const request = (kind, p) => sync.request('ruby', kind, {}, p ? sync.actorFor(p) : null);
  const dbg = (op, n) => sync.request('ruby', 'debug', { op, n }, sync.isHost ? { screen: 'host', index: 0 } : null);
  return { get state() { return state; }, get stage() { return state.stage; }, get scene() { return scene; }, get open() { return open(); },
    request, sight: p => request('sight', p), skip: () => request('skip'),
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    sceneTime: () => scene?.startAt == null ? 0 : Math.max(scene.elapsed, (sync.hostNow() - scene.startAt) / 1000),
    update(dt = 0) {
      if (!sync.isHost) return;
      if (!scene && state.stage === 5 && state.homeReady) { queue('befriend', 5); commit(state, 'queued'); }
      if (scene?.startAt === null && !cinematic?.busy) { scene = { ...scene, startAt: sync.hostNow(), elapsed: 0 }; commit(state, 'start'); }
      else if (scene?.startAt != null) {
        scene = { ...scene, elapsed: Math.max(scene.elapsed + Math.max(0, Number(dt) || 0), (sync.hostNow() - scene.startAt) / 1000) };
        if (scene.elapsed >= (scene.kind === 'befriend' ? RUBY.befriendSeconds : RUBY.swapSeconds)) finish('finish');
        else { sync.emit('ruby', 'progress', { state: wire() }); }
      }
      if (state.stage === 6 && !scene && !pets?.has('ruby')) pets?.unlock('ruby');
    },
    debug: Object.fromEntries(['stage', 'give', 'hop', 'crack', 'conch', 'hearth', 'befriend', 'reset'].map(op => [op, n => dbg(op, n)])),
    summary: () => ({ ...wire(), open: open(), saved: saveOn, testruby: testing }),
  };
}
