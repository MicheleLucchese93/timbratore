-- Leave quotas v2: explicit accrual schedule on templates + ledger of accruals.
--
-- Drops the "yearly auto-rollover" model. Admin now decides per-template the
-- amount of hours granted on each accrual + how often (monthly or yearly) +
-- which day. A daily cron inserts one ledger row per active assignment on its
-- anchor day. Balance = initial_balance + SUM(accruals.hours) − SUM(used).
-- Employee submission is NEVER blocked by quota; counter may go negative.

/* ---------------- Templates: accrual rules ---------------- */

ALTER TABLE leave_quota_templates
  ADD COLUMN IF NOT EXISTS accrual_amount numeric(8,2) NOT NULL DEFAULT 0
    CHECK (accrual_amount >= 0),
  ADD COLUMN IF NOT EXISTS accrual_frequency text NOT NULL DEFAULT 'yearly'
    CHECK (accrual_frequency IN ('monthly','yearly')),
  ADD COLUMN IF NOT EXISTS accrual_day_of_month smallint NOT NULL DEFAULT 1
    CHECK (accrual_day_of_month BETWEEN 1 AND 28),
  ADD COLUMN IF NOT EXISTS accrual_month smallint
    CHECK (accrual_month BETWEEN 1 AND 12);

-- Preserve previous behavior: existing templates accrue their hours_default
-- once per year on Jan 1 (which matches what the old Jan 1 cron used to do).
UPDATE leave_quota_templates
   SET accrual_amount = hours_default,
       accrual_frequency = 'yearly',
       accrual_month = 1,
       accrual_day_of_month = 1
 WHERE accrual_amount = 0;

-- For yearly templates, accrual_month must be set.
ALTER TABLE leave_quota_templates
  ADD CONSTRAINT leave_quota_templates_yearly_month_required
    CHECK (accrual_frequency <> 'yearly' OR accrual_month IS NOT NULL)
    NOT VALID;
ALTER TABLE leave_quota_templates
  VALIDATE CONSTRAINT leave_quota_templates_yearly_month_required;

/* ---------------- Assignments: drop year-keying, add lifecycle ---------------- */

ALTER TABLE leave_quota_assignments
  ADD COLUMN IF NOT EXISTS initial_balance numeric(8,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS started_on date NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS ended_on date,
  ADD COLUMN IF NOT EXISTS last_accrual_on date;

-- Backfill initial_balance from old hours_total + hours_carried_in
-- so existing assignments keep their effective starting balance.
UPDATE leave_quota_assignments
   SET initial_balance = COALESCE(hours_total, 0) + COALESCE(hours_carried_in, 0)
 WHERE initial_balance = 0;

-- Drop year-keyed unique. New rule: one active (ended_on IS NULL) assignment
-- per (tenant, user, type). Allow historical rows by simply tracking ended_on.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'leave_quota_assignments_unique'
  ) THEN
    ALTER TABLE leave_quota_assignments DROP CONSTRAINT leave_quota_assignments_unique;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS leave_quota_assignments_active_unique
  ON leave_quota_assignments(tenant_id, user_id, type)
  WHERE ended_on IS NULL;

/* ---------------- Accruals ledger ---------------- */

CREATE TABLE IF NOT EXISTS leave_accruals (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  assignment_id uuid NOT NULL REFERENCES leave_quota_assignments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  type text NOT NULL CHECK (type IN ('ferie','permessi')),
  hours numeric(8,2) NOT NULL,
  accrued_on date NOT NULL,
  source text NOT NULL DEFAULT 'cron' CHECK (source IN ('cron','manual','adjustment')),
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- One automatic accrual per (assignment, date) — prevents double-runs.
  CONSTRAINT leave_accruals_unique_cron_day
    UNIQUE (assignment_id, accrued_on, source)
);
CREATE INDEX IF NOT EXISTS leave_accruals_assignment_idx
  ON leave_accruals(assignment_id, accrued_on);
CREATE INDEX IF NOT EXISTS leave_accruals_user_type_idx
  ON leave_accruals(tenant_id, user_id, type, accrued_on DESC);

ALTER TABLE leave_accruals ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'leave_accruals'
       AND policyname = 'leave_accruals_tenant_iso'
  ) THEN
    CREATE POLICY leave_accruals_tenant_iso ON leave_accruals
      FOR ALL TO PUBLIC
      USING (
        tenant_id = auth.tenant_id()
        AND (auth.is_admin() OR user_id = auth.uid())
      )
      WITH CHECK (tenant_id = auth.tenant_id() AND auth.is_admin());
  END IF;
END $$;
