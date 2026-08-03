import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { v4 as uuidv4 } from 'uuid';
import { pool, withTenantRLS } from '../lib/db.js';
import { adminPool } from '../lib/admin-db.js';
import { describeHistoryRow, parseChangeReason, loadStampHistory } from '../lib/stamp-history.js';

// Edit provenance on stamps (migration 059) + the reading side that turns the
// raw stamps_history rows into a trail.
//
// The invariants under test are the ones a contestation rests on: the value the
// employee stamped is never overwritten, the FIRST original survives repeated
// edits, and only a real change to the punch (time or event type) counts — a
// note tweak or a soft delete must not flip a stamp to "modified" or reset what
// it originally was.

const tenants: string[] = [];

async function makeTenant(): Promise<{ tenantId: string; userId: string }> {
  const t = await adminPool.query(
    `INSERT INTO tenants(ragione_sociale) VALUES ($1) RETURNING id`,
    [`test-prov-${uuidv4().slice(0, 8)}`]
  );
  const tenantId = t.rows[0].id as string;
  tenants.push(tenantId);
  const userId = uuidv4();
  await adminPool.query(`INSERT INTO auth_users(id, email) VALUES ($1, $2)`, [
    userId,
    `prov-${userId}@test.local`,
  ]);
  await adminPool.query(
    `INSERT INTO memberships(tenant_id, user_id, role) VALUES ($1, $2, 'admin')`,
    [tenantId, userId]
  );
  return { tenantId, userId };
}

interface StampRow {
  id: string;
  occurred_at: Date;
  event_type: string;
  original_occurred_at: Date | null;
  original_event_type: string | null;
  edited_at: Date | null;
  edited_by_user_id: string | null;
  edit_count: number;
}

async function seedStamp(tenantId: string, userId: string, at: string): Promise<StampRow> {
  return withTenantRLS(userId, tenantId, async (c) => {
    await c.query(`SELECT set_config('app.change_reason', 'employee_stamp', true)`);
    const r = await c.query(
      `INSERT INTO stamps(tenant_id, user_id, event_type, occurred_at, source,
                          original_occurred_at, edit_count)
       VALUES ($1, $2, 'clock_in', $3, 'employee_app', $4, 99)
       RETURNING *`,
      // The caller lies about the provenance columns on purpose: the INSERT
      // trigger must scrub them, or an API bug could fabricate an "original".
      [tenantId, userId, at, '1999-01-01T00:00:00Z']
    );
    return r.rows[0] as StampRow;
  });
}

test('a fresh punch carries no provenance, whatever the caller passes', async () => {
  const { tenantId, userId } = await makeTenant();
  const s = await seedStamp(tenantId, userId, '2026-07-20T06:47:00Z');
  assert.equal(s.original_occurred_at, null);
  assert.equal(s.original_event_type, null);
  assert.equal(s.edited_at, null);
  assert.equal(s.edit_count, 0);
});

test('moving a punch records the original, the actor and the count', async () => {
  const { tenantId, userId } = await makeTenant();
  const s = await seedStamp(tenantId, userId, '2026-07-20T06:47:00Z');

  const after = await withTenantRLS(userId, tenantId, async (c) => {
    await c.query(`SELECT set_config('app.change_reason', 'admin_edit:badge rotto', true)`);
    const r = await c.query(
      `UPDATE stamps SET occurred_at = $1 WHERE id = $2 RETURNING *`,
      ['2026-07-20T07:03:00Z', s.id]
    );
    return r.rows[0] as StampRow;
  });

  assert.equal(after.original_occurred_at?.toISOString(), '2026-07-20T06:47:00.000Z');
  assert.equal(after.original_event_type, 'clock_in');
  assert.equal(after.edit_count, 1);
  assert.equal(after.edited_by_user_id, userId);
  assert.notEqual(after.edited_at, null);
});

test('the FIRST original survives further edits', async () => {
  const { tenantId, userId } = await makeTenant();
  const s = await seedStamp(tenantId, userId, '2026-07-20T06:47:00Z');

  const after = await withTenantRLS(userId, tenantId, async (c) => {
    await c.query(`SELECT set_config('app.change_reason', 'admin_edit:prima', true)`);
    await c.query(`UPDATE stamps SET occurred_at = $1 WHERE id = $2`, [
      '2026-07-20T07:03:00Z',
      s.id,
    ]);
    await c.query(`SELECT set_config('app.change_reason', 'admin_edit:seconda', true)`);
    const r = await c.query(
      `UPDATE stamps SET occurred_at = $1 WHERE id = $2 RETURNING *`,
      ['2026-07-20T07:30:00Z', s.id]
    );
    return r.rows[0] as StampRow;
  });

  assert.equal(
    after.original_occurred_at?.toISOString(),
    '2026-07-20T06:47:00.000Z',
    'the employee-stamped value, not the intermediate one'
  );
  assert.equal(after.edit_count, 2);
});

test('a note-only edit and a soft delete are not "modified"', async () => {
  const { tenantId, userId } = await makeTenant();
  const s = await seedStamp(tenantId, userId, '2026-07-20T06:47:00Z');

  const after = await withTenantRLS(userId, tenantId, async (c) => {
    await c.query(`SELECT set_config('app.change_reason', 'admin_edit:nota', true)`);
    await c.query(`UPDATE stamps SET notes = 'una nota' WHERE id = $1`, [s.id]);
    await c.query(`SELECT set_config('app.change_reason', 'admin_delete:doppia', true)`);
    const r = await c.query(
      `UPDATE stamps SET deleted_at = now(), deletion_reason = 'doppia' WHERE id = $1 RETURNING *`,
      [s.id]
    );
    return r.rows[0] as StampRow;
  });

  assert.equal(after.original_occurred_at, null, 'the badge must mean "the punch moved"');
  assert.equal(after.edit_count, 0);
});

test('the history trail names the actor, the reason and the changed field', async () => {
  const { tenantId, userId } = await makeTenant();
  const s = await seedStamp(tenantId, userId, '2026-07-20T06:47:00Z');
  await withTenantRLS(userId, tenantId, async (c) => {
    await c.query(`SELECT set_config('app.change_reason', 'admin_edit:badge rotto', true)`);
    await c.query(`UPDATE stamps SET occurred_at = $1 WHERE id = $2`, [
      '2026-07-20T07:03:00Z',
      s.id,
    ]);
  });

  const events = await withTenantRLS(userId, tenantId, (c) => loadStampHistory(c, s.id));
  assert.equal(events.length, 2);
  assert.equal(events[0]?.kind, 'employee_stamp');
  assert.equal(events[0]?.operation, 'INSERT');

  const edit = events[1]!;
  assert.equal(edit.kind, 'admin_edit');
  assert.equal(edit.justification, 'badge rotto');
  assert.equal(edit.actor_user_id, userId);
  const changed = edit.changes.find((ch) => ch.field === 'occurred_at');
  assert.ok(changed, 'occurred_at is reported as changed');
  assert.ok(changed!.before?.startsWith('2026-07-20T'));
});

/* ---------- pure helpers, no DB ---------- */

test('parseChangeReason maps every writer prefix', () => {
  assert.deepEqual(parseChangeReason('employee_stamp'), {
    kind: 'employee_stamp',
    justification: null,
    correctionRequestId: null,
  });
  assert.deepEqual(parseChangeReason('user_undo_within_60s').kind, 'employee_undo');
  assert.deepEqual(parseChangeReason('bulk_apply_standard').kind, 'bulk_apply');
  assert.deepEqual(parseChangeReason('auto_clockout_15h').kind, 'auto_clockout');
  assert.deepEqual(parseChangeReason('admin_manual:x').kind, 'admin_create');
  assert.deepEqual(parseChangeReason('anomaly_standard:x').kind, 'anomaly_fix');

  const edit = parseChangeReason('admin_edit:timbratura dimenticata');
  assert.equal(edit.kind, 'admin_edit');
  assert.equal(edit.justification, 'timbratura dimenticata');

  const corr = parseChangeReason('correction_approved:abc-123');
  assert.equal(corr.kind, 'employee_correction');
  assert.equal(corr.correctionRequestId, 'abc-123');

  // An unregistered prefix degrades to "unknown + verbatim text" rather than
  // silently dropping evidence.
  const odd = parseChangeReason('future_writer:qualcosa');
  assert.equal(odd.kind, 'unknown');
  assert.equal(odd.justification, 'future_writer:qualcosa');

  assert.equal(parseChangeReason(null).kind, 'unknown');
});

test('describeHistoryRow diffs only the tracked fields', () => {
  const ev = describeHistoryRow({
    id: 1,
    stamp_id: 'sid',
    user_id: 'uid',
    operation: 'UPDATE',
    recorded_at: new Date('2026-07-31T10:00:00Z'),
    changed_by: 'admin',
    change_reason: 'admin_edit:x',
    before: { occurred_at: 'A', event_type: 'clock_in', notes: null, reminder_sent_at: 'X' },
    after: { occurred_at: 'B', event_type: 'clock_in', notes: 'n', reminder_sent_at: 'Y' },
  });
  const fields = ev.changes.map((c) => c.field).sort();
  assert.deepEqual(fields, ['notes', 'occurred_at'], 'reminder_sent_at is bookkeeping, not evidence');
  assert.equal(ev.snapshot, null, 'an UPDATE has a diff, not a snapshot');
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
