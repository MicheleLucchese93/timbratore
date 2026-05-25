-- SonoQui — auth setup + RLS scaffolding.
-- Idempotent. Re-running on populated DB is a no-op.

CREATE SCHEMA IF NOT EXISTS auth;

-- Local mirror of the GoTrue user table (in dev we don't run GoTrue; in prod
-- the real auth.users lives in the same DB anyway, so the table is shared).
CREATE TABLE IF NOT EXISTS auth_users (
  id uuid PRIMARY KEY,
  email text UNIQUE,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION auth.tenant_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION auth.is_admin() RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE
  uid uuid := auth.uid();
  tid uuid := auth.tenant_id();
BEGIN
  IF uid IS NULL OR tid IS NULL THEN
    RETURN FALSE;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM memberships
    WHERE user_id = uid AND tenant_id = tid AND role = 'admin' AND active AND deleted_at IS NULL
  );
EXCEPTION WHEN undefined_table THEN
  RETURN FALSE;
END $$;

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id uuid PRIMARY KEY,
  language text DEFAULT 'it',
  notification_preferences jsonb DEFAULT '{}'::jsonb,
  push_token text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
