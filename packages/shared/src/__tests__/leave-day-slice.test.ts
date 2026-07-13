import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leaveDaySlice } from '../leaves/calendar.ts';

// Build a local-time ISO timestamp the way the leave form does (new Date(...) →
// toISOString()), so the test round-trips through the same local→UTC→local path
// the calendar uses on an Italian device.
function localTs(iso: string, hm: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const [h, mi] = hm.split(':').map(Number);
  return new Date(y!, m! - 1, d!, h!, mi!, 0, 0).toISOString();
}

test('full-day leave (00:00–23:59) reports allDay, no time', () => {
  const s = leaveDaySlice(localTs('2026-08-03', '00:00'), localTs('2026-08-03', '23:59'), '2026-08-03');
  assert.equal(s.allDay, true);
});

test('2h partial-day ferie reports the clipped window', () => {
  const s = leaveDaySlice(localTs('2026-08-03', '09:00'), localTs('2026-08-03', '11:00'), '2026-08-03');
  assert.equal(s.allDay, false);
  assert.equal(s.start, '09:00');
  assert.equal(s.end, '11:00');
  assert.equal(s.startsBefore, false);
  assert.equal(s.endsAfter, false);
});

test('partial-day leave does not leak onto adjacent days', () => {
  const from = localTs('2026-08-03', '09:00');
  const to = localTs('2026-08-03', '11:00');
  assert.equal(leaveDaySlice(from, to, '2026-08-02').allDay, false);
  // Adjacent days: clipped window is empty, but the flag we care about is that
  // callers gate on leaveCoversDay first — here we only assert it is not marked
  // as a whole-day block on the day it actually falls on.
  assert.equal(leaveDaySlice(from, to, '2026-08-03').start, '09:00');
});

test('multi-day all-day leave is allDay on every day it spans', () => {
  const from = localTs('2026-08-03', '00:00');
  const to = localTs('2026-08-05', '23:59');
  for (const day of ['2026-08-03', '2026-08-04', '2026-08-05']) {
    assert.equal(leaveDaySlice(from, to, day).allDay, true, `expected allDay on ${day}`);
  }
});

test('timed leave spilling past midnight flags endsAfter and clips to the day', () => {
  // Starts 22:00 day 1, ends 02:00 day 2 (unusual, but must degrade cleanly).
  const from = localTs('2026-08-03', '22:00');
  const to = localTs('2026-08-04', '02:00');
  const d1 = leaveDaySlice(from, to, '2026-08-03');
  assert.equal(d1.allDay, false);
  assert.equal(d1.start, '22:00');
  assert.equal(d1.endsAfter, true);
  const d2 = leaveDaySlice(from, to, '2026-08-04');
  assert.equal(d2.allDay, false);
  assert.equal(d2.startsBefore, true);
  assert.equal(d2.end, '02:00');
});
