import { Router } from 'express';
import { z } from 'zod';
import { apiHandler } from '../../lib/route-helpers.js';
import { requireScope } from '../../middleware/api-key.js';
import { ok } from '../../lib/api-response.js';
import { logAudit } from '../../lib/audit.js';
import { NotFoundError, ValidationError } from '../../errors/index.js';
import { processExportJobs } from '../../services/jobs/process-exports.js';
import { readExportFile } from '../../services/export-service.js';
import { env } from '../../env.js';
import { TENANT_TZ_SQL } from '../../lib/tz.js';
import {
  DateOnly,
  PageQuery,
  dayEndExclusiveSql,
  dayStartSql,
  okList,
  parseBody,
  parseQuery,
  takeTotal,
  uuidParam,
  whereSql,
} from './helpers.js';

/**
 * Exports, aggregate reports and the Registro attività — the three things a
 * BI tool, a payroll clerk and a compliance officer respectively ask for.
 */
export const publicExportsRouter = Router();

/**
 * Enqueue an export.
 *
 * Asynchronous by design and unchanged from the web app's contract: an xlsx for
 * a month of a whole company is not a request you hold a socket open for. The
 * caller POSTs, gets a job id, polls `GET /exports/{id}` until `status=ready`,
 * then downloads. Reusing `export_jobs` rather than a synchronous variant also
 * means an API-requested file appears in the Esportazioni list in the web app,
 * where the admin can see what their integration pulled and when.
 */
const EnqueueBody = z.object({
  format: z.enum(['xlsx', 'json', 'centro']),
  period_from: DateOnly,
  period_to: DateOnly,
  filters: z.record(z.string(), z.unknown()).default({}),
});

/** Centro Paghe files are one company / one calendar month — the filename
 *  carries the MMAAAA period, so a partial month would produce a file the
 *  payroll bureau silently mis-imports. Same guard as routes/exports.ts. */
function assertSingleCalendarMonth(from: string, to: string): void {
  const y = Number(from.slice(0, 4));
  const m = Number(from.slice(5, 7));
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const expectedTo = `${from.slice(0, 7)}-${String(lastDay).padStart(2, '0')}`;
  if (from.slice(8, 10) !== '01' || to !== expectedTo) {
    throw new ValidationError(
      'The Centro Paghe format requires a whole calendar month (first to last day).'
    );
  }
}

publicExportsRouter.post(
  '/',
  requireScope('exports:write'),
  apiHandler(async (req, res, client) => {
    const b = parseBody(EnqueueBody, req);
    if (b.period_to < b.period_from) throw new ValidationError('period_to before period_from');
    if (b.format === 'centro') assertSingleCalendarMonth(b.period_from, b.period_to);
    const r = await client.query(
      `INSERT INTO export_jobs (tenant_id, requested_by, format, period_from, period_to, filters)
       VALUES (current_setting('app.current_tenant_id')::uuid,
               current_setting('app.current_user_id')::uuid, $1, $2, $3, $4)
       RETURNING id, format, period_from, period_to, status, created_at`,
      [b.format, b.period_from, b.period_to, b.filters]
    );
    await logAudit(client, {
      action: 'export.create',
      resourceType: 'export_job',
      resourceId: r.rows[0].id,
      after: { format: b.format, period_from: b.period_from, period_to: b.period_to, via: 'api' },
      req,
    });
    // Without the scheduler (dev, and any deploy where it is off) nothing would
    // ever pick the job up, so nudge the worker. Fire-and-forget: the caller
    // polls either way.
    if (!env.SCHEDULER_ENABLED) processExportJobs().catch(() => {});
    ok(res, r.rows[0], 201);
  })
);

const JOB_COLUMNS = `id, format, period_from, period_to, status, error,
                     started_at, finished_at, created_at`;

publicExportsRouter.get(
  '/',
  requireScope('exports:read'),
  apiHandler(async (req, res, client) => {
    const q = parseQuery(
      PageQuery.extend({
        status: z.enum(['pending', 'running', 'ready', 'failed']).optional(),
      }),
      req
    );
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.status) {
      params.push(q.status);
      where.push(`status = $${params.length}`);
    }
    params.push(q.limit, q.offset);
    const r = await client.query(
      `SELECT ${JOB_COLUMNS}, COUNT(*) OVER() AS total
         FROM export_jobs ${whereSql(where)}
        ORDER BY created_at DESC, id
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const { rows, total } = takeTotal(r.rows, q);
    okList(res, rows, q, total);
  })
);

publicExportsRouter.get(
  '/:id',
  requireScope('exports:read'),
  apiHandler(async (req, res, client) => {
    const r = await client.query(`SELECT ${JOB_COLUMNS} FROM export_jobs WHERE id = $1`, [
      uuidParam(req, 'id'),
    ]);
    if (r.rowCount === 0) throw new NotFoundError('export job');
    ok(res, r.rows[0]);
  })
);

/**
 * The file itself. Raw bytes, no JSON envelope — the one endpoint on this API
 * that is not JSON, because the whole point is to hand a caller the artifact.
 */
publicExportsRouter.get(
  '/:id/download',
  requireScope('exports:read'),
  apiHandler(async (req, res, client) => {
    const j = await client.query(
      `SELECT id, format, status, r2_key FROM export_jobs WHERE id = $1`,
      [uuidParam(req, 'id')]
    );
    if (j.rowCount === 0) throw new NotFoundError('export job');
    const job = j.rows[0];
    if (job.status !== 'ready' || !job.r2_key) throw new NotFoundError('export not ready');
    const buf = await readExportFile(job.r2_key);
    await logAudit(client, {
      action: 'export.download',
      resourceType: 'export_job',
      resourceId: job.id,
      after: { format: job.format, via: 'api' },
      req,
    });
    const contentType =
      job.format === 'xlsx'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : job.format === 'centro'
          ? 'text/plain; charset=ISO-8859-1'
          : 'application/json';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="export-${job.id}"`);
    res.send(buf);
  })
);

// ── reports ────────────────────────────────────────────────────────────────

export const publicReportsRouter = Router();

/**
 * Daily worked minutes per employee, for a date range.
 *
 * The aggregate a BI tool wants and the one thing it should not compute itself
 * from raw punches: pairing clock_in/clock_out, subtracting breaks and lunch,
 * and deciding what an unclosed day means are exactly where two implementations
 * disagree and the customer's dashboard stops matching their payslips. The
 * authoritative version of that arithmetic lives in the export service; this is
 * its shape as data.
 *
 * NOT the payroll figure. Contracted hours, overtime rules, tolerance breach
 * deductions and flexible-schedule flooring are applied by the export
 * (`GET /exports`), and a caller that needs the number payroll uses should pull
 * the export rather than re-derive it from here.
 */
publicReportsRouter.get(
  '/worked-minutes',
  requireScope('reports:read'),
  apiHandler(async (req, res, client) => {
    const q = parseQuery(
      PageQuery.extend({
        from: DateOnly,
        to: DateOnly,
        user_id: z.string().uuid().optional(),
      }),
      req
    );
    if (q.to < q.from) throw new ValidationError('to before from');
    const params: unknown[] = [`${q.from} 00:00:00`, q.to];
    let userFilter = '';
    if (q.user_id) {
      params.push(q.user_id);
      userFilter = `AND s.user_id = $${params.length}`;
    }
    params.push(q.limit, q.offset);
    // Pairing is done in SQL with a window function: each punch's contribution
    // is the gap to the NEXT punch of the day, counted only while the employee
    // was on the clock and not on a break or at lunch.
    const r = await client.query(
      `WITH ordered AS (
         SELECT s.user_id,
                (s.occurred_at AT TIME ZONE ${TENANT_TZ_SQL})::date AS day,
                s.event_type,
                s.occurred_at,
                LEAD(s.occurred_at) OVER (
                  PARTITION BY s.user_id, (s.occurred_at AT TIME ZONE ${TENANT_TZ_SQL})::date
                  ORDER BY s.occurred_at
                ) AS next_at
           FROM stamps s
          WHERE s.deleted_at IS NULL
            AND s.occurred_at >= ${dayStartSql(1)}
            AND s.occurred_at <  ${dayEndExclusiveSql(2)}
            ${userFilter}
       ),
       spans AS (
         SELECT user_id, day,
                CASE WHEN event_type IN ('clock_in', 'break_end', 'lunch_end')
                       AND next_at IS NOT NULL
                     THEN EXTRACT(EPOCH FROM (next_at - occurred_at)) / 60
                     ELSE 0
                END AS minutes,
                event_type
           FROM ordered
       )
       SELECT user_id, day,
              ROUND(SUM(minutes))::int AS worked_minutes,
              COUNT(*) FILTER (WHERE event_type = 'clock_in')::int  AS clock_ins,
              COUNT(*) FILTER (WHERE event_type = 'clock_out')::int AS clock_outs,
              COUNT(*) OVER() AS total
         FROM spans
        GROUP BY user_id, day
        ORDER BY day DESC, user_id
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const { rows, total } = takeTotal(r.rows, q);
    okList(res, rows, q, total);
  })
);

/** Who is currently clocked in — the "presenti oggi" board, as data. */
publicReportsRouter.get(
  '/present',
  requireScope('reports:read'),
  apiHandler(async (_req, res, client) => {
    const r = await client.query(
      `WITH last_event AS (
         SELECT DISTINCT ON (s.user_id) s.user_id, s.event_type, s.occurred_at, s.branch_id
           FROM stamps s
          WHERE s.deleted_at IS NULL
            AND s.occurred_at >= ((now() AT TIME ZONE ${TENANT_TZ_SQL})::date::timestamp
                                   AT TIME ZONE ${TENANT_TZ_SQL})
          ORDER BY s.user_id, s.occurred_at DESC
       )
       SELECT m.user_id,
              COALESCE(au.email, m.user_id::text) AS user_email,
              au.display_name,
              le.event_type AS last_event,
              le.occurred_at AS last_event_at,
              le.branch_id,
              COALESCE(le.event_type IN ('clock_in', 'break_end', 'lunch_end'), FALSE) AS present
         FROM memberships m
         LEFT JOIN auth_users au ON au.id = m.user_id
         LEFT JOIN last_event le ON le.user_id = m.user_id
        WHERE m.deleted_at IS NULL AND m.active = TRUE
        ORDER BY present DESC, au.email NULLS LAST, m.user_id`
    );
    ok(res, r.rows);
  })
);

// ── audit ──────────────────────────────────────────────────────────────────

export const publicAuditRouter = Router();

/**
 * The tenant's Registro attività.
 *
 * Read-only by construction: a log an integration can write is not a log. It is
 * exposed because "ship our audit trail into the SIEM" is a real compliance ask,
 * and because an integration's OWN writes appear here — a customer debugging
 * what their gestionale did overnight reads it from this endpoint.
 */
publicAuditRouter.get(
  '/',
  requireScope('audit:read'),
  apiHandler(async (req, res, client) => {
    const q = parseQuery(
      PageQuery.extend({
        from: DateOnly.optional(),
        to: DateOnly.optional(),
        /** Exact action, e.g. `stamp.admin_update`. Free text on purpose: the
         *  action vocabulary grows, and a closed enum here would 400 on a value
         *  the log legitimately contains. */
        action: z.string().max(60).optional(),
        actor: z.string().uuid().optional(),
        target: z.string().uuid().optional(),
      }),
      req
    );
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.from) {
      params.push(`${q.from} 00:00:00`);
      where.push(`a.created_at >= ${dayStartSql(params.length)}`);
    }
    if (q.to) {
      params.push(q.to);
      where.push(`a.created_at < ${dayEndExclusiveSql(params.length)}`);
    }
    if (q.action) {
      params.push(q.action);
      where.push(`a.action = $${params.length}`);
    }
    if (q.actor) {
      params.push(q.actor);
      where.push(`a.actor_user_id = $${params.length}`);
    }
    if (q.target) {
      params.push(q.target);
      where.push(`a.target_user_id = $${params.length}`);
    }
    params.push(q.limit, q.offset);
    const r = await client.query(
      `SELECT a.id, a.action, a.resource_type, a.resource_id, a.created_at,
              a.actor_user_id,
              COALESCE(
                NULLIF(TRIM(CONCAT(act.first_name, ' ', act.last_name)), ''),
                act.display_name, act.email,
                CASE WHEN ak.id IS NOT NULL THEN 'API · ' || ak.name END
              ) AS actor_name,
              a.target_user_id, a.target_label, a.before, a.after, a.ip,
              COUNT(*) OVER() AS total
         FROM audit_log a
         LEFT JOIN auth_users act ON act.id = a.actor_user_id
         LEFT JOIN api_keys   ak  ON ak.id  = a.actor_user_id
        ${whereSql(where)}
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const { rows, total } = takeTotal(r.rows, q);
    okList(res, rows, q, total);
  })
);
