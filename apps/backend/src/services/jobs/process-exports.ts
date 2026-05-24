import { pool } from '../../lib/db.js';
import { generateExportFile } from '../export-service.js';
import { createLogger } from '../../lib/logger.js';

const logger = createLogger('process_exports');

export async function processExportJobs(): Promise<void> {
  const claim = await pool.query(
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
    await pool.query(
      `UPDATE export_jobs
       SET status='ready', finished_at=now(), r2_key=$2, signed_url_expires_at=$3
       WHERE id=$1`,
      [job.id, result.storageKey, result.signedUrlExpiresAt]
    );
    await pool.query(
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
    await pool.query(
      `UPDATE export_jobs
       SET status='failed', finished_at=now(), error=$2
       WHERE id=$1`,
      [job.id, (err as Error).message.slice(0, 500)]
    );
  }
}
