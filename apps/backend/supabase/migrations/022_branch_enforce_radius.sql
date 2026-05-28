-- Make the geofence radius optional per branch.
-- enforce_radius=true (default) preserves existing behavior: distance check against radius_m.
-- enforce_radius=false means: GPS coordinates still captured on the stamp, but no
-- distance check and no accuracy ceiling check. Auto-detect (stamping without an
-- explicit branch_id) will skip such branches; the user must pick the sede explicitly.

ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS enforce_radius boolean NOT NULL DEFAULT true;
