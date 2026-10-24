import test from 'node:test';
import assert from 'node:assert/strict';
import { selectTests } from '../scripts/test-batches.mjs';
test('every test belongs to exactly one batch, with no missing files', () => {
  const { groups, files } = selectTests();
  assert.equal(Object.values(groups).flatMap(g => g.files).length, files.length);
  assert.ok(files.includes('test/testBatches.test.js'));
});
test('selected batches combine without duplicates and unknown names fail', () => {
  const { files, groups } = selectTests(['world','gameplay','world']);
  assert.equal(files.length, groups.world.files.length + groups.gameplay.files.length);
  assert.ok(!files.includes('test/partyBonk.test.js'));
  assert.throws(() => selectTests(['edtor']), /Unknown batch/);
  assert.deepEqual(selectTests(['all']).files, selectTests().files);
});

import { renderHistory, recordRun } from '../scripts/test-history.mjs';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
test('history compares matching successful scopes and retains failed runs', () => {
  const base={finishedAt:'2026-10-24',batch:'editor',scope:'editor',machine:'local',runtime:'v24',platform:'darwin',arch:'arm64',tests:10,failed:0,skipped:0,cancelled:0,durationMs:1000,commit:'abcdef123'};
  const table=renderHistory([base,{...base,scope:'other',durationMs:9000},{...base,failed:1,durationMs:2000},{...base,tests:12,durationMs:1500}]);
  assert.match(table,/\+0.50s \(50.0%\)/); assert.match(table,/\+2/);
  assert.equal((table.match(/First comparable run/g)||[]).length,2);
});
test('history appends records and renders a readable table', () => {
  const directory=mkdtempSync(join(tmpdir(),'island-history-'));
  try {
    recordRun({counts:{tests:2,passed:1,failed:1},duration_ms:20},[],{directory,context:{batch:'unit',scope:'unit',commit:'abc',dirty:false}});
    recordRun({counts:{tests:2,passed:2,failed:0},duration_ms:10},[],{directory,context:{batch:'unit',scope:'unit',commit:'abc',dirty:false}});
    assert.equal(readFileSync(join(directory,'runs.jsonl'),'utf8').trim().split('\n').length,2);
    assert.match(readFileSync(join(directory,'history.md'),'utf8'),/\| Failed \|/);
  } finally {rmSync(directory,{recursive:true,force:true});}
});
