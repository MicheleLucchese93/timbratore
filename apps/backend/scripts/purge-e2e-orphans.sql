-- One-shot manual purge of e2e-marked orphan rows.
--
-- Targets rows whose user_id no longer exists in auth_users AND whose text
-- markers indicate they were created by the e2e suite. Safe to re-run.
--
-- Usage:
--   psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f purge-e2e-orphans.sql

BEGIN;

SELECT 'leave_requests' AS tbl, count(*) AS to_delete
FROM leave_requests
WHERE user_id NOT IN (SELECT id FROM auth_users)
  AND (
    user_note            ILIKE '%e2e%'
    OR cancellation_reason ILIKE '%e2e%'
    OR rejection_reason    ILIKE '%e2e%'
  )
UNION ALL
SELECT 'correction_requests', count(*)
FROM correction_requests
WHERE user_id NOT IN (SELECT id FROM auth_users)
  AND (
    justification    ILIKE '%e2e%'
    OR resolution_note ILIKE '%e2e%'
  );

WITH del_leave AS (
  DELETE FROM leave_requests
  WHERE user_id NOT IN (SELECT id FROM auth_users)
    AND (
      user_note            ILIKE '%e2e%'
      OR cancellation_reason ILIKE '%e2e%'
      OR rejection_reason    ILIKE '%e2e%'
    )
  RETURNING 1
),
del_corr AS (
  DELETE FROM correction_requests
  WHERE user_id NOT IN (SELECT id FROM auth_users)
    AND (
      justification    ILIKE '%e2e%'
      OR resolution_note ILIKE '%e2e%'
    )
  RETURNING 1
)
SELECT
  (SELECT count(*) FROM del_leave) AS leave_requests_deleted,
  (SELECT count(*) FROM del_corr)  AS correction_requests_deleted;

COMMIT;
