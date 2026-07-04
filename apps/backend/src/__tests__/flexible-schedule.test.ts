import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeAnomalies, type AnomalyRow } from '../routes/shifts.js';
import { zonedWallClock } from '../lib/tz.js';

// Pure unit tests for the orario-flessibile logic in computeAnomalies (no DB).
// Schedule slot times AND the stamps below are Europe/Rome wall-clock: slots are
// interpreted in the tenant timezone by computeAnomalies, and stamps are built
// as the matching Rome-local instant via zonedWallClock so the two line up
// regardless of DST. 2025-06-02 is a Monday → ISO dow 1.
const MON = '2025-06-02';

// occurred_at for `hhmm` Europe/Rome wall-clock on `date` (default MON).
function stampAt(date: string, event_type: string, hhmm: string) {
  return { event_type, occurred_at: zonedWallClock(date, hhmm).toISOString() };
}

function stamp(event_type: string, hhmm: string) {
  return stampAt(MON, event_type, hhmm);
}

function makeRow(over: Partial<AnomalyRow> = {}): AnomalyRow {
  return {
    day: MON,
    user_id: 'u1',
    email: 'u1@example.com',
    display_name: null,
    shift_template_id: 't1',
    template_name: 'T1',
    tolerance_in_min: 10,
    tolerance_out_min: 10,
    expected_break_min_min: 0,
    expected_break_max_min: 90,
    expected_lunch_min_min: 0,
    expected_lunch_max_min: 90,
    flexible_enabled: false,
    flex_in_before_min: 0,
    flex_in_after_min: 0,
    flex_out_before_min: 0,
    flex_out_after_min: 0,
    flex_lunch_before_min: 0,
    flex_lunch_after_min: 0,
    slots: [{ day_of_week: 1, start_time: '09:00', end_time: '17:00' }],
    day_lunch: [],
    stamps: [],
    leaves: [],
    ...over,
  };
}

function kinds(rows: AnomalyRow[]): string[] {
  return computeAnomalies(rows).map((a) => a.kind);
}

test('flextime: clock-in within the entry flex window raises no late_clock_in nor short_hours', () => {
  const row = makeRow({
    flexible_enabled: true,
    flex_in_after_min: 60, // window ends 10:00
    stamps: [stamp('clock_in', '09:45'), stamp('clock_out', '17:45')], // worked 8h
  });
  const k = kinds([row]);
  assert.ok(!k.includes('late_clock_in'), `unexpected late_clock_in: ${k.join(',')}`);
  assert.ok(!k.includes('short_hours'), `unexpected short_hours: ${k.join(',')}`);
});

test('flextime: clock-in beyond the flex window + tolerance raises late_clock_in', () => {
  const row = makeRow({
    flexible_enabled: true,
    flex_in_after_min: 60, // window ends 10:00, +10 tol → 10:10
    stamps: [stamp('clock_in', '10:25'), stamp('clock_out', '18:25')],
  });
  assert.ok(kinds([row]).includes('late_clock_in'));
});

test('non-flex: the same 09:45 clock-in is still late (no widening)', () => {
  const row = makeRow({
    stamps: [stamp('clock_in', '09:45'), stamp('clock_out', '17:45')],
  });
  assert.ok(kinds([row]).includes('late_clock_in'));
});

test('flex lunch window: lunch stamped before the window raises lunch_outside_window', () => {
  const row = makeRow({
    flexible_enabled: true,
    flex_lunch_before_min: 30,
    flex_lunch_after_min: 30,
    slots: [
      { day_of_week: 1, start_time: '09:00', end_time: '13:00' },
      { day_of_week: 1, start_time: '14:00', end_time: '18:00' },
    ],
    // gap 13:00–14:00 → allowed window [12:30, 14:30]; lunch starts 11:30 = outside
    stamps: [
      stamp('clock_in', '09:00'),
      stamp('lunch_start', '11:30'),
      stamp('lunch_end', '12:30'),
      stamp('clock_out', '18:00'),
    ],
  });
  assert.ok(kinds([row]).includes('lunch_outside_window'));
});

test('flex lunch window: lunch inside the window raises no lunch_outside_window', () => {
  const row = makeRow({
    flexible_enabled: true,
    flex_lunch_before_min: 30,
    flex_lunch_after_min: 30,
    slots: [
      { day_of_week: 1, start_time: '09:00', end_time: '13:00' },
      { day_of_week: 1, start_time: '14:00', end_time: '18:00' },
    ],
    stamps: [
      stamp('clock_in', '09:00'),
      stamp('lunch_start', '13:00'),
      stamp('lunch_end', '14:00'),
      stamp('clock_out', '18:00'),
    ],
  });
  assert.ok(!kinds([row]).includes('lunch_outside_window'));
});

test('auto-lunch: full presence minus the auto amount meets the target (no short_hours)', () => {
  const row = makeRow({
    slots: [{ day_of_week: 1, start_time: '09:00', end_time: '17:30' }], // span 510
    day_lunch: [{ day_of_week: 1, lunch_min: 30 }], // worked target 480
    stamps: [stamp('clock_in', '09:00'), stamp('clock_out', '17:30')], // presence 510 → 480
  });
  const k = kinds([row]);
  assert.ok(!k.includes('short_hours'), `unexpected short_hours: ${k.join(',')}`);
  // No stamped break/lunch → no break/lunch anomalies on an auto-lunch day.
  assert.ok(!k.includes('lunch_too_short'));
});

test('auto-lunch: leaving 30 min early misses the target (short_hours)', () => {
  const row = makeRow({
    slots: [{ day_of_week: 1, start_time: '09:00', end_time: '17:30' }],
    day_lunch: [{ day_of_week: 1, lunch_min: 30 }],
    stamps: [stamp('clock_in', '09:00'), stamp('clock_out', '17:00')], // presence 480 → worked 450 < 480
  });
  assert.ok(kinds([row]).includes('short_hours'));
});

/* ───────────────── Timezone / DST regression (Europe/Rome) ─────────────────
 * Schedule wall-clock times are resolved in the tenant timezone, not UTC. A
 * stamp made at the scheduled wall-clock (± tolerance) must NOT raise late/early
 * anomalies — in either DST regime. The earlier Date.UTC implementation shifted
 * the expected window by the zone offset (+1h winter, +2h summer), fabricating
 * bogus early_clock_out / missing anomalies (the Adige Carta report). */

// 2025-07-07 Monday — CEST (UTC+2). 2025-01-06 Monday — CET (UTC+1).
const MON_SUMMER = '2025-07-07';
const MON_WINTER = '2025-01-06';

function makeRowOn(date: string, over: Partial<AnomalyRow> = {}): AnomalyRow {
  return makeRow({ day: date, ...over });
}

test('summer (CEST): clock-in at the scheduled wall-clock is on time, expected window is Rome-local', () => {
  const row = makeRowOn(MON_SUMMER, {
    stamps: [stampAt(MON_SUMMER, 'clock_in', '09:05'), stampAt(MON_SUMMER, 'clock_out', '17:00')],
  });
  const anomalies = computeAnomalies([row]);
  assert.ok(!anomalies.some((a) => a.kind === 'late_clock_in'), 'no late_clock_in');
  assert.ok(!anomalies.some((a) => a.kind === 'short_hours'), 'no short_hours');
  // 09:00 Rome CEST = 07:00Z (NOT 09:00Z as the old Date.UTC code produced).
  const a = anomalies.find((x) => x.expected_start_at) ?? null;
  if (a) assert.equal(a.expected_start_at, '2025-07-07T07:00:00.000Z');
});

test('winter (CET): clock-in at the scheduled wall-clock is on time, expected window is Rome-local', () => {
  // Late beyond tolerance to force an anomaly carrying expected_start_at.
  const row = makeRowOn(MON_WINTER, {
    stamps: [stampAt(MON_WINTER, 'clock_in', '09:30'), stampAt(MON_WINTER, 'clock_out', '17:00')],
  });
  const anomalies = computeAnomalies([row]);
  const late = anomalies.find((a) => a.kind === 'late_clock_in');
  assert.ok(late, 'late_clock_in present');
  // 09:00 Rome CET = 08:00Z; a 09:30 Rome clock-in is 30 min late, not 90.
  assert.equal(late!.expected_start_at, '2025-01-06T08:00:00.000Z');
  assert.equal(late!.delta_minutes, 30);
});

/* ──────────── In-progress shift: don't flag missing in/out prematurely ────────────
 * missing_clock_in / missing_clock_out are gated on the current time vs the
 * scheduled anchors. A shift still running (now before the scheduled end) must
 * NOT raise missing_clock_out; an entry isn't "missing" before its start time. */

function fulldayRow(stamps: AnomalyRow['stamps']): AnomalyRow {
  return makeRowOn(MON_SUMMER, {
    slots: [{ day_of_week: 1, start_time: '08:00', end_time: '18:00' }],
    stamps,
  });
}
const at = (hhmm: string) => zonedWallClock(MON_SUMMER, hhmm).getTime();

test('in-progress shift: no missing_clock_out before the scheduled end', () => {
  const row = fulldayRow([stampAt(MON_SUMMER, 'clock_in', '08:00')]); // still working
  const k = computeAnomalies([row], 'Europe/Rome', at('11:00')).map((a) => a.kind);
  assert.ok(!k.includes('missing_clock_out'), `unexpected missing_clock_out: ${k.join(',')}`);
});

test('after the scheduled end: missing_clock_out fires when no exit was stamped', () => {
  const row = fulldayRow([stampAt(MON_SUMMER, 'clock_in', '08:00')]);
  const k = computeAnomalies([row], 'Europe/Rome', at('19:00')).map((a) => a.kind);
  assert.ok(k.includes('missing_clock_out'));
});

test('missing_clock_in only after the scheduled start', () => {
  const before = computeAnomalies([fulldayRow([])], 'Europe/Rome', at('07:00')).map((a) => a.kind);
  assert.ok(!before.includes('missing_clock_in'), `premature missing_clock_in: ${before.join(',')}`);
  const after = computeAnomalies([fulldayRow([])], 'Europe/Rome', at('11:00')).map((a) => a.kind);
  assert.ok(after.includes('missing_clock_in'));
  // Exit not yet due at 11:00 → no missing_clock_out alongside it.
  assert.ok(!after.includes('missing_clock_out'), `premature missing_clock_out: ${after.join(',')}`);
});

test('Adige Carta regression: clock-out 2 min after the scheduled end is NOT uscita anticipata (summer)', () => {
  // Part-time 08:00–13:00; stamps 07:55–13:02 Rome. Pre-fix this fired a 118-min
  // early_clock_out because expected end 13:00 was read as 13:00Z (= 15:00 Rome).
  const row = makeRowOn(MON_SUMMER, {
    slots: [{ day_of_week: 1, start_time: '08:00', end_time: '13:00' }],
    stamps: [stampAt(MON_SUMMER, 'clock_in', '07:55'), stampAt(MON_SUMMER, 'clock_out', '13:02')],
  });
  const k = kinds([row]);
  assert.ok(!k.includes('early_clock_out'), `unexpected early_clock_out: ${k.join(',')}`);
  assert.ok(!k.includes('late_clock_in'), `unexpected late_clock_in: ${k.join(',')}`);
  assert.ok(!k.includes('missing_clock_in'), `unexpected missing_clock_in: ${k.join(',')}`);
  assert.ok(!k.includes('short_hours'), `unexpected short_hours: ${k.join(',')}`);
});

/* ──────────── Half-day leave over a multi-slot (lunch-gap) day ────────────
 * A split day (morning + afternoon slots with a lunch gap) where an approved
 * ferie/permesso covers ONE slot must not fabricate late/early anomalies from
 * the uncovered lunch gap. Pre-fix the engine collapsed the day to a single
 * [firstStart,lastEnd] span and credited leave as a flat overlap, so the gap
 * between the actual clock-out and the leave window billed as "uscita
 * anticipata". (Prod: Aurora Gastaldelli, 2026-07-03, FULL TIME-ID.) */
const FRI = '2026-07-03'; // Friday → ISO dow 5, CEST
const SPLIT_SLOTS = [
  { day_of_week: 5, start_time: '08:30', end_time: '12:30' },
  { day_of_week: 5, start_time: '14:00', end_time: '18:00' },
];

test('half-day afternoon ferie: clock-out at the morning slot end is NOT uscita anticipata', () => {
  const row = makeRowOn(FRI, {
    slots: SPLIT_SLOTS,
    tolerance_in_min: 5,
    tolerance_out_min: 5,
    stamps: [stampAt(FRI, 'clock_in', '08:29'), stampAt(FRI, 'clock_out', '12:35')],
    leaves: [
      {
        type: 'ferie',
        from_ts: zonedWallClock(FRI, '14:00').toISOString(),
        to_ts: zonedWallClock(FRI, '18:00').toISOString(),
      },
    ],
  });
  const k = kinds([row]);
  assert.ok(!k.includes('early_clock_out'), `unexpected early_clock_out: ${k.join(',')}`);
  assert.ok(!k.includes('short_hours'), `unexpected short_hours: ${k.join(',')}`);
  assert.ok(!k.includes('missing_clock_out'), `unexpected missing_clock_out: ${k.join(',')}`);
});

test('half-day morning ferie: clock-in at the afternoon slot start is NOT entrata posticipata', () => {
  const row = makeRowOn(FRI, {
    slots: SPLIT_SLOTS,
    tolerance_in_min: 5,
    tolerance_out_min: 5,
    stamps: [stampAt(FRI, 'clock_in', '14:02'), stampAt(FRI, 'clock_out', '18:00')],
    leaves: [
      {
        type: 'ferie',
        from_ts: zonedWallClock(FRI, '08:30').toISOString(),
        to_ts: zonedWallClock(FRI, '12:30').toISOString(),
      },
    ],
  });
  const k = kinds([row]);
  assert.ok(!k.includes('late_clock_in'), `unexpected late_clock_in: ${k.join(',')}`);
  assert.ok(!k.includes('missing_clock_in'), `unexpected missing_clock_in: ${k.join(',')}`);
});

test('half-day afternoon ferie but genuinely left the morning early → uscita anticipata still fires', () => {
  // Guard against over-suppression: leaving 90 min before the morning slot ends
  // is a real early departure and must still be flagged (delta 90, not 325).
  const row = makeRowOn(FRI, {
    slots: SPLIT_SLOTS,
    tolerance_in_min: 5,
    tolerance_out_min: 5,
    stamps: [stampAt(FRI, 'clock_in', '08:30'), stampAt(FRI, 'clock_out', '11:00')],
    leaves: [
      {
        type: 'ferie',
        from_ts: zonedWallClock(FRI, '14:00').toISOString(),
        to_ts: zonedWallClock(FRI, '18:00').toISOString(),
      },
    ],
  });
  const early = computeAnomalies([row]).find((a) => a.kind === 'early_clock_out');
  assert.ok(early, 'early_clock_out present');
  assert.equal(early!.delta_minutes, 90);
});

test('full-day ferie: clocking in anyway raises no late/early/missing anomalies', () => {
  const row = makeRowOn(FRI, {
    slots: SPLIT_SLOTS,
    stamps: [stampAt(FRI, 'clock_in', '08:29'), stampAt(FRI, 'clock_out', '17:55')],
    leaves: [
      {
        type: 'ferie',
        from_ts: zonedWallClock(FRI, '08:30').toISOString(),
        to_ts: zonedWallClock(FRI, '18:00').toISOString(),
      },
    ],
  });
  const k = kinds([row]);
  assert.ok(!k.includes('late_clock_in'), `unexpected late_clock_in: ${k.join(',')}`);
  assert.ok(!k.includes('early_clock_out'), `unexpected early_clock_out: ${k.join(',')}`);
  assert.ok(!k.includes('missing_clock_out'), `unexpected missing_clock_out: ${k.join(',')}`);
});
