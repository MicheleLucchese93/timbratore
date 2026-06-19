import { adminPool } from '../../lib/admin-db.js';
import { createLogger } from '../../lib/logger.js';
import { notifyLeaveReminder } from '../../lib/notifications.js';

const logger = createLogger('leave_reminder');

/**
 * Daily cron (evening, Europe/Rome) — for every approved leave that STARTS the
 * next Europe/Rome calendar day, send the owner a "tomorrow you have …" push +
 * (opted-in) email. malattia is excluded: it is recorded after the fact, not
 * something to remind about. reminder_sent_at dedupes re-runs.
 */
export async function leaveReminder(): Promise<void> {
  const r = await adminPool.query(
    `WITH bounds AS (
       SELECT ((now() AT TIME ZONE 'Europe/Rome')::date + 1) AS d
     )
     SELECT lr.id, lr.tenant_id, lr.user_id, lr.type, lr.from_ts, lr.to_ts, lr.title
       FROM leave_requests lr, bounds
      WHERE lr.status = 'approved'
        AND lr.reminder_sent_at IS NULL
        AND lr.type <> 'malattia'
        AND (lr.from_ts AT TIME ZONE 'Europe/Rome')::date = bounds.d`
  );
  if ((r.rowCount ?? 0) === 0) {
    logger.info('no leave reminders due');
    return;
  }
  const sent: string[] = [];
  for (const row of r.rows) {
    try {
      await notifyLeaveReminder(row.tenant_id, row.user_id, {
        requestId: row.id,
        type: row.type,
        from_ts: new Date(row.from_ts).toISOString(),
        to_ts: new Date(row.to_ts).toISOString(),
        title: row.title,
      });
      sent.push(row.id);
    } catch (err) {
      logger.error({ err, id: row.id }, 'leave reminder send failed');
    }
  }
  if (sent.length > 0) {
    await adminPool.query(
      `UPDATE leave_requests SET reminder_sent_at = now() WHERE id = ANY($1::uuid[])`,
      [sent]
    );
  }
  logger.info({ due: r.rowCount, sent: sent.length }, 'leave reminders processed');
}
