import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCharacter } from '../public/js/player/character.js';
import { attachVariant, CHARACTER_VARIANTS, normaliseVariant } from '../public/js/player/characterVariants.js';
const documentStub = () => ({ createElement: () => ({ getContext: () => ({ createRadialGradient: () => ({ addColorStop() {} }), fillRect() {}, beginPath() {}, arc() {}, fill() {} }) }) });

test('six original cosmetic choices include the unchanged default and friendly skeleton', () => {
  assert.equal(CHARACTER_VARIANTS.length, 6);
  assert.equal(new Set(CHARACTER_VARIANTS.map((v) => v.id)).size, 6);
  assert.equal(normaliseVariant('unknown'), 'original');
  assert.equal(CHARACTER_VARIANTS.find((v) => v.id === 'sunny').description.includes('skeleton'), true);
});

test('each overlay preserves socket transforms, contains finite geometry, frees only owned meshes, and restores default', () => {
  const before = globalThis.document; globalThis.document = documentStub();
  try {
    for (const variant of CHARACTER_VARIANTS) {
      const ch = createCharacter(), p = ch.parts;
      const base = [], sockets = [p.headSocket, p.handSocket, p.offhandSocket, p.backSocket];
      ch.root.traverse((o) => base.push([o, o.visible]));
      const transforms = sockets.map((s) => [s.position.toArray(), s.rotation.toArray(), s.scale.toArray()]);
      const colors = ch.colors;
      const cleanup = attachVariant(ch, variant.id);
      assert.deepEqual(sockets.map((s) => [s.position.toArray(), s.rotation.toArray(), s.scale.toArray()]), transforms);
      const geometries = new Set(); let disposed = 0;
      ch.root.traverse((o) => {
        if (!o.name.startsWith('variant-')) return;
        geometries.add(o.geometry); o.geometry.addEventListener('dispose', () => disposed++);
        for (const v of o.geometry.attributes.position.array) assert.ok(Number.isFinite(v));
        assert.equal(o.material.stencilWrite, true);
        assert.equal(o.material, p.head.material);
      });
      if (variant.id === 'original') assert.equal(geometries.size, 0);
      cleanup(); cleanup();
      assert.equal(disposed, geometries.size);
      for (const [o, visible] of base) assert.equal(o.visible, visible);
      assert.deepEqual(ch.colors, colors);
      const remaining = []; ch.root.traverse((o) => remaining.push(o));
      assert.deepEqual(remaining, base.map(([o]) => o));
      ch.dispose();
    }
  } finally { if (before === undefined) delete globalThis.document; else globalThis.document = before; }
});

test('replacing a variant cleans up old resources and old cleanup cannot remove the new variant', () => {
  const before = globalThis.document; globalThis.document = documentStub();
  try {
    const ch = createCharacter();
    const first = attachVariant(ch, 'pip'); const second = attachVariant(ch, 'sunny');
    first();
    assert.ok(ch.root.getObjectByName('variant-sunny'));
    assert.equal(ch.root.getObjectByName('variant-pip'), undefined);
    attachVariant(ch, 'original'); second();
    assert.equal(ch.parts.head.visible, true); assert.equal(ch.defaultHat.visible, true);
    ch.dispose();
  } finally { if (before === undefined) delete globalThis.document; else globalThis.document = before; }
});
