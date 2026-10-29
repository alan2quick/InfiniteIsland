// Pure campfire rack rules. rackKinds(discovered), rackUnlocked(quests, fire), decideCycle(heldInfo, stock, kinds).
// heldInfo = {id, kind, own}; stock maps kind -> 'rack'|'held'|'out'. IDs reserve fire-major, then slot, then kind.
// Step 86b: the HOME rack alone may also offer a watering can (once Homesteading is unlocked). It is NOT in TOOL_RACK.kinds (that would shift every id): its 4 reserved ids
// (one per slot) are appended right after the RACK_COUNT classic ones: base + RACK_COUNT + slot. rackKinds(discovered, fire, homesteadUnlocked) adds it to the cycle.
import { TOOL_RACK, FIRES } from '../config.js';
export const RACK_COUNT = FIRES.length * 4 * TOOL_RACK.kinds.length;
export const RACK_EXTRA_KIND = 'watering-can', RACK_EXTRA_FIRE = 'home', RACK_EXTRA_COUNT = 4;
export const RACK_TOTAL = RACK_COUNT + RACK_EXTRA_COUNT;
export const rackKinds = (discovered = false, fire = null, homesteadUnlocked = false) => [...TOOL_RACK.kinds.filter((k) => k !== 'rod' || discovered), ...(fire === RACK_EXTRA_FIRE && homesteadUnlocked ? [RACK_EXTRA_KIND] : [])];
export const rackUnlocked = (quests, fire) => FIRES.some((f) => f.id === fire) && !!quests?.slots?.[fire]?.last;
export function rackId(base, fire, owner, kind) {
  if (kind === RACK_EXTRA_KIND) return fire === RACK_EXTRA_FIRE && Number.isInteger(owner) && owner >= 0 && owner <= 3 ? base + RACK_COUNT + owner : null;
  const f = FIRES.findIndex((f) => f.id === fire), k = TOOL_RACK.kinds.indexOf(kind);
  return f < 0 || k < 0 || !Number.isInteger(owner) || owner < 0 || owner > 3 ? null : base + (f * 4 + owner) * 5 + k;
}
export function rackInfo(base, id) {
  const n = id - base;
  if (Number.isInteger(n) && n >= RACK_COUNT && n < RACK_TOTAL) return { fire: RACK_EXTRA_FIRE, owner: n - RACK_COUNT, kind: RACK_EXTRA_KIND };
  if (!Number.isInteger(n) || n < 0 || n >= RACK_COUNT) return null;
  return { fire: FIRES[Math.floor(n / 20)].id, owner: Math.floor(n / 5) % 4, kind: TOOL_RACK.kinds[n % 5] };
}
export function decideCycle(held, stock, kinds) {
  const own = held?.own && kinds.includes(held.kind);
  const start = own ? kinds.indexOf(held.kind) + 1 : 0;
  let take = null;
  for (let i = 0; i < kinds.length; i++) {
    const k = kinds[(start + i) % kinds.length];
    if ((!own || k !== held.kind) && stock[k] === 'rack') { take = k; break; }
  }
  if (own && !take) return { put: null, drop: null, take: null, line: 'Your other tools from this rack are out in the world!' };
  return { put: own ? held.id : null, drop: held && !own ? held.id : null, take,
    line: take ? null : 'Your tools from this rack are all out in the world!' };
}
