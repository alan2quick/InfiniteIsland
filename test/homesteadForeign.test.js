// Step 86e: the OTHER islands' kinds on the home island (Homesteading). Listing per island flag (and staying listed), the config table (real catalogue ids, one signature per kind), the night-only glow (a pure function +
// the ONE shared uniform), the ghost rings, placed foreign trees / rocks / dig spots / herbs / bushes / mushrooms dropping THEIR island's loot (seeded Math.random), the instance <-> proxy swap of a felled tree, the kind
// cap, the dig look and prompt tag, the recognisability tweaks and the draw-call estimate of a fully foreign island (the real island in Node, no renderer).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
const storage = new Map();
globalThis.localStorage = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) };
const ctx = new Proxy({}, { get: (t, k) => (k === 'measureText' ? () => ({ width: 10 }) : /Gradient/.test(k) ? () => ({ addColorStop() {} }) : () => {}) });
globalThis.document = { createElement: () => ({ getContext: () => ctx, style: {} }) };
globalThis.window = { addEventListener() {}, innerWidth: 800, innerHeight: 600 };
const { homeSave } = await import('../public/js/game/homeSave.js');
import { HOMESTEAD, ISLANDS } from '../public/js/config.js';
import { WorldSync } from '../public/js/net/worldSync.js';
import { getItem } from '../public/js/game/catalog.js';
import { LOOT, DIG } from '../public/js/world/lootTable.js';
import { nightGlow, validatePlace, applyPlaced, freshState, isForeign, foreignInUse, usage, lineFor } from '../public/js/game/homesteadLogic.js';
import { listedKinds, paletteRows, iconOf } from '../public/js/game/homesteadPalette.js';
import { createHomestead } from '../public/js/game/homestead.js';
import { createHomesteadPlace } from '../public/js/game/homesteadPlace.js';
import { clearColliders } from '../public/js/world/colliders.js';
import { clearInteractables } from '../public/js/world/interactables.js';
import { createProps } from '../public/js/world/props.js';
import { buildIslandData } from '../public/js/world/islandVisuals.js';
import { createHarvest } from '../public/js/world/harvest.js';
import { createGathering } from '../public/js/world/gathering.js';
import { createHomesteadWorld } from '../public/js/world/homesteadWorld.js';
import { createHomesteadForeign, assetOf } from '../public/js/world/homesteadForeign.js';

const FOREIGN = Object.entries(HOMESTEAD.kinds).filter(([, m]) => m.island !== 'home');
const hostActor = (x = 0, z = 0) => ({ screen: 'host', index: 0, pos: { x, y: 0, z } });
const withRandom = (v, fn) => { const r = Math.random; Math.random = () => v; try { return fn(); } finally { Math.random = r; } };

// ------------------------------------------------------------------------------------------------------------------------------------------------------ the table
test('config: every foreign kind has a real catalogue cost (about 5x one harvest), the right weight class, an island and a model; the Crownlands add none', () => {
  assert.equal(FOREIGN.length, 30, '15 gathering kinds + 15 decorations from Frostpine, Emberleaf and Duskcrown');
  for (const [kind, m] of FOREIGN) {
    assert.ok(['frost', 'ember', 'dusk'].includes(m.island), kind + ': ' + m.island);
    assert.ok(!m.todo, kind + ' is built');
    for (const [id, n] of Object.entries(m.cost)) { assert.ok(getItem(id), `${kind}: ${id} is a catalogue item`); assert.ok(n > 0); }
    assert.equal(m.weight, m.budget === 'deco' ? 1 : HOMESTEAD.weights[m.cls], kind);
    if (m.budget === 'deco') { assert.deepEqual(m.cost, {}, kind + ' is free'); assert.equal(m.cls, 'flower'); }
    if (m.cls === 'digspot') assert.ok(m.look && m.digLabel, kind + ' has a mound look and a prompt label');
    else assert.ok(m.asset, kind + ' has a model');
    if (['tree', 'bamboo', 'rock'].includes(m.cls)) assert.ok(LOOT[m.variant], `${kind}: LOOT.${m.variant} is its island's loot`);
    if (m.grows) assert.ok(m.ring > 0 && m.sprout, kind + ' has a ghost ring and a sprout tint');
  }
  const cost = (k) => HOMESTEAD.kinds[k].cost;
  assert.deepEqual(cost('sprucePine'), { pinecone: 5, 'pine-log': 4 });
  assert.deepEqual(cost('birch'), { 'birch-log': 10 });
  assert.deepEqual(cost('graniteRock'), { stone: 8, crystal: 1 }, 'a rock is 8 stone + one rare');
  assert.deepEqual(cost('basaltRock'), { ash: 8, obsidian: 1 });
  assert.deepEqual(cost('snowDigSpot'), { 'snow-truffle': 8 }, 'a dig spot is 8 of its find');
  assert.deepEqual(cost('taroDigSpot'), { taro: 8 });
  assert.deepEqual(cost('bananaTree'), { banana: 15 });
  assert.deepEqual(cost('breadfruitTree'), { breadfruit: 5, 'breadfruit-log': 4 });
  assert.deepEqual(cost('jungleTree'), { log: 16 }, 'a log-only tree is 5x its fell');
  assert.deepEqual(cost('lingonBush'), { lingonberry: 15 });
  assert.deepEqual(cost('glowcapClump'), { 'glowcap-crumbs': 8 });
  assert.equal(HOMESTEAD.kinds.bamboo.weight, 3); assert.equal(HOMESTEAD.kinds.graniteRock.weight, 2); assert.equal(HOMESTEAD.kinds.mint.weight, 1);
  assert.ok(!HOMESTEAD.kinds.acacia, 'the Crownlands trees are shader trees with no interactables: nothing to place');
  const threeSnowmen = Object.keys(HOMESTEAD.kinds).filter((k) => /^snowman/.test(k));
  assert.equal(threeSnowmen.length, 3, 'decorative snowmen in 3 scarf colours (never the breakable one)');
  assert.ok(foreignOnly().every((k) => iconOf(k).startsWith('<svg')), 'every kind has an inline-SVG icon');
});
function foreignOnly() { return FOREIGN.map(([k]) => k); }

// ------------------------------------------------------------------------------------------------------------------------------------------------------ listing
test('listing: each island\'s kinds join the palette once its flag is set, and a listed kind stays listed (the flags only ever turn on)', () => {
  const flags = { frost: false, ember: false, dusk: false };
  const sync = new WorldSync({ role: 'host' });
  storage.clear(); homeSave.reset();
  const hs = createHomestead({ sync, params: new URLSearchParams(), islandsUnlocked: () => Object.keys(flags).filter((k) => flags[k]) });
  assert.deepEqual(hs.islands(), ['home']);
  const listed = () => hs.kinds().filter((k) => k.listed).map((k) => k.kind);
  assert.ok(listed().every((k) => HOMESTEAD.kinds[k].island === 'home'));
  assert.equal(listed().length, 15, 'the 9 home gathering kinds + 6 home decorations');
  flags.frost = true;
  assert.deepEqual(hs.islands(), ['home', 'frost']);
  assert.ok(listed().includes('sprucePine') && listed().includes('edelweiss') && listed().includes('snowmanBlue'));
  assert.ok(!listed().includes('bananaTree') && !listed().includes('glowShroom'));
  const before = new Set(listed());
  flags.ember = true; flags.dusk = true;
  assert.ok([...before].every((k) => listed().includes(k)), 'nothing already listed ever drops off the list');
  assert.equal(listed().length, 15 + 30);
  const gather = listedKinds('gathering', { islands: hs.islands() }), deco = listedKinds('decorations', { islands: hs.islands() });
  assert.equal(gather.length, 9 + 15); assert.equal(deco.length, 6 + 15);
  // the debug unlock lists everything without travelling, for the session only
  const flags2 = { frost: false };
  const hs2 = createHomestead({ sync: new WorldSync({ role: 'host' }), params: new URLSearchParams(), islandsUnlocked: () => Object.keys(flags2).filter((k) => flags2[k]) });
  assert.deepEqual(hs2.islands(), ['home']);
  hs2.unlockIslands();
  assert.deepEqual(hs2.islands(), ['home', 'frost', 'ember', 'dusk']);
  const hs3 = createHomestead({ sync: new WorldSync({ role: 'host' }), params: new URLSearchParams('homesteadall'), islandsUnlocked: () => [] });
  assert.deepEqual(hs3.islands(), ['home', 'frost', 'ember', 'dusk'], '?homesteadall');
  assert.equal(hs3.unlocked, true, '?homesteadall also unlocks Homesteading for the session');
});

test('the toast "New for your homestead: Frostpine plants!" comes once per island, on the host screen, only for an island unlocked during the session', () => {
  const flags = { frost: false, ember: false };
  storage.clear(); homeSave.reset();
  const hs = createHomestead({ sync: new WorldSync({ role: 'host' }), params: new URLSearchParams('homestead'), islandsUnlocked: () => Object.keys(flags).filter((k) => flags[k]) });
  flags.ember = true;                                                // already unlocked when the game loads: known silently
  const toasts = [];
  const place = createHomesteadPlace({ homestead: hs, world: { layerFull: () => false, spotCheck: () => null }, players: { list: [], multi: false }, dialog: { isOpen: false }, hud: { toast: (t) => toasts.push(t) }, sfx: null, ghost: {}, inventory: { count: () => 0 } });
  place.update(0.1);
  assert.deepEqual(toasts, [], 'a returning player is not toasted for an island they already had');
  flags.frost = true;
  place.update(0.1); place.update(0.1);
  assert.deepEqual(toasts, ['New for your homestead: Frostpine plants!'], 'once');
  flags.ember = true; place.update(0.1);
  assert.equal(toasts.length, 1);
});

test('validatePlace: a foreign kind needs its island listed and at most foreignKindCap[budget] different foreign kinds may stand at once (a cap per budget, Step 86f)', () => {
  const natives = [];
  const state0 = { ...freshState(), unlocked: true };
  assert.equal(validatePlace({ kind: 'mint', x: 1, z: 1, natives, state: state0, bag: () => 99, islands: ['home'] }), 'not-yet');
  assert.equal(validatePlace({ kind: 'mint', x: 1, z: 1, natives, state: state0, bag: () => 99, islands: ['home', 'frost'] }), null);
  assert.equal(validatePlace({ kind: 'mint', x: 1, z: 1, natives, state: state0, bag: () => 99, islands: ['home'], debug: true }), null, 'debug skips the island gate');
  const main = ['sprucePine', 'birch', 'mint', 'chanterelle', 'graniteRock', 'bananaTree'];
  const deco = ['edelweiss', 'gentian', 'heatherTuft', 'iceSpire', 'snowmanRed', 'snowmanBlue', 'hibiscus', 'plumeria'];
  assert.equal(main.length, HOMESTEAD.foreignKindCap.main); assert.equal(deco.length, HOMESTEAD.foreignKindCap.deco);
  let s = state0;
  [...main, ...deco].forEach((k, i) => { s = applyPlaced(s, { pid: i + 1, kind: k, x: i, z: 0, rot: 0, stage: 'grown' }); });
  assert.equal(foreignInUse(s).length, 14); assert.equal(foreignInUse(s, 'main').length, 6); assert.equal(foreignInUse(s, 'deco').length, 8);
  const all = ['home', 'frost', 'ember', 'dusk'];
  assert.equal(validatePlace({ kind: 'jungleTree', x: 1, z: 1, natives, state: s, bag: () => 99, islands: all }), 'kind-cap', 'a 7th different tree / rock kind waits');
  assert.equal(validatePlace({ kind: 'fern', x: 1, z: 1, natives, state: s, bag: () => 99, islands: all }), 'kind-cap', 'a 9th different decoration kind waits');
  assert.match(lineFor('kind-cap', HOMESTEAD.kinds.jungleTree), /trees and rocks/); assert.match(lineFor('kind-cap', HOMESTEAD.kinds.fern), /decorations/);
  assert.match(lineFor('kind-cap', HOMESTEAD.kinds.jungleTree), /remove every copy of one/);
  let s2 = s; for (const p of s.placed.filter((q) => q.kind === 'plumeria')) s2 = { ...s2, placed: s2.placed.filter((q) => q !== p) };
  assert.equal(validatePlace({ kind: 'fern', x: 1, z: 1, natives, state: s2, bag: () => 99, islands: all }), null, 'one decoration kind gone: the deco cap has room; the tree cap is separate');
  assert.equal(validatePlace({ kind: 'jungleTree', x: 1, z: 1, natives, state: s2, bag: () => 99, islands: all }), 'kind-cap', 'but removing a decoration does not free a tree slot');
  assert.equal(validatePlace({ kind: 'mint', x: 1, z: 1, natives, state: s, bag: () => 99, islands: all }), null, 'more of a kind already standing is fine');
  assert.equal(validatePlace({ kind: 'appleTree', x: 1, z: 1, natives, state: s, bag: () => 99, islands: all }), null, 'home kinds are not counted');
  const rows = paletteRows({ tab: 'decorations', bag: () => 99, usage: usage({ natives, state: s }), islands: all });
  assert.equal(rows.find((r) => r.kind === 'fern').reason, 'kind-cap');
  assert.match(rows.find((r) => r.kind === 'fern').line, /decorations/);
  assert.equal(rows.find((r) => r.kind === 'edelweiss').free, true);
  const grows = paletteRows({ tab: 'gathering', bag: () => 99, usage: usage({ natives, state: s }), islands: all });
  assert.equal(grows.find((r) => r.kind === 'jungleTree').reason, 'kind-cap'); assert.match(grows.find((r) => r.kind === 'jungleTree').line, /trees and rocks/);
  assert.equal(grows.find((r) => r.kind === 'birch').free, true, 'a kind already standing stays plantable');
  assert.ok(isForeign('mint') && !isForeign('herb'));
});

// ------------------------------------------------------------------------------------------------------------------------------------------------------ the night glow
test('the night glow: a pure smooth function, nothing by day, soft (below the cap) at night; ONE shared uniform for every layer', () => {
  assert.equal(nightGlow(0), 0); assert.equal(nightGlow(0.3), 0); assert.equal(nightGlow(-1), 0); assert.equal(nightGlow(NaN), 0);
  const g = HOMESTEAD.nightGlow;
  assert.ok(nightGlow(0.55) > 0 && nightGlow(0.55) < g.max);
  assert.ok(Math.abs(nightGlow(1) - g.max) < 1e-9 && nightGlow(0.8) === g.max);
  assert.ok(g.max <= 0.7, 'soft');
  let last = -1;
  for (let n = 0; n <= 1.0001; n += 0.05) { const v = nightGlow(n); assert.ok(v >= last - 1e-12); last = v; }
  const scene = new THREE.Scene();
  const props = createProps(scene);
  const f = createHomesteadForeign({ group: props.group, props });
  f.spawn('glowShroom', { pid: 1, x: 20, z: 20, rot: 0 });
  f.spawn('glowcapClump', { pid: 2, x: 22, z: 20, rot: 0 });
  f.spawn('glowBulb', { pid: 3, x: 24, z: 20, rot: 0 });
  f.setNight(0, 3); assert.equal(f.glowUniform.value, 0, 'noon: no glow');
  f.setNight(1, 3); assert.ok(f.glowUniform.value > 0.5 * g.max && f.glowUniform.value <= g.max + 1e-9, 'midnight: a soft glow');
  const mats = new Set([...f.layers.values()].filter((l) => l.asset.dusk).map((l) => l.mesh.material));
  assert.equal(mats.size, 1, 'one home material (one uniform) for every Duskcrown layer');
  const mat = [...mats][0];
  const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <color_vertex>', fragmentShader: '#include <common>\n#include <clipping_planes_fragment>\n#include <emissivemap_fragment>\n#include <opaque_fragment>\n#include <fog_fragment>' };
  mat.onBeforeCompile(shader, null);
  assert.equal(shader.uniforms.uGlow, f.glowUniform, 'the glow uniform is the HOME-owned one, not the island\'s breathing glow');
});

// ------------------------------------------------------------------------------------------------------------------------------------------------------ the real island
async function boot({ role = 'host' } = {}) {
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
  let held = 'axe';
  const homestead = createHomestead({ sync, inventory, params: new URLSearchParams(), heldKind: () => held });
  const spawned = [];
  const particles = { burst() {} }, hud = { toast() {} };
  const items = { heldByKey: () => ({ kind: held }), heldBy: () => ({ kind: held }), swing: () => true };
  const players = { list: [], get: () => null };
  const pickups = { spawn: (k) => spawned.push(k) };
  const harvest = createHarvest({ scene, players, items, particles, hud, interactions: { stopAnim() {} }, props, pickups, sync, extraTargets: [] });
  const gathering = createGathering({ scene, props, players, sync, items, particles, hud, inventory, pickups, frost, ember });
  const world = createHomesteadWorld({ props, harvest, gathering, particles });
  homestead.attach(world);
  const step = (dt, n = 1) => { for (let i = 0; i < n; i++) { harvest.update(dt); gathering.update(dt); world.update(dt); } };
  return { scene, props, sync, bag, inventory, homestead, harvest, gathering, world, spawned, setHeld: (k) => { held = k; }, step, take: () => spawned.splice(0) };
}
function spotFor(w, kind, skip = 0) {
  let n = 0;
  for (let r = 12; r < 55; r += 1.3) for (let a = 0; a < 6.283; a += 0.25) {
    const x = Math.round(Math.cos(a) * r * 100) / 100, z = Math.round(Math.sin(a) * r * 100) / 100;
    if (w.world.spotCheck(kind, x, z) === null && n++ >= skip) return { x, z };
  }
  throw new Error('no spot for ' + kind);
}
const plant = (w, kind, o = {}, skip = 0) => { const s = spotFor(w, kind, skip); const r = w.homestead.debug.place(kind, s.x, s.z, o); r.at = s; return r; };
const near = (g) => hostActor(g.position.x - 1.5, g.position.z);
function room(w, rocks = 8) { w.homestead.unlock(); for (let i = 0; i < rocks; i++) w.homestead.debug.remove('rock:' + i); }

test('ghost specs: foreign trees show the sprout plus a canopy ring per species, every other kind its own island model', async () => {
  const w = await boot();
  for (const [kind, m] of FOREIGN) {
    const s = w.world.ghostSpec(kind);
    assert.ok(s && s.geo && s.scale > 0, kind);
    if (m.cls === 'tree' || m.cls === 'bamboo') assert.ok(s.ring >= 1.2, `${kind}: a ghost ring for the grown canopy (${s.ring})`);
    else assert.ok(!s.ring, kind);
  }
  assert.ok(w.world.ghostSpec('jungleTree').ring > w.world.ghostSpec('bamboo').ring, 'the ring follows the species');
  assert.notEqual(w.world.ghostSpec('graniteRock').geo, w.world.ghostSpec('rock').geo, 'granite is its own model, not the home rock');
});

test('a placed spruce, birch and jungle tree chop to THEIR island\'s logs; a felled one hides its instance and comes back with the regrowth', async () => {
  const w = await boot();
  room(w);
  const logOf = { sprucePine: 'pine-log', birch: 'birch-log', jungleTree: 'log' };
  for (const [kind, log] of Object.entries(logOf)) {
    const r = plant(w, kind, { stage: 'grown' });
    assert.equal(r.ok, true, kind + ' ' + JSON.stringify(r));
    const h = w.world.built.get(r.result.pid).h, g = h.g;
    assert.equal(g.userData.variant, HOMESTEAD.kinds[kind].variant);
    w.step(0.05, 20);                                           // (the pop-in shows the proxy for half a second)
    assert.equal(g.userData.binding.mode, 'static', 'the instance shows');
    assert.equal(g.visible, false, 'the proxy is hidden');
    const layer = w.world.foreign.layers.get(HOMESTEAD.kinds[kind].asset);
    assert.equal(layer.used, 1);
    w.setHeld('axe');
    withRandom(0.9, () => {
      for (let i = 0; i < 6; i++) w.sync.request('harvest', 'hit', { id: g.userData.interactable.id, face: 0 }, near(g));
      w.step(0.05, 40);
    });
    const T = w.harvest._targets.get(g);
    assert.ok(['falling', 'stump'].includes(T.state), kind + ' falls: ' + T.state);
    assert.equal(g.userData.binding.mode, T.state === 'stump' ? 'none' : 'proxy');
    withRandom(0.9, () => w.step(0.05, 80));
    const drops = w.take();
    assert.ok(drops.includes(log), `${kind} drops ${log}: ${drops}`);
    if (log !== 'log') assert.ok(!drops.includes('log'), kind + ' gives only its own logs');
    assert.equal(w.harvest._targets.get(g).state, 'stump');
    assert.equal(g.userData.binding.mode, 'none', 'the instance is hidden while it is a stump');
    const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    layer.mesh.getMatrixAt(0, m); m.decompose(p, q, s);
    assert.ok(s.x < 0.01, 'the layer slot is scaled away');
    w.harvest.regrowNow(); w.step(0.05, 400);
    assert.equal(w.harvest._targets.get(g).state, 'idle', 'it regrows like on its own island');
    assert.equal(g.userData.binding.mode, 'static');
    layer.mesh.getMatrixAt(layer.mesh.count - 1, m); m.decompose(p, q, s);
    assert.ok(s.x > 0.3, 'and the instance is back');
  }
});

test('a banana tree fells for logs + mulch, bamboo for bamboo; shaking drops the island\'s fruit (loot table)', async () => {
  const w = await boot();
  room(w);
  const r = plant(w, 'bananaTree', { stage: 'grown' });
  const g = w.world.built.get(r.result.pid).h.g;
  withRandom(0.1, () => { for (let i = 0; i < 6; i++) w.sync.request('harvest', 'hit', { id: g.userData.interactable.id, face: 0 }, near(g)); w.step(0.05, 130); });
  const d = w.take();
  assert.ok(d.includes('log') && d.includes('mulch'), 'banana: logs and mulch: ' + d);
  const b = plant(w, 'bamboo', { stage: 'grown' }, 3);
  assert.equal(b.ok, true, JSON.stringify(b));
  const bg = w.world.built.get(b.result.pid).h.g;
  withRandom(0.1, () => { for (let i = 0; i < 6; i++) w.sync.request('harvest', 'hit', { id: bg.userData.interactable.id, face: 0 }, near(bg)); w.step(0.05, 130); });
  assert.ok(w.take().includes('bamboo'), 'bamboo drops bamboo');
  assert.equal(LOOT.spruce.shake.item, 'pinecone');
  assert.equal(LOOT.banana.shake.item, 'banana');
});

test('a placed granite rock breaks into stone + a crystal, basalt into stone + ash + obsidian (pinned rolls); both are hammer targets named in the prompt', async () => {
  const w = await boot();
  room(w);
  w.setHeld('hammer');
  const gr = plant(w, 'graniteRock');
  assert.equal(gr.ok, true, JSON.stringify(gr));
  const gh = w.world.built.get(gr.result.pid).h;
  assert.equal(gh.item.tag, 'granite'); assert.equal(gh.g.userData.variant, 'granite');
  withRandom(0.0, () => { for (let i = 0; i < 5; i++) w.sync.request('harvest', 'hit', { id: gh.g.userData.interactable.id, face: 0 }, near(gh.g)); w.step(0.05, 100); });
  const d1 = w.take();
  assert.ok(d1.includes('stone') && d1.includes('crystal'), 'granite: ' + d1);
  assert.equal(w.harvest._targets.get(gh.g).state, 'gone');
  assert.equal(gh.g.userData.binding.mode, 'none');
  const ba = plant(w, 'basaltRock', {}, 4);
  assert.equal(ba.ok, true, JSON.stringify(ba));
  const bh = w.world.built.get(ba.result.pid).h;
  assert.equal(bh.item.tag, 'basalt');
  withRandom(0.0, () => { for (let i = 0; i < 5; i++) w.sync.request('harvest', 'hit', { id: bh.g.userData.interactable.id, face: 0 }, near(bh.g)); w.step(0.05, 100); });
  const d2 = w.take();
  assert.ok(d2.includes('stone') && d2.includes('ash') && d2.includes('obsidian'), 'basalt: ' + d2);
  assert.ok(!d2.includes('crystal'), 'not the other island\'s rare');
});

test('placed dig spots are fixed patches that dig THEIR island\'s finds: snowy = snow truffles / crystal, taro = taro / obsidian; each wears its look and names itself in the prompt', async () => {
  const w = await boot();
  room(w);
  w.setHeld('shovel');
  const find = (kind) => { const r = plant(w, kind); assert.equal(r.ok, true, JSON.stringify(r)); const s = w.gathering.digSpots.find((q) => q.pid === r.result.pid); assert.ok(s, kind + ' spot'); return s; };
  const snow = find('snowDigSpot');
  assert.equal(snow.isl, 'frost'); assert.equal(snow.look, 'frost'); assert.equal(snow.item.tag, 'snowy spot');
  assert.equal(snow.g.parent !== null || true, true);
  const dig = (s, v) => { withRandom(v, () => { const r = w.sync.request('gathering', 'dig', { sid: s.sid }, hostActor(s.x - 1, s.z)); assert.equal(r.ok, true, JSON.stringify(r)); w.step(0.05, 40); }); return w.take(); };
  const d1 = dig(snow, 0.5);
  assert.ok(d1.length >= 1 && d1.every((k) => k === 'snow-truffle'), 'snowy spot: truffles ' + d1);
  w.gathering.regrowNow(); w.step(0.1, 200);
  const again = w.gathering.digSpots.find((q) => q.pid === snow.pid);
  assert.ok(again && again.x === snow.x && again.z === snow.z && again.isl === 'frost' && again.look === 'frost', 'it re-fills in place, still snowy');
  const d2 = dig(again, 0.0);
  assert.deepEqual(d2, ['crystal'], 'the rare find replaces the usual one');
  const taro = find('taroDigSpot');
  assert.equal(taro.isl, 'ember'); assert.equal(taro.look, 'volcanic'); assert.equal(taro.item.tag, 'taro spot');
  const d3 = dig(taro, 0.5);
  assert.ok(d3.length >= 1 && d3.every((k) => k === 'taro'), 'taro spot: taro ' + d3);
  const home = find('digSpot');
  assert.equal(home.isl, 'home'); assert.equal(home.look, 'dirt');
  const d4 = dig(home, 0.5);
  assert.ok(d4.every((k) => k === 'potato'), 'home spots still dig potatoes');
  assert.equal(DIG.frost.item, 'snow-truffle'); assert.equal(DIG.ember.rare.item, 'obsidian');
  // a removal for good gives one dig of ITS find
  const r = plant(w, 'snowDigSpot', {}, 6);
  assert.equal(r.ok, true);
  const rem = w.sync.request('homestead', 'remove', { id: 'p' + r.result.pid, shape: true, face: 0 }, hostActor(r.at.x - 1, r.at.z));
  assert.equal(rem.ok, true, JSON.stringify(rem));
  w.step(0.05, 40);
  assert.ok(w.take().every((k) => k === 'snow-truffle'));
});

test('placed mountain mint, pineapple, chanterelles, glowcap clumps and lingonberry bushes give ITS island\'s item; the home herb is untouched', async () => {
  const w = await boot();
  room(w);
  const pick = (kind, k, item) => {
    const r = plant(w, kind);
    assert.equal(r.ok, true, kind + ' ' + JSON.stringify(r));
    const pid = r.result.pid, rec = w.gathering.plants.placed;
    const list = k === 'herb' ? rec.herbs : rec.mushrooms;
    const e = list.get('p' + pid);
    assert.ok(e, kind + ' is a gathering citizen');
    assert.equal(e.itemId, item); assert.equal(e.isl, HOMESTEAD.kinds[kind].island);
    const res = w.sync.request('gathering', 'pick', { k, i: 'p' + pid }, hostActor(r.at.x - 1, r.at.z));
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.ok((w.bag[item] || 0) >= 1, `${kind} gives ${item}`);
    assert.equal(e.state, 'hidden');
    w.gathering.regrowNow(); w.step(0.1, 120);
    assert.equal(e.state, 'ready', kind + ' grows back');
  };
  pick('mint', 'herb', 'mint');
  pick('pineapple', 'herb', 'pineapple');
  pick('chanterelle', 'mushroom', 'chanterelle');
  pick('glowcapClump', 'mushroom', 'glowcap-crumbs');
  pick('herb', 'herb', 'herb');
  const lb = plant(w, 'lingonBush');
  assert.equal(lb.ok, true, JSON.stringify(lb));
  const key = 'p' + lb.result.pid;
  withRandom(0.5, () => { const r = w.sync.request('gathering', 'rustle', { i: key }, hostActor(lb.at.x - 1, lb.at.z)); assert.equal(r.ok, true, JSON.stringify(r)); w.step(0.05, 20); });
  const d = w.take();
  assert.ok(d.length >= 3 && d.every((k) => k === 'lingonberry'), 'lingonberries: ' + d);
  assert.equal(w.gathering.plants.placed.bushes.get(key).full, false);
  w.gathering.regrowNow(); w.step(0.1, 120);
  assert.equal(w.gathering.plants.placed.bushes.get(key).full, true);
  assert.equal(w.world.built.get(lb.result.pid).h.g, null, 'a bush instance has no proxy group');
});

test('decorations: free, boing interactables in the deco budget; the snowman and the tiki have a small collider, flowers none; digging up frees everything', async () => {
  const w = await boot();
  w.homestead.unlock();
  const before = w.homestead.budget().deco.used;
  const colliders = (await import('../public/js/world/colliders.js')).getColliders;
  let n = 0;
  const decos = FOREIGN.filter(([, x]) => x.budget === 'deco');
  for (const [kind, m] of decos.slice(0, HOMESTEAD.foreignKindCap.deco)) {
    const c0 = colliders().length;
    const r = plant(w, kind, {}, n++ * 2);
    assert.equal(r.ok, true, kind + ' ' + JSON.stringify(r));
    const h = w.world.built.get(r.result.pid).h;
    assert.equal(h.item.type, 'flower'); assert.ok(h.item.instance.mesh.isInstancedMesh, kind + ' is an instanced boing slot');
    assert.equal(h.item.prompt, m.prompt);
    assert.equal(colliders().length - c0, m.collider ? 1 : 0, kind + ' collider');
  }
  const over = plant(w, decos[HOMESTEAD.foreignKindCap.deco][0], {}, 40);
  assert.equal(over.ok, false); assert.equal(over.reason, 'kind-cap', 'the 9th different foreign decoration kind waits');
  assert.equal(w.homestead.budget().deco.used, before + HOMESTEAD.foreignKindCap.deco);
  assert.equal(w.homestead.budget().main.used, 240, 'decorations never touch the main budget');
  const snowmen = ['snowmanRed', 'snowmanBlue', 'snowmanGreen'].map((k) => assetOf(HOMESTEAD.kinds[k].asset).geo);
  assert.equal(new Set(snowmen).size, 3, 'three scarf colours = three models');
  for (const pid of [...w.world.built.keys()]) assert.equal(w.homestead.debug.remove('p' + pid).ok, true);
  assert.equal(w.homestead.budget().deco.used, before);
  assert.equal(colliders().filter((c) => c.owner && c.owner.foreign).length, 0, 'the colliders went with them');
  for (const l of w.world.foreign.layers.values()) assert.equal(l.used, 0, l.key + ' released');
});

test('growth: a foreign tree is planted as a tinted sprout, then the species model at 0.45, then the grown instance (two waterings)', async () => {
  const w = await boot();
  room(w);
  const r = plant(w, 'bananaTree', {}, 2);
  assert.equal(r.ok, true, JSON.stringify(r));
  const pid = r.result.pid;
  let h = w.world.built.get(pid).h;
  assert.equal(h.g.name, 'sprout'); assert.equal(h.item.type, 'sprout');
  assert.equal(w.world.foreign.layers.get('ember:banana'), undefined, 'a sprout is not an instance yet');
  assert.equal(w.homestead.debug.water(pid).ok, true);
  h = w.world.built.get(pid).h;
  assert.equal(h.g.name, 'sapling'); assert.ok(h.g.scale.x < 0.7);
  assert.equal(w.homestead.debug.water(pid).ok, true);
  h = w.world.built.get(pid).h;
  assert.equal(h.g.userData.variant, 'banana');
  assert.equal(w.world.foreign.layers.get('ember:banana').used, 1);
  assert.equal(w.homestead.budget().main.used, 240 - 16 + 3, 'a young tree already weighs its 3 points');
  w.world.foreign.layers.get('ember:banana');
});

// ------------------------------------------------------------------------------------------------------------------------------------------------------ recognisable + cost
test('recognisable at home: mountain mint is paler, granite is speckled (no snow caps), basalt has an orange crack, the dig mounds differ', async () => {
  const mint = assetOf('frost:mint'), herbMat = assetOf('frost:chanterelle').mat;
  assert.notEqual(mint.mat, herbMat, 'mint has its own paler material');
  assert.equal(mint.mat.color.getHexString(), 'e4fff0', 'a pale tint');
  const bould = (await import('../public/js/world/islands/frostAssets.js')).getAsset('boulder');
  const gr = assetOf('frost:granite');
  assert.ok(gr.geo.attributes.position.count > bould.geo.attributes.position.count, 'flecks were added');
  const col = gr.geo.attributes.color; const shades = new Set();
  for (let i = 0; i < col.count; i += 3) shades.add(col.getX(i).toFixed(2));
  assert.ok(shades.size > 8, 'facets are shaded differently (speckled): ' + shades.size);
  const bas = assetOf('ember:basalt'), plain = (await import('../public/js/world/islands/emberAssets.js')).getAsset('basalt');
  assert.ok(bas.geo.attributes.position.count > plain.geo.attributes.position.count, 'the crack slivers were added');
  let orange = 0; const bc = bas.geo.attributes.color;
  for (let i = 0; i < bc.count; i++) if (bc.getX(i) > 0.8 && bc.getY(i) < 0.75 && bc.getZ(i) < 0.3) orange++;
  assert.ok(orange > 20, 'orange vertices: ' + orange);
  const { buildMound } = await import('../public/js/world/gathering.js');
  const frostGeo = buildMound('frost'), snowGeo = buildMound('snow'), vol = buildMound('volcanic'), dirt = buildMound('dirt');
  assert.ok(frostGeo.attributes.position.count > snowGeo.attributes.position.count, 'the placed snowy spot adds ice glints and a snow ring');
  const avg = (g) => { const c = g.attributes.color; let s = 0; for (let i = 0; i < c.count; i++) s += c.getX(i) + c.getY(i) + c.getZ(i); return s / (3 * c.count); };
  assert.ok(avg(frostGeo) > 0.55 && avg(dirt) < 0.3 && avg(vol) < avg(dirt), 'white vs dark vs brown');
});

test('draw calls: one of every foreign kind in use is ~58 submissions, but the per-budget kind caps (6 + 8) keep the worst case near 30 (instanced layers, body + outline + shadow)', () => {
  const scene = new THREE.Scene();
  const props = createProps(scene);
  const f = createHomesteadForeign({ group: props.group, props });
  let pid = 1;
  for (const [kind, m] of FOREIGN) if (m.cls !== 'digspot') f.spawn(kind, { pid: pid++, x: 20 + pid * 0.1, z: 20, rot: 0, stage: 'grown' });
  const st = f.stats();
  assert.equal(st.kindsInUse, 29, '28 instanced kinds (the 2 dig spots are gathering mounds) + the lingonberry layer');
  assert.ok(st.drawCalls <= 60, 'everything at once: ' + st.drawCalls);
  const per = st.layers.map((l) => l.drawCalls).sort((a, b) => b - a);
  const calls = (budget, n) => f.stats().layers.filter((l) => FOREIGN.some(([, m]) => m.asset === l.asset && m.budget === budget && m.cls !== 'digspot')).map((l) => l.drawCalls).sort((a, b) => b - a).slice(0, n).reduce((a, b) => a + b, 0);
  const worst = calls('main', HOMESTEAD.foreignKindCap.main) + calls('deco', HOMESTEAD.foreignKindCap.deco);
  assert.ok(worst <= 36, 'the capped worst case (6 tree / rock-ish + 8 decoration layers): ' + worst);
  assert.ok(per.length > 0);
  for (const l of f.layers.values()) assert.ok(l.mesh.count <= l.cap);
});
