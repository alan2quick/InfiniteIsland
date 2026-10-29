// Island visuals + the world's visibility manager (Step 27b). Every island is ONE visuals object:
//
//   buildIslandVisuals(island, ctx) -> { id, root, full, far, always, update(t), setFull(bool), dispose(), summary() }
//     root    Group `island-<id>` in the scene
//     full    full detail: terrain chunks (terrainMesh.js) + props (chunked instanced layers on the big islands) + bridge stubs
//     far     the cheap far version: ONE low-res terrain mesh + ONE merged canopy-blob mesh, no shadows (<= 2 draw calls)
//     always  things that stay visible at any distance (the volcano smoke plume: 1 draw call)
//   Exactly one of full / far is visible at a time (setFull); hidden groups use `visible = false`.
//
// Gameplay data is kept apart from visuals (PLAN "Scaling"): buildIslandData(island) runs once per island at load on every screen and
// owns everything with identity (stub colliders, both big islands' colliders / interactables / harvest proxies), so disposing and rebuilding an island's visuals can never
// duplicate a collider or move a tree. HOME is wrapped, not restructured: its props (world/props.js) carry colliders and interactables of
// their own, so rebuilding home only rebuilds its terrain + far version; the props group is just re-parented.
//
//   const world = createWorldVisuals({ scene, camera, homeProps })
//   world.update(t)        once per frame (after the camera moved): updates the regions from the view centre + animates the smoke
//   world.regions          region manager (world/regions.js): isFull(id), view, summary()
//   world.rebuild(id)      dispose + rebuild one island's visuals (debug / future streaming); draw calls, colliders, sync hashes stay unchanged
//   world.snap()           re-evaluate regions immediately without hysteresis (teleports, startup)
//   world.setViewHint(pt | null, regionPt?)   cutscenes (Step 28c, the bridge opening): use this ground point { x, z } as the view centre instead of the camera's, so every
//                          island near it is full detail through a flyover (no pop-in in the reveal shot); null = back to the camera. Snaps at once.
//                          regionPt (Step 71): when given, the far / full decision uses THAT point while the atmosphere / light keep reading `pt` (the sailing boat's own position vs. the water ahead of it).
//   world.visuals[id], world.root, world.summary()
//   world.ember            Emberleaf's gameplay data (islands/emberWorld.js)
//   world.story            Storybook Cay's gameplay data (islands/storyWorld.js: layout, signs, stands)
//   world.frost            Frostpine's gameplay data (islands/frostWorld.js: placement, sampleSpots(), summary())
//   world.harvestables     the choppable trees / breakable boulders of the big islands (Groups with userData.interactable, Step 29a): harvest.js adds them to its targets
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ISLANDS, BRIDGES, REGION_VIEW, HOMESTEAD } from '../config.js';
import { buildIslandTerrain, buildFarTerrain } from './terrainMesh.js';
import { createRegions } from './regions.js';
import { registerStubColliders, buildStubVisuals } from './bridgeStubs.js';
import { registerEmberGameplay } from './islands/emberWorld.js';
import { buildEmberVisuals } from './islands/emberVisuals.js';
import { registerFrostGameplay } from './islands/frostWorld.js';
import { buildFrostVisuals } from './islands/frostVisuals.js';
import { registerStoryGameplay } from './islands/storyWorld.js';
import { buildStoryVisuals } from './islands/storyVisuals.js';
import { registerDuskGameplay, registerCrownTreeGameplay } from './islands/duskWorld.js';
import { buildDuskVisuals } from './islands/duskVisuals.js';
import { buildDuskSmallVisuals } from './islands/duskSmallVisuals.js';
import { buildCrownVisuals } from './islands/crownVisuals.js';
import { buildCrownTreeVisuals } from './islands/crownTreeVisuals.js';
import { getIslandModule } from './islands/registry.js';
import { toonMat } from '../render/toon.js';
import { part } from './props.js';

// ---------------------------------------------------------------------------------------------
// Gameplay-side data (once per island, every screen)
// ---------------------------------------------------------------------------------------------
const _data = new Map();
/** Deterministic, cheap per-island data with stable identity; registers the island's colliders. Cached: calling it again changes nothing. */
export function buildIslandData(island) {
  if (_data.has(island.id)) return _data.get(island.id);
  const data = { id: island.id };
  if (island.biome === 'volcanic') data.ember = registerEmberGameplay(island);
  if (island.id === 'home') data.stubColliders = registerStubColliders();   // home-side bridge posts
  if (island.biome === 'alpine') data.frost = registerFrostGameplay(island);   // Step 29a: Frostpine's colliders, interactables, harvest proxies
  if (island.biome === 'storybook') data.story = registerStoryGameplay(island);   // Step 48: Storybook Cay's colliders, sign, book stand(s)
  if (island.biome === 'fungal') { data.dusk = registerDuskGameplay(island); data.crownTrees = registerCrownTreeGameplay(island); }   // Step 69c: Duskcrown's mushroom stem colliders; Step 85d: the Crownlands' trunk colliders
  _data.set(island.id, data);
  return data;
}

// ---------------------------------------------------------------------------------------------
// Far canopy blobs of the home island (its trees are individual meshes with colliders: only their positions are read)
// ---------------------------------------------------------------------------------------------
// Step 86d: Homesteading changes the trees: removed natives (userData.retired, set by world/homesteadWorld.js) are skipped and grown planted trees / palms are added. The blobs are rebuilt (geometry swapped) when the
// layout changed (props.farDirty, raised by homesteadWorld) at most every FAR_REBUILD s, so a burst of changes is one rebuild.
const FAR_REBUILD = 0.6;
function farBlobGeo(props) {
  const ico = new THREE.IcosahedronGeometry(1, 0);
  const parts = [];
  const trees = [...props.handles.trees], palms = [...props.handles.palms];
  for (const h of props.planted ? props.planted.values() : []) {
    if (!h.g || h.g.userData.young) continue;
    const k = HOMESTEAD.kinds[h.kind];
    if (k && k.cls === 'tree') trees.push(h.g); else if (k && k.cls === 'palm') palms.push(h.g);
  }
  for (const g of trees) {
    if (g.userData.retired) continue;
    const s = g.scale.x;
    parts.push(part(ico, g.userData.cherry ? '#ff9fc6' : '#4cbf68', { p: [g.position.x, g.position.y + 3.1 * s, g.position.z], s: [2.6 * s, 1.8 * s, 2.6 * s] }));
  }
  for (const g of palms) {
    if (g.userData.retired) continue;
    const s = g.scale.x;
    parts.push(part(ico, '#3fae55', { p: [g.position.x, g.position.y + 4.6 * s, g.position.z], s: [2.2 * s, 1.0 * s, 2.2 * s] }));
  }
  ico.dispose();
  if (!parts.length) return null;
  const geo = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return geo;
}
function homeFarBlobs(props) {
  const geo0 = farBlobGeo(props);
  if (!geo0) return null;
  const mesh = new THREE.Mesh(geo0, toonMat('#ffffff', { vertexColors: true }));
  mesh.name = 'far-trees-home';
  mesh.castShadow = false; mesh.receiveShadow = false;
  let wait = 0;
  return {
    mesh,
    rebuilds: 0,
    /** Per frame: swap in a fresh geometry when the layout changed (debounced). */
    tick(dt) {
      if (!props.farDirty) return;
      wait += dt;
      if (wait < FAR_REBUILD) return;
      wait = 0; props.farDirty = false;
      this.rebuild();
    },
    rebuild() {
      const g = farBlobGeo(props);
      const old = mesh.geometry;
      if (g) mesh.geometry = g;
      mesh.visible = !!g;
      old.dispose();
      this.rebuilds++;
    },
    dispose() { mesh.geometry.dispose(); mesh.removeFromParent(); },
  };
}

// ---------------------------------------------------------------------------------------------
// One island's visuals
// ---------------------------------------------------------------------------------------------
export function buildIslandVisuals(island, ctx) {
  const data = buildIslandData(island);
  const root = new THREE.Group(); root.name = `island-${island.id}`;
  const full = new THREE.Group(); full.name = `island-${island.id}-full`;
  const far = new THREE.Group(); far.name = `island-${island.id}-far`;
  const always = new THREE.Group(); always.name = `island-${island.id}-always`;
  root.add(full, far, always);
  const disposers = [];

  const terrain = buildIslandTerrain(island);
  full.add(terrain.group); disposers.push(() => terrain.dispose());
  const farTerrain = buildFarTerrain(island);
  far.add(farTerrain.mesh); disposers.push(() => farTerrain.dispose());

  let ember = null, frost = null, story = null, dusk = null, smallDusk = null, crown = null, crownTrees = null, homeFar = null;
  if (island.id === 'home') {
    full.add(ctx.homeProps.group);                         // wrapped as is (never disposed here: its colliders / interactables live on)
    const blobs = homeFarBlobs(ctx.homeProps);
    if (blobs) { far.add(blobs.mesh); disposers.push(() => blobs.dispose()); homeFar = blobs; }
  } else {
    if (data.ember) {
      ember = buildEmberVisuals(island, data.ember);
      full.add(ember.group); far.add(ember.far); always.add(ember.always);
      disposers.push(() => ember.dispose());
    }
    if (data.frost) {
      frost = buildFrostVisuals(island, data.frost);
      full.add(frost.group); far.add(frost.far);
      disposers.push(() => frost.dispose());
    }
    if (data.story) {
      story = buildStoryVisuals(island, data.story);
      full.add(story.group); far.add(story.far);
      disposers.push(() => story.dispose());
    }
    if (data.dusk) {
      dusk = buildDuskVisuals(island, data.dusk);          // Step 69c: giant / titan mushrooms, light pools, the canopy fade
      full.add(dusk.group); far.add(dusk.far);
      disposers.push(() => dusk.dispose());
      smallDusk = buildDuskSmallVisuals(island, data.dusk.flora);
      full.add(smallDusk.group); disposers.push(() => smallDusk.dispose());
      crown = buildCrownVisuals(island, getIslandModule(island.id));     // Step 85c: the Crownlands' water, falls and floating islands (the secret layers follow the cloud lid; the sea-cliff falls are always drawn)
      full.add(crown.group, crown.fixed); far.add(crown.far, crown.farFixed);
      disposers.push(() => crown.dispose());
      crownTrees = buildCrownTreeVisuals(island, data.crownTrees.placement);   // Step 85d: the plateau's acacias and baobabs (drawn only while the cloud lid is off; trunk colliders are registered once in buildIslandData)
      full.add(crownTrees.group); far.add(crownTrees.far);
      disposers.push(() => crownTrees.dispose());
    }
  }
  for (const b of BRIDGES) {                               // broken bridge stubs at every landing on this island (until Step 28)
    for (const end of ['a', 'b']) {
      if ((end === 'a' ? b.from : b.to) !== island.id) continue;
      const stub = buildStubVisuals(b, end);
      full.add(stub.group); disposers.push(() => stub.dispose());
    }
  }

  return {
    id: island.id, root, full, far, always, data, get crown() { return crown; }, get crownTrees() { return crownTrees; },
    update(t) { ember?.update(t); frost?.update(t); story?.update(t); if (homeFar) { homeFar.tick(Math.min(0.25, Math.max(0, t - (homeFar.last ?? t)))); homeFar.last = t; } },
    get homeFar() { return homeFar; },
    setFull(on) { full.visible = on; far.visible = !on; },
    dispose() {
      for (const d of disposers) d();
      root.removeFromParent();
    },
    summary() { return { ember: ember ? ember.summary() : null, frost: frost ? frost.summary() : null, story: story ? story.summary() : null, dusk: dusk ? dusk.summary() : null, duskSmall: smallDusk ? smallDusk.summary() : null, crown: crown ? crown.summary() : null, crownTrees: crownTrees ? crownTrees.summary() : null }; },
  };
}

// ---------------------------------------------------------------------------------------------
// The world: all islands + the region manager
// ---------------------------------------------------------------------------------------------
export function createWorldVisuals({ scene, camera, homeProps }) {
  for (const island of ISLANDS) buildIslandData(island);   // gameplay data first, for every island, on every screen
  const root = new THREE.Group(); root.name = 'world';
  scene.add(root);
  const visuals = {};
  const islandOf = (id) => ISLANDS.find((i) => i.id === id);
  const ctx = { homeProps };
  for (const island of ISLANDS) {
    visuals[island.id] = buildIslandVisuals(island, ctx);
    root.add(visuals[island.id].root);
  }
  const regions = createRegions({
    islands: ISLANDS, ...REGION_VIEW,
    onMode: (id, full) => visuals[id]?.setFull(full),
  });

  // The view centre: where the camera's forward ray meets the ground plane (works for the follow camera, the feast camera and the debug camera).
  const _dir = new THREE.Vector3();
  const centre = { x: 0, z: 0 };
  let hint = null, regionHint = null;                       // Step 71: the crossing lights the destination EARLY (hint ahead of the boat) but only its own position decides far / full detail (regionHint)
  function viewCentre() {
    if (hint) { centre.x = hint.x; centre.z = hint.z; return centre; }
    camera.getWorldDirection(_dir);
    const p = camera.position;
    if (_dir.y < -0.05) {
      const k = Math.min(p.y / -_dir.y, 260);
      centre.x = p.x + _dir.x * k; centre.z = p.z + _dir.z * k;
    } else { centre.x = p.x; centre.z = p.z; }
    return centre;
  }

  const regionCentre = () => regionHint || viewCentre();
  function setViewHint(pt, regionPt = null) { hint = pt ? { x: pt.x, z: pt.z } : null; regionHint = pt && regionPt ? { x: regionPt.x, z: regionPt.z } : null; snap(); }
  function snap() { const c = regionCentre(); regions.update(c.x, c.z, true); }
  function update(t) {
    const c = regionCentre();
    regions.update(c.x, c.z);
    for (const id in visuals) visuals[id].update(t);
  }
  function rebuild(id) {
    const island = islandOf(id);
    if (!island || !visuals[id]) return false;
    visuals[id].dispose();
    visuals[id] = buildIslandVisuals(island, ctx);
    root.add(visuals[id].root);
    visuals[id].setFull(regions.isFull(id));
    return true;
  }
  snap();
  const harvestables = [];
  let frost = null, ember = null, story = null;
  for (const island of ISLANDS) {
    const d = buildIslandData(island);
    if (d.story) story = d.story;
    if (d.frost) { frost = d.frost; harvestables.push(...d.frost.harvestables); }
    if (d.ember) { ember = d.ember; harvestables.push(...d.ember.harvestables); }
  }
  return {
    root, visuals, regions, update, snap, rebuild, setViewHint, harvestables, frost, ember, story,
    viewCentre: () => ({ ...viewCentre() }),
    summary() {
      const s = { regions: regions.summary(), islands: {} };
      for (const id in visuals) s.islands[id] = { full: visuals[id].full.visible, ...visuals[id].summary() };
      return s;
    },
  };
}
