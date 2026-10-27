// Step 74a: the work-in-progress pet models (caterpillar, cocoon, Carle butterfly, grey / arctic wolf) and the pet lab viewer, in Node (no GPU): budgets, sizes, pivots, animations, determinism,
// dispose, the registry untouched, and the lab (show / lineup / clear / summary / update).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
const storage = new Map();
globalThis.localStorage = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) };
const { PETS, petMaterial } = await import('../public/js/npc/pets.js');
const { PET_IDS } = await import('../public/js/game/petLogic.js');
const { createWipPetModel, WIP_KEYS, WIP_ANIMS, PET_MODELS_WIP } = await import('../public/js/npc/petsWip.js');
const { crawlChain, segRadius, SEG_GREENS, CAT, wingPanels, butterflyFlap, cocoonShake, cocoonBand } = await import('../public/js/npc/petsHome.js');
const { wolfGait } = await import('../public/js/npc/petsFrost.js');
const { triangleCount, sizeOf, vnoise, hash3 } = await import('../public/js/npc/petsKit.js');
const { createPetLab } = await import('../public/js/world/petLab.js');

const range = (v, lo, hi, what) => assert.ok(v >= lo && v <= hi, `${what} ${v.toFixed(3)} not in ${lo}..${hi}`);
const meshesOf = (m) => { const out = []; m.root.traverse((o) => { if (o.isMesh) out.push(o); }); return out; };

test('Carle is promoted into the registry; the stage models and Snowsong remain in the WIP table', () => {
  assert.deepEqual(PET_IDS, ['capray', 'carle', 'ruby']);
  assert.deepEqual(PETS.map((p) => p.id), ['capray', 'carle', 'ruby']);
  assert.deepEqual(WIP_KEYS, ['carle:caterpillar', 'carle:cocoon', 'carle:butterfly', 'snowsong']);
  assert.equal(Object.keys(PET_MODELS_WIP).length, 4);
  assert.throws(() => createWipPetModel('ghost'));
});

test('every model: one skinned mesh on the shared pet material, 2 draw calls, under 20k triangles, no lights, outline colour, finite attributes', () => {
  for (const key of WIP_KEYS) {
    const m = createWipPetModel(key);
    const meshes = meshesOf(m);
    assert.equal(meshes.length, 1, key); assert.ok(meshes[0].isSkinnedMesh, key); assert.equal(meshes[0].material, petMaterial());
    assert.equal(meshes.filter((x) => x.castShadow).length, 1);
    assert.equal(m.drawCalls, 2, key); assert.ok(m.drawCalls <= 8);
    const geo = meshes[0].geometry, a = geo.attributes;
    assert.ok(a.position && a.normal && a.color && a.aMark && a.aGlow && a.aWave && a.skinIndex && a.skinWeight && geo.index, key);
    range(triangleCount(geo), 500, 20000, `${key} triangles`);
    let hull = 0, bad = 0;
    for (let i = 0; i < a.position.count; i++) {
      if (!Number.isFinite(a.position.getX(i) + a.position.getY(i) + a.position.getZ(i) + a.normal.getY(i) + a.color.getX(i))) bad++;
      if (a.aMark.getW(i) > 0.5) { hull++; assert.ok(Math.abs(a.color.getX(i) - new THREE.Color('#2b2340').r) < 1e-6, 'hull colour'); }
      assert.ok(a.skinIndex.getX(i) < m.skeleton.bones.length); assert.equal(a.skinWeight.getX(i), 1);
    }
    assert.equal(bad, 0); assert.ok(hull > 0 || key === 'carle:butterfly', `${key} has outline hulls`);
    let lights = 0; m.root.traverse((o) => { if (o.isLight) lights++; }); assert.equal(lights, 0);
    m.dispose();
  }
  assert.equal(petMaterial().customProgramCacheKey(), 'pet-toon');
});

test('sizes: caterpillar about 0.75 u long, cocoon about 0.45 u from the thread top, butterfly about 1.0 u across, wolf about 1.1 u nose to tail with the shoulder near 0.6 u', () => {
  const cat = createWipPetModel('carle:caterpillar'), coc = createWipPetModel('carle:cocoon'), but = createWipPetModel('carle:butterfly'), wolf = createWipPetModel('snowsong');
  range(cat.length, 0.65, 0.9, 'caterpillar length'); range(cat.height, 0.3, 0.65, 'caterpillar height');
  const cs = sizeOf(coc.root); range(cs.box.min.y, -0.5, -0.4, 'cocoon bottom (origin = the thread top)'); range(cs.box.max.y, 0, 0.2, 'twig top');
  range(but.wingspan, 0.9, 1.15, 'butterfly wingspan'); range(but.length, 0.4, 1.0, 'butterfly length');
  range(wolf.length, 1.0, 1.3, 'wolf length'); assert.equal(wolf.shoulder, 0.625); range(sizeOf(wolf.root).box.min.y, -0.02, 0.02, 'wolf feet at y = 0');
  const catBox = sizeOf(cat.root).box; range(catBox.min.y, -0.02, 0.03, 'caterpillar feet at y = 0');
  for (const m of [cat, coc, but, wolf]) m.dispose();
});

test('named pivots exist for every model', () => {
  const cat = createWipPetModel('carle:caterpillar'), coc = createWipPetModel('carle:cocoon'), but = createWipPetModel('carle:butterfly'), wolf = createWipPetModel('snowsong');
  assert.ok(cat.headPivot.isBone); assert.equal(cat.segments.length, CAT.n); assert.ok(cat.segments.every((b) => b.isBone));
  for (const k of ['shellPivot', 'flapL', 'flapR']) assert.ok(coc[k].isBone, k);
  assert.equal(typeof coc.crack, 'function');
  for (const k of ['wingL', 'wingR']) assert.ok(but[k].isBone, k);
  for (const k of ['headPivot', 'tailPivot', 'legFL', 'legFR', 'legBL', 'legBR', 'earL', 'earR', 'jawPivot']) assert.ok(wolf[k].isBone, k);
  for (const m of [cat, coc, but, wolf]) { assert.ok(m.root.isGroup && m.rig.isGroup && m.meshes.length === 1); m.dispose(); }
});

const snap = (m) => m.skeleton.bones.map((b) => [b.position.x, b.position.y, b.position.z, b.rotation.x, b.rotation.y, b.rotation.z]);
function run(m, anim, seconds = 2, speed = 1) { for (let t = 0; t < seconds; t += 1 / 30) m.update(1 / 30, t, { anim, speed }); }

test('every animation runs without throwing and keeps finite bone transforms', () => {
  for (const key of WIP_KEYS) {
    for (const anim of [...WIP_ANIMS[key], 'nonsense']) {
      const m = createWipPetModel(key);
      run(m, anim, 2);
      for (const row of snap(m)) for (const v of row) assert.ok(Number.isFinite(v), `${key} ${anim}`);
      const s = sizeOf(m.root); assert.ok(Number.isFinite(s.x + s.y + s.z) && s.x < 3 && s.y < 3 && s.z < 3);
      m.dispose();
    }
  }
});

test('caterpillar: the crawl is an inch-worm (the arch travels tail to head, the segments bunch up under it), idle breathes and looks about, nibble dips the head', () => {
  const rest = crawlChain(0, 0);
  assert.equal(rest.y.length, CAT.n);
  assert.ok(rest.lift[5] > 0.12 && rest.lift[0] < 1e-9 && rest.lift[1] < 1e-9 && rest.lift[CAT.n - 1] < 1e-9 && rest.lift[CAT.n - 2] < 1e-9, 'a hump in the middle, the ends on the ground');
  assert.ok(rest.lift[5] >= Math.max(...rest.lift) - 1e-9, 'the middle is the highest');
  assert.ok(segRadius(0) < segRadius(5) && segRadius(10) < segRadius(5), 'small tail, big middle');
  assert.equal(SEG_GREENS.length, CAT.n);
  let prevPeak = -1, rising = 0;
  for (let ph = 0.02; ph < 0.98; ph += 0.04) {
    const c = crawlChain(ph, 1);
    const peak = c.lift.indexOf(Math.max(...c.lift));
    if (peak >= prevPeak) rising++;
    prevPeak = peak;
    assert.ok(Math.max(...c.lift) <= 0.25);
  }
  assert.ok(rising >= 22, 'the highest segment moves from the tail toward the head');
  const flatSpan = CAT.gap * (CAT.n - 1), span = (c) => c.z[CAT.n - 1] - c.z[0];
  assert.ok(span(crawlChain(0.4, 1)) < flatSpan && span(rest) < flatSpan, 'the chain is shorter while arched');
  const m = createWipPetModel('carle:caterpillar');
  const before = snap(m).map((r) => r.slice());
  run(m, 'crawl', 1.2);
  const after = snap(m);
  assert.ok(after.some((r, i) => Math.abs(r[1] - before[i][1]) > 0.04), 'segments rise in the crawl');
  assert.ok(m.state.k > 0.9);
  m.update(1 / 30, 3, { anim: 'idle' }); const h1 = m.headPivot.rotation.y; m.update(1 / 30, 5, { anim: 'idle' });
  assert.notEqual(h1, m.headPivot.rotation.y, 'the head looks around');
  m.dispose();
});

test('cocoon: it sways, wiggles, and crack(k) splits the top open with the flap pivots (no geometry edits)', () => {
  const m = createWipPetModel('carle:cocoon');
  const geoBefore = Array.from(m.mesh.geometry.attributes.position.array.slice(0, 30));
  m.update(1 / 30, 0, { anim: 'idle' }); assert.equal(Math.abs(m.flapL.rotation.z), 0); assert.equal(Math.abs(m.flapR.rotation.z), 0);
  m.update(1 / 30, 1.3, { anim: 'idle' }); assert.notEqual(m.shellPivot.rotation.z, 0, 'sway');
  m.crack(1); m.update(1 / 30, 2, { anim: 'idle' });
  assert.ok(m.flapR.rotation.z < -0.9 && m.flapL.rotation.z > 0.9, 'the flaps open outward');
  m.crack(0.5); m.update(1 / 30, 2, { anim: 'idle' }); assert.ok(Math.abs(m.flapL.rotation.z) < 0.6 && Math.abs(m.flapL.rotation.z) > 0.4);
  m.update(1 / 30, 2, { anim: "idle", crack: 0 }); assert.equal(Math.abs(m.flapL.rotation.z), 0);
  assert.ok(cocoonShake(4.5) > 0.9 && cocoonShake(1) === 0, 'the wiggle envelope is a short burst');
  let wig = 0; for (let t = 0; t < 1.5; t += 1 / 30) { m.update(1 / 30, t, { anim: 'wiggle' }); wig = Math.max(wig, Math.abs(m.shellPivot.rotation.x)); }
  assert.ok(wig > 0.04, 'a wiggle shakes the shell');
  let maxCrack = 0; const h = createWipPetModel('carle:cocoon'); for (let t = 0; t < 7; t += 1 / 30) { h.update(1 / 30, t, { anim: 'hatch' }); maxCrack = Math.max(maxCrack, h.state.crack); }
  assert.ok(maxCrack > 0.95, 'the hatch loop opens the shell fully');
  assert.deepEqual(Array.from(m.mesh.geometry.attributes.position.array.slice(0, 30)), geoBefore, 'geometry is never rewritten');
  const a = cocoonBand(0.1, 0.3), b = cocoonBand(0.9, 0.3); assert.ok(b.band > a.band, 'bands climb the shell');
  m.dispose(); h.dispose();
});

test('butterfly: collage panels, flaps on wingL / wingR (mirrored), glide slower than flutter, the rest pose folds the wings up over the back', () => {
  const panels = wingPanels();
  assert.ok(panels.length >= 25 && panels.some((p) => p.kind === 'disc') && panels.every((p) => typeof p.color === 'function'));
  assert.ok(butterflyFlap('flap').omega > butterflyFlap('glide').omega * 3); assert.ok(butterflyFlap('rest').centre > 1.3);
  const m = createWipPetModel('carle:butterfly');
  let lo = 9, hi = -9;
  for (let t = 0; t < 2; t += 1 / 60) { m.update(1 / 60, t, { anim: 'glide' }); lo = Math.min(lo, m.wingR.rotation.z); hi = Math.max(hi, m.wingR.rotation.z); assert.ok(Math.abs(m.wingR.rotation.z + m.wingL.rotation.z) < 1e-9, 'mirrored'); }
  assert.ok(hi - lo > 0.9, `glide sweep ${(hi - lo).toFixed(2)}`);
  run(m, 'rest', 2); assert.ok(m.wingR.rotation.z > 1.3 && m.wingL.rotation.z < -1.3, 'folded up');
  const folded = sizeOf(m.root); assert.ok(folded.x < 0.5 && folded.y > 0.35, `folded ${folded.x.toFixed(2)} x ${folded.y.toFixed(2)}`);
  run(m, 'flap', 1); assert.ok(m.state.omega > 15);
  const open = createWipPetModel('carle:butterfly'); assert.ok(sizeOf(open.root).x > 0.9);
  const att = m.mesh.geometry.attributes; let wingVerts = 0; for (let i = 0; i < att.position.count; i++) if (att.skinIndex.getX(i) > 0) wingVerts++; assert.ok(wingVerts > att.position.count * 0.5);
  m.dispose(); open.dispose();
});

test('wolf: the trot swings diagonal legs together, sit lowers the rump, howl lifts the head and opens the jaw, wag swings the tail, tilt twitches', () => {
  const g = wolfGait(1.1, 0.6);
  assert.equal(g.fl, g.br); assert.equal(g.fr, g.bl); assert.ok(Math.abs(g.fl + g.fr) < 1e-9, 'the pairs are half a cycle apart'); assert.ok(g.bob >= 0);
  const m = createWipPetModel('snowsong');
  m.update(1 / 30, 0, { anim: 'idle' }); const y0 = m.bodyPivot.position.y;
  let swing = 0; for (let t = 0; t < 1.5; t += 1 / 30) { m.update(1 / 30, t, { anim: 'trot' }); swing = Math.max(swing, Math.abs(m.legFL.rotation.x)); assert.ok(Math.abs(m.legFL.rotation.x - m.legBR.rotation.x) < 1e-9); }
  assert.ok(swing > 0.4);
  run(m, 'sit', 2); assert.ok(m.bodyPivot.position.y < y0 - 0.1 && m.bodyPivot.rotation.x < -0.4, 'rump down, chest up'); assert.ok(m.legBL.rotation.x < -0.45);
  run(m, 'howl', 2); assert.ok(m.headPivot.rotation.x < -0.6 && m.jawPivot.rotation.x > 0.3, 'head up, mouth open');
  let tail = 0; for (let t = 0; t < 1; t += 1 / 60) { m.update(1 / 60, t, { anim: 'wag' }); tail = Math.max(tail, Math.abs(m.tailPivot.rotation.y)); }
  assert.ok(tail > 0.4);
  run(m, 'tilt', 1.5); assert.ok(Math.abs(m.headPivot.rotation.z) > 0.2);
  let ear = 0; for (let t = 0; t < 9; t += 1 / 30) { m.update(1 / 30, t, { anim: 'idle' }); ear = Math.max(ear, Math.abs(m.earL.rotation.z)); } assert.ok(ear > 0.2, 'ear twitch');
  const a = m.mesh.geometry.attributes.color; let grey = 0, white = 0;
  for (let i = 0; i < a.count; i++) { const v = a.getX(i); if (v > 0.6) white++; else if (v < 0.5 && v > 0.15) grey++; }
  assert.ok(white > 100 && grey > 100, 'both a cream-white coat and a grey saddle');
  m.dispose();
});

test('deterministic: building twice gives identical geometry and colours (no Math.random), and the noise is in range', () => {
  for (const key of WIP_KEYS) {
    const a = createWipPetModel(key), b = createWipPetModel(key);
    const ga = a.mesh.geometry.attributes, gb = b.mesh.geometry.attributes;
    assert.equal(ga.position.count, gb.position.count);
    assert.deepEqual(Array.from(ga.color.array), Array.from(gb.color.array), key);
    assert.deepEqual(Array.from(ga.position.array), Array.from(gb.position.array), key);
    a.dispose(); b.dispose();
  }
  for (let i = 0; i < 200; i++) { const v = vnoise(i * 0.37, i * 0.11, i * 0.73, 3); assert.ok(v >= 0 && v < 1); assert.equal(hash3(i, 2, 3), hash3(i, 2, 3)); }
});

test('dispose frees the geometry and the skeleton and removes the root', () => {
  for (const key of WIP_KEYS) {
    const m = createWipPetModel(key), parent = new THREE.Group(); parent.add(m.root);
    let g = 0; m.mesh.geometry.addEventListener('dispose', () => { g++; });
    let s = 0; m.skeleton.addEventListener?.('dispose', () => { s++; });
    m.dispose(); assert.equal(g, 1, key); assert.equal(m.root.parent, null); assert.equal(parent.children.length, 0);
  }
});

test('the pet lab: show / lineup / clear / summary / update, only while something is shown', () => {
  const scene = new THREE.Scene();
  const p1 = { position: new THREE.Vector3(10, 2, 20), facing: 0 };
  const cam = { position: new THREE.Vector3(10, 12, 40) };
  const lab = createPetLab({ scene, players: { p1 }, heightAt: () => 2, camera: cam });
  assert.equal(lab.count, 0); lab.update(1); assert.equal(scene.children.length, 0, 'costs nothing when empty');
  const s = lab.show('snowsong', { anim: 'sit', spin: true });
  assert.equal(s.id, 'snowsong'); assert.equal(s.anim, 'sit'); assert.equal(lab.count, 1);
  assert.ok(Math.abs(s.pos.x - 10) < 0.01 && Math.abs(s.pos.z - 22.5) < 0.01 && Math.abs(s.pos.y - 2) < 0.01, '2.5 u in front of P1 on the terrain');
  const yaw0 = scene.children[0].rotation.y; lab.update(0.5); assert.ok(scene.children[0].rotation.y > yaw0, 'the turntable turns');
  assert.equal(lab.show('butterfly').id, 'carle:butterfly'); assert.equal(lab.count, 1, 'show replaces');
  assert.equal(lab.show('caterpillar', { anim: 'walk' }).anim, 'crawl');
  assert.throws(() => lab.show('dragon'));
  const sum = lab.lineup();
  assert.equal(sum.count, 4); assert.deepEqual(sum.items.map((i) => i.id), WIP_KEYS);
  for (const it of sum.items) { assert.ok(it.drawCalls >= 2 && it.drawCalls <= 8 && it.triangles > 0 && it.size.x > 0 && it.anim); }
  const xs = sum.items.map((i) => i.pos.x); assert.ok(xs[0] < xs[1] && xs[1] < xs[2] && xs[2] < xs[3], 'a row');
  assert.ok(sum.items[2].pos.y > sum.items[3].pos.y + 0.5, 'the butterfly hovers');
  for (let i = 0; i < 20; i++) lab.update(1 / 30);
  assert.equal(lab.summary().count, 4);
  lab.clear(); assert.equal(lab.count, 0); assert.equal(scene.children.length, 0); assert.equal(lab.summary().count, 0);
  const geos = []; scene.traverse((o) => { if (o.geometry) geos.push(o); }); assert.equal(geos.length, 0);
});


test('pet lab: Snowsong follows an explicit owner through ground terrain without entering PET_IDS', () => {
  const scene = new THREE.Scene(), owner = { index: 2, position: new THREE.Vector3(0, 0, 0), facing: 0 };
  const lab = createPetLab({ scene, players: { p1: owner }, heightAt: (x) => x * 0.02, walkable: () => true, blocked: () => false });
  assert.equal(lab.follow('snowsong').count, 1); assert.ok(!PET_IDS.includes('snowsong'));
  owner.position.x = 8;
  for (let i = 0; i < 300; i++) lab.update(1 / 60);
  const item = lab.summary().items[0];
  assert.ok(item.pos.x > 8); assert.ok(Math.abs(item.pos.y - item.pos.x * 0.02) < 0.02); assert.equal(item.anim, 'idle');
  assert.throws(() => lab.follow('butterfly'));
  lab.clear(); assert.equal(scene.children.length, 0);
});
