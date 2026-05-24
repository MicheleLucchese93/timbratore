import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { tenantHandler } from '../lib/route-helpers.js';
import { ok } from '../lib/api-response.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors/index.js';

export const correctionRequestsRouter = Router();
correctionRequestsRouter.use(authenticate);

const CreateBody = z.object({
  original_stamp_id: z.string().uuid().nullable().optional(),
  claimed_event_type: z.enum(['clock_in', 'clock_out', 'break_start', 'break_end']),
  claimed_occurred_at: z.string().datetime({ offset: true }),
  claimed_branch_id: z.string().uuid().nullable().optional(),
  justification: z.string().min(5).max(1000),
});

correctionRequestsRouter.post(
  '/',
  tenantHandler(async (req, res, client) => {
    const parse = CreateBody.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const b = parse.data;
    const r = await client.query(
      `INSERT INTO correction_requests(
         tenant_id, user_id, original_stamp_id, claimed_event_type, claimed_occurred_at,
         claimed_branch_id, justification
       ) VALUES (current_setting('app.current_tenant_id')::uuid, current_setting('app.current_user_id')::uuid,
                 $1, $2, $3, $4, $5)
       RETURNING *`,
      [
        b.original_stamp_id ?? null,
        b.claimed_event_type,
        b.claimed_occurred_at,
        b.claimed_branch_id ?? null,
        b.justification,
      ]
    );
    await client.query(
      `INSERT INTO centrifugo_outbox(method, payload)
       VALUES ('publish', jsonb_build_object(
         'channel', 'tenant.' || $1::text || '.dashboard',
         'data', jsonb_build_object('type','correction_request', 'request', to_jsonb($2::jsonb))
       ))`,
      [req.user!.tenantId, JSON.stringify(r.rows[0])]
    );
    ok(res, r.rows[0], 201);
  })
);

correctionRequestsRouter.get(
  '/',
  tenantHandler(async (req, res, client) => {
    const status = req.query.status ? String(req.query.status) : null;
    let sql = `SELECT cr.*, COALESCE(au.email, cr.user_id::text) AS user_email
               FROM correction_requests cr
               LEFT JOIN auth_users au ON au.id = cr.user_id
               WHERE ($1::text IS NULL OR cr.status = $1)`;
    const params: unknown[] = [status];
    if (req.user!.role !== 'admin') {
      params.push(req.user!.id);
      sql += ` AND cr.user_id = $${params.length}`;
    }
    sql += ' ORDER BY cr.created_at DESC LIMIT 500';
    const r = await client.query(sql, params);
    ok(res, r.rows);
  })
);

const ApproveBody = z.object({
  override: z
    .object({
      claimed_event_type: z.enum(['clock_in', 'clock_out', 'break_start', 'break_end']).optional(),
      claimed_occurred_at: z.string().datetime({ offset: true }).optional(),
      claimed_branch_id: z.string().uuid().nullable().optional(),
    })
    .optional(),
  resolution_note: z.string().max(500).optional(),
});

correctionRequestsRouter.post(
  '/:id/approve',
  requireAdmin,
  tenantHandler(async (req, res, client) => {
    const parse = ApproveBody.safeParse(req.body ?? {});
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const cr = await client.query(
      `SELECT * FROM correction_requests WHERE id = $1`,
      [req.params.id]
    );
    if (cr.rowCount === 0) throw new NotFoundError('correction request');
    const row = cr.rows[0];
    if (row.status !== 'pending') throw new ConflictError('Already resolved', 'CONFLICT');

    await client.query(`SELECT set_config('app.change_reason', $1, true)`, [
      `correction_approved:${req.params.id}`,
    ]);

    const eventType = parse.data.override?.claimed_event_type ?? row.claimed_event_type;
    const occurredAt = parse.data.override?.claimed_occurred_at ?? row.claimed_occurred_at;
    const branchId = parse.data.override?.claimed_branch_id ?? row.claimed_branch_id;

    let stamp;
    if (row.original_stamp_id) {
      const upd = await client.query(
        `UPDATE stamps SET event_type = $1, occurred_at = $2, branch_id = $3, source = 'employee_correction'
         WHERE id = $4 RETURNING *`,
        [eventType, occurredAt, branchId, row.original_stamp_id]
      );
      stamp = upd.rows[0];
    } else {
      const ins = await client.query(
        `INSERT INTO stamps(tenant_id, user_id, event_type, occurred_at, source, branch_id, notes)
         VALUES (current_setting('app.current_tenant_id')::uuid, $1, $2, $3, 'employee_correction', $4, $5)
         RETURNING *`,
        [row.user_id, eventType, occurredAt, branchId, row.justification.slice(0, 500)]
      );
      stamp = ins.rows[0];
    }
    await client.query(
      `UPDATE correction_requests SET status = 'approved', resolved_by = current_setting('app.current_user_id')::uuid,
                                     resolved_at = now(), resolution_note = $1
       WHERE id = $2`,
      [parse.data.resolution_note ?? null, req.params.id]
    );
    ok(res, { stamp });
  })
);

correctionRequestsRouter.post(
  '/:id/reject',
  requireAdmin,
  tenantHandler(async (req, res, client) => {
    const note = z.object({ resolution_note: z.string().max(500).optional() }).safeParse(req.body ?? {});
    if (!note.success) throw new ValidationError('invalid body', note.error.flatten());
    const r = await client.query(
      `UPDATE correction_requests
       SET status = 'rejected', resolved_by = current_setting('app.current_user_id')::uuid,
           resolved_at = now(), resolution_note = $1
       WHERE id = $2 AND status = 'pending'
       RETURNING *`,
      [note.data.resolution_note ?? null, req.params.id]
    );
    if (r.rowCount === 0) throw new NotFoundError('correction request');
    ok(res, r.rows[0]);
  })
);
