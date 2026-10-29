// Step 86e: the OTHER islands' kinds on the home island (Homesteading). Frostpine / Emberleaf / Duskcrown plants, trees, rocks and decorations are planted here, built from their own islands' asset builders
// (frostAssets.js, emberAssets.js, duskSmallAssets.js: the same merged geometries and the same programs), as ONE instanced layer per kind in use (body + a shared-matrix outline, rebuilt never: a slot is written
// when a planted copy appears, changes growth stage or goes). No new lights, no new programs (the Duskcrown kinds reuse the island's own glow program with a HOME-owned uniform).
//
//   const foreign = createHomesteadForeign({ group, props });         group = props.group (the layers live in the home props group), props = world/props.js (the shared sprout model)
//   foreign.spawn(kind, { pid, x, z, rot, stage }) -> handle | null    the same handle shape as props.spawnPlaced: { pid, kind, x, y, z, g, item, collider, set?, setBerries?, topY?, foreign: true, destroy() }
//   foreign.ghostSpec(kind) / foreign.layerFull(kind) / foreign.setNight(nightness, t?) / foreign.stats() / foreign.assetOf(key)
//
// A planted TREE / ROCK is a harvest target exactly like the big islands' trees (islands/frostWorld.js): the instance in its layer is what you see, and a Group `g` with ONE proxy mesh (hidden) stands for it
// while something animates it. `g.userData.binding` ({ set(key, 'static' | 'proxy' | 'none') }, 'none' beats 'proxy' beats 'static') swaps the instance for the proxy, so harvest.js (wobble / topple / stump / regrow
// / shatter), interactions.js (the shake) and homesteadWorld.js (the pop-in, the growth boing) animate it with the code they already have. `g.userData.variant` selects ITS island's loot (lootTable.js LOOT):
// spruce drops pinecones and pine logs, birch birch logs, banana trees bananas and mulch, granite a crystal, basalt ash and obsidian. A sprout is the shared two-leaf model tinted per species; a sapling is
// the species model at 0.45 (real meshes, there are only a few young ones at a time).
// A planted BUSH (lingonberries: the berries are a second layer), HERB (mountain mint, pineapple), MUSHROOM (chanterelles) and GLOWCAP clump are interactables in gathering.js's keyed maps; a DECORATION is a
// boinging instance (the same interactable shape as the home flowers) with an optional small collider (the snowmen and the tiki). Placed dig spots are gathering.js's own mounds (look 'frost' / 'volcanic').
// Recognisable at home: mountain mint is drawn paler and bigger (a rounder leaf mass than the home herb), granite is a speckled grey-blue lump (its snow caps are dropped: no snow on a warm island), basalt wears an
// orange crack, Duskcrown's caps glow only at night.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { HOMESTEAD, WORLD_SEED } from '../config.js';
import { mulberry32, range } from '../utils/rng.js';
import { toonMat, addOutline } from '../render/toon.js';
import { G, part, combine, VERTEX_TOON } from '../render/geo.js';
import { getHeight } from './terrain.js';
import { addCollider, removeCollider } from './colliders.js';
import { addInteractable, removeInteractable } from './interactables.js';
import { getAsset as frostAsset, TREE_INFO as FROST_INFO } from './islands/frostAssets.js';
import { getAsset as emberAsset, TREE_INFO as EMBER_INFO } from './islands/emberAssets.js';
import { getSmallAsset } from './islands/duskSmallAssets.js';
import { materials as duskMaterials, patchToon } from './islands/duskVisuals.js';
import { nightGlow } from '../game/homesteadLogic.js';

const PALE_MINT = toonMat('#e4fff0', { vertexColors: true });      // mountain mint at home: paler than the home herb (and drawn bigger)
const fixedId = (pid) => HOMESTEAD.placedIdBase + pid;
const CHOP = new Set(['tree', 'bamboo']);

// ------------------------------------------------------------------------------------------------ assets
const _assets = new Map();
const surface = (d, rx, ry, rz, lift = 0.02) => {                 // a point on an ellipsoid in direction d (lifted a hair so a sliver sits on top of the surface)
  const l = Math.hypot(d[0], d[1], d[2]) || 1, ux = d[0] / l, uy = d[1] / l, uz = d[2] / l;
  const k = 1 / Math.sqrt((ux / rx) ** 2 + (uy / ry) ** 2 + (uz / rz) ** 2);
  return [ux * (k + lift), uy * (k + lift), uz * (k + lift)];
};

/** Granite at home: Frostpine's grey-blue boulder WITHOUT its snow cap, every facet shaded a little differently (speckled) and a few pale flecks. */
function graniteAsset() {
  const base = frostAsset('boulder');
  const g = base.geo.index ? base.geo.toNonIndexed() : base.geo.clone();
  const col = g.attributes.color, rng = mulberry32(4242);
  for (let t = 0; t + 2 < col.count; t += 3) {
    const k = 0.84 + rng() * 0.3, blue = rng() < 0.2;
    for (let j = 0; j < 3; j++) {
      const i = t + j;
      let r = col.getX(i) * k, gg = col.getY(i) * k, b = col.getZ(i) * k;
      if (blue) { r *= 0.82; gg *= 0.93; b *= 1.12; }
      col.setXYZ(i, Math.min(1, r), Math.min(1, gg), Math.min(1, b));
    }
  }
  const flecks = [];
  for (let i = 0; i < 9; i++) {
    const a = rng() * Math.PI * 2, e = 0.15 + rng() * 1.1;
    const p = surface([Math.cos(a) * Math.sin(e), Math.cos(e), Math.sin(a) * Math.sin(e)], 1.0, 0.76, 0.96, -0.01);
    flecks.push(part(G.sphereLo, i % 3 ? '#e8efff' : '#c9f0ff', { p, s: [0.075, 0.05, 0.075] }));
  }
  const extra = combine(flecks);
  extra.deleteAttribute('uv');
  const geo = mergeGeometries([g, extra], false);
  g.dispose(); extra.dispose();
  return { geo, outlineGeo: base.outlineGeo, thickness: base.thickness, mat: VERTEX_TOON };
}

/** The home basalt's body colours (Step 86f): Emberleaf's own basalt is nearly black (#454051 / #665c70), which reads as a black hole next to grass by day, so the HOME copy is a lighter slate whose facets differ. Its own geometry copy: Emberleaf's is untouched. */
export const HOME_BASALT = { body: '#7b8394', top: '#a3abbb', cracks: ['#ffd23d', '#ff7a1c'] };
const _lerpC = new THREE.Color(), _a = new THREE.Color(HOME_BASALT.body), _b = new THREE.Color(HOME_BASALT.top);
/** Basalt at home: a lighter charcoal / slate body with clearly different facets and a wide, bright orange crack across its shoulder (Emberleaf's own rock keeps its dark look). */
function basaltAsset() {
  const base = emberAsset('basalt');
  const g = base.geo.index ? base.geo.toNonIndexed() : base.geo.clone();
  const col = g.attributes.color, rng = mulberry32(8181);
  const lo = 0x45 / 255, hi = 0x66 / 255;                                       // the two source greys: the body and the small top lump
  for (let t = 0; t + 2 < col.count; t += 3) {
    const k = 0.82 + rng() * 0.38;                                              // per-facet shade
    for (let j = 0; j < 3; j++) {
      const i = t + j;
      const mix = Math.min(1, Math.max(0, (col.getX(i) - lo) / (hi - lo)));
      _lerpC.copy(_a).lerp(_b, mix);
      col.setXYZ(i, Math.min(1, _lerpC.r * k), Math.min(1, _lerpC.g * k), Math.min(1, _lerpC.b * k));
    }
  }
  const slivers = [];
  const path = [[-0.7, 0.7, 0.45], [-0.5, 0.85, 0.5], [-0.25, 0.9, 0.55], [0.05, 0.8, 0.75], [0.3, 0.6, 0.85], [0.5, 0.4, 0.9], [0.62, 0.2, 0.85]];
  path.forEach((d, i) => {
    const p = surface(d, 1.0, 0.9, 0.95, 0.0);
    slivers.push(part(G.sphereLo, HOME_BASALT.cracks[i % 2], { p, r: [0, -0.5 + i * 0.3, 0.3], s: [0.24, 0.07, 0.085] }));
  });
  for (const d of [[0.1, 0.95, 0.2], [-0.2, 0.95, -0.1]]) slivers.push(part(G.sphereLo, HOME_BASALT.cracks[0], { p: surface(d, 1.0, 0.9, 0.95, 0.0), r: [0, 0.9, 0.2], s: [0.14, 0.05, 0.06] }));   // a short side crack
  const extra = combine(slivers);
  const geo = mergeGeometries([g, extra], false);
  g.dispose(); extra.dispose();
  return { geo, outlineGeo: base.outlineGeo, thickness: base.thickness, mat: VERTEX_TOON };
}

// Duskcrown at home: the island's own glow program (the 'duskMush' toon patch: emissive = vertex colour x per-role strength x uGlow) with a uniform that belongs to the HOME island and is driven by the
// day / night clock, so the caps only glow at night. Same program (same customProgramCacheKey), so no extra shader compile.
const homeGlow = { value: 0 };
let _duskHome = null;
function homeDuskMat() {
  if (!_duskHome) {
    const base = duskMaterials().solidMat;
    _duskHome = base.clone();
    _duskHome.onBeforeCompile = (shader) => { patchToon(shader); shader.uniforms.uGlow = homeGlow; };
    _duskHome.customProgramCacheKey = base.customProgramCacheKey;
  }
  return _duskHome;
}
const withInst = (geo, inst) => {
  const g = new THREE.BufferGeometry();
  for (const [k, a] of Object.entries(geo.attributes)) g.setAttribute(k, a);
  if (geo.index) g.setIndex(geo.index);
  g.setAttribute('iInst', inst);
  return g;
};

/** { geo, outlineGeo, thickness, mat, dusk?, info? } for an asset key such as 'frost:spruce' (cached; the geometries are shared with the islands and never disposed). */
export function assetOf(key) {
  let a = _assets.get(key);
  if (a) return a;
  const [isl, name] = key.split(':');
  if (isl === 'frost') {
    if (name === 'granite') a = graniteAsset();
    else { const b = frostAsset(name); a = { geo: b.geo, outlineGeo: b.outlineGeo, thickness: b.thickness, mat: name === 'mint' ? PALE_MINT : VERTEX_TOON }; }
    a.info = FROST_INFO[name] || null;
  } else if (isl === 'ember') {
    if (name === 'basalt') a = basaltAsset();
    else { const b = emberAsset(name); a = { geo: b.geo, outlineGeo: b.outlineGeo, thickness: b.thickness, mat: VERTEX_TOON }; }
    a.info = EMBER_INFO[name] || null;
  } else if (isl === 'dusk') {
    const b = getSmallAsset(name);
    a = { geo: b.geo, outlineGeo: b.outlineGeo || null, thickness: 0, mat: null, dusk: true, info: null };
  } else throw new Error('unknown foreign asset ' + key);
  _assets.set(key, a);
  return a;
}

const _patch = {};
/** A flat coloured disc: the ghost of a dig spot. */
function patchGeo(look) {
  if (_patch[look]) return _patch[look];
  const d = new THREE.CircleGeometry(0.62, 16); d.rotateX(-Math.PI / 2); d.translate(0, 0.04, 0);
  const n = d.attributes.position.count, c = new THREE.Color(look === 'volcanic' ? '#3c3446' : look === 'frost' ? '#e6f0ff' : '#8a5a3a');
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  d.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return (_patch[look] = d);
}

// ------------------------------------------------------------------------------------------------ the layers
export function createHomesteadForeign({ group, props }) {
  const layers = new Map();                                 // asset key -> { key, asset, mesh, outline, free: [], count, used, cap }
  const handles = new Map();                                // pid -> handle
  const dummy = new THREE.Object3D();

  const capOf = (meta) => (meta.cls === 'tree' || meta.cls === 'bamboo' || meta.cls === 'rock' ? HOMESTEAD.foreignCap : HOMESTEAD.layerCap);
  function layerOf(key, cap, cast) {
    let l = layers.get(key);
    if (l) return l;
    const asset = assetOf(key);
    let inst = null;
    if (asset.dusk) { inst = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3); for (let i = 0; i < cap; i++) inst.setXYZ(i, 0, 0.5, 0); }
    const geo = asset.dusk ? withInst(asset.geo, inst) : asset.geo;
    const mesh = new THREE.InstancedMesh(geo, asset.dusk ? homeDuskMat() : asset.mat, cap);
    mesh.name = 'foreign-' + key;
    mesh.count = 0; mesh.castShadow = !!cast; mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.visible = false;
    group.add(mesh);
    let outline = null;
    if (asset.outlineGeo) {
      const ogeo = asset.dusk ? withInst(asset.outlineGeo, inst) : asset.outlineGeo;
      const omat = asset.dusk ? duskMaterials().outlineMat : addOutline(new THREE.Mesh(asset.outlineGeo), asset.thickness).material;
      outline = new THREE.InstancedMesh(ogeo, omat, cap);
      outline.name = mesh.name + '-outline';
      outline.instanceMatrix = mesh.instanceMatrix;          // one buffer: a slot write moves both
      outline.count = 0; outline.castShadow = false; outline.receiveShadow = false; outline.renderOrder = -1; outline.frustumCulled = false; outline.visible = false;
      group.add(outline);
    }
    l = { key, asset, mesh, outline, free: [], count: 0, used: 0, cap };
    layers.set(key, l);
    return l;
  }
  const take = (l) => {
    const slot = l.free.length ? l.free.pop() : l.count++;
    l.used++;
    l.mesh.count = l.count; if (l.outline) l.outline.count = l.count;
    l.mesh.visible = true; if (l.outline) l.outline.visible = true;
    return slot;
  };
  function put(l, slot, x, y, z, ry, sx, sy = sx, sz = sx, rx = 0, rz = 0) {
    dummy.position.set(x, y, z); dummy.rotation.set(rx, ry, rz); dummy.scale.set(Math.max(0.0001, sx), Math.max(0.0001, sy), Math.max(0.0001, sz)); dummy.updateMatrix();
    l.mesh.setMatrixAt(slot, dummy.matrix);
    l.mesh.instanceMatrix.needsUpdate = true;
  }
  const hide = (l, slot) => put(l, slot, 0, -50, 0, 0, 0.0001);
  function release(l, slot) {
    hide(l, slot);
    l.free.push(slot);
    l.used--;
    if (l.used <= 0) { l.mesh.visible = false; if (l.outline) l.outline.visible = false; }
  }

  /** A real mesh (+ outline child) of an asset: what a tree / rock turns into while it animates, and a sapling. */
  function proxyMesh(asset) {
    const mesh = new THREE.Mesh(asset.geo, asset.mat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    if (asset.outlineGeo) {
      const tmp = new THREE.Mesh(asset.outlineGeo);
      const o = addOutline(tmp, asset.thickness);
      tmp.remove(o);
      mesh.add(o);
    }
    return mesh;
  }

  // The instance <-> proxy swap (islands/frostWorld.js makeBinding): several systems vote with their own key; 'none' beats 'proxy' beats 'static'.
  function makeBinding(g, l, slot, base) {
    const keys = {};
    let mode = 'static', dead = false;
    const resolve = () => { let m = 'static'; for (const k in keys) { if (keys[k] === 'none') return 'none'; if (keys[k] === 'proxy') m = 'proxy'; } return m; };
    const apply = () => {
      if (dead) return;                                      // (the object was deleted: its slot may belong to a new one already)
      g.visible = mode === 'proxy';
      if (mode === 'static') put(l, slot, base.x, base.y, base.z, base.ry, base.sx, base.sy, base.sz); else hide(l, slot);
    };
    return {
      get mode() { return mode; },
      set(key, m) {
        if (keys[key] !== m) {
          keys[key] = m;
          const next = resolve();
          if (next !== mode) { mode = next; apply(); return; }
        }
        if (g.visible !== (mode === 'proxy')) g.visible = mode === 'proxy';
      },
      reapply: apply,
      kill() { dead = true; },
    };
  }

  // ------------------------------------------------------------------------------------------ spawning
  function spawn(kind, rec) {
    const meta = HOMESTEAD.kinds[kind];
    if (!meta || meta.island === 'home' || (!meta.asset && meta.cls !== 'digspot')) return null;
    const { pid, x, z, rot = 0, stage = 'grown' } = rec;
    if (handles.has(pid)) return null;
    const rng = mulberry32(WORLD_SEED + 700 + pid);
    const h = { pid, kind, x, z, y: getHeight(x, z), g: null, item: null, collider: null, set: null, setBerries: null, topY: 0, wob: null, foreign: true, cleanup: [], destroy };
    const cls = meta.cls;
    let ok = true;
    if (CHOP.has(cls)) spawnTree(h, meta, rng, rot, stage);
    else if (cls === 'rock') spawnRock(h, meta, rng, rot);
    else if (cls === 'bush') spawnBush(h, meta, rng, rot);
    else if (cls === 'herb' || cls === 'mushroom' || cls === 'glowcap') spawnSmall(h, meta, rng, rot);
    else if (cls === 'flower') spawnDeco(h, meta, rng, rot);
    else ok = false;
    if (!ok) return null;
    handles.set(pid, h);
    return h;
  }

  function register(h, g, y, radius, type, prompt, col, young, f) {
    group.add(g);
    if (col) h.collider = addCollider({ x: h.x, z: h.z, r: col, owner: g });
    h.item = addInteractable({ id: fixedId(h.pid), type: young ? 'sprout' : type, object: g, position: new THREE.Vector3(h.x, y, h.z), radius: young ? Math.max(0.3, radius * f + 0.15) : radius, prompt: young ? 'Water' : prompt });
    g.userData.interactable = h.item;
    g.userData.pid = h.pid;
    h.g = g; h.y = y;
    h.cleanup.push(() => { group.remove(g); });
  }

  function spawnTree(h, meta, rng, rot, stage) {
    const young = meta.grows && stage !== 'grown';
    const s = range(rng, meta.scale[0], meta.scale[1]);
    const sy = s * range(rng, 0.95, 1.1);
    const asset = assetOf(meta.asset);
    const g = new THREE.Group();
    g.rotation.y = rot;
    if (young && stage === 'sprout') {                       // the shared two-leaf sprout, tinted for the species (the sapling below is the species model at about 0.45)
      const mesh = props.makeSprout(meta.sprout);
      g.name = 'sprout';
      g.add(mesh);
      g.scale.setScalar(range(rng, 1.15, 1.4));
      const y = getHeight(h.x, h.z) - 0.02;
      g.position.set(h.x, y, h.z);
      register(h, g, y, 0.3, 'tree', 'Water', 0, true, 1);
      g.userData.canopy = mesh; g.userData.young = true; g.userData.kind = h.kind;
      return;
    }
    const y = getHeight(h.x, h.z) - 0.05;
    if (young) {                                             // sapling
      const f = 0.45;
      g.name = 'sapling';
      g.add(proxyMesh(asset));
      g.scale.set(s * f, sy * f, s * f);
      g.position.set(h.x, y, h.z);
      register(h, g, y, 0.5 * s, 'tree', 'Water', 0, true, f);
      g.userData.canopy = g.children[0]; g.userData.young = true; g.userData.kind = h.kind;
      return;
    }
    const l = layerOf(meta.asset, capOf(meta), true);
    const slot = take(l);
    const base = { x: h.x, y, z: h.z, ry: rot, sx: s, sy, sz: s };
    put(l, slot, base.x, base.y, base.z, base.ry, base.sx, base.sy, base.sz);
    const mesh = proxyMesh(asset);
    g.name = meta.variant + '-tree';
    g.add(mesh);
    g.position.set(h.x, y, h.z);
    g.scale.set(s, sy, s);
    g.visible = false;                                       // the instance shows until something animates
    register(h, g, y, 0.5 * s, 'tree', 'Shake', meta.trunk * s, false, 1);
    const info = asset.info || { crownY: 3.2, crownR: 1.4, promptY: 5 };
    g.userData.variant = meta.variant;
    g.userData.canopy = mesh;
    g.userData.topLocal = new THREE.Vector3(0, info.crownY, 0);
    g.userData.crownR = info.crownR;
    g.userData.promptY = info.promptY;
    g.userData.snowy = false;
    g.userData.kind = h.kind;
    g.userData.young = false;
    g.userData.binding = makeBinding(g, l, slot, base);
    h.cleanup.push(() => { g.userData.binding.kill(); release(l, slot); });
  }

  function spawnRock(h, meta, rng, rot) {
    const asset = assetOf(meta.asset);
    const s = range(rng, meta.scale[0], meta.scale[1]);
    const sx = s * range(rng, 0.92, 1.15), sy = s * range(rng, 0.85, 1.15), sz = s * range(rng, 0.92, 1.15);
    const rr = 0.75 * s;
    const ground = Math.min(getHeight(h.x, h.z), getHeight(h.x + rr, h.z), getHeight(h.x - rr, h.z), getHeight(h.x, h.z + rr), getHeight(h.x, h.z - rr));
    const l = layerOf(meta.asset, capOf(meta), true);
    const slot = take(l);
    const base = { x: h.x, y: ground + 0.62 * sy, z: h.z, ry: rot, sx, sy, sz };
    put(l, slot, base.x, base.y, base.z, base.ry, base.sx, base.sy, base.sz);
    const g = new THREE.Group();
    g.name = meta.variant;
    g.add(proxyMesh(asset));
    g.position.set(base.x, base.y, base.z);
    g.rotation.y = rot;
    g.scale.set(sx, sy, sz);
    g.visible = false;
    register(h, g, ground, 0.82 * s, 'rock', 'Inspect', 0.82 * s, false, 1);
    h.item.position.set(h.x, ground, h.z);
    if (meta.tag) h.item.tag = meta.tag;
    g.userData.variant = meta.variant;
    g.userData.kind = h.kind;
    g.userData.binding = makeBinding(g, l, slot, base);
    h.cleanup.push(() => { g.userData.binding.kill(); release(l, slot); });
  }

  function spawnBush(h, meta, rng, rot) {
    const s = range(rng, meta.scale[0], meta.scale[1]);
    const sy = s * range(rng, 0.92, 1.1);
    const y = getHeight(h.x, h.z) - 0.04;
    const lb = layerOf(meta.asset, capOf(meta), true), slotB = take(lb);
    put(lb, slotB, h.x, y, h.z, rot, s, sy, s);
    const lr = layerOf(meta.berries, capOf(meta), false), slotR = take(lr);
    h.setBerries = (on, k = 1) => { if (on) put(lr, slotR, h.x, y, h.z, rot, s * k, sy * k, s * k); else hide(lr, slotR); };
    h.setBerries(true, 1);
    h.y = y; h.topY = y + 0.95 * s;
    h.item = addInteractable({ id: fixedId(h.pid), type: 'bush', object: null, position: new THREE.Vector3(h.x, y, h.z), radius: 0.75 * s, prompt: 'Rustle' });
    h.cleanup.push(() => { release(lb, slotB); release(lr, slotR); });
  }

  function spawnSmall(h, meta, rng, rot) {
    const s = range(rng, meta.scale[0], meta.scale[1]);
    const y = getHeight(h.x, h.z) - 0.03;
    const l = layerOf(meta.asset, capOf(meta), false), slot = take(l);
    h.set = (k) => { if (k > 0) put(l, slot, h.x, y, h.z, rot, s * k); else hide(l, slot); };
    h.set(1);
    h.y = y;
    const herb = meta.cls === 'herb';
    h.item = addInteractable({ id: fixedId(h.pid), type: herb ? 'herb' : 'mushroom', object: null, position: new THREE.Vector3(h.x, y, h.z), radius: herb ? 0.4 : meta.cls === 'glowcap' ? 0.6 : 0.5, prompt: meta.prompt || 'Pick' });
    h.cleanup.push(() => release(l, slot));
  }

  function spawnDeco(h, meta, rng, rot) {
    const s = range(rng, meta.scale[0], meta.scale[1]);
    const y = getHeight(h.x, h.z) - 0.02;
    const l = layerOf(meta.asset, capOf(meta), false), slot = take(l);
    put(l, slot, h.x, y, h.z, rot, s);
    h.y = y;
    h.item = addInteractable({
      id: fixedId(h.pid), type: 'flower', object: null,
      instance: { mesh: l.mesh, index: slot, position: new THREE.Vector3(h.x, y, h.z), scale: s, rotY: rot, tiltX: 0, tiltZ: 0 },
      position: new THREE.Vector3(h.x, y, h.z), radius: Math.max(0.2, meta.collider ? meta.collider + 0.1 : 0.25), prompt: meta.prompt || 'Boing',
    });
    if (meta.collider) h.collider = addCollider({ x: h.x, z: h.z, r: meta.collider * (s / (meta.scale[0] + meta.scale[1]) * 2), owner: h });
    h.cleanup.push(() => release(l, slot));
  }

  function destroy() {                                       // called as h.destroy()
    const h = this;
    if (h.item) removeInteractable(h.item);
    if (h.collider) removeCollider(h.collider);
    for (const fn of h.cleanup) fn();
    h.cleanup = [];
    handles.delete(h.pid);
  }

  // ------------------------------------------------------------------------------------------ the ghost, the cap, the night
  function ghostSpec(kind) {
    const meta = HOMESTEAD.kinds[kind];
    if (!meta || meta.island === 'home') return null;
    const mid = (meta.scale ? (meta.scale[0] + meta.scale[1]) / 2 : 1);
    if (CHOP.has(meta.cls)) { const s = props.ghostSpec('appleTree'); return s ? { geo: s.geo, scale: s.scale, dy: 0, ring: meta.ring } : null; }   // the sprout that gets planted + the species' canopy ring
    if (meta.cls === 'digspot') return { geo: patchGeo(meta.look), scale: 1, dy: 0 };
    const a = assetOf(meta.asset);
    if (meta.cls === 'rock') return { geo: a.geo, scale: mid, dy: 0.62 * mid };
    if (meta.cls === 'bush') return { geo: a.geo, scale: mid, dy: -0.04 };
    return { geo: a.geo, scale: mid, dy: 0 };
  }
  function layerFull(kind) {
    const meta = HOMESTEAD.kinds[kind];
    const l = meta && meta.asset ? layers.get(meta.asset) : null;
    return !!l && l.free.length === 0 && l.count >= l.cap;
  }
  /** The home glow of Duskcrown kinds: ONE uniform for every layer (0 by day, soft at night; a slow breath). */
  function setNight(nightness, t = 0) {
    homeGlow.value = nightGlow(nightness) * (0.93 + 0.07 * Math.sin(t * 1.6));
  }
  function stats() {
    const out = [];
    let drawCalls = 0;
    for (const l of layers.values()) {
      const visible = l.mesh.visible;
      const calls = visible ? 1 + (l.outline ? 1 : 0) + (l.mesh.castShadow ? 1 : 0) : 0;
      drawCalls += calls;
      out.push({ asset: l.key, used: l.used, slots: l.count, cap: l.cap, drawCalls: calls });
    }
    return { layers: out, drawCalls, kindsInUse: out.filter((e) => e.used > 0).length, glow: homeGlow.value };
  }

  return { spawn, ghostSpec, layerFull, setNight, stats, assetOf, layers, handles, get glowUniform() { return homeGlow; } };
}
