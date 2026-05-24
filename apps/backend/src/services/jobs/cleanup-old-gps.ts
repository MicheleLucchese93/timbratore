import { pool } from '../../lib/db.js';
import { createLogger } from '../../lib/logger.js';

const logger = createLogger('cleanup_old_gps');

export async function cleanupOldGps(): Promise<void> {
  const r = await pool.query(
    `UPDATE stamps
     SET latitude = NULL, longitude = NULL, gps_accuracy_m = NULL
     WHERE created_at < now() - interval '90 days'
       AND latitude IS NOT NULL`
  );
  logger.info({ rows: r.rowCount }, 'stripped GPS from old stamps');
}
