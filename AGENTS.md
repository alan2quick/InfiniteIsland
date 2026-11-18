# Infinite Island: instructions for coding agents

Read by Codex directly and by Claude Code through `CLAUDE.md`. Keep it under 120 lines: it is loaded into every
session, sub-agent and Codex run. Details belong in the files it points to.

A cozy Three.js island game (Animal Crossing / Stardew style) for up to 4 players: one shared screen (keyboard,
gamepads, phones as controllers) or one device each (PeerJS). Plain ES modules, **no build step**, static deploy to
Vercel. Repo: https://github.com/alan2quick/InfiniteIsland, branch `main`; a push to `main` redeploys.

## Where things are (grep these; never read them whole)

| File | Size | What it is | How to use it |
|---|---|---|---|
| `PLAN.md` | 17 KB | Index: direction, step table, open steps, backlog | Read "3. How this plan is organised" and "Open steps" |
| `plan/<n>-<slug>.md` | 8-90 KB | One feature arc: spec + `- [ ]` progress lines | Read only the arc you are working on |
| `plan/CHANGELOG.md` | 270 KB | Per-step build notes, newest first | `grep -n "Step 81b"`, then read that line range |
| `docs/ARCHITECTURE.md` | 112 KB | Module contracts, sync domains, `localStorage` key table | Grep by module or file name |
| `README.md` | 223 KB | Player-facing docs, debug flags, structure map | Grep by heading (`grep -n "^## " README.md`) |
| `DUNGEON_PLAN.md` | 7 KB | Wildroot Hollow spec (Steps 41-46) | Only for dungeon work |

Lines in these files can be several KB long, so a grep hit can be large: pipe through `cut -c1-300` first.

## Run and test

- `npm install`, then `npm start` (http://localhost:3000). Client files are served fresh; only `server.js` edits need a restart.
- `npm test` (Node's built-in runner, no browser). In a sandbox that fails with `spawn EPERM`, run files one at a
  time: `node --test --test-isolation=none test/<file>.test.js`.
- While working, run only the test files for what you touched (`node --test test/boat*.test.js`). Run the full
  suite once before you report a step as done.
- Tests cover logic and data. Rendering, input wiring in `public/js/main.js` and anything visual are checked in a
  browser through `window.__game` (debug hooks and `?flags` are listed in README "Debug flags").

## Contracts that must not break (details: docs/ARCHITECTURE.md)

- **Input:** a source's `poll()` returns `{x, y, interact, cancel, jump?, charm?, menu?, *Tap?}` (y up-positive,
  screen-up = world -Z). One `InputManager` per device turns it into `player.actions`.
- **Multiplayer first:** every interaction takes a `player`, works per player and on replica screens; never assume P1.
  Solo play must look and behave as before.
- **Registries are module singletons** (`interactables.js`, `colliders.js`): register gameplay data once; a visual
  rebuild (`world.rebuild(id)`) must never add or lose registrations.
- **World sync is host-authoritative:** domains register `{snapshot, applySnapshot, applyEvent, handleRequest,
  hashView?}` with `net/worldSync.js`. The host decides all randomness and runs all timers; replicas send requests
  and wait for events; `__game.sync.hashes()` must match across screens; replicas never save.
- **Islands:** `ISLANDS` / `BRIDGES` in config; read extents through `world/islands/extent.js`, never
  `radius + margin`. Seeded placement is hash-pinned in tests: do not change what earlier sampling accepts.
- **Cinematics:** one at a time through `game/cinematic.js`; check `cinematic.busy` first.
- **Rendering budget:** about 200 draw calls at gameplay view (party stages: under 400k triangles), no new lights,
  reuse shared programs (`render/toon.js`, merged / instanced meshes). Anything drawn on a character writes stencil 1.
- **Party games:** a pure logic file in `game/party/` exporting `GAME {...}` + a stage in `world/party/`; `g` only
  changes through `apply` (contract: plan/80-party-games.md).
- **Persistence:** wrap every storage access in try/catch; host-only saves; add a row to the key table in
  docs/ARCHITECTURE.md when you add a key.
- **Pinned versions:** three@0.186.1 (import map injected by `index.html`), peerjs@1.5.4, qrcode-generator@1.4.4.
  In three 0.186 use `PCFShadowMap` and `THREE.Timer`.

## Conventions

- Match the surrounding code: a file header that explains the module and its API, short "why" comments, modules
  export `createX(...)` or a class returning `{update(dt), ...}`. Tunables go in `public/js/config.js`.
- Look: chunky, cute, vibrant; toon materials, dark `#2b2340` outlines, palette in `config.js`. UI is comic-style
  with the Fredoka font. Use inline-SVG icons from `ui/icons.js`, not emoji.
- Static-host compatible: no new server dependencies; `server.js` is an optional local fallback.
- Line endings: LF. If the repo has no `.gitattributes`, keep each file's existing endings instead.
- Version: `VERSION` in `public/js/config.js` is the source of truth; keep `package.json` and both places in
  `package-lock.json` equal to it. Scheme `0.<last completed PLAN step>.<patch>`.

## Workflow rules (from the owner)

- **Commit and push only when the owner asks.** After each change say plainly what was verified and what was not
  (audio by ear, real phones, real gamepads), then ask.
- **`scratchpad/` is private.** Do not open, list, search or commit it, and do not save your own files there.
- **Other tools work here too** (Claude Code and Codex). Before starting and before committing, check `git status`
  and `git log` for work you did not write; do not overwrite or reorganise it without asking.
- **A step** = a spec in its `plan/` arc file, then code + tests, then landing. Big features are split into
  lettered sub-steps (86a, 86b ...); land each sub-step on its own.
- **Landing a step:** tick its box in the arc file; add the write-up (built / measured / not verified) at the top
  of `plan/CHANGELOG.md`; update its row and "Open steps" in `PLAN.md`; update docs/ARCHITECTURE.md if a contract
  changed; update the README section for anything a player can see or a debug flag; update "Current state"
  below (three lines at most). Never add step notes to this file.
- More rules for specific tools and folders live in `.claude/rules/*.md`. Read them if you are not Claude Code
  (Claude Code loads them by itself).

## Current state

- **Version 0.86.0**: Step 86 (Homesteading) is complete. Details: the top entries of `plan/CHANGELOG.md`.
- **Next:** Step 74e "Pup on the Ice" (spec in plan/74-home-frost-pets.md); Crownlands tuning from the 85a-d
  changelog entries; the rest is under "Open steps" in PLAN.md.
- **Never verified by anyone:** audio by ear, real phones, real-device GPU cost, a real standard gamepad, kids' feel
  and balance of the party games. Each step lists its own gaps in its changelog entry.
