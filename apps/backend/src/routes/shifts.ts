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

const DayLunchSchema = z.object({
  day_of_week: z.number().int().min(1).max(7),
  lunch_min: z.number().int().min(0).max(480),
});

function hhmmToMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

// Feature B rule: a weekday with an auto-deduct lunch must have exactly one
// continuous fascia (the whole point is NOT to split the slot), and the lunch
// must be shorter than that fascia.
function validateDayLunch(
  slots: z.infer<typeof SlotSchema>[],
  dayLunch: z.infer<typeof DayLunchSchema>[]
): void {
  for (const dl of dayLunch) {
    if (dl.lunch_min <= 0) continue;
    const daySlots = slots.filter((s) => s.day_of_week === dl.day_of_week);
    if (daySlots.length !== 1) {
      throw new ValidationError(
        `Giorno ${dl.day_of_week}: la pausa pranzo automatica richiede un'unica fascia (niente turni spezzati)`
      );
    }
    const span = hhmmToMin(daySlots[0]!.end_time) - hhmmToMin(daySlots[0]!.start_time);
    if (dl.lunch_min >= span) {
      throw new ValidationError(
        `Giorno ${dl.day_of_week}: la pausa pranzo (${dl.lunch_min} min) deve essere inferiore alla durata della fascia (${span} min)`
      );
    }
  }
}

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
  expected_lunch_min_min: z.number().int().min(0).max(480).default(0),
  expected_lunch_max_min: z.number().int().min(0).max(480).default(90),
  extraordinary_threshold_min: z
    .union([z.literal(15), z.literal(30), z.literal(60)])
    .default(15),
  count_extraordinary: z.boolean().default(false),
  tolerance_in_breach_deduct_min: z.number().int().min(0).max(240).default(0),
  tolerance_out_breach_deduct_min: z.number().int().min(0).max(240).default(0),
  tolerance_break_breach_deduct_min: z.number().int().min(0).max(240).default(0),
  flexible_enabled: z.boolean().default(false),
  flex_in_before_min: z.number().int().min(0).max(240).default(0),
  flex_in_after_min: z.number().int().min(0).max(240).default(0),
  flex_out_before_min: z.number().int().min(0).max(240).default(0),
  flex_out_after_min: z.number().int().min(0).max(240).default(0),
  flex_lunch_before_min: z.number().int().min(0).max(240).default(0),
  flex_lunch_after_min: z.number().int().min(0).max(240).default(0),
  slots: z.array(SlotSchema).default([]),
  day_lunch: z.array(DayLunchSchema).default([]),
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

async function loadDayLunch(client: PoolClient, templateId: string) {
  const r = await client.query(
    `SELECT day_of_week, lunch_min
       FROM shift_template_day_lunch
      WHERE shift_template_id = $1
      ORDER BY day_of_week`,
    [templateId]
  );
  return r.rows;
}

async function replaceDayLunch(
  client: PoolClient,
  templateId: string,
  dayLunch: z.infer<typeof DayLunchSchema>[]
): Promise<void> {
  await client.query(`DELETE FROM shift_template_day_lunch WHERE shift_template_id = $1`, [
    templateId,
  ]);
  for (const dl of dayLunch) {
    if (dl.lunch_min <= 0) continue; // 0 = no auto-lunch; don't persist a noise row
    await client.query(
      `INSERT INTO shift_template_day_lunch(shift_template_id, tenant_id, day_of_week, lunch_min)
       VALUES ($1, current_setting('app.current_tenant_id')::uuid, $2, $3)`,
      [templateId, dl.day_of_week, dl.lunch_min]
    );
  }
}

// GET /api/v1/shifts/templates — list active templates with slots inlined.
shiftsRouter.get(
  '/templates',
  tenantHandler(async (_req, res, client) => {
    const t = await client.query(
      `SELECT id, name, description, tolerance_in_min, tolerance_out_min,
              expected_break_min_min, expected_break_max_min,
              expected_lunch_min_min, expected_lunch_max_min,
              extraordinary_threshold_min, count_extraordinary,
              tolerance_in_breach_deduct_min, tolerance_out_breach_deduct_min,
              tolerance_break_breach_deduct_min,
              flexible_enabled, flex_in_before_min, flex_in_after_min,
              flex_out_before_min, flex_out_after_min,
              flex_lunch_before_min, flex_lunch_after_min,
              active, created_at
         FROM shift_templates
        WHERE deleted_at IS NULL
        ORDER BY name`
    );
    const ids = t.rows.map((r) => r.id);
    let slotsByTemplate: Record<string, unknown[]> = {};
    let lunchByTemplate: Record<string, unknown[]> = {};
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
      const dl = await client.query(
        `SELECT shift_template_id, day_of_week, lunch_min
           FROM shift_template_day_lunch
          WHERE shift_template_id = ANY($1::uuid[])
          ORDER BY day_of_week`,
        [ids]
      );
      lunchByTemplate = dl.rows.reduce<Record<string, unknown[]>>((acc, row) => {
        (acc[row.shift_template_id] ??= []).push({
          day_of_week: row.day_of_week,
          lunch_min: row.lunch_min,
        });
        return acc;
      }, {});
    }
    ok(
      res,
      t.rows.map((r) => ({
        ...r,
        slots: slotsByTemplate[r.id] ?? [],
        day_lunch: lunchByTemplate[r.id] ?? [],
      }))
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
    const day_lunch = await loadDayLunch(client, String(req.params.id));
    ok(res, { ...r.rows[0], slots, day_lunch });
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
    if (b.expected_lunch_min_min > b.expected_lunch_max_min) {
      throw new ValidationError('expected_lunch_min_min deve essere ≤ expected_lunch_max_min');
    }
    validateSlots(b.slots);
    validateDayLunch(b.slots, b.day_lunch);
    let created;
    try {
      created = await client.query(
        `INSERT INTO shift_templates(tenant_id, name, description, tolerance_in_min, tolerance_out_min,
                                     expected_break_min_min, expected_break_max_min,
                                     expected_lunch_min_min, expected_lunch_max_min,
                                     extraordinary_threshold_min, count_extraordinary,
                                     tolerance_in_breach_deduct_min, tolerance_out_breach_deduct_min,
                                     tolerance_break_breach_deduct_min,
                                     flexible_enabled, flex_in_before_min, flex_in_after_min,
                                     flex_out_before_min, flex_out_after_min,
                                     flex_lunch_before_min, flex_lunch_after_min)
         VALUES (current_setting('app.current_tenant_id')::uuid, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                 $14, $15, $16, $17, $18, $19, $20)
         RETURNING *`,
        [
          b.name,
          b.description ?? null,
          b.tolerance_in_min,
          b.tolerance_out_min,
          b.expected_break_min_min,
          b.expected_break_max_min,
          b.expected_lunch_min_min,
          b.expected_lunch_max_min,
          b.extraordinary_threshold_min,
          b.count_extraordinary,
          b.tolerance_in_breach_deduct_min,
          b.tolerance_out_breach_deduct_min,
          b.tolerance_break_breach_deduct_min,
          b.flexible_enabled,
          b.flex_in_before_min,
          b.flex_in_after_min,
          b.flex_out_before_min,
          b.flex_out_after_min,
          b.flex_lunch_before_min,
          b.flex_lunch_after_min,
        ]
      );
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new ConflictError('Nome orario già esistente', 'CONFLICT');
      }
      throw err;
    }
    await replaceSlots(client, created.rows[0].id, b.slots);
    await replaceDayLunch(client, created.rows[0].id, b.day_lunch);
    await emitAudit(client, 'shift_template.create', created.rows[0].id, null, created.rows[0]);
    const slots = await loadSlots(client, created.rows[0].id);
    const day_lunch = await loadDayLunch(client, created.rows[0].id);
    ok(res, { ...created.rows[0], slots, day_lunch }, 201);
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
      if (v === undefined || k === 'slots' || k === 'day_lunch') continue;
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
    if (b.day_lunch !== undefined) {
      // Validate auto-lunch against the slots that will be in effect: the
      // patched set if provided, otherwise the ones already stored.
      const effectiveSlots = b.slots ?? (await loadSlots(client, String(req.params.id)));
      validateDayLunch(effectiveSlots, b.day_lunch);
      await replaceDayLunch(client, String(req.params.id), b.day_lunch);
    }
    const after = await client.query(`SELECT * FROM shift_templates WHERE id = $1`, [
      req.params.id,
    ]);
    const slots = await loadSlots(client, String(req.params.id));
    const day_lunch = await loadDayLunch(client, String(req.params.id));
    await emitAudit(client, 'shift_template.update', String(req.params.id), before.rows[0], after.rows[0]);
    ok(res, { ...after.rows[0], slots, day_lunch });
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
              st.expected_break_min_min, st.expected_break_max_min,
              st.expected_lunch_min_min, st.expected_lunch_max_min,
              st.extraordinary_threshold_min, st.count_extraordinary,
              st.tolerance_in_breach_deduct_min, st.tolerance_out_breach_deduct_min,
              st.tolerance_break_breach_deduct_min,
              st.flexible_enabled, st.flex_in_before_min, st.flex_in_after_min,
              st.flex_out_before_min, st.flex_out_after_min,
              st.flex_lunch_before_min, st.flex_lunch_after_min
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
    const day_lunch = await loadDayLunch(client, r.rows[0].shift_template_id);
    ok(res, { ...r.rows[0], slots, day_lunch });
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

    // Supersede any open assignment at valid_from. Rows that start on/after
    // valid_from are fully replaced — delete them, because closing at
    // valid_from-1 would leave an inverted (valid_to < valid_from) row that
    // later corrupts the per-day assignment resolution in /anomalies and the
    // payroll export. Rows that started earlier are closed the day before.
    await client.query(
      `DELETE FROM user_shift_assignments
        WHERE user_id = $1 AND valid_to IS NULL AND valid_from >= $2::date`,
      [user_id, valid_from]
    );
    await client.query(
      `UPDATE user_shift_assignments
          SET valid_to = ($2::date - INTERVAL '1 day')::date
        WHERE user_id = $1 AND valid_to IS NULL AND valid_from < $2::date`,
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

const BulkAssignBody = z.object({
  user_ids: z.array(z.string().uuid()).min(1),
  shift_template_id: z.string().uuid().nullable(),
  valid_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

// POST /api/v1/shifts/assignments/bulk — assign (or clear, with
// shift_template_id=null) the same template to many users at once. Per user it
// closes any open assignment at valid_from-1, then inserts the new row.
shiftsRouter.post(
  '/assignments/bulk',
  requireAdmin,
  tenantHandler(async (req, res, client) => {
    const parse = BulkAssignBody.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const { user_ids, shift_template_id, valid_from } = parse.data;

    const validUsers = await client.query(
      `SELECT user_id FROM memberships
        WHERE user_id = ANY($1::uuid[])
          AND tenant_id = current_setting('app.current_tenant_id')::uuid
          AND deleted_at IS NULL`,
      [user_ids]
    );
    if (validUsers.rowCount !== user_ids.length) {
      throw new ValidationError('one or more user_ids invalid');
    }

    if (shift_template_id) {
      const tpl = await client.query(
        `SELECT 1 FROM shift_templates WHERE id = $1 AND deleted_at IS NULL`,
        [shift_template_id]
      );
      if (tpl.rowCount === 0) throw new NotFoundError('shift_template');
    }

    // Same supersede-without-inverting rule as the single-user endpoint above.
    await client.query(
      `DELETE FROM user_shift_assignments
        WHERE user_id = ANY($1::uuid[]) AND valid_to IS NULL AND valid_from >= $2::date`,
      [user_ids, valid_from]
    );
    await client.query(
      `UPDATE user_shift_assignments
          SET valid_to = ($2::date - INTERVAL '1 day')::date
        WHERE user_id = ANY($1::uuid[]) AND valid_to IS NULL AND valid_from < $2::date`,
      [user_ids, valid_from]
    );

    if (shift_template_id === null) {
      for (const uid of user_ids) {
        await emitAudit(client, 'shift_assignment.clear', uid, null, { valid_from });
      }
      return ok(res, { cleared: true, user_ids });
    }

    await client.query(
      `INSERT INTO user_shift_assignments(tenant_id, user_id, shift_template_id, valid_from)
       SELECT current_setting('app.current_tenant_id')::uuid, u.id, $2, $3
         FROM UNNEST($1::uuid[]) AS u(id)`,
      [user_ids, shift_template_id, valid_from]
    );
    for (const uid of user_ids) {
      await emitAudit(client, 'shift_assignment.set', uid, null, { shift_template_id, valid_from });
    }
    ok(res, { user_ids, shift_template_id, valid_from }, 201);
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
              st.expected_lunch_min_min, st.expected_lunch_max_min,
              st.flexible_enabled, st.flex_in_before_min, st.flex_in_after_min,
              st.flex_out_before_min, st.flex_out_after_min,
              st.flex_lunch_before_min, st.flex_lunch_after_min,
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
                  'day_of_week', dl.day_of_week,
                  'lunch_min', dl.lunch_min
                ) ORDER BY dl.day_of_week)
                 FROM shift_template_day_lunch dl
                WHERE dl.shift_template_id = a.shift_template_id),
                '[]'::json
              ) AS day_lunch,
              COALESCE(
                (SELECT json_agg(json_build_object(
                  'event_type', s.event_type,
                  'occurred_at', s.occurred_at,
                  'out_of_geofence', s.out_of_geofence,
                  'geofence_distance_m', s.geofence_distance_m
                ) ORDER BY s.occurred_at)
                 FROM stamps s
                WHERE s.user_id = m.user_id
                  AND s.deleted_at IS NULL
                  AND s.occurred_at >= r.d::timestamptz
                  AND s.occurred_at <  (r.d + INTERVAL '1 day')::timestamptz),
                '[]'::json
              ) AS stamps,
              COALESCE(
                (SELECT json_agg(json_build_object(
                  'type', lr.type,
                  'from_ts', lr.from_ts,
                  'to_ts', lr.to_ts
                ))
                 FROM leave_requests lr
                WHERE lr.user_id = m.user_id
                  AND lr.status = 'approved'
                  AND lr.from_ts <  (r.d + INTERVAL '1 day')::timestamptz
                  AND lr.to_ts   >   r.d::timestamptz),
                '[]'::json
              ) AS leaves
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

    // Attach note-only justifications, keyed by (user, day, kind).
    const jq = await client.query(
      `SELECT user_id,
              to_char(anomaly_date, 'YYYY-MM-DD') AS anomaly_date,
              anomaly_kind, note, updated_at
         FROM anomaly_justifications
        WHERE anomaly_date >= $1::date AND anomaly_date <= $2::date
          ${user_id ? 'AND user_id = $3::uuid' : ''}`,
      user_id ? [from, to, user_id] : [from, to]
    );
    if (jq.rowCount && jq.rowCount > 0) {
      const byKey = new Map<string, { note: string; at: string }>();
      for (const j of jq.rows) {
        byKey.set(`${j.user_id}|${j.anomaly_date}|${j.anomaly_kind}`, {
          note: j.note,
          at: j.updated_at instanceof Date ? j.updated_at.toISOString() : String(j.updated_at),
        });
      }
      for (const a of anomalies) {
        const hit = byKey.get(`${a.user_id}|${a.date}|${a.kind}`);
        if (hit) {
          a.justification_note = hit.note;
          a.justified_at = hit.at;
        }
      }
    }
    ok(res, anomalies);
  })
);

// Note-only justification for an anomaly: the deviation stays surfaced but is
// annotated with the admin's explanation. Upsert per (user, day, kind).
const JustifyBody = z.object({
  user_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
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

shiftsRouter.post(
  '/anomalies/justify',
  requireAdmin,
  tenantHandler(async (req, res, client) => {
    const parse = JustifyBody.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const b = parse.data;
    const ins = await client.query(
      `INSERT INTO anomaly_justifications(
         tenant_id, user_id, anomaly_date, anomaly_kind, note, created_by
       ) VALUES (
         current_setting('app.current_tenant_id')::uuid, $1, $2::date, $3, $4,
         current_setting('app.current_user_id')::uuid
       )
       ON CONFLICT (tenant_id, user_id, anomaly_date, anomaly_kind)
       DO UPDATE SET note = EXCLUDED.note,
                     created_by = EXCLUDED.created_by,
                     updated_at = now()
       RETURNING *`,
      [b.user_id, b.date, b.kind, b.note]
    );
    ok(res, ins.rows[0], 201);
  })
);

export interface AnomalyRow {
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
  expected_lunch_min_min: number | null;
  expected_lunch_max_min: number | null;
  flexible_enabled: boolean | null;
  flex_in_before_min: number | null;
  flex_in_after_min: number | null;
  flex_out_before_min: number | null;
  flex_out_after_min: number | null;
  flex_lunch_before_min: number | null;
  flex_lunch_after_min: number | null;
  slots: { day_of_week: number; start_time: string; end_time: string }[];
  day_lunch: { day_of_week: number; lunch_min: number }[];
  stamps: {
    event_type: string;
    occurred_at: string;
    out_of_geofence?: boolean;
    geofence_distance_m?: number | null;
  }[];
  leaves: { type: 'ferie' | 'permessi' | 'malattia'; from_ts: string; to_ts: string }[];
}

export interface Anomaly {
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
    | 'short_hours'
    | 'worked_on_rest_day'
    | 'break_too_short'
    | 'break_too_long'
    | 'lunch_too_short'
    | 'lunch_too_long'
    | 'lunch_outside_window'
    | 'clock_out_out_of_area';
  expected_start_at: string | null;
  expected_end_at: string | null;
  actual_start_at: string | null;
  actual_end_at: string | null;
  delta_minutes: number | null;
  break_total_min: number | null;
  lunch_total_min: number | null;
  details: string | null;
  // Note-only justification attached by an admin (see anomaly_justifications).
  // Null when the anomaly has not been justified.
  justification_note: string | null;
  justified_at: string | null;
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

// Minutes of approved leave overlapping a [startMs, endMs] window. Lets the
// presence anomalies (missing/late/early) treat an approved ferie/permesso as
// covering the gap, so an admin who inserts the leave actually clears the
// anomaly (short_hours already accounts for leave via effectiveExpected).
function leaveOverlapMin(
  leaves: AnomalyRow['leaves'],
  startMs: number,
  endMs: number
): number {
  if (endMs <= startMs) return 0;
  let covered = 0;
  for (const lv of leaves ?? []) {
    const f = new Date(lv.from_ts).getTime();
    const t = new Date(lv.to_ts).getTime();
    const ov = Math.min(t, endMs) - Math.max(f, startMs);
    if (ov > 0) covered += Math.round(ov / 60000);
  }
  return covered;
}

export function computeAnomalies(rows: AnomalyRow[]): Anomaly[] {
  const out: Anomaly[] = [];
  for (const row of rows) {
    const date = row.day.slice(0, 10);

    // Out-of-area clock-out is a per-stamp anomaly that does NOT depend on an
    // assigned shift template — a leaver who closed an open shift from home
    // surfaces here even with no shift. Emitted before the template gate below.
    for (const s of row.stamps) {
      if (s.event_type === 'clock_out' && s.out_of_geofence) {
        const a = buildAnomaly(row, date, 'clock_out_out_of_area', null, null, row.stamps);
        a.actual_end_at = s.occurred_at;
        a.details =
          s.geofence_distance_m != null
            ? `Uscita timbrata fuori area (~${Math.round(s.geofence_distance_m)} m dalla sede)`
            : 'Uscita timbrata fuori area (posizione non verificata)';
        out.push(a);
      }
    }

    if (!row.shift_template_id) continue;
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

    // Orario flessibile: widen the entry/exit anchors by the flex windows before
    // late/early fires (tolerance still applies past the flexed anchor). When
    // flexible_enabled is false these are 0 → identical to fixed-schedule logic.
    const flex = row.flexible_enabled === true;
    const flexInAfterMs = flex ? (row.flex_in_after_min ?? 0) * 60000 : 0;
    const flexOutBeforeMs = flex ? (row.flex_out_before_min ?? 0) * 60000 : 0;
    // Feature B auto-lunch minutes for this weekday (0 = none).
    const autoLunchMin =
      (row.day_lunch ?? []).find((d) => d.day_of_week === dow)?.lunch_min ?? 0;

    const expStartMs = expectedStart.getTime();
    const expEndMs = expectedEnd.getTime();
    const fullExpectedMin = Math.max(0, Math.round((expEndMs - expStartMs) / 60000));
    // The whole scheduled window is covered by approved leave (e.g. a full-day
    // ferie inserted by the admin) → no clock-in/out is expected at all.
    const fullyCoveredByLeave =
      fullExpectedMin > 0 && leaveOverlapMin(row.leaves, expStartMs, expEndMs) + 1 >= fullExpectedMin;

    if (!firstIn) {
      if (!fullyCoveredByLeave) {
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
      }
    } else {
      const actual = new Date(firstIn.occurred_at);
      const deltaMin = Math.round((actual.getTime() - expectedStart.getTime()) / 60000);
      // Lateness is measured past the flexed entry anchor (expectedStart +
      // flex_in_after); flex 0 → past expectedStart, as before.
      const lateByMin = Math.round((actual.getTime() - (expStartMs + flexInAfterMs)) / 60000);
      // A permesso covering the late stretch [expectedStart, actualIn] justifies it.
      const lateCoveredMin = leaveOverlapMin(row.leaves, expStartMs, actual.getTime());
      if (lateByMin - lateCoveredMin > tolIn) {
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
      if (!fullyCoveredByLeave) {
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
      }
    } else {
      const actual = new Date(lastOut.occurred_at);
      const deltaMin = Math.round((expectedEnd.getTime() - actual.getTime()) / 60000);
      // Earliness is measured before the flexed exit anchor (expectedEnd −
      // flex_out_before); flex 0 → before expectedEnd, as before.
      const earlyByMin = Math.round(((expEndMs - flexOutBeforeMs) - actual.getTime()) / 60000);
      // A permesso covering the early stretch [actualOut, expectedEnd] justifies it.
      const earlyCoveredMin = leaveOverlapMin(row.leaves, actual.getTime(), expEndMs);
      if (earlyByMin - earlyCoveredMin > tolOut) {
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
    let lunchTotal = 0;
    let openLunch: number | null = null;
    let firstLunchStartMs: number | null = null;
    let lastLunchEndMs: number | null = null;
    for (const s of stamps) {
      if (s.event_type === 'break_start') {
        openBreak = new Date(s.occurred_at).getTime();
      } else if (s.event_type === 'break_end' && openBreak !== null) {
        breakTotal += Math.round((new Date(s.occurred_at).getTime() - openBreak) / 60000);
        openBreak = null;
      } else if (s.event_type === 'lunch_start') {
        openLunch = new Date(s.occurred_at).getTime();
        if (firstLunchStartMs === null) firstLunchStartMs = openLunch;
      } else if (s.event_type === 'lunch_end' && openLunch !== null) {
        lunchTotal += Math.round((new Date(s.occurred_at).getTime() - openLunch) / 60000);
        lastLunchEndMs = new Date(s.occurred_at).getTime();
        openLunch = null;
      }
    }

    if (firstIn && lastOut) {
      const expectedMin = slots.reduce((sum, sl) => {
        const start = combineDateTime(date, sl.start_time).getTime();
        const end = combineDateTime(date, sl.end_time).getTime();
        return sum + Math.max(0, Math.round((end - start) / 60000));
      }, 0);
      const dayStart = Date.UTC(
        Number(date.slice(0, 4)),
        Number(date.slice(5, 7)) - 1,
        Number(date.slice(8, 10))
      );
      const dayEnd = dayStart + 24 * 60 * 60 * 1000;
      const leaveCoveredMin = (row.leaves ?? []).reduce((sum, lv) => {
        const from = new Date(lv.from_ts).getTime();
        const to = new Date(lv.to_ts).getTime();
        const overlap = Math.min(to, dayEnd) - Math.max(from, dayStart);
        return sum + (overlap > 0 ? Math.round(overlap / 60000) : 0);
      }, 0);
      let workedMs = 0;
      let openIn: number | null = null;
      for (const s of stamps) {
        if (s.event_type === 'clock_in') {
          openIn = new Date(s.occurred_at).getTime();
        } else if (s.event_type === 'clock_out' && openIn !== null) {
          workedMs += new Date(s.occurred_at).getTime() - openIn;
          openIn = null;
        }
      }
      const workedMinRaw = Math.max(0, Math.round(workedMs / 60000) - breakTotal - lunchTotal);
      // Feature B auto-lunch: ignore stamped breaks/lunch; deduct the fixed
      // amount from presence (worked = gross − L) and lower the target by L too.
      const grossMin = workedMinRaw + breakTotal + lunchTotal;
      const workedMin = autoLunchMin > 0 ? Math.max(0, grossMin - autoLunchMin) : workedMinRaw;
      const targetMin = autoLunchMin > 0 ? Math.max(0, expectedMin - autoLunchMin) : expectedMin;
      const effectiveExpected = Math.max(0, targetMin - leaveCoveredMin);
      const shortfall = effectiveExpected - workedMin;
      if (shortfall > tolOut) {
        const a = buildAnomaly(
          row,
          date,
          'short_hours',
          expectedStart.toISOString(),
          expectedEnd.toISOString(),
          stamps
        );
        a.delta_minutes = shortfall;
        a.details =
          leaveCoveredMin > 0
            ? `Lavorate ${workedMin} min su ${effectiveExpected} attese (assenza copre ${leaveCoveredMin} min)`
            : `Lavorate ${workedMin} min su ${targetMin} attese`;
        out.push(a);
      }
    }

    const bMin = row.expected_break_min_min ?? 0;
    const bMax = row.expected_break_max_min ?? Number.POSITIVE_INFINITY;
    // Auto-lunch days don't track stamped break/lunch (the lunch is a flat
    // deduction), so duration anomalies don't apply.
    if (firstIn && lastOut && autoLunchMin === 0) {
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

    const lMin = row.expected_lunch_min_min ?? 0;
    const lMax = row.expected_lunch_max_min ?? Number.POSITIVE_INFINITY;
    if (firstIn && lastOut && autoLunchMin === 0) {
      if (lunchTotal < lMin) {
        const a = buildAnomaly(
          row,
          date,
          'lunch_too_short',
          expectedStart.toISOString(),
          expectedEnd.toISOString(),
          stamps
        );
        a.lunch_total_min = lunchTotal;
        a.details = `Pausa pranzo ${lunchTotal} min, minima ${lMin} min`;
        out.push(a);
      } else if (lunchTotal > lMax) {
        const a = buildAnomaly(
          row,
          date,
          'lunch_too_long',
          expectedStart.toISOString(),
          expectedEnd.toISOString(),
          stamps
        );
        a.lunch_total_min = lunchTotal;
        a.details = `Pausa pranzo ${lunchTotal} min, massima ${lMax} min`;
        out.push(a);
      }
    }

    // Flessibilità pausa pranzo (split shift): the stamped lunch must sit inside
    // the gap between two fasce widened by flex_lunch_before/after. The lunch
    // DURATION is still governed by expected_lunch_* above; this only checks
    // WHEN it was taken. Anchored on the largest inter-fascia gap.
    if (
      flex &&
      firstIn &&
      lastOut &&
      autoLunchMin === 0 &&
      ((row.flex_lunch_before_min ?? 0) > 0 || (row.flex_lunch_after_min ?? 0) > 0) &&
      slots.length >= 2 &&
      firstLunchStartMs !== null &&
      lastLunchEndMs !== null
    ) {
      let gapStart = '';
      let gapEnd = '';
      let bestGap = -1;
      for (let k = 0; k < slots.length - 1; k++) {
        const e = combineDateTime(date, slots[k]!.end_time).getTime();
        const s2 = combineDateTime(date, slots[k + 1]!.start_time).getTime();
        if (s2 - e > bestGap) {
          bestGap = s2 - e;
          gapStart = slots[k]!.end_time;
          gapEnd = slots[k + 1]!.start_time;
        }
      }
      if (gapStart && gapEnd) {
        const winStart =
          combineDateTime(date, gapStart).getTime() - (row.flex_lunch_before_min ?? 0) * 60000;
        const winEnd =
          combineDateTime(date, gapEnd).getTime() + (row.flex_lunch_after_min ?? 0) * 60000;
        if (firstLunchStartMs < winStart || lastLunchEndMs > winEnd) {
          const a = buildAnomaly(
            row,
            date,
            'lunch_outside_window',
            expectedStart.toISOString(),
            expectedEnd.toISOString(),
            stamps
          );
          a.lunch_total_min = lunchTotal;
          a.details =
            `Pausa pranzo ${hhmmUtc(firstLunchStartMs)}–${hhmmUtc(lastLunchEndMs)} fuori dalla finestra consentita ` +
            `${hhmmUtc(winStart)}–${hhmmUtc(winEnd)} (pausa prevista ${gapStart}–${gapEnd}, flessibilità ` +
            `${row.flex_lunch_before_min ?? 0}/${row.flex_lunch_after_min ?? 0} min)`;
          out.push(a);
        }
      }
    }
  }
  return out;
}

// Wall-clock HH:MM of an absolute timestamp, read in UTC to match
// combineDateTime (which builds expected times via Date.UTC).
function hhmmUtc(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
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
    lunch_total_min: null,
    details: null,
    justification_note: null,
    justified_at: null,
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
