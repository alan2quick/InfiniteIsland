// Player: movement physics, terrain following, blocking, collisions and procedural animation.
//
//   const player = new Player(scene);
//   player.update(dt, inputState)     // inputState from InputManager.update()
//   player.position                   // THREE.Vector3 (feet, world) - same object as player.root.position
//   player.facing                     // yaw in radians (0 = facing +Z)
//   player.velocity                   // { x, z }
//   player.frozen = true              // ignore input (dialogs)
//   player.hop()                      // little emote jump (returns false if already mid-hop)
//   player.dodge(dx, dz, {motion})    // Step 54 (dungeon): a low hop + a dash along (dx, dz) (none = straight up); motion:false = remote avatar, hop only (the pose packets move it)
//   player.dash(dx, dz, dist, dur)    // Step 54: a straight dash of `dist` u over `dur` s through the normal collision steps (never through walls); cancelled by hurt() / teleport()
//   player.faceToward(x, z)           // smoothly turn to look at a world point (cancelled by movement input)
//   player.holding = true             // holding an item: right arm rests in a raised pose (less walk swing)
//   player.swing(dur, keys)           // item swing animation (wind-up + slash + recover); false if already swinging. `keys` = optional
//                                     // [wind-up, end] arm keyframes ([arm pitch, arm sway, body twist, body lean]) instead of the slash ones
//   player.setPose(keys | null)       // hold a steady arm pose ([arm pitch, arm sway, body twist, body lean], like swing keys) until setPose(null): it blends in / out
//                                     // (campfire cooking: the arm reaches toward the fire with a stick)
//   (Step 68a) inside a hop-course zone (game/hopLogic.js registry) the body has REAL heights: hop() jumps off pads, a fall into a gap cell is a splash and a pop back at the last checkpoint pad; outside every
//   zone nothing below runs (player._course === null)
//   player.pageDrive = {...} | null   // Step 49: inside a storybook page game/pagePlayers.js owns the position (a platformer body); update() then only turns, animates and puffs dust
//   player._air                       // 0 on the ground / 1 rising / 2 falling: the page jump and fall poses (also set on remote avatars from the pose flags)
//   player.groundProbe = (x, z) => y  // optional: where the floor really is under the blob shadow (storybook pages: the tile under the player)
//   player.dustBurst(n)               // a few dust puffs at the feet (landings, turns)
//   player.showoff = true             // the Journal "look what I found!" pose (world/journalShowcase.js): right arm thrust up, left arm flung out, leaning back; blends in / out
//   player.squash(amount)             // one quick squash (-) / stretch (+) spring, e.g. -0.15 when bending down to pick something
//   player.speedScale = 0.55          // Step 59 (dungeon): multiplies the walking speed (the chill of a frost spray)
//   player.downed = true              // Step 55 (dungeon): wilted at 0 HP: input ignored, the body squashes low (dungeon.js sets it on every screen from the synced state)
//   player.paused = true              // like frozen, but owned by the PlayerManager (pair panel freezes everybody)
//   player.moveGuard = (p, x, z) => bool   // optional: veto a per-axis move to (x, z) (the multiplayer tether)
//   player.nudge(dx, dz)              // small collision-aware displacement (soft push between players)
//   player.setHat(model | null)       // swap the hat on parts.headSocket (null = bare head); returns the previous hat (pass it back to restore)
//   player.wearTail(i)                // tail TAILS[i] (0..11, player/tails.js) on the back socket, -1 = none: builds the model, frees the previous one. player.tailIndex = what is worn (Step 36a)
//   player.wearHat(i)                 // feast hat HATS[i] (0..9), or -1 for the default beanie: builds the model, frees the previous custom one. player.hatIndex = what is worn
//   player.setColors({hat,cuff,shirt,pants})  // recolour the merged body meshes live (no rebuild)
//   player.dispose()                  // remove from the scene and free per-player GPU resources
import * as THREE from 'three';
import { CARRY } from '../config.js';
import { slideVelocity, rideFloe } from '../game/iceLogic.js';
import {
  PLAYER_HITSTUN, COMBAT, HOP_COURSE, PLAYER_SPEED, PLAYER_WALK_SPEED, PLAYER_ACCEL, PLAYER_DAMPING, PLAYER_RADIUS,
  TURN_SPEED, WALK_THRESHOLD,
} from '../config.js';
import { getHeight, isWalkable, SPAWN } from '../world/terrain.js';
import { resolveCircle } from '../world/colliders.js';
import { createCharacter } from './character.js';
import { HATS } from './hats.js';
import { PARTY_HATS } from './partyHats.js';
import { TAILS } from './tails.js';
import { GARLANDS } from './garlands.js';
import { createCharmTrinket } from './charmModels.js';
import { courseAt, hopTime, stepHop, surfaceAt, padPos, splashY, blocks, hopEvents, catchFall, backDownY } from '../game/hopLogic.js';

const MAX_DT = 0.05;
const TWO_PI = Math.PI * 2;
const MAX_STEP = 0.25;              // max distance moved per collision sub-step (keeps walkability checks honest)
const GRAVITY = HOP_COURSE.gravity;       // (24; game/hopLogic.js steps hop-course bodies with the SAME numbers)
const HOP_SPEED = HOP_COURSE.hopSpeed;    // (5.6: apex 0.65 u, airtime 0.47 s)
const HOP_TERRAIN = { height: (x, z) => getHeight(x, z) };
let hopSpeed = HOP_SPEED;                  // the hop()'s take-off speed: a party game may raise it for every Player on a screen (local and avatars alike) and put it back
/** Step 80: set the take-off speed of every hop() on this screen (null = the normal hop). Vine Skip jumps higher and longer so little kids clear the vine. */
export function setHopSpeed(v) { hopSpeed = Number.isFinite(v) && v > 0 ? v : HOP_SPEED; }
const DUST_POOL = 18;
export const HOLD_ARM_X = -1.15;    // right-arm pitch while holding an item (negative = raised forward)
export const HOLD_ARM_Z = -0.32;    // extra outward tilt on top of the rest pose
const SWING_DUR = 0.36;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (k, dt) => 1 - Math.exp(-k * dt);
function shortestAngle(from, to) {
  let d = (to - from) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  else if (d < -Math.PI) d += TWO_PI;
  return d;
}

function makePuffTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(16, 16, 1, 16, 16, 15);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.7, 'rgba(255,255,255,0.9)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.beginPath(); g.arc(16, 16, 15, 0, TWO_PI); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Player {
  constructor(scene, { x = SPAWN.x, z = SPAWN.z, colors = null, index = 0 } = {}) {
    this.scene = scene;
    this.index = index;                 // 0-based slot (P1 = 0)
    this.colors = colors;
    const ch = createCharacter(colors || {});
    this.character = ch;
    this.root = ch.root;
    this.parts = ch.parts;
    this.height = ch.height;
    // Reuse the six merged body geometries for a cheap occluded-only silhouette.
    // GreaterDepth draws it only where something is in front of the player, and the stencil test (the character's
    // toon material marks its visible pixels, see character.js) keeps it off the character's own surface: face
    // details sit just in front of the head, so depth alone would paint the silhouette over the eyes and blush.
    // The ghost also writes the mark itself (zPass Replace), so each pixel is tinted once: the six translucent parts
    // no longer stack into darker blobs where they overlap. The shading is an x-ray rim: a faint fill that brightens
    // toward the edges (fresnel), so it reads as a glowing outline of the character rather than a flat gummy shape.
    // FrontSide + skipping the baked outline hull (aMark.w) avoid needless overdraw.
    this._silhouetteMat = new THREE.MeshBasicMaterial({
      color: colors?.ui || '#ffc869', transparent: true,
      depthFunc: THREE.GreaterDepth, depthWrite: false, side: THREE.FrontSide,
      stencilWrite: true, stencilRef: 1, stencilFunc: THREE.NotEqualStencilFunc,   // only where the character isn't visible
      stencilZPass: THREE.ReplaceStencilOp,                                         // ...and only once per pixel
    });
    this._silhouetteMat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 aMark;\nvarying vec3 vSilN;\nvarying vec3 vSilV;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvSilN = normalize(normalMatrix * normal);\nvSilV = -mvPosition.xyz;\nif (aMark.w > 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vSilN;\nvarying vec3 vSilV;')
        .replace('#include <opaque_fragment>', [
          'float silRim = smoothstep(0.35, 0.85, 1.0 - abs(dot(normalize(vSilN), normalize(vSilV))));',
          // the outermost band darkens toward the #2b2340 outline colour (linear: the colour-space chunk runs after), so the shape reads on pale rock as well as grass
          'float silEdge = smoothstep(0.8, 0.95, 1.0 - abs(dot(normalize(vSilN), normalize(vSilV))));',
          'gl_FragColor = vec4(mix(outgoingLight, vec3(0.024, 0.017, 0.051), 0.6 * silEdge), mix(0.3, 0.95, silRim));',
        ].join('\n'));
    };
    this._silhouetteMat.customProgramCacheKey = () => 'character-silhouette-rim';
    // Fixed order (head, body, then limbs) so the once-per-pixel rule picks the same part every frame instead of
    // following the transparent sort, which would make the inner rims flicker.
    const GHOST_ORDER = ['head', 'body', 'armL-mesh', 'armR-mesh', 'legL-mesh', 'legR-mesh'];
    const bodyMeshes = [];
    this.root.traverse((m) => {
      if (m.isMesh && GHOST_ORDER.includes(m.name)) bodyMeshes.push(m);
    });
    for (const m of bodyMeshes) {
      const ghost = new THREE.Mesh(m.geometry, this._silhouetteMat);
      ghost.name = 'occluded-silhouette';
      ghost.renderOrder = 100 + GHOST_ORDER.indexOf(m.name);
      ghost.frustumCulled = false;
      m.parent.add(ghost);
    }
    this.radius = PLAYER_RADIUS;

    this.position = this.root.position;
    this.position.set(x, getHeight(x, z), z);
    this.velocity = { x: 0, z: 0 };
    this.facing = 0;                    // face the camera at spawn
    this.root.rotation.y = this.facing;
    this.frozen = false;
    this.downed = false;                // Step 55: set by game/dungeon.js while this player is a sprout
    this.speedScale = 1;                // Step 59: walking speed factor (game/dungeon.js sets COMBAT.frost.chillSlow while the frostcap's frost spray chills this player)
    this._downK = 0;                    // 0..1 blend of the wilted pose
    this.paused = false;                // PlayerManager-owned freeze (pair panel), independent of dialog's `frozen`
    this.moveGuard = null;
    this._noGuard = false;
    this._faceTo = null;                // yaw to smoothly turn toward (faceToward), or null
    this.speed = 0;                     // current horizontal speed (u/s)
    this.moving = false;
    this.grounded = true;

    // animation state
    this._t = 0;
    this._phase = 0;
    this._swing = 0;                    // 0..1 walk-cycle amplitude
    this._lean = 0;
    this.holding = false;               // an item is in the right hand (set by world/items.js)
    this._hold = 0;                     // smoothed 0..1 blend of the "holding" arm pose
    this._swingT = -1;                  // <0 idle, else seconds into the swing
    this._swingDur = SWING_DUR;
    // swing keyframes [arm pitch, arm sway, body twist, body lean]: wind-up (K1) and end of the slash (K2)
    this.swingKeys = [[-0.4, -2.4, -0.55, -0.05], [-1.0, 0.9, 0.65, 0.12]];
    this._swingKeys = this.swingKeys;   // the keyframes of the swing in progress (swing() may override them, e.g. the shovel dig)
    this._hurtT = -1; this._hurtDur = PLAYER_HITSTUN; this._hurtDirection = { x: 0, z: -1 };
    this._pose = null;                  // steady arm pose (setPose)
    this._poseLast = null;
    this._poseK = 0;                    // 0..1 blend of that pose
    this.showoff = false;               // Journal showcase pose (see the header)
    this._showK = 0;
    this._sq = 0;                       // squash(-)/stretch(+) spring value
    this._sqVel = 0;
    this._hopY = 0;
    this._hopVel = 0;
    this._dash = null;                  // Step 54: { vx, vz, t, dur } while a dodge / dash is moving the body
    this._course = null;                // Step 68a: the hop course whose zone holds the player (game/hopLogic.js), null almost always
    this._cb = null;                    // ...and its vertical body { x, z, y, vy, grounded, pad, splash, checkpoint }
    this._courseWalk = null;            // the course's walkability check (a zone's water is walkable; pad sides are walls), null = the terrain's isWalkable
    this._courseJump = false;
    this._splashing = false;
    this._wet = false;                  // standing on a slippery pad
    this._savedProbe = null;
    this.pageDrive = null;              // storybook page body state ({ vx, face, grounded }), see the header
    this._air = 0;
    this._airV = 0;                     // smoothed raise of the arms in the air
    this._airK = 0;
    this.groundProbe = null;
    this.hatIndex = -1;                 // feast hat worn (HATS index), -1 = the default beanie (sent in the pose packet)
    this.tailIndex = -1;                // tail worn (TAILS index), -1 = none (36b sends it in the pose packet)
    this._tailModel = null;
    this.garlandIndex = -1;
    this.offhandCharm = null;           // Step 58: the charm id whose trinket is in the left hand (derived from the synced run state by game/dungeon.js)
    this._offhandModel = null;
    this._garlandModel = null;
    this._hatModel = null;              // the custom hat model this player built (the default beanie belongs to the character)
    this._wasInput = false;
    this._prevSpeed = 0;
    this._blinkTimer = 2 + Math.random() * 2;
    this._blink = -1;                   // <0 idle, else 0..1 progress
    this._turnRate = 0;
    this._sproutLag = { x: 0, z: 0 };
    this._dust = [];
    this._dustTimer = 0;
    this._dustSide = 1;
    this._tmpN = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    this._qTmp = new THREE.Quaternion();

    this._buildDust();
    scene.add(this.root);
  }

  // ---------------------------------------------------------------------------------------------
  // Public helpers
  // ---------------------------------------------------------------------------------------------

  /** Little jump emote with a squash on take-off and landing. */
  hop() {
    if (this._cb) {                                           // Step 68a: a real jump off a pad
      if (this._cb.splash || !this._cb.grounded) return false;
      this._courseJump = true; this._sq = -0.16; this._sqVel = 0;
      return true;
    }
    if (this._hopY > 0.02 || this._hopVel > 0) return false;
    this._hopVel = hopSpeed * (this.carrying ? CARRY.jump : 1);
    this._sq = -0.16;
    this._sqVel = 0;
    return true;
  }

  /** The dungeon dodge-hop (Step 54): a lower, quicker hop than hop() with a stretch, plus a dash when a direction is given. */
  dodge(dx = 0, dz = 0, { motion = true } = {}) {
    const c = COMBAT.dodge, len = Math.hypot(dx, dz);
    this._hopY = 0; this._hopVel = GRAVITY * c.air / 2;     // airtime = 2 v / g = c.air
    this._sq = 0.14; this._sqVel = 0; this._swingT = -1;
    if (len > 0.2) {
      this.facing = Math.atan2(dx, dz); this._faceTo = null;
      if (motion) this.dash(dx / len, dz / len, c.dist, c.dash);
    }
    return true;
  }

  /** A straight dash: velocity is forced for `dur` s so every sub-step still slides along walls and colliders. */
  dash(dx, dz, dist, dur) {
    const len = Math.hypot(dx, dz);
    if (!(dist > 0) || !(dur > 0) || !len) { this._dash = null; return; }
    this._dash = { vx: dx / len * dist / dur, vz: dz / len * dist / dur, t: 0, dur };
    this.facing = Math.atan2(dx, dz); this._faceTo = null;
  }

  /** Item swing: arm winds up, slashes across the body, recovers (~0.36s). Returns false if a swing is in progress. */
  swing(dur = SWING_DUR, keys = null) {
    if (this.carrying || this._swingT >= 0 || this.hurting) return false;
    this._swingT = 0;
    this._swingDur = dur;
    this._swingKeys = keys || this.swingKeys;
    return true;
  }

  /** Brief damage recoil. Offsets the rig rather than moving the authoritative feet through walls. */
  hurt(direction = { x: 0, z: -1 }, duration = PLAYER_HITSTUN) {
    this._hurtT = 0; this._hurtDur = Math.max(0.01, duration); this._swingT = -1; this._dash = null;
    const length = Math.hypot(direction.x, direction.z) || 1;
    this._hurtDirection = { x: direction.x / length, z: direction.z / length };
    this.velocity.x = this.velocity.z = 0;
  }
  clearHurt() { this._hurtT = -1; this.parts.rig.position.x = this.parts.rig.position.z = 0; }
  /** Freeze only rendered transforms. Swing, hurt, hop, movement and input clocks still advance. */
  freezePose(seconds) {
    if (!(seconds > 0)) return;
    if (!(this._poseFreeze > 0)) {
      this._frozenTransforms = [];
      this.parts.rig.traverse((o) => this._frozenTransforms.push({ o, p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone() }));
    }
    this._poseFreeze = Math.max(this._poseFreeze || 0, seconds);
  }
  _animatePose(dt, moving) {
    this._animate(dt, moving);
    this._poseFrozenThisFrame = this._poseFreeze > 0;
    if (this._poseFreeze > 0) {
      for (const { o, p, q, s } of this._frozenTransforms) { o.position.copy(p); o.quaternion.copy(q); o.scale.copy(s); }
      this._poseFreeze = Math.max(0, this._poseFreeze - dt);
      if (!this._poseFreeze) this._frozenTransforms = null;
    }
  }
  get hurting() { return this._hurtT >= 0; }

  /** Hold a steady arm pose ([arm pitch, arm sway, body twist, body lean]) until setPose(null); blends smoothly in and out. */
  setPose(keys) {
    this._pose = keys;
    if (keys) this._poseLast = keys;
  }

  /** A single squash (negative) or stretch (positive) spring: bending down to pick something up, a little "hup!". */
  squash(amount = -0.15) {
    this._sq = amount;
    this._sqVel = 0;
  }

  get swinging() { return this._swingT >= 0; }
  /** 0..1 progress of the current swing (0 when idle). */
  get swingProgress() { return this._swingT < 0 ? 0 : this._swingT / this._swingDur; }

  /** Smoothly turn to face a world point (used when interacting). Movement input cancels it. */
  faceToward(x, z) {
    const dx = x - this.position.x, dz = z - this.position.z;
    if (dx * dx + dz * dz < 1e-6) return;
    this._faceTo = Math.atan2(dx, dz);
  }

  /** Small collision-aware displacement that ignores the tether guard (used for the soft push between players). */
  nudge(dx, dz) {
    if (this.pageDrive) return;               // (page bodies never push each other: Wonder rule, Step 49)
    this._noGuard = true;
    this._step(dx, dz);
    this._noGuard = false;
  }

  // ---------------------------------------------------------------------------------------------
  // Hop courses (Step 68a)
  // ---------------------------------------------------------------------------------------------

  _switchCourse(course) {
    // Keep the vertical body across zone boundaries until its fall has actually landed.
    if (this._cb && (this._cb.splash || !this._cb.grounded || this.position.y > getHeight(this.position.x, this.position.z) + 0.08)) return;
    if (this._course) this._leaveCourse();
    if (!course) return;
    const p = this.position;
    this._course = course;
    this._hopY = 0; this._hopVel = 0;
    const cb = this._cb = { x: p.x, z: p.z, y: p.y, vy: 0, grounded: true, pad: null, splash: null, checkpoint: course.start, glide: !!this._sailGlideArmed };
    { const s = surfaceAt(course, p.x, p.z, hopTime(), p.y, HOP_TERRAIN);       // only snap to a nearby top: a spiral has multiple tiers at the same x/z
      if (s.y > cb.y && s.pad) { cb.y = s.y; p.y = s.y; cb.pad = s.pad; } }
    const zn = course.zone;
    this._courseWalk = (x, z) => {                             // inside the zone everything but a pad's side wall may be entered (a gap cell: you fall in); outside, the terrain decides
      const dx = x - zn.x, dz = z - zn.z;
      if (dx * dx + dz * dz > zn.r * zn.r) return isWalkable(x, z);
      return !blocks(course, x, z, cb.y, hopTime());
    };
    this._savedProbe = this.groundProbe;
    this.groundProbe = (x, z) => { const s = surfaceAt(course, x, z, hopTime(), cb.y, HOP_TERRAIN); return s.y === -Infinity ? null : s.y; };   // the blob shadow lies on the pad / ground below
  }

  _leaveCourse() {
    this._course = null; this._cb = null; this._courseWalk = null; this._courseJump = false; this._splashing = false; this._wet = false; this._ice = false; this._gliding = false;
    this._air = 0; this.groundProbe = this._savedProbe; this._savedProbe = null;
  }

  /** The vertical half of a hop-course frame: jump / fall / land on pads, ride moving pads, splash and pop back at the last checkpoint. */
  _courseVertical(dt) {
    const cb = this._cb, course = this._course, p = this.position, t = hopTime();
    if (cb.splash) {                                            // sinking: input is ignored until the pop back
      cb.splash.t += dt;
      cb.y = Math.max(cb.y - 2.2 * dt, splashY(course) - 0.5);
      p.y = cb.y;
      if (cb.splash.t >= HOP_COURSE.splash.delay) this._courseRespawn();
      return;
    }
    const before = cb.pad ? { ...padPos(course.pads.find((q) => q.id === cb.pad), t - dt) } : null;
    cb.x = p.x; cb.z = p.z;
    const glided = !!cb.glide;                                  // (a landing clears it: the catch below must know the sail's descent was a glide)
    const ev = stepHop(cb, { jump: this._courseJump, glide: this._glideHeld }, course, t, dt, HOP_TERRAIN, { jumpScale: this.carrying ? CARRY.jump : 1 });
    this._courseJump = false;
    if (ev.shift) { this._noGuard = true; this._step(ev.shift.x, ev.shift.z); this._noGuard = false; cb.x = p.x; cb.z = p.z; }
    if (cb.grounded && cb.pad) {
      const pad = course.pads.find((q) => q.id === cb.pad);
      if (pad.cp) cb.checkpoint = pad.id;
      if (pad.motion && before) { const now = padPos(pad, t); this._noGuard = true; if (pad.kind === 'floe') { const ride = rideFloe(p, before, now); this._step(ride.x - p.x, ride.z - p.z); } else this._step(now.x - before.x, now.z - before.z); this._noGuard = false; }
      this._wet = pad.kind === 'wet'; this._ice = pad.kind === 'floe' || !!pad.slippery;
    } else {
      this._wet = false; this._ice = false;
      // Riding the slide / stairs ends the checkpoint's catch: whatever ground follows is walked, never a trap (the start checkpoint cannot catch)
      if (cb.grounded && backDownY(course, p.x, p.z) !== null) cb.checkpoint = course.start;
    }
    p.y = cb.y;
    this._gliding = !!cb.glide && !!this._glideHeld && !cb.grounded;
    this._air = cb.grounded ? 0 : (cb.vy > 0 ? 1 : 2);
    if (ev.jumped && hopEvents.onJump) hopEvents.onJump(this);
    if (ev.landed) {
      this._sailGlideArmed = false;
      if (ev.landed > 2) { this._sq = -0.2; this._sqVel = 0; this.dustBurst(2, 0.6); }
      if (hopEvents.onLand) hopEvents.onLand(this, ev.landed);
    }
    if (ev.splash) {
      cb.splash = { t: 0 }; this._splashing = true; this.velocity.x = this.velocity.z = 0; this._air = 2;
      if (hopEvents.onSplash) hopEvents.onSplash(this, HOP_COURSE.splash.delay);
    } else if (ev.landed && catchFall(course, cb, p.x, p.z, cb.y, glided)) this._courseRespawn('catch');   // Step 68e: a high fall pops back onto the checkpoint, softly
  }

  /** Pop back onto the last checkpoint. kind 'splash' (water / lava, after the sink) or 'catch' (a fall off a high pad: no splash, a soft poof, Step 68e). */
  _courseRespawn(kind = 'splash') {
    const cb = this._cb, course = this._course, t = hopTime();
    const from = { x: this.position.x, y: this.position.y, z: this.position.z };
    const pad = course.pads.find((q) => q.id === cb.checkpoint) || course.pads.find((q) => q.id === course.start);
    const at = padPos(pad, t);
    this.position.set(at.x, at.top, at.z);
    Object.assign(cb, { x: at.x, z: at.z, y: at.top, vy: 0, grounded: true, pad: pad.id, splash: null, glide: false });
    this._sailGlideArmed = false;
    this._splashing = false; this._air = 0; this._hopY = 0; this._hopVel = 0;
    this.velocity.x = this.velocity.z = 0;
    if (kind === 'catch') { if (hopEvents.onCatch) hopEvents.onCatch(this, from); } else if (hopEvents.onRespawn) hopEvents.onRespawn(this);
  }

  /** Swap the hat (any Object3D with its origin at the head centre, or null for a bare head). Returns the previous hat. */
  setHat(model) {
    return this.character.setHat(model);
  }

  /** Wear feast hat HATS[i], or the default beanie for -1 / an unknown index. Builds the model once per change and frees the previous custom one. */
  wearHat(i) {
    const hat = Number.isInteger(i) && i >= 0 ? HATS[i] : null;
    const idx = hat ? i : -1;
    const cur = this.character.hat;
    if (idx === this.hatIndex && cur && cur === (hat ? this._hatModel : this.character.defaultHat)) return cur;
    const model = hat ? hat.build(this.character.colors) : null;
    this.character.setHat(model || this.character.defaultHat);
    if (this._hatModel) this._hatModel.userData.dispose();
    this._hatModel = model;
    this.hatIndex = idx;
    return model || this.character.defaultHat;
  }

  /** Step 80a: wear a party bot's ears (player/partyHats.js PARTY_HATS[key]) instead of the hat, or the hat again for null. `player.partyHat` = the key worn (sent in the pose packet as hat id 64 + index). */
  wearPartyHat(key) {
    const k = key && PARTY_HATS[key] ? key : null;
    if (k === (this.partyHat || null)) return this._hatModel;
    if (k) {
      if (!this.partyHat) this._hatBeforeParty = this.hatIndex;
      const model = PARTY_HATS[k].build(this.character.colors);
      this.character.setHat(model);
      if (this._hatModel) this._hatModel.userData.dispose();
      this._hatModel = model;
      this.partyHat = k;
      return model;
    }
    const back = Number.isInteger(this._hatBeforeParty) ? this._hatBeforeParty : -1;
    this.partyHat = null;
    this.hatIndex = -99;                                            // (forces wearHat to rebuild and to free the ears)
    return this.wearHat(back);
  }

  /** Wear tail TAILS[i] on the back socket, or no tail for -1 / an unknown index. Builds the model once per change and frees the previous one. Returns the model or null. */
  wearTail(i) {
    const tail = Number.isInteger(i) && i >= 0 ? TAILS[i] : null;
    const idx = tail ? i : -1;
    if (idx === this.tailIndex && (tail ? this.character.back === this._tailModel : !this.character.back)) return this._tailModel;
    const model = tail ? tail.build() : null;
    this.character.setBack(model);
    if (this._tailModel) this._tailModel.userData.dispose();
    this._tailModel = model;
    this.tailIndex = idx;
    return model;
  }

  /** Hold the trinket of charm `id` in the left hand (null = empty hand). One mesh, shared geometry / material, so changing it builds nothing heavy. */
  setOffhandCharm(id) {
    id = id || null;
    if (id === this.offhandCharm) return;
    this.offhandCharm = id;
    this._offhandModel?.removeFromParent();
    this._offhandModel = null;
    const socket = this.character.parts.offhandSocket;
    if (!id || !socket) return;
    const m = createCharmTrinket(id);
    m.position.set(0, -0.02, 0.07); m.scale.setScalar(0.9);
    socket.add(m); this._offhandModel = m;
  }

  wearGarland(i) {
    const spec = Number.isInteger(i) && i >= 0 ? GARLANDS[i] : null;
    const idx = spec ? i : -1;
    if (idx === this.garlandIndex) return this._garlandModel;
    const model = spec ? spec.build() : null;
    this.character.setNeck(model);
    this._garlandModel?.userData.dispose();
    this._garlandModel = model;
    this.garlandIndex = idx;
    return model;
  }

  /** Recolour the character live: any of {hat, cuff, shirt, pants}. Also updates `player.colors` (a copy, never the shared config entry). */
  setColors(scheme) {
    this.colors = { ...(this.colors || {}), ...scheme };
    if (scheme.ui) this._silhouetteMat.color.set(scheme.ui);
    return this.character.setColors(scheme);
  }

  /** Remove from the scene and free the resources that are not shared (character geometries + material, blob texture, dust sprites). */
  dispose() {
    this.scene.remove(this.root);
    this.scene.remove(this._dustGroup);
    for (const sp of this._dust) sp.material.dispose();
    if (this._dust[0] && this._dust[0].material.map) this._dust[0].material.map.dispose();
    if (this._hatModel) { this._hatModel.userData.dispose(); this._hatModel = null; }
    if (this._tailModel) { this._tailModel.userData.dispose(); this._tailModel = null; }
    this._garlandModel?.userData.dispose();
    this._garlandModel = null;
    this.character.dispose();
    this._silhouetteMat.dispose();
  }

  teleport(x, z) {
    this.clearHurt(); this._dash = null; this._sailGlideArmed = false;
    if (this._course) this._leaveCourse();
    this.position.set(x, getHeight(x, z), z);
    this.velocity.x = this.velocity.z = 0;
  }

  // ---------------------------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------------------------

  update(dt, input) {
    dt = clamp(dt, 0, MAX_DT);
    if (dt === 0) return;
    this._t += dt;
    if (this.pageDrive) { this._updatePage(dt); return; }
    { const c = courseAt(this.position.x, this.position.z); if (c !== this._course) this._switchCourse(c); }     // Step 68a: null (and cheap) everywhere but inside a hop-course zone

    this._glideHeld = !!input?.jumpHeld && !this.frozen && !this.paused && !this.downed && !this.hurting;
    const mv = (!this.frozen && !this.paused && !this.downed && !this.hurting && !this._splashing && input && input.move) ? input.move : null;
    let mx = mv ? mv.x : 0, mz = mv ? mv.z : 0;
    let mag = Math.hypot(mx, mz);
    if (mag > 1) { mx /= mag; mz /= mag; mag = 1; }
    const hasInput = mag > 0.001;

    // --- target velocity (analog magnitude: walk below WALK_THRESHOLD, run above)
    let targetSpeed = 0;
    if (hasInput) {
      targetSpeed = mag <= WALK_THRESHOLD
        ? PLAYER_WALK_SPEED * (mag / WALK_THRESHOLD)
        : lerp(PLAYER_WALK_SPEED, PLAYER_SPEED, (mag - WALK_THRESHOLD) / (1 - WALK_THRESHOLD));
    }
    targetSpeed *= this.speedScale * (this.carrying ? CARRY.speed : 1);
    const v = this.velocity;
    if (this._ice) {
      Object.assign(v, slideVelocity(v, { x: hasInput ? mx / mag * targetSpeed : 0, z: hasInput ? mz / mag * targetSpeed : 0 }, dt));
    } else if (hasInput) {
      const tx = (mx / mag) * targetSpeed, tz = (mz / mag) * targetSpeed;
      const dx = tx - v.x, dz = tz - v.z;
      const len = Math.hypot(dx, dz);
      const step = PLAYER_ACCEL * dt;
      if (len <= step) { v.x = tx; v.z = tz; }
      else { v.x += (dx / len) * step; v.z += (dz / len) * step; }
    } else {
      const f = Math.exp(-PLAYER_DAMPING * (this._wet ? HOP_COURSE.wetDamping : 1) * dt);
      v.x *= f; v.z *= f;
      if (Math.hypot(v.x, v.z) < 0.05) { v.x = 0; v.z = 0; }
    }

    if (this._dash) {                                   // Step 54: a dodge / dash-stab overrides the walking velocity for its short duration
      const d = this._dash; d.t += dt;
      v.x = d.vx; v.z = d.vz;
      if (d.t >= d.dur) { v.x *= 0.25; v.z *= 0.25; this._dash = null; }
    }

    // --- integrate in sub-steps with per-axis sliding, walkability and collider push-out
    const moveX = v.x * dt, moveZ = v.z * dt;
    const dist = Math.hypot(moveX, moveZ);
    if (dist > 1e-6) {
      const steps = Math.max(1, Math.ceil(dist / MAX_STEP));
      const sx = moveX / steps, sz = moveZ / steps;
      for (let i = 0; i < steps; i++) this._step(sx, sz);
    }
    this.speed = Math.hypot(v.x, v.z);
    this.moving = this.speed > 0.3;

    // --- facing: smooth turn toward the direction of travel (input direction while accelerating)
    if (hasInput && this.speed > 0.2 && !this._dash) {              // (a dash keeps the facing it started with)
      const target = Math.atan2(mx, mz);
      const d = shortestAngle(this.facing, target);
      const turn = d * damp(TURN_SPEED, dt);
      this.facing += turn;
      this._turnRate = turn / dt;
      this._faceTo = null;
    } else if (this._faceTo !== null && !hasInput) {
      const d = shortestAngle(this.facing, this._faceTo);
      const turn = d * damp(16, dt);
      this.facing += turn;
      this._turnRate = turn / dt;
      if (Math.abs(d) < 0.03) this._faceTo = null;
    } else {
      this._turnRate *= Math.exp(-10 * dt);
    }
    this.facing = ((this.facing + Math.PI) % TWO_PI + TWO_PI) % TWO_PI - Math.PI;
    this.root.rotation.y = this.facing;

    // --- terrain following (smoothed)
    if (this._course) this._courseVertical(dt);
    else {
      const gy = getHeight(this.position.x, this.position.z);
      this.position.y = Math.abs(gy - this.position.y) > 2 ? gy : lerp(this.position.y, gy, damp(28, dt));
    }

    this._animatePose(dt, hasInput);
    this._updateDust(dt);
    this._prevSpeed = this.speed;
    this._wasInput = hasInput;
  }

  /** Storybook page (Step 49): the platformer body already moved this player; turn three-quarters toward the camera in the travel direction, then animate as usual. */
  _updatePage(dt) {
    const d = this.pageDrive;
    this.velocity.x = d.vx; this.velocity.z = 0;
    this.speed = Math.abs(d.vx);
    this.moving = d.grounded && this.speed > 0.3;
    const d0 = shortestAngle(this.facing, d.face * 1.0);
    const turn = d0 * damp(16, dt);
    this.facing += turn;
    this._turnRate = turn / dt;
    this.facing = ((this.facing + Math.PI) % TWO_PI + TWO_PI) % TWO_PI - Math.PI;
    this.root.rotation.y = this.facing + (this.spinAdd || 0);                 // (spinAdd: the Step 50 twirl, game/pageTools.js)
    this._faceTo = null;
    this._animatePose(dt, this.moving);
    this._updateDust(dt);
    this._prevSpeed = this.speed;
    this._wasInput = this.moving;
  }

  /** A few dust puffs at the feet (page landings and sharp turns). */
  dustBurst(n = 3, spread = 1) {
    for (let i = 0; i < n; i++) this._spawnDust(this.position.x + (Math.random() - 0.5) * 0.5, this.position.y, this.position.z + 0.1, (Math.random() - 0.5) * 2.4 * spread, (Math.random() - 0.5) * 0.4);
  }

  /** A remote avatar inside a hop-course zone lays its blob shadow on the pad / ground below it (the pose already carries the height). */
  _remoteCourse(course) {
    if (!course) { if (this._remoteProbe) { this.groundProbe = null; this._remoteProbe = false; } return; }
    if (this._remoteProbe && this._remoteCourseRef === course) return;
    this._remoteCourseRef = course; this._remoteProbe = true;
    this.groundProbe = (x, z) => { const s = surfaceAt(course, x, z, hopTime(), this.position.y, HOP_TERRAIN); return s.y === -Infinity ? null : s.y; };
  }

  /** Animate a network avatar at an externally interpolated pose; local collision/input never moves it. */
  updateRemote(dt, pose, dust = true) {
    dt = clamp(dt, 0, MAX_DT);
    if (!pose || dt <= 0) return;
    this._t += dt;
    this.position.set(pose.x, pose.y, pose.z);
    this.facing = pose.facing;
    this.root.rotation.y = this.facing + (this.spinAdd || 0);                 // (spinAdd: a remote page twirl, net/avatars.js)
    this.velocity.x = pose.vx;
    this.velocity.z = pose.vz;
    this.speed = Math.hypot(pose.vx, pose.vz);
    this.moving = !!(pose.flags & 1);
    this._air = (pose.flags & 16) ? 1 : (pose.flags & 32) ? 2 : 0;
    this._remoteCourse(courseAt(pose.x, pose.z));
    this._gliding = !!(pose.flags & 128);
    this._lineOut = !!(pose.flags & 256);                                  // Step 72a: a fishing line is out (world/fishingPlay.js draws the bobber and line from the facing)
    this._puff = !!(pose.flags & 64);                                      // a page player waiting to respawn as a dandelion puff (game/pagePlayers.js hides the body)       // (storybook page jumps: flags 16 rising / 32 falling)
    this._animatePose(dt, this.moving);
    if (dust) this._updateDust(dt);
    this._prevSpeed = this.speed;
    this._wasInput = this.moving;
  }

  _guardOk(x, z) { return this._noGuard || !this.moveGuard || this.moveGuard(this, x, z); }

  /** One collision sub-step: slide per axis, then resolve against prop colliders. */
  _step(dx, dz) {
    const p = this.position, v = this.velocity;
    const walk = this._courseWalk || isWalkable;                 // (Step 68a: a hop course swaps in its own check; null everywhere else)
    const canStand = walk(p.x, p.z);
    let nx = p.x, nz = p.z;

    // X axis then Z axis, each independently, so the player slides along coast/cliff edges.
    if (dx !== 0) {
      if ((!canStand || walk(p.x + dx, p.z)) && this._guardOk(p.x + dx, p.z)) nx = p.x + dx; else v.x *= 0.2;
    }
    if (dz !== 0) {
      if ((!canStand || walk(nx, p.z + dz)) && this._guardOk(nx, p.z + dz)) nz = p.z + dz; else v.z *= 0.2;
    }

    // Colliders: push out, but never push the player into unwalkable ground.
    const c = { x: nx, z: nz };
    resolveCircle(c, this.radius);
    if (walk(c.x, c.z) || !walk(nx, nz)) { nx = c.x; nz = c.z; }
    else {
      // Try a pure-axis version of the push before giving up.
      if (walk(c.x, nz)) nx = c.x;
      else if (walk(nx, c.z)) nz = c.z;
    }
    p.x = nx; p.z = nz;
  }

  // ---------------------------------------------------------------------------------------------
  // Procedural animation
  // ---------------------------------------------------------------------------------------------

  _animate(dt, hasInput) {
    const P = this.parts;
    const t = this._t;
    const speed = this.speed;
    const norm = clamp(speed / PLAYER_SPEED, 0, 1.2);

    // Squash & stretch events
    if (hasInput && !this._wasInput && this._prevSpeed < 1) this._sqVel += 3.2;                   // start: quick stretch
    if (!hasInput && this._wasInput && this._prevSpeed > 3.5) this._sqVel -= 3.2 * norm + 1.0;    // stop: squash

    // Hop physics
    if (this._hopY > 0 || this._hopVel > 0) {
      this._hopVel -= GRAVITY * dt;
      this._hopY += this._hopVel * dt;
      if (this._hopY <= 0) {
        this._hopY = 0;
        if (this._hopVel < -2) { this._sq = -0.2; this._sqVel = 0; }   // landing squash
        this._hopVel = 0;
      }
    }
    this.grounded = this._hopY <= 0.001 && !this._air;

    // Spring for squash/stretch
    const k = 260, c = 16;
    this._sqVel += (-k * this._sq - c * this._sqVel) * dt;
    this._sq += this._sqVel * dt;
    const sq = clamp(this._sq, -0.3, 0.3);

    // Walk cycle
    const swingTarget = this.grounded ? clamp(speed / 4.5, 0, 1) : 0;
    this._swing = lerp(this._swing, swingTarget, damp(14, dt));
    this._phase += dt * speed * 2.05;
    if (this._swing < 0.02 && speed < 0.2) this._phase = lerp(this._phase, Math.round(this._phase / Math.PI) * Math.PI, damp(8, dt));
    const s = Math.sin(this._phase);
    const sw = this._swing;

    P.legL.rotation.x = s * 0.95 * sw - 0.5 * this._airK;                                // (in the air: one knee tucked, the other trailing)
    P.legR.rotation.x = -s * 0.95 * sw + (this._air === 1 ? 0.3 : -0.35) * this._airK;
    const armAmp = 0.85 * sw;
    P.armL.rotation.x = -s * armAmp;
    // Right arm: holding an item blends toward a raised pose with a much smaller walk swing
    this._hold = lerp(this._hold, this.holding ? 1 : 0, damp(10, dt));
    const hold = this._hold;
    let armRx = s * armAmp * (1 - 0.78 * hold) + HOLD_ARM_X * hold;
    // Arms swing slightly outward when running, and fling up on a hop
    this._airV = lerp(this._airV, this._air === 1 ? 1.9 : this._air === 2 ? 1.0 : 0, damp(12, dt));      // storybook page: arms up on the rise, out on the fall
    this._airK = lerp(this._airK, this._air ? 1 : 0, damp(14, dt));
    const hopUp = Math.max(clamp(this._hopY * 3.2, 0, 2.2) * (this._hopVel !== 0 || this._hopY > 0 ? 1 : 0), this._airV);
    P.armL.rotation.z = P.armL.userData.restZ + 0.25 * sw + hopUp * 0.8;
    let armRz = P.armR.userData.restZ - 0.25 * sw * (1 - 0.6 * hold) - hopUp * 0.8 * (1 - 0.7 * hold) + HOLD_ARM_Z * hold;
    let twist = 0, slashLean = 0;
    if (this._swingT >= 0) {
      this._swingT += dt;
      const u = this._swingT / this._swingDur;
      if (u >= 1) { this._swingT = -1; }
      else {
        // keyframes: [arm pitch, arm sway, body twist, lean]; wind-up back over the shoulder, fast slash across, recover
        const K1 = this._swingKeys[0], K2 = this._swingKeys[1];
        const B = [armRx, armRz, 0, 0];
        let a, b, e;
        if (u < 0.28) { a = B; b = K1; e = 1 - Math.pow(1 - u / 0.28, 2); }
        else if (u < 0.6) { a = K1; b = K2; const k = (u - 0.28) / 0.32; e = k * k * (3 - 2 * k); e = Math.pow(e, 0.8); }
        else { a = K2; b = B; const k = (u - 0.6) / 0.4; e = k * k * (3 - 2 * k); }
        armRx = lerp(a[0], b[0], e); armRz = lerp(a[1], b[1], e);
        twist = lerp(a[2], b[2], e); slashLean = lerp(a[3], b[3], e);
      }
    }
    this._poseK = lerp(this._poseK, this._pose ? 1 : 0, damp(9, dt));
    if (this._poseK > 0.003 && this._poseLast) {       // steady pose (cooking): blend over whatever the arm was doing
      const K = this._poseLast, pk = this._poseK;
      armRx = lerp(armRx, K[0], pk); armRz = lerp(armRz, K[1], pk);
      twist = lerp(twist, K[2], pk); slashLean = lerp(slashLean, K[3], pk);
    }
    // Journal showcase: the find held high in the right hand (world/journalShowcase.js parks the model above it), left arm flung out
    this._showK = lerp(this._showK, this.showoff ? 1 : 0, damp(11, dt));
    const show = this._showK > 0.003 ? this._showK : 0;
    if (show) {
      armRx = lerp(armRx, -2.75, show); armRz = lerp(armRz, -0.42, show);
      twist = lerp(twist, 0.15, show); slashLean = lerp(slashLean, -0.12, show);
      P.armL.rotation.x = lerp(P.armL.rotation.x, -0.35, show); P.armL.rotation.z = lerp(P.armL.rotation.z, P.armL.userData.restZ + 1.25, show);
    }
    P.armR.rotation.x = armRx;
    P.armR.rotation.z = armRz;
    if (this.carrying) { P.armL.rotation.x = P.armR.rotation.x = -1.25; P.armL.rotation.z = .2; P.armR.rotation.z = -.2; }

    // Body bob (two bounces per cycle) + sway
    const bob = Math.abs(s) * 0.09 * sw;
    const breathe = Math.sin(t * 2.4) * 0.012 * (1 - sw);
    P.torso.position.y = bob + breathe * 0.5;
    P.torso.rotation.z = Math.cos(this._phase) * 0.06 * sw;
    P.torso.rotation.y = twist;
    P.headGroup.rotation.z = -Math.cos(this._phase) * 0.05 * sw + clamp(-this._turnRate * 0.012, -0.2, 0.2);
    P.headGroup.rotation.x = Math.sin(t * 1.3) * 0.015 * (1 - sw) - 0.2 * show;      // (the showcase looks up at the find)

    // Forward lean (about the feet)
    this._lean = lerp(this._lean, norm * 0.24, damp(9, dt));
    P.rig.rotation.x = this._lean + slashLean;

    // Squash & stretch about the feet (volume preserving-ish), plus breathing scale
    const sy = 1 + sq + breathe;
    const sxz = 1 - sq * 0.55 - breathe * 0.4;
    P.rig.scale.set(sxz, sy, sxz);
    P.rig.position.y = this._hopY;

    P.rig.position.x = P.rig.position.z = 0;
    P.rig.rotation.z = 0;
    if (this._hurtT >= 0) {
      this._hurtT += dt;
      const u = Math.min(1, this._hurtT / this._hurtDur), kick = Math.sin(Math.PI * u) * (1 - u * 0.35);
      const dir = this._hurtDirection, cy = Math.cos(this.facing), sy = Math.sin(this.facing);
      const side = dir.x * cy - dir.z * sy, forward = dir.x * sy + dir.z * cy;
      P.rig.position.x = side * 0.22 * kick; P.rig.position.z = forward * 0.22 * kick; P.rig.position.y += 0.07 * kick;
      P.rig.rotation.x += forward * 0.38 * kick; P.rig.rotation.z -= side * 0.32 * kick;
      P.rig.scale.x *= 1 + 0.08 * kick; P.rig.scale.z *= 1 + 0.08 * kick; P.rig.scale.y *= 1 - 0.16 * kick;
      P.armL.rotation.x = lerp(P.armL.rotation.x, -1.2, kick); P.armR.rotation.x = lerp(P.armR.rotation.x, -1.2, kick);
      P.headGroup.rotation.x -= 0.2 * kick;
      if (u >= 1) this._hurtT = -1;
    }

    // Step 55: downed = flattened into a low heap (the sprout itself is a scene object drawn by game/dungeon.js)
    this._downK = lerp(this._downK, this.downed ? 1 : 0, damp(10, dt));
    if (this._downK > 0.003) {
      const k = this._downK;
      P.rig.scale.y *= 1 - 0.55 * k; P.rig.scale.x *= 1 + 0.25 * k; P.rig.scale.z *= 1 + 0.25 * k;
      P.rig.rotation.x = lerp(P.rig.rotation.x, 0.5, k); P.rig.rotation.z = lerp(P.rig.rotation.z, 0.25, k);
      P.armL.rotation.x = lerp(P.armL.rotation.x, -0.2, k); P.armR.rotation.x = lerp(P.armR.rotation.x, -0.2, k);
    }

    // Sprout sway (if the current hat has one): drag opposite to motion + idle wobble
    const lag = this._sproutLag;
    const vx = this.velocity.x, vz = this.velocity.z;
    // Velocity in the character's local frame (z forward, x left)
    const cy = Math.cos(this.facing), sy2 = Math.sin(this.facing);
    const lz = vx * sy2 + vz * cy;
    const lx = vx * cy - vz * sy2;
    lag.x = lerp(lag.x, -lz * 0.05, damp(8, dt));
    lag.z = lerp(lag.z, lx * 0.05, damp(8, dt));
    const sprout = P.sprout;
    if (sprout) {
      sprout.rotation.x = lag.x + Math.sin(t * 2.6) * 0.06;
      sprout.rotation.z = lag.z + Math.sin(t * 2.1 + 1.0) * 0.09;
    }
    // Idle animation of the mounted hat (butterfly wings, kettle steam...; see player/hats.js). Local players and remote avatars both land here.
    const hat = P.hat;
    if (hat && hat.userData.update) hat.userData.update(dt, t);
    // Tail swish / wag (Step 36a): a group rotation driven by the movement speed (local players and remote avatars alike)
    const tail = this._tailModel;
    if (tail) tail.userData.update(dt, t, clamp(speed / PLAYER_SPEED, 0, 1));

    // Blinking (the eye vertices are squashed in the character's shader by one uniform)
    this._blinkTimer -= dt;
    if (this._blink < 0 && this._blinkTimer <= 0) { this._blink = 0; }
    if (this._blink >= 0) {
      this._blink += dt / 0.16;
      if (this._blink >= 1) {
        this._blink = -1;
        this._blinkTimer = 2 + Math.random() * 3.5;
        if (Math.random() < 0.2) this._blinkTimer = 0.25;   // occasional double blink
      }
    }
    const closed = this._blink < 0 ? 0 : Math.sin(this._blink * Math.PI);
    this.character.setBlink(closed);

    // Blob shadow: stays on the ground, tilts to the terrain, shrinks while airborne
    const blob = P.blob;
    let h = this._hopY;
    const probe = this.groundProbe ? this.groundProbe(this.position.x, this.position.z) : null;   // a storybook page: the floor is the tile under the feet
    if (probe !== null) h = Math.max(0, this.position.y - probe);
    const sc = clamp(1 - h * 0.35, 0.5, 1) * 1.0;
    blob.scale.set(sc, 1, sc);
    blob.material.opacity = clamp(1 - h * 0.5, 0.4, 1);
    if (this.groundProbe) {                                                               // (flat shadow on the tile, hidden over a pit)
      blob.visible = probe !== null;
      blob.quaternion.identity();
      blob.position.y = 0.06 - h;
      return;
    }
    blob.visible = true;
    const eps = 0.4;
    const px = this.position.x, pz = this.position.z;
    const nx = getHeight(px - eps, pz) - getHeight(px + eps, pz);
    const nz = getHeight(px, pz - eps) - getHeight(px, pz + eps);
    const n = this._tmpN.set(nx, 2 * eps, nz).normalize();
    // world normal -> root-local (root only has yaw)
    const cosY = Math.cos(this.facing), sinY = Math.sin(this.facing);
    n.set(n.x * cosY - n.z * sinY, n.y, n.x * sinY + n.z * cosY);
    blob.quaternion.setFromUnitVectors(this._up, n);
    // Sit on the smoothed root position but follow the raw ground height
    blob.position.y = 0.06 + (getHeight(px, pz) - this.position.y);
  }

  // ---------------------------------------------------------------------------------------------
  // Dust puffs
  // ---------------------------------------------------------------------------------------------

  _buildDust() {
    const tex = makePuffTexture();
    this._dustGroup = new THREE.Group();
    this._dustGroup.name = 'dust';
    for (let i = 0; i < DUST_POOL; i++) {
      const mat = new THREE.SpriteMaterial({ map: tex, color: '#fff4dc', transparent: true, depthWrite: false, opacity: 0 });
      const sp = new THREE.Sprite(mat);
      sp.visible = false;
      sp.renderOrder = 3;
      sp.userData = { life: 0, max: 0.5, vx: 0, vy: 0, vz: 0, size: 0.3 };
      this._dustGroup.add(sp);
      this._dust.push(sp);
    }
    this.scene.add(this._dustGroup);
  }

  _spawnDust(x, y, z, vx, vz) {
    for (const sp of this._dust) {
      if (sp.visible) continue;
      const d = sp.userData;
      d.life = 0;
      d.max = 0.4 + Math.random() * 0.2;
      d.vx = vx + (Math.random() - 0.5) * 0.6;
      d.vz = vz + (Math.random() - 0.5) * 0.6;
      d.vy = 0.5 + Math.random() * 0.4;
      d.size = 0.22 + Math.random() * 0.14;
      sp.position.set(x, y + 0.12, z);
      sp.visible = true;
      return;
    }
  }

  _updateDust(dt) {
    // Emit while running (alternating feet), just behind the player
    if (this.speed > 4.2 && this.grounded) {
      this._dustTimer -= dt;
      if (this._dustTimer <= 0) {
        this._dustTimer = 0.11;
        this._dustSide = -this._dustSide;
        const fx = Math.sin(this.facing), fz = Math.cos(this.facing);
        const rx = fz, rz = -fx;                       // character's right
        const off = 0.14 * this._dustSide;
        const bx = this.position.x - fx * 0.28 + rx * off;
        const bz = this.position.z - fz * 0.28 + rz * off;
        this._spawnDust(bx, this.groundProbe ? this.position.y : getHeight(bx, bz), bz, -this.velocity.x * 0.08, -this.velocity.z * 0.08);
      }
    } else {
      this._dustTimer = 0;
    }
    for (const sp of this._dust) {
      if (!sp.visible) continue;
      const d = sp.userData;
      d.life += dt;
      const u = d.life / d.max;
      if (u >= 1) { sp.visible = false; sp.material.opacity = 0; continue; }
      sp.position.x += d.vx * dt;
      sp.position.z += d.vz * dt;
      sp.position.y += d.vy * dt;
      d.vy *= Math.exp(-2 * dt);
      const sz = d.size * (0.6 + u * 1.5);
      sp.scale.set(sz, sz, 1);
      sp.material.opacity = 0.75 * (1 - u) * (1 - u * 0.3);
    }
  }
}
