-- Tenants, memberships, branches, branch_memberships.

CREATE TABLE IF NOT EXISTS tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ragione_sociale text NOT NULL,
  country text NOT NULL DEFAULT 'IT',
  timezone text NOT NULL DEFAULT 'Europe/Rome',
  language text NOT NULL DEFAULT 'it',
  ccnl text,
  retention_years int NOT NULL DEFAULT 5 CHECK (retention_years BETWEEN 1 AND 10),
  max_admins int NOT NULL DEFAULT 2 CHECK (max_admins >= 1),
  max_users int NOT NULL DEFAULT 20 CHECK (max_users >= 1),
  geofence_policy text NOT NULL DEFAULT 'lenient' CHECK (geofence_policy IN ('lenient','strict')),
  gps_accuracy_ceiling_m int NOT NULL DEFAULT 100,
  mock_location_action text NOT NULL DEFAULT 'flag' CHECK (mock_location_action IN ('allow','flag','block')),
  break_paid_threshold_min int NOT NULL DEFAULT 30,
  max_shift_hours int NOT NULL DEFAULT 14,
  max_break_hours int NOT NULL DEFAULT 4,
  disable_desktop_clock_in boolean NOT NULL DEFAULT true,
  dpa_accepted_at timestamptz,
  dpa_accepted_by uuid,
  dpa_version text,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('admin','user')),
  active boolean NOT NULL DEFAULT true,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);
CREATE INDEX IF NOT EXISTS memberships_tenant_idx ON memberships(tenant_id);
CREATE INDEX IF NOT EXISTS memberships_user_idx ON memberships(user_id) WHERE active AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  address text,
  address_components jsonb,
  latitude double precision,
  longitude double precision,
  radius_m int NOT NULL DEFAULT 300 CHECK (radius_m BETWEEN 50 AND 1500),
  smart_working boolean NOT NULL DEFAULT false,
  timezone text,
  active boolean NOT NULL DEFAULT true,
  ordering int NOT NULL DEFAULT 0,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS branches_tenant_idx ON branches(tenant_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS branch_memberships (
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  PRIMARY KEY (branch_id, user_id)
);
CREATE INDEX IF NOT EXISTS branch_memberships_user_idx ON branch_memberships(user_id);

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE branch_memberships ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='tenants' AND policyname='tenants_self_select') THEN
    CREATE POLICY tenants_self_select ON tenants
      FOR SELECT TO PUBLIC
      USING (id = auth.tenant_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='tenants' AND policyname='tenants_self_update') THEN
    CREATE POLICY tenants_self_update ON tenants
      FOR UPDATE TO PUBLIC
      USING (id = auth.tenant_id() AND auth.is_admin())
      WITH CHECK (id = auth.tenant_id() AND auth.is_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='memberships' AND policyname='memberships_tenant_iso') THEN
    CREATE POLICY memberships_tenant_iso ON memberships
      FOR ALL TO PUBLIC
      USING (tenant_id = auth.tenant_id())
      WITH CHECK (tenant_id = auth.tenant_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='branches' AND policyname='branches_tenant_iso') THEN
    CREATE POLICY branches_tenant_iso ON branches
      FOR ALL TO PUBLIC
      USING (tenant_id = auth.tenant_id())
      WITH CHECK (tenant_id = auth.tenant_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='branch_memberships' AND policyname='branch_mem_tenant_iso') THEN
    CREATE POLICY branch_mem_tenant_iso ON branch_memberships
      FOR ALL TO PUBLIC
      USING (tenant_id = auth.tenant_id())
      WITH CHECK (tenant_id = auth.tenant_id());
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS audit_log (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL,
  actor_user_id uuid,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  before jsonb,
  after jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_tenant_idx ON audit_log(tenant_id, created_at DESC);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='audit_log' AND policyname='audit_tenant_iso') THEN
    CREATE POLICY audit_tenant_iso ON audit_log
      FOR ALL TO PUBLIC
      USING (tenant_id = auth.tenant_id())
      WITH CHECK (tenant_id = auth.tenant_id());
  END IF;
END $$;
