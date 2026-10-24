// Region-selected quest card. No active quest in the camera region means a hidden tracker.
import { QUEST_SVG } from './icons.js';


const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const CHECK_SVG = '<svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><path d="M5.6 12.8l4.2 4.2 8.6-9.4" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export function createQuestTracker(root, { quests, inventory, hud = null, sfx = null, region = () => 'home', readyText = () => 'Return to the campfire!' }) {
  const el = document.createElement('div');
  el.className = 'quest-tracker';
  el.hidden = true;
  el.innerHTML = `
    <div class="qt-card">
      <div class="qt-category">Quest</div>
      <div class="qt-head" role="button" tabindex="0" aria-label="Expand quest objectives" aria-expanded="false">
        <span class="qt-badge">${QUEST_SVG}</span>
        <span class="qt-name"></span>
        <span class="qt-count"></span>
        <span class="qt-chev" aria-hidden="true"></span>
      </div>
      <div class="qt-rows"></div>
      <div class="qt-ready">Return to the campfire!</div>
      <div class="qt-foot"><span class="qt-feasts"></span></div>
    </div>
    `;
  root.appendChild(el);
  const card = el.querySelector('.qt-card');
  const head = el.querySelector('.qt-head');
  const nameEl = el.querySelector('.qt-name');
  const countEl = el.querySelector('.qt-count');
  const rowsEl = el.querySelector('.qt-rows');
  const feastsEl = el.querySelector('.qt-feasts');
  const readyEl = el.querySelector('.qt-ready');

  let shownQuest = null;        // template the rows were built for
  let rowEls = new Map();       // item id -> { el, n, done }
  let allDone = false;
  let open = false;

  function toggle() {
    open = !open;
    el.classList.toggle('open', open);
    head.setAttribute('aria-expanded', String(open));
  }
  head.addEventListener('click', toggle);
  head.addEventListener('keydown', (event) => {
    if (event.code !== 'Space' && event.code !== 'Enter') return;
    event.preventDefault(); event.stopPropagation(); toggle();
  });
  // Inventory wraps as resources change. Measure its actual top instead of reserving a fixed row.
  function positionAboveInventory() {
    if (!root.getBoundingClientRect || typeof getComputedStyle !== 'function') return;
    const bounds = root.getBoundingClientRect(), inventoryBar = root.querySelector('.hud-inv');
    const inventoryBounds = inventoryBar?.getBoundingClientRect();
    if (inventoryBounds?.height > 0 && getComputedStyle(inventoryBar).display !== 'none') {
      el.style.setProperty('--quest-bottom', `${Math.max(14, bounds.bottom - inventoryBounds.top + 12)}px`);
    } else el.style.removeProperty('--quest-bottom');
    const bottom = parseFloat(getComputedStyle(el).bottom) || 14;
    const shortTouch = root.classList.contains('touch-host') && bounds.height < 500;
    const topLimit = shortTouch ? 145 : bounds.height * 0.5 + 148;
    el.style.maxHeight = `${Math.max(70, bounds.height - bottom - topLimit)}px`;
  }
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(positionAboveInventory);
    observer.observe(root);
    const inventoryBar = root.querySelector('.hud-inv');
    if (inventoryBar) observer.observe(inventoryBar);
  }
  positionAboveInventory();

  const pop = (node, cls = 'pop') => { node.classList.remove(cls); void node.offsetWidth; node.classList.add(cls); };

  function buildRows(q) {
    rowsEl.innerHTML = '';
    rowEls = new Map();
    for (const r of quests.progress(region())) {
      const row = document.createElement('div');
      row.className = 'qt-row';
      row.dataset.id = r.id;
      row.innerHTML = `<span class="qt-check">${CHECK_SVG}</span><span class="qt-ic">${r.def ? r.def.icon : ''}</span><span class="qt-label">${esc(r.def ? r.def.name : r.id)}</span><span class="qt-n"></span>`;
      rowsEl.appendChild(row);
      rowEls.set(r.id, { el: row, n: row.querySelector('.qt-n'), done: false });
    }
    nameEl.textContent = q.name;
  }

  /** Sync rows / header with the bag. `announce` = play the little pops and sounds for rows that just became satisfied. */
  function sync(announce) {
    const q = quests.activeFor(region());
    if (!q) return;
    let doneN = 0, total = 0, newly = 0;
    for (const r of quests.progress(region())) {
      total++;
      const row = rowEls.get(r.id);
      if (!row) continue;
      row.n.textContent = `${Math.min(r.have, r.need)}/${r.need}`;
      if (r.done) doneN++;
      if (r.done !== row.done) {
        row.done = r.done;
        row.el.classList.toggle('done', r.done);
        if (announce && r.done) { pop(row.el); newly++; }
      }
    }
    countEl.textContent = `${doneN}/${total}`;
    readyEl.textContent = readyText();
    const nowAll = doneN === total;
    if (nowAll !== allDone) {
      allDone = nowAll;
      el.classList.toggle('ready', nowAll);
      if (announce && nowAll) {
        pop(card, 'cheer');
        if (sfx) sfx.play('cooked', { vol: 0.8 });
        if (hud) hud.toast(`Everything gathered! ${readyText()}`, { icon: 'feast', duration: 3200 });
        newly = 0;
      }
    }
    if (announce && newly && sfx) sfx.play('chime', { pitch: 1.3, vol: 0.6 });
  }

  function render(animate = true) {
    const q = quests.activeFor(region());
    feastsEl.textContent = `Feasts: ${quests.feasts}`;
    if (!q) {
      if (shownQuest) { shownQuest = null; rowEls = new Map(); allDone = false; el.classList.remove('ready', 'has-quest'); }
      el.hidden = true; nameEl.textContent = ""; countEl.textContent = "";
      return;
    }
    el.hidden = false;
    el.classList.remove('idle');
    el.classList.add('has-quest');
    if (shownQuest !== q) {
      shownQuest = q;
      allDone = false;
      el.classList.remove('ready');
      buildRows(q);
      open = false;
      el.classList.remove('open');
      head.setAttribute('aria-expanded', 'false');
      if (animate) pop(card, 'enter');
      sync(false);
      if (quests.satisfiedAt(region())) { allDone = true; el.classList.add('ready'); }
    } else {
      sync(false);
    }
  }

  inventory.on('change', () => { if (quests.activeFor(region()) && shownQuest === quests.activeFor(region())) sync(true); });
  quests.on('change', () => render(true));
  render(false);

  return {
    element: el,
    update(dt) {
      if (shownQuest !== quests.activeFor(region())) render(false);
    },
    flashIdle() { render(false); },
    summary() {
      return { region: region(), hidden: el.hidden, idle: el.classList.contains('idle'), name: nameEl.textContent, count: countEl.textContent, ready: allDone, feasts: feastsEl.textContent, rows: [...rowEls].map(([id, r]) => `${id} ${r.n.textContent}${r.done ? ' ok' : ''}`) };
    },
  };
}
