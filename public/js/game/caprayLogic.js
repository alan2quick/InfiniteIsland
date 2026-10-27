// Pure rules of Capray's quest line "The Little Lantern" (PLAN Step 73b). No three.js, no DOM, no network: Node-tested in test/capray.test.js.
// The host domain is game/capray.js, the world side (wild ray, shade moss, stable) world/caprayWorld.js + world/petStable.js, the plan world/islands/duskCapray.js.
//
//   State          { stage 0..5, fed 0..3, moss [bool x3] (cleared), spores [bool x3] (showered), hits [n x3] (swings on each moss), leader: actorKey | null, scene: { queued, startAt } }
//   STAGES         0 unseen, 1 sighted, 2 trust (offerings under way), 3 lantern (the three titans), 4 favourite (wants a Lanternkoi), 5 befriended
//   freshState() / normaliseState(raw) / savedView(state) / debugState(stage) / hashView(state)
//                  the SAVED form is { stage, fed, moss, spores, leader } (hits and the scene are session-only); a hand-edited or old save is made consistent:
//                  fed >= 3 means stage >= 3, 1..2 means stage >= 2, moss / spores only exist from stage 3, all three showered means stage >= 4, a shower needs its moss cleared.
//   needOf(state)  'glimmerfin' | 'lanternkoi' | null: what the ray wants next
//   Validation     validateSight / validateFeed / validateHit / validateShake -> null | reason     (the HOST runs them; distances are measured by the caller and omitted for the host / debug)
//   Transitions    applySight / applyFeed / applyHit / applyShake / applyBefriend -> a NEW state (never mutates)
//   rareBoost(stage, pity) -> the extra Lanternkoi chance the fishing roll adds during stage 4 (pity = Glimmerfin caught since stage 4 began)
//   rayGlow(state) the wild ray's glow multiplier        titanDim(state, i) 0 | 1: is titan i's cap smothered        mossScale(state, i) 0..1: how much of the moss is left
//   marloLine(state, rodSeen) Marlo's pointer for the stage   LOCKED_PETS the stable's three silhouettes
import { CAPRAY } from '../config.js';

export const STAGES = ['unseen', 'sighted', 'trust', 'lantern', 'favourite', 'befriended'];
export const TITANS = 3;
const MAX_KEY = 64;

/** The stable's locked silhouettes: pets of the other islands (Steps 74+) and the hint the menu shows for each. */
export const LOCKED_PETS = [
  { id: 'home', hint: 'Something small watches the home campfire...' },
  { id: 'frost', hint: 'Tracks in the Frostpine snow...' },
  { id: 'ember', hint: "A rustle in Emberleaf's leaves..." },
];

const clampInt = (v, a, b, d = a) => (Number.isFinite(Number(v)) ? Math.min(b, Math.max(a, Math.floor(Number(v)))) : d);
const bools = (raw) => Array.from({ length: TITANS }, (_, i) => !!(Array.isArray(raw) && raw[i] === true));
const sceneOf = (raw) => ({ queued: !!(raw && raw.queued === true), startAt: Number.isFinite(raw?.startAt) ? raw.startAt : null });

export const freshState = () => ({
  stage: 0, fed: 0, moss: bools(), spores: bools(), hits: Array(TITANS).fill(0), leader: null, scene: { queued: false, startAt: null },
});

/** Make a saved / received state safe and self-consistent (see the header). */
export function normaliseState(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  let stage = clampInt(r.stage, 0, 5, 0), fed = clampInt(r.fed, 0, CAPRAY.fedNeed, 0);
  let moss = bools(r.moss), spores = bools(r.spores);
  if (fed >= CAPRAY.fedNeed) stage = Math.max(stage, 3);
  else if (fed >= 1) stage = Math.max(stage, 2);
  if (stage >= 3) fed = CAPRAY.fedNeed;
  else if (stage === 2) fed = Math.max(1, fed);
  else fed = 0;
  if (stage === 3) {
    spores = spores.map((s, i) => s && moss[i]);
    if (spores.every(Boolean)) stage = 4;
  }
  if (stage >= 4) { moss = bools([true, true, true]); spores = bools([true, true, true]); }
  if (stage < 3) { moss = bools(); spores = bools(); }
  const hits = Array.from({ length: TITANS }, (_, i) => (stage < 3 ? 0 : moss[i] ? CAPRAY.hits : clampInt(r.hits?.[i], 0, CAPRAY.hits - 1, 0)));
  const leader = typeof r.leader === 'string' && r.leader.length > 0 && r.leader.length <= MAX_KEY ? r.leader : null;
  return { stage, fed, moss, spores, hits, leader, scene: stage === 5 ? sceneOf(r.scene) : { queued: false, startAt: null } };
}

export const savedView = (s) => ({ stage: s.stage, fed: s.fed, moss: [...s.moss], spores: [...s.spores], leader: s.leader });
export const hashView = (s) => ({ stage: s.stage, fed: s.fed, moss: [...s.moss], spores: [...s.spores], hits: [...s.hits], leader: s.leader, scene: { ...s.scene } });
export const cloneState = (s) => normaliseState({ ...s, scene: s.scene });

/** What the ray wants next: Glimmerfin while it learns to trust (stages 1-2), a Lanternkoi when it is the favourite (stage 4). */
export function needOf(s) {
  if (s.stage === 1 || s.stage === 2) return 'glimmerfin';
  if (s.stage === 4) return 'lanternkoi';
  return null;
}

/** The canonical state at the START of stage n (debug / tests): earlier stages' work done, this stage's work not. */
export function debugState(n) {
  const stage = clampInt(n, 0, 5, 0), all = [true, true, true];
  return normaliseState({
    stage, fed: stage === 2 ? 1 : stage >= 3 ? 3 : 0,
    moss: stage >= 4 ? all : null, spores: stage >= 4 ? all : null, scene: stage === 5 ? { queued: true } : null,
  });
}

// ------------------------------------------------------------------------------------------------ validation (host)
const dOk = (dist, range) => dist === null || dist === undefined || dist <= range;

export function validateSight({ state, dist = null, range = CAPRAY.sight + CAPRAY.remoteSlack }) {
  if (!state) return 'bad-request';
  if (state.stage !== 0) return 'seen';
  if (!dOk(dist, range)) return 'far';
  return null;
}

/** dist = the actor's distance outside the pond's edge (omit for the host / debug); have = how many of `fish` the shared bag holds. */
export function validateFeed({ state, fish, have, dist = null, range = CAPRAY.feedReach + CAPRAY.remoteSlack }) {
  if (!state || (fish !== 'glimmerfin' && fish !== 'lanternkoi')) return 'bad-request';
  if (state.stage === 0) return 'unseen';
  if (state.stage >= 5) return 'gone';
  if (state.stage === 3) return 'full';
  if (needOf(state) !== fish) return 'wrong-fish';
  if (!dOk(dist, range)) return 'far';
  if (!(Math.floor(Number(have)) >= 1)) return 'none';
  return null;
}

/** dist = the actor's distance to the titan's stem SURFACE; tool = the kind the host knows the actor holds (axe | sword | lightsaber clear moss). */
export function validateHit({ state, i, tool, dist = null, range = CAPRAY.hitReach + CAPRAY.hitSlack }) {
  if (!state || !Number.isInteger(i) || i < 0 || i >= TITANS) return 'bad-request';
  if (state.stage !== 3) return 'locked';
  if (state.moss[i]) return 'cleared';
  if (!CLEARING_TOOLS.includes(tool)) return 'no-tool';
  if (!dOk(dist, range)) return 'far';
  return null;
}
export const CLEARING_TOOLS = ['axe', 'sword', 'lightsaber'];

/** actorDist = the shaker's distance to the stem surface, leaderDist = the LEADER's distance to the stem surface (null = the leader is unknown / away: the ray is not with anyone). */
export function validateShake({ state, i, actorDist = null, leaderDist = null, range = CAPRAY.shakeActorReach + CAPRAY.hitSlack, leaderRange = CAPRAY.shakeReach }) {
  if (!state || !Number.isInteger(i) || i < 0 || i >= TITANS) return 'bad-request';
  if (state.stage !== 3) return 'locked';
  if (!state.moss[i]) return 'smothered';
  if (state.spores[i]) return 'done';
  if (!dOk(actorDist, range)) return 'far';
  if (!(leaderDist !== null && leaderDist <= leaderRange)) return 'leader-far';
  return null;
}

// ------------------------------------------------------------------------------------------------ transitions
export function applySight(s) {
  return s.stage === 0 ? normaliseState({ ...s, stage: 1 }) : s;
}

/** A fish offered: Glimmerfin 1..3 (stage 2 on the first, 3 on the third), the Lanternkoi ends it (stage 5, the befriend scene queued). The feeder becomes the leader. */
export function applyFeed(s, fish, key = null) {
  if (needOf(s) !== fish) return s;
  const leader = key || s.leader;
  if (fish === 'lanternkoi') return normaliseState({ ...s, stage: 5, leader, scene: { queued: true, startAt: null } });
  const fed = Math.min(CAPRAY.fedNeed, s.fed + 1);
  return normaliseState({ ...s, fed, stage: fed >= CAPRAY.fedNeed ? 3 : 2, leader });
}

/** One swing on moss i: the count grows to CAPRAY.hits, the last one clears it. Returns { state, final }. */
export function applyHit(s, i, key = null) {
  const hits = [...s.hits], moss = [...s.moss];
  hits[i] = Math.min(CAPRAY.hits, hits[i] + 1);
  const final = hits[i] >= CAPRAY.hits;
  if (final) moss[i] = true;
  return { state: normaliseState({ ...s, hits, moss, leader: key || s.leader }), final };
}

/** A spore shower on titan i. The third shower makes Capray the favourite (stage 4). */
export function applyShake(s, i, key = null) {
  const spores = [...s.spores];
  spores[i] = true;
  return normaliseState({ ...s, spores, leader: key || s.leader });
}

export const withLeader = (s, key) => ({ ...s, leader: key });

// ------------------------------------------------------------------------------------------------ derived numbers
/** The extra Lanternkoi chance (added to FISHING.rareChance) while stage 4 is active: CAPRAY.pityBase + pity (Glimmerfin caught since stage 4 began) x CAPRAY.pity, capped so the TOTAL never passes CAPRAY.rareCap. */
export function rareBoost(stage, pity, base = 0) {
  if (stage !== 4) return 0;
  return Math.max(0, Math.min(CAPRAY.rareCap - base, CAPRAY.pityBase + Math.max(0, pity) * CAPRAY.pity));
}
/** The Lanternkoi chance the roll should use. */
export const rareChance = (stage, pity, base) => base + rareBoost(stage, pity, base);

/** The wild ray's glow multiplier: shy by the pond, dim once the titans are dark (the sad bubble), a step brighter per shower, full when it is the favourite. */
export function rayGlow(s) {
  const g = CAPRAY.glow;
  if (s.stage < 3) return g.shy;
  if (s.stage === 3) return Math.min(g.full, g.sad + g.perSpore * s.spores.filter(Boolean).length);
  return g.full;
}
/** 1 while titan i's moss smothers its cap, else 0. */
export const titanDim = (s, i) => (s.stage === 3 && !s.moss[i] ? 1 : 0);
/** How much of titan i's moss remains (1 full .. 0 cleared); shrinks one quarter per swing. */
export const mossScale = (s, i) => (s.stage < 3 || s.moss[i] ? 0 : Math.max(0, 1 - s.hits[i] / CAPRAY.hits));
export const mossShown = (s, i) => s.stage === 3 && !s.moss[i];

/** How the stage reads in the world: where the wild ray should be. 'hidden' = not yet seen, 'pond' = by its pond (waiting for a fish: stages 1-2, and stage 4 once the titans are lit:
 *  the Lanternkoi is offered at the pond, so it waits there), 'follow' = trailing its leader round the titans, 'gone' = befriended. */
export function rayPlace(s, rodSeen) {
  if (s.stage === 0) return rodSeen ? 'shy' : 'hidden';
  if (s.stage <= 2 || s.stage === 4) return 'pond';
  if (s.stage === 3) return 'follow';
  return 'gone';
}

/** Marlo's pointer for each stage (he stands at the Duskcrown dock). */
export function marloLine(s, rodSeen = true) {
  switch (s.stage) {
    case 0: return rodSeen
      ? ['Saw something glowing under the pads, crew. Shy little thing. Try the ponds nearest the hearth, and go quiet.']
      : ['Pick up one of those rods by the hearth, crew. The marsh has more to show a patient angler.'];
    case 1: return ['A little ray, I would say. Hungry, shy. A Glimmerfin might win its trust. Slowly, one at a time.'];
    case 2: return ['It is warming to you! Keep the Glimmerfin coming. Three should do it.'];
    case 3: return ['Its light has gone dim, crew. It keeps looking at the big mushrooms. Something is smothering them. An axe or a sword might sort it out, then give the stems a good shake.'];
    case 4: return ['It is glowing like a lantern, and it swam home to its pond! Now it wants something special: a Lanternkoi. Watch for ORANGE ripples on the deeper ponds and the lagoon. Patience, crew. They bite more as you go.'];
    default: return ['Your little ray found a good crew, I reckon. The pet stable by the hearth will keep it for you.'];
  }
}
