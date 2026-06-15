-- Per-user HR documents (cedolini, CU, contratti, comunicazioni, altro).
--
-- Admins upload a PDF for a specific employee; the employee reads it from their
-- Documents section. The PDF lives in R2 at
--   tenants/{tenant_id}/documents/{document_id}/{sanitized_filename}
-- and this table holds the metadata. `document_views` records the first time
-- the OWNING employee opens a document (one row per document+user). Admin reads
-- never produce a view row — that is enforced at the API layer, the download
-- endpoint only inserts when role='user' AND the doc belongs to the caller.
--
-- Retention: retention_until = created_at + 36 months. A daily cron hard-deletes
-- the R2 object + the DB row where retention_until < now() AND deleted_at IS NULL.
-- Admin "replace" is DELETE (soft-delete row + drop R2 object) followed by a
-- fresh upload — no in-place edit, no versioning.

CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL,
  uploaded_by uuid NOT NULL,
  category text NOT NULL CHECK (category IN ('cedolino','cu','contratto','comunicazione','altro')),
  title text NOT NULL,
  original_filename text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL,
  r2_key text NOT NULL,
  retention_until timestamptz NOT NULL,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS documents_tenant_user_idx
  ON documents(tenant_id, user_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS documents_retention_idx
  ON documents(retention_until) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS document_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  viewed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, user_id)
);
CREATE INDEX IF NOT EXISTS document_views_document_idx
  ON document_views(document_id);

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_views ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  -- Documents: tenant-isolated. Admins see every row; an employee sees only
  -- their own. Only admins may insert / update (soft-delete) / delete.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='documents' AND policyname='documents_select') THEN
    CREATE POLICY documents_select ON documents
      FOR SELECT TO PUBLIC
      USING (
        tenant_id = auth.tenant_id()
        AND (auth.is_admin() OR user_id = auth.uid())
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='documents' AND policyname='documents_insert') THEN
    CREATE POLICY documents_insert ON documents
      FOR INSERT TO PUBLIC
      WITH CHECK (tenant_id = auth.tenant_id() AND auth.is_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='documents' AND policyname='documents_update') THEN
    CREATE POLICY documents_update ON documents
      FOR UPDATE TO PUBLIC
      USING (tenant_id = auth.tenant_id() AND auth.is_admin())
      WITH CHECK (tenant_id = auth.tenant_id() AND auth.is_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='documents' AND policyname='documents_delete') THEN
    CREATE POLICY documents_delete ON documents
      FOR DELETE TO PUBLIC
      USING (tenant_id = auth.tenant_id() AND auth.is_admin());
  END IF;

  -- Views: a row belongs to the employee who opened the document. Each caller
  -- only ever sees / writes their own view rows within their tenant. Admins do
  -- not read or write here through RLS — view aggregates for the admin list are
  -- computed server-side with the service role.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='document_views' AND policyname='document_views_select') THEN
    CREATE POLICY document_views_select ON document_views
      FOR SELECT TO PUBLIC
      USING (tenant_id = auth.tenant_id() AND user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='document_views' AND policyname='document_views_insert') THEN
    CREATE POLICY document_views_insert ON document_views
      FOR INSERT TO PUBLIC
      WITH CHECK (tenant_id = auth.tenant_id() AND user_id = auth.uid());
  END IF;
END $$;

-- Per-user notification preferences for new documents. Both default ON.
-- Email diverges from the usual email-opt-IN default (intentional product
-- decision): a new HR document is important enough that the employee should be
-- emailed unless they explicitly opt out. Keys live in the existing
-- user_preferences.notification_preferences jsonb (mirrors migrations 021/030).
ALTER TABLE user_preferences
  ALTER COLUMN notification_preferences SET DEFAULT '{
    "push_leave_decisions": true,
    "push_correction_decisions": true,
    "push_leave_submissions": true,
    "push_correction_submissions": true,
    "push_leave_reminders": true,
    "push_documents": true,
    "email_leave_decisions": false,
    "email_correction_decisions": false,
    "email_leave_submissions": false,
    "email_correction_submissions": false,
    "email_leave_reminders": false,
    "email_documents": true
  }'::jsonb;

-- Backfill: add the two document keys (both true) to every existing row that
-- doesn't already have push_documents. Existing keys win, so prior opt-outs and
-- idempotent re-runs are preserved.
UPDATE user_preferences
   SET notification_preferences =
       '{"push_documents": true, "email_documents": true}'::jsonb
       || COALESCE(notification_preferences, '{}'::jsonb)
 WHERE NOT (COALESCE(notification_preferences, '{}'::jsonb) ? 'push_documents');
