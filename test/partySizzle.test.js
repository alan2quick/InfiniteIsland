// Step 80c: Sizzle Seed's pure rules (game/party/sizzleLogic.js), its stage (world/party/sizzle.js): the contract, the pocket pieces, passing (touch, nearest wins, no pass-back, cool-down), the HIDDEN pop time
// (never in a state, record, snapshot or hash a replica can read before the pop), rounds and ranks, the seed drawn over exactly the holder, the bots' win rates against a scripted average kid, and a host + replica
// pair through a whole game with equal hashes.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { installDom } from './fixtures/domStub.js';
import { PARTY } from '../public/js/config.js';
import { mulberry32 } from '../public/js/utils/rng.js';
import { validateGame, getGame } from '../public/js/game/party/registry.js';
import { hostFor } from '../public/js/game/party/botRoster.js';
import { stageCentre, stageSpawns, spectatorSpot, partyWalkable, sizzleObstacles } from '../public/js/game/party/partyArea.js';
import { isWalkable } from '../public/js/world/terrain.js';
import {
  GAME, init, step, apply, request, placing, view, bot, heatAt, holderSpeed, roundsFor, pickHolder, setSecretRng, secretOf, steer, debugWin,
} from '../public/js/game/party/sizzleLogic.js';
import { createSizzleWorld, SEED_LIFT } from '../public/js/world/party/sizzle.js';
import { pair } from './fixtures/partyPair.js';
import { playSizzle, rate, KID } from './fixtures/sim80c.mjs';

installDom();
const S = PARTY.sizzle, c = stageCentre('sizzle');
const roster = (n = 4) => Array.from({ length: n }, (_, slot) => ({ slot }));
const near = (slot, dx = 0) => ({ x: c.x + dx, z: c.z + slot * 0.1 });
/** step the game with a fixed set of positions and apply what it says; returns the records */
function tick(g, pos, t, dt = 1 / 30) { const recs = step(g, { t, pos: (s) => pos[s] ?? null }, dt, t); for (const r of recs) apply(g, r); return recs; }

test('the game honours the registry contract and the stage is in the pocket: spawns, cheering spots and the clearing are walkable, the fire and benches are obstacles', () => {
  assert.deepEqual(validateGame(GAME), []);
  assert.equal(getGame('sizzle'), GAME); assert.equal(GAME.kind, 'elim'); assert.deepEqual(GAME.press, []); assert.deepEqual(GAME.howto.buttons, ['stick']);
  assert.equal(hostFor('sizzle').name, 'Dub Nyangee'); assert.match(hostFor('sizzle').lines.welcome, /gentl|warm/i);
  assert.deepEqual(PARTY.stageOffset.sizzle, { x: 450, z: 0 }); assert.deepEqual(c, { x: PARTY.origin.x + 450, z: PARTY.origin.z });
  for (const p of stageSpawns('sizzle', 4)) { assert.ok(partyWalkable(p.x, p.z) && isWalkable(p.x, p.z)); const d = Math.hypot(p.x - c.x, p.z - c.z); assert.ok(Math.abs(d - S.spawnR) < 1e-6); }
  for (let k = 0; k < 4; k++) { const s = spectatorSpot('sizzle', k); assert.ok(partyWalkable(s.x, s.z), `cheering spot ${k}`); }
  assert.equal(isWalkable(c.x + S.arenaR + 0.5, c.z), false);
  const obs = sizzleObstacles();
  assert.equal(obs.length, 1 + 3 * S.benches.angles.length); assert.equal(obs[0].r, S.fireR);
  for (const sp of stageSpawns('sizzle', 4)) for (const o of obs) assert.ok(Math.hypot(sp.x - c.x - o.x, sp.z - c.z - o.z) > o.r + 1.2, 'nobody starts inside an obstacle');
  // a clear walking ring exists between the benches and the wall (the bots' steering round the fire)
  assert.ok(S.arenaR - S.benches.r - S.benches.cr > 2.2);
  assert.ok(GAME.duration >= S.fuse[1] + 3 && S.cap > S.first + S.fuse[1] * roundsFor(4) + S.pause * 2);
});

test('the rounds: two pops for three or four players, one for two (or one), always at least one friend left', () => {
  assert.deepEqual([1, 2, 3, 4].map(roundsFor), [1, 1, 2, 2]);
  const g = init(5, roster(4)); assert.equal(g.rounds, 2); assert.equal(g.holder, null); assert.equal(g.resumeAt, S.first);
  assert.deepEqual(init(5, roster(2)).rounds, 1);
});

test('Dub hands the seed out at `first` to a player picked from the public seed (deterministic), the same for a replica replaying the records', () => {
  setSecretRng(mulberry32(1));
  const a = init(77, roster(4)), pos = Object.fromEntries(roster(4).map((r, i) => [i, { x: c.x + i * 5, z: c.z + 8 }]));
  assert.deepEqual(step(a, { t: S.first - 0.1, pos: (s) => pos[s] }, 0.1, S.first - 0.1), [], 'not before first');
  const recs = tick(a, pos, S.first); assert.equal(recs.length, 1); assert.deepEqual(recs[0], { k: 'give', slot: pickHolder(77, 0, [0, 1, 2, 3]), t: S.first });
  assert.equal(a.holder, recs[0].slot); assert.equal(a.round, 1);
  const replica = init(77, roster(4)); apply(replica, recs[0]); assert.deepEqual(replica, a, 'a replica holds the same state from the records alone');
  const picks = new Set(); for (let s = 0; s < 60; s++) picks.add(pickHolder(s, 0, [0, 1, 2, 3])); assert.equal(picks.size, 4, 'every seat can be first');
  assert.equal(pickHolder(9, 1, [2, 3]) === pickHolder(9, 1, [2, 3]), true);
});

test('passing: a touch (closer than touchR) passes the seed to the NEAREST friend; far friends and the dead do nothing; the records carry who and when', () => {
  setSecretRng(() => 0.9);                                           // a late pop: this test is about passes
  const g = init(3, roster(4)), pos = { 0: near(0), 1: { x: c.x + 6, z: c.z }, 2: { x: c.x - 6, z: c.z }, 3: { x: c.x, z: c.z + 6 } };
  tick(g, pos, S.first); const h = g.holder;
  assert.deepEqual(tick(g, pos, S.first + 1), [], 'nobody is touching');
  const other = [0, 1, 2, 3].filter((s) => s !== h);
  pos[h] = { x: c.x, z: c.z }; pos[other[0]] = { x: c.x + S.touchR - 0.1, z: c.z }; pos[other[1]] = { x: c.x - S.touchR + 0.5, z: c.z };
  const r = tick(g, pos, S.first + 2);
  assert.deepEqual(r.map((x) => [x.k, x.from, x.to]), [['pass', h, other[1]]], 'the nearer friend gets it');
  assert.equal(g.holder, other[1]); assert.equal(g.from, h); assert.equal(g.passes, 1);
  // a friend who is just outside the reach is not touched
  const g2 = init(3, roster(2)); tick(g2, { 0: near(0), 1: near(1) }, S.first);
  const p2 = { [g2.holder]: { x: c.x, z: c.z }, [1 - g2.holder]: { x: c.x + S.touchR + 0.05, z: c.z } };
  assert.deepEqual(tick(g2, p2, S.first + 1), []);
  setSecretRng();
});

test('no pass back: the new holder cannot hand the seed straight back for `lock` s, nor until the two have parted; nobody passes again within `cool` s; a third friend is fine', () => {
  setSecretRng(() => 0.99);
  const g = init(3, roster(3)), pos = { 0: near(0), 1: near(1), 2: near(2) };
  for (const s of [0, 1, 2]) pos[s] = { x: c.x + s * 20, z: c.z };      // far apart
  tick(g, pos, S.first); const A = g.holder, B = (A + 1) % 3, C = (A + 2) % 3;
  pos[A] = { x: c.x, z: c.z }; pos[B] = { x: c.x + 1, z: c.z }; pos[C] = { x: c.x + 40, z: c.z };
  let t = S.first + 1; const r = tick(g, pos, t); assert.equal(r[0].k, 'pass'); assert.equal(g.holder, B);
  // B and A still stand together: no pass back during the lock, and not after it either until they part
  for (t += 0.1; t < S.first + 1 + S.lock + 1; t += 0.1) assert.deepEqual(tick(g, pos, t), [], `still together at +${(t - S.first - 1).toFixed(1)}`);
  pos[A] = { x: c.x + 1 + S.touchR + 1, z: c.z };                                    // A walks away...
  tick(g, pos, t += 0.1); assert.equal(g.holder, B);
  pos[A] = { x: c.x + 1.2, z: c.z };                                                 // ...and comes back: now it may be passed back
  const back = tick(g, pos, t += 0.1); assert.deepEqual(back.map((x) => [x.k, x.to]), [['pass', A]]);
  // the cool-down: right after a pass nobody passes again, even to a third friend
  const g3 = init(3, roster(3)); tick(g3, { 0: { x: c.x, z: c.z + 30 }, 1: { x: c.x, z: c.z + 30 }, 2: { x: c.x, z: c.z + 30 } }, S.first);
  const h = g3.holder, o1 = (h + 1) % 3, o2 = (h + 2) % 3, all = { [h]: { x: c.x, z: c.z }, [o1]: { x: c.x + 1, z: c.z }, [o2]: { x: c.x + 2, z: c.z } };
  const first = tick(g3, all, S.first + 1); assert.equal(first[0].to, o1);
  assert.deepEqual(tick(g3, all, S.first + 1 + S.cool - 0.05), [], 'inside the cool-down');
  assert.equal(tick(g3, all, S.first + 1 + S.cool + 0.05)[0].to, o2, 'a third friend can have it right after');
  setSecretRng();
});

test('the fuse is HIDDEN: drawn from the host\'s private rng inside `fuse`, kept off the state, the records and the view; two hosts with different secrets look identical up to the pop; a replica has no secret', () => {
  const run = (secret) => {
    setSecretRng(secret);
    const g = init(11, roster(3)), pos = { 0: { x: c.x, z: c.z + 30 }, 1: { x: c.x + 30, z: c.z }, 2: { x: c.x - 30, z: c.z } }, trace = [], views = [], snaps = [];
    let t = 0, popAt = null;
    while (!g.done && t < 80) {
      t += 1 / 30;
      const recs = step(g, { t, pos: (s) => pos[s] }, 1 / 30, t);
      for (const r of recs) { if (r.k === 'give') popAt = secretOf(g)?.popAt ?? popAt; if (r.k === 'give' || r.k === 'pop') popAt = secretOf(g).popAt ?? popAt; apply(g, r); trace.push(r); }
      if (g.holder !== null) { views.push(JSON.stringify(view(g, t))); snaps.push(JSON.stringify(g)); }
    }
    return { g, trace, views, snaps, secret: secretOf(g) };
  };
  const a = run(() => 0), b = run(() => 1);
  const pa = a.trace.find((r) => r.k === 'pop'), pb = b.trace.find((r) => r.k === 'pop');
  assert.ok(Math.abs(pa.t - (S.first + S.fuse[0])) < 0.1 && Math.abs(pb.t - (S.first + S.fuse[1])) < 0.1, `the fuse is drawn in [${S.fuse}]: ${pa.t}, ${pb.t}`);
  const n = Math.min(a.views.length, b.views.length, Math.floor((pa.t - S.first - 0.1) * 30));
  assert.ok(n > 250);
  for (let i = 0; i < n; i++) { assert.equal(a.views[i], b.views[i], 'views are identical before the earlier pop'); assert.equal(a.snaps[i], b.snaps[i], 'and so are the states a snapshot would carry'); }
  for (const s of [...a.snaps, ...a.views, JSON.stringify(a.trace.filter((r) => r.k !== 'pop' && r.k !== 'end'))]) assert.doesNotMatch(s, /popAt|fuse|secret/);
  assert.deepEqual(Object.keys(a.g).sort(), Object.keys(init(1, roster(3))).sort(), 'no key was added to the state');
  const replicaState = JSON.parse(JSON.stringify(a.g));
  assert.equal(secretOf(replicaState), null, 'a replica\'s copy of the state has no secret at all');
  // many seeds: the fuse is always inside the range and varies
  setSecretRng(); const seen = new Set();
  for (let i = 0; i < 40; i++) { const g = init(i, roster(2)), pos = { 0: { x: c.x, z: c.z + 30 }, 1: { x: c.x + 30, z: c.z } }; let t = 0, p = null; while (!g.done && t < 80) { t += 0.05; for (const r of step(g, { t, pos: (s) => pos[s] }, 0.05, t)) { apply(g, r); if (r.k === 'pop') p = r.t; } } assert.ok(p >= S.first + S.fuse[0] - 0.1 && p <= S.first + S.fuse[1] + 0.1); seen.add(Math.round(p)); }
  assert.ok(seen.size > 6, 'the pop time really varies');
});

test('the glow and the sparkle follow the seed\'s AGE only: the same curve in every fuse, full at heatFull (before the longest fuse), reset by the next seed', () => {
  setSecretRng(() => 0.5);
  const g = init(2, roster(4)), pos = Object.fromEntries(roster(4).map((r, i) => [i, { x: c.x + i * 30, z: c.z }]));
  tick(g, pos, S.first);
  assert.equal(heatAt(g, S.first), 0); assert.equal(heatAt(g, S.first + S.heatFull), 1); assert.ok(heatAt(g, S.first + S.heatFull / 2) > 0.4 && heatAt(g, S.first + S.heatFull / 2) < 0.6);
  let prev = -1; for (let t = S.first; t <= S.first + S.heatFull + 3; t += 0.25) { const h = heatAt(g, t); assert.ok(h >= prev); prev = h; }
  assert.ok(S.heatFull < S.fuse[1], 'the glow tops out before the longest fuse, so full glow says nothing about the pop');
  assert.equal(view(g, S.first + 5).heat, heatAt(g, S.first + 5));
  const idle = init(2, roster(4)); assert.equal(heatAt(idle, 9), 0, 'no seed, no glow');
  setSecretRng();
});

test('a pop: the holder is sooty (out), the others are safe; round 2 hands the seed to someone still in after the pause; the last pop ends the game; ranks: survivors tie for first, a later pop ranks above an earlier one', () => {
  setSecretRng(() => 0);
  const g = init(8, roster(4)), pos = Object.fromEntries(roster(4).map((r, i) => [i, { x: c.x + i * 30, z: c.z }])), recs = [];
  let t = 0;
  while (!g.done && t < 90) { t += 1 / 30; for (const r of tick(g, pos, t)) recs.push(r); }
  const kinds = recs.map((r) => r.k); assert.deepEqual(kinds, ['give', 'pop', 'give', 'pop', 'end']);
  const [g1, p1, g2, p2, end] = recs;
  assert.equal(p1.slot, g1.slot); assert.ok(p1.t - g1.t >= S.fuse[0] - 0.1);
  assert.ok(g2.t >= p1.t + S.pause - 0.1 && g2.t < p1.t + S.pause + 0.2, 'the next seed comes after the pause');
  assert.notEqual(g2.slot, p1.slot, 'the sooty one sits out'); assert.equal(p2.slot, g2.slot);
  assert.equal(end.why, 'done'); assert.equal(end.t, p2.t, 'the last pop ends the game at once');
  const ranks = placing(g);
  assert.deepEqual(ranks.filter((r) => r.place === 1).map((r) => r.slot).sort(), [0, 1, 2, 3].filter((s) => s !== p1.slot && s !== p2.slot));
  assert.equal(ranks.find((r) => r.slot === p2.slot).place, 3); assert.equal(ranks.find((r) => r.slot === p1.slot).place, 4);
  assert.ok(ranks.filter((r) => r.out).every((r) => g.alive[r.slot] === false));
  assert.ok(g.done && g.endAt === p2.t);
  // a 2-player party: one pop
  const g2p = init(8, roster(2)); const pp = { 0: { x: c.x, z: c.z + 20 }, 1: { x: c.x + 20, z: c.z } }; t = 0; const rr = []; while (!g2p.done && t < 90) { t += 1 / 30; rr.push(...tick(g2p, pp, t)); }
  assert.deepEqual(rr.map((r) => r.k), ['give', 'pop', 'end']);
  assert.deepEqual(placing(g2p).map((r) => r.place).sort(), [1, 2]);
  // the longest possible game fits inside the cap and the flow's game cap
  assert.ok(S.first + S.fuse[1] * 2 + S.pause < S.cap && S.first + S.fuse[1] * 2 + S.pause + GAME.tail < GAME.duration + 4);
  setSecretRng();
});

test('requests are ignored (no presses), debugWin pops everybody else, replay of the records equals the host state, JSON round trip', () => {
  assert.deepEqual(request(), { ignore: true });
  setSecretRng(mulberry32(5));
  const g = init(21, roster(4)), rec = [], pos = Object.fromEntries(roster(4).map((r, i) => [i, { x: c.x + (i % 2) * 0.5, z: c.z + i * 0.2 }]));
  let t = 0; while (!g.done && t < 90) { t += 1 / 30; rec.push(...tick(g, pos, t)); }
  const replica = init(21, roster(4)); for (const r of rec) apply(replica, r);
  assert.deepEqual(replica, g); assert.deepEqual(JSON.parse(JSON.stringify(g)), g);
  const d = init(21, roster(4)); apply(d, { k: 'give', slot: 1, t: 1 });
  const dr = debugWin(d, 2, 5); assert.deepEqual(dr.map((r) => r.slot), [0, 1, 3]);
  for (const r of dr) apply(d, r); assert.deepEqual(d.popped.sort(), [0, 1, 3]); assert.equal(placing(d).find((r) => r.slot === 2).place, 1);
  setSecretRng();
});

test('the holder runs faster (the boost is the synced holder\'s, not a screen decision)', () => {
  const g = init(1, roster(4)); apply(g, { k: 'give', slot: 2, t: 1 });
  assert.deepEqual([0, 1, 2, 3].map((s) => holderSpeed(g, s)), [1, 1, S.boost, 1]); assert.ok(S.boost > 1.05 && S.boost < 1.3);
});

// ---------------------------------------------------------------------------------------------------------------- what is seen is what is judged
test('the seed is drawn over exactly the holder (a local body or an avatar), moves to the new holder on a pass, sits in Dub\'s paws between pops, and popped players wear a soot cloud', () => {
  const scene = new THREE.Scene(), labelsLog = [], bursts = [];
  const w = createSizzleWorld({ scene, sfx: { play() {} }, particles: { burst: (k, at, o) => bursts.push([k, at, o]) }, labels: { label: (t) => labelsLog.push(t), clear() {} } });
  w.setVisible(true);
  const players = Object.fromEntries(roster(4).map((r, i) => [i, { position: new THREE.Vector3(c.x + (i - 1.5) * 3, PARTY.origin.y, c.z + 2) }]));
  const who = (s) => players[s] || null;
  const g = init(6, roster(4)); apply(g, { k: 'give', slot: 1, t: 1 });
  const seedMesh = () => w.root.children.find((o) => o.isMesh && o.material && o.material.isMeshBasicMaterial && !o.material.transparent && !o.material.vertexColors);
  const seedWorld = () => { const m = seedMesh(); return { x: m.position.x + w.root.position.x, y: m.position.y + w.root.position.y, z: m.position.z + w.root.position.z }; };
  const frame = (t) => w.update(1 / 60, { mode: 'play', v: view(g, t), t, who });
  frame(3); frame(3);
  let a = w.seedAnchor(view(g, 3), who);
  assert.deepEqual([a.x, a.z], [players[1].position.x, players[1].position.z]); assert.ok(Math.abs(a.y - (players[1].position.y + SEED_LIFT)) < 1e-9);
  const s1 = seedWorld(); assert.ok(Math.abs(s1.x - players[1].position.x) < 1e-6 && Math.abs(s1.z - players[1].position.z) < 1e-6 && Math.abs(s1.y - a.y) < 0.2, 'the drawn seed is over the holder\'s head');
  apply(g, { k: 'pass', from: 1, to: 3, t: 4 }); players[3].position.x += 1.7;
  frame(4.5); frame(4.5);
  const s3 = seedWorld(); assert.ok(Math.abs(s3.x - players[3].position.x) < 1e-6, 'after the pass the seed is over the new holder, wherever they ran');
  assert.equal(w.seedAnchor(view(g, 4.5), (s) => (s === 3 ? null : players[s])), null, 'a holder that is not on this screen has no seed drawn');
  apply(g, { k: 'pop', slot: 3, t: 20 }); frame(21); frame(21);
  const soot = w.root.children.filter((o) => o.isMesh && o.name !== 'sizzle-flames' && o.material && o.material.vertexColors && o.material.isMeshBasicMaterial && o.visible);
  assert.equal(soot.length, 1, 'one soot cloud, over the popped player'); assert.ok(Math.abs(soot[0].position.x + w.root.position.x - players[3].position.x) < 1e-6);
  assert.equal(seedMesh().visible, true, 'between pops the seed rests in Dub\'s paws'); const rest = seedWorld(); assert.ok(Math.abs(rest.x - (c.x + 0.7)) < 3.5 && rest.z < c.z - 8);
  assert.deepEqual(w.scoreText(view(g, 21), 3), { text: 'SOOTY', out: true }); assert.equal(w.scoreText(view(g, 21), 0).text, 'Safe');
  w.onRec({ k: 'pop', slot: 3, t: 20 }, view(g, 21), who); assert.ok(bursts.some((b) => b[0] === 'confetti') && labelsLog.some((l) => /Sooty/.test(l)));
  assert.ok(w.summary().meshes < 30, `draw calls ${w.summary().meshes}`);
  w.setVisible(false); assert.equal(seedMesh().visible, false);
});

test('the glow gets hotter and the sparkles quicker as the seed ages (the stage reads heat, nothing else)', () => {
  const scene = new THREE.Scene(); let n = 0;
  const w = createSizzleWorld({ scene, sfx: { play() {} }, particles: { burst: () => n++ }, labels: { label() {}, clear() {} } });
  w.setVisible(true);
  const players = { 0: { position: new THREE.Vector3(c.x, PARTY.origin.y, c.z + 3) } }, who = (s) => players[s];
  const g = init(2, roster(1)); apply(g, { k: 'give', slot: 0, t: 1 });
  const count = (t0, t1) => { n = 0; for (let t = t0; t < t1; t += 1 / 60) w.update(1 / 60, { mode: 'play', v: view(g, t), t, who }); return n; };
  const early = count(1.2, 4.2), late = count(1 + S.heatFull - 3, 1 + S.heatFull);
  assert.ok(late > early * 2, `sparkles ${early} -> ${late}`); assert.ok(w.heatNow() > 0.9);
});

// ---------------------------------------------------------------------------------------------------------------- the bots
test('bots: they read what a player sees, chase (the holder) and flee (the rest) without wedging, never touch a dead player, and a holder bot passes the seed within seconds', () => {
  const g = init(4, roster(4)); apply(g, { k: 'give', slot: 0, t: 1 });
  const me = { slot: 0, x: c.x, z: c.z + 6, mem: {}, others: [{ slot: 1, x: c.x + 5, z: c.z + 6 }, { slot: 2, x: c.x - 6, z: c.z + 6 }, { slot: 3, x: c.x, z: c.z - 6 }] };
  const out = bot(view(g, 2), me, PARTY.bots.hard, mulberry32(3)); assert.ok(out.x > 0.3 && Math.abs(out.y) < 0.9, 'runs toward the nearest friend (east)');
  const fleer = { slot: 1, x: c.x + 5, z: c.z + 6, mem: {}, others: [{ slot: 0, x: c.x + 3.5, z: c.z + 6 }] };
  const f = bot(view(g, 2), fleer, PARTY.bots.hard, mulberry32(3)); assert.ok(f.x > 0, 'runs away from the holder');
  g.alive[1] = false; const dead = bot(view(g, 2), { ...me, mem: {} }, PARTY.bots.hard, mulberry32(3)); assert.ok(dead.x < 0 || dead.y !== 0, 'dead players are not chased');
  assert.deepEqual(bot(view(g, 2), { ...fleer, slot: 1, mem: {} }, PARTY.bots.hard, mulberry32(1)), { x: 0, y: 0 }, 'a dead bot does nothing');
  const s = steer(c.x + S.benches.r - 1.3, c.z, 1, 0); assert.ok(s.x < 0.95, 'steers round a bench'); // (heading straight into a bench)
  const r = playSizzle(12, [PARTY.bots.normal, PARTY.bots.normal, PARTY.bots.normal, PARTY.bots.normal], 3);
  assert.ok(r.g.done && r.g.passes >= 6, `a four-bot game ends with passes (${r.g.passes})`);
  assert.ok(r.t > 20 && r.t < 62, `and takes ${r.t.toFixed(1)} s`);
});

test('win rates over seeded runs: a scripted average kid beats easy bots most of the time, holds its own against normal ones and loses to hard ones; no seat is favoured; games last about 40 s', () => {
  const B = PARTY.bots, n = 120;
  const easy = rate(playSizzle, KID, [B.easy, B.easy, B.easy], n), normal = rate(playSizzle, KID, [B.normal, B.normal, B.normal], n), hard = rate(playSizzle, KID, [B.hard, B.hard, B.hard], n);
  assert.ok(easy > 0.75, `kid vs easy ${easy}`); assert.ok(hard < 0.3, `kid vs hard ${hard}`); assert.ok(easy > normal && normal > hard, `${easy} > ${normal} > ${hard}`);
  // seats and lengths
  const wins = [0, 0, 0, 0]; let total = 0, games = 80;
  for (let i = 0; i < games; i++) { const r = playSizzle(900 + i * 31, [B.normal, B.normal, B.normal, B.normal], i + 1); total += r.t; for (const p of r.placing) if (p.place === 1) wins[p.slot]++; }
  const mean = wins.reduce((a, b) => a + b, 0) / 4; for (const w of wins) assert.ok(Math.abs(w - mean) < mean * 0.35, `seat wins ${wins}`);
  assert.ok(total / games > 30 && total / games < 55, `average length ${(total / games).toFixed(1)} s`);
});

// ---------------------------------------------------------------------------------------------------------------- host + replica
test('a host + replica pair play a whole Sizzle Seed with equal hashes; the replica never sees the pop time before the pop; the pass is the host\'s call', async () => {
  const pos = {};
  const w = pair({ positionOf: (slot) => pos[slot] || null });
  setSecretRng(mulberry32(404));
  const seen = [];                                                         // everything the replica is told (state and records), as JSON
  w.replica.on((kind, d) => seen.push({ kind, json: JSON.stringify(d), phase: w.replica.state.phase, popped: (w.replica.state.g && w.replica.state.g.popped.length) || 0 }));
  const slots = [0, 1, w.rSlot];
  w.host.open({ games: ['sizzle'], bots: 0 }); w.flush();
  w.host.debug.play('sizzle'); w.flush();
  for (let i = 0; i < 2; i++) { w.host.skip(); w.flush(); }
  assert.equal(w.host.state.phase, 'countdown'); w.run(PARTY.flow.countdown + 0.2);
  assert.equal(w.host.state.phase, 'play'); w.equal('at the start');
  const sp = stageSpawns('sizzle', 3); slots.forEach((s, i) => { pos[s] = { x: sp[i].x, z: sp[i].z }; });
  const mems = {}, rng = mulberry32(5), skill = PARTY.bots.normal;
  let popSecret = null, checked = 0;
  w.run(80, 1 / 30, () => {
    const g = w.host.state.g;
    if (!g) return true;
    const v = view(g, w.host.gameTime());
    for (const s of slots) {
      const others = slots.filter((o) => o !== s).map((o) => ({ slot: o, x: pos[o].x, z: pos[o].z }));
      const it = bot(v, { slot: s, x: pos[s].x, z: pos[s].z, mem: mems[s] ||= {}, others }, skill, rng);
      const mag = Math.hypot(it.x, it.y);
      if (mag > 0.01) { const sp2 = (mag <= 0.5 ? 3.5 * (mag / 0.5) : 3.5 + 3.5 * ((mag - 0.5) / 0.5)) * holderSpeed(g, s) / 30; pos[s] = { x: pos[s].x + (it.x / mag) * sp2, z: pos[s].z - (it.y / mag) * sp2 }; }
    }
    if (g.holder !== null && popSecret === null) popSecret = secretOf(g)?.popAt ?? null;
    if (g.holder !== null && g.popped.length === 0 && ++checked % 20 === 0) w.equal(`mid game ${checked}`);
    return !(w.host.state.phase === 'results');
  });
  w.flush(); assert.equal(w.host.state.phase, 'results'); w.equal('at the results');
  assert.ok(w.host.state.g.done && w.host.state.g.popped.length === 2);
  assert.ok(w.host.state.g.passes >= 1, 'the bots passed the seed on the host');
  assert.equal(w.replica.state.g.passes, w.host.state.g.passes); assert.deepEqual(w.replica.state.g.popped, w.host.state.g.popped);
  assert.deepEqual(w.host.state.results.ranks, w.replica.state.results.ranks);
  // nothing the replica read before the FIRST pop mentions the fuse
  assert.ok(popSecret > S.first + S.fuse[0] - 0.01);
  const early = seen.filter((e) => e.phase === 'play' && e.popped === 0 && !e.json.includes('"k":"pop"'));
  assert.ok(early.length > 5);
  for (const e of early) { assert.doesNotMatch(e.json, /popAt|fuse|secret/); assert.equal(e.json.includes(String(popSecret)), false, 'the secret number is nowhere in what the replica was sent'); }
  assert.equal(secretOf(w.replica.state.g), null);
  // a late joiner's snapshot mid-game carries no secret either
  const snap = JSON.stringify(w.host.state); assert.doesNotMatch(snap, /popAt|secret/);
  setSecretRng();
});

test('an idle bot strolls (playtest 2026-10-26): far from the seed it walks to fresh spots at a stroll, pauses, keeps away from the holder, stays in the clearing and out of the fire', () => {
  const g = init(3, roster(2)), m = {}, rng = mulberry32(6); let x = c.x + 3, z = c.z, moved = 0, still = 0, goalsAway = 0, goals = 0, last = null;
  const holder = { slot: 1, x: c.x - 7.4, z: c.z };
  for (let k = 0; k < 60 * 20; k++) {
    const v = view(g, 3 + k / 60); v.holder = 1; v.alive = { 0: true, 1: true }; v.done = false;
    const o = bot(v, { slot: 0, x, z, mem: m, others: [holder] }, PARTY.bots.easy, rng), sp = Math.hypot(o.x, o.y);
    if (Math.hypot(x - holder.x, z - holder.z) > 7.5) assert.ok(sp <= S.wander.pace + 1e-9, 'a stroll, not a run');
    if (sp < 1e-9) still++;
    const nx = x + o.x * 3.5 / 60, nz = z - o.y * 3.5 / 60; moved += Math.hypot(nx - x, nz - z); x = nx; z = nz;
    const r = Math.hypot(x - c.x, z - c.z); assert.ok(r < S.arenaR && r > S.fireR, 'in the clearing, out of the fire');
    if (m.wander && m.wander !== last) { last = m.wander; goals++; if (m.wander.x > c.x - 2) goalsAway++; }
  }
  assert.ok(moved > 6, `it walks about (${moved.toFixed(1)} u in 20 s)`); assert.ok(still > 20, 'and pauses now and then');
  assert.ok(goals >= 3 && goalsAway / goals > 0.6, `its spots lean away from the holder (${goalsAway} / ${goals})`);
});
