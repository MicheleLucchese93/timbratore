-- Partnership / reseller layer: a PLATFORM-LEVEL role dimension that lives
-- OUTSIDE per-tenant membership (mirrors how `is_documentale` is an additive
-- capability, but here scoped to the whole platform rather than one tenant).
--
-- Two roles:
--   admin   — sees/manages EVERY tenant + creates and manages partners. Unlimited.
--   partner — a reseller: sees/manages ONLY the tenants they created, bounded by
--             admin-granted caps (how many tenants they may create, and the max
--             users/admins/documentali/branches they may set per tenant).
--
-- Everything here is ADDITIVE and defaults to a no-op for existing rows, so the
-- webapp + mobile app are unaffected: no existing tenant is owned by a partner
-- (created_by_partner NULL) and none is suspended (suspended_at NULL).

-- 1. Platform role + per-partner caps. Keyed on the GoTrue user (auth_users
--    mirror), so partnership users are the SAME accounts that exist already.
--    RLS ENABLED but with NO app-role policy: like document_otps / notifications,
--    the app role (NOBYPASSRLS) is blocked entirely and only the table-owner
--    service role (adminPool, used by the /partnership API) ever touches it.
CREATE TABLE IF NOT EXISTS partnership_members (
  user_id      uuid PRIMARY KEY REFERENCES auth_users(id),
  role         text NOT NULL CHECK (role IN ('admin', 'partner')),
  active       boolean NOT NULL DEFAULT true,
  -- Caps apply to role='partner' only (admin is always unlimited). NULL on any
  -- column = unlimited for that dimension.
  cap_tenants               int CHECK (cap_tenants IS NULL OR cap_tenants >= 0),
  cap_users_per_tenant      int CHECK (cap_users_per_tenant IS NULL OR cap_users_per_tenant >= 1),
  cap_admins_per_tenant     int CHECK (cap_admins_per_tenant IS NULL OR cap_admins_per_tenant >= 1),
  cap_documentali_per_tenant int CHECK (cap_documentali_per_tenant IS NULL OR cap_documentali_per_tenant >= 0),
  cap_branches_per_tenant   int CHECK (cap_branches_per_tenant IS NULL OR cap_branches_per_tenant >= 1),
  created_by   uuid REFERENCES auth_users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE partnership_members ENABLE ROW LEVEL SECURITY;

-- 2. Tenant ownership + suspension (additive columns, NULL = unchanged behavior).
--    created_by_partner: which partner provisioned the tenant (NULL for tenants
--    created the old way / by an admin). Drives the partner's "see only my own".
--    suspended_at/by: a partner or admin can (de)activate a tenant. When set, the
--    auth middleware refuses to resolve any membership for that tenant, so its
--    users can no longer sign in — see middleware/auth.ts. Default NULL means
--    EVERY existing tenant keeps behaving exactly as before.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS created_by_partner uuid REFERENCES auth_users(id);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS suspended_at timestamptz;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS suspended_by uuid REFERENCES auth_users(id);
CREATE INDEX IF NOT EXISTS tenants_created_by_partner_idx
  ON tenants(created_by_partner) WHERE created_by_partner IS NOT NULL;

-- 3. Append-only audit of EVERY mutating operation on the partnership app.
--    Same RLS shape as partnership_members: service role only.
CREATE TABLE IF NOT EXISTS partnership_audit_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid NOT NULL REFERENCES auth_users(id),
  actor_role    text NOT NULL,
  action        text NOT NULL CHECK (action IN (
                  'tenant.create', 'tenant.update_limits', 'tenant.suspend',
                  'tenant.resume', 'tenant.admin_reinvite',
                  'partner.create', 'partner.update_caps',
                  'partner.activate', 'partner.deactivate')),
  target_type   text CHECK (target_type IS NULL OR target_type IN ('tenant', 'partner')),
  target_id     uuid,
  target_label  text,
  before        jsonb,
  after         jsonb,
  ip            text,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS partnership_audit_actor_idx
  ON partnership_audit_log(actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS partnership_audit_target_idx
  ON partnership_audit_log(target_type, target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS partnership_audit_created_idx
  ON partnership_audit_log(created_at DESC);
ALTER TABLE partnership_audit_log ENABLE ROW LEVEL SECURITY;

-- 4. Seed the first platform admin (super-admin). Conditional: only if the email
--    is already mirrored in auth_users. On prod the operator runs the admin-API
--    seed (DEPLOY notes) so the account exists before this matches; re-running is
--    idempotent via ON CONFLICT.
INSERT INTO partnership_members (user_id, role)
  SELECT id, 'admin' FROM auth_users WHERE email = 'michele.lucchese@outlook.it'
  ON CONFLICT (user_id) DO NOTHING;
