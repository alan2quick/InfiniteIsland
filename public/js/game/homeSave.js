// The shared home-island save file (PLAN Step 74b): ONE localStorage key, `infinite-island.home.v1`, written by several modules that each own one key of it ({ v: 1, carle: {...}, (later) ... }). The same idea as
// emberSave.js / duskSave.js: each module reads its part once at load and writes it back with `set`, which merges into the one in-memory copy, so no writer can drop another's keys. ?newgame wipes the file once, at
// the first read. Replicas never save (game/save.js switches writeSave off).
//
//   homeSave.read()          the parsed file (an object, {} when missing / new game); cached, so every module sees the same one
//   homeSave.set(key, value) replace one key and write the file ({ v: SAVE_VERSION, ...keys })
//   homeSave.reset()         forget the cached copy (tests)
import { NEW_GAME, loadSave, writeSave, clearSave } from './save.js';

export const STORAGE_KEY = 'infinite-island.home.v1';
export const SAVE_VERSION = 1;

let data = null;
function read() {
  if (data) return data;
  if (NEW_GAME) { clearSave(STORAGE_KEY); data = {}; }
  else { const d = loadSave(STORAGE_KEY); data = d && typeof d === 'object' && !Array.isArray(d) ? { ...d } : {}; }
  return data;
}

export const homeSave = {
  read,
  set(key, value) {
    const d = read();
    d[key] = value;
    d.v = SAVE_VERSION;
    writeSave(STORAGE_KEY, d);
  },
  reset() { data = null; },
};
