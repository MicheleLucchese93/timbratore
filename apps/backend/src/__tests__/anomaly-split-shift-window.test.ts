import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scheduledStartBefore, scheduledWindowParts } from '@sonoqui/shared';
import { computeAnomalies, type Anomaly, type AnomalyRow } from '../routes/shifts.js';
import { zonedWallClock } from '../lib/tz.js';

// The day's scheduled work, fascia by fascia, is now part of the anomaly
// payload (`work_intervals`) — because the two anchors that were already there
// cannot express an orario spezzato.
//
// expected_start_at is the FIRST slot's start and expected_end_at the LAST
// slot's end, so on Time System's "FULL TIME FLESSIBILE" (08:00–12:00 +
// 13:00–17:00) and "FULL TIME UFFICIO" (08:30–12:30 + 14:00–18:00) the stretch
// between them swallows the unpaid midday gap. The web anomalies page proposes
// a permesso anchored on those two instants, so it was booking that gap as
// absence: an hour off the employee's permessi residuo and an hour of "Ore
// permessi" in the payroll export, on a day the same page's short_hours delta
// already described correctly.
//
// These tests pin the two halves of the fix that live outside the browser: the
// payload the backend hands the page, and the shared clipping the page feeds it
// to. 2025-06-02 is a Monday → ISO dow 1.
const MON = '2025-06-02';
const QUARTER_MS = 15 * 60_000;

function stamp(event_type: string, hhmm: string) {
  return { event_type, occurred_at: zonedWallClock(MON, hhmm).toISOString() };
}

// The proven scenario: two fasce, zero tolerance, no auto-lunch, in at 09:00
// and out at 12:00.
function splitShiftRow(over: Partial<AnomalyRow> = {}): AnomalyRow {
  return {
    day: MON,
    user_id: 'u1',
    email: 'u1@example.com',
    display_name: null,
    shift_template_id: 't1',
    template_name: 'FULL TIME UFFICIO',
    tolerance_in_min: 0,
    tolerance_out_min: 0,
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
    slots: [
      { day_of_week: 1, start_time: '09:00', end_time: '13:00' },
      { day_of_week: 1, start_time: '14:00', end_time: '18:00' },
    ],
    day_lunch: [],
    stamps: [stamp('clock_in', '09:00'), stamp('clock_out', '12:00')],
    leaves: [],
    ...over,
  };
}

function hhmm(iso: string): string {
  return new Intl.DateTimeFormat('it-IT', {
    timeZone: 'Europe/Rome',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

function windows(a: Anomaly): string[] {
  return (a.work_intervals ?? []).map((w) => `${hhmm(w.from)}-${hhmm(w.to)}`);
}

function byKind(rows: Anomaly[], kind: Anomaly['kind']): Anomaly {
  const hit = rows.find((a) => a.kind === kind);
  assert.ok(hit, `expected a ${kind} anomaly, got ${rows.map((r) => r.kind).join(',')}`);
  return hit;
}

test('split shift: every anomaly of the day carries the two fasce', () => {
  const out = computeAnomalies([splitShiftRow()]);
  const early = byKind(out, 'early_clock_out');
  const short = byKind(out, 'short_hours');

  // The anchors on their own still describe the whole span, gap included.
  assert.equal(hhmm(early.expected_start_at!), '09:00');
  assert.equal(hhmm(early.expected_end_at!), '18:00');
  // …and the intervals are what say the 13:00–14:00 hour is not scheduled.
  assert.deepEqual(windows(early), ['09:00-13:00', '14:00-18:00']);
  // Same day, same schedule: every kind must agree, or the correction panel
  // would propose a different window depending on the row it was opened from.
  assert.deepEqual(windows(short), windows(early));
});

test('the proposed permesso covers exactly the shortfall short_hours reports', () => {
  const out = computeAnomalies([splitShiftRow()]);
  const early = byKind(out, 'early_clock_out');
  const short = byKind(out, 'short_hours');
  // 480 expected − 180 worked.
  assert.equal(short.delta_minutes, 300);

  // What Anomalies.tsx proposes for a trailing gap: actual_end → expected_end,
  // snapped to the quarter grid — 12:00 → 18:00, six hours.
  const from = new Date(early.actual_end_at!).getTime();
  const to = new Date(early.expected_end_at!).getTime();
  assert.equal((to - from) / 60_000, 360);

  // Clipped to the fasce it is five, and the two figures of the same day finally
  // agree. The extra hour was the employee's permessi residuo.
  const parts = scheduledWindowParts(
    { start: from, end: to },
    (early.work_intervals ?? []).map((w) => ({
      start: new Date(w.from).getTime(),
      end: new Date(w.to).getTime(),
    })),
    QUARTER_MS
  );
  assert.equal(parts.length, 2, 'one permesso per fascia');
  const booked = parts.reduce((s, p) => s + (p.end - p.start) / 60_000, 0);
  assert.equal(booked, short.delta_minutes);
  assert.deepEqual(
    parts.map((p) => `${hhmm(new Date(p.start).toISOString())}-${hhmm(new Date(p.end).toISOString())}`),
    ['12:00-13:00', '14:00-18:00']
  );
});

test("the day's two rows propose the same window through different paths", () => {
  // 'early_clock_out' knows WHERE the hole is (actual_end → expected_end);
  // 'short_hours' knows only HOW MUCH is missing and is anchored at the end of
  // the turno, counting backwards. Measured by plain subtraction that walk ends
  // at 13:00 — inside the unpaid gap — and the window it opens covers only the
  // afternoon fascia: 240 minutes offered against a 300-minute shortfall, from
  // the row whose delta states the shortfall. Counting through the fasce lands
  // on 12:00, and the two rows of one giornata agree.
  const out = computeAnomalies([splitShiftRow()]);
  const short = byKind(out, 'short_hours');
  const intervals = (short.work_intervals ?? []).map((w) => ({
    start: new Date(w.from).getTime(),
    end: new Date(w.to).getTime(),
  }));
  const end = new Date(short.expected_end_at!).getTime();
  const start = scheduledStartBefore(end, intervals, short.delta_minutes! * 60_000);
  assert.equal(hhmm(new Date(start).toISOString()), '12:00');
  assert.equal(
    scheduledWindowParts({ start, end }, intervals, QUARTER_MS).reduce(
      (s, p) => s + (p.end - p.start) / 60_000,
      0
    ),
    short.delta_minutes
  );
});

test('an approved leave is already carved out of the fasce', () => {
  // A half-day permesso on the afternoon fascia: the morning is all that is
  // still scheduled, so a proposal over the whole day cannot double-book it.
  const out = computeAnomalies([
    splitShiftRow({
      stamps: [],
      leaves: [
        {
          type: 'permessi',
          from_ts: zonedWallClock(MON, '14:00').toISOString(),
          to_ts: zonedWallClock(MON, '18:00').toISOString(),
        },
      ],
    }),
  ]);
  const missing = byKind(out, 'missing_clock_in');
  assert.deepEqual(windows(missing), ['09:00-13:00']);
});

test('rows raised without a resolved schedule carry no intervals', () => {
  // Sunday: no slot on ISO dow 7, so a punch is only a giorno di riposo — no
  // expected_* to book an absence against, and nothing to clip a window to.
  const SUN = '2025-06-01';
  const out = computeAnomalies([
    splitShiftRow({
      day: SUN,
      stamps: [
        { event_type: 'clock_in', occurred_at: zonedWallClock(SUN, '09:00').toISOString() },
        { event_type: 'clock_out', occurred_at: zonedWallClock(SUN, '12:00').toISOString() },
      ],
    }),
  ]);
  assert.equal(byKind(out, 'worked_on_rest_day').work_intervals, null);
});
