-- Ferie / Permessi / Malattia management.
--
-- Model:
--   leave_quota_templates    — admin-defined entitlement template (tenant scope).
--   leave_quota_assignments  — per-user-per-year hours_total + carry_in.
--   leave_approvers          — many-to-many user → approver(s); approver may be
--                              admin OR standard user. Mapping mandatory even
--                              for admins (no implicit approver role).
--   leave_requests           — ferie / permessi / malattia events; ferie+permessi
--                              follow approval flow, malattia is auto-approved.
--   leave_audit_log          — append-only timeline per request.
--
-- Quota unit: hours (numeric). Ferie expressed in hours, computed from the
-- user's shift template expected hours on each weekday. Permessi expressed
-- directly in hours, 15-minute granularity enforced at API layer.

CREATE TABLE IF NOT EXISTS leave_quota_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('ferie','permessi')),
  hours_default numeric(8,2) NOT NULL CHECK (hours_default >= 0),
  active boolean NOT NULL DEFAULT true,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leave_quota_templates_name_unique UNIQUE (tenant_id, name)
);
CREATE INDEX IF NOT EXISTS leave_quota_templates_tenant_idx
  ON leave_quota_templates(tenant_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS leave_quota_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL,
  template_id uuid NOT NULL REFERENCES leave_quota_templates(id),
  type text NOT NULL CHECK (type IN ('ferie','permessi')),
  year int NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  hours_total numeric(8,2) NOT NULL CHECK (hours_total >= 0),
  hours_carried_in numeric(8,2) NOT NULL DEFAULT 0 CHECK (hours_carried_in >= 0),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leave_quota_assignments_unique UNIQUE (tenant_id, user_id, type, year)
);
CREATE INDEX IF NOT EXISTS leave_quota_assignments_user_year_idx
  ON leave_quota_assignments(tenant_id, user_id, year);

CREATE TABLE IF NOT EXISTS leave_approvers (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL,
  approver_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, approver_user_id),
  CONSTRAINT leave_approvers_no_self CHECK (user_id <> approver_user_id)
);
CREATE INDEX IF NOT EXISTS leave_approvers_approver_idx
  ON leave_approvers(tenant_id, approver_user_id);
CREATE INDEX IF NOT EXISTS leave_approvers_user_idx
  ON leave_approvers(tenant_id, user_id);

CREATE TABLE IF NOT EXISTS leave_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL,
  type text NOT NULL CHECK (type IN ('ferie','permessi','malattia')),
  status text NOT NULL CHECK (status IN (
    'pending',
    'approved',
    'rejected',
    'cancelled',
    'cancellation_pending',
    'cancelled_post_approval',
    'superseded_by_malattia'
  )),
  from_ts timestamptz NOT NULL,
  to_ts timestamptz NOT NULL,
  duration_hours numeric(8,2) NOT NULL CHECK (duration_hours >= 0),
  inps_protocol text,
  user_note text,
  decided_by uuid,
  decided_at timestamptz,
  rejection_reason text,
  cancellation_reason text,
  cancellation_decided_by uuid,
  cancellation_decided_at timestamptz,
  superseded_by_request_id uuid REFERENCES leave_requests(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leave_requests_range CHECK (to_ts > from_ts),
  CONSTRAINT leave_requests_malattia_protocol
    CHECK (type <> 'malattia' OR (inps_protocol IS NOT NULL AND length(inps_protocol) > 0)),
  CONSTRAINT leave_requests_reject_reason
    CHECK (status <> 'rejected' OR (rejection_reason IS NOT NULL AND length(rejection_reason) > 0))
);
CREATE INDEX IF NOT EXISTS leave_requests_tenant_status_idx
  ON leave_requests(tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS leave_requests_user_idx
  ON leave_requests(tenant_id, user_id, from_ts DESC);
CREATE INDEX IF NOT EXISTS leave_requests_year_idx
  ON leave_requests(tenant_id, user_id, type, status, from_ts);

CREATE TABLE IF NOT EXISTS leave_audit_log (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  request_id uuid NOT NULL REFERENCES leave_requests(id) ON DELETE CASCADE,
  actor_user_id uuid,
  action text NOT NULL,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS leave_audit_log_request_idx
  ON leave_audit_log(request_id, created_at);
CREATE INDEX IF NOT EXISTS leave_audit_log_tenant_idx
  ON leave_audit_log(tenant_id, created_at DESC);

ALTER TABLE leave_quota_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_quota_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_approvers ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_audit_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='leave_quota_templates' AND policyname='leave_quota_templates_tenant_iso') THEN
    CREATE POLICY leave_quota_templates_tenant_iso ON leave_quota_templates
      FOR ALL TO PUBLIC
      USING (tenant_id = auth.tenant_id())
      WITH CHECK (tenant_id = auth.tenant_id() AND auth.is_admin());
  END IF;
  -- Assignments: tenant-isolated; non-admins can read their own row only.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='leave_quota_assignments' AND policyname='leave_quota_assignments_tenant_iso') THEN
    CREATE POLICY leave_quota_assignments_tenant_iso ON leave_quota_assignments
      FOR ALL TO PUBLIC
      USING (
        tenant_id = auth.tenant_id()
        AND (auth.is_admin() OR user_id = auth.uid())
      )
      WITH CHECK (tenant_id = auth.tenant_id() AND auth.is_admin());
  END IF;
  -- Approvers: visible to admin, to the user being approved, and to the approver.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='leave_approvers' AND policyname='leave_approvers_tenant_iso') THEN
    CREATE POLICY leave_approvers_tenant_iso ON leave_approvers
      FOR ALL TO PUBLIC
      USING (
        tenant_id = auth.tenant_id()
        AND (auth.is_admin() OR user_id = auth.uid() OR approver_user_id = auth.uid())
      )
      WITH CHECK (tenant_id = auth.tenant_id() AND auth.is_admin());
  END IF;
  -- Requests: admin sees all, user sees own, approver sees ones for users they approve.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='leave_requests' AND policyname='leave_requests_tenant_iso') THEN
    CREATE POLICY leave_requests_tenant_iso ON leave_requests
      FOR ALL TO PUBLIC
      USING (
        tenant_id = auth.tenant_id()
        AND (
          auth.is_admin()
          OR user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM leave_approvers la
             WHERE la.user_id = leave_requests.user_id
               AND la.approver_user_id = auth.uid()
          )
        )
      )
      WITH CHECK (tenant_id = auth.tenant_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='leave_audit_log' AND policyname='leave_audit_log_tenant_iso') THEN
    CREATE POLICY leave_audit_log_tenant_iso ON leave_audit_log
      FOR ALL TO PUBLIC
      USING (
        tenant_id = auth.tenant_id()
        AND (
          auth.is_admin()
          OR EXISTS (
            SELECT 1 FROM leave_requests lr
             WHERE lr.id = leave_audit_log.request_id
               AND (lr.user_id = auth.uid()
                    OR EXISTS (
                      SELECT 1 FROM leave_approvers la
                       WHERE la.user_id = lr.user_id
                         AND la.approver_user_id = auth.uid()
                    ))
          )
        )
      )
      WITH CHECK (tenant_id = auth.tenant_id());
  END IF;
END $$;

-- Touch updated_at on every UPDATE so frontends can rely on it.
CREATE OR REPLACE FUNCTION leave_requests_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS leave_requests_touch ON leave_requests;
CREATE TRIGGER leave_requests_touch
  BEFORE UPDATE ON leave_requests
  FOR EACH ROW EXECUTE FUNCTION leave_requests_touch_updated_at();

CREATE OR REPLACE FUNCTION leave_quota_assignments_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS leave_quota_assignments_touch ON leave_quota_assignments;
CREATE TRIGGER leave_quota_assignments_touch
  BEFORE UPDATE ON leave_quota_assignments
  FOR EACH ROW EXECUTE FUNCTION leave_quota_assignments_touch_updated_at();
