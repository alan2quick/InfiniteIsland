// Party Games (Step 80a): the screen-side runtime. A short-minigame party for up to 4 players (people on this screen, on other screens, and BOTS) in the Party Glade: a themed pocket far west of every island. An adult starts
// it (`__game.party.open()` or the URL `?party`) and the kids play game after game without help. The rules are PURE modules (game/party/*.js: flowLogic.js, the games' own logic, partyDomain.js = the host-authoritative
// session-only `party` sync domain); this file moves people in and out behind a curtain, runs the stage cameras, the HUD, the bots, the Game Board and presents the games' records.
//
//   const party = createParty({ scene, camera, followCam, players, avatars, table, sync, hud, hudRoot, dialog, particles, sfx, music, items, world, water, busy })
//   party.preInput(dt)           once per tick BEFORE players.pollInput: the host's bots think and press (their BotSources)
//   party.update(dt, t)          once per tick after players.update: the domain's clock (host), the curtain, entering / leaving, the phases' presentation, the HUD
//   party.drive(p, actions, dt)  per player of the party each tick (main.js): the game's press (a hop / a chop), the Ready hold, the kiosk exit
//   party.updateCamera(dt)       replaces followCam.update while party.pageMode (a fixed stage camera per place)         party.light(sky, renderer)   the party's own light after the clock
//   party.afterItems()           hides the held tools (they are tucked away for the party and come back)                  party.allowsTarget(it)   only the Game Board is a target here
//   party.active                 the shared flag (a party is running somewhere: other systems stay out)                  party.pageMode   THIS screen currently shows the Glade        party.contains(p)
//   (Step 80b) Marlo Says and Pinecone Huddle add two input styles here: marloInput (Cancel / B = red, Interact / A = green; the stick only walks) and holdInput (the shell is a HOLD: act({ on }) at the start / end).
//   (Step 80c) Sizzle Seed and Egg Scramble are stick-only: nothing in drive(); the holder of the seed runs `boost` x faster (speedScale, set on this screen's bodies), and the stage gets who(slot) / lanePlayers to draw the seed and the head stacks on the real bodies.
//   party.open(opts) / close() / toggle(id, on) / enabled() / games() / bots(n | 'fill', difficulty) / play(id) / next() / skip() / summary()   (also __game.party)
//   (Step 80e) The trophy ceremony: after the last round of a party the host's lobby state carries `ceremony: { places }`; every screen then runs ONE cut through game/cinematic.js (letterbox, hold Cancel on any screen skips it for everybody):
//   its seats' bodies on the lobby podium (1st / 2nd / 3rd, ties share), a gold Tdoong trophy rising, all nine Tdoongz cheering (world/party/ceremony.js), the trophy jingle and confetti; the host ends it and a fresh party starts.
//   Kiosk (`?party&kiosk`, party.kiosk): main.js skips the title card and locks Options (volume only), the Join button, the pair panel; the 3 s keyboard exit stays the only way out. Attract mode (kiosk, or `?attract`, party.config.attract): after
//   PARTY.attract.idle s without any human input the host asks for `attract` (only the bots play, the music at half volume, "Press any button"); any human input (a joined screen sends "touch") brings a fresh lobby back.
//
// What a party does to the rest of the game: the whole roster is moved to the Glade behind a confetti curtain (each screen moves ITS players and remembers where they stood); the islands and the sea are hidden;
// the follow camera, the tether, regroup, travel, the Bag, the quest tracker and every world interaction are off; held tools are tucked away; leaving (party.close(), or the kiosk exit: hold Cancel + Interact on
// the keyboard for 3 s) puts everybody back where they stood. Nothing is saved (only the Game Board's choices: `infiniteIsland.party`) and no island's placement or hash is touched.
//
// Own-body games (Vine Skip, Timber Trim): each screen moves its own players; the game's press is a host REQUEST stamped with the presser's game-clock estimate and re-judged with PARTY.slack
// (game/party/partyDomain.js). The host steps the rules and emits records; every screen applies them and presents them (world/party/<id>.js).
import * as THREE from 'three';
import { PARTY, PLAYER_COLORS } from '../config.js';
import { mulberry32 } from '../utils/rng.js';
import { addInteractable } from '../world/interactables.js';
import { addCollider } from '../world/colliders.js';
import { createPartyCurtain } from '../ui/partyCurtain.js';
import { createPartyUi } from '../ui/partyUi.js';
import { ICONS } from '../ui/icons.js';
import { createPartyDomain } from './party/partyDomain.js';
import { GAMES, getGame } from './party/registry.js';
import { botsWanted, countdownLabel, parseBots } from './party/flowLogic.js';
import { BOTS, botOrder, botByName, hostFor, cheerers } from './party/botRoster.js';
import { inParty, stageCentre, stageSpawns, spectatorSpot, lobbySpot, bumpersObstacles, setGlowcapSunk, bonkObstacles, setTiltyTilts } from './party/partyArea.js';
import * as SIZ from './party/sizzleLogic.js';
const sizzleObstacles = SIZ.worldObstacles;
import { createGlade, CAMERAS, LOOKS } from '../world/party/glade.js';
import { createCeremony, podiumSpots, cameraShot } from '../world/party/ceremony.js';
import { setHopSpeed } from '../player/player.js';
import { createVineSkipWorld } from '../world/party/vineskip.js';
import { createTimberWorld } from '../world/party/timber.js';
import { createMarloSaysWorld, flagGeo } from '../world/party/marlosays.js';
import { createHuddleWorld } from '../world/party/huddle.js';
import { createSizzleWorld } from '../world/party/sizzle.js';
import { createFeastroundWorld } from '../world/party/feastround.js';
import { createBumpersWorld } from '../world/party/bumpers.js';
import { ballPose, landed } from './party/bumpersLogic.js';
import { applyBumperRider } from './party/bumperRider.js';
import { createEggsWorld } from '../world/party/eggs.js';
import { createGlowcapWorld } from '../world/party/glowcap.js';
import { createCastWorld } from '../world/party/cast.js';
import { createTiltyWorld } from '../world/party/tilty.js';
import { createBonkWorld } from '../world/party/bonk.js';
import { flagFromInput } from './party/marlosaysLogic.js';
import { floatLabels } from '../world/party/kit.js';
import { buildItemModel } from '../items/models.js';
import { VERTEX_TOON } from '../render/geo.js';

const PREF_KEY = 'infiniteIsland.party';
const O = PARTY.origin;
const STAGE_FACTORIES = { vineskip: createVineSkipWorld, timber: createTimberWorld, marlosays: createMarloSaysWorld, huddle: createHuddleWorld, sizzle: createSizzleWorld, eggs: createEggsWorld, feastround: createFeastroundWorld, bumpers: createBumpersWorld, glowcap: createGlowcapWorld, cast: createCastWorld, tilty: createTiltyWorld, bonk: createBonkWorld };
const _v = new THREE.Vector3();
const AMBIENT_LAYERS = ['butterfly-wings', 'butterfly-bodies', 'drifting-petals', 'ocean-glints', 'fireflies'];

export function createParty({ scene, camera, followCam, players, avatars, table, sync, hud, hudRoot, dialog, particles, sfx, music, items, world, water, outfits = {}, cinematic = null, busy = () => null, params = new URLSearchParams() }) {
  const ui = createPartyUi(hudRoot);
  const curtain = createPartyCurtain(hudRoot, { sfx });
  const labels = floatLabels(hudRoot);
  let glade = null;
  const ambientVisibility = new Map();
  const livingStages = new Set(['vineskip', 'timber', 'marlosays', 'huddle']);       // (82c's stages keep their judged pieces cached like before; only their living scenery is built on show and freed on hide)
  const stages = {};                                        // game id -> its world module (built on first use)
  const getGlade = () => (glade ||= createGlade({ scene }));
  const getStage = (id) => (stages[id] ||= STAGE_FACTORIES[id] ? STAGE_FACTORIES[id]({ scene, sfx, particles, labels }) : null);

  // ---- preferences (the Game Board's choices; per host screen; ?newgame does not clear them, like the comfort settings)
  const prefs = {
    read() { try { return localStorage.getItem(PREF_KEY); } catch (_) { return null; } },
    write(obj) { try { localStorage.setItem(PREF_KEY, JSON.stringify(obj)); } catch (_) { /* storage unavailable */ } },
  };

  // ---- where a slot's player stands (the host judges contact with it)
  function posOf(slot) {
    const p = players.get(slot);
    if (p) return { x: p.position.x, z: p.position.z, face: p.facing };
    const e = table.get(slot);
    const a = e && sync.actors && sync.actors.get(`${e.screen}:${slot}`);
    if (a && a.pos) return a.pos;
    const av = avatars.get(slot);
    return av ? av.position : null;
  }

  const domain = createPartyDomain({ sync, table, prefs, rng: Math.random, positionOf: posOf, busy, now: () => sync.hostNow() });
  const state = () => domain.state;

  // ---- screen state
  let partyMode = false;                                    // this screen shows the Glade (the islands and the sea are hidden)
  let place = 'lobby';                                      // 'lobby' | a game id: where this screen's camera / players are now
  let pt = 0;                                               // the party's own clock (s), counts while a party is open
  let phaseLocalT = 0;                                      // seconds since this screen saw the current phase begin
  let lastLabel = '', appliedKey = '', roulettePos = -1;
  const memory = new Map();                                 // Player -> { x, z }: where it stood before the party
  const tucked = new Map();                                 // Player -> its held item record (hidden meanwhile)
  const axes = new Map();                                   // Player -> its cosmetic party axe (Timber Trim)
  const flameAt = new Map();                                // Player / avatar -> party clock of its last mouth flame (spicy pepper)
  const rods = new Map();                                   // Player -> its cosmetic Glowline Rod (Driftwood Cast)
  const flags = new Map();                                  // Player -> { red, green, until }: the cosmetic signal flag a press raises (Marlo Says)
  const inputMem = new Map();                               // Player -> the stick's last side (Marlo Says) ; holdMem: Player -> the shell hold (Pinecone Huddle)
  const holdMem = new Map();
  const timers = [];
  const landedBodies = new Map(), partyProbes = new Map();
  const readyHold = new Map(), readyRings = new Map();
  const botMind = new Map();                                // slot -> { mem, rng }
  let lastFullToast = -99;
  let botTimer = 0, yieldUntil = -1, seatWaitUntil = -1, lastHumans = 0, exitHold = 0, resultsHopT = 0, lastTempo = 1;
  // Step 80e: kiosk + attract mode, the trophy ceremony
  const kiosk = params.has('party') && params.has('kiosk');
  const config = { kiosk, attract: kiosk || params.has('attract') };
  let idleT = 0, touchT = 0, seenTouches = 0, attractSeen = false;
  let ceremony = null, cerOn = false, cerCin = false, cerT = 0, cerSkipSent = false, cerSpots = [], cerOrder = [], cerHopT = 0, cerFrom = null, cerLabels = 0, cerBurst = 0, cerRose = false, cerBannerOut = false;
  const cerProbes = new Map();
  const focus = new THREE.Vector3();

  const later = (secs, fn) => timers.push({ at: pt + secs, fn });
  const localPlayers = () => players.list.filter((p) => !p.away && !p.leaving);
  const inPocket = (p) => inParty(p.position.x, p.position.z);
  const rosterIndex = (slot) => state().roster.findIndex((r) => r.slot === slot);
  const colorOf = (slot) => { const r = state().roster.find((x) => x.slot === slot); return r && r.bot ? (botByName(r.name)?.colors.ui || '#fff') : (PLAYER_COLORS[slot] ? PLAYER_COLORS[slot].ui : '#fff'); };
  const nameOf = (slot) => { const r = state().roster.find((x) => x.slot === slot); return r ? r.name : `P${slot + 1}`; };

  // ---- the lobby's fixtures: the Game Board (an interactable), colliders, registered ONCE (they live in the pocket, nothing else is ever near them)
  const boardPos = new THREE.Vector3(O.x + PARTY.lobby.board.x, O.y + 1.2, O.z + PARTY.lobby.board.z + 0.4);
  addCollider({ x: O.x + PARTY.lobby.board.x - 1.5, z: O.z + PARTY.lobby.board.z, r: 0.35, owner: 'party' });
  addCollider({ x: O.x + PARTY.lobby.board.x + 1.5, z: O.z + PARTY.lobby.board.z, r: 0.35, owner: 'party' });
  for (const dx of [-2, 0, 2]) addCollider({ x: O.x + PARTY.lobby.podium.x + dx, z: O.z + PARTY.lobby.podium.z, r: 1.0, owner: 'party' });
  for (const dx of [-3.4, 0, 3.4]) addCollider({ x: O.x + PARTY.lobby.stage.x + dx, z: O.z + PARTY.lobby.stage.z + 0.4, r: 0.7, owner: 'party' });
  const vc = stageCentre('vineskip');
  addCollider({ x: vc.x, z: vc.z, r: PARTY.vineskip.rMin - 0.4, owner: 'party' });
  const bc = stageCentre('bumpers');
  for (const o of bumpersObstacles()) addCollider({ x: bc.x + o.x, z: bc.z + o.z, r: o.r, owner: 'party-bumpers' });
  for (const o of sizzleObstacles()) addCollider({ x: o.x, z: o.z, r: o.r, owner: 'party' });                  // (Step 80c: the fire pit and the log benches of Sizzle Seed)
  const kc = stageCentre('bonk');
  for (const o of bonkObstacles()) addCollider({ x: kc.x + o.x, z: kc.z + o.z, r: o.r, owner: 'party-bonk' });         // (Step 81b: Bonk Burrows' molehills)
  addInteractable({ type: 'partyboard', object: null, position: boardPos, radius: 1.9, prompt: 'Game Board', onInteract: (_it, p) => openBoard(p) });
  // the dress-up corner: each stand cycles the player through what the island has unlocked (the same hat rack / tail stump / garland stand rules, saving and pose ids)
  const DRESS = {
    hats: { prompt: 'Try a hat', icon: 'hat', locked: 'Hats come from campfire feasts!', count: (s) => s.unlocked, r: 0.45 },
    tails: { prompt: 'Try a tail', icon: 'fox', locked: 'Tails come from the Frostpine critter camp!', count: (s) => s.unlocked.length, r: 0.85 },
    garlands: { prompt: 'Try a garland', icon: 'sprout', locked: 'Garlands come from the Emberleaf garden!', count: (s) => s.unlocked.length, r: 0.6 },
  };
  const dressNote = new Map();                                // `${kind}:${slot}` -> time of the last "locked" toast (so mashing does not stack them)
  function dressUp(kind, p) {
    const sys = outfits[kind], D = DRESS[kind];
    if (!sys || !p) return;
    if (!(D.count(sys) > 0)) {
      const key = `${kind}:${p.index}`;
      if (pt - (dressNote.get(key) ?? -10) > 2.5) { dressNote.set(key, pt); hud.toast(D.locked, { icon: D.icon, duration: 2400 }); sfx.play('bip'); }
      return;
    }
    sys.cycle(p);
  }
  for (const kind of Object.keys(DRESS)) {
    const at = PARTY.lobby.dress[kind];
    addCollider({ x: O.x + at.x, z: O.z + at.z, r: DRESS[kind].r, owner: 'party' });
    addInteractable({ type: 'partydress', kind, object: null, position: new THREE.Vector3(O.x + at.x, O.y + 1.2, O.z + at.z), radius: 1.3, prompt: DRESS[kind].prompt, onInteract: (_it, p) => dressUp(kind, p) });
  }

  // ================================================================== moving people
  function poof(p) { particles.burst('puff', { x: p.position.x, y: p.position.y + 0.5, z: p.position.z }, { count: 8, radius: 0.5, height: 0.3 }); }
  function moveTo(p, spot, fx = true) {
    if (!spot) return;
    if (fx) poof(p);
    p.teleport(spot.x, spot.z);
    p.facing = spot.face || 0; p.root.rotation.y = p.facing; p._faceTo = null;
    p.velocity.x = p.velocity.z = 0;
    if (fx) particles.burst('sparkle', { x: p.position.x, y: p.position.y + 0.6, z: p.position.z }, { count: 8, radius: 0.5, color: p.colors.ui });
  }
  function spotFor(p, where) {
    const roster = state().roster, idx = roster.findIndex((r) => r.slot === p.index);
    if (where === 'lobby') return lobbySpot(idx >= 0 ? idx : p.index);
    if (idx >= 0) return stageSpawns(where, Math.max(1, roster.length))[idx] || spectatorSpot(where, idx);
    return spectatorSpot(where, p.index);
  }
  function movePlayers(where, fx = true) {
    place = where;
    for (const p of localPlayers()) moveTo(p, spotFor(p, where), fx);
    players._updateFocus();
    followCam.snap();
  }
  const placeFor = (s) => (['howto', 'countdown', 'play', 'results'].includes(s.phase) && s.game ? s.game : 'lobby');

  function tuck(on) {
    if (on) { for (const p of localPlayers()) { const rec = items.heldBy(p); if (rec) tucked.set(p, rec); } avatars.hideHeld = true; }
    else { for (const [p, rec] of tucked) { if (rec.pivot) rec.pivot.visible = true; p.holding = !!items.heldBy(p); } tucked.clear(); avatars.hideHeld = false; }
  }
  function afterItems() {
    if (!partyMode) return;
    for (const [p, rec] of tucked) { if (items.heldBy(p) === rec && rec.pivot) rec.pivot.visible = false; else tucked.delete(p); p.holding = false; }
  }

  function setMode(on) {
    partyMode = on;
    if (!on) setHopSpeed(null);                             // (Vine Skip's tall hop never leaks onto the islands)
    world.root.visible = !on;                               // the islands, their props and the far versions
    water.group.visible = !on;                              // and the sea
    for (const name of AMBIENT_LAYERS) {
      const o = scene.getObjectByName(name); if (!o) continue;
      if (on) { if (!ambientVisibility.has(o)) ambientVisibility.set(o, o.visible); o.visible = false; }
      else if (ambientVisibility.has(o)) o.visible = ambientVisibility.get(o);
    }
    if (!on) ambientVisibility.clear();     // (the island's butterflies, petals and sea glints: draw calls the Glade does not need)
    hudRoot.classList.toggle('party-active', on);
    ui.setActive(on);
    if (on) { getGlade().setVisible(true); followCam.regionBlend = 0; }
    else {
      clearBumperBodies(); setGlowcapSunk([]); setTiltyTilts(null);
      stopCeremony(); ceremony?.dispose(); ceremony = null;
      glade?.dispose(); glade = null;
      for (const id in stages) {
        stages[id]?.setVisible(false);
        if (livingStages.has(id)) { stages[id]?.dispose(); delete stages[id]; }
      }
      for (const p of [...axes.keys()]) dropAxe(p);
      for (const p of [...rods.keys()]) dropRod(p);
      for (const p of [...flags.keys()]) dropFlags(p);
      for (const p of [...localPlayers(), ...avatars.list]) p.downed = false;
      for (const p of localPlayers()) p.speedScale = 1;
      music.party?.(null);
      labels.clear();
      followCam.resize(window.innerWidth, window.innerHeight);
    }
    followCam.snap();
  }

  function reconcile() {
    if (curtain.running) return;
    const want = state().active;
    const wrong = localPlayers().some((p) => inPocket(p) !== want);
    if (!wrong && partyMode === want) return;
    curtain.start(() => transition(), () => reconcile());
  }
  function transition() {
    const want = state().active, s = state();
    if (want) {
      dialog.close();
      for (const p of localPlayers()) if (!inPocket(p) && !p.bot) memory.set(p, { x: p.position.x, z: p.position.z });
      if (!partyMode) { tuck(true); setMode(true); }
      for (const p of localPlayers()) {
        if (!inPocket(p)) { p.setPose?.(null); p._swingT = -1; poof(p); }
      }
      appliedKey = '';
      applyPhase(s, true);
      appliedKey = phaseKey(s);
    } else {
      for (const p of localPlayers()) {
        if (!inPocket(p)) continue;
        const m = memory.get(p) || memory.get(players.p1) || { x: 0, z: 14 };
        poof(p);
        p.teleport(m.x, m.z);
        particles.burst('sparkle', { x: p.position.x, y: p.position.y + 0.6, z: p.position.z }, { count: 8, radius: 0.5, color: p.colors.ui });
        dropAxe(p); dropRod(p);
      }
      memory.clear();
      tuck(false);
      setMode(false);
    }
    players._updateFocus();
    followCam.snap();
    followCam.update(0, players.focus);
    world.snap?.();
  }

  // ================================================================== phases
  const phaseKey = (s) => `${s.serial}|${s.phase}|${s.game}|${s.round}`;
  /** A new phase (or game): show the right stage, move this screen's players there, start the phase's sounds and cards. */
  function applyPhase(s, entering = false) {
    phaseLocalT = 0;
    if (!['play', 'results'].includes(s.phase)) clearBumperBodies();
    const where = placeFor(s);
    setHopSpeed((s.game === 'vineskip' || s.game === 'bonk') && s.phase !== 'lobby' && s.phase !== 'pick' ? (s.game === 'bonk' ? PARTY.bonk.hopSpeed : PARTY.vineskip.hopSpeed) : null);      // every screen: its own players AND the avatars jump the same height
    const g = s.game ? getGame(s.game) : null;
    for (const id in stages) {
      stages[id]?.setVisible(id === where);
      if (id !== where && livingStages.has(id)) { stages[id]?.dispose(); delete stages[id]; }
    }
    if (where !== 'lobby') getStage(where)?.setVisible(true);
    if (where !== place || entering || s.phase === 'lobby' || s.phase === 'countdown') movePlayers(where, !entering);
    if (s.phase !== 'play' && s.phase !== 'results') { for (const p of [...localPlayers(), ...avatars.list]) if (p.downed) p.downed = false; }
    if (s.game !== 'sizzle' || s.phase !== 'play') for (const p of localPlayers()) if (p.speedScale !== 1 && !p.chilled) p.speedScale = 1;       // (the seed's boost never outlives the game)      // (Pinecone Huddle's dazed players get up)
    holdMem.clear(); inputMem.clear();
    if (s.game !== 'timber') for (const p of [...axes.keys()]) dropAxe(p);
    if (s.game !== 'cast') for (const p of [...rods.keys()]) dropRod(p);
    if (s.game !== 'marlosays') for (const p of [...flags.keys()]) dropFlags(p);
    if (s.phase === 'lobby') {
      getGlade().setCheerers(cheerers(s.round));
      getGlade().cheer(true);
      ui.hideCard(); ui.hideBanner(); lastLabel = '';
      for (const id in stages) stages[id]?.clearPractice?.();
      for (const p of [...axes.keys()]) dropAxe(p);
      for (const p of [...rods.keys()]) dropRod(p);
      for (const p of [...flags.keys()]) dropFlags(p);
      music.party?.(null);
    } else if (s.phase === 'pick') {
      ui.hideBanner();
      sfx.play('pop', { pitch: 1.3 });
    } else if (s.phase === 'howto') {
      sfx.play('pop', { pitch: 1.1 });
      if (g && s.game === 'timber') for (const p of localPlayers()) giveAxe(p);
      if (g && s.game === 'cast') for (const p of localPlayers()) giveRod(p);
    } else if (s.phase === 'countdown') {
      if (s.game === 'timber') for (const p of localPlayers()) giveAxe(p);
      if (s.game === 'cast') for (const p of localPlayers()) giveRod(p);                // (a repeat play skips the how-to: the rod is put in hand here)
      ui.hideCard(); lastLabel = '';
      getStage(s.game)?.clearPractice?.();
    } else if (s.phase === 'play') {
      lastLabel = ''; lastTempo = 1;
      ui.banner('Go!', { ms: 900, tone: 'go' });
      sfx.play('go');
      music.party?.(s.game);
    } else if (s.phase === 'results') {
      music.party?.(null);
      ui.banner('Finish!', { ms: 1500, tone: 'fin' });
      sfx.play('whistle');
      resultsHopT = 0;
      later(1.1, () => { if (state().phase === 'results') { sfx.play(state().results?.partyOver ? 'trophy' : 'fanfare'); if (state().results?.winners.length) sfx.play('roundWon', { vol: 0.8 }); celebrate(); } });
    }
  }

  function celebrate() {
    const s = state(), c = s.game && s.game !== 'lobby' ? stageCentre(s.game) : stageCentre('lobby');
    particles.burst('confetti', { x: c.x, y: O.y + 4.5, z: c.z }, { count: 60, radius: 4.5, height: 1 });
    particles.burst('confetti', { x: c.x - 4, y: O.y + 3.5, z: c.z + 2 }, { count: 30, radius: 2.5 });
    particles.burst('confetti', { x: c.x + 4, y: O.y + 3.5, z: c.z + 2 }, { count: 30, radius: 2.5 });
    getGlade().cheer(true);
  }

  domain.on((kind, d) => { if (kind === 'rec') onRec(d.r); });          // (phases are applied by update(): it polls the shared state, so a late joiner and a reconnect land in the right place too)

  // ---- presentation of the games' records
  function onRec(rec) {
    const s = state(), id = s.game;
    if (!partyMode || !id || !s.g) return;
    const g = getGame(id), v = g.view(s.g, domain.gameTime()), st = getStage(id);
    st?.onRec?.(rec, v, who);
    if (id === 'vineskip' && rec.k === 'out') tumble(rec.slot);
    else if (id === 'marlosays' && rec.k === 'out') splashDown(rec.slot);
    else if (id === 'huddle' && rec.k === 'out') daze(rec.slot);
    else if (id === 'sizzle' && rec.k === 'pop') sootUp(rec.slot);
    else if (id === 'glowcap' && rec.k === 'sink') for (const slot of rec.out) capSplash(slot);
    else if (id === 'bonk' && rec.k === 'bonk') for (const slot of rec.out) squash(slot);
    else if (id === 'feastround' && ['grab', 'chew', 'reach', 'fan'].includes(rec.k)) who(rec.slot)?.swing?.();
  }
  /** The player (a local body or a remote avatar) of a slot, or null. */
  const who = (slot) => players.get(slot) || avatars.get(slot) || null;
  // Sizzle Seed: the popped player is thrown back a step, sooty; in a longer game they climb out and cheer from the back of the camp (the owning screen moves its own body)
  function sootUp(slot) {
    const p = who(slot);
    if (!p) return;
    p.hurt?.({ x: 0, z: 1 }, 0.4);
    if (players.get(slot)) {
      later(1.3, () => {
        const s = state();
        if (s.phase !== 'play' || !s.g || s.g.done) return;
        const rs = spectatorSpot('sizzle', slot);
        particles.burst('puff', { x: p.position.x, y: p.position.y + 0.5, z: p.position.z }, { count: 8, radius: 0.7, color: '#3a3440' });
        p.teleport(rs.x, rs.z); p.facing = rs.face; p.root.rotation.y = rs.face;
      });
    }
  }
  function tumble(slot) {
    const p = players.get(slot) || avatars.get(slot);
    if (!p) return;
    const at = { x: p.position.x, y: p.position.y + 0.9, z: p.position.z };
    sfx.play('boing'); later(0.25, () => sfx.play('splash', { vol: 0.8 }));
    particles.burst('puff', { x: at.x, y: p.position.y + 0.3, z: at.z }, { count: 10, radius: 0.7, color: '#ffb066' });
    labels.label('Oops!', at, '#ffd0d0');
    if (players.get(slot)) {                                // this screen's own player (a person or a bot on the host): over the edge into the warm moat, then up on the rim to cheer
      p.hurt?.({ x: 0, z: 1 }, 0.5);
      later(0.6, () => {
        if (state().phase !== 'play' && state().phase !== 'results') return;
        const rs = spectatorSpot('vineskip', slot);                      // (one rim spot per seat, so two screens never pick the same one)
        particles.burst('puff', { x: p.position.x, y: p.position.y + 0.3, z: p.position.z }, { count: 8, radius: 0.8, color: '#ffb066' });
        p.teleport(rs.x, rs.z); p.facing = rs.face; p.root.rotation.y = rs.face;
        sfx.play('splash', { vol: 0.6 });
        particles.burst('puff', { x: p.position.x, y: p.position.y + 0.3, z: p.position.z }, { count: 8, radius: 0.8, color: '#ffb066' });
      });
    }
  }

  // Glowcap Shuffle: a body that was not on the called cap splashes into the lagoon and climbs out on the mossy shore (the owning screen moves its own body)
  function capSplash(slot) {
    const p = players.get(slot) || avatars.get(slot);
    if (!p) return;
    p.hurt?.({ x: 0, z: 1 }, 0.4);
    if (players.get(slot)) {
      later(0.25, () => {                                        // (before the cap is fully under: it stops being ground then)
        if (state().phase !== 'play' && state().phase !== 'results') return;
        const rs = spectatorSpot('glowcap', slot);
        particles.burst('puff', { x: p.position.x, y: p.position.y + 0.3, z: p.position.z }, { count: 10, radius: 0.9, height: 0.6, color: '#bfe6ff' });
        p.teleport(rs.x, rs.z); p.facing = rs.face; p.root.rotation.y = rs.face; p._faceTo = null;
        p.velocity.x = p.velocity.z = 0;
        particles.burst('puff', { x: p.position.x, y: p.position.y + 0.3, z: p.position.z }, { count: 8, radius: 0.8, color: '#bfe6ff' });
      });
    }
  }
  // Bonk Burrows: a squashed player is flat as a pancake for a moment (every screen), then pops up on a spectator islet (the owning screen moves its own body)
  function squash(slot) {
    const p = who(slot);
    if (!p) return;
    p.hurt?.({ x: 0, z: 1 }, 0.3);
    p.downed = true;
    particles.burst('puff', { x: p.position.x, y: p.position.y + 0.2, z: p.position.z }, { count: 8, radius: 0.9, height: 0.3, size: 1.1, color: '#e0cda0' });
    later(1.25, () => {
      const s = state();
      if (s.game !== 'bonk' || (s.phase !== 'play' && s.phase !== 'results')) return;
      p.downed = false;
      if (players.get(slot)) {
        const rs = spectatorSpot('bonk', slot);
        particles.burst('puff', { x: p.position.x, y: p.position.y + 0.3, z: p.position.z }, { count: 8, radius: 0.8, height: 0.5, color: '#fff3a0' });
        p.teleport(rs.x, rs.z); p.facing = rs.face; p.root.rotation.y = rs.face; p._faceTo = null;
        p.velocity.x = p.velocity.z = 0;
        particles.burst('sparkle', { x: p.position.x, y: p.position.y + 1.2, z: p.position.z }, { count: 6, radius: 0.5, color: '#ffe27a' });
      }
    });
  }
  // Marlo Says: a splashed player drops into the tide pool, then climbs out onto the beach to cheer (the owning screen moves its own body)
  function splashDown(slot) {
    const p = players.get(slot) || avatars.get(slot);
    if (!p) return;
    p.hurt?.({ x: 0, z: -1 }, 0.5);
    if (players.get(slot)) {
      later(0.7, () => {
        if (state().phase !== 'play' && state().phase !== 'results') return;
        const rs = spectatorSpot('marlosays', slot);
        particles.burst('puff', { x: p.position.x, y: p.position.y + 0.3, z: p.position.z }, { count: 8, radius: 0.8, color: '#bfe6ff' });
        p.teleport(rs.x, rs.z); p.facing = rs.face; p.root.rotation.y = rs.face;
        sfx.play('splash', { vol: 0.5 });
      });
    }
  }
  // Pinecone Huddle: a hit while open: dazed and flat on the stump under a heap of snow (the stage draws the heap) until the next phase
  function daze(slot) {
    const p = players.get(slot) || avatars.get(slot);
    if (!p) return;
    p.hurt?.({ x: 0, z: 1 }, 0.4);
    p.downed = true;
  }

  // ---- the signal flag a Marlo Says press raises in the right hand (red or green), cosmetic and per screen
  function waveFlag(p, flag) {
    if (!p.parts.handSocket) return;
    let f = flags.get(p);
    if (!f) {
      f = { until: 0 };
      for (const color of ['red', 'green']) {
        const m = new THREE.Mesh(flagGeo(color), VERTEX_TOON);
        m.castShadow = false; m.visible = false; m.scale.setScalar(1.0); m.position.set(0, -0.05, 0); m.rotation.x = Math.PI;       // (the pole points up out of the fist)
        p.parts.handSocket.add(m);
        f[color] = m;
      }
      flags.set(p, f);
    }
    f.red.visible = flag === 'red'; f.green.visible = flag === 'green';
    f.until = pt + 0.7;
    p.swing();
  }
  function dropFlags(p) {
    const f = flags.get(p);
    if (!f) return;
    for (const c of ['red', 'green']) { f[c].removeFromParent(); f[c].geometry.dispose(); }
    flags.delete(p);
  }

  // ---- a cosmetic axe in every hand for Timber Trim (the held tool is tucked away for the party)
  function giveAxe(p) {
    if (axes.has(p) || !p.parts.handSocket) return;
    const m = buildItemModel('axe'), pivot = new THREE.Group();
    pivot.add(m);
    pivot.rotation.set(0.35, 0, 0.25);
    m.traverse((o) => { if (o.isMesh) o.castShadow = false; });     // (draw-call budget: the axe casts no shadow)
    p.parts.handSocket.add(pivot);
    axes.set(p, pivot);
  }
  function dropAxe(p) {
    const pivot = axes.get(p);
    if (!pivot) return;
    pivot.removeFromParent();
    axes.delete(p);
  }

  // ---- the Glowline Rod in every hand for Driftwood Cast (cosmetic; the held tool is tucked away for the party). The stage reads its tip by the name 'party-rod' for the fishing line.
  function giveRod(p) {
    if (rods.has(p) || !p.parts.handSocket) return;
    const m = buildItemModel('rod'), pivot = new THREE.Group();
    pivot.name = 'party-rod';
    pivot.add(m);
    pivot.rotation.set(-1.0, 0, -0.1);                                  // (held out over the water, away from the camera)
    pivot.scale.setScalar(1.15);
    m.traverse((o) => { if (o.isMesh) o.castShadow = false; });
    p.parts.handSocket.add(pivot);
    rods.set(p, pivot);
  }
  function dropRod(p) {
    const pivot = rods.get(p);
    if (!pivot) return;
    pivot.removeFromParent();
    rods.delete(p);
  }

  // ================================================================== kiosk: the attract mode (Step 80e)
  /** Host: counts the seconds nobody human touched anything; after PARTY.attract.idle (kiosk / ?attract, in a lobby) the bots play on their own; any human input (or a joined screen's "touch") brings a fresh lobby back. A joined screen tells the host it is being played. */
  function updateAttract(dt, s) {
    const poked = domain.touches !== seenTouches;
    seenTouches = domain.touches;
    if (!s.active) { idleT = 0; return; }
    if (!sync.isHost) {
      touchT -= dt;
      if (players.activity && touchT <= 0) { touchT = PARTY.attract.touch; domain.touch(); }
      return;
    }
    if (players.activity || poked) {
      idleT = 0;
      if (s.attract) domain.setAttract(false);
      return;
    }
    idleT += dt;
    if (config.attract && !s.attract && s.phase === 'lobby' && !s.ceremony && !curtain.running && idleT >= PARTY.attract.idle) domain.setAttract(true);
  }

  // ================================================================== the trophy ceremony (Step 80e)
  const ORD = ['', '1st', '2nd', '3rd'], ordinal = (n) => ORD[n] || n + 'th';
  const _look = new THREE.Vector3();
  /** The cut begins on every screen at once (the host's lobby state carries the places): letterbox, the camera, the podium, the trophy, the crowd of nine. */
  function startCeremony(s) {
    if (cerOn || !s.ceremony) return;
    cerOn = true; cerT = 0; cerSkipSent = false; cerHopT = 0; cerLabels = 0; cerBurst = 0; cerRose = false; cerBannerOut = false;
    const g = getGlade();
    ceremony ||= createCeremony({ parent: g.root });
    ceremony.show();
    g.setCheerers([]);                                       // the usual trio steps aside: all nine cheer on the stage now
    g.cheer(true);
    ui.hideCard(); ui.hideBanner(); ui.pill(null);
    cerFrom = { pos: [camera.position.x - O.x, camera.position.y - O.y, camera.position.z - O.z], look: [followCam.focus.x - O.x, followCam.focus.y - O.y, followCam.focus.z - O.z] };
    cerCin = !!(cinematic && cinematic.begin('party', { duck: 0.4, avatarsCinematic: false }));
    cerSpots = podiumSpots(s.ceremony.places);
    cerOrder = cerSpots.slice().sort((a, b) => b.place - a.place || a.slot - b.slot);        // the reveal goes from last place up to the winner
    for (const sp of cerSpots) {
      const p = players.get(sp.slot);
      if (!p) continue;
      poof(p); p.teleport(sp.x, sp.z); p.facing = 0; p.root.rotation.y = 0; p._faceTo = null; p.velocity.x = p.velocity.z = 0;
    }
    sfx.play('trophy');
    if (cerCin) {
      const winners = s.ceremony.places.filter((p) => p.place === 1).map((p) => nameOf(p.slot));
      cinematic.showBanner([{ text: 'Party over!', cls: 'fb-title' }, { text: winners.length ? winners.join(' & ') + (winners.length > 1 ? ' share the trophy' : ' wins the trophy') + '!' : 'What a party!', cls: 'fb-name' }]);
    }
    celebrate();
  }
  function updateCeremony(dt, s) {
    cerT += dt;
    if (cerCin) cinematic.freezeAll(); else for (const p of localPlayers()) p.frozen = true;
    ceremony.update(dt, cerT);
    const C = PARTY.ceremony, L = PARTY.lobby;
    if (cerCin && !cerBannerOut && cerT >= 3.6) { cerBannerOut = true; cinematic.dismissBanner(); }
    if (!cerRose && cerT >= C.rise) {
      cerRose = true;
      particles.burst('sparkle', { x: O.x, y: O.y + 3.2, z: O.z + L.stage.z + 3.7 }, { count: 24, radius: 1.6, height: 1.6, color: '#ffe27a' });
      sfx.play('roundWon', { vol: 0.8 });
    }
    if (cerT >= cerBurst) {                                   // confetti keeps coming over the stage, the podium and the crowd
      const k = Math.round(cerBurst / C.confetti); cerBurst += C.confetti;
      const x = [-5, 5, 0, L.podium.x, -L.podium.x][k % 5];
      particles.burst('confetti', { x: O.x + x, y: O.y + 6.5, z: O.z + L.stage.z + 1 + (k % 2) * 3.5 }, { count: 40, radius: 3.5, height: 1 });
    }
    while (cerLabels < cerOrder.length && cerT >= 3.6 + cerLabels * 1.3) {            // the places appear one by one, last place first
      const sp = cerOrder[cerLabels++];
      sfx.play(sp.place === 1 ? 'fanfare' : 'chime', { pitch: sp.place === 1 ? 1 : 1.1 });
      particles.burst('sparkle', { x: sp.x, y: sp.y + 1.8, z: sp.z }, { count: 10, radius: 0.7, color: '#ffe27a' });
    }
    cerHopT += dt;
    if (cerHopT >= 0.8) { cerHopT = 0; for (const sp of cerSpots) players.get(sp.slot)?.hop(); }
    ui.podium(cerOrder.slice(0, cerLabels).map((sp) => ({ place: sp.place, ord: ordinal(sp.place), name: nameOf(sp.slot), color: colorOf(sp.slot), bot: !!s.roster.find((r) => r.slot === sp.slot && r.bot), stars: (s.ceremony.places.find((p) => p.slot === sp.slot) || {}).stars | 0 })).sort((a, b) => a.place - b.place));
    if (cerCin && !cerSkipSent && cinematic.pollSkip(dt, cerT, { arm: C.skipArm })) { cerSkipSent = true; domain.skipCeremony(); }       // (hold Cancel on ANY screen: the host ends the cut for everybody)
  }
  function stopCeremony() {
    if (!cerOn) return;
    cerOn = false;
    ceremony?.hide();
    ui.podium(null);
    for (const [p, probe] of cerProbes) p.groundProbe = probe;
    cerProbes.clear();
    if (cerCin) { cinematic.end({ unduck: 1.4 }); cinematic.releaseAll(); cerCin = false; }
    else for (const p of localPlayers()) p.frozen = false;
    if (state().attract) music.duck?.(PARTY.attract.duck, 0.8);
    appliedKey = '';                                          // (the fresh lobby is applied again: everybody back on the lobby spots, the usual trio on the stage)
  }
  /** Seats' bodies stay exactly on their podium steps (all screens: local bodies and remote avatars alike). */
  function podiumHold() {
    for (const sp of cerSpots) {
      const p = who(sp.slot);
      if (!p) continue;
      p.position.set(sp.x, sp.y, sp.z);
      if (p.velocity) p.velocity.x = p.velocity.z = 0;
      p.root.rotation.y = 0;
      if (!cerProbes.has(p)) cerProbes.set(p, p.groundProbe);
      p.groundProbe = () => sp.y;
      if (p.parts?.blob) p.parts.blob.position.y = 0.06 + sp.y - p.position.y;
    }
  }
  function ceremonyCamera() {
    const sh = cameraShot(cerT, cerFrom), asp = camera.aspect > 0 ? camera.aspect : 16 / 9, pull = 1 + Math.max(0, 16 / 9 / asp - 1) * 0.7;      // (a narrow screen pulls back to keep the podium and the trophy in)
    _look.set(O.x + sh.look[0], O.y + sh.look[1], O.z + sh.look[2]);
    camera.position.set(_look.x + (sh.pos[0] - sh.look[0]) * pull, _look.y + (sh.pos[1] - sh.look[1]) * pull, _look.z + (sh.pos[2] - sh.look[2]) * pull);
    if (cinematic) cinematic.look(_look); else camera.lookAt(_look);
  }

  // ================================================================== bots (host)
  function takenNames() { return table.snapshot().filter((e) => e && e.bot).map((e) => e.name); }
  function syncBots(dt) {
    if (!sync.isHost || !partyMode || curtain.running) return;
    const s = state();
    if (s.phase !== 'lobby' && s.phase !== 'pick') return;
    botTimer -= dt;
    if (botTimer > 0) return;
    const humans = table.snapshot().filter((e) => e && !e.bot).length;
    const have = players.bots.filter((p) => !p.leaving);
    let want = botsWanted(humans, s.bots);
    if (humans > lastHumans) { seatWaitUntil = -1; yieldUntil = -1; }                          // (the waiting person got in: no second bot gives its seat up)
    lastHumans = humans;
    if ((pt < yieldUntil || pt < seatWaitUntil) && humans + have.length >= 4) want = Math.max(0, want - 1);          // a human is waiting for a seat: a bot gives its up (and the person is queued: they claim it by themselves)
    if (have.length < want && table.count < 4) {
      const b = botOrder(takenNames())[0];
      const p = players.spawnBot({ name: b.name, colors: { ...b.colors, name: b.name }, ears: b.ears });
      if (p) { p.partyBot = b; moveTo(p, lobbySpot(table.count), false); botMind.set(p.index, { mem: { wander: null, wanderAt: 0, readyAt: -1 }, rng: mulberry32(0x5bd1e995 ^ (p.index * 7919) ^ (pt * 1000 | 0)) }); }
      botTimer = 0.4;
    } else if (have.length > want) {
      const p = have.sort((a, b) => b.index - a.index)[0];
      players.removeBot(p); botMind.delete(p.index);
      botTimer = 0.3;
    } else botTimer = 0.5;
  }
  function removeAllBots() { for (const p of players.bots) { players.removeBot(p); } botMind.clear(); }

  function preInput(dt) {
    if (!sync.isHost || !players.bots.length) return;
    const s = state(), skill = PARTY.bots[s.difficulty] || PARTY.bots.normal;
    for (const p of players.bots) {
      const src = p.botSource;
      if (!src) continue;
      src.tick(dt);
      const mind = botMind.get(p.index) || botMind.set(p.index, { mem: { wander: null, wanderAt: 0, readyAt: -1 }, rng: mulberry32(0x9e3779b9 ^ (p.index * 104729)) }).get(p.index);
      const intent = { x: 0, y: 0 };
      if (!partyMode || curtain.running) { src.intend(intent); continue; }
      if (s.game === 'bumpers' && s.g && !s.g.alive[p.index] && ['play', 'results'].includes(s.phase)) {
        if (landed(s.g, p.index, bumperTime())) Object.assign(intent, spectatorWander(p, mind));
      } else if (s.game === 'glowcap' && s.g && s.g.alive[p.index] === false && ['play', 'results'].includes(s.phase)) {
        Object.assign(intent, shoreWander(p, mind));
      } else if (s.game === 'bonk' && s.g && s.g.alive[p.index] === false && ['play', 'results'].includes(s.phase)) {
        Object.assign(intent, isletWander(p, mind));
      } else if (s.phase === 'play' && s.g && !s.g.done) {
        const g = getGame(s.game), v = g.view(s.g, domain.gameTime());
        Object.assign(intent, g.bot(v, { slot: p.index, x: p.position.x, z: p.position.z, face: p.facing, mem: mind.mem, others: s.roster.filter((r) => r.slot !== p.index).map((r) => { const q = posOf(r.slot); return q ? { slot: r.slot, x: q.x, z: q.z } : null; }).filter(Boolean) }, skill, mind.rng));
        if (intent.hold) for (const b of Object.keys(intent.hold)) src.hold(b, intent.hold[b]);          // (a bot that holds a button, like the shell in Pinecone Huddle)
      } else if (s.phase === 'howto') {
        if (mind.mem.readyAt < 0) mind.mem.readyAt = phaseLocalT + skill.ready[0] + mind.rng() * (skill.ready[1] - skill.ready[0]);
        if (phaseLocalT >= mind.mem.readyAt && !mind.mem.readied) { mind.mem.readied = true; src.hold('interact', 0.7); }
      } else if (s.phase === 'lobby' || s.phase === 'results') {
        mind.mem.readyAt = -1; mind.mem.readied = false;
        if (s.phase === 'lobby') wander(p, mind, intent, skill);
      } else { mind.mem.readyAt = -1; mind.mem.readied = false; }
      src.intend(intent);
    }
  }
  function wander(p, mind, intent, skill) {
    const m = mind.mem;
    if (!m.wander || pt >= m.wanderAt || Math.hypot(m.wander.x - p.position.x, m.wander.z - p.position.z) < 0.5) {
      if (mind.rng() < 0.55) m.wander = { x: O.x + (mind.rng() - 0.5) * 16, z: O.z + 1 + mind.rng() * 8 }; else m.wander = null;
      m.wanderAt = pt + 1.5 + mind.rng() * 3.5;
    }
    if (m.wander) {
      const dx = m.wander.x - p.position.x, dz = m.wander.z - p.position.z, d = Math.hypot(dx, dz) || 1;
      if (d > 0.6) { intent.x = (dx / d) * 0.6 * skill.walk; intent.y = -(dz / d) * 0.6 * skill.walk; }
    }
  }

  // Fallen bots stroll around the little glowcap below. This is an ordinary local stick, never a game request.
  function spectatorWander(p, mind) {
    const m = mind.mem, f = PARTY.bumpers.spectator, c = stageCentre('bumpers');
    if (!m.marshAim || pt >= (m.marshAt || 0)) {
      const a = mind.rng() * Math.PI * 2;
      m.marshAim = { x: c.x + f.x + Math.cos(a) * f.landingR, z: c.z + f.z + Math.sin(a) * f.landingR };
      m.marshAt = pt + 2 + mind.rng() * 3;
    }
    const dx = m.marshAim.x - p.position.x, dz = m.marshAim.z - p.position.z, d = Math.hypot(dx, dz);
    return d < 0.3 ? { x: 0, y: 0 } : { x: dx / d * 0.45, y: -dz / d * 0.45 };
  }

  // Glowcap Shuffle: a bot that fell in strolls along the shore (an ordinary local stick, never a game request)
  function shoreWander(p, mind) {
    const m = mind.mem, sh = PARTY.glowcap.shore, c = stageCentre('glowcap');
    if (!m.shoreAim || pt >= (m.shoreAt || 0)) {
      m.shoreAim = { x: c.x + (mind.rng() * 2 - 1) * (sh.x - 1.2), z: c.z + sh.z0 + 0.9 + mind.rng() * (sh.z1 - sh.z0 - 1.8) };
      m.shoreAt = pt + 1.5 + mind.rng() * 3;
    }
    const dx = m.shoreAim.x - p.position.x, dz = m.shoreAim.z - p.position.z, d = Math.hypot(dx, dz);
    return d < 0.3 ? { x: 0, y: 0 } : { x: dx / d * 0.45, y: -dz / d * 0.45 };
  }

  // Bonk Burrows: a bot that was squashed strolls on its little islet (an ordinary local stick, never a game request)
  function isletWander(p, mind) {
    const m = mind.mem, B = PARTY.bonk, c = stageCentre('bonk'), at = B.patches[p.index % 2];
    if (!m.isletAim || pt >= (m.isletAt || 0)) {
      const a = mind.rng() * Math.PI * 2, r = mind.rng() * (B.patchR - 0.7);
      m.isletAim = { x: c.x + at.x + Math.cos(a) * r, z: c.z + at.z + Math.sin(a) * r };
      m.isletAt = pt + 1.5 + mind.rng() * 3;
    }
    const dx = m.isletAim.x - p.position.x, dz = m.isletAim.z - p.position.z, d = Math.hypot(dx, dz);
    return d < 0.3 ? { x: 0, y: 0 } : { x: dx / d * 0.4, y: -dz / d * 0.4 };
  }

  // ================================================================== input
  const isDown = (a, b) => (b === 'jump' ? a.jumpPressed : b === 'interact' ? a.interactPressed : b === 'cancel' ? a.cancelPressed : false);
  function pressedGameButton(a, g) { return g.press.some((b) => isDown(a, b)); }

  function drive(p, a, dt) {
    if (!partyMode || p.away || p.frozen || curtain.running) return;
    const s = state();
    const g = s.game ? getGame(s.game) : null;
    if (s.phase === 'lobby' || s.phase === 'pick') {
      if (a.jumpPressed) { if (p.hop()) sfx.play('bip', { pitch: 1.4, vol: 0.4 }); }
      return;
    }
    if (!g) return;
    const out = s.g && s.g.alive && s.g.alive[p.index] === false;
    if (s.phase === 'howto') {
      if (g.id === 'bumpers') stages.bumpers?.practiceInput?.(p.index, { x: a.move?.x || 0, z: a.move?.z || 0, jump: !!a.jumpPressed });
      else if (g.id === 'marlosays') marloInput(p, a, s, true);
      else if (g.hold) holdInput(p, a, s, true);
      else if (pressedGameButton(a, g)) practiceAction(p, g, s);
      // Ready: hold Interact
      const ri = rosterIndex(p.index);
      if (ri >= 0 && !s.roster[ri].bot) {
        const r = s.roster[ri], held = (readyHold.get(p) || 0) + (a.interactHeld ? dt : -dt * 3);
        readyHold.set(p, Math.max(0, Math.min(PARTY.flow.readyHold + 0.1, held)));
        if (!r.ready && held >= PARTY.flow.readyHold) { sfx.play('chime', { pitch: 1.3 }); domain.setReady(sync.actorFor(p), true); }
      }
      return;
    }
    if (s.phase === 'countdown') return;
    if (s.phase === 'play') {
      if (out || !s.g || s.g.done) {
        if (out && g.id === 'bumpers' && landed(s.g, p.index, bumperTime()) && a.jumpPressed) p.hop();
        holdMem.delete(p); return;
      }
      if (g.id === 'bumpers') {
        const last = inputMem.get(p), x = a.move?.x || 0, z = a.move?.z || 0;
        // Send changes immediately, plus a 10 Hz refresh. Replicas stream wishes; only the host moves balls.
        if (!last || pt - last.at >= 0.1 || Math.abs(x - last.x) + Math.abs(z - last.z) > 0.05 || a.jumpPressed) {
          inputMem.set(p, { x, z, at: pt });
          domain.act(sync.actorFor(p), domain.gameTime(), { x, z, jump: !!a.jumpPressed });
        }
      } else if (g.id === 'marlosays') marloInput(p, a, s, false);
      else if (g.hold) holdInput(p, a, s, false);
      else if (pressedGameButton(a, g)) gameAction(p, g, s);
      return;
    }
    if (s.phase === 'results') { if (a.jumpPressed || a.interactPressed) p.hop(); }
  }
  // Marlo Says: Cancel (B) = red, Interact (A) = green; the stick only walks (a post is a walkable disc in the water, so wandering kids stay dry)
  function marloInput(p, a, s, practice) {
    if (rosterIndex(p.index) < 0) return;
    const flag = flagFromInput(a);
    if (!flag) return;
    waveFlag(p, flag);
    if (practice) {
      const st = stages.marlosays;
      if (st) st.practicePress(Math.max(0, rosterIndex(p.index)), flag, p); else sfx.play('bip', { vol: 0.3 });
    } else {
      sfx.play('whoosh', { vol: 0.2, pitch: flag === 'red' ? 0.9 : 1.2 });
      domain.act(sync.actorFor(p), domain.gameTime(), { flag });
    }
  }
  // Pinecone Huddle: hold any button to stay curled; the start and the end of a hold are the requests (the practice shell is local)
  function holdInput(p, a, s, practice) {
    const held = !!(a.interactHeld || a.jumpHeld || a.cancelHeld), was = holdMem.get(p) || false;
    if (held === was) return;
    holdMem.set(p, held);
    if (practice) { const st = stages.huddle; if (st) st.setPracticeHold(Math.max(0, rosterIndex(p.index)), held); return; }
    domain.act(sync.actorFor(p), domain.gameTime(), { on: held });
  }
  function practiceAction(p, g, s) {
    if (g.id === 'feastround') { p.swing(); stages.feastround?.practicePress(p.index, p); }
    else if (g.id === 'bumpers') p.hop();
    else if (g.id === 'bonk') { p.hop(); stages.bonk?.practicePress(Math.max(0, rosterIndex(p.index)), p); }
    else if (g.id === 'vineskip') { p.hop(); }
    else if (g.id === 'cast') { p.swing(); stages.cast?.practicePress(Math.max(0, rosterIndex(p.index)), p); }
    else if (g.id === 'timber') {
      p.swing();
      const st = stages.timber, lane = Math.max(0, rosterIndex(p.index));
      const r = st && st.practicePress(lane, p);
      if (!r) sfx.play('whoosh', { vol: 0.3 });
    }
  }
  function gameAction(p, g, s) {
    if (g.id === 'feastround') { p.swing(); sfx.play('chew', { vol: 0.25 }); }
    else if (g.id === 'cast') p.swing();                       // (a cast or a reel pull: the host decides which; the stage plays the sound when its record arrives)
    else if (g.id === 'vineskip' || g.id === 'bonk') p.hop(); else if (g.id === 'timber') { p.swing(); sfx.play('whoosh', { vol: 0.25 }); }
    domain.act(sync.actorFor(p), domain.gameTime(), g.id === 'feastround' ? { face: p.facing } : undefined);
  }

  function updateExit(dt) {
    let holding = false;
    if (sync.isHost) for (const p of localPlayers()) if (p.actions.cancelHeld && p.actions.interactHeld && p.device === 'local') holding = true;
    exitHold = holding ? exitHold + dt : Math.max(0, exitHold - dt * 2);
    ui.exit(exitHold > 0.25 ? exitHold / PARTY.kiosk.exitHold : null);
    if (exitHold >= PARTY.kiosk.exitHold) { exitHold = 0; ui.exit(null); close(); }
  }

  // ================================================================== the Game Board
  const MODE_NAME = { random: 'Random', party: 'Party', pick: 'Pick' };
  function openBoard(p) {
    if (!partyMode || state().phase !== 'lobby' || state().ceremony || dialog.isOpen) return;
    const refresh = (r) => Promise.resolve(r).then((x) => { dialog.refresh?.(); return x; });
    const denied = (r) => { if (r && r.ok === false && r.reason === 'host-only') hud.toast('The host screen changes the Game Board.', { icon: 'sparkle', duration: 2200 }); else if (r && r.ok === false && r.reason === 'last') hud.toast('At least one game stays on!', { icon: 'sparkle', duration: 2200 }); };
    const gameMenu = (g) => ({
      text: `${g.name}  (${hostFor(g.id).name})`,
      choices: () => {
        const on = state().enabled.includes(g.id);
        return [
          { label: on ? 'Switch off' : 'Switch on', detail: on ? 'On' : 'Off', icon: ICONS['party-' + g.id], onSelect: () => refresh(domain.toggle(g.id, !on)).then(denied) },
          { label: state().next === g.id ? 'Play this one next (set)' : 'Play this one next', disabled: !on, icon: ICONS.star, onSelect: () => refresh(domain.playNext(g.id)).then(denied) },
          { label: 'Back', onSelect: () => dialog.showChoices(main.choices, { text: main.text, onCancel: () => dialog.close() }) },
        ];
      },
    });
    const cycle = (list, cur) => list[(list.indexOf(cur) + 1) % list.length];
    const main = {
      text: 'Game Board: pick the party games.',
      choices: () => [
        ...GAMES.map((g) => ({ label: g.name, detail: `${state().enabled.includes(g.id) ? 'On' : 'Off'}${state().next === g.id ? ' - next' : ''}`, icon: ICONS['party-' + g.id], onSelect: () => dialog.showChoices(gameMenu(g).choices, { text: gameMenu(g).text, onCancel: () => dialog.showChoices(main.choices, { text: main.text, onCancel: () => dialog.close() }) }) })),
        { label: 'Mode', detail: MODE_NAME[state().mode], onSelect: () => refresh(domain.setMode({ mode: cycle(PARTY.modes, state().mode) })).then(denied) },
        { label: 'Bots', detail: state().bots === 'fill' ? 'Fill seats' : String(state().bots), icon: ICONS.bot, onSelect: () => refresh(domain.setMode({ bots: cycle(['fill', 0, 1, 2, 3], state().bots) })).then(denied) },
        { label: 'Bot skill', detail: state().difficulty, onSelect: () => refresh(domain.setMode({ difficulty: cycle(PARTY.difficulties, state().difficulty) })).then(denied) },
        { label: 'Close', onSelect: () => dialog.close() },
      ],
    };
    dialog.open({ owner: p, name: 'Game Board', text: main.text, choices: main.choices, menuId: 'party-board', onCancel: () => dialog.close() });
  }

  // ================================================================== camera + light
  function camCfg() {
    if (place === 'lobby') return CAMERAS.lobby;
    return (getStage(place) || {}).cam || CAMERAS.lobby;
  }
  function updateCamera(dt) {
    const c = camCfg();
    followCam.offset.set(c.offset.x, c.offset.y, c.offset.z);
    focus.set(c.focus.x, c.focus.y - 0.9, c.focus.z);
    const aspect = camera.aspect > 0 ? camera.aspect : 16 / 9;
    camera.aspect = aspect;
    const z = Math.max(0.8, followCam.zoomForExtent(c.extent.w, c.extent.d, 0.4, false));
    followCam.update(dt, focus, z);
    if (cerOn) ceremonyCamera();                              // (the trophy cut owns the view; followCam keeps tracking the light)
  }
  const LOOK_CACHE = {};
  function light(sky, renderer) {
    if (!partyMode) return false;
    const name = place === 'lobby' ? 'day' : ((getStage(place) || {}).look || 'day');
    const L = LOOKS[name];
    const c = LOOK_CACHE[name] ||= { bg: new THREE.Color(L.bg), top: new THREE.Color(L.top), horizon: new THREE.Color(L.horizon), sun: new THREE.Color(L.sun), sky: new THREE.Color(L.sky), ground: new THREE.Color(L.ground) };
    scene.background?.copy?.(c.bg); scene.fog?.color.copy(c.bg);
    const u = sky.dome.material.uniforms;
    u.uTop.value.copy(c.top); u.uHorizon.value.copy(c.horizon); u.uSunVisible.value = 0; u.uMoonVisible.value = 0;
    sky.stars.material.uniforms.uNight.value = L.stars;
    sky.sun.color.copy(c.sun); sky.sun.intensity = L.sunIntensity;
    sky.sun.position.copy(sky.sun.target.position).addScaledVector(_v.set(...L.sunDir).normalize(), Math.hypot(...L.sunDir));
    sky.hemi.color.copy(c.sky); sky.hemi.groundColor.copy(c.ground); sky.hemi.intensity = L.hemiIntensity;
    renderer.toneMappingExposure = L.exposure;
    return true;
  }

  // ================================================================== per frame
  function boardRows() {
    const s = state(), g = s.game ? getGame(s.game) : null, v = g && s.g ? g.view(s.g, s.game === 'bumpers' ? bumperTime() : Math.max(0, domain.gameTime())) : null, st = g ? stages[s.game] : null;
    return s.roster.map((r) => {
      const live = v && st && (s.phase === 'play' || s.phase === 'results') ? st.scoreText(v, r.slot) : { text: '', out: false };
      return { slot: r.slot, name: r.name, bot: r.bot, color: colorOf(r.slot), stars: s.stars[r.slot] || 0, line: live.text, out: live.out, ready: s.phase === 'howto' && (r.ready) };
    });
  }

  // Finish the spore drift even while the results card is up (the authoritative game clock stops there).
  function bumperTime() { return Math.max(0, domain.gameTime()) + (state().phase === 'results' ? phaseLocalT : 0); }
  function clearBumperBodies() {
    for (const [p, probe] of partyProbes) { p.groundProbe = probe; p.partyLayer = null; }
    for (const p of [...localPlayers(), ...avatars.list]) p.partyLayer = null;
    partyProbes.clear(); landedBodies.clear();
  }

  // Pose buffers and local soft separation run after update. Reapply host-owned poses after both, on every screen.
  function sharedBodies() {
    if (!partyMode || curtain.running) return;
    if (cerOn) { podiumHold(); return; }
    const s = state(), gt = domain.gameTime();
    if (['feastround', 'bumpers'].includes(s.game) && ['howto', 'countdown', 'play', 'results'].includes(s.phase)) {
      const c = stageCentre(s.game);
      for (const [i, r] of s.roster.entries()) {
        const p = who(r.slot); if (!p) continue;
        const bumperState = s.g || (s.phase === 'howto' && stages.bumpers?.practiceState?.());
        if (s.game === 'bumpers' && bumperState) {
          const q = ballPose(bumperState, r.slot, s.g ? bumperTime() : bumperState.simT);
          if (!q) continue;
          if (!partyProbes.has(p)) partyProbes.set(p, p.groundProbe);
          p.partyLayer = q.landed ? 'marsh' : q.out ? 'drift:' + r.slot : 'cap';
          p.groundProbe = () => O.y + (q.out ? PARTY.bumpers.spectator.y : 0);
          if (q.landed) {
            if (players.get(r.slot)) {
              if (!landedBodies.has(p)) {
                moveTo(p, spectatorSpot('bumpers', r.slot), false); landedBodies.set(p, true);
              }
              p.speedScale = 1;
            }
          } else {
            if (players.get(r.slot)) { p.speedScale = 0; p.velocity.x = p.velocity.z = 0; }
            p.position.set(c.x + q.x, O.y + q.y, c.z + q.z);
            applyBumperRider(p, bumperState, r.slot);
          }
          // The floor probe is set after the normal animator: place the shadow on the correct layer now, too.
          if (p.parts?.blob) p.parts.blob.position.y = 0.06 + p.groundProbe() - p.position.y;
        } else if (s.game === 'bumpers') {
          if (players.get(r.slot)) p.speedScale = 0;
          p.partyLayer = 'cap'; p.position.y = O.y + 2 * PARTY.bumpers.ballR;
        } else if (s.game === 'feastround') {
          // Walking remains owned by each player's normal movement; only the pepper's fan is a presentation override.
          const hot = s.g && gt < (s.g.hotUntil[r.slot] || 0);
          if (hot && pt - (flameAt.get(p) || 0) > 0.08) {             // a spicy pepper: little flames and sparks puff out of the mouth, on every screen (bots and remote avatars too)
            flameAt.set(p, pt);
            const f = p.facing || 0, mouth = { x: p.position.x + Math.sin(f) * 0.3, y: p.position.y + 1.35, z: p.position.z + Math.cos(f) * 0.3 }, k = Math.floor(pt * 12) % 3;
            particles.burst('sparkle', mouth, { count: 2, radius: 0.1, height: 0.35, speed: 2.4, color: k === 0 ? '#ff7a1a' : k === 1 ? '#ffd23a' : '#ff4a1a' });
            particles.burst('puff', mouth, { count: 1, radius: 0.08, height: 0.45, size: 0.45, color: k === 1 ? '#ff9a2a' : '#ff4a1a' });
          }
          if (hot) {
            p.parts.rig.position.y = (p._hopY || 0) + Math.abs(Math.sin(gt * 12)) * 0.35;
          }
          if (hot && p.parts?.armL && p.parts?.armR) {
            p.parts.armL.rotation.x = -1.9; p.parts.armR.rotation.x = -1.9;
            p.parts.armL.rotation.z = 0.4 + Math.sin(gt * 20) * 0.3;
            p.parts.armR.rotation.z = -0.4 - Math.sin(gt * 20) * 0.3;
          }
        }
      }
    }
  }

  function update(dt, t) {
    pt += dt;
    domain.update(dt);
    curtain.update(dt);
    for (let i = timers.length - 1; i >= 0; i--) if (pt >= timers[i].at) { const f = timers[i].fn; timers.splice(i, 1); try { f(); } catch (e) { console.error(e); } }
    const s = state();
    reconcile();
    if (!s.active && !partyMode && sync.isHost && players.bots.length && !curtain.running) removeAllBots();
    players.queueing = sync.isHost && s.active;                       // Step 80e: a person who found the island full stays queued for the seat a bot gives up
    if (cerOn && (!partyMode || !s.active || !s.ceremony)) stopCeremony();
    updateAttract(dt, s);
    if (!!s.attract !== attractSeen) {                                // the attract mode: the music sits at half volume on every screen meanwhile
      attractSeen = !!s.attract;
      if (attractSeen) music.duck?.(PARTY.attract.duck, 1.2); else if (!cerOn) music.unduck?.(1.2);
    }
    if (!partyMode || curtain.running) return;
    const key = phaseKey(s);
    if (key !== appliedKey) { appliedKey = key; applyPhase(s); }
    phaseLocalT += dt;
    if (s.ceremony && s.phase === 'lobby' && !cerOn) startCeremony(s);
    if (cerOn) updateCeremony(dt, s);
    const gt = domain.gameTime(), g = s.game ? getGame(s.game) : null, st = s.game ? stages[s.game] : null;
    glade?.update(dt, pt, [...players.list, ...avatars.list]);
    sharedBodies();
    {                                                                                  // Glowcap Shuffle: a sunk cap is water, not ground (the walkable area follows the drawn caps)
      const sv = s.game === 'glowcap' && g && s.g && (s.phase === 'play' || s.phase === 'results') ? g.view(s.g, Math.max(0, gt)) : null;
      setGlowcapSunk(sv ? sv.depth.map((d, i) => (d >= 0.95 ? i : -1)).filter((i) => i >= 0) : []);
    }
    if (st && st.root.visible) {
      const mode = s.phase === 'howto' ? 'practice' : s.phase === 'play' || s.phase === 'results' ? 'play' : 'wait';
      const v = mode === 'play' && g && s.g ? g.view(s.g, s.game === 'bumpers' ? bumperTime() : Math.max(0, gt)) : null;
      st.update(dt, { mode, v, t: Math.max(0, gt), who, lanePlayers: s.roster.map((r) => who(r.slot)) });
      if (s.game === 'tilty') setTiltyTilts(st.tilts());                                    // (Step 81b: the floor under the feet follows the drawn frames)
      if (s.phase === 'play' && s.game === 'vineskip' && v) { const k = 1 + 0.045 * v.level; if (k !== lastTempo) { lastTempo = k; music.setTempo?.(k); } }
      else if (s.phase === 'play' && s.game === 'sizzle' && v) { const k = 1 + 0.3 * v.heat; if (Math.abs(k - lastTempo) > 0.02) { lastTempo = k; music.setTempo?.(k); } }      // (Fuse Box's hi-hat quickens with the seed's glow, which is its age, never the real timer)
      else if (s.phase === 'play' && s.game === 'marlosays' && v) { const k = v.tempo; if (k !== lastTempo) { lastTempo = k; music.setTempo?.(k); } }      // (the shanty follows the beats: faster as the flags get shorter)
    }
    if (s.game !== 'tilty' || !st || !st.root.visible) setTiltyTilts(null);
    if (s.phase === 'play' && s.game === 'sizzle' && s.g) for (const p of localPlayers()) p.speedScale = SIZ.holderSpeed(s.g, p.index);
    for (const [p, f] of flags) if (pt >= f.until && (f.red.visible || f.green.visible)) f.red.visible = f.green.visible = false;
    labels.update(dt, camera);
    ui.setBoard(boardRows());
    // --- the HUD of each phase
    if (s.phase === 'lobby' && !s.ceremony) {
      const wait = s.round === 0 && !s.results ? PARTY.flow.lobbyFirst : PARTY.flow.lobby, total = s.mode === 'pick' && !s.next ? PARTY.flow.pickWait : wait;
      const left = Math.max(0, Math.ceil(total - (sync.isHost ? s.t : phaseLocalT)));
      ui.pill(s.mode === 'pick' && !s.next ? `Pick a game at the Game Board! (${left})` : `Next game in ${left}   ·   ${s.mode === 'party' ? `Round ${Math.min(s.round + 1, s.rounds)} of ${s.rounds}` : MODE_NAME[s.mode]}`);
    } else ui.pill(null);
    if (s.attract) ui.pill('Press any button to play!');
    if (s.phase === 'pick') {
      const ids = s.enabled, n = ids.length, target = Math.max(0, ids.indexOf(s.game));
      const u = Math.min(1, phaseLocalT / PARTY.flow.roulette), pos = (1 - Math.pow(1 - u, 3)) * (n * 3 + target);
      if (Math.floor(pos) !== roulettePos) { roulettePos = Math.floor(pos); if (u < 1) sfx.play('tick', { pitch: 0.9 + u * 0.6 }); }
      ui.roulette({ ids, names: ids.map((id) => getGame(id).name), pos });
    } else roulettePos = -1;
    if (s.phase === 'howto' && g) {
      const kinds = [...new Set(localPlayers().filter((p) => !p.bot).map((p) => (p.deviceKind === 'phone' ? 'phone' : p.deviceKind === 'gamepad' ? 'gamepad' : 'keyboard')))];
      const devs = (kinds.length ? kinds : ['keyboard']).map((kind) => ({ kind, buttons: g.howto.buttons.map((btn) => ({ btn, verb: g.howto.verbs ? g.howto.verbs[btn] || '' : '' })) }));
      ui.howto({
        id: g.id, name: g.name, host: g.host, line: hostFor(g.id).lines.welcome || '', pitch: g.howto.pitch, devices: devs, left: PARTY.flow.howtoMax - phaseLocalT,
        rows: s.roster.map((r) => ({ name: r.name, color: colorOf(r.slot), ready: r.ready, bot: r.bot })),
      });
    }
    if (s.phase === 'countdown') {
      const label = countdownLabel(Math.max(0, gt + PARTY.flow.countdown));
      if (label !== lastLabel) { lastLabel = label; ui.banner(label, { ms: 900 }); sfx.play('count', { pitch: label === '1' ? 1.25 : 1 }); }
    }
    if (s.phase === 'play') ui.hideCard();
    if (s.phase === 'results' && s.results && phaseLocalT > 1.4) {
      const R = s.results, g2 = getGame(R.game);
      ui.results({
        id: R.game, name: g2 ? g2.name : '', partyOver: R.partyOver, round: R.round,
        bonus: R.bonus ? { label: R.bonus.label, text: R.bonus.text, names: R.bonus.slots.map(nameOf) } : null,
        ranks: R.ranks.map((r) => ({ name: nameOf(r.slot), bot: !!s.roster.find((x) => x.slot === r.slot && x.bot), color: colorOf(r.slot), place: r.place, score: resultScore(R.game, r), stars: s.stars[r.slot] || 0, winner: r.place === 1 })),
      });
      resultsHopT += dt;
      if (resultsHopT > 0.9) {
        resultsHopT = 0;
        for (const p of localPlayers()) { const rk = R.ranks.find((r) => r.slot === p.index); if (rk && rk.place === 1) { p.hop(); particles.burst('sparkle', { x: p.position.x, y: p.position.y + 1.6, z: p.position.z }, { count: 5, radius: 0.5, color: '#ffe27a' }); } }
      }
    }
    updateReadyRings();
    updateExit(dt);
    syncBots(dt);
  }
  function resultScore(id, r) {
    if (id === 'bumpers') return r.out ? `Drifted at ${Number(r.score).toFixed(1)}s` : 'Still on the cap!';
    if (id === 'vineskip') return r.out ? `${Number(r.score).toFixed(1)}s` : 'Last one up!';
    if (id === 'marlosays') return r.out ? `Splash at flag ${Number(r.score) + 1}` : 'Dry to the end!';
    if (id === 'sizzle') return r.out ? 'Sooty!' : 'Safe!';
    if (id === 'eggs') return `${r.score} egg${r.score === 1 ? '' : 's'}`;
    if (id === 'glowcap') return r.out ? `Splash in round ${Number(r.score) + 1}` : 'Dry to the end!';
    if (id === 'cast') return `${r.score} pt${r.score === 1 ? '' : 's'}`;
    if (id === 'tilty') return `${r.score} of 20 tiles`;
    if (id === 'bonk') return r.out ? `Squished at ${Number(r.score).toFixed(1)}s` : 'Still standing!';
    if (id === 'huddle') return r.out ? 'Dazed' : `${Number(r.score).toFixed(1)}s of shell`;
    return `${r.score} pts`;
  }

  function updateReadyRings() {
    const show = state().phase === 'howto' && partyMode;
    for (const p of players.list) {
      let ring = readyRings.get(p);
      if (!ring) { ring = document.createElement('div'); ring.className = 'drop-hold-ring'; ring.hidden = true; hudRoot.appendChild(ring); readyRings.set(p, ring); }
      const h = readyHold.get(p) || 0, r = state().roster.find((x) => x.slot === p.index);
      ring.hidden = !(show && h > 0.05 && !(r && r.ready));
      if (!ring.hidden) {
        _v.set(p.position.x, p.position.y + 2.15, p.position.z).project(camera);
        ring.style.left = `${(_v.x * 0.5 + 0.5) * window.innerWidth}px`;
        ring.style.top = `${(-_v.y * 0.5 + 0.5) * window.innerHeight}px`;
        ring.style.background = `conic-gradient(${p.colors.ui} ${Math.min(360, h / PARTY.flow.readyHold * 360)}deg, #ffffff99 0)`;
      }
    }
    for (const [p, ring] of readyRings) if (!players.list.includes(p)) { ring.remove(); readyRings.delete(p); readyHold.delete(p); }
  }

  players.on('leave', (p) => { memory.delete(p); tucked.delete(p); dropAxe(p); dropRod(p); dropFlags(p); readyHold.delete(p); holdMem.delete(p); inputMem.delete(p); });
  players.on('join', (p) => {
    if (partyMode && state().active && !p.bot) {                // a person who joins mid-party: with the others in the Glade
      const m = players.p1 && memory.get(players.p1);
      if (m) memory.set(p, { ...m });
      const rec = items.heldBy(p); if (rec) tucked.set(p, rec);
    }
  });
  players.onFull = () => {
    if (!state().active) return;
    yieldUntil = pt + 15; seatWaitUntil = pt + 150;                  // Step 80e: the waiting person stays queued across games (150 s), a bot gives its seat at the next lobby / pick and the joiner plays from that pick
    if (pt - lastFullToast > 6) { lastFullToast = pt; hud.toast('You are next! A bot is giving up its seat.', { icon: 'sparkle', duration: 2600 }); }
  };

  // ================================================================== API
  function optsFromParams(q) {
    const o = {};
    if (q.get('mode')) o.mode = q.get('mode');
    if (q.get('games')) o.games = q.get('games').split(',').map((x) => x.trim()).filter(Boolean);
    if (q.get('rounds')) o.rounds = Number(q.get('rounds'));
    if (q.has('bots')) o.bots = parseBots(q.get('bots'));
    if (q.get('difficulty')) o.difficulty = q.get('difficulty');
    return o;
  }
  const api = {
    domain, ui, curtain, labels, optsFromParams, config,
    get kiosk() { return kiosk; },
    get ceremonyOn() { return cerOn; },
    get active() { return state().active; },
    get pageMode() { return partyMode; },
    get place() { return place; },
    contains: (p) => partyMode && inPocket(p),
    allowsTarget: (it) => (it.type === 'partyboard' || it.type === 'partydress' ? partyMode && state().phase === 'lobby' && !state().ceremony && !curtain.running : !partyMode),
    preInput, update, drive, updateCamera, light, afterItems, afterAvatars: sharedBodies,
    open: (opts) => domain.open(opts),
    close,
    toggle: (id, on) => domain.toggle(id, on),
    enabled: () => domain.enabled(),
    games: () => domain.games(),
    bots: (n = 'fill', difficulty) => domain.setMode({ bots: parseBots(n), ...(difficulty ? { difficulty } : {}) }),
    play: (id) => { const open = state().active ? true : domain.open({}); return Promise.resolve(open).then(() => domain.debug.play(id)); },
    skip: () => domain.skip(),
    next: () => { let r = null; for (let i = 0; i < 6 && state().phase !== 'pick'; i++) r = domain.skip(); return r; },
    get state() { return state(); },
    debug: {
      win: (slot = 0) => domain.debug.win(slot), end: () => domain.debug.end(), seed: (n) => domain.debug.seed(n),
      glade: () => getGlade(), stage: (id) => getStage(id), timers, memory, tucked, botMind, camera: camCfg, ceremony: () => ceremony, idle: () => idleT, skipCeremony: () => domain.skipCeremony(),
    },
    summary() {
      return { ...domain.summary(), partyMode, place, ceremonyOn: cerOn, idle: +idleT.toFixed(1), curtain: curtain.summary(), ui: ui.summary(), bots: players.bots.map((p) => ({ slot: p.index, name: p.colors.name, x: +p.position.x.toFixed(1), z: +p.position.z.toFixed(1) })), glade: glade ? glade.summary() : null, stages: Object.fromEntries(Object.entries(stages).map(([k, v]) => [k, v.summary()])), tucked: tucked.size, music: music.partyTrack ?? null };
    },
  };
  function close() { return domain.close(); }
  return api;
}
