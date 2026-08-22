import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zonedDateKey, eachZonedDateKeyInclusive } from './tz.js';

// These assertions are only meaningful when the process TZ is not Rome — the prod
// container runs UTC, which is what made the bug invisible in local dev.

// Regression (Carlo Signorato, IdealCopy, July 2026): a malattia entered as
// 9→10 July is stored as Rome wall-clock — from_ts 2026-07-08T22:00Z,
// to_ts 2026-07-10T21:59Z, duration_hours 16. The export bucketed days off
// `toISOString().slice(0, 10)`, read the start as 8 July, and spread 16h over
// three days (5.33h on 8, 9 and 10) instead of two days at 8h.
test('a Rome-midnight instant keys to the local day, not the UTC one', () => {
  // 00:00 Rome on 9 July (CEST, +02).
  assert.equal(zonedDateKey(new Date('2026-07-08T22:00:00.000Z')), '2026-07-09');
  // 00:00 Rome on 9 January (CET, +01).
  assert.equal(zonedDateKey(new Date('2026-01-08T23:00:00.000Z')), '2026-01-09');
  // 23:59 Rome stays on its own day.
  assert.equal(zonedDateKey(new Date('2026-07-10T21:59:00.000Z')), '2026-07-10');
});

test('malattia 9→10 July spans exactly two local days', () => {
  const days = eachZonedDateKeyInclusive(
    new Date('2026-07-08T22:00:00.000Z'),
    new Date('2026-07-10T21:59:00.000Z')
  );
  assert.deepEqual(days, ['2026-07-09', '2026-07-10']);
  // 16h over 2 days = 8h/day. The UTC bucketing gave 3 days = 5.33h/day.
  assert.equal(Math.round((16 * 60) / days.length), 480);
});

test('a single-day leave yields one day', () => {
  const days = eachZonedDateKeyInclusive(
    new Date('2026-07-08T22:00:00.000Z'),
    new Date('2026-07-09T21:59:00.000Z')
  );
  assert.deepEqual(days, ['2026-07-09']);
});

// Same class of bug on the other edge of the span: an end instant that lands
// exactly ON local midnight. A ferie entered as 10→11 August is stored as Rome
// wall-clock — from_ts 2026-08-09T22:00Z, to_ts 2026-08-11T22:00Z, i.e. 10 Aug
// 00:00 → 12 Aug 00:00, duration_hours 16. Keying that end to its own day
// enumerated 10, 11 AND 12 August and booked 5,33h on each instead of 8h on
// two; the phantom third day could fall on the employee's own absence, printing
// 13,33h and taking the wrong marker. Hand-entered and legacy rows still carry
// this shape, so the rule lives here rather than at whichever writer produced it.
test('a leave ending exactly at local midnight stops on the previous day', () => {
  const days = eachZonedDateKeyInclusive(
    new Date('2026-08-09T22:00:00.000Z'),
    new Date('2026-08-11T22:00:00.000Z')
  );
  assert.deepEqual(days, ['2026-08-10', '2026-08-11']);
  assert.equal(Math.round((16 * 60) / days.length), 480);
});

test('a one-day span between two midnights is one day, in winter too', () => {
  // CET (+01): local midnight is 23:00Z, not 22:00Z — the check has to be made
  // against the local calendar, never a fixed offset.
  assert.deepEqual(
    eachZonedDateKeyInclusive(
      new Date('2026-01-11T23:00:00.000Z'), // 00:00 Rome, 12 Jan
      new Date('2026-01-12T23:00:00.000Z') // 00:00 Rome, 13 Jan
    ),
    ['2026-01-12']
  );
});

test('a zero-length span sitting on midnight books no day at all', () => {
  assert.deepEqual(
    eachZonedDateKeyInclusive(
      new Date('2026-08-09T22:00:00.000Z'),
      new Date('2026-08-09T22:00:00.000Z')
    ),
    []
  );
});

// A DST transition day is 23h (spring) or 25h (autumn) long, so stepping the
// instant by a flat 24h drifts off the calendar. Iterating the date string does not.
test('day iteration survives the DST transitions', () => {
  // 29 March 2026: CET → CEST, the 23-hour day.
  assert.deepEqual(
    eachZonedDateKeyInclusive(
      new Date('2026-03-27T23:00:00.000Z'), // 00:00 Rome, 28 Mar
      new Date('2026-03-29T21:59:00.000Z') // 23:59 Rome, 29 Mar
    ),
    ['2026-03-28', '2026-03-29']
  );
  // 25 October 2026: CEST → CET, the 25-hour day.
  assert.deepEqual(
    eachZonedDateKeyInclusive(
      new Date('2026-10-23T22:00:00.000Z'), // 00:00 Rome, 24 Oct
      new Date('2026-10-25T22:59:00.000Z') // 23:59 Rome, 25 Oct
    ),
    ['2026-10-24', '2026-10-25']
  );
});

test('a midnight-ended span keeps its day count across the DST transitions', () => {
  // 29 March 2026, the 23-hour day: 00:00 Rome 28 Mar → 00:00 Rome 30 Mar.
  // Local midnight is 23:00Z on the way in (CET) and 22:00Z on the way out (CEST).
  assert.deepEqual(
    eachZonedDateKeyInclusive(
      new Date('2026-03-27T23:00:00.000Z'),
      new Date('2026-03-29T22:00:00.000Z')
    ),
    ['2026-03-28', '2026-03-29']
  );
  // 25 October 2026, the 25-hour day: 00:00 Rome 24 Oct → 00:00 Rome 26 Oct.
  assert.deepEqual(
    eachZonedDateKeyInclusive(
      new Date('2026-10-23T22:00:00.000Z'),
      new Date('2026-10-25T23:00:00.000Z')
    ),
    ['2026-10-24', '2026-10-25']
  );
});

test('month and year boundaries roll over', () => {
  assert.deepEqual(
    eachZonedDateKeyInclusive(
      new Date('2026-07-30T22:00:00.000Z'), // 00:00 Rome, 31 Jul
      new Date('2026-08-01T21:59:00.000Z') // 23:59 Rome, 1 Aug
    ),
    ['2026-07-31', '2026-08-01']
  );
  assert.deepEqual(
    eachZonedDateKeyInclusive(
      new Date('2026-12-30T23:00:00.000Z'), // 00:00 Rome, 31 Dec
      new Date('2027-01-01T22:59:00.000Z') // 23:59 Rome, 1 Jan
    ),
    ['2026-12-31', '2027-01-01']
  );
});
