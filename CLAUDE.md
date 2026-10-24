# Infinite Island: developer guide for new sessions

A cozy Three.js island game in the style of Animal Crossing and Stardew Valley, for up to 4 players. Players can share one screen (keyboard, gamepads, phones as controllers) or join from their own device with their own camera (hybrid local + online over PeerJS). It has gathering, tools, cooking, quests, a day/night cycle and procedural music.
The game runs as plain ES modules. Optional React admin/cloud components have a small build step (`npm run build`) and deploy as a static site to Vercel; see docs/SETUP.md.

- **Repo:** https://github.com/alan2quick/InfiniteIsland, branch `main`. Pushing to `main` redeploys on Vercel if the repo is connected.
- **[README.md](README.md):** user-facing docs covering features, controls, debug flags, the phone link protocol and a project structure map.
  Read it first, and keep it updated when you add features.
- **[PLAN.md](PLAN.md):** the INDEX: creative direction (palette, scale, style), tech stack, how the plan is organised, the step table with status and the open steps. Each feature arc's spec + progress lines are in its own file under [plan/](plan/) (e.g. [plan/82-living-pass.md](plan/82-living-pass.md)); read only the one you need.
- **[plan/CHANGELOG.md](plan/CHANGELOG.md):** per-step implementation notes, newest first (what was built, measured numbers, what is NOT verified). Grep it for a step ("Step 81b") instead of reading it whole.
- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md):** the detailed module contracts (every system's API, sync domains, saves, the full `localStorage` table). Grep it by module or file name.
- **[DUNGEON_PLAN.md](DUNGEON_PLAN.md):** the Wildroot Hollow spec (Steps 41-46).

## Run & verify

```bash
npm install
npm start            # bundles optional tools, then node server.js -> http://localhost:3000 (static + /vendor/three + /api/info + /api/qr + WebSocket relay /ws)
```

- The Claude desktop Browser pane has launch configs in `.claude/launch.json`:
  - `island`: the Node server on port 3000.
  - `static`: `python -m http.server 8080 --directory public`. It simulates Vercel: no `/api`, `/ws` or `/vendor`.
- Static files are served fresh on each request, so reload the page after editing client code.
  Only edits to `server.js` need a server restart (`preview_stop` then `preview_start {name:"island"}`).
- `npm test` runs 1327 Node tests in 108 files (built-in runner, no browser). Visual and gameplay verification uses the browser through `window.__game`.

### Testing technique
These tips came from painful experience.

- **A hidden Browser pane reports `innerWidth` / `innerHeight` 0.** A page loaded while the pane is hidden starts with a NaN camera aspect (the side camera falls back to 16:9; `followCam.resize` ignores 0 x 0). Front the tab (`tabs_select`) before loading when you need real framing or screenshots.
- **Use `__game.step(dt, n)`** to advance the whole simulation (`tick`) deterministically.
  The pane throttles `requestAnimationFrame` in background tabs, so real-time waiting is unreliable.
- **Screenshots can show a stale frame** right after `step`, because rendering only happens in rAF.
  Wait about 1 s, then take the screenshot.
- **Keyboard:** `__game.keyboard.press('KeyE')`, then `step`, then `release` / `releaseAll()`.
  E or Enter is interact; Space is jump (the hop; also confirms dialogs); Q, Esc or Backspace is cancel; WASD and the arrows move.
- **Walking scripts can wedge** diagonally against colliders, such as the campfire benches.
  Teleport instead with `__game.player.teleport(x, z)`, then call `followCam.snap()` if needed.
- **Fake devices for multiplayer:**
  - `__game.players.spawnDebugPlayer(id, kind)`, `fake(id, {x, y, interact, cancel})`, `unplug(id)`, `replug(id)` and `summary()`.
  - `__game.remote.inject(key, state)` and `eject(key)` fake a phone.
  - For fake gamepads, monkeypatch `navigator.getGamepads` in the page.
- **Real phone test:** open the pair panel (`P`) to get the room code, then open `controller.html?room=CODE&cid=<unique>` in a second tab.
  The `cid` param is needed because tabs share `localStorage`.
  Drive the joystick with synthetic `PointerEvent`s on the `.tc-zone` element.
- **Other debug hooks:**
  - `harvest.regrowNow()` fast-forwards tree and rock regrowth.
  - `campfire.setFuel / burn / addLog / cook / openMenu / summary`.
  - `feast.start(player, {free: true})` runs the cutscene without needing a quest.
  - `quests.start(id?)` starts a quest.
  - `music.renderTrack(i, s)` renders a track offline for level checks.
  - `inventory.add(id, n)` adds items.
- **Reset saves** with `?newgame`. Other flags are listed in README "Debug flags".
- **The Browser pane's console history is sticky across reloads and tabs.**
  Before chasing an error, confirm it on a fresh tab (`tabs_create` then `navigate`).
- **The user owns a real Mayflash GameCube USB adapter** (`GameCube Controller Adapter (Vendor: 0079 Product: 1846)`), and it may be plugged in.
  It shows up in `navigator.getGamepads()` and logs `[gamepad] #0 ... -> gamecube`. That is real hardware, not leaked test code.
- **Audio can't be heard by an agent.** Verify it structurally: node graph, gain values, scheduler counters and offline renders.
- **Don't use the pane's viewport emulation for click tests:** it misplaces clicks. Use it only for screenshots; for taps use desktop size or synthetic events.
- **Two-screen (online) testing:** open a host tab, read `__game.link.code`, then open `/?join=CODE` in a second tab (a replica).
  Drive both with `__game.step` plus short `setTimeout` waits; PeerJS messages still arrive in throttled background tabs.
  Compare `__game.sync.hash()` / `hashes()` on both tabs after actions; `await __game.sync.stress({steps, seed})` runs a seeded random stress on each tab.
  `__game.slots` is the global slot table and `__game.avatars` the remote characters. `?netsim=latency,jitter,loss` adds artificial lag. Grace periods and timeouts may count simulation time, so fast stepping shortens them.
- **Before/after visual comparisons:** check out the previous commit into a temporary `git worktree` in the scratchpad, serve its `public/` on another port with a temporary launch config, and screenshot both at the same pose. Remove the worktree and config afterwards. (`git stash` may be blocked by permissions.)

## Architecture

### Frame pipeline
Everything goes through `tick(dt)` in [public/js/main.js](public/js/main.js), in this order:

1. **Island harvesting hit-stop** scales `dt` briefly on tool impacts. Combat uses `Player.freezePose` and guardian visual pose holds instead; its input, movement and authoritative timers always advance normally. Combat finish slow motion scales only visual poses, particles and camera easing. The day/night clock then advances, updates sky/water/exposure and the campfire night factor, before camera shadow tracking runs.
2. **`players.pollInput(dt)`** turns every device into per-player `actions`, and handles claiming, joins, leaves and the grace period.
3. **Targets:** each active, non-frozen player gets its own nearest interactable via `findNearest(pos, INTERACT_RADIUS)`, stored in the `targets` Map.
   All targets are computed before anyone acts. Nothing gets a target while the feast scene runs.
4. **Act, P1 first:**
   - An open dialog is driven only by its `dialog.owner`.
   - Otherwise, with a target: `getToolAction(held, target)` decides `dig` (`gathering.dig`), `chop` / `break` (`harvest.hit`), or a plain `interactions.interact`.
   - Interact with no target while holding an item calls `items.swing`.
   - Cancel calls `interactions.cancel` (the hop).
   - The pair panel swallows input, and any player's Cancel closes it.
5. **System updates:** `players.update`, `items`, `harvest`, `gathering`, `campfire`, `pickups`, `followCam` (centroid and zoom), `feast` (can override the camera and poses), `questTracker`, player rings and tags, `interactions`, `invBar`, `dialog`, `particles`.
6. **Prompt bubbles** are drawn per player, then the ambient systems run (title, water, props wind, sky, ambient).

### Key contracts (summary; details in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md))

- **Input:** a source's `poll()` returns `{x, y, interact, cancel, jump?, charm?, menu?, *Tap?}` (y up-positive, screen-up = world -Z). One `InputManager` per device (`local`, `pad:<i>`, `phone:c-<id>`, `debug:<name>`, `bot:<n>`) turns it into `player.actions`. Jump = Space / pad Y; Charm = R / pad X; outside combat areas Charm is a second Jump.
- **Players and screens:** every rendering device is a screen; the host owns 4 global slots (P1-P4, synced `players` domain). `PlayerManager` holds only this screen's players; others are remote avatars from 15 Hz pose packets (`net/poseBuffer.js`, 16 fields). New interactions take a `player` and never assume P1.
- **Registries are module singletons** (`interactables.js`, `colliders.js`): register gameplay data ONCE (e.g. in `buildIslandData`); a visual rebuild (`world.rebuild(id)`) must never add or lose registrations.
- **World sync (host-authoritative):** domains register `{snapshot, applySnapshot, applyEvent, handleRequest, hashView?}` with `net/worldSync.js`. The host decides all randomness and runs all authoritative timers; replicas send requests and wait for events (no optimistic state); `__game.sync.hashes()` must match across screens; replicas never save (`game/save.js setSaveEnabled(false)`).
- **Islands:** `ISLANDS` / `BRIDGES` in config; `world/terrain.js` dispatches height / ground / walkability; read island extents through `world/islands/extent.js`, never `radius + margin`. Pockets (dungeon areas, storybook lane, Party Glade) are answered by terrain before the islands. Seeded placement is hash-pinned in tests: do not change what earlier sampling accepts.
- **Cinematics:** one at a time through `game/cinematic.js`; check `cinematic.busy` before starting anything that moves players or the camera.
- **Rendering budget:** about 200 draw calls at gameplay view (party stages: complete view under 400k triangles), no new lights, reuse shared programs (`render/toon.js`, `VERTEX_TOON`, merged / instanced meshes). Character and hat materials write stencil 1 for the occluded-player silhouette; anything new drawn on a character must too.
- **Party games:** a game = a pure logic file in `game/party/` exporting `GAME {...}` (registry contract in [plan/80-party-games.md](plan/80-party-games.md) and the Step 80a changelog entry) + a stage in `world/party/`; `g` only changes through `apply`.
- **Persistence:** wrap every storage access in try/catch; host-only saves; `?newgame` wipes game saves but not comfort / board preferences. The key table is in docs/ARCHITECTURE.md ("Persistence"); add a row when you add a key.
- **Pinned CDN versions:**
  - three@0.186.1 is loaded through an import map that `index.html` injects at runtime. It points at the CDN, or at `/vendor` with `?transport=ws`.
  - peerjs@1.5.4 and qrcode-generator@1.4.4 come from jsdelivr.
  - In three 0.186, `PCFSoftShadowMap` is gone (use `PCFShadowMap`), and `THREE.Timer` is used instead of the deprecated `Clock`.

## Conventions

- **Style:** match the surrounding code. The comment style is a file header that explains the module and its API, plus short "why" comments.
  Modules export a `createX(...)` or a class returning `{update(dt), ...}`. Tunables go in `config.js`.
- **Look:** chunky, cute and vibrant, using toon materials with dark `#2b2340` outlines, and the palette in `config.js` / PLAN.md.
  UI is comic-style: rounded shapes, thick outlines and the Fredoka font.
  **Use inline-SVG icons from `ui/icons.js`, not emoji,** in important UI, because some browsers render emoji as blank boxes.
- **Multiplayer first:** new interactions take a `player`, work per player, and must not assume P1.
- **No regressions to solo play:** single-player must look and behave the same as before.
- **Static-host compatible:** no new server dependencies. `server.js` is an optional local fallback.
- **Versioning:** `VERSION` in [public/js/config.js](public/js/config.js) is the source of truth. It is shown on the title card, logged to the console and available as `__game.version`.
  Keep `"version"` in `package.json` and `package-lock.json` in sync with it.
  The scheme is `0.<last completed PLAN step>.<patch>`: bump the minor when a step lands, and the patch for small fixes and tweaks.
- **Line endings:** the repo mixes LF and CRLF and git warns about it. Preserve each file's existing endings, since there is no `.gitattributes` yet.

## Workflow the user expects

- **New features** are added as a numbered step following "How this plan is organised" in PLAN.md: a topic file under `plan/` (spec + `- [ ]` progress lines), a row in PLAN.md's step table and an "Open steps" line.
  Each step is implemented by a **lower-model sub-agent (Sonnet)**, given a detailed prompt that points it at the step's `plan/` topic file (not the whole PLAN.md) and the files to read.
  The main session then verifies the step itself in the Browser pane (screenshots plus `__game` probes) before reporting.
  Big features are split into several steps, for example 11–12 for multiplayer and 13–15 for the campfire.
  Small tweaks can be done directly without an agent.
- **When a step lands:** tick its box in the topic file (short note), put the long write-up at the TOP of [plan/CHANGELOG.md](plan/CHANGELOG.md), update its row / "Open steps" in PLAN.md, update docs/ARCHITECTURE.md if a module contract changed, and replace "Current state" below (keep it to a few lines). **Do not add step paragraphs to CLAUDE.md**: it is loaded into every session, so it must stay short.
- **Delegating to Codex:** when the user asks for a step to go to Codex, Claude drives the Codex CLI headless from Bash (no MCP: `codex mcp-server` is gone in codex-cli 0.162):
  `codex exec -c 'windows.sandbox="unelevated"' --sandbox workspace-write -o <scratchpad>/codex-out.md "<prompt>" < /dev/null`, run from the repo root; follow up with `codex exec resume --last "<more>"`.
  The `-c` override is required: the user's `~/.codex/config.toml` sets `windows.sandbox = "elevated"`, whose shell fails to start when Codex is launched by another program ("setup refresh had errors"). Don't edit that config.
  **Codex must not commit in sessions Claude starts:** say so in every prompt ("do not run git commit / push"), then check `git status` / `git log` afterwards. Claude verifies the step (tests, Browser pane) and commits only when the user asks, as below. (Codex sessions the user runs directly may still commit on their own.)
  Run one Codex task at a time and don't edit the same files meanwhile; long steps can use `run_in_background`.
- **Committing:** commit and push **only when the user asks**, usually "commit and push". Commit straight to `main` with a descriptive message and this trailer:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  The repo-local git identity is `alan2quick` / `abng87@gmail.com`.
- **After each change,** say plainly what was verified and what wasn't (audio by ear, real hardware), and ask before committing.
- **`scratchpad/` is the user's private folder** for work-in-progress playtest notes and screenshots. Don't open, search, list or summarise it unless the user explicitly mentions the folder or a file in it. It is git-ignored; never commit it (don't force-add it), and don't save your own debug screenshots there: use your session scratchpad outside the repo instead.
- **Other tools work in this repo too.** The user also uses Codex, which has implemented and committed steps directly (for example 17, 19, 23–25). At the start of a session, and before committing, check `git status` / `git log` for work you didn't write; don't overwrite or reorganise it without asking. Integration bugs between tools' work are likely (see the 0.25.1 silhouette fix), so verify combined features end to end.


## Current state

- **Version 0.82.3** (committed `9fe64af`): Steps 82a-82c (Party Glade living pass for the lobby and eight stages) and the Driftwood Cast press-to-hook fix. 1327 tests / 108 files pass (`npm test`; if it fails with spawn EPERM in a sandbox, run files one by one with `node --test --test-isolation=none`).
- **Next:** Step 82d (living pass for Glowcap Shuffle, Driftwood Cast, Tilty Tiles, Bonk Burrows, 0.82.4). Other open steps are listed in PLAN.md.
- **Never verified by anyone:** any audio by ear, real phones (touch, "Play on this phone" over a real network), real-device GPU cost, a real standard gamepad, kids' feel and balance of the party games. Each step's own gaps are in its changelog entry.
- Backlog / known rough edges: PLAN.md "Backlog and known rough edges".
