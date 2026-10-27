// The pet stable beside the Duskcrown marsh hearth (PLAN Step 73b): a small open pavilion under a pale mushroom-cap roof with a shallow glowing basin where the pets that nobody brings rest. Any player
// chooses which pet (if any) comes along; the choice is that player's per-screen preference (world/pets.js `set`, saved in `infiniteIsland.pets`).
//
//   const stable = createPetStable({ scene, players, avatars, world, domain, pets, dialog, particles, sfx, hud, heightAt, layout? })     once at load, on every screen (after createPets)
//     domain = the `pets` unlock domain (game/petsDomain.js)     pets = world/pets.js     layout = islands/duskHearth.js duskHearthLayout().stable { x, z, r, yaw } (the spot 72a reserved)
//   stable.update(dt)              once per tick (the pop-in, the resting pets, drawn only while Duskcrown is in full detail)
//   stable.open(player)            the "Choose a pet" menu for that player (what the interactable does);  stable.rows(player) the menu rows (tests)
//   stable.built / .shown / .group / .position / .popping       state;  stable.summary()
//
// Lifecycle: ABSENT until the first pet unlock (no mesh, collider or interactable). A LIVE unlock (an `unlock` event while the game runs) pops it in through world/popIn.js (base, then the cap
// roof, each squash-and-stretch with a poof and a thunk); a load / late join just has it standing there (silent). The colliders (four posts + the basin) and the interactable `stable`
// ("Choose a pet") are registered ONCE per unlock and removed again only when the unlock list empties (debug reset). It only draws while Duskcrown is drawn in full detail.
// The menu lists the unlocked pets, "No pet", and the remaining locked silhouettes whose hints point at the other islands (game/caprayLogic.js LOCKED_PETS).
// Unchosen Carle flutters around the basin (one skinned mesh + shadow); the home silhouette disappears once it is unlocked.
// Unchosen Capray floats in the basin (the same model as the follower, 4 draw calls) whenever no player on any screen brings it.
// Budget: the pavilion is ONE merged mesh + its outline + its shadow = 3 draw calls; with a resting Capray 7 in all. No lights.
import * as THREE from 'three';
import { addCollider, removeCollider } from './colliders.js';
import { addInteractable, removeInteractable } from './interactables.js';
import { G, part, combine, VERTEX_TOON, makeOutline } from '../render/geo.js';
import { createPopper } from './popIn.js';
import { createPetModel, PETS } from '../npc/pets.js';
import { duskHearthLayout } from './islands/duskHearth.js';
import { LOCKED_PETS } from '../game/caprayLogic.js';
import { ICONS, LEAVE_SVG } from '../ui/icons.js';

const POST = 2.05;                       // the posts stand on the corners of a square of this half side
const BASIN_R = 1.05;
const CAP_Y = 3.05;

const C = { stem: '#d8d2f2', stemDark: '#b3acd6', cap: '#c8c2ee', capTop: '#dcd6fa', under: '#f4a35f', gill: '#ffbd6e', stone: '#d9d2ea', stoneDark: '#9d96bd', water: '#8ff0ff', glow: '#ffb347', mist: '#bff8ff' };

/** The pavilion in two pieces so it can pop in: the base (basin, posts, lantern knobs) and the roof (a flattened mushroom cap with its gills and glowing spots). Local space: origin on the ground, +Z towards the fire. */
export function stableGeometries() {
  const base = [];
  base.push(part(G.cyl8, C.stoneDark, { p: [0, 0.16, 0], s: [BASIN_R + 0.18, 0.32, BASIN_R + 0.18] }));
  base.push(part(G.cyl8, C.stone, { p: [0, 0.34, 0], s: [BASIN_R + 0.05, 0.12, BASIN_R + 0.05] }));
  base.push(part(G.cyl8, C.water, { p: [0, 0.36, 0], s: [BASIN_R - 0.22, 0.1, BASIN_R - 0.22] }));            // the glowing water
  base.push(part(G.sphereLo, C.mist, { p: [0.15, 0.43, -0.1], s: [0.3, 0.06, 0.24] }));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    base.push(part(G.cyl6, C.stemDark, { p: [sx * POST, 0.2, sz * POST], s: [0.34, 0.4, 0.34] }));              // flared foot
    base.push(part(G.cyl6, C.stem, { p: [sx * POST, 1.3, sz * POST], s: [0.22, 2.25, 0.22] }));
    base.push(part(G.sphereLo, C.glow, { p: [sx * POST, 2.52, sz * POST], s: [0.17, 0.17, 0.17] }));           // a little glowing knob under the roof
  }
  const roof = [];
  roof.push(part(G.sphere, C.cap, { p: [0, CAP_Y, 0], s: [3.55, 0.95, 3.55] }));
  roof.push(part(G.sphere, C.capTop, { p: [0, CAP_Y + 0.42, 0], s: [2.5, 0.62, 2.5] }));
  roof.push(part(G.cyl8, C.under, { p: [0, CAP_Y - 0.5, 0], s: [3.15, 0.08, 3.15] }));                         // the warm gills under the cap
  roof.push(part(G.cyl8, C.gill, { p: [0, CAP_Y - 0.55, 0], s: [1.9, 0.06, 1.9] }));
  for (let k = 0; k < 7; k++) {                                                                                  // glowing spots on the cap
    const a = k * 0.9 + 0.4, r = 1.2 + (k % 3) * 0.55;
    roof.push(part(G.sphereLo, C.glow, { p: [Math.cos(a) * r, CAP_Y + 0.62 - (r / 3.6) * 0.5, Math.sin(a) * r], s: [0.28, 0.1, 0.28] }));
  }
  return { base: combine(base), roof: combine(roof) };
}

export function createPetStable({ scene, players, avatars = null, world = null, domain, pets, dialog, particles = null, sfx = null, hud = null, heightAt, layout = duskHearthLayout().stable }) {
  const snd = (name, opts) => { if (sfx) sfx.play(name, opts); };
  const S = layout, ground = heightAt(S.x, S.z);
  const position = new THREE.Vector3(S.x, ground, S.z);
  const cosY = Math.cos(S.yaw), sinY = Math.sin(S.yaw);
  const worldOf = (lx, ly, lz) => ({ x: S.x + lx * cosY + lz * sinY, y: ground + ly, z: S.z - lx * sinY + lz * cosY });

  let group = null, solid = null, roofMesh = null, popper = null, geos = null, model = null;
  const resting = new Map();
  let built = false, popping = false, time = 0, bob = 0;
  const colliders = [];
  let interactable = null;

  function ensureGroup() {
    if (group) return;
    group = new THREE.Group();
    group.name = 'pet-stable';
    group.position.copy(position);
    group.rotation.y = S.yaw;
    geos = stableGeometries();
    const merged = combine([geos.base, geos.roof].map((g) => g.clone()));                     // (combine re-merges clones: the pieces stay for the pop-in)
    solid = new THREE.Mesh(merged, VERTEX_TOON);
    solid.name = 'pet-stable-mesh';
    solid.castShadow = true; solid.receiveShadow = true;
    solid.add(makeOutline(merged, 0.045));
    group.add(solid);
    popper = createPopper({ parent: group });
    scene.add(group);
  }

  function register() {
    if (colliders.length) return;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const p = worldOf(sx * POST, 0, sz * POST);
      colliders.push(addCollider({ x: p.x, z: p.z, r: 0.34, owner: group }));
    }
    colliders.push(addCollider({ x: S.x, z: S.z, r: BASIN_R + 0.18, owner: group }));
    interactable = addInteractable({
      type: 'stable', object: null, position: new THREE.Vector3(S.x, ground, S.z), radius: BASIN_R + 1.15, prompt: 'Choose a pet',
      onInteract: (item, by) => open(by || players.p1),
    });
  }
  function unregister() {
    for (const c of colliders.splice(0)) removeCollider(c);
    if (interactable) { removeInteractable(interactable); interactable = null; }
  }

  /** Make the stable exist. `live` = pop in (squash and stretch), else it just stands there. */
  function show(live) {
    ensureGroup();
    register();
    built = true;
    if (!live) { popper.clear(); popping = false; solid.visible = true; return; }
    solid.visible = false;
    popping = true;
    const landed = () => { snd('thud', { pitch: 1.1, vol: 0.5 }); };
    const poof = (at) => { if (particles) { particles.burst('puff', { x: S.x + (at.x - 0) * 0, y: ground + 0.2, z: S.z }, { count: 10, radius: 1.8, ring: true, height: 0.2, speed: 1.2 }); } };
    popper.add(geos.base.clone(), { delay: 0, drop: 1.2, outline: 0.045, onLand: (at) => { landed(); poof(at); } });
    popper.add(geos.roof.clone(), {
      delay: 0.45, drop: 2.2, outline: 0.045,
      onLand: (at) => { snd('cooked', { pitch: 1.15 }); poof(at); if (particles) particles.burst('sparkle', worldOf(0, CAP_Y + 0.5, 0), { count: 14, radius: 2.2, height: 1.0 }); },
      onDone: () => { popping = false; solid.visible = true; },
    });
  }
  function hide() {
    if (!built) return;
    built = false; popping = false;
    unregister();
    if (popper) popper.clear();
    if (group) group.visible = false;
    if (model) { model.dispose(); model = null; }
    for (const m of resting.values()) m.dispose();
    resting.clear();
  }

  function refresh(live) {
    if (!domain.known) return;
    if (domain.unlocked.length > 0) { if (!built) show(live); } else hide();
  }

  // ---- the menu
  const nameOf = (id) => PETS.find((p) => p.id === id)?.name || id;
  function rows(p) {
    const cur = pets.petOf(p);
    const out = domain.unlocked.map((id) => ({
      label: nameOf(id), icon: ICONS[`pet-${id}`], detail: cur === id ? 'Coming along' : 'Bring along',
      onSelect: () => choose(p, id),
    }));
    out.push({ label: 'No pet', icon: LEAVE_SVG, detail: cur ? 'Leave it here' : 'Chosen', onSelect: () => choose(p, null) });
    for (const l of LOCKED_PETS.filter((l) => (l.id !== 'home' || !domain.has('carle')) && (l.id !== 'ember' || !domain.has('ruby')))) out.push({ label: '???', icon: ICONS['pet-locked'], detail: l.hint, disabled: true });
    return out;
  }
  function choose(p, id) {
    dialog.close();
    const got = pets.set(p, id, { fx: true });
    if (particles && p.position) particles.burst('sparkle', { x: p.position.x, y: p.position.y + 1.2, z: p.position.z }, { count: 6, radius: 0.5, height: 0.4 });
    if (hud) hud.toast(got ? `${nameOf(got)} will come along!` : 'No pet this time.', { icon: got ? `pet-${got}` : 'sparkle', duration: 2400 });
  }
  function open(p) {
    if (!p || dialog.isOpen || !built) return false;
    snd('pop', { pitch: 0.9, vol: 0.6 });
    dialog.open({
      name: 'Pet stable', owner: p, tag: players.multi ? p.colors.name : '', color: p.colors.ui, menuId: 'pet-stable',
      text: 'Who comes along?', choices: () => rows(p), onCancel: () => dialog.close(),
    });
    return true;
  }

  // ---- the resting pet: Capray floats in the basin while nobody brings it
  const bringsCapray = () => players.list.some((p) => pets.petOf(p) === 'capray') || (avatars ? avatars.list.some((p) => pets.petOf(p) === 'capray') : false);
  function updateModel(dt, visible) {
    const want = visible && !popping && domain.has('capray') && !bringsCapray();
    if (want && !model) {
      model = createPetModel('capray');
      model.root.rotation.order = 'YXZ';
      model.root.scale.setScalar(0.95);
      group.add(model.root);
    }
    if (model) {
      model.root.visible = want;
      if (want) {
        bob += dt;
        model.root.position.set(0, 0.95 + Math.sin(bob * 1.4) * 0.07, 0);
        model.root.rotation.y = bob * 0.35;
        model.rig.rotation.z = Math.sin(bob * 0.9) * 0.08;
        model.update(dt, bob, { sway: 0.5, rocking: 0.8 });
      }
    }
  }

  function update(dt) {
    time += dt;
    if (!domain.known) return;
    if (popper) popper.update(dt);
    const visible = built && (!world || world.regions.isFull('duskcrown'));
    if (group) group.visible = visible;
    updateModel(dt, visible);
    const wantRuby = visible && !popping && domain.has('ruby') && ![...players.list, ...(avatars?.list || [])].some((p) => pets.petOf(p) === 'ruby');
    if (wantRuby && !resting.has('ruby')) { const r = createPetModel('ruby'); group.add(r.root); resting.set('ruby', r); }
    const ruby = resting.get('ruby');
    if (ruby) {
      ruby.root.visible = wantRuby;
      if (wantRuby) { ruby.root.position.set(1.55, 0, 0.45); ruby.root.rotation.y = -0.7; ruby.update(dt, time, { anim: 'idle' }); }
    }
    const wantCarle = visible && !popping && domain.has('carle') && ![...players.list, ...(avatars?.list || [])].some((p) => pets.petOf(p) === 'carle');
    if (wantCarle && !resting.has('carle')) { const m = createPetModel('carle'); group.add(m.root); resting.set('carle', m); }
    const m = resting.get('carle');
    if (m) {
      m.root.visible = wantCarle;
      if (wantCarle) { m.root.position.set(Math.sin(time) * 0.85, 1.05 + Math.sin(time * 2) * 0.18, Math.cos(time) * 0.85); m.root.rotation.y = time + Math.PI / 2; m.update(dt, time, { anim: time % 3 < 0.8 ? 'flap' : 'glide' }); }
    }
  }

  domain.onUnlock((id, { live }) => { if (live) refresh(true); });
  domain.onChange(() => refresh(false));
  refresh(false);

  return {
    update, open, rows,
    get built() { return built; },
    get popping() { return popping; },
    get shown() { return !!group && group.visible && built; },
    get group() { return group; },
    get restingModel() { return model && model.root.visible ? model : null; },
    restingModelOf: (id) => id === 'capray' ? model : resting.get(id) || null,
    position,
    summary() {
      let calls = 0;
      if (group && group.visible) group.traverseVisible((o) => { if (o.isMesh) calls += o.castShadow ? 2 : 1; });
      return { built, shown: !!group && group.visible && built, popping, colliders: colliders.length, interactable: !!interactable, resting: !!(model && model.root.visible), drawCalls: group && group.visible ? calls : 0, position: { x: +S.x.toFixed(2), z: +S.z.toFixed(2) }, unlocked: domain.unlocked };
    },
  };
}
