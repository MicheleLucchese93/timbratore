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
      // Additive capability (independent of role): may manage + OTP-view every
      // employee's documents. A member can be admin OR user AND a documentale.
      isDocumentale: boolean;
      // Cantieri module role (additive, like isDocumentale). null = no access.
      // Only meaningful while the tenant flag cantieriEnabled is true.
      cantieriRole: 'admin' | 'user' | null;
      cantieriEnabled: boolean;
      membershipId: string;
    };
  }
}

export interface ResolvedMembership {
  tenantId: string;
  role: 'admin' | 'user';
  isDocumentale: boolean;
  cantieriRole: 'admin' | 'user' | null;
  cantieriEnabled: boolean;
  membershipId: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve which membership a request operates under.
 *
 * - With `requestedTenantId` (the X-Tenant-Id header): returns that tenant's
 *   membership ONLY IF the user is an active member of it, otherwise null.
 *   This is the access-control gate — the header is client-supplied, so a user
 *   must never act on a tenant they don't belong to even if they pass its id.
 * - Without it (single-tenant / back-compat): returns the most-recent active
 *   membership.
 */
export async function fetchMembership(
  userId: string,
  requestedTenantId?: string | null
): Promise<ResolvedMembership | null> {
  const params: unknown[] = [userId];
  let tenantFilter = '';
  if (requestedTenantId) {
    params.push(requestedTenantId);
    tenantFilter = 'AND m.tenant_id = $2';
  }
  const r = await adminPool.query(
    `SELECT m.id, m.tenant_id, m.role, m.is_documentale, m.cantieri_role,
            t.cantieri_enabled
     FROM memberships m
     JOIN tenants t ON t.id = m.tenant_id
     WHERE m.user_id = $1
       ${tenantFilter}
       AND m.active = TRUE
       AND m.deleted_at IS NULL
       AND t.deleted_at IS NULL
       -- A partner/admin can suspend a tenant from the partnership app; while
       -- suspended no membership resolves, so its users can't sign in. Default
       -- NULL (every existing tenant) → no change in behavior.
       AND t.suspended_at IS NULL
     ORDER BY m.created_at DESC
     LIMIT 1`,
    params
  );
  if (r.rowCount === 0) return null;
  const row = r.rows[0];
  return {
    membershipId: row.id,
    tenantId: row.tenant_id,
    role: row.role,
    isDocumentale: row.is_documentale === true,
    cantieriRole: row.cantieri_role ?? null,
    cantieriEnabled: row.cantieri_enabled === true,
  };
}

interface MembershipCache extends ResolvedMembership {
  fetchedAt: number;
}

const cache = new Map<string, MembershipCache>();
const CACHE_TTL_MS = 60_000;

function cacheKey(userId: string, tenantId?: string | null): string {
  return tenantId ? `${userId}:${tenantId}` : userId;
}

async function loadMembership(
  userId: string,
  requestedTenantId?: string | null
): Promise<ResolvedMembership | null> {
  const key = cacheKey(userId, requestedTenantId);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) return hit;
  const m = await fetchMembership(userId, requestedTenantId);
  if (!m) return null;
  cache.set(key, { ...m, fetchedAt: Date.now() });
  return m;
}

export function invalidateMembershipCache(userId?: string): void {
  if (!userId) {
    cache.clear();
    return;
  }
  // A user now has both a tenant-agnostic cache key and one per chosen tenant;
  // drop them all so a membership/role change can't be served stale.
  for (const key of cache.keys()) {
    if (key === userId || key.startsWith(`${userId}:`)) cache.delete(key);
  }
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

    // Optional explicit tenant selection for users who belong to more than one
    // company. The header is untrusted: loadMembership re-checks the user is an
    // active member, so an unknown/garbage/foreign id resolves to no membership
    // and yields 403 — never silent cross-tenant access.
    const rawTenant = req.header('x-tenant-id')?.trim();
    const requestedTenantId = rawTenant ? rawTenant : null;
    if (requestedTenantId && !UUID_RE.test(requestedTenantId)) {
      throw new ForbiddenError('Invalid tenant', 'TENANT_NOT_ALLOWED');
    }

    const membership = await loadMembership(payload.sub, requestedTenantId);
    if (!membership) {
      if (requestedTenantId) {
        throw new ForbiddenError('Not a member of the requested tenant', 'TENANT_NOT_ALLOWED');
      }
      throw new ForbiddenError('No active tenant', 'NO_ACTIVE_TENANT');
    }
    req.user = {
      id: payload.sub,
      email: payload.email ?? null,
      tenantId: membership.tenantId,
      role: membership.role,
      isDocumentale: membership.isDocumentale,
      cantieriRole: membership.cantieriRole,
      cantieriEnabled: membership.cantieriEnabled,
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

// Gate for the document-management surface (upload / list-all / delete / OTP).
// This is the ONLY way to reach another employee's documents — a plain admin
// without the capability is rejected, same as a base user.
export function requireDocumentale(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) return next(new UnauthorizedError());
  if (!req.user.isDocumentale) return next(new ForbiddenError('Documentale role required', 'DOCUMENTALE_REQUIRED'));
  next();
}

// Gates for the Cantieri module. Both require the tenant feature flag (set
// from the partner console); the role is the per-user module role, additive
// to admin|user exactly like isDocumentale.
export function requireCantieri(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) return next(new UnauthorizedError());
  if (!req.user.cantieriEnabled || req.user.cantieriRole === null) {
    return next(new ForbiddenError('Cantieri module required', 'CANTIERI_REQUIRED'));
  }
  next();
}

export function requireCantieriAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) return next(new UnauthorizedError());
  if (!req.user.cantieriEnabled || req.user.cantieriRole !== 'admin') {
    return next(new ForbiddenError('Cantieri admin role required', 'CANTIERI_ADMIN_REQUIRED'));
  }
  next();
}
