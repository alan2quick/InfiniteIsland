// Step 85c: the Crownlands' elevated water, sky / rim / sea falls and floating-island meshes. The pure plans (crownWater.js, crownSky.js), the Node-built meshes (crownVisuals.js), the layer gate that follows
// the cloud lid (crownLayers.js), rebuild safety and a Node frustum budget at the three crown spots. No GPU: shader programs are checked as source / material identity only.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ISLANDS, WATER_LEVEL, CAMERA_FOV, DUSK_WATER, CROWN_WATER } from '../public/js/config.js';
import { getIslandModule } from '../public/js/world/islands/registry.js';
import { createDuskIsland } from '../public/js/world/islands/duskcrown.js';
import { createDuskLayout } from '../public/js/world/islands/duskLayout.js';
import { createCrownLayout } from '../public/js/world/islands/crownLayout.js';
import { buildDuskFlora } from '../public/js/world/islands/duskFlora.js';
import { buildDuskSmallVisuals, duskFallMaterial } from '../public/js/world/islands/duskSmallVisuals.js';
import { buildCrownWater, rimPrefix } from '../public/js/world/islands/crownWater.js';
import { buildSkyMeshes } from '../public/js/world/islands/crownSky.js';
import { buildCrownVisuals, crownWaterMaterial, crownFallMaterial } from '../public/js/world/islands/crownVisuals.js';
import { crownLayers } from '../public/js/world/islands/crownLayers.js';
import { createDuskAtmosphere } from '../public/js/world/islands/duskAtmosphere.js';
import { getColliders } from '../public/js/world/colliders.js';
import { getInteractables } from '../public/js/world/interactables.js';
import { createWorldVisuals } from '../public/js/world/islandVisuals.js';
import { VERTEX_TOON } from '../public/js/render/geo.js';

const island = ISLANDS.find((i) => i.id === 'duskcrown'), mod = getIslandModule('duskcrown'), C = mod.crown, ix = island.x, iz = island.z;
const W = buildCrownWater(island, mod), flora = buildDuskFlora(island, mod);
const near = (a, b, e, msg) => assert.ok(Math.abs(a - b) <= e, `${msg || ''} ${a} vs ${b}`);

test('the water plan is deterministic and hash-pinned; the marsh flora hash is still the 69d one', () => {
  const copy = buildCrownWater(island, createDuskIsland(island));
  assert.equal(copy.hash(), W.hash()); assert.equal(buildCrownWater(island, mod), W);
  assert.equal(W.hash(), 'cde20f85');
  const s = W.summary();
  assert.deepEqual([s.pools, s.ribbons, s.rivers, s.streams, s.spills, s.skyFalls, s.rimFalls, s.seaFalls, s.summitPools], [8, 8, 3, 2, 3, 8, 3, 3, 8]);
  assert.ok(s.riffles >= 8, `${s.riffles} riffles`);
  assert.equal(flora.hash(), 'dc5f974e');
});

test('pool discs sit at the pool level, trace the shore and never hang far over the ground', () => {
  for (const p of W.pools) {
    const pool = C.pools.find((q) => q.id === p.pool);
    assert.equal(p.y, pool.surf); assert.equal(p.x, ix + pool.x); assert.equal(p.z, iz + pool.z);
    assert.ok(C.topAt(pool.x, pool.z) < pool.surf - 1, `${p.id} has a bowl`);
    assert.ok(p.ring.length >= 24);
    for (const [x, z] of p.ring) {
      const g = C.topAt(x - ix, z - iz);
      assert.ok(p.y - g < 0.7, `${p.id}: the rim hangs ${(p.y - g).toFixed(2)} over the ground`);
    }
  }
});

test('river ribbons follow the 85a surface heights: non-increasing, exact at the planned points, never under the ground', () => {
  for (const rb of W.rivers) {
    const r = C.rivers.find((q) => q.id === rb.river), s = rb.samples;
    assert.ok(s.length >= 8, rb.id);
    for (let i = 1; i < s.length; i++) assert.ok(s[i].y <= s[i - 1].y + 1e-6, `${rb.id} #${i}`);
    assert.ok(s[0].y <= C.pools.find((q) => q.id === r.pool).surf + 1e-6);
    let matched = 0;
    r.pts.forEach(([x, z], k) => { const q = s.find((m) => Math.hypot(m.x - ix - x, m.z - iz - z) < 0.02); if (q) { matched++; near(q.y, r.surf[k], 0.002, `${rb.id} pt ${k}`); } });
    assert.ok(matched >= 2, `${rb.id}: ${matched} planned points kept`);
    for (const q of s) {
      assert.ok(q.y >= C.topAt(q.x - ix, q.z - iz) - 0.05, `${rb.id}: water under the bed at ${q.x},${q.z}`);
      assert.ok(q.hwL >= 1.0 && q.hwL <= 5 && q.hwR >= 1.0 && q.hwR <= 5);
      assert.ok(q.foam >= 0 && q.foam <= 1);
    }
    if (r.kind === 'river' || r.kind === 'spill') assert.equal(rb.lip, true, `${rb.id} ends at a lip`);
  }
  assert.ok(W.rivers.some((r) => r.samples.some((q) => q.foam > 0.9)), 'there are white riffle ribbons');
});

test('sky falls drop straight from each island spill point to its plunge pool, thin, bright and tall', () => {
  const spills = C.skyIslands.flatMap((s) => s.spills.map((sp) => ({ s, sp })));
  assert.equal(W.skyFalls.length, spills.length);
  for (const { s, sp } of spills) {
    const f = W.skyFalls.find((q) => q.id.startsWith(s.id) && q.pool === sp.pool && Math.abs(q.x - ix - sp.x) < 0.01);
    assert.ok(f, sp.id);
    const pool = C.pools.find((q) => q.id === sp.pool);
    near(f.x, ix + sp.x, 0.01); near(f.z, iz + sp.z, 0.01); assert.equal(f.yTop, sp.y); assert.equal(f.yBottom, pool.surf);
    near(f.foot.x, ix + pool.x, 0.01); near(f.foot.z, iz + pool.z, 0.01); assert.equal(f.foot.y, pool.surf);
    assert.ok(Math.hypot(f.x - f.foot.x, f.z - f.foot.z) < 0.01, 'directly above the pool');
    assert.ok(f.width >= CROWN_WATER.fall.width[0] && f.width <= CROWN_WATER.fall.width[1], `${f.id} width ${f.width}`);
    assert.ok(f.yTop - f.yBottom >= 40, `${f.id} is very tall`);
  }
  // the mesh: every strip is vertical (the same x, z on every row)
  const v = buildCrownVisuals(island, mod), geo = v.group.getObjectByName('crown-sky-falls').geometry, p = geo.attributes.position;
  W.skyFalls.forEach((f, i) => {
    const base = i * 24;
    for (let strip = 0; strip < 2; strip++) for (let row = 0; row < 3; row++) {
      const k = base + strip * 6 + row * 2;
      near((p.getX(k) + p.getX(k + 1)) / 2, f.x, 1e-3); near((p.getZ(k) + p.getZ(k + 1)) / 2, f.z, 1e-3);
      near(p.getY(k), [f.yTop, Math.max(f.yBottom + CROWN_WATER.fall.tail + 2, f.yBottom + 14), f.yBottom + 0.05][row], 1e-3);
    }
  });
  v.dispose();
});

test('rim falls extend the existing marsh falls up to the river lip: tops match the river surface, bottoms are the marsh fall, and the marsh mesh gains no mesh', () => {
  assert.equal(W.rimFalls.length, 3);
  for (const f of W.rimFalls) {
    const river = C.rivers.find((q) => q.outlet.fall === f.fall), marsh = flora.falls.find((q) => q.id === f.fall);
    near(f.top.y, river.surf[river.surf.length - 1], 0.1, 'rim top vs the river outlet surface');
    near(f.top.x - ix, river.outlet.x, 2, 'rim top x'); assert.deepEqual(f.joins, { x: +marsh.path[0].x.toFixed(3), y: marsh.path[0].y, z: +marsh.path[0].z.toFixed(3) });
    near(f.joins.x, marsh.path[0].x, 1e-3); near(f.joins.z, marsh.path[0].z, 1e-3);
    assert.deepEqual(f.prefix[0], f.top); assert.ok(Math.hypot(f.prefix.at(-1).x - f.joins.x, f.prefix.at(-1).z - f.joins.z) < 2.5);
    for (let i = 1; i < f.prefix.length; i++) assert.ok(f.prefix[i].y <= f.prefix[i - 1].y);
    assert.ok(f.prefix.at(-1).y >= f.joins.y - 1e-6, 'it only ever runs down into the marsh fall');
    assert.deepEqual(rimPrefix(island, mod, f.fall), { prefix: f.prefix, hw: f.hw });
  }
  assert.equal(rimPrefix(island, mod, 'nope'), null);
  // the merged marsh fall mesh: the extension is in the SAME mesh, the marsh fall's own vertices (all but the first row) are unchanged
  const small = buildDuskSmallVisuals(island, flora), mesh = small.group.getObjectByName('dusk-falls-and-mist'), p = mesh.geometry.attributes.position;
  let off = 0;
  for (const marsh of flora.falls) {
    const rim = W.rimFalls.find((q) => q.fall === marsh.id), lead = rim.prefix.length;
    for (let i = 1; i < marsh.path.length - 1; i++) {                          // (interior rows: their tangents never saw the prefix)
      const k = off + (lead + i) * 2, q = marsh.path[i], a = marsh.path[i - 1], b = marsh.path[i + 1];
      let tx = b.x - a.x, tz = b.z - a.z; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      near(p.getX(k), q.x - tz * DUSK_WATER.fallWidth, 1e-4); near(p.getZ(k), q.z + tx * DUSK_WATER.fallWidth, 1e-4); near(p.getY(k), q.y, 1e-4);
    }
    const k0 = off + lead * 2, q0 = marsh.path[0];
    near((p.getX(k0) + p.getX(k0 + 1)) / 2, q0.x, 1e-4); near(p.getY(k0), q0.y, 1e-4);
    off += (marsh.path.length + lead) * 2 + 12;
  }
  assert.equal(p.count, off, 'one merged mesh: the rim rows are the only vertices added');
  assert.equal(small.group.children.filter((o) => o.name === 'dusk-falls-and-mist').length, 1);
  assert.equal(mesh.material, duskFallMaterial(), 'the rim falls reuse the 69d fall program');
  small.dispose();
});

test('sea-cliff falls run from the river lip down the sea cliff to the sea, with foot mist', () => {
  assert.equal(W.seaFalls.length, 3);
  for (const f of W.seaFalls) {
    const rb = W.rivers.find((q) => q.id === f.river), lip = rb.samples.at(-1);
    assert.equal(rb.outlet.type, 'sea');
    near(f.path[0].y, lip.y, 1e-6); near(f.path[0].x, lip.x, 1e-6);
    for (let i = 1; i < f.path.length; i++) assert.ok(f.path[i].y < f.path[i - 1].y, `${f.id} #${i}`);
    near(f.foot.y, WATER_LEVEL + 0.04, 1e-6); assert.ok(mod.height(f.foot.x, f.foot.z) < 0.6, `${f.id} reaches the sea (${mod.height(f.foot.x, f.foot.z).toFixed(2)})`);
    const e = 0.5, L = mod.layout, lx = f.path[0].x - ix, lz = f.path[0].z - iz, gx = L.coastT(lx + e, lz) - L.coastT(lx - e, lz), gz = L.coastT(lx, lz + e) - L.coastT(lx, lz - e), gl = Math.hypot(gx, gz);
    for (let i = 1; i < f.path.length - 1; i++) {                          // (the strip sits 0.22 u outside the wall: the wall surface is within 0.5 u of it along the inland normal, at the same height)
      let best = Infinity; for (let t = 0; t <= 0.5; t += 0.02) best = Math.min(best, Math.abs(mod.height(f.path[i].x + gx / gl * t, f.path[i].z + gz / gl * t) - f.path[i].y));
      assert.ok(best < 0.4, `${f.id} hugs the cliff at #${i}: ${best.toFixed(2)}`);
    }
    assert.ok(f.path.at(-1).tail > 0.9 && f.path[0].tail === 0);
  }
});

test('the floating islands are deterministic meshes: hash-pinned, finite, six islands + twelve rocks, with a smaller far version', () => {
  const fresh = createDuskIsland(island), a = buildSkyMeshes(island, fresh.crown), b = buildSkyMeshes(island, createCrownLayout(island, createDuskLayout(island)));
  assert.equal(a.hash(), b.hash()); assert.equal(buildSkyMeshes(island, mod.crown).hash(), a.hash()); assert.equal(a.hash(), 'fe686bbe');
  const s = a.summary();
  assert.equal(s.islands, 6); assert.equal(s.rocks, 12);
  assert.ok(s.triangles > 3000 && s.triangles < 6000 && s.farTriangles < s.triangles / 5, JSON.stringify(s));
  for (const arr of [a.full.positions, a.full.colors, a.far.positions, a.far.colors, a.full.hullPositions]) for (const v of arr) assert.ok(Number.isFinite(v));
  for (const i of a.full.hullIndices) assert.ok(i * 3 < a.full.hullPositions.length);
  // each island's top and tip are where the plan says (within the ragged jitter)
  for (const sk of C.skyIslands) {
    let top = -Infinity, bottom = Infinity;
    const p = a.full.positions;
    for (let i = 0; i < p.length; i += 3) {
      const d = Math.hypot(p[i] - ix - sk.x, p[i + 2] - iz - sk.z);
      if (d < sk.radius * 0.5 && p[i + 1] > sk.top - 3 && p[i + 1] < sk.top + 1.5) top = Math.max(top, p[i + 1]);        // (the flat grassy top near the middle)
      if (d < 2.5 && p[i + 1] > sk.underside - 3 && p[i + 1] < sk.underside + 3) bottom = Math.min(bottom, p[i + 1]);    // (the tip)
    }
    near(top, sk.top, 0.8, `${sk.id} top`); assert.ok(bottom >= sk.underside - 1.5 && bottom <= sk.underside + 1.5, `${sk.id} tip ${bottom} vs ${sk.underside}`);
    assert.ok(sk.top - sk.depth - sk.groundMax >= 40, `${sk.id} underside is 40 u above the ground`);
  }
});

test('the crown layers follow the cloud lid: hidden while it is drawn, drawn when it is off; the cliff falls are always drawn', () => {
  const v = buildCrownVisuals(island, mod);
  assert.equal(crownLayers.setLid(true), false); assert.equal(v.group.visible, false); assert.equal(v.far.visible, false); assert.equal(v.fixed.visible, true); assert.equal(v.farFixed.visible, true);
  assert.equal(v.summary().visible, false);
  assert.equal(crownLayers.setLid(false), true); assert.equal(v.group.visible, true); assert.equal(v.far.visible, true); assert.equal(v.fixed.visible, true);
  assert.equal(crownLayers.force(false), false); assert.equal(v.group.visible, false); assert.equal(crownLayers.force(true), true); assert.equal(v.group.visible, true);
  assert.equal(crownLayers.force(null), true); crownLayers.setLid(true); assert.equal(v.group.visible, false);
  // the real lid object drives it
  const scene = new THREE.Scene(), fx = createDuskAtmosphere({ scene, island });
  assert.equal(fx.lid(false), false); assert.equal(crownLayers.visible, true); assert.equal(v.group.visible, true);
  assert.equal(fx.lid(true), true); assert.equal(crownLayers.visible, false); assert.equal(v.group.visible, false);
  // a rebuild attaches at the current state
  v.dispose(); assert.equal(crownLayers.current, null);
  const w = buildCrownVisuals(island, mod); assert.equal(w.group.visible, false); fx.lid(false); assert.equal(w.group.visible, true);
  fx.dispose(); w.dispose(); crownLayers.setLid(true);
});

test('programs: one water program for every plateau surface, one fall program for sky + sea falls, the rim falls reuse the 69d fall program', () => {
  const v = buildCrownVisuals(island, mod), mats = new Set();
  [v.group, v.fixed, v.far, v.farFixed].forEach((g) => g.traverse((o) => { if (o.isMesh) mats.add(o.material); }));
  const water = [], fall = [];
  v.group.traverse((o) => { if (o.isMesh && o.name.includes('water')) water.push(o); if (o.isMesh && o.name.includes('falls')) fall.push(o); });
  assert.ok(water.length >= 2); assert.ok(water.every((o) => o.material === crownWaterMaterial()));
  assert.ok([...fall, ...v.fixed.children].every((o) => o.material === crownFallMaterial()));
  assert.ok(mats.has(VERTEX_TOON));
  assert.ok(mats.size <= 4, `${mats.size} materials`);
  assert.notEqual(crownFallMaterial(), duskFallMaterial());
  const m = crownWaterMaterial();
  assert.ok(m.fragmentShader.includes('uShallow') && m.fragmentShader.includes('vFoam'));
  assert.equal(m.uniforms.uShallow.value.getHexString(), '4fd8e8'); assert.equal(m.uniforms.uDeep.value.getHexString(), '2a8fd0');
  assert.equal(m.uniforms.uTime, mod && crownFallMaterial().uniforms.uTime, 'one water clock');
  for (const o of [...water, ...fall]) { assert.equal(o.castShadow, false); assert.equal(o.receiveShadow, false); }
  v.dispose();
});

test('building the crown visuals (and world.rebuild) registers nothing and leaves identical meshes', () => {
  const colliders = getColliders().length, items = getInteractables().length;
  const a = buildCrownVisuals(island, mod), s1 = a.summary(); a.dispose();
  const b = buildCrownVisuals(island, mod), s2 = b.summary(); b.dispose();
  assert.deepEqual(s2, s1);
  assert.equal(getColliders().length, colliders); assert.equal(getInteractables().length, items);

  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(CAMERA_FOV, 16 / 9, 0.1, 600);
  camera.position.set(ix, 10, iz + 90); camera.lookAt(ix, 0, iz + 70);
  const homeProps = { group: new THREE.Group(), handles: { trees: [], palms: [] } };
  const previousDocument = globalThis.document, previousPath = globalThis.Path2D;
  globalThis.Path2D = class {};
  const context = new Proxy({}, { get: (o, key) => key in o ? o[key] : key === 'measureText' ? () => ({ width: 40 }) : key.startsWith('create') ? () => ({ addColorStop() {} }) : () => {} });
  globalThis.document = { createElement: () => ({ getContext: () => context }) };
  const world = createWorldVisuals({ scene, camera, homeProps }), n = getColliders().length, m = getInteractables().length, initial = world.visuals.duskcrown.summary();
  assert.ok(initial.crown, 'the island summary carries the crown layers');
  for (let k = 0; k < 3; k++) {
    assert.equal(world.rebuild('duskcrown'), true); assert.deepEqual(world.visuals.duskcrown.summary(), initial);
    assert.equal(getColliders().length, n); assert.equal(getInteractables().length, m);
    const vis = world.visuals.duskcrown;
    assert.equal(vis.full.getObjectByName('crown-layers') !== undefined, true); assert.equal(vis.far.getObjectByName('crown-far-layers') !== undefined, true);
    assert.equal(vis.full.getObjectByName('crown-cliff-falls') !== undefined, true); assert.equal(vis.far.getObjectByName('crown-far-cliff-falls') !== undefined, true);
    let layers = 0; world.root.traverse((o) => { if (o.name === 'crown-layers') layers++; }); assert.equal(layers, 1);
  }
  for (const v of Object.values(world.visuals)) v.dispose(); world.root.removeFromParent();
  if (previousPath === undefined) delete globalThis.Path2D; else globalThis.Path2D = previousPath;
  if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
  crownLayers.setLid(true);
});

test('Node frustum budget (1280x720 follow camera) at the crown spots and the marsh: a handful of added draw calls, a few hundred triangles, none while the lid is drawn', () => {
  const v = buildCrownVisuals(island, mod), small = buildDuskSmallVisuals(island, flora), spots = mod.spots(), report = {};
  const submitted = (root, cam) => {
    cam.updateMatrixWorld(true); const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    let calls = 0, tris = 0;
    root.updateMatrixWorld(true);
    root.traverseVisible((o) => {
      if (!o.isMesh) return;
      let hidden = false; for (let p = o.parent; p && p !== root.parent; p = p.parent) if (!p.visible) hidden = true;
      if (hidden || !fr.intersectsObject(o)) return;
      const g = o.geometry, pa = g.attributes.position, n = (g.index ? g.index.count : pa.count) / 3, a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), s = new THREE.Sphere();
      let k = 0;
      for (let t = 0; t < n; t++) {
        const i0 = g.index ? g.index.getX(t * 3) : t * 3, i1 = g.index ? g.index.getX(t * 3 + 1) : t * 3 + 1, i2 = g.index ? g.index.getX(t * 3 + 2) : t * 3 + 2;
        a.fromBufferAttribute(pa, i0); b.fromBufferAttribute(pa, i1); c.fromBufferAttribute(pa, i2); s.center.copy(a).add(b).add(c).divideScalar(3); s.radius = Math.max(a.distanceTo(s.center), b.distanceTo(s.center), c.distanceTo(s.center));
        if (fr.intersectsSphere(s)) k++;
      }
      if (k) { calls++; tris += k; }
    });
    return { calls, tris };
  };
  const camAt = (pt, zoom) => { const cam = new THREE.PerspectiveCamera(CAMERA_FOV, 16 / 9, 0.1, 600), y = mod.height(pt.x, pt.z); cam.position.set(pt.x, y + 8.5 * zoom, pt.z + 13.5 * zoom); cam.lookAt(pt.x, y + 1, pt.z); return cam; };
  crownLayers.setLid(false);
  for (const k of ['duskCrown', 'crownRock', 'crownFalls']) for (const zoom of [1, 2.2]) {
    const cam = camAt(spots[k], zoom), layers = submitted(v.group, cam), cliff = submitted(v.fixed, cam);
    report[`${k} x${zoom}`] = { layers, cliff };
    assert.ok(layers.calls + cliff.calls <= 8 && layers.tris + cliff.tris < 2500, `${k} x${zoom}: ${JSON.stringify({ layers, cliff })}`);
  }
  crownLayers.setLid(true);                                            // the marsh: the secret layers are not submitted at all
  for (const k of ['duskLanding', 'duskCliff', 'duskLagoon', 'duskWest']) {
    const cam = camAt(spots[k], 1), layers = submitted(v.group, cam);
    assert.deepEqual(layers, { calls: 0, tris: 0 }, k);
    report[k] = { layers, marshFalls: submitted(small.group, cam) };
  }
  console.log('85c Node frustum submissions (added meshes / triangles only; no GPU):', JSON.stringify(report));
  v.dispose(); small.dispose();
});
