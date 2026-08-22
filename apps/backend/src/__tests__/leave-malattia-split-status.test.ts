import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient, QueryResult } from 'pg';
import { applyMalattiaOverlap, splitContinuationStatus } from '../lib/leave-quota.js';

// What status the two halves of a split absence end up in — the question the
// split itself has to answer, and the one it used to answer by copying.
//
// The defect: the continuation was inserted with `status` copied verbatim from
// the row being split, so a leave already in 'cancellation_pending' became TWO
// cancellation_pending rows. A cancellation is not a property of the absence,
// it is an open QUESTION about it: asked once by the employee, delivered once
// by notifyCancellationRequested, answered once — by id — through POST
// /leaves/:id/decide-cancellation. Only the original id was ever announced, so
// the clone sat there exporting as leave taken and counting in used_pending,
// with no employee-side way out at all: /cancel wants 'pending' and
// /request-cancellation wants 'approved'.
//
// Proven sequence: approved ferie Mon 10 → Fri 21 August 2026 (10 working days,
// 80h), the employee asks to cancel the lot, then falls ill 12 → 14 August. The
// certificate takes the middle, both ends still book hours (16h and 40h), and
// the split fires.
//
// No database: a stub answers the overlap probe and the shift lookup and
// records every write, same as leave-malattia-holiday-split.test.ts.

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
// the weekend.
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

/** The holiday the employee asked to give back: Mon 10 → Fri 21 August, 80h. */
function holiday(status: string): OverlapRow {
  return {
    id: 'ferie-row',
    type: 'ferie',
    from_ts: at('2026-08-10T00:00:00+02:00'),
    to_ts: at('2026-08-21T23:59:00+02:00'),
    duration_hours: 80,
    status,
  };
}

const ILL_FROM = at('2026-08-12T00:00:00+02:00');
const ILL_TO = at('2026-08-14T23:59:00+02:00');

function windowUpdates(calls: Recorded[]): Recorded[] {
  return calls.filter((c) => c.sql.startsWith('UPDATE leave_requests SET from_ts'));
}

function inserts(calls: Recorded[]): Recorded[] {
  return calls.filter((c) => c.sql.includes('INSERT INTO leave_requests'));
}

/** The status the continuation is stored with, and whether it kept the cancellation columns. */
function continuationOf(calls: Recorded[]): { status: unknown; keepsCancellation: unknown } {
  const insert = inserts(calls)[0]!;
  return { status: insert.params[4], keepsCancellation: insert.params[5] };
}

async function split(status: string): Promise<{ calls: Recorded[]; splits: unknown[] }> {
  const { client, calls } = stubClient([holiday(status)]);
  const result = await applyMalattiaOverlap(client, USER, MALATTIA, ILL_FROM, ILL_TO);
  return { calls, splits: result.splits };
}

/* ── the defect ─────────────────────────────────────────────────────────── */

test('a pending cancellation is never cloned onto the second half', async () => {
  const { calls, splits } = await split('cancellation_pending');

  const insert = inserts(calls)[0]!;
  assert.equal(insert.params[1], at('2026-08-15T00:00:00+02:00'));
  assert.equal(insert.params[2], at('2026-08-21T23:59:00+02:00'));
  assert.equal(insert.params[3], 40, 'Mon 17 – Fri 21, five working days');
  // The point of the whole fix: 'approved', not the parent's status.
  assert.equal(continuationOf(calls).status, 'approved');
  assert.deepEqual(splits, [
    { originalId: 'ferie-row', continuationId: 'split-1', continuationStatus: 'approved' },
  ]);
});

test('the question stays on the row the approver was told about', async () => {
  // notifyCancellationRequested fired once, for 'ferie-row'. That id has to
  // still be the one — and the only one — that POST /leaves/:id/decide-cancellation
  // can answer, so the split must not touch the original's status either way.
  const { calls } = await split('cancellation_pending');

  const update = windowUpdates(calls)[0]!;
  assert.equal(update.params[0], at('2026-08-10T00:00:00+02:00'));
  assert.equal(update.params[1], at('2026-08-11T23:59:00+02:00'));
  assert.equal(update.params[2], 16, 'Mon 10 and Tue 11 — the days the decision now covers');
  assert.ok(
    !update.sql.includes('status'),
    'the trim narrows the window; the cancellation it carries is not its business'
  );

  const alsoAsking = inserts(calls).filter((i) => i.params[4] === 'cancellation_pending');
  assert.deepEqual(alsoAsking, [], 'exactly one open cancellation, as the employee filed it');
});

test('the demoted half carries no cancellation text and no cancellation decision', async () => {
  // cancellation_reason is the employee's wording of a question about the
  // ORIGINAL row. On a row that is no longer asking it is a reason nobody will
  // ever answer — and the web grid and the mobile Richieste list both read it
  // straight off the row.
  const { calls } = await split('cancellation_pending');

  assert.equal(continuationOf(calls).keepsCancellation, false);
  const sql = inserts(calls)[0]!.sql;
  for (const col of [
    'cancellation_reason',
    'cancellation_decided_by',
    'cancellation_decided_at',
  ]) {
    assert.match(
      sql,
      new RegExp(`CASE WHEN \\$6::boolean THEN ${col} END`),
      `${col} must be dropped when the question is not carried`
    );
  }
});

/* ── the statuses that ARE the absence, and stay copied ─────────────────── */

test('an approved holiday still splits into two approved halves', async () => {
  const { calls, splits } = await split('approved');

  assert.equal(continuationOf(calls).status, 'approved');
  assert.equal(continuationOf(calls).keepsCancellation, true);
  // No continuationStatus key: the halves agree, so the 'malattia.overlap_applied'
  // payload of an ordinary sick note is byte-for-byte what it was.
  assert.deepEqual(splits, [{ originalId: 'ferie-row', continuationId: 'split-1' }]);
});

test('a still-pending holiday splits into two pending halves', async () => {
  // Not the same shape as a pending cancellation, and the reason is the exit,
  // not the notification: both halves sit in the approver's pending inbox
  // (GET /leaves?scope=all&status=pending) where the decisions are actually
  // taken, each stretch is separately approvable, and the employee can still
  // clear either one alone with POST /leaves/:id/cancel.
  const { calls, splits } = await split('pending');

  assert.equal(continuationOf(calls).status, 'pending');
  assert.equal(continuationOf(calls).keepsCancellation, true);
  assert.deepEqual(splits, [{ originalId: 'ferie-row', continuationId: 'split-1' }]);
});

test('a refused cancellation, being an answer, does travel with both halves', async () => {
  // The parent is 'approved' again after decide-cancellation refused it, and it
  // keeps cancellation_reason + cancellation_decided_by/at as the record of
  // that refusal. The refusal applied to the whole absence, so both pieces of
  // it keep saying so.
  const { calls } = await split('approved');
  assert.equal(continuationOf(calls).keepsCancellation, true);
});

/* ── no half may land where nothing can move it ─────────────────────────── */

// Every endpoint in routes/leaves.ts that moves a leave row out of a state, and
// what it demands of that state. The two an employee can reach unaided are the
// ones that matter here: a half produced by the split is a row nobody was
// notified about, so its owner has to be able to clear it without an approver
// first noticing it exists.
const EMPLOYEE_EXITS: Record<string, string> = {
  pending: 'POST /leaves/:id/cancel',
  approved: 'POST /leaves/:id/request-cancellation',
  // 'cancellation_pending' deliberately absent: only POST /:id/decide-cancellation
  // moves it, only an approver may call it, and only by an id that a single
  // notification carried. That is why the split may not hand it out.
};

test('every status the sweep accepts maps to one the employee can still act on', async () => {
  for (const parent of ['pending', 'approved', 'cancellation_pending'] as const) {
    const half = splitContinuationStatus(parent);
    assert.ok(
      EMPLOYEE_EXITS[half],
      `a ${parent} split would leave a ${half} row with no employee-side exit`
    );
  }
  assert.equal(splitContinuationStatus('pending'), 'pending');
  assert.equal(splitContinuationStatus('approved'), 'approved');
  assert.equal(splitContinuationStatus('cancellation_pending'), 'approved');
});

test('the sweep and the mapping cannot drift apart', async () => {
  // If a status is ever added to the probe's IN list, splitContinuationStatus
  // has to grow an answer for it in the same edit — this reads the list off the
  // SQL the sweep actually runs.
  const { client, calls } = stubClient([]);
  await applyMalattiaOverlap(client, USER, MALATTIA, ILL_FROM, ILL_TO);
  const probe = calls[0]!.sql;
  const listed = /AND status IN \(([^)]+)\)/.exec(probe);
  assert.ok(listed, 'the sweep still filters by status');
  const statuses = listed[1]!.split(',').map((s) => s.trim().replace(/'/g, ''));
  assert.deepEqual(statuses, ['pending', 'approved', 'cancellation_pending']);
  for (const s of statuses) {
    assert.ok(EMPLOYEE_EXITS[splitContinuationStatus(s as 'pending')], `${s} is unmapped`);
  }
});

/* ── the shapes that produce no second row at all ───────────────────────── */

test('a cancellation_pending holiday the certificate swallows whole is superseded', async () => {
  // Nothing survives, so there is no continuation to place and the question
  // dies with the row it was asked about — it leaves the revocations inbox
  // because the row is no longer cancellation_pending, not because anyone
  // answered it. That is the certificate's doing, and the supersede trail says so.
  const { client, calls } = stubClient([
    {
      ...holiday('cancellation_pending'),
      from_ts: at('2026-08-12T00:00:00+02:00'),
      to_ts: at('2026-08-13T23:59:00+02:00'),
      duration_hours: 16,
    },
  ]);
  const result = await applyMalattiaOverlap(client, USER, MALATTIA, ILL_FROM, ILL_TO);

  assert.deepEqual(result.supersededIds, ['ferie-row']);
  assert.deepEqual(result.splits, []);
  assert.equal(inserts(calls).length, 0, 'no orphan half to leave asking');
});

test('a certificate at one end of a cancellation_pending holiday leaves the question whole', async () => {
  // Only one stretch survives, so it is written onto the original row: one row,
  // one status, one open cancellation — narrower, but still exactly the request
  // the approver was told about.
  const { client, calls } = stubClient([holiday('cancellation_pending')]);
  const result = await applyMalattiaOverlap(
    client,
    USER,
    MALATTIA,
    at('2026-08-10T00:00:00+02:00'),
    at('2026-08-14T23:59:00+02:00')
  );

  assert.deepEqual(result.trimmedIds, ['ferie-row']);
  assert.deepEqual(result.splits, []);
  assert.equal(inserts(calls).length, 0);
  assert.equal(windowUpdates(calls)[0]!.params[0], at('2026-08-15T00:00:00+02:00'));
});

/* ── what the residuo reads afterwards ──────────────────────────────────── */

test('the demoted half moves buckets without moving the residuo', async () => {
  // getQuotaSummary: used_approved sums 'approved' rows, used_pending sums
  // 'pending' + 'cancellation_pending', residual_strict = initial + accrued −
  // used_approved, residual_with_pending = residual_strict − used_pending.
  //
  // Before: 80h of ferie, all of it in used_pending — residual_strict did not
  // debit a single day the employee was actually going to be away for.
  // After: 24h became malattia; of the 56h left, 16h stay in used_pending with
  // the open question and 40h are approved ferie again.
  const { calls } = await split('cancellation_pending');
  const firstHalf = Number(windowUpdates(calls)[0]!.params[2]);
  const secondHalf = Number(inserts(calls)[0]!.params[3]);
  const certified = 24; // Wed 12, Thu 13, Fri 14

  assert.equal(firstHalf + secondHalf + certified, 80, 'the original holiday, redistributed');

  const usedPending = firstHalf;
  const usedApproved = secondHalf;
  assert.equal(usedPending, 16);
  assert.equal(usedApproved, 40);
  // residual_with_pending subtracts both buckets, so the number the employee
  // reads in the app does not jump because of where the split put the hours.
  assert.equal(usedApproved + usedPending, 56);
});
