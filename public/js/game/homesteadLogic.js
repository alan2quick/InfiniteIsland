// Step 86a: the pure rules of Homesteading (the customisable home island). No three.js, no DOM: Node-tested (test/homestead.test.js).
//
// The data model: a NATIVE is a thing the home island is built with today. The world side (world/homesteadWorld.js) lists them as `natives = [{ id, kind }]` with stable string ids
// ('tree:3', 'palm:0', 'rock:7', 'bush:12', 'herb:4', 'mush:1', 'flower:9', 'dig:1'..'dig:6'; the number is the index in the deterministic placement order, so a saved id never shifts). A PLACED object
// is `{ pid, kind, x, z, rot, stage }` (pid = a host counter; its id string is 'p<pid>'). The layout state is `{ unlocked, removed: [nativeId...], placed: [...], nextPid }`.
//
//   classifyNative({ type, cherry, berries, color })   -> kind id (HOMESTEAD.kinds key) of a home interactable
//   usage({ natives, state })                           -> { main: {used, budget, free}, deco: {...}, counts: {kind: standing} }   standing = natives not removed + placed copies
//   validateRemove({ id, natives, state, hostActor, debug })    -> null | reason          ('gone' | 'last-native' | 'last-dig' | 'locked' | 'not-host' | 'bad-request')
//   validatePlace({ kind, x, z, natives, state, bag, hostActor, debug, spot })  -> null | reason   ('not-host' | 'unknown-kind' | 'not-yet' | 'locked' | 'bad-request' | 'budget' | 'cost' | 'spot' | 'layer-full')
//   nextStage(kind, stage), costOf(kind), weightOf(kind), budgetOf(kind), idOfPid(pid), pidOfId(id)
//   Step 86c (Shape = remove for good): shapeRule(kind) -> { tool, verb, needs, confirm } | null, shapeToolOk(kind, toolKind), shapeConfirmText(kind), guardLine(kind), removeRejectLine(reason, kind)
//   Step 86e: isForeign(kind) (a kind of another island), foreignInUse(state) (the distinct foreign kinds standing), nightGlow(nightness) (the home glow of Duskcrown decorations, 0 by day: ONE shared uniform), islandOf(kind)
//   freshState(), normaliseState(raw), wireView(state) (= savedView = hashView), applyRemoved(state, id), applyPlaced(state, rec), applyGrew(state, pid, stage)
//
// Budget: model B (size points). A kind's weight comes from HOMESTEAD.weights through its class; decorations weigh 1 against their own `decoBudget`. `HOMESTEAD.budget` is the measured native total in points, fixed in config.
// The last-native guard: a kind the island has today ('native: true' in the table) can never drop to zero standing (natives + placed copies, any growth stage). Decorations and foreign kinds have no guard.
// Dig spots wander: removing a native dig slot lowers the number of wandering spots, but never below 1 (rule 'last-dig').
import { HOMESTEAD } from '../config.js';

export const STAGES = ['sprout', 'sapling', 'grown'];
export const FLOWER_KINDS = ['flowerPink', 'flowerWhite', 'flowerPurple', 'flowerBlue'];     // the colour index order of props.js FLOWER_COLORS
export const DIG_SLOT = /^dig:\d+$/;

export const kindMeta = (kind) => HOMESTEAD.kinds[kind] || null;
export const islandOf = (kind) => { const m = kindMeta(kind); return m ? m.island : null; };
/** Step 86e: a kind that belongs to another island (it is listed once that island is unlocked). */
export const isForeign = (kind) => { const m = kindMeta(kind); return !!m && m.island !== 'home'; };
/** The distinct foreign kinds that stand on the island now (placed copies; sprouts count), optionally only one budget ('main' | 'deco'). Each budget's count is capped by HOMESTEAD.foreignKindCap[budget] (one instanced layer each). */
export const foreignInUse = (state, budget = null) => [...new Set(state.placed.filter((p) => isForeign(p.kind) && (!budget || kindMeta(p.kind).budget === budget)).map((p) => p.kind))];
/** Step 86f: would planting `kind` break its budget's foreign kind cap? (a kind already standing is always fine) */
export const kindCapped = (kind, used) => { const m = kindMeta(kind); return !!m && m.island !== 'home' && !used.includes(kind) && used.length >= HOMESTEAD.foreignKindCap[m.budget]; };
/** The sentence for a capped kind (names the kind of budget and the number). */
export const kindCapLine = (budget) => (budget === 'deco'
  ? `Too many kinds of decorations from other islands (${HOMESTEAD.foreignKindCap.deco}): remove every copy of one first`
  : `Too many kinds of trees and rocks from other islands (${HOMESTEAD.foreignKindCap.main}): remove every copy of one first`);
/** Step 86e: how strongly a Duskcrown decoration glows at home, 0..HOMESTEAD.nightGlow.max: nothing by day, a soft glow once it is properly dark (a smoothstep of the day/night clock's nightness). */
export function nightGlow(nightness) {
  const g = HOMESTEAD.nightGlow;
  const n = Number(nightness);
  if (!(n > g.from)) return 0;
  const t = Math.min(1, (n - g.from) / (g.to - g.from));
  return g.max * t * t * (3 - 2 * t);
}
export const weightOf = (kind) => { const m = kindMeta(kind); return m ? m.weight : 0; };
export const budgetOf = (kind) => { const m = kindMeta(kind); return m ? m.budget : null; };
export const costOf = (kind) => { const m = kindMeta(kind); return m ? { ...m.cost } : {}; };
export const idOfPid = (pid) => `p${pid}`;
export const pidOfId = (id) => (typeof id === 'string' && /^p\d+$/.test(id) ? Number(id.slice(1)) : null);
export const isDigSlot = (id) => typeof id === 'string' && DIG_SLOT.test(id);

/** The kind id of a home interactable (props.js / gathering.js shapes): { type, cherry?, berries?, color? }. null when it is not editable (signpost, ...). */
export function classifyNative(o) {
  switch (o && o.type) {
    case 'tree': return o.cherry ? 'cherryTree' : 'appleTree';
    case 'palm': return 'palm';
    case 'rock': return 'rock';
    case 'bush': return o.berries ? 'berryBush' : 'plainBush';
    case 'herb': return 'herb';
    case 'mushroom': return 'mushroom';
    case 'digspot': return 'digSpot';
    case 'flower': return FLOWER_KINDS[o.color] || null;
    default: return null;
  }
}

// ---------------------------------------------------------------------------------------------- state
export const freshState = () => ({ unlocked: false, removed: [], placed: [], nextPid: 1 });

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const r2 = (v) => Math.round(v * 100) / 100;

/** Sanitise anything (a save file, a snapshot) into a valid state. Unknown kinds / bad records are dropped; the counter never goes below the highest pid + 1. */
export function normaliseState(raw) {
  const s = freshState();
  if (!raw || typeof raw !== 'object') return s;
  s.unlocked = raw.unlocked === true;
  const seen = new Set();
  for (const id of Array.isArray(raw.removed) ? raw.removed : []) if (typeof id === 'string' && id.length < 24 && !seen.has(id)) { seen.add(id); s.removed.push(id); }
  const pids = new Set();
  for (const p of Array.isArray(raw.placed) ? raw.placed : []) {
    const m = p && kindMeta(p.kind);
    const pid = p && Math.floor(Number(p.pid));
    if (!m || !(pid >= 1) || pids.has(pid) || !finite(p.x) || !finite(p.z)) continue;
    pids.add(pid);
    const stage = m.grows && STAGES.includes(p.stage) ? p.stage : 'grown';
    s.placed.push({ pid, kind: p.kind, x: r2(p.x), z: r2(p.z), rot: finite(p.rot) ? r2(p.rot) : 0, stage });
  }
  s.placed.sort((a, b) => a.pid - b.pid);
  const next = Math.floor(Number(raw.nextPid));
  s.nextPid = Math.max(next >= 1 ? next : 1, (s.placed.length ? s.placed[s.placed.length - 1].pid : 0) + 1);
  return s;
}

/** The JSON shape used for the save, the snapshot and the hash (sorted, so two screens agree). */
export function wireView(state) {
  return {
    unlocked: !!state.unlocked,
    removed: [...state.removed].sort(),
    placed: [...state.placed].sort((a, b) => a.pid - b.pid).map((p) => ({ pid: p.pid, kind: p.kind, x: p.x, z: p.z, rot: p.rot, stage: p.stage })),
    nextPid: state.nextPid,
  };
}
export const savedView = wireView;

export function applyRemoved(state, id) {
  const pid = pidOfId(id);
  if (pid !== null) return { ...state, placed: state.placed.filter((p) => p.pid !== pid) };
  if (state.removed.includes(id)) return state;
  return { ...state, removed: [...state.removed, id] };
}
export function applyPlaced(state, rec) {
  if (state.placed.some((p) => p.pid === rec.pid)) return state;
  return { ...state, placed: [...state.placed, { ...rec }], nextPid: Math.max(state.nextPid, rec.pid + 1) };
}
export function applyGrew(state, pid, stage) {
  return { ...state, placed: state.placed.map((p) => (p.pid === pid ? { ...p, stage } : p)) };
}

/** The stage after one watering (null when it is already grown / the kind does not grow). */
export function nextStage(kind, stage) {
  const m = kindMeta(kind);
  if (!m || !m.grows) return null;
  const i = STAGES.indexOf(stage);
  return i >= 0 && i < STAGES.length - 1 ? STAGES[i + 1] : null;
}

// ---------------------------------------------------------------------------------------------- budget + guard
/** Standing count per kind: natives not removed + placed copies (any stage). */
export function standingCounts(natives, state) {
  const gone = new Set(state.removed);
  const counts = {};
  for (const n of natives) if (!gone.has(n.id)) counts[n.kind] = (counts[n.kind] || 0) + 1;
  for (const p of state.placed) counts[p.kind] = (counts[p.kind] || 0) + 1;
  return counts;
}

export function usage({ natives, state }) {
  const counts = standingCounts(natives, state);
  const out = { main: { used: 0, budget: HOMESTEAD.budget }, deco: { used: 0, budget: HOMESTEAD.decoBudget }, counts };
  for (const [kind, n] of Object.entries(counts)) {
    const m = kindMeta(kind);
    if (m) out[m.budget].used += n * m.weight;
  }
  out.main.free = out.main.budget - out.main.used;
  out.deco.free = out.deco.budget - out.deco.used;
  return out;
}

export const LINES = {
  'last-native': (m) => `That's the island's last ${String(m && m.label ? m.label : 'one').toLowerCase()}!`,
  'last-dig': () => 'The island needs at least one wandering dig spot!',
  budget: (m, u) => `Needs ${m.weight} free spot${m.weight === 1 ? '' : 's'}, you have ${Math.max(0, u[m.budget].free)}: remove something first.`,
  cost: () => 'Not enough materials in the bag.',
  spot: () => 'Not a good place for that.',
  locked: () => 'Homesteading is not unlocked yet.',
  'not-host': () => 'Only the host\'s island can be rearranged.',
  'not-yet': () => 'That is not available yet.',
  'kind-cap': (m) => kindCapLine(m && m.budget) + '.',
};

/** Can this id be removed for good? id = a native id ('tree:3', 'dig:2') or a placed id ('p7'). null = fine, else a reason. */
export function validateRemove({ id, natives, state, hostActor = true, debug = false }) {
  if (typeof id !== 'string' || !id) return 'bad-request';
  if (!hostActor) return 'not-host';
  if (!state.unlocked && !debug) return 'locked';
  const pid = pidOfId(id);
  let kind;
  if (pid !== null) {
    const rec = state.placed.find((p) => p.pid === pid);
    if (!rec) return 'gone';
    kind = rec.kind;
  } else {
    const n = natives.find((q) => q.id === id);
    if (!n || state.removed.includes(id)) return 'gone';
    kind = n.kind;
  }
  const m = kindMeta(kind);
  if (!m) return 'bad-request';
  if (m.native) {
    const counts = standingCounts(natives, state);
    if ((counts[kind] || 0) <= 1) return 'last-native';
    if (isDigSlot(id)) {                                                        // wandering spots never drop below 1
      const slots = natives.filter((q) => isDigSlot(q.id) && !state.removed.includes(q.id)).length;
      if (slots <= 1) return 'last-dig';
    }
  }
  return null;
}

/** Can `kind` be planted at (x, z)? `bag` = (itemId) => count; `spot` = the world's verdict (null | reason string), only asked when everything else passed. */
export function validatePlace({ kind, x, z, natives, state, bag = () => 0, hostActor = true, debug = false, spot = null, layerFull = false, islands = null }) {
  if (!hostActor) return 'not-host';
  const m = kindMeta(kind);
  if (!m) return 'unknown-kind';
  if (m.todo) return 'not-yet';
  if (islands && !debug && !islands.includes(m.island)) return 'not-yet';       // Step 86e: another island's kind is listed (and placeable) once that island is unlocked; `islands` = the host's unlocked list (null = not checked)
  if (!state.unlocked && !debug) return 'locked';
  if (!finite(x) || !finite(z)) return 'bad-request';
  const u = usage({ natives, state });
  if (u[m.budget].free < m.weight) return 'budget';
  if (kindCapped(kind, foreignInUse(state, m.budget))) return 'kind-cap';       // Step 86e: the draw-call guard
  if (!debug) for (const [id, n] of Object.entries(m.cost)) if ((Number(bag(id)) || 0) < n) return 'cost';
  if (layerFull) return 'layer-full';
  if (spot && spot(kind, x, z)) return 'spot';
  return null;
}

/** The player-facing line for a rejection (`meta` = the kind's table entry, `u` = usage()). */
export function lineFor(reason, meta = null, u = null) {
  const f = LINES[reason];
  return f ? f(meta, u) : null;
}

// ---------------------------------------------------------------------------------------------- Shape (Step 86c)
// What pressing Shape on a target does, by weight class: the tool it needs, the prompt verb and whether it asks "for good?" first (every gathering object does; a decoration costs nothing, so it does not).
const SHAPE_BY_CLS = {
  tree: { tool: 'axe', verb: 'Chop down for good' },
  palm: { tool: 'axe', verb: 'Chop down for good' },
  bamboo: { tool: 'axe', verb: 'Chop down for good' },
  rock: { tool: 'hammer', verb: 'Break for good' },
  bush: { tool: 'shovel', verb: 'Dig up for good' },
  herb: { tool: 'shovel', verb: 'Dig up for good' },
  mushroom: { tool: 'shovel', verb: 'Dig up for good' },
  glowcap: { tool: 'shovel', verb: 'Dig up for good' },
  digspot: { tool: 'shovel', verb: 'Fill in for good' },
  flower: { tool: 'shovel', verb: 'Dig up' },
};
const TOOL_NEEDS = { axe: 'Needs an axe', hammer: 'Needs a hammer', shovel: 'Needs a shovel' };

/** The Shape-remove rule of a kind: { tool, verb, needs, confirm } (null for an unknown kind). A decoration (the 'deco' budget) skips the confirm. */
export function shapeRule(kind) {
  const m = kindMeta(kind);
  const r = m && SHAPE_BY_CLS[m.cls];
  return r ? { tool: r.tool, verb: r.verb, needs: TOOL_NEEDS[r.tool], confirm: m.budget !== 'deco' } : null;
}
/** Does the held tool kind (a string, or null) do the job for `kind`? */
export function shapeToolOk(kind, toolKind) {
  const r = shapeRule(kind);
  return !!r && !!toolKind && r.tool === toolKind;
}
const NOUN = { mushroom: 'mushroom patch' };
const nounOf = (kind) => { const m = kindMeta(kind); return NOUN[kind] || String((m && m.label) || 'one').toLowerCase(); };
/** The Yes / No question before a permanent removal. */
export function shapeConfirmText(kind) {
  const r = shapeRule(kind), m = kindMeta(kind), n = nounOf(kind);
  if (!r || !m) return 'Remove this for good?';
  if (m.cls === 'rock') return `Break this ${n} for good? It won't come back.`;
  if (m.cls === 'digspot') return `Fill in this ${n} for good? It won't come back.`;
  if (m.cls === 'tree' || m.cls === 'palm' || m.cls === 'bamboo') return `Chop this ${n} down for good? It won't grow back.`;
  return `Dig up this ${n} for good? It won't grow back.`;
}
/** The line shown when the last native of a kind is refused ("That's the island's last cherry blossom tree!"). */
export const guardLine = (kind) => `That's the island's last ${nounOf(kind)}!`;
/** The player-facing line of a refused Shape removal (null for a reason with no line of its own). */
export function removeRejectLine(reason, kind) {
  if (reason === 'last-native') return guardLine(kind);
  if (reason === 'last-dig') return LINES['last-dig']();
  if (reason === 'no-tool') return (shapeRule(kind) || {}).needs || 'Wrong tool.';
  if (reason === 'far') return 'Too far away.';
  if (reason === 'gone') return 'That is already gone.';
  return null;
}
