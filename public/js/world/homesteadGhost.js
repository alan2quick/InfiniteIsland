// Step 86d: the ghost preview of Homesteading: a translucent copy of the kind being placed, about 2 u in front of its player, green when it can stand there and red (with a short floating reason) when it cannot.
// One ghost per local player (each player has their own palette); only this screen draws it (nothing is synced). The models are the SHARED geometries of world/props.js (props.ghostSpec), drawn with two shared
// translucent toon materials (green / red, the same program as the island's toon props; no lights, no extra programs), so a ghost costs one draw call.
// A tree / palm ghost is the sprout that actually gets planted plus a faint ground ring the size of the grown canopy (spec.ring), one more draw call.
//
//   const ghost = createHomesteadGhost({ scene, camera, root, world });
//   ghost.show(player, kind)                      start / change a player's ghost
//   ghost.set(player, { x, z, ok, text })         move it (snapped to the ground) and colour it; `text` = the reason shown above it while red
//   ghost.hide(player)                            remove it
//   ghost.update(dt, camera)                      once per frame: a tiny breathing pulse, the reason tag follows the ghost on screen
//   ghost.get(player)                             debug: { kind, x, z, ok, text } or null
import * as THREE from 'three';
import { toonMat } from '../render/toon.js';
import { getHeight } from './terrain.js';

const MAT_OK = toonMat('#9dffa6', { vertexColors: true, transparent: true, opacity: 0.58, depthWrite: false });
const MAT_BAD = toonMat('#ff8f8f', { vertexColors: true, transparent: true, opacity: 0.58, depthWrite: false });
const RING_OK = toonMat('#9dffa6', { vertexColors: true, transparent: true, opacity: 0.3, depthWrite: false });
const RING_BAD = toonMat('#ff8f8f', { vertexColors: true, transparent: true, opacity: 0.3, depthWrite: false });
const RING_LIFT = 0.08;                              // above the ground under the centre, so the flat ring isn't buried in the grass

/** A flat unit ring (inner 0.86) with a white colour attribute, so it shares the ghost's vertex-colour toon program. */
let ringGeo = null;
function unitRing() {
  if (ringGeo) return ringGeo;
  ringGeo = new THREE.RingGeometry(0.86, 1, 40);
  ringGeo.rotateX(-Math.PI / 2);
  const n = ringGeo.attributes.position.count;
  ringGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  return ringGeo;
}

export function createHomesteadGhost({ scene, camera = null, root = null, world }) {
  const ghosts = new Map();                          // Player -> { kind, mesh, tag, x, z, ok, text, spec, t }
  const v = new THREE.Vector3();

  function make(p, kind) {
    const spec = world.ghostSpec(kind);
    if (!spec) return null;
    const mesh = new THREE.Mesh(spec.geo, MAT_OK);
    mesh.castShadow = false; mesh.receiveShadow = false; mesh.renderOrder = 3; mesh.frustumCulled = false;
    mesh.scale.setScalar(spec.scale);
    scene.add(mesh);
    let ring = null;
    if (spec.ring) {
      ring = new THREE.Mesh(unitRing(), RING_OK);
      ring.castShadow = false; ring.receiveShadow = false; ring.renderOrder = 2; ring.frustumCulled = false;
      ring.scale.setScalar(spec.ring);
      scene.add(ring);
    }
    let tag = null;
    if (root && typeof document !== 'undefined') {
      tag = document.createElement('div');
      tag.className = 'hs-ghost-tag';
      tag.hidden = true;
      root.appendChild(tag);
    }
    return { kind, mesh, ring, tag, spec, x: 0, z: 0, ok: true, text: '', shownText: null, t: 0 };
  }
  function drop(g) {
    scene.remove(g.mesh);
    if (g.ring) scene.remove(g.ring);
    if (g.tag) g.tag.remove();
  }

  return {
    show(p, kind) {
      const cur = ghosts.get(p);
      if (cur && cur.kind === kind) return true;
      if (cur) drop(cur);
      const g = make(p, kind);
      if (!g) { ghosts.delete(p); return false; }
      ghosts.set(p, g);
      return true;
    },
    set(p, { x, z, ok, text = '' }) {
      const g = ghosts.get(p);
      if (!g) return;
      g.x = x; g.z = z; g.ok = !!ok; g.text = text;
      const y = g.spec.absY ? g.spec.dy : getHeight(x, z) + g.spec.dy;
      g.mesh.position.set(x, y, z);
      g.mesh.material = ok ? MAT_OK : MAT_BAD;
      if (g.ring) {
        g.ring.position.set(x, getHeight(x, z) + RING_LIFT, z);
        g.ring.material = ok ? RING_OK : RING_BAD;
      }
    },
    hide(p) {
      const g = ghosts.get(p);
      if (!g) return;
      drop(g);
      ghosts.delete(p);
    },
    update(dt, cam = camera) {
      for (const g of ghosts.values()) {
        g.t += dt;
        const k = g.spec.scale * (1 + 0.025 * Math.sin(g.t * 5));
        g.mesh.scale.setScalar(k);
        if (!g.tag) continue;
        const show = !g.ok && !!g.text && !!cam;
        if (g.tag.hidden === show) g.tag.hidden = !show;
        if (!show) continue;
        if (g.shownText !== g.text) { g.shownText = g.text; g.tag.textContent = g.text; }
        cam.updateMatrixWorld();
        v.set(g.x, g.mesh.position.y + (g.ring ? 0.8 : 1.6), g.z).project(cam);   // a sprout ghost is short: keep its tag just above it, not over the player's head
        const w = window.innerWidth, h = window.innerHeight;
        g.tag.style.transform = `translate3d(${((v.x * 0.5 + 0.5) * w).toFixed(1)}px, ${((-v.y * 0.5 + 0.5) * h).toFixed(1)}px, 0) translate(-50%, -100%)`;
      }
    },
    get: (p) => { const g = ghosts.get(p); return g ? { kind: g.kind, x: g.x, z: g.z, ok: g.ok, text: g.text } : null; },
    has: (p) => ghosts.has(p),
    get count() { return ghosts.size; },
  };
}
