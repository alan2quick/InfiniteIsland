// Step 85d: the Crownlands' alien acacias and baobabs. The pure placement (crownPlacement.js), the cached geometry (crownTreeAssets.js), the instanced visuals + shader patch + canopy fade
// (crownTreeVisuals.js), the trunk colliders registered once (duskWorld.js), the lid gate (crownLayers.js) and a Node frustum budget at the three crown spots. No GPU: programs are checked as
// source / material identity only.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ISLANDS, CAMERA_FOV, CROWN_TREES } from '../public/js/config.js';
import { getIslandModule } from '../public/js/world/islands/registry.js';
import { createDuskIsland } from '../public/js/world/islands/duskcrown.js';
import { createCrownLayout } from '../public/js/world/islands/crownLayout.js';
import { buildDuskPlacement } from '../public/js/world/islands/duskPlacement.js';
import { buildDuskFlora } from '../public/js/world/islands/duskFlora.js';
import { buildCrownWater } from '../public/js/world/islands/crownWater.js';
import { buildCrownPlacement, TREE, FAMILY_NAMES, fadeRecord } from '../public/js/world/islands/crownPlacement.js';
import { getCrownTree } from '../public/js/world/islands/crownTreeAssets.js';
import { buildCrownTreeVisuals, crownTreeFade, patchTreeToon, treeMaterials } from '../public/js/world/islands/crownTreeVisuals.js';
import { buildCrownVisuals } from '../public/js/world/islands/crownVisuals.js';
import { crownLayers } from '../public/js/world/islands/crownLayers.js';
import { registerCrownTreeGameplay } from '../public/js/world/islands/duskWorld.js';
import { createWorldVisuals } from '../public/js/world/islandVisuals.js';
import { getColliders } from '../public/js/world/colliders.js';
import { polyDist } from '../public/js/world/islands/scatter.js';
import { duskUniforms } from '../public/js/world/islands/duskAtmosphere.js';
import { windTime } from '../public/js/world/wind.js';

const island = ISLANDS.find((i) => i.id === 'duskcrown'), mod = getIslandModule('duskcrown'), C = mod.crown, ix = island.x, iz = island.z;
const P = buildCrownPlacement(island, mod);
const loc = (t) => ({ lx: t.x - ix, lz: t.z - iz });
// a tree's true horizontal reach: the cached geometry's widest extent from its axis, scaled
const reach = (t) => { const b = getCrownTree(t.variant).geo.boundingBox; return Math.max(Math.abs(b.min.x), b.max.x, Math.abs(b.min.z), b.max.z) * t.s; };

test('the placement is pure and deterministic: a fresh height module gives the identical plan, and the hash is pinned', () => {
  const again = buildCrownPlacement(island, createDuskIsland(island));
  assert.equal(again.hash(), P.hash());
  assert.deepEqual(again.items.map((t) => [t.id, t.variant, t.fam, t.bark, t.x, t.z, t.s, t.rot]), P.items.map((t) => [t.id, t.variant, t.fam, t.bark, t.x, t.z, t.s, t.rot]));
  assert.equal(buildCrownPlacement(island, mod), P, 'cached per height module');
  assert.equal(P.hash(), '90bfa235');
});

test('the marsh and the earlier crown plans are unchanged: marsh placement, marsh flora, crown layout and water hashes', () => {
  assert.equal(buildDuskPlacement(island, mod).hash(), 'a3374631');
  assert.equal(buildDuskFlora(island, mod).hash(), 'dc5f974e');
  assert.equal(createCrownLayout(island, mod.layout).hash(), '5e575684');
  assert.equal(buildCrownWater(island, mod).hash(), 'cde20f85');
});

test('counts, ids, sizes: 90-140 acacias, 8-12 baobabs of which 1-2 are elders', () => {
  assert.ok(P.acacias.length >= 90 && P.acacias.length <= 140, `acacias ${P.acacias.length}`);
  assert.ok(P.baobabs.length >= 8 && P.baobabs.length <= 12, `baobabs ${P.baobabs.length}`);
  const elders = P.baobabs.filter((t) => t.elder);
  assert.ok(elders.length >= 1 && elders.length <= 2 && elders.length === P.elders.length);
  const ids = P.items.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => /^crown-(acacia-\d{3}|baobab-\d{2})$/.test(id)));
  assert.ok(P.items.every((t) => TREE[t.variant] && t.type === TREE[t.variant].type));
  for (const v of ['acacia-flat', 'acacia-tiered', 'acacia-bushy']) assert.ok(P.acacias.some((t) => t.variant === v), v);
  for (const t of P.acacias) {
    assert.ok(t.height >= 5 && t.height <= 9, `${t.id} height ${t.height}`);
    assert.ok(t.canopyR * 2 >= 6 && t.canopyR * 2 <= 11, `${t.id} canopy ${t.canopyR * 2}`);
    assert.ok(Math.abs(t.capTop - t.y - t.height) < 0.02 && t.capUnder < t.capTop);
  }
  for (const t of P.baobabs.filter((b) => !b.elder)) { assert.ok(t.height >= 7 && t.height <= 10.1, `${t.id} ${t.height}`); assert.ok(t.trunkR >= 1.4 && t.trunkR <= 2.6, `${t.id} trunk ${t.trunkR}`); }
  for (const t of elders) assert.ok(t.height >= 12 && t.height <= 14.2, `${t.id} elder ${t.height}`);
  // the cached geometry stands as tall as the table says (the instance scale then gives the heights above)
  for (const v of Object.keys(TREE)) assert.ok(Math.abs(getCrownTree(v).info.top - TREE[v].H) < 0.35, `${v} top ${getCrownTree(v).info.top}`);
});

test('keep-clear: no trunk on water or a river bank, a kopje, a ramp, a sky-fall foot, a reserved lane / spot, Crown Rock or ground steeper than walkable', () => {
  for (const t of P.items) {
    const { lx, lz } = loc(t), r = t.trunkR;
    assert.equal(C.keepClear(lx, lz, r), null, `${t.id}: ${C.keepClear(lx, lz, r)}`);
    assert.equal(mod.groundType(t.x, t.z), 'savanna', t.id);
    assert.ok(mod.walkable(t.x, t.z), t.id);
    assert.ok(Math.abs(mod.height(t.x, t.z) - t.y) < 0.01, t.id);
    const w = C.waterNear(lx, lz);
    assert.ok(!w || w.edge > 3.2 + r, `${t.id} water edge ${w && w.edge}`);
    for (const k of C.kopjes) assert.ok(Math.hypot(lx - k.x, lz - k.z) > k.r * 1.2 + 2 + r, `${t.id} kopje ${k.id}`);
    for (const p of C.pools) assert.ok(Math.hypot(lx - p.x, lz - p.z) > p.r + 6 + r, `${t.id} sky-fall foot ${p.id}`);      // (the sky falls drop straight down at the pools)
    for (const ln of C.lanes) assert.ok(polyDist(ln, lx, lz) > 2 + r, `${t.id} lane`);
    assert.ok(Math.hypot(lx - C.crownRock.x, lz - C.crownRock.z) > 14 + r, `${t.id} Crown Rock`);
    assert.ok(Math.hypot(lx - C.spawn.x, lz - C.spawn.z) > 6 + r && Math.hypot(lx - C.notchTop.x, lz - C.notchTop.z) > 8 + r, `${t.id} spawn / notch`);
    for (let i = 0; i < 8; i++) {                                                  // level, dry, walkable ground round the trunk
      const a = i * Math.PI / 4, px = t.x + Math.cos(a) * (r + 0.8), pz = t.z + Math.sin(a) * (r + 0.8);
      assert.ok(mod.walkable(px, pz) && Math.abs(mod.height(px, pz) - t.y) < 0.9, `${t.id} ring ${i}`);
    }
  }
});

test('no canopy overhangs the rim band, a kopje face or the cliff seen from the marsh; trunks keep a walkable gap', () => {
  for (const t of P.items) {
    const { lx, lz } = loc(t), rr = reach(t);
    assert.ok(C.edgeD(lx, lz) > rr + 0.3 && C.edgeD(lx, lz) >= 6, `${t.id}: edge ${C.edgeD(lx, lz).toFixed(2)} vs canopy reach ${rr.toFixed(2)}`);
    for (const k of C.kopjes) assert.ok(Math.hypot(lx - k.x, lz - k.z) > k.r * 0.9 + 0.5 * t.canopyR, `${t.id} canopy over kopje ${k.id}`);
  }
  for (let i = 0; i < P.items.length; i++) for (let j = i + 1; j < P.items.length; j++) {
    const a = P.items[i], b = P.items[j];
    assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > a.trunkR + b.trunkR + 1.8, `${a.id} / ${b.id} trunks`);
  }
});

test('distribution: plains trees are spread wide with some pairs / trios, riverine trees sit 8-14 u from the water, baobabs stand on swells and kopje feet, elders only at Crown Rock and the edges', () => {
  const zone = (z) => P.items.filter((t) => t.zone === z);
  assert.ok(zone('plains').length >= 25 && zone('plains-group').length >= 5, `plains ${zone('plains').length}, groups ${zone('plains-group').length}`);
  assert.ok(zone('riverine').length >= 25, `riverine ${zone('riverine').length}`);
  for (const t of zone('riverine')) { const w = C.waterNear(loc(t).lx, loc(t).lz); assert.ok(w && w.edge >= 4.4 && w.edge <= 13.01, `${t.id} ${w && w.edge}`); }
  for (const t of zone('plains')) { const w = C.waterNear(loc(t).lx, loc(t).lz); assert.ok(!w || w.edge >= 12.99, `${t.id} is on the plains`); }
  // a plains pair / trio shares a family and stands 6-12 u from its mate
  for (const t of zone('plains-group')) assert.ok(zone('plains').some((o) => o.fam === t.fam && Math.hypot(o.x - t.x, o.z - t.z) < 20), `${t.id} has a mate`);
  const swell = zone('swell'), kopje = zone('kopje');
  assert.ok(swell.length >= 2 && kopje.length >= 2 && swell.length + kopje.length >= 6, `swell ${swell.length}, kopje ${kopje.length}`);
  for (const t of swell) assert.ok(C.reliefAt(loc(t).lx, loc(t).lz) > 49.5, `${t.id} is on a swell`);
  for (const t of kopje) assert.ok(C.kopjes.some((k) => k.id !== C.crownRock.id && Math.hypot(loc(t).lx - k.x, loc(t).lz - k.z) < k.r * 1.2 + 2 + t.trunkR + 8), `${t.id} is at a kopje foot`);
  // elders
  for (const t of P.elders) {
    const { lx, lz } = loc(t);
    const atRock = Math.hypot(lx - C.crownRock.x, lz - C.crownRock.z) < 30, atEdge = C.edgeD(lx, lz) < 20;
    assert.ok(atRock || atEdge, `${t.id} elder is neither at Crown Rock's foot nor near an edge`);
    for (const ln of C.lanes) assert.ok(polyDist(ln, lx, lz) > t.canopyR, `${t.id} elder canopy over a lane`);
    assert.ok(Math.hypot(lx - C.spawn.x, lz - C.spawn.z) > 30);
  }
  assert.ok(P.elders.some((t) => t.zone === 'elder-rock'));
  assert.ok(P.baobabs.filter((t) => !t.elder).every((t) => ['swell', 'kopje'].includes(t.zone)));
});

test('colour families: the spec table, about 45 % of acacias magenta or teal, riverine groups more teal and violet, baobabs rose / lavender with teal or violet tufts', () => {
  assert.deepEqual(FAMILY_NAMES, ['magenta', 'teal', 'violet', 'tangerine']);
  const fam = CROWN_TREES.families;
  assert.deepEqual(fam.map((f) => [f.top, f.rim]), [['#ff5fa8', '#ffb3d9'], ['#36d6c3', '#a8f5e6'], ['#9a6cff', '#d4bfff'], ['#ffa23b', '#ffe08a']]);
  assert.deepEqual(CROWN_TREES.barks, ['#c7b8e8', '#6f84c8', '#efe3cf', '#7a5aa8', '#e3a3a0', '#a99ad6']);
  const share = P.acacias.filter((t) => t.family === 'magenta' || t.family === 'teal').length / P.acacias.length;
  assert.ok(share >= 0.38 && share <= 0.56, `magenta + teal share ${share.toFixed(2)}`);
  for (const f of FAMILY_NAMES) assert.ok(P.acacias.some((t) => t.family === f), `${f} present`);
  const cool = (l) => l.filter((t) => t.family === 'teal' || t.family === 'violet').length / Math.max(1, l.length);
  assert.ok(cool(P.acacias.filter((t) => t.zone === 'riverine')) > cool(P.acacias.filter((t) => t.zone.startsWith('plains'))), 'more teal and violet along the rivers');
  for (const t of P.acacias) assert.equal(t.bark, t.fam, `${t.id}: the trunk colour belongs to the canopy family`);
  for (const t of P.baobabs) { assert.ok(t.bark === 4 || t.bark === 5, `${t.id} bark`); assert.ok(t.family === 'teal' || t.family === 'violet', `${t.id} tufts`); }
  assert.ok(P.baobabs.some((t) => t.bark === 4) && P.baobabs.some((t) => t.bark === 5));
});

test('the trunk colliders: one per tree, registered once (a second call and every world.rebuild add or lose nothing)', () => {
  const d = registerCrownTreeGameplay(island);
  assert.equal(d.colliders.length, P.items.length);
  assert.equal(d.placement, P);
  const all = getColliders();
  P.items.forEach((t, i) => { const c = d.colliders[i]; assert.equal(c.x, t.x); assert.equal(c.z, t.z); assert.equal(c.r, t.trunkR); assert.equal(c.owner, t.id); assert.ok(all.includes(c)); });
  const n = all.length;
  assert.equal(registerCrownTreeGameplay(island), d); assert.equal(getColliders().length, n);
  assert.equal(d.summary().colliders, P.items.length);

  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(CAMERA_FOV, 16 / 9, 0.1, 600);
  camera.position.set(ix, 10, iz + 90); camera.lookAt(ix, 0, iz + 70);
  const homeProps = { group: new THREE.Group(), handles: { trees: [], palms: [] } };
  const previousDocument = globalThis.document, previousPath = globalThis.Path2D;
  globalThis.Path2D = class {};
  const context = new Proxy({}, { get: (o, key) => key in o ? o[key] : key === 'measureText' ? () => ({ width: 40 }) : key.startsWith('create') ? () => ({ addColorStop() {} }) : () => {} });
  globalThis.document = { createElement: () => ({ getContext: () => context }) };
  const world = createWorldVisuals({ scene, camera, homeProps }), m = getColliders().length, initial = world.visuals.duskcrown.summary();
  assert.equal(getColliders().filter((c) => /^crown-/.test(c.owner || '')).length, P.items.length, 'exactly one collider per tree in the world');
  assert.ok(initial.crownTrees && initial.crownTrees.items === P.items.length);
  for (let k = 0; k < 3; k++) {
    assert.equal(world.rebuild('duskcrown'), true);
    assert.deepEqual(world.visuals.duskcrown.summary(), initial); assert.equal(getColliders().length, m);
    const vis = world.visuals.duskcrown;
    assert.ok(vis.full.getObjectByName('crown-trees') !== undefined && vis.far.getObjectByName('crown-far-trees') !== undefined);
    let groups = 0; world.root.traverse((o) => { if (o.name === 'crown-trees') groups++; }); assert.equal(groups, 1, 'one tree group after a rebuild');
    assert.equal(crownLayers.extras.size, 1, 'the rebuilt trees replaced the old ones in the layer gate');
  }
  for (const v of Object.values(world.visuals)) v.dispose(); world.root.removeFromParent();
  assert.equal(crownLayers.extras.size, 0);
  if (previousPath === undefined) delete globalThis.Path2D; else globalThis.Path2D = previousPath;
  if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
  crownLayers.setLid(true);
});

test('trees follow the cloud lid: hidden while it is drawn (no fade work either), drawn when it is off, pinned by crownLayers.force', () => {
  const v = buildCrownTreeVisuals(island, P);
  assert.equal(crownLayers.setLid(true), false); assert.equal(v.group.visible, false); assert.equal(v.far.visible, false);
  const under = P.items[0], pt = { x: under.x, y: under.y + 1.1, z: under.z };
  assert.equal(v.fadeStep(1, { x: under.x, y: under.y + 9, z: under.z + 13.5 }, [pt], true), 0, 'nothing fades while hidden');
  assert.equal(crownLayers.setLid(false), true); assert.equal(v.group.visible, true); assert.equal(v.far.visible, true);
  assert.equal(crownLayers.force(false), false); assert.equal(v.group.visible, false); assert.equal(crownLayers.force(true), true); assert.equal(v.group.visible, true);
  assert.equal(crownLayers.force(null), true); crownLayers.setLid(true); assert.equal(v.group.visible, false);
  // the crown visuals and the trees follow the same switch
  const w = buildCrownVisuals(island, mod); crownLayers.setLid(false); assert.equal(w.group.visible, true); assert.equal(v.group.visible, true);
  crownLayers.setLid(true); assert.equal(w.group.visible, false); assert.equal(v.group.visible, false);
  v.dispose(); assert.equal(crownLayers.extras.size, 0); assert.equal(crownTreeFade.current, null);
  const x = buildCrownTreeVisuals(island, P); assert.equal(x.group.visible, false, 'a rebuild attaches at the current state'); crownLayers.setLid(false); assert.equal(x.group.visible, true);
  x.dispose(); w.dispose(); crownLayers.setLid(true);
});

test('the canopy fade: a tree over a player, or between the camera and one, fades (also at the widest zoom); trunks never fade; fade off / hidden = nothing', () => {
  crownLayers.setLid(false);
  const v = buildCrownTreeVisuals(island, P);
  assert.equal(v.caps.length, P.items.length);
  const recs = P.items.map(fadeRecord);
  assert.ok(recs.every((r) => r.y1 > r.y0 && r.r > 2));
  const t = P.acacias.find((a) => a.variant === 'acacia-flat'), under = { x: t.x + t.canopyR * 0.3, y: t.y + 1.1, z: t.z };
  for (const zoom of [1, 2.2]) {
    const cam = { x: under.x, y: under.y + 8.5 * zoom, z: under.z + 13.5 * zoom };
    assert.ok(v.fadeStep(1e3, cam, [under], true) >= 1, `zoom ${zoom}`);
    const cap = v.caps.find((c) => c.id === t.id); assert.equal(cap.cur, 1); assert.equal(cap.inst.getX(cap.i), 1);
    assert.ok(v.caps.filter((c) => c.cur > 0).length < 6, 'only the covering canopies fade');
    assert.equal(v.fadeStep(1e3, cam, [], true), 0, 'no local player: nothing fades'); assert.equal(cap.cur, 0);
  }
  const cam = { x: under.x, y: under.y + 8.5, z: under.z + 13.5 };
  assert.ok(v.fadeStep(1e3, cam, [under], true) >= 1); assert.equal(v.fadeStep(1e3, cam, [under], false), 0, 'fade off');
  // a far player does not fade it
  assert.equal(v.fadeStep(1e3, { x: 0, y: 99, z: 0 }, [{ x: 5000, y: 50, z: 5000 }], true), 0);
  // the controller (main.js)
  assert.equal(crownTreeFade.current, v); crownTreeFade.enabled = true;
  assert.ok(crownTreeFade.settle(cam, [under]) >= 1); crownTreeFade.enabled = false; assert.equal(crownTreeFade.update(1, cam, [under]), 0); crownTreeFade.enabled = true;
  // 0.25 s for the full swing
  let c = 0, steps = 0; const cp = v.caps.find((k) => k.id === t.id);
  v.fadeStep(1e3, cam, [], true); assert.equal(cp.cur, 0);
  while (cp.cur < 1 && steps < 100) { v.fadeStep(1 / 60, cam, [under], true); steps++; c = cp.cur; }
  assert.ok(steps >= 14 && steps <= 16 && c === 1, `fade-in took ${steps} frames`);
  v.dispose(); crownLayers.setLid(true);
});

test('geometry: roles, colours and hulls are consistent, trunks never fade and canopies sit at the planned height', () => {
  for (const variant of Object.keys(TREE)) {
    const { geo, outlineGeo, info } = getCrownTree(variant), pos = geo.attributes.position, role = geo.attributes.aRole, col = geo.attributes.color;
    assert.equal(geo.index, null); assert.ok(geo.attributes.normal && !geo.attributes.uv);
    assert.equal(col.itemSize, 3); assert.equal(role.count, pos.count);
    let trunk = 0, canopy = 0, lowestCanopy = Infinity;
    const wantRole = TREE[variant].type === 'acacia' ? 1 : 2;
    for (let i = 0; i < pos.count; i++) {
      const r = role.getX(i);
      assert.ok(r === 0 || r === wantRole, `${variant} role ${r}`);
      for (const v of [pos.getX(i), pos.getY(i), pos.getZ(i), col.getX(i), col.getY(i)]) assert.ok(Number.isFinite(v));
      assert.ok(col.getX(i) >= 0 && col.getX(i) <= 1.3 && col.getY(i) >= 0 && col.getY(i) <= 1.3);
      if (r === 0) trunk++; else { canopy++; lowestCanopy = Math.min(lowestCanopy, pos.getY(i)); }
    }
    assert.ok(trunk > 50 && canopy > 50, `${variant} has a trunk and a canopy`);
    assert.ok(lowestCanopy >= TREE[variant].capUnder - 1.6, `${variant}: the canopy starts at ${lowestCanopy} (table ${TREE[variant].capUnder})`);
    assert.ok(info.triangles > 150 && info.triangles < 2600 && info.hullTriangles > 100, `${variant} ${info.triangles} / ${info.hullTriangles} triangles`);
    assert.equal(outlineGeo.attributes.aRole.count, outlineGeo.attributes.position.count);
    const faded = Array.from(outlineGeo.attributes.aRole.array).filter((v) => v === 1).length;
    assert.ok(faded > 20 && faded < outlineGeo.attributes.position.count, `${variant} hull fade vertices ${faded}`);
    assert.equal(getCrownTree(variant), getCrownTree(variant), 'cached');
  }
  // the baobab trunk is the feature: fat, with 8 grooves (the darker columns) and a lighter shade up the trunk
  const b = getCrownTree('baobab').geo, bp = b.attributes.position, bc = b.attributes.color, bro = b.attributes.aRole;
  let belly = 0, lowShade = 0, lowN = 0, hiShade = 0, hiN = 0;
  for (let i = 0; i < bp.count; i++) if (bro.getX(i) === 0 && bp.getY(i) > 0.5 && bp.getY(i) < 6) {
    belly = Math.max(belly, Math.hypot(bp.getX(i), bp.getZ(i)));
    if (bp.getY(i) < 2) { lowShade += bc.getX(i); lowN++; } else if (bp.getY(i) > 4) { hiShade += bc.getX(i); hiN++; }
  }
  assert.ok(belly > 1.9 && belly < 2.4, `belly ${belly}`);
  assert.ok(hiShade / hiN > lowShade / lowN, 'the bark gets lighter up the trunk (two-tone gradient)');
});

test('programs and materials: ONE tree program + ONE outline program, the spec colour tables, sway on the shared wind clock, fade dither and night speckles on uCrownNight', () => {
  const { solidMat, outlineMat } = treeMaterials();
  assert.equal(treeMaterials().solidMat, solidMat);
  assert.equal(solidMat.customProgramCacheKey(), 'crownTree'); assert.equal(outlineMat.customProgramCacheKey(), 'crownTreeOutline');
  const fake = { uniforms: {}, vertexShader: '#include <common>\n#include <color_vertex>\n#include <project_vertex>', fragmentShader: '#include <common>\n#include <clipping_planes_fragment>\n#include <emissivemap_fragment>' };
  solidMat.onBeforeCompile(fake);
  assert.equal(fake.uniforms.uCrownNight, duskUniforms.uCrownNight, 'night speckles read the crown-night uniform');
  assert.equal(fake.uniforms.uWindTime, windTime, 'sway reads the shared props wind clock');
  const lin = (hex) => { const c = new THREE.Color(hex); return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`; };
  for (const f of CROWN_TREES.families) { assert.ok(fake.vertexShader.includes(lin(f.top)), f.top); assert.ok(fake.vertexShader.includes(lin(f.rim)), f.rim); }
  for (const b of CROWN_TREES.barks) assert.ok(fake.vertexShader.includes(lin(b)), b);
  assert.ok(fake.vertexShader.includes('mvPosition.xyz +=') && fake.vertexShader.includes('aRole > 0.5'), 'sway touches canopies only');
  assert.ok(fake.fragmentShader.includes('discard') && fake.fragmentShader.includes('uCrownNight'));
  const fakeHull = { uniforms: {}, vertexShader: '#include <common>\n#include <begin_vertex>\n#include <project_vertex>', fragmentShader: '#include <common>\n#include <clipping_planes_fragment>' };
  outlineMat.onBeforeCompile(fakeHull);
  assert.ok(fakeHull.vertexShader.includes('mvPosition.xyz +=') && fakeHull.fragmentShader.includes('discard'), 'the hull sways and dithers with its canopy');
  assert.equal(fakeHull.uniforms.uWindTime, windTime);
  assert.equal(typeof patchTreeToon, 'function');
  assert.ok(duskUniforms.uCrownNight && typeof duskUniforms.uCrownNight.value === 'number');
});

test('visuals: chunked instanced layers with hulls, trees cast / receive the sun shadow, the far blob mesh, identical rebuilds', () => {
  const a = buildCrownTreeVisuals(island, P), s1 = a.summary();
  assert.equal(s1.items, P.items.length);
  assert.equal(Object.values(s1.byVariant).reduce((n, v) => n + v, 0), P.items.length);
  const solids = [], hulls = [], mats = new Set();
  a.group.traverse((o) => { if (o.isInstancedMesh) { mats.add(o.material); (o.name.includes('outline') ? hulls : solids).push(o); } });
  assert.equal(solids.length, hulls.length); assert.equal(solids.length * 2, s1.meshes);
  assert.equal(mats.size, 2, 'two materials: the tree toon and its hull');
  for (const m of solids) { assert.equal(m.castShadow, true); assert.equal(m.receiveShadow, true); assert.ok(m.count > 0 && m.geometry.attributes.iInst.itemSize === 4); }
  for (const m of hulls) { assert.equal(m.castShadow, false); assert.equal(m.renderOrder, -1); }
  assert.equal(solids.reduce((n, m) => n + m.count, 0), P.items.length);
  // matrices: each instance sits at its tree, at its scale
  const t = P.items[0], m0 = solids.find((m) => m.name.startsWith(`crown-${t.variant}-`) && m.count > 0), mat = new THREE.Matrix4(), p = new THREE.Vector3(), sc = new THREE.Vector3(), q = new THREE.Quaternion();
  let found = false;
  for (const m of solids.filter((x) => x.name.startsWith(`crown-${t.variant}-`))) for (let i = 0; i < m.count; i++) { m.getMatrixAt(i, mat); mat.decompose(p, q, sc); if (Math.abs(p.x - t.x) < 0.01 && Math.abs(p.z - t.z) < 0.01) { found = true; assert.ok(Math.abs(sc.x - t.s) < 1e-5 && Math.abs(p.y - t.y) < 0.01); } }
  assert.ok(found && m0);
  // the far view: one merged mesh, a few thousand triangles
  assert.equal(a.far.children.length, 1); assert.ok(s1.farTriangles > 500 && s1.farTriangles < 12000, `far ${s1.farTriangles}`);
  a.dispose();
  const b = buildCrownTreeVisuals(island, P); assert.deepEqual(b.summary(), s1); b.dispose();
});

test('Node frustum budget (1280x720 follow camera, lid off) at the three crown spots: added meshes / triangles of the trees', () => {
  crownLayers.setLid(false);
  const v = buildCrownTreeVisuals(island, P), spots = mod.spots(), report = {};
  const submitted = (root, cam) => {
    cam.updateMatrixWorld(true); const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    let calls = 0, tris = 0, shadowCalls = 0;
    root.updateMatrixWorld(true);
    root.traverseVisible((o) => {
      if (!o.isInstancedMesh || !fr.intersectsObject(o)) return;
      const g = o.geometry, perTri = (g.index ? g.index.count : g.attributes.position.count) / 3, mat = new THREE.Matrix4(), sph = new THREE.Sphere(), bs = g.boundingSphere;
      let n = 0;
      for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, mat); sph.copy(bs).applyMatrix4(mat); sph.applyMatrix4(o.matrixWorld); if (fr.intersectsSphere(sph)) n++; }
      if (n) { calls++; tris += n * perTri; if (o.castShadow) shadowCalls++; }
    });
    return { calls, tris, shadowCalls };
  };
  const camAt = (pt, zoom) => { const cam = new THREE.PerspectiveCamera(CAMERA_FOV, 16 / 9, 0.1, 600), y = mod.height(pt.x, pt.z); cam.position.set(pt.x, y + 8.5 * zoom, pt.z + 13.5 * zoom); cam.lookAt(pt.x, y + 1, pt.z); return cam; };
  for (const k of ['duskCrown', 'crownRock', 'crownFalls']) for (const zoom of [1, 2.2]) {
    const r = submitted(v.group, camAt(spots[k], zoom)); report[`${k} x${zoom}`] = r;
    assert.ok(r.calls <= 24 && r.tris < 60000, `${k} x${zoom}: ${JSON.stringify(r)}`);
  }
  for (const [k, pt] of Object.entries(P.spots)) if (pt) report[`tree:${k}`] = submitted(v.group, camAt(pt, 1));
  crownLayers.setLid(true);                                          // the marsh: the lid hides the trees, nothing is submitted
  for (const k of ['duskLanding', 'duskCliff', 'duskLagoon', 'duskWest']) assert.deepEqual(submitted(v.group, camAt(spots[k], 1)), { calls: 0, tris: 0, shadowCalls: 0 }, k);
  console.log('85d Node frustum submissions of the trees (instanced meshes counted only if an instance is in view; tris are instances in view x geometry; no GPU):', JSON.stringify(report));
  v.dispose();
});

test('the debug stand points are walkable and clear of every trunk', () => {
  for (const [k, s] of Object.entries(P.spots)) {
    assert.ok(s, k); assert.ok(mod.walkable(s.x, s.z), k);
    assert.ok(P.items.every((t) => Math.hypot(s.x - t.x, s.z - t.z) > t.trunkR + 1.3), k);
  }
});
