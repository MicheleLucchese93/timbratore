import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeFileName, fileTimestamp } from '../lib/filename.js';

// Download filenames reach a customer's Downloads folder and a commercialista's
// inbox, so they have to be ASCII-safe, stable and readable.

test('safeFileName folds accents and collapses separators', () => {
  assert.equal(safeFileName('Società Àgile S.r.l.'), 'societa-agile-s-r-l');
  assert.equal(safeFileName('Bar   Centrale — Piazza Venezia'), 'bar-centrale-piazza-venezia');
});

test('safeFileName never returns an empty or dash-trailing name', () => {
  // A name that slugs down to nothing must fall back, not produce ".xlsx".
  assert.equal(safeFileName('***', 'azienda'), 'azienda');
  assert.equal(safeFileName('', 'azienda'), 'azienda');
  // Truncation must not leave a trailing dash.
  assert.equal(safeFileName('abcdefghij klmnop', 'x', 11), 'abcdefghij');
});

test('fileTimestamp renders the tenant zone, sortable', () => {
  // 2026-08-03T10:23Z is 12:23 in Rome (CEST, +02:00).
  const d = new Date('2026-08-03T10:23:00Z');
  assert.equal(fileTimestamp(d, 'Europe/Rome'), '20260803-1223');
  assert.equal(fileTimestamp(d, 'UTC'), '20260803-1023');
});

test('fileTimestamp handles midnight without emitting hour 24', () => {
  // Intl can render midnight as "24" with hour12:false; the helper normalises
  // it, otherwise a file generated at 00:xx would sort after the whole day.
  const midnightRome = new Date('2026-08-02T22:00:00Z'); // 00:00 Rome on the 3rd
  assert.equal(fileTimestamp(midnightRome, 'Europe/Rome'), '20260803-0000');
});

test('fileTimestamp respects a winter (CET) offset', () => {
  // Same wall clock, different offset — the timestamp must follow the zone, not
  // a fixed +02:00.
  const d = new Date('2026-01-15T10:23:00Z');
  assert.equal(fileTimestamp(d, 'Europe/Rome'), '20260115-1123');
});
