// Non-blocking title card shown on load: bouncy pastel "Infinite Island" logo + a controls hint (inline SVG icons)
// + the game version (config.VERSION).
// Fades out after `duration` seconds of game time, or as soon as dismiss() is called (first input).
//
//   const title = new TitleCard(hudRoot, { duration: 2.6 });
//   title.update(dt)        // every tick
//   title.dismiss()         // e.g. on first input
import { GAMEPAD_SVG, PHONE_SVG } from './icons.js';
import { VERSION } from '../config.js';

const LETTER_COLORS = ['#ff8fbe', '#ffd54a', '#7fe3b0', '#7cc8ff', '#c7a6ff', '#ffb27a'];

export class TitleCard {
  constructor(root, { duration = 2.6 } = {}) {
    this.duration = duration;
    this.age = 0;
    this.done = false;
    const el = this.el = document.createElement('div');
    el.className = 'title-card';
    el.setAttribute('aria-hidden', 'true');

    const logo = document.createElement('div');
    logo.className = 'title-logo';
    const words = ['Infinite', 'Island'];
    let li = 0;
    words.forEach((word, wi) => {
      const w = document.createElement('span');
      w.className = 'title-word';
      for (const ch of word) {
        const l = document.createElement('span');
        l.className = 'title-letter';
        l.textContent = ch;
        l.style.setProperty('--i', li);
        l.style.setProperty('--c', LETTER_COLORS[li % LETTER_COLORS.length]);
        l.style.setProperty('--r', ((li % 3) - 1) * 3 + 'deg');
        w.appendChild(l);
        li++;
      }
      logo.appendChild(w);
      if (wi < words.length - 1) logo.appendChild(document.createTextNode(' '));
    });
    el.appendChild(logo);

    const hint = document.createElement('div');
    hint.className = 'title-hint';
    hint.innerHTML = `
      <span class="th-group"><b class="th-key">WASD</b><i>/</i>${GAMEPAD_SVG}<i>/</i>${PHONE_SVG}<span>to move</span></span>
      <span class="th-dot">&bull;</span>
      <span class="th-group"><b class="th-key">E</b><i>/</i><b class="th-pad">A</b><span>to interact</span></span>`;
    el.appendChild(hint);

    const ver = document.createElement('div');
    ver.className = 'title-version';
    ver.textContent = `v${VERSION}`;
    el.appendChild(ver);
    root.appendChild(el);
  }

  /** Step 80e (?party&kiosk): never shown at all (no fade, no timer). */
  skip() {
    this.done = true;
    this.el.remove();
  }

  dismiss() {
    if (this.done) return;
    this.done = true;
    this.el.classList.add('out');
    const el = this.el;
    const kill = () => el.remove();
    el.addEventListener('animationend', (e) => { if (e.animationName === 'title-out') kill(); });
    setTimeout(kill, 1200);          // fallback if animations are throttled / disabled
  }

  update(dt) {
    if (this.done) return;
    this.age += dt;
    if (this.age >= this.duration) this.dismiss();
  }
}
