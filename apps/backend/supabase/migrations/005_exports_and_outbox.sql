CREATE TABLE IF NOT EXISTS export_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  requested_by uuid NOT NULL,
  format text NOT NULL CHECK (format IN ('xlsx','json')),
  period_from date NOT NULL,
  period_to date NOT NULL,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','ready','failed')),
  r2_key text,
  signed_url_expires_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS export_jobs_tenant_status_idx ON export_jobs(tenant_id, status, created_at DESC);

ALTER TABLE export_jobs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='export_jobs' AND policyname='exp_tenant_iso') THEN
    CREATE POLICY exp_tenant_iso ON export_jobs
      FOR ALL TO PUBLIC
      USING (tenant_id = auth.tenant_id() AND auth.is_admin())
      WITH CHECK (tenant_id = auth.tenant_id() AND auth.is_admin());
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS tenant_export_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  email text NOT NULL,
  label text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE tenant_export_recipients ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='tenant_export_recipients' AND policyname='ter_tenant_iso') THEN
    CREATE POLICY ter_tenant_iso ON tenant_export_recipients
      FOR ALL TO PUBLIC
      USING (tenant_id = auth.tenant_id() AND auth.is_admin())
      WITH CHECK (tenant_id = auth.tenant_id() AND auth.is_admin());
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS centrifugo_outbox (
  id bigserial PRIMARY KEY,
  method text NOT NULL,
  payload jsonb NOT NULL,
  partition int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS centrifugo_outbox_created_idx ON centrifugo_outbox(id);

CREATE TABLE IF NOT EXISTS geocode_cache (
  address_hash text PRIMARY KEY,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
