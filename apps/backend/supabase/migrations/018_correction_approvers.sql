-- Correction-request approvers.
--
-- Mirrors leave_approvers: many-to-many user → approver(s). An approver may
-- be admin OR standard user. When at least one approver is configured for a
-- requester, ONLY those approvers can decide their correction requests.
-- When none are configured, admins fall back as approvers (parity with the
-- leaves workflow set in 016_leaves.sql).
--
-- RLS policy on correction_requests is widened to let configured approvers
-- read pending rows; the API layer enforces the admin-fallback rule.

CREATE TABLE IF NOT EXISTS correction_approvers (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL,
  approver_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, approver_user_id),
  CONSTRAINT correction_approvers_no_self CHECK (user_id <> approver_user_id)
);
CREATE INDEX IF NOT EXISTS correction_approvers_approver_idx
  ON correction_approvers(tenant_id, approver_user_id);
CREATE INDEX IF NOT EXISTS correction_approvers_user_idx
  ON correction_approvers(tenant_id, user_id);

ALTER TABLE correction_approvers ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='correction_approvers' AND policyname='correction_approvers_tenant_iso') THEN
    CREATE POLICY correction_approvers_tenant_iso ON correction_approvers
      FOR ALL TO PUBLIC
      USING (
        tenant_id = auth.tenant_id()
        AND (auth.is_admin() OR user_id = auth.uid() OR approver_user_id = auth.uid())
      )
      WITH CHECK (tenant_id = auth.tenant_id() AND auth.is_admin());
  END IF;
END $$;

-- Widen correction_requests RLS so configured approvers can read and decide.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='correction_requests' AND policyname='cr_tenant_iso') THEN
    DROP POLICY cr_tenant_iso ON correction_requests;
  END IF;
  CREATE POLICY cr_tenant_iso ON correction_requests
    FOR ALL TO PUBLIC
    USING (
      tenant_id = auth.tenant_id()
      AND (
        auth.is_admin()
        OR user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM correction_approvers ca
           WHERE ca.user_id = correction_requests.user_id
             AND ca.approver_user_id = auth.uid()
        )
      )
    )
    WITH CHECK (tenant_id = auth.tenant_id());
END $$;
