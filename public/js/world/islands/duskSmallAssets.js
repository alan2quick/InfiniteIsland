// Cached, merged low-poly ambient marsh assets (69d). getSmallAsset(kind) -> { geo, outlineGeo? }.
// aRole uses the existing dusk glow/toon program: 1 shaded, 5 emissive, 7 unlit shelves. No new lights or material variants.
import * as THREE from 'three';
import { G, part, combine, smoothOutlineGeo } from '../../render/geo.js';
import { DUSK_SMALL } from '../../config.js';

const C = DUSK_SMALL.colors, cache = new Map();
const stem = new THREE.CylinderGeometry(1, 1, 1, 3, 1), blade = new THREE.ConeGeometry(1, 1, 3, 1);
const petal = new THREE.OctahedronGeometry(1, 0);
const starShape = new THREE.Shape();
for (let k = 0; k < 10; k++) { const a = k * Math.PI / 5, r = k % 2 ? 0.42 : 1; if (k === 0) starShape.moveTo(Math.cos(a) * r, Math.sin(a) * r); else starShape.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
starShape.closePath();
const star = new THREE.ShapeGeometry(starShape); star.rotateX(-Math.PI / 2);
const ball = new THREE.SphereGeometry(1, 6, 4), stone = new THREE.IcosahedronGeometry(1, 0);
const disk = new THREE.CircleGeometry(1, 12); disk.rotateX(-Math.PI / 2);
const pad = new THREE.CircleGeometry(1, 12, 0.18, Math.PI * 2 - 0.36); pad.rotateX(-Math.PI / 2);
const TAU = Math.PI * 2;
export function getSmallAsset(kind) {
  if (cache.has(kind)) return cache.get(kind);
  const parts = [], hulls = [];
  const add = (g, c, t, glow = false, hull = false) => {
    const p = part(g, c, t);
    p.setAttribute('aRole', new THREE.Float32BufferAttribute(new Float32Array(p.attributes.position.count).fill(glow ? 5 : 1), 1));
    parts.push(p); if (hull) hulls.push(p.clone());
  };
  const flower = (x, y, z, r, c, glow) => {
    if (r < 0.2) add(star, c, { p: [x, y, z], s: [r, 1, r] }, glow);
    else for (let i = 0; i < 5; i++) { const a = i * TAU / 5; add(petal, c, { p: [x + Math.cos(a) * r * 0.6, y, z + Math.sin(a) * r * 0.6], r: [0, -a, 0.4], s: [r * 0.65, r * 0.3, r * 0.4] }, glow); }
    add(petal, C.cream, { p: [x, y + r * 0.16, z], s: [r * 0.3, r * 0.3, r * 0.3] }, glow);
  };
  if (kind === 'mushroom') for (let i = 0; i < 3; i++) {
    const x = (i - 1) * 0.35, z = Math.sin(i * 2.4) * 0.23, h = 0.4 + i * 0.2;
    add(G.cyl6, C.pale, { p: [x, h / 2, z], s: [0.055, h, 0.055] });
    add(ball, C.violet, { p: [x, h, z], s: [0.28, 0.16, 0.28] }, true, true);
    add(petal, C.pale, { p: [x + 0.06, h + 0.12, z + 0.07], s: [0.045, 0.018, 0.045] }, true);
  }
  else if (kind === 'crumb') {          // Step 72b playtest fix: the PICKABLE glowcap clumps (islands/duskCrumbs.js) read apart from the violet ambient ones: fat golden caps with cream spots,
    for (let i = 0; i < 3; i++) {       // a glowing orange gill rim and a ring of glowing crumbs on the ground (the item they give)
      const x = (i - 1) * 0.36, z = Math.sin(i * 2.4) * 0.22, h = 0.34 + i * 0.16, r = 0.3 + 0.04 * i;
      add(G.cyl6, C.pale, { p: [x, h / 2, z], s: [0.075, h, 0.075] });
      add(ball, '#ffb347', { p: [x, h, z], s: [r, r * 0.62, r] }, true, true);
      add(ball, C.orange, { p: [x, h - r * 0.22, z], s: [r * 0.92, r * 0.16, r * 0.92] }, true);
      for (let k = 0; k < 4; k++) { const a = k * 1.7 + i; add(petal, C.cream, { p: [x + Math.cos(a) * r * 0.5, h + r * 0.5, z + Math.sin(a) * r * 0.5], s: [0.05, 0.02, 0.05] }, true); }
    }
    for (let k = 0; k < 7; k++) { const a = k * TAU / 7 + 0.3, d = 0.55 + (k % 3) * 0.12; add(stone, k % 2 ? '#ffd98a' : '#ffb347', { p: [Math.cos(a) * d, 0.04, Math.sin(a) * d], r: [k, k * 2, 0], s: [0.07, 0.05, 0.07] }, true); }
  }
  else if (kind === 'bulb') for (let i = 0; i < 3; i++) {
    const x = (i - 1) * 0.23, z = Math.sin(i * 2) * 0.15, h = 0.8 + i * 0.23;
    add(stem, C.teal, { p: [x, h / 2, z], s: [0.025, h, 0.025] });
    add(ball, C.cyan, { p: [x, h, z], s: [0.12, 0.15, 0.12] }, true);
  }
  else if (kind === 'grass' || kind === 'reed') for (let i = 0; i < 7; i++) {
    const a = i * 2.4, x = Math.cos(a) * 0.28, z = Math.sin(a) * 0.28, h = kind === 'reed' ? 1.1 + (i % 3) * 0.3 : 0.35 + (i % 3) * 0.13;
    add(blade, i % 2 ? C.teal : C.moss, { p: [x, h / 2, z], r: [Math.sin(a) * 0.18, a, Math.cos(a) * 0.18], s: [0.045, h, 0.045] });
    if (kind === 'reed' && i % 3 === 0) add(petal, '#9e655f', { p: [x, h, z], s: [0.07, 0.23, 0.07] });
  }
  else if (kind === 'flower') for (let i = 0; i < 3; i++) {
    const x = Math.cos(i * 2.4) * 0.23, z = Math.sin(i * 2.4) * 0.23, y = 0.21 + i * 0.06;
    add(stem, C.teal, { p: [x, y / 2, z], s: [0.012, y, 0.012] }); flower(x, y, z, 0.12, C.pale, false);
  }
  else if (kind === 'moss') for (let i = 0; i < 3; i++) add(stone, i % 2 ? C.teal : C.moss, { p: [Math.cos(i * 2) * 0.3, 0.04, Math.sin(i * 2) * 0.3], s: [0.5, 0.06, 0.4] });
  else if (kind === 'lily') {
    add(pad, C.teal, { p: [0, 0, 0], s: [0.75, 1, 0.68] });
    add(pad, C.green, { p: [-0.16, 0.006, -0.08], s: [0.35, 1, 0.32] });
    flower(0.12, 0.12, 0, 0.25, C.orange, true);
  }
  else if (kind === 'stump' || kind === 'log') {
    const log = kind === 'log', h = log ? 3 : 1.0, r = log ? 0.42 : 0.65;
    add(G.cyl8, C.bark, { p: [0, log ? r : h / 2, 0], r: [0, 0, log ? Math.PI / 2 : 0], s: [r, h, r] }, false, true);
    for (const side of log ? [-1, 1] : [1]) for (let i = 0; i < 5; i++) {
      const y = log ? r : h + 0.004 + i * 0.003, x = log ? side * (h / 2 + 0.004 + i * 0.003) : 0;
      add(disk, i % 2 ? C.ring : C.cut, { p: [x, y, 0], r: [0, 0, log ? -side * Math.PI / 2 : 0], s: [r * (0.96 - i * 0.17), 1, r * (0.96 - i * 0.17)] });
    }
    for (let i = 0; i < 4; i++) add(G.cyl6, C.pale, { p: [log ? -1 + i * 0.65 : Math.cos(i * 1.6) * r * 0.95, log ? r * 1.8 : h * 0.45, log ? 0.1 : Math.sin(i * 1.6) * r * 0.95], r: [0, 0, log ? Math.PI / 2 : 0.12], s: [0.035, log ? 0.4 : 0.65, 0.035] });
  }
  else if (kind === 'rock') {
    add(stone, C.rock, { p: [0, 0.45, 0], s: [1.0, 0.85, 0.8] }, false, true);
    for (let i = 0; i < 3; i++) add(ball, C.moss, { p: [Math.cos(i * 2) * 0.35, 1.0, Math.sin(i * 2) * 0.28], s: [0.4, 0.045, 0.3] });
  }
  else if (kind === 'shelf') {
    add(ball, C.violet, { p: [0, 0, 0.5], s: [1.2, 0.18, 0.85] }, true);
    add(ball, C.orange, { p: [0, -0.1, 0.65], s: [1.05, 0.06, 0.64] }, true);
  }
  else throw new Error(`Unknown Duskcrown flora ${kind}`);
  const geo = combine(parts);
  if (kind === 'shelf') geo.attributes.aRole.array.fill(7);
  let outlineGeo = null;
  if (hulls.length) {
    const joined = combine(hulls); outlineGeo = smoothOutlineGeo(joined); joined.dispose();
    outlineGeo.setAttribute('aRole', new THREE.Float32BufferAttribute(new Float32Array(outlineGeo.attributes.position.count), 1));
  }
  geo.computeBoundingBox(); geo.computeBoundingSphere();
  const out = { geo, outlineGeo }; cache.set(kind, out); return out;
}
