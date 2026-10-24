// Cosmetic props share the rig's material and hand socket but never own its
// equipment or character resources. Budgets include baked outline triangles.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCharacter } from '../public/js/player/character.js';
import { attachHeldProp, HELD_PROPS, normaliseHeldProp } from '../public/js/player/heldProps.js';
const documentStub = () => ({ createElement: () => ({ getContext: () => ({ createRadialGradient: () => ({ addColorStop() {} }), fillRect() {}, beginPath() {}, arc() {}, fill() {} }) }) });
function characterTest(fn) {
  const before = globalThis.document; globalThis.document = documentStub();
  const character = createCharacter();
  try { fn(character); } finally { character.dispose(); if (before === undefined) delete globalThis.document; else globalThis.document = before; }
}

test('prop choices are mostly whimsical, with empty hands preserving the original rig', () => characterTest(ch => {
  assert.deepEqual(HELD_PROPS.map(p => p.id), ['none', 'lantern', 'torch', 'flower', 'pinwheel', 'umbrella']);
  assert.equal(normaliseHeldProp('axe'), 'none');
  const children = [...ch.parts.handSocket.children];
  for (const id of ['none', 'original', 'unknown']) {
    const cleanup = attachHeldProp(ch, id); cleanup.update(10); cleanup.setHidden(true); cleanup(); cleanup();
    assert.equal(cleanup.object, null); assert.deepEqual(ch.parts.handSocket.children, children);
  }
  assert.doesNotThrow(() => attachHeldProp(null, 'torch')());
}));

test('every prop has bounded finite geometry, shared stencil shading and no lights or shadow submissions', () => characterTest(ch => {
  const socket = ch.parts.handSocket, transforms = [socket.position.toArray(), socket.rotation.toArray(), socket.scale.toArray()];
  const colors = ch.colors;
  let materialDisposals = 0; ch.parts.head.material.addEventListener('dispose', () => materialDisposals++);
  for (const { id } of HELD_PROPS.slice(1)) {
    const cleanup = attachHeldProp(ch, id), geometries = new Set();
    let draws = 0, triangles = 0, disposed = 0;
    cleanup.object.traverse(o => {
      assert.equal(Boolean(o.isLight), false);
      if (!o.isMesh) return;
      draws++; triangles += (o.geometry.index?.count || o.geometry.attributes.position.count) / 3;
      geometries.add(o.geometry); o.geometry.addEventListener('dispose', () => disposed++);
      for (const coordinate of o.geometry.attributes.position.array) assert.ok(Number.isFinite(coordinate));
      assert.equal(o.material, ch.parts.head.material); assert.equal(o.material.stencilWrite, true);
      assert.equal(o.castShadow, false); assert.equal(o.receiveShadow, false);
    });
    assert.ok(draws >= 1 && draws <= 2, `${id}: ${draws} draws`);
    assert.ok(triangles > 20 && triangles < 1800, `${id}: ${triangles} triangles including outlines`);
    ch.root.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(cleanup.object);
    assert.ok(bounds.min.y > 0, `${id} does not hang below the ground at rest`);
    assert.ok(bounds.max.y < 2.1, `${id} stays in a compact character-scale silhouette`);
    cleanup(); cleanup();
    assert.equal(disposed, geometries.size); assert.equal(materialDisposals, 0);
    assert.deepEqual([socket.position.toArray(), socket.rotation.toArray(), socket.scale.toArray()], transforms);
    assert.deepEqual(ch.colors, colors); assert.equal(socket.children.length, 0);
  }
}));

test('actual tools always take precedence; hiding a prop never removes or hides equipment', () => characterTest(ch => {
  const tool = new THREE.Group(); tool.name = 'real-axe'; ch.parts.handSocket.add(tool);
  const cleanup = attachHeldProp(ch, 'flower');
  assert.equal(cleanup.object.visible, false); assert.equal(tool.visible, true);
  tool.visible = false; cleanup.update(2); assert.equal(cleanup.object.visible, true);
  cleanup.update(3, { occupied: true }); assert.equal(cleanup.object.visible, false);
  cleanup.update(4); assert.equal(cleanup.object.visible, true);
  cleanup.setHidden(true); cleanup.update(5); assert.equal(cleanup.object.visible, false);
  cleanup.setHidden(false); assert.equal(cleanup.object.visible, true);
  tool.visible = true; cleanup.update(6); assert.equal(cleanup.object.visible, false);
  cleanup(); assert.equal(tool.parent, ch.parts.handSocket); assert.equal(tool.visible, true);
  tool.removeFromParent();
  let carrying = true;
  const movingTool = attachHeldProp(ch, 'torch', { isOccupied: () => carrying });
  assert.equal(movingTool.object.visible, false, 'tool moving toward socket also suppresses prop');
  carrying = false; movingTool.update(1); assert.equal(movingTool.object.visible, true); movingTool();
}));

test('replacing a prop frees old geometry once; animation and old cleanup cannot affect its replacement', () => characterTest(ch => {
  const first = attachHeldProp(ch, 'pinwheel');
  const moving = first.object.children.find(o => o.isGroup), start = moving.rotation.z;
  first.update(5); assert.notEqual(moving.rotation.z, start);
  let disposed = 0; first.object.traverse(o => o.geometry?.addEventListener('dispose', () => disposed++));
  const second = attachHeldProp(ch, 'umbrella');
  assert.equal(disposed, 2); assert.equal(first.object.parent, null);
  first(); first.update(10); first.setHidden(false);
  assert.equal(second.object.parent, ch.parts.handSocket); assert.equal(disposed, 2);
  assert.equal(ch.parts.handSocket.children.length, 1);
  attachHeldProp(ch, 'none'); second(); assert.equal(ch.parts.handSocket.children.length, 0);
}));
