import { adminPool } from '../../lib/admin-db.js';
import { createLogger } from '../../lib/logger.js';

const logger = createLogger('auto_clockout');

// A shift left open longer than this is force-closed: the job inserts a
// clock_out at clock_in + MAX_SHIFT_HOURS. This escalates the 14h
// forgotten-clockout reminder (forgotten-clockout.ts) — remind at 14h,
// auto-close at 15h — so a worker who forgets to stamp out never accrues an
// unbounded open shift. The clock_out timestamp is exactly clock_in + 15h
// (may fall on the next calendar day), carries source 'system_auto', and is
// idempotent: once inserted it becomes the latest event, so re-runs skip it.
const MAX_SHIFT_HOURS = 15;

export async function autoClockout(): Promise<void> {
  const client = await adminPool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.change_reason', 'auto_clockout_15h', true)");
    const inserted = await client.query(
      `WITH last_out AS (
         SELECT user_id, MAX(occurred_at) AS last_out_at
           FROM stamps
          WHERE deleted_at IS NULL AND event_type = 'clock_out'
          GROUP BY user_id
       ),
       open_in AS (
         -- opening clock_in of the current run = newest clock_in after the
         -- user's last clock_out (or ever, if they have never clocked out)
         SELECT DISTINCT ON (s.user_id)
                s.tenant_id, s.user_id, s.branch_id, s.occurred_at AS clock_in_at
           FROM stamps s
           LEFT JOIN last_out lo ON lo.user_id = s.user_id
          WHERE s.deleted_at IS NULL AND s.event_type = 'clock_in'
            AND (lo.last_out_at IS NULL OR s.occurred_at > lo.last_out_at)
          ORDER BY s.user_id, s.occurred_at DESC
       ),
       latest AS (
         SELECT DISTINCT ON (user_id) user_id, event_type AS last_event
           FROM stamps
          WHERE deleted_at IS NULL
          ORDER BY user_id, occurred_at DESC, created_at DESC
       ),
       candidates AS (
         SELECT oi.tenant_id, oi.user_id, oi.branch_id, oi.clock_in_at
           FROM open_in oi
           JOIN latest l ON l.user_id = oi.user_id
          -- state must still be "clocked in" — an open break/lunch is left for
          -- the user to resolve, matching the forgotten-clockout reminder.
          WHERE l.last_event IN ('clock_in', 'break_end', 'lunch_end')
            AND oi.clock_in_at <= now() - ($1 || ' hours')::interval
       )
       INSERT INTO stamps(tenant_id, user_id, event_type, occurred_at, source, branch_id, notes)
       SELECT c.tenant_id, c.user_id, 'clock_out',
              c.clock_in_at + ($1 || ' hours')::interval,
              'system_auto', c.branch_id,
              'Uscita automatica: turno aperto oltre ' || $1 || 'h'
         FROM candidates c
       RETURNING *`,
      [String(MAX_SHIFT_HOURS)]
    );
    for (const row of inserted.rows) {
      await client.query(
        `INSERT INTO centrifugo_outbox(method, payload)
         VALUES ('publish', jsonb_build_object(
           'channel', 'tenant.' || $1::text || '.dashboard',
           'data', jsonb_build_object('type','stamp','stamp', to_jsonb($2::jsonb))
         ))`,
        [row.tenant_id, JSON.stringify(row)]
      );
    }
    await client.query('COMMIT');
    logger.info({ rows: inserted.rowCount }, 'auto clock-outs inserted');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
