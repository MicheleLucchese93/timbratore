-- In-app notification feed backing the mobile notification bell.
--
-- Until now the bell was DERIVED on the client from /leaves + /correction-requests,
-- so notifications without a backing leave/correction row (new document, leave
-- reminder, company event) were pushed/emailed but NEVER shown in the bell, and
-- read-state lived only on the device (no cross-device sync). This table is the
-- source of truth: the server notification pipeline (lib/notifications.ts) inserts
-- one localized row per recipient for EVERY notify* event, and the mobile bell
-- reads from it via GET /api/v1/notifications.
--
-- `data` mirrors the push payload (kind + ids) so a tapped notification deep-links
-- to the same place as a tapped push. `route` is the mobile tab to open
-- ('richieste' | 'correzioni' | 'documenti'). `read_at` replaces the old
-- device-local read set, so marking read syncs across a user's devices.
--
-- Title/body are localized for the recipient AT SEND TIME (each user may differ),
-- mirroring how pushes are localized — so the stored strings need no further i18n.

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL,                       -- recipient
  kind text NOT NULL,                          -- mirrors push data.kind (leave_decided, document, ...)
  title text NOT NULL,
  body text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,      -- push payload (ids, decision) for deep-link
  route text,                                   -- mobile tab: richieste | correzioni | documenti
  source_id uuid,                               -- leave/correction/document id (dedupe + deep-link)
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx
  ON notifications(tenant_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_unread_idx
  ON notifications(tenant_id, user_id) WHERE read_at IS NULL;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  -- A notification belongs to its recipient: each caller sees / updates only
  -- their own rows within their tenant. There is deliberately NO app-role INSERT
  -- policy — rows are written exclusively by the server notification pipeline on
  -- the service role (adminPool, which bypasses RLS), never by a client. So even
  -- a bug in the API cannot let one user fabricate another user's notification.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='notifications' AND policyname='notifications_select') THEN
    CREATE POLICY notifications_select ON notifications
      FOR SELECT TO PUBLIC
      USING (tenant_id = auth.tenant_id() AND user_id = auth.uid());
  END IF;
  -- UPDATE is scoped to read_at (mark-as-read); the policy keeps it to own rows.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='notifications' AND policyname='notifications_update') THEN
    CREATE POLICY notifications_update ON notifications
      FOR UPDATE TO PUBLIC
      USING (tenant_id = auth.tenant_id() AND user_id = auth.uid())
      WITH CHECK (tenant_id = auth.tenant_id() AND user_id = auth.uid());
  END IF;
END $$;

-- The app role reads its own rows and flips read_at; INSERT is intentionally
-- withheld (rows are written only by the service role / table owner via
-- adminPool). Explicit grant — mirrors migration 026 — so access does not depend
-- on default-privilege configuration. RLS above still scopes every row to the
-- caller. sonoqui_owner already owns the table; granted for parity.
GRANT SELECT, UPDATE ON public.notifications TO app, sonoqui_owner;
