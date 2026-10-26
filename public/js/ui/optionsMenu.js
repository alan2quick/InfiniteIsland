// Reuse the sound/pair buttons in a compact popover on touch hosts and narrow screens.
import { enterFullscreen } from './fullscreenPrompt.js';
/** Step 80e (?party&kiosk): everything in the options panel except the sound buttons (`keep`) is hidden: no pairing, fullscreen, combat feedback, friends or journal. Returns how many were hidden. */
export function lockOptions(children, keep) {
  let hidden = 0;
  for (const child of children) if (!keep.includes(child)) { child.style.display = 'none'; hidden++; }
  return hidden;
}
export function createOptionsMenu(root, { musicButton, muteButton, pairPanel, hud, touch, juice = null, onFriends = () => {}, onJournal = () => {}, locked = false }) {
  const el = document.createElement('div');
  el.className = 'hud-options';
  el.innerHTML = `<button type="button" class="hud-more-btn" aria-label="Options" aria-expanded="false" aria-controls="hud-options-panel">
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><g fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></g></svg>
    </button><div id="hud-options-panel" class="hud-options-panel" aria-label="Game options"></div>`;
  const toggle = el.querySelector('button');
  const panel = el.querySelector('.hud-options-panel');
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
  for (const [label, action, path] of [['Join a friend', onFriends, 'M5 7h14v12H5zM8 4h8M8 11h8m-8 4h5'], ['Journal', onJournal, 'M4 3h16v18H4zM8 7h8m-8 4h8m-8 4h5']]) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'hud-extra-option';
    button.setAttribute('aria-label', label); button.title = label;
    button.innerHTML = `<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="${path}" stroke="currentColor" fill="none" stroke-width="2" stroke-linejoin="round"/></svg>`;
    button.addEventListener('click', () => { close(); action(); button.blur(); }); panel.appendChild(button);
  }
  // Step 80e (?party&kiosk): the menu is locked down to the sound (music + mute): no pairing, fullscreen, combat feedback, friends or journal
  if (locked) lockOptions([...panel.children], [musicButton, muteButton]);
  root.appendChild(el);
  const narrow = window.matchMedia('(max-width: 519px)');
  let open = false;
  function close() {
    open = false;
    juicePanel.hidden = true;
    juiceButton?.setAttribute('aria-expanded', 'false');
    el.classList.remove('open');
    root.classList.remove('options-open');
    toggle.setAttribute('aria-expanded', 'false');
    panel.inert = el.classList.contains('compact');
  }
  function resize() {
    const compact = !!touch || narrow.matches;
    el.classList.toggle('compact', compact);
    root.classList.toggle('compact-hud', compact);
    close();
  }
  narrow.addEventListener('change', resize);
  resize();
  toggle.addEventListener('click', () => {
    if (open) close();
    else {
      touch?.widget.reset();
      open = true;
      panel.inert = false;
      el.classList.add('open');
      root.classList.add('options-open');
      toggle.setAttribute('aria-expanded', 'true');
    }
    toggle.blur();
  });
  document.addEventListener('pointerdown', (e) => { if (!el.contains(e.target)) close(); });
  pairPanel.button.addEventListener('click', () => { close(); pairPanel.button.blur(); });
  // Native button activation must not also become a game Interact press.
  el.addEventListener('keydown', (e) => {
    if (['Space', 'Enter'].includes(e.code)) e.stopPropagation();
  });
  return { close, get isOpen() { return open || !juicePanel.hidden; } };
}
