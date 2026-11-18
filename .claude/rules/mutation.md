# Checking that tests can fail

- After writing or changing tests for a logic module, run `node tools/mutate.mjs public/js/game/<name>Logic.js`. It makes small wrong edits to a copy of the module and reports the ones no test noticed.
- Read each "survived" line. Add a test when the edit is a real behaviour change (a boundary, a rejected input, a sign). Leave it when the edit changes nothing a player or another module could observe, and say so in the report.
- Report the result line ("27/30 mutants killed") with the step. Do not chase 100%.
- It takes a few minutes when the module's tests are slow; run it once per module, not after every edit.
