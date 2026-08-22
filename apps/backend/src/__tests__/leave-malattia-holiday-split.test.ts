import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient, QueryResult } from 'pg';
import { applyMalattiaOverlap } from '../lib/leave-quota.js';
import { eachZonedDateKeyInclusive } from '../lib/tz.js';

// "Malattia durante le ferie" — what a sick note does to the holiday it lands
// on top of.
//
// Two defects lived here, both silent, both reachable by the most ordinary
// sequence the feature exists to record: an employee on approved ferie falls
// ill and files the certificate from the app.
//
//   D1 — the surviving holiday resumed at the certificate's END INSTANT. Under
//        the whole-day convention this codebase stores leave with, that is
//        23:59 of a day the certificate FULLY covers, so the payroll export
//        bucketed the remainder onto that day too: 8,00 malattia + 5,33 ferie =
//        13,33h on an 8h day, and the two real holiday days printed 5,33h
//        instead of 8,00.
//
//   D2 — a certificate falling entirely INSIDE the holiday kept the part before
//        it and threw the part after it away. No row, no superseded marker,
//        one audit line saying "trimmed". The employee, still holding an
//        approved request, stayed home; the export showed 0 ferie for those
//        days and computeAnomalies raised missing_clock_in / missing_clock_out
//        for every one of them.
//
// Neither ever ran in production (zero trim/supersede audit rows on prod), so
// what is pinned here is the arithmetic, not a repair. No database: a stub
// answers the overlap probe and the shift lookup, and records every write.

interface Recorded {
  sql: string;
  params: unknown[];
}

interface OverlapRow {
  id: string;
  type: 'ferie' | 'permessi';
  from_ts: string;
  to_ts: string;
  duration_hours: number;
  status: string;
}

// No shift assignment, so computeDurationHours falls back to 8h Mon–Fri / 0 at
// the weekend — the same fallback a tenant that never assigned a template gets.
function stubClient(hits: OverlapRow[]): { client: PoolClient; calls: Recorded[] } {
  const calls: Recorded[] = [];
  let inserted = 0;
  const query = async (sql: string, params: unknown[] = []): Promise<QueryResult> => {
    calls.push({ sql, params });
    let rows: unknown[] = [];
    if (sql.includes('tstzrange')) {
      rows = hits;
    } else if (sql.includes('INSERT INTO leave_requests')) {
      inserted += 1;
      rows = [{ id: `split-${inserted}` }];
    } else if (!sql.includes('user_shift_assignments') && !sql.startsWith('UPDATE leave_requests')) {
      throw new Error(`stubClient: unexpected query\n${sql}`);
    }
    return { rows, rowCount: rows.length, command: '', oid: 0, fields: [] } as QueryResult;
  };
  return { client: { query } as unknown as PoolClient, calls };
}

const USER = '11111111-1111-1111-1111-111111111111';
const MALATTIA = '22222222-2222-2222-2222-222222222222';
const at = (local: string): string => new Date(local).toISOString();

// August 2026 is CEST (+02:00). 10/08 is a Monday, 15–16/08 the weekend, 20/08
// a Thursday. Both clients send a whole day as 00:00 → 23:59 (web
// NewLeaveModal, mobile buildLeaveRange) — deliberately not a round number of
// days, because that is what the shipped clients actually send.
function ferie(from: string, to: string, hours: number): OverlapRow {
  return {
    id: 'ferie-row',
    type: 'ferie',
    from_ts: at(from),
    to_ts: at(to),
    duration_hours: hours,
    status: 'approved',
  };
}

/** The one UPDATE that rewrites a row's window (the supersede UPDATE has no from_ts). */
function windowUpdates(calls: Recorded[]): Recorded[] {
  return calls.filter((c) => c.sql.startsWith('UPDATE leave_requests SET from_ts'));
}

function inserts(calls: Recorded[]): Recorded[] {
  return calls.filter((c) => c.sql.includes('INSERT INTO leave_requests'));
}

function supersedes(calls: Recorded[]): Recorded[] {
  return calls.filter((c) => c.sql.includes("status = 'superseded_by_malattia'"));
}

/* ── D1: where the surviving holiday resumes, and where it stops ────────── */

test('a sick note on the first days resumes the holiday at midnight of the first free day', async () => {
  // Defect D1, exactly. Approved ferie 10 → 14 August (40h); the employee is
  // ill for the first three days and files 10 → 12. The remainder is 13 and 14
  // August — the certificate owns 12 August whole, and 23:59 of it is INSIDE
  // that day, not the boundary after it.
  const { client, calls } = stubClient([
    ferie('2026-08-10T00:00:00+02:00', '2026-08-14T23:59:00+02:00', 40),
  ]);
  const result = await applyMalattiaOverlap(
    client,
    USER,
    MALATTIA,
    at('2026-08-10T00:00:00+02:00'),
    at('2026-08-12T23:59:00+02:00')
  );

  assert.deepEqual(result.trimmedIds, ['ferie-row']);
  assert.deepEqual(result.supersededIds, []);
  assert.deepEqual(result.splits, []);

  const [update] = windowUpdates(calls);
  assert.ok(update, 'the row is narrowed, not superseded');
  // 13/08 00:00, NOT the certificate's 12/08 23:59.
  assert.equal(update.params[0], at('2026-08-13T00:00:00+02:00'));
  assert.equal(update.params[1], at('2026-08-14T23:59:00+02:00'));
  assert.equal(update.params[2], 16, 'two whole working days, not 16,02h over three');

  // How the payroll export reads that window: inclusive day keys, with
  // duration_hours spread evenly over them.
  const days = eachZonedDateKeyInclusive(
    new Date(update.params[0] as string),
    new Date(update.params[1] as string)
  );
  assert.deepEqual(days, ['2026-08-13', '2026-08-14'], '12/08 belongs to the certificate');
  assert.equal((16 * 60) / days.length, 480, '8,00h per day, not 5,33h over three');
});

test('a sick note on the last days stops the holiday at 23:59 of the last free day', async () => {
  // The mirror image, and the reason the two ends share one convention: a
  // to_ts landing exactly on 12/08 00:00 is the OPEN edge of a day the
  // certificate covers, and every consumer that reads a leave by whole days
  // has to see the holiday end on the 11th.
  const { client, calls } = stubClient([
    ferie('2026-08-10T00:00:00+02:00', '2026-08-14T23:59:00+02:00', 40),
  ]);
  const result = await applyMalattiaOverlap(
    client,
    USER,
    MALATTIA,
    at('2026-08-12T00:00:00+02:00'),
    at('2026-08-14T23:59:00+02:00')
  );

  assert.deepEqual(result.trimmedIds, ['ferie-row']);
  const [update] = windowUpdates(calls);
  assert.ok(update);
  assert.equal(update.params[0], at('2026-08-10T00:00:00+02:00'), 'the start never moves');
  assert.equal(update.params[1], at('2026-08-11T23:59:00+02:00'));
  assert.equal(update.params[2], 16);

  const days = eachZonedDateKeyInclusive(
    new Date(update.params[0] as string),
    new Date(update.params[1] as string)
  );
  assert.deepEqual(days, ['2026-08-10', '2026-08-11']);
});

/* ── D2: a certificate inside the holiday leaves two rows, not one ──────── */

// The canonical case. Approved ferie Mon 10 → Thu 20 August: 9 working days,
// 72h. The employee falls ill on the 13th and the doctor certifies 13 → 15.
const LONG_FERIE = ferie('2026-08-10T00:00:00+02:00', '2026-08-20T23:59:00+02:00', 72);
const ILL_FROM = at('2026-08-13T00:00:00+02:00');
const ILL_TO = at('2026-08-15T23:59:00+02:00');

test('a sick note inside a holiday keeps BOTH halves', async () => {
  // Defect D2. The old code ran a single UPDATE setting to_ts = 13/08 00:00 and
  // stopped: Monday 17 to Thursday 20 August — four working days, 32h —
  // ceased to exist, with nothing in the trail but "trimmed_by_malattia".
  const { client, calls } = stubClient([LONG_FERIE]);
  const result = await applyMalattiaOverlap(client, USER, MALATTIA, ILL_FROM, ILL_TO);

  const [update] = windowUpdates(calls);
  assert.ok(update, 'the filed row keeps the days BEFORE the certificate');
  assert.equal(update.params[0], at('2026-08-10T00:00:00+02:00'));
  assert.equal(update.params[1], at('2026-08-12T23:59:00+02:00'));
  assert.equal(update.params[2], 24, 'Mon 10 – Wed 12, three working days');

  const [insert] = inserts(calls);
  assert.ok(insert, 'the days AFTER it become a second row');
  assert.equal(insert.params[0], 'ferie-row', 'copied from the row being split');
  // 16/08 is the Sunday after the certificate — the first day it does not
  // cover. The holiday resumes there and books its hours on 17–20.
  assert.equal(insert.params[1], at('2026-08-16T00:00:00+02:00'));
  assert.equal(insert.params[2], at('2026-08-20T23:59:00+02:00'));
  assert.equal(insert.params[3], 32, 'Mon 17 – Thu 20, four working days');

  assert.deepEqual(result.trimmedIds, ['ferie-row'], 'the first half really was trimmed');
  assert.deepEqual(result.splits, [{ originalId: 'ferie-row', continuationId: 'split-1' }]);
  assert.deepEqual(result.supersededIds, [], 'nothing was replaced — it was divided');
});

test('splitting the holiday loses no hours', async () => {
  // The quota consequence, stated the way getQuotaSummary computes it: residuo
  // sums duration_hours over the employee's approved rows of that type, so the
  // two halves have to add up to what the employee actually still holds.
  const { client, calls } = stubClient([LONG_FERIE]);
  await applyMalattiaOverlap(client, USER, MALATTIA, ILL_FROM, ILL_TO);

  const before = Number(windowUpdates(calls)[0]!.params[2]);
  const after = Number(inserts(calls)[0]!.params[3]);
  // 13/08 (Thu), 14/08 (Fri) and 15/08 (Sat) — 16h of certified sick leave.
  const sick = 16;
  assert.equal(before + after + sick, 72, 'the original 9 working days, redistributed');
  assert.equal(before + after, 56, 'and 56h of it is still ferie the employee holds');
});

test('the two halves never share a day, and together leave no hole', async () => {
  // Why the halves are clipped to whole days rather than to the certificate's
  // instants: the export spreads duration_hours over the inclusive day keys of
  // each stored window, so any day appearing in both would be counted twice.
  const { client, calls } = stubClient([LONG_FERIE]);
  await applyMalattiaOverlap(client, USER, MALATTIA, ILL_FROM, ILL_TO);

  const update = windowUpdates(calls)[0]!;
  const insert = inserts(calls)[0]!;
  const first = eachZonedDateKeyInclusive(
    new Date(update.params[0] as string),
    new Date(update.params[1] as string)
  );
  const second = eachZonedDateKeyInclusive(
    new Date(insert.params[1] as string),
    new Date(insert.params[2] as string)
  );
  const sick = eachZonedDateKeyInclusive(new Date(ILL_FROM), new Date(ILL_TO));

  assert.deepEqual(first.filter((d) => second.includes(d)), []);
  assert.deepEqual(first.filter((d) => sick.includes(d)), []);
  assert.deepEqual(second.filter((d) => sick.includes(d)), []);
  assert.deepEqual(
    [...first, ...sick, ...second].sort(),
    eachZonedDateKeyInclusive(new Date(LONG_FERIE.from_ts), new Date(LONG_FERIE.to_ts)),
    'every day of the original holiday is accounted for exactly once'
  );
});

test('the second half is the same absence, not a new request', async () => {
  // Everything that identifies the absence is copied from the row being split,
  // by INSERT … SELECT rather than by a parameter list, so a column added to
  // leave_requests later cannot quietly stop being carried over.
  const { client, calls } = stubClient([LONG_FERIE]);
  await applyMalattiaOverlap(client, USER, MALATTIA, ILL_FROM, ILL_TO);

  const insert = inserts(calls)[0]!;
  assert.match(insert.sql, /FROM leave_requests\s+WHERE id = \$1/);
  for (const col of ['tenant_id', 'user_id', 'type', 'decided_by', 'decided_at']) {
    assert.match(insert.sql, new RegExp(`\\b${col}\\b`), `${col} must follow the original`);
  }
  // status is the one column DECIDED rather than copied — an approved holiday
  // splits into two approved halves, but an open cancellation question cannot
  // be cloned. leave-malattia-split-status.test.ts owns that rule.
  assert.equal(insert.params[4], 'approved');
  // batch_id above all: POST /leaves/bulk/:batchId/revoke cancels by batch_id
  // alone, so a closure charged to ferie and later split by a sick note has to
  // revoke as one unit — the extra row included.
  assert.match(insert.sql, /\bbatch_id\b/);
  assert.match(insert.sql, /\btitle\b/);
  assert.match(insert.sql, /\bcreated_by_admin\b/);
  // This row is what SURVIVED. Marking it superseded, or carrying the
  // original's reminder timestamp, would erase it from the employee's view or
  // silence the "domani sei in ferie" its own start date deserves.
  assert.ok(!insert.sql.includes('superseded_by_request_id'));
  assert.ok(!insert.sql.includes('reminder_sent_at'));
  // Columns that cannot be set on an active ferie or permesso.
  assert.ok(!insert.sql.includes('inps_protocol'));
  assert.ok(!insert.sql.includes('assenza_subtype'));
  assert.ok(!insert.sql.includes('rejection_reason'));
});

/* ── what still has to be superseded ────────────────────────────────────── */

test('a holiday the certificate covers end to end is superseded', async () => {
  const { client, calls } = stubClient([
    ferie('2026-08-11T00:00:00+02:00', '2026-08-12T23:59:00+02:00', 16),
  ]);
  const result = await applyMalattiaOverlap(
    client,
    USER,
    MALATTIA,
    at('2026-08-10T00:00:00+02:00'),
    at('2026-08-14T23:59:00+02:00')
  );

  assert.deepEqual(result.supersededIds, ['ferie-row']);
  assert.deepEqual(result.trimmedIds, []);
  assert.equal(supersedes(calls).length, 1);
  assert.deepEqual(supersedes(calls)[0]!.params, [MALATTIA, 'ferie-row']);
  assert.equal(windowUpdates(calls).length, 0);
  assert.equal(inserts(calls).length, 0);
});

test('a row stored with a midnight end is superseded, not left with a one-minute leftover', async () => {
  // Rows written before the whole-day convention was pinned still end at the
  // next midnight. 10/08 00:00 → 13/08 00:00 covers three days, all of them
  // certified — but its end instant is a minute PAST the certificate's, so the
  // instant-level reading kept a 60-second remainder and called it a holiday.
  const { client, calls } = stubClient([
    ferie('2026-08-10T00:00:00+02:00', '2026-08-13T00:00:00+02:00', 24),
  ]);
  const result = await applyMalattiaOverlap(
    client,
    USER,
    MALATTIA,
    at('2026-08-10T00:00:00+02:00'),
    at('2026-08-12T23:59:00+02:00')
  );

  assert.deepEqual(result.supersededIds, ['ferie-row']);
  assert.equal(windowUpdates(calls).length, 0);
});

test('a surviving stretch with no working hours is superseded, not kept as a 0h row', async () => {
  // Ferie Friday 14 → Sunday 16 August, certificate on the Friday. What is left
  // is the weekend: real calendar days, zero scheduled hours. Storing it would
  // show the employee a holiday they do not have and print an empty line in the
  // payroll sheet.
  const { client, calls } = stubClient([
    ferie('2026-08-14T00:00:00+02:00', '2026-08-16T23:59:00+02:00', 8),
  ]);
  const result = await applyMalattiaOverlap(
    client,
    USER,
    MALATTIA,
    at('2026-08-14T00:00:00+02:00'),
    at('2026-08-14T23:59:00+02:00')
  );

  assert.deepEqual(result.supersededIds, ['ferie-row']);
  assert.deepEqual(result.trimmedIds, []);
  assert.equal(inserts(calls).length, 0);
});

test('a permesso on a certified day is superseded whatever hours it names', async () => {
  // A part-day permesso, 09:00 → 13:00 on 12 August. A sick note claims the
  // whole day's scheduled hours, so nothing of that afternoon survives — and
  // the split must not hand back a same-day sliver on either side of it.
  const { client, calls } = stubClient([
    {
      id: 'permesso-row',
      type: 'permessi',
      from_ts: at('2026-08-12T09:00:00+02:00'),
      to_ts: at('2026-08-12T13:00:00+02:00'),
      duration_hours: 4,
      status: 'approved',
    },
  ]);
  const result = await applyMalattiaOverlap(
    client,
    USER,
    MALATTIA,
    at('2026-08-12T00:00:00+02:00'),
    at('2026-08-12T23:59:00+02:00')
  );

  assert.deepEqual(result.supersededIds, ['permesso-row']);
  assert.equal(windowUpdates(calls).length, 0);
});

/* ── boundaries the arithmetic has to survive ───────────────────────────── */

test('both halves land on Rome midnight across the DST change', async () => {
  // 25/10/2026 is 25 hours long (CEST → CET). Walking the window in 24h steps
  // would put every boundary after it an hour early and hand the employee a
  // holiday that ends at 22:59 — the +1h/+2h family that already cost an
  // anomaly false positive (commit ea5091f).
  //
  // Ferie Thu 22 → Fri 30 October, certificate on Mon 26 – Tue 27.
  const { client, calls } = stubClient([
    ferie('2026-10-22T00:00:00+02:00', '2026-10-30T23:59:00+01:00', 56),
  ]);
  await applyMalattiaOverlap(
    client,
    USER,
    MALATTIA,
    at('2026-10-26T00:00:00+01:00'),
    at('2026-10-27T23:59:00+01:00')
  );

  const update = windowUpdates(calls)[0]!;
  // The last instant of Sunday 25/10 is 23:59 CET, an hour later in UTC than a
  // flat 24h step from the CEST start would place it.
  assert.equal(update.params[1], at('2026-10-25T23:59:00+01:00'));
  assert.equal(update.params[2], 16, 'Thu 22 and Fri 23; the weekend counts 0');

  const insert = inserts(calls)[0]!;
  assert.equal(insert.params[1], at('2026-10-28T00:00:00+01:00'));
  assert.equal(insert.params[2], at('2026-10-30T23:59:00+01:00'));
  assert.equal(insert.params[3], 24, 'Wed 28 – Fri 30');
});

test('the sweep excludes the certificate itself and only touches ferie and permessi', async () => {
  const { client, calls } = stubClient([]);
  const result = await applyMalattiaOverlap(
    client,
    USER,
    MALATTIA,
    at('2026-08-10T00:00:00+02:00'),
    at('2026-08-12T23:59:00+02:00')
  );

  assert.deepEqual(result, { supersededIds: [], trimmedIds: [], splits: [] });
  assert.equal(calls.length, 1, 'no hits, no writes and no shift lookup');
  const probe = calls[0]!;
  assert.match(probe.sql, /id <> \$2/, 'a sick note must not sweep itself');
  assert.match(probe.sql, /type IN \('ferie','permessi'\)/);
  // malattia-vs-malattia is resolveMalattiaWindow's question, settled before
  // the INSERT — this sweep must never trim another certificate.
  assert.ok(!probe.sql.includes("'malattia'"));
  assert.deepEqual(probe.params, [
    USER,
    MALATTIA,
    at('2026-08-10T00:00:00+02:00'),
    at('2026-08-12T23:59:00+02:00'),
  ]);
});

test('several holidays around one certificate are each resolved on their own', async () => {
  // The sweep is per row: one certificate can meet a holiday it ends inside, a
  // holiday it swallows whole, and a holiday it starts inside — and each has to
  // get its own answer in one pass.
  const { client, calls } = stubClient([
    { ...ferie('2026-08-10T00:00:00+02:00', '2026-08-13T23:59:00+02:00', 32), id: 'before' },
    { ...ferie('2026-08-14T00:00:00+02:00', '2026-08-14T23:59:00+02:00', 8), id: 'inside' },
    { ...ferie('2026-08-17T00:00:00+02:00', '2026-08-21T23:59:00+02:00', 40), id: 'after' },
  ]);
  const result = await applyMalattiaOverlap(
    client,
    USER,
    MALATTIA,
    at('2026-08-13T00:00:00+02:00'),
    at('2026-08-18T23:59:00+02:00')
  );

  assert.deepEqual(result.supersededIds, ['inside']);
  assert.deepEqual(result.trimmedIds, ['before', 'after']);
  assert.deepEqual(result.splits, []);
  const [first, second] = windowUpdates(calls);
  assert.equal(first!.params[1], at('2026-08-12T23:59:00+02:00'));
  assert.equal(second!.params[0], at('2026-08-19T00:00:00+02:00'));
});
