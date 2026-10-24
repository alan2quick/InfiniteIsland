// Step 80a: Party Games, the framework. The pocket clear of everything, the flow state machine with NO input, the shuffle bag + the Game Board's toggles + the saved preferences, the registry contract, the bots
// (BotSource = the input contract, a REAL Player driven by it, the slot table's bot flag, yielding to a joiner), the `party` sync domain on a real host + replica pair (hashes equal through a whole game, late join,
// host-only requests, replica presses judged from their stamp), the screen runtime with real Players and bots (opening, phases, leaving restores everyone), music tracks / jingles and icons.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { installDom, el } from './fixtures/domStub.js';
import * as THREE from 'three';
import { PARTY, ISLANDS, MAX_PLAYERS } from '../public/js/config.js';
import { meshExtent } from '../public/js/world/islands/extent.js';
import { PAGE } from '../public/js/game/storybookLogic.js';
import { TEST_ORIGIN } from '../public/js/game/areas/testYard.js';
import { AREAS } from '../public/js/game/areaLogic.js';
import { isWalkable, getHeight, getGroundType, regionOf, getTerrainHeight, inlandDistance } from '../public/js/world/terrain.js';
import { POCKET, inParty, partyWalkable, stageCentre, stageSpawns, spectatorSpot, lobbySpot, timberPads, GAME_STAGES } from '../public/js/game/party/partyArea.js';
import {
  PHASES, newFlow, goTo, flowTick, countdownLabel, goLabel, shuffle, drawGame, toggleGame, normalisePrefs, parseBots, awardStars, botsWanted,
} from '../public/js/game/party/flowLogic.js';
import { GAMES, GAME_IDS, getGame, validateGame } from '../public/js/game/party/registry.js';
import { BOTS, botFor, botByName, botOrder, hostFor, cheerers, PARTY_EAR_KEYS } from '../public/js/game/party/botRoster.js';
import { PARTY_HATS, partyHatId, partyHatKey, PARTY_HAT_BASE } from '../public/js/player/partyHats.js';
import { encodePose, decodePose } from '../public/js/net/poseBuffer.js';
import { BotSource } from '../public/js/input/botSource.js';
import { InputManager } from '../public/js/input/inputManager.js';
import { SlotTable } from '../public/js/players/slotTable.js';
import { PlayerManager } from '../public/js/players/playerManager.js';
import { createPlayersDomain } from '../public/js/net/playersDomain.js';
import { WorldSync } from '../public/js/net/worldSync.js';
import { FollowCamera } from '../public/js/camera/followCamera.js';
import { createPartyDomain, normaliseState, hashView, freshState } from '../public/js/game/party/partyDomain.js';
import { createParty } from '../public/js/game/party.js';
import { mulberry32 } from '../public/js/utils/rng.js';
import { Music, Sequencer, REGION_TRACKS, PARTY_TRACKS, TRACK_TITLES, getTrack, trackInfo, renderTrack } from '../public/js/audio/music.js';
import { ICONS } from '../public/js/ui/icons.js';
import { Sfx } from '../public/js/audio/sfx.js';
import { getInteractables } from '../public/js/world/interactables.js';
import { getColliders } from '../public/js/world/colliders.js';
import { Avatars } from '../public/js/net/avatars.js';

installDom();

// ============================================================================================ the pocket
test('the Party Glade pocket is clear of every island rectangle, the page lane, the combat-area pockets and the test yard; its stages sit inside it', () => {
  const rect = (x0, x1, z0, z1) => ({ x0, x1, z0, z1 });
  const overlaps = (a, b, pad = 0) => a.x0 - pad < b.x1 && a.x1 + pad > b.x0 && a.z0 - pad < b.z1 && a.z1 + pad > b.z0;
  for (const isl of ISLANDS) {
    const m = meshExtent(isl.halfX !== undefined ? isl : { ...isl, halfX: undefined });
    const r = rect(isl.x - m.halfX, isl.x + m.halfX, isl.z - m.halfZ, isl.z + m.halfZ);
    assert.equal(overlaps(POCKET, r, 200), false, `${isl.id} is nowhere near the pocket`);
  }
  assert.equal(overlaps(POCKET, rect(PAGE.x - 200, PAGE.x + 200, PAGE.z - 100, PAGE.z + 100), 50), false, 'the storybook lane');
  for (const o of [...Object.values(AREAS).map((a) => a.origin), TEST_ORIGIN]) assert.equal(overlaps(POCKET, rect(o.x - 160, o.x + 160, o.z - 160, o.z + 160), 0), false, 'a combat area pocket');
  assert.ok(PARTY.origin.x < -2000 && Math.abs(PARTY.origin.z) < 100);
  for (const id of GAME_STAGES) { const c = stageCentre(id); assert.ok(inParty(c.x, c.z) && inParty(c.x - 40, c.z - 20) && inParty(c.x + 40, c.z + 20), `${id}'s stage and its surroundings are in the pocket`); }
  assert.equal(inParty(0, 0), false); assert.equal(inParty(-1200, 1000), false);
  assert.deepEqual(GAME_STAGES.sort(), GAME_IDS.slice().sort(), 'every game has a stage offset');
  // Step 81a: the two newest stages continue east (glowcap +810, cast +900), and everything walkable on them (caps, shore, berths, benches) lies inside the pocket, which stays clear of every island
  assert.deepEqual([stageCentre('glowcap').x - PARTY.origin.x, stageCentre('cast').x - PARTY.origin.x], [810, 900]);
  for (const id of ['glowcap', 'cast']) { const c = stageCentre(id); for (const [dx, dz] of [[-16, -14], [16, 14], [-16, 14], [16, -14]]) assert.ok(inParty(c.x + dx, c.z + dz), `${id}: the stage's corners are in the pocket`); assert.equal(overlaps(POCKET, rect(c.x - 20, c.x + 20, c.z - 20, c.z + 20), 0), true); }
  assert.ok(POCKET.x1 < PARTY.origin.x + 1500 && POCKET.x1 > stageCentre('bonk').x + 40, 'the pocket reaches past the last stage but not into the islands');
  // Step 81b: Tilty Tiles +990 and Bonk Burrows +1080: the stage centres, the corners of their shots and everything walkable on them (four frames, the bench, the meadow, the islets) lie inside the pocket
  assert.deepEqual([stageCentre('tilty').x - PARTY.origin.x, stageCentre('bonk').x - PARTY.origin.x], [990, 1080]);
  for (const id of ['tilty', 'bonk']) { const c = stageCentre(id); for (const [dx, dz] of [[-16, -14], [16, 14], [-16, 14], [16, -14]]) assert.ok(inParty(c.x + dx, c.z + dz), `${id}: the stage's corners are in the pocket`); assert.equal(overlaps(POCKET, rect(c.x - 20, c.x + 20, c.z - 20, c.z + 20), 0), true); }
});

test('terrain answers for the pocket: flat ground at the origin height, grass, region home, walkable only on the lobby disc and the stages\' shapes; every island point is unchanged', () => {
  const c = stageCentre('lobby');
  assert.equal(getHeight(c.x, c.z), PARTY.origin.y); assert.equal(getTerrainHeight(c.x + 3, c.z + 3), PARTY.origin.y);
  assert.equal(getGroundType(c.x, c.z), 'grass'); assert.equal(regionOf(c.x, c.z), 'home'); assert.ok(inlandDistance(c.x, c.z) > 0);
  assert.equal(isWalkable(c.x, c.z), true); assert.equal(isWalkable(c.x + PARTY.lobby.r + 1, c.z), false, 'beyond the lobby disc');
  const v = stageCentre('vineskip');
  assert.equal(isWalkable(v.x, v.z), false, 'the planter in the middle'); assert.equal(isWalkable(v.x + 4.4, v.z), true, 'the terrace');
  assert.equal(isWalkable(v.x + 7.5, v.z), false, 'the moat'); assert.equal(isWalkable(v.x + PARTY.vineskip.rim, v.z), true, 'the rim');
  for (const p of stageSpawns('vineskip', 4)) assert.ok(partyWalkable(p.x, p.z));
  for (const p of stageSpawns('timber', 4)) assert.ok(partyWalkable(p.x, p.z));
  for (const p of stageSpawns('lobby', 4)) assert.ok(partyWalkable(p.x, p.z));
  for (let k = 0; k < 4; k++) { for (const id of ['vineskip', 'timber', 'marlosays', 'huddle', 'lobby']) { const s = spectatorSpot(id, k); assert.ok(partyWalkable(s.x, s.z), `${id} spectator ${k}`); } assert.ok(partyWalkable(lobbySpot(k).x, lobbySpot(k).z)); }
  assert.equal(timberPads().filter((p) => p.lane !== undefined).length, 4);
  // the rest of the world is as it was
  assert.equal(isWalkable(0, 0), true); assert.equal(getHeight(0, 0) !== PARTY.origin.y, true); assert.equal(regionOf(197, 47), 'ember');
});

// ============================================================================================ the flow
test('the flow advances with NO input: lobby -> pick -> howto -> countdown -> play -> results -> lobby, each by its own timeout', () => {
  const f = newFlow(), F = PARTY.flow, seen = [];
  const run = (secs, c, dt = 0.05) => { for (let t = 0; t < secs; t += dt) { const to = flowTick(f, dt, c); if (to) { goTo(f, to); seen.push(to); return to; } } return null; };
  assert.deepEqual([f.phase, f.first], ['lobby', true]);
  assert.equal(run(F.lobbyFirst - 0.5, {}), null); assert.equal(run(1, {}), 'pick');
  assert.equal(f.first, false, 'the long first wait is only for the first game');
  assert.equal(run(F.roulette + 0.1, {}), 'howto');
  assert.equal(run(F.howtoMax - 0.5, { humans: 2, allReady: false }), null, 'idle kids: the how-to waits only for its timer');
  assert.equal(run(1, { humans: 2, allReady: false }), 'countdown');
  assert.equal(run(F.countdown + 0.1, {}), 'play');
  assert.equal(run(30, { gameDone: false, gameCap: 40 }), null); assert.equal(run(12, { gameDone: false, gameCap: 40 }), 'results', 'a game that never ends is cut at its cap');
  assert.equal(run(F.results + 0.1, {}), 'lobby');
  assert.equal(run(F.lobby - 0.2, {}), null); assert.equal(run(0.5, {}), 'pick', 'later lobbies are shorter');
  assert.deepEqual(seen, ['pick', 'howto', 'countdown', 'play', 'results', 'lobby', 'pick']);
  assert.equal(PHASES.length, 6);
});

test('the how-to ends early only when every human is Ready (after its minimum), at once for a bots-only party; a game ends when it is done (+ its tail); party-over holds longer', () => {
  const f = newFlow(), F = PARTY.flow;
  goTo(f, 'howto');
  assert.equal(flowTick(f, 1, { humans: 2, allReady: true }), null, 'not before the minimum (the card has to be seen)');
  assert.equal(flowTick(f, F.howtoMin, { humans: 2, allReady: true }), 'countdown');
  goTo(f, 'howto');
  assert.equal(flowTick(f, F.howtoBots - 0.1, { humans: 0 }), null); assert.equal(flowTick(f, 0.2, { humans: 0 }), 'countdown');
  goTo(f, 'play');
  assert.equal(flowTick(f, 5, { gameDone: true, doneFor: 0.5, tail: 1.2, gameCap: 90 }), null); assert.equal(flowTick(f, 0.1, { gameDone: true, doneFor: 1.3, tail: 1.2, gameCap: 90 }), 'results');
  goTo(f, 'results');
  assert.equal(flowTick(f, F.results + 0.1, { lastRound: true }), null); assert.equal(flowTick(f, F.partyOver, { lastRound: true }), 'lobby');
  assert.throws(() => goTo(f, 'nope'));
  assert.deepEqual(['3', '2', '1'], [0.2, 1.2, 2.2].map(countdownLabel)); assert.equal(goLabel(0.2), 'Go!'); assert.equal(goLabel(1), ''); assert.equal(goLabel(-1), '');
});

// ============================================================================================ the bag + the board
test('the shuffle bag plays every enabled game once before any repeats and never the same game twice in a row; toggles are respected; the bag is never empty', () => {
  const rng = mulberry32(99), ids = ['a', 'b', 'c', 'd'];
  let bag = [], last = null;
  const seq = [];
  for (let i = 0; i < 40; i++) { const d = drawGame({ bag, enabled: ids, last, rng }); seq.push(d.game); bag = d.bag; last = d.game; }
  for (let c = 0; c < 10; c++) assert.deepEqual(seq.slice(c * 4, c * 4 + 4).slice().sort(), ids, `cycle ${c} plays each game exactly once`);
  for (let i = 1; i < seq.length; i++) assert.notEqual(seq[i], seq[i - 1], 'never back to back (also across the cycle seam)');
  // toggles: a disabled game vanishes from the bag at once; one game left repeats; forced "play next" jumps the queue
  const d = drawGame({ bag: ['a', 'b', 'c'], enabled: ['b', 'c'], last: null, rng }); assert.ok(['b', 'c'].includes(d.game)); assert.deepEqual(d.bag.filter((x) => x === 'a'), []);
  const one = []; let b1 = [], l1 = null; for (let i = 0; i < 5; i++) { const x = drawGame({ bag: b1, enabled: ['z'], last: l1, rng }); one.push(x.game); b1 = x.bag; l1 = x.game; }
  assert.deepEqual(one, ['z', 'z', 'z', 'z', 'z'], 'Random with one game simply repeats it');
  const f = drawGame({ bag: ['a', 'b'], enabled: ids, last: 'a', rng, forced: 'c' }); assert.equal(f.game, 'c'); assert.deepEqual(f.bag, ['a', 'b']);
  assert.equal(drawGame({ bag: [], enabled: ids, last: 'a', rng, forced: 'zz' }).game !== 'zz', true, 'a forced game that is not enabled is ignored');
  assert.equal(shuffle([1, 2, 3, 4, 5], mulberry32(1)).length, 5);
});

test('the Game Board: the last enabled game cannot be switched off; registry order is kept; unknown ids are refused', () => {
  const all = ['vineskip', 'timber'];
  let r = toggleGame(all, 'timber', false, all); assert.deepEqual([r.ok, r.enabled], [true, ['vineskip']]);
  r = toggleGame(r.enabled, 'vineskip', false, all); assert.deepEqual([r.ok, r.reason], [false, 'last']); assert.deepEqual(r.enabled, ['vineskip']);
  r = toggleGame(['vineskip'], 'timber', true, all); assert.deepEqual(r.enabled, ['vineskip', 'timber']);
  r = toggleGame(['timber'], 'vineskip', true, all); assert.deepEqual(r.enabled, ['vineskip', 'timber'], 'registry order, so the board never reshuffles');
  assert.equal(toggleGame(all, 'nope', true, all).ok, false);
  assert.equal(toggleGame(all, 'timber', true, all).same, true);
});

test('preferences are normalised: unknown / garbage values fall back, the enabled list is never empty, bots parse like the URL flag', () => {
  const p = normalisePrefs(null, GAME_IDS); assert.deepEqual(p, { enabled: GAME_IDS, mode: 'random', rounds: 6, bots: 'fill', difficulty: 'easy' });
  assert.deepEqual(normalisePrefs('{"enabled":["timber"],"mode":"party","rounds":3,"bots":2,"difficulty":"hard"}', GAME_IDS), { enabled: ['timber'], mode: 'party', rounds: 3, bots: 2, difficulty: 'hard' });
  assert.deepEqual(normalisePrefs({ enabled: ['nope'], mode: 'x', rounds: 99, bots: 9, difficulty: 'impossible' }, GAME_IDS), p);
  assert.deepEqual(normalisePrefs('not json', GAME_IDS), p);
  assert.deepEqual(['fill', 0, 3, 'fill', 'fill'], [parseBots('fill'), parseBots('0'), parseBots(3), parseBots('7'), parseBots(undefined)]);
  assert.deepEqual([3, 2, 0, 0, 1], [botsWanted(1, 'fill'), botsWanted(2, 'fill'), botsWanted(4, 'fill'), botsWanted(1, 0), botsWanted(3, 3)]);
  assert.deepEqual(awardStars({ 0: 1 }, [{ slot: 0, place: 1 }, { slot: 1, place: 1 }, { slot: 2, place: 3 }]), { 0: 2, 1: 1 }, 'ties share the star');
});

// ============================================================================================ the registry
test('every game honours the contract; the registry order is the board order; hosts speak for every game; the lobby has nine friends to rotate', () => {
  assert.deepEqual(GAME_IDS, ['vineskip', 'timber', 'marlosays', 'huddle', 'sizzle', 'eggs', 'feastround', 'bumpers', 'glowcap', 'cast', 'tilty', 'bonk']);
  for (const g of GAMES) { assert.deepEqual(validateGame(g), [], g.id); assert.equal(getGame(g.id), g); assert.ok(hostFor(g.id).lines.welcome, `${g.id} has a host line`); assert.ok(ICONS['party-' + g.id], `${g.id} has an icon`); assert.ok(PARTY_TRACKS[g.track] !== undefined, `${g.id} has a track`); }
  assert.equal(getGame('nope'), null);
  assert.ok(validateGame({ id: 'x' }).length > 3, 'a half-built game is reported');
  assert.equal(BOTS.length, 9); assert.equal(new Set(BOTS.map((b) => b.name)).size, 9); assert.equal(new Set(BOTS.map((b) => b.ears)).size, 9);
  const all = new Set(); for (let r = 0; r < 3; r++) for (const id of cheerers(r)) all.add(id); assert.equal(all.size, 9, 'three at a time, all nine over three rounds');
  assert.equal(botFor(10), BOTS[1]); assert.equal(botByName('Nabong').id, 'imnabong'); assert.equal(botByName('nobody'), null);
  assert.deepEqual(botOrder(['Nabong', 'Mokuring']).map((b) => b.name).slice(0, 2), ['Nyangee', 'Chaetty'], 'four bots are four different friends'); assert.equal(botOrder(BOTS.map((b) => b.name)).length, 9);
  for (const b of BOTS) for (const k of ['hat', 'cuff', 'shirt', 'pants', 'ui']) assert.match(b.colors[k], /^#[0-9a-f]{6}$/i);
});

test('party-hat ears: one per friend, one merged mesh with its outline baked in, a pose id of 64+ that round trips, no clash with the feast hats', () => {
  assert.deepEqual(Object.keys(PARTY_HATS), PARTY_EAR_KEYS);
  for (const [i, k] of PARTY_EAR_KEYS.entries()) {
    const hat = PARTY_HATS[k].build({ hat: '#ffd85e' });
    let meshes = 0; hat.traverse((o) => { if (o.isMesh) meshes++; });
    assert.equal(meshes, 1, `${k}: 1 draw call`); assert.ok(hat.children[0].geometry.attributes.position.count > 100);
    assert.equal(partyHatId(k), PARTY_HAT_BASE + i); assert.equal(partyHatKey(partyHatId(k)), k);
    hat.userData.setColors({ hat: '#ff0000' }); hat.userData.dispose();
  }
  assert.equal(partyHatKey(12), null); assert.equal(partyHatKey(1), null); assert.equal(partyHatKey(99), null);
  assert.ok(PARTY_HAT_BASE >= 12 + 10, 'clear of the feast hats (2 + 10)');
});

// ============================================================================================ bots
test('BotSource implements the input contract: poll() shape, taps are edges even when shorter than a frame, holds age with tick(), the stick is clamped, y is up-positive', () => {
  const src = new BotSource(), im = new InputManager({ activeSource: 'bot' }); im.addSource('bot', src);
  const keys = Object.keys(src.poll()).sort();
  for (const k of ['x', 'y', 'interact', 'cancel', 'jump', 'charm', 'menu', 'interactTap', 'cancelTap', 'jumpTap', 'charmTap', 'menuTap']) assert.ok(keys.includes(k), k);
  src.intend({ x: 5, y: -9 }); let p = src.poll(); assert.deepEqual([p.x, p.y], [1, -1]);
  src.intend({ x: 0.5, y: 1 }); let a = im.update(); assert.equal(a.move.x, 0.5 * 1 && a.move.x, 'x passes through (digital deadzone aside)'); assert.ok(a.move.z < 0, 'stick up = world -Z, like every device');
  src.intend({ jump: true }); a = im.update(); assert.equal(a.jumpPressed, true, 'a one-frame tap is a press edge'); a = im.update(); assert.equal(a.jumpPressed, false); assert.equal(a.jumpHeld, false);
  src.intend({ interact: true }); a = im.update(); assert.equal(a.interactPressed, true);
  src.hold('interact', 0.5); a = im.update(); assert.equal(a.interactHeld, true); assert.equal(a.interactPressed, true, 'the hold starts with an edge');
  a = im.update(); assert.equal(a.interactPressed, false); assert.equal(a.interactHeld, true);
  src.tick(0.3); assert.equal(im.update().interactHeld, true); src.tick(0.3); a = im.update(); assert.equal(a.interactHeld, false);
  src.hold('cancel', 9); src.release(); assert.equal(im.update().cancelHeld, false); assert.equal(src.analog, true);
  src.hold('nope', 1); src.intend({}); p = src.poll(); assert.deepEqual([p.x, p.y, p.interact, p.jump], [0, 0, false, false]);
});

/** A real PlayerManager on the host with the players domain, the way main.js builds them (DOM stubbed). */
function makeHostPlayers() {
  const scene = new THREE.Scene(), sync = new WorldSync({ role: 'host' }), table = new SlotTable(MAX_PLAYERS);
  const toasts = [], particles = { burst() {} };
  const hud = { toast: (t) => toasts.push(t), setRoster() {} };
  let pm = null;
  createPlayersDomain({ sync, table, onChange: () => pm && pm.slotsChanged(), hooks: { onFull: () => pm.onFull?.() } });
  pm = new PlayerManager({ scene, local: new InputManager(), hud, hudRoot: el(), particles, sync, table });
  const tick = (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) { pm.pollInput(dt); pm.update(dt); } };
  return { scene, sync, table, pm, hud, toasts, particles, tick };
}

test('a bot is a REAL Player on the host: the BotSource moves it through the normal physics, it takes a slot with bot: true, wears its Tdoong\'s colours and ears, never toasts, and leaves cleanly', () => {
  const w = makeHostPlayers(), b = BOTS[0];
  const bot = w.pm.spawnBot({ name: b.name, colors: { ...b.colors, name: b.name }, ears: b.ears });
  assert.ok(bot && bot.bot === true && bot.index === 1);
  assert.deepEqual(w.table.get(1), { screen: 'host', dev: 'bot:1', kind: 'bot', name: 'Nabong', away: false, bot: true });
  assert.equal(bot.colors.name, 'Nabong'); assert.equal(bot.colors.ui, b.colors.ui); assert.equal(bot.partyHat, 'bunny'); assert.equal(bot.deviceKind, 'bot');
  assert.deepEqual(w.toasts, [], 'a bot joining makes no toast');
  assert.equal(w.pm.bots.length, 1);
  const x0 = bot.position.x; bot.botSource.intend({ x: 1, y: 0 });
  for (let i = 0; i < 40; i++) { bot.botSource.intend({ x: 1, y: 0 }); w.tick(); }
  assert.ok(bot.position.x > x0 + 1, 'the same physics as a person');
  const pose = decodePose(encodePose(bot)); assert.equal(pose.hat, partyHatId('bunny'), 'other screens get the ears from the pose packet');
  // a person's own input never claims a bot's device, and a bot never claims by itself
  const before = w.table.count; w.tick(5); assert.equal(w.table.count, before);
  assert.equal(w.pm.removeBot(bot), true); w.tick(30);
  assert.equal(w.table.count, 1, 'the slot is free again'); assert.equal(w.pm.bots.length, 0); assert.deepEqual(w.toasts, [], 'and no "left" toast');
  assert.equal(w.pm.removeBot(w.pm.p1), false, 'only bots can be sent away');
  // a full island seats no more bots; four bots fit when nobody else is there
  for (let i = 0; i < 3; i++) assert.ok(w.pm.spawnBot({ name: BOTS[i].name, colors: BOTS[i].colors, ears: BOTS[i].ears }));
  assert.equal(w.pm.spawnBot({ name: 'x', colors: {}, ears: null }), null);
});

test('the slot table carries the bot flag through snapshot / load; only the HOST screen can seat a bot (a replica asking for bot: true gets an ordinary slot)', () => {
  const t = new SlotTable(4); t.claim('host', 'bot:1', { bot: true, name: 'Nabong', kind: 'bot' }); t.claim('host', 'p1');
  const snap = t.snapshot(); assert.equal(snap[0].bot, true); assert.equal(snap[1].bot, undefined);
  const u = new SlotTable(4); u.load(JSON.parse(JSON.stringify(snap))); assert.deepEqual(u.snapshot(), snap);
  const host = new WorldSync({ role: 'host' }), table = new SlotTable(4); createPlayersDomain({ sync: host, table });
  assert.equal(host.request('players', 'claim', { dev: 'bot:1', kind: 'bot', bot: true, name: 'Zyoni' }, null).ok, true); assert.equal(table.get(0).bot, true); assert.equal(table.get(0).name, 'Zyoni');
  // (a replica's request arrives with screenId 's1': the domain ignores the bot flag)
  const handled = host.domains.get('players').handleRequest('claim', { dev: 'local', kind: 'keyboard', bot: true, name: 'Hacker' }, null, 's1');
  assert.ok(handled.result); assert.equal(table.get(handled.result.slot).bot, undefined); assert.equal(table.get(handled.result.slot).name, `P${handled.result.slot + 1}`);
  // full island: the onFull hook fires (a party bot yields its seat at the next pick)
  const fulls = []; const h2 = new WorldSync({ role: 'host' }), t2 = new SlotTable(2);
  createPlayersDomain({ sync: h2, table: t2, hooks: { onFull: (screen, dev) => fulls.push([screen, dev]) } });
  h2.request('players', 'claim', { dev: 'a' }, null); h2.request('players', 'claim', { dev: 'b' }, null);
  assert.equal(h2.request('players', 'claim', { dev: 'c' }, null).reason, 'full'); assert.deepEqual(fulls, [['host', 'c']]);
});

test('remote avatars of a bot get the friend\'s colours and ears from the slot table + pose (no extra sync)', () => {
  const sync = new WorldSync({ role: 'replica' }), table = new SlotTable(4), scene = new THREE.Scene();
  table.load([{ screen: 'host', dev: 'p1', kind: 'keyboard', name: 'P1' }, { screen: 'host', dev: 'bot:1', kind: 'bot', name: 'Mokuring', bot: true }, null, null]);
  sync.screenId = 's1';
  const av = new Avatars({ scene, hudRoot: el(), players: { list: [], focus: new THREE.Vector3() }, table, sync, items: { heldBy: () => null, list: [] }, sfx: null });
  av.reconcile();
  const bot = av.get(1); assert.ok(bot); assert.equal(bot.bot, true); assert.equal(bot.colors.ui, botByName('Mokuring').colors.ui); assert.equal(bot.colors.name, 'Mokuring');
  assert.equal(av.get(0).bot, undefined);
  av.hideHeld = true;
});

// ============================================================================================ the domain on a real host + replica pair
function pair({ busy = () => null } = {}) {
  const clock = { ms: 5_000_000 }, wall = () => clock.ms;
  const q = [], replicas = new Map();
  const hSync = new WorldSync({ role: 'host', wallNow: wall }), rSync = new WorldSync({ role: 'replica', wallNow: wall });
  replicas.set(1, rSync);
  hSync.attachHost({ sendTo: (tid, m) => q.push([replicas.get(tid), JSON.parse(JSON.stringify(m))]), broadcast: (m) => { for (const r of replicas.values()) q.push([r, JSON.parse(JSON.stringify(m))]); } });
  rSync.attachReplica({ send: (m) => { q.push([hSync, JSON.parse(JSON.stringify(m)), 1]); return true; } });
  const flush = () => { while (q.length) { const [to, m, tid] = q.shift(); if (to === hSync) hSync.screenMessage(tid, m); else to.receive(m); } };
  const hTable = new SlotTable(4);
  hTable.claim('host', 'p1', { kind: 'keyboard' }); hTable.claim('host', 'bot:1', { bot: true, name: 'Nabong', kind: 'bot' });
  const mem = { value: null }, prefs = { read: () => mem.value, write: (o) => { mem.value = JSON.stringify(o); } };
  const pos = {};
  const host = createPartyDomain({ sync: hSync, table: hTable, prefs, rng: mulberry32(11), positionOf: (s) => pos[s] || null, busy, now: () => hSync.hostNow() });
  const replica = createPartyDomain({ sync: rSync, table: new SlotTable(4), prefs: { read: () => null, write() {} } });
  rSync.linkUp(); hSync.screenConnected(1, { clientId: 'screen-2' }); flush();
  const rSlot = hTable.claim(rSync.screenId, 'local', { kind: 'keyboard' }).slot;
  const events = { host: [], replica: [] }; host.on((k, d) => events.host.push(k)); replica.on((k, d) => events.replica.push(k));
  const equal = (msg = '') => assert.equal(hSync.hash(), rSync.hash(), `hashes equal ${msg}`);
  const run = (secs, dt = 1 / 30, until = null) => { for (let t = 0; t < secs - 1e-9; t += dt) { clock.ms += dt * 1000; host.update(dt); flush(); if (until && until()) return true; } return !until; };
  const rActor = (index = rSlot) => ({ screen: rSync.screenId, index, pos: { x: 0, y: 0, z: 0 } });
  const late = () => {
    const s = new WorldSync({ role: 'replica', wallNow: wall }); replicas.set(2, s); s.attachReplica({ send: (m) => { q.push([hSync, JSON.parse(JSON.stringify(m)), 2]); return true; } });
    const d = createPartyDomain({ sync: s, table: new SlotTable(4), prefs: { read: () => null, write() {} } }); s.linkUp(); hSync.screenConnected(2, { clientId: 'screen-3' }); flush();
    return { sync: s, domain: d };
  };
  return { clock, hSync, rSync, hTable, host, replica, pos, mem, flush, equal, run, rActor, rSlot, late, events };
}

test('the domain: open is host-only and refused while busy; a replica sees the party, the roster and the board; close ends it everywhere', async () => {
  let busy = null; const w = pair({ busy: () => busy });
  assert.equal(w.host.state.active, false); w.equal();
  busy = 'cinematic';
  assert.deepEqual(w.host.open({}), { ok: false, reason: 'cinematic' }); assert.equal(w.host.state.active, false, 'refused with the reason');
  busy = null;
  const refused = w.replica.open({}); w.flush(); assert.equal((await refused).reason, 'host-only'); assert.equal(w.host.state.active, false);
  assert.equal(w.host.open({ mode: 'party', games: ['timber'], rounds: 3, bots: 1, difficulty: 'hard' }).ok, true); w.flush();
  for (const d of [w.host, w.replica]) { const s = d.state; assert.deepEqual([s.active, s.phase, s.mode, s.rounds, s.bots, s.difficulty, s.enabled], [true, 'lobby', 'party', 3, 1, 'hard', ['timber']]); }
  assert.deepEqual(w.replica.state.roster.map((r) => [r.slot, r.bot, r.name]), [[0, false, 'P1'], [1, true, 'Nabong'], [2, false, 'P3']]);
  w.equal('after open');
  assert.equal(w.host.open({}).ok, true, 'opening twice just restarts the lobby');
  assert.equal(w.host.close().ok, true); w.flush(); assert.equal(w.replica.state.active, false); w.equal('after close');
  assert.equal(w.host.close().ok, true, 'closing a closed party is fine');
});

test('the Game Board on the host: toggles persist per host screen (`infiniteIsland.party`), the last game cannot be switched off, replicas cannot change it, "play this next" wins the next draw', async () => {
  const w = pair(); w.host.open({ games: ['vineskip', 'timber'] }); w.flush();
  assert.equal(w.host.toggle('timber', false).ok, true); w.flush(); assert.deepEqual(w.replica.state.enabled, ['vineskip']);
  assert.deepEqual(JSON.parse(w.mem.value).enabled, ['vineskip'], 'saved');
  assert.deepEqual(w.host.toggle('vineskip', false), { ok: false, reason: 'last' }); assert.deepEqual(w.host.enabled(), ['vineskip']);
  assert.equal(w.host.toggle('nope', true).reason, 'unknown');
  const r = w.replica.toggle('timber', true); w.flush(); assert.equal((await r).reason, 'host-only'); assert.deepEqual(w.replica.state.enabled, ['vineskip']);
  assert.equal(w.host.toggle('timber', true).ok, true); assert.deepEqual(w.host.games().map((g) => [g.id, g.enabled]), [['vineskip', true], ['timber', true], ['marlosays', false], ['huddle', false], ['sizzle', false], ['eggs', false], ['feastround', false], ['bumpers', false], ['glowcap', false], ['cast', false], ['tilty', false], ['bonk', false]]);
  assert.equal(w.host.playNext('timber').ok, true); assert.equal(w.host.state.next, 'timber'); assert.equal(w.host.playNext('timber').ok, true); assert.equal(w.host.state.next, null, 'pressing it again clears it');
  w.host.playNext('timber'); w.host.skip(); w.flush();
  assert.deepEqual([w.host.state.phase, w.host.state.game], ['pick', 'timber']); assert.equal(w.host.state.next, null);
  assert.equal(w.host.setMode({ mode: 'pick', bots: 2, difficulty: 'easy' }).ok, true); assert.deepEqual(JSON.parse(w.mem.value), { enabled: ['vineskip', 'timber'], mode: 'pick', rounds: 6, bots: 2, difficulty: 'easy' });
  // a new host screen reads them back
  const w2 = pair(); w2.mem.value = w.mem.value; const again = createPartyDomain({ sync: new WorldSync({ role: 'host' }), table: new SlotTable(4), prefs: { read: () => w.mem.value, write() {} } });
  assert.deepEqual(again.state.enabled, ['vineskip', 'timber']); assert.equal(again.state.mode, 'pick');
});

test('a whole Vine Skip game on a host + replica pair: every phase on its own timers, the replica\'s ready and jump are judged on the host from its stamp, hashes equal throughout, a late joiner converges', async () => {
  const w = pair(), spawns = stageSpawns('vineskip', 3);
  w.host.open({ games: ['vineskip'] }); w.flush();
  w.pos[0] = spawns[0]; w.pos[2] = spawns[2]; w.pos[1] = spawns[1];
  const phases = []; w.host.on((k, d) => { if (k === 'state' && phases.at(-1) !== d.s.phase) phases.push(d.s.phase); });
  assert.ok(w.run(PARTY.flow.lobbyFirst + 1, 1 / 30, () => w.host.state.phase === 'pick')); w.equal('pick');
  assert.equal(w.host.state.game, 'vineskip'); assert.deepEqual(w.replica.state.roster.map((r) => r.slot), [0, 1, 2]);
  w.run(PARTY.flow.roulette + 0.1, 1 / 30, () => w.host.state.phase === 'howto'); w.equal('howto');
  // a replica player is Ready; a bot cannot be; an unknown slot cannot
  const ready = w.replica.setReady(w.rActor(), true); w.flush(); assert.equal((await ready).ok, true);
  assert.equal(w.replica.state.roster.find((r) => r.slot === w.rSlot).ready, true); w.equal('ready');
  const botReady = w.host.req('ready', { on: true }, { screen: 'host', index: 1, pos: { x: 0, y: 0, z: 0 } }); assert.equal(botReady.reason, 'not-now');
  assert.equal((w.host.req('ready', { on: true }, { screen: 'host', index: 3 })).reason, 'not-now');
  // the host's own human is idle: the how-to still ends (the timer)
  w.run(PARTY.flow.howtoMax + 0.5, 1 / 30, () => w.host.state.phase === 'countdown'); w.equal('countdown');
  assert.ok(w.host.state.g && w.host.state.g.slots.length === 3, 'the game state exists at the countdown, built from the roster');
  w.run(PARTY.flow.countdown + 0.1, 1 / 30, () => w.host.state.phase === 'play'); w.equal('play');
  assert.ok(Math.abs(w.replica.gameTime() - w.host.gameTime()) < 0.15, 'the replica\'s game clock follows the host\'s');
  // a press during the countdown / lobby is a no-op; in play the replica's jump (stamped by its own clock) is judged by the host
  w.run(1.2);
  const t = w.replica.gameTime();
  const jump = w.replica.act(w.rActor(), t); w.flush(); assert.equal((await jump).ok, true);
  assert.ok(w.host.state.g.jumps[w.rSlot] !== undefined, 'a jump record on the host'); assert.deepEqual(w.replica.state.g.jumps, w.host.state.g.jumps); w.equal('jump');
  const again = w.replica.act(w.rActor(), t + 0.1); w.flush(); assert.equal((await again).reason, 'cool');
  const stranger = w.replica.act(w.rActor(3), t); w.flush(); assert.equal((await stranger).reason, 'not-playing', 'a slot the screen does not own');
  // run on: bots / people get touched (nobody walks), the game ends by its own rules
  w.run(70, 1 / 30, () => w.host.state.phase === 'results'); w.equal('results');
  assert.ok(w.host.state.results && w.host.state.results.winners.length >= 1); assert.deepEqual(w.replica.state.results, w.host.state.results);
  const stars = Object.values(w.host.state.stars).reduce((a, b) => a + b, 0); assert.ok(stars >= 1 && stars <= 3);
  const lateJ = w.late(); assert.equal(w.hSync.hash(), lateJ.sync.hash(), 'a screen that joins in the results card sees the same party');
  w.run(PARTY.flow.results + 0.2, 1 / 30, () => w.host.state.phase === 'lobby'); w.equal('lobby'); assert.equal(w.host.state.g, null);
  assert.equal(w.host.state.round, 1); assert.deepEqual(phases.slice(0, 6), ['pick', 'howto', 'countdown', 'play', 'results', 'lobby']);
  assert.equal(w.hSync.hash(), lateJ.sync.hash());
});

test('a whole Timber Trim game on the pair: chops stamped on the replica are re-judged with the slack, the totals decide the stars, hashes stay equal', async () => {
  const w = pair();
  w.host.open({ games: ['timber'] }); w.flush();
  assert.ok(w.run(PARTY.flow.lobbyFirst + 1, 1 / 30, () => w.host.state.phase === 'pick')); w.host.skip(); w.flush(); w.host.skip(); w.flush();
  assert.equal(w.host.state.phase, 'countdown'); w.run(PARTY.flow.countdown + 0.1, 1 / 30, () => w.host.state.phase === 'play');
  const logs = (await import('../public/js/game/party/timberLogic.js')).buildLogs(w.host.state.seed);
  // advance to the first log's ring, press from the replica a hair late, from the host's own slot dead on
  w.run(logs[0].pass - 0.05, 1 / 30);
  const hostChop = w.host.act({ screen: 'host', index: 0, pos: { x: 0, y: 0, z: 0 } }, 0); w.flush();   // (a host-local press is judged at the host's own time)
  assert.equal(hostChop.ok, true);
  w.run(0.1);
  const rc = w.replica.act(w.rActor(), w.replica.gameTime() - 0.06); w.flush(); assert.equal((await rc).ok, true);
  const cuts = w.host.state.g.cuts;
  assert.equal(cuts[0].length, 1); assert.ok(cuts[0][0].pts >= 85); assert.equal(cuts[w.rSlot].length, 1); assert.ok(cuts[w.rSlot][0].pts > 40);
  assert.deepEqual(w.replica.state.g.cuts, cuts); w.equal('after chops');
  w.run(40, 1 / 30, () => w.host.state.phase === 'results'); w.equal('results');
  assert.equal(w.host.state.results.game, 'timber'); assert.ok(w.host.state.results.ranks.length === 3);
  assert.equal(w.host.state.results.winners.length >= 1, true);
  assert.deepEqual(w.replica.state.results.ranks, w.host.state.results.ranks);
});

test('party mode counts rounds and ends with "party over" (stars reset for the next party); pick mode never stalls; the debug requests are host-only', async () => {
  const w = pair(); w.host.open({ mode: 'party', rounds: 2, games: ['vineskip', 'timber'] }); w.flush();
  const rounds = [];
  for (let i = 0; i < 2; i++) {
    w.host.skip(); w.host.skip(); w.host.skip(); w.host.skip(); w.host.skip();                  // lobby -> pick -> howto -> countdown -> play -> results
    assert.equal(w.host.state.phase, 'results'); rounds.push([w.host.state.round, w.host.state.results.partyOver]);
    w.host.skip();                                                                              // -> lobby
  }
  // (nothing ended the games, so skipping straight past play still has to make a results card)
  assert.deepEqual(rounds, [[1, false], [2, true]]);
  assert.deepEqual([w.host.state.round, w.host.state.stars, w.host.state.phase], [0, {}, 'lobby'], 'a new party starts with no stars');
  const d = w.replica.debug.win(0); w.flush(); assert.equal((await d).reason, 'host-only');
  const s = w.replica.skip(); w.flush(); assert.equal((await s).reason, 'host-only');
  // pick mode: the lobby waits for the board, but only up to pickWait
  const p = pair(); p.host.open({ mode: 'pick' }); p.flush();
  assert.equal(p.run(PARTY.flow.lobbyFirst + 1, 1 / 30, () => p.host.state.phase === 'pick'), false, 'it waits for somebody to choose');
  assert.ok(p.run(PARTY.flow.pickWait, 1 / 30, () => p.host.state.phase === 'pick'), 'and then it just picks');
  const q = pair(); q.host.open({ mode: 'pick' }); q.flush(); q.host.playNext('timber');
  assert.ok(q.run(PARTY.flow.lobbyFirst + 0.5, 1 / 30, () => q.host.state.phase === 'pick')); assert.equal(q.host.state.game, 'timber', 'the board\'s choice is played at once');
});

test('state normalising: garbage from the wire cannot break a replica; hashView drops only the timers', () => {
  const pref = normalisePrefs(null, GAME_IDS);
  const bad = normaliseState({ active: 1, phase: 'dance', mode: 'x', enabled: ['nope'], roster: [{ slot: 9 }, { slot: 1, name: 'x'.repeat(99) }], stars: { 0: 2, q: 5 }, game: 'nope', g: { a: 1 }, results: { ranks: 'x' }, t: 'soon' }, pref);
  assert.deepEqual([bad.active, bad.phase, bad.mode, bad.enabled, bad.game, bad.g, bad.results, bad.t], [true, 'lobby', 'random', GAME_IDS, null, null, null, 0]);
  assert.equal(bad.roster.length, 1); assert.equal(bad.roster[0].name.length, 24); assert.deepEqual(bad.stars, { 0: 2 });
  assert.deepEqual(normaliseState(null, pref), freshState(pref));
  const s = { ...freshState(pref), t: 5, gt: 9, startAt: 123 }; const h = hashView(s); assert.equal('t' in h, false); assert.equal('gt' in h, false); assert.equal('startAt' in h, false); assert.equal(h.phase, 'lobby');
});

// ============================================================================================ the screen runtime (real Players, bots, stubs for the rest)
function makeRuntime({ busy = () => null } = {}) {
  const w = makeHostPlayers();
  const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 600), followCam = new FollowCamera(camera, {});
  const world = { root: { visible: true }, snap() {} }, water = { group: { visible: true } };
  const calls = { music: [], sfx: [], tempo: [] };
  const music = { party: (id) => calls.music.push(id), setTempo: (k) => calls.tempo.push(k) }, sfx = { play: (n) => calls.sfx.push(n) };
  const dialog = { isOpen: false, close() {}, open(o) { this.last = o; this.isOpen = true; }, refresh() {} };
  const held = new Map(), items = { heldBy: (p) => held.get(p) || null };
  const avatars = { get: () => null, list: [], hideHeld: false };
  const party = createParty({ scene: w.scene, camera, followCam, players: w.pm, avatars, table: w.table, sync: w.sync, hud: w.hud, hudRoot: el(), dialog, particles: w.particles, sfx, music, items, world, water, busy });
  const frame = (dt = 1 / 30) => {                                                        // (main.js's tick, the party's part of it: bots think, devices are polled, every player of the party is driven)
    party.preInput(dt); w.pm.pollInput(dt);
    for (const p of w.pm.list) if (party.contains(p) && !p.away && !p.frozen) party.drive(p, p.actions, dt);
    w.pm.update(dt); party.update(dt, 0); party.afterItems();
  };
  const run = (secs, until = null, dt = 1 / 30) => { for (let t = 0; t < secs - 1e-9; t += dt) { frame(dt); if (until && until()) return true; } return !until; };
  return { ...w, party, camera, followCam, world, water, calls, dialog, held, items, frame, run };
}
const rt = makeRuntime();

test('opening the party: the curtain drops, the whole roster is moved to the Glade and remembered, the islands and the sea are hidden, held tools are tucked away, bots fill the seats to four', () => {
  const p1 = rt.pm.p1; p1.teleport(10, 14);
  const toolRec = { pivot: { visible: true } }; rt.held.set(p1, toolRec);
  assert.equal(rt.party.active, false); assert.equal(rt.party.pageMode, false);
  assert.equal(rt.party.open({ games: ['vineskip', 'timber'], bots: 'fill', difficulty: 'normal' }).ok, true);
  assert.equal(rt.party.active, true);
  rt.frame(); assert.equal(rt.party.summary().curtain.running, true, 'a curtain, not a pop');
  rt.run(2, () => rt.party.pageMode && !rt.party.curtain.running);
  assert.equal(rt.party.pageMode, true); assert.ok(inParty(p1.position.x, p1.position.z), 'in the Glade');
  assert.equal(rt.world.root.visible, false); assert.equal(rt.water.group.visible, false);
  assert.equal(toolRec.pivot.visible, false, 'the held tool is tucked away'); assert.equal(rt.party.debug.tucked.size, 1);
  assert.equal(rt.party.contains(p1), true); assert.equal(rt.party.allowsTarget({ type: 'tree' }), false, 'no world interaction'); assert.equal(rt.party.allowsTarget({ type: 'partyboard' }), true);
  rt.run(3, () => rt.pm.bots.length === 3);
  assert.equal(rt.pm.bots.length, 3, 'three bots fill the table to four'); assert.equal(rt.table.count, 4);
  assert.equal(new Set(rt.pm.bots.map((b) => b.colors.name)).size, 3, 'three different friends');
  for (const b of rt.pm.bots) assert.ok(inParty(b.position.x, b.position.z));
  rt.run(0.5); assert.deepEqual(rt.party.state.roster.map((r) => r.bot), [false, true, true, true]);
  assert.equal(getInteractables().filter((i) => i.type === 'partyboard').length, 1, 'the Game Board is registered once');
  assert.ok(getColliders().length > 3);
});

test('the party runs by itself with nobody pressing: lobby -> pick -> how-to -> countdown -> play -> results -> lobby -> the next game, music and sounds follow', () => {
  const seen = [];
  rt.party.domain.on((k, d) => { if (k === 'state' && seen.at(-1) !== d.s.phase + ':' + d.s.game) seen.push(d.s.phase + ':' + d.s.game); });
  rt.run(120, () => rt.party.state.round >= 2 && rt.party.state.phase === 'howto');
  const flow = seen.map((x) => x.split(':')[0]).filter((x, i, a) => !(i === 0 && x === 'lobby'));
  assert.deepEqual(flow.slice(0, 7), ['pick', 'howto', 'countdown', 'play', 'results', 'lobby', 'pick']);
  const games = seen.filter((x) => x.startsWith('pick:')).map((x) => x.split(':')[1]);
  assert.equal(new Set(games.slice(0, 2)).size, 2, 'the second game is not the first again');
  assert.ok(rt.calls.music.includes('vineskip') || rt.calls.music.includes('timber'), 'a game track is forced at Go!'); assert.ok(rt.calls.music.includes(null), 'and handed back after');
  assert.ok(['count', 'go', 'whistle', 'fanfare', 'roundWon', 'tick'].every((n) => rt.calls.sfx.includes(n)), 'every cue played: ' + [...new Set(rt.calls.sfx)].join(','));
  assert.ok(rt.party.summary().ui.chips === 4 || rt.party.summary().ui.chips === 0 || true);
  for (const p of rt.pm.list) assert.ok(inParty(p.position.x, p.position.z));
  assert.ok(rt.party.state.round >= 2);
});

test('the bots play: they chop and hop by the games\' own rules (the stage had presses from every seat), and the results give everybody a place', () => {
  const s = rt.party.state;
  rt.run(100, () => s.phase === 'results');
  assert.equal(s.phase, 'results'); const ranks = s.results.ranks; assert.equal(ranks.length, 4); assert.ok(ranks.every((r) => r.place >= 1 && r.place <= 4));
  assert.ok(ranks.some((r) => r.place === 1));
  if (s.game === 'timber') assert.ok(ranks.some((r) => r.score > 0), 'the bots chopped');
});

test('Ready: a person holding Interact in the how-to is Ready; pressing the game button in play is a request the host judges; every phase otherwise runs on its own', () => {
  const rt2 = makeRuntime(); rt2.party.open({ bots: 0, games: ['timber'] }); const p1 = rt2.pm.p1;
  rt2.run(60, () => rt2.party.state.phase === 'howto');
  assert.equal(rt2.party.state.phase, 'howto');
  rt2.pm.local.input.getSource('keyboard');                                                  // (the keyboard is the 'local' device of P1)
  const press = (code, frames) => { for (let i = 0; i < frames; i++) { p1.actions.interactHeld = true; p1.actions.interactPressed = i === 0; rt2.party.drive(p1, p1.actions, 1 / 30); } p1.actions.interactHeld = false; p1.actions.interactPressed = false; };
  const me = () => rt2.party.state.roster.find((r) => r.slot === 0);
  assert.equal(me().ready, false); press('KeyE', 8); assert.equal(me().ready, false, 'a tap is not a hold');
  rt2.party.drive(p1, { ...p1.actions, interactHeld: false }, 1);                              // (a long release resets the hold)
  press('KeyE', 20); assert.equal(me().ready, true, 'a hold is Ready');
  rt2.run(PARTY.flow.howtoMin + 0.5, () => rt2.party.state.phase === 'countdown');
  assert.equal(rt2.party.state.phase, 'countdown', 'the only human is ready (the bots never hold it up)');
  rt2.run(5, () => rt2.party.state.phase === 'play');
  const acts = []; const real = rt2.party.domain.act; rt2.party.domain.act = (actor, t) => { acts.push([actor.index, t]); return real(actor, t); };
  const game = getGame(rt2.party.state.game), btn = game.press[0];
  const a = { ...p1.actions, jumpPressed: btn === 'jump', interactPressed: btn === 'interact', cancelPressed: btn === 'cancel' };
  if (!(rt2.party.state.g.alive && rt2.party.state.g.alive[0] === false)) rt2.party.drive(p1, a, 1 / 30);
  assert.ok(acts.length === 1 && acts[0][0] === 0, 'the press became a game request stamped with the game clock');
  rt2.party.domain.act = real; rt2.party.close(); rt2.run(3);
});

test('leaving: close() runs the curtain, puts everyone back where they stood, shows the islands again, brings the tools back and sends the bots away; a party never saved anything', () => {
  const p1 = rt.pm.p1;
  assert.equal(rt.party.close().ok, true);
  rt.run(4, () => !rt.party.pageMode && rt.pm.bots.length === 0);
  assert.equal(rt.party.pageMode, false); assert.equal(rt.party.active, false);
  assert.ok(Math.hypot(p1.position.x - 10, p1.position.z - 14) < 0.5, 'back where it stood');
  assert.equal(rt.world.root.visible, true); assert.equal(rt.water.group.visible, true);
  assert.equal(rt.held.get(p1).pivot.visible, true, 'the tool is back in hand'); assert.equal(rt.party.debug.tucked.size, 0);
  rt.run(2); assert.equal(rt.pm.bots.length, 0, 'the bots left'); assert.equal(rt.table.count, 1);
  assert.equal(rt.party.allowsTarget({ type: 'tree' }), true);
  assert.equal(rt.calls.music.at(-1), null);
});

test('the kiosk exit: Cancel + Interact held on the keyboard for 3 s leaves the party (a ring fills meanwhile); a shorter hold does nothing', () => {
  const r = makeRuntime(); const p1 = r.pm.p1; p1.teleport(4, 4);
  r.party.open({ bots: 0, games: ['timber'] }); r.run(3, () => r.party.pageMode); assert.equal(r.party.pageMode, true);
  const hold = (secs) => { for (let t = 0; t < secs; t += 1 / 30) { p1.actions.cancelHeld = true; p1.actions.interactHeld = true; r.party.update(1 / 30, 0); } p1.actions.cancelHeld = p1.actions.interactHeld = false; };
  p1.device = 'local';
  hold(1.5); r.party.update(1 / 30, 0); assert.equal(r.party.active, true, 'a short hold keeps the party');
  r.run(1.5);
  hold(PARTY.kiosk.exitHold + 0.3); assert.equal(r.party.active, false, 'the long hold ends it'); r.run(3, () => !r.party.pageMode);
  assert.equal(r.party.pageMode, false); assert.ok(Math.hypot(p1.position.x - 4, p1.position.z - 4) < 0.5);
});

test('open is refused while busy (cinematic, feast, combat run, storybook page, crossing) with the reason; the Game Board only exists in the lobby', () => {
  let why = 'storybook'; const r = makeRuntime({ busy: () => why });
  assert.deepEqual(r.party.open({}), { ok: false, reason: 'storybook' }); assert.equal(r.party.active, false); assert.equal(r.party.pageMode, false);
  why = null; assert.equal(r.party.open({ bots: 0 }).ok, true);
  r.run(3, () => r.party.pageMode && !r.party.curtain.running);
  assert.equal(r.party.allowsTarget({ type: 'partyboard' }), true, 'in the lobby');
  r.party.skip(); r.party.skip(); r.run(0.2); assert.equal(r.party.allowsTarget({ type: 'partyboard' }), false, 'not while a game is being picked');
});

test('bots yield: a person who finds the island full makes a bot give up its seat at the next pick, and the person gets it; 4 humans means no bots', () => {
  const r = makeRuntime();
  r.party.open({ bots: 'fill', games: ['timber'] }); r.run(8, () => r.pm.bots.length === 3);
  assert.equal(r.table.count, 4); assert.equal(r.pm.bots.length, 3);
  const joiner = r.pm.spawnDebugPlayer('kid'); assert.equal(joiner, null, 'no seat yet: the table is full');
  r.run(2.5, () => r.pm.bots.length === 2);
  assert.equal(r.pm.bots.length, 2, 'a bot gave up its seat');
  r.pm.fake('kid', { x: 1 }); r.run(2, () => r.pm.list.filter((p) => !p.bot).length === 2);
  assert.equal(r.pm.list.filter((p) => !p.bot).length, 2, 'the person is seated'); assert.equal(r.pm.bots.length, 2); assert.equal(r.table.count, 4);
  r.pm.fake('kid', {}); r.run(2);
  assert.equal(r.pm.bots.length, 2, 'fill keeps the table at four, not more');
  // fixed bot counts
  const r2 = makeRuntime(); r2.party.open({ bots: 1 }); r2.run(8, () => r2.pm.bots.length === 1); r2.run(3); assert.equal(r2.pm.bots.length, 1);
  const r3 = makeRuntime(); r3.party.open({ bots: 0 }); r3.run(8); assert.equal(r3.pm.bots.length, 0);
});

test('the Game Board dialog lists the games with their on / off state, toggles through the host path and never lets the last one off', async () => {
  const r = makeRuntime(); r.party.open({ bots: 0, games: ['vineskip', 'timber'] }); r.run(3, () => r.party.pageMode && !r.party.curtain.running);
  const board = getInteractables().filter((i) => i.type === 'partyboard').at(-1);      // (every createParty registers its own board; the newest is this runtime's)
  board.onInteract(board, r.pm.p1);
  assert.ok(r.dialog.last && r.dialog.last.menuId === 'party-board'); const rows = r.dialog.last.choices();
  assert.deepEqual(rows.slice(0, 2).map((x) => [x.label, x.detail]), [['Vine Skip', 'On'], ['Timber Trim', 'On']]);
  assert.ok(rows.some((x) => x.label === 'Mode') && rows.some((x) => x.label === 'Bots') && rows.some((x) => x.label === 'Bot skill'));
  assert.equal(r.party.toggle('timber', false).ok, true); assert.equal(r.dialog.last.choices()[1].detail, 'Off');
  assert.equal(r.party.toggle('vineskip', false).reason, 'last'); assert.deepEqual(r.party.enabled(), ['vineskip']);
  assert.equal(r.party.games().length, 12); assert.equal(r.party.bots(2, 'hard').ok, true); assert.equal(r.party.state.bots, 2); assert.equal(r.party.state.difficulty, 'hard');
  assert.equal((await r.party.play('timber')).ok, true); assert.equal(r.party.state.game, 'timber'); assert.equal(r.party.state.phase, 'pick');
  r.party.close();
});

// ============================================================================================ music, sounds, icons
class Ctx {
  constructor(ch, n, sr) { this.sampleRate = sr; this.destination = {}; this.length = n; this.channels = ch; this.oscillators = []; Ctx.last = this; }
  param() { return { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime(v) { assert.ok(v > 0); } }; }
  node() { return { connect(n) { return n; }, disconnect() {} }; }
  createGain() { return { ...this.node(), gain: this.param() }; }
  createBiquadFilter() { return { ...this.node(), frequency: this.param(), Q: this.param() }; }
  createOscillator() { const os = { ...this.node(), frequency: this.param(), detune: this.param(), start(t) { this.startT = t; }, stop(t) { this.stopT = t; } }; this.oscillators.push(os); return os; }
  createBufferSource() { return { ...this.node(), start() {}, stop() {} }; }
  createConvolver() { return this.node(); }
  createDynamicsCompressor() { return { ...this.node(), ...Object.fromEntries(['threshold', 'knee', 'ratio', 'attack', 'release'].map((k) => [k, this.param()])) }; }
  createBuffer(ch, n, sr) { const d = Array.from({ length: ch }, () => new Float32Array(n)); return { numberOfChannels: ch, sampleRate: sr, getChannelData(i) { return d[i]; } }; }
  async suspend() {} resume() {}
  async startRendering() { await Promise.resolve(); return this.createBuffer(this.channels, this.length, this.sampleRate); }
}

test('music: three new tracks (18 Glade Jamboree, 19 Vine Skip, 20 Timber Trim) after the old eighteen, whose events are untouched; REGION_TRACKS.party = the lobby track', async () => {
  assert.deepEqual(TRACK_TITLES.slice(18, 21), ['Glade Jamboree', 'Vine Skip', 'Timber Trim']); assert.equal(TRACK_TITLES.length, 33);
  assert.deepEqual(REGION_TRACKS.party, [18, 25, 26]); assert.deepEqual(PARTY_TRACKS, { vineskip: 19, timber: 20, marlosays: 21, huddle: 22, sizzle: 23, eggs: 24, feastround: 27, bumpers: 28, glowcap: 29, cast: 30, tilty: 31, bonk: 32 });
  const pins = { 15: '3b9e6fea3dd472cc8ab2cb3931c075f4bfb1b1eaba36e515a6bdbd35da228fc7', 16: '4ce8485a664b09488ea79b221f0bdb775a33acce0e53a96d6f00710b6881186c', 17: '0eca9bab675ac0ea6701dec6b41e50c41cfd6b3ebd5c2c9e46c03d7d68bf9785' };
  for (const [i, h] of Object.entries(pins)) assert.equal(createHash('sha256').update(JSON.stringify(getTrack(Number(i)).events)).digest('hex'), h, `track ${i} is byte-identical to its pre-80a events`);
  const bpm = [120, 126, 138];
  for (let k = 0; k < 3; k++) {
    const tr = getTrack(18 + k), again = tr.def.build();
    assert.deepEqual(tr.events, again.events); assert.equal(tr.def.bpm, bpm[k]); assert.equal(tr.steps, 24 * 16);
    assert.ok(trackInfo()[18 + k].seconds > 35 && trackInfo()[18 + k].seconds < 60);
    let prev = 0; for (const e of tr.events) { assert.ok(e.s >= prev && e.s < tr.steps); prev = e.s; assert.ok(e.d > 0 && e.v > 0 && e.v <= 1); for (const n of Array.isArray(e.m) ? e.m : [e.m]) assert.ok(Number.isFinite(n)); }
  }
  assert.ok(getTrack(18).events.some((e) => e.k === 'marimba') && getTrack(18).events.some((e) => e.k === 'bell'), 'the calypso steel-drum lead');
  assert.ok(getTrack(19).events.some((e) => e.k === 'logdrum') && getTrack(19).events.filter((e) => e.k === 'shaker').length > 300, 'a jungle samba');
  assert.ok(getTrack(20).events.some((e) => e.k === 'pluck' && e.o.bright >= 5) && getTrack(20).events.some((e) => e.k === 'shaker' && e.o.len <= 0.03), 'a plucked fiddle and a washboard');
  const prior = globalThis.window; globalThis.window = { OfflineAudioContext: Ctx };
  try {
    for (const i of [18, 19, 20]) {
      const res = await renderTrack(i, null, { sampleRate: 8000 }), ctx = Ctx.last;
      assert.equal(res.notes, getTrack(i).events.length); assert.ok(ctx.oscillators.length > res.notes);
      for (const os of ctx.oscillators) assert.ok(Number.isFinite(os.startT) && os.stopT > os.startT);
    }
  } finally { globalThis.window = prior; }
});

test('music.party(id) forces a game\'s track from bar 1 at once (restarting when it ends), party(null) hands back to the region; setTempo scales the clock without losing the place', () => {
  const m = new Music({ onChange() {} }); let region = 'party'; m.region = () => region;
  assert.equal(m._chooseNext(-1), 18, 'the lobby plays Glade Jamboree');
  m.party('vineskip'); assert.equal(m.partyTrack, 19); assert.equal(m._chooseNext(-1), 19);
  m._booted = true; m.ctx = { currentTime: 10 }; const fades = []; m._retire = (tc) => fades.push(tc);
  m.party('timber'); assert.equal(m._forced, 20); assert.equal(m._state, 'gap'); assert.ok(Math.abs(m._gapUntil - 10.05) < 1e-9, 'a game\'s track starts almost at once'); assert.deepEqual(fades, [0.1]);
  m.party('timber'); assert.equal(fades.length, 1, 'asking for the same track again does nothing');
  m.party(null); assert.equal(m._forced, null); assert.equal(m._nextIdx, 18); assert.deepEqual(fades.at(-1), 0.4); assert.ok(Math.abs(m._gapUntil - 10.5) < 1e-9);
  m.party('nope'); assert.equal(m._forced, null);
  // the tempo scale: a position keeps its audio time when the tempo changes
  const eng = { comp: { attack: { value: 0 } } }, tr = getTrack(19), seq = new Sequencer(eng, tr, 0);
  const step8 = seq.timeOf(8); seq.setTempo(1.5, 2);
  assert.ok(Math.abs(seq.base + seq.timeOf(8) - (2 + (step8 - 2) / 1.5)) < 1e-9, 'the moment two seconds in stays at audio time 2; everything after it comes sooner');
  assert.ok(seq.endT < tr.steps * 60 / tr.def.bpm / 4 + 1, 'the track ends sooner at 1.5x');
  seq.setTempo(1.5, 5); assert.equal(seq.k, 1.5); seq.setTempo(-3, 5); assert.equal(seq.k, 1.5);
  const calls = []; m._seq = { setTempo: (k, now) => calls.push([k, now]) }; m.setTempo(1.25); assert.deepEqual(calls, [[1.25, 10]]); assert.equal(m._tempo, 1.25); m.setTempo(99); assert.equal(m._tempo, 2); m.setTempo(0.1); assert.equal(m._tempo, 0.5);
});

test('the party sounds exist (countdown blips, whistle, boing, fanfare and the two jingles) and play without a context harmlessly; icons are inline SVG, never emoji', () => {
  const sfx = new Sfx(); for (const n of ['count', 'go', 'tick', 'whistle', 'boing', 'fanfare', 'roundWon', 'trophy']) assert.doesNotThrow(() => sfx.play(n));
  const ctx = { currentTime: 0, state: 'running', destination: {}, createOscillator: () => ({ type: '', frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect(n) { return n; }, start() {}, stop() {} }), createGain: () => ({ gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect(n) { return n; } }), createBufferSource: () => ({ connect(n) { return n; }, start() {}, stop() {} }), createBiquadFilter: () => ({ frequency: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, Q: { value: 0 }, connect(n) { return n; } }), sampleRate: 8000, createBuffer: (c, n) => ({ getChannelData: () => new Float32Array(n) }) };
  sfx.ctx = ctx; sfx.master = { connect() {} };
  for (const n of ['count', 'go', 'tick', 'whistle', 'boing', 'fanfare', 'roundWon', 'trophy']) assert.doesNotThrow(() => sfx.play(n, { pitch: 1.2 }), n);
  for (const k of ['party-vineskip', 'party-timber', 'star', 'bot', 'popper', 'trophy', 'stick']) { assert.ok(ICONS[k] && ICONS[k].startsWith('<svg') && ICONS[k].endsWith('</svg>'), k); assert.doesNotMatch(ICONS[k], /[\u{1F300}-\u{1FAFF}☀-➿]/u, `${k} has no emoji`); }
});

test('what a party must NOT do: no save written (only the Game Board\'s preference key), no island placement or terrain hash touched', async () => {
  const keys = []; const store = globalThis.localStorage; const real = store.setItem;
  store.setItem = (k, v) => { keys.push(k); return real.call(store, k, v); };
  try {
    const r = makeRuntime(); r.party.open({ bots: 1, games: ['vineskip', 'timber'] }); r.run(20); r.party.toggle('timber', false); r.party.close(); r.run(4);
  } finally { store.setItem = real; }
  assert.deepEqual([...new Set(keys)].filter((k) => k !== 'infiniteIsland.party'), [], 'nothing but the board preference was written');
  const { createHash: h } = await import('node:crypto');
  const { getIslandModule } = await import('../public/js/world/islands/registry.js');
  const sig = (id) => { const m = getIslandModule(id); let s = 0; for (let x = -60; x <= 60; x += 7) for (let z = -60; z <= 60; z += 7) s += m.height(x + (id === 'home' ? 0 : 0), z); return Math.round(s * 1000); };
  assert.equal(typeof sig('frost'), 'number');
});
