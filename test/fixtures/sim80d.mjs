// Step 80d balance: independent kid walks to visible food, then taps three times a second; every bot walks too.
// Kinematic movement uses the real stick speed curve and inner-disc boundary. Rotate the kid's start spot to check fairness.
import { PARTY, PLAYER_SPEED, PLAYER_WALK_SPEED, WALK_THRESHOLD } from '../../public/js/config.js';
import { stageSpawns, stageCentre } from '../../public/js/game/party/partyArea.js';
import { mulberry32 } from '../../public/js/utils/rng.js';
import * as F from '../../public/js/game/party/feastroundLogic.js';
const S = PARTY.feastround, c = stageCentre('feastround');
function move(body, intent, dt) {
  const x = intent.x || 0, z = -(intent.y || 0), n = Math.min(1, Math.hypot(x, z));
  if (n < 0.001) return;
  body.face = Math.atan2(x, z);
  const speed = n <= WALK_THRESHOLD ? PLAYER_WALK_SPEED * n / WALK_THRESHOLD : PLAYER_WALK_SPEED + (PLAYER_SPEED - PLAYER_WALK_SPEED) * (n - WALK_THRESHOLD) / (1 - WALK_THRESHOLD);
  body.x += x / n * speed * dt; body.z += z / n * speed * dt;
  const r = Math.hypot(body.x - c.x, body.z - c.z);
  if (r > S.walkR) { body.x = c.x + (body.x - c.x) * S.walkR / r; body.z = c.z + (body.z - c.z) * S.walkR / r; }
}
export function playFeast(seed, difficulty, seat = 0) {
  const g = F.init(seed, [0,1,2,3].map(slot => ({ slot }))), rng = mulberry32(seed ^ 9127), mem = [{},{},{},{}];
  const bodies = stageSpawns('feastround').map(p => ({ ...p }));
  let next = 0, walking = 0;
  for (let frame = 0; frame <= S.duration * 60; frame++) {
    const t = frame / 60, v = F.view(g, t);
    for (let k = 0; k < 4; k++) {
      const slot = (k + frame) % 4, body = bodies[slot]; let intent = {};
      if (slot === seat) {
        if (!g.plates[slot]) {
          let nearest = null, distance = Infinity;
          for (const d of g.dishes) {
            const p = F.dishPose(d, t); if (!p.visible || g.taken[d.id] || d.kind === 'pepper') continue;
            const dist = Math.hypot(p.x - (body.x-c.x), p.z - (body.z-c.z));
            if (dist < distance) { nearest = d; distance = dist; }
          }
          if (nearest) {
            const p = F.dishPose(nearest, t + 0.2), dx = Math.cos(p.angle) * (S.walkR+0.2) - (body.x-c.x), dz = Math.sin(p.angle) * (S.walkR+0.2) - (body.z-c.z), n = Math.hypot(dx,dz) || 1;
            intent = { x: dx/n * 0.9, y: -dz/n * 0.9 }; walking++;
          }
        }
        const d = F.dishInFront(g, slot, t, F.localActor(body));
        if (t >= next && (g.plates[slot] || (d && d.kind !== 'pepper'))) { intent.interact = true; next = t + 0.32; }
      } else intent = F.bot(v, { slot, ...body, mem: mem[slot] }, PARTY.bots[difficulty], rng);
      if (intent.interact) { const out = F.request(g, slot, { t, face: body.face }, { t, slack: PARTY.slack, pos: s => bodies[s] }); if (out.rec) F.apply(g, out.rec); }
      move(body, intent, 1/60);
    }
    for (const r of F.step(g, {}, 1/60, t)) F.apply(g, r);
  }
  return { win: seat >= 0 && F.placing(g).find(r => r.slot === seat).place === 1, scores: g.scores, walking, g, t: S.duration, placing: F.placing(g) };      // (Step 80e: seat -1 = four bots, no kid; the soak reads g / placing)
}
export function feastRate(difficulty, n=40) { let wins=0; for(let seed=1;seed<=n;seed++) wins+=playFeast(seed,difficulty,seed%4).win; return wins/n; }
if (process.argv[1]?.endsWith('sim80d.mjs')) for (const d of PARTY.difficulties) console.log(d, feastRate(d));
