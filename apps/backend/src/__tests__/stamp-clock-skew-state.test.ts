import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { v4 as uuidv4 } from 'uuid';
import { pool, withTenantRLS } from '../lib/db.js';
import { adminPool } from '../lib/admin-db.js';
import { computeCurrentState, evaluateStamp } from '../services/stamp-service.js';

// A punch made from the app carries the phone's clock. A phone slightly ahead of
// the server stores an occurred_at that is still in the future when the app
// refetches its state right after the 201. The live state must count it anyway,
// or the screen keeps offering the action just performed and the next tap is
// refused with INVALID_TRANSITION (Time System, Sept 2026). An admin's
// future-dated stamp (a planned clock_out) still must not flip the state early.
//
// Runs against the DB like stamp-geofence.test.ts.

const tenants: string[] = [];
const users: string[] = [];

interface Ctx {
  tenantId: string;
  userId: string;
}

async function seed(label: string): Promise<Ctx> {
  const tenantId = uuidv4();
  const userId = uuidv4();
  await adminPool.query(
    `INSERT INTO tenants(id, ragione_sociale, language) VALUES ($1, $2, 'it')`,
    [tenantId, `T-skew-${label}-${userId.slice(0, 8)}`]
  );
  await adminPool.query(`INSERT INTO auth_users(id, email) VALUES ($1, $2)`, [
    userId,
    `skew-${label}-${userId.slice(0, 8)}@sonoqui.local`,
  ]);
  await adminPool.query(
    `INSERT INTO memberships(tenant_id, user_id, role, stamp_modes)
     VALUES ($1, $2, 'user', ARRAY['remote']::text[])`,
    [tenantId, userId]
  );
  tenants.push(tenantId);
  users.push(userId);
  return { tenantId, userId };
}

async function insertStamp(
  ctx: Ctx,
  event: string,
  offsetSql: string,
  source: 'employee_app' | 'admin_manual'
): Promise<void> {
  await adminPool.query(
    `INSERT INTO stamps(tenant_id, user_id, event_type, occurred_at, source)
     VALUES ($1, $2, $3, now() + $4::interval, $5)`,
    [ctx.tenantId, ctx.userId, event, offsetSql, source]
  );
}

const state = (ctx: Ctx) =>
  withTenantRLS(ctx.userId, ctx.tenantId, (c) => computeCurrentState(c, ctx.userId));

after(async () => {
  if (users.length) {
    await adminPool.query(`DELETE FROM stamps WHERE user_id = ANY($1::uuid[])`, [users]);
    await adminPool.query(`DELETE FROM memberships WHERE user_id = ANY($1::uuid[])`, [users]);
  }
  if (tenants.length) {
    await adminPool.query(`DELETE FROM tenants WHERE id = ANY($1::uuid[])`, [tenants]);
  }
  if (users.length) {
    await adminPool.query(`DELETE FROM auth_users WHERE id = ANY($1::uuid[])`, [users]);
  }
  await pool.end();
  await adminPool.end();
});

test('an app clock_out a moment in the future already closes the shift', async () => {
  const ctx = await seed('app-ahead');
  await insertStamp(ctx, 'clock_in', '-9 hours', 'employee_app');
  await insertStamp(ctx, 'clock_out', '2 seconds', 'employee_app');
  const s = await state(ctx);
  assert.equal(s.state, 'nothing');
  assert.equal(s.lastEvent, 'clock_out');
});

test('a repeated clock_out right after is refused as a transition, not accepted', async () => {
  const ctx = await seed('app-ahead-dup');
  await insertStamp(ctx, 'clock_in', '-9 hours', 'employee_app');
  await insertStamp(ctx, 'clock_out', '2 seconds', 'employee_app');
  const now = new Date();
  await assert.rejects(
    () =>
      withTenantRLS(ctx.userId, ctx.tenantId, (client) =>
        evaluateStamp(client, {
          userId: ctx.userId,
          tenantId: ctx.tenantId,
          body: { event_type: 'clock_out', occurred_at: now.toISOString(), device_platform: 'android' },
          source: 'employee_app',
          now,
        })
      ),
    (e: { code?: string }) => e.code === 'INVALID_TRANSITION' || e.code === 'DUPLICATE_TOO_FAST'
  );
});

test('an admin clock_out planned ahead does not close the shift yet', async () => {
  const ctx = await seed('admin-planned');
  await insertStamp(ctx, 'clock_in', '-2 hours', 'employee_app');
  await insertStamp(ctx, 'clock_out', '2 minutes', 'admin_manual');
  assert.equal((await state(ctx)).state, 'clocked_in');
});

test('an app stamp beyond the accepted skew is still not live', async () => {
  const ctx = await seed('app-far');
  await insertStamp(ctx, 'clock_in', '-2 hours', 'employee_app');
  await insertStamp(ctx, 'clock_out', '10 minutes', 'employee_app');
  assert.equal((await state(ctx)).state, 'clocked_in');
});
