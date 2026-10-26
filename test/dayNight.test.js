import test from 'node:test';
import assert from 'node:assert/strict';
import { DayNight, TIME_KEY } from '../public/js/world/dayNight.js';
import { DAY_PHASES, PALETTE } from '../public/js/config.js';

const clock = (query = '') => new DayNight({ persist: false, params: new URLSearchParams(query) });
const near = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);

test('every phase consumes its configured real duration, including midnight', () => {
  for (const p of DAY_PHASES) {
    const c = clock(); c.set(p.start); c.update(p.seconds);
    near(c.hour, p.end);
  }
});

test('elapsed game hours count complete days, stay frozen under daylock and ignore clock edits', () => {
  const c = clock();
  c.update(630);
  near(c.elapsedHours, 24);
  c.set(23.9);
  near(c.elapsedHours, 24);
  const before = c.elapsedHours;
  c.update(5);
  assert.ok(c.elapsedHours > before);
  c.locked = true;
  const locked = c.elapsedHours;
  c.update(630);
  near(c.elapsedHours, locked);
});

test('large steps and small frame steps agree across every boundary', () => {
  const a = clock(), b = clock();
  a.set(19.9); b.set(19.9);
  a.update(725);
  for (let i = 0; i < 43500; i++) b.update(1 / 60);
  near(a.hour, b.hour, 1e-7);
  const full = clock(); full.update(630); near(full.hour, 8);
});

test('phase events are ordered, once per crossing, and can unsubscribe', () => {
  const c = clock(); c.set(5);
  const seen = [];
  const off = c.on('phase', (p) => seen.push(p));
  c.update(630);
  assert.deepEqual(seen, ['day', 'dusk', 'night', 'dawn']);
  off(); c.set(12); assert.equal(seen.length, 4);
});

test('URL presets, numeric wrapping, invalid values and locking', () => {
  for (const [preset, hour] of [['dawn', 6], ['noon', 12], ['dusk', 18.5], ['night', 0], ['25', 1], ['-1', 23], ['bad', 8], ['', 8]]) {
    near(clock(`time=${preset}`).hour, hour);
  }
  const c = clock('time=noon&daylock'); c.speed = 100; c.update(600); near(c.hour, 12);
  c.set(0); near(c.hour, 0);
  c.locked = false; c.speed = 2; c.update(10); near(c.hour, 1);
  c.set(NaN); c.update(Infinity); c.update(-1); near(c.hour, 1);
  c.speed = NaN; c.update(10); near(c.hour, 1);
});

test('noon exactly retains the original colours, lights and exposure', () => {
  const c = clock('time=noon');
  assert.equal('#' + c.look.top.getHexString(), PALETTE.skyTop);
  assert.equal('#' + c.look.horizon.getHexString(), PALETTE.skyHorizon);
  assert.equal(c.look.hemiSky.getHexString(), 'd6efff');
  assert.equal(c.look.hemiGround.getHexString(), 'bff0a0');
  assert.equal(c.look.light.getHexString(), 'fff1d6');
  assert.equal(c.look.emissive.getHexString(), 'ffd6ea');
  for (const key of ['shallow', 'deep', 'foam', 'cloud']) assert.equal(c.look[key].getHexString(), 'ffffff');
  near(c.look.hemiIntensity, 0.9); near(c.lightIntensity, 2.7); near(c.look.exposure, 1);
  near(c.direction.x / c.direction.y, 48 / 70); near(c.direction.z / c.direction.y, 34 / 70);
});

test('light hand-offs are dark, nights readable, midnight continuous and vectors finite', () => {
  const c = clock();
  for (const h of [5.5, 19.5]) {
    c.set(h); near(c.lightIntensity, 0);
    c.set(h - 0.00001); assert.ok(c.lightIntensity < 1e-7);
    c.set(h + 0.00001); assert.ok(c.lightIntensity < 1e-7);
  }
  c.set(23.999999); const before = c.look.top.clone();
  c.set(0); for (const channel of ['r', 'g', 'b']) near(before[channel], c.look.top[channel], 1e-5);
  for (let h = 0; h < 24; h += 0.05) {
    c.set(h); near(c.direction.length(), 1);
    assert.ok(c.direction.y >= -1e-10);
    assert.ok(c.look.hemiIntensity >= 0.5);
    near(c.daylight + c.nightness, 1);
  }
});

test('saves resume the game hour and malformed/blocked storage stays playable', () => {
  const values = new Map();
  globalThis.localStorage = { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: (k) => values.delete(k) };
  try {
    const a = new DayNight(); a.set(22.25); a.dispose();
    const b = new DayNight(); near(b.hour, 22.25); b.update(5); b.dispose();
    near(new DayNight().hour, 22.5);
    for (const data of ['bad JSON', '{"v":1,"hour":"12"}', '{"v":1,"hour":99}', '{"v":3,"hour":12}']) {
      values.set(TIME_KEY, data); near(new DayNight().hour, 8);
    }
    globalThis.localStorage = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } };
    const c = new DayNight(); c.update(10); assert.ok(c.hour > 8);
  } finally { delete globalThis.localStorage; }
});
