import type { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../lib/jwt.js';
import { adminPool } from '../lib/admin-db.js';
import { env } from '../env.js';
import { ForbiddenError, UnauthorizedError } from '../errors/index.js';

// The lone platform super-user. Gates the irreversible tenant-delete capability
// (env-configurable; defaults to the migration-044 first-admin seed).
export function isSuperAdmin(email: string | null | undefined): boolean {
  return !!email && email.trim().toLowerCase() === env.SUPER_ADMIN_EMAIL.trim().toLowerCase();
}

export interface PartnerCaps {
  // null on any cap = unlimited for that dimension. All caps are ignored for
  // role='admin' (a platform admin is always unlimited).
  capTenants: number | null;
  capUsersPerTenant: number | null;
  capAdminsPerTenant: number | null;
  capDocumentaliPerTenant: number | null;
  capBranchesPerTenant: number | null;
}

export interface PartnerContext extends PartnerCaps {
  userId: string;
  email: string | null;
  role: 'admin' | 'partner';
}

declare module 'express-serve-static-core' {
  interface Request {
    partner?: PartnerContext;
  }
}

// Authenticate the partnership/reseller app. Verifies the GoTrue JWT (same
// secret as the main app) but resolves PARTNERSHIP membership instead of a
// per-tenant membership — so a reseller with no tenant of their own can still
// sign in. Fully isolated from the main `authenticate` middleware.
export async function authenticatePartner(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const header = req.header('authorization');
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedError('Missing bearer token');
    const token = header.slice('Bearer '.length).trim();
    let payload;
    try {
      payload = await verifyToken(token);
    } catch (e) {
      const joseCode = (e as { code?: string }).code;
      const expired = joseCode === 'ERR_JWT_EXPIRED';
      throw new UnauthorizedError(
        expired ? 'Token expired' : 'Invalid token',
        expired ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN'
      );
    }
    if (!payload.sub) throw new UnauthorizedError('Invalid token: missing sub');

    const r = await adminPool.query(
      `SELECT role, active, cap_tenants, cap_users_per_tenant, cap_admins_per_tenant,
              cap_documentali_per_tenant, cap_branches_per_tenant
         FROM partnership_members WHERE user_id = $1`,
      [payload.sub]
    );
    if (r.rowCount === 0) {
      throw new ForbiddenError('Not a partnership member', 'NOT_PARTNERSHIP_MEMBER');
    }
    const row = r.rows[0];
    if (row.active !== true) {
      throw new ForbiddenError('Partnership access deactivated', 'PARTNERSHIP_INACTIVE');
    }
    req.partner = {
      userId: payload.sub,
      email: payload.email ?? null,
      role: row.role,
      capTenants: row.cap_tenants,
      capUsersPerTenant: row.cap_users_per_tenant,
      capAdminsPerTenant: row.cap_admins_per_tenant,
      capDocumentaliPerTenant: row.cap_documentali_per_tenant,
      capBranchesPerTenant: row.cap_branches_per_tenant,
    };
    next();
  } catch (err) {
    next(err);
  }
}

// Gate for platform-admin-only operations (managing partners, seeing all tenants).
export function requirePartnershipAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.partner) return next(new UnauthorizedError());
  if (req.partner.role !== 'admin') {
    return next(new ForbiddenError('Platform admin required', 'PARTNERSHIP_ADMIN_REQUIRED'));
  }
  next();
}

// Gate for the irreversible super-user-only operation: permanently deleting a
// tenant. Strictly tighter than requirePartnershipAdmin — even other platform
// admins are refused. Identity comes from the verified JWT email claim.
export function requireSuperAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.partner) return next(new UnauthorizedError());
  if (!isSuperAdmin(req.partner.email)) {
    return next(new ForbiddenError('Super admin required', 'SUPER_ADMIN_REQUIRED'));
  }
  next();
}
