import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { asyncHandler, tenantHandler } from '../lib/route-helpers.js';
import { adminPool } from '../lib/admin-db.js';
import { ok } from '../lib/api-response.js';
import { NotFoundError, ValidationError } from '../errors/index.js';
import { logAuditAs } from '../lib/audit.js';
import { sanitizeBulletinHtml } from '../lib/bulletin-sanitize.js';
import { notifyBulletin } from '../lib/notifications.js';
import { createLogger } from '../lib/logger.js';
import { BULLETIN_TITLE_MAX, BULLETIN_BODY_MAX } from '@sonoqui/shared';

const logger = createLogger('bulletins');

export const bulletinsRouter = Router();
bulletinsRouter.use(authenticate);

const isoOpt = z.string().datetime({ offset: true }).nullable().optional();

const CreateBulletin = z
  .object({
    title: z.string().trim().min(1).max(BULLETIN_TITLE_MAX),
    body_html: z.string().min(1).max(BULLETIN_BODY_MAX),
    target_all: z.boolean().default(true),
    user_ids: z.array(z.string().uuid()).default([]),
    start_at: isoOpt,
    end_at: isoOpt,
    notify_email: z.boolean().default(true),
    notify_push: z.boolean().default(true),
  })
  .refine((d) => d.target_all || d.user_ids.length > 0, {
    message: 'select at least one recipient',
    path: ['user_ids'],
  })
  .refine((d) => !(d.start_at && d.end_at) || new Date(d.end_at) > new Date(d.start_at), {
    message: 'end_at must be after start_at',
    path: ['end_at'],
  });

const PatchBulletin = CreateBulletin;

// Resolve the active members a bulletin currently addresses. For target_all this
// is every active member (so future joiners are included live); otherwise it is
// the intersection of the explicit targets with active membership.
async function resolveRecipientIds(
  client: import('pg').PoolClient,
  tenantId: string,
  targetAll: boolean,
  userIds: string[]
): Promise<string[]> {
  if (targetAll) {
    const r = await client.query(
      `SELECT user_id FROM memberships
        WHERE tenant_id = $1 AND active = TRUE AND deleted_at IS NULL`,
      [tenantId]
    );
    return r.rows.map((row) => row.user_id as string);
  }
  const r = await client.query(
    `SELECT user_id FROM memberships
      WHERE tenant_id = $1 AND active = TRUE AND deleted_at IS NULL
        AND user_id = ANY($2::uuid[])`,
    [tenantId, userIds]
  );
  return r.rows.map((row) => row.user_id as string);
}

function liveNow(startAt: string | null): boolean {
  return !startAt || new Date(startAt) <= new Date();
}

// Small audit snapshot: title + targeting + window, NEVER the HTML body.
function bulletinSummary(
  row: { title: string; target_all: boolean; start_at: string | Date | null; end_at: string | Date | null },
  userCount?: number
): Record<string, unknown> {
  return {
    title: row.title,
    target_all: row.target_all,
    ...(row.target_all ? {} : { user_count: userCount ?? null }),
    start_at: row.start_at,
    end_at: row.end_at,
  };
}

/* ===================== Member surface (everyone) ===================== */

/* ----- GET /api/v1/bulletins/me — live messages addressed to me + my read state ----- */
bulletinsRouter.get(
  '/me',
  tenantHandler(async (req, res, client) => {
    // RLS (bulletins_select) already restricts to live + addressed-to-me rows;
    // the window predicate is repeated for clarity. read flag from my own receipt.
    const r = await client.query(
      `SELECT b.id, b.title, b.body_html, b.start_at, b.end_at, b.created_at,
              (br.user_id IS NOT NULL) AS read,
              br.read_at
         FROM bulletins b
         LEFT JOIN bulletin_reads br
                ON br.bulletin_id = b.id AND br.user_id = $1
        WHERE b.deleted_at IS NULL
          AND (b.start_at IS NULL OR b.start_at <= now())
          AND (b.end_at IS NULL OR b.end_at > now())
        ORDER BY b.created_at DESC
        LIMIT 500`,
      [req.user!.id]
    );
    ok(res, r.rows);
  })
);

/* ----- POST /api/v1/bulletins/:id/read — mark a message read ----- */
bulletinsRouter.post(
  '/:id/read',
  tenantHandler(async (req, res, client) => {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) throw new ValidationError('invalid id');
    // Only a message visible to the caller (RLS) can be marked read.
    const vis = await client.query(`SELECT 1 FROM bulletins WHERE id = $1`, [id.data]);
    if (vis.rowCount === 0) throw new NotFoundError('bulletin');
    await client.query(
      `INSERT INTO bulletin_reads(tenant_id, bulletin_id, user_id)
       VALUES (current_setting('app.current_tenant_id')::uuid, $1,
               current_setting('app.current_user_id')::uuid)
       ON CONFLICT (bulletin_id, user_id) DO NOTHING`,
      [id.data]
    );
    ok(res, { read: true });
  })
);

/* ===================== Admin management (service role) ===================== */

/* ----- GET /api/v1/bulletins/recipients — destination-user picker ----- */
bulletinsRouter.get(
  '/recipients',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const r = await adminPool.query(
      `SELECT m.user_id,
              au.email,
              COALESCE(
                NULLIF(au.display_name, ''),
                NULLIF(TRIM(CONCAT_WS(' ', au.first_name, au.last_name)), ''),
                au.email
              ) AS display_name,
              m.active
         FROM memberships m
         LEFT JOIN auth_users au ON au.id = m.user_id
        WHERE m.tenant_id = $1 AND m.deleted_at IS NULL AND m.active = TRUE
        ORDER BY COALESCE(NULLIF(au.display_name, ''), au.email) ASC`,
      [req.user!.tenantId]
    );
    ok(res, r.rows);
  })
);

/* ----- GET /api/v1/bulletins — admin list (all incl. drafts/expired) + counts ----- */
bulletinsRouter.get(
  '/',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const r = await adminPool.query(
      `SELECT b.*,
              COALESCE(rc.read_count, 0)::int AS read_count,
              CASE WHEN b.target_all THEN (
                     SELECT COUNT(*)::int FROM memberships m
                      WHERE m.tenant_id = b.tenant_id AND m.active = TRUE AND m.deleted_at IS NULL
                   )
                   ELSE (
                     SELECT COUNT(*)::int FROM bulletin_targets t WHERE t.bulletin_id = b.id
                   )
              END AS recipient_count
         FROM bulletins b
         LEFT JOIN (
           SELECT bulletin_id, COUNT(*)::int AS read_count
             FROM bulletin_reads GROUP BY bulletin_id
         ) rc ON rc.bulletin_id = b.id
        WHERE b.tenant_id = $1 AND b.deleted_at IS NULL
        ORDER BY b.created_at DESC
        LIMIT 1000`,
      [req.user!.tenantId]
    );
    ok(res, r.rows);
  })
);

/* ----- GET /api/v1/bulletins/:id/reads — who read (+ full recipient list) ----- */
bulletinsRouter.get(
  '/:id/reads',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) throw new ValidationError('invalid id');
    const b = await adminPool.query(
      `SELECT id, target_all FROM bulletins
        WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [id.data, req.user!.tenantId]
    );
    if (b.rowCount === 0) throw new NotFoundError('bulletin');

    // Resolve the current recipient set (active members or explicit targets),
    // left-joined to their read receipts — so the admin sees read AND not-yet-read.
    const memberFilter = b.rows[0].target_all
      ? 'm.active = TRUE AND m.deleted_at IS NULL'
      : 'EXISTS (SELECT 1 FROM bulletin_targets t WHERE t.bulletin_id = $2 AND t.user_id = m.user_id)';
    const r = await adminPool.query(
      `SELECT m.user_id,
              au.email,
              COALESCE(
                NULLIF(au.display_name, ''),
                NULLIF(TRIM(CONCAT_WS(' ', au.first_name, au.last_name)), ''),
                au.email
              ) AS display_name,
              br.read_at
         FROM memberships m
         LEFT JOIN auth_users au ON au.id = m.user_id
         LEFT JOIN bulletin_reads br ON br.bulletin_id = $2 AND br.user_id = m.user_id
        WHERE m.tenant_id = $1 AND ${memberFilter}
        ORDER BY (br.read_at IS NULL),
                 COALESCE(NULLIF(au.display_name, ''), au.email) ASC`,
      [req.user!.tenantId, id.data]
    );
    ok(res, r.rows);
  })
);

/* ----- POST /api/v1/bulletins — create + publish ----- */
bulletinsRouter.post(
  '/',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const parsed = CreateBulletin.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('invalid body', parsed.error.flatten());
    const d = parsed.data;
    const safeHtml = sanitizeBulletinHtml(d.body_html);
    if (!safeHtml) throw new ValidationError('message body is empty after sanitization');

    const tenantId = req.user!.tenantId;
    const actorId = req.user!.id;

    const client = await adminPool.connect();
    let bulletin;
    let recipientIds: string[] = [];
    try {
      await client.query('BEGIN');
      const ins = await client.query(
        `INSERT INTO bulletins(
           tenant_id, title, body_html, target_all, start_at, end_at,
           notify_email, notify_push, created_by
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          tenantId,
          d.title,
          safeHtml,
          d.target_all,
          d.start_at ?? null,
          d.end_at ?? null,
          d.notify_email,
          d.notify_push,
          actorId,
        ]
      );
      bulletin = ins.rows[0];

      recipientIds = await resolveRecipientIds(client, tenantId, d.target_all, d.user_ids);
      if (!d.target_all) {
        if (recipientIds.length === 0) throw new ValidationError('no valid recipients');
        await client.query(
          `INSERT INTO bulletin_targets(tenant_id, bulletin_id, user_id)
           SELECT $1, $2, x FROM unnest($3::uuid[]) AS x
           ON CONFLICT (bulletin_id, user_id) DO NOTHING`,
          [tenantId, bulletin.id, recipientIds]
        );
      }

      // Notify inline only when the message is live now. Future-scheduled posts
      // are left with notified_at = NULL for the activation cron to pick up when
      // start_at passes (so the alert never arrives before the message is visible).
      const willNotifyNow =
        liveNow(bulletin.start_at) && (d.notify_email || d.notify_push);
      if (willNotifyNow) {
        await client.query(`UPDATE bulletins SET notified_at = now() WHERE id = $1`, [bulletin.id]);
      }

      await logAuditAs(client, tenantId, actorId, {
        action: 'bulletin.create',
        resourceType: 'bulletin',
        resourceId: bulletin.id,
        targetLabel: bulletin.title,
        after: bulletinSummary(bulletin, recipientIds.length),
        req,
      });
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    if (liveNow(bulletin.start_at) && (d.notify_email || d.notify_push)) {
      // Fire-and-forget: a notification failure must never fail the publish.
      notifyBulletin(tenantId, recipientIds, {
        bulletinId: bulletin.id,
        title: bulletin.title,
        bodyHtml: bulletin.body_html,
        notifyEmail: bulletin.notify_email,
        notifyPush: bulletin.notify_push,
      }).catch((err) => logger.error({ err, bulletin_id: bulletin.id }, 'notify bulletin failed'));
    }

    ok(res, bulletin, 201);
  })
);

/* ----- PATCH /api/v1/bulletins/:id — edit (keeps read receipts, no re-notify) ----- */
bulletinsRouter.patch(
  '/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) throw new ValidationError('invalid id');
    const parsed = PatchBulletin.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('invalid body', parsed.error.flatten());
    const d = parsed.data;
    const safeHtml = sanitizeBulletinHtml(d.body_html);
    if (!safeHtml) throw new ValidationError('message body is empty after sanitization');

    const tenantId = req.user!.tenantId;
    const actorId = req.user!.id;

    const client = await adminPool.connect();
    let bulletin;
    try {
      await client.query('BEGIN');
      const before = await client.query(
        `SELECT * FROM bulletins WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
        [id.data, tenantId]
      );
      if (before.rowCount === 0) throw new NotFoundError('bulletin');

      const upd = await client.query(
        `UPDATE bulletins
            SET title = $3, body_html = $4, target_all = $5,
                start_at = $6, end_at = $7,
                notify_email = $8, notify_push = $9, updated_at = now()
          WHERE id = $1 AND tenant_id = $2
          RETURNING *`,
        [
          id.data,
          tenantId,
          d.title,
          safeHtml,
          d.target_all,
          d.start_at ?? null,
          d.end_at ?? null,
          d.notify_email,
          d.notify_push,
        ]
      );
      bulletin = upd.rows[0];

      // Re-sync the explicit target set. Read receipts are deliberately
      // preserved across edits (no DELETE on bulletin_reads).
      await client.query(`DELETE FROM bulletin_targets WHERE bulletin_id = $1`, [id.data]);
      let recipientCount = 0;
      if (!d.target_all) {
        const recipientIds = await resolveRecipientIds(client, tenantId, false, d.user_ids);
        if (recipientIds.length === 0) throw new ValidationError('no valid recipients');
        await client.query(
          `INSERT INTO bulletin_targets(tenant_id, bulletin_id, user_id)
           SELECT $1, $2, x FROM unnest($3::uuid[]) AS x
           ON CONFLICT (bulletin_id, user_id) DO NOTHING`,
          [tenantId, id.data, recipientIds]
        );
        recipientCount = recipientIds.length;
      }

      await logAuditAs(client, tenantId, actorId, {
        action: 'bulletin.update',
        resourceType: 'bulletin',
        resourceId: id.data,
        targetLabel: bulletin.title,
        before: bulletinSummary(before.rows[0]),
        after: bulletinSummary(bulletin, recipientCount),
        req,
      });
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    ok(res, bulletin);
  })
);

/* ----- DELETE /api/v1/bulletins/:id — soft-delete ----- */
bulletinsRouter.delete(
  '/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) throw new ValidationError('invalid id');
    const r = await adminPool.query(
      `UPDATE bulletins SET deleted_at = now()
        WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
        RETURNING id, title, target_all, start_at, end_at`,
      [id.data, req.user!.tenantId]
    );
    if (r.rowCount === 0) throw new NotFoundError('bulletin');
    await logAuditAs(adminPool, req.user!.tenantId, req.user!.id, {
      action: 'bulletin.delete',
      resourceType: 'bulletin',
      resourceId: id.data,
      targetLabel: r.rows[0].title,
      before: bulletinSummary(r.rows[0]),
      req,
    }).catch((err) => logger.error({ err, id: id.data }, 'bulletin delete audit failed'));
    ok(res, { id: id.data });
  })
);
