-- Self-service signup + Stripe billing (Specs/SELF_SERVICE_BILLING.md).
--
-- A company can now register itself from the website, start on a Free plan,
-- and pay with Stripe for a plan (Piccola/Media) and for modules (Cantieri, API).
-- The entitlement columns that every create path already enforces
-- (tenants.max_*, cantieri_enabled, api_enabled) stay exactly where they are:
-- for a self-service company they are DERIVED from what it pays for and written
-- only by the billing code on the service role. Everything else lives in new
-- tables that the per-request `app` role cannot touch at all.
--
-- Deploy order (same trap as 058/064): /me selects the new tenant columns, so
-- this migration must be applied from the NEW image before `up -d`.

-- ── 1. tenants: provenance, billing ownership, plan ───────────────────────
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS signup_source text NOT NULL DEFAULT 'partner'
    CHECK (signup_source IN ('partner', 'self_service')),
  -- managed = partner/super-user set caps and modules by hand (every tenant
  -- that existed before this migration). stripe = derived from subscriptions.
  ADD COLUMN IF NOT EXISTS billing_mode text NOT NULL DEFAULT 'managed'
    CHECK (billing_mode IN ('managed', 'stripe')),
  ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'custom'
    CHECK (plan IN ('free', 'piccola', 'media', 'custom')),
  -- Super-user courtesy extras merged on top of the subscriptions (max for
  -- caps, OR for flags). Never lowers anything that was paid for.
  ADD COLUMN IF NOT EXISTS entitlement_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Set when a downgrade leaves the company above its caps; drives the 14-day
  -- grace banner and, after it, the export lock. NULL = within limits.
  ADD COLUMN IF NOT EXISTS over_limit_since timestamptz,
  ADD COLUMN IF NOT EXISTS over_limit_notices smallint NOT NULL DEFAULT 0,
  -- The paid plan picked on the website ("Inizia ora" on Piccola/Media) but not
  -- paid yet: the app shows "Completa l'attivazione" until a plan is active.
  ADD COLUMN IF NOT EXISTS pending_plan text
    CHECK (pending_plan IS NULL OR pending_plan IN ('piccola', 'media'));

COMMENT ON COLUMN tenants.billing_mode IS
  'managed: caps/modules edited by hand in the partner console. stripe: derived from Stripe subscriptions by applyEntitlements().';

-- One self-service company per P.IVA. The API also refuses a P.IVA that any
-- non-deleted tenant already carries (partner-managed included); this index is
-- the race-proof backstop for two concurrent registrations.
CREATE UNIQUE INDEX IF NOT EXISTS tenants_self_service_piva_uq
  ON tenants (partita_iva)
  WHERE signup_source = 'self_service' AND deleted_at IS NULL AND partita_iva IS NOT NULL;

-- ── 2. DB guard on entitlement columns ─────────────────────────────────────
-- tenants_self_update (002) lets a tenant admin UPDATE any column of their own
-- row through the RLS pool; only the Zod whitelist in PATCH /settings stood
-- between an admin and `max_users = 9999`. Now that these columns are paid
-- entitlements that is not enough. The request context is recognised two ways,
-- because the local dev database connects as a superuser rather than `app`:
-- the role, or the tenant GUC that only withTenantRLS/withSupportRLS/withApiRLS
-- set. The service role (partner console, webhook, cron) sets neither.
CREATE OR REPLACE FUNCTION tenants_guard_entitlements() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (current_user = 'app'
      OR COALESCE(current_setting('app.current_tenant_id', true), '') <> '')
     AND (NEW.max_users IS DISTINCT FROM OLD.max_users
       OR NEW.max_admins IS DISTINCT FROM OLD.max_admins
       OR NEW.max_branches IS DISTINCT FROM OLD.max_branches
       OR NEW.max_documentali IS DISTINCT FROM OLD.max_documentali
       OR NEW.cantieri_enabled IS DISTINCT FROM OLD.cantieri_enabled
       OR NEW.api_enabled IS DISTINCT FROM OLD.api_enabled
       OR NEW.plan IS DISTINCT FROM OLD.plan
       OR NEW.billing_mode IS DISTINCT FROM OLD.billing_mode
       OR NEW.signup_source IS DISTINCT FROM OLD.signup_source
       OR NEW.entitlement_overrides IS DISTINCT FROM OLD.entitlement_overrides
       OR NEW.over_limit_since IS DISTINCT FROM OLD.over_limit_since
       OR NEW.created_by_partner IS DISTINCT FROM OLD.created_by_partner
       OR NEW.suspended_at IS DISTINCT FROM OLD.suspended_at
       OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at) THEN
    RAISE EXCEPTION 'tenant entitlement/ownership columns are not writable from a tenant request'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tenants_guard_entitlements ON tenants;
CREATE TRIGGER tenants_guard_entitlements BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION tenants_guard_entitlements();

-- ── 3. signup requests (registration → email confirmation → company) ───────
-- Nothing else exists until the email is confirmed: no GoTrue account, no
-- tenant. Company data is NOT stored here; it goes straight onto the tenant and
-- the billing profile at step 3.
CREATE TABLE IF NOT EXISTS signup_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'email_confirmed', 'company_created', 'expired', 'rejected')),
  -- new = no confirmed account for this email yet (password chosen at
  -- confirmation); existing = a confirmed account exists (the user logs in).
  mode text NOT NULL CHECK (mode IN ('new', 'existing')),
  email text NOT NULL,
  first_name text NOT NULL,
  last_name text NOT NULL,
  phone text,
  plan_hint text CHECK (plan_hint IS NULL OR plan_hint IN ('piccola', 'media')),
  utm jsonb,
  consents jsonb NOT NULL,
  language text NOT NULL DEFAULT 'it' CHECK (language IN ('it', 'en')),
  ip inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_sent_at timestamptz NOT NULL DEFAULT now(),
  send_count int NOT NULL DEFAULT 1,
  email_confirmed_at timestamptz,
  user_id uuid REFERENCES auth_users(id) ON DELETE SET NULL,
  reminder_count int NOT NULL DEFAULT 0,
  last_reminder_at timestamptz,
  company_created_at timestamptz,
  tenant_id uuid REFERENCES tenants(id),
  rejected_at timestamptz,
  rejected_by uuid,
  reject_reason text
);
CREATE INDEX IF NOT EXISTS signup_requests_email_idx ON signup_requests (lower(email), created_at DESC);
CREATE INDEX IF NOT EXISTS signup_requests_user_idx ON signup_requests (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS signup_requests_status_idx ON signup_requests (status, created_at DESC);

-- ── 4. legal acceptances (who accepted what, when, from where) ────────────
CREATE TABLE IF NOT EXISTS legal_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES auth_users(id),
  document text NOT NULL
    CHECK (document IN ('tos', 'privacy_ack', 'dpa', 'art1341', 'powers', 'paid_terms', 'marketing')),
  version text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  ip inet,
  user_agent text
);
CREATE INDEX IF NOT EXISTS legal_acceptances_tenant_idx ON legal_acceptances (tenant_id, accepted_at DESC);
CREATE INDEX IF NOT EXISTS legal_acceptances_user_idx ON legal_acceptances (user_id, accepted_at DESC);

-- ── 5. billing profile (data for the fattura elettronica) ──────────────────
CREATE TABLE IF NOT EXISTS tenant_billing_profiles (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
  legal_name text NOT NULL,
  partita_iva text NOT NULL,
  codice_fiscale text,
  address text,
  cap text,
  city text,
  province text,
  country text NOT NULL DEFAULT 'IT',
  sdi_code text CHECK (sdi_code IS NULL OR sdi_code ~ '^[A-Z0-9]{7}$'),
  pec text,
  billing_email text,
  vat_status text NOT NULL CHECK (vat_status IN ('valid', 'not_in_vies', 'unavailable')),
  vies_name text,
  vies_address text,
  vies_request_id text,
  vies_checked_at timestamptz,
  headcount_band text CHECK (headcount_band IS NULL OR headcount_band IN ('1-3', '4-10', '11-20', '20+')),
  -- Super-user review of a not_in_vies / unavailable P.IVA (D2: accepted, flagged).
  vat_reviewed_at timestamptz,
  vat_reviewed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
CREATE INDEX IF NOT EXISTS tenant_billing_profiles_vat_idx
  ON tenant_billing_profiles (vat_status) WHERE vat_status <> 'valid';

-- ── 6. Stripe mirror ───────────────────────────────────────────────────────
-- Every Stripe object lives in exactly one mode (sandbox or live) and the API
-- runs one of them at a time (STRIPE_MODE). A company therefore has at most one
-- customer PER MODE, and every read that grants or lists something filters on
-- `livemode`: flipping the mode can never let a sandbox purchase count in live.
CREATE TABLE IF NOT EXISTS billing_customers (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  livemode boolean NOT NULL,
  stripe_customer_id text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, livemode)
);

-- One row per Stripe subscription (D3: one per product line). Rebuilt from the
-- Stripe API on every relevant webhook, never from the event payload.
CREATE TABLE IF NOT EXISTS billing_subscriptions (
  stripe_subscription_id text PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  livemode boolean NOT NULL,
  product_line text NOT NULL,
  price_lookup_key text NOT NULL,
  status text NOT NULL,
  billing_interval text NOT NULL,
  quantity int NOT NULL DEFAULT 1,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  cancel_at timestamptz,
  canceled_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS billing_subscriptions_tenant_idx ON billing_subscriptions (tenant_id, livemode, status);

-- The "da fatturare" ledger: every paid Stripe invoice, with the billing data
-- as it was at payment time. Stripe's own invoice never reaches the customer;
-- the fattura elettronica is drafted from this row and marked here.
CREATE TABLE IF NOT EXISTS billing_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  stripe_invoice_id text NOT NULL UNIQUE,
  stripe_payment_intent_id text,
  stripe_charge_id text,
  livemode boolean NOT NULL DEFAULT false,
  paid_at timestamptz NOT NULL,
  currency text NOT NULL,
  net_cents int NOT NULL,
  tax_cents int NOT NULL,
  total_cents int NOT NULL,
  fee_cents int,
  period_start timestamptz,
  period_end timestamptz,
  lines jsonb NOT NULL,
  billing_snapshot jsonb NOT NULL,
  refunded_cents int NOT NULL DEFAULT 0,
  disputed boolean NOT NULL DEFAULT false,
  invoiced_at timestamptz,
  invoice_number text,
  invoice_date date,
  invoiced_by uuid,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS billing_payments_tenant_idx ON billing_payments (tenant_id, paid_at DESC);
CREATE INDEX IF NOT EXISTS billing_payments_todo_idx ON billing_payments (paid_at) WHERE invoiced_at IS NULL;

-- Webhook idempotency: Stripe delivers at-least-once.
CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  event_id text PRIMARY KEY,
  type text NOT NULL,
  livemode boolean NOT NULL DEFAULT false,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  error text
);

-- ── 7. grants: service role only ───────────────────────────────────────────
-- infra/pg-init-sonoqui.sql gives `app` table-level ALL on everything
-- sonoqui_owner creates (default ACL). None of these tables is ever read or
-- written through the per-request RLS pool, so the REVOKE is the whole point:
-- a SQL mistake in a tenant handler can never reach another company's billing
-- data, P.IVA or signup token. RLS is enabled with no policy as the second lock.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['signup_requests', 'legal_acceptances', 'tenant_billing_profiles',
                           'billing_customers', 'billing_subscriptions', 'billing_payments',
                           'stripe_webhook_events'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM app', t);
    END IF;
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC', t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sonoqui_owner') THEN
      EXECUTE format('GRANT ALL ON public.%I TO sonoqui_owner', t);
    END IF;
  END LOOP;
END $$;

-- ── 8. partnership audit actions + target types ────────────────────────────
-- Replaced wholesale: the whole 064 list plus the billing/signup actions.
ALTER TABLE partnership_audit_log DROP CONSTRAINT IF EXISTS partnership_audit_log_action_check;
ALTER TABLE partnership_audit_log
  ADD CONSTRAINT partnership_audit_log_action_check CHECK (action IN (
    'tenant.create', 'tenant.update_limits', 'tenant.suspend',
    'tenant.resume', 'tenant.admin_reinvite', 'tenant.change_admin',
    'tenant.add_admin', 'tenant.remove_admin', 'tenant.assign_partner',
    'tenant.update_note', 'tenant.delete',
    'tenant.cantieri_enable', 'tenant.cantieri_disable',
    'tenant.api_enable', 'tenant.api_disable',
    'tenant.support_access',
    'partner.create', 'partner.update_caps', 'partner.update_profile',
    'partner.activate', 'partner.deactivate', 'partner.resend',
    'ticket.status', 'ticket.assign', 'ticket.reply', 'ticket.note',
    -- Added here (self-service billing). All super-user only.
    'tenant.billing_mode_change', 'tenant.entitlement_override', 'tenant.vat_review',
    'tenant.stripe_cancel',
    'billing.payment_invoiced', 'billing.payment_uninvoiced',
    'signup.resend', 'signup.reject'));

ALTER TABLE partnership_audit_log DROP CONSTRAINT IF EXISTS partnership_audit_log_target_type_check;
ALTER TABLE partnership_audit_log
  ADD CONSTRAINT partnership_audit_log_target_type_check
  CHECK (target_type IS NULL OR target_type IN ('tenant', 'partner', 'ticket', 'signup', 'payment'));

-- ── 9. verification ────────────────────────────────────────────────────────
DO $$
DECLARE
  probe uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tenants_guard_entitlements') THEN
    RAISE EXCEPTION 'entitlement guard trigger missing';
  END IF;
  IF EXISTS (SELECT 1 FROM tenants WHERE billing_mode <> 'managed' OR signup_source <> 'partner') THEN
    -- Only possible on a re-run after self-service tenants exist; harmless then.
    RAISE NOTICE 'self-service tenants already present';
  END IF;
  -- Round-trip one new audit action and one from 064, so an out-of-order
  -- re-run that dropped the older list fails loudly.
  SELECT id INTO probe FROM auth_users LIMIT 1;
  IF probe IS NOT NULL THEN
    BEGIN
      INSERT INTO partnership_audit_log (actor_user_id, actor_role, action, target_type)
        VALUES (probe, 'migration-probe', 'billing.payment_invoiced', 'payment'),
               (probe, 'migration-probe', 'tenant.api_enable', 'tenant');
      DELETE FROM partnership_audit_log WHERE actor_role = 'migration-probe';
    EXCEPTION WHEN check_violation THEN
      RAISE EXCEPTION 'partnership_audit_log rejects a billing action or dropped an earlier one';
    END;
  END IF;
END $$;
