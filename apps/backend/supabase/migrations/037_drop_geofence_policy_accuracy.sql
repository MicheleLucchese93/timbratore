-- Drop geofence_policy and gps_accuracy_ceiling_m from branches.
-- Geofence is now a pure radius check: a clock-in outside the radius is
-- rejected, a clock-out is allowed but flagged. The lenient/strict policy and
-- the GPS-accuracy ceiling are removed — the admin UI no longer exposes them,
-- and the SME-facing model is just "raggio sì/no".
ALTER TABLE branches
  DROP COLUMN IF EXISTS geofence_policy,
  DROP COLUMN IF EXISTS gps_accuracy_ceiling_m;
