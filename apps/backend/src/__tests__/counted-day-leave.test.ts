import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  uncoveredSlotIntervals,
  computeCountedDay,
  computeCountedDayClosed,
  type ActiveAssignment,
  type DayStamp,
} from '@sonoqui/shared';

// Gap-aware presence logic shared by counted-day.ts, export-service.ts and
// routes/shifts.ts. These lock the half-day-leave-on-a-lunch-gap-day fix:
// an approved ferie/permesso covering one slot must NOT bill the inter-slot
// lunch gap as a late/early breach deduction. (Prod: Aurora Gastaldelli.)

/* ───────────────── uncoveredSlotIntervals (pure ms algorithm) ───────────────── */

const AM = { start: 830, end: 1230 };
const PM = { start: 1400, end: 1800 };

test('uncoveredSlotIntervals: no leave → slots unchanged (sorted)', () => {
  assert.deepEqual(uncoveredSlotIntervals([PM, AM], []), [AM, PM]);
});

test('uncoveredSlotIntervals: afternoon leave drops the afternoon slot (lunch gap not billed)', () => {
  assert.deepEqual(uncoveredSlotIntervals([AM, PM], [{ from: 1400, to: 1800 }]), [AM]);
});

test('uncoveredSlotIntervals: morning leave drops the morning slot', () => {
  assert.deepEqual(uncoveredSlotIntervals([AM, PM], [{ from: 830, to: 1230 }]), [PM]);
});

test('uncoveredSlotIntervals: whole-day leave → empty (fully covered)', () => {
  assert.deepEqual(uncoveredSlotIntervals([AM, PM], [{ from: 830, to: 1800 }]), []);
});

test('uncoveredSlotIntervals: leave inside a slot splits it', () => {
  assert.deepEqual(uncoveredSlotIntervals([AM], [{ from: 1000, to: 1100 }]), [
    { start: 830, end: 1000 },
    { start: 1100, end: 1230 },
  ]);
});

/* ───────────────── computeCountedDay(Closed) end-to-end ─────────────────
 * Stamps and slot wall-clocks are both resolved in the machine's local time,
 * so these are deterministic regardless of the runner's timezone. */

const DAY = '2026-07-03'; // Friday → ISO dow 5
function localIso(h: number, m: number): string {
  return new Date(2026, 6, 3, h, m, 0, 0).toISOString();
}
function ds(id: string, event_type: DayStamp['event_type'], h: number, m: number): DayStamp {
  return { id, event_type, occurred_at: localIso(h, m), branch_id: null };
}
function assignment(over: Partial<ActiveAssignment> = {}): ActiveAssignment {
  return {
    id: 'a1',
    shift_template_id: 't1',
    template_name: 'FULL TIME-ID',
    tolerance_in_min: 5,
    tolerance_out_min: 5,
    expected_break_min_min: 0,
    expected_break_max_min: 600,
    expected_lunch_min_min: 0,
    expected_lunch_max_min: 600,
    extraordinary_threshold_min: 15,
    count_extraordinary: false,
    tolerance_in_breach_deduct_min: 30,
    tolerance_out_breach_deduct_min: 30,
    tolerance_break_breach_deduct_min: 30,
    slots: [
      { day_of_week: 5, start_time: '08:30', end_time: '12:30' },
      { day_of_week: 5, start_time: '14:00', end_time: '18:00' },
    ],
    ...over,
  };
}
const afternoonFerie = [{ from_ts: localIso(14, 0), to_ts: localIso(18, 0) }];
const morningFerie = [{ from_ts: localIso(8, 30), to_ts: localIso(12, 30) }];
const MIN = 60_000;
const floorQ = (ms: number) => Math.floor(Math.max(0, ms) / (15 * MIN)) * (15 * MIN);

test('closed day: afternoon ferie + clock-out at morning end → no early-out breach deduction', () => {
  const stamps = [ds('1', 'clock_in', 8, 29), ds('2', 'clock_out', 12, 35)];
  const r = computeCountedDayClosed(stamps, assignment(), DAY, afternoonFerie);
  // 246 min worked → floored to 240; deduction (30) must NOT apply.
  assert.equal(r.countedMs, floorQ(r.workedMs), 'no breach deduction expected');
  assert.equal(r.countedMs, 240 * MIN);
});

test('closed day: afternoon ferie but genuinely left the morning early → breach still deducts', () => {
  const stamps = [ds('1', 'clock_in', 8, 29), ds('2', 'clock_out', 11, 0)];
  const r = computeCountedDayClosed(stamps, assignment(), DAY, afternoonFerie);
  // 151 min worked, floored 150; left 90 min before the 12:30 morning end → −30.
  assert.equal(r.countedMs, 120 * MIN, 'breach deduction expected');
  assert.ok(r.countedMs < floorQ(r.workedMs));
});

test('live day: morning ferie + clock-in at the afternoon slot start → no late-in breach deduction', () => {
  const stamps = [ds('1', 'clock_in', 14, 2), ds('2', 'clock_out', 18, 0)];
  const now = new Date(2026, 6, 3, 18, 5, 0, 0);
  const r = computeCountedDay(stamps, assignment(), now, morningFerie);
  assert.equal(r.countedMs, floorQ(r.workedMs), 'no breach deduction expected');
});

test('closed day: full-day ferie worked anyway → no breach, time still credited', () => {
  const stamps = [ds('1', 'clock_in', 8, 29), ds('2', 'clock_out', 17, 55)];
  const r = computeCountedDayClosed(stamps, assignment(), DAY, [
    { from_ts: localIso(8, 30), to_ts: localIso(18, 0) },
  ]);
  assert.equal(r.countedMs, floorQ(r.workedMs));
});
