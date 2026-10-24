// Browser-local character name and cosmetic carryable controls. No account or build runtime.
import { HELD_PROPS, normaliseHeldProp } from './appearance.js';
export function createLocalCharacterPanel({ getCharacter, setCharacter, onClose = () => {} }) {
  const overlay = document.createElement('div'); overlay.className = 'player-appearance-overlay'; overlay.hidden = true;
  const panel = document.createElement('section'); panel.className = 'player-appearance-panel';
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'false'); panel.setAttribute('aria-labelledby', 'player-appearance-title');
  panel.innerHTML = '<header><h2 id="player-appearance-title">My character</h2><button type="button" aria-label="Close character">×</button></header><p>Choose another islander at the campfire. Appearance changes stay in this browser.</p>';
  const label = (text, input) => { const el = document.createElement('label'); el.textContent = text; el.appendChild(input); panel.appendChild(el); };
  const name = document.createElement('input'); name.type = 'text'; name.maxLength = 32; name.autocomplete = 'off'; label('Character name', name);
  const carry = document.createElement('select'); carry.setAttribute('aria-label', 'Carry something');
  for (const prop of HELD_PROPS) { const option = document.createElement('option'); option.value = prop.id; option.textContent = prop.name; carry.appendChild(option); }
  label('Carry something', carry);
  const message = document.createElement('p'); message.className = 'player-appearance-status'; message.setAttribute('role', 'status'); panel.appendChild(message);
  overlay.appendChild(panel); document.body.appendChild(overlay);
  const apply = () => { const current = getCharacter(); setCharacter({ ...current, display_name: name.value.trim().slice(0, 32), appearance: { ...current.appearance, heldProp: normaliseHeldProp(carry.value) } }); message.textContent = 'Remembered on this browser.'; };
  name.addEventListener('change', apply); carry.addEventListener('change', apply);
  function close() { if (overlay.hidden) return; overlay.hidden = true; onClose(); }
  panel.querySelector('button').addEventListener('click', close);
  panel.addEventListener('keydown', (event) => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); close(); } });
  return {
    open() { const selected = getCharacter(); name.value = selected.display_name || ''; carry.value = normaliseHeldProp(selected.appearance?.heldProp); message.textContent = ''; overlay.hidden = false; name.focus(); },
    close, get isOpen() { return !overlay.hidden; }, unmount() { close(); overlay.remove(); },
  };
}
