// Boat repair presentation (68c): createBoatRepair({scene,players,avatars,world,sync,boat,hop,cove,marlo,sfx,music,hud}).
// update() maintains interactables, shared-clock bucket/rings, offhand pots and steam, bob deck, leaks and bilge.
// Rules and authority live in boatRepairLogic / boat; summary() reports conservative mesh draws (no new lights).
import * as THREE from 'three';
import { HOP_COURSE, BOAT_REPAIR as R } from '../config.js';
import { patched, nearRepair, streakHit, tarHeat, bilgeAt } from '../game/boatRepairLogic.js';
import { addInteractable, removeInteractable } from './interactables.js';
import { G, VERTEX_TOON, part, combine } from '../render/geo.js';
import { getHeight } from './terrain.js';
const B = HOP_COURSE.beat, TAU = Math.PI * 2;
const BOX = new THREE.BoxGeometry(1, 1, 1);
let potGeo;
function potGeometry() {
  return potGeo ||= combine([
    part(G.cyl8, '#69452d', { p: [0, 0, 0], s: [0.17, 0.22, 0.17] }),
    part(G.cyl8, '#27212b', { p: [0, 0.115, 0], s: [0.145, 0.025, 0.145] }),
    part(G.cyl8, '#ddbf8e', { p: [0, 0.1, 0], s: [0.18, 0.025, 0.18] }),
  ]);
}
export function createBoatRepair({ scene, players, avatars = null, world = null, sync, boat, hop, cove, marlo = null, sfx = null, music = null, hud = null }) {
  const L = boat.layout, group = new THREE.Group(); group.name = 'boat-repair'; scene.add(group);
  const items = new Map(), pots = new Map(), streaks = new Map(), pending = new Set();
  const gold = new THREE.Color('#bb8954'), dark = new THREE.Color('#302932'), sealed = new THREE.Color('#785637');
  const meshes = {}, dummy = new THREE.Object3D();
  let built = false, deckAdded = false, lastBeat = null, ducked = false, priorDuck = 1;
  const clock = () => sync.hostNow() / 1000;
  const say = text => hud?.toast(text, { icon: 'sparkle', duration: 2200 });
  const answer = (r, fn) => r?.then ? r.then(fn) : fn(r);
  function ask(kind, data, p) { answer(boat.request(kind, data, p), res => { if (!res?.ok) say(res?.reason === 'cooled' ? 'Back to the seep!' : 'Come closer, crew!'); }); }
  function nail(p, plank) {
    const key = `${p.index}:${plank}`, t = clock();
    if (pending.has(key)) return;
    const hits = streakHit(streaks.get(key), t, p.position, L.marks[plank]);
    streaks.set(key, hits);
    sfx?.play(hits.length ? 'clink' : 'bip', { pitch: hits.length ? 1.3 : 0.7, vol: 0.4 });
    say(hits.length ? `${hits.length}/${B.hits} on the beat!` : 'Catch the next beat!');
    if (hits.length < B.hits) return;
    pending.add(key); streaks.delete(key);
    answer(boat.request('nail', { plank, hits }, p), res => { pending.delete(key); if (!res?.ok) say('Catch four fresh beats!'); });
  }
  function item(id, at, prompt, action, range = R.reach) {
    if (!items.has(id)) items.set(id, addInteractable({ type: 'boatrepair', position: new THREE.Vector3(at.x, at.top ?? 0.3, at.z),
      radius: Math.max(0, range - 2.2), prompt, canInteract: pos => nearRepair(pos, at, range), onInteract: (_, by) => action(by || players.p1) }));
  }
  function gameplay() {
    const s = boat.state, wanted = new Set();
    const add = (id, ...args) => { wanted.add(id); item(id, ...args); };
    if (s.repair && !s.launched) {
      L.marks.forEach((at, i) => { if (s.nails[i] < 2) add(`nail-${i}`, at, 'Nail on the beat', p => nail(p, i)); });
      if (!s.seams.every(Boolean)) add('tar', L.seep, 'Fill hot tar pot', p => ask('tar', {}, p));
      L.seams.forEach((at, i) => { if (!s.seams[i]) add(`seal-${i}`, at, 'Seal with hot tar', p => ask('seal', { seam: i }, p)); });
      if (patched(s) && !s.floated && !s.float?.running) add('float', L.deck, 'Start leak test', p => ask('float', {}, p), R.leakReach);
      if (s.float?.running) for (const leak of s.float.leaks) if (leak.pluggedAt === null && clock() >= s.float.t0 + leak.at)
        add(`leak-${leak.id}`, L.spots[leak.spot], 'Plug leak', p => ask('plug', { leak: leak.id }, p), R.leakReach);
    }
    for (const [id, it] of items) if (!wanted.has(id)) { removeInteractable(it); items.delete(id); }
    if (patched(s) && !s.launched && !deckAdded) { hop.add(L.course, { island: 'ember' }); deckAdded = true; }
    else if ((!patched(s) || s.launched) && deckAdded) { hop.remove(L.course); deckAdded = false; }
  }
  function mesh(geo, mat = VERTEX_TOON) { const m = new THREE.Mesh(geo, mat); group.add(m); return m; }
  function instances(geo, n, mat = VERTEX_TOON) { const m = new THREE.InstancedMesh(geo, mat, n); m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; group.add(m); return m; }
  function transform(m, i, at, sx, sy, sz, ry = 0) {
    dummy.position.set(at.x, at.y ?? at.top ?? 0.3, at.z); dummy.rotation.set(0, ry, 0); dummy.scale.set(sx, sy, sz); dummy.updateMatrix(); m.setMatrixAt(i, dummy.matrix);
  }
  function build() {
    built = true;
    const y = getHeight(L.seep.x, L.seep.z);
    const bucket = cove.layout.frame.to(1.5, -5.2);
    meshes.dress = mesh(combine([
      part(G.ico1, '#514651', { p: [L.seep.x, y + 0.25, L.seep.z], s: [0.85, 0.5, 0.65] }),
      part(G.cyl8, '#28212b', { p: [L.seep.x, y + 0.49, L.seep.z], s: [0.6, 0.04, 0.4] }),
      part(G.cyl8, '#b88753', { p: [bucket.x, 0.6, bucket.z], s: [0.4, 0.6, 0.4] }),
      part(G.cyl8, '#ddbd85', { p: [bucket.x, 0.91, bucket.z], s: [0.42, 0.035, 0.42] }),
    ]));
    meshes.marks = instances(new THREE.CylinderGeometry(1, 1, 1, 12), 7, new THREE.MeshBasicMaterial({ color: '#ffffff' }));
    meshes.rings = instances(new THREE.RingGeometry(0.85, 1, 24).rotateX(-Math.PI / 2), 4, new THREE.MeshBasicMaterial({ color: '#ffe19b', side: THREE.DoubleSide }));
    meshes.planks = instances(BOX, 11, new THREE.MeshBasicMaterial({ color: '#ffffff' }));
    meshes.leaks = instances(new THREE.ConeGeometry(0.18, 0.65, 8), 15, new THREE.MeshBasicMaterial({ color: '#82d6ed' }));
    meshes.bilge = mesh(new THREE.BoxGeometry(1.3, 1, 5), new THREE.MeshBasicMaterial({ color: '#65bdd2', transparent: true, opacity: 0.48, depthWrite: false }));
    meshes.line = mesh(new THREE.BoxGeometry(1.4, 0.035, 0.05), new THREE.MeshBasicMaterial({ color: '#efb965' }));
    meshes.line.position.set(L.deck.x, R.deck.top + 0.35, L.deck.z + 2.55);
    const a = L.course.approach, dx = a.to.x - a.from.x, dz = a.to.z - a.from.z, len = Math.hypot(dx, dz), rise = a.to.y - a.from.y;
    meshes.gangplank = mesh(new THREE.BoxGeometry(a.width, 0.09, Math.hypot(len, rise)), new THREE.MeshBasicMaterial({ color: '#c39b68' }));
    meshes.gangplank.position.set((a.from.x + a.to.x) / 2, (a.from.y + a.to.y) / 2 - 0.05, (a.from.z + a.to.z) / 2);
    meshes.gangplank.rotation.set(-Math.atan2(rise, len), Math.atan2(dx, dz), 0);
  }
  function updatePots(full, t) {
    const visible = new Set();
    for (const p of [...players.list, ...(avatars?.list || [])]) {
      const key = `${players.list.includes(p) ? sync.screenId : p.screen}:${p.index}`, heat = tarHeat(boat.state.tar[key], t);
      if (p._offhandModel) p._offhandModel.visible = !heat;
      if (!heat || !full || !p.parts?.offhandSocket) continue;
      visible.add(p);
      let model = pots.get(p);
      if (!model) {
        model = new THREE.Group(); model.name = 'hot-tar-pot'; model.position.set(0, -0.02, 0.07);
        model.add(new THREE.Mesh(potGeometry(), VERTEX_TOON));
        const steam = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 4), new THREE.MeshBasicMaterial({ color: '#eee2d8', transparent: true, opacity: 0.7, depthWrite: false }));
        steam.position.y = 0.35; model.add(steam); pots.set(p, model);
      }
      if (model.parent !== p.parts.offhandSocket) p.parts.offhandSocket.add(model);
      model.visible = true; model.children[1].material.opacity = heat * 0.65;
      model.children[1].position.y = 0.28 + (t % 0.7) * 0.2;
      model.children[1].scale.set(0.7, 1.5, 0.7);
    }
    for (const [p, model] of pots) if (!visible.has(p)) {
      model.removeFromParent(); model.children[1].geometry.dispose(); model.children[1].material.dispose(); pots.delete(p);
      if (p._offhandModel) p._offhandModel.visible = true;
    }
  }
  boat.on(info => {
    if (info.kind === 'set' || info.kind === 'finishRepair') { streaks.clear(); pending.clear(); }
    if (!info.live) return;
    const s = boat.state;
    if (info.kind === 'nail' && s.planks === 8) { marlo?.cheer(); marlo?.say('Eight planks snug, crew!'); }
    if (info.kind === 'seal' && s.seams.every(Boolean)) { marlo?.cheer(); marlo?.say('Tar-tight, crew!'); }
    if ((info.kind === 'nail' || info.kind === 'seal') && patched(s)) marlo?.say('Heave-ho, crew! Up the gangplank!');
    if (info.kind === 'endFloat') { if (info.pass) marlo?.cheer(); marlo?.say(info.pass ? 'She floats! Now we need a course to sail...' : 'Ho ho! A swimming pool! Bailed out. Try again, crew!'); }
    if (info.kind === 'cool' && info.key?.startsWith(`${sync.screenId}:`)) say('Back to the seep!');
  });
  function restoreMusic() {
    if (!ducked) return;
    // Another scene may have taken the music bus while the crew was working.
    if (music && (music.duckLevel === undefined || music.duckLevel === Math.min(priorDuck, B.duck))) music.duck(priorDuck, 0.7);
    ducked = false;
  }
  function update() {
    boat.update(); gameplay();
    const s = boat.state, t = clock(), full = (!world?.regions || world.regions.isFull('ember')) && s.unlocked;
    group.visible = full && s.repair && !s.launched;
    updatePots(full, t);
    cove.setFloatPose?.(t);
    if (!group.visible) { marlo?.setRepairBeat?.(null); restoreMusic(); return; }
    if (!built) build();
    const allPlayers = [...players.list, ...(avatars?.list || [])];
    const nailing = s.planks < 8 && allPlayers.some(p => !p.away && !p.frozen && L.marks.some((at, i) => s.nails[i] < 2 && nearRepair(p.position, at)));
    if (nailing && !ducked) { priorDuck = music?.duckLevel ?? 1; ducked = true; music?.duck(Math.min(priorDuck, B.duck), 0.3); }
    else if (!nailing) restoreMusic();
    marlo?.setRepairBeat?.(nailing ? t : null);
    const beat = Math.floor(t / B.period);
    if (nailing && beat !== lastBeat && lastBeat !== null) sfx?.play('clink', { pitch: 0.55, vol: 0.35 });
    lastBeat = beat;

    const phase = (t / B.period) % 1;
    const w = cove.layout.wreck, ax = [Math.sin(w.yaw), Math.cos(w.yaw)], cross = [ax[1], -ax[0]];
    const hull = cove.hull?.position || { x: w.x, y: 0, z: w.z };
    meshes.marks.visible = meshes.rings.visible = !patched(s);
    L.marks.forEach((at, i) => {
      transform(meshes.marks, i, { ...at, y: at.top + 0.015 }, 0.34, 0.025, 0.34);
      meshes.marks.setColorAt(i, new THREE.Color(s.nails[i] === 2 ? '#85bf91' : '#e9bf62'));
      transform(meshes.rings, i, { ...at, y: at.top + 0.04 }, s.nails[i] < 2 ? 0.35 + (1 - phase) * 0.8 : 0, 1, s.nails[i] < 2 ? 0.35 + (1 - phase) * 0.8 : 0);
      for (let k = 0; k < 2; k++) {
        const along = -2.1 + i * 1.4;
        transform(meshes.planks, i * 2 + k, { x: hull.x + ax[0] * along - cross[0] * 0.67,
          z: hull.z + ax[1] * along - cross[1] * 0.67, y: hull.y + 0.95 + k * 0.18 }, s.nails[i] > k ? 0.12 : 0, 0.17, 1.2, w.yaw);
        meshes.planks.setColorAt(i * 2 + k, gold);
      }
    });
    L.seams.forEach((at, i) => {
      transform(meshes.marks, 4 + i, { ...at, y: at.top + 0.025 }, 0.27, 0.025, 0.45);
      meshes.marks.setColorAt(4 + i, new THREE.Color(s.seams[i] ? '#85bf91' : '#352939'));
      const along = -1.8 + i * 1.8;
      transform(meshes.planks, 8 + i, { x: hull.x + ax[0] * along + cross[0] * 0.65,
        z: hull.z + ax[1] * along + cross[1] * 0.65, y: hull.y + 0.85 }, 0.05, 0.3, 0.25, w.yaw);
      meshes.planks.setColorAt(8 + i, s.seams[i] ? sealed : dark);
    });
    meshes.gangplank.visible = meshes.bilge.visible = meshes.line.visible = patched(s);
    const bob = R.deck.bob * Math.sin(TAU * t / R.deck.period);
    const water = Math.max(0.001, Math.min(1, s.float?.running ? bilgeAt(s.float, t) : 0) * 0.35);
    meshes.bilge.position.set(L.deck.x, R.deck.top + bob + water / 2, L.deck.z); meshes.bilge.scale.y = water;
    meshes.line.position.y = R.deck.top + bob + 0.35;
    const open = s.float?.running ? s.float.leaks.filter(l => l.pluggedAt === null && t >= s.float.t0 + l.at) : [];
    meshes.leaks.count = open.length;
    open.forEach((l, i) => transform(meshes.leaks, i, { ...L.spots[l.spot], y: R.deck.top + bob + 0.3 }, 1, 0.8 + 0.2 * Math.sin(t * 10 + i), 1));
    for (const m of [meshes.marks, meshes.rings, meshes.planks, meshes.leaks]) m.instanceMatrix.needsUpdate = true;
    meshes.marks.instanceColor.needsUpdate = meshes.planks.instanceColor.needsUpdate = true;
  }
  return { update, group, layout: L, nail,
    summary() { let calls = 0, triangles = 0; group.traverseVisible(o => { if (o.isMesh) { calls++; triangles += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1); } });
      return { built, deckAdded, items: items.size, pots: pots.size, drawCalls: calls + pots.size * 2, triangles, ducked }; },
  };
}
