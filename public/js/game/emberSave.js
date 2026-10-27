// The shared Emberleaf save file (PLAN Step 37b): ONE localStorage key, `infinite-island.emberleaf.v1`, written by several modules that each own one key of it
// ({ v: 1, garden: {...}, flowers / jobs / garlands / ruby }). Same idea as frostSave.js: each module reads its part once at load and writes it back with `set`, which merges
// into the one in-memory copy, so no writer can drop another's keys. ?newgame wipes the file once, at the first read. Replicas never save (game/save.js switches writeSave off).
//
//   emberSave.read()          the parsed file (an object, {} when missing / new game); cached, so every module sees the same one
//   emberSave.set(key, value) replace one key and write the file ({ v: SAVE_VERSION, ...keys })
import { NEW_GAME, loadSave, writeSave, clearSave } from './save.js';

export const STORAGE_KEY = 'infinite-island.emberleaf.v1';
export const SAVE_VERSION = 1;

let data = null;
function read() {
  if (data) return data;
  if (NEW_GAME) { clearSave(STORAGE_KEY); data = {}; }
  else { const d = loadSave(STORAGE_KEY); data = d && typeof d === 'object' ? { ...d } : {}; }
  return data;
}

export const emberSave = {
  read,
  set(key, value) {
    const d = read();
    d[key] = value;
    d.v = SAVE_VERSION;
    writeSave(STORAGE_KEY, d);
  },
};
