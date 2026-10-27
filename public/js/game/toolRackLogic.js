// Pure campfire rack rules. rackKinds(discovered), rackUnlocked(quests, fire), decideCycle(heldInfo, stock, kinds).
// heldInfo = {id, kind, own}; stock maps kind -> 'rack'|'held'|'out'. IDs reserve fire-major, then slot, then kind.
import { TOOL_RACK, FIRES } from '../config.js';
export const RACK_COUNT = FIRES.length * 4 * TOOL_RACK.kinds.length;
export const rackKinds = (discovered = false) => TOOL_RACK.kinds.filter((k) => k !== 'rod' || discovered);
export const rackUnlocked = (quests, fire) => FIRES.some((f) => f.id === fire) && !!quests?.slots?.[fire]?.last;
export function rackId(base, fire, owner, kind) {
  const f = FIRES.findIndex((f) => f.id === fire), k = TOOL_RACK.kinds.indexOf(kind);
  return f < 0 || k < 0 || !Number.isInteger(owner) || owner < 0 || owner > 3 ? null : base + (f * 4 + owner) * 5 + k;
}
export function rackInfo(base, id) {
  const n = id - base;
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
