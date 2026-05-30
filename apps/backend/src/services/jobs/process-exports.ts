import { adminPool } from '../../lib/admin-db.js';
import { generateExportFile } from '../export-service.js';
import { createLogger } from '../../lib/logger.js';

// This worker runs cross-tenant on a schedule, so it uses adminPool (the
// table-owner connection that bypasses RLS). The request-scoped `pool` runs
// as the `app` role with no tenant/admin context set, so its RLS policy
// (tenant_id = tenant_id() AND is_admin()) matches zero rows and the claim
// silently no-ops — which is why pending jobs never got picked up.
const logger = createLogger('process_exports');

export async function processExportJobs(): Promise<void> {
  const claim = await adminPool.query(
    `UPDATE export_jobs
     SET status='running', started_at=now()
     WHERE id = (
       SELECT id FROM export_jobs
       WHERE status='pending'
       ORDER BY created_at
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
     RETURNING *`
  );
  if (claim.rowCount === 0) return;
  const job = claim.rows[0];
  try {
    const result = await generateExportFile(job);
    await adminPool.query(
      `UPDATE export_jobs
       SET status='ready', finished_at=now(), r2_key=$2, signed_url_expires_at=$3
       WHERE id=$1`,
      [job.id, result.storageKey, result.signedUrlExpiresAt]
    );
    await adminPool.query(
      `INSERT INTO centrifugo_outbox(method, payload)
       VALUES ('publish', jsonb_build_object(
         'channel', 'tenant.' || $1::text || '.dashboard',
         'data', jsonb_build_object('type','export_ready','job_id', $2::text)
       ))`,
      [job.tenant_id, job.id]
    );
    logger.info({ jobId: job.id }, 'export ready');
  } catch (err) {
    logger.error({ err, jobId: job.id }, 'export failed');
    await adminPool.query(
      `UPDATE export_jobs
       SET status='failed', finished_at=now(), error=$2
       WHERE id=$1`,
      [job.id, (err as Error).message.slice(0, 500)]
    );
  }
}
