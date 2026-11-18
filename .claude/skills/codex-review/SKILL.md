---
name: codex-review
description: Ask Codex (a different model) to review the uncommitted change, read-only, and bring back only its findings.
argument-hint: "[optional focus, e.g. 'host/replica sync']"
disable-model-invocation: true
---

Get a second opinion on the uncommitted change from Codex. Codex only reads; it must not edit or commit.

Run from the repo root (the `-c` override is needed on this Windows machine; see CLAUDE.md):

```bash
codex exec -c 'windows.sandbox="unelevated"' --sandbox read-only -o "${TMPDIR:-/tmp}/codex-review.md" "Review the uncommitted change in this repository (git status, git diff HEAD). Read AGENTS.md for the contracts. Focus: $ARGUMENTS. Report only problems you can point at: file:line, what is wrong, a concrete input or sequence that shows it, and whether you are certain or guessing. Look for: rules in the plan/ spec that the code gets wrong, multiplayer and host/replica mistakes, tests that cannot fail or that copy the implementation's output, missing edge cases. No style comments. Do not modify any file. Do not run git commit or git push. At most 12 findings, most serious first." < /dev/null
```

Then read `${TMPDIR:-/tmp}/codex-review.md` and check `git status` to confirm Codex changed nothing.

Treat each finding as a claim, not a fix. For each one: confirm it with a test or a probe, then fix it or say why it
is not a problem. Do not let Codex rewrite the code: in one published test, a second model reviewing a strong
model's draft without running anything lowered the pass rate. A finding is only worth acting on once it is proven here.

Report to the owner: findings confirmed (and fixed), findings rejected (one line each, with the reason).

If the Codex plugin for Claude Code is installed, `/codex:adversarial-review` does the same job.
