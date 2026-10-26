// Walk-over ground pickups (PLAN Step 13): small pooled 3D items (log, apple, peach, coconut, berries, herb, potato, mushroom, and Frostpine's pinecone, lingonberry, mint, chanterelle, crystal, snow-truffle) that pop out
// of trees / bushes / dig spots with a little arc + bounce, then bob and spin on the ground until any player walks within
// MAGNET_RADIUS. They fly to that player over ~0.2 s and go into the shared inventory (pop sound, floating "+1 Apple" text).
//
//   const pickups = createPickups({ scene, players, particles, sfx, sync, floatText, max: 40 });
//     floatText(id, n, worldPos, player) // injected by main.js: the floating "+1 Apple" text (the bag itself is changed by the authority, see below)
//   pickups.spawn('apple', { x, y, z }, { velocity: { x, y, z } })   // pop out (default: a random little arc); returns the pickup or null
//   pickups.spawnTo('log', from, { x, z })                          // pop out on an arc that lands (about) at the target spot
//   pickups.update(dt)                                              // once per tick AFTER players.update
//   pickups.count / pickups.list / pickups.clear() / pickups.vacuum(player)   // (debug) vacuum = fly everything to that player right now
//   pickups.has(id)                                                 // is there a 3D model for this item id?
//
// Rules: a pickup is not collectable during its first COLLECT_DELAY seconds (the pop-out); at most `max` (~40) lie around at once, and when
// a new one would exceed the cap the OLDEST one is auto-collected into the inventory (nothing is ever lost). Pickups are pooled per item
// type (one merged vertex-coloured mesh + outline each), so a spawn allocates nothing after the first of its kind.
//
// World sync (Step 22, domain 'pickups'; see net/worldSync.js). Every pickup has a host-generated id `pid`.
//   HOST: spawn() decides all the randomness (pop velocity, spin, phase, yaw), creates the pickup and emits `spawn {pid,id,x,y,z,vx,vy,vz,spin,phase,yaw}`.
//         A local player's magnet runs as before; its finish calls the authority path request('pickups','collect',{pid}) which checks the pickup is
//         still there, removes it, does inventory.add (-> 'inventory' set event) and emits `collected {pid, actor}`. First valid collect wins.
//   REPLICA: applies `spawn` (same pop animation), detects the magnet overlap for ITS local players only and sends `collect {pid}` (with the
//         actor's position; the host range-checks it). The pickup flies to the player, then waits for `collected`: if the actor is one of our
//         players we play the collect FX + "+1" text, otherwise it just vanishes. A reject 'gone' removes it; any other reject lets it drop back.
//   spawn() called on a replica (by a system that is not converted yet: fruit, logs, berries, potatoes) is SUPPRESSED (returns null): loot is host-authored.
//   The pop / bounce is simulated on every screen, so a copy could come to rest in a different spot. The HOST's resting position is authoritative: when a pickup
//   comes to rest on the host (and replicas are connected) it emits `rest {pid,x,y,z}`; a replica eases its copy (already resting) or lets it land first (still
//   bouncing) and then eases it to that spot, so the copy a replica's player walks over is where the host's range check expects it. The snapshot marks resting
//   pickups (`rest: true`): a joining screen places them there directly.
//   A refused collect (the host says 'far', 'timeout', ...) puts the pickup back on the ground and BACKS OFF that pid for ~1 s (doubling per refusal, max 8 s, wall clock)
//   so a refusal can never turn into a request storm; the magnet only re-fires while the player still overlaps it.
//   Snapshot = [{pid,id,x,y,z,rest}] (in-flight ones restart their fall); hashView = [[pid,id]] (positions depend on physics, not authority).
// Adding a new ground item: add a builder to MODELS below (origin at the base, roughly 0.3 - 0.5u across) and a catalog.js entry.
import * as THREE from 'three';
import { fruitGeometry } from './islands/emberAssets.js';
import { getHeight, isWalkable } from './terrain.js';
import { G, VERTEX_TOON, part, combine, makeOutline, restOnGround, smoothOutlineGeo } from '../render/geo.js';

const GRAVITY = 22;
const MAGNET_RADIUS = 1.3;
const MAGNET_TIME = 0.22;
const COLLECT_DELAY = 0.4;
const SPAWN_SCALE_TIME = 0.14;
const SIZE_K = 1.3;             // pickups are drawn a bit bigger than life: the fixed camera is ~15u away
const HOVER = 0.1;              // resting height above the ground (bobs around it)
const TAU = Math.PI * 2;
const rnd = (a, b) => a + Math.random() * (b - a);

// ---------------------------------------------------------------------------------------------
// Models: origin at the base, each ONE merged vertex-coloured geometry (+ smoothed outline hull)
// ---------------------------------------------------------------------------------------------
const HALF_PI = Math.PI / 2;
/** One lying log (plain, pine, birch share it): bark colours, end-grain colours, and an optional `decorate(parts)` for the tuft / marks. */
function logModel(bark, bark2, ring, ring2, decorate = null) {
  const L = 0.62, R = 0.16;
  const parts = [
    part(new THREE.CylinderGeometry(R, R * 1.04, L, 10, 1, true), bark, { r: [0, 0, HALF_PI] }),
    part(new THREE.CylinderGeometry(R * 0.7, R * 0.72, L * 0.98, 8, 1, true), bark2, { r: [0, 0, HALF_PI], p: [0, R * 0.42, 0] }),
  ];
  for (const sgn of [-1, 1]) {
    parts.push(part(new THREE.CircleGeometry(R * 0.98, 10), ring, { p: [sgn * (L / 2 + 0.004), 0, 0], r: [0, sgn * HALF_PI, 0] }));
    parts.push(part(new THREE.RingGeometry(R * 0.28, R * 0.5, 10), ring2, { p: [sgn * (L / 2 + 0.012), 0, 0], r: [0, sgn * HALF_PI, 0] }));
  }
  parts.push(part(G.ico1, bark, { p: [-0.12, R * 0.9, 0.05], r: [0.5, 0, 0.3], s: [0.05, 0.09, 0.05] }));   // knot
  if (decorate) decorate(parts);
  return { geo: combine(parts), scale: 1.05 };
}
const MODELS = {
  ...Object.fromEntries(['banana', 'breadfruit', 'bamboo', 'pineapple', 'taro', 'obsidian'].map((id) => [id, () => ({ geo: fruitGeometry(id), scale: 1.3 })])),
  // ---- Emberleaf's garden tending items (Step 38b): a little heap of grey ash with an ember, a coconut shell holding a drop of spring water, a lump of dark mulch with a leaf
  ash: () => ({
    geo: combine([
      part(G.ico1, '#8f8a9c', { p: [0, 0.1, 0], s: [0.26, 0.12, 0.24] }),
      part(G.ico1, '#aaa5b8', { p: [-0.08, 0.17, 0.04], s: [0.14, 0.09, 0.13] }),
      part(G.ico1, '#756f84', { p: [0.12, 0.13, -0.06], s: [0.1, 0.07, 0.1] }),
      part(G.ico1, '#ff8a4a', { p: [0.04, 0.2, 0.1], s: [0.045, 0.04, 0.045] }),
    ]), scale: 1.2,
  }),
  'spring-water': () => ({
    geo: combine([
      part(G.sphere, '#8a5a36', { p: [0, 0.2, 0], s: [0.24, 0.2, 0.24] }),
      part(G.sphereLo, '#c98a54', { p: [0, 0.37, 0], s: [0.17, 0.045, 0.17] }),
      part(G.sphere, '#7fd3ff', { p: [0, 0.4, 0], s: [0.1, 0.1, 0.1] }),
      part(G.sphereLo, '#e8fbff', { p: [-0.03, 0.44, 0.03], s: [0.03, 0.03, 0.03] }),
    ]), scale: 1.2,
  }),
  mulch: () => ({
    geo: combine([
      part(G.ico1, '#6b4a2e', { p: [0, 0.12, 0], s: [0.27, 0.15, 0.25] }),
      part(G.ico1, '#85603a', { p: [-0.1, 0.2, 0.04], s: [0.13, 0.09, 0.12] }),
      part(G.ico1, '#4f351f', { p: [0.12, 0.15, -0.07], s: [0.11, 0.08, 0.1] }),
      part(G.sphereLo, '#6cc85a', { p: [0.06, 0.28, 0.04], r: [0.3, 0.4, -0.5], s: [0.11, 0.03, 0.06] }),
    ]), scale: 1.2,
  }),
  // ---- Duskcrown (Step 72b): the two fish lie on their side (they only appear on the ground if something drops them; a catch goes straight into the bag), and a little heap of glowcap crumbs
  glimmerfin: () => ({
    geo: combine([
      part(G.sphere, '#8a67e0', { p: [0, 0.12, 0], s: [0.26, 0.12, 0.18] }),
      part(G.sphereLo, '#c1a8ff', { p: [-0.02, 0.07, 0.07], s: [0.2, 0.06, 0.1] }),
      part(G.sphereLo, '#b9a3ff', { p: [0.3, 0.12, 0], r: [0, 0, 0.1], s: [0.12, 0.05, 0.1] }),
      part(G.sphereLo, '#7ff0ff', { p: [-0.02, 0.22, 0.02], s: [0.032, 0.02, 0.032] }),
      part(G.sphereLo, '#7ff0ff', { p: [0.08, 0.2, -0.03], s: [0.028, 0.02, 0.028] }),
      part(G.sphereLo, '#ffffff', { p: [-0.2, 0.18, 0.07], s: [0.04, 0.035, 0.04] }),
    ]), scale: 1.2,
  }),
  lanternkoi: () => ({
    geo: combine([
      part(G.sphere, '#3b3f9c', { p: [0, 0.1, 0], s: [0.46, 0.1, 0.12] }),
      part(G.sphereLo, '#6e74d8', { p: [-0.02, 0.06, 0.05], s: [0.38, 0.05, 0.08] }),
      part(G.sphereLo, '#9ba6ff', { p: [0.52, 0.1, 0], r: [0, 0, 0.05], s: [0.2, 0.04, 0.16] }),
      part(G.sphereLo, '#ffb347', { p: [-0.2, 0.19, 0.02], s: [0.06, 0.025, 0.05] }),
      part(G.sphereLo, '#ff9a3c', { p: [0.02, 0.2, 0.02], s: [0.06, 0.025, 0.05] }),
      part(G.sphereLo, '#ffc861', { p: [0.24, 0.19, 0.02], s: [0.05, 0.025, 0.04] }),
      part(G.sphereLo, '#ffffff', { p: [-0.4, 0.15, 0.06], s: [0.035, 0.03, 0.035] }),
    ]), scale: 0.85,
  }),
  'glowcap-crumbs': () => ({
    geo: combine([
      part(G.ico1, '#d9c4f0', { p: [0, 0.07, 0], s: [0.2, 0.08, 0.18] }),
      part(G.sphere, '#a64be8', { p: [-0.03, 0.18, 0.02], s: [0.17, 0.09, 0.16] }),
      part(G.sphere, '#b86df0', { p: [0.14, 0.12, -0.05], s: [0.1, 0.06, 0.1] }),
      part(G.sphereLo, '#7ff0ff', { p: [-0.06, 0.25, 0.06], s: [0.03, 0.02, 0.03] }),
      part(G.sphereLo, '#e9c6ff', { p: [0.04, 0.24, -0.02], s: [0.028, 0.02, 0.028] }),
    ]), scale: 1.2,
  }),
  log: () => logModel('#a8703f', '#c48a55', '#f2cf96', '#c98d5a'),
  'breadfruit-log': () => logModel('#967443', '#b58d53', '#f5dcaa', '#ba925b', (parts) => {
    parts.push(part(G.sphereLo, '#6ead46', { p: [0.05, 0.2, 0], r: [0.1, 0.4, -0.5], s: [0.16, 0.035, 0.1] }));
  }),
  // ---- Frostpine's logs (Step 35a): a darker resinous pine log with a needle tuft, a white birch log with dark papery marks
  'pine-log': () => logModel('#6b4a2e', '#85603a', '#e8c27a', '#b98a4a', (parts) => {
    parts.push(part(G.cone6, '#3f9150', { p: [0.04, 0.2, 0.0], r: [0, 0, -0.9], s: [0.03, 0.12, 0.03] }));
    parts.push(part(G.cone6, '#58b567', { p: [0.08, 0.19, 0.04], r: [0.5, 0, -1.2], s: [0.03, 0.11, 0.03] }));
    parts.push(part(G.cone6, '#2f7a45', { p: [0.0, 0.2, -0.04], r: [-0.5, 0, -0.7], s: [0.03, 0.1, 0.03] }));
  }),
  'birch-log': () => logModel('#ece6d8', '#fbf6ea', '#f2dcae', '#c9a46a', (parts) => {
    for (const [x, a, z] of [[-0.18, 0.4, 0.15], [0.04, -0.3, -0.15], [0.2, 0.2, 0.12]]) parts.push(part(G.ico1, '#3a3340', { p: [x, 0.02, z], r: [0, a, 0], s: [0.07, 0.012, 0.025] }));
    parts.push(part(G.ico1, '#3a3340', { p: [-0.05, 0.16, 0.04], s: [0.06, 0.012, 0.022] }));
  }),

  stone() {
    const parts = [
      part(G.ico1, '#a9a5c4', { p: [-0.07, 0.15, 0.02], r: [0.3, 0.5, 0.1], s: [0.2, 0.15, 0.18] }),
      part(G.ico1, '#c9c5df', { p: [0.14, 0.12, 0.06], r: [0.1, 1.1, 0.4], s: [0.14, 0.11, 0.13] }),
      part(G.ico1, '#8f8bb0', { p: [0.0, 0.1, -0.15], r: [0.5, 0.2, 0.2], s: [0.12, 0.1, 0.11] }),
      part(G.sphereLo, '#e8e5f5', { p: [-0.1, 0.25, 0.08], s: [0.05, 0.03, 0.04] }),
    ];
    return { geo: combine(parts), scale: 1.2 };
  },

  apple() {
    const parts = [
      part(G.sphere, '#ff4d5e', { p: [0, 0.2, 0], s: [0.23, 0.2, 0.23] }),
      part(G.sphereLo, '#ff8a94', { p: [-0.09, 0.27, 0.12], s: [0.05, 0.06, 0.03] }),
      part(G.cyl6, '#7a4a2a', { p: [0, 0.42, 0], s: [0.018, 0.09, 0.018] }),
      part(G.sphereLo, '#4fbf5f', { p: [0.07, 0.43, 0], r: [0, 0, -0.4], s: [0.09, 0.028, 0.055] }),
    ];
    return { geo: combine(parts), scale: 1.15 };
  },

  peach() {
    const parts = [
      part(G.sphere, '#ffb08a', { p: [0, 0.21, 0], s: [0.23, 0.21, 0.23] }),
      part(G.sphere, '#ff8f8f', { p: [0.06, 0.2, 0.06], s: [0.17, 0.17, 0.17] }),
      part(G.sphereLo, '#ffd3b8', { p: [-0.08, 0.29, 0.1], s: [0.05, 0.06, 0.03] }),
      part(G.cyl6, '#7a4a2a', { p: [0, 0.42, 0], s: [0.016, 0.07, 0.016] }),
      part(G.sphereLo, '#5fc25a', { p: [-0.07, 0.42, 0], r: [0, 0, 0.4], s: [0.09, 0.028, 0.055] }),
    ];
    return { geo: combine(parts), scale: 1.15 };
  },

  coconut() {
    const parts = [part(G.sphere, '#7a4a2a', { p: [0, 0.25, 0], s: [0.25, 0.25, 0.25] }),
      part(G.sphereLo, '#a06d44', { p: [-0.09, 0.32, 0.14], s: [0.07, 0.09, 0.04] })];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU + 0.5;
      parts.push(part(G.sphereLo, '#3d2413', { p: [Math.cos(a) * 0.09, 0.47, Math.sin(a) * 0.09], s: [0.045, 0.03, 0.045] }));
    }
    return { geo: combine(parts), scale: 1.1 };
  },

  berry() {
    const cols = ['#ff4d6d', '#ff4d6d', '#ff7a8f'];
    const parts = [];
    [[0, 0.11, 0.09], [-0.09, 0.11, -0.05], [0.09, 0.11, -0.05], [0, 0.24, 0]].forEach((p, i) => {
      parts.push(part(G.sphere, cols[i % 3], { p, s: [0.105, 0.105, 0.105] }));
      parts.push(part(G.sphereLo, '#ffffff', { p: [p[0] - 0.035, p[1] + 0.045, p[2] + 0.07], s: [0.022, 0.022, 0.014] }));
    });
    parts.push(part(G.sphereLo, '#4fbf5f', { p: [0.03, 0.34, 0], r: [0, 0.6, -0.3], s: [0.1, 0.028, 0.06] }));
    parts.push(part(G.sphereLo, '#4fbf5f', { p: [-0.04, 0.33, 0.03], r: [0, -0.5, 0.35], s: [0.09, 0.026, 0.05] }));
    return { geo: combine(parts), scale: 1.2 };
  },

  herb() {
    const parts = [part(G.cyl6, '#2a9e7a', { p: [0, 0.17, 0], s: [0.028, 0.34, 0.028] })];
    const tiers = [[5, 0.17, 0.1, 0.5, '#2fc99a'], [4, 0.28, 0.07, 0.75, '#4fdcae'], [2, 0.38, 0.03, 1.1, '#79edc4']];
    tiers.forEach(([n, y, rad, tilt, col], ti) => {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + ti * 0.6;
        parts.push(part(G.sphereLo, col, {
          p: [Math.cos(a) * rad, y, Math.sin(a) * rad], r: [0, -a, tilt], s: [0.11, 0.03, 0.075],
        }));
      }
    });
    return { geo: combine(parts), scale: 1.25 };
  },

  potato() {
    const parts = [
      part(G.sphere, '#d9a86e', { p: [0, 0.19, 0], s: [0.27, 0.19, 0.21] }),
      part(G.sphere, '#d9a86e', { p: [0.13, 0.17, 0.03], s: [0.15, 0.14, 0.15] }),
      part(G.sphereLo, '#f2cf96', { p: [-0.1, 0.29, 0.08], s: [0.07, 0.04, 0.04] }),
    ];
    [[-0.08, 0.3, -0.09], [0.1, 0.27, 0.11], [0.02, 0.15, 0.2], [0.18, 0.2, -0.08]].forEach((p) => {
      parts.push(part(G.sphereLo, '#a8743f', { p, s: [0.035, 0.03, 0.035] }));
    });
    return { geo: combine(parts), scale: 1.15 };
  },

  mushroom() {
    const cap = new THREE.SphereGeometry(1, 12, 8, 0, TAU, 0, HALF_PI);
    const parts = [
      part(G.cyl8, '#fff1d6', { p: [0, 0.09, 0], s: [0.065, 0.18, 0.065] }),
      part(cap, '#ff5560', { p: [0, 0.16, 0], s: [0.22, 0.17, 0.22] }),
      part(G.sphereLo, '#ffffff', { p: [-0.08, 0.28, 0.08], s: [0.04, 0.025, 0.04] }),
      part(G.sphereLo, '#ffffff', { p: [0.1, 0.25, 0.02], s: [0.035, 0.022, 0.035] }),
      part(G.sphereLo, '#ffffff', { p: [0, 0.32, -0.06], s: [0.035, 0.022, 0.035] }),
    ];
    cap.dispose();
    return { geo: combine(parts), scale: 1.4 };
  },
  // ---- Frostpine finds (Step 29b)
  pinecone() {
    const parts = [part(G.sphere, '#7a4a2a', { p: [0, 0.2, 0], s: [0.14, 0.21, 0.14] })];
    for (let l = 0; l < 4; l++) {                                   // rings of overlapping scales, wide at the bottom
      const y = 0.09 + l * 0.095, rad = 0.13 - l * 0.026, n = 6 - (l > 1 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + l * 0.5;
        parts.push(part(G.sphereLo, (i + l) % 2 ? '#a8703f' : '#c48a55', { p: [Math.cos(a) * rad, y, Math.sin(a) * rad], r: [0, -a, -0.45], s: [0.085, 0.05, 0.065] }));
      }
    }
    parts.push(part(G.cone6, '#8a5a34', { p: [0, 0.46, 0], s: [0.07, 0.1, 0.07] }));
    parts.push(part(G.sphereLo, '#3f9150', { p: [0.06, 0.5, 0], r: [0, 0, -0.5], s: [0.09, 0.022, 0.035] }));
    parts.push(part(G.sphereLo, '#58b567', { p: [-0.05, 0.5, 0.02], r: [0, 0.4, 0.5], s: [0.08, 0.02, 0.03] }));
    return { geo: combine(parts), scale: 1.2 };
  },

  lingonberry() {
    const parts = [
      part(G.sphereLo, '#3f9150', { p: [0.1, 0.03, 0.02], r: [0, 0.5, 0.15], s: [0.13, 0.03, 0.07] }),
      part(G.sphereLo, '#58b567', { p: [-0.1, 0.03, -0.03], r: [0, -0.7, -0.15], s: [0.12, 0.03, 0.065] }),
    ];
    [[0, 0.1, 0.07], [-0.08, 0.1, -0.05], [0.08, 0.1, -0.04], [-0.02, 0.2, 0], [0.07, 0.19, 0.06]].forEach((p, i) => {
      parts.push(part(G.sphere, i % 2 ? '#ee3b52' : '#d81e3c', { p, s: [0.075, 0.075, 0.075] }));
      parts.push(part(G.sphereLo, '#ffffff', { p: [p[0] - 0.025, p[1] + 0.035, p[2] + 0.05], s: [0.016, 0.016, 0.01] }));
    });
    parts.push(part(G.sphereLo, '#3f9150', { p: [0.0, 0.29, 0.0], r: [0, 0.6, -0.3], s: [0.08, 0.022, 0.045] }));
    return { geo: combine(parts), scale: 1.3 };
  },

  mint() {
    const parts = [part(G.cyl6, '#25b58a', { p: [0, 0.2, 0], s: [0.024, 0.4, 0.024] })];
    [[0.13, 0.11, '#4fe8b4'], [0.2, 0.09, '#5ff2b8'], [0.28, 0.07, '#7bf7cc'], [0.35, 0.05, '#7bf7cc']].forEach(([y, len, col], ti) => {
      for (const sg of [-1, 1]) {                                  // leaves in opposite pairs up the stem, each pair turned a bit
        const a = ti * 1.0 + (sg < 0 ? Math.PI : 0);
        parts.push(part(G.sphereLo, col, { p: [Math.cos(a) * len * 0.8, y, Math.sin(a) * len * 0.8], r: [0, -a, 0.55], s: [len * 1.15, 0.026, len * 0.66] }));
      }
    });
    parts.push(part(G.cone6, '#a4ffe0', { p: [0, 0.44, 0], s: [0.04, 0.1, 0.04] }));
    return { geo: combine(parts), scale: 1.3 };
  },

  chanterelle() {
    const parts = [];
    [[0, 0, 1], [0.2, 0.06, 0.62], [-0.15, -0.12, 0.5]].forEach(([x, z, k]) => {   // a trio of trumpets: stalk, flared cap, a dimple in the middle
      parts.push(part(G.cyl8, '#ffd98a', { p: [x, 0.07 * k + 0.02, z], s: [0.06 * k, 0.15 * k, 0.06 * k] }));
      parts.push(part(G.cone6, '#f2a228', { p: [x, 0.19 * k + 0.02, z], r: [Math.PI, 0, 0], s: [0.2 * k, 0.15 * k, 0.2 * k] }));
      parts.push(part(G.sphereLo, '#c97a14', { p: [x, 0.265 * k + 0.02, z], s: [0.09 * k, 0.025 * k, 0.09 * k] }));
      parts.push(part(G.sphereLo, '#ffd98a', { p: [x - 0.07 * k, 0.255 * k + 0.02, z + 0.07 * k], s: [0.04 * k, 0.018 * k, 0.03 * k] }));
    });
    return { geo: combine(parts), scale: 1.35 };
  },

  crystal() {
    const oct = new THREE.OctahedronGeometry(1, 0);                // flat facets: a cut gem
    const parts = [
      part(oct, '#b9d8ff', { p: [0, 0.29, 0], s: [0.15, 0.29, 0.15] }),
      part(oct, '#cdbbff', { p: [0.13, 0.17, 0.05], r: [0, 0.6, -0.5], s: [0.08, 0.17, 0.08] }),
      part(oct, '#8fb4ff', { p: [-0.12, 0.14, -0.04], r: [0.3, 0.2, 0.5], s: [0.07, 0.14, 0.07] }),
      part(oct, '#e6f3ff', { p: [0, 0.4, 0], s: [0.06, 0.1, 0.06] }),
    ];
    oct.dispose();
    return { geo: combine(parts), scale: 1.3 };
  },

  'snow-truffle'() {
    const parts = [part(G.ico1, '#bfae8f', { p: [0, 0.16, 0], s: [0.24, 0.17, 0.21] })];
    [[0.2, 0.12, 0.04], [-0.17, 0.1, 0.1], [0.05, 0.1, -0.2], [-0.06, 0.1, 0.2], [0.14, 0.1, 0.16]].forEach((p, i) => {
      parts.push(part(G.ico1, i % 2 ? '#a89677' : '#cdbd9f', { p, s: [0.085, 0.07, 0.085] }));
    });
    parts.push(part(G.ico1, '#f4f8ff', { p: [0, 0.27, 0], s: [0.19, 0.075, 0.17] }));          // the snow dusting on top
    parts.push(part(G.ico1, '#ffffff', { p: [0.12, 0.2, 0.1], s: [0.06, 0.04, 0.06] }));
    parts.push(part(G.ico1, '#dff0ff', { p: [-0.1, 0.22, -0.08], s: [0.05, 0.035, 0.05] }));
    return { geo: combine(parts), scale: 1.2 };
  },
};

// Step 74b: Carle's caterpillar munches the item's pickup model (apple, peach, banana, ...). A NEW mesh of the shared VERTEX_TOON material each call (the caller scales / disposes it: dispose the geometry
// and the outline's); null for an item without a ground model (dishes: the caller draws its own stand-in). Origin at the base, already scaled to the pickup's size.
export function createFoodModel(id) {
  const build = MODELS[id];
  if (!build) return null;
  const m = build();
  restOnGround(m.geo);
  const mesh = new THREE.Mesh(m.geo, VERTEX_TOON);
  mesh.add(makeOutline(m.geo, 0.028, smoothOutlineGeo(m.geo)));
  mesh.scale.setScalar(m.scale || 1);
  return mesh;
}

const COLLECT_RANGE = MAGNET_RADIUS + 3;      // the host accepts a remote collect from this far (latency + the actor moved on)
const BACKOFF_MS = 1000;                     // replica: wall-clock wait before a refused pickup may be requested again (doubles per refusal, max 8 s)
const AWAIT_TIMEOUT = 2.5;                    // s a replica's pickup waits for the host's verdict before dropping back

// A visitor holds the same rare-item model used by a ground pickup. The caller
// owns these geometries; the material remains shared with ordinary pickups.
export function createGiftModel(id) {
  if (id !== 'crystal' && id !== 'obsidian') return null;
  const m = MODELS[id]();
  restOnGround(m.geo);
  const mesh = new THREE.Mesh(m.geo, VERTEX_TOON);
  mesh.add(makeOutline(m.geo, 0.028, smoothOutlineGeo(m.geo)));
  mesh.scale.setScalar(0.9);
  return mesh;
}

export function createPickups({ scene, players, particles = null, sfx = null, sync, floatText = null, max = 40 }) {
  const snd = (name, opts) => { if (sfx) sfx.play(name, opts); };
  const root = new THREE.Group();
  root.name = 'pickups';
  scene.add(root);

  const models = {};                         // id -> { geo, outlineGeo, scale }
  const free = {};                           // id -> pooled (hidden) pickups
  const active = [];                         // spawn order (oldest first)
  let time = 0, seq = 0, nextPid = 0;
  const byPid = new Map();                   // pid -> pickup (authoritative set on the host, mirror on a replica)
  let combo = 0, comboT = 0;                 // rapid pickups climb in pitch
  let warned = false;

  function modelFor(id) {
    if (models[id]) return models[id];
    const build = MODELS[id];
    if (!build) return null;
    const m = build();
    restOnGround(m.geo);
    m.outlineGeo = smoothOutlineGeo(m.geo);
    models[id] = m;
    return m;
  }

  function take(id) {
    const m = modelFor(id);
    if (!m) return null;
    const pool = (free[id] ||= []);
    let p = pool.pop();
    if (!p) {
      const rootG = new THREE.Group();                        // position (world)
      const tilt = new THREE.Group();                         // spin about Y, squash
      const mesh = new THREE.Mesh(m.geo, VERTEX_TOON);
      mesh.castShadow = false; mesh.receiveShadow = false;    // tiny: skip the shadow pass
      mesh.add(makeOutline(m.geo, 0.028, m.outlineGeo));
      mesh.scale.setScalar(m.scale * SIZE_K);
      tilt.add(mesh);
      rootG.add(tilt);
      root.add(rootG);
      p = { id, root: rootG, tilt, mesh };
    }
    p.root.visible = true;
    return p;
  }

  function release(p) {
    p.root.visible = false;
    byPid.delete(p.pid);
    const i = active.indexOf(p);
    if (i >= 0) active.splice(i, 1);
    (free[p.id] ||= []).push(p);
  }

  const nearestPlayer = (x, z) => {
    let best = null, bd = Infinity;
    for (const pl of players.list) {
      const d = Math.hypot(pl.position.x - x, pl.position.z - z);
      if (d < bd) { bd = d; best = pl; }
    }
    return best;
  };

  /** The local player (this screen) an actor stands for, or null (another screen's player / nobody). */
  const localPlayerOf = (actor) => (actor && actor.screen === sync.screenId ? players.get(actor.index) : null);
  const actorOf = (player) => (player ? sync.actorFor(player) : null);

  /** Visual + audio + floating text of a pickup that was collected by one of OUR players (or by nobody in particular). */
  function collectFx(p, player) {
    const at = { x: p.x, y: p.y + 0.5, z: p.z };
    release(p);
    if (comboT <= 0) combo = 0;
    comboT = 0.6;
    snd('collect', { pitch: 1 + Math.min(combo, 6) * 0.07 });
    combo++;
    if (particles) particles.burst('sparkle', at, { count: 2, radius: 0.18, speed: 0.5, size: 0.7 });
    if (floatText) floatText(p.id, 1, at, player || null);
  }

  /** The host decided `pid` was collected by `actor`: show it on this screen. */
  function applyCollected(pid, actor) {
    const p = byPid.get(pid);
    if (!p) return;
    const mine = localPlayerOf(actor);
    if (mine || (!actor && sync.isHost)) collectFx(p, mine);
    else release(p);                                           // somebody else's: it just disappears (their avatar is Step 24)
  }

  /** HOST: a local player's magnet finished (or the cap auto-collects the oldest): run the authority path. */
  function hostCollect(p, player) {
    const r = sync.request('pickups', 'collect', { pid: p.pid }, actorOf(player));
    if (!r.ok && byPid.get(p.pid) === p) release(p);            // (defensive) already gone: nothing more to show
  }

  /** REPLICA: ask the host for a pickup; the verdict comes back as a `collected` event (or a reject). */
  function claim(p, player) {
    if (p.asked) return;
    p.asked = true;
    sync.request('pickups', 'collect', { pid: p.pid }, actorOf(player)).then((r) => {
      if (r.ok || byPid.get(p.pid) !== p) return;
      if (r.reason === 'gone') { release(p); return; }
      p.asked = false;                                          // refused (too far / timeout / offline): drop back to the ground and back off
      p.refusals = (p.refusals || 0) + 1;
      p.backoffUntil = nowMs() + Math.min(8000, BACKOFF_MS * 2 ** (p.refusals - 1));
      if (p.state === 'magnet' || p.state === 'await') dropBack(p);
    });
  }

  /** Replica: a claim failed / timed out: the pickup goes back to lying on the ground (at the host's resting spot when it is known). */
  function dropBack(p) {
    p.asked = false;
    p.vx = p.vy = p.vz = 0; p.bounces = 0; p.scale = 1; p.age = 0;
    if (p.hostRest) { p.state = 'rest'; p.restT = 0; } else p.state = 'fly';
  }
  const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  // ------------------------------------------------------------------ spawning
  /** Build the visual pickup for authoritative params (host and replicas alike). `age` > 0 = already collectable (snapshot). */
  function create(pr) {
    const p = take(pr.id);
    if (!p) return null;
    Object.assign(p, {
      pid: pr.pid, state: 'fly', age: pr.age || 0, seq: seq++, bounces: 0, phase: pr.phase, spin: pr.spin, asked: false,
      hostRest: null, backoffUntil: 0, refusals: 0,
      x: pr.x, y: pr.y, z: pr.z, vx: pr.vx, vy: pr.vy, vz: pr.vz,
      home: { x: pr.x, z: pr.z },
      sq: 0, sqv: 0, scale: pr.age ? 1 : 0.3, target: null, mt: 0, sx: 0, sy: 0, sz: 0, restT: 0,
    });
    p.tilt.rotation.set(0, pr.yaw, 0);
    p.root.position.set(p.x, p.y, p.z);
    p.root.scale.setScalar(p.scale);
    active.push(p);
    byPid.set(p.pid, p);
    return p;
  }

  const r3 = (v) => Math.round(v * 1000) / 1000;

  function spawn(id, position, { velocity = null, speed = 1 } = {}) {
    if (!MODELS[id]) return null;
    if (sync.isReplica) {       // loot comes from the host (systems that are not converted yet have no authority here)
      if (!warned) { warned = true; console.info('[pickups] replica: local pickup spawns are ignored (the host owns loot)'); }
      return null;
    }
    // over the cap: the oldest resting / flying pickup is auto-collected (never lost)
    while (active.length >= max) {
      const old = active.find((q) => q.state !== 'magnet') || active[0];
      hostCollect(old, nearestPlayer(old.x, old.z));
      if (byPid.has(old.pid)) release(old);                     // (defensive: never loop forever)
    }
    const a = Math.random() * TAU;
    const sp = rnd(1.4, 2.8) * speed;
    const pr = {
      pid: ++nextPid, id,
      x: r3(position.x), y: r3(position.y), z: r3(position.z),
      vx: r3(velocity ? velocity.x : Math.cos(a) * sp), vy: r3(velocity ? velocity.y : rnd(5.0, 6.6)), vz: r3(velocity ? velocity.z : Math.sin(a) * sp),
      phase: r3(Math.random() * TAU), spin: r3(rnd(-7, 7) * (0.6 + speed * 0.4)), yaw: r3(Math.random() * TAU),
    };
    const p = create(pr);
    if (p && sync.hasReplicas) sync.emit('pickups', 'spawn', pr);
    return p;
  }

  /** Pop `id` out of `from` on a ballistic arc that lands at (about) `to` ({x, z}). */
  function spawnTo(id, from, to, opts = {}) {
    const y1 = getHeight(to.x, to.z) + HOVER;
    const vy = 6.4;
    const t = (vy + Math.sqrt(vy * vy + 2 * GRAVITY * Math.max(0, from.y - y1))) / GRAVITY;
    return spawn(id, from, { ...opts, velocity: { x: (to.x - from.x) / t, y: vy, z: (to.z - from.z) / t } });
  }

  // ------------------------------------------------------------------ per-frame
  function settle(p) {
    // came to rest somewhere nobody can walk (deep water / a cliff face): slide it back toward where it came from
    for (let i = 0; i < 10 && !isWalkable(p.x, p.z); i++) {
      p.x += (p.home.x - p.x) * 0.35;
      p.z += (p.home.z - p.z) * 0.35;
    }
  }

  function update(dt) {
    dt = Math.min(dt, 0.1);
    time += dt;
    if (comboT > 0) comboT -= dt;
    const list = players.list;
    const tNow = sync.isReplica ? nowMs() : 0;
    for (let i = active.length - 1; i >= 0; i--) {
      const p = active[i];
      p.age += dt;
      if (p.scale < 1 && p.state !== 'magnet' && p.state !== 'await') p.scale = Math.min(1, p.scale + dt / SPAWN_SCALE_TIME * 0.7);

      if (p.state === 'fly') {
        p.vy -= GRAVITY * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        p.tilt.rotation.y += p.spin * dt;
        const gy = getHeight(p.x, p.z) + HOVER;
        if (p.y <= gy && p.vy < 0) {
          p.y = gy;
          p.bounces++;
          const impact = -p.vy;
          p.sq = Math.min(0.35, impact * 0.045); p.sqv = 0;
          if (impact < 2.4 || p.bounces >= 3) { p.state = 'rest'; p.vy = p.vx = p.vz = 0; settle(p); p.restT = 0; if (sync.isHost) announceRest(p); }
          else { p.vy = impact * 0.45; p.vx *= 0.5; p.vz *= 0.5; p.spin *= 0.6; }
        }
      } else if (p.state === 'rest') {
        p.restT += dt;
        if (p.hostRest) {                                         // replica: glide to the spot where the HOST's copy lies
          const ex = p.hostRest.x - p.x, ez = p.hostRest.z - p.z;
          if (ex * ex + ez * ez < 0.0004) { p.x = p.hostRest.x; p.z = p.hostRest.z; }
          else { const k = 1 - Math.exp(-9 * dt); p.x += ex * k; p.z += ez * k; }
        }
        const gy = getHeight(p.x, p.z);
        p.y = gy + HOVER + 0.03 * (1 + Math.sin(time * 2.6 + p.phase));
        p.tilt.rotation.y += (1.2 + p.spin * 0.05) * dt;
        if (p.id === 'crystal' && particles && time >= (p.sparkleAt || 0)) {     // gems glint (cosmetic: every screen does its own)
          p.sparkleAt = time + 0.9 + Math.random() * 0.9;
          particles.burst('sparkle', { x: p.x + (Math.random() - 0.5) * 0.3, y: p.y + 0.35, z: p.z + (Math.random() - 0.5) * 0.3 }, { count: 1, radius: 0.08, speed: 0.3, size: 0.8, color: '#dfeaff' });
        }
      }

      // magnet: any active player close enough (not while it is still popping out)
      if (p.state !== 'magnet' && p.age >= COLLECT_DELAY && !(p.backoffUntil > tNow)) {
        for (const pl of list) {
          if (pl.away) continue;
          const dx = pl.position.x - p.x, dz = pl.position.z - p.z;
          if (dx * dx + dz * dz < MAGNET_RADIUS * MAGNET_RADIUS && Math.abs(pl.position.y - p.y) < 2.5) {
            p.state = 'magnet'; p.target = pl; p.mt = 0; p.sx = p.x; p.sy = p.y; p.sz = p.z;
            if (sync.isReplica) claim(p, pl);                    // the host's answer overlaps the flight
            break;
          }
        }
      }

      if (p.state === 'magnet') {
        p.mt += dt;
        const u = Math.min(1, p.mt / MAGNET_TIME);
        const pl = p.target;
        const alive = pl && players.get(pl.index) === pl && !pl.leaving;
        const tx = alive ? pl.position.x : p.sx, ty = (alive ? pl.position.y : p.sy) + 0.9, tz = alive ? pl.position.z : p.sz;
        const e = u * u * (3 - 2 * u) * 0.6 + u * u * 0.4;           // eases in, snaps home
        p.x = p.sx + (tx - p.sx) * e;
        p.y = p.sy + (ty - p.sy) * e + Math.sin(u * Math.PI) * 0.25;
        p.z = p.sz + (tz - p.sz) * e;
        p.tilt.rotation.y += 12 * dt;
        p.scale = 1 - 0.55 * u;
        if (u >= 1) {
          if (sync.isHost) { hostCollect(p, alive ? pl : null); continue; }
          if (!p.asked && alive) claim(p, pl);
          p.state = 'await'; p.mt = 0;                           // replica: waiting for the host's `collected` event
        }
      } else if (p.state === 'await') {
        p.mt += dt;
        const pl = p.target;
        if (pl && players.get(pl.index) === pl) { p.x = pl.position.x; p.y = pl.position.y + 0.9; p.z = pl.position.z; }
        if (p.mt > AWAIT_TIMEOUT) dropBack(p);
      }

      // squash spring (bounce landing)
      p.sqv += (-240 * p.sq - 14 * p.sqv) * dt;
      p.sq += p.sqv * dt;
      p.tilt.scale.set(1 + p.sq * 0.5, 1 - p.sq, 1 + p.sq * 0.5);
      p.root.position.set(p.x, p.y, p.z);
      p.root.scale.setScalar(p.scale);
    }
  }

  // ------------------------------------------------------------------ world sync domain
  const r2 = (v) => Math.round(v * 100) / 100;
  /** HOST: this pickup came to rest: its position is now the authoritative one (only serialised when a replica is connected). */
  function announceRest(p) {
    if (!sync.hasReplicas) return;
    sync.emit('pickups', 'rest', { pid: p.pid, x: r2(p.x), y: r2(getHeight(p.x, p.z) + HOVER), z: r2(p.z) });
  }
  sync.register('pickups', {
    snapshot: () => ({ pickups: active.map((p) => ({ pid: p.pid, id: p.id, x: r2(p.x), y: r2(p.y), z: r2(p.z), rest: p.state === 'rest' })) }),
    hashView: () => ({ pickups: active.map((p) => [p.pid, p.id]).sort((a, b) => a[0] - b[0]) }),
    applySnapshot(s) {
      for (const p of [...active]) release(p);
      for (const e of (s && s.pickups) || []) {
        const q = create({ ...e, vx: 0, vy: 0, vz: 0, phase: (e.pid * 1.7) % TAU, spin: 0, yaw: (e.pid * 2.3) % TAU, age: COLLECT_DELAY });
        if (q && e.rest) { q.state = 'rest'; q.restT = 0; q.hostRest = { x: e.x, z: e.z }; q.y = getHeight(e.x, e.z) + HOVER; }   // lies where the host's copy lies
      }
    },
    applyEvent(kind, d) {
      if (kind === 'spawn') { if (!byPid.has(d.pid)) create(d); }
      else if (kind === 'rest') { const q = byPid.get(d.pid); if (q && sync.isReplica) q.hostRest = { x: d.x, z: d.z }; }
      else if (kind === 'collected') applyCollected(d.pid, d.actor);
      else if (kind === 'clear') for (const p of [...active]) release(p);
    },
    handleRequest(kind, d, actor) {
      if (kind !== 'collect') return { reject: 'unknown-kind' };
      const p = byPid.get(d.pid);
      if (!p) return { reject: 'gone' };
      if (actor && actor.screen !== 'host' && Math.hypot(actor.pos.x - p.x, actor.pos.z - p.z) > COLLECT_RANGE) return { reject: 'far' };
      sync.request('inventory', 'add', { id: p.id, n: 1 });
      const who = actor ? { screen: actor.screen, index: actor.index } : null;
      sync.emit('pickups', 'collected', { pid: p.pid, actor: who });
      applyCollected(p.pid, who);
      return true;
    },
  });

  return {
    spawn, spawnTo, update,
    has: (id) => !!MODELS[id],
    byPid,
    get count() { return active.length; },
    get list() { return active; },
    max,
    gravity: GRAVITY,
    /** Debug: remove everything without collecting. */
    clear() { for (const p of [...active]) release(p); if (sync.isHost) sync.emit('pickups', 'clear', {}); },
    /** Debug: every pickup (even mid-pop) flies to `player` now. */
    vacuum(player) {
      for (const p of active) {
        if (p.state === 'magnet') continue;
        p.state = 'magnet'; p.target = player; p.mt = 0; p.sx = p.x; p.sy = p.y; p.sz = p.z; p.age = COLLECT_DELAY;
      }
    },
    constants: { GRAVITY, MAGNET_RADIUS, MAGNET_TIME, COLLECT_DELAY },
  };
}
