-- Allow the stamp history trigger and audit_log inserts to succeed for the
-- regular tenant role. The history/audit tables are still write-only from
-- the app: REVOKE UPDATE/DELETE below makes that explicit.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='stamps_history' AND policyname='stamps_history_tenant_insert') THEN
    CREATE POLICY stamps_history_tenant_insert ON stamps_history
      FOR INSERT TO PUBLIC
      WITH CHECK (tenant_id = auth.tenant_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='audit_log' AND policyname='audit_log_tenant_insert') THEN
    CREATE POLICY audit_log_tenant_insert ON audit_log
      FOR INSERT TO PUBLIC
      WITH CHECK (tenant_id = auth.tenant_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='centrifugo_outbox' AND policyname='outbox_all') THEN
    -- Outbox is system-only; allow all to PUBLIC since the channel field
    -- carries the tenant prefix and downstream consumers enforce isolation.
    ALTER TABLE centrifugo_outbox ENABLE ROW LEVEL SECURITY;
    CREATE POLICY outbox_all ON centrifugo_outbox FOR ALL TO PUBLIC USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='idempotency_keys' AND policyname='idem_all') THEN
    ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
    CREATE POLICY idem_all ON idempotency_keys FOR ALL TO PUBLIC USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='geocode_cache' AND policyname='geo_all') THEN
    ALTER TABLE geocode_cache ENABLE ROW LEVEL SECURITY;
    CREATE POLICY geo_all ON geocode_cache FOR ALL TO PUBLIC USING (true) WITH CHECK (true);
  END IF;
END $$;

REVOKE UPDATE, DELETE ON stamps_history FROM PUBLIC;
REVOKE UPDATE, DELETE ON audit_log FROM PUBLIC;
