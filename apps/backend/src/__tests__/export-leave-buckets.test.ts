import { test } from 'node:test';
import assert from 'node:assert/strict';
import { centroPagheKeyForLeave } from '@sonoqui/shared';
import {
  leaveBucketKey,
  configForDay,
  type ShiftAssignment,
  type ShiftConfig,
} from '../services/export-service.js';

/* Two live payroll defects in the xlsx export, pinned as pure units (no DB).
 *
 * 1. loadLeavesPerDay had no type filter and a two-way branch — 'ferie', ELSE
 *    malattia — so 'assenza' and 'chiusura' rows were reported as SICK LEAVE.
 * 2. loadShiftConfigs resolved ONE assignment per period (DISTINCT ON), so a
 *    mid-period shift change backdated the new contract over the earlier days.
 */

/* ───────────────── leaveBucketKey: every leave type has its own bucket ───────────────── */

test('leaveBucketKey: the three historical buckets are unchanged', () => {
  assert.equal(leaveBucketKey('ferie'), 'ferie');
  assert.equal(leaveBucketKey('permessi'), 'permessi');
  assert.equal(leaveBucketKey('malattia'), 'malattia');
});

test('leaveBucketKey: a company shutdown is NOT malattia', () => {
  // POST /leaves/bulk with deduct_ferie:false inserts type 'chiusura'. It used
  // to print "Ore malattia 40,00" and an 'M' marker on all five August days.
  assert.equal(leaveBucketKey('chiusura'), 'chiusura');
});

test('leaveBucketKey: an assenza is NOT malattia', () => {
  assert.equal(leaveBucketKey('assenza'), 'assenza');
});

test('leaveBucketKey: an unknown future type falls back to assenza, never malattia', () => {
  // Sick hours carry INPS and payroll consequences a fallback must not invent.
  assert.equal(leaveBucketKey('congedo_straordinario_2027'), 'assenza');
  assert.equal(leaveBucketKey(''), 'assenza');
});

test('leaveBucketKey agrees with the Centro Paghe mapping on every stored type', () => {
  // The whole point of the fix: the xlsx and the Centro Paghe file of the SAME
  // month must not contradict each other. Same source column, same five kinds —
  // so the bucket and the CP map key have to partition the types identically.
  const types = ['ferie', 'permessi', 'malattia', 'chiusura', 'assenza'] as const;
  const cpKey = (t: string): string => centroPagheKeyForLeave(t, t === 'assenza' ? 'lutto' : null);
  for (const a of types) {
    for (const b of types) {
      assert.equal(
        leaveBucketKey(a) === leaveBucketKey(b),
        cpKey(a) === cpKey(b),
        `xlsx bucket and Centro Paghe key disagree on ${a} vs ${b}`
      );
    }
  }
});

/* ───────────────── configForDay: the assignment in force on THAT day ───────────────── */

function cfg(name: string, slotEnd: string): ShiftConfig {
  return {
    tolerance_in_min: 5,
    tolerance_out_min: 5,
    expected_break_max_min: 30,
    extraordinary_threshold_min: 30,
    count_extraordinary: true,
    tolerance_in_breach_deduct_min: 0,
    tolerance_out_breach_deduct_min: 0,
    tolerance_break_breach_deduct_min: 0,
    flexible_enabled: false,
    flex_in_after_min: 0,
    flex_out_before_min: 0,
    // Mon–Fri, 09:00 → slotEnd. The template name rides in the slot start so a
    // failing assertion says which contract was picked.
    slotsByDow: new Map([1, 2, 3, 4, 5].map((d) => [d, [{ start: name, end: slotEnd }]])),
    lunchByDow: new Map(),
  };
}

const PART_TIME = cfg('part-time', '13:00');
const FULL_TIME = cfg('full-time', '18:00');

// POST /shifts/assign closes the old row and inserts the new one, ordered by
// valid_from ASC the way loadShiftAssignments returns them.
const SEPTEMBER_SWITCH: ShiftAssignment[] = [
  { validFrom: '2026-01-01', validTo: '2026-09-15', cfg: PART_TIME },
  { validFrom: '2026-09-16', validTo: null, cfg: FULL_TIME },
];

test('configForDay: days before the switch keep the OLD contract', () => {
  // The DISTINCT ON version returned FULL_TIME here: 8,00 "Ore ordinarie"
  // printed for 1–15 September, 11 working days overstated by 4h each.
  assert.equal(configForDay(SEPTEMBER_SWITCH, '2026-09-01'), PART_TIME);
  assert.equal(configForDay(SEPTEMBER_SWITCH, '2026-09-15'), PART_TIME);
});

test('configForDay: days from the switch on get the NEW contract', () => {
  assert.equal(configForDay(SEPTEMBER_SWITCH, '2026-09-16'), FULL_TIME);
  assert.equal(configForDay(SEPTEMBER_SWITCH, '2026-09-30'), FULL_TIME);
});

test('configForDay: an open-ended assignment covers every later day', () => {
  assert.equal(configForDay(SEPTEMBER_SWITCH, '2027-03-08'), FULL_TIME);
});

test('configForDay: no assignment before the first valid_from', () => {
  // Also what stops the scheduled-day seeding from inventing contracted hours
  // for the days of the period that precede the hire.
  assert.equal(configForDay(SEPTEMBER_SWITCH, '2025-12-31'), undefined);
});

test('configForDay: a closed assignment covers nothing after valid_to', () => {
  const left: ShiftAssignment[] = [
    { validFrom: '2026-01-01', validTo: '2026-09-10', cfg: PART_TIME },
  ];
  assert.equal(configForDay(left, '2026-09-10'), PART_TIME);
  assert.equal(configForDay(left, '2026-09-11'), undefined);
});

test('configForDay: a user with no assignment resolves to undefined', () => {
  assert.equal(configForDay(undefined, '2026-09-01'), undefined);
  assert.equal(configForDay([], '2026-09-01'), undefined);
});

test('configForDay: overlapping windows pick the latest valid_from', () => {
  // Legacy data where an old row was never closed. DISTINCT ON … ORDER BY
  // valid_from DESC picked the latest row; the per-day scan must agree with
  // that tie-break for the days both windows contain.
  const overlapping: ShiftAssignment[] = [
    { validFrom: '2026-01-01', validTo: null, cfg: PART_TIME },
    { validFrom: '2026-09-16', validTo: null, cfg: FULL_TIME },
  ];
  assert.equal(configForDay(overlapping, '2026-09-15'), PART_TIME);
  assert.equal(configForDay(overlapping, '2026-09-16'), FULL_TIME);
});
