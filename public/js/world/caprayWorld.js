// The world side of Capray's quest line "The Little Lantern" (PLAN Step 73b): the wild ray by its pond, the offerings, the shade moss on three titans (and their dimmed caps), the spore showers, the
// befriend scene and the "Bring Capray along?" question. Everything here is COSMETIC and per screen except what the `capray` domain (game/capray.js) decides; every screen derives what it shows from
// that synced state (leader, stage, fed, moss, spores) and its own players' positions, so nothing about the ray itself is synced.
//
//   const cw = createCaprayWorld({ scene, players, avatars, world, sync, capray, plan, domain, pets, items, inventory, thoughts, particles, sfx, hud, dialog, cinematic, camera, floatText, heightAt, flora, marlo?, markerRoot? })
//     markerRoot = the HUD root: edge arrows / pins (the objective arrows' look) point at the titans that still need clearing or shaking, and at the pond while somebody carries the fish the ray wants
//     capray = game/capray.js    plan = world/islands/duskCapray.js    domain = the `pets` unlock domain    flora = world/islands/duskVisuals.js duskFlora (setDim)
//   cw.update(dt)                       once per tick, AFTER the camera and cinematic.update (the befriend scene owns the camera while it runs), BEFORE pets.update is irrelevant
//   cw.clearMoss(item, player)          main.js: Interact with an axe / sword / saber on a shademoss target: the swing starts now, the hit request goes out at the impact frame
//   cw.ask(player) / cw.asking          the "Bring Capray along?" question (debug / tests)       cw.rodSeen   a Glowline Rod has been picked up (the sighting waits for it)
//   cw.wild                             { shown, mode, position, glow }  the wild ray       cw.moss   the shade-moss layer { count, scale[3], dim[3] }       cw.scene  the befriend scene { active, t }
//   cw.interactables                    { feed, moss[3], shake[3] }       cw.summary()
//
// Wild ray: a normal Capray model (npc/pets.js, 4 draw calls) on a CLONE of the pet material that has its own glow uniform (same shader program: customProgramCacheKey is shared), so its glow can
// be dim or bright while the followers keep theirs. Where it is: stage 0 shy at the pond's middle (once a rod was picked up) and it darts away when someone comes within CAPRAY.sight (that approach
// asks the host for stage 1); stages 1-2 and 4 in its pond: it drifts round slowly, and swims over to the near shore when a local player carrying the fish it wants comes within CAPRAY.approach;
// stage 3 it follows the LEADER (the player who last offered, cleared or shook) at a glide and hovers under a titan's cap to soak the spores; stage 5 gone. It draws only while Duskcrown is full.
// The offering prompt (`caprayfeed`, a DYNAMIC interactable) sits on the shore right beside the ray, wherever it is in the pond (a playtest found the old fixed spot far from it).
// Shade moss: ONE InstancedMesh (3 instances of a lumpy cluster hugging a titan's stem), VERTEX_TOON (no new program), shrinking one quarter per hit; flora.setDim dims the titan's cap glow and light pool.
// The interactables (registered once): `caprayfeed` on the shore by the ray (prompt "Offer a Glimmerfin" / "Offer a Lanternkoi", offered only while the bag holds the fish the ray wants), `shademoss`
// ("Clear moss 2/4": the hits so far) and `titanshake` per titan (each offered by canInteract only in its own state).
// Befriend scene (cinematic.js, host-timed by capray.state.scene.startAt): the camera swings in, the ray's full glow returns and it loops round the feeder, its pod of three rays rises from the pond, the
// banner "Capray wants to come with you!"; holding Cancel for 1 s skips it everywhere (capray.skip()). The unlock itself is the host's (capray.js).
import * as THREE from 'three';
import { CAPRAY, PET, WATER_LEVEL } from '../config.js';
import { createPetModel, petMaterial, petUniforms } from '../npc/pets.js';
import { followStep, poseStep, glideTarget, appearScale } from '../game/petLogic.js';
import { G, part, combine, VERTEX_TOON } from '../render/geo.js';
import { addInteractable } from './interactables.js';
import { needOf, rayGlow, titanDim, mossScale, mossShown, rayPlace, marloLine } from '../game/caprayLogic.js';
import { edgeDistance } from '../game/fishingLogic.js';
import { pickShot } from './islands/duskCapray.js';
import { mulberry32 } from '../utils/rng.js';
import { ICONS, LEAVE_SVG } from '../ui/icons.js';
import { createEdgeMarkers } from '../ui/edgeMarkers.js';
import { actorKey } from '../net/worldSync.js';

const TAU = Math.PI * 2;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = (t) => { t = clamp(t); return t * t * (3 - 2 * t); };
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const SWING_TO_IMPACT = 0.3;           // s from the press to the swing's impact frame (the hit request goes out then)
const FEED_BEAT = 2.3;                 // s of the gulp / hearts / flip after an offering
const SOAK = 2.6;                      // s the ray hovers under a cap while the spores rain on it
const WHY = {
  none: 'You have nothing to offer.', 'wrong-fish': 'It is not hungry for that.', full: 'It is full for now.', far: 'A little closer.', unseen: 'Nothing here yet.', gone: 'It is gone.',
  locked: 'Not yet.', cleared: 'Already clear.', 'no-tool': 'Something sharp, like an axe or a sword.', smothered: 'Shade moss still covers this stem.', done: 'It already rained spores here.',
  'leader-far': 'Capray follows you now. Shake again!', offline: 'The marsh is quiet. Try again.',
};

/** One shade-moss cluster in units of the titan's stem radius (the instance scale), hugging a flared stem up to ~2.7 radii. Lumpy dark greens, a few paler tufts. */
export function mossGeometry() {
  const rng = mulberry32(7301), tones = ['#26382f', '#2f4a39', '#1d2a2a', '#3a5a44', '#223a33'], parts = [];
  const N = 46;
  for (let k = 0; k < N; k++) {
    const u = k / (N - 1), y = 0.1 + Math.pow(u, 1.25) * 2.7, a = k * 2.399 + rng() * 0.5;
    const stem = 1 + 0.64 * Math.exp(-y / 1.1), r = stem + 0.06 + 0.08 * rng();
    const sz = (0.34 - 0.15 * u) * (0.8 + rng() * 0.5);
    parts.push(part(G.sphereLo, tones[k % tones.length], { p: [Math.cos(a) * r, y, Math.sin(a) * r], r: [rng(), rng() * TAU, 0], s: [sz * 1.25, sz * 0.8, sz * 1.25] }));
    if (k % 2 === 0) {                                                                    // a second lump on the far side so the cluster wraps right round the stem
      const b = a + Math.PI * (0.8 + rng() * 0.4);
      parts.push(part(G.sphereLo, tones[(k + 2) % tones.length], { p: [Math.cos(b) * (stem + 0.04), y + 0.1, Math.sin(b) * (stem + 0.04)], s: [sz * 1.1, sz * 0.75, sz * 1.1] }));
    }
  }
  for (let k = 0; k < 9; k++) {                                                           // creeping roots on the ground
    const a = (k / 9) * TAU + rng() * 0.4, r = 1.75 + rng() * 0.5;
    parts.push(part(G.sphereLo, k % 2 ? '#2f4a39' : '#1d2a2a', { p: [Math.cos(a) * r, 0.1, Math.sin(a) * r], s: [0.5 + rng() * 0.3, 0.2, 0.42] , r: [0, -a, 0] }));
  }
  for (let k = 0; k < 6; k++) {                                                           // pale glowing-sick tufts
    const a = k * 1.05 + 0.3, y = 0.5 + k * 0.4, r = 1 + 0.64 * Math.exp(-y / 1.1) + 0.3;
    parts.push(part(G.sphereLo, '#6f9a74', { p: [Math.cos(a) * r, y, Math.sin(a) * r], s: [0.12, 0.2, 0.12] }));
  }
  return combine(parts);
}

export function createCaprayWorld({
  scene, players, avatars = null, world = null, sync, capray, plan, domain, pets, items = null, inventory, thoughts = null, particles, sfx = null, hud = null, dialog, cinematic: cin, camera, floatText = null,
  heightAt, flora = null, marlo = null, markerRoot = null,
}) {
  const snd = (name, opts) => { if (sfx) sfx.play(name, opts); };
  const here = () => !world || world.regions.isFull('duskcrown');
  const st = () => capray.state;
  const pond = plan.pond, feed = plan.feed;
  const pondY = WATER_LEVEL;
  const pc = { x: pond.x, z: pond.z };
  const toFeed = { x: feed.x - pc.x, z: feed.z - pc.z };
  const pondR = Math.min(pond.rx, pond.rz);
  // `dir` = the unit direction from the pond's middle the ray hangs out in (stages 1-2 / 4): towards a local player carrying its fish, else drifting slowly round. The beat and the dart use it too.
  const dir = { x: toFeed.x / (Math.hypot(toFeed.x, toFeed.z) || 1), z: toFeed.z / (Math.hypot(toFeed.x, toFeed.z) || 1) };
  let time = 0, approacher = null, hitToast = null;

  // ------------------------------------------------------------------ the wild ray's own glow (a material clone)
  const wildGlow = { value: PET.glowDay };
  let wildMat = null;
  function wildMaterial() {
    if (wildMat) return wildMat;
    const base = petMaterial(), baseCompile = base.onBeforeCompile;
    const m = base.clone();
    m.onBeforeCompile = (shader, renderer) => { baseCompile(shader, renderer); shader.uniforms.uGlow = wildGlow; };
    m.customProgramCacheKey = base.customProgramCacheKey;                       // the SAME program as the followers: only the uniform object differs
    m.shadowSide = base.shadowSide;
    wildMat = m;
    return m;
  }
  function makeWildModel() {
    const m = createPetModel('capray');
    for (const mesh of m.meshes) mesh.material = wildMaterial();
    m.root.rotation.order = 'YXZ';
    m.root.visible = false;
    scene.add(m.root);
    return m;
  }

  const ray = {
    model: null, shown: false, appearT: 0, mode: 'hidden', phase: 0.7,
    s: { x: pc.x, y: pondY + 0.3, z: pc.z, vx: 0, vy: 0, vz: 0 }, pose: { yaw: 0, roll: 0, pitch: 0, yawRate: 0 },
    glow: CAPRAY.glow.shy, glowHold: 0, beat: null, soak: null, dart: null, hideUntil: 0, lastBubble: -99, extraRoll: 0, pulse: 0,
  };
  let rodSeen = false, sightCooldown = 0;
  const localKeyOf = (p) => actorKey(sync.actorFor(p));
  const localOf = (key) => players.list.find((p) => localKeyOf(p) === key) || null;

  // ------------------------------------------------------------------ shade moss (one instanced layer) and the dimmed caps
  const mossGeo = mossGeometry();
  const moss = new THREE.InstancedMesh(mossGeo, VERTEX_TOON, plan.titans.length);
  moss.name = 'shade-moss'; moss.frustumCulled = false; moss.castShadow = false; moss.receiveShadow = true;
  scene.add(moss);
  const mossK = plan.titans.map(() => 0), dimK = plan.titans.map(() => 0), mossPulse = plan.titans.map(() => 0);
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
  function placeMoss() {
    plan.titans.forEach((t, i) => {
      const k = mossK[i] * (1 + 0.07 * Math.sin(mossPulse[i] * 30) * clamp(mossPulse[i] * 2.5)), sc = Math.max(0.0001, t.stemR * k);
      _q.setFromAxisAngle(_up, t.index * 1.7);
      _p.set(t.x, t.y - 0.05, t.z); _s.set(sc, sc * (0.85 + 0.15 * mossK[i]), sc);
      moss.setMatrixAt(i, _m.compose(_p, _q, _s));
    });
    moss.instanceMatrix.needsUpdate = true;
  }
  /** Jump straight to the state's moss / dim (load, late join, debug set): no animation. */
  function snapMoss() {
    plan.titans.forEach((t, i) => { mossK[i] = mossShown(st(), i) ? mossScale(st(), i) : 0; dimK[i] = titanDim(st(), i); if (flora) flora.setDim(t.id, dimK[i]); });
    placeMoss();
    moss.visible = here() && mossK.some((k) => k > 0.001);
  }
  function stepMoss(dt) {
    let changed = false;
    plan.titans.forEach((t, i) => {
      const goal = mossShown(st(), i) ? Math.max(0.12, mossScale(st(), i)) : 0;
      if (mossK[i] !== goal) { mossK[i] += Math.sign(goal - mossK[i]) * Math.min(Math.abs(goal - mossK[i]), dt * (goal > mossK[i] ? 0.8 : 1.6)); changed = true; }
      if (mossPulse[i] > 0) { mossPulse[i] = Math.max(0, mossPulse[i] - dt); changed = true; }
      const dg = titanDim(st(), i);
      if (dimK[i] !== dg) {
        dimK[i] += Math.sign(dg - dimK[i]) * Math.min(Math.abs(dg - dimK[i]), dt / CAPRAY.dimEase);
        if (flora) flora.setDim(t.id, dimK[i]);
      }
    });
    moss.visible = here() && mossK.some((k) => k > 0.001);
    if (changed) placeMoss();
  }

  // ------------------------------------------------------------------ interactables (registered ONCE)
  const iFeed = addInteractable({
    type: 'caprayfeed', object: null, position: new THREE.Vector3(feed.x, heightAt(feed.x, feed.z), feed.z), radius: 1.3, prompt: 'Offer a Glimmerfin',
    canInteract: () => { const n = needOf(st()); return !!n && here() && inventory.count(n) >= 1; },
    onInteract: (item, by) => { offer(by || players.p1); },
  });
  const iMoss = [], iShake = [];
  for (const t of plan.titans) {
    const pos = () => new THREE.Vector3(t.x, t.y, t.z);
    const a = addInteractable({
      type: 'shademoss', object: null, position: pos(), radius: t.collR + 0.9, prompt: 'Clear moss',
      canInteract: () => st().stage === 3 && !st().moss[t.index],
      onInteract: (item, by) => { toastWhy('no-tool'); },
    });
    a.titan = t;
    const b = addInteractable({
      type: 'titanshake', object: null, position: pos(), radius: t.collR + 0.9, prompt: 'Shake',
      canInteract: () => st().stage === 3 && st().moss[t.index] && !st().spores[t.index],
      onInteract: (item, by) => { shake(t, by || players.p1); },
    });
    b.titan = t;
    iMoss.push(a); iShake.push(b);
  }
  const toastWhy = (reason) => { if (hud && WHY[reason]) hud.toast(WHY[reason], { icon: 'sparkle', duration: 2200 }); };
  const settle = (res, onOk = null) => Promise.resolve(res).then((r) => { if (r && r.ok === false) toastWhy(r.reason); else if (onOk) onOk(r); }, () => toastWhy('offline'));

  function offer(p) {
    const need = needOf(st());
    if (!need || !p) return false;
    p.faceToward(pc.x, pc.z);
    settle(capray.feed(p, need));
    return true;
  }
  function shake(t, p) {
    p.faceToward(t.x, t.z);
    if (p.hop) p.hop();
    settle(capray.shake(p, t.index));
    return true;
  }
  // moss swings: one per player at a time; the hit request goes out at the swing's impact frame
  const pend = [];
  function clearMoss(item, p) {
    if (!item || !item.titan || !p || p.swinging || pend.some((q) => q.p === p)) return false;
    if (!items || !items.swing(p)) return false;
    p.faceToward(item.titan.x, item.titan.z);
    pend.push({ p, i: item.titan.index, t: SWING_TO_IMPACT });
    return true;
  }
  function stepSwings(dt) {
    for (const q of [...pend]) {
      q.t -= dt;
      if (q.t > 0) continue;
      pend.splice(pend.indexOf(q), 1);
      if (q.p.leaving) continue;
      settle(capray.hit(q.p, q.i));
    }
  }

  // ------------------------------------------------------------------ bubbles
  const rayAnchor = () => ({ x: ray.s.x, y: ray.s.y + 0.55, z: ray.s.z });
  const nearestLocal = (x, z) => players.list.filter((p) => !p.away).reduce((best, p) => { const d = Math.hypot(p.position.x - x, p.position.z - z); return !best || d < best.d ? { p, d } : best; }, null);
  function hintBubbles() {
    if (!thoughts || !ray.shown || time - ray.lastBubble < 11) return;
    const n = nearestLocal(ray.s.x, ray.s.z);
    if (!n || n.d > 11) return;
    const s = st(), need = needOf(s);
    let icon = null;
    if (need && inventory.count(need) < 1) icon = ICONS[need];             // hungry, and the party has nothing to give: show what it wants
    else if (s.stage === 3) icon = ICONS['shade-moss'];                  // sad: the titans
    else if (need && s.stage === 4) icon = ICONS[need];
    if (!icon) return;
    ray.lastBubble = time;
    thoughts.show('capray-hint', rayAnchor, icon, { seconds: 3, lift: 0.4 });
  }

  // ------------------------------------------------------------------ the wild ray
  function targetFor(mode, dt) {
    const s = st();
    if (mode === 'shy') return { x: pc.x, z: pc.z, y: pondY + 0.1 + Math.sin(time * 1.3) * 0.04, slow: 0.4 };
    if (mode === 'pond') {
      const k = approacher ? CAPRAY.shore : 0.3 + 0.08 * Math.min(3, s.fed);
      return { x: pc.x + dir.x * pondR * k, z: pc.z + dir.z * pondR * k, y: pondY + 0.5 + Math.sin(time * 1.1 + ray.phase) * 0.1, slow: approacher ? 0.9 : 0.5 };
    }
    // follow: the leader (else the nearest local player, else the pond)
    let lead = capray.leaderPos();
    if (!lead) { const n = nearestLocal(ray.s.x, ray.s.z); lead = n ? { x: n.p.position.x, z: n.p.position.z } : { x: pc.x, z: pc.z }; }
    const dx = lead.x - ray.s.x, dz = lead.z - ray.s.z, d = Math.hypot(dx, dz) || 1;
    const hold = d < 2.4 ? 0 : 1;                                          // close enough: stay (no jitter) and bob
    const tx = hold ? lead.x - (dx / d) * 1.7 + (dz / d) * 0.9 : ray.s.x, tz = hold ? lead.z - (dz / d) * 1.7 - (dx / d) * 0.9 : ray.s.z;
    const g = glideTarget({ ground: heightAt(tx, tz), t: time, phase: ray.phase });
    return { x: tx, z: tz, y: Math.max(g, pondY + 0.9), slow: 1 };
  }

  function stepRay(dt) {
    const s = st(), place = rayPlace(s, rodSeen);
    let mode = place === 'hidden' || place === 'gone' ? 'hidden' : place;
    if (place === 'gone' && (s.scene.queued || s.scene.startAt !== null)) mode = 'follow';     // the Lanternkoi was just offered: it stays until the scene is over
    if (run) mode = 'scene';
    if (!here() || (mode === 'hidden' && !run) || time < ray.hideUntil) { hideRay(); ray.mode = mode; return; }
    if (!ray.model) ray.model = makeWildModel();
    const m = ray.model;
    const modeChanged = ray.mode !== mode;
    ray.mode = mode;
    // glow: the state's step (delayed a moment after a shower so the ray soaks it first)
    if (ray.glowHold > 0) ray.glowHold -= dt;
    else ray.glow = lerp(ray.glow, run ? 1.35 : rayGlow(s), 1 - Math.exp(-2.2 * dt));
    const tgt = run ? sceneTarget(dt) : ray.dart ? dartTarget(dt) : ray.soak ? soakTarget(dt) : ray.beat ? beatTarget(dt) : targetFor(mode, dt);
    if (!ray.shown) {
      ray.shown = true; ray.appearT = 0; m.root.visible = true;
      const o = run ? { x: pc.x, y: pondY + 0.4, z: pc.z } : { x: tgt.x, y: tgt.y - 0.2, z: tgt.z };     // (the scene's ray rises from the pond)
      ray.s.x = o.x; ray.s.y = o.y; ray.s.z = o.z; ray.s.vx = ray.s.vy = ray.s.vz = 0;
      ray.pose.yaw = Math.atan2(feed.x - pc.x, feed.z - pc.z) + Math.PI; ray.pose.roll = ray.pose.pitch = ray.pose.yawRate = 0;
      if (particles && mode !== 'hidden') particles.burst('sparkle', { x: ray.s.x, y: pondY + 0.2, z: ray.s.z }, { count: 5, radius: 0.5, height: 0.3, color: '#9ff2ff' });
    }
    const far = Math.hypot(tgt.x - ray.s.x, tgt.z - ray.s.z);
    if (far > 40 && !run) { ray.s.x = tgt.x; ray.s.z = tgt.z; ray.s.y = tgt.y; ray.s.vx = ray.s.vz = ray.s.vy = 0; ray.appearT = 0; }   // far behind (a teleport, the crossing): it is simply there
    const catching = !!tgt.fast || far > PET.catchUp * 1.6;
    followStep(ray.s, tgt, { x: 0, y: 0, z: 0 }, dt, { catching, slow: tgt.slow ?? 1 });
    poseStep(ray.pose, { vx: ray.s.vx, vy: ray.s.vy, vz: ray.s.vz }, tgt.look ?? null, dt);
    ray.appearT += dt;
    const pulse = ray.pulse > 0 ? 1 + 0.14 * Math.sin(clamp(1 - ray.pulse / 0.25) * Math.PI) : 1;
    ray.pulse = Math.max(0, ray.pulse - dt);
    m.root.position.set(ray.s.x, ray.s.y, ray.s.z);
    m.root.rotation.y = ray.pose.yaw;
    m.rig.rotation.x = ray.pose.pitch;
    m.rig.rotation.z = ray.pose.roll + ray.extraRoll;
    m.root.scale.setScalar(appearScale(ray.appearT) * (mode === 'shy' ? 0.8 : 1) * pulse * (tgt.scale ?? 1));
    m.update(dt, time + ray.phase, { sway: 0.8 + Math.min(1, Math.hypot(ray.s.vx, ray.s.vz) / 4) * 0.5, rocking: 1 });
    void modeChanged;
  }
  function hideRay() {
    if (!ray.shown) return;
    ray.shown = false;
    if (ray.model) ray.model.root.visible = false;
  }

  // -- the feed beat (a gulp, hearts and a flip), the dart, the soak
  function beatTarget(dt) {
    const b = ray.beat;
    b.t += dt;
    const u = b.t;
    if (!b.gulped && u >= 0.5) { b.gulped = true; ray.pulse = 0.25; snd('nom', { pitch: 1.3, vol: 0.8 }); if (particles) particles.burst('sparkle', rayAnchor(), { count: 5, radius: 0.4, height: 0.2, color: '#ffe08a' }); }
    if (!b.hearts && u >= 0.95) { b.hearts = true; if (particles) particles.burst('heart', { x: ray.s.x, y: ray.s.y + 0.8, z: ray.s.z }, { count: 5, radius: 0.5 }); snd('chime', { pitch: 1.4, vol: 0.5 }); }
    ray.extraRoll = u > 1.15 ? smooth((u - 1.15) / 0.9) * TAU : 0;
    if (u >= FEED_BEAT) { ray.beat = null; ray.extraRoll = 0; }
    const rise = smooth(u / 0.45) * (1 - smooth((u - 1.9) / 0.4));
    const f = (CAPRAY.shore + 0.08) - 0.04 * Math.min(1, u);
    return { x: pc.x + dir.x * pondR * f, z: pc.z + dir.z * pondR * f, y: pondY + 0.5 + rise * 0.7 + (u > 1.15 && u < 2.05 ? 0.35 * Math.sin((u - 1.15) / 0.9 * Math.PI) : 0), slow: 0.8, look: Math.atan2(dir.x, dir.z) };
  }
  function dartTarget(dt) {
    const d = ray.dart;
    d.t += dt;
    if (d.t > 0.45) { ray.dart = null; ray.hideUntil = time + 1.1; if (particles) particles.burst('puff', { x: ray.s.x, y: pondY + 0.1, z: ray.s.z }, { count: 5, radius: 0.5, height: 0.1 }); hideRay(); return { x: ray.s.x, z: ray.s.z, y: ray.s.y }; }
    return { x: pc.x - dir.x * pondR * 0.45, z: pc.z - dir.z * pondR * 0.45, y: pondY + 0.18, fast: true, slow: 1.8, scale: 1 - smooth(d.t / 0.45) * 0.4 };
  }
  function soakTarget(dt) {
    const k = ray.soak;
    k.t += dt;
    if (k.t >= SOAK) { ray.soak = null; return targetFor('follow', dt); }
    const t = plan.titans[k.i], dx = pc.x - t.x, dz = pc.z - t.z, d = Math.hypot(dx, dz) || 1, r = t.collR + 1.6;
    return { x: t.x + (dx / d) * r, z: t.z + (dz / d) * r, y: heightAt(t.x, t.z) + 2.3 + Math.sin(k.t * 3) * 0.12, slow: 1.2, look: Math.atan2(t.x - ray.s.x, t.z - ray.s.z) };
  }

  // ------------------------------------------------------------------ the capray domain's events (every screen)
  function titanPoint(t, towards, h) {
    const dx = towards.x - t.x, dz = towards.z - t.z, d = Math.hypot(dx, dz) || 1;
    return { x: t.x + (dx / d) * t.collR, y: t.y + h, z: t.z + (dz / d) * t.collR };
  }
  capray.on((kind, d) => {
    if (kind === 'snapshot' || kind === 'set' || kind === 'reset') { snapMoss(); ray.glow = rayGlow(st()); ray.beat = ray.soak = ray.dart = null; ray.extraRoll = 0; ray.hideUntil = 0; if (kind !== 'snapshot') hideRay(); return; }
    if (kind === 'sight') {
      ray.dart = { t: 0 };
      if (thoughts) thoughts.show('capray-dots', rayAnchor, ICONS['thought-dots'], { seconds: 1.8, lift: 0.3 });
      snd('splash', { pitch: 1.5, vol: 0.35 });
      if (particles) particles.burst('puff', { x: pc.x, y: pondY + 0.1, z: pc.z }, { count: 6, radius: 0.8, height: 0.1 });
      return;
    }
    if (kind === 'feed') {
      ray.beat = { t: 0, gulped: false, hearts: false };
      const who = d.actor ? localOf(d.actor) : null;
      if (who && floatText) floatText(d.fish, -1, { x: who.position.x, y: who.position.y + 1.8, z: who.position.z }, who);
      if (st().stage === 3 && hud) setTimeout(() => hud.toast('The big mushrooms look dim. Something is smothering them.', { icon: 'sparkle', duration: 4200 }), 2600);
      return;
    }
    if (kind === 'hit') {
      const t = plan.titans[d.i];
      if (!t) return;
      mossPulse[d.i] = 0.4;
      const who = d.actor ? localOf(d.actor) : null, from = who ? who.position : { x: feed.x, z: feed.z };
      const at = titanPoint(t, from, 1.2 + Math.random() * 1.4);
      if (particles) {
        particles.burst('leaf', at, { count: d.final ? 14 : 6, radius: 0.5, height: 0.5, color: '#3a5a44' });
        particles.burst('chip', at, { count: d.final ? 8 : 4, radius: 0.3, color: '#26382f' });
      }
      snd(d.final ? 'timber' : 'chop', { pitch: 0.95 + Math.random() * 0.1, vol: 0.8 });
      if (!d.final && who && hud) {                                          // (a playtest could not tell the moss needs more hits: say how many, on the hitter's screen)
        const left = Math.max(1, CAPRAY.hits - (st().hits[d.i] || 0));
        if (hitToast && hitToast.isConnected) hitToast.remove();             // (one progress toast at a time: each hit replaces the last)
        hitToast = hud.toast(`Keep chopping! ${left} more ${left === 1 ? 'hit' : 'hits'}.`, { icon: 'sparkle', duration: 1600 });
      }
      if (d.final) {
        snd('collect', { pitch: 0.9, vol: 0.7 });
        if (particles) particles.burst('sparkle', { x: t.x, y: t.y + 3.5, z: t.z }, { count: 14, radius: t.collR, height: 2.0, color: '#ffd9a0' });
        if (hud) hud.toast('The moss is gone! Give the stem a good shake.', { icon: 'sparkle', duration: 3200 });
      }
      return;
    }
    if (kind === 'shake') {
      const t = plan.titans[d.i];
      if (!t) return;
      ray.soak = { t: 0, i: d.i };
      ray.glowHold = 1.1;
      showerAt(t);
      const left = st().spores.filter((s) => !s).length;
      if (hud && st().stage === 4) setTimeout(() => hud.toast('Capray glows like a lantern and swims home to its pond! It wants a Lanternkoi: look for orange ripples on the deeper ponds.', { icon: 'sparkle', duration: 6000 }), 2400);
      else if (hud && left > 0) hud.toast(`${left} more ${left === 1 ? 'mushroom' : 'mushrooms'} to go. Follow the arrows!`, { icon: 'sparkle', duration: 2600 });
      return;
    }
    if (kind === 'finish' || kind === 'skip') endRun();
  });

  // spore showers: a handful of timed bursts round the cap's rim, falling
  const showers = [];
  function showerAt(t) {
    snd('leaves', { pitch: 0.8, vol: 0.9 }); snd('chime', { pitch: 0.9, vol: 0.4 });
    for (let k = 0; k < 9; k++) showers.push({ t: k * 0.16, t0: time, titan: t, a: k * 0.7 });
  }
  function stepShowers(dt) {
    for (const s of [...showers]) {
      s.t -= dt;
      if (s.t > 0) continue;
      showers.splice(showers.indexOf(s), 1);
      if (!particles) continue;
      const r = s.titan.capR * (0.45 + 0.4 * ((s.a * 3) % 1)), x = s.titan.x + Math.cos(s.a * 2.1) * r, z = s.titan.z + Math.sin(s.a * 2.1) * r;
      const y = s.titan.capUnder - 0.4;
      particles.burst('sparkle', { x, y, z }, { count: 7, radius: 1.3, height: 0.6, color: s.a % 1.4 > 0.7 ? '#9ff2ff' : '#d1a8ff', speed: 0.6 });
      particles.burst('sparkle', { x: x * 0.7 + s.titan.x * 0.3, y: y - 3.5, z: z * 0.7 + s.titan.z * 0.3 }, { count: 4, radius: 1.0, height: 0.8, color: '#ffe0a0', speed: 0.5 });
    }
  }

  // ------------------------------------------------------------------ the befriend scene
  let run = null;
  const pod = [];
  const camPos = new THREE.Vector3(), look = new THREE.Vector3();
  function feederPoint() {
    const lead = capray.leaderPos();
    if (lead) return { x: lead.x, z: lead.z, y: heightAt(lead.x, lead.z) };
    const n = nearestLocal(feed.x, feed.z);
    return n ? { x: n.p.position.x, z: n.p.position.z, y: n.p.position.y } : { x: feed.x, z: feed.z, y: heightAt(feed.x, feed.z) };
  }
  function startRun() {
    const feeder = feederPoint();
    run = { feeder, shot: pickShot(plan, feeder, { x: feeder.x + (pc.x - feeder.x) * 0.4, z: feeder.z + (pc.z - feeder.z) * 0.4 }, heightAt), banner: false, confetti: false, emerged: [false, false, false], t: 0 };
    ray.beat = ray.soak = ray.dart = null; ray.extraRoll = 0; ray.hideUntil = 0;
    while (pod.length < 3) pod.push(makeWildModel());
  }
  function endRun() {
    if (!run) return;
    run = null;
    for (const m of pod) m.root.visible = false;
    cin.releaseAll(); cin.end();
    hideRay();
  }
  function sceneTarget(dt) {
    const t = run.t, f = run.feeder;
    if (t < 1.0) return { x: f.x, z: f.z, y: f.y + 2.2, fast: true, slow: 1.4, look: Math.atan2(f.x - ray.s.x, f.z - ray.s.z) };
    if (t < 3.6) {
      const a = (t - 1.0) * 2.7, r = 1.9;
      ray.extraRoll = Math.sin(a) * 0.35;
      return { x: f.x + Math.cos(a) * r, z: f.z + Math.sin(a) * r, y: f.y + 1.9 + Math.sin(a * 0.5) * 0.35, fast: true, slow: 1.8 };
    }
    ray.extraRoll *= 0.9;
    return { x: f.x, z: f.z, y: f.y + 2.5 + Math.sin(time * 2) * 0.08, slow: 1, look: Math.atan2(pc.x - f.x, pc.z - f.z) };
  }
  function stepPod(dt) {
    const t = run.t;
    pod.forEach((m, k) => {
      const t0 = 2.2 + k * 0.32, u = clamp((t - t0) / 1.3);
      if (u <= 0) { m.root.visible = false; return; }
      if (!run.emerged[k]) {
        run.emerged[k] = true; snd('splash', { pitch: 1.2 + k * 0.12, vol: 0.5 });
        if (particles) { particles.burst('puff', { x: pc.x, y: pondY + 0.1, z: pc.z }, { count: 8, radius: 1.4, ring: true, height: 0.1, speed: 1.2 }); particles.burst('sparkle', { x: pc.x, y: pondY + 0.8, z: pc.z }, { count: 8, radius: 1.2, height: 0.7, color: '#9ff2ff' }); }
      }
      const leave = smooth((t - 5.2) / 1.0);
      const a = t * 1.5 + k * (TAU / 3), r = (2.0 + 0.7 * k) * (0.6 + 0.4 * smooth(u)) + leave * 5;
      const y = pondY - 0.15 + smooth(u) * (1.9 + 0.35 * k) + leave * 3;
      m.root.visible = true;
      m.root.position.set(pc.x + Math.cos(a) * r, y, pc.z + Math.sin(a) * r);
      m.root.rotation.y = -a + Math.PI;
      m.rig.rotation.z = 0.32 + 0.1 * Math.sin(t * 3 + k);
      m.rig.rotation.x = 0.1;
      m.root.scale.setScalar(Math.max(0.001, appearScale(u * PET.appear) * (1 - leave)));
      m.update(dt, time + k, { sway: 1, rocking: 1 });
    });
  }
  function stepScene(dt) {
    const sc = st().scene, start = sc.startAt;
    if (start === null) { if (run) endRun(); return; }
    if (!run) {
      const late = (capray.now() - start) / 1000 > CAPRAY.scene.end + 0.5;
      if (late || cin.busy || !cin.begin('capray', { avatarsCinematic: false })) return;
      startRun();
    }
    const t = Math.max(0, (capray.now() - start) / 1000);
    run.t = t;
    cin.freezeAll();
    if (cin.pollSkip(dt, t)) { capray.skip(); return; }
    stepPod(dt);
    // camera: behind the feeder looking across at the pond; slowly orbiting
    const f = run.feeder, sh = run.shot, dolly = smooth(t / CAPRAY.scene.end) * 0.14;
    look.set(f.x + (pc.x - f.x) * 0.4, pondY + 1.9, f.z + (pc.z - f.z) * 0.4);
    camPos.set(sh.x + (look.x - sh.x) * dolly, sh.y + t * 0.1, sh.z + (look.z - sh.z) * dolly);
    if (t < 1.0 && cin.startPos && cin.startLook) {
      const k = smooth(t / 1.0);
      camPos.lerpVectors(cin.startPos, camPos.clone(), k); look.lerpVectors(cin.startLook, look.clone(), k);
    }
    camera.position.copy(camPos);
    cin.look(look);
    if (!run.banner && t >= 4.3) {
      run.banner = true;
      cin.showBanner([{ text: 'Capray wants to come with you!', cls: 'fb-title' }]);
    }
    if (!run.confetti && t >= 4.5) {
      run.confetti = true;
      snd('jingle', { pitch: 1.05, vol: 0.8 });
      if (particles) { particles.burst('confetti', { x: f.x, y: f.y + 2.6, z: f.z }, { count: 34, radius: 1.4, height: 0.4 }); particles.burst('heart', { x: f.x, y: f.y + 2.2, z: f.z }, { count: 6, radius: 1.0 }); }
    }
  }

  // ------------------------------------------------------------------ "Bring Capray along?"
  const asks = [];
  let asking = null;
  function ask(p) {
    if (!p || dialog.isOpen) return false;
    const done = () => { asking = null; dialog.close(); };
    asking = p;
    dialog.open({
      name: 'Capray', owner: p, tag: players.multi ? p.colors.name : '', color: p.colors.ui, menuId: 'capray-ask', text: 'Bring Capray along?',
      choices: [
        { label: 'Yes!', icon: ICONS['pet-capray'], onSelect: () => { done(); pets.set(p, 'capray', { fx: true }); if (hud) hud.toast('Capray will come along!', { icon: 'pet-capray', duration: 2600 }); } },
        { label: 'Not now', icon: LEAVE_SVG, onSelect: () => { done(); if (hud) hud.toast('You can choose a pet at the stable by the hearth.', { icon: 'sparkle', duration: 3000 }); } },
      ],
      onCancel: done,
    });
    return true;
  }
  domain.onUnlock((id, { live }) => {
    if (!live || id !== 'capray') return;
    for (const p of players.list) if (!asks.includes(p)) asks.push(p);
  });
  function stepAsks() {
    if (!asks.length || dialog.isOpen || cin.busy || asking) return;
    while (asks.length) {
      const p = asks.shift();
      if (!players.list.includes(p) || p.away || pets.petOf(p) === 'capray') continue;
      if (ask(p)) break;
    }
  }

  // ------------------------------------------------------------------ Marlo's pointers
  if (marlo) marlo.setRowProvider(() => [{ label: st().stage >= 5 ? 'How is Capray?' : 'Anything odd about the marsh?', lines: marloLine(st(), rodSeen || st().stage > 0) }]);

  // ------------------------------------------------------------------ where the ray waits in its pond, and the offering spot beside it
  function stepPondSpot(dt) {
    const s = st(), need = needOf(s);
    approacher = null;
    if (need && here() && inventory.count(need) >= 1) {
      let bd = CAPRAY.approach;
      for (const p of players.list) {
        if (p.away) continue;
        const d = edgeDistance(pond, p.position.x, p.position.z);
        if (d <= bd) { bd = d; approacher = p; }
      }
    }
    if (!ray.beat && !ray.dart) {
      let tx, tz;
      if (approacher) { tx = approacher.position.x - pc.x; tz = approacher.position.z - pc.z; }
      else { const a = Math.atan2(dir.z, dir.x) + dt * 0.16; tx = Math.cos(a); tz = Math.sin(a); }      // drifting slowly round the pond
      const n = Math.hypot(tx, tz) || 1, k = 1 - Math.exp(-(approacher ? 3 : 8) * dt);
      dir.x = lerp(dir.x, tx / n, k); dir.z = lerp(dir.z, tz / n, k);
      const m = Math.hypot(dir.x, dir.z) || 1; dir.x /= m; dir.z /= m;
    }
    // the prompt sits on the shore just outside the ray (ground height there), so "where it is" is where you offer
    const r = ray.shown ? Math.hypot(ray.s.x - pc.x, ray.s.z - pc.z) : 0;
    const ux = r > 0.3 ? (ray.s.x - pc.x) / r : dir.x, uz = r > 0.3 ? (ray.s.z - pc.z) / r : dir.z;
    const ex = pc.x + ux * (pond.rx + 0.5), ez = pc.z + uz * (pond.rz + 0.5);
    iFeed.position.set(ex, Math.max(pondY, heightAt(ex, ez)), ez);
  }

  // ------------------------------------------------------------------ hint markers: the titans still to clear / shake, the pond while someone carries the fish it wants
  const markers = markerRoot ? createEdgeMarkers(markerRoot, { camera, cls: 'hud-edge-capray' }) : null;
  const targets = [];
  function stepMarkers() {
    if (!markers) return;
    targets.length = 0;
    const s = st(), onIsland = here() && players.list.some((p) => !p.away && edgeDistance(pond, p.position.x, p.position.z) < 260);
    if (onIsland && !cin.busy && !dialog.isOpen) {
      const by = (t) => players.list.some((p) => !p.away && Math.hypot(p.position.x - t.x, p.position.z - t.z) < t.collR + 6);     // (standing at it: its own prompt says what to do)
      if (s.stage === 3) plan.titans.forEach((t, i) => { if (!s.spores[i] && !by(t)) targets.push({ x: t.x, y: t.y + 3.4, z: t.z, label: s.moss[i] ? 'Shake' : 'Shade moss', pin: true }); });
      const need = needOf(s);
      const near = players.list.some((p) => !p.away && edgeDistance(pond, p.position.x, p.position.z) < CAPRAY.approach + 4);       // (close by, the ray itself is the marker)
      if (need && inventory.count(need) >= 1 && !near) targets.push({ x: pc.x, y: pondY + 1.2, z: pc.z, label: 'Capray', pin: false });
    }
    markers.update(targets);
  }

  // ------------------------------------------------------------------ per frame
  function update(dt) {
    dt = Math.min(dt, 0.1);
    time += dt;
    if (!rodSeen) {
      if (st().stage > 0) rodSeen = true;
      else if (items && items.list.some((r) => r.kind === 'rod' && r.state !== 'ground')) rodSeen = true;
    }
    iFeed.prompt = needOf(st()) === 'lanternkoi' ? 'Offer a Lanternkoi' : 'Offer a Glimmerfin';
    for (const a of iMoss) { const h = st().hits[a.titan.index] || 0; a.prompt = `Clear moss ${h}/${CAPRAY.hits}`; }
    // the sighting: somebody walks up to the pond with (or after) a rod
    sightCooldown = Math.max(0, sightCooldown - dt);
    if (st().stage === 0 && rodSeen && here() && sightCooldown <= 0 && !cin.busy) {
      const p = players.list.find((q) => !q.away && !q.frozen && edgeDistance(pond, q.position.x, q.position.z) <= CAPRAY.sight);
      if (p) { sightCooldown = 3; settle(capray.sight(p)); }
    }
    stepScene(dt);
    stepSwings(dt);
    stepMoss(dt);
    stepShowers(dt);
    stepPondSpot(dt);
    stepRay(dt);
    stepMarkers();
    hintBubbles();
    stepAsks();
    wildGlow.value = petUniforms.uGlow.value * ray.glow;
  }

  snapMoss();
  ray.glow = rayGlow(st());

  return {
    update, clearMoss, ask,
    get markers() { return markers ? markers.summary() : null; },
    get asking() { return asking; },
    get rodSeen() { return rodSeen; },
    get wild() { return { shown: ray.shown, mode: ray.mode, position: { x: +ray.s.x.toFixed(2), y: +ray.s.y.toFixed(2), z: +ray.s.z.toFixed(2) }, glow: +ray.glow.toFixed(2), beat: !!ray.beat, soak: !!ray.soak, dart: !!ray.dart }; },
    get moss() { return { mesh: moss, visible: moss.visible, count: moss.count, scale: mossK.map((v) => +v.toFixed(3)), dim: dimK.map((v) => +v.toFixed(3)) }; },
    get scene() { return { active: !!run, t: run ? +run.t.toFixed(2) : null }; },
    get interactables() { return { feed: iFeed, moss: iMoss, shake: iShake }; },
    get ray() { return ray; },
    snapMoss,
    summary() {
      let calls = 0;
      if (ray.model && ray.shown) calls += ray.model.drawCalls;
      if (moss.visible) calls += 1;
      return {
        stage: st().stage, rodSeen, wild: this.wild, moss: this.moss && { visible: moss.visible, scale: mossK.map((v) => +v.toFixed(3)), dim: dimK.map((v) => +v.toFixed(3)) },
        scene: this.scene, asks: asks.length, asking: !!asking, drawCalls: calls, pend: pend.length,
      };
    },
  };
}
