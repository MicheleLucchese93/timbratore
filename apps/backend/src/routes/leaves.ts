import { Router } from 'express';
import { z } from 'zod';
import type { PoolClient } from 'pg';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { tenantHandler } from '../lib/route-helpers.js';
import { ok } from '../lib/api-response.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors/index.js';
import {
  computeDurationHours,
  getQuotaSummary,
  applyMalattiaOverlap,
  isoYear,
} from '../lib/leave-quota.js';
import {
  notifyLeaveSubmitted,
  notifyLeaveDecided,
  notifyCancellationRequested,
  notifyCancellationDecided,
} from '../lib/notifications.js';

export const leavesRouter = Router();
leavesRouter.use(authenticate);

const TypeEnum = z.enum(['ferie', 'permessi', 'malattia']);

const CreateBody = z.object({
  type: TypeEnum,
  from_ts: z.string().datetime({ offset: true }),
  to_ts: z.string().datetime({ offset: true }),
  inps_protocol: z.string().min(1).max(100).optional(),
  user_note: z.string().max(1000).optional(),
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
    if (b.type === 'permessi') {
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

    const userId = req.user!.id;
    const duration = await computeDurationHours(client, userId, b.type, b.from_ts, b.to_ts);
    if (duration <= 0) {
      throw new ValidationError(
        'la richiesta non copre ore lavorative (verifica l\'orario assegnato)'
      );
    }

    if (b.type === 'ferie' || b.type === 'permessi') {
      const year = isoYear(b.from_ts);
      const summary = await getQuotaSummary(client, userId, year);
      const q = summary.find((s) => s.type === b.type);
      if (!q) {
        throw new ConflictError(
          `nessuna quota ${b.type} configurata per ${year}`,
          'NO_QUOTA'
        );
      }
      if (duration > q.residual_with_pending) {
        throw new ConflictError(
          `quota ${b.type} insufficiente: richiesti ${duration}h, disponibili ${q.residual_with_pending}h`,
          'QUOTA_EXCEEDED'
        );
      }
    }

    const status = b.type === 'malattia' ? 'approved' : 'pending';
    const ins = await client.query(
      `INSERT INTO leave_requests(
         tenant_id, user_id, type, status,
         from_ts, to_ts, duration_hours,
         inps_protocol, user_note,
         decided_by, decided_at
       ) VALUES (
         current_setting('app.current_tenant_id')::uuid,
         current_setting('app.current_user_id')::uuid,
         $1, $2, $3, $4, $5, $6, $7, $8, $9
       ) RETURNING *`,
      [
        b.type,
        status,
        b.from_ts,
        b.to_ts,
        duration,
        b.inps_protocol ?? null,
        b.user_note ?? null,
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

const ListQuery = z.object({
  status: z.string().optional(),
  type: TypeEnum.optional(),
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

    if (scope === 'mine') {
      params.push(req.user!.id);
      where.push(`lr.user_id = $${params.length}`);
    } else if (scope === 'inbox') {
      params.push(req.user!.id);
      where.push(`EXISTS (
        SELECT 1 FROM leave_approvers la
         WHERE la.user_id = lr.user_id AND la.approver_user_id = $${params.length}
      )`);
    } else if (scope === 'all') {
      if (req.user!.role !== 'admin') {
        // Non-admin "all" collapses to inbox+own.
        params.push(req.user!.id);
        where.push(`(lr.user_id = $${params.length} OR EXISTS (
          SELECT 1 FROM leave_approvers la
           WHERE la.user_id = lr.user_id AND la.approver_user_id = $${params.length}
        ))`);
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
    const canApprove =
      req.user!.role === 'admin'
        ? await isApprover(client, req.user!.id, row.user_id)
        : await isApprover(client, req.user!.id, row.user_id);
    if (!canApprove) throw new ForbiddenError('non sei un approvatore di questo utente');

    if (row.type === 'ferie' || row.type === 'permessi') {
      const year = isoYear(row.from_ts);
      const summary = await getQuotaSummary(client, row.user_id, year);
      const q = summary.find((s) => s.type === row.type);
      if (!q || Number(row.duration_hours) > q.residual_strict) {
        throw new ConflictError(
          `quota ${row.type} insufficiente al momento dell'approvazione`,
          'QUOTA_EXCEEDED'
        );
      }
    }

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
    const canApprove = await isApprover(client, req.user!.id, row.user_id);
    if (!canApprove) throw new ForbiddenError('non sei un approvatore di questo utente');

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
    const canApprove = await isApprover(client, req.user!.id, row.user_id);
    if (!canApprove) throw new ForbiddenError('non sei un approvatore di questo utente');

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
