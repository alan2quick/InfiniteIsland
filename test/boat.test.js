// Step 68a: Skipper Marlo's boat quest: the pure rules (game/boatLogic.js), the feast reveal list (game/revealList.js), Marlo's lines, the `boat` sync domain with its save, the unlock and the
// garland-save migration, the take request's rejects, and the cove's meshes / draw calls. Node only (a fake localStorage / document, real WorldSync pairs).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WorldSync } from '../public/js/net/worldSync.js';
import { freshBoat, normaliseBoat, boatHashView, unlockedFromGarlands, unlockOnFeast, validateTake, applyTake, PARTS, COURSE_OF } from '../public/js/game/boatLogic.js';
import { createReveals } from '../public/js/game/revealList.js';
import { boatPages, nextHint, MARLO_SCRIPT, PART_HINTS } from '../public/js/game/marloScript.js';
import { BOAT, MARLO } from '../public/js/config.js';

const storage = new Map();
globalThis.localStorage = { getItem: (k) => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) };
const fakeNode = () => ({ className: '', style: {}, innerHTML: '', children: [], appendChild(c) { this.children.push(c); } });
globalThis.document = { createElement: fakeNode };
const { createBoat } = await import('../public/js/world/boat.js');
const { emberSave } = await import('../public/js/game/emberSave.js');
const resetSave = () => { storage.clear(); const f = emberSave.read(); for (const k of Object.keys(f)) delete f[k]; };

// ---- pure rules
test('a fresh boat is locked with nothing fetched; normaliseBoat sanitises anything and a locked boat cannot carry later progress', () => {
  const f = freshBoat();
  assert.deepEqual(f, { repair: false, nails: [0, 0, 0, 0], tar: {}, unlocked: false, parts: { planks: false, sail: false, rudder: false, compass: false }, planks: 0, seams: [false, false, false], float: null, floated: false, sights: [false, false, false], launched: false, at: 'ember', discovered: false });
  for (const junk of [null, undefined, 5, 'x', [], { unlocked: 'yes', parts: 7, planks: 'many' }]) assert.deepEqual(normaliseBoat(junk), f);
  const n = normaliseBoat({ unlocked: true, parts: { planks: true, sail: 1, bogus: true }, planks: 99.7, seams: [true, 1, false, true], float: { running: true, t0: 5, leaks: [{ at: 1 }, null, 3], bilge: 7 }, sights: [true], launched: true, extra: 1 });
  assert.deepEqual(n.parts, { planks: true, sail: false, rudder: false, compass: false });
  assert.equal(n.planks, 8); assert.deepEqual(n.seams, [true, false, false]); assert.deepEqual(n.sights, [true, false, false]);
  assert.deepEqual(n.float, { running: true, t0: 5, leaks: [{ at: 1 }], bilge: 1 }); assert.ok(!n.launched && !('extra' in n));
  const locked = normaliseBoat({ unlocked: false, parts: { planks: true }, planks: 4, launched: true });
  assert.deepEqual(locked, f, 'nothing past the unlock without the unlock');
  assert.deepEqual(normaliseBoat(JSON.parse(JSON.stringify(n))), n, 'idempotent');
});
test('the hash view leaves out the bilge timing noise and nothing else', () => {
  const a = normaliseBoat({ unlocked: true, float: { running: true, t0: 3, leaks: [], bilge: 0.2 } }), b = normaliseBoat({ unlocked: true, float: { running: true, t0: 3, leaks: [], bilge: 0.9 } });
  assert.deepEqual(boatHashView(a), boatHashView(b));
  b.parts.planks = true;
  assert.notDeepEqual(boatHashView(a), boatHashView(b));
  assert.deepEqual(a.float.bilge, 0.2, 'the view is a copy');
});
test('unlockOnFeast: once per feast number, never for a free feast, never twice; old saves with any garland count as unlocked', () => {
  const s = freshBoat();
  assert.deepEqual(unlockOnFeast(s, { n: 1, free: true, last: 0 }), { changed: false }); assert.equal(s.unlocked, false);
  assert.deepEqual(unlockOnFeast(s, { n: 0, last: 0 }), { changed: false });
  assert.deepEqual(unlockOnFeast(s, { n: 2, last: 2 }), { changed: false }, 'a feast number that was already evaluated');
  assert.deepEqual(unlockOnFeast(s, { n: 3, last: 2 }), { changed: true }); assert.equal(s.unlocked, true);
  assert.deepEqual(unlockOnFeast(s, { n: 4, last: 3 }), { changed: false }, 'already unlocked');
  assert.ok(unlockedFromGarlands([0]) && unlockedFromGarlands([3, 5]) && !unlockedFromGarlands([]) && !unlockedFromGarlands(null) && !unlockedFromGarlands('x'));
});
test('validateTake rejects: unknown part, locked, taken, too far; a debug take skips the course check; applyTake is once', () => {
  const s = freshBoat();
  for (const bad of [undefined, null, 5, 'rope', {}, 'constructor']) assert.deepEqual(validateTake(s, { part: bad }), { ok: false, reason: 'bad-request' });
  assert.deepEqual(validateTake(s, { part: 'planks' }), { ok: false, reason: 'locked' });
  s.unlocked = true;
  assert.ok(validateTake(s, { part: 'sail' }).ok, '68b opens the sail course');
  assert.ok(validateTake(s, { part: 'sail', debug: true }).ok);
  assert.deepEqual(validateTake(s, { part: 'planks', dist: 7.1, range: 6 }), { ok: false, reason: 'far' });
  assert.ok(validateTake(s, { part: 'planks', dist: 5.9, range: 6 }).ok && validateTake(s, { part: 'planks', dist: null, range: 6 }).ok);
  assert.ok(applyTake(s, 'planks') && !applyTake(s, 'planks') && !applyTake(s, 'bogus'));
  assert.deepEqual(validateTake(s, { part: 'planks' }), { ok: false, reason: 'taken' });
  assert.deepEqual(PARTS, ['planks', 'sail', 'rudder', 'compass']); assert.deepEqual(COURSE_OF, { planks: 'tide-pools', sail: 'boat-sail', rudder: 'boat-rudder', compass: 'boat-compass' });
});

// ---- the feast reveal list
test('reveal list: several apis per fire in registration order, banner nodes and holds combine, a throwing api does not stop the others', () => {
  const calls = [];
  const api = (name, hold, boom) => ({ onFeastEnd(a) { calls.push([name, a.n]); if (boom) throw new Error('boom'); }, bannerNode: (n) => ({ name, n }), bannerHold: () => hold });
  const r = createReveals(), origErr = console.error; console.error = () => {};
  r.add('ember', api('garlands', 1.5)); r.add('ember', api('boat', 1.0, true)); r.add('frost', api('tails', 2));
  assert.deepEqual(r.of('ember').length, 2); assert.deepEqual(r.of('home'), []);
  assert.deepEqual(r.bannerNodes('ember', 3).map((n) => n.name), ['garlands', 'boat'], 'the garland line stays first');
  r.onFeastEnd('ember', { n: 3, fireId: 'ember' });
  assert.deepEqual(calls, [['garlands', 3], ['boat', 3]]);
  assert.equal(r.hold('ember', 3), 1.5); assert.equal(r.hold('frost', 3), 2); assert.equal(r.hold('home', 3), 0);
  console.error = origErr;
});

// ---- Marlo's lines
test('Marlo\'s boat talk follows the saved state and hints at the open courses; the hints name where each part is', () => {
  const s = freshBoat(); s.unlocked = true;
  assert.ok(boatPages(s).join(' ').includes(PART_HINTS.planks));
  assert.match(nextHint(s), /planks/);
  s.parts.planks = true;
  const after = boatPages(s).join(' ');
  assert.match(after, /sail/); assert.match(after, /big tree|tallest one/); assert.match(after, /basalt column/); assert.match(after, /headland/); assert.match(after, /swaying bamboo/);
  assert.match(nextHint(s), /sail/);
  for (const p of PARTS) s.parts[p] = true;
  assert.deepEqual(boatPages(s).slice(-1), MARLO_SCRIPT.allBack);
  assert.ok(MARLO_SCRIPT.intro.length >= 3 && MARLO_SCRIPT.intro.join(' ').includes('crew') && MARLO_SCRIPT.clams.join(' ').includes('clam'));
  assert.equal(MARLO.name, 'Marlo');
});

// ---- the sync domain
function pair() {
  const host = new WorldSync({ role: 'host' }), replica = new WorldSync({ role: 'replica' }), queue = [];
  host.attachHost({ sendTo: (_, msg) => queue.push({ to: replica, msg }), broadcast: (msg) => queue.push({ to: replica, msg }) });
  replica.attachReplica({ send: (msg) => { queue.push({ to: host, msg }); return true; } });
  const flush = () => { while (queue.length) { const { to, msg } = queue.shift(); if (to === host) host.screenMessage(1, msg); else to.receive(msg); } };
  return { host, replica, flush, connect: () => { replica.linkUp(); host.screenConnected(1, { clientId: 'boat-test' }); flush(); } };
}
test('the boat domain: the first Emberleaf feast unlocks it (idempotent per feast, not for other fires), saves, syncs live, late joiners get it silently; banner line only for that feast', () => {
  resetSave();
  const { host, replica, flush, connect } = pair();
  const toasts = [], hud = { toast: (t) => toasts.push(t) };
  const h = createBoat({ sync: host, hud }), r = createBoat({ sync: replica, hud });
  const live = [], rlive = [];
  h.on((i) => live.push(i)); r.on((i) => rlive.push(i));
  connect();
  const node1 = h.bannerNode(1), rnode1 = r.bannerNode(1);
  assert.equal(node1.style.display, 'none'); assert.equal(h.bannerHold(1), 0);
  assert.equal(h.onFeastEnd({ n: 1, fireId: 'frost' }), false); assert.equal(h.onFeastEnd({ n: 1, fireId: 'home' }), false);
  assert.equal(r.onFeastEnd({ n: 1, fireId: 'ember' }), false, 'a replica never decides');
  assert.equal(h.unlocked, false);
  assert.equal(h.onFeastEnd({ n: 1, fireId: 'ember' }), true); flush();
  assert.ok(h.unlocked && r.unlocked && host.hash() === replica.hash());
  assert.deepEqual(live.map((i) => [i.kind, i.live]), [['unlock', true]]); assert.deepEqual(rlive.filter((i) => i.kind !== 'set').map((i) => [i.kind, i.live]), [['unlock', true]]);
  assert.ok(toasts.includes(BOAT.unlockText) && node1.style.display === '' && rnode1.style.display === '', 'the banner line appears on both screens');
  assert.ok(node1.children[0].innerHTML.includes('foghorn')); assert.equal(h.bannerHold(1), 1.0); assert.equal(h.bannerHold(2), 0);
  assert.equal(h.onFeastEnd({ n: 1, fireId: 'ember' }), false, 'the same feast number evaluates once'); assert.equal(h.onFeastEnd({ n: 2, fireId: 'ember' }), false, 'already unlocked');
  assert.equal(live.length, 1);
  assert.deepEqual(emberSave.read().boat.parts, freshBoat().parts); assert.equal(JSON.parse(storage.get('infinite-island.emberleaf.v1')).boat.unlocked, true);
  // a banner built after the reveal fills at once
  assert.equal(h.bannerNode(1).style.display, '');
  // a late joiner gets the state silently (a snapshot, no live event, no toast)
  const late = pair(), lateHost = createBoat({ sync: late.host }), lateToasts = [], lateBoat = createBoat({ sync: late.replica, hud: { toast: (t) => lateToasts.push(t) } }), lateLive = [];
  lateHost.debug.unlock(); lateBoat.on((i) => lateLive.push(i));
  late.connect();
  assert.ok(lateBoat.unlocked && late.host.hash() === late.replica.hash());
  assert.ok(lateLive.every((i) => !i.live) && lateToasts.length === 0);
});
test('the take request: rejects (locked, unknown part, far, taken), then it applies once, saves and reaches the replica; a replica ask is a Promise', async () => {
  resetSave();
  const { host, replica, flush, connect } = pair();
  const h = createBoat({ sync: host }), r = createBoat({ sync: replica });
  connect();
  h.setGoals({ planks: { x: 100, z: 100, top: 0 } }); r.setGoals({ planks: { x: 100, z: 100, top: 0 } });
  const near = { position: { x: 101, y: 0, z: 101 }, index: 0 }, far = { position: { x: 120, y: 0, z: 100 }, index: 1 };
  assert.deepEqual(h.take(near, 'planks'), { ok: false, reason: 'locked' });
  h.debug.unlock(); flush();
  assert.ok(r.unlocked);
  assert.equal(h.take(near, 'sail').reason, 'far'); assert.equal(h.take(near, 'bogus').reason, 'bad-request');
  const rfar = r.take(far, 'planks'); flush();
  assert.deepEqual(await rfar, { ok: false, reason: 'far' }, 'a remote ask beyond BOAT.reach of the goal');
  assert.equal(h.has('planks'), false);
  const taken = [], rtaken = [];
  h.on((i) => i.kind === 'take' && taken.push(i)); r.on((i) => i.kind === 'take' && rtaken.push(i));
  const rok = r.take(near, 'planks'); flush();
  const res = await rok;
  assert.ok(res.ok); flush();
  assert.ok(h.has('planks') && r.has('planks') && host.hash() === replica.hash());
  assert.equal(taken.length, 1); assert.equal(rtaken.length, 1); assert.ok(taken[0].live && rtaken[0].part === 'planks');
  assert.equal(h.take(near, 'planks').reason, 'taken');
  assert.equal(JSON.parse(storage.get('infinite-island.emberleaf.v1')).boat.parts.planks, true);
  // the debug requests are host only
  const rdebug = replica.request('boat', 'debugReset', {}, { screen: 'screen-2', index: 1, pos: { x: 0, y: 0, z: 0 } }); flush();
  assert.equal((await rdebug).ok, false); assert.ok(h.has('planks'));
  h.debug.reset(); flush();
  assert.ok(!h.unlocked && !r.unlocked && host.hash() === replica.hash());
});
test('a saved boat reloads; a save with an unlocked garland and no boat key migrates to unlocked; ?testboat is unlocked without saving; a replica never reads the save', () => {
  resetSave();
  const a = pair();
  const first = createBoat({ sync: a.host });
  first.debug.unlock(); first.debug.take('planks');
  const second = createBoat({ sync: new WorldSync({ role: 'host' }) });
  assert.ok(second.unlocked && second.has('planks'));
  // the migration: re-read a fresh file where only garlands exist
  storage.set('infinite-island.emberleaf.v1', JSON.stringify({ v: 1, garlands: [0, 2] }));
  const file = emberSave.read(); delete file.boat; file.garlands = [0, 2];
  assert.ok(createBoat({ sync: new WorldSync({ role: 'host' }) }).unlocked, 'an old save that already earned a garland has feasted at Emberleaf');
  delete file.garlands;
  assert.ok(!createBoat({ sync: new WorldSync({ role: 'host' }) }).unlocked);
  file.garlands = [];
  assert.ok(!createBoat({ sync: new WorldSync({ role: 'host' }) }).unlocked, 'no garland, no unlock');
  // ?testboat
  const before = storage.get('infinite-island.emberleaf.v1');
  const t = createBoat({ sync: new WorldSync({ role: 'host' }), params: new URLSearchParams('testboat') });
  assert.ok(t.unlocked); t.debug.take('planks');
  assert.equal(storage.get('infinite-island.emberleaf.v1'), before, '?testboat never writes the save');
  // ?bridges=open does not unlock
  assert.ok(!createBoat({ sync: new WorldSync({ role: 'host' }), params: new URLSearchParams('bridges=open') }).unlocked);
  // a replica starts fresh whatever the file says
  file.boat = { unlocked: true };
  assert.ok(!createBoat({ sync: new WorldSync({ role: 'replica' }) }).unlocked);
});
test('the boat domain survives the stress harness actions: random unlock / reset / take sequences keep host and replica hashes equal', async () => {
  resetSave();
  const { host, replica, flush, connect } = pair();
  const h = createBoat({ sync: host }), r = createBoat({ sync: replica });
  connect();
  h.setGoals({ planks: { x: 0, z: 0, top: 0 } }); r.setGoals({ planks: { x: 0, z: 0, top: 0 } });
  let seed = 7;
  const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const p = { position: { x: 0, y: 0, z: 0 }, index: 0 };
  for (let i = 0; i < 200; i++) {
    const k = rng();
    if (k < 0.1) h.debug.reset(); else if (k < 0.35) h.debug.unlock(); else if (k < 0.6) (rng() < 0.5 ? h : r).take(p, 'planks'); else h.debug.take(PARTS[Math.floor(rng() * 4)]);
    flush();
    assert.equal(host.hash(), replica.hash(), `step ${i}`);
  }
});

// ---- the cove's meshes (Node: no DOM, but the geometry builds)
test('the cove builds in Node: Marlo\'s model is at most 8 draw calls, the cove dressing stays inside the +25 budget with the pads and the glint', async () => {
  const { createMarloModel } = await import('../public/js/npc/marlo.js');
  const m = createMarloModel();
  assert.ok(m.drawCalls <= 8 && m.drawCalls === 7, `Marlo: ${m.drawCalls}`);
  for (const k of ['rig', 'headGroup', 'armL', 'armR', 'tail']) assert.ok(m[k] && m[k].isObject3D);
  m.setBlink(1); m.dispose();
  const { createCove } = await import('../public/js/world/cove.js');
  const { createHopCourses } = await import('../public/js/world/hopCourses.js');
  const { clearCourses, courses } = await import('../public/js/game/hopLogic.js');
  clearCourses();
  const scene = new THREE.Scene(), sync = new WorldSync({ role: 'host' });
  const state = createBoat({ sync, params: new URLSearchParams('testboat') });
  const players = { list: [] };
  const hop = createHopCourses({ scene, players, sync });
  const cove = createCove({ scene, players, boat: state, hop });
  assert.equal(courses().length, 1, 'the course registers once on the unlock');
  assert.equal(cove.summary().partInteractable, true);
  cove.update(0.016); hop.update(0.016);
  const s = cove.summary(), hs = hop.summary();
  assert.ok(cove.built && s.visible);
  assert.ok(s.drawCalls + hs.drawCalls + 7 <= 25 + 0, `cove ${s.drawCalls} + pads ${hs.drawCalls} + Marlo 7`);
  assert.deepEqual(s.bundleAt.length, 3);
  // the planks go to the wreck on a take: silently when no screen watches
  state.debug.take('planks'); cove.update(0.016);
  assert.equal(cove.summary().partInteractable, false);
  clearCourses();
});

// 68b requests use the same saved host domain on every screen.
test('all three course parts: replica reach rejection, accepted take, rejected repeat, save and equal hashes', async () => {
  resetSave();
  const { partLayouts } = await import('../public/js/world/islands/emberParts.js');
  const { host, replica, flush, connect } = pair();
  const h = createBoat({ sync: host }), r = createBoat({ sync: replica });
  const goals = {};
  for (const [part, layout] of Object.entries(partLayouts())) {
    const p = layout.course.pads.find((p) => p.id === layout.course.goal);
    goals[part] = { x: p.x, z: p.z, top: p.top };
  }
  h.setGoals(goals); r.setGoals(goals); connect(); h.debug.unlock(); flush();
  for (const [part, goal] of Object.entries(goals)) {
    const far = r.take({ position: { x: goal.x + BOAT.reach + 2, y: 0, z: goal.z }, index: 0 }, part); flush();
    assert.equal((await far).reason, 'far');
    const near = r.take({ position: { ...goal, y: goal.top }, index: 0 }, part); flush();
    assert.ok((await near).ok); assert.ok(h.has(part) && r.has(part));
    const again = r.take({ position: { ...goal, y: goal.top }, index: 0 }, part); flush();
    assert.equal((await again).reason, 'taken');
    assert.equal(host.hash(), replica.hash());
    assert.equal(JSON.parse(storage.get('infinite-island.emberleaf.v1')).boat.parts[part], true);
  }
});

test('authority rejects floor and distant goal takes for host and replica; delayed sail result arms the original carrier body', async () => {
  resetSave();
  const {host,replica,flush,connect}=pair(), h=createBoat({sync:host}), r=createBoat({sync:replica});
  const goal={x:10,z:20,top:10.8};h.setGoals({sail:goal});r.setGoals({sail:goal});connect();h.debug.unlock();flush();
  for(const boat of [h,r])for(const position of [{x:15.8,z:20,y:10.8},{x:10,z:20,y:8.8},{x:10,z:20,y:11.7}]){
    const res=boat.take({index:0,position},'sail');flush();assert.equal((await res).reason,'far');
  }
  const p={index:0,position:{x:10,z:20,y:11.4},_cb:{}};
  const pending=r.take(p,'sail');p._cb={grounded:false};flush();
  assert.ok((await pending).ok);assert.ok(p._cb.glide && p._sailGlideArmed);
  assert.equal(host.hash(),replica.hash());
});
