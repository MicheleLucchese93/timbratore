import type { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../lib/jwt.js';
import { UnauthorizedError } from '../errors/index.js';

declare module 'express-serve-static-core' {
  interface Request {
    /** A signed-in ACCOUNT that may not belong to any company yet. */
    account?: { id: string; email: string | null };
  }
}

/**
 * Authenticate the person, not a membership — for the self-service onboarding
 * wizard only (routes/onboarding.ts), where a freshly confirmed account has no
 * company yet and `authenticate` would answer NO_ACTIVE_TENANT.
 *
 * It grants no tenant scope whatsoever: nothing mounted behind it may read or
 * write tenant data except through the explicit onboarding steps. A partner's
 * read-only support token is refused outright — it has no business here.
 */
export async function authenticateAccount(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.header('authorization');
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedError('Missing bearer token');
    let payload;
    try {
      payload = await verifyToken(header.slice('Bearer '.length).trim());
    } catch (e) {
      const expired = (e as { code?: string }).code === 'ERR_JWT_EXPIRED';
      throw new UnauthorizedError(expired ? 'Token expired' : 'Invalid token', expired ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN');
    }
    if (!payload.sub) throw new UnauthorizedError('Invalid token: missing sub');
    if ((payload as { sq_support?: unknown }).sq_support) {
      throw new UnauthorizedError('Support sessions cannot onboard', 'SUPPORT_SESSION_INVALID');
    }
    req.account = { id: payload.sub, email: payload.email?.toLowerCase() ?? null };
    next();
  } catch (err) {
    next(err);
  }
}
