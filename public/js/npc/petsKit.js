// Shared helpers for the work-in-progress pet models (PLAN Step 74a: npc/petsHome.js = caterpillar / cocoon / butterfly, npc/petsFrost.js = the wolf).
//
// All four models are ONE SkinnedMesh each on the shared pet material (npc/pets.js petMaterial()): the primitives and their baked #2b2340 outline hulls are merged like Capray's, every vertex is bound
// to a single bone (rigid skinning, weight 1), and the pets animate by rotating / moving the bones (no geometry rewrites, no per-part meshes). A model is therefore 1 main draw call + 1 shadow draw
// call, and the whole family adds exactly one shader program: the SKINNED variant of 'pet-toon' (the plain variant is Capray's, unchanged).
//
//   const sb = new SkinBaker(['root', 'head'])      a Baker whose add(geo, m, { ..., bone: 'head' }) binds the primitive (and its hull) to that bone; addRaw({ pos, nor, col, idx }, { bone, flat }) takes hand-built triangles
//   const e = sb.build()                            { geo (position, normal, color, aMark, skinIndex, skinWeight), roles }
//   paintRole(e, role, (p, n, c, i) => {})          recolour every body vertex of a role from its position / normal (the deterministic "painted tissue paper" mottling); hulls are never touched
//   buildSkinned({ entry, bones, name, glow })      -> { mesh, bones: { name: Bone }, skeleton, geometry }; `bones` = [{ name, parent?, pos: [x, y, z] }], pos = the bone's REST place in model space
//   vnoise(x, y, z, seed) / hash3(...)              deterministic value noise in 0..1 (no Math.random anywhere: tests and screenshots are stable)
//   triangleCount(geo) / sizeOf(root)               measuring
import * as THREE from 'three';
import { Baker, castMesh } from '../player/character.js';
import { petMaterial } from './pets.js';

export const OUTLINE_HEX = '#2b2340';
export const smoothstep = (a, b, v) => { const u = Math.min(1, Math.max(0, (v - a) / (b - a))); return u * u * (3 - 2 * u); };
export const lerp = (a, b, k) => a + (b - a) * k;
export const clamp01 = (v) => Math.min(1, Math.max(0, v));
export const mixc = (a, b, k) => new THREE.Color(a).lerp(new THREE.Color(b), clamp01(k));

// ---- deterministic noise ------------------------------------------------------------------------------------------------------------------------------------------------------
/** An integer hash of a lattice point -> [0, 1). */
export function hash3(x, y, z, seed = 0) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 1103515245) + Math.imul(seed | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
/** Smooth value noise in [0, 1): trilinear between the lattice hashes. */
export function vnoise(x, y, z, seed = 0) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const h = (a, b, c) => hash3(ix + a, iy + b, iz + c, seed);
  const x00 = lerp(h(0, 0, 0), h(1, 0, 0), u), x10 = lerp(h(0, 1, 0), h(1, 1, 0), u);
  const x01 = lerp(h(0, 0, 1), h(1, 0, 1), u), x11 = lerp(h(0, 1, 1), h(1, 1, 1), u);
  return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w);
}
/** "Painted tissue paper": `base` drifts toward `alt` where a slow noise is high, with a finer brightness jitter on top. Returns a new Color. */
export function tissue(base, alt, x, y, z, { seed = 0, scale = 14, jitter = 0.1, bias = 0.5 } = {}) {
  const k = smoothstep(bias - 0.18, bias + 0.18, vnoise(x * scale, y * scale, z * scale, seed));
  const c = new THREE.Color(base).lerp(new THREE.Color(alt), k);
  const j = 1 + (vnoise(x * scale * 3.1, y * scale * 3.1, z * scale * 3.1, seed + 7) - 0.5) * 2 * jitter;
  return c.multiplyScalar(j);
}

// ---- the skinned baker ------------------------------------------------------------------------------------------------------------------------------------------------------------
export class SkinBaker extends Baker {
  /** @param {string[]} boneNames the bone order (index = skinIndex). */
  constructor(boneNames) {
    super();
    this.boneNames = boneNames;
    this.skin = [];
  }

  _bone(name) {
    const i = this.boneNames.indexOf(name);
    if (i < 0) throw new Error(`SkinBaker: unknown bone "${name}"`);
    return i;
  }

  /** Like Baker.add, plus `bone` (name): every vertex the call creates (body, inner copy, hull) follows that bone. */
  add(geo, m, o) {
    const n0 = this.n, bi = this._bone(o.bone ?? this.boneNames[0]);
    super.add(geo, m, o);
    for (let i = n0; i < this.n; i++) this.skin[i] = bi;
  }

  /** Hand-built triangles: { pos, nor, col } flat arrays and `idx`; `flat` is the aMark flat weight (1 = unlit flat colour); `hull` marks them as an outline hull (skipped by the shadow pass). */
  addRaw({ pos, nor, col, idx }, { bone, flat = 0, hull = false }) {
    const bi = this._bone(bone), b0 = this.n, n = pos.length / 3;
    for (let i = 0; i < n; i++) {
      this.pos.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
      this.nor.push(nor[i * 3], nor[i * 3 + 1], nor[i * 3 + 2]);
      this.col.push(col[i * 3], col[i * 3 + 1], col[i * 3 + 2]);
      if (hull) this.mark.push(1, 0, 0, 1); else this.mark.push(flat, 0, 0, 0);
      this.skin[b0 + i] = bi;
    }
    for (const k of idx) this.idx.push(b0 + k);
    this.n += n;
  }

  build() {
    const e = super.build();
    const n = this.n, si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { si[i * 4] = this.skin[i] ?? 0; sw[i * 4] = 1; }
    e.geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    e.geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    return e;
  }
}

const _p = new THREE.Vector3(), _n = new THREE.Vector3(), _c = new THREE.Color();
/** Recolour the body vertices of `role` (never the hulls): fn(position, normal, color (edit in place), vertexIndex). */
export function paintRole(entry, role, fn) {
  const g = entry.geo, P = g.attributes.position, N = g.attributes.normal, C = g.attributes.color;
  for (const [s, count] of entry.roles[role] || []) {
    for (let i = s; i < s + count; i++) {
      _p.fromBufferAttribute(P, i); _n.fromBufferAttribute(N, i); _c.setRGB(C.getX(i), C.getY(i), C.getZ(i));
      fn(_p, _n, _c, i);
      C.setXYZ(i, _c.r, _c.g, _c.b);
    }
  }
}

/**
 * Turn a baked entry into a SkinnedMesh on the shared pet material. Adds the (zero) aGlow / aWave attributes the pet shader reads; `glow` = { role: strength } fills aGlow for those roles.
 * @param {{ entry, bones: {name:string, parent?:string, pos:number[]}[], name:string, glow?:object, cast?:boolean }} o
 */
export function buildSkinned({ entry, bones, name, glow = null, cast = true }) {
  const geo = entry.geo, n = geo.attributes.position.count;
  const g = new Float32Array(n);
  if (glow) for (const [role, val] of Object.entries(glow)) for (const [s, c] of entry.roles[role] || []) g.fill(val, s, s + c);
  geo.setAttribute('aGlow', new THREE.BufferAttribute(g, 1));
  geo.setAttribute('aWave', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  geo.computeBoundingSphere();
  const mesh = new THREE.SkinnedMesh(geo, petMaterial());
  mesh.name = name;
  mesh.frustumCulled = false;                       // animated pivots leave the rest-pose bounds; a pet is tiny, so never cull it
  mesh.castShadow = cast;
  if (cast) mesh.customDepthMaterial = castMesh(geo, mesh.material, true).customDepthMaterial;   // the body shadow pass without the outline hull
  const byName = {}, list = bones.map((d) => {
    const b = new THREE.Bone();
    b.name = d.name; byName[d.name] = b;
    return b;
  });
  bones.forEach((d, i) => {
    const b = list[i];
    if (d.parent) {
      const pd = bones.find((x) => x.name === d.parent);
      b.position.set(d.pos[0] - pd.pos[0], d.pos[1] - pd.pos[1], d.pos[2] - pd.pos[2]);
      byName[d.parent].add(b);
    } else {
      b.position.set(...d.pos);
      mesh.add(b);
    }
    b.userData.rest = { pos: b.position.clone(), world: new THREE.Vector3(...d.pos) };
  });
  mesh.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(list);
  mesh.bind(skeleton, mesh.matrixWorld);
  return { mesh, bones: byName, boneList: list, skeleton, geometry: geo };
}

/**
 * A smooth tapered tube along a curve (points = [[x, y, z], ...]), radius r(u) and colour colorFn(u) -> Color along it (u 0..1), with an inverted-hull outline of width `outline`. Bound to one bone.
 * Rings use a fixed "up" reference, so keep the curve away from that axis (default +Z).
 */
export function tube(sb, bone, points, radius, colorFn, { sides = 8, outline = 0.006, up = [0, 0, 1] } = {}) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  const rings = 12, pos = [], nor = [], cc = [], idx = [], hp = [], hn = [], hc = [];
  const O = new THREE.Color(OUTLINE_HEX), U = new THREE.Vector3(...up);
  for (let i = 0; i <= rings; i++) {
    const u = i / rings, p = curve.getPoint(u), T = curve.getTangent(u), N = new THREE.Vector3().crossVectors(T, U).normalize(), Bn = new THREE.Vector3().crossVectors(T, N).normalize();
    const r = radius(u), c = colorFn(u);
    for (let j = 0; j < sides; j++) {
      const a = (j / sides) * Math.PI * 2, d = N.clone().multiplyScalar(Math.cos(a)).addScaledVector(Bn, Math.sin(a));
      pos.push(p.x + d.x * r, p.y + d.y * r, p.z + d.z * r); nor.push(d.x, d.y, d.z); cc.push(c.r, c.g, c.b);
      hp.push(p.x + d.x * (r + outline), p.y + d.y * (r + outline), p.z + d.z * (r + outline)); hn.push(d.x, d.y, d.z); hc.push(O.r, O.g, O.b);
    }
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < sides; j++) {
    const a = i * sides + j, b = i * sides + ((j + 1) % sides), c2 = (i + 1) * sides + ((j + 1) % sides), d = (i + 1) * sides + j;
    idx.push(a, d, c2, a, c2, b);
  }
  sb.addRaw({ pos, nor, col: cc, idx: reverseTris(idx) }, { bone });
  sb.addRaw({ pos: hp, nor: hn, col: hc, idx }, { bone, hull: true });
}
const reverseTris = (idx) => { const o = []; for (let i = 0; i < idx.length; i += 3) o.push(idx[i], idx[i + 2], idx[i + 1]); return o; };

/** Baker outline thickness for a primitive scaled by `s` (number or [x, y, z]): the hull is offset in the primitive's own unit space and then scaled, so divide the wanted world width (k) by the size. */
export const hull = (s, k = 0.0065) => {
  const size = Array.isArray(s) ? (s[0] + s[1] + s[2]) / 3 : s;
  return Math.min(0.26, Math.max(0.02, k / Math.max(size, 1e-4)));
};

// ---- measuring ------------------------------------------------------------------------------------------------------------------------------------------------------------------------
export const triangleCount = (geo) => (geo.index ? geo.index.count : geo.attributes.position.count) / 3;

/** The size of a model's skinned bounds right now (bone transforms applied): { x, y, z, box }. */
export function sizeOf(root) {
  root.updateMatrixWorld(true);
  root.traverse((o) => { if (o.isSkinnedMesh) { o.skeleton.update?.(); o.boundingBox = null; } });
  const box = new THREE.Box3().setFromObject(root);
  const s = box.getSize(new THREE.Vector3());
  return { x: s.x, y: s.y, z: s.z, box };
}

/** Reset every bone to its rest pose (rotation 0, scale 1, rest position). */
export function restPose(boneList) {
  for (const b of boneList) { b.position.copy(b.userData.rest.pos); b.rotation.set(0, 0, 0); b.scale.set(1, 1, 1); }
}

/** The common model shell: root > rig > skinned mesh. */
export function modelShell(name, mesh) {
  const root = new THREE.Group(); root.name = name;
  const rig = new THREE.Group(); rig.name = 'rig';
  root.add(rig); rig.add(mesh);
  return { root, rig };
}

export function disposeModel(m) {
  m.geometry.dispose();
  m.skeleton.dispose();
  m.root.removeFromParent();
}

export { xf } from '../player/character.js';
