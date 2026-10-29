// Comic-style dialog box: name tag, typewriter text, bouncing triangle when a page is done, multiple pages, and (Step 14) choice menus.
// Optional `onChar(char)` callback fires when typewriter text is revealed (used for the quiet text blips).
//
//   const dialog = new Dialog(hudRoot, { onOpen, onClose, onChar, onMenu });
//   dialog.open({ name: 'Signpost', pages: ['Hello!', 'Second page'], owner: player, tag: 'P2', color: '#5fc4ff' });
//   dialog.handleInput(interactPressed, cancelPressed, moveY = 0)   // call with the OWNER's presses (+ its stick: actions.move.z, up = negative) while
//                                                                   // dialog.isOpen (it consumes them)
//   dialog.update(dt)                                    // typewriter + menu repeat clock
//   dialog.isOpen / dialog.isMenu
//   dialog.owner                                         // the player who opened it (main.js routes only that player's input here and
//                                                        // freezes only that player); null while closed. Optional `tag` / `color` add a
//                                                        // small coloured "P2" badge to the name tag (multiplayer).
//
// Pages mode (the signpost): Interact: if typing -> finish the page; else next page / close after the last. Cancel closes immediately.
// Clicking / tapping the box behaves like Interact.  `onFinish` (optional) replaces the close when the last page is done or Cancel is pressed.
//
// Choice menus (the campfire): open({ name, text: 'one line above the list', owner, menuId, choices, onCancel })
//   text / choices may also be FUNCTIONS (re-evaluated by dialog.refresh(): labels, counts and disabled flags that change while the menu is open).
//   choices: [{ label, detail?, icon? (svg string), chips?: [{ icon, have, need }] (ingredient icons with have/need counts),
//               disabled?, onSelect(choice, dialog) }]  or a function returning that array (re-evaluated by dialog.refresh()).
//               Step 86d (Homesteading's palette): `pips: n` draws n small leaf icons (a size weight), `tabs: [{ label, active }]` makes the row a segmented tab switch (selecting it runs onSelect, which flips the tab and calls dialog.refresh()),
//               `reason` is a short sentence under a disabled row (why it is greyed out).
//   The owner moves the highlighted row with move up / down (stick, d-pad, W/S, arrows, phone stick: the first push moves at once and holding
//   repeats every ~0.25 s after a short delay), Interact selects, Cancel runs `onCancel(dialog)` (or closes). Tapping / clicking a row selects it.
//   Selecting a disabled row shakes it (and calls its `onDisabled`); otherwise `onSelect` runs and is responsible for closing the dialog or
//   opening another menu / text:
//     dialog.showChoices(choices, { text, index, onCancel })   // swap the content for another menu (sub-menus: pass onCancel to go back)
//     dialog.showPages(pages, { onFinish, name })              // swap the content for plain text pages
//     (showChoices / showPages: an optional `name` also swaps the name tag, e.g. 'Campfire Spirit')
//     dialog.refresh()                                         // re-evaluate a function `choices` (keeps the highlighted row)
//     dialog.menuId                                            // the `menuId` given to open() (lets a system find "its" menu), '' otherwise
//   `onMenu(kind)` (constructor) gets 'move' | 'select' | 'denied' | 'back' for sounds.
const CHARS_PER_SEC = 46;
const NAV_DEAD = 0.5;          // |stick| above this counts as a push
const NAV_FIRST = 0.35;        // s before a held direction starts repeating
const NAV_REPEAT = 0.25;       // s between repeats

const LEAF_PIP = '<svg class="hc-pip" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><path d="M5 19C4 10 9 4 20 4c0 11-5 16-13 15z" fill="#7fd35c" stroke="#2b2340" stroke-width="2.4" stroke-linejoin="round"/><path d="M5 19 13 11" stroke="#2b2340" stroke-width="2" stroke-linecap="round"/></svg>';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class Dialog {
  constructor(root, { onOpen = null, onClose = null, onChar = null, onMenu = null } = {}) {
    this.root = root;
    this.onChar = onChar;
    this.onOpen = onOpen;
    this.onClose = onClose;
    this.onMenu = onMenu;
    this.isOpen = false;
    this.owner = null;
    this.menuId = '';
    this.pages = [];
    this.page = 0;
    this.menu = null;          // { source, choices, sel, text, onCancel } while a choice menu is showing
    this._onFinish = null;
    this._chars = 0;           // characters revealed on the current page
    this._text = '';
    this._acc = 0;
    this.pageDone = false;
    this._clock = 0;           // advances with update(dt): menu repeat timing
    this._navHeld = 0;
    this._navAt = 0;

    const el = document.createElement('div');
    el.className = 'hud-dialog';
    el.hidden = true;
    el.innerHTML = `
      <div class="hud-dialog-box">
        <div class="hud-dialog-name"><span class="hud-dialog-title"></span><span class="hud-dialog-tag" hidden></span></div>
        <div class="hud-dialog-text"><span class="on"></span><span class="off"></span></div>
        <div class="hud-dialog-menu" role="menu" hidden></div>
        <div class="hud-dialog-next" aria-hidden="true"></div>
      </div>`;
    root.appendChild(el);
    this.el = el;
    this.nameEl = el.querySelector('.hud-dialog-name');
    this.titleEl = el.querySelector('.hud-dialog-title');
    this.tagEl = el.querySelector('.hud-dialog-tag');
    this.textEl = el.querySelector('.hud-dialog-text');
    this.onEl = el.querySelector('.on');
    this.offEl = el.querySelector('.off');
    this.menuEl = el.querySelector('.hud-dialog-menu');
    this.nextEl = el.querySelector('.hud-dialog-next');
    let gesture = null;
    el.addEventListener('pointerdown', (e) => {
      if (!this.isOpen || gesture || e.button !== 0) return;
      e.preventDefault();
      const row = e.target.closest('.hud-choice');
      gesture = { id: e.pointerId, y: e.clientY, startX: e.clientX, startY: e.clientY, dragged: false, row: row ? Number(row.dataset.i) : null, menu: this.menu };
      try { el.setPointerCapture(e.pointerId); } catch (_) { /* synthetic pointer */ }
    });
    el.addEventListener('pointermove', (e) => {
      if (!gesture || gesture.id !== e.pointerId) return;
      if (Math.hypot(e.clientX - gesture.startX, e.clientY - gesture.startY) > 10) gesture.dragged = true;
      const dy = e.clientY - gesture.y;
      if (this.menu && this.menu === gesture.menu && Math.abs(dy) >= 32) {
        this._moveSel(dy < 0 ? 1 : -1);
        gesture.y = e.clientY;
      } else if (!this.menu && gesture.dragged) {
        this.textEl.scrollTop -= dy;
        gesture.y = e.clientY;
      }
    });
    el.addEventListener('pointerup', (e) => {
      if (!gesture || gesture.id !== e.pointerId) return;
      const g = gesture;
      gesture = null;
      if (!this.isOpen || g.dragged || this.menu !== g.menu) return;
      if (this.menu) {
        if (g.row !== null) { this.menu.sel = g.row; this._renderMenu(); this._selectMenu(); }
      } else this.handleInput(true, false);
    });
    const cancelGesture = () => { gesture = null; };
    el.addEventListener('pointercancel', cancelGesture);
    el.addEventListener('lostpointercapture', cancelGesture);
  }

  get isMenu() { return this.isOpen && !!this.menu; }

  open({ name = '', pages = [''], owner = null, tag = '', color = '', choices = null, text = '', menuId = '', onCancel = null, onFinish = null, index = null } = {}) {
    if (this.isOpen) return;
    this.owner = owner;
    this.menuId = menuId;
    this.titleEl.textContent = name;
    this.nameEl.hidden = !name;
    this.tagEl.hidden = !tag;
    this.tagEl.textContent = tag;
    if (color) this.tagEl.style.setProperty('--pc', color);
    this.isOpen = true;
    this.root.classList.add('dialog-open');
    this.el.hidden = false;
    this.el.classList.remove('closing');
    void this.el.offsetWidth;
    this.el.classList.add('open');
    this._navHeld = 9;                      // a stick already held while opening does not scroll until it is released
    if (choices) this._setMenu(choices, { text, onCancel, index });
    else this._setPages(pages, onFinish);
    if (this.onOpen) this.onOpen(this);
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.classList.remove('dialog-open');
    this.menu = null;
    this.el.classList.remove('open');
    this.el.classList.add('closing');
    const el = this.el;
    const finish = () => { if (!this.isOpen) { el.hidden = true; el.classList.remove('closing'); } };
    el.addEventListener('animationend', finish, { once: true });
    setTimeout(finish, 300);
    if (this.onClose) this.onClose(this);      // (still knows its owner here)
    this.owner = null;
    this.menuId = '';
    this._onFinish = null;
  }

  // ------------------------------------------------------------------ content swapping
  _setPages(pages, onFinish = null) {
    this.menu = null;
    this.menuEl.hidden = true;
    this.menuEl.innerHTML = '';
    this.el.classList.remove('menu');
    this.textEl.hidden = false;
    this.pages = pages.slice();
    this.page = 0;
    this._onFinish = onFinish;
    this._startPage();
  }

  /** Swap the content for plain typewriter pages (e.g. the campfire's placeholder quest text); `onFinish` runs after the last page / on Cancel instead of closing. */
  showPages(pages, { onFinish = null, name = null } = {}) {
    if (!this.isOpen) return;
    this._setName(name);
    this._navHeld = 9;
    this._setPages(pages, onFinish);
  }

  /** Change the name tag (null / undefined keeps it): the campfire spirit speaks in the quest pages. */
  _setName(name) {
    if (name == null) return;
    this.titleEl.textContent = name;
    this.nameEl.hidden = !name;
  }

  _setMenu(choices, { text = '', onCancel = null, index = null } = {}) {
    const source = typeof choices === 'function' ? choices : null;
    const list = (source ? source() : choices) || [];
    let sel = index;
    if (sel == null || sel < 0 || sel >= list.length) sel = Math.max(0, list.findIndex((c) => !c.disabled));   // start on the first usable row
    const textSrc = typeof text === 'function' ? text : null;
    if (textSrc) text = textSrc() || '';
    this.menu = { source, choices: list, sel, text, textSrc, onCancel };
    this._onFinish = null;
    this.pageDone = true;
    this.nextEl.classList.remove('show');
    this.el.classList.add('menu');
    this.textEl.hidden = !text;
    this.onEl.textContent = text;
    this.offEl.textContent = '';
    this.menuEl.hidden = false;
    this._renderMenu();
  }

  /** Swap the content for a choice menu (sub-menus). `onCancel(dialog)` runs on Cancel (default: close). */
  showChoices(choices, opts = {}) {
    if (!this.isOpen) return;
    this._setName(opts.name);
    this._navHeld = 9;                         // a stick still held from the last menu doesn't scroll the new one until it is released
    this._setMenu(choices, opts);
  }

  /** Re-evaluate a function `choices` (labels / disabled flags changed) keeping the highlighted row. No-op for static menus. */
  refresh() {
    const m = this.menu;
    if (!this.isOpen || !m || !(m.source || m.textSrc)) return;
    if (m.textSrc) { m.text = m.textSrc() || ''; this.textEl.hidden = !m.text; this.onEl.textContent = m.text; }
    if (m.source) m.choices = m.source() || [];
    m.sel = Math.min(Math.max(0, m.sel), Math.max(0, m.choices.length - 1));
    this._renderMenu();
  }

  _renderMenu() {
    const m = this.menu;
    if (!m) return;
    const keepScroll = this.menuEl.scrollTop;                       // Step 86f: re-rendering resets the scroll; keep it, then bring the selected row into the menu's own viewport
    this.menuEl.innerHTML = m.choices.map((c, i) => {
      const chips = (c.chips || []).map((k) =>
        `<span class="hc-chip${k.have >= k.need ? ' ok' : ' no'}"><span class="hc-chip-ic">${k.icon}</span><span class="hc-chip-n">${k.have}/${k.need}</span></span>`).join('');
      const tabs = c.tabs ? `<span class="hc-tabs">${c.tabs.map((t) => `<span class="hc-tab${t.active ? ' on' : ''}">${esc(t.label)}</span>`).join('')}</span>` : '';
      const pips = c.pips ? `<span class="hc-pips" title="Island room it takes">${LEAF_PIP.repeat(c.pips)}</span>` : '';
      return `<div class="hud-choice${i === m.sel ? ' sel' : ''}${c.disabled ? ' disabled' : ''}${c.tabs ? ' tabrow' : ''}" data-i="${i}" role="menuitem"${c.disabled ? ' aria-disabled="true"' : ''}>
        <span class="hc-ptr"></span>${c.icon ? `<span class="hc-icon">${c.icon}</span>` : ''}
        ${c.tabs ? tabs : `<span class="hc-label">${esc(c.label)}</span>`}${chips ? `<span class="hc-chips">${chips}</span>` : ''}${pips}${c.detail ? `<span class="hc-detail">${esc(c.detail)}</span>` : ''}${c.reason ? `<span class="hc-reason">${esc(c.reason)}</span>` : ''}
      </div>`;
    }).join('');
    const row = this.menuEl.children[m.sel];
    this.menuEl.scrollTop = keepScroll;
    if (row && row.getBoundingClientRect) {
      const mr = this.menuEl.getBoundingClientRect(), rr = row.getBoundingClientRect();
      if (rr.top < mr.top) this.menuEl.scrollTop -= mr.top - rr.top + 4;
      else if (rr.bottom > mr.bottom) this.menuEl.scrollTop += rr.bottom - mr.bottom + 4;
    } else if (row && row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
  }

  _moveSel(dir) {
    const m = this.menu;
    const n = m.choices.length;
    if (n < 2) return;
    m.sel = (m.sel + dir + n) % n;
    this._renderMenu();
    if (this.onMenu) this.onMenu('move');
  }

  _selectMenu() {
    const m = this.menu;
    const c = m && m.choices[m.sel];
    if (!c) return;
    if (c.disabled) {
      const row = this.menuEl.children[m.sel];
      if (row) { row.classList.remove('deny'); void row.offsetWidth; row.classList.add('deny'); }
      if (this.onMenu) this.onMenu('denied');
      if (c.onDisabled) c.onDisabled(c, this);
      return;
    }
    if (this.onMenu) this.onMenu('select');
    if (c.onSelect) c.onSelect(c, this);
  }

  _cancelMenu() {
    const m = this.menu;
    if (this.onMenu) this.onMenu('back');
    if (m && m.onCancel) m.onCancel(this);
    else this.close();
  }

  /** -1 (up) / +1 (down) / 0 for this frame: the first push acts at once, a held direction repeats. */
  _navDir(y) {
    const dir = y < -NAV_DEAD ? -1 : y > NAV_DEAD ? 1 : 0;
    if (dir === 0) { this._navHeld = 0; return 0; }
    if (this._navHeld === 9) return 0;           // locked until released (a direction carried over from the previous menu)
    if (dir !== this._navHeld) { this._navHeld = dir; this._navAt = this._clock + NAV_FIRST; return dir; }
    if (this._clock >= this._navAt) { this._navAt = this._clock + NAV_REPEAT; return dir; }
    return 0;
  }

  // ------------------------------------------------------------------ pages
  _startPage() {
    this._text = this.pages[this.page] || '';
    this._chars = 0;
    this._acc = 0;
    this.pageDone = false;
    this.nextEl.classList.remove('show');
    this._render();
  }

  _render() {
    // Spread by code points so emoji aren't cut in half.
    const chars = Array.from(this._text);
    this.onEl.textContent = chars.slice(0, this._chars).join('');
    this.offEl.textContent = chars.slice(this._chars).join('');
  }

  _finishPage() {
    this._chars = Array.from(this._text).length;
    this.pageDone = true;
    this.nextEl.classList.add('show');
    this._render();
  }

  _end() {
    const f = this._onFinish;
    this._onFinish = null;
    if (f) f(this); else this.close();
  }

  /** Consume this frame's presses (`moveY` = the owner's stick, up = negative, for menus). Returns true if the dialog was open (and thus swallowed them). */
  handleInput(interactPressed, cancelPressed, moveY = 0) {
    if (!this.isOpen) return false;
    if (this.menu) {
      const dir = this._navDir(moveY);
      if (cancelPressed) { this._cancelMenu(); return true; }
      if (dir) this._moveSel(dir);
      if (interactPressed) this._selectMenu();
      return true;
    }
    if (cancelPressed) { this._end(); return true; }
    if (interactPressed) {
      if (!this.pageDone) this._finishPage();
      else if (this.page + 1 < this.pages.length) { this.page++; this._startPage(); }
      else this._end();
    }
    return true;
  }

  update(dt) {
    this._clock += dt;
    if (!this.isOpen || this.pageDone) return;
    const total = Array.from(this._text).length;
    this._acc += dt * CHARS_PER_SEC;
    const n = Math.floor(this._acc);
    if (n > 0) {
      this._acc -= n;
      const chars = Array.from(this._text);
      // brief pause on sentence punctuation for a bit of speech rhythm
      const before = this._chars;
      this._chars = Math.min(total, this._chars + n);
      const last = chars[this._chars - 1];
      if (this._chars > before && /[.!?]/.test(last) && this._chars < total) this._acc -= 6;
      if (this._chars > before && this.onChar && last && /\S/.test(last)) this.onChar(last);
      this._render();
      if (this._chars >= total) this._finishPage();
    }
  }
}
