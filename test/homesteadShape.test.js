// Step 86c: Homesteading's mode and Shape (remove for good). The Charm routing's third case, the pure Shape rules (tool per kind, who needs a confirm, the guard lines), the HOST's validation of a Shape removal (tool in hand,
// reach, guests refused), the REAL home island (removal = the normal fell / break / dig with exactly the normal drops, for natives AND planted objects), and the mode's controller (confirm dialog, queue, double-Cancel leave menu,
// auto-leave, prompt line) driven with fakes.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
const storage = new Map();
globalThis.localStorage = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) };
const ctx = new Proxy({}, { get: (t, k) => (k === 'measureText' ? () => ({ width: 10 }) : /Gradient/.test(k) ? () => ({ addColorStop() {} }) : () => {}) });
globalThis.document = { createElement: () => ({ getContext: () => ctx, style: {} }) };
const { homeSave } = await import('../public/js/game/homeSave.js');
import { HOMESTEAD, ISLANDS } from '../public/js/config.js';
import { WorldSync } from '../public/js/net/worldSync.js';
import { actionsWithCharmRouting } from '../public/js/game/charms.js';
import { shapeRule, shapeToolOk, shapeConfirmText, guardLine, removeRejectLine } from '../public/js/game/homesteadLogic.js';
import { createHomestead } from '../public/js/game/homestead.js';
import { createHomesteadShape, shapeGlyph, DOUBLE_TAP } from '../public/js/game/homesteadShape.js';
import { clearColliders } from '../public/js/world/colliders.js';
import { clearInteractables } from '../public/js/world/interactables.js';
import { createProps } from '../public/js/world/props.js';
import { buildIslandData } from '../public/js/world/islandVisuals.js';
import { createHarvest } from '../public/js/world/harvest.js';
import { createGathering } from '../public/js/world/gathering.js';
import { createHomesteadWorld } from '../public/js/world/homesteadWorld.js';

const reject = (r) => (r && r.ok === false ? r.reason : r && r.reject);
const hostActor = (x = 0, z = 0) => ({ screen: 'host', index: 0, pos: { x, y: 0, z } });

// ------------------------------------------------------------------------------------------------------------------------------------------------------ Charm routing
test('Charm routing: outside combat it is a second Jump, in combat it is the charm, in Homesteading mode it is Shape (Jump untouched)', () => {
  const a = () => ({ jumpPressed: false, jumpHeld: false, charmPressed: true, charmHeld: true });
  let x = actionsWithCharmRouting(a(), false);
  assert.deepEqual([x.jumpPressed, x.jumpHeld, x.shapePressed, x.shapeHeld], [true, true, false, false], 'the old behaviour is unchanged');
  x = actionsWithCharmRouting(a(), true);
  assert.deepEqual([x.jumpPressed, x.jumpHeld, x.shapePressed, x.shapeHeld], [false, false, false, false], 'combat leaves Charm alone');
  x = actionsWithCharmRouting(a(), false, true);
  assert.deepEqual([x.jumpPressed, x.jumpHeld, x.shapePressed, x.shapeHeld], [false, false, true, true], 'Homesteading: Charm = Shape, not a Jump');
  x = actionsWithCharmRouting({ jumpPressed: true, jumpHeld: true, charmPressed: false, charmHeld: false }, false, true);
  assert.deepEqual([x.jumpPressed, x.jumpHeld, x.shapePressed], [true, true, false], 'Space / pad Y still jump in the mode');
  x = actionsWithCharmRouting(a(), true, true);
  assert.deepEqual([x.shapePressed, x.jumpPressed], [false, false], 'a combat area wins over the mode');
  x = actionsWithCharmRouting({ ...a(), shapePressed: true }, false);
  assert.equal(x.shapePressed, false, 'stale Shape presses are cleared every tick');
});

// ------------------------------------------------------------------------------------------------------------------------------------------------------ pure Shape rules
test('Shape rules: tool per kind, the prompt verb, which removals ask for a confirm, the guard line per native kind', () => {
  const tools = { appleTree: 'axe', cherryTree: 'axe', palm: 'axe', rock: 'hammer', berryBush: 'shovel', plainBush: 'shovel', herb: 'shovel', mushroom: 'shovel', digSpot: 'shovel', flowerPink: 'shovel', flowerBlue: 'shovel' };
  for (const [kind, tool] of Object.entries(tools)) {
    const r = shapeRule(kind);
    assert.equal(r.tool, tool, kind);
    assert.ok(shapeToolOk(kind, tool), kind + ' with its tool');
    assert.ok(!shapeToolOk(kind, tool === 'axe' ? 'shovel' : 'axe'), kind + ' with the wrong tool');
    assert.ok(!shapeToolOk(kind, null) && !shapeToolOk(kind, undefined));
  }
  assert.equal(shapeRule('appleTree').verb, 'Chop down for good');
  assert.equal(shapeRule('rock').verb, 'Break for good');
  assert.equal(shapeRule('herb').verb, 'Dig up for good');
  assert.equal(shapeRule('digSpot').verb, 'Fill in for good');
  assert.equal(shapeRule('flowerPink').verb, 'Dig up');
  assert.equal(shapeRule('rock').needs, 'Needs a hammer');
  assert.equal(shapeRule('palm').needs, 'Needs an axe');
  assert.equal(shapeRule('nope'), null);
  assert.ok(!shapeToolOk('nope', 'axe'));
  // every GATHERING kind (the main budget) asks; decorations (the deco budget) do not
  for (const [kind, m] of Object.entries(HOMESTEAD.kinds)) {
    const r = shapeRule(kind);
    assert.ok(r, kind + ' has a rule');
    assert.equal(r.confirm, m.budget === 'main', `${kind}: confirm iff it is a gathering object`);
  }
  assert.equal(shapeConfirmText('cherryTree'), "Chop this cherry blossom tree down for good? It won't grow back.");
  assert.match(shapeConfirmText('rock'), /^Break this rock for good/);
  assert.match(shapeConfirmText('digSpot'), /^Fill in this dig spot for good/);
  assert.match(shapeConfirmText('berryBush'), /^Dig up this berry bush for good/);
  // the guard, one line per kind name
  for (const [kind, m] of Object.entries(HOMESTEAD.kinds)) if (m.native) assert.match(guardLine(kind), /^That's the island's last .+!$/);
  assert.equal(guardLine('cherryTree'), "That's the island's last cherry blossom tree!");
  assert.equal(guardLine('mushroom'), "That's the island's last mushroom patch!");
  assert.equal(removeRejectLine('last-native', 'palm'), "That's the island's last coconut palm!");
  assert.equal(removeRejectLine('no-tool', 'rock'), 'Needs a hammer');
  assert.equal(removeRejectLine('nonsense', 'rock'), null);
  assert.deepEqual(shapeGlyph('keyboard'), { glyph: 'key', key: 'R' });
  assert.deepEqual(shapeGlyph('gamepad'), { glyph: 'pad', key: 'X' });
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
const shapeReq = (w, id, actor = hostActor()) => w.sync.request('homestead', 'remove', { id, shape: true, face: 0 }, actor);
const withRandom = (v, fn) => { const r = Math.random; Math.random = () => v; try { return fn(); } finally { Math.random = r; } };
function spotFor(w, kind) {
  for (let r = 12; r < 55; r += 1.3) for (let a = 0; a < 6.283; a += 0.25) {
    const x = Math.round(Math.cos(a) * r * 100) / 100, z = Math.round(Math.sin(a) * r * 100) / 100;
    if (w.world.spotCheck(kind, x, z) === null) return { x, z };
  }
  throw new Error('no spot for ' + kind);
}
const plant = (w, kind, o) => { const s = spotFor(w, kind); const r = w.homestead.debug.place(kind, s.x, s.z, o); r.at = s; return r; };
const near = (g) => hostActor(g.position.x - 1.5, g.position.z);

test('Shape removal: the host needs the right tool in hand and the target in reach; guests and the unlock gate still refuse', async () => {
  const w = await boot();
  const tree = w.props.handles.trees[0];
  assert.equal(reject(shapeReq(w, 'tree:0', near(tree))), 'locked');
  w.homestead.unlock();
  assert.equal(reject(shapeReq(w, 'tree:0', { ...near(tree), screen: 'guest1' })), 'not-host', 'an online guest can never Homestead');
  w.setHeld('shovel');
  assert.equal(reject(shapeReq(w, 'tree:0', near(tree))), 'no-tool', 'a shovel does not fell a tree');
  w.setHeld('hammer');
  assert.equal(reject(shapeReq(w, 'tree:0', near(tree))), 'no-tool');
  w.setHeld('axe');
  assert.equal(reject(shapeReq(w, 'tree:0', hostActor(tree.position.x + 40, tree.position.z))), 'far');
  assert.equal(w.homestead.state.removed.length, 0, 'nothing changed so far');
  const r = shapeReq(w, 'tree:0', near(tree));
  assert.equal(r.ok, true);
  assert.deepEqual(w.homestead.state.removed, ['tree:0']);
  const ev = r.result;
  assert.ok(ev.shape && Math.abs(Math.hypot(ev.shape.dx, ev.shape.dz) - 1) < 0.02 && ev.shape.tool === 'axe', 'the fall direction and tool ride on the event');
});

test('felling for good plays the NORMAL fell and gives exactly the normal drops; the stump goes and it never regrows (tree, palm, rock, planted tree, sprout)', async () => {
  const w = await boot();
  w.homestead.unlock();
  // the reference: a full normal chop (3 axe hits) of tree:1, with the random rolls pinned
  const mine = w.props.handles.trees[0];
  const ref = w.props.handles.trees.find((g, i) => i > 0 && !!g.userData.cherry === !!mine.userData.cherry);
  assert.equal(!!ref.userData.cherry, !!mine.userData.cherry, 'two trees of the same kind');
  withRandom(0.9, () => {
    for (let i = 0; i < 3; i++) assert.equal(w.sync.request('harvest', 'hit', { id: ref.userData.interactable.id, face: 0 }, near(ref)).ok, true);
    w.step(0.05, 120);
  });
  const normal = w.take();
  assert.ok(normal.filter((k) => k === 'log').length >= 2, 'a normal fell drops logs');
  // the removal
  withRandom(0.9, () => { assert.equal(shapeReq(w, 'tree:0', near(mine)).ok, true); w.step(0.02, 20); });
  const T = w.harvest._targets.get(mine);
  assert.ok(['falling', 'stump'].includes(T.state), 'the tree is falling (the normal animation), not poofed away: ' + T.state);
  withRandom(0.9, () => w.step(0.05, 120));
  assert.deepEqual(w.take(), normal, 'EXACTLY the normal fell drops');
  assert.equal(T.state, 'removed');
  assert.equal(mine.visible, false);
  w.harvest.regrowNow(); w.step(0.05, 400);
  assert.equal(mine.visible, false, 'never regrows');
  assert.equal(w.harvest._targets.get(mine).state, 'removed');
  assert.deepEqual(w.sync.domains.get('harvest').hashView().down.includes(mine.userData.interactable.id), false);
  // a palm
  const palm = w.props.handles.palms[0];
  withRandom(0.9, () => { assert.equal(shapeReq(w, 'palm:0', near(palm)).ok, true); w.step(0.05, 160); });
  const palmDrops = w.take();
  assert.ok(palmDrops.includes('log') && palmDrops.includes('coconut'), 'a palm drops its log and coconuts: ' + palmDrops);
  assert.equal(w.harvest._targets.get(palm).state, 'removed');
  // a rock with the hammer: the normal break drops
  w.setHeld('hammer');
  const rockRef = w.props.handles.rocks[1], rock = w.props.handles.rocks[0];
  withRandom(0.4, () => {
    for (let i = 0; i < 2; i++) assert.equal(w.sync.request('harvest', 'hit', { id: rockRef.userData.interactable.id, face: 0 }, near(rockRef)).ok, true);
    w.step(0.05, 120);
  });
  const normalRock = w.take();
  assert.ok(normalRock.includes('stone'), 'a normal break drops stone');
  withRandom(0.4, () => { assert.equal(shapeReq(w, 'rock:0', near(rock)).ok, true); w.step(0.05, 120); });
  assert.deepEqual(w.take(), normalRock, 'EXACTLY the normal break drops');
  assert.equal(w.harvest._targets.get(rock).state, 'removed');
  assert.equal(rock.visible, false);
  // a planted, fully grown tree: removed with the same animation and drops, then deleted outright
  w.setHeld('axe');
  const placed = plant(w, 'appleTree', { stage: 'grown' });
  assert.equal(placed.ok, true, JSON.stringify(placed));
  const pid = placed.result.pid, pg = w.world.built.get(pid).h.g;
  withRandom(0.9, () => { assert.equal(shapeReq(w, 'p' + pid, near(pg)).ok, true); w.step(0.05, 160); });
  assert.ok(w.take().filter((k) => k === 'log').length >= 2, 'a planted tree drops the normal logs');
  assert.equal(w.world.built.has(pid), false, 'the planted object is deleted once the fall is over');
  assert.equal(w.homestead.state.placed.length, 0);
  // a sprout drops nothing and goes at once
  const sprout = plant(w, 'cherryTree');
  assert.equal(sprout.result.rec.stage, 'sprout');
  assert.equal(shapeReq(w, 'p' + sprout.result.pid, hostActor(sprout.at.x - 1, sprout.at.z)).ok, true);
  w.step(0.05, 10);
  assert.deepEqual(w.take(), []);
  assert.equal(w.world.built.has(sprout.result.pid), false);
});

test('bushes, herbs, mushrooms and dig spots give their one-harvest drop when removed with the shovel (nothing when not grown); planted ones too', async () => {
  const w = await boot();
  w.homestead.unlock();
  w.setHeld('shovel');
  const berryIdx = w.props.handles.bushes.findIndex((g) => g.userData.berries), plainIdx = w.props.handles.bushes.findIndex((g) => !g.userData.berries);
  withRandom(0.9, () => { assert.equal(shapeReq(w, `bush:${berryIdx}`, near(w.props.handles.bushes[berryIdx])).ok, true); w.step(0.05, 20); });
  assert.equal(w.take().filter((k) => k === 'berry').length, 2, 'a full berry bush gives its rustle berries');
  assert.equal(shapeReq(w, `bush:${plainIdx}`, near(w.props.handles.bushes[plainIdx])).ok, true);
  w.step(0.05, 20);
  assert.deepEqual(w.take(), [], 'a plain bush only rustles');
  const herb = w.gathering.plants.herbs[0], mush = w.gathering.plants.mushrooms[0];
  const before = { herb: w.bag.herb || 0, mushroom: w.bag.mushroom || 0 };
  assert.equal(shapeReq(w, 'herb:0', hostActor(herb.x - 1, herb.z)).ok, true);
  assert.equal(w.bag.herb, before.herb + 1, 'one herb pick');
  withRandom(0.9, () => assert.equal(shapeReq(w, 'mush:0', hostActor(mush.x - 1, mush.z)).ok, true));
  assert.equal(w.bag.mushroom, before.mushroom + 1, 'one mushroom pick (1 with this roll)');
  assert.equal(w.gathering.states.herbs[0].state, 'removed');
  const h1 = w.gathering.plants.herbs[1];
  h1.state = 'hidden';                                              // not grown right now
  assert.equal(shapeReq(w, 'herb:1', hostActor(h1.x - 1, h1.z)).ok, true);
  assert.equal(w.bag.herb, before.herb + 1, 'a hidden herb gives nothing');
  // dig spot: exactly the finds one normal dig gives; the spot is gone and nothing replaces it
  const [a, b] = w.gathering.digSpots.filter((s) => s.isl === 'home');
  withRandom(0.5, () => { assert.equal(w.sync.request('gathering', 'dig', { sid: a.sid }, hostActor(a.x - 1, a.z)).ok, true); w.step(0.05, 80); });
  const normalDig = w.take();
  const respawnsAfterNormal = w.gathering.states.nextDigSpotIn;
  withRandom(0.5, () => { assert.equal(shapeReq(w, 'spot:' + b.sid, hostActor(b.x - 1, b.z)).ok, true); w.step(0.05, 80); });
  assert.deepEqual(w.take(), normalDig, "EXACTLY one normal dig's finds");
  assert.ok(!w.gathering.digSpots.includes(b), 'the spot is gone');
  assert.ok(typeof respawnsAfterNormal === 'number', 'the normal dig queued a respawn; the removal queues none of its own');
  // a PLANTED herb and a planted dig patch
  const ph = plant(w, 'herb');
  assert.equal(ph.ok, true, JSON.stringify(ph));
  const hb = w.bag.herb;
  assert.equal(shapeReq(w, 'p' + ph.result.pid, hostActor(ph.at.x - 1, ph.at.z)).ok, true);
  assert.equal(w.bag.herb, hb + 1, 'a planted herb gives its pick too');
  const pd = plant(w, 'digSpot');
  assert.equal(pd.ok, true, JSON.stringify(pd));
  const patch = w.gathering.digSpots.find((s) => s.pid === pd.result.pid);
  w.take();
  withRandom(0.5, () => { assert.equal(shapeReq(w, 'spot:' + patch.sid, hostActor(pd.at.x - 1, pd.at.z)).ok, true); w.step(0.05, 80); });
  assert.deepEqual(w.take(), normalDig, 'a planted patch gives one dig too');
  assert.ok(!w.gathering.digSpots.some((s) => s.pid === pd.result.pid), 'the patch is gone');
  assert.equal(w.homestead.state.placed.some((p) => p.pid === pd.result.pid), false);
});

test('the last-native guard also stops a Shape removal (checked locally for the confirm, and again by the host)', async () => {
  const w = await boot();
  w.homestead.unlock();
  w.setHeld('shovel');
  const n = w.homestead.natives.filter((x) => x.kind === 'mushroom');
  assert.equal(n.length, 3);
  for (const m of n.slice(0, 2)) assert.equal(w.homestead.debug.remove(m.id).ok, true);
  const last = n[2].id, g = w.props.handles.mushrooms[2];
  const chk = w.homestead.canRemove(last);
  assert.equal(chk.ok, false);
  assert.equal(chk.reason, 'last-native');
  assert.equal(chk.line, "That's the island's last mushroom patch!");
  assert.equal(chk.kind, 'mushroom');
  assert.equal(reject(shapeReq(w, last, hostActor(g.position.x - 1, g.position.z))), 'last-native', 'the host refuses too');
  assert.equal(w.homestead.canRemove('tree:0').ok, true);
  const p = plant(w, 'mushroom');
  assert.equal(p.ok, true, JSON.stringify(p));
  assert.equal(w.homestead.canRemove(last).ok, true, 'a planted copy lifts the guard');
});

// ------------------------------------------------------------------------------------------------------------------------------------------------------ the controller (fakes)
function rig() {
  const log = { toasts: [], removes: [], menus: [], swings: 0 };
  const mk = (index) => ({ index, position: { x: 0, z: 0 }, swinging: false, swingProgress: 0, faceToward() {}, actions: { activeSource: 'keyboard' }, colors: { name: 'P' + (index + 1), ui: '#fff' } });
  const p1 = mk(0), p2 = mk(1);
  const modes = new Set();
  const listeners = [];
  const kinds = { 'tree:0': 'appleTree', 'rock:0': 'rock', 'flower:0': 'flowerPink', 'mush:2': 'mushroom' };
  const homestead = {
    setMode: (p, on) => { if (on) modes.add(p); else modes.delete(p); listeners.forEach((f) => f('mode', { player: p, on })); return true; },
    inMode: (p) => modes.has(p), modes: () => [...modes], on: (f) => listeners.push(f),
    kindOf: (id) => kinds[id] || null,
    canRemove: (id) => (id === 'mush:2' ? { ok: false, reason: 'last-native', kind: 'mushroom', line: guardLine('mushroom') } : { ok: true, reason: null, kind: kinds[id], line: null }),
    remove: (id, p, o) => { log.removes.push([id, p.index, o]); return { ok: true }; },
  };
  const world = { idOfItem: (t) => t.nid, posOf: () => ({ x: 1, z: 1 }) };
  let held = { state: 'held', kind: 'axe' };
  const items = { heldBy: () => held, swing: (p) => { log.swings++; p.swinging = true; p.swingProgress = 0; return true; } };
  const dialog = { isOpen: false, owner: null, open(o) { this.isOpen = true; this.owner = o.owner; log.menus.push(o); }, close() { this.isOpen = false; this.owner = null; } };
  const charm = [];
  let off = false;
  const shape = createHomesteadShape({ homestead, world, players: { list: [p1, p2], multi: true }, items, dialog, hud: { toast: (t) => log.toasts.push(t) }, sfx: { play() {} }, offHome: () => off, charmUi: (p, show) => charm.push([p.index, show]) });
  return { shape, homestead, dialog, log, p1, p2, charm, setHeld: (k) => { held = k ? { state: 'held', kind: k } : null; }, setOff: (v) => { off = v; }, tree: { nid: 'tree:0' }, rock: { nid: 'rock:0' }, flower: { nid: 'flower:0' }, mush: { nid: 'mush:2' } };
}
const yes = (r) => r.log.menus.at(-1).choices.find((c) => /^Yes/.test(c.label)).onSelect();

test('mode: entering toasts the controls and shows the Charm button; the leave menu and auto-leave end it', () => {
  const r = rig();
  assert.equal(r.shape.enter(r.p1), true);
  assert.match(r.log.toasts[0], /^Homesteading! R: plant or remove/);
  r.shape.update(0.1);
  assert.deepEqual(r.charm.at(-1), [0, true], 'the touch / phone Charm button is shown for Shape');
  r.p2.actions.activeSource = 'gamepad';
  r.shape.enter(r.p2);
  assert.match(r.log.toasts.at(-1), /X: plant or remove/);
  // one Cancel is just the hop; a second quick one opens the Leave menu
  assert.equal(r.shape.cancelTap(r.p1), false);
  r.shape.update(DOUBLE_TAP + 0.1);
  assert.equal(r.shape.cancelTap(r.p1), false, 'two slow taps are two hops');
  r.shape.update(0.1);
  assert.equal(r.shape.cancelTap(r.p1), true, 'a quick second tap asks');
  assert.equal(r.dialog.owner, r.p1);
  assert.equal(r.log.menus.at(-1).text, 'Leave Homesteading?');
  r.log.menus.at(-1).choices[0].onSelect();                       // No
  assert.equal(r.homestead.inMode(r.p1), true);
  r.dialog.close();
  r.shape.cancelTap(r.p1);
  r.shape.update(0.1);
  assert.equal(r.shape.cancelTap(r.p1), true);
  yes(r);
  assert.equal(r.homestead.inMode(r.p1), false);
  assert.equal(r.homestead.inMode(r.p2), true, 'the other player stays in');
  assert.deepEqual(r.charm.at(-1), [0, false], 'the Charm button goes away again');
  assert.equal(r.log.toasts.at(-1), 'Done homesteading!');
  r.setOff(true);
  r.shape.update(0.1);
  assert.equal(r.homestead.inMode(r.p2), false, 'walking off the home island leaves the mode');
});

test("Shape press: wrong tool says what is needed, the guard stops, a gathering object asks (owner = the presser), a decoration does not; the removal is sent at the swing's impact frame", () => {
  const r = rig();
  r.shape.enter(r.p1);
  r.shape.enter(r.p2);
  r.log.toasts.length = 0;
  r.setHeld(null);
  assert.equal(r.shape.press(r.p1, r.tree), false);
  assert.equal(r.log.toasts.at(-1), 'Needs an axe.');
  assert.equal(r.shape.promptLine(r.p1, r.tree).text, 'Needs an axe');
  assert.equal(r.shape.promptLine(r.p1, r.tree).dim, true);
  r.setHeld('axe');
  assert.deepEqual(r.shape.promptLine(r.p1, r.tree), { glyph: 'key', key: 'R', text: 'Chop down for good' });
  assert.equal(r.shape.promptLine(r.p1, null), null);
  assert.equal(r.shape.press(r.p1, r.rock), false);
  assert.equal(r.log.toasts.at(-1), 'Needs a hammer.');
  r.setHeld('shovel');
  assert.equal(r.shape.press(r.p1, r.mush), false);
  assert.equal(r.log.toasts.at(-1), "That's the island's last mushroom patch!");
  assert.equal(r.shape.promptLine(r.p1, r.mush).dim, true);
  assert.equal(r.log.menus.length, 0, 'nothing was asked');
  // a decoration needs no confirm
  assert.equal(r.shape.press(r.p1, r.flower), true);
  assert.equal(r.log.menus.length, 0);
  assert.equal(r.log.swings, 1);
  r.p1.swinging = false;
  r.shape.update(0.05);
  assert.deepEqual(r.log.removes, [['flower:0', 0, { shape: true }]]);
  // a gathering object asks first; nothing is sent before Yes
  r.setHeld('axe');
  assert.equal(r.shape.press(r.p1, r.tree), true);
  assert.equal(r.dialog.owner, r.p1);
  assert.equal(r.log.menus.at(-1).text, "Chop this apple tree down for good? It won't grow back.");
  assert.equal(r.log.removes.length, 1);
  assert.equal(r.log.swings, 1);
  r.log.menus.at(-1).onCancel();                                  // Cancel = No
  assert.equal(r.log.removes.length, 1);
  assert.equal(r.log.swings, 1);
  assert.equal(r.shape.press(r.p1, r.tree), true);
  yes(r);
  assert.equal(r.log.swings, 2, 'Yes starts the swing');
  r.shape.update(0.05);
  assert.equal(r.log.removes.length, 1, 'still swinging: not yet');
  r.p1.swingProgress = 0.5;
  r.shape.update(0.05);
  assert.deepEqual(r.log.removes.at(-1), ['tree:0', 0, { shape: true }], 'sent at the impact frame');
  r.shape.update(0.05);
  assert.equal(r.log.removes.length, 2, 'only once');
});

test('two local players in the mode each get their own confirm (the single dialog is shared, so the second waits its turn)', () => {
  const r = rig();
  r.shape.enter(r.p1);
  r.shape.enter(r.p2);
  r.setHeld('axe');
  assert.equal(r.shape.press(r.p1, r.tree), true);
  assert.equal(r.shape.press(r.p2, r.tree), true);
  assert.equal(r.dialog.owner, r.p1);
  assert.equal(r.log.menus.length, 1);
  assert.deepEqual(r.shape.state().queued.map((q) => q.player), [1]);
  yes(r);                                                         // P1 says Yes
  r.p1.swingProgress = 0.5;
  r.shape.update(0.05);
  assert.equal(r.dialog.owner, r.p2, 'now P2 is asked');
  assert.equal(r.log.menus.length, 2);
  yes(r);
  r.p2.swingProgress = 0.5;
  r.shape.update(0.05);
  assert.deepEqual(r.log.removes.map((x) => x[1]).sort(), [0, 1], 'each removal is sent for its own player');
  const q = rig();
  assert.equal(q.shape.press(q.p1, q.tree), false, 'outside the mode Shape does nothing');
});
