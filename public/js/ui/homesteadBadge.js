// Step 86c: the Homesteading HUD badge: a comic pill "Homesteading" with the house-and-leaf icon and the budget meter.
//
//   const badge = createHomesteadBadge(root);
//   badge.update(show, budget)      every frame; `budget` = homestead.budget() ({ main: { used, budget }, deco: { used, budget } }). The badge is per SCREEN (not per player): it shows while ANY local player is in the mode,
//                                   because the budget is shared by everyone on the island. The DOM is only touched when a number changes.
// The two meters are "Island used / budget" (the main size-point budget: trees and palms 3, rocks and bushes 2, the rest 1) and "Decor used / budget" (flowers). A meter turns red when full.
import { ICONS } from './icons.js';

export function createHomesteadBadge(root) {
  const el = document.createElement('div');
  el.className = 'homestead-badge';
  el.hidden = true;
  el.setAttribute('role', 'status');
  el.innerHTML = `<span class="hb-head"><span class="hb-icon">${ICONS.homestead}</span><span class="hb-title">Homesteading</span></span>
    <span class="hb-meters"><span class="hb-meter hb-main" title="Island budget"><i class="hb-bar"><b></b></i><span class="hb-label">Island</span><span class="hb-num"></span></span>
    <span class="hb-meter hb-deco" title="Decoration budget"><i class="hb-bar"><b></b></i><span class="hb-label">Decor</span><span class="hb-num"></span></span></span>`;
  root.appendChild(el);
  const parts = ['main', 'deco'].map((k) => {
    const m = el.querySelector('.hb-' + k);
    return { k, m, num: m.querySelector('.hb-num'), fill: m.querySelector('b'), shown: '' };
  });
  let shown = false;
  return {
    el,
    update(show, budget) {
      show = !!show;
      if (show !== shown) { shown = show; el.hidden = !show; if (show) { el.classList.remove('enter'); void el.offsetWidth; el.classList.add('enter'); } }
      if (!show || !budget) return;
      for (const p of parts) {
        const u = budget[p.k];
        const text = `${u.used} / ${u.budget}`;
        if (text === p.shown) continue;
        p.shown = text;
        p.num.textContent = text;
        p.fill.style.width = `${Math.max(0, Math.min(100, (u.used / Math.max(1, u.budget)) * 100)).toFixed(1)}%`;
        p.m.classList.toggle('full', u.used >= u.budget);
      }
    },
  };
}
