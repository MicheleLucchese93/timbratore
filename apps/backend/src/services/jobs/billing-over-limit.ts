import { OVER_LIMIT_GRACE_DAYS } from '@sonoqui/shared';
import { adminPool } from '../../lib/admin-db.js';
import { createLogger } from '../../lib/logger.js';
import { sendMail } from '../../lib/mailer.js';
import { overLimitState } from '../../lib/billing.js';
import { buildOverLimitMail } from '../../lib/billing-mail.js';

const logger = createLogger('billing_over_limit');

// Days after the downgrade on which the company's admins are told (D7):
// the day it happens, a week in, the day before the lock, and the lock itself.
const NOTICE_DAYS = [0, 7, OVER_LIMIT_GRACE_DAYS - 1, OVER_LIMIT_GRACE_DAYS] as const;

/**
 * Daily: for every self-service company above its caps, re-evaluate against
 * live counts (overLimitState clears the flag if they already fixed it) and
 * send the next notice that is due. over_limit_notices counts what was sent.
 */
export async function billingOverLimit(): Promise<void> {
  const r = await adminPool.query(
    `SELECT id, ragione_sociale, language, over_limit_since, over_limit_notices
       FROM tenants
      WHERE billing_mode = 'stripe' AND over_limit_since IS NOT NULL AND deleted_at IS NULL`
  );
  let sent = 0;
  for (const t of r.rows) {
    const state = await overLimitState(t.id as string);
    if (!state.since) continue; // fixed in the meantime
    const days = Math.floor((Date.now() - new Date(state.since).getTime()) / 86_400_000);
    const notices = Number(t.over_limit_notices ?? 0);
    // The next notice not yet sent whose day has come.
    let next = notices;
    while (next < NOTICE_DAYS.length && NOTICE_DAYS[next]! <= days) next++;
    if (next === notices) continue;
    const admins = await adminPool.query(
      `SELECT DISTINCT au.email FROM memberships m JOIN auth_users au ON au.id = m.user_id
        WHERE m.tenant_id = $1 AND m.role = 'admin' AND m.active = TRUE AND m.deleted_at IS NULL`,
      [t.id]
    );
    const to = admins.rows.map((a) => a.email as string).filter(Boolean);
    if (to.length) {
      await sendMail({
        to,
        ...buildOverLimitMail({
          companyName: t.ragione_sociale,
          daysLeft: Math.max(0, OVER_LIMIT_GRACE_DAYS - days),
          kinds: state.kinds,
          language: t.language === 'en' ? 'en' : 'it',
        }),
      });
      sent++;
    }
    await adminPool.query(`UPDATE tenants SET over_limit_notices = $2 WHERE id = $1`, [t.id, next]);
  }
  if (sent) logger.info({ sent }, 'over-limit notices sent');
}
