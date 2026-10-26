// Bonk Burrows' stage (Step 81b): a round molehill meadow beside the home bridge landing. Cobble the mole stands on the bridge stub at the back and drops his giant striped squeaky toy mallet on the meadow. Each slam shows
// as a growing shadow (a faint full-size ring from the start, a dark disc that grows to it, and a red ring for the CORE where you are always squashed); the mallet falls in the last moments and lands exactly on it. Six
// molehills block walking (colliders). Two little grassy islets across the stream are where squashed players pop up. Built once (lazily), hidden outside the game; ONE Group at the stage centre.
//
// WHAT YOU SEE IS WHAT IS JUDGED: the faint ring is the circle of radius `hitR` the host compares a body's position with; the mallet head is a cylinder of exactly that radius; the red ring has radius `core` x hitR; the
// shadow disc reaches `hitR` at the landing time T; the molehills are drawn at bonkObstacles() with their collider radius as their footprint.
//
//   const w = createBonkWorld({ scene, sfx, particles, labels })
//   w.setVisible(on)         w.update(dt, { mode: 'practice' | 'wait' | 'play', v, t, who, lanePlayers })     v = bonkLogic.view(g, t); 'practice' runs a scratch game (the first singles) on the REAL positions of the players
//   w.onRec(rec, v, who)     presentation of a record: a squashed player (a squeak and a word)      w.practicePress(i, p) -> true | null     a hop in the how-to: the SAME request / apply on the scratch game
//   w.scoreText(v, slot) -> { text, out }      w.cam      w.look ('day')      w.clearPractice()      w.shadowDraw(i) -> { x, z, r, core, u } the drawn shadow of slam i      w.malletDraw(i) -> { x, z, y, r }
// Draw calls: base 1 (+outline), shadows rings 1 + discs 1, mallets 1, Cobble ~8; about 15.
import * as THREE from 'three';
import { PARTY } from '../../config.js';
import { stageCentre } from '../../game/party/partyArea.js';
import { buildPlan, view as bView, init as bInit, step as bStep, apply as bApply, request as bRequest, ease, HILLS, coreR, ID } from '../../game/party/bonkLogic.js';
import { createNpcModel } from '../../npc/models.js';
import { part, G, VERTEX_TOON, combine } from '../../render/geo.js';
import { solid, disc, ring, box, post, ball } from './kit.js';
import { stageLivingLifecycle, hostIdle } from './livingStage.js';

const B = PARTY.bonk, O = PARTY.origin;
const centre = stageCentre(ID);
export const CAM = { focus: { x: centre.x, y: O.y + 0.2, z: centre.z + 1.0 }, offset: { x: 0, y: 25, z: 13 }, extent: { w: 26, d: 25 } };
const COBBLE = { x: 0, z: -12.6 };
const CAP = 14, HEAD_H = 1.4, FALL_H = 17, HANDLE = 20;
const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const wp = (x, y, z) => ({ x: centre.x + x, y: O.y + y, z: centre.z + z });

/** The mallet: a striped cylinder head of EXACTLY radius hitR (pink and cream wedges, also on the top and bottom faces), a wooden handle going up out of the picture and a yellow squeaker bulb on its end. The origin is the head's bottom. */
function malletGeo() {
  const R = B.hitR, parts = [];
  for (let k = 0; k < 16; k++) parts.push(part(new THREE.CylinderGeometry(1, 1, 1, 1, 1, false, k * Math.PI / 8, Math.PI / 8), k % 2 ? '#fff0d8' : '#ff7fb0', { p: [0, HEAD_H / 2, 0], s: [R, HEAD_H, R] }));
  parts.push(part(G.cyl8, '#c9a06a', { p: [0, HEAD_H + HANDLE / 2 - 0.2, 0], s: [0.3, HANDLE, 0.3] }), part(G.sphere, '#ffd23a', { p: [0, HEAD_H + HANDLE, 0], s: [0.75, 0.75, 0.75] }));
  parts.push(part(G.sphereLo, '#ffd23a', { p: [R * 0.9, HEAD_H / 2, 0], s: [0.2, 0.2, 0.2] }));        // the squeaker button on the side (inside the head's radius)
  return combine(parts);
}

export function createBonkWorld({ scene, sfx, particles, labels }) {
  const root = new THREE.Group();
  root.name = 'party-bonk';
  root.position.set(centre.x, O.y, centre.z);
  root.visible = false;
  scene.add(root);
  const geos = [], mats = [];
  const R = B.meadowR, HR = B.hitR;
  const living = stageLivingLifecycle({ root, id: 'bonk', cam: CAM });

  // ---- the stream, the meadow, the molehills, the islets, the bridge stub, trees and reeds
  const base = [];                                                                // (the meadow, its irregular bank, the stream and the land round it are the living pass: livingStage.js / living82d.js)
  const bits = [];
  for (const h of HILLS) {
    base.push(ball(h.r, '#a9743f', [h.x, 0, h.z], [1, 0.55, 1]), disc(h.r * 0.45, '#3c2614', [h.x + h.r * 0.1, 0.5 * h.r, h.z + h.r * 0.1], 0.03));
    for (let k = 0; k < 3; k++) { const a = k * 2.1 + h.x; base.push(ball(0.2, '#c88c52', [h.x + Math.cos(a) * h.r * 1.15, 0.05, h.z + Math.sin(a) * h.r * 1.15], [1, 0.5, 1])); }
  }
  for (const p of B.patches) base.push(disc(B.patchR, '#82df5c', [p.x, 0.08, p.z], 0.4), disc(B.patchR + 0.25, '#c9a06a', [p.x, 0.05, p.z], 0.3), ring(0.5, 0.7, '#fff3a0', [p.x - 0.8, 0.09, p.z], 0.02), ring(0.5, 0.7, '#fff3a0', [p.x + 0.8, 0.09, p.z], 0.02));
  // the home bridge landing at the back: planks across the stream, posts, a sign
  for (let k = 0; k < 9; k++) base.push(box(3.2, 0.18, 0.62, k % 2 ? '#c98a56' : '#b57a4e', [COBBLE.x, 0.05, -R + 0.1 - k * 0.7]));
  for (const sx of [-1.7, 1.7]) for (let k = 0; k < 4; k++) base.push(post(0.12, 1.1, '#8a5a3c', [COBBLE.x + sx, 0.1, -R - 0.2 - k * 1.7]));
  base.push(box(3.4, 0.14, 0.14, '#8a5a3c', [0, 1.0, -R - 0.2]), box(2.2, 0.8, 0.12, '#f4e2c8', [-3.9, 1.4, -15.4]), post(0.1, 1.4, '#8a5a3c', [-3.9, 0, -15.4]));          // (the sign stands on the far bank now)
  // Clover and daisy clumps in tight little groups (bright and light, never darker than the grass: nothing on the meadow may look like a shadow). The grass, the stream, the trees and the reeds are the living pass.
  for (let c = 0; c < 12; c++) {
    const a = c * 2.399 + 0.4, r = 2.2 + hash(c) * 6.8, cx = Math.cos(a) * r, cz = Math.sin(a) * r;
    if (HILLS.some((h) => Math.hypot(cx - h.x, cz - h.z) < h.r + 1.2)) continue;
    for (let k = 0; k < 5; k++) {
      const fa = k * 2.1 + c, fr = 0.12 + hash(c * 9 + k) * 0.5, x = cx + Math.cos(fa) * fr, z = cz + Math.sin(fa) * fr;
      if (k % 2) base.push(part(G.sphereLo, '#aef27a', { p: [x, 0.06, z], s: [0.1, 0.03, 0.1] }), part(G.sphereLo, '#c4f896', { p: [x + 0.08, 0.075, z + 0.03], s: [0.07, 0.025, 0.07] }));
      else base.push(part(G.sphereLo, '#ffffff', { p: [x, 0.07, z], s: [0.13, 0.04, 0.13] }), part(G.sphereLo, '#ffd23a', { p: [x, 0.1, z], s: [0.06, 0.04, 0.06] }));
    }
  }
  const baseMesh = solid(base, { outline: 0.03, cast: false });                  // (the molehills cast nothing: no scenery shadow may fall on the meadow)
  baseMesh.name = 'bonk-base';
  root.add(baseMesh); geos.push(baseMesh.geometry);

  // ---- Cobble the mole on the bridge stub
  const cobble = createNpcModel('mole');
  cobble.root.scale.setScalar(1.3);
  cobble.root.traverse((o) => { if (o.isMesh) o.castShadow = false; });          // (his shadow must not fall on the meadow either)
  cobble.root.position.set(COBBLE.x, 0.2, COBBLE.z + 0.3); cobble.root.rotation.y = 0;
  root.add(cobble.root);

  // ---- the shadows: ONE ring mesh (the faint full-size ring + the red core ring) and ONE disc mesh that grows to the ring
  const ringG = combine([part(new THREE.RingGeometry(HR - 0.14, HR, 56).rotateX(-Math.PI / 2), '#ffe6a0'), part(new THREE.RingGeometry(coreR() - 0.1, coreR(), 40).rotateX(-Math.PI / 2), '#ff3b3b', { p: [0, 0.005, 0] })]);
  const ringM = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false });
  const rings = new THREE.InstancedMesh(ringG, ringM, CAP); rings.frustumCulled = false; rings.renderOrder = 3; rings.name = 'bonk-rings'; root.add(rings); geos.push(ringG); mats.push(ringM);
  const fillG = new THREE.CircleGeometry(1, 48); fillG.rotateX(-Math.PI / 2); geos.push(fillG);
  const fillM = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.62, depthWrite: false });
  const fills = new THREE.InstancedMesh(fillG, fillM, CAP); fills.frustumCulled = false; fills.renderOrder = 2; fills.name = 'bonk-fills'; root.add(fills); mats.push(fillM);
  for (let i = 0; i < CAP; i++) fills.setColorAt(i, new THREE.Color('#6a2a9a'));
  // ---- the mallets
  const mG = malletGeo(); geos.push(mG);
  const mallets = new THREE.InstancedMesh(mG, VERTEX_TOON, CAP); mallets.frustumCulled = false; mallets.name = 'bonk-mallets'; mallets.castShadow = false; mallets.receiveShadow = false; root.add(mallets);
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _c = new THREE.Color();
  const HIDE = new THREE.Matrix4().makeScale(0, 0, 0);
  const drawn = [];                                                                  // per slot of the pool: { i (slam), x, z, r, core, u, y }
  const landed = new Set();

  let t0 = 0, lastMode = '', practice = null, swing = 0, busyNow = false, cheerUntil = -1;

  function present(slams, t, quiet) {
    const n = Math.min(CAP, slams.length);
    busyNow = slams.some((s) => s.phase === 'warn');
    drawn.length = 0;
    for (let k = 0; k < CAP; k++) {
      const s = slams[k];
      if (k >= n || !s) { rings.setMatrixAt(k, HIDE); fills.setMatrixAt(k, HIDE); mallets.setMatrixAt(k, HIDE); continue; }
      const warn = s.phase === 'warn', fade = warn ? 1 : Math.max(0, 1 - (t - s.T) / 0.3);
      _q.identity();
      const ringS = fade > 0 ? 1 : 0;
      _p.set(s.x, 0.04, s.z); _s.set(ringS, 1, ringS); _m.compose(_p, _q, _s); rings.setMatrixAt(k, _m);
      const fr = HR * (0.1 + 0.9 * s.u) * (fade > 0 ? 1 : 0);                                  // (a small dark dot at the start, the full circle at the landing)
      _p.set(s.x, 0.03, s.z); _s.set(fr, 1, fr); _m.compose(_p, _q, _s); fills.setMatrixAt(k, _m);
      fills.setColorAt(k, _c.set('#6a2a9a').lerp(new THREE.Color('#ff4a3a'), s.u * s.u));
      // the mallet: out of sight above until the last `fall` s, then a fast drop; it rests, squashes a little, and goes back up
      const q = (t - (s.T - B.fall)) / B.fall;
      let y, sy = 1;
      if (q <= 0) y = -1;
      else if (t < s.T) y = FALL_H * (1 - q) * (1 - q);
      else { const a = t - s.T; y = a < 0.4 ? 0 : FALL_H * ease((a - 0.4) / 0.4); sy = a < 0.14 ? 0.82 + 0.18 * (a / 0.14) : 1; }
      if (y < 0) mallets.setMatrixAt(k, HIDE);
      else { _p.set(s.x, y, s.z); _s.set(1, sy, 1); _m.compose(_p, _q, _s); mallets.setMatrixAt(k, _m); }
      drawn.push({ i: s.i, x: s.x, z: s.z, r: HR, core: coreR(), u: s.u, y, visible: y >= 0 });
      if (!quiet && t >= s.T && !landed.has(s.i)) {
        landed.add(s.i);
        sfx?.play('malletthump', { vol: 0.7 }); sfx?.play('malletsqueak', { vol: 0.5, pitch: 0.9 + hash(s.i) * 0.5 });
        particles?.burst('puff', wp(s.x, 0.3, s.z), { count: 10, radius: HR * 0.75, height: 0.5, size: 1.4, color: '#e0cda0' });
        particles?.burst('sparkle', wp(s.x, 0.6, s.z), { count: 5, radius: HR * 0.5, height: 0.6, color: '#fff3a0' });
        living.api.crumble?.(s.x, s.z); cheerUntil = t0 + 0.5;
      }
    }
    rings.instanceMatrix.needsUpdate = true; fills.instanceMatrix.needsUpdate = true; mallets.instanceMatrix.needsUpdate = true;
    if (fills.instanceColor) fills.instanceColor.needsUpdate = true;
    // Cobble raises his arms while a shadow is about to land and swings down with it
    const soon = slams.some((s) => s.phase === 'warn' && s.T - t < 0.9), want = soon ? 1 : 0;
    swing = damp(swing, want, soon ? 7 : 12, 1 / 60);
    cobble.armL.rotation.x = -2.8 * swing; cobble.armR.rotation.x = -2.8 * swing;
    cobble.armL.rotation.z = (cobble.armL.userData.restZ ?? 0.2) + 0.2 * swing; cobble.armR.rotation.z = (cobble.armR.userData.restZ ?? -0.2) - 0.2 * swing;
  }

  const PRACTICE_SEED = 4242, PRACTICE_LEN = 13;
  const newPractice = () => ({ g: bInit(PRACTICE_SEED, [0, 1, 2, 3].map((slot) => ({ slot }))), t: 0, redo: {} });

  function update(dt, { mode = 'wait', v = null, t = 0, who = null, lanePlayers = [] } = {}) {
    if (!root.visible) return;
    t0 += dt;
    if (mode !== lastMode) { lastMode = mode; practice = null; landed.clear(); }
    if (mode === 'play' && v) present(v.slams, v.t, false);
    else if (mode === 'practice') {
      if (!practice || practice.t > PRACTICE_LEN) { practice = newPractice(); landed.clear(); }
      practice.t += dt;
      const pos = (slot) => { const p = lanePlayers[slot]; return p && p.position ? { x: p.position.x, z: p.position.z } : null; };
      for (const r of bStep(practice.g, { pos }, dt, practice.t)) {
        bApply(practice.g, r);
        if (r.k === 'bonk') for (const slot of r.out) { practice.redo[slot] = practice.t + 1.4; flash(lanePlayers[slot]); }
      }
      for (const slot of Object.keys(practice.redo)) if (practice.t > practice.redo[slot]) { practice.g.alive[slot] = true; delete practice.redo[slot]; }       // (rehearsal: nobody is out)
      practice.g.done = false;
      present(bView(practice.g, practice.t).slams, practice.t, false);
    } else present([], t, true);
    const lit = mode === 'play' && v && v.slams.length;
    cobble.rig.position.y = Math.sin(t0 * 2.2) * 0.02 + (lit ? 0.03 : 0);
    cobble.headGroup.rotation.x = damp(cobble.headGroup.rotation.x, lit ? -0.15 : 0.05, 4, dt);
    if (t0 < cheerUntil) cobble.rig.position.y += Math.abs(Math.sin(t0 * 14)) * 0.12;                                  // a little hop when a mallet lands
    hostIdle(cobble, t0, mode === 'play' && v ? { alive: v.alive, done: v.done } : null, lanePlayers);
    living.update(dt, t0, lanePlayers, { busy: busyNow });
  }
  function flash(p) {
    if (!p || !p.position) return;
    labels?.label('Squish!', { x: p.position.x, y: p.position.y + 2.1, z: p.position.z }, '#ffd0d0');
    sfx?.play('malletsqueak', { vol: 0.5, pitch: 1.4 });
  }

  return {
    root, update, cam: CAM, look: 'day',
    get living() { return living.current; },
    setVisible(on) {
      living.setVisible(on);
      root.visible = !!on;
      if (!on) { labels?.clear?.(); lastMode = ''; practice = null; landed.clear(); present([], 0, true); }
    },
    onRec(rec, v, who) {
      if (!root.visible || rec.k !== 'bonk' || !rec.out.length) return;
      for (const slot of rec.out) flash(who ? who(slot) : null);
    },
    /** A hop in the how-to: the SAME request / apply on the scratch game. */
    practicePress(i, p) {
      if (!practice) return null;
      const out = bRequest(practice.g, i, { t: practice.t }, { t: practice.t, slack: PARTY.slack, lag: 0 });
      if (!out.rec) return null;
      bApply(practice.g, out.rec);
      return true;
    },
    scoreText(v, slot) { return v ? (v.alive[slot] ? { text: 'Safe', out: false } : { text: 'Squished', out: true }) : { text: '', out: false }; },
    clearPractice() { practice = null; landed.clear(); },
    shadowDraw: (k) => drawn[k] || null,
    drawnSlams: () => drawn.map((d) => ({ ...d })),
    malletDraw: (k) => (drawn[k] ? { x: drawn[k].x, z: drawn[k].z, y: drawn[k].y, r: HR } : null),
    counts: () => ({ drawn: drawn.length }),
    summary() { let calls = 0; root.traverse((o) => { if (o.isMesh && o.visible) calls++; }); return { visible: root.visible, meshes: calls, drawn: drawn.length }; },
    dispose() { if (root.userData.disposed) return; root.userData.disposed = true; living.dispose(); { const all = new Set(geos), own = new Set(); cobble.root.traverse((o) => { if (o.geometry) own.add(o.geometry); }); root.traverse((o) => { if (o.geometry && !own.has(o.geometry)) all.add(o.geometry); }); for (const g of all) if (!own.has(g)) g.dispose(); } for (const m of mats) m.dispose(); cobble.dispose?.(); scene.remove(root); },
  };
}
