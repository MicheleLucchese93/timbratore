import { Router } from 'express';
import type { Request } from 'express';
import { z } from 'zod';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { tenantHandler } from '../lib/route-helpers.js';
import { ok } from '../lib/api-response.js';
import { logAudit } from '../lib/audit.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors/index.js';

export const adminStampsRouter = Router();
adminStampsRouter.use(authenticate);
adminStampsRouter.use(requireAdmin);

const AdminCreate = z.object({
  user_id: z.string().uuid(),
  event_type: z.enum(['clock_in', 'clock_out', 'break_start', 'break_end', 'lunch_start', 'lunch_end']),
  occurred_at: z.string().datetime({ offset: true }),
  branch_id: z.string().uuid().nullable().optional(),
  notes: z.string().max(500).optional(),
  out_of_geofence: z.boolean().optional(),
  justification: z.string().min(3).max(500),
});

adminStampsRouter.post(
  '/stamps',
  tenantHandler(async (req, res, client) => {
    const parse = AdminCreate.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const b = parse.data;
    const member = await client.query(
      `SELECT 1 FROM memberships
       WHERE tenant_id = current_setting('app.current_tenant_id')::uuid
         AND user_id = $1 AND deleted_at IS NULL`,
      [b.user_id]
    );
    if (member.rowCount === 0) throw new NotFoundError('user not in tenant');
    await client.query(`SELECT set_config('app.change_reason', $1, true)`, [
      `admin_manual:${b.justification}`,
    ]);
    const ins = await client.query(
      `INSERT INTO stamps(tenant_id, user_id, event_type, occurred_at, source, branch_id, notes, out_of_geofence)
       VALUES (current_setting('app.current_tenant_id')::uuid, $1, $2, $3, 'admin_manual', $4, $5, $6)
       RETURNING *`,
      [b.user_id, b.event_type, b.occurred_at, b.branch_id ?? null, b.notes ?? null, b.out_of_geofence ?? false]
    );
    await emitAuditAndOutbox(client, req.user!.tenantId, 'stamp.admin_create', ins.rows[0].id, ins.rows[0].user_id, null, ins.rows[0], req);
    ok(res, ins.rows[0], 201);
  })
);

const AdminPatch = z.object({
  event_type: z.enum(['clock_in', 'clock_out', 'break_start', 'break_end', 'lunch_start', 'lunch_end']).optional(),
  occurred_at: z.string().datetime({ offset: true }).optional(),
  branch_id: z.string().uuid().nullable().optional(),
  notes: z.string().max(500).optional(),
  justification: z.string().min(3).max(500),
});

adminStampsRouter.patch(
  '/stamps/:id',
  tenantHandler(async (req, res, client) => {
    const parse = AdminPatch.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const before = await client.query(`SELECT * FROM stamps WHERE id = $1`, [req.params.id]);
    if (before.rowCount === 0) throw new NotFoundError('stamp');
    const set: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const [k, v] of Object.entries(parse.data)) {
      if (k === 'justification') continue;
      if (v === undefined) continue;
      set.push(`${k} = $${i++}`);
      values.push(v);
    }
    if (set.length === 0) return ok(res, before.rows[0]);
    values.push(req.params.id);
    await client.query(`SELECT set_config('app.change_reason', $1, true)`, [
      `admin_edit:${parse.data.justification}`,
    ]);
    const r = await client.query(
      `UPDATE stamps SET ${set.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );
    await emitAuditAndOutbox(client, req.user!.tenantId, 'stamp.admin_update', String(req.params.id), before.rows[0].user_id, before.rows[0], r.rows[0], req);
    ok(res, r.rows[0]);
  })
);

const AdminDelete = z.object({ deletion_reason: z.string().min(3).max(500) });

adminStampsRouter.delete(
  '/stamps/:id',
  tenantHandler(async (req, res, client) => {
    const parse = AdminDelete.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    await client.query(`SELECT set_config('app.change_reason', $1, true)`, [
      `admin_delete:${parse.data.deletion_reason}`,
    ]);
    const r = await client.query(
      `UPDATE stamps SET deleted_at = now(), deleted_by_user_id = current_setting('app.current_user_id')::uuid,
                       deletion_reason = $1
       WHERE id = $2 AND deleted_at IS NULL
       RETURNING *`,
      [parse.data.deletion_reason, req.params.id]
    );
    if (r.rowCount === 0) throw new NotFoundError('stamp');
    await emitAuditAndOutbox(client, req.user!.tenantId, 'stamp.admin_delete', String(req.params.id), r.rows[0].user_id, r.rows[0], null, req);
    ok(res, { deleted: true });
  })
);

const BulkApply = z.object({
  user_id: z.string().uuid(),
  branch_id: z.string().uuid().nullable().optional(),
  dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1).max(60),
  schedule: z.object({
    clock_in: z.string().regex(/^\d{2}:\d{2}$/),
    clock_out: z.string().regex(/^\d{2}:\d{2}$/),
    break_start: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    break_end: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    lunch_start: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    lunch_end: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  }),
});

adminStampsRouter.post(
  '/stamps/bulk-apply-standard',
  tenantHandler(async (req, res, client) => {
    const parse = BulkApply.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const b = parse.data;
    const results: Array<{ date: string; status: 'created' | 'skipped' | 'error'; reason?: string }> = [];
    await client.query(`SELECT set_config('app.change_reason', $1, true)`, [
      'bulk_apply_standard',
    ]);
    for (const date of b.dates) {
      const existing = await client.query(
        `SELECT 1 FROM stamps
         WHERE user_id = $1 AND deleted_at IS NULL
           AND occurred_at >= $2::date AND occurred_at < ($2::date + interval '1 day')`,
        [b.user_id, date]
      );
      if (existing.rowCount && existing.rowCount > 0) {
        results.push({ date, status: 'skipped', reason: 'stamps_exist' });
        continue;
      }
      try {
        await client.query(
          `INSERT INTO stamps(tenant_id, user_id, event_type, occurred_at, source, branch_id, notes)
           VALUES (current_setting('app.current_tenant_id')::uuid, $1, 'clock_in',
                   ($2 || ' ' || $3 || ':00')::timestamptz, 'admin_manual', $4, 'bulk_apply_standard')`,
          [b.user_id, date, b.schedule.clock_in, b.branch_id ?? null]
        );
        if (b.schedule.break_start && b.schedule.break_end) {
          await client.query(
            `INSERT INTO stamps(tenant_id, user_id, event_type, occurred_at, source, branch_id, notes)
             VALUES (current_setting('app.current_tenant_id')::uuid, $1, 'break_start',
                     ($2 || ' ' || $3 || ':00')::timestamptz, 'admin_manual', $4, 'bulk_apply_standard')`,
            [b.user_id, date, b.schedule.break_start, b.branch_id ?? null]
          );
          await client.query(
            `INSERT INTO stamps(tenant_id, user_id, event_type, occurred_at, source, branch_id, notes)
             VALUES (current_setting('app.current_tenant_id')::uuid, $1, 'break_end',
                     ($2 || ' ' || $3 || ':00')::timestamptz, 'admin_manual', $4, 'bulk_apply_standard')`,
            [b.user_id, date, b.schedule.break_end, b.branch_id ?? null]
          );
        }
        if (b.schedule.lunch_start && b.schedule.lunch_end) {
          await client.query(
            `INSERT INTO stamps(tenant_id, user_id, event_type, occurred_at, source, branch_id, notes)
             VALUES (current_setting('app.current_tenant_id')::uuid, $1, 'lunch_start',
                     ($2 || ' ' || $3 || ':00')::timestamptz, 'admin_manual', $4, 'bulk_apply_standard')`,
            [b.user_id, date, b.schedule.lunch_start, b.branch_id ?? null]
          );
          await client.query(
            `INSERT INTO stamps(tenant_id, user_id, event_type, occurred_at, source, branch_id, notes)
             VALUES (current_setting('app.current_tenant_id')::uuid, $1, 'lunch_end',
                     ($2 || ' ' || $3 || ':00')::timestamptz, 'admin_manual', $4, 'bulk_apply_standard')`,
            [b.user_id, date, b.schedule.lunch_end, b.branch_id ?? null]
          );
        }
        await client.query(
          `INSERT INTO stamps(tenant_id, user_id, event_type, occurred_at, source, branch_id, notes)
           VALUES (current_setting('app.current_tenant_id')::uuid, $1, 'clock_out',
                   ($2 || ' ' || $3 || ':00')::timestamptz, 'admin_manual', $4, 'bulk_apply_standard')`,
          [b.user_id, date, b.schedule.clock_out, b.branch_id ?? null]
        );
        results.push({ date, status: 'created' });
      } catch (err) {
        results.push({ date, status: 'error', reason: (err as Error).message.slice(0, 200) });
      }
    }
    const createdDates = results.filter((x) => x.status === 'created').map((x) => x.date);
    // A failed per-date INSERT aborts the shared transaction (no savepoints):
    // any further statement would throw 25P02 and turn the partial-results
    // response into a 500. Nothing gets committed in that case anyway, so the
    // audit row is skipped together with the stamps it would have described.
    const anyError = results.some((x) => x.status === 'error');
    if (createdDates.length && !anyError) {
      await logAudit(client, {
        action: 'stamp.bulk_apply',
        resourceType: 'stamp',
        targetUserId: b.user_id,
        after: { dates: createdDates, schedule: b.schedule },
        req,
      });
    }
    ok(res, { results });
  })
);

// Resolve an anomaly by inserting the clock events that are missing for a day,
// at the times taken from the assigned shift ("orario standard del giorno").
// Additive only: events whose type already exists that calendar day are skipped,
// so real punches are never overwritten.
const FixAnomaly = z.object({
  user_id: z.string().uuid(),
  branch_id: z.string().uuid().nullable().optional(),
  events: z
    .array(
      z.object({
        event_type: z.enum(['clock_in', 'clock_out', 'break_start', 'break_end', 'lunch_start', 'lunch_end']),
        occurred_at: z.string().datetime({ offset: true }),
      })
    )
    .min(1)
    .max(6),
  justification: z.string().min(3).max(500),
});

adminStampsRouter.post(
  '/stamps/fix-anomaly',
  tenantHandler(async (req, res, client) => {
    const parse = FixAnomaly.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const b = parse.data;
    const member = await client.query(
      `SELECT 1 FROM memberships
       WHERE tenant_id = current_setting('app.current_tenant_id')::uuid
         AND user_id = $1 AND deleted_at IS NULL`,
      [b.user_id]
    );
    if (member.rowCount === 0) throw new NotFoundError('user not in tenant');
    await client.query(`SELECT set_config('app.change_reason', $1, true)`, [
      `anomaly_standard:${b.justification}`,
    ]);
    const results: Array<{
      event_type: string;
      occurred_at: string;
      status: 'created' | 'skipped';
      id?: string;
    }> = [];
    for (const ev of b.events) {
      const existing = await client.query(
        `SELECT 1 FROM stamps
         WHERE user_id = $1 AND deleted_at IS NULL AND event_type = $2
           AND occurred_at::date = $3::timestamptz::date`,
        [b.user_id, ev.event_type, ev.occurred_at]
      );
      if (existing.rowCount && existing.rowCount > 0) {
        results.push({ event_type: ev.event_type, occurred_at: ev.occurred_at, status: 'skipped' });
        continue;
      }
      const ins = await client.query(
        `INSERT INTO stamps(tenant_id, user_id, event_type, occurred_at, source, branch_id, notes)
         VALUES (current_setting('app.current_tenant_id')::uuid, $1, $2, $3, 'admin_manual', $4, $5)
         RETURNING *`,
        [b.user_id, ev.event_type, ev.occurred_at, b.branch_id ?? null, `Orario standard (anomalia): ${b.justification}`]
      );
      await emitAuditAndOutbox(client, req.user!.tenantId, 'stamp.admin_create', ins.rows[0].id, ins.rows[0].user_id, null, ins.rows[0], req);
      results.push({
        event_type: ev.event_type,
        occurred_at: ev.occurred_at,
        status: 'created',
        id: ins.rows[0].id,
      });
    }
    ok(res, { results });
  })
);

async function emitAuditAndOutbox(
  client: import('pg').PoolClient,
  tenantId: string,
  action: 'stamp.admin_create' | 'stamp.admin_update' | 'stamp.admin_delete',
  resourceId: string,
  targetUserId: string,
  before: unknown,
  after: unknown,
  req: Request
): Promise<void> {
  await logAudit(client, {
    action,
    resourceType: 'stamp',
    resourceId,
    targetUserId,
    before,
    after,
    req,
  });
  await client.query(
    `INSERT INTO centrifugo_outbox(method, payload)
     VALUES ('publish', jsonb_build_object(
       'channel', 'tenant.' || $1::text || '.dashboard',
       'data', jsonb_build_object('type','stamp_admin', 'action', $2::text, 'stamp_id', $3::text)
     ))`,
    [tenantId, action, resourceId]
  );
}

export { adminStampsRouter as default };
