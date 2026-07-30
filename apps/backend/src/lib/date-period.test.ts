import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isBounded,
  isCalendarDate,
  monthRange,
  parseDatePeriod,
  periodPredicate,
} from './date-period.js';

test('an empty query is all time', () => {
  const p = parseDatePeriod({});
  assert.deepEqual(p, { month: null, date: null });
  assert.equal(isBounded(p), false);
  // Cleared UI controls send '' rather than dropping the param.
  assert.deepEqual(parseDatePeriod({ month: '', date: '' }), { month: null, date: null });
});

test('month and date parse independently', () => {
  assert.deepEqual(parseDatePeriod({ month: '2026-07' }), { month: '2026-07', date: null });
  assert.deepEqual(parseDatePeriod({ date: '2026-07-30' }), { month: null, date: '2026-07-30' });
  assert.equal(isBounded(parseDatePeriod({ date: '2026-07-30' })), true);
});

test('month and date together are a 400, not a precedence rule', () => {
  assert.throws(() => parseDatePeriod({ month: '2026-07', date: '2026-07-30' }), /mutually/);
});

test('malformed periods are rejected', () => {
  assert.throws(() => parseDatePeriod({ month: '2026-7' }), /YYYY-MM/);
  assert.throws(() => parseDatePeriod({ month: '2026-13' }), /YYYY-MM/);
  assert.throws(() => parseDatePeriod({ date: '30-07-2026' }), /YYYY-MM-DD/);
  // Regex-valid but not a real calendar day — must not reach the pg date column.
  assert.throws(() => parseDatePeriod({ date: '2026-02-31' }), /YYYY-MM-DD/);
  assert.equal(isCalendarDate('2026-02-29'), false); // 2026 is not a leap year
  assert.equal(isCalendarDate('2028-02-29'), true);
});

test('a day period is an equality on the column', () => {
  const params: unknown[] = ['tenant'];
  const sql = periodPredicate({ month: null, date: '2026-07-30' }, 'e.entry_date', params);
  assert.equal(sql, 'e.entry_date = $2');
  assert.deepEqual(params, ['tenant', '2026-07-30']);
});

test('a month period is a half-open range, December rolls the year', () => {
  const params: unknown[] = [];
  const sql = periodPredicate({ month: '2026-12', date: null }, 'entry_date', params);
  assert.equal(sql, 'entry_date >= $1 AND entry_date < $2');
  assert.deepEqual(params, ['2026-12-01', '2027-01-01']);
  assert.deepEqual(monthRange('2026-07'), { start: '2026-07-01', end: '2026-08-01' });
});

test('all time binds nothing and yields no predicate', () => {
  const params: unknown[] = ['tenant'];
  assert.equal(periodPredicate({ month: null, date: null }, 'entry_date', params), '');
  assert.deepEqual(params, ['tenant']);
});
