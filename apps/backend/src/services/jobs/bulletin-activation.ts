import { adminPool } from '../../lib/admin-db.js';
import { createLogger } from '../../lib/logger.js';
import { notifyBulletin } from '../../lib/notifications.js';

const logger = createLogger('bulletin_activation');

/**
 * Frequent cron — send the publish notification (email/push) for Bacheca
 * messages whose start_at has passed but that have not been notified yet.
 *
 * Immediate posts are notified inline at create time (and stamped notified_at),
 * so this picks up FUTURE-SCHEDULED posts when they go live — and acts as a
 * safety net if the inline send was skipped (e.g. process restart mid-create).
 * Recipients are resolved AT SEND TIME, so a target_all post reaches whoever is
 * an active member when it activates (live "all"). notified_at dedupes re-runs.
 */
export async function bulletinActivation(): Promise<void> {
  const due = await adminPool.query(
    `SELECT id, tenant_id, title, body_html, target_all, notify_email, notify_push
       FROM bulletins
      WHERE deleted_at IS NULL
        AND notified_at IS NULL
        AND (notify_email OR notify_push)
        AND (start_at IS NULL OR start_at <= now())
        AND (end_at IS NULL OR end_at > now())
      LIMIT 200`
  );
  if ((due.rowCount ?? 0) === 0) return;

  let sent = 0;
  for (const b of due.rows) {
    try {
      const recipientIds = await resolveRecipients(b.tenant_id, b.id, b.target_all);
      // Stamp first so a duplicate cron tick can't double-send; the notify is
      // best-effort and idempotency on the alert matters more than one retry.
      await adminPool.query(`UPDATE bulletins SET notified_at = now() WHERE id = $1`, [b.id]);
      await notifyBulletin(b.tenant_id, recipientIds, {
        bulletinId: b.id,
        title: b.title,
        bodyHtml: b.body_html,
        notifyEmail: b.notify_email,
        notifyPush: b.notify_push,
      });
      sent += 1;
    } catch (err) {
      logger.error({ err, id: b.id }, 'bulletin activation send failed');
    }
  }
  logger.info({ due: due.rowCount, sent }, 'bulletin activations processed');
}

async function resolveRecipients(
  tenantId: string,
  bulletinId: string,
  targetAll: boolean
): Promise<string[]> {
  if (targetAll) {
    const r = await adminPool.query(
      `SELECT user_id FROM memberships
        WHERE tenant_id = $1 AND active = TRUE AND deleted_at IS NULL`,
      [tenantId]
    );
    return r.rows.map((row) => row.user_id as string);
  }
  const r = await adminPool.query(
    `SELECT t.user_id
       FROM bulletin_targets t
       JOIN memberships m
         ON m.tenant_id = t.tenant_id AND m.user_id = t.user_id
        AND m.active = TRUE AND m.deleted_at IS NULL
      WHERE t.bulletin_id = $1`,
    [bulletinId]
  );
  return r.rows.map((row) => row.user_id as string);
}
