import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { tenantHandler } from '../lib/route-helpers.js';
import { ok } from '../lib/api-response.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors/index.js';
import { getQuotaSummary } from '../lib/leave-quota.js';

export const leaveQuotasRouter = Router();
leaveQuotasRouter.use(authenticate);

const TypeEnum = z.enum(['ferie', 'permessi']);

/* ---------------- Templates ---------------- */

const TemplateBody = z.object({
  name: z.string().min(1).max(120),
  type: TypeEnum,
  hours_default: z.number().nonnegative(),
  active: z.boolean().optional(),
});

leaveQuotasRouter.get(
  '/templates',
  tenantHandler(async (_req, res, client) => {
    const r = await client.query(
      `SELECT id, name, type, hours_default::float8 AS hours_default, active, created_at
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
        `INSERT INTO leave_quota_templates(tenant_id, name, type, hours_default, active)
         VALUES (current_setting('app.current_tenant_id')::uuid, $1, $2, $3, $4)
         RETURNING *`,
        [b.name, b.type, b.hours_default, b.active ?? true]
      );
      ok(res, r.rows[0], 201);
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new ConflictError('Nome quota già esistente', 'CONFLICT');
      }
      throw err;
    }
  })
);

const PatchTemplate = TemplateBody.partial();

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
    ok(res, r.rows[0]);
  })
);

leaveQuotasRouter.delete(
  '/templates/:id',
  requireAdmin,
  tenantHandler(async (req, res, client) => {
    const inUse = await client.query(
      `SELECT COUNT(*) AS n FROM leave_quota_assignments WHERE template_id = $1`,
      [req.params.id]
    );
    if (Number(inUse.rows[0].n) > 0) {
      throw new ConflictError('Template usato in assegnazioni', 'IN_USE');
    }
    const r = await client.query(
      `UPDATE leave_quota_templates SET deleted_at = now()
        WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
      [req.params.id]
    );
    if (r.rowCount === 0) throw new NotFoundError('template');
    ok(res, { deleted: true });
  })
);

/* ---------------- Assignments ---------------- */

const AssignBody = z.object({
  user_id: z.string().uuid(),
  template_id: z.string().uuid(),
  year: z.number().int().min(2000).max(2100),
  hours_total: z.number().nonnegative().optional(),
  hours_carried_in: z.number().nonnegative().optional(),
});

leaveQuotasRouter.get(
  '/assignments',
  requireAdmin,
  tenantHandler(async (req, res, client) => {
    const year = req.query.year
      ? Number(req.query.year)
      : new Date().getFullYear();
    const r = await client.query(
      `SELECT a.id, a.user_id, a.type, a.year,
              a.hours_total::float8 AS hours_total,
              a.hours_carried_in::float8 AS hours_carried_in,
              a.template_id, t.name AS template_name,
              COALESCE(au.email, a.user_id::text) AS user_email,
              au.display_name AS user_display_name
         FROM leave_quota_assignments a
         JOIN leave_quota_templates t ON t.id = a.template_id
         LEFT JOIN auth_users au ON au.id = a.user_id
        WHERE a.year = $1
        ORDER BY au.display_name NULLS LAST, au.email, a.type`,
      [year]
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
      `SELECT type, hours_default FROM leave_quota_templates
        WHERE id = $1 AND deleted_at IS NULL`,
      [b.template_id]
    );
    if (tpl.rowCount === 0) throw new NotFoundError('template');
    const type = tpl.rows[0].type as 'ferie' | 'permessi';
    const hoursTotal = b.hours_total ?? Number(tpl.rows[0].hours_default);
    const carryIn = b.hours_carried_in ?? 0;

    const r = await client.query(
      `INSERT INTO leave_quota_assignments(
         tenant_id, user_id, template_id, type, year, hours_total, hours_carried_in,
         created_by
       ) VALUES (
         current_setting('app.current_tenant_id')::uuid,
         $1, $2, $3, $4, $5, $6,
         current_setting('app.current_user_id')::uuid
       )
       ON CONFLICT (tenant_id, user_id, type, year)
       DO UPDATE SET template_id = EXCLUDED.template_id,
                     hours_total = EXCLUDED.hours_total,
                     hours_carried_in = EXCLUDED.hours_carried_in
       RETURNING *`,
      [b.user_id, b.template_id, type, b.year, hoursTotal, carryIn]
    );
    ok(res, r.rows[0], 201);
  })
);

leaveQuotasRouter.delete(
  '/assignments/:id',
  requireAdmin,
  tenantHandler(async (req, res, client) => {
    const r = await client.query(
      `DELETE FROM leave_quota_assignments WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (r.rowCount === 0) throw new NotFoundError('assignment');
    ok(res, { deleted: true });
  })
);

/* ---------------- Per-user residual ---------------- */

leaveQuotasRouter.get(
  '/users/:id/summary',
  tenantHandler(async (req, res, client) => {
    if (req.user!.role !== 'admin' && req.params.id !== req.user!.id) {
      throw new ConflictError('forbidden', 'FORBIDDEN');
    }
    const year = req.query.year ? Number(req.query.year) : new Date().getFullYear();
    const summary = await getQuotaSummary(client, String(req.params.id), year);
    ok(res, summary);
  })
);

leaveQuotasRouter.get(
  '/me/summary',
  tenantHandler(async (req, res, client) => {
    const year = req.query.year ? Number(req.query.year) : new Date().getFullYear();
    const summary = await getQuotaSummary(client, req.user!.id, year);
    ok(res, summary);
  })
);
