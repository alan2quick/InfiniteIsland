// Keep setup controls together in one collapsed gear menu on every screen size.
import { enterFullscreen } from './fullscreenPrompt.js';
import { createControlsHelp } from './controlsHelp.js';
export function createOptionsMenu(root, { musicButton, muteButton, pairPanel, hud, touch, juice = null, onFriends = () => {}, onJournal = () => {} }) {
  const el = document.createElement('div');
  el.className = 'hud-options';
  el.innerHTML = `<button type="button" class="hud-more-btn" aria-label="Settings" title="Settings" aria-expanded="false" aria-controls="hud-options-panel">
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="m10 2 4 0 .6 2.6 2 .9 2.3-.9 2 3.4-1.9 1.8.2 2.3 1.8 1.8-2 3.4-2.5-.7-1.8 1.3-.7 2.1h-4l-.6-2.6-2-.9-2.3.9-2-3.4 1.9-1.8-.2-2.3L2 8.1l2-3.4 2.5.7 1.8-1.3L10 2Z" fill="#aeb4bb" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="11.5" r="3.2" fill="#e2e5e9" stroke="currentColor" stroke-width="1.8"/></svg>
    </button><div id="hud-options-panel" class="hud-options-panel" aria-label="Game options"><header class="hud-settings-heading"><strong>Settings</strong><button type="button" aria-label="Close settings">×</button></header></div>`;
  const toggle = el.querySelector('button');
  const panel = el.querySelector('.hud-options-panel');
  panel.querySelector('.hud-settings-heading button').addEventListener('click', () => { close(); toggle.focus(); });
  const fullscreen = document.createElement('button');
  fullscreen.type = 'button';
  fullscreen.className = 'hud-fullscreen-btn';
  fullscreen.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6" fill="none" stroke="currentColor" stroke-width="2.5"/></svg>';
  const renderFullscreen = () => {
    fullscreen.hidden = !document.fullscreenEnabled;
    fullscreen.setAttribute('aria-label', document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen');
    fullscreen.title = fullscreen.getAttribute('aria-label');
  };
  fullscreen.addEventListener('click', async () => {
    close();
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (!(await enterFullscreen())) hud.toast('Fullscreen is unavailable here');
    } catch (_) { hud.toast('Fullscreen is unavailable here'); }
    fullscreen.blur();
  });
  document.addEventListener('fullscreenchange', renderFullscreen);
  renderFullscreen();
  panel.append(musicButton, muteButton, pairPanel.button, fullscreen);
  const controlsHelp = createControlsHelp(root, { beforeOpen: () => { close(); touch?.widget.reset(); }, afterClose: () => toggle.focus() });
  panel.appendChild(controlsHelp.button);
  const juicePanel = document.createElement('div'); juicePanel.className = 'juice-settings'; juicePanel.hidden = true;
  let juiceButton = null;
  if (juice) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'hud-extra-option'; button.setAttribute('aria-label', 'Combat feedback'); button.title = 'Combat feedback'; button.setAttribute('aria-expanded', 'false');
    juiceButton = button;
    button.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M4 7h16M4 17h16M8 4v6m8 4v6" fill="none" stroke="currentColor" stroke-width="2.5"/></svg>';
    button.addEventListener('click', () => { juicePanel.hidden = !juicePanel.hidden; button.setAttribute('aria-expanded', String(!juicePanel.hidden)); }); panel.append(button, juicePanel);
  }
  if (juice) for (const [name, title, choices] of [['shake', 'Screen shake', [['full', 'Full'], ['reduced', 'Reduced'], ['off', 'Off']]], ['flashes', 'Flashes', [['full', 'Full'], ['reduced', 'Reduced']]], ['numbers', 'Damage numbers', [[true, 'On'], [false, 'Off']]], ['nearbyNumbers', 'Show numbers', [[true, 'Nearby'], [false, 'Everyone']]]]) {
    const label = document.createElement('label'); label.className = 'juice-option'; label.textContent = title;
    const select = document.createElement('select'); select.setAttribute('aria-label', title);
    choices.forEach(([value, text]) => { const option = document.createElement('option'); option.value = String(value); option.textContent = text; select.appendChild(option); });
    select.value = String(juice.settings[name]); select.addEventListener('change', () => { const value = choices.find(([v]) => String(v) === select.value)?.[0]; juice.setSetting(name, value); }); label.appendChild(select); juicePanel.appendChild(label);
  }
  for (const [label, action, path] of [['Join a friend', onFriends, 'M5 7h14v12H5zM8 4h8M8 11h8m-8 4h5']]) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'hud-extra-option';
    button.setAttribute('aria-label', label); button.title = label;
    button.innerHTML = `<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="${path}" stroke="currentColor" fill="none" stroke-width="2" stroke-linejoin="round"/></svg>`;
    button.addEventListener('click', () => { close(); action(); button.blur(); }); panel.appendChild(button);
  }
  const journal = document.createElement('button');
  journal.type = 'button'; journal.className = 'hud-journal-dock';
  journal.setAttribute('aria-label', 'Journal'); journal.title = 'Journal';
  journal.innerHTML = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M7 3h19v26H7z" fill="#b8a4ff" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/><path d="M7 3H4v26h3M11 9h11m-11 6h11m-11 6h8" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>';
  journal.addEventListener('click', () => { close(); onJournal(); journal.blur(); });
  journal.addEventListener('keydown', (event) => { if (['Space', 'Enter'].includes(event.code)) event.stopPropagation(); });
  root.appendChild(journal);
  const dockGlass = document.createElement('div');
  dockGlass.className = 'hud-personal-glass'; dockGlass.setAttribute('aria-hidden', 'true'); root.appendChild(dockGlass);
  root.appendChild(el);
  let open = false;
  function close() {
    if (controlsHelp.isOpen) controlsHelp.close();
    open = false;
    juicePanel.hidden = true;
    juiceButton?.setAttribute('aria-expanded', 'false');
    el.classList.remove('open');
    root.classList.remove('options-open');
    toggle.setAttribute('aria-expanded', 'false');
    panel.inert = el.classList.contains('compact');
  }
  el.classList.add('compact');
  root.classList.add('compact-hud');
  close();
  toggle.addEventListener('click', () => {
    if (open) close();
    else {
      touch?.widget.reset();
      open = true;
      panel.inert = false;
      el.classList.add('open');
      root.classList.add('options-open');
      toggle.setAttribute('aria-expanded', 'true');
      panel.querySelector('button:not([hidden])')?.focus();
    }
  });
  document.addEventListener('pointerdown', (e) => { if (!el.contains(e.target)) close(); });
  pairPanel.button.addEventListener('click', () => { close(); pairPanel.button.blur(); });
  // Native button activation must not also become a game Interact press.
  el.addEventListener('keydown', (e) => {
    if (['Space', 'Enter'].includes(e.code)) e.stopPropagation();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !open) return;
    event.preventDefault(); event.stopPropagation(); close(); toggle.focus();
  });
  return { close, controlsHelp, get isOpen() { return open || !juicePanel.hidden || controlsHelp.isOpen; } };
}
