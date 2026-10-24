// Cosmetic overlays on the original character rig. No sockets, physics, animations or gameplay values change.
// attachVariant(character, id) -> idempotent cleanup; attaching again restores the previous appearance first.
import * as THREE from 'three';
import { Baker, xf, castMesh } from './character.js';

export const CHARACTER_VARIANTS = Object.freeze([
  { id: 'original', name: 'Sprout', description: 'The familiar island adventurer', color: '#83cda4' },
  { id: 'rowan', name: 'Rowan', description: 'A little woodland traveler with very big ears', color: '#bc8855' },
  { id: 'pip', name: 'Pip', description: 'A round coral pond explorer', color: '#f1978b' },
  { id: 'marlow', name: 'Marlow', description: 'A broad stone friend with a gentle glow', color: '#8896aa' },
  { id: 'clover', name: 'Clover', description: 'A long-haired, leaf-eared forest wanderer', color: '#bac7e7' },
  { id: 'sunny', name: 'Sunny', description: 'A friendly Halloween skeleton in an orange scarf', color: '#f3dfb4' },
].map(Object.freeze));
const active = new WeakMap();
const INK = '#2b2340';
export const normaliseVariant = (id) => CHARACTER_VARIANTS.some((v) => v.id === id) ? id : 'original';

export function attachVariant(character, id = 'original') {
  active.get(character)?.();
  id = normaliseVariant(id);
  if (!character?.parts || id === 'original') return () => {};
  const p = character.parts, owned = [], hidden = [], scheme = character.colors;
  let disposed = false;
  const hide = (mesh) => { if (mesh) { hidden.push([mesh, mesh.visible]); mesh.visible = false; } };
  const mesh = (parent, bake) => {
    const g = bake.build().geo;
    const m = castMesh(g, p.head.material); m.name = `variant-${id}`; parent.add(m); owned.push(m); return m;
  };
  const ball = (b, at, scale, color, outline = 0.025) => b.add(new THREE.SphereGeometry(1, 14, 10), xf(at, [0, 0, 0], scale), { color, outline });
  const box = (b, at, scale, color) => b.add(new THREE.BoxGeometry(1, 1, 1, 1, 1, 1), xf(at, [0, 0, 0], scale), { color, outline: 0.022 });
  const face = (b, eyesY, eyesZ, eyeSize = 0.065) => {
    for (const s of [-1, 1]) {
      ball(b, [s * 0.16, eyesY, eyesZ], [eyeSize, eyeSize * 1.2, 0.035], INK, 0);
      ball(b, [s * 0.16 + 0.014, eyesY + 0.025, eyesZ + 0.03], [0.018, 0.018, 0.01], '#fff8e6', 0);
    }
  };
  const head = new Baker(), body = new Baker();
  if (id === 'rowan') {
    // A low cloak and oversized ears make a short, wide silhouette without moving hat or hand sockets.
    for (const s of [-1, 1]) ball(head, [s * 0.45, -0.05, 0], [0.2, 0.12, 0.1], '#e4b989');
    ball(head, [0, -0.25, -0.25], [0.45, 0.2, 0.2], '#86583b');
    body.add(new THREE.ConeGeometry(0.43, 0.62, 12, 1, true), xf([0, 0.48, -0.03]), { color: '#55744a', outline: 0.025, inner: true });
    ball(body, [0, 0.68, 0.28], [0.08, 0.065, 0.04], '#eac477');
    character.setColors({ shirt: '#55744a', pants: '#816246', hat: '#b98954', cuff: '#e1c487' });
  } else if (id === 'pip') {
    hide(p.head); hide(character.defaultHat); hide(p.body);
    ball(head, [0, -0.05, 0], [0.55, 0.37, 0.42], '#f1978b');
    for (const s of [-1, 1]) ball(head, [s * 0.29, 0.24, 0.13], [0.17, 0.2, 0.16], '#f1978b');
    for (const s of [-1, 1]) {
      ball(head, [s * 0.29, 0.25, 0.285], [0.065, 0.085, 0.03], INK, 0);
      ball(head, [s * 0.29 + 0.015, 0.28, 0.312], [0.02, 0.025, 0.01], '#fff8e6', 0);
      ball(head, [s * 0.35, -0.11, 0.32], [0.08, 0.04, 0.02], '#d66980', 0);
    }
    ball(head, [0, -0.13, 0.4], [0.08, 0.017, 0.014], INK, 0);
    ball(body, [0, 0.52, 0], [0.43, 0.33, 0.34], '#f1978b');
    ball(body, [0, 0.5, 0.27], [0.3, 0.23, 0.09], '#ffe5bd');
    character.setColors({ shirt: '#f1978b', pants: '#d66e81' });
  } else if (id === 'marlow') {
    hide(p.head); hide(character.defaultHat); hide(p.body);
    box(head, [0, 0, 0], [0.86, 0.72, 0.7], '#95a2ac');
    face(head, 0.02, 0.36, 0.055);
    box(head, [0, -0.17, 0.36], [0.14, 0.025, 0.025], INK);
    box(head, [0.22, 0.38, -0.08], [0.28, 0.09, 0.32], '#8ca86d');
    box(body, [0, 0.55, 0], [0.75, 0.55, 0.55], '#7c8999');
    ball(body, [0, 0.57, 0.3], [0.12, 0.13, 0.055], '#a9e7cb');
    for (const arm of [p.armL, p.armR]) { const b = new Baker(); box(b, [0, -0.12, 0], [0.24, 0.24, 0.24], '#95a2ac'); mesh(arm, b); }
    character.setColors({ shirt: '#7c8999', pants: '#667382' });
  } else if (id === 'clover') {
    for (const s of [-1, 1]) {
      head.add(new THREE.ConeGeometry(0.13, 0.4, 8), xf([s * 0.52, 0.03, -0.015], [0, 0, -s * Math.PI / 2], [1, 1, 0.6]), { color: '#d9bcb3', outline: 0.02 });
      ball(head, [s * 0.3, -0.28, -0.24], [0.17, 0.62, 0.21], '#c7c4e8');
    }
    ball(head, [0, 0.2, -0.14], [0.44, 0.23, 0.36], '#c7c4e8');
    body.add(new THREE.ConeGeometry(0.3, 0.75, 12, 1, true), xf([0, 0.44, 0]), { color: '#537c72', outline: 0.02, inner: true });
    character.setColors({ shirt: '#537c72', pants: '#536376', hat: '#8d9b79', cuff: '#d7c9a3' });
  } else if (id === 'sunny') {
    hide(p.head); hide(character.defaultHat); hide(p.body);
    ball(head, [0, 0.02, 0], [0.43, 0.38, 0.36], '#f3dfb4');
    box(head, [0, -0.23, 0.12], [0.48, 0.16, 0.32], '#f3dfb4');
    face(head, 0.035, 0.335, 0.105);
    ball(head, [0, -0.1, 0.355], [0.035, 0.04, 0.018], '#8c715f', 0);
    for (const x of [-0.12, 0, 0.12]) box(head, [x, -0.24, 0.29], [0.025, 0.065, 0.02], '#8c715f');
    box(body, [0, 0.5, 0], [0.09, 0.38, 0.1], '#f3dfb4');
    for (const y of [0.4, 0.51, 0.62]) ball(body, [0, y, 0.02], [0.26, 0.035, 0.15], '#f3dfb4');
    ball(body, [0, 0.73, 0], [0.29, 0.07, 0.19], '#e79749');
    box(body, [-0.2, 0.61, 0.2], [0.13, 0.28, 0.06], '#e79749');
    for (const limb of [p.armL, p.armR, p.legL, p.legR]) {
      hide(limb.children.find((m) => m.name.endsWith('-mesh')));
      const b = new Baker(); ball(b, [0, -0.14, 0], [0.055, 0.18, 0.055], '#f3dfb4');
      ball(b, [0, -0.25, 0.02], [0.08, 0.07, 0.09], '#f3dfb4'); mesh(limb, b);
    }
  }
  mesh(p.headGroup, head); mesh(p.torso, body);
  const cleanup = () => {
    if (disposed) return; disposed = true;
    for (const m of owned) { m.removeFromParent(); m.geometry.dispose(); }
    for (const [m, visible] of hidden) m.visible = visible;
    character.setColors(scheme);
    if (active.get(character) === cleanup) active.delete(character);
  };
  active.set(character, cleanup);
  return cleanup;
}
