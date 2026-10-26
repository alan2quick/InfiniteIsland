// The home island pet, "carle" (PLAN Step 74a: models only, NOT in the pet registry): a caterpillar that becomes a cocoon that becomes a butterfly, styled after Eric Carle's
// The Very Hungry Caterpillar (collage colour panels, mottled "painted tissue paper", the red head with yellow-and-green eyes and purple antennae). Chunky toon style with the #2b2340 outline hull.
//
//   const m = buildCaterpillar() | buildCocoon() | buildButterfly()          (npc/petsWip.js maps them to 'carle:caterpillar' / 'carle:cocoon' / 'carle:butterfly')
//   m.root          Group, faces +Z, +X is the pet's left. Origin at the FEET (caterpillar), at the THREAD'S TOP (cocoon), at the body's CENTRE (butterfly)
//   m.rig           Group under root (the butterfly's body bob lives here)
//   m.mesh / m.meshes   ONE SkinnedMesh on the shared pet material (shader variant: skinned 'pet-toon'); m.drawCalls = 2 (the mesh + its shadow pass)
//   m.length / m.height / m.wingspan   metres in model units, measured from the rest pose
//   m.update(dt, t, { anim, speed, crack })      bones only, no geometry work. Caterpillar anims: 'idle' | 'crawl' (alias 'walk') | 'nibble'. Cocoon: 'idle' | 'wiggle' | 'hatch' (+ crack(k), or opts.crack).
//                                                Butterfly: 'idle' (= 'glide') | 'glide' | 'flap' (fast flutter) | 'rest' (wings folded up over the back)
//   m.dispose()     frees the geometry and the skeleton (the shared material stays)
//   Caterpillar pivots: headPivot (bone), segments[] (bones seg0 tail .. seg10 front), chain(phase, k) pure helper `crawlChain`. Cocoon: shellPivot, flapL, flapR, thread (inside the shell) and crack(k).
//   Butterfly pivots: wingL, wingR, bodyPivot.
//
// Pure helpers worth testing without a renderer: segRadius, crawlChain, SEG_GREENS, wingPanels, butterflyFlap, cocoonShake.
import * as THREE from 'three';
import { xf } from '../player/character.js';
import { surf, at } from './models.js';
import {
  SkinBaker, tube, paintRole, buildSkinned, modelShell, disposeModel, sizeOf, restPose, tissue, vnoise, hash3, hull, smoothstep, lerp, clamp01,
} from './petsKit.js';

const D = Math.PI / 180;
const sph = (w = 12, h = 8) => new THREE.SphereGeometry(1, w, h);
const cone = (n = 5) => new THREE.ConeGeometry(1, 1, n);
const cylg = (n = 8) => new THREE.CylinderGeometry(1, 1, 1, n);
/** An ellipsoid (centre p, semi-axes s) bound to `bone`. */
function ell(sb, bone, p, s, color, o = {}) {
  sb.add(sph(o.w || 12, o.h || 8), xf(p, o.r || [0, 0, 0], s), { color, bone, role: o.role || null, outline: o.outline ?? hull(s), flat: o.flat || 0 });
}
const col = (hex) => new THREE.Color(hex);

/** The red head of the caterpillar and the butterfly (the same pet): a red ellipsoid with the big yellow eyes with green centres and a dark pupil dot, two nostril dots. */
function carleHead(sb, bone, centre, [A, B, C], { eye = 1, role = 'head' } = {}) {
  const H = xf(centre);
  ell(sb, bone, centre, [A, B, C], '#df2a1e', { role, outline: hull([A, B, C], 0.008) });
  const face = (x, y, lift = 0) => H.clone().multiply(surf(A, B, C, x, y, lift));
  for (const s of [-1, 1]) {
    const m = face(0.46 * A * s, 0.16 * B, -0.002 * eye);
    const part = (p, sc, color) => sb.add(sph(10, 6), at(m, p, [0, 0, 0], sc), { color, bone, flat: 1 });
    part([0, 0, 0], [0.34 * A * eye, 0.42 * B * eye, 0.13 * A * eye], '#f4de2c');                           // the big yellow oval
    part([0, -0.004 * eye, 0.01 * eye], [0.24 * A * eye, 0.31 * B * eye, 0.1 * A * eye], '#55b43b');         // green ring
    part([0, -0.004 * eye, 0.02 * eye], [0.14 * A * eye, 0.19 * B * eye, 0.07 * A * eye], '#1f7a3c');        // darker green centre
    part([0.01 * eye, 0.005 * eye, 0.03 * eye], [0.06 * A * eye, 0.08 * B * eye, 0.04 * A * eye], '#241a33'); // the pupil dot
  }
  for (const s of [-1, 1]) {
    const m = face(0.12 * A * s, -0.34 * B, 0);
    sb.add(sph(6, 4), at(m, [0, 0, 0], [0, 0, 0], [0.07 * A, 0.05 * A, 0.04 * A]), { color: '#3a1830', bone, flat: 1 });
  }
}

// ---------------------------------------------------------------------------------------------
// The caterpillar
// ---------------------------------------------------------------------------------------------
export const CAT = { n: 11, gap: 0.05, foot: 0.05, headY: 0.2, headLead: 0.09, arch: 0.15, feet: [0, 2, 8, 10] };
/** The resting hump (like the book cover): 0 on the ground at both ends, 1 across the middle segments; s = segment position 0 (tail) .. 1 (head). */
export const archAt = (s) => smoothstep(0.2, 0.5, s) * (1 - smoothstep(0.5, 0.8, s));
/** Segment radius: small at the tail, biggest a little past the middle, a bit smaller again before the head. */
export const segRadius = (i, n = CAT.n) => 0.074 + 0.046 * Math.pow(Math.sin(Math.PI * Math.pow((i + 0.5) / n, 1.3)), 0.85);
/** The green of each segment (yellow-green, grass, emerald, a dark green, ...): Carle's tissue-paper greens. */
export const SEG_GREENS = ['#a6cc3a', '#3fae3c', '#1a9a58', '#1f6d3a', '#79b93a', '#2fa24a', '#15845a', '#8cc63c', '#2a8f3e', '#1e7a4a', '#5db541'];
const HAIR = ['#f6d640', '#f08a2a', '#9fd6ee'];                                    // yellow, orange, pale blue fringe
const restZ = (i, n = CAT.n) => (i - (n - 1) / 2) * CAT.gap;

/**
 * The inch-worm chain for a crawl phase (0..1, one full cycle) and crawl strength k (0 = the resting hump, 1 = crawling with the bump travelling over it): per segment the height y, the place z and the pitch (radians, nose up
 * positive), plus the head's place. The arch is a bump that travels from the tail (segment 0) to the head; the segments under it bunch up, so the worm really inches.
 */
export function crawlChain(phase, k, n = CAT.n) {
  const amp = 0.17 * k, w = (phase % 1) * 2.2 - 0.6, lift = [], y = [], z = [], pitch = [];
  for (let i = 0; i < n; i++) lift.push(CAT.arch * archAt(i / (n - 1)) * (1 - 0.55 * k) + amp * Math.exp(-(((i / (n - 1) - w) / 0.26) ** 2)));   // the resting hump (it relaxes a little while crawling) + the travelling bump
  let zz = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0) zz += CAT.gap * (1 - 0.42 * ((lift[i] + lift[i - 1]) / 2) / 0.17);
    z.push(zz);
  }
  const mean = z.reduce((a, b) => a + b, 0) / n;
  for (let i = 0; i < n; i++) { z[i] -= mean; y.push(CAT.foot + segRadius(i, n) + lift[i]); }
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    pitch.push(Math.atan2(y[b] - y[a], z[b] - z[a]));
  }
  const p = pitch[n - 1];
  const head = { z: z[n - 1] + CAT.headLead * Math.cos(p), y: y[n - 1] + (CAT.headY - CAT.foot - segRadius(n - 1, n)) + CAT.headLead * Math.sin(p), pitch: p };
  return { y, z, pitch, head, lift };
}

function paintSegment(entry, i) {
  const base = SEG_GREENS[i % SEG_GREENS.length], teal = i % 3 === 1 ? '#2aa39c' : '#2c8fa8';
  paintRole(entry, `seg${i}`, (p, n, c) => {
    const t = tissue(base, i % 2 ? '#d9e25a' : '#0f6e3c', p.x, p.y, p.z, { seed: 11 + i * 3, scale: 20, jitter: 0.12 });
    const streak = smoothstep(0.66, 0.8, vnoise(p.x * 9, p.y * 46, p.z * 9, 91 + i));   // thin teal-blue streaks across some segments
    c.copy(t).lerp(col(teal), streak * (i % 2 ? 0.7 : 0.35));
  });
}

function buildCaterpillarMesh() {
  const n = CAT.n, names = [...Array.from({ length: n }, (_, i) => `seg${i}`), 'head'];
  const sb = new SkinBaker(names);
  for (let i = 0; i < n; i++) {
    const r = segRadius(i), z = restZ(i), yc = CAT.foot + r, bone = `seg${i}`;
    ell(sb, bone, [0, yc, z], [0.95 * r, r, 0.62 * r], '#4fae3a', { role: bone, outline: hull(r, 0.0075) });
    if (CAT.feet.includes(i)) for (const s of [-1, 1]) ell(sb, bone, [0.45 * r * s, 0.024, z], [0.026, 0.026, 0.024], '#7a4a2c', { w: 8, h: 5, outline: 0.16 });   // small brown stub feet, only under segments that touch the ground
    const hairs = 6;                                                                                               // a short fine fringe round the rim (in the segment's disc plane): about a third of the hairs, half the length
    for (let q = 0; q < hairs; q++) {
      const a = (q / hairs) * Math.PI * 2 + 0.3 + (i % 2) * 0.5, len = r * (0.17 + 0.1 * hash3(i, q, 1, 5));
      const rim = [Math.cos(a) * 0.93 * r, yc + Math.sin(a) * 0.98 * r, z];
      const centre = [rim[0] + Math.cos(a) * len * 0.4, rim[1] + Math.sin(a) * len * 0.4, rim[2]];
      sb.add(cone(3), xf(centre, [0, 0, a - Math.PI / 2], [0.0042, len, 0.0042]), { color: HAIR[(q + i) % 3], bone, outline: 0, flat: 0.65 });
    }
  }
  // the red head: bigger than a segment, with the yellow eyes, the purple-to-blue antennae
  const hz = restZ(n - 1) + CAT.headLead, A = 0.122, B = 0.144, C = 0.115, hc = [0, CAT.headY, hz];
  carleHead(sb, 'head', hc, [A, B, C], { role: 'head' });
  const mouth = xf(hc).multiply(surf(A, B, C, 0, -0.077, 0));
  sb.add(new THREE.TorusGeometry(0.03, 0.006, 4, 9, Math.PI), at(mouth, [0, 0, 0], [0, 0, Math.PI]), { color: '#3a1830', bone: 'head', flat: 1 });
  for (const s of [-1, 1]) {                                                                                       // antennae: smooth thick tapered stalks curving up and out, violet -> blue -> lilac tip
    const base = [0.045 * s, hc[1] + B * 0.9, hz - 0.01];
    const pts = [[0, 0, 0], [0.025 * s, 0.05, 0.004], [0.065 * s, 0.1, 0.012], [0.115 * s, 0.14, 0.02]].map((d) => [base[0] + d[0], base[1] + d[1], base[2] + d[2]]);
    const violet = new THREE.Color('#7a3fae'), blue = new THREE.Color('#4f6bd6'), lilac = new THREE.Color('#c9a8f0');
    tube(sb, 'head', pts, (u) => 0.024 - 0.008 * u, (u) => (u < 0.55 ? violet.clone().lerp(blue, u / 0.55) : blue.clone().lerp(lilac, (u - 0.55) / 0.45)), { sides: 8, outline: 0.0055 });
    const tip = pts[3];
    ell(sb, 'head', [tip[0] + 0.012 * s, tip[1] + 0.012, tip[2] + 0.004], [0.027, 0.033, 0.025], '#c9a8f0', { w: 10, h: 7, outline: 0.2 });
  }
  const e = sb.build();
  for (let i = 0; i < n; i++) paintSegment(e, i);
  paintRole(e, 'head', (p, nn, c) => { c.copy(tissue('#e02a1e', '#f4601f', p.x, p.y, p.z, { seed: 71, scale: 18, jitter: 0.08, bias: 0.55 })); });
  const bones = [
    ...Array.from({ length: n }, (_, i) => ({ name: `seg${i}`, pos: [0, CAT.foot + segRadius(i), restZ(i)] })),
    { name: 'head', pos: [0, CAT.headY, hz] },
  ];
  return buildSkinned({ entry: e, bones, name: 'pet-caterpillar' });
}

export function buildCaterpillar() {
  const sk = buildCaterpillarMesh();
  const { root, rig } = modelShell('pet-caterpillar', sk.mesh);
  const n = CAT.n, segs = Array.from({ length: n }, (_, i) => sk.bones[`seg${i}`]), headPivot = sk.bones.head;
  const st = { k: 0, phase: 0, look: 0, nib: 0 };
  const model = {
    id: 'carle:caterpillar', kind: 'caterpillar', root, rig, mesh: sk.mesh, meshes: [sk.mesh], geometries: [sk.geometry], skeleton: sk.skeleton, bones: sk.bones,
    segments: segs, headPivot, drawCalls: 2, length: 0, height: 0, state: st,
    update(dt, t, { anim = 'idle', speed = 1 } = {}) {
      const crawling = anim === 'crawl' || anim === 'walk', nibbling = anim === 'nibble';
      st.k += ((crawling ? 1 : 0) - st.k) * Math.min(1, dt * 4);
      if (crawling) st.phase = (st.phase + dt * 0.62 * speed) % 1;
      const ch = crawlChain(st.phase, st.k);
      const breathe = 1 + 0.018 * Math.sin(t * 2.2);
      for (let i = 0; i < n; i++) {
        const b = segs[i];
        b.position.set(0, ch.y[i], ch.z[i]);
        b.rotation.set(-ch.pitch[i], 0, 0);
        b.scale.set(1, breathe, 1 + 0.012 * Math.sin(t * 2.2 + i * 0.5));
      }
      // the head: follows the chain's end, looks around when idle, nibbles (quick dips) when asked
      st.look += ((anim === 'idle' ? 1 : crawling ? 0.25 : 0.4) - st.look) * Math.min(1, dt * 3);
      const lookWin = smoothstep(0.1, 0.2, (t % 9) / 9) * (1 - smoothstep(0.42, 0.52, (t % 9) / 9));   // it glances about only now and then, then faces front again
      const yaw = Math.sin(t * 1.5) * 0.5 * lookWin * st.look;
      const dip = nibbling ? Math.max(0, Math.sin(t * 9)) * 0.38 + 0.22 : Math.pow(Math.max(0, Math.sin(t * 0.7 + 1)), 6) * 0.2 * st.look;
      const bob = crawling ? Math.sin(st.phase * Math.PI * 2 * 2) * 0.02 * st.k : 0;
      headPivot.position.set(0, ch.head.y + bob - dip * 0.05, ch.head.z + dip * 0.02);
      headPivot.rotation.set(-ch.head.pitch * 0.5 + dip + Math.sin(t * 0.8) * 0.06 * st.look, yaw, Math.sin(t * 0.9) * 0.05 * st.look);
    },
    dispose() { disposeModel({ geometry: sk.geometry, skeleton: sk.skeleton, root }); },
  };
  model.update(0, 0, { anim: 'idle' });                          // start in the resting hump, not the flat bind pose
  const size = sizeOf(root);
  model.length = size.z; model.height = size.y;
  return model;
}

// ---------------------------------------------------------------------------------------------
// The cocoon
// ---------------------------------------------------------------------------------------------
const COCOON = { yTop: -0.1, h: 0.34, rMax: 0.15, split: 0.58 };
// a plump rounded teardrop: t = 0 is the round fat bottom, t = 1 the narrow top at the thread; the widest point is in the lower third
const cocoonR = (t) => COCOON.rMax * Math.pow(Math.max(0, Math.sin(Math.PI * Math.pow(t, 0.8))), 0.62);
const BANDS = ['#5e3a22', '#9a4f24', '#c9923f', '#6d6a30', '#8a4a22', '#b8793a', '#4d3220', '#7b6a30', '#a35a28'];   // umber, chestnut, ochre, olive, brown, tan, dark umber, olive-ochre, rust

/** Which torn-paper strip a point of the shell is in (0..8) and how close it is to a strip's torn edge (0 = on the edge). The strips wrap round the shell at slight angles (each edge tilts with the angle round the axis, a different way for each edge) and the edges are torn with a little noise. */
export function cocoonBand(t, ang, seed = 3) {
  const edges = [0.1, 0.22, 0.34, 0.46, 0.58, 0.7, 0.82, 0.92];
  let band = 0, dEdge = 1;
  edges.forEach((e, k) => {
    const wob = Math.sin(ang + k * 1.9) * 0.06 * (k % 2 ? 1 : -1) + (vnoise(ang * 3.1 + k * 7, k * 3.3, 0.5, seed) - 0.5) * 0.03;
    if (t > e + wob) band = k + 1;
    dEdge = Math.min(dEdge, Math.abs(t - (e + wob)));
  });
  return { band, dEdge };
}

function lathe(t0, t1, phiStart, phiLen, N = 18) {
  const pts = [];
  for (let k = 0; k <= N; k++) { const t = lerp(t0, t1, k / N); pts.push(new THREE.Vector2(Math.max(0.0015, cocoonR(t)), COCOON.yTop - COCOON.h + t * COCOON.h)); }
  return new THREE.LatheGeometry(pts, phiLen < 6 ? 14 : 28, phiStart, phiLen);
}

function buildCocoonMesh() {
  const sb = new SkinBaker(['twig', 'shell', 'flapL', 'flapR']);
  // the twig, with one green leaf (static): a bark-brown branch above the thread, a stub twig, a leaf with a vein
  const stick = (bone, p, rot, r, len, color, role = null) => {                              // an open tube with a hull (sideways only) + dark end discs: a plain hull would also grow past the caps
    sb.add(new THREE.CylinderGeometry(1, 1, 1, 8, 1, true), xf(p, rot, [r, len, r]), { color, bone, role, outline: 0.28 });   // open tube: the hull grows sideways only
    sb.add(cylg(8), xf(p, rot, [r, len, r]), { color, bone, role, outline: 0 });
    for (const e of [-1, 1]) sb.add(cylg(8), xf(p, rot).multiply(xf([0, e * (len / 2 + 0.0015), 0], [0, 0, 0], [r + 0.004, 0.003, r + 0.004])), { color: '#2b2340', bone, flat: 1 });
  };
  stick('twig', [0.04, 0.026, 0], [0, 0, Math.PI / 2 + 0.1], 0.02, 0.56, '#7b5230', 'twig');
  stick('twig', [0.19, 0.06, 0.0], [0.0, 0, -0.55], 0.011, 0.12, '#7b5230', 'twig');
  sb.add(sph(10, 6), xf([-0.1, 0.034, 0.03], [0, 0, 0], [0.032, 0.026, 0.03]), { color: '#6a4a2c', bone: 'twig', outline: 0.2, role: 'twig' });
  const leaf = xf([0.28, 0.095, 0.02], [0.2, 0.3, -0.5]);
  sb.add(sph(12, 6), leaf.clone().multiply(xf([0, 0, 0], [0, 0, 0], [0.105, 0.012, 0.052])), { color: '#6fb83a', bone: 'twig', outline: 0.1, role: 'leaf' });
  sb.add(sph(8, 4), leaf.clone().multiply(xf([0, 0.011, 0], [0, 0, 0], [0.098, 0.004, 0.006])), { color: '#3f8a2c', bone: 'twig', flat: 0.5 });
  // the silk thread (pale), then the shell: bottom piece (whole), two top flaps (half lathes), a hidden pupa inside
  stick('shell', [0, -0.03, 0], [0, 0, 0], 0.0085, 0.14, '#efe6d0');
  sb.add(lathe(0, COCOON.split, 0, Math.PI * 2), xf(), { color: '#8a4a22', bone: 'shell', role: 'shell', outline: 0.0085 / 1, inner: true });
  sb.add(lathe(COCOON.split, 1, 0, Math.PI), xf(), { color: '#8a4a22', bone: 'flapR', role: 'shellR', outline: 0.0085, inner: true });
  sb.add(lathe(COCOON.split, 1, Math.PI, Math.PI), xf(), { color: '#8a4a22', bone: 'flapL', role: 'shellL', outline: 0.0085, inner: true });
  const ySplit = COCOON.yTop - COCOON.h + COCOON.split * COCOON.h;
  ell(sb, 'shell', [0, ySplit - 0.025, 0], [0.08, 0.09, 0.08], '#e8a24a', { w: 10, h: 6, outline: 0.1, role: 'pupa' });
  const e = sb.build();
  const bandPaint = (p, n, c) => {
    const t = clamp01((p.y - (COCOON.yTop - COCOON.h)) / COCOON.h), ang = Math.atan2(p.x, p.z);
    const { band, dEdge } = cocoonBand(t, ang);
    const base = BANDS[band % BANDS.length], alt = col(BANDS[band % BANDS.length]).lerp(col('#ffffff'), 0.1);
    c.copy(tissue(base, alt, p.x, p.y, p.z, { seed: 21 + band, scale: 16, jitter: 0.06, bias: 0.55 }));
    c.lerp(col('#e3bd78'), smoothstep(0.012, 0.0, dEdge) * 0.7);                                 // a pale torn edge along every band
  };
  for (const r of ['shell', 'shellR', 'shellL']) paintRole(e, r, bandPaint);
  paintRole(e, 'twig', (p, n, c) => { c.copy(tissue('#7b5230', '#4d3220', p.x, p.y, p.z, { seed: 5, scale: 30, jitter: 0.12 })); });
  paintRole(e, 'leaf', (p, n, c) => { c.copy(tissue('#6fb83a', '#a6d24a', p.x, p.y, p.z, { seed: 9, scale: 22, jitter: 0.1 })); });
  paintRole(e, 'pupa', (p, n, c) => { c.copy(tissue('#e8a24a', '#f4c76a', p.x, p.y, p.z, { seed: 8, scale: 20 })); });
  const rs = cocoonR(COCOON.split);
  const bones = [
    { name: 'twig', pos: [0, 0, 0] },
    { name: 'shell', parent: 'twig', pos: [0, 0, 0] },                                          // the pendulum pivot is the thread's top (the origin)
    { name: 'flapL', parent: 'shell', pos: [-rs, ySplit, 0] },
    { name: 'flapR', parent: 'shell', pos: [rs, ySplit, 0] },
  ];
  return buildSkinned({ entry: e, bones, name: 'pet-cocoon' });
}

/** The wiggle envelope (something moves inside): 0 most of the time, a ~0.9 s shake every `period` s. */
export function cocoonShake(t, period = 6) {
  const u = (t % period) / period;
  return smoothstep(0.7, 0.74, u) * (1 - smoothstep(0.86, 0.9, u));
}

export function buildCocoon() {
  const sk = buildCocoonMesh();
  const { root, rig } = modelShell('pet-cocoon', sk.mesh);
  const shellPivot = sk.bones.shell, flapL = sk.bones.flapL, flapR = sk.bones.flapR;
  const st = { crack: 0, hatchT: 0, wig: 0 };
  const size = sizeOf(root);
  const model = {
    id: 'carle:cocoon', kind: 'cocoon', root, rig, mesh: sk.mesh, meshes: [sk.mesh], geometries: [sk.geometry], skeleton: sk.skeleton, bones: sk.bones,
    shellPivot, flapL, flapR, twig: sk.bones.twig, drawCalls: 2, length: size.z, height: size.y, state: st,
    /** Split the top open: k 0 (shut) .. 1 (wide open). */
    crack(k) { st.crack = clamp01(k); },
    update(dt, t, { anim = 'idle', crack = null } = {}) {
      if (anim === 'hatch') {                                                    // 6 s loop: shake, then the top splits open, a hold, then it closes again
        st.hatchT = (st.hatchT + dt) % 7;
        const u = st.hatchT;
        st.crack = smoothstep(2.4, 4.2, u) * (1 - smoothstep(6.2, 6.9, u));
      } else if (crack !== null) st.crack = clamp01(crack);
      const wigTarget = anim === 'wiggle' ? 1 : anim === 'hatch' ? clamp01(smoothstep(0.2, 1, st.hatchT / 2.4) * (1 - smoothstep(2.4, 3.2, st.hatchT)) + 0.2 * st.crack) : cocoonShake(t);
      st.wig += (wigTarget - st.wig) * Math.min(1, dt * 12);
      const shake = Math.sin(t * 31) * 0.1 * st.wig;
      shellPivot.rotation.z = Math.sin(t * 0.9) * 0.05 + shake;
      shellPivot.rotation.x = Math.sin(t * 0.7 + 1) * 0.03 + Math.sin(t * 27 + 1) * 0.06 * st.wig;
      shellPivot.rotation.y = Math.sin(t * 0.35) * 0.25;
      flapR.rotation.z = -st.crack * 1.05;
      flapL.rotation.z = st.crack * 1.05;
    },
    dispose() { disposeModel({ geometry: sk.geometry, skeleton: sk.skeleton, root }); },
  };
  return model;
}

// ---------------------------------------------------------------------------------------------
// The butterfly: four wings, each a collage of flat colour panels (a fan of rays from the body, a navy band with dots, big pink-orange circles, a purple lobe with a yellow eye spot)
// ---------------------------------------------------------------------------------------------
const RS = 1.12;                                              // wing size factor (tuned so the wingspan is about 1.0 u)
const PIVOT = { x: 0.045, z: 0.03 };
const Rf = (th) => (0.32 + 0.2 * Math.exp(-(((th - 60 * D) / (38 * D)) ** 2))) * RS;          // fore wing outline radius at angle th
const Rlobe = (th) => (0.18 + 0.3 * Math.exp(-(((th + 38 * D) / 0.42) ** 2))) * RS;            // the long hind lobe

const tis = (base, alt, seed, o = {}) => (u, v, x, z) => tissue(base, alt, x, 0.2, z, { seed, scale: 18, jitter: 0.11, ...o });
const flat1 = (hex) => () => col(hex);

/** The right wing's panels, bottom layer first: { kind: 'sector' | 'disc', ..., y, color, under } (angles in degrees from +X toward +Z, polar origin at the wing pivot). */
export function wingPanels() {
  const P = [];
  const sec = (a0, a1, rIn, rOut, y, color, under = true) => P.push({ kind: 'sector', a0, a1, rIn, rOut, y, color, under });
  const disc = (th, r, rx, rz, y, color, under = false, rot = 0) => P.push({ kind: 'disc', th, r, rx, rz, rot, y, color, under });
  // ---- fore wing
  sec(22, 90, 0.05, Rf, 0, tis('#1c7db0', '#2fa6c4', 1, { bias: 0.5 }));
  const fray = ['#47a233', '#e2d93c', '#8fa02c', '#5cb335', '#c3d83b', '#6a9d2c'];
  fray.forEach((c, k) => { const a0 = -2 + k * 9.7; sec(a0, a0 + 8.4, 0.07, (th) => Rf(th) * (k % 2 ? 0.86 : 0.92), 0.006, tis(c, k % 2 ? '#f0e86a' : '#2f8a2c', 20 + k, { bias: 0.5 })); });
  sec(76, 90, 0.2, (th) => Rf(th) - 0.03, 0.006, tis('#252c66', '#3d3b8e', 31));
  [[83, 0.27, '#ee5fa0'], [86, 0.35, '#f59a2e'], [82, 0.42, '#f4dd3a']].forEach(([a, r, c]) => disc(a, r * RS, 0.017, 0.017, 0.013, flat1(c), true));
  disc(62, 0.34 * RS, 0.092, 0.092, 0.012, tis('#df3d86', '#f06aa0', 40), true);
  disc(60, 0.335 * RS, 0.066, 0.066, 0.017, tis('#f28a2b', '#f6b04a', 41));
  disc(63, 0.34 * RS, 0.04, 0.04, 0.022, tis('#d52f7a', '#e8508f', 42));
  disc(66, 0.352 * RS, 0.017, 0.017, 0.027, flat1('#ffc7dc'));
  // ---- hind wing
  sec(-64, -22, 0.06, Rlobe, 0, tis('#7a55ac', '#9a78c8', 50));
  const hray = ['#3da53a', '#e8da3c', '#2f9a4f', '#b9d43a', '#7aa82e'];
  hray.forEach((c, k) => { const a0 = -31 + k * 5.8; sec(a0, a0 + 4.9, 0.08, (th) => 0.33 * RS - (k % 2) * 0.02, 0.006, tis(c, k % 2 ? '#f2ec74' : '#1d7a3a', 60 + k)); });
  disc(-14, 0.22 * RS, 0.075, 0.02, 0.013, tis('#6a58b8', '#8a78d8', 70), false);
  disc(-24, 0.17 * RS, 0.06, 0.018, 0.013, tis('#4b78c4', '#6a98e0', 71), false);
  disc(-8, 0.28 * RS, 0.012, 0.012, 0.014, flat1('#2b2340'));
  disc(-38, 0.38 * RS, 0.105, 0.064, 0.011, tis('#f2d530', '#f8e66a', 80), true);              // the eye spot at the lobe's tip
  disc(-38, 0.38 * RS, 0.064, 0.044, 0.016, tis('#d4302a', '#e8504a', 81));
  disc(-38, 0.38 * RS, 0.03, 0.026, 0.021, flat1('#7a1c1a'));
  disc(-38, 0.385 * RS, 0.011, 0.011, 0.025, flat1('#2b2340'));
  return P;
}

const UNDER = col('#241d44');
/** One layered, double-sided, slightly cupped grid panel in right-wing space, mirrored when side = -1. Returns { pos, nor, col, idx }. */
function gridPanel(map, nU, nV, y, color, side) {
  const pos = [], nor = [], cc = [], idx = [], pts = [];
  for (let j = 0; j <= nV; j++) for (let i = 0; i <= nU; i++) pts.push(map(i / nU, j / nV));
  const id = (i, j) => j * (nU + 1) + i;
  const i0 = Math.floor(nU / 2), j0 = nV - 1;
  const a = pts[id(i0, j0)], b = pts[id(i0 + 1, j0)], c = pts[id(i0 + 1, j0 + 1)];
  const flip = ((b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]) < 0) !== (side < 0);
  const h = y + 0.004, k = 0.15;
  const nF = pts.length;
  for (let j = 0; j <= nV; j++) for (let i = 0; i <= nU; i++) {
    const [x, z] = pts[id(i, j)], dx = x - PIVOT.x, cur = k * dx * dx, slope = 2 * k * dx;
    const col0 = color(i / nU, j / nV, x, z);
    const nl = Math.hypot(slope, 1);
    pos.push(x * side, cur + h, z); nor.push((-slope / nl) * side, 1 / nl, 0); cc.push(col0.r, col0.g, col0.b);
  }
  for (let j = 0; j <= nV; j++) for (let i = 0; i <= nU; i++) {
    const [x, z] = pts[id(i, j)], dx = x - PIVOT.x, cur = k * dx * dx, slope = 2 * k * dx;
    const col0 = color(i / nU, j / nV, x, z);
    const nl = Math.hypot(slope, 1);
    pos.push(x * side, cur - h, z); nor.push((slope / nl) * side, -1 / nl, 0); cc.push(col0.r, col0.g, col0.b);
  }
  for (let j = 0; j < nV; j++) for (let i = 0; i < nU; i++) {
    const A = id(i, j), B = id(i + 1, j), C = id(i + 1, j + 1), Dd = id(i, j + 1);
    if (!flip) { idx.push(A, B, C, A, C, Dd, nF + A, nF + C, nF + B, nF + A, nF + Dd, nF + C); }
    else { idx.push(A, C, B, A, Dd, C, nF + A, nF + B, nF + C, nF + A, nF + C, nF + Dd); }
  }
  return { pos, nor, col: cc, idx };
}

function panelMap(s, grow = 0) {
  if (s.kind === 'sector') {
    const ro = typeof s.rOut === 'function' ? s.rOut : () => s.rOut, ri = typeof s.rIn === 'function' ? s.rIn : () => s.rIn;
    const a0 = (s.a0 - (grow ? 1.4 : 0)) * D, a1 = (s.a1 + (grow ? 1.4 : 0)) * D;
    return (u, v) => {
      const th = lerp(a0, a1, u), r = lerp(ri(th), ro(th) + grow, v);
      return [PIVOT.x + r * Math.cos(th), PIVOT.z + r * Math.sin(th)];
    };
  }
  const th = s.th * D, cx = PIVOT.x + s.r * Math.cos(th), cz = PIVOT.z + s.r * Math.sin(th), ca = Math.cos(th + s.rot), sa = Math.sin(th + s.rot);
  return (u, v) => {
    const ang = u * Math.PI * 2, lx = v * (s.rx + grow) * Math.cos(ang), lz = v * (s.rz + grow) * Math.sin(ang);
    return [cx + lx * ca - lz * sa, cz + lx * sa + lz * ca];
  };
}

function addWing(sb, bone, side) {
  for (const s of wingPanels()) {
    const nU = s.kind === 'sector' ? 8 : 12, nV = s.kind === 'sector' ? 4 : 2;
    if (s.under) sb.addRaw(gridPanel(panelMap(s, 0.013), nU, nV, s.y - 0.0045, flat1('#241d44'), side), { bone, flat: 1 });
    sb.addRaw(gridPanel(panelMap(s, 0), nU, nV, s.y, s.color, side), { bone, flat: 0.45 });
  }
}

function buildButterflyMesh() {
  const sb = new SkinBaker(['body', 'wingL', 'wingR']);
  addWing(sb, 'wingR', 1);
  addWing(sb, 'wingL', -1);
  // the thin olive-yellow segmented body (thorax + abdomen) along z, the red Carle head, the thin dark antennae with small knobs
  const segs = [[0.115, 0.034, 0.05], [0.06, 0.039, 0.055], [0.0, 0.037, 0.055], [-0.065, 0.032, 0.055], [-0.125, 0.028, 0.055], [-0.18, 0.022, 0.05]];
  segs.forEach(([z, r, hl], i) => ell(sb, 'body', [0, 0, z], [r, r, hl], '#b3a02a', { role: 'thorax', outline: hull(r, 0.005), w: 10, h: 7 }));
  carleHead(sb, 'body', [0, 0.004, 0.2], [0.048, 0.052, 0.046], { eye: 0.9, role: 'bhead' });
  for (const s of [-1, 1]) {
    const pts = [[0.02 * s, 0.045, 0.215], [0.045 * s, 0.1, 0.25], [0.072 * s, 0.15, 0.285], [0.1 * s, 0.185, 0.31]];
    pts.forEach((p, i) => ell(sb, 'body', p, [0.0065, 0.0065, 0.0065], '#2f2a3a', { w: 6, h: 4, outline: 0.0 }));
    ell(sb, 'body', [0.108 * s, 0.192, 0.317], [0.014, 0.014, 0.014], '#2b2340', { w: 8, h: 5, outline: 0.0 });
    for (let k = 0; k < 3; k++) {                                       // connect the beads into a thin curve
      const a = pts[k], b = pts[k + 1], m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
      ell(sb, 'body', m, [0.0055, 0.0055, 0.0055], '#2f2a3a', { w: 6, h: 4, outline: 0.0 });
    }
  }
  const e = sb.build();
  paintRole(e, 'thorax', (p, n, c) => {
    const band = Math.round((p.z + 0.18) / 0.0625) % 2;
    c.copy(tissue(band ? '#b3a02a' : '#8c8a24', '#d1bd3c', p.x, p.y, p.z, { seed: 33, scale: 26, jitter: 0.1 }));
  });
  paintRole(e, 'bhead', (p, n, c) => { c.copy(tissue('#df2a1e', '#f4601f', p.x, p.y, p.z, { seed: 71, scale: 24, jitter: 0.08, bias: 0.55 })); });
  const bones = [
    { name: 'body', pos: [0, 0, 0] },
    { name: 'wingL', parent: 'body', pos: [-PIVOT.x, 0, PIVOT.z] },
    { name: 'wingR', parent: 'body', pos: [PIVOT.x, 0, PIVOT.z] },
  ];
  // the wing panels were authored with the pivot at (PIVOT.x, PIVOT.z) already inside the vertex positions, so the bones only need to sit where the wings turn
  return buildSkinned({ entry: e, bones, name: 'pet-butterfly' });
}

/** The wing angle (radians about the body's long axis, positive = tip up) for the flight modes: { centre, amp, omega }. */
export function butterflyFlap(anim) {
  switch (anim) {
    case 'flap': case 'flutter': return { centre: 0.2, amp: 0.55, omega: 21 };
    case 'rest': return { centre: 1.5, amp: 0.015, omega: 1.8 };
    case 'glide': case 'idle': default: return { centre: 0.18, amp: 0.62, omega: 5.2 };
  }
}

export function buildButterfly() {
  const sk = buildButterflyMesh();
  const { root, rig } = modelShell('pet-butterfly', sk.mesh);
  const wingL = sk.bones.wingL, wingR = sk.bones.wingR, bodyPivot = sk.bones.body;
  const st = { ph: 0, centre: 0.18, amp: 0.62, omega: 5.2 };
  const size = sizeOf(root);
  return {
    id: 'carle:butterfly', kind: 'butterfly', root, rig, mesh: sk.mesh, meshes: [sk.mesh], geometries: [sk.geometry], skeleton: sk.skeleton, bones: sk.bones,
    wingL, wingR, bodyPivot, drawCalls: 2, wingspan: size.x, length: size.z, height: size.y, state: st,
    update(dt, t, { anim = 'glide' } = {}) {
      const f = butterflyFlap(anim), k = Math.min(1, dt * 6);
      st.centre += (f.centre - st.centre) * k; st.amp += (f.amp - st.amp) * k; st.omega += (f.omega - st.omega) * k;
      st.ph += dt * st.omega;
      const a = st.centre + st.amp * Math.sin(st.ph);
      wingR.rotation.set(0, 0, a);                                    // +Z roll lifts the right wing's tip
      wingL.rotation.set(0, 0, -a);
      const flying = anim !== 'rest';
      rig.position.y = flying ? Math.sin(st.ph * (anim === 'flap' ? 0.5 : 1) + 1.2) * 0.025 : 0;
      rig.rotation.x = flying ? Math.sin(st.ph + 0.6) * 0.07 : 0;
      bodyPivot.rotation.x = flying ? -0.08 : 0.25;                   // nose a little up in flight, a rest pose with the head slightly raised
    },
    dispose() { disposeModel({ geometry: sk.geometry, skeleton: sk.skeleton, root }); },
  };
}

export { restPose };
