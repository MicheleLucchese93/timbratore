import { Router } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { tenantHandler } from '../lib/route-helpers.js';
import { ok } from '../lib/api-response.js';

export const dashboardRouter = Router();
dashboardRouter.use(authenticate);
dashboardRouter.use(requireAdmin);

dashboardRouter.get(
  '/cards',
  tenantHandler(async (_req, res, client) => {
    const r = await client.query(
      `WITH last_stamp AS (
         SELECT DISTINCT ON (user_id)
           user_id, event_type, occurred_at, branch_id
         FROM stamps
         WHERE deleted_at IS NULL
         ORDER BY user_id, occurred_at DESC, created_at DESC
       )
       SELECT m.user_id,
              COALESCE(au.email, m.user_id::text) AS email,
              m.role,
              ls.event_type AS last_event,
              ls.occurred_at AS last_event_at,
              b.name AS branch_name,
              CASE
                WHEN ls.event_type IN ('clock_in','break_end') THEN 'clocked_in'
                WHEN ls.event_type = 'break_start' THEN 'on_break'
                ELSE 'nothing'
              END AS state
       FROM memberships m
       LEFT JOIN auth_users au ON au.id = m.user_id
       LEFT JOIN last_stamp ls ON ls.user_id = m.user_id
       LEFT JOIN branches b ON b.id = ls.branch_id
       WHERE m.active AND m.deleted_at IS NULL
       ORDER BY m.role DESC, email`
    );
    ok(res, r.rows);
  })
);
