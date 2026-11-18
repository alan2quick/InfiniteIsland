---
name: handoff
description: Write a short handoff note so the work can continue in a fresh session after /clear.
disable-model-invocation: true
---

Write `.claude/session-handoff.md` (it is git-ignored), at most 25 lines, for a reader with no memory of this session:

- Step id, arc file path, and the one-sentence goal.
- Done: files added / changed (paths only).
- State of the tests: totals, and failing test names with the first line of each message.
- Decisions the owner made in this session (these are the easiest thing to lose).
- Next: the next three actions, concrete enough to start without re-reading anything.
- Not verified yet.

Do not paste code or test output. Then tell the owner: "Run /clear, then say: read .claude/session-handoff.md and continue."
