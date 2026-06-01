import type { Request, Response, NextFunction } from 'express';
import { createHash } from 'node:crypto';
import { pool } from '../lib/db.js';
import { ValidationError } from '../errors/index.js';

const KEY_TTL_HOURS = 24;

export function idempotencyMiddleware(scope: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const rawKey = req.header('idempotency-key');
    if (!rawKey) {
      next(new ValidationError('Missing Idempotency-Key header', { code: 'MISSING_IDEMPOTENCY_KEY' }));
      return;
    }
    if (!/^[a-zA-Z0-9-]{8,128}$/.test(rawKey)) {
      next(new ValidationError('Invalid Idempotency-Key', { code: 'MISSING_IDEMPOTENCY_KEY' }));
      return;
    }
    // idempotency_keys is a global table (RLS policy is USING(true)), so a key
    // collision across tenants would otherwise replay another tenant's cached
    // response_body. Namespace the stored key by hashing the
    // (tenant, user, client-key) triple — collisions stay within one user.
    // This middleware runs after `authenticate`, so req.user is populated.
    const ns = `${req.user?.tenantId ?? 'anon'}:${req.user?.id ?? 'anon'}`;
    const key = createHash('sha256').update(`${ns}:${rawKey}`).digest('hex');
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
