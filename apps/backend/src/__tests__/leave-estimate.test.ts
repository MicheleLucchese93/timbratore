import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateLeaveHours, type ActiveAssignment } from '@sonoqui/shared';

// Regression guard for the partial-day ferie bug: a ferie/permesso with a
// specific time window must claim only that window (capped at the scheduled
// day), not the whole shift. estimateLeaveHours mirrors the backend's
// computeHoursPerDay (apps/backend/src/lib/leave-quota.ts) — keep both in sync.
//
// Dates are passed as naive local-time strings so enumerateLocalDays buckets
// them the same way `new Date()` parses them, regardless of the test TZ.
// 2026-07-06 is a Monday → ISO dow 1, scheduled 08:30–12:30 + 14:00–18:00 = 8h.
const MON_8H = '2026-07-06';

// estimateLeaveHours only reads `assignment.slots`; cast a minimal shape.
// Mon–Fri 08:30–12:30 + 14:00–18:00 = 8h/day, weekend off (mirrors a real
// full-time template).
const assignment = {
  slots: [1, 2, 3, 4, 5].flatMap((dow) => [
    { day_of_week: dow, start_time: '08:30', end_time: '12:30' },
    { day_of_week: dow, start_time: '14:00', end_time: '18:00' },
  ]),
} as unknown as ActiveAssignment;

test('full-day ferie claims the whole scheduled day', () => {
  const h = estimateLeaveHours('ferie', `${MON_8H}T00:00:00`, `${MON_8H}T23:59:00`, assignment);
  assert.equal(h, 8);
});

test('partial-day ferie claims only the selected window (was 8h, now 4h)', () => {
  const h = estimateLeaveHours('ferie', `${MON_8H}T09:00:00`, `${MON_8H}T13:00:00`, assignment);
  assert.equal(h, 4);
});

test('partial-day permesso still claims only the window', () => {
  const h = estimateLeaveHours('permessi', `${MON_8H}T09:00:00`, `${MON_8H}T13:00:00`, assignment);
  assert.equal(h, 4);
});

test('partial-day ferie is capped at the scheduled day length', () => {
  // 06:00–22:00 (16h) overlaps a 8h schedule → capped at 8.
  const h = estimateLeaveHours('ferie', `${MON_8H}T06:00:00`, `${MON_8H}T22:00:00`, assignment);
  assert.equal(h, 8);
});

test('multi-day all-day ferie sums each scheduled day', () => {
  // Mon 2026-07-06 .. Wed 2026-07-08, all 8h days → 24h.
  const h = estimateLeaveHours('ferie', `${MON_8H}T00:00:00`, '2026-07-08T23:59:00', assignment);
  assert.equal(h, 24);
});

test('ferie on a non-scheduled weekday counts 0', () => {
  // Sunday 2026-07-05 has no slot → 0 (route then rejects duration <= 0).
  const h = estimateLeaveHours('ferie', '2026-07-05T09:00:00', '2026-07-05T13:00:00', assignment);
  assert.equal(h, 0);
});
