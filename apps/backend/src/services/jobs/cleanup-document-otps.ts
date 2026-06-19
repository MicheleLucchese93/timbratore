import { adminPool } from '../../lib/admin-db.js';
import { createLogger } from '../../lib/logger.js';

const logger = createLogger('cleanup_document_otps');

// Reap Documentale OTP rows whose pending code has expired AND whose verified
// session has lapsed. Rows are upserted per (tenant,user), so this only clears
// members who stopped using the feature. Service role (adminPool): the app role
// is RLS-blocked on document_otps.
export async function cleanupExpiredDocumentOtps(): Promise<void> {
  const r = await adminPool.query(
    `DELETE FROM document_otps
      WHERE COALESCE(code_expires_at, '-infinity'::timestamptz) < now()
        AND COALESCE(verified_until, '-infinity'::timestamptz) < now()`
  );
  logger.info({ rows: r.rowCount }, 'expired document OTP rows deleted');
}
