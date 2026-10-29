// Step 86d: Homesteading's placing and growth. The pure rules (palette rows + greying, keep-clear zones, spot reasons), the REAL home island's spotCheck (ground per kind, spawn / fire keep-clear, pond and shore),
// host validation (cost out of the shared bag, budgets, guests), watering (stages, the can, the 1.5 s lock), the palette / ghost controller driven with fakes, the lily pad and reed layers, the far-view blobs,
// the growth effects and the new sounds (structurally: node counts and gains).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
const storage = new Map();
globalThis.localStorage = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) };
const ctx2d = new Proxy({}, { get: (t, k) => (k === 'measureText' ? () => ({ width: 10 }) : /Gradient/.test(k) ? () => ({ addColorStop() {} }) : () => {}) });
globalThis.document = { createElement: () => ({ getContext: () => ctx2d, style: {} }) };
globalThis.window = { addEventListener() {}, innerWidth: 800, innerHeight: 600 };
const { homeSave } = await import('../public/js/game/homeSave.js');
import { HOMESTEAD, ISLANDS, FIRES } from '../public/js/config.js';
import { WorldSync } from '../public/js/net/worldSync.js';
import { getItem } from '../public/js/game/catalog.js';
import { SPAWN, POND } from '../public/js/world/islands/home.js';
import { usage, freshState } from '../public/js/game/homesteadLogic.js';
import { listedKinds, paletteRows, costLine, tabOf, iconOf, TABS } from '../public/js/game/homesteadPalette.js';
import { keepClearReason, isTall, spotLine, inPond, onShore } from '../public/js/game/homesteadSpot.js';
import { createHomestead } from '../public/js/game/homestead.js';
import { createHomesteadPlace } from '../public/js/game/homesteadPlace.js';
import { createHomesteadFx } from '../public/js/world/homesteadFx.js';
import { createHomesteadGhost } from '../public/js/world/homesteadGhost.js';
import { clearColliders } from '../public/js/world/colliders.js';
import { clearInteractables } from '../public/js/world/interactables.js';
import { createProps } from '../public/js/world/props.js';
import { buildIslandData, buildIslandVisuals } from '../public/js/world/islandVisuals.js';
import { createHarvest } from '../public/js/world/harvest.js';
import { createGathering } from '../public/js/world/gathering.js';
import { createHomesteadWorld } from '../public/js/world/homesteadWorld.js';
import { getToolAction, toolHits } from '../public/js/items/tools.js';
import { Sfx } from '../public/js/audio/sfx.js';
import { getHeight, getGroundType } from '../public/js/world/terrain.js';

const reject = (r) => (r && r.ok === false ? r.reason : r && r.reject);
const hostActor = (x = 0, z = 0) => ({ screen: 'host', index: 0, pos: { x, y: 0, z } });
const guest = { screen: 's1', index: 0, pos: { x: 0, y: 0, z: 0 } };

// ------------------------------------------------------------------------------------------------------------------------------------------------------ pure: palette
test('config: the home kinds are all buildable (no todo), costs are real catalogue items, plain bushes and decorations are free', () => {
  for (const k of ['appleTree', 'cherryTree', 'palm', 'rock', 'berryBush', 'plainBush', 'herb', 'mushroom', 'digSpot', 'flowerPink', 'flowerWhite', 'flowerPurple', 'flowerBlue', 'lilyPad', 'reed']) {
    const m = HOMESTEAD.kinds[k];
    assert.ok(m && !m.todo && m.island === 'home', k);
    for (const id of Object.keys(m.cost)) assert.ok(getItem(id), `${k}: ${id}`);
  }
  assert.deepEqual(HOMESTEAD.kinds.cherryTree.cost, { peach: 5, log: 4 }, 'the blossom tree drops peaches');
  assert.deepEqual(HOMESTEAD.kinds.plainBush.cost, {});
  assert.equal(HOMESTEAD.kinds.plainBush.weight, 2);
  for (const [k, m] of Object.entries(HOMESTEAD.kinds)) if (m.budget === 'deco') assert.deepEqual(m.cost, {}, `${k} is free`);
  assert.ok(!HOMESTEAD.kinds.sprucePine.todo, 'Step 86e built the foreign kinds');
});

test('palette: two tabs, home kinds only (stay listed), costs as chips, the weight as pips, greyed out with the reason', () => {
  assert.deepEqual(TABS, ['gathering', 'decorations']);
  assert.deepEqual(listedKinds('gathering'), ['appleTree', 'cherryTree', 'palm', 'rock', 'berryBush', 'plainBush', 'herb', 'mushroom', 'digSpot']);
  assert.deepEqual(listedKinds('decorations'), ['flowerPink', 'flowerWhite', 'flowerPurple', 'flowerBlue', 'lilyPad', 'reed']);
  assert.ok(listedKinds('gathering', { islands: ['home', 'frost'] }).every((k) => !HOMESTEAD.kinds[k].todo), '86e kinds stay hidden until built, even with their island unlocked');
  assert.equal(tabOf('lilyPad'), 'decorations'); assert.equal(tabOf('rock'), 'gathering');
  const u0 = usage({ natives: [], state: freshState() });          // an empty island: everything fits
  const rows0 = paletteRows({ tab: 'gathering', bag: () => 0, usage: u0 });
  const apple = rows0.find((r) => r.kind === 'appleTree');
  assert.equal(apple.weight, 3);
  assert.deepEqual(apple.cost.map((c) => [c.id, c.need, c.have]), [['apple', 5, 0], ['log', 4, 0]]);
  assert.equal(apple.free, false); assert.equal(apple.reason, 'cost');
  assert.equal(apple.line, 'Needs 5 Apples and 4 Logs');
  const plain = rows0.find((r) => r.kind === 'plainBush');
  assert.equal(plain.free, true, 'a plain bush costs nothing'); assert.equal(plain.weight, 2);
  assert.equal(costLine([{ id: 'apple', need: 5, have: 0 }]), 'Needs 5 Apples');
  assert.equal(costLine([{ id: 'log', need: 4, have: 3 }]), 'Needs 1 Log');
  const bag = { apple: 5, log: 4 };
  assert.equal(paletteRows({ tab: 'gathering', bag: (id) => bag[id] || 0, usage: u0 }).find((r) => r.kind === 'appleTree').free, true);
  // a full island: the budget wins, with the "N free spots" sentence
  const full = { main: { used: 239, budget: 240, free: 1 }, deco: { used: 60, budget: 60, free: 0 }, counts: {} };
  const rowsFull = paletteRows({ tab: 'gathering', bag: () => 99, usage: full });
  const tree = rowsFull.find((r) => r.kind === 'appleTree');
  assert.equal(tree.reason, 'budget'); assert.match(tree.line, /^Needs 3 free spots, you have 1: remove something first/);
  assert.equal(rowsFull.find((r) => r.kind === 'herb').free, true, 'one point is enough for an herb');
  const decoFull = paletteRows({ tab: 'decorations', bag: () => 0, usage: full });
  assert.equal(decoFull.every((r) => r.reason === 'budget'), true, 'the decoration budget is separate');
  assert.match(decoFull[0].line, /decoration list is full/);
  for (const k of listedKinds('gathering').concat(listedKinds('decorations'))) assert.match(iconOf(k), /^<svg/, `${k} has an inline SVG icon`);
});

// ------------------------------------------------------------------------------------------------------------------------------------------------------ pure: keep-clear + reasons
test('keep-clear: the spawn plaza, the camera strip south of it, the spawn -> campfire walkway and the strip south of the campfire (tall kinds get more)', () => {
  assert.equal(isTall('appleTree'), true); assert.equal(isTall('palm'), true); assert.equal(isTall('rock'), false); assert.equal(isTall('herb'), false);
  assert.equal(keepClearReason('appleTree', 1.3, 15.9), 'spawn', 'the 86a review tree that hid the player');
  assert.equal(keepClearReason('appleTree', SPAWN.x + 6, SPAWN.z), 'spawn', 'tall: 7.5 u around the spawn');
  assert.equal(keepClearReason('rock', SPAWN.x - 6, SPAWN.z + 6), null, 'small kinds only need 4.2 u (off the walkway)');
  assert.equal(keepClearReason('rock', SPAWN.x - 3.5, SPAWN.z + 1), 'spawn');
  assert.equal(keepClearReason('palm', SPAWN.x - 4, SPAWN.z + 11), 'spawn', 'the strip south of the spawn');
  assert.equal(keepClearReason('rock', SPAWN.x - 4, SPAWN.z + 11), null, 'small kinds may stand there');
  const fire = FIRES[0];
  assert.equal(keepClearReason('herb', SPAWN.x + (fire.x - SPAWN.x) * 0.85, SPAWN.z + (fire.z - SPAWN.z) * 0.85 + 1.5), 'fire', 'on the walkway to the campfire');
  assert.equal(keepClearReason('appleTree', fire.x + 2, fire.z + 7), 'fire', 'the strip south of the campfire');
  assert.equal(keepClearReason('appleTree', fire.x + 20, fire.z - 20), null);
  assert.equal(spotLine('fire'), 'Keep the campfire clear'); assert.equal(spotLine('spawn'), 'Keep the spawn clear');
  assert.equal(spotLine('crowded'), 'Too close to something'); assert.equal(spotLine('path'), 'On a path');
  assert.equal(spotLine('ground', HOMESTEAD.kinds.appleTree), 'Needs grass'); assert.equal(spotLine('ground', HOMESTEAD.kinds.palm), 'Needs sand or grass');
  assert.equal(inPond(POND.x, POND.z, -0.8), true); assert.equal(inPond(POND.x + 30, POND.z, -0.8), false); assert.equal(inPond(POND.x, POND.z, 0.2), false);
  assert.equal(onShore(POND.x + 6.5, POND.z, 0.1), true); assert.equal(onShore(POND.x, POND.z, 0.1), false);
});

// ------------------------------------------------------------------------------------------------------------------------------------------------------ the real island
async function boot({ role = 'host', strict = false, clock = null, held = 'watering-can' } = {}) {
  storage.clear(); homeSave.reset();
  clearColliders(); clearInteractables();
  const scene = new THREE.Scene();
  const props = createProps(scene);
  const frost = buildIslandData(ISLANDS.find((i) => i.id === 'frost')).frost, ember = buildIslandData(ISLANDS.find((i) => i.id === 'ember')).ember;
  const sync = new WorldSync({ role });
  const bag = {};
  const inventory = {
    count: (id) => bag[id] || 0, add: (id, n) => { bag[id] = (bag[id] || 0) + n; },
    removeAll: (need) => { if (!Object.entries(need).every(([id, n]) => (bag[id] || 0) >= n)) return false; for (const [id, n] of Object.entries(need)) bag[id] -= n; return true; },
  };
  const state = { held };
  const homestead = createHomestead({ sync, inventory, params: new URLSearchParams(), heldKind: () => state.held, now: clock, strictWater: strict });
  const bursts = [], sounds = [], shakes = [];
  const particles = { burst: (type, at, o) => bursts.push([type, at, o]) }, hud = { toast() {} };
  const sfx = { play: (n) => sounds.push(n) };
  const items = { heldByKey: () => ({ kind: state.held }), heldBy: () => ({ kind: state.held, state: 'held' }), swing: () => true };
  const pickups = { spawn() {} };
  const harvest = createHarvest({ scene, players: { list: [], get: () => null }, items, particles, hud, interactions: { stopAnim() {} }, props, pickups, sync, extraTargets: [] });
  const gathering = createGathering({ scene, props, players: { list: [], get: () => null }, sync, items, particles, hud, inventory, pickups, frost, ember });
  const fx = createHomesteadFx({ scene, particles, sfx, shake: (a, d) => shakes.push([a, d]) });
  let local = true;
  const world = createHomesteadWorld({ props, harvest, gathering, particles, sfx, fx, isLocal: () => local });
  homestead.attach(world);
  return { scene, props, sync, bag, inventory, homestead, harvest, gathering, world, fx, bursts, sounds, shakes, state, setLocal: (v) => { local = v; }, step: (dt, n = 1) => { for (let i = 0; i < n; i++) { harvest.update(dt); gathering.update(dt); world.update(dt); } } };
}
function lilySpot(w, skip = 0) {
  let n = 0;
  for (let a = 0; a < 6.283; a += 0.3) for (let d = 0; d < 3; d += 0.4) {
    const x = Math.round((POND.x + Math.cos(a) * d) * 100) / 100, z = Math.round((POND.z + Math.sin(a) * d * 0.8) * 100) / 100;
    if (w.world.spotCheck('lilyPad', x, z) === null && n++ >= skip) return { x, z };
  }
  throw new Error('no pond spot');
}
function findSpot(w, kind, from = 12, skip = 0) {
  let n = 0;
  for (let r = from; r < 55; r += 1.3) for (let a = 0; a < 6.283; a += 0.25) {
    const x = Math.round(Math.cos(a) * r * 100) / 100, z = Math.round(Math.sin(a) * r * 100) / 100;
    if (w.world.spotCheck(kind, x, z) === null && n++ >= skip) return { x, z };
  }
  throw new Error('no spot for ' + kind);
}

test('spotCheck on the real island: water, ground per kind, spawn / fire keep-clear, crowded, pond and shore', async () => {
  const w = await boot();
  const sc = (k, x, z) => w.world.spotCheck(k, x, z);
  assert.equal(sc('appleTree', 1.3, 15.9), 'spawn');
  assert.equal(sc('rock', SPAWN.x, SPAWN.z), 'spawn');
  assert.ok(['fire', 'spawn'].includes(sc('herb', FIRES[0].x, FIRES[0].z)), 'the campfire plaza');
  assert.equal(sc('appleTree', 400, 400), 'water', 'open sea');
  // the pond: land kinds say water, the lily pad is happy
  assert.equal(sc('appleTree', POND.x, POND.z), 'water');
  const ls = lilySpot(w);
  assert.equal(sc('lilyPad', ls.x, ls.z), null, 'a lily pad floats on the pond');
  assert.equal(sc('lilyPad', 0, -10), 'pond', 'a lily pad needs pond water');
  // reeds: the shore band only
  let shore = null;
  for (let a = 0; a < 6.283 && !shore; a += 0.2) for (let d = 3.6; d < 9 && !shore; d += 0.3) { const x = POND.x + Math.cos(a) * d * 1.2, z = POND.z + Math.sin(a) * d; if (sc('reed', x, z) === null) shore = { x, z }; }
  assert.ok(shore, 'there is shore for reeds');
  assert.equal(sc('reed', 0, -10), 'shore');
  // ground per kind: a palm accepts sand (the beach), an apple tree does not
  let sandSpot = null;
  for (let a = 0; a < 6.283 && !sandSpot; a += 0.1) for (let r = 30; r < 60 && !sandSpot; r += 0.5) { const x = Math.cos(a) * r, z = Math.sin(a) * r; if (getGroundType(x, z) === 'sand' && getHeight(x, z) > 0.25 && sc('palm', x, z) === null) sandSpot = { x, z }; }
  if (sandSpot) { assert.equal(sc('appleTree', sandSpot.x, sandSpot.z), 'ground', 'an apple tree is not planted on sand'); assert.equal(sc('palm', sandSpot.x, sandSpot.z), null); }
  // a free meadow spot works, then the object makes the spot blocked
  const s = findSpot(w, 'rock');
  assert.equal(sc('rock', s.x, s.z), null);
  w.homestead.unlock();
  assert.equal(w.homestead.debug.remove('rock:0').ok, true, 'the island is full: a rock goes first');
  assert.equal(w.homestead.debug.place('rock', s.x, s.z).ok, true);
  assert.equal(sc('rock', s.x + 0.4, s.z), 'blocked', 'on top of the rock: a collider');
  // a native tree's room counts until it is removed for good
  const p0 = w.props.handles.trees[0].position;
  assert.ok(['blocked', 'crowded'].includes(sc('rock', p0.x + 0.3, p0.z)));
  for (const r of ['water', 'cliff', 'ground', 'edge', 'blocked', 'crowded', 'fire', 'spawn', 'path', 'reserved', 'pond', 'shore']) assert.ok(spotLine(r).length > 3);
});

test('no tall kind may be planted where its canopy would hide the spawn camera: a sweep around the spawn finds none accepted', async () => {
  const w = await boot();
  let accepted = 0, checked = 0;
  for (let x = SPAWN.x - 9; x <= SPAWN.x + 9; x += 0.5) for (let z = SPAWN.z - 9; z <= SPAWN.z + 14; z += 0.5) {
    const inCircle = Math.hypot(x - SPAWN.x, z - SPAWN.z) < HOMESTEAD.keepClear.spawn.tall - 0.1;
    const inStrip = Math.abs(x - SPAWN.x) < HOMESTEAD.keepClear.spawnLane.halfWidth - 0.1 && z > SPAWN.z - 0.9 && z < SPAWN.z + HOMESTEAD.keepClear.spawnLane.length - 0.1;
    if (!inCircle && !inStrip) continue;
    for (const k of ['appleTree', 'cherryTree', 'palm']) { checked++; if (w.world.spotCheck(k, x, z) === null) accepted++; }
  }
  assert.ok(checked > 1500);
  assert.equal(accepted, 0, 'no tree / palm within 7.5 u of the spawn (or in the strip south of it)');
});

test('placing: the host takes the cost from the shared bag, assigns the seeded rotation and broadcasts; guests and missing materials are refused; the two budgets are separate', async () => {
  const w = await boot();
  w.homestead.unlock();
  const s = findSpot(w, 'appleTree');
  // the native island is exactly full: nothing fits until something goes
  assert.equal(reject(w.sync.request('homestead', 'place', { kind: 'appleTree', ...s }, hostActor())), 'budget');
  for (const id of ['tree:0', 'tree:1']) assert.equal(w.homestead.debug.remove(id).ok, true);
  assert.equal(w.homestead.budget().main.free, 6);
  assert.equal(reject(w.sync.request('homestead', 'place', { kind: 'appleTree', ...s }, hostActor())), 'cost', 'no apples in the bag');
  w.bag.apple = 5; w.bag.log = 3;
  assert.equal(reject(w.sync.request('homestead', 'place', { kind: 'appleTree', ...s }, hostActor())), 'cost', 'one log short');
  assert.equal(reject(w.sync.request('homestead', 'place', { kind: 'appleTree', ...s }, { ...guest, pos: { x: s.x, y: 0, z: s.z } })), 'not-host', 'an online guest cannot Homestead');
  w.bag.log = 4;
  const r = w.sync.request('homestead', 'place', { kind: 'appleTree', ...s }, hostActor());
  assert.equal(r.ok, true); assert.equal(r.result.rec.stage, 'sprout');
  assert.deepEqual([w.bag.apple, w.bag.log], [0, 0], 'the materials left the shared bag');
  assert.equal(r.result.rec.rot, w.homestead.state.placed[0].rot, 'the seeded rotation');
  assert.equal(w.homestead.budget().main.free, 3);
  assert.ok(w.sounds.includes('plant'), 'the plant sound plays on the pop-in');
  // a free plain bush takes 2 main points and nothing from the bag
  const b = findSpot(w, 'plainBush', 12, 3);
  assert.equal(w.sync.request('homestead', 'place', { kind: 'plainBush', ...b }, hostActor()).ok, true);
  assert.equal(w.homestead.budget().main.free, 1);
  // decorations: free, under their own budget (20 natives + 40 allowance)
  const before = w.homestead.budget().deco.used;
  const f = findSpot(w, 'flowerBlue', 12, 6);
  assert.equal(w.sync.request('homestead', 'place', { kind: 'flowerBlue', ...f }, hostActor()).ok, true);
  assert.equal(w.homestead.budget().deco.used, before + 1); assert.equal(w.homestead.budget().main.free, 1, 'the main budget is untouched');
});

test('lily pads and reeds: free decorations, ONE instanced layer each, small interactables that boing; digging them up frees the deco budget', async () => {
  const w = await boot();
  w.homestead.unlock();
  const lily = w.sync.request('homestead', 'place', { kind: 'lilyPad', ...lilySpot(w) }, hostActor());
  assert.equal(lily.ok, true, JSON.stringify(lily));
  const l = w.props.planted.get(lily.result.pid);
  assert.equal(l.item.type, 'flower'); assert.equal(l.item.prompt, 'Boing'); assert.equal(l.collider, null, 'decorations never collide');
  let reedSpot = null;
  for (let a = 0; a < 6.283 && !reedSpot; a += 0.2) for (let d = 3.6; d < 9 && !reedSpot; d += 0.3) { const x = Math.round((POND.x + Math.cos(a) * d * 1.2) * 100) / 100, z = Math.round((POND.z + Math.sin(a) * d) * 100) / 100; if (w.world.spotCheck('reed', x, z) === null) reedSpot = { x, z }; }
  const reed = w.sync.request('homestead', 'place', { kind: 'reed', ...reedSpot }, hostActor());
  assert.equal(reed.ok, true, JSON.stringify(reed));
  const layers = w.props.group.children.filter((c) => c.name.startsWith('planted-'));
  assert.deepEqual(layers.map((m) => m.name).sort(), ['planted-lily', 'planted-reed'], 'one layer per kind');
  assert.equal(layers.every((m) => m.isInstancedMesh), true);
  assert.equal(w.homestead.budget().deco.used, 22);
  assert.equal(w.homestead.debug.remove('p' + lily.result.pid).ok, true);
  assert.equal(w.homestead.budget().deco.used, 21);
  assert.equal(w.homestead.debug.remove('p' + reed.result.pid).ok, true);
  assert.equal(w.homestead.budget().deco.used, 20);
});

test('watering: the real press needs the can in hand and obeys the 1.5 s lock; two waterings grow sprout -> sapling -> tree', async () => {
  let t = 0;
  const w = await boot({ strict: true, clock: () => t });
  w.homestead.unlock();
  w.homestead.debug.remove('tree:0');
  const s = findSpot(w, 'palm', 14);
  const pid = w.homestead.debug.place('palm', s.x, s.z).result.pid;
  const near = hostActor(s.x - 1, s.z);
  w.state.held = 'axe';
  assert.equal(reject(w.sync.request('homestead', 'water', { pid }, near)), 'no-can', 'an axe does not water');
  w.state.held = 'watering-can';
  assert.equal(w.sync.request('homestead', 'water', { pid }, near).ok, true); assert.equal(w.homestead.state.placed[0].stage, 'sapling');
  assert.equal(reject(w.sync.request('homestead', 'water', { pid }, near)), 'busy', 'a held press cannot skip the stage');
  t = 1.4; assert.equal(reject(w.sync.request('homestead', 'water', { pid }, near)), 'busy');
  t = 1.6;
  assert.equal(w.sync.request('homestead', 'water', { pid }, near).ok, true); assert.equal(w.homestead.state.placed[0].stage, 'grown');
  t = 9; assert.equal(reject(w.sync.request('homestead', 'water', { pid }, near)), 'maxed');
});

test('growth effects: sprout -> sapling plays the small version, sapling -> tree the big one (ring, falling petals, the chime, the camera nudge only for the waterer)', async () => {
  const w = await boot();
  w.homestead.unlock();
  w.homestead.debug.remove('tree:0'); w.homestead.debug.remove('tree:1');
  const sp = findSpot(w, 'cherryTree', 14);
  const pid = w.homestead.debug.place('cherryTree', sp.x, sp.z).result.pid;
  w.bursts.length = 0; w.sounds.length = 0;
  assert.equal(w.homestead.debug.water(pid).ok, true);
  assert.ok(w.sounds.includes('sproutgrow')); assert.equal(w.shakes.length, 0, 'no nudge for a small growth');
  assert.equal(w.fx.state().boings, 1); assert.equal(w.fx.state().rings, 1);
  const smallLeaves = w.bursts.filter((b) => b[0] === 'leaf' || b[0] === 'petal').reduce((n, b) => n + (b[2].count || 0), 0);
  w.step(0.05, 30);                                                                      // 1.5 s: the boing is done
  assert.equal(w.fx.state().boings, 0); assert.equal(w.fx.state().rings, 0);
  const g = w.props.planted.get(pid).g;
  assert.ok(g.scale.x > 0.3 && g.scale.x < 0.6, 'the sapling settles at ~0.45 of the species model');
  w.bursts.length = 0;
  assert.equal(w.homestead.debug.water(pid).ok, true);
  assert.ok(w.sounds.includes('treegrow')); assert.equal(w.shakes.length, 1, "the waterer's camera nudges");
  const bigPetals = w.bursts.filter((b) => b[0] === 'petal').reduce((n, b) => n + (b[2].count || 0), 0);
  assert.ok(bigPetals >= 20, 'cherry petals fall from the new canopy');
  assert.ok(w.bursts.filter((b) => b[0] === 'leaf' || b[0] === 'petal').reduce((n, b) => n + (b[2].count || 0), 0) > smallLeaves);
  w.step(0.05, 30);
  const tree = w.props.planted.get(pid);
  assert.equal(tree.item.type, 'tree'); assert.ok(tree.g.scale.x > 0.8, 'full size again after the boing');
  // someone else's watering: no nudge on this screen
  w.shakes.length = 0; w.setLocal(false);
  const sp2 = findSpot(w, 'appleTree', 14, 2);
  const pid2 = w.homestead.debug.place('appleTree', sp2.x, sp2.z, { stage: 'sapling' }).result.pid;
  w.homestead.debug.water(pid2);
  assert.equal(w.shakes.length, 0, 'the nudge is only for the waterer');
});

test('the boing overshoots (ease-out-back) and settles on the real scale; droplets arc from the can; the ring pool is bounded', () => {
  const scene = new THREE.Scene();
  const bursts = [];
  const fx = createHomesteadFx({ scene, particles: { burst: (t, a, o) => bursts.push([t, a, o]) }, sfx: { play() {} } });
  const g = new THREE.Group(); g.scale.set(2, 2, 2); scene.add(g);
  fx.grow({ g, x: 0, y: 0, z: 0, kind: 'palm' }, 'grown', {});
  assert.ok(Math.abs(g.scale.x - 0.7) < 1e-9, 'starts at 35%');
  let max = 0;
  for (let i = 0; i < 60; i++) { fx.update(0.02); max = Math.max(max, g.scale.x); }
  assert.ok(max > 2.0, `overshoots the final size (${max.toFixed(2)})`);
  for (let i = 0; i < 30; i++) fx.update(0.02);
  assert.deepEqual([g.scale.x, g.scale.y, g.scale.z], [2, 2, 2]);
  for (let i = 0; i < 6; i++) fx.grow({ g: new THREE.Group(), x: 0, y: 0, z: 0, kind: 'appleTree' }, 'sapling', {});
  assert.ok(fx.state().rings <= 3, 'at most 3 rings at once');
  bursts.length = 0;
  fx.pour({ x: 0, y: 1, z: 0 }, { x: 2, y: 0.3, z: 0 });
  for (let i = 0; i < 40; i++) fx.update(0.02);
  const drops = bursts.filter((b) => b[0] === 'dirt' && b[2].color === '#8fdcff');
  assert.equal(drops.length, 12, '12 droplet bursts along the arc');
  assert.ok(drops.some((d) => d[1].y > 0.65), 'the arc rises between the can and the plant');
  assert.ok(drops[drops.length - 1][1].x > drops[0][1].x, 'and travels towards the plant');
});

// ------------------------------------------------------------------------------------------------------------------------------------------------------ tools
test('the watering can waters sprouts and saplings (type "sprout"), nothing else; other tools leave them alone', () => {
  const can = { kind: 'watering-can', state: 'held' }, axe = { kind: 'axe', state: 'held' };
  const sprout = { type: 'sprout' };
  assert.equal(getToolAction(can, sprout), 'water'); assert.equal(getToolAction(axe, sprout), null); assert.equal(getToolAction(null, sprout), null);
  assert.equal(getToolAction(can, { type: 'tree' }), null, 'a grown tree is not watered'); assert.equal(toolHits('watering-can', 'water'), 1); assert.equal(toolHits('shovel', 'water'), 0);
});

// ------------------------------------------------------------------------------------------------------------------------------------------------------ the controller
function rig(w, { multi = false } = {}) {
  const log = { toasts: [], menus: [] };
  const mk = (index) => ({ index, position: new THREE.Vector3(SPAWN.x, 0, SPAWN.z), facing: 0, faceToward() {}, colors: { name: 'P' + (index + 1), ui: '#fff' }, actions: { activeSource: 'keyboard' } });
  const p1 = mk(0), p2 = mk(1);
  const players = { list: multi ? [p1, p2] : [p1], multi };
  const dialog = {
    isOpen: false, owner: null, menuId: '', refreshed: 0,
    open(o) { this.isOpen = true; this.owner = o.owner; this.menuId = o.menuId; this.o = o; log.menus.push(o); }, close() { this.isOpen = false; this.owner = null; this.menuId = ''; }, refresh() { this.refreshed++; },
    choices() { return typeof this.o.choices === 'function' ? this.o.choices() : this.o.choices; },
  };
  const scene = new THREE.Scene();
  const ghost = createHomesteadGhost({ scene, camera: null, root: null, world: w.world });
  const modes = new Set();
  const hs = Object.create(w.homestead);                                       // the real domain, with a controllable mode set
  hs.inMode = (p) => modes.has(p);
  const place = createHomesteadPlace({ homestead: hs, world: w.world, players, dialog, hud: { toast: (t) => log.toasts.push(t) }, sfx: { play() {} }, ghost, inventory: w.inventory, heldKind: () => w.state.held });
  return { place, dialog, ghost, log, p1, p2, modes, scene, hs };
}

test('palette controller: Shape opens a menu on the dialog (tab row, one row per kind with chips / pips / free, greyed out with the reason), the tab flips, a pick starts the ghost', async () => {
  const w = await boot();
  w.homestead.unlock();
  const r = rig(w);
  r.modes.add(r.p1);
  assert.equal(r.place.openPalette(r.p1), true);
  assert.equal(r.dialog.isOpen, true); assert.equal(r.dialog.o.menuId, 'homestead-palette'); assert.equal(r.dialog.owner, r.p1);
  let rows = r.dialog.choices();
  assert.equal(rows.length, 1 + 9 + 1, 'tab row + 9 gathering kinds + Close');
  assert.deepEqual(rows[0].tabs.map((t) => [t.label, t.active]), [['Gathering', true], ['Decorations', false]]);
  const apple = rows.find((c) => c.label === 'Apple tree');
  assert.equal(apple.pips, 3); assert.equal(apple.disabled, true); assert.match(apple.reason, /^Needs/); assert.equal(apple.chips.length, 2);
  assert.match(apple.chips[0].icon, /<svg/);
  const bush = rows.find((c) => c.label === 'Bush');
  assert.equal(bush.detail, 'Free'); assert.equal(bush.pips, 2);
  assert.match(r.dialog.o.text(), /^Island 240 \/ 240 +Decor 20 \/ 60$/);
  rows[0].onSelect(rows[0], r.dialog);                                        // the tab switch
  assert.equal(r.dialog.refreshed, 1);
  rows = r.dialog.choices();
  assert.deepEqual(rows[0].tabs.map((t) => t.active), [false, true]);
  assert.deepEqual(rows.slice(1, -1).map((c) => c.label), ['Pink flower', 'White flower', 'Purple flower', 'Blue flower', 'Lily pad', 'Reeds']);
  assert.equal(rows.find((c) => c.label === 'Lily pad').pips, 1);
  // 240/240 used: the main budget refuses a bush; the decorations have room (60 - 20)
  assert.equal(rows.find((c) => c.label === 'Pink flower').disabled, false);
  rows.find((c) => c.label === 'Pink flower').onSelect();
  assert.equal(r.dialog.isOpen, false, 'a pick closes the palette');
  assert.equal(r.place.previewing(r.p1), true);
  assert.equal(r.ghost.has(r.p1), true);
  // a greyed-out kind cannot be picked
  assert.equal(r.place.pick(r.p1, 'appleTree'), false);
  assert.match(r.log.toasts.at(-1), /Needs 3 free spots, you have 0/);
});

test('preview: the ghost stands ~2 u in front of the player, red with a reason on a bad spot (spawn keep-clear, water), green on a good one; Shape plants, Cancel goes back', async () => {
  const w = await boot();
  w.homestead.unlock();
  const r = rig(w);
  r.modes.add(r.p1);
  r.p1.position.set(SPAWN.x, 0, SPAWN.z); r.p1.facing = 0;
  assert.equal(r.place.pick(r.p1, 'flowerPink'), true);
  let g = r.place.ghost(r.p1);
  assert.ok(Math.abs(g.z - (SPAWN.z + 2)) < 0.02 && Math.abs(g.x - SPAWN.x) < 0.02, 'about 2 u in front of the player');
  assert.equal(g.ok, false); assert.equal(g.reason, 'spawn'); assert.equal(g.line, 'Keep the spawn clear');
  assert.equal(r.ghost.get(r.p1).ok, false); assert.equal(r.ghost.get(r.p1).text, 'Keep the spawn clear');
  const s = findSpot(w, 'flowerPink', 12);
  r.p1.position.set(s.x, 0, s.z - 2); r.p1.facing = 0;                          // facing +Z: the ghost lands on s
  r.place.update(0.2);
  g = r.place.ghost(r.p1);
  assert.equal(g.ok, true, JSON.stringify(g)); assert.equal(g.reason, null);
  // Shape plants it; the preview stays (a free decoration needs no materials)
  const decoBefore = w.homestead.budget().deco.used;
  const res = await r.place.confirm(r.p1);
  assert.equal(res.ok, true); assert.equal(w.homestead.budget().deco.used, decoBefore + 1);
  assert.equal(r.place.previewing(r.p1), true, 'free decorations keep the preview going');
  // a wet spot is red
  r.p1.position.set(300, 0, 300); r.place.update(0.2);
  assert.equal(r.place.ghost(r.p1).reason, 'water');
  assert.equal((await r.place.confirm(r.p1)).ok, false);
  // Cancel goes back to the palette
  assert.equal(r.place.back(r.p1), true);
  assert.equal(r.place.previewing(r.p1), false); assert.equal(r.ghost.has(r.p1), false); assert.equal(r.dialog.isOpen, true);
  r.dialog.close();
  // leaving the mode closes everything of that player
  r.place.pick(r.p1, 'flowerBlue'); r.modes.delete(r.p1); r.place.update(0.1);
  assert.equal(r.place.previewing(r.p1), false); assert.equal(r.ghost.count, 0);
});

test('two players: each has its own preview; a second palette waits for the single dialog', async () => {
  const w = await boot();
  w.homestead.unlock();
  const r = rig(w, { multi: true });
  r.modes.add(r.p1); r.modes.add(r.p2);
  r.place.pick(r.p1, 'flowerPink'); r.place.pick(r.p2, 'flowerBlue');
  assert.equal(r.ghost.count, 2);
  assert.equal(r.place.ghost(r.p1).kind, 'flowerPink'); assert.equal(r.place.ghost(r.p2).kind, 'flowerBlue');
  r.place.back(r.p1);
  assert.equal(r.dialog.owner, r.p1);
  r.place.back(r.p2);
  assert.deepEqual(r.place.state().queued, [1], 'P2 waits');
  r.dialog.close();
  r.place.update(0.1);
  assert.equal(r.dialog.owner, r.p2, "then P2's palette opens");
});

test('placing a tree through the controller: the materials leave the bag, the preview returns to the palette when it can no longer be afforded; the watering press needs the can', async () => {
  const w = await boot();
  w.homestead.unlock();
  for (const id of ['tree:0', 'tree:1', 'tree:2']) w.homestead.debug.remove(id);
  Object.assign(w.bag, { apple: 5, log: 4 });
  const r = rig(w);
  r.modes.add(r.p1);
  const s = findSpot(w, 'appleTree', 14);
  assert.equal(r.place.pick(r.p1, 'appleTree'), true);
  r.p1.position.set(s.x, 0, s.z - 2); r.p1.facing = 0; r.place.update(0.2);
  const res = await r.place.confirm(r.p1);
  assert.equal(res.ok, true);
  assert.deepEqual([w.bag.apple, w.bag.log], [0, 0]);
  assert.equal(r.place.previewing(r.p1), false, 'no more apples: back to the palette');
  assert.equal(r.dialog.isOpen, true);
  const pid = w.homestead.state.placed[0].pid;
  const h = w.props.planted.get(pid);
  assert.equal(h.item.type, 'sprout');
  w.state.held = 'axe';
  assert.equal(r.place.water(r.p1, h.item), false); assert.match(r.log.toasts.at(-1), /Needs water/);
  w.state.held = 'watering-can';
  assert.equal(r.place.water(r.p1, h.item), true);
  assert.equal(w.homestead.state.placed[0].stage, 'sapling');
  assert.equal(w.fx.state().jobs, 1, 'the splash arc is playing');
  assert.equal(r.place.water(r.p1, h.item), false, 'a held press does nothing for 1.5 s (client lock)');
});

// ------------------------------------------------------------------------------------------------------------------------------------------------------ far view
test('far-view canopy blobs: removed natives drop out, grown planted trees join, changes are debounced into one rebuild', async () => {
  const w = await boot();
  w.homestead.unlock();
  const home = ISLANDS.find((i) => i.id === 'home');
  const vis = buildIslandVisuals(home, { homeProps: w.props });
  const far = vis.homeFar;
  assert.ok(far, 'the home island has far blobs');
  const v0 = far.mesh.geometry.attributes.position.count;
  const per = v0 / (w.props.handles.trees.length + w.props.handles.palms.length);               // (equal-size icosahedra)
  w.homestead.debug.remove('tree:0'); w.homestead.debug.remove('tree:1'); w.homestead.debug.remove('palm:0');
  assert.equal(w.props.farDirty, true, 'a removal marks the blobs dirty');
  assert.equal(far.mesh.geometry.attributes.position.count, v0, 'not rebuilt yet');
  vis.update(1.0); vis.update(1.2); vis.update(1.4); vis.update(1.7);
  assert.equal(far.rebuilds, 1, 'one debounced rebuild for the burst');
  const v1 = far.mesh.geometry.attributes.position.count;
  assert.equal(v1, v0 - 3 * per, '3 blobs fewer');
  const s = findSpot(w, 'appleTree', 14);
  const pid = w.homestead.debug.place('appleTree', s.x, s.z).result.pid;
  vis.update(3); vis.update(4);
  assert.equal(far.mesh.geometry.attributes.position.count, v1, 'a sprout casts no far canopy');
  w.homestead.debug.water(pid); w.homestead.debug.water(pid);
  vis.update(5); vis.update(6);
  assert.equal(far.mesh.geometry.attributes.position.count, v1 + per, 'the grown tree joined');
});

// ------------------------------------------------------------------------------------------------------------------------------------------------------ sound (structural)
function fakeAudio() {
  const made = { osc: [], gain: [], filt: [], src: [] };
  const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {}, setTargetAtTime() {} });
  const node = (list) => { const n = { connect(o) { return o; }, start() {}, stop() {}, frequency: param(), gain: param(), Q: param() }; list.push(n); return n; };
  const ctx = {
    currentTime: 0, sampleRate: 8000, state: 'running', destination: {},
    createOscillator: () => node(made.osc), createGain: () => node(made.gain), createBiquadFilter: () => node(made.filt),
    createBufferSource: () => node(made.src), createBuffer: () => ({ getChannelData: () => new Float32Array(8000) }),
  };
  const sfx = new Sfx();
  sfx.ctx = ctx; sfx.master = { gain: { value: 1 } };
  return { sfx, made };
}
test('sounds: pour is filtered noise only; the sprout pluck is two notes; the tree chime is three rising notes plus a leafy rustle; plant is a thud + crumble (graph shapes, no clipping)', () => {
  const run = (name) => { const a = fakeAudio(); a.sfx.play(name); return a.made; };
  const pour = run('pour');
  assert.equal(pour.osc.length, 0, 'no oscillators: filtered noise'); assert.equal(pour.src.length, 2); assert.equal(pour.filt.length, 2);
  const sprout = run('sproutgrow');
  assert.equal(sprout.osc.length, 4, 'two plucked notes + a two-step sparkle'); assert.equal(sprout.src.length, 0);
  const tree = run('treegrow');
  assert.equal(tree.osc.length, 5, 'three chime notes + a shimmer + a sparkling octave tail'); assert.equal(tree.src.length, 1, 'and one leafy rustle');
  const plant = run('plant');
  assert.equal(plant.osc.length, 2); assert.equal(plant.src.length, 1);
  const a = fakeAudio(); const notes = [];
  const orig = a.sfx._tone.bind(a.sfx);
  a.sfx._tone = (type, f0, f1, dur, vol, delay) => { notes.push([f0, vol, delay || 0]); orig(type, f0, f1, dur, vol, delay); };
  a.sfx.play('treegrow');
  assert.ok(notes[0][0] < notes[1][0] && notes[1][0] < notes[2][0], 'C5 < E5 < G5');
  assert.ok(notes[0][2] < notes[1][2] && notes[1][2] < notes[2][2], 'staggered in time');
  assert.ok(notes.every((n) => n[1] <= 0.2), 'no single voice above 0.2 (86f: in fact none above the jingle note 0.17)');
  assert.ok(notes.reduce((s, n) => s + n[1], 0) * 0.55 < 0.6, 'the whole chime stays well below clipping at the 0.55 master');
});

// ------------------------------------------------------------------------------------------------------------------------------------------------------ draw calls (estimate)
test('draw-call budget: ten placed objects add at most one mesh per instanced kind plus two per solid object (mesh + outline)', async () => {
  const w = await boot();
  w.homestead.unlock();
  const count = () => { let n = 0; w.scene.traverse((o) => { if ((o.isMesh || o.isInstancedMesh) && o.visible) n++; }); return n; };
  for (let i = 0; i < 6; i++) w.homestead.debug.remove('tree:' + i);                       // (the native island is exactly full)
  const before = count();
  for (let i = 0; i < 3; i++) { const s = findSpot(w, 'herb', 12, i * 2); w.homestead.debug.place('herb', s.x, s.z); }
  for (let i = 0; i < 3; i++) { const s = findSpot(w, 'flowerPink', 12, i * 2); w.homestead.debug.place('flowerPink', s.x, s.z); }
  for (let i = 0; i < 2; i++) { const s = findSpot(w, 'appleTree', 14, i * 3); w.homestead.debug.place('appleTree', s.x, s.z); }
  for (let i = 0; i < 2; i++) { const s = findSpot(w, 'rock', 12, i * 3); w.homestead.debug.place('rock', s.x, s.z); }
  const added = count() - before;
  assert.equal(w.homestead.state.placed.length, 10, 'all ten were planted');
  assert.ok(added <= 12, `added ${added} meshes for 10 objects`);       // 2 layers + 4 solid objects x (mesh + outline) = 10
});

test('version', async () => {
  const { VERSION } = await import('../public/js/config.js');
  assert.equal(VERSION, '0.86.0');
});
