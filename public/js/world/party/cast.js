// Driftwood Cast's stage (Step 81a): a jetty over the Emberleaf lagoon at sunset. Four berths on the jetty, a water lane in front of each (a faint tint and a row of buoys between lanes), the sun sinking behind a far
// volcano, Yu Bbui Bbui on her little stage at the left where it sparkles. The finds (driftwood, glimmerfin, message bottle, lanternkoi, golden shell, old boot) drift across every lane in the same order; a glowing
// ring on each lane is the AIM MARKER (it sweeps in and out by itself); the line rests in the water by itself; a PRESS strikes and the hook lands inside the ring where it was. Built once (lazily), hidden outside the game; ONE Group at the stage centre.
//
// WHAT YOU SEE IS WHAT IS JUDGED: the marker is drawn at `markerDepth(t)` (ring radius = `hookR`, the hook's reach); the hook flies to the marker's depth at the press and lands `flight` s later; every find is drawn at
// `itemPose()` of game/party/castLogic.js, the same numbers the host compares with. A hooked find rides the line to the rod tip as the reel count rises (the count is the host's).
//
//   const w = createCastWorld({ scene, sfx, particles, labels })
//   w.setVisible(on)         w.update(dt, { mode: 'practice' | 'wait' | 'play', v, t, who, lanePlayers })     v = castLogic.view(g, t) in play; lanePlayers[i] = the Player (or avatar) of lane i or null
//   w.onRec(rec, v, who)     presentation of a record: a cast (the line zips out), a catch (a sparkle, a word: "+5!", or "Blah!" for a boot)
//   w.practicePress(i, p) -> true | null     a press of lane i in the how-to (a strike or a reel pull): the SAME rules on a local scratch game, nothing scores
//   w.scoreText(v, slot) -> { text, out }    w.cam    w.look ('sunset')    w.clearPractice()    w.counts() -> what is drawn now    w.hookDraw(i) -> { x, y, z } the drawn hook of lane i (null while it hangs on the rod)    w.markerDraw(i)
// Water life (all instanced / pooled, no lights): moving glints across the lanes, splash rings + droplets where a hook lands and where a find is pulled out, bubbles + a wake behind swimming fish.
// Fish and finds always face their direction of travel (`yawFor`, the turn is eased); labels sit above the player's berth, never over the hook.
// Draw calls: base 1 (+outline), water 2, glow 1, glints 1, droplets 1, markers 2, hook + line 2, finds <= 6, Bbui ~11; about 32.
import * as THREE from 'three';
import { PARTY, TDOONGZ } from '../../config.js';
import { stageCentre } from '../../game/party/partyArea.js';
import { buildItems, itemPose, markerDepth, ptsOf, NAMES, FORWARD, yawFor, velocityOf, init as castInit, step as castStep, request as castRequest, apply as castApply, view as castView, ID } from '../../game/party/castLogic.js';
import { createTdoongModel } from '../../npc/tdoongz.js';
import { createJournalModel } from '../../player/journalModels.js';
import { part, G, VERTEX_TOON, combine } from '../../render/geo.js';
import { solid, glow, disc, ring, box, post, ball } from './kit.js';
import { stageLivingLifecycle, hostIdle } from './livingStage.js';

const C = PARTY.cast, O = PARTY.origin;
const centre = stageCentre(ID);
export const CAM = { focus: { x: centre.x, y: O.y + 0.2, z: centre.z - 0.1 }, offset: { x: 0, y: 14, z: 15 }, extent: { w: 30, d: 24 } };
const WATER_Y = -0.45;
const BBUI = { x: -14.2, z: 3.6 };
const LANE_TINT = ['#ff9aa8', '#9ad0ff', '#ffe27a', '#9af0b8'];
const CAP = { driftwood: 14, glimmerfin: 14, bottle: 14, lanternkoi: 10, shell: 8, boot: 12 };
const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const wp = (x, y, z) => ({ x: centre.x + x, y: O.y + y, z: centre.z + z });
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const laneX = (i) => C.lanes[i];
const waterZ = (d) => C.edgeZ - d;                                              // a distance from the jetty edge -> stage-local z

function fishGeo(id) {                                                          // the journal's own fish (centred, rotated to its best angle), baked for instancing
  const m = createJournalModel(id), mesh = m.children[0];
  mesh.updateMatrix();
  const g = mesh.geometry.clone().applyMatrix4(mesh.matrix);
  m.userData.dispose?.();
  g.deleteAttribute('aMark');
  return g;
}
const B1 = new THREE.BoxGeometry(1, 1, 1);
function driftwoodGeo() { return combine([part(G.cyl8, '#b48a5a', { p: [0, 0, 0], r: [0, 0, Math.PI / 2], s: [0.14, 0.95, 0.14] }), part(G.cyl8, '#8f6a42', { p: [0.32, 0.14, 0.02], r: [0, 0, 0.9], s: [0.05, 0.3, 0.05] }), part(G.sphereLo, '#d6b88a', { p: [-0.47, 0, 0], s: [0.07, 0.15, 0.15] }), part(G.sphereLo, '#6f9a6a', { p: [0.1, 0.1, 0.05], s: [0.12, 0.05, 0.08] })]); }
function bottleGeo() { return combine([part(G.cyl8, '#bdeeff', { p: [0, 0, 0], r: [0, 0, Math.PI / 2], s: [0.17, 0.5, 0.17] }), part(G.cyl8, '#bdeeff', { p: [0.38, 0.02, 0], r: [0, 0, Math.PI / 2], s: [0.07, 0.22, 0.07] }), part(G.cyl8, '#b8845a', { p: [0.55, 0.02, 0], r: [0, 0, Math.PI / 2], s: [0.075, 0.06, 0.075] }), part(G.cyl8, '#fff2cc', { p: [-0.05, 0, 0], r: [0, 0, Math.PI / 2], s: [0.09, 0.38, 0.09] }), part(G.sphereLo, '#ffffff', { p: [0.04, 0.1, 0.08], s: [0.05, 0.04, 0.03] })]); }
function shellGeo() {
  const p = [part(G.sphere, '#ffd23a', { p: [0, 0.02, 0], s: [0.42, 0.14, 0.36] }), part(G.sphere, '#fff3a0', { p: [0, 0.1, 0], s: [0.3, 0.07, 0.26] })];
  for (let k = -3; k <= 3; k++) p.push(part(G.cyl6, '#e8a21a', { p: [Math.sin(k * 0.38) * 0.1, 0.12, -Math.cos(k * 0.38) * 0.1 + 0.02], r: [0, -k * 0.38, 0], s: [0.025, 0.04, 0.42] }));
  p.push(part(G.sphereLo, '#ffffff', { p: [0.1, 0.18, 0.1], s: [0.06, 0.03, 0.04] }));
  return combine(p);
}
function bootGeo() { return combine([part(B1, '#7a4e2e', { p: [0.12, -0.04, 0], s: [0.55, 0.2, 0.26] }), part(G.cyl8, '#8a5a36', { p: [-0.12, 0.2, 0], s: [0.16, 0.42, 0.16] }), part(B1, '#4a2e1a', { p: [0.14, -0.15, 0], s: [0.6, 0.06, 0.28] }), part(G.sphereLo, '#3f8a5a', { p: [-0.2, 0.42, 0.06], s: [0.16, 0.06, 0.1] }), part(G.sphereLo, '#3f8a5a', { p: [0.3, 0.02, 0.1], s: [0.12, 0.05, 0.07] })]); }
const GEO = { driftwood: driftwoodGeo, glimmerfin: () => fishGeo('glimmerfin'), bottle: bottleGeo, lanternkoi: () => fishGeo('lanternkoi'), shell: shellGeo, boot: bootGeo };
const SCALE = { driftwood: 2.1, glimmerfin: 2.2, bottle: 2.1, lanternkoi: 1.75, shell: 2.2, boot: 2.1 };         // (playtest: finds are drawn about as big as the hook's reach, so every kind reads from the stage camera, on a portrait phone too)

export function createCastWorld({ scene, sfx, particles, labels }) {
  const root = new THREE.Group();
  root.name = 'party-cast';
  root.position.set(centre.x, O.y, centre.z);
  root.visible = false;
  scene.add(root);
  const geos = [], mats = [];
  const living = stageLivingLifecycle({ root, id: 'cast', cam: CAM });

  // ---- the jetty (its top is the floor, y 0), the berths, lamp posts, rails, the sand behind with the bench pads, palms
  const base = [box(C.lanes[3] * 2 + 7.6, 0.3, 2.6, '#b98a5a', [0, -0.3, C.berthZ]), box(C.lanes[3] * 2 + 7.6, 0.06, 2.6, '#d4a46e', [0, -0.06, C.berthZ])];
  for (let k = -12; k <= 12; k++) base.push(box(0.05, 0.02, 2.62, '#8a5e36', [k * 1.1, 0.0, C.berthZ]));                                    // plank seams
  for (let k = -6; k <= 6; k++) { base.push(post(0.16, 1.4, '#6e4a2a', [k * 2.2, -1.5, C.berthZ - 1.15]), post(0.16, 1.4, '#6e4a2a', [k * 2.2, -1.5, C.berthZ + 1.15])); }
  C.lanes.forEach((lx, i) => { base.push(disc(1.45, '#f0c488', [lx, 0.02, C.berthZ], 0.04), ring(1.0, 1.4, LANE_TINT[i], [lx, 0.04, C.berthZ], 0.04)); });          // the berth pads you stand on
  [-12, -6, 0, 6, 12].forEach((x) => { base.push(post(0.1, 2.0, '#6e4a2a', [x, 0, C.berthZ - 1.2]), ball(0.2, '#ffd9a0', [x, 2.1, C.berthZ - 1.2])); });                  // lamp posts (the bulbs are lit by the glow mesh)
  base.push(box(C.lanes[3] * 2 + 7.6, 0.07, 0.07, '#8a5e36', [0, 0.8, C.berthZ + 1.2]));                                                                                  // a rail behind the berths
  C.lanes.forEach((lx, k) => base.push(disc(1.4, '#f2d6a2', [lx, 0.02, C.benchZ], 0.06)));                                                                                  // the bench pads on the sand
  // the far volcano and the lagoon's far shore
  base.push(part(G.cone6, '#5a2f5e', { p: [14, 4.2, -24], s: [11, 8.4, 11] }), part(G.cone6, '#7a3a5a', { p: [-17, 2.6, -25], s: [9, 5.2, 9] }), part(G.sphere, '#442a52', { p: [0, -0.5, -27], s: [34, 3, 3] }));
  // Bbui's little stage
  base.push(disc(1.7, '#4a3a6a', [BBUI.x, 0.35, BBUI.z], 0.35), disc(1.45, '#6a5a9a', [BBUI.x, 0.37, BBUI.z], 0.03), ring(1.1, 1.45, '#ffd85e', [BBUI.x, 0.39, BBUI.z], 0.03));
  const baseMesh = solid(base, { outline: 0.03 });
  baseMesh.name = 'cast-base';
  root.add(baseMesh); geos.push(baseMesh.geometry);

  // ---- the water: a deep base, the sunset glitter path, a faint tint per lane, buoys between lanes, the sun; one unlit glow mesh for everything bright
  const bright = [];
  bright.push(part(G.sphere, '#fff1a8', { p: [0, 3.2, -28], s: [6.4, 6.4, 0.3] }), part(G.sphere, '#ffc070', { p: [0, 3.2, -28.2], s: [9.0, 9.0, 0.3] }));      // the setting sun
  [-12, -6, 0, 6, 12].forEach((x) => bright.push(part(G.sphereLo, '#ffe9b0', { p: [x, 2.1, C.berthZ - 1.2], s: [0.14, 0.14, 0.14] })));                       // lamp bulbs
  for (let k = 0; k < 6; k++) bright.push(part(G.sphereLo, k % 2 ? '#ff7aa8' : '#8ff4ff', { p: [BBUI.x + Math.cos(k) * 1.2, 1.0 + (k % 3) * 0.3, BBUI.z + Math.sin(k) * 1.2], s: [0.1, 0.1, 0.1] }));       // sparkles round Bbui
  const brightMesh = glow(bright); brightMesh.name = 'cast-glow'; root.add(brightMesh); geos.push(brightMesh.geometry);
  const laneParts = [];
  C.lanes.forEach((lx, i) => laneParts.push(part(B1, LANE_TINT[i], { p: [lx, WATER_Y + 0.01, (waterZ(0) + waterZ(C.depthMax + 1.2)) / 2], s: [C.laneHalf * 2 - 0.2, 0.01, C.depthMax + 1.2] })));
  const lanes = glow(laneParts, { transparent: true, opacity: 0.2 }); lanes.name = 'cast-lanes'; lanes.renderOrder = 1; root.add(lanes); geos.push(lanes.geometry); mats.push(lanes.material);
  const buoyParts = [];
  for (let b = 0; b <= C.lanes.length; b++) { const bx = b === 0 ? C.lanes[0] - C.laneHalf - 0.05 : b === C.lanes.length ? C.lanes[3] + C.laneHalf + 0.05 : (C.lanes[b - 1] + C.lanes[b]) / 2; for (let k = 0; k < 6; k++) buoyParts.push(part(G.sphere, k % 2 ? '#ff5a4a' : '#fff4e0', { p: [bx, WATER_Y + 0.12, waterZ(0.4 + k * 1.75)], s: [0.16, 0.16, 0.16] })); }
  const buoys = solid(buoyParts, { outline: 0.02, cast: false }); root.add(buoys); geos.push(buoys.geometry);

  // ---- Bbui on her stage
  const bbui = createTdoongModel('yubbuibbui');
  bbui.root.scale.setScalar(TDOONGZ.yubbuibbui.scale);
  bbui.root.position.set(BBUI.x, 0.72, BBUI.z); bbui.root.rotation.y = Math.PI / 2;
  root.add(bbui.root);

  // ---- the instanced things: finds (one mesh per kind), markers (ring + dot), hooks, lines
  const mkInst = (geo, cap, mat = VERTEX_TOON) => { const m = new THREE.InstancedMesh(geo, mat, cap); m.count = 0; m.castShadow = false; m.frustumCulled = false; root.add(m); geos.push(geo); return m; };
  const finds = {};
  for (const k of Object.keys(GEO)) finds[k] = mkInst(GEO[k](), CAP[k]);
  const ringG = new THREE.RingGeometry(C.hookR - 0.13, C.hookR, 40); ringG.rotateX(-Math.PI / 2);
  const ringM = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending });
  const markers = mkInst(ringG, 4, ringM); markers.renderOrder = 4; mats.push(ringM);
  const dotG = new THREE.CircleGeometry(0.22, 16); dotG.rotateX(-Math.PI / 2);
  const dotM = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending });
  const dots = mkInst(dotG, 4, dotM); dots.renderOrder = 4; mats.push(dotM);
  const bobG = combine([part(G.cyl6, '#f4f1ff', { p: [0, 0.02, 0], s: [0.05, 0.16, 0.05] }), part(G.sphere, '#ff8a3c', { p: [0, 0.14, 0], s: [0.19, 0.12, 0.19] }), part(G.sphereLo, '#ffe08a', { p: [0, 0.2, 0], s: [0.08, 0.05, 0.08] })]);
  const bobs = mkInst(bobG, 4);
  const lineG = new THREE.CylinderGeometry(0.025, 0.025, 1, 5); lineG.translate(0, 0.5, 0);
  const lineM = new THREE.MeshBasicMaterial({ color: '#6ff3ff' });
  const lines = mkInst(lineG, 4, lineM); mats.push(lineM);
  const rings = mkInst(new THREE.RingGeometry(0.2, 0.32, 24).rotateX(-Math.PI / 2), 8, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.8, depthWrite: false })); mats.push(rings.material); rings.renderOrder = 5;   // splash rings
  const glintG = new THREE.PlaneGeometry(1, 1); glintG.rotateX(-Math.PI / 2);
  const glintM = new THREE.MeshBasicMaterial({ color: '#fff1b8', transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
  const glints = mkInst(glintG, 44, glintM); glints.renderOrder = 2; mats.push(glintM);
  const dropG = new THREE.SphereGeometry(0.09, 7, 5);
  const dropM = new THREE.MeshBasicMaterial({ color: '#eaf8ff', transparent: true, opacity: 0.85, depthWrite: false });
  const drops = mkInst(dropG, 140, dropM); drops.renderOrder = 6; mats.push(dropM);
  const fx = [];                                                                          // pooled droplets / bubbles: { x, y, z, vx, vy, vz, life, max, bubble }
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _d = new THREE.Vector3(), _col = new THREE.Color();
  const n = { driftwood: 0, glimmerfin: 0, bottle: 0, lanternkoi: 0, shell: 0, boot: 0, marker: 0, marker2: 0, bob: 0, ring: 0, drop: 0 };
  const put = (mesh, key, x, y, z, s = 1, ry = 0, rz = 0, sy = s, sx = s, sz = s) => {
    if (n[key] >= mesh.instanceMatrix.count) return;
    _q.setFromEuler(_e.set(0, ry, rz)); _p.set(x, y, z); _s.set(sx, sy, sz);
    mesh.setMatrixAt(n[key]++, _m.compose(_p, _q, _s));
  };

  // ---- per lane state: what the hook is doing, which events were already presented
  const lane = C.lanes.map(() => ({ n: 0, landed: true, reel: 0, last: null }));
  const yaws = new Map(), wakeT = new Map();                                                // per find: its eased heading; per fish: when its last bubble / wake ring was made
  let curDt = 0;
  const turn = (key, target) => { let y = yaws.has(key) ? yaws.get(key) : target; const d = ((target - y + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI; y += d * (1 - Math.exp(-9 * curDt)); yaws.set(key, y); return y; };
  function splashAt(x, z, n = 9, y = WATER_Y + 0.1) { for (let k = 0; k < n && fx.length < 140; k++) { const a = Math.random() * 6.283, sp = 1.2 + Math.random() * 1.6; fx.push({ x, y, z, vx: Math.cos(a) * sp * 0.5, vy: 2.6 + Math.random() * 2.2, vz: Math.sin(a) * sp * 0.5, life: 0, max: 0.7, bubble: false }); } ripple(x, z); }
  const splashes = [];                                                                  // { x, z, age }
  const hookPos = C.lanes.map(() => null), markerPos = C.lanes.map(() => ({ x: 0, y: 0, z: 0 }));
  const tip = new THREE.Vector3();
  const rodTip = (p, out) => {                                                          // the glowing tip of the party rod in the player's hand (else a guess in front of the player)
    const rod = p && p.parts && p.parts.handSocket && p.parts.handSocket.getObjectByName('party-rod');
    if (rod) { rod.updateWorldMatrix(true, false); return out.set(0.17, 1.1, 0).applyMatrix4(rod.matrixWorld).sub(_d.set(centre.x, O.y, centre.z)); }
    const px = p ? p.position.x - centre.x : 0, pz = p ? p.position.z - centre.z : 0, py = p ? p.position.y - O.y : 0;
    return out.set(px + 0.3, py + 1.9, pz - 0.9);
  };
  const ease = (u) => { const k = Math.max(0, Math.min(1, u)); return k * k * (3 - 2 * k); };
  let t0 = 0, lastMode = '', practice = null, lastReelSnd = 0, cheerUntil = -1;

  function ripple(x, z) { splashes.push({ x, z, age: 0 }); if (splashes.length > 8) splashes.shift(); }
  function laneFx(i, st, tm, p) {
    const L = lane[i];
    if (st.n !== L.n) { L.n = st.n; L.landed = st.n === 0; L.reel = 0; }
    if (!L.landed && tm >= st.land) {
      L.landed = true;
      const x = laneX(i), z = waterZ(st.d);
      splashAt(x, z, st.mode === 'reel' ? 12 : 8);
      if (st.mode === 'reel') { sfx?.play('hooked', { vol: 0.35, pitch: 0.95 + i * 0.05 }); labels?.label('Hooked!', wp(x, 2.9, C.berthZ), '#fff3a0'); }           // (the words sit above the berth, never over the hook)
      else { sfx?.play('splash', { vol: 0.22, pitch: 1.2 + i * 0.05 }); }
    }
    if (st.mode === 'reel' && st.count > L.reel) { if (L.reel === 0) splashAt(laneX(i), waterZ(st.d), 7); L.reel = st.count; if (tm - lastReelSnd > 0.035) { lastReelSnd = tm; sfx?.play('reelclick', { pitch: 0.9 + 0.7 * (st.count / Math.max(1, st.need)), vol: 0.14 }); } }
  }

  /** Draw one lane: finds drifting on it, the marker, the hook + line + a hooked find. `st` = the lane's state, `res` = { item: 'h' | 'd' }. */
  function drawLane(i, items, tm, st, res, p) {
    const lx = laneX(i);
    // the finds that are still on the water
    for (const it of items) {
      if (tm < it.t0 - 0.05) break;
      const code = res[it.i];
      if (code === 'd') continue;
      const pose = itemPose(it, tm);
      if (!pose.on) continue;
      if (code === 'h') continue;                                                       // (drawn on the line below)
      const x = lx + pose.x, z = waterZ(pose.d), bob = Math.sin(tm * 2.1 + it.ph) * 0.04, yaw = turn(`${i}:${it.i}`, yawFor(it.kind, velocityOf(it)));
      const edge = Math.max(0, Math.min(1, Math.min(pose.x + C.laneHalf + 0.2, C.laneHalf + 0.2 - pose.x) / 0.5));       // grows in / out at the lane's edges
      put(finds[it.kind], it.kind, x, WATER_Y + 0.1 + bob, z, SCALE[it.kind] * (0.4 + 0.6 * edge), yaw, Math.sin(tm * 1.6 + it.ph) * 0.1);
      if ((it.kind === 'glimmerfin' || it.kind === 'lanternkoi') && tm - (wakeT.get(`${i}:${it.i}`) || 0) > 0.28 && edge > 0.8) {        // a wake behind a swimming fish: a ring on the surface and a bubble that rises
        wakeT.set(`${i}:${it.i}`, tm); const tx = x - it.dir * 0.8 * SCALE[it.kind] * (it.kind === 'lanternkoi' ? 1.3 : 0.7);
        ripple(tx, z); if (fx.length < 140) fx.push({ x: tx, y: WATER_Y + 0.05, z: z + (Math.random() - 0.5) * 0.3, vx: -it.dir * 0.1, vy: 0.55, vz: 0, life: 0, max: 0.9, bubble: true });
      }
    }
    // the marker: only while this lane can cast (idle / the wait is over)
    const ready = st.mode !== 'reel' && tm >= st.readyAt;
    const md = markerDepth(tm);
    markerPos[i] = { x: lx, y: WATER_Y + 0.06, z: waterZ(md), ready };
    if (ready) { put(markers, 'marker', lx, WATER_Y + 0.07, waterZ(md), 1 + Math.sin(tm * 5) * 0.025); put(dots, 'marker2', lx, WATER_Y + 0.08, waterZ(md), 1); }
    // the hook
    hookPos[i] = null;
    const from = rodTip(p, tip);
    const landed = st.n > 0 && tm >= st.land, flying = st.n > 0 && tm < st.land && tm >= st.land - C.flight;
    const target = { x: lx, y: WATER_Y + 0.12, z: waterZ(st.d) };
    let hx = 0, hy = 0, hz = 0, show = false;
    if (flying) { const u = (tm - (st.land - C.flight)) / C.flight; hx = from.x + (target.x - from.x) * u; hz = from.z + (target.z - from.z) * u; hy = from.y + (target.y - from.y) * u + Math.sin(u * Math.PI) * 1.6; show = true; }
    else if (st.mode === 'reel' && landed) {
      const prog = ease(st.count / Math.max(1, st.need));
      hx = target.x + (from.x - target.x) * prog; hz = target.z + (from.z - target.z) * prog; hy = target.y + (from.y - target.y) * prog * prog + Math.sin(prog * Math.PI) * 0.5; show = true;
      const it = items[st.item];
      if (it) { const w = Math.sin(tm * 14) * 0.05 * (1 - prog); put(finds[it.kind], it.kind, hx + w, hy - 0.12, hz, SCALE[it.kind] * (1 - 0.3 * prog), turn(`${i}:${it.i}`, yawFor(it.kind, velocityOf(it))), Math.sin(tm * 9) * 0.35); }
    } else if (st.mode === 'wait' && st.last === 'miss' && landed) {
      const back = (tm - (st.readyAt - 0.35)) / 0.35;                                  // the empty hook sits in the water, then is pulled home just before the next cast
      const prog = ease(back);
      hx = target.x + (from.x - target.x) * prog; hz = target.z + (from.z - target.z) * prog; hy = target.y + (from.y - target.y) * prog; show = true;
      if (prog >= 1) show = false;
    }
    if (!show && ready) { hx = lx; hy = WATER_Y + 0.12 + Math.sin(tm * 2.3 + i) * 0.03; hz = waterZ(1.1); show = true; }       // the line is out: the bobber rests near the jetty until a press strikes
    if (show) {
      hookPos[i] = { x: hx, y: hy, z: hz }; lane[i].last = hookPos[i];
      put(bobs, 'bob', hx, hy, hz, 1);
      _d.set(hx - from.x, hy - from.y, hz - from.z); const len = _d.length() || 0.001;
      _q.setFromUnitVectors(_up, _d.multiplyScalar(1 / len));
      _p.set(from.x, from.y, from.z); _s.set(1, len, 1);
      if (lines.count < 4) { lines.setMatrixAt(lines.count++, _m.compose(_p, _q, _s)); }
    }
  }

  function update(dt, { mode = 'wait', v = null, t = 0, lanePlayers = [] } = {}) {
    if (!root.visible) return;
    t0 += dt; curDt = dt;
    if (mode !== lastMode) { lastMode = mode; practice = null; for (const L of lane) { L.n = 0; L.landed = true; L.reel = 0; } splashes.length = 0; fx.length = 0; yaws.clear(); wakeT.clear(); }
    for (const k of Object.keys(n)) n[k] = 0;
    lines.count = 0;
    let items = null, tm = 0, sts = null, ress = null;
    if (mode === 'play' && v) { items = v.items; tm = t; sts = (i) => v.st[v.slots[i]]; ress = (i) => v.res[v.slots[i]] || {}; }
    else if (mode === 'practice') {
      if (!practice || t0 - practice.start > 24) practice = { start: t0, g: castInit(777, [0, 1, 2, 3].map((slot) => ({ slot }))) };
      tm = t0 - practice.start;
      for (const r of castStep(practice.g, { t: tm }, dt, tm)) castApply(practice.g, r);
      items = buildItems(777); sts = (i) => practice.g.st[i]; ress = (i) => practice.g.res[i] || {};
      practice.tm = tm;
    }
    if (items) {
      for (let i = 0; i < C.lanes.length; i++) {
        const st = sts(i); if (!st) continue;
        const p = lanePlayers[i] || null;
        laneFx(i, st, tm, p);
        drawLane(i, items, tm, st, ress(i), p);
      }
    }
    // the surface: glints drift across the lanes in the sunset light and twinkle; pooled droplets / bubbles
    for (let k = 0; k < 44; k++) { const u = k * 0.6180339 % 1, w = 30, x = ((u * w + t0 * (0.35 + (k % 5) * 0.08) + k * 3.1) % w) - w / 2, z = C.edgeZ - 1.0 - ((k * 0.37) % 1) * 11.5, tw = 0.5 + 0.5 * Math.sin(t0 * (1.6 + (k % 4) * 0.5) + k * 2.3); _q.identity(); _p.set(x, WATER_Y + 0.03, z); _s.set(0.5 + tw * 1.1, 1, 0.07 + 0.05 * tw); glints.setMatrixAt(k, _m.compose(_p, _q, _s)); }
    glints.count = 44; glints.instanceMatrix.needsUpdate = true;
    n.drop = 0;
    for (let k = fx.length - 1; k >= 0; k--) {
      const f = fx[k]; f.life += dt; if (f.life >= f.max) { fx.splice(k, 1); continue; }
      if (!f.bubble) f.vy -= 9 * dt; f.x += f.vx * dt; f.y += f.vy * dt; f.z += f.vz * dt;
      if (!f.bubble && f.y < WATER_Y) { fx.splice(k, 1); continue; }
      const u = 1 - f.life / f.max; _q.identity(); _p.set(f.x, f.y, f.z); const sc = f.bubble ? 0.7 * u + 0.3 : 0.6 + 0.7 * u; _s.set(sc, sc, sc); if (n.drop < 140) drops.setMatrixAt(n.drop++, _m.compose(_p, _q, _s));
    }
    drops.count = n.drop; drops.instanceMatrix.needsUpdate = true;
    // splash rings
    for (let k = splashes.length - 1; k >= 0; k--) {
      const s = splashes[k]; s.age += dt;
      if (s.age > 0.8) { splashes.splice(k, 1); continue; }
      const u = s.age / 0.8; put(rings, 'ring', s.x, WATER_Y + 0.08, s.z, 1 + u * 3.2);
    }
    rings.material.opacity = 0.8;
    for (const [k, mesh] of Object.entries({ ...finds, bob: bobs, ring: rings, marker: markers })) { mesh.count = n[k === 'marker' ? 'marker' : k] || 0; mesh.instanceMatrix.needsUpdate = true; }
    dots.count = n.marker2 || 0; dots.instanceMatrix.needsUpdate = true; lines.instanceMatrix.needsUpdate = true;
    // Bbui: chic and still, with a tiny sway; she claps when a find lands
    bbui.rig.position.y = Math.sin(t0 * 1.8) * 0.02;
    bbui.armR.rotation.x = -0.15 + Math.sin(t0 * 2.4) * 0.05; bbui.armL.rotation.x = Math.sin(t0 * 2.1 + 1) * 0.05;
    bbui.setExpression?.('happy');
    // Bbui poses between finds (a hand on her hip, a tilt of the head) and cheers when somebody lands one; the head follows whoever leads (hostIdle).
    const pose = (t0 % 9.5) > 7.2 ? Math.sin(Math.min(1, ((t0 % 9.5) - 7.2) / 0.4) * Math.PI / 2) * (1 - Math.max(0, ((t0 % 9.5) - 9.1) / 0.4)) : 0;
    bbui.armL.rotation.x = bbui.armL.rotation.x * (1 - pose) + -0.8 * pose; bbui.armL.rotation.z = (bbui.armL.rotation.z || 0) * (1 - pose) + 0.55 * pose;
    if (t0 < cheerUntil) { bbui.armR.rotation.x = -2.6 + Math.sin(t0 * 14) * 0.25; bbui.armL.rotation.x = -2.5 + Math.sin(t0 * 14 + 1) * 0.25; bbui.rig.position.y += Math.abs(Math.sin(t0 * 9)) * 0.12; }
    hostIdle(bbui, t0, mode === 'play' && v ? { totals: v.score, done: v.done } : null, lanePlayers);
    living.update(dt, t0, lanePlayers);
  }

  /** A practice press: the SAME request / apply as the game on a scratch lane (lane i): a strike while the line rests, a reel pull once something is hooked; nothing scores. */
  function practicePress(i, p) {
    if (!practice) return null;
    const out = castRequest(practice.g, i, { t: practice.tm }, { t: practice.tm, slack: PARTY.slack, lag: 0 });
    if (!out.rec) return null;
    castApply(practice.g, out.rec);
    return true;
  }

  return {
    root, update, practicePress, cam: CAM, look: 'sunset',
    get living() { return living.current; },
    setVisible(on) {
      living.setVisible(on);
      root.visible = !!on;
      if (!on) { labels?.clear?.(); lastMode = ''; practice = null; for (const mesh of [...Object.values(finds), markers, dots, bobs, lines, rings, drops]) mesh.count = 0; fx.length = 0; splashes.length = 0; for (const L of lane) { L.n = 0; L.landed = true; L.reel = 0; } }
    },
    onRec(rec, v, who) {
      if (!root.visible || !v || rec.slot === undefined) return;
      const i = v.slots.indexOf(rec.slot), p = who ? who(rec.slot) : null;
      if (i < 0) return;
      if (rec.k === 'cast') sfx?.play('castline', { vol: 0.3, pitch: 0.95 + i * 0.05 });                  // (a strike: the line zips out to the ring)
      else if (rec.k === 'catch') {
        const it = v.items[rec.i], pos = wp(laneX(i), 2.9, C.berthZ), L = lane[i];
        if (L.last) splashAt(L.last.x, L.last.z, 10, Math.max(WATER_Y + 0.1, L.last.y));                        // the find leaves the water with a splash
        const big = it.kind === 'shell' || it.kind === 'lanternkoi';
        particles?.burst('sparkle', pos, { count: it.kind === 'boot' ? 3 : big ? 14 : 6, radius: 0.5, height: 0.4, color: it.kind === 'shell' ? '#ffe27a' : '#ffffff' });
        if (it.kind === 'boot') { sfx?.play('blah', { vol: 0.5 }); labels?.label('Blah!', pos, '#d8c0a0'); }
        else { sfx?.play(it.kind === 'shell' ? 'golden' : 'chime', { pitch: it.kind === 'shell' ? 1 : 0.9 + rec.pts * 0.06, vol: it.kind === 'shell' ? 0.8 : 0.5 }); labels?.label(`+${rec.pts}${big ? '!' : ''}`, pos, it.kind === 'shell' ? '#ffe27a' : '#ffffff'); }
        if (p && p.swing) p.swing();
        cheerUntil = t0 + (it.kind === 'boot' ? 0.4 : 1.1);
      }
    },
    scoreText(v, slot) { return v ? { text: `${v.score[slot] ?? 0}`, out: false } : { text: '', out: false }; },
    clearPractice() { practice = null; },
    hookDraw: (i) => (hookPos[i] ? { x: centre.x + hookPos[i].x, y: O.y + hookPos[i].y, z: centre.z + hookPos[i].z } : null),
    markerDraw: (i) => ({ x: centre.x + markerPos[i].x, y: O.y + markerPos[i].y, z: centre.z + markerPos[i].z, ready: markerPos[i].ready }),
    findDraws(kind) { const out = [], m = finds[kind], mt = new THREE.Matrix4(), pp = new THREE.Vector3(); for (let k = 0; k < m.count; k++) { m.getMatrixAt(k, mt); pp.setFromMatrixPosition(mt); out.push({ x: centre.x + pp.x, y: O.y + pp.y, z: centre.z + pp.z }); } return out; },
    findHeadings(kind) { const out = [], m = finds[kind], mt = new THREE.Matrix4(); for (let k = 0; k < m.count; k++) { m.getMatrixAt(k, mt); const e = mt.elements, f = FORWARD[kind]; out.push({ x: centre.x + e[12], z: centre.z + e[14], fx: f * e[0], fz: f * e[2] }); } return out; },
    dropCount: () => drops.count, glintCount: () => glints.count,
    counts: () => ({ ...n }),
    summary() { let calls = 0; root.traverse((o) => { if (o.isMesh && o.visible) calls++; }); return { visible: root.visible, meshes: calls, ...n }; },
    dispose() { if (root.userData.disposed) return; root.userData.disposed = true; living.dispose(); { const all = new Set(geos), own = new Set(); bbui.root.traverse((o) => { if (o.geometry) own.add(o.geometry); }); root.traverse((o) => { if (o.geometry && !own.has(o.geometry)) all.add(o.geometry); }); for (const g of all) if (!own.has(g)) g.dispose(); } for (const m of mats) m.dispose(); bbui.dispose?.(); scene.remove(root); },
  };
}
