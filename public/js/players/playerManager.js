// PlayerManager: up to 4 couch co-op players sharing one screen (Step 11). Every DEVICE drives its own player.
//
// Devices
//   'local'            keyboard + host touch controls (one device). Always drives P1; it is what "solo" means.
//   'pad:<index>'      each gamepad (by its Gamepad API index)
//   'phone:<key>'      each phone controller, by its persistent clientId (a reload / reconnect gets its old player back)
//   'debug:<name>'     fake devices for tests (spawnDebugPlayer / fake)
// Every device has its own InputManager (deadzone + press-edge detection are reused, not re-implemented) so each device
// yields the usual actions object: { move:{x,z}, interactPressed, cancelPressed, jumpPressed, charmPressed, interactHeld, cancelHeld, jumpHeld, charmHeld, activeSource }.
//
// Claiming
//   - The first device to give real input (move / interact / cancel) claims P1 (`p1Owner`). Solo play works with any device.
//   - Every later non-local device that gives input gets the lowest free slot P2..P4 (spawn poof + "P2 joined!" toast);
//     with all 4 slots taken a throttled "Island is full (4 players)" toast shows instead.
//   - `local` always ALSO drives P1 when it is not the claimer (its actions are merged with the owner's).
// Leaving
//   - A gamepad / phone that disconnects keeps its player for DISCONNECT_GRACE_S seconds (it can come back), then the
//     player poofs away (the 'leave' event / `onDespawn` hook fires first; main.js uses 'leave' to drop the held item on the spot).
//   - P1 never despawns while the keyboard drives it; when its owning device stays gone for the grace period P1 reverts to `local` and can be
//     claimed again.
//   - The keyboard player can leave on purpose (`leaveLocal()`, the roster chip's leave button) while somebody else plays on this screen: its
//     player poofs away (the usual 'leave' event, the slot is freed) and becomes the hidden placeholder, exactly like a joined screen before
//     it has a slot. Any key (after REJOIN_DELAY_S) claims the lowest free slot again. If the keyboard only shared P1 with the gamepad / phone
//     that claimed it, that device simply keeps P1. Once the keyboard has left, P1 is an ordinary slot (its device can leave, others take it).
// Splitting
//   - A gamepad / phone that gives input before the keyboard takes over P1 (the likely case: one person, one controller), and the keyboard
//     keeps sharing it. `splitLocal()` (the J key, the split button on the shared chip) gives the keyboard its OWN player in the lowest free
//     slot at once: the controller keeps P1, which becomes an ordinary slot (it despawns when its device stays away, like after leaveLocal).
//
// Screens + global slots (Step 23)
//   - The island has 4 player slots (P1-P4) across ALL screens. The HOST owns the slot table (players/slotTable.js, WorldSync domain 'players').
//     Every local player, the host's too, claims its slot with a `claim` request before it appears (on the host it is answered at once).
//     A full island shows the usual "Island is full" toast. The slot number IS the player's index everywhere (colour, P-number, actor index),
//     so `players.players[slot]` holds only THIS screen's players; other screens' players are null there (they have no avatar until Step 24).
//   - A replica's first local player (keyboard / touch = the 'local' device) is created hidden and adopted into its slot once the host grants it;
//     it never gets P1 (the host's P1 always exists). Its other devices (pads, phones, debug) claim on first input like on the host.
//   - Regroup: a local player who is off screen for REGROUP_DELAY_S pops back next to the nearest teammate still on screen (rules in
//     players/regroupLogic.js; main.js calls `updateRegroup(dt, camera, { blocked })` after the camera moved). After REGROUP_DROP_S off
//     screen the camera stops framing them, an edge arrow in their colour points at them and counts down the last seconds.
//   - Camera focus / zoom, the tether and the soft push only look at this screen's players (`players.list`). `players.multi` is about the whole
//     island (rings, name tags and tinted prompts appear as soon as anybody else is playing, on any screen).
//   - Slots are released when a player leaves (its device stayed away past the grace period); the host frees a dead screen's slots after the
//     10 s grace, and a screen that reconnects in time (same clientId) claims the same slots again (claims are idempotent per device).
//
// Party bots (Step 80a): `spawnBot({ name, colors, ears })` seats a REAL Player on the host whose device is a 'bot:<n>' BotSource (input/botSource.js: it implements the input contract, so physics, animation, sync and the games'
//   rules treat it like a person). It takes a free global slot (the slot table entry carries `bot: true` and the bot's name; other screens draw it as a remote avatar), never claims on its own and never toasts;
//   `removeBot(player)` poofs it away and frees the slot. `players.bots` = the bot players.
//
// Per frame (main.js): players.pollInput(dt) -> [game logic reading players.p1.actions] -> players.update(dt) ->
// followCam.update(dt, players.focus, players.cameraZoom(followCam)) -> players.updateFx(dt, camera).
//
// API for the game logic (main.js loops over players.list; items / harvest / interactions are per player):
//   players.list                 active Player objects (P1 first);  players.players[i] is the slot array (null = empty)
//   players.p1                   the always-present first Player
//   player.actions               that player's actions object this frame (same shape as InputManager.update())
//   player.index / player.colors / player.device (device id) / player.deviceKind ('keyboard'|'gamepad'|'phone') / player.away
//   players.on('join'|'leave'|'change', fn)  and the `onDespawn(player)` constructor option
//   players.frozenAll = true     freeze everybody (pair panel)
import * as THREE from 'three';
import { InputManager } from '../input/inputManager.js';
import { BotSource } from '../input/botSource.js';
import {
  MAX_PLAYERS, PLAYER_COLORS, DISCONNECT_GRACE_S, TETHER_DISTANCE, PLAYER_PUSH_RADIUS,
  REGROUP_DELAY_S, REGROUP_DROP_S, REGROUP_MARGIN, CAMERA_MAX_ZOOM,
} from '../config.js';
import { createRegroupState, updateRegroup, isOffscreen } from './regroupLogic.js';
import { Player } from '../player/player.js';
import { getHeight, isWalkable, SPAWN } from '../world/terrain.js';
import { overlapsAny } from '../world/colliders.js';
import { PlayerVisuals } from './playerVisuals.js';
import { SlotTable } from './slotTable.js';

const TAU = Math.PI * 2;
const PUSH_RATE = 14;             // how fast overlapping players push apart (1/s)
const FULL_TOAST_GAP = 3;         // s between "island is full" toasts
const TETHER_TOAST_GAP = 3.5;
const RESEND_ASSIGN_S = 4;        // phones get their assignment again now and then (a missed message heals itself)
const SPAWN_POP = 0.35;           // s
const LEAVE_POP = 0.2;
const REJOIN_DELAY_S = 0.5;       // after the keyboard player left, keys are ignored this long before they rejoin

const easeOutBack = (t) => { const c1 = 1.9, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** A source whose state is set by hand (debug / tests). */
class FakeSource {
  constructor(name) { this.name = name; this.analog = true; this.s = { x: 0, y: 0, interact: false, cancel: false, jump: false, charm: false }; this._tapI = false; this._tapC = false; }
  set(st) {
    if (st.interact && !this.s.interact) this._tapI = true;
    if (st.cancel && !this.s.cancel) this._tapC = true;
    if (st.jump && !this.s.jump) this._tapJ = true;
    if (st.charm && !this.s.charm) this._tapCh = true;
    if (st.menu && !this.s.menu) this._tapM = true;
    this.s = { x: st.x || 0, y: st.y || 0, interact: !!st.interact, cancel: !!st.cancel, jump: !!st.jump, charm: !!st.charm, menu: !!st.menu };
  }
  poll() {
    const o = { ...this.s, interactTap: this._tapI, cancelTap: this._tapC, jumpTap: !!this._tapJ, charmTap: !!this._tapCh, menuTap: !!this._tapM };
    this._tapI = this._tapC = this._tapJ = this._tapCh = this._tapM = false;
    return o;
  }
}

/** Spread of players around their centroid (the camera looks from +z): fills `out` { x, z, half, near, far } and returns it. */
function _spread(list, out) {
  let cx = 0, cz = 0;
  for (const p of list) { cx += p.position.x / list.length; cz += p.position.z / list.length; }
  let half = 0, near = 0, far = 0, ez = 0;
  for (const p of list) {
    const dx = p.position.x - cx, dz = p.position.z - cz;
    half = Math.max(half, Math.abs(dx)); ez = Math.max(ez, Math.abs(dz));
    if (dz > near) near = dz;
    if (-dz > far) far = -dz;
  }
  out.x = half * 2; out.z = ez * 2; out.half = half; out.near = near; out.far = far;
  return out;
}

function newActions() {
  return {
    move: { x: 0, z: 0 },
    interactPressed: false, cancelPressed: false, jumpPressed: false, charmPressed: false,
    interactHeld: false, cancelHeld: false, jumpHeld: false, charmHeld: false,
    menuPressed: false,          // gamepad Start / the phone pad's Bag button (main.js: opens / closes the Bag)
    held: { interact: false, cancel: false },
    activeSource: 'keyboard',
  };
}

const moveMag = (a) => Math.hypot(a.move.x, a.move.z);
const hasInput = (a) => a.activity || moveMag(a) > 0.001 || a.interactPressed || a.cancelPressed || a.jumpPressed || a.charmPressed || a.interactHeld || a.cancelHeld || a.jumpHeld || a.charmHeld;

/** out = merge of a (and optionally b): biggest stick wins, buttons OR-ed. `lastActive` keeps the glyph stable when idle. */
function mergeInto(out, a, b) {
  let best = a, bestM = moveMag(a);
  if (b) { const m = moveMag(b); if (m > bestM) { best = b; bestM = m; } }
  out.move.x = bestM > 0 ? best.move.x : 0;
  out.move.z = bestM > 0 ? best.move.z : 0;
  out.interactPressed = a.interactPressed || (!!b && b.interactPressed);
  out.cancelPressed = a.cancelPressed || (!!b && b.cancelPressed);
  out.jumpPressed = !!a.jumpPressed || (!!b && !!b.jumpPressed);
  out.jumpHeld = !!a.jumpHeld || (!!b && !!b.jumpHeld);
  out.charmPressed = !!a.charmPressed || (!!b && !!b.charmPressed);
  out.charmHeld = !!a.charmHeld || (!!b && !!b.charmHeld);
  out.interactHeld = a.interactHeld || (!!b && b.interactHeld);
  out.cancelHeld = a.cancelHeld || (!!b && b.cancelHeld);
  out.menuPressed = !!a.menuPressed || (!!b && !!b.menuPressed);
  out.held.interact = out.interactHeld;
  out.held.cancel = out.cancelHeld;
  if (bestM > 0) out.activeSource = best.activeSource;
  else if (hasInput(a)) out.activeSource = a.activeSource;
  else if (b && hasInput(b)) out.activeSource = b.activeSource;
  else if (!b) out.activeSource = a.activeSource;
}

function zeroActions(out) {
  out.move.x = out.move.z = 0;
  out.interactPressed = out.cancelPressed = out.jumpPressed = out.charmPressed = out.interactHeld = out.cancelHeld = out.jumpHeld = out.charmHeld = out.menuPressed = false;
  out.held.interact = out.held.cancel = false;
}

export class PlayerManager {
  /**
   * @param {object} o
   * @param {THREE.Scene} o.scene
   * @param {InputManager} o.local     the keyboard (+ host touch) InputManager = the 'local' device
   * @param {GamepadSource} [o.gamepads]
   * @param {RemoteSource} [o.remote]
   * @param {object} o.hud             createHud() result (toast, setRoster)
   * @param {HTMLElement} o.hudRoot
   * @param {Particles} o.particles
   * @param {Sfx} [o.sfx]
   * @param {'keyboard'|'phone'} [o.localKind]   icon for the local device (phone when the host page has touch controls)
   * @param {(player) => void} [o.onDespawn]     called before a player poofs away (main.js prefers players.on('leave'))
   * @param {WorldSync} [o.sync]                 slot claims go through its 'players' domain (see net/playersDomain.js); without it the manager is a standalone host
   * @param {SlotTable} [o.table]                the slot table the domain works on (host: authoritative, replica: the host's copy)
   */
  constructor({ scene, local, gamepads = null, remote = null, hud, hudRoot, particles, sfx = null, localKind = 'keyboard', onDespawn = null, sync = null, table = null }) {
    this.scene = scene;
    this.sync = sync;
    this.table = table || new SlotTable(MAX_PLAYERS);
    this.isReplica = !!sync && sync.isReplica;
    this.hud = hud;
    this.particles = particles;
    this.sfx = sfx;
    this.gamepads = gamepads;
    this.remote = remote;
    this.onDespawn = onDespawn;
    this.localKind = localKind;
    this.frozenAll = false;
    this.activity = false;            // any device gave real input this frame
    this.queueing = false;            // Step 80e: the party (host) sets it: a device that found the island full keeps asking for a seat by itself
    this.gamepadPressed = false;      // a gamepad button went down this frame (audio unlock)
    this.focus = new THREE.Vector3(); // centroid of the active players (camera target)
    this.extent = { x: 0, z: 0, half: 0, near: 0, far: 0 };   // x / z = 2 x max distance of a player from the centroid along each axis;
                                                              // half = max sideways, near / far = max toward (+z) / away from the camera
    this._handlers = {};
    this._time = 0;
    this._lastFullToast = -99;
    this._lastTetherToast = -99;
    this._tetherHit = false;
    this._rosterSig = '';
    this._dirty = true;
    this._fakeN = 0;
    this._botN = 0;
    this._regroup = createRegroupState();
    this._lost = new Set();           // slots the camera does not frame right now (off screen for a while: see updateRegroup)
    this._warn = new Map();           // slot -> { left, anchor }: the edge arrows
    this._ndc = new THREE.Vector3();

    this._remoteSeen = this.isReplica ? null : new Map();   // slot -> "screen|dev" of the other screens' players last announced (see _announceRemote)
    this.visuals = new PlayerVisuals(hudRoot);
    this.devices = new Map();
    this.p1Owner = null;              // device id that claimed P1 (null = nobody yet / reverted to local)

    this._guard = (p, x, z) => this._tetherOk(p, x, z);

    // slot array, indexed by the GLOBAL slot (only this screen's players are in it). On the host P1 always exists (it is what the rest of
    // the game is wired to); on a replica the first local player is a hidden placeholder until the host grants it a slot.
    this.players = new Array(MAX_PLAYERS).fill(null);
    this._placeholder = null;
    const localDev = this._makeDevice('local', 'local', local, { left: false, leftAt: -99 });
    this.local = localDev;
    const p1 = this._createPlayer(0, undefined, undefined, !this.isReplica);
    p1.device = 'local';
    p1.deviceKind = localKind === 'phone' ? 'phone' : 'keyboard';
    if (this.isReplica) {
      this._placeholder = p1;
      p1.frozen = true;
      p1.root.visible = false;
      localDev.playerIndex = -1;
    } else {
      this.players[0] = p1;
      localDev.playerIndex = 0;
      this.table.claim('host', 'p1', { kind: p1.deviceKind });     // host P1 always exists: it holds slot 0 from the start
    }
    this._updateFocus();
  }

  // ------------------------------------------------------------------ accessors
  /** The primary player of this screen: P1 on the host; on a replica its lowest local slot (or the hidden placeholder before it has one). */
  get p1() { return this.players[0] || this.list[0] || this._placeholder; }
  /** This screen's active (non-despawning) players, lowest slot first. */
  get list() { return this.players.filter((p) => p && !p.leaving); }
  get count() { return this.list.length; }
  /** Players on the whole island (every screen): slot table entries, at least this screen's own. */
  get globalCount() { return Math.max(this.count, this.table.count); }
  get multi() { return this.globalCount > 1; }
  get(i) { return this.players[i] || null; }
  /** "P3" for an actor { screen, index } of any screen (the actor index is the global slot). */
  labelOf(actor) { return actor && Number.isInteger(actor.index) && PLAYER_COLORS[actor.index] ? PLAYER_COLORS[actor.index].name : 'Someone'; }

  on(type, fn) { (this._handlers[type] ||= []).push(fn); return this; }
  _emit(type, ...args) {
    for (const fn of this._handlers[type] || []) { try { fn(...args); } catch (e) { console.error(`PlayerManager handler (${type}):`, e); } }
  }
  _touch() { this._dirty = true; }

  // ------------------------------------------------------------------ devices
  _makeDevice(id, kind, input, extra = {}) {
    const d = { id, kind, input, connected: true, playerIndex: -1, awayT: 0, announce: false, act: null, ...extra };
    this.devices.set(id, d);
    this._touch();
    return d;
  }

  /** True if a "<label> connected" toast went out in the last 3 s (adapter ports can appear over several frames). */
  _recentAnnounce(label) {
    const now = performance.now();
    this._announceAt = this._announceAt || new Map();
    const last = this._announceAt.get(label) || -Infinity;
    if (now - last < 3000) return true;
    this._announceAt.set(label, now);
    return false;
  }

  _padDevice(index) {
    const id = `pad:${index}`;
    let d = this.devices.get(id);
    if (d) return d;
    const im = new InputManager({ activeSource: 'gamepad' });
    im.addSource('gamepad', this.gamepads.view(index));
    d = this._makeDevice(id, 'gamepad', im, { padIndex: index, announce: true });
    return d;
  }

  _phoneDevice(key) {
    const id = `phone:${key}`;
    let d = this.devices.get(id);
    if (d) return d;
    const im = new InputManager({ activeSource: 'remote' });
    im.addSource('remote', this.remote.view(key));
    d = this._makeDevice(id, 'phone', im, { key });
    return d;
  }

  /** Create a fake device (tests). `kind` picks the icon ('gamepad' | 'phone' | 'keyboard'). */
  fakeDevice(id, kind = 'gamepad') {
    const key = id.startsWith('debug:') ? id : `debug:${id}`;
    let d = this.devices.get(key);
    if (d) return d;
    const src = new FakeSource(kind === 'phone' ? 'remote' : kind);
    const im = new InputManager({ activeSource: src.name });
    im.addSource(src.name, src);
    d = this._makeDevice(key, kind, im, { fake: src });
    return d;
  }

  _deviceKindOf(id) {
    const d = this.devices.get(id);
    if (!d) return 'gamepad';
    return d.kind === 'local' ? (this.localKind === 'phone' ? 'phone' : 'keyboard') : d.kind;
  }

  _markAway(d) {
    if (!d.connected) return;
    d.connected = false;
    d.awayT = 0;
    if (d.playerIndex >= 0) {
      const p = this.players[d.playerIndex];
      if (p) {
        if (d.playerIndex !== this.local.playerIndex) { p.away = true; this.visuals.setAway(p, true); }   // P1 stays drivable from the keyboard
        this.hud.toast(`${p.colors.name}'s ${d.kind === 'phone' ? 'phone' : 'controller'} disconnected`, { icon: d.kind === 'phone' ? 'phone' : 'gamepad' });
      }
    }
    this._touch();
  }

  _markBack(d) {
    if (d.connected) return;
    d.connected = true;
    d.awayT = 0;
    if (d.playerIndex >= 0) {
      const p = this.players[d.playerIndex];
      if (p) {
        p.away = false;
        this.visuals.setAway(p, false);
        this.visuals.showTags(2.5);
        this.hud.toast(`${p.colors.name} is back!`, { icon: 'sparkle' });
        this._assign(d, true);
      }
    }
    this._touch();
  }

  _dropDevice(d) {
    this.devices.delete(d.id);
    if (this.p1Owner === d.id) this.p1Owner = null;
    this._touch();
  }

  /** Sync the device list with the gamepad / phone hubs. */
  _syncDevices() {
    if (this.gamepads) {
      this.gamepads.sync();
      for (const [index] of this.gamepads.pads) {
        const d = this._padDevice(index);
        if (!d.connected) this._markBack(d);
      }
      for (const d of [...this.devices.values()]) {
        if (d.kind === 'gamepad' && !d.fake && !this.gamepads.pads.has(d.padIndex)) this._markAway(d);
      }
    }
    if (this.remote) {
      for (const [key, c] of this.remote.clients) {
        const id = `phone:${key}`;
        const d = this.devices.get(id) || this._phoneDevice(key);
        if (!d.connected) this._markBack(d);
        else if (d.fresh !== c.id) { d.fresh = c.id; if (d.playerIndex >= 0) this._assign(d, true); }   // reconnected on a new link connection
      }
      for (const d of [...this.devices.values()]) {
        if (d.kind === 'phone' && !d.fake && !this.remote.clients.has(d.key)) this._markAway(d);
      }
    }
  }

  // ------------------------------------------------------------------ per-frame input
  /** Poll every device, apply the claim / leave rules and fill `player.actions`. Call before the game logic reads actions. */
  pollInput(dt) {
    this._time += dt;
    this.activity = false;
    this.gamepadPressed = false;
    this._syncDevices();

    // poll each device once (each has its own edge detector)
    for (const d of this.devices.values()) {
      d.act = d.connected ? d.input.update() : null;
    }

    // claims
    const localAct = this.local.act;
    if (hasInput(localAct)) {
      this.activity = true;
      if (this.p1Owner === null && !this.isReplica) { this.p1Owner = 'local'; this._touch(); }
      if (this.local.left && this._time - this.local.leftAt >= REJOIN_DELAY_S) {       // the keyboard player who left presses a key: back in
        this.local.left = false;
        if (!this.isReplica) this._claimSlot(this.local, true);                          // (a replica claims just below)
      }
    }
    // a joined screen's own keyboard / touch player asks the host for a slot as soon as the link is up (no button press needed on a phone)
    if (this.isReplica && this.local.playerIndex < 0 && !this.local.left && this.sync.status === 'synced') {
      const first = !this._localTried;
      this._localTried = true;
      this._claimSlot(this.local, first || hasInput(localAct));
    }
    for (const d of this.devices.values()) {
      if (d.id === 'local' || !d.connected || !d.act || d.bot) continue;                     // (a party bot is seated by spawnBot, never by its own input)
      if (!hasInput(d.act)) {
        if (this.queueing && d.queued && d.playerIndex < 0 && !d.claiming) this._claimSlot(d, false);            // Step 80e: a person the party found full stays queued for the seat a bot gives up (no more presses needed)
        continue;
      }
      this.activity = true;
      if (d.kind === 'gamepad' && (d.act.interactPressed || d.act.cancelPressed || d.act.jumpPressed || d.act.charmPressed)) this.gamepadPressed = true;
      if (d.playerIndex >= 0 || d.claiming) continue;
      this._claim(d);
    }

    // connect hint for pads that appeared without claiming (browsers expose a pad on its first button press).
    // One toast per kind of pad: multi-port adapters (GameCube) show up as several pads at once, even empty ports.
    const announced = new Set();
    for (const d of this.devices.values()) {
      if (!d.announce) continue;
      d.announce = false;
      if (d.playerIndex < 0 && d.connected && !d.claiming) {
        const pad = d.padIndex != null ? this.gamepads.pads.get(d.padIndex) : null;
        const label = (pad && pad.profile && pad.profile.label) || 'Controller';
        if (announced.has(label) || this._recentAnnounce(label)) continue;
        announced.add(label);
        this.hud.toast(`${label} connected - press A to join`, { icon: 'gamepad' });
      }
    }

    // route actions to players
    const localSlot = this.local.playerIndex;      // host: 0 (P1). replica: wherever the host put its keyboard / touch player (-1 = none yet)
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const p = this.players[i];
      if (!p) continue;
      const out = p.actions;
      let owner = null;
      for (const d of this.devices.values()) if (d.playerIndex === i && d.id !== 'local') { owner = d; break; }
      const ownerAct = owner && owner.connected && owner.act ? owner.act : null;
      if (i === localSlot) {
        if (ownerAct) mergeInto(out, ownerAct, localAct);
        else mergeInto(out, localAct, null);
      } else if (ownerAct) {
        mergeInto(out, ownerAct, null);
      } else {
        zeroActions(out);
      }
      if (p.leaving) zeroActions(out);
    }

    // grace timers
    for (const d of [...this.devices.values()]) {
      if (d.connected) continue;
      if (d.playerIndex < 0) { this._dropDevice(d); continue; }
      d.awayT += dt;
      if (d.awayT >= DISCONNECT_GRACE_S) this._expire(d);
    }

    // periodically re-send assignments to phones (idempotent on the controller)
    for (const d of this.devices.values()) {
      if (d.kind !== 'phone' || d.playerIndex < 0 || !d.connected || d.fake) continue;
      d.resend = (d.resend || 0) + dt;
      if (d.resend >= RESEND_ASSIGN_S) this._assign(d, false);
    }
    this._refreshRoster();
  }

  _claim(d) {
    if (!this.isReplica && this.p1Owner === null && this.local.playerIndex === 0) {
      // first device to give input claims P1 (the host's P1 exists from the start and holds slot 0 in the table already)
      this.p1Owner = d.id;
      this._bind(d, 0);
      if (this.localKind !== 'phone') {
        const what = d.kind === 'phone' ? 'Phone' : 'Controller';
        this.hud.toast(`${what} plays ${this.players[0].colors.name} - press J to add a keyboard player`, { icon: d.kind === 'phone' ? 'phone' : 'gamepad', duration: 4200 });
      }
      return;
    }
    this._claimSlot(d, true);
  }

  /**
   * Ask the host for a slot for device `d` (any screen, the host's own devices included): `sync.request('players', 'claim')` is answered at once
   * on the host and by a Promise on a replica. A granted slot spawns the player; a full island shows the toast. `byInput` = the user did
   * something (toast on failure); background retries of a joined screen's keyboard stay quiet.
   */
  _claimSlot(d, byInput = true) {
    if (d.claiming || this._time < (d.retryAt || 0)) return;
    if (!this.sync) { this._onClaim(d, this._localClaim(d), byInput); return; }
    d.claiming = true;
    const res = this.sync.request('players', 'claim', { dev: d.id, kind: this._deviceKindOf(d.id), ...(d.bot ? { bot: true, name: d.botName } : {}) }, null);
    if (res && typeof res.then === 'function') res.then((r) => this._onClaim(d, r, byInput));
    else this._onClaim(d, res, byInput);
  }

  /** (no WorldSync, tests only) claim straight in the table. */
  _localClaim(d) {
    const r = this.table.claim('host', d.id, { kind: this._deviceKindOf(d.id) });
    return r.ok ? { ok: true, result: { slot: r.slot, spawn: null } } : { ok: false, reason: r.reason };
  }

  _onClaim(d, r, byInput) {
    d.claiming = false;
    if (!this.devices.has(d.id)) { if (r.ok) this._releaseSlot(d.id); return; }       // the device went away while we waited
    if (!r.ok) {
      d.retryAt = this._time + (r.reason === 'full' ? (byInput || this.queueing ? 0.3 : 2) : 1.5);
      if (r.reason === 'full' && !d.bot) d.queued = true;
      if (r.reason === 'full' && byInput && this._time - this._lastFullToast > FULL_TOAST_GAP) {
        this._lastFullToast = this._time;
        this.hud.toast(`Island is full (${MAX_PLAYERS} players)`, { icon: 'sparkle' });
      }
      return;
    }
    d.queued = false;
    const slot = r.result.slot;
    const at = r.result.spawn || null;
    if (d.playerIndex >= 0 && this.players[d.playerIndex]) return;                    // (already bound: an idempotent re-claim)
    const cur = this.players[slot];
    if (cur) { this._releaseSlot(d.id); d.retryAt = this._time + 0.3; return; }          // (a player still poofing out of that slot: try again in a moment)
    if (d.id === 'local' && this._placeholder) this._adoptLocal(slot, at);
    else this._spawn(slot, d, at);
  }

  /** Tell the host a device's slot is free again (a player left). Fire and forget: the host also frees a dead screen's slots by itself. */
  _releaseSlot(dev) {
    if (!this.sync) { this.table.release('host', dev); return; }
    const res = this.sync.request('players', 'release', { dev }, null);
    if (res && typeof res.catch === 'function') res.catch(() => {});
  }

  /** The hidden placeholder of a replica's keyboard / touch player becomes the real player in the granted slot. */
  _adoptLocal(slot, at) {
    const p = this._placeholder;
    this._placeholder = null;
    p.index = slot;
    p.setColors({ ...PLAYER_COLORS[slot] });
    const near = this.list[0];                       // (rejoining after leaving: next to the players still here, not where it left)
    const { x, z } = this._findSpawn(slot, at || (near ? { x: near.position.x, z: near.position.z } : { x: p.position.x, z: p.position.z }));
    p.teleport(x, z);
    p.frozen = false;
    p.root.visible = true;
    this.players[slot] = p;
    this.visuals.attach(p);
    p.root.scale.setScalar(0.01);
    p.spawnT = 0;
    p.facing = 0;
    this._poof(p.position, p.colors);
    if (this.sfx) this.sfx.play('pop', { pitch: 1.15 });
    this._bind(this.local, slot);
    this.visuals.showTags(3);
    this.hud.toast(`${p.colors.name} joined!`, { icon: 'sparkle' });
    this._emit('join', p);
    this._touch();
  }

  /** A replica lost the slot of its keyboard / touch player (the host forgot it): hide it again and claim afresh. */
  _unadoptLocal(p) {
    if (this.players[p.index] === p) this.players[p.index] = null;
    this._emit('leave', p);
    this.visuals.detach(p);
    p.root.visible = false;
    p.frozen = true;
    this._placeholder = p;
    p.index = 0;
    this.local.playerIndex = -1;
    this._localTried = false;
    this._touch();
  }

  /**
   * Replica: the host's slot table changed (event / snapshot). Players whose slot is no longer ours (the host restarted, or freed it after a
   * long outage) go away, and slots the host still lists for this screen that no device uses any more are released.
   */
  reconcileSlots() {
    if (!this.isReplica || !this.sync || this.sync.status !== 'synced') return;
    const me = this.sync.screenId;
    for (const p of [...this.list]) {
      const e = this.table.get(p.index);
      if (e && e.screen === me && e.dev === p.device) continue;
      const d = this.devices.get(p.device);
      if (d && d.claiming) continue;
      if (p === this.players[p.index] && p.device === 'local') { this._unadoptLocal(p); continue; }
      if (d) d.playerIndex = -1;
      this._despawn(p);
    }
    this.table.slots.forEach((e, i) => {
      if (!e || e.screen !== me) return;
      const d = this.devices.get(e.dev);
      if (d && (d.claiming || d.playerIndex === i)) return;
      if (this.players[i]) return;                                   // a player of ours is still poofing out of it
      if (e.dev === 'local' && this.local.claiming) return;
      this._releaseSlot(e.dev);
    });
  }

  /** The host's table changed (host: after a claim / release / screen event; replica: after applying an event): refresh the roster. */
  slotsChanged() {
    this._touch();
    this._announceRemote();
    this.reconcileSlots();
  }

  /** Toasts for players of OTHER screens arriving / leaving ("P3 joined on another screen"). The first table a screen sees is the baseline. */
  _announceRemote() {
    const me = this.isReplica ? (this.sync && this.sync.screenId) : 'host';
    if (this.isReplica && !me) return;
    const cur = new Map();
    this.table.slots.forEach((e, i) => { if (e && e.screen !== me) cur.set(i, `${e.screen}|${e.dev}`); });
    const prev = this._remoteSeen;
    this._remoteSeen = cur;
    if (!prev) return;
    for (const [i, key] of cur) {
      if (prev.get(i) !== key) this.hud.toast(`${PLAYER_COLORS[i].name} joined on another screen!`, { icon: 'screen' });
    }
    for (const [i] of prev) {
      if (!cur.has(i)) this.hud.toast(`${PLAYER_COLORS[i].name} left`, { icon: 'sparkle' });
    }
  }

  _bind(d, index) {
    d.playerIndex = index;
    const p = this.players[index];
    if (p) {
      p.device = d.id;
      p.deviceKind = this._deviceKindOf(d.id);
      p.away = false;
      p.actions.activeSource = d.input.state.activeSource;
      this.visuals.setAway(p, false);
    }
    this._assign(d, true);
    this._touch();
  }

  /** The device stayed away for the whole grace period. */
  _expire(d) {
    const i = d.playerIndex;
    const p = this.players[i];
    if (i >= 0 && i === this.local.playerIndex) {
      // the keyboard's player never despawns: it reverts to local and becomes claimable again
      d.playerIndex = -1;
      if (p) { p.device = 'local'; p.deviceKind = this._deviceKindOf('local'); p.away = false; this.visuals.setAway(p, false); }
      this._dropDevice(d);
      this.hud.toast(`${p ? p.colors.name : 'P1'} is back on ${this.localKind === 'phone' ? 'touch' : 'the keyboard'}`, { icon: this.localKind === 'phone' ? 'phone' : 'keyboard' });
    } else if (p) {
      this._despawn(p);
      this._dropDevice(d);
    } else {
      this._dropDevice(d);
    }
  }

  // ------------------------------------------------------------------ the keyboard player leaving
  /** The gamepad / phone that shares slot `i` with the keyboard (it claimed P1 first), or null. */
  _sharedOwner(i) {
    for (const d of this.devices.values()) if (d.id !== 'local' && d.playerIndex === i) return d;
    return null;
  }

  /**
   * The device id slot `i` is held under in the host's table: the host's P1 slot stays keyed 'p1' even after a gamepad / phone that took
   * over P1 kept it (the keyboard split off or left), so releasing that player must release 'p1'.
   */
  _slotDev(i, dev) { return !this.isReplica && this.table.find('host', 'p1') === i ? 'p1' : dev; }

  /** True when the keyboard shares its player with the (connected) gamepad / phone that claimed it, so it can split off into its own. */
  canSplitLocal() {
    const i = this.local.playerIndex;
    if (this.localKind === 'phone' || i < 0 || this.local.left || this.local.claiming || !this.players[i]) return false;
    const owner = this._sharedOwner(i);
    return !!owner && owner.connected;
  }

  /**
   * The keyboard stops sharing the controller's player and joins as a new player in the lowest free slot (see the header). Returns false
   * when it can't (`canSplitLocal()`, or the island is full: the usual toast).
   */
  splitLocal() {
    if (!this.canSplitLocal()) return false;
    if (this.table.count >= MAX_PLAYERS) {
      if (this._time - this._lastFullToast > FULL_TOAST_GAP) { this._lastFullToast = this._time; this.hud.toast(`Island is full (${MAX_PLAYERS} players)`, { icon: 'sparkle' }); }
      return false;
    }
    const d = this.local;
    const i = d.playerIndex;
    d.playerIndex = -1;                                // the controller now drives slot i alone
    d.retryAt = 0;
    this._claimSlot(d, true);                          // host: answered at once (spawns + binds); replica: a Promise
    if (!this.isReplica && d.playerIndex < 0 && !d.claiming) { d.playerIndex = i; this._touch(); return false; }   // (refused: keep sharing)
    this._touch();
    return true;
  }

  /** True when the keyboard player may leave: it has a player and somebody else keeps playing on this screen (or shares its player). */
  canLeaveLocal() {
    const i = this.local.playerIndex;
    if (i < 0 || this.local.left || !this.players[i]) return false;
    return this.count > 1 || !!this._sharedOwner(i);
  }

  /**
   * The keyboard (+ host touch) player leaves the game; any key brings it back (see the header). Returns false when it can't
   * (`canLeaveLocal()`). Its held item drops and an open dialog it owns closes (the 'leave' event); its slot is freed for anybody.
   */
  leaveLocal() {
    if (!this.canLeaveLocal()) return false;
    const d = this.local;
    const i = d.playerIndex;
    const p = this.players[i];
    d.left = true;
    d.leftAt = this._time;
    d.playerIndex = -1;
    const owner = this._sharedOwner(i);
    if (owner) {                                       // P1 belongs to the gamepad / phone that claimed it: it just stops listening to the keyboard
      this.hud.toast(`Keyboard left ${p.colors.name} - press any key to rejoin`, { icon: 'keyboard' });
      this._touch();
      return true;
    }
    if (this.onDespawn) { try { this.onDespawn(p); } catch (e) { console.error(e); } }
    this._emit('leave', p);
    this._poof(p.position, p.colors);
    if (this.sfx) this.sfx.play('bip', { pitch: 1.2 });
    this.hud.toast(`${p.colors.name} left - press any key to rejoin`, { icon: 'keyboard' });
    this.players[i] = null;
    this.visuals.detach(p);
    zeroActions(p.actions);
    p.root.visible = false;
    p.frozen = true;
    this._placeholder = p;                             // the same Player object comes back on rejoin (_adoptLocal)
    this._releaseSlot(this._slotDev(i, 'local'));
    if (!this.isReplica && (this.p1Owner === null || this.p1Owner === 'local')) this.p1Owner = 'left';   // pads now claim free slots normally
    this._touch();
    return true;
  }

  // ------------------------------------------------------------------ spawn / despawn
  _createPlayer(index, x, z, attach = true) {
    const colors = { ...PLAYER_COLORS[index] };         // (a copy: a replica's placeholder is recoloured when it gets its slot)
    const p = new Player(this.scene, { x, z, colors, index });
    p.screen = 'local';
    p.actions = newActions();
    p.device = null;
    p.deviceKind = 'keyboard';
    p.away = false;
    p.leaving = 0;               // >0 while poofing away (seconds elapsed)
    p.spawnT = -1;               // >=0 while popping in
    p.moveGuard = this._guard;
    if (attach) this.visuals.attach(p);
    return p;
  }

  /** A walkable, collider-free spot near P1 (or near `anchor` {x,z}: the host group, for a player joining from another screen) for a newcomer. */
  _findSpawn(slot, anchor = null) {
    const a0 = anchor || this.p1.position;
    const base = [0, 0, Math.PI, Math.PI / 2][slot] || 0;
    const others = this.list;
    for (const r of [1.7, 2.3, 3.1, 4.2, 5.6, 7, 9, 12, 16]) {
      for (let k = 0; k < 12; k++) {
        const ang = base + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (TAU / 12) * (k === 0 ? 0 : 1);
        const x = a0.x + Math.cos(ang) * r, z = a0.z + Math.sin(ang) * r;
        if (!isWalkable(x, z) || getHeight(x, z) < 0.15 || overlapsAny(x, z, 0.6)) continue;
        let clear = true;
        for (const q of others) if (Math.hypot(q.position.x - x, q.position.z - z) < 1.1) { clear = false; break; }
        if (clear) return { x, z };
      }
    }
    // A crowded landing can exhaust the close rings; never place a joiner inside the anchor's collider.
    for (let r = 0; r <= 25; r += 1) for (let k = 0; k < 24; k++) {
      const a = k * TAU / 24;
      const x = a0.x + Math.cos(a) * r, z = a0.z + Math.sin(a) * r;
      if (isWalkable(x, z) && getHeight(x, z) >= 0.15 && !overlapsAny(x, z, 0.6)
          && others.every((q) => Math.hypot(q.position.x - x, q.position.z - z) >= 1.1)) return { x, z };
    }
    return { x: SPAWN.x, z: SPAWN.z };
  }

  _poof(pos, colors) {
    const at = { x: pos.x, y: pos.y + 0.5, z: pos.z };
    this.particles.burst('puff', at, { count: 12, radius: 0.55, height: 0.35, size: 1.5, speed: 1.3 });
    this.particles.burst('sparkle', at, { count: 9, radius: 0.5, height: 0.4, color: colors.ui, speed: 1.2 });
    this.particles.burst('sparkle', at, { count: 4, radius: 0.4, height: 0.4, color: '#ffffff', speed: 0.9 });
  }

  _spawn(slot, device, anchor = null) {
    const { x, z } = this._findSpawn(slot, anchor);
    const p = this._createPlayer(slot, x, z);
    this.players[slot] = p;
    p.root.scale.setScalar(0.01);
    p.spawnT = 0;
    p.facing = 0;
    if (device && device.bot) {                                      // Step 80a: a party bot wears its Tdoong's colours, name and ears
      p.bot = true;
      p.setColors({ ...device.botColors, name: device.botName });
      if (device.botEars) p.wearPartyHat(device.botEars);
    }
    this._poof(p.position, p.colors);
    if (this.sfx) this.sfx.play('pop', { pitch: 1.15 });
    if (device) this._bind(device, slot);
    this.visuals.showTags(3);
    if (!p.bot) this.hud.toast(`${p.colors.name} joined!`, { icon: 'sparkle' });
    this._emit('join', p);
    this._touch();
    return p;
  }

  _despawn(p) {
    if (!p || p.leaving || p.index === this.local.playerIndex) return;      // (the keyboard's player leaves through leaveLocal)
    if (this.onDespawn) { try { this.onDespawn(p); } catch (e) { console.error(e); } }   // (also emitted as 'leave' just below)
    this._emit('leave', p);
    p.leaving = 0.0001;
    p.frozen = true;
    this._poof(p.position, p.colors);
    if (this.sfx) this.sfx.play('bip', { pitch: 1.2 });
    if (!p.bot) this.hud.toast(`${p.colors.name} left`, { icon: 'sparkle' });
    this._touch();
  }

  _finishDespawn(p) {
    this.visuals.detach(p);
    p.dispose();
    if (this.players[p.index] === p) {
      this.players[p.index] = null;
      this._releaseSlot(this._slotDev(p.index, p.device));   // the slot is free again (only now: a newcomer must not reuse it while this one still poofs)
    }
    this._touch();
  }

  // ------------------------------------------------------------------ party bots (Step 80a)
  /** The bot players on this (host) screen. */
  get bots() { return this.list.filter((p) => p.bot); }

  /**
   * Seat a party bot: { name, colors, ears } (game/party/botRoster.js). Returns the Player, or null (a joined screen cannot seat bots; the island is full). Its BotSource is `player.botSource`: the party
   * runtime feeds it each frame (intend / hold / tick).
   */
  spawnBot({ name, colors, ears = null }) {
    if (this.isReplica || this.table.count >= MAX_PLAYERS) return null;
    const src = new BotSource();
    const im = new InputManager({ activeSource: 'bot' });
    im.addSource('bot', src);
    const d = this._makeDevice(`bot:${++this._botN}`, 'bot', im, { bot: true, botName: name, botColors: colors, botEars: ears, botSource: src });
    this._claimSlot(d, false);
    const p = d.playerIndex >= 0 ? this.players[d.playerIndex] : null;
    if (!p) { this.devices.delete(d.id); return null; }
    p.botSource = src;
    return p;
  }

  /** Send a party bot away (it poofs; the slot is freed once the poof is over). */
  removeBot(p) {
    if (!p || !p.bot || p.leaving) return false;
    const d = this.devices.get(p.device);
    this._despawn(p);
    if (d) this.devices.delete(d.id);
    p.botSource?.release();
    this._touch();
    return true;
  }

  // ------------------------------------------------------------------ tether + push
  _tetherOk(p, x, z) {
    for (const q of this.players) {
      if (!q || q === p || q.leaving || q.away) continue;
      const nd = Math.hypot(x - q.position.x, z - q.position.z);
      if (nd <= TETHER_DISTANCE) continue;
      const cur = Math.hypot(p.position.x - q.position.x, p.position.z - q.position.z);
      if (nd > cur) { this._tetherHit = true; this._emit('tether', p, q); return false; }
    }
    return true;
  }

  _separate(dt) {
    const act = this.list;
    if (act.length < 2) return;
    const k = Math.min(1, PUSH_RATE * dt) * 0.5;
    for (let i = 0; i < act.length; i++) {
      for (let j = i + 1; j < act.length; j++) {
        const a = act[i], b = act[j];
        if ((a.partyLayer || b.partyLayer) && a.partyLayer !== b.partyLayer) continue;
        let dx = b.position.x - a.position.x, dz = b.position.z - a.position.z;
        let d = Math.hypot(dx, dz);
        if (d >= PLAYER_PUSH_RADIUS) continue;
        if (d < 1e-4) { const ang = (a.index * 2.1 + b.index * 0.7) % TAU; dx = Math.cos(ang); dz = Math.sin(ang); d = 1; }
        const nx = dx / d, nz = dz / d;
        const push = (PLAYER_PUSH_RADIUS - Math.min(d, PLAYER_PUSH_RADIUS)) * k;
        a.nudge(-nx * push, -nz * push);
        b.nudge(nx * push, nz * push);
      }
    }
  }

  // ------------------------------------------------------------------ per-frame update
  /** Advance every player (movement, tether, soft push, spawn / despawn pops). */
  update(dt) {
    this._tetherHit = false;
    const frozen = this.frozenAll;
    for (const p of this.players) {
      if (!p) continue;
      p.paused = frozen;
      p.update(dt, p.actions);
      if (p.spawnT >= 0) {
        p.spawnT += dt;
        const u = clamp01(p.spawnT / SPAWN_POP);
        p.root.scale.setScalar(Math.max(0.01, easeOutBack(u)));
        if (u >= 1) { p.spawnT = -1; p.root.scale.setScalar(1); }
      }
      if (p.leaving > 0) {
        p.leaving += dt;
        const u = clamp01(p.leaving / LEAVE_POP);
        p.root.scale.setScalar(Math.max(0.01, 1 - u * u));
        if (u >= 1) this._finishDespawn(p);
      }
    }
    this._separate(dt);
    if (this._tetherHit && this._time - this._lastTetherToast > TETHER_TOAST_GAP) {
      this._lastTetherToast = this._time;
      this.hud.toast('Stay closer together!', { icon: 'sparkle', duration: 1800 });
    }
    this._updateFocus();
  }

  /** Camera focus + spread: THIS screen's players only (remote players never move your camera or tether you). */
  _updateFocus() {
    let act = this.list;
    if (this._lost.size) { const kept = act.filter((p) => !this._lost.has(p.index)); if (kept.length) act = kept; }   // (lost players: see updateRegroup)
    if (!act.length && this._placeholder) act = [this._placeholder];     // a joined screen before it has a slot: look at the spawn area
    let sx = 0, sy = 0, sz = 0;
    for (const p of act) { sx += p.position.x; sy += p.position.y; sz += p.position.z; }
    const n = act.length || 1;
    this.focus.set(sx / n, sy / n, sz / n);
    _spread(act, this.extent);
  }

  /**
   * Regroup (see the header): once per frame AFTER the camera moved. `blocked` = this screen is in a cutscene or a panel (nobody pops,
   * timers reset). Nobody counts as off screen while the camera could still frame the whole group at its widest zoom (it is only lagging
   * behind, e.g. right after a fast move): otherwise dropping a player from the framing would stop the camera from ever catching up.
   * Returns the pops of this frame ([{ player, anchor }]).
   */
  updateRegroup(dt, camera, { blocked = false, followCam = null } = {}) {
    const act = this.list;
    camera.updateMatrixWorld();
    const v = this._ndc, cx = this.focus.x, cz = this.focus.z;
    let fits = act.length < 2;
    if (!fits && followCam) {
      fits = followCam.zoomForSpread(_spread(act.filter((p) => !p.away), {}), { margin: 0.5, clamp: false }) <= CAMERA_MAX_ZOOM;   // (no framing margin)
    }
    const entries = act.map((p) => {
      // outward motion: how much this player walked away from the group centre lately (decays over ~1.5 s; teleports don't count)
      const dx = p.position.x - (p._rgX ?? p.position.x), dz = p.position.z - (p._rgZ ?? p.position.z);
      p._rgX = p.position.x; p._rgZ = p.position.z;
      const rx = p.position.x - cx, rz = p.position.z - cz, rl = Math.hypot(rx, rz) || 1;
      const outward = Math.hypot(dx, dz) < 3 ? Math.max(0, (dx * rx + dz * rz) / rl) : 0;
      p._widen = (p._widen || 0) * Math.exp(-dt / 1.5) + outward;
      v.set(p.position.x, p.position.y + 0.8, p.position.z).project(camera);
      return {
        key: p.index, x: p.position.x, z: p.position.z, off: !fits && isOffscreen(v, REGROUP_MARGIN), widen: p._widen,
        eligible: !blocked && !this.frozenAll && !p.away && !p.frozen && !p.leaving && p.spawnT < 0,
        anchor: !p.away && !p.leaving,
      };
    });
    const r = updateRegroup(this._regroup, entries, dt, { delay: REGROUP_DELAY_S, dropAfter: REGROUP_DROP_S });
    this._lost = r.lost;
    this._warn = r.warn;
    const pops = [];
    for (const { key, anchor } of r.pops) {
      const p = this.players[key], a = this.players[anchor];
      if (p && a) { this._regroupPop(p, a); pops.push({ player: p, anchor: a }); }
    }
    return pops;
  }

  /** Pop `p` out where it is and back in on a clear spot next to `anchor` (the spawn pop + poofs; the pose sync sees a teleport). */
  _regroupPop(p, anchor) {
    this._poof(p.position, p.colors);
    const { x, z } = this._findSpawn(p.index, { x: anchor.position.x, z: anchor.position.z });
    p.teleport(x, z);
    p._rgX = x; p._rgZ = z; p._widen = 0;
    p.root.scale.setScalar(0.01);
    p.spawnT = 0;
    this._poof(p.position, p.colors);
    if (this.sfx) this.sfx.play('pop', { pitch: 1.3 });
    this.visuals.showTags(2);
    this.hud.toast(`${p.colors.name} hopped back to ${anchor.colors.name}`, { icon: 'sparkle', duration: 1800 });
    this._emit('regroup', p, anchor);
    this._updateFocus();
  }

  /** Zoom target for the FollowCamera (1 when solo). */
  cameraZoom(followCam) {
    if (this.count < 2) return 1;
    return followCam.zoomForSpread(this.extent);
  }

  /** Rings + name tags (after the camera moved). */
  updateFx(dt, camera) {
    this.visuals.update(dt, camera, { multi: this.multi, warn: this._warn });
  }

  // ------------------------------------------------------------------ phones
  _assign(d, fresh) {
    if (d.kind !== 'phone' || d.fake || !this.remote || d.playerIndex < 0) return;
    d.resend = 0;
    const c = PLAYER_COLORS[d.playerIndex];
    this.remote.sendTo(d.key, { type: 'assign', player: d.playerIndex + 1, color: c.ui, hat: c.hat, shirt: c.shirt, fresh: !!fresh });
  }

  /** Step 58: tell a phone controller whether to show its Charm button and how recharged the charm is (0..1). Local screens use the touch widget instead. */
  sendCharmUi(player, show, frac) {
    const d = player && [...this.devices.values()].find((x) => x.playerIndex === player.index);
    if (!d || d.kind !== 'phone' || d.fake || !this.remote) return false;
    return this.remote.sendTo(d.key, { type: 'charm-ui', show: !!show, frac: Math.round(Math.min(1, Math.max(0, frac || 0)) * 20) / 20 });
  }

  /** Phones for the pair panel: [{ key, label: 'P2' | null, color }]. */
  phones() {
    const out = [];
    for (const d of this.devices.values()) {
      if (d.kind !== 'phone') continue;
      const c = d.playerIndex >= 0 ? PLAYER_COLORS[d.playerIndex] : null;
      out.push({ key: d.key, label: c ? c.name : null, color: c ? c.ui : null, away: !d.connected });
    }
    return out;
  }

  // ------------------------------------------------------------------ roster
  _refreshRoster() {
    if (!this._dirty) return;          // every roster-relevant change goes through _touch()
    const slots = [];
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const p = this.players[i];
      const c = PLAYER_COLORS[i];
      if (!p || p.leaving) {
        // nobody here: a player of ANOTHER screen (slot table) shows with the "other screen" badge, otherwise the slot is empty
        const e = p ? null : this.table.get(i);
        if (e) slots.push({ state: e.away ? 'away' : 'active', label: c.name, color: c.ui, icons: ['screen'], remote: true });
        else slots.push({ state: 'empty', label: c.name, color: c.ui, icons: [] });
        continue;
      }
      const icons = [];
      const mine = i === this.local.playerIndex;
      if (mine && !this.isReplica) {
        icons.push(this.localKind === 'phone' ? 'phone' : 'keyboard');
        const owner = this._sharedOwner(i);
        if (owner) icons.push(this._deviceKindOf(owner.id));
      } else {
        icons.push(p.deviceKind);
      }
      const slot = { state: p.away ? 'away' : 'active', label: c.name, color: c.ui, icons: [...new Set(icons)] };
      if (mine && this.canSplitLocal()) slot.split = true;                                   // shared with a controller: split off instead
      else if (mine && this.localKind !== 'phone' && this.canLeaveLocal()) slot.leave = true;  // the keyboard player's chip gets a leave button
      slots.push(slot);
    }
    const sig = JSON.stringify(slots);
    this._dirty = false;
    if (sig === this._rosterSig) { this._emit('change'); return; }
    this._rosterSig = sig;
    this.hud.setRoster(slots);
    this._emit('change');
  }

  // ------------------------------------------------------------------ debug / tests
  /**
   * Spawn a player driven by a fake device (no hardware needed). Returns the Player. Drive it with `fake(id, {x, y, interact, cancel})`.
   * @param {string} [id]     device name (default debug-N)
   * @param {'gamepad'|'phone'} [kind]
   */
  spawnDebugPlayer(id = `dbg${++this._fakeN}`, kind = 'gamepad') {
    const d = this.fakeDevice(id, kind);
    if (d.playerIndex >= 0) return this.players[d.playerIndex];
    if (this.p1Owner === null) this.p1Owner = 'local';      // debug devices always join as a NEW player (P2+)
    this._claim(d);
    return d.playerIndex >= 0 ? this.players[d.playerIndex] : null;
  }

  /** Set the state of a fake device: fake('dbg1', { x: 1, y: 0, interact: false, jump: false }). Creates and claims it on first use. */
  fake(id, state = {}, kind = 'gamepad') {
    const d = this.fakeDevice(id, kind);
    d.fake.set(state);
    return d;
  }

  /** Disconnect a fake device (starts the grace period, like unplugging a pad). */
  unplug(id) { const d = this.devices.get(id.startsWith('debug:') ? id : `debug:${id}`); if (d) { d.fake.set({}); d.connected = true; this._markAway(d); } }
  /** Re-connect a fake device that was unplugged within the grace period. */
  replug(id) { const d = this.devices.get(id.startsWith('debug:') ? id : `debug:${id}`); if (d) this._markBack(d); }

  /** Compact summary of the players and devices. */
  summary() {
    return {
      p1Owner: this.p1Owner,
      players: this.players.map((p) => p && {
        name: p.colors.name, x: +p.position.x.toFixed(2), z: +p.position.z.toFixed(2), device: p.device, kind: p.deviceKind,
        away: p.away, leaving: p.leaving > 0, hat: p.colors.hat,
      }),
      devices: [...this.devices.values()].map((d) => ({ id: d.id, kind: d.kind, connected: d.connected, player: d.playerIndex, awayT: +d.awayT.toFixed(1) })),
      zoom: null,
      role: this.isReplica ? 'replica' : 'host',
      slots: this.table.snapshot(),
      placeholder: !!this._placeholder,
      regroup: { lost: [...this._lost], warn: [...this._warn].map(([i, w]) => ({ slot: i, left: +w.left.toFixed(2), anchor: w.anchor })) },
    };
  }
}
