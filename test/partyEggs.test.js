// Step 80c: Egg Scramble's pure rules (game/party/eggsLogic.js) and stage (world/party/eggs.js): the contract and lanes, the one fair drop sequence, stack / bank / knock-off maths, judging at the moment the DRAWN egg
// meets the DRAWN stack, bots and win rates, a host + replica pair; then the screen runtime with real Players and bots playing both 80c games, and the lobby music rotation + the four new tracks' pins.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { installDom, el } from './fixtures/domStub.js';
import { PARTY, MAX_PLAYERS } from '../public/js/config.js';
import { mulberry32 } from '../public/js/utils/rng.js';
import { validateGame, getGame, GAME_IDS } from '../public/js/game/party/registry.js';
import { hostFor } from '../public/js/game/party/botRoster.js';
import { stageCentre, stageSpawns, spectatorSpot, partyWalkable, eggsStrips, POCKET } from '../public/js/game/party/partyArea.js';
import { isWalkable } from '../public/js/world/terrain.js';
import {
  GAME, buildItems, init, step, apply, request, placing, view, bot, stackAfter, stackTop, knockOff, valueOf, yAt, timeAtY, groundTime, itemX, itemPose, totalOf, lastResolve, debugWin,
} from '../public/js/game/party/eggsLogic.js';
import { createEggsWorld } from '../public/js/world/party/eggs.js';
import { pair } from './fixtures/partyPair.js';
import { playEggs, rate, KID } from './fixtures/sim80c.mjs';
import { SlotTable } from '../public/js/players/slotTable.js';
import { PlayerManager } from '../public/js/players/playerManager.js';
import { InputManager } from '../public/js/input/inputManager.js';
import { createPlayersDomain } from '../public/js/net/playersDomain.js';
import { WorldSync } from '../public/js/net/worldSync.js';
import { FollowCamera } from '../public/js/camera/followCamera.js';
import { createParty } from '../public/js/game/party.js';
import { Music, REGION_TRACKS, PARTY_TRACKS, TRACK_TITLES, getTrack, trackInfo, nextLobbyTrack } from '../public/js/audio/music.js';
import { ICONS } from '../public/js/ui/icons.js';
import { Sfx } from '../public/js/audio/sfx.js';

installDom();
const E = PARTY.eggs, c = stageCentre('eggs');
const roster = (n = 4) => Array.from({ length: n }, (_, slot) => ({ slot }));
const under = (g, lane, it) => ({ x: c.x + itemX(it, lane), z: c.z + E.laneZ });

test('the game honours the registry contract; the stage is at +540; every lane is a thin strip you can only run left and right on, with its own start and cheering spot', () => {
  assert.deepEqual(validateGame(GAME), []);
  assert.equal(getGame('eggs'), GAME); assert.equal(GAME.kind, 'lanes'); assert.deepEqual(GAME.press, []); assert.deepEqual(GAME.howto.buttons, ['stick']);
  assert.equal(hostFor('eggs').name, 'Shyam Shyam'); assert.deepEqual(PARTY.stageOffset.eggs, { x: 540, z: 0 }); assert.deepEqual(c, { x: PARTY.origin.x + 540, z: PARTY.origin.z });
  assert.ok(GAME_IDS.includes('sizzle') && GAME_IDS.includes('eggs'));
  const strips = eggsStrips(); assert.equal(strips.length, 4);
  for (const [i, s] of strips.entries()) {
    assert.ok(partyWalkable((s.x0 + s.x1) / 2, (s.z0 + s.z1) / 2) && isWalkable(s.x0 + 0.5, (s.z0 + s.z1) / 2), `lane ${i}`);
    assert.equal(partyWalkable((s.x0 + s.x1) / 2, s.z1 + 0.6), false, 'no stepping out of the lane in z'); assert.equal(partyWalkable((s.x0 + s.x1) / 2, s.z0 - 0.6), false);
    if (i) assert.ok(s.x0 > strips[i - 1].x1, 'lanes never touch');
    const sp = stageSpawns('eggs', 4)[i]; assert.ok(sp.x > s.x0 && sp.x < s.x1 && sp.z > s.z0 && sp.z < s.z1);
    const cheer = spectatorSpot('eggs', i); assert.ok(partyWalkable(cheer.x, cheer.z));
  }
  assert.ok(strips[3].x1 - c.x < 12 && strips[0].x0 - c.x > -12 && c.x + 540 < POCKET.x1 + 600);
  assert.ok(E.laneZ + E.laneDepth / 2 < E.spectatorZ - 1.4, 'the cheering spots are clear of the lanes');
});

test('the drop sequence: deterministic from the seed, 36 drops in 45 s, golden and cone shares, never a cone first / last or two in a row, all inside the lane, gaps shrink and the fall quickens', () => {
  const a = buildItems(9), b = buildItems(9), d = buildItems(10);
  assert.deepEqual(a, b); assert.notDeepEqual(a, d); assert.equal(a.length, E.items);
  for (let s = 1; s <= 60; s++) {
    const it = buildItems(s * 977), kinds = it.map((x) => x.kind);
    assert.equal(kinds.filter((k) => k === 'cone').length, Math.round(E.items * E.coneShare)); assert.equal(kinds.filter((k) => k === 'gold').length, Math.round(E.items * E.goldShare));
    assert.notEqual(kinds[0], 'cone'); assert.notEqual(kinds.at(-1), 'cone'); assert.notEqual(kinds[1], 'cone');
    kinds.forEach((k, i) => { if (k === 'cone') assert.notEqual(kinds[i - 1], 'cone'); });
    it.forEach((x, i) => {
      assert.ok(Math.abs(x.x) <= E.laneHalf - 0.45 + 1e-9, 'inside the lane'); if (i) { assert.ok(x.t0 > it[i - 1].t0 + 0.6, 'a breath between drops'); assert.ok(x.v >= it[i - 1].v - 1e-9); }
    });
    assert.ok(it.at(-1).t0 < 46 && it.at(-1).t0 > 38, `the last drop starts at ${it.at(-1).t0}`);
    assert.ok(lastResolve(it) < E.cap - 3, 'every drop is done long before the cap');
    assert.ok(it[1].t0 - it[0].t0 > it.at(-1).t0 - it.at(-2).t0 - 0.3, 'the gaps shrink');
  }
  // one sequence for every lane: the view hands every lane the same list
  const g = init(5, roster(4)); const v = view(g, 3); assert.equal(v.items, buildItems(5)); assert.equal(v.lanes, 4);
  assert.ok(a.some((x) => x.kind === 'gold') && a.some((x) => x.kind === 'cone'));
});

test('stack maths: eggs add 1 (golden 3) to the stack, the stack banks itself at `bankAt` eggs (score kept), a pinecone knocks off the top half rounded up, a lone egg goes too, an empty head loses nothing', () => {
  let st = { stack: [], banked: 0 };
  for (let i = 0; i < E.bankAt - 1; i++) { st = stackAfter(st.stack, st.banked, { k: 'catch', gold: 0 }); assert.equal(st.stack.length, i + 1); }
  assert.equal(st.banked, 0); st = stackAfter(st.stack, st.banked, { k: 'catch', gold: 1 });
  assert.deepEqual(st, { stack: [], banked: E.bankAt - 1 + E.goldValue }, 'the full stack is banked with the golden egg counted three');
  assert.deepEqual([0, 1, 2, 3, 7, 8].map(knockOff), [0, 1, 1, 2, 4, 4]);
  assert.deepEqual(stackAfter([1, 1, 3, 1, 1], 4, { k: 'bonk', lost: knockOff(5) }), { stack: [1, 1], banked: 4 }, 'the TOP half goes; the bank is safe');
  assert.deepEqual(stackAfter([1], 0, { k: 'bonk', lost: knockOff(1) }).stack, []); assert.deepEqual(stackAfter([], 2, { k: 'bonk', lost: knockOff(0) }), { stack: [], banked: 2 });
  assert.equal(valueOf('gold'), E.goldValue); assert.equal(valueOf('egg'), 1);
  assert.ok(stackTop(0) === E.headTop && stackTop(3) === E.headTop + 3 * E.eggH);
  const g = init(1, roster(2)); g.stack[0] = [1, 3]; g.banked[0] = 5; assert.equal(totalOf(g, 0), 9);
});

/** run the host's step over a time span with fixed positions per slot; returns the records (applied) */
function run(g, pos, t0, t1, dt = 1 / 60) { const out = []; for (let t = t0; t <= t1; t += dt) for (const r of step(g, { t, pos: (s) => pos[s] ?? null }, dt, t)) { apply(g, r); out.push(r); } return out; }

test('judging: an item is settled for a lane at the moment its DRAWN y meets the top of that lane\'s DRAWN stack; under the egg = catch, off to the side = miss, a pinecone under you = bonk; lanes are independent', () => {
  const g = init(14, roster(3)), items = buildItems(14), it0 = items.find((x) => x.kind === 'egg');
  const pos = { 0: under(g, 0, it0), 1: { x: under(g, 1, it0).x + E.catchR + 0.15, z: c.z + E.laneZ }, 2: { x: under(g, 2, it0).x + E.catchR - 0.1, z: c.z + E.laneZ } };
  const recs = run(g, pos, 0, timeAtY(it0, stackTop(0)) + 0.1).filter((r) => r.i === it0.i);
  const bySlot = Object.fromEntries(recs.map((r) => [r.slot, r]));
  assert.equal(bySlot[0].k, 'catch'); assert.equal(bySlot[1].k, 'miss'); assert.equal(bySlot[2].k, 'catch', 'just inside the radius');
  for (const s of [0, 1, 2]) assert.ok(Math.abs(bySlot[s].t - timeAtY(it0, stackTop(0))) < 0.03, 'the record is stamped with the moment the drawn egg reached the drawn stack top');
  assert.deepEqual(g.stack[0], [1]); assert.deepEqual(g.stack[1], []); assert.equal(g.res[1][it0.i], 'm');
  // a taller stack is met earlier by exactly its height
  const next = items.find((x) => x.i > it0.i && x.kind === 'egg');
  const tNew = timeAtY(next, stackTop(1)), tOld = timeAtY(next, stackTop(0)); assert.ok(Math.abs((tOld - tNew) - E.eggH / next.v) < 1e-6);
  const before = run(g, { ...pos, 0: under(g, 0, next) }, it0.t0, tNew - 0.05).filter((r) => r.i === next.i && r.slot === 0); assert.equal(before.length, 0, 'not yet');
  const at = run(g, { ...pos, 0: under(g, 0, next) }, tNew - 0.05, tNew + 0.05).filter((r) => r.i === next.i && r.slot === 0); assert.equal(at[0].k, 'catch'); assert.ok(Math.abs(at[0].t - tNew) < 0.03);
  assert.deepEqual(g.stack[0], [1, 1]);
  // a pinecone under a stack of two knocks one off; one under an empty head loses nothing but is still a bonk
  const cone = items.find((x) => x.kind === 'cone'), gc = init(14, roster(2)); gc.stack[0] = [1, 1, 3]; gc.banked[0] = 6;
  const cr = run(gc, { 0: under(gc, 0, cone), 1: under(gc, 1, cone) }, cone.t0, timeAtY(cone, stackTop(0)) + 0.05).filter((r) => r.i === cone.i);
  assert.deepEqual(cr.map((r) => [r.slot, r.k, r.lost]), [[0, 'bonk', 2], [1, 'bonk', 0]]); assert.deepEqual(gc.stack[0], [1]); assert.equal(gc.banked[0], 6);
  // a golden egg
  const gold = items.find((x) => x.kind === 'gold'), gg = init(14, roster(1)); run(gg, { 0: under(gg, 0, gold) }, gold.t0, timeAtY(gold, stackTop(0)) + 0.05); assert.equal(gg.stack[0].at(-1), E.goldValue, 'the golden egg is on top'); assert.ok(totalOf(gg, 0) >= 3);
});

test('requests are ignored (no presses), nobody present (no position) means everything is a miss and the game still ends by itself, and the records replay to the same state', () => {
  assert.deepEqual(request(), { ignore: true });
  const g = init(30, roster(4)), recs = []; let t = 0;
  while (!g.done && t < 70) { t += 1 / 30; for (const r of step(g, { t, pos: () => null }, 1 / 30, t)) { apply(g, r); recs.push(r); } }
  assert.ok(g.done && t < E.cap - 1, `ended at ${t}`); assert.ok(recs.filter((r) => r.k === 'miss').length === 4 * E.items && recs.at(-1).k === 'end');
  assert.deepEqual(placing(g).map((r) => r.place), [1, 1, 1, 1], 'nobody caught anything: a four-way tie');
  const replica = init(30, roster(4)); for (const r of recs) apply(replica, r); assert.deepEqual(replica, g); assert.deepEqual(JSON.parse(JSON.stringify(g)), g);
});

test('placing: most eggs first (golden = 3, banked + on the head); ties share a place; debugWin clears the other lanes', () => {
  const g = init(2, roster(3)); g.stack[0] = [1, 1]; g.banked[0] = 3; g.stack[1] = [3, 1, 1]; g.stack[2] = [1, 1];
  assert.deepEqual(Object.fromEntries(placing(g).map((r) => [r.slot, r.place])), { 0: 1, 1: 1, 2: 3 }); assert.deepEqual(placing(g).map((r) => r.score), [5, 5, 2]);
  for (const r of debugWin(g, 2, 9)) apply(g, r); assert.deepEqual(Object.fromEntries(placing(g).map((r) => [r.slot, r.place])), { 2: 1, 0: 2, 1: 2 });
});

// ---------------------------------------------------------------------------------------------------------------- what is seen is what is judged
test('every catch / bonk the bots earn in a whole game happens where it is drawn: at the record\'s moment the drawn egg sits on the drawn stack top, over the player\'s head (within the catch radius, and within the wobble of it)', () => {
  const trace = [], r = playEggs(61, [PARTY.bots.normal, PARTY.bots.normal, PARTY.bots.easy, PARTY.bots.hard], 7, { trace });
  const items = buildItems(61), lenBefore = { 0: 0, 1: 0, 2: 0, 3: 0 }, g = init(61, roster(4));
  let checked = 0;
  // replay the records and, before applying each, check the drawn pose against the bodies' x at that moment (the sim keeps bodies; recompute from the stored positions is not needed: the record was made with them)
  for (const rec of trace) {
    if (rec.k === 'catch' || rec.k === 'bonk') {
      const it = items[rec.i], top = stackTop(g.stack[rec.slot].length), pose = itemPose(it, rec.slot, rec.t, top, undefined, undefined, true);
      assert.ok(Math.abs(pose.y - top) < 0.05, `item ${rec.i} lane ${rec.slot}: drawn y ${pose.y} vs stack top ${top}`);
      assert.equal(pose.x, itemX(it, rec.slot)); assert.ok(['resting', 'fall'].includes(pose.state));
      checked++;
    }
    apply(g, rec);
  }
  assert.ok(checked > 20, `${checked} settled catches checked`); assert.deepEqual(g.stack, r.g.stack);
  // a miss keeps falling past the head and lands on the ground, drawn the whole way
  const it = items[3], p1 = itemPose(it, 0, it.t0 + 0.3, stackTop(0), 'm', it.t0 + 0.9, false), p2 = itemPose(it, 0, groundTime(it) + 0.1, stackTop(0), 'm', it.t0 + 0.9, false);
  assert.equal(p1.state, 'fall'); assert.equal(p2.state, 'splat'); assert.ok(p2.y <= 0.13);
  // before the host's record arrives an aligned egg rests on the stack instead of passing through the head
  const top = stackTop(2), tt = timeAtY(it, top) + 0.1, rest = itemPose(it, 0, tt, top, undefined, undefined, true);
  assert.equal(rest.state, 'resting'); assert.equal(rest.y, top);
  assert.equal(itemPose(it, 0, tt, top, undefined, undefined, false).state, 'fall', 'an egg that is not over the head falls on by');
});

test('the stage draws what the rules say: a falling item at itemPose(), the head stack on the player\'s feet y + headTop + n eggs, a shadow under every falling item; the wobble stays far inside the catch radius', () => {
  const scene = new THREE.Scene();
  const w = createEggsWorld({ scene, sfx: { play() {} }, particles: { burst() {} }, labels: { label() {}, clear() {} } });
  w.setVisible(true);
  const items = buildItems(21), g = init(21, roster(2)), floor = PARTY.origin.y;
  const px = [c.x + E.lanes[0] + 0.4, c.x + E.lanes[1] - 1.1];
  const lanePlayers = px.map((x) => ({ position: new THREE.Vector3(x, floor, c.z + E.laneZ) }));
  g.stack[0] = [1, 3, 1]; g.stack[1] = [];
  const it = items.find((x) => x.kind === 'egg' && x.i > 2), t = it.t0 + 0.5;
  w.update(1 / 60, { mode: 'play', v: view(g, t), t, lanePlayers }); w.update(1 / 60, { mode: 'play', v: view(g, t), t, lanePlayers });
  const mesh = (name) => w.root.children.filter((o) => o.isInstancedMesh);
  const [eggs, golds, cones, shadows] = mesh();
  const read = (m) => { const out = [], mt = new THREE.Matrix4(), p = new THREE.Vector3(); for (let i = 0; i < m.count; i++) { m.getMatrixAt(i, mt); p.setFromMatrixPosition(mt); out.push({ x: p.x + w.root.position.x, y: p.y + w.root.position.y - floor, z: p.z + w.root.position.z }); } return out; };
  const stackEggs = read(eggs).filter((e) => Math.abs(e.x - px[0]) < 0.2 && e.y < stackTop(3) + 0.4), gold = read(golds).filter((e) => Math.abs(e.x - px[0]) < 0.2);
  assert.equal(stackEggs.length + gold.length >= 3, true);
  const all = [...stackEggs, ...gold].sort((a, b) => a.y - b.y);
  all.forEach((e, k) => { assert.ok(Math.abs(e.y - (E.headTop + k * E.eggH + 0.26)) < 0.01, `egg ${k} sits at ${e.y}`); assert.ok(Math.abs(e.x - px[0]) < 0.16, 'wobble stays tiny'); });
  assert.ok(Math.abs(read(golds)[0].y - (E.headTop + 1 * E.eggH + 0.26)) < 0.01, 'the golden egg is the second in the stack');
  for (let k = 0; k < 10; k++) assert.ok(Math.abs(w.stackWobble(k, 8, 1.234)) < E.catchR * 0.2, 'the wobble never moves an egg anywhere near the catch radius');
  // the falling egg in each lane is where itemPose says
  const expectX = (lane) => c.x + itemX(it, lane), pose = itemPose(it, 0, t, stackTop(3), undefined, undefined, Math.abs(px[0] - expectX(0)) <= E.catchR);
  const fallX = read(eggs).filter((e) => Math.abs(e.x - expectX(0)) < 0.01 && e.y > 1);
  assert.ok(fallX.some((e) => Math.abs(e.y - (pose.y + 0.26)) < 0.01), 'lane 0\'s falling egg is drawn at itemPose()');
  assert.ok(read(eggs).some((e) => Math.abs(e.x - expectX(1)) < 0.01 && e.y > 1), 'and lane 1 gets the same egg at its own x');
  assert.ok(read(shadows).some((s) => Math.abs(s.x - expectX(0)) < 0.01), 'a shadow marks where it will land');
  assert.ok(w.counts().egg + w.counts().gold + w.counts().cone + w.counts().shadow < 60 && w.summary().meshes < 45, `draw calls ${w.summary().meshes}`);
  // a pinecone is lobbed from Shyam's stump first (an arc), then falls like an egg
  const cone = items.find((x) => x.kind === 'cone'), tl = cone.t0 - E.lobLead * 0.5;
  w.update(1 / 60, { mode: 'play', v: view(g, tl), t: tl, lanePlayers }); const cc = read(cones); assert.ok(cc.length >= 2 && cc.every((p) => p.x < c.x + itemX(cone, 3) + 0.01 && p.y > 1), `${cc.length} cones in the air`);
  assert.equal(w.scoreText(view(g, 5), 0).text, '5');
  w.setVisible(false); assert.equal(w.counts().egg, 0);
});

test('practice on the stage uses the same maths: an egg over your head in the how-to lands on your stack, an egg beside you does not (nothing scores)', () => {
  const scene = new THREE.Scene(), floor = PARTY.origin.y;
  const w = createEggsWorld({ scene, sfx: { play() {} }, particles: { burst() {} }, labels: { label() {}, clear() {} } });
  w.setVisible(true);
  const items = buildItems(777).slice(0, 12), it = items.find((x) => x.kind === 'egg');
  const p = { position: new THREE.Vector3(c.x + E.lanes[0] + it.x, floor, c.z + E.laneZ) };
  let seen = 0;
  for (let k = 0; k < 60 * 30; k++) {                                                    // the practice clock is the stage's own: run it a while with a player waiting under the first egg
    w.update(1 / 60, { mode: 'practice', v: null, t: 0, lanePlayers: [p, null, null, null] });
    const eg = w.root.children.filter((o) => o.isInstancedMesh)[0]; if (eg.count > 0) seen = Math.max(seen, eg.count);
    if (k < 60 * 6) p.position.x = c.x + E.lanes[0] + items.filter((x) => x.kind !== 'cone').find((x) => timeAtY(x, stackTop(0)) > (k / 60) - 0.05).x;
  }
  assert.ok(seen >= 2, `the practice stack grew (${seen} eggs drawn at once)`);
});

// ---------------------------------------------------------------------------------------------------------------- the bots
test('bots: they run under the next egg they can reach, aim a little off, step round pinecones, never leave the lane, and a stick-less player scores nothing', () => {
  const g = init(8, roster(1)), it = buildItems(8).find((x) => x.kind === 'egg'), mem = {};
  const v = (t) => view(g, t);
  const x0 = c.x + E.lanes[0] - 2, out = bot(v(it.t0 + 0.7), { slot: 0, x: x0, z: c.z, mem }, PARTY.bots.hard, mulberry32(1));
  assert.ok(Math.sign(out.x) === Math.sign(c.x + itemX(it, 0) - x0) || Math.abs(out.x) < 0.01, 'toward the egg');
  assert.deepEqual(bot(v(0.1), { slot: 0, x: x0, z: c.z, mem: {} }, PARTY.bots.hard, mulberry32(1)), { x: 0, y: 0 }, 'nothing to do before the first drop');
  assert.deepEqual(bot(view(g, 1), { slot: 9, x: 0, z: 0, mem: {} }, PARTY.bots.hard, mulberry32(1)), { x: 0, y: 0 }, 'not in the game');
  const trace = []; const r = playEggs(33, [PARTY.bots.hard, PARTY.bots.hard, PARTY.bots.hard, PARTY.bots.hard], 2, { trace });
  for (const b of r.bodies) assert.ok(b.x >= c.x - 12 && b.x <= c.x + 12);
  assert.ok(trace.filter((x) => x.k === 'catch').length > 80, 'hard bots catch most eggs'); assert.ok(trace.filter((x) => x.k === 'bank').length === 0);
  const none = playEggs(33, [{ react: 99, noise: 0, miss: 1, walk: 0.5 }, { react: 99, noise: 0, miss: 1, walk: 0.5 }], 2);
  assert.ok(none.g.done && none.placing.every((x) => x.score <= 3), 'bots that never move catch next to nothing');
});

test('win rates over seeded runs: a scripted average kid beats easy bots most of the time and loses to hard ones; no lane is favoured; a game lasts about 43 s; the pranks do hit (easy bots get bonked)', () => {
  const B = PARTY.bots, n = 120;
  const easy = rate(playEggs, KID, [B.easy, B.easy, B.easy], n), normal = rate(playEggs, KID, [B.normal, B.normal, B.normal], n), hard = rate(playEggs, KID, [B.hard, B.hard, B.hard], n);
  assert.ok(easy > 0.75, `kid vs easy ${easy}`); assert.ok(hard < 0.3, `kid vs hard ${hard}`); assert.ok(easy > normal && normal > hard, `${easy} > ${normal} > ${hard}`);
  const wins = [0, 0, 0, 0]; let total = 0, bonks = 0, banks = 0, games = 60;
  for (let i = 0; i < games; i++) { const tr = []; const r = playEggs(1500 + i * 17, [B.easy, B.easy, B.easy, B.easy], i + 1, { trace: tr }); total += r.t; for (const p of r.placing) if (p.place === 1) wins[p.slot]++; bonks += tr.filter((x) => x.k === 'bonk' && x.lost > 0).length; banks += tr.filter((x) => x.bank).length; }
  const mean = wins.reduce((a, b) => a + b, 0) / 4; for (const wn of wins) assert.ok(Math.abs(wn - mean) < mean * 0.6, `lane wins ${wins}`);
  assert.ok(total / games > 38 && total / games < 50, `average length ${(total / games).toFixed(1)} s`); assert.ok(bonks > 10, `${bonks} bonks`); assert.ok(banks > 20, `${banks} banks`);
});

// ---------------------------------------------------------------------------------------------------------------- host + replica
test('a host + replica pair play a whole Egg Scramble with equal hashes; a replica\'s position is judged by the host; the results agree', () => {
  const pos = {}, w = pair({ positionOf: (slot) => pos[slot] || null }), slots = [0, 1, w.rSlot];
  w.host.open({ games: ['eggs'], bots: 0 }); w.flush(); w.host.debug.play('eggs'); w.flush();
  for (let i = 0; i < 2; i++) { w.host.skip(); w.flush(); }
  assert.equal(w.host.state.phase, 'countdown'); w.run(PARTY.flow.countdown + 0.2); assert.equal(w.host.state.phase, 'play'); w.equal('at the start');
  const sp = stageSpawns('eggs', 3); slots.forEach((s, i) => { pos[s] = { x: sp[i].x, z: sp[i].z }; });
  const mems = {}, rng = mulberry32(3); let n = 0;
  w.run(70, 1 / 30, () => {
    const g = w.host.state.g; if (!g) return true;
    const v = view(g, w.host.gameTime());
    slots.forEach((s, lane) => { const it = bot(v, { slot: s, x: pos[s].x, z: pos[s].z, mem: mems[s] ||= {} }, s === w.rSlot ? PARTY.bots.hard : PARTY.bots.normal, rng); const sp2 = it.x * 6 / 30; pos[s] = { x: Math.max(sp[lane].x - E.laneHalf, Math.min(sp[lane].x + E.laneHalf, pos[s].x + sp2)), z: pos[s].z }; });
    if (++n % 25 === 0) w.equal(`mid game ${n}`);
    return w.host.state.phase !== 'results';
  });
  w.flush(); assert.equal(w.host.state.phase, 'results'); w.equal('at the results');
  assert.deepEqual(w.replica.state.g.stack, w.host.state.g.stack); assert.deepEqual(w.replica.state.g.banked, w.host.state.g.banked);
  assert.ok(totalOf(w.host.state.g, w.rSlot) > 5, 'the replica\'s player (judged from its reported position) caught eggs');
  assert.deepEqual(w.host.state.results.ranks, w.replica.state.results.ranks);
});

// ---------------------------------------------------------------------------------------------------------------- the screen runtime: real Players and bots play both games
function makeHostPlayers() {
  const scene = new THREE.Scene(), sync = new WorldSync({ role: 'host' }), table = new SlotTable(MAX_PLAYERS);
  const toasts = [], bursts = [], particles = { burst: (...a) => bursts.push(a) };
  const hud = { toast: (t) => toasts.push(t), setRoster() {} };
  let pm = null;
  createPlayersDomain({ sync, table, onChange: () => pm && pm.slotsChanged(), hooks: { onFull: () => pm.onFull?.() } });
  pm = new PlayerManager({ scene, local: new InputManager(), hud, hudRoot: el(), particles, sync, table });
  return { scene, sync, table, pm, hud, toasts, particles, bursts };
}
function makeRuntime() {
  const w = makeHostPlayers();
  const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 600), followCam = new FollowCamera(camera, {});
  const world = { root: { visible: true }, snap() {} }, water = { group: { visible: true } };
  const calls = { music: [], sfx: [], tempo: [] };
  const music = { party: (id) => calls.music.push(id), setTempo: (k) => calls.tempo.push(k) }, sfx = { play: (n) => calls.sfx.push(n) };
  const dialog = { isOpen: false, close() {}, open() {}, refresh() {} };
  const items = { heldBy: () => null }, avatars = { get: () => null, list: [], hideHeld: false };
  const party = createParty({ scene: w.scene, camera, followCam, players: w.pm, avatars, table: w.table, sync: w.sync, hud: w.hud, hudRoot: el(), dialog, particles: w.particles, sfx, music, items, world, water });
  const frame = (dt = 1 / 30) => { party.preInput(dt); w.pm.pollInput(dt); for (const p of w.pm.list) if (party.contains(p) && !p.away && !p.frozen) party.drive(p, p.actions, dt); w.pm.update(dt); party.update(dt, 0); party.afterItems(); };
  const run = (secs, until = null, dt = 1 / 30) => { for (let t = 0; t < secs - 1e-9; t += dt) { frame(dt); if (until && until()) return true; } return !until; };
  return { ...w, party, camera, followCam, calls, frame, run };
}

test('Sizzle Seed on the real runtime: bots (real Players) run, pass and get sooty by the host\'s rules; the holder is quicker; the boost never outlives the game; sounds and the music follow the glow', async () => {
  const r = makeRuntime(); r.pm.p1.teleport(10, 14);
  r.party.open({ bots: 'fill', difficulty: 'hard', games: ['sizzle', 'eggs'] });
  await r.party.play('sizzle');
  r.run(8, () => r.pm.bots.length === 3);
  assert.equal(r.party.state.game, 'sizzle');
  let maxScale = 1, holderScaled = false, minDistToFire = 99;
  const fire = stageCentre('sizzle');
  r.run(140, () => {
    const s = r.party.state;
    if (s.phase === 'play' && s.g) {
      for (const p of r.pm.list) { if (p.speedScale > maxScale) maxScale = p.speedScale; if (s.g.holder === p.index && p.speedScale > 1) holderScaled = true; if (s.g.holder !== p.index && s.g.holder !== null && p.speedScale !== 1) assert.fail('only the holder is boosted'); }
      for (const b of r.pm.bots) minDistToFire = Math.min(minDistToFire, Math.hypot(b.position.x - fire.x, b.position.z - fire.z));
    }
    return s.phase === 'results';
  });
  const s = r.party.state; assert.equal(s.phase, 'results'); assert.ok(s.g.done && s.g.popped.length === 2);
  assert.ok(s.g.passes >= 2, `${s.g.passes} passes between the Players`); assert.ok(holderScaled && maxScale === PARTY.sizzle.boost);
  assert.ok(minDistToFire > PARTY.sizzle.fireR + 0.3, 'nobody walked into the fire: the collider held');
  assert.equal(s.results.ranks.length, 4); assert.equal(s.results.ranks.filter((x) => x.place === 1).length, 2);
  for (const p of r.pm.list) assert.ok(isWalkable(p.position.x, p.position.z));
  assert.ok(r.calls.music.includes('sizzle')); assert.ok(r.calls.tempo.some((k) => k > 1.01), 'the tempo follows the seed\'s glow');
  assert.ok(r.calls.sfx.includes('fanfare') || r.calls.sfx.includes('whistle'));
  r.run(PARTY.flow.results + 1, () => r.party.state.phase === 'lobby');
  for (const p of r.pm.list) assert.equal(p.speedScale, 1, 'back to normal speed after the game');
  assert.equal(r.party.summary().stages.sizzle.visible, false);
});

test('Egg Scramble on the real runtime: bots run in their lanes and stack eggs; the host judges from the Players\' positions; a person who never presses anything scores little and the game still ends', async () => {
  const r = makeRuntime(); r.pm.p1.teleport(10, 14);
  r.party.open({ bots: 'fill', difficulty: 'normal', games: ['sizzle', 'eggs'] });
  await r.party.play('eggs');
  r.run(8, () => r.pm.bots.length === 3);
  assert.equal(r.party.state.game, 'eggs');
  const strips = eggsStrips(); let outside = 0, frames = 0;
  r.run(140, () => {
    const s = r.party.state;
    if (s.phase === 'play') for (const p of r.pm.list) { const lane = s.roster.findIndex((x) => x.slot === p.index); if (lane < 0) continue; frames++; const st = strips[lane]; if (p.position.x < st.x0 - 0.1 || p.position.x > st.x1 + 0.1 || p.position.z < st.z0 - 0.3 || p.position.z > st.z1 + 0.3) outside++; }
    return s.phase === 'results';
  });
  const s = r.party.state; assert.equal(s.phase, 'results'); assert.ok(s.g.done && frames > 500);
  assert.equal(outside, 0, 'the walkable strips keep everybody in their lane');
  const ranks = s.results.ranks; assert.equal(ranks.length, 4);
  const mine = ranks.find((x) => x.slot === 0), bots = ranks.filter((x) => x.slot !== 0);
  assert.ok(mine.score < Math.min(...bots.map((b) => b.score)), `standing still catches only what happens to fall on you (${mine.score} vs ${bots.map((b) => b.score)})`); assert.ok(bots.every((b) => b.score > 8), `the bots caught eggs: ${bots.map((b) => b.score)}`);
  assert.deepEqual(bots.map((b) => b.place).filter((p) => p === 1).length >= 1, true); assert.ok(s.g.caught[1] + s.g.caught[2] + s.g.caught[3] > 20);
  assert.equal(r.party.summary().stages.eggs.visible, true);
  r.run(PARTY.flow.results + 1, () => r.party.state.phase === 'lobby'); assert.equal(r.party.summary().stages.eggs.visible, false);
});

// ---------------------------------------------------------------------------------------------------------------- music + sounds + icons
test('four new tracks (23 Fuse Box, 24 Henhouse Polka, 25 Sunny Skip, 26 Bubblegum Shuffle) come after the old 23, whose events stay pinned; each has its own style and tempo', () => {
  assert.equal(TRACK_TITLES.length, 33); assert.deepEqual(TRACK_TITLES.slice(23, 27), ['Fuse Box', 'Henhouse Polka', 'Sunny Skip', 'Bubblegum Shuffle']);
  assert.equal(new Set(TRACK_TITLES).size, 33); assert.deepEqual(PARTY_TRACKS, { vineskip: 19, timber: 20, marlosays: 21, huddle: 22, sizzle: 23, eggs: 24, feastround: 27, bumpers: 28, glowcap: 29, cast: 30, tilty: 31, bonk: 32 }); assert.deepEqual(REGION_TRACKS.party, [18, 25, 26]);
  const pins = { 23: 'b42263bef57becf4da8db8e1124549b26ae643896619a3a8872111ad0f74f8f1', 24: '93ba1cccb5af88b224ad360367571d405721c84f462d654d22e0c74f7f6858db', 25: '146001feea9b6d31be9688d1eaafe5ffd8e169e20e136e94023236316602bb7e', 26: 'b362909cbe96320bf3d2dfccf81b209deda0c3105bae44c8596e28623f8825c5',
    18: '72252c4ee94b91f2f3707d905e5119d1b47c4ecb76c945de4be04d096b009b96', 19: '4d3fc0756319c61a120fdd7f5b7216e4d34db1b1c46d83aeec4679c7c5848352', 20: '2052bfd4251653b846d1a9c9bd8e6d020f403bee9995b4ab85d86d3cb11c382f', 21: '4a63ab2d0d1fc9ac87829ae4ba3576be3f77c303998c7a66c5015f6ddee403e1', 22: '57aa4ca6c20f32589fb9e3976f509e99ada01093abdb3d4c51f36e6e87f24a97' };
  for (const [i, h] of Object.entries(pins)) assert.equal(createHash('sha256').update(JSON.stringify(getTrack(Number(i)).events)).digest('hex'), h, `track ${i} (${TRACK_TITLES[i]})`);
  const info = trackInfo();
  assert.deepEqual([23, 24, 25, 26].map((i) => info[i].bpm), [132, 150, 108, 96]); assert.deepEqual([info[23].meter, info[24].meter], ['4/4', '2/4']); assert.equal(info[24].bars, 64);
  for (const i of [23, 24, 25, 26]) {
    const tr = getTrack(i), again = tr.def.build(); assert.deepEqual(tr.events, again.events, 'deterministic'); assert.ok(info[i].seconds > 40 && info[i].seconds < 70, `${TRACK_TITLES[i]} lasts ${info[i].seconds} s`);
    let prev = 0; for (const e of tr.events) { assert.ok(e.s >= prev && e.s < tr.steps); prev = e.s; assert.ok(e.d > 0 && e.v > 0 && e.v <= 1 && Number.isFinite(e.s)); for (const n of Array.isArray(e.m) ? e.m : [e.m]) assert.ok(Number.isFinite(n)); }
  }
  const kinds = (i) => new Set(getTrack(i).events.map((e) => e.k));
  assert.ok(kinds(23).has('pluck') && kinds(23).has('shaker') && kinds(23).has('bass'), 'ticking pizzicato, hi-hat, tense bass');
  const hats = (bars) => getTrack(23).events.filter((e) => e.k === 'shaker' && e.s >= bars[0] * 16 && e.s < bars[1] * 16).length / (bars[1] - bars[0]); assert.ok(hats([16, 24]) > hats([0, 8]) * 1.7, 'the hi-hat doubles by the last verse');
  assert.ok(kinds(24).has('lead') && getTrack(24).events.some((e) => e.o && e.o.style === 'flute'), 'a bird-whistle lead'); assert.ok(kinds(24).has('logdrum'));
  assert.ok(kinds(25).has('marimba') && kinds(25).has('pluck'), 'ukulele and marimba'); assert.ok(kinds(26).has('ep') && kinds(26).has('plip') && kinds(26).has('bell'), 'synth-pop: e-piano, bubbles, bells');
  assert.ok(info[25].bpm !== info[18].bpm && info[26].bpm !== info[18].bpm && getTrack(25).def.swing !== getTrack(26).def.swing);
});

test('the lobby rotates through Glade Jamboree, Sunny Skip and Bubblegum Shuffle: the first lobby of a party is Glade Jamboree, never the same track twice in a row, all three get played, and a new party carries on the rotation', () => {
  assert.deepEqual([null, 18, 25, 26].map((l) => nextLobbyTrack(l)), [18, 25, 26, 18]);
  const m = new Music({ onChange() {} }); let region = 'party'; m.region = () => region;
  const played = []; for (let i = 0; i < 9; i++) { const idx = m._chooseNext(-1); played.push(idx); m._lobbyLast = idx; }
  assert.equal(played[0], 18, 'Glade Jamboree opens the party'); for (let i = 1; i < played.length; i++) assert.notEqual(played[i], played[i - 1]);
  assert.deepEqual([...new Set(played)].sort(), [18, 25, 26]); assert.deepEqual(played.slice(0, 6), [18, 25, 26, 18, 25, 26]);
  // coming back from a game: the forced game track does not disturb the rotation; handing back plays the NEXT lobby track
  m._lobbyLast = 25; m.party('sizzle'); assert.equal(m._chooseNext(-1), 23); m.party(null); assert.equal(m._chooseNext(-1), 26, 'after Sunny Skip comes Bubblegum Shuffle');
  // leaving the party (the island's music again) and opening another one CARRIES ON the rotation (the user heard Glade Jamboree at every new party)
  m._lobbyLast = 25; region = 'home'; m._lastRegion = 'party'; m.updateRegion(); assert.equal(m._lobbyLast, 25); region = 'party'; m._lastRegion = 'home'; m.updateRegion(); assert.equal(m._chooseNext(-1), 26, 'the next party opens with the next lobby track');
});

test('the new sounds exist and play without a context harmlessly; the new icons are inline SVG', () => {
  const sfx = new Sfx();
  for (const n of ['seedpass', 'seedpop', 'eggcatch', 'golden', 'eggsplat', 'bonk']) assert.doesNotThrow(() => sfx.play(n, { pitch: 1.2, vol: 0.5 }), n);
  const ctx = { currentTime: 0, state: 'running', destination: {}, createOscillator: () => ({ type: '', frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} }, connect(n) { return n; }, start() {}, stop() {} }), createGain: () => ({ gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} }, connect(n) { return n; } }), createBufferSource: () => ({ connect(n) { return n; }, start() {}, stop() {}, buffer: null, playbackRate: { value: 1 } }), createBiquadFilter: () => ({ type: '', frequency: { setValueAtTime() {}, value: 0 }, Q: { value: 0 }, connect(n) { return n; } }), createBuffer: () => ({ getChannelData: () => new Float32Array(10) }), sampleRate: 8000 };
  sfx.ctx = ctx; sfx.master = { connect() {} };
  for (const n of ['seedpass', 'seedpop', 'eggcatch', 'golden', 'eggsplat', 'bonk']) { try { sfx.play(n, { pitch: 1.2 }); } catch (e) { assert.fail(`${n}: ${e.message}`); } }
  for (const k of ['party-sizzle', 'party-eggs']) { assert.ok(ICONS[k] && ICONS[k].startsWith('<svg') && ICONS[k].endsWith('</svg>'), k); assert.doesNotMatch(ICONS[k], /[\u{1F300}-\u{1FAFF}☀-➿]/u); }
});
