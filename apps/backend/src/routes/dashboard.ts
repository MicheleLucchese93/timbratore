import { Router } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { tenantHandler } from '../lib/route-helpers.js';
import { ok } from '../lib/api-response.js';
import { computeAnomalies, type AnomalyRow, type Anomaly } from './shifts.js';

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
       ORDER BY m.role DESC, email`
    );
    ok(res, r.rows);
  })
);

dashboardRouter.get(
  '/summary',
  tenantHandler(async (_req, res, client) => {
    const usagePromise = client.query(
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

    const presencePromise = client.query(
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
       WHERE m.active AND m.deleted_at IS NULL`
    );

    const pendingPromise = client.query(
      `SELECT
         (SELECT COUNT(*) FROM correction_requests
            WHERE status = 'pending') AS corrections,
         (SELECT COUNT(*) FROM leave_requests
            WHERE status = 'pending') AS leaves,
         (SELECT COUNT(*) FROM leave_requests
            WHERE status = 'cancellation_pending') AS leave_cancellations`
    );

    // Absent right now: approved leaves where now() is inside [from_ts, to_ts).
    const absentNowPromise = client.query(
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
    const upcomingPromise = client.query(
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

    // Anomalies last 7 full days (yesterday inclusive — today still in progress).
    const anomaliesPromise = client.query<AnomalyRow>(
      `WITH range AS (
         SELECT generate_series(
           (now()::date - INTERVAL '7 days')::date,
           (now()::date - INTERVAL '1 day')::date,
           INTERVAL '1 day'
         )::date AS d
       ),
       memb AS (
         SELECT m.user_id, COALESCE(au.email, m.user_id::text) AS email,
                au.display_name
           FROM memberships m
           LEFT JOIN auth_users au ON au.id = m.user_id
          WHERE m.deleted_at IS NULL AND m.active = TRUE
       )
       SELECT r.d AS day,
              m.user_id, m.email, m.display_name,
              a.shift_template_id, st.name AS template_name,
              st.tolerance_in_min, st.tolerance_out_min,
              st.expected_break_min_min, st.expected_break_max_min,
              st.expected_lunch_min_min, st.expected_lunch_max_min,
              COALESCE(
                (SELECT json_agg(json_build_object(
                  'day_of_week', sl.day_of_week,
                  'start_time', to_char(sl.start_time, 'HH24:MI'),
                  'end_time', to_char(sl.end_time, 'HH24:MI')
                ) ORDER BY sl.day_of_week, sl.start_time)
                 FROM shift_template_slots sl
                WHERE sl.shift_template_id = a.shift_template_id),
                '[]'::json
              ) AS slots,
              COALESCE(
                (SELECT json_agg(json_build_object(
                  'event_type', s.event_type,
                  'occurred_at', s.occurred_at
                ) ORDER BY s.occurred_at)
                 FROM stamps s
                WHERE s.user_id = m.user_id
                  AND s.deleted_at IS NULL
                  AND s.occurred_at >= r.d::timestamptz
                  AND s.occurred_at <  (r.d + INTERVAL '1 day')::timestamptz),
                '[]'::json
              ) AS stamps,
              COALESCE(
                (SELECT json_agg(json_build_object(
                  'type', lr.type,
                  'from_ts', lr.from_ts,
                  'to_ts', lr.to_ts
                ))
                 FROM leave_requests lr
                WHERE lr.user_id = m.user_id
                  AND lr.status = 'approved'
                  AND lr.from_ts <  (r.d + INTERVAL '1 day')::timestamptz
                  AND lr.to_ts   >   r.d::timestamptz),
                '[]'::json
              ) AS leaves
         FROM range r
         CROSS JOIN memb m
         LEFT JOIN user_shift_assignments a
           ON a.user_id = m.user_id
          AND a.valid_from <= r.d
          AND (a.valid_to IS NULL OR a.valid_to >= r.d)
         LEFT JOIN shift_templates st ON st.id = a.shift_template_id
        ORDER BY r.d, m.email`
    );

    const [u, p, pen, absent, upcoming, anomalyRows] = await Promise.all([
      usagePromise,
      presencePromise,
      pendingPromise,
      absentNowPromise,
      upcomingPromise,
      anomaliesPromise,
    ]);

    const anomalies = computeAnomalies(anomalyRows.rows);
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
