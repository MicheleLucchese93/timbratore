import type { Request, Response, NextFunction } from 'express';
import type { PoolClient } from 'pg';
import { withTenantRLS } from './db.js';
import { UnauthorizedError } from '../errors/index.js';

export type TenantHandler = (
  req: Request,
  res: Response,
  client: PoolClient
) => Promise<void>;

export function tenantHandler(fn: TenantHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) return next(new UnauthorizedError());
    withTenantRLS(req.user.id, req.user.tenantId, (client) =>
      fn(req, res, client)
    ).catch(next);
  };
}

export type AsyncHandler = (
  req: Request,
  res: Response
) => Promise<void> | void;

export function asyncHandler(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}
