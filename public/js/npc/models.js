// Bridge-builder NPC models (PLAN Step 28a): chibi animals in the villagers' style, built with the character baker (player/character.js).
//
//   const m = createNpcModel('mole' | 'beaver' | 'bookworm')
//   m.root        Group: origin at the feet, faces +Z (yaw 0), about 1.6 u tall with the hat
//   m.rig         squash / bob pivot at the feet
//   m.torso       group holding the arms and the head (lean / nod)
//   m.headGroup   head pivot (nod / tilt)
//   m.armL / m.armR   shoulder pivots, arm hangs along -Y (rotation.x raises it forward, rotation.z swings it out); armR holds the tool
//   m.tail        tail pivot (wiggle: rotation.y / x)
//   m.setBlink(closed 0..1)   squashes the eye vertices in the shader (shared with the villagers)
//   m.drawCalls   main-pass meshes + shadow-pass meshes (budget 8)
//   m.dispose()
//
// Draw-call budget: five merged, vertex-coloured meshes with the outline hull baked in (body+legs, head+face+hat, two arms, tail), ONE toon
// material that also marks the stencil buffer like every character (so the occluded-player silhouette never paints over an NPC). Only body,
// head and the tool arm cast shadows (the small arm and the tail do not need to), so 5 + 3 = 8 draw calls. No blob shadow: the sun shadow
// is enough and the budget is tight.
//
// Cobble the mole: stonemason. Dark velvety fur, pink spade paws and snout, tiny eyes behind round gold glasses, an orange hard hat with a
// lamp, a leather apron with a chisel in the pocket and a wooden mallet in the right hand.
// Bramble the beaver: carpenter. Warm brown fur, cream cheeks, two big orange front teeth, a flat paddle tail with ridges, a tool belt with a
// hammer on the hip, a pencil behind the ear and a claw hammer in the right hand.
// Quill the bookworm (Step 48): librarian. Soft green segmented body with a cream belly, a red bow tie, big round glasses, two golden-tipped feelers, a tiny
// red book in the right hand and a little tail curl.
import * as THREE from 'three';
import { Baker, castMesh, makeToon, xf } from '../player/character.js';

const EYE = '#241a33';
// Step 80e: setLowDetail(true) makes the next models built (createTdoongModel) with fewer segments, about 45% of the triangles: the trophy ceremony's crowd of nine is baked that way (world/party/ceremony.js). Default OFF.
let low = false;
export const setLowDetail = (on) => { low = !!on; };
export const sphere = () => (low ? new THREE.SphereGeometry(1, 10, 8) : new THREE.SphereGeometry(1, 16, 12));
export const sphereLo = () => (low ? new THREE.SphereGeometry(1, 8, 6) : new THREE.SphereGeometry(1, 10, 8));
export const cyl = (n = 10) => new THREE.CylinderGeometry(1, 1, 1, low ? Math.min(n, 8) : n);
export const capsule = (r, l) => (low ? new THREE.CapsuleGeometry(r, l, 3, 8) : new THREE.CapsuleGeometry(r, l, 6, 12));

/** Matrix that places something on an ellipsoid head (semi-axes a, b, c) at (x, y): z follows the surface, +Z along its normal. */
export function surf(a, b, c, x, y, lift = 0) {
  const t = 1 - (x / a) ** 2 - (y / b) ** 2;
  const z = c * Math.sqrt(Math.max(t, 0.0001));
  const n = new THREE.Vector3(x / (a * a), y / (b * b), z / (c * c)).normalize();
  const p = new THREE.Vector3(x, y, z).addScaledVector(n, lift);
  return new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n), new THREE.Vector3(1, 1, 1));
}
export const at = (m, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]) => m.clone().multiply(xf(p, r, s));
export const yOf = (m) => new THREE.Vector3().setFromMatrixPosition(m).y;

/** A pair of eyes: dark bead + a white highlight, flagged for the shader blink. */
export function eyes(hb, a, b, c, x, y, size = 1) {
  for (const side of [-1, 1]) {
    const place = surf(a, b, c, x * side, y, -0.005);
    const cy = yOf(place);
    const part = (geo, p, s, color) => hb.add(geo, at(place, p, [0, 0, 0], s), { color, flat: 1, eye: cy });
    part(sphere(), [0, 0, 0], [0.062 * size, 0.088 * size, 0.03], EYE);
    part(sphereLo(), [0.02 * size, 0.034 * size, 0.024], [0.022 * size, 0.022 * size, 0.012], '#ffffff');
  }
}

// ---------------------------------------------------------------------------------------------
// Cobble the mole
// ---------------------------------------------------------------------------------------------
function buildMole(bake) {
  const FUR = '#5f5568', PINK = '#f4a3b5', PINK_DARK = '#e9879f', LEATHER = '#c28a52', LEATHER_DARK = '#a06a3a';
  const HAT = '#ff8a2e', HAT_DARK = '#e8691c', CREAM = '#fff0d6', GOLD = '#e8c15a', WOOD = '#c98a54', STEEL = '#c9ced8';

  const body = new Baker();
  body.add(sphere(), xf([0, 0.5, 0], [0, 0, 0], [0.33, 0.29, 0.3]), { color: FUR, outline: 0.03 });
  body.add(sphere(), xf([0, 0.42, 0.22], [0.1, 0, 0], [0.21, 0.23, 0.1]), { color: LEATHER, outline: 0.022 });      // apron
  body.add(sphereLo(), xf([0.1, 0.34, 0.29], [0.1, 0, 0.2], [0.07, 0.065, 0.03]), { color: LEATHER_DARK, outline: 0.014 });   // pocket
  body.add(cyl(6), xf([0.1, 0.4, 0.28], [0.1, 0, 0.35], [0.014, 0.1, 0.014]), { color: WOOD, outline: 0.01 });     // chisel handle
  body.add(cyl(6), xf([0.114, 0.47, 0.285], [0.1, 0, 0.35], [0.016, 0.035, 0.016]), { color: STEEL, outline: 0.01 });   // chisel blade
  for (const s of [-1, 1]) {
    body.add(capsule(0.085, 0.06), xf([0.13 * s, 0.2, 0.0]), { color: FUR, outline: 0.026 });                      // legs
    body.add(sphere(), xf([0.13 * s, 0.07, 0.05], [0, 0, 0], [0.115, 0.075, 0.16]), { color: PINK, outline: 0.026 });   // bare pink feet
  }

  const hb = new Baker();
  const A = 0.5, B = 0.42, C = 0.46;
  hb.add(sphere(), xf([0, 0, 0], [0, 0, 0], [A, B, C]), { color: FUR, outline: 0.035 });
  hb.add(sphere(), xf([0, -0.09, 0.43], [0.15, 0, 0], [0.17, 0.15, 0.2]), { color: PINK, outline: 0.026 });         // snout
  hb.add(sphere(), xf([0, -0.055, 0.61], [0, 0, 0], [0.09, 0.075, 0.075]), { color: PINK_DARK, outline: 0.02 });    // big nose
  hb.add(sphereLo(), xf([-0.035, -0.04, 0.665], [0, 0, 0], [0.022, 0.016, 0.012]), { color: '#ffffff', flat: 0.6 });   // nose shine
  for (const s of [-1, 1]) {
    hb.add(sphere(), xf([0.5 * s, -0.02, -0.02], [0, 0, 0], [0.07, 0.1, 0.07]), { color: FUR });                    // ear nubs
    hb.add(sphere(), at(surf(A, B, C, 0.31 * s, -0.12, 0.004), [0, 0, 0], [0, 0, 0], [0.065, 0.045, 0.01]), { color: '#e58fa8', flat: 1 });   // blush
  }
  eyes(hb, A, B, C, 0.17, 0.1, 0.8);
  for (const s of [-1, 1]) {                                                                                         // round gold glasses
    const place = surf(A, B, C, 0.17 * s, 0.1, 0.02);
    hb.add(new THREE.TorusGeometry(0.115, 0.017, 6, 20), place, { color: GOLD, outline: 0.012 });
  }
  hb.add(cyl(6), xf([0, 0.1, A * 0.9], [0, 0, Math.PI / 2], [0.012, 0.1, 0.012]), { color: GOLD });                  // glasses bridge
  // hard hat: dome + brim + front bill + ridge + lamp
  const domeY = 0.1;
  hb.add(new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, 1.25), xf([0, domeY, 0], [0, 0, 0], [0.52, 0.5, 0.5]), { color: HAT, outline: 0.03, inner: true });
  hb.add(cyl(20), xf([0, domeY + 0.5 * Math.cos(1.25), 0], [0, 0, 0], [0.585, 0.045, 0.56]), { color: HAT_DARK, outline: 0.02 });
  hb.add(sphere(), xf([0, domeY + 0.17, 0.46], [0.1, 0, 0], [0.3, 0.035, 0.22]), { color: HAT_DARK, outline: 0.02 });
  hb.add(cyl(8), xf([0, domeY + 0.45, 0], [Math.PI / 2, 0, 0], [0.05, 0.78, 0.05]), { color: HAT_DARK, outline: 0.02 });
  hb.add(sphereLo(), xf([0, domeY + 0.3, 0.47], [0.3, 0, 0], [0.07, 0.06, 0.04]), { color: '#fff6c8', flat: 0.7, outline: 0.012 });

  const makeArm = (side, tool) => {
    const b = new Baker();
    b.add(capsule(0.09, 0.1), xf([0, -0.1, 0]), { color: FUR, outline: 0.028 });
    b.add(sphere(), xf([0, -0.27, 0.025], [0, 0, 0], [0.135, 0.105, 0.115]), { color: PINK, outline: 0.026 });       // big digging paw
    for (const cx of [-0.05, 0, 0.05]) b.add(new THREE.ConeGeometry(1, 1, 6), xf([cx, -0.355, 0.07], [Math.PI, 0, 0], [0.022, 0.07, 0.022]), { color: CREAM, outline: 0.01 });
    if (tool) {                                                                                                      // wooden mallet
      b.add(cyl(8), xf([0, -0.27, 0.22], [Math.PI / 2, 0, 0], [0.026, 0.42, 0.026]), { color: WOOD, outline: 0.014 });
      b.add(cyl(12), xf([0, -0.27, 0.44], [0, 0, Math.PI / 2], [0.095, 0.27, 0.095]), { color: '#b97d48', outline: 0.022 });
      for (const s of [-1, 1]) b.add(cyl(12), xf([0.125 * s, -0.27, 0.44], [0, 0, Math.PI / 2], [0.1, 0.03, 0.1]), { color: '#6e6a88', outline: 0.014 });
    }
    return bake(b);
  };
  const tail = new Baker();
  tail.add(sphere(), xf([0, 0, -0.04], [0, 0, 0], [0.065, 0.06, 0.07]), { color: PINK, outline: 0.02 });
  return { body, head: hb, armL: makeArm(1, false), armR: makeArm(-1, true), tail, headY: 0.98, shoulderY: 0.66, shoulderX: 0.35, tailPivot: [0, 0.3, -0.3] };
}

// ---------------------------------------------------------------------------------------------
// Bramble the beaver
// ---------------------------------------------------------------------------------------------
function buildBeaver(bake) {
  const FUR = '#9b6234', FUR_DARK = '#7a4a2a', CREAM = '#ecd0a2', TAIL = '#5b3a21', TAIL_LIGHT = '#7a4e2c', BELT = '#6b3f20', ORANGE = '#ffa23a';
  const WOOD = '#c98a54', STEEL = '#b7bcc9';

  const body = new Baker();
  body.add(sphere(), xf([0, 0.5, 0], [0, 0, 0], [0.34, 0.3, 0.31]), { color: FUR, outline: 0.03 });
  body.add(sphereLo(), xf([0, 0.5, 0.2], [0, 0, 0], [0.2, 0.22, 0.12]), { color: CREAM });                            // belly
  body.add(new THREE.TorusGeometry(0.305, 0.042, 8, 22), xf([0, 0.4, 0], [Math.PI / 2, 0, 0], [1.1, 1.0, 1.0]), { color: BELT, outline: 0.02 });   // tool belt
  body.add(sphereLo(), xf([0, 0.4, 0.325], [0, 0, 0], [0.075, 0.06, 0.03]), { color: '#ffd23c', outline: 0.014 });   // buckle
  for (const s of [-1, 1]) body.add(sphere(), xf([0.22 * s, 0.36, 0.2], [0.1, 0.5 * s, 0], [0.085, 0.085, 0.06]), { color: '#8a5a34', outline: 0.018 });   // pouches
  body.add(cyl(6), xf([-0.33, 0.28, 0.1], [0, 0, 0.12], [0.016, 0.22, 0.016]), { color: WOOD, outline: 0.012 });      // hammer hanging on the hip
  body.add(sphereLo(), xf([-0.33, 0.4, 0.1], [0, 0, 0.12], [0.075, 0.04, 0.04]), { color: STEEL, outline: 0.014 });
  for (const s of [-1, 1]) {
    body.add(capsule(0.09, 0.06), xf([0.14 * s, 0.2, 0.0]), { color: FUR_DARK, outline: 0.026 });
    body.add(sphere(), xf([0.14 * s, 0.065, 0.06], [0, 0, 0], [0.12, 0.07, 0.19]), { color: TAIL, outline: 0.026 });  // big flat feet
  }

  const hb = new Baker();
  const A = 0.5, B = 0.42, C = 0.45;
  hb.add(sphere(), xf([0, 0, 0], [0, 0, 0], [A, B, C]), { color: FUR, outline: 0.035 });
  for (const s of [-1, 1]) {
    hb.add(sphere(), xf([0.11 * s, -0.13, 0.36], [0, 0, 0], [0.16, 0.14, 0.14]), { color: CREAM, outline: 0.02 });    // cheek puffs
    hb.add(sphere(), xf([0.34 * s, 0.33, -0.04], [0, 0, 0], [0.105, 0.105, 0.075]), { color: FUR_DARK, outline: 0.026 });   // round ears
    hb.add(sphereLo(), xf([0.34 * s, 0.33, 0.005], [0, 0, 0], [0.06, 0.06, 0.03]), { color: '#e9a09a' });
    hb.add(sphere(), at(surf(A, B, C, 0.32 * s, -0.1, 0.004), [0, 0, 0], [0, 0, 0], [0.06, 0.04, 0.01]), { color: '#ff8fb3', flat: 1 });   // blush
  }
  hb.add(sphere(), xf([0, -0.045, 0.495], [0, 0, 0], [0.095, 0.065, 0.06]), { color: '#3d2413', outline: 0.018 });   // nose
  hb.add(sphereLo(), xf([-0.03, -0.03, 0.54], [0, 0, 0], [0.022, 0.015, 0.012]), { color: '#ffffff', flat: 0.6 });
  for (const s of [-1, 1]) hb.add(sphere(), xf([0.04 * s, -0.19, 0.48], [0.1, 0, 0], [0.045, 0.085, 0.035]), { color: ORANGE, outline: 0.016 });   // big front teeth
  eyes(hb, A, B, C, 0.2, 0.1, 1.0);
  hb.add(cyl(6), xf([0.39, 0.3, 0.0], [0.2, 0, 0.9], [0.02, 0.22, 0.02]), { color: '#ffd23c', outline: 0.012 });        // pencil behind the ear
  hb.add(cyl(6), xf([0.44, 0.38, 0.03], [0.2, 0, 0.9], [0.018, 0.04, 0.018]), { color: '#3d2413' });

  const makeArm = (side, tool) => {
    const b = new Baker();
    b.add(capsule(0.09, 0.1), xf([0, -0.1, 0]), { color: FUR, outline: 0.028 });
    b.add(sphere(), xf([0, -0.255, 0.02], [0, 0, 0], [0.095, 0.085, 0.09]), { color: FUR_DARK, outline: 0.026 });
    if (tool) {                                                                                                      // claw hammer
      b.add(cyl(8), xf([0, -0.26, 0.2], [Math.PI / 2, 0, 0], [0.026, 0.4, 0.026]), { color: WOOD, outline: 0.014 });
      b.add(sphere(), xf([0, -0.26, 0.41], [0, 0, 0], [0.15, 0.075, 0.075]), { color: STEEL, outline: 0.02 });
      b.add(new THREE.ConeGeometry(1, 1, 6), xf([-0.17, -0.26, 0.41], [0, 0, Math.PI / 2], [0.035, 0.1, 0.035]), { color: '#9aa0b0', outline: 0.012 });
    }
    return bake(b);
  };
  const tail = new Baker();
  tail.add(sphere(), xf([0, -0.02, -0.34], [-0.4, 0, 0], [0.24, 0.05, 0.37]), { color: TAIL, outline: 0.026 });         // flat paddle
  for (let i = -2; i <= 2; i++) tail.add(sphereLo(), xf([0, 0.035 - Math.abs(i) * 0.012, -0.34 + i * 0.093], [-0.4, 0, 0], [0.19 - Math.abs(i) * 0.02, 0.014, 0.028]), { color: TAIL_LIGHT });
  return { body, head: hb, armL: makeArm(1, false), armR: makeArm(-1, true), tail, headY: 0.98, shoulderY: 0.66, shoulderX: 0.36, tailPivot: [0, 0.3, -0.28] };
}

// ---------------------------------------------------------------------------------------------
// Quill the bookworm
// ---------------------------------------------------------------------------------------------
function buildWorm(bake) {
  const GREEN = '#8fd45f', GREEN_LIGHT = '#b2e784', GREEN_DARK = '#6bb44a', BELLY = '#f6f1c4', RED = '#e0504f', RIM = '#5a3b2a', GOLD = '#ffd85e', FEET = '#ff9d6b';

  const body = new Baker();
  body.add(sphere(), xf([0, 0.5, 0], [0, 0, 0], [0.31, 0.3, 0.29]), { color: GREEN, outline: 0.03 });
  body.add(sphereLo(), xf([0, 0.46, 0.2], [0.05, 0, 0], [0.2, 0.22, 0.1]), { color: BELLY });                                     // cream belly plate
  for (const y of [0.62, 0.4]) body.add(new THREE.TorusGeometry(0.285, 0.026, 6, 22), xf([0, y, 0], [Math.PI / 2, 0, 0], [1.0, 1.0, 1.0]), { color: GREEN_DARK });   // body segment rings
  for (const s of [-1, 1]) {
    body.add(new THREE.ConeGeometry(1, 1, 8), xf([0.1 * s, 0.7, 0.26], [0, 0, Math.PI / 2 * -s], [0.07, 0.13, 0.04]), { color: RED, outline: 0.014 });   // bow tie wings
    body.add(capsule(0.075, 0.05), xf([0.12 * s, 0.2, 0.0]), { color: GREEN_DARK, outline: 0.026 });
    body.add(sphere(), xf([0.12 * s, 0.065, 0.07], [0, 0, 0], [0.11, 0.065, 0.16]), { color: FEET, outline: 0.026 });                // tiny feet
  }
  body.add(sphereLo(), xf([0, 0.7, 0.27], [0, 0, 0], [0.045, 0.045, 0.04]), { color: '#c43d3d', outline: 0.012 });                   // the bow's knot

  const hb = new Baker();
  const A = 0.5, B = 0.45, C = 0.47;
  hb.add(sphere(), xf([0, 0, 0], [0, 0, 0], [A, B, C]), { color: GREEN_LIGHT, outline: 0.035 });
  for (const s of [-1, 1]) {
    hb.add(sphere(), at(surf(A, B, C, 0.31 * s, -0.13, 0.004), [0, 0, 0], [0, 0, 0], [0.065, 0.045, 0.01]), { color: '#ff9fb0', flat: 1 });   // blush
    hb.add(cyl(6), xf([0.17 * s, 0.5, 0.0], [0, 0, -0.35 * s], [0.018, 0.2, 0.018]), { color: GREEN_DARK });                          // feelers
    hb.add(sphereLo(), xf([0.215 * s, 0.7, 0.0], [0, 0, 0], [0.06, 0.06, 0.06]), { color: GOLD, outline: 0.016 });
  }
  eyes(hb, A, B, C, 0.17, 0.08, 0.85);
  for (const s of [-1, 1]) {                                                                                                          // big round glasses
    hb.add(new THREE.TorusGeometry(0.125, 0.02, 6, 22), surf(A, B, C, 0.17 * s, 0.08, 0.025), { color: RIM, outline: 0.012 });
  }
  hb.add(cyl(6), xf([0, 0.08, A * 0.92], [0, 0, Math.PI / 2], [0.012, 0.09, 0.012]), { color: RIM });                                  // glasses bridge
  hb.add(sphereLo(), xf([0, -0.17, 0.43], [0.1, 0, 0], [0.09, 0.034, 0.03]), { color: '#8a4b3a', flat: 0.8 });                           // a small smile

  const makeArm = (side, tool) => {
    const b = new Baker();
    b.add(capsule(0.085, 0.1), xf([0, -0.1, 0]), { color: GREEN, outline: 0.028 });
    b.add(sphere(), xf([0, -0.26, 0.02], [0, 0, 0], [0.095, 0.085, 0.09]), { color: GREEN_LIGHT, outline: 0.026 });
    if (tool) {                                                                                                                       // a tiny book with a ribbon
      b.add(new THREE.BoxGeometry(1, 1, 1), xf([0, -0.27, 0.22], [0.4, 0, 0], [0.26, 0.07, 0.34]), { color: RED, outline: 0.018 });
      b.add(new THREE.BoxGeometry(1, 1, 1), xf([0, -0.27, 0.225], [0.4, 0, 0], [0.22, 0.075, 0.3]), { color: '#fff4dc' });
      b.add(new THREE.BoxGeometry(1, 1, 1), xf([-0.1, -0.27, 0.22], [0.4, 0, 0], [0.03, 0.09, 0.34]), { color: '#c43d3d' });
    }
    return bake(b);
  };
  const tail = new Baker();
  tail.add(sphere(), xf([0, 0, -0.06], [0, 0, 0], [0.09, 0.08, 0.1]), { color: GREEN, outline: 0.02 });
  tail.add(new THREE.ConeGeometry(1, 1, 8), xf([0, 0.06, -0.2], [-1.0, 0, 0], [0.06, 0.2, 0.06]), { color: GREEN_DARK, outline: 0.014 });
  return { body, head: hb, armL: makeArm(1, false), armR: makeArm(-1, true), tail, headY: 0.98, shoulderY: 0.66, shoulderX: 0.34, tailPivot: [0, 0.3, -0.3] };
}

// ---------------------------------------------------------------------------------------------
export function createNpcModel(species) {
  const blink = { value: 1 };
  const mat = makeToon(blink, 'npc-toon');
  const baked = [];
  const bake = (b) => { const e = b.build(); baked.push(e); return e; };
  const spec = species === 'beaver' ? buildBeaver(bake) : species === 'bookworm' ? buildWorm(bake) : buildMole(bake);

  const root = new THREE.Group();
  root.name = `npc-${species}`;
  const rig = new THREE.Group();
  rig.name = 'rig';
  root.add(rig);
  const torso = new THREE.Group();
  torso.name = 'torso';
  rig.add(torso);

  const meshes = [];
  const add = (parent, entry, name, cast) => {
    const m = castMesh(entry.geo, mat, cast);
    m.name = name;
    parent.add(m);
    meshes.push(m);
    return m;
  };
  add(torso, bake(spec.body), 'npc-body', true);

  const makeArmGroup = (side, entry, name, cast) => {
    const g = new THREE.Group();
    g.name = name;
    g.position.set(spec.shoulderX * side, spec.shoulderY, 0);
    add(g, entry, `${name}-mesh`, cast);
    g.rotation.z = 0.2 * side;
    g.userData.restZ = g.rotation.z;
    torso.add(g);
    return g;
  };
  const armL = makeArmGroup(1, spec.armL, 'armL', false);
  const armR = makeArmGroup(-1, spec.armR, 'armR', true);

  const headGroup = new THREE.Group();
  headGroup.name = 'headGroup';
  headGroup.position.y = spec.headY;
  torso.add(headGroup);
  add(headGroup, bake(spec.head), 'npc-head', true);

  const tail = new THREE.Group();
  tail.name = 'tail';
  tail.position.set(...spec.tailPivot);
  rig.add(tail);
  add(tail, bake(spec.tail), 'npc-tail', false);

  let drawCalls = 0;
  for (const m of meshes) drawCalls += m.castShadow ? 2 : 1;

  return {
    root, rig, torso, headGroup, armL, armR, tail, species,
    height: 1.65,
    drawCalls,
    setBlink(closed) { blink.value = 1 - 0.88 * closed; },
    dispose() { for (const e of baked) e.geo.dispose(); mat.dispose(); },
  };
}
