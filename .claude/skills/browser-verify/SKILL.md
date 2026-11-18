---
name: browser-verify
description: How to verify Infinite Island in the Claude desktop Browser pane through window.__game (stepping the simulation, fake players and phones, two-screen tests, screenshots, audio checks). Use before the first browser check of a session.
---

# Verifying in the Browser pane

These tips came from painful experience. They used to live in CLAUDE.md, where every session paid for them; here
they load only when a browser check is about to happen.

Report back in at most 15 lines: what you checked, the numbers you measured, what you could not verify. Take a
screenshot only when a look is the thing being checked; a `__game` probe that returns a number is cheaper and repeatable.


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
