// The pet lab (PLAN Step 74a): a DEBUG-ONLY viewer for the work-in-progress pet models (npc/petsWip.js: the caterpillar, cocoon, butterfly and wolf). They are not in the pet registry, so this is the
// only way to see them. It never touches saves, sync, colliders or interactables, and costs nothing while nothing is shown.
//
//   const lab = createPetLab({ scene, players, heightAt, camera })
//   lab.show(id, { anim, spin })   id = 'carle:caterpillar' | 'carle:cocoon' | 'carle:butterfly' | 'snowsong' (or 'caterpillar' | 'cocoon' | 'butterfly' | 'wolf'); one model about 2.5 u in front of P1, on the terrain,
//                                  turned to face the camera; opts.anim picks the animation (idle | walk | crawl | flap | glide | rest | wiggle | hatch | trot | sit | wag | howl, whichever the model has),
//                                  opts.spin turns it slowly on a turntable. Returns the summary entry.
//   lab.lineup()                   the four in a row beside P1 (a hanging post for the cocoon, the butterfly hovering)
//   lab.clear()                    removes and disposes everything
//   lab.summary()                  { count, drawCalls, triangles, items: [{ id, anim, drawCalls, triangles, size: { x, y, z }, pos }] }
//   lab.update(dt)                 once per tick; does nothing while empty
// follow('snowsong', owner = players.p1) uses the same pure ground follower; clear() stops it.
import { groundFollowStep, nearestGroundSpot } from '../game/groundPetLogic.js';
import { heelPoint } from '../game/petLogic.js';
import { isWalkable } from './terrain.js';
import { overlapsAny } from './colliders.js';
import * as THREE from 'three';
import { Baker, castMesh, xf } from '../player/character.js';
import { petMaterial } from '../npc/pets.js';
import { createWipPetModel, WIP_KEYS, WIP_ANIMS } from '../npc/petsWip.js';
import { triangleCount, sizeOf } from '../npc/petsKit.js';

const ALIAS = { caterpillar: 'carle:caterpillar', cocoon: 'carle:cocoon', butterfly: 'carle:butterfly', wolf: 'snowsong', carle: 'carle:caterpillar' };
const HOVER = { 'carle:butterfly': 1.1 };               // the butterfly flies: its centre is this high above the ground
const ANIM_ALIAS = { walk: { 'carle:caterpillar': 'crawl', snowsong: 'trot' }, crawl: { snowsong: 'trot' }, trot: { 'carle:caterpillar': 'crawl' } };

/** A small hanging post for the cocoon, standing BEHIND it (local -Z = away from the camera) with a long arm reaching forward under the twig, so the cocoon hangs clear of the pole in every side view. Local origin = the ground below the cocoon. */
function buildPost(height) {
  const b = new Baker();
  const wood = '#8a6a44', X = 0.12, Z = -0.62;
  b.add(new THREE.CylinderGeometry(1, 1, 1, 8), xf([X, height / 2, Z], [0, 0, 0], [0.04, height, 0.04]), { color: wood, outline: 0.1 });
  b.add(new THREE.CylinderGeometry(1, 1, 1, 8), xf([X, height - 0.015, Z / 2 + 0.02], [Math.PI / 2, 0, 0], [0.025, -Z + 0.04, 0.025]), { color: wood, outline: 0.1 });
  b.add(new THREE.CylinderGeometry(1, 1, 1, 12), xf([X, 0.025, Z], [0, 0, 0], [0.12, 0.05, 0.12]), { color: '#6f5a3e', outline: 0.05 });
  const e = b.build(), n = e.geo.attributes.position.count;
  e.geo.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(n), 1));
  e.geo.setAttribute('aWave', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  const mesh = castMesh(e.geo, petMaterial(), true);
  mesh.name = 'petlab-post';
  return mesh;
}

export function createPetLab({ scene, players, heightAt = () => 0, camera = null, walkable = isWalkable, blocked = overlapsAny }) {
  const items = [];
  let time = 0;

  function keyOf(id) {
    const k = ALIAS[id] || id;
    if (!WIP_KEYS.includes(k)) throw new Error(`petLab: unknown pet "${id}" (try ${WIP_KEYS.join(', ')})`);
    return k;
  }
  function animFor(key, anim) {
    const list = WIP_ANIMS[key];
    if (!anim) return list[0];
    if (list.includes(anim)) return (ANIM_ALIAS[anim] && ANIM_ALIAS[anim][key]) || anim;
    return (ANIM_ALIAS[anim] && ANIM_ALIAS[anim][key]) || list[0];
  }
  function place(entry, x, z) {
    const y = heightAt(x, z);
    entry.base = { x, z, y };
    const hover = HOVER[entry.key] || 0;
    if (entry.key === 'carle:cocoon') {                                  // the thread's top (the model origin) hangs from the post's arm
      entry.post = buildPost(1.13);
      entry.post.position.set(x, y, z);
      entry.post.rotation.y = entry.faceYaw;
      scene.add(entry.post);
      const off = new THREE.Vector3(0, 1.13, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), entry.faceYaw);
      entry.model.root.position.set(x + off.x, y + off.y, z + off.z);
    } else entry.model.root.position.set(x, y + hover, z);
  }
  function add(key, x, z, opts = {}) {
    const model = createWipPetModel(key);
    const cam = camera && camera.position ? camera.position : null;
    const entry = { key, model, anim: animFor(key, opts.anim), spin: !!opts.spin, faceYaw: cam ? Math.atan2(cam.x - x, cam.z - z) : 0, t0: time, base: null, post: null };
    model.root.rotation.y = entry.faceYaw;
    scene.add(model.root);
    place(entry, x, z);
    items.push(entry);
    return entry;
  }
  function p1pos() {
    const p = players && players.p1;
    return p && p.position ? { x: p.position.x, z: p.position.z, facing: p.facing || 0 } : { x: 0, z: 0, facing: 0 };
  }
  function removeEntry(e) {
    e.model.dispose();
    if (e.post) { e.post.removeFromParent(); e.post.geometry.dispose(); e.post = null; }
  }
  function summarise(e) {
    const s = sizeOf(e.model.root);
    return {
      id: e.key, anim: e.anim, drawCalls: e.model.drawCalls + (e.post ? 2 : 0), triangles: triangleCount(e.model.mesh.geometry) + (e.post ? triangleCount(e.post.geometry) : 0),
      size: { x: +s.x.toFixed(3), y: +s.y.toFixed(3), z: +s.z.toFixed(3) }, pos: { x: +e.model.root.position.x.toFixed(2), y: +e.model.root.position.y.toFixed(2), z: +e.model.root.position.z.toFixed(2) },
    };
  }

  const lab = {
    show(id, opts = {}) {
      lab.clear();
      const key = keyOf(id), p = p1pos();
      const x = p.x + Math.sin(p.facing) * 2.5, z = p.z + Math.cos(p.facing) * 2.5;
      return summarise(add(key, x, z, opts));
    },
    follow(id, owner = players.p1) {
      const key = keyOf(id);
      if (key !== 'snowsong') throw new Error('petLab.follow supports snowsong');
      if (!owner) return null;
      lab.clear();
      const heel = heelPoint({ ...owner.position, facing: owner.facing || 0 }, owner.index ?? 0);
      const spot = nearestGroundSpot(heel, { heightAt, walkable, blocked });
      const e = add(key, spot?.x ?? heel.x, spot?.z ?? heel.z);
      e.owner = owner; e.ground = { x: e.model.root.position.x, y: e.model.root.position.y, z: e.model.root.position.z, yaw: owner.facing || 0 };
      return lab.summary();
    },
    lineup(opts = {}) {
      lab.clear();
      const p = p1pos(), keys = ['carle:caterpillar', 'carle:cocoon', 'carle:butterfly', 'snowsong'];
      keys.forEach((k, i) => add(k, p.x + (i - 1.5) * 1.5, p.z + 2.6, { anim: opts.anim, spin: opts.spin }));
      return lab.summary();
    },
    clear() {
      for (const e of items) removeEntry(e);
      items.length = 0;
    },
    summary() {
      const list = items.map(summarise);
      return { count: list.length, drawCalls: list.reduce((a, b) => a + b.drawCalls, 0), triangles: list.reduce((a, b) => a + b.triangles, 0), items: list };
    },
    /** Change the animation of a shown model (by id), e.g. lab.anim('snowsong', 'howl'). */
    anim(id, anim) {
      const key = keyOf(id);
      for (const e of items) if (e.key === key) e.anim = animFor(key, anim);
      return lab.summary();
    },
    update(dt) {
      if (!items.length) return;
      time += dt;
      for (const e of items) {
        if (e.spin) e.model.root.rotation.y += dt * 0.6;
        let speed = 1;
        if (e.owner) {
          const heel = heelPoint({ ...e.owner.position, facing: e.owner.facing || 0 }, e.owner.index ?? 0);
          const result = groundFollowStep(e.ground, heel, dt, { heightAt, walkable, blocked });
          e.model.root.visible = !!result.target && !e.owner.downed && !e.owner.away;
          e.model.root.position.set(e.ground.x, e.ground.y, e.ground.z); e.model.root.rotation.y = e.ground.yaw || 0;
          speed = result.speed; e.anim = speed > 0.05 ? 'walk' : 'idle';
        }
        e.model.update(dt, time - e.t0, { anim: e.anim, speed });
      }
    },
    get count() { return items.length; },
  };
  return lab;
}
