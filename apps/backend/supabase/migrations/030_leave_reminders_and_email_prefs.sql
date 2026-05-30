-- 24h-before leave reminders + per-category EMAIL preferences.
--
-- (1) reminder_sent_at dedupes the daily reminder cron, mirroring
--     stamps.reminder_sent_at used by the forgotten-clockout job.
ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz;

-- (2) Email notifications gain the same per-kind split as push (migration 021).
--     Push keys stay opt-OUT (default true). Email keys stay opt-IN (default
--     false) to preserve today's behavior where email only fires for users who
--     turned the single master switch on. A new push_leave_reminders key
--     (opt-out) governs the 24h reminder push; email_leave_reminders its email.
ALTER TABLE user_preferences
  ALTER COLUMN notification_preferences SET DEFAULT '{
    "push_leave_decisions": true,
    "push_correction_decisions": true,
    "push_leave_submissions": true,
    "push_correction_submissions": true,
    "push_leave_reminders": true,
    "email_leave_decisions": false,
    "email_correction_decisions": false,
    "email_leave_submissions": false,
    "email_correction_submissions": false,
    "email_leave_reminders": false
  }'::jsonb;

-- Backfill existing rows. push_leave_reminders defaults on. Each email_* key
-- inherits the user's current master email switch so nobody's effective email
-- behavior changes on deploy. Keys already present win (idempotent re-runs and
-- preserved push opt-outs from migration 021).
UPDATE user_preferences
   SET notification_preferences =
       jsonb_build_object(
         'push_leave_reminders', true,
         'email_leave_decisions', COALESCE(email_notifications_enabled, false),
         'email_correction_decisions', COALESCE(email_notifications_enabled, false),
         'email_leave_submissions', COALESCE(email_notifications_enabled, false),
         'email_correction_submissions', COALESCE(email_notifications_enabled, false),
         'email_leave_reminders', COALESCE(email_notifications_enabled, false)
       )
       || COALESCE(notification_preferences, '{}'::jsonb);
