# Infinite Island — Build Plan

A cozy, runnable Three.js island you can walk around in the style of Animal Crossing / Stardew Valley.
Cute, comic/anime-inspired, vibrant, visually simple. You can play it with a keyboard (WASD), a gamepad,
or a phone used as a wireless virtual controller.

---

## 1. Creative direction

**Biome:** A small tropical spring island called **Infinite Island**. It has a sandy beach ring, grassy
terraced meadows, a raised plateau with ramps, a freshwater pond fed by a little stream, cherry-blossom and
round green trees, palms on the beach, boulders, bushes, flowers, mushrooms and a wooden signpost near the
spawn point.

**Style:** Toon shading (`MeshToonMaterial` with a 3-step gradient map), chunky low-poly shapes, and thick
dark outlines (inverted-hull technique) for a comic-book look. Flat vibrant colors, soft pastel sky, no
realistic textures.

**Palette (put these in `config.js`):**
| Use | Hex |
|---|---|
| Grass light / dark | `#8fe36b` / `#5fc25a` |
| Sand | `#ffe6a3` |
| Cliff / dirt | `#d9a066` |
| Shallow water / deep water | `#6fe3ef` / `#2f9bdc` |
| Rock | `#b9b4cc` |
| Tree canopy green / blossom pink | `#58c96b` / `#ffb3d1` |
| Trunk | `#9a6a44` |
| Outline | `#2b2340` |
| Sky top / horizon | `#7cc8ff` / `#ffe9f5` |

**Scale:** The island is about 120 × 120 world units (radius ≈ 55 before the beach drops into the sea).
Player run speed is ≈ 7 u/s, so you can cross the whole island in about 15–20 seconds.

**Camera:** A fixed-angle follow camera like Animal Crossing. It sits about 13 up and 13 back, tilted about
45° down, and never rotates. It follows the player smoothly with a lerp and eases its look-at point. Because
the camera never rotates, movement input maps directly to world axes: screen-up is world `-Z`.

---

## 2. Tech stack & architecture

- **Runtime:** Node.js (v18+) server with no build step. Only two npm deps: `three` and `ws`, plus `qrcode`
  for pairing QR codes.
- **Server (`server.js`):** Uses plain `node:http`, with no Express.
  - Serves `public/` as static files, with correct MIME types and path-traversal protection.
  - Serves `node_modules/three/` at `/vendor/three/`.
  - `GET /api/info` returns `{ lanUrls: string[], port }` (non-internal IPv4 addresses from `os.networkInterfaces()`).
  - `GET /api/qr?text=...` returns an SVG QR code (via `qrcode.toString(text, {type:'svg'})`).
  - WebSocket relay at path `/ws` (see protocol below).
  - Listens on `0.0.0.0:3000` (or `PORT` env var) and prints local + LAN URLs on start.
- **Client:** ES modules loaded directly in the browser. The import map is in `index.html`:
  `"three": "/vendor/three/build/three.module.js"` and `"three/addons/": "/vendor/three/examples/jsm/"`.

### File layout
```
package.json            scripts: { "start": "node server.js" }
server.js
README.md
public/
  index.html            game page (canvas + HUD overlay + import map)
  controller.html       phone controller page
  css/game.css
  css/controller.css
  js/
    main.js             bootstrap: renderer, scene, loop, wires systems together
    config.js           palette, world sizes, speeds, tunables
    utils/rng.js        seeded mulberry32 RNG
    utils/noise.js      small 2D simplex/value noise + fbm
    render/toon.js      gradientMap, toonMat(color), addOutline(mesh, thickness)
    world/terrain.js    getHeight(x,z), getGroundType(x,z), isWalkable(x,z), buildTerrain()
    world/water.js      ocean + pond water meshes, animated
    world/sky.js        gradient sky dome, clouds, lights, fog
    world/props.js      trees, palms, rocks, bushes, flowers, mushrooms, signpost
    world/colliders.js  circle collider registry + resolve(pos, radius)
    world/interactables.js  registry of interactable objects {position, radius, prompt, onInteract}
    player/character.js build chibi character model, returns { root, parts }
    player/player.js    movement physics, terrain following, collisions, procedural animation
    camera/followCamera.js
    input/inputManager.js  merges sources, produces actions
    input/keyboardSource.js
    input/gamepadSource.js
    input/remoteSource.js  phone controller via WebSocket (host side)
    input/touchSource.js   on-screen touch controls when the game runs on a touch device
    net/remoteLink.js      host WebSocket client (room creation, controller events)
    ui/hud.js              interact prompt bubble, toasts, controller status icons
    ui/dialog.js           speech/dialog box (Interact advances, Cancel closes)
    ui/pairPanel.js        "Connect phone" panel with QR + room code
    ui/touchControls.js    shared joystick + A/B button widget (used by controller page & touchSource)
    controller/controller.js  phone page logic
```

### Input contract (shared by every source)
Each source exposes `poll()` and returns `{ x, y, interact, cancel }`:
- `x`, `y` are in [-1, 1]. `x` is right-positive and `y` is **up/forward-positive**, as the user sees it on screen.
- `interact` and `cancel` are booleans that are *held* state.

Each frame, `InputManager.update()` returns:
```js
{ move: { x, z },            // world-space, length <= 1 (z = -y)
  interactPressed, cancelPressed,   // edge-triggered (true only on the frame they go down)
  interactHeld, cancelHeld,
  activeSource }             // 'keyboard' | 'gamepad' | 'remote' | 'touch'
```
- The manager uses the source with the largest move magnitude and ORs the buttons across sources.
- A radial deadzone of 0.15 is applied to analog sources.

**Default bindings:**
- **Keyboard:**
  - Move: WASD or the arrow keys.
  - Interact: E, Space or Enter.
  - Cancel: Q, Escape or Backspace.
  - Diagonals are normalized.
- **Gamepad (standard mapping):**
  - Move: left stick (axes 0/1) or the D-pad (buttons 12–15).
  - Interact: A / Cross (button 0).
  - Cancel: B / Circle (button 1).
  - The first connected pad is used, and a toast shows when it connects or disconnects.
- **Phone / touch:**
  - Move: virtual joystick. This is a floating joystick that appears where your thumb lands on the left half of the screen.
  - Interact: the big **A** button, green with a paw/hand glyph.
  - Cancel: the **B** button, pink, with an ✕ glyph.

### WebSocket protocol (`/ws`, JSON messages)
| From → To | Message |
|---|---|
| game → server | `{type:'host'}` |
| server → game | `{type:'room', code:'ABCD'}` (4 letters, no ambiguous chars) |
| controller → server | `{type:'join', code:'ABCD'}` |
| server → controller | `{type:'joined', player:1}` or `{type:'error', message}` |
| server → game | `{type:'controller-connected', id}` / `{type:'controller-disconnected', id}` |
| controller → server → game | `{type:'input', id, x, y, interact, cancel}`. The controller sends this whenever the state changes, and at least every 100 ms while the stick is held. |
| server → controller | `{type:'host-left'}` when the game tab closes |

- The server keeps a map of rooms (`code → { host, controllers:Set }`).
- It pings clients every 15 s and drops dead sockets.
- The controller auto-reconnects with backoff and re-joins the same room code.

**Pairing flow:**
1. The game page has a "📱 Connect phone" button, and the `P` key also opens the panel.
2. The panel shows a QR code for `http://<lanIp>:3000/controller.html?room=ABCD`, plus the plain URL and the big room code.
3. A phone on the same Wi-Fi scans the code and is paired instantly. If there is no `room` param in the URL, the controller page asks for the 4-letter code instead.

### Gameplay systems
- **Movement:**
  - Target velocity is `move * speed`, reached with acceleration and damping so the player eases in and out.
  - The character turns smoothly to face the direction of movement (slerp on the Y rotation).
  - Keyboard runs at full speed. Analog input scales speed with stick magnitude (walk below 0.5, run above).
- **Terrain following:** The player's Y is `getHeight(x, z)`, smoothed.
- **Blocking:** You can't walk into deep water (terrain height below `WATER_LEVEL - 0.35`). Colliders against props use circle-vs-circle push-out. The player slides along obstacles instead of sticking.
- **Procedural animation:** Walk bob, arm/leg swing and a slight forward lean. Squash and stretch when starting or stopping, idle breathing and blinking eyes. Little dust puffs when running.
- **Interaction:**
  - The nearest interactable within about 2.2 u of the player shows a floating prompt such as "Ⓐ Shake".
  - Trees shake and drop leaves or petals, sometimes a fruit that pops.
  - Flowers do a boing, rocks sparkle with a "clink!" toast, and bushes rustle.
  - The signpost opens a dialog box with a welcome message and controls help.
- **Cancel:** Closes the dialog or pair panel if one is open. Otherwise the player does a small "hop/emote".

---


---

## 3. How this plan is organised

PLAN.md is the **index**: creative direction, tech stack, this guide and the step table below. Every step's
spec and its progress lines live in a topic file under [plan/](plan/), one file per feature arc. Per-step
implementation notes (what was built, numbers measured, what is not verified) are in
[plan/CHANGELOG.md](plan/CHANGELOG.md), newest first. Module contracts are in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

**Adding a step**
1. A new feature arc gets a new file `plan/<first step>-<slug>.md` (e.g. `plan/83-trophy-hall.md`) with the
   same layout as the others: `# Step N: title`, a `## Spec` section, then `## Progress` with one
   `- [ ] Step Na — ...` line per sub-step. A sub-step of an existing arc goes into that arc's file.
2. Add one row to the step table below and, while it is open, a line under "Open steps".
3. Step prompts for sub-agents / Codex point at the topic file (and DUNGEON_PLAN.md etc. where relevant),
   not at PLAN.md as a whole.

**Finishing a step**
1. Tick its box in the topic file with a short note (version, what was built, test count).
2. Add the long write-up (built / measured / not verified) at the top of [plan/CHANGELOG.md](plan/CHANGELOG.md),
   not in CLAUDE.md.
3. Update the row's status here, remove it from "Open steps", and update "Current state" in CLAUDE.md
   (two or three lines only).
4. If the step adds or changes a module contract other steps rely on, add or update its bullet in
   docs/ARCHITECTURE.md; if it touches a rule every session needs, update CLAUDE.md.

Keep PLAN.md and CLAUDE.md short: long text goes to the topic file, the changelog or docs/ARCHITECTURE.md.

---

## 4. Steps

| Steps | Topic | Status | File |
|---|---|---|---|
| 1–26 | Foundations: scaffold, terrain, players, multiplayer, campfire, quests, music, day/night, sync, screens, hats | done (0.26.0) | [plan/01-26-foundations.md](plan/01-26-foundations.md) |
| 27–32 | The archipelago: regions, bridges + builders, Frostpine + Emberleaf islands, archipelago life, playtest fixes | done (0.31.1) | [plan/27-32-archipelago.md](plan/27-32-archipelago.md) |
| 33–36 | Frostpine's story: camp + trail, critters, camp comfort, tails | done (0.36.0) | [plan/33-36-frostpine.md](plan/33-36-frostpine.md) |
| 37–40b | Emberleaf's story: garden hub, seeds + growth, regional quests, garden stages, garlands, silhouette | done (0.40.2) | [plan/37-40-emberleaf.md](plan/37-40-emberleaf.md) |
| 41–46 | Wildroot Hollow dungeon, return memory, ritual island (spec in [DUNGEON_PLAN.md](DUNGEON_PLAN.md)) | done (0.46.0) | [plan/41-46-wildroot.md](plan/41-46-wildroot.md) |
| 47–53 | Storybook Cay side-scroller | 47–53a done; **53b open** | [plan/47-53-storybook.md](plan/47-53-storybook.md) |
| 54–63 | Combat areas, charms, Armory | 54–60 done; **61–63 open** | [plan/54-63-combat-areas.md](plan/54-63-combat-areas.md) |
| 64–66 | The Tdoongz | 64a–i + 65 prelude done; **65, 66 open** | [plan/64-66-tdoongz.md](plan/64-66-tdoongz.md) |
| 67 | Combat juice | done (0.67.5) | [plan/67-combat-juice.md](plan/67-combat-juice.md) |
| 68 | Skipper Marlo's boat | 68a–e done; **68f, 68g open** | [plan/68-boat.md](plan/68-boat.md) |
| 69 | Duskcrown Isle | done (0.70.5) | [plan/69-duskcrown.md](plan/69-duskcrown.md) |
| 70 | Click-to-walk | done (0.70.0) | [plan/70-click-to-walk.md](plan/70-click-to-walk.md) |
| 71 | Set sail to Duskcrown | done (0.71.0) | [plan/71-set-sail.md](plan/71-set-sail.md) |
| 72 | Fishing in the Glowcap Marsh | done (0.72.1) | [plan/72-fishing.md](plan/72-fishing.md) |
| 73 | Capray, the first pet | done (0.73.1) | [plan/73-capray.md](plan/73-capray.md) |
| 74–79 | (numbers not used) | | |
| 80–84 | Party Games | 80a–e done (80e committed at 0.85.0) | [plan/80-party-games.md](plan/80-party-games.md) |
| 81 | Party Games II | done (0.81.1) | [plan/81-party-games-2.md](plan/81-party-games-2.md) |
| 82 | Party Glade living pass | done (0.82.4) | [plan/82-living-pass.md](plan/82-living-pass.md) |
| 85 | The Crownlands (Duskcrown's sunlit plateau, floating islands) | done (0.85.3) | [plan/85-crownlands.md](plan/85-crownlands.md) |

### Open steps

- [ ] Step 68f — Playtest fixes, star chart — [plan/68-boat.md](plan/68-boat.md)
- [ ] Step 68g — Playtest fixes, repair and story — [plan/68-boat.md](plan/68-boat.md)
- [ ] Step 53b — Wildroot Ramparts and bosses (storybook) — [plan/47-53-storybook.md](plan/47-53-storybook.md)
- [ ] Step 61 — The Storybook combat area (after 53) — [plan/54-63-combat-areas.md](plan/54-63-combat-areas.md)
- [ ] Step 62 — Thorny mode — [plan/54-63-combat-areas.md](plan/54-63-combat-areas.md)
- [ ] Step 63 — Deep Roots (endgame gauntlet) — [plan/54-63-combat-areas.md](plan/54-63-combat-areas.md)
- [ ] Step 65 — Tdoongz story roles — [plan/64-66-tdoongz.md](plan/64-66-tdoongz.md)
- [ ] Step 66 — Mercenaries — [plan/64-66-tdoongz.md](plan/64-66-tdoongz.md)

### Backlog and known rough edges

Moved from CLAUDE.md "State at hand-off" on 2026-10-22.

- **Not yet verified** by anyone:
  - Any audio, by ear.
  - Real phones: on-screen touch, fullscreen / Add to Home Screen, and "Play on this phone" over a real network.
  - Real-device GPU cost (the character merge raised shadow-pass triangles while cutting draw calls).
  - A real standard gamepad. The GameCube adapter was detected live, but its buttons were never pressed live.
- **Known rough edges and backlog ideas:**
  - Remote avatars show the generic swing for a dig, not the shovel plunge.
  - Disconnect grace periods count simulation time, so fast `__game.step` runs shorten them in tests.
  - Likely (not yet observed): where a held tool covers part of the body, the silhouette may tint the tool, because tool materials don't write the stencil mark. Fix by giving held-item materials the same stencil write if it shows up.
  - Felled trees rest at about 82° and their canopy clips the ground a little.
  - Toasts can overlap the campfire's floating status and the title card.
  - It is easy to wedge diagonally against a campfire bench when walking up to the fire.
  - Tree and rock regrowth isn't saved; the inventory, quest, fuel and time are.
  - Dropped pickups never despawn (the 40-item cap auto-collects the oldest).
  - When a player leaves, their held item lands on the nearest clear spot, sometimes about 3 u away.
  - A player who loses a pickup race gets no feedback.
  - Hats are swappable (`setHat`), but there is no hat content or hair yet; a bare head has no hair.
  - Adding a `.gitattributes` would normalise line endings.
