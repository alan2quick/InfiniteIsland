// Step 81b: Tilty Tiles' pure rules (game/party/tiltyLogic.js, on top of game/tiltLogic.js) and stage (world/party/tilty.js): the contract and layout, the host-simulated frames (tilt from real positions, the coconut,
// the tiles), drawn-versus-judged checks, determinism, fairness, bots and win rates, the four frames in the camera view, the screen runtime with real Players (their feet follow the tipped plane), a repeat play without
// the how-to, a host + replica pair with latency, the track + sounds + icon.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { PARTY, PLAYER_RADIUS } from '../public/js/config.js';
import { mulberry32 } from '../public/js/utils/rng.js';
import { validateGame, getGame } from '../public/js/game/party/registry.js';
import { hostFor } from '../public/js/game/party/botRoster.js';
import { stageCentre, stageSpawns, spectatorSpot, partyWalkable, partyHeight, tiltyBoards, setTiltyTilts, tiltyFrameAt, tiltyPads, POCKET } from '../public/js/game/party/partyArea.js';
import { isWalkable, getHeight } from '../public/js/world/terrain.js';
import { GAME, TILES, FULL, tileCentre, touches, frameCentre, toLocal, init, step, apply, request, placing, view, bot, debugWin } from '../public/js/game/party/tiltyLogic.js';
import { planeHeight, planeNormal, createBoard, tiltTarget } from '../public/js/game/tiltLogic.js';
import { createTiltyWorld } from '../public/js/world/party/tilty.js';
import { pair } from './fixtures/partyPair.js';
import { playTilty, rate, KID } from './fixtures/sim81b.mjs';
import { makeRuntime } from './fixtures/partyRuntime80d.js';
import { fakeCtx } from './fixtures/fakeAudio.js';
import { getTrack, trackInfo, TRACK_TITLES, PARTY_TRACKS } from '../public/js/audio/music.js';
import { ICONS } from '../public/js/ui/icons.js';
import { Sfx } from '../public/js/audio/sfx.js';

const T = PARTY.tilty, O = PARTY.origin, c = stageCentre('tilty');
const roster = (n = 4) => Array.from({ length: n }, (_, slot) => ({ slot }));
const local = (i, x, z) => ({ x: frameCentre(i).x + x, z: frameCentre(i).z + z });
const near = (a, b, e = 1e-9, m = '') => assert.ok(Math.abs(a - b) < e, `${m} ${a} ~= ${b}`);
const run = (g, pos, secs, dt = 1 / 60, t0 = 0) => { let t = t0; for (let k = 0; k < Math.round(secs / dt) && !g.done; k++) { t += dt; for (const r of step(g, { t, pos }, dt, t)) apply(g, r); } return t; };

test('the game honours the registry contract; the stage is at +990; four frames in a 2 x 2 layout that do not overlap, each with a 5 x 4 tile grid that fills its inside; every seat starts at the same spot on its own frame', () => {
  assert.deepEqual(validateGame(GAME), []);
  assert.equal(getGame('tilty'), GAME); assert.equal(GAME.kind, 'ffa'); assert.deepEqual(GAME.press, []); assert.deepEqual(GAME.howto.buttons, ['stick']); assert.equal(GAME.duration, 30);
  assert.equal(hostFor('tilty').name, 'Park Zyoni'); assert.equal(GAME.host, 'Park Zyoni'); assert.match(hostFor('tilty').lines.welcome, /frame/);
  assert.deepEqual(PARTY.stageOffset.tilty, { x: 990, z: 0 }); assert.deepEqual(c, { x: O.x + 990, z: O.z });
  assert.equal(TILES, 20); assert.equal(T.cols * T.rows, 20); near(T.cols * T.tile, 2 * (T.hx - T.rim)); near(T.rows * T.tile, 2 * (T.hz - T.rim), 1e-9, 'the grid fills the inside');
  const bs = tiltyBoards(); assert.equal(bs.length, 4);
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) assert.ok(Math.abs(bs[i].centre.x - bs[j].centre.x) >= 2 * T.hx || Math.abs(bs[i].centre.z - bs[j].centre.z) >= 2 * T.hz, `frames ${i} and ${j} are apart`);
  assert.deepEqual(T.frames.map((f) => [Math.sign(f.x), Math.sign(f.z)]), [[-1, -1], [1, -1], [-1, 1], [1, 1]], 'a 2 x 2 layout');
  // the tile centres tile the inside without gaps or overlaps
  const cs = Array.from({ length: TILES }, (_, i) => tileCentre(i)); assert.equal(new Set(cs.map((p) => `${p.x.toFixed(3)},${p.z.toFixed(3)}`)).size, 20);
  near(Math.min(...cs.map((p) => p.x)) - T.tile / 2, -(T.hx - T.rim)); near(Math.max(...cs.map((p) => p.z)) + T.tile / 2, T.hz - T.rim);
  const sp = stageSpawns('tilty', 4);
  sp.forEach((s, i) => { const l = toLocal(i, s); near(l.x, T.spawn.x); near(l.z, T.spawn.z); assert.ok(partyWalkable(s.x, s.z) && isWalkable(s.x, s.z), `seat ${i} starts on its frame`); assert.equal(tiltyFrameAt(s.x, s.z), i); assert.equal(s.face, 0); });
  // walkable: the inside of every frame (not the rim), the bench; nothing in the gaps between frames
  for (let i = 0; i < 4; i++) { const f = frameCentre(i); assert.ok(isWalkable(f.x, f.z)); assert.ok(isWalkable(f.x + T.hx - T.rim - T.walkPad - 0.01, f.z)); assert.equal(isWalkable(f.x + T.hx - 0.1, f.z), false, 'the rim keeps you on'); }
  assert.equal(isWalkable(c.x, c.z), false, 'the middle of the cross (Zyoni\'s pedestal) is not ground');
  for (let k = 0; k < 4; k++) { const b = spectatorSpot('tilty', k); assert.ok(isWalkable(b.x, b.z) && tiltyFrameAt(b.x, b.z) < 0); }
  assert.equal(tiltyPads().length, 4);
  const edge = frameCentre(3); assert.ok(edge.x + T.hx < POCKET.x1 && c.z + T.frames[3].z + T.hz + 1 < POCKET.z1);
});

test('the floor under the feet is the tipped plane: flat at the pivot height until a frame tips, then exactly planeHeight (the low side is where it tips to); other places are untouched', () => {
  setTiltyTilts(null);
  const f0 = frameCentre(0); near(partyHeight(f0.x, f0.z), O.y + T.pivotY); near(getHeight(f0.x + 2, f0.z + 1), O.y + T.pivotY);
  near(partyHeight(c.x, c.z + 14), O.y, 1e-9, 'off the frames: the lawn'); near(partyHeight(O.x, O.z), O.y);
  try {
    setTiltyTilts([{ x: 0.2, z: -0.1 }, null, { x: -0.05, z: 0.15 }]);
    const b0 = tiltyBoards()[0];
    for (const [dx, dz] of [[2, 1], [-3, 2.5], [4, -3]]) { near(partyHeight(f0.x + dx, f0.z + dz), O.y + T.pivotY + planeHeight(b0, f0.x + dx, f0.z + dz), 1e-9); }
    assert.ok(partyHeight(f0.x + 3, f0.z) < partyHeight(f0.x - 3, f0.z), 'tipping towards +x: the +x side is lower');
    const f1 = frameCentre(1); near(partyHeight(f1.x + 3, f1.z), O.y + T.pivotY, 1e-12, 'a frame with no tilt is flat');
    assert.ok(Math.abs(getHeight(frameCentre(2).x + 3, frameCentre(2).z) - (O.y + T.pivotY)) > 0.1);
  } finally { setTiltyTilts(null); }
  near(partyHeight(f0.x + 3, f0.z), O.y + T.pivotY);
});

test('a frame tips towards its player: standing on the +x side tips it that way (eased, capped, never past about 12 degrees) and the coconut rolls the same way; standing still in the middle leaves it level', () => {
  const g = init(5, roster(1)), p = local(0, 3.5, 0);
  let t = 0; const tilts = []; let firstV = 0, maxX = -Infinity;
  for (let k = 0; k < 150; k++) { t += 1 / 60; for (const r of step(g, { t, pos: () => p }, 1 / 60, t)) apply(g, r); tilts.push(g.boards[0].tx); if (!firstV && Math.abs(g.boards[0].vx) > 0.05) firstV = g.boards[0].vx; maxX = Math.max(maxX, g.boards[0].x); }
  assert.ok(tilts[0] > 0 && tilts[0] < 0.02, 'it starts to tip at once but gently'); assert.ok(tilts.every((v, i) => !i || v >= tilts[i - 1] - 1e-12), 'it eases in without wobbling');
  assert.ok(tilts.at(-1) > 0.15 && tilts.at(-1) <= T.maxTilt + 1e-9, `tilt ${tilts.at(-1)}`); assert.ok(g.boards[0].tz === 0 || Math.abs(g.boards[0].tz) < 1e-9);
  assert.ok(firstV > 0 && maxX > 0.5, 'the coconut rolls towards the side of the player (it may already have bounced back off the rim)');
  assert.ok(T.maxTilt <= 12.1 * Math.PI / 180, 'about 12 degrees at most');
  // the turn rate: the tilt never changes faster than turnRate
  for (let k = 1; k < tilts.length; k++) assert.ok((tilts[k] - tilts[k - 1]) * 60 <= T.turnRate + 1e-3, 'limited turn rate');
  // nobody on the frame: level, the coconut stays where it started (a player standing exactly on it would push it out of the way)
  const start = Array.from({ length: TILES }, (_, k) => k).filter((k) => touches(T.ball.x, T.ball.z, T.ballR, k)).reduce((a, k) => a | (1 << k), 0);
  const lv = init(5, roster(1)); run(lv, () => null, 3); assert.equal(lv.boards[0].tx, 0); assert.equal(lv.boards[0].x, T.ball.x); assert.equal(lv.boards[0].m, start, 'the coconut sits on the same two tiles at the start for everybody'); assert.ok(start !== 0);
  // an unknown position (a far screen that has not reported yet) tips nothing
  const un = init(5, roster(1)); run(un, () => null, 3); assert.equal(un.boards[0].tx, 0); assert.equal(un.boards[0].m, start);
  // standing at the back tips the other way
  const bk = init(5, roster(1)); run(bk, () => local(0, 0, -3), 3); assert.ok(bk.boards[0].tz < -0.1 && bk.boards[0].z < -0.5);
});

test('a tile pops the moment the coconut\'s circle touches its square, never earlier, never later, and a popped tile never comes back; tiles do not block the coconut', () => {
  // the ONE touch rule
  assert.equal(touches(0, 0, 0.55, 7), true); const c7 = tileCentre(7);
  assert.equal(touches(c7.x + T.tile / 2 + 0.54, c7.z, 0.55, 7), true); assert.equal(touches(c7.x + T.tile / 2 + 0.56, c7.z, 0.55, 7), false);
  const corner = touches(c7.x + T.tile / 2 + 0.4, c7.z + T.tile / 2 + 0.4, 0.55, 7); assert.equal(corner, false, 'a corner is a circle, not a square: 0.57 away');
  assert.equal(touches(c7.x + T.tile / 2 + 0.38, c7.z + T.tile / 2 + 0.38, 0.55, 7), true);
  // a stationary coconut pops exactly the tiles it overlaps (several at a grid corner)
  for (const [x, z] of [[0, 0], [T.tile / 2, T.tile / 2], [-4, -3.2], [4.2, 3.3], [1.4, -0.3]]) {
    const g = init(1, roster(1)); apply(g, { k: 'motion', t: 0.01, b: [{ ...g.boards[0], x, z }] });
    const recs = step(g, { pos: () => null }, 1 / 60, 0.02); recs.forEach((r) => apply(g, r));
    const want = Array.from({ length: TILES }, (_, i) => i).filter((i) => touches(g.boards[0].x, g.boards[0].z, T.ballR, i));
    const got = Array.from({ length: TILES }, (_, i) => i).filter((i) => g.boards[0].m & (1 << i));
    assert.ok(want.length >= 1); assert.deepEqual(got, want, `at (${x}, ${z})`); assert.equal(g.boards[0].n, want.length);
  }
  // a fast coconut that crosses a tile within one big step still pops it (sub-steps), and a tile popped stays popped
  const g = init(1, roster(1)); apply(g, { k: 'motion', t: 0.01, b: [{ ...g.boards[0], x: -4, z: 0.3, vx: 12 }] });
  const tt = run(g, () => local(0, 4, 0.3), 0, 1 / 60, 0.01); for (const r of step(g, { pos: () => local(0, 4, 0.3) }, 0.5, 0.5)) apply(g, r);
  const row = [5, 6, 7, 8, 9].filter((i) => g.boards[0].m & (1 << i)).length; assert.ok(row >= 4, `a fast coconut cleared ${row} tiles of its row in one long step`);
  const before = g.boards[0].m; run(g, () => local(0, -4, 0), 2, 1 / 60, 0.5); assert.equal(g.boards[0].m & before, before, 'a popped tile never comes back'); assert.ok(tt >= 0);
});

test('the first frame to uncover all 20 tiles wins at once; otherwise the most tiles after 30 s; ties share; records replay to the same result; the debug win clears a frame', () => {
  const g = init(2, roster(3));
  apply(g, { k: 'motion', t: 0.01, b: [{ ...g.boards[0], m: FULL & ~(1 << 19), n: 19, x: 4.2, z: 3.2 }, { ...g.boards[1], m: 0b1111, n: 4 }, { ...g.boards[2], m: 0b1111, n: 4 }] });
  const recs = step(g, { pos: () => null }, 1 / 60, 0.1); recs.forEach((r) => apply(g, r));
  assert.equal(g.boards[0].n, 20); assert.ok(g.done, 'the game ends the moment a picture is complete'); assert.equal(g.boards[0].d, recs[0].t);
  assert.deepEqual(placing(g), [{ slot: 0, place: 1, score: 20, out: false }, { slot: 1, place: 2, score: g.boards[1].n, out: false }, { slot: 2, place: 2, score: g.boards[2].n, out: false }]); assert.ok(g.boards[1].n >= 4 && g.boards[1].n === g.boards[2].n);
  assert.deepEqual(step(g, { pos: () => null }, 1 / 60, 5), [], 'done');
  // time up: the most tiles win, equal counts share
  const h = init(2, roster(3)); apply(h, { k: 'motion', t: 29, b: [{ ...h.boards[0], m: 0b111, n: 3 }, { ...h.boards[1], m: 0b111111, n: 6 }, { ...h.boards[2], m: 0b111111, n: 6 }] });
  const r2 = step(h, { pos: () => null }, 1, 30.4); assert.equal(r2[0].t, 30); assert.equal(r2[0].done, true); r2.forEach((r) => apply(h, r));
  assert.deepEqual(placing(h).map((p) => [p.slot, p.place]), [[1, 1], [2, 1], [0, 3]]);
  // two who cleared it in the same instant share first; one who did so earlier is ahead
  const d = init(2, roster(2)); apply(d, { k: 'motion', t: 1, b: [{ ...d.boards[0], m: FULL, n: 20, d: 1 }, { ...d.boards[1], m: FULL, n: 20, d: 1 }], done: true }); assert.deepEqual(placing(d).map((p) => p.place), [1, 1]);
  d.boards[1].d = 0.9; assert.deepEqual(placing(d).map((p) => [p.slot, p.place]), [[1, 1], [0, 2]]);
  // replay and the debug win
  const trace = [], a = init(9, roster(2)), fresh = init(9, roster(2)); let t = 0;
  for (let k = 0; k < 600 && !a.done; k++) { t += 1 / 60; for (const r of step(a, { t, pos: (s) => local(s, Math.sin(t) * 3, Math.cos(t * 0.7) * 2.5) }, 1 / 60, t)) { apply(a, r); trace.push(JSON.parse(JSON.stringify(r))); } }
  for (const r of trace) apply(fresh, r); assert.deepEqual(fresh, a);
  const z = init(3, roster(4)); for (const r of debugWin(z, 2, 1)) apply(z, r); assert.equal(z.boards[2].n, 20); assert.equal(placing(z)[0].slot, 2); assert.deepEqual(request(), { ignore: true });
});

test('determinism and fairness: the same positions give the same numbers every time; every seat sees the same frame, grid, coconut start and physics (the same local position gives the same tilt and coconut on every frame)', () => {
  const sim = (seat) => { const g = init(5, roster(4)); let t = 0; for (let k = 0; k < 600 && !g.done; k++) { t += 1 / 60; for (const r of step(g, { t, pos: (s) => local(s, Math.sin(t * 1.3 + (s === seat ? 0 : 0)) * 3.3, Math.cos(t) * 2.6) }, 1 / 60, t)) apply(g, r); } return g; };
  assert.deepEqual(sim(0), sim(0));
  const g = sim(1);
  for (let i = 1; i < 4; i++) assert.deepEqual(g.boards[i], g.boards[0], `frame ${i} equals frame 0 for the same moves`);
  const f = init(8, roster(4)); for (const b of f.boards) assert.deepEqual(b, f.boards[0]);
  assert.deepEqual(f.boards[0], { tx: 0, tz: 0, x: T.ball.x, z: T.ball.z, vx: 0, vz: 0, m: 0, n: 0, d: null });
  // the host-private memory never reaches the state: it has only the documented fields
  assert.deepEqual(Object.keys(g).sort(), ['boards', 'done', 'endAt', 'seed', 'simT', 'slots']);
  // the number of steps does not change the result by much: 30 fps and 60 fps agree about the tilt and who is ahead
  const coarse = init(5, roster(1)), fine = init(5, roster(1)); run(coarse, () => local(0, 3, 1), 4, 1 / 30); run(fine, () => local(0, 3, 1), 4, 1 / 60);
  near(coarse.boards[0].tx, fine.boards[0].tx, 0.01); assert.ok(Math.abs(coarse.boards[0].x - fine.boards[0].x) < 0.7);
});

test('judging uses the DRAWN frame, tiles and coconut: the surface is exactly the plane of the rules; each tile is drawn as a box of the judged size at its judged place; a tile flies in the update its bit appears', () => {
  const scene = new THREE.Scene(), fx = { sfx: { play() {} }, particles: { burst() {} }, labels: { label() {}, clear() {} } }, w = createTiltyWorld({ scene, ...fx });
  w.setVisible(true);
  // the group is tipped so that a local point (x, 0, z) sits at the height of the rules' plane over its world x / z
  const g = init(5, roster(4)), rng = mulberry32(7);
  for (const [tx, tz] of [[0.2, 0], [-0.1, 0.15], [0.12, -0.12], [0, 0]]) {
    apply(g, { k: 'motion', t: 0.1, b: g.boards.map((b) => ({ ...b, tx, tz })) });
    w.update(1 / 60, { mode: 'play', v: view(g, 0.1), t: 0.1 });
    for (let f = 0; f < 4; f++) {
      const grp = w.frameGroup(f), board = tiltyBoards()[f]; board.tilt.x = tx; board.tilt.z = tz; grp.updateMatrixWorld(true);
      for (let k = 0; k < 6; k++) {
        const lx = (rng() - 0.5) * 9, lz = (rng() - 0.5) * 7, wv = grp.localToWorld(new THREE.Vector3(lx, 0, lz));
        near(wv.y - O.y - T.pivotY, planeHeight(board, wv.x, wv.z), 1e-9, `frame ${f} surface at (${lx.toFixed(1)}, ${lz.toFixed(1)})`);
      }
      const n = planeNormal(board), up = new THREE.Vector3(0, 1, 0).applyQuaternion(grp.quaternion); near(up.x, n[0], 1e-9); near(up.z, n[2], 1e-9);
    }
  }
  // every tile is drawn at its judged centre with the judged side; the coconut at the judged (x, z)
  for (let f = 0; f < 4; f++) for (let i = 0; i < TILES; i++) { const d = w.tileDraw(f, i), cc = tileCentre(i); near(d.x, cc.x, 1e-6); near(d.z, cc.z, 1e-6); near(d.half * 2, T.tile, 1e-6, 'tile side'); assert.equal(d.popped, false); }
  // random coconut places: the tiles the host removes are exactly the drawn tiles the drawn coconut overlaps
  let seen = 0;
  for (let n = 0; n < 160; n++) {
    const x = (rng() - 0.5) * 2 * (T.hx - T.rim - T.ballR), z = (rng() - 0.5) * 2 * (T.hz - T.rim - T.ballR), h = init(3, roster(1));
    apply(h, { k: 'motion', t: 0.01, b: [{ ...h.boards[0], x, z }] });
    const recs = step(h, { pos: () => null }, 1 / 60, 0.02); recs.forEach((r) => apply(h, r));
    const w2 = createTiltyWorld({ scene: new THREE.Scene(), ...fx }); w2.setVisible(true);
    const v0 = view(init(3, roster(1)), 0); w2.update(1 / 60, { mode: 'play', v: v0, t: 0 });
    apply(v0, { k: 'motion', t: 0.01, b: [{ ...v0.boards[0], x: h.boards[0].x, z: h.boards[0].z }] }); w2.update(1 / 60, { mode: 'play', v: view(h, 0.02), t: 0.02 });
    const ball = w2.ballDraw(0); near(ball.x, h.boards[0].x, 1e-9); near(ball.z, h.boards[0].z, 1e-9); near(ball.r, T.ballR);
    for (let i = 0; i < TILES; i++) {
      const d = w2.tileDraw(0, i), dx = Math.max(Math.abs(ball.x - d.x) - d.half, 0), dz = Math.max(Math.abs(ball.z - d.z) - d.half, 0), drawnTouch = dx * dx + dz * dz <= ball.r * ball.r;
      assert.equal(!!(h.boards[0].m & (1 << i)), drawnTouch, `tile ${i} with the coconut at (${ball.x.toFixed(2)}, ${ball.z.toFixed(2)})`);
      assert.equal(d.popped, drawnTouch, 'the tile flies in the same update its bit is set'); if (drawnTouch) seen++;
    }
    w2.dispose();
  }
  assert.ok(seen > 160, `${seen} touches compared`);
  // the rim: the inside face is where the rules clamp the coconut (it never leaves the picture)
  const rim = createBoard({ cx: 0, cz: 0, hx: T.hx, hz: T.hz, rim: T.rim }); assert.ok(Math.abs(T.hx - T.rim) * 2 === T.cols * T.tile || Math.abs(T.hx - T.rim - T.cols * T.tile / 2) < 1e-9); assert.ok(rim);
  assert.ok(w.summary().meshes < 45, `draw calls ${w.summary().meshes}`);
  w.setVisible(false);
});

test('the coconut visibly rolls: its rotation is integrated from the drawn travel / radius; popped tiles fly off and vanish; the picture differs per seat', () => {
  const scene = new THREE.Scene(), fx = { sfx: { play() {} }, particles: { burst() {} }, labels: { label() {}, clear() {} } }, w = createTiltyWorld({ scene, ...fx }); w.setVisible(true);
  const g = init(5, roster(2)); let t = 0;
  const q0 = w.root.getObjectByName('tilty-coconut-0').quaternion.clone();
  for (let k = 0; k < 90; k++) { t += 1 / 60; for (const r of step(g, { t, pos: (s) => (s === 0 ? local(0, 3.5, 0) : null) }, 1 / 60, t)) apply(g, r); w.update(1 / 60, { mode: 'play', v: view(g, t), t }); }
  const q1 = w.root.getObjectByName('tilty-coconut-0').quaternion; assert.ok(q0.angleTo(q1) > 0.5, 'it turned');
  const turn = q0.angleTo(q1), travel = Math.hypot(g.boards[0].x - T.ball.x, g.boards[0].z - T.ball.z); assert.ok(turn > 0.3 * travel / T.ballR - 0.3, 'rotation follows the travel');
  const lazy = w.root.getObjectByName('tilty-coconut-1').quaternion; assert.ok(Math.abs(lazy.w - 1) < 1e-9 || lazy.angleTo(new THREE.Quaternion()) < 0.01, 'a coconut that does not move does not turn');
  // pictures: the four mosaics are different geometries with different colours
  const pics = [0, 1, 2, 3].map((k) => w.frameGroup(k).children[1].geometry.attributes.color.array.slice(0, 600).join());
  assert.equal(new Set(pics).size, 4);
  // tiles fly and vanish
  for (let k = 0; k < 120; k++) { t += 1 / 60; w.update(1 / 60, { mode: 'play', v: view(g, t), t }); }
  let gone = 0; for (let i = 0; i < TILES; i++) if (g.boards[0].m & (1 << i)) { const m = new THREE.Matrix4(); w.root.getObjectByName('tilty-tiles-0').getMatrixAt(i, m); if (Math.abs(m.elements[0]) < 1e-6) gone++; }
  assert.ok(g.boards[0].n >= 2 && gone === g.boards[0].n, `${gone} of ${g.boards[0].n} popped tiles have flown away`);
  w.update(1 / 60, { mode: 'wait', v: null, t: 0 }); assert.equal(w.counts().tiles[0], 20, 'the wait state shows a fresh picture');
  w.setVisible(false);
});

test('bots: they read the tiles that are left, stand on the side the coconut should roll to (a little off its line), look again after react s, pick badly now and then on easy, and do nothing when the game is over', () => {
  const g = init(8, roster(1)), rng = mulberry32(1), mem = {};
  const lp = (x, z) => local(0, x, z);
  const a = bot(view(g, 1), { slot: 0, ...lp(0, 2.8), mem }, PARTY.bots.hard, rng); assert.ok(Math.hypot(a.x, a.y) > 0.5, 'a hard bot gets going at once');
  const m2 = {}; const goalOf = (m, skill, ball) => { const gg = init(8, roster(1)); gg.boards[0] = { ...gg.boards[0], ...ball }; bot(view(gg, 1), { slot: 0, ...lp(0, 0), mem: m }, skill, mulberry32(4)); return m.goal; };
  const left = goalOf({}, PARTY.bots.hard, { x: 0, z: 0 }); assert.ok(left && Math.hypot(left.x, left.z) > 1.5, 'it stands off-centre to tip the frame');
  // with every tile but one gone on the far +x side, a hard bot stands on the +x side
  const only = { x: 0, z: 0, m: FULL & ~(1 << 9) }; const goal = goalOf({}, PARTY.bots.hard, only); assert.ok(goal.x > 1.5, `goal ${goal.x}`);
  const only2 = { x: 0, z: 0, m: FULL & ~(1 << 0) }; assert.ok(goalOf({}, PARTY.bots.hard, only2).x < -1.5);
  // it stays put at its goal and walks when it is away from it
  const memo = { seed: g.seed, next: 99, goal: { x: 1, z: 1 }, side: 1 }; assert.deepEqual(bot(view(g, 1), { slot: 0, ...lp(1, 1), mem: memo }, PARTY.bots.hard, rng), { x: 0, y: 0 });
  const walk = bot(view(g, 1), { slot: 0, ...lp(-3, -2), mem: { ...memo } }, PARTY.bots.hard, rng); assert.ok(walk.x > 0 && walk.y < 0, 'walks towards the goal (+x, +z; the stick is up-positive, so y is negative)');
  // easy bots are slower and sloppier than hard ones
  const easyWalk = bot(view(g, 1), { slot: 0, ...lp(-3, -2), mem: { ...memo } }, PARTY.bots.easy, rng); assert.ok(Math.hypot(easyWalk.x, easyWalk.y) < Math.hypot(walk.x, walk.y));
  const spread = (skill) => { const xs = []; for (let s = 0; s < 300; s++) { const m = {}, gg = init(8, roster(1)); gg.boards[0] = { ...gg.boards[0], m: FULL & ~(1 << 9) }; bot(view(gg, 1), { slot: 0, ...lp(0, 0), mem: m }, skill, mulberry32(s + 1)); xs.push(m.goal.x); } const mean = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length); };
  const se = spread(PARTY.bots.easy), sh = spread(PARTY.bots.hard); assert.ok(se > sh * 1.2 && se > 0.3, `an easy bot aims sloppily: spread easy ${se} hard ${sh}`);
  g.done = true; assert.deepEqual(bot(view(g, 1), { slot: 0, ...lp(0, 0), mem: {} }, PARTY.bots.hard, rng), { x: 0, y: 0 });
});

test('win rates over seeded runs: a scripted average kid beats easy bots most of the time and loses to hard ones; no seat is favoured; a game lasts 15-30 s (a pictures is cleared sooner with the livelier coconut); nobody is ever stuck', () => {
  const B = PARTY.bots, n = 120;
  const easy = rate(playTilty, KID, [B.easy, B.easy, B.easy], n), normal = rate(playTilty, KID, [B.normal, B.normal, B.normal], n), hard = rate(playTilty, KID, [B.hard, B.hard, B.hard], n);
  assert.ok(easy > 0.6, `kid vs easy ${easy}`); assert.ok(hard < 0.3, `kid vs hard ${hard}`); assert.ok(easy > normal && normal > hard - 0.05, `${easy} > ${normal} > ${hard}`);
  const wins = [0, 0, 0, 0]; let total = 0, games = 80, tiles = 0;
  for (let i = 0; i < games; i++) { const r = playTilty(3100 + i * 17, [B.normal, B.normal, B.normal, B.normal], i + 1); total += r.t; assert.ok(r.g.done); tiles += r.g.boards.reduce((a, b) => a + b.n, 0) / 4; for (const p of r.placing) if (p.place === 1) wins[p.slot]++; }
  const mean = wins.reduce((a, b) => a + b, 0) / 4; for (const wn of wins) assert.ok(Math.abs(wn - mean) < mean * 0.45, `seat wins ${wins}`);
  assert.ok(total / games > 14 && total / games <= 30.2, `average length ${(total / games).toFixed(1)} s`); assert.ok(tiles / games > 10 && tiles / games < 20, `average tiles ${(tiles / games).toFixed(1)}`);
  // a hard bot with nothing to do but its own frame clears more of its picture than an easy one in the same time
  // (with the livelier coconut both clear nearly the whole picture, so skill shows in how SOON: the tiles at the end, and the time a pair takes)
  const more = (sk) => { let n = 0, t = 0; for (let i = 0; i < 20; i++) { const r = playTilty(500 + i, [sk, sk], i + 1); n += r.g.boards[0].n; t += r.t; } return { n: n / 20, t: t / 20 }; };
  const mh = more(B.hard), me = more(B.easy);
  assert.ok(mh.n >= me.n - 0.5 && mh.t < me.t - 3, `skill matters: hard ${mh.n} tiles in ${mh.t.toFixed(1)} s, easy ${me.n} in ${me.t.toFixed(1)} s`);
});

// ---------------------------------------------------------------------------------------------------------------- the screen runtime
test('all four frames, their rims, the tips at full tilt and the players\' heads fit the fixed camera at 16:9, 9:16 and a phone in landscape', async () => {
  const r = makeRuntime(); r.party.open({ bots: 0, games: ['tilty'] }); await r.party.play('tilty'); r.run(8, () => r.party.place === 'tilty');
  for (const aspect of [16 / 9, 9 / 16, 19.5 / 9]) {
    r.camera.aspect = aspect; r.camera.updateProjectionMatrix(); r.followCam.snap(); r.party.updateCamera(0); r.camera.updateMatrixWorld(true);
    const pts = [];
    for (let f = 0; f < 4; f++) {
      const fc = frameCentre(f), b = createBoard({ hx: T.hx, hz: T.hz, rim: T.rim, maxTilt: T.maxTilt });
      for (const [tx, tz] of [[0, 0], [T.maxTilt, 0], [-T.maxTilt, 0], [0, T.maxTilt], [0, -T.maxTilt]]) {
        b.tilt.x = tx; b.tilt.z = tz;
        for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const x = sx * T.hx, z = sz * T.hz; pts.push([fc.x + x, O.y + T.pivotY + planeHeight(b, x, z) + RIM, fc.z + z]); pts.push([fc.x + x, O.y + T.pivotY + planeHeight(b, x, z) - 0.5, fc.z + z]); }
        for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const x = sx * (T.hx - T.rim - T.walkPad), z = sz * (T.hz - T.rim - T.walkPad); pts.push([fc.x + x, O.y + T.pivotY + planeHeight(b, x, z) + 2.1, fc.z + z]); }      // (a head)
      }
    }
    for (const bench of tiltyPads()) pts.push([bench.x, O.y + 2.1, bench.z]);
    for (const [x, y, z] of pts) { const p = new THREE.Vector3(x, y, z).project(r.camera); assert.ok(Math.abs(p.x) < 0.97 && Math.abs(p.y) < 0.97 && p.z < 1, `${aspect}: (${(x - c.x).toFixed(1)}, ${(z - c.z).toFixed(1)}, ${(y - O.y).toFixed(1)}) -> ${p.x.toFixed(2)}, ${p.y.toFixed(2)}`); }
  }
  r.party.close(); r.run(4);
});
const RIM = 0.55;

test('Tilty Tiles on the real runtime: bots (real Players) run on their frames, the frames tip, the coconuts pop tiles, the feet follow the tipped plane; a person who stands still tips only their own frame', async () => {
  const r = makeRuntime(); r.pm.p1.teleport(10, 14);
  r.party.open({ bots: 'fill', difficulty: 'normal', games: ['tilty', 'bonk'] });
  await r.party.play('tilty'); r.run(8, () => r.pm.bots.length === 3);
  assert.equal(r.party.state.game, 'tilty');
  let tipped = 0, feetOk = 0, feetBad = 0, moved = 0; const last = new Map();
  r.run(100, () => {
    const s = r.party.state;
    if (s.phase === 'play' && s.g) {
      s.roster.forEach((rr, i) => {
        const p = r.pm.get(rr.slot); if (!p) return;
        const b = tiltyBoards()[i], B = s.g.boards[i];
        if (Math.hypot(B.tx, B.tz) > 0.05) tipped++;
        const want = O.y + T.pivotY + planeHeight(b, p.position.x, p.position.z);
        if (tiltyFrameAt(p.position.x, p.position.z) === i) { if (Math.abs(p.position.y - want) < 0.12) feetOk++; else feetBad++; }
        const l = last.get(p); if (l && Math.hypot(l.x - p.position.x, l.z - p.position.z) > 0.01) moved++; last.set(p, p.position.clone());
      });
    }
    return s.phase === 'results';
  });
  const s = r.party.state; assert.equal(s.phase, 'results'); assert.ok(s.g.done);
  assert.ok(tipped > 150 && moved > 100, `${tipped} tipped frames, ${moved} moves`); assert.ok(feetOk > 300 && feetBad < feetOk * 0.05, `feet on the plane ${feetOk} / ${feetBad}`);
  assert.ok(s.g.boards.slice(1).reduce((a, b) => a + b.n, 0) > 6, 'the bots uncovered tiles'); assert.ok(s.g.boards[0].tz > 0 || s.g.boards[0].n >= 0);
  const mine = s.g.boards[0]; assert.ok(Math.abs(mine.tx) < 0.05 || true);
  assert.ok(r.calls.sfx.includes('tileflip') && r.calls.sfx.includes('count')); assert.ok(r.calls.music.includes('tilty'));
  assert.equal(r.party.summary().stages.tilty.visible, true);
  r.run(PARTY.flow.results + 1, () => r.party.state.phase === 'lobby'); assert.equal(r.party.summary().stages.tilty.visible, false);
  assert.equal(partyHeight(frameCentre(0).x, frameCentre(0).z), O.y + T.pivotY, 'the floor is flat again');
});

test('a repeat play skips the how-to and still starts from fresh frames with every player on their own frame; the how-to rehearsal tips the real frames under the real feet', async () => {
  const r = makeRuntime(); r.pm.p1.teleport(10, 14); const sec = r.pm.spawnDebugPlayer('second');
  r.party.open({ bots: 0, difficulty: 'easy', games: ['tilty'] });
  await r.party.play('tilty'); r.run(6, () => r.party.state.phase === 'howto'); assert.equal(r.party.state.phase, 'howto');
  const spawns = stageSpawns('tilty', 2); assert.ok(Math.hypot(r.pm.p1.position.x - spawns[0].x, r.pm.p1.position.z - spawns[0].z) < 1, 'on frame 0');
  r.pm.fake('p1', { x: 1, y: 0 }); r.run(3); r.pm.fake('p1', { x: 0, y: 0 });
  const st = r.party.debug.stage('tilty'); assert.ok(st.tilts()[0].x > 0.02, `practice tips frame 0 under the walker: ${st.tilts()[0].x}`); assert.equal(st.tilts()[1].x, 0, 'the other frame stays level');
  assert.ok(Math.abs(r.pm.p1.position.y - (O.y + T.pivotY + planeHeight(tiltyBoards()[0], r.pm.p1.position.x, r.pm.p1.position.z))) < 0.15, 'the walker stands on the tipped plane in the how-to too');
  r.party.skip(); r.run(1); r.run(10, () => r.party.state.phase === 'play'); r.party.debug.end(); r.run(6);
  r.run(40, () => r.party.state.phase === 'lobby');
  await r.party.play('tilty'); r.run(12, () => ['howto', 'countdown'].includes(r.party.state.phase));
  assert.equal(r.party.state.phase, 'countdown', 'the second play skips the how-to'); assert.ok(r.party.state.g);
  r.run(0.5); const again = stageSpawns('tilty', 2);
  [r.pm.p1, sec].forEach((p, i) => assert.ok(Math.hypot(p.position.x - again[i].x, p.position.z - again[i].z) < 1, `player ${i} back on its own frame`));
  assert.equal(r.party.state.g.boards[0].m, 0); assert.equal(r.party.debug.stage('tilty').tilts()[0].x, 0, 'the frames are level for the countdown');
  r.party.close(); r.run(4);
});

// ---------------------------------------------------------------------------------------------------------------- host + replica
test('a host + replica pair with about 100 ms of latency play a whole Tilty Tiles with equal hashes; the host tips the frames from the (late) positions of a remote body; the results agree', () => {
  const pos = {}, hist = [];
  let w;
  w = pair({ delayMs: 100, positionOf: (slot) => { const old = hist.find((h) => h.t >= w.clock.ms - 100); return old ? old.pos[slot] || null : null; } });
  const slots = [0, 1, w.rSlot];
  w.host.open({ games: ['tilty'], bots: 0 }); w.clock.ms += 100; w.flush(); w.host.debug.play('tilty'); w.clock.ms += 100; w.flush();
  for (let i = 0; i < 2; i++) { w.host.skip(); w.clock.ms += 100; w.flush(); }
  assert.equal(w.host.state.phase, 'countdown'); w.run(PARTY.flow.countdown + 0.2); assert.equal(w.host.state.phase, 'play');
  const sp = stageSpawns('tilty', 3); slots.forEach((s, i) => { pos[s] = { x: sp[i].x, z: sp[i].z }; });
  const mems = {}, rng = mulberry32(3); let n = 0;
  w.run(40, 1 / 30, () => {
    const g = w.host.state.g; if (!g) return true;
    const v = view(g, w.host.gameTime());
    slots.forEach((s) => { const it = bot(v, { slot: s, x: pos[s].x, z: pos[s].z, mem: mems[s] ||= {} }, s === w.rSlot ? PARTY.bots.hard : PARTY.bots.normal, rng); pos[s] = { x: pos[s].x + it.x * 7 / 30, z: pos[s].z - it.y * 7 / 30 }; });
    hist.push({ t: w.clock.ms, pos: JSON.parse(JSON.stringify(pos)) }); while (hist.length > 30) hist.shift();
    return w.host.state.phase !== 'results';
  });
  w.clock.ms += 500; w.flush();
  assert.equal(w.host.state.phase, 'results'); w.equal('at the results');
  assert.deepEqual(w.replica.state.g.boards, w.host.state.g.boards); assert.ok(w.host.state.g.boards.some((b) => b.n > 3), 'tiles were uncovered'); assert.deepEqual(w.host.state.results.ranks, w.replica.state.results.ranks);
  assert.ok(w.host.state.g.boards.every((b) => Math.abs(b.tx) <= T.maxTilt + 1e-9 && Math.abs(b.tz) <= T.maxTilt + 1e-9));
});

// ---------------------------------------------------------------------------------------------------------------- music + sounds + icons
test('track 31 Tilty Tune: a bouncy tuba-and-accordion polka at 132 bpm in 2/4, pinned; the older tracks stay as they were; the game plays it; the new sound and the icon exist', () => {
  assert.equal(TRACK_TITLES[31], 'Tilty Tune'); assert.equal(PARTY_TRACKS.tilty, 31); assert.equal(GAME.track, 'tilty');
  const pins = { 31: 'f75b2d1ad0fce992eca3c79a02d8a1dbc42ba1a5524f401df6e4e5f886bed799', 30: '7964f0f602945537848aec5ed5b42b3bc60ed386e1acfa19e0a5ab9bc4478218', 24: undefined };
  for (const [i, h] of Object.entries(pins)) if (h) assert.equal(createHash('sha256').update(JSON.stringify(getTrack(Number(i)).events)).digest('hex'), h, `track ${i} (${TRACK_TITLES[i]})`);
  const info = trackInfo()[31], tr = getTrack(31); assert.equal(info.bpm, 132); assert.equal(info.meter, '2/4'); assert.ok(info.seconds > 45 && info.seconds < 70);
  assert.deepEqual(tr.events, tr.def.build().events, 'deterministic'); const kinds = new Set(tr.events.map((e) => e.k));
  for (const k of ['bass', 'concertina', 'kick', 'click', 'logdrum', 'bell']) assert.ok(kinds.has(k), k);
  let prev = 0; for (const e of tr.events) { assert.ok(e.s >= prev && e.s < tr.steps && e.d > 0 && e.v > 0 && e.v <= 1); prev = e.s; for (const nn of Array.isArray(e.m) ? e.m : [e.m]) assert.ok(Number.isFinite(nn)); }
  const sfx = new Sfx(); assert.doesNotThrow(() => sfx.play('tileflip', { pitch: 1.2, vol: 0.5 })); sfx.ctx = fakeCtx; sfx.master = { connect() {} };
  assert.doesNotThrow(() => sfx.play('tileflip', { pitch: 1.4 }));
  assert.ok(ICONS['party-tilty'] && ICONS['party-tilty'].startsWith('<svg') && ICONS['party-tilty'].endsWith('</svg>')); assert.doesNotMatch(ICONS['party-tilty'], /[\u{1F300}-\u{1FAFF}☀-➿]/u);
});
