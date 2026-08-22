import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scheduledStartBefore, scheduledWindowParts } from '../stamps/counted-day.ts';

// scheduledWindowParts turns ONE proposed absence window into the stretches
// that may actually be booked: its intersection with the day's scheduled
// fasce, snapped inward to a quarter-hour grid.
//
// Times are plain minute counts here — the function is pure epoch-ms
// arithmetic, and a fake epoch keeps the fixtures readable.
const MIN = 60_000;
const QUARTER = 15 * MIN;
const at = (hhmm: number): number => (Math.floor(hhmm / 100) * 60 + (hhmm % 100)) * MIN;
const iv = (from: number, to: number) => ({ start: at(from), end: at(to) });
const parts = (
  win: { start: number; end: number },
  work: Array<{ start: number; end: number }>
): string[] =>
  scheduledWindowParts(win, work, QUARTER).map(
    (p) => `${p.start / MIN}-${p.end / MIN}`
  );
const mins = (win: { start: number; end: number }, work: Array<{ start: number; end: number }>) =>
  scheduledWindowParts(win, work, QUARTER).reduce((s, p) => s + (p.end - p.start) / MIN, 0);

// One fascia: the window is its own only part, unchanged. This is every
// non-split schedule, and the behaviour that predates the split-shift fix.
test('single fascia: the window passes through untouched', () => {
  assert.deepEqual(parts(iv(1300, 1700), [iv(900, 1700)]), [`${13 * 60}-${17 * 60}`]);
});

// The proven Time System scenario: 09:00–13:00 + 14:00–18:00, out at 12:00.
// The proposal spans 12:00–18:00 = 6h, but only 5h of it is contracted work.
test('split shift: the unpaid inter-fascia gap is dropped, not booked', () => {
  const work = [iv(900, 1300), iv(1400, 1800)];
  assert.deepEqual(parts(iv(1200, 1800), work), [`${12 * 60}-${13 * 60}`, `${14 * 60}-${18 * 60}`]);
  // …and 300 minutes is exactly what the day's own short_hours delta says.
  assert.equal(mins(iv(1200, 1800), work), 300);
});

test('a window that lies entirely inside the gap books nothing', () => {
  assert.equal(scheduledWindowParts(iv(1310, 1350), [iv(900, 1300), iv(1400, 1800)], QUARTER).length, 0);
});

// The ends are trimmed to the schedule too: an exit at 13:30 is 30 minutes into
// the unpaid gap, and none of them are absence.
test('window ends are trimmed to the fasce', () => {
  assert.deepEqual(parts(iv(1330, 1800), [iv(900, 1300), iv(1400, 1800)]), [`${14 * 60}-${18 * 60}`]);
});

// Approved leave is already carved out of the intervals upstream
// (uncoveredSlotIntervals), so a second permesso can never be proposed over the
// stretch a first one already covers.
test('a fascia already covered by leave is simply absent from the intervals', () => {
  assert.deepEqual(parts(iv(900, 1800), [iv(900, 1300)]), [`${9 * 60}-${13 * 60}`]);
});

// Grid rules: inward on both edges, so a part never claims a minute the
// schedule does not hold and always lands on the quarter the leave API demands.
test('off-grid fascia boundaries snap inward, never outward', () => {
  const p = scheduledWindowParts(iv(1200, 1800), [iv(900, 1250)], QUARTER);
  assert.deepEqual(p, [{ start: at(1200), end: at(1245) }]);
});

test('a sliver shorter than one step is dropped (the API refuses it anyway)', () => {
  assert.equal(scheduledWindowParts(iv(1200, 1800), [iv(900, 1210)], QUARTER).length, 0);
});

test('an empty or inverted window yields nothing', () => {
  assert.equal(scheduledWindowParts(iv(1200, 1200), [iv(900, 1800)], QUARTER).length, 0);
  assert.equal(scheduledWindowParts(iv(1800, 1200), [iv(900, 1800)], QUARTER).length, 0);
});

test('parts come back in chronological order whatever the interval order', () => {
  assert.deepEqual(parts(iv(900, 1800), [iv(1400, 1800), iv(900, 1300)]), [
    `${9 * 60}-${13 * 60}`,
    `${14 * 60}-${18 * 60}`,
  ]);
});

/* ── scheduledStartBefore: the end-anchored magnitude ("N hours are missing") ── */

const startBefore = (
  end: number,
  work: Array<{ start: number; end: number }>,
  minutes: number
): number => scheduledStartBefore(at(end), work, minutes * MIN) / MIN;

test('single fascia: counting back is plain subtraction', () => {
  assert.equal(startBefore(1700, [iv(900, 1700)], 120), 15 * 60);
});

// The whole point: 300 minutes back from 18:00 is 13:00 by subtraction — an
// instant inside the unpaid gap, whose window would then clip to the afternoon
// fascia alone and offer 240 minutes against a 300-minute shortfall.
test('split shift: the walk skips the unpaid gap', () => {
  const work = [iv(900, 1300), iv(1400, 1800)];
  assert.equal(startBefore(1800, work, 300), 12 * 60);
  // …and the window it opens books exactly the shortfall.
  assert.equal(mins({ start: at(1200), end: at(1800) }, work), 300);
});

test('a shortfall inside the last fascia never reaches the gap', () => {
  assert.equal(startBefore(1800, [iv(900, 1300), iv(1400, 1800)], 90), 16 * 60 + 30);
});

test('a shortfall longer than the whole schedule stops at the first fascia', () => {
  assert.equal(startBefore(1800, [iv(900, 1300), iv(1400, 1800)], 600), 9 * 60);
});

test('fasce past the anchor are skipped, not counted', () => {
  // Anchored at 13:00: the afternoon has not started, so 60 minutes back is 12:00.
  assert.equal(startBefore(1300, [iv(900, 1300), iv(1400, 1800)], 60), 12 * 60);
});
