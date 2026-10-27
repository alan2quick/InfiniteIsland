// Item catalogue: every ingredient (and, from Step 14, every dish) the player can carry.
//
//   { id, name, plural?, icon (inline SVG string, 24x24 viewBox, scales with 1em), color (hex accent), kind: 'ingredient' | 'dish', islands }
//   islands (Step 29b): where the item comes from / can be made, a subset of ['home', 'frost', 'ember'] (the island ids of config.js ISLANDS). Every entry has one
//     (home items ['home']; log + stone ['home','frost','ember']; coconut ['home','ember']; Frostpine finds ['frost']; dishes: the island whose campfire cooks them, see RECIPES[].island).
//     Step 31's per-island inventory tracking reads it; nothing in the game filters by it yet.
//
//   getItem(id)                 -> definition or null
//   itemName(id, n = 1)         -> 'Apple' / 'Apples' ('Log' / 'Logs') for toasts and floating text
//   listItems(kind?)            -> definitions in display order (the inventory bar keeps this order)
//   registerItem(def)           -> add / replace an entry (also makes `hud.toast(..., { icon: id })` work)
//
// Adding a dish (Step 14): put it in the DISHES section below (and a recipe in RECIPES), e.g.
//   dish('baked-potato', { name: 'Baked Potato', color: '#e8b56b', icon: svg(`...`) })
// It is picked up automatically by the inventory, the inventory bar (icon + count chip) and floating "+1 Baked Potato" text;
// pickups.js only needs a 3D model for things that lie on the ground (dishes never do).
import { svg, OUTLINE as O, ICONS, BERRY_SVG } from '../ui/icons.js';

const ITEMS = new Map();

export function registerItem(def) {
  const d = { plural: null, kind: 'ingredient', islands: ['home'], ...def };
  ITEMS.set(d.id, d);
  ICONS[d.id] = d.icon;       // toasts can show item icons by id: hud.toast('Made ...', { icon: 'baked-potato' })
  return d;
}

export const getItem = (id) => ITEMS.get(id) || null;
export const listItems = (kind = null) => [...ITEMS.values()].filter((d) => !kind || d.kind === kind);
export function itemName(id, n = 1) {
  const d = ITEMS.get(id);
  if (!d) return String(id);
  return n === 1 ? d.name : (d.plural || `${d.name}s`);
}

const ingredient = (id, o) => registerItem({ id, kind: 'ingredient', ...o });
const dish = (id, o) => registerItem({ id, kind: 'dish', ...o });

// ---------------------------------------------------------------------------------------------
// INGREDIENTS
// ---------------------------------------------------------------------------------------------
ingredient('log', {
  name: 'Log', color: '#c98a54', islands: ['home', 'frost', 'ember'],
  icon: svg(`
    <rect x="2.6" y="8" width="15.4" height="10" rx="2.4" fill="#c98a54" stroke="${O}" stroke-width="2"/>
    <path d="M6 11.2h7M6.4 14.8h5" stroke="#8f5b34" stroke-width="1.5" stroke-linecap="round"/>
    <ellipse cx="17.6" cy="13" rx="3.6" ry="5.2" fill="#f5d39a" stroke="${O}" stroke-width="2"/>
    <ellipse cx="17.6" cy="13" rx="1.5" ry="2.4" fill="none" stroke="#c98d5a" stroke-width="1.5"/>`),
});

// ---- Frostpine's logs (Step 35a): chopped from Frostpine's spruces / pines (pine-log) and birches (birch-log). Both burn as campfire fuel at any fire and are the camp jobs' building wood.
ingredient('pine-log', {
  name: 'Pine Log', color: '#6b4a2e', islands: ['frost'],
  icon: svg(`
    <rect x="2.6" y="9" width="15.4" height="10" rx="2.4" fill="#6b4a2e" stroke="${O}" stroke-width="2"/>
    <path d="M6 12.2h7M6.4 15.8h5" stroke="#4a301b" stroke-width="1.5" stroke-linecap="round"/>
    <ellipse cx="17.6" cy="14" rx="3.6" ry="5.2" fill="#e8c27a" stroke="${O}" stroke-width="2"/>
    <ellipse cx="17.6" cy="14" rx="1.5" ry="2.4" fill="none" stroke="#b98a4a" stroke-width="1.5"/>
    <path d="M7.6 9c-1.2-2.4-.4-4.6 1.2-6 .2 2 1.4 3 1.6 6zM11.6 9c-.4-2.6.8-4.4 2.6-5.4.2 2 .8 3.4.6 5.4zM4.6 9c.2-1.8 1.2-3.2 2.6-3.8 0 1.4.2 2.4.2 3.8z" fill="#3f9150" stroke="${O}" stroke-width="1.3" stroke-linejoin="round"/>`),
});

ingredient('birch-log', {
  name: 'Birch Log', color: '#ece6d8', islands: ['frost'],
  icon: svg(`
    <rect x="2.6" y="8" width="15.4" height="10" rx="2.4" fill="#f4efe4" stroke="${O}" stroke-width="2"/>
    <path d="M6.2 10.4h3.4M12 11.6h3.2M5.4 14.8h2.6M10.4 15.6h4.4" stroke="#3a3340" stroke-width="1.7" stroke-linecap="round"/>
    <ellipse cx="17.6" cy="13" rx="3.6" ry="5.2" fill="#f2dcae" stroke="${O}" stroke-width="2"/>
    <ellipse cx="17.6" cy="13" rx="1.5" ry="2.4" fill="none" stroke="#c9a46a" stroke-width="1.5"/>`),
});

ingredient('breadfruit-log', {
  name: 'Breadfruit Log', color: '#b58d53', islands: ['ember'],
  icon: svg(`<rect x="3" y="8" width="15" height="10" rx="2" fill="#b58d53" stroke="${O}" stroke-width="2"/><path d="M6 12h6M7 15h5" stroke="#765a32" stroke-width="1.5"/><ellipse cx="18" cy="13" rx="3.5" ry="5" fill="#f5dcaa" stroke="${O}" stroke-width="2"/><ellipse cx="18" cy="13" rx="1.5" ry="2.5" fill="none" stroke="#b58d53"/><path d="M7 8C3 3 9 1 12 4C14 8 10 9 7 8Z" fill="#6ead46" stroke="${O}" stroke-width="1.5"/>`),
});

ingredient('stone', {
  name: 'Stone', color: '#a9a5c4', islands: ['home', 'frost', 'ember'],
  icon: svg(`
    <path d="M2.8 18.4c-.4-3.6 1.6-6.4 5-6.8 3.2-.4 5.6 1.6 5.6 4.8 0 2.6-1.8 4-4.6 4.2-3.4.2-5.8-.4-6-2.2z" fill="#a9a5c4" stroke="${O}" stroke-width="2" stroke-linejoin="round"/>
    <path d="M10.4 11.2C9.6 7 12.4 3.8 16 3.8c3.6 0 5.8 2.8 5.2 6.4-.5 3-2.6 4.6-5.6 4.6-3 0-4.8-1.6-5.2-3.6z" fill="#c9c5df" stroke="${O}" stroke-width="2" stroke-linejoin="round"/>
    <path d="M14.2 6.4c1.2-.8 3-.8 4 .2" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round" opacity=".8"/>
    <path d="M5.2 14.6c.8-.5 1.8-.6 2.6-.2" fill="none" stroke="#e4e1f2" stroke-width="1.4" stroke-linecap="round" opacity=".9"/>
    <path d="M7 19.2l1.4-1.6M16.6 13l.4-2" fill="none" stroke="#7d789c" stroke-width="1.3" stroke-linecap="round"/>`),
});

ingredient('apple', {
  name: 'Apple', color: '#ff5468',
  icon: svg(`
    <path d="M12 7.2c-2.2-1.6-7-1.2-7.6 4.2-.5 4.6 2.4 9.4 5.4 9.4 1 0 1.5-.5 2.2-.5s1.2.5 2.2.5c3 0 5.9-4.8 5.4-9.4-.6-5.4-5.4-5.8-7.6-4.2z"
          fill="#ff5468" stroke="${O}" stroke-width="2" stroke-linejoin="round"/>
    <path d="M12 7.4c.1-1.8.8-3 2-3.8" fill="none" stroke="${O}" stroke-width="2" stroke-linecap="round"/>
    <ellipse cx="16" cy="4.6" rx="3" ry="1.6" transform="rotate(-25 16 4.6)" fill="#5fd07a" stroke="${O}" stroke-width="1.3"/>
    <ellipse cx="8.4" cy="12.2" rx="1.2" ry="2" transform="rotate(20 8.4 12.2)" fill="#fff" opacity=".8"/>`),
});

ingredient('peach', {
  name: 'Peach', plural: 'Peaches', color: '#ffb08a',
  icon: svg(`
    <circle cx="12" cy="13.6" r="7.6" fill="#ffb08a" stroke="${O}" stroke-width="2"/>
    <path d="M12.4 6.6c3.8.8 6.4 3.4 6.4 7.2 0 3.6-2.8 6.6-6.4 6.8 2.2-2.2 2.6-4.8 2.4-7.2-.1-2.4-.9-5.2-2.4-6.8z" fill="#ff8a8f" opacity=".75"/>
    <path d="M12 6.6c-1.2 3.4-1.2 8 .3 13.8" fill="none" stroke="#e0806a" stroke-width="1.5" stroke-linecap="round"/>
    <path d="M12 6.4c0-1.6.6-2.6 1.6-3.2" fill="none" stroke="${O}" stroke-width="2" stroke-linecap="round"/>
    <ellipse cx="9.4" cy="4.6" rx="3.1" ry="1.6" transform="rotate(-155 9.4 4.6)" fill="#5fd07a" stroke="${O}" stroke-width="1.3"/>
    <ellipse cx="8" cy="12.6" rx="1.2" ry="2" transform="rotate(20 8 12.6)" fill="#fff" opacity=".7"/>`),
});

ingredient('coconut', {
  name: 'Coconut', color: '#8a5a3a', islands: ['home', 'ember', 'duskcrown'],
  icon: svg(`
    <circle cx="12" cy="12.6" r="8" fill="#8a5a3a" stroke="${O}" stroke-width="2"/>
    <path d="M6.4 9.2c1.2-2.2 3.2-3.4 5.2-3.6" fill="none" stroke="#b98a5f" stroke-width="1.8" stroke-linecap="round"/>
    <circle cx="9.6" cy="11" r="1.4" fill="#3d2413"/><circle cx="14.4" cy="11" r="1.4" fill="#3d2413"/>
    <circle cx="12" cy="14.6" r="1.4" fill="#3d2413"/>`),
});

ingredient('berry', {
  name: 'Berry', plural: 'Berries', color: '#ff4d6d',
  icon: BERRY_SVG,
});

ingredient('herb', {
  name: 'Herb', color: '#2fc99a',
  icon: svg(`
    <path d="M12 21.6V9.4" fill="none" stroke="${O}" stroke-width="3.6" stroke-linecap="round"/>
    <path d="M12 21.4V9.4" fill="none" stroke="#2a9e7a" stroke-width="1.5" stroke-linecap="round"/>
    <ellipse cx="7" cy="16.4" rx="4" ry="2.3" transform="rotate(-28 7 16.4)" fill="#4fdcae" stroke="${O}" stroke-width="1.7"/>
    <ellipse cx="17" cy="16.4" rx="4" ry="2.3" transform="rotate(28 17 16.4)" fill="#4fdcae" stroke="${O}" stroke-width="1.7"/>
    <ellipse cx="7.2" cy="11" rx="4.2" ry="2.5" transform="rotate(-38 7.2 11)" fill="#2fc99a" stroke="${O}" stroke-width="1.7"/>
    <ellipse cx="16.8" cy="11" rx="4.2" ry="2.5" transform="rotate(38 16.8 11)" fill="#2fc99a" stroke="${O}" stroke-width="1.7"/>
    <ellipse cx="12" cy="5.6" rx="2.9" ry="3.8" fill="#79edc4" stroke="${O}" stroke-width="1.7"/>`),
});

ingredient('potato', {
  name: 'Potato', plural: 'Potatoes', color: '#d9a86e',
  icon: svg(`
    <path d="M3.8 13.4c-.5-4.2 3.4-7.8 8.4-7.8 5.4 0 8.6 3.4 7.6 8.4-.9 4.8-5 6.8-9.4 6.4-4.2-.4-6.4-3-6.6-7z"
          fill="#d9a86e" stroke="${O}" stroke-width="2" stroke-linejoin="round"/>
    <circle cx="8.8" cy="11.4" r="1.1" fill="#a8743f"/><circle cx="14.6" cy="9.8" r=".95" fill="#a8743f"/>
    <circle cx="15.4" cy="15" r="1.15" fill="#a8743f"/><circle cx="9.6" cy="16" r=".95" fill="#a8743f"/>
    <path d="M6.6 9.4c1-1.4 2.4-2.2 4-2.4" fill="none" stroke="#f3d3a0" stroke-width="1.6" stroke-linecap="round"/>`),
});

ingredient('mushroom', {
  name: 'Mushroom', color: '#ff5560',
  icon: svg(`
    <path d="M9.2 13h5.6l.8 6.6c0 1.2-1.4 2-3.6 2s-3.6-.8-3.6-2z" fill="#fff1d6" stroke="${O}" stroke-width="2" stroke-linejoin="round"/>
    <path d="M2.8 13.2C3 7 7 3.2 12 3.2s9 3.8 9.2 10c0 .8-.6 1.2-1.4 1.2H4.2c-.8 0-1.4-.4-1.4-1.2z"
          fill="#ff5560" stroke="${O}" stroke-width="2" stroke-linejoin="round"/>
    <circle cx="8" cy="9.4" r="1.7" fill="#fff"/><circle cx="13.6" cy="7" r="1.5" fill="#fff"/><circle cx="16.8" cy="11" r="1.2" fill="#fff"/>`),
});

// ---- Frostpine Isle ingredients (Step 29b): `islands: ['frost']`, gathered on the snowy island
ingredient('pinecone', {
  name: 'Pinecone', color: '#a8703f', islands: ['frost'],
  icon: svg(`
    <path d="M12 5.4V2.4" fill="none" stroke="${O}" stroke-width="3" stroke-linecap="round"/>
    <path d="M12 21.6c-3.8 0-6.2-3.2-6.2-7.4 0-3.6 2.6-7.4 6.2-9.6 3.6 2.2 6.2 6 6.2 9.6 0 4.2-2.4 7.4-6.2 7.4z" fill="#a8703f" stroke="${O}" stroke-width="2" stroke-linejoin="round"/>
    <path d="M6.6 11.2c1.8 1.4 3.6 1.4 5.4 0 1.8 1.4 3.6 1.4 5.4 0M6.2 15.2c1.9 1.5 3.8 1.5 5.8 0 2 1.5 3.9 1.5 5.8 0M8 19c1.4 1 2.6 1 4 0 1.4 1 2.6 1 4 0" fill="none" stroke="#6e4424" stroke-width="1.5" stroke-linecap="round"/>
    <path d="M9.4 8.4c.8-.8 1.8-1.4 2.6-1.6" fill="none" stroke="#d9a066" stroke-width="1.6" stroke-linecap="round"/>
    <ellipse cx="14.6" cy="3.4" rx="3" ry="1.4" transform="rotate(-20 14.6 3.4)" fill="#3f9150" stroke="${O}" stroke-width="1.2"/>`),
});

ingredient('lingonberry', {
  name: 'Lingonberry', plural: 'Lingonberries', color: '#e0243f', islands: ['frost'],
  icon: svg(`
    <path d="M12 10.2V4.6" fill="none" stroke="${O}" stroke-width="2.6" stroke-linecap="round"/>
    <ellipse cx="7.6" cy="4.6" rx="3.6" ry="1.8" transform="rotate(-20 7.6 4.6)" fill="#3f9150" stroke="${O}" stroke-width="1.4"/>
    <ellipse cx="16.6" cy="4.4" rx="3.6" ry="1.8" transform="rotate(25 16.6 4.4)" fill="#58b567" stroke="${O}" stroke-width="1.4"/>
    <circle cx="12" cy="11" r="4.2" fill="#e0243f" stroke="${O}" stroke-width="2"/>
    <circle cx="7.4" cy="16.6" r="4.2" fill="#ee3b52" stroke="${O}" stroke-width="2"/>
    <circle cx="16.8" cy="16.6" r="4.2" fill="#e0243f" stroke="${O}" stroke-width="2"/>
    <circle cx="10.6" cy="9.6" r="1.1" fill="#fff" opacity=".85"/><circle cx="6" cy="15.2" r="1.1" fill="#fff" opacity=".85"/><circle cx="15.4" cy="15.2" r="1.1" fill="#fff" opacity=".85"/>`),
});

ingredient('mint', {
  name: 'Mint', color: '#4fe8b4', islands: ['frost'],
  icon: svg(`
    <path d="M12 22V6.4" fill="none" stroke="${O}" stroke-width="3.6" stroke-linecap="round"/>
    <path d="M12 21.6V7" fill="none" stroke="#25b58a" stroke-width="1.5" stroke-linecap="round"/>
    <path d="M12 18.4C8.6 19 4.8 17 3.2 13.2c3.6-.8 7 .2 8.8 5.2z" fill="#5ff2b8" stroke="${O}" stroke-width="1.7" stroke-linejoin="round"/>
    <path d="M12 18.4c3.4.6 7.2-1.4 8.8-5.2-3.6-.8-7 .2-8.8 5.2z" fill="#4fe8b4" stroke="${O}" stroke-width="1.7" stroke-linejoin="round"/>
    <path d="M12 12.6C9 13 5.8 11.2 4.6 7.8c3.2-.6 6.2.4 7.4 4.8z" fill="#7bf7cc" stroke="${O}" stroke-width="1.7" stroke-linejoin="round"/>
    <path d="M12 12.6c3 .4 6.2-1.4 7.4-4.8-3.2-.6-6.2.4-7.4 4.8z" fill="#5ff2b8" stroke="${O}" stroke-width="1.7" stroke-linejoin="round"/>
    <path d="M12 7.6C10.2 6.2 10.4 3.4 12 2c1.6 1.4 1.8 4.2 0 5.6z" fill="#a4ffe0" stroke="${O}" stroke-width="1.7" stroke-linejoin="round"/>`),
});

ingredient('chanterelle', {
  name: 'Chanterelle', color: '#f2a228', islands: ['frost'],
  icon: svg(`
    <path d="M3.2 10.4c0-3.4 3.8-5.8 8.8-5.8s8.8 2.4 8.8 5.8c0 1.4-1.6 1.8-2.6 1.2l-2.4 6.8c-.5 1.6-2 2.6-3.8 2.6s-3.3-1-3.8-2.6L5.8 11.6c-1 .6-2.6.2-2.6-1.2z" fill="#f2a228" stroke="${O}" stroke-width="2" stroke-linejoin="round"/>
    <path d="M4.8 9.6c1-2 3.6-3.4 7.2-3.4s6.2 1.4 7.2 3.4c-2.2-1-4.6-1.4-7.2-1.4s-5 .4-7.2 1.4z" fill="#ffc95e"/>
    <path d="M8 12.6l1.6 6M12 12.2v8M16 12.6l-1.6 6" fill="none" stroke="#c97a14" stroke-width="1.4" stroke-linecap="round"/>
    <ellipse cx="8" cy="7.8" rx="1.6" ry=".9" transform="rotate(-20 8 7.8)" fill="#fff" opacity=".7"/>`),
});

ingredient('crystal', {
  name: 'Crystal', color: '#b4c8ff', islands: ['frost'],
  icon: svg(`
    <path d="M6.4 3.6h11.2l4.4 5.6-10 12.4L2 9.2z" fill="#b9d8ff" stroke="${O}" stroke-width="2" stroke-linejoin="round"/>
    <path d="M9 9.2 6.4 3.6h5.6z" fill="#e6f3ff"/><path d="M15 9.2l2.6-5.6H12z" fill="#cdbbff"/>
    <path d="M2 9.2h7l3 12.4z" fill="#8fb4ff" opacity=".85"/><path d="M22 9.2h-7l-3 12.4z" fill="#a99bff" opacity=".85"/>
    <path d="M6.4 3.6 9 9.2h6l2.6-5.6M2 9.2h20M9 9.2 12 21.6l3-12.4" fill="none" stroke="${O}" stroke-width="1.3" stroke-linejoin="round" opacity=".55"/>
    <path d="M19.6 1.2v3.2M18 2.8h3.2" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>`),
});

ingredient('snow-truffle', {
  name: 'Snow Truffle', color: '#c9b89a', islands: ['frost'],
  icon: svg(`
    <path d="M3.4 14.2c-.2-4.4 3.2-8 8.6-8s9 3.4 8.6 8.2c-.4 4.6-4 6.8-8.6 6.6-4.8-.2-8.4-2.4-8.6-6.8z" fill="#bfae8f" stroke="${O}" stroke-width="2" stroke-linejoin="round"/>
    <circle cx="8" cy="15.6" r="1.3" fill="#8d7a5c"/><circle cx="12.6" cy="17.4" r="1.2" fill="#8d7a5c"/><circle cx="16.6" cy="14.6" r="1.3" fill="#8d7a5c"/><circle cx="6.4" cy="12.2" r="1" fill="#8d7a5c"/><circle cx="12" cy="13.4" r="1" fill="#8d7a5c"/>
    <path d="M4.6 11.6c1.2-3.2 4-5 7.4-5s6.2 1.8 7.4 5c-1.2.8-2.2-.4-3.4.4-1.2.8-2-.6-3.4 0-1.4-.6-2.2.8-3.4 0-1.2-.8-2.2.4-3.2-.4z" fill="#f4f8ff" stroke="${O}" stroke-width="1.5" stroke-linejoin="round"/>
    <circle cx="9" cy="4.6" r=".9" fill="#fff"/><circle cx="15.4" cy="3.8" r=".8" fill="#dff0ff"/>`),
});

// ---------------------------------------------------------------------------------------------
// DISHES (Step 14): cooked at the campfire (world/campfire.js) from the recipes below.
// ---------------------------------------------------------------------------------------------
dish('baked-potato', {
  name: 'Baked Potato', plural: 'Baked Potatoes', color: '#e8b56b',
  icon: svg(`
    <path d="M9 4.6c-.9-1 .7-1.6 0-2.8M13 4.6c-.9-1 .7-1.6 0-2.8M17 4.6c-.9-1 .7-1.6 0-2.8" fill="none" stroke="${O}" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M2.6 14.6c-.4-4.4 3.4-8 9-8s9.6 3.6 8.8 8.4c-.8 4.6-4.6 6.2-9.2 5.8-4.6-.4-8.4-2.8-8.6-6.2z"
          fill="#e0a052" stroke="${O}" stroke-width="2" stroke-linejoin="round"/>
    <path d="M6.6 11.4c2.2-2.2 6.6-3 10.4-1.2.4 1.6-.4 3-2.4 3.4-2.6.6-5.4.6-8-.4z" fill="#fff3c4" stroke="${O}" stroke-width="1.5" stroke-linejoin="round"/>
    <rect x="10" y="9" width="4.2" height="3" rx="1" transform="rotate(-8 12 10.5)" fill="#ffd84a" stroke="${O}" stroke-width="1.2"/>
    <path d="M5.4 16.4c1.2 1.2 3 1.8 4.6 1.8" fill="none" stroke="#b97a36" stroke-width="1.5" stroke-linecap="round"/>`),
});

dish('grilled-mushrooms', {
  name: 'Grilled Mushrooms', plural: 'Grilled Mushrooms', color: '#d0653a',
  icon: svg(`
    <path d="M3 19.6 21 9.2" stroke="${O}" stroke-width="3.4" stroke-linecap="round"/>
    <path d="M3 19.6 21 9.2" stroke="#d9a066" stroke-width="1.4" stroke-linecap="round"/>
    <path d="M3.2 11c.2-4.4 3-6.8 6.2-6.8s6 2.4 6.2 6.8c0 .6-.5 1-1.2 1H4.4c-.7 0-1.2-.4-1.2-1z" fill="#e0683c" stroke="${O}" stroke-width="2" stroke-linejoin="round"/>
    <path d="M6.4 5.2v6.4M9.4 4.4v7.2M12.4 5.2v6.4" stroke="#7a3318" stroke-width="1.4" stroke-linecap="round"/>
    <path d="M8.2 12.4h2.4l.4 4.4c0 .8-.8 1.4-1.6 1.4s-1.6-.6-1.6-1.4z" fill="#fff1d6" stroke="${O}" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M13.6 17.6c.1-3 2-4.6 4.4-4.6s4.3 1.6 4.4 4.6c0 .5-.4.8-.9.8h-7c-.5 0-.9-.3-.9-.8z" fill="#e0683c" stroke="${O}" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M16 13.4v4.4M18.2 13v4.8" stroke="#7a3318" stroke-width="1.2" stroke-linecap="round"/>`),
});

dish('fruit-skewer', {
  name: 'Fruit Skewer', plural: 'Fruit Skewers', color: '#ff7a8a',
  icon: svg(`
    <path d="M3.4 21 20.6 3" stroke="${O}" stroke-width="3.4" stroke-linecap="round"/>
    <path d="M3.4 21 20.6 3" stroke="#d9a066" stroke-width="1.4" stroke-linecap="round"/>
    <circle cx="17.4" cy="6.6" r="3.6" fill="#ff4d6d" stroke="${O}" stroke-width="1.8"/>
    <circle cx="16.4" cy="5.6" r=".9" fill="#fff" opacity=".85"/>
    <circle cx="12.6" cy="11.4" r="4" fill="#ffb08a" stroke="${O}" stroke-width="1.8"/>
    <path d="M12.2 7.6c1.6.6 2.6 2 2.6 3.6" fill="none" stroke="#ff8a8f" stroke-width="1.8" stroke-linecap="round"/>
    <circle cx="8.6" cy="15.6" r="3.7" fill="#ff5468" stroke="${O}" stroke-width="1.8"/>
    <circle cx="7.6" cy="14.4" r=".9" fill="#fff" opacity=".85"/>
    <circle cx="5.2" cy="19.4" r="2.9" fill="#ff4d6d" stroke="${O}" stroke-width="1.7"/>`),
});

dish('coconut-soup', {
  name: 'Coconut Soup', plural: 'Coconut Soups', color: '#f5e6b8',
  icon: svg(`
    <path d="M9 5.4c-.9-1 .7-1.6 0-2.8M13 5.4c-.9-1 .7-1.6 0-2.8M17 5.4c-.9-1 .7-1.6 0-2.8" fill="none" stroke="${O}" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M2.6 10.6h18.8c0 5.6-3.6 10-9.4 10s-9.4-4.4-9.4-10z" fill="#8a5a3a" stroke="${O}" stroke-width="2" stroke-linejoin="round"/>
    <ellipse cx="12" cy="10.6" rx="9.4" ry="2.8" fill="#f8efc9" stroke="${O}" stroke-width="2"/>
    <ellipse cx="9.4" cy="10.4" rx="3.4" ry="1.1" fill="#fffbe6"/>
    <ellipse cx="15.6" cy="10.8" rx="2.4" ry="1" transform="rotate(-18 15.6 10.8)" fill="#4fdcae" stroke="${O}" stroke-width="1.1"/>
    <path d="M6.4 14.4c.8 2.2 2.4 3.6 4.4 4" fill="none" stroke="#b98a5f" stroke-width="1.5" stroke-linecap="round"/>`),
});

dish('berry-jam', {
  name: 'Berry Jam', plural: 'Berry Jams', color: '#e0416a',
  icon: svg(`
    <path d="M6.4 8.4h11.2c.8 0 1.4.6 1.4 1.4v8.6c0 1.6-1.2 2.8-2.8 2.8H7.8C6.2 21.2 5 20 5 18.4V9.8c0-.8.6-1.4 1.4-1.4z" fill="#ffe3ec" stroke="${O}" stroke-width="2" stroke-linejoin="round"/>
    <path d="M5.9 12.4h12.2v6c0 1.3-1 2.3-2.3 2.3H8.2c-1.3 0-2.3-1-2.3-2.3z" fill="#e0416a"/>
    <path d="M5.9 12.4h12.2" stroke="${O}" stroke-width="1.4"/>
    <rect x="4.4" y="4.2" width="15.2" height="4.4" rx="1.8" fill="#ff8fbe" stroke="${O}" stroke-width="2"/>
    <path d="M7.6 4.6v3.6M11.2 4.6v3.6M14.8 4.6v3.6M18.2 4.8v3.2" stroke="#fff" stroke-width="1.1" stroke-linecap="round" opacity=".7"/>
    <ellipse cx="8.6" cy="15.4" rx="1" ry="1.8" fill="#fff" opacity=".6"/>
    <circle cx="14.6" cy="16.8" r="1.6" fill="#ff4d6d" stroke="${O}" stroke-width="1"/>`),
});

// ---- Frostpine dishes (Step 29b): Frostpine recipes, cooked only at a Frostpine campfire (Step 33), so `islands: ['frost']`
dish('forest-stew', {
  name: 'Forest Stew', plural: 'Forest Stews', color: '#c98a3a', islands: ['frost'],
  icon: svg(`
    <path d="M9 5.4c-.9-1 .7-1.6 0-2.8M13 5.4c-.9-1 .7-1.6 0-2.8M17 5.4c-.9-1 .7-1.6 0-2.8" fill="none" stroke="${O}" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M2.6 10.6h18.8c0 5.6-3.6 10-9.4 10s-9.4-4.4-9.4-10z" fill="#5a8a5c" stroke="${O}" stroke-width="2" stroke-linejoin="round"/>
    <ellipse cx="12" cy="10.6" rx="9.4" ry="2.8" fill="#b8742f" stroke="${O}" stroke-width="2"/>
    <ellipse cx="8.4" cy="10.2" rx="2.6" ry="1.2" fill="#f2a228" stroke="${O}" stroke-width="1.1"/>
    <ellipse cx="14.4" cy="10.8" rx="2.2" ry="1" transform="rotate(-15 14.4 10.8)" fill="#5ff2b8" stroke="${O}" stroke-width="1.1"/>
    <circle cx="17" cy="9.6" r="1.2" fill="#e8c27a" stroke="${O}" stroke-width=".9"/>
    <path d="M6.4 14.4c.8 2.2 2.4 3.6 4.4 4" fill="none" stroke="#8fb88e" stroke-width="1.5" stroke-linecap="round"/>`),
});

dish('lingonberry-tart', {
  name: 'Lingonberry Tart', plural: 'Lingonberry Tarts', color: '#e0516a', islands: ['frost'],
  icon: svg(`
    <path d="M2.8 13.4h18.4l-1.8 6c-.3 1-1.2 1.6-2.2 1.6H6.8c-1 0-1.9-.6-2.2-1.6z" fill="#e0a052" stroke="${O}" stroke-width="2" stroke-linejoin="round"/>
    <path d="M7 14.6l.8 5.4M10.4 14.6l.4 5.6M13.6 14.6l-.4 5.6M17 14.6l-.8 5.4" stroke="#b97a36" stroke-width="1.3" stroke-linecap="round"/>
    <ellipse cx="12" cy="13.2" rx="9.2" ry="3.4" fill="#f5c874" stroke="${O}" stroke-width="2"/>
    <ellipse cx="12" cy="12.8" rx="6.6" ry="2.2" fill="#ffe6ec"/>
    <circle cx="8.6" cy="12.2" r="1.9" fill="#e0243f" stroke="${O}" stroke-width="1.2"/><circle cx="12.4" cy="11.6" r="1.9" fill="#ee3b52" stroke="${O}" stroke-width="1.2"/><circle cx="15.8" cy="12.6" r="1.8" fill="#e0243f" stroke="${O}" stroke-width="1.2"/>
    <circle cx="10.8" cy="13.6" r="1.6" fill="#ee3b52" stroke="${O}" stroke-width="1.1"/><circle cx="14" cy="14" r="1.5" fill="#e0243f" stroke="${O}" stroke-width="1.1"/>
    <path d="M12.4 9.6c.4-1.4 1.2-2.2 2.4-2.6" fill="none" stroke="${O}" stroke-width="1.6" stroke-linecap="round"/>
    <ellipse cx="16.4" cy="6.6" rx="2.4" ry="1.2" transform="rotate(-25 16.4 6.6)" fill="#5ff2b8" stroke="${O}" stroke-width="1.1"/>`),
});

dish('toasted-pine-nuts', {
  name: 'Toasted Pine Nuts', plural: 'Toasted Pine Nuts', color: '#e0b36a', islands: ['frost'],
  icon: svg(`
    <path d="M9 5.4c-.9-1 .7-1.6 0-2.8M13 5.4c-.9-1 .7-1.6 0-2.8M17 5.4c-.9-1 .7-1.6 0-2.8" fill="none" stroke="${O}" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M2.4 14.4h19.2c-.4 4-4.2 6.6-9.6 6.6s-9.2-2.6-9.6-6.6z" fill="#8f5b34" stroke="${O}" stroke-width="2" stroke-linejoin="round"/>
    <ellipse cx="12" cy="14.2" rx="9.6" ry="2.6" fill="#c98a54" stroke="${O}" stroke-width="2"/>
    <path d="M5 13.4c-.2-2.6 1.2-4.4 3-4 1.2.4 1.6 2.4 1 4.4z" fill="#f0cf8a" stroke="${O}" stroke-width="1.4" stroke-linejoin="round"/>
    <path d="M9.4 12.6c-.2-3 1.4-5 3.4-4.6 1.4.4 1.8 2.8 1 5z" fill="#e6bd6a" stroke="${O}" stroke-width="1.4" stroke-linejoin="round"/>
    <path d="M14.6 13.4c.2-2.8 2-4.4 3.6-3.8 1.2.6 1 3-.4 4.6z" fill="#f0cf8a" stroke="${O}" stroke-width="1.4" stroke-linejoin="round"/>
    <path d="M7 11.4c.4-.8.9-1.2 1.4-1.4M12.6 10c.4-.6.9-1 1.4-1.1" fill="none" stroke="#fff" stroke-width="1" stroke-linecap="round" opacity=".7"/>`),
});

// ---------------------------------------------------------------------------------------------
// RECIPES (Step 14): what the campfire's "Cook..." menu offers. `needs` is { ingredient id: count } (inventory.hasAll / removeAll take it as is).
//   listRecipes() -> in menu order;  getRecipe(id) -> { id, dish, needs } or null
// ---------------------------------------------------------------------------------------------
// Emberleaf ingredients (Step 30): SVG shapes also appear in dish icons below.
const EMBER_ICONS = {
  banana: '<path d="M5 4c1 10 6 14 15 10-4 10-17 8-17-5z" fill="#ffda57" stroke="'+O+'" stroke-width="2"/><path d="m5 4 2-2m12 12 2-2" stroke="'+O+'" stroke-width="2"/>',
  breadfruit: '<circle cx="12" cy="13" r="8" fill="#97cb58" stroke="'+O+'" stroke-width="2"/><path d="M12 5V2m-5 8 3 1m3-3 3 2m-8 5 3 2m3-3 3 2" stroke="#528b41" stroke-width="2"/>',
  bamboo: '<path d="M6 21V4m6 17V2m6 19V6" stroke="'+O+'" stroke-width="6"/><path d="M6 21V4m6 17V2m6 19V6" stroke="#85bf4e" stroke-width="3"/><path d="M4 9h4m2 4h4m2-3h4m-16 6h4" stroke="#d8e989" stroke-width="2"/>',
  pineapple: '<path d="m12 7-6-5 2 7-6-1 5 4" fill="#309d54" stroke="'+O+'" stroke-width="1.5"/><path d="m12 7 6-5-2 7 6-1-5 4" fill="#309d54" stroke="'+O+'" stroke-width="1.5"/><ellipse cx="12" cy="15" rx="7" ry="8" fill="#efb743" stroke="'+O+'" stroke-width="2"/><path d="m7 10 10 10m-11-5 6 6m5-11-10 10m11-5-6 6" stroke="#d58c32" stroke-width="1.4"/>',
  taro: '<path d="m12 6 1-4" stroke="'+O+'" stroke-width="3"/><ellipse cx="12" cy="14" rx="8" ry="7" fill="#a67da3" stroke="'+O+'" stroke-width="2"/><path d="M6 11h7m-8 4h6m3 3h4" stroke="#d7bbd2" stroke-width="2"/>',
  obsidian: '<path d="m4 19 2-11 6-6 5 3 4 14z" fill="#34304f" stroke="'+O+'" stroke-width="2"/><path d="m12 2-2 13 7-10m-7 10 11 4" fill="#8975b8" stroke="#bca8e0" stroke-width="1"/>',
};
for (const [id, name, color] of [['banana','Banana','#ffda57'], ['breadfruit','Breadfruit','#97cb58'], ['bamboo','Bamboo','#85bf4e'], ['pineapple','Pineapple','#efb743'], ['taro','Taro','#a67da3'], ['obsidian','Obsidian','#8975b8']]) {
  ingredient(id, { name, plural: ['bamboo','taro','obsidian','breadfruit'].includes(id) ? name : null, color, islands: id === 'taro' ? ['ember', 'duskcrown'] : ['ember'], icon: svg(EMBER_ICONS[id]) });
}
for (const [id, name, ingredientId] of [['grilled-banana','Grilled Banana','banana'], ['taro-coconut-bake','Taro & Coconut Bake','taro'], ['pineapple-skewer','Pineapple Skewer','pineapple'], ['breadfruit-roast','Breadfruit Roast','breadfruit']]) {
  dish(id, { name, color: '#e3a958', islands: ['ember'], icon: svg('<ellipse cx="12" cy="19" rx="10" ry="3" fill="#fff0da" stroke="'+O+'" stroke-width="2"/><g transform="translate(3 0) scale(.75)">'+EMBER_ICONS[ingredientId]+'</g><path d="M5 5c-2-2 2-2 0-4m14 4c-2-2 2-2 0-4" fill="none" stroke="'+O+'" stroke-width="1.5"/>') });
}

// ---- Emberleaf's garden tending items (Step 38b; taro above is the fourth): each flower needs ONE of the four, once, to sprout (game/flowers.js). Ash crumbles out of basalt rocks, mulch out of
// felled banana trees, and "Fill a coconut" at the hot spring turns a coconut into a coconut of spring water.
const TEND_ICONS = {
  ash: '<path d="M4 18c0-5 3-8 8-8s8 3 8 8c0 2-3 3-8 3s-8-1-8-3z" fill="#8f8a9c" stroke="'+O+'" stroke-width="2" stroke-linejoin="round"/><path d="M8 15c1-2 3-3 5-2m-1 6c2 0 4-1 5-3" fill="none" stroke="#c9c4d6" stroke-width="1.6" stroke-linecap="round"/><path d="M9 6c-2-2 1-3 0-5m5 6c-2-2 1-3 0-5" fill="none" stroke="#b7b2c4" stroke-width="1.5" stroke-linecap="round"/><circle cx="16" cy="12" r="1.2" fill="#ff8a4a"/>',
  'spring-water': '<path d="M5 11c0-3.600 3-6.400 7-6.400s7 2.800 7 6.400v3.600c0 4-3 6.600-7 6.600s-7-2.600-7-6.600z" fill="#8a5a36" stroke="'+O+'" stroke-width="2" stroke-linejoin="round"/><path d="M5.400 11.600c2 1.600 4.200 2.200 6.600 2.200s4.600-.6 6.600-2.200" fill="none" stroke="#c98a54" stroke-width="1.600"/><path d="M12 3.200c-1.800 2.200-2.800 3.600-2.800 4.800a2.800 2.800 0 0 0 5.600 0c0-1.200-1-2.600-2.800-4.800z" fill="#7fd3ff" stroke="'+O+'" stroke-width="1.600" stroke-linejoin="round"/><path d="M10.600 8.400c.2.600.6.900 1.100 1" fill="none" stroke="#fff" stroke-width="1.200" stroke-linecap="round"/><path d="M8 17.200c1 .8 2 1.100 3 1.100" fill="none" stroke="#6b4426" stroke-width="1.400" stroke-linecap="round"/>',
  mulch: '<path d="M3 19c0-4 2-7 4-8 1.400-3 5.600-3 7 0 3 .600 6 3 6 8 0 1.400-3 2-8 2s-9-.6-9-2z" fill="#6b4a2e" stroke="'+O+'" stroke-width="2" stroke-linejoin="round"/><path d="M6.600 15.600l2.600 1m3-3.600l2.400 1.600m-6.800 3.400l3 .6m3.800-3l3 1" fill="none" stroke="#9c7248" stroke-width="1.600" stroke-linecap="round"/><path d="M14 6.400c1.200-2 3.200-3 5.200-3-.2 2.400-1.600 4.200-4 4.800z" fill="#6cc85a" stroke="'+O+'" stroke-width="1.500" stroke-linejoin="round"/>',
};
for (const [id, name, plural, color] of [['ash', 'Ash', 'Ash', '#8f8a9c'], ['spring-water', 'Coconut of Spring Water', 'Coconuts of Spring Water', '#7fd3ff'], ['mulch', 'Mulch', 'Mulch', '#6b4a2e']]) {
  ingredient(id, { name, plural, color, islands: ['ember'], icon: svg(TEND_ICONS[id]) });
}

// Duskcrown's fish and glowcap crumbs (Step 72). Glimmerfin: round-bellied violet with cyan spots and glowing fin tips; Lanternkoi: a long indigo koi with three warm lantern patches and veil fins.
// (Step 72a landed placeholder entries; 72b replaced them with these icons, the Journal / pickup models and the recipes below.)
const FISH_ICONS = {
  glimmerfin: '<path d="M18.600 12 22 8.600v6.800z" fill="#b9a3ff" stroke="'+O+'" stroke-width="1.600" stroke-linejoin="round"/><path d="M9 4.600 12 7.600 6.600 7.600z" fill="#7ff0ff" stroke="'+O+'" stroke-width="1.400" stroke-linejoin="round"/><path d="M9.400 18.800 12.200 16.400 14.600 18.800z" fill="#7ff0ff" stroke="'+O+'" stroke-width="1.400" stroke-linejoin="round"/><ellipse cx="10.800" cy="12.200" rx="8.200" ry="6" fill="#8a67e0" stroke="'+O+'" stroke-width="2"/><ellipse cx="10.200" cy="14.200" rx="5.600" ry="2.800" fill="#c1a8ff"/><circle cx="9.200" cy="9.600" r="1" fill="#7ff0ff"/><circle cx="12.600" cy="9" r=".9" fill="#7ff0ff"/><circle cx="14.400" cy="11.800" r="1" fill="#7ff0ff"/><circle cx="11.600" cy="12.400" r=".8" fill="#baffff"/><circle cx="6" cy="11" r="1.600" fill="#fff" stroke="'+O+'" stroke-width=".9"/><circle cx="5.700" cy="11.100" r=".6" fill="'+O+'"/>',
  lanternkoi: '<path d="M17 12c2-1.200 3.600-3.600 5-6.600-.2 3 .4 4.200 0 6.600.4 2.400-.2 3.600 0 6.600-1.400-3-3-5.400-5-6.600z" fill="#9ba6ff" fill-opacity=".85" stroke="'+O+'" stroke-width="1.500" stroke-linejoin="round"/><path d="M8 7.200c1.600-3.400 3.600-4.800 6-5-.4 2.200-1.200 3.800-2.600 5.200z" fill="#b8c0ff" fill-opacity=".85" stroke="'+O+'" stroke-width="1.400" stroke-linejoin="round"/><path d="M9.400 17c1 2.600 2.400 4 4.600 4.600-.2-1.800-.8-3.200-1.800-4.600z" fill="#b8c0ff" fill-opacity=".85" stroke="'+O+'" stroke-width="1.400" stroke-linejoin="round"/><path d="M1.800 12c2.400-4.600 8.600-5.800 14-3.600 1.600.8 2 6.400 0 7.200-5.400 2.200-11.600 1-14-3.600z" fill="#3b3f9c" stroke="'+O+'" stroke-width="2" stroke-linejoin="round"/><circle cx="7.400" cy="11.400" r="1.700" fill="#ffb347"/><circle cx="11.200" cy="11.200" r="1.600" fill="#ff9a3c"/><circle cx="14.200" cy="12" r="1.200" fill="#ffc861"/><path d="M5 7.600c.2-1.400 1.400-2 2.200-1.200-.6.200-1.200.6-1.600 1.400z" fill="#ff8a3c" stroke="'+O+'" stroke-width=".9" stroke-linejoin="round"/><circle cx="4" cy="11" r="1" fill="#fff" stroke="'+O+'" stroke-width=".8"/>',
  'glowcap-crumbs': '<path d="M3.600 19.600c.4-3.400 2.800-5.200 5.600-5.200s5 1.800 5.400 5.200c0 1-1.600 1.400-5.400 1.400s-5.600-.4-5.600-1.400z" fill="#ece4f7" stroke="'+O+'" stroke-width="2" stroke-linejoin="round"/><path d="M5 12.600C5 7.400 8 4.400 12 4.400s7 3 7 8.200c-3 1.400-11 1.400-14 0z" fill="#ffb347" stroke="'+O+'" stroke-width="2" stroke-linejoin="round"/><circle cx="9" cy="8.600" r="1.100" fill="#fff1c9"/><circle cx="13.600" cy="7.600" r="1" fill="#fff1c9"/><circle cx="15.200" cy="10.800" r=".9" fill="#ff8a3d"/><circle cx="10.800" cy="10.600" r=".8" fill="#ff8a3d"/><circle cx="19.600" cy="18.400" r="1.200" fill="#ffb347" stroke="'+O+'" stroke-width=".9"/><circle cx="21" cy="14.600" r=".9" fill="#ffd98a" stroke="'+O+'" stroke-width=".8"/>',
};
for (const [id, name, plural, color] of [['glimmerfin', 'Glimmerfin', 'Glimmerfin', '#8a67e0'], ['lanternkoi', 'Lanternkoi', 'Lanternkoi', '#ffb347'], ['glowcap-crumbs', 'Glowcap Crumbs', 'Glowcap Crumbs', '#ffb347']]) {
  ingredient(id, { name, plural, color, islands: ['duskcrown'], icon: svg(FISH_ICONS[id]) });
}
// The marsh hearth's dishes: small plates in the same spirit as Emberleaf's (the lantern supper carries the koi's glowing patches).
const DUSK_DISH = {
  'glimmerfin-skewer': '<path d="M3 8.400 21 4.800" stroke="'+O+'" stroke-width="4"/><path d="M3 8.400 21 4.800" stroke="#c9b36a" stroke-width="2"/><ellipse cx="8.400" cy="7.200" rx="3.600" ry="2.800" fill="#8a67e0" stroke="'+O+'" stroke-width="1.600" transform="rotate(-11 8.400 7.200)"/><ellipse cx="15" cy="5.900" rx="3.600" ry="2.800" fill="#8a67e0" stroke="'+O+'" stroke-width="1.600" transform="rotate(-11 15 5.900)"/><circle cx="8" cy="6.600" r=".8" fill="#7ff0ff"/><circle cx="14.800" cy="5.400" r=".8" fill="#7ff0ff"/><ellipse cx="12" cy="19" rx="10" ry="3" fill="#fff0da" stroke="'+O+'" stroke-width="2"/>',
  'marsh-chowder': '<ellipse cx="12" cy="13.400" rx="8.600" ry="3.600" fill="#6a5aa8" stroke="'+O+'" stroke-width="2"/><ellipse cx="12" cy="12.400" rx="6.800" ry="2.400" fill="#a98ee4"/><circle cx="9.400" cy="12" r="1" fill="#7ff0ff"/><circle cx="13.400" cy="12.600" r="1.100" fill="#e9c6ff"/><circle cx="15.200" cy="11.600" r=".8" fill="#a67da3"/><path d="M8 8c-2-2 2-2 0-4m8 4c-2-2 2-2 0-4" fill="none" stroke="'+O+'" stroke-width="1.500"/>',
  'dusk-wrap': '<path d="M4 17.400C3 11 8 5.600 15 5.200l4.800 2.200c.6 3.600-2 8.600-6 11.200z" fill="#e9d1a0" stroke="'+O+'" stroke-width="2" stroke-linejoin="round"/><path d="M6.600 14c1.400-3.200 4.600-5.400 8.200-6" fill="none" stroke="#8a67e0" stroke-width="2.400" stroke-linecap="round"/><circle cx="9.600" cy="12" r=".9" fill="#7ff0ff"/><circle cx="13" cy="9.600" r=".9" fill="#7ff0ff"/><path d="M17.400 6.400c1-1.600 2.400-2.200 3.600-2" fill="none" stroke="#4fbf5f" stroke-width="1.800" stroke-linecap="round"/>',
  'lantern-supper': '<path d="M5 12c.2 5.200 3 7.600 7 7.600s6.800-2.400 7-7.600z" fill="#fff0da" stroke="'+O+'" stroke-width="2" stroke-linejoin="round"/><path d="M5.800 12.400c1.600-3 4.400-4.600 8-4.200 1.800.2 3.400 1.400 4 3.400z" fill="#3b3f9c" stroke="'+O+'" stroke-width="1.800" stroke-linejoin="round"/><circle cx="9.200" cy="11" r="1.300" fill="#ffb347"/><circle cx="12.600" cy="10.400" r="1.200" fill="#ff9a3c"/><circle cx="15.400" cy="11" r="1" fill="#ffc861"/><path d="M12 7V4.200M9 8l-1.600-2.400M15 8l1.600-2.400" stroke="#ffd98a" stroke-width="1.600" stroke-linecap="round"/>',
};
for (const [id, name, color] of [['glimmerfin-skewer', 'Glimmerfin Skewer', '#8a67e0'], ['marsh-chowder', 'Marsh Chowder', '#a98ee4'], ['dusk-wrap', 'Dusk Wrap', '#e9d1a0'], ['lantern-supper', 'Lantern Supper', '#ffb347']]) {
  dish(id, { name, color, islands: ['duskcrown'], icon: svg(DUSK_DISH[id]) });
}

// `island` = the island whose campfire cooks it: each fire offers (and the host only accepts) its own island's recipes. config.CAMPFIRE_ISLANDS
// lists the islands that have a fire today, so recipes of other islands can't be made yet (and feast quests that need them are held back).
export const RECIPES = [
  { id: 'baked-potato',      dish: 'baked-potato',      island: 'home',  needs: { potato: 1 } },
  { id: 'grilled-mushrooms', dish: 'grilled-mushrooms', island: 'home',  needs: { mushroom: 2, herb: 1 } },
  { id: 'fruit-skewer',      dish: 'fruit-skewer',      island: 'home',  needs: { apple: 1, peach: 1, berry: 2 } },
  { id: 'coconut-soup',      dish: 'coconut-soup',      island: 'home',  needs: { coconut: 1, potato: 1, herb: 1 } },
  { id: 'berry-jam',         dish: 'berry-jam',         island: 'home',  needs: { berry: 3 } },
  { id: 'forest-stew',       dish: 'forest-stew',       island: 'frost', needs: { chanterelle: 2, mint: 1, potato: 1 } },   // Step 29b: Frostpine
  { id: 'lingonberry-tart',  dish: 'lingonberry-tart',  island: 'frost', needs: { lingonberry: 3, apple: 1 } },
  { id: 'toasted-pine-nuts', dish: 'toasted-pine-nuts', island: 'frost', needs: { pinecone: 2 } },
  { id: 'grilled-banana',    dish: 'grilled-banana',    island: 'ember', needs: { banana: 2 } },                           // Step 30: Emberleaf
  { id: 'taro-coconut-bake', dish: 'taro-coconut-bake', island: 'ember', needs: { taro: 2, coconut: 1 } },
  { id: 'pineapple-skewer',  dish: 'pineapple-skewer',  island: 'ember', needs: { pineapple: 1, banana: 1 } },
  { id: 'breadfruit-roast',  dish: 'breadfruit-roast',  island: 'ember', needs: { breadfruit: 2 } },
  { id: 'glimmerfin-skewer', dish: 'glimmerfin-skewer', island: 'duskcrown', needs: { glimmerfin: 2 } },                    // Step 72b: the marsh hearth (Duskcrown)
  { id: 'marsh-chowder',     dish: 'marsh-chowder',     island: 'duskcrown', needs: { glimmerfin: 1, taro: 1, 'glowcap-crumbs': 1 } },
  { id: 'dusk-wrap',         dish: 'dusk-wrap',         island: 'duskcrown', needs: { glimmerfin: 1, coconut: 1 } },
  { id: 'lantern-supper',    dish: 'lantern-supper',    island: 'duskcrown', needs: { lanternkoi: 1, 'glowcap-crumbs': 2, glimmerfin: 1 } },
];
export const listRecipes = (island = null) => (island ? RECIPES.filter((r) => r.island === island) : RECIPES);
/** Can `dishId` be cooked at any campfire that exists (`fireIslands`, e.g. config.CAMPFIRE_ISLANDS)? Non-dishes are always "makeable". */
export function dishMakeable(dishId, fireIslands) {
  if (getItem(dishId)?.kind !== 'dish') return true;
  return RECIPES.some((r) => r.dish === dishId && fireIslands.includes(r.island));
}
export const getRecipe = (id) => RECIPES.find((r) => r.id === id) || null;
