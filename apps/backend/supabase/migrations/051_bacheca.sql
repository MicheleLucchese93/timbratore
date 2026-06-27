-- Bacheca: company bulletin board.
--
-- An admin composes a rich-text message (HTML, sanitized server-side) and
-- publishes it to ALL members or a chosen subset, optionally scheduled between
-- start_at and end_at. Every member (admin + user) reads live messages from
-- their Bacheca surface (web Dashboard/MyDashboard section + dedicated mobile
-- tab) and explicitly marks each one read; the admin sees how many — and who —
-- have read it.
--
-- Targeting:
--   target_all = true  -> every active member, INCLUDING those who join later
--                         (resolved live, no recipient rows).
--   target_all = false -> exactly the users in bulletin_targets.
--
-- Visibility (the SELECT RLS predicate): not deleted, inside the [start_at,
-- end_at) window, and either target_all or the caller has a bulletin_targets
-- row. Admin management (list-all incl. drafts/expired, read counts, who-read)
-- is served server-side on the service role (adminPool), never through RLS —
-- mirroring the documents feature (migrations 041/042).
--
-- Notifications (email + push) fire ONCE at publish to the recipients existing
-- then; they are admin-controlled per message (notify_email / notify_push) and
-- mandatory for recipients (no per-user opt-out). There is deliberately NO bell
-- (notifications table) row — the Bacheca surface is its own read-state home.

CREATE TABLE IF NOT EXISTS bulletins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  title text NOT NULL,                          -- plain text: list heading + email subject + push title
  body_html text NOT NULL,                      -- sanitized HTML (server-side allowlist)
  target_all boolean NOT NULL DEFAULT true,
  start_at timestamptz,                          -- null = live immediately
  end_at timestamptz,                            -- null = never expires
  notify_email boolean NOT NULL DEFAULT true,    -- admin per-message channel toggle
  notify_push boolean NOT NULL DEFAULT true,
  -- Set once the publish notification (email/push) has gone out. NULL = pending.
  -- Immediate posts are notified inline at create; future-scheduled posts are
  -- picked up by the activation cron when start_at passes. Dedupes both paths.
  notified_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS bulletins_tenant_idx
  ON bulletins(tenant_id, created_at DESC) WHERE deleted_at IS NULL;
-- Scan target for the activation cron (find live, not-yet-notified messages).
CREATE INDEX IF NOT EXISTS bulletins_pending_notify_idx
  ON bulletins(start_at) WHERE notified_at IS NULL AND deleted_at IS NULL;

-- Explicit recipients; only present when target_all = false.
CREATE TABLE IF NOT EXISTS bulletin_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  bulletin_id uuid NOT NULL REFERENCES bulletins(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  UNIQUE (bulletin_id, user_id)
);
CREATE INDEX IF NOT EXISTS bulletin_targets_user_idx
  ON bulletin_targets(tenant_id, user_id);

-- Read receipts: one row the first time a member marks a message read.
CREATE TABLE IF NOT EXISTS bulletin_reads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  bulletin_id uuid NOT NULL REFERENCES bulletins(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  read_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bulletin_id, user_id)
);
CREATE INDEX IF NOT EXISTS bulletin_reads_bulletin_idx
  ON bulletin_reads(bulletin_id);

ALTER TABLE bulletins ENABLE ROW LEVEL SECURITY;
ALTER TABLE bulletin_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE bulletin_reads ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  -- Bulletins: a member sees a message only when it is live and addressed to
  -- them (all, or an explicit target). Authoring / editing / deleting happens on
  -- the service role (adminPool) by an admin, so there is intentionally NO
  -- app-role INSERT/UPDATE/DELETE policy here — a client can never fabricate or
  -- alter a bulletin even via a bug. The EXISTS subquery is itself RLS-filtered
  -- (bulletin_targets exposes only the caller's own rows), so it can only ever
  -- confirm the caller's OWN target row.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='bulletins' AND policyname='bulletins_select') THEN
    CREATE POLICY bulletins_select ON bulletins
      FOR SELECT TO PUBLIC
      USING (
        tenant_id = auth.tenant_id()
        AND deleted_at IS NULL
        AND (start_at IS NULL OR start_at <= now())
        AND (end_at IS NULL OR end_at > now())
        AND (
          target_all
          OR EXISTS (
            SELECT 1 FROM bulletin_targets bt
             WHERE bt.bulletin_id = bulletins.id
               AND bt.user_id = auth.uid()
          )
        )
      );
  END IF;

  -- Targets: each caller sees only their own target rows (used by the EXISTS
  -- above). Written only by the service role; no app-role write policy.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='bulletin_targets' AND policyname='bulletin_targets_select') THEN
    CREATE POLICY bulletin_targets_select ON bulletin_targets
      FOR SELECT TO PUBLIC
      USING (tenant_id = auth.tenant_id() AND user_id = auth.uid());
  END IF;

  -- Reads: a receipt belongs to the member who marked the message read. Each
  -- caller reads / writes only their own rows within their tenant. The admin
  -- "who read" aggregate is computed server-side on the service role.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='bulletin_reads' AND policyname='bulletin_reads_select') THEN
    CREATE POLICY bulletin_reads_select ON bulletin_reads
      FOR SELECT TO PUBLIC
      USING (tenant_id = auth.tenant_id() AND user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='bulletin_reads' AND policyname='bulletin_reads_insert') THEN
    CREATE POLICY bulletin_reads_insert ON bulletin_reads
      FOR INSERT TO PUBLIC
      WITH CHECK (tenant_id = auth.tenant_id() AND user_id = auth.uid());
  END IF;
END $$;

-- Explicit grants (mirror migrations 026/043): the app role reads visible
-- bulletins + its own target/read rows and inserts its own read receipts.
-- Authoring is service-role only. RLS above still scopes every row to the caller.
GRANT SELECT ON public.bulletins TO app, sonoqui_owner;
GRANT SELECT ON public.bulletin_targets TO app, sonoqui_owner;
GRANT SELECT, INSERT ON public.bulletin_reads TO app, sonoqui_owner;
