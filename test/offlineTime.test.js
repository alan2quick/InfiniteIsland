// Step 74b: offline time. advanceClock against stepping the real clock (many random hours / durations), the whole-cycle shortcut, the maxAway clamp, a device clock that went backwards, the time save v1 -> v2, the load
// catch-up (and when it must NOT happen: ?daylock, ?time, a replica, ?newgame, a short gap), the hidden-tab catch-up and its minGap, onCatchUp / flushCatchUp, the garden staying out of it, and hash / sync of the new hour.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DAY_PHASES, OFFLINE } from '../public/js/config.js';
import { advanceClock, awaySeconds, cycleSeconds } from '../public/js/game/offlineTime.js';
import { WorldSync } from '../public/js/net/worldSync.js';
import { mulberry32 } from '../public/js/utils/rng.js';
const values = new Map();
globalThis.localStorage = { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: (k) => values.delete(k) };
const { DayNight, TIME_KEY } = await import('../public/js/world/dayNight.js');

const near = (a, b, tolerance = 1e-6) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
const hourDiff = (a, b) => { let d = Math.abs(a - b) % 24; if (d > 12) d = 24 - d; return d; };
const clock = (query = '', extra = {}) => new DayNight({ persist: false, params: new URLSearchParams(query), ...extra });
const NAMES = DAY_PHASES.map((p) => p.name);

// ---- the pure maths ---------------------------------------------------------------------------------------------------------------------------------------------------------
test('one full day is 630 s and advanceClock leaves non-positive / junk durations alone', () => {
  assert.equal(cycleSeconds(), 630);
  for (const bad of [0, -5, NaN, Infinity, undefined, null]) { const r = advanceClock(7.3, bad); near(r.hour, 7.3); assert.deepEqual(r.entered, { dawn: 0, day: 0, dusk: 0, night: 0 }); }
  assert.equal(advanceClock(NaN, 10).hour >= 0, true);
});

test('advanceClock agrees with stepping the real clock for many random hours and durations', () => {
  const rng = mulberry32(7401);
  for (let k = 0; k < 160; k++) {
    const hour = rng() * 24, seconds = k < 40 ? rng() * 700 : k < 120 ? rng() * 5000 : rng() * 400000;
    const r = advanceClock(hour, seconds);
    const c = clock(); c.set(hour);
    const counts = Object.fromEntries(NAMES.map((n) => [n, 0]));
    c.on('phase', (p) => { counts[p]++; });
    let left = seconds;
    while (left > 0) { const dt = Math.min(left, 317); c.update(dt); left -= dt; }     // big steps are exact too (update consumes each phase at its own rate)
    assert.ok(hourDiff(r.hour, c.hour) < 1e-5, `hour ${hour} + ${seconds}s: ${r.hour} vs ${c.hour}`);
    assert.deepEqual(r.entered, counts, `phases entered for ${hour} + ${seconds}s`);
  }
});

test('whole cycles are one step: a day away crosses every boundary once and returns to the same hour; a month is a handful of steps', () => {
  for (const hour of [0, 4.99, 5, 6.5, 7, 12, 17.99, 18, 19.5, 20, 23.9]) {
    const r = advanceClock(hour, 630);
    near(r.hour, hour, 1e-6);
    assert.deepEqual(r.entered, { dawn: 1, day: 1, dusk: 1, night: 1 }, `at ${hour}`);
  }
  const month = advanceClock(9, 30 * 630 + 45 * 3);
  assert.equal(month.entered.dawn >= 30 && month.entered.dawn <= 31, true);
  const t0 = process.hrtime.bigint(); advanceClock(3, 1e12); assert.ok(Number(process.hrtime.bigint() - t0) < 5e6, 'a huge duration does not loop');
});

test('a step that just reaches a boundary crosses it (the same tolerance as the clock) and one second short does not', () => {
  const r = advanceClock(4.5, 45);                    // night ends at 5: 0.5 h at 0.05 h/s = 10 s to dawn; 45 s is deep into dawn
  assert.equal(r.entered.dawn, 1);
  const exact = advanceClock(7, 360);                  // day: 7 -> 18 in 360 s: lands on dusk
  assert.deepEqual(exact.entered, { dawn: 0, day: 0, dusk: 1, night: 0 }); near(exact.hour, 18);
  const short = advanceClock(7, 359); assert.equal(short.entered.dusk, 0);
});

test('awaySeconds clamps to maxAway, counts 0 for a clock that went backwards or a missing stamp', () => {
  assert.equal(awaySeconds(1000, 1000 + 900 * 1000), 900);
  assert.equal(awaySeconds(1000, 1000 + 900 * 1000 * 1e5), OFFLINE.maxAway);
  assert.equal(OFFLINE.maxAway, 30 * 24 * 3600);
  assert.equal(awaySeconds(5000, 1000), 0, 'the device clock went backwards');
  assert.equal(awaySeconds(undefined, 1000), 0); assert.equal(awaySeconds(NaN, 1000), 0); assert.equal(awaySeconds(1000, 'x'), 0);
  assert.equal(awaySeconds(1000, 4000, 2), 2, 'an explicit cap');
});

// ---- the time save --------------------------------------------------------------------------------------------------------------------------------------------------------
test('the time save is v2 with savedAt; a v1 save loads as before with no catch-up; junk versions are ignored', () => {
  values.clear();
  let wall = 1_700_000_000_000;
  const a = new DayNight({ now: () => wall }); a.set(10); a.dispose();
  const saved = JSON.parse(values.get(TIME_KEY));
  assert.equal(saved.v, 2); assert.equal(saved.savedAt, wall); near(saved.hour, 10);
  values.set(TIME_KEY, JSON.stringify({ v: 1, hour: 11 }));
  const b = new DayNight({ now: () => wall + 99999e3 }); near(b.hour, 11); assert.equal(b.away, null, 'a v1 save has no stamp: no catch-up the first time');
  assert.equal(JSON.parse(values.get(TIME_KEY)).v, 2, 'and it is rewritten as v2'); b.dispose();
  values.set(TIME_KEY, JSON.stringify({ v: 3, hour: 11, savedAt: wall })); near(new DayNight({ now: () => wall }).hour, 8);
  values.set(TIME_KEY, JSON.stringify({ v: 2, hour: 99, savedAt: wall })); near(new DayNight({ now: () => wall }).hour, 8);
  values.set(TIME_KEY, JSON.stringify({ v: 2, hour: 12 }));                       // v2 without a stamp: the hour loads, nothing to catch up
  const c = new DayNight({ now: () => wall }); near(c.hour, 12); assert.equal(c.away, null);
});

// ---- the load catch-up ----------------------------------------------------------------------------------------------------------------------------------------------------
function saveAt(hour, savedAt) { values.set(TIME_KEY, JSON.stringify({ v: 2, hour, savedAt })); }

test('the load catch-up: the hour moves by the real time away, clock.away records it, elapsedHours does not jump, no phase events fire', () => {
  values.clear(); saveAt(8, 1_000_000);
  const c = new DayNight({ now: () => 1_000_000 + 900_000 });
  const want = advanceClock(8, 900);
  near(c.hour, want.hour, 1e-9); assert.equal(c.away.seconds, 900); assert.deepEqual(c.away.entered, want.entered); assert.ok(c.away.entered.dawn >= 1, '900 s is more than one 630 s day');
  assert.equal(c.elapsedHours, 0, 'timed world events are unaffected');
  assert.equal(c.phase, DAY_PHASES.find((p) => (p.start < p.end ? c.hour >= p.start && c.hour < p.end : c.hour >= p.start || c.hour < p.end)).name);
  assert.equal(JSON.parse(values.get(TIME_KEY)).savedAt, 1_000_000 + 900_000, 'the catch-up is saved with a fresh stamp (no double counting on the next load)');
});

test('onCatchUp: the load catch-up waits for flushCatchUp (after the listeners exist), fires once, and is a no-op without one', () => {
  values.clear(); saveAt(8, 0);
  const c = new DayNight({ now: () => 900_000 });
  const got = []; const off = c.onCatchUp((d) => got.push(d));
  assert.equal(got.length, 0, 'nothing fires in the constructor');
  const d = c.flushCatchUp();
  assert.equal(got.length, 1); assert.equal(got[0].live, false); assert.equal(got[0].seconds, 900); assert.ok(got[0].entered.dawn >= 1); assert.equal(d, got[0]);
  assert.equal(c.flushCatchUp(), null); assert.equal(got.length, 1, 'once');
  off(); assert.equal(c._catchListeners.size, 0);
  const none = new DayNight({ now: () => 900_000 }); assert.equal(none.flushCatchUp(), null);
  const throwing = new DayNight({ now: () => 3_000_000 }); values.set(TIME_KEY, JSON.stringify({ v: 2, hour: 8, savedAt: 0 }));
  throwing.onCatchUp(() => { throw new Error('boom'); }); const ok = []; throwing.onCatchUp((x) => ok.push(x));
  const log = console.error; console.error = () => {};
  try { throwing.catchUp(100); } finally { console.error = log; } assert.equal(ok.length, 1, 'a throwing listener does not stop the others');
});

test('no load catch-up with ?daylock or ?time, a short gap, a gap into the past, nor on a replica (host: false); the cap applies', () => {
  values.clear();
  for (const [query, extra, why] of [['daylock', {}, 'daylock'], ['time=12', {}, '?time'], ['', { host: false }, 'a replica']]) {
    saveAt(8, 0);
    const c = new DayNight({ params: new URLSearchParams(query), now: () => 900_000, ...extra });
    assert.equal(c.away, null, why); assert.equal(c.flushCatchUp(), null, why);
    if (query === '') near(c.hour, 8, 1e-9);
  }
  saveAt(8, 0); near(new DayNight({ params: new URLSearchParams('time=dawn'), now: () => 900_000 }).hour, 6);
  saveAt(8, 1_000_000); assert.equal(new DayNight({ now: () => 1_000_000 + (OFFLINE.minGap - 1) * 1000 }).away, null, 'a gap under minGap (a quick reload)');
  saveAt(8, 5_000_000); assert.equal(new DayNight({ now: () => 1_000_000 }).away, null, 'the device clock went backwards');
  saveAt(8, 0); const far = new DayNight({ now: () => 1e15 }); assert.equal(far.away.seconds, OFFLINE.maxAway, 'a year away counts 30 days');
});

test('?away=N pretends N seconds passed (host, once at load, no save needed); not with ?daylock / ?time / a replica', () => {
  values.clear();
  const c = clock('away=900'); const want = advanceClock(8, 900);
  near(c.hour, want.hour, 1e-9); assert.equal(c.away.seconds, 900); assert.deepEqual(c.flushCatchUp().entered, want.entered);
  assert.equal(clock('away=900&daylock').away, null); assert.equal(clock('away=900&time=12').away, null); assert.equal(clock('away=900', { host: false }).away, null);
  assert.equal(clock('away=0').away, null); assert.equal(clock('away=junk').away, null);
  assert.equal(clock(`away=${1e12}`).away.seconds, OFFLINE.maxAway);
});

test('?newgame ignores the saved time and its stamp (a child process, because NEW_GAME is read once at import)', (t) => {
  const here = path.dirname(fileURLToPath(import.meta.url)), root = path.join(here, '..').replace(/\\/g, '/');
  const code = `
    globalThis.location = { search: '?newgame', pathname: '/', hash: '' }; globalThis.history = { state: null, replaceState() {} };
    const m = new Map([['infinite-island.time.v1', JSON.stringify({ v: 2, hour: 15, savedAt: 0 })]]);
    globalThis.localStorage = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
    const { DayNight } = await import('file://${root}/public/js/world/dayNight.js');
    const c = new DayNight({ now: () => 900000, params: new URLSearchParams('newgame') });
    const flag = new DayNight({ now: () => 900000, params: new URLSearchParams('newgame&away=900') });
    console.log(JSON.stringify({ hour: c.hour, away: c.away, flagAway: flag.away && flag.away.seconds }));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' });
  if (r.error) return t.skip(`cannot spawn a child process here: ${r.error.code}`);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.equal(out.hour, 8, 'the saved 15 h is wiped'); assert.equal(out.away, null, 'no catch-up with ?newgame'); assert.equal(out.flagAway, 900, 'an explicit ?away still works (debug)');
});

// ---- the live catch-up (hidden tab / debug) --------------------------------------------------------------------------------------------------------------------------------
test('a hidden tab catches the clock up by the hidden time, but only after OFFLINE.minGap; the garden-facing phase events stay silent', () => {
  values.clear();
  let wall = 10_000_000;
  const c = new DayNight({ now: () => wall }); c.set(8);
  const phases = [], catches = [];
  c.on('phase', (p) => phases.push(p)); c.onCatchUp((d) => catches.push(d));
  c.setHidden(true); wall += (OFFLINE.minGap - 1) * 1000; assert.equal(c.setHidden(false), null, 'a tab flick'); assert.equal(catches.length, 0); near(c.hour, 8);
  c.setHidden(true); wall += 700 * 1000;
  const d = c.setHidden(false);
  assert.equal(d.seconds, 700); assert.equal(d.live, true); assert.equal(catches.length, 1);
  const want = advanceClock(8, 700); near(c.hour, want.hour, 1e-9); assert.deepEqual(d.entered, want.entered);
  assert.deepEqual(phases, [], 'no phase event: the garden counts nothing');
  assert.equal(c.elapsedHours, 0);
  assert.equal(c.setHidden(false), null, 'showing without having hidden does nothing');
  assert.equal(JSON.parse(values.get(TIME_KEY)).savedAt, wall);
  c.set(8); c.locked = true; c.setHidden(true); wall += 800 * 1000; assert.equal(c.setHidden(false), null, '?daylock: the clock stays put'); near(c.hour, 8);
});

test('catchUp(seconds) (debug) runs the live path; a replica never catches up and gets the host hour through the daynight sync', () => {
  values.clear();
  const host = clock(); host.set(8); const hSync = new WorldSync({ role: 'host' }); host.attachSync(hSync);
  const rep = clock('', { host: false }); const rSync = new WorldSync({ role: 'replica' }); rep.attachSync(rSync);
  assert.equal(rep.catchUp(500), null, 'replicas never count away time');
  const events = []; const emit = hSync.emit.bind(hSync); hSync.emit = (...a) => { events.push(a); return emit(...a); };
  const d = host.catchUp(500); assert.equal(d.seconds, 500);
  assert.ok(events.some((a) => a[0] === 'daynight' && a[1] === 'time'), 'the host broadcasts the new hour');
  assert.equal(host.catchUp(0), null); assert.equal(host.catchUp(-4), null); assert.equal(host.catchUp(NaN), null);
  assert.equal(host.catchUp(1e12).seconds, OFFLINE.maxAway);
  // the replica adopts the hour (a snap: far more than 0.25 h off)
  rep._applyHost({ hour: host.hour, locked: false, speed: 1 }, false); near(rep.hour, host.hour, 1e-6);
});

test('the Emberleaf garden keeps no offline growth: a hidden-tab catch-up grows nothing and the garden adopts the new phase (the next boundary counts once)', async () => {
  const { createGarden } = await import('../public/js/world/garden.js');
  const { emberSave } = await import('../public/js/game/emberSave.js');
  values.clear(); emberSave.read();
  let wall = 50_000_000;
  const c = new DayNight({ now: () => wall }); c.set(8);
  const sync = new WorldSync({ role: 'host' });
  const g = createGarden({ world: { ember: { placement: { garden: {} } } }, sync, clock: c });
  g.setPlot(11, { flower: 'sunbell', stage: 'sprout' });
  assert.equal(g.state.phase, 'day');
  c.setHidden(true); wall += 700 * 1000; const d = c.setHidden(false);          // 700 s from 8 h crosses dusk, the night, dawn and ends in the day (a replayed count would bloom it)
  assert.ok(d.entered.dusk === 1 && d.entered.dawn === 1);
  assert.equal(g.state.plots[11].stage, 'sprout', 'nothing grew while away');
  assert.equal(g.state.phase, c.phase, 'the garden adopted the clock phase');
  c.set(17.99); c.update(10);                                                  // now crossing dusk for real: the sprout becomes a bud, once
  assert.equal(g.state.plots[11].stage, 'bud');
  c.update(45 + 100); assert.equal(g.state.plots[11].stage, 'bud', 'night does not bloom it');
});
