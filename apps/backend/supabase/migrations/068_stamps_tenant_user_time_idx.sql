-- Serve the dashboard's "last punch per employee" lookup from one index.
--
-- GET /api/v1/dashboard/cards and GET /api/v1/dashboard/summary both open with
-- the same CTE (apps/backend/src/routes/dashboard.ts):
--
--   SELECT DISTINCT ON (user_id) user_id, event_type, occurred_at, branch_id
--     FROM stamps WHERE deleted_at IS NULL
--    ORDER BY user_id, occurred_at DESC, created_at DESC
--
-- plus the tenant_id predicate RLS adds underneath. Neither existing partial
-- index matches that shape: stamps_user_time_idx is (user_id, occurred_at DESC)
-- with no tenant column, so it can only be walked in full with tenant_id as a
-- filter; stamps_tenant_time_idx is (tenant_id, occurred_at DESC), which reads
-- the tenant's whole history and then sorts it to get the DISTINCT ON order.
-- Either way the work to find each employee's most recent punch grows with
-- every punch ever recorded, and it is paid twice per dashboard load because
-- the two endpoints are fetched together.
--
-- (tenant_id, user_id, occurred_at DESC) is the ORDER BY prefixed by the
-- tenant, so the CTE becomes an ordered scan of one tenant's slice with no sort
-- node. created_at is deliberately left out: it only breaks ties between two
-- punches at the same instant, and carrying it would widen every entry.
--
-- Plain CREATE INDEX, not CONCURRENTLY: scripts/migrate.ts wraps each file in a
-- transaction, and CONCURRENTLY cannot run inside one. It takes a SHARE lock on
-- stamps for the duration, which at this table's size is momentary.
CREATE INDEX IF NOT EXISTS stamps_tenant_user_time_idx
  ON stamps(tenant_id, user_id, occurred_at DESC)
  WHERE deleted_at IS NULL;
