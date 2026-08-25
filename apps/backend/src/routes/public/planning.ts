import { Router } from 'express';
import { z } from 'zod';
import { apiHandler } from '../../lib/route-helpers.js';
import { requireScope } from '../../middleware/api-key.js';
import { ok } from '../../lib/api-response.js';
import { logAudit } from '../../lib/audit.js';
import { NotFoundError } from '../../errors/index.js';
import { loadAnomalies } from '../shifts.js';
import { DateOnly, PageQuery, okList, parseBody, parseQuery, takeTotal, whereSql } from './helpers.js';

/**
 * Schedules and the deviations from them.
 *
 * `shifts` is the plan (which orario each employee is on, from when), and
 * `anomalies` is what the plan says about the punches that actually arrived:
 * missing clock-out, late arrival, short hours, a break outside its window.
 * The anomaly report is the single most-requested read of the whole API — it is
 * what a payroll clerk works through before closing a month — and it is served
 * from `loadAnomalies`, the same function the web app calls, rather than a
 * second copy of a query that has needed correcting three times (tenant-zone
 * day bucketing, split-shift windows, leave-covered slots).
 */
export const publicShiftsRouter = Router();

const TEMPLATE_COLUMNS = `id, name, description, tolerance_in_min, tolerance_out_min,
                          expected_break_min_min, expected_break_max_min,
                          expected_lunch_min_min, expected_lunch_max_min,
                          extraordinary_threshold_min, count_extraordinary, break_enabled,
                          flexible_enabled, active, created_at`;

publicShiftsRouter.get(
  '/templates',
  requireScope('shifts:read'),
  apiHandler(async (req, res, client) => {
    const q = parseQuery(PageQuery, req);
    const params: unknown[] = [q.limit, q.offset];
    const t = await client.query(
      `SELECT ${TEMPLATE_COLUMNS}, COUNT(*) OVER() AS total
         FROM shift_templates
        WHERE deleted_at IS NULL
        ORDER BY name, id
        LIMIT $1 OFFSET $2`,
      params
    );
    const { rows, total } = takeTotal(t.rows, q);
    const ids = rows.map((r) => (r as { id: string }).id);
    let slots: Record<string, unknown[]> = {};
    if (ids.length) {
      const s = await client.query(
        `SELECT shift_template_id, day_of_week,
                to_char(start_time, 'HH24:MI') AS start_time,
                to_char(end_time,   'HH24:MI') AS end_time
           FROM shift_template_slots
          WHERE shift_template_id = ANY($1::uuid[])
          ORDER BY day_of_week, start_time`,
        [ids]
      );
      slots = s.rows.reduce<Record<string, unknown[]>>((acc, row) => {
        (acc[row.shift_template_id] ??= []).push({
          day_of_week: row.day_of_week,
          start_time: row.start_time,
          end_time: row.end_time,
        });
        return acc;
      }, {});
    }
    okList(
      res,
      rows.map((r) => ({ ...r, slots: slots[(r as { id: string }).id] ?? [] })),
      q,
      total
    );
  })
);

/** Which orario each employee is on, and from when. `?on=YYYY-MM-DD` answers
 *  "what was the plan that day", which is the form a payroll question takes. */
publicShiftsRouter.get(
  '/assignments',
  requireScope('shifts:read'),
  apiHandler(async (req, res, client) => {
    const q = parseQuery(
      PageQuery.extend({ user_id: z.string().uuid().optional(), on: DateOnly.optional() }),
      req
    );
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.user_id) {
      params.push(q.user_id);
      where.push(`a.user_id = $${params.length}`);
    }
    if (q.on) {
      params.push(q.on);
      where.push(
        `a.valid_from <= $${params.length}::date AND (a.valid_to IS NULL OR a.valid_to >= $${params.length}::date)`
      );
    }
    params.push(q.limit, q.offset);
    const r = await client.query(
      `SELECT a.id, a.user_id, a.shift_template_id, st.name AS template_name,
              a.valid_from, a.valid_to,
              COALESCE(au.email, a.user_id::text) AS user_email,
              COUNT(*) OVER() AS total
         FROM user_shift_assignments a
         LEFT JOIN shift_templates st ON st.id = a.shift_template_id
         LEFT JOIN auth_users au ON au.id = a.user_id
        ${whereSql(where)}
        ORDER BY au.email NULLS LAST, a.valid_from DESC, a.id
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const { rows, total } = takeTotal(r.rows, q);
    okList(res, rows, q, total);
  })
);

/**
 * Put employees on an orario from a date.
 *
 * Assignments are open-ended and superseded rather than edited: the row that
 * was in force in March has to keep saying so, because March's anomalies were
 * computed against it. So this closes the previous assignment the day before
 * `valid_from` and opens a new one — the same thing the web app does.
 */
const AssignBody = z.object({
  user_ids: z.array(z.string().uuid()).min(1).max(500),
  shift_template_id: z.string().uuid().nullable(),
  valid_from: DateOnly,
});

publicShiftsRouter.post(
  '/assignments',
  requireScope('shifts:write'),
  apiHandler(async (req, res, client) => {
    const b = parseBody(AssignBody, req);
    if (b.shift_template_id) {
      const t = await client.query(
        `SELECT 1 FROM shift_templates WHERE id = $1 AND deleted_at IS NULL`,
        [b.shift_template_id]
      );
      if (t.rowCount === 0) throw new NotFoundError('shift template');
    }
    // Sorted so two concurrent bulk assignments cannot take the same rows in
    // opposite orders and deadlock — the same rule the leave bulk path follows.
    const userIds = Array.from(new Set(b.user_ids)).sort();
    const members = await client.query(
      `SELECT user_id FROM memberships
        WHERE user_id = ANY($1::uuid[]) AND deleted_at IS NULL`,
      [userIds]
    );
    const known = new Set(members.rows.map((r) => r.user_id as string));
    const unknown = userIds.filter((u) => !known.has(u));
    if (unknown.length) {
      throw new NotFoundError(`user not in company: ${unknown[0]}`);
    }

    for (const uid of userIds) {
      await client.query(
        `UPDATE user_shift_assignments
            SET valid_to = ($2::date - 1)
          WHERE user_id = $1
            AND (valid_to IS NULL OR valid_to >= $2::date)
            AND valid_from < $2::date`,
        [uid, b.valid_from]
      );
      // An assignment starting on the same day is replaced outright: two rows
      // in force on one day would make "which orario applied" unanswerable.
      await client.query(
        `DELETE FROM user_shift_assignments WHERE user_id = $1 AND valid_from = $2::date`,
        [uid, b.valid_from]
      );
      if (b.shift_template_id) {
        await client.query(
          `INSERT INTO user_shift_assignments (tenant_id, user_id, shift_template_id, valid_from)
           VALUES (current_setting('app.current_tenant_id')::uuid, $1, $2, $3::date)`,
          [uid, b.shift_template_id, b.valid_from]
        );
      }
      await logAudit(client, {
        action: b.shift_template_id ? 'shift_assignment.set' : 'shift_assignment.clear',
        resourceType: 'shift_assignment',
        targetUserId: uid,
        after: {
          shift_template_id: b.shift_template_id,
          valid_from: b.valid_from,
          via: 'api',
        },
        req,
      });
    }
    ok(
      res,
      { user_ids: userIds, shift_template_id: b.shift_template_id, valid_from: b.valid_from },
      201
    );
  })
);

// ── anomalies ──────────────────────────────────────────────────────────────

export const publicAnomaliesRouter = Router();

const AnomalyQuery = z.object({
  from: DateOnly,
  to: DateOnly,
  user_id: z.string().uuid().optional(),
  kind: z.string().max(40).optional(),
});

/**
 * Deviations between the schedule and the punches, for a date range.
 *
 * Computed, not stored: there is no anomalies table, so there is nothing to
 * page over — the range IS the bound. Deliberately no offset/limit for that
 * reason; a caller asks for a month at a time, as the web app does.
 */
publicAnomaliesRouter.get(
  '/',
  requireScope('anomalies:read'),
  apiHandler(async (req, res, client) => {
    const q = parseQuery(AnomalyQuery, req);
    const anomalies = await loadAnomalies(client, {
      from: q.from,
      to: q.to,
      user_id: q.user_id,
    });
    ok(res, q.kind ? anomalies.filter((a) => a.kind === q.kind) : anomalies);
  })
);

/**
 * Annotate an anomaly instead of hiding it.
 *
 * The deviation stays surfaced — a justified late arrival is still a late
 * arrival — with the explanation attached. Upsert per (employee, day, kind),
 * which is what makes a nightly job that re-posts the same justification
 * idempotent rather than duplicating it.
 */
const JustifyBody = z.object({
  user_id: z.string().uuid(),
  date: DateOnly,
  kind: z.enum([
    'missing_clock_in',
    'missing_clock_out',
    'late_clock_in',
    'early_clock_out',
    'short_hours',
    'worked_on_rest_day',
    'break_too_short',
    'break_too_long',
    'lunch_too_short',
    'lunch_too_long',
    'lunch_outside_window',
    'clock_out_out_of_area',
  ]),
  note: z.string().min(1).max(1000),
});

publicAnomaliesRouter.post(
  '/justify',
  requireScope('anomalies:write'),
  apiHandler(async (req, res, client) => {
    const b = parseBody(JustifyBody, req);
    // An anomaly belongs to an employee of THIS company. Without the check the
    // upsert happily creates an orphan justification for any uuid and answers
    // 201, so a sync pointing at the wrong id would look like it worked.
    const member = await client.query(
      `SELECT 1 FROM memberships
        WHERE tenant_id = current_setting('app.current_tenant_id')::uuid
          AND user_id = $1 AND deleted_at IS NULL`,
      [b.user_id]
    );
    if (member.rowCount === 0) throw new NotFoundError('user not in company');
    const ins = await client.query(
      `INSERT INTO anomaly_justifications (
         tenant_id, user_id, anomaly_date, anomaly_kind, note, created_by
       ) VALUES (
         current_setting('app.current_tenant_id')::uuid, $1, $2::date, $3, $4,
         current_setting('app.current_user_id')::uuid
       )
       ON CONFLICT (tenant_id, user_id, anomaly_date, anomaly_kind)
       DO UPDATE SET note = EXCLUDED.note,
                     created_by = EXCLUDED.created_by,
                     updated_at = now()
       RETURNING id, user_id, anomaly_date, anomaly_kind, note, updated_at`,
      [b.user_id, b.date, b.kind, b.note]
    );
    await logAudit(client, {
      action: 'anomaly.justify',
      resourceType: 'anomaly',
      resourceId: String(ins.rows[0].id),
      targetUserId: b.user_id,
      after: { date: b.date, kind: b.kind, note: b.note, via: 'api' },
      req,
    });
    ok(res, ins.rows[0], 201);
  })
);
