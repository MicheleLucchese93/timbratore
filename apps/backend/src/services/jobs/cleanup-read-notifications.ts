import { adminPool } from '../../lib/admin-db.js';
import { createLogger } from '../../lib/logger.js';

const logger = createLogger('cleanup_read_notifications');

// How long a notification survives after the user reads it. Unread rows are kept
// indefinitely so an unseen update is never lost; once read, the row is ephemeral
// and purged after this window. The mobile bell surfaces this horizon to the user
// (NotificationsModal footer) — keep the two in sync if this value changes.
export const READ_NOTIFICATION_RETENTION_DAYS = 15;

/**
 * Daily sweep — hard-delete notifications that were read more than
 * READ_NOTIFICATION_RETENTION_DAYS ago. Only `read_at IS NOT NULL` rows are
 * touched, so unread notifications persist until the user opens them.
 *
 * Runs on adminPool (service role, bypasses RLS) so it spans every tenant in a
 * single statement. No cross-table cascade: the notifications table is the only
 * row and has no children.
 */
export async function cleanupReadNotifications(): Promise<void> {
  const r = await adminPool.query(
    `DELETE FROM notifications
      WHERE read_at IS NOT NULL
        AND read_at < now() - ($1 || ' days')::interval`,
    [READ_NOTIFICATION_RETENTION_DAYS]
  );
  logger.info({ deleted: r.rowCount ?? 0 }, 'read-notification cleanup complete');
}
