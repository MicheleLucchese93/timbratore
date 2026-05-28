-- One-shot bootstrap for sonoQui on the existing infra Postgres.
-- Run as the Postgres superuser from /opt/infra:
--   docker exec -i postgres psql -U penno -v ON_ERROR_STOP=1 \
--     -v gotrue_pg_pass="'REPLACE_WITH_GOTRUE_PG_PASS'" \
--     -v sonoqui_owner_pass="'REPLACE_WITH_OWNER_PASS'" \
--     < /opt/sonoqui/infra/pg-init-sonoqui.sql
--
-- Idempotent — safe to re-run.

-- 1. sonoqui database.
SELECT 'CREATE DATABASE sonoqui'
 WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'sonoqui')\gexec

-- 2. sonoqui_owner role (used by ADMIN_DATABASE_URL — migrations, scripts, system).
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'sonoqui_owner') THEN
    EXECUTE format('CREATE ROLE sonoqui_owner WITH LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS', :sonoqui_owner_pass);
  END IF;
END $$;

-- 3. gotrue_superadmin already exists from infra pg-init. Make sure password
--    is set (re-run won't fail; safe).
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'gotrue_superadmin') THEN
    EXECUTE format('CREATE USER gotrue_superadmin WITH LOGIN PASSWORD %L', :gotrue_pg_pass);
  END IF;
END $$;

-- 4. Grants on the new DB.
GRANT ALL PRIVILEGES ON DATABASE sonoqui TO app, sonoqui_owner;
GRANT CONNECT ON DATABASE sonoqui TO gotrue_superadmin;

-- 5. Switch into sonoqui and configure schema-level access.
\c sonoqui

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- auth schema owned by gotrue_superadmin so GoTrue migrations can DDL.
CREATE SCHEMA IF NOT EXISTS auth AUTHORIZATION gotrue_superadmin;

-- sonoqui_owner owns public schema (alters our app tables).
ALTER SCHEMA public OWNER TO sonoqui_owner;
GRANT ALL ON SCHEMA public TO sonoqui_owner, app;

-- Anything sonoqui_owner creates in public is fully accessible to app.
ALTER DEFAULT PRIVILEGES FOR ROLE sonoqui_owner IN SCHEMA public
  GRANT ALL ON TABLES TO app;
ALTER DEFAULT PRIVILEGES FOR ROLE sonoqui_owner IN SCHEMA public
  GRANT ALL ON SEQUENCES TO app;
ALTER DEFAULT PRIVILEGES FOR ROLE sonoqui_owner IN SCHEMA public
  GRANT ALL ON FUNCTIONS TO app;

-- PostgREST-style roles (anon, authenticated) — not used in MVP but match
-- the xdevapp-infra convention so a future opt-in to RLS-via-SET-ROLE works.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END $$;
GRANT anon, authenticated TO app;
GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- 7. RLS enforcement for the `app` role.
-- The role is created by the shared infra bootstrap and historically inherited
-- BYPASSRLS=true from a PostgREST-style template. With BYPASSRLS, our
-- tenant-isolation RLS policies are silently skipped on per-request API
-- queries — admins in one tenant can read every other tenant. Force it off
-- here so fresh bootstraps are correct. Existing DBs need the one-shot
-- infra/fix-app-role-rls.sql run as superuser; the
-- 024_app_role_rls_guard.sql migration fails loudly if neither path ran.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'app') THEN
    ALTER ROLE app NOBYPASSRLS;
  END IF;
END $$;
