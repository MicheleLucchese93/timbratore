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
