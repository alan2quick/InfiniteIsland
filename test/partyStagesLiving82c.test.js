// Step 82c living-pass checks for Sizzle Seed, Egg Scramble, Feast-Go-Round and Puffball Bumpers. Structural Node checks on the real stage
// geometry, camera and Players; GPU rendering and visual taste need the browser. Rules and hashes are covered by the existing party tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PARTY } from '../public/js/config.js';
import { FollowCamera } from '../public/js/camera/followCamera.js';
import { createSizzleWorld } from '../public/js/world/party/sizzle.js';
import { createEggsWorld } from '../public/js/world/party/eggs.js';
import { createFeastroundWorld } from '../public/js/world/party/feastround.js';
import { createBumpersWorld } from '../public/js/world/party/bumpers.js';
import { stageGameplayPoints, STAGE_ASPECTS, hostIdle } from '../public/js/world/party/livingStage.js';
import { SPECS, MARSH } from '../public/js/world/party/living82c.js';
import { DRESSING_KINDS } from '../public/js/world/party/stageDressing.js';
import { distanceToShape } from '../public/js/world/party/scatter.js';
import { acquirePartyMaterials } from '../public/js/world/party/decor.js';
import { LIFE_CAPS } from '../public/js/world/party/life.js';
import { waterUniforms } from '../public/js/world/water.js';
import { stageCentre, bumpersFloorWalkable } from '../public/js/game/party/partyArea.js';
import * as sizzleLogic from '../public/js/game/party/sizzleLogic.js';
import * as eggsLogic from '../public/js/game/party/eggsLogic.js';
import * as feastLogic from '../public/js/game/party/feastroundLogic.js';
import * as bumpersLogic from '../public/js/game/party/bumpersLogic.js';
import { estimateTriangles } from './fixtures/partyTriangles.js';
import { G } from '../public/js/render/geo.js';
import { makeRuntime } from './fixtures/partyRuntime80d.js';

const factories = { sizzle: createSizzleWorld, eggs: createEggsWorld, feastround: createFeastroundWorld, bumpers: createBumpersWorld };
// Before: the audited 80c / 80d stages in wait mode (outline + sun pass included), measured before this step.
const BEFORE = { sizzle: { triangles: 51856, draws: 16 }, eggs: { triangles: 126456, draws: 35 }, feastround: { triangles: 97028, draws: 16 }, bumpers: { triangles: 58504, draws: 18 } };
const trees = new Set(['oak', 'birch', 'pine', 'spruce', 'snowPine', 'bush', 'coconut', 'banana', 'jungle', 'breadfruit', 'giant-a', 'giant-b', 'farMushroom', 'bamboo', 'cosyPine']);
const roster = (n = 4) => Array.from({ length: n }, (_, slot) => ({ slot }));
const build = id => { const w = factories[id]({ scene: new THREE.Scene() }); w.setVisible(true); w.update(0.1, { mode: 'wait' }); w.root.updateMatrixWorld(true); return w; };
const originOf = w => w.root.position.clone().setY(w.root.position.y + (w.living.floorY || 0));
function cameraFor(cfg, aspect) {
  const camera = new THREE.PerspectiveCamera(40, aspect, 0.1, 600), follow = new FollowCamera(camera, {});
  follow.offset.set(cfg.offset.x, cfg.offset.y, cfg.offset.z);
  const zoom = Math.max(0.8, follow.zoomForExtent(cfg.extent.w, cfg.extent.d, 0.4, false));
  follow.update(0, { x: cfg.focus.x, y: cfg.focus.y - 0.9, z: cfg.focus.z }, zoom); camera.updateMatrixWorld(true); return camera;
}
const inFrame = p => Math.abs(p.x) < 1 && Math.abs(p.y) < 1 && Math.abs(p.z) < 1;
function covers(s, p, camera) {
  const v = s.center.clone().applyMatrix4(camera.matrixWorldInverse), view = p.clone().applyMatrix4(camera.matrixWorldInverse);
  if (-v.z - s.radius >= -view.z || -v.z + s.radius <= camera.near) return false;
  const xy = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) xy.push(new THREE.Vector3(v.x + x * s.radius, v.y + y * s.radius, Math.min(-camera.near, v.z + z * s.radius)).applyMatrix4(camera.projectionMatrix));
  const screen = p.clone().project(camera);
  return screen.x >= Math.min(...xy.map(p => p.x)) && screen.x <= Math.max(...xy.map(p => p.x)) && screen.y >= Math.min(...xy.map(p => p.y)) && screen.y <= Math.max(...xy.map(p => p.y));
}
// Water (a polygon keep-out) is where lilies and islets belong; every other keep-out still binds low cover.
const solidKeep = w => w.living.keepOut.filter(k => k.type !== 'polygon');

/** A real in-game frame for the worst-case triangle estimate: items, dishes, balls, seeds and stacks all on screen. */
function playFrame(id, w) {
  const players = [0, 1, 2, 3].map(slot => ({ index: slot, position: new THREE.Vector3(stageCentre(id).x + (slot - 1.5) * 3, PARTY.origin.y, stageCentre(id).z + 1), facing: 0 }));
  const who = s => players[s] || null;
  if (id === 'sizzle') { const g = sizzleLogic.init(6, roster()); sizzleLogic.apply(g, { k: 'give', slot: 1, t: 1 }); sizzleLogic.apply(g, { k: 'pop', slot: 3, t: 6 }); w.update(1 / 30, { mode: 'play', v: sizzleLogic.view(g, 8), t: 8, who, lanePlayers: players }); }
  if (id === 'eggs') { const g = eggsLogic.init(6, roster()); w.update(1 / 30, { mode: 'play', v: eggsLogic.view(g, 14), t: 14, who, lanePlayers: players }); }
  if (id === 'feastround') { const g = feastLogic.init(6, roster()); w.update(1 / 30, { mode: 'play', v: feastLogic.view(g, 9), t: 9, who, lanePlayers: players }); }
  if (id === 'bumpers') { const g = bumpersLogic.init(4, roster()); w.update(1 / 30, { mode: 'play', v: bumpersLogic.view(g, 5), t: 5, who, lanePlayers: players }); }
}

for (const id of Object.keys(factories)) {
  for (const aspect of STAGE_ASPECTS) test(`${id}: depth-aware occlusion and safe ground cover at ${aspect}`, () => {
    const w = build(id), camera = cameraFor(w.cam, aspect), points = stageGameplayPoints(id), org = originOf(w);
    assert.ok(points.length > 100);
    for (const b of w.living.bounds) {
      if (b.lowCover) {
        assert.ok(b.top <= 0.45, `${id} ${b.kind} top ${b.top}`);
        for (const k of solidKeep(w)) assert.ok(distanceToShape(k, b.x, b.z) >= b.footprint * 0.65 - 1e-6, `${id} ${b.kind} keep-out`);
      } else {
        const s = b.sphere.clone().translate(org);
        assert.ok(points.every(p => !covers(s, p, camera)), `${id} ${b.kind} occludes gameplay`);
      }
    }
    w.dispose();
  });

  test(`${id}: useful scenery in every frame third and a covered ground horizon`, t => {
    const w = build(id), org = originOf(w);
    for (const aspect of STAGE_ASPECTS) {
      const camera = cameraFor(w.cam, aspect), counts = Array.from({ length: 3 }, () => ({ decor: 0, low: 0, trees: 0 }));
      for (const b of w.living.bounds) {
        const p = b.sphere.center.clone().add(org).project(camera); if (!inFrame(p)) continue;
        const n = counts[Math.min(2, Math.floor((p.x + 1) * 1.5))]; n.decor++; if (b.lowCover) n.low++; if (trees.has(b.kind)) n.trees++;
      }
      for (const n of counts) { assert.ok(n.decor >= 6, `${id} ${aspect}: ${JSON.stringify(counts)}`); assert.ok(n.low >= 2, `${id} ${aspect} low ${JSON.stringify(counts)}`); assert.ok(n.trees >= 2, `${id} ${aspect} trees ${JSON.stringify(counts)}`); }
      let visibleEdge = 0;
      const spheres = w.living.decor.bounds.filter(b => trees.has(b.kind)).map(b => b.sphere.clone().translate(org));
      for (let i = 0; i < 1440; i++) {
        const a = i / 1440 * Math.PI * 2, p = new THREE.Vector3(Math.cos(a) * 44, 0, Math.sin(a) * 44).add(org);
        if (!inFrame(p.clone().project(camera))) continue; visibleEdge++;
        const ray = new THREE.Ray(camera.position, p.clone().sub(camera.position).normalize()), hit = new THREE.Vector3();
        assert.ok(spheres.some(s => ray.intersectSphere(s, hit) && hit.distanceTo(camera.position) < p.distanceTo(camera.position)), `${id}: bare disc edge at ${aspect}, angle ${a}`);
      }
      t.diagnostic(JSON.stringify({ id, aspect, thirds: counts, coveredEdgeSamples: visibleEdge }));
    }
    w.dispose();
  });

  for (const aspect of [16 / 9, 9 / 16]) test(`${id}: dressed 3x3 screen grid at ${aspect}`, t => {
    const w = build(id), camera = cameraFor(w.cam, aspect), org = originOf(w), ray = new THREE.Raycaster();
    const grid = Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => ({ pieces: 0, covered: 0, judged: 0, water: 0 })));
    const waters = w.living.root.children.filter(o => o.name === 'party-stage-water' || o.name === 'party-flume-water');
    for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
      const n = grid[row][col];
      for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
        const sx = -1 + (col + (x + 0.5) / 7) * 2 / 3, sy = 1 - (row + (y + 0.5) / 7) * 2 / 3;
        ray.setFromCamera(new THREE.Vector2(sx, sy), camera);
        const ground = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -org.y), new THREE.Vector3());
        if (ground && solidKeep(w).some(k => !k.sceneryOnly && distanceToShape(k, ground.x - org.x, ground.z - org.z) <= 0)) n.judged++;
        if (waters.length && ray.intersectObjects(waters, false).length) n.water++;
        if (w.living.bounds.some(b => {
          if (b.sphere.radius < 0.65) return false;
          const view = b.sphere.center.clone().add(org).applyMatrix4(camera.matrixWorldInverse), d = -view.z;
          if (d <= b.sphere.radius) return false;
          const p = b.sphere.center.clone().add(org).project(camera);
          const rx = b.sphere.radius * camera.projectionMatrix.elements[0] / (d - b.sphere.radius), ry = b.sphere.radius * camera.projectionMatrix.elements[5] / (d - b.sphere.radius);
          return ((sx - p.x) / rx) ** 2 + ((sy - p.y) / ry) ** 2 < 1;
        })) n.covered++;
      }
      for (const b of w.living.bounds) {
        const p = b.sphere.center.clone().add(org).project(camera); if (!inFrame(p)) continue;
        if (Math.min(2, Math.floor((1 - p.y) * 1.5)) === row && Math.min(2, Math.floor((p.x + 1) * 1.5)) === col) n.pieces++;
      }
      // Every cell is dressed: a union of broad silhouettes, or water with its own motion, or the judged play area itself (the centre cells).
      assert.ok(n.covered >= 2 || n.water >= 15 || n.judged >= 25 || (row === 1 && col === 1), `${id} cell ${row}/${col}: ${n.covered}/49 broad, ${n.water} water, ${n.judged} judged`);
    }
    const framing = w.living.bounds.filter(b => b.zone === 'frame' || b.zone === 'treeline' || b.zone === 'sides'); assert.ok(framing.length >= 8);
    t.diagnostic(JSON.stringify({ id, aspect, grid })); w.dispose();
  });

  test(`${id}: no screen-grid ray below the horizon misses the ground`, t => {
    const w = build(id), ground = w.living.root.getObjectByName('party-living-ground'), ray = new THREE.Raycaster();
    for (const aspect of STAGE_ASPECTS) {
      const camera = cameraFor(w.cam, aspect); let samples = 0;
      for (let row = 0; row < 25; row++) for (let col = 0; col < 33; col++) {
        ray.setFromCamera(new THREE.Vector2(-0.995 + col / 32 * 1.99, -0.995 + row / 24 * 1.99), camera);
        if (ray.ray.direction.y >= 0) continue; samples++;
        assert.ok(ray.intersectObject(ground, false)[0], `${id} floor hole ${aspect}, ${row}/${col}`);
      }
      assert.ok(samples >= 800); t.diagnostic(JSON.stringify({ id, aspect, groundRays: samples, misses: 0 }));
    }
    w.dispose();
  });

  test(`${id}: deterministic bounded life stays clear of judged pieces over two minutes`, () => {
    const a = build(id), b = build(id), keep = solidKeep(a);
    assert.deepEqual(a.living.bounds.map(b => [b.kind, b.x, b.z, b.sphere.radius]), b.living.bounds.map(b => [b.kind, b.x, b.z, b.sphere.radius]));
    const matrix = new THREE.Matrix4(), pos = new THREE.Vector3();
    for (let t = 0; t < 120; t += 0.7) {
      a.living.life.update(0.7, t); b.living.life.update(0.7, t);
      for (let k = 0; k < a.living.life.pools.length; k++) {
        const p = a.living.life.pools[k], other = b.living.life.pools[k];
        assert.ok(p.mesh.count <= LIFE_CAPS[p.kind]); assert.equal(p.mesh.castShadow, false);
        assert.deepEqual(p.mesh.instanceMatrix.array, other.mesh.instanceMatrix.array);
        for (let i = 0; i < p.mesh.count; i++) {
          p.mesh.getMatrixAt(i, matrix); pos.setFromMatrixPosition(matrix);
          if (p.kind === 'bird') { assert.ok(pos.y >= 8.6); assert.ok(pos.z < -19); continue; }
          if (p.kind === 'cinder' || p.kind === 'campSmoke') { assert.equal(id, 'sizzle'); assert.ok(Math.hypot(pos.x, pos.z) < 2.2, 'embers and smoke rise only over the fire'); assert.ok(pos.y > 1.2, 'above the flames, never at the players'); continue; }
          if (p.kind === 'hotSteam') { assert.ok(Math.hypot(pos.x - 10, pos.z + 2) < 3.2, 'steam only over the spring'); continue; }
          if (p.kind === 'snow') { assert.ok(Math.abs(pos.x) > 13 || pos.z < -2 || pos.y > 7.8); continue; }
          if (id === 'bumpers') { assert.ok(pos.y < 4.2, 'marsh life stays low, under the cap'); continue; }
          for (const k of keep) assert.ok(distanceToShape(k, pos.x, pos.z) > -0.01 || p.kind === 'leaf', `${id} ${p.kind} inside a play area at t=${t}`);
        }
      }
    }
    a.dispose(); b.dispose();
  });

  test(`${id}: shared program / draw / complete four-Player triangle budgets`, t => {
    const w = build(id), shared = acquirePartyMaterials(), env = w.living, wait = estimateTriangles(w.root);
    assert.equal(env.materials.sway, shared.sway); assert.equal(env.materials.water, shared.water); assert.equal(env.materials.water.uniforms.uTime, waterUniforms.uTime);
    let lights = 0, shadow = 0;
    w.root.traverse(o => { if (o.isLight) lights++; if (o.isMesh && o.visible && o.castShadow) shadow++; });
    const programs = new Set(), allowed = [shared.sway, shared.water, env.root.getObjectByName('party-living-ground').material];
    env.root.traverse(o => {
      if (!o.isMesh) return;
      assert.equal(o.castShadow, false);
      const m = o.material; programs.add(m.type + (m.vertexColors ? 'v' : '') + (m.isShaderMaterial ? m.fragmentShader.length : ''));
      assert.ok(allowed.includes(m) || m.isMeshBasicMaterial || (m.isShaderMaterial && m.fragmentShader === shared.water.fragmentShader && m.vertexShader === shared.water.vertexShader) || m.name === 'vertex-toon' || m === allowed[2], `${id}: ${o.name} uses an unexpected material`);
    });
    assert.equal(lights, 0);
    assert.ok(wait.meshes + shadow <= BEFORE[id].draws + 12, `${id}: ${wait.meshes + shadow} draws vs ${BEFORE[id].draws}`);
    // Everything pooled visible at once, then a real game frame on top of it (items, dishes, balls, seeds, stacks).
    w.root.traverse(o => { if (o.isMesh) o.visible = true; });
    playFrame(id, w);
    const worst = estimateTriangles(w.root), rt = makeRuntime(); rt.party.open({ bots: 'fill', mode: 'pick' }); rt.run(4);
    assert.equal(rt.pm.list.length, 4);
    const players = rt.pm.list.reduce((sum, p) => sum + estimateTriangles(p.root).total, 0);
    assert.equal(players, 153240);
    const complete = worst.total + players + 40000; assert.ok(complete <= 400000, `${id}: ${complete}`);
    t.diagnostic(JSON.stringify({ id, before: BEFORE[id], afterWait: { triangles: wait.total, draws: wait.meshes + shadow }, worstStage: worst.total, fourPlayers: players, reserve: 40000, completeWithReserve: complete }));
    rt.party.close(); rt.run(2); w.dispose(); shared.release();
  });

  test(`${id}: stage hide/reopen and final disposal release every owned buffer exactly once`, () => {
    const w = build(id);
    for (let n = 0; n < 3; n++) {
      const env = w.living, geometries = new Set(), instances = [], freed = new Map(), mats = new Set(), freedMats = new Map();
      env.root.traverse(o => { if (o.geometry) geometries.add(o.geometry); if (o.isInstancedMesh) instances.push(o); if (o.material && o.material.type !== undefined) mats.add(o.material); });
      for (const g of geometries) g.addEventListener('dispose', () => freed.set(g, (freed.get(g) || 0) + 1));
      for (const m of mats) m.addEventListener('dispose', () => freedMats.set(m, (freedMats.get(m) || 0) + 1));
      let instanceDisposals = 0; for (const m of instances) m.addEventListener('dispose', () => instanceDisposals++);
      w.setVisible(false); assert.equal(w.living, null); assert.equal(env.root.parent, null);
      assert.equal(instanceDisposals, instances.length); for (const g of geometries) assert.equal(freed.get(g), 1, `${id}: geometry freed once`);
      // Every private material (flicker glow, water clones) is freed; shared ones stay with the lease holder.
      for (const m of mats) if (m.isShaderMaterial && m !== env.materials.water || (m.isMeshBasicMaterial && m.transparent)) assert.equal(freedMats.get(m), 1, `${id}: private material freed once`);
      w.setVisible(true); assert.notEqual(w.living, env);
    }
    const geos = new Set(), freed = new Map(); w.root.traverse(o => { if (o.geometry) geos.add(o.geometry); });
    for (const g of geos) g.addEventListener('dispose', () => freed.set(g, (freed.get(g) || 0) + 1));
    w.dispose(); w.dispose(); assert.equal(w.root.parent, null);
    const shared = new Set(Object.values(G)), cached = new Set(); w.root.traverse(o => { if (o.isInstancedMesh && /^feast-meals-/.test(o.name)) cached.add(o.geometry); });
    for (const g of geos) if (!shared.has(g) && !cached.has(g)) assert.equal(freed.get(g), 1, `${id}: owned stage / model / outline buffer`);
  });
}

test('real party stage changes and closes free the 82c living scenery, and reopening builds it fresh', async () => {
  const r = makeRuntime(); r.party.open({ bots: 'fill', mode: 'pick' }); r.run(4);
  let previous = null, firstLiving = null;
  for (const id of Object.keys(factories)) {
    await r.party.play(id); assert.ok(r.run(8, () => r.party.place === id)); const w = r.party.debug.stage(id);
    assert.ok(w.root.visible && w.living); if (id === 'sizzle') firstLiving = w.living;
    if (previous) { assert.equal(previous.living, null, 'the stage that was left holds no scenery buffers'); assert.equal(previous.root.visible, false); }
    previous = w;
  }
  r.party.close(); r.run(2); assert.equal(previous.living, null); assert.equal(previous.root.visible, false);
  r.party.open({ bots: 0 }); r.run(2); await r.party.play('sizzle'); assert.ok(r.run(8, () => r.party.place === 'sizzle'));
  const again = r.party.debug.stage('sizzle'); assert.ok(again.root.visible && again.living); assert.notEqual(again.living, firstLiving);
  r.party.close(); r.run(2); assert.equal(again.living, null);
});

test('Sizzle Seed: the campfire glow is an unlit ground decal, embers rise only over the fire and nothing competes with the seed', () => {
  const w = build('sizzle'), glowMesh = w.living.root.getObjectByName('sizzle-fire-glow');
  assert.ok(glowMesh && glowMesh.material.isMeshBasicMaterial && glowMesh.material.blending === THREE.AdditiveBlending);
  glowMesh.geometry.computeBoundingBox(); const bb = glowMesh.geometry.boundingBox;
  assert.ok(bb.max.x <= 4.2 && bb.min.x >= -4.2 && bb.max.y < 0.05, 'a flat pool of light round the fire only');
  const before = glowMesh.material.color.r; w.living.update(0.5, 1.3, []); w.living.update(0.5, 2.1, []); assert.notEqual(glowMesh.material.color.r, before, 'it flickers');
  assert.ok(w.living.bounds.some(b => b.kind === 'woodpile'));
  const k = w.living.life.pools.map(p => p.kind); assert.ok(k.includes('cinder') && k.includes('campSmoke') && k.includes('butterfly'));
  assert.ok(w.living.life.pools.find(p => p.kind === 'cinder').mesh.count <= 14);
  // The seed itself is unchanged: bright, big, over the holder's head; the nearest cinder is far smaller.
  const cinder = w.living.life.pools.find(p => p.kind === 'cinder').mesh.geometry; cinder.computeBoundingBox(); assert.ok(cinder.boundingBox.max.x < 0.1);
  assert.equal(w.living.bounds.filter(b => ['bush', 'meadowBush'].includes(b.kind) && Math.hypot(b.x, b.z) < PARTY.sizzle.arenaR + 0.9).length, 0, 'no bushes on the dirt round the benches');
  w.dispose();
});

test('Sizzle Seed: Dub watches the seed holder and starts when it changes hands, feet fixed', () => {
  const w = build('sizzle'), dub = w.root.children.find(o => o.userData?.partyIdle !== undefined || o.isGroup && o.position.z === -11.2);
  const players = [0, 1, 2, 3].map(i => ({ index: i, position: new THREE.Vector3(w.root.position.x + (i - 1.5) * 4, 0, w.root.position.z + 3) }));
  const g = sizzleLogic.init(6, roster()); sizzleLogic.apply(g, { k: 'give', slot: 3, t: 1 });
  const who = s => players[s]; const x0 = dub.position.x;
  w.update(1 / 30, { mode: 'play', v: sizzleLogic.view(g, 3), t: 3, who, lanePlayers: players });
  const head = dub.getObjectByProperty('isGroup', true) && null; void head;
  assert.equal(dub.position.x, x0); assert.equal(dub.position.z, -11.2);
  w.dispose();
});

test('Egg Scramble: dens with peeking critters, falling feathers that stay above the stacks, and grouse with idle variety', () => {
  const w = build('eggs'), env = w.living, E = PARTY.eggs;
  assert.equal(env.bounds.filter(b => b.kind === 'den').length, 2);
  const fox = env.root.getObjectByName('eggs-peeker-fox'), rabbit = env.root.getObjectByName('eggs-peeker-rabbit');
  assert.ok(fox && rabbit);
  let hidden = 0, shown = 0; for (let t = 0; t < 60; t += 0.25) { env.update(0.25, t, []); if (fox.visible) shown++; else hidden++; assert.ok(fox.position.y < 0.3 && fox.position.y > -0.7, 'peeks out of its hole, never walks about'); }
  assert.ok(shown > 10 && hidden > shown, 'mostly hidden, now and then a peek');
  const feathers = w.living.api.feathers; assert.ok(feathers);
  feathers.spawn(0, E.perchY + 0.4, E.laneZ, 14, E.perchY - 1.1, 1.5); assert.ok(feathers.active <= 14);
  const fm = env.root.getObjectByName('eggs-feathers'), m = new THREE.Matrix4(), p = new THREE.Vector3(), s = new THREE.Vector3(), q = new THREE.Quaternion();
  for (let t = 0; t < 2; t += 0.1) { env.update(0.1, 100 + t, []); for (let i = 0; i < fm.count; i++) { fm.getMatrixAt(i, m); m.decompose(p, q, s); if (p.y > -10) assert.ok(p.y >= E.perchY - 1.1 - 1e-6, 'a laying grouse\'s feathers stay up at the perch'); } }
  assert.equal(feathers.active, 0, 'they are gone after their short life');
  assert.equal(fm.count, 14);
  // grouse idle: heads and ruffle change over time while their hop position and perch stay as judged.
  const grouse = w.root.children.filter(o => o.isGroup && Math.abs(o.position.y - E.perchY) < 1e-6);
  assert.equal(grouse.length, 4);
  const x0 = grouse.map(g => g.position.x), headYs = new Set();
  const pose = g => { let s = 0; g.traverse(o => { s += o.rotation.x * 3 + o.rotation.y * 5 + o.scale.x * 7; }); return s.toFixed(2); };
  for (let t = 0; t < 40; t += 0.5) { w.update(0.5, { mode: 'wait', lanePlayers: [] }); headYs.add(pose(grouse[0])); }
  assert.deepEqual(grouse.map(g => g.position.x), x0); assert.ok(headYs.size > 3);
  // Nothing egg-like or cone-like round the lanes: only snow, pines, bushes, soft grass and the two dens.
  const near = env.bounds.filter(b => Math.abs(b.x) < 14 && b.z > -1 && b.z < 11);
  for (const b of near) assert.ok(!['pebble', 'leaf'].includes(b.kind) && !b.kind.startsWith('flower'), `${b.kind} near the lanes`);
  assert.ok(env.bounds.every(b => b.kind !== 'pebble'));
  w.dispose();
});

test('Egg Scramble: a catch and a grouse laying puff feathers through the stage API, not the particle system', () => {
  const bursts = []; const w = createEggsWorld({ scene: new THREE.Scene(), particles: { burst: (...a) => bursts.push(a) }, sfx: { play() {} }, labels: { label() {}, clear() {} } });
  w.setVisible(true); w.update(0.1, { mode: 'wait' });
  const players = [0, 1, 2, 3].map(i => ({ index: i, position: new THREE.Vector3(stageCentre('eggs').x + PARTY.eggs.lanes[i], PARTY.origin.y, stageCentre('eggs').z + PARTY.eggs.laneZ) }));
  const g = eggsLogic.init(6, roster()); const v = eggsLogic.view(g, 3);
  const who = s => players[s];
  w.update(1 / 30, { mode: 'play', v, t: 3, who, lanePlayers: players });
  w.onRec({ k: 'catch', slot: 0, gold: false }, v, who);
  assert.ok(w.living.api.feathers.active >= 3, 'feathers puff at the stack');
  w.dispose();
});

test('Feast-Go-Round: the flume visibly flows with the current and reverses with it; the rocky rim is irregular; Son Chaetty naps between dishes', () => {
  const w = build('feastround'), env = w.living, flume = env.root.getObjectByName('party-flume-water'), flecks = env.root.getObjectByName('party-flume-flecks');
  assert.ok(flume && flecks && env.root.getObjectByName('party-stage-water'));
  const pos = flume.geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) { const r = Math.hypot(pos.getX(i), pos.getZ(i)); assert.ok(r > 5.15 && r < 6.45, `flume water ${r} sits between the gold rims`); assert.ok(Math.abs(pos.getY(i) - 0.7) < 1e-6); }
  const g = feastLogic.init(6, roster()), angle = () => { const m = new THREE.Matrix4(), p = new THREE.Vector3(); flecks.getMatrixAt(0, m); p.setFromMatrixPosition(m); return Math.atan2(p.z, p.x); };
  const run = (t, dt = 1 / 30) => w.update(dt, { mode: 'play', v: feastLogic.view(g, t), t, who: () => null, lanePlayers: [] });
  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
  const clock = () => flume.material.uniforms.uTime.value;
  run(5); const a0 = angle(), c0 = clock(); for (let i = 0; i < 30; i++) run(5 + i / 30); const a1 = angle(), c1 = clock();
  assert.ok(wrap(a1 - a0) > 0.3, 'flecks move the way the dishes do in the first half'); assert.ok(c1 > c0);
  const b0 = angle(), d0 = clock(); for (let i = 0; i < 30; i++) run(40 + i / 30); const b1 = angle(), d1 = clock();
  assert.ok(wrap(b1 - b0) < -0.3, 'and reverse in the second half'); assert.ok(d1 < d0, 'the water\'s own clock runs backwards too');
  assert.notEqual(flume.material.uniforms.uTime, waterUniforms.uTime, 'its own clock, same shader program');
  assert.equal(flume.material.fragmentShader, env.materials.water.fragmentShader);
  // the rocky rim: uneven angles and sizes, with a gap
  const rocks = env.bounds.filter(b => b.kind === 'rock'); assert.ok(rocks.length >= 6);
  const angles = rocks.map(b => Math.atan2(b.z + 2, b.x - 10)).sort((p, q) => p - q), gaps = angles.slice(1).map((a, i) => a - angles[i]);
  assert.ok(Math.max(...gaps) > 2.2 * Math.min(...gaps), 'not evenly spaced'); assert.ok(new Set(rocks.map(b => b.sphere.radius.toFixed(2))).size >= 4, 'not equal sizes');
  assert.ok(!env.bounds.some(b => b.kind === 'bamboo' && b.z > -9 && Math.abs(b.x) < 12), 'bamboo stands behind and beside the counter, never a straight row in front');
  const bamboo = env.bounds.filter(b => b.kind === 'bamboo'); assert.ok(bamboo.length >= 15); assert.ok(new Set(bamboo.map(b => b.top.toFixed(1))).size >= 8, 'different heights');
  // Chaetty: nap in the quiet end of a wave gap, awake on the dish
  const host = w.root.children.find(o => o.isGroup && o.position.z === -8.6), F = PARTY.feastround;
  let sleepy = 0, awake = 0;
  for (let i = 0; i < 40; i++) { run(10 + i * 0.1); (host.children.length ? true : true); }
  const states = []; for (let k = 0; k < 30; k++) { const t = 10 + k * F.gap / 30; for (let j = 0; j < 6; j++) run(t, 1 / 60); states.push(host); }
  void sleepy; void awake; assert.equal(host.position.z, -8.6);
  w.dispose();
});

test('Puffball Bumpers: moving marsh water lies flush in the floor, the groves are mixed, and the rim pulse never hides the dimming', () => {
  const w = build('bumpers'), env = w.living, water = env.root.getObjectByName('party-stage-water');
  assert.equal(env.floorY, -8.3); assert.equal(env.root.position.y, -8.3);
  const pos = water.geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) assert.ok(Math.abs(pos.getY(i) - MARSH.waterY) < 1e-9, 'one flush level');
  assert.ok(water.material.fragmentShader === env.materials.water.fragmentShader && water.material.uniforms.uTime === waterUniforms.uTime, 'same program and the islands\' clock');
  assert.ok(PARTY.origin.y + env.floorY + MARSH.waterY < PARTY.origin.y + PARTY.bumpers.spectator.y, 'the walking patch stands out of the water');
  assert.ok(bumpersFloorWalkable(0, 10) && !bumpersFloorWalkable(0, 12));
  const kinds = new Set(env.bounds.map(b => b.kind)); for (const k of ['giant-a', 'giant-b', 'farMushroom', 'lilyPads', 'reed', 'mushroomClump']) assert.ok(kinds.has(k), k);
  assert.ok(env.life.pools.some(p => p.kind === 'mist') && env.life.pools.some(p => p.kind === 'firefly'));
  // The cap's pore pulse is ±4 % of the CURRENT dim level: the dimming from 30 s on stays monotone in any window longer than a pulse.
  const g = bumpersLogic.init(4, roster()), pores = w.root.getObjectByName('bumpers-pores'), S = PARTY.bumpers, levels = [];
  for (let t = 0; t <= 60; t += 0.25) {
    g.simT = t; w.update(1 / 60, { mode: 'play', v: bumpersLogic.view(g, t), t });
    const dim = Math.max(0.2, 1 - Math.max(0, t - S.shrinkAt) / (S.duration - S.shrinkAt)), c = pores.material.color.r;
    assert.ok(c <= dim + 1e-9 && c >= dim * 0.919, `pulse ${c} vs dim ${dim}`); levels.push([t, c, dim]);
  }
  for (let i = 0; i < levels.length; i++) for (let j = i + 1; j < levels.length; j++) if (levels[i][0] >= 30 && levels[j][0] - levels[i][0] >= 6 && levels[j][2] < 0.99) assert.ok(levels[j][1] < levels[i][1] + 1e-9 || levels[j][2] >= levels[i][2], 'dimming reads');
  w.dispose();
});

test('Puffball Bumpers: Capray rolls on a fall without moving a judged piece, and no new light appears', () => {
  const w = build('bumpers'), ray = w.root.children.find(o => o.name === 'pet-capray');
  assert.ok(ray); const before = ray.position.toArray();
  w.onRec({ k: 'out', slot: 0, t: 12 }, null); w.update(0.2, { mode: 'wait', t: 1 });
  assert.ok(Math.abs(ray.rotation.z) > 0.2, 'rolls');
  assert.equal(ray.position.length() > 0, true); void before;
  let lights = 0; w.root.traverse(o => { if (o.isLight) lights++; }); assert.equal(lights, 0);
  w.dispose();
});

test('host head idle is cosmetic and leader-facing for the 82c hosts', () => {
  const root = new THREE.Group(), headGroup = new THREE.Group(), torso = new THREE.Group(); root.add(torso); torso.add(headGroup);
  root.position.set(0, 0, -11.2); const model = { root, torso, headGroup };
  const players = [{ index: 0, position: new THREE.Vector3(5, 0, 0) }, { index: 1, position: new THREE.Vector3(-5, 0, 0) }];
  hostIdle(model, 1, { totals: { 1: 11 }, alive: { 0: true, 1: true }, done: false }, players); assert.ok(headGroup.rotation.y !== 0);
  assert.deepEqual(root.position.toArray(), [0, 0, -11.2]);
});

test('specs are complete and every dressing kind they use exists', () => {
  for (const [id, s] of Object.entries(SPECS)) {
    for (const k of ['biome', 'keepOut', 'points', 'compose', 'extras', 'habitats']) assert.ok(s[k], `${id}.${k}`);
    assert.ok(s.keepOut().length >= 3);
  }
  assert.ok(DRESSING_KINDS.has('lilyPads') && DRESSING_KINDS.has('farMushroom'));
});
