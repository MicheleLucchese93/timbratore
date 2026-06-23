import type { PoolClient } from 'pg';
import { adminPool } from './admin-db.js';

export type PartnershipAction =
  | 'tenant.create'
  | 'tenant.update_limits'
  | 'tenant.suspend'
  | 'tenant.resume'
  | 'tenant.admin_reinvite'
  | 'tenant.change_admin'
  | 'partner.create'
  | 'partner.update_caps'
  | 'partner.activate'
  | 'partner.deactivate'
  | 'partner.resend';

export interface PartnershipAuditEntry {
  actorUserId: string;
  actorRole: string;
  action: PartnershipAction;
  targetType?: 'tenant' | 'partner' | null;
  targetId?: string | null;
  targetLabel?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
}

// Append one row to the partnership audit log — written for EVERY mutating
// operation on the partnership app. Pass a txn client to make the audit atomic
// with the mutation; omit to write standalone on the adminPool. Runs on the
// service role (RLS-bypassing) — partnership_audit_log has no app-role policy.
export async function logPartnershipAudit(
  entry: PartnershipAuditEntry,
  client?: PoolClient
): Promise<void> {
  const q = client ?? adminPool;
  await q.query(
    `INSERT INTO partnership_audit_log
       (actor_user_id, actor_role, action, target_type, target_id, target_label, before, after, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      entry.actorUserId,
      entry.actorRole,
      entry.action,
      entry.targetType ?? null,
      entry.targetId ?? null,
      entry.targetLabel ?? null,
      entry.before === undefined ? null : JSON.stringify(entry.before),
      entry.after === undefined ? null : JSON.stringify(entry.after),
      entry.ip ?? null,
      entry.userAgent ?? null,
    ]
  );
}
