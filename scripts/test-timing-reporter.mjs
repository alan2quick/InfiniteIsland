import { recordRun } from './test-history.mjs';
// Node test-reporter protocol: collect measurements without filtering tests.
import { writeFileSync } from 'node:fs';
import { inspect } from 'node:util';

export default async function* timingReporter(events) {
  const timings = [];
  let summary;
  for await (const { type, data } of events) {
    if (type === 'test:pass' || type === 'test:fail') {
      timings.push({ name: data.name, file: data.file, durationMs: data.details.duration_ms,
        status: type === 'test:pass' ? 'pass' : 'fail' });
      if (type === 'test:fail') {
        yield `FAIL ${data.name}\n${inspect(data.details.error, { depth: 5, colors: false })}\n`;
      }
    }
    if (type === 'test:summary' && !data.file) summary = data;
  }
  const sorted = timings.sort((a, b) => b.durationMs - a.durationMs);
  yield '\nSlowest tests (wall time includes contention from parallel test files):\n';
  for (const t of sorted.slice(0, 15)) yield `${t.durationMs.toFixed(1).padStart(9)} ms  ${t.file?.split('/').pop()}: ${t.name}\n`;
  if (summary) yield `\n${summary.counts.tests} tests; ${summary.counts.passed} passed; ${summary.counts.failed} failed; ${summary.duration_ms.toFixed(1)} ms total\n`;
  if (summary) {
    recordRun(summary, sorted, { context: JSON.parse(process.env.TEST_RUN_CONTEXT || '{}') });
    yield 'History updated: test-results/history.md\n';
  }
  if (process.env.TEST_TIMING_REPORT) {
    writeFileSync(process.env.TEST_TIMING_REPORT, JSON.stringify({ runtime: process.version, platform: process.platform,
      arch: process.arch, summary, tests: sorted }, null, 2) + '\n');
    yield `Timing report saved to ${process.env.TEST_TIMING_REPORT}\n`;
  }
}
