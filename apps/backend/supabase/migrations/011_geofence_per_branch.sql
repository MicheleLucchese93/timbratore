-- Move geofence_policy and gps_accuracy_ceiling_m from tenants → branches.
-- Each site has its own GPS tolerance and policy now.

ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS geofence_policy text NOT NULL DEFAULT 'lenient'
    CHECK (geofence_policy IN ('lenient','strict')),
  ADD COLUMN IF NOT EXISTS gps_accuracy_ceiling_m int NOT NULL DEFAULT 100
    CHECK (gps_accuracy_ceiling_m BETWEEN 10 AND 2000);

-- Backfill from current tenant value so existing sites preserve behavior.
UPDATE branches b
SET geofence_policy = t.geofence_policy,
    gps_accuracy_ceiling_m = t.gps_accuracy_ceiling_m
FROM tenants t
WHERE b.tenant_id = t.id;

ALTER TABLE tenants
  DROP COLUMN IF EXISTS geofence_policy,
  DROP COLUMN IF EXISTS gps_accuracy_ceiling_m;
