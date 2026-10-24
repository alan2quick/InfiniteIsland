// Non-blocking title card shown on load: bouncy pastel "Infinite Island" logo
// + the game version (config.VERSION).
// Fades out after `duration` seconds of game time, or as soon as dismiss() is called (first input).
//
//   const title = new TitleCard(hudRoot, { duration: 2.6 });
//   title.update(dt)        // every tick
//   title.dismiss()         // e.g. on first input
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

    const ver = document.createElement('div');
    ver.className = 'title-version';
    ver.textContent = `v${VERSION}`;
    el.appendChild(ver);
    root.appendChild(el);
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
