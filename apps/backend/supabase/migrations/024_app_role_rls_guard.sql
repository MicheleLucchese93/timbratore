-- Guard: the `app` role MUST have BYPASSRLS off so tenant-isolation RLS
-- policies are enforced for per-request API queries.
--
-- The role itself is created by the shared infra Postgres and was historically
-- bootstrapped with BYPASSRLS=true. Hardening is encoded in
-- infra/pg-init-sonoqui.sql for fresh DBs, and infra/fix-app-role-rls.sql is
-- the one-shot operator script for existing environments. This migration is
-- a runtime guard that fails loudly if neither has been applied.
DO $$
DECLARE
  bypasses boolean;
BEGIN
  SELECT rolbypassrls INTO bypasses FROM pg_roles WHERE rolname = 'app';
  IF bypasses IS NULL THEN
    RAISE NOTICE 'app role not present yet; skipping RLS bypass guard';
    RETURN;
  END IF;
  IF bypasses THEN
    RAISE EXCEPTION
      'Security regression: role "app" has BYPASSRLS=true. '
      'Run infra/fix-app-role-rls.sql as superuser before continuing.';
  END IF;
END $$;
