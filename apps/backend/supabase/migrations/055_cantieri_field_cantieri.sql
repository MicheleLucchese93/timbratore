-- Cantieri: per-cantiere scoping of entry-scope custom fields.
--
-- Until now every entry-scope custom field (cantieri_field_defs, scope='entry')
-- was shown on the activity form of EVERY cantiere. This adds an optional
-- association so an admin can restrict a field to one or more specific sites.
--
-- Semantics (enforced in application code, not the DB): a field with NO rows in
-- this table applies to ALL cantieri — the backward-compatible default, so every
-- existing field keeps appearing everywhere. Adding rows narrows it to exactly
-- those cantieri. Only meaningful for scope='entry'; mezzo fields never get rows.
--
-- Access mirrors the rest of the module (054): members read their own-scoped
-- rows (needed to render the entry form filtered per site); every write is
-- service-role only behind requireCantieriAdmin, hard-scoped to the tenant.

CREATE TABLE IF NOT EXISTS cantiere_field_cantieri (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  field_def_id uuid NOT NULL REFERENCES cantieri_field_defs(id) ON DELETE CASCADE,
  cantiere_id uuid NOT NULL REFERENCES cantieri(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (field_def_id, cantiere_id)
);
CREATE INDEX IF NOT EXISTS cantiere_field_cantieri_field_idx
  ON cantiere_field_cantieri(field_def_id);
CREATE INDEX IF NOT EXISTS cantiere_field_cantieri_cantiere_idx
  ON cantiere_field_cantieri(tenant_id, cantiere_id);

-- Own the table with the app's service role (matches every other module table,
-- 054), so adminPool — which connects as sonoqui_owner — can write it and bypass
-- RLS for management. Without this the table is owned by whoever runs the
-- migration and adminPool only gets the SELECT grant below → writes are denied.
ALTER TABLE cantiere_field_cantieri OWNER TO sonoqui_owner;

ALTER TABLE cantiere_field_cantieri ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  -- Every member may read the association rows for their tenant: the mobile
  -- entry form needs them to decide which custom fields to show for the site
  -- being logged. Writes are service-role only (no app-role write policy).
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='cantiere_field_cantieri' AND policyname='cantiere_field_cantieri_select') THEN
    CREATE POLICY cantiere_field_cantieri_select ON cantiere_field_cantieri
      FOR SELECT TO PUBLIC
      USING (tenant_id = auth.tenant_id());
  END IF;
END $$;

GRANT SELECT ON public.cantiere_field_cantieri TO app, sonoqui_owner;
