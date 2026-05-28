import { adminPool } from '../../lib/admin-db.js';
import { createLogger } from '../../lib/logger.js';

const logger = createLogger('retention_enforcement');

export async function retentionEnforcement(): Promise<void> {
  const tenants = await adminPool.query(`SELECT id, retention_years FROM tenants WHERE deleted_at IS NULL`);
  let total = 0;
  for (const t of tenants.rows) {
    const r = await adminPool.query(
      `DELETE FROM stamps
       WHERE tenant_id = $1
         AND occurred_at < now() - ($2 || ' years')::interval`,
      [t.id, t.retention_years]
    );
    total += r.rowCount ?? 0;
  }
  logger.info({ tenants: tenants.rowCount, deleted: total }, 'retention pass complete');
}
