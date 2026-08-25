import { Router } from 'express';
import { z } from 'zod';
import { apiHandler } from '../../lib/route-helpers.js';
import { requireScope } from '../../middleware/api-key.js';
import { ok } from '../../lib/api-response.js';
import { NotFoundError } from '../../errors/index.js';
import {
  DateOnly,
  PageQuery,
  okList,
  parseQuery,
  takeTotal,
  uuidParam,
  whereSql,
} from './helpers.js';

/**
 * Cantieri — site activity, when the customer also has that module.
 *
 * Double-gated: `requireScope('cantieri:*')` refuses unless BOTH the key holds
 * the scope and `tenants.cantieri_enabled` is true (see middleware/api-key.ts).
 * A company that never bought Cantieri cannot reach these paths even with the
 * scope ticked.
 *
 * Read-only, and by construction rather than by choice: a site entry may only
 * be filed by a user assigned to that site, and migration 054's INSERT policy
 * re-checks the assignment in the database precisely so an API bug cannot get
 * round it. A key is assigned to nothing. What an integration wants here anyway
 * is the other direction — the month's activity, out, into a cost model.
 */
export const publicCantieriRouter = Router();

publicCantieriRouter.get(
  '/sites',
  requireScope('cantieri:read'),
  apiHandler(async (req, res, client) => {
    const q = parseQuery(
      PageQuery.extend({ status: z.enum(['open', 'closed']).optional() }),
      req
    );
    const where = ['deleted_at IS NULL'];
    const params: unknown[] = [];
    if (q.status) {
      params.push(q.status);
      where.push(`status = $${params.length}`);
    }
    params.push(q.limit, q.offset);
    const r = await client.query(
      `SELECT id, name, address, status, created_at, updated_at,
              COUNT(*) OVER() AS total
         FROM cantieri ${whereSql(where)}
        ORDER BY status, name, id
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const { rows, total } = takeTotal(r.rows, q);
    okList(res, rows, q, total);
  })
);

publicCantieriRouter.get(
  '/vehicles',
  requireScope('cantieri:read'),
  apiHandler(async (req, res, client) => {
    const q = parseQuery(PageQuery, req);
    const r = await client.query(
      `SELECT id, name, custom_values, created_at, COUNT(*) OVER() AS total
         FROM mezzi WHERE deleted_at IS NULL
        ORDER BY name, id LIMIT $1 OFFSET $2`,
      [q.limit, q.offset]
    );
    const { rows, total } = takeTotal(r.rows, q);
    okList(res, rows, q, total);
  })
);

/** The tenant-wide custom field definitions, so a caller can make sense of the
 *  `custom_values` maps on entries and vehicles instead of guessing at keys. */
publicCantieriRouter.get(
  '/fields',
  requireScope('cantieri:read'),
  apiHandler(async (_req, res, client) => {
    const r = await client.query(
      `SELECT id, scope, key, label, field_type, options, required, position
         FROM cantieri_field_defs
        WHERE deleted_at IS NULL
        ORDER BY scope, position, label`
    );
    ok(res, r.rows);
  })
);

publicCantieriRouter.get(
  '/entries',
  requireScope('cantieri:read'),
  apiHandler(async (req, res, client) => {
    const q = parseQuery(
      PageQuery.extend({
        cantiere_id: z.string().uuid().optional(),
        user_id: z.string().uuid().optional(),
        from: DateOnly.optional(),
        to: DateOnly.optional(),
      }),
      req
    );
    const where = ['e.deleted_at IS NULL'];
    const params: unknown[] = [];
    if (q.cantiere_id) {
      params.push(q.cantiere_id);
      where.push(`e.cantiere_id = $${params.length}`);
    }
    if (q.user_id) {
      params.push(q.user_id);
      where.push(`e.user_id = $${params.length}`);
    }
    // entry_date is already a tenant-local calendar day (times on the row are
    // Europe/Rome wall clock), so these are plain date comparisons — no zone
    // conversion, unlike the punch filters.
    if (q.from) {
      params.push(q.from);
      where.push(`e.entry_date >= $${params.length}::date`);
    }
    if (q.to) {
      params.push(q.to);
      where.push(`e.entry_date <= $${params.length}::date`);
    }
    params.push(q.limit, q.offset);
    const r = await client.query(
      `SELECT e.id, e.cantiere_id, c.name AS cantiere_name, e.user_id,
              COALESCE(au.email, e.user_id::text) AS user_email,
              e.entry_date,
              to_char(e.travel_start,   'HH24:MI') AS travel_start,
              to_char(e.travel_end,     'HH24:MI') AS travel_end,
              to_char(e.activity_start, 'HH24:MI') AS activity_start,
              to_char(e.activity_end,   'HH24:MI') AS activity_end,
              e.activity_text,
              e.mezzo_id, m.name AS mezzo_name, e.custom_values, e.created_at,
              COUNT(*) OVER() AS total
         FROM cantiere_entries e
         LEFT JOIN cantieri c ON c.id = e.cantiere_id
         LEFT JOIN mezzi m ON m.id = e.mezzo_id
         LEFT JOIN auth_users au ON au.id = e.user_id
        ${whereSql(where)}
        ORDER BY e.entry_date DESC, e.created_at DESC, e.id
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const { rows, total } = takeTotal(r.rows, q);
    okList(res, rows, q, total);
  })
);

publicCantieriRouter.get(
  '/entries/:id',
  requireScope('cantieri:read'),
  apiHandler(async (req, res, client) => {
    const r = await client.query(
      `SELECT e.id, e.cantiere_id, c.name AS cantiere_name, e.user_id,
              e.entry_date,
              to_char(e.travel_start,   'HH24:MI') AS travel_start,
              to_char(e.travel_end,     'HH24:MI') AS travel_end,
              to_char(e.activity_start, 'HH24:MI') AS activity_start,
              to_char(e.activity_end,   'HH24:MI') AS activity_end,
              e.activity_text,
              e.mezzo_id, e.custom_values, e.created_at
         FROM cantiere_entries e
         LEFT JOIN cantieri c ON c.id = e.cantiere_id
        WHERE e.id = $1 AND e.deleted_at IS NULL`,
      [uuidParam(req, 'id')]
    );
    if (r.rowCount === 0) throw new NotFoundError('cantiere entry');
    ok(res, r.rows[0]);
  })
);
