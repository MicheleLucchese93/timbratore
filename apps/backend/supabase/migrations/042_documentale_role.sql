-- "Documentale" capability + OTP-gated document access + access audit log.
--
-- An additive capability flag (independent of the admin|user role) that lets a
-- member upload documents AND view every employee's documents in the tenant —
-- but only after passing an emailed one-time code. Sensitive HR documents
-- (cedolini, CU, contratti) must never be reachable by anyone other than their
-- owner, EXCEPT a Documentale who has cleared OTP (and every such access is
-- logged). Plain admins LOSE the old see-everyone's-documents power.

-- 1. Capability flag (additive — a member keeps role='admin'|'user').
ALTER TABLE memberships
  ADD COLUMN IF NOT EXISTS is_documentale boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS memberships_documentale_idx
  ON memberships(tenant_id) WHERE is_documentale AND deleted_at IS NULL;

-- 2. Per-tenant cap on Documentale members (mirrors max_admins/max_branches).
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS max_documentali int NOT NULL DEFAULT 1 CHECK (max_documentali >= 1);

-- 3. HARDEN documents visibility: own-only for EVERYONE through RLS. Admins no
--    longer see other employees' documents here. The Documentale all-tenant read
--    path is served by the API on the service role (adminPool) behind an OTP
--    gate, never through this policy. DB backstop: even a bug in the API cannot
--    leak another user's document through the normal (app-role) pool.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='documents' AND policyname='documents_select') THEN
    DROP POLICY documents_select ON documents;
  END IF;
  CREATE POLICY documents_select ON documents
    FOR SELECT TO PUBLIC
    USING (tenant_id = auth.tenant_id() AND user_id = auth.uid());
END $$;

-- 4. One-time codes that unlock the Documentale all-tenant view for a short
--    window. One row per (tenant,user): requesting a code overwrites the pending
--    one; a successful verify stamps verified_until = now()+10min.
--    RLS ENABLED but NOT forced: the app role (NOBYPASSRLS, no policy here) is
--    blocked entirely, while the table-owner service role (adminPool) bypasses
--    it — so only the trusted server path ever reads/writes OTP state.
CREATE TABLE IF NOT EXISTS document_otps (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL,
  code_hash text,
  code_expires_at timestamptz,
  attempts int NOT NULL DEFAULT 0,
  verified_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);
CREATE INDEX IF NOT EXISTS document_otps_expiry_idx
  ON document_otps(code_expires_at);
ALTER TABLE document_otps ENABLE ROW LEVEL SECURITY;

-- 5. Append-only audit of every Documentale document access (list/download/
--    delete) and OTP lifecycle event. Distinct from document_views (the owner's
--    read-receipt, which a Documentale access must NEVER write). Same RLS shape
--    as document_otps: app role blocked, service role (adminPool) only.
CREATE TABLE IF NOT EXISTS document_access_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  actor_user_id uuid NOT NULL,
  document_id uuid,
  target_user_id uuid,
  action text NOT NULL CHECK (action IN ('list','download','delete','otp_request','otp_verify','otp_verify_fail')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS document_access_log_tenant_idx
  ON document_access_log(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS document_access_log_actor_idx
  ON document_access_log(actor_user_id, created_at DESC);
ALTER TABLE document_access_log ENABLE ROW LEVEL SECURITY;
