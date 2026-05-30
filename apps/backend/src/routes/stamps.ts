import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { tenantHandler } from '../lib/route-helpers.js';
import { ok } from '../lib/api-response.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors/index.js';
import { idempotencyMiddleware } from '../middleware/idempotency.js';
import { computeCurrentState, evaluateStamp } from '../services/stamp-service.js';
import type { StampEventType } from '@sonoqui/shared';

export const stampsRouter = Router();
stampsRouter.use(authenticate);

const StampBody = z.object({
  event_type: z.enum(['clock_in', 'clock_out', 'break_start', 'break_end', 'lunch_start', 'lunch_end']),
  occurred_at: z.string().datetime({ offset: true }),
  latitude: z.number().gte(-90).lte(90).optional(),
  longitude: z.number().gte(-180).lte(180).optional(),
  gps_accuracy_m: z.number().nonnegative().optional(),
  device_platform: z.string().max(40).optional(),
  device_app_version: z.string().max(40).optional(),
  branch_id: z.string().uuid().optional(),
  notes: z.string().max(500).optional(),
  is_mock_location: z.boolean().optional(),
});

stampsRouter.post(
  '/',
  idempotencyMiddleware('stamp_create'),
  tenantHandler(async (req, res, client) => {
    const parse = StampBody.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const body = parse.data;
    const evaluated = await evaluateStamp(client, {
      userId: req.user!.id,
      tenantId: req.user!.tenantId,
      body,
      source: 'employee_app',
      now: new Date(),
    });
    await client.query(
      `SELECT set_config('app.change_reason', 'employee_stamp', true)`
    );
    const ins = await client.query(
      `INSERT INTO stamps(
         tenant_id, user_id, event_type, occurred_at, source, branch_id,
         latitude, longitude, gps_accuracy_m, device_platform, device_app_version,
         suspicious_mock_location, notes, queued_hours
       )
       VALUES ($1, $2, $3, $4, 'employee_app', $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [
        req.user!.tenantId,
        req.user!.id,
        body.event_type,
        body.occurred_at,
        evaluated.branchId,
        body.latitude ?? null,
        body.longitude ?? null,
        body.gps_accuracy_m ?? null,
        body.device_platform ?? null,
        body.device_app_version ?? null,
        evaluated.suspiciousMockLocation,
        body.notes ?? null,
        req.header('x-queued-hours') ? Number(req.header('x-queued-hours')) : null,
      ]
    );
    await client.query(
      `INSERT INTO centrifugo_outbox(method, payload)
       VALUES ('publish', jsonb_build_object(
         'channel', 'tenant.' || $1::text || '.dashboard',
         'data', jsonb_build_object('type','stamp', 'stamp', to_jsonb($2::jsonb))
       ))`,
      [req.user!.tenantId, JSON.stringify(ins.rows[0])]
    );
    ok(res, ins.rows[0], 201);
  })
);

stampsRouter.get(
  '/me',
  tenantHandler(async (req, res, client) => {
    const from = req.query.from ? String(req.query.from) : null;
    const to = req.query.to ? String(req.query.to) : null;
    const r = await client.query(
      `SELECT * FROM stamps
       WHERE user_id = $1 AND deleted_at IS NULL
         AND ($2::date IS NULL OR occurred_at >= $2::date)
         AND ($3::date IS NULL OR occurred_at < ($3::date + interval '1 day'))
       ORDER BY occurred_at DESC
       LIMIT 1000`,
      [req.user!.id, from, to]
    );
    ok(res, r.rows);
  })
);

stampsRouter.get(
  '/me/current-state',
  tenantHandler(async (req, res, client) => {
    const state = await computeCurrentState(client, req.user!.id);
    ok(res, state);
  })
);

stampsRouter.get(
  '/',
  tenantHandler(async (req, res, client) => {
    if (req.user!.role !== 'admin') {
      throw new ForbiddenError();
    }
    const filters: string[] = [`(deleted_at IS NULL OR $1::boolean)`];
    const includeDeleted = req.query.include_deleted === 'true';
    const params: unknown[] = [includeDeleted];
    if (req.query.user_id) {
      params.push(String(req.query.user_id));
      filters.push(`user_id = $${params.length}`);
    }
    if (req.query.branch_id) {
      params.push(String(req.query.branch_id));
      filters.push(`branch_id = $${params.length}`);
    }
    if (req.query.from) {
      params.push(String(req.query.from));
      filters.push(`occurred_at >= $${params.length}::date`);
    }
    if (req.query.to) {
      params.push(String(req.query.to));
      filters.push(`occurred_at < ($${params.length}::date + interval '1 day')`);
    }
    const limit = Math.min(Number(req.query.limit ?? 200), 1000);
    const r = await client.query(
      `SELECT s.*, COALESCE(au.email, s.user_id::text) AS user_email
       FROM stamps s
       LEFT JOIN auth_users au ON au.id = s.user_id
       WHERE ${filters.join(' AND ')}
       ORDER BY occurred_at DESC
       LIMIT ${limit}`,
      params
    );
    ok(res, r.rows);
  })
);

stampsRouter.get(
  '/:id/history',
  tenantHandler(async (req, res, client) => {
    if (req.user!.role !== 'admin') throw new ForbiddenError();
    const r = await client.query(
      `SELECT * FROM stamps_history WHERE stamp_id = $1 ORDER BY recorded_at`,
      [req.params.id]
    );
    ok(res, r.rows);
  })
);

stampsRouter.delete(
  '/:id',
  tenantHandler(async (req, res, client) => {
    const s = await client.query(
      `SELECT * FROM stamps WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );
    if (s.rowCount === 0) throw new NotFoundError('stamp');
    const stamp = s.rows[0];
    if (stamp.user_id !== req.user!.id) throw new ForbiddenError();
    const ageMs = Date.now() - new Date(stamp.created_at).getTime();
    if (ageMs > 60_000) {
      throw new ConflictError('Undo window expired', 'UNDO_WINDOW_EXPIRED');
    }
    const newest = await client.query(
      `SELECT id FROM stamps
       WHERE user_id = $1 AND deleted_at IS NULL
       ORDER BY occurred_at DESC, created_at DESC LIMIT 1`,
      [req.user!.id]
    );
    if (newest.rows[0]?.id !== stamp.id) {
      throw new ConflictError('Not the most recent stamp', 'CONFLICT');
    }
    await client.query(
      `SELECT set_config('app.change_reason', 'user_undo_within_60s', true)`
    );
    const r = await client.query(
      `UPDATE stamps
       SET deleted_at = now(), deleted_by_user_id = $1, deletion_reason = 'user_undo_within_60s'
       WHERE id = $2
       RETURNING *`,
      [req.user!.id, stamp.id]
    );
    ok(res, r.rows[0]);
  })
);
