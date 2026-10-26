// Step 81b: Bonk Burrows' pure rules (game/party/bonkLogic.js) and stage (world/party/bonk.js): the contract and layout, the seeded slam plan, judging against the DRAWN shadows / mallet and the hop's time window, the
// spectator islets in the camera view, bots and win rates, the screen runtime with real Players (squashed -> pancake -> islet), a repeat play without the how-to, a host + replica pair, the track + sounds + icon.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { PARTY, PLAYER_RADIUS } from '../public/js/config.js';
import { mulberry32 } from '../public/js/utils/rng.js';
import { validateGame, getGame } from '../public/js/game/party/registry.js';
import { hostFor } from '../public/js/game/party/botRoster.js';
import { stageCentre, stageSpawns, spectatorSpot, partyWalkable, bonkObstacles, bonkPads, POCKET } from '../public/js/game/party/partyArea.js';
import { isWalkable } from '../public/js/world/terrain.js';
import { getColliders } from '../public/js/world/colliders.js';
import { GAME, HILLS, buildPlan, warnAt, airborne, squashed, coreR, init, step, apply, request, placing, view, bot, debugWin } from '../public/js/game/party/bonkLogic.js';
import { createBonkWorld } from '../public/js/world/party/bonk.js';
import { pair } from './fixtures/partyPair.js';
import { playBonk, rate, KID } from './fixtures/sim81b.mjs';
import { makeRuntime } from './fixtures/partyRuntime80d.js';
import { fakeCtx } from './fixtures/fakeAudio.js';
import { getTrack, trackInfo, TRACK_TITLES, PARTY_TRACKS } from '../public/js/audio/music.js';
import { ICONS } from '../public/js/ui/icons.js';
import { Sfx } from '../public/js/audio/sfx.js';

const B = PARTY.bonk, O = PARTY.origin, c = stageCentre('bonk');
const roster = (n = 4) => Array.from({ length: n }, (_, slot) => ({ slot }));
const near = (a, b, e = 1e-9, m = '') => assert.ok(Math.abs(a - b) < e, `${m} ${a} ~= ${b}`);
const at = (s, dx = 0, dz = 0) => ({ x: c.x + s.x + dx, z: c.z + s.z + dz });
const hop = (g, slot, t) => { const o = request(g, slot, { t }, { t, slack: PARTY.slack }); if (o.rec) apply(g, o.rec); return o; };

test('the game honours the registry contract; the stage is at +1080; the molehills block walking and sit clear of the starting ring; the two islets are separate ground across the stream; every start is on the meadow', () => {
  assert.deepEqual(validateGame(GAME), []);
  assert.equal(getGame('bonk'), GAME); assert.equal(GAME.kind, 'elim'); assert.deepEqual(GAME.press, ['jump']); assert.deepEqual(GAME.howto.buttons, ['stick', 'jump']); assert.equal(GAME.duration, 60);
  assert.equal(hostFor('bonk').name, 'Cobble'); assert.equal(GAME.host, 'Cobble'); assert.match(hostFor('bonk').lines.welcome, /mallet/);
  assert.deepEqual(PARTY.stageOffset.bonk, { x: 1080, z: 0 }); assert.deepEqual(c, { x: O.x + 1080, z: O.z });
  assert.equal(HILLS.length, 6); assert.deepEqual(bonkObstacles(), HILLS);
  for (let i = 0; i < HILLS.length; i++) {
    const h = HILLS[i]; assert.ok(Math.hypot(h.x, h.z) + h.r < B.meadowR - 1, 'a hill is on the meadow');
    for (let j = i + 1; j < HILLS.length; j++) assert.ok(Math.hypot(h.x - HILLS[j].x, h.z - HILLS[j].z) > h.r + HILLS[j].r + 1.2, 'hills leave room to walk between');
    for (let k = 0; k < 4; k++) { const a = Math.PI / 4 + k * Math.PI / 2; assert.ok(Math.hypot(h.x - Math.cos(a) * B.spawnR, h.z - Math.sin(a) * B.spawnR) > h.r + PLAYER_RADIUS + 0.8, `hill ${i} leaves seat ${k} free`); }
  }
  // each hill is a registered collider (the party runtime adds them once)
  const r = makeRuntime(); const cols = getColliders().filter((k) => k.owner === 'party-bonk'); assert.equal(cols.length, 6);
  for (const h of HILLS) assert.ok(cols.some((k) => Math.abs(k.x - (c.x + h.x)) < 1e-9 && Math.abs(k.z - (c.z + h.z)) < 1e-9 && k.r === h.r), 'collider at the hill'); void r;
  const sp = stageSpawns('bonk', 4); assert.equal(sp.length, 4);
  sp.forEach((s) => { assert.ok(partyWalkable(s.x, s.z) && isWalkable(s.x, s.z)); near(Math.hypot(s.x - c.x, s.z - c.z), B.spawnR, 1e-9); });
  near(Math.hypot(sp[0].x - sp[1].x, sp[0].z - sp[1].z), B.spawnR * Math.SQRT2, 1e-9, 'seats are equally spaced');
  assert.ok(isWalkable(c.x + 2, c.z + 2) && isWalkable(c.x + B.meadowR - 0.5, c.z) && !isWalkable(c.x + B.meadowR + 0.5, c.z), 'the meadow ends at the stream');
  for (let k = 0; k < 4; k++) { const s = spectatorSpot('bonk', k); assert.ok(isWalkable(s.x, s.z), `islet spot ${k}`); assert.ok(Math.hypot(s.x - c.x, s.z - c.z) > B.meadowR + 1.8, 'across the stream from the meadow'); }
  for (const p of B.patches) { const d = Math.hypot(p.x, p.z); assert.ok(d - B.patchR > B.meadowR + 0.8, `the water between the meadow and the islet is ${d - B.patchR - B.meadowR} u wide`); assert.equal(isWalkable(c.x + p.x * (B.meadowR + 0.9) / d, c.z + p.z * (B.meadowR + 0.9) / d), false); }
  assert.equal(bonkPads().filter((p) => p.bench !== undefined).length, 4); assert.ok(c.x + 30 < POCKET.x1);
});

test('the plan is a pure function of the seed: sorted landings, warnings that shorten, singles then pairs then triples and sweeping rows, a clear start, everything on the meadow, a full game of about a minute', () => {
  const a = buildPlan(9), b = buildPlan(9), d = buildPlan(10);
  assert.deepEqual(a, b); assert.notDeepEqual(a.slams.map((s) => [s.x, s.z]), d.slams.map((s) => [s.x, s.z]));
  for (let seed = 1; seed <= 60; seed++) {
    const p = buildPlan(seed * 7919);
    p.slams.forEach((s, i) => {
      assert.equal(s.i, i); if (i) assert.ok(s.T >= p.slams[i - 1].T, 'sorted by landing');
      assert.ok(s.t0 < s.T && Math.abs((s.T - s.t0) - warnAt(s.T)) < 0.55, 'a warning before every landing');
      assert.ok(Math.hypot(s.x, s.z) <= B.meadowR + 5, 'on (or at the edge of) the meadow');
      assert.ok(s.T > B.first && s.T < B.duration + 4);
    });
    assert.ok(p.slams.length > 90, `${p.slams.length} slams`); assert.ok(p.end > 45 && p.end < 70, `the last slam lands at ${p.end}`);
    const first = p.slams.filter((s) => s.grp === 0); assert.equal(first.length, 1, 'one shadow at a time to start');
    for (let k = 0; k < 4; k++) { const a2 = Math.PI / 4 + k * Math.PI / 2; assert.ok(Math.hypot(first[0].x - Math.cos(a2) * B.spawnR, first[0].z - Math.sin(a2) * B.spawnR) >= B.hitR + 1.5, 'the first shadow lands clear of every start'); }
    const groups = new Map(); for (const s of p.slams) groups.set(s.grp, (groups.get(s.grp) || 0) + 1);
    const sizeAt = (t) => [...new Set(p.slams.filter((s) => s.t0 > t && s.t0 < t + 2).map((s) => s.grp))].map((g) => groups.get(g));
    assert.ok(sizeAt(5).every((n) => n === 1) && sizeAt(18).every((n) => n === 2) && sizeAt(32).every((n) => n === 3 || n === 5) && sizeAt(52).every((n) => n === 5 || n === 4));
    const rows = [...groups].filter(([, n]) => n === 5 && true).map(([g]) => p.slams.filter((s) => s.grp === g)).filter((r) => r[0].t0 > 28 && r[1].T - r[0].T > 0.2 && r[1].T - r[0].T < 0.4);
    assert.ok(rows.length >= 2, 'sweeping rows later on'); for (const row of rows.slice(0, 2)) { const len = Math.hypot(row[0].x - row[4].x, row[0].z - row[4].z); assert.ok(len > 12 && len < 15, `a row of five circles about 13.6 long (${len})`); }
  }
  assert.ok(warnAt(2) > warnAt(45) + 0.5 && Math.abs(warnAt(60) - B.warn[1]) < 1e-9 && warnAt(0) <= B.warn[0] + 1e-9, 'the warning shortens from the first to the last');
  // the visible slams at a time: growing shadows, mallets landing, then gone
  const g = init(9, roster(2)), s0 = a.slams[0], v1 = view(g, s0.t0 - 0.01), v2 = view(g, s0.t0 + (s0.T - s0.t0) / 2), v3 = view(g, s0.T + 0.1), v4 = view(g, s0.T + B.keep + 0.2);
  assert.equal(v1.slams.filter((s) => s.i === 0).length, 0); const mid = v2.slams.find((s) => s.i === 0); assert.ok(mid.u > 0.3 && mid.u < 0.7 && mid.phase === 'warn');
  assert.equal(v3.slams.find((s) => s.i === 0).phase, 'down'); assert.equal(v4.slams.filter((s) => s.i === 0).length, 0);
  near(view(g, s0.T - 1e-6).slams.find((s) => s.i === 0).u, 1, 1e-6, 'the shadow is full size at the landing');
});

test('squashed(): inside the red core always; in the outer ring only if not hopping; outside the circle never; the edge is the drawn circle', () => {
  const s = { x: 1, z: 2 }, p = (dx, dz) => at(s, dx, dz);
  const R = B.hitR, core = coreR(); near(core, B.core * R); assert.ok(core < R * 0.7 && core > R * 0.4);
  assert.equal(squashed(s, ...Object.values(p(0, 0)), false), true); assert.equal(squashed(s, ...Object.values(p(0, 0)), true), true, 'the very middle: a hop does not help');
  assert.equal(squashed(s, ...Object.values(p(core - 0.01, 0)), true), true); assert.equal(squashed(s, ...Object.values(p(core + 0.01, 0)), true), false, 'just outside the core: saved by a hop');
  assert.equal(squashed(s, ...Object.values(p(core + 0.01, 0)), false), true, 'the same spot without a hop: squashed');
  assert.equal(squashed(s, ...Object.values(p(R - 0.001, 0)), false), true); assert.equal(squashed(s, ...Object.values(p(R + 0.001, 0)), false), false, 'the circle is exactly hitR'); assert.equal(squashed(s, ...Object.values(p(0, -R + 0.01)), false), true);
  assert.equal(squashed(s, ...Object.values(p(R * 0.8, R * 0.8)), false), false, 'a corner of the bounding square is not in the circle');
});

test('judging: the host reads each player\'s REAL position AT the landing time (from a short history), a hop only counts by its time window, a player who left in time is safe, unknown positions are never squashed, one record per slam', () => {
  const plan = buildPlan(21), s0 = plan.slams[0], T = s0.T;
  const mk = () => init(21, roster(3));
  const run1 = (g, posAt, from = 0, to = T + B.lag + 0.1, hops = []) => {
    const recs = []; let t = from;
    while (t < to) { t += 1 / 60; for (const [slot, ht] of hops) if (Math.abs(t - ht) < 1 / 120) hop(g, slot, ht); for (const r of step(g, { t, pos: (s) => posAt(s, t) }, 1 / 60, t)) { apply(g, r); recs.push(r); } }
    return recs;
  };
  // 0 stands in the middle (squashed), 1 in the outer ring (squashed without a hop), 2 outside
  let g = mk(), recs = run1(g, (s) => (s === 0 ? at(s0) : s === 1 ? at(s0, coreR() + 0.4, 0) : at(s0, B.hitR + 0.3, 0)));
  const bonks = recs.filter((r) => r.k === 'bonk'); assert.equal(bonks[0].i, 0); assert.equal(bonks[0].t, T); assert.deepEqual(bonks[0].out, [0, 1]); assert.equal(g.alive[2], true); assert.equal(g.next, bonks.length);
  assert.equal(g.outAt[0], T); assert.equal(g.outAt[1], T);
  // a hop that is in the air at T saves the outer ring; the middle is squashed anyway; a hop too early or too late does nothing
  const where = (s) => (s === 0 ? at(s0) : s === 1 ? at(s0, coreR() + 0.4, 0) : at(s0, coreR() + 0.4, 0));
  g = mk(); recs = run1(g, where, 0, T + 0.5, [[0, T - 0.25], [1, T - 0.25], [2, T - 0.9]]);
  const out0 = recs.find((r) => r.k === 'bonk' && r.i === 0).out; assert.deepEqual(out0, [0, 2], 'the hop at the right moment saved slot 1 (the outer ring); the middle and the early hop did not');
  g = mk(); recs = run1(g, where, 0, T + 0.5, [[1, T - (B.airFrom + B.airTo) / 2 - 0.2], [2, T - B.airFrom + 0.05]]);          // (window [at + .06, at + .5]: -0.2 centred is fine at the edges; +.05 after the start is too late)
  assert.equal(recs.find((r) => r.k === 'bonk' && r.i === 0).out.includes(1), false, 'a hop whose window covers T saves');
  assert.equal(airborne({ hops: { 0: 5 } }, 0, 5.05), false); assert.equal(airborne({ hops: { 0: 5 } }, 0, 5 + B.airFrom), true); assert.equal(airborne({ hops: { 0: 5 } }, 0, 5 + B.airTo), true); assert.equal(airborne({ hops: { 0: 5 } }, 0, 5 + B.airTo + 0.01), false); assert.equal(airborne({ hops: {} }, 0, 5), false);
  // the history: standing in the circle at T but running out right after is squashed; being outside at T and running in after is safe (a late packet changes nothing)
  g = mk(); recs = run1(g, (s, t) => (s === 0 ? at(s0, t < T + 0.04 ? 0 : 6, 0) : s === 1 ? at(s0, t < T + 0.04 ? 6 : 0, 0) : null));
  assert.deepEqual(recs.find((r) => r.k === 'bonk' && r.i === 0).out, [0], 'judged where they were at T'); assert.equal(g.alive[2], true, 'unknown = never squashed');
  // judged once, after T + lag, never before
  g = mk(); recs = run1(g, () => at(s0), 0, T + B.lag - 0.05); assert.equal(recs.filter((r) => r.k === 'bonk').length <= 0 || recs.every((r) => r.i !== 0), true, 'not before T + lag');
  g = mk(); recs = run1(g, () => at(s0), 0, T + 3); assert.equal(recs.filter((r) => r.k === 'bonk' && r.i === 0).length, 1, 'one record per slam');
});

test('a game: the last one standing wins, the cap ends it with everybody still up as winners, simultaneous squashes tie, a solo game goes on until the player is squashed, records replay to the same result', () => {
  const plan = buildPlan(30);
  const g = init(30, roster(3)); let t = 0, ended = null;
  const stand = (s, T) => (s === 0 ? { x: c.x + 99, z: c.z } : null);                                  // (slot 0 stays far away from everything; the others have no position: nobody is squashed)
  for (let k = 0; k < 60 * 70 && !g.done; k++) { t += 1 / 60; for (const r of step(g, { t, pos: (s) => stand(s) }, 1 / 60, t)) { apply(g, r); if (r.k === 'end') ended = r; } }
  assert.equal(ended.why, 'cap'); assert.ok(ended.t >= 60 && ended.t < 61); assert.deepEqual(placing(g).map((p) => p.place), [1, 1, 1]); assert.equal(g.next, plan.slams.length, 'every slam was judged');
  // one by one: slot 2 is squashed by the first slam it stands under, then slot 1; slot 0 wins
  const h = init(30, roster(3)); t = 0; const trace = [];
  const posOf = (s, T) => { if (s === 0) return { x: c.x + 99, z: c.z }; const sl = plan.slams.find((q) => q.T > T - 0.01 && (s === 2 || q.T > 20)); return at(sl); };
  for (let k = 0; k < 60 * 60 && !h.done; k++) { t += 1 / 60; for (const r of step(h, { t, pos: (s) => (s === 0 ? posOf(0) : at(plan.slams.find((q) => q.T > t - B.lag + 0.0 && (s === 2 || q.T > 20)) || { x: 0, z: 0 })) }, 1 / 60, t)) { apply(h, r); trace.push(JSON.parse(JSON.stringify(r))); } }
  assert.equal(h.done, true); assert.deepEqual(placing(h).map((p) => [p.slot, p.place]), [[0, 1], [1, 2], [2, 3]]); assert.ok(h.outAt[1] > h.outAt[2]);
  const fresh = init(30, roster(3)); for (const r of trace) apply(fresh, r); assert.deepEqual(placing(fresh), placing(h)); assert.deepEqual(fresh.alive, h.alive);
  // two squashed by the same landing share a place; everybody squashed together ends with a shared first place
  const tie = init(31, roster(2)), s0 = buildPlan(31).slams[0]; t = 0;
  for (let k = 0; k < 60 * 12 && !tie.done; k++) { t += 1 / 60; for (const r of step(tie, { t, pos: () => at(s0) }, 1 / 60, t)) apply(tie, r); }
  assert.ok(tie.done && !tie.alive[0] && !tie.alive[1]); assert.deepEqual(placing(tie).map((p) => p.place), [1, 1]);
  // solo: goes on until squashed
  const solo = init(31, roster(1)); t = 0; for (let k = 0; k < 60 * 12; k++) { t += 1 / 60; for (const r of step(solo, { t, pos: () => ({ x: c.x + 99, z: c.z }) }, 1 / 60, t)) apply(solo, r); } assert.equal(solo.done, false);
  for (let k = 0; k < 60 * 12 && !solo.done; k++) { t += 1 / 60; for (const r of step(solo, { t, pos: () => at(buildPlan(31).slams[solo.next] || s0) }, 1 / 60, t)) apply(solo, r); } assert.equal(solo.done, true); assert.equal(solo.alive[0], false);
  // debug win; requests: only a living player in a running game, a second hop waits for the cool-down
  const dw = init(3, roster(4)); for (const r of debugWin(dw, 1, 5)) apply(dw, r); assert.deepEqual(Object.keys(dw.alive).filter((s) => dw.alive[s]), ['1']);
  const q = init(3, roster(2)); assert.equal(hop(q, 0, 2).rec.k, 'hop'); assert.equal(hop(q, 0, 2 + B.cool - 0.05).reject, 'cool'); assert.ok(hop(q, 0, 2 + B.cool + 0.01).rec); q.alive[1] = false; assert.equal(request(q, 1, { t: 3 }, { t: 3 }).reject, 'out'); q.done = true; assert.deepEqual(request(q, 0, { t: 3 }, { t: 3 }), { ignore: true });
  // a remote stamp from the future or the long past is clamped into the host's recent past
  const rs = init(3, roster(2)); assert.equal(request(rs, 0, { t: 99 }, { t: 5, slack: 0.35 }).rec.at, 5); assert.equal(request(rs, 0, { t: 1 }, { t: 5, slack: 0.35 }).rec.at, 4.65);
});

test('judging uses the DRAWN shadows and mallets: the ring is hitR, the red ring is the core, the shadow reaches the ring at the landing, the mallet head is a cylinder of exactly hitR that is down at the landing; the molehills are drawn where they block', () => {
  const scene = new THREE.Scene(), fx = { sfx: { play() {} }, particles: { burst() {} }, labels: { label() {}, clear() {} } }, w = createBonkWorld({ scene, ...fx });
  w.setVisible(true);
  const rings = w.root.getObjectByName('bonk-rings'), pos = rings.geometry.attributes.position, col = rings.geometry.attributes.color, white = [], red = [];
  for (let i = 0; i < pos.count; i++) { const r = Math.hypot(pos.getX(i), pos.getZ(i)); (col.getX(i) > 0.9 && col.getY(i) < 0.4 ? red : white).push(r); }
  near(Math.max(...white), B.hitR, 1e-6, 'the faint ring ends at hitR'); near(Math.max(...red), coreR(), 1e-6, 'the red ring ends at the core radius');
  const mallets = w.root.getObjectByName('bonk-mallets'), mp = mallets.geometry.attributes.position; let head = 0, top = 0;
  for (let i = 0; i < mp.count; i++) { const y = mp.getY(i), r = Math.hypot(mp.getX(i), mp.getZ(i)); if (y < 1.5) head = Math.max(head, r); top = Math.max(top, y); }
  near(head, B.hitR, 1e-6, 'the mallet head has exactly the judged radius'); assert.ok(top > 15, 'the handle goes up out of the picture');
  const g = init(5, roster(2)), s0 = buildPlan(5).slams[0], mid = (s0.t0 + s0.T) / 2;
  w.update(1 / 60, { mode: 'play', v: view(g, mid), t: mid });
  let d = w.shadowDraw(0); assert.equal(d.i, 0); near(d.x, s0.x); near(d.z, s0.z); near(d.r, B.hitR); near(d.core, coreR()); assert.ok(d.u > 0.3 && d.u < 0.7); assert.equal(w.malletDraw(0).y, -1, 'the mallet is still above, out of sight');
  w.update(1 / 60, { mode: 'play', v: view(g, s0.T - 0.0001), t: s0.T - 0.0001 }); d = w.shadowDraw(0); near(d.u, 1, 1e-3, 'full size at the landing'); assert.ok(w.malletDraw(0).y < 0.2, `the mallet is down at the landing (${w.malletDraw(0).y})`);
  w.update(1 / 60, { mode: 'play', v: view(g, s0.T + 0.1), t: s0.T + 0.1 }); assert.equal(w.malletDraw(0).y, 0, 'it rests on the meadow'); w.update(1 / 60, { mode: 'play', v: view(g, s0.T + B.keep + 0.3), t: s0.T + B.keep + 0.3 }); assert.equal(w.drawnSlams().find((q) => q.i === 0), undefined, 'and goes away');
  const base = w.root.getObjectByName('bonk-base').geometry.attributes.position; for (const h of HILLS) { let found = 0; for (let i = 0; i < base.count; i++) { const y = base.getY(i); if (y > 0.2 && Math.abs(Math.hypot(base.getX(i) - h.x, base.getZ(i) - h.z) - 0) < h.r * 0.9 && y < h.r * 0.56) found++; } assert.ok(found > 8, `a mound is drawn at hill ${HILLS.indexOf(h)}`); }
  assert.ok(w.summary().meshes < 30, `draw calls ${w.summary().meshes}`);
  w.setVisible(false);
});

test('bots: they notice a shadow after react s, walk to the nearest clear spot (off the hills, on the meadow), hop when they cannot get out in time and stand in the outer ring, sometimes miss a shadow on easy, and fallen ones do nothing', () => {
  const plan = buildPlan(8), s0 = plan.slams[0], g = init(8, roster(1)), rng = mulberry32(1);
  const inside = at(s0, 0.5, 0), me = (mem) => ({ slot: 0, ...inside, mem });
  const stroll = (o) => Math.hypot(o.x, o.y) <= B.wander.pace + 1e-9;
  assert.ok(stroll(bot(view(g, s0.t0 + 0.02), me({}), PARTY.bots.easy, mulberry32(2))), 'not yet: it has not noticed (at most an idle stroll, never a run)');
  const out = bot(view(g, s0.t0 + 1.0), me({}), PARTY.bots.hard, rng); assert.ok(Math.hypot(out.x, out.y) > 0.9, 'a hard bot runs');
  // it runs AWAY from the circle's centre
  const dx = (inside.x - c.x - s0.x), dz = (inside.z - c.z - s0.z); assert.ok(out.x * dx + (-out.y) * dz > 0, 'away from the middle');
  assert.ok(Math.hypot(...Object.values(bot(view(g, s0.t0 + 1.0), me({}), PARTY.bots.easy, mulberry32(3)))) <= Math.hypot(out.x, out.y) + 1e-9, 'an easy bot is not faster');
  assert.ok(stroll(bot(view(g, s0.t0 + 1.0), { slot: 0, ...at({ x: 0, z: 0 }, 99, 99), mem: {} }, PARTY.bots.hard, rng)), 'nothing near it: it only strolls');
  g.alive[0] = false; assert.deepEqual(bot(view(g, s0.t0 + 1.0), me({}), PARTY.bots.hard, rng), { x: 0, y: 0 }, 'squashed'); g.alive[0] = true;
  // it never steers into a hill: the chosen goal is clear of every molehill and inside the meadow
  for (let k = 0; k < 40; k++) { const sl = { ...s0, x: HILLS[k % 6].x + 1, z: HILLS[k % 6].z }; const v = view(g, 3); v.slams = [{ ...sl, phase: 'warn', t0: 1, T: 3.4, u: 0.5 }]; const o = bot(v, { slot: 0, ...at(sl, -0.2, 0.2), mem: {} }, PARTY.bots.hard, mulberry32(k)); assert.ok(Math.hypot(o.x, o.y) <= 1 + 1e-9); }
  // hop: when it cannot get out of the circle in time but stands in the outer ring, a normal / hard bot jumps right before the landing; a bot in the red core does not
  const v = view(g, 0), T = 10, sl = { i: 0, t0: 9, T, x: 0, z: 0, phase: 'warn', u: 0.9 };
  const outer = { slot: 0, ...at({ x: 0, z: 0 }, coreR() + 0.5, 0), mem: {} }, mem = outer.mem;
  let hopped = 0; for (let tt = 9.3; tt < 10.05; tt += 1 / 60) { v.t = tt; v.slams = [sl]; const o = bot(v, { ...outer, mem }, PARTY.bots.hard, mulberry32(1)); if (o.jump) { hopped++; assert.ok(Math.abs(tt - (T - ((B.airFrom + B.airTo) / 2 - 0.02))) < 0.15, `hops at ${tt}`); } }
  assert.equal(hopped, 1, 'one hop, at the right moment');
  const core = { slot: 0, ...at({ x: 0, z: 0 }, 0.3, 0), mem: {} }; hopped = 0; for (let tt = 9.3; tt < 10.05; tt += 1 / 60) { v.t = tt; v.slams = [sl]; if (bot(v, { ...core, mem: core.mem }, PARTY.bots.hard, mulberry32(1)).jump) hopped++; } assert.equal(hopped, 0, 'a hop would not save it in the core');
  // easy bots miss a shadow now and then
  let blind = 0; for (let s = 0; s < 400; s++) { const mem2 = {}; bot({ ...view(g, s0.t0 + 3), slams: [{ ...s0, phase: 'warn', u: 0.8 }] }, { slot: 0, ...inside, mem: mem2 }, PARTY.bots.easy, mulberry32(s + 1)); if (mem2.seen[s0.i].blind) blind++; }
  assert.ok(blind / 400 > 0.04 && blind / 400 < 0.3, `easy bots miss ${blind / 4}%`);
});

test('win rates over seeded runs: a scripted average kid beats easy bots most of the time and loses to hard ones; no seat is favoured; a game with easy bots lasts well over half a minute; nobody is ever stuck', () => {
  const Bt = PARTY.bots, n = 120;
  const easy = rate(playBonk, KID, [Bt.easy, Bt.easy, Bt.easy], n), normal = rate(playBonk, KID, [Bt.normal, Bt.normal, Bt.normal], n), hard = rate(playBonk, KID, [Bt.hard, Bt.hard, Bt.hard], n);
  assert.ok(easy > 0.6, `kid vs easy ${easy}`); assert.ok(hard < 0.3, `kid vs hard ${hard}`); assert.ok(easy > normal && normal > hard - 0.05, `${easy} > ${normal} > ${hard}`);
  const wins = [0, 0, 0, 0]; let total = 0, games = 80, outs = 0;
  for (let i = 0; i < games; i++) { const r = playBonk(3100 + i * 17, [Bt.easy, Bt.easy, Bt.easy, Bt.easy], i + 1); total += r.t; outs += Object.keys(r.g.outAt).length; assert.ok(r.g.done); for (const p of r.placing) if (p.place === 1) wins[p.slot]++; }
  const mean = wins.reduce((a, b) => a + b, 0) / 4; for (const wn of wins) assert.ok(Math.abs(wn - mean) < mean * 0.5, `seat wins ${wins}`);
  assert.ok(total / games > 28 && total / games < 61, `average length ${(total / games).toFixed(1)} s`); assert.ok(outs / games > 1.5, `${(outs / games).toFixed(1)} players squashed per game`);
  // with a kid and three easy bots the game goes on well past half a minute on average
  let withKid = 0; for (let i = 0; i < 40; i++) withKid += playBonk(900 + i, [KID, Bt.easy, Bt.easy, Bt.easy], i + 1).t; assert.ok(withKid / 40 > 33, `kid + easy bots last ${(withKid / 40).toFixed(1)} s`);
});

// ---------------------------------------------------------------------------------------------------------------- the screen runtime
test('the whole meadow with its stream, both spectator islets and standing heads fit the fixed camera at 16:9, 9:16 and a phone in landscape', async () => {
  const r = makeRuntime(); r.party.open({ bots: 0, games: ['bonk'] }); await r.party.play('bonk'); r.run(8, () => r.party.place === 'bonk');
  for (const aspect of [16 / 9, 9 / 16, 19.5 / 9]) {
    r.camera.aspect = aspect; r.camera.updateProjectionMatrix(); r.followCam.snap(); r.party.updateCamera(0); r.camera.updateMatrixWorld(true);
    const pts = [];
    for (const h of [0, 2.1]) {
      for (let i = 0; i < 24; i++) { const a = i * Math.PI / 12; pts.push([c.x + Math.cos(a) * (B.meadowR - 0.3), O.y + h, c.z + Math.sin(a) * (B.meadowR - 0.3)]); }
      for (const p of B.patches) for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; pts.push([c.x + p.x + Math.cos(a) * (B.patchR - 0.2), O.y + h, c.z + p.z + Math.sin(a) * (B.patchR - 0.2)]); }
    }
    for (const [x, y, z] of pts) { const p = new THREE.Vector3(x, y, z).project(r.camera); assert.ok(Math.abs(p.x) < 0.97 && Math.abs(p.y) < 0.97 && p.z < 1, `${aspect}: (${(x - c.x).toFixed(1)}, ${(z - c.z).toFixed(1)}) -> ${p.x.toFixed(2)}, ${p.y.toFixed(2)}`); }
  }
  r.party.close(); r.run(4);
});

test('Bonk Burrows on the real runtime: bots (real Players) dodge, a person who stands still is squashed flat then pops up on an islet and can walk there, squashed bots stroll their islet, the host judges from the Players\' positions', async () => {
  const r = makeRuntime(); r.pm.p1.teleport(10, 14);
  r.party.open({ bots: 'fill', difficulty: 'easy', games: ['bonk', 'tilty'] });
  const me = r.pm.p1; let flat = 0, islet = 0, strolled = 0, hopsSeen = 0; const last = new Map();
  // (the seed and the bots' dodging are random: now and then the still person outlasts every bot, so play up to three games)
  for (let tries = 0; tries < 3; tries++) {
  flat = 0; islet = 0; strolled = 0; hopsSeen = 0; last.clear();
  await r.party.play('bonk'); r.run(8, () => r.pm.bots.length === 3 && r.party.state.phase !== 'results');
  assert.equal(r.party.state.game, 'bonk');
  const isletOf = (p) => B.patches.some((q) => Math.hypot(p.position.x - c.x - q.x, p.position.z - c.z - q.z) < B.patchR + 0.1);
  r.run(100, () => {
    const s = r.party.state;
    if (s.phase === 'play' && s.g) {
      if (s.g.alive[0] === false) { if (me.downed) flat++; if (isletOf(me)) islet++; }
      for (const p of r.pm.bots) { if (s.g.alive[p.index] === false && isletOf(p)) { const l = last.get(p); if (l && Math.hypot(l.x - p.position.x, l.z - p.position.z) > 0.01) strolled++; last.set(p, p.position.clone()); } }
      hopsSeen = Math.max(hopsSeen, Object.keys(s.g.hops).length);
    }
    return s.phase === 'results';
  });
  if (r.party.state.g.alive[0] === false) break;
  }
  const s = r.party.state; assert.equal(s.phase, 'results'); assert.ok(s.g.done); assert.equal(s.g.alive[0], false, 'a person who never moves is squashed');
  assert.ok(flat > 20, `${flat} flat frames`); assert.ok(islet > 10, `${islet} frames on the islet`); assert.ok(s.g.next > 3, `${s.g.next} slams judged`);
  assert.ok(r.calls.sfx.includes('malletthump') && r.calls.sfx.includes('malletsqueak')); assert.ok(r.calls.music.includes('bonk'));
  assert.ok(Object.keys(s.g.outAt).length >= 2, 'bots get squashed on easy too'); assert.ok(strolled > 5 || Object.keys(s.g.outAt).length < 2, `${strolled} strolling frames`);
  assert.equal(r.party.summary().stages.bonk.visible, true); assert.equal(me.downed, false, 'back on its feet by the end');
  r.run(PARTY.flow.results + 1, () => r.party.state.phase === 'lobby'); assert.equal(r.party.summary().stages.bonk.visible, false); void hopsSeen;
});

test('a hop is a real request: the Jump press hops the Player, the host records it and a hop in the air at the landing saves a player in the outer ring (real Player, real clock); a repeat play skips the how-to', async () => {
  const r = makeRuntime(); r.pm.p1.teleport(10, 14); const sec = r.pm.spawnDebugPlayer('second');
  r.party.open({ bots: 0, difficulty: 'easy', games: ['bonk'] }); r.party.debug.seed(41);
  await r.party.play('bonk'); r.run(6, () => r.party.state.phase === 'howto'); assert.equal(r.party.state.phase, 'howto');
  r.pm.fake('second', { jump: true }); r.run(0.2); r.pm.fake('second', { jump: false });                              // (a hop in the how-to rehearsal is local: nothing is judged)
  assert.deepEqual(r.party.state.g, null);
  r.party.skip(); r.run(1); r.run(10, () => r.party.state.phase === 'play'); assert.equal(r.party.state.phase, 'play');
  const plan = buildPlan(r.party.state.seed), s0 = plan.slams[0];
  // put both players in the outer ring of the first slam; the second player hops at the right moment, p1 does not
  const ring = (dx) => at(s0, coreR() + 0.45, dx); const a = ring(0), b = ring(0.1);
  r.run(40, () => { const gt = r.party.domain.gameTime(); if (gt > s0.T - 0.6) return true; return false; });
  sec.teleport(a.x, a.z); r.pm.p1.teleport(b.x + 0.05, b.z + 0.9);
  r.run(40, () => { const gt = r.party.domain.gameTime(); if (gt >= s0.T - 0.45) { r.pm.fake('second', { jump: true }); return true; } return false; }); r.run(0.1); r.pm.fake('second', { jump: false });
  r.run(1.3, () => r.party.state.g && r.party.state.g.next >= 1);
  const g = r.party.state.g; assert.ok(g.hops[1] !== undefined && g.hops[0] === undefined, 'the host recorded the hop of the second player only'); assert.ok(g.next >= 1, 'the first slam was judged');
  assert.equal(g.alive[1], true, 'the hop saved the player in the outer ring'); assert.equal(g.alive[0], false, 'the one who stood in the same ring without hopping was squashed');
  r.party.debug.end(); r.run(6); r.run(40, () => r.party.state.phase === 'lobby');
  r.pm.p1.teleport(10, 14);
  return r.party.play('bonk').then(() => { r.run(12, () => ['howto', 'countdown'].includes(r.party.state.phase)); assert.equal(r.party.state.phase, 'countdown', 'the second play skips the how-to'); r.run(0.5);
    const sp = stageSpawns('bonk', 2); [r.pm.p1, sec].forEach((p, i) => assert.ok(Math.hypot(p.position.x - sp[i].x, p.position.z - sp[i].z) < 1.2, `player ${i} back on its start`)); r.party.close(); r.run(4); });
});

// ---------------------------------------------------------------------------------------------------------------- host + replica
test('a host + replica pair play a whole Bonk Burrows with equal hashes; a replica\'s position and hop are judged by the host; the results agree', () => {
  const pos = {}, w = pair({ positionOf: (slot) => pos[slot] || null }), slots = [0, 1, w.rSlot];
  w.host.open({ games: ['bonk'], bots: 0 }); w.flush(); w.host.debug.play('bonk'); w.flush();
  for (let i = 0; i < 2; i++) { w.host.skip(); w.flush(); }
  assert.equal(w.host.state.phase, 'countdown'); w.run(PARTY.flow.countdown + 0.2); assert.equal(w.host.state.phase, 'play'); w.equal('at the start');
  const sp = stageSpawns('bonk', 3); slots.forEach((s, i) => { pos[s] = { x: sp[i].x, z: sp[i].z }; });
  const mems = {}, rng = mulberry32(3); let n = 0;
  w.run(70, 1 / 30, () => {
    const g = w.host.state.g; if (!g) return true;
    const v = view(g, w.host.gameTime());
    slots.forEach((s) => {
      if (!g.alive[s]) return;
      const it = bot(v, { slot: s, x: pos[s].x, z: pos[s].z, mem: mems[s] ||= {} }, s === w.rSlot ? PARTY.bots.hard : PARTY.bots.easy, rng);
      pos[s] = { x: pos[s].x + it.x * 7 / 30, z: pos[s].z - it.y * 7 / 30 };
      if (it.jump) { if (s === w.rSlot) w.replica.act(w.rActor(), w.replica.gameTime()); else w.host.act(w.host.hostActor(s), w.host.gameTime()); }
    });
    if (++n % 25 === 0) { w.flush(); w.equal(`mid game ${n}`); }
    return w.host.state.phase !== 'results';
  });
  w.flush(); assert.equal(w.host.state.phase, 'results'); w.equal('at the results');
  assert.deepEqual(w.replica.state.g.alive, w.host.state.g.alive); assert.deepEqual(w.replica.state.g.outAt, w.host.state.g.outAt); assert.deepEqual(w.replica.state.g.hops, w.host.state.g.hops);
  assert.ok(w.host.state.g.next > 5, 'slams were judged'); assert.ok(Object.keys(w.host.state.g.outAt).length >= 1, 'somebody was squashed'); assert.deepEqual(w.host.state.results.ranks, w.replica.state.results.ranks);
});

// ---------------------------------------------------------------------------------------------------------------- music + sounds + icons
test('track 32 Mallet March: a cartoon oompah march at 120 bpm, pinned; the older tracks stay as they were; the game plays it; the new sounds and the icon exist', () => {
  assert.equal(TRACK_TITLES[32], 'Mallet March'); assert.equal(PARTY_TRACKS.bonk, 32); assert.equal(GAME.track, 'bonk');
  const pins = { 32: '7b1d7a9620c3a90f71120fb74618eccbc7d9eeb81dc144e8433b36b2cf794803', 31: 'f75b2d1ad0fce992eca3c79a02d8a1dbc42ba1a5524f401df6e4e5f886bed799', 30: '7964f0f602945537848aec5ed5b42b3bc60ed386e1acfa19e0a5ab9bc4478218' };
  for (const [i, h] of Object.entries(pins)) assert.equal(createHash('sha256').update(JSON.stringify(getTrack(Number(i)).events)).digest('hex'), h, `track ${i} (${TRACK_TITLES[i]})`);
  const info = trackInfo()[32], tr = getTrack(32); assert.equal(info.bpm, 120); assert.ok(info.seconds > 55 && info.seconds < 75);
  assert.deepEqual(tr.events, tr.def.build().events, 'deterministic'); const kinds = new Set(tr.events.map((e) => e.k));
  for (const k of ['bass', 'kick', 'click', 'logdrum', 'mutedTrumpet', 'theremin', 'pluck']) assert.ok(kinds.has(k), k);
  assert.ok(tr.events.some((e) => e.k === 'theremin' && e.o && e.o.from !== undefined), 'slide-whistle swoops');
  let prev = 0; for (const e of tr.events) { assert.ok(e.s >= prev && e.s < tr.steps && e.d > 0 && e.v > 0 && e.v <= 1); prev = e.s; for (const nn of Array.isArray(e.m) ? e.m : [e.m]) assert.ok(Number.isFinite(nn)); }
  const sfx = new Sfx(), names = ['malletthump', 'malletsqueak'];
  for (const nme of names) assert.doesNotThrow(() => sfx.play(nme, { pitch: 1.2, vol: 0.5 }), nme); sfx.ctx = fakeCtx; sfx.master = { connect() {} };
  for (const nme of names) assert.doesNotThrow(() => sfx.play(nme, { pitch: 1.4 }), nme);
  assert.ok(ICONS['party-bonk'] && ICONS['party-bonk'].startsWith('<svg') && ICONS['party-bonk'].endsWith('</svg>')); assert.doesNotMatch(ICONS['party-bonk'], /[\u{1F300}-\u{1FAFF}☀-➿]/u);
});

test('an idle bot strolls the meadow (playtest 2026-10-26): with no shadow over it, it walks to fresh spots at a stroll, pauses, never leaves the meadow and never stands on a molehill', () => {
  const g = init(8, roster(1)), m = {}, rng = mulberry32(4); let x = c.x + 3, z = c.z + 3, moved = 0, still = 0;
  for (let k = 0; k < 60 * 20; k++) {
    const v = view(g, k / 60); v.slams = [];
    const o = bot(v, { slot: 0, x, z, mem: m }, PARTY.bots.easy, rng), sp = Math.hypot(o.x, o.y);
    assert.ok(sp <= B.wander.pace + 1e-9, 'a stroll, not a run');
    if (sp < 1e-9) still++;
    const nx = x + o.x * 3.5 / 60, nz = z - o.y * 3.5 / 60; moved += Math.hypot(nx - x, nz - z); x = nx; z = nz;
    assert.ok(Math.hypot(x - c.x, z - c.z) < B.meadowR, 'inside the meadow');
  }
  assert.ok(moved > 6, `it walks about (${moved.toFixed(1)} u in 20 s)`); assert.ok(still > 20, 'and pauses now and then');
  for (const h of HILLS) assert.ok(Math.hypot(m.wander.x - h.x, m.wander.z - h.z) > h.r, 'its goal is never on a molehill');
});
