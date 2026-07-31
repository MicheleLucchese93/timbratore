import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { v4 as uuidv4 } from 'uuid';
import { pool, withSupportRLS, withTenantRLS } from '../lib/db.js';
import { adminPool } from '../lib/admin-db.js';
import {
  createSupportSession,
  redeemSupportCode,
  resolveSupportSession,
  revokeSupportSession,
  isSupportDeniedPath,
  isReadMethod,
} from '../lib/support-session.js';

// Read-only partner support sessions. The three guarantees under test:
//   1. the partner SEES the tenant's admin-scoped data despite having no
//      membership row (auth.is_admin() honours app.support_tenant),
//   2. the partner CANNOT write anything (read-only transaction),
//   3. the partner cannot reach any OTHER tenant, and the handoff code is
//      single-use / revocable / expirable.

interface Fixture {
  tenantId: string;
  employeeId: string;
  partnerId: string;
  stampId: string;
}

async function seed(slug: string): Promise<Fixture> {
  const stamp = Date.now();
  const tenantId = uuidv4();
  const employeeId = uuidv4();
  const partnerId = uuidv4();
  await adminPool.query(`INSERT INTO tenants(id, ragione_sociale, language) VALUES ($1, $2, 'it')`, [
    tenantId,
    `SUP-${slug}-${stamp}`,
  ]);
  await adminPool.query(`INSERT INTO auth_users(id, email) VALUES ($1, $2), ($3, $4)`, [
    employeeId,
    `sup-emp-${slug}-${stamp}@sonoqui.local`,
    partnerId,
    `sup-partner-${slug}-${stamp}@sonoqui.local`,
  ]);
  await adminPool.query(`INSERT INTO memberships(tenant_id, user_id, role) VALUES ($1, $2, 'user')`, [
    tenantId,
    employeeId,
  ]);
  const s = await adminPool.query(
    `INSERT INTO stamps(tenant_id, user_id, event_type, occurred_at, source)
     VALUES ($1, $2, 'clock_in', now(), 'employee_app') RETURNING id`,
    [tenantId, employeeId]
  );
  return { tenantId, employeeId, partnerId, stampId: s.rows[0].id };
}

async function openSession(f: Fixture) {
  const created = await createSupportSession({ partnerUserId: f.partnerId, tenantId: f.tenantId });
  const redeemed = await redeemSupportCode(created.code, {});
  assert.ok(redeemed, 'expected the fresh code to redeem');
  return { created, redeemed };
}

test('support session reads another tenant\'s stamps without a membership', async () => {
  const f = await seed('read');
  const { redeemed } = await openSession(f);

  const rows = await withSupportRLS(f.partnerId, f.tenantId, async (c) => {
    const r = await c.query(`SELECT id FROM stamps WHERE tenant_id = $1`, [f.tenantId]);
    return r.rows;
  });
  assert.equal(rows.length, 1, 'partner should see the tenant stamp via app.support_tenant');
  assert.equal(rows[0].id, f.stampId);

  // Same partner WITHOUT the support GUC sees nothing: the read is granted by
  // the session, not by the user.
  const none = await withTenantRLS(f.partnerId, f.tenantId, async (c) => {
    const r = await c.query(`SELECT id FROM stamps WHERE tenant_id = $1`, [f.tenantId]);
    return r.rows;
  });
  assert.equal(none.length, 0, 'without the support GUC the partner must see nothing');
  assert.equal(redeemed.session.tenantId, f.tenantId);
});

test('support session cannot write — the transaction is read-only', async () => {
  const f = await seed('write');
  await openSession(f);

  await assert.rejects(
    withSupportRLS(f.partnerId, f.tenantId, async (c) => {
      await c.query(`UPDATE stamps SET notes = 'tampered' WHERE id = $1`, [f.stampId]);
    }),
    (err: unknown) => (err as { code?: string }).code === '25006',
    'expected SQLSTATE 25006 (read_only_sql_transaction)'
  );

  const after_ = await adminPool.query(`SELECT notes FROM stamps WHERE id = $1`, [f.stampId]);
  assert.equal(after_.rows[0].notes, null, 'the stamp must be untouched');
});

test('support session stays inside its own tenant', async () => {
  const mine = await seed('own');
  const other = await seed('other');
  await openSession(mine);

  const rows = await withSupportRLS(mine.partnerId, mine.tenantId, async (c) => {
    const r = await c.query(`SELECT id FROM stamps WHERE tenant_id = $1`, [other.tenantId]);
    return r.rows;
  });
  assert.equal(rows.length, 0, 'RLS must still scope reads to the session tenant');
});

test('handoff code is single-use and the session is revocable', async () => {
  const f = await seed('code');
  const created = await createSupportSession({ partnerUserId: f.partnerId, tenantId: f.tenantId });

  const first = await redeemSupportCode(created.code, {});
  assert.ok(first, 'first redemption must succeed');
  const second = await redeemSupportCode(created.code, {});
  assert.equal(second, null, 'a redeemed code must never work twice');

  const claim = { sid: created.sessionId, tid: f.tenantId };
  assert.ok(await resolveSupportSession(claim, f.partnerId), 'live session resolves');
  // Bound to the partner who opened it: another user id must not resolve it.
  assert.equal(await resolveSupportSession(claim, f.employeeId), null);

  assert.equal(await revokeSupportSession(created.sessionId, f.partnerId), true);
  assert.equal(
    await resolveSupportSession(claim, f.partnerId),
    null,
    'a revoked session must stop resolving immediately (no cache)'
  );
});

test('an unredeemed session does not resolve', async () => {
  const f = await seed('pending');
  const created = await createSupportSession({ partnerUserId: f.partnerId, tenantId: f.tenantId });
  assert.equal(
    await resolveSupportSession({ sid: created.sessionId, tid: f.tenantId }, f.partnerId),
    null,
    'a token can only exist after redemption, so an unstarted session is invalid'
  );
});

test('documents and export downloads are denied paths; only reads pass', () => {
  assert.equal(isSupportDeniedPath('/api/v1/documents'), true);
  assert.equal(isSupportDeniedPath('/api/v1/documents/me'), true);
  assert.equal(
    isSupportDeniedPath('/api/v1/exports/2f2f0a1e-0000-4000-8000-000000000000/download'),
    true
  );
  assert.equal(isSupportDeniedPath('/api/v1/stamps'), false);
  assert.equal(isReadMethod('GET'), true);
  assert.equal(isReadMethod('post'), false);
  assert.equal(isReadMethod('PATCH'), false);
});

after(async () => {
  await pool.end();
  await adminPool.end();
});
