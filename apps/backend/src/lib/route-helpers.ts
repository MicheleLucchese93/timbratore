import type { Request, Response, NextFunction } from 'express';
import type { PoolClient } from 'pg';
import { withTenantRLS } from './db.js';
import { ok } from './api-response.js';
import { UnauthorizedError } from '../errors/index.js';

export type TenantHandler = (
  req: Request,
  res: Response,
  client: PoolClient
) => Promise<unknown>;

export function tenantHandler(fn: TenantHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) return next(new UnauthorizedError());
    withTenantRLS(req.user.id, req.user.tenantId, (client) =>
      fn(req, res, client)
    ).catch(next);
  };
}

export type TenantMutation = (
  req: Request,
  client: PoolClient
) => Promise<{ data: unknown; status?: number }>;

// Like tenantHandler, but the handler RETURNS its payload instead of calling
// ok() itself, and the response is sent only after withTenantRLS COMMITs.
// Use for mutations the client immediately re-reads (e.g. stamp create/undo
// followed by GET /current-state): sending the 2xx before COMMIT opens a
// read-after-write race where a fast follow-up GET on another pooled
// connection runs under READ COMMITTED and can't yet see the just-written row.
// Android (warm HTTP/2 reuse) loses this race deterministically; iOS's slower
// inter-request timing usually hides it. Committing first closes it for all.
export function tenantMutation(fn: TenantMutation) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) return next(new UnauthorizedError());
    withTenantRLS(req.user.id, req.user.tenantId, (client) => fn(req, client))
      .then(({ data, status }) => ok(res, data, status ?? 200))
      .catch(next);
  };
}

export type AsyncHandler = (
  req: Request,
  res: Response
) => Promise<unknown> | unknown;

export function asyncHandler(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}
