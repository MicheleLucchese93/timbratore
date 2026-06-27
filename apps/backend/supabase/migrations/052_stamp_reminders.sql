-- Schedule-aware missed-stamp reminders.
--
-- A new cron job (services/jobs/stamp-reminder.ts) pushes a reminder when an
-- expected clock-in/clock-out time (a shift slot boundary) passes with no
-- matching stamp. Two additive pieces:
--
-- (1) stamp_reminder_log — dedupe ledger: at most one push per
--     (user, local day, boundary). Written ONLY by the service role
--     (adminPool / sonoqui_owner, which OWNS the table) from the cron; never by
--     the app role and never read by clients. RLS is enabled with NO policies
--     and NO grant to `app`, so the owner-bypass is the only access path. The
--     cron purges rows older than 7 days.
CREATE TABLE IF NOT EXISTS stamp_reminder_log (
  tenant_id  uuid NOT NULL REFERENCES tenants(id),
  user_id    uuid NOT NULL,
  local_date date NOT NULL,
  boundary   text NOT NULL,
  sent_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, local_date, boundary)
);
CREATE INDEX IF NOT EXISTS stamp_reminder_log_purge_idx
  ON stamp_reminder_log(local_date);

ALTER TABLE stamp_reminder_log ENABLE ROW LEVEL SECURITY;
-- Intentionally no CREATE POLICY and no GRANT to app: only sonoqui_owner
-- (the cron's adminPool role, table owner) touches this table.

-- (2) push_stamp_reminders preference key (opt-OUT, default true), mirroring the
--     push_* keys from migrations 021/030/041. Governs the missed-stamp push.
--     Email has no equivalent key — these reminders are push + in-app bell only.
ALTER TABLE user_preferences
  ALTER COLUMN notification_preferences SET DEFAULT '{
    "push_leave_decisions": true,
    "push_correction_decisions": true,
    "push_leave_submissions": true,
    "push_correction_submissions": true,
    "push_leave_reminders": true,
    "push_documents": true,
    "push_stamp_reminders": true,
    "email_leave_decisions": false,
    "email_correction_decisions": false,
    "email_leave_submissions": false,
    "email_correction_submissions": false,
    "email_leave_reminders": false,
    "email_documents": true
  }'::jsonb;

-- Backfill: add push_stamp_reminders (true) to every existing row that lacks it.
-- Existing keys win (idempotent re-runs + preserved opt-outs).
UPDATE user_preferences
   SET notification_preferences =
       '{"push_stamp_reminders": true}'::jsonb
       || COALESCE(notification_preferences, '{}'::jsonb)
 WHERE NOT (COALESCE(notification_preferences, '{}'::jsonb) ? 'push_stamp_reminders');
