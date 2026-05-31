import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { adminPool } from '../lib/admin-db.js';
import { autoClockout } from '../services/jobs/auto-clockout.js';

// Integration test for the 15h auto clock-out job. The cron itself cannot be
// exercised via Playwright (it needs a >15h-old shift + a scheduler tick), so
// the behaviour is covered here against the DB, like tenant-isolation.test.ts.
//
// NOTE: autoClockout() is global (no tenant filter) — it closes every shift
// open >15h in the connected database. That is the intended production
// behaviour; in the test DB it also means any *other* stale open shift gets
// closed. Assertions below are scoped to the seeded users only.

const tenants: string[] = [];
const users: string[] = [];

async function seedOpenShift(hoursAgo: number): Promise<{ tenantId: string; userId: string }> {
  const tenantId = randomUUID();
  const userId = randomUUID();
  await adminPool.query(
    `INSERT INTO tenants(id, ragione_sociale, language) VALUES ($1, $2, 'it')`,
    [tenantId, `T-autoclockout-${userId.slice(0, 8)}`]
  );
  await adminPool.query(
    `INSERT INTO stamps(tenant_id, user_id, event_type, occurred_at, source)
     VALUES ($1, $2, 'clock_in', now() - ($3 || ' hours')::interval, 'employee_app')`,
    [tenantId, userId, String(hoursAgo)]
  );
  tenants.push(tenantId);
  users.push(userId);
  return { tenantId, userId };
}

after(async () => {
  if (users.length) {
    await adminPool.query(`DELETE FROM stamps WHERE user_id = ANY($1::uuid[])`, [users]);
  }
  if (tenants.length) {
    await adminPool.query(`DELETE FROM tenants WHERE id = ANY($1::uuid[])`, [tenants]);
  }
});

test('autoClockout closes a shift open >15h at clock_in + 15h with source system_auto', async () => {
  const { userId } = await seedOpenShift(16);
  await autoClockout();
  const r = await adminPool.query(
    `SELECT s.source,
            EXTRACT(EPOCH FROM (s.occurred_at - ci.occurred_at))::int AS gap_s
       FROM stamps s
       JOIN stamps ci ON ci.user_id = s.user_id AND ci.event_type = 'clock_in'
      WHERE s.user_id = $1 AND s.event_type = 'clock_out' AND s.deleted_at IS NULL`,
    [userId]
  );
  assert.equal(r.rowCount, 1, 'exactly one auto clock_out inserted');
  assert.equal(r.rows[0].source, 'system_auto');
  assert.equal(Number(r.rows[0].gap_s), 15 * 3600, 'clock_out is exactly clock_in + 15h');
});

test('autoClockout leaves a shift open <15h untouched', async () => {
  const { userId } = await seedOpenShift(10);
  await autoClockout();
  const r = await adminPool.query(
    `SELECT 1 FROM stamps WHERE user_id = $1 AND event_type = 'clock_out' AND deleted_at IS NULL`,
    [userId]
  );
  assert.equal(r.rowCount, 0, 'no clock_out for a shift open <15h');
});
