// The pets (PLAN Step 73a): small companions that glide after their player. This file is the MODEL KIT: `createPetModel(id)` assembles a pet from a table of builders (PET_BUILDERS), so every later pet
// adds one builder function and nothing else (the same idea as npc/tdoongz.js). Pure rules, ids and the wire format are game/petLogic.js; the follower runtime is world/pets.js.
//
//   const m = createPetModel('capray')
//   m.root          Group: origin at the pet's CENTRE (it flies, there are no feet), faces +Z (yaw 0), +X is its left; the runtime sets root.position / rotation (YXZ) and scale
//   m.rig           Group under root that the runtime rolls / pitches (banking) and bobs
//   m.tailPivot     Group at the tail root (rotation.y sways it, rotation.x lifts it); m.capsPivot the group holding the mushroom caps on the back (rotation.z rocks them)
//   m.headRest      Object3D at the tail's cap in rig space (used for the "rest the tail cap on the owner's head" idle)
//   m.wingspan / m.length / m.height   metres in model units (Capray: 1.1 / 1.6 with the tail / 0.3)
//   m.drawCalls     main-pass meshes + the body's shadow pass: 4 for Capray (budget: +4 per pet, no lights)
//   Carle uses buildButterfly (petsHome.js), one SkinnedMesh + shadow (2 calls), with its own update(dt, t, { anim: glide|flap|rest }).
//   m.update(dt, t, { sway, rocking })   tail sway and cap rocking (group rotations only: no per-frame geometry work)
//   m.dispose()     frees the geometries (the shared material stays)
//
// Shading: every pet shares ONE patched character toon material (petMaterial()): the character toon (vertex colours, aMark outline flag, stencil mark) plus
//   aGlow (vertex role -> emissive: x uGlow, which the runtime eases from PET.glowDay by day to PET.glowNight at night, so the glow reads by day and blooms in the dark) and
//   aWave (x: wing span weight -> the wings ripple in the vertex shader, a sine travelling along the span; y: tail weight -> the tail waves). No geometry rebuilds, no lights, +1 shader program for all pets.
// Meshes are merged, vertex-coloured, with the outline hull baked in (Baker for primitives; the manta disc is built by hand as one welded shell so its rim and hull close).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Baker, castMesh, makeToon, xf } from '../player/character.js';
import { sphere, sphereLo, cyl, surf, at } from './models.js';
import { PET } from '../config.js';
import { buildButterfly } from './petsHome.js';
import { PET_IDS } from '../game/petLogic.js';

const OUTLINE_HEX = '#2b2340';
const OUTLINE = new THREE.Color(OUTLINE_HEX);

// ---- the shared material and its uniforms
export const petUniforms = { uTime: { value: 0 }, uGlow: { value: PET.glowDay }, uAmp: { value: 0.085 } };
let _mat = null;
export function petMaterial() {
  if (_mat) return _mat;
  const m = makeToon({ value: 1 }, 'pet-toon');
  const base = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    base(shader, renderer);
    shader.uniforms.uTime = petUniforms.uTime;
    shader.uniforms.uGlow = petUniforms.uGlow;
    shader.uniforms.uAmp = petUniforms.uAmp;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aGlow;\nattribute vec2 aWave;\nuniform float uTime;\nuniform float uAmp;\nvarying float vGlow;')
      .replace('#include <begin_vertex>',
        '#include <begin_vertex>\nvGlow = aGlow;\n' +
        'float petPh = modelMatrix[3].x * 0.9 + modelMatrix[3].z * 0.7;\n' +                    // a different phase per pet, from its world place
        'transformed.y += aWave.x * uAmp * sin(uTime * 6.5 - abs(position.x) * 7.5 + petPh);\n' +  // the wing ripple travels outward along the span
        'transformed.x += aWave.y * 0.06 * sin(uTime * 3.2 + position.z * 5.0 + petPh);');        // the tail waves
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGlow;\nuniform float uGlow;')
      .replace('#include <opaque_fragment>', 'outgoingLight += diffuseColor.rgb * vGlow * uGlow;\n#include <opaque_fragment>');
  };
  m.customProgramCacheKey = () => 'pet-toon';
  m.shadowSide = THREE.FrontSide;
  _mat = m;
  return m;
}

// ---- helpers
const smoothstep = (a, b, v) => { const u = Math.min(1, Math.max(0, (v - a) / (b - a))); return u * u * (3 - 2 * u); };
const mixc = (a, b, k) => new THREE.Color(a).lerp(new THREE.Color(b), Math.min(1, Math.max(0, k)));
const hemi = () => new THREE.SphereGeometry(1, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2);

/** Give a Baker entry its two extra attributes: aGlow from the role ranges ({ role: strength }), aWave from a function of the vertex position (x: wings, y: tail). */
function decorate(entry, glowByRole, wave) {
  const geo = entry.geo, n = geo.attributes.position.count;
  const glow = new Float32Array(n);
  for (const [role, val] of Object.entries(glowByRole)) for (const [s, c] of entry.roles[role] || []) glow.fill(val, s, s + c);
  const w = new Float32Array(n * 2), p = geo.attributes.position;
  for (let i = 0; i < n; i++) { const r = wave(p.getX(i), p.getY(i), p.getZ(i)); w[i * 2] = r[0]; w[i * 2 + 1] = r[1]; }
  geo.setAttribute('aGlow', new THREE.BufferAttribute(glow, 1));
  geo.setAttribute('aWave', new THREE.BufferAttribute(w, 2));
  return geo;
}

// ---------------------------------------------------------------------------------------------
// Capray, the bioluminescent stingray (the reference sheet of 2026-10-15)
// ---------------------------------------------------------------------------------------------
const HS = 0.55;                                   // half span: a 1.1 u wingspan
const TAIL_ROOT = [0, 0.0, -0.3];
const C = {
  deep: '#31267f', mid: '#4e45b6', hump: '#4a3cae', spine: '#201650', gold: '#ffab3d', cyan: '#9ff2ff', spot: '#5fe3ff', spot2: '#5aa6ff',
  belly: '#ffc24f', bellyEdge: '#ee7a2c', violetEdge: '#8a5ad0', cap: '#7a52e0', capSpot: '#b9a2ff', gill: '#ff9d33', stalk: '#d4c2ff',
  eye: '#6b3510', eyeAmber: '#c8741c', white: '#ffffff', mouth: '#4a2438', tail: '#40349a',
};

/** The planform of the manta at span fraction u (-1..1) and chord fraction t (0 front .. 1 back): x, z, and the top / bottom heights. */
function planform(u, t) {
  const a = Math.abs(u);
  const chord = 0.70 * Math.pow(Math.max(0, 1 - Math.pow(a, 1.5)), 0.6) + 0.025;      // wide diamond with rounded tips
  const c = 0.05 - 0.14 * Math.pow(a, 1.2);                                              // the tips sweep back
  const droop = -0.10 * a * a;                                                           // the wings curve down toward the tips
  const tt = 1 - t;                                                                      // t = 0 is the BACK edge in the grid; flip so t = 0 is the front for the colours
  const z = c + chord * (tt - 0.5);
  const th = 0.17 * Math.pow(Math.max(0, 1 - Math.pow(a, 1.6)), 0.9) * Math.pow(4 * t * (1 - t), 0.55);
  return { x: u * HS, z, droop, up: droop + th / 2, down: droop - th / 2, a, edge: Math.abs(2 * t - 1) };
}

function topColor(f) {
  let c = mixc(C.deep, C.mid, smoothstep(0, 0.9, f.a));
  c = c.lerp(new THREE.Color(C.gold), smoothstep(0.78, 1.0, f.edge));
  c = c.lerp(new THREE.Color(C.cyan), smoothstep(0.8, 1.0, f.a) * 0.9);
  return c;
}
const topGlow = (f) => Math.min(1, smoothstep(0.78, 1.0, f.edge) + smoothstep(0.8, 1.0, f.a) * 0.6);
function bottomColor(f) {
  let c = mixc(C.belly, C.bellyEdge, smoothstep(0, 0.8, f.a));
  c = c.lerp(new THREE.Color(C.violetEdge), smoothstep(0.7, 0.95, f.a) * 0.45);
  return c;
}

const wingWave = (x) => smoothstep(0.1, 0.98, Math.abs(x) / HS);

/** The welded manta shell (top + bottom share the rim vertices, so the shell and its outline hull close): { geo } with position, normal, color, aMark, aGlow, aWave and an index. */
function buildDisc() {
  const NU = 20, NV = 6;
  const pos = [], col = [], glow = [], grid = [];
  const idx = (i, j) => i * (NV + 1) + j;
  const boundary = (i, j) => i === 0 || i === NU || j === 0 || j === NV;
  const topIndex = [], botIndex = [];
  for (let i = 0; i <= NU; i++) for (let j = 0; j <= NV; j++) {                          // top grid (also the rim)
    const u = -1 + (2 * i) / NU, t = j / NV, f = planform(u, t);
    const y = boundary(i, j) ? f.droop : f.up;
    topIndex[idx(i, j)] = pos.length / 3;
    pos.push(f.x, y, f.z);
    const c = topColor(f); col.push(c.r, c.g, c.b); glow.push(topGlow(f));
  }
  for (let i = 0; i <= NU; i++) for (let j = 0; j <= NV; j++) {                          // bottom grid, rim vertices shared
    if (boundary(i, j)) { botIndex[idx(i, j)] = topIndex[idx(i, j)]; continue; }
    const u = -1 + (2 * i) / NU, t = j / NV, f = planform(u, t);
    botIndex[idx(i, j)] = pos.length / 3;
    pos.push(f.x, f.down, f.z);
    const c = bottomColor(f); col.push(c.r, c.g, c.b); glow.push(0.85);
  }
  const index = [];
  for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) {
    const a = topIndex[idx(i, j)], b = topIndex[idx(i + 1, j)], c = topIndex[idx(i + 1, j + 1)], d = topIndex[idx(i, j + 1)];
    index.push(a, b, d, b, c, d);                                                          // faces up (+Y)
    const e = botIndex[idx(i, j)], f2 = botIndex[idx(i + 1, j)], g = botIndex[idx(i + 1, j + 1)], h = botIndex[idx(i, j + 1)];
    index.push(e, h, f2, f2, h, g);                                                        // faces down
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  // the outline hull: the same shell pushed out along its normals, reversed winding (an inverted hull), colour + flag like every Baker hull
  const n = pos.length / 3, nor = geo.attributes.normal, P = geo.attributes.position;
  const hullPos = [], hullNor = [], hullCol = [], mark = [];
  const out = 0.017;
  for (let i = 0; i < n; i++) {
    hullPos.push(P.getX(i) + nor.getX(i) * out, P.getY(i) + nor.getY(i) * out, P.getZ(i) + nor.getZ(i) * out);
    hullNor.push(nor.getX(i), nor.getY(i), nor.getZ(i));
    hullCol.push(OUTLINE.r, OUTLINE.g, OUTLINE.b);
  }
  const allPos = [...pos, ...hullPos], allNor = [...nor.array, ...hullNor], allCol = [...col, ...hullCol];
  for (let i = 0; i < n; i++) mark.push(0, 0, 0, 0);
  for (let i = 0; i < n; i++) mark.push(1, 0, 0, 1);
  const allIdx = [...index];
  for (let i = 0; i < index.length; i += 3) allIdx.push(n + index[i], n + index[i + 2], n + index[i + 1]);
  const out2 = new THREE.BufferGeometry();
  out2.setAttribute('position', new THREE.Float32BufferAttribute(allPos, 3));
  out2.setAttribute('normal', new THREE.Float32BufferAttribute(allNor, 3));
  out2.setAttribute('color', new THREE.Float32BufferAttribute(allCol, 3));
  out2.setAttribute('aMark', new THREE.Float32BufferAttribute(mark, 4));
  out2.setAttribute('aGlow', new THREE.Float32BufferAttribute([...glow, ...new Array(n).fill(0)], 1));
  const wave = new Float32Array(n * 4);
  for (let i = 0; i < 2 * n; i++) wave[i * 2] = wingWave(allPos[i * 3]);
  out2.setAttribute('aWave', new THREE.BufferAttribute(wave, 2));
  out2.setIndex(allIdx);
  return out2;
}

function buildBody() {
  const disc = buildDisc();
  const b = new Baker();
  // the head hump with the face on its front
  const hump = { y: 0.04, z: 0.2, a: 0.17, b: 0.085, c: 0.17 };
  const H = xf([0, hump.y, hump.z]);
  b.add(sphere(), xf([0, hump.y, hump.z], [0, 0, 0], [hump.a, hump.b, hump.c]), { color: C.hump, outline: 0.016 });
  const face = (x, y, lift = 0) => H.clone().multiply(surf(hump.a, hump.b, hump.c, x, y, lift));
  for (const s of [-1, 1]) {
    const m = face(0.082 * s, 0.014, -0.004);
    const eye = (geo, p, sc, color) => b.add(geo, at(m, p, [0, 0, 0], sc), { color, flat: 1 });
    eye(sphere(), [0, 0, 0], [0.056, 0.064, 0.024], C.eye);                                // big glossy dark-amber eyes
    eye(sphere(), [0, -0.006, 0.006], [0.04, 0.046, 0.022], C.eyeAmber);
    eye(sphereLo(), [0.018, 0.022, 0.018], [0.02, 0.02, 0.01], C.white);                    // the white highlights
    eye(sphereLo(), [-0.016, -0.02, 0.016], [0.009, 0.009, 0.006], C.white);
  }
  for (const s of [-1, 1]) {                                                                // the small "w" smile on the front edge
    b.add(new THREE.TorusGeometry(0.022, 0.0058, 4, 9, Math.PI), at(face(0.024 * s, -0.036, 0.002), [0, 0, 0], [0, 0, Math.PI]), { color: C.mouth, flat: 1 });
  }
  // the spine line: dark oval beads down the middle of the back
  for (let k = 0; k < 7; k++) {
    const t = 0.1 + k * 0.1, f = planform(0, t);
    b.add(sphereLo(), xf([0, f.up + 0.004, f.z], [0, 0, 0], [0.02, 0.009, 0.055]), { color: C.spine });
  }
  // the cyan / blue spots, scattered over the wings (a small seeded list, mirrored loosely)
  const spots = [[0.28, 0.45, 0.04], [0.42, 0.62, 0.032], [0.55, 0.38, 0.036], [0.66, 0.55, 0.028], [0.78, 0.45, 0.024], [0.36, 0.28, 0.026], [0.5, 0.78, 0.03], [0.2, 0.7, 0.028], [0.7, 0.3, 0.022]];
  spots.forEach(([u, t, r], i) => {
    for (const s of [-1, 1]) {
      const uu = u * s * (s > 0 ? 1 : 0.93), tt = t + (s > 0 ? 0 : 0.05), f = planform(uu, tt);
      b.add(sphereLo(), xf([f.x, f.up + 0.002, f.z], [0, 0, -Math.atan2(2 * 0.1 * f.a, 1) * Math.sign(uu)], [r, 0.008, r * 1.1]), { color: (i + (s > 0 ? 0 : 1)) % 3 ? C.spot : C.spot2, role: 'g5' });
    }
  });
  const e = b.build();
  decorate(e, { g5: 0.55 }, (x) => [wingWave(x), 0]);
  const merged = mergeGeometries([disc, e.geo], false);
  disc.dispose(); e.geo.dispose();
  merged.computeBoundingSphere();
  merged.boundingSphere.radius += 0.12;                                                     // the wings ripple a little outside the rest bounds
  return merged;
}

/** A mushroom cap: a hemisphere dome with an orange glowing gill disc under it and a short pale stalk, placed with matrix m (dome up). */
function cap(b, m, r, { dome = C.cap, spots = true } = {}) {
  b.add(hemi(), at(m, [0, 0, 0], [0, 0, 0], [r, r * 0.62, r]), { color: dome, outline: 0.012 });
  b.add(cyl(14), at(m, [0, 0.002, 0], [0, 0, 0], [r * 0.93, 0.006, r * 0.93]), { color: C.gill, role: 'g1' });
  b.add(cyl(8), at(m, [0, -0.38 * r, 0], [0, 0, 0], [r * 0.2, r * 0.76, r * 0.2]), { color: C.stalk });
  if (spots) {
    for (const [dx, dz, k] of [[0.35, 0.2, 0.16], [-0.3, 0.3, 0.13], [0.0, -0.4, 0.14]]) {
      const y = r * 0.62 * Math.sqrt(Math.max(0.05, 1 - dx * dx - dz * dz));
      b.add(sphereLo(), at(m, [dx * r, y * 0.97, dz * r], [0, 0, 0], [r * k, r * k * 0.4, r * k]), { color: C.capSpot });
    }
  }
}

function buildCaps() {
  const b = new Baker();
  for (const s of [-1, 1]) cap(b, xf([0.12 * s, 0.092, 0.145], [0, 0, -0.38 * s]), 0.07);        // two small caps where ears would be
  const f = planform(0, 0.62);
  cap(b, xf([0, f.up - 0.006, f.z], [-0.12, 0, 0]), 0.125);                                       // the larger one on the back behind the head
  const e = b.build();
  decorate(e, { g1: 1 }, () => [0, 0]);
  return e.geo;
}

/** The long thin tail (a tapering chain of beads, violet into gold) ending in a glowing mushroom cap. Built in the tail pivot's space (origin at the root). */
function buildTail() {
  const b = new Baker();
  const N = 15, pts = [];
  for (let k = 0; k <= N; k++) {
    const s = k / N;
    pts.push({ s, x: 0, y: -0.11 * Math.sin(Math.PI * s * 0.85) + 0.07 * s * s, z: -0.78 * s, r: 0.036 * (1 - 0.72 * s) + 0.01 });
  }
  pts.forEach((p, k) => {
    const c = mixc(C.tail, C.gold, smoothstep(0.55, 1.0, p.s));
    b.add(sphereLo(), xf([p.x, p.y, p.z], [0, 0, 0], [p.r, p.r, p.r * 1.7]), { color: c, outline: 0.011, role: p.s > 0.7 ? 'g1' : null });
  });
  const end = pts[N], prev = pts[N - 2];
  const pitch = Math.atan2(end.y - prev.y, -(end.z - prev.z));                                     // the direction the tail points (up when positive)
  // the cap: dome pointing away from the tail (backward and a little up), gills toward the tail
  cap(b, xf([end.x, end.y, end.z - 0.02], [-Math.PI / 2 + pitch * 0.6, 0, 0]), 0.1, { dome: '#7650e6' });
  const e = b.build();
  decorate(e, { g1: 1 }, (x, y, z) => [0, Math.pow(Math.min(1, Math.max(0, -z / 0.78)), 1.3)]);
  return { geo: e.geo, endY: end.y, endZ: end.z };
}

function buildCapray() {
  const body = buildBody(), caps = buildCaps(), tail = buildTail();
  const mat = petMaterial();
  const root = new THREE.Group();
  root.name = 'pet-capray';
  const rig = new THREE.Group();
  rig.name = 'rig';
  root.add(rig);
  const bodyMesh = castMesh(body, mat, true);
  bodyMesh.name = 'pet-body';
  rig.add(bodyMesh);
  const capsPivot = new THREE.Group();
  capsPivot.name = 'caps';
  rig.add(capsPivot);
  const capsMesh = castMesh(caps, mat, false);
  capsMesh.name = 'pet-caps';
  capsPivot.add(capsMesh);
  const tailPivot = new THREE.Group();
  tailPivot.name = 'tail';
  tailPivot.position.set(...TAIL_ROOT);
  rig.add(tailPivot);
  const tailMesh = castMesh(tail.geo, mat, false);
  tailMesh.name = 'pet-tail';
  tailPivot.add(tailMesh);
  const headRest = new THREE.Object3D();                                                           // the tail cap's place in rig space
  headRest.position.set(TAIL_ROOT[0], TAIL_ROOT[1] + tail.endY, TAIL_ROOT[2] + tail.endZ);
  rig.add(headRest);
  return {
    root, rig, tailPivot, capsPivot, headRest, meshes: [bodyMesh, capsMesh, tailMesh], geometries: [body, caps, tail.geo],
    wingspan: HS * 2, length: 0.4 + 0.3 + 0.8, height: 0.3, drawCalls: 4,
  };
}

// ---------------------------------------------------------------------------------------------
/** Registry order = PET_IDS (game/petLogic.js). `hint` is the stable's line for a pet that is not unlocked yet (73b); `name` the label. */
export const PETS = [
  { id: 'capray', name: 'Capray', species: 'stingray', build: buildCapray },
  { id: 'carle', name: 'Carle', species: 'butterfly', build: buildButterfly },
];
export const PET_BUILDERS = Object.fromEntries(PETS.map((p) => [p.id, p.build]));
if (PETS.some((p, i) => p.id !== PET_IDS[i]) || PETS.length !== PET_IDS.length) throw new Error('npc/pets.js PETS must match game/petLogic.js PET_IDS');

export function createPetModel(id) {
  const build = PET_BUILDERS[id];
  if (!build) throw new Error(`unknown pet "${id}"`);
  const m = build();
  if (m.update) return { ...m, id };
  let t = 0;
  return {
    id, root: m.root, rig: m.rig, tailPivot: m.tailPivot, capsPivot: m.capsPivot, headRest: m.headRest, meshes: m.meshes,
    wingspan: m.wingspan, length: m.length, height: m.height, drawCalls: m.drawCalls,
    update(dt, time, { sway = 1, rocking = 1 } = {}) {
      t = time;
      m.tailPivot.rotation.y = Math.sin(t * 2.1) * 0.22 * sway;
      m.tailPivot.rotation.x = Math.sin(t * 1.4 + 1) * 0.07 * sway;
      m.capsPivot.rotation.z = Math.sin(t * 2.6) * 0.045 * rocking;
      m.capsPivot.rotation.x = Math.sin(t * 1.9 + 0.5) * 0.03 * rocking;
    },
    dispose() { for (const g of m.geometries) g.dispose(); m.root.removeFromParent(); },
  };
}
