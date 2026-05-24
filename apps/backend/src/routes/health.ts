import { Router } from 'express';
import { pool } from '../lib/db.js';
import { ok, fail } from '../lib/api-response.js';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => ok(res, { status: 'ok' }));
healthRouter.get('/live', (_req, res) => ok(res, { status: 'alive' }));
healthRouter.get('/ready', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    ok(res, { status: 'ready', db: 'ok' });
  } catch (err) {
    fail(res, 503, 'NOT_READY', (err as Error).message);
  }
});
