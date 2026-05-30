import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { tenantHandler } from '../lib/route-helpers.js';
import { ok } from '../lib/api-response.js';
import { NotFoundError, ValidationError } from '../errors/index.js';
import { processExportJobs } from '../services/jobs/process-exports.js';
import { readExportFile, deleteExportFile } from '../services/export-service.js';
import { env } from '../env.js';

export const exportsRouter = Router();
exportsRouter.use(authenticate);
exportsRouter.use(requireAdmin);

const Enqueue = z.object({
  format: z.enum(['xlsx', 'json']),
  period_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  filters: z.record(z.string(), z.unknown()).default({}),
});

exportsRouter.post(
  '/',
  tenantHandler(async (req, res, client) => {
    const parse = Enqueue.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const b = parse.data;
    const r = await client.query(
      `INSERT INTO export_jobs(tenant_id, requested_by, format, period_from, period_to, filters)
       VALUES (current_setting('app.current_tenant_id')::uuid, current_setting('app.current_user_id')::uuid,
               $1, $2, $3, $4)
       RETURNING *`,
      [b.format, b.period_from, b.period_to, b.filters]
    );
    if (!env.SCHEDULER_ENABLED) {
      processExportJobs().catch(() => {});
    }
    ok(res, r.rows[0], 201);
  })
);

exportsRouter.get(
  '/',
  tenantHandler(async (_req, res, client) => {
    const r = await client.query(
      `SELECT * FROM export_jobs ORDER BY created_at DESC LIMIT 100`
    );
    ok(res, r.rows);
  })
);

exportsRouter.get(
  '/:id',
  tenantHandler(async (req, res, client) => {
    const r = await client.query(`SELECT * FROM export_jobs WHERE id = $1`, [req.params.id]);
    if (r.rowCount === 0) throw new NotFoundError('export job');
    ok(res, r.rows[0]);
  })
);

exportsRouter.get(
  '/:id/download',
  tenantHandler(async (req, res, client) => {
    const j = await client.query(`SELECT * FROM export_jobs WHERE id = $1`, [req.params.id]);
    if (j.rowCount === 0) throw new NotFoundError('export job');
    const job = j.rows[0];
    if (job.status !== 'ready' || !job.r2_key) throw new NotFoundError('export not ready');
    const buf = await readExportFile(job.r2_key);
    const filename = job.r2_key.split('/').pop()!;
    const contentType =
      job.format === 'xlsx'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'application/json';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buf);
  })
);

exportsRouter.delete(
  '/:id',
  tenantHandler(async (req, res, client) => {
    const r = await client.query(`DELETE FROM export_jobs WHERE id = $1 RETURNING *`, [
      req.params.id,
    ]);
    if (r.rowCount === 0) throw new NotFoundError('export job');
    const job = r.rows[0];
    if (job.r2_key) {
      await deleteExportFile(job.r2_key).catch(() => {});
    }
    ok(res, { deleted: true });
  })
);
