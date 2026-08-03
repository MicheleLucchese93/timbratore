-- Stamp edit provenance: keep the employee's original punch reachable in one hop.
--
-- Everything an admin does to a stamp is already recorded append-only in
-- stamps_history (003_stamps.sql) and audit_log, so nothing was ever lost. What
-- was missing is a *cheap, indexable* answer to "was this punch modified, and
-- what did the employee actually stamp?" — the list, the monthly grid and the
-- payroll export all need it per row, and walking the history jsonb for every
-- row is an N+1 no view can afford.
--
-- So the first value is denormalized onto the row itself, maintained by a
-- BEFORE UPDATE trigger rather than by application code: the API is not the
-- only writer (psql fixes, future routes), and provenance that can be bypassed
-- is worthless in a dispute.

ALTER TABLE stamps ADD COLUMN IF NOT EXISTS original_occurred_at timestamptz;
ALTER TABLE stamps ADD COLUMN IF NOT EXISTS original_event_type  text;
ALTER TABLE stamps ADD COLUMN IF NOT EXISTS edited_at            timestamptz;
ALTER TABLE stamps ADD COLUMN IF NOT EXISTS edited_by_user_id    uuid;
ALTER TABLE stamps ADD COLUMN IF NOT EXISTS edit_count           int NOT NULL DEFAULT 0;

COMMENT ON COLUMN stamps.original_occurred_at IS
  'occurred_at as first recorded (employee punch or admin insert). NULL = never edited.';
COMMENT ON COLUMN stamps.original_event_type IS
  'event_type as first recorded. NULL = never edited.';

-- Backfill from the existing history before the new trigger exists, so the two
-- can never disagree on rows edited before this migration. The history trigger
-- is switched off for the duration: this is a derivation of the history, not a
-- new business event, and it must not appear in it.
ALTER TABLE stamps DISABLE TRIGGER stamps_history_trigger;

WITH edits AS (
  SELECT h.stamp_id,
         h.recorded_at,
         h.changed_by,
         (h.before ->> 'occurred_at')::timestamptz AS before_occurred_at,
         h.before ->> 'event_type'                 AS before_event_type,
         row_number() OVER (PARTITION BY h.stamp_id ORDER BY h.recorded_at, h.id)           AS rn_first,
         row_number() OVER (PARTITION BY h.stamp_id ORDER BY h.recorded_at DESC, h.id DESC) AS rn_last,
         count(*)     OVER (PARTITION BY h.stamp_id)                                        AS n_edits
    FROM stamps_history h
   WHERE h.operation = 'UPDATE'
     AND (h.before ->> 'occurred_at' IS DISTINCT FROM h.after ->> 'occurred_at'
       OR h.before ->> 'event_type'  IS DISTINCT FROM h.after ->> 'event_type')
)
UPDATE stamps s
   SET original_occurred_at = f.before_occurred_at,
       original_event_type  = f.before_event_type,
       edited_at            = l.recorded_at,
       edited_by_user_id    = l.changed_by,
       edit_count           = l.n_edits
  FROM (SELECT * FROM edits WHERE rn_first = 1) f
  JOIN (SELECT * FROM edits WHERE rn_last  = 1) l ON l.stamp_id = f.stamp_id
 WHERE s.id = f.stamp_id;

ALTER TABLE stamps ENABLE TRIGGER stamps_history_trigger;

-- Only a change to *what was stamped* counts as an edit. A soft delete, a note
-- tweak or the reminder bookkeeping must not flip the row to "modificata" —
-- the badge has to mean something specific for it to survive a contestation.
CREATE OR REPLACE FUNCTION trg_stamps_provenance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.occurred_at IS DISTINCT FROM OLD.occurred_at
     OR NEW.event_type IS DISTINCT FROM OLD.event_type THEN
    NEW.original_occurred_at := COALESCE(OLD.original_occurred_at, OLD.occurred_at);
    NEW.original_event_type  := COALESCE(OLD.original_event_type,  OLD.event_type);
    NEW.edited_at            := now();
    NEW.edited_by_user_id    := NULLIF(current_setting('app.current_user_id', true), '')::uuid;
    NEW.edit_count           := COALESCE(OLD.edit_count, 0) + 1;
  ELSE
    -- Provenance is append-only: an UPDATE that does not change the punch may
    -- not clear or rewrite it either.
    NEW.original_occurred_at := OLD.original_occurred_at;
    NEW.original_event_type  := OLD.original_event_type;
    NEW.edited_at            := OLD.edited_at;
    NEW.edited_by_user_id    := OLD.edited_by_user_id;
    NEW.edit_count           := OLD.edit_count;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS stamps_provenance_trigger ON stamps;
CREATE TRIGGER stamps_provenance_trigger
BEFORE UPDATE ON stamps
FOR EACH ROW EXECUTE FUNCTION trg_stamps_provenance();

-- Fresh inserts must start clean whatever the caller passed.
CREATE OR REPLACE FUNCTION trg_stamps_provenance_ins() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.original_occurred_at := NULL;
  NEW.original_event_type  := NULL;
  NEW.edited_at            := NULL;
  NEW.edited_by_user_id    := NULL;
  NEW.edit_count           := 0;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS stamps_provenance_ins_trigger ON stamps;
CREATE TRIGGER stamps_provenance_ins_trigger
BEFORE INSERT ON stamps
FOR EACH ROW EXECUTE FUNCTION trg_stamps_provenance_ins();

CREATE INDEX IF NOT EXISTS stamps_edited_idx
  ON stamps(tenant_id, edited_at DESC)
  WHERE edited_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- stamps_history: whose punch is this row about?
--
-- The table only ever carried stamp_id + jsonb, which is enough for an admin
-- forensic dump but not for the two things now needed: letting an employee
-- read the history of their OWN punches (RLS needs a column, not a jsonb
-- probe), and listing a period's rettifiche per employee without joining back
-- to a stamp that may have been soft-deleted.
ALTER TABLE stamps_history ADD COLUMN IF NOT EXISTS user_id uuid;

UPDATE stamps_history h
   SET user_id = COALESCE((h.after ->> 'user_id')::uuid, (h.before ->> 'user_id')::uuid)
 WHERE h.user_id IS NULL;

CREATE INDEX IF NOT EXISTS stamps_history_user_idx
  ON stamps_history(tenant_id, user_id, recorded_at DESC);

CREATE OR REPLACE FUNCTION trg_stamps_history() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  reason text := NULLIF(current_setting('app.change_reason', true), '');
  actor uuid := NULLIF(current_setting('app.current_user_id', true), '')::uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO stamps_history(stamp_id, tenant_id, user_id, operation, changed_by, change_reason, before, after)
    VALUES (NEW.id, NEW.tenant_id, NEW.user_id, 'INSERT', actor, reason, NULL, to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO stamps_history(stamp_id, tenant_id, user_id, operation, changed_by, change_reason, before, after)
    VALUES (NEW.id, NEW.tenant_id, NEW.user_id, 'UPDATE', actor, reason, to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO stamps_history(stamp_id, tenant_id, user_id, operation, changed_by, change_reason, before, after)
    VALUES (OLD.id, OLD.tenant_id, OLD.user_id, 'DELETE', actor, reason, to_jsonb(OLD), NULL);
    RETURN OLD;
  END IF;
  RETURN NULL;
END $$;

-- The employee may read the history of their own punches — the correction
-- request they are about to file, and any contestation, both start from being
-- able to see that a punch was moved. Admins keep the tenant-wide view.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='stamps_history' AND policyname='stamps_history_tenant_iso') THEN
    DROP POLICY stamps_history_tenant_iso ON stamps_history;
  END IF;
  CREATE POLICY stamps_history_tenant_iso ON stamps_history
    FOR SELECT TO PUBLIC
    USING (
      tenant_id = auth.tenant_id()
      AND (auth.is_admin() OR user_id = auth.uid())
    );
END $$;

-- The Rettifiche export sheet and the day dossier both read the history by
-- tenant + operation; the existing (tenant_id, recorded_at) index does not
-- narrow the INSERT rows away, which are the large majority.
CREATE INDEX IF NOT EXISTS stamps_history_changes_idx
  ON stamps_history(tenant_id, recorded_at DESC)
  WHERE operation <> 'INSERT';
