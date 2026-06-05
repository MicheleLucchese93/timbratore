-- Per-tenant cap on number of sedi (branches), mirroring max_users/max_admins.
-- ADD COLUMN with a DEFAULT backfills every existing tenant to 3 sedi.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS max_branches int NOT NULL DEFAULT 3 CHECK (max_branches >= 1);
