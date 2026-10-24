// HUD: floating interact prompt bubbles (one per player, a pool of 4), toasts and the player roster. Pure DOM overlay inside #hud.
//
//   const hud = createHud(document.getElementById('hud'));
//   hud.update(dt, { camera, multi, prompts })   // every frame, after the camera moved
//       prompts: [{ key: playerIndex, target: interactable, text?: 'Chop' (overrides target.prompt), button?: 'cancel' (shows the Cancel glyph: storybook pages), source: 'keyboard'|'gamepad'|...
//                   color: '#5fc4ff', label: 'P2' }]   -> one bubble per entry (key 0..3). With `multi` the bubbles get the player's colour
//                   (border + a small "P2" badge); solo play looks like it always did. Bubbles that would overlap on screen (e.g. two
//                   players at the same tree) are stacked upward.
//   hud.suppressPrompt(seconds, key)   // hide one player's bubble for a moment (after an interaction)
//   hud.toast('clink!', { icon: 'sparkle' | 'apple' | '<svg ...>', duration: 2000, minor: true })   // minor: skipped on the phone (touch-host) layout; a name from ICONS (catalog item ids too), a raw <svg> string or text
//   hud.setRoster([{ state: 'empty'|'active'|'away', label:'P1', color:'#ffc93c', icons:['keyboard','gamepad'], remote?: true, leave?: true } x4])   // top-left player chips (PlayerManager); remote = a player on another screen (icons ['screen']);
//                                                                    leave = show the leave button (keyboard player) -> hud.onLeave(slot)
//                                                                    split = show the split button (keyboard sharing a controller's player) -> hud.onSplit(slot)
import * as THREE from 'three';
import { ICONS } from './icons.js';
import { JUICE } from '../config.js';
import { createRosterDisclosure } from './rosterDisclosure.js';

// Inline SVGs (emoji render as empty boxes in some browsers).
const INPUT_ALIAS = { phone: 'remote', touch: 'remote', controller: 'gamepad', pad: 'gamepad' };
const ROSTER_HINT = 'Press a button on a gamepad or connect a phone to join';

/** Height above an interactable's base where its prompt bubble is anchored. */
function anchorHeight(it) {
  const sc = it.object ? it.object.scale.y : (it.instance ? it.instance.scale : 1);
  switch (it.type) {
    case 'tree': return (it.object?.userData.promptY ?? 3.6) * sc;      // (the big islands' trees are taller: userData.promptY)
    case 'palm': return 3.4 * sc;
    case 'rock': return 0.9 * sc + 0.7;
    case 'snowman': return 2.9 * sc;
    case 'bush': return 1.7 * sc;
    case 'flower': return 0.95 * sc;
    case 'sign': return 2.9 * sc;
    case 'item': return 1.75;
    case 'herb': return 1.1 * sc;
    case 'mushroom': return 1.0;
    case 'digspot': return 1.0;
    case 'campfire': return 2.3;
    case 'hatrack': return 2.7;
    case 'tailstump': return 2.1;
    case 'npc': return 2.3;
    case 'tdoong': return it.promptY ?? 1.8;                             // (the Tdoongz, Step 64a: world/tdoongz.js sets it from the model's height)
    case 'seeddig': return 1.0;                                          // (Emberleaf's seed finds, Step 38a)
    case 'seedfind': return 1.0;
    case 'plot': return 1.5;                                             // (Emberleaf's garden plots, Step 37b)
    case 'critter': return it.promptY ?? 1.3;                            // (Frostpine's critters: critters.js sets it from the model's height)
    default: return 1.6;
  }
}

export function healthPill(hp, max = 100) {
  const fraction = Number.isFinite(hp) && max > 0 ? Math.max(0, Math.min(1, hp / max)) : 1;
  return { fraction, low: fraction < 0.25 };
}

export function createHud(root) {
  // ---- player roster (top-left): P1-P4 chips in the player colours, each with its device icon(s); empty slots show "+"
  const roster = document.createElement('div');
  roster.className = 'hud-roster';
  roster.setAttribute('aria-label', 'Players');
  const chips = [];
  for (let i = 0; i < 4; i++) {
    const chip = document.createElement('div');
    chip.className = 'roster-chip empty';
    chip.dataset.slot = String(i + 1);
    chip.innerHTML = '<span class="rc-ghost" aria-hidden="true"></span><span class="rc-label"></span><span class="rc-icons"></span><span class="rc-plus">+</span><span class="rc-pips" hidden><i></i><i></i><i></i></span><span class="rc-charm" hidden></span><span class="rc-down" hidden></span>'
      + `<button type="button" class="rc-leave" hidden aria-label="Leave the game" title="Leave the game (press any key to rejoin)">${ICONS.leave}</button>`
      + `<button type="button" class="rc-leave rc-split" hidden aria-label="Add a keyboard player" title="Play separately: the keyboard gets its own player (J)">${ICONS.split}</button>`;
    chip.title = ROSTER_HINT;
    const leave = chip.querySelector('.rc-leave:not(.rc-split)');
    const split = chip.querySelector('.rc-split');
    split.addEventListener('click', () => { split.blur(); if (hud.onSplit) hud.onSplit(i); });
    leave.addEventListener('click', () => { leave.blur(); if (hud.onLeave) hud.onLeave(i); });
    roster.appendChild(chip);
    chips.push({ el: chip, label: chip.querySelector('.rc-label'), icons: chip.querySelector('.rc-icons'), pips: chip.querySelector('.rc-pips'), down: chip.querySelector('.rc-down'), charm: chip.querySelector('.rc-charm'), leave, split, sig: '' });
  }
  const joinButton = document.createElement('button');
  joinButton.type = 'button';
  joinButton.className = 'roster-join';
  joinButton.setAttribute('aria-label', 'Add player');
  joinButton.textContent = '+ Add player';
  roster.appendChild(joinButton);
  root.appendChild(roster);
  const rosterTrigger = document.createElement('button');
  rosterTrigger.type = 'button'; rosterTrigger.className = 'roster-expand';
  rosterTrigger.setAttribute('aria-label', 'Show available player slots');
  rosterTrigger.setAttribute('aria-expanded', 'false'); rosterTrigger.setAttribute('aria-controls', 'island-roster-slots');
  roster.id = 'island-roster-slots'; chips[0].el.appendChild(rosterTrigger);
  const rosterDisclosure = createRosterDisclosure({ roster, trigger: rosterTrigger, joinButton, slots: chips.slice(1).map((c) => c.el) });
  const inputState = new Map();                                    // legacy setInputConnected() bookkeeping

  // ---- toasts (top-center stack)
  const toasts = document.createElement('div');
  toasts.className = 'hud-toasts';
  root.appendChild(toasts);

  // ---- interact prompts: a pool of 4 bubbles (one per player slot). Each: outer (positioned) > pop (pop-in on target change) > bubble (idle bob)
  const bubbles = [];
  for (let i = 0; i < 4; i++) {
    const el = document.createElement('div');
    el.className = 'hud-prompt';
    el.hidden = true;
    const pop = document.createElement('div');
    pop.className = 'hud-prompt-pop';
    const bubble = document.createElement('div');
    bubble.className = 'hud-prompt-bubble';
    const badge = document.createElement('span');
    badge.className = 'hud-prompt-badge';
    badge.hidden = true;
    const glyph = document.createElement('span');
    glyph.className = 'glyph key';
    glyph.textContent = 'E';
    const label = document.createElement('span');
    label.className = 'hud-prompt-label';
    bubble.append(glyph, label, badge);
    pop.appendChild(bubble);
    el.appendChild(pop);
    root.appendChild(el);
    bubbles.push({
      el, pop, bubble, badge, glyph, label,
      visible: false, shownId: null, shownText: '', shownGlyph: '', shownColor: null, multi: false, suppress: 0,
      w: 120, x: 0, y: 0, ty: 0, sy: NaN,
    });
  }
  const prompt = bubbles[0].el;      // (P1's bubble; kept for older callers / tests)
  const STACK_H = 54;                // px a stacked bubble is lifted above the one it would overlap
  const v = new THREE.Vector3();

  function setGlyph(b, kind) {
    if (kind === b.shownGlyph) return;
    b.shownGlyph = kind;
    if (kind === 'key') { b.glyph.className = 'glyph key'; b.glyph.textContent = 'E'; }
    else if (kind === 'key-c') { b.glyph.className = 'glyph key'; b.glyph.textContent = 'Q'; }       // (Step 50, storybook pages: Cancel grabs / throws)
    else if (kind === 'pad-c') { b.glyph.className = 'glyph pad'; b.glyph.textContent = 'B'; }
    else { b.glyph.className = 'glyph pad'; b.glyph.textContent = 'A'; }
  }

  function retriggerPop(b) {
    b.pop.classList.remove('pop');
    void b.pop.offsetWidth;        // restart the CSS animation
    b.pop.classList.add('pop');
  }

  function hideBubble(b) {
    if (!b.visible) return;
    b.visible = false;
    b.el.hidden = true;
    b.shownId = null;
    b.shownText = '';
    b.sy = NaN;                      // snap to its stack slot when it reappears
  }

  const hud = {
    root, prompt, bubbles, joinButton, rosterDisclosure,
    /** (slot) => void: the leave button on the keyboard player's chip was clicked (main.js wires it to players.leaveLocal). */
    onLeave: null,
    /** (slot) => void: the split button on a keyboard + controller chip was clicked (main.js wires it to players.splitLocal). */
    onSplit: null,

    /** Centre-point blockers for visible controls. Modal background and clipped scroll rows are inactive. */
    hitTest() {
      const modal = root.querySelector('.pair-backdrop:not([hidden])');
      const scope = modal || root;
      const problems = [];
      for (const el of scope.querySelectorAll('button, [role="button"], [role="menuitem"]')) {
        if (el.closest('[inert]') || !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        const x = r.left + r.width / 2, y = r.top + r.height / 2;
        let clipped = false;
        for (let p = el.parentElement; p && p !== scope; p = p.parentElement) {
          const style = getComputedStyle(p), b = p.getBoundingClientRect();
          if ((/(auto|scroll|hidden|clip)/.test(style.overflowY) && (y < b.top || y > b.bottom)) ||
              (/(auto|scroll|hidden|clip)/.test(style.overflowX) && (x < b.left || x > b.right))) { clipped = true; break; }
        }
        if (clipped) continue;
        const hit = document.elementFromPoint(x, y);
        if (!hit || !el.contains(hit)) problems.push({ element: el.className, label: el.getAttribute('aria-label') || el.textContent.trim(), blockedBy: hit?.className || null, x, y });
      }
      return problems;
    },

    /** Update the player roster chips (see the header comment for the slot shape). */
    setRoster(slots) {
      roster.classList.toggle('solo', slots.filter((s) => s.state !== 'empty').length === 1);
      slots.forEach((s, i) => {
        const c = chips[i];
        if (!c) return;
        const sig = JSON.stringify(s);
        if (sig === c.sig) return;
        const wasEmpty = c.sig === '' || c.el.classList.contains('empty');
        c.sig = sig;
        c.el.style.setProperty('--pc', s.color);
        c.el.classList.toggle('empty', s.state === 'empty');
        if (i > 0 && s.state === 'empty') { c.el.setAttribute('role', 'button'); c.el.setAttribute('tabindex', '0'); c.el.setAttribute('aria-label', `Add player ${s.label}`); }
        else if (i > 0) { c.el.removeAttribute?.('role'); c.el.removeAttribute?.('tabindex'); c.el.removeAttribute?.('aria-label'); }
        c.el.classList.toggle('away', s.state === 'away');
        c.el.classList.toggle('remote', !!s.remote);
        c.label.textContent = s.label;
        c.icons.innerHTML = (s.icons || []).map((n) => ICONS[n] || '').join('');
        c.leave.hidden = !s.leave;
        c.split.hidden = !s.split;
        c.el.title = s.state === 'empty' ? ROSTER_HINT : s.remote ? `${s.label} · playing on another screen${s.state === 'away' ? ' (reconnecting)' : ''}` : `${s.label} · ${(s.icons || []).join(' + ')}${s.state === 'away' ? ' (disconnected)' : ''}`;
        if (s.state !== 'empty' && wasEmpty) { c.el.classList.remove('pop'); void c.el.offsetWidth; c.el.classList.add('pop'); }
      });
    },

    /** Dungeon HP reuses the existing controller pills; an empty array restores their island presentation. Entries: { index, hp, max, bloom? (0..3 pips) }. */
    setHealth(entries = []) {
      const bySlot = new Map(entries.map((s) => [s.index, s]));
      chips.forEach((c, i) => {
        const member = bySlot.get(i), sig = member ? `${member.hp}/${member.max}/${Math.round((member.bloom || 0) * 100)}/${member.downed ? Math.round((member.revive || 0) * 100) : 'u'}/${member.charm || ''}/${member.charmFrac ?? 1}` : '';
        if (c.hpSig === sig) return; c.hpSig = sig;
        const health = healthPill(member?.hp, member?.max);
        if (member && c.lastHP !== undefined && member.hp < c.lastHP) { c.ghost = Math.max(c.ghost ?? 1, c.lastHP / member.max); c.ghostT = JUICE.ghostDelay; c.el.classList.remove('hp-hit'); void c.el.offsetWidth; c.el.classList.add('hp-hit'); }
        else if (!member || c.lastHP === undefined || member.hp > c.lastHP) c.ghost = health.fraction;
        c.lastHP = member?.hp; c.fraction = health.fraction;
        c.el.classList.toggle('dungeon-hp', !!member); c.el.classList.toggle('hp-downed', !!member?.downed); c.el.classList.toggle('hp-low', !!member && health.low);
        c.el.style.setProperty('--hp-fill', member?.downed ? `${(member.revive || 0) * 100}%` : `${health.fraction * 100}%`);   // (a downed pill fills with the revive progress)
        c.down.hidden = !member?.downed; if (member?.downed && !c.down.firstChild) c.down.innerHTML = ICONS.sprout;
        // Step 54: the Bloom meter, three pips on the pill (each fills in turn; all three lit = the big special is ready)
        const bloom = member?.bloom || 0;
        c.pips.hidden = !member;
        [...c.pips.children].forEach((pip, k) => { if (c.lastBloom !== undefined && Math.floor(bloom) > c.lastBloom && k < Math.floor(bloom) && k >= c.lastBloom) { pip.classList.remove('pip-pop'); void pip.offsetWidth; pip.classList.add('pip-pop'); } pip.style.setProperty('--f', String(Math.max(0, Math.min(1, bloom - k)))); });
        c.lastBloom = member ? Math.floor(bloom) : undefined;
        c.pips.classList.toggle('full', bloom >= 3 - 1e-6);
        // Step 58: the held charm's icon with a recharge ring (a conic sweep that closes as it fills)
        c.charm.hidden = !member?.charm;
        if (member?.charm) {
          const icon = ICONS[`charm-${member.charm}`] || ICONS.charm;
          if (c.charm.dataset.icon !== member.charm) { c.charm.dataset.icon = member.charm; c.charm.innerHTML = icon; }
          const f = member.charmFrac ?? 1;
          c.charm.style.setProperty('--cd', `${Math.round(f * 360)}deg`); c.charm.classList.toggle('ready', f >= 1);
        } else delete c.charm.dataset.icon;
        if (member) c.el.setAttribute('aria-label', member.downed ? `P${i + 1}: down, ${Math.round((member.revive || 0) * 100)}% revived` : `P${i + 1}: ${member.hp} of ${member.max} HP`);
        else c.el.removeAttribute('aria-label');
      });
    },

    /** Legacy (pre-multiplayer) input pill API: the roster replaced the pill, so this only remembers the flag. */
    setInputConnected(name, connected) { inputState.set(INPUT_ALIAS[name] || name, !!connected); },
    isInputConnected(name) { return !!inputState.get(INPUT_ALIAS[name] || name); },

    /** Little comic toast at the top of the screen; auto-dismisses (default 2s). */
    toast(text, { duration = 2000, icon = '', minor = false } = {}) {
      // Step 52c: a routine toast (a tool taken, a letter found...) is skipped on the phone layout: the HUD strip, sparkles and sounds already say it
      if (minor && root.classList.contains('touch-host')) return;
      const el = document.createElement('div');
      el.className = 'hud-toast';
      if (icon) {
        // `icon` is a name from ICONS ('gamepad', 'phone', 'sparkle', 'berry', 'speaker', 'muted'); anything else is shown as text.
        const ic = document.createElement('span');
        ic.className = 'hud-toast-icon';
        if (ICONS[icon]) ic.innerHTML = ICONS[icon];
        else if (icon.startsWith('<svg')) ic.innerHTML = icon;
        else ic.textContent = icon;
        el.appendChild(ic);
      }
      el.appendChild(document.createTextNode(text));
      toasts.appendChild(el);
      while (toasts.children.length > 4) toasts.firstElementChild.remove();
      const kill = () => {
        el.classList.add('out');
        const done = () => el.remove();
        el.addEventListener('animationend', done, { once: true });
        setTimeout(done, 500);     // fallback if animations are disabled / throttled
      };
      setTimeout(kill, duration);
      return el;
    },

    /** Hide one player's prompt for a moment (after an interaction, so the effect isn't covered); it pops back in afterwards. */
    suppressPrompt(seconds = 0.7, key = 0) {
      const b = bubbles[key];
      if (!b) return;
      b.suppress = Math.max(b.suppress, seconds);
      hideBubble(b);
    },

    /** Reposition / refresh the prompt bubbles. Call once per frame after the camera has moved. */
    update(dt, { camera, prompts = [], multi = false }) {
      for (const c of chips) {
        c.ghostT = Math.max(0, (c.ghostT || 0) - dt);
        if (!c.ghostT) c.ghost = Math.max(c.fraction || 0, (c.ghost || 0) - dt / JUICE.ghostDrain);
        c.el.style.setProperty('--hp-ghost', `${(c.ghost || 0) * 100}%`);
      }
      const w = window.innerWidth, h = window.innerHeight;
      camera.updateMatrixWorld();
      const active = [];
      for (const b of bubbles) if (b.suppress > 0) b.suppress -= dt;
      const wanted = new Set();
      for (const p of prompts) {
        const b = bubbles[p.key];
        const it = p.target;
        if (!b || !it || b.suppress > 0) continue;
        const pos = it.instance ? it.instance.position : it.position;
        v.set(pos.x, pos.y + anchorHeight(it), pos.z);
        v.project(camera);
        if (v.z > 1 || v.z < -1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) continue;
        wanted.add(b);

        if (!b.visible) { b.visible = true; b.el.hidden = false; b.shownText = ''; }
        const text = p.text || it.prompt || 'Interact';   // text overrides (e.g. "Chop" / "Break" while holding a capable tool)
        const kind = (p.source === 'keyboard' || p.source === undefined ? 'key' : 'pad') + (p.button === 'cancel' ? '-c' : '');
        let remeasure = false;
        if (b.shownId !== it.id || b.shownText !== text) {
          b.shownId = it.id;
          b.shownText = text;
          b.label.textContent = text;
          retriggerPop(b);
          remeasure = true;
        }
        if (kind !== b.shownGlyph) { setGlyph(b, kind); remeasure = true; }
        const colour = multi ? p.color : null;
        if (b.multi !== !!multi || b.shownColor !== colour || (multi && b.badge.textContent !== p.label)) {
          b.multi = !!multi;
          b.shownColor = colour;
          b.el.classList.toggle('multi', !!multi);
          b.badge.hidden = !multi;
          if (multi) { b.el.style.setProperty('--pc', p.color); b.badge.textContent = p.label || ''; }
          remeasure = true;
        }
        if (remeasure) b.w = b.bubble.offsetWidth || b.w;      // width only changes with text / glyph / badge
        b.x = (v.x * 0.5 + 0.5) * w;
        b.y = (-v.y * 0.5 + 0.5) * h;
        active.push(b);
      }
      for (const b of bubbles) if (!wanted.has(b)) hideBubble(b);

      // stack: bubbles whose screen boxes overlap are lifted above the earlier (lower-numbered) one
      const placed = [];
      for (const b of active) {
        let y = b.y;
        for (let guard = 0; guard < 5; guard++) {
          let hit = null;
          for (const q of placed) {
            if (Math.abs(q.x - b.x) < (q.w + b.w) * 0.5 + 6 && Math.abs(q.ty - y) < STACK_H - 4) { hit = q; break; }
          }
          if (!hit) break;
          y = hit.ty - STACK_H;
        }
        b.ty = y;
        placed.push(b);
        // ease the stack offset so bubbles glide instead of teleporting when players walk together / apart
        const target = y - b.y;
        if (Number.isNaN(b.sy)) b.sy = target;
        b.sy += (target - b.sy) * (1 - Math.exp(-14 * dt));
        if (Math.abs(target - b.sy) < 0.3) b.sy = target;
        b.el.style.transform = `translate3d(${b.x.toFixed(1)}px, ${(b.y + b.sy).toFixed(1)}px, 0)`;
      }
    },
  };
  joinButton.addEventListener('click', () => hud.toast(ROSTER_HINT, { icon: 'gamepad', duration: 3500 }), { once: true });
  return hud;
}
