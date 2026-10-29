// Tool capability table (single place to tune what each held item can do) + helper lookups.
//
//   TOOLS[kind] = { chop: hitsToFellTree, break: hitsToBreakRock, dig: digsNeeded }     0 = cannot do that
//   getToolAction(heldItem, interactable)  -> 'chop' | 'break' | 'dig' | 'strike' | 'fish' | 'water' | null     ('water' = Step 86d: the watering can on a planted sprout / sapling, type 'sprout')
//   toolHits(kind, action)                 -> number of hits needed (0 = not capable)
//
// Interactable types: 'tree' and 'palm' are chopped (that includes Frostpine's spruces, pines and birches, type 'tree'), 'rock' is broken (granite too), 'digspot' is dug (shovel only). Anything else falls back to the
// normal interaction (shake / clink / ...): that includes 'bookstand' (Storybook Cay's page lecterns, Step 48: "Read" even with a tool in hand), 'pond' (Duskcrown's fishing ponds, Step 72a: 'fish' with the Glowline Rod, otherwise the pond is not even a target), 'toolrack' (Take / Swap tool), 'hatrack' (Try on a hat) and 'npc' (Talk, Step 28a) and 'tdoong' (Talk, the wandering Tdoongz, Step 64a), which are plain interacts even with a tool in hand. New tool verbs go in ACTION_OF + the table and are routed in main.js.
export const TOOLS = {
  axe:        { chop: 3, break: 3, dig: 0 },
  sword:      { chop: 4, break: 4, dig: 0 },
  lightsaber: { chop: 1, break: 1, dig: 0 },
  hammer:     { chop: 0, break: 2, dig: 0 },   // no chopping: trees are just shaken
  slingshot:  { chop: 0, break: 0, dig: 0 },   // Step 59: a ranged combat weapon (it only fights inside the combat areas)
  shovel:     { chop: 0, break: 0, dig: 1 },   // digs up potatoes at dig spots (world/gathering.js)
  'watering-can': { chop: 0, break: 0, dig: 0 },   // Step 60: a support weapon (it only fights inside the combat areas; outside it just splashes)
  rod:        { chop: 0, break: 0, dig: 0 },   // Step 72a: the Glowline Rod (Duskcrown); it only fishes (ACTION_OF.pond = 'fish', FISH_TOOLS) and is not a weapon
};
// Tools that can fish a 'pond' (Step 72a). getToolAction(rod, pond) = 'fish'; every other tool leaves a pond alone (no prompt, no action).
export const FISH_TOOLS = ['rod'];

// Island gathering specialties; dungeon and Storybook combat tune separately.
export const TOOL_BONUSES = { hammerRare: 2, axeLogs: 1.5 };
export const ISLAND_SWINGS = {
  axe: { duration: 0.5, reachBonus: 0 },
  sword: { duration: 0.34, reachBonus: 0.4 },
  hammer: { duration: 0.62, reachBonus: 0 },
  slingshot: { duration: 0.4, reachBonus: 0 },
  'watering-can': { duration: 0.45, reachBonus: 0 },
  rod: { duration: 0.55, reachBonus: 0 },                 // Step 72a: the cast flick
};
export const toolReachBonus = (kind) => ISLAND_SWINGS[kind]?.reachBonus || 0;
export const rareChance = (chance, kind) => Math.min(1, chance * (kind === 'hammer' ? TOOL_BONUSES.hammerRare : 1));
export function bonusLogs(n, kind, random = Math.random) {
  const value = n * (kind === 'axe' ? TOOL_BONUSES.axeLogs : 1);
  const whole = Math.floor(value);
  return whole + (value > whole && random() < value - whole ? 1 : 0);
}

const rubyAction = (kind, type) => type === 'rubydig' ? (kind === 'shovel' ? 'dig' : null) : type === 'rubycoconut' ? (['axe', 'hammer'].includes(kind) ? (kind === 'hammer' ? 'break' : 'chop') : null) : type === 'rubycrust' ? (['hammer', 'axe', 'sword'].includes(kind) ? 'break' : null) : undefined;

const ACTION_OF = { sprout: 'water', tree: 'chop', palm: 'chop', rock: 'break', ritualstone: 'strike', digspot: 'dig', seeddig: 'dig', pond: 'fish', shademoss: 'chop' };   // (seeddig: Emberleaf's glinting seed spots, world/seeds.js; shademoss: Duskcrown's smothered titans, Step 73b: an axe / sword / saber 'chops' it, main.js routes that to capray.clearMoss instead of harvest)

export function toolHits(kind, action) {
  const t = TOOLS[kind];
  if (action === 'strike') return t ? 1 : 0;
  if (action === 'fish') return FISH_TOOLS.includes(kind) ? 1 : 0;      // (a pond is fished, not hit: 1 = capable)
  if (action === 'water') return kind === 'watering-can' ? 1 : 0;         // (Step 86d: a sprout / sapling is watered, not hit)
  return (t && t[action]) || 0;
}

/**
 * What would Interact do to `interactable` with `held` (an items.js record, or null)? Returns a tool action or null
 * (null = fall back to the normal interaction: shake / clink / ...).
 */
export function getToolAction(held, interactable) {
  if (!held || !interactable || held.state !== 'held') return null;
  const special = rubyAction(held.kind, interactable.type);
  if (special !== undefined) return special;
  const action = ACTION_OF[interactable.type];
  if (!action) return null;
  return toolHits(held.kind, action) > 0 ? action : null;
}

/**
 * Like getToolAction but for a tool KIND (the host validating another screen's request: it knows which tool the actor holds, not its
 * local record state). Standing stones accept 'strike' from every registered tool.
 */
export function actionForKind(kind, interactable) {
  if (!kind || !interactable) return null;
  const special = rubyAction(kind, interactable.type);
  if (special !== undefined) return special;
  const action = ACTION_OF[interactable.type];
  if (!action) return null;
  return toolHits(kind, action) > 0 ? action : null;
}
