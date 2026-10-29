// Step 86d: the "satisfying" effects of Homesteading: the watering can's splash arc and the growth burst of a planted tree.
//
//   const fx = createHomesteadFx({ scene, particles, sfx, shake? });
//   fx.pour(from, to)                       a splash arc of droplets from the can (from = { x, y, z }) to the thing watered (to) + the pour sound. Every screen that sees the watering plays it.
//   fx.grow(handle, stage, opts)            the new model `handle.g` (props.spawnPlaced) just replaced the old stage: a squash-and-stretch "boing" with an ease-out-back overshoot, leaves + sparkles, a soft
//                                           green ground ring and the stage's sound (sprout -> sapling: a bright two-note pluck; sapling -> tree: a three-note rising chime + a leafy rustle).
//                                           The full tree gets the bigger version: a larger ring, species-matching falling petals / leaves, and (opts.local) a small camera nudge for the waterer.
//   fx.update(dt)                           once per tick (tweens, droplet spawning, the ring pool)
//   fx.state()                              debug: { boings, rings, jobs }
// No new lights; the ring is a pooled flat MeshBasicMaterial disc ring (2 of them at most, hidden while idle), the droplets / leaves / sparkles are the shared particle points (one draw call for all particles).
import * as THREE from 'three';
import { HOMESTEAD } from '../config.js';

const easeOutBack = (u) => { const c = 1.9, v = u - 1; return 1 + (c + 1) * v * v * v + c * v * v; };
export const BOING_TIME = 0.8;           // s the squash-and-stretch lasts
const POUR_TIME = 0.5;                   // s the droplets keep leaving the can
const RING_TIME = 0.8;
const RING_POOL = 3;

export function createHomesteadFx({ scene, particles = null, sfx = null, shake = null }) {
  const boings = [];                      // { g, base: Vector3, t, big }
  const jobs = [];                        // pour jobs { from, to, t, spawned }
  const rings = [];                       // pooled: { mesh, t, max, busy }
  let ringGeo = null;
  const snd = (name, opts) => { if (sfx) sfx.play(name, opts); };
  const burst = (type, at, o) => { if (particles) particles.burst(type, at, o); };

  function ringFor() {
    if (!ringGeo) ringGeo = new THREE.RingGeometry(0.55, 0.8, 28).rotateX(-Math.PI / 2);
    let r = rings.find((q) => !q.busy);
    if (!r && rings.length < RING_POOL) {
      const mat = new THREE.MeshBasicMaterial({ color: '#8fe27a', transparent: true, opacity: 0, depthWrite: false });
      const mesh = new THREE.Mesh(ringGeo, mat);
      mesh.visible = false; mesh.renderOrder = 2;
      scene.add(mesh);
      r = { mesh, t: 0, max: 1, busy: false };
      rings.push(r);
    }
    return r || null;
  }
  function ring(x, y, z, max) {
    const r = ringFor();
    if (!r) return;
    r.busy = true; r.t = 0; r.max = max;
    r.mesh.position.set(x, y + 0.06, z);
    r.mesh.scale.setScalar(0.4);
    r.mesh.material.opacity = 0.8;
    r.mesh.visible = true;
  }

  return {
    pour(from, to) {
      jobs.push({ from: { ...from }, to: { ...to }, t: 0, spawned: 0 });
      snd('pour');
    },
    grow(h, stage, opts = {}) {
      if (!h || !h.g) return;
      const big = stage === 'grown';
      const g = h.g;
      const at = { x: h.x, y: h.y, z: h.z };
      boings.push({ g, base: g.scale.clone(), t: 0, big });
      g.scale.multiplyScalar(0.35);
      const meta = HOMESTEAD.kinds[h.kind] || {};
      ring(at.x, at.y, at.z, big ? 3.0 : 1.7);
      burst('puff', { x: at.x, y: at.y + 0.25, z: at.z }, { count: big ? 8 : 5, radius: big ? 1.0 : 0.6, color: '#e9ffd8' });
      burst('sparkle', { x: at.x, y: at.y + (big ? 1.2 : 0.55), z: at.z }, { count: big ? 14 : 8, radius: big ? 1.3 : 0.7, color: '#fff3a0' });
      burst('leaf', { x: at.x, y: at.y + (big ? 1.8 : 0.7), z: at.z }, { count: big ? 14 : 7, radius: big ? 1.4 : 0.6, color: h.kind === 'palm' ? '#8fe06a' : null });
      if (big) {
        const cherry = h.kind === 'cherryTree';
        const top = h.kind === 'palm' ? 4.4 : 3.6;
        burst(cherry ? 'petal' : 'leaf', { x: at.x, y: at.y + top, z: at.z }, { count: 22, radius: 1.7, ring: true, speed: 0.55, life: 1.3, color: cherry ? null : (h.kind === 'palm' ? '#9be86a' : null) });
        if (!cherry) burst('petal', { x: at.x, y: at.y + top, z: at.z }, { count: 8, radius: 1.5, speed: 0.4, color: '#fff3b8' });
        if (opts.local && shake) shake(0.05, 0.28);
      }
      snd(big ? 'treegrow' : 'sproutgrow');
      void meta;
    },
    update(dt) {
      for (let i = boings.length - 1; i >= 0; i--) {
        const b = boings[i];
        b.t += dt;
        const u = Math.min(1, b.t / BOING_TIME);
        if (!b.g.parent && u < 1) { boings.splice(i, 1); continue; }         // (removed meanwhile)
        const m = 0.35 + 0.65 * easeOutBack(Math.min(1, b.t / (BOING_TIME * 0.7)));
        const w = Math.sin(b.t * (b.big ? 15 : 19)) * Math.exp(-b.t * 4.2) * (b.big ? 0.16 : 0.2);      // squash (wide + short) then stretch (narrow + tall), decaying
        if (u >= 1) { b.g.scale.copy(b.base); boings.splice(i, 1); continue; }
        b.g.scale.set(b.base.x * m * (1 + w), b.base.y * m * (1 - w), b.base.z * m * (1 + w));
      }
      for (let i = jobs.length - 1; i >= 0; i--) {
        const j = jobs[i];
        j.t += dt;
        const want = Math.min(1, j.t / POUR_TIME) * 12;                      // 12 droplets over the pour, each on an arc from the can's spout to the plant
        while (j.spawned < want) {
          const u = (j.spawned + 0.5) / 12;
          const x = j.from.x + (j.to.x - j.from.x) * u, z = j.from.z + (j.to.z - j.from.z) * u;
          const y = j.from.y + (j.to.y - j.from.y) * u + Math.sin(u * Math.PI) * 0.45;
          burst('dirt', { x, y, z }, { count: 2, radius: 0.06, color: '#8fdcff', size: 0.5, speed: 0.22, life: 0.75 });
          j.spawned++;
        }
        if (j.t >= POUR_TIME) {
          burst('puff', { x: j.to.x, y: j.to.y + 0.1, z: j.to.z }, { count: 4, radius: 0.4, color: '#bfeaff' });       // the splash where it lands
          jobs.splice(i, 1);
        }
      }
      for (const r of rings) {
        if (!r.busy) continue;
        r.t += dt;
        const u = Math.min(1, r.t / RING_TIME);
        r.mesh.scale.setScalar(0.4 + (r.max - 0.4) * (1 - (1 - u) * (1 - u)));
        r.mesh.material.opacity = 0.8 * (1 - u);
        if (u >= 1) { r.busy = false; r.mesh.visible = false; }
      }
    },
    state: () => ({ boings: boings.length, rings: rings.filter((r) => r.busy).length, jobs: jobs.length }),
  };
}
