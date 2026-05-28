import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { adminPool } from '../lib/admin-db.js';
import { env } from '../env.js';
import { ForbiddenError } from '../errors/index.js';
import { ok } from '../lib/api-response.js';
import { createLogger } from '../lib/logger.js';
import { asyncHandler } from '../lib/route-helpers.js';

const logger = createLogger('internal-e2e');

// Hardcoded match pattern. Cannot be overridden by request input — the only
// rows this endpoint will ever touch are e2e fixtures whose email matches
// the suite's own seed format.
const E2E_EMAIL_PATTERN = 'e2e-%@e2e.local';

function bearerMatches(header: string | undefined, secret: string): boolean {
  if (!header?.startsWith('Bearer ')) return false;
  const provided = header.slice('Bearer '.length).trim();
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export const internalE2eRouter = Router();

internalE2eRouter.post(
  '/purge-fixtures',
  asyncHandler(async (req, res) => {
    const secret = env.E2E_PURGE_SECRET;
    if (!secret) throw new ForbiddenError('purge endpoint disabled');
    if (!bearerMatches(req.header('authorization'), secret)) {
      throw new ForbiddenError('invalid purge token');
    }

    const client = await adminPool.connect();
    try {
      await client.query('BEGIN');
      const m = await client.query(
        `DELETE FROM memberships
         WHERE user_id IN (SELECT id FROM auth_users WHERE email LIKE $1)`,
        [E2E_EMAIL_PATTERN]
      );
      const a = await client.query(`DELETE FROM auth_users WHERE email LIKE $1`, [E2E_EMAIL_PATTERN]);
      const g = await client.query(`DELETE FROM auth.users WHERE email LIKE $1`, [E2E_EMAIL_PATTERN]);
      await client.query('COMMIT');
      logger.info(
        { memberships: m.rowCount, auth_users: a.rowCount, gotrue_users: g.rowCount },
        'e2e fixtures purged'
      );
      ok(res, {
        memberships_deleted: m.rowCount,
        auth_users_deleted: a.rowCount,
        gotrue_users_deleted: g.rowCount,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  })
);
