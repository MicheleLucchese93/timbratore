import { Router } from 'express';
import { z } from 'zod';
import { apiHandler } from '../../lib/route-helpers.js';
import { requireScope } from '../../middleware/api-key.js';
import { apiIdempotency } from '../../middleware/idempotency.js';
import { ok } from '../../lib/api-response.js';
import { stampColumns } from '../../lib/stamp-columns.js';
import { loadStampHistory } from '../../lib/stamp-history.js';
import { emitAuditAndOutbox } from '../admin-stamps.js';
import { NotFoundError } from '../../errors/index.js';
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
 * Punches — the resource a badge reader, a turnstile or a site tablet writes to,
 * and the one a payroll pull reads from.
 *
 * WHAT IS NOT HERE: coordinates. `stampColumns()` is the same 24-column
 * whitelist the web and phone apps get, and latitude/longitude/gps_accuracy_m
 * are not in it — they are input-only and held permanently NULL by migration
 * 060. A punch carries the geofence VERDICT (branch, out_of_geofence, distance),
 * never the position that produced it. Reusing that helper rather than writing a
 * column list here is deliberate: a future column is then whitelisted once.
 *
 * Every write audits under a `stamp.*` action, which is what makes
 * lib/audit.ts's GPS scrub apply to the before/after snapshots — an action named
 * anything else would put raw payloads in a table with no retention.
 */
export const publicStampsRouter = Router();

const EVENT_TYPES = [
  'clock_in',
  'clock_out',
  'break_start',
  'break_end',
  'lunch_start',
  'lunch_end',
] as const;

const ListQuery = PageQuery.extend({
  user_id: z.string().uuid().optional(),
  branch_id: z.string().uuid().optional(),
  event_type: z.enum(EVENT_TYPES).optional(),
  from: DateOnly.optional(),
  to: DateOnly.optional(),
  /** Deleted punches are part of the contestation record (migration 059), so
   *  they are reachable — but never by default: a payroll pull that silently
   *  counted them would bill hours that were struck off. */
  include_deleted: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  /** Punches changed since an instant — the incremental-sync filter. */
  updated_since: z.string().datetime({ offset: true }).optional(),
});

publicStampsRouter.get(
  '/',
  requireScope('stamps:read'),
  apiHandler(async (req, res, client) => {
    const q = parseQuery(ListQuery, req);
    const where: string[] = [];
    const params: unknown[] = [];
    if (!q.include_deleted) where.push('s.deleted_at IS NULL');
    if (q.user_id) {
      params.push(q.user_id);
      where.push(`s.user_id = $${params.length}`);
    }
    if (q.branch_id) {
      params.push(q.branch_id);
      where.push(`s.branch_id = $${params.length}`);
    }
    if (q.event_type) {
      params.push(q.event_type);
      where.push(`s.event_type = $${params.length}`);
    }
    // from/to are tenant-local calendar days; occurred_at is a UTC instant. The
    // conversion goes on the PARAMETER so the occurred_at index stays usable.
    if (q.from) {
      params.push(`${q.from} 00:00:00`);
      where.push(`s.occurred_at >= ${dayStartSql(params.length)}`);
    }
    if (q.to) {
      params.push(q.to);
      where.push(`s.occurred_at < ${dayEndExclusiveSql(params.length)}`);
    }
    if (q.updated_since) {
      params.push(q.updated_since);
      // `edited_at` is only set when the punch itself MOVED (migration 059 does
      // not count a note-only edit as an edit), so a filter built on it alone
      // would drop exactly the changes an incremental sync is there to pick up.
      // stamps_history is the append-only record of every write, so ask it.
      where.push(
        `(GREATEST(s.created_at,
                   COALESCE(s.edited_at, s.created_at),
                   COALESCE(s.deleted_at, s.created_at)) >= $${params.length}::timestamptz
          OR EXISTS (SELECT 1 FROM stamps_history h
                      WHERE h.stamp_id = s.id
                        AND h.recorded_at >= $${params.length}::timestamptz))`
      );
    }
    params.push(q.limit, q.offset);
    const r = await client.query(
      `SELECT ${stampColumns('s')}, COALESCE(au.email, s.user_id::text) AS user_email,
              COUNT(*) OVER() AS total
         FROM stamps s
         LEFT JOIN auth_users au ON au.id = s.user_id
        ${whereSql(where)}
        ORDER BY s.occurred_at DESC, s.id
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const { rows, total } = takeTotal(r.rows, q);
    okList(res, rows, q, total);
  })
);

publicStampsRouter.get(
  '/:id',
  requireScope('stamps:read'),
  apiHandler(async (req, res, client) => {
    // Consistent with the list, which hides struck punches unless asked: a
    // caller fetching one by id must not silently get a deleted row and count
    // it. `?include_deleted=true` reaches it, same flag, same meaning.
    const includeDeleted = req.query.include_deleted === 'true';
    const r = await client.query(
      `SELECT ${stampColumns()} FROM stamps
        WHERE id = $1 AND (deleted_at IS NULL OR $2::boolean)`,
      [uuidParam(req, 'id'), includeDeleted]
    );
    if (r.rowCount === 0) throw new NotFoundError('stamp');
    ok(res, r.rows[0]);
  })
);

/** The append-only provenance trail of one punch (migration 059). What a
 *  contested timesheet is argued from. */
publicStampsRouter.get(
  '/:id/history',
  requireScope('stamps:read'),
  apiHandler(async (req, res, client) => {
    const stampId = uuidParam(req, 'id');
    // Deleted punches keep their trail on purpose — that a punch was struck, by
    // whom and why, is the part of the record a dispute turns on.
    const exists = await client.query(`SELECT 1 FROM stamps WHERE id = $1`, [stampId]);
    if (exists.rowCount === 0) throw new NotFoundError('stamp');
    const history = await loadStampHistory(client, stampId);
    ok(res, history);
  })
);

// ---- POST / — file a punch --------------------------------------------------
//
// `source` is fixed to 'api' rather than taken from the body: how a punch
// arrived is a fact about the system, not a field a caller gets to assert, and
// the Rettifiche sheet and the contestation dossier both read it as one.
const CreateBody = z.object({
  user_id: z.string().uuid(),
  event_type: z.enum(EVENT_TYPES),
  occurred_at: z.string().datetime({ offset: true }),
  branch_id: z.string().uuid().nullable().optional(),
  notes: z.string().max(500).optional(),
  /** Why this punch exists. Required for the same reason the admin form
   *  requires it: an inserted punch that nobody can explain is the one an
   *  employee contests. The badge reader's answer is "badge 0042 at gate 2". */
  reason: z.string().min(3).max(500),
});

publicStampsRouter.post(
  '/',
  requireScope('stamps:write'),
  // Optional, and the only endpoint on this API that takes it. A badge reader
  // whose request times out has no way to know whether the punch landed, and a
  // duplicate clock-in is not something the employee can see or undo. Send the
  // same Idempotency-Key on the retry and the original answer comes back
  // instead of a second punch.
  apiIdempotency('api_stamp_create'),
  apiHandler(async (req, res, client) => {
    const b = parseBody(CreateBody, req);
    const member = await client.query(
      `SELECT 1 FROM memberships
        WHERE tenant_id = current_setting('app.current_tenant_id')::uuid
          AND user_id = $1 AND deleted_at IS NULL`,
      [b.user_id]
    );
    if (member.rowCount === 0) throw new NotFoundError('user not in company');
    await client.query(`SELECT set_config('app.change_reason', $1, true)`, [
      `api:${b.reason}`,
    ]);
    const ins = await client.query(
      `INSERT INTO stamps (tenant_id, user_id, event_type, occurred_at, source, branch_id, notes)
       VALUES (current_setting('app.current_tenant_id')::uuid, $1, $2, $3, 'api', $4, $5)
       RETURNING ${stampColumns()}`,
      [b.user_id, b.event_type, b.occurred_at, b.branch_id ?? null, b.notes ?? null]
    );
    await emitAuditAndOutbox(
      client,
      req.apiKey!.tenantId,
      'stamp.admin_create',
      ins.rows[0].id,
      ins.rows[0].user_id,
      null,
      ins.rows[0],
      req
    );
    ok(res, ins.rows[0], 201);
  })
);

const UpdateBody = z.object({
  event_type: z.enum(EVENT_TYPES).optional(),
  occurred_at: z.string().datetime({ offset: true }).optional(),
  branch_id: z.string().uuid().nullable().optional(),
  notes: z.string().max(500).optional(),
  reason: z.string().min(3).max(500),
});

publicStampsRouter.patch(
  '/:id',
  requireScope('stamps:write'),
  apiHandler(async (req, res, client) => {
    const b = parseBody(UpdateBody, req);
    const id = uuidParam(req, 'id');
    const before = await client.query(
      `SELECT ${stampColumns()} FROM stamps WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (before.rowCount === 0) throw new NotFoundError('stamp');

    const set: string[] = [];
    const params: unknown[] = [];
    for (const [k, v] of Object.entries(b)) {
      if (k === 'reason' || v === undefined) continue;
      params.push(v);
      set.push(`${k} = $${params.length}`);
    }
    if (set.length === 0) return ok(res, before.rows[0]);
    params.push(id);
    // The provenance trigger (059) reads this GUC to record WHY the punch moved.
    await client.query(`SELECT set_config('app.change_reason', $1, true)`, [
      `api_edit:${b.reason}`,
    ]);
    const r = await client.query(
      `UPDATE stamps SET ${set.join(', ')} WHERE id = $${params.length} RETURNING ${stampColumns()}`,
      params
    );
    await emitAuditAndOutbox(
      client,
      req.apiKey!.tenantId,
      'stamp.admin_update',
      id,
      before.rows[0].user_id,
      before.rows[0],
      r.rows[0],
      req
    );
    ok(res, r.rows[0]);
  })
);

const DeleteBody = z.object({ reason: z.string().min(3).max(500) });

/** Soft delete, exactly like the admin path: the row stays, flagged, so the
 *  Rettifiche sheet and the day dossier can still show that it was struck. */
publicStampsRouter.delete(
  '/:id',
  requireScope('stamps:write'),
  apiHandler(async (req, res, client) => {
    const b = parseBody(DeleteBody, req);
    const id = uuidParam(req, 'id');
    const before = await client.query(
      `SELECT ${stampColumns()} FROM stamps WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (before.rowCount === 0) throw new NotFoundError('stamp');
    await client.query(`SELECT set_config('app.change_reason', $1, true)`, [
      `api_delete:${b.reason}`,
    ]);
    const r = await client.query(
      `UPDATE stamps
          SET deleted_at = now(),
              deleted_by_user_id = current_setting('app.current_user_id')::uuid,
              deletion_reason = $2
        WHERE id = $1
      RETURNING ${stampColumns()}`,
      [id, b.reason]
    );
    await emitAuditAndOutbox(
      client,
      req.apiKey!.tenantId,
      'stamp.admin_delete',
      id,
      before.rows[0].user_id,
      before.rows[0],
      r.rows[0],
      req
    );
    ok(res, { id, deleted: true });
  })
);
