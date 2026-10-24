// Bootstrap: renderer, scene, loop. Wires world, input, player and the fixed-angle follow camera together.
import { isEditorPreview, createPreviewLink } from './settings/previewRuntime.js';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VERSION, MOUSE_STEER, JUICE, EMBER_FX, MAX_PIXEL_RATIO, CAMERA_FOV, CAMERA_NEAR, CAMERA_FAR, INTERACT_RADIUS, CAMPFIRE, MAX_PLAYERS, ISLANDS, BRIDGES, DROP_HOLD, DUSK_CAMERA } from './config.js';
import { getHeight, getGroundType, isWalkable, regionOf, inlandDistance, setBridgeOpen, isBridgeOpen, getIslandModule, setNoclip, getNoclip, SPAWN } from './world/terrain.js';
import { createWater } from './world/water.js';
import { createSky } from './world/sky.js';
import { DayNight } from './world/dayNight.js';
import { createTimeDial } from './ui/timeDial.js';
import { createProps } from './world/props.js';
import { createRitualCircle } from './world/ritualCircle.js';
import { inRitualArea } from './world/islands/ritual.js';
import { createWorldVisuals } from './world/islandVisuals.js';
import { getColliders, resolveCircle } from './world/colliders.js';
import { getInteractables, findNearest } from './world/interactables.js';
import { InputManager } from './input/inputManager.js';
import { KeyboardSource } from './input/keyboardSource.js';
import { rayPlaneHit, steerFromHit } from './input/mouseSteer.js';
import { GamepadSource } from './input/gamepadSource.js';
import { PlayerManager } from './players/playerManager.js';
import { SlotTable } from './players/slotTable.js';
import { createPlayersDomain } from './net/playersDomain.js';
import { Avatars } from './net/avatars.js';
import { RemoteLink } from './net/remoteLink.js';
import { PeerLink } from './net/peerLink.js';
import { getTransport, getJoinCode } from './net/transport.js';
import { WorldSync, actorKey } from './net/worldSync.js';
import { createScreenLink } from './net/screenLink.js';
import { bindHostLink, bindReplicaLink } from './net/syncLinks.js';
import { setSaveEnabled } from './game/save.js';
import { createPlayerMemory } from './game/playerMemory.js';
import { clearTravelSpots } from './game/travelLogic.js';
import { standFront } from './game/storybookLogic.js';
import { createSyncStatus } from './ui/syncStatus.js';
import { RemoteSource } from './input/remoteSource.js';
import { TouchSource, wantsTouch } from './input/touchSource.js';
import { PairPanel } from './ui/pairPanel.js';
import { createHud } from './ui/hud.js';
import { Dialog } from './ui/dialog.js';
import { Particles } from './fx/particles.js';
import { createInteractions } from './world/interactions.js';
import { createItems } from './world/items.js';
import { createHarvest } from './world/harvest.js';
import { createPickups } from './world/pickups.js';
import { createGathering } from './world/gathering.js';
import { createCampfires } from './world/campfire.js';
import { createCampMenu } from './game/campMenu.js';
import { PATHS } from './config.js';
import { getPath, pathSummary, pathMarkers, pathPolylines } from './world/paths.js';
import { Inventory } from './game/inventory.js';
import { QuestLog } from './game/quests.js';
import { createQuestMenu } from './game/questMenu.js';
import { createCinematic } from './game/cinematic.js';
import { createFeastScene } from './game/feastScene.js';
import { createBridgeScene } from './game/bridgeScene.js';
import { createInventoryBar } from './ui/inventoryBar.js';
import { createBagPanel } from './ui/bagPanel.js';
import { createIslandTracker } from './ui/inventoryTracking.js';
import { CollectionLog } from './game/collection.js';
import { createJournalShowcase } from './world/journalShowcase.js';
import { COLLECT_LOOT } from './world/lootTable.js';
import { createBeachFinds } from './world/beachFinds.js';
import { createTravel } from './game/travel.js';
import { createDungeon } from './game/dungeon.js';
import { actionsWithCharmRouting } from './game/charms.js';
import { createRootgate } from './world/rootgate.js';
import { createCaveMouth } from './world/caveMouth.js';
import { createLavaMouth } from './world/lavaMouth.js';
import { createCombatProgress } from './game/combatSave.js';
import { registerArea } from './game/areaLogic.js';
import { TEST_AREA } from './game/areas/testYard.js';
import { createStorybook } from './game/storybook.js';
import { createParty } from './game/party.js';                   // Step 80a: Party Games (the Party Glade pocket, the `party` domain, bots, the lobby + Vine Skip + Timber Trim)
import { createQuestTracker } from './ui/questTracker.js';
import { getToolAction, toolReachBonus, rareChance } from './items/tools.js';
import { FollowCamera } from './camera/followCamera.js';
import { Sfx } from './audio/sfx.js';
import { Music } from './audio/music.js';
import { AmbienceAudio } from './audio/ambience.js';
import { createMuteButton } from './ui/muteButton.js';
import { createMusicButton } from './ui/musicButton.js';
import { createOptionsMenu } from './ui/optionsMenu.js';
import { createFullscreenPrompt } from './ui/fullscreenPrompt.js';
import { TitleCard } from './ui/titleCard.js';
import { createAmbient } from './fx/ambient.js';
import { createAtmosphere } from './fx/atmosphere.js';
import { duskFlora } from './world/islands/duskVisuals.js';
import { buildDuskPlacement } from './world/islands/duskPlacement.js';
import { buildDuskFlora } from './world/islands/duskFlora.js';
import { HATS } from './player/hats.js';
import { TAILS } from './player/tails.js';
import { GARLANDS } from './player/garlands.js';
import { createGarlandStand } from './world/garlandStand.js';
import { createHatRack } from './world/hatRack.js';
import { createTailStump } from './world/tailStump.js';
import { createNpcs } from './world/npcs.js';
import { createCritters } from './world/critters.js';
import { createFrostCamp } from './world/frostCamp.js';
import { createCampStages } from './world/campStages.js';
import { createGarden } from './world/garden.js';
import { createMossback } from './world/mossback.js';
import { createBoat } from './world/boat.js';              // Step 68a: Skipper Marlo's boat quest (the `boat` domain), its hop courses, the cove and the otter himself
import { createHopCourses } from './world/hopCourses.js';
import { createMarlo } from './world/marlo.js';
import { createCove } from './world/cove.js';
import { createBoatLookouts } from './world/boatLookouts.js';
import { createBoatVoyage } from './game/boatVoyage.js';
import { createBoatVoyageScene } from './game/boatVoyageScene.js';
import { createBoatSail } from './game/boatSail.js';              // Step 71: Set sail / Sail home between the Emberleaf and Duskcrown docks
import { createBoatSailScene } from './game/boatSailScene.js';
import { createDuskDock } from './world/duskDock.js';
import { duskDockLayout } from './world/islands/duskDock.js';
import { planDuskCrumbs } from './world/islands/duskCrumbs.js';       // Step 72b: the pickable glowcap clumps
import { createFishing } from './game/fishing.js';                 // Step 72a: fishing in the Glowcap Marsh (the `fishing` domain, the angler, the spot rings)
import { createFishingPlay } from './world/fishingPlay.js';
import { createFishingVisuals } from './world/fishingVisuals.js';
import { duskFishPonds, duskHearthLayout } from './world/islands/duskHearth.js';
import { lookoutLayout } from './world/islands/emberLookouts.js';
import { createBoatRepair } from './world/boatRepair.js';
import { createBoatParts } from './world/boatParts.js';
import { createTdoongz } from './world/tdoongz.js';
import { createPetsDomain } from './game/petsDomain.js';
import { createPets } from './world/pets.js';
import { createCapray } from './game/capray.js';                  // Step 73b: Capray's quest line "The Little Lantern" (the `capray` domain), its world side and the pet stable at the marsh hearth
import { createCaprayWorld } from './world/caprayWorld.js';
import { createPetStable } from './world/petStable.js';
import { duskCaprayPlan } from './world/islands/duskCapray.js';
import { PETS } from './npc/pets.js';
import { createSeeds } from './world/seeds.js';
import { createPlanting } from './world/planting.js';
import { createGardenMenu } from './game/gardenMenu.js';
import { createGardenStages } from './world/gardenStages.js';
import { createThoughtBubbles } from './ui/thoughtBubble.js';
import { createBridges } from './world/bridges.js';
import { mountExtensions } from './settings/bootstrap.js';

const app = document.getElementById('app');
const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
let extensions = null;

// ---- World sync (Step 22) + screens (Step 23). Every page is the world HOST by default; `?join=CODE` makes it a REPLICA ("screen") of room CODE:
// it renders the shared world and has its own local players and camera, but sends requests to the host and mirrors its events / snapshot
// instead of owning shared state, and it never saves (game/save.js switch). The phone join choice (controller.html) sends people here.
// The host also owns the 4 global player slots (players/slotTable.js, domain 'players'). See net/worldSync.js and PLAN.md "22a design notes".
const joinCode = isEditorPreview ? '' : getJoinCode();
const sync = new WorldSync({ role: joinCode ? 'replica' : 'host' });
const playerMemory = createPlayerMemory();
if (joinCode) setSaveEnabled(false);
else document.addEventListener('visibilitychange', () => sync.setHostAway(document.hidden));

// ---- Renderer
const coarse = isEditorPreview ? params.has('touch') : wantsTouch();
let pixelCap = isEditorPreview ? 1 : coarse ? Math.min(1.5, MAX_PIXEL_RATIO) : MAX_PIXEL_RATIO;
const renderer = new THREE.WebGLRenderer({ antialias: true, stencil: true });   // stencil: characters mark their visible pixels (occluded-player silhouette)
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, pixelCap));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
// Neutral keeps the pastel palette true to its hex values (ACES would darken and desaturate it).
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
// PCFSoftShadowMap was removed in recent three.js; PCFShadowMap is the soft-filtered one now.
renderer.shadowMap.type = THREE.PCFShadowMap;
app.appendChild(renderer.domElement);

// ---- Scene
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(CAMERA_FOV, window.innerWidth / window.innerHeight, CAMERA_NEAR, CAMERA_FAR);

// ---- World
const sky = createSky(scene);
if (coarse || isEditorPreview) sky.sun.shadow.mapSize.set(1024, 1024);
// The host's clock rules (PLAN Step 22b): a replica ignores ?time / ?daylock (and has no saved time), adopts the host's hour / lock / speed and eases toward it.
const dayNight = new DayNight({ params: joinCode ? new URLSearchParams() : params });
dayNight.attachSync(sync);
sky.setTimeOfDay(dayNight);
renderer.toneMappingExposure = dayNight.look.exposure;
const water = createWater();
scene.add(water.group);
water.setTimeOfDay(dayNight);
const props = createProps(scene);
const ritual = createRitualCircle(props.group);
// Terrain + props + far versions + bridge stubs of every island, and the region manager that picks full / far per island (Step 27b)
const worldVis = createWorldVisuals({ scene, camera, homeProps: props });
const terrain = worldVis.root;
const ambient = createAmbient({ scene, props, getHeight, clock: dayNight, campfire: CAMPFIRE });   // butterflies (day), fireflies (night), drifting petals, ocean glints
// Region atmosphere (Step 29a): snowfall + a cooler look while the view is on Frostpine, eased in / out across the bridge
const atmosphere = createAtmosphere({ scene, camera, sky, clock: dayNight, getHeight, view: () => worldVis.viewCentre() });
const sfx = new Sfx();                                        // WebAudio blips; wakes up on the first user gesture
if (isEditorPreview) { sfx.muted = true; sfx.unlock = () => false; }
const music = new Music(sfx);                                 // cycling procedural background tracks (starts after the first gesture)
// Impact duck stays on this screen and respects the music's current cinematic level.
sfx.musicImpact = () => music.impact(JUICE.sound.duck, JUICE.sound.duckTime);
music.setClock(dayNight);
const ambienceAudio = new AmbienceAudio(sfx, dayNight);

// ---- HUD, particles
const hudRoot = document.getElementById('hud');
hudRoot.classList.toggle('touch-host', coarse);
const hud = createHud(hudRoot);
const particles = new Particles(scene, { pool: 640, ground: getHeight });

// ---- Input devices. Each DEVICE drives its own player (see players/playerManager.js):
//   'local' = keyboard + host touch controls (an InputManager of its own), every gamepad, every phone controller.
// Phone controllers: PeerJS by default, or the local WebSocket relay with ?transport=ws.
const input = new InputManager();
const keyboard = input.addSource('keyboard', new KeyboardSource());
keyboard.attachMouse(renderer.domElement);
let touch = null;
if (coarse) touch = input.addSource('touch', new TouchSource(hudRoot));
const gamepad = new GamepadSource();
const link = isEditorPreview ? createPreviewLink() : getTransport() === 'ws' ? new RemoteLink() : new PeerLink();
const remote = new RemoteSource(link);
let screenLink = null;
if (joinCode) { screenLink = createScreenLink(joinCode); bindReplicaLink(sync, screenLink); }   // replica: the host of room CODE
else bindHostLink(sync, link);                                                                   // host: other pages that join this room become replicas

// ---- Players + camera. Every player (up to 4) has its own target / prompt, held item, swing and hits; P1 always exists.
const slotTable = new SlotTable(MAX_PLAYERS);          // the island's global player slots (host = authority, replica = the host's copy)
const players = new PlayerManager({
  scene, local: input, gamepads: gamepad, remote, hud, hudRoot, particles, sfx,
  localKind: touch ? 'phone' : 'keyboard', sync, table: slotTable,
});
let avatars = null;
createPlayersDomain({
  sync, table: slotTable,
  onChange: () => { players.slotsChanged(); avatars?.reconcile(); },
  hooks: { onFull: () => players.onFull?.() },     // (Step 80a: a person finds the island full: a party bot yields its seat at the next pick)
  spawnHint: () => {                        // where a player joining from another screen appears: near this (host) screen's group
    const l = players.list;
    if (!l.length) return null;
    return { x: l.reduce((s, p) => s + p.position.x, 0) / l.length, z: l.reduce((s, p) => s + p.position.z, 0) / l.length };
  },
});
players.on('join', () => { if (players.count === 1) followCam.snap(); });   // a joined screen's first player: the camera jumps to it
const player = players.p1;                // (debug handle only: the game logic below loops over players.list)
const followCam = new FollowCamera(camera, { sun: sky.sun });
followCam.regionCamera = DUSK_CAMERA;                       // Step 69c: Duskcrown's gentler camera, blended by atmosphere.duskWeight each tick
followCam.touch = coarse;
followCam.update(0, players.focus);       // snap to the players before the first frame
worldVis.snap();                          // regions from that first view: no far / full pop-in on the first frame

// ---- Shared inventory (one bag for every player, saved in localStorage; ?newgame resets) + its HUD bar (bottom-left; top-left under touch controls).
// floatText() shows the floating "+1 Apple" text at a world point, tinted with the collecting player's colour when several are playing; the systems
// that hand items out (pickups, gathering, campfire cooking) change the bag on the AUTHORITY (inventory.add) and call floatText on the screen of whoever
// got them. collect() (both in one) stays as a debug helper. On a replica inventory.add / remove are requests to the host (the bag mirrors the
// host's); see game/inventory.js.
const inventory = new Inventory();
inventory.attachSync(sync);
const invBar = createInventoryBar(hudRoot, inventory, { top: !!touch, onOpen: () => bagPanel.open() });
const islandTracker = createIslandTracker({ islands: ISLANDS, bridges: BRIDGES, regionAt: regionOf, inlandAt: inlandDistance });
let trackingKey = '';
let ritualMusicInside = false;
const localIsland = () => islandTracker.islandOf(players.list[0]) || 'home';
let sailRegion = () => null;                                  // Step 71: the crossing's music / ambience region (set once the sail scene exists)
music.region = () => {
  if (party.pageMode) return 'party';                          // Step 80a: the Party Glade's lobby track (a game forces its own: music.party)
  if (players.list.some((p) => dungeon.contains(p))) return 'dungeon';
  const crossing = sailRegion();
  if (crossing) return crossing;
  if (storybook.pageMode) return storybook.pageChapter === 'frostpine' ? 'page-frost' : storybook.pageChapter === 'emberleaf' ? 'page-ember' : 'page';        // Step 52a: the page track plays while a storybook page is open on this screen (Step 52b: Frostpine's pages have their own)
  const p = players.list[0]?.position;
  ritualMusicInside = !!p && inRitualArea(p.x, p.z, ritualMusicInside);
  return ritualMusicInside ? 'ritual' : localIsland();
};
ambienceAudio.region = localIsland;
// Step 37c: the waterfall's rushing loop gets louder the nearer the nearest player of this screen is to the plunge pool (0 beyond ~48 u, so it only ever plays on Emberleaf)
const fallsPool = getIslandModule('ember')?.falls?.data.pool;
ambienceAudio.waterfall = () => {
  if (!fallsPool) return 0;
  let d = 1e9;
  for (const p of players.list) d = Math.min(d, Math.hypot(p.position.x - fallsPool.x, p.position.z - fallsPool.z));
  const k = 1 - Math.min(1, Math.max(0, (d - 5) / 43));
  return k * k * (3 - 2 * k);
};
const tetherHints = new WeakMap();
players.on('tether', (p, other) => {
  const nearBridge = BRIDGES.some((b) => {
    const dx = b.bx - b.ax, dz = b.bz - b.az, l2 = dx * dx + dz * dz;
    const t = ((p.position.x - b.ax) * dx + (p.position.z - b.az) * dz) / l2;
    return t > -0.25 && t < 1.25 && Math.abs((p.position.x - b.ax) * dz - (p.position.z - b.az) * dx) / Math.sqrt(l2) < 4;
  });
  if (!nearBridge || simTime - (tetherHints.get(p) ?? -10) < 2.5) return;
  tetherHints.set(p, simTime); invBar.label(`Wait for ${other.colors.name}!`, { x: p.position.x, y: p.position.y + 2, z: p.position.z }, p.colors.ui);
});
let journalShowcase = null;                       // created once the avatars exist (below); finds only land after load
const collection = new CollectionLog({ onFound: (def, actor) => {
  if (def.source !== 'fish') journalShowcase?.show(def.id, actor);          // (a fish is shown by the catch flight in world/fishingPlay.js instead, once it has arrived in the angler's hand)
  hud.toast(`Journal: ${def.name}`, { icon: def.icon, duration: 3200 });
  const progress = collection.progress(def.island);
  if (progress.complete) hud.toast(`${ISLANDS.find((i) => i.id === def.island).name} album complete!`, { icon: 'sparkle', duration: 4000 });
  if (actor?.screen === sync.screenId) sfx.play('chime');
} });
collection.attachSync(sync);
const collectFind = (source, at, actor, toolKind = null) => {
  const island = regionOf(at.x, at.z);
  const base = COLLECT_LOOT[island]?.[source] || 0;
  collection.roll(island, source, actor && { screen: actor.screen, index: actor.index }, source === 'break' ? rareChance(base, toolKind) : base);
};
const floatText = (id, n, at, by = null) => invBar.float(id, n, at, by && players.multi ? by.colors.ui : null);
const collect = (id, n = 1, at = null, by = null) => {
  inventory.add(id, n);
  if (at) floatText(id, n, at, by);
};
// ground items that fly to whoever walks up to them; the authority path adds them to the bag (host), so only the floating text is injected
const pickups = createPickups({ scene, players, particles, sfx, sync, floatText });

// ---- Dialog, interactions. The dialog belongs to the player who opened it: only that player is frozen and drives it.
const dialog = new Dialog(document.getElementById('hud'), {
  onOpen: (d) => { if (d.owner) d.owner.frozen = true; if (!d.owner || d.owner.index === players.local.playerIndex) keyboard.releaseMouse(); touch?.widget.reset(); },
  onClose: (d) => { if (d.owner) d.owner.frozen = false; touch?.widget.reset(); },
  onChar: () => sfx.play('blip'),
  onMenu: (kind) => {                          // choice-menu sounds (campfire): move tick / select pop / back or denied bip
    if (kind === 'move') sfx.play('pop', { pitch: 1.3, vol: 0.5 });
    else if (kind === 'select') sfx.play('pop', { pitch: 0.9, vol: 0.7 });
    else sfx.play('bip', kind === 'denied' ? { pitch: 0.7 } : {});
  },
});
const interactions = createInteractions({ scene, players, hud, dialog, particles, sfx, pickups, sync, collectFind });
const items = createItems({ scene, players, particles, hud, sfx, sync, frost: worldVis.frost, ember: worldVis.ember });
avatars = new Avatars({ scene, hudRoot, players, table: slotTable, sync, items, sfx });
avatars.reconcile();
journalShowcase = createJournalShowcase({ scene, camera, players, avatars, sync, particles });
let hitStopT = 0;                                                     // real seconds of hit-stop left (the sim runs at ~8% speed meanwhile)
const harvest = createHarvest({                                       // chopping trees / breaking rocks (needs items for the swing)
  scene, players, items, particles, hud, sfx, interactions, props, pickups, camera: followCam, sync, extraTargets: [...worldVis.harvestables, ...ritual.stones],
  collectFind,
  hitStop: (s) => { hitStopT = Math.max(hitStopT, s); },
});
// berries, herbs, mushrooms, dig spots (must come after createInteractions: it wraps the bushes' rustle handler)
const gathering = createGathering({ scene, players, props, frost: worldVis.frost, ember: worldVis.ember, crumbs: planDuskCrumbs(), items, particles, hud, sfx, pickups, inventory, floatText, camera: followCam, sync, collectFind });
// the campfire: firepit + benches east of the spawn, fuel / fire levels, the choice menu (dialog) and cooking (needs the dialog + inventory)
const campfires = createCampfires({ scene, players, particles, hud, sfx, inventory, dialog, floatText, camera: followCam, sync });   // one per config FIRES entry (home + the Frostpine camp + the Emberleaf garden hearth)
const campfire = campfires.home;            // the home fire (debug / old code: __game.campfire)
// Shared progress per campfire; this screen tracks only the camera's stable ground region.
const quests = new QuestLog({ inventory });
quests.attachSync(sync);
const cameraIslandTracker = createIslandTracker({ islands: ISLANDS, bridges: BRIDGES, regionAt: regionOf, inlandAt: inlandDistance });
const cameraSubject = { position: followCam.focus };
cameraIslandTracker.update([cameraSubject]);
const questRegion = () => cameraIslandTracker.islandOf(cameraSubject) || 'home';
const questTracker = createQuestTracker(hudRoot, { quests, inventory, hud, sfx, region: questRegion, readyText: () => campfires.returnText(questRegion()) });
// A player leaving (its device stayed away for the grace period): its item drops where it stands and becomes a ground pickup,
// its pending chop is forgotten and, if it owns the dialog, the dialog closes. (Fires before the poof.)
players.on('leave', (p) => {
  items.dropFor(p);
  harvest.release(p);
  gathering.release(p);
  campfires.release(p);                      // cancels its toss / cooking (nothing is consumed); the dialog closing below unfreezes it
  if (dialog.isOpen && dialog.owner === p) dialog.close();
});

// ---- Pairing panel (freezes everybody while open) + link events
const pairPanel = new PairPanel(hudRoot, {
  controllerOnly: !!joinCode,                // a joined screen's phones can only be controllers of THIS screen
  canOpen: () => !dialog.isOpen && !cinematic.busy && !bagPanel.isOpen,
  onOpen: () => { players.frozenAll = true; keyboard.releaseMouse(); touch?.widget.reset(); },
  onClose: () => { players.frozenAll = false; },
});
// Shared cutscene stage (Step 28c): letterbox, HUD fade, camera override + ease-back, banner, music duck, held-Cancel skip. One cinematic runs at a time.
const cinematic = createCinematic({ camera, followCam, players, avatars, hud, hudRoot, music, dialog, pairPanel });
// The feast scene (cutscene) + the campfire menu rows that start a quest / the feast. It owns the camera and every player while it runs.
const feast = createFeastScene({
  scene, camera, followCam, players, avatars, slots: slotTable, hud, cinematic, campfires, particles, sfx, items, harvest, gathering, dialog, quests, tracker: questTracker, sync,
});
createQuestMenu({ quests, dialog, hud, sfx, campfires, feast });
// ---- Feast hats (Step 26): the hat rack beside the campfire appears after the first feast; touching it cycles the player's hat (world/hatRack.js)
const hatRack = createHatRack({
  scene, players, quests, sync, particles, sfx, hud,
  floatLabel: (text, at, by, icon) => invBar.label(text, at, by && players.multi ? by.colors.ui : null, icon),
});
// ---- Bridge builders (Step 28a): Cobble the mole and Bramble the beaver arrive at the old bridges after the first feast (world/npcs.js)
const npcs = createNpcs({
  scene, players, avatars, quests, sync, dialog, particles, sfx, hud, debugOpen: params.get('bridges') === 'open',
  floatLabel: (text, at, by, icon) => invBar.label(text, at, by && players.multi ? by.colors.ui : null, icon),
});
feast.setNpcs(npcs);
npcs.introScene = (id) => feast.replayArrival(id);
// ---- Bridge building (Step 28b): giving materials to the builders, the staged bridge meshes, the 'bridges' sync domain (world/bridges.js).
// ?bridges=open (debug, never saved) makes THIS page show both bridges finished and walkable without touching the shared state.
const bridges = createBridges({
  scene, players, quests, inventory, sync, npcs, dialog, hud, particles, sfx,
  floatLabel: (text, at, by, icon) => invBar.label(text, at, by && players.multi ? by.colors.ui : null, icon),
  debugOpen: params.get('bridges') === 'open',
});
// ---- Frostpine's hungry critters (Steps 34a / 34b): eight wild animals with a hint bubble; feed one (a request to the host: `critters` sync domain) and it moves into the camp
// (world/critters.js). The quest line opens once the Frostpine bridge is built (?bridges=open counts, like the deck).
const thoughts = createThoughtBubbles(hudRoot);
const critters = createCritters({
  scene, players, world: worldVis, thoughts, particles, sfx, sync, inventory, hud,
  floatLabel: (text, at, by, icon) => invBar.label(text, at, by && players.multi ? by.colors.ui : null, icon),
  isOpen: () => params.get('bridges') === 'open' || !!bridges.entry('frost')?.built,
});
// ---- Frostpine's camp jobs (Step 35a): the fire spirit's building quest line, its 'frostCamp' sync domain and the fire menu's "Camp jobs" rows (world/frostCamp.js, game/campMenu.js)
const frostCamp = createFrostCamp({
  players, critters, inventory, sync, campfires, dialog, hud, particles, sfx,
  floatLabel: (text, at, by, icon) => invBar.label(text, at, by && players.multi ? by.colors.ui : null, icon),
});
// ---- Tails (Step 36b): feasts held at the Frostpine camp unlock tails (critters living there + comfort); the carved stump shows them and lets a player try them on (world/tailStump.js)
const tailStump = createTailStump({
  scene, players, critters, camp: frostCamp, sync, world: worldVis, particles, sfx, hud,
  floatLabel: (text, at, by, icon) => invBar.label(text, at, by && players.multi ? by.colors.ui : null, icon),
});
feast.addReveal('frost', tailStump);
const campStages = createCampStages({ camp: frostCamp, campfires, critters, players, particles, sfx });     // Step 35b: the three build stages (windbreak + log benches, dens + crystal lanterns, grove shelter)
const campMenu = createCampMenu({ campfires, dialog, camp: frostCamp, inventory });     // Step 33b: the Frostpine fire spirit's intro; 35a: the real "Camp jobs" rows
npcs.setBridgeProvider((id) => bridges.entry(id));
// ---- Emberleaf's terrace garden (Step 37b): the 16 plots + the `garden` sync domain (world/garden.js) and Mossback the tortoise, who arrives with the Emberleaf bridge (world/mossback.js)
const garden = createGarden({ world: worldVis, sync, hud, clock: dayNight, inventory, slots: slotTable });
const mossback = createMossback({
  scene, players, avatars, world: worldVis, garden, dialog, particles, sfx, hud,
  floatLabel: (text, at, by, icon) => invBar.label(text, at, by && players.multi ? by.colors.ui : null, icon),
  isOpen: () => params.get('bridges') === 'open' || !!bridges.entry('ember')?.built,
});
// ---- The Tdoongz: host-synchronized island residents and rare gift visitors.
// Created after the island props and hubs have registered their route obstacles.
const tdoongz = createTdoongz({
  scene, players, avatars, world: worldVis, dialog, particles, sfx, sync, camera, clock: dayNight, inventory,
  floatLabel: (text, at, by, icon) => invBar.label(text, at, by && players.multi ? by.colors.ui : null, icon),
});
const seeds = createSeeds({ scene, players, items, garden, sync, hud, particles, sfx, world: worldVis, clock: dayNight, mossback });   // Step 38a: the eight seed finds (after createInteractions: it wraps the Moon Orchid tree's and the two flowers' handlers)
const planting = createPlanting({ players, garden, dialog, hud, sync, particles, sfx, mossback, floatText, world: worldVis });     // Step 38b: planting, tending, cuttings, "Fill a coconut" at the hot spring, the growth sparkles and Mossback's guidance
ambient.fireflies.gardenSpots = () => garden.bloomSpots();                  // fireflies gather over the garden's blooms at night
const gardenMenu = createGardenMenu({ garden, mossback, dialog, inventory });
const gardenStages = createGardenStages({ garden, mossback, players, particles, sfx, hud, floatLabel: (text, at) => invBar.label(text, at) });
const garlandStand = createGarlandStand({ scene, players, garden, sync, world: worldVis, particles, sfx, hud,
  floatLabel: (text, at, by, icon) => invBar.label(text, at, by && players.multi ? by.colors.ui : null, icon),
});
feast.addReveal('ember', garlandStand);
// ---- Skipper Marlo's boat (Step 68a): the first Emberleaf feast unlocks the cove (a second reveal on the same fire, after the garland stand's)
const boat = createBoat({ sync, hud, sfx, clock: dayNight, params });
feast.addReveal('ember', boat);
const boatVoyage = createBoatVoyage({ sync, boat, cinematic });
const hopCourses = createHopCourses({ scene, players, particles, sfx, world: worldVis, sync, hudRoot });
const marlo = createMarlo({ scene, players, avatars, world: worldVis, dialog, particles, sfx, boat, voyage: boatVoyage,
  floatLabel: (text, at, by, icon) => invBar.label(text, at, by && players.multi ? by.colors.ui : null, icon),
});
const cove = createCove({ scene, players, world: worldVis, boat, hop: hopCourses, particles, sfx, hud, marlo,
  floatLabel: (text, at, by, icon) => invBar.label(text, at, by && players.multi ? by.colors.ui : null, icon),
});
boat.setPartySize(() => players.list.filter(p => !p.away).length + avatars.list.filter(p => !p.away).length);
const boatRepair = createBoatRepair({ scene, players, avatars, world: worldVis, sync, boat, hop: hopCourses, cove, marlo, sfx, music, hud });
const boatParts = createBoatParts({ scene, players, avatars, world: worldVis, boat, hop: hopCourses, cove, particles, sfx, hud });
const boatLookouts = createBoatLookouts({ scene, boat, hop: hopCourses, players, world: worldVis, camera, followCam, clock: dayNight, cinematic, hud, hudRoot, sky });
const boatVoyageScene = createBoatVoyageScene({ scene, voyage: boatVoyage, boat, cove, cinematic, camera, players, avatars, world: worldVis, dialog, hud, marlo, sfx });
quests.setBridgeProvider((id) => (id === 'duskcrown' ? !!boat.state.discovered : !!bridges.entry(id)?.built));   // (Duskcrown's feast quests wait for the first arrival, Step 72b)
// ---- Combat areas (Step 56): the saved clears / Armory (`combat` domain), the Rootgate (Wildroot's entrance on the home island) and the area run itself
if (params.has('testarea')) registerArea(TEST_AREA);        // ?testarea: a synthetic four-section area (game/areas/testYard.js) to see gates / objectives / the ritual menu's extra row
const combat = createCombatProgress({ sync });
const rootgate = createRootgate({ scene, quests, sync, particles, sfx, hud, combat });
const caveMouth = createCaveMouth({ scene, sync, particles, sfx, combat });          // Step 59: Glimmerfrost Caves' entrance on Frostpine (always open once you can get there)
const lavaMouth = createLavaMouth({ scene, sync, particles, sfx, combat });          // Step 60: Cinder Tubes' entrance on Emberleaf's volcano flank (open once you can get there)
const dungeon = createDungeon({ scene, ritual, players, avatars, table: slotTable, items, inventory, sync, hud, hudRoot, dialog, camera: followCam, particles, sfx, cinematic, rootgate, caveMouth, lavaMouth, combat, viewCamera: camera,
  rumble: (p, ms, strength, settings) => {
    if (settings.shake === 'off') return;
    const scale = settings.shake === 'reduced' ? 0.5 : 1;
    if (p.device?.startsWith('phone:')) remote.sendTo(p.device.slice(6), { type: 'rumble', ms: Math.round(ms * scale), strength: strength * scale });
    if (p.device?.startsWith('pad:')) {
      const pad = navigator.getGamepads?.()[Number(p.device.slice(4))];
      try { pad?.vibrationActuator?.playEffect('dual-rumble', { duration: ms * scale, weakMagnitude: strength * scale, strongMagnitude: strength * scale * 0.6 })?.catch(() => {}); } catch (_) { /* unsupported */ }
    }
  },
  debugCharms: params.has('testcharm') ? ['spark'] : [],     // ?testcharm: the test charm Spark stands on the Armory rack (never part of a real Armory)
  charmUi: (p, show, frac) => { if (p.device === 'local') touch?.widget.setCharm(show, frac); else players.sendCharmUi(p, show, frac); } });   // the touch Charm button: host overlay or a phone
// Storybook Cay's pages (Step 48): the book stands open a page for the whole party (game/storybook.js: the `storybook` sync domain, the page fold, the side camera)
const storybook = createStorybook({ scene, camera, followCam, players, avatars, table: slotTable, sync, hud, hudRoot, dialog, particles, sfx, cinematic, world: worldVis, water, stands: worldVis.story.stands, items, inventory, music, critters });
const travel = createTravel({ scene, sync, players, avatars, table: slotTable, bridges, dialog, hud, particles, camera: followCam, cinematic, world: worldVis, canTravel: () => !dungeon.state.active && !storybook.state.active && !party.active, isDiscovered: () => boat.state.discovered });
// ---- Set sail (Step 71): Marlo's boat carries the whole roster between the Emberleaf dock and the Duskcrown dock (a host-timed ~20 s crossing; boat.at / boat.discovered are the saved `boat` state)
const duskDockLay = duskDockLayout();
const boatSail = createBoatSail({ sync, boat, cinematic, busy: () => dungeon.state.active || storybook.state.active || feast.busy || party.active, docks: { ember: lookoutLayout().dock, duskcrown: duskDockLay.prompt } });
const boatSailScene = createBoatSailScene({ scene, sail: boatSail, boat, cove, cinematic, camera, players, avatars, world: worldVis, hud, dialog, marlo, sfx, particles, heightAt: getHeight, layouts: { cove: cove.layout, dusk: duskDockLay },
  onArrive: () => { players.update(0); worldVis.snap(); atmosphere.snap(); followCam.regionBlend = atmosphere.duskWeight; followCam.snap(); followCam.update(0, players.focus); } });
sailRegion = () => boatSailScene.region();
// ---- Party Games (Step 80a): `__game.party.open()` or ?party moves the whole roster to the Party Glade for short minigames (bots fill empty seats); refused while a cutscene / feast / combat run / storybook page / crossing runs
const party = createParty({ scene, camera, followCam, players, avatars, table: slotTable, sync, hud, hudRoot, dialog, particles, sfx, music, items, world: worldVis, water, params, outfits: { hats: hatRack, tails: tailStump, garlands: garlandStand },
  busy: () => (dungeon.state.active ? 'combat' : storybook.state.active ? 'storybook' : boatSailScene.active ? 'crossing' : feast.busy ? 'feast' : cinematic.busy ? 'cinematic' : boatLookouts.active ? 'lookout' : null) });
let autoParty = params.has('party') && !joinCode ? party.optsFromParams(params) : null;
boatVoyageScene.setSail((to, p) => boatSailScene.ask(to, p));
const duskDock = createDuskDock({ scene, world: worldVis, boat, players, ask: (to, p) => boatSailScene.ask(to, p) });
const fishing = createFishing({ sync, ponds: duskFishPonds(), inventory, collection, rareBoost: () => capray.rareBoost });                                      // Step 72a: host-authoritative spots + cast / reel (session-only)
const fishingSpots = createFishingVisuals({ scene, fishing, world: worldVis });                                 // the ripple rings + fish shadows (one instanced draw)
const fishingPlay = createFishingPlay({ scene, fishing, players, avatars, items, sync, hud, sfx, particles, floatText, world: worldVis, showcase: journalShowcase });   // the angler: cast, nibbles, the press, the bobber + line
// ---- Pets (Step 73a): the `pets` unlock domain (host-saved) and the cosmetic followers every screen builds for its local players and remote avatars (world/pets.js); ?testpet = Capray unlocked, never saved
const petsDomain = createPetsDomain({ sync, params });
const pets = createPets({
  scene, players, avatars, sync, domain: petsDomain, clock: dayNight, atmosphere, storybook, dungeon, cinematic, particles, sfx, heightAt: getHeight,
  duskItems: () => worldVis.visuals.duskcrown?.data?.dusk?.placement.items || null, isSailing: () => boatSailScene.active,
});
// ---- Capray's quest line (Step 73b): the `capray` domain (host-saved in infinite-island.duskcrown.v1), the wild ray / shade moss / befriend scene (world/caprayWorld.js) and the pet stable by the marsh hearth
const caprayPlan = duskCaprayPlan();
const capray = createCapray({
  sync, plan: caprayPlan, inventory, fishing, pets: petsDomain, cinematic, params,
  heldKind: (key) => items.heldByKey(key)?.kind || null,
  positions: () => [
    ...players.list.map((p) => ({ key: actorKey(sync.actorFor(p)), x: p.position.x, z: p.position.z })),
    ...avatars.list.map((p) => ({ key: `${p.screen}:${p.index}`, x: p.position.x, z: p.position.z })),
  ],
});
const caprayWorld = createCaprayWorld({
  scene, players, avatars, world: worldVis, sync, capray, plan: caprayPlan, domain: petsDomain, pets, items, inventory, thoughts, particles, sfx, hud, dialog, cinematic, camera, floatText,
  heightAt: getHeight, flora: duskFlora, marlo,
});
const petStable = createPetStable({ scene, players, avatars, world: worldVis, domain: petsDomain, pets, dialog, particles, sfx, hud, heightAt: getHeight });
const beachFinds = createBeachFinds({ scene, collection, sync, world: worldVis });
// The bridge-opening cutscene (Step 28c): takes over the final stage of a bridge (hook of world/bridges.js) on every screen
const bridgeScene = createBridgeScene({ scene, camera, followCam, players, avatars, hud, cinematic, bridges, npcs, particles, sfx, sync, worldVis, dialog });
pairPanel.setControllers(players.phones());
players.on('change', () => pairPanel.setControllers(players.phones()));   // roster / phone -> player changes
link.on('room', (code) => pairPanel.setRoom(code));
if (joinCode) createSyncStatus(hudRoot, { sync, code: joinCode, hud });
link.on('controller-connected', () => {
  hud.toast('Phone controller connected!', { icon: 'phone' });
  sfx.play('chime');
});
link.on('controller-disconnected', () => {
  // a phone that was playing gets its own "P2's phone disconnected" toast from the PlayerManager
  if (link.connected && !players.phones().some((p) => p.label)) hud.toast('Phone controller disconnected', { icon: 'phone' });
});
const targets = new Map();              // Player -> its nearest interactable this tick (drives that player's prompt bubble)
const prompts = [];
const dropHolds = new Map();
const dropRings = new Map();
const dropPoint = new THREE.Vector3();
function updateDropRings(dt) {
  for (const p of players.list) {
    let ring = dropRings.get(p);
    if (!ring) {
      ring = document.createElement('div');
      ring.className = 'drop-hold-ring';
      hudRoot.appendChild(ring);
      dropRings.set(p, ring);
    }
    if (party.pageMode) { dropHolds.delete(p); ring.hidden = true; continue; }          // Step 80a: tools are tucked away for the party
    const fight = dungeon.contains(p) ? dungeon.chargeView(p) : null;   // Step 54: inside a run the ring shows the charge / big-special hold, and Cancel never drops a tool
    if (dungeon.contains(p)) {
      dropHolds.delete(p);
      ring.hidden = !fight || cinematic.active || p.away;
      if (!ring.hidden) {
        dropPoint.set(p.position.x, p.position.y + 2.15, p.position.z).project(camera);
        ring.style.left = `${(dropPoint.x * 0.5 + 0.5) * window.innerWidth}px`;
        ring.style.top = `${(-dropPoint.y * 0.5 + 0.5) * window.innerHeight}px`;
        ring.style.background = `conic-gradient(${fight.ready ? '#ffd23f' : p.colors.ui} ${fight.frac * 360}deg, #ffffff99 0)`;
      }
      continue;
    }
    const blocked = cinematic.active || pairPanel.isOpen || optionsMenu.isOpen || bagPanel.isOpen || dialog.isOpen || p.away || p.frozen;
    const inPage = storybook.contains(p);                  // (inside a storybook page only a PAGE tool can be put back; a real tool leaves with you: Step 50)
    if (blocked || !items.heldBy(p) || (inPage && !items.pageToolOf(p)) || !p.actions.cancelHeld) {
      dropHolds.delete(p);
      ring.hidden = true;
      continue;
    }
    const hold = dropHolds.get(p) || { t: 0, fired: false };
    hold.t += dt;
    if (hold.t >= DROP_HOLD && !hold.fired) { hold.fired = true; if (inPage) storybook.dropPageTool(p); else items.dropHeld(p); }
    dropHolds.set(p, hold);
    ring.hidden = hold.t < 0.3 || hold.fired;
    if (!ring.hidden) {
      dropPoint.set(p.position.x, p.position.y + 2.15, p.position.z).project(camera);
      ring.style.left = `${(dropPoint.x * 0.5 + 0.5) * window.innerWidth}px`;
      ring.style.top = `${(-dropPoint.y * 0.5 + 0.5) * window.innerHeight}px`;
      ring.style.background = `conic-gradient(${p.colors.ui} ${Math.min(360, hold.t / DROP_HOLD * 360)}deg, #ffffff99 0)`;
    }
  }
  for (const [p, ring] of dropRings) if (!players.list.includes(p)) { ring.remove(); dropRings.delete(p); dropHolds.delete(p); }
}
const isLive = (t) => getInteractables().includes(t);   // false once somebody picked the item up / felled the tree this tick

// ---- Sound: mute button + M key (persisted by Sfx), title card
const muteButton = createMuteButton(hudRoot, sfx);
sfx.onChange((muted) => {
  hud.toast(muted ? 'Sound off' : 'Sound on', { icon: muted ? 'muted' : 'speaker', duration: 1500 });
  if (!muted) sfx.play('pop');
});
window.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyM' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target && e.target.tagName;
  if (t === 'INPUT' || t === 'TEXTAREA') return;
  sfx.unlock();
  sfx.toggleMute();
});
// ---- Music (Step 16): N toggles the music only (M still mutes everything); a music-note button sits next to the speaker
const musicButton = createMusicButton(hudRoot, music, sfx);
const optionsMenu = createOptionsMenu(hudRoot, { musicButton, muteButton, pairPanel, hud, touch, juice: dungeon.juice, onFriends: () => (party.active ? hud.toast('Not during the party!', { icon: 'sparkle', duration: 1800 }) : travel.showFriends()), onJournal: () => bagPanel.journal() });
const bagPanel = createBagPanel(hudRoot, {
  inventory, islands: ISLANDS, collection, dungeon, players, storybook,
  unlocked: (id) => id === 'home' || !!bridges.entry(id)?.built, region: questRegion,
  canOpen: () => !dialog.isOpen && !pairPanel.isOpen && !cinematic.busy && !party.pageMode,
  onOpen: () => { optionsMenu.close(); players.frozenAll = true; keyboard.releaseAll(); touch?.widget.reset(); },
  onClose: () => { players.frozenAll = false; keyboard.releaseAll(); touch?.widget.reset(); },
});
dungeon.setBookOpener((p) => bagPanel.open(p));
// Step 80: the ritual portal's "Party Glade" row opens a party (host screen only: a party is the host's to start, like the debug flag)
dungeon.setPartyOpener(() => {
  if (!sync.isHost) { hud.toast('Only the host screen can start a party', { icon: 'sparkle', duration: 2400 }); return; }
  const r = party.open();
  if (r && r.reject) hud.toast(`No party right now (${r.reject})`, { icon: 'sparkle', duration: 2400 });
});
window.addEventListener('keydown', (e) => {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || !['Tab', 'KeyB'].includes(e.code)) return;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target?.tagName) || e.target?.isContentEditable) return;
  if (party.active) return;   // the Bag stays shut during a party (kids' kiosk)
  e.preventDefault(); bagPanel.toggle();
});
const timeDial = createTimeDial(hudRoot, { clock: dayNight });
hud.joinButton.addEventListener('click', () => { pairPanel.open(); hud.joinButton.blur(); });
// The keyboard player's roster chip has a leave button in local multiplayer (any key rejoins; see PlayerManager.leaveLocal)
hud.onLeave = () => { if (!cinematic.busy && !pairPanel.isOpen) players.leaveLocal(); };
// A controller that took over P1 shares it with the keyboard; J (or the chip's split button) gives the keyboard its own player (splitLocal)
const splitLocal = () => { if (!cinematic.busy && !pairPanel.isOpen && !bagPanel.isOpen) players.splitLocal(); };
hud.onSplit = splitLocal;
window.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyJ' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target?.tagName) || e.target?.isContentEditable) return;
  splitLocal();
});
music.on('enabled', (on) => {
  hud.toast(on ? 'Music on' : 'Music off', { icon: on ? 'music' : 'musicOff', duration: 1500 });
  if (on) sfx.play('pop', { pitch: 1.2, vol: 0.6 });
});
window.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyN' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target && e.target.tagName;
  if (t === 'INPUT' || t === 'TEXTAREA') return;
  sfx.unlock();
  music.toggle();
});
music.start();
const title = new TitleCard(hudRoot, { duration: 2.6 });
// Phones / tablets: offer a one-tap fullscreen (or an Add-to-Home-Screen tip on iPhone) once the title card is gone.
if (touch && !isEditorPreview) createFullscreenPrompt(hudRoot, { hud, delay: 3 });
window.addEventListener('pointerdown', () => title.dismiss(), { passive: true });

let controls = null;
if (DEBUG) {
  // ?debug: free OrbitControls camera (the player can still be moved with the keyboard).
  followCam.enabled = false;
  camera.position.set(0, 58, 92);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.5, -2);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.maxDistance = 220;
  controls.update();
}

// ---- Resize
let lastW = 0, lastH = 0, lastDpr = 0, lastWindowW = 0, lastWindowH = 0;
function onResize() {
  const preview = extensions?.bridge.getViewportSize();
  const w = preview?.width ?? window.innerWidth, h = preview?.height ?? window.innerHeight;
  lastWindowW = window.innerWidth; lastWindowH = window.innerHeight;
  followCam.touch = preview?.touch ?? coarse;
  if (!w || !h) return;                 // hidden / minimised: keep the previous size until we get a real one
  lastW = w; lastH = h; lastDpr = window.devicePixelRatio || 1;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, pixelCap));   // re-read DPR: it changes when the window moves between monitors
  renderer.setSize(w, h);
  followCam.resize(w, h);
}
window.addEventListener('resize', onResize);
onResize();

// ---- Automatic quality fallback: if the average frame time stays above 25 ms for 3 s, drop to pixelRatio 1 and a
// 1024 shadow map (once). Disabled with ?hq. Samples are skipped while the tab is hidden or right after load (shader compiles).
const quality = { level: coarse ? 'medium' : 'high', avgMs: 0, lowered: false };
let qWarm = 2.5, qAcc = 0, qFrames = 0;
function lowerQuality() {
  quality.lowered = true;
  quality.level = 'low';
  pixelCap = 1;
  renderer.setPixelRatio(1);
  const shadow = sky.sun.shadow;
  shadow.mapSize.set(1024, 1024);
  if (shadow.map) { shadow.map.dispose(); shadow.map = null; }
  followCam.setShadowMapSize(1024);
  // Small ground details do not need a shadow receive pass on struggling devices.
  for (const name of ['mushrooms', 'herbs', 'flowers-', 'grass-tufts', 'lily-pads', 'reeds']) {
    props.group.traverse((m) => { if (m.isMesh && m.name.startsWith(name)) m.receiveShadow = false; });
  }
  console.info(`[quality] avg frame ${quality.avgMs.toFixed(1)} ms > 25 ms: lowered to pixelRatio 1 + 1024 shadow map`);
}
function monitorPerf(rawDt) {
  if (quality.lowered || params.has('hq') || document.hidden) return;
  if (qWarm > 0) { qWarm -= Math.min(rawDt, 0.25); return; }
  if (rawDt > 0.5) return;                       // a pause (hidden tab, breakpoint), not a slow frame
  qAcc += rawDt; qFrames++;
  if (qAcc >= 3) {
    quality.avgMs = (qAcc / qFrames) * 1000;
    if (quality.avgMs > 25) lowerQuality(); else { qAcc = 0; qFrames = 0; }
  }
}

// ---- Held-mouse steering: one ray, scratch objects and a single hidden-until-used ring.
const mouseRay = new THREE.Raycaster();
const mouseNdc = new THREE.Vector2();
const mouseHit = { x: 0, y: 0, z: 0 };
const mousePlayer = { px: 0, pz: 0 }, mouseTarget = { hx: 0, hz: 0 };
const mouseOptions = { dead: MOUSE_STEER.dead, side: false }, mouseAxes = { x: 0, y: 0 };
const mouseRing = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.28, 32),
  new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide }));
mouseRing.rotation.x = -Math.PI / 2;
mouseRing.visible = false;
scene.add(mouseRing);
function mouseBlocked() {
  const p = players.get(players.local.playerIndex);
  return !!extensions?.isOpen || players.frozenAll || p?.frozen || cinematic.busy || bagPanel.isOpen || pairPanel.isOpen ||
    (dialog.isOpen && (!dialog.owner || dialog.owner === p));
}
// Reject presses during a block even if the menu closes before the next poll.
renderer.domElement.addEventListener('pointerdown', () => {
  if (keyboard.mouseHeld && mouseBlocked()) keyboard.releaseMouse();
});
function clearMouseFeedback() {
  mouseRing.visible = false;
  renderer.domElement.classList.remove('mouse-steering');
}
keyboard.setSteer((x, y) => {
  mouseAxes.x = mouseAxes.y = 0;
  if (mouseBlocked()) { keyboard.releaseMouse(); return mouseAxes; }
  const p = players.get(players.local.playerIndex);
  const c = renderer.domElement;
  if (!p || !c.clientWidth || !c.clientHeight || !Number.isFinite(camera.aspect) || camera.aspect <= 0 ||
      !camera.projectionMatrixInverse.elements.every(Number.isFinite) || !camera.matrixWorld.elements.every(Number.isFinite)) return mouseAxes;
  mouseNdc.set(x / c.clientWidth * 2 - 1, 1 - y / c.clientHeight * 2);
  mouseRay.setFromCamera(mouseNdc, camera);
  const side = storybook.pageMode;
  if (side) {
    // The side camera looks parallel to the floor; intersect the player's page plane instead.
    const o = mouseRay.ray.origin, d = mouseRay.ray.direction;
    const t = (p.position.z - o.z) / d.z;
    if (Math.abs(d.z) < 1e-8 || !Number.isFinite(t) || t < 0) return mouseAxes;
    mouseHit.x = o.x + d.x * t; mouseHit.y = p.position.y; mouseHit.z = p.position.z;
  } else if (!rayPlaneHit(mouseRay.ray.origin, mouseRay.ray.direction, p.position.y, mouseHit)) return mouseAxes;
  mousePlayer.px = p.position.x; mousePlayer.pz = p.position.z;
  mouseTarget.hx = mouseHit.x; mouseTarget.hz = mouseHit.z;
  mouseOptions.side = side; mouseOptions.dead = side ? MOUSE_STEER.sideDead : MOUSE_STEER.dead;
  steerFromHit(mousePlayer, mouseTarget, mouseOptions, mouseAxes);
  if (mouseAxes.x || mouseAxes.y) {
    mouseRing.position.set(mouseHit.x, mouseHit.y + 0.035, mouseHit.z);
    mouseRing.visible = MOUSE_STEER.ring;
  }
  return mouseAxes;
});

// ---- Simulation tick: input -> world actions -> player/camera -> fx -> HUD. Shared by the rAF loop and __game.step.
let simTime = 0;
const _fadePts = [], _fadePool = [];
function tick(realDt) {
  // hit-stop: a brief near-freeze on tool impacts (real time counts down, the simulation crawls)
  let dt = realDt;
  if (hitStopT > 0) { hitStopT -= realDt; dt = realDt * 0.08; }
  simTime += dt;
  if (!keyboard.mouseHeld) clearMouseFeedback();
  sync.update(dt);                            // world sync timers: grace period of a screen that left (host), request timeouts (replica)
  if ((joinCode && (sync.status !== 'synced' || sync.hostAway)) || (!joinCode && sync.hostAway)) return; // keep rendering the last good frame while the host is unavailable
  const visualClock = extensions?.bridge.beforeFrame(dt) || dayNight;
  dayNight.update(dt);
  sky.setTimeOfDay(visualClock);
  atmosphere.update(dt, simTime, renderer.domElement.height);   // region look after the clock: Frostpine / Emberleaf tint, Duskcrown canopy + spores (last frame's view is fine)
  water.setTimeOfDay(visualClock, atmosphere.waterWeight);
  renderer.toneMappingExposure = visualClock.look.exposure;
  storybook.lightPage(sky, renderer, dayNight);   // inside a storybook page: night stays readable (an illustration, not a dark island)
  party.light(sky, renderer);                    // the Party Glade: its own bright fixed light (or the night stage's), whatever the hour
  dungeon.lightArea(sky, renderer);              // inside a cave: its own fixed light and dark background, whatever the hour (config AREA_LIGHT)
  extensions?.bridge.afterLighting();
  campfires.setNightness(visualClock.nightness);
  timeDial.update(visualClock);
  clearMouseFeedback();
  if (mouseBlocked()) keyboard.releaseMouse();   // also runs while keys override the mouse
  party.preInput(dt);                         // Step 80a: the party bots decide and press (their BotSources) before the devices are polled
  players.pollInput(dt);                      // every device -> claims / leaves -> per-player actions
  if (extensions?.isOpen) for (const p of players.list) {
    if (p !== player) continue;
    p.actions.move.x = p.actions.move.z = 0;
    for (const key of Object.keys(p.actions)) if (typeof p.actions[key] === 'boolean') p.actions[key] = false;
  }
  renderer.domElement.classList.toggle('mouse-steering', keyboard.mouseHeld);
  for (const p of players.list) actionsWithCharmRouting(p.actions, dungeon.contains(p));   // Step 58: outside combat areas Charm is a second Jump
  storybook.preInput();                       // inside a page the strip only runs left / right
  if (autoParty && simTime > 0.6) { const r = party.open(autoParty); autoParty = null; Promise.resolve(r).then((x) => { if (x && x.ok === false) hud.toast(`The party cannot start: ${x.reason}`, { icon: 'sparkle', duration: 3000 }); }); }
  // Gamepad buttons are user activations too: let them wake the audio context.
  if (players.gamepadPressed) sfx.unlock();
  if (!title.done && players.activity) title.dismiss();
  // every active, free player finds its own nearest interactable (all before anybody acts, so two players can want the same one)
  targets.clear();
  const scripted = cinematic.active || boatLookouts.active;          // a cutscene (feast, bridge opening) owns everybody: no targets, prompts or interactions meanwhile
  if (scripted) bagPanel.close();
  for (const p of players.list) {
    if (scripted || p.away || p.frozen || players.frozenAll) continue;               // away / dialog owner / pair panel: no target, no prompt
    const held = items.heldBy(p), reachBonus = toolReachBonus(held?.kind);
    let t = findNearest(p.position, INTERACT_RADIUS + reachBonus,
      (it) => dungeon.allowsTarget(it) && storybook.allowsTarget(it) && party.allowsTarget(it)
        && (it.type !== 'ritualstone' || !!getToolAction(held, it))
        && (it.type !== 'pond' || getToolAction(held, it) === 'fish')           // Step 72a: a pond is a target only for a Glowline Rod (no prompt clutter while walking the marsh)
        && (Math.max(0, Math.hypot(p.position.x - it.position.x, p.position.z - it.position.z) - it.radius) <= INTERACT_RADIUS
          || ['chop', 'break'].includes(getToolAction(held, it))));
    if (t && (t.type === 'sign' || t.type === 'campfire' || t.type === 'npc' || t.type === 'tdoong' || t.type === 'plot' || t.type === 'bookstand' || t.type === 'pageexit' || t.type === 'stable') && dialog.isOpen) t = null;   // the sign / campfire / NPC menu is busy: show nothing for the others
    if (t && t.type === 'campfire' && campfires.busy(p)) t = null;
    if (t) targets.set(p, t);
  }
  if (bagPanel.isOpen) {
    if (players.list.some((p) => p.actions.cancelPressed || p.actions.menuPressed)) bagPanel.close();
    else bagPanel.drive(players.list.map((p) => p.actions.move), dt, players.list.map((p) => p.actions));
  } else if (!scripted && !party.pageMode && players.list.some((p) => p.actions.menuPressed && !p.away) && !pairPanel.isOpen && !optionsMenu.isOpen) {
    bagPanel.open(players.list.find((p) => p.actions.menuPressed && !p.away)); // gamepad Start / the phone pad's Bag button (canOpen waits out dialogs)
  } else if (pairPanel.isOpen) {
    const anyCancel = players.list.some((p) => p.actions.cancelPressed);     // any player's Cancel closes the panel
    if (anyCancel) sfx.play('bip');
    pairPanel.handleInput(false, anyCancel);                                 // panel swallows the presses
  } else if (optionsMenu.isOpen) {
    if (players.list.some((p) => p.actions.cancelPressed)) optionsMenu.close();
  } else if (!scripted) {
    for (const p of players.list) {                                          // P1 first, so it wins a same-frame race
      const a = p.actions;
      if (dialog.isOpen && dialog.owner === p) {                             // only the owner's buttons drive the dialog
        if (!dialog.isMenu) {                                                // (choice menus play their own move / select / back sounds)
          if (a.cancelPressed) sfx.play('bip');
          else if (a.interactPressed || a.jumpPressed) sfx.play('pop', { pitch: 0.8, vol: 0.6 });
        }
        dialog.handleInput(a.interactPressed || a.jumpPressed, a.cancelPressed, a.move.z);   // Jump confirms too (Step 47: Space moved from Interact to Jump)   // move.z = the owner's stick / d-pad / WS / arrows (up = negative): menu rows
        continue;
      }
      if (p.away || p.frozen) continue;
      let t = targets.get(p);
      if (t && !isLive(t)) t = null;                                         // somebody else just took it: this press does nothing there
      const held = items.heldBy(p);
      if (party.contains(p)) {                                               // Step 80a: the Party Glade: the Game Board is the only target; the game's own press, Ready and the kiosk exit are party.drive
        if (a.interactPressed && t && (t.type === 'partyboard' || t.type === 'partydress')) interactions.interact(t, p);
        party.drive(p, a, dt);
        continue;
      }
      if (storybook.contains(p)) {                                           // a storybook page (Step 49): the body runs and jumps by itself; Interact closes the book at the ribbon, otherwise it and Cancel are
                                                                             // the held tool / grab & throw (Step 50: game/pageTools.js, run by storybook.updatePlayers)
        if (a.interactPressed && t && t.type === 'pageexit') interactions.interact(t, p);
        continue;
      }
      if (dungeon.contains(p)) {                                             // Step 54: Interact = attack (hold = charge), Jump = the dodge-hop, Cancel = the weapon special (Provisions: the Bag)
        const picked = a.interactPressed && t && (t.type === 'item' || t.type === 'dungeonexit' || t.type === 'brazier' || t.type === 'charmpedestal') && !dungeon.downed(p);
        if (picked) interactions.interact(t, p);
        dungeon.drive(p, a, dt, !picked);
        continue;
      }
      if (fishingPlay.isFishing(p)) {                                        // Step 72a: a line is out: Interact is THE press (a nibble scares the fish), Cancel reels in
        if (a.interactPressed) fishingPlay.press(p); else if (a.cancelPressed) fishingPlay.cancel(p);
        continue;
      }
      if (a.interactPressed && t) {
        const toolAction = getToolAction(held, t);
        if (toolAction === 'fish') fishingPlay.cast(p, t.pond);
        else if (toolAction === 'chop' && t.type === 'shademoss') caprayWorld.clearMoss(t, p);                                  // Step 73b: an axe / sword / saber on a titan's shade moss: swing now, the host counts the hit at the impact frame
        else if (toolAction === 'dig') (t.type === 'seeddig' ? seeds.dig(t, p) : gathering.dig(t, p));                       // shovel on a dig spot: plunge now, the soil flies at the impact frame
        else if (toolAction) harvest.hit(t, p);                              // chop / break: swing now, the hit lands at the impact frame
        else if (interactions.interact(t, p)) hud.suppressPrompt(0.7, p.index);
      } else if (a.interactPressed && held) {
        items.swing(p);                                                      // nothing in range: swing the held item
      } else if (a.cancelPressed || a.jumpPressed) {                         // Jump (Step 47) and Cancel both hop; only Cancel's 2 s hold drops a tool
        interactions.cancel(p);
      }
    }
  }
  storybook.updatePlayers(dt, simTime);       // inside a page the players are platformer bodies (game/pagePlayers.js): they move BEFORE the characters animate
  players.update(dt);                         // movement, tether, soft push between players
  items.update(dt, simTime);
  party.afterItems();                         // the held tools stay tucked away while the party runs
  dungeon.update(dt, simTime);
  storybook.update(dt, simTime);              // the page fold, entering / leaving a storybook page, keeping the party on the lane
  party.update(dt, simTime);                  // Step 80a: the party's clock (host), the curtain, phases, HUD, bots
  avatars.update(dt, camera);
  journalShowcase.update(dt);
  storybook.afterAvatars();                   // remote page players: floor probe for the blob shadow, hidden while a dandelion puff
  avatars.separateLocal(dt);
  party.afterAvatars();                       // Step 80d: authoritative puffballs / seats override pose interpolation and soft separation
  players._updateFocus();
  harvest.update(dt);
  gathering.update(dt);
  campfires.update(dt, camera, renderer.domElement.height);  // every fire: fuel, flames / embers, toss + cooking tasks, floating status; then the shared light + crackle
  hatRack.update(dt);                         // pop-in / pop-onto-peg animations
  rootgate.update(dt, simTime);               // the Rootgate's brambles shrinking away after the first feast
  caveMouth.update(dt, simTime);              // the cave mouth's mist and its trophy's pop-in
  lavaMouth.update(dt, simTime);              // the lava-tube mouth's glow, rising embers and its trophy's pop-in
  tailStump.update(dt);                       // the tail stump's pop-in (only drawn while Frostpine is)
  npcs.update(dt);                            // builders: arrival pop, facing, idle / work / cheer
  frostCamp.update(dt);                       // the camp jobs' delayed spirit line
  seeds.update(dt, simTime, camera, renderer.domElement.height);   // Step 38a: seed cues (glints, night glows, dusk fireflies) + the dig swings' impact
  tdoongz.update(dt, dayNight.nightness);     // host roaming / visitor timers everywhere; render only islands in full detail
  mossback.update(dt, dayNight.nightness);    // Mossback: the bridge gate, dozing / waking, slow facing, idle and sleepy animation (only while Emberleaf is drawn)
  campStages.update(dt);                      // the camp's build moments (pieces dropping in)
  gardenStages.update(dt);
  garlandStand.update(dt);
  boatParts.update(dt, camera);             // Step 68e: + the camera (the sail trunk / compass headland dither out while they cover a local player)
  cove.update(dt);                            // the cove's dressing, the plank bundle and Biscuit's flight
  boatRepair.update(dt);
  marlo.setStayAwake(boat.state.floated && !boat.state.launched);
  marlo.update(dt, dayNight.nightness);       // repair supplies this tick's shared beat before Marlo animates
  hopCourses.update(dt);                      // hop-course pads that move, the next-pad glint, the splash fade
  critters.update(dt, dayNight.nightness);    // Frostpine's critters: roaming, hint hop + thought bubble, animations, sleeping at night (only while Frostpine is drawn)
  bridges.update(dt, dayNight.nightness);     // bridge build moments, segment pop-ins, lantern glow
  pickups.update(dt);                         // after the players moved: walk-over magnets
  if (party.pageMode) party.updateCamera(dt);                           // the Party Glade: a fixed stage camera per place
  else if (storybook.pageMode) storybook.updateCamera(dt);              // inside a storybook page: the narrow side camera frames the party on the strip
  else { followCam.regionBlend = atmosphere.duskWeight; followCam.update(dt * dungeon.juice.presentationScale, players.focus, players.cameraZoom(followCam)); }   // presentation slow motion never changes input or combat time (Duskcrown: followCam.regionBlend = the region weight)
  players.updateRegroup(dt, camera, { followCam, blocked: party.pageMode || storybook.pageMode || cinematic.busy || boatLookouts.active || pairPanel.isOpen || bagPanel.isOpen || optionsMenu.isOpen });   // off screen 3.5 s -> pop back to a teammate
  updateDropRings(dt);
  cinematic.update(dt);                       // eases the camera back to the follow view after a cutscene
  feast.update(dt);                           // the feast scene (cutscene): overrides the player poses + camera while it runs
  boatVoyageScene.update(dt);
  boatSailScene.update(dt); duskDock.update(dt);       // Step 71: the crossing (it owns the camera while it runs) and Duskcrown's dock
  pets.update(dt);                            // Step 73a: the pets follow their owners (after the crossing placed the crew's visuals)
  capray.update(); caprayWorld.update(dt); petStable.update(dt);   // Step 73b: the host's befriend-scene timing, the wild ray / moss / scene (it owns the camera while the scene runs) and the pet stable
  fishing.update(dt); fishingPlay.update(dt, simTime); fishingSpots.update(dt, simTime);   // Step 72a: the host's spot schedule, this screen's anglers (after players / items), the spot rings
  boatLookouts.update(dt);
  bridgeScene.update(dt);                     // the bridge-opening scene (Step 28c), same contract
  cameraIslandTracker.update([cameraSubject]);
  questTracker.update(dt);
  travel.update(); beachFinds.update(simTime);
  const tracked = islandTracker.update(players.list);
  rememberPlayers();
  music.updateRegion();
  const trackedQuest = quests.activeFor(questRegion());
  const nextTrackingKey = [...tracked.islands].sort().join(',') + ':' + questRegion() + ':' + (trackedQuest?.id || '');
  if (trackingKey !== nextTrackingKey) {
    trackingKey = nextTrackingKey;
    invBar.setTracking(tracked.islands, trackedQuest?.needs || {});
  }
  if (!cinematic.busy) for (const id of tracked.arrivals) hud.toast(ISLANDS.find((i) => i.id === id).name, { icon: 'sparkle', duration: 2800 });
  players.updateFx(dt, camera);               // rings + name tags (after the camera moved)
  interactions.update(dt);
  invBar.update(dt, camera);                  // floating "+1 Apple" texts follow the camera
  thoughts.update(dt, camera);                // the critters' thought bubbles
  dialog.update(dt);
  particles.update(dt * dungeon.juice.presentationScale, camera, renderer.domElement.height);
  prompts.length = 0;                         // one bubble per player, tinted + glyph per its device when several are playing
  for (const p of players.list) {
    const t = targets.get(p);
    if (storybook.contains(p) && !(t && t.type === 'pageexit')) {          // a storybook page: "Take axe" / "Chop" / "Grab (Cancel)" ... (game/pageTools.js)
      const pr = p.away || p.frozen ? null : storybook.promptFor(p);
      if (pr) prompts.push({ key: p.index, target: pr.target, text: pr.text, button: pr.button, source: p.actions.activeSource, color: p.colors.ui, label: p.colors.name });
      continue;
    }
    if (!t || !isLive(t)) continue;
    if (fishingPlay.isFishing(p)) continue;                                  // Step 72a: while a line is out the bobber is the prompt
    const toolAct = getToolAction(items.heldBy(p), t);
    prompts.push({
      key: p.index, target: t, text: toolAct === 'chop' ? (t.type === 'shademoss' ? 'Clear' : 'Chop') : toolAct === 'break' ? 'Break' : toolAct === 'dig' ? 'Dig' : toolAct === 'strike' ? 'Strike' : toolAct === 'fish' ? 'Cast' : null,
      source: p.actions.activeSource, color: p.colors.ui, label: p.colors.name,
    });
  }
  hud.update(dt, { camera, multi: players.multi, prompts });
  // ambient visuals (advance with the tick so __game.step drives them too)
  title.update(dt);
  water.update(simTime);
  props.update(simTime);
  ritual.update(simTime, dayNight.nightness);
  for (const m of props.handles.mushrooms) m.material.emissiveIntensity = dayNight.nightness * (0.33 + 0.07 * Math.sin(simTime * 2 + m.position.x));
  sky.update(dt, camera);
  worldVis.update(simTime);                   // region visibility from the view centre (after every camera move above) + the volcano smoke
  {                                           // Step 69c: Duskcrown's canopy fade: giant caps over a local player, or between the camera and one, dither out (duskFade.js)
    _fadePts.length = 0;
    for (const p of players.list) { const q = _fadePool[_fadePts.length] || (_fadePool[_fadePts.length] = { x: 0, y: 0, z: 0 }); q.x = p.position.x; q.y = p.position.y + 1.1; q.z = p.position.z; _fadePts.push(q); }
    duskFlora.update(dt, camera.position, _fadePts);
  }
  for (const p of players.list) {
    if (getGroundType(p.position.x, p.position.z) !== 'hotspring') { p.userDataSpringAt = 0; continue; }
    if (simTime >= (p.userDataSpringAt || 0)) {
      p.userDataSpringAt = simTime + EMBER_FX.sparkleInterval;
      particles.burst('sparkle', { x: p.position.x, y: p.position.y + 0.7, z: p.position.z }, { count: 3, radius: 0.5, speed: 0.35, color: '#c7fff1' });
    }
  }
  ambient.duskWeight = atmosphere.duskWeight;
  ambient.calm = atmosphere.calm || dungeon.underground || party.pageMode;   // (no night fireflies in a cave)
  // Party presets own the life; island fireflies otherwise re-enable their Points at night.
  if (!party.pageMode) ambient.update(dt, simTime, players.focus, camera, renderer.domElement.height);
  ambienceAudio.update(dt);
  if (mouseBlocked()) keyboard.releaseMouse();   // a menu or scene can start during this tick
  if (!keyboard.mouseHeld) clearMouseFeedback();
}

// ---- Loop
// THREE.Clock is deprecated in recent three.js; THREE.Timer is its replacement (same getDelta/getElapsed idea).
const clock = new THREE.Timer();
function frame() {
  clock.update();
  const rawDt = clock.getDelta();
  if (extensions?.bridge.comparisonOpen) {
    if (link.screens.size || link.controllers.size) tick(Math.min(rawDt, 0.1));
    requestAnimationFrame(frame); return;
  }
  monitorPerf(rawDt);
  // Cheap safety net besides the resize event (mobile URL bars, DPR changes, panes that were hidden at load).
  if (window.innerWidth !== lastWindowW || window.innerHeight !== lastWindowH || (window.devicePixelRatio || 1) !== lastDpr) onResize();
  tick(Math.min(rawDt, 0.1));
  if (controls) controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Expose for debugging. `step` advances player + camera deterministically (handy when rAF is throttled).
console.info(`Infinite Island v${VERSION}`);

// Debug: scripted random action storm for two-tab sync checks, see net/syncStress.js. (Loaded on demand; nothing runs otherwise.)
sync.stress = (opts) => import('./net/syncStress.js').then((m) => m.runStress(opts));

// Debug (Step 26): __game.hats.list = hat names; set(player, i) puts on hat i silently (-1 = default beanie, 0..9 = HATS[i]; saved like a rack choice);
// cycle(player) = what the rack does; preview(n) pretends n hats are unlocked (null = real count; never saved, never touches quests.feasts);
// unlocked = the current count; rack.summary() = state of the rack + who wears what.
const hats = {
  list: HATS.map((h) => h.name),
  set(p, i) { hatRack.wear(p, i, false); return p.character.hat; },
  cycle: (p) => hatRack.cycle(p),
  preview: (n) => hatRack.preview(n),
  get unlocked() { return hatRack.unlocked; },
  rack: hatRack,
};

// Debug (Steps 36a / 36b): __game.tails.list = tail names (species-major: fox, squirrel, rabbit, grouse x levels 1-3); set(player, i) puts tail i on a player (-1 = none; saved per
// screen like the stump does, silently); preview(i) puts it on P1 without saving or syncing. unlocked = the unlocked indices, evaluate() = what the unlock rule would give right now
// (nothing is unlocked), unlock(i | [i]) / unlockAll() / reset() = host-path debug unlocks (saved + synced, no fanfare), cycle(player) = the stump's action, stump = the stump (summary()).
const tails = {
  list: TAILS.map((t) => t.name),
  set(p, i) { tailStump.wear(p, i, false); return p.character.back; },
  preview(i) { return players.p1.wearTail(i); },
  get unlocked() { return tailStump.unlocked; },
  evaluate: () => tailStump.evaluate(),
  unlock: (i) => tailStump.debug.unlock(i),
  unlockAll: () => tailStump.debug.unlockAll(),
  reset: () => tailStump.debug.reset(),
  cycle: (p = players.p1) => tailStump.cycle(p),
  stump: tailStump,
};

// Debug (Step 73b): __game.capray.{summary(), stage(n) = jump to the START of stage n (host debug request), feed() = the offering the ray wants now (bag and range ignored), clearMoss(i), shake(i) (the moss is cleared first when needed),
// befriend() = straight to the Lanternkoi and the scene, reset(), goto('pond' | 'titan0' | 'titan1' | 'titan2' | 'stable'), plan, state, world (caprayWorld), api (the domain), ask(p) = the "Bring Capray along?" question}. ?testcapray = no saved progress read or written.
const caprayDebug = {
  summary: () => ({ ...capray.summary(), world: caprayWorld.summary(), stable: petStable.summary(), plan: caprayPlan.summary() }),
  get state() { return capray.state; },
  stage: (n) => capray.debug.stage(n), feed: () => capray.debug.feed(), clearMoss: (i) => capray.debug.clear(i), shake: (i) => capray.debug.shake(i), befriend: () => capray.debug.befriend(), reset: () => capray.debug.reset(),
  goto: (where = 'pond') => world.goto(where === 'pond' ? 'duskCapray' : where === 'stable' ? 'duskStable' : `dusk${where[0].toUpperCase()}${where.slice(1)}`),
  ask: (p = players.p1) => caprayWorld.ask(p),
  plan: caprayPlan, world: caprayWorld, stable: petStable, api: capray,
};
// Debug (Step 73a): __game.pets.{list (names), unlocked, unlock(id), reset(), set(player, id | null) = bring a pet (saved per screen, must be unlocked), preview(id) = Capray on P1 for a look (not unlocked / saved),
// summary(), api}. ?testpet = Capray unlocked and never saved. unlock / reset are the host-path debug unlocks (saved + synced).
const petsDebug = {
  get list() { return PETS.map((p) => p.name); },
  get unlocked() { return petsDomain.unlocked; },
  unlock: (id = 'capray') => petsDomain.unlock(id),
  reset: () => petsDomain.reset(),
  set: (p, id) => pets.set(typeof p === 'number' ? players.list.find((a) => a.index === p) : p, id, { fx: false }),
  preview: (id = 'capray', p = players.p1) => { pets.debug.preview(id, p); return pets.summary(); },
  summary: () => pets.summary(),
  api: pets, domain: petsDomain,
};

// Archipelago debug hooks (Step 27a; Step 27b extends this). goto(id) teleports this screen's players to a walkable spot on that island
// (home: the spawn; the others: a few units inland of the bridge landing) and snaps the follow camera.
function islandSpot(id) {
  if (id === 'ritual') return { x: -48, z: 45 };
  if (id === 'home') return { x: SPAWN.x, z: SPAWN.z };
  if (id === 'emberGarden') {                              // Step 37a: a few units south of the garden hearth, on the bottom tier's side (the camera side)
    const f = campfires.get('ember');
    return f ? { x: f.position.x + 0.4, z: f.position.z + 5.4 } : null;
  }
  if (id === 'emberFalls' || id === 'emberLedge') {         // Step 37c: beside the plunge pool (the west bank, the way onto the ledge) / on the ledge behind the falling water
    const f = getIslandModule('ember')?.falls;
    if (!f) return null;
    return id === 'emberLedge' ? { x: f.data.ledgeSpot.x, z: f.data.ledgeSpot.z } : f.toWorld(42.4, 4.6);
  }
  if (id === 'frostCamp') {                                // Step 33b: a few units south of the Frostpine camp fire (the camera side)
    const f = campfires.get('frost');
    return f ? { x: f.position.x + 0.4, z: f.position.z + 5.2 } : null;
  }
  if (id === 'story' || id === 'storyBook') {              // Step 48: the book stand's front (the hub: where a reload, or leaving a page, puts you)
    const s = worldVis.story && worldVis.story.stands[0];
    return s ? standFront(s, 0) : null;
  }
  if (id === 'duskPond') {
    const mod = getIslandModule('duskcrown'), island = ISLANDS.find((i) => i.id === 'duskcrown');
    return buildDuskFlora(island, mod).pondSpot;
  }
  if (id === 'duskGrove' || id === 'duskTitans') {         // Step 69c: the densest mushroom grove / below the cliff-foot titans
    const m = getIslandModule('duskcrown'), isl = ISLANDS.find((i) => i.id === 'duskcrown');
    return m && isl ? buildDuskPlacement(isl, m).spots[id === 'duskGrove' ? 'grove' : 'titans'] : null;
  }
  if (id === 'duskHearth') { const f = duskHearthLayout().fire; return { x: f.x + 0.4, z: f.z + 5.4 }; }   // Step 72a: a few units south of the marsh hearth (the camera side)
  if (id === 'duskCapray' || id === 'duskStable' || /^duskTitan[0-2]$/.test(id)) {                  // Step 73b: the home pond's shore (a little back from the feeding spot), the pet stable (hearth side), a shade-moss titan (pond side)
    if (id === 'duskCapray') { const f = caprayPlan.feed, p = caprayPlan.pond, dx = f.x - p.x, dz = f.z - p.z, d = Math.hypot(dx, dz) || 1; return { x: f.x + (dx / d) * 1.4, z: f.z + (dz / d) * 1.4 }; }
    if (id === 'duskStable') { const s = duskHearthLayout(), dx = s.fire.x - s.stable.x, dz = s.fire.z - s.stable.z, d = Math.hypot(dx, dz) || 1; return { x: s.stable.x + (dx / d) * 5.6, z: s.stable.z + (dz / d) * 5.6 }; }
    const t = caprayPlan.titans[Number(id.slice(-1))], p = caprayPlan.pond;
    if (!t) return null;
    const dx = p.x - t.x, dz = p.z - t.z, d = Math.hypot(dx, dz) || 1, r = t.collR + 2.0;
    return { x: t.x + (dx / d) * r, z: t.z + (dz / d) * r };
  }
  if (id === 'duskDock') return duskDockLayout().arrive[0];          // Step 71: the beach by Marlo's pier (where the boat lands the party, and where a reload on Duskcrown puts it)
  if (id === 'duskcrown' || id === 'duskLanding' || id === 'duskLagoon' || id === 'duskCliff' || id === 'duskWest') {   // Step 69a: debug-only; the island has no bridge or travel entry
    const s = getIslandModule('duskcrown')?.spots?.();
    return s ? s[id === 'duskcrown' ? 'duskLanding' : id] : null;
  }
  const br = BRIDGES.find((b) => b.to === (id === 'storyLanding' ? 'story' : id));
  if (!br) return null;
  const dx = br.bx - br.ax, dz = br.bz - br.az, L = Math.hypot(dx, dz);
  for (let d = 8; d >= 0; d -= 2) {                       // inland of the landing, falling back to the landing itself
    const x = br.bx + (dx / L) * d, z = br.bz + (dz / L) * d;
    if (isWalkable(x, z)) return { x, z };
  }
  return { x: br.bx, z: br.bz };
}
const world = {
  islands: ISLANDS, regionOf, setBridgeOpen, isBridgeOpen,
  regions: worldVis.regions, visuals: worldVis.visuals, summary: () => worldVis.summary(),
  ember: worldVis.ember,
  frost: worldVis.frost,                               // Frostpine gameplay data: placement, sampleSpots({ area, count, seed }) (29b hook), summary()
  rebuild: (id) => worldVis.rebuild(id),               // dispose + rebuild one island's visuals (draw calls / colliders / hashes must not change)
  goto(id) {
    if (typeof id === 'string' && (id === 'party' || id.startsWith('party:'))) { Promise.resolve(id === 'party' ? party.open({}) : party.play(id.slice(6))); return true; }      // Step 80a
    const spot = islandSpot(id);
    if (!spot) return false;
    players.list.forEach((p, i) => p.teleport(spot.x + (i % 2) * 1.6, spot.z + Math.floor(i / 2) * 1.6));
    if (typeof id === 'string' && id.startsWith('dusk')) for (const p of players.list) { p.facing = Math.PI; p.root.rotation.y = Math.PI; }   // (Step 69a: face north, up the marsh, at the cliff)
    followCam.snap();
    followCam.update(0, players.focus);
    if (controls) {
      controls.target.set(spot.x, getHeight(spot.x, spot.z), spot.z);
      camera.position.set(spot.x, getHeight(spot.x, spot.z) + 20, spot.z + 20);
      controls.update();
    }
    worldVis.snap();                                        // far / full right now, so the first frame on the new island has no pop-in
    atmosphere.snap();
    followCam.regionBlend = atmosphere.duskWeight; followCam.snap(); followCam.update(0, players.focus);   // Step 69c: the Duskcrown camera right away
    return true;
  },
};

// ?bridges=open (debug only, never saved) is handled by createBridges (debugOpen): finished bridges, open decks, shared state untouched.

// Debug (Step 69a): Duskcrown Isle is reached only from here. `?duskcrown` stands the local players on its landing beach (facing north) at load; __game.world.goto('duskcrown' | 'duskLanding' |
// 'duskLagoon' | 'duskCliff' | 'duskWest' | 'duskGrove' | 'duskTitans' | 'duskPond'). __game.dusk = { summary(), layout, ponds, noclip(on), light(on), lid(on), mushrooms(), flora(), fade(on), settle() }: noclip(true) makes every point of the island walkable (cliff, plateau top, deep water; heights
// follow the terrain) so it can be inspected on foot, noclip(false) restores; `?debug` adds OrbitControls for an overview. Nothing here is saved (playerMemory ignores the zone).
const getDuskData = () => worldVis.visuals.duskcrown?.data?.dusk;
const duskDebug = {
  light(on = true) { return atmosphere.light(on); },
  lid(on = true) { return atmosphere.duskFx.lid(on); },
  get layout() { return getIslandModule('duskcrown').layout; },
  get ponds() { return getIslandModule('duskcrown').ponds; },
  noclip(on = true) { setNoclip(on ? 'duskcrown' : null); return getNoclip() !== null; },
  mushrooms() { return { ...(getDuskData()?.summary() || {}), visuals: worldVis.summary().islands.duskcrown?.dusk, fade: duskFlora.enabled, items: getDuskData()?.placement.items }; },   // Step 69c: counts, colliders, per-chunk instances, the fade state
  flora() { const d = getDuskData(); return { ...d?.flora.summary(), colliders: d?.floraColliders.length, visuals: worldVis.summary().islands.duskcrown?.duskSmall }; },
  fade(on = true) { duskFlora.enabled = !!on; return duskFlora.enabled; },                           // canopy fade on / off, for comparison
  settle() { const pts = players.list.map((p) => ({ x: p.position.x, y: p.position.y + 1.1, z: p.position.z })); return duskFlora.settle(camera.position, pts); },   // jump to the final fade at once (screenshots)
  summary() {
    const m = getIslandModule('duskcrown'), isl = ISLANDS.find((i) => i.id === 'duskcrown'), d = m.measure();
    return { ...d, atmosphere: atmosphere.summary(), lid: atmosphere.duskFx.mesh.visible, spores: atmosphere.duskFx.spores.visible, id: isl.id, x: isl.x, z: isl.z, noclip: getNoclip() !== null, ponds: m.ponds.length, plateauTop: m.plateauTop, regionNow: worldVis.regions.summary(), spots: m.spots() };
  },
};
const DUSK_FLAG = params.has('duskcrown');

// Debug (Step 33b): __game.paths.summary() = every trail (length, samples), get(id) = the built path (island-local samples), markers(id) = its lantern posts
// (world x / z), lanes(islandId) = the thin polylines props keep clear of, list = config PATHS; __game.campMenu = the fire spirit's intro memory (seen / reset).
const paths = {
  list: PATHS, summary: pathSummary, get: getPath,
  markers: (id) => { const p = getPath(id); const isl = ISLANDS.find((i) => i.id === p.island); return pathMarkers(isl, p).map((m) => ({ x: +m.x.toFixed(2), z: +m.z.toFixed(2) })); },
  lanes: (islandId) => pathPolylines(ISLANDS.find((i) => i.id === islandId)),
};

// Debug (Steps 34a / 34b): __game.critters.{list, summary(), get(id), goto(id) = teleport P1 beside it (2 u east: south of it the player would hide it from the camera),
// play(id, anim), feed(id, {force = true}) = feed through the host path (force skips the gate + bag, `{force:false}` is the real rule), reset() = everybody back to the wild,
// state, api}.
const critterDebug = {
  list: critters.list, summary: () => critters.summary(), get: (id) => critters.get(id), api: critters, thoughts,
  feed: (id, opts) => critters.debug.feed(id, opts), reset: () => critters.debug.reset(),
  get state() { return critters.state; },
  play: (id, anim) => { const c = critters.get(id); return c ? c.play(anim) : false; },
  goto(id) {
    const c = critters.get(id);
    if (!c) return false;
    player.teleport(c.position.x + 2.0, c.position.z + 0.3);
    followCam.snap();
    followCam.update(0, players.focus);
    worldVis.snap();
    atmosphere.snap();
    return true;
  },
};

// Debug (Step 35a): __game.camp.{summary(), give(item, n) = add n of an item to the current camp job through the host path (skips the gate and the bag), setComfort(n) = jump silently,
// reset(), onStage(fn) = the 35b hook (fn(comfort, {live})), state, comfort, api}.
const campDebug = {
  summary: () => frostCamp.summary(), give: (item, n) => frostCamp.debug.give(item, n), setComfort: (n) => frostCamp.debug.setComfort(n), reset: () => frostCamp.debug.reset(),
  onStage: (fn, opts) => frostCamp.onStage(fn, opts), api: frostCamp, stages: campStages,
  get state() { return frostCamp.state; }, get comfort() { return frostCamp.comfort; },
};

// Debug (Step 37b): __game.garden.{summary(), goto(dx, dz) = teleport P1 to Mossback's spot (+ an offset, default 3 u south), setPlot(i, stage = 'bloom', flower = 'preview') = show a plot as empty | sprout | bud | bloom through
// the host (syncs), setStage(n) = the garden stage (opens plots), reset(), state, api, mossback}.
const gardenDebug = {
  summary: () => garden.summary(), setPlot: (i, stage, flower) => garden.debug.setPlot(i, stage, flower), setStage: (n) => garden.debug.setStage(n), reset: () => garden.debug.reset(),
  get state() { return garden.state; }, api: garden, mossback, seeds, stages: gardenStages, menu: gardenMenu,
  give: (item, n) => garden.debug.give(item, n),
  findSeed: (id) => garden.debug.findSeed(id),                                   // Step 38a: find a seed through the host, ignoring the time of day / tool / distance
  // Step 38b (all ask the host, so they work from any screen): plant(i, flower, kind = 'seed' | 'cutting') plants it (its seed counts as found and unused), tend(i) wakes a planted seed without using the bag,
  // grow(nights = 1) grows every plant through that many whole nights (dusk, night, dawn), bloomAll() opens everything planted, cutting(i) takes a bloom's cutting; planting = the screen module (spring, fill(player))
  plant: (i, flower, kind) => garden.debug.plant(i, flower, kind), tend: (i) => garden.debug.tend(i), grow: (n) => garden.debug.grow(n), bloomAll: () => garden.debug.bloomAll(), cutting: (i) => garden.debug.cutting(i), planting,
  seedSpots: () => seeds.summary().spots,                                         // where each seed is found (world x, y, z) and whether it was
  gotoSeed(id) {                                                                   // teleport P1 beside a seed spot
    const at = seeds.standPoint(id);
    if (!at) return false;
    player.teleport(at.x, at.z);
    followCam.snap();
    followCam.update(0, players.focus);
    worldVis.snap();
    atmosphere.snap();
    return true;
  },
  goto(dx = 0.3, dz = 3) {
    player.teleport(mossback.position.x + dx, mossback.position.z + dz);
    followCam.snap();
    followCam.update(0, players.focus);
    worldVis.snap();
    atmosphere.snap();
    return true;
  },
};

// Debug (Step 72a): __game.fishing.{summary(), spots, spawn(pond, kind), give(p) = pick up a rod, cast(p) = cast at the nearest pond, bite(p) = jump the angler's clock to just before the next bite window,
// catch(p, fish) = a host catch, goto(pondId) = stand at that pond's bank, force() = the host judges the next reel a catch, play, visuals, api}
const fishingDebug = {
  summary: () => ({ ...fishing.summary(), play: fishingPlay.summary(), layer: fishingSpots.summary() }),
  get spots() { return fishing.spots; },
  get ponds() { return fishing.ponds; },
  spawn: (pond, kind = 'common') => fishing.debug.spawn(pond, kind),
  give: (p = players.p1) => items.equip('rod', p),
  cast(p = players.p1, pondId = null) {
    const pond = pondId ? fishing.pond(pondId) : fishing.ponds.map((q) => ({ q, d: Math.hypot(q.x - p.position.x, q.z - p.position.z) / Math.min(q.rx, q.rz) })).sort((a, b) => a.d - b.d)[0]?.q;
    return !!pond && fishingPlay.cast(p, pond);
  },
  press: (p = players.p1) => fishingPlay.press(p),
  bite(p = players.p1) { const d = fishingPlay.skipToBite(p); if (d > 0) fishing.advance(d); return d; },
  catch: (p = players.p1, fish = 'glimmerfin') => fishing.debug.catch(p, fish),
  force: () => fishing.debug.bite(),
  goto(pondId) {
    const pond = fishing.pond(pondId) || fishing.ponds[0], f = duskHearthLayout().fire, dx = f.x - pond.x, dz = f.z - pond.z, len = Math.hypot(dx, dz) || 1;
    const mod = getIslandModule('duskcrown'), r = Math.max(pond.rx, pond.rz) * 1.12 + 0.6;
    const at = mod.nearestWalkable(pond.x + dx / len * r, pond.z + dz / len * r) || { x: pond.x, z: pond.z + r };
    players.list.forEach((p, i) => { p.teleport(at.x + (i % 2) * 1.2, at.z + Math.floor(i / 2) * 1.2); p.faceToward(pond.x, pond.z); });
    followCam.snap(); followCam.update(0, players.focus); worldVis.snap();
    return { x: at.x, z: at.z, pond: pond.id };
  },
  play: fishingPlay, visuals: fishingSpots, api: fishing,
};

// Debug (Step 68d): sight/sightAll/voyage/hull; goto nest/look0/look1/look2/dock. Repair.finishRepair/nail/seal/float/endFloat; goto also accepts hull/seep/deck. __game.boat.{summary(), unlock(), take(part), reset(), goto('sail' | 'rudder' | 'compass' | 'cove' | 'stone-1' ... any pad id of the tide-pool course | 'goal'), state, api, marlo, cove, hop}. `?testboat` = unlocked (not saved). The host's debug requests sync.
const boatDebug = {
  ...boat.debug, marlo, cove, repair: boatRepair, courses: boatParts, hop: hopCourses, api: boat,
  // Step 71: sail('duskcrown' | 'ember', { skip }) starts a crossing now (host debug: no distance / dock-side check) and skips it at once with { skip: true }; at = where the boat is; sailScene / dock / sailApi for probes
  sail: (to = 'duskcrown', { skip = false } = {}) => { const r = boatSail.debug(to); if (skip && r?.ok) boatSail.skip(); return r; }, get at() { return boat.state.at; }, sailScene: boatSailScene, dock: duskDock, sailApi: boatSail,
  voyage: () => boatVoyage.request(player), hull: state => cove.previewHull(state), lookouts: boatLookouts, voyageScene: boatVoyageScene,
  get state() { return boat.state; },
  goto(where = 'cove') {
    const partStart = boatLookouts.goto(where) || (where === 'hull' ? boat.layout.marks[0] : where === 'seep' ? boat.layout.seep : where === 'deck' ? boat.layout.deck : null) || boatParts.start(where);
    const L = cove.layout, pad = L.course.pads.find((p) => p.id === (where === 'goal' ? L.course.goal : where));
    const at = partStart || (pad ? { x: pad.x, z: pad.z } : where === 'goal' ? { x: L.goal.x, z: L.goal.z } : where === 'marlo' ? L.frame.to(-1.0, -3.4) : { x: L.frame.to(1.2, -1.6).x, z: L.frame.to(1.2, -1.6).z });
    player.teleport(at.x, at.z);
    if (partStart || pad) player.position.y = (partStart || pad).top;
    followCam.snap();
    followCam.update(0, players.focus);
    worldVis.snap();
    atmosphere.snap();
    return at;
  },
};

// Debug (Step 64a-d): __game.tdoongz.{summary(), get(id), list, goto(id, dx = 0.3, dz = 3) = teleport P1 next to a friend, lineup() / release(), play(id, kind: 'pat' | 'peek' | 'earflop' | 'twirl' | 'show' | 'wave' | 'wag' | 'sniff' | 'shake' | 'scratch' | 'sit' | 'surprise' | 'look' | 'flutter' | 'wiggle' | 'nibble'), talk(id, player), api}.
const tdoongzDebug = {
  summary: () => tdoongz.summary(), get: (id) => tdoongz.get(id), get list() { return tdoongz.list; }, play: (id, kind) => tdoongz.play(id, kind), talk: (id, p = players.p1) => tdoongz.talk(id, p), api: tdoongz,
  goto(id, dx = 0.3, dz = 3) {
    const f = tdoongz.get(id);
    if (!f) return false;
    player.teleport(f.position.x + dx, f.position.z + dz);
    followCam.snap();
    followCam.update(0, players.focus);
    worldVis.snap();
    atmosphere.snap();
    return true;
  },
  // Steps 64b-d: lineup() stands every friend in a row 2.4 u behind P1, facing the camera, and holds them still for visual inspection (play(id, kind) still works); release() resumes wandering
  lineup() {
    const ids = tdoongz.lineup(players.p1.position);
    followCam.snap();
    followCam.update(0, players.focus);
    worldVis.snap();
    atmosphere.snap();
    return ids;
  },
  release: () => tdoongz.release(),
};

// Debug (Step 80a): __game.party = { open({ mode: 'random' | 'party' | 'pick', games: [ids], rounds, bots: 'fill' | 0..3, difficulty: 'easy' | 'normal' | 'hard' }), close(), play(id) (open + the next game is this one), next() (to the next pick), skip() (one phase on),
// toggle(id, on), enabled(), games(), bots(n | 'fill', difficulty), summary(), state, domain, ui, debug: { win(slot), end(), seed(n), glade(), stage(id) } }. ?party[&mode=&games=&bots=&difficulty=&rounds=] opens one at load (host only);
// __game.world.goto('party') opens the party, goto('party:vineskip' | 'party:timber' | 'party:marlosays' | 'party:huddle' | 'party:sizzle' | 'party:eggs' | 'party:feastround' | 'party:bumpers' | 'party:glowcap' | 'party:cast' | 'party:tilty' | 'party:bonk') plays that game. Leave with party.close() or hold Cancel + Interact on the keyboard for 3 s.
const partyDebug = party;

window.__game = {
  version: VERSION, party: partyDebug, dusk: duskDebug, boat: boatDebug, tdoongz: tdoongzDebug, hats, tails, pets: petsDebug, capray: caprayDebug, petStable, garlands: {
    list: GARLANDS.map((g) => g.name), set: (p, i) => garlandStand.wear(typeof p === "number" ? players.list.find((a) => a.index === p) : p, i),
    cycle: (p = players.p1) => garlandStand.cycle(p), get unlocked() { return garlandStand.unlocked; },
    preview: (i) => players.p1.wearGarland(i), evaluate: () => garlandStand.evaluate(), api: garlandStand,
  }, world, npcs, garden: gardenDebug, mossback, critters: critterDebug, fishing: fishingDebug, camp: campDebug, paths, campMenu, bridges: { ...bridges.debug, api: bridges, cutscene: (id) => bridgeScene.replay(id), scene: bridgeScene },
  renderer, scene, camera, controls, terrain, water, sky, dayNight, timeDial, props, ambient, atmosphere, ambienceAudio, sfx, music, title, quality, lowerQuality,
  player, players, avatars, input, keyboard, gamepad, link, remote, touch, pairPanel, optionsMenu, followCam, hud, dialog, particles, interactions, juice: dungeon.juice,
  getColliders, resolveCircle, getInteractables, findNearest, items, harvest, storybook,
  inventory, invBar, bagPanel, islandTracker, collection, journalShowcase, beachFinds, travel, dungeon, rootgate, caveMouth, lavaMouth, combat, pickups, gathering, collect, campfire, campfires, quests, questTracker, feast, cinematic, sync, screenLink, slotTable,
  targets,
  get target() { return targets.get(player) || null; },     // P1's target
  step: (dt = 1 / 60, n = 1) => { for (let i = 0; i < n; i++) tick(dt); },
};
window.__game.loadMs = Math.round(performance.now());   // ms from navigation start until the whole bootstrap finished (startup-time probe)

// Restore after all props, bridges and camp stages have registered their colliders.
// Joined screens follow the host's spawn rules and never read or write this save.
function rememberPlayers() {
  if (!sync.isHost || DUSK_FLAG || party.pageMode) return;                 // (a party remembers nothing: Step 80a, everybody goes back where they stood)                  // (?duskcrown, Step 69a: a debug visit writes nothing)
  for (const p of players.list) {
    if (p.leaving) continue;
    const previous = playerMemory.get(p.index)?.zone;
    let zone = dungeon.contains(p) ? 'dungeon' : inRitualArea(p.position.x, p.position.z, previous === 'ritual')
      ? 'ritual' : islandTracker.islandOf(p) || previous || 'home';
    // Step 71: Duskcrown is remembered only while the boat is moored there (the boat is the only way home)
    if (zone === 'duskcrown' && !(boat.state.launched && boat.state.at === 'duskcrown')) zone = previous && previous !== 'duskcrown' ? previous : 'home';
    playerMemory.remember(p.index, zone, items.heldBy(p), zone === 'dungeon' ? dungeon.memory() : null);
  }
}
function restorePlayer(p) {
  if (p.bot) return;                                       // (a party bot has no saved place)
  if (DUSK_FLAG) { world.goto('duskLanding'); return; }     // ?duskcrown (Step 69a): the landing beach, whatever the save says; nothing is written for it
  if (!sync.isHost) return;
  const saved = playerMemory.get(p.index);
  if (!saved) return;
  if (saved.zone === 'dungeon') dungeon.restore({ area: saved.area, from: saved.from });
  const atDusk = boat.state.launched && boat.state.at === 'duskcrown';
  if (saved.zone === 'duskcrown' && !atDusk) return;                    // Step 71: nothing to sail home on: ordinary spawn
  if (saved.zone === 'ember' && atDusk) saved.zone = 'duskcrown';        // the party went with the boat (a save made just before the crossing ended)
  const anchor = dungeon.state.active ? null : islandSpot(saved.zone === 'duskcrown' ? 'duskDock' : saved.zone);
  if (anchor) {
    const spots = clearTravelSpots(anchor, 1, {
      walkable: (x, z) => isWalkable(x, z) && (saved.zone !== 'ritual' || inRitualArea(x, z)),
      regionAt: regionOf, colliders: getColliders(),
      occupied: players.list.filter((q) => q !== p).map((q) => q.position),
      island: saved.zone === 'ritual' ? 'home' : saved.zone,
    });
    if (spots) p.teleport(spots[0].x, spots[0].z);
  }
  if (saved.tool) items.restoreEthereal(saved.tool, p);
  players.update(0); // Refresh the group focus before the first rendered frame.
  followCam.snap();
  followCam.update(0, players.focus);
  if (controls) {
    controls.target.copy(players.focus);
    camera.position.set(players.focus.x, players.focus.y + 20, players.focus.z + 20);
    controls.update();
  }
  worldVis.snap();
  atmosphere.snap();
}
players.list.forEach(restorePlayer);
players.on('join', restorePlayer);
islandTracker.update(players.list);
window.addEventListener('pagehide', rememberPlayers);
document.addEventListener('visibilitychange', () => { if (document.hidden) rememberPlayers(); });
if (params.has('debug') && params.get('goto')) world.goto(params.get('goto'));

// The original first frame never waits for optional administration/cloud bundles.
mountExtensions(window.__game).then((editor) => { extensions = editor; window.__game.editor = editor; onResize(); })
  .catch((error) => console.warn('Optional world editor unavailable:', error.message));
