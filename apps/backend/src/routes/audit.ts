import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { tenantHandler } from '../lib/route-helpers.js';
import { ok } from '../lib/api-response.js';
import { ValidationError } from '../errors/index.js';

export const auditRouter = Router();
auditRouter.use(authenticate);
auditRouter.use(requireAdmin);

// Registro categories → audit_log action prefixes. Kept server-side so the
// web filter can stay a closed list (see locales/*/audit.json category.*).
const CATEGORIES: Record<string, string[]> = {
  users: ['user.'],
  stamps: ['stamp.', 'anomaly.'],
  corrections: ['correction.'],
  leaves: ['leave.'],
  quotas: ['leave_quota.'],
  shifts: ['shift_template.', 'shift_assignment.'],
  branches: ['branch.'],
  bacheca: ['bulletin.'],
  exports: ['export.'],
  documents: ['document.'],
  settings: ['tenant.'],
};

const ListQuery = z.object({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  actor: z.string().uuid().optional(),
  target: z.string().uuid().optional(),
  category: z.enum(Object.keys(CATEGORIES) as [string, ...string[]]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

auditRouter.get(
  '/',
  tenantHandler(async (req, res, client) => {
    const parse = ListQuery.safeParse(req.query);
    if (!parse.success) throw new ValidationError('invalid query', parse.error.flatten());
    const q = parse.data;

    const where: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    // Day boundaries are Europe/Rome wall-clock, converted on the parameter so
    // the created_at index stays usable.
    if (q.from) {
      where.push(`a.created_at >= ($${i++}::timestamp AT TIME ZONE 'Europe/Rome')`);
      values.push(`${q.from} 00:00:00`);
    }
    if (q.to) {
      where.push(`a.created_at < (($${i++}::date + 1)::timestamp AT TIME ZONE 'Europe/Rome')`);
      values.push(q.to);
    }
    if (q.actor) {
      where.push(`a.actor_user_id = $${i++}`);
      values.push(q.actor);
    }
    if (q.target) {
      where.push(`a.target_user_id = $${i++}`);
      values.push(q.target);
    }
    const prefixes = q.category ? (CATEGORIES[q.category] ?? []) : [];
    if (prefixes.length) {
      where.push(`(${prefixes.map(() => `a.action LIKE $${i++} || '%'`).join(' OR ')})`);
      values.push(...prefixes);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const r = await client.query(
      `SELECT a.id, a.action, a.resource_type, a.resource_id, a.created_at,
              a.actor_user_id,
              COALESCE(NULLIF(TRIM(CONCAT(act.first_name, ' ', act.last_name)), ''), act.display_name, act.email) AS actor_name,
              act.email AS actor_email,
              a.target_user_id,
              COALESCE(a.target_label,
                       NULLIF(TRIM(CONCAT(tgt.first_name, ' ', tgt.last_name)), ''),
                       tgt.display_name, tgt.email) AS target_label,
              a.before, a.after, a.ip,
              COUNT(*) OVER() AS total
       FROM audit_log a
       LEFT JOIN auth_users act ON act.id = a.actor_user_id
       LEFT JOIN auth_users tgt ON tgt.id = a.target_user_id
       ${whereSql}
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT $${i++} OFFSET $${i++}`,
      [...values, q.limit, q.offset]
    );

    const total = r.rowCount ? Number(r.rows[0].total) : q.offset > 0 ? null : 0;
    ok(res, {
      entries: r.rows.map(({ total: _t, ...row }) => row),
      total,
    });
  })
);
