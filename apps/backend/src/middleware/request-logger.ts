import type { Request, Response, NextFunction } from 'express';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('http');

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  res.on('finish', () => {
    logger.info({
      reqId: req.id,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durMs: Date.now() - start,
    });
  });
  next();
}
