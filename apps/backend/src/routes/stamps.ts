import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { tenantHandler } from '../lib/route-helpers.js';
import { ok } from '../lib/api-response.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors/index.js';
import { idempotencyMiddleware } from '../middleware/idempotency.js';
import { computeCurrentState, evaluateStamp } from '../services/stamp-service.js';
import type { StampEventType } from '@sonoqui/shared';
import { TENANT_TZ_SQL } from '../lib/tz.js';
import { loadStampHistory } from '../lib/stamp-history.js';
import { loadDayDossier } from '../lib/stamp-dossier.js';
import { buildDayDossierPdf } from '../lib/stamp-dossier-pdf.js';
import { logAudit } from '../lib/audit.js';
import { adminPool } from '../lib/admin-db.js';
import { safeFileName } from '../lib/filename.js';

export const stampsRouter = Router();
stampsRouter.use(authenticate);

/** Best human label for an auth_users row, same precedence as the Registro. */
const ACTOR_NAME_SQL = (alias: string): string =>
  `COALESCE(NULLIF(TRIM(CONCAT(${alias}.first_name, ' ', ${alias}.last_name)), ''), ${alias}.display_name, ${alias}.email)`;

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
         suspicious_mock_location, notes, queued_hours, out_of_geofence, geofence_distance_m
       )
       VALUES ($1, $2, $3, $4, 'employee_app', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
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
        evaluated.outOfGeofence,
        evaluated.geofenceDistanceM,
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
    // Opt-in: an admin can delete an employee's punch, and the employee has to
    // be able to see that it happened. Kept behind a flag so shipped mobile
    // builds, which assume every row they get is live, are unaffected until
    // they ask for it.
    const includeDeleted = req.query.include_deleted === 'true';
    const r = await client.query(
      // from/to are the device's local calendar days; occurred_at is a UTC
      // instant. Resolving them with a bare ::date compared them against the
      // server clock (UTC in prod), so an employee asking for "today" between
      // midnight and 02:00 local was served the previous local day and could
      // not see the punch they had just made.
      `SELECT s.*,
              ${ACTOR_NAME_SQL('eu')} AS edited_by_name,
              ${ACTOR_NAME_SQL('du')} AS deleted_by_name
       FROM stamps s
       LEFT JOIN auth_users eu ON eu.id = s.edited_by_user_id
       LEFT JOIN auth_users du ON du.id = s.deleted_by_user_id
       WHERE s.user_id = $1 AND (s.deleted_at IS NULL OR $4::boolean)
         AND ($2::date IS NULL OR s.occurred_at >= ($2::timestamp AT TIME ZONE ${TENANT_TZ_SQL}))
         AND ($3::date IS NULL OR s.occurred_at < (($3::date + 1)::timestamp AT TIME ZONE ${TENANT_TZ_SQL}))
       ORDER BY s.occurred_at DESC
       LIMIT 1000`,
      [req.user!.id, from, to, includeDeleted]
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
    // from/to are tenant-local calendar days; occurred_at is a UTC instant.
    if (req.query.from) {
      params.push(`${String(req.query.from)} 00:00:00`);
      filters.push(`occurred_at >= ($${params.length}::timestamp AT TIME ZONE ${TENANT_TZ_SQL})`);
    }
    if (req.query.to) {
      params.push(String(req.query.to));
      filters.push(
        `occurred_at < (($${params.length}::date + 1)::timestamp AT TIME ZONE ${TENANT_TZ_SQL})`
      );
    }
    const limit = Math.min(Number(req.query.limit ?? 200), 1000);
    const r = await client.query(
      `SELECT s.*, COALESCE(au.email, s.user_id::text) AS user_email,
              ${ACTOR_NAME_SQL('eu')} AS edited_by_name,
              ${ACTOR_NAME_SQL('du')} AS deleted_by_name
       FROM stamps s
       LEFT JOIN auth_users au ON au.id = s.user_id
       LEFT JOIN auth_users eu ON eu.id = s.edited_by_user_id
       LEFT JOIN auth_users du ON du.id = s.deleted_by_user_id
       WHERE ${filters.join(' AND ')}
       ORDER BY occurred_at DESC
       LIMIT ${limit}`,
      params
    );
    ok(res, r.rows);
  })
);

/* ---------------- contestation trail ---------------- */

const DossierQuery = z.object({
  user_id: z.string().uuid().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

// Who may look at whose trail. An employee reading their own punches is the
// point (they cannot contest a change they cannot see); anyone else needs the
// admin role. RLS enforces the same rule one layer down.
function assertMayRead(req: import('express').Request, targetUserId: string): void {
  if (req.user!.role !== 'admin' && targetUserId !== req.user!.id) throw new ForbiddenError();
}

/**
 * GET /api/v1/stamps/day-dossier?user_id=&date=
 * The whole day for one employee: every punch (soft-deleted ones included),
 * each with its change history, plus the anomaly notes and correction requests
 * that touch the same day.
 */
stampsRouter.get(
  '/day-dossier',
  tenantHandler(async (req, res, client) => {
    const parse = DossierQuery.safeParse(req.query);
    if (!parse.success) throw new ValidationError('invalid query', parse.error.flatten());
    const userId = parse.data.user_id ?? req.user!.id;
    assertMayRead(req, userId);
    const dossier = await loadDayDossier(client, { userId, date: parse.data.date });
    ok(res, dossier);
  })
);

/** Same dossier as an A4 PDF — the artifact that leaves the app in a dispute. */
stampsRouter.get(
  '/day-dossier.pdf',
  tenantHandler(async (req, res, client) => {
    const parse = DossierQuery.safeParse(req.query);
    if (!parse.success) throw new ValidationError('invalid query', parse.error.flatten());
    const userId = parse.data.user_id ?? req.user!.id;
    assertMayRead(req, userId);

    const me = await client.query(
      `SELECT ${ACTOR_NAME_SQL('au')} AS name FROM auth_users au WHERE au.id = $1`,
      [req.user!.id]
    );
    const dossier = await loadDayDossier(client, {
      userId,
      date: parse.data.date,
      generatedBy: (me.rows[0]?.name as string | undefined) ?? null,
    });
    const tz = await client.query(
      `SELECT timezone FROM tenants WHERE id = current_setting('app.current_tenant_id')::uuid`
    );

    // Handing a member's attendance record to a third party is itself an event
    // the tenant should be able to see, so it goes in the Registro. Only when an
    // admin exports someone else's day: an employee printing their own is not a
    // disclosure. Skipped for a partner support session — that transaction is
    // SET TRANSACTION READ ONLY, so the insert would fail with 25006 and take
    // the download down with it (support sessions are already audited in full
    // by migration 058's own trail).
    if (!req.support && req.user!.role === 'admin' && userId !== req.user!.id) {
      await logAudit(client, {
        action: 'stamp.dossier_export',
        resourceType: 'stamp',
        resourceId: `${userId}:${parse.data.date}`,
        targetUserId: userId,
        after: { date: parse.data.date, stamps: dossier.stamps.length },
        req,
      });
    }

    const language = await requesterLanguage(req.user!.id);
    const pdf = await buildDayDossierPdf({
      dossier,
      language,
      timeZone: (tz.rows[0]?.timezone as string | undefined) || 'Europe/Rome',
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="dossier-${safeFileName(dossier.user.name, 'dipendente')}-${parse.data.date}.pdf"`
    );
    res.send(pdf);
  })
);

/** GET /api/v1/stamps/:id/history — the append-only trail of one punch. */
stampsRouter.get(
  '/:id/history',
  tenantHandler(async (req, res, client) => {
    const s = await client.query(
      `SELECT s.id, s.user_id, s.event_type, s.occurred_at, s.source, s.branch_id, s.notes,
              s.original_occurred_at, s.original_event_type, s.edited_at, s.edit_count,
              ${ACTOR_NAME_SQL('eu')} AS edited_by_name,
              s.deleted_at, s.deletion_reason, ${ACTOR_NAME_SQL('du')} AS deleted_by_name
         FROM stamps s
         LEFT JOIN auth_users eu ON eu.id = s.edited_by_user_id
         LEFT JOIN auth_users du ON du.id = s.deleted_by_user_id
        WHERE s.id = $1`,
      [req.params.id]
    );
    if (s.rowCount === 0) throw new NotFoundError('stamp');
    assertMayRead(req, s.rows[0].user_id as string);

    if (req.query.raw === '1' && req.user!.role === 'admin') {
      const raw = await client.query(
        `SELECT * FROM stamps_history WHERE stamp_id = $1 ORDER BY recorded_at, id`,
        [req.params.id]
      );
      return ok(res, { stamp: s.rows[0], raw: raw.rows });
    }

    const events = await loadStampHistory(client, String(req.params.id));
    ok(res, { stamp: s.rows[0], events });
  })
);

// Labels of the PDF follow the requesting user's own language, same source as
// notifications.ts and the cantieri report.
async function requesterLanguage(userId: string): Promise<'it' | 'en'> {
  const r = await adminPool.query(`SELECT language FROM user_preferences WHERE user_id = $1`, [
    userId,
  ]);
  return r.rows[0]?.language === 'en' ? 'en' : 'it';
}


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
