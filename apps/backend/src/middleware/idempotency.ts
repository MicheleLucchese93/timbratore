import type { Request, Response, NextFunction } from 'express';
import { createHash } from 'node:crypto';
import { pool } from '../lib/db.js';
import { ValidationError } from '../errors/index.js';

const KEY_TTL_HOURS = 24;

const KEY_FORMAT = /^[a-zA-Z0-9-]{8,128}$/;

/**
 * Claim a key, replay a finished response, or refuse a request still in flight.
 *
 * `idempotency_keys` is a GLOBAL table (its RLS policy is `USING(true)`), so the
 * stored key must carry its own namespace or one caller's key could replay
 * another's cached response body. `ns` is that namespace, and it is the one
 * thing every caller of this helper must get right.
 *
 * Returns true when the request should proceed, false when this middleware has
 * already answered it.
 */
async function claimOrReplay(
  res: Response,
  ns: string,
  rawKey: string,
  scope: string
): Promise<boolean> {
  const key = createHash('sha256').update(`${ns}:${rawKey}`).digest('hex');
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
      return false;
    }
    res.status(409).json({
      ok: false,
      error: { code: 'IDEMPOTENCY_IN_FLIGHT', message: 'Request still in flight; retry later' },
    });
    return false;
  }
  // Record whatever the handler answers, so the retry replays it verbatim.
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
  return true;
}

export function idempotencyMiddleware(scope: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const rawKey = req.header('idempotency-key');
    if (!rawKey) {
      next(new ValidationError('Missing Idempotency-Key header', { code: 'MISSING_IDEMPOTENCY_KEY' }));
      return;
    }
    if (!KEY_FORMAT.test(rawKey)) {
      next(new ValidationError('Invalid Idempotency-Key', { code: 'MISSING_IDEMPOTENCY_KEY' }));
      return;
    }
    // Namespaced by the (tenant, user, client-key) triple; collisions stay
    // within one user. This middleware runs after `authenticate`, so req.user is
    // populated.
    const ns = `${req.user?.tenantId ?? 'anon'}:${req.user?.id ?? 'anon'}`;
    try {
      if (await claimOrReplay(res, ns, rawKey, scope)) next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * The API-module counterpart: idempotency for a request authenticated by a KEY.
 *
 * Two deliberate differences from the tenant middleware above.
 *
 * NAMESPACE. `req.user` does not exist here, and the fallback in the other
 * middleware is the literal string `anon` — so every machine client in every
 * company would have shared one `anon:anon` namespace on a globally-readable
 * table. One customer's retry could replay another customer's created punch.
 * The namespace is the key's own id, which is per-tenant by construction.
 *
 * OPTIONAL. The header is honoured when sent and not required when it is not.
 * A public API cannot make a header mandatory without breaking every client
 * that has not heard of it, and the guarantee is the caller's to want: a badge
 * reader retrying a timed-out punch needs it, a nightly export job does not.
 * Sending the same key twice replays the first answer instead of filing a
 * second punch — which is the failure this exists to prevent, because a
 * duplicate clock-in is not something the employee can see and undo.
 */
export function apiIdempotency(scope: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const rawKey = req.header('idempotency-key');
    if (!rawKey) return next();
    if (!KEY_FORMAT.test(rawKey)) {
      next(
        new ValidationError(
          'Idempotency-Key must be 8 to 128 characters of letters, digits or hyphens',
          { code: 'INVALID_IDEMPOTENCY_KEY' }
        )
      );
      return;
    }
    const keyId = req.apiKey?.id;
    if (!keyId) return next();
    try {
      if (await claimOrReplay(res, `api:${keyId}`, rawKey, scope)) next();
    } catch (err) {
      next(err);
    }
  };
}
