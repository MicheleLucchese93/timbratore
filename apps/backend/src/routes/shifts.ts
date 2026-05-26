import { Router } from 'express';
import { z } from 'zod';
import type { PoolClient } from 'pg';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { tenantHandler } from '../lib/route-helpers.js';
import { ok } from '../lib/api-response.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors/index.js';

export const shiftsRouter = Router();
shiftsRouter.use(authenticate);

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const SlotSchema = z.object({
  day_of_week: z.number().int().min(1).max(7),
  start_time: z.string().regex(HHMM, 'HH:MM'),
  end_time: z.string().regex(HHMM, 'HH:MM'),
});

function validateSlots(slots: z.infer<typeof SlotSchema>[]): void {
  for (const s of slots) {
    if (s.start_time >= s.end_time) {
      throw new ValidationError(`Slot ${s.day_of_week}: start_time deve essere < end_time`);
    }
  }
  const byDay = new Map<number, { start: string; end: string }[]>();
  for (const s of slots) {
    const arr = byDay.get(s.day_of_week) ?? [];
    for (const ex of arr) {
      if (s.start_time < ex.end && s.end_time > ex.start) {
        throw new ValidationError(
          `Slot sovrapposto nel giorno ${s.day_of_week}: ${s.start_time}-${s.end_time}`
        );
      }
    }
    arr.push({ start: s.start_time, end: s.end_time });
    byDay.set(s.day_of_week, arr);
  }
}

const TemplateBody = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).nullable().optional(),
  tolerance_in_min: z.number().int().min(0).max(240).default(10),
  tolerance_out_min: z.number().int().min(0).max(240).default(10),
  expected_break_min_min: z.number().int().min(0).max(480).default(0),
  expected_break_max_min: z.number().int().min(0).max(480).default(90),
  slots: z.array(SlotSchema).default([]),
});

const PatchTemplateBody = TemplateBody.partial();

async function loadSlots(client: PoolClient, templateId: string) {
  const r = await client.query(
    `SELECT id, shift_template_id, tenant_id, day_of_week,
            to_char(start_time, 'HH24:MI') AS start_time,
            to_char(end_time, 'HH24:MI') AS end_time
       FROM shift_template_slots
      WHERE shift_template_id = $1
      ORDER BY day_of_week, start_time`,
    [templateId]
  );
  return r.rows;
}

async function replaceSlots(
  client: PoolClient,
  templateId: string,
  slots: z.infer<typeof SlotSchema>[]
): Promise<void> {
  await client.query(`DELETE FROM shift_template_slots WHERE shift_template_id = $1`, [templateId]);
  for (const s of slots) {
    await client.query(
      `INSERT INTO shift_template_slots(shift_template_id, tenant_id, day_of_week, start_time, end_time)
       VALUES ($1, current_setting('app.current_tenant_id')::uuid, $2, $3, $4)`,
      [templateId, s.day_of_week, s.start_time, s.end_time]
    );
  }
}

// GET /api/v1/shifts/templates — list active templates with slots inlined.
shiftsRouter.get(
  '/templates',
  tenantHandler(async (_req, res, client) => {
    const t = await client.query(
      `SELECT id, name, description, tolerance_in_min, tolerance_out_min,
              expected_break_min_min, expected_break_max_min, active, created_at
         FROM shift_templates
        WHERE deleted_at IS NULL
        ORDER BY name`
    );
    const ids = t.rows.map((r) => r.id);
    let slotsByTemplate: Record<string, unknown[]> = {};
    if (ids.length > 0) {
      const s = await client.query(
        `SELECT id, shift_template_id, tenant_id, day_of_week,
                to_char(start_time, 'HH24:MI') AS start_time,
                to_char(end_time, 'HH24:MI') AS end_time
           FROM shift_template_slots
          WHERE shift_template_id = ANY($1::uuid[])
          ORDER BY day_of_week, start_time`,
        [ids]
      );
      slotsByTemplate = s.rows.reduce<Record<string, unknown[]>>((acc, row) => {
        (acc[row.shift_template_id] ??= []).push(row);
        return acc;
      }, {});
    }
    ok(
      res,
      t.rows.map((r) => ({ ...r, slots: slotsByTemplate[r.id] ?? [] }))
    );
  })
);

shiftsRouter.get(
  '/templates/:id',
  tenantHandler(async (req, res, client) => {
    const r = await client.query(
      `SELECT * FROM shift_templates WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );
    if (r.rowCount === 0) throw new NotFoundError('shift_template');
    const slots = await loadSlots(client, String(req.params.id));
    ok(res, { ...r.rows[0], slots });
  })
);

shiftsRouter.post(
  '/templates',
  requireAdmin,
  tenantHandler(async (req, res, client) => {
    const parse = TemplateBody.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const b = parse.data;
    if (b.expected_break_min_min > b.expected_break_max_min) {
      throw new ValidationError('expected_break_min_min deve essere ≤ expected_break_max_min');
    }
    validateSlots(b.slots);
    let created;
    try {
      created = await client.query(
        `INSERT INTO shift_templates(tenant_id, name, description, tolerance_in_min, tolerance_out_min,
                                     expected_break_min_min, expected_break_max_min)
         VALUES (current_setting('app.current_tenant_id')::uuid, $1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          b.name,
          b.description ?? null,
          b.tolerance_in_min,
          b.tolerance_out_min,
          b.expected_break_min_min,
          b.expected_break_max_min,
        ]
      );
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new ConflictError('Nome orario già esistente', 'CONFLICT');
      }
      throw err;
    }
    await replaceSlots(client, created.rows[0].id, b.slots);
    await emitAudit(client, 'shift_template.create', created.rows[0].id, null, created.rows[0]);
    const slots = await loadSlots(client, created.rows[0].id);
    ok(res, { ...created.rows[0], slots }, 201);
  })
);

shiftsRouter.patch(
  '/templates/:id',
  requireAdmin,
  tenantHandler(async (req, res, client) => {
    const parse = PatchTemplateBody.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const b = parse.data;
    const before = await client.query(
      `SELECT * FROM shift_templates WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );
    if (before.rowCount === 0) throw new NotFoundError('shift_template');
    const updates: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const [k, v] of Object.entries(b)) {
      if (v === undefined || k === 'slots') continue;
      updates.push(`${k} = $${i++}`);
      values.push(v);
    }
    if (updates.length > 0) {
      values.push(req.params.id);
      try {
        await client.query(
          `UPDATE shift_templates SET ${updates.join(', ')} WHERE id = $${i}`,
          values
        );
      } catch (err) {
        if ((err as { code?: string }).code === '23505') {
          throw new ConflictError('Nome orario già esistente', 'CONFLICT');
        }
        throw err;
      }
    }
    if (b.slots) {
      validateSlots(b.slots);
      await replaceSlots(client, String(req.params.id), b.slots);
    }
    const after = await client.query(`SELECT * FROM shift_templates WHERE id = $1`, [
      req.params.id,
    ]);
    const slots = await loadSlots(client, String(req.params.id));
    await emitAudit(client, 'shift_template.update', String(req.params.id), before.rows[0], after.rows[0]);
    ok(res, { ...after.rows[0], slots });
  })
);

shiftsRouter.delete(
  '/templates/:id',
  requireAdmin,
  tenantHandler(async (req, res, client) => {
    const inUse = await client.query(
      `SELECT COUNT(*) AS n FROM user_shift_assignments
        WHERE shift_template_id = $1 AND (valid_to IS NULL OR valid_to >= CURRENT_DATE)`,
      [req.params.id]
    );
    if (Number(inUse.rows[0].n) > 0) {
      throw new ConflictError('Orario assegnato a uno o più utenti attivi', 'IN_USE');
    }
    const r = await client.query(
      `UPDATE shift_templates SET deleted_at = now()
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING *`,
      [req.params.id]
    );
    if (r.rowCount === 0) throw new NotFoundError('shift_template');
    await emitAudit(client, 'shift_template.delete', String(req.params.id), r.rows[0], null);
    ok(res, { deleted: true });
  })
);

/* ----------------------- Assignments ----------------------- */

const AssignBody = z.object({
  user_id: z.string().uuid(),
  shift_template_id: z.string().uuid().nullable(),
  valid_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

// GET /api/v1/shifts/assignments — list active assignment per user
shiftsRouter.get(
  '/assignments',
  requireAdmin,
  tenantHandler(async (_req, res, client) => {
    const r = await client.query(
      `SELECT a.id, a.user_id, a.shift_template_id, a.valid_from, a.valid_to,
              a.created_at, st.name AS template_name
         FROM user_shift_assignments a
         LEFT JOIN shift_templates st ON st.id = a.shift_template_id
        WHERE a.valid_to IS NULL OR a.valid_to >= CURRENT_DATE
        ORDER BY a.valid_from DESC`
    );
    ok(res, r.rows);
  })
);

// GET /api/v1/shifts/assignments/me — current user's assignment (if any)
shiftsRouter.get(
  '/assignments/me',
  tenantHandler(async (req, res, client) => {
    const r = await client.query(
      `SELECT a.id, a.user_id, a.shift_template_id, a.valid_from, a.valid_to,
              st.name AS template_name,
              st.tolerance_in_min, st.tolerance_out_min,
              st.expected_break_min_min, st.expected_break_max_min
         FROM user_shift_assignments a
         JOIN shift_templates st ON st.id = a.shift_template_id
        WHERE a.user_id = $1
          AND a.valid_from <= CURRENT_DATE
          AND (a.valid_to IS NULL OR a.valid_to >= CURRENT_DATE)
        ORDER BY a.valid_from DESC
        LIMIT 1`,
      [req.user!.id]
    );
    if (r.rowCount === 0) return ok(res, null);
    const slots = await loadSlots(client, r.rows[0].shift_template_id);
    ok(res, { ...r.rows[0], slots });
  })
);

// POST /api/v1/shifts/assignments — assign or replace a user's template.
// Closes any open assignment at valid_from-1, then inserts the new row.
// Pass shift_template_id=null to "unassign" — just closes the open row.
shiftsRouter.post(
  '/assignments',
  requireAdmin,
  tenantHandler(async (req, res, client) => {
    const parse = AssignBody.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const { user_id, shift_template_id, valid_from } = parse.data;

    const member = await client.query(
      `SELECT 1 FROM memberships
        WHERE user_id = $1 AND deleted_at IS NULL`,
      [user_id]
    );
    if (member.rowCount === 0) throw new NotFoundError('user');

    if (shift_template_id) {
      const tpl = await client.query(
        `SELECT 1 FROM shift_templates WHERE id = $1 AND deleted_at IS NULL`,
        [shift_template_id]
      );
      if (tpl.rowCount === 0) throw new NotFoundError('shift_template');
    }

    await client.query(
      `UPDATE user_shift_assignments
          SET valid_to = ($2::date - INTERVAL '1 day')::date
        WHERE user_id = $1 AND valid_to IS NULL`,
      [user_id, valid_from]
    );

    if (shift_template_id === null) {
      await emitAudit(client, 'shift_assignment.clear', user_id, null, { valid_from });
      return ok(res, { cleared: true });
    }

    const ins = await client.query(
      `INSERT INTO user_shift_assignments(tenant_id, user_id, shift_template_id, valid_from)
       VALUES (current_setting('app.current_tenant_id')::uuid, $1, $2, $3)
       RETURNING *`,
      [user_id, shift_template_id, valid_from]
    );
    await emitAudit(client, 'shift_assignment.set', user_id, null, ins.rows[0]);
    ok(res, ins.rows[0], 201);
  })
);

/* ----------------------- Anomalies ----------------------- */

const AnomalyQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  user_id: z.string().uuid().optional(),
});

shiftsRouter.get(
  '/anomalies',
  requireAdmin,
  tenantHandler(async (req, res, client) => {
    const parse = AnomalyQuery.safeParse(req.query);
    if (!parse.success) throw new ValidationError('invalid query', parse.error.flatten());
    const { from, to, user_id } = parse.data;
    if (from > to) throw new ValidationError('from > to');

    // Pull all stamps in range with assigned template and tolerances.
    // Then iterate in JS to flag deviations — clearer than a megaquery and fast
    // enough for tenant volumes (≤20 employees × ~62 days × ~10 stamps/day).
    const r = await client.query(
      `WITH range AS (
         SELECT generate_series($1::date, $2::date, INTERVAL '1 day')::date AS d
       ),
       memb AS (
         SELECT m.user_id, COALESCE(au.email, m.user_id::text) AS email,
                au.display_name
           FROM memberships m
           LEFT JOIN auth_users au ON au.id = m.user_id
          WHERE m.deleted_at IS NULL AND m.active = TRUE
            ${user_id ? 'AND m.user_id = $3::uuid' : ''}
       )
       SELECT r.d AS day,
              m.user_id, m.email, m.display_name,
              a.shift_template_id, st.name AS template_name,
              st.tolerance_in_min, st.tolerance_out_min,
              st.expected_break_min_min, st.expected_break_max_min,
              COALESCE(
                (SELECT json_agg(json_build_object(
                  'day_of_week', sl.day_of_week,
                  'start_time', to_char(sl.start_time, 'HH24:MI'),
                  'end_time', to_char(sl.end_time, 'HH24:MI')
                ) ORDER BY sl.day_of_week, sl.start_time)
                 FROM shift_template_slots sl
                WHERE sl.shift_template_id = a.shift_template_id),
                '[]'::json
              ) AS slots,
              COALESCE(
                (SELECT json_agg(json_build_object(
                  'event_type', s.event_type,
                  'occurred_at', s.occurred_at
                ) ORDER BY s.occurred_at)
                 FROM stamps s
                WHERE s.user_id = m.user_id
                  AND s.deleted_at IS NULL
                  AND s.occurred_at >= r.d::timestamptz
                  AND s.occurred_at <  (r.d + INTERVAL '1 day')::timestamptz),
                '[]'::json
              ) AS stamps
         FROM range r
         CROSS JOIN memb m
         LEFT JOIN user_shift_assignments a
           ON a.user_id = m.user_id
          AND a.valid_from <= r.d
          AND (a.valid_to IS NULL OR a.valid_to >= r.d)
         LEFT JOIN shift_templates st ON st.id = a.shift_template_id
        ORDER BY r.d, m.email`,
      user_id ? [from, to, user_id] : [from, to]
    );

    const anomalies = computeAnomalies(r.rows);
    ok(res, anomalies);
  })
);

interface AnomalyRow {
  day: string;
  user_id: string;
  email: string;
  display_name: string | null;
  shift_template_id: string | null;
  template_name: string | null;
  tolerance_in_min: number | null;
  tolerance_out_min: number | null;
  expected_break_min_min: number | null;
  expected_break_max_min: number | null;
  slots: { day_of_week: number; start_time: string; end_time: string }[];
  stamps: { event_type: string; occurred_at: string }[];
}

interface Anomaly {
  date: string;
  user_id: string;
  user_email: string;
  user_display_name: string | null;
  shift_template_id: string | null;
  shift_template_name: string | null;
  kind:
    | 'missing_clock_in'
    | 'missing_clock_out'
    | 'late_clock_in'
    | 'early_clock_out'
    | 'worked_on_rest_day'
    | 'break_too_short'
    | 'break_too_long';
  expected_start_at: string | null;
  expected_end_at: string | null;
  actual_start_at: string | null;
  actual_end_at: string | null;
  delta_minutes: number | null;
  break_total_min: number | null;
  details: string | null;
}

function isoDow(d: Date): number {
  const dow = d.getUTCDay();
  return dow === 0 ? 7 : dow;
}

function combineDateTime(dateStr: string, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  const [y, mo, d] = dateStr.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, mo - 1, d, h, m, 0));
}

function computeAnomalies(rows: AnomalyRow[]): Anomaly[] {
  const out: Anomaly[] = [];
  for (const row of rows) {
    if (!row.shift_template_id) continue;
    const date = row.day.slice(0, 10);
    const dow = isoDow(new Date(date + 'T00:00:00Z'));
    const slots = row.slots.filter((s) => s.day_of_week === dow);
    const stamps = row.stamps;
    const hasAny =
      stamps.length > 0 ||
      (row.shift_template_id !== null && slots.length > 0);

    if (slots.length === 0) {
      const worked = stamps.some(
        (s) => s.event_type === 'clock_in' || s.event_type === 'clock_out'
      );
      if (worked) {
        out.push(buildAnomaly(row, date, 'worked_on_rest_day', null, null, stamps));
      }
      continue;
    }
    if (!hasAny) continue;

    const expectedStart = combineDateTime(date, slots[0]!.start_time);
    const expectedEnd = combineDateTime(date, slots[slots.length - 1]!.end_time);

    const firstIn = stamps.find((s) => s.event_type === 'clock_in');
    const lastOut = [...stamps].reverse().find((s) => s.event_type === 'clock_out');

    const tolIn = row.tolerance_in_min ?? 0;
    const tolOut = row.tolerance_out_min ?? 0;

    if (!firstIn) {
      out.push(
        buildAnomaly(
          row,
          date,
          'missing_clock_in',
          expectedStart.toISOString(),
          expectedEnd.toISOString(),
          stamps
        )
      );
    } else {
      const actual = new Date(firstIn.occurred_at);
      const deltaMin = Math.round((actual.getTime() - expectedStart.getTime()) / 60000);
      if (deltaMin > tolIn) {
        const a = buildAnomaly(
          row,
          date,
          'late_clock_in',
          expectedStart.toISOString(),
          expectedEnd.toISOString(),
          stamps
        );
        a.actual_start_at = actual.toISOString();
        a.delta_minutes = deltaMin;
        out.push(a);
      }
    }

    if (!lastOut) {
      out.push(
        buildAnomaly(
          row,
          date,
          'missing_clock_out',
          expectedStart.toISOString(),
          expectedEnd.toISOString(),
          stamps
        )
      );
    } else {
      const actual = new Date(lastOut.occurred_at);
      const deltaMin = Math.round((expectedEnd.getTime() - actual.getTime()) / 60000);
      if (deltaMin > tolOut) {
        const a = buildAnomaly(
          row,
          date,
          'early_clock_out',
          expectedStart.toISOString(),
          expectedEnd.toISOString(),
          stamps
        );
        a.actual_end_at = actual.toISOString();
        a.delta_minutes = deltaMin;
        out.push(a);
      }
    }

    let breakTotal = 0;
    let openBreak: number | null = null;
    for (const s of stamps) {
      if (s.event_type === 'break_start') {
        openBreak = new Date(s.occurred_at).getTime();
      } else if (s.event_type === 'break_end' && openBreak !== null) {
        breakTotal += Math.round((new Date(s.occurred_at).getTime() - openBreak) / 60000);
        openBreak = null;
      }
    }
    const bMin = row.expected_break_min_min ?? 0;
    const bMax = row.expected_break_max_min ?? Number.POSITIVE_INFINITY;
    if (firstIn && lastOut) {
      if (breakTotal < bMin) {
        const a = buildAnomaly(
          row,
          date,
          'break_too_short',
          expectedStart.toISOString(),
          expectedEnd.toISOString(),
          stamps
        );
        a.break_total_min = breakTotal;
        a.details = `Pausa ${breakTotal} min, minima ${bMin} min`;
        out.push(a);
      } else if (breakTotal > bMax) {
        const a = buildAnomaly(
          row,
          date,
          'break_too_long',
          expectedStart.toISOString(),
          expectedEnd.toISOString(),
          stamps
        );
        a.break_total_min = breakTotal;
        a.details = `Pausa ${breakTotal} min, massima ${bMax} min`;
        out.push(a);
      }
    }
  }
  return out;
}

function buildAnomaly(
  row: AnomalyRow,
  date: string,
  kind: Anomaly['kind'],
  expectedStart: string | null,
  expectedEnd: string | null,
  stamps: AnomalyRow['stamps']
): Anomaly {
  return {
    date,
    user_id: row.user_id,
    user_email: row.email,
    user_display_name: row.display_name,
    shift_template_id: row.shift_template_id,
    shift_template_name: row.template_name,
    kind,
    expected_start_at: expectedStart,
    expected_end_at: expectedEnd,
    actual_start_at:
      stamps.find((s) => s.event_type === 'clock_in')?.occurred_at ?? null,
    actual_end_at:
      [...stamps].reverse().find((s) => s.event_type === 'clock_out')?.occurred_at ?? null,
    delta_minutes: null,
    break_total_min: null,
    details: null,
  };
}

async function emitAudit(
  client: PoolClient,
  action: string,
  resourceId: string,
  before: unknown,
  after: unknown
): Promise<void> {
  await client.query(
    `INSERT INTO audit_log(tenant_id, actor_user_id, action, resource_type, resource_id, before, after)
     VALUES (current_setting('app.current_tenant_id')::uuid,
             current_setting('app.current_user_id')::uuid,
             $1, 'shift', $2, $3, $4)`,
    [action, resourceId, before, after]
  );
}
