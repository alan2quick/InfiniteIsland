// Tiny localStorage save helper shared by the game-state modules (inventory now, campfire / quest later).
//
//   NEW_GAME            true when the page was opened with ?newgame (saved data must be ignored and cleared)
//   loadSave(key)       parsed JSON or null (never throws; storage can be blocked / full / private)
//   writeSave(key, v)   JSON.stringify into storage (never throws)
//   clearSave(key)
//   setSaveEnabled(false) / saveEnabled   the master switch: while off, nothing is read from or written to storage. A joined REPLICA page
//                       (`?join=CODE`, Step 22) runs with it off from the start: the host owns the world and the only save, and a joining
//                       screen must never overwrite its own (or the host's) save with a world it only mirrors.
//                       Editor comparison frames are also permanently disabled and use isolated ephemeral storage.
//                       EVERY game-state writer must go through writeSave / clearSave (never localStorage directly) so the switch covers it.
//
// ?newgame is stripped from the address bar right after it was read (history.replaceState), so a later reload keeps the
// progress made since; NEW_GAME itself stays true for the rest of the page's life so every module can react to it once.
import { isEditorPreview } from '../settings/previewRuntime.js';

const params = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
export const NEW_GAME = !isEditorPreview && params.has('newgame');

export let saveEnabled = !(params.get('join')) && !isEditorPreview;      // a replica page (?join=CODE) never saves; see the header
export function setSaveEnabled(on) { saveEnabled = !!on && !isEditorPreview; }

if (NEW_GAME) {
  try {
    const rest = location.search.slice(1).split('&').filter((kv) => kv && kv.split('=')[0] !== 'newgame');
    history.replaceState(history.state, '', location.pathname + (rest.length ? '?' + rest.join('&') : '') + location.hash);
  } catch (_) { /* ignore */ }
}

export function loadSave(key) {
  if (!saveEnabled) return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (_) { return null; }
}

export function writeSave(key, value) {
  if (!saveEnabled) return false;
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (_) { return false; }
}

export function clearSave(key) {
  if (!saveEnabled) return;
  try { localStorage.removeItem(key); } catch (_) { /* ignore */ }
}
