// Passive illustrated day-cycle indicator. It reads the clock and never changes it.
const smooth = (n) => { const t = Math.max(0, Math.min(1, n)); return t * t * (3 - 2 * t); };
export function dayCycleView(hour) {
  const h = Number.isFinite(hour) ? ((hour % 24) + 24) % 24 : 8;
  const progress = h / 24;
  const moon = h < 5 ? 1 : h < 6 ? 1 - smooth(h - 5) : h < 19 ? 0 : h < 20 ? smooth(h - 19) : 1;
  return {
    phase: h >= 5.5 && h < 12 ? 'Morning' : h >= 12 && h < 19.5 ? 'Afternoon' : 'Night',
    x: 15 + progress * 210,
    y: 36 - Math.sin(progress * Math.PI) * 19,
    moon,
    wheelX: 50 + Math.sin(progress * Math.PI * 2) * 25,
    wheelY: 50 - Math.cos(progress * Math.PI * 2) * 25,
  };
}

export function createTimeDial(root, { clock }) {
  const el = document.createElement('div');
  el.className = 'hud-time-dial';
  el.setAttribute('role', 'img');
  el.innerHTML = `<svg class="time-track" viewBox="0 0 240 58" preserveAspectRatio="none" aria-hidden="true" focusable="false">
    <path d="M15 38 Q120 -3 225 38" fill="none" stroke="#796a86" stroke-width="1.4" stroke-linecap="round" stroke-dasharray="2 5"/>
    </svg><svg class="time-wheel" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <circle cx="32" cy="32" r="16" fill="none" stroke="#796a86" stroke-width="1.4" stroke-linecap="round" stroke-dasharray="1 4"/>
    </svg><span class="time-body"><svg viewBox="-15 -15 30 30" aria-hidden="true" focusable="false">
      <g class="time-sun"><g stroke="#efa84b" stroke-width="1.7" stroke-linecap="round"><path d="M0-13v2M0 11v2M-13 0h2M11 0h2M-9-9l1.5 1.5M7.5 7.5L9 9M-9 9l1.5-1.5M7.5-7.5L9-9"/></g><circle r="9" fill="#ffe984" stroke="#d89645" stroke-width="1.5"/><g fill="#49324f"><ellipse cx="-3" cy="0" rx="1" ry="1.3"/><ellipse cx="3" cy="0" rx="1" ry="1.3"/></g><path d="M-1.6 3q1.6 2 3.2 0" fill="none" stroke="#49324f" stroke-width="1.1" stroke-linecap="round"/></g>
      <g class="time-moon"><path d="M4-10A11 11 0 1 0 10 6A10 10 0 0 1 4-10Z" fill="#fff1b9" stroke="#8a749d" stroke-width="1.4"/><path d="M-7 1q1.5 2 3 0m1 3q1.5 2 3 0" fill="none" stroke="#49324f" stroke-width="1.1" stroke-linecap="round"/></g>
  </svg></span>`;
  root.appendChild(el);
  const body = el.querySelector('.time-body'), sun = el.querySelector('.time-sun'), moon = el.querySelector('.time-moon');
  let last = '', lastPhase = '';
  function update(currentClock = clock) {
    const view = dayCycleView(currentClock.hour);
    const left = (view.x / 240 * 100).toFixed(3), top = (view.y / 58 * 100).toFixed(3), opacity = view.moon.toFixed(3);
    const wheelX = view.wheelX.toFixed(3), wheelY = view.wheelY.toFixed(3);
    const key = `${left}/${top}/${wheelX}/${wheelY}/${opacity}`;
    if (key !== last) {
      body.style.setProperty('--time-x', `${left}%`);
      body.style.setProperty('--time-y', `${top}%`);
      body.style.setProperty('--wheel-x', `${wheelX}%`);
      body.style.setProperty('--wheel-y', `${wheelY}%`);
      sun.setAttribute('opacity', (1 - view.moon).toFixed(3));
      moon.setAttribute('opacity', opacity);
      last = key;
    }
    if (view.phase !== lastPhase) {
      el.setAttribute('aria-label', `Day cycle: ${view.phase}`);
      el.title = view.phase;
      lastPhase = view.phase;
    }
  }
  update();
  return { element: el, update };
}
