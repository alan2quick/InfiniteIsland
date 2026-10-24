// Read-only shared Bag panel (31a). Counts mirror inventory events; opening only freezes THIS screen's players.
// Keyboard Tab / B toggles from the game; inside, Tab keeps normal focus navigation. Cancel / backdrop closes.
// Controllers (gamepad Start, the phone pad's Bag button) toggle it through main.js; `drive(moves, dt)` lets their sticks switch the
// tab (left / right) and scroll the list (up / down).
// Step 52a: the Storybook tab (`storybook.stickers()` = pure sticker cards, game/chapters.js; `storybook.on('progress', fn)` refreshes it): a sticker per page of the Meadow chapter with its five letter slots,
// pressed flowers and cleared / secret marks (an uncleared page is a blank outline), plus the chapter badge once every letter of the chapter is found.
import { listItems } from '../game/catalog.js';
import { bagGroups } from './inventoryTracking.js';
import { createDungeonBook, renderReactions } from './dungeonBook.js';
import { reactionRows } from '../game/reactions.js';
import { BAG_SVG, STICKER_SVG, BADGE_SVG, SECRET_STAR_SVG, FLOWER_CARD_SVG } from './icons.js';
import { TOOLS, TOOL_BONUSES, ISLAND_SWINGS } from '../items/tools.js';

export function createBagPanel(root, { inventory, islands, collection = null, dungeon = null, players = null, storybook = null, unlocked = () => true, region = () => 'home', canOpen = () => true, onOpen = () => {}, onClose = () => {} }) {
  const el = document.createElement('div');
  el.className = 'bag-overlay'; el.hidden = true;
  el.innerHTML = `<section class="bag-panel" role="dialog" aria-modal="false" aria-labelledby="bag-title">
    <header><h2 id="bag-title">${BAG_SVG} Our Bag</h2><button type="button" class="bag-close" aria-label="Close bag">×</button></header>
    <p class="bag-intro">Shared by every islander. Supplies found on several islands are listed once.</p>
    <nav class="bag-tabs"><button type="button" data-tab="bag">Bag</button><button type="button" data-tab="journal">Journal</button><button type="button" data-tab="stickers">Storybook</button><button type="button" data-tab="tools">Tools</button><button type="button" data-tab="provisions" hidden>Provisions</button><button type="button" data-tab="guide" hidden>Compendium</button><button type="button" data-tab="weapons" hidden>Weapons</button><button type="button" data-tab="charms" hidden>Charms</button><button type="button" data-tab="reactions" hidden>Reactions</button></nav>
    <div class="bag-groups"></div><div class="journal-groups" hidden></div><div class="sticker-groups" hidden></div><div class="tool-groups" hidden></div><div class="dungeon-food-groups" hidden></div><div class="dungeon-guide-groups" hidden></div><div class="dungeon-weapons-groups" hidden></div><div class="dungeon-charms-groups" hidden></div><div class="dungeon-reactions-groups" hidden></div><footer>B / Cancel / Start to close · Tab to focus · Stick left / right for tabs</footer></section>`;
  root.appendChild(el);
  const panel = el.firstElementChild, closeButton = el.querySelector('.bag-close'), groups = el.querySelector('.bag-groups');
  const rows = new Map(), sections = new Map();
  const journal = el.querySelector('.journal-groups'), intro = el.querySelector('.bag-intro');
  const tools = el.querySelector('.tool-groups'), stickersEl = el.querySelector('.sticker-groups');
  const toolGuide = [
    { name: 'Axe', role: 'Lumber', description: `Gather ${(TOOL_BONUSES.axeLogs - 1) * 100}% more logs on average, including pine, birch and breadfruit logs. Choose it when stocking up for building or campfires.`, stats: `${TOOLS.axe.chop} hits per tree · ${TOOLS.axe.break} hits per rock · ${ISLAND_SWINGS.axe.duration}s swings` },
    { name: 'Sword', role: 'Speed and reach', description: `Faster swings and ${ISLAND_SWINGS.sword.reachBonus} units of extra harvesting reach, with normal resource yields. Choose it for quick harvesting from farther away.`, stats: `${TOOLS.sword.chop} hits per tree · ${TOOLS.sword.break} hits per rock · ${ISLAND_SWINGS.sword.duration}s swings` },
    { name: 'Hammer', role: 'Minerals', description: `${TOOL_BONUSES.hammerRare}× the chance of rare rock drops, including Journal discoveries, plus extra stone. Choose it for mining. It breaks rocks and shakes trees.`, stats: `${TOOLS.hammer.break} hits per rock · ${ISLAND_SWINGS.hammer.duration}s swings` },
    { name: 'Shovel', role: 'Buried finds', description: 'Dig for ingredients, rare finds and seeds. Bring one to uncover Ember Lily on the volcano ledge and Sunbell on the black-sand beach.', stats: `${TOOLS.shovel.dig} dig per soil mound · Cannot chop trees or break rocks` },
    { name: 'Glowline Rod', role: 'Marsh fishing', description: 'Found by the marsh hearth on Duskcrown. Stand at a pond, press Interact to cast (aim at a glowing ring), wait for the bite and press Interact the moment it plunges. A Lanternkoi fights back, so wait for each bite.', stats: 'Cannot chop, break or dig · Cancel reels in' },
  ];
  for (const entry of toolGuide) {
    const card = document.createElement('article'); card.className = 'tool-entry';
    const heading = document.createElement('h3'), role = document.createElement('span'), description = document.createElement('p'), stats = document.createElement('p');
    heading.textContent = entry.name; role.className = 'tool-role'; role.textContent = entry.role;
    description.textContent = entry.description; stats.className = 'tool-stats'; stats.textContent = entry.stats;
    card.append(heading, role, description, stats); tools.appendChild(card);
  }
  const toolNote = document.createElement('p'); toolNote.className = 'tool-note';
  toolNote.textContent = 'These bonuses apply to island gathering. The tool that lands the final hit determines the reward. Dungeon fighting styles are explained in the Weapons tab inside the ruins.';
  tools.appendChild(toolNote);
  const tabs = [...el.querySelectorAll('.bag-tabs button')];
  const provisions = el.querySelector('.dungeon-food-groups'), guide = el.querySelector('.dungeon-guide-groups'), weapons = el.querySelector('.dungeon-weapons-groups'), charms = el.querySelector('.dungeon-charms-groups'), reactionsEl = el.querySelector('.dungeon-reactions-groups');
  const book = dungeon ? createDungeonBook({ provisions, guide, weapons, charms, reactions: reactionsEl, dungeon, inventory, players }) : null;
  const inDungeon = () => !!dungeon?.state.active;
  const visibleTabs = () => tabs.filter((b) => !b.hidden);
  let currentTab = 'bag';
  function updateTabs() {
    const inside = inDungeon();
    for (const b of tabs) b.hidden = inside !== ['provisions', 'guide', 'weapons', 'charms', 'reactions'].includes(b.dataset.tab);
    el.querySelector('#bag-title').innerHTML = `${BAG_SVG} ${inside ? 'Dungeon supplies' : 'Our Bag'}`;
    el.querySelector('footer').textContent = inside ? 'Cancel / Start to close · Left / right to switch tabs · Select a meal to eat' : 'B / Cancel / Start to close · Tab to focus · Stick left / right for tabs';
    if (!visibleTabs().some((b) => b.dataset.tab === currentTab)) currentTab = inside ? 'provisions' : 'bag';
  }
  function selectTab(tab) {
    updateTabs();
    if (!visibleTabs().some((b) => b.dataset.tab === tab)) tab = inDungeon() ? 'guide' : 'bag';
    currentTab = tab;
    groups.hidden = tab !== 'bag'; journal.hidden = tab !== 'journal'; stickersEl.hidden = tab !== 'stickers';
    if (tab === 'stickers') renderStickers();
    tools.hidden = tab !== 'tools';
    provisions.hidden = tab !== 'provisions'; guide.hidden = tab !== 'guide'; weapons.hidden = tab !== 'weapons'; charms.hidden = tab !== 'charms'; reactionsEl.hidden = tab !== 'reactions';
    if (tab === 'provisions') book?.refresh();
    if (tab === 'guide') book?.buildGuide();
    if (tab === 'weapons') book?.buildWeapons();
    if (tab === 'charms') book?.refreshCharms();
    if (tab === 'reactions') book?.refreshReactions();
    intro.textContent = tab === 'bag' ? 'Shared by every islander. Supplies found on several islands are listed once.' : 'Discover beach glints and rare finds from shaking, digging and breaking rocks. Albums are shared by everyone.';
    if (tab === 'provisions') intro.textContent = 'Cooked meals from the shared party bag. Eating restores HP outside combat.';
    if (tab === 'guide') intro.textContent = 'Guardians of the combat areas and the rewards they guard.';
    if (tab === 'weapons') intro.textContent = 'Choose a fighting style for the ruins.';
    if (tab === 'charms') intro.textContent = 'Charms are spells you carry in your off hand. Press the Charm button to cast; they recharge.';
    if (tab === 'reactions') intro.textContent = 'Statuses on guardians combine. Try water, fire and frost together; every discovery is saved for the whole party.';
    if (tab === 'tools') intro.textContent = 'Choose a tool for the supplies you want to gather.';
    if (tab === 'stickers') intro.textContent = 'A sticker for every page of the great book. Clear pages and find all five letters to fill them in.';
    for (const b of tabs) { b.classList.toggle('selected', b.dataset.tab === tab); b.setAttribute('aria-pressed', String(b.dataset.tab === tab)); }
    refreshJournal();
  }
  // ---- the Storybook tab: sticker cards
  function renderStickers() {
    if (!storybook) return;
    const sets = storybook.stickerSets ? storybook.stickerSets() : [storybook.stickers()];                   // (Step 52b: one badge + card grid per chapter)
    stickersEl.textContent = '';
    for (const d of sets) renderStickerSet(d);
  }
  function renderStickerSet(d) {
    const badge = document.createElement('div');
    badge.className = 'sticker-badge' + (d.badge ? ' earned' : '');
    badge.innerHTML = `<span class="sb-ico">${BADGE_SVG}</span><div><b></b><span></span></div>`;
    badge.querySelector('b').textContent = d.badge ? `${d.name} badge` : `${d.name} chapter badge`;
    badge.querySelector('span:last-child').textContent = d.badge ? (d.rewarded ? 'Every letter found! The chapter reward is on the Cay.' : 'Every letter found!') : `Letters found ${d.lettersFound} / ${d.lettersTotal}. Find them all for a surprise on the Cay.`;
    badge.dataset.chapter = d.chapter;
    stickersEl.appendChild(badge);
    const grid = document.createElement('div'); grid.className = 'sticker-cards';
    d.cards.forEach((c, i) => {
      if (c.locked) return;                                                                          // (the secret page's sticker stays hidden until a secret exit is found)
      const used = c.cleared || c.letters.some((l) => l.found) || c.flowers.some((f) => f.found);
      const card = document.createElement('article');
      card.className = 'sticker-card' + (used ? '' : ' blank'); card.style.setProperty('--tilt', `${((i * 37) % 7 - 3) * 0.6}deg`);
      card.tabIndex = 0;
      const ico = document.createElement('div'); ico.className = 'st-ico'; ico.innerHTML = STICKER_SVG[c.icon] || STICKER_SVG.sun;
      const h = document.createElement('h3'); h.textContent = c.name;
      const letters = document.createElement('div'); letters.className = 'st-letters';
      if (!c.bonus) for (const l of c.letters) { const sp = document.createElement('span'); sp.className = 'st-l' + (l.found ? ' on' : ''); sp.textContent = l.ch; letters.appendChild(sp); }
      const flowers = document.createElement('div'); flowers.className = 'st-flowers';
      for (const f of c.flowers) { const it = document.createElement('i'); it.className = f.found ? 'on' : ''; it.innerHTML = FLOWER_CARD_SVG; flowers.appendChild(it); }
      const marks = document.createElement('div'); marks.className = 'st-marks';
      if (c.cleared) { const m = document.createElement('span'); m.className = 'st-cleared'; m.textContent = c.bonus ? 'Found!' : 'Cleared'; marks.appendChild(m); }
      if (c.hasSecret) { const st = document.createElement('span'); st.className = 'st-star' + (c.secret ? '' : ' off'); st.title = c.secret ? 'Secret exit found' : 'A secret exit hides on this page'; st.innerHTML = SECRET_STAR_SVG; marks.appendChild(st); }
      card.append(ico, h, letters, flowers, marks);
      grid.appendChild(card);
    });
    stickersEl.appendChild(grid);
  }
  storybook?.on('progress', () => { if (currentTab === 'stickers') renderStickers(); });
  const journalRows = new Map(), journalHeads = new Map();
  const journalIslands = collection ? islands.filter((i) => collection.definitions.some((d) => d.island === i.id)) : [];   // (Storybook Cay has no discoveries yet: no empty album)
  if (collection) for (const island of journalIslands) {
    const section = document.createElement('section'); section.className = 'bag-group';
    const head = document.createElement('h3'); journalHeads.set(island.id, head); section.appendChild(head);
    const list = document.createElement('ul'); section.appendChild(list);
    // Definitions are exposed on the log so the panel doesn't duplicate the collection catalog.
    for (const def of collection.definitions.filter((d) => d.island === island.id)) {
      const row = document.createElement('li'); row.dataset.id = def.id;
      row.innerHTML = `<span class="bag-icon"></span><span class="bag-name"></span><span class="journal-source"></span>`;
      journalRows.set(def.id, { row, def }); list.appendChild(row);
    }
    journal.appendChild(section);
  }
  // Step 60: the island Journal also lists the reactions the party has discovered (the same page as the Reactions tab inside the combat areas)
  const journalReactions = document.createElement('section'); journalReactions.className = 'journal-reactions'; journal.appendChild(journalReactions);
  function refreshJournal() {
    if (dungeon && currentTab === 'journal') renderReactions(journalReactions, reactionRows(dungeon.knownReactions?.() || []));
    if (!collection) return;
    for (const island of journalIslands) { const p = collection.progress(island.id); journalHeads.get(island.id).textContent = `${island.name} · ${p.have}/${p.total}${p.complete ? ' · Complete!' : ''}`; }
    for (const { row, def } of journalRows.values()) {
      const found = collection.has(def.id); row.classList.toggle('empty', !found);
      row.querySelector('.bag-icon').innerHTML = found ? def.icon : '?';
      row.querySelector('.bag-name').textContent = found ? def.name : 'Undiscovered';
      row.querySelector('.journal-source').textContent = def.source === 'beach' ? 'Beach' : ({ shake: 'Shake', dig: 'Dig', break: 'Rock', fish: 'Fishing' })[def.source];
    }
  }
  collection?.onChange(refreshJournal);
  for (const b of tabs) b.addEventListener('click', () => selectTab(b.dataset.tab));
  for (const group of bagGroups(listItems(), islands)) {
    const section = document.createElement('section'); section.className = 'bag-group';
    sections.set(group.id, section);
    const heading = document.createElement('h3'); heading.textContent = group.name; section.appendChild(heading);
    const list = document.createElement('ul'); section.appendChild(list);
    for (const def of group.items) {
      const row = document.createElement('li'); row.dataset.id = def.id;
      row.innerHTML = `<span class="bag-icon">${def.icon}</span><span class="bag-name"></span><span class="bag-count"></span>`;
      row.querySelector('.bag-name').textContent = def.name;
      rows.set(def.id, row); list.appendChild(row);
    }
    groups.appendChild(section);
  }
  let open = false, previousFocus = null;
  function refresh() {
    if (open && currentTab === 'provisions') book?.refresh();
    const visible = bagGroups(listItems(), islands, { count: (id) => inventory.count(id), unlocked, current: region() });
    const ids = new Set(visible.flatMap((g) => g.items.map((d) => d.id)));
    for (const section of sections.values()) section.hidden = true;
    for (const group of visible) {
      const section = sections.get(group.id);
      section.hidden = false; groups.appendChild(section);
    }
    for (const [id, row] of rows) {
      const n = inventory.count(id);
      row.hidden = !ids.has(id);
      row.querySelector('.bag-count').textContent = `×${n}`;
    }
  }
  inventory.on('change', refresh);
  function close() {
    if (!open) return;
    open = false; el.hidden = true; root.classList.remove('bag-open');
    onClose();
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  }
  function show(owner) {
    if (open || !canOpen()) return false;
    book?.setOwner(owner); updateTabs();
    previousFocus = document.activeElement;
    refresh(); selectTab(currentTab); open = true; el.hidden = false; root.classList.add('bag-open');
    onOpen(); closeButton.focus({ preventScroll: true }); return true;
  }
  closeButton.addEventListener('click', close);
  el.addEventListener('pointerdown', (e) => { if (e.target === el) close(); });
  el.addEventListener('keydown', (e) => {
    if (!e.ctrlKey && !e.metaKey && !e.altKey && ['KeyB', 'Escape', 'KeyQ', 'Backspace'].includes(e.code)) {
      e.preventDefault(); if (!e.repeat) close();
    }
    e.stopPropagation();
  });
  // controller sticks (main.js passes every local player's move): a push past 0.6 left / right switches the tab once, up / down scrolls
  let tabLatch = 0;
  let locationKey = '';
  let mealLatch = 0, refreshT = 0;
  function drive(moves, dt, actions = []) {
    refreshT += dt;
    if (inDungeon() && refreshT > 0.4) { refreshT = 0; updateTabs(); if (currentTab === 'provisions') book.refresh(); }
    const nextKey = inDungeon() + ':' + region() + ':' + islands.filter((i) => unlocked(i.id)).map((i) => i.id).join(',');
    if (nextKey !== locationKey) { locationKey = nextKey; updateTabs(); selectTab(currentTab); refresh(); }
    let x = 0, z = 0;
    for (const m of moves) { if (Math.abs(m.x) > Math.abs(x)) x = m.x; if (Math.abs(m.z) > Math.abs(z)) z = m.z; }
    const dir = x > 0.6 ? 1 : x < -0.6 ? -1 : 0;
    if (dir && dir !== tabLatch) {
      const available = visibleTabs();
      const i = available.findIndex((b) => b.dataset.tab === currentTab);
      selectTab(available[(i + dir + available.length) % available.length].dataset.tab);
    }
    tabLatch = Math.abs(x) > 0.35 ? (dir || tabLatch) : 0;
    if (currentTab === 'provisions') {
      const meals = [...provisions.querySelectorAll('button:not(:disabled)')];
      const step = z > 0.6 ? 1 : z < -0.6 ? -1 : 0;
      if (step && step !== mealLatch && meals.length) { const i = meals.indexOf(document.activeElement); meals[(i + step + meals.length) % meals.length].focus(); }
      mealLatch = Math.abs(z) > 0.35 ? (step || mealLatch) : 0;
      if (actions.some((a) => a.interactPressed || a.jumpPressed) && meals.includes(document.activeElement)) document.activeElement.click();
    }
    if (Math.abs(z) > 0.2) ({ bag: groups, journal, stickers: stickersEl, tools, provisions, guide, weapons, charms, reactions: reactionsEl })[currentTab].scrollTop += z * 700 * dt;
  }
  return { open: show, close, drive, journal() { selectTab('journal'); return show(); }, openTab(tab, owner) { selectTab(tab); return open || show(owner); }, toggle: (owner) => open ? close() : show(owner), get isOpen() { return open; }, get activeTab() { return currentTab; }, element: el, panel };
}
