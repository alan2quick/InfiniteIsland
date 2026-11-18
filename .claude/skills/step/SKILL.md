---
name: step
description: Build one lettered sub-step of Infinite Island with delegated agents (builder, test writer, reviewer) so the main session stays small.
argument-hint: "[step id, e.g. 74e]"
disable-model-invocation: true
---

Build step $ARGUMENTS. You are the coordinator: you plan, delegate and decide. You do not write the code, read the
big docs or run the test suite yourself.

1. **Scope.** Find the step's spec: `grep -n "Step $ARGUMENTS" plan/*.md | cut -c1-200`, read that section only.
   If the step is larger than about one module + its scene wiring, or about 800 changed lines, stop and propose
   lettered sub-steps to the owner before building. Each sub-step must be playable or testable on its own.
2. **Build.** Start the `step-builder` agent with: the step id, the arc file path, the files to read (list them),
   and any decision the owner has made. Wait for its report.
3. **Tests.** Start the `test-writer` agent with: the step id, the arc file path and the builder's report. It
   writes tests from the spec. If it reports a suspected bug, send that back to `step-builder` (do not edit the test).
4. **Run.** Start the `test-runner` agent for the whole suite. Fix failures through `step-builder`.
5. **Review.** Start the `reviewer` agent. If the owner uses Codex, also run `/codex-review` (a second reviewer
   from a different model finds partly different problems). Treat findings as claims to check, not as orders:
   confirm each with a test or a probe before changing code.
6. **Look.** For anything visual run `/browser-verify` and check it in the Browser pane with `__game` probes;
   screenshots only for the look itself.
7. **Report to the owner** in at most 15 lines: what was built, test totals, review findings and what you did
   about each, what is NOT verified. Ask before landing or committing.

When the owner says to land it, run `/land-step $ARGUMENTS`.

If the session is getting long (many tool results, or a compaction has happened), run `/handoff` and tell the owner
to start a fresh session with `/clear`: a fresh session with a 10-line handoff is cheaper and more accurate than a
long one.
