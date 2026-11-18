# Handoff: Steps 30 and 31 (Emberleaf Isle and archipelago life)

**Update (2026-10-08): Step 67a–f implemented, version 0.67.5.** Combat feedback lives in `world/combatFeel.js`, `combatWarnings.js`, `shockwave.js`, `combatNumbers.js`, `combatHealth.js`, `render/combatFlash.js` and `audio/combatSound.js`; pure feedback rules are in `game/juiceLogic.js` and `combatLogic.impactTier`. Strike effects use a separate presentation ID counter: never use `nextFX`, since it also allocates hashed projectile / patch IDs. Pose freezes and finish slow motion never scale the combat simulation.

683 Node tests pass. Browser checks cover all warning shapes, an actual four-player Cinder impact, local hurt isolation, saved desktop / phone comfort controls, a host / replica with matching domain hashes after 200 seeded hits, and offline audio peak / RMS (12 hits in 200 ms: peak 0.448, RMS 0.0461, 11 peak voices). A 3,360-step comparison against pre-step HEAD found identical authoritative snapshots after removing the added presentation metadata. Four-player Cinder impact draw calls: 127 before / 129 after (1024×768, headless Edge, shadow pass included). No page / shader errors. Human feel, audio by ear and physical phone / gamepad / GPU checks remain unverified. Details are in [PLAN.md](PLAN.md), Step 67 progress.

**Update (2026-10-02): Step 40 is implemented at 0.40.0.** Flower garlands finish the planned Emberleaf story: 24 neck models, a bamboo stand, garden-hearth-only feast rewards, shared unlocks and per-screen worn preferences. Feast reveal providers now route by fire; hats still appear first. Poses append field 13 with backward compatibility; remote avatars wear garlands. Six new tests cover rules, geometry / glow / budget, neck attachment, pose relay, saves and host / replica convergence. Browser verification and limits are recorded in PLAN.md.

**Update (2026-10-02): Step 39 is implemented at 0.39.0.** Mossback's three shared garden jobs replace the placeholder. Donations save in `garden.given`; host requests validate actor ownership, range and captured job stage. Trellises open eight beds; irrigation opens sixteen and makes tending / cuttings start as buds; the lantern pavilion finishes the structures. Colliders retain identity across visual rebuilds. Breadfruit trees drop breadfruit logs, usable at every fire. Step 40 is now implemented.

**Update (2026-10-02): Step 38c regional campfire quests is implemented at 0.38.2.** The plan was committed as `6664bd7`. Quests are now keyed by fire (`home`, `frost`, `ember`), with region-only issuing / turn-in and cancellation. The tracker and required inventory chips follow the camera's stable ground region. The v2 quest save migrates v1; feast count, hats, Frostpine tails and shared feast scenes are preserved. See PLAN.md verification and CLAUDE.md module notes. Step 39 has since been implemented; Step 40 is now implemented.

**Previous handoff: Steps 39 and 40 finish Emberleaf's Night-Bloom Terraces.** Main was at `51d2159` (0.38.1) before this work. Steps 32–38 are done:
the Frostpine camp, critters, camp jobs and tails, plus the Emberleaf garden, waterfall, Mossback, seeds and night growth.
- **Read first:** [PLAN.md](PLAN.md) "Steps 37–40", Steps 39 and 40. Each now has an **"Implementation notes (as built through 0.38.0)"** block naming
  the exact files, hooks and patterns to copy: the Frostpine camp jobs and stages for 39, and the tails for 40.
- **Two traps the notes call out:**
  - `game/feastScene.js` only supports one unlock reveal, hard-wired to the Frostpine fire, so generalise it.
  - `net/worldSync.js` drops pose packets longer than 12 fields, and `garlandId` would be field 13.
- **The rules from the sections below still apply:** commit only when the user asks; never read or commit `scratchpad/`; check `git log` for parallel
  work; preserve line endings; tick PLAN.md and update README, CLAUDE.md and CHANGELOG at each step.

**Update (2026-10-01): Steps 30 and 31 are implemented and committed on main** (Step 30 `aa4fda8`, Step 31 `7a89c1b`, 0.31.0). The briefs below remain design history. See CLAUDE.md for current modules and PLAN.md for verification. `npm test` passes 124 tests. Step 31 adds `infinite-island.collection.v1`; no new dependencies. The user chose to keep hats tied to feasts.

This document hands the last two archipelago steps to a new developer (or coding agent). It covers where the project stands, the rules
of the repo, how the island code fits together, and a step-by-step brief for **Step 30 (Emberleaf Isle)** and **Step 31 (archipelago
life)**. The specs themselves live in [PLAN.md](PLAN.md); this file explains how to build them in a way that fits what exists.

**Read these first, in this order:**
1. [CLAUDE.md](CLAUDE.md): the developer guide (run and verify, testing technique, architecture, conventions, the workflow the user expects).
2. [PLAN.md](PLAN.md), section **"Steps 27–31 — The archipelago"**: design decisions, then Steps 27–29 (done) and **30–31** (yours).
3. [README.md](README.md) sections "Islands", "Stone & the bridge builders", "Gathering and inventory", "Debug flags".

---

## 1. Where things stand

- **Version `0.29.0`** on `main`. `npm test`: **104/104** passing. The working tree was clean at handoff.
- Archipelago commits so far:

  | Commit | What |
  |---|---|
  | `fe58c62` | The Steps 27–31 plan in PLAN.md |
  | `1a5d49a` | Step 27 (0.27.0): three islands in one world, regions, far versions, broken bridge stubs |
  | `99fa24b` | Step 28 (0.28.0): stone, Cobble and Bramble, bridge building, the bridge-opening cutscene |
  | `4e706bb` | Step 29 (0.29.0): Frostpine Isle content (props, harvestables, gathering, items, recipes) |
  | `a323fd9` | `scratchpad/` git-ignored and declared private |

- **Emberleaf Isle today:** real terrain (gold and black sand, jungle lowland, three terraces, a volcano with two walkable ramps
  to a viewing ledge, a lava crater, a lagoon, a hot spring) and water, but only **placeholder** palms, jungle trees and a volcano smoke
  plume from `world/islands/teasers.js`. Its bridge (Bramble, 20 logs) already works, so players can walk over, but there is nothing to
  do there yet. That is Step 30.
- **Frostpine Isle is the finished reference.** Step 30 should mirror how Step 29 did Frostpine, module for module.

## 2. Ground rules (from the user)

- **Commit and push only when the user asks.** After each step, report plainly what you verified and what you didn't (audio by ear,
  real phones and gamepads), then ask before committing. Commit straight to `main` with a descriptive message.
- **Never read, search or commit `scratchpad/`** (repo root). It holds the user's private work-in-progress playtest notes and screenshots.
  It is git-ignored; don't force-add it. Only open it if the user explicitly mentions the folder or a file in it. Don't save your own
  debug screenshots there either.
- **Other tools work in this repo** (Claude Code built Steps 27–29). Check `git status` / `git log` before starting and before committing;
  don't overwrite or reorganise work you didn't write without asking.
- **Versioning:** `VERSION` in `public/js/config.js` is the source of truth; keep `"version"` in `package.json` and in **both** places in
  `package-lock.json` (top level and the root `packages[""]` entry) in sync. Scheme `0.<last completed step>.<patch>`: bump the patch for
  each sub-step (30a → `0.29.1`), the minor when a step completes (Step 30 → `0.30.0`, Step 31 → `0.31.0`).
- **When a step completes:** tick it in PLAN.md's "4. Progress" list with a concise note (what was built, measured numbers, what wasn't
  verified), update README and the CLAUDE.md module notes and its "State at hand-off" section, and add any new save key to the CLAUDE.md
  persistence table.
- **Style:** plain ES modules, no build step, no new dependencies, static-host compatible (Vercel). Each module starts with a header comment
  explaining it and its API, plus short "why" comments. Tunables go in `config.js`. Chunky toon look with dark `#2b2340` outlines and the
  PLAN palette. **Inline-SVG icons (`ui/icons.js`), never emoji,** in UI.
- **Multiplayer first:** every interaction takes a `player`, works per player and on replica screens. **No regressions to solo play** or to
  the home island.
- **Line endings:** the repo mixes LF and CRLF (git warns on every commit; that's expected). Preserve each file's existing endings.

## 3. Running and testing (what's different from CLAUDE.md)

`npm install`, `npm start` (http://localhost:3000), `npm test`. CLAUDE.md "Testing technique" applies in full. Extra lessons from Steps 27–29:

- **Get to Emberleaf fast:** `?newgame&bridges=open` (debug: opens both decks on this page only, never saved), then
  `__game.world.goto('ember')`. `__game.player.teleport(x, z)` + `__game.followCam.snap()` for exact spots.
- **Raised overview shots:** `__game.followCam.enabled = false`, move `__game.camera` (`position.set`, `lookAt`), screenshot, then set
  `enabled = true` again.
- **Draw calls:** a hidden or background browser tab throttles `requestAnimationFrame`, so `renderer.info` can read 0. Step, then render
  manually: `__game.renderer.render(__game.scene, __game.camera); __game.renderer.info.render` (`calls`, `triangles`).
  Measure at 1024 × 768 after about 120–200 settled frames. Budget: **≤ ~200 draw calls** at any gameplay view. Home spawn is 213–215 today.
- **Feast gate for NPC and bridge tests:** `__game.quests.feasts = 1; __game.quests._emit('change'); __game.quests._emitState()`.
  Bridges: `__game.bridges.summary() / give(id, n) / build(id) / reset(id) / cutscene(id)`.
- **Island debug:** `__game.world.{goto, regions, summary, rebuild, visuals, frost}`, `__game.atmosphere`, `__game.loadMs` (startup time).
  `__game.world.rebuild(id)` frees and rebuilds an island's visuals; afterwards draw calls, collider and interactable counts and
  `__game.sync.hashes()` must be **unchanged**. Run it after every content change.
- **Regrowth:** `__game.harvest.regrowNow()`, `__game.gathering.regrowNow()`.
- **Two tabs:** at handoff this machine could not reach `peerjs.com` (the console fills with `wss://0.peerjs.com` errors; that is the
  network, not the code). Use the local relay: host `/?transport=ws`, replica `/?join=CODE&transport=ws`. A hidden host tab only advances
  when stepped, so step the host on a `setInterval` during two-tab tests. Compare `__game.sync.hashes()`; `await __game.sync.stress({steps, seed})`
  is a seeded random stress test to run on each tab.
- **Before/after numbers:** check out the previous commit into a temporary `git worktree` (outside `scratchpad/`), serve its `public/` on
  another port, measure the same views, then remove the worktree.

## 4. How the archipelago code fits together

- **One world, three islands.** `ISLANDS` and `BRIDGES` in `config.js`. Home (0, 0) r55, Frostpine (0, −197) r110, Emberleaf (197, 47) r110.
  The Emberleaf bridge runs from home (51.5, 0) to the far landing (82.5, 0).
- **Terrain:** `world/terrain.js` is a dispatcher with the same API as before (`getHeight` including open bridge decks, `getTerrainHeight`
  terrain only, `getGroundType`, `isWalkable`, `regionOf`, `islandAt`, `setBridgeOpen`). Per-island height and ground modules live in
  `world/islands/` (`home.js` unchanged, `frost.js`, `ember.js`). `ember.js` exports `EMBER_FEATURES` (volcano, terraces, cliff radius,
  rim, crater, `lagoon` at local (−45, 52) r8, `spring` at local (58, −52) r3.4) and its module returns `{ height, groundType, walkable,
  inland, paintInfo }`. Meshes: `world/terrainMesh.js` (`buildIslandTerrain`, `buildFarTerrain`, per-biome painters).
- **Gameplay data vs visuals (the key rule).** `world/islandVisuals.js` has two halves:
  - `buildIslandData(island)` runs **once at load on every screen**: colliders, interactables (their ids are the sync ids), harvest and
    gathering records. It must be deterministic from `island.seed`, so host and replica get the same ids in the same order.
  - `buildIslandVisuals(island)` → `{ root, full, far, always, update, setFull, dispose }` can be freed and rebuilt at any time
    (PLAN "Scaling"). Visual state such as felled trees and picked berries is re-applied after a rebuild through runtime hooks.
- **Regions:** `world/regions.js` shows `full` detail for the island under the view centre (60 u coast gap, 72 u hysteresis) and `far`
  versions for the rest (2–3 draw calls each). `always` is for things visible from anywhere, such as the volcano smoke.
- **Chunked props:** `world/propChunks.js` `buildChunkedLayer({ name, geometry, material, outlineGeometry?, items, origin, chunkSize? })`
  makes one InstancedMesh (plus outline) per ~40 u chunk; `locate(item)`, `setItemVisible(item, on, k?)`.
- **Frostpine, the pattern to copy** (all in `world/islands/`):
  - `frostPlacement.js`: **pure** placement (no three.js, Node-tested): landing clearance, walking lanes found by a walkability BFS,
    no props on ramps, lake or steep ground. `sampleFrostSpots(...)` / `FROST_AREAS` sample gathering spots.
  - `frostWorld.js`: gameplay data. Trees are interactable type `tree` with `g.userData.variant`; boulders are `rock` with variant
    `granite`. Reusing the existing types means `getToolAction`, harvest, shake and sync need no new verbs. Instanced trees animate through
    **proxies** (`g.userData.binding.set(key, 'static' | 'proxy' | 'none')`).
  - `frostAssets.js` (cached geometry), `frostVisuals.js` (chunked layers, far blobs, the ice shader), `frostGathering.js` (pure gathering plan).
  - `scatter.js`: shared `scatter`, `safeSpot`, `landingFor`, `polyDist`.
- **Loot:** `world/lootTable.js`: `LOOT[variant]` (trees `{ logs, shake, chop, fell }`, rocks `{ stone, extra }`, each drop
  `{ item, chance, count? }`) and `DIG[islandId]` (`rollDig`). It is consumed by `interactions.js` (shake) and `harvest.js` (chop, fell,
  shatter). The host rolls every drop; replicas only see the resulting pickup events.
- **Gathering:** `world/gathering.js` is multi-island (home plants from `props.handles`, Frostpine's from `world.frost.gather`). Sync ids are
  list indices, with home first and each island appended, so **append Emberleaf after Frostpine** to keep existing ids stable.
- **Catalog:** `game/catalog.js`. Every item has `islands: [...]` (where it can be found); dishes are `['home']` because the campfire is there.
  `log` and `stone` are tagged with all three islands, and `coconut` with home and Emberleaf. Add new items with icons here; pickup models go in
  `world/pickups.js`. `RECIPES` feeds the campfire Cook menu, which scrolls and has 8 rows today.
- **Atmosphere:** `fx/atmosphere.js` eases a region weight from the view centre's island gap and drives Frostpine's snowfall plus a cool
  colour multiplier applied **after** `sky.setTimeOfDay`, so dawn, dusk and night palettes survive. `fx/ambient.js` has a `calm` flag that
  hides fireflies on Frostpine.
- **NPCs and bridges:** `world/npcs.js` (Bramble lives at the home end of the Emberleaf bridge; `npcs.setMenuProvider(id, fn)` adds menu
  rows), `world/bridges.js` (the `bridges` sync domain, saved as `infinite-island.bridges.v1`), `game/cinematic.js` (the shared cutscene
  stage, one cinematic at a time) and `game/bridgeScene.js`.

## 5. Step 30: Emberleaf Isle

Spec: PLAN.md **Step 30**. Split it like Step 29, one sub-step at a time, verifying each before moving on.

### 30a: landscape, props, harvestables, atmosphere (version `0.29.1`)
- **New modules mirroring Frostpine:** `emberPlacement.js` (pure, Node-tested), `emberWorld.js` (gameplay data), `emberAssets.js`,
  `emberVisuals.js`. Remove Emberleaf's placeholders from `teasers.js`. Once nothing uses it, `teasers.js` can go.
- **Props**, seeded from the island seed, about 2.5–3× home's counts (not 4×), dense jungle lowland with real glades, in the chunked layers:
  - Banana palms, coconut palms and broad-leaf jungle trees: type `tree` (or `palm`) with variants, choppable for logs.
  - Breadfruit trees.
  - **Bamboo** clumps, chopped with the axe and dropping `bamboo` instead of logs. Use a `LOOT.bamboo` entry with `logs: [0, 0]` and a `fell`
    drop, or a dedicated variant; keep `getToolAction` unchanged.
  - Volcanic rocks: type `rock`, variant `basalt`, dropping stone with a rare **obsidian** as `extra`.
  - Giant ferns, hanging vines, hibiscus and plumeria flowers (`flower` boing).
  - Decoration: tiki-style carved posts (cute, not scary; match Bramble's bridge posts) and a canoe on a beach.
- **Placement rules:** clear the landing (about 14 u), the bridge deck line, both volcano ramps and the viewing ledge, the lagoon, the hot
  spring, lava and steep ground. Add walking lanes from the landing to the ramps, the lagoon and the spring, checked walkable end to end with
  a BFS as `frostPlacement.js` does.
- **Volcano:** replace the stacked-puff placeholder smoke (it reads like a grey chimney) with a softer, drifting plume that is still visible
  from home (`always` group, 1 draw call). Give the crater lava an **emissive, gently animated** look. Today it's only an orange vertex
  colour in `terrainMesh.js`, so this probably means a small lava shader on the crater area. At night the lava should light the smoke and
  clouds from below (a tint on the plume and maybe a warm point light near the rim; check the light count against the campfire's).
  Lava stays unwalkable (`ember.js` already does this, with a 1 u margin).
- **Hot spring:** steam wisps plus a "cosy" sparkle on a player standing in it (ground type `hotspring`). A small waterfall is optional and
  only worth it if cheap.
- **Atmosphere:** extend `fx/atmosphere.js` with an Emberleaf weight: a warm, humid tint (same "multiply after `setTimeOfDay`" rule),
  occasional drifting ash or pollen motes, and fireflies at night (don't set `calm`).
- **Draw-call budget:** ≤ ~200 at the landing, deep jungle, lagoon, hot spring, volcano ramp, viewing ledge and mid-bridge views; home
  spawn unchanged.
- **Tests:** placement exclusions, deterministic ids, counts in range, lanes walkable.

### 30b: items, gathering, loot, recipes (version `0.30.0`, ticks Step 30)
- **Items** (catalog entries with icons, ground pickup models, `islands: ['ember']`): `banana` (shaking banana palms), `breadfruit`
  (shaking breadfruit trees), `bamboo` (chopped), `pineapple` (pineapple plants, a gathering spot type), `taro` (Emberleaf dig spots, plus
  something rare from digs), `obsidian` (rare from basalt and digs). `coconut` already exists and is tagged for Emberleaf too.
- **Gathering:** `emberGathering.js` (a pure plan like `frostGathering.js`) for pineapple plants, an herb or mushroom equivalent if
  wanted, and dig spots on dark soil or black sand. Append them to `gathering.js` after Frostpine's entries.
- **Recipes** in `RECIPES`: Grilled Banana, Taro & Coconut Bake, Pineapple Skewer, Breadfruit Roast (the PLAN suggestions; tune the
  ingredients). Check the Cook menu still fits and scrolls at phone widths (Step 17/18 layouts).
- **Bramble's text:** after his bridge is built, "Tell me about Emberleaf" and his tips should mention what grows there. Cobble's version is
  a good example.
- **Verify** (as for Step 29, plus the lava and smoke checks):
  - Screenshots by day, dusk and night at gameplay zoom.
  - Every new interaction, done for real.
  - Regrowth and respawn.
  - Cooking each recipe through the real menu.
  - `rebuild('ember')`.
  - Two tabs with equal hashes plus a `sync.stress` run.
  - Draw calls, startup time (`__game.loadMs`) and JS heap before and after.

## 6. Step 31: Archipelago life

Spec: PLAN.md **Step 31** and the "Inventory tracking" and "Who moves together?" design decisions. It's large, so split it, for example as below.
Bump the patch per sub-step and finish at `0.31.0`.

- **31a: HUD tracking and the Bag panel.**
  - `ui/inventoryBar.js` shows a chip only if the item's `islands` include the island of at least one of **this screen's** local players,
    or the active quest needs it. Dishes show on home for now. Planned Steps 33 and 37 (PLAN.md) add cooking campfires on Frostpine and Emberleaf,
    so derive "islands with a campfire" from a list of fires rather than hard-coding home.
  - A player standing on a bridge counts as being on the island they came from, with hysteresis (use `regionOf`; the sea counts as the last island).
  - Add a **Bag panel** that lists everything, grouped by island. Open it by tapping the bar, or with Tab or B; check those keys aren't
    already bound in `input/keyboardSource.js`.
  - Add a region-name toast ("Frostpine Isle") when a screen's players arrive on an island.
  - The bag itself and its save format don't change.
  - Check every viewport from Step 17/18, including touch layouts where the bar sits top-left.
- **31b: Quests.**
  - Add feast templates to `game/quests.js` that use the new islands' items and dishes.
  - Offer them only once the matching bridge is built (read the `bridges` domain state), and keep the never-repeat pick working.
  - The feast scene builds a dish model per template (`food` in each template), so give the new templates food models.
- **31c: Travel and regroup.**
  - "Join a friend" in `ui/optionsMenu.js`: poof this screen's players next to a player on another screen, only onto an unlocked island,
    snapping to a collider-free walkable spot.
  - A "Home" row from the builders: either an NPC presence at the far landing, or a signpost there.
  - A "Wait for P2!" bubble when the tether stops a player at a bridge (tether logic is in `players/playerManager.js`).
- **31d: Collections and the Journal.**
  - 6–8 collectibles per island, found as rare drops from shakes, digs and breaks (add `collect` entries to the loot tables), plus
    glinting beach spots.
  - They live in a new host-authoritative sync domain saved as `infinite-island.collection.v1`, kept separate from the bag.
  - A Journal panel shows them.
  - Ask the user whether completing an album should unlock a hat on the Step 26 rack, since hats currently unlock by feast count only
    (`game/hatLogic.js`).
- **31e: Music and ambience.**
  - One new procedural track per island in `audio/music.js`: Frostpine as music-box bells in 3/4; Emberleaf as log drums with a pluck lead.
  - Chosen by the screen's region **between tracks only**, the same way day and night pools are chosen today.
  - Region ambience in `audio/ambience.js`: wind gusts and an owl at night on Frostpine; tropical birds by day and frogs at night on Emberleaf.
  - Audio can't be checked by ear: verify structurally (node graph, gains, `music.renderTrack(i, s)` offline levels, RMS about 0.14 and
    peaks ≤ 0.8 before the bus, like the existing tracks) and say so.

## 7. Open items to raise with the user

- **Frostpine density:** from above, Frostpine's forest reads a little sparse and evenly spread. The user hasn't decided whether to make the
  forest tiers denser. Ask before changing it.
- **31d scope:** the Journal and collectibles were added by the planner for the "collectible items" ask. Confirm the scope and the hat
  unlock link before building it.
- **Not yet verified by anyone:** audio by ear, real phones and GPUs, PeerJS (unreachable at handoff), a real standard gamepad.

## 8. Definition of done (each step)

1. `npm test` passes, with new Node tests for anything pure.
2. Verified in a browser:
   - A fresh `?newgame` tab with a clean console (apart from known PeerJS network errors).
   - Home spawn looks unchanged and stays within budget.
   - Screenshots of the new content.
   - Every new interaction done for real.
   - Two tabs with equal hashes.
   - `rebuild` unchanged.
   - Draw calls within budget.
3. Docs updated (README, CLAUDE.md module notes and "State at hand-off", PLAN.md progress tick with numbers), and the version bumped
   in all four places.
4. A plain report to the user covering what was verified, what wasn't, and any deviations from PLAN.md with reasons. Then **ask before
   committing.**
