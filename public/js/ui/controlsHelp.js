import { GAMEPAD_SVG, PHONE_SVG } from './icons.js';

const CONTROL_HINT = `
  <span class="th-group"><b class="th-key">WASD</b><i>/</i>${GAMEPAD_SVG}<i>/</i>${PHONE_SVG}<span>to move</span></span>
  <span class="th-dot">&bull;</span>
  <span class="th-group"><b class="th-key">E</b><i>/</i><b class="th-pad">A</b><span>to interact</span></span>`;

/** One quiet arrival hint; the same controls remain available from the HUD afterwards. */
export function createControlsHelp(root, { beforeOpen = () => {}, afterClose = null } = {}) {
  const preview = document.createElement('div');
  preview.className = 'controls-arrival';
  preview.setAttribute('aria-label', 'Game controls');
  preview.innerHTML = `<div class="title-hint">${CONTROL_HINT}</div><small>Find these again with the controller ? button.</small>`;
  root.appendChild(preview);
  const removePreview = () => preview.remove();
  const timeout = setTimeout(removePreview, 6000);
  preview.addEventListener('animationend', removePreview, { once: true });

  const button = document.createElement('button');
  button.type = 'button'; button.className = 'hud-extra-option hud-controls-help';
  button.setAttribute('aria-label', 'How to play'); button.title = 'How to play';
  button.setAttribute('aria-haspopup', 'dialog'); button.setAttribute('aria-controls', 'island-controls-help');
  button.setAttribute('aria-expanded', 'false');
  button.innerHTML = `<span aria-hidden="true">${GAMEPAD_SVG}<b>?</b></span>`;
  const popup = document.createElement('dialog');
  popup.id = 'island-controls-help'; popup.className = 'controls-help-dialog';
  popup.setAttribute('aria-labelledby', 'island-controls-title');
  popup.innerHTML = `<header><h2 id="island-controls-title">A little help</h2><button type="button" aria-label="Close game controls">×</button></header>
    <p>Take a wander around the island.</p><div class="title-hint">${CONTROL_HINT}</div>
    <p class="controls-help-note">On a phone, use the on-screen stick to move and the action button to interact.</p>`;
  const closeButton = popup.querySelector('button');
  root.appendChild(popup);
  const close = () => popup.close();
  button.addEventListener('click', () => {
    beforeOpen(); removePreview(); clearTimeout(timeout);
    popup.showModal(); button.setAttribute('aria-expanded', 'true'); closeButton.focus();
  });
  closeButton.addEventListener('click', close);
  popup.addEventListener('close', () => { button.setAttribute('aria-expanded', 'false'); if (afterClose) afterClose(); else button.focus(); });
  popup.addEventListener('click', (event) => { if (event.target === popup) close(); });
  // Key releases still reach the input source so a key held before opening cannot get stuck.
  for (const name of ['keydown', 'pointerdown', 'pointerup', 'wheel']) popup.addEventListener(name, (event) => event.stopPropagation());
  return { button, close, get isOpen() { return popup.open; }, dispose() { clearTimeout(timeout); preview.remove(); popup.remove(); button.remove(); } };
}
