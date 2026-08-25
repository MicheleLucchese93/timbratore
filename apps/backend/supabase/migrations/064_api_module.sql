-- API: the module that lets a company's own systems talk to sonoQui.
--
-- WHY IT EXISTS. Everything in sonoQui is reachable from the web app, the phone
-- app, or an export file — all three of which need a person. The customers who
-- ask for this one do not have a person to spare: a gestionale that already
-- knows the staff list wants to push it in rather than have somebody retype it,
-- a badge reader at the gate wants to file punches, a BI dashboard wants last
-- month's hours every night at three. That is what an API key buys: a
-- credential that belongs to the COMPANY rather than to an employee, and that
-- a machine can hold.
--
-- SHAPE OF THE CREDENTIAL. One row here per key. The token handed to the
-- customer is `sq_live_<key_id>_<secret>`: the first two segments are the
-- public half (they identify the row and are safe to print in a log or a
-- settings screen), the last is 32 random bytes we hash and then forget. So:
--   key_id       the lookup handle. UNIQUE — it is what the request presents.
--   secret_hash  sha256 of the secret half. There is no path back to the token;
--                a customer who loses theirs creates a new key. Deliberate: a
--                "show me the key again" button is a permanent copy of a live
--                credential sitting in a database we back up.
--   last_four    four characters of the secret, for "is this the key that broke
--                at 3am?" — not enough to be worth stealing.
-- The column grants in §5 are the load-bearing half of that promise: the `app`
-- role (every web request) may INSERT secret_hash and may never SELECT it, so
-- the tenant CRUD in routes/api-keys.ts cannot leak it even by accident.
--
-- WHAT A KEY MAY DO. `scopes`, a text[] of `resource:read` / `resource:write`
-- pairs chosen when the key is made. NOT constrained to an enum here: the scope
-- list is an application concern (API_SCOPES in the shared package) and a CHECK
-- would turn adding a resource into a migration. The API validates against that
-- list on every request, and a key with no scopes cannot exist.
--
-- WHO MAY MAKE ONE. Tenant admins, and only while the module is on. There is no
-- per-user module role here (unlike Cantieri): a key is company infrastructure
-- and the people who configure the company are the admins. Every create, edit
-- and revoke lands in the tenant Registro attività.
--
-- A KEY IS NEVER A PERSON. It carries no user_id. Its requests still run under
-- ordinary RLS as the ordinary `app` role (see §3b and lib/db.ts withApiRLS) —
-- what stands in for the missing membership is a GUC that makes auth.is_admin()
-- true for that ONE tenant, never a service-role connection with hand-written
-- tenant predicates. So a key cannot reach past its own company even if a
-- handler forgets a WHERE, `auth.uid()` matches nobody so nothing own-scoped
-- opens up, and revoking a key takes effect on its next request — there is no
-- session to expire.

-- ── 1. Tenant feature flag (partner-console controlled) ────────────────────
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS api_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN tenants.api_enabled IS
  'Is the API module active for this company. Set from the partner console; gates both the Settings section and every /api/public/v1 request.';

-- ── 2. Partner permission ──────────────────────────────────────────────────
-- May this partner switch the module on for their tenants? Platform admins are
-- unlimited (caps only bind role='partner'), same as may_enable_cantieri.
ALTER TABLE partnership_members
  ADD COLUMN IF NOT EXISTS may_enable_api boolean NOT NULL DEFAULT false;

-- ── 3. api_keys ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS api_keys (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- What the customer calls it: "Gestionale Zucchetti", "Tornello ingresso".
  -- Shown in the key list and in every audit row, so a revoke is legible.
  name        text NOT NULL CHECK (length(btrim(name)) > 0),
  -- Public half of the token. UNIQUE because it is the lookup key: two rows
  -- answering to one handle would make authentication ambiguous.
  key_id      text NOT NULL UNIQUE CHECK (key_id ~ '^[0-9a-f]{16}$'),
  -- sha256(secret), hex. The secret is 32 bytes from a CSPRNG, so a plain
  -- digest is right here: there is no low-entropy guess to slow down, and a
  -- per-request KDF would put a deliberate delay on the hot path.
  secret_hash text NOT NULL,
  -- Last four characters of the secret. Identification, not authentication.
  last_four   text NOT NULL CHECK (length(last_four) = 4),
  -- resource:read / resource:write. Validated against API_SCOPES in the app,
  -- not by a CHECK — see the header.
  scopes      text[] NOT NULL CHECK (cardinality(scopes) > 0),
  -- Per-key ceiling, requests per minute. Lives on the row rather than in env
  -- so a customer whose nightly job needs more can be raised alone.
  rate_limit_per_min int NOT NULL DEFAULT 120 CHECK (rate_limit_per_min BETWEEN 1 AND 6000),
  -- Optional hard expiry. NULL = until revoked.
  expires_at  timestamptz,
  -- The admin who created it, and their name frozen at write time. NOT
  -- foreign-keyed, and the label is why: the person who wired the integration
  -- may be gone from the company long before the integration is, and "created
  -- by (deleted user)" is a worse answer than the name they had.
  created_by       uuid,
  created_by_label text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  -- Written by the API itself, at most once a minute per key (the middleware
  -- throttles it): "this key is still in use" is worth a write, one per call is
  -- not. last_used_ip answers "which of our servers is still holding it".
  last_used_at timestamptz,
  last_used_ip text,
  -- Revocation is a tombstone, not a DELETE: the audit trail of what a key did
  -- has to outlive the key. A revoked row can never authenticate again.
  revoked_at  timestamptz,
  revoked_by  uuid,
  CONSTRAINT api_keys_revoked_by_needs_revoked_at
    CHECK (revoked_by IS NULL OR revoked_at IS NOT NULL)
);

COMMENT ON TABLE api_keys IS
  'Machine credentials for the API module. One row per key; the token itself is never stored, only sha256 of its secret half.';
COMMENT ON COLUMN api_keys.secret_hash IS
  'sha256 of the secret half of the token. The app role may INSERT this column and may NEVER SELECT it (see grants).';
COMMENT ON COLUMN api_keys.scopes IS
  'resource:read / resource:write grants. Validated against API_SCOPES in @sonoqui/shared, deliberately not by a CHECK constraint.';

-- The key list, newest first — the only read shape the Settings section has.
CREATE INDEX IF NOT EXISTS api_keys_tenant_idx
  ON api_keys(tenant_id, created_at DESC);
-- Authentication looks a key up by its public handle and cares only about live
-- ones. Partial so the index does not carry years of revoked keys.
CREATE INDEX IF NOT EXISTS api_keys_live_idx
  ON api_keys(key_id) WHERE revoked_at IS NULL;

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  -- SELECT is the company, not just its admins — and that is deliberate.
  --
  -- The obvious policy is `AND auth.is_admin()`, and it was the first one here.
  -- It breaks the thing this module owes an employee. When an integration
  -- edits or strikes somebody's punch, the actor recorded is the KEY's id, and
  -- every surface that names an author — the Timbrature list, the day dossier
  -- and its PDF, the stamps_history trail, the Rettifiche sheet of the payroll
  -- export — resolves that id with a LEFT JOIN onto this table. Under an
  -- admin-only policy those joins return nothing for the employee reading their
  -- own record, so the one person entitled to ask "who moved my clock-out?"
  -- sees a blank where the answer should be.
  --
  -- What is actually confidential here is the SECRET, and that is defended one
  -- layer down by the column grants in §5, not by this policy: no app
  -- connection can read secret_hash at all, admin or not. What is left — a
  -- name, a scope list, when it was last used — is a description of the
  -- company's own integrations, which the company's staff may see.
  --
  -- WRITES stay admin-only (the INSERT/UPDATE policies below), and the only
  -- route that lists keys is gated on requireApiModule, which requires the
  -- admin role. So this widens what a JOIN can resolve, not what anyone can do
  -- or reach. (A read-only partner support session also satisfies
  -- auth.tenant_id() for its one pinned tenant — migration 058 — which is
  -- intended: an operator diagnosing a customer can see which integrations
  -- exist, and still cannot see a secret or write anything.)
  DROP POLICY IF EXISTS api_keys_select ON api_keys;
  CREATE POLICY api_keys_select ON api_keys
    FOR SELECT TO PUBLIC
    USING (tenant_id = auth.tenant_id());

  -- WITH CHECK pins the tenant so a key can never be minted into another
  -- company, whatever the handler passed.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='api_keys' AND policyname='api_keys_insert') THEN
    CREATE POLICY api_keys_insert ON api_keys
      FOR INSERT TO PUBLIC
      WITH CHECK (tenant_id = auth.tenant_id() AND auth.is_admin());
  END IF;

  -- Rename, re-scope, revoke. WHICH columns is answered by the grants below;
  -- this only answers which rows.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='api_keys' AND policyname='api_keys_update') THEN
    CREATE POLICY api_keys_update ON api_keys
      FOR UPDATE TO PUBLIC
      USING (tenant_id = auth.tenant_id() AND auth.is_admin())
      WITH CHECK (tenant_id = auth.tenant_id() AND auth.is_admin());
  END IF;
  -- No DELETE policy, on purpose: a key is revoked, never removed, so the
  -- Registro entry that says what it was still resolves to a row.
END $$;

-- Keep updated_at honest without every handler remembering to set it.
CREATE OR REPLACE FUNCTION api_keys_touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS api_keys_touch ON api_keys;
CREATE TRIGGER api_keys_touch BEFORE UPDATE ON api_keys
  FOR EACH ROW EXECUTE FUNCTION api_keys_touch_updated_at();

-- ── 3b. auth.is_admin() also accepts an API-key context ────────────────────
--
-- WHY THE API RUNS UNDER RLS AT ALL. The obvious shortcut for a machine surface
-- is the service role plus a hand-written `tenant_id = $1` on every query. That
-- works right up until the one query that forgets, and there is no second line
-- of defence behind it. So the public API instead connects as the ordinary
-- `app` role with app.current_tenant_id set, exactly like a web request: RLS
-- filters every table by tenant, and a missing predicate is a bug that returns
-- too little rather than another company's data.
--
-- What a key lacks is a membership, and admin-scoped policies resolve through
-- auth.is_admin(), which requires one. The GUC below closes that gap the same
-- way migration 058 did for read-only support sessions, with the same two
-- safety properties:
--   * it is set ONLY by withApiRLS (lib/db.ts), inside the transaction, and
--     only to the tenant the presented key belongs to;
--   * it must EQUAL auth.tenant_id(), so it can never widen the tenant scope —
--     RLS still filters everything by tenant_id = auth.tenant_id().
--
-- app.current_user_id is set to the KEY's id, not a person's. auth.uid() then
-- matches no membership, so own-scoped policies ("my own leave requests")
-- resolve to nothing for a key — which is correct: a key is not an employee and
-- has no "own" data. It also means every audit row a key writes carries the key
-- id as its actor, which is what routes/audit.ts renders as "API · <key name>".
CREATE OR REPLACE FUNCTION auth.is_admin() RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE
  uid uuid := auth.uid();
  tid uuid := auth.tenant_id();
  sup uuid := NULLIF(current_setting('app.support_tenant', true), '')::uuid;
  api uuid := NULLIF(current_setting('app.api_tenant', true), '')::uuid;
BEGIN
  IF tid IS NOT NULL AND sup IS NOT NULL AND sup = tid THEN
    RETURN TRUE;
  END IF;
  IF tid IS NOT NULL AND api IS NOT NULL AND api = tid THEN
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

-- ── 3c. `api` becomes a punch source ───────────────────────────────────────
--
-- A punch filed by a badge reader is not an employee tapping the app and not an
-- admin typing a correction: it has its own provenance, and every surface that
-- reads `source` — the Timbrature list, the contestation dossier, the Rettifiche
-- sheet of the payroll export — should say so rather than call it something it
-- is not. The constraint is replaced wholesale, so this carries the WHOLE list
-- (last set by migration 033) plus the new value; §6 round-trips both a new and
-- an old one so an out-of-order re-run that dropped an earlier value fails loudly.
ALTER TABLE stamps DROP CONSTRAINT IF EXISTS stamps_source_check;
ALTER TABLE stamps ADD CONSTRAINT stamps_source_check
  CHECK (source IN ('employee_app', 'employee_correction', 'admin_manual', 'system_auto', 'api'));

-- ── 3d. module tables the API must be able to READ ─────────────────────────
--
-- auth.is_admin() is not enough for two of them, and finding out at runtime
-- would have meant an integration that returns an empty array forever with a
-- 200. Cantieri and Bacheca are addressed at a PERSON: their SELECT policies
-- ask "is this row assigned to / targeted at auth.uid()", because the surfaces
-- that read them across the whole company (the Cantieri dashboard, the Bacheca
-- admin list) are served on the service role instead. An API key's uid matches
-- nobody, so every one of those reads would come back empty.
--
-- The narrowest fix is an api_tenant branch on exactly those policies, so:
--   * nothing changes for any existing caller — a person, and a partner support
--     session, both leave app.api_tenant unset and see precisely what they saw
--     before;
--   * the branch is still tenant-bounded, because app.api_tenant is only ever
--     set to the key's own tenant (lib/db.ts withApiRLS) and is checked against
--     this table's tenant_id;
--   * the alternative — widening these policies to auth.is_admin() — would ALSO
--     have handed every read-only partner support session the whole company's
--     site activity and bulletin readership, which is a posture change nobody
--     asked for.
--
-- Deliberately SELECT only. The API is read-only on both modules (see
-- API_READ_ONLY_RESOURCES): a site entry may only be filed by somebody assigned
-- to that site, and that check lives in the INSERT policy, which is untouched.
CREATE OR REPLACE FUNCTION auth.api_reads(row_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT row_tenant IS NOT NULL
     AND NULLIF(current_setting('app.api_tenant', true), '')::uuid = row_tenant
$$;

COMMENT ON FUNCTION auth.api_reads(uuid) IS
  'True inside an API-key request (lib/db.ts withApiRLS) for that key''s own tenant. Used to widen person-scoped SELECT policies to a company credential, never to widen the tenant scope.';

DO $$ BEGIN
  -- Cantieri: sites and vehicles are visible to their assignees, entries to
  -- their author. A key is neither.
  DROP POLICY IF EXISTS cantieri_select ON cantieri;
  CREATE POLICY cantieri_select ON cantieri
    FOR SELECT TO PUBLIC
    USING (
      tenant_id = auth.tenant_id() AND deleted_at IS NULL
      AND (
        auth.api_reads(tenant_id)
        OR EXISTS (SELECT 1 FROM cantiere_assignments ca
                    WHERE ca.cantiere_id = cantieri.id AND ca.user_id = auth.uid())
      )
    );

  DROP POLICY IF EXISTS mezzi_select ON mezzi;
  CREATE POLICY mezzi_select ON mezzi
    FOR SELECT TO PUBLIC
    USING (
      tenant_id = auth.tenant_id() AND deleted_at IS NULL
      AND (
        auth.api_reads(tenant_id)
        OR EXISTS (SELECT 1 FROM mezzo_assignments ma
                    WHERE ma.mezzo_id = mezzi.id AND ma.user_id = auth.uid())
      )
    );

  DROP POLICY IF EXISTS cantiere_entries_select ON cantiere_entries;
  CREATE POLICY cantiere_entries_select ON cantiere_entries
    FOR SELECT TO PUBLIC
    USING (
      tenant_id = auth.tenant_id()
      AND (auth.api_reads(tenant_id) OR user_id = auth.uid())
    );

  -- Bacheca: a message is visible to its addressees, and only while it is live.
  -- A key reads the ARCHIVE too — "what did we post in March" is a reporting
  -- question, and a policy that hides expired messages would answer it with
  -- silence. The live/expired window stays a QUERY filter (routes/public/comms.ts
  -- ?live=true) rather than a policy one for the API only.
  DROP POLICY IF EXISTS bulletins_select ON bulletins;
  CREATE POLICY bulletins_select ON bulletins
    FOR SELECT TO PUBLIC
    USING (
      tenant_id = auth.tenant_id() AND deleted_at IS NULL
      AND (
        auth.api_reads(tenant_id)
        OR (
          (start_at IS NULL OR start_at <= now())
          AND (end_at IS NULL OR end_at > now())
          AND (target_all OR EXISTS (SELECT 1 FROM bulletin_targets bt
                                      WHERE bt.bulletin_id = bulletins.id
                                        AND bt.user_id = auth.uid()))
        )
      )
    );

  -- Read receipts: own-only for a person (an employee must not see who else has
  -- read what), whole-company for a key — "has everybody opened the safety
  -- notice" is the compliance question the module exists to answer.
  DROP POLICY IF EXISTS bulletin_reads_select ON bulletin_reads;
  CREATE POLICY bulletin_reads_select ON bulletin_reads
    FOR SELECT TO PUBLIC
    USING (
      tenant_id = auth.tenant_id()
      AND (auth.api_reads(tenant_id) OR user_id = auth.uid())
    );

  DROP POLICY IF EXISTS bulletin_targets_select ON bulletin_targets;
  CREATE POLICY bulletin_targets_select ON bulletin_targets
    FOR SELECT TO PUBLIC
    USING (
      tenant_id = auth.tenant_id()
      AND (auth.api_reads(tenant_id) OR user_id = auth.uid())
    );
END $$;

-- ── 4. partnership audit actions ───────────────────────────────────────────
--
-- The constraint is replaced wholesale, so this file carries the WHOLE list
-- (last set by migration 061) plus the two new values. §6 round-trips both a
-- new action and an old one, so an out-of-order re-run that dropped an earlier
-- value fails loudly instead of silently.
ALTER TABLE partnership_audit_log DROP CONSTRAINT IF EXISTS partnership_audit_log_action_check;
ALTER TABLE partnership_audit_log
  ADD CONSTRAINT partnership_audit_log_action_check CHECK (action IN (
    'tenant.create', 'tenant.update_limits', 'tenant.suspend',
    'tenant.resume', 'tenant.admin_reinvite', 'tenant.change_admin',
    'tenant.add_admin', 'tenant.remove_admin', 'tenant.assign_partner',
    'tenant.update_note', 'tenant.delete',
    'tenant.cantieri_enable', 'tenant.cantieri_disable',
    -- Added here. Switching the API module on hands a company the ability to
    -- mint credentials that read its whole dataset, so who did it and when is
    -- exactly as worth recording as suspending them.
    'tenant.api_enable', 'tenant.api_disable',
    'tenant.support_access',
    'partner.create', 'partner.update_caps', 'partner.update_profile',
    'partner.activate', 'partner.deactivate', 'partner.resend',
    'ticket.status', 'ticket.assign', 'ticket.reply', 'ticket.note'));

-- ── 5. grants ──────────────────────────────────────────────────────────────
--
-- THE POINT OF THE COLUMN LIST. RLS answers "which rows"; it cannot say "which
-- columns". secret_hash is the one column on this table whose disclosure is the
-- whole failure: anybody holding it holds every key it protects. The `app` role
-- — which is what every web request connects as — can write it once and can
-- never read it back, so no SELECT *, no debug dump and no future handler in
-- routes/api-keys.ts can put it on the wire. Only sonoqui_owner (the service
-- role the API authenticates keys with) can read it.
--
-- THE REVOKE IS NOT DECORATION. infra/pg-init-sonoqui.sql runs
--   ALTER DEFAULT PRIVILEGES FOR ROLE sonoqui_owner IN SCHEMA public
--     GRANT ALL ON TABLES TO app;
-- and migrations run AS sonoqui_owner, so this table is BORN with a table-level
-- ALL for `app`. Column grants are ADDITIVE in Postgres — they never displace a
-- table-level grant — so without these two lines every column list below would
-- be documentation and `app` would keep full SELECT on secret_hash. It is also
-- why §6 asserts the property instead of assuming it: the LOCAL dev database's
-- default ACL names a different role, so a missing REVOKE passes on a laptop and
-- fails on production. Same construction as 061, which REVOKEs UPDATE before its
-- column grants for exactly this reason.
REVOKE ALL ON public.api_keys FROM app;
REVOKE ALL ON public.api_keys FROM PUBLIC;

GRANT SELECT (id, tenant_id, name, key_id, last_four, scopes, rate_limit_per_min,
              expires_at, created_by, created_by_label, created_at, updated_at,
              last_used_at, last_used_ip, revoked_at, revoked_by)
  ON public.api_keys TO app;
GRANT SELECT ON public.api_keys TO sonoqui_owner;

GRANT INSERT ON public.api_keys TO app, sonoqui_owner;

-- Rename, re-scope, retune the ceiling, set an expiry, revoke. NOT key_id and
-- NOT secret_hash: a key's identity and its secret are fixed at creation, which
-- is what makes "rotate" mean "create a new one and delete the old", and what
-- stops a compromised session from quietly re-pointing an existing credential.
GRANT UPDATE (name, scopes, rate_limit_per_min, expires_at, updated_at,
              revoked_at, revoked_by)
  ON public.api_keys TO app;
GRANT UPDATE ON public.api_keys TO sonoqui_owner;

-- ── 6. verification ────────────────────────────────────────────────────────
DO $$
DECLARE
  probe  uuid;
  srcdef text;
  pol    text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'tenants' AND column_name = 'api_enabled') THEN
    RAISE EXCEPTION 'tenants.api_enabled missing — the module could never be switched on';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'partnership_members' AND column_name = 'may_enable_api') THEN
    RAISE EXCEPTION 'partnership_members.may_enable_api missing — no partner could enable the module';
  END IF;

  -- The promise the whole design rests on. If a later migration ever hands the
  -- app role a blanket SELECT on this table, this is where it stops.
  IF has_column_privilege('app', 'public.api_keys', 'secret_hash', 'SELECT') THEN
    RAISE EXCEPTION 'app can SELECT api_keys.secret_hash — every API key in the database is one SELECT * away from the wire';
  END IF;
  IF has_column_privilege('app', 'public.api_keys', 'secret_hash', 'UPDATE') THEN
    RAISE EXCEPTION 'app can UPDATE api_keys.secret_hash — an existing credential could be silently re-pointed';
  END IF;
  IF has_column_privilege('app', 'public.api_keys', 'key_id', 'UPDATE') THEN
    RAISE EXCEPTION 'app can UPDATE api_keys.key_id — a key could be moved onto another row''s identity';
  END IF;
  IF NOT has_column_privilege('app', 'public.api_keys', 'secret_hash', 'INSERT') THEN
    RAISE EXCEPTION 'app cannot INSERT api_keys.secret_hash — no key could ever be created from the web app';
  END IF;
  IF NOT has_column_privilege('app', 'public.api_keys', 'revoked_at', 'UPDATE') THEN
    RAISE EXCEPTION 'app cannot UPDATE api_keys.revoked_at — a leaked key could not be revoked from the web app';
  END IF;

  -- RLS on, and scoped. A table with policies but RLS disabled reads as secure
  -- and is not.
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='api_keys' AND rowsecurity) THEN
    RAISE EXCEPTION 'api_keys has RLS disabled — every tenant would see every other tenant''s keys';
  END IF;
  -- Reads are tenant-scoped (not admin-scoped — see the policy's own note on
  -- why the employee-facing contestation trail needs the join to resolve).
  -- What must never slip is the tenant bound itself.
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname='public' AND tablename='api_keys'
                    AND policyname='api_keys_select' AND qual LIKE '%tenant_id%') THEN
    RAISE EXCEPTION 'api_keys_select is not tenant-scoped — one company could read another''s keys';
  END IF;
  -- Writes stay admin-only. This is the half that must not drift.
  FOREACH pol IN ARRAY ARRAY['api_keys_insert', 'api_keys_update'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                    WHERE schemaname='public' AND tablename='api_keys'
                      AND policyname = pol AND with_check LIKE '%is_admin%') THEN
      RAISE EXCEPTION '% no longer requires an admin — any employee could mint or re-scope a company credential', pol;
    END IF;
  END LOOP;

  -- Both non-membership admin contexts must still be honoured. Dropping the
  -- support branch while adding the API one would silently break every partner
  -- support session; dropping the API branch would make every key read empty.
  IF pg_get_functiondef('auth.is_admin()'::regprocedure) NOT LIKE '%app.api_tenant%' THEN
    RAISE EXCEPTION 'auth.is_admin() does not honour app.api_tenant — every API key would read zero rows';
  END IF;
  IF pg_get_functiondef('auth.is_admin()'::regprocedure) NOT LIKE '%app.support_tenant%' THEN
    RAISE EXCEPTION 'auth.is_admin() lost app.support_tenant — partner support sessions would read zero rows';
  END IF;

  -- The punch-source constraint. A missing constraint would make both LIKE
  -- checks below vacuously true (pg_get_constraintdef returns NULL, NULL NOT
  -- LIKE … is NULL, which is not TRUE), so its existence is asserted first.
  SELECT pg_get_constraintdef(oid) INTO srcdef
    FROM pg_constraint WHERE conname = 'stamps_source_check';
  IF srcdef IS NULL THEN
    RAISE EXCEPTION 'stamps_source_check is missing — any value would be accepted as a punch source';
  END IF;
  IF srcdef NOT LIKE '%''api''%' THEN
    RAISE EXCEPTION 'stamps.source does not accept ''api'' — the API could never file a punch';
  END IF;
  IF srcdef NOT LIKE '%''system_auto''%' THEN
    RAISE EXCEPTION 'stamps_source_check lost ''system_auto'' — the auto clock-out job would start failing';
  END IF;

  -- The module tables the API reads (§3d). A policy that lost its api_tenant
  -- branch does not error — it returns an empty array with a 200, which is the
  -- worst possible failure for an integration.
  FOREACH pol IN ARRAY ARRAY['cantieri_select', 'mezzi_select', 'cantiere_entries_select',
                             'bulletins_select', 'bulletin_reads_select', 'bulletin_targets_select'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                    WHERE schemaname = 'public' AND policyname = pol
                      AND qual LIKE '%api_reads%') THEN
      RAISE EXCEPTION '% no longer honours an API-key context — that resource would read empty forever', pol;
    END IF;
  END LOOP;

  -- The audit constraint, round-tripped: one value from this migration and one
  -- from 061, so an out-of-order re-run that dropped the older list is caught.
  SELECT id INTO probe FROM auth_users LIMIT 1;
  IF probe IS NOT NULL THEN
    BEGIN
      INSERT INTO partnership_audit_log (actor_user_id, actor_role, action, target_type)
        VALUES (probe, 'migration-probe', 'tenant.api_enable', 'tenant'),
               (probe, 'migration-probe', 'ticket.reply', 'ticket');
      DELETE FROM partnership_audit_log WHERE actor_role = 'migration-probe';
    EXCEPTION WHEN check_violation THEN
      RAISE EXCEPTION 'partnership_audit_log rejects an api action or dropped an earlier one';
    END;
  END IF;
END $$;
