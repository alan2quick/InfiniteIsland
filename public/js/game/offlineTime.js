// Offline time (PLAN Step 74b): how far the day/night clock moves when real time passed while the game was closed or the tab hidden. Pure maths, no DOM, no three.js: Node-tested in
// test/offlineTime.test.js. world/dayNight.js calls it (clock.catchUp / the load catch-up).
//
//   advanceClock(hour, seconds) -> { hour, entered: { dawn, day, dusk, night } }
//       Walks the DAY_PHASES at their configured rates from `hour` for `seconds` of simulation time, exactly like DayNight.update would (the same phase boundaries, in order), and returns the new hour and how
//       many times each phase was ENTERED on the way (a boundary crossed = that phase entered). Whole cycles (one full day = the sum of the phase seconds, 630 s) are taken in one step, so a month away
//       is a handful of phase steps, not a long loop. A non-positive / non-finite `seconds` changes nothing.
//   cycleSeconds()   the length of one full day in seconds (DAY_PHASES)
//   awaySeconds(savedAt, now, maxAway = OFFLINE.maxAway) -> real seconds to catch up: (now - savedAt) / 1000 clamped to 0..maxAway; a missing / future stamp (the device clock went backwards) counts 0.
import { DAY_PHASES, OFFLINE } from '../config.js';

const wrap = (h) => ((h % 24) + 24) % 24;
const NAMES = DAY_PHASES.map((p) => p.name);

function phaseIndexAt(hour) {
  for (let i = 0; i < DAY_PHASES.length; i++) {
    const p = DAY_PHASES[i];
    if (p.start < p.end ? hour >= p.start && hour < p.end : hour >= p.start || hour < p.end) return i;
  }
  return 0;
}

export const cycleSeconds = () => DAY_PHASES.reduce((s, p) => s + p.seconds, 0);
const emptyCounts = () => Object.fromEntries(NAMES.map((n) => [n, 0]));

export function advanceClock(hour, seconds) {
  const entered = emptyCounts();
  hour = Number.isFinite(hour) ? wrap(hour) : 0;
  if (!Number.isFinite(seconds) || seconds <= 0) return { hour, entered };
  const cycle = cycleSeconds();
  const whole = Math.floor(seconds / cycle);
  let remaining = seconds - whole * cycle;
  if (whole > 0) for (const n of NAMES) entered[n] += whole;      // a whole day returns to the same hour and crosses every boundary once
  let guard = 0;
  while (remaining > 0 && guard++ < 16) {
    const i = phaseIndexAt(hour), p = DAY_PHASES[i];
    const rate = wrap(p.end - p.start) / p.seconds;
    const until = wrap(p.end - hour) / rate;
    if (remaining + 1e-9 >= until) {                              // the same tolerance as DayNight.update: a step that just reaches the boundary crosses it
      hour = p.end;
      remaining = Math.max(0, remaining - until);
      entered[DAY_PHASES[(i + 1) % DAY_PHASES.length].name]++;
    } else {
      hour = wrap(hour + remaining * rate);
      remaining = 0;
    }
  }
  return { hour: wrap(hour), entered };
}

export function awaySeconds(savedAt, now, maxAway = OFFLINE.maxAway) {
  if (!Number.isFinite(savedAt) || !Number.isFinite(now)) return 0;
  const s = (now - savedAt) / 1000;
  return s > 0 ? Math.min(s, maxAway) : 0;
}
