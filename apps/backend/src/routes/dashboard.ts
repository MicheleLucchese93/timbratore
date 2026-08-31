import { Router } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { tenantHandler } from '../lib/route-helpers.js';
import { ok } from '../lib/api-response.js';
import { loadAnomalies, type Anomaly } from './shifts.js';
import { addIsoDays, tenantToday } from '../lib/tz.js';

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
                WHEN ls.event_type IN ('clock_in','break_end','lunch_end') THEN 'clocked_in'
                WHEN ls.event_type = 'break_start' THEN 'on_break'
                WHEN ls.event_type = 'lunch_start' THEN 'on_lunch'
                ELSE 'nothing'
              END AS state
       FROM memberships m
       LEFT JOIN auth_users au ON au.id = m.user_id
       LEFT JOIN last_stamp ls ON ls.user_id = m.user_id
       LEFT JOIN branches b ON b.id = ls.branch_id
       WHERE m.active AND m.deleted_at IS NULL
         AND cardinality(m.stamp_modes) > 0
       ORDER BY m.role DESC, email`
    );
    ok(res, r.rows);
  })
);

dashboardRouter.get(
  '/summary',
  tenantHandler(async (_req, res, client) => {
    // Every query below runs on the SAME pooled client, inside the per-request
    // RLS transaction opened by tenantHandler. A client can only execute one
    // query at a time — issuing them together and awaiting with Promise.all
    // buys no parallelism (pg queues them) and is deprecated as of pg@8, a hard
    // error in pg@9. Sequential awaits, same wall-clock, no warning. A second
    // pooled client is not an option here: it would miss this transaction's RLS
    // GUCs and, for support sessions, its READ ONLY mode.

    const u = await client.query(
      `SELECT
         (SELECT COUNT(*) FROM memberships
            WHERE tenant_id = current_setting('app.current_tenant_id')::uuid
              AND deleted_at IS NULL) AS active_users,
         (SELECT COUNT(*) FROM memberships
            WHERE tenant_id = current_setting('app.current_tenant_id')::uuid
              AND role='admin' AND deleted_at IS NULL) AS active_admins,
         (SELECT max_users FROM tenants WHERE id = current_setting('app.current_tenant_id')::uuid) AS max_users,
         (SELECT max_admins FROM tenants WHERE id = current_setting('app.current_tenant_id')::uuid) AS max_admins,
         (SELECT max_branches FROM tenants WHERE id = current_setting('app.current_tenant_id')::uuid) AS max_branches,
         (SELECT COUNT(*) FROM branches
            WHERE tenant_id = current_setting('app.current_tenant_id')::uuid
              AND deleted_at IS NULL) AS branches_count`
    );

    const p = await client.query(
      `WITH last_stamp AS (
         SELECT DISTINCT ON (user_id) user_id, event_type
         FROM stamps
         WHERE deleted_at IS NULL
         ORDER BY user_id, occurred_at DESC, created_at DESC
       )
       SELECT
         COUNT(*) FILTER (WHERE ls.event_type IN ('clock_in','break_end','lunch_end')) AS clocked_in,
         COUNT(*) FILTER (WHERE ls.event_type = 'break_start') AS on_break,
         COUNT(*) FILTER (WHERE ls.event_type = 'lunch_start') AS on_lunch,
         COUNT(*) FILTER (WHERE ls.event_type IS NULL OR ls.event_type = 'clock_out') AS off
       FROM memberships m
       LEFT JOIN last_stamp ls ON ls.user_id = m.user_id
       WHERE m.active AND m.deleted_at IS NULL
         AND cardinality(m.stamp_modes) > 0`
    );

    const pen = await client.query(
      `SELECT
         (SELECT COUNT(*) FROM correction_requests
            WHERE status = 'pending') AS corrections,
         (SELECT COUNT(*) FROM leave_requests
            WHERE status = 'pending') AS leaves,
         (SELECT COUNT(*) FROM leave_requests
            WHERE status = 'cancellation_pending') AS leave_cancellations`
    );

    // Absent right now: approved leaves where now() is inside [from_ts, to_ts).
    const absent = await client.query(
      `SELECT lr.id, lr.user_id, lr.type, lr.from_ts, lr.to_ts, lr.duration_hours,
              COALESCE(au.email, lr.user_id::text) AS user_email,
              au.display_name AS user_display_name
         FROM leave_requests lr
         LEFT JOIN auth_users au ON au.id = lr.user_id
        WHERE lr.status = 'approved'
          AND lr.from_ts <= now()
          AND lr.to_ts   >  now()
        ORDER BY lr.to_ts ASC
        LIMIT 50`
    );

    // Upcoming approved leaves in next 14 days.
    const upcoming = await client.query(
      `SELECT lr.id, lr.user_id, lr.type, lr.from_ts, lr.to_ts, lr.duration_hours,
              COALESCE(au.email, lr.user_id::text) AS user_email,
              au.display_name AS user_display_name
         FROM leave_requests lr
         LEFT JOIN auth_users au ON au.id = lr.user_id
        WHERE lr.status = 'approved'
          AND lr.from_ts >  now()
          AND lr.from_ts <= now() + INTERVAL '14 days'
        ORDER BY lr.from_ts ASC
        LIMIT 20`
    );

    // Anomalies last 7 full days (yesterday inclusive — today still in progress),
    // via the same loader GET /shifts/anomalies and the public API use.
    //
    // This used to be a hand-copied second copy of that query, and it had
    // drifted: it never selected `break_enabled` (so pausa-disabled templates
    // still raised break_too_short/_too_long here but not on the Anomalie
    // page), never selected `out_of_geofence` (so clock_out_out_of_area was
    // permanently 0), and bucketed punches with a bare `::timestamptz`, which
    // resolves against the server clock — the tenant-zone bug already fixed in
    // the original. One copy is the only way that stops recurring.
    //
    // `stamping_only` keeps this card's long-standing scope: employees with
    // stamping switched off would otherwise raise missing_clock_in every day.
    const today = await tenantToday(client);
    const anomalies = await loadAnomalies(client, {
      from: addIsoDays(today, -7),
      to: addIsoDays(today, -1),
      stamping_only: true,
    });
    const byKind: Record<Anomaly['kind'], number> = {
      missing_clock_in: 0,
      missing_clock_out: 0,
      late_clock_in: 0,
      early_clock_out: 0,
      short_hours: 0,
      worked_on_rest_day: 0,
      break_too_short: 0,
      break_too_long: 0,
      lunch_too_short: 0,
      lunch_too_long: 0,
      lunch_outside_window: 0,
      clock_out_out_of_area: 0,
    };
    for (const a of anomalies) byKind[a.kind]++;
    const recentAnomalies = anomalies
      .slice()
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
      .slice(0, 5);

    ok(res, {
      usage: u.rows[0],
      presence: p.rows[0],
      pending: pen.rows[0],
      absent_now: absent.rows,
      upcoming_leaves: upcoming.rows,
      anomalies_7d: {
        total: anomalies.length,
        by_kind: byKind,
        recent: recentAnomalies,
      },
    });
  })
);
