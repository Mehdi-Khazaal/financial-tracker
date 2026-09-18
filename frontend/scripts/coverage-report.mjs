/**
 * Per-file coverage for the frontend's money logic, with floors.
 *
 * The overall number is dominated by page components whose behaviour the
 * Playwright suite exercises in a real browser; the pure calculation modules
 * are where a wrong number would reach the screen unnoticed, so those carry
 * their own floors. Run after `vitest run --coverage`:
 *
 *   node scripts/coverage-report.mjs            # print + enforce
 *   node scripts/coverage-report.mjs --list     # print every module in scope
 *
 * Floors sit a few points under what was measured when set (2026-09-18).
 */
import { readFileSync } from 'node:fs';

const summary = JSON.parse(readFileSync(new URL('../coverage/coverage-summary.json', import.meta.url), 'utf8'));

// A path matching one of these patterns must meet the paired line floor.
const FLOORS = [
  [/src\/features\/[^/]+\/calculations\//, 85],
  [/src\/utils\/contrast\.ts$/, 95],
  [/src\/lib\/deepLinks\.ts$/, 90],
];
const OVERALL_LINES_FLOOR = 50;

const rows = Object.entries(summary)
  .filter(([file]) => file !== 'total')
  .map(([file, data]) => ({
    file: file.replace(/\\/g, '/').replace(/^.*?\/src\//, 'src/'),
    lines: data.lines.pct,
    branches: data.branches.pct,
    functions: data.functions.pct,
  }));

const inScope = rows
  .map(row => ({ ...row, floor: FLOORS.find(([pattern]) => pattern.test(row.file))?.[1] }))
  .filter(row => row.floor !== undefined)
  .sort((a, b) => a.lines - b.lines);

const failures = [];
for (const row of inScope) {
  const ok = row.lines >= row.floor;
  if (!ok) failures.push(row);
  if (!ok || process.argv.includes('--list')) {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${row.file.padEnd(62)} lines ${String(row.lines).padStart(6)}%  branches ${String(row.branches).padStart(6)}%  (floor ${row.floor}%)`);
  }
}
const overall = summary.total.lines.pct;
console.log(`${inScope.length} money-logic modules checked; ${failures.length} below floor. Overall lines ${overall}% (floor ${OVERALL_LINES_FLOOR}%).`);
if (overall < OVERALL_LINES_FLOOR) failures.push({ file: 'overall' });
process.exit(failures.length > 0 ? 1 : 0);
