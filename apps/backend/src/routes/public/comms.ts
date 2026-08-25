import { Router } from 'express';
import { z } from 'zod';
import { apiHandler } from '../../lib/route-helpers.js';
import { requireScope } from '../../middleware/api-key.js';
import { ok } from '../../lib/api-response.js';
import { NotFoundError } from '../../errors/index.js';
import { PageQuery, okList, parseQuery, takeTotal, uuidParam, whereSql } from './helpers.js';

/**
 * Rettifiche (correction requests) and Bacheca (bulletins), both read-only.
 *
 * See API_READ_ONLY_RESOURCES in @sonoqui/shared for why: settling a disputed
 * punch is a decision with a person's name on it, and posting an announcement
 * mails every employee in the company. What an integration legitimately wants
 * from both is the same thing — the state, so a helpdesk or an intranet can
 * show it without asking anyone to log in twice.
 */
export const publicCorrectionsRouter = Router();

const CORRECTION_COLUMNS = `cr.id, cr.user_id, cr.status, cr.justification,
                            cr.original_stamp_id, cr.claimed_event_type,
                            cr.claimed_occurred_at, cr.claimed_branch_id,
                            cr.resolution_note, cr.resolved_by, cr.resolved_at,
                            cr.created_at,
                            COALESCE(au.email, cr.user_id::text) AS user_email,
                            os.event_type  AS original_event_type,
                            os.occurred_at AS original_occurred_at`;

publicCorrectionsRouter.get(
  '/',
  requireScope('corrections:read'),
  apiHandler(async (req, res, client) => {
    const q = parseQuery(
      PageQuery.extend({
        user_id: z.string().uuid().optional(),
        status: z.enum(['pending', 'approved', 'rejected', 'superseded']).optional(),
      }),
      req
    );
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.user_id) {
      params.push(q.user_id);
      where.push(`cr.user_id = $${params.length}`);
    }
    if (q.status) {
      params.push(q.status);
      where.push(`cr.status = $${params.length}`);
    }
    params.push(q.limit, q.offset);
    const r = await client.query(
      `SELECT ${CORRECTION_COLUMNS}, COUNT(*) OVER() AS total
         FROM correction_requests cr
         LEFT JOIN auth_users au ON au.id = cr.user_id
         LEFT JOIN stamps os ON os.id = cr.original_stamp_id
        ${whereSql(where)}
        ORDER BY cr.created_at DESC, cr.id
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const { rows, total } = takeTotal(r.rows, q);
    okList(res, rows, q, total);
  })
);

publicCorrectionsRouter.get(
  '/:id',
  requireScope('corrections:read'),
  apiHandler(async (req, res, client) => {
    const r = await client.query(
      `SELECT ${CORRECTION_COLUMNS}
         FROM correction_requests cr
         LEFT JOIN auth_users au ON au.id = cr.user_id
         LEFT JOIN stamps os ON os.id = cr.original_stamp_id
        WHERE cr.id = $1`,
      [uuidParam(req, 'id')]
    );
    if (r.rowCount === 0) throw new NotFoundError('correction request');
    ok(res, r.rows[0]);
  })
);

// ── bacheca ────────────────────────────────────────────────────────────────

export const publicBulletinsRouter = Router();

publicBulletinsRouter.get(
  '/',
  requireScope('bulletins:read'),
  apiHandler(async (req, res, client) => {
    const q = parseQuery(
      PageQuery.extend({
        /** Live now, versus the whole archive. Defaults to the archive: a
         *  reporting caller asking "what did we post in March" must not get an
         *  empty answer because those posts have since expired. */
        live: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
      }),
      req
    );
    const where = ['b.deleted_at IS NULL'];
    if (q.live) {
      where.push('(b.start_at IS NULL OR b.start_at <= now())');
      where.push('(b.end_at IS NULL OR b.end_at > now())');
    }
    const params: unknown[] = [q.limit, q.offset];
    const r = await client.query(
      `SELECT b.id, b.title, b.body_html, b.target_all, b.start_at, b.end_at,
              b.notify_email, b.notify_push, b.notified_at, b.created_at,
              (SELECT COUNT(*) FROM bulletin_reads br WHERE br.bulletin_id = b.id)::int
                AS read_count,
              CASE WHEN b.target_all THEN NULL
                   ELSE (SELECT COUNT(*) FROM bulletin_targets bt WHERE bt.bulletin_id = b.id)::int
              END AS target_count,
              COUNT(*) OVER() AS total
         FROM bulletins b
        ${whereSql(where)}
        ORDER BY b.created_at DESC, b.id
        LIMIT $1 OFFSET $2`,
      params
    );
    const { rows, total } = takeTotal(r.rows, q);
    okList(res, rows, q, total);
  })
);

/** Who has opened a given message. The reason bulletins are readable at all:
 *  "has everybody seen the safety notice" is a compliance question, and the
 *  answer belongs in whatever system tracks the rest of that obligation. */
publicBulletinsRouter.get(
  '/:id/reads',
  requireScope('bulletins:read'),
  apiHandler(async (req, res, client) => {
    const bulletinId = uuidParam(req, 'id');
    const exists = await client.query(
      `SELECT 1 FROM bulletins WHERE id = $1 AND deleted_at IS NULL`,
      [bulletinId]
    );
    if (exists.rowCount === 0) throw new NotFoundError('bulletin');
    const r = await client.query(
      `SELECT br.user_id, br.read_at, COALESCE(au.email, br.user_id::text) AS user_email
         FROM bulletin_reads br
         LEFT JOIN auth_users au ON au.id = br.user_id
        WHERE br.bulletin_id = $1
        ORDER BY br.read_at DESC, br.user_id`,
      [bulletinId]
    );
    ok(res, r.rows);
  })
);
