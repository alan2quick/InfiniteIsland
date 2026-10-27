// Host-local return points and held-tool descriptions. World pickups are never saved here.
import { NEW_GAME, loadSave, writeSave, clearSave } from './save.js';
import { TOOLS } from '../items/tools.js';
import { AREAS } from './areaLogic.js';

export const PLAYER_MEMORY_KEY = 'infinite-island.players.v1';
const zones = new Set(['home', 'frost', 'ember', 'story', 'duskcrown', 'ritual', 'dungeon']);   // ('duskcrown' since Step 71: the boat is the way there, main.js only remembers it while the boat is moored there)
// ('story' = Storybook Cay AND a storybook page: pages are session-only, so a reload lands at the book stand)

export function rememberedTool(tool) {
  if (!tool || tool.rack || !Object.hasOwn(TOOLS, tool.kind)) return null;
  return {
    kind: tool.kind,
    color: typeof tool.color === 'string' && /^#[0-9a-f]{6}$/i.test(tool.color) ? tool.color : null,
    roll: Number.isFinite(tool.roll) ? tool.roll : 0,
  };
}

/** Step 56: a player inside a combat area also remembers WHICH area and where the run was entered from ('ritual' | an island entrance id), so a reload restarts it in the right place. */
export function runMeta(zone, meta) {
  if (zone !== 'dungeon' || !meta) return {};
  const out = {};
  if (typeof meta.area === 'string' && /^[a-z0-9-]{1,24}$/.test(meta.area)) out.area = meta.area;
  if (meta.from === 'ritual' || Object.values(AREAS).some((a) => a.entrance?.id === meta.from)) out.from = meta.from;      // 'ritual' or an island entrance id ('rootgate', 'glimmerfrost-mouth', ...)
  return out;
}

export function createPlayerMemory() {
  if (NEW_GAME) clearSave(PLAYER_MEMORY_KEY);
  const raw = NEW_GAME ? null : loadSave(PLAYER_MEMORY_KEY);
  const saved = {};
  if (raw?.v === 1) for (let slot = 0; slot < 4; slot++) {
    const entry = raw.players?.[slot];
    if (entry && zones.has(entry.zone)) saved[slot] = { zone: entry.zone, tool: rememberedTool(entry.tool), ...runMeta(entry.zone, entry) };
  }
  let last = JSON.stringify(saved);
  return {
    get: (slot) => saved[slot] || null,
    remember(slot, zone, tool, meta = null) {
      if (!Number.isInteger(slot) || slot < 0 || slot >= 4 || !zones.has(zone)) return;
      saved[slot] = { zone, tool: rememberedTool(tool), ...runMeta(zone, meta) };
      const next = JSON.stringify(saved);
      if (next !== last && writeSave(PLAYER_MEMORY_KEY, { v: 1, players: saved })) last = next;
    },
  };
}
