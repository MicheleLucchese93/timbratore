import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient, QueryResult } from 'pg';
import {
  computeDurationHours,
  splitClosureAroundOverlaps,
  type LeaveOverlap,
} from '../lib/leave-quota.js';
import { eachZonedDateKeyInclusive } from '../lib/tz.js';

// POST /leaves/bulk used to ask the duplicate guard one question about the
// WHOLE closure window and, on any hit, drop the employee from the closure
// entirely.
//
// "Chiusura natalizia" 24/12 → 31/12 with deduct_ferie (type 'ferie'):
// employee X already had one approved ferie day on 27/12, findSameTypeOverlap
// matched that single row, and X got NO closure row for 24, 25, 26, 28, 29, 30
// or 31 December. The call still answered 201 because the other employees
// succeeded, the web modal closed on success without reading the body, and the
// seven missing days surfaced weeks later in the payroll export.
//
// A closure is a per-day fact, so the guard has to be one: this splits the
// window into the runs of days that are actually free. What is pinned here is
// the arithmetic — which days survive, which are named as blocked, and that the
// untouched case still produces the single row it always did, over the same
// instants. No database: a stub answers the one overlap query.
//
// The second thing pinned here is where a trimmed run ENDS. The first version
// closed it at the next midnight, which reads as the following day everywhere
// a leave is counted by whole days — see the ferragosto tests at the bottom.

interface Recorded {
  sql: string;
  params: unknown[];
}

function stubClient(hits: LeaveOverlap[] = []): { client: PoolClient; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const query = async (sql: string, params: unknown[] = []): Promise<QueryResult> => {
    calls.push({ sql, params });
    if (!sql.includes('tstzrange')) {
      throw new Error(`stubClient: unexpected query\n${sql}`);
    }
    return { rows: hits, rowCount: hits.length, command: '', oid: 0, fields: [] } as QueryResult;
  };
  return { client: { query } as unknown as PoolClient, calls };
}

const USER = '11111111-1111-1111-1111-111111111111';

// December is CET (+01:00). The web modal sends 00:00 → 23:59 local, so the
// window is a hair short of the last midnight — deliberately not a round number
// of days, because that is what the shipped client actually sends.
const XMAS_FROM = '2026-12-24T00:00:00+01:00';
const XMAS_TO = '2026-12-31T23:59:00+01:00';

const at = (local: string): string => new Date(local).toISOString();

function ferieOn(day: string): LeaveOverlap {
  return {
    id: `ferie-${day}`,
    from_ts: at(`2026-12-${day}T00:00:00+01:00`),
    to_ts: at(`2026-12-${day}T23:59:00+01:00`),
    inps_protocol: null,
  };
}

test('a closure nobody collides with is still one row over the requested window', async () => {
  // The overwhelmingly common case, and the one a per-day split must not
  // fragment: 40 employees × 8 days is 320 rows if the coalescing is wrong.
  const { client } = stubClient([]);
  const split = await splitClosureAroundOverlaps(client, USER, 'ferie', XMAS_FROM, XMAS_TO);

  assert.equal(split.blockedDays.length, 0);
  assert.deepEqual(split.segments, [{ fromTs: at(XMAS_FROM), toTs: at(XMAS_TO) }]);
});

test('one taken day in the middle costs that day and nothing else', async () => {
  // The incident, exactly: 27/12 already booked, the other seven days must
  // still be inserted — as two runs, 24→27 and 28→31.
  const { client } = stubClient([ferieOn('27')]);
  const split = await splitClosureAroundOverlaps(client, USER, 'ferie', XMAS_FROM, XMAS_TO);

  assert.deepEqual(
    split.blockedDays.map((d) => d.iso),
    ['2026-12-27']
  );
  assert.deepEqual(split.segments, [
    // 26/12 23:59, NOT 27/12 00:00 — see the ferragosto test at the bottom for
    // what the midnight end cost in the payroll export.
    { fromTs: at(XMAS_FROM), toTs: at('2026-12-26T23:59:00+01:00') },
    { fromTs: at('2026-12-28T00:00:00+01:00'), toTs: at(XMAS_TO) },
  ]);
  // The admin has to be told WHICH row took the day, not just that one did.
  assert.equal(split.blockedDays[0]!.clash.id, 'ferie-27');
});

test('the blocked day names its owner even when several rows collide', async () => {
  const { client } = stubClient([ferieOn('25'), ferieOn('29')]);
  const split = await splitClosureAroundOverlaps(client, USER, 'ferie', XMAS_FROM, XMAS_TO);

  assert.deepEqual(
    split.blockedDays.map((d) => [d.iso, d.clash.id]),
    [
      ['2026-12-25', 'ferie-25'],
      ['2026-12-29', 'ferie-29'],
    ]
  );
  assert.deepEqual(split.segments, [
    { fromTs: at(XMAS_FROM), toTs: at('2026-12-24T23:59:00+01:00') },
    { fromTs: at('2026-12-26T00:00:00+01:00'), toTs: at('2026-12-28T23:59:00+01:00') },
    { fromTs: at('2026-12-30T00:00:00+01:00'), toTs: at(XMAS_TO) },
  ]);
});

test('a collision on the first or last day only trims that end', async () => {
  const first = await splitClosureAroundOverlaps(
    stubClient([ferieOn('24')]).client,
    USER,
    'ferie',
    XMAS_FROM,
    XMAS_TO
  );
  assert.deepEqual(first.segments, [
    { fromTs: at('2026-12-25T00:00:00+01:00'), toTs: at(XMAS_TO) },
  ]);

  const last = await splitClosureAroundOverlaps(
    stubClient([ferieOn('31')]).client,
    USER,
    'ferie',
    XMAS_FROM,
    XMAS_TO
  );
  assert.deepEqual(last.segments, [
    { fromTs: at(XMAS_FROM), toTs: at('2026-12-30T23:59:00+01:00') },
  ]);
});

test('an employee covered end to end gets no segments at all', async () => {
  // This is the only shape that still means "skip this employee", and POST
  // /leaves/bulk only raises LEAVE_OVERLAP when EVERY selected employee looks
  // like this.
  const whole: LeaveOverlap = {
    id: 'ferie-all',
    from_ts: at(XMAS_FROM),
    to_ts: at(XMAS_TO),
    inps_protocol: null,
  };
  const { client } = stubClient([whole]);
  const split = await splitClosureAroundOverlaps(client, USER, 'ferie', XMAS_FROM, XMAS_TO);

  assert.equal(split.segments.length, 0);
  assert.equal(split.blockedDays.length, 8, 'all eight days of the closure are named');
});

test('an absence that ends at midnight does not occupy the day it touches', async () => {
  // Half-open on both sides, matching the SQL predicate the same function used
  // to rely on. Adjacent is not overlapping: a ferie day on 23/12 ending at
  // 00:00 on the 24th must leave the closure whole. The JS re-does this test at
  // day granularity, so it is the JS that has to agree.
  const adjacent: LeaveOverlap = {
    id: 'ferie-23',
    from_ts: at('2026-12-23T00:00:00+01:00'),
    to_ts: at('2026-12-24T00:00:00+01:00'),
    inps_protocol: null,
  };
  const { client } = stubClient([adjacent]);
  const split = await splitClosureAroundOverlaps(client, USER, 'ferie', XMAS_FROM, XMAS_TO);

  assert.equal(split.blockedDays.length, 0);
  assert.deepEqual(split.segments, [{ fromTs: at(XMAS_FROM), toTs: at(XMAS_TO) }]);
});

test('run boundaries land on Rome midnight across the DST change', async () => {
  // 25/10/2026 is 25 hours long (CEST → CET). Walking the window in 24h steps
  // would put every boundary after it an hour early and hand the employee a
  // closure that starts at 23:00 the evening before — the +1h/+2h class of bug
  // that already cost us an anomaly false positive (commit ea5091f).
  const clash: LeaveOverlap = {
    id: 'ferie-26-10',
    from_ts: at('2026-10-26T00:00:00+01:00'),
    to_ts: at('2026-10-26T23:59:00+01:00'),
    inps_protocol: null,
  };
  const { client } = stubClient([clash]);
  const split = await splitClosureAroundOverlaps(
    client,
    USER,
    'chiusura',
    '2026-10-24T00:00:00+02:00',
    '2026-10-27T23:59:00+01:00'
  );

  assert.deepEqual(
    split.blockedDays.map((d) => d.iso),
    ['2026-10-26']
  );
  assert.deepEqual(split.segments, [
    // 25/10 is 25 hours long; its last instant is 23:59 CET, one minute before
    // the 26th opens — an hour later in UTC than a flat 24h step would place it.
    { fromTs: at('2026-10-24T00:00:00+02:00'), toTs: at('2026-10-25T23:59:00+01:00') },
    { fromTs: at('2026-10-27T00:00:00+01:00'), toTs: at('2026-10-27T23:59:00+01:00') },
  ]);
});

test('the probe is scoped to the closure type and looks at the whole window', async () => {
  const { client, calls } = stubClient([]);
  await splitClosureAroundOverlaps(client, USER, 'chiusura', XMAS_FROM, XMAS_TO);

  assert.equal(calls.length, 1, 'one query per employee, not one per day');
  const probe = calls[0]!;
  assert.match(probe.sql, /type = \$2/);
  assert.deepEqual(probe.params, [USER, 'chiusura', XMAS_FROM, XMAS_TO]);
  // No LIMIT: a LIMIT 1 answer cannot say which days are taken, which is the
  // whole reason the old whole-window check could not be made day-granular.
  assert.ok(!probe.sql.includes('LIMIT'), 'every colliding row is needed, not the first');
});

/* ── where a trimmed run ends: the last instant of its last free day ────── */

// Chiusura ferragosto, 10 → 14 August 2026 (CEST, +02:00), sent by the web
// modal as 00:00 → 23:59 exactly like the Christmas one above.
const FERRAGOSTO_FROM = '2026-08-10T00:00:00+02:00';
const FERRAGOSTO_TO = '2026-08-14T23:59:00+02:00';

// Employee X already holds an approved same-type absence on Wednesday 12/08.
const OWN_ABSENCE: LeaveOverlap = {
  id: 'ferie-12-08',
  from_ts: at('2026-08-12T00:00:00+02:00'),
  to_ts: at('2026-08-12T23:59:00+02:00'),
  inps_protocol: null,
};

// No shift assignment, so computeDurationHours falls back to 8h Mon–Fri / 0 at
// the weekend — the same fallback POST /leaves/bulk gets for a tenant that
// never assigned a template.
function scheduleStub(): PoolClient {
  const query = async (sql: string): Promise<QueryResult> => {
    if (!sql.includes('user_shift_assignments')) {
      throw new Error(`scheduleStub: unexpected query\n${sql}`);
    }
    return { rows: [], rowCount: 0, command: '', oid: 0, fields: [] } as QueryResult;
  };
  return { query } as unknown as PoolClient;
}

test('a trimmed run stops at 23:59 of its last free day, not at the next midnight', async () => {
  // Defect D1. The split correctly blocked 12/08 and emitted the first run as
  // 09/08 22:00Z → 11/08 22:00Z — an end instant that IS 12/08 00:00 Rome. The
  // export enumerates a leave's days inclusively, so it read 10, 11 AND 12
  // August and spread duration_hours 16 as 5,33h on each; 12/08 already carried
  // X's own 8h row, so the payroll sheet printed 13,33h on a day the split had
  // deliberately left alone, with the marker that goes with it.
  const { client } = stubClient([OWN_ABSENCE]);
  const split = await splitClosureAroundOverlaps(
    client,
    USER,
    'ferie',
    FERRAGOSTO_FROM,
    FERRAGOSTO_TO
  );

  assert.deepEqual(
    split.blockedDays.map((d) => d.iso),
    ['2026-08-12']
  );
  assert.deepEqual(split.segments, [
    { fromTs: at(FERRAGOSTO_FROM), toTs: at('2026-08-11T23:59:00+02:00') },
    { fromTs: at('2026-08-13T00:00:00+02:00'), toTs: at(FERRAGOSTO_TO) },
  ]);
});

test('the blocked day gets no share of the segment that was split around it', async () => {
  // The payroll consequence, stated the way the export computes it: the day
  // keys of the stored window, and duration_hours spread evenly over them.
  const { client } = stubClient([OWN_ABSENCE]);
  const split = await splitClosureAroundOverlaps(
    client,
    USER,
    'ferie',
    FERRAGOSTO_FROM,
    FERRAGOSTO_TO
  );
  const first = split.segments[0]!;
  const days = eachZonedDateKeyInclusive(new Date(first.fromTs), new Date(first.toTs));

  assert.deepEqual(days, ['2026-08-10', '2026-08-11'], '12/08 belongs to the row that owns it');
  const hours = await computeDurationHours(scheduleStub(), USER, 'ferie', first.fromTs, first.toTs);
  assert.equal(hours, 16);
  assert.equal(Math.round((hours * 60) / days.length), 480, '8h per day, not 5,33h over three');
});

test('the missing minute costs no hours', async () => {
  // The fix shortens every trimmed run by 60 seconds, so the thing to prove is
  // that nothing counts those 60 seconds: computeHoursPerDay clips the day and
  // then caps it at the shift length, and min(23.98h, 8h) is still 8h. Pinned
  // against the old shape so a future change to the clip cannot quietly turn
  // the last day of a closure into a short day.
  const client = scheduleStub();
  const lastInstant = await computeDurationHours(
    client,
    USER,
    'ferie',
    FERRAGOSTO_FROM,
    at('2026-08-11T23:59:00+02:00')
  );
  const nextMidnight = await computeDurationHours(
    client,
    USER,
    'ferie',
    FERRAGOSTO_FROM,
    at('2026-08-12T00:00:00+02:00')
  );
  assert.equal(lastInstant, nextMidnight);
  assert.equal(lastInstant, 16);
});

test('a closure whose window ends at midnight is stored as 23:59 anyway', async () => {
  // Nobody collides here, so this is the untouched path — and it is still worth
  // normalising: an API client (or a future modal) that sends 15/08 00:00 for a
  // 10 → 14 closure would otherwise store the very shape the export miscounts,
  // with no overlap anywhere to blame it on.
  const { client } = stubClient([]);
  const split = await splitClosureAroundOverlaps(
    client,
    USER,
    'chiusura',
    FERRAGOSTO_FROM,
    at('2026-08-15T00:00:00+02:00')
  );

  assert.deepEqual(split.segments, [
    { fromTs: at(FERRAGOSTO_FROM), toTs: at('2026-08-14T23:59:00+02:00') },
  ]);
  assert.deepEqual(
    eachZonedDateKeyInclusive(
      new Date(split.segments[0]!.fromTs),
      new Date(split.segments[0]!.toTs)
    ),
    ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14']
  );
});
