// Inline SVG icons in the game's cute style (white fill, dark outline, pastel accents). Used instead of emoji
// because emoji fonts are missing in some browsers (they render as empty boxes). All icons are 24x24 and size with `1em`.
import { FLOWERS } from '../game/flowers.js';
export const OUTLINE = '#2b2340';   // outline colour
const O = OUTLINE;
export const svg = (body, extra = '') => `<svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" focusable="false"${extra}>${body}</svg>`;

export const BAG_SVG = svg(`<path d="M8 5V3h8v2M5 10H3v10h3m13-10h2v10h-3" fill="#a97843" stroke="${O}" stroke-width="1.7" stroke-linejoin="round"/><rect x="5" y="5" width="14" height="17" rx="5" fill="#edb95b" stroke="${O}" stroke-width="1.8"/><path d="M6 10q6 4 12 0V8q-6-5-12 0Z" fill="#ffe093" stroke="${O}" stroke-width="1.5"/><rect x="8" y="14" width="8" height="6" rx="2" fill="#c88b48" stroke="${O}" stroke-width="1.5"/><path d="M11 9h2v4h-2z" fill="#a7c780" stroke="${O}" stroke-width="1"/>`);

export const PHONE_SVG = svg(`
  <rect x="6" y="2.5" width="12" height="19" rx="3" fill="#fff" stroke="${O}" stroke-width="2"/>
  <rect x="8.3" y="5.5" width="7.4" height="9.5" rx="1" fill="#6fe3ef"/><circle cx="12" cy="18.4" r="1.2" fill="${O}"/>`);

export const KEYBOARD_SVG = svg(`
  <rect x="1.8" y="5.5" width="20.4" height="13" rx="3.4" fill="#fff" stroke="${O}" stroke-width="2"/>
  <g fill="#ffd54a" stroke="${O}" stroke-width="1.1">
    <rect x="4.6" y="8.2" width="3" height="2.6" rx="0.8"/><rect x="9" y="8.2" width="3" height="2.6" rx="0.8"/>
    <rect x="13.4" y="8.2" width="3" height="2.6" rx="0.8"/><rect x="17.8" y="8.2" width="2" height="2.6" rx="0.8"/>
  </g>
  <rect x="7" y="12.6" width="10" height="2.8" rx="1" fill="#ff8fbe" stroke="${O}" stroke-width="1.1"/>`);

export const GAMEPAD_SVG = svg(`
  <path d="M6.6 6.2h10.8c2.6 0 4.2 2.3 4.7 5.6l.6 4c.3 2.2-1 3.6-2.6 3.6-1.3 0-2.1-.7-3-1.9l-1.1-1.5H8.6l-1.1 1.5c-.9 1.2-1.7 1.9-3 1.9-1.6 0-2.9-1.4-2.6-3.6l.6-4c.5-3.3 2.1-5.6 4.1-5.6z"
        fill="#fff" stroke="${O}" stroke-width="2" stroke-linejoin="round"/>
  <path d="M7.4 9.2v4.4M5.2 11.4h4.4" stroke="${O}" stroke-width="2" stroke-linecap="round"/>
  <circle cx="15.6" cy="10.2" r="1.35" fill="#55d96a" stroke="${O}" stroke-width="1"/>
  <circle cx="18.2" cy="12.6" r="1.35" fill="#ff7a93" stroke="${O}" stroke-width="1"/>`);

/** "Plays on another screen": a little monitor with a phone in front of it (the roster badge of a remote player). */
export const SCREEN_SVG = svg(`
  <rect x="1.8" y="3.6" width="16.6" height="11.6" rx="2.4" fill="#fff" stroke="${O}" stroke-width="2"/>
  <rect x="4" y="5.8" width="12.2" height="7.2" rx="1" fill="#6fe3ef"/>
  <path d="M7 19.6h7.4M10.7 15.4v4.2" stroke="${O}" stroke-width="2" stroke-linecap="round"/>
  <rect x="15.6" y="10.2" width="6.4" height="11.4" rx="1.9" fill="#ffd54a" stroke="${O}" stroke-width="1.7"/>
  <circle cx="18.8" cy="19.2" r=".8" fill="${O}"/>`);

export const SPEAKER_ON_SVG = svg(`
  <path d="M3.6 9.4h3.4l4.6-3.9v13l-4.6-3.9H3.6z" fill="#fff" stroke="${O}" stroke-width="2" stroke-linejoin="round"/>
  <path d="M15 9.2c1.4 1.6 1.4 4 0 5.6M17.6 6.6c2.9 3 2.9 7.8 0 10.8" fill="none" stroke="${O}" stroke-width="2" stroke-linecap="round"/>`);

export const SPEAKER_OFF_SVG = svg(`
  <path d="M3.6 9.4h3.4l4.6-3.9v13l-4.6-3.9H3.6z" fill="#fff" stroke="${O}" stroke-width="2" stroke-linejoin="round"/>
  <path d="M15.4 9.6l5.4 5.4M20.8 9.6l-5.4 5.4" stroke="#e0507a" stroke-width="2.4" stroke-linecap="round"/>`);

export const MUSIC_ON_SVG = svg(`
  <path d="M9 17.4V6.2l10.4-2.2v11.4" fill="none" stroke="${O}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
  <path d="M9 9.6l10.4-2.2" stroke="${O}" stroke-width="2" stroke-linecap="round"/>
  <ellipse cx="6.4" cy="17.6" rx="3.3" ry="2.7" fill="#ff8fbe" stroke="${O}" stroke-width="2"/>
  <ellipse cx="16.8" cy="15.4" rx="3.3" ry="2.7" fill="#ffd54a" stroke="${O}" stroke-width="2"/>`);

export const MUSIC_OFF_SVG = svg(`
  <g opacity=".5">
    <path d="M9 17.4V6.2l10.4-2.2v11.4" fill="none" stroke="${O}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <path d="M9 9.6l10.4-2.2" stroke="${O}" stroke-width="2" stroke-linecap="round"/>
    <ellipse cx="6.4" cy="17.6" rx="3.3" ry="2.7" fill="#fff" stroke="${O}" stroke-width="2"/>
    <ellipse cx="16.8" cy="15.4" rx="3.3" ry="2.7" fill="#fff" stroke="${O}" stroke-width="2"/>
  </g>
  <path d="M3.4 3.4l17.2 17.2" stroke="#e0507a" stroke-width="2.6" stroke-linecap="round"/>`);

export const SPARKLE_SVG = svg(`
  <path d="M12 2.6c.9 4.6 2.8 6.5 7.4 7.4-4.6.9-6.5 2.8-7.4 7.4-.9-4.6-2.8-6.5-7.4-7.4 4.6-.9 6.5-2.8 7.4-7.4z"
        fill="#ffe066" stroke="${O}" stroke-width="1.8" stroke-linejoin="round"/>
  <path d="M19 15.5c.4 1.9 1.2 2.7 3 3-1.8.4-2.6 1.2-3 3-.4-1.8-1.2-2.6-3-3 1.8-.3 2.6-1.1 3-3z" fill="#fff" stroke="${O}" stroke-width="1.2" stroke-linejoin="round"/>`);

export const SPROUT_SVG = svg(`
  <path d="M12 21.5v-9" stroke="${O}" stroke-width="2.2" stroke-linecap="round"/>
  <path d="M12 13.5c-5.5.4-8-2.600-8.200-7 4.800-.4 8 1.800 8.200 7z" fill="#7fe08a" stroke="${O}" stroke-width="2" stroke-linejoin="round"/>
  <path d="M12 11.5c.2-4.400 3.200-7 8.200-6.600.200 4.400-2.600 7.200-8.200 6.600z" fill="#5fd07a" stroke="${O}" stroke-width="2" stroke-linejoin="round"/>
  <path d="M7.500 21.500h9" stroke="${O}" stroke-width="2.200" stroke-linecap="round"/>`);

export const SEED_SVG = svg(`
  <path d="M12 3.200c4.600 3 6.600 7 6 10.500-.600 3.700-3.200 6.300-6 7.100-2.800-.800-5.400-3.400-6-7.100-.600-3.500 1.400-7.500 6-10.500z" fill="#e9c27a" stroke="${O}" stroke-width="2" stroke-linejoin="round"/>
  <path d="M12 6.500c0 4.500-.2 8 0 12" stroke="#a9763a" stroke-width="1.500" stroke-linecap="round" fill="none"/>
  <path d="M8.700 10.200c.8 1.800.9 3.200.5 4.800" stroke="#fff" stroke-width="1.400" stroke-linecap="round" fill="none" opacity=".8"/>`);

export const BERRY_SVG = svg(`
  <circle cx="12" cy="14" r="7" fill="#ff4d6d" stroke="${O}" stroke-width="2"/>
  <path d="M12 7.2c-.3-2 .5-3.6 2.4-4.4" fill="none" stroke="${O}" stroke-width="2" stroke-linecap="round"/>
  <ellipse cx="9.4" cy="8" rx="3.2" ry="1.7" transform="rotate(-25 9.4 8)" fill="#5fd07a" stroke="${O}" stroke-width="1.3"/>
  <circle cx="9.6" cy="12.6" r="1.3" fill="#fff" opacity=".85"/>`);

export const FLAME_SVG = svg(`
  <path d="M12 2.4c.6 3.4 4.6 5.6 5.6 10 .9 4-1.8 8.4-5.6 8.4s-6.5-3.6-5.6-7.4c.5-2.1 1.8-3.2 2.4-4.8.3 1.3.9 2 1.7 2.4C10 7.6 10.6 4.6 12 2.4z"
        fill="#ff7a3d" stroke="${O}" stroke-width="2" stroke-linejoin="round"/>
  <path d="M12 10.8c.4 2 2.6 3.2 2.6 5.6 0 1.8-1.2 3.2-2.6 3.2s-2.6-1.4-2.6-3.2c0-1.6 1-2.2 1.6-3.4.3.7.6 1 1 1.1z" fill="#ffd23b"/>`);

/** Grey, "out" flame for the status readout of a cold fire. */
export const FLAME_OFF_SVG = svg(`
  <path d="M12 2.4c.6 3.4 4.6 5.6 5.6 10 .9 4-1.8 8.4-5.6 8.4s-6.5-3.6-5.6-7.4c.5-2.1 1.8-3.2 2.4-4.8.3 1.3.9 2 1.7 2.4C10 7.6 10.6 4.6 12 2.4z"
        fill="#c9c3da" stroke="${O}" stroke-width="2" stroke-linejoin="round" opacity=".75"/>`);

export const POT_SVG = svg(`
  <path d="M3 10.5h18v5.2c0 3.2-2.4 5.3-5.6 5.3H8.6C5.4 21 3 18.9 3 15.7z" fill="#8c84a8" stroke="${O}" stroke-width="2" stroke-linejoin="round"/>
  <rect x="1.6" y="8.6" width="20.8" height="3.4" rx="1.7" fill="#b9b4cc" stroke="${O}" stroke-width="2"/>
  <path d="M8.6 6.2c-.8-1.2.8-1.8 0-3M12.6 6.2c-.8-1.2.8-1.8 0-3M16.6 6.2c-.8-1.2.8-1.8 0-3" fill="none" stroke="${O}" stroke-width="1.7" stroke-linecap="round"/>`);

export const QUEST_SVG = svg(`
  <path d="M4.6 3.6h11.2c1.2 0 2 .8 2 2v13.8c0 1.1.6 1.7 1.6 1.7H7.4c-1.6 0-2.8-1.2-2.8-2.8z" fill="#fff8e0" stroke="${O}" stroke-width="2" stroke-linejoin="round"/>
  <path d="M17.8 19.4c0 1.1.6 1.7 1.6 1.7 1.3 0 1.9-.8 1.9-2v-1.6h-3.5z" fill="#ffd54a" stroke="${O}" stroke-width="1.6" stroke-linejoin="round"/>
  <path d="M8 8.4h6.4M8 12h6.4M8 15.6h3.8" stroke="#ff8fbe" stroke-width="1.8" stroke-linecap="round"/>`);

export const LEAVE_SVG = svg(`
  <path d="M14.4 4.2h4.4c1 0 1.8.8 1.8 1.8v12c0 1-.8 1.8-1.8 1.8h-4.4" fill="none" stroke="${O}" stroke-width="2" stroke-linecap="round"/>
  <path d="M3.4 12h10M9.8 7.6 14.2 12l-4.4 4.4" fill="none" stroke="${O}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`);

export const SPLIT_SVG = svg(`
  <circle cx="9" cy="8" r="3.4" fill="#fff" stroke="${O}" stroke-width="2"/>
  <path d="M2.8 19.8c.5-3.6 3-5.6 6.2-5.6s5.7 2 6.2 5.6" fill="#fff" stroke="${O}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M18.6 7.2v6.4M15.4 10.4h6.4" fill="none" stroke="${O}" stroke-width="2.2" stroke-linecap="round"/>`);

export const BOOK_SVG = svg(`
  <path d="M2.4 5.6c3.2-1.5 6.5-1.3 9.6 1 3.1-2.3 6.4-2.5 9.6-1v13c-3.2-1.5-6.5-1.3-9.6 1-3.1-2.3-6.4-2.5-9.6-1z" fill="#fff8e0" stroke="${O}" stroke-width="2" stroke-linejoin="round"/>
  <path d="M12 6.6v13" stroke="${O}" stroke-width="2"/>
  <path d="M5 9.4c1.5-.3 2.9-.1 4.3.6M5 12.6c1.5-.3 2.9-.1 4.3.6M14.7 10c1.4-.7 2.8-.9 4.3-.6M14.7 13.2c1.4-.7 2.8-.9 4.3-.6" fill="none" stroke="#ff8fbe" stroke-width="1.6" stroke-linecap="round"/>
  <path d="M16.4 3.6v6l1.6-1.3 1.6 1.3v-6z" fill="#ff5d73" stroke="${O}" stroke-width="1.4" stroke-linejoin="round"/>`);

export const BACK_SVG = svg(`
  <path d="M9.4 6.4 4 12l5.4 5.6M4.6 12h10.6c2.8 0 4.8 1.8 4.8 4.4" fill="none" stroke="${O}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`);

export const HEART_SVG = svg(`
  <path d="M12 21C5.4 15.8 2.6 12.4 2.6 8.6 2.6 5.8 4.8 3.8 7.4 3.8c1.9 0 3.5 1 4.6 2.6 1.1-1.6 2.7-2.6 4.6-2.6 2.6 0 4.8 2 4.8 4.8 0 3.8-2.8 7.2-9.4 12.4z" fill="#ff5d73" stroke="${O}" stroke-width="2" stroke-linejoin="round"/>
  <path d="M6.4 8.2c.2-1.1 1-1.8 2-1.9" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>`);

// Step 51: the dandelion puff (a friend can pop it): shown in a player's hearts pill while they wait
export const PUFF_SVG = svg(`<g stroke="${O}" stroke-width="1.5" stroke-linecap="round" fill="none"><path d="M12 12L12 3.4M12 12L19.2 6.4M12 12L21 12M12 12L19.2 17.6M12 12L12 20.6M12 12L4.8 17.6M12 12L3 12M12 12L4.8 6.4"/></g><g fill="#fff" stroke="${O}" stroke-width="1.2"><circle cx="12" cy="3.2" r="1.7"/><circle cx="19.4" cy="6.2" r="1.7"/><circle cx="21" cy="12" r="1.7"/><circle cx="19.4" cy="17.8" r="1.7"/><circle cx="12" cy="20.8" r="1.7"/><circle cx="4.6" cy="17.8" r="1.7"/><circle cx="3" cy="12" r="1.7"/><circle cx="4.6" cy="6.2" r="1.7"/></g><circle cx="12" cy="12" r="2.6" fill="#ffd85e" stroke="${O}" stroke-width="1.4"/>`);

export const FEAST_SVG = svg(`
  <ellipse cx="12" cy="17.6" rx="9.6" ry="3.4" fill="#fff" stroke="${O}" stroke-width="2"/>
  <ellipse cx="12" cy="16.6" rx="6.2" ry="1.9" fill="#ffe3ec"/>
  <circle cx="8.6" cy="12.4" r="3.3" fill="#ff5468" stroke="${O}" stroke-width="1.8"/>
  <circle cx="14.2" cy="11.6" r="3.6" fill="#ffb347" stroke="${O}" stroke-width="1.8"/>
  <circle cx="11.6" cy="8" r="3" fill="#7be05e" stroke="${O}" stroke-width="1.8"/>
  <path d="M5.4 4.4l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6zM19 3.6l.5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5z" fill="#ffe066" stroke="${O}" stroke-width="1" stroke-linejoin="round"/>`);

export const HAT_SVG = svg(`
  <path d="M5.4 15.2C4.6 9.2 7.6 4.6 12 4.6s7.4 4.6 6.6 10.6z" fill="#ffc93c" stroke="${O}" stroke-width="2" stroke-linejoin="round"/>
  <path d="M5 14.6h14c1.1 0 1.8.8 1.8 1.8s-.7 1.8-1.8 1.8H5c-1.1 0-1.8-.8-1.8-1.8s.7-1.8 1.8-1.8z" fill="#ff8a5c" stroke="${O}" stroke-width="2" stroke-linejoin="round"/>
  <circle cx="12" cy="3.8" r="2" fill="#fff" stroke="${O}" stroke-width="1.6"/>
  <path d="M9 8.6c.6-1 1.6-1.6 2.8-1.7" fill="none" stroke="#fff" stroke-width="1.4" stroke-linecap="round" opacity=".7"/>`);

export const BRIDGE_SVG = svg(`
  <path d="M1.8 17.4V9.6M22.2 17.4V9.6" fill="none" stroke="${O}" stroke-width="4.2" stroke-linecap="round"/>
  <path d="M1.8 17.4V9.6M22.2 17.4V9.6" fill="none" stroke="#c98a54" stroke-width="2" stroke-linecap="round"/>
  <path d="M1.8 11.2C7 15.8 17 15.8 22.2 11.2" fill="none" stroke="${O}" stroke-width="3.4" stroke-linecap="round"/>
  <path d="M1.8 11.2C7 15.8 17 15.8 22.2 11.2" fill="none" stroke="#f2cf96" stroke-width="1.6" stroke-linecap="round"/>
  <rect x="2.6" y="14.4" width="18.8" height="3.6" rx="1.4" fill="#c98a54" stroke="${O}" stroke-width="2"/>
  <path d="M8 14.6v3.2M12 14.6v3.2M16 14.6v3.2" stroke="#8f5b34" stroke-width="1.3" stroke-linecap="round"/>
  <path d="M2 21.4c3 1.2 5-.6 8 0s5 1.2 8 0 3-.6 4-.2" fill="none" stroke="#5fc4ff" stroke-width="1.8" stroke-linecap="round"/>`);

/** A little tent with a flame in front: the Frostpine camp (its menu row, signposts' icon, toasts). */
export const CAMP_SVG = svg(`
  <path d="M12 6.4V2.4" stroke="${O}" stroke-width="1.8" stroke-linecap="round"/>
  <path d="M12 2.6l4 1.4-4 1.4z" fill="#ffd54a" stroke="${O}" stroke-width="1.3" stroke-linejoin="round"/>
  <path d="M2.2 20.4 12 6l9.8 14.4z" fill="#ff7a5c" stroke="${O}" stroke-width="2" stroke-linejoin="round"/>
  <path d="M12 20.4H8.6L12 11.2l3.4 9.2z" fill="#3a2f55" stroke="${O}" stroke-width="1.2" stroke-linejoin="round"/>
  <path d="M12 20.4c-1.7 0-2.5-1.1-2.5-2.1 0-1.3 1.2-1.8 1.5-3.2.9.6 1 1.3 1 1.8.4-.3.6-.7.6-1.2.9.8 1.9 1.5 1.9 2.6 0 1.1-.9 2.1-2.5 2.1z" fill="#ffb23c" stroke="${O}" stroke-width="1" stroke-linejoin="round"/>`);

/** Frostpine's critters (Step 34b): small round faces for the "moved into the camp" toast. */
export const FOX_SVG = svg(`
  <path d="M3.4 3.6l5.2 3.6M20.6 3.6l-5.2 3.6" stroke="${O}" stroke-width="5" stroke-linecap="round"/>
  <path d="M3.4 3.6l5.2 3.6M20.6 3.6l-5.2 3.6" stroke="#f27d2a" stroke-width="2.4" stroke-linecap="round"/>
  <path d="M12 21c-5 0-8.6-3-8.6-7.6C3.4 9 7.2 6 12 6s8.6 3 8.6 7.4C20.6 18 17 21 12 21z" fill="#f27d2a" stroke="${O}" stroke-width="2" stroke-linejoin="round"/>
  <path d="M12 21c-2.6 0-4.6-1.2-5.8-3.2 1.6-.6 3.4-1.8 5.8-1.8s4.2 1.2 5.8 1.8C16.6 19.8 14.6 21 12 21z" fill="#fff6ea"/>
  <circle cx="8.6" cy="12.4" r="1.3" fill="${O}"/><circle cx="15.4" cy="12.4" r="1.3" fill="${O}"/><ellipse cx="12" cy="16.2" rx="1.5" ry="1.1" fill="${O}"/>`);

export const SQUIRREL_SVG = svg(`
  <path d="M19.6 20.400c3.2-1 3.8-6.6 1.2-9.8-1.8-2.2-4.4-2-4.2.2.1 1.5 1.7 1.8 1.8 3.4.1 2.2-2.6 3.4-2.6 3.400z" fill="#b9582c" stroke="${O}" stroke-width="2" stroke-linejoin="round"/>
  <path d="M5 8.4 3.8 3.800l4 1.800M14.6 5.600l3.8-1.6-1 4.6" fill="#b9582c" stroke="${O}" stroke-width="1.8" stroke-linejoin="round"/>
  <path d="M10.8 21C6.4 21 3.8 18.2 3.8 14.4 3.8 10.2 6.8 7 10.8 7s7 3.2 7 7.400c0 3.8-2.6 6.6-7 6.600z" fill="#b9582c" stroke="${O}" stroke-width="2" stroke-linejoin="round"/>
  <ellipse cx="10.8" cy="17.6" rx="3.6" ry="2.8" fill="#f6dcb4"/>
  <circle cx="7.8" cy="12.6" r="1.3" fill="${O}"/><circle cx="13.8" cy="12.6" r="1.3" fill="${O}"/><ellipse cx="10.8" cy="15.4" rx="1.2" ry="0.9" fill="#6b3a3a"/>`);

export const RABBIT_SVG = svg(`
  <path d="M8.2 11C6.6 7 6.6 2.8 8.6 2.800S11.4 7 11 11zM15.8 11c1.6-4 1.6-8.2-.4-8.200S12.6 7 13 11z" fill="#fff" stroke="${O}" stroke-width="2" stroke-linejoin="round"/>
  <path d="M8.8 9.600c-.6-2.4-.6-4.6 0-4.800M15.2 9.600c.6-2.4.6-4.6 0-4.8" stroke="#ff93b4" stroke-width="1.6" stroke-linecap="round"/>
  <path d="M12 21.400c-5 0-8-2.8-8-6.6 0-3.8 3.2-6 8-6s8 2.2 8 6c0 3.8-3 6.6-8 6.600z" fill="#fff" stroke="${O}" stroke-width="2" stroke-linejoin="round"/>
  <circle cx="8.8" cy="14.4" r="1.3" fill="${O}"/><circle cx="15.2" cy="14.4" r="1.3" fill="${O}"/><ellipse cx="12" cy="17.2" rx="1.2" ry="0.9" fill="#ff93b4"/>`);

export const GROUSE_SVG = svg(`
  <path d="M18.6 14.200l3.2-3.600M19.6 17l2.8-.6M18.8 19.400l2.4 1.6" stroke="${O}" stroke-width="2.2" stroke-linecap="round"/>
  <path d="M11.6 21.400c-5 0-8-3-8-7.400S7 6.4 11.6 6.4 19.6 9.6 19.6 14s-3 7.4-8 7.400z" fill="#a8673a" stroke="${O}" stroke-width="2" stroke-linejoin="round"/>
  <path d="M8.2 17.600c1.6 1.4 4.8 1.4 6.8 0M9 14.600c1.2.8 3.4.8 4.8 0" stroke="#7a4524" stroke-width="1.3" stroke-linecap="round" fill="none"/>
  <path d="M6.4 9.200c1.2-1.6 3.6-1.8 5-.2" fill="none" stroke="#e8453c" stroke-width="2.2" stroke-linecap="round"/>
  <path d="M3.6 11.600l-2.2 1.4 2.2 1.200z" fill="#ffc93c" stroke="${O}" stroke-width="1.4" stroke-linejoin="round"/>
  <circle cx="7.2" cy="12" r="1.2" fill="${O}"/>`);

// Step 58: charm icons (game/charms.js `icon`): a generic lilac gem for placeholders and Spark's golden starburst. Steps 59-61 add theirs here.
export const CHARM_SVG = svg(`<path d="M12 2.5 18.5 9 12 21.5 5.5 9z" fill="#c9a6ff" stroke="${O}" stroke-width="2" stroke-linejoin="round"/><path d="M5.5 9h13M9 9l3-6.5L15 9M9 9l3 12.5L15 9" fill="none" stroke="${O}" stroke-width="1.2" stroke-linejoin="round" opacity="0.55"/>`);
export const CHARM_FROST_SVG = svg(`<path d="M12 2.5v19M3.8 7.2l16.4 9.6M20.2 7.2 3.8 16.8" stroke="${O}" stroke-width="4.2" stroke-linecap="round"/><path d="M12 2.5v19M3.8 7.2l16.4 9.6M20.2 7.2 3.8 16.8" stroke="#8fdcff" stroke-width="2" stroke-linecap="round"/><path d="M9.6 4.8 12 7l2.4-2.2M9.6 19.2 12 17l2.4 2.2" fill="none" stroke="${O}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="2.4" fill="#eaf9ff" stroke="${O}" stroke-width="1.4"/>`);
export const CHARM_SPARK_SVG = svg(`<path d="M12 2.5 14.6 9.4 21.5 12 14.6 14.6 12 21.5 9.4 14.6 2.5 12 9.4 9.4z" fill="#ffd45e" stroke="${O}" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="12" r="2.2" fill="#fff6c9" stroke="${O}" stroke-width="1.2"/>`);

/** Name -> svg lookup for toast icons etc. (catalog.js adds one entry per item id, so hud.toast({icon:'apple'}) works too.) */
export const ICONS = {
  keyboard: KEYBOARD_SVG, gamepad: GAMEPAD_SVG, phone: PHONE_SVG, remote: PHONE_SVG, screen: SCREEN_SVG,
  speaker: SPEAKER_ON_SVG, muted: SPEAKER_OFF_SVG, music: MUSIC_ON_SVG, musicOff: MUSIC_OFF_SVG, sparkle: SPARKLE_SVG, berry: BERRY_SVG,
  sprout: SPROUT_SVG, seed: SEED_SVG, flame: FLAME_SVG, pot: POT_SVG, quest: QUEST_SVG, feast: FEAST_SVG, hat: HAT_SVG, bridge: BRIDGE_SVG, leave: LEAVE_SVG, split: SPLIT_SVG, back: BACK_SVG, camp: CAMP_SVG, fox: FOX_SVG, squirrel: SQUIRREL_SVG, rabbit: RABBIT_SVG, grouse: GROUSE_SVG,
  charm: CHARM_SVG, 'charm-spark': CHARM_SPARK_SVG, 'charm-frost-nova': CHARM_FROST_SVG,
};

// Step 50: the four tools (a storybook page's heart pills show the one a player holds) and a pressed-flower card (the page's three collectibles)
const HANDLE = '#b5793c';
export const AXE_SVG = svg(`<path d="M6 20 15 9" stroke="${O}" stroke-width="4.6" stroke-linecap="round"/><path d="M6 20 15 9" stroke="${HANDLE}" stroke-width="2.4" stroke-linecap="round"/><path d="M11 5c4-1.6 8 0 10 4-3.4 1.2-6.4 1.6-9.4.4-1.6-1.6-1.2-3.4-.6-4.4z" fill="#d9e2ec" stroke="${O}" stroke-width="1.8" stroke-linejoin="round"/>`);
export const HAMMER_SVG = svg(`<path d="M7 19 14 10" stroke="${O}" stroke-width="4.6" stroke-linecap="round"/><path d="M7 19 14 10" stroke="${HANDLE}" stroke-width="2.4" stroke-linecap="round"/><rect x="10" y="3.5" width="11" height="7" rx="1.6" transform="rotate(32 15.5 7)" fill="#b9c2cf" stroke="${O}" stroke-width="1.8" stroke-linejoin="round"/>`);
export const SHOVEL_SVG = svg(`<path d="M7 5 16 14" stroke="${O}" stroke-width="4.6" stroke-linecap="round"/><path d="M7 5 16 14" stroke="${HANDLE}" stroke-width="2.4" stroke-linecap="round"/><path d="M14 12.4c3-1.2 6 .4 7 3.2-1.6 3.6-5.6 4.6-7.6 2.4-1.4-1.4-1.4-4-.4-5.6z" fill="#d9e2ec" stroke="${O}" stroke-width="1.8" stroke-linejoin="round"/>`);
export const SWORD_SVG = svg(`<path d="M20 4 9 15" stroke="${O}" stroke-width="5" stroke-linecap="round"/><path d="M20 4 9 15" stroke="#eef4fa" stroke-width="2.6" stroke-linecap="round"/><path d="M6.5 11.5 12.5 17.5" stroke="${O}" stroke-width="4.4" stroke-linecap="round"/><path d="M6.5 11.5 12.5 17.5" stroke="#ffd85e" stroke-width="2.2" stroke-linecap="round"/><path d="M8 16 4.5 19.5" stroke="${O}" stroke-width="4" stroke-linecap="round"/><path d="M8 16 4.5 19.5" stroke="${HANDLE}" stroke-width="2" stroke-linecap="round"/>`);
export const FLOWER_CARD_SVG = svg(`<rect x="4.5" y="2.5" width="15" height="19" rx="2.5" fill="#fff4dc" stroke="${O}" stroke-width="2"/><g fill="#ff93c6" stroke="${O}" stroke-width="1.2"><circle cx="12" cy="7.4" r="2.1"/><circle cx="15.2" cy="10" r="2.1"/><circle cx="14" cy="13.6" r="2.1"/><circle cx="10" cy="13.6" r="2.1"/><circle cx="8.8" cy="10" r="2.1"/></g><circle cx="12" cy="10.8" r="1.7" fill="#ffd85e" stroke="${O}" stroke-width="1"/><path d="M12 15.6V19" stroke="#3f9a5a" stroke-width="1.8" stroke-linecap="round"/>`);

// Step 59: the slingshot (a wooden fork with a pink band and a pebble)
export const SLINGSHOT_SVG = svg(`<path d="M12 21v-8M12 13 6.5 5M12 13l5.500-8" stroke="${O}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 21v-8M12 13 6.500 5M12 13l5.500-8" stroke="${HANDLE}" stroke-width="2.800" stroke-linecap="round" stroke-linejoin="round"/><path d="M6.500 5.500Q12 11 17.500 5.500" fill="none" stroke="${O}" stroke-width="3" stroke-linecap="round"/><path d="M6.500 5.500Q12 11 17.500 5.500" fill="none" stroke="#ff6b8f" stroke-width="1.400" stroke-linecap="round"/><circle cx="12" cy="8.600" r="1.700" fill="#cfd6e6" stroke="${O}" stroke-width="1.200"/>`);
ICONS['tool-slingshot'] = SLINGSHOT_SVG;
// Step 60: the watering can, the Ember Seed charm and the four reactions (Douse, Frozen solid, Steam burst, Cool it!)
export const WATERING_CAN_SVG = svg(`<path d="M16.500 8.500 21.500 3.500" stroke="${O}" stroke-width="4.600" stroke-linecap="round"/><path d="M16.500 8.500 21.500 3.500" stroke="#2f86ad" stroke-width="2.400" stroke-linecap="round"/><path d="M19 2.500l3.500 3.500" stroke="${O}" stroke-width="3.800" stroke-linecap="round"/><path d="M19 2.500l3.500 3.500" stroke="#ff8fb5" stroke-width="1.800" stroke-linecap="round"/><path d="M4 9.500v8c0 1.600 1.400 2.500 3 2.500h7c1.600 0 3-.9 3-2.500v-8z" fill="#4fb3d9" stroke="${O}" stroke-width="2" stroke-linejoin="round"/><path d="M4 9.500c0-1.400 1.400-2 3.500-2h6c2.100 0 3.500.6 3.500 2" fill="#8fd8f0" stroke="${O}" stroke-width="2"/><path d="M4.300 11.500C1.800 11.500 1.500 16 4 16" fill="none" stroke="${O}" stroke-width="3.400" stroke-linecap="round"/><path d="M4.300 11.500C1.800 11.500 1.500 16 4 16" fill="none" stroke="#b5793c" stroke-width="1.600" stroke-linecap="round"/><path d="M14 11.500l2.500-2.500" stroke="${O}" stroke-width="3.800" stroke-linecap="round"/><path d="M14 11.500l2.500-2.500" stroke="#2f86ad" stroke-width="1.800" stroke-linecap="round"/>`);
ICONS['tool-watering-can'] = WATERING_CAN_SVG;
export const CHARM_EMBER_SVG = svg(`<path d="M12 2.500c1 3.500 5.500 5.500 5.500 10.500a5.500 5.500 0 0 1-11 0c0-2.200 1-3.600 2.200-4.800.2 1.600.9 2.600 1.800 3 .1-3.200.5-6.500 1.500-8.700z" fill="#ff8a3d" stroke="${O}" stroke-width="2" stroke-linejoin="round"/><path d="M12 10.500c.8 1.600 2.200 2.400 2.200 4.200a2.200 2.200 0 0 1-4.400 0c0-1.200.8-2 1.200-2.800.5.600.8.800 1 .8z" fill="#ffe27a" stroke="${O}" stroke-width="1.400" stroke-linejoin="round"/>`);
ICONS['charm-ember-seed'] = CHARM_EMBER_SVG;
const REACT_DROP = `<path d="M8 3.500c1 3 4.200 5 4.200 8.400a4.200 4.200 0 0 1-8.400 0C3.800 8.500 7 6.500 8 3.500z" fill="#6cc4ff" stroke="${O}" stroke-width="1.800" stroke-linejoin="round"/>`;
ICONS['reaction-douse'] = svg(`${REACT_DROP}<path d="M16.500 8c.8 2.400 3.600 3.800 3.600 6.800a3.600 3.600 0 0 1-7.200 0c0-2 1-3 1.800-4 .2 1 .6 1.600 1.200 1.800.2-1.800.2-3.400.6-4.600z" fill="#ff8a3d" stroke="${O}" stroke-width="1.600" stroke-linejoin="round"/><path d="M5 20.500c1-1.200 1-2.200 0-3.400M9 21.500c1-1.200 1-2.200 0-3.400" stroke="${O}" stroke-width="1.400" stroke-linecap="round" fill="none" opacity="0.6"/>`);
ICONS['reaction-frozen-solid'] = svg(`<path d="M12 2.500 20 7v10l-8 4.500L4 17V7z" fill="#bfe9ff" stroke="${O}" stroke-width="2" stroke-linejoin="round"/><path d="M12 2.500v19M4 7l16 10M20 7 4 17" stroke="#6cc4ff" stroke-width="1.400" opacity="0.8"/><path d="M12 8.500c.7 1.500 2.400 2.400 2.400 4.200a2.400 2.400 0 0 1-4.800 0c0-1.800 1.700-2.700 2.400-4.200z" fill="#6cc4ff" stroke="${O}" stroke-width="1.400" stroke-linejoin="round"/>`);
ICONS['reaction-steam'] = svg(`<path d="M6 21c-2.500 0-3-3.500-.5-4.500 0-3 3.500-4 5.500-2.300C12.500 12 16.500 12.800 16.500 16c2.300.5 2.600 5-.5 5z" fill="#f4f9ff" stroke="${O}" stroke-width="2" stroke-linejoin="round"/><path d="M8 11c-1.400-1.800 1.400-3 0-5M13 11c-1.400-1.800 1.400-3 0-5M18 12c-1.400-1.800 1.400-3 0-5" fill="none" stroke="${O}" stroke-width="1.800" stroke-linecap="round"/>`);
ICONS['reaction-cool'] = svg(`<path d="M3.500 18c0-5 2.200-9.500 8.500-9.500s8.500 4.500 8.500 9.500z" fill="#8f8a9c" stroke="${O}" stroke-width="2" stroke-linejoin="round"/><path d="M8 18l1.500-5 2 3 2-4 1.500 6" fill="none" stroke="#ff8a3d" stroke-width="1.800" stroke-linejoin="round" stroke-linecap="round"/><path d="M12 2.500v4.500M9.500 4.200 12 7l2.500-2.800" fill="none" stroke="#6cc4ff" stroke-width="2.200" stroke-linecap="round" stroke-linejoin="round"/>`);
// Step 72a: the Glowline Rod -- a reed rod bending to the right, a glowing cyan line and a little glowcap bobber
export const ROD_SVG = svg(`<path d="M4.600 20.400 15.600 4.800" stroke="${O}" stroke-width="4.400" stroke-linecap="round"/><path d="M4.600 20.400 15.600 4.800" stroke="#c9b36a" stroke-width="2.200" stroke-linecap="round"/><path d="M15.600 4.800c1.800.4 3.200 1.800 3.800 3.800" fill="none" stroke="${O}" stroke-width="3" stroke-linecap="round"/><path d="M15.600 4.800c1.800.4 3.200 1.800 3.800 3.800" fill="none" stroke="#6ff3ff" stroke-width="1.200" stroke-linecap="round"/><path d="M19.400 8.600v4" stroke="#6ff3ff" stroke-width="1.200" stroke-linecap="round"/><path d="M16.600 15.400a2.800 2.200 0 0 1 5.600 0z" fill="#ff8a3c" stroke="${O}" stroke-width="1.600" stroke-linejoin="round"/><path d="M18.200 15.600v2.600h2.400v-2.600" fill="#f4f1ff" stroke="${O}" stroke-width="1.400" stroke-linejoin="round"/>`);
ICONS['tool-axe'] = AXE_SVG; ICONS['tool-hammer'] = HAMMER_SVG; ICONS['tool-shovel'] = SHOVEL_SVG; ICONS['tool-sword'] = SWORD_SVG; ICONS['tool-rod'] = ROD_SVG; ICONS.flowerCard = FLOWER_CARD_SVG;
ICONS.book = BOOK_SVG;
ICONS.heart = HEART_SVG;

// Day/night clock icons (also used in phase-change toasts).
export const SUN_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><g stroke="#7f531e" stroke-width="2" stroke-linecap="round"><path d="M12 1v2m0 18v2M1 12h2m18 0h2M4 4l1.5 1.5m13 13L20 20M4 20l1.5-1.5m13-13L20 4"/><circle cx="12" cy="12" r="6" fill="#ffd54a"/></g></svg>';
export const MOON_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="#e1eaff" stroke="#4f5c95" stroke-width="2"/><g fill="#a5b5d6"><circle cx="9" cy="8" r="2"/><circle cx="15" cy="14" r="2.5"/><circle cx="8" cy="16" r="1.4"/></g></svg>';

// ---- Tail icons (Step 36a): one per tail, for toasts, the reveal row and the tail stump menu (36b). TAIL_ICONS[id] with the ids of player/tails.js
// ('fox-1' ... 'grouse-3'); also reachable as ICONS['tail-fox-1'] etc. Level 3 is the rainbow version of the same shape.
export const TAIL_RAINBOW = ['#ff5a5a', '#ff9a3c', '#ffe14a', '#5ed16a', '#4aa8ff', '#a06bff'];
const TAIL_ICON_COLORS = {
  fox:      { 1: { body: '#f27d2a', tip: '#fff6ea' }, 2: { body: '#dde6ef', tip: '#ffffff' }, 3: { rainbow: true, tip: '#ffffff' } },
  squirrel: { 1: { body: '#b9582c', tip: '#e4a070' }, 2: { body: '#8e95a3', tip: '#d0d5de' }, 3: { rainbow: true } },
  rabbit:   { 1: { body: '#ffffff' }, 2: { body: '#c98a4a' }, 3: { rainbow: true } },
  grouse:   { 1: { body: '#a8673a', tip: '#eadfc8' }, 2: { body: '#f4f6fa', tip: '#4a4458' }, 3: { rainbow: true } },
};
function tailIcon(species, level) {
  const c = TAIL_ICON_COLORS[species][level], id = `tg-${species}-${level}`;
  const stops = (list) => list.map((k, i) => `<stop offset="${(i / list.length).toFixed(3)}" stop-color="${k}"/><stop offset="${((i + 1) / list.length).toFixed(3)}" stop-color="${k}"/>`).join('');
  const grad = (list) => `<defs><linearGradient id="${id}" x1="0.1" y1="0.9" x2="0.9" y2="0.1">${stops(list)}</linearGradient></defs>`;
  if (species === 'fox') {
    const fill = `url(#${id})`;
    const list = c.rainbow ? [...TAIL_RAINBOW.slice(0, 5).flatMap((k) => [k]), c.tip] : [c.body, c.body, c.body, c.body, c.body, c.tip];
    return svg(`${grad(list)}<path d="M3.6 20.6C3 11.4 9.6 3.6 20.4 3.4 20.8 13 15.4 21 3.6 20.6z" fill="${fill}" stroke="${O}" stroke-width="2" stroke-linejoin="round"/>`);
  }
  if (species === 'squirrel') {
    const list = c.rainbow ? TAIL_RAINBOW : [c.body, c.body, c.body, c.body, c.body, c.tip];
    return svg(`${grad(list)}<path d="M4.6 21.2C2.6 15.600 8 14.400 9.200 10.400 10.400 6.400 6 5.200 6.400 2.800 13 1.800 20.600 5.600 20.400 12.800 20.200 18 15 21.800 4.600 21.200z" fill="url(#${id})" stroke="${O}" stroke-width="2" stroke-linejoin="round"/>`);
  }
  if (species === 'rabbit') {
    const circles = '<circle cx="12" cy="13" r="7.600"/><circle cx="7.400" cy="9.400" r="4"/><circle cx="16.600" cy="9.200" r="4"/><circle cx="12" cy="6.400" r="3.600"/><circle cx="8" cy="17.600" r="3.600"/><circle cx="16.200" cy="17.600" r="3.600"/>';
    const list = c.rainbow ? TAIL_RAINBOW : [c.body];
    return svg(`${grad(list.length > 1 ? list : [c.body, c.body])}<g fill="${O}" stroke="${O}" stroke-width="3.400" stroke-linejoin="round">${circles}</g><g fill="url(#${id})">${circles}</g>`);
  }
  const feathers = [-52, -26, 0, 26, 52].map((a, i) => {
    const fill = c.rainbow ? TAIL_RAINBOW[[0, 1, 2, 3, 4][i]] : c.body;
    return `<g transform="rotate(${a} 12 22)"><ellipse cx="12" cy="12.400" rx="3" ry="9" fill="${fill}" stroke="${O}" stroke-width="1.800"/>${c.tip ? `<ellipse cx="12" cy="4.800" rx="2" ry="1.800" fill="${c.tip}"/>` : ''}</g>`;
  }).join('');
  return svg(feathers);
}
export const TAIL_ICONS = {};
for (const species of ['fox', 'squirrel', 'rabbit', 'grouse']) {
  for (const level of [1, 2, 3]) { const id = `${species}-${level}`; TAIL_ICONS[id] = tailIcon(species, level); ICONS['tail-' + id] = TAIL_ICONS[id]; }
}

// ---- Flower seed-packet icons (Step 38a): one per Night-Bloom flower (game/flowers.js), for the "Found Moon Orchid seeds!" toast and Mossback's list. FLOWER_ICONS[id] (also ICONS['seed-' + id]):
// a little paper packet with a flap and the flower drawn on its front in the flower's colours.
function flowerBloom(f) {
  const [a, b] = f.petals, cx = 12, cy = 14.2;
  const centre = `<circle cx="${cx}" cy="${cy}" r="1.5" fill="${f.centre}" stroke="${O}" stroke-width="1"/>`;
  if (f.shape === 'star') {
    return [0, 60, 120].map((r) => `<ellipse cx="${cx}" cy="${cy}" rx="1.9" ry="5.2" transform="rotate(${r} ${cx} ${cy})" fill="${r === 60 ? b : a}" stroke="${O}" stroke-width="1"/>`).join('') + centre;
  }
  if (f.shape === 'bell') {
    return `<path d="M7.6 16.8c0-4 1.8-6.800 4.400-6.800s4.400 2.800 4.400 6.800c-1.400.8-2.900 1.100-4.400 1.100s-3-.3-4.400-1.100z" fill="${a}" stroke="${O}" stroke-width="1.200" stroke-linejoin="round"/><circle cx="12" cy="18.600" r="1.100" fill="${f.centre}" stroke="${O}" stroke-width="1"/>`;
  }
  if (f.shape === 'fern') {
    return `<path d="M12 19V9.600" stroke="${O}" stroke-width="1.400" stroke-linecap="round"/>` + [10.800, 13.400, 16].map((y, i) => `<path d="M12 ${y}c-${2.800 - i * 0.4} -.4-4-1.400-4.400-3.200 2.400-.2 4 .8 4.400 3.200z" fill="${i % 2 ? b : a}" stroke="${O}" stroke-width="1" stroke-linejoin="round"/><path d="M12 ${y}c${2.800 - i * 0.4} -.4 4-1.400 4.400-3.200-2.400-.2-4 .8-4.400 3.200z" fill="${i % 2 ? a : b}" stroke="${O}" stroke-width="1" stroke-linejoin="round"/>`).join('');
  }
  if (f.shape === 'starfruit') {
    return `<path d="M12 9.200l1.700 3.400 3.700.5-2.700 2.600.7 3.700L12 17.600l-3.400 1.800.7-3.700-2.700-2.600 3.700-.5z" fill="${a}" stroke="${O}" stroke-width="1.200" stroke-linejoin="round"/><circle cx="12" cy="14.400" r="1.100" fill="${f.centre}"/>`;
  }
  return [0, 72, 144, 216, 288].map((r, i) => `<ellipse cx="${cx}" cy="${cy - 3}" rx="2.300" ry="2.900" transform="rotate(${r} ${cx} ${cy})" fill="${i % 2 ? b : a}" stroke="${O}" stroke-width="1"/>`).join('') + centre;
}
function seedPacketIcon(f) {
  return svg(`
  <path d="M5.400 3.200h13.200v18.200H5.400z" fill="#fff6e0" stroke="${O}" stroke-width="2" stroke-linejoin="round"/>
  <path d="M5.400 3.200h13.200v4.200H5.400z" fill="${f.petals[0]}" stroke="${O}" stroke-width="2" stroke-linejoin="round"/>
  <path d="M7.400 5.300h2M11 5.300h2M14.600 5.300h2" stroke="#fff" stroke-width="1.200" stroke-linecap="round"/>
  ${flowerBloom(f)}`);
}
export const FLOWER_ICONS = {};
for (const f of FLOWERS) { FLOWER_ICONS[f.id] = seedPacketIcon(f); ICONS['seed-' + f.id] = FLOWER_ICONS[f.id]; }

// Neck garlands: a ring of blossoms, coloured independently for each level.
export const GARLAND_ICONS = {};
for (const f of FLOWERS) for (const level of [1, 2, 3]) {
  const colours = level === 3 ? TAIL_RAINBOW : level === 2 ? (f.id === 'moon-orchid' ? ['#ffc94a', '#fff2a8'] : ['#fff9ee', f.petals[0]]) : f.petals;
  const blossoms = Array.from({ length: 8 }, (_, i) => {
    const a = i * Math.PI / 4, x = 12 + Math.cos(a) * 7, y = 12 + Math.sin(a) * 6;
    return '<g transform="translate(' + (x - 12) + ' ' + (y - 14.2) + ') translate(12 14.2) scale(.42) translate(-12 -14.2)">' + flowerBloom({ ...f, petals: [colours[i % colours.length], colours[(i + 1) % colours.length]] }) + '</g>';
  }).join('');
  const id = f.id + '-' + level;
  GARLAND_ICONS[id] = svg('<ellipse cx="12" cy="12" rx="7" ry="6" fill="none" stroke="#58a754" stroke-width="2"/>' + blossoms);
  ICONS['garland-' + id] = GARLAND_ICONS[id];
}

// Storybook stickers (Step 52a, the Journal's Storybook tab): one little picture per page (game/pages/*.js `sticker`), a gold secret star and the chapter badge rosette.
export const STICKER_SVG = {
  hop: svg(`<path d="M12 7c0-2.4 1.6-4 4-4 0 2.4-1.6 4-4 4z" fill="#58c96b" stroke="${O}" stroke-width="1.6" stroke-linejoin="round"/><circle cx="12" cy="14" r="7.4" fill="#ff5d73" stroke="${O}" stroke-width="2"/><circle cx="9.4" cy="11.6" r="1.7" fill="#ffd0d8"/>`),
  axe: AXE_SVG,
  kite: svg(`<path d="M12 2.5l7 8.2-7 7.8-7-7.8z" fill="#ff7c6b" stroke="${O}" stroke-width="2" stroke-linejoin="round"/><path d="M12 2.5v16M5 10.7h14" stroke="${O}" stroke-width="1.4"/><path d="M12 18.5c-1.6 1.2-1.6 2.6 0 3.2s1.6 1.4 0 2" fill="none" stroke="${O}" stroke-width="1.6" stroke-linecap="round"/><circle cx="10.4" cy="21.2" r="1.3" fill="#ffd85e" stroke="${O}" stroke-width="1"/>`),
  tide: svg(`<path d="M2 15c2.2-3 4.4-3 6.5 0s4.4 3 6.5 0 4.4-3 6.5 0V22H2z" fill="#6cc3ff" stroke="${O}" stroke-width="2" stroke-linejoin="round"/><path d="M2 9.6c2.2-3 4.4-3 6.5 0s4.4 3 6.5 0 4.4-3 6.5 0" fill="none" stroke="${O}" stroke-width="2" stroke-linecap="round"/><circle cx="17.5" cy="5" r="2.6" fill="#ffd85e" stroke="${O}" stroke-width="1.6"/>`),
  orchard: svg(`<path d="M4.5 11h15l-1.6 9H6.1z" fill="#d49a5a" stroke="${O}" stroke-width="2" stroke-linejoin="round"/><circle cx="8.6" cy="9" r="3" fill="#ff5d73" stroke="${O}" stroke-width="1.6"/><circle cx="14.4" cy="8.4" r="3" fill="#ff93c6" stroke="${O}" stroke-width="1.6"/><circle cx="11.6" cy="5.6" r="2.8" fill="#ffd85e" stroke="${O}" stroke-width="1.6"/>`),
  flake: svg(`<circle cx="12" cy="12" r="9.6" fill="#bfe6ff" stroke="${O}" stroke-width="2"/><path d="M12 4.2v15.6M5.2 8.1l13.6 7.8M5.2 15.9l13.6-7.8" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round"/><path d="M9.6 5.2L12 7.4l2.4-2.2M9.6 18.8L12 16.6l2.4 2.2" fill="none" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`),
  sled: svg(`<path d="M3 17.5h16.5c1.6 0 2.4-1.2 1.6-2.6" fill="none" stroke="${O}" stroke-width="2.6" stroke-linecap="round"/><path d="M3.6 17.5h15.8" stroke="#c9c2e0" stroke-width="1.2" stroke-linecap="round"/><path d="M5.5 14.4h12.2l-.8-3.6H6.3z" fill="#ff7c6b" stroke="${O}" stroke-width="2" stroke-linejoin="round"/><path d="M7.5 14.4v3.1M15.5 14.4v3.1" stroke="${O}" stroke-width="2"/><circle cx="11.4" cy="7.4" r="2.6" fill="#ffd85e" stroke="${O}" stroke-width="1.8"/>`),
  spring: svg(`<path d="M2.6 14c0 5 4 7.8 9.4 7.8s9.4-2.8 9.4-7.8z" fill="#8d8a96" stroke="${O}" stroke-width="2" stroke-linejoin="round"/><ellipse cx="12" cy="14" rx="9.4" ry="3" fill="#6cc3ff" stroke="${O}" stroke-width="2"/><path d="M8.4 10.4c-1.6-1.8 1.6-3 0-5M12.4 10c-1.6-2 1.6-3.4 0-5.6M16.4 10.4c-1.6-1.8 1.6-3 0-5" fill="none" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round"/>`),
  vine: svg(`<path d="M12 2c-1.4 5 2.4 8 0 13" fill="none" stroke="${O}" stroke-width="4.2" stroke-linecap="round"/><path d="M12 2c-1.4 5 2.4 8 0 13" fill="none" stroke="#7ab648" stroke-width="2" stroke-linecap="round"/><path d="M12.8 7.4c3.2-2.2 5.4 0 5.4 0-1 3.2-4.2 3.2-5.4 0zM10.8 11.4c-3.2-1.6-5.4.6-5.4.6 1 3.2 4.2 2.6 5.4 0z" fill="#58cf72" stroke="${O}" stroke-width="1.6" stroke-linejoin="round"/><circle cx="12" cy="18.6" r="3.2" fill="#a8723f" stroke="${O}" stroke-width="2"/>`),
  canoe: svg(`<path d="M2.6 12.6c3 5.4 15.8 5.4 18.8 0z" fill="#b57a4e" stroke="${O}" stroke-width="2" stroke-linejoin="round"/><path d="M2.6 12.6l-1.4-3.2M21.4 12.6l1.4-3.2" stroke="${O}" stroke-width="2" stroke-linecap="round"/><path d="M5.2 15.4c3.2 1.8 10.4 1.8 13.6 0" fill="none" stroke="#ffd85e" stroke-width="1.6" stroke-linecap="round"/><path d="M12 12.4V5.4" stroke="${O}" stroke-width="2" stroke-linecap="round"/><path d="M12 5.4l4 1.6-4 1.6z" fill="#ff7c6b" stroke="${O}" stroke-width="1.4" stroke-linejoin="round"/><path d="M2.6 20c2.2-1.8 4.4-1.8 6.4 0s4.2 1.8 6.4 0 4.2-1.6 6 0" fill="none" stroke="#6cc3ff" stroke-width="2.2" stroke-linecap="round"/>`),
  lavaRise: svg(`<path d="M2.4 21 10.6 4.8l3 5.2 2.2-3.2 6 14.2z" fill="#8d5a44" stroke="${O}" stroke-width="2" stroke-linejoin="round"/><path d="M1.8 21.4c2.6-3.4 4.4 1.6 7.2-1.2s5 2.4 7.6-.6 3.2-.6 5.6.6v3.2H1.8z" fill="#ff7a2a" stroke="${O}" stroke-width="1.8" stroke-linejoin="round"/><path d="M9.6 9.4l1.2 2 1.2-2.4" fill="none" stroke="#ffc04a" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`),
  volcano: svg(`<path d="M3.2 21.4 8.4 9.4h7.2l5.2 12z" fill="#8d5a44" stroke="${O}" stroke-width="2" stroke-linejoin="round"/><path d="M8.4 9.4l1.6 2 2-2.2 2 2.2 1.6-2" fill="#ff7a2a" stroke="${O}" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12.4" cy="5.2" r="2.2" fill="#e6e9ee" stroke="${O}" stroke-width="1.6"/><circle cx="15.4" cy="2.8" r="1.4" fill="#f4f5f8" stroke="${O}" stroke-width="1.4"/><circle cx="10.6" cy="14.6" r="0.9" fill="#2b2340"/><circle cx="13.8" cy="14.6" r="0.9" fill="#2b2340"/><path d="M10.8 17.2c.8.6 1.8.6 2.6 0" fill="none" stroke="#2b2340" stroke-width="1.2" stroke-linecap="round"/>`),
  aurora: svg(`<circle cx="12" cy="12" r="9.8" fill="#2b2f6a" stroke="${O}" stroke-width="2"/><path d="M3.4 14c3-5 5.6-5 8.6-1s5.6 4 8.6-1" fill="none" stroke="#4dffb0" stroke-width="3" stroke-linecap="round"/><path d="M4.6 9.6c2.6-3 5-3 7.4-.6s4.8 2.6 7.4-.4" fill="none" stroke="#b06bff" stroke-width="2" stroke-linecap="round" opacity="0.9"/><circle cx="17.4" cy="5.8" r="1.1" fill="#ffffff"/><circle cx="6.4" cy="5.2" r="0.9" fill="#ffffff"/>`),
  sun: svg(`<circle cx="12" cy="12" r="5" fill="#ffd85e" stroke="${O}" stroke-width="2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1" stroke="${O}" stroke-width="2" stroke-linecap="round"/>`),
};
export const SECRET_STAR_SVG = svg(`<path d="M12 2.6l2.8 6 6.5.7-4.9 4.4 1.4 6.4L12 16.7 6.2 20.1l1.4-6.4L2.7 9.3l6.5-.7z" fill="#ffd85e" stroke="${O}" stroke-width="2" stroke-linejoin="round"/>`);
export const BADGE_SVG = svg(`<path d="M8 14l-2.4 8 6.4-3 6.4 3-2.4-8" fill="#ff7c6b" stroke="${O}" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="9" r="7" fill="#ffd85e" stroke="${O}" stroke-width="2"/><circle cx="12" cy="9" r="4" fill="#fff4dc" stroke="${O}" stroke-width="1.4"/><path d="M12 6.2l1 2.1 2.2.2-1.7 1.5.5 2.2-2-1.2-2 1.2.5-2.2-1.7-1.5 2.2-.2z" fill="#ff93c6"/>`);
ICONS.badge = BADGE_SVG; ICONS.secretStar = SECRET_STAR_SVG;

// Step 73b: Capray's quest line and the pet stable. A tiny manta (violet back, golden fin edges, a cyan-spotted mushroom cap on its tail), the dark shade moss, a "..." thought, and a locked pet's silhouette.
export const PET_CAPRAY_SVG = svg(`<path d="M12 18.500c0 1.800.800 3 2.200 3.600" fill="none" stroke="${O}" stroke-width="2.400" stroke-linecap="round"/><path d="M12 18.500c0 1.800.800 3 2.200 3.600" fill="none" stroke="#9ff2ff" stroke-width="1" stroke-linecap="round"/><path d="M12 4 21.500 11.500c-2.400 1.600-5.600 2.500-9.500 2.500s-7.100-.9-9.500-2.500z" fill="#4e45b6" stroke="${O}" stroke-width="2" stroke-linejoin="round"/><path d="M4 11.500c2.400 1.300 5 2 8 2s5.600-.7 8-2" fill="none" stroke="#ffab3d" stroke-width="1.600" stroke-linecap="round"/><circle cx="9.600" cy="9.400" r="1.500" fill="#2b1a10"/><circle cx="14.400" cy="9.400" r="1.500" fill="#2b1a10"/><circle cx="9.200" cy="8.900" r=".5" fill="#fff"/><circle cx="14" cy="8.900" r=".5" fill="#fff"/><path d="M12 6.200c-.8-.2-.8-1.400 0-1.600.8.200.8 1.400 0 1.600z" fill="#9ff2ff"/>`);
export const SHADE_MOSS_SVG = svg(`<path d="M3 20c-.5-4 1-7 3.500-8.200C6 9 8 7.200 10.500 7.800 12 5.800 15 6 16.200 8.200c2.600.2 4.600 2.600 4.300 5.600 1 1.400 1 3.600.5 6.200z" fill="#33503c" stroke="${O}" stroke-width="2" stroke-linejoin="round"/><circle cx="9" cy="13" r="1.800" fill="#4f7a58"/><circle cx="14.600" cy="12" r="1.500" fill="#4f7a58"/><circle cx="12" cy="16.600" r="1.700" fill="#26382f"/>`);
export const THOUGHT_DOTS_SVG = svg(`<circle cx="5.500" cy="12" r="2.200" fill="${O}"/><circle cx="12" cy="12" r="2.200" fill="${O}"/><circle cx="18.500" cy="12" r="2.200" fill="${O}"/>`);
export const PET_LOCKED_SVG = svg(`<path d="M12 4 21.500 11.500c-2.400 1.600-5.600 2.500-9.500 2.500s-7.100-.9-9.500-2.500z" fill="#5a5470" stroke="${O}" stroke-width="2" stroke-linejoin="round"/><path d="M12 18.500c0 1.800.800 3 2.200 3.600" fill="none" stroke="${O}" stroke-width="2.400" stroke-linecap="round"/><path d="M11 8.200c0-1.400 2.200-1.400 2.200 0 0 1-1.100 1-1.100 2" fill="none" stroke="#d6d0ea" stroke-width="1.400" stroke-linecap="round"/><circle cx="12.100" cy="11.600" r=".7" fill="#d6d0ea"/>`);
ICONS['pet-capray'] = PET_CAPRAY_SVG; ICONS['shade-moss'] = SHADE_MOSS_SVG; ICONS['thought-dots'] = THOUGHT_DOTS_SVG; ICONS['pet-locked'] = PET_LOCKED_SVG;

// Step 80a: Party Games. One icon per game (Vine Skip: a glowing vine loop over two posts; Timber Trim: a log with an axe), a star, a robot head for the bots, a party popper, a trophy, and the button caps of the
// how-to card (keyCap / padButton / touchButton are builders: the label goes inside, `color` is the cap).
export const PARTY_VINESKIP_SVG = svg(`<path d="M3.2 21V10.4M20.8 21V10.4" stroke="${O}" stroke-width="5" stroke-linecap="round"/><path d="M3.2 21V10.4M20.8 21V10.4" stroke="#8d6a8f" stroke-width="2.6" stroke-linecap="round"/><path d="M3.2 10.4C6 3.2 18 3.2 20.8 10.4" fill="none" stroke="${O}" stroke-width="4.4" stroke-linecap="round"/><path d="M3.2 10.4C6 3.2 18 3.2 20.8 10.4" fill="none" stroke="#ff8fd0" stroke-width="2.4" stroke-linecap="round"/><circle cx="8.4" cy="5.7" r="1.3" fill="#ffd85e"/><circle cx="15.6" cy="5.7" r="1.3" fill="#ffd85e"/><circle cx="12" cy="4.6" r="1.3" fill="#ffd85e"/><path d="M9 21c.6-3.4 1.8-5 3-5s2.400 1.600 3 5" fill="#fff" stroke="${O}" stroke-width="1.800" stroke-linejoin="round"/>`);
export const PARTY_TIMBER_SVG = svg(`<rect x="2.4" y="12" width="19.200" height="8.400" rx="4.200" fill="#b57a4e" stroke="${O}" stroke-width="2"/><ellipse cx="19" cy="16.200" rx="2.400" ry="3.600" fill="#f0c88f" stroke="${O}" stroke-width="1.600"/><path d="M6 14.600c2.200.8 4.200.8 6.400 0M5.600 18c2.600.8 5 .8 7.600 0" fill="none" stroke="#8a5a3c" stroke-width="1.400" stroke-linecap="round"/><path d="M5 10 12 2.800" stroke="${O}" stroke-width="4.400" stroke-linecap="round"/><path d="M5 10 12 2.800" stroke="#b5793c" stroke-width="2.200" stroke-linecap="round"/><path d="M10.400 1.800c3.600-.6 7 1.600 8 5.200-3.200.4-6.200-.2-8.400-2.200z" fill="#d9e2ec" stroke="${O}" stroke-width="1.800" stroke-linejoin="round"/>`);
export const PARTY_MARLOSAYS_SVG = svg(`<path d="M5 2.600V21.400M16 2.600V21.400" stroke="${O}" stroke-width="4.400" stroke-linecap="round"/><path d="M5 2.600V21.400M16 2.600V21.400" stroke="#e8d8b8" stroke-width="2.200" stroke-linecap="round"/><path d="M5.800 3.800h8.200l-2 3.200 2 3.200H5.800z" fill="#ff4d5e" stroke="${O}" stroke-width="1.800" stroke-linejoin="round"/><path d="M16.800 8.600h5.600l-1.800 3 1.800 3h-5.600z" fill="#2fcf5a" stroke="${O}" stroke-width="1.800" stroke-linejoin="round"/><circle cx="8.400" cy="6.900" r="1" fill="#fff"/><path d="M2.400 21.600h19.200" stroke="${O}" stroke-width="2" stroke-linecap="round"/>`);
export const PARTY_HUDDLE_SVG = svg(`<ellipse cx="12" cy="13.600" rx="6.800" ry="8" fill="#b8844c" stroke="${O}" stroke-width="2"/><path d="M6.200 12c3.600 2.600 8 2.600 11.600 0M6.600 16.200c3.200 2.200 7.600 2.200 10.800 0M9.200 8.800l2.800 3 2.800-3M8.600 19.600l3.400-3 3.400 3" fill="none" stroke="#7a5230" stroke-width="1.600" stroke-linecap="round" stroke-linejoin="round"/><path d="M6.400 8.600C7.400 4.800 9.600 2.800 12 2.800s4.600 2 5.600 5.800c-1.400.8-2.600-.4-3.800.4s-2-.6-3.800 0-2.400-.8-3.600-.4z" fill="#fff" stroke="${O}" stroke-width="1.800" stroke-linejoin="round"/>`);
export const PARTY_SIZZLE_SVG = svg(`<path d="M12 3c1.600 1.800 4.400 3.200 4.400 7.200 0 3.600-2 5.400-4.400 5.400s-4.400-1.800-4.400-5.400C7.600 7.400 10 6 12 3z" fill="#ff8a2a" stroke="${O}" stroke-width="2" stroke-linejoin="round"/><path d="M12 8.400c.9 1 2 1.600 2 3.200a2 2 0 01-4 0c0-1.400 1.200-2.200 2-3.200z" fill="#ffe27a"/><path d="M5.200 20.400h13.600" stroke="${O}" stroke-width="2.600" stroke-linecap="round"/><path d="M6.400 20.400l2-2.400M17.600 20.400l-2-2.400" stroke="#b57a4e" stroke-width="1.600" stroke-linecap="round"/>`);
export const PARTY_EGGS_SVG = svg(`<path d="M12 2.800c3.600 0 6 5.200 6 9.200 0 3.600-2.600 6-6 6s-6-2.400-6-6c0-4 2.400-9.200 6-9.200z" fill="#fff6e4" stroke="${O}" stroke-width="2" stroke-linejoin="round"/><circle cx="10" cy="11" r="1" fill="#e8d6b4"/><circle cx="14" cy="14" r="1.200" fill="#e8d6b4"/><path d="M5 21.200h14" stroke="${O}" stroke-width="2.600" stroke-linecap="round"/><path d="M16.400 4.800l1.200-2M18.600 7.400l2-1" stroke="#ffd23a" stroke-width="1.600" stroke-linecap="round"/>`);
export const STAR_SVG = svg(`<path d="M12 2.600l2.800 6 6.500.7-4.900 4.400 1.400 6.400L12 16.700 6.200 20.100l1.400-6.400L2.700 9.300l6.500-.7z" fill="#ffd85e" stroke="${O}" stroke-width="2" stroke-linejoin="round"/><path d="M12 6.400l1.200 2.700 2.900.3-2.200 2" fill="none" stroke="#fff4c4" stroke-width="1.400" stroke-linecap="round"/>`);
export const BOT_SVG = svg(`<path d="M12 2.600V5.400" stroke="${O}" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="2.600" r="1.500" fill="#ff8fbe" stroke="${O}" stroke-width="1.200"/><rect x="3.800" y="5.400" width="16.400" height="13.600" rx="5" fill="#fff" stroke="${O}" stroke-width="2"/><circle cx="8.800" cy="11.400" r="2" fill="${O}"/><circle cx="15.200" cy="11.400" r="2" fill="${O}"/><circle cx="9.300" cy="10.800" r=".7" fill="#fff"/><circle cx="15.700" cy="10.800" r=".7" fill="#fff"/><path d="M9.600 15.400c1.400 1.200 3.400 1.200 4.800 0" fill="none" stroke="${O}" stroke-width="1.800" stroke-linecap="round"/><path d="M1.800 11v3.200M22.200 11v3.200" stroke="${O}" stroke-width="2.400" stroke-linecap="round"/>`);
export const POPPER_SVG = svg(`<path d="M3 21 8.200 7.200l8.600 8.600z" fill="#ffd85e" stroke="${O}" stroke-width="2" stroke-linejoin="round"/><path d="M6.400 12.400l5.200 5.200M4.600 17.200l2.200 2.200" stroke="#ff7c6b" stroke-width="1.800" stroke-linecap="round"/><path d="M14 4.200v2.400M19.800 9v2.400M17 2.800l-.8 1.400M20.800 5.600l-1.600.6" stroke="#ff8fbe" stroke-width="2" stroke-linecap="round"/><circle cx="18.600" cy="14.800" r="1.200" fill="#6cc3ff"/><circle cx="11.600" cy="3.400" r="1.100" fill="#7fe3b0"/>`);
export const TROPHY_SVG = svg(`<path d="M7 3.600h10v6.400c0 3-2.200 5-5 5s-5-2-5-5z" fill="#ffd85e" stroke="${O}" stroke-width="2" stroke-linejoin="round"/><path d="M7 5.600H4c0 3.400 1.400 5 3.600 5.400M17 5.600h3c0 3.400-1.400 5-3.600 5.400" fill="none" stroke="${O}" stroke-width="2" stroke-linecap="round"/><path d="M12 15v3.600M8.200 21h7.600M9.400 18.600h5.200" stroke="${O}" stroke-width="2.200" stroke-linecap="round"/><path d="M9.800 6.200v3.600" stroke="#fff4c4" stroke-width="1.600" stroke-linecap="round"/>`);
export const STICK_SVG = svg(`<circle cx="12" cy="12" r="9.600" fill="#dfe6f2" stroke="${O}" stroke-width="2"/><circle cx="12" cy="12" r="4.800" fill="#fff" stroke="${O}" stroke-width="2"/><path d="M12 1.800 9.600 4.600h4.800zM12 22.200l-2.400-2.800h4.800zM1.800 12l2.800-2.400v4.800zM22.200 12l-2.800-2.400v4.800z" fill="${O}"/>`);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** A keyboard key cap with a label ("Space", "E"); wider for long labels. */
export function keyCap(label) {
  const w = Math.max(22, 10 + String(label).length * 8.6);
  return `<svg viewBox="0 0 ${w} 26" width="${(w / 26).toFixed(2)}em" height="1em" aria-hidden="true" focusable="false"><rect x="1.600" y="1.600" width="${w - 3.2}" height="20" rx="5" fill="#fff" stroke="${O}" stroke-width="2.200"/><rect x="1.600" y="19" width="${w - 3.2}" height="5" rx="2.400" fill="#c7cfe0" stroke="${O}" stroke-width="2.200"/><text x="${w / 2}" y="16.200" text-anchor="middle" font-family="Fredoka, sans-serif" font-weight="700" font-size="${String(label).length > 3 ? 11 : 13}" fill="${O}">${esc(label)}</text></svg>`;
}
/** A round gamepad / phone button with a letter; `color` fills it. */
export function padButton(label, color = '#55d96a') {
  return svg(`<circle cx="12" cy="12" r="9.600" fill="${esc(color)}" stroke="${O}" stroke-width="2.200"/><text x="12" y="16.400" text-anchor="middle" font-family="Fredoka, sans-serif" font-weight="700" font-size="${String(label).length > 1 ? 8 : 12}" fill="#fff" stroke="${O}" stroke-width=".7" paint-order="stroke">${esc(label)}</text>`);
}
ICONS['party-feastround'] = svg(`<ellipse cx="12" cy="15" rx="10" ry="5" fill="#fff1d2" stroke="${O}" stroke-width="2"/><path d="M6 14Q12 1 18 14Z" fill="#ffb347" stroke="${O}" stroke-width="2"/>`);
ICONS['party-bumpers'] = svg(`<circle cx="12" cy="12" r="9" fill="#a98ee4" stroke="${O}" stroke-width="2"/><circle cx="9" cy="8" r="3" fill="#8fe6d0"/><path d="M4 20H20" stroke="#ffd98a" stroke-width="2"/>`);
ICONS['party-glowcap'] = svg(`<ellipse cx="12" cy="19" rx="10" ry="3.2" fill="#2b2f6e" stroke="${O}" stroke-width="1.6"/><path d="M3.5 14Q4 3 12 3Q20 3 20.5 14Z" fill="#7c6cff" stroke="${O}" stroke-width="2"/><circle cx="9" cy="9" r="1.6" fill="#ffd23a"/><circle cx="14.5" cy="7.5" r="1.3" fill="#ff9ccf"/><circle cx="15.5" cy="11.5" r="1.6" fill="#8ff4ff"/>`);
ICONS['party-cast'] = svg(`<path d="M3 21L17 4" stroke="#c9a35a" stroke-width="2.6" stroke-linecap="round"/><path d="M17 4Q22 5 21 12" fill="none" stroke="#6ff3ff" stroke-width="1.6"/><circle cx="21" cy="14" r="2.4" fill="#ff8a3c" stroke="${O}" stroke-width="1.6"/><path d="M2 21.5H22" stroke="${O}" stroke-width="2" stroke-linecap="round"/>`);
ICONS['party-tilty'] = svg(`<rect x="2.5" y="5" width="19" height="15" rx="1.5" fill="#b57a4e" stroke="${O}" stroke-width="2" transform="rotate(-8 12 12)"/><rect x="6" y="8.5" width="6" height="4.5" fill="#f2d4a0" stroke="${O}" stroke-width="1" transform="rotate(-8 12 12)"/><rect x="12" y="8.5" width="6" height="4.5" fill="#8fe6d0" transform="rotate(-8 12 12)"/><circle cx="16.5" cy="16" r="2.6" fill="#7a4a2a" stroke="${O}" stroke-width="1.4"/>`);
ICONS['party-bonk'] = svg(`<rect x="10.8" y="2" width="2.4" height="11" rx="1" fill="#c9a06a" stroke="${O}" stroke-width="1.2"/><rect x="3" y="12" width="18" height="7" rx="3" fill="#ff7fb0" stroke="${O}" stroke-width="2"/><path d="M9 12.5V18.5M15 12.5V18.5" stroke="#fff0d8" stroke-width="2.2"/><ellipse cx="12" cy="21.8" rx="9" ry="1.4" fill="#2b2340" opacity=".4"/>`);
ICONS['party-vineskip'] = PARTY_VINESKIP_SVG; ICONS['party-timber'] = PARTY_TIMBER_SVG; ICONS['party-marlosays'] = PARTY_MARLOSAYS_SVG; ICONS['party-huddle'] = PARTY_HUDDLE_SVG; ICONS['party-sizzle'] = PARTY_SIZZLE_SVG; ICONS['party-eggs'] = PARTY_EGGS_SVG; ICONS.star = STAR_SVG; ICONS.bot = BOT_SVG; ICONS.popper = POPPER_SVG; ICONS.trophy = TROPHY_SVG; ICONS.stick = STICK_SVG;
