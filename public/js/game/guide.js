// Session-only host guide domain. createGuide({sync,paths,players}); players() -> pure guide players.
// start(id,player?), reset(id), update(dt), summary(), state. Start validates reach; reset is host debug.
// Full state events include per-player catch serials; the owning screen applies each teleport once.
import { freshGuide, startGuide, stepGuide } from './guideLogic.js';
import { GUIDE } from '../config.js';
export function createGuide({ sync, paths = {}, players = () => [] }) {
  let state = Object.fromEntries(Object.entries(paths).map(([id, p]) => [id, freshGuide(p)]));
  const commit = s => { state = s; sync.emit('guide', 'state', state); };
  sync.register('guide', { snapshot: () => state, applySnapshot: s => { state = s; }, applyEvent: (_, s) => { state = s; },
    handleRequest(kind, d, a) {
      const path = paths[d.id]; if (!path) return { reject: 'id' };
      if (kind === 'reset' && a?.screen === 'host') { commit({ ...state, [d.id]: freshGuide(path) }); return true; }
      if (kind !== 'start' || state[d.id].running || !a?.pos || Math.hypot(a.pos.x - state[d.id].x, a.pos.z - state[d.id].z) > GUIDE.reached + 1) return { reject: 'far' };
      commit({ ...state, [d.id]: startGuide(path, players()) }); return true;
    },
  });
  return { get state() { return state; }, summary: () => state,
    start: (id, p) => sync.request('guide', 'start', { id }, p ? sync.actorFor(p) : null),
    reset: id => sync.request('guide', 'reset', { id }, sync.isHost ? { screen: 'host', index: 0 } : null),
    update(dt) { if (sync.isHost) { const next = Object.fromEntries(Object.entries(paths).map(([id, path]) => [id, stepGuide(state[id], path, players(), dt)])); if (Object.keys(paths).some(id => next[id] !== state[id])) commit(next); } },
  };
}
