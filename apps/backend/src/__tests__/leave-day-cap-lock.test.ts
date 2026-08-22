import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient, QueryResult } from 'pg';
import { assertPerDayCap, lockLeaveUser } from '../lib/leave-quota.js';
import { ConflictError, ValidationError } from '../errors/index.js';

// Regression guard for the Time System S.a.s incident (prod, August 2026).
//
// One day can raise two anomalies for the same user ('early_clock_out' and
// 'short_hours'), and the web anomalies bulk bar applies the chosen fix once
// per selected row, in parallel. Two POST /leaves/admin-create landed ~125µs
// apart, each read the pre-insert state, both passed the per-day cap, and the
// employee got two 8h ferie rows on the same date — 16h of ferie in the export
// and a twice-consumed balance.
//
// The real mutual exclusion can only be proven against a live database (two
// connections racing on the lock), and that belongs with the DB-backed suites
// such as tenant-isolation.test.ts. What IS provable without a database, and
// what actually broke here, is the *shape* of the check: the advisory lock must
// be the first thing that happens — taken BEFORE the SELECT that reads existing
// hours, otherwise the read-modify-write window reopens — it must be bounded by
// a lock_timeout, and it must be keyed per (tenant, user) rather than globally.
// All of that is pinned below with a stub client that records the SQL it is
// asked to run.

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

function isOverlapProbe(sql: string): boolean {
  return sql.includes('tstzrange');
}

function isOverlapProbeCall(c: Recorded): boolean {
  return isOverlapProbe(c.sql);
}

interface StubOptions {
  /** Rows the per-day capacity check sees as already booked. */
  existing?: ExistingLeave[];
  /** Row the same-type overlap probe finds, if any. */
  overlap?: ExistingLeave | null;
  /** SQLSTATE the advisory lock should fail with, to exercise the mapping. */
  lockFailsWith?: string;
}

/**
 * Minimal PoolClient stand-in: answers the queries assertPerDayCap can issue
 * and records every one of them in order. No pool, no socket, no DB.
 */
function stubClient(opts: StubOptions = {}): { client: PoolClient; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const query = async (sql: string, params: unknown[] = []): Promise<QueryResult> => {
    calls.push({ sql, params });
    if (sql.includes('pg_advisory_xact_lock') && opts.lockFailsWith) {
      throw Object.assign(new Error('stubbed lock failure'), { code: opts.lockFailsWith });
    }
    let rows: unknown[] = [];
    if (isOverlapProbe(sql)) {
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

// Thursday 20/08/2026, all day. No shift assignment is stubbed, so the
// Mon–Fri 8h fallback applies: capacity 8h, an all-day request claims 8h.
const USER_A = '11111111-1111-1111-1111-111111111111';
const USER_B = '22222222-2222-2222-2222-222222222222';
const DAY_FROM = '2026-08-20T00:00:00+02:00';
const DAY_TO = '2026-08-21T00:00:00+02:00';
// Two identical 2h windows on that same Thursday: 2h + 2h = 4h fits under the
// 8h cap, which is precisely why the cap alone never saw this shape.
const MORNING_FROM = '2026-08-20T09:00:00+02:00';
const MORNING_TO = '2026-08-20T11:00:00+02:00';
const AFTERNOON_FROM = '2026-08-20T15:00:00+02:00';
const AFTERNOON_TO = '2026-08-20T16:00:00+02:00';

test('per-day cap takes the advisory lock before reading existing leave hours', async () => {
  const { client, calls } = stubClient();
  await assertPerDayCap(client, USER_A, 'ferie', DAY_FROM, DAY_TO, null);

  const timeoutIdx = calls.findIndex((c) => c.sql.includes('lock_timeout'));
  const lockIdx = calls.findIndex((c) => c.sql.includes('pg_advisory_xact_lock'));
  const readIdx = calls.findIndex((c) => c.sql.includes('FROM leave_requests'));
  // lock_timeout has to be set BEFORE the lock is requested, or the wait it is
  // supposed to bound is the one wait it does not cover.
  assert.equal(timeoutIdx, 0, 'lock_timeout must be armed first');
  assert.equal(lockIdx, 1, 'the advisory lock must be taken before any read');
  assert.ok(readIdx > lockIdx, 'existing leave hours must be read while holding the lock');
  assert.match(calls[0]!.sql, /SET LOCAL/, 'the timeout must be scoped to the transaction');
});

test('the advisory lock is keyed per (tenant, user), not globally', async () => {
  const a = stubClient();
  const b = stubClient();
  await assertPerDayCap(a.client, USER_A, 'ferie', DAY_FROM, DAY_TO, null);
  await assertPerDayCap(b.client, USER_B, 'ferie', DAY_FROM, DAY_TO, null);

  const lockOf = (calls: Recorded[]): Recorded =>
    calls.find((c) => c.sql.includes('pg_advisory_xact_lock'))!;
  const lockA = lockOf(a.calls);
  const lockB = lockOf(b.calls);
  // A global lock would serialize every employee of every customer behind one
  // key — the bulk bar would go from too parallel to unusably sequential.
  assert.deepEqual(lockA.params, [USER_A]);
  assert.deepEqual(lockB.params, [USER_B]);
  assert.ok(
    lockA.sql.includes('app.current_tenant_id'),
    'the lock key must include the tenant, so the same person in two tenants never waits'
  );
});

test('malattia is exempt from the hours cap but still takes the lock', async () => {
  // The hours exemption is deliberate: a sick note lands on a day already full
  // of ferie and applyMalattiaOverlap then supersedes them, so capping it would
  // refuse exactly the events it exists to file. It must still hold the lock,
  // or it can interleave with a concurrent ferie insert between that insert's
  // check and the sweep.
  const { client, calls } = stubClient({
    // A full day of ferie already booked: 8h + 8h on an 8h day, which for any
    // other type is the rejection in the test below.
    existing: [{ id: 'existing', type: 'ferie', from_ts: DAY_FROM, to_ts: DAY_TO }],
  });
  await assertPerDayCap(client, USER_A, 'malattia', DAY_FROM, DAY_TO, null);

  assert.ok(calls[0]!.sql.includes('lock_timeout'));
  assert.ok(calls[1]!.sql.includes('pg_advisory_xact_lock'));
  assert.ok(
    !calls.some((c) => c.sql.includes('FROM leave_requests') && !isOverlapProbe(c.sql)),
    'malattia must not run the capacity read'
  );
});

test('malattia is NOT exempt from the duplicate guard', async () => {
  // The exemption used to cover both guards, justified as "either would block
  // legitimate sick-leave events whose purpose is exactly to supersede existing
  // rows". True of the hours cap, false of this one: the probe filters on
  // `type = $2`, so for a malattia it can only ever match ANOTHER malattia —
  // never the ferie/permessi rows applyMalattiaOverlap sweeps (that query is
  // scoped to `type IN ('ferie','permessi')` and excludes the new row by id).
  // The gap made duplicate sick notes creatable, concurrently included: a phone
  // on a flaky connection retrying the submit filed the same INPS protocol
  // twice.
  //
  // It is a BACKSTOP, not the rule POST /leaves applies. An overlap between two
  // sick notes is normally a continuation certificate, which must go through:
  // resolveMalattiaWindow settles that question before the insert (see
  // leave-malattia-continuation.test.ts) and only ever hands this probe a
  // window with no certified day left in it.
  const { client, calls } = stubClient();
  await assertPerDayCap(client, USER_A, 'malattia', DAY_FROM, DAY_TO, null);

  const probe = calls.find(isOverlapProbeCall);
  assert.ok(probe, 'the same-type overlap probe must run for malattia too');
  assert.equal(probe.params[1], 'malattia', 'and it must be scoped to malattia');
});

test('a second malattia over the same days is refused', async () => {
  const clash = { id: 'existing', type: 'malattia', from_ts: DAY_FROM, to_ts: DAY_TO };
  const { client } = stubClient({ overlap: clash });
  await assert.rejects(
    () => assertPerDayCap(client, USER_A, 'malattia', DAY_FROM, DAY_TO, null),
    (err: unknown) => {
      assert.ok(err instanceof ConflictError);
      assert.equal(err.code, 'LEAVE_OVERLAP');
      assert.match(err.message, /malattia già registrata/);
      return true;
    }
  );
});

test('cap still rejects a second full-day leave on the same day', async () => {
  // The serialized second writer of the Time System pair: once it can see the
  // first one's committed row, 8h + 8h on an 8h day must fail — with the
  // unchanged ValidationError and Italian message.
  const { client } = stubClient({
    existing: [{ id: 'existing', type: 'ferie', from_ts: DAY_FROM, to_ts: DAY_TO }],
  });
  await assert.rejects(
    () => assertPerDayCap(client, USER_A, 'ferie', DAY_FROM, DAY_TO, null),
    (err: unknown) => {
      assert.ok(err instanceof ValidationError);
      assert.match(err.message, /20\/08\/2026/);
      assert.match(err.message, /16\.00h richieste su 8\.00h disponibili/);
      return true;
    }
  );
});

test('two identical 2h permessi on one day are rejected even though they fit the cap', async () => {
  // The hole the August fix left open, and the one "permesso in blocco" made
  // reachable: the bulk bar can fire two admin-creates for the same day, and
  // 2h + 2h on an 8h day never trips the capacity check. Only the same-type
  // overlap probe sees it.
  const clash = {
    id: 'existing',
    type: 'permessi',
    from_ts: MORNING_FROM,
    to_ts: MORNING_TO,
  };
  const { client } = stubClient({ existing: [clash], overlap: clash });
  await assert.rejects(
    () => assertPerDayCap(client, USER_A, 'permessi', MORNING_FROM, MORNING_TO, null),
    (err: unknown) => {
      assert.ok(err instanceof ConflictError, 'a duplicate is a conflict, not a bad request');
      assert.equal(err.code, 'LEAVE_OVERLAP');
      assert.equal(err.status, 409);
      // The message has to name the window the admin is colliding with,
      // otherwise "già registrato" is unactionable on a month-long list.
      assert.match(err.message, /20\/08\/2026 09:00 → 20\/08\/2026 11:00/);
      return true;
    }
  );
});

test('two permessi on the same day that do not overlap stay legal', async () => {
  // 09:00–10:00 in the morning and 15:00–16:00 in the afternoon is a normal
  // request pair, and the guard must not turn "one absence per day" into policy.
  const morning = {
    id: 'existing',
    type: 'permessi',
    from_ts: MORNING_FROM,
    to_ts: '2026-08-20T10:00:00+02:00',
  };
  const { client, calls } = stubClient({ existing: [morning], overlap: null });
  await assertPerDayCap(client, USER_A, 'permessi', AFTERNOON_FROM, AFTERNOON_TO, null);

  // The stub cannot evaluate tstzrange, so the property that actually keeps
  // adjacent and disjoint windows legal is pinned on the SQL itself: both
  // ranges half-open, so 09:00–10:00 and 10:00–11:00 do not touch either.
  const probe = calls.find((c) => c.sql.includes('tstzrange'))!;
  assert.equal(
    (probe.sql.match(/'\[\)'/g) ?? []).length,
    2,
    'both sides of the overlap test must be half-open [)'
  );
});

test('the overlap probe is scoped to the same type and to active rows only', async () => {
  const { client, calls } = stubClient();
  await assertPerDayCap(client, USER_A, 'permessi', MORNING_FROM, MORNING_TO, 'self-id');
  const probe = calls.find((c) => c.sql.includes('tstzrange'))!;

  // Same type only: a ferie morning and a permesso afternoon on one day is
  // legitimate, and a cross-type pair that really overbooks the day is the
  // capacity check's job.
  assert.match(probe.sql, /type = \$2/);
  assert.equal(probe.params[1], 'permessi');
  // Same status set as the capacity check, so the two guards agree on what
  // "already booked" means.
  assert.match(probe.sql, /status IN \('pending','approved','cancellation_pending'\)/);
  // POST /leaves/:id/approve re-runs the guards on the row it is approving; if
  // the row did not exclude itself, every approval would report itself as a
  // duplicate of itself.
  assert.equal(probe.params[4], 'self-id');
  assert.match(probe.sql, /id <> \$5/);
});

test('the lock key normalises the uuid, so letter case cannot fork it', async () => {
  // hashtextextended hashes BYTES. With a bare `$1::text` the key was the raw
  // client string, while every guard the lock protects compares `user_id = $1`
  // against a uuid COLUMN, where Postgres parses the parameter and treats the
  // two spellings as the same person. AdminCreateBody/BulkBody validate with
  // zod's .uuid(), whose regex is case-insensitive and which normalises
  // nothing, so 'AAAAAAAA-BBBB-4BBB-8BBB-CCCCCCCCCCCC' is a perfectly valid
  // body. Two concurrent admin-creates differing only in case therefore took
  // two different advisory locks, neither waited for the other, and both passed
  // the read-modify-write cap: the Time System race again, reachable by holding
  // shift. Casting through ::uuid first collapses every spelling onto the
  // canonical lowercase rendering before it is hashed.
  const upper = USER_A.toUpperCase();
  const lower = stubClient();
  const mixed = stubClient();
  await lockLeaveUser(lower.client, USER_A);
  await lockLeaveUser(mixed.client, upper);

  const lockOf = (calls: Recorded[]): Recorded =>
    calls.find((c) => c.sql.includes('pg_advisory_xact_lock'))!;
  const a = lockOf(lower.calls);
  const b = lockOf(mixed.calls);

  // The parameter is deliberately still the caller's string — normalising in
  // JS would only move the problem to the next caller that forgets. The SQL is
  // what has to be case-blind, and it is the same SQL either way.
  assert.equal(a.params[0], USER_A);
  assert.equal(b.params[0], upper);
  assert.equal(a.sql, b.sql);
  assert.match(a.sql, /\$1::uuid::text/, 'the user id must be parsed as a uuid before hashing');
  assert.ok(
    !a.sql.includes('$1::text'),
    'a bare ::text hashes the client spelling byte-for-byte'
  );
});

test('the tenant half of the lock key is normalised the same way', async () => {
  // req.user.tenantId happens to come back out of a uuid column today
  // (fetchMembership), never straight from the X-Tenant-Id header — but a key
  // whose case-blindness depends on what some other file happens to do is only
  // half a guarantee. NULLIF covers the empty string a placeholder GUC is left
  // with after a SET LOCAL is rolled back, which ''::uuid would turn into a
  // 22P02 instead of the '-' fallback.
  const { client, calls } = stubClient();
  await lockLeaveUser(client, USER_A);
  const lock = calls.find((c) => c.sql.includes('pg_advisory_xact_lock'))!;

  assert.match(
    lock.sql,
    /NULLIF\(current_setting\('app\.current_tenant_id', true\), ''\)::uuid::text/,
    'the tenant must be parsed as a uuid before hashing, empty string included'
  );
  assert.match(lock.sql, /'-'/, 'a missing tenant must still produce a key, not an error');
});

test('a lock we cannot get becomes a retryable 409, not a 500', async () => {
  // 55P03 = lock_not_available, i.e. the lock_timeout fired. Raw, it reaches the
  // client as an opaque 500; the point of arming a timeout is to hand back
  // something the caller can act on.
  for (const code of ['55P03', '40P01']) {
    const { client } = stubClient({ lockFailsWith: code });
    await assert.rejects(
      () => lockLeaveUser(client, USER_A),
      (err: unknown) => {
        assert.ok(err instanceof ConflictError, `${code} must map to a conflict`);
        assert.equal(err.code, 'LEAVE_LOCK_TIMEOUT');
        assert.equal(err.status, 409);
        assert.match(err.message, /Riprova/);
        return true;
      }
    );
  }
});

test('an unrelated database error from the lock is not swallowed', async () => {
  // Only the two lock SQLSTATEs get the friendly treatment. A syntax error or a
  // dead connection must keep bubbling as itself.
  const { client } = stubClient({ lockFailsWith: '42601' });
  await assert.rejects(
    () => lockLeaveUser(client, USER_A),
    (err: unknown) => {
      assert.ok(!(err instanceof ConflictError));
      return true;
    }
  );
});
