// The pet followers (PLAN Step 73a): every player who chose a pet has it glide along beside them, on every screen. Pure rules are game/petLogic.js, the model npc/pets.js, the unlock domain game/petsDomain.js.
//
//   const pets = createPets({ scene, players, avatars, sync, domain, clock, atmosphere, storybook, dungeon, cinematic, particles, sfx, hud, floatLabel,
//                             heightAt, duskItems, isSailing, params })
//   pets.update(dt)                 once per tick, after the players / avatars moved and the camera cinematics ran (it builds, moves and disposes pets by itself)
//   pets.set(player, id | null, { fx })   this screen's player brings pet `id` (null = no pet); the choice is saved per screen. A pet that is not unlocked becomes none. Returns the id now brought.
//   pets.petOf(player) -> id | null; pets.unlocked; pets.domain (the unlock domain: unlock / onUnlock / questlinesOpen / has)
//   pets.prefs -> { slotIndex: petId }   pets.summary()   pets.debug.{ preview(id, player) }
//
// Owners: this screen's local players AND remote avatars. A pet is COSMETIC and per screen: it is moved locally from its owner's position and is never synced, saved or hashed. Only the choice travels, as pose field 16
// (net/poseBuffer.js `petId`, written from player.petIndex; net/avatars.js sets player.petIndex on remote avatars). Everything below runs the same for local and remote owners.
//
// Where pets show: islands, the boat crossing (it glides alongside; the owner's rendered place is the crossing wrapper, player.visualRoot), combat areas (it follows; it has no collider or interactable, so it can neither be targeted nor block),
// hidden on storybook pages and while the owner is downed or away or (a remote owner) out of draw range. While any other cinematic or a feast holds everyone it settles low beside its owner. Built lazily, disposed when the owner
// leaves or drops it. The follower flies: no colliders, no pathfinding. Poofs to the heel beyond PET.lost (regroup, travel, boat arrival, teleport); a quick swoop beyond PET.catchUp.
//
// Choices are saved per screen under localStorage 'infiniteIsland.pets' = { slotIndex: petId } (hosts and replicas alike; a cosmetic preference, not game state), re-applied when a player (re)joins. A pet that is not unlocked
// (e.g. after ?newgame) falls back to none, and the stale entry is forgotten once the real list is known.
import * as THREE from 'three';
import { stepCarleIdle, carleIdleDrive, nearestFlower } from '../game/carlePetLogic.js';
import { getInteractables } from './interactables.js';
import { islandAt } from './terrain.js';
import { PET } from '../config.js';
import {
  PET_IDS, petIndexOf, glideTarget, heelPoint, followStep, catchState, shouldPoof, poseStep, petMood, appearScale, createIdle, stepIdle, idleDrive,
  hideSpotOf, nearestGiant, clampPet, parsePetPrefs,
} from '../game/petLogic.js';
import { createPetModel, petUniforms } from '../npc/pets.js';

export const STORAGE_KEY = 'infiniteIsland.pets';
const lerp = (a, b, k) => a + (b - a) * k;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

function loadPrefs() {
  try { return parsePetPrefs(localStorage.getItem(STORAGE_KEY)); } catch { return {}; }
}
function savePrefs(prefs) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)); } catch { /* private mode / storage off: the choice just is not remembered */ }
}

export function createPets({
  scene, players, avatars = null, sync = null, domain, clock = null, atmosphere = null, storybook = null, dungeon = null, cinematic = null, particles = null, sfx = null,
  heightAt = () => 0, flowers = () => getInteractables().filter((it) => it.type === 'flower' && ['home', 'ember'].includes(islandAt(it.position.x, it.position.z)?.id)), duskItems = () => null, isSailing = () => false,
}) {
  const prefs = loadPrefs();
  const actors = new Map();                   // owner Player -> actor
  const restored = new WeakSet();
  const previewing = new WeakSet();           // debug previews are exempt from the "not unlocked" fallback
  const _v = new THREE.Vector3();
  const rng = Math.random;
  let time = 0, glowNow = PET.glowDay;
  const snd = (name, opts) => { if (sfx) sfx.play(name, opts); };
  const poof = (at, big = false) => {
    if (particles) {
      particles.burst('puff', at, { count: big ? 8 : 5, radius: 0.45, height: 0.15 });
      particles.burst('sparkle', at, { count: 4, radius: 0.5, height: 0.3, color: '#9ff2ff' });
    }
    snd('pop', { pitch: 1.5, vol: 0.4 });
  };

  // ---- the owner's rendered place (the boat crossing moves a wrapper group, not the authoritative position)
  function anchor(owner, out) {
    const v = owner.visualRoot;
    if (v && owner.root) return out.copy(v.position).applyQuaternion(owner.root.quaternion).add(owner.root.position);
    return out.copy(owner.position);
  }

  // ---- per-screen choice
  const unlockedIds = () => domain.unlocked;
  function applyPrefs() {
    if (!domain.known) return;
    for (const k of Object.keys(prefs)) if (!clampPet(prefs[k], unlockedIds())) { delete prefs[k]; savePrefs(prefs); }     // forget stale choices (?newgame)
    for (const p of players.list) {
      if (p.bot) continue;                                    // (a party bot wears its own ears and brings no pet: Step 80a)
      if (!restored.has(p)) {
        restored.add(p);
        const want = clampPet(prefs[String(p.index)], unlockedIds());
        p.petIndex = want ? petIndexOf(want) : -1;
      } else if (p.petIndex >= 0 && !previewing.has(p) && !domain.has(PET_IDS[p.petIndex])) p.petIndex = -1;
    }
  }
  function set(p, id, { fx = true } = {}) {
    if (!p) return null;
    const want = clampPet(id, unlockedIds());
    p.petIndex = want ? petIndexOf(want) : -1;
    restored.add(p); previewing.delete(p);
    if (players.list.includes(p)) {
      if (want) prefs[String(p.index)] = want; else delete prefs[String(p.index)];
      savePrefs(prefs);
    }
    if (fx && want) snd('equip', { pitch: 1.2, vol: 0.5 });
    return want;
  }
  const petOf = (p) => (p && p.petIndex >= 0 ? PET_IDS[p.petIndex] || null : null);
  domain.onChange(() => applyPrefs());
  players.on('join', () => applyPrefs());

  // Carle drives the model's glide/flap/rest animation; the Capray sway/rocking options are unchanged.
  // ---- actors
  function makeActor(owner, local) {
    const id = petOf(owner);
    const model = createPetModel(id);
    model.root.visible = false;
    model.root.rotation.order = 'YXZ';
    scene.add(model.root);
    return {
      owner, local, id, model, shown: false, appearT: 0, phase: rng() * 6.28,
      s: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }, pose: { yaw: 0, roll: 0, pitch: 0, yawRate: 0 },
      idle: createIdle(rng), ownerPos: new THREE.Vector3(), lastPos: new THREE.Vector3(), lastSet: false, ownerVel: { x: 0, y: 0, z: 0 }, heading: 0,
      mode: 'awake', idleKind: null, dist: 0, catching: false,
    };
  }
  function drop(a) {
    if (a.shown && particles) poof({ x: a.s.x, y: a.s.y, z: a.s.z });
    a.model.dispose();
    actors.delete(a.owner);
  }

  function eligible(owner, local) {
    if (owner.away || owner.downed || owner.leaving) return false;
    if (!local && owner.root && !owner.root.visible) return false;               // a remote owner that is culled / waiting for its first pose
    if (storybook && storybook.contains(owner)) return false;
    return true;
  }

  function stepActor(a, dt) {
    const o = a.owner, carle = a.id === 'carle';
    const petCfg = carle ? { ...PET, ...PET.carle } : PET;
    anchor(o, a.ownerPos);
    // owner velocity (finite difference, smoothed; a jump is a teleport and counts as standing still)
    let vx = 0, vy = 0, vz = 0;
    if (a.lastSet && dt > 0) {
      const dx = a.ownerPos.x - a.lastPos.x, dy = a.ownerPos.y - a.lastPos.y, dz = a.ownerPos.z - a.lastPos.z;
      if (Math.hypot(dx, dz) < 3) { vx = dx / dt; vy = dy / dt; vz = dz / dt; }
    }
    a.lastPos.copy(a.ownerPos); a.lastSet = true;
    const kv = 1 - Math.exp(-12 * dt);
    a.ownerVel.x = lerp(a.ownerVel.x, vx, kv); a.ownerVel.y = lerp(a.ownerVel.y, vy, kv); a.ownerVel.z = lerp(a.ownerVel.z, vz, kv);
    const speed = Math.hypot(a.ownerVel.x, a.ownerVel.z);
    // heading: the owner's facing, or its travel direction while it moves fast (the crossing wrapper turns the visual, not the facing)
    const want = speed > 1.2 ? Math.atan2(a.ownerVel.x, a.ownerVel.z) : (o.facing || 0);
    a.heading = wrap(a.heading + wrap(want - a.heading) * (1 - Math.exp(-6 * dt)));

    const sailing = isSailing();
    const settle = !!cinematic && cinematic.busy && !sailing;
    const night = clock ? clock.nightness : 0, dusk = atmosphere ? atmosphere.duskWeight : 0;
    a.mode = petMood({ nightness: night, duskWeight: carle ? 0 : dusk });
    const sleepy = a.mode === 'sleepy';
    const owner = { x: a.ownerPos.x, y: a.ownerPos.y, z: a.ownerPos.z, facing: a.heading };

    const heel = heelPoint(owner, o.index ?? 0, { settle });
    const groundY = heightAt(heel.x, heel.z);
    let ty = glideTarget({ ground: groundY, t: time, phase: a.phase, sleepy, settle, cfg: petCfg });
    ty = Math.max(ty, owner.y + 0.65);
    let target = { x: heel.x, y: ty, z: heel.z };

    if (!a.shown) {                                                              // appear at the heel with a poof
      a.s.x = target.x; a.s.y = target.y; a.s.z = target.z; a.s.vx = a.s.vy = a.s.vz = 0;
      a.pose.yaw = a.heading; a.pose.roll = a.pose.pitch = a.pose.yawRate = 0;
      a.shown = true; a.appearT = 0; a.model.root.visible = true;
      poof({ x: a.s.x, y: a.s.y, z: a.s.z }, true);
    }
    let dist = Math.hypot(target.x - a.s.x, target.z - a.s.z);
    if (shouldPoof(dist) || Math.abs(target.y - a.s.y) > PET.lost) {             // too far: regroup / travel / teleport / boat arrival
      poof({ x: a.s.x, y: a.s.y, z: a.s.z });
      a.s.x = target.x; a.s.y = target.y; a.s.z = target.z; a.s.vx = a.s.vy = a.s.vz = 0;
      a.appearT = 0; dist = 0;
      poof({ x: a.s.x, y: a.s.y, z: a.s.z }, true);
    }
    a.dist = dist;

    // idles (the owner standing still)
    const flower = carle ? nearestFlower(flowers(), owner) : null;
    const items = !carle && dusk > 0.5 && !settle ? duskItems() : null;
    const giant = items ? nearestGiant(items, owner.x, owner.z) : null;
    const hide = hideSpotOf(giant, owner);
    const inCombat = !!dungeon && dungeon.contains(o);
    const kind = (carle ? stepCarleIdle : stepIdle)(a.idle, dt, {
      flower,
      ownerStill: speed < 0.4, canIdle: !settle && !inCombat && !sailing, hide: !!hide, sleepy,
      angle: Math.atan2(a.s.x - owner.x, a.s.z - owner.z), rng, cfg: PET,
    });
    a.idleKind = kind;
    let stiff = 1, extraRoll = 0, lookYaw = a.heading, tv = a.ownerVel;
    if (kind) {
      const d = (carle ? carleIdleDrive : idleDrive)(kind, a.idle.t / a.idle.dur, { owner, heel, flower, hideSpot: hide, idle: a.idle, heelDist: Math.hypot(owner.x - a.s.x, owner.z - a.s.z), cfg: PET });
      if (d.target && d.w > 0) {
        target = { x: lerp(target.x, d.target.x, d.w), y: lerp(target.y, d.target.y, d.w), z: lerp(target.z, d.target.z, d.w) };
        tv = { x: a.ownerVel.x * (1 - d.w), y: 0, z: a.ownerVel.z * (1 - d.w) };
        stiff = d.stiff;
      }
      extraRoll = d.roll;
      if (d.yaw !== null && d.yaw !== undefined) lookYaw = d.yaw;
    }

    const catching = !kind && catchState(Math.hypot(target.x - a.s.x, target.z - a.s.z));
    a.catching = catching;
    const cfg = stiff === 1 ? petCfg : { ...petCfg, spring: petCfg.spring * stiff };
    followStep(a.s, target, tv, dt, { catching: catching || sailing, slow: sailing ? PET.sailSpeed : sleepy ? PET.sleepyScale : settle ? 0.6 : 1, cfg });
    poseStep(a.pose, { vx: a.s.vx, vy: a.s.vy, vz: a.s.vz }, lookYaw, dt);
    if (kind === 'head' || kind === 'hide' || kind === 'nuzzle' || kind === 'shoulder' || kind === 'flower') { const dy = wrap(lookYaw - a.pose.yaw); a.pose.yaw = wrap(a.pose.yaw + dy * (1 - Math.exp(-5 * dt))); }

    // pose onto the model
    a.appearT += dt;
    const m = a.model;
    m.root.position.set(a.s.x, a.s.y, a.s.z);
    m.root.rotation.y = a.pose.yaw;
    m.rig.rotation.x = a.pose.pitch + (catching ? 0.22 : 0);
    m.rig.rotation.z = a.pose.roll + extraRoll;
    m.root.scale.setScalar(appearScale(a.appearT));
    a.anim = carle && ((kind && kind !== 'loop' && a.idle.t / a.idle.dur > 0.2 && a.idle.t / a.idle.dur < 0.82) || settle) ? 'rest' : carle && (catching || (time + a.phase) % PET.carle.flapPeriod < PET.carle.flapBurst || kind === 'loop') ? 'flap' : 'glide';
    m.update(dt, time + a.phase, { anim: a.anim, sway: 0.7 + Math.min(1, Math.hypot(a.s.vx, a.s.vz) / 4) * 0.6, rocking: 1 });
  }

  function hideActor(a) {
    if (!a.shown) return;
    a.shown = false;
    a.model.root.visible = false;
    a.lastSet = false;
    a.idle.kind = null;
  }

  function update(dt) {
    dt = Math.min(dt, 0.1);
    time += dt;
    if (!domain.known) return;
    applyPrefs();
    // owners: local players + remote avatars
    const owners = [];
    for (const p of players.list) owners.push([p, true]);
    if (avatars) for (const p of avatars.list) owners.push([p, false]);
    const live = new Set();
    for (const [p, local] of owners) {
      const id = petOf(p);
      let a = actors.get(p);
      if (a && a.id !== id) { drop(a); a = null; }
      if (!id) continue;
      if (!a) { a = makeActor(p, local); actors.set(p, a); }
      live.add(p);
      if (!eligible(p, local)) { hideActor(a); continue; }
      stepActor(a, dt);
    }
    for (const a of [...actors.values()]) if (!live.has(a.owner)) drop(a);
    // the shared material: wing ripple clock and the glow (day -> night / Duskcrown)
    petUniforms.uTime.value += dt;
    const glowWant = lerp(PET.glowDay, PET.glowNight, Math.max(clock ? clock.nightness : 0, atmosphere ? atmosphere.duskWeight : 0));
    glowNow = lerp(glowNow, glowWant, 1 - Math.exp(-3 * dt));
    petUniforms.uGlow.value = glowNow;
  }

  const summary = () => ({
    unlocked: domain.unlocked, known: domain.known, prefs: { ...prefs },
    pets: [...actors.values()].map((a) => ({
      owner: a.owner.index, local: a.local, id: a.id, shown: a.shown, mode: a.mode, idle: a.idleKind, anim: a.anim, catching: a.catching, dist: +a.dist.toFixed(2),
      pos: { x: +a.s.x.toFixed(2), y: +a.s.y.toFixed(2), z: +a.s.z.toFixed(2) }, scale: +a.model.root.scale.x.toFixed(2),
      drawCalls: a.shown ? a.model.drawCalls : 0,
    })),
    drawCalls: [...actors.values()].reduce((n, a) => n + (a.shown ? a.model.drawCalls : 0), 0), glow: +glowNow.toFixed(2),
  });

  return {
    update, set, petOf, summary, domain,
    get unlocked() { return domain.unlocked; },
    get prefs() { return { ...prefs }; },
    get count() { return actors.size; },
    actorOf: (p) => actors.get(p) || null,
    debug: {
      /** Put pet `id` on a local player for a look: no unlock needed, nothing saved. */
      preview(id, p = players.p1) { p.petIndex = petIndexOf(id); restored.add(p); previewing.add(p); return actors.get(p) || null; },
    },
  };
}
