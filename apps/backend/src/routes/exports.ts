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
  format: z.enum(['xlsx', 'json', 'centro']),
  period_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  filters: z.record(z.string(), z.unknown()).default({}),
});

// Centro Paghe files are one company / one calendar month (filename carries the
// MMAAAA period), so the range must be a whole month — first to last day.
function assertSingleCalendarMonth(from: string, to: string): void {
  const y = Number(from.slice(0, 4));
  const m = Number(from.slice(5, 7));
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const expectedTo = `${from.slice(0, 7)}-${String(lastDay).padStart(2, '0')}`;
  if (from.slice(8, 10) !== '01' || to !== expectedTo) {
    throw new ValidationError(
      'Il formato Centro Paghe richiede un mese intero (dal primo all’ultimo giorno).'
    );
  }
}

exportsRouter.post(
  '/',
  tenantHandler(async (req, res, client) => {
    const parse = Enqueue.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const b = parse.data;
    if (b.format === 'centro') assertSingleCalendarMonth(b.period_from, b.period_to);
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
    let filename = job.r2_key.split('/').pop()!;
    let contentType: string;
    if (job.format === 'xlsx') {
      contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    } else if (job.format === 'centro') {
      contentType = 'text/plain; charset=ISO-8859-1';
      // ORARIO_<CODICE DITTA>_<MMAAAA>.TXT — Centro Paghe import filename.
      const pf = job.period_from instanceof Date
        ? job.period_from.toISOString().slice(0, 10)
        : String(job.period_from).slice(0, 10);
      const mmaaaa = pf.slice(5, 7) + pf.slice(0, 4);
      const tr = await client.query(`SELECT codice_ditta FROM tenants WHERE id = $1`, [
        job.tenant_id,
      ]);
      const ditta = String(tr.rows[0]?.codice_ditta ?? '').trim() || 'AZIENDA';
      filename = `ORARIO_${ditta}_${mmaaaa}.TXT`;
    } else {
      contentType = 'application/json';
    }
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
