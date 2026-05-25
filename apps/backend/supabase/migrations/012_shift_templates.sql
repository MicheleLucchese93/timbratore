-- Shift templates ("orari di lavoro"): named weekly schedules admin can build
-- and assign per user. Used to flag stamps that deviate from the expected hours.
--
-- Model:
--   shift_templates           — header: name + tolerances + break window
--   shift_template_slots      — one row per (template, weekday, interval) — split shifts via multiple rows on the same weekday
--   user_shift_assignments    — versioned (valid_from / valid_to) — at most one active per (tenant, user) at any time

CREATE TABLE IF NOT EXISTS shift_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  description text,
  -- Tolerances (minutes) applied at the boundaries of expected slots.
  tolerance_in_min int NOT NULL DEFAULT 10 CHECK (tolerance_in_min BETWEEN 0 AND 240),
  tolerance_out_min int NOT NULL DEFAULT 10 CHECK (tolerance_out_min BETWEEN 0 AND 240),
  -- Acceptable total break duration on a day with this shift.
  expected_break_min_min int NOT NULL DEFAULT 0  CHECK (expected_break_min_min BETWEEN 0 AND 480),
  expected_break_max_min int NOT NULL DEFAULT 90 CHECK (expected_break_max_min BETWEEN 0 AND 480),
  active boolean NOT NULL DEFAULT true,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shift_templates_break_window CHECK (expected_break_min_min <= expected_break_max_min),
  CONSTRAINT shift_templates_name_unique UNIQUE (tenant_id, name)
);
CREATE INDEX IF NOT EXISTS shift_templates_tenant_idx
  ON shift_templates(tenant_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS shift_template_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_template_id uuid NOT NULL REFERENCES shift_templates(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  -- ISO day-of-week: 1=Mon ... 7=Sun (matches Postgres EXTRACT(isodow FROM …)).
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  start_time time NOT NULL,
  end_time time NOT NULL,
  CONSTRAINT shift_template_slots_order CHECK (start_time < end_time)
);
CREATE INDEX IF NOT EXISTS shift_template_slots_template_idx
  ON shift_template_slots(shift_template_id, day_of_week, start_time);
CREATE INDEX IF NOT EXISTS shift_template_slots_tenant_idx
  ON shift_template_slots(tenant_id);

CREATE TABLE IF NOT EXISTS user_shift_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL,
  shift_template_id uuid NOT NULL REFERENCES shift_templates(id),
  valid_from date NOT NULL,
  valid_to date,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_shift_assignments_range CHECK (valid_to IS NULL OR valid_to >= valid_from)
);
CREATE INDEX IF NOT EXISTS user_shift_assignments_user_idx
  ON user_shift_assignments(tenant_id, user_id, valid_from DESC);
-- Enforce "at most one open-ended assignment per user" via partial unique index.
CREATE UNIQUE INDEX IF NOT EXISTS user_shift_assignments_one_open
  ON user_shift_assignments(tenant_id, user_id)
  WHERE valid_to IS NULL;

ALTER TABLE shift_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_template_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_shift_assignments ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='shift_templates' AND policyname='shift_templates_tenant_iso') THEN
    CREATE POLICY shift_templates_tenant_iso ON shift_templates
      FOR ALL TO PUBLIC
      USING (tenant_id = auth.tenant_id())
      WITH CHECK (tenant_id = auth.tenant_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='shift_template_slots' AND policyname='shift_template_slots_tenant_iso') THEN
    CREATE POLICY shift_template_slots_tenant_iso ON shift_template_slots
      FOR ALL TO PUBLIC
      USING (tenant_id = auth.tenant_id())
      WITH CHECK (tenant_id = auth.tenant_id());
  END IF;
  -- Assignments: tenant-isolated; non-admins can read their own row only.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='user_shift_assignments' AND policyname='user_shift_assignments_tenant_iso') THEN
    CREATE POLICY user_shift_assignments_tenant_iso ON user_shift_assignments
      FOR ALL TO PUBLIC
      USING (
        tenant_id = auth.tenant_id()
        AND (auth.is_admin() OR user_id = auth.uid())
      )
      WITH CHECK (tenant_id = auth.tenant_id() AND auth.is_admin());
  END IF;
END $$;
