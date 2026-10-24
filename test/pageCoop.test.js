// Step 51: storybook pages with friends. The shared camera window, the soft wall + left-behind timer, dandelion puffs (drift, pop rules, the all-puffed fallback), friends' heads as moving platforms,
// the friend toss (validation + a simulated arc onto a ledge 5-6 tiles up), latency-tolerant enemy contact, the extra pose fields and the toss-only berry rule of the page validator.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGrid, createBody, stepBody, advance, headStep, createLife, hurtLife, fallLife, loseLife, reviveLife, tickLife,
} from '../public/js/game/platformerLogic.js';
import {
  pageWindow, clampWindowX, fitZoom, windowBox, holdX, mostOutside, lostTick, puffTarget, driftStep, popCandidate, validatePop, puffHolds,
  validateLift, validateToss, tossLaunch, wriggleLaunch, applyLiftRec, liftsView, carriedBy, pushHistory, stompInReach, replicaHurts, packPageBits, unpackPageBits, codePageTool, pageToolOfCode, tossReach,
} from '../public/js/game/pageCoopLogic.js';
import { createWorld, request, stepWorld, applyMotion, extrapolate, enemyById } from '../public/js/game/pageWorldLogic.js';
import { encodePose, decodePose } from '../public/js/net/poseBuffer.js';
import { WorldSync } from '../public/js/net/worldSync.js';
import { parsePage, validatePage } from '../public/js/game/pageFormat.js';
import { PAGES } from '../public/js/game/pages/index.js';
import { PLATFORMER as P, PAGE_MP as MP, PAGE_TOOLS as T } from '../public/js/config.js';

const level = (...rows) => createGrid(rows);
const FLAT = (w = 40) => level(...Array.from({ length: 14 }, () => '.'.repeat(w)), '#'.repeat(w));        // floor top at y = 1
function standing(grid, x = 5, y = 1) { const b = createBody(x, y); for (let i = 0; i < 4; i++) stepBody(grid, b, {}); assert.ok(b.grounded); return b; }
const HALF_W = 12.4;                                              // half width of the safe 16:9 window at zoom 1 (tan(15 deg) * 26.1 * 16/9)

// ---- the shared camera window -----------------------------------------------------------------------------------------------------------------------------
test('the window frames every player, never smaller than the minimum or larger than the cap', () => {
  const one = pageWindow([{ x: 100, y: 6, vx: 0 }], { maxHalf: 37 });
  assert.equal(one.hw, MP.minHalf); assert.equal(one.cx, 100);
  const two = pageWindow([{ x: 90, y: 6, vx: 0 }, { x: 110, y: 6, vx: 4 }], { maxHalf: 37 });
  assert.equal(two.cx, 100); assert.equal(two.hw, 10 + MP.margin); assert.equal(two.vx, 2); assert.equal(two.over, false);
  const far = pageWindow([{ x: 0, y: 6, vx: 0 }, { x: 70, y: 6, vx: 0 }, { x: 72, y: 6, vx: 0 }], { maxHalf: 37 });
  assert.equal(far.hw, 37); assert.ok(far.over); assert.ok(Math.abs(far.cx - 47.33) < 0.01, 'beyond the cap the window centres on the MEAN so the straggler falls outside');
  const tall = pageWindow([{ x: 50, y: 0, vx: 0 }, { x: 50, y: 14, vx: 0 }], { maxHalf: 37 });
  assert.ok(tall.hw >= (7 + MP.vMargin) * MP.ratio - 1e-9, 'a vertical spread widens the 16:9 window');
  assert.equal(pageWindow([], {}), null);
});

test('the window stays inside the page and fits any aspect without cropping its width', () => {
  assert.equal(clampWindowX(-40, 12, 31.5), -19.5); assert.equal(clampWindowX(40, 12, 31.5), 19.5); assert.equal(clampWindowX(3, 12, 31.5), 3); assert.equal(clampWindowX(9, 40, 31.5), 0);
  const halfV1 = HALF_W / (16 / 9);
  for (const [name, aspect] of [['16:9', 16 / 9], ['21:9', 21 / 9], ['9:16', 9 / 16], ['4:3', 4 / 3], ['phone landscape 812x375', 812 / 375]]) {
    for (const hw of [MP.minHalf, 14, 25, 37]) {
      const z = fitZoom(hw, { halfV1, aspect });
      const visW = halfV1 * aspect * z, visH = halfV1 * z;
      assert.ok(visW >= hw - 1e-9, `${name} hw ${hw}: the full window width is visible (${visW.toFixed(2)})`);
      assert.ok(visH >= hw / (16 / 9) - 1e-9, `${name} hw ${hw}: the full window height is visible`);
      assert.ok(z >= 1);
    }
  }
  assert.ok(fitZoom(20, { halfV1, aspect: 21 / 9 }) <= fitZoom(20, { halfV1, aspect: 16 / 9 }) + 1e-9, 'a wider screen never needs to zoom out more');
  assert.ok(fitZoom(20, { halfV1, aspect: 9 / 16 }) > 2.5, 'a portrait phone zooms out a lot (page-coloured sky and earth fill the rest)');
  assert.equal(fitZoom(20, { halfV1, aspect: 0 }), fitZoom(20, { halfV1, aspect: 16 / 9 }), 'a hidden 0 x 0 window has no aspect yet: fall back to 16:9');
});

test('the soft wall only stops outward motion and the farthest straggler becomes lost after the delay', () => {
  const win = { x: 100, y: 8, hw: 15 }, box = windowBox(win, MP.holdInset);
  assert.equal(box.right, 114); assert.equal(box.left, 86);
  const b = { x: 114.6, vx: 5 };
  assert.equal(holdX(b, 114.2, box.left, box.right), 1); assert.equal(b.x, 114.2); assert.equal(b.vx, 0);
  const inw = { x: 120, vx: -3 };                                                // already outside (the window moved): moving inward is free
  assert.equal(holdX(inw, 121, box.left, box.right), 0); assert.equal(inw.x, 120);
  const out = { x: 85.5, vx: -2 }; assert.equal(holdX(out, 85.9, box.left, box.right), -1); assert.equal(out.x, 85.9);
  const pts = [{ x: 100, y: 7 }, { x: 140, y: 7 }, { x: 70, y: 7 }];
  assert.equal(mostOutside(pts, win), 1, 'only the farthest one is flagged');
  assert.equal(mostOutside([{ x: 100, y: 7 }, { x: 113, y: 7 }], win), -1);
  assert.equal(mostOutside([{ x: 100, y: 7 }, { x: 100, y: 30 }], win), 1, 'a player far below / above counts too');
  let t = 0; for (let i = 0; i < 120; i++) t = lostTick(t, true, 1 / 60);
  assert.ok(t < MP.lostDelay && t > 1.9); for (let i = 0; i < 40; i++) t = lostTick(t, true, 1 / 60); assert.ok(t >= MP.lostDelay, `lost after ${MP.lostDelay} s outside`);
  for (let i = 0; i < 400; i++) t = lostTick(t, false, 1 / 60); assert.equal(t, 0, 'inside again: the timer drains');
});

// ---- puffs ------------------------------------------------------------------------------------------------------------------------------------------------
test('a puff drifts to the nearest living friend and is popped by touch', () => {
  const friends = [{ key: 'host:0', x: 20, y: 5 }, { key: 's1:1', x: 8, y: 5 }];
  const puff = { x: 0, y: 3, vx: 0, vy: 0 };
  assert.equal(puffTarget(puff, friends).key, 's1:1');
  assert.equal(puffTarget(puff, []), null);
  let t = 0, popped = null;
  for (; t < 6 && !popped; t += 1 / 60) { driftStep(puff, puffTarget(puff, friends), 1 / 60); popped = popCandidate(puff, friends); }
  assert.ok(popped && popped.key === 's1:1', `reached the friend in ${t.toFixed(2)} s`);
  assert.ok(t < 2.5, 'the drift is quick enough to be fun (8 tiles)');
  assert.ok(Math.hypot(puff.vx, puff.vy) <= MP.puffSpeed + 0.01);
  assert.equal(popCandidate({ x: 0, y: 3 }, [{ key: 'a', x: 3, y: 3 }]), null, 'out of reach');
  const idle = { x: 1, y: 1, vx: 4, vy: 0 }; for (let i = 0; i < 90; i++) driftStep(idle, null, 1 / 60); assert.ok(Math.abs(idle.vx) < 0.01, 'no friends: the puff just settles');
});

test('the host validates a pop: a real puff, a free friend, one of the two asks, close enough', () => {
  const target = { key: 's1:1', x: 10, y: 4.3, puff: true }, by = { key: 'host:0', x: 11, y: 5, puff: false, carried: false };
  assert.deepEqual(validatePop({ target, by, actor: 's1:1' }), { ok: true });
  assert.deepEqual(validatePop({ target, by, actor: 'host:0' }), { ok: true });
  assert.equal(validatePop({ target, by, actor: 's2:0' }).reason, 'bad-request', 'a third party cannot pop it');
  assert.equal(validatePop({ target: { ...target, puff: false }, by, actor: 's1:1' }).reason, 'gone');
  assert.equal(validatePop({ target, by: { ...by, puff: true }, actor: 's1:1' }).reason, 'busy');
  assert.equal(validatePop({ target, by: { ...by, carried: true }, actor: 's1:1' }).reason, 'busy');
  assert.equal(validatePop({ target, by: { ...by, x: 30 }, actor: 's1:1' }).reason, 'far');
  assert.equal(validatePop({ target, by: target, actor: 's1:1' }).reason, 'bad-request');
});

test('popped puffs: pit and zero-heart puffs come back full, lost puffs keep their hearts, all-puffed parties respawn alone', () => {
  const l = createLife(); fallLife(l); assert.equal(l.kind, 'pit'); assert.equal(l.hearts, 0);
  assert.ok(reviveLife(l)); assert.equal(l.state, 'alive'); assert.equal(l.hearts, P.hearts); assert.ok(l.invuln >= MP.popBlink - 1e-9); assert.equal(l.kind, 'none');
  const h = createLife(); h.hearts = 1; assert.equal(hurtLife(h), 'puff'); assert.equal(h.kind, 'hearts'); reviveLife(h); assert.equal(h.hearts, P.hearts);
  const lost = createLife(); lost.hearts = 2; assert.equal(loseLife(lost), 'puff'); assert.equal(lost.kind, 'lost'); assert.equal(lost.hearts, 2);
  reviveLife(lost); assert.equal(lost.hearts, 2, 'a lost puff costs nothing'); assert.equal(reviveLife(lost), false);
  // a living friend holds the puff (up to puffMaxS); nobody else alive -> the Step 49 timer runs
  const w = createLife(); fallLife(w);
  for (let i = 0; i < 600; i++) assert.equal(tickLife(w, 1 / 60, puffHolds(1, w.puffAge)), null);
  assert.equal(w.state, 'puff', 'ten seconds later a friend can still pop it');
  const solo = createLife(); fallLife(solo);
  let r = null; for (let i = 0; i < 120 && !r; i++) r = tickLife(solo, 1 / 60, puffHolds(0, solo.puffAge));
  assert.equal(r, 'respawn'); assert.equal(solo.hearts, P.hearts); assert.equal(solo.state, 'alive');
  const patient = createLife(); fallLife(patient); r = null;
  for (let i = 0; i < 60 * 40 && !r; i++) r = tickLife(patient, 1 / 60, puffHolds(1, patient.puffAge));
  assert.equal(r, 'respawn', 'after puffMaxS the puff gives up waiting and respawns at the campfire');
  assert.equal(puffHolds(0, 0), false); assert.equal(puffHolds(2, MP.puffMaxS + 1), false);
  const lostWait = createLife(); loseLife(lostWait); lostWait.hearts = 2; r = null;
  for (let i = 0; i < 200 && !r; i++) r = tickLife(lostWait, 1 / 60, false); assert.equal(r, 'respawn'); assert.equal(lostWait.hearts, 2, 'a lost puff that respawns alone keeps its hearts too');
});

// ---- friends' heads ---------------------------------------------------------------------------------------------------------------------------------------
test('landing on a friend: a fast fall bounces, a slow one stands, the rider rides along and jumps off', () => {
  const g = FLAT();
  const friend = standing(g, 10, 1), headTop = () => friend.y + MP.headH;
  const heads = () => [{ id: 'f', x: friend.x, top: headTop() }];
  // fast fall from 4 tiles up: a bounce (small hop) or a boost with Jump held
  for (const held of [false, true]) {
    const b = createBody(10.1, 6); b.vy = 0;
    let res = null, pre = null;
    for (let i = 0; i < 90 && !(res && res.kind); i++) {
      pre = { y: b.y, vy: b.vy };
      stepBody(g, b, { jumpHeld: held });
      res = headStep(b, pre, heads(), null, { jumpHeld: held });
    }
    assert.equal(res.kind, 'bounce'); assert.ok(res.impact > MP.headBounceMin);
    assert.equal(b.vy, held ? MP.headBoost : MP.headBounce); assert.equal(b.grounded, false); assert.ok(Math.abs(b.y - headTop()) < 1e-9);
  }
  // a gentle landing (a twirl-slow fall) stands, then the rider follows the friend
  const r = createBody(10, headTop() + 0.4); r.vy = -3;
  let pre = { y: r.y, vy: r.vy }; stepBody(g, r, {}); let res = headStep(r, pre, heads(), null);
  for (let i = 0; i < 20 && res.kind !== 'land'; i++) { pre = { y: r.y, vy: r.vy }; stepBody(g, r, {}); res = headStep(r, pre, heads(), null); }
  assert.equal(res.kind, 'land'); assert.equal(res.on, 'f'); assert.ok(r.grounded); assert.equal(r.vy, 0);
  let on = res.on, lastX = friend.x;
  for (let i = 0; i < 60; i++) {                                                // the friend runs: the rider (not moving itself) is carried along by the host loop's delta
    stepBody(g, friend, { move: 1 });
    r.x += friend.x - lastX; lastX = friend.x;
    pre = { y: r.y, vy: r.vy };
    stepBody(g, r, {});
    res = headStep(r, pre, heads(), on); on = res.on;
    assert.equal(res.kind, 'ride', `frame ${i}`);
  }
  assert.ok(Math.abs(r.x - friend.x) < 0.2 && Math.abs(r.y - headTop()) < 1e-9, 'still on the head after the friend ran 4+ tiles');
  // jump off: the rider leaves the head (no re-landing in the rising part), and walking off the side lets it fall
  pre = { y: r.y, vy: r.vy }; stepBody(g, r, { jumpPressed: true, jumpHeld: true }); res = headStep(r, pre, heads(), on);
  assert.equal(res.kind, null); assert.ok(r.vy > 10); assert.equal(res.on, null);
  const w = createBody(friend.x, headTop()); w.grounded = true; let on2 = 'f', fell = false;
  for (let i = 0; i < 90; i++) {
    pre = { y: w.y, vy: w.vy }; stepBody(g, w, { move: 1 }); const rr = headStep(w, pre, heads(), on2); on2 = rr.on;
    if (!on2 && w.y < headTop() - 0.5) { fell = true; break; }
  }
  assert.ok(fell, 'walking off the side lets the rider drop to the floor');
});

test('there is no collision from the side and a stack of three rides up and down together', () => {
  const g = FLAT();
  const a = standing(g, 10, 1), b = standing(g, 10.2, 1);
  for (let i = 0; i < 20; i++) { stepBody(g, a, { move: 1 }); stepBody(g, b, { move: 1 }); }
  assert.ok(a.x > 12 && b.x > 12, 'two bodies run through each other');
  // a stack: bottom (floor), middle on the bottom's head, top on the middle's
  const bottom = standing(g, 20, 1), mid = createBody(20.1, 1 + MP.headH), top = createBody(20.2, 1 + 2 * MP.headH);
  mid.grounded = top.grounded = true;
  let onM = 'bottom', onT = 'mid';
  const heads = (id) => (id === 'mid' ? [{ id: 'bottom', x: bottom.x, top: bottom.y + MP.headH }] : [{ id: 'mid', x: mid.x, top: mid.y + MP.headH }]);
  let last = { bm: bottom.x, mt: mid.x };
  for (let i = 0; i < 90; i++) {
    stepBody(g, bottom, { move: i < 30 ? 1 : 0, jumpPressed: i === 40, jumpHeld: i >= 40 && i < 60 });
    mid.x += bottom.x - last.bm; last.bm = bottom.x;
    let pre = { y: mid.y, vy: mid.vy }; stepBody(g, mid, {}); onM = headStep(mid, pre, heads('mid'), onM).on;
    top.x += mid.x - last.mt; last.mt = mid.x;
    pre = { y: top.y, vy: top.vy }; stepBody(g, top, {}); onT = headStep(top, pre, heads('top'), onT).on;
    assert.equal(onM, 'bottom', `middle rider at ${i}`); assert.equal(onT, 'mid', `top rider at ${i}`);
    assert.ok(Math.abs(mid.y - (bottom.y + MP.headH)) < 1e-9 && Math.abs(top.y - (mid.y + MP.headH)) < 1e-9);
  }
  assert.ok(bottom.x > 21 && Math.abs(top.x - bottom.x) < 0.5);
});

// ---- the friend toss --------------------------------------------------------------------------------------------------------------------------------------
test('lift and toss rules: who may lift whom, who may throw, the launch', () => {
  const A = { key: 'host:0', x: 10, y: 1, puff: false }, B = { key: 's1:1', x: 10.8, y: 1, puff: false }, C = { key: 's2:2', x: 11.5, y: 1, puff: false };
  const lifts = {};
  assert.deepEqual(validateLift({ actor: A, target: B, lifts }), { ok: true });
  assert.equal(validateLift({ actor: A, target: A, lifts }).reason, 'bad-request');
  assert.equal(validateLift({ actor: A, target: { ...B, puff: true }, lifts }).reason, 'busy');
  assert.equal(validateLift({ actor: A, target: { ...B, x: 20 }, lifts }).reason, 'far');
  assert.equal(validateLift({ actor: A, target: { ...B, y: 9 }, lifts }).reason, 'far');
  applyLiftRec(lifts, { t: 'lift', by: A.key, target: B.key });
  assert.equal(carriedBy(lifts, B.key), A.key); assert.deepEqual(liftsView(lifts), ['host:0>s1:1']);
  assert.equal(validateLift({ actor: C, target: B, lifts }).reason, 'busy', 'already carried');
  assert.equal(validateLift({ actor: B, target: C, lifts }).reason, 'busy', 'a carried player cannot lift');
  assert.equal(validateLift({ actor: A, target: C, lifts }).reason, 'busy', 'already carrying');
  assert.equal(validateToss({ actor: C, lifts, mode: 'fwd' }).reason, 'nothing-held');
  assert.equal(validateToss({ actor: A, lifts, mode: 'sideways' }).reason, 'bad-request');
  assert.deepEqual(validateToss({ actor: A, lifts, mode: 'up' }), { ok: true, target: B.key });
  applyLiftRec(lifts, { t: 'drop', by: A.key }); assert.deepEqual(lifts, {});
  const f = tossLaunch(1, 'fwd', { x: 10, y: 1 }), l = tossLaunch(-1, 'fwd', { x: 10, y: 1 }), u = tossLaunch(1, 'up', { x: 10, y: 1 }), d = tossLaunch(1, 'down', { x: 10, y: 1 });
  assert.ok(f.vx > 0 && l.vx < 0 && f.vy === MP.tossV && f.y === 1 + MP.liftH);
  assert.ok(u.vy > f.vy && Math.abs(u.vx) < f.vx); assert.deepEqual([d.vx, d.vy], [0, 0]);
  assert.ok(wriggleLaunch({ x: 3, y: 1 }).vy > 0);
});

test('a tossed friend reaches a ledge 5 and 6 tiles up, higher than any jump', () => {
  const rows = [];
  for (let r = 0; r < 14; r++) rows.push('.'.repeat(40));
  rows.push('#'.repeat(40));
  const g = level(...rows);
  const thrown = (from, face, mode) => {
    const L = tossLaunch(face, mode, from), b = createBody(L.x, L.y);
    b.vx = L.vx; b.vy = L.vy; b.stun = MP.tossLock;
    let apex = b.y;
    for (let i = 0; i < 240; i++) { stepBody(g, b, {}); apex = Math.max(apex, b.y); if (b.grounded) break; }
    return { b, apex };
  };
  const flat = thrown({ x: 10, y: 1 }, 1, 'fwd');
  assert.ok(flat.apex - 1 > 6.5, `the toss peaks ${(flat.apex - 1).toFixed(2)} tiles above the carrier's feet (a jump: 3.7)`);
  assert.ok(flat.b.x - 10 > 5.5, `and carries ${(flat.b.x - 10).toFixed(1)} tiles sideways (the lock ends after ${MP.tossLock} s, then air friction)`);
  const up = thrown({ x: 10, y: 1 }, 1, 'up');
  assert.ok(up.apex - 1 > 7.5 && Math.abs(up.b.x - 10) < 2.5, 'Up throws nearly straight up');
  // a plank ledge 5 and 6 tiles above the carrier's feet: land on it from the arc's descent when thrown from a few tiles back
  for (const dy of [5, 6]) {
    const ledgeRow = 14 - (1 + dy - 1);                                             // the plank's row index so that its top surface is y = 1 + dy
    const rr = rows.slice(); rr[ledgeRow] = '.'.repeat(16) + '======' + '.'.repeat(18);
    const lg = level(...rr);
    let landed = null;
    for (const back of [0, 1, 2, 3, 4, 5, 6, 7]) {
      const L = tossLaunch(1, 'fwd', { x: 16 - back, y: 1 }), b = createBody(L.x, L.y);
      b.vx = L.vx; b.vy = L.vy; b.stun = MP.tossLock;
      for (let i = 0; i < 240; i++) { stepBody(lg, b, {}); if (b.grounded) break; }
      if (Math.abs(b.y - (1 + dy)) < 1e-6 && b.x >= 16 && b.x <= 22) { landed = back; break; }
    }
    assert.ok(landed !== null, `a forward toss lands on a ledge ${dy} tiles up`);
  }
  assert.ok(tossReach(5) >= 4 && tossReach(6) >= 3 && tossReach(9) < 0, 'the validator\'s closed form agrees: 5-6 tiles up are in reach, 9 are not');
  assert.ok(tossReach(5) >= 0 && tossReach(3) >= 0, 'lower ledges too');
});

// ---- latency tolerance -------------------------------------------------------------------------------------------------------------------------------------
const stompPage = parsePage({ id: 't', name: 't', blurb: '', floorRows: 2, rows: ['..........................', '..........................', '..........................', '..P..n...C...............G', '##########################', '##########################'] });
test('the host accepts a stomp that was in reach a moment ago (enemy history) and an unlucky one just rejects', () => {
  const w = createWorld(stompPage);
  const e = w.enemies[0];
  assert.ok(e && e.kind === 'acorn');
  for (let i = 0; i < 90; i++) stepWorld(w, 1 / 60, [], { fires: [] });             // 1.5 s: the acorn patrols away
  const nowX = e.x, hist = w.hist[e.id];
  assert.ok(hist.length > 4 && hist.length < 20, `a short history (${hist.length})`);
  assert.ok(hist[hist.length - 1].t - hist[0].t <= MP.stompHistory + 1 / 30 + 1e-9);
  // the actor stood where the acorn WAS 0.25 s ago, further than the plain reach from where it is now
  const old = hist[0];
  const actor = { key: 's1:0', x: old.x, y: old.y + 0.9, tool: null };
  const rx = 1.6 + T.hostSlack;
  assert.ok(stompInReach(hist, { x: nowX, y: e.y }, actor, { rx, ry: 2.4 + T.hostSlack }));
  assert.equal(stompInReach(hist, { x: nowX, y: e.y }, { ...actor, x: old.x + 20 }, { rx, ry: 2.4 }), false);
  assert.equal(stompInReach([], { x: nowX, y: e.y }, { ...actor, x: nowX + 5 }, { rx: 1.6, ry: 2.4 }), false);
  const ok = request(w, 'stomp', { id: e.id, mode: 'stomp' }, actor);
  assert.equal(ok.ok, true); assert.equal(ok.recs[0].t, 'defeat');
  const miss = request(w, 'stomp', { id: e.id, mode: 'stomp' }, { ...actor, x: nowX + 12 });
  assert.deepEqual(miss, { ok: false, reason: 'far' }); assert.equal(e.st, 'walk', 'a rejected stomp never punishes: the enemy just stays');
  const h = []; for (let i = 0; i < 200; i++) pushHistory(h, i / 60, i, 0); assert.ok(h.length <= 12, `bounded history ${h.length}`);
});

test('a replica keeps walking enemies moving between the 10 Hz motion packets (and stops after a quarter second)', () => {
  const w = createWorld(stompPage), e = w.enemies[0];
  applyMotion(w, { e: [[e.id, 10, 3, 1, 'w', null, 0]], o: [] });
  extrapolate(w, 0.05); extrapolate(w, 0.05);
  assert.ok(e.x > 10.1 && e.x < 10.3, `walked on ${e.x}`);
  for (let i = 0; i < 20; i++) extrapolate(w, 0.05);
  assert.ok(e.x < 10.6, 'bounded extrapolation: it stops guessing after PAGE_MP.extrapolate');
  applyMotion(w, { e: [[e.id, 10.4, 3, 1, 'w', null, 0]], o: [] }); assert.equal(e.x, 10.4); assert.equal(enemyById(w, e.id), e);
});

test('a side contact hurts only when it lasts and not right after our own stomp', () => {
  assert.equal(replicaHurts(1, 5), false); assert.equal(replicaHurts(MP.hurtSteps, 5), true);
  assert.equal(replicaHurts(5, MP.hurtGrace - 0.01), false); assert.equal(replicaHurts(5, MP.hurtGrace), true);
});

// ---- pose fields ------------------------------------------------------------------------------------------------------------------------------------------
test('the page pose fields round-trip and old packets decode as defaults', () => {
  const p = { index: 2, position: { x: 1.5, y: 7.25, z: 3 }, velocity: { x: 2, z: 0 }, facing: 1, character: { hat: true }, hatIndex: 0, tailIndex: -1, garlandIndex: -1, moving: true, _air: 1, _puff: true,
    _pageBits: packPageBits({ carryFriend: true, twirl: true, puff: 'lost' }), _pageToolCode: codePageTool('shovel') };
  const wire = encodePose(p, 5, 9);
  assert.equal(wire.length, 16); assert.ok(wire.every(Number.isFinite));   // (Step 73a appended petId)
  const d = decodePose(wire);
  assert.deepEqual(unpackPageBits(d.pbits), { carryObj: false, carryFriend: true, carried: false, twirl: true, puff: 'lost', sled: false, duck: false, vine: false, cannon: false });
  assert.deepEqual(unpackPageBits(packPageBits({ sled: true, duck: true })), { carryObj: false, carryFriend: false, carried: false, twirl: false, puff: 'none', sled: true, duck: true, vine: false, cannon: false });      // (Step 52b)
  assert.equal(pageToolOfCode(d.ptool), 'shovel'); assert.equal(d.flags & 64, 64); assert.equal(d.flags & 16, 16); assert.equal(d.y, 7.25);
  const old = decodePose(wire.slice(0, 13)); assert.equal(old.pbits, 0); assert.equal(old.ptool, 0); assert.equal(old.garland, wire[12]);
  const older = decodePose(wire.slice(0, 11)); assert.equal(older.pbits, 0); assert.equal(older.tail, 0);
  for (const bits of [packPageBits({}), packPageBits({ carryObj: true }), packPageBits({ carried: true, puff: 'pit' }), packPageBits({ puff: 'hearts' })]) assert.equal(packPageBits(unpackPageBits(bits)), bits);
  assert.equal(pageToolOfCode(0), null); assert.equal(codePageTool('banana'), 0);
});

test('the host relays legacy and variant poses for their own slot and drops oversized or foreign-slot packets', () => {   // Field 16 = petId, optional field 17 = variant
  const h = new WorldSync({ role: 'host' }), sent = [];
  h.register('players', { snapshot: () => [{ screen: 's1' }, { screen: 'host' }] });
  h.attachHost({ sendTo() {}, broadcast: (m) => sent.push(m) }); h.screenConnected(1, { clientId: 'c1' }); sent.length = 0;
  const pose = [0, 0, 0, 0, 0, 0, 0, 0, -1, 1, 2, 12, 24, 38, 3, 1];
  const variantPose = [...pose, 5];
  const foreignSlot = [1, ...pose.slice(1), 5];
  h.screenMessage(1, { type: 'poses', p: [pose, variantPose, [...variantPose, 0], foreignSlot] });
  assert.equal(sent.length, 1); assert.deepEqual(sent[0].p, [pose, variantPose]);
});

// ---- pages ------------------------------------------------------------------------------------------------------------------------------------------------
test('every page still validates and toss berries stay optional', () => {
  for (const page of PAGES.values()) { const r = validatePage(page); assert.ok(r.ok, `${page.id}: ${r.errors.join('; ')}`); }
  const ww = PAGES.get('woodcutters-way');
  const toss = ww.berries.filter((b) => b.toss);
  assert.equal(toss.length, 6, 'a berry ledge for the friend toss');
  assert.ok(ww.letters.length === 5 && ww.flowers.length === 3);
  for (const b of toss) assert.ok(!ww.letters.some((l) => Math.abs(l.x - b.x) < 1 && Math.abs(l.y - b.y) < 1) && !ww.flowers.some((f) => Math.abs(f.x - b.x) < 1 && Math.abs(f.y - b.y) < 1), 'letters and pressed flowers are never toss-only');
  // the party never needs it: the goal / letters / flowers are reachable without any toss edge (the validator only uses walking / jumping graphs), and a ledge no toss reaches is an error
  const rows = ww.rows.slice(), y = rows.length - 1 - 11;
  rows[y] = rows[y].slice(0, 118) + 'vvvvvv' + rows[y].slice(124);
  const row10 = rows.length - 1 - 10; rows[row10] = rows[row10].slice(0, 118) + '......' + rows[row10].slice(124);          // no plank: the berries float
  const floating = parsePage({ ...ww, rows, digs: [{ reward: 'berries' }, { reward: 'flower' }] });
  assert.ok(validatePage(floating).errors.some((e) => /toss berry/.test(e)), 'toss berries must sit on a ledge');
  const high = ww.rows.slice(); const yy = high.length - 1 - 14, pp = high.length - 1 - 13;                 // a ledge 8 tiles up: out of every toss's reach
  high[yy] = high[yy].slice(0, 118) + 'vvvvvv' + high[yy].slice(124); high[pp] = high[pp].slice(0, 118) + '======' + high[pp].slice(124);
  const tooHigh = parsePage({ ...ww, rows: high, digs: [{ reward: 'berries' }, { reward: 'flower' }] });
  assert.ok(validatePage(tooHigh).errors.some((e) => /out of reach/.test(e)), 'a ledge no toss reaches is rejected');
});
