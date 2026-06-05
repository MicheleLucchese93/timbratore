import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../lib/db.js';
import { adminPool } from '../lib/admin-db.js';
import { fetchMembership } from '../middleware/auth.js';

// Covers the access-control gate behind the X-Tenant-Id header: a user who
// belongs to several companies (one auth_users row, many memberships) must be
// able to resolve each one by id, and must NOT be able to resolve a tenant they
// don't belong to.

async function newUser(slug: string): Promise<string> {
  const userId = uuidv4();
  await adminPool.query(`INSERT INTO auth_users(id, email) VALUES ($1, $2)`, [
    userId,
    `mt-${slug}-${Date.now()}@sonoqui.local`,
  ]);
  return userId;
}

async function addTenant(slug: string, userId: string, role: 'admin' | 'user'): Promise<string> {
  const tenantId = uuidv4();
  await adminPool.query(
    `INSERT INTO tenants(id, ragione_sociale, language) VALUES ($1, $2, 'it')`,
    [tenantId, `MT-${slug}-${Date.now()}`]
  );
  await adminPool.query(
    `INSERT INTO memberships(tenant_id, user_id, role) VALUES ($1, $2, $3)`,
    [tenantId, userId, role]
  );
  return tenantId;
}

test('same user in two tenants resolves each by id, with its own role', async () => {
  const userId = await newUser('two');
  const tA = await addTenant('A', userId, 'admin');
  const tB = await addTenant('B', userId, 'user');

  const a = await fetchMembership(userId, tA);
  assert.equal(a?.tenantId, tA);
  assert.equal(a?.role, 'admin');

  const b = await fetchMembership(userId, tB);
  assert.equal(b?.tenantId, tB);
  assert.equal(b?.role, 'user');
});

test('requesting a tenant the user does NOT belong to resolves to null (→ 403)', async () => {
  const userId = await newUser('stranger');
  const mine = await addTenant('C', userId, 'admin');

  // A real tenant the user has no membership in.
  const other = uuidv4();
  await adminPool.query(
    `INSERT INTO tenants(id, ragione_sociale, language) VALUES ($1, $2, 'it')`,
    [other, `MT-other-${Date.now()}`]
  );

  assert.equal(await fetchMembership(userId, other), null);
  // An entirely unknown id is equally rejected.
  assert.equal(await fetchMembership(userId, uuidv4()), null);
  // Sanity: the user's own tenant still resolves.
  assert.ok(await fetchMembership(userId, mine));
});

test('no requested tenant falls back to the most-recent membership', async () => {
  const userId = await newUser('fallback');
  await addTenant('old', userId, 'user');
  await new Promise((r) => setTimeout(r, 15)); // ensure distinct created_at
  const tNew = await addTenant('new', userId, 'admin');

  const m = await fetchMembership(userId);
  assert.equal(m?.tenantId, tNew);
  assert.equal(m?.role, 'admin');
});

test('a soft-deleted / inactive membership is not resolvable even by id', async () => {
  const userId = await newUser('revoked');
  const tenantId = await addTenant('revoked', userId, 'admin');
  await adminPool.query(
    `UPDATE memberships SET active = FALSE WHERE tenant_id = $1 AND user_id = $2`,
    [tenantId, userId]
  );
  assert.equal(await fetchMembership(userId, tenantId), null);
});

after(async () => {
  await pool.end();
  await adminPool.end();
});
