-- One-shot fix for existing infra Postgres: strip BYPASSRLS from the `app`
-- role so tenant-isolation RLS policies actually run for per-request API
-- queries. Run as the Postgres superuser, once per environment:
--
--   docker exec -i postgres psql -U penno -v ON_ERROR_STOP=1 \
--     < /opt/sonoqui/infra/fix-app-role-rls.sql
--
-- Idempotent.

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'app') THEN
    ALTER ROLE app NOBYPASSRLS;
  END IF;
END $$;

SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname = 'app';
