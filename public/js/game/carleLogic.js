// Pure rules of Carle's quest line "The Very Hungry Visitor" (PLAN Step 74b): the caterpillar on the home island that is fed one more thing each in-game DAY for a week, grows, gets a tummy ache from the feast and is cured
// by a mint leaf. No three.js, no DOM, no network: Node-tested in test/carle.test.js. The host domain is game/carle.js, the world side (caterpillar, cocoon, bubbles, menu) world/carleWorld.js, the placement
// world/islands/homeCarle.js. Cocoon dawns reach ready; validateHatch checks the ready stage, reach and cinematic availability.
//
//   State          { stage 0..5, day 0..7, fedToday, cocoonDays, phase }
//   STAGES         0 unseen, 1 sighted, 2 feeding, 3 cocoon, 4 ready, 5 hatched      (the hatch stays ready until its scene finishes, then stage 5)
//   day            how many feeding days are DONE (0..7): the next offering is CARLE.days[day]. It advances ONLY by feeding, so several dawns without a feeding never skip a day.
//   fedToday       today's food is given: the caterpillar is full until the next counted DAWN (the host's clock: phase events, or the dawns of an offline / hidden-tab catch-up)
//   phase          the HOST's private "last phase counted" (like the garden's): saved, never synced, left out of hashView
//   freshState() / normaliseState(raw) / savedView(state) (the saved form, incl. phase) / wireView(state) = hashView(state) (no phase) / readSave(part) = normaliseState / debugState(stage)
//                  a hand-edited or old save is made consistent: day >= 7 means stage >= 3, 1..6 means stage >= 2, stage >= 3 means day 7, stage 2 means day >= 1, fedToday only while feeding with day >= 1, cocoonDays only from stage 3.
//   wantsOf(state)       { itemId: n } | null     what it wants NOW (null when full, not hungry yet, or past the week)
//   nextOf(state)        { itemId: n } | null     the next day's offering whether or not it is full (the hint bubble / menu preview)
//   isFull(state) / ache(state) (tummy ache: the feast is eaten, the mint is not) / growth(state) (the root scale, 1 .. 1.35) / hungry(state)
//   needLine(items) / hintFor(itemId) / hintsFor(items, have)    the menu texts: "2 Lingonberries", "Lingonberries grow on Frostpine.", the missing-item hint lines
//   Validation     validateSight / validateFeed -> null | reason     (the HOST runs them; distance is measured by the caller and omitted for the host / debug)
//   Transitions    applySight / applyFeed / applyDawns -> a NEW state (never mutates; an ignored call returns the same state)
//   dawnsBetween(from, to)   how many DAWNS a forward walk from phase `from` to `to` crosses (reuses game/gardenLogic.js phasesEntered)
import { CARLE } from '../config.js';
import { getItem, itemName } from './catalog.js';
import { phasesEntered, PHASE_ORDER } from './gardenLogic.js';

export const STAGES = ['unseen', 'sighted', 'feeding', 'cocoon', 'ready', 'hatched'];
export const DAY_COUNT = CARLE.days.length;       // 7

const clampInt = (v, a, b, d = a) => (Number.isFinite(Number(v)) ? Math.min(b, Math.max(a, Math.floor(Number(v)))) : d);

export const freshState = () => ({ stage: 0, day: 0, fedToday: false, cocoonDays: 0, phase: null });

/** Make a saved / received state safe and self-consistent (see the header). */
export function normaliseState(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  let stage = clampInt(r.stage, 0, 5, 0), day = clampInt(r.day, 0, DAY_COUNT, 0);
  let cocoonDays = clampInt(r.cocoonDays, 0, CARLE.cocoonDays, 0);
  if (day >= DAY_COUNT) stage = Math.max(stage, 3);
  else if (day >= 1) stage = Math.max(stage, 2);
  if (stage >= 3) day = DAY_COUNT;
  else if (stage === 2) day = Math.max(1, day);
  else day = 0;
  if (stage === 3 && cocoonDays >= CARLE.cocoonDays) stage = 4;
  if (stage < 3) cocoonDays = 0;
  else if (stage === 3) cocoonDays = Math.min(cocoonDays, CARLE.cocoonDays - 1);
  else cocoonDays = CARLE.cocoonDays;
  const fedToday = (stage === 1 || stage === 2) && day >= 1 && r.fedToday === true;
  const phase = PHASE_ORDER.includes(r.phase) ? r.phase : null;
  return { stage, day, fedToday, cocoonDays, phase };
}

export const savedView = (s) => ({ stage: s.stage, day: s.day, fedToday: s.fedToday, cocoonDays: s.cocoonDays, phase: s.phase });
export const wireView = (s) => ({ stage: s.stage, day: s.day, fedToday: s.fedToday, cocoonDays: s.cocoonDays });
export const hashView = wireView;
export const readSave = (part) => normaliseState(part);

/** The canonical state at the START of stage n (debug / tests): stage 2 = the first day fed, a fresh day; 3+ = the week done. */
export function debugState(n) {
  const stage = clampInt(n, 0, 5, 0);
  return normaliseState({ stage, day: stage === 2 ? 1 : stage >= 3 ? DAY_COUNT : 0, cocoonDays: stage >= 4 ? CARLE.cocoonDays : 0 });
}

// ------------------------------------------------------------------------------------------------ what it wants
export const isFeeding = (s) => s.stage === 1 || s.stage === 2;
export const isFull = (s) => isFeeding(s) && s.fedToday;
export const hungry = (s) => isFeeding(s) && !s.fedToday && s.day < DAY_COUNT;
export const nextOf = (s) => (isFeeding(s) && s.day < DAY_COUNT ? { ...CARLE.days[s.day].items } : null);
export const wantsOf = (s) => (hungry(s) ? nextOf(s) : null);
/** The tummy ache: the day-6 feast is eaten and the day-7 mint is not (stage 2, 6 days done). */
export const ache = (s) => s.stage === 2 && s.day === DAY_COUNT - 1;
/** The caterpillar's root scale: grows with every feeding (days done), 1 before the first and `growth.to` after the seventh. */
export const growth = (s) => CARLE.growth.from + (CARLE.growth.to - CARLE.growth.from) * (Math.min(DAY_COUNT, Math.max(0, s.day)) / DAY_COUNT);

// ------------------------------------------------------------------------------------------------ texts
const PLACE = { home: 'the home island', frost: 'Frostpine', ember: 'Emberleaf', duskcrown: 'Duskcrown' };
const CAMP = { home: 'the home campfire', frost: "Frostpine's camp fire", ember: "Emberleaf's campfire", duskcrown: "the marsh hearth" };
/** "1 Apple" / "2 Lingonberries" */
export const needLine = (items) => Object.entries(items).map(([id, n]) => `${n} ${itemName(id, n)}`).join(', ');
/** Where one item comes from: "Lingonberries grow on Frostpine." / "Cook a Berry Jam at the home campfire." */
export function hintFor(id) {
  const d = getItem(id);
  if (!d) return '';
  const at = d.islands && d.islands[0] ? d.islands[0] : 'home';
  if (d.kind === 'dish') return `Cook ${itemName(id, 1)} at ${CAMP[at] || 'a campfire'}.`;
  return `${itemName(id, 2)} come from ${PLACE[at] || 'another island'}.`;
}
/** One hint line for every item of `items` that `have(id)` does not cover yet (empty when the bag has it all). */
export const hintsFor = (items, have) => Object.entries(items).filter(([id, n]) => (have(id) || 0) < n).map(([id]) => hintFor(id));

// ------------------------------------------------------------------------------------------------ validation (host)
const dOk = (dist, range) => dist === null || dist === undefined || dist <= range;

export function validateSight({ state, open = true, dist = null, range = CARLE.sight + CARLE.remoteSlack }) {
  if (!state) return 'bad-request';
  if (!open) return 'locked';
  if (state.stage !== 0) return 'seen';
  if (!dOk(dist, range)) return 'far';
  return null;
}

/** day = the 1-based feeding day the actor is offering for; have(id) = how many the shared bag holds; dist = the remote actor's distance to the perch (omit for the host / debug). */
export function validateFeed({ state, day, have, open = true, dist = null, range = CARLE.feedReach + CARLE.remoteSlack }) {
  if (!state || !Number.isInteger(day) || typeof have !== 'function') return 'bad-request';
  if (!open) return 'locked';
  if (state.stage === 0) return 'unseen';
  if (state.stage >= 3) return 'done';
  if (day !== state.day + 1) return 'wrong-day';
  if (state.fedToday) return 'full';
  if (!dOk(dist, range)) return 'far';
  for (const [id, n] of Object.entries(CARLE.days[state.day].items)) if ((Math.floor(Number(have(id))) || 0) < n) return 'none';
  return null;
}

// ------------------------------------------------------------------------------------------------ transitions
export function applySight(s) {
  return s.stage === 0 ? normaliseState({ ...s, stage: 1 }) : s;
}

/** One feeding: the next day is done (stage 2), full until the next dawn; the seventh ends the week (stage 3: the cocoon). */
export function applyFeed(s) {
  if (!isFeeding(s) || s.day >= DAY_COUNT) return s;
  const day = s.day + 1;
  if (day >= DAY_COUNT) return normaliseState({ ...s, stage: 3, day, fedToday: false, cocoonDays: 0 });
  return normaliseState({ ...s, stage: 2, day, fedToday: true });
}

/** `n` dawns counted: a full caterpillar is hungry again. Several dawns are the same as one (the day number advances only by feeding). Stage 3 counts cocoonDays += n, capped at ready. */
export function applyDawns(s, n = 1) {
  if (s.stage === 3 && n > 0) return normaliseState({ ...s, cocoonDays: s.cocoonDays + Math.floor(n) });
  if (!(n > 0) || !isFeeding(s) || !s.fedToday) return s;
  return { ...s, fedToday: false };
}

/** How many DAWNS a forward walk from phase `from` to `to` crosses (0 when equal / unknown): the host's live count (reuses the garden's phasesEntered). */
export const dawnsBetween = (from, to) => phasesEntered(from, to).filter((p) => p === 'dawn').length;

/** Only a ready cocoon can hatch; the caller supplies authoritative reach and cinematic availability. */
export function validateHatch({ state, open = true, busy = false, dist = null, range = CARLE.feedReach + CARLE.remoteSlack }) {
  if (!state) return 'bad-request';
  if (!open) return 'locked';
  if (state.stage !== 4) return 'not-ready';
  if (!dOk(dist, range)) return 'far';
  if (busy) return 'busy';
  return null;
}
