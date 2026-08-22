import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Request } from 'express';
import type { PoolClient, QueryResult } from 'pg';
import { createGiornataLeaves } from '../routes/leaves.js';
import { ValidationError } from '../errors/index.js';

// Regression guard for the half-booked giornata (prod, Time System S.a.s).
//
// Since d99dd8a a permesso proposed over an orario spezzato is booked one row
// PER FASCIA, so the unpaid gap between the fasce is charged to nobody, and
// apps/web Anomalies.tsx did that with a sequential, non-atomic loop of POST
// /leaves/admin-create calls. Fasce 09:00-13:00 + 14:00-18:00; the employee
// already holds an approved 1h permesso 13:00-14:00, which sits INSIDE the
// unpaid gap, touches no slot, and therefore leaves both fasce whole. The
// employee is absent all day, the panel proposes 09:00 → 18:00, and the split
// yields two 4h parts. The first POST passes the per-day cap (1h + 4h on an 8h
// day) and commits; the second trips it (1h + 4h + 4h = 9h) and fails. Half the
// giornata is booked, the panel does not refetch on error, and there is no
// in-app way to finish or retry it.
//
// What is provable without a database — and what actually broke — is the SHAPE
// of the decision: the cap has to be answered over the whole set BEFORE the
// first INSERT, and the giornata has to produce one notification and one
// Registro entry however many fasce it was cut into. All of that is pinned
// below against a stub client that records the SQL it is asked to run, in the
// same style as leave-day-cap-lock.test.ts.

interface Recorded {
  sql: string;
  params: unknown[];
}

interface ExistingLeave {
  id: string;
  type: string;
  from_ts: string;
  to_ts: string;
}

interface StubOptions {
  /** Rows the per-day capacity check sees as already booked. */
  existing?: ExistingLeave[];
  /** Row the same-type overlap probe finds, if any. */
  overlap?: ExistingLeave | null;
  /** false → the target is not a member of the tenant. */
  member?: boolean;
}

function isOverlapProbe(sql: string): boolean {
  return sql.includes('tstzrange');
}

/**
 * Minimal PoolClient stand-in: answers every query createGiornataLeaves can
 * issue and records them in order. No pool, no socket, no DB. Any query it does
 * not recognise is a hard failure — a new statement in the handler must be
 * taught to the stub rather than silently returning zero rows.
 */
function stubClient(opts: StubOptions = {}): { client: PoolClient; calls: Recorded[] } {
  const calls: Recorded[] = [];
  let inserted = 0;
  const query = async (sql: string, params: unknown[] = []): Promise<QueryResult> => {
    calls.push({ sql, params });
    let rows: unknown[] = [];
    if (sql.includes('FROM memberships')) {
      rows = opts.member === false ? [] : [{ ok: 1 }];
    } else if (sql.includes('INSERT INTO leave_requests')) {
      inserted += 1;
      rows = [
        {
          id: `leave-${inserted}`,
          from_ts: params[2],
          to_ts: params[3],
          duration_hours: params[4],
        },
      ];
    } else if (sql.includes('INSERT INTO leave_audit_log') || sql.includes('INSERT INTO audit_log')) {
      rows = [];
    } else if (isOverlapProbe(sql)) {
      rows = opts.overlap ? [opts.overlap] : [];
    } else if (sql.includes('FROM leave_requests')) {
      rows = opts.existing ?? [];
    } else if (
      !sql.includes('pg_advisory_xact_lock') &&
      !sql.includes('lock_timeout') &&
      !sql.includes('user_shift_assignments') &&
      !sql.includes('shift_template_slots')
    ) {
      throw new Error(`stubClient: unexpected query\n${sql}`);
    }
    return { rows, rowCount: rows.length, command: '', oid: 0, fields: [] } as QueryResult;
  };
  return { client: { query } as unknown as PoolClient, calls };
}

const ADMIN = '99999999-9999-9999-9999-999999999999';
const TENANT = '88888888-8888-8888-8888-888888888888';
const USER = '11111111-1111-1111-1111-111111111111';

/** Enough of a Request for logAudit (ip + user agent) and req.user. */
function stubReq(): Request {
  return {
    ip: '10.0.0.1',
    headers: { 'user-agent': 'node-test' },
    user: { id: ADMIN, tenantId: TENANT, role: 'admin' },
  } as unknown as Request;
}

function recorder(): { afterCommit: (t: () => Promise<void>) => void; pending: Array<() => Promise<void>> } {
  const pending: Array<() => Promise<void>> = [];
  return { afterCommit: (t): void => void pending.push(t), pending };
}

// Thursday 20/08/2026. No shift assignment is stubbed, so the Mon–Fri 8h
// fallback applies: capacity 8h — the same 8h a 09:00-13:00 + 14:00-18:00
// orario spezzato really holds.
const MORNING = { from_ts: '2026-08-20T09:00:00+02:00', to_ts: '2026-08-20T13:00:00+02:00' };
const AFTERNOON = { from_ts: '2026-08-20T14:00:00+02:00', to_ts: '2026-08-20T18:00:00+02:00' };
// The 1h permesso already approved inside the unpaid inter-fascia gap. It
// covers no slot, so uncoveredSlotIntervals leaves both fasce whole and the
// panel still proposes the entire 09:00 → 18:00 window.
const GAP_PERMESSO: ExistingLeave = {
  id: 'gap',
  type: 'permessi',
  from_ts: '2026-08-20T13:00:00+02:00',
  to_ts: '2026-08-20T14:00:00+02:00',
};

const sqlOf = (calls: Recorded[], needle: string): Recorded[] =>
  calls.filter((c) => c.sql.includes(needle));

function bookInput(windows: Array<{ from_ts: string; to_ts: string }>) {
  return { userId: USER, type: 'permessi' as const, windows, allDay: false, userNote: null };
}

test('the fasce of one giornata are judged together and refused together', async () => {
  // The exact prod set: 1h already booked in the gap + two 4h fasce = 9h on an
  // 8h day. Individually each fascia fits (1 + 4 = 5h); jointly it does not.
  const { client, calls } = stubClient({ existing: [GAP_PERMESSO], overlap: null });
  const after = recorder();

  await assert.rejects(
    () =>
      createGiornataLeaves(client, bookInput([MORNING, AFTERNOON]), {
        req: stubReq(),
        afterCommit: after.afterCommit,
      }),
    (err: unknown) => {
      assert.ok(err instanceof ValidationError);
      // The whole set against the day's capacity, in one number.
      assert.match(err.message, /20\/08\/2026/);
      assert.match(err.message, /9\.00h richieste su 8\.00h disponibili/);
      return true;
    }
  );

  // All of them or none: the giornata is left exactly as it was.
  assert.equal(sqlOf(calls, 'INSERT INTO leave_requests').length, 0, 'nothing may be inserted');
  assert.equal(sqlOf(calls, 'INSERT INTO audit_log').length, 0);
  assert.equal(after.pending.length, 0, 'a refused giornata notifies nobody');
});

test('booking those same fasce one call at a time is what left the day half-booked', async () => {
  // The defect itself, reproduced through the single-window path the web loop
  // used. Call one succeeds and COMMITS...
  const first = stubClient({ existing: [GAP_PERMESSO], overlap: null });
  const afterFirst = recorder();
  const booked = await createGiornataLeaves(first.client, bookInput([MORNING]), {
    req: stubReq(),
    afterCommit: afterFirst.afterCommit,
  });
  assert.equal(booked.rows.length, 1);
  assert.equal(sqlOf(first.calls, 'INSERT INTO leave_requests').length, 1);

  // ...and call two, which now also sees the morning row, fails. Nothing in the
  // API can undo call one, and the panel does not refetch on error.
  const second = stubClient({
    existing: [
      GAP_PERMESSO,
      { id: 'morning', type: 'permessi', from_ts: MORNING.from_ts, to_ts: MORNING.to_ts },
    ],
    overlap: null,
  });
  await assert.rejects(
    () =>
      createGiornataLeaves(second.client, bookInput([AFTERNOON]), {
        req: stubReq(),
        afterCommit: recorder().afterCommit,
      }),
    (err: unknown) => err instanceof ValidationError
  );
  assert.equal(sqlOf(second.calls, 'INSERT INTO leave_requests').length, 0);
});

test('a giornata that fits is written as several rows but announced once', async () => {
  // Same two fasce, nothing else booked: 4h + 4h = 8h on an 8h day.
  const { client, calls } = stubClient({ existing: [], overlap: null });
  const after = recorder();
  const booking = await createGiornataLeaves(client, bookInput([MORNING, AFTERNOON]), {
    req: stubReq(),
    afterCommit: after.afterCommit,
  });

  assert.equal(booking.rows.length, 2);
  // The giornata as a period — earliest start, latest end — with the unpaid
  // 13:00-14:00 gap inside it charged to nobody.
  assert.equal(booking.from_ts, MORNING.from_ts);
  assert.equal(booking.to_ts, AFTERNOON.to_ts);
  assert.equal(booking.duration_hours, 8);

  assert.equal(sqlOf(calls, 'INSERT INTO leave_requests').length, 2);
  // leave_audit_log is keyed by request_id: it is the trail of one request, so
  // it stays per row or rows would exist with no history.
  assert.equal(sqlOf(calls, 'INSERT INTO leave_audit_log').length, 2);
  // The Registro attività is the giornata's, not the fascia's.
  const audit = sqlOf(calls, 'INSERT INTO audit_log');
  assert.equal(audit.length, 1, 'one Registro entry per giornata, not one per fascia');
  assert.equal(audit[0]!.params[0], 'leave.admin_create');
  const after_ = JSON.parse(audit[0]!.params[6] as string) as Record<string, unknown>;
  assert.equal(after_.date_from, MORNING.from_ts);
  assert.equal(after_.date_to, AFTERNOON.to_ts);
  assert.deepEqual(after_.request_ids, ['leave-1', 'leave-2']);
  assert.equal((after_.parts as unknown[]).length, 2);

  // And ONE "assenza inserita" — the employee was absent one day. Registered on
  // the after-commit hook, so a rolled-back set sends nothing and no SMTP
  // socket is ever held inside the transaction (lib/route-helpers.ts).
  assert.equal(after.pending.length, 1, 'one notification per giornata, not one per fascia');
});

test('every row of the giornata is written under one lock, taken before the cap read', async () => {
  const { client, calls } = stubClient({ existing: [], overlap: null });
  await createGiornataLeaves(client, bookInput([MORNING, AFTERNOON]), {
    req: stubReq(),
    afterCommit: recorder().afterCommit,
  });

  const lockIdx = calls.findIndex((c) => c.sql.includes('pg_advisory_xact_lock'));
  const capReadIdx = calls.findIndex(
    (c) => c.sql.includes('FROM leave_requests') && !isOverlapProbe(c.sql)
  );
  const insertIdxs = calls
    .map((c, i) => (c.sql.includes('INSERT INTO leave_requests') ? i : -1))
    .filter((i) => i >= 0);
  assert.ok(lockIdx >= 0, 'the giornata must take the advisory lock');
  assert.ok(capReadIdx > lockIdx, 'existing hours must be read while holding the lock');
  assert.equal(insertIdxs.length, 2);
  assert.ok(insertIdxs[0]! > capReadIdx, 'the cap is answered before anything is written');
  assert.ok(insertIdxs[1]! > insertIdxs[0]!, 'both fasce are written inside the same lock');
  // One key, one employee: every acquisition in this transaction is the same
  // lock re-entered, never a second key that would let a concurrent writer in
  // between two fasce.
  for (const c of calls.filter((x) => x.sql.includes('pg_advisory_xact_lock'))) {
    assert.deepEqual(c.params, [USER]);
  }
});

test('a set whose windows overlap each other is refused before anything is written', async () => {
  // Nothing downstream would catch it: the duplicate probe only compares a
  // window with rows already stored, and neither of these is stored yet — so
  // both would pass and the same minutes would be charged twice.
  const { client, calls } = stubClient({ existing: [], overlap: null });
  await assert.rejects(
    () =>
      createGiornataLeaves(
        client,
        bookInput([MORNING, { from_ts: '2026-08-20T12:00:00+02:00', to_ts: '2026-08-20T16:00:00+02:00' }]),
        { req: stubReq(), afterCommit: recorder().afterCommit }
      ),
    (err: unknown) => {
      assert.ok(err instanceof ValidationError);
      assert.match(err.message, /si sovrappongono tra loro/);
      return true;
    }
  );
  assert.equal(sqlOf(calls, 'INSERT INTO leave_requests').length, 0);
});

test('two fasce that merely touch are not an overlap', async () => {
  // 09:00-13:00 and 13:00-17:00 is an orario spezzato with no unpaid gap, and
  // turning "one absence per day" into policy is exactly what the disjointness
  // check must not do. Half-open on both sides, like the stored-row probe.
  const { client, calls } = stubClient({ existing: [], overlap: null });
  const booking = await createGiornataLeaves(
    client,
    bookInput([MORNING, { from_ts: '2026-08-20T13:00:00+02:00', to_ts: '2026-08-20T17:00:00+02:00' }]),
    { req: stubReq(), afterCommit: recorder().afterCommit }
  );
  assert.equal(booking.rows.length, 2);
  assert.equal(sqlOf(calls, 'INSERT INTO leave_requests').length, 2);
});

test('a single-window call records exactly what POST /admin-create always did', async () => {
  // Other callers exist — apps/web Anomalies.tsx "inserisci ferie",
  // e2e/fixtures/api-client.ts adminCreateLeave, the anomalies specs — and they
  // read this row and this trail. The giornata fields are additive and must
  // appear only when the day really was cut into fasce.
  const { client, calls } = stubClient({ existing: [], overlap: null });
  const after = recorder();
  const booking = await createGiornataLeaves(
    client,
    { userId: USER, type: 'ferie', windows: [MORNING], allDay: false, userNote: 'nota' },
    { req: stubReq(), afterCommit: after.afterCommit }
  );

  assert.equal(booking.rows.length, 1);
  const event = sqlOf(calls, 'INSERT INTO leave_audit_log');
  assert.equal(event.length, 1);
  assert.equal(event[0]!.params[1], 'admin_create');
  assert.deepEqual(JSON.parse(event[0]!.params[2] as string), {
    type: 'ferie',
    duration_hours: 4,
    on_behalf_of: USER,
  });

  const audit = sqlOf(calls, 'INSERT INTO audit_log');
  assert.equal(audit.length, 1);
  assert.deepEqual(JSON.parse(audit[0]!.params[6] as string), {
    type: 'ferie',
    date_from: MORNING.from_ts,
    date_to: MORNING.to_ts,
    status: 'approved',
  });
  assert.equal(after.pending.length, 1);
});

test('windows more than a day apart are not one giornata', async () => {
  // The bound the single notification depends on: a caller looping over a month
  // must not collapse into one "assenza inserita" naming a period nobody booked.
  const { client, calls } = stubClient({ existing: [], overlap: null });
  await assert.rejects(
    () =>
      createGiornataLeaves(
        client,
        bookInput([MORNING, { from_ts: '2026-08-25T09:00:00+02:00', to_ts: '2026-08-25T13:00:00+02:00' }]),
        { req: stubReq(), afterCommit: recorder().afterCommit }
      ),
    (err: unknown) => {
      assert.ok(err instanceof ValidationError);
      assert.match(err.message, /stessa giornata/);
      return true;
    }
  );
  assert.equal(sqlOf(calls, 'INSERT INTO leave_requests').length, 0);
});

test('the windows are sorted, so the giornata reads in clock order whatever arrived', async () => {
  const { client, calls } = stubClient({ existing: [], overlap: null });
  const booking = await createGiornataLeaves(client, bookInput([AFTERNOON, MORNING]), {
    req: stubReq(),
    afterCommit: recorder().afterCommit,
  });
  assert.equal(booking.from_ts, MORNING.from_ts);
  assert.equal(booking.to_ts, AFTERNOON.to_ts);
  const inserts = sqlOf(calls, 'INSERT INTO leave_requests');
  assert.equal(inserts[0]!.params[2], MORNING.from_ts);
  assert.equal(inserts[1]!.params[2], AFTERNOON.from_ts);
});

test('a target outside the tenant is refused before the lock is taken', async () => {
  const { client, calls } = stubClient({ member: false });
  await assert.rejects(() =>
    createGiornataLeaves(client, bookInput([MORNING]), {
      req: stubReq(),
      afterCommit: recorder().afterCommit,
    })
  );
  assert.equal(sqlOf(calls, 'pg_advisory_xact_lock').length, 0);
});
