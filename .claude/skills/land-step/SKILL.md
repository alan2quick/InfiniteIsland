---
name: land-step
description: Land a verified step - docs, changelog, PLAN row, version - through the step-lander agent, then prepare the commit.
argument-hint: "[step id] [new version, e.g. 0.86.1]"
disable-model-invocation: true
---

Land step $0 as version $1.

1. Confirm the whole suite is green (use the `test-runner` agent; do not run it in this context). Do not land on red.
2. Start the `step-lander` agent with: the step id, the version, the builder's report, the test totals, and the
   verified / not verified lists. It edits the docs and the version numbers.
3. Show the owner `git status --short` and `git diff --stat`, and a proposed commit message:
   `Add Step $0: <what the player gets> ($1)`.
4. Commit and push only when the owner says so.
