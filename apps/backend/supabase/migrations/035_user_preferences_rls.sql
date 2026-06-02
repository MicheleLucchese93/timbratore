-- Enable RLS on user_preferences (self-access only).
--
-- The table holds push_token + per-user notification preferences and has no
-- tenant_id. Until now it had NO row-level security, so any future app-role
-- query that selected it without an explicit user predicate would expose every
-- user's push token / preferences. This policy constrains the request path
-- (the non-owner `app` role) to the row matching the session user.
--
-- Cross-user reads are done only by notifications.ts -> loadRecipients(), which
-- runs on adminPool (the table-owner role) and therefore bypasses RLS (the
-- table is ENABLE, not FORCE — same convention as every other table here). So
-- push/email delivery is unaffected.
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_preferences'
      AND policyname = 'user_prefs_self'
  ) THEN
    CREATE POLICY user_prefs_self ON user_preferences
      FOR ALL
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;
END $$;
