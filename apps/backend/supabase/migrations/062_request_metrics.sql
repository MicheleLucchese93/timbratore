-- Hourly per-route latency history.
--
-- The container log is the only performance record this stack keeps, and it is
-- capped at 20MB x 5 per service and reset on every deploy — which is precisely
-- when a regression would be introduced. Aggregates land here instead so a
-- weekly digest can compare this week against the last one, and so an
-- investigation a month later still has numbers to look at.
--
-- Deliberately holds NO tenant_id and no user id. It is platform-side operations
-- data, not tenant data: keeping it tenant-free means it needs no tenant scoping
-- to be safe, and there is no personal data to retain or export. When a slow
-- request has to be traced to a company, the http log line still carries
-- `tenant`/`uid` for as long as it is retained.
--
-- Percentiles are computed in-process from the hour's samples (see lib/metrics.ts,
-- which caps samples per route per hour) — `n` is always the true request count
-- even when the percentile sample was capped.

CREATE TABLE IF NOT EXISTS request_metrics (
  bucket_start timestamptz NOT NULL,          -- hour boundary, UTC
  method       text        NOT NULL,
  route        text        NOT NULL,          -- mount-qualified, parameterised
  n            integer     NOT NULL,          -- requests in the hour
  dur_p50      integer     NOT NULL,
  dur_p95      integer     NOT NULL,
  dur_max      integer     NOT NULL,
  db_p50       integer     NOT NULL,
  db_p95       integer     NOT NULL,
  db_max       integer     NOT NULL,
  bytes_max    integer     NOT NULL,
  n_4xx        integer     NOT NULL DEFAULT 0,
  n_5xx        integer     NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket_start, method, route)
);

-- The digest reads a trailing window across all routes; the purge deletes a
-- prefix. Both are bucket_start-ordered.
CREATE INDEX IF NOT EXISTS request_metrics_bucket_idx ON request_metrics(bucket_start DESC);

-- Closed to the app role entirely: only the owner connection (adminPool) writes
-- and reads it. RLS is enabled with NO policy as a second lock, so if a future
-- route ever reaches this table through the tenant pool it fails loudly instead
-- of quietly returning cross-tenant operational data.
ALTER TABLE request_metrics ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.request_metrics FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.request_metrics TO sonoqui_owner;
