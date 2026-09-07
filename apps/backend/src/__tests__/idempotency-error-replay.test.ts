import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { v4 as uuidv4 } from 'uuid';
import type { Request, Response, NextFunction } from 'express';
import { pool } from '../lib/db.js';
import { idempotencyMiddleware } from '../middleware/idempotency.js';

// What a stored FAILURE does to a client that cannot pick a new key.
//
// The mobile offline queue commits to one Idempotency-Key when it enqueues a
// punch (apps/mobile/src/lib/offline-queue.native.ts) and resends that same key
// on every drain until the punch lands or the 30-day queue TTL drops it. So the
// first answer the server files under that key is the only answer the queue can
// ever receive for the next 24 hours.
//
// Storing a failure there pinned the wrong verdict: three replayed 400s went to
// one employee on 2026-09-07, and the same shape would keep a punch that met a
// transient 500 — or one rejected while a branch radius was still misconfigured
// — unfilable long after the cause was fixed. Only a success is worth replaying;
// a failure releases the claim so the next attempt re-runs the handler. That is
// safe because the handlers behind this middleware write inside a transaction
// that rolled back, leaving nothing for the retry to duplicate.

const SCOPE = 'test_idem_outcome';

interface FakeRes {
  statusCode: number;
  body: unknown;
  status(code: number): FakeRes;
  json(body: unknown): FakeRes;
}

function fakeRes(): FakeRes {
  const r: FakeRes = {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      r.statusCode = code;
      return r;
    },
    json(body: unknown) {
      r.body = body;
      return r;
    },
  };
  return r;
}

const USER = { id: uuidv4(), tenantId: uuidv4() };

function fakeReq(key: string): Request {
  return {
    header: (name: string) => (name.toLowerCase() === 'idempotency-key' ? key : undefined),
    user: USER,
  } as unknown as Request;
}

/** Run the middleware once; resolves to whether the request reached the handler. */
async function call(key: string): Promise<{ res: FakeRes; reachedHandler: boolean }> {
  const res = fakeRes();
  let reachedHandler = false;
  const next = ((err?: unknown) => {
    if (err) throw err;
    reachedHandler = true;
  }) as NextFunction;
  await idempotencyMiddleware(SCOPE)(fakeReq(key), res as unknown as Response, next);
  return { res, reachedHandler };
}

/** The outcome write is fire-and-forget, so read the row until it settles. */
async function storedStatus(): Promise<number | null | 'absent'> {
  for (let i = 0; i < 100; i += 1) {
    const r = await pool.query(
      `SELECT response_status FROM idempotency_keys WHERE scope = $1`,
      [SCOPE]
    );
    if (r.rowCount === 0) return 'absent';
    if (r.rows[0].response_status !== null) return r.rows[0].response_status as number;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return null;
}

async function clear(): Promise<void> {
  await pool.query(`DELETE FROM idempotency_keys WHERE scope = $1`, [SCOPE]);
}

after(async () => {
  await clear();
  await pool.end();
});

test('a successful answer is stored and replayed verbatim', async () => {
  await clear();
  const key = `succ-${uuidv4()}`;

  const first = await call(key);
  assert.equal(first.reachedHandler, true);
  first.res.status(201).json({ ok: true, data: { id: 'stamp-1' } });
  assert.equal(await storedStatus(), 201);

  // The retry must NOT reach the handler — that is the duplicate punch this
  // middleware exists to prevent — and must get the first answer back.
  const second = await call(key);
  assert.equal(second.reachedHandler, false);
  assert.equal(second.res.statusCode, 201);
  assert.deepEqual(second.res.body, { ok: true, data: { id: 'stamp-1' } });
});

test('a failed answer is released, so the same key can be retried', async () => {
  await clear();
  const key = `fail-${uuidv4()}`;

  const first = await call(key);
  assert.equal(first.reachedHandler, true);
  // An out-of-geofence punch: rejected now, legitimate once the branch radius
  // is corrected. Nothing was written, so nothing needs replaying.
  first.res.status(409).json({ ok: false, error: { code: 'OUT_OF_GEOFENCE' } });
  assert.equal(await storedStatus(), 'absent');

  const second = await call(key);
  assert.equal(second.reachedHandler, true, 'the retry must re-run the handler, not replay the 409');
});

test('a 500 is released too, not pinned for the key TTL', async () => {
  await clear();
  const key = `boom-${uuidv4()}`;

  const first = await call(key);
  assert.equal(first.reachedHandler, true);
  first.res.status(500).json({ ok: false, error: { code: 'INTERNAL' } });
  assert.equal(await storedStatus(), 'absent');

  const second = await call(key);
  assert.equal(second.reachedHandler, true);
});

test('a claim with no answer yet still refuses a concurrent retry', async () => {
  await clear();
  const key = `flight-${uuidv4()}`;

  const first = await call(key);
  assert.equal(first.reachedHandler, true);
  // Handler still working: nothing answered, so the claim stands and a second
  // delivery of the same punch is refused rather than duplicated.
  const second = await call(key);
  assert.equal(second.reachedHandler, false);
  assert.equal(second.res.statusCode, 409);
  assert.deepEqual((second.res.body as { error: { code: string } }).error.code, 'IDEMPOTENCY_IN_FLIGHT');
});
