// World hint markers for a quest (Step 73b playtest fix): each target is an edge arrow while it is off screen (the regroup / objective arrows' look, `.hud-edge`) and, when the target asks for it,
// a small pin (label + downward arrow) over the point while it is on screen. Screen-local, DOM only; elements are pooled and hidden, never rebuilt per frame.
//
//   const m = createEdgeMarkers(root, { camera, cls? })      cls = an extra class for the colour (e.g. 'hud-edge-capray')
//   m.update([{ x, y, z, label, pin? }])                     every frame (an empty list hides them all)
//   m.summary() -> [{ label, show, pin }]
import * as THREE from 'three';

const EDGE_PAD = 34;
const SEEN_MARGIN = 0.92;           // a target inside this fraction of the screen counts as on screen

export function createEdgeMarkers(root, { camera, cls = '' }) {
  const pool = [];
  const v = new THREE.Vector3();
  function marker(i) {
    if (pool[i]) return pool[i];
    const el = document.createElement('div'); el.className = `hud-edge ${cls}`.trim();
    el.innerHTML = '<i class="he-arrow"></i><span class="he-label"></span>'; root.appendChild(el);
    return (pool[i] = { el, arrow: el.querySelector('.he-arrow'), label: el.querySelector('.he-label'), show: false, pin: false });
  }
  function set(m, show, pin) {
    if (m.show !== show) { m.show = show; m.el.classList.toggle('show', show); }
    if (m.pin !== pin) { m.pin = pin; m.el.classList.toggle('pin', pin); }
  }
  return {
    update(targets) {
      const w = window.innerWidth, h = window.innerHeight;
      if (targets.length && w > 0 && h > 0) camera.updateMatrixWorld();
      targets.forEach((tg, i) => {
        const m = marker(i);
        if (m.label.textContent !== tg.label) m.label.textContent = tg.label;
        if (!(w > 0 && h > 0)) { set(m, false, false); return; }
        v.set(tg.x, tg.y, tg.z).project(camera);
        let dx = v.x * w / 2, dy = -v.y * h / 2;
        if (v.z > 1) { dx = -dx; dy = -dy; }
        const onScreen = v.z <= 1 && Math.abs(v.x) < SEEN_MARGIN && Math.abs(v.y) < SEEN_MARGIN;
        if (onScreen) {
          set(m, !!tg.pin, true);
          if (!tg.pin) return;
          m.el.style.transform = `translate3d(${(w / 2 + dx).toFixed(1)}px, ${(h / 2 + dy).toFixed(1)}px, 0)`;
          m.arrow.style.transform = 'rotate(1.5708rad)';
          return;
        }
        set(m, true, false);
        const hx = w / 2 - EDGE_PAD, hy = h / 2 - EDGE_PAD, k = Math.min(hx / Math.max(1e-6, Math.abs(dx)), hy / Math.max(1e-6, Math.abs(dy)), 1);
        m.el.style.transform = `translate3d(${(w / 2 + dx * k).toFixed(1)}px, ${(h / 2 + dy * k).toFixed(1)}px, 0)`;
        m.arrow.style.transform = `rotate(${Math.atan2(dy, dx).toFixed(3)}rad)`;
      });
      for (let i = targets.length; i < pool.length; i++) set(pool[i], false, pool[i].pin);
    },
    summary: () => pool.map((m) => ({ label: m.label.textContent, show: m.show, pin: m.pin })),
  };
}
