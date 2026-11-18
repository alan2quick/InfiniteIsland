# Branches and commits

- One branch per step: `git switch -c step/74e-pup-on-the-ice`. Commit each lettered sub-step when its tests pass (ask the owner first, as always). Small commits are free checkpoints: `git diff` stays small, and a bad turn can be undone with `git restore` instead of re-explained.
- Pushing a branch does not change the live game. Vercel builds a preview URL for the branch; use it to try the step on a real phone or a second screen before it reaches `main`.
- When the step is verified, merge it into `main` (`git switch main && git merge --no-ff step/74e-pup-on-the-ice && git push`), then delete the branch (`git branch -d ...`, `git push origin --delete ...`).
- Quick fixes that are one small commit can still go straight to `main`.
- Never leave more than a day of work uncommitted.
