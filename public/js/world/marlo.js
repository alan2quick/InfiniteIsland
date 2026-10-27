// Skipper Marlo the sea otter (PLAN Step 68a): the old sailor at Emberleaf's cove. A sibling of world/mossback.js (not part of npcs.js): the model is npc/marlo.js (7 draw calls), the lines are in
// game/marloScript.js, the cove he stands in is world/islands/emberCove.js.
//
//   const marlo = createMarlo({ scene, players, avatars, world, dialog, particles, sfx, boat, floatLabel })     once at load, on every screen (after createBoat)
//   marlo.update(dt, nightness)      once per tick: presence (the synced boat state), facing, the idles, sleepiness
//   marlo.shown / .position / .group / .model / .idle     state;  marlo.talk(player)  open his menu (what the interactable does)
//   marlo.cheer() / marlo.say(text)   a hop of joy + a floating word (the cove calls cheer when Biscuit lands a part)
//   marlo.setRepairBeat(hostSeconds|null)  stand awake and tap the bucket on the shared grid (68c)
//   marlo.setStayAwake(bool)         Step 68d: he stays up for the star chart (otherwise he dozes at night)
//   marlo.introSeen / marlo.resetIntro()   the per-screen "has he introduced himself" memory (localStorage `infiniteIsland.marloIntro`; ?newgame clears it)
//   marlo.setRowProvider(fn)         Step 73b: fn(player) -> [{ label, lines: string[] }] extra "ask Marlo" rows shown while the boat is at Duskcrown (Capray's quest line hints; world/caprayWorld.js)
//   marlo.ride(pose|null)            Step 71: aboard the boat during a crossing ({ x, y, z, yaw } follows the hull; null puts him back); marlo.at = the island he stands on
//   marlo.summary()                  debug snapshot
//
// Step 71: Marlo always sails with the boat. Once it is launched he stands at the dock of `boat.state.at` (Emberleaf's cove spot, or beside the Duskcrown pier of world/islands/duskDock.js): the
// collider and the interactable move with him; he only draws while THAT island is in full detail.
//
// Presence: he exists once `boat.unlocked` (the first Emberleaf feast; synced). It pops in live (a squash-and-stretch drop) when the unlock event arrives on a screen that can see the cove, and is just there on a
// load / late join. The collider and the interactable (`npc`, "Talk", a plain interact even while holding a tool) exist from the unlock; the model only draws while Emberleaf is in full detail (world.regions).
//
// Idles (cosmetic, per screen): the signature BACK-FLOAT (lies back in the shallows, a clam on his tummy, taps it with a stone: tok tok tok), the spyglass toward the horizon, dozing with the cap over his eyes,
// a wave when a crew member walks up. Sleepy at night: he dozes except while `stayAwake`. While his dialog is open he stands up, faces the speaker and nods.
import * as THREE from 'three';
import { MARLO, ISLANDS, HOP_COURSE } from '../config.js';
import { getHeight } from './terrain.js';
import { addCollider, removeCollider } from './colliders.js';
import { addInteractable, removeInteractable } from './interactables.js';
import { createMarloModel } from '../npc/marlo.js';
import { pickFaceTarget, turnToward } from '../game/npcLogic.js';
import { NEW_GAME } from '../game/save.js';
import { MARLO_SCRIPT, boatPages, nextHint, repairRows, questRowsShown } from '../game/marloScript.js';
import { coveLayout } from './islands/emberCove.js';
import { duskDockLayout } from './islands/duskDock.js';
import { QUEST_SVG, SPARKLE_SVG, LEAVE_SVG, BRIDGE_SVG } from '../ui/icons.js';

const INTRO_KEY = 'infiniteIsland.marloIntro';
const readIntro = () => { try { return localStorage.getItem(INTRO_KEY) === '1'; } catch { return false; } };
const writeIntro = () => { try { localStorage.setItem(INTRO_KEY, '1'); } catch { /* private window: the intro just plays again next load */ } };

const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const NIGHT_SLEEPY = 0.55;
// the idle cycle: kind and how long it lasts (s); the back-float is his signature so it comes round most often
const CYCLE = [['float', 11], ['stand', 3.5], ['spy', 6], ['float', 10], ['wave', 2.2], ['stand', 3], ['doze', 7]];

export function createMarlo({ scene, players, avatars = null, world, dialog, particles, sfx = null, boat, floatLabel = null, voyage = null }) {
  const snd = (name, opts) => { if (sfx) sfx.play(name, opts); };
  const island = ISLANDS.find((i) => i.id === 'ember');
  const spots = { ember: coveLayout(island).marlo, duskcrown: duskDockLayout().marlo };
  let at = 'ember', spot = spots.ember, ride = null;
  const position = new THREE.Vector3(spot.x, getHeight(spot.x, spot.z), spot.z);
  let heard = !NEW_GAME && readIntro();
  if (NEW_GAME) { try { localStorage.removeItem(INTRO_KEY); } catch { /* ignore */ } }

  const m = { id: 'marlo', name: MARLO.name, species: 'otter', position, shown: false, group: null, model: null, collider: null, interactable: null, idle: 'stand' };
  let repairBeat = null, rowProvider = null, rubyRows = null;
  let time = 0, yaw = spot.yaw, focus = null, stayAwake = false, popT = -1;
  let cycleI = 0, cycleT = 0, forced = null;
  let floatK = 0, spyK = 0, dozeK = 0, waveK = 0, sleepy = 0, nodT = -1, hopT = -1, tok = 0, tokN = 0, zT = 1.5, blinkT = 3, blinkPhase = -1;
  const candidates = [];

  function ensureModel() {
    if (m.model) return;
    m.model = createMarloModel();
    m.group = new THREE.Group();
    m.group.name = 'npc-marlo';
    m.group.position.copy(position);
    m.group.rotation.y = yaw;
    m.model.root.scale.setScalar(MARLO.scale);
    m.group.add(m.model.root);
    scene.add(m.group);
  }
  const say = (text, up = 1.9) => { if (floatLabel) floatLabel(text, { x: position.x, y: position.y + up, z: position.z }, null, null); };

  // ------------------------------------------------------------------ talking
  const back = (p, index) => () => menu(p, index);
  const hint = () => nextHint(boat.state);
  function mainChoices(p) {
    const pages = (list, index) => (c, d) => dialog.showPages(list, { name: MARLO.name, onFinish: back(p, index) });
    const shown = questRowsShown(boat.state);   // finished quest rows go away (the repair rows once she floats, "How's the boat?" after the voyage)
    return [
      ...(boat.state.floated && boat.state.sights.every(Boolean) && !boat.state.launched ? [{ label: "Ready to see what's past the horizon?", icon: BRIDGE_SVG,
        onSelect: () => { const r = voyage?.request(p); const done = res => { if (res?.ok) dialog.close(); }; if (r?.then) r.then(done); else done(r); } }] : []),
      ...(Object.values(boat.state.parts).every(Boolean) && !boat.state.repair ? [{ label: "Let's patch her up, crew!", icon: BRIDGE_SVG,
        onSelect: () => { const r = boat.request('repair', {}, p); const done = res => { if (res?.ok) dialog.close(); }; if (r?.then) r.then(done); else done(r); } }] : []),
      ...(boat.state.at === 'duskcrown' ? [{ label: "What's this place?", icon: QUEST_SVG, onSelect: pages(MARLO_SCRIPT.dusk, 3) }] : []),
      ...(boat.state.at === 'duskcrown' && rowProvider ? rowProvider(p).map((r) => ({ label: r.label, icon: SPARKLE_SVG, onSelect: pages(r.lines, 3) })) : []),
      ...(shown.repair ? repairRows(boat.state).map(row => ({ ...row, icon: BRIDGE_SVG, onSelect: () => dialog.showPages([row.detail], { name: MARLO.name, onFinish: back(p, 0) }) })) : []),
      ...(shown.boat ? [{ label: "How's the boat?", icon: BRIDGE_SVG, detail: hint(), onSelect: (c, d) => dialog.showPages(boatPages(boat.state), { name: MARLO.name, onFinish: back(p, 0) }) }] : []),
      ...(rubyRows ? rubyRows(p).map(r => ({ label: r.label, icon: SPARKLE_SVG, onSelect: pages(r.lines, 3) })) : []),
      { label: 'Who are you?', icon: QUEST_SVG, onSelect: pages(MARLO_SCRIPT.who, 1) },
      { label: 'Tell me about clams', icon: SPARKLE_SVG, onSelect: pages(MARLO_SCRIPT.clams, 2) },
      { label: 'Bye', icon: LEAVE_SVG, onSelect: () => { dialog.close(); say(MARLO_SCRIPT.bye); } },
    ];
  }
  function menu(p, index = 0) {
    dialog.showChoices(() => mainChoices(p), { text: MARLO_SCRIPT.greet, index, onCancel: null, name: MARLO.name });
  }
  function talk(p) {
    if (!p || dialog.isOpen) return false;
    nodT = 0;
    forced = 'stand';
    snd('pop', { pitch: 0.75, vol: 0.7 });
    dialog.open({
      name: MARLO.name, owner: p, tag: players.multi ? p.colors.name : '', color: p.colors.ui, menuId: 'npc-marlo',
      choices: () => mainChoices(p), text: MARLO_SCRIPT.greet,
    });
    if (!heard) {
      heard = true; writeIntro();
      dialog.showPages(MARLO_SCRIPT.intro, { name: MARLO.name, onFinish: () => menu(p, 0) });
    }
    return true;
  }

  // ------------------------------------------------------------------ show / hide
  function show(live) {
    ensureModel();
    m.shown = true;
    if (live) popT = 0;
    if (!m.collider) m.collider = addCollider({ x: position.x, z: position.z, r: MARLO.radius, owner: m.group });
    if (!m.interactable) addTalk();
  }
  function addTalk() {
    m.interactable = addInteractable({
      type: 'npc', object: null, position: position.clone(), radius: MARLO.talkRadius, prompt: 'Talk', onInteract: (item, by) => talk(by || players.p1),
    });
  }
  /** The boat moved to the other dock: he walks along (no animation: the crossing hid him aboard). */
  function relocate(to) {
    at = to; spot = spots[to]; yaw = spot.yaw;
    position.set(spot.x, getHeight(spot.x, spot.z), spot.z);
    if (m.group) m.group.position.copy(position);
    if (m.collider) { removeCollider(m.collider); m.collider = addCollider({ x: position.x, z: position.z, r: MARLO.radius, owner: m.group }); }
    if (m.interactable) { removeInteractable(m.interactable); addTalk(); }
  }
  function hide() {
    if (!m.shown) return;
    m.shown = false;
    if (m.group) m.group.visible = false;
    if (m.collider) { removeCollider(m.collider); m.collider = null; }
    if (m.interactable) { removeInteractable(m.interactable); m.interactable = null; }
    if (dialog.isOpen && dialog.menuId === 'npc-marlo') dialog.close();
  }
  boat.on((info) => {                                  // the unlock arrives live: pop in (where Emberleaf is drawn); a snapshot / load just shows him
    if (info.kind === 'unlock' || info.kind === 'set' || info.kind === 'finishRepair') { if (boat.unlocked) show(info.live && info.kind === 'unlock'); else hide(); }
  });
  if (boat.unlocked) show(false);

  // ------------------------------------------------------------------ per frame
  function nearest() {
    candidates.length = 0;
    for (const p of players.list) if (!p.away) candidates.push(p.position);
    if (avatars) for (const a of avatars.list) if (a.root.visible) candidates.push(a.position);
    return pickFaceTarget(position, candidates, MARLO.nearR);
  }

  function update(dt, nightness = 0) {
    time += dt;
    if (boat.unlocked && !m.shown) show(false);
    else if (!boat.unlocked && m.shown) hide();
    const want = boat.state.launched ? boat.state.at : 'ember';
    if (want !== at) relocate(want);
    if (!m.shown || !m.group) return;
    const full = ride ? true : !world || !world.regions || world.regions.isFull(at);
    m.group.visible = full;
    if (!full) return;
    if (ride) m.group.position.set(ride.x, ride.y, ride.z); else m.group.position.copy(position);
    const mod = m.model;
    const s = time;
    const near = nearest();
    focus = near ? { x: near.x, z: near.z } : null;
    const talking = dialog.isOpen && dialog.menuId === 'npc-marlo' && dialog.owner;
    if (!talking) forced = null;

    // the idle cycle
    const night = nightness > NIGHT_SLEEPY && !stayAwake && repairBeat === null && !ride;
    cycleT += dt;
    if (cycleT >= CYCLE[cycleI][1]) { cycleT = 0; cycleI = (cycleI + 1) % CYCLE.length; tokN = 0; tok = 0; }
    let kind = repairBeat !== null || ride ? 'stand' : forced || CYCLE[cycleI][0];
    if (night && !talking) kind = 'doze';
    if (!talking && kind !== 'doze' && near && Math.hypot(near.x - position.x, near.z - position.z) < 3.2 && kind === 'float') kind = 'stand';   // somebody walks right up: he sits up
    if (!talking && near && Math.hypot(near.x - position.x, near.z - position.z) < MARLO.nearR * 0.8 && !night && kind === 'stand' && cycleT < 1.6) kind = 'wave';
    m.idle = kind;
    floatK = damp(floatK, kind === 'float' ? 1 : 0, 2.6, dt);
    spyK = damp(spyK, kind === 'spy' ? 1 : 0, 3, dt);
    dozeK = damp(dozeK, kind === 'doze' ? 1 : 0, 2.2, dt);
    waveK = damp(waveK, kind === 'wave' ? 1 : 0, 6, dt);
    sleepy = damp(sleepy, night ? 1 : 0, 1.5, dt);

    // pop-in (the unlock arrived while the cove is in view)
    let sc = 1, sxz = 1;
    if (popT >= 0) {
      popT += dt;
      if (popT >= 0.7) popT = -1;
      else { const ky = 1 - Math.exp(-5 * popT) * Math.cos(16 * popT); sc = Math.max(0.001, ky); sxz = 1 + 0.4 * (1 - ky) * Math.exp(-3 * popT); }
    }
    mod.root.scale.set(MARLO.scale * sxz, MARLO.scale * sc, MARLO.scale * sxz);

    // facing: he lies with his head to the shore when floating; otherwise he turns towards the nearest crew member, or back out to sea
    const tgt = talking ? dialog.owner.position : near;
    const goal = floatK > 0.5 || dozeK > 0.5 || !tgt ? spot.yaw : Math.atan2(tgt.x - position.x, tgt.z - position.z);
    yaw = turnToward(yaw, goal, dt, talking ? 2.6 : 1.6);
    m.group.rotation.y = ride ? ride.yaw : yaw;

    // breathing, the back-float lean and a gentle bob on the water
    const br = Math.sin(s * 1.9);
    const bob = floatK * 0.025 * Math.sin(s * 1.4);
    mod.rig.scale.set(1 - 0.005 * br, 1 + 0.012 * br, 1 - 0.005 * br);
    mod.rig.rotation.x = -1.32 * floatK + (hopT >= 0 ? 0 : 0);
    mod.rig.position.set(0, 0.3 * floatK + bob + hopY(dt), -0.12 * floatK);

    // eyes: shut asleep, slow blinks, droopy at night
    let closed = 0;
    if (dozeK > 0.5) closed = 1;
    else {
      blinkT -= dt;
      if (blinkPhase < 0 && blinkT <= 0) blinkPhase = 0;
      if (blinkPhase >= 0) { blinkPhase += dt; const k = blinkPhase / 0.3; closed = k >= 1 ? 0 : Math.sin(k * Math.PI); if (k >= 1) { blinkPhase = -1; blinkT = 3 + (((s * 5.7) % 1) + 1) % 1 * 3; } }
      closed = Math.max(closed, 0.5 * sleepy);
      closed = Math.max(closed, 0.8 * floatK * (0.6 + 0.4 * Math.sin(s * 0.7)));     // he squints, pleased, while he floats
    }
    mod.setBlink(closed);

    // head: doze = cap down over the eyes; spy = looks to the horizon; float = tipped back, contented; talking = a nod
    let hx = 0.03 * Math.sin(s * 1.1), hy = 0, hz = 0.03 * Math.sin(s * 0.8);
    hx += dozeK * (0.62 + 0.04 * Math.sin(s * 1.2)) - floatK * 0.2 + spyK * -0.08;
    hy += spyK * (0.4 * Math.sin(s * 0.5) + 0.2);
    if (!tgt && !spyK && !dozeK && !floatK) hy += 0.3 * Math.sin(s * 0.33) * Math.sin(s * 0.11 + 1);
    if (nodT >= 0) { nodT += dt; if (nodT >= 0.7) nodT = -1; else hx += Math.sin((nodT / 0.7) * Math.PI) * 0.2; }
    mod.headGroup.rotation.set(hx, hy, hz);

    // arms: float = both paws on the tummy, tapping the clam with a stone; spy = the spyglass up to his eye; wave = the right arm waves; otherwise a gentle swing
    const tap = floatK * Math.max(0, Math.sin(s * 9)) * 0.28 * (Math.floor(time * 1.4) % 3 === 0 ? 0 : 1);
    mod.armL.rotation.set(-0.12 + floatK * (-1.0) - 0.1 * floatK * Math.sin(s * 1.4), 0, mod.armL.userData.restZ * (1 - floatK) - floatK * 0.35);
    const armRx = -0.1 * Math.sin(s * 1.1) + floatK * (-1.15 + tap) + spyK * -1.5 + waveK * -2.7 + dozeK * -0.15;
    mod.armR.rotation.set(repairBeat !== null ? -0.9 + 0.4 * Math.exp(-(repairBeat % HOP_COURSE.beat.period) * 15) : armRx, 0, mod.armR.userData.restZ * (1 - floatK - spyK) + waveK * (0.35 * Math.sin(s * 11) - 0.2) + spyK * -0.1);
    // the tail: a lazy swish, a paddle-flick while floating
    mod.tail.rotation.set(-0.1 * floatK + 0.08 * Math.sin(s * 1.5), 0.25 * Math.sin(s * (1.4 + 3 * floatK)), 0);

    // sound and words
    if (floatK > 0.8) {
      tok -= dt;
      if (tok <= 0) { tokN += 1; tok = tokN % 4 === 0 ? 2.2 : 0.55; if (tokN % 4 !== 0 && near && Math.hypot(near.x - position.x, near.z - position.z) < 14) snd('clink', { pitch: 0.55, vol: 0.18 }); if (tokN % 4 === 1 && near) say('tok tok', 1.0); }
    }
    if (dozeK > 0.8) { zT -= dt; if (zT <= 0) { zT = 3.2; say(((time / 3.2) | 0) % 2 ? 'Z' : 'z', 1.7); } }
  }

  // a small hop of joy (cheer)
  let hopV = 0, hopYv = 0;
  function hopY(dt) {
    if (hopT >= 0) {
      hopT += dt;
      hopV -= 22 * dt; hopYv += hopV * dt;
      if (hopYv <= 0) { hopYv = 0; hopV = 0; hopT = -1; }
    }
    return hopYv;
  }
  function cheer() {
    hopT = 0; hopV = 4.2; hopYv = 0.001; forced = null; cycleT = 0;
    say('Ahoy!', 2.1);
    snd('jingle', { pitch: 1.2, vol: 0.5 });
  }

  return Object.defineProperties(m, Object.getOwnPropertyDescriptors({
    update, talk, show, hide, cheer, say,
    ride(pose) { ride = pose ? { ...pose } : null; },
    get at() { return at; },
    setRepairBeat(t) { repairBeat = t; },
    setStayAwake(v) { stayAwake = !!v; },
    setRubyProvider(fn) { rubyRows = fn; },
    setRowProvider(fn) { rowProvider = typeof fn === 'function' ? fn : null; },
    get introSeen() { return heard; },
    resetIntro() { heard = false; try { localStorage.removeItem(INTRO_KEY); } catch { /* ignore */ } },
    get yaw() { return yaw; },
    get focus() { return focus; },
    summary() {
      let calls = 0;
      if (m.shown && m.group) m.group.traverse((o) => { if (o.isMesh && o.visible) calls += o.castShadow ? 2 : 1; });
      return {
        shown: m.shown, visible: !!(m.group && m.group.visible), idle: m.idle, x: +position.x.toFixed(2), y: +position.y.toFixed(2), z: +position.z.toFixed(2), yaw: +yaw.toFixed(2),
        floatK: +floatK.toFixed(2), sleepy: +sleepy.toFixed(2), collider: !!m.collider, interactable: !!m.interactable, drawCalls: calls, introSeen: heard, unlocked: boat.unlocked,
      };
    },
  }));
}
