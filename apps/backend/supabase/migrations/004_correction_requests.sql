CREATE TABLE IF NOT EXISTS correction_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL,
  original_stamp_id uuid REFERENCES stamps(id),
  claimed_event_type text NOT NULL CHECK (claimed_event_type IN ('clock_in','clock_out','break_start','break_end')),
  claimed_occurred_at timestamptz NOT NULL,
  claimed_branch_id uuid REFERENCES branches(id),
  justification text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','superseded')),
  resolved_by uuid,
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS correction_requests_tenant_status_idx
  ON correction_requests(tenant_id, status, created_at DESC);

ALTER TABLE correction_requests ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='correction_requests' AND policyname='cr_tenant_iso') THEN
    CREATE POLICY cr_tenant_iso ON correction_requests
      FOR ALL TO PUBLIC
      USING (
        tenant_id = auth.tenant_id()
        AND (auth.is_admin() OR user_id = auth.uid())
      )
      WITH CHECK (tenant_id = auth.tenant_id());
  END IF;
END $$;
