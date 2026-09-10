import { adminPool } from '../../lib/admin-db.js';
import { createLogger } from '../../lib/logger.js';
import { storageDelete } from '../../lib/storage.js';
import { assertDocumentKey } from '../../lib/document-security.js';

const logger = createLogger('documents_retention');

// Daily sweep that frees R2 storage on three fronts:
//  1. Retention — live documents past retention_until (= created_at + 36 months).
//  2. Reconciliation — soft-deleted documents (deleted_at set) whose R2 object
//     may still exist because the interactive delete's object-drop failed.
//  3. Pending uploads older than one day (failed PUT/finalization or process death).
//
// In all cases we drop the R2 object FIRST and only hard-delete the DB row when
// that succeeds — so a transient R2 failure leaves the row in place to be retried
// next run rather than orphaning bytes with no tracking row. storageDelete is
// idempotent (R2 DeleteObject + disk `rm -f` both no-op on a missing object), so
// re-running and reconciling an already-deleted object is safe. document_views
// rows cascade on the FK (ON DELETE CASCADE, migration 041); the
// document_access_log audit trail has no FK and survives the row delete.
//
// Soft-deleted rows get a 1-day grace so the daily pass never races an
// interactive delete that just committed.
const DUE = `(storage_state = 'ready' AND deleted_at IS NULL AND retention_until < now())
  OR (deleted_at IS NOT NULL AND deleted_at < now() - interval '1 day')
  OR (storage_state = 'pending' AND created_at < now() - interval '1 day')`;

export async function deleteDueDocument(id: string): Promise<boolean> {
  const client = await adminPool.connect();
  try {
    await client.query('BEGIN');
    // Recheck under the same lock held throughout upload finalization. SKIP
    // LOCKED keeps the sweep from waiting on or deleting an active upload.
    const r = await client.query(
      `SELECT id, tenant_id, r2_key FROM documents WHERE id = $1 AND (${DUE}) FOR UPDATE SKIP LOCKED`, [id]
    );
    if (!r.rowCount) {
      await client.query('COMMIT');
      return false;
    }
    assertDocumentKey(r.rows[0]);
    await storageDelete(r.rows[0].r2_key);
    await client.query('DELETE FROM documents WHERE id = $1', [id]);
    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function documentsRetention(): Promise<void> {
  const due = await adminPool.query(`SELECT id FROM documents WHERE ${DUE}`);
  let deleted = 0;
  let failures = 0;
  for (const row of due.rows) {
    try {
      if (await deleteDueDocument(row.id)) deleted += 1;
    } catch (err) {
      failures += 1;
      logger.error({ err, document_id: row.id }, 'Document cleanup failed; keeping row to retry next run');
    }
  }
  logger.info({ due: due.rowCount, deleted, failures }, 'documents retention + pending upload reconciliation complete');
}
