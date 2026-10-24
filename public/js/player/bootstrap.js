// Local presentation: scene characters, browser-local appearance, and the optional opening view.
import { attachVariant, normaliseVariant } from './characterVariants.js';
import { attachHeldProp, normaliseHeldProp } from './heldProps.js';
import { normaliseAppearance } from './appearance.js';
import { characterPortrait } from './portrait.js';
import { ISLANDS } from '../config.js';
import { islandIntroOptions } from '../camera/islandIntro.js';
import { createIntroFog } from '../camera/introFog.js';
import { createCampfireCast } from './campfireCast.js';
import { createPersonalPanels } from '../ui/personalPanels.js';
import { createLocalCharacterPanel } from './localCharacterPanel.js';

const PREF_KEY = 'infiniteIsland.character.v1';
function readPreference() {
  try { return JSON.parse(localStorage.getItem(PREF_KEY) || 'null'); } catch { return null; }
}
export async function mountPlayerPresentation(game) {
  const introFog = createIntroFog(game.scene, game.followCam);
  const preference = readPreference();
  let selected = { variant: normaliseVariant(preference?.variant), display_name: typeof preference?.display_name === 'string' ? preference.display_name.slice(0, 32) : '', appearance: normaliseAppearance(preference?.appearance) };
  let variantCleanup = attachVariant(game.player.character, selected.variant);
  game.player.characterVariant = selected.variant;
  const occupiedHand = () => !!game.player.holding;
  let propTime = 0, heldPropCleanup = attachHeldProp(game.player.character, selected.appearance.heldProp, { isOccupied: occupiedHand });
  game.player.heldProp = normaliseHeldProp(selected.appearance.heldProp);
  { const { heldProp, ...colors } = selected.appearance; game.player.character.setColors(colors); }
  let profiles = null, introPending = true, campCast = null, profileButton = null, panelOpen = false;
  const launchers = document.createElement('div'); launchers.className = 'island-tools';
  document.body.append(launchers);
  function chooseCharacter(character) {
    selected = { variant: normaliseVariant(character.variant ?? selected.variant), display_name: String(character.display_name ?? selected.display_name).trim().slice(0, 32), appearance: normaliseAppearance(character.appearance === undefined ? selected.appearance : character.appearance) };
    variantCleanup?.(); variantCleanup = attachVariant(game.player.character, selected.variant);
    game.player.characterVariant = selected.variant;
    { const { heldProp, ...colors } = selected.appearance; game.player.character.setColors(colors); }
    heldPropCleanup?.(); heldPropCleanup = attachHeldProp(game.player.character, selected.appearance.heldProp, { isOccupied: occupiedHand });
    game.player.heldProp = normaliseHeldProp(selected.appearance.heldProp);
    if (profileButton) profileButton.innerHTML = characterPortrait(selected.variant);
    campCast?.setSelected(selected.variant);
    try { localStorage.setItem(PREF_KEY, JSON.stringify(selected)); } catch { /* Appearance remains usable this session. */ }
  }
  const button = (label, handler) => { const el = document.createElement('button'); el.type = 'button'; el.textContent = label; el.addEventListener('click', handler); launchers.append(el); return el; };
  const personalPanels = createPersonalPanels({ bagPanel: game.bagPanel,
    loadProfile: () => profiles ||= createLocalCharacterPanel({ getCharacter: () => selected, setCharacter: chooseCharacter, onClose: () => { panelOpen = false; } }),
    blockProfile: (open) => { panelOpen = open; game.keyboard.releaseAll(); },
  });
  const openProfiles = () => personalPanels.toggle('profile');
  profileButton = button('My character', openProfiles);
  profileButton.className = 'island-profile-avatar';
  profileButton.setAttribute('aria-label', 'My character'); profileButton.title = 'My character';
  profileButton.innerHTML = characterPortrait(selected.variant);
  const personalButtons = [[profileButton, 'profile'], [game.hud.root.querySelector('.inv-bag-button'), 'bag'], [game.hud.root.querySelector('.hud-journal-dock'), 'journal']];
  for (const [el, name] of personalButtons) if (el) {
    el.dataset.personalPanel = name;
    el.addEventListener('click', (event) => { event.preventDefault(); event.stopImmediatePropagation(); personalPanels.toggle(name); }, { capture: true });
  }
  function startIntro() {
    if (!introPending) return;
    introPending = false; // Only startup: reopening character selection must never replay the camera introduction.
    const count = game.players.list.filter((p) => !p.away).length + game.avatars.list.filter((p) => !p.away).length;
    if (game.followCam.settings.intro && count === 1 && !panelOpen && !game.controls && !game.cinematic.busy && !game.dungeon.state.active && !game.party.pageMode && !game.storybook.pageMode) {
      game.followCam.startIntro(islandIntroOptions(ISLANDS, game.player.position, game.followCam.camera));
    }
  }
  const homeFire = game.campfires.get('home');
  // Old saves may resume on another island: never move their player to force a first-time cosmetic choice.
  const atStartingCamp = Math.hypot(game.player.position.x - homeFire.position.x, game.player.position.z - homeFire.position.z) < 18;
  const canChooseAtStartup = atStartingCamp && !preference && !game.sync.isReplica && !game.controls && !game.party.pageMode && !game.storybook.pageMode && !game.dungeon.state.active && !game.cinematic.busy;
  // The cast belongs to the real island scene on every screen. Choosing changes only this player's cosmetics.
  const castStyle = document.createElement('link'); castStyle.rel = 'stylesheet'; castStyle.href = '/campfire-friends.css'; document.head.append(castStyle);
  campCast = createCampfireCast({ scene: game.scene, camera: game.camera, canvas: game.renderer.domElement, player: game.player,
    keyboard: game.keyboard, welcomeFire: homeFire, fire: homeFire.fire, seats: homeFire.seats, selected: selected.variant, initialSelection: canChooseAtStartup,
    onChoose: (variant) => chooseCharacter({ variant }), onSettled: startIntro, hasActivity: () => game.players.activity,
    getBlocked: () => panelOpen || game.cinematic.busy || game.party.pageMode || game.storybook.pageMode || game.dungeon.state.active || game.bagPanel.isOpen || game.pairPanel.isOpen || game.dialog.isOpen,
  });
  if (!canChooseAtStartup) startIntro();
  return {
    get isOpen() { return panelOpen || !!campCast?.isSelecting; },
    get isSelecting() { return !!campCast?.isSelecting; }, get campCast() { return campCast; }, openProfiles,
    getCharacter: () => ({ ...selected, appearance: { ...selected.appearance } }), setCharacter: chooseCharacter,
    beforeFrame: () => introFog.beforeFrame(), afterLighting: () => introFog.afterLighting(),
    update(dt) { propTime += Number.isFinite(dt) ? Math.max(0, dt) : 0; heldPropCleanup?.update(propTime); campCast?.update(dt); },
    dispose() { personalPanels.close(); campCast?.dispose(); castStyle.remove(); variantCleanup?.(); heldPropCleanup?.(); profiles?.unmount(); launchers.remove(); introFog.beforeFrame(); },
  };
}
