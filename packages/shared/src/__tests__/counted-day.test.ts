import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeCountedDay,
  computeCountedDayClosed,
  type ActiveAssignment,
} from '../stamps/counted-day.ts';
import type { DayStamp } from '../stamps/day-totals.ts';
import type { StampEventType } from '../types/index.ts';

// The counted-day rules resolve slot times against the *device local* clock
// (combineLocalDateTime), so stamps are built with the local Date constructor
// too. That keeps the assertions timezone-independent.
function localStamp(
  id: string,
  event_type: StampEventType,
  iso: string,
  hms: string
): DayStamp {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const [h, mi, s] = hms.split(':').map(Number) as [number, number, number];
  return {
    id,
    event_type,
    occurred_at: new Date(y, m - 1, d, h, mi, s ?? 0, 0).toISOString(),
    branch_id: null,
  };
}

function localDate(iso: string, hms: string): Date {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const [h, mi, s] = hms.split(':').map(Number) as [number, number, number];
  return new Date(y, m - 1, d, h, mi, s ?? 0, 0);
}

const HOUR = 3_600_000;
const MIN = 60_000;

// 08:00–12:00 + 13:00–17:00 Mon–Fri = 8h contracted on a lunch-gap schedule.
function slots(): ActiveAssignment['slots'] {
  const out: ActiveAssignment['slots'] = [];
  for (let dow = 1; dow <= 5; dow++) {
    out.push({ day_of_week: dow, start_time: '08:00', end_time: '12:00' });
    out.push({ day_of_week: dow, start_time: '13:00', end_time: '17:00' });
  }
  return out;
}

// Mirrors the prod "FULL TIME FLESSIBILE" template that surfaced the bug.
function flexAssignment(over: Partial<ActiveAssignment> = {}): ActiveAssignment {
  return {
    id: 'a1',
    shift_template_id: 't1',
    template_name: 'FULL TIME FLESSIBILE',
    tolerance_in_min: 10,
    tolerance_out_min: 10,
    expected_break_min_min: 0,
    expected_break_max_min: 15,
    expected_lunch_min_min: 15,
    expected_lunch_max_min: 90,
    extraordinary_threshold_min: 30,
    count_extraordinary: true,
    tolerance_in_breach_deduct_min: 30,
    tolerance_out_breach_deduct_min: 30,
    tolerance_break_breach_deduct_min: 30,
    flexible_enabled: true,
    flex_in_before_min: 120,
    flex_in_after_min: 120,
    flex_out_before_min: 150,
    flex_out_after_min: 150,
    flex_lunch_before_min: 120,
    flex_lunch_after_min: 120,
    slots: slots(),
    ...over,
  };
}

// 2026-07-29 is a Wednesday. Real prod stamps that produced "10h lavorate /
// 12h conteggiate" before the fix.
const DAY = '2026-07-29';
const fullDayStamps: DayStamp[] = [
  localStamp('s1', 'clock_in', DAY, '07:01:14'),
  localStamp('s2', 'lunch_start', DAY, '12:25:56'),
  localStamp('s3', 'lunch_end', DAY, '13:25:36'),
  localStamp('s4', 'clock_out', DAY, '18:01:13'),
];

test('flextime: overtime is a share of the counted total, not added on top', () => {
  const r = computeCountedDayClosed(fullDayStamps, flexAssignment(), DAY);
  // (12:25:56 − 07:01:14) + (18:01:13 − 13:25:36) = 10h00m19s
  assert.equal(r.workedMs, 10 * HOUR + 19_000);
  assert.equal(r.lunchMs, 59 * MIN + 40_000);
  // floorQuarter(10h00m19s) = 10h00m, no breach (in early, lunch 60' < 90' max)
  assert.equal(r.countedMs, 10 * HOUR);
  // worked − 8h contracted = 2h00m19s → whole 30' blocks = 2h
  assert.equal(r.overtimeMs, 2 * HOUR);
  // The regression: this used to be 12h.
  assert.equal(r.countedTotalMs, 10 * HOUR);
});

test('live day: countedTotalMs stays equal to countedMs with overtime running', () => {
  const r = computeCountedDay(fullDayStamps, flexAssignment(), localDate(DAY, '18:07:00'));
  assert.equal(r.countedMs, 10 * HOUR);
  assert.equal(r.overtimeMs, 2 * HOUR);
  assert.equal(r.countedTotalMs, r.countedMs);
});

test('fixed schedule: past-expected_end surplus is not double counted either', () => {
  const r = computeCountedDayClosed(
    fullDayStamps,
    flexAssignment({ flexible_enabled: false }),
    DAY
  );
  // Fixed mode measures the surplus of the clock-out past 17:00 = 1h01m13s → 1 block.
  assert.equal(r.overtimeMs, 1 * HOUR);
  assert.equal(r.countedTotalMs, r.countedMs);
  assert.equal(r.countedTotalMs, 10 * HOUR);
});

test('counted never exceeds worked', () => {
  for (const flex of [true, false]) {
    const r = computeCountedDayClosed(
      fullDayStamps,
      flexAssignment({ flexible_enabled: flex }),
      DAY
    );
    assert.ok(
      r.countedTotalMs <= r.workedMs,
      `counted ${r.countedTotalMs} > worked ${r.workedMs} (flex=${flex})`
    );
  }
});

test('short day under the contracted duration raises no overtime', () => {
  const short: DayStamp[] = [
    localStamp('s1', 'clock_in', DAY, '08:00:00'),
    localStamp('s2', 'clock_out', DAY, '12:20:00'),
  ];
  const r = computeCountedDayClosed(short, flexAssignment(), DAY);
  assert.equal(r.workedMs, 4 * HOUR + 20 * MIN);
  assert.equal(r.overtimeMs, 0);
  // Early clock-out breach: 17:00 − 12:20 = 4h40m, way past flex_out_before 150'
  // → −30' deduction, then floored to the quarter.
  assert.equal(r.countedMs, 3 * HOUR + 45 * MIN);
  assert.equal(r.countedTotalMs, r.countedMs);
});

test('open day (missing clock_out) counts only the closed segment', () => {
  // The state the Storico list showed while its cached payload predated the
  // 18:01 clock_out: worked 5h24m42s → floorQuarter = 5h15m.
  const partial = fullDayStamps.slice(0, 3);
  const r = computeCountedDayClosed(partial, flexAssignment(), DAY);
  assert.equal(r.workedMs, 5 * HOUR + 24 * MIN + 42_000);
  assert.equal(r.countedMs, 5 * HOUR + 15 * MIN);
  assert.equal(r.overtimeMs, 0);
  assert.equal(r.countedTotalMs, 5 * HOUR + 15 * MIN);
});

test('no assignment: counted is just the floored worked time', () => {
  const r = computeCountedDayClosed(fullDayStamps, null, DAY);
  assert.equal(r.countedTotalMs, 10 * HOUR);
  assert.equal(r.overtimeMs, 0);
});
