import type { PoolClient } from 'pg';
import type { Request } from 'express';

// Every action that can appear in the tenant Registro attività. Keep this
// union in sync with the i18n labels in apps/web/src/i18n/locales/*/audit.json.
export type AuditAction =
  // users
  | 'user.invite'
  | 'user.update'
  | 'user.deactivate'
  | 'user.reactivate'
  | 'user.delete'
  | 'user.import'
  | 'user.access_email'
  | 'user.set_branches'
  | 'user.set_approvers'
  | 'user.set_correction_approvers'
  | 'user.password_change'
  // stamps (admin edits)
  | 'stamp.admin_create'
  | 'stamp.admin_update'
  | 'stamp.admin_delete'
  | 'stamp.bulk_apply'
  // anomalies
  | 'anomaly.justify'
  // correction requests (decisions)
  | 'correction.approve'
  | 'correction.reject'
  // leaves (admin actions + decisions)
  | 'leave.approve'
  | 'leave.reject'
  | 'leave.admin_create'
  | 'leave.admin_revoke'
  | 'leave.decide_cancellation'
  | 'leave.bulk_create'
  | 'leave.bulk_revoke'
  // leave quotas
  | 'leave_quota.template_create'
  | 'leave_quota.template_update'
  | 'leave_quota.template_delete'
  | 'leave_quota.assign'
  | 'leave_quota.assignment_update'
  | 'leave_quota.assignment_delete'
  | 'leave_quota.accrual_add'
  // shifts
  | 'shift_template.create'
  | 'shift_template.update'
  | 'shift_template.delete'
  | 'shift_assignment.set'
  | 'shift_assignment.clear'
  // branches
  | 'branch.create'
  | 'branch.update'
  | 'branch.delete'
  | 'branch.member_add'
  | 'branch.member_remove'
  // bacheca
  | 'bulletin.create'
  | 'bulletin.update'
  | 'bulletin.delete'
  // cantieri
  | 'cantiere.create'
  | 'cantiere.update'
  | 'cantiere.delete'
  | 'cantiere.assign'
  | 'cantiere.report_email'
  | 'mezzo.create'
  | 'mezzo.update'
  | 'mezzo.delete'
  | 'mezzo.assign'
  | 'cantieri_field.create'
  | 'cantieri_field.update'
  | 'cantieri_field.delete'
  | 'cantiere_entry.create'
  | 'cantiere_entry.update'
  | 'cantiere_entry.delete'
  // exports
  | 'export.create'
  | 'export.download'
  | 'export.delete'
  // documents (Documentale)
  | 'document.upload'
  | 'document.delete'
  | 'document.session_start'
  // settings
  | 'tenant.update'
  | 'tenant.export_recipient_add'
  | 'tenant.export_recipient_remove';

export interface AuditEntry {
  action: AuditAction;
  resourceType: string;
  resourceId?: string | null;
  /** Member the action was performed ON (filterable in the Registro). */
  targetUserId?: string | null;
  /** Human label captured at write time so it survives target deletion. */
  targetLabel?: string | null;
  before?: unknown;
  after?: unknown;
  /** Pass the request to capture ip + user agent. */
  req?: Request;
}

/**
 * Append a row to the tenant audit_log. Runs on the caller's tenant client so
 * the insert is atomic with the mutation and RLS scopes it to the tenant
 * (tenant_id/actor come from the app.current_* GUCs set by tenantHandler).
 */
// When no explicit targetLabel is given, snapshot the target's current name
// at write time — the whole point of the column is surviving a later purge of
// the auth_users mirror row (user delete / cross-tenant cleanup).
const TARGET_LABEL_SQL = `COALESCE($5, (
  SELECT COALESCE(NULLIF(TRIM(CONCAT(au.first_name, ' ', au.last_name)), ''), au.display_name, au.email)
    FROM auth_users au WHERE au.id = $4::uuid))`;

export async function logAudit(client: PoolClient, entry: AuditEntry): Promise<void> {
  await client.query(
    `INSERT INTO audit_log(tenant_id, actor_user_id, action, resource_type, resource_id,
                           target_user_id, target_label, before, after, ip, user_agent)
     VALUES (current_setting('app.current_tenant_id')::uuid,
             current_setting('app.current_user_id')::uuid,
             $1, $2, $3, $4::uuid, ${TARGET_LABEL_SQL}, $6::jsonb, $7::jsonb, $8, $9)`,
    auditParams(entry)
  );
}

/**
 * Same as logAudit for handlers that run on adminPool (no app.current_* GUCs,
 * e.g. the Documentale routes): tenant and actor are passed explicitly.
 */
export async function logAuditAs(
  db: Pick<PoolClient, 'query'>,
  tenantId: string,
  actorUserId: string,
  entry: AuditEntry
): Promise<void> {
  await db.query(
    `INSERT INTO audit_log(tenant_id, actor_user_id, action, resource_type, resource_id,
                           target_user_id, target_label, before, after, ip, user_agent)
     VALUES ($10::uuid, $11::uuid, $1, $2, $3, $4::uuid, ${TARGET_LABEL_SQL}, $6::jsonb, $7::jsonb, $8, $9)`,
    [...auditParams(entry), tenantId, actorUserId]
  );
}

function auditParams(entry: AuditEntry): unknown[] {
  return [
    entry.action,
    entry.resourceType,
    entry.resourceId ?? null,
    entry.targetUserId ?? null,
    entry.targetLabel ?? null,
    entry.before === undefined || entry.before === null ? null : JSON.stringify(entry.before),
    entry.after === undefined || entry.after === null ? null : JSON.stringify(entry.after),
    entry.req?.ip ?? null,
    entry.req?.headers['user-agent'] ?? null,
  ];
}
