import { Router, type Request, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { API_SCOPES } from '@sonoqui/shared';
import { AppError } from '../../errors/index.js';
import { fail } from '../../lib/api-response.js';
import { createLogger } from '../../lib/logger.js';
import {
  apiAnonymousRateLimiter,
  apiKeyAuth,
  apiKeyRateLimiter,
} from '../../middleware/api-key.js';
import { apiHandler } from '../../lib/route-helpers.js';
import { ok } from '../../lib/api-response.js';
import { publicUsersRouter } from './users.js';
import { publicBranchesRouter } from './branches.js';
import { publicStampsRouter } from './stamps.js';
import { publicLeavesRouter, publicQuotasRouter } from './absence.js';
import { publicShiftsRouter, publicAnomaliesRouter } from './planning.js';
import { publicCorrectionsRouter, publicBulletinsRouter } from './comms.js';
import { publicCantieriRouter } from './modules.js';
import {
  publicAuditRouter,
  publicExportsRouter,
  publicReportsRouter,
} from './reporting.js';
import { openApiDocument } from './openapi.js';

/**
 * /api/public/v1 — the API module's surface.
 *
 * Mounted separately from the internal routers, with its own auth, its own rate
 * limiting and its own terminal error handler, because it answers to a different
 * audience: a third-party integration that must keep working across our
 * refactors and must never be handed an internal error string.
 *
 * Order in here is the security order and is not decorative:
 *   1. openapi        — the only unauthenticated path. It describes the surface;
 *                       it exposes no company data.
 *   2. apiKeyAuth     — resolves the presented token, or refuses.
 *   3. rate limiter   — per KEY, from the key's own row. After auth because
 *                       that is what makes it per-key rather than per-IP.
 *   4. resources      — each route additionally gated on one scope.
 *   5. errors         — a terminal handler that never echoes internals.
 */
export const publicApiRouter = Router();

const logger = createLogger('public-api');

// ---- 1. the contract, unauthenticated -------------------------------------
//
// Unauthenticated on purpose: an integrator writing the client needs the
// endpoint list and the schemas BEFORE the customer has minted them a key, and
// the document contains no tenant data. It is generated from the same shared
// constants the API validates against, so it cannot drift from the scope list.
// Its own IP ceiling, and generous: the document is registered BEFORE the two
// limiters below (it must be reachable without a key), and the app-wide limiter
// in app.ts skips this whole prefix — so without this one line the only
// unauthenticated endpoint on the API would have no ceiling whatsoever. Counted
// on success too, unlike the auth guard: there is no legitimate caller that
// needs this document hundreds of times a minute.
publicApiRouter.get(
  '/openapi.json',
  rateLimit({
    windowMs: 60_000,
    limit: 30,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { ok: false, error: { code: 'API_RATE_LIMITED', message: 'Rate limit exceeded' } },
  }),
  (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json(openApiDocument());
  }
);

// ---- 2 + 3. authentication and the per-key budget -------------------------
//
// Two limiters, in this order, because they answer two different questions.
// The first is IP-keyed and counts only FAILED requests: it exists so the auth
// path is not an unbounded oracle for probing key_ids, and counting failures
// only is what keeps it from silently capping an authenticated caller below the
// ceiling their key was sold. The second is per KEY, from the key's own row,
// once there is a key to attribute the request to.
publicApiRouter.use(apiAnonymousRateLimiter);
publicApiRouter.use(apiKeyAuth);
publicApiRouter.use(apiKeyRateLimiter);

/**
 * What this key is. The first call an integrator makes, and the one that turns
 * "403 somewhere" into "we never ticked stamps:write".
 */
publicApiRouter.get(
  '/me',
  apiHandler(async (req, res, client) => {
    const t = await client.query(
      `SELECT id, ragione_sociale, timezone, country, language, cantieri_enabled
         FROM tenants WHERE id = current_setting('app.current_tenant_id')::uuid`
    );
    ok(res, {
      key: {
        name: req.apiKey!.name,
        scopes: req.apiKey!.scopes,
        rate_limit_per_min: req.apiKey!.rateLimitPerMin,
      },
      company: t.rows[0],
      /** Every scope this deployment knows about, so a client can tell "not
       *  granted" from "not a thing". */
      available_scopes: API_SCOPES,
    });
  })
);

// ---- 4. resources ---------------------------------------------------------
publicApiRouter.use('/users', publicUsersRouter);
publicApiRouter.use('/branches', publicBranchesRouter);
publicApiRouter.use('/stamps', publicStampsRouter);
publicApiRouter.use('/anomalies', publicAnomaliesRouter);
publicApiRouter.use('/corrections', publicCorrectionsRouter);
publicApiRouter.use('/leaves', publicLeavesRouter);
publicApiRouter.use('/quotas', publicQuotasRouter);
publicApiRouter.use('/shifts', publicShiftsRouter);
publicApiRouter.use('/bulletins', publicBulletinsRouter);
publicApiRouter.use('/cantieri', publicCantieriRouter);
publicApiRouter.use('/exports', publicExportsRouter);
publicApiRouter.use('/reports', publicReportsRouter);
publicApiRouter.use('/audit', publicAuditRouter);

/**
 * Unknown path inside the API.
 *
 * A 404 with a code rather than falling through to the app's HTML/404 handling:
 * a client that mistyped a path should get a machine-readable answer, and
 * notably a typo must NOT look like "empty result" (which a fall-through 200
 * would). HR documents live behind this too — there is no /documents on this
 * API at any scope (see the shared package for why), and this is what answers
 * a caller who tries anyway.
 */
publicApiRouter.use((req: Request, res: Response) => {
  fail(res, 404, 'NOT_FOUND', `No such endpoint: ${req.method} ${req.path}`);
});

// ---- 5. terminal error handler --------------------------------------------
//
// Why this exists rather than reusing middleware/error-handler.ts: that one ends
// with `fail(res, 500, 'INTERNAL', err.message)`, which for an unexpected throw
// is a raw pg / driver / GoTrue string. Acceptable for our own clients, who are
// us; not acceptable on a surface a third party calls, where it leaks table and
// column names. Deliberate `AppError` codes still pass through verbatim — those
// are the contract.
publicApiRouter.use(
  (err: unknown, req: Request, res: Response, _next: NextFunction): void => {
    if (err instanceof AppError && err.status < 500) {
      logger.warn(
        { reqId: req.id, code: err.code, path: req.path, apiKeyId: req.apiKey?.id },
        'public api client error'
      );
      fail(res, err.status, err.code, err.message, err.details);
      return;
    }
    logger.error(
      { reqId: req.id, err, path: req.path, apiKeyId: req.apiKey?.id },
      'public api unhandled error'
    );
    // The request id goes to the caller so a support ticket can name the exact
    // request, without the message saying anything about our schema.
    fail(res, 500, 'INTERNAL', 'Internal error', { request_id: req.id });
  }
);
