// Session-only host warmth domain. createWarm({sync,ids,context}); context(id) -> warmLogic inputs.
// update(dt), give(id,n=1) (host debug warm gifts), summary(), state. No replica extrapolation.
import { WARM } from '../config.js';
import { warmth } from './warmLogic.js';
export function createWarm({ sync, ids = [], context }) {
  let state = Object.fromEntries(ids.map(id => [id, 0]));
  const commit = s => { state = s; sync.emit('warm', 'state', state); };
  sync.register('warm', { snapshot: () => state, applySnapshot: s => { state = s; }, applyEvent: (_, s) => { state = s; },
    handleRequest(kind, d, a) {
      if (kind !== 'gift' || a?.screen !== 'host' || !(d.id in state) || !Number.isFinite(d.n) || d.n <= 0) return { reject: 'gift' };
      commit({ ...state, [d.id]: warmth(state[d.id], 0, context(d.id), Math.min(d.n, 10) * WARM.gift) }); return true;
    },
  });
  return { get state() { return state; }, summary: () => state,
    give: (id, n = 1) => sync.request('warm', 'gift', { id, n }, sync.isHost ? { screen: 'host', index: 0 } : null),
    update(dt) {
      if (!sync.isHost) return;
      const next = Object.fromEntries(ids.map(id => [id, warmth(state[id], dt, context(id))]));
      if (ids.some(id => next[id] !== state[id])) commit(next);
    },
  };
}
