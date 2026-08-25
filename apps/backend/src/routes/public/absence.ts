import { Router } from 'express';
import { z } from 'zod';
import { apiHandler } from '../../lib/route-helpers.js';
import { requireScope } from '../../middleware/api-key.js';
import { ok } from '../../lib/api-response.js';
import { NotFoundError } from '../../errors/index.js';
import { getQuotaSummary } from '../../lib/leave-quota.js';
import {
  DateOnly,
  PageQuery,
  dayEndExclusiveSql,
  dayStartSql,
  okList,
  parseQuery,
  takeTotal,
  uuidParam,
  whereSql,
} from './helpers.js';

/**
 * Absences and their budgets: leave requests, and the residual balances a
 * payroll run needs beside them.
 *
 * READ-ONLY, and that is a product decision rather than an omission.
 *
 * Booking or approving an absence is not a data transfer, it is a decision with
 * consequences: `POST /leaves` runs the per-day capacity cap, the same-type
 * overlap guard, the quota ledger and an advisory lock ordering that exists
 * because getting it wrong once already double-booked a company's ferie
 * (Aug 2026). Approving one puts a named person's authority on somebody's
 * holiday, and `leave_requests.decided_by` is meant to identify that person —
 * a key would have to write itself there.
 *
 * So an integration can read every absence, reconcile it against payroll, and
 * see who has what left; the act of granting one stays in the app, where the
 * approver has a name and the guards are one implementation. If a customer
 * needs machine-booked absence (INPS certificates arriving as malattia is the
 * real case), that is a deliberate next step with its own guard review, not a
 * `:write` scope quietly added here.
 */
export const publicLeavesRouter = Router();

const LEAVE_COLUMNS = `lr.id, lr.user_id, lr.type, lr.assenza_subtype, lr.status,
                       lr.from_ts, lr.to_ts, lr.duration_hours, lr.is_paid,
                       lr.title, lr.user_note, lr.inps_protocol,
                       lr.decided_by, lr.decided_at, lr.rejection_reason,
                       lr.cancellation_reason, lr.created_by_admin, lr.created_at,
                       COALESCE(au.email, lr.user_id::text) AS user_email,
                       au.display_name AS user_display_name`;

const ListQuery = PageQuery.extend({
  user_id: z.string().uuid().optional(),
  // Every state the column actually holds. A shorter list would 400 on a value
  // the list itself returns, which is the most confusing kind of validation.
  status: z
    .enum([
      'pending',
      'approved',
      'rejected',
      'cancelled',
      'cancellation_pending',
      'cancellation_rejected',
      'superseded',
    ])
    .optional(),
  type: z.enum(['ferie', 'permessi', 'malattia', 'assenza', 'chiusura']).optional(),
  /** Overlap window, not a creation window: "which absences touch March" is the
   *  question a payroll run asks, and a request filed in February for March
   *  must be in the answer. */
  from: DateOnly.optional(),
  to: DateOnly.optional(),
});

publicLeavesRouter.get(
  '/',
  requireScope('leaves:read'),
  apiHandler(async (req, res, client) => {
    const q = parseQuery(ListQuery, req);
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.user_id) {
      params.push(q.user_id);
      where.push(`lr.user_id = $${params.length}`);
    }
    if (q.status) {
      params.push(q.status);
      where.push(`lr.status = $${params.length}`);
    }
    if (q.type) {
      params.push(q.type);
      where.push(`lr.type = $${params.length}`);
    }
    if (q.from) {
      params.push(`${q.from} 00:00:00`);
      // Strictly greater: a leave that ENDS at the window's opening midnight
      // does not overlap the window — `to_ts` is exclusive, so `>=` pulled in
      // the previous day's absence on every month boundary.
      where.push(`lr.to_ts > ${dayStartSql(params.length)}`);
    }
    if (q.to) {
      params.push(q.to);
      where.push(`lr.from_ts < ${dayEndExclusiveSql(params.length)}`);
    }
    params.push(q.limit, q.offset);
    const r = await client.query(
      `SELECT ${LEAVE_COLUMNS}, COUNT(*) OVER() AS total
         FROM leave_requests lr
         LEFT JOIN auth_users au ON au.id = lr.user_id
        ${whereSql(where)}
        ORDER BY lr.from_ts DESC, lr.id
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const { rows, total } = takeTotal(r.rows, q);
    okList(res, rows, q, total);
  })
);

publicLeavesRouter.get(
  '/:id',
  requireScope('leaves:read'),
  apiHandler(async (req, res, client) => {
    const r = await client.query(
      `SELECT ${LEAVE_COLUMNS}
         FROM leave_requests lr
         LEFT JOIN auth_users au ON au.id = lr.user_id
        WHERE lr.id = $1`,
      [uuidParam(req, 'id')]
    );
    if (r.rowCount === 0) throw new NotFoundError('leave request');
    ok(res, r.rows[0]);
  })
);

// ── quotas ─────────────────────────────────────────────────────────────────

export const publicQuotasRouter = Router();

/**
 * The balances behind those absences: for each employee and leave type, what
 * they were granted, what they have used and what is left.
 *
 * Read-only for the same reason as above — an accrual is a ledger entry and the
 * ledger is what the residual view is computed from.
 */
/**
 * Raw quota assignments — one row per (employee, leave type) budget, cheap and
 * pageable. The computed residual (accrued − used − pending) is per employee
 * and needs the accrual ledger, so it lives on /quotas/{user_id}: doing it for
 * a whole page would be one query per row.
 */
publicQuotasRouter.get(
  '/',
  requireScope('quotas:read'),
  apiHandler(async (req, res, client) => {
    const q = parseQuery(
      PageQuery.extend({
        user_id: z.string().uuid().optional(),
        type: z.enum(['ferie', 'permessi']).optional(),
        /** Historical budgets have an end date; default to the live ones. */
        include_ended: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
      }),
      req
    );
    const where: string[] = [];
    const params: unknown[] = [];
    if (!q.include_ended) where.push('a.ended_on IS NULL');
    if (q.user_id) {
      params.push(q.user_id);
      where.push(`a.user_id = $${params.length}`);
    }
    if (q.type) {
      params.push(q.type);
      where.push(`a.type = $${params.length}`);
    }
    params.push(q.limit, q.offset);
    const r = await client.query(
      `SELECT a.id, a.user_id, a.type, a.template_id, t.name AS template_name,
              a.initial_balance::float8 AS initial_balance,
              a.started_on, a.ended_on, a.last_accrual_on, a.created_at,
              COALESCE(au.email, a.user_id::text) AS user_email,
              COUNT(*) OVER() AS total
         FROM leave_quota_assignments a
         LEFT JOIN leave_quota_templates t ON t.id = a.template_id
         LEFT JOIN auth_users au ON au.id = a.user_id
        ${whereSql(where)}
        ORDER BY au.email NULLS LAST, a.type, a.id
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const { rows, total } = takeTotal(r.rows, q);
    okList(res, rows, q, total);
  })
);

/** The residual balance per leave type for one employee — the number a payroll
 *  run or a self-service portal actually wants. Reuses getQuotaSummary so there
 *  is one definition of "how much is left". */
publicQuotasRouter.get(
  '/:userId',
  requireScope('quotas:read'),
  apiHandler(async (req, res, client) => {
    const userId = uuidParam(req, 'userId');
    const member = await client.query(
      `SELECT 1 FROM memberships WHERE user_id = $1 AND deleted_at IS NULL`,
      [userId]
    );
    if (member.rowCount === 0) throw new NotFoundError('user');
    ok(res, { user_id: userId, quotas: await getQuotaSummary(client, userId) });
  })
);

/** The accrual ledger behind those balances: every automatic accrual and every
 *  manual adjustment, with the reason. This is what a customer reconciles
 *  against when a residual does not match their own model. */
publicQuotasRouter.get(
  '/:userId/accruals',
  requireScope('quotas:read'),
  apiHandler(async (req, res, client) => {
    const q = parseQuery(PageQuery, req);
    const params: unknown[] = [uuidParam(req, 'userId'), q.limit, q.offset];
    const r = await client.query(
      `SELECT ac.id, ac.assignment_id, ac.type, ac.hours::float8 AS hours,
              ac.accrued_on, ac.source, ac.note, ac.created_at,
              COUNT(*) OVER() AS total
         FROM leave_accruals ac
        WHERE ac.user_id = $1
        ORDER BY ac.accrued_on DESC, ac.id DESC
        LIMIT $2 OFFSET $3`,
      params
    );
    const { rows, total } = takeTotal(r.rows, q);
    okList(res, rows, q, total);
  })
);
