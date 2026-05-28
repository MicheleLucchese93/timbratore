-- Per-kind push notification opt-out preferences. Stored under the
-- existing user_preferences.notification_preferences jsonb column.
--
-- Keys default to true so users keep receiving every push category until
-- they explicitly opt out. Admin-only kinds (leave_submissions,
-- correction_submissions) are hidden from non-admins in the UI but the
-- DB shape is uniform across roles so a user promoted to admin starts
-- with every category enabled.
ALTER TABLE user_preferences
  ALTER COLUMN notification_preferences SET DEFAULT '{
    "push_leave_decisions": true,
    "push_correction_decisions": true,
    "push_leave_submissions": true,
    "push_correction_submissions": true
  }'::jsonb;

-- Backfill: merge defaults into every existing row, with current values
-- winning so any pre-existing keys are preserved. Idempotent.
UPDATE user_preferences
   SET notification_preferences = '{
        "push_leave_decisions": true,
        "push_correction_decisions": true,
        "push_leave_submissions": true,
        "push_correction_submissions": true
      }'::jsonb || COALESCE(notification_preferences, '{}'::jsonb);
