import { Router } from 'express';
import { z } from 'zod';
import type { PoolClient } from 'pg';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { tenantHandler } from '../lib/route-helpers.js';
import { ok } from '../lib/api-response.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors/index.js';
import {
  computeDurationHours,
  applyMalattiaOverlap,
  assertPerDayCap,
} from '../lib/leave-quota.js';
import {
  notifyLeaveSubmitted,
  notifyLeaveDecided,
  notifyCancellationRequested,
  notifyCancellationDecided,
  notifyBulkEvent,
} from '../lib/notifications.js';

export const leavesRouter = Router();
leavesRouter.use(authenticate);

const TypeEnum = z.enum(['ferie', 'permessi', 'malattia', 'assenza']);

const ASSENZA_SUBTYPES = [
  'lutto',
  'donazione_sangue',
  'permesso_studio',
  'permesso_elettorale',
  'matrimonio',
  'allattamento',
  'congedo_parentale',
  'legge_104',
  'assemblea_sindacale',
  'visita_medica',
  'motivi_personali',
] as const;
const AssenzaSubtypeEnum = z.enum(ASSENZA_SUBTYPES);

const CreateBody = z.object({
  type: TypeEnum,
  from_ts: z.string().datetime({ offset: true }),
  to_ts: z.string().datetime({ offset: true }),
  // All-day request (full scheduled day) vs a specific-time permesso. Only
  // gates the 15-minute-multiple rule below; the duration itself always comes
  // from the shift template / clip in computeDurationHours. Defaults to false
  // so specific-time requests keep the strict validation.
  all_day: z.boolean().optional(),
  inps_protocol: z.string().min(1).max(100).optional(),
  user_note: z.string().max(1000).optional(),
  assenza_subtype: AssenzaSubtypeEnum.optional(),
  is_paid: z.boolean().optional(),
});

function quarterMs(): number {
  return 15 * 60 * 1000;
}

async function loadRequest(client: PoolClient, id: string) {
  const r = await client.query(`SELECT * FROM leave_requests WHERE id = $1`, [id]);
  if (r.rowCount === 0) throw new NotFoundError('leave_request');
  return r.rows[0];
}

async function logEvent(
  client: PoolClient,
  requestId: string,
  action: string,
  payload: Record<string, unknown> | null = null
): Promise<void> {
  await client.query(
    `INSERT INTO leave_audit_log(tenant_id, request_id, actor_user_id, action, payload)
     VALUES (current_setting('app.current_tenant_id')::uuid,
             $1,
             current_setting('app.current_user_id')::uuid,
             $2, $3::jsonb)`,
    [requestId, action, payload ? JSON.stringify(payload) : null]
  );
}

async function hasAnyApprover(client: PoolClient, requesterId: string): Promise<boolean> {
  const r = await client.query(
    `SELECT 1 FROM leave_approvers WHERE user_id = $1 LIMIT 1`,
    [requesterId]
  );
  return (r.rowCount ?? 0) > 0;
}

async function isApprover(
  client: PoolClient,
  approverId: string,
  requesterId: string
): Promise<boolean> {
  const r = await client.query(
    `SELECT 1 FROM leave_approvers WHERE user_id = $1 AND approver_user_id = $2`,
    [requesterId, approverId]
  );
  return (r.rowCount ?? 0) > 0;
}

async function assertCanDecide(
  client: PoolClient,
  approverId: string,
  approverRole: 'admin' | 'user',
  requesterId: string
): Promise<void> {
  const configured = await hasAnyApprover(client, requesterId);
  if (configured) {
    if (!(await isApprover(client, approverId, requesterId))) {
      throw new ForbiddenError('non sei un approvatore di questo utente');
    }
    return;
  }
  if (approverRole !== 'admin') {
    throw new ForbiddenError('nessun approvatore configurato; solo gli admin possono decidere');
  }
}

leavesRouter.post(
  '/',
  tenantHandler(async (req, res, client) => {
    const parse = CreateBody.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const b = parse.data;

    const from = new Date(b.from_ts);
    const to = new Date(b.to_ts);
    if (to.getTime() <= from.getTime()) {
      throw new ValidationError('to_ts deve essere maggiore di from_ts');
    }
    // Specific-time permessi must be clean 15-minute slots. An all-day permesso
    // is exempt — its span is the whole calendar day and its duration comes from
    // the shift template, not the raw start/end.
    if (b.type === 'permessi' && !b.all_day) {
      const span = to.getTime() - from.getTime();
      if (span % quarterMs() !== 0) {
        throw new ValidationError('il permesso deve essere multiplo di 15 minuti');
      }
      if (span < quarterMs()) {
        throw new ValidationError('durata minima del permesso: 15 minuti');
      }
    }
    if (b.type === 'malattia' && !b.inps_protocol) {
      throw new ValidationError('numero protocollo INPS obbligatorio per malattia');
    }
    if (b.type === 'assenza') {
      if (!b.assenza_subtype) {
        throw new ValidationError('tipologia di assenza obbligatoria');
      }
      if (b.is_paid === undefined) {
        throw new ValidationError('specifica se l\'assenza è retribuita');
      }
    }

    const userId = req.user!.id;
    const duration = await computeDurationHours(client, userId, b.type, b.from_ts, b.to_ts);
    if (duration <= 0) {
      throw new ValidationError(
        'la richiesta non copre ore lavorative (verifica l\'orario assegnato)'
      );
    }

    // Per-day cap: the sum of (existing active requests + this one) cannot
    // exceed the user's timesheet hours for any single day. malattia is
    // exempt — it deliberately overrides overlapping rows via
    // applyMalattiaOverlap below.
    await assertPerDayCap(client, userId, b.type, b.from_ts, b.to_ts, null);

    // Quota balance is informational only. Submissions never blocked: companies
    // decide policy themselves and the counter is allowed to go negative.
    const status = b.type === 'malattia' ? 'approved' : 'pending';
    const ins = await client.query(
      `INSERT INTO leave_requests(
         tenant_id, user_id, type, status,
         from_ts, to_ts, duration_hours,
         inps_protocol, user_note,
         assenza_subtype, is_paid,
         decided_by, decided_at
       ) VALUES (
         current_setting('app.current_tenant_id')::uuid,
         current_setting('app.current_user_id')::uuid,
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
       ) RETURNING *`,
      [
        b.type,
        status,
        b.from_ts,
        b.to_ts,
        duration,
        b.inps_protocol ?? null,
        b.user_note ?? null,
        b.type === 'assenza' ? b.assenza_subtype ?? null : null,
        b.type === 'assenza' ? b.is_paid ?? null : null,
        b.type === 'malattia' ? userId : null,
        b.type === 'malattia' ? new Date().toISOString() : null,
      ]
    );
    const row = ins.rows[0];
    await logEvent(client, row.id, 'submit', { type: b.type, duration_hours: duration });

    if (b.type === 'malattia') {
      const result = await applyMalattiaOverlap(client, userId, row.id, b.from_ts, b.to_ts);
      if (result.supersededIds.length > 0 || result.trimmedIds.length > 0) {
        await logEvent(client, row.id, 'malattia.overlap_applied', {
          superseded: result.supersededIds,
          trimmed: result.trimmedIds,
        });
        for (const sid of result.supersededIds) {
          await logEvent(client, sid, 'superseded_by_malattia', { malattia_id: row.id });
        }
        for (const tid of result.trimmedIds) {
          await logEvent(client, tid, 'trimmed_by_malattia', { malattia_id: row.id });
        }
      }
    } else {
      await notifyLeaveSubmitted(client, {
        requestId: row.id,
        type: b.type,
        from_ts: b.from_ts,
        to_ts: b.to_ts,
        duration_hours: duration,
        requester_id: userId,
        reason: b.user_note,
      });
    }
    ok(res, row, 201);
  })
);

// Admin inserts a single ferie/permesso on behalf of one employee — used to
// resolve a schedule anomaly. Unlike POST '/', the row is created already
// approved with the admin as decider, flagged created_by_admin, and the
// employee is notified. Quota is informational (never blocks), same as submit.
const AdminCreateBody = z.object({
  user_id: z.string().uuid(),
  type: z.enum(['ferie', 'permessi']),
  from_ts: z.string().datetime({ offset: true }),
  to_ts: z.string().datetime({ offset: true }),
  all_day: z.boolean().optional(),
  user_note: z.string().max(1000).optional(),
});

leavesRouter.post(
  '/admin-create',
  requireAdmin,
  tenantHandler(async (req, res, client) => {
    const parse = AdminCreateBody.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const b = parse.data;
    const from = new Date(b.from_ts);
    const to = new Date(b.to_ts);
    if (to.getTime() <= from.getTime()) {
      throw new ValidationError('to_ts deve essere maggiore di from_ts');
    }
    if (b.type === 'permessi' && !b.all_day) {
      const span = to.getTime() - from.getTime();
      if (span % quarterMs() !== 0) {
        throw new ValidationError('il permesso deve essere multiplo di 15 minuti');
      }
      if (span < quarterMs()) {
        throw new ValidationError('durata minima del permesso: 15 minuti');
      }
    }
    const member = await client.query(
      `SELECT 1 FROM memberships
        WHERE tenant_id = current_setting('app.current_tenant_id')::uuid
          AND user_id = $1 AND deleted_at IS NULL`,
      [b.user_id]
    );
    if (member.rowCount === 0) throw new NotFoundError('user not in tenant');

    const duration = await computeDurationHours(client, b.user_id, b.type, b.from_ts, b.to_ts);
    if (duration <= 0) {
      throw new ValidationError(
        'la richiesta non copre ore lavorative (verifica l\'orario assegnato)'
      );
    }
    await assertPerDayCap(client, b.user_id, b.type, b.from_ts, b.to_ts, null);

    const ins = await client.query(
      `INSERT INTO leave_requests(
         tenant_id, user_id, type, status,
         from_ts, to_ts, duration_hours,
         user_note, created_by_admin,
         decided_by, decided_at
       ) VALUES (
         current_setting('app.current_tenant_id')::uuid,
         $1, $2, 'approved', $3, $4, $5, $6, true,
         current_setting('app.current_user_id')::uuid, now()
       ) RETURNING *`,
      [b.user_id, b.type, b.from_ts, b.to_ts, duration, b.user_note ?? null]
    );
    const row = ins.rows[0];
    await logEvent(client, row.id, 'admin_create', {
      type: b.type,
      duration_hours: duration,
      on_behalf_of: b.user_id,
    });
    await notifyLeaveDecided(
      client,
      {
        requestId: row.id,
        type: b.type,
        from_ts: b.from_ts,
        to_ts: b.to_ts,
        duration_hours: duration,
        requester_id: b.user_id,
      },
      'approved',
      req.user!.id
    );
    ok(res, row, 201);
  })
);

// Filter enum is wider than TypeEnum: it also accepts 'chiusura' (company
// events) which users cannot create but the calendar must be able to filter.
const FilterTypeEnum = z.enum(['ferie', 'permessi', 'malattia', 'assenza', 'chiusura']);

const ListQuery = z.object({
  status: z.string().optional(),
  type: FilterTypeEnum.optional(),
  user_id: z.string().uuid().optional(),
  scope: z.enum(['mine', 'inbox', 'all']).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

leavesRouter.get(
  '/',
  tenantHandler(async (req, res, client) => {
    const parse = ListQuery.safeParse(req.query);
    if (!parse.success) throw new ValidationError('invalid query', parse.error.flatten());
    const q = parse.data;
    const scope = q.scope ?? (req.user!.role === 'admin' ? 'all' : 'mine');

    const where: string[] = ['1=1'];
    const params: unknown[] = [];

    // Approver-inbox SQL: rows visible to a given approverId are either
    // explicitly mapped via leave_approvers OR, when the requester has no
    // approvers configured, fall back to admins.
    const inboxSql = (approverId: number, isAdminLiteral: string): string => `(
      EXISTS (
        SELECT 1 FROM leave_approvers la
         WHERE la.user_id = lr.user_id AND la.approver_user_id = $${approverId}
      )
      OR (
        ${isAdminLiteral} AND NOT EXISTS (
          SELECT 1 FROM leave_approvers la2 WHERE la2.user_id = lr.user_id
        )
      )
    )`;

    if (scope === 'mine') {
      params.push(req.user!.id);
      where.push(`lr.user_id = $${params.length}`);
    } else if (scope === 'inbox') {
      params.push(req.user!.id);
      where.push(inboxSql(params.length, req.user!.role === 'admin' ? 'TRUE' : 'FALSE'));
    } else if (scope === 'all') {
      if (req.user!.role !== 'admin') {
        params.push(req.user!.id);
        where.push(`(lr.user_id = $${params.length} OR ${inboxSql(params.length, 'FALSE')})`);
      }
    }
    if (q.status) {
      params.push(q.status);
      where.push(`lr.status = $${params.length}`);
    }
    if (q.type) {
      params.push(q.type);
      where.push(`lr.type = $${params.length}`);
    }
    if (q.user_id) {
      params.push(q.user_id);
      where.push(`lr.user_id = $${params.length}`);
    }
    if (q.from) {
      params.push(q.from);
      where.push(`lr.to_ts >= $${params.length}::timestamptz`);
    }
    if (q.to) {
      params.push(q.to);
      where.push(`lr.from_ts < ($${params.length}::date + INTERVAL '1 day')::timestamptz`);
    }

    const sql = `
      SELECT lr.*,
             COALESCE(au.email, lr.user_id::text) AS user_email,
             au.display_name AS user_display_name,
             dec_au.display_name AS decided_by_display_name,
             COALESCE(dec_au.email, lr.decided_by::text) AS decided_by_email
        FROM leave_requests lr
        LEFT JOIN auth_users au ON au.id = lr.user_id
        LEFT JOIN auth_users dec_au ON dec_au.id = lr.decided_by
       WHERE ${where.join(' AND ')}
       ORDER BY lr.created_at DESC
       LIMIT 500`;
    const r = await client.query(sql, params);
    ok(res, r.rows);
  })
);

leavesRouter.get(
  '/:id',
  tenantHandler(async (req, res, client) => {
    const r = await client.query(
      `SELECT lr.*,
              COALESCE(au.email, lr.user_id::text) AS user_email,
              au.display_name AS user_display_name
         FROM leave_requests lr
         LEFT JOIN auth_users au ON au.id = lr.user_id
        WHERE lr.id = $1`,
      [req.params.id]
    );
    if (r.rowCount === 0) throw new NotFoundError('leave_request');
    const events = await client.query(
      `SELECT id, actor_user_id, action, payload, created_at
         FROM leave_audit_log
        WHERE request_id = $1
        ORDER BY created_at`,
      [req.params.id]
    );
    ok(res, { ...r.rows[0], events: events.rows });
  })
);

const RejectBody = z.object({ rejection_reason: z.string().min(1).max(500) });

leavesRouter.post(
  '/:id/approve',
  tenantHandler(async (req, res, client) => {
    const r = await client.query(
      `SELECT * FROM leave_requests WHERE id = $1 FOR UPDATE`,
      [req.params.id]
    );
    if (r.rowCount === 0) throw new NotFoundError('leave_request');
    const row = r.rows[0];
    if (row.status !== 'pending') {
      throw new ConflictError('richiesta non più in attesa', 'NOT_PENDING');
    }
    await assertCanDecide(client, req.user!.id, req.user!.role, row.user_id);

    // Re-check the per-day cap in case other requests landed between submit
    // and approve. Exclude this row's id so an exact-match self-overlap
    // doesn't double-count. malattia is exempt (assertPerDayCap short-
    // circuits on type='malattia').
    await assertPerDayCap(
      client,
      row.user_id,
      row.type as 'ferie' | 'permessi' | 'malattia' | 'assenza',
      typeof row.from_ts === 'string' ? row.from_ts : new Date(row.from_ts).toISOString(),
      typeof row.to_ts === 'string' ? row.to_ts : new Date(row.to_ts).toISOString(),
      row.id
    );

    // Approval never blocked by quota — see submission rationale.
    await client.query(
      `UPDATE leave_requests
          SET status = 'approved',
              decided_by = current_setting('app.current_user_id')::uuid,
              decided_at = now()
        WHERE id = $1`,
      [row.id]
    );
    await logEvent(client, row.id, 'approve');
    await notifyLeaveDecided(
      client,
      {
        requestId: row.id,
        type: row.type,
        from_ts: row.from_ts,
        to_ts: row.to_ts,
        duration_hours: Number(row.duration_hours),
        requester_id: row.user_id,
      },
      'approved',
      req.user!.id
    );
    const updated = await loadRequest(client, row.id);
    ok(res, updated);
  })
);

leavesRouter.post(
  '/:id/reject',
  tenantHandler(async (req, res, client) => {
    const parse = RejectBody.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const r = await client.query(
      `SELECT * FROM leave_requests WHERE id = $1 FOR UPDATE`,
      [req.params.id]
    );
    if (r.rowCount === 0) throw new NotFoundError('leave_request');
    const row = r.rows[0];
    if (row.status !== 'pending') {
      throw new ConflictError('richiesta non più in attesa', 'NOT_PENDING');
    }
    await assertCanDecide(client, req.user!.id, req.user!.role, row.user_id);

    await client.query(
      `UPDATE leave_requests
          SET status = 'rejected',
              decided_by = current_setting('app.current_user_id')::uuid,
              decided_at = now(),
              rejection_reason = $2
        WHERE id = $1`,
      [row.id, parse.data.rejection_reason]
    );
    await logEvent(client, row.id, 'reject', { reason: parse.data.rejection_reason });
    await notifyLeaveDecided(
      client,
      {
        requestId: row.id,
        type: row.type,
        from_ts: row.from_ts,
        to_ts: row.to_ts,
        duration_hours: Number(row.duration_hours),
        requester_id: row.user_id,
      },
      'rejected',
      req.user!.id,
      parse.data.rejection_reason
    );
    const updated = await loadRequest(client, row.id);
    ok(res, updated);
  })
);

leavesRouter.post(
  '/:id/cancel',
  tenantHandler(async (req, res, client) => {
    const r = await client.query(
      `SELECT * FROM leave_requests WHERE id = $1 FOR UPDATE`,
      [req.params.id]
    );
    if (r.rowCount === 0) throw new NotFoundError('leave_request');
    const row = r.rows[0];
    if (row.user_id !== req.user!.id) {
      throw new ForbiddenError('solo l\'autore può annullare');
    }
    if (row.status !== 'pending') {
      throw new ConflictError('annullabile solo se in attesa', 'NOT_PENDING');
    }
    await client.query(
      `UPDATE leave_requests SET status = 'cancelled' WHERE id = $1`,
      [row.id]
    );
    await logEvent(client, row.id, 'cancel');
    const updated = await loadRequest(client, row.id);
    ok(res, updated);
  })
);

const CancelRequestBody = z.object({
  cancellation_reason: z.string().min(1).max(500),
});

leavesRouter.post(
  '/:id/request-cancellation',
  tenantHandler(async (req, res, client) => {
    const parse = CancelRequestBody.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const r = await client.query(
      `SELECT * FROM leave_requests WHERE id = $1 FOR UPDATE`,
      [req.params.id]
    );
    if (r.rowCount === 0) throw new NotFoundError('leave_request');
    const row = r.rows[0];
    if (row.user_id !== req.user!.id) {
      throw new ForbiddenError('solo l\'autore può richiedere annullamento');
    }
    if (row.status !== 'approved') {
      throw new ConflictError(
        'annullamento richiedibile solo su richieste approvate',
        'NOT_APPROVED'
      );
    }
    if (row.type === 'malattia') {
      throw new ConflictError(
        'malattia non annullabile da utente — contatta admin',
        'NOT_ALLOWED'
      );
    }
    await client.query(
      `UPDATE leave_requests
          SET status = 'cancellation_pending',
              cancellation_reason = $2
        WHERE id = $1`,
      [row.id, parse.data.cancellation_reason]
    );
    await logEvent(client, row.id, 'request_cancellation', {
      reason: parse.data.cancellation_reason,
    });
    await notifyCancellationRequested(client, {
      requestId: row.id,
      type: row.type,
      from_ts: row.from_ts,
      to_ts: row.to_ts,
      duration_hours: Number(row.duration_hours),
      requester_id: row.user_id,
      reason: parse.data.cancellation_reason,
    });
    const updated = await loadRequest(client, row.id);
    ok(res, updated);
  })
);

const DecideCancelBody = z.object({
  approve: z.boolean(),
  reason: z.string().max(500).optional(),
});

leavesRouter.post(
  '/:id/decide-cancellation',
  tenantHandler(async (req, res, client) => {
    const parse = DecideCancelBody.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const r = await client.query(
      `SELECT * FROM leave_requests WHERE id = $1 FOR UPDATE`,
      [req.params.id]
    );
    if (r.rowCount === 0) throw new NotFoundError('leave_request');
    const row = r.rows[0];
    if (row.status !== 'cancellation_pending') {
      throw new ConflictError('nessuna richiesta di annullamento attiva', 'WRONG_STATE');
    }
    await assertCanDecide(client, req.user!.id, req.user!.role, row.user_id);

    const newStatus = parse.data.approve ? 'cancelled_post_approval' : 'approved';
    await client.query(
      `UPDATE leave_requests
          SET status = $2,
              cancellation_decided_by = current_setting('app.current_user_id')::uuid,
              cancellation_decided_at = now()
        WHERE id = $1`,
      [row.id, newStatus]
    );
    await logEvent(client, row.id, 'decide_cancellation', {
      approve: parse.data.approve,
      reason: parse.data.reason ?? null,
    });
    await notifyCancellationDecided(
      client,
      {
        requestId: row.id,
        type: row.type,
        from_ts: row.from_ts,
        to_ts: row.to_ts,
        duration_hours: Number(row.duration_hours),
        requester_id: row.user_id,
      },
      parse.data.approve
    );
    const updated = await loadRequest(client, row.id);
    ok(res, updated);
  })
);

// Admin force-cancel (e.g. after revoking malattia).
leavesRouter.post(
  '/:id/admin-revoke',
  requireAdmin,
  tenantHandler(async (req, res, client) => {
    const parse = z.object({ reason: z.string().min(1).max(500) }).safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const r = await client.query(
      `SELECT * FROM leave_requests WHERE id = $1 FOR UPDATE`,
      [req.params.id]
    );
    if (r.rowCount === 0) throw new NotFoundError('leave_request');
    await client.query(
      `UPDATE leave_requests
          SET status = 'cancelled_post_approval',
              cancellation_decided_by = current_setting('app.current_user_id')::uuid,
              cancellation_decided_at = now(),
              cancellation_reason = $2
        WHERE id = $1`,
      [req.params.id, parse.data.reason]
    );
    await logEvent(client, String(req.params.id), 'admin_revoke', { reason: parse.data.reason });
    const updated = await loadRequest(client, String(req.params.id));
    ok(res, updated);
  })
);

/* ----- Admin bulk company events (e.g. "Chiusura aziendale agosto") ----- */

const BulkBody = z.object({
  title: z.string().min(1).max(200),
  from_ts: z.string().datetime({ offset: true }),
  to_ts: z.string().datetime({ offset: true }),
  // false → non-deducting 'chiusura'; true → approved 'ferie' that consumes quota.
  deduct_ferie: z.boolean().default(false),
  // Omitted/empty → every active member of the tenant.
  user_ids: z.array(z.string().uuid()).optional(),
  user_note: z.string().max(1000).optional(),
});

leavesRouter.post(
  '/bulk',
  requireAdmin,
  tenantHandler(async (req, res, client) => {
    const parse = BulkBody.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const b = parse.data;
    if (new Date(b.to_ts).getTime() <= new Date(b.from_ts).getTime()) {
      throw new ValidationError('to_ts deve essere maggiore di from_ts');
    }

    let userIds = b.user_ids ?? [];
    if (userIds.length === 0) {
      const all = await client.query(
        `SELECT user_id FROM memberships
          WHERE tenant_id = current_setting('app.current_tenant_id')::uuid
            AND active = TRUE
            AND deleted_at IS NULL`
      );
      userIds = all.rows.map((r) => r.user_id as string);
    }
    userIds = Array.from(new Set(userIds));
    if (userIds.length === 0) throw new ValidationError('nessun utente selezionato');

    const type = b.deduct_ferie ? 'ferie' : 'chiusura';
    const batchRow = await client.query(`SELECT gen_random_uuid() AS id`);
    const batchId = batchRow.rows[0].id as string;

    const created: string[] = [];
    for (const uid of userIds) {
      // Closures span whole days; hours follow the user's shift template, same
      // path 'ferie' uses. Per-day cap intentionally NOT enforced — the closure
      // is mandatory and admin-imposed.
      const duration = await computeDurationHours(client, uid, 'ferie', b.from_ts, b.to_ts);
      const ins = await client.query(
        `INSERT INTO leave_requests(
           tenant_id, user_id, type, status, from_ts, to_ts, duration_hours,
           decided_by, decided_at, created_by_admin, batch_id, title, user_note
         ) VALUES (
           current_setting('app.current_tenant_id')::uuid, $1, $2, 'approved',
           $3, $4, $5,
           current_setting('app.current_user_id')::uuid, now(), TRUE, $6, $7, $8
         ) RETURNING id`,
        [uid, type, b.from_ts, b.to_ts, duration, batchId, b.title, b.user_note ?? null]
      );
      await logEvent(client, ins.rows[0].id, 'admin_bulk_create', {
        batch_id: batchId,
        title: b.title,
        type,
        deduct_ferie: b.deduct_ferie,
      });
      created.push(uid);
    }

    await notifyBulkEvent(created, {
      title: b.title,
      from_ts: b.from_ts,
      to_ts: b.to_ts,
      deducts_ferie: b.deduct_ferie,
      batchId,
    });

    ok(res, { batch_id: batchId, created_count: created.length, user_ids: created }, 201);
  })
);

leavesRouter.post(
  '/bulk/:batchId/revoke',
  requireAdmin,
  tenantHandler(async (req, res, client) => {
    const parsed = z.string().uuid().safeParse(req.params.batchId);
    if (!parsed.success) throw new ValidationError('batchId non valido');
    const r = await client.query(
      `UPDATE leave_requests
          SET status = 'cancelled_post_approval',
              cancellation_decided_by = current_setting('app.current_user_id')::uuid,
              cancellation_decided_at = now(),
              cancellation_reason = COALESCE(cancellation_reason, 'Evento aziendale annullato')
        WHERE batch_id = $1
          AND status = 'approved'
        RETURNING id`,
      [parsed.data]
    );
    ok(res, { revoked_count: r.rowCount ?? 0 });
  })
);
