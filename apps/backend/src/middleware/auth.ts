import type { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../lib/jwt.js';
import { adminPool } from '../lib/admin-db.js';
import { ForbiddenError, UnauthorizedError } from '../errors/index.js';

declare module 'express-serve-static-core' {
  interface Request {
    user?: {
      id: string;
      email: string | null;
      tenantId: string;
      role: 'admin' | 'user';
      membershipId: string;
    };
  }
}

interface MembershipCache {
  tenantId: string;
  role: 'admin' | 'user';
  membershipId: string;
  fetchedAt: number;
}

const cache = new Map<string, MembershipCache>();
const CACHE_TTL_MS = 60_000;

async function loadMembership(userId: string): Promise<MembershipCache | null> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) return hit;
  const r = await adminPool.query(
    `SELECT m.id, m.tenant_id, m.role
     FROM memberships m
     JOIN tenants t ON t.id = m.tenant_id
     WHERE m.user_id = $1
       AND m.active = TRUE
       AND m.deleted_at IS NULL
       AND t.deleted_at IS NULL
     ORDER BY m.created_at DESC
     LIMIT 1`,
    [userId]
  );
  if (r.rowCount === 0) return null;
  const row = r.rows[0];
  const entry: MembershipCache = {
    membershipId: row.id,
    tenantId: row.tenant_id,
    role: row.role,
    fetchedAt: Date.now(),
  };
  cache.set(userId, entry);
  return entry;
}

export function invalidateMembershipCache(userId?: string): void {
  if (userId) cache.delete(userId);
  else cache.clear();
}

export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const header = req.header('authorization');
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedError('Missing bearer token');
    }
    const token = header.slice('Bearer '.length).trim();
    let payload;
    try {
      payload = await verifyToken(token);
    } catch (e) {
      const joseCode = (e as { code?: string }).code;
      const code = joseCode === 'ERR_JWT_EXPIRED' ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN';
      const message = joseCode === 'ERR_JWT_EXPIRED' ? 'Token expired' : 'Invalid token';
      throw new UnauthorizedError(message, code);
    }
    if (!payload.sub) throw new UnauthorizedError('Invalid token: missing sub');
    const membership = await loadMembership(payload.sub);
    if (!membership) {
      throw new ForbiddenError('No active tenant', 'NO_ACTIVE_TENANT');
    }
    req.user = {
      id: payload.sub,
      email: payload.email ?? null,
      tenantId: membership.tenantId,
      role: membership.role,
      membershipId: membership.membershipId,
    };
    next();
  } catch (err) {
    next(err);
  }
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) return next(new UnauthorizedError());
  if (req.user.role !== 'admin') return next(new ForbiddenError());
  next();
}
