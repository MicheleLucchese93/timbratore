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
       -- Fixed 14h max-shift cutoff (no per-tenant or per-shift override).
       SELECT l.id, l.tenant_id, l.user_id
       FROM latest l
       WHERE l.event_type IN ('clock_in','break_end','lunch_end')
         AND l.reminder_sent_at IS NULL
         AND l.occurred_at < now() - INTERVAL '14 hours'
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
