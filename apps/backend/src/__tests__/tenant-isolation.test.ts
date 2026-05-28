import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { v4 as uuidv4 } from 'uuid';
import { pool, withTenantRLS } from '../lib/db.js';
import { adminPool } from '../lib/admin-db.js';

interface Seed {
  tenantId: string;
  userId: string;
  branchId: string;
}

async function seedTenant(slug: string): Promise<Seed> {
  const tenantId = uuidv4();
  const userId = uuidv4();
  await adminPool.query(
    `INSERT INTO tenants(id, ragione_sociale, language) VALUES ($1, $2, 'it')`,
    [tenantId, `Test-${slug}-${Date.now()}`]
  );
  await adminPool.query(
    `INSERT INTO auth_users(id, email) VALUES ($1, $2)`,
    [userId, `test-${slug}-${Date.now()}@sonoqui.local`]
  );
  await adminPool.query(
    `INSERT INTO memberships(tenant_id, user_id, role) VALUES ($1, $2, 'admin')`,
    [tenantId, userId]
  );
  const b = await adminPool.query(
    `INSERT INTO branches(tenant_id, name, latitude, longitude) VALUES ($1, $2, 0, 0) RETURNING id`,
    [tenantId, `Branch-${slug}`]
  );
  return { tenantId, userId, branchId: b.rows[0].id };
}

test('per-request DB role does NOT have BYPASSRLS', async () => {
  // Regression guard for the prod incident where the `app` role was created
  // with rolbypassrls=true, silently disabling every tenant-isolation policy.
  const client = await pool.connect();
  try {
    const r = await client.query<{ user: string; bypasses: boolean }>(
      `SELECT current_user AS user, rolbypassrls AS bypasses
         FROM pg_roles
        WHERE rolname = current_user`
    );
    const row = r.rows[0];
    assert.ok(row, 'expected current_user row in pg_roles');
    assert.equal(
      row.bypasses,
      false,
      `Role "${row.user}" has BYPASSRLS=true; tenant RLS is silently disabled. ` +
        `Run infra/fix-app-role-rls.sql as superuser.`
    );
  } finally {
    client.release();
  }
});

test('cross-tenant branch SELECT is blocked by RLS', async () => {
  const a = await seedTenant('A');
  const b = await seedTenant('B');
  const seen = await withTenantRLS(a.userId, a.tenantId, async (client) => {
    const r = await client.query(`SELECT id FROM branches WHERE id = $1`, [b.branchId]);
    return r.rowCount;
  });
  assert.equal(seen, 0);
});

test('cross-tenant stamps INSERT is blocked', async () => {
  const a = await seedTenant('C');
  const b = await seedTenant('D');
  await assert.rejects(async () => {
    await withTenantRLS(a.userId, a.tenantId, async (client) => {
      await client.query(
        `INSERT INTO stamps(tenant_id, user_id, event_type, occurred_at, source)
         VALUES ($1, $2, 'clock_in', now(), 'admin_manual')`,
        [b.tenantId, a.userId]
      );
    });
  });
});

test('same-tenant own-stamp SELECT works', async () => {
  const a = await seedTenant('E');
  const stampId = await withTenantRLS(a.userId, a.tenantId, async (client) => {
    const r = await client.query(
      `INSERT INTO stamps(tenant_id, user_id, event_type, occurred_at, source)
       VALUES ($1, $2, 'clock_in', now(), 'admin_manual') RETURNING id`,
      [a.tenantId, a.userId]
    );
    return r.rows[0].id;
  });
  const seen = await withTenantRLS(a.userId, a.tenantId, async (client) => {
    const r = await client.query(`SELECT id FROM stamps WHERE id = $1`, [stampId]);
    return r.rowCount;
  });
  assert.equal(seen, 1);
});

after(async () => {
  await pool.end();
  await adminPool.end();
});
