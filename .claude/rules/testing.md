# Running tests

- `npm test` prints only failures and a totals line. Do not pipe it through `head` / `tail` / `grep`: the output is already short.
- While working: `npm run test:changed` runs only the test files that import (directly or indirectly) a file you changed since HEAD.
- One area: `node tools/test.mjs boat fishing` (matches test file names).
- Before reporting a step as done, and before any commit: the whole suite, `npm test`.
- A test that fails only sometimes: `node tools/test.mjs --repeat=5 <name>` reports it as flaky. Fix the cause (usually unseeded `Math.random` or real time), never retry it into passing.
- The stock one-line-per-test output is still there as `npm run test:tap`.
