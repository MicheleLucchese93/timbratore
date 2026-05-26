import { pool } from '../../lib/db.js';
import { createLogger } from '../../lib/logger.js';

const logger = createLogger('leave_yearly_rollover');

/**
 * For each prior-year quota assignment, create a current-year row from the same
 * template, carrying forward whatever residual the user had at year-end.
 *
 * Idempotent — UNIQUE(tenant_id, user_id, type, year) means re-runs no-op.
 */
export async function leaveYearlyRollover(): Promise<void> {
  const year = new Date().getFullYear();
  const prevYear = year - 1;

  const r = await pool.query(
    `WITH prev AS (
       SELECT a.tenant_id, a.user_id, a.template_id, a.type,
              a.hours_total + a.hours_carried_in AS total_carryable,
              COALESCE(SUM(CASE WHEN lr.status = 'approved' THEN lr.duration_hours ELSE 0 END), 0)
                AS used_approved
         FROM leave_quota_assignments a
         LEFT JOIN leave_requests lr
           ON lr.user_id = a.user_id
          AND lr.type = a.type
          AND EXTRACT(YEAR FROM lr.from_ts AT TIME ZONE 'Europe/Rome') = a.year
        WHERE a.year = $1
        GROUP BY a.tenant_id, a.user_id, a.template_id, a.type,
                 a.hours_total, a.hours_carried_in
     ),
     residuals AS (
       SELECT tenant_id, user_id, template_id, type,
              GREATEST(total_carryable - used_approved, 0) AS carry_in
         FROM prev
     ),
     templates AS (
       SELECT id, tenant_id, hours_default
         FROM leave_quota_templates
        WHERE deleted_at IS NULL
     )
     INSERT INTO leave_quota_assignments(
       tenant_id, user_id, template_id, type, year,
       hours_total, hours_carried_in
     )
     SELECT r.tenant_id, r.user_id, r.template_id, r.type, $2,
            t.hours_default, r.carry_in
       FROM residuals r
       JOIN templates t ON t.id = r.template_id
     ON CONFLICT (tenant_id, user_id, type, year) DO NOTHING`,
    [prevYear, year]
  );
  logger.info({ year, created: r.rowCount }, 'leave yearly rollover complete');
}
