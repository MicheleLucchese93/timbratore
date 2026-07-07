-- Registro attività: backfill target_user_id for rows written before the
-- Registro shipped. Legacy user.* rows (old emitAudit helpers) carried the
-- affected member's id in resource_id, so the Destinatario column/filter
-- would otherwise exclude all pre-Registro history.
UPDATE audit_log
   SET target_user_id = resource_id::uuid
 WHERE target_user_id IS NULL
   AND resource_type = 'user'
   AND resource_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
