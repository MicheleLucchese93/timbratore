-- Support tickets: a conversation between a customer and whoever answers them.
--
-- WHAT EXISTED BEFORE. routes/helpdesk.ts, and only that: the website's contact
-- form rendered a message into an email, sent it to HELPDESK_TO and forgot it.
-- Nothing was stored, so an admin who wrote in could not see what they had
-- asked, we could not see what we had answered, and the reseller who provisioned
-- the tenant — the person the customer would phone — learned nothing at all.
--
-- WHAT THIS ADDS. A row per request, scoped to the tenant that raised it, plus a
-- thread of human replies in both directions and their attachments. The customer
-- reads and writes it from the web app ("Assistenza"); an operator works it from
-- the partner console ("Richieste"). The email path stays, but it is now a notice
-- ABOUT a stored conversation rather than the conversation itself.
--
-- WHO CAN RAISE AND READ ONE, on the customer's side: tenant ADMINS. A ticket is
-- the company's request about its subscription, not an employee's question about
-- their own timesheet (which is what Rettifiche and Richieste are for), and the
-- reseller answering it has no relationship with an individual employee. So the
-- SELECT policy is `tenant_id = auth.tenant_id() AND auth.is_admin()`: every
-- admin of the company sees every ticket the company opened, including ones a
-- colleague raised — a support conversation that only one of three admins can
-- read is a support conversation that stalls when that person is on holiday.
--
-- TWO STATUSES, AND THEY ARE INDEPENDENT.
--   status          — the CUSTOMER's opinion. `resolved` = "I no longer need an
--                     answer". Theirs to set and unset; it mails nobody.
--   handling_status — the TEAM's state: nuovo → in_lavorazione →
--                     in_attesa_cliente → risolto → chiuso, written only by the
--                     console.
-- Collapsing them would mean one party overwriting the other's statement.
--
-- WHAT AN OPERATOR CAN SEE, stated plainly because it is a disclosure: the
-- subject, the whole body, every reply and every attachment of the tenants they
-- manage. A ticket body can name an employee. That is the cost of a reseller
-- being able to answer at all, which is why every console write is audited in
-- partnership_audit_log (§4) and why the manuals say so on both sides.

-- ── 1. support_tickets ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS support_tickets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- The admin who opened it. auth_users, like every other actor column here.
  user_id     uuid NOT NULL REFERENCES auth_users(id),
  -- The human-quotable code from lib/ticket-ref.ts (SQ-YYYYMMDD-NNNN). UNIQUE
  -- because it is what a reply quotes: two rows answering to one code would make
  -- that reply ambiguous.
  ref         text NOT NULL UNIQUE,
  subject     text NOT NULL,
  -- What was actually asked. Stored, not just mailed — an operator working the
  -- console with a subject and a category and no body would have to open a
  -- mailbox, which is the thing this console exists not to need.
  body        text NOT NULL,
  -- Free-form triage hints, as the form sent them. NOT constrained to an enum:
  -- the category list is a UI concern (TICKET_CATEGORIES in the shared package)
  -- and a CHECK here would turn a copy edit into a migration.
  category    text,
  priority    text,
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  handling_status text NOT NULL DEFAULT 'nuovo'
    CHECK (handling_status IN ('nuovo', 'in_lavorazione', 'in_attesa_cliente', 'risolto', 'chiuso')),
  -- When the TEAM state last moved. Separate from updated_at, which any write
  -- touches: "how long has this been sitting in nuovo" cannot be answered from a
  -- column the customer's own resolve button also bumps.
  handling_updated_at timestamptz NOT NULL DEFAULT now(),
  -- The operator who took it. A real FK, unlike user_id columns elsewhere in
  -- this schema: partnership_members is ours. ON DELETE SET NULL so removing a
  -- member from the console does not take the ticket with them.
  assigned_to uuid REFERENCES partnership_members(user_id) ON DELETE SET NULL,
  -- Operator-only triage note. NEVER selected by the customer-facing routes and
  -- never quoted in a mail to them. This is the column that would leak the day
  -- somebody put `SELECT *` in routes/tickets.ts, which is why that file lists
  -- its columns explicitly.
  internal_note text,
  -- Denormalised from support_ticket_messages so both lists can sort by activity
  -- without a lateral per row. NULL = nothing beyond the original request.
  last_message_at timestamptz,
  -- Read receipts, one per side. They are what makes "2 nuove risposte" possible
  -- without a per-message read table: a message is unread when it was created
  -- after the other side last looked. The worst a lost update does is show a
  -- badge twice.
  user_last_read_at     timestamptz,
  operator_last_read_at timestamptz,
  resolved_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  -- The flag and its timestamp cannot disagree. Without this, a reopen that
  -- forgot to clear resolved_at would leave a row that reads as open while
  -- carrying a resolution date, and "when did they close it" would stop being
  -- answerable.
  CONSTRAINT support_tickets_resolved_at_matches_status
    CHECK ((status = 'resolved') = (resolved_at IS NOT NULL))
);

COMMENT ON TABLE support_tickets IS
  'One support request raised by a tenant admin from the web app, with the team''s handling state. Worked from the partner console.';
COMMENT ON COLUMN support_tickets.status IS
  'The CUSTOMER''s view: resolved means they no longer need an answer. Not a triage state.';
COMMENT ON COLUMN support_tickets.handling_status IS
  'The TEAM''s state, written only by the partner console. Independent of `status`.';
COMMENT ON COLUMN support_tickets.internal_note IS
  'Operator-only triage note. Never selected by the customer routes, never quoted in a mail to them.';

-- "This company's tickets, newest first" — the customer list's only read shape.
CREATE INDEX IF NOT EXISTS support_tickets_tenant_idx
  ON support_tickets(tenant_id, created_at DESC);
-- The console worklist: filter on handling_status before anything else.
CREATE INDEX IF NOT EXISTS support_tickets_handling_idx
  ON support_tickets(handling_status, created_at DESC);
-- "What is assigned to me". Partial: most tickets have no assignee and no query
-- wants those through this index.
CREATE INDEX IF NOT EXISTS support_tickets_assigned_idx
  ON support_tickets(assigned_to, handling_status) WHERE assigned_to IS NOT NULL;

ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  -- Every admin of the tenant, on their own tenant's tickets. Employees see
  -- none: auth.is_admin() is false for them, so the table simply does not exist
  -- from their connection. (A read-only partner support session also satisfies
  -- is_admin() for that one tenant — migration 058 — which is intended: the
  -- operator may already read these tickets in the console.)
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='support_tickets' AND policyname='support_tickets_select') THEN
    CREATE POLICY support_tickets_select ON support_tickets
      FOR SELECT TO PUBLIC
      USING (tenant_id = auth.tenant_id() AND auth.is_admin());
  END IF;

  -- Raising one pins the author to the caller, so a ticket can never be filed in
  -- a colleague's name.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='support_tickets' AND policyname='support_tickets_insert') THEN
    CREATE POLICY support_tickets_insert ON support_tickets
      FOR INSERT TO PUBLIC
      WITH CHECK (tenant_id = auth.tenant_id() AND auth.is_admin() AND user_id = auth.uid());
  END IF;

  -- WITH CHECK repeats the predicate so a row can neither be created under, nor
  -- moved into, another tenant. WHICH COLUMNS may be written is a separate
  -- question, answered by the column grants in §5.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='support_tickets' AND policyname='support_tickets_update') THEN
    CREATE POLICY support_tickets_update ON support_tickets
      FOR UPDATE TO PUBLIC
      USING (tenant_id = auth.tenant_id() AND auth.is_admin())
      WITH CHECK (tenant_id = auth.tenant_id() AND auth.is_admin());
  END IF;
END $$;

-- ── 2. support_ticket_messages ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS support_ticket_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  -- Denormalised from the ticket so the RLS predicate is a plain equality and a
  -- console query never needs the join just to scope itself.
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- 'user'     — a tenant admin, from the web app
  -- 'operator' — a platform admin or the managing partner, from the console
  author_role text NOT NULL CHECK (author_role IN ('user', 'operator')),
  -- Whoever wrote it. NOT foreign-keyed: an operator is a partnership member,
  -- which is an auth_users row, but a customer's admin may later be purged with
  -- their tenant while the thread is still being read in the console.
  author_user_id uuid NOT NULL,
  -- Display name frozen at write time. The console shows "risposto da Anna" on a
  -- two-year-old ticket; resolving that live would show the name they have now,
  -- or nothing once the member row is gone. Never sent to the customer.
  author_label text,
  body        text NOT NULL CHECK (length(btrim(body)) > 0),
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE support_ticket_messages IS
  'Human replies on a support ticket, both directions. author_label is operator-side only and never rendered to the customer.';

-- "The thread of this ticket, in order" is the only read shape.
CREATE INDEX IF NOT EXISTS support_ticket_messages_ticket_idx
  ON support_ticket_messages(ticket_id, created_at);

ALTER TABLE support_ticket_messages ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  -- Ownership is inherited from the ticket, and the EXISTS is evaluated against
  -- support_tickets' own policy, so "mine" has exactly one definition.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='support_ticket_messages' AND policyname='support_ticket_messages_select') THEN
    CREATE POLICY support_ticket_messages_select ON support_ticket_messages
      FOR SELECT TO PUBLIC
      USING (EXISTS (SELECT 1 FROM support_tickets t WHERE t.id = ticket_id));
  END IF;

  -- The author_role predicate is the load-bearing half: without it the app role
  -- could insert a row that renders in the customer's own thread as though the
  -- assistance team had answered.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='support_ticket_messages' AND policyname='support_ticket_messages_insert') THEN
    CREATE POLICY support_ticket_messages_insert ON support_ticket_messages
      FOR INSERT TO PUBLIC
      WITH CHECK (
        author_role = 'user'
        AND author_user_id = auth.uid()
        AND tenant_id = auth.tenant_id()
        AND EXISTS (SELECT 1 FROM support_tickets t WHERE t.id = ticket_id)
      );
  END IF;
END $$;

-- ── 3. support_ticket_attachments ──────────────────────────────────────────
--
-- Bytes in R2 under `tenants/{tenant}/support/{ticketId}/{attachmentId}/{name}`,
-- the same prefix layout documents use, so the existing tenant-scoped storage
-- reasoning and the purge sweeps carry over unchanged. An operator's own file
-- goes under the CUSTOMER's prefix too: an operator has no tenant, and the file
-- belongs to the conversation.
CREATE TABLE IF NOT EXISTS support_ticket_attachments (
  id          uuid PRIMARY KEY,
  ticket_id   uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  -- The message it hangs off. NOT NULL: an attachment with no message is a file
  -- in a conversation nobody can see, and the lifetime that makes sense for it
  -- is the message's.
  message_id  uuid NOT NULL REFERENCES support_ticket_messages(id) ON DELETE CASCADE,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  uploaded_by text NOT NULL CHECK (uploaded_by IN ('user', 'operator')),
  filename    text NOT NULL,
  mime        text NOT NULL,
  size_bytes  integer NOT NULL CHECK (size_bytes > 0),
  -- Stored rather than derived, so a future change to the key layout cannot
  -- orphan existing objects.
  r2_key      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- One object per row, both ways. A retried upload that wrote the same key
  -- twice would otherwise leave two rows pointing at one object, and deleting
  -- either would break the other.
  CONSTRAINT support_ticket_attachments_key_uq UNIQUE (tenant_id, r2_key)
);

COMMENT ON TABLE support_ticket_attachments IS
  'A file on a ticket message. Bytes live in R2 under the CUSTOMER''s tenant prefix, including for operator uploads.';

CREATE INDEX IF NOT EXISTS support_ticket_attachments_ticket_idx
  ON support_ticket_attachments(ticket_id, created_at);
CREATE INDEX IF NOT EXISTS support_ticket_attachments_message_idx
  ON support_ticket_attachments(message_id);

ALTER TABLE support_ticket_attachments ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='support_ticket_attachments' AND policyname='support_ticket_attachments_select') THEN
    CREATE POLICY support_ticket_attachments_select ON support_ticket_attachments
      FOR SELECT TO PUBLIC
      USING (EXISTS (SELECT 1 FROM support_tickets t WHERE t.id = ticket_id));
  END IF;

  -- Only the customer's own uploads, and only onto their own ticket.
  -- `uploaded_by` is pinned for the same reason author_role is above.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='support_ticket_attachments' AND policyname='support_ticket_attachments_insert') THEN
    CREATE POLICY support_ticket_attachments_insert ON support_ticket_attachments
      FOR INSERT TO PUBLIC
      WITH CHECK (
        uploaded_by = 'user'
        AND tenant_id = auth.tenant_id()
        AND EXISTS (SELECT 1 FROM support_tickets t WHERE t.id = ticket_id)
      );
  END IF;
END $$;

-- ── 4. audit actions for the ticket console ────────────────────────────────
--
-- The constraint is replaced wholesale, so this file carries the WHOLE list
-- (last set by migration 058) plus the four new values. §6 round-trips both a
-- new action and an old one so an out-of-order re-run that dropped an earlier
-- value fails loudly instead of silently.
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
    'partner.activate', 'partner.deactivate', 'partner.resend',
    -- Added here. Every console write on a ticket is attributable, for the
    -- reason 'tenant.support_access' is: the operator is acting on somebody
    -- else's data, and 'ticket.reply' in particular sends mail from our domain
    -- in the platform's name.
    'ticket.status', 'ticket.assign', 'ticket.reply', 'ticket.note'));

-- target_type gains 'ticket'. It was ('tenant','partner') since migration 044,
-- so without this the ticket rows would fail the check rather than land with an
-- odd label.
ALTER TABLE partnership_audit_log DROP CONSTRAINT IF EXISTS partnership_audit_log_target_type_check;
ALTER TABLE partnership_audit_log
  ADD CONSTRAINT partnership_audit_log_target_type_check
  CHECK (target_type IS NULL OR target_type IN ('tenant', 'partner', 'ticket'));

-- ── 5. grants ──────────────────────────────────────────────────────────────
--
-- THE POINT OF THE COLUMN LIST. RLS answers "which rows"; it cannot say "which
-- columns". Every team-side column on support_tickets is one the customer must
-- not write: a request that could set its own handling_status would let an admin
-- mark their ticket in-lavorazione, and one that could write assigned_to could
-- assign it to a named operator. Neither is reachable through routes/tickets.ts
-- today, but that guarantee should not rest on a hand-written column list in one
-- Express handler.
--
-- So the app role gets UPDATE on exactly the four columns the customer's own two
-- actions need — resolve/reopen (status, resolved_at, updated_at) and opening the
-- ticket (user_last_read_at). Postgres checks column privileges BEFORE the RLS
-- policy, so an UPDATE touching anything else is a permission error whichever row
-- it aimed at. Everything else on this table is written by the owner pool
-- (lib/admin-db.ts): the console's writes, and the one customer-triggered write
-- that is not the customer's own opinion — a reply reopening the ticket.
--
-- No DELETE anywhere: a ticket is the record that mail went out from our domain
-- about this account, and a message is a statement someone made at a time.
-- Removing either would make the thread stop being evidence of what was said.
GRANT SELECT, INSERT ON public.support_tickets TO app, sonoqui_owner;
REVOKE UPDATE ON public.support_tickets FROM app;
GRANT UPDATE (status, resolved_at, updated_at, user_last_read_at) ON public.support_tickets TO app;
GRANT UPDATE ON public.support_tickets TO sonoqui_owner;
REVOKE DELETE ON public.support_tickets FROM app;

GRANT SELECT, INSERT ON public.support_ticket_messages TO app, sonoqui_owner;
REVOKE UPDATE, DELETE ON public.support_ticket_messages FROM app;

GRANT SELECT, INSERT ON public.support_ticket_attachments TO app, sonoqui_owner;
REVOKE UPDATE, DELETE ON public.support_ticket_attachments FROM app;

-- ── 6. assert the outcome ──────────────────────────────────────────────────
--
-- Properties the application depends on, not the DDL: that the customer's flag
-- and the team's are two separate columns; that the app role can write the first
-- and NOT the second (the whole point of §5); that a message cannot be forged
-- into the team's voice; and that the audit constraint gained its actions
-- without dropping an older one.
DO $$
DECLARE
  probe uuid;
  col   text;
  chk   text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'support_tickets'
       AND column_name = 'handling_status'
  ) THEN
    RAISE EXCEPTION 'support_tickets.handling_status was not created';
  END IF;

  FOREACH col IN ARRAY ARRAY['status', 'resolved_at', 'updated_at', 'user_last_read_at'] LOOP
    IF NOT has_column_privilege('app', 'public.support_tickets', col, 'UPDATE') THEN
      RAISE EXCEPTION 'app lost UPDATE on support_tickets.% — the customer cannot resolve a ticket', col;
    END IF;
  END LOOP;

  FOREACH col IN ARRAY ARRAY['handling_status', 'assigned_to', 'internal_note', 'body', 'subject'] LOOP
    IF has_column_privilege('app', 'public.support_tickets', col, 'UPDATE') THEN
      RAISE EXCEPTION 'app can still UPDATE support_tickets.% — a customer could write the team''s state', col;
    END IF;
  END LOOP;

  -- The insert policy on the message table is asserted through the catalogue
  -- rather than probed with a forged row: a probe would have to run as the `app`
  -- role, and the migration runner connects as sonoqui_owner, so SET LOCAL ROLE
  -- app would raise before any handler could catch it and take the whole
  -- migration down. What matters is the property, and this is it.
  SELECT with_check INTO chk FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'support_ticket_messages'
     AND policyname = 'support_ticket_messages_insert';
  IF chk IS NULL THEN
    RAISE EXCEPTION 'support_ticket_messages_insert is missing: the app role could insert any message';
  END IF;
  IF chk NOT LIKE '%author_role%' THEN
    RAISE EXCEPTION 'support_ticket_messages_insert no longer pins author_role: a customer could forge an operator reply';
  END IF;
  IF chk NOT LIKE '%uid%' THEN
    RAISE EXCEPTION 'support_ticket_messages_insert no longer pins the author to the caller';
  END IF;

  -- The audit constraint, round-tripped: one value from this migration and one
  -- from 049, so an out-of-order re-run that dropped the older list is caught.
  SELECT id INTO probe FROM auth_users LIMIT 1;
  IF probe IS NOT NULL THEN
    BEGIN
      INSERT INTO partnership_audit_log (actor_user_id, actor_role, action, target_type)
        VALUES (probe, 'migration-probe', 'ticket.reply', 'ticket'),
               (probe, 'migration-probe', 'tenant.delete', 'tenant');
      DELETE FROM partnership_audit_log WHERE actor_role = 'migration-probe';
    EXCEPTION WHEN check_violation THEN
      RAISE EXCEPTION 'partnership_audit_log rejects a ticket action/target or dropped an earlier one';
    END;
  END IF;
END $$;
