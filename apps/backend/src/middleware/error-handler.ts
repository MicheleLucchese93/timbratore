import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/index.js';
import { fail } from '../lib/api-response.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('error-handler');

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    if (err.status >= 500) {
      logger.error({ reqId: req.id, err, path: req.path }, 'app error');
    } else {
      logger.warn({ reqId: req.id, code: err.code, path: req.path, msg: err.message });
    }
    fail(res, err.status, err.code, err.message, err.details);
    return;
  }
  logger.error({ reqId: req.id, err, path: req.path }, 'unhandled error');
  const message = err instanceof Error ? err.message : 'Internal server error';
  fail(res, 500, 'INTERNAL', message);
}
