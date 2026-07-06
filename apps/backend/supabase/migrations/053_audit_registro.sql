-- Registro attività (tenant activity log).
-- The audit_log table exists since 002 and is already written by several
-- routes; this migration adds the columns the new admin-facing Registro
-- attività needs: a filterable target user, a human label captured at write
-- time (survives target deletion), and request metadata.

ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS target_user_id uuid;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS target_label text;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS ip text;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS user_agent text;

CREATE INDEX IF NOT EXISTS audit_log_tenant_actor_idx
  ON audit_log(tenant_id, actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_tenant_target_idx
  ON audit_log(tenant_id, target_user_id, created_at DESC)
  WHERE target_user_id IS NOT NULL;
