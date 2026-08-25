import { Pool, types } from 'pg';
import type { PoolClient } from 'pg';
import { env } from '../env.js';
import { instrumentClient, instrumentPool } from './request-perf.js';

// DATE OID 1082 kept as string (boilerplate convention)
types.setTypeParser(1082, (val) => val);

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
});

// Every statement's duration is attributed to the request that issued it (see
// lib/request-perf.ts) so the http log can split durMs into dbMs + app time.
instrumentPool(pool);

export type { PoolClient };

export async function withTenantRLS<T>(
  userId: string,
  tenantId: string,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  const untime = instrumentClient(client);
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
    // Undo BEFORE release: pg hands the same client object back on the next
    // connect(), so a patch left in place would leak into the next request.
    untime();
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
  const untime = instrumentClient(client);
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
    // Undo BEFORE release: pg hands the same client object back on the next
    // connect(), so a patch left in place would leak into the next request.
    untime();
    client.release();
  }
}

/**
 * Tenant context for a request authenticated by an API KEY (the API module).
 *
 * Deliberately the ordinary RLS pool and the ordinary `app` role, not the
 * service role: a machine surface written against adminPool is one forgotten
 * `WHERE tenant_id = $1` away from serving another company's data, and there is
 * nothing behind it. Here RLS is the boundary, exactly as it is for a web
 * request, and a missing predicate returns too little instead of too much.
 *
 * Two GUCs make that work, and both are deliberate:
 *  - `app.api_tenant` — makes auth.is_admin() true for THIS tenant only
 *    (migration 064), because a key has no membership row and every
 *    admin-scoped policy resolves through that function. It is set to the same
 *    value as app.current_tenant_id, so it cannot widen the tenant scope.
 *  - `app.current_user_id` — the KEY's id, not a person's. auth.uid() then
 *    matches no membership, so own-scoped policies ("my own requests") return
 *    nothing for a key, and every audit row it writes carries the key id as its
 *    actor — which is what the Registro renders as "API · <key name>".
 *
 * NOT read-only, unlike withSupportRLS: a key with a `:write` scope is meant to
 * write. The scope check happens one layer up, in middleware/api-key.ts.
 */
export async function withApiRLS<T>(
  apiKeyId: string,
  tenantId: string,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  const untime = instrumentClient(client);
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_user_id', $1, true)", [apiKeyId]);
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);
    await client.query("SELECT set_config('app.api_tenant', $1, true)", [tenantId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    // Undo BEFORE release: pg hands the same client object back on the next
    // connect(), so a patch left in place would leak into the next request.
    untime();
    client.release();
  }
}

export async function withRLS<T>(
  userId: string,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  const untime = instrumentClient(client);
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
    // Undo BEFORE release: pg hands the same client object back on the next
    // connect(), so a patch left in place would leak into the next request.
    untime();
    client.release();
  }
}

export async function withAdminTx<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  const untime = instrumentClient(client);
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    // Undo BEFORE release: pg hands the same client object back on the next
    // connect(), so a patch left in place would leak into the next request.
    untime();
    client.release();
  }
}
