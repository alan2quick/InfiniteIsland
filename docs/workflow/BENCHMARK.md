# Measuring the workflow

The goal: when you change how you build a step (a different model, a smaller step, a new tool), know within two or
three steps whether it helped, from numbers and not from how the session felt.

## The five numbers per step

Record one row when a step lands. It takes about a minute.

| Number | Where it comes from | What it tells you |
|---|---|---|
| **Limit used** (% of the 5-hour window) | `/usage` in Claude Code, read at the start and the end of the step | The thing that actually stops you |
| **Tokens by model** | `npx ccusage@latest session` (reads Claude Code's local logs; `npx @ccusage/codex@latest` for Codex) | Which model the limit went to |
| **Changed lines: code / tests / bookkeeping** | `node tools/step-stats.mjs --steps` | How big the step was, and how much was paperwork |
| **Mutation score of new logic** | `node tools/mutate.mjs <module>` (if merged) | Whether the tests check the behaviour |
| **Rework** | Count of "fix / playtest / tweak" commits for that step in the following week | What the step really cost |

Keep the rows in `docs/workflow/ledger.md` (a plain table; one line per step). Two derived numbers are worth
looking at across steps: **limit % per 1,000 lines of code** and **rework commits per step**.

## Where measuring is worth it

1. **At the start of a step, before building.** Run `/context` once. If the session already holds more than about
   30% of its window before any work, something loads too much (a large doc was read, a long conversation was not
   cleared). Fix that first: it is paid again on every later message of the session.
2. **When you change one thing.** Change one variable at a time and compare two or three steps before and after:
   - main session on Sonnet (or `/model opusplan`) instead of Opus;
   - implementation delegated to a sub-agent or to Codex instead of done in the main session;
   - a step split into lettered sub-steps, each landed on its own, instead of one large step;
   - tests written by a separate agent from the spec instead of by the implementer.
3. **When the limit runs out before a step closes.** Run `/usage` and read its breakdown: it attributes recent usage
   to sub-agents, skills and connectors and lists what cost the most. That, not a guess, is what to fix next.
4. **Once a week:** `node tools/step-stats.mjs`. Watch lines per commit (steps growing again?) and rework share.

Not worth measuring: single prompts, or anything you would not change your behaviour over.

## Baseline (from git history, 2026-09-30 to 2026-10-29)

| Week of | Commits | Median lines / commit | Median files / commit | Bookkeeping files / commit | Authors |
|---|---|---|---|---|---|
| 09-28 | 54 | 487 | 13 | 4 | Claude Opus 41, Codex or manual 13 |
| 10-05 | 24 | 1,332 | 22 | 5 | Claude Opus 19, Codex or manual 5 |
| 10-12 | 23 | 916 | 21 | 5 | Claude Opus 22, Codex or manual 1 |
| 10-19 | 5 | 2,169 | 36 | 5 | Claude Opus 5 |
| 10-26 | 15 | 957 | 30 | 7 | Claude Opus 14, Claude Sonnet 1 |

Reading: commits became 2 to 4 times larger while their number fell, and Codex stopped contributing after the
second week. Step 86 landed as one commit of 6,259 changed lines across 55 files.

## A repeatable test task (optional)

To compare two set-ups on the same work, replay a small past step on a throwaway branch:
`git switch -c bench/75 6ae9f25~1` puts the tree just before Step 75 (tool racks). Give the agent
`plan/75-tool-racks.md` and let it build. Compare limit used, changed lines and the mutation score of its logic
module with the original commit. Delete the branch afterwards. The original tests will not run against a new
implementation (module names differ), so judge by the spec and the mutation score, not by the old test file.
