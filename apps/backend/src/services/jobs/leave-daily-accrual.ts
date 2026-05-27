import { pool } from '../../lib/db.js';
import { createLogger } from '../../lib/logger.js';

const logger = createLogger('leave_daily_accrual');

/**
 * Daily cron — for each active assignment whose template anchor matches today
 * in Europe/Rome, insert one accrual row + bump last_accrual_on.
 *
 * Idempotent: the UNIQUE (assignment_id, accrued_on, source='cron') constraint
 * silently absorbs duplicate runs on the same day. last_accrual_on is then
 * only refreshed when an INSERT actually happened.
 */
export async function leaveDailyAccrual(): Promise<void> {
  const r = await pool.query(
    `WITH today AS (
       SELECT (now() AT TIME ZONE 'Europe/Rome')::date AS d
     ),
     candidates AS (
       SELECT a.id AS assignment_id, a.tenant_id, a.user_id, a.type,
              t.accrual_amount, t.accrual_frequency,
              t.accrual_day_of_month, t.accrual_month
         FROM leave_quota_assignments a
         JOIN leave_quota_templates t ON t.id = a.template_id
         CROSS JOIN today
        WHERE a.ended_on IS NULL
          AND t.deleted_at IS NULL
          AND t.accrual_amount > 0
          AND a.started_on <= today.d
          AND EXTRACT(DAY FROM today.d)::int = t.accrual_day_of_month
          AND (
            t.accrual_frequency = 'monthly'
            OR (t.accrual_frequency = 'yearly'
                AND EXTRACT(MONTH FROM today.d)::int = t.accrual_month)
          )
     ),
     inserted AS (
       INSERT INTO leave_accruals(
         tenant_id, assignment_id, user_id, type,
         hours, accrued_on, source
       )
       SELECT c.tenant_id, c.assignment_id, c.user_id, c.type,
              c.accrual_amount, (SELECT d FROM today), 'cron'
         FROM candidates c
       ON CONFLICT (assignment_id, accrued_on, source) DO NOTHING
       RETURNING assignment_id, accrued_on
     )
     UPDATE leave_quota_assignments a
        SET last_accrual_on = i.accrued_on
       FROM inserted i
      WHERE a.id = i.assignment_id`
  );
  logger.info({ accruals: r.rowCount }, 'daily accrual run complete');
}
