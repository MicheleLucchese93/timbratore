-- The history of a support request: what state it moved to, and when.
--
-- WHAT WAS MISSING. support_tickets carries only the CURRENT state plus
-- `handling_updated_at` — "it is in attesa cliente, since Tuesday". A customer
-- reading a request that took a week could not see that it sat untouched for
-- five days and then moved three times in an hour, and neither could we without
-- reading partnership_audit_log, which is platform-side and names operators.
--
-- WHY A TRIGGER AND NOT SIX INSERTS. Six code paths change a status today: the
-- customer's resolve/reopen, the customer's reply reopening a closed request,
-- the console's explicit status set, the console's assign (which moves `nuovo`
-- on by itself), the console's reply with a next_status, and creation. Writing
-- the row at each call site means the seventh path, whenever it arrives, is the
-- one that silently writes no history — the same trap the counted-day duplication
-- was. The trigger sees every write by construction, including a hand-run UPDATE
-- during an incident.
--
-- NO ACTOR COLUMN, DELIBERATELY. The transition itself says everything the
-- surfaces need — `nuovo → in_lavorazione` is "presa in carico" whoever clicked
-- it — and an actor column would either be empty for the paths that have no
-- request-scoped identity (the owner pool) or would carry an operator's id into
-- a table the CUSTOMER reads. Attribution already exists, once, where it belongs:
-- partnership_audit_log.

CREATE TABLE IF NOT EXISTS support_ticket_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id  uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  -- Denormalised so the RLS predicate stays an equality, exactly as on the
  -- message and attachment tables.
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- 'created'     — the request was raised
  -- 'handling'    — the TEAM's state moved
  -- 'user_status' — the CUSTOMER's own flag moved
  kind       text NOT NULL CHECK (kind IN ('created', 'handling', 'user_status')),
  from_status text,
  to_status  text NOT NULL,
  at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE support_ticket_events IS
  'Append-only state history of a support ticket, written by a trigger. Read by both surfaces; carries no actor (see partnership_audit_log for attribution).';

-- "This ticket's history, oldest first" is the only read shape.
CREATE INDEX IF NOT EXISTS support_ticket_events_ticket_idx
  ON support_ticket_events(ticket_id, at, id);

ALTER TABLE support_ticket_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  -- Visibility is inherited from the ticket, so "mine" keeps one definition.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='support_ticket_events' AND policyname='support_ticket_events_select') THEN
    CREATE POLICY support_ticket_events_select ON support_ticket_events
      FOR SELECT TO PUBLIC
      USING (EXISTS (SELECT 1 FROM support_tickets t WHERE t.id = ticket_id));
  END IF;
END $$;

-- ── the trigger ────────────────────────────────────────────────────────────
--
-- SECURITY DEFINER so the row is written with the owner's rights: the `app`
-- role never gets INSERT on this table, which makes the history unforgeable from
-- a request-path connection even though a customer's own UPDATE is what fires
-- it. `search_path` is pinned for the usual SECURITY DEFINER reason.
CREATE OR REPLACE FUNCTION public.support_ticket_log_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO support_ticket_events (ticket_id, tenant_id, kind, from_status, to_status, at)
      VALUES (NEW.id, NEW.tenant_id, 'created', NULL, NEW.handling_status, NEW.created_at);
    RETURN NEW;
  END IF;

  -- One row per column that actually moved. A write that touches neither (the
  -- read receipts, a note, last_message_at) writes no history at all.
  IF NEW.handling_status IS DISTINCT FROM OLD.handling_status THEN
    INSERT INTO support_ticket_events (ticket_id, tenant_id, kind, from_status, to_status)
      VALUES (NEW.id, NEW.tenant_id, 'handling', OLD.handling_status, NEW.handling_status);
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO support_ticket_events (ticket_id, tenant_id, kind, from_status, to_status)
      VALUES (NEW.id, NEW.tenant_id, 'user_status', OLD.status, NEW.status);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS support_ticket_event_trg ON support_tickets;
CREATE TRIGGER support_ticket_event_trg
  AFTER INSERT OR UPDATE OF status, handling_status ON support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.support_ticket_log_event();

-- ── backfill ───────────────────────────────────────────────────────────────
--
-- What can be reconstructed truthfully from the row, and nothing more: every
-- ticket was created when it says it was, a ticket whose team state is no longer
-- `nuovo` reached it at `handling_updated_at`, and a resolved one was resolved at
-- `resolved_at`. The steps in between are gone and are not invented. Idempotent
-- via NOT EXISTS so a re-run adds nothing.
INSERT INTO support_ticket_events (ticket_id, tenant_id, kind, from_status, to_status, at)
SELECT t.id, t.tenant_id, 'created', NULL, 'nuovo', t.created_at
  FROM support_tickets t
 WHERE NOT EXISTS (
   SELECT 1 FROM support_ticket_events e WHERE e.ticket_id = t.id AND e.kind = 'created'
 );

INSERT INTO support_ticket_events (ticket_id, tenant_id, kind, from_status, to_status, at)
SELECT t.id, t.tenant_id, 'handling', NULL, t.handling_status, t.handling_updated_at
  FROM support_tickets t
 WHERE t.handling_status <> 'nuovo'
   AND NOT EXISTS (
     SELECT 1 FROM support_ticket_events e
      WHERE e.ticket_id = t.id AND e.kind = 'handling' AND e.to_status = t.handling_status
   );

INSERT INTO support_ticket_events (ticket_id, tenant_id, kind, from_status, to_status, at)
SELECT t.id, t.tenant_id, 'user_status', 'open', 'resolved', t.resolved_at
  FROM support_tickets t
 WHERE t.status = 'resolved' AND t.resolved_at IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM support_ticket_events e
      WHERE e.ticket_id = t.id AND e.kind = 'user_status' AND e.to_status = 'resolved'
   );

-- ── grants ─────────────────────────────────────────────────────────────────
-- Read-only for the app role: the trigger is the only writer, and it runs as the
-- owner. No UPDATE, no DELETE, for the reason the messages table has none — a
-- history that can be edited is not a history.
GRANT SELECT ON public.support_ticket_events TO app, sonoqui_owner;
REVOKE INSERT, UPDATE, DELETE ON public.support_ticket_events FROM app;

-- ── assert ─────────────────────────────────────────────────────────────────
DO $$
DECLARE
  n int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'support_ticket_event_trg' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'support_ticket_event_trg is missing: status changes would leave no history';
  END IF;

  IF has_table_privilege('app', 'public.support_ticket_events', 'INSERT') THEN
    RAISE EXCEPTION 'app can INSERT into support_ticket_events — the history would be forgeable';
  END IF;

  -- Every existing ticket has at least its creation event after the backfill.
  SELECT count(*) INTO n
    FROM support_tickets t
   WHERE NOT EXISTS (SELECT 1 FROM support_ticket_events e WHERE e.ticket_id = t.id);
  IF n > 0 THEN
    RAISE EXCEPTION 'the backfill left % ticket(s) with no history', n;
  END IF;
END $$;
