import test from 'node:test';
import assert from 'node:assert/strict';
import { forEachFrameStep } from '../public/js/utils/frameSteps.js';
test('ten low-FPS frames advance a full second without exceeding player physics limit', () => {
  const steps = [];
  for (let i = 0; i < 10; i++) forEachFrameStep(0.1, (dt) => steps.push(dt));
  assert.equal(steps.length, 20);
  assert.ok(Math.abs(steps.reduce((sum, dt) => sum + dt, 0) - 1) < 1e-12);
  assert.ok(steps.every((dt) => dt <= 0.05));
});
test('normal frames retain elapsed time; suspended tabs have bounded catch-up', () => {
  let elapsed = 0;
  forEachFrameStep(1 / 60, (dt) => { elapsed += dt; });
  assert.equal(elapsed, 1 / 60);
  elapsed = 0;
  forEachFrameStep(60, (dt) => { elapsed += dt; });
  assert.equal(elapsed, 0.1);
  for (const dt of [NaN, Infinity, -1, 0]) forEachFrameStep(dt, () => assert.fail('invalid frame'));
});
