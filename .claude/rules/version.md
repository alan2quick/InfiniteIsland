# Version numbers

- Bump with one command: `node tools/bump.mjs 0.86.1`. It updates `VERSION` in `public/js/config.js`, `package.json` and both fields in `package-lock.json`. Do not edit those by hand.
- `node tools/bump.mjs --check` says whether the four places agree.
- Do not assert the current version number in a test. `test/homesteadUnlock.test.js` already checks that the four places agree; a test that pins `'0.86.0'` only has to be edited at every bump.
