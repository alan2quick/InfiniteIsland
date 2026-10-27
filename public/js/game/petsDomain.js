// The `pets` sync domain (PLAN Step 73a): which pets the party has UNLOCKED. Host-authoritative, saved by the host only as 'infinite-island.pets.v1' ({v: 1, unlocked: ['capray']}). Pets travel across
// islands, so this is not part of one island's save file. Which pet each PLAYER brings is a per-screen preference (world/pets.js, 'infiniteIsland.pets'), never synced.
//
//   const pets = createPetsDomain({ sync, params })
//   pets.unlocked               a copy of the unlocked ids (registry order)        pets.has(id)         pets.known     false on a replica until the host's snapshot arrived
//   pets.unlock(id)             HOST only (returns false elsewhere / when unknown or already unlocked): add, save, emit `unlock`, and call the listeners with { live: true }
//   pets.onUnlock(fn)           fn(id, { live }) on EVERY screen when an unlock event arrives (live: true; a load / late join is silent and does not call it), BEFORE the onChange listeners. Returns an unsubscribe function.
//                               Step 73b hooks "Bring Capray along?" (world/caprayWorld.js) and the stable's pop-in (world/petStable.js) here.
//   pets.onChange(fn)           fn() after any change to the list (unlock, snapshot, debug set)
//   pets.questlinesOpen         true once any pet is unlocked: Steps 74+ hook the home / Frostpine / Emberleaf pet quest lines on it
//   pets.reset() / pets.debugSet(list)   the host's debug requests (replica-callable through sync.request, host actor only)
//   ?testpet                    Capray unlocked and NEVER saved (the file is neither read nor written); ?newgame wipes the save once
//
// Events: unlock {id, unlocked}; set {unlocked} (debug, silent). Snapshot = { unlocked }, hashView = the sorted list.
import { NEW_GAME, loadSave, writeSave, clearSave } from './save.js';
import { PET_IDS, normaliseUnlocked, mergeUnlocked } from './petLogic.js';

export const PETS_KEY = 'infinite-island.pets.v1';

export function createPetsDomain({ sync, params = new URLSearchParams() }) {
  const testpet = params.has('testpet');
  const transient = testpet || params.has('testruby');
  const saveOn = !transient && sync.isHost;
  let unlocked = [];
  let known = sync.isHost;
  if (sync.isHost) {
    if (NEW_GAME && !transient) clearSave(PETS_KEY);
    else if (!transient) unlocked = normaliseUnlocked(loadSave(PETS_KEY)?.unlocked);
    if (testpet) unlocked = mergeUnlocked(unlocked, ['capray']);
  }
  const unlockListeners = new Set(), changeListeners = new Set();
  const call = (set, ...args) => { for (const fn of set) { try { fn(...args); } catch (e) { console.error(e); } } };
  const save = () => { if (saveOn) writeSave(PETS_KEY, { v: 1, unlocked: [...unlocked] }); };

  function replace(list) {
    unlocked = normaliseUnlocked(list);
    known = true;
    call(changeListeners);
  }
  function applyUnlock(d) {
    const id = d && typeof d.id === 'string' ? d.id : null;
    if (!id || !PET_IDS.includes(id)) return;
    const had = unlocked.includes(id);
    unlocked = mergeUnlocked(unlocked, [id]);
    if (Array.isArray(d.unlocked)) unlocked = mergeUnlocked(unlocked, d.unlocked);
    known = true;
    if (!had) call(unlockListeners, id, { live: true });          // (before the change listeners: a structure that pops in live (Step 73b's stable) sees the unlock first, and the change after it is then a no-op)
    call(changeListeners);
  }

  sync.register('pets', {
    snapshot: () => ({ unlocked: [...unlocked] }),
    hashView: () => [...unlocked],
    applySnapshot(s) { replace(s && s.unlocked); },
    applyEvent(kind, d) {
      if (kind === 'unlock') applyUnlock(d);
      else if (kind === 'set') replace(d && d.unlocked);
    },
    handleRequest(kind, d, actor) {
      if (kind === 'debugSet') {
        if (!actor || actor.screen !== 'host') return { reject: 'bad-request' };
        replace(d && d.unlocked);
        save();
        sync.emit('pets', 'set', { unlocked: [...unlocked] });
        return true;
      }
      return { reject: 'unknown-kind' };
    },
  });

  const hostActor = () => (sync.isHost ? { screen: 'host', index: 0, pos: { x: 0, y: 0, z: 0 } } : null);
  const debugSet = (list) => sync.request('pets', 'debugSet', { unlocked: list }, hostActor());

  function unlock(id) {
    if (!sync.isHost || !PET_IDS.includes(id) || unlocked.includes(id)) return false;
    const data = { id, unlocked: mergeUnlocked(unlocked, [id]) };
    applyUnlock(data);
    save();
    sync.emit('pets', 'unlock', data);
    return true;
  }

  return {
    get unlocked() { return [...unlocked]; },
    get known() { return known; },
    get questlinesOpen() { return unlocked.length > 0; },
    get testpet() { return testpet; },
    has: (id) => unlocked.includes(id),
    unlock,
    reset: () => debugSet([]),
    debugSet,
    onUnlock(fn) { unlockListeners.add(fn); return () => unlockListeners.delete(fn); },
    onChange(fn) { changeListeners.add(fn); return () => changeListeners.delete(fn); },
    summary: () => ({ unlocked: [...unlocked], known, testpet, saved: saveOn, questlinesOpen: unlocked.length > 0 }),
  };
}
