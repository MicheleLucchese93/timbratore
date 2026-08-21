import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { v4 as uuidv4 } from 'uuid';
import { pool, withTenantRLS } from '../lib/db.js';
import { adminPool } from '../lib/admin-db.js';
import { logAudit } from '../lib/audit.js';
import { stampColumns, stripStampGps, STAMP_GPS_KEYS } from '../lib/stamp-columns.js';

// Per-punch GPS minimisation (migration 060).
//
// A punch keeps its geofence verdict — branch_id, out_of_geofence,
// geofence_distance_m, suspicious_mock_location — and not the position that
// produced it. That has to hold in four places at once, and each of them used to
// be a separate copy of the same coordinates: the API response, the
// append-only stamps_history snapshots, the audit_log payload behind the
// Registro attività, and the realtime outbox. The tests below pin the two that
// no HTTP-level check can see, plus the projection every route now shares.

const GPS = ['latitude', 'longitude', 'gps_accuracy_m'] as const;
const tenants: string[] = [];

async function makeTenant(): Promise<{ tenantId: string; userId: string }> {
  const t = await adminPool.query(
    `INSERT INTO tenants(ragione_sociale) VALUES ($1) RETURNING id`,
    [`test-gps-${uuidv4().slice(0, 8)}`]
  );
  const tenantId = t.rows[0].id as string;
  tenants.push(tenantId);
  const userId = uuidv4();
  await adminPool.query(`INSERT INTO auth_users(id, email) VALUES ($1, $2)`, [
    userId,
    `gps-${userId}@test.local`,
  ]);
  await adminPool.query(
    `INSERT INTO memberships(tenant_id, user_id, role) VALUES ($1, $2, 'admin')`,
    [tenantId, userId]
  );
  return { tenantId, userId };
}

/* ---------------- the shared projection ---------------- */

// The one assertion that fails in BOTH directions, which is why it is worth a
// round-trip to the database: a coordinate column added back to the allowlist
// starts leaking again, and any other new stamps column left out of it silently
// disappears from every API response instead of reaching the clients.
test('stampColumns() is exactly the stamps table minus the GPS columns', async () => {
  const live = await adminPool.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'stamps'
      ORDER BY column_name`
  );
  const expected = live.rows.map((r) => r.column_name).filter((c) => !GPS.includes(c as never));
  const projected = stampColumns()
    .split(', ')
    .map((c) => c.trim())
    .sort();
  assert.deepEqual(projected, expected.sort());
  for (const key of GPS) {
    assert.ok(!projected.includes(key), `${key} must never be projected to a client`);
  }
});

test('stampColumns() qualifies every column when given an alias', () => {
  const cols = stampColumns('s').split(', ');
  assert.ok(cols.length > 1);
  assert.ok(
    cols.every((c) => c.startsWith('s.')),
    'an unqualified column in a joined query is an ambiguous-reference error'
  );
});

/* ---------------- the history trigger ---------------- */

// stamps.ts serves `SELECT * FROM stamps_history` verbatim at
// /stamps/:id/history?raw=1, and the table is append-only (007 REVOKEs
// UPDATE/DELETE), so the trigger is the only thing standing between a stored
// coordinate and a permanent, unreachable copy of it. It is also what makes the
// cleanup_old_gps pass safe: before 060 the same pass archived, into this table,
// precisely the coordinates it had just erased.
test('the history trigger archives no coordinates, on any operation', async () => {
  const { tenantId, userId } = await makeTenant();

  const stampId = await withTenantRLS(userId, tenantId, async (c) => {
    await c.query(`SELECT set_config('app.change_reason', 'gps_probe', true)`);
    // Writes the coordinates directly, bypassing the route: the trigger must
    // hold even for a write path that has not been converted (or a legacy row).
    const ins = await c.query(
      `INSERT INTO stamps(tenant_id, user_id, event_type, occurred_at, source,
                          latitude, longitude, gps_accuracy_m,
                          out_of_geofence, geofence_distance_m)
       VALUES ($1, $2, 'clock_in', '2026-07-20T06:47:00Z', 'employee_app',
               45.4712, 9.1902, 11.5, true, 240)
       RETURNING id`,
      [tenantId, userId]
    );
    const id = ins.rows[0].id as string;
    await c.query(`UPDATE stamps SET notes = 'moved' WHERE id = $1`, [id]);
    await c.query(`DELETE FROM stamps WHERE id = $1`, [id]);
    return id;
  });

  const hist = await adminPool.query<{
    operation: string;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
  }>(
    `SELECT operation, before, after FROM stamps_history WHERE stamp_id = $1 ORDER BY id`,
    [stampId]
  );

  assert.deepEqual(
    hist.rows.map((r) => r.operation),
    ['INSERT', 'UPDATE', 'DELETE']
  );
  for (const row of hist.rows) {
    for (const snap of [row.before, row.after]) {
      if (snap === null) continue;
      for (const key of GPS) {
        assert.ok(!(key in snap), `${row.operation} snapshot still carries ${key}`);
      }
    }
  }
  // The verdict is the part that must survive — a contestation rests on it.
  assert.equal(hist.rows[0]!.after!.out_of_geofence, true);
  assert.equal(hist.rows[0]!.after!.geofence_distance_m, 240);
  assert.ok('occurred_at' in hist.rows[0]!.after!);
});

/* ---------------- the audit payload ---------------- */

test('stripStampGps drops the coordinates and leaves everything else identical', () => {
  const when = new Date('2026-07-20T06:47:00Z');
  const out = stripStampGps({
    id: 'abc',
    occurred_at: when,
    latitude: 45.4712,
    longitude: 9.1902,
    gps_accuracy_m: 11.5,
    out_of_geofence: true,
    geofence_distance_m: 240,
    nested: { latitude: 1, keep: 'yes' },
    list: [{ longitude: 2, keep: 'also' }],
  });
  assert.deepEqual(out, {
    id: 'abc',
    occurred_at: when,
    out_of_geofence: true,
    geofence_distance_m: 240,
    nested: { keep: 'yes' },
    list: [{ keep: 'also' }],
  });
  assert.equal(STAMP_GPS_KEYS.length, 3);
});

// The regression this file exists to prevent: the scrub used to rebuild every
// object from Object.entries, and a Date has no own enumerable properties, so
// `occurred_at` became `{}`. The Registro then diffed `{}` against `{}` and a
// time-only correction — the single most important thing a stamp entry can say —
// disappeared from the entry entirely. No HTTP-level check can see this: it is
// the JSON that logAudit writes, not the JSON a route returns.
test('stripStampGps preserves Date values instead of flattening them', () => {
  const when = new Date('2026-07-20T06:47:00Z');
  const out = stripStampGps({ occurred_at: when, latitude: 45.4712 });
  assert.ok(out.occurred_at instanceof Date, 'a Date must survive the scrub as a Date');
  assert.equal(JSON.stringify(out), `{"occurred_at":"2026-07-20T06:47:00.000Z"}`);
});

test('a stamp audit entry keeps its timestamps and loses its coordinates', async () => {
  const { tenantId, userId } = await makeTenant();

  const stampId = await withTenantRLS(userId, tenantId, async (c) => {
    await c.query(`SELECT set_config('app.change_reason', 'gps_probe', true)`);
    const ins = await c.query(
      `INSERT INTO stamps(tenant_id, user_id, event_type, occurred_at, source,
                          latitude, longitude, gps_accuracy_m, geofence_distance_m)
       VALUES ($1, $2, 'clock_out', '2026-07-20T16:00:00Z', 'employee_app',
               45.4712, 9.1902, 11.5, 240)
       RETURNING id`,
      [tenantId, userId]
    );
    const id = ins.rows[0].id as string;

    // Exactly what admin-stamps.ts does: hand logAudit the raw pg rows, whose
    // timestamptz columns are Date objects.
    const before = await c.query(`SELECT * FROM stamps WHERE id = $1`, [id]);
    const upd = await c.query(
      `UPDATE stamps SET occurred_at = '2026-07-20T16:30:00Z' WHERE id = $1 RETURNING *`,
      [id]
    );
    assert.ok(before.rows[0].occurred_at instanceof Date, 'precondition: pg returns Dates');
    await logAudit(c, {
      action: 'stamp.admin_update',
      resourceType: 'stamp',
      resourceId: id,
      targetUserId: userId,
      before: before.rows[0],
      after: upd.rows[0],
    });
    return id;
  });

  const row = await adminPool.query<{
    before: Record<string, unknown>;
    after: Record<string, unknown>;
  }>(
    `SELECT before, after FROM audit_log
      WHERE tenant_id = $1 AND action = 'stamp.admin_update' AND resource_id = $2`,
    [tenantId, stampId]
  );
  assert.equal(row.rowCount, 1);
  const { before, after } = row.rows[0]!;

  for (const snap of [before, after]) {
    for (const key of GPS) assert.ok(!(key in snap), `audit payload still carries ${key}`);
  }
  // The whole point of the entry: which punch moved, from when to when.
  assert.equal(before.occurred_at, '2026-07-20T16:00:00.000Z');
  assert.equal(after.occurred_at, '2026-07-20T16:30:00.000Z');
  assert.notEqual(before.occurred_at, after.occurred_at, 'the diff must have something to show');
  assert.equal(after.geofence_distance_m, 240);
});

// The counterpart: a sede's coordinates are company configuration, and "the
// branch moved" is exactly what the Registro exists to record. The scrub is
// gated on the action prefix, so branch.* must come through untouched.
test('a branch audit entry keeps its coordinates', async () => {
  const { tenantId, userId } = await makeTenant();
  await withTenantRLS(userId, tenantId, async (c) => {
    await logAudit(c, {
      action: 'branch.update',
      resourceType: 'branch',
      resourceId: uuidv4(),
      before: { name: 'Sede', latitude: 45.1, longitude: 9.1 },
      after: { name: 'Sede', latitude: 45.2, longitude: 9.2 },
    });
  });
  const row = await adminPool.query<{ before: Record<string, unknown> }>(
    `SELECT before FROM audit_log WHERE tenant_id = $1 AND action = 'branch.update'`,
    [tenantId]
  );
  assert.equal(row.rows[0]!.before.latitude, 45.1);
});

after(async () => {
  for (const t of tenants) {
    await adminPool.query(`DELETE FROM audit_log WHERE tenant_id = $1`, [t]);
    await adminPool.query(`DELETE FROM stamps_history WHERE tenant_id = $1`, [t]);
    await adminPool.query(`DELETE FROM stamps WHERE tenant_id = $1`, [t]);
    await adminPool.query(`DELETE FROM memberships WHERE tenant_id = $1`, [t]);
    await adminPool.query(`DELETE FROM tenants WHERE id = $1`, [t]);
  }
  await pool.end();
  await adminPool.end();
});
