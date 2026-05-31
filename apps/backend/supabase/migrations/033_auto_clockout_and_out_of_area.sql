-- Auto clock-out after 15h + out-of-area clock-out anomaly.
--
-- Two related features:
--   1. A scheduler job (auto-clockout) closes shifts left open beyond 15h by
--      inserting a system clock_out at clock_in + 15h. Such stamps carry the
--      new source 'system_auto' so admins can tell them apart from human
--      'admin_manual' entries.
--   2. clock_out is allowed from outside the branch geofence (so a leaver who
--      forgot to stamp out is never trapped in an open shift), but the stamp is
--      flagged out_of_geofence = true with the measured distance, surfaced as a
--      'clock_out_out_of_area' anomaly.

ALTER TABLE stamps DROP CONSTRAINT IF EXISTS stamps_source_check;
ALTER TABLE stamps ADD CONSTRAINT stamps_source_check
  CHECK (source IN ('employee_app','employee_correction','admin_manual','system_auto'));

ALTER TABLE stamps
  ADD COLUMN IF NOT EXISTS out_of_geofence boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS geofence_distance_m double precision;
