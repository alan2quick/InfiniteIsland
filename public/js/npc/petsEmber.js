// Ruby's model kit (Step 76a). buildRuby({shell = 'home', size = 1}) returns root/rig, meshes,
// update(dt, time, {anim, speed}), setShell(id), setSize(k), dispose(). Feet at zero, faces +Z.
// Body and swappable shell each use one merged skinned mesh with baked #2b2340 hulls: four
// main + shadow submissions, shared pet material and existing skinned program; no lights.
import * as THREE from 'three';
import { PET } from '../config.js';
import { SkinBaker, buildSkinned, paintRole, modelShell, restPose, hull, xf, tissue, hash3 } from './petsKit.js';

export const RUBY_SHELLS = ['cap', 'whelk', 'turban', 'coconut', 'conch', 'home'];
export const RUBY_ANIMS = ['idle', 'walk', 'hide', 'wave', 'swap', 'dig'];
const RED = '#d8261c', DARK = '#b01812', IVORY = '#fff0cd';
const bones = [{ name: 'root', pos: [0, 0, 0] }, { name: 'body', parent: 'root', pos: [0, 0.2, 0.08] },
  { name: 'eyes', parent: 'root', pos: [0, 0.28, 0.15] }, { name: 'bubbles', parent: 'root', pos: [0, 0.23, 0.24] }, { name: 'abdomen', parent: 'body', pos: [0, 0.22, -0.12] }];
for (const side of [-1, 1]) {
  bones.push({ name: `claw${side}`, parent: 'body', pos: [side * 0.13, 0.21, 0.18] });
  bones.push({ name: `antenna${side}`, parent: 'body', pos: [side * 0.04, 0.23, 0.2] });
  for (let i = 0; i < 3; i++) bones.push({ name: `leg${side}:${i}`, parent: 'body', pos: [side * 0.1, 0.17, 0.12 - i * 0.085] });
}
function ell(b, bone, p, s, color, role = null, rotation = [0, 0, 0], detail = 10) {
  const matrix = xf(p, rotation, s);
  b.add(new THREE.SphereGeometry(1, detail, Math.max(6, detail / 2)), matrix, { bone, color, role, outline: hull(s, 0.004) });
  if (role === 'red') freckles(b, bone, matrix, 18, 0.07);
  if (role === 'shell' && color === '#f5e7c8') growthBands(b, bone, matrix);

}
function rod(b, bone, a, c, r, color, role = null) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...c), d = B.clone().sub(A);
  const m = new THREE.Matrix4().compose(A.add(B).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()), new THREE.Vector3(r, d.length(), r));
  b.add(new THREE.CylinderGeometry(1, 0.7, 1, 8), m, { bone, color, role, outline: 0.12 });
  if (role === 'red') freckles(b, bone, m, 12, 0.13, true);

}
// Small cream discs are baked into the body's vertex-coloured mesh (same skin/bone/material).
// Unlike sparse random vertex tints they retain a crisp dot silhouette at gameplay zoom.
function freckles(b, bone, matrix, count, radius, cylinder = false) {
  for (let i = 0; i < count; i++) {
    const a = i * 2.399963, y = cylinder ? -0.43 + 0.86 * hash3(i, count, 4, 76) : -0.85 + 1.7 * (i + 0.5) / count;
    const r = cylinder ? 0.85 + y * 0.3 : Math.sqrt(1 - y * y);
    const pos = new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
    const normal = cylinder ? new THREE.Vector3(Math.cos(a), 0, Math.sin(a)) : pos.clone().normalize();
    pos.addScaledVector(normal, 0.012);
    const local = new THREE.Matrix4().compose(pos, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal), new THREE.Vector3(radius, cylinder ? radius * 0.18 : radius, radius));
    b.add(new THREE.CircleGeometry(1, 7), matrix.clone().multiply(local), { bone, color: IVORY });
  }
}
// Fine brown ribbons follow the shell's curved growth, wrapped with a spiral phase.
// Merged strips provide sub-face detail without globally subdividing every outlined shell.
function growthBands(b, bone, matrix) {
  const pos = [], nor = [], col = [], idx = [], brown = new THREE.Color('#805137');
  for (let band = 0; band < 16; band++) for (let j = 0; j <= 20; j++) {
    const v = 0.12 + (Math.PI - 0.24) * j / 20;
    for (const side of [-1, 1]) {
      const a = band * Math.PI / 8 + v * 0.75 + side * 0.018;
      const n = new THREE.Vector3(Math.sin(v) * Math.cos(a), Math.cos(v), Math.sin(v) * Math.sin(a));
      const p = n.clone().multiplyScalar(1.008).applyMatrix4(matrix), nn = n.clone().transformDirection(matrix);
      pos.push(p.x, p.y, p.z); nor.push(nn.x, nn.y, nn.z); col.push(brown.r, brown.g, brown.b);
    }
    if (j < 20) { const k = (band * 21 + j) * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  b.addRaw({ pos, nor, col, idx }, { bone });
  // A few warm-brown speckles, also baked vertex colours.
  for (let i = 0; i < 8; i++) {
    const a = i * 2.4, y = -0.7 + i * 0.2, r = Math.sqrt(1 - y * y), n = new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
    const local = new THREE.Matrix4().compose(n.clone().multiplyScalar(1.012), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n), new THREE.Vector3(0.025, 0.018, 0.025));
    b.add(new THREE.CircleGeometry(1, 6), matrix.clone().multiply(local), { bone, color: '#805137' });
  }
}
function bodyMesh() {
  const b = new SkinBaker(bones.map((d) => d.name));
  ell(b, 'body', [0, 0.22, 0.09], [0.13, 0.09, 0.15], RED, 'red', [0, 0, 0], 18);
  ell(b, 'abdomen', [0, 0.24, -0.09], [0.12, 0.095, 0.17], '#ed8581');
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const z = 0.12 - i * 0.085, bone = `leg${s}:${i}`;
      rod(b, bone, [s * 0.1, 0.17, z], [s * 0.27, 0.13, z - 0.015], 0.033, RED, 'red');
      rod(b, bone, [s * 0.27, 0.13, z - 0.015], [s * 0.34, 0.018, z + 0.045], 0.027, DARK, 'red');
    }
    const k = s < 0 ? 1.16 : 1, claw = `claw${s}`;
    rod(b, claw, [s * 0.13, 0.21, 0.18], [s * 0.22, 0.25, 0.26], 0.038, RED, 'red');
    ell(b, claw, [s * 0.2, 0.29, 0.28], [0.074 * k, 0.09 * k, 0.07], RED, 'red', [0, 0, s * 0.25], 16);
    for (const d of [-1, 1]) ell(b, claw, [s * 0.2 + d * 0.024, 0.35, 0.3], [0.025, 0.05, 0.036], DARK, 'red');
    rod(b, 'eyes', [s * 0.065, 0.26, 0.17], [s * 0.082, 0.38, 0.2], 0.021, RED, 'red');
    ell(b, 'eyes', [s * 0.083, 0.39, 0.21], [0.043, 0.052, 0.039], '#100e18');
    ell(b, 'eyes', [s * 0.083 - 0.012, 0.414, 0.25], [0.014, 0.017, 0.008], '#ffffff');
    rod(b, 'body', [s * 0.025, 0.23, 0.21], [s * 0.035, 0.18, 0.25], 0.014, '#ff9339');
    for (const k of [0.65, 1]) rod(b, `antenna${s}`, [s * 0.04, 0.23, 0.2], [s * 0.18 * k, 0.32 + k * 0.06, 0.22 + k * 0.17], 0.006, '#ef7432');
    // Painted highlights keep the glossy reading without another material/program.
    ell(b, claw, [s * 0.21, 0.316, 0.341], [0.024, 0.012, 0.004], '#ffb29b');
  }
  for (let i = 0; i < 3; i++) {
    ell(b, 'bubbles', [0.025 * Math.sin(i * 3), 0.28 + i * 0.075, 0.26], [0.022, 0.022, 0.022], '#b3efff');
    ell(b, 'bubbles', [0.025 * Math.sin(i * 3) - 0.007, 0.286 + i * 0.075, 0.278], [0.006, 0.006, 0.003], '#ffffff');
  }
  const e = b.build();
  paintRole(e, 'red', (p, n, c) => {
    c.copy(tissue(RED, DARK, p.x, p.y, p.z, { scale: 22, jitter: 0.08 }));
    // Quantised deterministic cells make cream freckles, never recolouring the outline hull.
    // Cream dot geometry above carries the freckles; keep the skin between them strawberry red.
  });
  return buildSkinned({ entry: e, bones, name: 'ruby-body' });
}
function shellMesh(id) {
  const b = new SkinBaker(['shell']);
  const colors = { cap: '#57a6ac', whelk: '#d5b58b', turban: '#c7e1bf', coconut: '#724b33', conch: '#f2ac74', home: '#f5e7c8' };
  const color = colors[id];
  if (id === 'cap') {
    b.add(new THREE.CylinderGeometry(1, 1, 1, 20), xf([0, 0.3, -0.1], [0.35, 0, 0], [0.2, 0.09, 0.2]), { bone: 'shell', color, outline: 0.03 });
    for (let i = 0; i < 20; i++) { const a = i * Math.PI / 10; ell(b, 'shell', [Math.cos(a) * 0.19, 0.28, -0.1 + Math.sin(a) * 0.19], [0.018, 0.05, 0.018], color); }
  } else {
    const round = id === 'turban' || id === 'coconut';
    ell(b, 'shell', [0, 0.31, -0.1], [0.205, 0.2, 0.23], color, 'shell', [0.1, 0, 0], 20);
    if (!round) for (let i = 0; i < 4; i++) {
      const k = 1 - i * 0.21;
      ell(b, 'shell', [0.035 + i * 0.022, 0.43 + i * 0.024, -0.2 - i * 0.035], [0.105 * k, 0.105 * k, 0.11 * k], color, 'shell', [0.3, 0, -0.2], 12);
    }
    if (id === 'turban') for (let i = 0; i < 8; i++) {
      const a = i * 0.7; ell(b, 'shell', [Math.cos(a) * 0.09, 0.46, -0.1 + Math.sin(a) * 0.09], [0.045, 0.035, 0.045], '#f5f0d8', 'shell');
    }
    // A dark recessed opening with a thick ivory lip, facing the crab's face (+Z).
    ell(b, 'shell', [0, 0.25, 0.099], [0.145, 0.135, 0.015], '#573b35');
    b.add(new THREE.TorusGeometry(1, 0.12, 6, 24), xf([0, 0.25, 0.115], [0, 0, 0], [0.153, 0.145, 0.15]), { bone: 'shell', color: id === 'coconut' ? '#d3b48b' : IVORY, outline: 0.025 });
    if (id === 'home') {
      for (const s of [-1, 1]) {
        ell(b, 'shell', [s * 0.137, 0.22, 0.12], [0.028, 0.035, 0.024], '#30283d');
        rod(b, 'shell', [s * 0.15, 0.27, 0.12], [s * 0.1, 0.36, 0.12], 0.012, '#bdb96c');
      }
    }
  }
  const e = b.build();
  paintRole(e, 'shell', (p, n, c) => {
    const a = Math.atan2(p.y - 0.31, p.x);
    const stripe = Math.sin(a * (id === 'coconut' ? 45 : 32) + p.z * 100);
    if (stripe > 0.86 || hash3(Math.floor(p.x * 130), Math.floor(p.y * 130), Math.floor(p.z * 130), 5) > 0.98) c.lerp(new THREE.Color(id === 'turban' ? '#6e9d76' : '#906347'), 0.6);
  });
  return buildSkinned({ entry: e, bones: [{ name: 'shell', pos: [0, 0.27, -0.1] }], name: `ruby-shell-${id}` });
}
export function buildRuby({ shell = 'home', size = 1 } = {}) {
  if (!RUBY_SHELLS.includes(shell)) throw new Error(`unknown Ruby shell ${shell}`);
  const body = bodyMesh(); let sh = shellMesh(shell), scale = 1;
  const { root, rig } = modelShell('pet-ruby', body.mesh); rig.add(sh.mesh);
  const state = { anim: 'idle', shell, size: 1, phase: 0, hide: 0 };
  const m = { root, rig, mesh: body.mesh, meshes: [body.mesh, sh.mesh], bones: body.bones, state, drawCalls: 4, length: 0.75 * PET.ruby.modelScale, height: 0.55 * PET.ruby.modelScale,
    setSize(k) { scale = Number.isFinite(k) ? Math.max(0.1, k) : 1; state.size = scale; rig.scale.setScalar(scale * PET.ruby.modelScale); },
    setShell(id) {
      if (!RUBY_SHELLS.includes(id)) throw new Error(`unknown Ruby shell ${id}`);
      if (id === state.shell) return;
      const next = shellMesh(id); sh.mesh.removeFromParent(); sh.geometry.dispose(); sh.skeleton.dispose(); sh = next;
      rig.add(sh.mesh); m.meshes[1] = sh.mesh; state.shell = id;
    },
    update(dt, t, { anim = 'idle', speed = 0 } = {}) {
      state.anim = anim; const cfg = PET.ruby; state.phase += dt * cfg.gaitRate * Math.max(0.4, speed);
      restPose(body.boneList); restPose(sh.boneList); sh.mesh.visible = anim !== 'swap';
      const moving = anim === 'walk' || anim === 'swap', ph = state.phase;
      const B = body.bones;
      B.bubbles.scale.setScalar(anim === 'bubbles' ? 1 : 0.001);
      B.bubbles.position.y += (t % PET.ruby.bubbleEvery) * 0.12;
      B.abdomen.scale.setScalar(anim === 'swap' ? 1 : 0.001);
      B.body.position.y += Math.sin(t * 3) * cfg.bob;
      sh.bones.shell.rotation.z = moving ? Math.sin(ph) * cfg.shellRock : Math.sin(t * 2) * 0.015;
      for (const s of [-1, 1]) {
        for (let i = 0; i < 3; i++) {
          const leg = B[`leg${s}:${i}`], a = ph + (i % 2 + (s > 0 ? 1 : 0)) * Math.PI;
          leg.rotation.y = moving ? Math.sin(a) * cfg.legSwing : 0;
          leg.rotation.z = moving ? s * Math.max(0, Math.cos(a)) * 0.22 : 0;
        }
        B[`antenna${s}`].rotation.y = Math.sin(t * 3 + s) * cfg.antennaSway;
        B[`claw${s}`].rotation.x = anim === 'dig' ? Math.sin(t * 10 + s) * 0.65 : anim === 'wave' && s < 0 ? -0.9 + Math.sin(t * 8) * 0.3 : Math.max(0, Math.sin(t * 2) - 0.85) * 1.5;
      }
      const hideWant = anim === 'hide' ? 1 : 0;
      state.hide += (hideWant - state.hide) * (dt > 0 ? 1 - Math.exp(-cfg.hideRate * dt) : 1);
      const h = state.hide;
      B.body.scale.setScalar(1 - h * 0.985); B.body.position.y += h * 0.05; B.body.position.z -= h * 0.15;
      B.eyes.position.z -= h * 0.12; B.eyes.position.y -= h * 0.11; B.eyes.scale.setScalar(1 - h * 0.35);
      if (anim === 'swap') B.body.position.x += Math.sin(t * 20) * 0.035;
    },
    dispose() { for (const sk of [body, sh]) { sk.geometry.dispose(); sk.skeleton.dispose(); } root.removeFromParent(); },
  };
  m.setSize(size); m.update(0, 0); return m;
}
