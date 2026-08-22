import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient, QueryResult } from 'pg';
import { lockRequestForUpdate } from '../routes/leaves.js';
import { NotFoundError } from '../errors/index.js';

// The lock ORDER, which is a different bug from the missing lock.
//
// 2db7304 added a per-(tenant, user) advisory lock inside assertPerDayCap to
// stop two concurrent admin-creates from booking the same day twice. It also,
// unnoticed, created a cycle:
//
//   T1  POST /leaves (malattia)   assertPerDayCap → advisory lock K(user),
//                                 then applyMalattiaOverlap UPDATEs the user's
//                                 pending ferie row R          → waits for R
//   T2  POST /leaves/:id/approve  SELECT … WHERE id = R FOR UPDATE (holds R),
//                                 then assertPerDayCap         → waits for K
//
// T1 holds K and wants R; T2 holds R and wants K. Postgres aborts one after
// deadlock_timeout with SQLSTATE 40P01 — a 500 on either the employee's sick
// note or the admin's approval. Before the advisory lock existed the pair
// simply serialized on R and both completed, so the deadlock was a regression
// introduced by the duplicate-ferie fix.
//
// The global order is: advisory user lock FIRST, leave_requests row locks
// second. Every /leaves/:id/* handler now gets its row through
// lockRequestForUpdate(), which is the only place that order can be got wrong
// once, and it is pinned here. No database: a stub client records the SQL.

interface Recorded {
  sql: string;
  params: unknown[];
}

const REQUEST_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OWNER_ID = '11111111-1111-1111-1111-111111111111';

interface StubOptions {
  /** Row the unlocked peek finds. null = the request does not exist. */
  peek?: { user_id: string } | null;
  /** Row the FOR UPDATE re-read finds. null = it vanished after the peek. */
  locked?: Record<string, unknown> | null;
}

function stubClient(opts: StubOptions): { client: PoolClient; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const query = async (sql: string, params: unknown[] = []): Promise<QueryResult> => {
    calls.push({ sql, params });
    let rows: unknown[] = [];
    if (sql.includes('FOR UPDATE')) {
      rows = opts.locked === undefined || opts.locked === null ? [] : [opts.locked];
    } else if (sql.includes('SELECT user_id')) {
      rows = opts.peek ? [opts.peek] : [];
    }
    return { rows, rowCount: rows.length, command: '', oid: 0, fields: [] } as QueryResult;
  };
  return { client: { query } as unknown as PoolClient, calls };
}

test('the row is locked only after the employee lock, never before', async () => {
  const { client, calls } = stubClient({
    peek: { user_id: OWNER_ID },
    locked: { id: REQUEST_ID, user_id: OWNER_ID, status: 'pending', type: 'ferie' },
  });
  await lockRequestForUpdate(client, REQUEST_ID);

  const sqls = calls.map((c) => c.sql);
  const peekIdx = sqls.findIndex((s) => s.includes('SELECT user_id'));
  const lockIdx = sqls.findIndex((s) => s.includes('pg_advisory_xact_lock'));
  const rowIdx = sqls.findIndex((s) => s.includes('FOR UPDATE'));

  assert.ok(peekIdx >= 0 && lockIdx >= 0 && rowIdx >= 0, 'all three steps must happen');
  assert.ok(peekIdx < lockIdx, 'the owner must be discovered before the lock is keyed');
  assert.ok(
    lockIdx < rowIdx,
    'the advisory lock must precede the row lock — the inverse is the 40P01 cycle'
  );
  // The peek is the whole trick: it must NOT take a row lock, or it is just the
  // old order with an extra statement.
  assert.ok(
    !calls[peekIdx]!.sql.includes('FOR UPDATE'),
    'the peek must be an unlocked read'
  );
  assert.deepEqual(calls[lockIdx]!.params, [OWNER_ID], 'lock keyed to the row owner');
});

test('the row the caller validates is the one re-read under the lock', async () => {
  // The peek reads a single column and can be stale by the time the lock lands.
  // Every status/ownership check downstream has to run on the post-lock row,
  // otherwise an approval could be decided against a snapshot taken before the
  // transaction that changed it committed.
  const locked = {
    id: REQUEST_ID,
    user_id: OWNER_ID,
    status: 'cancellation_pending',
    type: 'permessi',
  };
  const { client } = stubClient({ peek: { user_id: OWNER_ID }, locked });
  const row = await lockRequestForUpdate(client, REQUEST_ID);
  assert.equal(row.status, 'cancellation_pending');
  assert.equal(row.type, 'permessi');
});

test('an unknown request is rejected before any lock is taken', async () => {
  // A 404 must not park an advisory lock for a user id we never resolved.
  const { client, calls } = stubClient({ peek: null });
  await assert.rejects(() => lockRequestForUpdate(client, REQUEST_ID), NotFoundError);
  assert.ok(
    !calls.some((c) => c.sql.includes('pg_advisory_xact_lock')),
    'no lock for a request that does not exist'
  );
});

test('a row that disappears between the peek and the lock is a 404, not a crash', async () => {
  const { client } = stubClient({ peek: { user_id: OWNER_ID }, locked: null });
  await assert.rejects(() => lockRequestForUpdate(client, REQUEST_ID), NotFoundError);
});
