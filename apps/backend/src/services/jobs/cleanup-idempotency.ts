import { pool } from '../../lib/db.js';
import { createLogger } from '../../lib/logger.js';

const logger = createLogger('cleanup_idempotency');

export async function cleanupExpiredIdempotency(): Promise<void> {
  const r = await pool.query(`DELETE FROM idempotency_keys WHERE expires_at < now()`);
  logger.info({ rows: r.rowCount }, 'expired idempotency keys deleted');
}
