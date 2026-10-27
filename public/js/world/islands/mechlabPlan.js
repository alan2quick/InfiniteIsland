// Pure debug-only Step 74d layout. mechlabPlan() -> {carry,warm,guide,floes,guideCourse,path}.
// Ground samples use real Frostpine terrain. No registrations, saves, seeded placement changes.
import { FIRES } from '../../config.js';
import { getHeight } from '../terrain.js';
export function mechlabPlan() {
  const fire = FIRES.find(f => f.id === 'frost');
  const ground = (x, z) => ({ x, z, y: getHeight(x, z) });
  const carry = ground(-5, -152), warm = ground(fire.x, fire.z + 1.8);
  // South coast, west of the home bridge: water begins just south of z=-90 here.
  const pads = Array.from({ length: 5 }, (_, i) => ({ id: 'ice-' + i, kind: 'floe', x: -25, z: -91 + i * 3.2, r: 1.35, top: .25, base: -.05, cp: true }));
  pads[1].z = -86.1;
  for (let i = 2; i < 5; i++) { pads[i].x = -25 + (i - 1) * 3.5; pads[i].z = -86.1; }
  pads[1].motion = { kind: 'drift', amp: .2, depth: 1.6, period: 12 };
  pads[2].motion = { kind: 'spin', period: 12 };
  pads[3].motion = { kind: 'tilt', period: 12 };
  const floes = { id: 'mechlab-floes', zone: { x: -21, z: -86, r: 12 }, gapY: -.1, splashY: -.7, pads,
    start: pads[0].id, goal: pads[4].id, route: pads.map(p => p.id),
    links: pads.slice(1).map((p, i) => ({ a: pads[i].id, b: p.id, ...(i === 0 ? { wait: true } : {}) })) };
  const path = [-151, -148, -145, -142, -139, -136, -133, -130, -127, -124].map(z => ground(-26, z));
  for (let i = 4; i <= 8; i++) path[i].y = 2.05;
  path[4].hop = true; path[5].balance = path[6].balance = path[7].balance = true;
  const guideCourse = { id: 'mechlab-guide', zone: { x: -26, z: -137.5, r: 16.5 }, gapY: -.1, splashY: -.7,
    hazard: { x: -26, z: -133, r: 3 },
    pads: [
      { id: 'guide-start', kind: 'stump', x: -26, z: -139, r: 1.3, top: 2.05, base: 1.4, cp: true },
      ...[-136, -133, -130].map((z, i) => ({ id: 'guide-log-' + i, kind: 'deck', x: -26, z, w: 1.4, d: 3, top: 2.05, base: 1.65, slippery: true, cp: true })),
      { id: 'guide-end', kind: 'stump', x: -26, z: -127, r: 1.3, top: 2.05, base: 1.4, cp: true },
    ], links: ['guide-start', 'guide-log-0', 'guide-log-1', 'guide-log-2'].map((a, i) => ({ a, b: ['guide-log-0', 'guide-log-1', 'guide-log-2', 'guide-end'][i] })), start: 'guide-start', goal: 'guide-end' };
  return { carry, warm, guide: path[0], fire: ground(fire.x, fire.z), floes, guideCourse, path };
}
