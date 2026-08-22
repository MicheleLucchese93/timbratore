import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAfterCommit } from '../lib/route-helpers.js';

// Why the leave routes stopped sending notifications inside their transaction.
//
// notifyLeaveSubmitted / notifyLeaveAddedByAdmin ran between the INSERT and the
// COMMIT, which meant nodemailer talking to Brevo SMTP — no connectionTimeout is
// configured, so the default 10-minute socket timeout applies — and a bare
// fetch() to exp.host both happened while the transaction still held the
// employee's leave advisory lock and one of the pool's 20 connections. A single
// stalled send blocked every later leave write for that employee for as long as
// the socket hung.
//
// Moving them behind afterCommit() only helps if the runner keeps two promises:
// it never rejects (the HTTP response is already out, so a rejection would try
// to send a second one through the same .catch(next)), and one failing task
// does not cancel the others. Both are pinned here; the "only after COMMIT"
// half is structural — the runner is chained off the transaction promise with
// .then(), so a rollback skips it entirely.

test('tasks run in registration order', async () => {
  const seen: string[] = [];
  await runAfterCommit(
    [
      async () => {
        seen.push('first');
      },
      async () => {
        seen.push('second');
      },
    ],
    '/api/v1/leaves'
  );
  assert.deepEqual(seen, ['first', 'second']);
});

test('a failing task is swallowed and the rest still run', async () => {
  // Three approvers, the first mailbox times out. Approvers two and three must
  // still be told.
  const seen: string[] = [];
  await runAfterCommit(
    [
      async () => {
        throw new Error('SMTP timeout');
      },
      async () => {
        seen.push('approver-2');
      },
      async () => {
        seen.push('approver-3');
      },
    ],
    '/api/v1/leaves'
  );
  assert.deepEqual(seen, ['approver-2', 'approver-3']);
});

test('a synchronously throwing task does not reject the runner either', async () => {
  // A task that throws before its first await rejects at call time rather than
  // inside the promise; the try/catch has to cover that shape too, or the
  // request that already answered 201 would be handed to the error middleware.
  await runAfterCommit(
    [
      (): Promise<void> => {
        throw new Error('boom');
      },
    ],
    '/api/v1/leaves'
  );
});

test('no tasks is a no-op', async () => {
  await runAfterCommit([], '/api/v1/leaves');
});
