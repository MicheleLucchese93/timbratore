import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { tenantHandler } from '../lib/route-helpers.js';
import { ok } from '../lib/api-response.js';
import { logAudit } from '../lib/audit.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors/index.js';
import { getQuotaSummary } from '../lib/leave-quota.js';
import { tenantToday } from '../lib/tz.js';

export const leaveQuotasRouter = Router();
leaveQuotasRouter.use(authenticate);

const TypeEnum = z.enum(['ferie', 'permessi']);
const FrequencyEnum = z.enum(['monthly', 'yearly']);

/* ---------------- Templates ---------------- */

const TemplateBaseShape = z.object({
  name: z.string().min(1).max(120),
  type: TypeEnum,
  hours_default: z.number().nonnegative(),
  accrual_amount: z.number().nonnegative(),
  accrual_frequency: FrequencyEnum,
  accrual_day_of_month: z.number().int().min(1).max(28),
  accrual_month: z.number().int().min(1).max(12).nullable().optional(),
  active: z.boolean().optional(),
});
const TemplateBody = TemplateBaseShape.superRefine((b, ctx) => {
  if (b.accrual_frequency === 'yearly' && !b.accrual_month) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['accrual_month'],
      message: 'accrual_month obbligatorio per frequenza annuale',
    });
  }
});

leaveQuotasRouter.get(
  '/templates',
  tenantHandler(async (_req, res, client) => {
    const r = await client.query(
      `SELECT id, name, type,
              hours_default::float8 AS hours_default,
              accrual_amount::float8 AS accrual_amount,
              accrual_frequency, accrual_day_of_month, accrual_month,
              active, created_at
         FROM leave_quota_templates
        WHERE deleted_at IS NULL
        ORDER BY type, name`
    );
    ok(res, r.rows);
  })
);

leaveQuotasRouter.post(
  '/templates',
  requireAdmin,
  tenantHandler(async (req, res, client) => {
    const parse = TemplateBody.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const b = parse.data;
    try {
      const r = await client.query(
        `INSERT INTO leave_quota_templates(
           tenant_id, name, type, hours_default,
           accrual_amount, accrual_frequency, accrual_day_of_month, accrual_month,
           active
         ) VALUES (
           current_setting('app.current_tenant_id')::uuid,
           $1, $2, $3, $4, $5, $6, $7, $8
         )
         RETURNING *`,
        [
          b.name,
          b.type,
          b.hours_default,
          b.accrual_amount,
          b.accrual_frequency,
          b.accrual_day_of_month,
          b.accrual_frequency === 'yearly' ? b.accrual_month : null,
          b.active ?? true,
        ]
      );
      await logAudit(client, {
        action: 'leave_quota.template_create',
        resourceType: 'leave_quota_template',
        resourceId: r.rows[0].id,
        targetLabel: b.name,
        after: {
          name: b.name,
          type: b.type,
          hours_default: b.hours_default,
          accrual_amount: b.accrual_amount,
          accrual_frequency: b.accrual_frequency,
        },
        req,
      });
      ok(res, r.rows[0], 201);
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new ConflictError('Nome quota già esistente', 'CONFLICT');
      }
      throw err;
    }
  })
);

const PatchTemplate = TemplateBaseShape.partial();

leaveQuotasRouter.patch(
  '/templates/:id',
  requireAdmin,
  tenantHandler(async (req, res, client) => {
    const parse = PatchTemplate.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const updates: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const [k, v] of Object.entries(parse.data)) {
      if (v === undefined) continue;
      updates.push(`${k} = $${i++}`);
      values.push(v);
    }
    if (updates.length === 0) {
      const r = await client.query(
        `SELECT * FROM leave_quota_templates WHERE id = $1 AND deleted_at IS NULL`,
        [req.params.id]
      );
      if (r.rowCount === 0) throw new NotFoundError('template');
      return ok(res, r.rows[0]);
    }
    values.push(req.params.id);
    const r = await client.query(
      `UPDATE leave_quota_templates SET ${updates.join(', ')}
        WHERE id = $${i} AND deleted_at IS NULL RETURNING *`,
      values
    );
    if (r.rowCount === 0) throw new NotFoundError('template');
    await logAudit(client, {
      action: 'leave_quota.template_update',
      resourceType: 'leave_quota_template',
      resourceId: String(req.params.id),
      targetLabel: r.rows[0].name,
      after: parse.data,
      req,
    });
    ok(res, r.rows[0]);
  })
);

leaveQuotasRouter.delete(
  '/templates/:id',
  requireAdmin,
  tenantHandler(async (req, res, client) => {
    const inUse = await client.query(
      `SELECT COUNT(*) AS n FROM leave_quota_assignments
        WHERE template_id = $1 AND ended_on IS NULL`,
      [req.params.id]
    );
    if (Number(inUse.rows[0].n) > 0) {
      throw new ConflictError('Template usato in assegnazioni attive', 'IN_USE');
    }
    const r = await client.query(
      `UPDATE leave_quota_templates SET deleted_at = now()
        WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
      [req.params.id]
    );
    if (r.rowCount === 0) throw new NotFoundError('template');
    await logAudit(client, {
      action: 'leave_quota.template_delete',
      resourceType: 'leave_quota_template',
      resourceId: String(req.params.id),
      targetLabel: r.rows[0].name,
      before: { name: r.rows[0].name, type: r.rows[0].type },
      req,
    });
    ok(res, { deleted: true });
  })
);

/* ---------------- Assignments ---------------- */

const AssignBody = z.object({
  user_id: z.string().uuid(),
  template_id: z.string().uuid(),
  initial_balance: z.number().optional(),
  started_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

leaveQuotasRouter.get(
  '/assignments',
  requireAdmin,
  tenantHandler(async (_req, res, client) => {
    const r = await client.query(
      `SELECT a.id, a.user_id, a.type,
              a.initial_balance::float8 AS initial_balance,
              a.started_on, a.ended_on, a.last_accrual_on,
              a.template_id, t.name AS template_name,
              t.accrual_amount::float8 AS accrual_amount,
              t.accrual_frequency, t.accrual_day_of_month, t.accrual_month,
              COALESCE(au.email, a.user_id::text) AS user_email,
              au.display_name AS user_display_name,
              COALESCE(
                (SELECT SUM(ac.hours)::float8 FROM leave_accruals ac
                  WHERE ac.assignment_id = a.id),
                0
              ) AS accrued_total,
              COALESCE(
                (SELECT SUM(lr.duration_hours)::float8
                   FROM leave_requests lr
                  WHERE lr.user_id = a.user_id
                    AND lr.type = a.type
                    AND lr.status = 'approved'),
                0
              ) AS used_approved,
              COALESCE(
                (SELECT SUM(lr.duration_hours)::float8
                   FROM leave_requests lr
                  WHERE lr.user_id = a.user_id
                    AND lr.type = a.type
                    AND lr.status IN ('pending','cancellation_pending')),
                0
              ) AS used_pending
         FROM leave_quota_assignments a
         JOIN leave_quota_templates t ON t.id = a.template_id
         LEFT JOIN auth_users au ON au.id = a.user_id
        WHERE a.ended_on IS NULL
        ORDER BY au.display_name NULLS LAST, au.email, a.type`
    );
    ok(res, r.rows);
  })
);

// Residui roster: one row per tenant member, INCLUDING members with no active
// quota (LEFT JOIN → type/template null, zero usage). Distinct from
// /assignments which returns only existing assignments (used for quota editing).
leaveQuotasRouter.get(
  '/residui',
  requireAdmin,
  tenantHandler(async (_req, res, client) => {
    const r = await client.query(
      `SELECT COALESCE(a.id::text, m.user_id::text) AS id,
              m.user_id,
              COALESCE(au.email, m.user_id::text) AS user_email,
              au.display_name AS user_display_name,
              a.type,
              t.name AS template_name,
              COALESCE(a.initial_balance, 0)::float8 AS initial_balance,
              COALESCE(
                (SELECT SUM(ac.hours)::float8 FROM leave_accruals ac
                  WHERE ac.assignment_id = a.id),
                0
              ) AS accrued_total,
              COALESCE(
                (SELECT SUM(lr.duration_hours)::float8
                   FROM leave_requests lr
                  WHERE lr.user_id = m.user_id
                    AND lr.type = a.type
                    AND lr.status = 'approved'),
                0
              ) AS used_approved,
              COALESCE(
                (SELECT SUM(lr.duration_hours)::float8
                   FROM leave_requests lr
                  WHERE lr.user_id = m.user_id
                    AND lr.type = a.type
                    AND lr.status IN ('pending','cancellation_pending')),
                0
              ) AS used_pending
         FROM memberships m
         LEFT JOIN auth_users au ON au.id = m.user_id
         LEFT JOIN leave_quota_assignments a
                ON a.user_id = m.user_id AND a.ended_on IS NULL
         LEFT JOIN leave_quota_templates t ON t.id = a.template_id
        ORDER BY au.display_name NULLS LAST, au.email, a.type NULLS FIRST`
    );
    ok(res, r.rows);
  })
);

leaveQuotasRouter.post(
  '/assignments',
  requireAdmin,
  tenantHandler(async (req, res, client) => {
    const parse = AssignBody.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const b = parse.data;
    const tpl = await client.query(
      `SELECT type FROM leave_quota_templates
        WHERE id = $1 AND deleted_at IS NULL`,
      [b.template_id]
    );
    if (tpl.rowCount === 0) throw new NotFoundError('template');
    const type = tpl.rows[0].type as 'ferie' | 'permessi';
    const initial = b.initial_balance ?? 0;
    const startedOn = b.started_on ?? (await tenantToday(client));

    // Close any existing active assignment for this (user, type) before opening a new one.
    await client.query(
      `UPDATE leave_quota_assignments
          SET ended_on = $2::date
        WHERE user_id = $1 AND type = $3 AND ended_on IS NULL`,
      [b.user_id, startedOn, type]
    );

    const r = await client.query(
      `INSERT INTO leave_quota_assignments(
         tenant_id, user_id, template_id, type, year,
         hours_total, hours_carried_in,
         initial_balance, started_on,
         created_by
       ) VALUES (
         current_setting('app.current_tenant_id')::uuid,
         $1, $2, $3, EXTRACT(YEAR FROM $5::date)::int,
         0, 0,
         $4, $5,
         current_setting('app.current_user_id')::uuid
       )
       RETURNING *`,
      [b.user_id, b.template_id, type, initial, startedOn]
    );
    await logAudit(client, {
      action: 'leave_quota.assign',
      resourceType: 'leave_quota_assignment',
      resourceId: r.rows[0].id,
      targetUserId: b.user_id,
      after: { template_id: b.template_id, type, initial_balance: initial, started_on: startedOn },
      req,
    });
    ok(res, r.rows[0], 201);
  })
);

const PatchAssignBody = z.object({
  initial_balance: z.number().optional(),
  template_id: z.string().uuid().optional(),
});

leaveQuotasRouter.patch(
  '/assignments/:id',
  requireAdmin,
  tenantHandler(async (req, res, client) => {
    const parse = PatchAssignBody.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const updates: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const [k, v] of Object.entries(parse.data)) {
      if (v === undefined) continue;
      updates.push(`${k} = $${i++}`);
      values.push(v);
    }
    if (updates.length === 0) throw new ValidationError('nothing to update');
    values.push(req.params.id);
    const r = await client.query(
      `UPDATE leave_quota_assignments SET ${updates.join(', ')}
        WHERE id = $${i} AND ended_on IS NULL RETURNING *`,
      values
    );
    if (r.rowCount === 0) throw new NotFoundError('assignment');
    await logAudit(client, {
      action: 'leave_quota.assignment_update',
      resourceType: 'leave_quota_assignment',
      resourceId: String(req.params.id),
      targetUserId: r.rows[0].user_id,
      after: parse.data,
      req,
    });
    ok(res, r.rows[0]);
  })
);

leaveQuotasRouter.delete(
  '/assignments/:id',
  requireAdmin,
  tenantHandler(async (req, res, client) => {
    // Soft-close instead of hard delete — preserve audit trail of accruals.
    const r = await client.query(
      `UPDATE leave_quota_assignments
          SET ended_on = CURRENT_DATE
        WHERE id = $1 AND ended_on IS NULL
        RETURNING *`,
      [req.params.id]
    );
    if (r.rowCount === 0) throw new NotFoundError('assignment');
    await logAudit(client, {
      action: 'leave_quota.assignment_delete',
      resourceType: 'leave_quota_assignment',
      resourceId: String(req.params.id),
      targetUserId: r.rows[0].user_id,
      before: { type: r.rows[0].type, template_id: r.rows[0].template_id },
      req,
    });
    ok(res, { closed: true });
  })
);

/* ---------------- Per-user balance summary ---------------- */

leaveQuotasRouter.get(
  '/users/:id/summary',
  tenantHandler(async (req, res, client) => {
    if (req.user!.role !== 'admin' && req.params.id !== req.user!.id) {
      throw new ConflictError('forbidden', 'FORBIDDEN');
    }
    const summary = await getQuotaSummary(client, String(req.params.id));
    ok(res, summary);
  })
);

leaveQuotasRouter.get(
  '/me/summary',
  tenantHandler(async (req, res, client) => {
    const summary = await getQuotaSummary(client, req.user!.id);
    ok(res, summary);
  })
);

/* ---------------- Accruals ledger ---------------- */

leaveQuotasRouter.get(
  '/assignments/:id/accruals',
  tenantHandler(async (req, res, client) => {
    const r = await client.query(
      `SELECT ac.id, ac.type,
              ac.hours::float8 AS hours,
              ac.accrued_on, ac.source, ac.note, ac.created_at,
              ac.created_by,
              cb.display_name AS created_by_display_name,
              cb.email AS created_by_email
         FROM leave_accruals ac
         LEFT JOIN auth_users cb ON cb.id = ac.created_by
        WHERE ac.assignment_id = $1
        ORDER BY ac.accrued_on DESC, ac.id DESC
        LIMIT 200`,
      [req.params.id]
    );
    ok(res, r.rows);
  })
);

// All accrual ledger rows for one user, across every assignment (both types).
// Powers the per-user audit log in the admin Quote tab — a single timeline of
// automatic accruals and manual add/remove operations, with the acting admin.
leaveQuotasRouter.get(
  '/users/:id/accruals',
  requireAdmin,
  tenantHandler(async (req, res, client) => {
    const r = await client.query(
      `SELECT ac.id, ac.type,
              ac.hours::float8 AS hours,
              ac.accrued_on, ac.source, ac.note, ac.created_at,
              ac.created_by,
              cb.display_name AS created_by_display_name,
              cb.email AS created_by_email
         FROM leave_accruals ac
         LEFT JOIN auth_users cb ON cb.id = ac.created_by
        WHERE ac.user_id = $1
        ORDER BY ac.accrued_on DESC, ac.id DESC
        LIMIT 500`,
      [req.params.id]
    );
    ok(res, r.rows);
  })
);

// Manual one-off accrual / adjustment (admin only).
const ManualAccrualBody = z.object({
  // Signed: positive credits hours (add), negative debits them (remove).
  hours: z.number().refine((h) => h !== 0, 'hours must be non-zero'),
  accrued_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  note: z.string().max(500).optional(),
  source: z.enum(['manual', 'adjustment']).default('manual'),
});

leaveQuotasRouter.post(
  '/assignments/:id/accruals',
  requireAdmin,
  tenantHandler(async (req, res, client) => {
    const parse = ManualAccrualBody.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const b = parse.data;
    const a = await client.query(
      `SELECT tenant_id, user_id, type FROM leave_quota_assignments
        WHERE id = $1 AND ended_on IS NULL`,
      [req.params.id]
    );
    if (a.rowCount === 0) throw new NotFoundError('assignment');
    const r = await client.query(
      `INSERT INTO leave_accruals(
         tenant_id, assignment_id, user_id, type,
         hours, accrued_on, source, note, created_by
       ) VALUES (
         $1, $2, $3, $4,
         $5, $6, $7, $8, current_setting('app.current_user_id')::uuid
       ) RETURNING id, hours::float8 AS hours, accrued_on, source, note, created_at`,
      [
        a.rows[0].tenant_id,
        req.params.id,
        a.rows[0].user_id,
        a.rows[0].type,
        b.hours,
        b.accrued_on ?? (await tenantToday(client)),
        b.source,
        b.note ?? null,
      ]
    );
    await logAudit(client, {
      action: 'leave_quota.accrual_add',
      resourceType: 'leave_quota_assignment',
      resourceId: String(req.params.id),
      targetUserId: a.rows[0].user_id,
      after: { amount: b.hours, note: b.note ?? null },
      req,
    });
    ok(res, r.rows[0], 201);
  })
);
