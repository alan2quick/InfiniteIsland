// The work-in-progress pet models of PLAN Step 74a: the home island's caterpillar / cocoon / butterfly ("carle", npc/petsHome.js) and Frostpine's wolf ("snowsong", npc/petsFrost.js).
// They are NOT in the pet registry (npc/pets.js `PETS`, game/petLogic.js `PET_IDS` stay ['capray']): no stable entry, pose packet, save or sync. The only way to see them is the debug
// viewer `__game.petLab` (world/petLab.js). Step 74b / 74c move them into the registry once their quest lines exist.
//
//   PET_MODELS_WIP        { 'carle:caterpillar': build, 'carle:cocoon': build, 'carle:butterfly': build, snowsong: build }
//   WIP_KEYS              the keys, in lineup order (caterpillar, cocoon, butterfly, wolf)
//   WIP_ANIMS             { key: [the animation names its update() understands] }; the first is the default
//   createWipPetModel(key) -> the model (shape documented in petsHome.js / petsFrost.js: root, rig, mesh(es), drawCalls, length, height, update(dt, t, { anim, speed }), dispose(), pivots)
import { buildCaterpillar, buildCocoon, buildButterfly } from './petsHome.js';
import { buildWolf } from './petsFrost.js';

export const PET_MODELS_WIP = {
  'carle:caterpillar': buildCaterpillar,
  'carle:cocoon': buildCocoon,
  'carle:butterfly': buildButterfly,
  snowsong: buildWolf,
};
export const WIP_KEYS = Object.keys(PET_MODELS_WIP);
export const WIP_ANIMS = {
  'carle:caterpillar': ['idle', 'crawl', 'walk', 'nibble'],
  'carle:cocoon': ['idle', 'wiggle', 'hatch'],
  'carle:butterfly': ['glide', 'idle', 'flap', 'rest'],
  snowsong: ['idle', 'trot', 'walk', 'sit', 'wag', 'howl', 'tilt'],
};

export function createWipPetModel(key) {
  const build = PET_MODELS_WIP[key];
  if (!build) throw new Error(`unknown work-in-progress pet "${key}"`);
  return build();
}
