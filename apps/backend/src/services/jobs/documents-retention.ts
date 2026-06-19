import { adminPool } from '../../lib/admin-db.js';
import { createLogger } from '../../lib/logger.js';
import { storageDelete } from '../../lib/storage.js';

const logger = createLogger('documents_retention');

// Daily sweep that frees R2 storage on two fronts:
//  1. Retention — live documents past retention_until (= created_at + 36 months).
//  2. Reconciliation — soft-deleted documents (deleted_at set) whose R2 object
//     may still exist because the interactive delete's object-drop failed.
//
// In BOTH cases we drop the R2 object FIRST and only hard-delete the DB row when
// that succeeds — so a transient R2 failure leaves the row in place to be retried
// next run rather than orphaning bytes with no tracking row. storageDelete is
// idempotent (R2 DeleteObject + disk `rm -f` both no-op on a missing object), so
// re-running and reconciling an already-deleted object is safe. document_views
// rows cascade on the FK (ON DELETE CASCADE, migration 041); the
// document_access_log audit trail has no FK and survives the row delete.
//
// Soft-deleted rows get a 1-day grace so the daily pass never races an
// interactive delete that just committed.
export async function documentsRetention(): Promise<void> {
  const due = await adminPool.query(
    `SELECT id, r2_key, (deleted_at IS NOT NULL) AS soft_deleted
       FROM documents
      WHERE (deleted_at IS NULL AND retention_until < now())
         OR (deleted_at IS NOT NULL AND deleted_at < now() - interval '1 day')`
  );
  let objectsDeleted = 0;
  let objectFailures = 0;
  let rowsDeleted = 0;
  for (const row of due.rows) {
    try {
      await storageDelete(row.r2_key);
      objectsDeleted += 1;
    } catch (err) {
      // R2 unavailable / transient — keep the DB row so the object is retried
      // next run; never orphan bytes with no row pointing at them.
      objectFailures += 1;
      logger.error(
        { err, document_id: row.id, r2_key: row.r2_key, soft_deleted: row.soft_deleted },
        'R2 delete failed; keeping row to retry next run'
      );
      continue;
    }
    const del = await adminPool.query(`DELETE FROM documents WHERE id = $1`, [row.id]);
    rowsDeleted += del.rowCount ?? 0;
  }
  logger.info(
    {
      due: due.rowCount,
      rows_deleted: rowsDeleted,
      objects_deleted: objectsDeleted,
      object_failures: objectFailures,
    },
    'documents retention + orphan reconciliation pass complete'
  );
}
