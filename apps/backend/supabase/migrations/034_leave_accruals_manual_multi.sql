-- Allow multiple manual / adjustment accrual rows per (assignment, day).
--
-- The original UNIQUE (assignment_id, accrued_on, source) on leave_accruals
-- (migration 017) was meant only to make the daily cron idempotent. As a side
-- effect it blocked a second *manual* add/remove on the same day — an admin
-- crediting +8h and later debiting −2h on the same date would hit a 23505.
--
-- Cron idempotency only needs uniqueness for source = 'cron', so narrow it to
-- a partial unique index. Manual ('manual') and corrective ('adjustment')
-- rows are then unconstrained: the ledger is append-only and an admin may post
-- as many manual operations per day as needed.

ALTER TABLE leave_accruals
  DROP CONSTRAINT IF EXISTS leave_accruals_unique_cron_day;

CREATE UNIQUE INDEX IF NOT EXISTS leave_accruals_cron_day_unique
  ON leave_accruals(assignment_id, accrued_on)
  WHERE source = 'cron';
