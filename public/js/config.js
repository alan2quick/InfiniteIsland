// Central palette + tunables. Everything is exported so other modules never hardcode magic numbers.

// Game version, shown on the title card. The client can't read package.json (only public/ is deployed), so this is
// the source of truth: bump it together with "version" in package.json. Minor = last completed PLAN.md step.
export const VERSION = '0.85.4';

// Held-mouse direction: world-unit dead bands, optional pooled ground ring.
export const MOUSE_STEER = { dead: 0.6, sideDead: 0.4, ring: true };

// Step 67: screen-local feedback only; none of these values govern combat resolution.
export const JUICE = {
  freeze: [0, 0.035, 0.07, 0.1, 0.07], freezeCooldown: 0.12,
  shake: [0, 0.03, 0.07, 0.13, 0.2], hurtShake: 0.04,
  flash: { hold: 0.06, fade: 0.1, white: '#ffffff', reduced: '#ffe5bd', block: '#b4c9df', hurt: '#ff667d' },
  recoil: { duration: 0.18, slide: 0.12, lean: 0.16 },
  finish: { duration: 0.25, speed: 0.3, push: 0.045 }, defeat: 0.55, comboWindow: 1.5,
  numbers: { default: true, pool: 64, life: 0.95, comboWindow: 2, colors: ['#fff', '#fff', '#ffe27a', '#ffab68', '#ffab68'] },
  warnings: { hop: '#ffd58c', dodge: '#ff769b', out: '#d797ff', lock: 0.25, glint: 0.35 },
  shock: { spin: { shake: 0.07 }, chop: { shake: 0.08 }, pound: { shake: 0.1, double: true }, shockwave: { shake: 0.16 }, quake: { shake: 0.14 }, flop: { shake: 0.14 }, wave: { shake: 0.1 }, ring: { shake: 0.07 }, stomp: { shake: 0.08 }, 'frost-nova': { shake: 0.1 }, ember: { shake: 0.1 }, steam: { shake: 0.08 }, phase: { shake: 0.13 } },
  shockPool: 12, marks: 6, markLife: 1.5, shockLife: 0.55,
  sound: { gain: 0.65, range: 30, voices: 4, limits: { boom: 3, defeat: 2, windup: 3, charge: 4, heartbeat: 1 }, totalVoices: 24, throttle: 0.025, pitch: 0.06, cutoff: 0.1, duck: 0.707, duckTime: 0.25 },
  trail: { sword: '#ffffff', axe: '#ffd38e', hammer: '#e9c7ff', slingshot: '#e7ecf5', 'watering-can': '#8fdcff' },
  hurtFreeze: 0.035, ghostDelay: 0.4, ghostDrain: 0.5, heartbeat: 0.9,
  rumble: { hit: 35, hurt: 100, smash: 160 },
};

// Emberleaf counts / clearances and inexpensive procedural effects (Step 30).
export const EMBER_PROPS = { trees: 120, bamboo: 18, boulders: 30, ferns: 110, flowers: 100, landingClear: 14, laneHalf: 3.4 };
export const EMBER_FX = { smokeCount: 64, smokeRise: 56, smokeLife: 28, smokeDrift: 32, steamCount: 18, steamRise: 4, steamLife: 7, sparkleInterval: 0.8 };

export const PALETTE = {
  grassLight: '#8fe36b',
  grassDark: '#5fc25a',
  sand: '#ffe6a3',
  cliff: '#d9a066',
  dirt: '#d9a066',
  waterShallow: '#6fe3ef',
  waterDeep: '#2f9bdc',
  rock: '#b9b4cc',
  canopy: '#58c96b',
  blossom: '#ffb3d1',
  trunk: '#9a6a44',
  outline: '#2b2340',
  skyTop: '#7cc8ff',
  skyHorizon: '#ffe9f5',
};

// ---- World
export const WATER_LEVEL = 0;
export const ISLAND_RADIUS = 55;       // island radius before the beach drops into the sea
export const WORLD_SIZE = 150;         // terrain mesh extent (units)
export const TERRAIN_SEGMENTS = 240;      // 0.625u per cell so the stream channel and cliffs read clearly
export const WORLD_SEED = 1337;
export const SEA_FLOOR = -3;             // open-sea terrain height (far from every island)

// ---- Archipelago (Step 27a): three islands in ONE world coordinate space. `radius` is the coast radius before the beach
// drops into the sea. Home is unchanged (mesh +-75). Every other island gets a square terrain mesh of half-extent
// radius + ISLAND_MESH_MARGIN centred on (x, z); the meshes must never overlap (sea-floor z-fighting), so centres are
// placed with the squares just touching: frost's south edge is z = -75 (home's north mesh edge) and ember's west edge is x = 75.
// Each big island grows a headland (a "spit") towards home so a bridge only has to cross ~26 u of open sea (see islands/*.js).
export const ISLAND_MESH_MARGIN = 12;
export const ISLANDS = [
  { id: 'home', name: 'Infinite Island', x: 0, z: 0, radius: ISLAND_RADIUS, biome: 'meadow', seed: WORLD_SEED },
  { id: 'frost', name: 'Frostpine Isle', x: 0, z: -197, radius: 110, biome: 'alpine', seed: 2101 },     // north (-Z)
  { id: 'ember', name: 'Emberleaf Isle', x: 197, z: 47, radius: 110, biome: 'volcanic', seed: 3307 },   // east (+X)
  // Storybook Cay (Step 48): a small papery meadow west of home. Its mesh square (radius + margin = 62 u each side) just touches home's (x = -75), like the other two.
  { id: 'story', name: 'Storybook Cay', x: -137, z: 15, radius: 50, biome: 'storybook', seed: 4409 },   // west (-X)
  // Duskcrown Isle (Step 69a): far to the south-east, a RECTANGULAR island (330 x 220 u coast frame; halfX / halfZ are the frame's half sizes and the terrain mesh adds ISLAND_MESH_MARGIN to
  // each, 184 x 130, see world/islands/extent.js). Its mesh rectangle is x 696..1064, z 230..490: its nearest coast is about 500 u from Emberleaf's cove, past the fog (330 u),
  // so the first sight of it is from the boat. No bridge and no travel entry: it can only be reached with the debug flag `?duskcrown` / __game.world.goto('duskcrown').
  { id: 'duskcrown', name: 'Duskcrown Isle', x: 880, z: 360, radius: 110, halfX: 172, halfZ: 118, biome: 'fungal', seed: 5521 },   // far south-east
];
// Bridges: a -> b is the deck centre line, a on the `from` island's beach, b on the `to` island's beach (both beach tier, walkable).
// The deck only exists while the bridge is open (terrain.setBridgeOpen); `surface` is its ground type; `cost` is what the builder NPC wants.
export const BRIDGES = [
  { id: 'frost', from: 'home', to: 'frost', ax: 9.5, az: -50.5, bx: 9.5, bz: -82.5, width: 3, npc: 'cobble', cost: { stone: 30 }, surface: 'stone' },
  { id: 'ember', from: 'home', to: 'ember', ax: 51.5, az: 0, bx: 82.5, bz: 0, width: 3, npc: 'bramble', cost: { log: 20 }, surface: 'wood' },
  // Quill's bridge (Step 48) to Storybook Cay. Two materials, paid in order: the stone first (stages 1-2), then the logs (stages 3-4); see game/bridgeLogic.js phases.
  { id: 'story', from: 'home', to: 'story', ax: -49.5, az: 15, bx: -85, bz: 15, width: 3, npc: 'quill', cost: { stone: 15, log: 15 }, surface: 'wood' },
];

// ---- The Frostpine camp (Step 33b). Island-local coordinates (x east, z south, origin = the island centre) of the camp fire on the foothill meadow between the
// bridge landing (9.5, +114.5) and the plateau's south ramp foot (0, -7). `clear` = radius kept free of every prop, gathering spot and tool pickup (placement reads
// it); `flat` = the terrain is levelled to the fire's height inside `flat.r` and blends back to the natural ground by `flat.fade`; `paint` = the trampled-snow
// clearing painted into the terrain colours (solid inside `full`, gone by `fade`). `stumps` = the four tree-stump seats (angles in radians, x = cos, z = sin).
// Reserved for later steps (offsets from the fire, `r` = footprint; NOTHING is built there yet, they only keep the clearing from being reshuffled):
//   dens (Step 34: the eight critter dens, a north arc behind the fire), build (Step 35: windbreak / woodpile / trough / lantern posts / grove shelter),
//   tailStump (Step 36: the carved hollow log with the tails).
const _den = (i) => { const a = 1.5 * Math.PI + (i - 3.5) * 0.3; return { dx: +(Math.cos(a) * 8.8).toFixed(2), dz: +(Math.sin(a) * 8.8).toFixed(2), r: 0.9 }; };
export const FROST_CAMP = {
  x: -5, z: 28, clear: 14,
  flat: { r: 7, fade: 15 },
  paint: { full: 8.5, fade: 13.5 },
  stumps: { ring: 2.5, angles: [0.62, 2.19, 3.76, 5.33] },
  dens: Array.from({ length: 8 }, (_, i) => _den(i)),
  build: {
    windbreak: { dx: 0, dz: -5.2, r: 2.2 }, woodpile: { dx: -6.4, dz: 2.2, r: 1.1 }, trough: { dx: 6.0, dz: -0.8, r: 1.0 },
    lanterns: [{ dx: -9.2, dz: -7.0, r: 0.4 }, { dx: 9.2, dz: -7.0, r: 0.4 }, { dx: -7.0, dz: 6.2, r: 0.4 }, { dx: 10.4, dz: 7.6, r: 0.4 }],
    shelter: { dx: 9.4, dz: 3.0, r: 3.0 },
  },
  tailStump: { dx: -8.6, dz: 3.2, r: 0.9 },
};

// ---- The Frostpine critters (Step 34a): eight hungry animals in the wild, two of each species. `food` = the catalog item each species wants (both of a species want the same);
// `spots` = where each wanders (island-local anchor; islands/critterPlan.js snaps it to the nearest valid ground, so the numbers only need to be roughly right), `near` = how
// the spot is chosen ('tree' = beside a tree). `den` = the order of the camp's eight reserved den spots (FROST_CAMP.dens) the species take, two each, next to each other.
// hint = a player this close (u) makes the critter hop and think of its food (re-arms once everybody is `hintReset` away); wander = the idle roam radius round the spawn.
const _spot = (id, species, x, z, zone, near = null) => ({ id, species, x, z, zone, near });
export const CRITTERS = {
  species: ['fox', 'squirrel', 'rabbit', 'grouse'],
  food: { fox: 'snow-truffle', squirrel: 'pinecone', rabbit: 'mint', grouse: 'lingonberry' },
  spots: [
    _spot('critter-fox-0', 'fox', -48, -4, 'west forest edge'),
    _spot('critter-fox-1', 'fox', 54, 52, 'frozen lake shore'),
    _spot('critter-squirrel-0', 'squirrel', 64, -22, 'east pines', 'tree'),
    _spot('critter-squirrel-1', 'squirrel', 22, -30, 'plateau, east side', 'tree'),
    _spot('critter-rabbit-0', 'rabbit', -62, 58, 'far south-west meadow'),
    _spot('critter-rabbit-1', 'rabbit', -22, -38, 'plateau, west side'),
    _spot('critter-grouse-0', 'grouse', 6, -70, 'below the peaks'),
    _spot('critter-grouse-1', 'grouse', -45, -80, 'far northern meadow'),
  ],
  hint: 5, hintReset: 8, hintCooldown: 10, hintTime: 2.6, wander: 2, wanderMax: 6,
  radius: { fox: 0.5, squirrel: 0.4, rabbit: 0.4, grouse: 0.4 },         // collider circle (u)
  scale: { fox: 1.15, squirrel: 1.2, rabbit: 1.25, grouse: 1.25 },        // model scale: a little bigger than drawn so they read at gameplay zoom (fox ~1.15 u, rabbit ~1.25 u with ears)
};

// ---- The Frostpine camp jobs (Step 35a): the Frostpine Fire Spirit's short quest line, done in this order, one at a time. Each job takes the materials in `needs`
// ({ catalogItemId: amount }, delivered from the shared bag at the camp fire's "Camp jobs" row) and raises the camp's comfort by one when the last one arrives (35b builds
// the structures). `blurb` = the spirit's one-line description of the job. Needs at least one critter living at the camp (CRITTERS) before anything is accepted.
export const CAMP_JOBS = [
  { id: 'windbreak', name: 'Windbreak & log benches', blurb: 'A curved log wall to stop the wind, and proper benches to sit on instead of cold stumps!', needs: { 'pine-log': 10, stone: 8, 'birch-log': 4 } },
  { id: 'dens', name: 'Cozy dens & lantern posts', blurb: 'Soft beds of pine boughs for every critter, and crystal lanterns to light the way home.', needs: { 'birch-log': 8, pinecone: 12, lingonberry: 6, crystal: 3 } },
  { id: 'shelter', name: 'The grove shelter', blurb: 'A big wooden roof over the camp, with truffles for the feast pot and more lights. A proper grove!', needs: { 'pine-log': 16, stone: 10, 'snow-truffle': 6, crystal: 4 } },
];
export const CAMP_MAX_COMFORT = CAMP_JOBS.length;

// ---- The Emberleaf terrace garden (Step 37a). Island-local coordinates (x east, z south). The terraces are rings round the volcano (EMBER_FEATURES.volcano), so the
// garden is described in POLAR terms about it: `a` = angle from the volcano (atan2(dz, dx); PI/2 = due south, the default camera side; a larger angle swings west),
// `d` = distance from the volcano centre. Three tiers (flat tops, measured on Step 30's terrain at a = PI/2): top d ~ 40.5 (h 7.2), middle d ~ 48.3 (h 5.2),
// bottom d ~ 54.8 (h 3.3), each separated by a gentle 3-4 u riser. The terraces are NOT flattened; only a small pad under the hearth is levelled (`flat`).
//   x, z      the garden hearth (FIRES 'ember') on the middle tier         clear   radius kept free of tool pickups / items round it (nearAnyFire)
//   flat      the hearth pad: levelled to the hearth height inside flat.r, blending back to the natural ground by flat.fade
//   zone      the wedge kept free of every prop, gathering spot and tool pickup (|angle - zone.a| < zone.half, d0 < d < d1)
//   paint     the dark volcanic soil painted into the terrain colours (the same wedge, solid inside, soft noisy edge by `fade`; radial d0..d1)
//   tiers     the plot rows (Step 37b, reserved only): nominal d of the tier's flat, the angle offsets of its plots from the hearth line (positive = west); the
//             pure module world/islands/emberGarden.js snaps each plot to the flattest ground within +-snap u of d. `open` = usable at stage 0 (4 of the 16).
//   mossback  where Mossback the tortoise stands (Step 37a, later), garland = the garland stand (Step 40), stages = the three build-stage spots (Step 39):
//             `tier` + angle offset `da` + `r` (footprint). Nothing is built at any of these yet.
export const EMBER_GARDEN = {
  x: 15, z: 43.3, clear: 10,
  flat: { r: 3.4, fade: 8.5 },
  zone: { a: Math.PI / 2, half: 0.36, d0: 36, d1: 61 },
  paint: { half: 0.335, edge: 0.05, d0: 38.4, d1: 57.8 },
  tiers: [
    { id: 'top', d: 41.4, snap: 1.0, plots: [-0.25, -0.15, -0.05, 0.05, 0.15, 0.25], open: [] },
    { id: 'middle', d: 48.3, snap: 1.2, plots: [-0.31, -0.2, 0.2, 0.31], open: [] },
    { id: 'bottom', d: 56.0, snap: 2.6, plots: [-0.31, -0.225, -0.135, 0.135, 0.225, 0.31], open: [-0.225, -0.135, 0.135, 0.225] },   // (the middle of the bottom tier is the ramp the trail arrives on: no plots)
  ],
  mossback: { tier: 'middle', da: 0.13, r: 1.3 },
  garland: { tier: 'middle', da: -0.13, r: 1.2 },
  stages: [
    { tier: 'bottom', da: 0, r: 1.6 },         // stage 1: a gate / arch where the trail arrives on the bottom tier's ramp
    { tier: 'top', da: 0.32, r: 1.6 },          // stage 2: the irrigation channel's inlet, nearest the waterfall
    { tier: 'top', da: -0.32, r: 1.6 },         // stage 3: the glow-lantern arbour at the top tier's east end
  ],
};

// ---- The garden's plots and Mossback the tortoise (Step 37b). The 16 plots sit at the EMBER_GARDEN.tiers spots (game/gardenLogic.js numbers them: top row 0-5, middle 6-9, bottom 10-15).
// `plotOpenStage` = the garden stage at which a tier's plots open (the bottom tier's `open` plots are usable from the start: stage 0 = 4 plots, stage 1 = 8, stage 2 = all 16; Step 39).
// `plotStages` = what a plot shows (Step 38b): empty soil, a planted seed (untended), a sprout (tended), a bud (after the next dusk), a bloom (at the dawn after the night).
// `reach` = how far (u, from the plot's surface) the HOST accepts a remote plant / tend / cutting request; `springReach` the same for "Fill a coconut" at the hot spring (from its rim).
// `bloomOpenDay` = how far a bloom has opened by day (1 = fully open, which it is at night); `maxCuttings` caps the cuttings in stock (one per bloom, so 16 is more than enough).
export const GARDEN = {
  plotOpenStage: { top: 2, middle: 1, bottom: 2 },
  plotStages: ['empty', 'seed', 'sprout', 'bud', 'bloom'],
  maxStage: 3,
  plotRadius: 0.75,
  reach: 3.6,
  springReach: 4.6,
  bloomOpenDay: 0.86,
  maxCuttings: 16,
};
export const GARDEN_JOBS = [
  { id: 'trellises', name: 'Bamboo trellises & stepping stones', blurb: 'Climbing vines and paths between the terraces. Opens eight beds.', needs: { bamboo: 12, stone: 8, 'breadfruit-log': 4 } },
  { id: 'irrigation', name: 'Waterfall irrigation', blurb: 'Bamboo pipes bring water to every terrace. Opens all sixteen beds and helps tended plants bud sooner.', needs: { bamboo: 10, obsidian: 6, 'spring-water': 4, coconut: 6 } },
  { id: 'pavilion', name: 'The lantern pavilion', blurb: 'A woven roof for the hearth, glowing lanterns and flower boxes.', needs: { 'breadfruit-log': 14, obsidian: 8, taro: 6, bamboo: 10 } },
];
// Mossback (world/mossback.js, npc/mossback.js): `wakeR` = a player this close (u) wakes him from his doze; `nearR` = he turns slowly towards the nearest player within this; `radius` = collider.
export const MOSSBACK = { name: 'Mossback', radius: 0.8, scale: 1.5, wakeR: 5.5, nearR: 6.5, yaw: 0.25, talkRadius: 1.0 };

// ---- The Tdoongz (PLAN Steps 64-66; npc/tdoongz.js, game/tdoongzLogic.js, world/tdoongz.js): nine plush animal friends, one per substep. Step 64a: Im Nabong the bunny. Per id: name / korean,
// species, home (legacy camp anchors; island-wide resident assignments and visitor timing are in game/tdoongzVisits.js), speed (u/s), gait,
// scale, nearR, talkRadius, radius, seed, pouch, talk. The Step 65 prelude synchronizes and saves movement and rare visits on the host.
export const TDOONGZ = {
  imnabong: { name: 'Im Nabong', korean: '임나봉', species: 'bunny', home: { fire: 'home', rMin: 5, rMax: 11.5 }, speed: 1.1, gait: 'hop', scale: 1.27, nearR: 4.5, talkRadius: 1.0, radius: 0.56, seed: 64001, pouch: 'carrot' },
  // Steps 64b-d (their intro + menu lines are in game/tdoongzScript.js; `talk: false` would make a friend a collider only, no prompt); each has its own gait ('trot' | 'walk' | 'scurry') and idle flourishes in world/tdoongz.js
  yubbuibbui: { name: 'Yu Bbui Bbui', korean: '유뿌이뿌이', species: 'puppy', home: { fire: 'home', rMin: 5.5, rMax: 12.5 }, speed: 1.6, gait: 'trot', scale: 1.27, nearR: 4.5, talkRadius: 1.0, radius: 0.56, seed: 64002 },
  mokuring: { name: 'Mokuring', korean: '모쿠링', species: 'bear', home: { fire: 'home', rMin: 6, rMax: 13 }, speed: 0.95, gait: 'walk', scale: 1.27, nearR: 4.5, talkRadius: 1.0, radius: 0.56, seed: 64003 },
  shyamshyam: { name: 'Shyam Shyam', korean: '샤샤', species: 'hamster', home: { fire: 'home', rMin: 5, rMax: 10.5 }, speed: 1.5, gait: 'scurry', scale: 1.27, nearR: 4.5, talkRadius: 1.0, radius: 0.56, seed: 64004 },
  // Step 64e: a QUADRUPED (front legs = the model's arms, hind legs = its legs): bigger collider, gait 'quad', she sits for most pauses
  parkzyoni: { name: 'Park Zyoni', korean: '박죠니', species: 'unicorn', home: { fire: 'home', rMin: 6, rMax: 13 }, speed: 1.2, gait: 'quad', scale: 1.35, nearR: 4.5, talkRadius: 1.0, radius: 0.74, seed: 64005 },
  // Step 64f: a penguin with a wide fur puff (radius 0.62), gait 'glide' (light graceful steps), a slower speed
  myodette: { name: 'Myodette', korean: '묘데뜨', species: 'penguin', home: { fire: 'home', rMin: 5.5, rMax: 12 }, speed: 0.85, gait: 'glide', scale: 1.27, nearR: 4.5, talkRadius: 1.0, radius: 0.62, seed: 64006 },
  dubnyangee: { name: 'Dub Nyangee', korean: '둡냥이', species: 'cat', home: { fire: 'home', rMin: 5.5, rMax: 12.5 }, speed: 1.0, gait: 'walk', scale: 1.27, nearR: 4.5, talkRadius: 1.0, radius: 0.56, seed: 64007 },
  sonchaetty: { name: 'Son Chaetty', korean: '손채티', species: 'tiger', home: { fire: 'home', rMin: 6, rMax: 13 }, speed: 0.9, gait: 'walk', scale: 1.27, nearR: 4.5, talkRadius: 1.0, radius: 0.56, seed: 64008 },
  tzukumi: { name: 'Tzukumi', korean: '쯔꾸미', species: 'fawn', home: { fire: 'home', rMin: 6, rMax: 13.5 }, speed: 0.8, gait: 'walk', scale: 1.22, nearR: 4.5, talkRadius: 1.0, radius: 0.56, seed: 64009 },
};

// ---- The eight Night-Bloom seeds (Step 38a; world/seeds.js, game/seedLogic.js, world/islands/emberSeeds.js). `times` = the hour windows (0..24, wrapping) in which the night / dusk finds work AND their cues show
// (the dusk window is wider than the 45 s dusk phase so it can be caught). `reach` = how far (u, to the target's surface) the host accepts a REMOTE actor's find. `digImpact` = the shovel swing progress at
// which the blade hits the soil. `fade` = hours over which a cue fades in / out at a window edge. `anchors` = island-local design points the deterministic plan snaps to: the lagoon shore angle, the black-sand
// beach, the hot spring's rim angle, how far the ash spot sits in from the ramp's end. Under ?daylock the clock never moves, so a night / dusk find is only possible if the locked hour is inside its window
// (?time=night&daylock); the debug hook __game.garden.findSeed(id) ignores the rules.
export const SEEDS = {
  times: { night: [19.5, 5.5], dusk: [15, 23] },
  reach: 4.7,
  digImpact: 0.58,
  fade: 0.5,
  anchors: { lotusAngle: 1.9, beach: { x: -100, z: 40 }, springAngle: 3.3, ashLift: 2.5 },
};

// ---- The reserved waterfall (Step 37c, NOT built yet). Kept out of every prop / gathering spot / tool placement NOW so Emberleaf's seeded placement is only reshuffled once.
// `angle` = the fall line's angle from the volcano centre; `from` / `to` = distance along it (the main fall at ~36-40 u, the terrace cascades out to ~60 u); `half` = the corridor's
// half width. `pool` = the plunge pool (island-local centre, `r` = the exclusion radius: pool, its shore and the ledge approach). `stream` = the island-local polyline from
// the cascade foot to the lagoon's east shore, `streamHalf` its half width. The garden trail (PATHS 'ember-garden') CROSSES the stream once: a shallow, walkable ford (37c keeps it).
export const EMBER_WATERFALL = {
  angle: 2.1, from: 32, to: 61, half: 4.6,
  pool: { x: -5.5, z: 30, r: 8 },
  stream: [[-15.3, 46.8], [-22, 48.7], [-30, 50.4], [-36.5, 51.6]], streamHalf: 3.6,
  // Step 37c, the BUILT design (islands/emberFalls.js). Coordinates are in the fall frame: `s` = distance from the volcano centre along the fall line (angle above), `u` = sideways
  // (positive = west / north-west), `y` = a world height. The water drops from the spring (s 33) down a short channel over a rock lip (`slab`) into the plunge pool, whose
  // spill runs down the three terraces (`cascade`) and across the jungle floor (`stream`, island-local points above) to the lagoon.
  falls: {
    spring: { s: 33.2, r: 1.9, y: 10.46, depth: 0.32 },                    // the source pool on the cone, fed from a crack in the rock
    channel: { s0: 34.6, s1: 36.6, hw: 0.8, depth: 0.28 },                  // spring -> lip (the water surface eases down to slab.y)
    slab: { s0: 36.3, s1: 39.2, y: 10.0, hw: 2.0 },                         // the rock lip the water slides over (visual only), the sheet leaves its front edge
    sheet: { hw: 1.5, drop: 3.2, run: 1.5 },                               // the falling curtain (half width, vertical drop to the pool, outward run)
    pool: { s: 41.6, r: 3.4, y: 6.8, depth: 0.8, rim: 0.28, outlet: 1.1 },  // plunge pool: surface y, basin depth, shore rim above the water, outlet notch half width
    ledge: { y: 7.78, s0: 38.7, s1: 40.0, uEnd: -1.9, uBank: 5.6 },        // the shelf behind the falling water: east end (dead end, Step 38a's seed), west end joins the pool's bank
    cascade: { s0: 45.2, s1: 60, hw: 0.9, depth: 0.32 },                    // the shallow channel down the terraces
    stream: { hw: 1.25, depth: 0.4, ford: 2.2 },                            // the jungle-floor stream to the lagoon; `ford` = half length of the extra-shallow crossing
  },
};

// ---- Trails (Step 33b, world/paths.js): a path is a loosely meandering, painted-in walking trail. `points` = island-local control points (a Catmull-Rom curve
// goes through them), `width` = painted width (u; soft edges, full colour inside ~1/3 of it), `wobble` = seeded sideways drift (u) on top of the curve, `seed`
// = its random seed, `surface` = 'snow' | 'dirt' (the painted colours), `marker` = a wooden post with a lantern every `every` u of the trail, `side` u beside it
// (alternating sides, glowing at night). Nothing else is placed on a path (props, gathering spots and tools keep `width / 2 + clearance` away) and it is
// walkability-tested. Step 37a added Emberleaf's garden trail as the second entry.
export const PATHS = [
  {
    id: 'frost-camp', island: 'frost', name: 'Camp trail',
    points: [[9.5, 111], [7, 98], [16, 84], [6, 70], [-2, 60], [8, 49], [-1.8, 34.6]],
    width: 3.0, wobble: 1.1, seed: 7301, surface: 'snow', marker: { every: 15, side: 2.3 },
  },
  // Emberleaf's garden trail (Step 37a): from the bridge landing's spit across the western jungle, round the north of the lagoon, over the future stream's ford and up to the
  // garden's bottom tier. Packed earth with black-sand flecks ('earth'), bamboo torch posts instead of lanterns (the same `marker` mechanism).
  {
    id: 'ember-garden', island: 'ember', name: 'Garden trail',
    points: [[-110, -46], [-94, -44.5], [-81, -35], [-71, -21], [-63, -4], [-58, 14], [-48, 28], [-36, 38], [-27, 46], [-20, 57], [-6, 61], [8, 61], [14, 58.5]],
    width: 3.0, wobble: 1.0, seed: 7303, surface: 'earth', marker: { every: 13, side: 2.2 },
  },
  // Skipper's Cove spur (Step 68a): branching off the garden trail near its end (8, 61) across the south-eastern lowland to the cove's landward edge (world/islands/emberCove.js). No torch posts.
  {
    id: 'ember-cove', island: 'ember', name: "Skipper's Cove trail",
    points: [[8, 61], [15, 57], [22, 53], [29, 53], [36, 51], [43, 48], [50, 50], [56, 54], [63, 59], [70, 59], [77, 53], [78, 46], [81.4, 43.6]],
    width: 3.0, wobble: 0.3, seed: 7305, surface: 'earth', marker: null, lane: false,   // (lane: false = not a placement lane, so Emberleaf's seeded placement did not move; the route was chosen clear of every prop)
  },
];
// ---- Storybook Cay (Step 48). Island-local coordinates (x east, z south, origin = the island centre; the bridge lands on the EAST spit at about (+52, 0)).
//   book     the giant open pop-up book (centre; w = both pages along X, d = depth along Z); the awning stands over it
//   pad      the flat reading-nook pad (the terrain is levelled to its own height inside pad.r, blending back by pad.fade)
//   stands   the book stands (lecterns): one per page. `page` = the game/pages id it opens; x / z = where the lectern stands (south of the book, on the nook side of the path)
//   quill    where Quill stands once the bridge is open (beside the right-hand page, facing the path)
//   ink / hill   the ink pond (a shallow, dark, walkable puddle) and the reading hill (a gentle rise with the stacked-book shelves round its foot)
//   path     the ribbon trail from the landing to the book (polyline; ribbons mark it every ribbonEvery u)
export const STORY = {
  book: { x: -6, z: -3, w: 21, d: 15 },
  pad: { x: -3, z: 2, r: 14, fade: 24 },
  stands: [{ id: 'meadow', chapter: 'meadow', x: 2.5, z: 8.5 }, { id: 'frostpine', chapter: 'frostpine', x: -2.5, z: 8.5 }, { id: 'emberleaf', chapter: 'emberleaf', x: -7.5, z: 8.5 }],   // (Step 52a: a stand opens a CHAPTER of pages; Frostpine's lectern is reserved for 52b and reads "coming soon")
  popups: { windmill: { x: 14, z: 6 }, sunflower: { x: -18, z: 8 }, snowglobe: { x: -13, z: 15 }, volcano: { x: -4, z: 22 } },   // (Step 52a: the paper cut-outs a secret exit / the Meadow chapter reward pop up on the Cay; offsets from the Cay's centre)
  quill: { x: 9.5, z: 2.5, yaw: 0.3 },
  ink: { x: 22, z: -20, r: 6.5 },
  hill: { x: -27, z: -22, r: 17, h: 2.6 },
  path: [[44, 1], [37, 3], [29, 6.5], [20, 9.5], [12, 10.5], [6, 10]],
  pathHalf: 1.4, ribbonEvery: 8,
  trees: 16, shelves: 9, tufts: 90,
};
const STORY_ISLAND = ISLANDS.find((i) => i.id === 'story');
export const PATH_CLEARANCE = 1.4;       // u beyond the painted half width that props / gathering spots / tools keep from a path (solid props add their own radius and the lane half width)

// ---- Campfires (Step 14: stone firepit + log benches on the flat meadow east of the spawn, visible from the first frame, clear of the sign).
// Every campfire in the world (Step 33a): home's and (Step 33b) Frostpine's camp fire and (Step 37a) Emberleaf's garden hearth: add an entry here and
// world/campfire.js builds an instance for it (campfires.get(id)). `island` = the island whose recipes it cooks (and whose Cook menu it shows);
// `x`/`z` = world position; `bench` = the log benches round the fire (angles in radians, x = cos, z = sin); `feast` = the feast scene's framing
// at THIS fire (camera distance / pitch / orbit, ground half-width that must fit, an optional bench order that replaces the camera-facing order);
// `light` = the shared fire light's numbers when this fire is the one it sits on (see createCampfires). Home's values are the Step 14 / 15 originals.
const FROST_ISLAND = ISLANDS.find((i) => i.id === 'frost');
const EMBER_ISLAND = ISLANDS.find((i) => i.id === 'ember');
const DUSK_ISLAND = ISLANDS.find((i) => i.id === 'duskcrown');
// The marsh hearth (Step 72a). Island-LOCAL x / z (east / south of the frame centre): 5 u east and 11 u north of the landing beach (-15, 88.75), in the flora-free 30 u disc, clear of the dock,
// every lane, the ponds and the 69c / 69d placements (world/islands/duskHearth.js derives the Step 73 stable spot and the rods; test/fishing.test.js checks all of it against the real terrain).
// `clear` = radius kept free of tool pickups (nearAnyFire); the rods and the stable sit just outside it.
export const DUSK_HEARTH = { x: -10, z: 77.75, clear: 5.0, ring: 2.5, angles: [0.62, 2.19, 3.76, 5.33] };
export const FIRES = [
  {
    id: 'home', name: 'Campfire', label: 'campfire', island: 'home', x: 7, z: 9.5, clear: 4.5,
    bench: { ring: 2.6, len: 1.7, angles: [0.62, 2.19, 3.76, 5.33] },
    feast: { camDist: 9.4, camPitch: 0.5, orbit: 25 * Math.PI / 180, halfWidth: 3.7, seatOrder: null },
    light: { height: 1.1, base: 1.6, perLevel: 2.2, dist0: 7, distPerLevel: 2.6 },
  },
  // Frostpine's camp fire (Step 33b): the heart of the camp (FROST_CAMP, above): four tree-stump seats (bench.style 'stump': one seat per stump, `len` unused),
  // snow-dusted stones, its own fuel / save / sync domain ('campfire:frost'), and ONLY Frostpine's recipes. `spirit` = who speaks in its menu; `camp` = it has the
  // intro page + "Camp jobs" row (game/campCamp.js). The feast camera is a little flatter than home's so the plateau shows behind the camp.
  {
    id: 'frost', name: 'Frostpine camp', label: 'camp fire', island: 'frost', spirit: 'Frostpine Fire Spirit', camp: true, snowy: true,
    x: FROST_ISLAND.x + FROST_CAMP.x, z: FROST_ISLAND.z + FROST_CAMP.z, clear: FROST_CAMP.clear,
    bench: { ring: FROST_CAMP.stumps.ring, len: 0, angles: FROST_CAMP.stumps.angles, style: 'stump', logLen: 1.7 },
    feast: { camDist: 9.8, camPitch: 0.44, orbit: 25 * Math.PI / 180, halfWidth: 3.9, seatOrder: null },
    light: { height: 1.1, base: 1.6, perLevel: 2.2, dist0: 7, distPerLevel: 2.6 },
  },
  // Emberleaf's garden hearth (Step 37a): on the garden's middle terrace (EMBER_GARDEN, above), a ring of dark basalt stones with four flat basalt seats (bench.style
  // 'basalt'), levelled pad, its own fuel / save / sync domain ('campfire:ember') and ONLY Emberleaf's recipes. `intro` = the first-open pages (game/campMenu.js); `jobs: false` = no
  // "Camp jobs" row (the garden's story and jobs come with Mossback, Steps 37b-39). The explicit seat order puts the two far (north, volcano-side) seats first, so seated
  // players face the camera with the volcano glowing behind them.
  {
    id: 'ember', name: 'Garden hearth', label: 'garden hearth', island: 'ember', spirit: 'Hearth Spirit', camp: true, jobs: false, stones: 'basalt',
    intro: [
      'Mmm... a warm soul at last! I am the old hearth of these terraces. Feel how the stones still hold the heat?',
      'Look around you: three terraces of dark soil, cracked old stones and a broken trellis. It looks as if somebody once kept a garden here.',
      'Keep my fire fed and cook something with island flavour. I\'ll be right here, glowing.',
    ],
    x: EMBER_ISLAND.x + EMBER_GARDEN.x, z: EMBER_ISLAND.z + EMBER_GARDEN.z, clear: EMBER_GARDEN.clear,
    bench: { ring: 2.5, len: 0, angles: [0.62, 2.19, 3.76, 5.33], style: 'basalt' },
    feast: { camDist: 9.6, camPitch: 0.4, orbit: 25 * Math.PI / 180, halfWidth: 3.9, seatOrder: [2, 3, 1, 0] },
    light: { height: 1.1, base: 1.6, perLevel: 2.2, dist0: 7, distPerLevel: 2.6 },
  },
  // The marsh hearth (Step 72a): Duskcrown's own fire near the landing (DUSK_HEARTH, above). Four short cut-mushroom-stem seats with little caps (bench.style 'capstool', the same seat height as the
  // log benches so the feast needs no change), its own fuel / save / sync domain ('campfire:dusk', save infinite-island.campfire.dusk.v1) and ONLY Duskcrown's recipes (72b). `intro` = the first-open
  // pages (game/campMenu.js, a per-screen flag); `jobs: false` = no "Camp jobs" row. The Step 73 pet stable stands beside it (duskHearth.js reserves the spot).
  {
    id: 'dusk', name: 'Marsh hearth', label: 'marsh hearth', island: 'duskcrown', spirit: 'Hearth Spirit', camp: true, jobs: false,
    intro: [
      'Psst... over here, little glow-friends! I am the hearth of the marsh. Do you hear the ponds humming? Something shimmers under the water out there.',
      'Pick up one of the Glowline Rods beside me, stand at the edge of any pond and cast. Watch for rings of light on the water: that is where the fish are hiding.',
      'Wait for the bite, then press Interact right away! Bring me what you catch and I will cook it. I will be right here, glowing.',
    ],
    x: DUSK_ISLAND.x + DUSK_HEARTH.x, z: DUSK_ISLAND.z + DUSK_HEARTH.z, clear: DUSK_HEARTH.clear,
    bench: { ring: DUSK_HEARTH.ring, len: 0, angles: DUSK_HEARTH.angles, style: 'capstool' },
    feast: { camDist: 9.8, camPitch: 0.42, orbit: 25 * Math.PI / 180, halfWidth: 3.9, seatOrder: [2, 3, 1, 0] },
    light: { height: 1.1, base: 1.6, perLevel: 2.2, dist0: 7, distPerLevel: 2.6 },
  },
];
// `clear` = radius around a fire kept free of props / herbs / dig spots / tool pickups (the benches sit at ~2.6u).
export const CAMPFIRE = FIRES[0];          // the home fire (kept for the code that only ever meant "the" campfire)
// Islands that have a campfire, DERIVED from FIRES. Each fire cooks only its own island's recipes (catalog RECIPES[].island), so a dish is only makeable
// while its island has a fire, and feast quests needing an unmakeable dish stay out of the quest pool.
export const CAMPFIRE_ISLANDS = [...new Set(FIRES.map((f) => f.island))];
/** Is (x, z) inside any fire's keep-clear zone (+ `pad`, e.g. half a prop's radius)? Props, herbs, dig spots and tool pickups use it. */
export const nearAnyFire = (x, z, pad = 0) => FIRES.some((f) => Math.hypot(x - f.x, z - f.z) < f.clear + pad);
// Hat rack (Step 32a): appears after the first feast beside the welcome sign; world x/z stay reserved even while it is hidden.
export const HAT_RACK = { x: -0.6, z: 9.8, radius: 0.65 };
export const SIGNPOST = { x: -4.2, z: 6.8 };
export const ITEM_PICKUP_LOCK = 0.6;
export const DROP_HOLD = 2;
export const ROCK_STONE = { ordinaryTwoChance: 0.75, hammerMin: 2, hammerMax: 3 };
// Bridge builders (Step 28a): the NPCs that arrive after the first feast. Each stands at the HOME end of its bridge (BRIDGES[].npc), at
// lx metres to the side of the deck centre line (negative = the camera side) and lz along the bridge direction (negative = inland, away from the
// gap), clear of the 3 u deck and the stub posts. yaw = idle facing (0 = towards the default camera, +Z), scale = model size. `near` = turn to players within this (u).
export const NPCS = {
  cobble:  { name: 'Cobble',  species: 'mole',   bridge: 'frost', lx: -4.3, lz: -1.6, yaw: 0.25,  radius: 0.75, scale: 1.3, arriveDelay: 0 },
  bramble: { name: 'Bramble', species: 'beaver', bridge: 'ember', lx: -4.3, lz: -1.6, yaw: -0.25, radius: 0.75, scale: 1.3, arriveDelay: 0.45 },
  quill:   { name: 'Quill',   species: 'bookworm', bridge: 'story', lx: 4.3, lz: -1.6, yaw: 0.2, radius: 0.7, scale: 1.3, arriveDelay: 0, workSound: 'pat' },
};
// Quill the bookworm librarian (Step 48) builds the Storybook Cay bridge from home's WEST beach. He only appears once BOTH other bridges are built (game/npcLogic.js quillPresent) and
// moves to `nook` (world x / z, beside the giant book) once the deck is open. A `workSound` of 'pat' = the soft page-slap of his tiny book.
NPCS.quill.nook = { x: STORY_ISLAND.x + STORY.quill.x, z: STORY_ISLAND.z + STORY.quill.z, yaw: STORY.quill.yaw };
export const NPC_NEAR = 6;
export const BUILDER_ORDER = ['cobble', 'bramble'];   // (Quill is not on the feast count: he needs both bridges built)
export const FUEL_PER_LOG = 180;        // s of burn time one log adds
export const FIRE_MAX_LEVEL = 3;        // level = min(3, ceil(fuel / FUEL_PER_LOG)) -> fuel caps at 3 logs = 540 s

// Terrace heights (tiers)
export const HEIGHT_BEACH = 0.3;
export const HEIGHT_MEADOW = 1.5;
export const HEIGHT_PLATEAU = 3.5;

// ---- Player
export const PLAYER_HITSTUN = 0.28;      // seconds of recoil and input pause after guardian damage

// ---- Combat core (Step 54, Wildroot Hollow only): the dodge-hop, charged attacks, the Bloom meter and the Cancel specials
// Step 58: charms (game/charms.js). The test charm Spark only exists behind ?testcharm / __game.dungeon.debug.giveCharm.
export const CHARM = {
  castRange: 3.5,                      // a pedestal is used from this far (u)
  uiBeat: 2,                           // s between re-sends of the Charm button state to a phone (a missed message heals itself)
  spark: { radius: 2.5, damage: 12, stun: 0.4, cooldown: 4 },
  // Step 59, Frost Nova (the first real charm): a ring burst of `radius` u around the caster that deals a little `damage`, FREEZES every guardian in it for `freeze` s (a boss or mini-boss only
  // `bossFreeze` s, and they are also chilled = slowed for `chill` s) and freezes the Frozen Ford when cast within `water` u of the ford's edge.
  frostNova: { radius: 3.2, damage: 6, freeze: 2.2, bossFreeze: 1.2, chill: 3, water: 3.4, cooldown: 9 },
  // Step 60, Ember Seed (learned in Cinder Tubes): a thrown fireball that arcs `range` u ahead (or onto the nearest guardian in the aim cone) in `flight` s, bursts for `damage` in `radius` u (setting
  // guardians BURNING) and leaves a burning PATCH of `patchRadius` u for `patchFor` s. A burst within `burn` u of a bramble wall burns it away. Cooldown 8 s.
  emberSeed: { range: 6.5, flight: 0.45, radius: 1.8, damage: 12, stun: 0.3, patchRadius: 1.6, patchFor: 4, burn: 2.4, cooldown: 8 },
};
// A combat area's own light (area data `look`): underground there is no sky, so the day / night clock does not reach it. While a local player is inside such an area
// (game/dungeon.js lightArea, run after the clock each tick) the sun / hemisphere / exposure are fixed and the background + fog become the cave's dark colour.
export const AREA_LIGHT = {
  cave: { background: '#1d2638', sun: '#d6e6ff', sunIntensity: 1.7, sunDir: [48, 70, 34], hemiSky: '#bcd4f2', hemiGround: '#55648a', hemiIntensity: 0.95, exposure: 1.0 },
  // Step 60: Cinder Tubes' lava tubes: a fixed warm, dark red-brown light (the lava itself glows through unlit materials, no extra lights)
  lava: { background: '#3a1d16', sun: '#ffc08a', sunIntensity: 2.0, sunDir: [-40, 66, 38], hemiSky: '#f0b48a', hemiGround: '#7a4434', hemiIntensity: 1.15, exposure: 1.15 },   // (playtest 0.60.0: brighter)
};
export const COMBAT = {
  dodge: { dist: 2.6, dash: 0.3, air: 0.48, inv: 0.18, cooldown: 0.35, perfect: 0.15 },   // seconds; dist in u; cooldown counts from landing
  bloom: { max: 3, perHit: 0.12, perfect: 0.5, onHurt: 0, bigHold: 0.4 },                 // pips (0..3); Cancel held bigHold s with all 3 = the big special; onHurt 0: getting hit never drains it (playtest)
  airborneBonus: 0.5,                      // extra damage on a launched (airborne) guardian
  aim: { cone: 35, reachBonus: 1 },        // soft auto-aim: degrees either side of the facing, and extra reach in u
  // Step 55: downed / revive / party scaling. A member at 0 HP is downed (a sprout); a friend holding Interact within `radius` u for `hold` s revives
  // them at `hp` (fraction of max) with `inv` s of invulnerability. With friends alive but no awake enemy within `calm` u of the downed member
  // (and none hunting a living member) they get up alone after `selfDelay` s. `scale.hp` multiplies guardian HP by party size 1..4.
  revive: { radius: 1.6, hold: 1.5, hp: 0.4, inv: 1.5, selfDelay: 20, calm: 10, beat: 0.2, decay: 2, wipeInv: 2 },   // wipeInv: grace after a wipe (a remote friend's pose still shows the old spot for a moment)
  scale: { hp: [1, 1.6, 2.2, 2.8] },
  // Step 56: section objectives (game/objectives.js). `hintDelay` s without progress before the edge arrows appear; a free piece is picked up within `pickup` u,
  // delivered within `deliver` u of the altar; Interact lights a brazier within `light` u.
  objective: { hintDelay: 40, pickup: 1.3, deliver: 2.2, light: 3.2 },
  // Step 57 (the Wildroot rework): the `train` objective opens the bailey's gate once the party has tried tap / charged / special / a hop over the wave dummy (any member),
  // or after `seconds` in the bailey so veterans are never held up. Practice dummies feed the Bloom meter `bloomX` times faster, so a special can be tried at once.
  train: { seconds: 30, bloomX: 2 },
  // Walnut armor (damage x the kind's `armor` until an armorBreak hit cracks it and stuns `crackStun` s; `softStun` = the longest stun a plain hit can cause meanwhile); the
  // cabbage's front shield (hits from within `arc` degrees of its facing do x`mult`, and it turns at `turn` rad/s; a stun, a launch or a piercing move ignores it); the Patchkeeper's second phase (at `at`
  // of max HP: a `stun` s roar, vine adds, the rolling charge).
  armor: { crackStun: 1.5, softStun: 0.12 },
  shield: { arc: 50, mult: 0.25, turn: 1.3 },                       // turn = rad / s the guard swings its shield after its target
  phase2: { at: 0.5, stun: 1.4 },
  // Step 59 (Glimmerfrost Caves): a FROZEN guardian cannot move or act; a charged hit or a special on it SHATTERS it (damage x`shatter`, the freeze ends, ice armor cracks).
  // Ice armor (the Snow Golem's second phase) takes x`iceArmor` damage until shattered / hammer-cracked. Falling icicles: telegraphed `delay` s, then hit a `radius` circle from
  // above (a dodge-hop does NOT clear them, the i-frames do). `chillSlow` = a chilled player's speed factor (the frostcap's cone), `chillFor` s.
  frost: { shatter: 1.8, iceArmor: 0.35, chillSlow: 0.55, chillFor: 3 },
  icicle: { delay: 1.3, radius: 1.4, damage: 12, every: 2.4, max: 3 },
  // Step 59: the slingshot's pebbles (tap), the piercing shot (charged) and the scatter (special) fly `speed` u/s; `snowballRadius` = how close a pebble must pass to pop a thrown snowball.
  sling: { speed: 17, radius: 0.5, snowballRadius: 0.9 },
  // Step 59: the Snowfield's `rescue` objective: an ice block cracks apart after `hits` hits from anything (a tap, a pebble, a charm); the freed friend hops to the exit over `hop` s.
  rescue: { hits: 4, hop: 2.6 },
  // Step 60 (Cinder Tubes). WATERING CAN: the spray cone / jet / rain cloud are in dungeonLogic.js WEAPONS; `water` = the rain cloud's tick (s), its heal per tick (HP), the sapling's heal per tick and how often it
  // re-wets a guardian. BURNING PATCHES (an Ember Seed's burst, the lava slug's trail, the Magma Toad's blobs) set a guardian burning; a member crossing one takes `patch.damage` at most every `patch.every` s.
  // LEDGES: a shove (knock-back) that crosses a cliff drops a guardian to the lower tier: it lands stunned for `ledge.stun` s and takes `ledge.fall` of its max HP.
  // DEFEND: the sapling's attackers deal `defend.hit` x their damage to it every `defend.every` s; the sapling has `defend.hp` HP and the timer starts when a member comes within `defend.start` u.
  // TOAD: its magma shell takes x`toad.shell` damage; cooled to stone (wet + frost) it takes full damage for `toad.stoneFor` s and any armor-breaking / charged / special hit cracks it for good.
  water: { cloudTick: 0.5, cloudHeal: 2, sapHeal: 3, wetTick: 0.6 },
  patch: { damage: 3, every: 1.1, slugTrail: 2.6, slugEvery: 1.3, cap: 24 },
  ledge: { stun: 1.2, fall: 0.12 },
  defend: { hit: 0.6, every: 1.6, hp: 120, start: 11 },
  toad: { shell: 0.3, stoneFor: 8 },
};
// Step 60: REACTIONS between statuses (game/reactions.js). Durations in s. A guardian that is WET and takes frost (or the other way round) is frozen solid (the freeze lasts x`solidFreeze`, the shatter does
// x`solidShatter` instead of COMBAT.frost.shatter); BURNING (`burnDps` per s for `burn` s) meeting frost makes a STEAM burst (`steamDamage` to every guardian within `steamRadius` u, who are then BLINDED for
// `blind` s); wet and burning cancel (douse). A Magma Toad's shell cools to stone with wet + frost.
export const REACTIONS = { wet: 6, burn: 4, burnDps: 6, blind: 1.5, steamRadius: 2.5, steamDamage: 24, solidFreeze: 1.6, solidShatter: 2.2 };
export const PLAYER_SPEED = 7;          // run speed (u/s)
export const PLAYER_WALK_SPEED = 3.5;   // walk speed for gentle analog input
export const PLAYER_ACCEL = 40;
export const PLAYER_DAMPING = 12;
export const PLAYER_RADIUS = 0.45;
export const PLAYER_HEIGHT = 1.6;
export const TURN_SPEED = 12;
export const DEEP_WATER_BLOCK = 0.35;   // cannot walk below WATER_LEVEL - this

// ---- Local multiplayer (Step 11)
export const MAX_PLAYERS = 4;
export const DISCONNECT_GRACE_S = 10;    // a gamepad / phone that drops keeps its player for this long before it poofs away
export const REGROUP_DELAY_S = 3.5;      // a local player off screen this long pops back next to the nearest on-screen teammate
export const REGROUP_DROP_S = 0.5;       // ...and after this long off screen the camera stops framing them (the group stays framed)
export const REGROUP_MARGIN = 0.04;      // NDC slack: a player this close past the screen edge still counts as on screen
export const TETHER_DISTANCE = 34;       // no two players can be further apart than this (u)
export const PLAYER_PUSH_RADIUS = 0.9;   // centre-to-centre distance below which two players soft-push apart (2 x PLAYER_RADIUS)
// hat / cuff / shirt / pants colour the character; `ui` is the saturated accent used by rings, name tags, roster chips
// and the phone controller. P1 keeps the original butter-yellow beanie + coral shirt.
export const PLAYER_COLORS = [
  { name: 'P1', hat: '#ffd85e', cuff: '#ffb347', shirt: '#ff7c6b', pants: '#3f9fbf', ui: '#ffc93c' },   // yellow / coral
  { name: 'P2', hat: '#6cc8ff', cuff: '#3d9be0', shirt: '#7fe6b8', pants: '#4a5db8', ui: '#5fc4ff' },   // sky blue / mint
  { name: 'P3', hat: '#c9a4ff', cuff: '#9a6be0', shirt: '#ff93c6', pants: '#6b5aa8', ui: '#c39bff' },   // lilac / pink
  { name: 'P4', hat: '#a8ec5c', cuff: '#5fbf3a', shirt: '#ff9d42', pants: '#8a5f3c', ui: '#a3e04a' },   // lime / orange
];

// ---- Camera (fixed-angle follow)
export const CAMERA_OFFSET = { x: 0, y: 8.5, z: 13.5 };
export const CAMERA_FOLLOW_LERP = 5;
export const CAMERA_FOV = 40;
export const CAMERA_NEAR = 0.1;
export const CAMERA_FAR = 600;
export const CAMERA_MAX_ZOOM = 2.2;     // multiplier on CAMERA_OFFSET when players are far apart (1 = solo framing)
export const CAMERA_ZOOM_MARGIN = 4.5;  // ground units of breathing room around the outermost players
export const CAMERA_ZOOM_LERP = 2.2;

// ---- Input
export const DEADZONE = 0.15;
export const WALK_THRESHOLD = 0.5;
export const INTERACT_RADIUS = 2.2;
export const REMOTE_STALE_MS = 500;

// ---- Rendering
export const MAX_PIXEL_RATIO = 2;
export const SHADOW_MAP_SIZE = 2048;
export const OUTLINE_THICKNESS = 0.05;

// ---- Networking
export const DEFAULT_PORT = 3000;

// ---- Day/night: game-hour spans and simulation seconds (one full cycle = 630 s).
export const DAY_PHASES = [
  { name: 'dawn', start: 5, end: 7, seconds: 45 },
  { name: 'day', start: 7, end: 18, seconds: 360 },
  { name: 'dusk', start: 18, end: 20, seconds: 45 },
  { name: 'night', start: 20, end: 5, seconds: 180 },
];

// ---- Region visibility (Step 27b). The view centre is where the camera looks at the ground. An island is drawn in full detail while
// its coastline (distance to the view centre minus its radius) is within `enter` u, and keeps it until it is `exit` u away (hysteresis, so
// walking along the boundary never flickers). The island the view is on is always full; every other island shows its cheap far version.
export const REGION_VIEW = { enter: 60, exit: 72, switchMargin: 6 };
export const FAR_TERRAIN_SEGMENTS = 64;   // far version of an island's terrain: ONE mesh, this many cells per side (~3.8 u on a big island)
export const PROP_CHUNK_SIZE = 40;        // big islands: prop layers are split into chunks this wide (u) so frustum culling can skip them

// ---- Storybook page lighting: a page is an illustration, so night stays readable. Inside a page the clock's light is lifted to at least these values and its
// colours are mixed this far toward noon (0 = the island's night, 1 = full day); the sky dome keeps the real time, so it still LOOKS like evening / night.
export const PAGE_LIGHT = { lightMin: 2.0, hemiMin: 1.05, exposureMin: 1.08, colourMix: 0.45 };

// ---- Storybook page platforming (Step 49). Units: 1 tile = 1 u; fixed 60 Hz steps (game/platformerLogic.js). The numbers aim at a cozy SNES feel: the full jump
// rises about 3.7 tiles, a running jump clears about 5-6 tiles of gap, a quick tap still hops about a tile. The page validator derives its reach from these.
export const PLATFORMER = {
  step: 1 / 60, maxSteps: 5,                  // fixed step; at most this many catch-up steps per tick (a long stall just slows the page down)
  half: 0.3, height: 1.4,                     // body box: 0.6 wide, 1.4 tall (feet at its bottom centre)
  walkSpeed: 3.6, runSpeed: 8,                // u/s (stick below WALK_THRESHOLD walks, above it blends to a run)
  accelGround: 58, accelAir: 40, friction: 64, airFriction: 14, turnBoost: 1.7,
  gravity: 46, jumpV: 18.5, jumpCut: 9, maxFall: 24,   // releasing Jump early caps the rise speed at jumpCut
  coyote: 0.1, buffer: 0.12, dropTime: 0.28,  // grace after leaving a ledge, a Jump press remembered before landing, one-way planks ignored after down + Jump
  springV: 26, springVHeld: 30,               // spring flowers (Jump held when landing = the higher one)
  stepUp: 0.6, snapDown: 0.45,                // slope climbing: the body may lift this much per move / stay glued to a slope this far below it
  knockX: 5.5, knockY: 9, stun: 0.28,         // thorn knock-back
  hearts: 3, invuln: 1.2, puff: 1.2, berriesPerHeart: 100,
  collectReach: 4.5,                          // host: how far (u) an actor may be from a berry / letter / campfire / goal it claims (plus latency slack)
  clearHold: 5,                               // the tally card stays this long (s) unless somebody presses Interact / Jump
  // Step 50: Cancel in the air with empty arms = twirl (a short spin that turns the fall into a slow glide, once per airtime); carrying slows the run and the jump;
  // hammer ground pound (down + Interact in the air) and shovel pogo bounce
  twirlTime: 0.35, twirlGlide: 2.6, twirlGravityK: 0.12,
  carryMove: 0.74, carryJump: 0.86,
  poundV: 26, pogoV: 17,
};

// ---- Storybook page tools, grab & throw and the three enemies (Step 50). Units: tiles (1 u) and seconds. Everything the HOST decides (game/pageWorldLogic.js).
export const PAGE_TOOLS = {
  // hitboxes in front of the body: x from the body edge out to `reach`, y from `below` under the feet up to `above` over them; `dur` = swing seconds, impact at `impact` of it
  axe:    { reach: 1.9, below: 0.2, above: 1.9, dur: 0.5, impact: 0.47 },
  hammer: { reach: 1.7, below: 0.2, above: 1.6, dur: 0.62, impact: 0.48 },
  shovel: { reach: 1.6, below: 0.8, above: 1.2, dur: 0.6, impact: 0.58 },
  sword:  { reach: 2.3, below: 0.1, above: 1.9, dur: 0.34, impact: 0.45 },
  hand:   { reach: 1.5, below: 0, above: 2.2 },     // empty-handed: shake a fruit tree
  hits: { block: 2, geode: 2, tree: 3, bramble: 2, soil: 1, spot: 1, crate: 1 },   // hits a gate needs
  combo: 3, comboWindow: 1.1,
  trunk: 8,                                  // a chopped tree falls into a bridge this many tiles long
  geodeStones: 2, geodeBerries: 3, shakeBerries: 6, defeatBerries: 2,
  standReach: 2.2, grabReach: 1.6, hostSlack: 1.6,   // players near a stand / a throwable; the host accepts a request this much further than the client's own reach (latency)
};
export const PAGE_THROW = {
  gravity: 30, fwdV: 11, fwdUp: 5.5, upV: 16, downV: 1.2, restitution: 0.4, friction: 14, maxLife: 40,
  fruitBounce: 0.62, shellV: 11, shellWake: 8, slideLife: 5,
};
export const PAGE_ENEMY = {
  acorn:  { speed: 1.7, w: 0.8, h: 0.8, stun: 4.5 },
  beetle: { speed: 2.4, w: 0.9, h: 0.7 },
  bush:   { w: 1.1, h: 1.1, every: 3.4, near: 13, seedV: 6.5, seedG: 11, seedLife: 4.5 },
  snowball: { speed: 3.2, maxSpeed: 5.4, ramp: 0.55, w: 0.95, h: 0.95, grow: 14 },   // Step 52b: a rolling snowball speeds up while it rolls (u/s per s), turns at walls and ledges; its drawn size grows with the distance rolled (`grow` tiles to full size)
  gravity: 38, stompBounce: 14, shellBounces: 4, patrol: 7,       // patrol = how far (tiles) a walker strays from where it started
};

// ---- Storybook chapters, moving things and Bloom Moments (Step 52a). Units: tiles (1 u) and seconds; the page clock is the host's run clock (game/pageMotion.js).
export const PAGE_MOTION = {
  leafW: 3,                                    // default width (tiles) of a leaf / log platform
  gust: { speed: 2.0, lift: 22, ramp: 0.6, penalty: 2 },   // a gust pushes this fast (u/s, along the page), lifts a twirl (u/s^2) and fades in / out over `ramp` seconds; the validator keeps `penalty` tiles of jump reach spare in a gust zone
  wadeMove: 0.62,                              // walking through tide water: the run is this fraction of its speed (harmless, only slower)
  waterSplash: 0.55,                           // a body deeper than this below a deep channel's surface falls in (a pit with a splash)
  logSamples: 0.2,                             // validator: how often (s) a moving platform's position is sampled
};
export const PAGE_BLOOM = {
  dur: 12, cooldown: 1.5,                      // a Bloom Moment lasts this long and can be started again this long after it ended
  swing: 1.7, swingYaw: 0.95, swingLift: 13,   // the camera swing into 3D at the start: seconds, how far it orbits (rad) and how high it rises (u)
  fade: 1.0,                                   // the page's day -> night look eases in / out over this long
  reach: 1.7, budgetTiles: 46,                 // touching range of the Night-Bloom flower; the validator's budget for a bloom-pad route (tiles of walking)
};
export const CHAPTER_REWARD = { items: { berry: 6, 'berry-jam': 4 } };   // the one-time Meadow bundle for the shared bag (10 items, only ever once: host-saved)
export const CHAPTER_REWARDS = { meadow: CHAPTER_REWARD.items, frostpine: { lingonberry: 5, 'toasted-pine-nuts': 3, 'lingonberry-tart': 2 }, emberleaf: { banana: 4, pineapple: 2, 'grilled-banana': 2, 'pineapple-skewer': 2 } };   // Step 52b: one bundle per chapter (Frostpine's foods, 10 items)

// ---- Frostpine Slopes (Step 52b): snow physics, hazards, the sled run and critter buddies. Units: tiles (1 u) and seconds. Rules: game/platformerLogic.js (ice / drift / sled / buddy abilities),
// game/pageSnowLogic.js (snowballs, slush, icicles, crates, the sled bot), game/pageWorldLogic.js (the host's world). The validator derives its reach from the real step (LIMITS).
export const PAGE_SNOW = {
  ice: { accel: 0.16, friction: 0.07, turn: 0.55, speedK: 1.08 },       // ice tile: ground acceleration / friction / turn-boost scaled by these (long slides); the run speed cap is a touch higher (slightly longer running jumps)
  drift: { moveK: 0.78, cushion: 0.25 },                                // snow drift: the run is this fraction of its speed; a landing's impact speed is scaled by `cushion` (no squash, no thud); the jump itself is unchanged
  freezeS: 8, thawWarnS: 1.6, freezeMaxRun: 10,                         // a thrown snowball turns slush to ice for freezeS seconds (the host times it); the last thawWarnS flicker; a freeze covers at most this many cells of one slush run
  icicle: { sense: 0.95, senseDown: 7, wobble: 0.75, gravity: 30, maxFall: 18, w: 0.36, h: 0.9, stuckS: 9, shatterS: 0.5 },   // passing under it (within sense tiles, up to senseDown below) starts the wobble, then it drops; one that lands in a drift sticks as a plank for stuckS
  sled: { speed: 10.5, jumpK: 0.92, duckH: 0.75, branchW: 0.7, boardW: 1.3 },   // sled: auto-run speed (u/s), Jump hops (jumpK x the jump speed), Down ducks (the hurt box is duckH tall), the branch hurt box, the sled's drawn length
  dash: { time: 0.32, speed: 15, cool: 0.9 },                           // fox: Cancel dashes forward (breaks a snow wall)
  glide: { fall: 2.1, boost: 1.12 },                                    // squirrel: hold Jump in the air to glide (the fall speed is capped at `fall`; the run is a little faster)
  superJump: { k: 1.38 },                                               // rabbit: the jump speed is this much higher
  flutter: { hops: 2, v: 12.5 },                                        // grouse: this many extra mid-air hops (Jump pressed in the air)
  buddyReach: 1.4, buddyBlink: 1.0,                                     // touching a crate (tiles) takes its buddy; a hit sends the buddy hopping away (no heart lost) and the player blinks this long
};

// ---- Emberleaf Canopy (Step 53a): vine swings, coconut cannons, the canoe river, rising lava. Units: tiles (1 u) and seconds, angles in radians (cannon aims in degrees in page data). Rules: game/pageJungleLogic.js.
export const PAGE_JUNGLE = {
  // a vine is a pendulum of length `len` (grabbed anywhere from `minLen` down the rope): the hand is `hand` tiles above the feet, `grab` is how close the hand must be to the rope, `gravity` / `pump` (the stick pushes
  // the swing, rad/s^2) / `damp` shape the swing, `maxAng` caps it, Jump lets go with the swing's speed (`boost`) and a little hop (`up`), `cool` keeps a vine from re-grabbing right away
  vine: { grab: 0.55, hand: 1.15, minLen: 1.8, gravity: 22, pump: 6, damp: 0.08, maxAng: 0.9, cool: 0.45, up: 3.2, boost: 1.04, sub: 2 },
  // a cannon holds a body (`r` is how close its middle must come), the barrel turns on the page clock (spin) or stays put (fixed / auto); Jump fires at `speed` u/s, an auto cannon fires itself `auto` s after loading
  cannon: { r: 0.9, speed: 22, cool: 0.7, auto: 1.3, drop: 2.5 },
  // the canoe: parks at the river's west bank, leaves when somebody boards it and drifts at `speed` u/s to the east bank; `half` = half its length; floating logs hurt a rider below `logH`; a low bough hangs from `branchLow`
  // up to `branchHigh` above the deck (only a ducked rider, `duckH` tall, passes); the host puts the canoe back when nobody is near for `resetS` s
  canoe: { speed: 3.0, half: 1.7, logW: 0.7, logH: 0.45, branchW: 0.7, branchLow: 0.8, branchHigh: 3.2, duckH: 0.75, boardReach: 2.4, resetS: 5, nearX: 7 },
  // rising lava: starts `gap` tiles under a campfire (when it is lit, and again whenever a player is sent back to a campfire) and climbs `rate` tiles/s; the validator wants the climb to be done in under `slack` x the head start
  lava: { rate: 0.5, gap: 8, slack: 0.5, margin: 0.2 },
};
// The Volcano Spirit (the Emberleaf boss page): a lava blob on a stone ring. idle -> lob (globs with ground shadows) -> sink -> cooled (a window to hit it) -> rise ... Each hit costs it 1 of `hp`.
export const PAGE_BOSS = {
  hp: 3, wake: 15, w: 3.0, hHot: 2.3, hCool: 1.5, mouth: 1.9,
  idle: 1.7, idleParty: 0.15, idleMin: 1.0, lobGap: 0.62, flight: 1.7, splash: 1.25, spread: 2.5, globsBase: 2, globsMax: 4, perHit: 1,
  sink: 0.9, cooled: 8.5, hurt: 1.3, rise: 1.1, hitReach: 3.6, coconutR: 0.45, stompBounce: 15,
};

// ---- Storybook multiplayer pages (Step 51). Units: tiles (1 u) and seconds. Rules in game/pageCoopLogic.js (pure) + game/pageCoop.js (runtime).
export const PAGE_MP = {
  // the shared camera window: the host fits every player (min / max half width in tiles at the safe 16:9 shape), broadcasts it `camRate` times a second and every screen
  // zooms so that AT LEAST that window is visible (taller screens zoom out, wider ones show a bit more page)
  camRate: 15, minHalf: 9.5, margin: 5, vMargin: 2.6, ratio: 16 / 9, maxZoom: 3,
  holdInset: 1.0,                              // a player cannot run past the window edge minus this (soft wall, outward only)
  lostDelay: 2.5, lostOutside: 0.4, lostVertical: 3,   // outside the window this long (the farthest player only) = a lost puff (no heart lost)
  // dandelion puffs drift to the nearest living friend and pop when touched; alone (or all puffed) the Step 49 respawn rule applies
  puffSpeed: 7.5, puffMaxS: 14, puffMinJump: 0.5, popRadius: 1.25, popRadiusY: 1.7, popReach: 2.6, popSlack: 1.6, popBlink: 1.2,
  // friends' heads: a landing faster than headBounceMin bounces (Jump held: a bigger boost), slower stands; a rider glues to the head within the slack
  headHalf: 0.34, headH: 1.3, headBounceMin: 9, headBounce: 8, headBoost: 17, rideSlack: 0.4, rideDrop: 0.55, rideLift: 0.9,
  // friend toss (Cancel next to a grounded friend lifts, Cancel again throws; Jump wriggles free)
  liftReach: 1.5, liftSlack: 1.6, liftH: 1.5, tossV: 22, tossVx: 7.5, tossUpV: 24.5, tossUpVx: 1.5, tossLock: 0.6, tossFree: 0.15, wriggleHop: 9, carryFriendMove: 0.7,
  // latency tolerance: the host remembers each enemy's recent positions and accepts a stomp that was in reach at any of them; a replica hurts only after a persistent side contact
  stompHistory: 0.3, stompSlack: 0.6, hurtSteps: 2, hurtGrace: 0.3, extrapolate: 0.25,
};

// ---- Step 68 (Skipper Marlo's boat): hop courses (game/hopLogic.js), Marlo (world/marlo.js) and the `boat` domain (world/boat.js, game/boatLogic.js).
// HOP_COURSE: `hopSpeed` / `gravity` are the numbers player.js's hop() has always used (apex 0.65 u, airtime 0.47 s); `step` = the highest ledge you walk up. `limits` are what the validator allows
// (rise per hop, edge-to-edge gap, pad radius / width); `margin` = the validator bot's slack (takeoff = how far inside the rim it jumps, land = inside the landing rim, speed = the share of run speed it may use);
// `assists` = the landing magnet (u toward the pad centre), the next-pad glint; `splash` = a fall into water / lava: `delay` s of sinking, then the pop back at the last checkpoint (`fade` s). `beat` is 68c's.
export const HOP_COURSE = {
  hopSpeed: 5.6, gravity: 24, step: 0.3,
  limits: { rise: 0.5, gap: 2.4, padR: 0.9, padW: 1.4 },
  margin: { takeoff: 0.35, land: 0.2, speed: 0.97 },
  assists: { magnet: 0.35, shadow: true, glint: true },
  splash: { delay: 0.45, fade: 0.4, sink: 0.45 },
  wetDamping: 0.35,
  crustGlow: 0.25,                             // emissive warmth without a light or shader patch
  glideFallSpeed: 2.2,                         // held sail slows the descent, never the climb
  beat: { window: 0.14, period: 0.8, hits: 4, standing: 0.18, evidenceAge: 2, duck: 0.35 },
  catchDepth: 1.2,                             // Step 68e: a landing more than this far below the last checkpoint pad (a fall off a high pad) pops the player back onto it, gently
};
// Boat course sizing and shared-clock motions (Step 68b; 68e: sail / compass are a camera-facing switchback of 3 runs x 4 big, low pads instead of a 24-pad spiral).
// Switchback numbers (island-local offsets from the course anchor, z grows toward the follow camera): `rows` = the z of each run (never behind the anchor), `pitch` = centre spacing inside a run,
// `padR` / `turnR` = pad / landing radius, `steps` = pads - 1 (a checkpoint every 4th pad plus the one before the goal), `sway` / `period` = the optional swaying bypass stones.
export const BOAT_COURSES = {
  sail: { steps: 11, rise: 0.3, padR: 1.5, turnR: 1.7, pitch: 3.4, rows: [6.6, 3.1, -0.4], sway: 0.4, period: 12 },
  rudder: { radius: 5.8, rocks: 8, period: 14, warn: 2, down: 1.45 },
  compass: { steps: 11, rise: 0.3, padR: 1.5, turnR: 1.7, pitch: 3.4, rows: [6.6, 3.1, -0.4] },
};
// Skipper Marlo, the sea otter at Emberleaf's cove (world/marlo.js; the cove itself is world/islands/emberCove.js).
export const MARLO = { name: 'Marlo', radius: 0.8, scale: 1.45, nearR: 6.5, yaw: 0, talkRadius: 1.1 };
// The boat quest: `reach` = coarse request range; atBoatGoal additionally checks goal feet-height and 2.2 u reach; `unlockText` the feast banner line.
// Star-chart and voyage tunables (68d); the clock's locked hour uses the same night gate.
export const BOAT_SIGHTS = { night: [19.5, 5.5], anchors: [12, 146, 282], angles: [0.65, -0.9, 1.7],
  hold: 1, rollTolerance: 0.12, lookTolerance: 0.09, turnSpeed: 1.4, cameraSpread: 0.13, cameraLift: 8 };
export const BOAT_VOYAGE = { preStart: 500, push: 2, turn: 8, moor: 14, end: 16, distance: 85, sailFill: 1, turnS: 1.5, moorEase: 2, swing: 1 };
// Step 71: the crossing to Duskcrown (and back). Seconds from the host-timed start: board 0-3, leave the cove 3-9, open sea 9-12, the isle rises 12-17, arrive 17-20. dock = how near the dock the asker stands (host check).
export const SAIL = { preStart: 500, board: 3, leave: 9, sea: 12, rise: 17, end: 20, dock: 8, lead: 0.12, approach: { ember: 70, duskcrown: 130 }, bannerAt: 17.4, gulls: 2 };
export const BOAT = { reach: 6, unlockText: 'A foghorn echoes from the far shore...', biscuitFlight: 2.6 };

// Repair clocks are seconds on sync.hostNow(); tar route is 24.52 u around the colliders (real Player: 3.81 s); cooling allows 1.6x that time.
export const BOAT_REPAIR = {
  reach: 1.5, leakReach: 2.8, tar: { coolS: 6.1 },
  float: { duration: 45, line: 1, rise: 0.018, first: 4, last: 39, partyScale: [6, 9, 12, 15], seed: 6803 },
  deck: { top: 0.65, bob: 0.045, period: 5, tilt: 0.025 },
};

// Duskcrown's local canopy look; the saved day clock still runs normally elsewhere.
export const DUSK_LIGHT = {
  mix: 0.92, top: '#1b2550', horizon: '#343b70', fog: '#344568',
  fogNear: 32, fogFar: 155, hemiSky: '#9bace0', hemiGround: '#304e65',
  hemiIntensity: 0.82, light: '#99b7ed', lightIntensity: 0.48,
  direction: [48, 70, 34], shadowIntensity: 0.22, shadowRadius: 3,
  glow: 0.96, breathe: 0.04, breatheRate: 0.24,
  spores: 240, sporeOpacity: 0.48, sporeDensity: 0.30, sporeBox: [42, 12, 36],
  palette: ['#6fcfe6', '#9b6cf0', '#ffd98a'],
  lidHeight: 48, lidClear: 1.0, lidCell: 3, lidMargin: 8, lidWave: 0.55, lidSpeed: 0.035,
};

// The Crownlands' sunlit grade (Step 85b), blended in by the crown weight `cw` (fx/atmosphere.js) on top of the ordinary day/night clock; the marsh dusk mix is cut by (1 - cw) so up top the clock shows.
// Tints scale with daylight (1 - nightness) so sunsets and night keep their own palettes; the fog is lighter and farther everywhere, so the plains feel open. Subtle on purpose.
export const CROWN_LIGHT = {
  sun: '#ffe9b8', sunMix: 0.35, sunBoost: 1.06, hemiBoost: 1.05,           // slightly warmer, higher-key sun / sky light
  horizon: '#d8ccff', horizonMix: 0.30, fogTint: '#e4dcfb', fogMix: 0.22,   // clear sky with a faint lavender horizon (the alien hint)
  fogNearScale: 1.35, fogFarScale: 1.4,                                      // lighter, farther fog
};

// Step 85c: the Crownlands' elevated water, falls and floating islands (world/islands/crownWater.js, crownSky.js, crownVisuals.js).
export const CROWN_WATER = {
  shallow: '#4fd8e8', deep: '#2a8fd0', glint: '#f2ffff',        // the plateau's still water: brighter and clearer than the marsh's
  lift: 0.012, chunk: 96, shoreSlack: 1.8,                       // the surface sits this far over the planned height (no coplanar overlap); the chunk size; how far past a river's width the shore is searched
  fall: { color: '#f4fbff', mist: '#d2e8ff', width: [0.6, 1.4], tail: 12, mist3: [[2.6, 0.18], [1.7, 0.55], [1.0, 0.9]], sea: 0.9 },   // sky / sea falls: full width range (u), the bottom fade length, the foot mist discs (radius, lift), the sea falls' width
  sky: { hull: 0.3, vines: 7, sectors: 22, farSectors: 8, rockSectors: 10 },                  // floating islands: outline thickness, vine strands per big island, ring sectors (full / far / small rocks)
};

// Step 85d: the Crownlands' alien acacias and baobabs (world/islands/crownPlacement.js, crownTreeAssets.js, crownTreeVisuals.js). Colours are the spec's family table: canopy / tuft top + rim, trunk.
// Canopy family index (instance attribute): 0 magenta, 1 teal, 2 violet, 3 tangerine. Bark index: 0..3 = the acacia trunk of the same family, 4 = baobab dusty rose, 5 = baobab lavender.
export const CROWN_TREES = {
  chunk: 80, outline: 0.085, fadeRate: 4, fadeMargin: 0.7,                    // chunk size (u) of the instanced layers; hull thickness; canopy fade (shares duskFade.js rules)
  families: [{ name: 'magenta', top: '#ff5fa8', rim: '#ffb3d9' }, { name: 'teal', top: '#36d6c3', rim: '#a8f5e6' }, { name: 'violet', top: '#9a6cff', rim: '#d4bfff' }, { name: 'tangerine', top: '#ffa23b', rim: '#ffe08a' }],
  barks: ['#c7b8e8', '#6f84c8', '#efe3cf', '#7a5aa8', '#e3a3a0', '#a99ad6'],  // lilac-grey, slate blue, bone, dusky violet (acacia, by family), dusty rose, lavender (baobab)
  plainsMix: [0.23, 0.19, 0.29, 0.29], riverMix: [0.16, 0.36, 0.36, 0.12],     // family weights on the plains / along the rivers (about 45 % of acacias end up magenta or teal)
  sway: { amp: 0.05, speed: 0.9 }, speckle: { cell: 0.34, density: 0.2, strength: 0.9 },   // gentle canopy sway (world units at the canopy); night speckles: cell size (u), share of rim cells that glow, emissive strength
};

// Marsh-only music transitions and offline tail; older tracks keep their original buses and impulse.
export const DUSK_MUSIC = { regionFade: 3, reverbSeconds: 5.2, renderTail: 8 };

// Duskcrown's giant / titan mushrooms (Step 69c): canopy fade (a cap over a local player or between the camera and one dithers out; rate 4 -> 0.25 s), the warm glow pools and the shared look.
// Duskcrown's gentler camera (Step 69c follow-up): blended in by the region weight (fx/atmosphere.js duskWeight): lower, further back, aimed a little above the feet so giant caps come into frame.
export const DUSK_CAMERA = { offset: { x: 0, y: 7.0, z: 15.5 }, aim: 2.3 };
export const DUSK_FLORA = { fadeRate: 4, fadeMargin: 0.7, fadeMax: 1.0, nearCull: 90, outline: 0.07, poolOpacity: 0.3, poolLift: 0.08, poolRings: 5, poolSegs: 18,
  chunk: 80, glow: { stem: 0.4, spot: 0.55, bulb: 0.85, mini: 0.8 }, colors: { capDeep: '#454a98', capLight: '#7a7fd2', stem: '#a4a6dc', stemDark: '#7d7fbe', stemLight: '#c4c6ee', rim: '#9c3a2a', gill: '#3c3c80', gillLight: '#55529a', bulbDark: '#e8562a', bulbLight: '#ffb347', bulbCore: '#fff0b0', warm: '#ff7a3d', warmHot: '#ffb347', under: '#ff9a4a', violet: '#b87bff', pool: '#f4801f' } };

// Ambient marsh counts / footprints and water look (69d). Footprints bound every clump at maximum scale.
export const DUSK_SMALL = { chunk: 80, lilyLift: 0.055, lagoonLilies: 34,
  counts: { mushroom: 135, bulb: 100, stump: 14, log: 12, rock: 24, grass: 300, flower: 190, moss: 110, reed: 210, lily: 220, shelf: 100 },
  footprints: { mushroom: 0.9, bulb: 0.6, stump: 0.9, log: 2.0, rock: 1.25, grass: 0.65, flower: 0.5, moss: 0.9, reed: 0.65, lily: 0.85, shelf: 1.5 },
  colors: { teal: '#127a78', green: '#6fcf8a', violet: '#a64be8', cyan: '#66e5f2', pale: '#ddd5ef', bark: '#a4a0bb', cut: '#d8bdbb', ring: '#82768e', rock: '#586198', moss: '#287f82', orange: '#f08a3c', cream: '#ffd98a' } };
export const DUSK_WATER = { shallow: '#4a5d8f', deep: '#303b6a', glint: '#7ca2cf', mist: '#7994b8', fallWidth: 0.55, reflectionRadius: 0.8, reflectionOpacity: 0.08 };

// ---- Fishing in the Glowcap Marsh (Step 72a). Times in seconds of the host's game clock unless noted; rules in game/fishingLogic.js, domain in game/fishing.js.
export const FISHING = {
  spots: 6,                                  // active fish spots (glowing ripple rings) on Duskcrown's ponds
  life: [60, 120], gap: [5, 15],             // a spot lives this long, then waits this long before it appears at another pond
  deepFrac: 1 / 3, chanceS: 0.4,             // 'chance' (orange) spots: the lagoon and the deepest third of the ponds, within this fraction of the pond radius
  commonS: 0.6,                              // common spots lie within this fraction of a pond's radius (the deep bowl)
  chanceOdds: 0.5,                           // a spot at a deep pond (or the lagoon) is a 'chance' spot with this probability
  rareChance: 0.2,                           // a chance spot holds a Lanternkoi with this probability, else a Glimmerfin
  castMin: 3, castMax: 5, snap: 3, inside: 0.9,    // the bobber flies this far (u), snaps onto a spot within `snap`, and stays inside this fraction of the pond's radius (the water's edge is at about 0.95)
  nibbles: [0, 3], nibbleFrom: 0.9, nibbleGap: [0.7, 1.4],   // 0..3 nibbles, the first this many s after the cast, then this far apart (and before the bite)
  bite: [2, 8], biteGap: 0.9,                // the first bite comes 2..8 s after the cast (at least `biteGap` after the last nibble)
  windows: { glimmerfin: [0.6], lanternkoi: [0.4, 0.35, 0.3] }, fightGap: [0.9, 1.5],   // press windows per bite; a Lanternkoi fights back with two more shorter bites
  slack: 0.2,                                // the host forgives this much on a press (latency, the angler's frame time)
  emptyWait: 4,                              // an empty cast reels itself in after this long ("Not even a nibble...")
  timeout: 5,                                // the host drops a cast this long after its last bite window if no reel arrives
  reach: 4.5,                                // the host accepts a REMOTE angler this far from the pond's edge (the prompt range + latency slack)
  seed: 7202,                                // host rng seed for the spot schedule
};

// Step 73a (pets): tunables for the companion that follows its owner (game/petLogic.js is the pure maths, world/pets.js the runtime). Lengths in units, times in seconds.
export const PET = {
  glideMin: 0.9, glideMax: 1.4,              // hover height above the ground (eased between the two by a slow bob)
  waterGlide: 0.55,                          // over water the pet skims lower, above the surface (WATER_LEVEL)
  heelBack: 1.15, heelSide: 0.95,            // the heel point: this far behind the owner and to the owner's left (mirrored by slot parity)
  settleBack: 0.5, settleSide: 0.85,         // beside the owner while a cinematic / feast holds everyone (the pet settles low and quiet)
  spring: 13, damping: 0.92,                 // follow spring stiffness (1 / s^2) and damping ratio (1 = critical)
  maxSpeed: 7.5,                             // the cruise speed limit (the owner runs at PLAYER_SPEED)
  catchUp: 5.5,                              // beyond this distance to the heel the pet swoops (stiffer spring, higher speed, a dip)
  catchSpeed: 15,                            // the swoop's speed limit
  sailSpeed: 4,                              // speed-limit multiplier while the boat crosses (the crew moves at ~40 u/s there): the pet keeps pace instead of poofing
  lost: 24,                                  // beyond this it poofs to the heel (regroup, travel, boat arrival, teleport)
  bankGain: 0.14, bankMax: 0.55,             // roll into turns: yaw rate -> radians, and the limit
  pitchGain: 0.09, pitchMax: 0.4,            // nose up / down with the vertical speed
  turnRate: 7,                               // how fast the heading follows the velocity (1 / s)
  idleAfter: 1.6,                            // the owner must stand still this long before an idle starts
  idleGap: [4.5, 9],                         // seconds between idles (random in the range)
  idleLen: { roll: 1.1, loop: 2.8, nuzzle: 1.6, head: 4.2, hide: 3.4 },
  loopRadius: 1.5, hideRange: 16,            // the loop's orbit radius around the owner; how far the nearest giant mushroom may be to hide under it
  sleepyNight: 0.6,                          // nightness above which the pet is sleepy away from Duskcrown (slower, lower)
  sleepyScale: 0.7,                          // sleepy speed and glide-height factor
  appear: 0.45, nearLimit: 48,               // scale-in time after a poof; a remote owner's pet is only drawn within this distance (avatars cull at the same range)
  glowDay: 0.5, glowNight: 1.15,             // the shared pet material's emissive multiplier by day and at night
};

// Step 73b ("The Little Lantern", Capray's quest line on Duskcrown + the pet stable): tunables for game/caprayLogic.js (pure rules), game/capray.js (the host domain) and world/caprayWorld.js. Lengths in units, times in seconds.
export const CAPRAY = {
  sight: 6,                                  // walking within this of the home pond makes the shy ray dart away (and sets stage 1)
  fedNeed: 3,                                // Glimmerfin offerings that earn its trust (stage 2 -> 3)
  feedReach: 4.5, remoteSlack: 2.5,          // an offering is made from this far outside the pond's edge; the host accepts a REMOTE actor this much further (latency slack)
  hits: 4,                                   // axe / sword hits that clear one shade moss (host-counted, never reset: no fail state, no timer)
  hitReach: 2.6, hitSlack: 1.6,              // a hit swing reaches this far from the stem's surface; remote slack
  shakeReach: 6,                             // a shake is accepted while the ray's LEADER stands within this of the titan's stem
  shakeActorReach: 3.2,                      // ... and the one shaking within this of the stem's surface (remote slack = hitSlack)
  pity: 0.12, rareCap: 0.8,                  // stage 4: every Glimmerfin caught adds `pity` to the Lanternkoi chance at chance spots (FISHING.rareChance), up to `rareCap` in total
  scene: { preStart: 500, end: 6.4 },        // the befriend cinematic: host ms before it starts, seconds it lasts (skippable)
  glow: { shy: 0.55, sad: 0.32, perSpore: 0.2, full: 1 },     // the wild ray's glow multiplier: shy by the pond, dim when the titans are dark, +1 step per shower, full when favourite
  dim: 0.85, dimEase: 1.4,                   // a smothered titan's cap glow drops by this fraction; seconds the glow takes to fade back (and to dim when the moss grows in)
  home: { from: 22, to: 75, want: 40 },      // the home pond lies this far from the hearth (want = the preferred distance), never the pond nearest to it
  pondR: [4.5, 8.5],                         // the home pond's radius range ("mid-size")
};

// ---- Step 80a: Party Games (PLAN "Steps 80-84"). Short 4-player minigames in a themed pocket far west of every island (the Party Glade): game/party/*.js (pure rules), game/party.js (the screen runtime), world/party/*.js (the
// look). `origin` = the lobby centre (x, z) at height y; every stage sits at its own offset inside the pocket (game/party/partyArea.js: the walkable shapes; a test pins that the whole pocket is clear of every island,
// the page lane and the combat areas). Lengths in u, times in s. `bots[difficulty]`: `react` = the least time between a bot noticing something and acting, `noise` = timing / aim scatter (s), `miss` = the chance it skips
// a needed action, `ready` = [min, max] s a bot takes to hold Ready in the how-to. `rounds` = the party-mode length. `kiosk.exitHold` = Cancel + Interact held on the keyboard this long leaves the party.
export const PARTY = {
  origin: { x: -2400, z: 0, y: 4 },
  stageOffset: { vineskip: { x: 90, z: 0 }, timber: { x: 180, z: 0 }, marlosays: { x: 270, z: 0 }, huddle: { x: 360, z: 0 }, sizzle: { x: 450, z: 0 }, eggs: { x: 540, z: 0 }, feastround: { x: 630, z: 0 }, bumpers: { x: 720, z: 0 }, glowcap: { x: 810, z: 0 }, cast: { x: 900, z: 0 }, tilty: { x: 990, z: 0 }, bonk: { x: 1080, z: 0 } },       // 80d-e add their stages further east (+90 each)
  lobby: { r: 14.5, camera: { x: 0, y: 15.5, z: 17.5, focusZ: -3.2 }, board: { x: -8.6, z: -4.6 }, podium: { x: 8.6, z: -5.2 }, stage: { x: 0, z: -9 },
    dress: { hats: { x: 7.4, z: 0.6 }, tails: { x: 10.6, z: 1.6 }, garlands: { x: 9.4, z: 4.4 } } },     // the dress-up corner between games: try on any unlocked hat / tail / garland
  flow: { lobbyFirst: 12, lobby: 12, pickWait: 18, roulette: 3, howtoMin: 3.5, howtoMax: 15, howtoBots: 6, practice: 10, countdown: 3, results: 7, readyHold: 0.45, partyOver: 8 },
  modes: ['random', 'party', 'pick'], rounds: 6, defaultMode: 'random', stars: 1,
  difficulties: ['easy', 'normal', 'hard'], defaultDifficulty: 'easy',
  bots: {
    easy:   { react: 0.50, noise: 0.19, miss: 0.25, ready: [2.5, 7], walk: 0.5, fool: 0.5, shell: { lead: 0.55, after: 0.6 }, reel: 2.2 },
    normal: { react: 0.33, noise: 0.09, miss: 0.06, ready: [1.5, 5], walk: 0.8, fool: 0.2, shell: { lead: 0.38, after: 0.3 }, reel: 4.2 },
    hard:   { react: 0.20, noise: 0.045, miss: 0.015, ready: [1, 3.5], walk: 1, fool: 0.05, shell: { lead: 0.27, after: 0.12 }, reel: 7.5 },
  },
  kiosk: { exitHold: 3 },
  // ---- Step 80e: a bonus star per game for its feat; the trophy ceremony after the last round of a party; the kiosk's attract mode (`?party&kiosk`, or `?attract`)
  bonusStars: 1,
  ceremony: { length: 18, rise: 1.3, confetti: 1.5, skipArm: 0.8 },        // seconds of the cut on the lobby podium (host-timed); the trophy rises at `rise`; a confetti burst every `confetti` s; the skip hint arms after `skipArm` s
  attract: { idle: 120, duck: 0.5, touch: 1 },                              // seconds without any human input before the bots play on their own; the music's level meanwhile; how often (s) a joined screen tells the host somebody is playing
  slack: 0.35,                                  // the host accepts a REMOTE press stamped this much (s) in its past (latency); anything older is clamped
  tick: 0.2,                                    // the host's clock beat for replicas (s)
  vineskip: {
    rMin: 2.1, rMax: 6.7, rimMin: 8.2, rimMax: 10.4, rim: 9.3,                   // the walkable terrace (an annulus round the glowing planter) and the rim players cheer from
    reach: 0.46,                                // the vine's half width at a player's feet (u)
    hopSpeed: 8.2,                              // the take-off speed of a hop on this stage (normal 5.6): airtime 2v/g = 0.68 s, apex 1.4 u, so the jump is easy to see and to time
    airFrom: 0.05, airTo: 0.62, cool: 0.72,     // a jump keeps the feet clear of the vine from `at + airFrom` to `at + airTo`; a second jump waits `cool` s (just past the landing)
    speeds: [1.6, 2.1, 2.6, 3.1, 3.7, 4.3], step: 10,   // rad/s of the vine, a faster one every `step` s
    surprises: [31, 41, 51], pause: 0.9, warn: 1.3,     // Mokuring's tricks from 30 s: [times] (the seed shifts them a little); a pause lasts `pause` s; the telegraph starts `warn` s before
    cap: 60, tail: 1.2, lag: 0.2,               // the game ends at `cap` s with everybody still up as winners; the host judges contact `lag` s late so a remote jump stamped just before it still counts
    hostPost: 7.7,                              // radius the two hosts stand at, on opposite sides
  },
  timber: {
    lanes: [-7.5, -2.5, 2.5, 7.5], standDX: 2.0, markZ: 0, chuteZ: -9.5, endZ: 8.5, spectatorZ: 11.5,   // lane x (stage-local), where a player stands (lane x + standDX), the mark, the chute, the far end
    logs: 7, first: 1.6, gap: 0.55, durs: [3.4, 3.15, 2.9, 2.7, 2.5, 2.3, 2.1], wobbles: [0, 0, 0.1, 0.14, 0.17, 0.21, 0.24],
    logLen: 2.0, stripes: [0.25, 1 / 3, 0.5, 2 / 3, 0.75],    // each wave's red stripe sits this far along the log from its FRONT end (the five shuffled per game, then two more); the log is judged when ITS stripe meets the line
    win: 0.55, perfect: 0.045, kinds: ['pine', 'birch', 'palm', 'breadfruit'],
    cap: 40, tail: 1.6, lag: 0.3,               // a chop may arrive up to `lag` s after its log left the window (latency)
  },
  // ---- Step 80b: Marlo Says (red / green signal flags on tide-pool posts) and Pinecone Huddle (curl into a shell when the cones fall). Stage-local lengths in u, times in s.
  marlosays: {
    posts: [-6, -2, 2, 6], postZ: 1.0, postR: 1.35, beachZ: 9.6, marloZ: -8.0,      // the four stepping posts (x), their z / radius, the beach row the dry-out players cheer from, Marlo's rock
    first: 2.2, dur0: 2.0, durMin: 0.85, durDecay: 0.955,                           // the first flag goes up at `first`; a flag stays up `dur` s (the copy window), shrinking from dur0 to durMin
    gap0: 0.95, gapMin: 0.42, gapDecay: 0.965,                                      // the pause between flags, shrinking too (the beats speed up)
    cap: 75, lieFrom: 40, biscuitShare: 0.6, biscuitLie: 0.7,                       // everybody still dry at `cap` wins; from `lieFrom` Biscuit's squawk (60% of the calls) lies 70% of the time: only the raised flag counts
    botMiss: 0.3,                                                                   // a bot forgets a call / picks the wrong flag with skill.miss x this (the timing and the lying squawk beat it far more often)
    tempoTo: 1.75, tail: 1.8, lag: 0.3,                                             // the music runs 1 .. tempoTo as the beats shorten; a late press may arrive `lag` s after its window
  },
  huddle: {
    stumps: [-6.6, -2.2, 2.2, 6.6], stumpZ: 0.5, stumpR: 1.3, spectatorZ: 9.0,
    drops: 12, first: 3.5, gapMin: 2.6, gapMax: 6.2, span: 52, jitter: 0.9,         // 12 drops per player from `first`: the SAME 11 gaps (scaled to add up to `span`) for every player in a different order, plus a start jitter (fair, but not in step)
    warn: 1.3, close: 0, parry: 0.3, lag: 0.3,                                      // a shadow grows and a whistle sounds `warn` s before a drop lands; the shell protects `close` s after the press (0 = at once, like a parry) and a quick tap still protects (and costs) at least `parry` s; a late release may arrive `lag` s after
    meter: 9.5, cap: 60, tail: 1.8, tie: 0.25,                                      // seconds of shell per player (never refills); survivors at `cap` win, ranked by shell left (within `tie` s = a tie)
    botMiss: 0.3,
  },
  // ---- Step 80c: Sizzle Seed (run round the campfire, bump a friend to pass the sizzling seed) and Egg Scramble (run in your lane, stack eggs on your head). Stage-local lengths in u, times in s.
  sizzle: {
    arenaR: 9.2, spawnR: 6.9, spectatorZ: 11.6, fireR: 1.35,                       // the walkable clearing round the fire, where the players start, the cheering spots, the fire pit
    benches: { r: 5.1, half: 1.7, cr: 0.55, angles: [0, 90, 180, 270] },            // four log benches round the fire (obstacles): radius, half length, collider radius of each of the three circles that make one
    touchR: 1.5, lock: 0.6, cool: 0.35,                                             // a touch is two players this close (u); the new holder cannot pass BACK for `lock` s (and until the two have parted); nobody passes again within `cool` s
    first: 2.0, fuse: [10, 20], pause: 6.0, rounds: 2,                              // Dub hands the seed out at `first`; the HOST draws the pop time from `fuse` (never sent); after a pop `pause` s, then the next seed; `rounds` pops (a 2-player party has one)
    heatFull: 17, boost: 1.16, pace: 0.65,                                                      // the seed's glow / sparkle ramp reaches full after `heatFull` s of ANY fuse (it never follows the real timer); the holder runs `boost` x faster
    cap: 75, tail: 2.2, botMiss: 0.5,
  },
  // Step 80d: shared flume geometry and host-simulated puffballs. All distances stage-local, time in seconds.
  // walkR + PLAYER_RADIUS stays inside the 4.98 u bamboo rim; reach / frontDot judge real bodies, never a seat index.
  feastround: { duration: 54, radius: 5.8, spawnR: 4.0, walkR: 4.5, reach: 2.15, frontDot: 0.1, speed: 0.48, gap: 2.7, life: 10, pepperTime: 4, tail: 2 },
  bumpers: { duration: 60, shrinkAt: 30, shrinkPower: 3, radius: 9, minRadius: 2, ballR: 1, spawnR: 4.5, accel: 10, drag: 0.8, maxSpeed: 9, mass: 1, hop: 0.5, tail: 2, spectator: { x: 0, z: 8, r: 3, y: -8.2, landingR: 2.05, drift: 3.5, propR: 0.85 } },
  eggs: {
    lanes: [-9, -3, 3, 9], laneHalf: 2.7, laneZ: 2.0, laneDepth: 1.5, spectatorZ: 8.4,   // lane centres (x), how far a player may run each way, the lane's z and walkable depth, the cheering spots
    perchY: 7.4, headTop: 1.75, eggH: 0.34,                                         // where an egg starts to fall, the top of a head (feet at 0), the height one stacked egg adds
    items: 36, first: 1.6, gap: [1.4, 0.9], speed: [4.0, 5.8], coneShare: 0.17, goldShare: 0.1, step: [1.4, 4.2],   // 36 drops: gaps shrink, the fall quickens; x moves by `step` u from one drop to the next (inside the lane)
    catchR: 0.8, bankAt: 8, goldValue: 3, lobLead: 0.55,                            // an egg lands on a head when its x is this close; at `bankAt` stacked eggs the stack flies into the henhouse (banked); Shyam's cone is lobbed `lobLead` s before it falls
    cap: 52, tail: 1.8, botMiss: 0.5, pace: 0.35,
  },
  // ---- Step 81a: Glowcap Shuffle (stand on the called glowing cap when the others sink) and Driftwood Cast (cast from a jetty berth, mash to reel). Stage-local lengths in u, times in s. `reel` in the bot skills = presses per second.
  glowcap: {
    capR: 2.2, overlap: 0.5, rows: [3, 2, 3], spawnCaps: [0, 2, 5, 7],                // eight caps in three hex rows (they overlap by `overlap` so a walker crosses from one to the next); the four corner caps the players start on
    rounds: 10, first: 1.8, hops: [2, 2, 2, 2, 2, 1, 1, 1, 1, 1], beat: [0.9, 0.24], gap: [2.6, 1.4], sink: [2.0, 1.6], ramp: 7,   // 10 rounds (the beat, the pause and the sunk time reach their fastest at round `ramp`); a call lasts three beats (3-2-1) before the other caps sink; the beat and the pause between rounds shrink; the sunk caps stay down `sink` s
    sinkT: 0.3, riseT: 0.45, dead: [0, 0, 0, 1, 1, 2, 2, 3, 3, 4],                   // the sink / rise animation lengths; how many caps stay sunk for good at the start of each round (from round 4)
    shore: { x: 7.2, z0: 9.2, z1: 12.0 }, spectatorZ: 10.6, waterY: -0.12,           // the spectator shore (x half width, z range) a dry-out player walks on, the lagoon's surface
    tail: 2.4, botMiss: 0.4, pace: 0.3,
  },
  cast: {
    lanes: [-9, -3, 3, 9], laneHalf: 2.7, berthZ: 5.4, berthR: 1.5, edgeZ: 3.7, benchZ: 9.0,   // lane centres (x), the half width of a water lane, the berth pads on the jetty, the jetty's edge where the water starts, the spare players' bench
    depthMin: 2.2, depthMax: 8.6, period: 3.0, rows: [3.2, 4.8, 6.4, 8.0],         // the aim marker sweeps between these distances from the jetty edge; floating finds drift along one of four depth rows
    items: 24, first: 1.0, gap: [2.0, 1.7], speed: [1.0, 1.3],                       // 24 finds, one every ~1.85 s, each drifting across the lane at 1.0-1.3 u/s
    hookR: 1.6, flight: 0.3, waitMiss: 2.5, waitCatch: 0.35, firstCast: 0.8,                        // the hook finds a find within this distance of where it lands (the finds are drawn about that big); the line goes out by itself (first at `firstCast`) and a PRESS strikes (the hook takes `flight` s); a strike that hooks nothing leaves the line `waitMiss` s, then it rests again and you can strike again; `waitCatch` s after a catch
    need: { driftwood: 5, glimmerfin: 8, bottle: 9, lanternkoi: 12, shell: 16, boot: 6 },   // presses to reel a find in (heavier = more)
    pts: { driftwood: 1, glimmerfin: 2, bottle: 3, lanternkoi: 5, shell: 10, boot: 0 },
    counts: { driftwood: 7, glimmerfin: 5, bottle: 3, lanternkoi: 2, shell: 2, boot: 5 },
    cap: 50, tail: 2.2, botMiss: 0.6, botNoise: 3.7,                                   // (a bot's strike timing error = skill.noise x botNoise s)
  },
  // ---- Step 81b: Tilty Tiles (run on your own tipping picture frame, the coconut knocks the tiles off) and Bonk Burrows (dodge Cobble's giant squeaky mallet). Stage-local lengths in u, angles in rad, times in s.
  tilty: {
    frames: [{ x: -6.6, z: -5.35 }, { x: 6.6, z: -5.35 }, { x: -6.6, z: 5.35 }, { x: 6.6, z: 5.35 }],      // the four frame centres (seat k uses frame k), a 2 x 2 layout in one fixed shot
    hx: 5.2, hz: 4.25, rim: 0.45, pivotY: 1.3, cols: 5, rows: 4, tile: 1.9,                                 // outer half extents (x, z), the raised wooden rim, the pivot height above the lawn, the 5 x 4 tile grid (tile = side; the grid fills the inside exactly)
    maxTilt: 0.21, turnRate: 0.3, reach: 0.85, ease: 3,                                                     // a tip of about 12 degrees at most; the board turns at most turnRate rad/s; full tilt needs 85% of the way to the edge
    gravity: 8, rollK: 5 / 7, damp: 0.8, friction: 0.01, rimE: 0.55, obstacleE: 0.6, maxSpeed: 12, ballR: 0.55,   // the coconut's physics (gravity is scaled up so a 12 degree slope still rolls briskly)
    spawn: { x: 0, z: 2.8 }, ball: { x: 0, z: 0 }, walkPad: 0.35,                                           // where a player starts on its frame, where the coconut starts, how far inside the rim a player may walk
    duration: 30, tail: 1.8, benchZ: 11.4, benchR: 1.0, botMiss: 0.5,
  },
  bonk: {
    meadowR: 10, patches: [{ x: -9.6, z: 9.6 }, { x: 9.6, z: 9.6 }], patchR: 2.0, spawnR: 5.2,                // the round meadow, the two little spectator islets across the stream, the ring the players start on
    hills: [{ x: -6.2, z: -2.8, r: 0.95 }, { x: 5.2, z: -5.2, r: 0.9 }, { x: 6.4, z: 3.0, r: 1.0 }, { x: -2.6, z: 7.2, r: 0.9 }, { x: 0.2, z: -0.8, r: 0.85 }, { x: -7.2, z: 1.8, r: 0.8 }],     // the molehills (they block walking)
    hitR: 2.5, core: 0.55, hopSpeed: 7.2, airFrom: 0.06, airTo: 0.5, cool: 0.55, lag: 0.2,                   // a slam's circle; inside `core` x hitR you are always squashed, a hop at the landing saves you only in the outer ring; the hop's air window; a second hop waits `cool` s
    first: 2.6, warn: [1.5, 0.7], fall: 0.4, keep: 0.8, duration: 60, tail: 2, botMiss: 0.5,                // the first shadow, a shadow grows for `warn` s (shorter later), the mallet falls in the last `fall` s and rests `keep` s
  },
};
