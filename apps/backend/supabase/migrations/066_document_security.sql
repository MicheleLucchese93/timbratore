-- Persist upload intent before touching storage. Existing documents are ready.
ALTER TABLE documents ADD COLUMN storage_state text NOT NULL DEFAULT 'ready'
  CHECK (storage_state IN ('pending', 'ready'));
CREATE INDEX documents_pending_idx ON documents(created_at) WHERE storage_state = 'pending';

-- Object paths are an integrity boundary, even on the elevated service path.
ALTER TABLE documents ADD CONSTRAINT documents_storage_key_scope CHECK (
  starts_with(r2_key, 'tenants/' || tenant_id::text || '/documents/' || id::text || '/')
  AND substring(r2_key FROM length('tenants/' || tenant_id::text || '/documents/' || id::text || '/') + 1)
      ~ '^[A-Za-z0-9_-][A-Za-z0-9._-]{0,203}$'
);

-- Only the service role writes document metadata. Ordinary admins must not
-- create a row pointing at someone else's bytes through the normal RLS pool.
DROP POLICY IF EXISTS documents_insert ON documents;
DROP POLICY IF EXISTS documents_update ON documents;
DROP POLICY IF EXISTS documents_delete ON documents;
DROP POLICY IF EXISTS documents_select ON documents;
CREATE POLICY documents_select ON documents FOR SELECT TO PUBLIC USING (
  tenant_id = auth.tenant_id() AND user_id = auth.uid()
  AND storage_state = 'ready' AND deleted_at IS NULL
);

-- A read receipt must name the same tenant and recipient as its document.
ALTER TABLE documents ADD CONSTRAINT documents_receipt_identity UNIQUE (id, tenant_id, user_id);
ALTER TABLE document_views ADD CONSTRAINT document_views_owner_fk
  FOREIGN KEY (document_id, tenant_id, user_id)
  REFERENCES documents(id, tenant_id, user_id) ON DELETE CASCADE;
DROP POLICY IF EXISTS document_views_insert ON document_views;
CREATE POLICY document_views_insert ON document_views FOR INSERT TO PUBLIC WITH CHECK (
  tenant_id = auth.tenant_id() AND user_id = auth.uid()
  AND EXISTS (SELECT 1 FROM documents d WHERE d.id = document_id
    AND d.tenant_id = document_views.tenant_id AND d.user_id = document_views.user_id
    AND d.storage_state = 'ready' AND d.deleted_at IS NULL)
);

-- Step-up verification belongs to a login session, not every token for a user.
-- NULL deliberately expires pre-migration step-up grants (normal login stays).
ALTER TABLE document_otps ADD COLUMN verified_session_id text;

CREATE FUNCTION revoke_document_otp_on_membership_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF OLD.is_documentale IS DISTINCT FROM NEW.is_documentale
     OR OLD.active IS DISTINCT FROM NEW.active
     OR OLD.deleted_at IS DISTINCT FROM NEW.deleted_at THEN
    DELETE FROM public.document_otps WHERE tenant_id = OLD.tenant_id AND user_id = OLD.user_id;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION revoke_document_otp_on_membership_change() FROM PUBLIC;
CREATE TRIGGER memberships_revoke_document_otp
  AFTER UPDATE OF is_documentale, active, deleted_at ON memberships
  FOR EACH ROW EXECUTE FUNCTION revoke_document_otp_on_membership_change();
