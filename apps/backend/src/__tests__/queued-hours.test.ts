import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQueuedHours, MAX_QUEUED_HOURS } from '../services/stamp-service.js';

// `X-Queued-Hours` is written by the mobile offline queue
// (apps/mobile/src/lib/offline-queue.native.ts) and lands in the
// `queued_hours double precision` column. It is a plain client header, so the
// parse is the only thing standing between it and the stamps table: the
// `Number()` this replaced put NaN and Infinity straight into a numeric column
// that feeds payroll-adjacent reads.
//
// The header is advisory — nothing is decided from it — so a malformed value is
// dropped rather than 400'd. Rejecting the punch would lose the punch.

test('a plain declared age is kept', () => {
  assert.equal(parseQueuedHours('36.5'), 36.5);
  assert.equal(parseQueuedHours('0.2'), 0.2);
});

test('an absent header means "not queued"', () => {
  assert.equal(parseQueuedHours(undefined), null);
  assert.equal(parseQueuedHours(''), null);
});

test('a value that is not a number is ignored, never stored', () => {
  // Number('abc') is NaN and Postgres accepts NaN into double precision.
  assert.equal(parseQueuedHours('abc'), null);
  assert.equal(parseQueuedHours('12h'), null);
  assert.equal(parseQueuedHours('{}'), null);
});

test('non-finite values are ignored', () => {
  // Number('1e999') is Infinity, which float8 also accepts.
  assert.equal(parseQueuedHours('1e999'), null);
  assert.equal(parseQueuedHours('Infinity'), null);
  assert.equal(parseQueuedHours('NaN'), null);
});

test('zero and negatives are ignored so IS NOT NULL still means "came from the queue"', () => {
  assert.equal(parseQueuedHours('0'), null);
  assert.equal(parseQueuedHours('0.0'), null);
  assert.equal(parseQueuedHours('-5'), null);
});

test('an implausible age is clamped to the queue TTL rather than stored raw', () => {
  assert.equal(parseQueuedHours('999999'), MAX_QUEUED_HOURS);
  assert.equal(MAX_QUEUED_HOURS, 720);
});
