-- Move disable_desktop_clock_in from tenants to memberships (per-user policy).
-- Backfill each existing membership from its tenant's current value, then drop
-- the column from tenants.

ALTER TABLE memberships
  ADD COLUMN IF NOT EXISTS disable_desktop_clock_in boolean NOT NULL DEFAULT true;

UPDATE memberships m
SET disable_desktop_clock_in = t.disable_desktop_clock_in
FROM tenants t
WHERE t.id = m.tenant_id;

ALTER TABLE tenants
  DROP COLUMN IF EXISTS disable_desktop_clock_in;
