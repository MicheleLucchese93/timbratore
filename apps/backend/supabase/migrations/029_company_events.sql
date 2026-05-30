-- Company-wide / admin-imposed calendar events ("chiusura aziendale").
--
-- An admin can push one event to many users at once (e.g. the August closure).
-- Each affected user gets one leave_requests row; rows created by the same
-- admin action share a batch_id so the whole batch can be revoked together.
-- title carries the human label ("Chiusura aziendale agosto").
--
-- New leave type 'chiusura': auto-approved, does NOT consume ferie/permessi
-- quota (getQuotaSummary only sums type IN ('ferie','permessi')). When the
-- admin chooses to charge the closure to holiday instead, the bulk endpoint
-- inserts ordinary approved 'ferie' rows, which the quota math already counts.

ALTER TABLE leave_requests
  DROP CONSTRAINT IF EXISTS leave_requests_type_check;
ALTER TABLE leave_requests
  ADD CONSTRAINT leave_requests_type_check
    CHECK (type IN ('ferie','permessi','malattia','assenza','chiusura'));

ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS batch_id uuid,
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS created_by_admin boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS leave_requests_batch_idx
  ON leave_requests(tenant_id, batch_id) WHERE batch_id IS NOT NULL;
