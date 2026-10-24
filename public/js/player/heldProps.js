// Cosmetic hand accessories: no tool rules, inventory, damage, lights or shadows.
// attachHeldProp(character, id, { isOccupied? }) -> cleanup function with
// update(timeSeconds, { occupied? }), setHidden(boolean), object and id properties.
// Call update each frame: gameplay equipment always takes precedence, including
// tools moving toward the hand (supply isOccupied: () => player.holding).
import * as THREE from 'three';
import { Baker, xf, castMesh } from './character.js';

import { normaliseHeldProp } from './appearance.js';
export { HELD_PROPS, normaliseHeldProp } from './appearance.js';
const active = new WeakMap();

export function attachHeldProp(character, id = 'none', { isOccupied = () => false } = {}) {
  if (character && typeof character === 'object') active.get(character)?.();
  id = normaliseHeldProp(id);
  const socket = character?.parts?.handSocket, material = character?.parts?.head?.material;
  if (!socket || !material || id === 'none') {
    const noop = () => {};
    Object.assign(noop, { update() {}, setHidden() {}, object: null, id: 'none' });
    return noop;
  }
  const root = new THREE.Group(); root.name = `held-prop-${id}`;
  root.rotation.set(-0.12, 0, 0.12);
  const owned = [], b = new Baker();
  let spinner = null, flame = null, disposed = false, hidden = false, occupied = false, time = 0;
  const mesh = (bake, parent = root) => {
    const model = castMesh(bake.build().geo, material, false);
    model.name = `held-prop-${id}-mesh`; model.receiveShadow = false;
    parent.add(model); owned.push(model); return model;
  };
  const add = (bake, geo, color, position, scale = [1, 1, 1], rotation = [0, 0, 0], options = {}) =>
    bake.add(geo, xf(position, rotation, scale), { color, outline: 0.018, ...options });
  const stick = (bake, y, height, color = '#a46e49', radius = 0.035) =>
    add(bake, new THREE.CylinderGeometry(radius, radius * 1.15, height, 8), color, [0, y, 0]);
  const ball = (bake, color, position, scale, options = {}) =>
    add(bake, new THREE.SphereGeometry(1, 8, 6), color, position, scale, [0, 0, 0], options);
  const box = (bake, color, position, scale, rotation = [0, 0, 0]) =>
    add(bake, new THREE.BoxGeometry(1, 1, 1), color, position, scale, rotation);

  if (id === 'lantern') {
    add(b, new THREE.TorusGeometry(0.12, 0.025, 4, 12), '#536e72', [0, 0.07, 0]);
    box(b, '#89cdb5', [0, -0.08, 0], [0.3, 0.06, 0.25]);
    box(b, '#89cdb5', [0, -0.34, 0], [0.3, 0.06, 0.25]);
    for (const x of [-0.13, 0.13]) for (const z of [-0.1, 0.1])
      box(b, '#536e72', [x, -0.21, z], [0.035, 0.24, 0.035]);
    // Warm flat colour reads as a glow without adding any scene light.
    ball(b, '#ffe2a2', [0, -0.21, 0], [0.1, 0.1, 0.08], { flat: 1, outline: 0 });
    ball(b, '#fff6c9', [0.02, -0.19, 0.05], [0.04, 0.05, 0.03], { flat: 1, outline: 0 });
  } else if (id === 'torch') {
    stick(b, 0.15, 0.6);
    for (const y of [0.33, 0.39, 0.45])
      add(b, new THREE.CylinderGeometry(0.07, 0.08, 0.055, 8), '#dcc18b', [0, y, 0]);
    flame = new THREE.Group(); flame.position.y = 0.5; root.add(flame);
    const fire = new Baker();
    ball(fire, '#f59a59', [0, 0.12, 0], [0.13, 0.22, 0.11], { flat: 1, outline: 0.015 });
    ball(fire, '#ffe4a0', [0, 0.08, 0.075], [0.075, 0.13, 0.05], { flat: 1, outline: 0 });
    mesh(fire, flame);
  } else if (id === 'flower') {
    stick(b, 0.24, 0.7, '#649a61', 0.025);
    ball(b, '#8bbd78', [0.12, 0.2, 0], [0.16, 0.055, 0.05]);
    for (let k = 0; k < 5; k++) {
      const angle = k * Math.PI * 2 / 5;
      add(b, new THREE.SphereGeometry(1, 8, 6), '#fff0cd', [Math.cos(angle) * 0.16, 0.65 + Math.sin(angle) * 0.16, 0.01], [0.125, 0.1, 0.045], [0, 0, angle]);
    }
    ball(b, '#f5c76b', [0, 0.65, 0.065], [0.1, 0.1, 0.04]);
  } else if (id === 'pinwheel') {
    stick(b, 0.23, 0.72, '#caa579', 0.025);
    spinner = new THREE.Group(); spinner.position.set(0, 0.66, 0.045); root.add(spinner);
    const wheel = new Baker(), colors = ['#f19b91', '#edcc75', '#8acbb4', '#b4a1de'];
    for (let k = 0; k < 4; k++) {
      const angle = k * Math.PI / 2;
      box(wheel, colors[k], [Math.cos(angle) * 0.12, Math.sin(angle) * 0.12, 0], [0.25, 0.13, 0.035], [0, 0, angle + 0.45]);
    }
    ball(wheel, '#fff0cd', [0, 0, 0.05], [0.06, 0.06, 0.04]);
    mesh(wheel, spinner);
  } else if (id === 'umbrella') {
    stick(b, 0.65, 1.55, '#caa579', 0.025);
    add(b, new THREE.TorusGeometry(0.63, 0.018, 3, 16), '#776580', [0, 1.21, 0], [1, 1, 1], [Math.PI / 2, 0, 0], { outline: 0 });
    const colors = ['#eaa6af', '#f4d58d', '#9bcbb6', '#b8a8dc'];
    for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 4, next = (k + 1) * Math.PI / 4;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([
        0, 1.43, 0, Math.cos(a) * 0.63, 1.21, Math.sin(a) * 0.63,
        Math.cos(next) * 0.63, 1.21, Math.sin(next) * 0.63,
      ], 3));
      g.setIndex([0, 1, 2]); g.computeVertexNormals();
      add(b, g, colors[k % 4], [0, 0, 0], [1, 1, 1], [0, 0, 0], { inner: true, outline: 0.012 });
    }
    ball(b, '#fff0cd', [0, 1.43, 0], [0.05, 0.05, 0.05]);
  }
  mesh(b); socket.add(root);

  function refresh() {
    // Never remove or hide actual equipment; only this cosmetic attachment yields.
    const anotherAttachment = socket.children.some(child => child !== root && child.visible);
    root.visible = !disposed && !hidden && !occupied && !anotherAttachment && !isOccupied();
  }
  const cleanup = () => {
    if (disposed) return;
    disposed = true; root.removeFromParent();
    for (const model of owned) model.geometry.dispose();
    if (active.get(character) === cleanup) active.delete(character);
  };
  Object.assign(cleanup, {
    object: root, id,
    setHidden(value) { if (disposed) return; hidden = !!value; refresh(); },
    update(seconds = 0, options = {}) {
      if (disposed) return;
      if (Number.isFinite(seconds)) time = seconds;
      occupied = !!options.occupied;
      if (spinner) spinner.rotation.z = time * 1.4;
      if (flame) { flame.scale.set(1 + Math.sin(time * 2.4) * 0.035, 1 + Math.sin(time * 2.1) * 0.05, 1); }
      root.rotation.z = 0.12 + (id === 'lantern' ? Math.sin(time * 1.25) * 0.045 : 0);
      refresh();
    },
  });
  active.set(character, cleanup); refresh();
  return cleanup;
}
