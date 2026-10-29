// Step 86d: the pure side of Homesteading's palette: which kinds are listed on which tab and whether each one can be placed right now (the bag and the budget), with the sentence that
// greys it out. No DOM, no three.js: Node-tested (test/homesteadPlace.test.js). game/homesteadPlace.js turns these rows into the dialog menu.
//
//   TABS                                   ['gathering', 'decorations']
//   tabOf(kind)                            'gathering' (the main budget) | 'decorations' (the deco budget)
//   listedKinds(tab, { islands? })         the kinds shown on a tab, in HOMESTEAD.kinds order. Home kinds are listed from the unlock (decision 13); `islands` (default ['home']) is where 86e adds the other
//                                          islands as they are unlocked. Kinds whose asset is not built yet (`todo`) are never listed. Once listed a kind stays listed (decision 15): the list only ever grows.
//   paletteRows({ tab, bag, usage, layerFull?, islands? })   [{ kind, label, weight, budget, cost: [{ id, name, need, have }], free, reason, line }]   reason = the validatePlace rejection ('budget' | 'cost' | 'layer-full') or null,
//                                          line = "Needs 5 Apples" / "Needs 3 free spots: remove something first" / ...
//   iconOf(kind)                           the inline-SVG icon of a kind (the signature item's icon, or a small flower / lily / reed drawing)
import { HOMESTEAD } from '../config.js';
import { kindCapped, kindCapLine } from './homesteadLogic.js';
import { getItem, itemName } from './catalog.js';
import { svg } from '../ui/icons.js';

export const TABS = ['gathering', 'decorations'];
export const tabOf = (kind) => (HOMESTEAD.kinds[kind] && HOMESTEAD.kinds[kind].budget === 'deco' ? 'decorations' : 'gathering');
export const TAB_LABELS = { gathering: 'Gathering', decorations: 'Decorations' };

export function listedKinds(tab, { islands = ['home'] } = {}) {
  const want = tab === 'decorations' ? 'deco' : 'main';
  return Object.entries(HOMESTEAD.kinds).filter(([, m]) => m.budget === want && !m.todo && islands.includes(m.island)).map(([k]) => k);
}

/** "Needs 5 Apples" / "Needs 5 Apples and 4 Logs" (only what is missing). */
export function costLine(missing) {
  const bits = missing.map((c) => `${c.need - c.have} ${itemName(c.id, c.need - c.have)}`);
  return `Needs ${bits.length > 1 ? `${bits.slice(0, -1).join(', ')} and ${bits[bits.length - 1]}` : bits[0]}`;
}

export function paletteRows({ tab, bag, usage, layerFull = () => false, islands = ['home'] }) {
  const standing = Object.entries(usage.counts || {}).filter(([k, n]) => n > 0 && HOMESTEAD.kinds[k] && HOMESTEAD.kinds[k].island !== 'home').map(([k]) => k);   // Step 86e: the foreign kinds standing now (the kind cap)
  const inUse = standing.filter((k) => HOMESTEAD.kinds[k].budget === (tab === 'decorations' ? 'deco' : 'main'));                                              // Step 86f: one cap per budget
  return listedKinds(tab, { islands }).map((kind) => {
    const m = HOMESTEAD.kinds[kind];
    const cost = Object.entries(m.cost).map(([id, need]) => ({ id, name: itemName(id, need), need, have: Number(bag(id)) || 0 }));
    const free = usage[m.budget].free;
    let reason = null, line = null;
    if (free < m.weight) {
      reason = 'budget';
      const have = Math.max(0, free);
      line = m.budget === 'deco'
        ? `The decoration list is full (${usage.deco.used} / ${usage.deco.budget}): dig something up first`
        : `Needs ${m.weight} free spot${m.weight === 1 ? '' : 's'}, you have ${have}: remove something first`;
    } else if (kindCapped(kind, inUse)) {
      reason = 'kind-cap';
      line = kindCapLine(m.budget);
    } else if (cost.some((c) => c.have < c.need)) {
      reason = 'cost';
      line = costLine(cost.filter((c) => c.have < c.need));
    } else if (layerFull(kind)) {
      reason = 'layer-full';
      line = 'No room for more of these';
    }
    return { kind, label: m.label, weight: m.weight, budget: m.budget, cost, free: !reason, reason, line };
  });
}

// ---------------------------------------------------------------------------------------------- icons
const O = '#2b2340';
const flowerIcon = (hex) => svg(`<g stroke="${O}" stroke-width="1.4"><circle cx="12" cy="6.2" r="3.6" fill="${hex}"/><circle cx="17.8" cy="10.4" r="3.6" fill="${hex}"/><circle cx="15.6" cy="17" r="3.6" fill="${hex}"/><circle cx="8.4" cy="17" r="3.6" fill="${hex}"/><circle cx="6.2" cy="10.4" r="3.6" fill="${hex}"/><circle cx="12" cy="12" r="3.2" fill="#ffd93b"/></g>`);
export const LILY_ICON = svg(`<ellipse cx="12" cy="14" rx="9" ry="5.6" fill="#7fd0ff" stroke="${O}" stroke-width="1.6"/><path d="M12 13.5 19.4 10.3A7.6 4.6 0 1 0 12 13.5z" fill="#5fd07a" stroke="${O}" stroke-width="1.6" stroke-linejoin="round"/><circle cx="9" cy="12.2" r="1.7" fill="#ffb3d1" stroke="${O}" stroke-width="1"/>`);
export const REED_ICON = svg(`<path d="M7 21C6 14 7 8 8.4 3M12 21c0-7 .4-12 .2-17M17 21c1-6 1.2-10-.4-15" fill="none" stroke="${O}" stroke-width="4" stroke-linecap="round"/><path d="M7 21C6 14 7 8 8.4 3M12 21c0-7 .4-12 .2-17M17 21c1-6 1.2-10-.4-15" fill="none" stroke="#6fd36a" stroke-width="2" stroke-linecap="round"/><rect x="10.8" y="3" width="2.8" height="6.4" rx="1.4" fill="#8a5a3a" stroke="${O}" stroke-width="1.2"/>`);
export const BUSH_ICON = svg(`<path d="M3 19c-.6-5 2-8.4 5.6-8.4.6-3 3-5 6-4.4 3 .6 4.8 3.2 4.6 6.6 2 .6 3 2.6 2.6 6.2z" fill="#58c96b" stroke="${O}" stroke-width="2" stroke-linejoin="round"/><path d="M9 15c1-1.2 2-1.4 3.2-1M14 17c1-1 2-1.2 3-.8" stroke="${O}" stroke-width="1.4" stroke-linecap="round" fill="none"/>`);
export const DIG_ICON = svg(`<ellipse cx="12" cy="16" rx="9" ry="4.6" fill="#8a5a3a" stroke="${O}" stroke-width="2"/><ellipse cx="12" cy="14.6" rx="6.4" ry="2.8" fill="#b07a4e"/><path d="M9 6 12 12M15 5l-2 7" stroke="${O}" stroke-width="1.8" stroke-linecap="round"/>`);
const FLOWER_ICON_COLORS = { flowerPink: '#ff6f91', flowerWhite: '#fff6ee', flowerPurple: '#b494ff', flowerBlue: '#7fc4ff' };
const SIGNATURE = {
  appleTree: 'apple', cherryTree: 'peach', palm: 'coconut', rock: 'stone', berryBush: 'berry', herb: 'herb', mushroom: 'mushroom',
  // Step 86e: the other islands' kinds show their signature item
  sprucePine: 'pinecone', birch: 'birch-log', lingonBush: 'lingonberry', mint: 'mint', chanterelle: 'chanterelle', snowDigSpot: 'snow-truffle', graniteRock: 'crystal',
  bananaTree: 'banana', breadfruitTree: 'breadfruit', jungleTree: 'log', bamboo: 'bamboo', pineapple: 'pineapple', basaltRock: 'obsidian', taroDigSpot: 'taro', glowcapClump: 'glowcap-crumbs',
};
const DECO_ICON_COLORS = { edelweiss: '#ffffff', gentian: '#5a74ff', heatherTuft: '#d99ad8', hibiscus: '#ff7083', plumeria: '#fff0da', marshFlower: '#e8dcff' };
const SNOWMAN_ICON = (hex) => svg(`<circle cx="12" cy="17" r="5.6" fill="#f4f8ff" stroke="${O}" stroke-width="1.8"/><circle cx="12" cy="8.6" r="4" fill="#ffffff" stroke="${O}" stroke-width="1.8"/><path d="M8.6 12.4h6.8" stroke="${hex}" stroke-width="2.6" stroke-linecap="round"/><circle cx="10.8" cy="8" r=".7" fill="${O}"/><circle cx="13.2" cy="8" r=".7" fill="${O}"/>`);
const SNOWMAN_COLORS = { snowmanRed: '#e8505b', snowmanBlue: '#4f8cff', snowmanGreen: '#3fb36a' };
const SPIRE_ICON = svg(`<path d="M5 20 9 6l3 9 2-11 5 16z" fill="#cdeefb" stroke="${O}" stroke-width="1.8" stroke-linejoin="round"/>`);
const TIKI_ICON = svg(`<rect x="7" y="3" width="10" height="18" rx="3" fill="#b4804f" stroke="${O}" stroke-width="1.8"/><circle cx="10" cy="9" r="1.4" fill="#ffe7af"/><circle cx="14" cy="9" r="1.4" fill="#ffe7af"/><path d="M9.6 15h4.8" stroke="${O}" stroke-width="2" stroke-linecap="round"/>`);
const FERN_ICON = svg(`<path d="M12 21V6M12 18l-5-3M12 14 6.6 10.6M12 18l5-3M12 14l5.4-3.4M12 10 8.4 7.4M12 10l3.6-2.6" fill="none" stroke="${O}" stroke-width="3.4" stroke-linecap="round"/><path d="M12 21V6M12 18l-5-3M12 14 6.6 10.6M12 18l5-3M12 14l5.4-3.4M12 10 8.4 7.4M12 10l3.6-2.6" fill="none" stroke="#45b86b" stroke-width="1.8" stroke-linecap="round"/>`);
const SHROOM_ICON = (hex) => svg(`<path d="M3.6 13a8.4 7.4 0 0 1 16.8 0z" fill="${hex}" stroke="${O}" stroke-width="1.8" stroke-linejoin="round"/><rect x="9.6" y="13" width="4.8" height="7" rx="1.6" fill="#f3eadb" stroke="${O}" stroke-width="1.6"/>`);
const MOSS_ICON = svg(`<ellipse cx="12" cy="16" rx="9" ry="4.6" fill="#5fae8f" stroke="${O}" stroke-width="1.8"/><ellipse cx="9" cy="14.6" rx="3.6" ry="1.6" fill="#8fd0a8"/>`);

export function iconOf(kind) {
  if (FLOWER_ICON_COLORS[kind]) return flowerIcon(FLOWER_ICON_COLORS[kind]);
  if (kind === 'lilyPad') return LILY_ICON;
  if (kind === 'reed') return REED_ICON;
  if (kind === 'plainBush') return BUSH_ICON;
  if (kind === 'digSpot') return DIG_ICON;
  if (DECO_ICON_COLORS[kind]) return flowerIcon(DECO_ICON_COLORS[kind]);
  if (SNOWMAN_COLORS[kind]) return SNOWMAN_ICON(SNOWMAN_COLORS[kind]);
  if (kind === 'iceSpire') return SPIRE_ICON;
  if (kind === 'tikiTorch') return TIKI_ICON;
  if (kind === 'fern') return FERN_ICON;
  if (kind === 'glowShroom') return SHROOM_ICON('#a77bff');
  if (kind === 'glowBulb') return SHROOM_ICON('#5fe8e0');
  if (kind === 'mossMound') return MOSS_ICON;
  const id = SIGNATURE[kind];
  const it = id && getItem(id);
  return it ? it.icon : BUSH_ICON;
}
