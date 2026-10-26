// The Frostpine pet, "snowsong" (PLAN Step 74a: model only, NOT in the pet registry): a chunky pup-proportioned wolf coloured as a cross between a grey wolf and an arctic wolf: cream-white
// muzzle / cheeks / chest / belly / paws, a soft grey saddle over the back that fades into the white flanks, a charcoal spine stripe, a dark tail tip, grey ears with white insides,
// a light grey forehead with a white mask round the eyes, a black nose and warm amber eyes with a white highlight. Same toon style and #2b2340 outline hull as the Frostpine critters.
//
//   const m = buildWolf()           (npc/petsWip.js maps it to 'snowsong')
//   m.root          Group, faces +Z, +X is the wolf's left; origin at the FEET. m.rig under it
//   m.mesh / m.meshes   ONE SkinnedMesh on the shared pet material (the skinned 'pet-toon' variant); m.drawCalls = 2 (the mesh + its shadow pass)
//   m.length (nose to tail tip) / m.height (top of the ears) / m.shoulder (top of the back)   metres in model units
//   Pivots (Bones): bodyPivot, headPivot, jawPivot, tailPivot, legFL, legFR, legBL, legBR, earL, earR (+X is the wolf's left)
//   m.update(dt, t, { anim, speed })   'idle' | 'trot' (alias 'walk', diagonal legs together) | 'sit' | 'wag' | 'howl' | 'tilt' (a head tilt and an ear twitch)
//   m.dispose()
//
// Pure helper for tests: wolfGait(phase, amp) -> the four leg swings and the body bob.
import * as THREE from 'three';
import { xf } from '../player/character.js';
import { surf, at } from './models.js';
import { SkinBaker, paintRole, buildSkinned, modelShell, disposeModel, sizeOf, tissue, vnoise, hull, smoothstep, lerp, clamp01 } from './petsKit.js';

const sph = (w = 12, h = 8) => new THREE.SphereGeometry(1, w, h);
const cone = (n = 6) => new THREE.ConeGeometry(1, 1, n);
function ell(sb, bone, p, s, color, o = {}) {
  sb.add(sph(o.w || 12, o.h || 8), xf(p, o.r || [0, 0, 0], s), { color, bone, role: o.role || null, outline: o.outline ?? hull(s), flat: o.flat || 0 });
}
const col = (hex) => new THREE.Color(hex);

const CREAM = '#efece4', FROST = '#e6ecf2', GREY = '#666c77', GREY_L = '#a7adb6', CHAR = '#363a44', TIP = '#272a33', EAR = '#5a606b';
const AMBER = '#e0a02a';
// ---- the layout (model space: feet at y = 0, nose toward +Z)
const HIP = { fl: [0.115, 0.4, 0.15], fr: [-0.115, 0.4, 0.15], bl: [0.12, 0.4, -0.17], br: [-0.12, 0.4, -0.17] };
const HEAD_C = [0, 0.65, 0.3];                                   // the skull's centre
const SKULL = [0.155, 0.145, 0.14];
const BONES = [
  { name: 'root', pos: [0, 0, 0] },
  { name: 'body', parent: 'root', pos: [0, 0.43, 0] },
  { name: 'head', parent: 'body', pos: [0, 0.56, 0.2] },
  { name: 'jaw', parent: 'head', pos: [0, 0.575, 0.34] },
  { name: 'earL', parent: 'head', pos: [0.098, 0.775, 0.265] },
  { name: 'earR', parent: 'head', pos: [-0.098, 0.775, 0.265] },
  { name: 'tail', parent: 'body', pos: [0, 0.45, -0.24] },
  { name: 'legFL', parent: 'body', pos: HIP.fl },
  { name: 'legFR', parent: 'body', pos: HIP.fr },
  { name: 'legBL', parent: 'body', pos: HIP.bl },
  { name: 'legBR', parent: 'body', pos: HIP.br },
];

/** The trot: diagonal pairs (FL + BR, FR + BL) swing together, half a cycle apart; `amp` is the swing in radians. Returns { fl, fr, bl, br, bob } (bob = body lift in metres, twice per cycle). */
export function wolfGait(phase, amp = 0.62) {
  const a = Math.sin(phase) * amp, b = Math.sin(phase + Math.PI) * amp;
  return { fl: a, br: a, fr: b, bl: b, bob: Math.abs(Math.sin(phase)) * 0.022 };
}

function buildWolfMesh() {
  const sb = new SkinBaker(BONES.map((b) => b.name));
  // ---- torso, neck, ruff, haunches, chest tufts, belly
  ell(sb, 'body', [0, 0.44, 0.0], [0.17, 0.185, 0.25], CREAM, { role: 'torso', outline: hull(0.2, 0.008) });
  ell(sb, 'body', [0, 0.55, 0.19], [0.13, 0.14, 0.12], CREAM, { role: 'torso', outline: hull(0.13, 0.008) });                       // the neck
  for (const s of [-1, 1]) ell(sb, 'body', [0.125 * s, 0.37, -0.16], [0.1, 0.14, 0.14], CREAM, { role: 'torso', outline: hull(0.12, 0.007) });   // haunches
  ell(sb, 'body', [0, 0.39, 0.2], [0.15, 0.17, 0.12], CREAM, { role: 'cream', outline: hull(0.14, 0.007) });                         // the fluffy chest ruff
  ell(sb, 'body', [0, 0.33, 0.0], [0.14, 0.1, 0.22], CREAM, { role: 'cream', outline: 0 });                                          // the belly
  for (let k = -2; k <= 2; k++) {                                                                                                    // fur tufts hanging off the chest
    const base = [k * 0.05, 0.31 - Math.abs(k) * 0.012, 0.27 + (2 - Math.abs(k)) * 0.01];
    sb.add(cone(5), xf([base[0], base[1] - 0.025, base[2] + 0.03], [2.5, 0, k * 0.12], [0.032, 0.085, 0.032]), { color: CREAM, bone: 'body', role: 'cream', outline: 0.1 });
  }
  // ---- the four legs (a capsule + a big paw each), bound to their leg bone
  const leg = (bone, [x, , z]) => {
    sb.add(new THREE.CapsuleGeometry(0.066, 0.2, 4, 8), xf([x, 0.235, z]), { color: CREAM, bone, role: 'leg', outline: 0.0065 });
    ell(sb, bone, [x, 0.042, z + 0.028], [0.078, 0.055, 0.088], CREAM, { role: 'cream', outline: hull(0.075, 0.006) });
  };
  leg('legFL', HIP.fl); leg('legFR', HIP.fr); leg('legBL', HIP.bl); leg('legBR', HIP.br);
  // ---- the tail: a big bushy chain, cream into grey, a dark tip
  const tail = [[0, 0.42, -0.25, 0.09, 0.09, 0.11], [0, 0.375, -0.33, 0.125, 0.125, 0.125], [0, 0.32, -0.41, 0.14, 0.14, 0.13], [0, 0.265, -0.49, 0.125, 0.125, 0.115]];
  tail.forEach(([x, y, z, sx, sy, sz], i) => ell(sb, 'tail', [x, y, z], [sx, sy, sz], CREAM, { role: 'tail', outline: hull(0.09, 0.007), r: [0.2, 0, 0] }));
  // ---- the head: skull, cheek ruffs, muzzle, nose, eye masks, eyes, ears, jaw
  const H = xf(HEAD_C), [A, B, C] = SKULL;
  ell(sb, 'head', HEAD_C, SKULL, CREAM, { role: 'skull', outline: hull(0.15, 0.009) });
  for (const s of [-1, 1]) {
    ell(sb, 'head', [0.12 * s, 0.6, 0.3], [0.065, 0.07, 0.085], CREAM, { role: 'cream', outline: hull(0.07, 0.006) });                // cheek ruffs
    for (const [dy, dz, rot] of [[0.0, 0.0, 1.35], [-0.045, 0.02, 1.7]]) {
      sb.add(cone(5), xf([0.18 * s, 0.6 + dy, 0.285 + dz], [0, 0, -rot * s], [0.034, 0.085, 0.034]), { color: CREAM, bone: 'head', role: 'cream', outline: 0.1 });   // ruff tufts
    }
  }
  ell(sb, 'head', [0, 0.595, 0.47], [0.062, 0.052, 0.14], CREAM, { role: 'cream', outline: hull(0.08, 0.007), r: [-0.06, 0, 0] });
  ell(sb, 'head', [0, 0.622, 0.45], [0.038, 0.024, 0.12], GREY_L, { role: 'bridge', outline: 0, r: [-0.06, 0, 0] });                  // the light grey bridge of the snout                          // the muzzle
  ell(sb, 'head', [0, 0.572, 0.47], [0.05, 0.015, 0.115], '#3a1f2a', { outline: 0, flat: 1 });                                       // the dark mouth line (shows when the jaw opens)
  ell(sb, 'head', [0, 0.618, 0.585], [0.042, 0.033, 0.033], '#1b1722', { outline: 0.1, flat: 0.5 });                                    // the black nose
  ell(sb, 'head', [-0.014, 0.629, 0.595], [0.012, 0.007, 0.006], '#ffffff', { outline: 0, flat: 1, w: 6, h: 4 });
  ell(sb, 'jaw', [0, 0.563, 0.46], [0.05, 0.028, 0.115], CREAM, { role: 'cream', outline: hull(0.06, 0.005) });                         // the lower jaw
  ell(sb, 'jaw', [0, 0.576, 0.47], [0.03, 0.011, 0.08], '#e8798a', { outline: 0, flat: 0.3, w: 8, h: 5 });                            // the tongue
  const face = (x, y, lift = 0) => H.clone().multiply(surf(A, B, C, x, y, lift));
  for (const s of [-1, 1]) {
    const mk = face(0.072 * s, 0.022, -0.004);
    sb.add(sph(10, 6), at(mk, [0, 0, 0], [0, 0, 0], [0.058, 0.052, 0.022]), { color: '#f6f6f2', bone: 'head', role: 'mask', flat: 0.25 });  // the white mask round the eye
    const part = (p, sc, color, role = null) => sb.add(sph(10, 6), at(mk, p, [0, 0, 0], sc), { color, bone: 'head', flat: 1, role });
    part([0, 0, 0.012], [0.034, 0.042, 0.014], '#a86a10', 'eye');                    // the iris ring
    part([0, 0, 0.02], [0.028, 0.035, 0.014], AMBER, 'eye');                          // warm amber
    part([0, -0.002, 0.026], [0.013, 0.022, 0.01], '#2a1a10');                        // the pupil
    part([0.01, 0.013, 0.031], [0.008, 0.008, 0.006], '#ffffff');                     // the white highlight
    // ears: grey outside, white inside
    const base = BONES.find((b) => b.name === (s > 0 ? 'earL' : 'earR')).pos;
    const ear = xf(base, [0.1, 0, -0.26 * s]);
    sb.add(cone(6), at(ear, [0, 0.085, 0], [0, 0, 0], [0.062, 0.17, 0.042]), { color: EAR, bone: s > 0 ? 'earL' : 'earR', role: 'ear', outline: 0.07 });
    sb.add(cone(6), at(ear, [0, 0.075, 0.016], [0, 0, 0], [0.04, 0.12, 0.02]), { color: '#f4f0ea', bone: s > 0 ? 'earL' : 'earR', flat: 0.3 });
  }
  const e = sb.build();
  // ---- the coat
  const fur = (p, i) => (vnoise(p.x * 30, p.y * 30, p.z * 30, 4 + i) - 0.5) * 0.07;
  paintRole(e, 'torso', (p, n, c) => {
    const light = smoothstep(-0.25, 0.3, n.y), grey = smoothstep(0.2, 0.62, n.y);                      // light grey spreads down the flank, the mid-grey saddle sits on top (back, shoulders, top of the neck)
    const spine = (1 - smoothstep(0.025, 0.07, Math.abs(p.x))) * smoothstep(0.35, 0.8, n.y);             // the charcoal stripe down the spine
    c.copy(col(CREAM)).lerp(col(GREY_L), light * 0.9).lerp(tissue(GREY, '#7a808b', p.x, p.y, p.z, { seed: 2, scale: 22, jitter: 0.07 }), grey).lerp(col(CHAR), spine * 0.95);
    c.multiplyScalar(1 + fur(p, 1));
  });
  paintRole(e, 'cream', (p, n, c) => { c.copy(col(CREAM)).lerp(col(FROST), 0.3 * vnoise(p.x * 12, p.y * 12, p.z * 12, 8)).multiplyScalar(1 + fur(p, 2)); });
  paintRole(e, 'bridge', (p, n, c) => { c.copy(col(GREY_L)); });
  paintRole(e, 'skull', (p, n, c) => {
    const light = smoothstep(-0.1, 0.4, n.y), grey = smoothstep(0.15, 0.6, n.y) * (1 - smoothstep(0.36, 0.44, p.z) * 0.5);   // grey crown and forehead, white face below
    c.copy(col(CREAM)).lerp(col(GREY_L), light * 0.85).lerp(col(GREY), grey * 0.95).multiplyScalar(1 + fur(p, 3));
  });
  paintRole(e, 'leg', (p, n, c) => {
    const up = smoothstep(0.26, 0.4, p.y) * smoothstep(0.0, 0.5, Math.abs(n.x) + 0.25 * n.y);               // grey high up on the outside of the legs, white below and on the inside
    c.copy(col(CREAM)).lerp(col(GREY_L), up * 0.85).multiplyScalar(1 + fur(p, 4));
  });
  paintRole(e, 'tail', (p, n, c) => {
    const t = clamp01((-p.z - 0.2) / 0.4), tip = smoothstep(0.5, 0.56, -p.z);
    const top = 0.3 + 0.7 * smoothstep(-0.3, 0.55, n.y);                                                       // grey on top, paler underneath
    c.copy(col(CREAM)).lerp(col(GREY), top * smoothstep(0.0, 0.35, t + 0.1) * 0.95).lerp(col(TIP), tip).multiplyScalar(1 + fur(p, 5));
  });
  return buildSkinned({ entry: e, bones: BONES, name: 'pet-wolf', glow: { eye: 0.3 } });
}

export function buildWolf() {
  const sk = buildWolfMesh();
  const { root, rig } = modelShell('pet-wolf', sk.mesh);
  const B = sk.bones;
  const st = { gait: 0, phase: 0, sit: 0, howl: 0, wag: 0, tilt: 0 };
  const size = sizeOf(root);
  const model = {
    id: 'snowsong', kind: 'wolf', root, rig, mesh: sk.mesh, meshes: [sk.mesh], geometries: [sk.geometry], skeleton: sk.skeleton, bones: sk.bones,
    bodyPivot: B.body, headPivot: B.head, jawPivot: B.jaw, tailPivot: B.tail, legFL: B.legFL, legFR: B.legFR, legBL: B.legBL, legBR: B.legBR, earL: B.earL, earR: B.earR,
    drawCalls: 2, length: size.z, height: size.y, shoulder: 0.625, state: st,
    update(dt, t, { anim = 'idle', speed = 1 } = {}) {
      const k = Math.min(1, dt * 5);
      const trot = anim === 'trot' || anim === 'walk';
      st.gait += ((trot ? 1 : 0) - st.gait) * k;
      st.sit += ((anim === 'sit' ? 1 : 0) - st.sit) * Math.min(1, dt * 3.5);
      st.howl += ((anim === 'howl' ? 1 : 0) - st.howl) * Math.min(1, dt * 3);
      st.wag += ((anim === 'wag' ? 1 : 0) - st.wag) * k;
      st.tilt += ((anim === 'tilt' ? 1 : 0) - st.tilt) * k;
      if (trot) st.phase += dt * 7.2 * speed;
      const g = wolfGait(st.phase, 0.62 * st.gait), sit = st.sit, howl = st.howl;
      // body: breathing, the trot's bob and roll, the sit (rump down, chest up) and the howl (a little lift)
      B.body.position.set(0, 0.43 + g.bob * st.gait - 0.15 * sit, 0);
      B.body.rotation.set(-0.55 * sit - 0.1 * howl, 0, Math.sin(st.phase) * 0.025 * st.gait);
      B.body.scale.set(1, 1 + 0.012 * Math.sin(t * 2.4), 1);
      // legs: the gait, then the sit folds the hind legs forward and straightens the front ones against the body's tilt
      const front = 0.55 * sit + 0.1 * howl;
      B.legFL.rotation.set(g.fl + front, 0, 0); B.legFR.rotation.set(g.fr + front, 0, 0);
      B.legBL.rotation.set(g.bl - 0.5 * sit, 0, 0.35 * sit); B.legBR.rotation.set(g.br - 0.5 * sit, 0, -0.35 * sit);
      // the head: looks about when idle, tilts, bobs in the trot, points at the sky in the howl; the jaw opens for the howl
      const look = Math.sin(t * 0.4) * 0.25 * (1 - howl) * (1 - st.gait * 0.7);
      const tiltK = Math.max(st.tilt, smoothstepWindow(t, 9, 0.55, 0.7, 0.8, 0.9) * (1 - st.gait) * (1 - howl));
      B.head.rotation.set(-0.85 * howl + Math.sin(st.phase * 2) * 0.04 * st.gait + 0.4 * sit, look, 0.3 * tiltK + Math.sin(t * 0.6) * 0.04);
      B.jaw.rotation.set(howl * 0.42 + Math.max(0, Math.sin(t * 6)) * 0.1 * howl, 0, 0);
      // ears: a twitch every few seconds, laid back a little in the trot
      const tw = smoothstepWindow(t, 4.3, 0.1, 0.15, 0.22, 0.3);
      B.earL.rotation.set(0, 0, -0.35 * tw - 0.1 * st.gait + 0.1 * howl);
      B.earR.rotation.set(0, 0, 0.0 + 0.1 * st.gait - 0.1 * howl + Math.sin(t * 1.1) * 0.03);
      // tail: lazy sway, a happy wag, low in the sit, down in the howl
      B.tail.rotation.set(-0.05 * (1 - st.gait) + 0.04 * st.gait - 0.1 * howl + 0.12 * sit, Math.sin(t * 1.4) * 0.22 * (1 - st.wag) + Math.sin(t * 11) * 0.55 * st.wag + Math.sin(st.phase) * 0.12 * st.gait, 0);
    },
    dispose() { disposeModel({ geometry: sk.geometry, skeleton: sk.skeleton, root }); },
  };
  return model;
}

/** 0..1..0 window inside a repeating period: rises over [a, b], holds to c, falls by d (fractions of the period). */
function smoothstepWindow(t, period, a, b, c, d) {
  const u = (t % period) / period;
  return smoothstep(a, b, u) * (1 - smoothstep(c, d, u));
}
