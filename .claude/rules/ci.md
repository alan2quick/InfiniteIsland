# Continuous integration

- GitHub Actions runs `node tools/check.mjs` and `npm test` on Windows and Ubuntu for every push to `main` and every pull request (`.github/workflows/ci.yml`).
- Before a commit, run `node tools/check.mjs` (a few seconds: syntax of every file, broken imports, version agreement) and the test suite. Do not push on red.
- If CI fails after a push, say so first and fix it before starting anything else: `gh run list --limit 3`, then `gh run view <id> --log-failed | tail -40`.
