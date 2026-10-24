// Captured from the unchanged baseline on Node 18, which matches its historical hashes.
// Keep identities, horizontal positions and every non-height field exact. V8's
// transcendental math changes sub-femtometre Y values between Node 18 and 24.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export function assertPlacementGolden(actual, fixture, historicalHash) {
  const expected = JSON.parse(readFileSync(new URL(`../fixtures/${fixture}.json`, import.meta.url), 'utf8'));
  assert.equal(createHash('md5').update(JSON.stringify(expected)).digest('hex').slice(0, 10), historicalHash,
    'fixture must retain the original placement fingerprint');
  assert.equal(actual.length, expected.length, `${fixture} record count`);
  for (let i = 0; i < expected.length; i++) {
    const { y, ...rest } = actual[i], { y: goldenY, ...goldenRest } = expected[i];
    assert.deepEqual(rest, goldenRest, `${fixture}[${i}] identity and placement`);
    assert.ok(Number.isFinite(y) && Math.abs(y - goldenY) <= 1e-12,
      `${fixture}[${i}] height ${y} differs from ${goldenY}`);
  }
}
