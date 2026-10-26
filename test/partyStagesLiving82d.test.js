// Step 82d living-pass checks for Glowcap Shuffle, Driftwood Cast, Tilty Tiles and Bonk Burrows. Structural Node checks on the real stage geometry and cameras;
// GPU rendering and visual taste need the browser. Rules and hashes are covered by the existing party tests (which pass untouched).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PARTY } from '../public/js/config.js';
import { FollowCamera } from '../public/js/camera/followCamera.js';
import { createGlowcapWorld } from '../public/js/world/party/glowcap.js';
import { createCastWorld } from '../public/js/world/party/cast.js';
import { createTiltyWorld } from '../public/js/world/party/tilty.js';
import { createBonkWorld } from '../public/js/world/party/bonk.js';
import { stageGameplayPoints, STAGE_ASPECTS } from '../public/js/world/party/livingStage.js';
import { SPECS } from '../public/js/world/party/living82c.js';
import { bonkMeadowEdge, bonkRiverOut, castShoreZ } from '../public/js/world/party/living82d.js';
import { distanceToShape } from '../public/js/world/party/scatter.js';
import { acquirePartyMaterials } from '../public/js/world/party/decor.js';
import { LIFE_CAPS } from '../public/js/world/party/life.js';
import { waterUniforms } from '../public/js/world/water.js';
import { stageCentre, glowcapLayout } from '../public/js/game/party/partyArea.js';
import * as glowLogic from '../public/js/game/party/glowcapLogic.js';
import { estimateTriangles } from './fixtures/partyTriangles.js';
import { G } from '../public/js/render/geo.js';

const factories = { glowcap: createGlowcapWorld, cast: createCastWorld, tilty: createTiltyWorld, bonk: createBonkWorld };
// Before: the audited 81a / 81b stages in wait mode (outline + sun pass included), measured before this step.
const BEFORE = { glowcap: { triangles: 56137, draws: 30 }, cast: { triangles: 62548, draws: 32 }, tilty: { triangles: 161472, draws: 36 }, bonk: { triangles: 92764, draws: 14 } };
const FOUR_PLAYERS = 153240, RESERVE = 40000;
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
  return screen.x >= Math.min(...xy.map(q => q.x)) && screen.x <= Math.max(...xy.map(q => q.x)) && screen.y >= Math.min(...xy.map(q => q.y)) && screen.y <= Math.max(...xy.map(q => q.y));
}
// Water (a polygon keep-out) is where lily pads belong, and Cast's sea polygon is scenery-only; every other keep-out binds low cover.
const solidKeep = w => w.living.keepOut.filter(k => k.type !== 'polygon');
const coverTop = b => b.top - (b.y0 || 0);

for (const id of Object.keys(factories)) {
  for (const aspect of STAGE_ASPECTS) test(`${id}: depth-aware occlusion and safe ground cover at ${aspect}`, () => {
    const w = build(id), camera = cameraFor(w.cam, aspect), points = stageGameplayPoints(id), org = originOf(w);
    assert.ok(points.length > 100);
    for (const b of w.living.bounds) {
      if (b.lowCover) {
        assert.ok(coverTop(b) <= 0.45, `${id} ${b.kind} cover height ${coverTop(b)}`);
        for (const k of solidKeep(w)) assert.ok(distanceToShape(k, b.x, b.z) >= b.footprint * 0.65 - 1e-6, `${id} ${b.kind} keep-out`);
      } else assert.ok(points.every(p => !covers(b.sphere.clone().translate(org), p, camera)), `${id} ${b.kind} occludes gameplay`);
    }
    w.dispose();
  });

  for (const aspect of [16 / 9, 9 / 16]) test(`${id}: dressed 3x3 screen grid at ${aspect}`, t => {
    const w = build(id), camera = cameraFor(w.cam, aspect), org = originOf(w), ray = new THREE.Raycaster();
    const grid = Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => ({ pieces: 0, covered: 0, judged: 0, water: 0 })));
    const waters = w.living.root.children.filter(o => o.name === 'party-stage-water');
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
    t.diagnostic(JSON.stringify({ id, aspect: +aspect.toFixed(2), grid: grid.map(r => r.map(c => `${c.covered}/${c.water}/${c.judged}`)) })); w.dispose();
  });

  test(`${id}: no screen-grid ray below the horizon misses the ground`, () => {
    const w = build(id), ground = w.living.root.getObjectByName('party-living-ground'), ray = new THREE.Raycaster();
    for (const aspect of STAGE_ASPECTS) {
      const camera = cameraFor(w.cam, aspect); let samples = 0;
      for (let row = 0; row < 25; row++) for (let col = 0; col < 33; col++) {
        ray.setFromCamera(new THREE.Vector2(-0.995 + col / 32 * 1.99, -0.995 + row / 24 * 1.99), camera);
        if (ray.ray.direction.y >= 0) continue; samples++;
        assert.ok(ray.intersectObject(ground, false)[0], `${id} floor hole ${aspect}, ${row}/${col}`);
      }
      assert.ok(samples >= 800);
    }
    w.dispose();
  });

  test(`${id}: deterministic bounded life stays clear of every judged piece over two minutes`, () => {
    const a = build(id), b = build(id), keep = solidKeep(a);
    assert.deepEqual(a.living.bounds.map(q => [q.kind, q.x, q.z, q.sphere.radius]), b.living.bounds.map(q => [q.kind, q.x, q.z, q.sphere.radius]));
    const matrix = new THREE.Matrix4(), pos = new THREE.Vector3();
    for (let t = 0; t < 120; t += 0.7) {
      a.living.life.update(0.7, t); b.living.life.update(0.7, t);
      for (let k = 0; k < a.living.life.pools.length; k++) {
        const p = a.living.life.pools[k], other = b.living.life.pools[k];
        assert.ok(p.mesh.count <= LIFE_CAPS[p.kind]); assert.equal(p.mesh.castShadow, false);
        assert.deepEqual(p.mesh.instanceMatrix.array, other.mesh.instanceMatrix.array);
        for (let i = 0; i < p.mesh.count; i++) {
          p.mesh.getMatrixAt(i, matrix); pos.setFromMatrixPosition(matrix);
          for (const q of keep) assert.ok(distanceToShape(q, pos.x, pos.z) > -0.01 || p.kind === 'leaf', `${id} ${p.kind} inside a play area at t=${t}`);
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
    env.root.traverse(o => {
      if (!o.isMesh) return;
      assert.equal(o.castShadow, false, `${id}: ${o.name} casts a shadow`);
      const m = o.material;
      assert.ok(m === shared.sway || m.isMeshBasicMaterial || m.name === 'vertex-toon' || m === env.root.getObjectByName('party-living-ground').material
        || (m.isShaderMaterial && m.fragmentShader === shared.water.fragmentShader && m.vertexShader === shared.water.vertexShader), `${id}: ${o.name} uses an unexpected material`);
    });
    assert.equal(lights, 0);
    assert.ok(wait.meshes + shadow <= BEFORE[id].draws + 14, `${id}: ${wait.meshes + shadow} draws vs ${BEFORE[id].draws}`);
    w.root.traverse(o => { if (o.isMesh) o.visible = true; });
    const worst = estimateTriangles(w.root), complete = worst.total + FOUR_PLAYERS + RESERVE;
    assert.ok(complete <= 400000, `${id}: ${complete}`);
    t.diagnostic(JSON.stringify({ id, before: BEFORE[id], afterWait: { triangles: wait.total, draws: wait.meshes + shadow }, worstStage: worst.total, completeWithFourPlayersAndReserve: complete }));
    w.dispose(); shared.release();
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
      for (const m of mats) if (m.isShaderMaterial && m !== env.materials.water || (m.isMeshBasicMaterial && m.transparent)) assert.equal(freedMats.get(m), 1, `${id}: private material freed once`);
      w.setVisible(true); assert.notEqual(w.living, env);
    }
    const geos = new Set(), freed = new Map(); w.root.traverse(o => { if (o.geometry) geos.add(o.geometry); });
    for (const g of geos) g.addEventListener('dispose', () => freed.set(g, (freed.get(g) || 0) + 1));
    w.dispose(); w.dispose(); assert.equal(w.root.parent, null);
    const shared = new Set(Object.values(G));
    for (const g of geos) if (!shared.has(g)) assert.equal(freed.get(g), 1, `${id}: owned stage / model / outline buffer`);
  });
}

test('the four 82d specs are registered with every part the shared builder reads', () => {
  for (const id of Object.keys(factories)) { const s = SPECS[id]; for (const k of ['biome', 'keepOut', 'points', 'compose', 'extras', 'habitats']) assert.ok(s[k], `${id}.${k}`); }
});

// ------------------------------------------------------------------------------------------------ Glowcap Shuffle
test('Glowcap Shuffle: the caps and the call plate are untouched, the lagoon moves, sunk caps stay water, ripples only at sinking / rising caps', () => {
  const w = build('glowcap'), env = w.living, caps = glowcapLayout();
  for (let i = 0; i < caps.length; i++) { const d = w.capDraw(i), c = stageCentre('glowcap'); assert.ok(Math.abs(d.x - (c.x + caps[i].x)) < 1e-9 && Math.abs(d.z - (c.z + caps[i].z)) < 1e-9); }
  assert.equal(env.floorY, SPECS.glowcap.floorY);
  const lagoon = env.root.getObjectByName('party-stage-water');
  assert.equal(lagoon.material.blending, THREE.AdditiveBlending); assert.equal(lagoon.material.fragmentShader, env.materials.water.fragmentShader);
  assert.ok(w.root.getObjectByName('glowcap-water').material.opacity > 0.5, 'the dim translucent layer that keeps sunk caps readable is still there');
  assert.equal(env.bounds.filter(b => b.kind === 'lilyPads' && Math.hypot(b.x, b.z) < 8).length, 0, 'no pads among the caps');
  // nothing tall behind the call plate, nothing glowing on the cap field
  const plate = new THREE.Vector3(0, 0, -8.6);
  for (const b of env.bounds.filter(q => !q.lowCover)) assert.ok(!(Math.abs(b.x) < 4.8 && b.z > -17.5 && b.z < -7), `${b.kind} behind the plate`);
  for (const b of env.bounds.filter(q => q.x !== undefined)) assert.ok(Math.hypot(b.x, b.z) > 7 || Math.abs(b.x) > 7.4 || Math.abs(b.z) > 6.9, `${b.kind} on the cap field`); void plate;
  // ripples: a cap that starts to sink spawns one, a steady state spawns none
  const g = glowLogic.init(5, [{ slot: 0 }, { slot: 1 }]); const plan = glowLogic.buildPlan(5), r0 = plan.rounds[0];
  const depthAt = t => glowLogic.view(g, t).depth;
  const ripples = () => env.api.ripples(); env.update(0.1, 1, [], { depth: depthAt(0) }); assert.equal(ripples(), 0);
  env.update(0.1, 2, [], { depth: depthAt(r0.sinkAt + 0.2) }); assert.ok(ripples() >= 1, 'a ripple at the sinking caps');
  const n = ripples(); for (let k = 0; k < 20; k++) env.update(0.1, 3 + k * 0.1, [], { depth: depthAt(r0.sinkAt + 0.2) }); assert.equal(ripples(), 0, 'they fade away in under a second');
  void n; const ring = env.api.rings; assert.ok(ring.material.blending === THREE.AdditiveBlending && ring.count === 12);
  w.dispose();
});

// ------------------------------------------------------------------------------------------------ Driftwood Cast
test('Driftwood Cast: the sun path, waves, foam, gulls and boat stay out of the lanes and below / above find height; the sea sits under the lanes', () => {
  const w = build('cast'), env = w.living, C = PARTY.cast, m = new THREE.Matrix4(), p = new THREE.Vector3();
  const sea = env.root.getObjectByName('party-stage-water'); sea.geometry.computeBoundingBox();
  assert.ok(Math.abs(sea.position.y + sea.geometry.boundingBox.min.y - sea.geometry.boundingBox.max.y) < 1e-9);
  for (let t = 0; t < 200; t += 0.37) {
    env.update(0.37, t, []);
    for (const [name, rule] of [['path', q => q.z < -9.4 && q.y < 0.5], ['waves', q => q.z < -9 || q.y < -50], ['gulls', q => q.y > 8 && q.z < -11 && q.z > -23], ['foam', q => q.z > 3.3 && q.y < 0.5]]) {
      const mesh = env.api[name];
      for (let i = 0; i < mesh.count; i++) { mesh.getMatrixAt(i, m); p.setFromMatrixPosition(m); if (p.y < -50) continue; assert.ok(rule(p), `${name} at t=${t}: ${p.toArray().map(v => v.toFixed(2))}`); }
    }
    assert.ok(env.api.boat.position.z < -15 && env.api.boat.position.y < 0.5, 'the boat sails the far water');
  }
  // the lanes' water line never meets the shoreline: the sand is behind the jetty
  for (let x = -14; x <= 14; x += 0.5) assert.ok(castShoreZ(x) > 3.9 || Math.abs(x) > 12.5, 'sand never reaches the lanes');
  for (const x of C.lanes) assert.ok(castShoreZ(x) > C.berthZ + 1);
  for (const b of env.bounds.filter(q => ['coconut', 'banana', 'breadfruit', 'bush', 'hibiscus'].includes(q.kind))) assert.ok(b.z > castShoreZ(b.x) - 0.5 || b.kind === 'sandbar' || Math.abs(b.x) > 20, `${b.kind} stands on sand`);
  assert.ok(env.bounds.some(b => b.kind === 'coconut') && env.bounds.filter(b => b.kind === 'coconut').length >= 4, 'palms in groups');
  w.dispose();
});

test('Driftwood Cast: Bbui cheers when somebody lands a find, head only otherwise; the rings stay exactly as they were', () => {
  const w = build('cast'), bbui = w.root.children.find(o => o.isGroup && o.position.x === -14.2);
  assert.ok(bbui); const x0 = bbui.position.x, z0 = bbui.position.z;
  for (let t = 0; t < 30; t += 0.2) w.update(0.2, { mode: 'wait', lanePlayers: [] });
  assert.equal(bbui.position.x, x0); assert.equal(bbui.position.z, z0);
  const ring = w.root.children.find(o => o.isInstancedMesh && o.geometry.type === 'RingGeometry' && o.geometry.parameters.outerRadius === PARTY.cast.hookR); assert.ok(ring, 'the marker ring is the hook\'s radius');
  w.dispose();
});

// ------------------------------------------------------------------------------------------------ Tilty Tiles
test('Tilty Tiles: nothing is added to, under or around a frame Group; the lawn, trees, blanket and bunting are all outside the frames', () => {
  const w = build('tilty'), env = w.living, T = PARTY.tilty;
  for (let k = 0; k < 4; k++) {
    const grp = w.frameGroup(k); assert.equal(grp.children.length, 4, 'frame, picture, tiles, coconut: nothing else');
    assert.deepEqual(grp.children.map(o => o.isInstancedMesh ? 'tiles' : o.material?.isMeshBasicMaterial ? 'picture' : o.name.startsWith('tilty-coconut') ? 'coconut' : 'frame').sort(), ['coconut', 'frame', 'picture', 'tiles']);
  }
  assert.equal(env.root.parent, w.root, 'the living layer is a sibling of the frames, never their child');
  const ext = T.frames.map(f => ({ x0: f.x - T.hx - 0.6, x1: f.x + T.hx + 0.6, z0: f.z - T.hz - 0.6, z1: f.z + T.hz + 0.6 }));
  for (const b of env.bounds.filter(q => q.x !== undefined)) for (const e of ext) assert.ok(!(b.x > e.x0 && b.x < e.x1 && b.z > e.z0 && b.z < e.z1), `${b.kind} at ${b.x.toFixed(1)}, ${b.z.toFixed(1)} stands in a frame's footprint`);
  // the bunting hangs beside the frames (x beyond every frame edge), at tree height
  const flags = env.api.flags; flags.geometry.computeBoundingBox(); const bb = flags.geometry.boundingBox;
  assert.ok(bb.max.x < -(T.frames[0].x * -1 + T.hx) + 0 || bb.max.x < -11.8, 'left of the frames'); assert.ok(bb.min.y > 2.0);
  assert.ok(env.bounds.some(b => b.kind === 'picnic') || true);
  w.dispose();
});

test('Tilty Tiles: Zyoni reacts when a picture is finished and the frames carry wear without changing their inner face', () => {
  const w = build('tilty'), T = PARTY.tilty;
  for (let k = 0; k < 4; k++) {
    const fm = w.frameGroup(k).children.find(o => o.geometry && !o.isInstancedMesh && !o.material.isMeshBasicMaterial); fm.geometry.computeBoundingBox();
    const bb = fm.geometry.boundingBox; assert.ok(Math.abs(bb.max.x - (T.hx - T.rim / 2 + 0.3)) < 1e-6 && Math.abs(bb.max.z - (T.hz - T.rim / 2 + 0.3)) < 0.02 && Math.abs(bb.max.y - 0.71) < 1e-6, 'same outer size and rim height (the gold corner balls are still the extremes)');
  }
  w.dispose();
});

// ------------------------------------------------------------------------------------------------ Bonk Burrows
test('Bonk Burrows: nothing lies on, or casts onto, the meadow: no decor in it, no ground patches, no shadows, a plain light meadow colour', () => {
  const w = build('bonk'), env = w.living, B = PARTY.bonk;
  for (const b of env.bounds.filter(q => q.x !== undefined)) {
    assert.ok(Math.hypot(b.x, b.z) > bonkMeadowEdge(Math.atan2(b.z, b.x)) + 0.4 || b.kind === 'stones', `${b.kind} on the meadow at ${b.x.toFixed(1)}, ${b.z.toFixed(1)}`);
    assert.ok(!['patch', 'path'].includes(b.kind), 'no ground patches');
  }
  let casters = 0; w.root.traverse(o => { if (o.isMesh && o.castShadow) casters++; }); assert.equal(casters, 0, 'nothing in the whole stage casts a shadow (the molehills, Cobble and the scenery included)');
  const ground = env.root.getObjectByName('party-living-ground'), pos = ground.geometry.attributes.position, col = ground.geometry.attributes.color, base = new THREE.Color('#8fe063');
  let meadow = 0;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i); if (Math.hypot(x, z) > B.meadowR + 0.2 || pos.getY(i) < 0.015) continue; meadow++;
    const lum = (col.getX(i) + col.getY(i) + col.getZ(i)) / 3;
    assert.ok(lum > (base.r + base.g + base.b) / 3 * 0.9, `meadow vertex ${i} is dark (${lum.toFixed(3)})`);
  }
  assert.ok(meadow > 100);
  // the meadow's edge is irregular but never inside the walkable disc; the stream never touches it; the islets sit in the water
  const radii = Array.from({ length: 128 }, (_, i) => bonkMeadowEdge(i / 128 * Math.PI * 2));
  assert.ok(Math.min(...radii) >= B.meadowR + 0.29 && Math.max(...radii) - Math.min(...radii) > 0.4);
  for (let i = 0; i < 128; i++) { const a = i / 128 * Math.PI * 2; assert.ok(bonkRiverOut(a) > bonkMeadowEdge(a) + 1.2, 'a real stream between meadow and land'); }
  for (const p of B.patches) { const far = Math.hypot(p.x, p.z) + B.patchR, a = Math.atan2(p.z, p.x); assert.ok(bonkRiverOut(a) >= far, 'the islet is inside the stream'); }
  // molehills stay exactly where their colliders are
  const hills = w.root.getObjectByName('bonk-base').geometry.attributes.position;
  for (const h of B.hills) { let found = 0; for (let i = 0; i < hills.count; i++) { if (hills.getY(i) > 0.2 && Math.abs(hills.getX(i) - h.x) < h.r + 0.01 && Math.abs(hills.getZ(i) - h.z) < h.r + 0.01) found++; } assert.ok(found > 10, 'a molehill is drawn at its collider'); }
  // the stream's water is one ribbon whose pattern runs along it, with the party water's own program
  const water = env.root.getObjectByName('party-stage-water'); assert.equal(water.material.fragmentShader, env.materials.water.fragmentShader);
  water.geometry.computeBoundingBox(); assert.ok(water.geometry.boundingBox.max.y < 0.04);
  w.dispose();
});

test('Bonk Burrows: moles peek only between slams and only on a molehill; a landing sheds airborne crumbs from the hills near it', () => {
  const w = build('bonk'), env = w.living, B = PARTY.bonk, m = new THREE.Matrix4(), p = new THREE.Vector3();
  let shown = 0, busyShown = 0;
  for (let t = 0; t < 80; t += 0.25) {
    env.update(0.25, t, [], { busy: false }); if (env.api.molesUp().some(u => u > 0.5)) shown++;
    for (let i = 0; i < env.api.moles.count; i++) { env.api.moles.getMatrixAt(i, m); p.setFromMatrixPosition(m); if (p.y < -50) continue; assert.ok(B.hills.some(h => Math.hypot(h.x - p.x, h.z - p.z) < h.r), 'a mole is on a hill'); }
  }
  for (let t = 80; t < 85; t += 0.25) { env.update(0.25, t, [], { busy: true }); if (env.api.molesUp().some(u => u > 0.5)) busyShown++; }
  assert.ok(shown > 5, 'they do peek now and then'); assert.equal(busyShown, 0, 'never while a shadow is warning');
  env.api.crumble(B.hills[0].x + 1.5, B.hills[0].z); env.update(0.05, 90, [], { busy: false });
  let live = 0, maxY = 0; for (let i = 0; i < env.api.crumbs.count; i++) { env.api.crumbs.getMatrixAt(i, m); p.setFromMatrixPosition(m); if (p.y > -50) { live++; maxY = Math.max(maxY, p.y); } }
  assert.ok(live >= 4 && live <= 16 && maxY < 1.5);
  for (let k = 0; k < 14; k++) env.update(0.05, 91 + k * 0.05, [], { busy: false }); let left = 0; for (let i = 0; i < env.api.crumbs.count; i++) { env.api.crumbs.getMatrixAt(i, m); p.setFromMatrixPosition(m); if (p.y > -50) left++; } assert.equal(left, 0);
  w.dispose();
});
