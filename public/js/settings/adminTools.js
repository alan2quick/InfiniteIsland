// Local testing shortcuts. Never publish environment settings or complete a real save.
import { BRIDGES, CAMP_JOBS, GARDEN_JOBS } from '../config.js';
import { PET_IDS } from '../game/petLogic.js';
import { FLOWER_IDS } from '../game/flowers.js';
import { isEditorPreview } from './previewRuntime.js';
import { saveEnabled } from '../game/save.js';

export const isExplorationSandbox = isEditorPreview && new URLSearchParams(globalThis.location?.search || '').has('explore')
  && typeof window !== 'undefined' && window.parent === window;

export const ADMIN_DESTINATIONS = Object.freeze([
  { id: 'home', label: 'Home camp' }, { id: 'frost', label: 'Frostpine' },
  { id: 'ember', label: 'Emberleaf' }, { id: 'duskLanding', label: 'Duskcrown beach' },
]);
export const UNLOCK_DESCRIPTION = 'Opens a separate, fresh temporary sandbox. Opens all three bridges, finishes Frostpine camp and Emberleaf garden upgrades, provides every flower seed, all hats, tails, garlands and registered pets, and a repaired, charted, launched boat. Quest/story completion, dungeon progression and inventory are not forged. Your real progress and shared environment database stay unchanged; closing or reloading the sandbox discards its changes. Testing audio is muted.';

export function testingBlockReason(game) {
  if (!game.sync?.isHost || game.sync?.isReplica) return 'Testing shortcuts are available only on the host screen.';
  const count = (game.players?.list || []).filter(p => !p.away && !p.bot).length;
  if (count > 1 || game.link?.screens?.size || game.link?.controllers?.size || game.avatars?.list?.some(p => !p.away)) return 'Use testing shortcuts in a solo host game, after other players disconnect.';
  if (game.editor?.bridge?.comparisonOpen) return 'Choose a single preview before using testing shortcuts.';
  if (game.cinematic?.busy || game.feast?.active || game.party?.active || game.party?.pageMode || game.storybook?.state?.active || game.storybook?.pageMode || game.dungeon?.state?.active
      || game.boat?.state?.float || game.boat?.sailApi?.state?.startAt != null || game.boat?.voyageScene?.busy || game.boat?.voyageScene?.active || game.bridges?.api?.opening?.length
      || game.dialog?.isOpen || game.bagPanel?.isOpen || game.pairPanel?.isOpen || game.editor?.isSelecting) return 'Finish the current scene, activity or dialog before using testing shortcuts.';
  return null;
}
function requireReady(game) { const reason = testingBlockReason(game); if (reason) throw new Error(reason); }

export function createAdminTools(game, { href = globalThis.location?.href || 'http://localhost/', open = (...args) => window.open(...args) } = {}) {
  const sandbox = new URL('/', href);
  sandbox.search = new URLSearchParams({ editorPreview: '1', explore: '1', bridges: 'open', admin: '1' }).toString();
  return {
    isSandbox: isExplorationSandbox, destinations: ADMIN_DESTINATIONS,
    help: ADMIN_DESTINATIONS.map(({ id, label }) => ({ label, command: `__game.editor.adminTools.travel('${id}')` })),
    sandboxUrl: sandbox.href, unlockDescription: UNLOCK_DESCRIPTION,
    travel(id) {
      requireReady(game);
      const destination = ADMIN_DESTINATIONS.find(d => d.id === id);
      if (!destination) throw new Error('Choose a listed island landing.');
      if (game.world?.goto(id) !== true) throw new Error('That island landing is unavailable.');
      return `${destination.label} reached. This shortcut does not complete quests.`;
    },
    unlockAll() {
      if (isExplorationSandbox) return 'Testing unlocks are already active in this temporary sandbox. Close this tab to return to your real game.';
      requireReady(game);
      open(sandbox.href, '_blank', 'noopener,noreferrer');
      // noopener may deliberately return null even when the new tab opens.
      return `Temporary sandbox requested. Your real progress is unchanged. If the browser blocked the new tab, open ${sandbox.href}`;
    },
  };
}

export function initializeExplorationSandbox(game) {
  if (!isExplorationSandbox || saveEnabled) return false;
  requireReady(game);
  const required = [game.bridges?.build, game.camp?.setComfort, game.garden?.setStage, game.garden?.api?.setSeeds,
    game.hats?.preview, game.tails?.unlockAll, game.garlands?.api?.debug?.unlockAll, game.pets?.domain?.debugSet, game.boat?.launch];
  if (!required.every(fn => typeof fn === 'function')) throw new Error('Some sandbox unlock tools are unavailable. No unlocks applied.');
  const check = (name, result) => { if (result === false || result?.ok === false || result?.reject) throw new Error(`Sandbox unlock failed: ${name}. Close this tab to discard the temporary world.`); };
  for (const bridge of BRIDGES) check(`bridge ${bridge.id}`, game.bridges.build(bridge.id));
  check('Frostpine camp', game.camp.setComfort(CAMP_JOBS.length));
  check('Emberleaf garden', game.garden.setStage(GARDEN_JOBS.length));
  check('flower seeds', game.garden.api.setSeeds([...FLOWER_IDS]));
  game.hats.preview(game.hats.list.length);
  check('tails', game.tails.unlockAll());
  check('garlands', game.garlands.api.debug.unlockAll());
  // Silent debug replacement avoids the normal unlock's automatic companion dialog.
  check('pets', game.pets.domain.debugSet([...PET_IDS]));
  check('boat', game.boat.launch());
  return true;
}
