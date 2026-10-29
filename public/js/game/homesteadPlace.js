// Step 86d: Homesteading's PLACING UI: Shape with nothing to remove opens the PALETTE, picking a kind starts the GHOST PREVIEW in front of the player, Shape plants it, Cancel goes back to the palette. Screen-local and per
// player (like the mode itself): it only ever runs for players on the HOST's screen. The palette is a menu on the shared dialog (so keyboard, gamepad, phone and mouse / touch already drive it): a tab row
// (Gathering | Decorations) then one row per listed kind with its cost chips (item icon + have / need), its budget weight as leaf pips and, when it is greyed out, the reason ("Needs 5 Apples").
// The dialog is single (one at a time, owned by its opener): a second player's palette waits in a queue, exactly like the removal confirms of game/homesteadShape.js. A player in the PREVIEW holds no dialog, so
// two players can each preview at once.
//
//   const place = createHomesteadPlace({ homestead, world, players, dialog, hud, sfx, ghost, inventory, now? });
//   place.openPalette(p, { tab? })     open (or queue) p's palette; true when it opened / queued
//   place.pick(p, kind)                enter the preview of a LISTED kind (a greyed-out kind is refused with its reason); true on success
//   place.confirm(p)                   Shape in the preview: the host re-checks everything and plants it. Resolves { ok, reason? }; on success the preview stays (or, when the bag / budget can no longer cover the kind, goes back to the palette)
//   place.back(p)                      Cancel in the preview: the ghost goes away and the palette reopens (same tab)
//   place.water(p, target)             Interact on a sprout / sapling with the watering can: the pour effect, then the request (the host range-checks, checks the can and the 1.5 s lock)
//   place.previewing(p) / place.leave(p)    is p in the preview? / the mode ended: close everything of p's
//   place.update(dt)                   per tick: the queue, each preview's position (about HOMESTEAD.ghostAhead in front of the player), its validity (world.spotCheck + budget / cost) and its ghost colour / reason
//   place.ghost(p)                     debug: the current preview { kind, x, z, ok, reason, line } or null
//   Step 86e: the palette lists each island's kinds once that island is unlocked (homestead.islands(): the saved flags the game already uses, which never turn off, so a listed kind stays listed). update() watches that list and,
//   the first time an island joins it during a session (host screen, Homesteading unlocked), shows the toast "New for your homestead: Frostpine plants!" once. Islands that were already unlocked at load are known silently.
//   place.rows(tab)                    debug: the palette rows (game/homesteadPalette.js) as the bag and the budget stand now
import { HOMESTEAD } from '../config.js';
import { ICONS } from '../ui/icons.js';
import { TABS, TAB_LABELS, paletteRows, iconOf } from './homesteadPalette.js';
import { spotLine } from './homesteadSpot.js';
import { lineFor, kindMeta } from './homesteadLogic.js';
import { getItem } from './catalog.js';

const AHEAD = 2.0;                      // u in front of the player
const CHECK_EVERY = 0.08;               // s between validity checks of a preview
const WATER_REJECT = { 'no-can': 'Needs the watering can.', far: 'Too far away.', busy: '', maxed: 'It is fully grown!', gone: 'That is already gone.' };

export function createHomesteadPlace({ homestead, world, players, dialog, hud, sfx, ghost, inventory, now = () => 0, heldKind = () => null, aheadOf = null }) {
  let time = 0, sigAt = 0, lastSig = '';
  const state = new Map();              // Player -> { kind, tab, x, z, ok, reason, line, at }
  const tabOf = new Map();              // Player -> the tab the palette last showed
  const queue = [];                     // palettes waiting for the dialog: { p, tab }
  const waterAt = new Map();            // Player -> time of its last water press (a held press must not spam the pour)
  const snd = (name, o) => { if (sfx) sfx.play(name, o); };
  const toast = (text, o = {}) => { if (hud) hud.toast(text, { icon: 'homestead', duration: 2800, ...o }); };
  const live = (p) => players.list.includes(p);
  const bag = (id) => (inventory ? inventory.count(id) : 0);
  const rowsFor = (tab) => paletteRows({ tab, bag, usage: homestead.budget(), layerFull: (k) => !!world.layerFull(k), islands: homestead.islands() });
  const knownIslands = new Set(homestead.islands());          // Step 86e: islands whose kinds are already listed (no toast for those)

  // ---------------------------------------------------------------- the palette
  function budgetText() {
    const u = homestead.budget();
    return `Island ${u.main.used} / ${u.main.budget}      Decor ${u.deco.used} / ${u.deco.budget}`;
  }
  function choicesFor(p) {
    const tab = tabOf.get(p) || 'gathering';
    const tabRow = {
      tabs: TABS.map((t) => ({ label: TAB_LABELS[t], active: t === tab })), icon: ICONS.homestead,
      onSelect: (c, d) => { tabOf.set(p, tab === 'gathering' ? 'decorations' : 'gathering'); snd('pop', { pitch: 1.1, vol: 0.7 }); d.refresh(); },
    };
    const kinds = rowsFor(tab).map((r) => ({
      label: r.label, icon: iconOf(r.kind), pips: r.weight,
      chips: r.cost.map((c) => ({ icon: itemIcon(c.id), have: c.have, need: c.need })), detail: r.cost.length ? '' : 'Free',
      disabled: !r.free, reason: r.free ? '' : r.line,
      onDisabled: () => toast(r.line + '.', { duration: 3200 }),
      onSelect: () => { dialog.close(); pick(p, r.kind); },
    }));
    return [tabRow, ...kinds, { label: 'Close', icon: ICONS.back, onSelect: () => dialog.close() }];
  }
  const itemIcon = (id) => { const it = getItem(id); return it ? it.icon : ''; };

  function openPalette(p, { tab } = {}) {
    if (!live(p) || !homestead.inMode(p)) return false;
    if (tab) tabOf.set(p, tab);
    if (queue.some((q) => q.p === p)) return true;
    if (dialog.isOpen) { queue.push({ p }); return true; }
    open(p);
    return true;
  }
  function open(p) {
    dialog.open({
      name: 'Homesteading', owner: p, tag: players.multi ? p.colors.name : '', color: p.colors.ui, menuId: 'homestead-palette',
      text: budgetText, choices: () => choicesFor(p), onCancel: () => dialog.close(),
    });
    snd('chime', { vol: 0.6 });
  }

  // ---------------------------------------------------------------- the preview
  function pick(p, kind) {
    const row = rowsFor(tabOfKind(kind)).find((r) => r.kind === kind);
    if (!row) { toast('That is not on your list yet.'); return false; }
    if (!row.free) { toast(row.line + '.', { duration: 3200 }); snd('bip', { pitch: 0.7 }); return false; }
    if (!ghost.show(p, kind)) return false;
    tabOf.set(p, tabOfKind(kind));
    state.set(p, { kind, x: 0, z: 0, ok: false, reason: null, line: '', at: -99 });
    toast(`${row.label}: Shape plants it, Cancel goes back.`, { duration: 3200 });
    snd('equip', { vol: 0.5 });
    check(p);
    return true;
  }
  const tabOfKind = (kind) => (kindMeta(kind) && kindMeta(kind).budget === 'deco' ? 'decorations' : 'gathering');

  /** Where the preview stands now and whether it is valid (client-side: the same rules the host re-checks). */
  function check(p) {
    const s = state.get(p);
    if (!s) return;
    const f = aheadOf ? aheadOf(p) : { x: p.position.x + Math.sin(p.facing || 0) * AHEAD, z: p.position.z + Math.cos(p.facing || 0) * AHEAD };
    s.x = Math.round(f.x * 100) / 100; s.z = Math.round(f.z * 100) / 100;
    s.at = time;
    const meta = kindMeta(s.kind);
    const spot = world.spotCheck(s.kind, s.x, s.z);
    const can = homestead.can(s.kind);
    s.reason = spot || can.reason || null;
    s.line = spot ? spotLine(spot, meta) : can.reason ? (can.line || '').replace(/\.$/, '') : '';
    s.ok = !s.reason;
    ghost.set(p, { x: s.x, z: s.z, ok: s.ok, text: s.line });
  }

  async function confirm(p) {
    const s = state.get(p);
    if (!s || !live(p) || !homestead.inMode(p)) return { ok: false, reason: 'none' };
    check(p);
    if (!s.ok) { toast(s.line + '.', { duration: 2400 }); snd('bip', { pitch: 0.7 }); return { ok: false, reason: s.reason }; }
    p.faceToward(s.x, s.z);
    const kind = s.kind;
    const res = await homestead.place(kind, s.x, s.z, p);
    if (!res || res.ok === false) {
      const why = res && (res.reason || res.reject);
      toast(lineFor(why, kindMeta(kind), homestead.budget()) || 'Could not plant that there.', { duration: 2800 });
      snd('bip', { pitch: 0.7 });
      return { ok: false, reason: why };
    }
    const cur = state.get(p);
    if (cur && cur.kind === kind && !homestead.can(kind).reason) check(p);            // room and materials for another: keep previewing
    else if (cur) { endPreview(p); toast('Planted! That was the last you could afford.', { duration: 2600 }); openPalette(p); }
    return { ok: true };
  }

  function endPreview(p) { state.delete(p); ghost.hide(p); }
  function back(p) {
    if (!state.has(p)) return false;
    endPreview(p);
    snd('bip');
    return openPalette(p);
  }
  function leave(p) {
    endPreview(p);
    for (let i = queue.length - 1; i >= 0; i--) if (queue[i].p === p) queue.splice(i, 1);
    if (dialog.isOpen && dialog.owner === p && dialog.menuId === 'homestead-palette') dialog.close();
  }

  // ---------------------------------------------------------------- watering
  /** Interact on a sprout / sapling. The pour plays at once on this screen; the host checks the can, the range and the lock, and every screen plays the growth when the `grew` event arrives. */
  function water(p, target) {
    if (!live(p) || !target) return false;
    const pid = world.pidOfItem(target);
    if (pid === null) return false;
    if (heldKind(p) !== 'watering-can') { toast('Needs water: take the watering can from the tool rack.', { duration: 3000 }); snd('bip', { pitch: 0.7 }); return false; }
    const last = waterAt.get(p);
    if (last !== undefined && time - last < HOMESTEAD.waterLock) return false;      // (client side of the lock: a held press does nothing for 1.5 s)
    waterAt.set(p, time);
    p.faceToward(target.position.x, target.position.z);
    if (world.fx) world.fx.pour({ x: p.position.x + Math.sin(p.facing || 0) * 0.5, y: (p.position.y || 0) + 1.0, z: p.position.z + Math.cos(p.facing || 0) * 0.5 }, { x: target.position.x, y: target.position.y + 0.3, z: target.position.z });
    Promise.resolve(homestead.water(pid, p)).then((res) => {
      if (res && res.ok === false) {
        const why = res.reason || res.reject;
        const line = WATER_REJECT[why];
        if (line) toast(line, { duration: 2400 });
      }
    });
    return true;
  }

  // ---------------------------------------------------------------- per tick
  function watchIslands() {
    const now = homestead.islands();
    for (const id of now) {
      if (knownIslands.has(id)) continue;
      knownIslands.add(id);
      if (homestead.hostScreen && homestead.unlocked) { toast(`New for your homestead: ${HOMESTEAD.islandNames[id] || id} plants!`, { duration: 4200 }); snd('chime', { vol: 0.7 }); }
    }
  }
  function update(dt) {
    time += dt;
    watchIslands();
    for (const [p, s] of [...state]) {
      if (!live(p) || !homestead.inMode(p)) { endPreview(p); continue; }
      if (time - s.at >= CHECK_EVERY) check(p);
    }
    if (queue.length && !dialog.isOpen) {
      const q = queue.shift();
      if (live(q.p) && homestead.inMode(q.p) && !state.has(q.p)) open(q.p);
    }
    if (dialog.isOpen && dialog.menuId === 'homestead-palette' && time - sigAt > 0.3) {         // (the bag changes while it is open, e.g. picked-up drops): re-render only when a row would change
      sigAt = time;
      const sig = JSON.stringify(rowsFor(tabOf.get(dialog.owner) || 'gathering').map((r) => [r.kind, r.free, r.cost.map((c) => c.have)]));
      if (sig !== lastSig) { lastSig = sig; dialog.refresh(); }
    }
  }

  homestead.on((kind, d) => {
    if (kind === 'mode' && d.player && !d.on) leave(d.player);
  });

  return {
    openPalette, pick, confirm, back, leave, water, update,
    previewing: (p) => state.has(p),
    ghost(p) { const s = state.get(p); return s ? { kind: s.kind, x: s.x, z: s.z, ok: s.ok, reason: s.reason, line: s.line } : null; },
    rows: rowsFor,
    state: () => ({ previews: [...state].map(([p, s]) => ({ player: p.index, kind: s.kind, ok: s.ok })), queued: queue.map((q) => q.p.index) }),
  };
}

