// Host-counted floe loads, session-only `ice` domain. createIce({sync,pads,actors,clock}).
// update(): count players whose feet touch tilt pads; emit changed loads. padPos remains a pure
// function of pad definition + replicated load + shared clock. No global ground-type changes.
import { padPos } from './hopLogic.js';
import { tiltLoad } from './iceLogic.js';
export function createIce({ sync, pads = [], actors = () => [], clock }) {
  let state = {};
  const apply = s => { state = s; for (const p of pads) p.load = state[p.id] || null; };
  sync.register('ice', { snapshot: () => state, applySnapshot: apply, applyEvent: (_, s) => apply(s), handleRequest: () => ({ reject: 'host' }) });
  return { summary: () => state, update() {
    if (!sync.isHost) return;
    const next = {};
    for (const p of pads) if (p.motion?.kind === 'tilt') {
      const at = { ...padPos(p, clock()) };
      const on = actors().filter(a => Math.hypot(a.pos.x - at.x, a.pos.z - at.z) < p.r && Math.abs(a.pos.y - at.top) < .35).map(a => a.pos);
      const l = tiltLoad(on, { ...at, r: p.r });
      next[p.id] = Object.fromEntries(Object.entries(l).map(([k, v]) => [k, Math.round(v * 100) / 100]));
    }
    if (JSON.stringify(next) !== JSON.stringify(state)) { apply(next); sync.emit('ice', 'state', next); }
  } };
}
