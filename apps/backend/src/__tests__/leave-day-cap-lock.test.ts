import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient, QueryResult } from 'pg';
import { assertPerDayCap } from '../lib/leave-quota.js';
import { ValidationError } from '../errors/index.js';

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
// be the first statement — taken BEFORE the SELECT that reads existing hours,
// otherwise the read-modify-write window reopens — and it must be keyed per
// (tenant, user) rather than globally. Both are pinned below with a stub
// client that records the SQL it is asked to run.

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

/**
 * Minimal PoolClient stand-in: answers the three queries assertPerDayCap can
 * issue and records every one of them in order. No pool, no socket, no DB.
 */
function stubClient(existing: ExistingLeave[]): { client: PoolClient; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const query = async (sql: string, params: unknown[] = []): Promise<QueryResult> => {
    calls.push({ sql, params });
    const rows =
      sql.includes('FROM leave_requests') ? existing : [];
    if (
      !sql.includes('pg_advisory_xact_lock') &&
      !sql.includes('user_shift_assignments') &&
      !sql.includes('shift_template_slots') &&
      !sql.includes('FROM leave_requests')
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

test('per-day cap takes the advisory lock before reading existing leave hours', async () => {
  const { client, calls } = stubClient([]);
  await assertPerDayCap(client, USER_A, 'ferie', DAY_FROM, DAY_TO, null);

  const lockIdx = calls.findIndex((c) => c.sql.includes('pg_advisory_xact_lock'));
  const readIdx = calls.findIndex((c) => c.sql.includes('FROM leave_requests'));
  assert.equal(lockIdx, 0, 'the advisory lock must be the very first statement');
  assert.ok(readIdx > lockIdx, 'existing leave hours must be read while holding the lock');
});

test('the advisory lock is keyed per (tenant, user), not globally', async () => {
  const a = stubClient([]);
  const b = stubClient([]);
  await assertPerDayCap(a.client, USER_A, 'ferie', DAY_FROM, DAY_TO, null);
  await assertPerDayCap(b.client, USER_B, 'ferie', DAY_FROM, DAY_TO, null);

  const lockA = a.calls[0]!;
  const lockB = b.calls[0]!;
  // A global lock would serialize every employee of every customer behind one
  // key — the bulk bar would go from too parallel to unusably sequential.
  assert.deepEqual(lockA.params, [USER_A]);
  assert.deepEqual(lockB.params, [USER_B]);
  assert.ok(
    lockA.sql.includes('app.current_tenant_id'),
    'the lock key must include the tenant, so the same person in two tenants never waits'
  );
});

test('malattia stays exempt from the cap but still takes the lock', async () => {
  // The exemption is deliberate: malattia supersedes overlapping ferie via
  // applyMalattiaOverlap, so capping it would block the very rows it exists to
  // override. It must still hold the lock, or it can interleave with a
  // concurrent ferie insert between that insert's check and the sweep.
  const { client, calls } = stubClient([]);
  await assertPerDayCap(client, USER_A, 'malattia', DAY_FROM, DAY_TO, null);

  assert.equal(calls.length, 1);
  assert.ok(calls[0]!.sql.includes('pg_advisory_xact_lock'));
  assert.ok(
    !calls.some((c) => c.sql.includes('FROM leave_requests')),
    'malattia must not run the capacity check'
  );
});

test('cap still rejects a second full-day leave on the same day', async () => {
  // The serialized second writer of the Time System pair: once it can see the
  // first one's committed row, 8h + 8h on an 8h day must fail — with the
  // unchanged ValidationError and Italian message.
  const { client } = stubClient([
    { id: 'existing', type: 'ferie', from_ts: DAY_FROM, to_ts: DAY_TO },
  ]);
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
