import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leaveDayShares, type LeaveRow } from '../services/export-service.js';
import { zonedWallClock } from '../lib/tz.js';

/* How a leave's duration_hours is spread over the days of an export period.
 *
 * Both per-day projections — loadLeavesPerDay (xlsx buckets) and
 * loadLeavesPerDayDetailed (Centro Paghe giustificativi) — used to clip the row
 * to the period FIRST and then divide duration_hours by the number of days that
 * survived the clip. A leave straddling a period boundary therefore reported its
 * whole duration in BOTH periods.
 */

const ROME = 'Europe/Rome';

/** Full-day leave windows are stored …T00:00 → …T23:59 Rome (see
 *  splitClosureAroundOverlaps / computeHoursPerDay). Built through
 *  zonedWallClock, not a hard-coded +01:00: Rome is CEST for half the year and
 *  a fixed offset pushes a 23:59 end into the following day. */
function fullDayRow(
  type: string,
  fromDay: string,
  toDay: string,
  durationHours: number
): LeaveRow {
  return {
    userId: 'u1',
    type,
    subtype: null,
    from: zonedWallClock(fromDay, '00:00', ROME),
    to: zonedWallClock(toDay, '23:59', ROME),
    durationHours,
  };
}

/* One Christmas closure, filed by POST /leaves/bulk as a single row spanning
 * 24/12/2026 → 06/01/2027 with duration_hours 48 (6 working days × 8h). */
const CHRISTMAS = fullDayRow('chiusura', '2026-12-24', '2027-01-06', 48);

function totalMinutes(shares: Array<{ minutes: number }>): number {
  return shares.reduce((acc, s) => acc + s.minutes, 0);
}

test('a closure straddling the year end is not billed twice', () => {
  // December used to keep 8 day keys and divide by 8 → 360 min each → 48,00h of
  // "Ore chiusura aziendale" for December alone; January kept 6 and divided by
  // 6 → 480 min each → 48,00h again. 96 hours for a 48-hour shutdown, in two
  // files that each looked self-consistent.
  const december = leaveDayShares(CHRISTMAS, ROME, '2026-12-01', '2026-12-31');
  const january = leaveDayShares(CHRISTMAS, ROME, '2027-01-01', '2027-01-31');

  assert.equal(december.length, 8); // 24–31 December
  assert.equal(january.length, 6); // 1–6 January

  // 14 calendar days of span, so 2880 minutes / 14 = 206 per day either side.
  assert.ok(december.every((s) => s.minutes === 206));
  assert.ok(january.every((s) => s.minutes === 206));

  // The two periods now SPLIT one duration instead of each claiming all of it.
  const billed = totalMinutes(december) + totalMinutes(january);
  assert.ok(
    Math.abs(billed - 48 * 60) <= 14,
    `48h spread over 14 days must stay 48h across both files, got ${billed / 60}h`
  );
  assert.ok(billed < 49 * 60, 'the straddling leave is billed once, not twice');
});

test('the day keys are the ones inside the period, in order', () => {
  const december = leaveDayShares(CHRISTMAS, ROME, '2026-12-01', '2026-12-31');
  assert.deepEqual(
    december.map((s) => s.day),
    [
      '2026-12-24',
      '2026-12-25',
      '2026-12-26',
      '2026-12-27',
      '2026-12-28',
      '2026-12-29',
      '2026-12-30',
      '2026-12-31',
    ]
  );
});

test('a leave wholly inside the period is spread exactly as before', () => {
  // The byte-identity guarantee for the Centro Paghe giustificativi: when
  // nothing is clipped, the row's own span IS the clipped span, so the divisor
  // and every per-day figure are unchanged.
  const ferie = fullDayRow('ferie', '2026-09-07', '2026-09-11', 40);
  const shares = leaveDayShares(ferie, ROME, '2026-09-01', '2026-09-30');
  assert.equal(shares.length, 5);
  assert.ok(shares.every((s) => s.minutes === 480));
  assert.equal(totalMinutes(shares), 40 * 60);
});

test('a leave that starts before the period is charged only its days inside it', () => {
  // Ten days of malattia 28/09 → 07/10, 80h. September must keep three days'
  // worth (28, 29, 30), not the whole 80h it used to divide by three.
  const malattia = fullDayRow('malattia', '2026-09-28', '2026-10-07', 80);
  const september = leaveDayShares(malattia, ROME, '2026-09-01', '2026-09-30');
  const october = leaveDayShares(malattia, ROME, '2026-10-01', '2026-10-31');
  assert.equal(september.length, 3);
  assert.equal(october.length, 7);
  assert.ok(september.every((s) => s.minutes === 480));
  assert.equal(totalMinutes(september) + totalMinutes(october), 80 * 60);
});

test('a leave entirely outside the period contributes nothing', () => {
  // Reachable because the SQL window admits any row that OVERLAPS the period by
  // an instant; the day-level clip is what decides.
  const ferie = fullDayRow('ferie', '2026-08-01', '2026-08-05', 40);
  assert.deepEqual(leaveDayShares(ferie, ROME, '2026-09-01', '2026-09-30'), []);
});

test('a summer leave keeps its Rome day keys across the +02:00 offset', () => {
  // The day keys are resolved in the tenant zone, not in UTC: a leave starting
  // at Rome midnight is stored as the previous day 22:00Z and would otherwise
  // bucket one day early.
  const ferie: LeaveRow = {
    userId: 'u1',
    type: 'ferie',
    subtype: null,
    from: new Date('2026-08-10T00:00:00+02:00'),
    to: new Date('2026-08-14T23:59:00+02:00'),
    durationHours: 40,
  };
  const shares = leaveDayShares(ferie, ROME, '2026-08-01', '2026-08-31');
  assert.equal(shares[0]!.day, '2026-08-10');
  assert.equal(shares.at(-1)!.day, '2026-08-14');
});

test('a permesso is its own window, not a share of anything', () => {
  // 'permessi' rows are a stretch inside one day, so duration_hours is never
  // divided — the minutes ARE the window. 14:00 → 17:30 = 210 minutes.
  const permesso: LeaveRow = {
    userId: 'u1',
    type: 'permessi',
    subtype: null,
    from: new Date('2026-09-08T14:00:00+02:00'),
    to: new Date('2026-09-08T17:30:00+02:00'),
    durationHours: 3.5,
  };
  const shares = leaveDayShares(permesso, ROME, '2026-09-01', '2026-09-30');
  assert.deepEqual(shares, [{ day: '2026-09-08', minutes: 210 }]);
});

test('a zero-hour leave creates no day at all', () => {
  // computeDurationHours returns 0 for a window that lands entirely on
  // non-working days. A 0-minute bucket is not an absence, and letting one
  // through would put an all-zero row in Dettaglio giornaliero and an empty
  // giustificativo in the LUL.
  const weekendOnly = fullDayRow('ferie', '2026-09-05', '2026-09-06', 0);
  assert.deepEqual(leaveDayShares(weekendOnly, ROME, '2026-09-01', '2026-09-30'), []);
});
