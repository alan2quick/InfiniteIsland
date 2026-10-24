import { campBenchSpot } from './campSeating.js';
// Campfire (PLAN Step 14): stone firepit + charred log pile + four log benches east of the spawn, with fuel, three fire levels and cooking.
//
//   const campfires = createCampfires({ scene, players, particles, hud, sfx, inventory, dialog, floatText, camera: followCam, sync });   // one per config FIRES entry
//   const campfire = campfires.home;                 // an instance: everything below is per fire (campfires.get(id) / .list / .nearest(pos))
//   campfires.update(dt, camera, viewportHeightPx)   // once per tick, AFTER players.update: updates every fire, then the shared light + crackle bed
//
// Step 33a: the fire is an INSTANCE (createCampfire({ fire, ... }), fire = a FIRES entry in config.js: id, island, position, bench layout, feast framing,
// light numbers). Home is { id: 'home' } and keeps every old name: sync domain 'campfire', menuId 'campfire', save key 'infinite-island.campfire.v1'. Any
// other fire has its own domain 'campfire:<id>' (same events / snapshot / hashView), menuId 'campfire:<id>' and save key 'infinite-island.campfire.<id>.v1'
// (game/fireLogic.js). Each fire has its own fuel timer, extrapolation, menu, cooking (only its own island's recipes) and quest rows. The pieces that must
// exist ONCE live in createCampfires: the single warm PointLight (it moves to the nearest lit fire and fades between fires: the light count never
// changes) and the crackle bed.
//   campfire.update(dt, camera, viewportHeightPx)   // (called by createCampfires.update)
//   campfire.release(player)                       // a player left (its device stayed away): cancels its toss / cooking (nothing is consumed)
//
// State
//   campfire.fuel (s, 0..540)   campfire.level (0..3)   campfire.lit   campfire.vis (smoothed 0..3 visual level)
//   level = min(3, ceil(fuel / 180)); a log adds 180 s; it burns down in simulation time (update(dt)), so __game.step fast-forwards it.
//   Persisted under 'infinite-island.campfire.v1' as { fuel, at } (fuel remaining at wall-clock `at`); on load the elapsed real time is subtracted.
//   campfire.setFuel(seconds) / campfire.burn(seconds)   // debug
//
// Player actions (the dialog menu calls these; any player can use the fire, each menu is owned by the player who opened it)
//   campfire.openMenu(player)        // interact: "Add a log (N)" / "Cook..." (lit only) / Quest (placeholder or provider) / "Leave"
//   campfire.addLog(player)          // face the fire, toss animation, the log flies into the pit and adds fuel (+ flare). Level 3 -> "roaring already!"
//   campfire.cook(recipeId, player)  // ~2 s holding a stick over the fire, then the dish goes into the bag
//   campfire.busy(player)            // true while that player is tossing / cooking (it is frozen meanwhile)
//   Consumption rules (nothing is ever duplicated or lost on an interruption):
//     * a LOG leaves the bag at the release frame of the toss (the flight is then deterministic and finishes without the player);
//       a player who leaves / is cancelled before that keeps the log.
//     * COOKING consumes the ingredients when the ~2 s are over (inventory.removeAll: all or nothing) and adds the dish in the same call. If the
//       player leaves, the fire goes out, or the ingredients were used up by somebody else in the meantime, nothing is consumed.
//
// World sync (Step 22b, domain 'campfire'; see net/worldSync.js). AUTHORITY (host): the fuel, the log in the bag, the ingredients of a dish.
//   fuel:     burns down on the HOST (and is saved there). The host broadcasts event fuel {fuel, flare} on every level change, when a log lands
//             (flare: true) and every ~5 s. A replica extrapolates the fuel locally (smooth "2:41" countdown, no drift) but its LEVEL (flames, light,
//             status icons) only changes through a fuel event: the extrapolation never drops below the floor of the current level.
//   addLog:   the tossing screen plays the swing; at the release frame it sends request addLog {from}. The host checks a log is in the bag and the
//             fire is not (projected) roaring, takes the log out of the bag and broadcasts toss {from, to, spin} (host-rolled landing spot): every
//             screen flies the same log into the pit. The host adds the fuel when ITS log lands (-> fuel event with the flare).
//   cook:     the pose / stick / sizzle play on the screen of the player who cooks (campfire.busy only ever concerns THIS screen's players). When the
//             ~2 s are over that screen sends request cook {recipe}; the host checks the fire is lit and runs inventory.removeAll (all or nothing) +
//             add of the dish, then broadcasts cooked {recipe, actor}: the cook's screen shows "Made X!" + "+1"; the others see the puff at the fire.
//             A cook whose screen disconnects before the end consumes nothing (the request is only sent at completion). There is NO single cook slot:
//             any number of players may cook at once; the bag arbitrates (the second finisher gets "The ingredients ran out!" if they overlap).
//   menus:    per screen (dialog owner). Snapshot {fuel}; hashView {level}. Debug request setFuel {fuel}.
//
// Step 15 hooks
//   campfire.setQuestProvider((player, campfire) => choices[] | null)   // dialog choices that REPLACE the placeholder "Quest" row
//                                                                        // (e.g. "Ask for a quest" / "Prepare the feast!"); null / [] -> placeholder
//   campfire.seats   [{ x, y, z, facing, bench }] one per bench: top-centre of the bench log, `facing` = yaw (player.facing convention) toward the fire.
//                    Seats lie inside the bench colliders: teleport + freeze the players (colliders only resolve on movement).
//   campfire.position (Vector3: fire centre on the ground)   campfire.topY (y of the flame base)   campfire.group (root Object3D)
//   campfire.showMain(player, index)   re-show the main menu inside the open dialog (quest sub-menus go back with it)
//   campfire.stoneRadius / benchRadius (u)
//   Step 37a: `fire.bench.style: 'basalt'` builds one flat-topped basalt slab per seat (the Emberleaf garden hearth) and `fire.stones: 'basalt'` makes the ring dark volcanic stone.
//   Step 33b: `fire.bench.style: 'stump'` builds one tree stump per seat (the Frostpine camp) instead of log benches, `fire.snowy` caps the stones with snow, and
//   Step 35b: campfire.benches.{ style, set(style, hide?), show(v), preview(style) }: the camp swaps its stumps for log benches at comfort 1 (`fire.bench.logLen` = their length). The seats array
//             (campfire.seats) is refilled IN PLACE with the same seat spots, so the feast just sits on whatever is there; colliders are replaced, never duplicated.
//   campfire.setIntro((player, fire) => pages | null)      the spirit's first-time pages, shown before the menu (game/campMenu.js)
//   campfire.setMenuExtras((player, fire) => rows[])       extra choice rows above "Leave" (the camp's "Camp jobs")
//   campfire.setBoost(n) / .boost   visual-only minimum fire level (feast scene: the flames flare to level 2 without touching fuel);  campfire.flare()
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FIRES, FUEL_PER_LOG, FIRE_MAX_LEVEL } from '../config.js';
import { getHeight } from './terrain.js';
import { addCollider, removeCollider } from './colliders.js';
import { addInteractable } from './interactables.js';
import { G, VERTEX_TOON, part, combine, makeOutline } from '../render/geo.js';
import { NEW_GAME, loadSave, writeSave, clearSave } from '../game/save.js';
import { getItem, getRecipe, listRecipes } from '../game/catalog.js';
import { domainOf, menuIdOf, saveKeyOf, levelOf as levelOfFuel, fuelFromSave, fuelLogCount, pickFuelLog, HOME_FIRE } from '../game/fireLogic.js';
import { FLAME_SVG, FLAME_OFF_SVG, POT_SVG, QUEST_SVG, LEAVE_SVG, BACK_SVG } from '../ui/icons.js';

const TAU = Math.PI * 2;
const HALF_PI = Math.PI / 2;
export const STORAGE_KEY = saveKeyOf(HOME_FIRE);      // home's save key (other fires: fireLogic.saveKeyOf(id))
const MAX_FUEL = FUEL_PER_LOG * FIRE_MAX_LEVEL;
const SAVE_EVERY = 5;               // s of simulation time between saves while burning
const SYNC_EVERY = 5;               // s of simulation time between the host's fuel events to the replicas (besides level changes / landings)
const REMOTE_FIRE_RANGE = 10;       // the host accepts a REMOTE actor's addLog / cook from this far from the fire (they start within reach; latency slack)
const STONE_RING = 1.0;             // radius of the stone ring (u)
const PIT_COLLIDER = 0.9;
const STATUS_RANGE = 6;             // a player this close shows the floating status
const TOSS_TIME = 0.5;              // log flight
const TOSS_RELEASE = 0.27;          // s into the toss swing at which the log leaves the hand
const TOSS_TOTAL = 0.62;
const COOK_TIME = 2.0;
const TOSS_KEYS = [[0.5, -0.05, -0.3, -0.12], [-1.75, -0.2, 0.35, 0.16]];
const COOK_POSE = [-1.45, -0.12, 0.3, 0.07];        // arm pitch, sway, body twist, lean while holding the stick out
const H_AT = [0, 1.05, 1.5, 2.0];                  // flame height factor per (smoothed) level 0..3
const W_AT = [0, 0.75, 1.0, 1.3];
const LEVEL_WORDS = ['cold', 'small', 'cosy', 'roaring'];

const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const interp = (arr, v) => { const i = Math.min(arr.length - 2, Math.floor(v)); return arr[i] + (arr[i + 1] - arr[i]) * (v - i); };
const levelOf = (fuel) => levelOfFuel(fuel, FUEL_PER_LOG, FIRE_MAX_LEVEL);
const fmtTime = (s) => { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// ---------------------------------------------------------------------------------------------
// Model: stones, charred logs, benches (each ONE merged vertex-coloured mesh + smoothed outline)
// ---------------------------------------------------------------------------------------------
function partFromQuat(geo, color, pos, quat, scale) {
  const e = new THREE.Euler().setFromQuaternion(quat, 'XYZ');
  return part(geo, color, { p: pos, r: [e.x, e.y, e.z], s: scale });
}

function buildModel(root, fire) {
  const cx = fire.x, cz = fire.z;
  const { len: BENCH_LEN, angles: BENCH_ANGLES } = fire.bench;   // (home: angles diagonal, so the four gaps face the compass points)
  const H = (lx, lz) => getHeight(cx + lx, cz + lz);
  const hC = H(0, 0);
  const meshes = [];
  const add = (geo, name, cast = true, outlineW = 0.04) => {
    const mesh = new THREE.Mesh(geo, VERTEX_TOON);
    mesh.name = name;
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    mesh.add(makeOutline(geo, outlineW));
    root.add(mesh);
    meshes.push(mesh);
    return mesh;
  };

  // --- stone ring + ash bed
  const basalt = fire.stones === 'basalt';                      // Step 37a: the garden hearth's ring is dark volcanic stone
  const stoneCols = basalt ? ['#554d62', '#463f52', '#625a70', '#4d465a'] : ['#b9b4cc', '#a49fc0', '#cbc7de', '#b0abc8'];
  const stones = [part(G.cyl8, '#3a3038', { p: [0, hC + 0.03, 0], s: [0.78, 0.06, 0.78] })];
  const N = 9;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * TAU + 0.2;
    const lx = Math.cos(a) * STONE_RING, lz = Math.sin(a) * STONE_RING;
    const s = 0.33 + 0.05 * Math.sin(i * 2.7);
    stones.push(part(G.ico1, stoneCols[i % 4], { p: [lx, H(lx, lz) + 0.1, lz], r: [0.3 * i, a, 0.2 * i], s: [s * 1.1, s * 0.8, s] }));
    if (fire.snowy && i % 3 !== 1) stones.push(part(G.ico1, '#f6f9ff', { p: [lx, H(lx, lz) + 0.1 + s * 0.62, lz], r: [0, a, 0], s: [s * 0.8, s * 0.3, s * 0.78] }));   // a snow cap (Frostpine)
  }
  add(combine(stones), 'campfire-stones', true, 0.05);

  // --- charred log pile: five logs leaning into a tepee + two lying across the bottom
  const char1 = '#3d2c28', char2 = '#2f2220', char3 = '#4d3830';
  const logs = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU + 0.35;
    logs.push(part(G.cyl8, i % 2 ? char1 : char3, { p: [Math.cos(a) * 0.3, hC + 0.3, Math.sin(a) * 0.3], r: [0, -a, 0.78], s: [0.13, 0.78, 0.13] }));
  }
  logs.push(part(G.cyl8, char2, { p: [0, hC + 0.13, 0], r: [0, 0.4, HALF_PI], s: [0.14, 1.25, 0.14] }));
  logs.push(part(G.cyl8, char1, { p: [0, hC + 0.26, 0], r: [0, 1.95, HALF_PI], s: [0.13, 1.15, 0.13] }));
  add(combine(logs), 'campfire-logs', false, 0.035);

  // --- benches: a fat log lying along the tangent, pale end rings, a stone wedge under each end. Step 35b: `benchSet(style)` builds the whole set for a style as DATA (one
  // merged geometry per seat + the seats + the collider circles); `applyBenchSet` makes it real (one mesh, the colliders, the seats array filled IN PLACE: fire.seats is shared).
  // The Frostpine camp starts with stumps and swaps to log benches at comfort 1 (benches.set), without ever duplicating colliders.
  const seats = [];
  const up = new THREE.Vector3(0, 1, 0);
  function benchSet(style) {
    const sets = [], seatList = [], cols = [];
    const addC = (c) => cols.push(c);
    BENCH_ANGLES.forEach((a, bi) => {
      const benchParts = [], stumps = [];
      const done = () => sets.push(combine(benchParts.concat(stumps)));
    if (style === 'capstool') {                       // Step 72a (the Duskcrown marsh hearth): a short cut mushroom stem per seat (pale lavender, glowing foot band, growth rings on the cut top) with a few little caps sprouting at its base
      const { x: bx, z: bz } = campBenchSpot(fire, bi);
      const g0 = H(bx, bz), R = 0.4, top = g0 + 0.5;                                  // same seat height as the log / stump / basalt seats, so the feast needs no change
      const stem = bi % 2 ? '#b9b9e6' : '#a4a6dc';
      stumps.push(part(G.cyl8, stem, { p: [bx, g0 + 0.24, bz], r: [0, a, 0], s: [R, 0.5, R] }));
      stumps.push(part(G.cyl8, '#8d8fcf', { p: [bx, g0 + 0.12, bz], r: [0, a + 0.4, 0], s: [R * 1.14, 0.26, R * 1.14] }));    // the flared foot
      stumps.push(part(G.cyl8, '#f08a3c', { p: [bx, g0 + 0.3, bz], s: [R * 1.02, 0.045, R * 1.02] }));                      // a warm glowing band round the stem
      stumps.push(part(G.cyl8, '#ecebfb', { p: [bx, top - 0.02, bz], s: [R * 0.97, 0.04, R * 0.97] }));
      stumps.push(part(G.cyl8, '#d6d4f2', { p: [bx, top, bz], s: [R * 0.62, 0.035, R * 0.62] }));                          // growth rings
      stumps.push(part(G.cyl8, '#c3c0ea', { p: [bx, top + 0.012, bz], s: [R * 0.26, 0.03, R * 0.26] }));
      for (let k = 0; k < 3; k++) {                                                    // little caps at the base: a cream stalk + a violet dome
        const ca = a + 0.9 + k * 2.2 + bi * 0.3, cr = R + 0.22 + (k % 2) * 0.1, cx2 = bx + Math.cos(ca) * cr, cz2 = bz + Math.sin(ca) * cr, cg = H(cx2, cz2), s = 0.11 + (k + bi) % 3 * 0.035;
        stumps.push(part(G.cyl6, '#e4e2f8', { p: [cx2, cg + s * 1.1, cz2], s: [s * 0.4, s * 2.2, s * 0.4] }));
        stumps.push(part(G.sphere, k === 1 ? '#7a7fd2' : '#5a5fb4', { p: [cx2, cg + s * 2.3, cz2], s: [s * 1.5, s * 0.8, s * 1.5] }));
        stumps.push(part(G.sphere, '#ffb347', { p: [cx2, cg + s * 2.45, cz2], s: [s * 0.55, s * 0.3, s * 0.55] }));        // a warm glow dot
      }
      addC({ x: cx + bx, z: cz + bz, r: R + 0.08 });
      seatList.push({ x: cx + bx, y: top, z: cz + bz, facing: Math.atan2(-bx, -bz), tangentX: -Math.sin(a), tangentZ: Math.cos(a), bench: bi });
      done();
      return;
    }
    if (style === 'basalt') {                         // Step 37a: a squat basalt column per seat: a pale worn top, a lichen patch, a pebble or two beside it
      const { x: bx, z: bz } = campBenchSpot(fire, bi);
      const g0 = H(bx, bz), R = 0.46, top = g0 + 0.5;
      const rock = bi % 2 ? '#4d4559' : '#585066';
      stumps.push(part(G.cyl6, rock, { p: [bx, g0 + 0.22, bz], r: [0, a, 0], s: [R, 0.5, R] }));
      stumps.push(part(G.cyl6, '#3f3849', { p: [bx, g0 + 0.1, bz], r: [0, a + 0.5, 0], s: [R * 1.1, 0.24, R * 1.1] }));       // a wider, darker foot
      stumps.push(part(G.cyl6, '#7a7188', { p: [bx, top - 0.02, bz], r: [0, a, 0], s: [R * 0.98, 0.05, R * 0.98] }));          // the worn top
      stumps.push(part(G.cyl6, '#928aa0', { p: [bx, top + 0.01, bz], r: [0, a, 0], s: [R * 0.6, 0.03, R * 0.6] }));
      stumps.push(part(G.ico1, '#6f9a52', { p: [bx + Math.cos(a + 2.4) * R * 0.55, g0 + 0.3, bz + Math.sin(a + 2.4) * R * 0.55], s: [0.13, 0.08, 0.12] }));   // moss
      for (let k = 0; k < 2; k++) {
        const pa = a + 1.1 + k * 2.6, px = bx + Math.cos(pa) * (R + 0.2), pz = bz + Math.sin(pa) * (R + 0.2);
        stumps.push(part(G.ico1, '#514a5e', { p: [px, H(px, pz) + 0.08, pz], r: [0.3, pa, 0.2], s: [0.17, 0.1, 0.14] }));
      }
      addC({ x: cx + bx, z: cz + bz, r: R + 0.08 });
      seatList.push({ x: cx + bx, y: top, z: cz + bz, facing: Math.atan2(-bx, -bz), tangentX: -Math.sin(a), tangentZ: Math.cos(a), bench: bi });
      done();
      return;
    }
    if (style === 'stump') {                          // Step 33b: one tree stump per seat (the Frostpine camp): pale rings on top, bark ridges, roots, a pinch of snow
      const { x: bx, z: bz } = campBenchSpot(fire, bi);
      const g0 = H(bx, bz), R = 0.42, top = g0 + 0.52;
      const bark = bi % 2 ? '#9b6a40' : '#a8703f';
      stumps.push(part(G.cyl8, bark, { p: [bx, g0 + 0.24, bz], r: [0, a, 0], s: [R, 0.5, R] }));
      stumps.push(part(G.cyl8, '#7e5230', { p: [bx, g0 + 0.2, bz], r: [0, a + 0.4, 0], s: [R * 1.06, 0.34, R * 1.06] }));     // darker ridge band
      stumps.push(part(G.cyl8, '#f2cf96', { p: [bx, top - 0.02, bz], s: [R * 0.97, 0.04, R * 0.97] }));
      stumps.push(part(G.cyl8, '#d9a971', { p: [bx, top, bz], s: [R * 0.62, 0.035, R * 0.62] }));
      stumps.push(part(G.cyl8, '#c98d5a', { p: [bx, top + 0.012, bz], s: [R * 0.26, 0.03, R * 0.26] }));
      for (let k = 0; k < 3; k++) {                              // roots
        const ra = a + 0.9 + k * 2.1, rx = bx + Math.cos(ra) * R * 0.95, rz = bz + Math.sin(ra) * R * 0.95;
        stumps.push(part(G.ico1, bark, { p: [rx, H(rx, rz) + 0.07, rz], r: [0.3, ra, 0.2], s: [0.2, 0.1, 0.13] }));
      }
      if (fire.snowy) stumps.push(part(G.ico1, '#f6f9ff', { p: [bx + Math.cos(a + 2.2) * R * 0.5, top + 0.035, bz + Math.sin(a + 2.2) * R * 0.5], s: [0.17, 0.06, 0.15] }));
      addC({ x: cx + bx, z: cz + bz, r: R + 0.08 });
      seatList.push({ x: cx + bx, y: top, z: cz + bz, facing: Math.atan2(-bx, -bz), tangentX: -Math.sin(a), tangentZ: Math.cos(a), bench: bi });
      done();
      return;
    }
    const LEN = BENCH_LEN || fire.bench.logLen || 1.7;
    const tx = -Math.sin(a), tz = Math.cos(a);
    const { x: bx, z: bz } = campBenchSpot(fire, bi);
    const ax = bx - tx * LEN / 2, az = bz - tz * LEN / 2;
    const ex = bx + tx * LEN / 2, ez = bz + tz * LEN / 2;
    const hA = H(ax, az), hB = H(ex, ez);
    const R = 0.27;
    const cy = (hA + hB) / 2 + R - 0.02;
    const dir = new THREE.Vector3(ex - ax, hB - hA, ez - az).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(up, dir);
    const len = Math.hypot(ex - ax, ez - az, hB - hA);
    benchParts.push(partFromQuat(G.cyl8, bi % 2 ? '#a8703f' : '#b97d48', [bx, cy, bz], q, [R, len, R]));
    benchParts.push(partFromQuat(G.cyl8, '#8a5a34', [bx, cy + R * 0.42, bz], q, [R * 0.55, len * 0.96, R * 0.5]));   // bark ridge
    for (const sg of [-1, 1]) {
      const px = bx + tx * sg * (len / 2 + 0.01), pz = bz + tz * sg * (len / 2 + 0.01), py = cy + dir.y * sg * len / 2;
      benchParts.push(partFromQuat(G.cyl8, '#f2cf96', [px, py, pz], q, [R * 0.96, 0.03, R * 0.96]));
      const sx = bx + tx * sg * (len / 2 - 0.22), sz = bz + tz * sg * (len / 2 - 0.22);
      benchParts.push(part(G.ico1, '#b9b4cc', { p: [sx, H(sx, sz) + 0.07, sz], r: [0.4, a, 0.2], s: [0.22, 0.13, 0.26] }));
    }
    for (const o of [-0.6, 0, 0.6]) addC({ x: cx + bx + tx * o, z: cz + bz + tz * o, r: 0.33 });
    const top = cy + R;
    seatList.push({ x: cx + bx, y: top, z: cz + bz, facing: Math.atan2(-bx, -bz), tangentX: -Math.sin(a), tangentZ: Math.cos(a), bench: bi });
    done();
    });
    return { geos: sets, seats: seatList, colliders: cols, style };
  }
  let benchMesh = null, benchColliders = [], benchStyle = fire.bench.style || 'log', benchGeos = [];
  function applyBenchSet(set, visible = true) {
    if (benchMesh) { root.remove(benchMesh); benchMesh.traverse((o) => { if (o.isMesh) o.geometry.dispose(); }); const mi = meshes.indexOf(benchMesh); if (mi >= 0) meshes.splice(mi, 1); benchMesh = null; }
    for (const c of benchColliders) removeCollider(c);
    for (const g of benchGeos) g.dispose();
    benchGeos = set.geos;
    benchColliders = set.colliders.map((c) => addCollider({ ...c, owner: root }));
    seats.length = 0; seats.push(...set.seats);
    const merged = mergeGeometries(set.geos.map((g) => g.clone()), false);
    benchMesh = add(merged, set.style === 'stump' || set.style === 'basalt' || set.style === 'capstool' ? 'campfire-stumps' : 'campfire-benches', true, 0.045);
    benchMesh.visible = visible;
    benchStyle = set.style;
  }
  applyBenchSet(benchSet(benchStyle));

  addCollider({ x: cx, z: cz, r: PIT_COLLIDER, owner: root });
  const benches = {
    get style() { return benchStyle; },
    /** Swap the seats between 'stump' and 'log' (Step 35b): colliders, seats and mesh are replaced, never duplicated. `hide` keeps the new mesh invisible until show(). */
    set(style, hide = false) { if (style !== benchStyle || !benchMesh) applyBenchSet(benchSet(style), !hide); else benchMesh.visible = !hide; },
    show(v = true) { if (benchMesh) benchMesh.visible = v; },
    /** Per-seat geometries of a style, in the fire's local space (the caller owns and disposes them): for the camp's pop-in animation. */
    preview(style) { return benchSet(style).geos; },
  };
  return { hC, seats, meshes, benches };
}

// ---------------------------------------------------------------------------------------------
// Flames: layered tongues (teardrops) in a tiny unlit shader with a noise-ish sway; three layers yellow > orange > red
// ---------------------------------------------------------------------------------------------
function tongueGeometry(tongues) {
  const pos = [], info = [], idx = [];
  const S = 9, N = 9;
  tongues.forEach((t, id) => {
    const base = pos.length / 3;
    for (let j = 0; j <= N; j++) {
      const v = j / N;
      const r = t.R * Math.sin(Math.PI * Math.pow(v, 0.55));
      for (let i = 0; i < S; i++) {
        const a = (i / S) * TAU;
        const y = v * t.H;
        const lean = Math.tan(t.lean) * y;
        pos.push(t.off * Math.cos(t.az) + r * Math.cos(a) + Math.cos(t.az) * lean, y, t.off * Math.sin(t.az) + r * Math.sin(a) + Math.sin(t.az) * lean);
        info.push(t.off * Math.cos(t.az), t.off * Math.sin(t.az), id + t.seed, v);
      }
    }
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < S; i++) {
        const a = base + j * S + i, b = base + j * S + (i + 1) % S, c = base + (j + 1) * S + i, d = base + (j + 1) * S + (i + 1) % S;
        idx.push(a, c, b, b, c, d);
      }
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aInfo', new THREE.Float32BufferAttribute(info, 4));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

const FLAME_VERT = /* glsl */`
attribute vec4 aInfo;        // x,y = tongue base (x, z), z = tongue id, w = height fraction 0..1
uniform float uTime;
uniform float uFlick;        // 0..1 how hard the tips dance (grows with the level)
varying float vV;
void main() {
  vV = aInfo.w;
  vec3 p = position;
  float t = uTime * 1.8 + aInfo.z * 1.9;
  float w = aInfo.w * aInfo.w;
  p.x += sin(t + p.y * 4.0) * 0.07 * w * uFlick;
  p.z += cos(t * 0.87 + p.y * 3.4) * 0.07 * w * uFlick;
  p.y *= 1.0 + 0.07 * sin(uTime * 2.4 + aInfo.z * 2.3) * uFlick + 0.025 * sin(uTime * 4.0 + aInfo.z * 4.1);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;
const FLAME_FRAG = /* glsl */`
uniform vec3 uLow;
uniform vec3 uHigh;
varying float vV;
void main() {
  vec3 col = mix(uLow, uHigh, step(0.5, vV));        // flat two-tone (toon) instead of a smooth gradient
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

function buildFlames(uTime) {
  const group = new THREE.Group();
  group.name = 'campfire-flames';
  const around = (n, off, R, Hs, lean, az0 = 0, seed = 0) => Array.from({ length: n }, (_, i) => ({
    off, az: az0 + (i / n) * TAU, R, H: Hs[i % Hs.length], lean, seed: seed + 1 + i,
  }));
  const layers = [
    { tongues: [{ off: 0, az: 0, R: 0.4, H: 1.0, lean: 0, seed: 0 }, ...around(5, 0.27, 0.27, [0.66, 0.8, 0.6, 0.74, 0.7], 0.24, 0.2)], low: '#ff4a2b', high: '#ff7b3a', flick: 1 },
    { tongues: [{ off: 0, az: 0, R: 0.28, H: 0.78, lean: 0, seed: 10 }, ...around(4, 0.17, 0.2, [0.5, 0.58, 0.46, 0.54], 0.2, 0.7, 10)], low: '#ff9a2e', high: '#ffb84a', flick: 1.1 },
    { tongues: [{ off: 0, az: 0, R: 0.16, H: 0.5, lean: 0, seed: 20 }, ...around(3, 0.1, 0.12, [0.32, 0.38, 0.3], 0.16, 1.2, 20)], low: '#ffe259', high: '#fff4b8', flick: 1.25 },
  ];
  const mats = [];
  layers.forEach((L, i) => {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime, uFlick: { value: 1 }, uLow: { value: new THREE.Color(L.low) }, uHigh: { value: new THREE.Color(L.high) } },
      vertexShader: FLAME_VERT, fragmentShader: FLAME_FRAG, side: THREE.DoubleSide,
      // Nested opaque tongues must not hide the shorter orange/yellow cores behind the outer red shell.
      // Depth testing stays on so scenery and logs still occlude the fire correctly.
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(tongueGeometry(L.tongues), mat);
    mesh.name = `flame-layer-${i}`;
    mesh.frustumCulled = false;
    mesh.renderOrder = 1 + i * 0.01;
    mesh.userData.flick = L.flick;
    group.add(mesh);
    mats.push(mat);
  });
  return { group, mats };
}

// ---------------------------------------------------------------------------------------------
// Embers: small additive sparks (own Points system, 1 draw call)
// ---------------------------------------------------------------------------------------------
const EMBER_VERT = /* glsl */`
attribute vec4 aEmber;      // x = size (world u), y = alpha, z = heat 0..1
uniform float uScale;
varying float vAlpha;
varying float vHeat;
void main() {
  vAlpha = aEmber.y; vHeat = aEmber.z;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aEmber.x * uScale / max(0.1, -mv.z);
}
`;
const EMBER_FRAG = /* glsl */`
varying float vAlpha;
varying float vHeat;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float d = length(p);
  float a = (1.0 - smoothstep(0.25, 1.0, d)) * vAlpha;
  if (a < 0.01) discard;
  vec3 col = mix(vec3(1.0, 0.32, 0.08), vec3(1.0, 0.86, 0.35), vHeat);
  gl_FragColor = vec4(col * a, a);            // additive (premultiplied in the fragment)
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

class Embers {
  constructor(scene, N = 56) {
    this.N = N;
    this.pos = new Float32Array(N * 3);
    this.vel = new Float32Array(N * 3);
    this.life = new Float32Array(N).fill(1);
    this.max = new Float32Array(N).fill(0);
    this.ph = new Float32Array(N);
    this.sz = new Float32Array(N);
    this.aPos = new THREE.BufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aEmber = new THREE.BufferAttribute(new Float32Array(N * 4), 4).setUsage(THREE.DynamicDrawUsage);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('aEmber', this.aEmber);
    this.material = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 } }, vertexShader: EMBER_VERT, fragmentShader: EMBER_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.points.name = 'campfire-embers';
    scene.add(this.points);
    this._next = 0;
  }

  get alive() { let n = 0; for (let i = 0; i < this.N; i++) if (this.life[i] < this.max[i]) n++; return n; }

  spawn(x, y, z, n = 1, { speed = 1, spread = 0.5 } = {}) {
    for (let k = 0; k < n; k++) {
      const i = this._next; this._next = (this._next + 1) % this.N;
      const a = Math.random() * TAU, r = Math.sqrt(Math.random()) * spread;
      this.pos[i * 3] = x + Math.cos(a) * r; this.pos[i * 3 + 1] = y + rnd(-0.1, 0.2); this.pos[i * 3 + 2] = z + Math.sin(a) * r;
      const sp = rnd(0.2, 0.9) * speed;
      this.vel[i * 3] = Math.cos(a) * sp * 0.5; this.vel[i * 3 + 1] = rnd(1.3, 2.8) * speed; this.vel[i * 3 + 2] = Math.sin(a) * sp * 0.5;
      this.life[i] = 0; this.max[i] = rnd(0.9, 1.8);
      this.ph[i] = Math.random() * TAU; this.sz[i] = rnd(0.12, 0.22);
    }
  }

  update(dt, camera, viewportH) {
    if (camera && viewportH) this.material.uniforms.uScale.value = viewportH / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    const op = this.aPos.array, oe = this.aEmber.array;
    let any = false;
    for (let i = 0; i < this.N; i++) {
      if (this.life[i] >= this.max[i]) { oe[i * 4] = 0; oe[i * 4 + 1] = 0; continue; }
      any = true;
      this.life[i] += dt;
      const u = Math.min(1, this.life[i] / this.max[i]);
      const i3 = i * 3;
      this.vel[i3] += Math.sin(this.life[i] * 5 + this.ph[i]) * 1.6 * dt;
      this.vel[i3 + 2] += Math.cos(this.life[i] * 4.3 + this.ph[i]) * 1.6 * dt;
      this.vel[i3 + 1] *= Math.exp(-0.45 * dt);
      this.pos[i3] += this.vel[i3] * dt; this.pos[i3 + 1] += this.vel[i3 + 1] * dt; this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      op[i3] = this.pos[i3]; op[i3 + 1] = this.pos[i3 + 1]; op[i3 + 2] = this.pos[i3 + 2];
      oe[i * 4] = this.sz[i] * (1 - 0.6 * u) * 2;
      oe[i * 4 + 1] = Math.min(1, (1 - u) * 1.8) * (0.75 + 0.25 * Math.sin(this.life[i] * 30 + this.ph[i]));
      oe[i * 4 + 2] = 1 - u;
    }
    this.aPos.needsUpdate = true;
    this.aEmber.needsUpdate = true;
    this.points.visible = any;                  // no sparks alive: no draw call (every fire owns one; a far fire costs nothing)
  }
}

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 2, 64, 64, 63);
  grad.addColorStop(0, 'rgba(255,200,110,1)');
  grad.addColorStop(0.35, 'rgba(255,150,60,0.55)');
  grad.addColorStop(1, 'rgba(255,110,40,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------------------------------------
// createCampfire
// ---------------------------------------------------------------------------------------------
/**
 * ONE campfire (a FIRES entry). Build them through createCampfires below: it owns the single shared fire light and the crackle bed, which this instance
 * only computes (`lightTarget`, `crackle`).
 */
export function createCampfire({ fire = FIRES[0], scene, players, particles, hud, sfx = null, inventory, dialog, floatText = null, camera = null, sync }) {
  const snd = (name, opts) => { if (sfx) sfx.play(name, opts); };
  const DOMAIN = domainOf(fire.id), MENU_ID = menuIdOf(fire.id), SAVE_KEY = saveKeyOf(fire.id);
  const LABEL = fire.label || 'campfire';
  let time = 0;
  const root = new THREE.Group();
  root.name = fire.id === HOME_FIRE ? 'campfire' : `campfire-${fire.id}`;
  root.position.set(fire.x, 0, fire.z);
  scene.add(root);
  const model = buildModel(root, fire);
  const hC = model.hC;
  const fx = fire.x, fz = fire.z;
  const position = new THREE.Vector3(fx, hC, fz);

  // ---- visuals
  const uTime = { value: 0 };
  const flames = buildFlames(uTime);
  flames.group.position.set(0, hC + 0.32, 0);
  root.add(flames.group);

  const glowMat = new THREE.MeshBasicMaterial({
    map: glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, opacity: 0,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
  });
  const glow = new THREE.Mesh(new THREE.CircleGeometry(1, 32).rotateX(-HALF_PI), glowMat);
  glow.name = 'campfire-glow';
  glow.position.set(0, Math.max(hC, getHeight(fx + 1.8, fz), getHeight(fx - 1.8, fz), getHeight(fx, fz + 1.8), getHeight(fx, fz - 1.8)) + 0.05, 0);
  glow.renderOrder = 2;
  glow.visible = false;
  root.add(glow);

  // What the shared fire light would be if it sat on THIS fire (world position, intensity, distance): createCampfires applies the winner's.
  const lightTarget = { x: fx, y: hC + fire.light.height, z: fz, intensity: 0, distance: fire.light.dist0 };
  let crackle = 0;              // 0..1 volume this fire would give the crackle bed (createCampfires plays the loudest)

  const embers = new Embers(scene);

  // ---- state
  let fuel = 0;
  let level = 0;
  let vis = 0;                  // smoothed visual level 0..3
  let flare = 0;                // 1 right after a log lands, decays
  let saveT = 0, syncT = 0;
  let smokeT = 0, emberT = 0;
  const pending = [];           // logs in flight: { t, from, to, mesh }
  const logPool = [];
  const busyMap = new Map();    // Player -> { type: 'toss' | 'cook', t, ... }
  let questProvider = null;
  let introPages = null, menuExtras = null;    // Step 33b hooks (game/campMenu.js): the first-time spirit intro, and extra rows (Camp jobs) above "Leave"
  let nightness = 0;
  let boost = 0;                // visual-only minimum fire level (the feast scene: campfire.setBoost(2))

  {
    const data = NEW_GAME ? null : loadSave(SAVE_KEY);
    if (NEW_GAME) clearSave(SAVE_KEY);
    fuel = fuelFromSave(data, Date.now(), MAX_FUEL);
    level = levelOf(fuel);
    vis = level;
  }
  const save = () => { writeSave(SAVE_KEY, { v: 1, fuel: Math.round(fuel * 10) / 10, at: Date.now() }); };
  const r1 = (v) => Math.round(v * 10) / 10;
  const r3 = (v) => Math.round(v * 1000) / 1000;
  /** HOST: tell the replicas what the fuel is now (no-op without any). */
  const emitFuel = (flareFx = false) => { syncT = 0; sync.emit(DOMAIN, 'fuel', { fuel: r1(fuel), at: sync.hostNow(), flare: flareFx }); };
  const localPlayerOf = (actor) => (actor && actor.screen === sync.screenId ? players.get(actor.index) : null);
  const pendingFuel = () => pending.length * FUEL_PER_LOG;
  const projectedLevel = () => levelOf(Math.min(MAX_FUEL, fuel + pendingFuel()));

  // ---- floating status (flame icons x level + time left, or "Unlit")
  const statusEl = document.createElement('div');
  statusEl.className = 'fire-status';
  statusEl.hidden = true;
  statusEl.innerHTML = '<div class="fire-status-pill hide"><span class="fs-flames"></span><span class="fs-time"></span></div>';
  hud.root.appendChild(statusEl);
  const pillEl = statusEl.firstElementChild;
  const flamesEl = statusEl.querySelector('.fs-flames');
  const timeEl = statusEl.querySelector('.fs-time');
  let statusSig = '';
  let statusShown = false;
  const tmpV = new THREE.Vector3();

  function updateStatus(dt, cam, nearest) {
    const want = nearest < STATUS_RANGE;
    if (want !== statusShown) { statusShown = want; pillEl.classList.toggle('hide', !want); if (want) statusEl.hidden = false; }
    const sig = level === 0 ? 'out' : `${level}|${fmtTime(fuel)}`;
    if (sig !== statusSig) {
      statusSig = sig;
      if (level === 0) { flamesEl.innerHTML = FLAME_OFF_SVG; timeEl.textContent = 'Unlit'; timeEl.className = 'fs-time fs-out'; }
      else { flamesEl.innerHTML = FLAME_SVG.repeat(level); timeEl.textContent = fmtTime(fuel); timeEl.className = 'fs-time'; }
    }
    if (!cam) return;
    tmpV.set(fx, hC + 3.6 + vis * 0.3, fz).project(cam);
    const w = window.innerWidth, h = window.innerHeight;
    if (tmpV.z > 1 || Math.abs(tmpV.x) > 1.2 || Math.abs(tmpV.y) > 1.2) { statusEl.style.visibility = 'hidden'; return; }
    statusEl.style.visibility = '';
    statusEl.style.transform = `translate3d(${((tmpV.x * 0.5 + 0.5) * w).toFixed(1)}px, ${((-tmpV.y * 0.5 + 0.5) * h).toFixed(1)}px, 0)`;
  }

  // ---- log projectile model
  function makeLogMesh() {
    const bark = '#a8703f', ring = '#f2cf96', ring2 = '#c98d5a';
    const L = 0.62, R = 0.16;
    const parts = [
      part(new THREE.CylinderGeometry(R, R * 1.04, L, 10, 1, true), bark, { r: [0, 0, HALF_PI] }),
    ];
    for (const sgn of [-1, 1]) {
      parts.push(part(new THREE.CircleGeometry(R * 0.98, 10), ring, { p: [sgn * (L / 2 + 0.004), 0, 0], r: [0, sgn * HALF_PI, 0] }));
      parts.push(part(new THREE.RingGeometry(R * 0.28, R * 0.5, 10), ring2, { p: [sgn * (L / 2 + 0.012), 0, 0], r: [0, sgn * HALF_PI, 0] }));
    }
    const geo = combine(parts);
    const mesh = new THREE.Mesh(geo, VERTEX_TOON);
    mesh.add(makeOutline(geo, 0.03));
    mesh.castShadow = true;
    mesh.scale.setScalar(1.25);
    mesh.visible = false;
    scene.add(mesh);
    return mesh;
  }
  const takeLog = () => logPool.find((m) => !m.visible) || (logPool.push(makeLogMesh()), logPool[logPool.length - 1]);

  function handWorld(p, out) {
    const s = p.parts.handSocket;
    s.updateWorldMatrix(true, false);
    return s.getWorldPosition(out);
  }

  // ---- stick held while cooking (attached to the hand socket)
  let stickGeo = null;
  function makeStick() {
    if (!stickGeo) stickGeo = new THREE.CylinderGeometry(0.035, 0.042, 1, 6);
    const g = new THREE.Group();
    const rod = new THREE.Mesh(stickGeo, new THREE.MeshToonMaterial({ color: '#b07a48' }));
    rod.name = 'stick-rod';
    const foodMat = new THREE.MeshToonMaterial({ color: '#e8b56b' });
    const food = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), foodMat);
    food.name = 'stick-food';
    g.add(rod, food);
    g.userData = { rod, food, foodMat };
    return g;
  }
  function placeStick(st, L) {
    const { rod, food } = st.userData;
    rod.scale.set(1, L, 1);
    rod.position.set(0, 0.14 - L / 2, 0);
    food.position.set(0, 0.14 - L + 0.08, 0);
    food.scale.set(0.16, 0.14, 0.16);
  }

  // =========================================================================================== fuel + fire
  function setLevelVisuals() {
    const showFlames = vis > 0.015;
    flames.group.visible = showFlames;
    glow.visible = vis > 0.02;
  }

  function onLevelDown(from, to) {
    if (to === 0) {
      particles.burst('smoke', { x: fx, y: hC + 0.9, z: fz }, { count: 6, radius: 0.35, size: 1.5, life: 1.25 });
      particles.burst('puff', { x: fx, y: hC + 0.6, z: fz }, { count: 4, radius: 0.4 });
      if (nearestPlayerDist() < 28) { snd('sizzle'); hud.toast(`The ${LABEL} went out...`, { icon: 'flame', duration: 2200 }); }
      save();
    } else if (nearestPlayerDist() < 28) {
      particles.burst('smoke', { x: fx, y: hC + 1.0, z: fz }, { count: 2, radius: 0.3, size: 1.2 });
    }
  }

  function setFuel(s) {
    if (sync.isReplica) { sync.request(DOMAIN, 'setFuel', { fuel: s }); return; }     // debug: the host owns the fuel
    fuel = clamp(s, 0, MAX_FUEL);
    const nl = levelOf(fuel);
    if (nl !== level) { const old = level; level = nl; if (nl < old) onLevelDown(old, nl); }
    save();
    emitFuel();
  }

  /** HOST: a tossed log landed in the pit. */
  function landLog() {
    const was = level;
    fuel = Math.min(MAX_FUEL, fuel + FUEL_PER_LOG);
    level = levelOf(fuel);
    landFx(was);
    save();
    emitFuel(true);
  }

  /** Every screen: the flare-up (embers, sparkles, sound) of a log landing. `was` = the level before. */
  function landFx(was) {
    flare = 1;
    embers.spawn(fx, hC + 0.7, fz, 22, { speed: 1.5, spread: 0.45 });
    particles.burst('sparkle', { x: fx, y: hC + 1.1, z: fz }, { count: 6, radius: 0.4, color: '#ffc75a' });
    if (was === 0) particles.burst('smoke', { x: fx, y: hC + 1.0, z: fz }, { count: 3, radius: 0.3, size: 1.1 });
    snd('flare');
    if (camera && camera.shake) camera.shake(0.04, 0.14);
    statusEl.classList.remove('flare'); void statusEl.offsetWidth; statusEl.classList.add('flare');
  }

  /** Replica: the host says the fuel is `f` (periodic sync, level change, landing). The level (and its visuals) follow the host. */
  function applyFuel(f, flareFx, at = null) {
    const was = level;
    const age = Number.isFinite(at) && !sync.hostAway ? Math.max(0, Math.min(2, (sync.hostNow() - at) / 1000)) : 0;
    fuel = clamp((Number(f) || 0) - age, 0, MAX_FUEL);
    level = levelOf(fuel);
    if (level < was) onLevelDown(was, level);
    if (flareFx) landFx(was);
  }

  // =========================================================================================== player actions
  const isBusy = (p) => busyMap.has(p);

  function lock(p) { p.frozen = true; }
  function unlock(p) { if (!(dialog.isOpen && dialog.owner === p)) p.frozen = false; }

  function addLog(p) {
    if (!p || isBusy(p)) return false;
    if (!pickFuelLog((id) => inventory.count(id))) { hud.toast('You have no logs!', { icon: 'log' }); snd('bip'); return false; }
    if (projectedLevel() >= FIRE_MAX_LEVEL) { hud.toast('The fire is roaring already!', { icon: 'flame' }); snd('bip', { pitch: 0.8 }); return false; }
    p.faceToward(fx, fz);
    p.swing(TOSS_TOTAL * 0.85, TOSS_KEYS);
    lock(p);
    busyMap.set(p, { type: 'toss', t: 0, released: false });
    return true;
  }

  /** The toss reached its release frame: ask the authority to take a log out of the bag and throw it (host: decided right here). */
  function releaseLog(p, task) {
    task.released = true;
    const from = handWorld(p, new THREE.Vector3());
    const r = sync.request(DOMAIN, 'addLog', { from: { x: r3(from.x), y: r3(from.y), z: r3(from.z) } }, sync.actorFor(p));
    const answer = (res) => {
      if (res.ok || res.reason !== 'roaring') return;          // (no log any more: silently keep the old behaviour)
      hud.toast('The fire is roaring already!', { icon: 'flame' }); snd('bip', { pitch: 0.8 });   // somebody was faster: the log stays in the bag
    };
    if (sync.isHost) answer(r); else r.then(answer);
  }

  /** HOST: validate a toss, take the log out of the bag; the flight below finishes without the player. */
  function handleAddLog(d, actor) {
    if (!actor) return { reject: 'bad-request' };
    if (actor.screen !== 'host' && Math.hypot(actor.pos.x - fx, actor.pos.z - fz) > REMOTE_FIRE_RANGE) return { reject: 'far' };
    const fuelLog = pickFuelLog((id) => inventory.count(id));      // plain log first, then pine, then birch (game/fireLogic.js)
    if (!fuelLog) return { reject: 'no-log' };
    if (projectedLevel() >= FIRE_MAX_LEVEL) return { reject: 'roaring' };
    inventory.remove(fuelLog, 1);
    const f = d.from && typeof d.from === 'object' ? d.from : {};
    const data = {
      from: { x: Number(f.x) || fx, y: Number(f.y) || hC + 1.2, z: Number(f.z) || fz },
      to: { x: r3(fx + rnd(-0.12, 0.12)), z: r3(fz + rnd(-0.12, 0.12)) }, spin: r3(rnd(6, 10)),
    };
    applyToss(data);
    sync.emit(DOMAIN, 'toss', data);
    return true;
  }

  /** Every screen (host included): a log flies into the pit. Only the host's landing adds fuel (-> fuel event). */
  function applyToss(d) {
    const mesh = takeLog();
    const from = new THREE.Vector3(d.from.x, d.from.y, d.from.z);
    mesh.position.copy(from);
    mesh.visible = true;
    pending.push({ t: 0, from, to: new THREE.Vector3(d.to.x, hC + 0.55, d.to.z), mesh, spin: d.spin });
    snd('toss');
    if (dialog.isOpen && dialog.menuId === MENU_ID) dialog.refresh();   // the projected level may now be roaring
  }

  function cook(recipeId, p) {
    const r = getRecipe(recipeId);
    if (!r || !p || isBusy(p) || r.island !== fire.island) return false;
    if (level === 0) { hud.toast('Light the fire first!', { icon: 'flame' }); snd('bip', { pitch: 0.8 }); return false; }
    if (!inventory.hasAll(r.needs)) { hud.toast('Missing ingredients!', { icon: 'pot' }); snd('bip', { pitch: 0.8 }); return false; }
    const dish = getItem(r.dish);
    p.faceToward(fx, fz);
    lock(p);
    const stick = makeStick();
    stick.userData.foodMat.color.set(dish ? dish.color : '#e8b56b');
    p.parts.handSocket.add(stick);
    const task = { type: 'cook', t: 0, recipe: r, stick, sizzled: 0, puffT: 0 };
    busyMap.set(p, task);
    return true;
  }

  function endTask(p, task) {
    busyMap.delete(p);
    if (task.type === 'cook') {
      p.setPose(null);
      if (task.stick.parent) task.stick.parent.remove(task.stick);
      task.stick.userData.foodMat.dispose();
    }
    unlock(p);
  }

  /** The ~2 s are over: ask the authority to consume the ingredients (all or nothing) and hand over the dish. */
  function finishCook(p, task) {
    const r = task.recipe;
    const res = sync.request(DOMAIN, 'cook', { recipe: r.id }, sync.actorFor(p));
    const answer = (a) => {
      if (a.ok) return;                                              // (the 'cooked' event already showed the result)
      if (a.reason === 'out') hud.toast('The fire went out!', { icon: 'flame' });
      else if (a.reason === 'missing') { hud.toast('The ingredients ran out!', { icon: 'pot' }); snd('bip', { pitch: 0.8 }); }   // somebody used them meanwhile
    };
    endTask(p, task);
    if (sync.isHost) answer(res); else res.then(answer);
  }

  /** HOST: the fire must be lit and the bag must still hold every ingredient: then they are consumed and the dish added in one go. */
  function handleCook(d, actor) {
    const r = getRecipe(d.recipe);
    if (!r || !actor || r.island !== fire.island) return { reject: 'bad-request' };   // another island's recipe: not at this fire
    if (actor.screen !== 'host' && Math.hypot(actor.pos.x - fx, actor.pos.z - fz) > REMOTE_FIRE_RANGE) return { reject: 'far' };
    if (level === 0) return { reject: 'out' };
    if (!inventory.removeAll(r.needs)) return { reject: 'missing' };
    inventory.add(r.dish, 1);
    const data = { recipe: r.id, actor: { screen: actor.screen, index: actor.index } };
    applyCooked(data);
    sync.emit(DOMAIN, 'cooked', data);
    return true;
  }

  /** Every screen (host included): a dish was cooked. The cook's own screen gets the toast / sound / "+1"; everybody sees the puff at the fire. */
  function applyCooked(d) {
    const r = getRecipe(d.recipe);
    if (!r) return;
    const dish = getItem(r.dish);
    const p = localPlayerOf(d.actor);
    if (p) {
      const at = { x: p.position.x, y: p.position.y + 1.9, z: p.position.z };
      if (floatText) floatText(r.dish, 1, at, p);
      hud.toast(`Made ${dish ? dish.name : r.dish}!`, { icon: r.dish, duration: 2600 });
      snd('cooked');
      const h = handWorld(p, new THREE.Vector3());
      particles.burst('sparkle', h, { count: 7, radius: 0.35, speed: 0.9 });
    }
    particles.burst('puff', { x: fx, y: hC + 1.0, z: fz }, { count: 4, radius: 0.35 });
  }

  function cancelTask(p, task) {
    endTask(p, task);
  }

  function updateTasks(dt) {
    for (const [p, task] of [...busyMap]) {
      if (p.leaving || players.get(p.index) !== p) { cancelTask(p, task); continue; }
      task.t += dt;
      if (task.type === 'toss') {
        if (!task.released && task.t >= TOSS_RELEASE) releaseLog(p, task);
        if (task.t >= TOSS_TOTAL) endTask(p, task);
      } else {
        if (level === 0) { hud.toast('The fire went out!', { icon: 'flame' }); cancelTask(p, task); continue; }
        // pose: arm reaches toward the fire, the stick wiggles a little
        const k = COOK_POSE;
        p.setPose([k[0] + Math.sin(task.t * 7) * 0.05, k[1], k[2] + Math.sin(task.t * 4.3) * 0.04, k[3]]);
        p.faceToward(fx, fz);
        const d = Math.hypot(p.position.x - fx, p.position.z - fz);
        placeStick(task.stick, clamp(d - 0.6, 0.8, 2.6));
        if (task.t > 0.25 && !task.sizzled) { task.sizzled = 1; snd('sizzle', { vol: 0.8 }); }
        if (task.t > 1.15 && task.sizzled === 1) { task.sizzled = 2; snd('sizzle', { vol: 0.8, pitch: 1.1 }); }
        task.puffT -= dt;
        if (task.puffT <= 0 && task.t > 0.3) {
          task.puffT = 0.42;
          const tip = new THREE.Vector3();
          task.stick.userData.food.getWorldPosition(tip);
          particles.burst('puff', { x: tip.x, y: tip.y + 0.15, z: tip.z }, { count: 1, radius: 0.1, size: 0.8 });
          embers.spawn(tip.x, tip.y, tip.z, 2, { speed: 0.6, spread: 0.15 });
        }
        if (task.t >= COOK_TIME) finishCook(p, task);
      }
    }
  }

  // =========================================================================================== menu
  const tagFor = (p) => (players.multi ? p.colors.name : '');
  const fireWord = () => LEVEL_WORDS[level];

  function menuText() {
    return level === 0
      ? `The ${LABEL} is cold. Toss in a log to light it!`
      : `The fire is ${fireWord()}. About ${fmtTime(fuel)} of fuel left.`;
  }

  function mainChoices(p) {
    const logs = fuelLogCount((id) => inventory.count(id));     // every fuel log in the bag (plain, pine, birch)
    const roaring = projectedLevel() >= FIRE_MAX_LEVEL;
    const list = [
      // the menu stays open while the log flies, so several logs can be tossed in a row (presses during a toss are ignored)
      {
        label: `Add a log (${logs})`, icon: getItem('log').icon, disabled: logs === 0 || roaring,
        detail: logs === 0 ? 'No logs in your bag' : (roaring ? 'The fire is roaring already' : ''), onSelect: () => addLog(p),
      },
      {
        label: 'Cook...', icon: POT_SVG, disabled: level === 0, detail: level === 0 ? 'Light the fire first' : '',
        onSelect: () => dialog.showChoices(() => cookChoices(p), { text: 'What shall we cook?', onCancel: () => showMain(p, 1), index: 0 }),
      },
    ];
    let extra = null;
    if (questProvider) { try { extra = questProvider(p, api); } catch (e) { console.error(e); } }
    if (extra && extra.length) list.push(...extra);
    else {
      list.push({
        label: 'Quest', icon: QUEST_SVG,
        onSelect: () => dialog.showPages(['Come back soon — the island spirits are thinking of a quest!'], { onFinish: () => showMain(p, 2) }),
      });
    }
    if (menuExtras) { try { const more = menuExtras(p, api); if (more && more.length) list.push(...more); } catch (e) { console.error(e); } }
    list.push({ label: 'Leave', icon: LEAVE_SVG, onSelect: () => dialog.close() });
    return list;
  }

  function cookChoices(p) {
    const list = listRecipes(fire.island).map((r) => {   // each fire cooks only its own island's recipes
      const dish = getItem(r.dish);
      const chips = Object.entries(r.needs).map(([id, need]) => ({ icon: getItem(id).icon, have: inventory.count(id), need }));
      const ok = inventory.hasAll(r.needs);
      return {
        label: dish.name, icon: dish.icon, chips, disabled: !ok,
        onSelect: () => { dialog.close(); cook(r.id, p); },
      };
    });
    list.push({ label: 'Back', icon: BACK_SVG, onSelect: () => showMain(p, 1) });
    return list;
  }

  function showMain(p, index = null) {
    dialog.showChoices(() => mainChoices(p), { text: menuText, index, onCancel: null, name: fire.name });
  }

  function openMenu(p) {
    if (!p || dialog.isOpen || isBusy(p)) return false;
    dialog.open({
      name: fire.name, owner: p, tag: tagFor(p), color: p.colors.ui, menuId: MENU_ID,
      choices: () => mainChoices(p), text: menuText,
    });
    let pages = null;                                           // the spirit's first-time intro (once per screen), then the menu
    if (introPages) { try { pages = introPages(p, api); } catch (e) { console.error(e); } }
    if (pages && pages.length) dialog.showPages(pages, { name: fire.spirit || 'Campfire Spirit', onFinish: () => showMain(p, 0) });
    return true;
  }

  const item = addInteractable({
    type: 'campfire', object: root, position: position.clone(), radius: 1.0, prompt: fire.name,
    onInteract: (it, by) => openMenu(by),
  });
  root.userData.interactable = item;
  root.userData.fireId = fire.id;

  inventory.on('change', () => { if (dialog.isOpen && dialog.menuId === MENU_ID) dialog.refresh(); });

  // =========================================================================================== update
  function nearestPlayerDist() {
    let best = Infinity;
    for (const p of players.list) {
      if (p.away) continue;
      best = Math.min(best, Math.hypot(p.position.x - fx, p.position.z - fz));
    }
    return best;
  }

  const flick = (t) => 0.5 + 0.5 * (Math.sin(t * 1.65) * 0.45 + Math.sin(t * 2.75 + 1.3) * 0.35 + Math.sin(t * 0.9 + 4.0) * 0.2);

  function update(dt, cam = camera && camera.camera ? camera.camera : null, viewportH = 0) {
    time += dt;
    uTime.value = time;

    // fuel burns down: the HOST's timer is the authority (and is saved there); a replica only extrapolates the countdown and keeps its level until the
    // host's next fuel event (never below the floor of the current level)
    if (fuel > 0) {
      if (sync.isHost) {
        fuel = Math.max(0, fuel - dt);
        const nl = levelOf(fuel);
        if (nl !== level) { const old = level; level = nl; if (nl < old) onLevelDown(old, nl); emitFuel(); }
        saveT += dt;
        if (saveT >= SAVE_EVERY) { saveT = 0; save(); }
        syncT += dt;
        if (syncT >= SYNC_EVERY) emitFuel();
      } else {
        fuel = Math.max(level > 0 ? (level - 1) * FUEL_PER_LOG + 0.001 : 0, fuel - dt);
      }
    }

    // the menu owner walked away / its device dropped: close cleanly (the owner is unfrozen by the dialog's onClose)
    if (dialog.isOpen && dialog.menuId === MENU_ID && dialog.owner && (dialog.owner.away || dialog.owner.leaving)) dialog.close();
    if (dialog.isOpen && dialog.menuId === MENU_ID && dialog.owner && dialog.owner !== players.get(dialog.owner.index)) dialog.close();
    if (level !== _lastMenuLevel) { _lastMenuLevel = level; if (dialog.isOpen && dialog.menuId === MENU_ID) dialog.refresh(); }

    updateTasks(dt);

    // logs in flight
    for (let i = pending.length - 1; i >= 0; i--) {
      const L = pending[i];
      L.t += dt;
      const u = Math.min(1, L.t / TOSS_TIME);
      L.mesh.position.lerpVectors(L.from, L.to, u);
      L.mesh.position.y += Math.sin(u * Math.PI) * 0.9;
      L.mesh.rotation.z += L.spin * dt;
      L.mesh.rotation.y += L.spin * 0.4 * dt;
      if (u >= 1) { L.mesh.visible = false; pending.splice(i, 1); if (sync.isHost) landLog(); }
    }

    // smooth level transitions
    const visTarget = Math.max(level, boost);                 // the feast scene flares the flames up visually (real fuel untouched)
    vis += (visTarget - vis) * (1 - Math.exp(-2.4 * dt));
    if (Math.abs(visTarget - vis) < 0.01) vis = visTarget;
    flare = Math.max(0, flare - dt * 1.8);
    const f = flick(time);
    const f2 = flick(time * 1.37 + 3.1);

    // flames
    const v = Math.max(0, vis);
    const hS = interp(H_AT, v) * (1 + 0.45 * flare), wS = interp(W_AT, v) * (1 + 0.25 * flare);
    flames.group.children.forEach((m, i) => {
      const ff = i === 0 ? f : i === 1 ? f2 : 1 - f;
      m.scale.set(wS * (0.96 + 0.08 * ff), hS * (0.96 + 0.1 * ff * m.userData.flick * 0.9), wS * (0.96 + 0.08 * f2));
      m.rotation.z = (ff - 0.5) * 0.08; m.rotation.x = (f2 - 0.5) * 0.08;
      m.material.uniforms.uFlick.value = 0.6 + 0.3 * Math.min(3, v);
    });

    // glow disc + light
    glow.scale.setScalar(1.4 + interp([0, 1.5, 2.4, 3.3], v) * (1 + 0.2 * flare));
    glowMat.opacity = Math.min(1, v) * (0.16 + 0.05 * Math.min(3, v) + 0.05 * f + 0.2 * flare);
    const LG = fire.light;
    lightTarget.intensity = v > 0.02 ? (LG.base + LG.perLevel * v) * (0.88 + 0.2 * f) * (1 + 0.7 * flare) * (1 + nightness * 1.4) : 0;
    lightTarget.distance = (LG.dist0 + v * LG.distPerLevel) * (1 + nightness * 0.45);
    lightTarget.x = fx + (f2 - 0.5) * 0.2; lightTarget.z = fz + (f - 0.5) * 0.2;
    setLevelVisuals();

    // ember / smoke emitters
    const near = nearestPlayerDist();
    const eff = Math.max(level, boost);
    if (near < 45) {
      if (eff >= 2) {
        emberT -= dt;
        const rate = eff === 3 ? 0.07 : 0.22;
        while (emberT <= 0) { emberT += rate * rnd(0.6, 1.4); embers.spawn(fx, hC + 0.5 + 0.5 * v, fz, 1, { spread: 0.3 * wS + 0.1 }); }
      }
      // Cold ashes stay quiet; only the brief extinguishing puff remains when fuel runs out.
      if (eff >= 2 || vis > 1.5) {
        smokeT -= dt;
        if (smokeT <= 0) { smokeT = eff === 3 ? rnd(0.28, 0.5) : rnd(0.8, 1.3); particles.burst('smoke', { x: fx + rnd(-0.2, 0.2), y: hC + 0.5 + 1.3 * hS, z: fz + rnd(-0.2, 0.2) }, { count: 1, radius: 0.15, size: eff === 3 ? 0.55 : 0.4, life: 1.6 }); }
      }
    }
    embers.update(dt, cam, viewportH);

    // crackle: louder with the level, quieter with distance to the nearest player (createCampfires plays the loudest fire)
    const att = Math.pow(clamp(1 - (near - 2) / 24, 0, 1), 1.4);
    crackle = v > 0.05 ? att * (0.18 + 0.27 * Math.min(3, v)) * (1 + 0.3 * flare) : 0;

    updateStatus(dt, cam, near);
  }
  let _lastMenuLevel = level;

  sync.register(DOMAIN, {
    snapshot: () => ({ fuel: r1(fuel), at: sync.hostNow() }),
    hashView: () => ({ level }),
    applySnapshot(snap) {
      const age = Number.isFinite(snap?.at) && !sync.hostAway ? Math.max(0, Math.min(2, (sync.hostNow() - snap.at) / 1000)) : 0;
      fuel = clamp((Number(snap && snap.fuel) || 0) - age, 0, MAX_FUEL);
      level = levelOf(fuel);
      vis = Math.max(level, 0);                                   // a joining screen sees the fire as it is, no ease-in
    },
    applyEvent(kind, d) {
      if (kind === 'fuel') applyFuel(d.fuel, d.flare, d.at);
      else if (kind === 'toss') applyToss(d);
      else if (kind === 'cooked') applyCooked(d);
    },
    handleRequest(kind, d, actor) {
      if (kind === 'addLog') return handleAddLog(d, actor);
      if (kind === 'cook') return handleCook(d, actor);
      if (kind === 'setFuel') { setFuel(Number(d.fuel) || 0); return true; }
      return { reject: 'unknown-kind' };
    },
  });

  const api = {
    id: fire.id, fire, name: fire.name, label: LABEL, island: fire.island, menuId: MENU_ID, domain: DOMAIN, saveKey: SAVE_KEY,
    group: root, position, seats: model.seats, stoneRadius: STONE_RING, benchRadius: fire.bench.ring, benches: model.benches,
    get topY() { return hC + 0.3; },
    get fuel() { return fuel; },
    get level() { return level; },
    get lit() { return level > 0; },
    get vis() { return vis; },
    get embers() { return embers; },
    get pendingLogs() { return pending.length; },
    lightTarget, get crackle() { return crackle; }, flames: flames.group, glow, statusEl, interactable: item,
    setNightness(n) { nightness = clamp(n, 0, 1); },
    maxFuel: MAX_FUEL,
    update, openMenu, addLog, cook, busy: isBusy,
    /** Show the main campfire menu again (sub-menus / quest pages use it as their way back); `index` = the row to highlight. */
    showMain(p, index = null) { showMain(p, index); },
    setQuestProvider(fn) { questProvider = typeof fn === 'function' ? fn : null; if (dialog.isOpen && dialog.menuId === MENU_ID) dialog.refresh(); },
    /** Step 33b: `fn(player, fire)` -> extra choice rows shown above "Leave" (the camp's "Camp jobs"); null clears. */
    setMenuExtras(fn) { menuExtras = typeof fn === 'function' ? fn : null; if (dialog.isOpen && dialog.menuId === MENU_ID) dialog.refresh(); },
    /** Step 33b: `fn(player, fire)` -> pages the spirit says when this player opens the menu (return null / [] for none); runs on every open, so it decides "first time" itself. */
    setIntro(fn) { introPages = typeof fn === 'function' ? fn : null; },
    release(p) { const t = busyMap.get(p); if (t) cancelTask(p, t); },
    setFuel, burn(seconds) { setFuel(fuel - seconds); },
    /** Visual-only minimum level (0..3) the flames / light / embers ease toward; the real fuel and level are untouched (feast scene: setBoost(2) / setBoost(0)). */
    setBoost(n) { boost = clamp(Math.round(n) || 0, 0, FIRE_MAX_LEVEL); },
    get boost() { return boost; },
    /** A visual + audible flare-up without adding fuel. */
    flare() {
      flare = 1;
      embers.spawn(fx, hC + 0.7, fz, 20, { speed: 1.4, spread: 0.45 });
      particles.burst('sparkle', { x: fx, y: hC + 1.1, z: fz }, { count: 6, radius: 0.4, color: '#ffc75a' });
      snd('flare');
    },
    /** Everything the fire looks like right now (debug / tests). */
    summary() { return { fuel: +fuel.toFixed(1), level, vis: +vis.toFixed(2), lit: level > 0, pending: pending.length, busy: busyMap.size, lightI: +lightTarget.intensity.toFixed(2), embers: embers.alive }; },
  };
  window.addEventListener('pagehide', save);
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
  return api;
}

// ---------------------------------------------------------------------------------------------
// createCampfires: one instance per FIRES entry + the things that must exist ONCE
// ---------------------------------------------------------------------------------------------
const LIGHT_FADE = 0.3;            // s the shared light takes to fade out / in when it moves to another fire
const LIGHT_SWITCH_GAIN = 3;       // u: another lit fire must be this much nearer to the players than the current one before the light moves

/**
 * Builds every fire in FIRES (each exactly once: colliders / interactables are module singletons) and owns the pieces that must not be duplicated:
 *   * ONE warm PointLight, always in the scene (so the light count and every shader's light uniforms never change). It sits on the lit fire nearest to
 *     this screen's local players (a second fire only takes it once it is LIGHT_SWITCH_GAIN nearer, so it never flaps), fading out / in on the move.
 *     Each instance only computes `lightTarget`; the winner's numbers are applied here.
 *   * the crackle bed (`sfx.setFire`): the loudest fire (= the nearest lit one in range) wins.
 *
 *   const campfires = createCampfires({ scene, players, particles, hud, sfx, inventory, dialog, floatText, camera, sync });
 *   campfires.list / .get(id) / .home / .nearest({x, z}) / .busy(player) / .release(player) / .setNightness(n) / .update(dt, cam, viewportH)
 *   campfires.light (the shared PointLight)  .lightOwner (the fire it is on)  .returnText()  .summary()
 */
export function createCampfires({ scene, players, sfx = null, fires = FIRES, ...deps }) {
  const list = fires.map((fire) => createCampfire({ fire, scene, players, sfx, ...deps }));
  const byId = new Map(list.map((f) => [f.id, f]));
  const home = byId.get(HOME_FIRE) || list[0];

  const light = new THREE.PointLight('#ffb45a', 0, 12, 1.6);      // always in the scene (intensity 0 when cold) so the light count never changes
  light.castShadow = false;
  light.position.set(home.lightTarget.x, home.lightTarget.y, home.lightTarget.z);
  scene.add(light);
  let owner = home, fade = 1;

  const playerDist = (f) => {
    let best = Infinity;
    for (const p of players.list) { if (!p.away) best = Math.min(best, Math.hypot(p.position.x - f.position.x, p.position.z - f.position.z)); }
    return best === Infinity ? 0 : best;
  };
  const isLit = (f) => f.lightTarget.intensity > 0;

  function wantedOwner() {
    let best = null, bd = Infinity;
    for (const f of list) { if (!isLit(f)) continue; const d = playerDist(f); if (d < bd) { bd = d; best = f; } }
    if (!best) return owner;                                      // everything is cold: the light stays where it was (at intensity 0)
    if (!isLit(owner)) return best;
    return best !== owner && bd < playerDist(owner) - LIGHT_SWITCH_GAIN ? best : owner;
  }

  function updateLight(dt) {
    const want = list.length > 1 ? wantedOwner() : owner;
    if (want !== owner) {
      if (!isLit(owner)) { owner = want; fade = 1; }
      else { fade = Math.max(0, fade - dt / LIGHT_FADE); if (fade <= 0) owner = want; }
    } else fade = Math.min(1, fade + dt / LIGHT_FADE);
    const t = owner.lightTarget;
    light.position.set(t.x, t.y, t.z);
    light.intensity = t.intensity * fade;
    light.distance = t.distance;
  }

  return {
    list, home, light, islands: [...new Set(list.map((f) => f.island))],
    get lightOwner() { return owner; },
    get(id) { return byId.get(id) || null; },
    /** The fire closest to `pos` ({x, z}) on the ground, lit or not. */
    nearest(pos) {
      let best = null, bd = Infinity;
      for (const f of list) { const d = Math.hypot(f.position.x - pos.x, f.position.z - pos.z); if (d < bd) { bd = d; best = f; } }
      return best;
    },
    update(dt, cam, viewportH) {
      for (const f of list) f.update(dt, cam, viewportH);
      updateLight(dt);
      if (sfx) sfx.setFire(list.reduce((m, f) => Math.max(m, f.crackle), 0));
    },
    setNightness(n) { for (const f of list) f.setNightness(n); },
    /** Is this (local) player tossing / cooking at any fire? */
    busy(p) { return list.some((f) => f.busy(p)); },
    release(p) { for (const f of list) f.release(p); },
    /** The quest tracker's "gathered everything" line: name the place when there is more than one fire. */
    returnText(id = 'home') { return `Return to the ${id === 'home' ? 'campfire' : id === 'frost' ? 'Frostpine camp' : id === 'duskcrown' || id === 'dusk' ? 'marsh hearth' : 'garden hearth'}!`; },
    summary() { return { lightOwner: owner.id, lightI: +light.intensity.toFixed(2), fade: +fade.toFixed(2), crackle: +Math.max(...list.map((f) => f.crackle)).toFixed(3), fires: list.map((f) => ({ id: f.id, island: f.island, ...f.summary() })) }; },
  };
}
