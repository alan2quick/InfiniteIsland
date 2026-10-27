// Ruby model structure, budgets, shell switching, animation and deterministic vertex colours (no GPU).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildRuby, RUBY_SHELLS, RUBY_ANIMS } from '../public/js/npc/petsEmber.js';
import { petMaterial } from '../public/js/npc/pets.js';
import { sizeOf, triangleCount } from '../public/js/npc/petsKit.js';
import { PET } from '../public/js/config.js';

test('Ruby: every shell is under four main+shadow draws, 15k triangles, knee high, shared stencil material and no lights', () => {
  for (const shell of RUBY_SHELLS) {
    const m = buildRuby({ shell }), s = sizeOf(m.root), triangles = m.meshes.reduce((n, mesh) => n + triangleCount(mesh.geometry), 0);
    let draws = 0, lights = 0;
    m.root.traverseVisible((o) => { if (o.isMesh) { draws += o.castShadow ? 2 : 1; assert.equal(o.material, petMaterial()); } if (o.isLight) lights++; });
    assert.equal(draws, 4); assert.equal(m.drawCalls, draws); assert.equal(lights, 0); assert.ok(triangles < 15000);
    assert.ok(s.z > 0.65 * PET.ruby.modelScale && s.z < 0.8 * PET.ruby.modelScale); assert.ok(s.box.max.y > 0.4 * PET.ruby.modelScale && s.box.max.y < 0.6 * PET.ruby.modelScale);
    assert.equal(petMaterial().stencilWrite, true); assert.equal(petMaterial().stencilRef, 1);
    for (const mesh of m.meshes) {
      const a = mesh.geometry.attributes;
      assert.ok(mesh.isSkinnedMesh); assert.ok(a.aWave && a.aGlow && a.aMark && a.skinIndex && a.skinWeight);
      for (const attr of Object.values(a)) assert.ok(Array.from(attr.array).every(Number.isFinite));
      assert.ok(Array.from(a.aWave.array).every((x) => x === 0), 'no flying shader motion');
      const outline = new THREE.Color('#2b2340'); let hulls = 0;
      for (let i = 0; i < a.position.count; i++) if (a.aMark.getW(i) > 0.5) { hulls++; assert.ok(Math.abs(a.color.getX(i) - outline.r) < 1e-6); }
      assert.ok(hulls > 0);
    }
    console.log(`Ruby ${shell}: ${draws} draws, ${triangles} triangles, ${[s.x,s.y,s.z].map((v) => v.toFixed(3)).join(' x ')} u, top ${s.box.max.y.toFixed(3)}`);
    m.dispose();
  }
});
test('Ruby: animations reset safely, alternate legs, hide with peeking eyes, wave/dig, expose abdomen in swap, and scale', () => {
  const m = buildRuby();
  for (const anim of RUBY_ANIMS) for (let i = 0; i < 20; i++) { m.update(0.02, i * 0.1, { anim, speed: 2 }); sizeOf(m.root); for (const b of Object.values(m.bones)) assert.ok(Number.isFinite(b.rotation.x + b.position.y + b.scale.x)); }
  m.update(0.1, 1, { anim: 'walk', speed: 1 }); assert.ok(m.bones['leg1:0'].rotation.y * m.bones['leg1:1'].rotation.y <= 0);
  m.update(0, 1, { anim: 'hide' }); assert.ok(m.bones.body.scale.x < 0.02); assert.equal(m.bones.eyes.scale.x, 0.65);
  m.update(0, 1, { anim: 'wave' }); assert.ok(m.bones['claw-1'].rotation.x < -0.5); assert.equal(m.bones.body.scale.x, 1);
  m.update(0, 1, { anim: 'swap' }); assert.equal(m.meshes[1].visible, false); assert.equal(m.bones.abdomen.scale.x, 1);
  m.update(0, 1); assert.equal(m.meshes[1].visible, true); assert.equal(m.bones.abdomen.scale.x, 0.001);
  const full = sizeOf(m.root); m.setSize(0.5); const half = sizeOf(m.root); assert.ok(Math.abs(half.z - full.z / 2) < 1e-6);
  m.dispose();
});
test('Ruby: shell changes dispose replaced geometry/skeleton, keep two meshes; all resources freed on dispose', () => {
  const m = buildRuby(); let disposed = 0;
  m.meshes[1].geometry.addEventListener('dispose', () => disposed++);
  for (const shell of RUBY_SHELLS) { m.setShell(shell); assert.equal(m.state.shell, shell); assert.equal(m.meshes.length, 2); assert.equal(m.rig.children.length, 2); }
  assert.equal(disposed, 1); assert.throws(() => m.setShell('bad')); assert.throws(() => buildRuby({ shell: 'bad' }));
  for (const mesh of m.meshes) mesh.geometry.addEventListener('dispose', () => disposed++);
  const scene = new THREE.Scene(); scene.add(m.root); m.dispose(); assert.equal(disposed, 3); assert.equal(scene.children.length, 0);
});
test('Ruby: freckles and growth stripes are deterministic vertex colours without textures', () => {
  const a = buildRuby(), b = buildRuby();
  for (let i = 0; i < 2; i++) assert.deepEqual(a.meshes[i].geometry.attributes.color.array, b.meshes[i].geometry.attributes.color.array);
  assert.equal(a.mesh.material.map, null);
  const colors = a.mesh.geometry.attributes.color, cream = new THREE.Color('#fff0cd'); let freckles = 0;
  for (let i = 0; i < colors.count; i++) if (Math.abs(colors.getX(i) - cream.r) < 1e-6 && Math.abs(colors.getY(i) - cream.g) < 1e-6) freckles++;
  assert.ok(freckles > 50); a.dispose(); b.dispose();
});

test('Ruby polish: small cream dots cover every leg, both claws and the head; eyes have two white glints', () => {
  const m = buildRuby(), a = m.mesh.geometry.attributes, cream = new THREE.Color('#fff0cd');
  const names = m.mesh.skeleton.bones.map(b => b.name), counts = new Map(); let eyeWhite = 0;
  for (let i = 0; i < a.position.count; i++) {
    const bone = names[a.skinIndex.getX(i)];
    if (Math.abs(a.color.getX(i) - cream.r) < 1e-6 && Math.abs(a.color.getY(i) - cream.g) < 1e-6) counts.set(bone, (counts.get(bone) || 0) + 1);
    if (bone === 'eyes' && a.color.getX(i) === 1 && a.color.getY(i) === 1 && a.color.getZ(i) === 1) eyeWhite++;
  }
  for (const name of ['body', 'claw-1', 'claw1', ...[-1, 1].flatMap(s => [0, 1, 2].map(i => `leg${s}:${i}`))]) assert.ok(counts.get(name) >= 80, name);
  assert.ok(eyeWhite >= 100); m.dispose();
});

test('Ruby polish: home growth ribbons face outward and retain a clear brown vertex colour', () => {
  const m = buildRuby(), g = m.meshes[1].geometry, a = g.attributes, brown = new THREE.Color('#805137'); let stripes = 0, outward = 0;
  const v = new THREE.Vector3(), w = new THREE.Vector3(), n = new THREE.Vector3(), p = new THREE.Vector3(), q = new THREE.Vector3(), r = new THREE.Vector3();
  for (let i = 0; i < g.index.count; i += 3) {
    const ia = g.index.getX(i), ib = g.index.getX(i + 1), ic = g.index.getX(i + 2);
    if (Math.abs(a.color.getX(ia) - brown.r) > 1e-6 || Math.abs(a.color.getY(ia) - brown.g) > 1e-6) continue;
    stripes++; p.fromBufferAttribute(a.position, ia); q.fromBufferAttribute(a.position, ib); r.fromBufferAttribute(a.position, ic);
    v.subVectors(q, p); w.subVectors(r, p); n.fromBufferAttribute(a.normal, ia);
    if (v.cross(w).dot(n) > 0) outward++;
  }
  assert.ok(stripes > 3000); assert.equal(outward, stripes); m.dispose();
});
