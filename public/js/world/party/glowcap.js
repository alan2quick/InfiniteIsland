// Glowcap Shuffle's stage (Step 81a): the dark Duskcrown lagoon at night. Eight big glowing mushroom caps float on it, packed edge to edge in three hex rows; each has its own colour AND symbol on top (star, heart, moon,
// drop, leaf, flower, shell, spiral). Tzukumi sits on a mossy stump at the left, her two heart antlers glowing the called cap's colour; behind the caps a big glowing plate shows the called colour + symbol and three pips
// count 3, 2, 1. When the count ends every other cap sinks under the water and rises again; a few stay down for good from round 4. A mossy shore at the front is where the players who fell in watch from. Built once (lazily),
// hidden outside the game; ONE Group at the stage centre.
//
// WHAT YOU SEE IS WHAT IS JUDGED: each cap is drawn as a disc of radius `capR` at `glowcapLayout()`'s centre (the same circle the host compares a body's centre with at the sink time); the cap's rim ring is exactly that
// circle. The dome mesh is ONE InstancedMesh (an instance per cap, coloured by `CAPS`), the symbols are eight small unlit meshes that ride on their cap, the halos one additive instanced mesh.
//
//   const w = createGlowcapWorld({ scene, sfx, particles, labels })
//   w.setVisible(on)         w.update(dt, { mode: 'practice' | 'wait' | 'play', v, t, who, lanePlayers })     v = glowcapLogic.view(g, t) in play; 'practice' loops a slow demo of three rounds that nothing scores
//   w.onRec(rec, v, who)     presentation of a record: the sink (a splash on every body that was not on the called cap, a sparkle on the dry ones)
//   w.scoreText(v, slot) -> { text, out }      w.cam      w.look ('lagoon')      w.clearPractice()      w.capDraw(i) -> { x, y, z, depth } where cap i is drawn now      w.counts() -> what is drawn now
// Draw calls: base 1 (+outline), water 2, halos 1, domes 1, symbols 8, call plate 2 + pips 1, Tzukumi ~10 + 2 antler glows; about 30.
import * as THREE from 'three';
import { PARTY, TDOONGZ } from '../../config.js';
import { stageCentre } from '../../game/party/partyArea.js';
import { buildPlan, view as glowView, init as glowInit, onCap, capCentre, CAPS, SYMBOLS, CAP_LOCAL, ID } from '../../game/party/glowcapLogic.js';
import { createTdoongModel } from '../../npc/tdoongz.js';
import { part, G, VERTEX_TOON, combine } from '../../render/geo.js';
import { solid, glow, disc, ring, box, ball } from './kit.js';
import { stageLivingLifecycle, hostIdle } from './livingStage.js';

const GC = PARTY.glowcap, O = PARTY.origin;
const centre = stageCentre(ID);
export const CAM = { focus: { x: centre.x, y: O.y + 0.2, z: centre.z + 2.6 }, offset: { x: 0, y: 15.5, z: 14.5 }, extent: { w: 22, d: 22 } };
const DROP = 1.5;                                                                    // how far a sunk cap goes down (u)
const TZUKUMI = { x: -10.2, z: -2.4 };
const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const wp = (x, y, z) => ({ x: centre.x + x, y: O.y + y, z: centre.z + z });
const CYL = new THREE.CylinderGeometry(1, 1, 1, 40, 1);
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

/** A flat, up-facing shape geometry of a unit symbol (scaled by `size`). */
function symbolGeo(id, size = 1) {
  const shape = new THREE.Shape(SYMBOLS[id].map(([x, y]) => new THREE.Vector2(x * size, y * size)));
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);                                                           // x stays, shape-y becomes -z (the symbol's top points away from the camera, which is what you read)
  return g;
}
/** A cap's geometry: a flat top at y 0 with a bright rim exactly at the radius the host judges, a dark lip and a tapering skirt under the water (vertex colours are multiplied by the instance colour). */
function capGeometry(R) {
  const parts = [
    part(CYL, '#e6e6f0', { p: [0, -0.25, 0], s: [R, 0.5, R] }),
    part(new THREE.RingGeometry(R - 0.2, R, 40).rotateX(-Math.PI / 2), '#ffffff', { p: [0, 0.015, 0] }),                  // the rim ring: the cap's judged edge
    part(new THREE.RingGeometry(R, R + 0.1, 40).rotateX(-Math.PI / 2), '#3a3350', { p: [0, 0.01, 0] }),
    part(new THREE.CylinderGeometry(1, 0.55, 1, 28), '#9a9ab0', { p: [0, -1.0, 0], s: [R * 0.98, 1.0, R * 0.98] }),
  ];
  return combine(parts);
}

export function createGlowcapWorld({ scene, sfx, particles, labels }) {
  const root = new THREE.Group();
  root.name = 'party-glowcap';
  root.position.set(centre.x, O.y, centre.z);
  root.visible = false;
  scene.add(root);
  const geos = [], mats = [];
  const R = GC.capR, sh = GC.shore;
  const living = stageLivingLifecycle({ root, id: 'glowcap', cam: CAM });

// ---- the mossy shore (the lagoon bed, the giant mushrooms, the reeds and the islets are the living pass: livingStage.js / living82d.js)
  const base = [
    box(sh.x * 2 + 0.8, 0.9, sh.z1 - sh.z0 + 0.6, '#3a5e66', [0, -0.9, (sh.z0 + sh.z1) / 2]), box(sh.x * 2 + 0.2, 0.06, sh.z1 - sh.z0 + 0.1, '#5f9a86', [0, -0.06, (sh.z0 + sh.z1) / 2]),     // the shore: its top is the floor (y 0)
  ];
  for (let k = 0; k < 4; k++) base.push(disc(1.3, '#8fe6c8', [-4.5 + k * 3, 0.02, GC.spectatorZ], 0.05), ring(0.8, 1.2, '#cfe9ff', [-4.5 + k * 3, 0.03, GC.spectatorZ], 0.03));     // where the ones who fell in stand
  const glowBits = [];
  const baseMesh = solid(base, { outline: 0.03 });
  baseMesh.name = 'glowcap-base';
  root.add(baseMesh); geos.push(baseMesh.geometry);

  // ---- the water: a translucent layer above the sunk caps, soft halos under every cap
  const waterG = new THREE.CircleGeometry(250, 48); waterG.rotateX(-Math.PI / 2);
  const waterM = new THREE.MeshBasicMaterial({ color: '#16328a', transparent: true, opacity: 0.62, depthWrite: false });
  const water = new THREE.Mesh(waterG, waterM);
  water.position.y = GC.waterY; water.renderOrder = 2; water.name = 'glowcap-water';
  root.add(water); geos.push(waterG); mats.push(waterM);
  const haloG = new THREE.CircleGeometry(1, 36); haloG.rotateX(-Math.PI / 2);
  const haloM = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending });
  const halos = new THREE.InstancedMesh(haloG, haloM, CAP_LOCAL.length);
  halos.frustumCulled = false; halos.renderOrder = 3; halos.name = 'glowcap-halos';
  root.add(halos); geos.push(haloG); mats.push(haloM);

  // ---- the caps: ONE instanced mesh; the symbols ride on them
  const capG = capGeometry(R);
  const caps = new THREE.InstancedMesh(capG, VERTEX_TOON, CAP_LOCAL.length);
  caps.frustumCulled = false; caps.name = 'glowcap-caps'; caps.castShadow = false; caps.receiveShadow = false;
  root.add(caps); geos.push(capG);
  const _c = new THREE.Color(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1), _p = new THREE.Vector3();
  CAP_LOCAL.forEach((c) => caps.setColorAt(c.i, _c.set(CAPS[c.i].color)));
  caps.instanceColor.needsUpdate = true;
  const symMat = new THREE.MeshBasicMaterial({ color: '#2a1f55', side: THREE.DoubleSide }); mats.push(symMat);
  const symGeos = {};
  for (const id of Object.keys(SYMBOLS)) { symGeos[id] = symbolGeo(id, 1); geos.push(symGeos[id]); }
  const syms = CAP_LOCAL.map((c) => {
    const m = new THREE.Mesh(symGeos[CAPS[c.i].symbol], symMat);
    m.scale.setScalar(R * 0.58); m.position.set(c.x, 0.06, c.z); m.rotation.y = 0;
    root.add(m); return m;
  });
  const drawn = CAP_LOCAL.map((c) => ({ x: c.x, y: 0, z: c.z, depth: 0 }));
  function placeCaps(depth, t) {
    CAP_LOCAL.forEach((c, i) => {
      const d = depth ? depth[i] : 0, bob = Math.sin(t * 1.3 + i * 1.7) * 0.02 * (1 - d);
      _p.set(c.x, -d * DROP + bob, c.z); _m.compose(_p, _q, _s); caps.setMatrixAt(i, _m);
      syms[i].position.y = 0.06 - d * DROP + bob; syms[i].visible = d < 0.98;
      drawn[i].y = _p.y; drawn[i].depth = d;
      _p.set(c.x, GC.waterY + 0.03, c.z); const hs = R * (1.25 + 0.1 * Math.sin(t * 2 + i)) * (1 - d * 0.3); _s.set(hs, 1, hs); _m.compose(_p, _q, _s); halos.setMatrixAt(i, _m);
      _s.set(1, 1, 1);
      _c.set(CAPS[i].color).multiplyScalar(0.25 + 0.75 * (1 - d)); halos.setColorAt(i, _c);
    });
    caps.instanceMatrix.needsUpdate = true; halos.instanceMatrix.needsUpdate = true; halos.instanceColor.needsUpdate = true;
  }

  // ---- Tzukumi on a mossy stump, her heart antlers glowing the called colour; the plate + count pips behind the caps
  const tz = createTdoongModel('tzukumi');
  tz.root.scale.setScalar(TDOONGZ.tzukumi.scale);
  tz.root.position.set(TZUKUMI.x, 0.95, TZUKUMI.z); tz.root.rotation.y = Math.PI / 2;
  root.add(tz.root);
  const stumpParts = [disc(1.25, '#4a3a5e', [TZUKUMI.x, 0.95, TZUKUMI.z], 0.95), disc(1.05, '#6fcfa0', [TZUKUMI.x, 0.97, TZUKUMI.z], 0.03)];
  for (let k = 0; k < 7; k++) {                                                                      // moss round the stump's rim and four little glowing mushrooms on it (cosmetic)
    const a = k * 0.9 + 0.3, mx = TZUKUMI.x + Math.cos(a) * 1.05, mz = TZUKUMI.z + Math.sin(a) * 1.05;
    stumpParts.push(part(G.sphereLo, k % 2 ? '#4f9a6a' : '#6fb87a', { p: [mx, 0.98, mz], s: [0.34 + hash(k) * 0.14, 0.12, 0.3] }));
    if (k < 4) {
      const sx = TZUKUMI.x + Math.cos(a + 0.5) * 0.78, sz = TZUKUMI.z + Math.sin(a + 0.5) * 0.78, h = 0.22 + hash(k + 4) * 0.14;
      stumpParts.push(part(G.cyl6, '#e8e0f4', { p: [sx, 0.97 + h / 2, sz], s: [0.035, h, 0.035] }));
      glowBits.push(part(G.sphereLo, k % 2 ? '#ffb86a' : '#8ff4ff', { p: [sx, 0.97 + h, sz], s: [0.11, 0.07, 0.11] }));
    }
  }
  const stump = solid(stumpParts, { outline: 0.03 });
  const bits = glow(glowBits); bits.name = 'glowcap-bulbs'; root.add(bits); geos.push(bits.geometry);
  root.add(stump); geos.push(stump.geometry);
  const heartGeo = symbolGeo('heart', 0.1); heartGeo.rotateX(Math.PI / 2); geos.push(heartGeo);       // (upright again: its flat face looks along +z)
  const heartM = new THREE.MeshBasicMaterial({ color: '#555577', side: THREE.DoubleSide, transparent: true, opacity: 0.95 }); mats.push(heartM);
  const hearts = [-1, 1].map((sd) => { const h = new THREE.Mesh(heartGeo, heartM); h.position.set(0.19 * sd, 0.46, 0.04); h.renderOrder = 6; (tz.headGroup || tz.root).add(h); return h; });
  const plateG = new THREE.CircleGeometry(2.05, 40); geos.push(plateG);
  const plateM = new THREE.MeshBasicMaterial({ color: '#222244' }); mats.push(plateM);
  const rimG = new THREE.RingGeometry(2.05, 2.3, 40); geos.push(rimG);
  const rimM = new THREE.MeshBasicMaterial({ color: '#ffffff' }); mats.push(rimM);
  const plate = new THREE.Group();
  plate.position.set(0, 1.2, -8.6); plate.rotation.x = -0.35; plate.scale.setScalar(0.72);
  const plateDisc = new THREE.Mesh(plateG, plateM), plateRim = new THREE.Mesh(rimG, rimM);
  const plateSym = new THREE.Mesh(symGeos.star, symMat);
  plateSym.rotation.x = Math.PI / 2; plateSym.scale.setScalar(1.35); plateSym.position.z = 0.02;           // (the flat symbol stands up on the plate)
  plate.add(plateDisc, plateRim, plateSym);
  root.add(plate);
  const pipG = new THREE.SphereGeometry(0.28, 12, 8); geos.push(pipG);
  const pipM = new THREE.MeshBasicMaterial({ color: '#ffffff' }); mats.push(pipM);
  const pips = new THREE.InstancedMesh(pipG, pipM, 3); pips.frustumCulled = false; pips.position.set(0, 1.55, -8.6 + 0.4);
  root.add(pips);
  const setPips = (n) => { for (let k = 0; k < 3; k++) { _p.set((k - 1) * 0.9, 0, 0); _m.compose(_p, _q, _s); pips.setMatrixAt(k, _m); pips.setColorAt(k, _c.set(k < n ? '#fff3a0' : '#3a3a66')); } pips.instanceMatrix.needsUpdate = true; pips.instanceColor.needsUpdate = true; };
  plate.visible = false; pips.visible = false;

  // ---- state
  let t0 = 0, lastMode = '', lastKey = '', lastCount = 0, lastSink = false, lastDeep = 0, practice = null, practiceJudged = -1, glowK = 0;
  const color = new THREE.Color();

  function showCall(call) {
    plate.visible = pips.visible = !!call;
    glowK = damp(glowK, call ? 1 : 0, 10, 0.05);
    if (call) {
      color.set(call.color);
      plateM.color.copy(color).multiplyScalar(0.92); heartM.color.copy(color); heartM.opacity = 1;
      plateSym.geometry = symGeos[call.symbol];
      for (const h of hearts) h.scale.setScalar(1.25);
    } else { heartM.color.set('#555577'); for (const h of hearts) h.scale.setScalar(1); }
  }

  /** Sounds + effects on the beat of the round (from the view `v`). `judgePlayers` = bodies to judge in practice. */
  function beats(v, mode, lanePlayers) {
    const key = `${mode}:${v.cur.r}`;
    if (key !== lastKey) { lastKey = key; lastCount = 0; lastSink = false; practiceJudged = -1; }
    if (v.call && v.count > lastCount) { lastCount = v.count; sfx?.play('glowbell', { pitch: v.count === 1 ? 0.9 : v.count === 2 ? 1.12 : 1.5, vol: 0.7 }); labels?.label(String(4 - v.count), wp(0, 5.2, -8.6), '#fff3a0'); }
    if (v.sinking && !lastSink) {
      lastSink = true; sfx?.play('capsink', { vol: 0.8 });
      CAP_LOCAL.forEach((c) => { if (c.i !== v.cur.call && v.depth[c.i] < 0.9) particles?.burst('puff', wp(c.x, 0.2, c.z), { count: 4, radius: 0.9, height: 0.4, size: 1, color: '#9fc4ff' }); });
      if (mode === 'practice') judgePractice(v, lanePlayers);
    }
    if (!v.sinking && lastSink && v.depth.every((d) => d < 0.05)) { lastSink = false; sfx?.play('caprise', { vol: 0.5 }); }
  }
  function judgePractice(v, lanePlayers) {                                          // practice: the same circle, nothing scores
    if (practiceJudged === v.cur.r) return;
    practiceJudged = v.cur.r;
    for (const p of lanePlayers) {
      if (!p || !p.position) continue;
      const c = capCentre(v.cur.call), dry = Math.hypot(p.position.x - c.x, p.position.z - c.z) <= R;
      const at = { x: p.position.x, y: p.position.y + 1.2, z: p.position.z };
      if (dry) { particles?.burst('sparkle', at, { count: 6, radius: 0.5, color: '#ffe27a' }); labels?.label('Nice!', at, '#baffc8'); sfx?.play('chime', { pitch: 1.3, vol: 0.4 }); }
      else { particles?.burst('puff', { x: p.position.x, y: p.position.y + 0.3, z: p.position.z }, { count: 8, radius: 0.7, height: 0.5, size: 1.1, color: '#bfe6ff' }); labels?.label('Splash!', at, '#ffd0d0'); sfx?.play('splash', { vol: 0.5 }); }
    }
  }

  function update(dt, { mode = 'wait', v = null, t = 0, lanePlayers = [] } = {}) {
    if (!root.visible) return;
    t0 += dt;
    if (mode !== lastMode) { lastMode = mode; lastKey = ''; practice = null; }
    let livingDepth = null;
    let view = null;
    if (mode === 'play' && v) view = v;
    else if (mode === 'practice') {
      practice ||= { g: glowInit(777, []), len: buildPlan(777).rounds[2].riseAt + 2.0 };
      const tm = t0 % practice.len;
      if (tm < dt * 1.5) { lastKey = ''; }
      view = glowView(practice.g, tm);
    }
    if (view) { placeCaps(view.depth, t0); showCall(view.call); setPips(view.call ? view.count : 0); beats(view, mode, lanePlayers); livingDepth = view.depth; }
    else { placeCaps(null, t0); showCall(null); }
    // Tzukumi: sleepy sway; she nods when a call is lit
    const lit = view && view.call;
    tz.rig.position.y = Math.sin(t0 * 1.1) * 0.025 + (lit ? 0.04 : 0);
    tz.headGroup.rotation.x = damp(tz.headGroup.rotation.x, lit ? -0.18 : 0.12 + Math.sin(t0 * 0.7) * 0.04, 4, dt);
    tz.setExpression?.(lit ? 'happy' : 'sleepy');
    for (const h of hearts) h.rotation.z = Math.sin(t0 * 6) * 0.05 * (lit ? 1 : 0);
    plate.rotation.z = Math.sin(t0 * 2.2) * 0.02; plate.position.y = 1.2 + Math.sin(t0 * 1.6) * 0.08;
    living.update(dt, t0, lanePlayers, { depth: livingDepth });
    hostIdle(tz, t0, view && mode === 'play' ? { alive: view.alive, done: view.done } : null, lanePlayers);          // (head only: she watches whoever is still dry)
  }

  return {
    root, update, cam: CAM, look: 'lagoon',
    get living() { return living.current; },
    setVisible(on) {
      living.setVisible(on);
      root.visible = !!on;
      if (!on) { labels?.clear?.(); lastMode = ''; lastKey = ''; practice = null; plate.visible = pips.visible = false; }
    },
    onRec(rec, v, who) {
      if (!root.visible || rec.k !== 'sink') return;
      const dry = v ? v.slots.filter((s) => v.alive[s]) : [];
      for (const slot of rec.out) {
        const p = who ? who(slot) : null;
        if (!p) continue;
        const at = { x: p.position.x, y: p.position.y + 1.2, z: p.position.z };
        particles?.burst('puff', { x: p.position.x, y: p.position.y + 0.3, z: p.position.z }, { count: 12, radius: 0.9, height: 0.7, size: 1.2, color: '#bfe6ff' });
        particles?.burst('sparkle', { x: p.position.x, y: p.position.y + 0.6, z: p.position.z }, { count: 8, radius: 0.7, height: 0.8, color: '#9fd8ff' });
        labels?.label('Splash!', at, '#ffd0d0');
      }
      if (rec.out.length) sfx?.play('splash', { vol: 0.8 });
      for (const slot of dry) { const p = who ? who(slot) : null; if (p) particles?.burst('sparkle', { x: p.position.x, y: p.position.y + 1.4, z: p.position.z }, { count: 4, radius: 0.4, color: '#ffe27a' }); }
    },
    scoreText(v, slot) {
      if (!v) return { text: '', out: false };
      return v.alive[slot] === false ? { text: 'SPLASH', out: true } : { text: 'DRY', out: false };
    },
    clearPractice() { practice = null; lastKey = ''; },
    capDraw: (i) => ({ ...drawn[i], x: centre.x + drawn[i].x, z: centre.z + drawn[i].z, y: O.y + drawn[i].y }),
    heartColor: () => '#' + heartM.color.getHexString(),
    counts: () => ({ caps: caps.count, symbols: syms.filter((s) => s.visible).length }),
    summary() { let calls = 0; root.traverse((o) => { if (o.isMesh && o.visible) calls++; }); return { visible: root.visible, meshes: calls, plate: plate.visible }; },
    dispose() { if (root.userData.disposed) return; root.userData.disposed = true; living.dispose(); { const all = new Set(geos), own = new Set(); tz.root.traverse((o) => { if (o.geometry) own.add(o.geometry); }); root.traverse((o) => { if (o.geometry && !own.has(o.geometry)) all.add(o.geometry); }); for (const g of all) if (!own.has(g)) g.dispose(); heartGeo.dispose(); } for (const m of mats) m.dispose(); tz.dispose?.(); scene.remove(root); },
  };
}

