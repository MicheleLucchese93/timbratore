-- Note-only justifications for schedule anomalies.
--
-- Anomalies are computed on the fly from stamps + shift templates (see
-- computeAnomalies in routes/shifts.ts); there is no persisted "anomaly" row.
-- When an admin chooses "Giustifica con nota" instead of fixing the stamps,
-- the explanation needs somewhere to live so the anomaly stays surfaced but
-- annotated (and so it shows up in exports). One row per (user, day, kind):
-- re-justifying the same anomaly overwrites the note.

CREATE TABLE IF NOT EXISTS anomaly_justifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL,
  anomaly_date date NOT NULL,
  anomaly_kind text NOT NULL,
  note text NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id, anomaly_date, anomaly_kind)
);
CREATE INDEX IF NOT EXISTS anomaly_justifications_lookup_idx
  ON anomaly_justifications(tenant_id, user_id, anomaly_date);

ALTER TABLE anomaly_justifications ENABLE ROW LEVEL SECURITY;

-- Admins manage justifications for their tenant; the employee they concern may
-- read their own (parity with how leaves/corrections expose rows to the owner).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='anomaly_justifications' AND policyname='anomaly_justifications_tenant_iso') THEN
    CREATE POLICY anomaly_justifications_tenant_iso ON anomaly_justifications
      FOR ALL TO PUBLIC
      USING (
        tenant_id = auth.tenant_id()
        AND (auth.is_admin() OR user_id = auth.uid())
      )
      WITH CHECK (tenant_id = auth.tenant_id() AND auth.is_admin());
  END IF;
END $$;
