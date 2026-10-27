// 69d: pure placement / real terrain footprints, once-only colliders, real world rebuild, shader contracts and Node mesh budgets.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ISLANDS, DUSK_SMALL, DUSK_CAMERA, CAMERA_FOV, WATER_LEVEL } from '../public/js/config.js';
import { getIslandModule } from '../public/js/world/islands/registry.js';
import { createDuskIsland } from '../public/js/world/islands/duskcrown.js';
import { buildDuskPlacement, LANE_HALF } from '../public/js/world/islands/duskPlacement.js';
import { buildDuskFlora } from '../public/js/world/islands/duskFlora.js';
import { getSmallAsset } from '../public/js/world/islands/duskSmallAssets.js';
import { buildDuskSmallVisuals, duskFallMaterial } from '../public/js/world/islands/duskSmallVisuals.js';
import { registerDuskGameplay } from '../public/js/world/islands/duskWorld.js';
import { materials, patchToon } from '../public/js/world/islands/duskVisuals.js';
import { duskUniforms } from '../public/js/world/islands/duskAtmosphere.js';
import { getColliders } from '../public/js/world/colliders.js';
import { createWorldVisuals } from '../public/js/world/islandVisuals.js';
import { polyDist } from '../public/js/world/islands/scatter.js';
import { createWater, waterUniforms } from '../public/js/world/water.js';
import { getTerrainHeight } from '../public/js/world/terrain.js';
import { FollowCamera } from '../public/js/camera/followCamera.js';

const island = ISLANDS.find((i) => i.id === 'duskcrown'), mod = getIslandModule(island.id), L = mod.layout;
const P = buildDuskFlora(island, mod), mushrooms = buildDuskPlacement(island, mod);

test('69d seed plan is deterministic, pinned and leaves the 69c hash unchanged', () => {
  const copy = buildDuskFlora(island, createDuskIsland(island));
  assert.deepEqual(copy.layers, P.layers); assert.equal(P.hash(), 'dc5f974e'); assert.equal(copy.hash(), P.hash());
  assert.equal(mushrooms.hash(), 'a3374631'); assert.equal(buildDuskFlora(island, mod), P);
  assert.deepEqual(P.summary().counts, { mushroom: 135, bulb: 100, stump: 14, log: 12, rock: 24, grass: 300, flower: 190, moss: 110, reed: 210, lily: 133, shelf: 100 });
});

test('every ground footprint keeps water, landing, notch, lanes, wall and plateau clear', () => {
  for (const [kind, list] of Object.entries(P.layers)) if (!['shelf', 'lily'].includes(kind)) for (const it of list) {
    const lx = it.x - island.x, lz = it.z - island.z;
    assert.ok(L.cliffC(lx, lz) < -6 - it.r, it.id);
    assert.ok(Math.hypot(lx - L.landing.x, lz - L.landing.z) >= 30 + it.r, it.id);
    assert.ok(Math.hypot(lx - L.notch.x, lz - L.notch.z) >= 24 + it.r, it.id);
    for (const lane of mushrooms.lanes) assert.ok(polyDist(lane, it.x, it.z) >= LANE_HALF + it.r, it.id);
    for (let k = 0; k < 9; k++) {
      const a = k * Math.PI / 4, x = it.x + (k === 8 ? 0 : Math.cos(a) * it.r), z = it.z + (k === 8 ? 0 : Math.sin(a) * it.r);
      assert.ok(mod.walkable(x, z)); assert.ok(mod.height(x, z) >= WATER_LEVEL + 0.05); assert.ok(['marsh', 'mud'].includes(mod.groundType(x, z)));
    }
  }
});

test('lily footprints lie entirely on their named ponds/lagoon, flat above water with readable empty centres', () => {
  assert.ok(P.layers.lily.some((it) => it.surface === 'dusk-lagoon'));
  assert.ok(new Set(P.layers.lily.map((it) => it.surface)).size > 15);
  for (const it of P.layers.lily) {
    const b = it.surface === 'dusk-lagoon' ? L.lagoon : L.ponds.find((p) => p.id === it.surface), rx = b.rx || b.r, rz = b.rz || b.r;
    const d = Math.hypot((it.x - island.x - b.x) / rx, (it.z - island.z - b.z) / rz);
    assert.ok(d >= 0.57 - 1e-9 && d <= 0.8 + 1e-9); assert.equal(it.y, WATER_LEVEL + DUSK_SMALL.lilyLift);
    for (let k = 0; k < 32; k++) { const a = k * Math.PI / 16; assert.ok(mod.height(it.x + Math.cos(a) * it.r, it.z + Math.sin(a) * it.r) < WATER_LEVEL, it.id); }
    for (const lane of mushrooms.lanes) assert.ok(polyDist(lane, it.x, it.z) >= LANE_HALF + it.r);
  }
  assert.ok(P.pondSpot && mod.walkable(P.pondSpot.x, P.pondSpot.z));
});

test('reeds dress pond rims, stream banks and lagoon shore', () => {
  const near = (it, p) => Math.hypot((it.x - island.x - p.x) / (p.rx || p.r), (it.z - island.z - p.z) / (p.rz || p.r));
  assert.ok(P.layers.reed.filter((it) => near(it, L.lagoon) < 1.4).length >= 15);
  assert.ok(P.layers.reed.filter((it) => L.ponds.some((p) => near(it, p) < 1.4)).length >= 50);
  assert.ok(P.layers.reed.filter((it) => L.streams.some((s) => polyDist(s.pts, it.x - island.x, it.z - island.z) < 4)).length >= 15);
});

test('shelves and three falling ribbons hug the actual cliff below the lid and join their streams', () => {
  for (const it of P.layers.shelf) { assert.ok(it.y >= 5 && it.y < 37); assert.ok(Math.abs(mod.height(it.x, it.z) - it.y) < 0.001, it.id); }
  assert.equal(P.falls.length, 3);
  for (let k = 0; k < 3; k++) {
    const f = P.falls[k], p = L.streams[k].pts[0]; assert.ok(f.path[0].y < mod.plateauTop); assert.ok(f.path[0].y > 45);
    assert.equal(f.foot.x, island.x + p[0]); assert.equal(f.foot.z, island.z + p[1]);
    for (let i = 1; i < f.path.length; i++) assert.ok(f.path[i].y < f.path[i - 1].y);
    for (const pt of f.path.slice(0, -1)) assert.ok(mod.height(pt.x, pt.z) < pt.y, 'falls are outside the wall');
  }
});

test('only 50 solids get 74 ambient colliders; registration and log-axis placement are stable', () => {
  const before = getColliders().length, d = registerDuskGameplay(island);
  assert.equal(P.solids.length, 50); assert.equal(d.floraColliders.length, 74); assert.equal(d.colliders.length, 59);
  assert.equal(getColliders().length, before + 133); assert.equal(registerDuskGameplay(island), d); assert.equal(getColliders().length, before + 133);
  for (const it of P.solids) {
    const cs = d.floraColliders.filter((c) => c.owner === it.id); assert.equal(cs.length, it.kind === 'log' ? 3 : 1);
    if (it.kind === 'log') cs.forEach((c, i) => { assert.ok(Math.abs(c.x - it.x - Math.cos(it.rot) * (i - 1) * it.s) < 1e-9); assert.ok(Math.abs(c.z - it.z + Math.sin(it.rot) * (i - 1) * it.s) < 1e-9); });
  }
});

test('small assets bound their footprints, use glow roles and stay within the whole-island geometry budget', () => {
  for (const kind of Object.keys(P.layers)) {
    const a = getSmallAsset(kind); assert.equal(getSmallAsset(kind), a); assert.ok(a.geo.attributes.aRole && a.geo.attributes.color && a.geo.attributes.normal);
    if (kind !== 'shelf') {
      const pos = a.geo.attributes.position;
      for (let k = 0; k < pos.count; k++) assert.ok(Math.hypot(pos.getX(k), pos.getZ(k)) <= DUSK_SMALL.footprints[kind] + 0.001, `${kind} footprint`);
    }
  }
  const v = buildDuskSmallVisuals(island, P); assert.ok(v.summary().triangles < 140000); assert.ok(v.summary().drawCalls <= 102);      // (+2: the pickable glowcap clumps' own golden layer and hull, one chunk, Step 72b playtest fix)
  v.group.traverse((o) => { assert.ok(!o.isLight); if (o.isMesh) assert.equal(o.castShadow, false); }); v.dispose();
});

test('flora, shelves and reflections reuse the 69c shader; falls and mist share one additional program', () => {
  const v = buildDuskSmallVisuals(island, P), mats = materials();
  v.group.traverse((o) => { if (o.isInstancedMesh) assert.ok(o.material.customProgramCacheKey() === mats.solidMat.customProgramCacheKey() || o.material === mats.outlineMat); });
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.toon.vertexShader, fragmentShader: THREE.ShaderLib.toon.fragmentShader }; patchToon(shader);
  assert.equal(shader.uniforms.uGlow, duskUniforms.uGlow); assert.ok(shader.fragmentShader.includes('vRole > 6.5')); assert.ok(shader.fragmentShader.includes('vColor.rgb * uGlow'));
  const f = duskFallMaterial(); assert.equal(f.uniforms.uTime, waterUniforms.uTime); assert.equal(f.uniforms.uGlow, duskUniforms.uGlow);
  assert.equal(v.group.getObjectByName('dusk-falls-and-mist').material, f); assert.equal(f.depthWrite, false); v.dispose();
});

test('inland water uses a local mask: old island height texture bytes and sea foam code remain unchanged', () => {
  const w = createWater();
  for (const i of ISLANDS) {
    const tex = w.heightTextures[i.id], { width, height, data } = tex.image, stride = i.id === 'duskcrown' ? 2 : 1;
    assert.equal(tex.format, stride === 2 ? THREE.RGFormat : THREE.RedFormat);
    const hx = i.id === 'home' ? 75 : (i.halfX || i.radius) + 12, hz = i.id === 'home' ? 75 : (i.halfZ || i.radius) + 12;
    for (let j = 0; j < height; j++) for (let k = 0; k < width; k++) {
      const x = i.x - hx + (k + 0.5) / width * hx * 2, z = i.z - hz + (j + 0.5) / height * hz * 2;
      assert.equal(data[(j * width + k) * stride], THREE.DataUtils.toHalfFloat(getTerrainHeight(x, z)));
    }
  }
  const dt = w.heightTextures.duskcrown, at = (x, z) => {
    const k = Math.floor((x + 184) / 368 * dt.image.width), j = Math.floor((z + 130) / 260 * dt.image.height);
    return THREE.DataUtils.fromHalfFloat(dt.image.data[(j * dt.image.width + k) * 2 + 1]);
  };
  for (const pond of L.ponds) assert.equal(at(pond.x, pond.z), 1); assert.equal(at(L.lagoon.x, L.lagoon.z), 1); assert.equal(at(0, 125), 0);
  const mat = w.group.children.find((o) => o.name.startsWith('ocean-inner')).material;
  assert.ok(mat.fragmentShader.includes('if (in4(p))')); assert.ok(mat.fragmentShader.includes('alpha = mix(alpha, 0.94 * smoothstep'));
  assert.ok(mat.vertexShader.includes('1.0 - marsh')); assert.ok(mat.fragmentShader.includes('col = mix(col, uFoam * uFoamTint, foam)'));
  w.group.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } }); Object.values(w.heightTextures).forEach((t) => t.dispose());
});

test('actual world.rebuild keeps ambient flora only in full detail and never duplicates colliders or meshes', () => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(CAMERA_FOV, 16 / 9, 0.1, 600);
  camera.position.set(island.x, 10, island.z + 90); camera.lookAt(island.x, 0, island.z + 70);
  const homeProps = { group: new THREE.Group(), handles: { trees: [], palms: [] } };
  const previousDocument = globalThis.document, previousPath = globalThis.Path2D;
  globalThis.Path2D = class {};
  // Other islands paint sign textures on canvas; this stub exercises world lifecycle, never pixels or GPU programs.
  const context = new Proxy({}, { get: (o, key) => key in o ? o[key] : key === 'measureText' ? () => ({ width: 40 }) : key.startsWith('create') ? () => ({ addColorStop() {} }) : () => {} });
  globalThis.document = { createElement: () => ({ getContext: () => context }) };
  const world = createWorldVisuals({ scene, camera, homeProps }), n = getColliders().length, initial = world.visuals.duskcrown.summary();
  for (let k = 0; k < 3; k++) {
    assert.equal(world.rebuild('duskcrown'), true); assert.deepEqual(world.visuals.duskcrown.summary(), initial); assert.equal(getColliders().length, n);
    assert.equal(world.visuals.duskcrown.far.getObjectByName('dusk-small-flora'), undefined);
    assert.ok(world.visuals.duskcrown.full.getObjectByName('dusk-small-flora'));
    assert.equal(world.root.children.filter((o) => o.name === 'island-duskcrown').length, 1);
  }
  const visual = world.visuals.duskcrown, group = visual.full.getObjectByName('dusk-small-flora');
  const spots = { landing: mod.spots().duskLanding, grove: mushrooms.spots.grove, titans: mushrooms.spots.titans, cliff: mod.spots().duskCliff, pond: P.pondSpot, lagoon: mod.spots().duskLagoon };
  const measures = {};
  for (const [name, pt] of Object.entries(spots)) {
    const follow = new FollowCamera(camera); follow.regionCamera = DUSK_CAMERA; follow.regionBlend = 1; follow.update(0, new THREE.Vector3(pt.x, mod.height(pt.x, pt.z), pt.z));
    camera.updateMatrixWorld(true); group.updateMatrixWorld(true);
    const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    let meshes = 0, triangles = 0, instances = 0;
    group.traverse((o) => { if (!o.isMesh || !frustum.intersectsObject(o)) return; meshes++; const n = o.count || 1; instances += n; triangles += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3 * n; });
    measures[name] = { meshes, instances, triangles }; assert.ok(meshes <= 65); assert.ok(triangles < 105000, `${name}: ${triangles}`);
  }
  console.log('69d Node frustum submissions (1280x720 solo, added meshes only; no GPU/shadows/occlusion):', JSON.stringify(measures));
  for (const v of Object.values(world.visuals)) v.dispose(); world.root.removeFromParent();
  if (previousPath === undefined) delete globalThis.Path2D; else globalThis.Path2D = previousPath;
  if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
});
