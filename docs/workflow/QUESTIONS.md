# Questions for Alan and his Claude

Stephen's Claude reviewed this repo from the outside. It could read the code and the git history. It could not see
your PC, your Claude Code settings or your token use. The answers below fill those gaps, so the advice in the other
pull requests can be checked against real numbers.

**How to answer:** reply in a comment on this pull request, or fill in the blanks in this file. Short answers are
fine. Skip anything you prefer not to share. This pull request does not need to be merged; close it when you are done.

**For Alan's Claude, before you start:**
- Give numbers and one-line answers only. Do not paste conversation text, file contents, keys, tokens or e-mail addresses.
- Do not open, list or search `scratchpad/`.
- Run the commands from the repo root. Each one only reads. Nothing here changes a file or a setting.
- If a command fails, write the first line of the error and go on.

## 1. The machine (about 1 minute)

| Command | Answer |
|---|---|
| `node -v` | |
| `npm -v` | |
| `git --version` | |
| `git config core.autocrlf` | |
| `claude --version` | |
| `codex --version` | |
| Windows version (10 or 11) | |
| Shell that Claude Code uses for Bash (Git Bash, PowerShell, WSL) | |

## 2. The tests on Windows (about 2 minutes)

Run `npm test` once and answer from its last lines.

| Question | Answer |
|---|---|
| Total tests, pass, fail | |
| Names of the failing tests (first line of each) | |
| Run time in seconds | |
| Number of CPU cores (`node -p "os.cpus().length"`) | |

Background: on Linux one test fails (`mechlab`, the frozen lake). On an Apple-silicon Mac five more fail: the
pinned-hash and golden-sample placement tests for Emberleaf, Frostpine and the home island. We need to know which
group Windows is in.

## 3. Where the Claude limit goes (about 3 minutes)

| Question | How to find it | Answer |
|---|---|---|
| Claude plan (Pro, Max 5x, Max 20x) | Alan knows | |
| Tokens in the last five 5-hour blocks, by model | `npx ccusage@latest blocks` (reads local logs only) | |
| The three most expensive sessions of the last two weeks: total tokens and model | `npx ccusage@latest session` | |
| Context used at the start of a fresh session, before any work (percent, and the three largest items) | `/context` | |
| What `/usage` lists as the top costs | `/usage` | |
| Size of the user-level instruction file, in bytes | size of `%USERPROFILE%\.claude\CLAUDE.md`, if it exists | |
| Number of MCP servers and plugins that load in this project | `/mcp`, `/plugin` | |
| Any hooks in `.claude/settings.json` or the user settings (yes or no, and what they do in one line) | | |

## 4. How a step is really built (Alan, in your own words)

1. Which model is the main session on (Opus, Sonnet, `opusplan`)? Which effort level?
2. For a step such as 86: about how many sessions did it take, and how many times did the limit stop you?
3. At which stage does the limit usually run out: planning, building, testing, browser checks, or the paperwork at the end?
4. Does the main session read `README.md` whole at the start, as `CLAUDE.md` asks?
5. How often do you use `/clear`? How often does a session compact by itself?
6. How many sub-agents run for one step, and do they run one after another or together?
7. Who decides that a step is done: you after playing it, or Claude after its own checks?

## 5. Codex

1. Which Codex plan do you have, and how much of its limit do you use in a normal week?
2. Codex wrote commits until Oct 16 and none after. Was there a reason (quality, the Windows sandbox problem, habit)?
3. Does this still work on your PC today?
   `codex exec -c 'windows.sandbox="unelevated"' --sandbox read-only "Say OK and nothing else." < NUL`
4. Is the Codex plugin for Claude Code installed (`/codex:review`)?

## 6. Deployment

1. Is Vercel connected to this repo so that a push to `main` goes live? (CLAUDE.md says "if the repo is connected".)
2. Do branch pushes get a preview link?
3. Has a broken version ever reached the live game? What happened?

## 7. What you want

1. Which devices does your daughter play on (TV with gamepads, tablet, phone)? This decides which checks matter most.
2. Are branches and pull requests acceptable to you, or do you prefer to stay on `main`?
3. Is it acceptable for GitHub Actions to run the tests on every push? (Free for a public repo.)
4. Of your "never verified" list (audio by ear, real phones, real gamepad, GPU cost, kids' feel), which one worries you most?
5. What is the one thing in your current workflow that you do not want anyone to change?
