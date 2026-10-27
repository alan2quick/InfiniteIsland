// Host-authoritative, session-only carry runtime. createCarry({sync,defs,safe,actors,checkpoint}).
// pick(player,id), drop(player), fall(player), update(), summary(), carried(key), state.
// actors() -> [{key,pos,yaw}]; checkpoint(key) is host-owned. Replicas request, never predict.
import { actorKey } from '../net/worldSync.js';
import { createCarryState, carriedBy, validatePick, applyPick, applyDrop, putDown, waterDrop } from './carryLogic.js';
export function createCarry({ sync, defs = [], safe, actors = () => [], checkpoint = () => null }) {
  let state = createCarryState(defs);
  const commit = next => { state = next; sync.emit('carry', 'state', state); };
  function dropKey(key, fallback = null) {
    const a = actors().find(a => a.key === key);
    const spot = fallback || (a && putDown(a.pos, a.yaw || 0, safe));
    if (!spot) return { reject: 'spot' };
    commit(applyDrop(state, key, spot)); return true;
  }
  sync.register('carry', {
    snapshot: () => state, applySnapshot: s => { state = s; }, applyEvent: (_, s) => { state = s; },
    handleRequest(kind, d, actor) {
      const key = actorKey(actor);
      if (kind === 'pick') {
        const bad = validatePick(state, key, d.id, actor?.pos);
        if (bad) return { reject: bad };
        commit(applyPick(state, key, d.id)); return true;
      }
      if (!carriedBy(state, key)) return { reject: 'empty' };
      if (kind === 'drop') return dropKey(key);
      if (kind === 'fall') {
        const cp = waterDrop(checkpoint(key));
        return cp ? dropKey(key, cp) : { reject: 'checkpoint' };
      }
      return { reject: 'request' };
    },
    screenLeft(screen) { for (const [id, o] of Object.entries(state.objects)) if (o.carrier?.startsWith(screen + ':')) dropKey(o.carrier, waterDrop(checkpoint(o.carrier)) || defs.find(d => d.id === id)); },
  });
  const request = (kind, p, data = {}) => sync.request('carry', kind, data, sync.actorFor(p));
  return { get state() { return state; }, carried: key => carriedBy(state, key),
    pick: (p, id) => request('pick', p, { id }), drop: p => request('drop', p), fall: p => request('fall', p), summary: () => state,
    update() {
      if (!sync.isHost) return;
      const active = new Set(actors().map(a => a.key));
      for (const [id, o] of Object.entries(state.objects)) if (o.carrier && !active.has(o.carrier)) dropKey(o.carrier, waterDrop(checkpoint(o.carrier)) || defs.find(d => d.id === id));
    },
  };
}
