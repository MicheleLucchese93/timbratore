import type { Request, Response, NextFunction } from 'express';
import { pool } from '../lib/db.js';
import { ValidationError } from '../errors/index.js';

const KEY_TTL_HOURS = 24;

export function idempotencyMiddleware(scope: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const key = req.header('idempotency-key');
    if (!key) {
      next(new ValidationError('Missing Idempotency-Key header', { code: 'MISSING_IDEMPOTENCY_KEY' }));
      return;
    }
    if (!/^[a-zA-Z0-9-]{8,128}$/.test(key)) {
      next(new ValidationError('Invalid Idempotency-Key', { code: 'MISSING_IDEMPOTENCY_KEY' }));
      return;
    }
    try {
      const claim = await pool.query(
        `INSERT INTO idempotency_keys(key, scope, expires_at)
         VALUES ($1, $2, now() + ($3 || ' hours')::interval)
         ON CONFLICT (key) DO NOTHING
         RETURNING key`,
        [key, scope, KEY_TTL_HOURS]
      );
      if (claim.rowCount === 0) {
        const replay = await pool.query(
          `SELECT response_status, response_body FROM idempotency_keys WHERE key = $1`,
          [key]
        );
        if (replay.rows[0]?.response_status) {
          res.status(replay.rows[0].response_status).json(replay.rows[0].response_body);
          return;
        }
        res.status(409).json({
          ok: false,
          error: { code: 'IDEMPOTENCY_IN_FLIGHT', message: 'Request still in flight; retry later' },
        });
        return;
      }
      const origJson = res.json.bind(res);
      res.json = function (body: unknown) {
        const status = res.statusCode;
        pool
          .query(
            `UPDATE idempotency_keys SET response_status = $1, response_body = $2 WHERE key = $3`,
            [status, body, key]
          )
          .catch(() => {});
        return origJson(body);
      };
      next();
    } catch (err) {
      next(err);
    }
  };
}
