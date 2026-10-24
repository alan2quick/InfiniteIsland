// Step 72b: Glimmerfin and Lanternkoi as real ingredients (catalog, icons, Journal + pickup models), the Duskcrown Journal album, the glowcap crumbs (a deterministic subset of the 69d violet clumps, gathering
// records appended last), the four marsh-hearth recipes, the two Duskcrown feast quests (gated on boat.discovered) and a host + replica catch -> Journal discovery pair.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WorldSync } from '../public/js/net/worldSync.js';
import { ISLANDS, CAMPFIRE_ISLANDS } from '../public/js/config.js';
import { getItem, listItems, listRecipes, getRecipe, dishMakeable, RECIPES } from '../public/js/game/catalog.js';
import { CollectionLog, COLLECTIBLES, ALBUM_SIZE } from '../public/js/game/collection.js';
import { QuestLog, QUESTS, getQuest, slotOf } from '../public/js/game/quests.js';
import { Inventory } from '../public/js/game/inventory.js';
import { createJournalModel, JOURNAL_MODEL_IDS } from '../public/js/player/journalModels.js';
import { getIslandModule } from '../public/js/world/islands/registry.js';
import { buildDuskPlacement } from '../public/js/world/islands/duskPlacement.js';
import { buildDuskFlora } from '../public/js/world/islands/duskFlora.js';
import { duskHearthLayout, duskFishPonds } from '../public/js/world/islands/duskHearth.js';
import { registerDuskGameplay } from '../public/js/world/islands/duskWorld.js';
import { planDuskCrumbs, duskCrumbRuntime, CRUMB_COUNT, CRUMB_APART } from '../public/js/world/islands/duskCrumbs.js';
import { buildDuskSmallVisuals } from '../public/js/world/islands/duskSmallVisuals.js';
import { registerFrostGameplay } from '../public/js/world/islands/frostWorld.js';
import { registerEmberGameplay } from '../public/js/world/islands/emberWorld.js';
import { createGathering } from '../public/js/world/gathering.js';
import { createFishing, parseActorKey } from '../public/js/game/fishing.js';
import { ICONS } from '../public/js/ui/icons.js';

const island = ISLANDS.find((i) => i.id === 'duskcrown'), mod = getIslandModule('duskcrown');
const DISHES = ['glimmerfin-skewer', 'marsh-chowder', 'dusk-wrap', 'lantern-supper'];

test('the fish, the crumbs and the four dishes are real catalog entries tagged for Duskcrown, with inline-SVG icons (no emoji)', () => {
  for (const id of ['glimmerfin', 'lanternkoi', 'glowcap-crumbs']) {
    const it = getItem(id);
    assert.ok(it && it.kind === 'ingredient' && it.islands.length === 1 && it.islands[0] === 'duskcrown', id);
    assert.ok(it.icon.includes('<svg') && !/[\u{1F300}-\u{1FAFF}]/u.test(it.icon), `${id} icon`); assert.equal(ICONS[id], it.icon);
  }
  assert.notEqual(getItem('glimmerfin').icon, getItem('lanternkoi').icon);
  assert.equal(getItem('glimmerfin').icon.includes('stroke-width="1.800" stroke-linejoin="round"/><circle cx="8"'), false, 'no longer the 72a placeholder');
  for (const id of DISHES) { const d = getItem(id); assert.ok(d && d.kind === 'dish' && d.islands.join() === 'duskcrown' && d.icon.includes('<svg'), id); }
  assert.deepEqual(getItem('coconut').islands, ['home', 'ember', 'duskcrown']); assert.deepEqual(getItem('taro').islands, ['ember', 'duskcrown']);
  assert.deepEqual(getItem('banana').islands, ['ember']);
});

test('four recipes at the marsh hearth: exact needs, only that island\'s fire cooks them, dishMakeable follows the fires that exist', () => {
  assert.deepEqual(listRecipes('duskcrown').map((r) => r.id), DISHES);
  const needs = (id) => getRecipe(id).needs;
  assert.deepEqual(needs('glimmerfin-skewer'), { glimmerfin: 2 });
  assert.deepEqual(needs('marsh-chowder'), { glimmerfin: 1, taro: 1, 'glowcap-crumbs': 1 });
  assert.deepEqual(needs('dusk-wrap'), { glimmerfin: 1, coconut: 1 });
  assert.deepEqual(needs('lantern-supper'), { lanternkoi: 1, 'glowcap-crumbs': 2, glimmerfin: 1 });
  for (const r of listRecipes('duskcrown')) { assert.equal(r.dish, r.id); for (const id of Object.keys(r.needs)) assert.equal(getItem(id).kind, 'ingredient', id); }
  for (const id of DISHES) { assert.equal(dishMakeable(id, ['home', 'frost', 'ember']), false, id); assert.equal(dishMakeable(id, CAMPFIRE_ISLANDS), true, id); }
  assert.equal(listRecipes('home').length + listRecipes('frost').length + listRecipes('ember').length + 4, RECIPES.length);
  for (const d of listItems('dish')) assert.deepEqual(d.islands, [getRecipe(d.id) ? getRecipe(d.id).island : 'home'], d.id);
});

test('the Journal: Duskcrown\'s album holds the two fish, awarded once, never "complete" while it is smaller than a full album; the other albums are unchanged', () => {
  const dusk = COLLECTIBLES.filter((d) => d.island === 'duskcrown');
  assert.deepEqual(dusk.map((d) => [d.id, d.source]), [['glimmerfin', 'fish'], ['lanternkoi', 'fish']]);
  assert.equal(dusk[0].icon, getItem('glimmerfin').icon);
  for (const i of ISLANDS.filter((i) => ['home', 'frost', 'ember'].includes(i.id))) assert.equal(COLLECTIBLES.filter((d) => d.island === i.id).length, ALBUM_SIZE);
  assert.deepEqual(COLLECTIBLES.slice(0, 18).map((d) => d.island), [...Array(6).fill('home'), ...Array(6).fill('frost'), ...Array(6).fill('ember')], 'the old 18 keep their order');
  const found = [], log = new CollectionLog({ persist: false, onFound: (def, actor) => found.push([def.id, actor]) });
  assert.equal(log.award('glimmerfin', { screen: 'host', index: 0 }), true);
  assert.equal(log.award('glimmerfin', { screen: 'host', index: 1 }), false, 'the first catch only');
  assert.deepEqual(log.progress('duskcrown'), { have: 1, total: 2, complete: false });
  assert.equal(log.award('lanternkoi', { screen: 'host', index: 1 }), true);
  assert.deepEqual(log.progress('duskcrown'), { have: 2, total: 2, complete: false });
  assert.deepEqual(found.map((f) => f[0]), ['glimmerfin', 'lanternkoi']);
  for (const id of ISLANDS.map((i) => i.id)) assert.equal(log.progress(id).complete, false);
  for (const d of COLLECTIBLES.filter((d) => d.island === 'home')) log.award(d.id);
  assert.equal(log.progress('home').complete, true);
  assert.deepEqual(log.snapshot().found, [...COLLECTIBLES.filter((d) => d.island === 'home'), ...dusk].map((d) => d.id), 'the snapshot keeps the definition order');
  const reload = new CollectionLog({ persist: false }); reload.load({ v: 1, found: ['glimmerfin', 'nope', 'fan-shell'] });
  assert.deepEqual([...reload.found].sort(), ['fan-shell', 'glimmerfin']);
  assert.equal(new CollectionLog({ persist: false }).roll('duskcrown', 'fish', null, 1, () => 0), true, 'a roll with the fish source works like any other source');
});

test('journal / showcase models: both fish have one merged mesh, centred, the Lanternkoi about twice as long', () => {
  assert.ok(JOURNAL_MODEL_IDS.includes('glimmerfin') && JOURNAL_MODEL_IDS.includes('lanternkoi'));
  const len = (id) => { const g = createJournalModel(id); const geo = g.children[0].geometry; geo.computeBoundingBox(); const s = geo.boundingBox.getSize(new THREE.Vector3()); const r = [g.userData.fit, s.x, geo.boundingSphere.center.length()]; g.userData.dispose(); return r; };
  const [, gx, gc] = len('glimmerfin'), [fit, lx, lc] = len('lanternkoi');
  assert.ok(lx / gx > 1.6 && lx / gx < 2.6, `ratio ${lx / gx}`); assert.ok(gc < 0.15 && lc < 0.15); assert.ok(fit < 1);
  assert.equal(createJournalModel('glimmerfin').userData.fit, 1);
});

test('the Duskcrown feast quests: slot "dusk" (reached by the island id too), gated on the first arrival, made from marsh dishes only', () => {
  assert.deepEqual(QUESTS.filter((q) => q.island === 'duskcrown').map((q) => q.id), ['glimmer-feast', 'marsh-supper']);
  for (const q of QUESTS.filter((q) => q.island === 'duskcrown')) for (const id of Object.keys(q.needs)) assert.ok(getItem(id), `${q.id}: ${id}`);
  assert.equal(slotOf('duskcrown'), 'dusk'); assert.equal(slotOf('ember'), 'ember');
  const inv = new Inventory({ persist: false });
  let discovered = false;
  const log = new QuestLog({ inventory: inv, persist: false, fireIslands: CAMPFIRE_ISLANDS });
  log.setBridgeProvider((id) => (id === 'duskcrown' ? discovered : true));
  assert.deepEqual(Object.keys(log.slots), ['home', 'frost', 'ember', 'dusk']);
  assert.equal(log.available('dusk').length, 0, 'not discovered yet'); assert.equal(log.start(null, 'dusk'), null);
  discovered = true;
  assert.deepEqual(log.available('dusk').map((q) => q.id), ['glimmer-feast', 'marsh-supper']); assert.deepEqual(log.available('duskcrown').map((q) => q.id), ['glimmer-feast', 'marsh-supper']);
  assert.ok(log.available('home').every((q) => !q.island) && log.available('ember').every((q) => q.island === 'ember'));
  const q = log.start('glimmer-feast', 'dusk');
  assert.equal(q.id, 'glimmer-feast'); assert.equal(log.activeFor('dusk').id, 'glimmer-feast'); assert.equal(log.activeFor('duskcrown').id, 'glimmer-feast'); assert.equal(log.activeFor('home'), null);
  assert.equal(log.start('marsh-supper', 'dusk'), null, 'one quest per fire');
  assert.deepEqual(log.progress('duskcrown').map((r) => [r.id, r.have, r.need]), [['glimmerfin-skewer', 0, 2]]);
  assert.equal(log.beginFeast('dusk'), false, 'the dishes are not in the bag'); assert.equal(log.satisfiedAt('duskcrown'), false);
  inv.add('glimmerfin-skewer', 2); assert.equal(log.satisfiedAt('duskcrown'), true);
  assert.equal(log.beginFeast('dusk'), true); assert.equal(inv.count('glimmerfin-skewer'), 0); assert.equal(log.finishFeast('dusk'), true);
  assert.equal(log.feasts, 1); assert.equal(log.activeFor('dusk'), null); assert.equal(log.summary('dusk').last, 'glimmer-feast');
  const next = log.start(null, 'dusk'); assert.equal(next.id, 'marsh-supper', 'not the same one twice in a row');
  const fresh = new QuestLog({ inventory: inv, persist: false, fireIslands: ['home', 'frost', 'ember'] });
  fresh.setBridgeProvider(() => true); assert.equal(fresh.available('dusk').length, 0, 'no fire on Duskcrown, no quests'); assert.equal(fresh.available().length, 8 + 2 + 2);
  assert.equal(getQuest('marsh-supper').island, 'duskcrown');
});

test('quests across screens: a replica asks for a Duskcrown quest through the dusk slot, the host decides, the hashes stay equal, a bad fire is refused', async () => {
  const q = [], hSync = new WorldSync({ role: 'host' }), rSync = new WorldSync({ role: 'replica' }), replicas = new Map([[1, rSync]]);
  hSync.attachHost({ sendTo: (tid, m) => q.push([replicas.get(tid), m]), broadcast: (m) => { for (const r of replicas.values()) q.push([r, m]); } });
  rSync.attachReplica({ send: (m) => { q.push([hSync, m, 1]); return true; } });
  const flush = () => { while (q.length) { const [to, m, tid] = q.shift(); if (to === hSync) hSync.screenMessage(tid, m); else to.receive(m); } };
  const host = new QuestLog({ inventory: new Inventory({ persist: false }), persist: false, fireIslands: CAMPFIRE_ISLANDS }), rep = new QuestLog({ inventory: new Inventory({ persist: false }), persist: false, fireIslands: CAMPFIRE_ISLANDS });
  host.setBridgeProvider(() => true); host.attachSync(hSync); rep.attachSync(rSync);
  rSync.linkUp(); hSync.screenConnected(1, { clientId: 'q' }); flush();
  assert.equal(hSync.hash(), rSync.hash());
  const asked = rep.start('marsh-supper', 'dusk'); flush();
  assert.equal((await asked).id, 'marsh-supper'); assert.equal(host.activeFor('dusk').id, 'marsh-supper'); assert.equal(rep.activeFor('duskcrown').id, 'marsh-supper'); assert.equal(hSync.hash(), rSync.hash());
  const bad = rSync.request('quests', 'start', { fireId: 'nowhere' }); flush(); assert.equal((await bad).ok, false);
  rep.giveUp('dusk'); flush(); assert.equal(host.activeFor('dusk'), null); assert.equal(hSync.hash(), rSync.hash());
});

test('glowcap crumbs: 16 of the existing violet clumps, nearest the hearth, spaced apart, deterministic, and no placement hash moves', () => {
  const P = buildDuskPlacement(island, mod), F = buildDuskFlora(island, mod), before = [P.hash(), F.hash()];
  const plan = planDuskCrumbs(island, mod), again = planDuskCrumbs(island, mod), hearth = duskHearthLayout(island, mod);
  assert.equal(plan, again, 'cached'); assert.equal(plan.clumps.length, CRUMB_COUNT); assert.equal(CRUMB_COUNT, 16);
  assert.deepEqual([P.hash(), F.hash()], ['a3374631', 'dc5f974e']); assert.deepEqual(before, [P.hash(), F.hash()]);
  assert.match(plan.hash(), /^[0-9a-f]{8}$/);
  const ids = new Set(F.layers.mushroom.map((c) => c.id));
  for (const c of plan.clumps) { assert.ok(ids.has(c.id), c.id); assert.ok(F.layers.mushroom.includes(c), 'the very same plan object'); assert.ok(Math.hypot(c.x - hearth.fire.x, c.z - hearth.fire.z) > hearth.zone.r); }
  assert.equal(new Set(plan.clumps.map((c) => c.id)).size, CRUMB_COUNT);
  let apart = 0; for (let i = 0; i < plan.clumps.length; i++) for (let j = i + 1; j < plan.clumps.length; j++) if (Math.hypot(plan.clumps[i].x - plan.clumps[j].x, plan.clumps[i].z - plan.clumps[j].z) >= CRUMB_APART) apart++;
  assert.ok(apart >= 100, `spaced (${apart} of 120 pairs)`);
  const d = (c) => Math.hypot(c.x - hearth.fire.x, c.z - hearth.fire.z);
  assert.ok(plan.clumps.every((c) => d(c) <= 95), 'a short walk from the hearth');
});

function gatheringWorld() {
  const frost = registerFrostGameplay(ISLANDS.find((i) => i.id === 'frost')), ember = registerEmberGameplay(ISLANDS.find((i) => i.id === 'ember'));
  registerDuskGameplay(island);
  const noop = () => {}, domains = {}, bag = new Map(), floats = [];
  const sync = { isHost: true, isReplica: false, screenId: 'host', register: (k, d) => { domains[k] = d; }, emit: noop, remoteActorNear: () => false };
  const crumbs = planDuskCrumbs(island, mod);
  const gat = createGathering({ scene: new THREE.Scene(), players: { list: [], get: () => null }, props: { handles: { bushes: [], trees: [], herbs: null, mushrooms: [] }, spotOk: () => false }, frost, ember, crumbs, items: {},
    particles: { burst: noop }, hud: { toast: noop }, pickups: {}, inventory: { add: (id, n) => bag.set(id, (bag.get(id) || 0) + n) }, floatText: (...a) => floats.push(a), sync });
  return { gat, domains, bag, crumbs, frost, ember, floats, sync };
}

test('crumb gathering records are appended LAST (after Frostpine\'s mushrooms and every herb), pick gives 1-2, regrows, and the clump hides and returns with the visuals', () => {
  const { gat, domains, bag, crumbs, frost } = gatheringWorld();
  const mush = gat.plants.mushrooms, dusk = mush.filter((r) => r.isl === 'dusk');
  assert.equal(dusk.length, 16); assert.equal(mush.length, frost.gather.mushrooms.length + 16);
  assert.deepEqual(mush.slice(0, frost.gather.mushrooms.length).map((r) => r.isl), frost.gather.mushrooms.map(() => 'frost'));
  assert.deepEqual(mush.slice(-16).map((r) => r.isl), Array(16).fill('dusk'), 'appended after everything');
  assert.deepEqual(dusk.map((r) => [r.x, r.z]), crumbs.clumps.map((c) => [c.x, c.z]));
  assert.ok(gat.plants.herbs.every((r) => r.isl !== 'dusk')); assert.equal(dusk[0].item.prompt, 'Pick'); assert.equal(dusk[0].item.type, 'mushroom');
  const small = buildDuskSmallVisuals(island, buildDuskFlora(island, mod)), m = new THREE.Matrix4(), r0 = dusk[0], c0 = crumbs.clumps[0];
  const slot = () => { for (const mesh of small.group.children) if (mesh.isInstancedMesh && mesh.name.startsWith('dusk-small-mushroom-') && !mesh.name.endsWith('outline')) for (let i = 0; i < mesh.count; i++) { mesh.getMatrixAt(i, m); const p = new THREE.Vector3().setFromMatrixPosition(m); if (Math.hypot(p.x - c0.x, p.z - c0.z) < 1e-3) return { mesh, i }; } return null; };
  const det = () => { const s = slot(); s.mesh.getMatrixAt(s.i, m); return m.determinant(); };
  assert.ok(det() > 0.1, 'visible');
  const actor = { screen: 's1', index: 1, pos: { x: r0.x, z: r0.z } };
  assert.equal(domains.gathering.handleRequest('pick', { k: 'mushroom', i: r0.i }, actor), true);
  assert.ok(bag.get('glowcap-crumbs') >= 1 && bag.get('glowcap-crumbs') <= 2); assert.equal(r0.state, 'hidden'); assert.ok(Math.abs(det()) < 1e-9, 'the clump is scaled away');
  assert.deepEqual(domains.gathering.handleRequest('pick', { k: 'mushroom', i: r0.i }, actor), { reject: 'gone' });
  assert.deepEqual(domains.gathering.handleRequest('pick', { k: 'mushroom', i: r0.i }, { screen: 's1', index: 1, pos: { x: r0.x + 40, z: r0.z } }), { reject: 'gone' });
  const far = dusk[1]; assert.deepEqual(domains.gathering.handleRequest('pick', { k: 'mushroom', i: far.i }, { screen: 's1', index: 1, pos: { x: far.x + 60, z: far.z } }), { reject: 'far' });
  small.dispose(); const rebuilt = buildDuskSmallVisuals(island, buildDuskFlora(island, mod));      // a rebuild re-hides the picked clump (duskCrumbRuntime hook)
  small.group.children.length = 0; small.group.children.push(...rebuilt.group.children);
  assert.ok(Math.abs(det()) < 1e-9, 'still hidden after a rebuild');
  gat.regrowNow(); for (let i = 0; i < 8; i++) gat.update(0.1);
  assert.equal(r0.state, 'ready'); assert.ok(det() > 0.1, 'grown back'); rebuilt.dispose();
  assert.equal(duskCrumbRuntime.api, null);
  const snap = domains.gathering.snapshot(); assert.equal(snap.mushrooms.length, mush.length); assert.equal(domains.gathering.hashView().mushrooms.length, mush.length);
});

function pair() {
  const q = [], hSync = new WorldSync({ role: 'host' }), rSync = new WorldSync({ role: 'replica' }), replicas = new Map([[1, rSync]]), bag = {};
  hSync.attachHost({ sendTo: (tid, m) => q.push([replicas.get(tid), m]), broadcast: (m) => { for (const r of replicas.values()) q.push([r, m]); } });
  rSync.attachReplica({ send: (m) => { q.push([hSync, m, 1]); return true; } });
  const flush = () => { while (q.length) { const [to, m, tid] = q.shift(); if (to === hSync) hSync.screenMessage(tid, m); else to.receive(m); } };
  const ponds = duskFishPonds(), hostLog = [], repLog = [];
  const hostCol = new CollectionLog({ persist: false, onFound: (def, actor) => hostLog.push([def.id, actor]) }), repCol = new CollectionLog({ persist: false, onFound: (def, actor) => repLog.push([def.id, actor]) });
  hostCol.attachSync(hSync); repCol.attachSync(rSync);
  const host = createFishing({ sync: hSync, ponds, collection: hostCol, inventory: { add: (id, n) => { bag[id] = (bag[id] || 0) + n; } } }), replica = createFishing({ sync: rSync, ponds });
  rSync.linkUp(); hSync.screenConnected(1, { clientId: 'angler' }); flush();
  const equal = () => assert.equal(hSync.hash(), rSync.hash());
  return { hSync, rSync, host, replica, hostCol, repCol, hostLog, repLog, bag, flush, equal, ponds };
}

test('a catch awards the Journal entry on the host once, every screen sees the found event with the angler, the bag has the fish, hashes stay equal', async () => {
  const w = pair(); w.equal();
  const key = `${w.rSync.screenId}:0`;
  assert.deepEqual(parseActorKey(key), { screen: w.rSync.screenId, index: 0 }); assert.deepEqual(parseActorKey('host:3'), { screen: 'host', index: 3 }); assert.equal(parseActorKey('nope'), null); assert.equal(parseActorKey(null), null);
  const pond = w.ponds.find((p) => !p.lagoon), bank = { x: pond.x + pond.rx * 1.1 + 0.4, y: 0.3, z: pond.z }, angler = { index: 0, position: bank };
  const sp = w.host.debug.spawn(pond.id, 'common'); w.flush(); const spot = sp.result;
  const pending = w.replica.cast(angler, pond.id, { x: spot.x, z: spot.z }); w.flush(); const cast = await pending; assert.equal(cast.ok, true);
  const bites = cast.result.bites, end = bites.at(-1);
  w.host.advance(end.at + end.win + 0.5); w.flush();
  const reeled = w.replica.reel(angler, cast.result.cast, bites.map((b) => +(b.at + b.win / 2).toFixed(2))); w.flush(); assert.equal((await reeled).ok, true); w.equal();
  assert.equal(w.bag.glimmerfin, 1); assert.ok(w.hostCol.has('glimmerfin') && w.repCol.has('glimmerfin'), 'both screens have the Journal entry');
  assert.deepEqual(w.hostLog, [['glimmerfin', { screen: w.rSync.screenId, index: 0 }]]); assert.deepEqual(w.repLog, w.hostLog, 'the replica\'s found event names the angler');
  // a second catch of the same species: the bag grows, the Journal does not
  w.host.debug.catch({ index: 1, position: bank }, 'glimmerfin'); w.flush(); w.equal();
  assert.equal(w.bag.glimmerfin, 2); assert.equal(w.hostLog.length, 1);
  w.host.debug.catch({ index: 1, position: bank }, 'lanternkoi'); w.flush(); w.equal();
  assert.deepEqual(w.hostLog.map((f) => f[0]), ['glimmerfin', 'lanternkoi']); assert.deepEqual(w.hostLog[1][1], { screen: 'host', index: 1 }); assert.deepEqual(w.repLog, w.hostLog);
  assert.deepEqual(w.hostCol.progress('duskcrown'), { have: 2, total: 2, complete: false }); assert.equal(w.bag.lanternkoi, 1);
  // a late joiner gets the album through the host snapshot
  const lateSync = new WorldSync({ role: 'replica' }), lateCol = new CollectionLog({ persist: false });
  lateCol.attachSync(lateSync); lateCol.load(w.hostCol.snapshot());
  assert.deepEqual(lateCol.progress('duskcrown'), { have: 2, total: 2, complete: false });
});
