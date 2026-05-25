-- Add first_name and last_name to auth_users so admins can record
-- staff names (Italian: nome, cognome). Both optional.

ALTER TABLE auth_users
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS last_name text;
