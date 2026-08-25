import type { Request, Response, NextFunction } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import {
  API_MODULE_RESOURCES,
  apiScopeSatisfied,
  type ApiScope,
} from '@sonoqui/shared';
import { ForbiddenError, UnauthorizedError } from '../errors/index.js';
import { resolveApiKey, touchApiKey, type ResolvedApiKey } from '../lib/api-keys.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('api-key');

declare module 'express-serve-static-core' {
  interface Request {
    /**
     * The API key a /api/public/v1 request authenticated with.
     *
     * Set INSTEAD of `req.user`, never alongside it: a key is a company
     * credential with no person behind it, so nothing downstream may read an
     * actor out of it. Every public handler scopes its own queries by
     * `req.apiKey.tenantId` on the service role — there is no membership and
     * therefore no RLS session to lean on.
     */
    apiKey?: ResolvedApiKey;
  }
}

/**
 * Pull the presented token out of the request.
 *
 * Two accepted forms, because integrators arrive with both: the RFC-shaped
 * `Authorization: Bearer <token>` and the `X-Api-Key: <token>` that most
 * gestionali's HTTP connectors offer as a checkbox. Query-string keys are NOT
 * accepted at any point — they end up in access logs, browser history and
 * referrer headers, which is precisely the failure this module must not have.
 */
function presentedToken(req: Request): string | null {
  const header = req.header('authorization');
  if (header?.startsWith('Bearer ')) return header.slice('Bearer '.length).trim();
  const alt = req.header('x-api-key');
  if (alt) return alt.trim();
  return null;
}

export async function apiKeyAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = presentedToken(req);
    if (!token) {
      res.setHeader('WWW-Authenticate', 'Bearer realm="sonoQui API"');
      throw new UnauthorizedError('Missing API key', 'API_KEY_MISSING');
    }
    const resolution = await resolveApiKey(token);
    if (!resolution.ok) {
      // ONE code for every refusal that concerns the credential itself
      // (unknown / wrong secret / revoked / expired). Splitting them would let
      // a caller enumerate valid key_ids by watching which error came back.
      // `module_disabled` is the single exception and is reported separately:
      // the customer's own admin can see the module is off in Settings, so it
      // reveals nothing they do not already know, and it is by far the most
      // likely cause of a working integration stopping overnight.
      if (resolution.reason === 'module_disabled') {
        throw new ForbiddenError('API module not enabled for this company', 'API_MODULE_DISABLED');
      }
      if (resolution.reason === 'tenant_unavailable') {
        throw new ForbiddenError('Company not available', 'API_TENANT_UNAVAILABLE');
      }
      logger.warn(
        { reason: resolution.reason, ip: req.ip, path: req.path },
        'API key rejected'
      );
      res.setHeader('WWW-Authenticate', 'Bearer realm="sonoQui API", error="invalid_token"');
      throw new UnauthorizedError('Invalid API key', 'API_KEY_INVALID');
    }
    req.apiKey = resolution.key;
    touchApiKey(resolution.key.id, req.ip ?? null);
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Per-key ceiling, on top of the app-wide limiter in app.ts.
 *
 * Keyed by the key's own id rather than the source IP: one customer's server
 * behind one NAT must not be able to spend another's budget, and a customer
 * running two integrations from the same host gets two independent budgets.
 * The ceiling itself is per-row (api_keys.rate_limit_per_min), so a nightly
 * bulk pull can be raised without loosening anything else.
 */
export const apiKeyRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: (req: Request) => req.apiKey?.rateLimitPerMin ?? 60,
  // req.apiKey is always set here (this runs after apiKeyAuth), so the fallback
  // is belt to that braces — but it must still go through ipKeyGenerator, which
  // masks an IPv6 address to its /64. Without it a caller on IPv6 gets a fresh
  // bucket per address from a range they own, i.e. no limit at all; the library
  // rejects a bare req.ip for exactly that reason.
  keyGenerator: (req: Request) => req.apiKey?.id ?? ipKeyGenerator(req.ip ?? ''),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { ok: false, error: { code: 'API_RATE_LIMITED', message: 'Rate limit exceeded' } },
});

/**
 * The guard for requests that never authenticated, keyed by source IP.
 *
 * The app-wide limiter in app.ts skips /api/public/ (it keys on IP, which is the
 * wrong unit once a request is attributable to a key), so without this the auth
 * path would have no ceiling at all — and hammering it is exactly how somebody
 * would probe for a valid key_id. It therefore has to run BEFORE
 * authentication, which is the whole difficulty: a plain IP ceiling there also
 * caps every authenticated caller at this number, silently overriding the
 * per-key ceiling the customer was sold.
 *
 * `requestWasSuccessful` is what resolves that, and it is load-bearing rather
 * than a refinement. The library's default reads "success" as `status < 400`,
 * which is NOT the question here: 4xx is a normal answer on this API — 409 when
 * a sync re-adds an employee who already exists, 404 when it asks about a
 * leaver — so an ordinary nightly job would have accumulated against a 60/min
 * IP budget and stopped. What actually matters is whether the request PROVED
 * ITSELF, and `req.apiKey` (set by apiKeyAuth, which runs after this middleware
 * but before the response finishes) is exactly that fact. So: a request that
 * authenticated is never counted, whatever it then answered; a request that
 * never resolved a key always is.
 */
export const apiAnonymousRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  skipSuccessfulRequests: true,
  requestWasSuccessful: (req: Request) => req.apiKey !== undefined,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { ok: false, error: { code: 'API_RATE_LIMITED', message: 'Rate limit exceeded' } },
});

/**
 * Gate one route on one scope.
 *
 * `resource:write` implies `resource:read` (see apiScopeSatisfied) so an
 * integration that creates a punch and reads it back needs one box ticked, not
 * two. Where a resource belongs to another billable module, that module's own
 * tenant flag is checked here too — a `cantieri:read` scope on a company that
 * never bought Cantieri must not become a way in once somebody enables it by
 * mistake at the console.
 */
export function requireScope(scope: ApiScope) {
  const resource = scope.split(':')[0] as keyof typeof API_MODULE_RESOURCES;
  const needsModule = API_MODULE_RESOURCES[resource];
  return (req: Request, _res: Response, next: NextFunction): void => {
    const key = req.apiKey;
    if (!key) return next(new UnauthorizedError('Missing API key', 'API_KEY_MISSING'));
    if (needsModule === 'cantieri' && !key.cantieriEnabled) {
      return next(new ForbiddenError('Cantieri module not enabled', 'CANTIERI_REQUIRED'));
    }
    if (!apiScopeSatisfied(key.scopes, scope)) {
      return next(
        new ForbiddenError(`Missing scope: ${scope}`, 'API_SCOPE_MISSING')
      );
    }
    next();
  };
}
