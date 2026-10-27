// Pure authored guide rules. freshGuide(path), stepGuide(state,path,players,dt).
// players [{key,x,y,z,fall?}] are active players; enroll within GUIDE.range on start.
// State {running,index,x,y,z,waiting,checkpoints:{key:index},catches:{key:{x,y,z,serial}}}.
// Hop waypoints animate a real arc; lost/fallen participants return to their own reached checkpoint.
import { GUIDE } from '../config.js';
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export const freshGuide = path => ({ ...path[0], index: 0, running: false, waiting: false, checkpoints: {}, catches: {} });
export function startGuide(path, players) {
  return { ...freshGuide(path), running: true, checkpoints: Object.fromEntries(players.filter(p => dist(p, path[0]) <= GUIDE.range).map(p => [p.key, 0])) };
}
export function stepGuide(state, path, players, dt) {
  if (!state.running) return state;
  const s = { ...state, checkpoints: { ...state.checkpoints }, catches: { ...state.catches } };
  const party = players.filter(p => p.key in s.checkpoints);
  for (const p of party) {
    let cp = s.checkpoints[p.key];
    for (let i = cp + 1; i <= s.index; i++) if (dist(p, path[i]) < GUIDE.reached && Math.abs(p.y - path[i].y) < 1.4) cp = i;
    s.checkpoints[p.key] = cp;
    if (p.fall || dist(p, s) > GUIDE.lost) s.catches[p.key] = { ...path[cp], serial: (s.catches[p.key]?.serial || 0) + 1 };
  }
  s.waiting = !party.length || party.some(p => dist(p, s) > GUIDE.wait);
  if (s.waiting) return s;
  const b = path[Math.min(s.index + 1, path.length - 1)], a = path[s.index], d = dist(s, b), k = Math.min(1, GUIDE.speed * Math.max(0, dt) / (d || 1));
  s.x += (b.x - s.x) * k; s.z += (b.z - s.z) * k;
  const u = Math.min(1, dist(a, s) / (dist(a, b) || 1));
  s.y = a.y + (b.y - a.y) * u + (b.hop ? Math.sin(u * Math.PI) * GUIDE.hopHeight : 0);
  if (d <= GUIDE.speed * dt) { s.index++; s.y = b.y; if (s.index >= path.length - 1) { s.index = path.length - 1; s.running = false; } }
  return s;
}
