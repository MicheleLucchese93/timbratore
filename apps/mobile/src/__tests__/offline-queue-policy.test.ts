import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  partitionQueue,
  asQueuedStamp,
  QUEUE_TTL_MS,
  type QueuedStamp,
} from '../lib/offline-queue-policy.js';

// The offline stamp queue used to hold nothing but the payload, so drainQueue()
// delivered whatever it found under whichever session was authenticated. These
// tests pin the rules that make a queued punch belong to somebody.

const NOW = 1_800_000_000_000;
const A = { userId: 'user-a', tenantId: 'tenant-1' };
const B = { userId: 'user-b', tenantId: 'tenant-1' };

function row(over: Partial<QueuedStamp> = {}): QueuedStamp {
  return {
    idempotency_key: over.idempotency_key ?? 'k1',
    payload: over.payload ?? { event_type: 'clock_in', latitude: 45.4712, longitude: 9.1902 },
    enqueued_at: over.enqueued_at ?? NOW - 60_000,
    user_id: over.user_id !== undefined ? over.user_id : A.userId,
    tenant_id: over.tenant_id !== undefined ? over.tenant_id : A.tenantId,
  };
}

const keys = (rows: QueuedStamp[]): string[] => rows.map((r) => r.idempotency_key);

test('a punch is delivered only to the session that made it', () => {
  const p = partitionQueue([row({ idempotency_key: 'mine' })], A, NOW);
  assert.deepEqual(keys(p.send), ['mine']);
  assert.deepEqual(p.keep, []);
  assert.deepEqual(p.drop, []);
});

// The bug: employee A punches offline, hands the device to employee B, B logs
// in, the drain fires. A's punch — time, event and position — was filed as B's.
test('another user’s punch is never delivered under the current session', () => {
  const p = partitionQueue([row({ idempotency_key: 'as-punch' })], B, NOW);
  assert.deepEqual(p.send, [], 'B must not deliver A’s punch');
  assert.deepEqual(keys(p.keep), ['as-punch'], 'and must not lose it either');
});

// Same user, other company: a multi-tenant admin switching companies would
// otherwise file the punch against whichever tenant was selected at drain time.
test('the same user in a different company does not deliver it', () => {
  const p = partitionQueue([row()], { userId: A.userId, tenantId: 'tenant-2' }, NOW);
  assert.deepEqual(p.send, []);
  assert.equal(p.keep.length, 1);
});

test('nothing is delivered, and nothing fresh discarded, with no session yet', () => {
  const p = partitionQueue([row()], null, NOW);
  assert.deepEqual(p.send, []);
  assert.equal(p.keep.length, 1, 'the drain simply runs again once /me resolves');
  assert.deepEqual(p.drop, []);
});

test('rows enqueued before ownership existed are discarded, not guessed at', () => {
  const p = partitionQueue(
    [row({ idempotency_key: 'legacy', user_id: null, tenant_id: null })],
    A,
    NOW
  );
  assert.deepEqual(p.send, [], 'delivering it is exactly the misattribution being fixed');
  assert.deepEqual(keys(p.drop), ['legacy']);
});

test('a half-attributed row is discarded too', () => {
  const p = partitionQueue([row({ tenant_id: null })], A, NOW);
  assert.deepEqual(keys(p.drop), ['k1']);
});

test('a punch past the TTL is discarded, even its owner’s', () => {
  const stale = row({ idempotency_key: 'stale', enqueued_at: NOW - QUEUE_TTL_MS - 1 });
  const p = partitionQueue([stale], A, NOW);
  assert.deepEqual(p.send, []);
  assert.deepEqual(keys(p.drop), ['stale']);
});

test('a punch just inside the TTL is still delivered', () => {
  const p = partitionQueue([row({ enqueued_at: NOW - QUEUE_TTL_MS + 1000 })], A, NOW);
  assert.equal(p.send.length, 1, 'weeks on a site with no signal must still get paid');
});

// The privacy half: the queue is the one place a coordinate still lives, since
// the server discards it after the geofence check. An abandoned row must not
// sit on the device for ever.
test('an expired foreign punch is discarded rather than held', () => {
  const p = partitionQueue(
    [row({ idempotency_key: 'abandoned', user_id: 'gone', enqueued_at: NOW - QUEUE_TTL_MS - 1 })],
    A,
    NOW
  );
  assert.deepEqual(keys(p.drop), ['abandoned']);
  assert.deepEqual(p.keep, []);
});

test('every row lands in exactly one bucket', () => {
  const rows = [
    row({ idempotency_key: 'mine' }),
    row({ idempotency_key: 'theirs', user_id: 'user-b' }),
    row({ idempotency_key: 'legacy', user_id: null, tenant_id: null }),
    row({ idempotency_key: 'stale', enqueued_at: NOW - QUEUE_TTL_MS - 1 }),
  ];
  const p = partitionQueue(rows, A, NOW);
  assert.deepEqual(keys(p.send), ['mine']);
  assert.deepEqual(keys(p.keep), ['theirs']);
  assert.deepEqual(keys(p.drop).sort(), ['legacy', 'stale']);
  assert.equal(p.send.length + p.keep.length + p.drop.length, rows.length);
});

test('asQueuedStamp fills in the ownership a pre-fix row never had', () => {
  const r = asQueuedStamp({ idempotency_key: 'k', payload: {}, enqueued_at: NOW });
  assert.equal(r.user_id, null);
  assert.equal(r.tenant_id, null);
  assert.deepEqual(partitionQueue([r], A, NOW).drop.length, 1);
});
