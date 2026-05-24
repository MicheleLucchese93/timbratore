-- Stamps, stamps_history, idempotency_keys.

CREATE TABLE IF NOT EXISTS stamps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('clock_in','clock_out','break_start','break_end')),
  occurred_at timestamptz NOT NULL,
  source text NOT NULL CHECK (source IN ('employee_app','employee_correction','admin_manual')),
  branch_id uuid REFERENCES branches(id),
  latitude double precision,
  longitude double precision,
  gps_accuracy_m double precision,
  device_platform text,
  device_app_version text,
  suspicious_mock_location boolean NOT NULL DEFAULT false,
  notes text,
  queued_hours double precision,
  reminder_sent_at timestamptz,
  deleted_at timestamptz,
  deleted_by_user_id uuid,
  deletion_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stamps_user_time_idx ON stamps(user_id, occurred_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS stamps_tenant_time_idx ON stamps(tenant_id, occurred_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS stamps_branch_idx ON stamps(branch_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS stamps_history (
  id bigserial PRIMARY KEY,
  stamp_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  operation text NOT NULL CHECK (operation IN ('INSERT','UPDATE','DELETE')),
  changed_by uuid,
  change_reason text,
  before jsonb,
  after jsonb,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stamps_history_stamp_idx ON stamps_history(stamp_id, recorded_at);
CREATE INDEX IF NOT EXISTS stamps_history_tenant_idx ON stamps_history(tenant_id, recorded_at);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key text PRIMARY KEY,
  scope text NOT NULL,
  response_status int,
  response_body jsonb,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idempotency_expires_idx ON idempotency_keys(expires_at);

CREATE OR REPLACE FUNCTION trg_stamps_history() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  reason text := NULLIF(current_setting('app.change_reason', true), '');
  actor uuid := NULLIF(current_setting('app.current_user_id', true), '')::uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO stamps_history(stamp_id, tenant_id, operation, changed_by, change_reason, before, after)
    VALUES (NEW.id, NEW.tenant_id, 'INSERT', actor, reason, NULL, to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO stamps_history(stamp_id, tenant_id, operation, changed_by, change_reason, before, after)
    VALUES (NEW.id, NEW.tenant_id, 'UPDATE', actor, reason, to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO stamps_history(stamp_id, tenant_id, operation, changed_by, change_reason, before, after)
    VALUES (OLD.id, OLD.tenant_id, 'DELETE', actor, reason, to_jsonb(OLD), NULL);
    RETURN OLD;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS stamps_history_trigger ON stamps;
CREATE TRIGGER stamps_history_trigger
AFTER INSERT OR UPDATE OR DELETE ON stamps
FOR EACH ROW EXECUTE FUNCTION trg_stamps_history();

ALTER TABLE stamps ENABLE ROW LEVEL SECURITY;
ALTER TABLE stamps_history ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='stamps' AND policyname='stamps_tenant_iso') THEN
    CREATE POLICY stamps_tenant_iso ON stamps
      FOR ALL TO PUBLIC
      USING (
        tenant_id = auth.tenant_id()
        AND (auth.is_admin() OR user_id = auth.uid())
      )
      WITH CHECK (tenant_id = auth.tenant_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='stamps_history' AND policyname='stamps_history_tenant_iso') THEN
    CREATE POLICY stamps_history_tenant_iso ON stamps_history
      FOR SELECT TO PUBLIC
      USING (tenant_id = auth.tenant_id() AND auth.is_admin());
  END IF;
END $$;
