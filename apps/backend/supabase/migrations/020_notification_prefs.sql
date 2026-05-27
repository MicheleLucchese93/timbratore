-- Per-user email opt-in flag. Default false — push notifications are always
-- on once the device registers a token, but email blasts only fire for users
-- who explicitly enable them. Mirrors the toggle exposed in web Impostazioni
-- and mobile Profilo.
ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS email_notifications_enabled boolean NOT NULL DEFAULT false;
