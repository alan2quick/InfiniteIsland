// Step 86a: the screens' side of Homesteading (the layout layer): turns the `homestead` domain's layout (game/homestead.js) into the island. No UI yet (86b-d).
//
//   const world = createHomesteadWorld({ props, harvest, gathering, interactions?, particles?, sfx? });  homestead.attach(world)
//   world.natives()                 [{ id, kind }]  every native thing with its STABLE id: 'tree:i' 'palm:i' 'rock:i' 'bush:i' (i = index in props.handles, the deterministic placement order), 'herb:i' 'mush:i',
//                                   'flower:k' (the k-th interactable flower), 'dig:1'..'dig:N' (the wandering home dig spots are a count, not identities)
//   world.retire(id, extra, opts)   remove a native for good (or a placed 'p<pid>'). IDEMPOTENT. TOMBSTONES, not deletions: the object stays in props.handles / harvest / gathering at its slot (so no index and no
//                                   interactable id shifts), it is hidden, its interactable and collider are gone, harvest/gathering skip it and its regrow timer never fires (harvest.retire, gathering.retire*).
//   world.create(rec, opts)         build a planted object (props.spawnPlaced) and register it: trees / palms / rocks with harvest (fixed target id placedIdBase + pid), berry bushes / herbs / mushrooms with gathering
//                                   (keyed 'p<pid>'), dig spots as fixed patches (host creates, the gathering event reaches the replicas). A tree/palm below 'grown' is a 'sprout' interactable (watering comes with 86d).
//   world.setStage(pid, stage)      rebuild a planted tree at its new growth stage (86a: no growth effect yet)
//   world.applyLayout(layout, {host})   make the island match a whole layout (the host's load, a replica's snapshot): retire what is removed, build what is missing, drop what is gone. Idempotent.
//   world.spotCheck(kind, x, z)     null | 'ground' | 'blocked' | 'crowded' (props.placeCheck); world.layerFull(kind); world.spotInfo(sid); world.idOfItem(item) -> native/placed id (or 'spot:<sid>') | null
// Step 86c (Shape): `retire(id, extra, opts)` with extra.shape = { dx, dz, tool, actor } plays the NORMAL removal on every screen instead of the silent poof: trees / palms / rocks run harvest's own fell / shatter (harvest.removeForGood;
// the host's drops are rolled in that animation, exactly like a full chop / break), bushes / herbs / mushrooms / dig spots give their one-harvest drop through gathering.lastHarvest (host banks it), then the pop-out poof. world.posOf(id, sid) = where a target is.
// Step 86e: the other islands' kinds (world/homesteadForeign.js): create() builds them there instead of in props.js, announces a foreign dig patch to gathering (notePatch: its island's finds, its look), and the grown trees / rocks
// pop and boing through their instance <-> proxy binding (the same swap harvest.js and interactions.js use on the big islands). world.setNight(nightness, t) drives the Duskcrown decorations' home glow; world.foreign.stats() = layers + draw calls.
// Step 86d: the far-view canopy blobs (islandVisuals.js homeFarBlobs) follow the layout: a removed native tree / palm is marked userData.retired and a planted one (grown) is read from props.planted; every change raises
// props.farDirty and the blobs rebuild (debounced) in the island's update. setStage(pid, stage, { animate, by }) now plays the growth effect (world/homesteadFx.js: boing, ring, leaves, sound; `isLocal(by)` = the
// waterer is on this screen: a small camera nudge). world.ghostSpec(kind) is the ghost preview's model (props.ghostSpec); world.stageOf(pid) / handleOf(pid) / pidOfItem(item) serve the watering press (game/homesteadPlace.js).
import * as THREE from 'three';
import { HOMESTEAD } from '../config.js';
import { getColliders, removeCollider } from './colliders.js';
import { removeInteractable, getInteractables } from './interactables.js';
import { classifyNative, FLOWER_KINDS, pidOfId, isDigSlot, kindMeta } from '../game/homesteadLogic.js';
import { createHomesteadForeign } from './homesteadForeign.js';
import { BOING_TIME } from './homesteadFx.js';

const easeOutBack = (u) => { const c = 1.9, v = u - 1; return 1 + (c + 1) * v * v * v + c * v * v; };
const POP_TIME = 0.5;
const isTreeCls = (c) => c === 'tree' || c === 'palm' || c === 'bamboo';
const isHarvestCls = (c) => isTreeCls(c) || c === 'rock';
const ZERO = new THREE.Matrix4().makeScale(0.0001, 0.0001, 0.0001);

export function createHomesteadWorld({ props, harvest, gathering, interactions = null, particles = null, sfx = null, fx = null, isLocal = () => false }) {
  const H = props.handles;
  const table = [];
  const refs = new Map();                       // native id -> { cls, g?, i?, f? }
  const byItem = new Map();                     // interactable -> native id
  {
    const add = (id, kind, ref, item = null) => { table.push({ id, kind }); refs.set(id, ref); if (item) byItem.set(item, id); };
    H.trees.forEach((g, i) => add(`tree:${i}`, classifyNative({ type: 'tree', cherry: g.userData.cherry }), { cls: 'tree', g }, g.userData.interactable));
    H.palms.forEach((g, i) => add(`palm:${i}`, 'palm', { cls: 'palm', g }, g.userData.interactable));
    H.rocks.forEach((g, i) => add(`rock:${i}`, 'rock', { cls: 'rock', g }, g.userData.interactable));
    H.bushes.forEach((g, i) => add(`bush:${i}`, classifyNative({ type: 'bush', berries: !!g.userData.berries }), { cls: 'bush', g }, g.userData.interactable));
    if (H.herbs) H.herbs.list.forEach((h, i) => add(`herb:${i}`, 'herb', { cls: 'herb', i }, (gathering.plants.herbs[i] || {}).item));
    H.mushrooms.forEach((m, i) => add(`mush:${i}`, 'mushroom', { cls: 'mush', i, g: m }, (gathering.plants.mushrooms[i] || {}).item));
    let k = 0;
    if (H.flowers) for (const f of H.flowers.list) if (f.interactable) { add(`flower:${k}`, FLOWER_KINDS[f.c], { cls: 'flower', f }, f.interactable); k++; }
    for (let d = 1; d <= gathering.nativeDigCount; d++) add(`dig:${d}`, 'digSpot', { cls: 'dig' });
  }

  const retired = new Set();                    // native ids already tombstoned on this screen
  const built = new Map();                      // pid -> { rec, h }   (h = the props handle; null for a dig spot)
  const pops = [];                              // pop-in tweens: { mesh?, fn?, bind?, t }
  const foreign = createHomesteadForeign({ group: props.group, props });
  const timers = [];                            // { t, d, fn }
  const puff = (x, y, z, color = '#d9b48a') => { if (particles) { particles.burst('puff', { x, y: y + 0.3, z }, { count: 7, radius: 0.7, color }); particles.burst('sparkle', { x, y: y + 0.8, z }, { count: 4, radius: 0.6 }); } };
  const snd = (name, opts) => { if (sfx) sfx.play(name, opts); };
  let trimmed = 0;                              // native dig slots already trimmed from the wandering spots at load

  function dropCollidersOf(g) { for (const c of [...getColliders()]) if (c.owner === g) removeCollider(c); }

  // ------------------------------------------------------------------ removing natives (tombstones)
  function retireNative(id, extra, opts) {
    const ref = refs.get(id);
    if (!ref) return false;
    if (retired.has(id)) return true;
    retired.add(id);
    if (ref.g) { ref.g.userData.retired = true; props.farDirty = true; }          // (the far-view blobs skip it)
    const pos = ref.g ? ref.g.position : ref.f ? ref.f : null;
    const shape = extra && extra.shape;
    const own = shape && (ref.cls === 'tree' || ref.cls === 'palm' || ref.cls === 'rock' || ref.cls === 'dig');       // these play their own animation; the poof comes after it
    if (opts.animate && pos && !own) { puff(pos.x, pos.y ?? 0, pos.z); snd('poof'); }
    switch (ref.cls) {
      case 'tree': case 'palm': case 'rock':
        if (shape && opts.animate) harvest.removeForGood(ref.g, { ...shape, onDone: () => { puff(ref.g.position.x, ref.g.position.y, ref.g.position.z); snd('poof'); } });
        else harvest.retire(ref.g);
        break;
      case 'bush': {
        const item = ref.g.userData.interactable;
        if (shape) gathering.lastHarvest({ cls: 'bush', item }, shape.actor);
        gathering.retireBush(item);                          // (berry bushes only; a no-op for plain ones)
        ref.g.visible = false;
        dropCollidersOf(ref.g);
        removeInteractable(item);
        break;
      }
      case 'herb': if (shape) gathering.lastHarvest({ cls: 'herb', key: ref.i }, shape.actor); gathering.retireHerb(ref.i); break;
      case 'mush': if (shape) gathering.lastHarvest({ cls: 'mushroom', key: ref.i }, shape.actor); gathering.retireMushroom(ref.i); break;
      case 'flower': {
        const f = ref.f;
        if (interactions) interactions.stopAnim(f.interactable);
        f.mesh.setMatrixAt(f.index, ZERO);
        f.mesh.instanceMatrix.needsUpdate = true;
        removeInteractable(f.interactable);
        break;
      }
      case 'dig':
        if (extra && extra.sid != null) {                                  // (a load has no sid: applyLayout trims the wandering set once)
          const s = gathering.digSpots.find((q) => q.sid === extra.sid);
          if (shape && opts.animate && s) { const at = { x: s.x, y: s.y, z: s.z }; gathering.lastHarvest({ cls: 'dig', sid: extra.sid }, shape.actor); puff(at.x, at.y, at.z); }
          else gathering.removeSpot(extra.sid);
        }
        break;
      default: break;
    }
    return true;
  }

  // ------------------------------------------------------------------ planted objects
  function create(rec, opts = {}) {
    if (built.has(rec.pid)) return;
    const meta = kindMeta(rec.kind);
    if (!meta) return;
    if (meta.cls === 'digspot') {                                       // gathering.js owns dig spots: the host makes the patch, the replicas get its 'spotAdd' event / snapshot entry
      built.set(rec.pid, { rec, h: null });
      if (meta.island !== 'home') gathering.notePatch(rec.pid, { isl: meta.island, look: meta.look, label: meta.digLabel });       // (every screen: the patch digs ITS island's finds and wears its look)
      gathering.addFixedSpot(rec.pid, rec.x, rec.z, !!opts.animate);
      return;
    }
    const other = meta.island !== 'home';
    const h = other ? foreign.spawn(rec.kind, rec) : props.spawnPlaced(rec.kind, rec);
    if (!h) return;
    built.set(rec.pid, { rec, h });
    const young = meta.grows && rec.stage !== 'grown';
    if (!other && (meta.cls === 'tree' || meta.cls === 'palm')) props.farDirty = true;
    if (!young) {
      if (isHarvestCls(meta.cls)) harvest.adopt(h.g);
      else gathering.adoptPlaced(h);                                    // berry bush / herb / mushroom (a plain bush and flowers need nothing more)
    }
    if (opts.animate) {
      puff(rec.x, h.y, rec.z);
      snd('plant');
      const bind = h.g && h.g.userData.binding;
      if (h.g && h.g.children[0]) {
        if (bind) bind.set('pop', 'proxy');                             // an instanced tree / rock: show its proxy while it pops in
        h.g.children[0].scale.setScalar(0.01);
        pops.push({ mesh: h.g.children[0], t: 0, bind });
      } else if (other && h.set) pops.push({ fn: h.set, t: 0 });        // a planted herb / mushroom / glowcap clump scales up
    }
  }

  function destroy(pid, opts = {}) {
    const b = built.get(pid);
    if (!b) return;
    const shape = opts.shape;
    const meta = kindMeta(b.rec.kind);
    if (shape && opts.animate !== false) {
      if (!b.h) gathering.lastHarvest({ cls: 'dig', pid }, shape.actor);                // a planted dig patch: dug out for good
      else if (b.h.g && b.rec.stage === 'grown' && isHarvestCls(meta.cls)) {
        if (!b.dying) { b.dying = true; harvest.removeForGood(b.h.g, { ...shape, onDone: () => { finish(pid, true); } }); }   // the normal fell / break, then the object is deleted
        return;
      } else gathering.lastHarvest({ cls: meta.cls === 'glowcap' ? 'mushroom' : meta.cls, key: 'p' + pid }, shape.actor);     // bush / herb / mushroom cluster: its one-harvest drop (a sprout, a flower: nothing)
    }
    finish(pid, opts.animate);
  }
  /** Delete planted object `pid` (idempotent: harvest's onDone and a snapshot may both arrive). */
  function finish(pid, animate) {
    const b = built.get(pid);
    if (!b) return;
    built.delete(pid);
    if (!b.h) { gathering.removeFixed(pid); if (animate) snd('poof'); return; }
    const meta = kindMeta(b.rec.kind);
    if (b.h.g && isHarvestCls(meta.cls)) harvest.forget(b.h.g);
    gathering.releasePlaced(pid);
    if (meta.island === 'home' && (meta.cls === 'tree' || meta.cls === 'palm')) props.farDirty = true;
    if (animate) { puff(b.rec.x, b.h.y, b.rec.z); snd('poof'); }
    for (let k = pops.length - 1; k >= 0; k--) if ((b.h.g && b.h.g.children[0] && pops[k].mesh === b.h.g.children[0]) || (b.h.set && pops[k].fn === b.h.set)) pops.splice(k, 1);
    b.h.destroy();
  }

  function retire(id, extra = {}, opts = {}) {
    const pid = pidOfId(id);
    if (pid !== null) { destroy(pid, { ...opts, shape: extra && extra.shape }); return; }
    retireNative(id, extra, opts);
  }

  function setStage(pid, stage, opts = {}) {
    const b = built.get(pid);
    if (!b) return;
    const rec = { ...b.rec, stage };
    destroy(pid);
    create(rec, { animate: false });                                     // (the growth effect below replaces the plain pop-in)
    const nb = built.get(pid);
    if (nb && opts.animate && fx) {
      const bind = nb.h.g && nb.h.g.userData.binding;                   // a grown foreign tree is an instance: show its proxy for the boing, then swap back
      if (bind) { bind.set('grow', 'proxy'); timers.push({ t: 0, d: BOING_TIME + 0.15, fn: () => bind.set('grow', 'static') }); }
      fx.grow(nb.h, stage, { local: isLocal(opts.by) });
    }
    else if (nb && opts.animate) { puff(rec.x, nb.h.y, rec.z); snd('pop', { pitch: 1.3 }); }
  }

  function applyLayout(layout, opts = {}) {
    for (const id of layout.removed) if (!retired.has(id)) retire(id, {}, { animate: false });
    if (opts.host) {                                                    // the host's load: the wandering dig spots start at N again; take the removed slots off
      const k = layout.removed.filter(isDigSlot).length;
      if (k > trimmed) { gathering.trimWander(k - trimmed); trimmed = k; }
    }
    const want = new Map(layout.placed.map((p) => [p.pid, p]));
    for (const pid of [...built.keys()]) if (!want.has(pid)) destroy(pid);
    for (const rec of layout.placed) {
      const b = built.get(rec.pid);
      if (!b) create(rec, { animate: false });
      else if (b.rec.stage !== rec.stage) setStage(rec.pid, rec.stage);
    }
  }

  function update(dt) {
    if (fx) fx.update(dt);
    for (let i = pops.length - 1; i >= 0; i--) {
      const p = pops[i];
      p.t += dt;
      const u = Math.min(1, p.t / POP_TIME);
      const k = Math.max(0.01, easeOutBack(u));
      if (p.mesh) p.mesh.scale.setScalar(k); else p.fn(k);
      if (u >= 1) { if (p.mesh) p.mesh.scale.setScalar(1); else p.fn(1); if (p.bind) p.bind.set('pop', 'static'); pops.splice(i, 1); }
    }
    for (let i = timers.length - 1; i >= 0; i--) {
      const q = timers[i];
      q.t += dt;
      if (q.t >= q.d) { timers.splice(i, 1); q.fn(); }
    }
  }

  return {
    natives: () => table,
    retire, create, setStage, applyLayout, update,
    /** Where the target `id` stands ({ x, z } or null): the host's reach check and the fall direction of a Shape removal. */
    posOf(id, sid) {
      const pid = pidOfId(id);
      if (pid !== null) { const b = built.get(pid); return b ? { x: b.rec.x, z: b.rec.z } : null; }
      const ref = refs.get(id);
      if (!ref) return null;
      if (ref.cls === 'dig') { const s = gathering.digSpots.find((q) => q.sid === sid); return s ? { x: s.x, z: s.z } : null; }
      if (ref.g) return { x: ref.g.position.x, z: ref.g.position.z };
      if (ref.f) return { x: ref.f.x, z: ref.f.z };
      const r = ref.cls === 'herb' ? gathering.plants.herbs[ref.i] : null;
      return r ? { x: r.x, z: r.z } : null;
    },
    spotCheck: (kind, x, z) => props.placeCheck(kind, x, z),
    ghostSpec: (kind) => { const m = kindMeta(kind); return m && m.island !== 'home' ? foreign.ghostSpec(kind) : props.ghostSpec(kind); },
    /** Step 86e: the foreign layers (stats() = instanced layers + estimated draw calls) and the Duskcrown decorations' night glow. */
    foreign,
    setNight: (nightness, t) => foreign.setNight(nightness, t),
    /** The growth stage of a planted object ('sprout' | 'sapling' | 'grown') or null; the handle (props.spawnPlaced) of a planted object; the pid behind a sprout / planted interactable. */
    stageOf: (pid) => { const b = built.get(pid); return b ? b.rec.stage : null; },
    handleOf: (pid) => { const b = built.get(pid); return b ? b.h : null; },
    pidOfItem: (item) => (item && item.id >= HOMESTEAD.placedIdBase ? item.id - HOMESTEAD.placedIdBase : null),
    get fx() { return fx; },
    layerFull: (kind) => { const m = kindMeta(kind); return m && m.island !== 'home' ? foreign.layerFull(kind) : props.layerFull(kind); },
    spotInfo: (sid) => gathering.spotInfo(sid),
    /** The sid of a native wandering home dig spot that exists right now (the last made), or null. */
    wanderSid: () => { const w = gathering.digSpots.filter((s) => s.isl === 'home' && s.pid == null).sort((a, b) => b.sid - a.sid)[0]; return w ? w.sid : null; },
    idOfItem(item) {
      if (!item) return null;
      if (item.id >= HOMESTEAD.placedIdBase) return 'p' + (item.id - HOMESTEAD.placedIdBase);
      if (byItem.has(item)) return byItem.get(item);
      const s = gathering.digSpots.find((q) => q.item === item);
      return s && s.isl === 'home' ? `spot:${s.sid}` : null;
    },
    /** The interactable (or null) with this interactable id: debug lookups by number. */
    itemById: (id) => getInteractables().find((i) => i.id === id) || null,
    get retired() { return [...retired]; },
    get built() { return built; },
  };
}
