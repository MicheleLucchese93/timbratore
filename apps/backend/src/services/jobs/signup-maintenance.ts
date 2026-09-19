import { env } from '../../env.js';
import { adminPool } from '../../lib/admin-db.js';
import { createLogger } from '../../lib/logger.js';
import { sendMail } from '../../lib/mailer.js';
import { buildOrphanNoticeMail, buildSignupReminderMail } from '../../lib/billing-mail.js';
import { deleteUser } from '../../lib/gotrue-admin.js';

const logger = createLogger('signup_maintenance');

// Hourly housekeeping for self-service registrations (Specs/SELF_SERVICE_BILLING.md §3.2).
//  - pending links past their expiry → 'expired'
//  - expired / rejected requests that never produced a company → deleted after
//    30 days (GDPR minimisation: name, email, phone of someone who never became
//    a customer)
//  - confirmed accounts that never created a company → reminder at day 3 and 10
//  - (opt-in, SIGNUP_ORPHAN_PURGE_ENABLED) notice at day 80, deletion at day 90

const REMINDER_DAYS = [3, 10] as const;
const ORPHAN_NOTICE_DAY = 80;
const ORPHAN_DELETE_DAY = 90;

export async function signupMaintenance(): Promise<void> {
  const expired = await adminPool.query(
    `UPDATE signup_requests SET status = 'expired' WHERE status = 'pending' AND expires_at < now()`
  );
  const purged = await adminPool.query(
    `DELETE FROM signup_requests
      WHERE status IN ('expired', 'rejected') AND tenant_id IS NULL
        AND created_at < now() - interval '30 days'`
  );

  // Reminders: one per threshold, counted in reminder_count.
  let reminders = 0;
  for (let i = 0; i < REMINDER_DAYS.length; i++) {
    const due = await adminPool.query(
      `UPDATE signup_requests
          SET reminder_count = reminder_count + 1, last_reminder_at = now()
        WHERE status = 'email_confirmed' AND reminder_count = $1
          AND email_confirmed_at < now() - make_interval(days => $2)
        RETURNING email, first_name, language`,
      [i, REMINDER_DAYS[i]]
    );
    for (const r of due.rows) {
      await sendMail({ to: r.email, ...buildSignupReminderMail({ firstName: r.first_name, language: r.language }) });
      reminders++;
    }
  }

  let notices = 0;
  let deleted = 0;
  if (env.SIGNUP_ORPHAN_PURGE_ENABLED) {
    // An orphan = confirmed through signup, never created a company, belongs to
    // no company at all (not even a deleted membership) and is not a partner.
    const orphanSql = `
      FROM signup_requests s
      JOIN auth_users au ON au.id = s.user_id
     WHERE s.status = 'email_confirmed'
       AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = s.user_id)
       AND NOT EXISTS (SELECT 1 FROM partnership_members pm WHERE pm.user_id = s.user_id)
       AND NOT EXISTS (SELECT 1 FROM signup_requests s2
                        WHERE s2.user_id = s.user_id AND s2.status = 'company_created')`;
    const notify = await adminPool.query(
      `UPDATE signup_requests SET reminder_count = 3, last_reminder_at = now()
        WHERE id IN (SELECT s.id ${orphanSql}
                       AND s.reminder_count < 3
                       AND s.email_confirmed_at < now() - make_interval(days => $1))
        RETURNING email, first_name, language`,
      [ORPHAN_NOTICE_DAY]
    );
    for (const r of notify.rows) {
      await sendMail({
        to: r.email,
        ...buildOrphanNoticeMail({ firstName: r.first_name, days: ORPHAN_DELETE_DAY - ORPHAN_NOTICE_DAY, language: r.language }),
      });
      notices++;
    }
    const doomed = await adminPool.query(
      `SELECT DISTINCT s.user_id ${orphanSql}
         AND s.reminder_count >= 3
         AND s.email_confirmed_at < now() - make_interval(days => $1)`,
      [ORPHAN_DELETE_DAY]
    );
    for (const row of doomed.rows) {
      const userId = row.user_id as string;
      const client = await adminPool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`DELETE FROM legal_acceptances WHERE user_id = $1 AND tenant_id IS NULL`, [userId]);
        await client.query(`DELETE FROM signup_requests WHERE user_id = $1`, [userId]);
        await client.query(`DELETE FROM user_preferences WHERE user_id = $1`, [userId]);
        await client.query(`DELETE FROM auth_users WHERE id = $1`, [userId]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        logger.warn({ err, userId }, 'orphan account purge failed (kept)');
        continue;
      } finally {
        client.release();
      }
      if (!env.DEV_AUTH_ENABLED) {
        await deleteUser(userId).catch((err) => logger.error({ err, userId }, 'GoTrue delete failed after mirror purge'));
      }
      deleted++;
    }
  }

  if (expired.rowCount || purged.rowCount || reminders || notices || deleted) {
    logger.info(
      { expired: expired.rowCount, purged: purged.rowCount, reminders, notices, deleted },
      'signup maintenance'
    );
  }
}
