// The trophy ceremony's set (Step 80e): the cut that closes a party (mode 'party', after the last round) on the Glade's lobby. Everything here is a presentation of the host's `ceremony` state (game/party/partyDomain.js),
// so every screen builds the same thing from the same places and the same clock.
//
//   podiumSpots(places) -> [{ slot, place, x, y, z, face }]    where each seat's body stands (WORLD coordinates): 1st on the tall block, 2nd on its left, 3rd on its right, everybody after on the grass beside them; ties
//                                                              share a block side by side (pure; Node-tested)
//   cameraShot(tc, from) -> { pos: [x, y, z], look: [x, y, z] }   the cut's camera path in LOBBY-LOCAL numbers (tc = seconds since it began; `from` = { pos, look } the camera left from, so the cut starts where the lobby view was)
//   createCeremony({ parent }) -> { root, show(tc0), update(dt, tc), hide(), dispose(), summary() }
//       ONE merged gold Tdoong-shaped trophy (the shared VERTEX_TOON material + an outline child) on a pedestal, and the crowd: ALL NINE Tdoongz cheering on the stage. Each friend is baked ONCE into TWO merged meshes (arms high / arms
//       wide, the low-detail build: npc/models.js setLowDetail) so the crowd is nine draw calls and well under the triangle budget (the lobby's usual trio is three full models); the two poses swap as the friend bounces.
//       No new lights, no new shader program (the Tdoongz keep their own character-toon material, the trophy the shared prop one).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PARTY, TDOONGZ } from '../../config.js';
import { BOTS } from '../../game/party/botRoster.js';
import { createTdoongModel } from '../../npc/tdoongz.js';
import { setLowDetail } from '../../npc/models.js';
import { solid, box } from './kit.js';
import { part, G } from '../../render/geo.js';

const O = PARTY.origin, L = PARTY.lobby;
const GOLD = '#ffcf3a', GOLD_LIGHT = '#ffe88a', GOLD_DARK = '#e09a1a', WOOD = '#b57a4e', WOOD_DARK = '#8a5a3c', PLATE = '#fff3c4', EYE = '#2b2340', CHEEK = '#ffb27a';
const smooth = (u) => { u = Math.min(1, Math.max(0, u)); return u * u * (3 - 2 * u); };

// ------------------------------------------------------------------------------------------------ the podium
/** The three blocks of the lobby's podium: [place 1, place 2, place 3] = x offset from the podium centre and the block's height (see world/party/glade.js). */
export const BLOCKS = [{ dx: 0, h: 1.5 }, { dx: -2, h: 0.9 }, { dx: 2, h: 0.6 }];

export function podiumSpots(places) {
  const out = [], groups = new Map();
  for (const p of places) { if (!groups.has(p.place)) groups.set(p.place, []); groups.get(p.place).push(p); }
  let beside = 0;
  for (const [place, list] of [...groups].sort((a, b) => a[0] - b[0])) {
    list.sort((a, b) => a.slot - b.slot);
    const n = list.length, gap = n > 1 ? Math.min(0.75, 1.5 / (n - 1)) : 0, block = BLOCKS[place - 1];
    list.forEach((p, i) => {
      const off = (i - (n - 1) / 2) * gap;
      if (block) out.push({ slot: p.slot, place, x: O.x + L.podium.x + block.dx + off, y: O.y + block.h, z: O.z + L.podium.z + 0.1, face: 0 });
      else out.push({ slot: p.slot, place, x: O.x + L.podium.x + 4.6 + (beside++) * 0.9, y: O.y, z: O.z + L.podium.z + 0.9, face: 0 });      // (4th and below stand on the grass at the podium's side, still cheering)
    });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ the camera
const SHOTS = [
  { t: 3.2, pos: [3.5, 6.4, 9.6], look: [3.5, 2.1, -7.0] },          // pushes in on the stage, the trophy and the podium
  { t: 9.0, pos: [8.2, 4.3, 5.4], look: [8.0, 2.3, -5.2] },          // closes on the podium
  { t: 14.0, pos: [1.2, 3.9, 8.2], look: [0.4, 2.6, -8.0] },         // swings over to the crowd and the trophy
  { t: 18.0, pos: [3.0, 7.6, 14.5], look: [3.0, 1.6, -6.0] },        // and pulls out again
];
export function cameraShot(tc, from = null) {
  const start = from || { pos: [0, 16, 14], look: [0, 1, -3] };
  const keys = [{ t: 0, pos: start.pos, look: start.look }, ...SHOTS];
  let i = 0;
  while (i < keys.length - 2 && tc >= keys[i + 1].t) i++;
  const a = keys[i], b = keys[i + 1], u = smooth((tc - a.t) / (b.t - a.t));
  const mix = (p, q) => p.map((v, k) => v + (q[k] - v) * u);
  return { pos: mix(a.pos, b.pos), look: mix(a.look, b.look) };
}

// ------------------------------------------------------------------------------------------------ the trophy
/** A gold Tdoong: a chubby bean with a round head, two long ears and both arms up, holding itself up on a little pedestal (lobby-local, origin at the pedestal's centre on the ground). */
export function trophyParts() {
  const b = (s, c, p, sc = [1, 1, 1], r = [0, 0, 0]) => part(G.sphere, c, { p, r, s: sc.map((v) => v * s) });
  const out = [
    box(2.1, 0.32, 2.1, WOOD_DARK, [0, 0, 0]), box(1.6, 0.62, 1.6, WOOD, [0, 0.32, 0]), box(1.9, 0.14, 1.9, GOLD_DARK, [0, 0.94, 0]), box(1.0, 0.3, 0.06, PLATE, [0, 0.55, 0.82]),
    // the body, the belly patch, the feet
    b(0.66, GOLD, [0, 1.95, 0], [1, 1.12, 0.92]), b(0.42, GOLD_LIGHT, [0, 1.85, 0.42], [1, 1.1, 0.4]),
    b(0.24, GOLD_DARK, [-0.3, 1.2, 0.3], [1.1, 0.6, 1.5]), b(0.24, GOLD_DARK, [0.3, 1.2, 0.3], [1.1, 0.6, 1.5]),
    // the head, the ears with their inner halves, the face
    b(0.74, GOLD, [0, 3.05, 0.04], [1.08, 0.96, 0.96]),
    b(0.2, GOLD, [-0.42, 3.9, 0], [0.62, 2.3, 0.62], [0, 0, 0.12]), b(0.2, GOLD, [0.42, 3.9, 0], [0.62, 2.3, 0.62], [0, 0, -0.12]),
    b(0.1, GOLD_LIGHT, [-0.42, 3.88, 0.1], [0.55, 2.2, 0.4], [0, 0, 0.12]), b(0.1, GOLD_LIGHT, [0.42, 3.88, 0.1], [0.55, 2.2, 0.4], [0, 0, -0.12]),
    b(0.075, EYE, [-0.27, 3.12, 0.66], [1, 1.25, 0.6]), b(0.075, EYE, [0.27, 3.12, 0.66], [1, 1.25, 0.6]),
    b(0.12, CHEEK, [-0.44, 2.95, 0.6], [1.3, 0.8, 0.4]), b(0.12, CHEEK, [0.44, 2.95, 0.6], [1.3, 0.8, 0.4]),
    b(0.06, EYE, [0, 2.97, 0.72], [1.3, 0.8, 0.7]),
    // both arms up (a cheer)
    b(0.17, GOLD, [-0.88, 2.55, 0.05], [0.8, 2.0, 0.8], [0, 0, -0.5]), b(0.17, GOLD, [0.88, 2.55, 0.05], [0.8, 2.0, 0.8], [0, 0, 0.5]),
    b(0.15, GOLD_LIGHT, [-1.08, 2.98, 0.05]), b(0.15, GOLD_LIGHT, [1.08, 2.98, 0.05]),
  ];
  return out;
}

// ------------------------------------------------------------------------------------------------ the crowd
const POSES = [{ x: -2.8, z: 0.25, head: -0.12, ear: -0.08 }, { x: -2.35, z: 0.75, head: 0.12, ear: 0.08 }];      // arms high / arms wide
function applyPose(m, id, pose) {
  const quad = id === 'parkzyoni';
  m.rig.position.y = 0;
  if (!quad) {
    for (const [arm, side] of [[m.armL, 1], [m.armR, -1]]) { if (!arm) continue; arm.rotation.x = pose.x; arm.rotation.z = (arm.userData.restZ ?? 0) + side * pose.z; }
  } else if (m.armL && m.armR) {                                    // (a unicorn rears: both front legs up, the other pose has one lifted)
    m.armL.rotation.x = pose.x > -2.5 ? -0.5 : -1.1; m.armR.rotation.x = pose.x > -2.5 ? -1.1 : -0.5;
  }
  m.headGroup.rotation.z = pose.head;
  for (const e of m.ears || []) e.rotation.x = pose.ear;
}
const shown = (o, root) => { for (let n = o; n && n !== root.parent; n = n.parent) if (!n.visible) return false; return true; };

/** One friend baked into two merged meshes (low detail, 'happy' face). Returns { group, frames: [Mesh, Mesh], dispose }. */
export function bakeCheerer(id) {
  setLowDetail(true);
  let m;
  try { m = createTdoongModel(id); } finally { setLowDetail(false); }
  m.setExpression?.('happy');
  let material = null;
  const geos = POSES.map((pose) => {
    applyPose(m, id, pose);
    m.root.updateMatrixWorld(true);
    const list = [];
    m.root.traverse((o) => { if (o.isMesh && shown(o, m.root)) { material ||= o.material; const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld); list.push(g); } });
    const merged = mergeGeometries(list, false);
    for (const g of list) g.dispose();
    return merged;
  });
  const group = new THREE.Group();
  group.name = `ceremony-${id}`;
  const frames = geos.map((g, k) => {
    const mesh = new THREE.Mesh(g, material);
    mesh.castShadow = false; mesh.receiveShadow = false; mesh.visible = k === 0;
    mesh.name = `${id}-pose${k}`;
    group.add(mesh);
    return mesh;
  });
  group.scale.setScalar(TDOONGZ[id]?.scale || 1.27);
  return { group, frames, dispose() { for (const g of geos) g.dispose(); material?.dispose(); group.removeFromParent(); } };
}

/** Where the nine stand on the stage (lobby-local): one row along the dais, the middle friends a hair forward. */
export function crowdSpots(n = BOTS.length) {
  return Array.from({ length: n }, (_, i) => {
    const u = n > 1 ? i / (n - 1) : 0.5, x = (u - 0.5) * 12.6;
    return { x, y: 0.5, z: L.stage.z + 0.35 + (1 - Math.abs(u - 0.5) * 2) * 0.3, yaw: -x * 0.012 };
  });
}

export function createCeremony({ parent }) {
  const root = new THREE.Group();
  root.name = 'party-ceremony';
  root.visible = false;
  parent.add(root);
  let crowd = null, trophy = null, disposed = false;

  function build() {
    if (crowd) return;
    const spots = crowdSpots();
    crowd = BOTS.map((b, i) => {
      const c = bakeCheerer(b.id), s = spots[i];
      c.group.position.set(s.x, s.y, s.z);
      c.group.rotation.y = s.yaw;
      root.add(c.group);
      return { ...c, id: b.id, base: s, k: i };
    });
    trophy = solid(trophyParts(), { outline: 0.05, cast: true, receive: false });
    trophy.name = 'party-trophy';
    trophy.position.set(0, 0, L.stage.z + 3.7);
    trophy.scale.setScalar(0);
    root.add(trophy);
  }

  return {
    root,
    get crowd() { return crowd; },
    get trophy() { return trophy; },
    show() { if (disposed) return; build(); root.visible = true; },
    hide() { root.visible = false; },
    /** tc = seconds since the cut began. */
    update(dt, tc) {
      if (!root.visible || !crowd) return;
      const rise = PARTY.ceremony.rise, u = (tc - rise) / 0.7;
      const grow = u <= 0 ? 0 : u >= 1 ? 1 : smooth(u) * (1 + Math.sin(u * Math.PI) * 0.22);
      trophy.scale.setScalar(Math.max(0.0001, grow * 0.95));
      trophy.visible = grow > 0.001;
      trophy.rotation.y = Math.sin(tc * 0.9) * 0.3;
      for (const c of crowd) {
        const s = tc * 6.2 + c.k * 1.37, up = Math.abs(Math.sin(s));
        c.group.position.y = c.base.y + up * 0.24;
        c.group.rotation.z = Math.sin(s * 0.5) * 0.05;
        const wide = Math.sin(tc * 9 + c.k * 2.1) > 0;                 // the arms swap high / wide a few times a second
        c.frames[0].visible = !wide; c.frames[1].visible = wide;
      }
    },
    dispose() {
      if (disposed) return; disposed = true;
      if (crowd) for (const c of crowd) c.dispose();
      if (trophy) { trophy.geometry.dispose(); trophy.traverse((o) => { if (o !== trophy && o.geometry) o.geometry.dispose(); }); }
      crowd = null; trophy = null;
      root.removeFromParent();
    },
    summary() {
      let meshes = 0, tris = 0;
      root.traverse((o) => { if (o.isMesh && o.visible) { meshes++; const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; } });
      return { visible: root.visible, cheerers: crowd ? crowd.map((c) => c.id) : [], trophy: !!trophy, meshes, triangles: Math.round(tris) };
    },
  };
}
