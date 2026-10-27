// Step 74d debug harness, instantiated once only for ?mechlab. createMechlab({...}) ->
// {carry,warm,guide,ice,drive(player,actions),update(dt),goto(kind),summary()}.
// Registrations live outside visual rebuilds. No quest, unlock, inventory or persistence writes.
// Consumers can instantiate the four runtimes independently without this debug world.
import * as THREE from 'three';
import { createCarry } from '../game/carry.js';
import { createWarm } from '../game/warm.js';
import { createGuide } from '../game/guide.js';
import { createIce } from '../game/ice.js';
import { courseAt, surfaceAt, padPos, hopEvents } from '../game/hopLogic.js';
import { mechlabPlan } from './islands/mechlabPlan.js';
import { getHeight, isWalkable } from './terrain.js';
import { overlapsAny } from './colliders.js';
import { addInteractable } from './interactables.js';
import { G, VERTEX_TOON, combine, part } from '../render/geo.js';
import { createWipPetModel } from '../npc/petsWip.js';
export function createMechlab({ scene, players, avatars, sync, hop, items, fire, world, particles, followCam, sfx = null }) {
  if (sync.isHost && fire.fuel <= 0) fire.setFuel(180);
  const plan = mechlabPlan(), clock = () => sync.hostNow() / 1000;
  const all = () => [...players.list, ...avatars.list];
  const keyOf = p => `${players.list.includes(p) ? sync.screenId : p.screen}:${p.index}`;      // a LOCAL player's `screen` is its input device ("local", "pad:0"): its actor key uses this screen's id, like sync.actorFor; an avatar's `screen` is its owner screen
  const actors = () => all().filter(p => !p.away && !p.leaving).map(p => ({ key: keyOf(p), pos: { x: p.position.x, y: p.position.y, z: p.position.z }, yaw: p.facing, p }));
  const safe = (x, z, y) => {
    if (overlapsAny(x, z, .3)) return null;
    const c = courseAt(x, z);
    if (c) { const s = surfaceAt(c, x, z, clock(), y, { height: getHeight }); return Number.isFinite(s.y) ? s.y : null; }
    return isWalkable(x, z) ? getHeight(x, z) : null;
  };
  const checkpoints = new Map();
  function checkpoint(key) {
    const a = actors().find(a => a.key === key), p = a?.p;
    if (p?._course && p._cb?.checkpoint) {
      const pad = p._course.pads.find(q => q.id === p._cb.checkpoint), at = padPos(pad, clock());
      return { x: at.x, y: at.top, z: at.z };
    }
    return checkpoints.get(key) || plan.carry;
  }
  const carry = createCarry({ sync, defs: [{ id: 'snowball', carryable: true, ...plan.carry }], safe, actors, checkpoint });
  const warm = createWarm({ sync, ids: ['snowball'], context: id => ({ pos: carry.state.objects[id], fire: plan.fire, fuel: fire.fuel, carried: !!carry.state.objects[id].carrier }) });
  const guide = createGuide({ sync, paths: { wolf: plan.path }, players: () => actors().map(a => ({ key: a.key, ...a.pos, fall: !!a.p._splashing || a.pos.y < .1 })) });
  const ice = createIce({ sync, pads: plan.floes.pads, actors, clock });
  hop.add(plan.floes, { island: 'frost' }); hop.add(plan.guideCourse, { island: 'frost' });
  const root = new THREE.Group(); root.name = 'mechlab'; scene.add(root);
  const snowGeo = combine([
    part(G.sphereLo, '#c7eaff', { p: [0, .38, 0], s: [.42, .4, .4] }),
    ...[-1, 1].map(s => part(G.sphereLo, '#2b2340', { p: [s * .14, .48, .35], s: [.05, .065, .04] })),
  ]);
  const snowMat = VERTEX_TOON.clone(); snowMat.stencilWrite = true; snowMat.stencilRef = 1; snowMat.stencilZPass = THREE.ReplaceStencilOp;
  const snow = new THREE.Mesh(snowGeo, snowMat); root.add(snow);
  const wolf = createWipPetModel('snowsong'); root.add(wolf.root);
  const markers = combine([
    part(G.cyl8, '#486b90', { p: [-26, 1.89, -133], s: [3, .02, 3] }),
    ...plan.path.map(p => part(G.cyl8, p.hop ? '#ffd177' : '#9acfe8', { p: [p.x, p.y + .02, p.z], s: [.3, .04, .3] })),
  ]);
  const marks = new THREE.Mesh(markers, VERTEX_TOON); root.add(marks);
  const target = addInteractable({ type: 'carryable', position: new THREE.Vector3(), radius: .4, prompt: 'Pick up',
    canInteract: () => root.visible && !carry.state.objects.snowball.carrier,
    onInteract: (_, p) => carry.pick(p, 'snowball') });
  const lead = addInteractable({ type: 'guide', position: new THREE.Vector3(), radius: .5, prompt: 'Follow me',
    canInteract: () => root.visible && !guide.state.wolf.running, onInteract: (_, p) => guide.start('wolf', p) });
  const catches = new Map(), hidden = new Map();
  const priorSplash = hopEvents.onSplash, priorCatch = hopEvents.onCatch;
  const fall = p => {
    if (!carry.carried(keyOf(p))) return;
    carry.fall(p);
    particles?.burst('puff', checkpoint(keyOf(p)), { count: 7, radius: .5, color: '#e1f5ff' });
  };
  hopEvents.onSplash = (...args) => { priorSplash?.(...args); fall(args[0]); };
  hopEvents.onCatch = (...args) => { priorCatch?.(...args); fall(args[0]); };
  function update(dt) {
    carry.update(); ice.update(); warm.update(dt); guide.update(dt);
    root.visible = !world || !world.regions || world.regions.isFull('frost');
    const o = carry.state.objects.snowball, carrier = actors().find(a => a.key === o.carrier);
    for (const [r, prior] of hidden) if (!carry.carried(prior.key) || (r.holderKey ? r.holderKey !== prior.key : r.holder !== prior.holder)) { r.pivot.visible = prior.visible; hidden.delete(r); }
    for (const p of all()) {
      const carrying = !!carry.carried(keyOf(p)); p.carrying = carrying;
      const rec = items.heldBy(p) || items.heldByKey?.(keyOf(p));
      if (carrying && rec) { if (!hidden.has(rec)) hidden.set(rec, { visible: rec.pivot.visible, key: keyOf(p), holder: p }); rec.pivot.visible = false; }
      if (!carrying) for (const [r, prior] of hidden) if (prior.key === keyOf(p)) { r.pivot.visible = prior.visible; hidden.delete(r); }
      if (sync.isHost && !p._splashing) {
        const c = courseAt(p.position.x, p.position.z);
        if (c) { const s = surfaceAt(c, p.position.x, p.position.z, clock(), p.position.y, { height: getHeight }); const cp = c.pads.find(q => q.id === s.pad && q.cp); if (cp && Math.abs(s.y - p.position.y) < .4) checkpoints.set(keyOf(p), { x: p.position.x, y: s.y, z: p.position.z }); }
        else if (isWalkable(p.position.x, p.position.z)) checkpoints.set(keyOf(p), { x: p.position.x, y: p.position.y, z: p.position.z });
      }
    }
    if (carrier) {
      const p = carrier.p;
      p.root.updateMatrixWorld(true);
      const chest = p.parts.rig.localToWorld(new THREE.Vector3(0, 1, .55));
      snow.position.copy(chest); snow.rotation.y = p.facing;
    } else { snow.position.set(o.x, o.y, o.z); }
    target.position.copy(snow.position);
    const heat = warm.state.snowball;
    snowMat.color.setRGB(.72 + heat * .28, .85 + heat * .15, 1);
    snowMat.emissive.set('#ffbd78'); snowMat.emissiveIntensity = heat * .12;
    snow.rotation.z = Math.sin(clock() * 26) * .035 * (1 - heat);
    if (heat > 0 && heat < 1 && !o.carrier && fire.fuel > 0 && Math.hypot(o.x - plan.fire.x, o.z - plan.fire.z) < 2.2 && Math.floor(clock() * 3) !== update.steam) {
      update.steam = Math.floor(clock() * 3); particles?.burst('puff', { x: o.x, y: o.y + .7, z: o.z }, { count: 1, radius: .15, height: .8, color: '#e4faff', size: .3 });
    }
    const g = guide.state.wolf; wolf.root.position.set(g.x, g.y, g.z);
    const next = plan.path[Math.min(g.index + 1, plan.path.length - 1)]; wolf.root.rotation.y = Math.atan2(next.x - g.x, next.z - g.z);
    wolf.update(dt, clock(), { anim: g.waiting ? 'wag' : g.running ? 'trot' : 'idle', speed: g.running && !g.waiting ? 3.2 : 0 });
    lead.position.copy(wolf.root.position);
    if (root.visible && g.waiting && clock() - (update.bark || 0) > 3) {
      update.bark = clock(); sfx?.play('squawk', { pitch: .55, vol: .25 });
    }
    for (const p of players.list) {
      const c = g.catches[keyOf(p)], last = catches.get(p);
      if (!c) { catches.delete(p); continue; }
      if (last !== c.serial) { catches.set(p, c.serial); p.teleport(c.x, c.z); p.position.y = c.y; particles?.burst('puff', p.position, { count: 7 }); }
    }
  }
  update(0);
  return { carry, warm, guide, ice, plan, update,
    drive(p, a) {
      if (!carry.carried(keyOf(p))) return false;
      if (a.interactPressed) carry.drop(p);
      else if (a.jumpPressed || a.cancelPressed) p.hop();
      return true;
    },
    goto(kind) {
      const at = kind === 'floes' ? { ...plan.floes.pads[0], y: .25 } : plan[kind];
      const p = players.list[0]; if (!at || !p) return false;
      p.teleport(at.x, at.z); p.position.y = at.y; if (kind === 'warm') p.facing = Math.PI; followCam?.snap(); return true;
    },
    summary: () => ({ plan, carry: carry.summary(), warm: warm.summary(), guide: guide.summary(), ice: ice.summary(), saved: false, drawCalls: 4, lights: 0 }),
  };
}
