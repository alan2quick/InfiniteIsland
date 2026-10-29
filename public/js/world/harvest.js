// Chopping trees / palms and breaking rocks (PLAN Step 10). Owns per-target hit counts, hit wobble, the felling and
// shattering animations, stumps, rock shards and the regrowth timers.
//
//   const harvest = createHarvest({ scene, players, items, particles, hud, sfx, interactions, props, pickups, camera: followCam, hitStop, sync, extraTargets });
//       (extraTargets, Step 29a: Groups of choppable trees / breakable boulders that are NOT in props.handles, i.e. the big islands'; each has
//        userData.interactable and, for an instanced one, userData.binding (islands/frostWorld.js). userData.variant selects its loot (world/lootTable.js).)
//       (pickups: a felled tree drops 2-3 logs (+ sometimes apples / peaches), a palm 1 log + its coconuts, as walk-over pickups;
//        any chop may also knock one fruit loose)
//   harvest.hit(interactable, player)   // that player pressed Interact on a tree / palm / rock with a capable tool: starts ITS swing and
//                               // schedules the hit for the swing's impact frame. Returns false if it was ignored (that player is already
//                               // swinging, not capable, ...). Each player has its own pending hit; hit counts are shared per target.
//   harvest.release(player)     // a player left: forget its pending hit
//   harvest.update(dt)          // once per tick, AFTER player.update / items.update
//   harvest.states              // debug: [{ type, x, z, state, hits, regrowIn }] for every target touched so far
//   harvest.regrowNow()         // debug: fast-forward every regrowth timer (skips the "player is standing there" deferral too)
//
// World sync (Step 22b, domain 'harvest'; see net/worldSync.js). Target ids = the interactable id of the tree / palm / rock (props are built
// identically on every screen, so the ids match). AUTHORITY (host): the shared hit count per target (HitTracker, every actor adds up), what is
// felled / broken and the regrowth timers (RegrowSchedule). Everything else (wobble, toppling, stumps, shards, particles, sounds) is cosmetic
// and replayed locally from events.
//   Swing: each screen plays its own player's swing; at the impact frame it asks the host: request hit {id, face}. The host validates (target idle,
//          the actor holds a capable tool, a remote actor is within reach), adds the hit, and broadcasts the event
//          hit {id, dx, dz, final, saber, actor}  (dx, dz = unit direction from the hitting actor to the target = the direction a tree falls).
//          Every screen plays the chip / wobble; on `final` the tree topples (stump appears) or the rock shatters. Camera shake + hit-stop only
//          happen on the screen of the actor who hit. Log / coconut drops are rolled by the host at the tree's impact frame (pickups 'spawn').
//   Regrowth: host only. When a timer is due and nobody stands on the spot (local players AND remote actors, by their last reported positions;
//          a remote position older than 30 s is ignored) the host emits regrow {id}; every screen then plays the sapling / rock emerging animation.
//   Snapshot {down: [{id, in}]}: every target that is felled / broken right now (+ seconds until its regrowth). A joining screen shows stumps /
//          missing rocks instantly. hashView = the sorted ids of the down targets.
//   Debug request regrowNow {} (host: every timer due now).
//
// Target state machine
//   tree / palm:  idle -> falling (topple, bounce, sink; stump appears) -> stump (regrow timer) -> growing (sapling scales up) -> idle
//   rock:         idle -> shattered (shards fly, bounce, shrink) -> gone (regrow timer) -> emerging (rises out of the ground) -> idle
// Step 86a (Homesteading): a target can also be 'removed' (a permanent tombstone: harvest.retire(group)). It is hidden, its interactable / collider / stump are gone, its regrowth timer is cancelled and it
// never appears in a snapshot or regrows; its id stays reserved, so no other id shifts. Objects the players plant at runtime join with harvest.adopt(group) (their interactable id is a fixed
// HOMESTEAD.placedIdBase + pid, the same on every screen) and leave with harvest.forget(group).
// While a target is not 'idle' its interactable and collider are removed from the registries (the same interactable object is put
// Step 86c (Shape): harvest.removeForGood(group, { dx, dz, tool, actor, onDone }) is ONE final hit that never regrows: it runs the normal chip + fell / shatter animation (applyHit with final: true, so the host's drops are the
// normal full-chop / full-break drops), and when the animation ends the target is retired for good (stump gone, state 'removed') and onDone() runs. A target that is already down is retired at once.
// back on regrowth so references such as group.userData.interactable stay valid). Geometry is never rebuilt per hit: trees / rocks
// are hidden and restored, stumps come from a small pool that shares one geometry + material, shards from a pool sharing one too.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { PALETTE } from '../config.js';
import { getHeight } from './terrain.js';
import { addCollider, removeCollider, getColliders } from './colliders.js';
import { removeInteractable, restoreInteractable, getInteractables } from './interactables.js';
import { toonMat, addOutline } from '../render/toon.js';
import { getToolAction, toolHits, actionForKind, bonusLogs, toolReachBonus } from '../items/tools.js';
import { HitTracker, RegrowSchedule } from './harvestLogic.js';
import { actorKey } from '../net/worldSync.js';
import { lootFor, rollCount, rollDrop, rollStone, rollRockRare } from './lootTable.js';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const HIT_MEMORY = 8;            // s without a hit before the count resets
const IMPACT = 0.45;             // swing progress at which the hit lands
const MAX_HIT_DIST = 4.6;        // if the player has walked this far away by the impact frame, the swing whiffs
const TREE_REGROW = 60;          // s
const ROCK_REGROW = 45;          // s
const NEAR_SPOT = 1.5;           // regrowth waits while a player is this close to the spot
const CHOP_FRUIT_CHANCE = 0.2;   // chance that a (non-final) chop knocks the tree's fruit loose (apple / peach / coconut)
const FELL_FRUIT_CHANCE = 0.6;   // chance that a felled apple / peach tree also drops 1-2 fruit (palms always drop their coconuts)
const REMOTE_HIT_SLACK = 1.6;    // the host accepts a REMOTE hit from MAX_HIT_DIST + this (latency: positions come with the request)
const STUMP_R = 0.35;
const GROW_TIME = 3;
const EMERGE_TIME = 1.2;
const SHARD_POOL = 24;

// tree felling timeline (s)
const FALL_T = 0.6, BOUNCE_T = 0.25, REST_T = 0.35, SINK_T = 0.8;
const FALL_ANGLE = 82 * DEG, BOUNCE_ANGLE = 11 * DEG;

const rnd = (a, b) => a + Math.random() * (b - a);
const fruitOf = (T) => (T.type === 'palm' ? 'coconut' : (T.g.userData.cherry ? 'peach' : 'apple'));   // same fruit a shake drops (interactions.js)
const easeOutBack = (u) => { const c = 1.70158, v = u - 1; return 1 + (c + 1) * v * v * v + c * v * v; };
const easeOutCubic = (u) => 1 - Math.pow(1 - u, 3);
const Y = new THREE.Vector3(0, 1, 0);

/** Position-only, welded, smooth-normal copy: gives closed, even inverted-hull outlines on faceted / merged shapes. */
function smoothOutlineGeo(geo) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', geo.attributes.position.clone());
  const m = mergeVertices(g, 1e-3);
  m.computeVertexNormals();
  return m;
}
function outlineWith(mesh, outlineGeo, thickness) {
  const tmp = new THREE.Mesh(outlineGeo);
  const o = addOutline(tmp, thickness);
  tmp.remove(o);
  mesh.add(o);
  return o;
}

/** One short trunk stump with rings on top; vertex coloured so a single geometry + material serves every stump. */
function buildStumpGeometry() {
  const H = 0.45, rTop = 0.34, rBot = 0.52;
  const paint = (geo, hex) => {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    const c = new THREE.Color(hex);
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return g;
  };
  const parts = [];
  const body = new THREE.CylinderGeometry(rTop, rBot, H, 12, 1);
  body.translate(0, H / 2, 0);
  parts.push(paint(body, PALETTE.trunk));
  const topY = H + 0.006;
  const disc = new THREE.CircleGeometry(rTop * 0.97, 14); disc.rotateX(-Math.PI / 2); disc.translate(0, topY, 0);
  parts.push(paint(disc, '#efd3a0'));
  const mkRing = (r0, r1, hex, dy) => {
    const g = new THREE.RingGeometry(r0, r1, 14); g.rotateX(-Math.PI / 2); g.translate(0, topY + dy, 0);
    parts.push(paint(g, hex));
  };
  mkRing(0.05, 0.1, '#c98d5a', 0.004);
  mkRing(0.18, 0.225, '#d9a86e', 0.004);
  mkRing(0.29, 0.335, '#b57a4e', 0.004);
  const geo = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  body.dispose(); disc.dispose();
  const outlineBase = new THREE.CylinderGeometry(rTop, rBot, H, 12, 1);
  outlineBase.translate(0, H / 2, 0);
  const outlineGeo = smoothOutlineGeo(outlineBase);
  outlineBase.dispose();
  return { geo, outlineGeo };
}

export function createHarvest({ scene, players, items, particles, hud, sfx = null, interactions, props, pickups = null, camera = null, hitStop = null, sync, extraTargets = [], collectFind = () => {} }) {
  const snd = (name, opts) => { if (sfx) sfx.play(name, opts); };
  let time = 0;
  const pendings = new Map();               // Player -> { player, T, action, kind, need, t } - that player's hit waiting for its swing's impact frame
  const targets = new Map();                // group -> T
  const tById = new Map();                  // interactable id -> T (the stable target id of the sync protocol)
  const itemById = new Map();               // interactable id -> interactable (every tree / palm / rock)
  for (const g of [...props.handles.trees, ...props.handles.palms, ...props.handles.rocks, ...extraTargets]) {
    const it = g.userData.interactable;
    if (it) itemById.set(it.id, it);
  }
  const tracker = new HitTracker(HIT_MEMORY);   // HOST: shared hit counts
  const regrow = new RegrowSchedule();          // HOST: regrowth timers (target id -> simulation time)

  const root = new THREE.Group();
  root.name = 'harvest';
  scene.add(root);

  // ------------------------------------------------------------------ shared resources: stumps + shards
  const stumpRes = buildStumpGeometry();
  const stumpMat = toonMat('#ffffff', { vertexColors: true });
  const stumpPool = [];
  function takeStump() {
    let s = stumpPool.find((m) => !m.visible && !m.userData.busy);
    if (!s) {
      s = new THREE.Mesh(stumpRes.geo, stumpMat);
      s.name = 'stump';
      s.castShadow = true; s.receiveShadow = true;
      outlineWith(s, stumpRes.outlineGeo, 0.05);
      s.visible = false;
      root.add(s);
      stumpPool.push(s);
    }
    s.userData.busy = true;
    return s;
  }
  function freeStump(s) { s.visible = false; s.userData.busy = false; }

  const shardGeo = new THREE.DodecahedronGeometry(1, 0);
  const shardOutlineGeo = smoothOutlineGeo(shardGeo);
  const shardMats = [PALETTE.rock, '#d6d2e8', '#9d98bb'].map((c) => toonMat(c));
  const shardPool = [];
  for (let i = 0; i < SHARD_POOL; i++) {
    const m = new THREE.Mesh(shardGeo, shardMats[i % shardMats.length]);
    m.name = 'rock-shard';
    m.castShadow = false; m.receiveShadow = false;   // tiny + short-lived: skip the shadow-pass draw calls
    outlineWith(m, shardOutlineGeo, 0.06);
    m.visible = false;
    m.userData.busy = false;
    root.add(m);
    shardPool.push(m);
  }

  // ------------------------------------------------------------------ targets
  function getT(item) {
    const g = item.object;
    let T = targets.get(g);
    if (T) return T;
    const col = getColliders().find((c) => c.owner === g) || null;
    T = {
      g, item, type: item.type,
      id: item.id, state: 'idle', t: 0,
      mesh: g.children[0],
      col: col ? { x: col.x, z: col.z, r: col.r } : { x: g.position.x, z: g.position.z, r: item.radius },
      collider: col,
      baseScale: g.scale.clone(), basePos: g.position.clone(), yaw: g.rotation.y,
      wob: null, stump: null, stumpCol: null, shards: [],
      dx: 0, dz: 1, axis: new THREE.Vector3(), qYaw: new THREE.Quaternion(), crown: new THREE.Vector3(), impacted: false,
    };
    targets.set(g, T);
    tById.set(T.id, T);
    return T;
  }
  const tFor = (id) => tById.get(id) || (itemById.has(id) ? getT(itemById.get(id)) : null);
  const isDown = (T) => T.state === 'falling' || T.state === 'stump' || T.state === 'shattered' || T.state === 'gone';

  const playerDist = (T, player) => Math.hypot(player.position.x - T.g.position.x, player.position.z - T.g.position.z);
  const minPlayerDist = (T) => players.list.reduce((m, p) => Math.min(m, playerDist(T, p)), Infinity);
  const nearRadius = (T) => NEAR_SPOT + (T.type === 'rock' ? T.col.r : 0.4);
  /** HOST: any player standing there (this screen's players or another screen's actors) defers regrowth. */
  const playerNear = (T) => minPlayerDist(T) < nearRadius(T) || sync.remoteActorNear(T.g.position.x, T.g.position.z, nearRadius(T));

  /** Direction from the hitting actor (position `pos`, facing `face` as a fallback when standing on the target) to the target (unit, XZ). */
  function awayDir(T, pos, face = 0) {
    let dx = T.g.position.x - pos.x, dz = T.g.position.z - pos.z;
    const l = Math.hypot(dx, dz);
    if (l < 0.05) { dx = Math.sin(face); dz = Math.cos(face); } else { dx /= l; dz /= l; }
    return { dx, dz };
  }
  const r3 = (v) => Math.round(v * 1000) / 1000;
  /** The local player (this screen) an actor stands for, or null (another screen's player). */
  const localPlayerOf = (actor) => (actor && actor.screen === sync.screenId ? players.get(actor.index) : null);

  function removeFromWorld(T) {
    interactions.stopAnim(T.item);
    removeInteractable(T.item);
    if (T.collider) { removeCollider(T.collider); T.collider = null; }
    stopWobble(T);
  }
  function restoreToWorld(T) {
    if (!T.collider) T.collider = addCollider({ x: T.col.x, z: T.col.z, r: T.col.r, owner: T.g });
    restoreInteractable(T.item);
  }

  // ------------------------------------------------------------------ hit wobble (canopy / rock mesh tilts away, damped)
  function startWobble(T, dx, dz, amp) {
    const c = Math.cos(T.g.rotation.y), s = Math.sin(T.g.rotation.y);
    T.wob = { t: 0, amp, lx: dx * c - dz * s, lz: dx * s + dz * c, dur: 0.7 };
  }
  function stopWobble(T) {
    if (!T.wob) return;
    T.wob = null;
    T.mesh.rotation.set(0, 0, 0);
    T.mesh.scale.set(1, 1, 1);
  }
  function updateWobble(T, dt) {
    const w = T.wob;
    if (!w) return;
    w.t += dt;
    if (w.t >= w.dur) { stopWobble(T); return; }
    const k = Math.exp(-6.5 * w.t) * Math.cos(TAU * 5.2 * w.t);
    T.mesh.rotation.z = -w.amp * k * w.lx;
    T.mesh.rotation.x = w.amp * k * w.lz;
    T.mesh.scale.y = 1 + 0.018 * k;
  }

  // ------------------------------------------------------------------ scheduling the hit
  /** `player` presses Interact with a chop / break capable tool. The swing starts now; the hit itself lands at the impact frame. */
  function hit(item, player = players.p1) {
    const held = items.heldBy(player);
    const action = getToolAction(held, item);
    if (!action || !item.object) return false;
    if (pendings.has(player) || player.swinging) return false;    // one swing at a time per player: extra presses are ignored
    const T = getT(item);
    if (T.state !== 'idle') return false;
    if (!items.swing(player)) return false;
    player.faceToward(item.position.x, item.position.z);
    pendings.set(player, { player, T, action, kind: held.kind, need: toolHits(held.kind, action), t: 0 });
    return true;
  }

  /** The swing reached its impact frame: ask the authority for the hit (host: decided right here; replica: the `hit` event comes back). */
  function applyPending(p) {
    pendings.delete(p.player);
    const T = p.T;
    if (T.state !== 'idle') return;                               // felled / broken by something else meanwhile
    if (p.player.leaving || playerDist(T, p.player) > MAX_HIT_DIST + toolReachBonus(p.kind)) return;
    sync.request('harvest', 'hit', { id: T.id, face: r3(p.player.facing || 0) }, sync.actorFor(p.player));
  }

  /** HOST: validate one actor's hit, add it to the shared count, then play + broadcast it. */
  function handleHit(d, actor) {
    const T = tFor(d.id);
    if (!T || !actor) return { reject: 'bad-target' };
    if (T.state !== 'idle') return { reject: 'down' };
    const held = items.heldByKey(actorKey(actor));
    const action = actionForKind(held && held.kind, T.item);
    const need = action ? toolHits(held.kind, action) : 0;
    if (!need) return { reject: 'no-tool' };
    if (actor.screen !== 'host' && Math.hypot(actor.pos.x - T.g.position.x, actor.pos.z - T.g.position.z) > MAX_HIT_DIST + toolReachBonus(held.kind) + REMOTE_HIT_SLACK) return { reject: 'far' };
    const { final } = T.type === 'ritualstone' ? { final: false } : tracker.hit(T.id, need, time);
    const { dx, dz } = awayDir(T, actor.pos, Number(d.face) || 0);
    const data = { id: T.id, dx: r3(dx), dz: r3(dz), final, saber: held.kind === 'lightsaber', toolKind: held.kind, actor: { screen: actor.screen, index: actor.index } };
    applyHit(data);
    if (final && T.type === 'rock') collectFind('break', T.g.position, actor, held.kind);
    sync.emit('harvest', 'hit', data);
    if (T.type === 'ritualstone') T.g.userData.onStrike?.(actor);
    if (!final && T.type !== 'rock' && T.type !== 'ritualstone' && pickups) {
      const loot = lootFor(T.g.userData.variant);
      if (loot) { const n = rollDrop(loot.chop); if (n) dropItems(loot.chop.item, crownWorld(T, new THREE.Vector3()), n); }   // big islands: the lootTable.js hook (nothing yet)
      else if (Math.random() < CHOP_FRUIT_CHANCE) dropFruit(T, crownWorld(T, new THREE.Vector3()), 1);
    }
    return true;
  }

  /** Every screen (host included): an actor's hit landed on a target. */
  function applyHit(d) {
    const T = tFor(d.id);
    if (!T || T.state !== 'idle') return;
    const { dx, dz, final, saber } = d;
    const mine = !!localPlayerOf(d.actor);                        // camera shake + hit-stop only for the screen that swung
    if (T.type === 'ritualstone') {
      // Never enter felling/shattering, even if an event incorrectly carries final=true.
      startWobble(T, dx, dz, 0.035);
      snd('clink');
      particles.burst('sparkle', { x: T.g.position.x - dx * 0.6, y: T.g.position.y + 1, z: T.g.position.z - dz * 0.6 }, { count: 4, radius: 0.18 });
      if (mine && hitStop) hitStop(0.035);
      return;
    }
    const rock = T.type === 'rock';

    // contact point on the side facing the player
    const sc = T.g.scale;
    const cx = T.g.position.x - dx * (rock ? 0.75 * sc.x : 0.5 * sc.x);
    const cz = T.g.position.z - dz * (rock ? 0.75 * sc.z : 0.5 * sc.z);
    const cy = T.g.position.y + (rock ? 0.1 * sc.y : 1.0 * sc.y);
    const spot = { x: cx, y: cy, z: cz };
    const dir = { x: -dx, z: -dz };
    particles.burst(rock ? 'shard' : 'chip', spot, { count: final ? 12 : 7, radius: 0.18, dir });
    if (saber) particles.burst('sparkle', spot, { count: 4, radius: 0.25, color: '#9be7ff', speed: 0.8 });
    snd(saber ? 'zap' : rock ? 'crack' : 'chop', { pitch: 0.94 + Math.random() * 0.12 });
    if (mine && camera) camera.shake(final ? 0.13 : 0.06, final ? 0.3 : 0.18);
    if (mine && hitStop) hitStop(final ? 0.075 : 0.05);

    if (final) { if (rock) shatter(T, dx, dz, d.toolKind); else fell(T, dx, dz, d.toolKind); }
    else startWobble(T, dx, dz, rock ? 0.06 : (T.type === 'palm' ? 0.1 : 0.07));
  }

  // ------------------------------------------------------------------ felling
  function placeStump(T) {
    const s = takeStump();
    s.position.set(T.g.position.x, T.basePos.y + 0.03, T.g.position.z);
    s.rotation.y = T.yaw;
    s.scale.setScalar(Math.max(0.85, T.baseScale.x));
    s.visible = true;
    T.stump = s;
    T.stumpCol = addCollider({ x: T.g.position.x, z: T.g.position.z, r: STUMP_R, owner: s });
  }
  function removeStump(T) {
    if (T.stump) { freeStump(T.stump); T.stump = null; }
    if (T.stumpCol) { removeCollider(T.stumpCol); T.stumpCol = null; }
  }

  function fell(T, dx, dz, toolKind) {
    T.fellTool = toolKind;
    removeFromWorld(T);
    tracker.reset(T.id);
    T.state = 'falling';
    T.t = 0;
    T.dx = dx; T.dz = dz;
    T.impacted = false;
    T.yaw = T.g.rotation.y;
    T.qYaw.setFromAxisAngle(Y, T.yaw);
    T.axis.set(dz, 0, -dx);                                        // tips the trunk toward (dx, dz): away from the player
    props.setWobble(T.g, false);
    placeStump(T);
    hud.toast('Timber!', { icon: 'sparkle' });
    snd('leaves', { vol: 0.7 });
  }

  const _q = new THREE.Quaternion();
  const _crown = new THREE.Vector3();
  function crownWorld(T, out) {
    const local = T.g.userData.topLocal ? T.g.userData.topLocal : _crown.set(0, 3.1, 0);   // (palms and the big islands' trees say where their crown is)
    T.g.updateMatrixWorld(true);
    return T.g.localToWorld(out.copy(local));
  }

  function treeImpact(T) {
    T.impacted = true;
    const c = crownWorld(T, T.crown);
    c.y = Math.max(c.y, getHeight(c.x, c.z) + 0.5);
    const cherry = !!T.g.userData.cherry;
    const palm = T.type === 'palm';
    const loot = lootFor(T.g.userData.variant);
    if (loot) {                                                     // the big islands' trees: needles + a puff of snow
      const needles = T.g.userData.variant === 'birch' ? '#b6d457' : '#3a8f62';
      particles.burst('leaf', c, { count: 18, radius: 1.8, ring: true, height: 0.6, speed: 1.3, color: needles });
      particles.burst('puff', c, { count: 8, radius: 1.5, ring: true, height: 0.5, speed: 1.1, color: '#f4f8ff', life: 1.4 });
    } else particles.burst(palm ? 'leaf' : (cherry ? 'petal' : 'leaf'), c, { count: palm ? 14 : 22, radius: palm ? 1.6 : 1.9, ring: true, height: 0.6, speed: 1.3 });
    particles.burst('puff', { x: c.x, y: getHeight(c.x, c.z) + 0.2, z: c.z }, { count: 6, radius: 1.2, ring: true });
    snd('timber');
    if (camera && minPlayerDist(T) < 14) camera.shake(0.11, 0.3);
    if (!pickups || !sync.isHost) return;                          // loot is rolled + spawned by the host (its pickups 'spawn' events reach everybody)
    // logs pop out of the stump toward the player's side (the tree itself lies on the far side); palms also shake their coconuts loose
    const logs = bonusLogs(loot ? rollCount(loot.logs) : palm ? 1 : 2 + (Math.random() < 0.5 ? 1 : 0), T.fellTool);
    for (let i = 0; i < logs; i++) {
      const sp = rnd(2.2, 3.6);
      const side = rnd(-1.3, 1.3);
      pickups.spawn(loot ? loot.log : 'log', { x: T.g.position.x - T.dx * 0.5, y: T.basePos.y + 0.8, z: T.g.position.z - T.dz * 0.5 }, {
        velocity: { x: -T.dx * sp + -T.dz * side, y: rnd(5.2, 6.6), z: -T.dz * sp + T.dx * side },
      });
    }
    if (loot) { const n = rollDrop(loot.fell); if (n) dropItems(loot.fell.item, c, n); }
    else if (palm) dropFruit(T, c, 2 + (Math.random() < 0.5 ? 1 : 0));
    else if (Math.random() < FELL_FRUIT_CHANCE) dropFruit(T, c, 1 + (Math.random() < 0.4 ? 1 : 0));
  }

  /** HOST: `n` of the tree's own fruit fall out of its crown at `c` (pickups 'spawn' events reach every screen). */
  function dropFruit(T, c, n) { dropItems(fruitOf(T), c, n); }
  function dropItems(kind, c, n) {
    for (let i = 0; i < n; i++) pickups.spawn(kind, { x: c.x + rnd(-0.4, 0.4), y: c.y + 0.2, z: c.z + rnd(-0.4, 0.4) });
  }

  function updateFalling(T, dt) {
    T.t += dt;
    const t = T.t;
    let ang;
    if (t < FALL_T) { const u = t / FALL_T; ang = FALL_ANGLE * Math.pow(u, 2.1); }
    else {
      if (!T.impacted) treeImpact(T);
      if (t < FALL_T + BOUNCE_T) { const v = (t - FALL_T) / BOUNCE_T; ang = FALL_ANGLE - BOUNCE_ANGLE * Math.sin(Math.PI * v) * (1 - 0.35 * v); }
      else ang = FALL_ANGLE;
    }
    T.g.quaternion.setFromAxisAngle(T.axis, ang).multiply(T.qYaw);
    const sinkStart = FALL_T + BOUNCE_T + REST_T;
    if (t > sinkStart) {
      const v = Math.min(1, (t - sinkStart) / SINK_T);
      const k = Math.max(0.001, 1 - v * v);
      T.g.scale.copy(T.baseScale).multiplyScalar(k);
      T.g.position.y = T.basePos.y - 0.6 * v;
      if (v >= 1) {
        T.g.visible = false;
        T.g.scale.copy(T.baseScale);
        T.g.position.copy(T.basePos);
        particles.burst('puff', { x: T.crown.x, y: T.crown.y, z: T.crown.z }, { count: 5, radius: 0.8 });
        particles.burst('leaf', T.crown, { count: 5, radius: 0.9, ring: true, height: 0.3, speed: 0.7 });
        T.state = 'stump';
        if (T.forever) retire(T.g);                          // Step 86c: removed for good, no regrowth
        else if (sync.isHost) regrow.set(T.id, time + TREE_REGROW);
      }
    }
  }

  function startGrowing(T) {
    T.state = 'growing';
    T.t = 0;
    T.g.rotation.set(0, T.yaw, 0);
    T.g.position.copy(T.basePos);
    T.g.scale.copy(T.baseScale).multiplyScalar(0.02);
    T.g.visible = true;
    props.setWobble(T.g, true);
    const p = { x: T.g.position.x, y: T.g.position.y + 0.4, z: T.g.position.z };
    particles.burst('puff', p, { count: 5, radius: 0.5 });
    particles.burst('sparkle', { x: p.x, y: p.y + 0.5, z: p.z }, { count: 5, radius: 0.5 });
    snd('pop', { pitch: 1.4, vol: 0.8 });
  }
  function updateGrowing(T, dt) {
    T.t += dt;
    const u = Math.min(1, T.t / GROW_TIME);
    const k = Math.max(0.02, easeOutBack(Math.pow(u, 1.7)));   // pops up from the stump, overshoots a little, settles
    T.g.scale.copy(T.baseScale).multiplyScalar(k);
    if (u >= 1) {
      T.g.scale.copy(T.baseScale);
      removeStump(T);
      restoreToWorld(T);
      T.state = 'idle';
      particles.burst('sparkle', { x: T.g.position.x, y: T.g.position.y + 2.5 * T.baseScale.y, z: T.g.position.z }, { count: 6, radius: 1.2 });
    }
  }

  // ------------------------------------------------------------------ rocks
  function shatter(T, dx, dz, toolKind) {
    removeFromWorld(T);
    T.state = 'shattered';
    T.t = 0;
    T.g.visible = false;
    const sc = T.g.scale;
    const size = (sc.x + sc.y + sc.z) / 3;
    const n = 5 + Math.floor(Math.random() * 4);
    const origin = new THREE.Vector3(T.g.position.x, T.g.position.y + 0.15 * sc.y, T.g.position.z);
    T.shards.length = 0;
    for (let i = 0; i < n; i++) {
      const m = shardPool.find((s) => !s.userData.busy);
      if (!m) break;
      m.userData.busy = true;
      const r = Math.min(0.5, (0.16 + Math.random() * 0.2) * (0.6 + 0.4 * size));
      const a = Math.random() * TAU;
      const sp = rnd(1.8, 4.2);
      const s = {
        m, r, x: origin.x + Math.cos(a) * 0.3 * sc.x, y: origin.y + rnd(0.1, 0.6) * sc.y, z: origin.z + Math.sin(a) * 0.3 * sc.z,
        vx: Math.cos(a) * sp + dx * 0.8, vy: rnd(3.2, 6.2), vz: Math.sin(a) * sp + dz * 0.8,
        sx: rnd(-9, 9), sy: rnd(-9, 9), sz: rnd(-9, 9), squash: rnd(0.65, 1.0), life: 0,
      };
      m.scale.set(r, r * s.squash, r);
      m.position.set(s.x, s.y, s.z);
      m.rotation.set(rnd(0, TAU), rnd(0, TAU), rnd(0, TAU));
      m.visible = true;
      T.shards.push(s);
    }
    const c = { x: origin.x, y: origin.y + 0.4 * sc.y, z: origin.z };
    particles.burst('puff', c, { count: 8, radius: 0.6 * sc.x, speed: 1.3, size: 1.6 });
    particles.burst('shard', c, { count: 10, radius: 0.5 * sc.x, speed: 1.1 });
    hud.toast('Crack!', { icon: 'sparkle' });
    if (pickups && sync.isHost) {                                  // loot is rolled + spawned by the host (its pickups 'spawn' events reach everybody)
      const loot = lootFor(T.g.userData.variant);
      const stones = rollStone(toolKind);
      const spawnLoot = (kind) => {
        const a = Math.random() * TAU, sp = rnd(1.6, 3.0);
        pickups.spawn(kind, { x: origin.x, y: origin.y + 0.5 * sc.y, z: origin.z }, { velocity: { x: Math.cos(a) * sp, y: rnd(4.6, 6.0), z: Math.sin(a) * sp } });
      };
      for (let i = 0; i < stones; i++) spawnLoot('stone');
      if (loot && loot.extra) for (let i = rollRockRare(loot.extra, toolKind); i > 0; i--) spawnLoot(loot.extra.item);
      if (loot && loot.ash) for (let i = rollCount(loot.ash); i > 0; i--) spawnLoot('ash');              // 38b: basalt crumbles to ash
    }
  }

  function updateShattered(T, dt) {
    T.t += dt;
    let alive = 0;
    for (const s of T.shards) {
      if (!s.m.visible) continue;
      s.life += dt;
      s.vy -= 22 * dt;
      s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
      const gy = getHeight(s.x, s.z) + s.r * 0.65;
      if (s.y < gy) {
        s.y = gy;
        if (s.vy < 0) {
          s.vy = -s.vy * 0.42;
          s.vx *= 0.62; s.vz *= 0.62; s.sx *= 0.6; s.sy *= 0.6; s.sz *= 0.6;
          if (s.vy < 1.3) s.vy = 0;
        }
      }
      s.m.position.set(s.x, s.y, s.z);
      s.m.rotation.x += s.sx * dt; s.m.rotation.y += s.sy * dt; s.m.rotation.z += s.sz * dt;
      const shrinkStart = 0.95;
      if (s.life > shrinkStart) {
        const v = Math.min(1, (s.life - shrinkStart) / 0.6);
        const k = Math.max(0.001, 1 - v * v);
        s.m.scale.set(s.r * k, s.r * s.squash * k, s.r * k);
        if (v >= 1) { s.m.visible = false; s.m.userData.busy = false; continue; }
      }
      alive++;
    }
    if (alive === 0 && T.t > 0.4) {
      T.shards.length = 0;
      T.state = 'gone';
      if (T.forever) retire(T.g);                            // Step 86c: removed for good, no regrowth
      else if (sync.isHost) regrow.set(T.id, time + ROCK_REGROW);
    }
  }

  function startEmerging(T) {
    T.state = 'emerging';
    T.t = 0;
    T.g.position.copy(T.basePos);
    T.g.position.y = T.basePos.y - 1.9 * T.baseScale.y;
    T.g.visible = true;
    restoreToWorld(T);                                             // solid from the start (regrowth waited for the player to leave)
    const p = { x: T.g.position.x, y: T.basePos.y + 0.2, z: T.g.position.z };
    particles.burst('puff', p, { count: 8, radius: 0.5 * T.baseScale.x, speed: 1.2, size: 1.5 });
    snd('thud', { pitch: 0.8, vol: 0.7 });
    if (camera && minPlayerDist(T) < 9) camera.shake(0.04, 0.25);
  }
  function updateEmerging(T, dt) {
    T.t += dt;
    const u = Math.min(1, T.t / EMERGE_TIME);
    const e = easeOutCubic(u);
    T.g.position.y = T.basePos.y - 1.9 * T.baseScale.y * (1 - e) + Math.sin(u * Math.PI) * 0.06;
    if (u >= 1) {
      T.g.position.copy(T.basePos);
      T.state = 'idle';
      particles.burst('sparkle', { x: T.g.position.x, y: T.basePos.y + 1.0 * T.baseScale.y, z: T.g.position.z }, { count: 5, radius: 0.6 });
    }
  }

  // ------------------------------------------------------------------ regrowth + snapshots (world sync)
  /** Finish a running fall / shatter instantly (a regrow event or a snapshot arrived before this screen's animation ended). */
  function settle(T) {
    if (T.state === 'falling') {
      if (!T.impacted) { T.impacted = true; }
      T.g.visible = false;
      T.g.scale.copy(T.baseScale);
      T.g.position.copy(T.basePos);
      T.state = 'stump';
    } else if (T.state === 'shattered') {
      for (const sh of T.shards) { sh.m.visible = false; sh.m.userData.busy = false; }
      T.shards.length = 0;
      T.state = 'gone';
    }
  }

  /** Every screen (host included): the target regrows now (sapling pops up / the rock rises). */
  function applyRegrow(T) {
    if (!T || !isDown(T)) return;
    settle(T);
    if (T.state === 'stump') startGrowing(T);
    else if (T.state === 'gone') startEmerging(T);
  }

  /** Replica (snapshot): put the target in its felled / broken state right now, no animation. */
  function instantDown(T) {
    if (isDown(T) || T.state === 'removed') return;
    removeFromWorld(T);
    tracker.reset(T.id);
    T.t = 0;
    T.g.quaternion.identity();
    T.g.rotation.set(0, T.yaw, 0);
    T.g.scale.copy(T.baseScale);
    T.g.position.copy(T.basePos);
    T.g.visible = false;
    if (T.type === 'rock') { T.state = 'gone'; return; }
    props.setWobble(T.g, false);
    placeStump(T);
    T.state = 'stump';
  }

  /** Replica (snapshot): the target is standing again, no animation. */
  function instantUp(T) {
    if (!isDown(T)) return;                              // (a 'removed' tombstone is not down: it stays gone)
    settle(T);
    removeStump(T);
    T.g.quaternion.identity();
    T.g.rotation.set(0, T.yaw, 0);
    T.g.scale.copy(T.baseScale);
    T.g.position.copy(T.basePos);
    T.g.visible = true;
    if (T.type !== 'rock') props.setWobble(T.g, true);
    restoreToWorld(T);
    T.state = 'idle';
  }

  // ------------------------------------------------------------------ Homesteading (Step 86a)
  /** Remove target group `g` for good (a tombstone): hidden, unregistered, never regrows. Safe at any time (idle, felled, mid-animation) and idempotent. */
  function retire(g) {
    const it = g.userData.interactable;
    if (!it) return false;
    itemById.set(it.id, it);
    const T = getT(it);
    if (T.state === 'removed') return true;
    const done = T.onDone;
    T.onDone = null; T.forever = false;
    settle(T);
    removeStump(T);
    regrow.cancel(T.id);
    tracker.reset(T.id);
    for (const [pl, p] of [...pendings]) if (p.T === T) pendings.delete(pl);
    removeFromWorld(T);
    T.state = 'removed';
    T.t = 0;
    g.quaternion.identity();
    g.rotation.set(0, T.yaw, 0);
    g.scale.copy(T.baseScale);
    g.position.copy(T.basePos);
    g.visible = false;
    if (T.type !== 'rock') props.setWobble(g, false);
    if (done) done();
    return true;
  }
  /** Step 86c: one final hit, for good. Plays the normal chop + fell / shatter (the host rolls the normal drops in it), then retires the target and calls `onDone`. */
  function removeForGood(g, d = {}) {
    const it = g.userData.interactable;
    if (!it) return false;
    itemById.set(it.id, it);
    const T = getT(it);
    if (T.state === 'removed') { if (d.onDone) d.onDone(); return true; }
    if (T.state !== 'idle') { T.onDone = d.onDone || null; retire(g); return true; }       // already felled / broken / being removed: just finish it
    T.forever = true;
    T.onDone = d.onDone || null;
    if (sync.isHost && T.type === 'rock' && collectFind && d.actor) collectFind('break', T.g.position, d.actor, d.tool);
    applyHit({ id: T.id, dx: d.dx || 0, dz: d.dz || 1, final: true, saber: false, toolKind: d.tool || 'axe', actor: d.actor || null });
    if (T.state === 'idle') retire(g);                                                     // (applyHit refused: do not leave it half removed)
    return true;
  }
  /** A runtime-planted tree / palm / rock group (userData.interactable set, fixed id): make it a harvest target. */
  function adopt(g) {
    const it = g.userData.interactable;
    if (it) itemById.set(it.id, it);
  }
  /** A planted group is being deleted: retire it and drop every record of it. */
  function forget(g) {
    const it = g.userData.interactable;
    if (!it) return;
    retire(g);
    const T = targets.get(g);
    if (T) { tById.delete(T.id); targets.delete(g); }
    itemById.delete(it.id);
  }

  // ------------------------------------------------------------------ update
  let force = false;    // regrowNow(): ignore the "player standing on the spot" deferral once
  function update(dt) {
    time += dt;
    for (const p of [...pendings.values()]) {
      p.t += dt;
      const pl = p.player;
      if (pl.leaving || players.get(pl.index) !== pl) { pendings.delete(pl); continue; }
      if (!pl.swinging || pl.swingProgress >= IMPACT || p.t > 1.2) applyPending(p);
    }
    for (const T of targets.values()) {
      switch (T.state) {
        case 'idle':
          updateWobble(T, dt);
          break;
        case 'falling': updateFalling(T, dt); break;
        case 'growing': updateGrowing(T, dt); break;
        case 'shattered': updateShattered(T, dt); break;
        case 'emerging': updateEmerging(T, dt); break;
        default: break;
      }
      const bind = T.g.userData.binding;                  // instanced (big islands) targets: show the instance, the animated proxy, or nothing
      if (bind) bind.set('harvest', T.state === 'idle' ? (T.wob ? 'proxy' : 'static') : (T.state === 'stump' || T.state === 'gone' || T.state === 'shattered') ? 'none' : 'proxy');
    }
    if (sync.isHost && regrow.size) {                     // the regrowth timers run on the host only; the screens get a 'regrow' event
      for (const id of regrow.due(time, (id) => { const T = tById.get(id); return !T || !(T.state === 'stump' || T.state === 'gone') || playerNear(T); }, force)) {
        const T = tById.get(id);
        if (!T || !(T.state === 'stump' || T.state === 'gone')) continue;   // (still falling / shattering: wait for the animation to end)
        regrow.cancel(id);
        sync.emit('harvest', 'regrow', { id });
        applyRegrow(T);
      }
    }
    force = false;
  }

  // ------------------------------------------------------------------ world sync domain
  sync.register('harvest', {
    snapshot: () => ({
      down: [...tById.values()].filter(isDown).map((T) => ({ id: T.id, in: regrow.has(T.id) ? +regrow.remaining(T.id, time).toFixed(1) : null })),
    }),
    hashView: () => ({ down: [...tById.values()].filter(isDown).map((T) => T.id).sort((a, b) => a - b) }),
    applySnapshot(snap) {
      const want = new Set(((snap && snap.down) || []).map((e) => e.id));
      for (const id of want) { const T = tFor(id); if (T && T.type !== 'ritualstone') instantDown(T); }
      for (const T of tById.values()) if (!want.has(T.id)) instantUp(T);
    },
    applyEvent(kind, d) {
      if (kind === 'hit') applyHit(d);
      else if (kind === 'regrow') applyRegrow(tFor(d.id));
    },
    handleRequest(kind, d, actor) {
      if (kind === 'hit') return handleHit(d, actor);
      if (kind === 'regrowNow') { regrow.dueAll(time); force = true; return true; }
      return { reject: 'unknown-kind' };
    },
  });

  return {
    hit,
    update,
    retire, adopt, forget, removeForGood,
    get pending() { return pendings.size > 0; },
    pendingFor(player) { return pendings.has(player); },
    /** A player left: forget its pending hit. */
    release(player) { pendings.delete(player); },
    /** Debug: snapshot of every target that has been hit at least once. */
    get states() {
      return [...targets.values()].map((T) => ({
        id: T.id, type: T.type, x: +T.g.position.x.toFixed(2), z: +T.g.position.z.toFixed(2), state: T.state, hits: tracker.count(T.id, time),
        regrowIn: regrow.has(T.id) ? +regrow.remaining(T.id, time).toFixed(1) : null,
        visible: T.g.visible, collider: !!T.collider, interactable: getInteractables().includes(T.item),
      }));
    },
    /** Debug: make every waiting regrowth fire on the next update (ignores the player-nearby deferral). */
    regrowNow() {
      if (sync.isReplica) { sync.request('harvest', 'regrowNow', {}); return; }
      regrow.dueAll(time);
      force = true;
    },
    /** Debug: raw target records by group. */
    _targets: targets,
    constants: { HIT_MEMORY, TREE_REGROW, ROCK_REGROW, NEAR_SPOT },
  };
}
