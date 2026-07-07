-- Cantieri: construction-site activity module (feature-flagged per tenant).
--
-- A partner enables the module per tenant from the partner console (only if
-- the super-admin granted that partner the permission). Inside an enabled
-- tenant, members get an additive module role (independent of admin|user,
-- mirroring is_documentale): a "cantieri admin" manages sites (cantieri),
-- vehicles (mezzi), tenant-wide custom form fields and user assignments from
-- the web app; a "cantieri user" logs activity entries from the mobile app
-- for the open sites they are assigned to.
--
-- Data shape:
--   cantieri            site registry (name, address, open|closed status)
--   mezzi               vehicle registry (name + admin-defined custom values)
--   cantieri_field_defs tenant-wide custom field definitions, two scopes:
--                         'entry' -> extra inputs on the activity-entry form
--                         'mezzo' -> extra descriptive fields on a vehicle
--   cantiere_assignments / mezzo_assignments
--                       strict visibility filter: a mobile user only sees the
--                       sites/vehicles they are assigned to
--   cantiere_entries    per-visit activity report (several per day allowed):
--                       travel start/end, activity start/end, description,
--                       vehicle used, custom values. Times are Europe/Rome
--                       wall-clock (same convention as schedule slots).
--
-- Access model mirrors documents/bacheca (042/051): the app role reads through
-- own-scoped RLS and inserts/updates ONLY its own entries; every management
-- surface (site/vehicle/field/assignment writes, cross-user reads, dashboard,
-- PDF report) is served on the service role (adminPool) behind the
-- requireCantieriAdmin API gate, hard-scoped to the caller's tenant. The
-- entry INSERT policy re-checks assignment + open status in the DB so even an
-- API bug cannot let a user log onto a site they are not assigned to.

-- 1. Tenant feature flag (partner-console controlled).
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS cantieri_enabled boolean NOT NULL DEFAULT false;

-- 2. Partner permission: may this partner enable the module on their tenants?
--    Set by the super-admin at partner creation / caps edit. Platform admins
--    are unlimited (caps only bind role='partner'), same as the numeric caps.
ALTER TABLE partnership_members
  ADD COLUMN IF NOT EXISTS may_enable_cantieri boolean NOT NULL DEFAULT false;

-- 3. Per-user module role (additive, independent of the tenant admin|user
--    role — a plain employee can be the cantieri admin). NULL = no access,
--    module menu hidden on web and mobile.
ALTER TABLE memberships
  ADD COLUMN IF NOT EXISTS cantieri_role text
  CHECK (cantieri_role IN ('admin', 'user'));

CREATE INDEX IF NOT EXISTS memberships_cantieri_idx
  ON memberships(tenant_id) WHERE cantieri_role IS NOT NULL AND deleted_at IS NULL;

-- 4. Sites.
CREATE TABLE IF NOT EXISTS cantieri (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  address text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS cantieri_tenant_idx
  ON cantieri(tenant_id, status, name) WHERE deleted_at IS NULL;

-- 5. Vehicles. Standard field is just the name; everything else lives in
--    custom_values keyed by cantieri_field_defs (scope='mezzo').
CREATE TABLE IF NOT EXISTS mezzi (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  custom_values jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS mezzi_tenant_idx
  ON mezzi(tenant_id, name) WHERE deleted_at IS NULL;

-- 6. Tenant-wide custom field definitions (one set for the whole company so
--    dashboard/PDF columns stay consistent across sites).
CREATE TABLE IF NOT EXISTS cantieri_field_defs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  scope text NOT NULL CHECK (scope IN ('entry', 'mezzo')),
  key text NOT NULL,          -- stable slug used in custom_values maps
  label text NOT NULL,        -- admin-facing display name
  field_type text NOT NULL CHECK (field_type IN ('text', 'number', 'date', 'time', 'boolean', 'select')),
  options jsonb,              -- select choices: JSON array of strings
  required boolean NOT NULL DEFAULT false,
  position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS cantieri_field_defs_key_uniq
  ON cantieri_field_defs(tenant_id, scope, key) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS cantieri_field_defs_tenant_idx
  ON cantieri_field_defs(tenant_id, scope, position) WHERE deleted_at IS NULL;

-- 7. Assignments (strict filter: no row = user does not see the site/vehicle).
CREATE TABLE IF NOT EXISTS cantiere_assignments (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  cantiere_id uuid NOT NULL REFERENCES cantieri(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cantiere_id, user_id)
);
CREATE INDEX IF NOT EXISTS cantiere_assignments_user_idx
  ON cantiere_assignments(tenant_id, user_id);

CREATE TABLE IF NOT EXISTS mezzo_assignments (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  mezzo_id uuid NOT NULL REFERENCES mezzi(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (mezzo_id, user_id)
);
CREATE INDEX IF NOT EXISTS mezzo_assignments_user_idx
  ON mezzo_assignments(tenant_id, user_id);

-- 8. Activity entries (the record a mobile user submits per visit).
CREATE TABLE IF NOT EXISTS cantiere_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  cantiere_id uuid NOT NULL REFERENCES cantieri(id),
  user_id uuid NOT NULL,
  entry_date date NOT NULL,
  travel_start time,          -- Europe/Rome wall-clock, 'HH:MM'
  travel_end time,
  activity_start time,
  activity_end time,
  activity_text text,
  mezzo_id uuid REFERENCES mezzi(id),
  custom_values jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS cantiere_entries_site_idx
  ON cantiere_entries(tenant_id, cantiere_id, entry_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS cantiere_entries_user_idx
  ON cantiere_entries(tenant_id, user_id, entry_date DESC) WHERE deleted_at IS NULL;

ALTER TABLE cantieri ENABLE ROW LEVEL SECURITY;
ALTER TABLE mezzi ENABLE ROW LEVEL SECURITY;
ALTER TABLE cantieri_field_defs ENABLE ROW LEVEL SECURITY;
ALTER TABLE cantiere_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE mezzo_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE cantiere_entries ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  -- Assignments: each caller sees only their own rows (feeds the EXISTS
  -- checks below). Written only by the service role; no app-role write policy.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='cantiere_assignments' AND policyname='cantiere_assignments_select') THEN
    CREATE POLICY cantiere_assignments_select ON cantiere_assignments
      FOR SELECT TO PUBLIC
      USING (tenant_id = auth.tenant_id() AND user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='mezzo_assignments' AND policyname='mezzo_assignments_select') THEN
    CREATE POLICY mezzo_assignments_select ON mezzo_assignments
      FOR SELECT TO PUBLIC
      USING (tenant_id = auth.tenant_id() AND user_id = auth.uid());
  END IF;

  -- Sites/vehicles: a member sees only what they are assigned to (strict
  -- filter). Management reads/writes happen on the service role.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='cantieri' AND policyname='cantieri_select') THEN
    CREATE POLICY cantieri_select ON cantieri
      FOR SELECT TO PUBLIC
      USING (
        tenant_id = auth.tenant_id()
        AND deleted_at IS NULL
        AND EXISTS (
          SELECT 1 FROM cantiere_assignments ca
           WHERE ca.cantiere_id = cantieri.id AND ca.user_id = auth.uid()
        )
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='mezzi' AND policyname='mezzi_select') THEN
    CREATE POLICY mezzi_select ON mezzi
      FOR SELECT TO PUBLIC
      USING (
        tenant_id = auth.tenant_id()
        AND deleted_at IS NULL
        AND EXISTS (
          SELECT 1 FROM mezzo_assignments ma
           WHERE ma.mezzo_id = mezzi.id AND ma.user_id = auth.uid()
        )
      );
  END IF;

  -- Field definitions: every member may read them (needed to render the entry
  -- form); writes are service-role only.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='cantieri_field_defs' AND policyname='cantieri_field_defs_select') THEN
    CREATE POLICY cantieri_field_defs_select ON cantieri_field_defs
      FOR SELECT TO PUBLIC
      USING (tenant_id = auth.tenant_id() AND deleted_at IS NULL);
  END IF;

  -- Entries: own rows only, both ways. INSERT re-checks in the DB that the
  -- caller is assigned to the site and the site is still open (both EXISTS
  -- subqueries are themselves RLS-filtered to the caller's own visibility).
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='cantiere_entries' AND policyname='cantiere_entries_select') THEN
    CREATE POLICY cantiere_entries_select ON cantiere_entries
      FOR SELECT TO PUBLIC
      USING (tenant_id = auth.tenant_id() AND user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='cantiere_entries' AND policyname='cantiere_entries_insert') THEN
    CREATE POLICY cantiere_entries_insert ON cantiere_entries
      FOR INSERT TO PUBLIC
      WITH CHECK (
        tenant_id = auth.tenant_id()
        AND user_id = auth.uid()
        AND EXISTS (
          SELECT 1 FROM cantiere_assignments ca
           WHERE ca.cantiere_id = cantiere_entries.cantiere_id AND ca.user_id = auth.uid()
        )
        AND EXISTS (
          SELECT 1 FROM cantieri c
           WHERE c.id = cantiere_entries.cantiere_id AND c.status = 'open'
        )
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='cantiere_entries' AND policyname='cantiere_entries_update') THEN
    CREATE POLICY cantiere_entries_update ON cantiere_entries
      FOR UPDATE TO PUBLIC
      USING (tenant_id = auth.tenant_id() AND user_id = auth.uid())
      WITH CHECK (tenant_id = auth.tenant_id() AND user_id = auth.uid());
  END IF;
END $$;

-- 9. Partner console audit actions for the module toggle.
ALTER TABLE partnership_audit_log DROP CONSTRAINT IF EXISTS partnership_audit_log_action_check;
ALTER TABLE partnership_audit_log
  ADD CONSTRAINT partnership_audit_log_action_check CHECK (action IN (
    'tenant.create', 'tenant.update_limits', 'tenant.suspend',
    'tenant.resume', 'tenant.admin_reinvite', 'tenant.change_admin',
    'tenant.add_admin', 'tenant.remove_admin', 'tenant.assign_partner',
    'tenant.update_note', 'tenant.delete',
    'tenant.cantieri_enable', 'tenant.cantieri_disable',
    'partner.create', 'partner.update_caps', 'partner.update_profile',
    'partner.activate', 'partner.deactivate', 'partner.resend'));

-- Explicit grants (mirror 026/043/051): the app role reads its own-scoped
-- rows and writes only its own entries (soft-delete = UPDATE deleted_at).
-- All management writes are service-role only.
GRANT SELECT ON public.cantieri TO app, sonoqui_owner;
GRANT SELECT ON public.mezzi TO app, sonoqui_owner;
GRANT SELECT ON public.cantieri_field_defs TO app, sonoqui_owner;
GRANT SELECT ON public.cantiere_assignments TO app, sonoqui_owner;
GRANT SELECT ON public.mezzo_assignments TO app, sonoqui_owner;
GRANT SELECT, INSERT, UPDATE ON public.cantiere_entries TO app, sonoqui_owner;
