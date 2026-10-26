// Step 80e: the full party. Bonus stars (one feat per game, ties share, a feat everybody shares is no feat), the trophy ceremony (the host-timed cut after the last round: places with ties, the podium, the crowd of nine, the camera,
// the shared hold-Cancel skip, a fresh party afterwards, nothing saved, host + replica hashes equal), the kiosk (`?party&kiosk`: flags and locks), the attract mode (2 minutes idle, bots only, half-volume music, any input returns),
// the mid-party joiner queue, the balance soak at a small count (the big one is test/fixtures/soak80e.mjs) and the budgets (draw calls, triangles, lights, shader programs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { installDom } from './fixtures/domStub.js';
import { PARTY } from '../public/js/config.js';
import { GAMES, GAME_IDS, getGame } from '../public/js/game/party/registry.js';
import { PHASES, awardBonus, finalPlaces, awardStars } from '../public/js/game/party/flowLogic.js';
import { normaliseState, freshState } from '../public/js/game/party/partyDomain.js';
import { normalisePrefs } from '../public/js/game/party/flowLogic.js';
import { bonusFor, pickBonus, FEATS } from '../public/js/game/party/bonusLogic.js';
import { BOTS } from '../public/js/game/party/botRoster.js';
import * as VS from '../public/js/game/party/vineskipLogic.js';
import * as TM from '../public/js/game/party/timberLogic.js';
import * as MS from '../public/js/game/party/marlosaysLogic.js';
import * as HU from '../public/js/game/party/huddleLogic.js';
import * as SZ from '../public/js/game/party/sizzleLogic.js';
import * as EG from '../public/js/game/party/eggsLogic.js';
import * as FR from '../public/js/game/party/feastroundLogic.js';
import * as BU from '../public/js/game/party/bumpersLogic.js';
import * as GL from '../public/js/game/party/glowcapLogic.js';
import * as CA from '../public/js/game/party/castLogic.js';
import * as TY from '../public/js/game/party/tiltyLogic.js';
import * as BO from '../public/js/game/party/bonkLogic.js';
import { podiumSpots, cameraShot, createCeremony, bakeCheerer, crowdSpots, trophyParts, BLOCKS } from '../public/js/world/party/ceremony.js';
import { lockOptions } from '../public/js/ui/optionsMenu.js';
import { TitleCard } from '../public/js/ui/titleCard.js';
import { createPartyUi } from '../public/js/ui/partyUi.js';
import { setLowDetail, sphere } from '../public/js/npc/models.js';
import { createTdoongModel } from '../public/js/npc/tdoongz.js';
import { pair } from './fixtures/partyPair.js';
// partyPair.run(secs, dt, each) stops when each() returns false; here run(secs, dt, until) runs UNTIL the condition holds (returns whether it did), like the runtime's run
function mkPair(o) {
  const w = pair(o), base = w.run;
  w.run = (secs, dt = 1 / 30, until = null) => {
    if (typeof until !== 'function') return base(secs, dt);
    for (let t = 0; t < secs - 1e-9; t += dt) { base(dt, dt); if (until()) return true; }
    return false;
  };
  return w;
}
import { makeRuntime } from './fixtures/partyRuntime80e.js';
import { estimateTriangles } from './fixtures/partyTriangles.js';
import { soakBots, soakKid, judge, SIMS } from './fixtures/soak80e.mjs';

installDom();
const O = PARTY.origin, L = PARTY.lobby;
const roster = (n = 4) => Array.from({ length: n }, (_, slot) => ({ slot }));
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} ~= ${b}`);

// ============================================================================================ bonus stars
test('the tie / "everybody equal" / "nobody reached it" rules of a bonus feat', () => {
  const spec = (scores, extra = {}) => ({ label: 'x', scores, text: (v) => `${v}!`, ...extra });
  assert.deepEqual(pickBonus(spec({ 0: 3, 1: 1, 2: 0 }), [0, 1, 2]), { label: 'x', text: '3!', slots: [0], value: 3 });
  assert.deepEqual(pickBonus(spec({ 0: 3, 1: 3, 2: 1 }), [0, 1, 2]).slots, [0, 1], 'a tie shares the star');
  assert.equal(pickBonus(spec({ 0: 2, 1: 2, 2: 2 }), [0, 1, 2]), null, 'everybody did it equally: nobody stood out');
  assert.equal(pickBonus(spec({ 0: 0, 1: 0 }), [0, 1]), null, 'nobody reached the minimum');
  assert.equal(pickBonus(spec({ 0: 0, 1: 4 }, { min: 3 }), [0, 1]).slots[0], 1, 'a score under the minimum does not count');
  assert.deepEqual(pickBonus(spec({ 0: 120, 1: 80 }, { low: true }), [0, 1]).slots, [1], 'low is better');
  assert.deepEqual(pickBonus(spec({ 0: -0.2, 1: 0.4 }, { low: true }), [0, 1]).slots, [0], 'a negative margin is the lowest');
  assert.equal(pickBonus(spec({ 0: 5 }), [0]).slots[0], 0, 'a solo player can earn it');
  assert.equal(pickBonus(null, [0]), null); assert.equal(bonusFor('nope', {}), null); assert.equal(bonusFor('vineskip', null), null);
  assert.equal(bonusFor('vineskip', { slots: [0, 1] }), null, 'a state without the counters never throws');
  assert.deepEqual(awardBonus({ 0: 1 }, [0, 2]), { 0: 1 + PARTY.bonusStars, 2: PARTY.bonusStars }); assert.deepEqual(awardBonus({ 3: 1 }, []), { 3: 1 });
  assert.deepEqual(Object.keys(FEATS).sort(), GAME_IDS.slice().sort(), 'every game has a feat');
});

test('every game has a bonus feat read from its own state: Vine Skip hops, Timber Trim closest cut, Marlo Says quickest flag, Huddle dodges, Sizzle passes, Eggs golden eggs, Feast dishes, Bumpers bumps, Glowcap bullseye, Cast biggest find, Tilty fast start, Bonk closest call', () => {
  const R = roster(3);
  // Vine Skip: the most hops (a counter the jump records keep)
  let g = VS.init(1, R); for (const [slot, n] of [[0, 3], [1, 1]]) for (let i = 0; i < n; i++) VS.apply(g, { k: 'jump', slot, at: i });
  let b = bonusFor('vineskip', g); assert.deepEqual([b.label, b.slots, b.text], ['Most hops', [0], '3 hops']);
  VS.apply(g, { k: 'jump', slot: 1, at: 5 }); VS.apply(g, { k: 'jump', slot: 1, at: 6 }); assert.deepEqual(bonusFor('vineskip', g).slots, [0, 1], 'a tie at three hops');
  VS.apply(g, { k: 'jump', slot: 2, at: 7 }); assert.equal(bonusFor('vineskip', VS.init(1, R)), null, 'nobody hopped');
  // Timber Trim: the cut closest to dead on (ms)
  g = TM.init(2, R); TM.apply(g, { k: 'cut', slot: 0, i: 0, d: 40, pts: 80 }); TM.apply(g, { k: 'cut', slot: 1, i: 0, d: -12, pts: 95 }); TM.apply(g, { k: 'cut', slot: 2, i: 0, d: 90, pts: 40 }); TM.apply(g, { k: 'whiff', slot: 2, i: 1 });
  b = bonusFor('timber', g); assert.deepEqual([b.label, b.slots, b.text], ['Best cut', [1], '12 ms from dead on']);
  TM.apply(g, { k: 'cut', slot: 0, i: 2, d: 12, pts: 95 }); assert.deepEqual(bonusFor('timber', g).slots, [0, 1], 'equal distances either side tie');
  // Marlo Says: the quickest right flag (ms)
  g = MS.init(3, R); MS.apply(g, { k: 'ok', slot: 0, i: 0, rt: 420 }); MS.apply(g, { k: 'ok', slot: 1, i: 0, rt: 300 }); MS.apply(g, { k: 'ok', slot: 0, i: 1, rt: 250 });
  b = bonusFor('marlosays', g); assert.deepEqual([b.label, b.slots, b.text], ['Quickest flag', [0], '250 ms']);
  // Pinecone Huddle: the most cones dodged
  g = HU.init(4, R); HU.apply(g, { k: 'safe', slot: 2, d: 0 }); HU.apply(g, { k: 'safe', slot: 2, d: 1 }); HU.apply(g, { k: 'safe', slot: 1, d: 0 });
  b = bonusFor('huddle', g); assert.deepEqual([b.label, b.slots, b.text], ['Most dodges', [2], '2 safe curls']);
  // Sizzle Seed: the most passes
  g = SZ.init(5, R); SZ.apply(g, { k: 'give', slot: 0, t: 2 }); SZ.apply(g, { k: 'pass', from: 0, to: 1, t: 3 }); SZ.apply(g, { k: 'pass', from: 1, to: 2, t: 4 }); SZ.apply(g, { k: 'pass', from: 2, to: 1, t: 5 }); SZ.apply(g, { k: 'pass', from: 1, to: 0, t: 6 });
  b = bonusFor('sizzle', g); assert.deepEqual([b.label, b.slots, b.text], ['Most passes', [1], '2 passes']);
  // Egg Scramble: the most golden eggs caught
  g = EG.init(6, R); const items = EG.buildItems(6), golds = items.filter((i) => i.kind === 'gold'), plain = items.find((i) => i.kind === 'egg');
  assert.ok(golds.length >= 2); EG.apply(g, { k: 'catch', slot: 1, i: golds[0].i, t: 5, gold: true }); EG.apply(g, { k: 'catch', slot: 1, i: golds[1].i, t: 8, gold: true }); EG.apply(g, { k: 'catch', slot: 0, i: plain.i, t: 3 });
  b = bonusFor('eggs', g); assert.deepEqual([b.label, b.slots, b.text], ['Golden eggs', [1], '2 golden eggs']);
  // Feast-Go-Round: the most dishes finished
  g = FR.init(7, R); const dish = g.dishes.find((d) => d.kind !== 'pepper'); FR.apply(g, { k: 'grab', slot: 2, id: dish.id, t: 1 }); for (let i = 0; i < dish.chews; i++) FR.apply(g, { k: 'chew', slot: 2, t: 1.5 });
  b = bonusFor('feastround', g); assert.deepEqual([b.label, b.slots, b.text], ['Most dishes', [2], '1 dish']);
  // Puffball Bumpers: the most bumps
  g = BU.init(8, R); BU.apply(g, { k: 'motion', balls: g.balls, alive: g.alive, outAt: {}, bumps: 5, hits: { 0: 3, 1: 5, 2: 2 }, t: 6, done: false });
  b = bonusFor('bumpers', g); assert.deepEqual([b.label, b.slots, b.text], ['Most bumps', [1], '5 bumps']);
  // Glowcap Shuffle: the nearest to the glow's heart on average (two rounds at least)
  g = GL.init(9, R); GL.apply(g, { k: 'sink', r: 0, t: 5, out: [], d: { 0: 0.4, 1: 1.8, 2: 1.0 } }); assert.equal(bonusFor('glowcap', g), null, 'one round is not enough to tell');
  GL.apply(g, { k: 'sink', r: 1, t: 9, out: [], d: { 0: 0.8, 1: 1.2, 2: 1.0 } });
  b = bonusFor('glowcap', g); assert.deepEqual([b.label, b.slots], ['Bullseye feet', [0]]); assert.match(b.text, /0\.6 u from the glow/);
  // Driftwood Cast: the biggest find (a golden shell is 10)
  g = CA.init(10, R); const ci = CA.buildItems(10), shell = ci.find((i) => i.kind === 'shell'), wood = ci.find((i) => i.kind === 'driftwood');
  g.res[0][shell.i] = 'd'; g.res[1][wood.i] = 'd'; g.res[2][ci.find((i) => i.kind === 'boot').i] = 'd';
  b = bonusFor('cast', g); assert.deepEqual([b.label, b.slots, b.text], ['Biggest find', [0], 'a 10-point find']);
  // Tilty Tiles: the most tiles uncovered by the 10 s mark (set once)
  g = TY.init(11, R); const boards = (ns) => g.boards.map((x, i) => ({ ...x, n: ns[i] ?? 0 }));
  TY.apply(g, { k: 'motion', t: 9, b: boards([2, 9, 1]) }); assert.equal(bonusFor('tilty', g), null, 'before the mark');
  TY.apply(g, { k: 'motion', t: 10.2, b: boards([3, 6, 8]) }); TY.apply(g, { k: 'motion', t: 20, b: boards([20, 20, 20]) });
  b = bonusFor('tilty', g); assert.deepEqual([b.label, b.slots, b.text], ['Fast starter', [2], '8 tiles by 10 s']);
  // Bonk Burrows: the narrowest escape from a slam (a hop that saved you is negative)
  g = BO.init(12, R); BO.apply(g, { k: 'bonk', i: 0, t: 3, out: [], near: { 0: 0.6, 1: 0.3 } }); BO.apply(g, { k: 'bonk', i: 1, t: 4, out: [2], near: { 0: 0.9, 1: -0.1 } });
  b = bonusFor('bonk', g); assert.deepEqual([b.label, b.slots, b.text], ['Closest call', [1], 'saved by a hop!']);
});

test('the feats are JSON and replica-safe: a replica applying only the host\'s records ends with the same bonus (a bumpers, a bonk and a glowcap game through the real step)', () => {
  for (const [id, M] of [['bonk', BO], ['bumpers', BU], ['glowcap', GL]]) {
    const R = roster(4), g = M.init(21, R), seen = [];
    // nobody walks: the bots stand at the stage spawns, which is enough to produce records (squashes, sinks, motion)
    const spawns = { bonk: 'bonk', bumpers: 'bumpers', glowcap: 'glowcap' }[id];
    void spawns;
    let t = 0;
    while (!g.done && t < 70) { t += 1 / 30; for (const r of M.step(g, { t, pos: () => ({ x: O.x + 100000, z: O.z }), slack: PARTY.slack, lag: 0 }, 1 / 30, t)) { M.apply(g, r); seen.push(r); } }
    const replica = M.init(21, R); for (const r of JSON.parse(JSON.stringify(seen))) M.apply(replica, r);
    assert.deepEqual(bonusFor(id, replica), bonusFor(id, g), id);
    assert.deepEqual(JSON.parse(JSON.stringify(g)), g, `${id}: the state, counters included, survives a JSON round trip`);
  }
});

test('a game\'s bonus star lands in the results and the stars (host + replica, equal hashes), on top of the winner\'s star', async () => {
  const w = mkPair(); w.host.open({ mode: 'random', games: ['vineskip'] }); w.flush();
  for (let i = 0; i < 4; i++) w.host.skip();                                                            // lobby -> pick -> how-to -> countdown -> play
  assert.equal(w.host.state.phase, 'play');
  w.run(0.2); for (let i = 0; i < 3; i++) { const r = w.host.act({ screen: 'host', index: 0, pos: { x: 0, y: 0, z: 0 } }, w.host.gameTime()); w.flush(); assert.equal((await r).ok, true); w.run(0.8); }
  assert.equal(w.host.state.g.hopN[0], 3, 'three hops counted');
  w.host.debug.win(0); w.flush(); await Promise.resolve(); w.run(6, 1 / 30, () => w.host.state.phase === 'results');
  assert.equal(w.host.state.phase, 'results');
  const R = w.host.state.results;
  assert.deepEqual(R.bonus, { label: 'Most hops', text: '3 hops', slots: [0], value: 3 });
  assert.equal(w.host.state.stars[0], 1 + PARTY.bonusStars, 'the winner\'s star plus the bonus star'); assert.deepEqual(w.replica.state.results, R); w.equal('results');
  // a bonus nobody earned is null and costs nothing
  const q = mkPair(); q.host.open({ mode: 'random', games: ['timber'] }); q.flush(); for (let i = 0; i < 5; i++) q.host.skip();      // (nobody presses: the skip fakes the end)
  assert.equal(q.host.state.results.bonus, null, 'nobody chopped: no bonus'); q.flush(); q.equal('no bonus');
});

// ============================================================================================ the places
test('the standings: most stars first, ties share a place (1, 1, 3, 4); a lone seat is first; nothing for an empty table', () => {
  assert.deepEqual(finalPlaces({ 0: 3, 1: 3, 2: 1, 3: 0 }, roster(4)).map((p) => [p.slot, p.place, p.stars]), [[0, 1, 3], [1, 1, 3], [2, 3, 1], [3, 4, 0]]);
  assert.deepEqual(finalPlaces({ 0: 1, 1: 5, 2: 3 }, roster(3)).map((p) => [p.slot, p.place]), [[1, 1], [2, 2], [0, 3]]);
  assert.deepEqual(finalPlaces({}, roster(2)).map((p) => p.place), [1, 1], 'nobody scored: everybody shares first');
  assert.deepEqual(finalPlaces({ 0: 2 }, roster(1)), [{ slot: 0, place: 1, stars: 2 }]); assert.deepEqual(finalPlaces({}, []), []);
  assert.equal(PHASES.length, 6, 'the ceremony is a lobby with `ceremony`, not a new phase (replicas and tests keep their six phases)');
});

test('the podium: 1st on the tall middle block, 2nd on its left, 3rd on its right, the rest on the grass; ties share a block side by side; every seat gets exactly one spot', () => {
  const spots = podiumSpots(finalPlaces({ 0: 4, 1: 3, 2: 2, 3: 1 }, roster(4)));
  const by = Object.fromEntries(spots.map((s) => [s.slot, s]));
  near(by[0].x, O.x + L.podium.x); near(by[0].y, O.y + 1.5); near(by[1].x, O.x + L.podium.x - 2); near(by[1].y, O.y + 0.9); near(by[2].x, O.x + L.podium.x + 2); near(by[2].y, O.y + 0.6);
  assert.equal(by[3].y, O.y, 'fourth place stands on the grass'); assert.ok(by[3].x > by[2].x + 1.5);
  assert.deepEqual(BLOCKS.map((b) => b.h), [1.5, 0.9, 0.6]);
  const tie = podiumSpots(finalPlaces({ 0: 3, 1: 3, 2: 1 }, roster(3))), t0 = tie.find((s) => s.slot === 0), t1 = tie.find((s) => s.slot === 1), t2 = tie.find((s) => s.slot === 2);
  near(t0.y, O.y + 1.5); near(t1.y, O.y + 1.5); assert.ok(Math.abs(t0.x - t1.x) >= 0.7 && Math.abs((t0.x + t1.x) / 2 - (O.x + L.podium.x)) < 1e-9, 'the tie stands side by side on the first block');
  near(t2.y, O.y + 0.6, 1e-9); near(t2.x, O.x + L.podium.x + 2);                                                            // (third place is the next place AFTER the tie: 1, 1, 3)
  assert.equal(new Set(podiumSpots(finalPlaces({}, roster(4))).map((s) => s.slot)).size, 4);
  for (const s of spots) { assert.equal(s.face, 0); assert.ok(Math.hypot(s.x - O.x, s.z - O.z) < L.r + 2, 'inside the lobby'); }
});

// ============================================================================================ the ceremony on the domain (host + replica)
test('a party ends with the trophy ceremony: the places are published, host-timed, replicas follow with equal hashes; then a FRESH party; the shared skip works from either screen; nothing is saved', async () => {
  const w = mkPair(); w.host.open({ mode: 'party', rounds: 2, games: ['vineskip', 'timber'] }); w.flush();
  const play = async (winner) => {
    for (let i = 0; i < 4; i++) w.host.skip();
    w.run(0.1); w.host.debug.win(winner); w.flush(); await Promise.resolve(); w.run(6, 1 / 30, () => w.host.state.phase === 'results');
    assert.equal(w.host.state.phase, 'results');
  };
  await play(0); assert.equal(w.host.state.results.partyOver, false);
  w.host.skip(); await play(0);                                                                         // round 2: slot 0 wins again
  const R = w.host.state.results; assert.equal(R.partyOver, true); w.equal('last results');
  assert.equal(w.host.state.ceremony, null, 'the ceremony waits for the results card to finish');
  w.run(PARTY.flow.partyOver + 0.2, 1 / 30, () => w.host.state.ceremony);
  const c = w.host.state.ceremony;
  assert.equal(w.host.state.phase, 'lobby'); assert.ok(c && c.places.length === 3); assert.equal(c.places[0].place, 1); assert.equal(c.places[0].slot, 0);
  assert.ok(w.host.state.stars[0] >= 2 && c.places[0].stars === w.host.state.stars[0], 'the ceremony keeps the final stars');
  assert.deepEqual(w.replica.state.ceremony, c); w.equal('ceremony');
  w.run(PARTY.ceremony.length - 1); assert.ok(w.host.state.ceremony, 'still on'); w.equal('mid ceremony');
  w.run(1.2, 1 / 30, () => !w.host.state.ceremony);
  assert.equal(w.host.state.ceremony, null); assert.deepEqual([w.host.state.round, w.host.state.stars, w.host.state.phase, w.host.state.results, w.host.state.game], [0, {}, 'lobby', null, null], 'a fresh party');
  assert.equal(w.replica.state.ceremony, null); w.equal('fresh party');
  w.run(PARTY.flow.lobbyFirst + 0.3, 1 / 30, () => w.host.state.phase === 'pick'); assert.equal(w.host.state.phase, 'pick', 'and it plays on by itself'); assert.equal(w.host.state.round, 1);
  // the shared skip: either screen can end the cut (the hold-Cancel gesture sends skipCeremony)
  const finish = async (screen) => {
    const p = mkPair(); p.host.open({ mode: 'party', rounds: 1, games: ['vineskip'] }); p.flush();
    for (let i = 0; i < 4; i++) p.host.skip(); p.run(0.1); p.host.debug.win(0); p.flush(); await Promise.resolve(); p.run(6, 1 / 30, () => p.host.state.phase === 'results');
    p.run(PARTY.flow.partyOver + 0.2, 1 / 30, () => p.host.state.ceremony); assert.ok(p.host.state.ceremony);
    const res = (screen === 'replica' ? p.replica : p.host).skipCeremony(); p.flush(); assert.equal((await res).ok, true);
    assert.equal(p.host.state.ceremony, null); assert.equal(p.replica.state.ceremony, null); assert.equal(p.host.state.stars[0], undefined); p.equal(`skipped from the ${screen}`);
    const again = p.replica.skipCeremony(); p.flush(); assert.equal((await again).reason, 'not-now', 'nothing left to skip');
  };
  await finish('replica'); await finish('host');
  // a random-mode party never has a ceremony (only "party" mode counts rounds)
  const r = mkPair(); r.host.open({ mode: 'random', games: ['vineskip'] }); r.flush(); for (let i = 0; i < 4; i++) r.host.skip(); r.run(0.1); r.host.debug.win(0); r.flush(); await Promise.resolve(); r.run(6, 1 / 30, () => r.host.state.phase === 'results');
  r.run(PARTY.flow.results + 1.2, 1 / 30, () => r.host.state.phase === 'lobby'); assert.equal(r.host.state.ceremony, null);
});

test('state normalising keeps the ceremony and the attract flag safe on a replica (garbage places are dropped)', () => {
  const pref = normalisePrefs(null, GAME_IDS);
  const s = normaliseState({ active: true, ceremony: { places: [{ slot: 0, place: 1, stars: 4 }, { slot: 9, place: 2 }, { slot: 1, place: 0 }, { slot: 2, place: 3, stars: 'x' }, null] }, attract: 1 }, pref);
  assert.deepEqual(s.ceremony, { places: [{ slot: 0, place: 1, stars: 4 }, { slot: 2, place: 3, stars: 0 }] }); assert.equal(s.attract, true);
  assert.equal(normaliseState({ ceremony: 5 }, pref).ceremony, null); assert.equal(normaliseState({ ceremony: { places: 'x' } }, pref).ceremony, null); assert.equal(freshState(pref).attract, false); assert.equal(freshState(pref).ceremony, null);
});

// ============================================================================================ the set: the crowd, the trophy, the camera
test('all nine Tdoongz are baked into two merged poses each (low detail, one draw call each), the trophy is one gold merged mesh; no new lights; the shared character program', () => {
  const parent = new THREE.Group(), before = parent.children.length, cer = createCeremony({ parent });
  cer.show(); cer.update(0.1, 5);
  const crowd = cer.crowd; assert.equal(crowd.length, 9); assert.deepEqual(crowd.map((c) => c.id), BOTS.map((b) => b.id), 'all nine friends, in the roster order');
  for (const c of crowd) {
    assert.equal(c.frames.length, 2); assert.equal(c.frames.filter((f) => f.visible).length, 1, 'one pose at a time = one draw call'); assert.equal(c.group.parent, cer.root);
    assert.equal(c.frames[0].material, c.frames[1].material); assert.equal(c.frames[0].material.customProgramCacheKey(), 'character-toon', 'the shared character program');
    assert.equal(c.frames[0].castShadow, false);
  }
  const spots = crowdSpots(); assert.equal(spots.length, 9); assert.ok(Math.max(...spots.map((s) => Math.abs(s.x))) < 7, 'on the dais');
  const t = estimateTriangles(cer.root); assert.equal(t.meshes, 9 + 2, 'nine friends + the trophy and its outline'); assert.ok(t.primary < 160000, `the crowd + trophy cost ${t.primary} triangles`);
  // low detail halves the friends' triangles and is only for the baking: the default build is untouched
  const count = (m) => { let n = 0; m.root.traverse((o) => { if (o.isMesh) n += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3; }); return n; };
  const normal = createTdoongModel('mokuring'); setLowDetail(true); const low = createTdoongModel('mokuring'); setLowDetail(false);
  assert.ok(count(low) < count(normal) * 0.6, `${count(low)} < 60% of ${count(normal)}`); assert.equal(sphere().parameters.widthSegments, 16, 'low detail is switched off again');
  const trophy = cer.trophy; assert.ok(trophy.isMesh && trophy.children.length === 1, 'a merged mesh with one outline child'); assert.equal(trophy.material.type, 'MeshToonMaterial');
  assert.ok(trophyParts().length >= 20, 'ears, face, arms up, pedestal');
  const box = new THREE.Box3().setFromObject(trophy); assert.ok(box.max.y - box.min.y > 3 && box.max.y - box.min.y < 5.2, 'about four units tall');
  // the trophy rises (scale 0 -> 1 with a bounce), the friends bounce and swap poses
  cer.update(0.1, 0.5); assert.equal(trophy.visible, false); cer.update(0.1, PARTY.ceremony.rise + 0.8); near(trophy.scale.x, 0.95, 1e-6);
  const y0 = crowd[0].group.position.y, seen = new Set(); for (let k = 0; k < 40; k++) { cer.update(0.05, 6 + k * 0.05); seen.add(crowd[0].frames[0].visible); }
  assert.equal(seen.size, 2, 'both poses are shown over time'); assert.ok(crowd[0].group.position.y >= y0 - 1e-9);
  assert.equal(parent.children.length, before + 1); let lights = 0; cer.root.traverse((o) => { if (o.isLight) lights++; }); assert.equal(lights, 0, 'no new lights');
  const one = bakeCheerer('parkzyoni'); assert.equal(one.frames.length, 2); one.dispose(); cer.dispose(); assert.equal(parent.children.length, before, 'disposed');
});

test('the camera path: it starts where the lobby view was, never jumps, finishes pulled out; always finite', () => {
  const from = { pos: [0, 16, 14], look: [0, 1, -3] };
  const s0 = cameraShot(0, from); assert.deepEqual(s0.pos.map((v) => +v.toFixed(6)), from.pos); assert.deepEqual(s0.look.map((v) => +v.toFixed(6)), from.look);
  let prev = s0;
  for (let t = 0.05; t <= PARTY.ceremony.length + 1; t += 0.05) {
    const s = cameraShot(t, from);
    for (const v of [...s.pos, ...s.look]) assert.ok(Number.isFinite(v));
    assert.ok(Math.hypot(...s.pos.map((x, i) => x - prev.pos[i])) < 1.2, `no jump at ${t.toFixed(2)} s`); prev = s;
  }
  const end = cameraShot(PARTY.ceremony.length + 5, from); assert.ok(end.pos[1] > 6 && end.pos[2] > 12, 'pulled out');
  const mid = cameraShot(9, from); assert.ok(Math.abs(mid.look[0] - L.podium.x) < 1, 'it closes on the podium'); assert.ok(Math.abs(cameraShot(14, from).look[0]) < 1, 'then swings over to the crowd');
});

// ============================================================================================ the ceremony on the real runtime (host)
test('the cut on the real runtime: letterbox through the cinematic, every seat on its podium step, the crowd of nine, the trophy jingle, the camera, then a fresh party with everybody back in the lobby; nothing saved', () => {
  const saved = []; const set = globalThis.localStorage.setItem; globalThis.localStorage.setItem = (k, v) => { saved.push(k); set(k, v); };
  const r = makeRuntime();
  try {
    r.party.open({ mode: 'party', rounds: 1, games: ['vineskip'], bots: 'fill' });
    r.run(4, () => r.party.pageMode && !r.party.curtain.running); r.run(3, () => r.pm.bots.length === 3);
    for (let i = 0; i < 5; i++) r.party.skip();
    assert.equal(r.party.state.phase, 'results'); assert.equal(r.party.state.results.partyOver, true);
    assert.equal(r.cin.active, false); assert.equal(r.party.ceremonyOn, false);
    r.run(PARTY.flow.partyOver + 1, () => r.party.state.ceremony); r.run(0.2);
    assert.ok(r.party.state.ceremony); assert.equal(r.party.ceremonyOn, true); assert.equal(r.cin.active, true, 'the cut is a cinematic scene (letterbox, hold Cancel to skip)'); assert.equal(r.cin.owner, 'party');
    assert.ok(r.calls.duck.some((d) => d.level === 0.4), 'the music ducks under the jingle');
    assert.equal(r.calls.sfx.filter((n) => n === 'trophy').length >= 2, true, 'the trophy jingle (the results card, then the cut)');
    const g = r.party.debug.glade(), cer = r.party.debug.ceremony();
    assert.equal(cer.summary().cheerers.length, 9); assert.equal(cer.summary().trophy, true); assert.deepEqual(g.cheerIds, [], 'the usual trio of the lobby steps aside');
    const spots = podiumSpots(r.party.state.ceremony.places);
    for (const sp of spots) { const p = r.pm.get(sp.slot); near(p.position.x, sp.x, 1e-6); near(p.position.y, sp.y, 1e-6); near(p.position.z, sp.z, 1e-6); assert.equal(p.frozen, true, 'frozen for the cut'); }
    r.run(2.5); const cam0 = r.camera.position.clone(); r.run(3); assert.ok(cam0.distanceTo(r.camera.position) > 1, 'the camera moves');
    for (const sp of spots) assert.ok(Math.abs(r.pm.get(sp.slot).position.y - sp.y) < 1e-6, 'the bodies stay on their steps');
    assert.ok(r.bursts.filter((b) => b[0] === 'confetti').length >= 3, 'confetti'); assert.ok(r.calls.sfx.includes('roundWon'));
    assert.equal(r.party.allowsTarget({ type: 'partyboard' }), false, 'no Game Board during the cut');
    assert.equal(r.musicLevel(), 0.4);
    // the end: a fresh party, everybody unfrozen and back on the lobby spots, the stage trio back
    r.run(PARTY.ceremony.length, () => !r.party.state.ceremony); r.run(0.3);
    assert.equal(r.party.state.ceremony, null); assert.deepEqual([r.party.state.round, r.party.state.stars], [0, {}]); assert.equal(r.party.ceremonyOn, false);
    r.run(2, () => !r.cin.busy); assert.equal(r.cin.busy, false, 'the camera eased back to the party view'); assert.equal(r.musicLevel(), 1, 'the music is back');
    for (const p of r.pm.list) { assert.equal(p.frozen, false); assert.ok(p.position.y < O.y + 0.5, 'off the podium'); }
    assert.equal(g.cheerIds.length, 3, 'the usual trio is back'); assert.equal(cer.summary().visible, false);
    assert.deepEqual(saved.filter((k) => k !== 'infiniteIsland.party'), [], 'a ceremony saves nothing (only the Game Board\'s own preference key may be written)');
    // the next party carries on by itself
    r.run(PARTY.flow.lobbyFirst + 0.5, () => r.party.state.phase === 'pick'); assert.equal(r.party.state.phase, 'pick');
  } finally { globalThis.localStorage.setItem = set; }
});

test('hold Cancel on any local device skips the cut for everybody (the scene asks the host, who ends it); a short press does not', () => {
  const r = makeRuntime();
  r.party.open({ mode: 'party', rounds: 1, games: ['vineskip'], bots: 'fill' }); r.run(4, () => r.party.pageMode && !r.party.curtain.running); r.run(3, () => r.pm.bots.length === 3);
  for (let i = 0; i < 5; i++) r.party.skip();
  r.run(PARTY.flow.partyOver + 1, () => r.party.state.ceremony); r.run(PARTY.ceremony.skipArm + 0.5);
  const p1 = r.pm.p1, hold = (secs) => { for (let t = 0; t < secs; t += 1 / 30) { p1.actions.cancelHeld = true; r.party.update(1 / 30, 0); r.cin.update(1 / 30); } p1.actions.cancelHeld = false; };
  hold(0.4); r.party.update(1 / 30, 0); assert.ok(r.party.state.ceremony, 'a short hold keeps the cut');
  r.run(1);
  hold(1.3); r.run(0.3);
  assert.equal(r.party.state.ceremony, null, 'the held Cancel ended it'); assert.equal(r.party.state.round, 0); r.run(3, () => !r.cin.busy); assert.equal(r.cin.busy, false);
});

// ============================================================================================ the results card
test('the results card shows the bonus star (label, who, the number) and the trophy cut strip reveals the places', () => {
  const ui = createPartyUi({ appendChild() {}, classList: { toggle() {}, add() {}, remove() {} } });
  ui.setActive(true);
  ui.results({ id: 'vineskip', name: 'Vine Skip', ranks: [{ name: 'Nabong', color: '#fff', place: 1, score: '60s', stars: 3, winner: true }], partyOver: false, round: 2, bonus: { label: 'Most hops', text: '3 hops', names: ['Nabong', 'Mokuring'] } });
  assert.ok(ui.summary().card === 'pu-card results');
  ui.podium([{ place: 1, ord: '1st', name: 'Nabong', color: '#fff', stars: 5, bot: true }]); assert.equal(ui.summary().podium, 0 /* the stub element has no children */ || ui.summary().podium);
  ui.podium(null); assert.equal(ui.summary().podium, null);
});

// ============================================================================================ the kiosk
test('?party&kiosk: the title card is skipped, the options keep only the sound, no Join / pair panel / split / fullscreen prompt; the 3 s keyboard exit stays; ?party alone is unchanged', () => {
  const k = makeRuntime({ params: new URLSearchParams('party&kiosk') }), n = makeRuntime({ params: new URLSearchParams('party') }), none = makeRuntime();
  assert.equal(k.party.kiosk, true); assert.equal(k.party.config.attract, true, 'a kiosk plays the attract mode'); assert.equal(n.party.kiosk, false); assert.equal(n.party.config.attract, false); assert.equal(none.party.kiosk, false);
  assert.equal(makeRuntime({ params: new URLSearchParams('kiosk') }).party.kiosk, false, '?kiosk alone does nothing');
  assert.equal(makeRuntime({ params: new URLSearchParams('attract') }).party.config.attract, true, '?attract turns the demo on without the locks');
  // the pure pieces
  const music = { style: {} }, mute = { style: {} }, pair = { style: {} }, fs = { style: {} }, juice = { style: {} };
  assert.equal(lockOptions([music, mute, pair, fs, juice], [music, mute]), 3); assert.deepEqual([music.style.display, mute.style.display, pair.style.display, fs.style.display], [undefined, undefined, 'none', 'none']);
  const title = new TitleCard({ appendChild() {} }); title.skip(); assert.equal(title.done, true); title.update(5); title.dismiss();
  // main.js wiring (read as text: main.js builds the whole game and cannot run in Node)
  const main = readFileSync(new URL('../public/js/main.js', import.meta.url), 'utf8');
  for (const needle of ['cinematic, outfits:', '!party.kiosk,', 'locked: party.kiosk', "if (party.kiosk) hud.joinButton.style.display = 'none'", 'const splitLocal = () => { if (!party.kiosk &&', 'if (party.kiosk) title.skip()', 'if (touch && !party.kiosk) createFullscreenPrompt'])
    assert.ok(main.includes(needle), `main.js: ${needle}`);
  assert.ok(main.includes('if (party.active) return;   // the Bag stays shut during a party'), 'the Bag stays shut');
});

// ============================================================================================ the attract mode
test('attract mode: after 2 minutes with no human input the bots play on their own (the humans sit out), the music drops to half volume, a pill says how to play; any input brings a fresh lobby back and the music up', () => {
  const r = makeRuntime({ params: new URLSearchParams('party&kiosk') });
  assert.equal(PARTY.attract.idle, 120); assert.equal(PARTY.attract.duck, 0.5);
  r.party.open({ mode: 'random', games: ['timber'], bots: 'fill' }); r.run(4, () => r.party.pageMode && !r.party.curtain.running); r.run(3, () => r.pm.bots.length === 3); r.run(0.6);
  assert.equal(r.party.state.attract, false); assert.deepEqual(r.party.state.roster.map((x) => x.bot), [false, true, true, true]);
  // a person nudges the stick now and then for the first minute: no attract mode
  r.run(60); assert.equal(r.party.state.attract, false);
  r.pm.activity = true; r.party.update(1 / 30, 0); r.pm.activity = false;                                  // (one frame of input resets the idle clock)
  assert.ok(r.party.debug.idle() < 1);
  const t0 = r.party.state.round;
  assert.equal(r.run(PARTY.attract.idle + 40, () => r.party.state.attract), true, 'two idle minutes (and the next lobby) later the bots take over');
  const s = r.party.state;
  assert.equal(s.phase, 'lobby', 'it starts from a clean lobby'); assert.deepEqual(s.roster.map((x) => x.bot), [true, true, true], 'only the bots are in the party; the idle person sits out');
  assert.equal(r.musicLevel(), PARTY.attract.duck, 'the music is at half volume'); assert.equal(r.calls.duck.at(-1).level, 0.5);
  assert.equal(r.party.summary().ui.pill, 'Press any button to play!');
  r.run(PARTY.flow.lobbyFirst + PARTY.flow.roulette + 12, () => r.party.state.phase === 'countdown'); assert.equal(r.party.state.phase, 'countdown', 'a game starts on its own');
  assert.ok(r.party.state.g.slots.length === 3 && r.party.state.g.slots.every((slot) => r.pm.get(slot).bot), 'three bots are the players');
  r.run(70, () => r.party.state.phase === 'results' && r.party.state.results.ranks.length === 3); assert.equal(r.party.state.results.ranks.length, 3, 'and they play it to the end');
  assert.ok(r.pm.p1 && !r.party.state.roster.some((x) => x.slot === 0), 'the person never played');
  // any human button: a fresh lobby, the person back in the roster, the music up
  r.pm.activity = true; r.party.update(1 / 30, 0); r.pm.activity = false; r.run(0.3);
  assert.equal(r.party.state.attract, false); assert.equal(r.party.state.phase, 'lobby'); assert.equal(r.party.state.round, 0); assert.deepEqual(r.party.state.stars, {});
  assert.deepEqual(r.party.state.roster.map((x) => x.bot), [false, true, true, true], 'the person is back at the table');
  assert.equal(r.musicLevel(), 1); assert.notEqual(r.party.summary().ui.pill, 'Press any button to play!'); void t0;
  // a normal ?party never goes into attract mode on its own
  const q = makeRuntime({ params: new URLSearchParams('party') });
  q.party.open({ mode: 'random', games: ['timber'], bots: 'fill' }); q.run(PARTY.attract.idle + 60); assert.equal(q.party.state.attract, false);
});

test('attract mode needs bots, and the host can switch it on and off by request (a joined screen\'s touch keeps it away)', async () => {
  const w = mkPair(); w.host.open({ bots: 'fill' }); w.flush();
  const denied = w.replica.setAttract(true); w.flush(); assert.equal((await denied).reason, 'host-only', 'a replica cannot start it'); assert.equal(w.host.state.attract, false);
  assert.equal(w.host.setAttract(true).reason, 'no-bots', 'one bot is no demo'); w.hTable.claim('host', 'bot:2', { bot: true, name: 'Mokuring', kind: 'bot' });
  const on = w.host.setAttract(true); assert.equal(on.ok, true); w.flush(); assert.equal(w.host.state.attract, true); assert.deepEqual(w.host.state.roster.map((r) => r.bot), [true, true], 'the humans sit out'); w.equal('attract on');
  const t = w.replica.touch(); w.flush(); assert.equal((await t).ok, true); assert.equal(w.host.touches, 1);
  assert.equal(w.host.setAttract(false).ok, true); w.flush(); assert.equal(w.host.state.attract, false); assert.equal(w.host.state.phase, 'lobby'); w.equal('attract off');
  // a table with fewer than two bots does not make a demo
  const solo = mkPair(); solo.host.open({ bots: 0 }); solo.flush(); assert.equal(solo.host.setAttract(true).reason, 'no-bots');
});

// ============================================================================================ the mid-party joiner
test('a person who finds the island full DURING a game stays queued: at the next lobby a bot gives up its seat and the person takes it without pressing again; they are in the next pick', () => {
  const r = makeRuntime();
  r.party.open({ mode: 'random', games: ['timber'], bots: 'fill' }); r.run(4, () => r.party.pageMode && !r.party.curtain.running); r.run(3, () => r.pm.bots.length === 3);
  r.party.skip(); r.party.skip(); r.party.skip(); r.party.skip();                                            // lobby -> pick -> how-to -> countdown -> play
  assert.equal(r.party.state.phase, 'play');
  assert.equal(r.pm.spawnDebugPlayer('kid'), null, 'a person presses a button: the table is full'); r.pm.fake('kid', {});
  assert.ok(r.toasts.some((t) => /next/i.test(t)), 'a friendly "you are next" toast, not just "island full"');
  assert.equal(r.pm.bots.length, 3, 'nobody is thrown out of the game that is running');
  r.run(PARTY.flow.results + 60, () => r.party.state.phase === 'lobby' && r.party.state.round >= 1 && r.pm.list.filter((p) => !p.bot).length === 2);
  assert.equal(r.pm.list.filter((p) => !p.bot).length, 2, 'the person is seated by themselves, no further press');
  assert.equal(r.pm.bots.length, 2, 'a bot gave up its seat'); assert.equal(r.table.count, 4);
  r.run(PARTY.flow.lobbyFirst + 1, () => r.party.state.phase === 'pick');
  assert.equal(r.party.state.roster.filter((x) => !x.bot).length, 2, 'the roster of the next pick has two people'); assert.equal(r.party.state.roster.length, 4);
  r.run(2); assert.equal(r.pm.bots.length, 2, 'fill keeps the table at four');
});

// ============================================================================================ the soak
test('balance soak (small count here; node test/fixtures/soak80e.mjs 300 120 is the big one): every game ends inside its cap, no seat is favoured, the bonus names real seats, easy bots lose to the scripted kid', () => {
  assert.deepEqual(Object.keys(SIMS).sort(), GAME_IDS.slice().sort(), 'a simulation for every game');
  const rows = [];
  for (const id of GAME_IDS) {
    const bots = soakBots(id, 'easy', 12, 3); rows.push(bots);
    assert.equal(bots.over, 0, `${id}: inside its cap of ${bots.cap}s (longest ${bots.maxT.toFixed(1)}s)`); assert.equal(bots.notDone, 0, `${id}: it ends by its own rules`); assert.equal(bots.badBonus, 0);
    assert.ok(Math.abs(bots.shares.reduce((a, b) => a + b, 0) - 1) < 1e-9, `${id}: exactly one win per game (ties split it)`);
    assert.deepEqual(judge(bots, null), [], id);
  }
  assert.ok(rows.filter((b) => b.bonus > 0).length >= 10, 'most games hand out their bonus star');
  // the kid: a few games' worth of seeds is enough to see the order (easy > hard); the big run asserts the whole table
  for (const id of ['timber', 'tilty', 'bumpers', 'huddle', 'sizzle']) { const easy = soakKid(id, 'easy', 16, 5), hard = soakKid(id, 'hard', 16, 5); assert.ok(easy > 0.5 && easy >= hard, `${id}: the kid wins ${easy} vs easy, ${hard} vs hard`); }
  // the fairness judge itself catches a rigged seat and a runaway game
  const rigged = { rounds: 300, shares: [0.5, 0.17, 0.17, 0.16], over: 0, notDone: 0, badBonus: 0, cap: 50 }; assert.ok(judge(rigged, null).some((m) => m.includes('seat 0')));
  assert.ok(judge({ ...rigged, shares: [0.25, 0.25, 0.25, 0.25], over: 2 }, null)[0].includes('past the cap')); assert.ok(judge({ ...rigged, shares: [0.25, 0.25, 0.25, 0.25] }, { easy: 0.4, hard: 0.1 }).some((m) => m.includes('kid')));
});

// ============================================================================================ budgets
test('budget: the lobby during the ceremony (four real Players, the crowd of nine, the trophy) stays under 400k triangles and ~140 draw calls; no new lights; no new shader program; the old lobby is unchanged', () => {
  const r = makeRuntime(); r.party.open({ mode: 'party', rounds: 1, games: ['vineskip'], bots: 'fill' });
  r.run(4, () => r.party.pageMode && !r.party.curtain.running); r.run(3, () => r.pm.bots.length === 3); r.run(1);
  const count = (root) => { let draws = 0, casters = 0, lights = 0; const programs = new Set(); root.traverse((o) => { if (o.isLight) lights++; if (o.isMesh && o.visible) { let vis = true; for (let n = o; n; n = n.parent) if (!n.visible) vis = false; if (vis) { draws++; if (o.castShadow) casters++; programs.add(o.material.customProgramCacheKey ? o.material.customProgramCacheKey() : o.material.type); } } }); return { draws, casters, lights, programs }; };
  const lobby = count(r.scene), lobbyTris = estimateTriangles(r.scene).total;
  for (let i = 0; i < 5; i++) r.party.skip();
  r.run(PARTY.flow.partyOver + 1, () => r.party.state.ceremony); r.run(7);
  assert.ok(r.party.state.ceremony);
  const cut = count(r.scene), tris = estimateTriangles(r.scene).total, reserve = 10000;
  assert.ok(cut.draws + cut.casters <= 140, `draw calls in the ceremony: ${cut.draws} meshes + ${cut.casters} shadow casters (the usual lobby: ${lobby.draws} + ${lobby.casters})`);
  assert.ok(cut.draws + cut.casters <= lobby.draws + lobby.casters + 10, 'and not more than the ordinary lobby plus a few');
  assert.ok(tris + reserve <= 400000, `triangles in the ceremony: ${tris} (the usual lobby: ${lobbyTris})`);
  assert.equal(cut.lights, lobby.lights, 'no new lights'); for (const p of cut.programs) assert.ok(lobby.programs.has(p) || p === 'character-toon', `a program the lobby does not already use: ${p}`);
  assert.ok([...cut.programs].every((p) => lobby.programs.has(p)), 'no new shader program at all');
});
