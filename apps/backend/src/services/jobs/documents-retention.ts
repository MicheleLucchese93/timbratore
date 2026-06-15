import { adminPool } from '../../lib/admin-db.js';
import { createLogger } from '../../lib/logger.js';
import { storageDelete } from '../../lib/storage.js';

const logger = createLogger('documents_retention');

// Daily sweep: hard-delete every document past its retention horizon
// (retention_until = created_at + 36 months). Cross-tenant via adminPool. For
// each due row we drop the R2 object first, then delete the DB row;
// document_views rows cascade via the FK (ON DELETE CASCADE, migration 041).
// Already-soft-deleted rows (deleted_at NOT NULL) had their object removed at
// delete time, so we only enforce retention on live rows.
export async function documentsRetention(): Promise<void> {
  const due = await adminPool.query(
    `SELECT id, r2_key FROM documents
      WHERE retention_until < now() AND deleted_at IS NULL`
  );
  let objectsDeleted = 0;
  let objectFailures = 0;
  let rowsDeleted = 0;
  for (const row of due.rows) {
    try {
      await storageDelete(row.r2_key);
      objectsDeleted += 1;
    } catch (err) {
      // Log and still drop the DB row — an orphaned object is preferable to a
      // row we can never clean up, and the key is recorded in logs for manual
      // cleanup if needed.
      objectFailures += 1;
      logger.error({ err, document_id: row.id, r2_key: row.r2_key }, 'R2 delete failed during retention');
    }
    const del = await adminPool.query(`DELETE FROM documents WHERE id = $1`, [row.id]);
    rowsDeleted += del.rowCount ?? 0;
  }
  logger.info(
    { due: due.rowCount, rows_deleted: rowsDeleted, objects_deleted: objectsDeleted, object_failures: objectFailures },
    'documents retention pass complete'
  );
}
