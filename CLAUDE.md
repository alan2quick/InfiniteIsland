@AGENTS.md

## Claude Code only

- **Delegating a step:** each step is implemented by a Sonnet sub-agent. Give it the step's `plan/` arc file (not
  PLAN.md) and the list of files to read. The main session then verifies the result before reporting. Small tweaks
  can be done directly.
- **Browser verification:** run `/browser-verify` before the first browser check of a session. It holds the
  Browser pane techniques (stepping the simulation, fake devices, two-screen tests, screenshots). The launch
  configs are in `.claude/launch.json`: `island` (Node server, port 3000) and `static` (port 8080, simulates Vercel:
  no `/api`, `/ws` or `/vendor`). After a `server.js` edit: `preview_stop`, then `preview_start {name:"island"}`.
- **Delegating to Codex:** when the owner asks for a step to go to Codex, drive the Codex CLI headless from Bash:
  `codex exec -c 'windows.sandbox="unelevated"' --sandbox workspace-write -o <session scratch>/codex-out.md "<prompt>" < /dev/null`
  from the repo root; follow up with `codex exec resume --last "<more>"`.
  - The `-c` override is required: `~/.codex/config.toml` sets `windows.sandbox = "elevated"`, whose shell fails to
    start when another program launches Codex. Do not edit that config. (`codex mcp-server` is gone in codex-cli 0.162.)
  - Say "do not run git commit or git push" in every prompt, then check `git status` / `git log` afterwards.
  - One Codex task at a time; do not edit the same files meanwhile. Long steps can use `run_in_background`.
- **Commits:** straight to `main`, descriptive message, with the trailer
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (use the name of the model that wrote the change).
  The repo-local git identity is `alan2quick` / `abng87@gmail.com`.
- **The owner has a real Mayflash GameCube USB adapter** (Vendor 0079, Product 1846) that may be plugged in. It
  shows up in `navigator.getGamepads()` and logs `[gamepad] #0 ... -> gamecube`. That is real hardware, not test code.

# Compact instructions

When compacting, keep: the step id and its arc file, the list of files changed, failing test names with their
messages, what has been verified and what has not, and any decision the owner made. Drop file contents, passing
test output and screenshots.
