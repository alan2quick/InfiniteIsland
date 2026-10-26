// The `party` sync domain (Step 80a): the host-authoritative, SESSION-ONLY state of a party. Independent of rendering and of the Players (Node pair tests: test/party.test.js); game/party.js is the screen runtime
// that moves people, draws the stage and the HUD, and drives the bots. Rules live in game/party/flowLogic.js (the phases, the shuffle bag, the board) and the games' own logic modules (registry.js).
//
//   const party = createPartyDomain({ sync, table, prefs: { read(), write(obj) }, rng, positionOf(slot) -> { x, z } | null, busy() -> reason | null, now() -> host ms })
//   party.state                  the live public state (see below); party.on(fn)  fn(kind, data) for 'state' | 'rec' on EVERY screen (the host too)
//   party.update(dt)             the HOST's clock beat (a replica does nothing): flow timers, the game's step, the roster
//   party.gameTime()             seconds on the game clock (negative before Go!): the host's own, a replica's from `startAt` + the synced wall clock
//   party.open(opts) / close()   host requests: opts = { mode, games, rounds, bots, difficulty } (session only; the board's changes are saved)
//   party.toggle(id, on) / enabled() / games()      the Game Board (the last enabled game cannot be switched off); setMode(...) / playNext(id) / skip() / setReady(actor, on)
//   party.act(actor, t, extra)   a press of the game's button (Jump in Vine Skip, Interact in Timber Trim, a flag colour in Marlo Says via extra { flag }, a hold start / end via extra { on } in Pinecone Huddle): `t` = the presser's game-clock estimate, re-judged on the host with PARTY.slack
//   party.debug                  host-only: win(slot), end(), seed(n), play(id)
//   (Step 80e) results.bonus = { label, text, slots } (the game's feat, bonusLogic.js; its winners earn PARTY.bonusStars). After the LAST round of a party (mode 'party') the lobby opens with `ceremony: { places }` (the trophy cut: 1st / 2nd / 3rd,
//   ties share a place): the host ends it after PARTY.ceremony.length s, or on skipCeremony (any screen: the shared hold-Cancel skip), and a FRESH party starts (round 0, no stars). `attract` (host request, bots only: the kiosk's idle
//   demo) leaves the human seats out of the roster so the bots play on their own; setAttract(false) / any human input brings a fresh lobby back. `touch` (any screen) tells the host somebody is playing (it only counts: `touches`).
//
// State (JSON, snapshot = hashView minus the timers): { v, active, serial, mode, rounds, difficulty, bots, enabled, phase, round, bag, last, next, game, seed, roster: [{ slot, bot, name, ready }], stars: { slot: n }, g, results, seenHowto: [gameId],
//   t (phase seconds), gt (game seconds), startAt (host wall ms of Go!) }.  Events: state { s } (every phase / roster / board change) and rec { r, gt } (one game record, applied with the game's apply()).
// The host also sends a beat event tick { gt } every PARTY.tick s while a game counts down / plays (never hashed): a replica's game clock is the synced wall clock plus a smoothed correction from it.
// Requests: open | close | toggle | mode | next | skip | ready | act | skipCeremony | touch | attract | debugWin | debugEnd | debugSeed | debugPlay. Open / close / board changes are host-screen only.
import { PARTY } from '../../config.js';
import { mulberry32 } from '../../utils/rng.js';
import { GAMES, GAME_IDS, getGame } from './registry.js';
import { newFlow, goTo, flowTick, drawGame, toggleGame, normalisePrefs, awardStars, awardBonus, finalPlaces, parseBots } from './flowLogic.js';
import { bonusFor } from './bonusLogic.js';

const r2 = (v) => Math.round(v * 100) / 100;
const TIMER_KEYS = ['t', 'gt', 'startAt'];

export function freshState(prefs) {
  return {
    v: 1, active: false, serial: 0,
    mode: prefs.mode, rounds: prefs.rounds, difficulty: prefs.difficulty, bots: prefs.bots, enabled: prefs.enabled.slice(),
    phase: 'lobby', round: 0, bag: [], last: null, next: null, game: null, seed: 0,
    roster: [], stars: {}, g: null, results: null, seenHowto: [], ceremony: null, attract: false,
    t: 0, gt: 0, startAt: 0,
  };
}

/** A received state made safe (a replica never trusts the shape). */
export function normaliseState(raw, prefs) {
  const base = freshState(prefs);
  if (!raw || typeof raw !== 'object') return base;
  const s = { ...base };
  s.active = !!raw.active;
  s.serial = Number.isInteger(raw.serial) ? raw.serial : 0;
  s.mode = PARTY.modes.includes(raw.mode) ? raw.mode : base.mode;
  s.rounds = Number.isInteger(raw.rounds) && raw.rounds >= 1 ? raw.rounds : base.rounds;
  s.difficulty = PARTY.difficulties.includes(raw.difficulty) ? raw.difficulty : base.difficulty;
  s.bots = parseBots(raw.bots);
  s.enabled = Array.isArray(raw.enabled) ? GAME_IDS.filter((id) => raw.enabled.includes(id)) : base.enabled;
  if (!s.enabled.length) s.enabled = GAME_IDS.slice();
  s.phase = ['lobby', 'pick', 'howto', 'countdown', 'play', 'results'].includes(raw.phase) ? raw.phase : 'lobby';
  s.round = Number.isInteger(raw.round) ? raw.round : 0;
  s.bag = Array.isArray(raw.bag) ? raw.bag.filter((id) => GAME_IDS.includes(id)) : [];
  s.last = GAME_IDS.includes(raw.last) ? raw.last : null;
  s.next = GAME_IDS.includes(raw.next) ? raw.next : null;
  s.game = GAME_IDS.includes(raw.game) ? raw.game : null;
  s.seenHowto = Array.isArray(raw.seenHowto) ? GAME_IDS.filter((id) => raw.seenHowto.includes(id)) : [];
  s.seed = Number.isFinite(raw.seed) ? raw.seed >>> 0 : 0;
  s.roster = Array.isArray(raw.roster) ? raw.roster.filter((r) => r && Number.isInteger(r.slot) && r.slot >= 0 && r.slot < 4).map((r) => ({ slot: r.slot, bot: !!r.bot, name: String(r.name || `P${r.slot + 1}`).slice(0, 24), ready: !!r.ready })) : [];
  s.stars = raw.stars && typeof raw.stars === 'object' ? Object.fromEntries(Object.entries(raw.stars).filter(([k, v]) => /^[0-3]$/.test(k) && Number.isInteger(v) && v >= 0)) : {};
  s.g = s.game && raw.g && typeof raw.g === 'object' ? raw.g : null;
  s.results = raw.results && typeof raw.results === 'object' && Array.isArray(raw.results.ranks) ? raw.results : null;
  s.attract = !!raw.attract;
  s.ceremony = raw.ceremony && typeof raw.ceremony === 'object' && Array.isArray(raw.ceremony.places)
    ? { places: raw.ceremony.places.filter((p) => p && Number.isInteger(p.slot) && p.slot >= 0 && p.slot < 4 && Number.isInteger(p.place) && p.place >= 1).map((p) => ({ slot: p.slot, place: p.place, stars: Number.isInteger(p.stars) ? p.stars : 0 })) } : null;
  for (const k of TIMER_KEYS) s[k] = Number.isFinite(raw[k]) ? raw[k] : 0;
  return s;
}

export function hashView(s) {
  const out = { ...s };
  for (const k of TIMER_KEYS) delete out[k];
  return out;
}

export function createPartyDomain({ sync, table, prefs = { read: () => null, write: () => {} }, rng = Math.random, positionOf = () => null, busy = () => null, now = () => Date.now() }) {
  let pref = normalisePrefs(prefs.read(), GAME_IDS);
  let state = freshState(pref);
  const flow = newFlow();
  const listeners = [];
  const seedRng = mulberry32(((rng() * 0x7fffffff) | 0) ^ 0x9a3c1);
  let doneFor = 0, tickAcc = 0, skew = 0, touches = 0;                    // skew (replica): host game seconds minus the wall-clock estimate, corrected by the host's beat (a slow host tab drifts from wall time)
  let lastView = { active: false, phase: 'lobby', game: null, serial: 0 };
  const fire = (kind, data) => {
    if (kind === 'state') {                                   // every listener gets what changed: prev = the previous { active, phase, game, serial }
      data = { ...data, prev: lastView };
      lastView = { active: data.s.active, phase: data.s.phase, game: data.s.game, serial: data.s.serial };
    }
    for (const fn of listeners) { try { fn(kind, data); } catch (e) { console.error(e); } }
  };
  const game = () => getGame(state.game);
  const savePrefs = () => { pref = { enabled: state.enabled.slice(), mode: state.mode, rounds: state.rounds, bots: state.bots, difficulty: state.difficulty }; try { prefs.write(pref); } catch (_) { /* storage unavailable */ } };

  function publish() {                                       // host: tell everybody the whole public state (cheap and rare: phase changes, roster, board)
    fire('state', { s: state });
    sync.emit('party', 'state', { s: state });
  }

  function emitRec(rec) {
    const g = game();
    if (!g || !state.g) return;
    g.apply(state.g, rec);
    fire('rec', { r: rec, gt: state.gt });
    sync.emit('party', 'rec', { r: rec, gt: r2(state.gt) });
  }

  /** The occupied slots of the island's table as the party roster (ready flags kept). */
  function rosterFromTable() {
    const old = new Map(state.roster.map((r) => [r.slot, r]));
    const out = [];
    table.slots.forEach((e, slot) => {
      if (!e || (state.attract && !e.bot)) return;                       // (the kiosk's attract mode: only the bots play)
      out.push({ slot, bot: !!e.bot, name: e.bot ? String(e.name || `Bot${slot + 1}`).slice(0, 24) : `P${slot + 1}`, ready: !!(old.get(slot) && old.get(slot).ready) });
    });
    return out;
  }
  function refreshRoster() {
    const next = rosterFromTable();
    if (JSON.stringify(next) === JSON.stringify(state.roster)) return false;
    state.roster = next;
    for (const k of Object.keys(state.stars)) if (!next.some((r) => r.slot === Number(k))) delete state.stars[k];
    return true;
  }

  function enter(phase, opts = {}) {
    goTo(flow, phase);
    state.phase = phase; state.t = 0;
    if (phase === 'lobby') {
      for (const r of state.roster) r.ready = false;
      refreshRoster();
      state.g = null; state.game = null; doneFor = 0;
      if (opts.ceremony) state.ceremony = { places: finalPlaces(state.stars, state.roster) };                         // (Step 80e: the trophy cut keeps the stars until it ends)
      else {
        state.ceremony = null;
        if (state.results && state.results.partyOver) { state.round = 0; state.stars = {}; state.results = null; }
      }
    } else if (phase === 'pick') {
      refreshRoster();
      const d = drawGame({ bag: state.bag, enabled: state.enabled, last: state.last, rng, forced: state.next });
      state.game = d.game; state.bag = d.bag; state.next = null; state.last = d.game;
      state.seed = Math.floor(seedRng() * 0xffffffff) >>> 0;
      state.round += 1; state.results = null; state.g = null; state.gt = 0;
    } else if (phase === 'howto') {
      // Remember only a card actually shown, for this host session rather than saved preferences.
      state.seenHowto = GAME_IDS.filter((id) => id === state.game || state.seenHowto.includes(id));
      for (const r of state.roster) r.ready = false;
    } else if (phase === 'countdown') {
      state.g = game().init(state.seed, state.roster);
      state.gt = -PARTY.flow.countdown; state.startAt = now() + PARTY.flow.countdown * 1000;      // (the game clock reaches 0 at Go!)
    } else if (phase === 'play') {
      state.gt = 0; state.startAt = now(); doneFor = 0; tickAcc = 0;
    } else if (phase === 'results') {
      const ranks = game().placing(state.g);
      const winners = ranks.filter((r) => r.place === 1).map((r) => r.slot);
      const bonus = bonusFor(state.game, state.g);
      state.stars = awardStars(state.stars, ranks);
      if (bonus) state.stars = awardBonus(state.stars, bonus.slots);
      const partyOver = state.mode === 'party' && state.round >= state.rounds;
      state.results = { game: state.game, ranks, winners, partyOver, round: state.round, bonus: bonus || null };
    }
    publish();
  }

  /** The trophy cut is over (it ran out, or somebody held Cancel): a FRESH party starts in the lobby. */
  function endCeremony() {
    state.ceremony = null; state.round = 0; state.stars = {}; state.results = null;
    flow.first = true;
    enter('lobby');
  }
  /** The kiosk's attract mode: the bots play without the (idle) humans; off = a fresh lobby. */
  function doAttract(on) {
    if (!state.active) return { reject: 'closed' };
    on = !!on;
    if (on === state.attract) return true;
    if (on && table.slots.filter((e) => e && e.bot).length < 2) return { reject: 'no-bots' };
    state.attract = on;
    state.round = 0; state.stars = {}; state.results = null; state.ceremony = null;
    flow.first = true;
    enter('lobby');
    return true;
  }

  function hostOnly(screen) { return screen === 'host'; }
  const slotOf = (actor, screen) => (actor && Number.isInteger(actor.index) && table.get(actor.index) && table.get(actor.index).screen === screen ? actor.index : -1);

  function doOpen(d) {
    const why = busy();
    if (why) return { reject: why };
    d = d && typeof d === 'object' ? d : {};
    const p = normalisePrefs({ ...pref, ...(d.mode ? { mode: d.mode } : {}), ...(Array.isArray(d.games) ? { enabled: d.games } : {}), ...(d.rounds ? { rounds: d.rounds } : {}), ...(d.bots !== undefined ? { bots: parseBots(d.bots) } : {}), ...(d.difficulty ? { difficulty: d.difficulty } : {}) }, GAME_IDS);
    const serial = state.serial + 1;
    const seenHowto = state.seenHowto.slice();
    state = freshState(p);
    state.seenHowto = seenHowto;
    state.serial = serial; state.active = true;
    state.roster = rosterFromTable();
    Object.assign(flow, newFlow());
    doneFor = 0;
    publish();
    return true;
  }
  function doClose() {
    if (!state.active) return true;
    const serial = state.serial + 1;
    const seenHowto = state.seenHowto.slice();
    state = freshState(pref);
    state.seenHowto = seenHowto;
    state.serial = serial;
    publish();
    return true;
  }

  function doAct(actor, screen, req) {
    const slot = slotOf(actor, screen);
    if (slot < 0 || !state.active) return { reject: 'not-playing' };
    if (state.phase !== 'play' || !state.g) return true;                       // (practice is local: nothing is judged or scored)
    const g = game();
    const ctx = { t: state.gt, slack: PARTY.slack, lag: g.lag, pos: (s) => positionOf(s) };
    // a host-local presser is judged at the host's own time; a remote one at its stamp (clamped inside the game)
    const out = g.request(state.g, slot, screen === 'host' ? { ...req, t: state.gt } : req, ctx);
    if (out.reject) return { reject: out.reject };
    if (out.rec) emitRec(out.rec);
    return true;
  }

  sync.register('party', {
    snapshot: () => state,
    hashView: () => hashView(state),
    applySnapshot: (raw) => { state = normaliseState(raw, pref); skew = 0; fire('state', { s: state, snapshot: true }); },
    applyEvent(kind, d) {
      if (kind === 'state') { const was = state.startAt; state = normaliseState(d && d.s, pref); if (state.startAt !== was) skew = 0; fire('state', { s: state }); }
      else if (kind === 'tick' && d && Number.isFinite(d.gt) && (state.phase === 'play' || state.phase === 'countdown')) {
        const est = (sync.hostNow() - state.startAt) / 1000, late = Number.isFinite(sync.clockRtt) ? sync.clockRtt / 2000 : 0;   // (the beat was sent about one way ago)
        const fresh = d.gt + late - est;
        skew = Math.abs(fresh - skew) > 1 ? fresh : skew + (fresh - skew) * 0.25;
      }
      else if (kind === 'rec' && d && d.r) {
        const g = game();
        if (g && state.g) { g.apply(state.g, d.r); if (Number.isFinite(d.gt)) state.gt = d.gt; fire('rec', { r: d.r, gt: d.gt }); }
      }
    },
    handleRequest(kind, d, actor, screen) {
      d = d && typeof d === 'object' ? d : {};
      switch (kind) {
        case 'open': return hostOnly(screen) ? doOpen(d) : { reject: 'host-only' };
        case 'close': return hostOnly(screen) ? doClose() : { reject: 'host-only' };
        case 'act': return doAct(actor, screen, d);
        case 'skipCeremony': { if (!state.active || !state.ceremony) return { reject: 'not-now' }; endCeremony(); return true; }
        case 'touch': touches++; return true;
        case 'ready': {
          const slot = slotOf(actor, screen), r = state.roster.find((x) => x.slot === slot);
          if (!state.active || state.phase !== 'howto' || !r || r.bot) return { reject: 'not-now' };
          if (r.ready !== !!d.on) { r.ready = !!d.on; publish(); }
          return true;
        }
        default: break;
      }
      if (!hostOnly(screen)) return { reject: 'host-only' };
      switch (kind) {
        case 'toggle': {
          const r = toggleGame(state.enabled, String(d.id), !!d.on, GAME_IDS);
          if (!r.ok) return { reject: r.reason };
          if (!r.same) { state.enabled = r.enabled; state.bag = state.bag.filter((id) => r.enabled.includes(id)); if (state.next && !r.enabled.includes(state.next)) state.next = null; savePrefs(); publish(); }
          return true;
        }
        case 'mode': {
          const p = normalisePrefs({ ...pref, enabled: state.enabled, mode: d.mode ?? state.mode, rounds: d.rounds ?? state.rounds, bots: d.bots !== undefined ? parseBots(d.bots) : state.bots, difficulty: d.difficulty ?? state.difficulty }, GAME_IDS);
          state.mode = p.mode; state.rounds = p.rounds; state.bots = p.bots; state.difficulty = p.difficulty; savePrefs(); publish();
          return true;
        }
        case 'next': {
          if (!GAME_IDS.includes(d.id) || !state.enabled.includes(d.id)) return { reject: 'unknown-game' };
          state.next = state.next === d.id ? null : d.id; publish();
          return true;
        }
        case 'attract': return doAttract(d.on);
        case 'skip': { if (!state.active) return { reject: 'closed' }; if (state.ceremony) { endCeremony(); return true; } const order = ['lobby', 'pick', 'howto', 'countdown', 'play', 'results']; enter(state.phase === 'pick' && state.seenHowto.includes(state.game) ? 'countdown' : order[(order.indexOf(state.phase) + 1) % order.length]); return true; }
        case 'debugPlay': {
          if (!state.active || !GAME_IDS.includes(d.id)) return { reject: 'unknown-game' };
          state.next = d.id; if (!state.enabled.includes(d.id)) state.enabled = [...state.enabled, d.id];
          enter('pick'); return true;
        }
        case 'debugSeed': { state.seed = Number(d.seed) >>> 0; publish(); return true; }
        case 'debugEnd': { if (state.phase !== 'play' || !state.g) return { reject: 'not-playing' }; emitRec({ k: 'end', t: r2(state.gt), why: 'debug' }); return true; }
        case 'debugWin': {
          const g = game();
          if (state.phase !== 'play' || !state.g || !g) return { reject: 'not-playing' };
          // everybody else is out / zero; this slot wins, then the game ends
          const win = Number(d.slot), recs = g.debugWin ? g.debugWin(state.g, win, state.gt) : [];
          for (const r of recs) emitRec(r);
          emitRec({ k: 'end', t: r2(state.gt), why: 'debug' });
          return true;
        }
        default: return { reject: 'unknown-kind' };
      }
    },
  });

  const api = {
    get state() { return state; },
    get flow() { return flow; },
    on(fn) { listeners.push(fn); return () => listeners.splice(listeners.indexOf(fn), 1); },
    enabled: () => state.enabled.slice(),
    games: () => GAMES.map((g) => ({ id: g.id, name: g.name, host: g.host, enabled: state.enabled.includes(g.id), next: state.next === g.id })),
    hostActor: (index = 0) => ({ screen: 'host', index, pos: { x: 0, y: 0, z: 0 } }),
    req: (kind, data, actor) => sync.request('party', kind, data, actor || null),
    open: (opts) => sync.request('party', 'open', opts || {}, null),
    close: () => sync.request('party', 'close', {}, null),
    toggle: (id, on) => sync.request('party', 'toggle', { id, on }, null),
    setMode: (o) => sync.request('party', 'mode', o || {}, null),
    playNext: (id) => sync.request('party', 'next', { id }, null),
    skip: () => sync.request('party', 'skip', {}, null),
    skipCeremony: () => sync.request('party', 'skipCeremony', {}, null),
    touch: () => sync.request('party', 'touch', {}, null),
    setAttract: (on) => sync.request('party', 'attract', { on: !!on }, null),
    get touches() { return touches; },
    setReady: (actor, on) => sync.request('party', 'ready', { on: !!on }, actor),
    act: (actor, t, extra) => sync.request('party', 'act', { ...(extra && typeof extra === 'object' ? extra : {}), t }, actor),
    /** The game clock (seconds; negative before Go!). The host runs it; a replica derives it from `startAt` and the synced wall clock. */
    gameTime() {
      if (sync.isHost) return state.gt;
      if (state.phase === 'play' || state.phase === 'countdown') return (sync.hostNow() - state.startAt) / 1000 + skew;
      return state.gt;
    },
    /** The HOST's beat. dt = simulation seconds. */
    update(dt) {
      if (!sync.isHost || !state.active) return;
      state.t += dt;
      if (state.phase === 'lobby' && state.ceremony && state.t >= PARTY.ceremony.length) { endCeremony(); return; }
      if (state.phase === 'lobby' || state.phase === 'results' || state.phase === 'pick') {
        if (refreshRoster()) publish();
      }
      const humans = state.roster.filter((r) => !r.bot);
      const g = game();
      if (state.phase === 'play' && g && state.g) {
        state.gt += dt;
        const ctx = { t: state.gt, pos: (slot) => positionOf(slot), slack: PARTY.slack, lag: g.lag };
        for (const rec of g.step(state.g, ctx, dt, state.gt)) emitRec(rec);
        if (state.g.done) doneFor += dt;
      } else if (state.phase === 'countdown') state.gt = Math.min(0, state.gt + dt);
      if ((state.phase === 'play' || state.phase === 'countdown') && sync.hasReplicas) { tickAcc += dt; if (tickAcc >= PARTY.tick) { tickAcc = 0; sync.emit('party', 'tick', { gt: r2(state.gt) }); } }
      const to = flowTick(flow, dt, {
        humans: humans.length, allReady: humans.length > 0 && humans.every((r) => r.ready), mode: state.mode, pickChosen: !!state.next,
        gameDone: !!(state.g && state.g.done), doneFor, tail: g && g.tail !== undefined ? g.tail : 1.4, gameCap: g ? g.duration + 4 : 90,
        lastRound: !!(state.results && state.results.partyOver), howtoSeen: state.seenHowto.includes(state.game), ceremony: !!state.ceremony,
      });
      if (to) enter(to, { ceremony: to === 'lobby' && state.phase === 'results' && !!(state.results && state.results.partyOver) });
    },
    summary() {
      return {
        active: state.active, serial: state.serial, phase: state.phase, t: r2(state.t), gt: r2(state.gt), mode: state.mode, rounds: state.rounds, round: state.round, difficulty: state.difficulty, bots: state.bots,
        enabled: state.enabled.slice(), bag: state.bag.slice(), seenHowto: state.seenHowto.slice(), game: state.game, last: state.last, next: state.next, seed: state.seed, roster: state.roster.map((r) => ({ ...r })), stars: { ...state.stars },
        results: state.results, ceremony: state.ceremony, attract: state.attract, touches, hash: sync.hash ? sync.hash() : null,
      };
    },
    debug: {
      win: (slot) => sync.request('party', 'debugWin', { slot }, null),
      end: () => sync.request('party', 'debugEnd', {}, null),
      seed: (n) => sync.request('party', 'debugSeed', { seed: n }, null),
      play: (id) => sync.request('party', 'debugPlay', { id }, null),
    },
  };
  return api;
}
