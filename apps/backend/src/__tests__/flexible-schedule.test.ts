import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeAnomalies, type AnomalyRow } from '../routes/shifts.js';

// Pure unit tests for the orario-flessibile logic in computeAnomalies (no DB).
// Wall-clock times are treated as UTC, matching combineDateTime (Date.UTC) and
// the e2e seeders (setUTCHours). 2025-06-02 is a Monday → ISO dow 1.
const MON = '2025-06-02';

function stamp(event_type: string, hhmm: string) {
  return { event_type, occurred_at: `${MON}T${hhmm}:00.000Z` };
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
