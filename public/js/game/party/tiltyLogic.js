// Tilty Tiles (Step 81b, party game 11; "Tipsy Tourney" lives only in the plan): four big wooden picture frames lie on the home lawn in a 2 x 2 layout, one per player. Each frame is a painted picture (a postcard of the
// island, a Tdoong portrait ...) hidden under a 5 x 4 grid of loose wooden tiles. YOU stand on your own frame and run around on it: your weight tips the frame towards where you stand (eased, about 12 degrees at most),
// and your frame's coconut rolls downhill, bounces off the rim and off your feet. The moment the coconut touches a tile that tile pops off and uncovers its part of the picture. The first to uncover all 20 tiles wins
// at once; otherwise the most tiles uncovered after 30 s wins (ties share). Nothing eliminates anybody and nothing can be fallen off: the rim keeps you on.
// PURE rules (Node-tested in test/partyTilty.test.js) on top of the reusable game/tiltLogic.js; the look is world/party/tilty.js.
//
// HOST-SIMULATED (the Puffball Bumpers pattern), but each player moves their OWN body as usual: every tick the HOST reads each player's REAL position (`ctx.pos(slot)`), tips that player's frame towards it, rolls the
// coconut with the slope + the player's feet as a moving obstacle, and pops the tiles the coconut touches (checked at every <= 1/60 s sub-step, so a fast coconut cannot skip a tile). It then emits ONE `motion` record
// with every frame's tilt, coconut and tile mask; every screen only APPLIES records (a replica never integrates), so hashes agree. The stage draws exactly these numbers: the coconut at (x, z) on the plane, the tiles at
// tileCentre(i) with the judged size; a bit of the mask set = the tile has flown off.
//
// Game module contract: see vineskipLogic.js. recs: { k: 'motion', t, b: [{ tx, tz, x, z, vx, vz, m (tile bit mask), n (tiles off), d (time of the 20th) }], done? } | { k: 'zap', slot, t } (debug: that frame is cleared) |
// { k: 'end', t, why }. There are no presses (request() ignores). State: boards[i] for the i-th roster entry (frame i), simT, done, endAt.
import { PARTY, PLAYER_RADIUS } from '../../config.js';
import { stageCentre } from './partyArea.js';
import { createBoard, tiltTarget, stepTilt, stepRoller, innerHalf } from '../tiltLogic.js';

const T = PARTY.tilty;
export const ID = 'tilty';
export const TILES = T.cols * T.rows;
export const FULL = (1 << TILES) - 1;
const r4 = (v) => Math.round(v * 1e4) / 1e4;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const popcount = (m) => { let n = 0; for (let x = m; x; x &= x - 1) n++; return n; };

/** The centre of tile i (0 .. 19, row-major) in frame-local coordinates. */
export const tileCentre = (i) => ({ x: ((i % T.cols) - (T.cols - 1) / 2) * T.tile, z: (Math.floor(i / T.cols) - (T.rows - 1) / 2) * T.tile });
/** Does the circle (x, z, r) touch the tile i's square (side T.tile)? The ONE touch rule: the stage draws the tiles at exactly this size. */
export function touches(x, z, r, i) {
  const c = tileCentre(i), dx = Math.max(Math.abs(x - c.x) - T.tile / 2, 0), dz = Math.max(Math.abs(z - c.z) - T.tile / 2, 0);
  return dx * dx + dz * dz <= r * r;
}
const makeBoard = () => createBoard({ cx: 0, cz: 0, hx: T.hx, hz: T.hz, rim: T.rim, maxTilt: T.maxTilt, turnRate: T.turnRate, reach: T.reach, ease: T.ease });
const ROLL = { gravity: T.gravity, rollK: T.rollK, damp: T.damp, friction: T.friction, rimE: T.rimE, obstacleE: T.obstacleE, maxSpeed: T.maxSpeed };
/** A frame's centre (world). */
export function frameCentre(i) { const c = stageCentre(ID), f = T.frames[i]; return { x: c.x + f.x, z: c.z + f.z }; }
/** World -> frame-local. */
export function toLocal(i, p) { const f = frameCentre(i); return { x: p.x - f.x, z: p.z - f.z }; }

export function init(seed, roster) {
  const slots = roster.map((p) => p.slot);
  return { seed: seed >>> 0, slots, boards: slots.map(() => ({ tx: 0, tz: 0, x: T.ball.x, z: T.ball.z, vx: 0, vz: 0, m: 0, n: 0, d: null })), simT: 0, done: false, endAt: null };
}

const memo = new WeakMap();                                           // HOST-private: each player's last local position (to get the feet's velocity); never in the state, a record or a hash

export function step(g, ctx, dt, t) {
  if (g.done) return [];
  const end = Math.min(t, T.duration), span = end - g.simT;
  if (span <= 1e-9) return [];
  let mem = memo.get(g); if (!mem) memo.set(g, mem = { pos: {} });
  const n = Math.max(1, Math.ceil(span * 60 - 1e-6)), h = span / n, board = makeBoard();
  const out = g.boards.map((b) => ({ ...b }));
  g.slots.forEach((slot, i) => {
    const B = out[i];
    const wp = ctx.pos ? ctx.pos(slot) : null, lp = wp && Number.isFinite(wp.x) && Number.isFinite(wp.z) ? toLocal(i, wp) : null;
    const ih = innerHalf(board);
    const here = lp ? { x: clamp(lp.x, -ih.x, ih.x), z: clamp(lp.z, -ih.z, ih.z) } : null;
    const was = mem.pos[slot] || here;
    const vel = here && was ? { x: clamp((here.x - was.x) / span, -9, 9), z: clamp((here.z - was.z) / span, -9, 9) } : { x: 0, z: 0 };
    board.tilt.x = B.tx; board.tilt.z = B.tz;
    const ro = { x: B.x, z: B.z, vx: B.vx, vz: B.vz, r: T.ballR };
    for (let k = 0; k < n; k++) {
      const f0 = k / n, f1 = (k + 1) / n;
      const target = here ? tiltTarget(board, [{ x: was.x + (here.x - was.x) * f1, z: was.z + (here.z - was.z) * f1 }]) : { x: 0, z: 0 };
      stepTilt(board, target, h);
      const feet = here ? [{ x: was.x + (here.x - was.x) * f0, z: was.z + (here.z - was.z) * f0, r: PLAYER_RADIUS, vx: vel.x, vz: vel.z }] : [];
      stepRoller(ro, board, feet, h, ROLL);
      if (B.m !== FULL) for (let i2 = 0; i2 < TILES; i2++) if (!(B.m & (1 << i2)) && touches(ro.x, ro.z, ro.r, i2)) B.m |= 1 << i2;
    }
    if (here) mem.pos[slot] = here;
    B.tx = r4(board.tilt.x); B.tz = r4(board.tilt.z); B.x = r4(ro.x); B.z = r4(ro.z); B.vx = r4(ro.vx); B.vz = r4(ro.vz);
    B.n = popcount(B.m);
    if (B.n === TILES && B.d === null) B.d = r4(g.simT + span);
  });
  const done = r4(end) >= T.duration || out.some((b) => b.n === TILES);
  return [{ k: 'motion', t: r4(end), b: out, ...(done ? { done: true } : {}) }];
}

export function request() { return { ignore: true }; }               // (no presses: the stick walks you and walking tips the frame)

export function apply(g, rec) {
  if (!rec) return g;
  if (rec.k === 'motion') {
    g.boards = rec.b.map((b) => ({ ...b })); g.simT = rec.t;
    if (rec.t >= 10) for (const b of g.boards) if (b.e === undefined) b.e = b.n;      // (Step 80e's bonus feat, "Fast starter": the tiles each frame had uncovered by 10 s, set once)
    if (rec.done) { g.done = true; g.endAt = rec.t; }
  } else if (rec.k === 'zap') {
    const i = g.slots.indexOf(rec.slot);
    if (i >= 0) { g.boards[i].m = FULL; g.boards[i].n = TILES; g.boards[i].d = rec.t; }
  } else if (rec.k === 'end') { g.done = true; g.endAt = rec.t; }
  return g;
}

/** Ranks: most tiles uncovered first (the one who cleared the picture is always first); equal counts share a place, except that two who cleared it share only when they did it at the same moment. */
export function placing(g) {
  const rows = g.slots.map((slot, i) => ({ slot, score: g.boards[i].n, d: g.boards[i].d, out: false }));
  const better = (a, b) => (a.score !== b.score ? a.score > b.score : a.score === TILES && a.d !== b.d ? a.d < b.d : false);
  return rows.map((r) => ({ ...r, place: 1 + rows.filter((o) => better(o, r)).length })).sort((a, b) => a.place - b.place || a.slot - b.slot).map(({ slot, place, score, out }) => ({ slot, place, score, out }));
}

export function view(g, t = g.simT) { return { ...g, t }; }

// ---------------------------------------------------------------------------------------------------------------- the bots
/**
 * A bot tips its frame by standing on the side the coconut should roll towards: it picks a tile still on (the one nearest the coconut for a hard bot; the nearest of a random few for an easy one), stands beside the
 * line from the coconut to that tile (a little off to one side, so the coconut does not run straight into its feet) and waits there. It looks again every `react` s (+ noise), and on easy sometimes picks badly.
 * Returns { x, y } (the stick).
 */
export function bot(v, me, skill, rng) {
  const out = { x: 0, y: 0 }, m = me.mem, i = v.slots.indexOf(me.slot);
  if (i < 0 || v.done) return out;
  const B = v.boards[i];
  if (m.seed !== v.seed) { m.seed = v.seed; m.next = -1; m.goal = null; m.side = rng() < 0.5 ? -1 : 1; }
  const lp = toLocal(i, me);
  if (v.t >= (m.next ?? -1)) {
    m.next = v.t + skill.react * (0.7 + rng() * 0.6) + rng() * skill.noise;
    const left = [];
    for (let k = 0; k < TILES; k++) if (!(B.m & (1 << k))) left.push(k);
    if (left.length) {
      const d2 = (k) => { const c = tileCentre(k); return (c.x - B.x) ** 2 + (c.z - B.z) ** 2; };
      left.sort((a, b) => d2(a) - d2(b));
      const hard = skill.react < 0.3, pool = hard ? left.slice(0, 2) : left.slice(0, 5);
      let k = pool[Math.floor(rng() * pool.length)];
      if (rng() < skill.miss * T.botMiss) k = left[Math.floor(rng() * left.length)];                            // a bad pick
      const c = tileCentre(k);
      let dx = c.x - B.x, dz = c.z - B.z; const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
      const ih = { x: T.hx - T.rim, z: T.hz - T.rim }, off = hard ? 0.9 : 0.4;
      const stand = Math.min(1, 0.55 + d / 6) * (0.5 + 0.5 * skill.walk), jit = skill.noise * 6;                                                                   // the further the tile, the more tip
      m.goal = { x: clamp((dx * ih.x * 0.8 - dz * m.side * off) * stand + (rng() - 0.5) * jit, -ih.x + T.walkPad, ih.x - T.walkPad), z: clamp((dz * ih.z * 0.8 + dx * m.side * off) * stand + (rng() - 0.5) * jit, -ih.z + T.walkPad, ih.z - T.walkPad) };
    } else m.goal = { x: 0, z: 0 };
  }
  if (!m.goal) return out;
  const ex = m.goal.x - lp.x, ez = m.goal.z - lp.z, d = Math.hypot(ex, ez);
  if (d < 0.25) return out;
  const mag = Math.min(1, skill.walk * clamp(d / 1.2, 0.35, 1));
  out.x = ex / d * mag; out.y = -ez / d * mag;
  return out;
}

/** Debug: that frame's picture is cleared at once (the game ends). */
export const debugWin = (g, slot, t) => [{ k: 'zap', slot, t: Math.round(t * 100) / 100 }];

export const GAME = {
  id: ID, name: 'Tilty Tiles', host: 'Park Zyoni', stage: ID, track: ID, players: [1, 4], kind: 'ffa', duration: T.duration, tail: T.tail,
  howto: { pitch: 'Run around on your own picture frame! It tips towards where you stand, and your coconut rolls downhill. Every tile it touches pops off and uncovers the picture. Uncover the whole picture first!', buttons: ['stick'], verbs: { stick: 'Run to tip your frame' } },
  press: [],
  init, step, request, apply, view, placing, bot, debugWin, lag: 0,
};
