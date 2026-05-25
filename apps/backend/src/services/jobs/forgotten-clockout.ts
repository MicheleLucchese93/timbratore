import { pool } from '../../lib/db.js';
import { createLogger } from '../../lib/logger.js';

const logger = createLogger('forgotten_clockout');

export async function forgottenClockoutReminder(): Promise<void> {
  const result = await pool.query(
    `WITH latest AS (
       SELECT DISTINCT ON (user_id) id, tenant_id, user_id, event_type, occurred_at, reminder_sent_at
       FROM stamps
       WHERE deleted_at IS NULL
       ORDER BY user_id, occurred_at DESC
     ),
     candidates AS (
       SELECT l.id, l.tenant_id, l.user_id
       FROM latest l
       LEFT JOIN LATERAL (
         SELECT st.max_shift_hours
           FROM user_shift_assignments a
           JOIN shift_templates st ON st.id = a.shift_template_id
          WHERE a.user_id = l.user_id
            AND a.valid_from <= l.occurred_at::date
            AND (a.valid_to IS NULL OR a.valid_to >= l.occurred_at::date)
          ORDER BY a.valid_from DESC
          LIMIT 1
       ) u ON TRUE
       WHERE l.event_type IN ('clock_in','break_end')
         AND l.reminder_sent_at IS NULL
         AND l.occurred_at < now() - (COALESCE(u.max_shift_hours, 14) || ' hours')::interval
     )
     UPDATE stamps s
     SET reminder_sent_at = now()
     FROM candidates c
     WHERE s.id = c.id
     RETURNING s.id, s.user_id, s.tenant_id`
  );
  logger.info({ rows: result.rowCount }, 'forgotten-clockout reminders flagged');
  // Push delivery happens in TASK-NOT-02 dispatcher — wired but stub-safe.
}
