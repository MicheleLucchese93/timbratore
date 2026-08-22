import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient, QueryResult } from 'pg';
import { resolveMalattiaWindow, type LeaveOverlap } from '../lib/leave-quota.js';
import { eachZonedDateKeyInclusive } from '../lib/tz.js';
import { ConflictError } from '../errors/index.js';

// Filing a "certificato di continuazione" — and the duplicate submit that must
// still be refused.
//
// An Italian sick note is extended by a NEW certificate, with its own INPS
// protocol, issued ON the last day the previous one covers. That is the norm,
// not an edge case: the doctor sees the patient on the 14th and writes "dal 14
// al 20". Routing malattia through the plain same-type overlap guard therefore
// answered 409 to the most ordinary event in the feature — and told the
// employee to "modifica o annulla la richiesta esistente", which no employee
// can do: /request-cancellation refuses type malattia outright and /cancel
// requires status 'pending' while malattia is created 'approved'. The sick
// period went unrecorded until an admin noticed.
//
// The protection that guard was built for has to survive intact: a phone on a
// flaky connection retrying POST /leaves must not file the same certificate
// twice. What separates the two is the protocol number, not the overlap.
//
// No database — a stub answers the lock and the one overlap probe.

interface Recorded {
  sql: string;
  params: unknown[];
}

function stubClient(hits: LeaveOverlap[] = []): { client: PoolClient; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const query = async (sql: string, params: unknown[] = []): Promise<QueryResult> => {
    calls.push({ sql, params });
    let rows: unknown[] = [];
    if (sql.includes('tstzrange')) {
      rows = hits;
    } else if (!sql.includes('pg_advisory_xact_lock') && !sql.includes('lock_timeout')) {
      throw new Error(`stubClient: unexpected query\n${sql}`);
    }
    return { rows, rowCount: rows.length, command: '', oid: 0, fields: [] } as QueryResult;
  };
  return { client: { query } as unknown as PoolClient, calls };
}

const USER = '11111111-1111-1111-1111-111111111111';
const at = (local: string): string => new Date(local).toISOString();

// September is CEST (+02:00). Both clients send a full day as 00:00 → 23:59
// (web NewLeaveModal, mobile buildLeaveRange).
const FIRST_FROM = '2026-09-10T00:00:00+02:00';
const FIRST_TO = '2026-09-14T23:59:00+02:00';
const PROTOCOL_A = '1234567890';
const PROTOCOL_B = '9876543210';

// The certificate already on file: 10 → 14 September, protocol A, approved.
const FIRST_CERTIFICATE: LeaveOverlap = {
  id: 'malattia-a',
  from_ts: at(FIRST_FROM),
  to_ts: at(FIRST_TO),
  inps_protocol: PROTOCOL_A,
};

// The continuation the doctor issues on the 14th: dal 14 al 20, protocol B.
const CONT_FROM = '2026-09-14T00:00:00+02:00';
const CONT_TO = '2026-09-20T23:59:00+02:00';

test('a continuation certificate is accepted and starts the day after the last certified one', async () => {
  // The whole defect: this call used to throw 409 LEAVE_OVERLAP.
  const { client } = stubClient([FIRST_CERTIFICATE]);
  const window = await resolveMalattiaWindow(
    client,
    USER,
    CONT_FROM,
    CONT_TO,
    PROTOCOL_B,
    null
  );

  assert.equal(window.fromTs, at('2026-09-15T00:00:00+02:00'));
  assert.equal(window.toTs, at(CONT_TO));
  // 14/09 is not lost — it stays recorded under protocol A, which claimed it
  // first. The employee is told nothing was dropped silently: the submit event
  // carries the requested window and this list (routes/leaves.ts).
  assert.deepEqual(window.alreadyCovered, ['2026-09-14']);
});

test('the day both certificates name is counted once, not twice', async () => {
  // Why the new row is clipped rather than left overlapping: the export spreads
  // duration_hours over the inclusive days of the stored window, so two rows
  // both covering 14/09 would print two full days of malattia on it.
  const { client } = stubClient([FIRST_CERTIFICATE]);
  const window = await resolveMalattiaWindow(client, USER, CONT_FROM, CONT_TO, PROTOCOL_B, null);

  const first = eachZonedDateKeyInclusive(new Date(FIRST_CERTIFICATE.from_ts), new Date(FIRST_CERTIFICATE.to_ts));
  const second = eachZonedDateKeyInclusive(new Date(window.fromTs), new Date(window.toTs));
  assert.deepEqual(
    first.filter((d) => second.includes(d)),
    [],
    'the two certificates must not share a day'
  );
  assert.deepEqual(
    [...first, ...second],
    [
      '2026-09-10',
      '2026-09-11',
      '2026-09-12',
      '2026-09-13',
      '2026-09-14',
      '2026-09-15',
      '2026-09-16',
      '2026-09-17',
      '2026-09-18',
      '2026-09-19',
      '2026-09-20',
    ],
    'and together they must cover the whole episode with no hole'
  );
});

test('the same certificate filed twice is still refused', async () => {
  // The flaky-mobile double POST the guard exists for. Identical body, so the
  // protocol matches — refused before the coverage check even matters.
  const { client } = stubClient([FIRST_CERTIFICATE]);
  await assert.rejects(
    () => resolveMalattiaWindow(client, USER, FIRST_FROM, FIRST_TO, PROTOCOL_A, null),
    (err: unknown) => {
      assert.ok(err instanceof ConflictError);
      assert.equal(err.status, 409);
      assert.equal(err.code, 'LEAVE_DUPLICATE_PROTOCOL');
      // The message has to name the protocol and the window it is already on,
      // and point at the thing the employee CAN do — file the new certificate.
      assert.match(err.message, /1234567890/);
      assert.match(err.message, /10\/09\/2026 00:00 → 14\/09\/2026 23:59/);
      assert.match(err.message, /nuovo certificato/);
      return true;
    }
  );
});

test('the same protocol over a different window is a duplicate too', async () => {
  // A retry that re-picks the end date is still the same certificate. Matching
  // on identical instants alone would let it through and file protocol A twice.
  const { client } = stubClient([FIRST_CERTIFICATE]);
  await assert.rejects(
    () =>
      resolveMalattiaWindow(
        client,
        USER,
        FIRST_FROM,
        '2026-09-16T23:59:00+02:00',
        PROTOCOL_A,
        null
      ),
    (err: unknown) => {
      assert.ok(err instanceof ConflictError);
      assert.equal(err.code, 'LEAVE_DUPLICATE_PROTOCOL');
      return true;
    }
  );
});

test('protocol comparison ignores the spacing and case a human types', async () => {
  const { client } = stubClient([{ ...FIRST_CERTIFICATE, inps_protocol: ' ab12CD34 ' }]);
  await assert.rejects(
    () => resolveMalattiaWindow(client, USER, CONT_FROM, CONT_TO, 'AB12cd34', null),
    (err: unknown) => {
      assert.ok(err instanceof ConflictError);
      assert.equal(err.code, 'LEAVE_DUPLICATE_PROTOCOL');
      return true;
    }
  );
});

test('a period already certified end to end is refused whatever the protocol says', async () => {
  // Nothing left to record: a second certificate over exactly the same days is
  // a correction, and correcting a filed sick note is the admin's job
  // (/leaves/:id/admin-revoke), not a second row.
  const { client } = stubClient([FIRST_CERTIFICATE]);
  await assert.rejects(
    () =>
      resolveMalattiaWindow(
        client,
        USER,
        '2026-09-11T00:00:00+02:00',
        '2026-09-13T23:59:00+02:00',
        PROTOCOL_B,
        null
      ),
    (err: unknown) => {
      assert.ok(err instanceof ConflictError);
      assert.equal(err.code, 'LEAVE_OVERLAP');
      assert.match(err.message, /malattia già registrata/);
      assert.match(err.message, /amministratore/);
      return true;
    }
  );
});

test('a period interrupted by an existing certificate names the parts to file', async () => {
  // A back-dated certificate, not a continuation: 08 → 20 September with 10 →
  // 14 already on file leaves two disjoint runs, and one leave_requests row
  // cannot hold both. Refusing with the free periods spelled out beats
  // recording half of what was asked for and saying 201.
  const { client } = stubClient([FIRST_CERTIFICATE]);
  await assert.rejects(
    () =>
      resolveMalattiaWindow(
        client,
        USER,
        '2026-09-08T00:00:00+02:00',
        CONT_TO,
        PROTOCOL_B,
        null
      ),
    (err: unknown) => {
      assert.ok(err instanceof ConflictError);
      assert.equal(err.code, 'LEAVE_OVERLAP');
      assert.match(err.message, /08\/09\/2026 → 09\/09\/2026/);
      assert.match(err.message, /15\/09\/2026 → 20\/09\/2026/);
      return true;
    }
  );
});

test('a sick note that collides with nothing keeps its own instants', async () => {
  // The common case, and the one that must not gain a single behaviour: no
  // hits, so the split never runs and POST /leaves stores exactly what was
  // submitted.
  const { client, calls } = stubClient([]);
  const window = await resolveMalattiaWindow(client, USER, CONT_FROM, CONT_TO, PROTOCOL_B, null);

  assert.deepEqual(window, {
    fromTs: CONT_FROM,
    toTs: CONT_TO,
    alreadyCovered: [],
  });
  assert.equal(calls.filter((c) => c.sql.includes('tstzrange')).length, 1, 'one probe, no re-query');
});

test('the probe runs under the employee lock, is scoped to malattia, and can exclude a row', async () => {
  const { client, calls } = stubClient([]);
  await resolveMalattiaWindow(client, USER, CONT_FROM, CONT_TO, PROTOCOL_B, 'self-id');

  const timeoutIdx = calls.findIndex((c) => c.sql.includes('lock_timeout'));
  const lockIdx = calls.findIndex((c) => c.sql.includes('pg_advisory_xact_lock'));
  const probeIdx = calls.findIndex((c) => c.sql.includes('tstzrange'));
  // Same lock order as every other leave writer (lib/leave-quota.ts): the
  // employee's advisory lock first, and it has to be held across the read —
  // two continuations of one episode submitted at once would otherwise each
  // see the other's days as free.
  assert.equal(timeoutIdx, 0);
  assert.equal(lockIdx, 1);
  assert.ok(probeIdx > lockIdx);

  const probe = calls[probeIdx]!;
  assert.equal(probe.params[1], 'malattia', 'only sick notes can certify a sick day');
  assert.match(probe.sql, /status IN \('pending','approved','cancellation_pending'\)/);
  // The caller may hand it a row id to ignore. POST /leaves passes null and
  // runs this BEFORE the INSERT, which is the point: after the insert the new
  // row would sit in the probe's own result and match itself — the mirror of
  // why applyMalattiaOverlap excludes the malattia by id.
  assert.equal(probe.params[4], 'self-id');
  assert.match(probe.sql, /id <> \$5/);
});
