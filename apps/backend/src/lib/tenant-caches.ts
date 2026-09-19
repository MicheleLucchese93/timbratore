import { adminPool } from './admin-db.js';
import { invalidateTenantApiKeys } from './api-keys.js';
import { invalidateMembershipCache } from '../middleware/auth.js';

/**
 * Make a change to a tenant's entitlements visible on the very next request:
 * evict every member's cached membership (the 60s auth cache carries the module
 * flags into /me and the module guards) and the API-key resolution cache (which
 * carries api_enabled / cantieri_enabled for live integrations).
 */
export async function invalidateTenantCaches(tenantId: string): Promise<void> {
  const members = await adminPool.query(
    `SELECT DISTINCT user_id FROM memberships WHERE tenant_id = $1 AND deleted_at IS NULL`,
    [tenantId]
  );
  for (const m of members.rows) invalidateMembershipCache(m.user_id as string);
  await invalidateTenantApiKeys(tenantId);
}
