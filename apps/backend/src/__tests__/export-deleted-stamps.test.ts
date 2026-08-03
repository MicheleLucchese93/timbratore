import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../lib/db.js';
import { adminPool } from '../lib/admin-db.js';
import {
  loadStampsDetail,
  loadOriginalMinutes,
  type ExportJobRow,
} from '../services/export-service.js';

// Payroll must never see a punch an admin deleted.
//
// The Timbrature sheet (audit trail) and the Centro Paghe LUL builder read the
// SAME loader: the first needs deleted punches, the second must not get them —
// they would become in/out pairs in a type-1 record, i.e. hours on a payslip
// for a punch that was withdrawn. The flag is required and unset-able for that
// reason, and this test pins both directions.

const tenants: string[] = [];

/** Empty tenant + member + a July export job, no stamps. */
async function seedFull(): Promise<{ tenantId: string; userId: string; job: ExportJobRow }> {
  const t = await adminPool.query(
    `INSERT INTO tenants(ragione_sociale) VALUES ($1) RETURNING id`,
    [`test-exp-${uuidv4().slice(0, 8)}`]
  );
  const tenantId = t.rows[0].id as string;
  tenants.push(tenantId);
  const userId = uuidv4();
  await adminPool.query(`INSERT INTO auth_users(id, email) VALUES ($1, $2)`, [
    userId,
    `exp-${userId}@test.local`,
  ]);
  await adminPool.query(
    `INSERT INTO memberships(tenant_id, user_id, role) VALUES ($1, $2, 'user')`,
    [tenantId, userId]
  );
  return {
    tenantId,
    userId,
    job: {
      id: uuidv4(),
      tenant_id: tenantId,
      format: 'xlsx',
      period_from: '2026-07-01',
      period_to: '2026-07-31',
    } as ExportJobRow,
  };
}

async function seed(): Promise<ExportJobRow> {
  const { tenantId, userId, job } = await seedFull();

  const ins = async (at: string) => {
    const r = await adminPool.query(
      `INSERT INTO stamps(tenant_id, user_id, event_type, occurred_at, source)
       VALUES ($1, $2, 'clock_in', $3, 'employee_app') RETURNING id`,
      [tenantId, userId, at]
    );
    return r.rows[0].id as string;
  };
  await ins('2026-07-15T07:00:00Z');
  const deletedId = await ins('2026-07-15T09:00:00Z');
  await adminPool.query(
    `UPDATE stamps SET deleted_at = now(), deletion_reason = 'doppia' WHERE id = $1`,
    [deletedId]
  );

  return job;
}

test('payroll detail excludes soft-deleted punches', async () => {
  const job = await seed();
  const rows = await loadStampsDetail(job, 'Europe/Rome', { includeDeleted: false });
  // The loader does not select id, so identity is asserted on the instant.
  const times = rows.map((r) => new Date(r.occurred_at).toISOString());
  assert.equal(times.length, 1, 'only the live punch reaches the payroll path');
  assert.equal(times[0], '2026-07-15T07:00:00.000Z');
  assert.ok(rows.every((r) => r.deleted_at === null));
});

test('audit detail includes soft-deleted punches, flagged', async () => {
  const job = await seed();
  const rows = await loadStampsDetail(job, 'Europe/Rome', { includeDeleted: true });
  const times = rows.map((r) => new Date(r.occurred_at).toISOString()).sort();
  assert.deepEqual(times, ['2026-07-15T07:00:00.000Z', '2026-07-15T09:00:00.000Z']);
  const removed = rows.find((r) => r.deleted_at !== null);
  assert.ok(removed, 'the deleted punch is present');
  assert.equal(removed!.deletion_reason, 'doppia');
});

// "Ore originali" is the day BEFORE any rettifica: it must diverge from "Ore
// lavorate" exactly where an edit or a deletion happened, and nowhere else.
test('original hours use the pre-edit time and keep deleted punches', async () => {
  const { tenantId, userId, job } = await seedFull();

  const ins = async (ev: string, at: string) => {
    const r = await adminPool.query(
      `INSERT INTO stamps(tenant_id, user_id, event_type, occurred_at, source)
       VALUES ($1, $2, $3, $4, 'employee_app') RETURNING id`,
      [tenantId, userId, ev, at]
    );
    return r.rows[0].id as string;
  };
  // Employee stamps a clean 8h day: 06:00-10:00 and 11:00-15:00 UTC.
  const inId = await ins('clock_in', '2026-07-15T06:00:00Z');
  await ins('lunch_start', '2026-07-15T10:00:00Z');
  await ins('lunch_end', '2026-07-15T11:00:00Z');
  const outId = await ins('clock_out', '2026-07-15T15:00:00Z');

  // Admin moves the entrata one hour later and deletes the uscita.
  await adminPool.query(`UPDATE stamps SET occurred_at = $1 WHERE id = $2`, [
    '2026-07-15T07:00:00Z',
    inId,
  ]);
  await adminPool.query(`UPDATE stamps SET deleted_at = now() WHERE id = $1`, [outId]);

  const byUser = await loadOriginalMinutes(job, 'Europe/Rome');
  const total = [...(byUser.get(userId)?.values() ?? [])].reduce((a, b) => a + b, 0);
  assert.equal(total, 480, 'the day was 8h before the admin moved and deleted punches');
});

// Admin-inserted punches count on BOTH sides, so they must NOT open a gap.
// The first cut of this column excluded them, which on real data produced 0
// hours for employees whose times are typed in by the office — the column has
// to measure rettifiche, not data entry.
test('original hours include admin-inserted punches, so they cancel out', async () => {
  const { tenantId, userId, job } = await seedFull();
  for (const [ev, at] of [
    ['clock_in', '2026-07-16T06:00:00Z'],
    ['clock_out', '2026-07-16T14:00:00Z'],
  ] as const) {
    await adminPool.query(
      `INSERT INTO stamps(tenant_id, user_id, event_type, occurred_at, source)
       VALUES ($1, $2, $3, $4, 'admin_manual')`,
      [tenantId, userId, ev, at]
    );
  }
  const byUser = await loadOriginalMinutes(job, 'Europe/Rome');
  const total = [...(byUser.get(userId)?.values() ?? [])].reduce((a, b) => a + b, 0);
  assert.equal(total, 480, 'an untouched admin-entered day shows no difference');
});

// The pairing must survive a mixed day: employee stamps the entrata, an admin
// supplies the missing uscita. Under the old employee-only rule this scored 0.
test('original hours close a pair split across employee and admin', async () => {
  const { tenantId, userId, job } = await seedFull();
  await adminPool.query(
    `INSERT INTO stamps(tenant_id, user_id, event_type, occurred_at, source)
     VALUES ($1, $2, 'clock_in', '2026-07-17T06:00:00Z', 'employee_app')`,
    [tenantId, userId]
  );
  await adminPool.query(
    `INSERT INTO stamps(tenant_id, user_id, event_type, occurred_at, source)
     VALUES ($1, $2, 'clock_out', '2026-07-17T14:00:00Z', 'admin_manual')`,
    [tenantId, userId]
  );
  const byUser = await loadOriginalMinutes(job, 'Europe/Rome');
  const total = [...(byUser.get(userId)?.values() ?? [])].reduce((a, b) => a + b, 0);
  assert.equal(total, 480, 'the pair closes across sources');
});

after(async () => {
  for (const t of tenants) {
    await adminPool.query(`DELETE FROM stamps_history WHERE tenant_id = $1`, [t]);
    await adminPool.query(`DELETE FROM stamps WHERE tenant_id = $1`, [t]);
    await adminPool.query(`DELETE FROM memberships WHERE tenant_id = $1`, [t]);
    await adminPool.query(`DELETE FROM tenants WHERE id = $1`, [t]);
  }
  await pool.end();
  await adminPool.end();
});
