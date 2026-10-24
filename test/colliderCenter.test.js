import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addCollider, clearColliders, resolveCircle, overlapsAny } from '../public/js/world/colliders.js';

test('dead-center push performs the second spatial lookup after moving outside the original cells', () => {
  clearColliders();
  try {
    addCollider({ x: 0, z: 0, r: 10 });
    // The first push lands at10.5, inside a small prop that was outside the original hash lookup.
    // This prop pushes outward, so the existing two-pass solver has an unambiguous clear result.
    addCollider({ x: 10.2, z: 0, r: 0.2 });
    const position = { x: 0, z: 0 };
    resolveCircle(position, 0.5);
    assert.ok(position.x > 10.5);
    // Boundary arithmetic can differ by one ulp; use a negligible inset for the overlap query.
    assert.equal(overlapsAny(position.x, position.z, 0.5 - 1e-8), false);
  } finally { clearColliders(); }
});
