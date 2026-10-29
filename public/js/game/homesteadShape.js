// Step 86c: the Homesteading MODE's behaviour (the layout layer is game/homestead.js, the pure rules game/homesteadLogic.js). Screen-local and per player: it only ever runs for players on the HOST's screen.
//
//   const shape = createHomesteadShape({ homestead, world, players, items, dialog, hud, sfx, offHome?, inCombat?, charmUi? })
//   shape.enter(p) / leave(p, { toast? }) / toggle(p)   switch a player's mode (the fire-menu row and __game.homestead.enter / leave call these); entering toasts the controls, leaving toasts "Done homesteading!"
//   shape.press(p, target, { confirm? })   the Shape button was pressed (Charm -> shapePressed, game/charms.js actionsWithCharmRouting): remove `target` FOR GOOD. Needs the kind's tool in hand (shapeRule),
//                                          asks the host's local pre-check (the last-native guard prints its line and stops), then (gathering objects only) a Yes / No dialog owned by `p`, then the normal swing; at the swing's
//                                          impact frame it sends homestead.remove(id, p, { shape: true }) and the host plays + broadcasts the normal fell / break / dig with the normal drops. `confirm: true` (debug) answers Yes.
//   shape.cancelTap(p, target)             the Cancel button was pressed while in the mode. true = a DOUBLE tap (two presses within DOUBLE_TAP s) opened the "Leave Homesteading?" menu (that press does not hop);
//                                          a single press returns false and stays the hop (so Cancel keeps working everywhere; Jump hops too).
//                                          Step 86d: with no target (or empty hands) Shape calls `onEmpty(p)` (the PLACE palette, game/homesteadPlace.js)
//   shape.promptLine(p, target)            the second prompt-bubble line for the Shape action ({ text, glyph, key, dim? }) or null
//   shape.update(dt)                       once per tick: pending swings, the dialog queue, auto-leave (off the home island / the player left), the touch / phone Charm button (shown while in the mode)
//   shape.state()                          debug: { pending, queued, modes }
// Two local players can be in the mode at once: each has its own target, its own confirm (the single dialog is shared, so a second one waits in the queue) and its own pending swing.
import { shapeRule, shapeConfirmText, removeRejectLine } from './homesteadLogic.js';
import { ICONS } from '../ui/icons.js';

export const SHAPE_IMPACT = 0.45;       // swing progress at which the removal is sent (harvest.js IMPACT)
export const DOUBLE_TAP = 0.45;         // s: two Cancel presses this close open the Leave menu
const UI_BEAT = 1.5;                    // s: how often the touch Charm button is told to stay shown

/** Which keycap the Shape line shows: the Charm key on a keyboard, the X button otherwise (pad / phone). */
export const shapeGlyph = (source) => (source === 'keyboard' || source === undefined ? { glyph: 'key', key: 'R' } : { glyph: 'pad', key: 'X' });
const controlsHint = (source) => `${shapeGlyph(source).key}: plant or remove`;           // Step 86f: short, so the centred toast never reaches the clock at 800 x 600

export function createHomesteadShape({ homestead, world, players, items, dialog, hud, sfx, offHome = () => false, inCombat = () => false, charmUi = null, onEmpty = null }) {
  let time = 0;
  const pending = new Map();            // Player -> { id, kind, t }   a removal whose swing is running
  const queue = [];                     // confirms waiting for the (single) dialog: { p, id, kind }
  const lastCancel = new Map();         // Player -> time of its last Cancel press
  const uiAt = new Map();               // Player -> last time the Charm button was told to show
  const snd = (name, o) => { if (sfx) sfx.play(name, o); };
  const toast = (text, o = {}) => { if (hud) hud.toast(text, { icon: 'homestead', duration: 2600, ...o }); };
  const live = (p) => players.list.includes(p);

  // ---------------------------------------------------------------- the mode
  function enter(p) {
    if (!homestead.setMode(p, true)) return false;
    toast(`Homesteading! ${controlsHint(p.actions && p.actions.activeSource)}`, { duration: 4200 });
    snd('chime');
    return true;
  }
  function leave(p, { quiet = false, text = 'Done homesteading!' } = {}) {
    const was = homestead.inMode(p);
    homestead.setMode(p, false);
    pending.delete(p); lastCancel.delete(p);
    for (let i = queue.length - 1; i >= 0; i--) if (queue[i].p === p) queue.splice(i, 1);
    if (was && !quiet) toast(text);
    return was;
  }
  const toggle = (p) => (homestead.inMode(p) ? leave(p) : enter(p));

  function leaveMenu(p) {
    if (!live(p) || dialog.isOpen) return false;
    const close = () => dialog.close();
    dialog.open({
      name: 'Homesteading', owner: p, tag: players.multi ? p.colors.name : '', color: p.colors.ui, menuId: 'homestead-leave', text: 'Leave Homesteading?',
      choices: [
        { label: 'No, keep going', icon: ICONS.back, onSelect: close },
        { label: 'Yes, I am done', icon: ICONS.leave, onSelect: () => { close(); leave(p); } },
      ],
      onCancel: close,
    });
    return true;
  }
  function cancelTap(p) {
    const last = lastCancel.get(p);
    if (last !== undefined && time - last < DOUBLE_TAP) { lastCancel.delete(p); return leaveMenu(p); }
    lastCancel.set(p, time);
    return false;
  }

  // ---------------------------------------------------------------- Shape = remove for good
  const holdsTool = (p) => { const h = items.heldBy(p); return !!h && h.state === 'held'; };
  const toolOk = (p, rule) => { const h = items.heldBy(p); return !!h && h.state === 'held' && h.kind === rule.tool; };
  const targetInfo = (t) => {
    const id = t ? world.idOfItem(t) : null;
    const kind = id ? homestead.kindOf(id) : null;
    return { id, kind, rule: kind ? shapeRule(kind) : null };
  };

  function press(p, t, { confirm = false } = {}) {
    if (!homestead.inMode(p) || !live(p) || pending.has(p) || p.swinging) return false;
    if (queue.some((q) => q.p === p)) return false;
    if (!t || (onEmpty && !holdsTool(p))) {                                        // Step 86d: Shape on empty ground - or with empty hands, where nothing can be removed anyway - opens the PLACE palette
      if (onEmpty && onEmpty(p)) return true;
      snd('bip', { pitch: 0.7 }); return false;
    }
    const { id, kind, rule } = targetInfo(t);
    if (!rule) { toast("That can't be changed."); snd('bip', { pitch: 0.7 }); return false; }
    if (!toolOk(p, rule)) { toast(`${rule.needs}.`); snd('bip', { pitch: 0.7 }); return false; }
    const chk = homestead.canRemove(id);
    if (!chk.ok) { if (chk.line) toast(chk.line, { duration: 3200 }); snd('bip', { pitch: 0.7 }); return false; }
    if (!rule.confirm || confirm) { begin(p, id, kind); return true; }
    if (dialog.isOpen) queue.push({ p, id, kind }); else openConfirm(p, id, kind);
    return true;
  }

  function openConfirm(p, id, kind) {
    const close = () => dialog.close();
    dialog.open({
      name: 'Homesteading', owner: p, tag: players.multi ? p.colors.name : '', color: p.colors.ui, menuId: 'homestead-confirm', text: shapeConfirmText(kind),
      choices: [
        { label: 'No, keep it', icon: ICONS.back, onSelect: close },
        { label: 'Yes, for good', icon: ICONS.homestead, onSelect: () => { close(); begin(p, id, kind); } },
      ],
      onCancel: close,
    });
  }

  /** Yes was chosen (or no confirm was needed): swing now, send the removal at the impact frame. */
  function begin(p, id, kind) {
    if (!live(p) || !homestead.inMode(p)) return;
    const rule = shapeRule(kind);
    if (!rule || !toolOk(p, rule)) { toast(`${(rule && rule.needs) || 'Wrong tool'}.`); return; }
    const chk = homestead.canRemove(id);                                           // (the world may have changed while the question was open)
    if (!chk.ok) { toast(chk.line || 'That is already gone.', { duration: 3000 }); return; }
    const at = world.posOf(id, id.startsWith('spot:') ? Number(id.slice(5)) : undefined);
    if (at) p.faceToward(at.x, at.z);
    const swung = items.swing(p, { dig: rule.tool === 'shovel' });
    pending.set(p, { id, kind, t: swung ? 0 : 99 });                               // (could not swing, e.g. a swing is already running: send it now)
  }

  function send(p, e) {
    const r = homestead.remove(e.id, p, { shape: true });
    Promise.resolve(r).then((res) => {
      if (res && res.ok) return;
      const line = removeRejectLine(res && res.reason, e.kind);
      if (line) toast(line, { duration: 3000 });
    });
  }

  // ---------------------------------------------------------------- prompt line
  function promptLine(p, t) {
    if (!homestead.inMode(p) || !t) return null;
    const g = shapeGlyph(p.actions && p.actions.activeSource);
    if (onEmpty && !holdsTool(p)) return { ...g, text: 'Plant something' };       // (Step 86d: with empty hands Shape opens the palette)
    const { id, rule } = targetInfo(t);
    if (!rule) return null;
    if (!toolOk(p, rule)) return { ...g, text: rule.needs, dim: true };
    const chk = homestead.canRemove(id);
    if (!chk.ok && chk.reason === 'last-native') return { ...g, text: "The island's last one", dim: true };
    return { ...g, text: rule.verb };
  }

  // ---------------------------------------------------------------- per tick
  function update(dt) {
    time += dt;
    for (const p of homestead.modes()) {
      if (!live(p)) { leave(p, { quiet: true }); continue; }
      if (offHome(p)) { leave(p, { text: 'Left the home island: done homesteading.' }); continue; }
      if (charmUi && !inCombat(p) && time - (uiAt.get(p) ?? -99) > UI_BEAT) { uiAt.set(p, time); charmUi(p, true, 1); }      // the touch / phone Charm button is the Shape button here
    }
    for (const [p, e] of [...pending]) {
      e.t += dt;
      if (!live(p) || !homestead.inMode(p)) { pending.delete(p); continue; }
      if (!p.swinging || p.swingProgress >= SHAPE_IMPACT || e.t > 1.2) { pending.delete(p); send(p, e); }
    }
    if (queue.length && !dialog.isOpen) {
      const q = queue.shift();
      if (live(q.p) && homestead.inMode(q.p) && homestead.canRemove(q.id).ok) openConfirm(q.p, q.id, q.kind);
    }
  }

  // the Charm button goes back to normal (hidden outside combat) the moment a player leaves the mode
  homestead.on((kind, d) => {
    if (kind !== 'mode' || !d.player) return;
    if (d.on) uiAt.delete(d.player);
    else if (charmUi && !inCombat(d.player)) { uiAt.delete(d.player); charmUi(d.player, false, 1); }
  });

  return {
    enter, leave, toggle, press, cancelTap, promptLine, update, leaveMenu,
    state: () => ({ pending: [...pending].map(([p, e]) => ({ player: p.index, id: e.id, kind: e.kind })), queued: queue.map((q) => ({ player: q.p.index, id: q.id })), modes: homestead.modes().map((p) => p.index) }),
  };
}
