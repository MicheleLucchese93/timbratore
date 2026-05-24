import { v4 as uuidv4 } from 'uuid';
import type { Request, Response, NextFunction } from 'express';

declare module 'express-serve-static-core' {
  interface Request {
    id: string;
  }
}

export function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id');
  req.id = incoming && /^[a-zA-Z0-9-]{6,64}$/.test(incoming) ? incoming : uuidv4();
  res.setHeader('x-request-id', req.id);
  next();
}
