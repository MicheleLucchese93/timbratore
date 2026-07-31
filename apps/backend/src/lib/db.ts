import { Pool, types } from 'pg';
import type { PoolClient } from 'pg';
import { env } from '../env.js';

// DATE OID 1082 kept as string (boilerplate convention)
types.setTypeParser(1082, (val) => val);

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
});

export type { PoolClient };

export async function withTenantRLS<T>(
  userId: string,
  tenantId: string,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Tenant context for a READ-ONLY partner support session.
 *
 * Differences from withTenantRLS, both deliberate:
 *  - `SET TRANSACTION READ ONLY` — the last-resort guard. If any handler ever
 *    writes on this client (a GET that logs an audit row, a lazy upsert), the
 *    statement fails with SQLSTATE 25006 instead of silently mutating a
 *    customer's data. Reads are unaffected.
 *  - `app.support_tenant` — makes auth.is_admin() true for THIS tenant only
 *    (migration 058). The partner has no membership row, so without it every
 *    admin-scoped policy would return zero rows. It is set to the same value as
 *    app.current_tenant_id, so tenant isolation is unchanged.
 *
 * `app.current_user_id` stays the PARTNER's own id: nothing here impersonates a
 * customer account.
 */
export async function withSupportRLS<T>(
  partnerUserId: string,
  tenantId: string,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET TRANSACTION READ ONLY');
    await client.query("SELECT set_config('app.current_user_id', $1, true)", [partnerUserId]);
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);
    await client.query("SELECT set_config('app.support_tenant', $1, true)", [tenantId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function withRLS<T>(
  userId: string,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function withAdminTx<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
