-- Partner console: read-only support sessions ("Accesso in sola lettura").
--
-- A partnership member can open a customer's environment in the WEB APP to see
-- exactly what the customer sees — without a password, without a membership row
-- in that tenant, and WITHOUT being able to change anything.
--
-- Identity model: the partner keeps their OWN user id (no impersonation of a
-- customer account). What the session grants is TENANT SCOPE, not an identity.
-- Three independent gates enforce read-only (see middleware/auth.ts):
--   1. HTTP    — only GET/HEAD/OPTIONS reach the routers; documents + export
--                downloads are refused outright.
--   2. Postgres— the per-request transaction runs SET TRANSACTION READ ONLY, so
--                any write that slipped past (1) fails with SQLSTATE 25006.
--   3. RLS     — tenant isolation is unchanged; auth.is_admin() additionally
--                honours the app.support_tenant GUC (below), which the backend
--                only ever sets to the tenant pinned inside the session token.
--
-- Additive: no existing row changes behaviour (no sessions exist, and
-- may_support_access defaults to the previous implicit "allowed for admins").

-- 1. The sessions themselves. One row per "open in read-only" click; it is BOTH
--    the single-use handoff code (so the token never travels in a URL) and the
--    revocation/expiry record consulted on EVERY request the session makes.
--    Same RLS shape as partnership_members: enabled with no app-role policy, so
--    only the service role (adminPool) can touch it.
CREATE TABLE IF NOT EXISTS support_sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_user_id    uuid NOT NULL REFERENCES auth_users(id),
  tenant_id          uuid NOT NULL REFERENCES tenants(id),
  -- sha256 of the one-time handoff code. NULLed the moment it is redeemed, so a
  -- replayed link cannot mint a second token.
  exchange_code_hash text,
  code_expires_at    timestamptz NOT NULL,
  -- Hard end of the session: the minted JWT carries the same instant as `exp`,
  -- and every request re-checks this column (a JWT alone could not be revoked).
  expires_at         timestamptz NOT NULL,
  started_at         timestamptz,
  revoked_at         timestamptz,
  reason             text,
  ip                 text,
  user_agent         text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_sessions_partner_idx
  ON support_sessions(partner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS support_sessions_tenant_idx
  ON support_sessions(tenant_id, created_at DESC);
-- Redeeming the handoff code looks the row up by hash; partial so only
-- unredeemed codes are indexed.
CREATE INDEX IF NOT EXISTS support_sessions_code_idx
  ON support_sessions(exchange_code_hash) WHERE exchange_code_hash IS NOT NULL;
ALTER TABLE support_sessions ENABLE ROW LEVEL SECURITY;

-- 2. Per-partner capability, mirroring may_enable_cantieri. Platform admins
--    ignore it (they are unlimited by definition); for role='partner' it decides
--    whether the console offers the action at all. Default TRUE keeps the
--    capability available to existing partners without a migration follow-up.
ALTER TABLE partnership_members
  ADD COLUMN IF NOT EXISTS may_support_access boolean NOT NULL DEFAULT true;

-- 3. auth.is_admin() also accepts a support session.
--
--    Admin-scoped RLS policies (stamps, users, leaves, …) resolve through this
--    function, which today requires a membership row — a partner has none in the
--    customer tenant, so every admin read would return zero rows. The GUC is set
--    ONLY by withSupportRLS (lib/db.ts), inside the same read-only transaction,
--    and only to the tenant id pinned in the verified session token. It must
--    equal auth.tenant_id(), so it can never widen the tenant scope: RLS still
--    filters every table by tenant_id = auth.tenant_id().
--
--    The write side of FOR ALL policies is moot: the transaction is read-only.
CREATE OR REPLACE FUNCTION auth.is_admin() RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE
  uid uuid := auth.uid();
  tid uuid := auth.tenant_id();
  sup uuid := NULLIF(current_setting('app.support_tenant', true), '')::uuid;
BEGIN
  IF tid IS NOT NULL AND sup IS NOT NULL AND sup = tid THEN
    RETURN TRUE;
  END IF;
  IF uid IS NULL OR tid IS NULL THEN
    RETURN FALSE;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM memberships
    WHERE user_id = uid AND tenant_id = tid AND role = 'admin' AND active AND deleted_at IS NULL
  );
EXCEPTION WHEN undefined_table THEN
  RETURN FALSE;
END $$;

-- 4. Partner-console audit action for opening a session (mirrors 054's list).
ALTER TABLE partnership_audit_log DROP CONSTRAINT IF EXISTS partnership_audit_log_action_check;
ALTER TABLE partnership_audit_log
  ADD CONSTRAINT partnership_audit_log_action_check CHECK (action IN (
    'tenant.create', 'tenant.update_limits', 'tenant.suspend',
    'tenant.resume', 'tenant.admin_reinvite', 'tenant.change_admin',
    'tenant.add_admin', 'tenant.remove_admin', 'tenant.assign_partner',
    'tenant.update_note', 'tenant.delete',
    'tenant.cantieri_enable', 'tenant.cantieri_disable',
    'tenant.support_access',
    'partner.create', 'partner.update_caps', 'partner.update_profile',
    'partner.activate', 'partner.deactivate', 'partner.resend'));

-- 5. The customer must be able to SEE that a partner looked at their data: the
--    session start is also written to the tenant's own audit_log
--    (action 'support.session_start') by the API, on the service role. No schema
--    change is needed: audit_log.action is free text and actor_user_id carries no
--    FK, so a partner with no membership in the tenant is a legal actor. This
--    comment records the invariant.
