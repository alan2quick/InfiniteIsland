// Tilty Tiles' stage (Step 81b): the home picnic lawn with four big wooden picture frames in a 2 x 2 layout, one per seat, each balanced on a centre post so it can tip. A frame is a flat pixel-mosaic picture (an island
// postcard, Im Nabong, Mokuring, Capray) inside a raised wooden rim, covered by a 5 x 4 grid of loose wooden tiles; its coconut rolls on the picture. Park Zyoni cheers from a little star pedestal in the middle of the
// cross between the frames. Built once (lazily), hidden outside the game; ONE Group at the stage centre.
//
// WHAT YOU SEE IS WHAT IS JUDGED: a frame's group is tipped so its surface is exactly the plane tiltLogic.planeHeight describes (the group's up axis = planeNormal), and everything in it uses the frame's LOCAL
// plane coordinates, the same numbers as the rules: the tile i is a box of side `tile` at tileCentre(i), the coconut is a sphere of radius `ballR` at its (x, z), the rim's inside face is at the inner half extent. A tile
// flies off in the very update in which its bit appears in the state (the host sets it when the coconut's circle touches the tile's square). The coconut rolls: its rotation is integrated from its drawn travel / radius.
//
//   const w = createTiltyWorld({ scene, sfx, particles, labels })
//   w.setVisible(on)         w.update(dt, { mode: 'practice' | 'wait' | 'play', v, t, who, lanePlayers })     v = tiltyLogic.view(g, t); 'practice' runs a scratch game with the REAL positions of the players on their frames
//   w.onRec(rec, v, who)     presentation of a record (sounds come from the update, which sees every new tile bit)     w.tilts() -> [{ x, z }] the tilt drawn now (the runtime lends it to the floor under the feet)
//   w.scoreText(v, slot) -> { text, out }      w.cam      w.look ('day')      w.clearPractice()      w.tileDraw(f, i) -> { x, z, half, popped }      w.ballDraw(f) -> { x, y, z, r }      w.counts()
// Draw calls: base 1 (+outline), 4 frames (+outlines), 4 pictures, 4 tile meshes, 4 coconuts (+outlines), Zyoni ~9; about 35.
import * as THREE from 'three';
import { PARTY, TDOONGZ } from '../../config.js';
import { stageCentre, tiltyBoards } from '../../game/party/partyArea.js';
import { init as tInit, step as tStep, apply as tApply, view as tView, tileCentre, TILES, FULL, ID } from '../../game/party/tiltyLogic.js';
import { planeNormal, rollQuaternion } from '../../game/tiltLogic.js';
import { createTdoongModel } from '../../npc/tdoongz.js';
import { part, G, VERTEX_TOON, combine, makeOutline } from '../../render/geo.js';
import { solid, disc, ring, box, post, ball } from './kit.js';
import { stageLivingLifecycle, hostIdle } from './livingStage.js';

const T = PARTY.tilty, O = PARTY.origin;
const centre = stageCentre(ID);
export const CAM = { focus: { x: centre.x, y: O.y + 1.4, z: centre.z + 1.5 }, offset: { x: 0, y: 25, z: 12.5 }, extent: { w: 27.5, d: 23 } };
const WOOD = '#b57a4e', WOOD_DARK = '#8a5a3c', GOLD = '#ffd85e';
const TILE_H = 0.22, RIM_H = 0.5;
const PX = 30, PY = 24;                                                                // the picture's mosaic (6 x 6 pixels per tile)
const UP = new THREE.Vector3(0, 1, 0);
const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const inE = (u, v, cx, cy, rx, ry) => ((u - cx) / rx) ** 2 + ((v - cy) / ry) ** 2 <= 1;
const mix = (a, b, k) => { const A = new THREE.Color(a), B = new THREE.Color(b); return '#' + A.lerp(B, Math.max(0, Math.min(1, k))).getHexString(); };

// ---- the four pictures: functions of (u, v) in 0..1 (v = 0 at the back edge) -> a colour
const PICTURES = [
  (u, v) => {                                                                          // an island postcard
    const sea = v > 0.58;
    if (inE(u, v, 0.8, 0.2, 0.085, 0.11)) return '#ffe27a';
    if (inE(u, v, 0.8, 0.2, 0.12, 0.15)) return '#fff3b8';
    if (inE(u, v, 0.26, 0.22, 0.13, 0.05) || inE(u, v, 0.32, 0.18, 0.08, 0.05)) return '#ffffff';
    if (Math.abs(u - 0.45) < 0.014 && v > 0.36 && v < 0.6) return '#8a5a3c';
    if (inE(u, v, 0.45, 0.34, 0.1, 0.06) || inE(u, v, 0.38, 0.38, 0.07, 0.035) || inE(u, v, 0.53, 0.38, 0.07, 0.035)) return '#2fa84f';
    if (inE(u, v, 0.45, 0.66, 0.3, 0.13) && v < 0.68) return '#58c96b';
    if (inE(u, v, 0.45, 0.7, 0.33, 0.045)) return '#f2d08a';
    if (sea) return Math.floor(v * 26) % 2 ? '#2e9be0' : '#4fb4ee';
    return mix('#6fc4ff', '#d4f0ff', v / 0.58);
  },
  (u, v) => {                                                                          // Im Nabong, the periwinkle bunny
    if (inE(u, v, 0.4, 0.2, 0.075, 0.2) || inE(u, v, 0.6, 0.2, 0.075, 0.2)) return inE(u, v, 0.4, 0.2, 0.035, 0.15) || inE(u, v, 0.6, 0.2, 0.035, 0.15) ? '#ffb7d0' : '#a9c2fb';
    if (inE(u, v, 0.5, 0.6, 0.3, 0.3)) {
      if (inE(u, v, 0.4, 0.56, 0.04, 0.05) || inE(u, v, 0.6, 0.56, 0.04, 0.05)) return inE(u, v, 0.41, 0.54, 0.014, 0.018) || inE(u, v, 0.61, 0.54, 0.014, 0.018) ? '#ffffff' : '#2b2340';
      if (inE(u, v, 0.31, 0.66, 0.05, 0.035) || inE(u, v, 0.69, 0.66, 0.05, 0.035)) return '#ffa6c4';
      if (inE(u, v, 0.5, 0.64, 0.03, 0.022)) return '#ff7fa8';
      if (Math.abs(v - 0.7) < 0.012 && Math.abs(u - 0.5) < 0.07 && Math.abs(Math.abs(u - 0.5) - 0.035) < 0.03) return '#2b2340';
      return '#a9c2fb';
    }
    return mix('#fff6fb', '#ffe1ee', v);
  },
  (u, v) => {                                                                          // Mokuring, the pink bear
    if (inE(u, v, 0.26, 0.27, 0.11, 0.11) || inE(u, v, 0.74, 0.27, 0.11, 0.11)) return inE(u, v, 0.26, 0.27, 0.06, 0.06) || inE(u, v, 0.74, 0.27, 0.06, 0.06) ? '#b79af0' : '#f7a3c6';
    if (inE(u, v, 0.5, 0.58, 0.32, 0.32)) {
      if (inE(u, v, 0.38, 0.5, 0.04, 0.052) || inE(u, v, 0.62, 0.5, 0.04, 0.052)) return inE(u, v, 0.39, 0.48, 0.014, 0.018) || inE(u, v, 0.63, 0.48, 0.014, 0.018) ? '#ffffff' : '#2b2340';
      if (inE(u, v, 0.5, 0.68, 0.14, 0.1)) return inE(u, v, 0.5, 0.63, 0.04, 0.026) ? '#7a4a6a' : '#fff0dc';
      if (inE(u, v, 0.27, 0.62, 0.05, 0.035) || inE(u, v, 0.73, 0.62, 0.05, 0.035)) return '#ff82ad';
      if (inE(u, v, 0.34, 0.5, 0.075, 0.1) && u < 0.4 && v < 0.5 && inE(u, v, 0.3, 0.42, 0.04, 0.04)) return '#b79af0';
      return '#f7a3c6';
    }
    return mix('#fff9de', '#ffe8a8', v);
  },
  (u, v) => {                                                                          // Capray, the glowing manta
    const wing = Math.abs(u - 0.5) / 0.44 + Math.abs(v - 0.46) / 0.22 <= 1, body = inE(u, v, 0.5, 0.46, 0.14, 0.2);
    if (inE(u, v, 0.43, 0.4, 0.025, 0.03) || inE(u, v, 0.57, 0.4, 0.025, 0.03)) return '#ffffff';
    if (inE(u, v, 0.31, 0.46, 0.03, 0.03) || inE(u, v, 0.69, 0.46, 0.03, 0.03) || inE(u, v, 0.5, 0.58, 0.025, 0.03)) return '#8ff4ff';
    if (Math.abs(u - 0.5) < 0.012 && v > 0.62 && v < 0.95) return '#c9b8ff';
    if (body) return '#c1b4ff';
    if (wing) return '#8c7cf2';
    if (hash(Math.floor(u * PX) * 7 + Math.floor(v * PY) * 131) > 0.97) return '#ffffff';
    return mix('#1d2d6e', '#3a56b8', v);
  },
];

/** A flat mosaic (PX x PY unit quads) filling the frame's inside, vertex-coloured, facing up: ONE geometry. */
function pictureGeo(fn) {
  const iw = T.cols * T.tile, ih = T.rows * T.tile, pos = new Float32Array(PX * PY * 12), col = new Float32Array(PX * PY * 12), nor = new Float32Array(PX * PY * 12), idx = new Uint32Array(PX * PY * 6);
  const c = new THREE.Color();
  for (let j = 0; j < PY; j++) for (let i = 0; i < PX; i++) {
    const q = j * PX + i, x0 = -iw / 2 + (i / PX) * iw, x1 = -iw / 2 + ((i + 1) / PX) * iw, z0 = -ih / 2 + (j / PY) * ih, z1 = -ih / 2 + ((j + 1) / PY) * ih;
    c.set(fn((i + 0.5) / PX, (j + 0.5) / PY));
    [[x0, z0], [x1, z0], [x1, z1], [x0, z1]].forEach(([x, z], k) => { const o = q * 12 + k * 3; pos[o] = x; pos[o + 1] = 0; pos[o + 2] = z; col[o] = c.r; col[o + 1] = c.g; col[o + 2] = c.b; nor[o + 1] = 1; });
    idx.set([q * 4, q * 4 + 2, q * 4 + 1, q * 4, q * 4 + 3, q * 4 + 2], q * 6);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}
/** One loose wooden tile: a plank block with a lighter inset plate and four little pegs; its footprint is exactly tile x tile. */
function tileGeo() {
  const s = T.tile;
  return combine([box(s, TILE_H, s, '#d8aa72', [0, 0, 0]), box(s * 0.82, 0.05, s * 0.82, '#f2d4a0', [0, TILE_H - 0.01, 0]), ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => ball(0.07, '#6b4a30', [a * s * 0.38, TILE_H + 0.05, b * s * 0.38], [1, 0.5, 1]))]);
}
/** The frame: an underside slab and the raised rim (outer half extents hx, hz, inside face at the inner half). */
function frameGeo() {
  const hx = T.hx, hz = T.hz, r = T.rim, ihx = hx - r, ihz = hz - r;
  return combine([
    box(hx * 2, 0.5, hz * 2, WOOD_DARK, [0, -0.5, 0]),
    box(hx * 2, RIM_H, r, WOOD, [0, 0, -(hz - r / 2)]), box(hx * 2, RIM_H, r, WOOD, [0, 0, hz - r / 2]),
    box(r, RIM_H, ihz * 2, WOOD, [-(hx - r / 2), 0, 0]), box(r, RIM_H, ihz * 2, WOOD, [hx - r / 2, 0, 0]),
    ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => ball(0.3, GOLD, [a * (hx - r / 2), RIM_H, b * (hz - r / 2)], [1, 0.7, 1])),
    box(ihx * 2 + 0.02, 0.02, 0.06, '#5a3c26', [0, 0.005, -ihz]), box(ihx * 2 + 0.02, 0.02, 0.06, '#5a3c26', [0, 0.005, ihz]),
    ...frameWear(hx, hz, r),
  ]);
}
/** Wear for the rim, all inside the frame's own geometry (no extra node): wood-grain lines on the rim tops and bright corner brackets that catch the light as the frame tips. The inside face is untouched. */
function frameWear(hx, hz, r) {
  const out = [], y = RIM_H + 0.006;
  for (const sz of [-1, 1]) for (let k = -1; k <= 1; k++) out.push(box((hx * 2 - 1.2) * (0.55 + hash(k * 7 + sz) * 0.4), 0.012, 0.022, k % 2 ? '#a56c42' : '#c68e5e', [(hash(k + 3 + sz * 5) - 0.5) * 1.2, y, sz * (hz - r / 2) + k * 0.12]));
  for (const sx of [-1, 1]) for (let k = -1; k <= 1; k++) out.push(box(0.022, 0.012, (hz * 2 - 1.2 - 2 * r) * (0.55 + hash(k * 5 + sx) * 0.4), k % 2 ? '#a56c42' : '#c68e5e', [sx * (hx - r / 2) + k * 0.12, y, (hash(k + 9 + sx * 3) - 0.5) * 1.2]));
  for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) out.push(box(1.0, 0.03, 0.14, '#fff0b8', [a * (hx - 0.72), RIM_H + 0.012, b * (hz - r / 2)]), box(0.14, 0.03, 1.0, '#fff0b8', [a * (hx - r / 2), RIM_H + 0.012, b * (hz - 0.72)]));
  return out;
}
function coconutGeo() {
  const R = T.ballR, p = [part(G.sphere, '#7a4a2a', { s: [R, R, R] }), part(G.sphereLo, '#a06d44', { p: [-R * 0.36, R * 0.5, R * 0.55], s: [R * 0.3, R * 0.34, R * 0.16] })];
  for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2 + 0.4; p.push(part(G.sphereLo, '#2d1a0e', { p: [Math.cos(a) * R * 0.3, R * 0.93, Math.sin(a) * R * 0.3], s: [R * 0.17, R * 0.1, R * 0.17] })); }
  p.push(part(G.sphereLo, '#2d1a0e', { p: [R * 0.2, -R * 0.93, R * 0.2], s: [R * 0.15, R * 0.09, R * 0.15] }), part(G.sphereLo, '#a06d44', { p: [R * 0.7, -R * 0.3, -R * 0.5], s: [R * 0.3, R * 0.3, R * 0.15] }));
  return combine(p);
}

export function createTiltyWorld({ scene, sfx, particles, labels }) {
  const root = new THREE.Group();
  root.name = 'party-tilty';
  root.position.set(centre.x, O.y, centre.z);
  root.visible = false;
  scene.add(root);
  const geos = [], mats = [];
  const living = stageLivingLifecycle({ root, id: 'tilty', cam: CAM });
  const BOARDS = tiltyBoards();

  // ---- the lawn: a big picnic lawn, the posts the frames balance on, flowers, a few trees at the back
  const base = [];
  for (const f of T.frames) base.push(post(0.55, T.pivotY - 0.5, '#9a6a44', [f.x, 0, f.z]), ball(0.8, '#c9a06a', [f.x, T.pivotY - 0.55, f.z], [1, 0.45, 1]), disc(1.5, '#7acb55', [f.x, 0.03, f.z], 0.04));
  base.push(disc(1.15, '#ffd85e', [0, 0.35, 0], 0.35), ring(0.75, 1.0, '#fff3a0', [0, 0.37, 0], 0.03));                     // Zyoni's pedestal in the middle of the cross
  // (the flowers, the trees and the lawn itself are the living pass: livingStage.js / living82d.js; nothing is ever placed under or in a frame)
  const baseMesh = solid(base, { outline: 0.04 });
  baseMesh.name = 'tilty-base';
  root.add(baseMesh); geos.push(baseMesh.geometry);

  // ---- Zyoni on her pedestal
  const zy = createTdoongModel('parkzyoni');
  zy.root.scale.setScalar(TDOONGZ.parkzyoni.scale * 0.75);
  zy.root.position.set(0, 0.7, 0); zy.root.rotation.y = 0;
  root.add(zy.root);

  // ---- the four frames
  const fGeo = frameGeo(), tGeo = tileGeo(), cGeo = coconutGeo();
  geos.push(fGeo, tGeo, cGeo); tGeo.computeBoundingBox();
  const outlineOf = (g) => { const o = makeOutline(g, 0.04); geos.push(o.geometry); return o; };
  const WOODS = ['#ffffff', '#f4dcc0', '#e9c8a0', '#fff0dc', '#e0b890'].map((c) => new THREE.Color(c));
  const frames = T.frames.map((f, k) => {
    const grp = new THREE.Group(); grp.name = `tilty-frame-${k}`; grp.position.set(f.x, T.pivotY, f.z); root.add(grp);
    const fm = new THREE.Mesh(fGeo, VERTEX_TOON); fm.castShadow = false; fm.receiveShadow = false; fm.add(outlineOf(fGeo)); grp.add(fm);
    const pg = pictureGeo(PICTURES[k]); geos.push(pg);
    const pm = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ vertexColors: true })); mats.push(pm.material); pm.position.y = 0.01; grp.add(pm);
    const tiles = new THREE.InstancedMesh(tGeo, VERTEX_TOON, TILES); tiles.frustumCulled = false; tiles.name = `tilty-tiles-${k}`; tiles.castShadow = false; grp.add(tiles);
    const coco = new THREE.Mesh(cGeo, VERTEX_TOON); coco.name = `tilty-coconut-${k}`; coco.castShadow = false; coco.add(outlineOf(cGeo)); grp.add(coco);
    for (let i = 0; i < TILES; i++) tiles.setColorAt(i, WOODS[Math.floor(hash(k * 40 + i) * WOODS.length)]);
    tiles.instanceColor.needsUpdate = true;
    // per-frame display state: the mask shown, each tile's flight (age since popped, its launch), the coconut's rolling quaternion and last drawn place
    const st = { grp, tiles, coco, shown: 0, age: new Array(TILES).fill(-1), vel: new Array(TILES).fill(null), q: [0, 0, 0, 1], last: null, tilt: { x: 0, z: 0 }, n: 0 };
    return st;
  });
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _e = new THREE.Euler();

  function placeTiles(st) {
    for (let i = 0; i < TILES; i++) {
      const c = tileCentre(i), age = st.age[i];
      if (age < 0) { _p.set(c.x, 0, c.z); _q.identity(); _s.set(1, 1, 1); }
      else {
        const vel = st.vel[i], a = age;
        _p.set(c.x + vel.x * a, Math.max(-1, vel.y * a - 9 * a * a), c.z + vel.z * a);
        _e.set(vel.sx * a, vel.sy * a, vel.sz * a); _q.setFromEuler(_e);
        const k = a > 0.7 ? Math.max(0, 1 - (a - 0.7) / 0.2) : 1; _s.set(k, k, k);
      }
      _m.compose(_p, _q, _s); st.tiles.setMatrixAt(i, _m);
    }
    st.tiles.instanceMatrix.needsUpdate = true;
  }

  // ---- state
  let t0 = 0, lastMode = '', practice = null, shownTilt = BOARDS.map(() => ({ x: 0, z: 0 })), cheerUntil = -1, lastHot = 0;
  const worldAt = (st, x, y, z) => { const v = new THREE.Vector3(x, y, z); st.grp.updateMatrixWorld(true); return st.grp.localToWorld(v); };

  function pop(st, k, i, board) {
    const c = tileCentre(i), dx = c.x - board.x, dz = c.z - board.z, d = Math.hypot(dx, dz) || 1;
    st.age[i] = 0; st.vel[i] = { x: dx / d * 2.2 + (hash(k * 99 + i) - 0.5) * 2, y: 6 + hash(i + k) * 2.5, z: dz / d * 2.2 + (hash(i * 3 + k) - 0.5) * 2, sx: (hash(i + 5) - 0.5) * 14, sy: (hash(i + 9) - 0.5) * 10, sz: (hash(i + 13) - 0.5) * 14 };
  }

  /** Present one frame's displayed state: tilt, tiles, coconut. `quiet` = no sounds / particles (the wait state). */
  function showFrame(k, B, dt, quiet) {
    const st = frames[k];
    st.tilt.x = B.tx; st.tilt.z = B.tz;
    const b = BOARDS[k]; b.tilt.x = B.tx; b.tilt.z = B.tz;
    const n = planeNormal(b); st.grp.quaternion.setFromUnitVectors(UP, _p.set(n[0], n[1], n[2]));
    for (let i = 0; i < TILES; i++) if (st.age[i] >= 0) { st.age[i] += dt; if (st.age[i] > 0.95) st.age[i] = 0.95 + 1e-6; }       // (the tiles already flying; a tile popped in THIS update starts from its place)
    const fresh = B.m & ~st.shown;
    if (B.m !== st.shown) {
      let added = 0;
      for (let i = 0; i < TILES; i++) if ((fresh >> i) & 1) {
        added++;
        if (!quiet) { pop(st, k, i, B); const c = tileCentre(i), w = worldAt(st, c.x, 0.6, c.z); particles?.burst('sparkle', w, { count: 4, radius: 0.5, height: 0.6, color: '#ffe0a0' }); }
        else st.age[i] = -1;
      }
      if (added && !quiet) sfx?.play('tileflip', { pitch: 0.85 + (B.n / TILES) * 0.7, vol: 0.5 });
      if (B.m < st.shown) for (let i = 0; i < TILES; i++) st.age[i] = -1;                                      // (a restart: the tiles are back)
      st.shown = B.m;
    }
    placeTiles(st);
    st.coco.position.set(B.x, T.ballR, B.z);
    if (st.last) st.q = rollQuaternion(st.q, B.x - st.last.x, B.z - st.last.z, T.ballR);
    st.last = { x: B.x, z: B.z };
    st.coco.quaternion.set(st.q[0], st.q[1], st.q[2], st.q[3]);
    st.n = B.n;
    shownTilt[k].x = B.tx; shownTilt[k].z = B.tz;
  }

  const FRESH = { tx: 0, tz: 0, x: T.ball.x, z: T.ball.z, vx: 0, vz: 0, m: 0, n: 0, d: null };

  function update(dt, { mode = 'wait', v = null, t = 0, who = null, lanePlayers = [] } = {}) {
    if (!root.visible) return;
    t0 += dt;
    if (mode !== lastMode) { lastMode = mode; practice = null; for (const st of frames) { st.shown = 0; st.age.fill(-1); st.last = null; } }
    if (mode === 'play' && v) {
      v.boards.forEach((B, k) => showFrame(k, B, dt, false));
      for (let k = v.boards.length; k < 4; k++) showFrame(k, FRESH, dt, true);
    } else if (mode === 'practice') {
      if (!practice || practice.g.done) practice = { g: tInit(777, [0, 1, 2, 3].map((slot) => ({ slot }))), t: 0 };
      practice.t += dt;
      const pos = (slot) => { const p = lanePlayers[slot]; return p && p.position ? { x: p.position.x, z: p.position.z } : null; };
      for (const r of tStep(practice.g, { pos }, dt, practice.t)) tApply(practice.g, r);
      practice.g.boards.forEach((B, k) => showFrame(k, B, dt, false));
      if (practice.g.boards.some((B) => B.n >= TILES - 1)) practice = null;                                      // (the rehearsal starts over before a picture is ever finished)
    } else for (let k = 0; k < 4; k++) showFrame(k, FRESH, dt, true);
    // Zyoni cheers: a bounce, her head nods; she hops higher for a moment whenever somebody uncovers a lot, and throws both arms up when a picture is finished (a short reaction)
    const hot = v ? v.boards.reduce((a, B) => Math.max(a, B.n), 0) / TILES : 0, s = t0 * (4.5 + hot * 2.5);
    if (hot >= (TILES - 1) / TILES && lastHot < (TILES - 1) / TILES) cheerUntil = t0 + 1.6;
    lastHot = hot;
    const cheer = Math.max(0, Math.min(1, cheerUntil - t0));
    zy.rig.position.y = Math.abs(Math.sin(s)) * (0.12 + hot * 0.2) + cheer * Math.abs(Math.sin(t0 * 10)) * 0.25;
    for (const [arm, side] of [[zy.armL, 1], [zy.armR, -1]]) if (arm) arm.rotation.x = (-0.5 + Math.sin(s + side) * 0.3) * (1 - cheer) + (-2.7 + Math.sin(t0 * 12 + side) * 0.2) * cheer;
    zy.update?.(dt, t0);
    (zy.ears || []).forEach((ear, i) => { if (ear && ear.userData.restZ !== undefined) ear.rotation.z = ear.userData.restZ + (((t0 + i * 2.7) % 6) < 0.35 ? Math.sin(t0 * 30) * 0.08 : 0); });        // an ear flick every few seconds
    hostIdle(zy, t0, v && mode === 'play' ? { totals: Object.fromEntries(v.slots.map((sl, i) => [sl, v.boards[i].n])), done: v.done } : null, lanePlayers);          // (her head follows whoever has uncovered the most)
    zy.headGroup.rotation.z += Math.sin(s * 0.5) * 0.1;
    living.update(dt, t0, lanePlayers);
  }

  return {
    root, update, cam: CAM, look: 'day',
    get living() { return living.current; },
    setVisible(on) {
      living.setVisible(on);
      root.visible = !!on;
      if (!on) { labels?.clear?.(); lastMode = ''; practice = null; for (const st of frames) { st.shown = 0; st.age.fill(-1); st.last = null; } }
    },
    onRec(rec) { if (!root.visible) return; if (rec.k === 'zap' || rec.done) particles?.burst('confetti', { x: centre.x, y: O.y + 4.5, z: centre.z }, { count: 30, radius: 4 }); },
    scoreText(v, slot) { const i = v ? v.slots.indexOf(slot) : -1; return i < 0 ? { text: '', out: false } : { text: `${v.boards[i].n}/${TILES}`, out: false }; },
    clearPractice() { practice = null; },
    tilts: () => shownTilt,
    tileDraw(f, i) {                                                                // where tile i of frame f is drawn now (frame-local), read back from its instance matrix and the geometry
      const st = frames[f], m = new THREE.Matrix4(); st.tiles.getMatrixAt(i, m);
      const bb = tGeo.boundingBox;
      return { x: m.elements[12], z: m.elements[14], half: (bb.max.x - bb.min.x) / 2, popped: st.age[i] >= 0 };
    },
    ballDraw(f) { const p = frames[f].coco.position; return { x: p.x, y: p.y, z: p.z, r: T.ballR }; },
    frameGroup: (f) => frames[f].grp,
    counts: () => ({ frames: frames.length, tiles: frames.map((st) => st.age.filter((a) => a < 0).length) }),
    summary() { let calls = 0; root.traverse((o) => { if (o.isMesh && o.visible) calls++; }); return { visible: root.visible, meshes: calls }; },
    dispose() { if (root.userData.disposed) return; root.userData.disposed = true; living.dispose(); { const all = new Set(geos), own = new Set(); zy.root.traverse((o) => { if (o.geometry) own.add(o.geometry); }); root.traverse((o) => { if (o.geometry && !own.has(o.geometry)) all.add(o.geometry); }); for (const g of all) if (!own.has(g)) g.dispose(); } for (const m of mats) m.dispose(); zy.dispose?.(); scene.remove(root); },
  };
}
