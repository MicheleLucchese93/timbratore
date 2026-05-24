-- One-shot bootstrap for ciSono on the existing infra Postgres.
-- Run as the Postgres superuser from /opt/infra:
--   docker exec -i postgres psql -U penno -v ON_ERROR_STOP=1 \
--     -v gotrue_pg_pass="'REPLACE_WITH_GOTRUE_PG_PASS'" \
--     -v cisono_owner_pass="'REPLACE_WITH_OWNER_PASS'" \
--     < /opt/cisono/infra/pg-init-cisono.sql
--
-- Idempotent — safe to re-run.

-- 1. cisono database.
SELECT 'CREATE DATABASE cisono'
 WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'cisono')\gexec

-- 2. cisono_owner role (used by ADMIN_DATABASE_URL — migrations, scripts, system).
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'cisono_owner') THEN
    EXECUTE format('CREATE ROLE cisono_owner WITH LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS', :cisono_owner_pass);
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
GRANT ALL PRIVILEGES ON DATABASE cisono TO app, cisono_owner;
GRANT CONNECT ON DATABASE cisono TO gotrue_superadmin;

-- 5. Switch into cisono and configure schema-level access.
\c cisono

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- auth schema owned by gotrue_superadmin so GoTrue migrations can DDL.
CREATE SCHEMA IF NOT EXISTS auth AUTHORIZATION gotrue_superadmin;

-- cisono_owner owns public schema (alters our app tables).
ALTER SCHEMA public OWNER TO cisono_owner;
GRANT ALL ON SCHEMA public TO cisono_owner, app;

-- Anything cisono_owner creates in public is fully accessible to app.
ALTER DEFAULT PRIVILEGES FOR ROLE cisono_owner IN SCHEMA public
  GRANT ALL ON TABLES TO app;
ALTER DEFAULT PRIVILEGES FOR ROLE cisono_owner IN SCHEMA public
  GRANT ALL ON SEQUENCES TO app;
ALTER DEFAULT PRIVILEGES FOR ROLE cisono_owner IN SCHEMA public
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
